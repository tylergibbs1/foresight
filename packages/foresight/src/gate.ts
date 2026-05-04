import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { predict, extractUsage, isAbortError } from './predict.ts';
import { score } from './score.ts';
import { resolveState } from './state.ts';
import { NOTE_PROMPT } from './prompts.ts';
import { ForesightAbortError, ForesightInputError } from './errors.ts';
import type {
  CalibrationNote,
  Decision,
  GateHooks,
  ProposedAction,
  ToolCatalog,
  Usage,
  WorldState,
} from './types.ts';

const NoteSchema = z.object({
  applies_to_tool: z.string(),
  applies_when: z.array(z.string()),
  observed_error_type: z.enum([
    'missed_target',
    'phantom_change',
    'wrong_field',
    'wrong_value',
    'underprediction',
    'overprediction',
    'noop_mispredicted',
    'no_error',
  ]),
  lesson: z.string(),
});

/**
 * Options for the public {@link gate} function.
 *
 * The `model` field is required and serves as the default for predictor,
 * scorer, and note generation. Per-role overrides let you split: e.g. run
 * the scorer on a smarter model, the note on a cheaper one.
 */
export interface GateOptions {
  /** What the agent is trying to accomplish, in plain language. */
  goal: string;
  /** The action under consideration. NOT yet executed. */
  action: ProposedAction;
  /** A snapshot of the world the action would affect. Function form is awaited. */
  state: WorldState | (() => Promise<WorldState> | WorldState);
  /** Tool catalog for context. Just names + descriptions; no executors. */
  catalog: ToolCatalog;
  /** Calibration notes from prior gate calls. Stateless — caller persists. */
  notes?: CalibrationNote[];
  /**
   * Default model used when role-specific overrides aren't set. Pass an
   * AI SDK `LanguageModel` instance, e.g. `openai('gpt-5.5')`.
   */
  model: LanguageModel;
  /** Override for the predictor LLM call. Defaults to {@link GateOptions.model}. */
  predictModel?: LanguageModel;
  /** Override for the scorer LLM call. Defaults to {@link GateOptions.model}. */
  scoreModel?: LanguageModel;
  /** Override for the calibration-note LLM call. Defaults to {@link GateOptions.model}. */
  noteModel?: LanguageModel;
  /** Skip the note step entirely. Saves one LLM call when caller doesn't need it. */
  skipNote?: boolean;
  /** Cancel the operation. Aborting throws {@link ForesightAbortError}. */
  signal?: AbortSignal;
  /** Per-phase observability callbacks (logger / tracer integration). */
  hooks?: GateHooks;
}

const GateOptionsValidationSchema = z.object({
  goal: z.string().min(1, 'goal must not be empty'),
  action: z.object({
    tool: z.string().min(1, 'action.tool must not be empty'),
    args: z.record(z.string(), z.unknown()),
    rationale: z.string().optional(),
  }),
  catalog: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        args: z.string(),
      }),
    )
    .min(1, 'catalog must not be empty'),
});

/**
 * Predict the action's outcome, score it against the goal, and return a
 * structured approve/reject decision.
 *
 * Performs at most three LLM calls per invocation:
 *   1. predictor (always)
 *   2. scorer    (always)
 *   3. note      (skippable via `skipNote`)
 *
 * @throws {@link ForesightInputError} when options are malformed.
 * @throws {@link ForesightPredictError} when the predictor fails.
 * @throws {@link ForesightScoreError} when the scorer fails.
 * @throws {@link ForesightAbortError} when `signal` aborts.
 *
 * @example
 * import { foresight } from 'foresight';
 * import { openai } from '@ai-sdk/openai';
 *
 * const decision = await foresight.gate({
 *   goal: 'Remove user 3 from the system',
 *   action: { tool: 'crud_delete', args: { collection: 'users', id: '3' } },
 *   state: () => snapshotMyDb(),
 *   catalog: TOOL_CATALOG,
 *   model: openai('gpt-5.5'),
 *   signal: AbortSignal.timeout(30_000),
 *   hooks: {
 *     onPredict: ({ usage, ms }) => log('predict', { ms, tokens: usage.totalTokens }),
 *   },
 * });
 *
 * if (!decision.ok) throw new Error(decision.reason);
 */
