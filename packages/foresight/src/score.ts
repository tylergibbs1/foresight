import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { GATE_SCORER_PROMPT } from './prompts.ts';
import { renderState } from './state.ts';
import { extractUsage, isAbortError } from './predict.ts';
import { ForesightAbortError, ForesightScoreError } from './errors.ts';
import type {
  Prediction,
  ProposedAction,
  Usage,
  WorldState,
} from './types.ts';

const GateDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  noop_recommended: z.boolean(),
  reason: z.string().describe('Single concrete sentence; cite state observations.'),
  risks_blocking: z.array(z.string()),
  goal_alignment: z.array(z.string()),
});

export type GateDecisionRaw = z.infer<typeof GateDecisionSchema>;

export interface ScoreArgs {
  model: LanguageModel;
  goal: string;
  state: WorldState;
  action: ProposedAction;
  prediction: Prediction;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Score one prediction against the goal and decide approve / reject.
 *
 * @throws {@link ForesightScoreError} when the LLM call fails. The
 *   prediction is preserved on the error.
 * @throws {@link ForesightAbortError} when the operation is aborted.
 *
 * @example
 * const { decision } = await score({
 *   model: openai('gpt-5.5'),
 *   goal: 'Remove user 3',
 *   state: snapshot,
 *   action,
 *   prediction,
 * });
 * if (decision.decision === 'approve') doIt();
 */
export async function score(
  opts: ScoreArgs,
): Promise<{ decision: GateDecisionRaw; usage: Usage }> {
  if (opts.signal?.aborted) throw new ForesightAbortError();

  const stateBlob = renderState(opts.state);
  const eventsBlob = opts.prediction.expected_changes.length
    ? opts.prediction.expected_changes.map(formatEvent).map(s => `    - ${s}`).join('\n')
    : '    (no observable change predicted)';

  const prompt = `\
GOAL:
${opts.goal}

WORLD STATE:
${stateBlob}

PROPOSED ACTION:
tool: ${opts.action.tool}
args: ${JSON.stringify(opts.action.args)}

PREDICTION:
  expected_changes:
${eventsBlob}
  side_effects: ${JSON.stringify(opts.prediction.side_effects)}
  confidence: ${opts.prediction.confidence}
  reversibility: ${opts.prediction.reversibility}
  data_loss_risk: ${opts.prediction.data_loss_risk}
  blast_radius: ${opts.prediction.blast_radius}
  unverified_preconditions: ${JSON.stringify(opts.prediction.unverified_preconditions)}

Decide approve or reject.`;

  try {
    const result = await generateObject({
      model: opts.model,
      schema: GateDecisionSchema,
      system: GATE_SCORER_PROMPT,
      prompt,
      abortSignal: opts.signal,
    });
    return {
      decision: result.object,
      usage: extractUsage(result.usage),
    };
  } catch (e) {
    if (isAbortError(e, opts.signal)) throw new ForesightAbortError();
    throw new ForesightScoreError(
      `scorer failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
      opts.prediction,
    );
  }
}

function formatEvent(e: {
  target_type: string;
  target_id: string;
  operation: string;
  field: string | null;
  before: string | null;
  after: string | null;
}): string {
  switch (e.operation) {
    case 'create':
      return `create ${e.target_type} ${e.target_id}`;
    case 'delete':
      return `delete ${e.target_type} ${e.target_id}`;
    case 'rename':
      return `rename ${e.before} -> ${e.after}`;
    case 'update':
      return e.field
        ? `update ${e.target_type} ${e.target_id} field ${e.field}: ${e.before} -> ${e.after}`
        : `update ${e.target_type} ${e.target_id}`;
    case 'noop':
      return `no observable change to ${e.target_type} ${e.target_id}`;
    default:
      return `${e.operation} ${e.target_type} ${e.target_id}`;
  }
}
