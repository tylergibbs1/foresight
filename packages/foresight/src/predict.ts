import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { PREDICTOR_PROMPT } from './prompts.ts';
import { renderState } from './state.ts';
import { ForesightAbortError, ForesightPredictError } from './errors.ts';
import type {
  CalibrationNote,
  Prediction,
  ProposedAction,
  ToolCatalog,
  Usage,
  WorldState,
} from './types.ts';

const ChangeEventSchema = z.object({
  target_type: z.enum(['file', 'record']),
  target_id: z.string(),
  operation: z.enum(['create', 'update', 'delete', 'rename', 'noop']),
  field: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});

const PredictionSchema = z.object({
  expected_changes: z.array(ChangeEventSchema),
  side_effects: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  reversibility: z.enum([
    'fully_reversible',
    'reversible_with_backup',
    'partially_reversible',
    'irreversible',
    'unknown',
  ]),
  data_loss_risk: z.enum(['none', 'low', 'medium', 'high']),
  blast_radius: z.enum(['narrow', 'wide', 'unknown']),
  unverified_preconditions: z.array(z.string()),
});

export interface PredictArgs {
  model: LanguageModel;
  state: WorldState;
  action: ProposedAction;
  catalog: ToolCatalog;
  notes?: CalibrationNote[];
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Predict the typed outcome of one proposed action against a world state.
 *
 * Goal-blind by design — the predictor does not see the user's goal. This
 * keeps it from hallucinating "good" outcomes; the scorer applies goal
 * alignment separately.
 *
 * @throws {@link ForesightPredictError} when the LLM call fails or the
 *   response can't be parsed against the schema.
 * @throws {@link ForesightAbortError} when the operation is aborted.
 *
 * @example
 * const { prediction } = await predict({
 *   model: openai('gpt-5.5'),
 *   state: { crud: { users: { '3': { name: 'carol' } } } },
 *   action: { tool: 'crud_delete', args: { collection: 'users', id: '3' } },
 *   catalog: [...],
 * });
 */
export async function predict(
  opts: PredictArgs,
): Promise<{ prediction: Prediction; usage: Usage }> {
  if (opts.signal?.aborted) throw new ForesightAbortError();

  const stateBlob = renderState(opts.state);
  const catalogBlob = opts.catalog
    .map(t => `- ${t.name}${t.args}: ${t.description}`)
    .join('\n');
  const notesBlob = opts.notes?.length
    ? opts.notes
        .map(n => {
          const when = n.applies_when.length ? ` when ${n.applies_when.join(' AND ')}` : '';
          return `- [${n.applies_to_tool}${when}] ${n.lesson}`;
        })
        .join('\n')
    : '(none)';

  const prompt = `\
WORLD STATE:
${stateBlob}

TOOL CATALOG (for context — only the proposed action is being predicted):
${catalogBlob}

PROPOSED ACTION:
tool: ${opts.action.tool}
args: ${JSON.stringify(opts.action.args)}
${opts.action.rationale ? `rationale: ${opts.action.rationale}\n` : ''}
CALIBRATION NOTES (priors from prior sessions; may not all apply):
${notesBlob}

Predict what will be observably true after this action runs. Emit typed events.`;

  try {
    const result = await generateObject({
      model: opts.model,
      schema: PredictionSchema,
      system: PREDICTOR_PROMPT,
      prompt,
      abortSignal: opts.signal,
    });
    return {
      prediction: result.object as Prediction,
      usage: extractUsage(result.usage),
    };
  } catch (e) {
    if (isAbortError(e, opts.signal)) throw new ForesightAbortError();
    throw new ForesightPredictError(
      `predictor failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
}

export function extractUsage(
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
      }
    | undefined,
): Usage {
  const promptTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0;
  const completionTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

export function isAbortError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (e instanceof Error) {
    return e.name === 'AbortError' || /aborted/i.test(e.message);
  }
  return false;
}
