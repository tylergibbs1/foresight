/**
 * Public types for the foresight library.
 *
 * The state shape is `{fs, crud}` because that covers the common cases (file
 * mutations, record mutations) and lets the predictor reason concretely. If
 * your domain has a different shape (HTTP calls, RPC, etc.), translate it
 * into this representation before calling — typically as fake `crud`
 * collections keyed by your real entity IDs.
 */

/** A snapshot of the world the agent operates on. */
export interface WorldState {
  /** Path → file content. */
  fs?: Record<string, string>;
  /** Collection → id → record. */
  crud?: Record<string, Record<string, Record<string, unknown>>>;
}

/** A single tool's surface as visible to the predictor. No executor here. */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  /** Free-form description of the args shape, e.g. `{ path: string, content: string }`. */
  args: string;
}

export type ToolCatalog = ToolCatalogEntry[];

/** The action under consideration. NOT yet executed. */
export interface ProposedAction {
  tool: string;
  args: Record<string, unknown>;
  /** Optional caller-supplied reason. Surfaced to the scorer for context. */
  rationale?: string;
}

export type Reversibility =
  | 'fully_reversible'
  | 'reversible_with_backup'
  | 'partially_reversible'
  | 'irreversible'
  | 'unknown';

export type DataLossRisk = 'none' | 'low' | 'medium' | 'high';
export type BlastRadius = 'narrow' | 'wide' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';

/**
 * Canonical, structured event that both the predictor emits AND the diff
 * engine produces. Matching is set-equality on the canonical key
 * `<target_type>:<target_id>:<operation>:<field>`.
 */
export interface ChangeEvent {
  target_type: 'file' | 'record';
  /** For files: path. For records: `<collection>/<id>`. For renames: the resulting path. */
  target_id: string;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'noop';
  /** For record updates, the field that changed. null otherwise. */
  field: string | null;
  /** Stringified prior value. For renames, the previous path. */
  before: string | null;
  /** Stringified resulting value. For renames, the new path (== target_id). */
  after: string | null;
}

/** The predictor's structured output for a single proposed action. */
export interface Prediction {
  expected_changes: ChangeEvent[];
  /** Effects beyond direct changes (cache invalidation, downstream reads, etc.). */
  side_effects: string[];
  confidence: Confidence;
  reversibility: Reversibility;
  data_loss_risk: DataLossRisk;
  blast_radius: BlastRadius;
  /** Things that must be true for this prediction to hold but aren't visible in state. */
  unverified_preconditions: string[];
}

export type ObservedErrorType =
  | 'missed_target'
  | 'phantom_change'
  | 'wrong_field'
  | 'wrong_value'
  | 'underprediction'
  | 'overprediction'
  | 'noop_mispredicted'
  | 'no_error';

/**
 * Structured calibration note. Stateless: the caller can persist these and
 * pass them back on the next `gate()` call to give the predictor priors.
 */
export interface CalibrationNote {
  applies_to_tool: string;
  applies_when: string[];
  observed_error_type: ObservedErrorType;
  /** One short, actionable rule. */
  lesson: string;
}

/** Token usage for one or more LLM calls. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * The library's primary return value. Caller does whatever it wants with
 * `ok`: throw, return early, surface to UI, prompt a human, escalate, log.
 */
export interface Decision {
  /** True = approve the action. False = reject (don't run it). */
  ok: boolean;
  /** Human-readable explanation of the decision. Single concrete sentence. */
  reason: string;
  /** The predictor's typed event prediction. */
  predicted_changes: ChangeEvent[];
  /** Risk metadata from the predictor. */
  risks: {
    confidence: Confidence;
    reversibility: Reversibility;
    data_loss_risk: DataLossRisk;
    blast_radius: BlastRadius;
    unverified_preconditions: string[];
    side_effects: string[];
  };
  /**
   * Specific risks that drove a reject decision. Empty when ok=true.
   * Caller can render these as bulleted reasons in a UI.
   */
  risks_blocking: string[];
  /**
   * Specific goal criteria the action would satisfy when approved.
   * Empty when ok=false unless the scorer flagged partial alignment.
   */
  goal_alignment: string[];
  /** True if the scorer concluded "do nothing" is the right outcome. */
  noop_recommended: boolean;
  /**
   * A structured lesson the predictor would benefit from on the next call.
   * Caller persists this and passes the array back into `notes` next time.
   * null when nothing useful was observed.
   */
  note: CalibrationNote | null;
  usage: Usage;
}

/**
 * Score-level metrics for measuring prediction quality after the action runs.
 * Returned by `matchEvents(predicted, actual)`.
 */
export interface MatchScore {
  precision: number;
  recall: number;
  f1: number;
  truePositive: number;
  predictedCount: number;
  actualCount: number;
  /** Canonical keys present in predicted but not actual. */
  predictedOnly: string[];
  /** Canonical keys present in actual but not predicted. */
  actualOnly: string[];
}

/**
 * Observability hooks. All optional; called after each phase completes.
 * Wire these up to your logger / Langfuse / OpenTelemetry / Logfire.
 */
export interface GateHooks {
  onPredict?: (data: { prediction: Prediction; usage: Usage; ms: number }) => void | Promise<void>;
  onScore?: (data: { decision: Pick<Decision, 'ok' | 'reason' | 'noop_recommended' | 'risks_blocking' | 'goal_alignment'>; usage: Usage; ms: number }) => void | Promise<void>;
  onNote?: (data: { note: CalibrationNote | null; usage: Usage; ms: number }) => void | Promise<void>;
}

/**
 * Compute the canonical key used by the prediction-vs-actual matcher.
 *
 * @example
 * eventKey({ target_type: 'file', target_id: 'a.ts', operation: 'create', field: null, ... })
 * // → "file:a.ts:create:"
 */
export function eventKey(e: ChangeEvent): string {
  return `${e.target_type}:${e.target_id}:${e.operation}:${e.field ?? ''}`;
}