export async function gate(opts: GateOptions): Promise<Decision> {
  // ── input validation ──
  const parsed = GateOptionsValidationSchema.safeParse({
    goal: opts.goal,
    action: opts.action,
    catalog: opts.catalog,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map(i => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new ForesightInputError(`invalid gate options: ${msg}`);
  }
  if (opts.signal?.aborted) throw new ForesightAbortError();

  const predictModel = opts.predictModel ?? opts.model;
  const scoreModel = opts.scoreModel ?? opts.model;
  const noteModel = opts.noteModel ?? opts.model;

  const state = await resolveState(opts.state);
  let totalUsage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const sumUsage = (u: Usage) => {
    totalUsage = {
      promptTokens: totalUsage.promptTokens + u.promptTokens,
      completionTokens: totalUsage.completionTokens + u.completionTokens,
      totalTokens: totalUsage.totalTokens + u.totalTokens,
    };
  };

  // ── predict ──
  const tPredict = performance.now();
  const { prediction, usage: predictUsage } = await predict({
    model: predictModel,
    state,
    action: opts.action,
    catalog: opts.catalog,
    notes: opts.notes,
    signal: opts.signal,
  });
  sumUsage(predictUsage);
  await opts.hooks?.onPredict?.({
    prediction,
    usage: predictUsage,
    ms: performance.now() - tPredict,
  });

  // ── score ──
  const tScore = performance.now();
  const { decision: rawDecision, usage: scoreUsage } = await score({
    model: scoreModel,
    goal: opts.goal,
    state,
    action: opts.action,
    prediction,
    signal: opts.signal,
  });
  sumUsage(scoreUsage);
  const ok = rawDecision.decision === 'approve';
  await opts.hooks?.onScore?.({
    decision: {
      ok,
      reason: rawDecision.reason,
      noop_recommended: rawDecision.noop_recommended,
      risks_blocking: rawDecision.risks_blocking,
      goal_alignment: rawDecision.goal_alignment,
    },
    usage: scoreUsage,
    ms: performance.now() - tScore,
  });

  // ── note (best-effort, never blocks the decision) ──
  let note: CalibrationNote | null = null;
  if (!opts.skipNote) {
    if (opts.signal?.aborted) throw new ForesightAbortError();
    const tNote = performance.now();
    let noteUsage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    try {
      const r = await generateObject({
        model: noteModel,
        schema: NoteSchema,
        system: NOTE_PROMPT,
        prompt: `\
TOOL: ${opts.action.tool}
ARGS: ${JSON.stringify(opts.action.args)}

PREDICTION:
  expected_changes: ${JSON.stringify(prediction.expected_changes)}
  reversibility: ${prediction.reversibility}
  data_loss_risk: ${prediction.data_loss_risk}
  confidence: ${prediction.confidence}
  unverified_preconditions: ${JSON.stringify(prediction.unverified_preconditions)}

DECISION: ${rawDecision.decision} (noop_recommended=${rawDecision.noop_recommended})
REASON: ${rawDecision.reason}

Produce a structured note future predictor calls would benefit from, or
report no_error if the prediction looks complete and well-grounded.`,
        abortSignal: opts.signal,
      });
      noteUsage = extractUsage(r.usage);
      sumUsage(noteUsage);
      note = r.object;
    } catch (e) {
      if (isAbortError(e, opts.signal)) throw new ForesightAbortError();
      // Note generation is best-effort; never block the decision on a
      // calibration step. Hooks still fire so observability sees the failure.
      note = null;
    }
    await opts.hooks?.onNote?.({
      note,
      usage: noteUsage,
      ms: performance.now() - tNote,
    });
  }

  return {
    ok,
    reason: rawDecision.reason,
    predicted_changes: prediction.expected_changes,
    risks: {
      confidence: prediction.confidence,
      reversibility: prediction.reversibility,
      data_loss_risk: prediction.data_loss_risk,
      blast_radius: prediction.blast_radius,
      unverified_preconditions: prediction.unverified_preconditions,
      side_effects: prediction.side_effects,
    },
    risks_blocking: rawDecision.risks_blocking,
    goal_alignment: rawDecision.goal_alignment,
    noop_recommended: rawDecision.noop_recommended,
    note,
    usage: totalUsage,
  };
}
