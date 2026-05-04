/**
 * foresight — predictive-approval gate for LLM agents.
 *
 * @example
 * import { foresight } from 'foresight';
 * import { openai } from '@ai-sdk/openai';
 *
 * const decision = await foresight.gate({
 *   goal: 'Remove user 3',
 *   action: { tool: 'crud_delete', args: { collection: 'users', id: '3' } },
 *   state: () => snapshotMyDb(),
 *   catalog: TOOL_CATALOG,
 *   model: openai('gpt-5.5'),
 * });
 *
 * if (!decision.ok) throw new Error(decision.reason);
 */
export { gate, type GateOptions } from './gate.ts';
export { predict, type PredictArgs } from './predict.ts';
export { score, type ScoreArgs, type GateDecisionRaw } from './score.ts';
export { matchEvents } from './match.ts';
export { renderState } from './state.ts';
export { eventKey } from './types.ts';

export {
  ForesightError,
  ForesightInputError,
  ForesightPredictError,
  ForesightScoreError,
  ForesightAbortError,
} from './errors.ts';

export type {
  WorldState,
  ToolCatalog,
  ToolCatalogEntry,
  ProposedAction,
  ChangeEvent,
  Prediction,
  CalibrationNote,
  Decision,
  MatchScore,
  Usage,
  Reversibility,
  DataLossRisk,
  BlastRadius,
  Confidence,
  ObservedErrorType,
  GateHooks,
} from './types.ts';

import { gate } from './gate.ts';
import { predict } from './predict.ts';
import { score } from './score.ts';
import { matchEvents } from './match.ts';

/**
 * Default-export namespace for ergonomic
 * `import { foresight } from 'foresight'; foresight.gate(...)`.
 *
 * The same functions are also available as named exports for
 * `import { gate } from 'foresight'`.
 */
export const foresight = {
  gate,
  predict,
  score,
  matchEvents,
};
