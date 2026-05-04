import type { ChangeEvent, WorldSnapshot } from '../env/types.ts';

export interface CandidateAction {
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
}

export interface ActionLogEntry {
  action: CandidateAction;
  result: unknown;
  error: string | null;
}

export type Reversibility =
  | 'fully_reversible'
  | 'reversible_with_backup'
  | 'partially_reversible'
  | 'irreversible'
  | 'unknown';

export type DataLossRisk = 'none' | 'low' | 'medium' | 'high';
export type BlastRadius = 'narrow' | 'wide' | 'unknown';

export interface Prediction {
  /** Typed change events. Matched against the actual world diff via canonical key. */
  expected_changes: ChangeEvent[];
  /** Effects beyond the direct change (cache invalidation, downstream reads, etc.). Free-form ok here. */
  side_effects: string[];
  confidence: 'low' | 'medium' | 'high';
  reversibility: Reversibility;
  data_loss_risk: DataLossRisk;
  blast_radius: BlastRadius;
  /** Preconditions the predictor couldn't verify from visible state. */
  unverified_preconditions: string[];
}

export interface ScoreEntry {
  candidate_index: number;
  score: number;
  reasoning: string;
  goal_alignment: string[];
  risks: string[];
}

export interface ScorerOutput {
  rankings: ScoreEntry[];
  recommended_index: number;
}

export interface CalibrationNote {
  turn: number;
  applies_to_tool: string;
  applies_when: string[];
  observed_error_type:
    | 'missed_target'
    | 'phantom_change'
    | 'wrong_field'
    | 'wrong_value'
    | 'underprediction'
    | 'overprediction'
    | 'noop_mispredicted'
    | 'no_error';
  lesson: string;
}

export interface UsageRecord {
  role: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface F1Score {
  precision: number;
  recall: number;
  f1: number;
  truePositive: number;
  predictedCount: number;
  actualCount: number;
}

export interface TurnRecord {
  turn: number;
  rawCandidates: CandidateAction[];
  candidates: CandidateAction[];
  validationFailures: Array<{ candidate: CandidateAction; reason: string }>;
  predictions: Prediction[];
  scoring: ScorerOutput;
  chosenIndex: number;
  chosen: CandidateAction;
  predicted: Prediction;
  actualEvents: ChangeEvent[];
  predictionScore: F1Score;
  calibrationNote: CalibrationNote;
  usage: UsageRecord[];
  before: WorldSnapshot;
  after: WorldSnapshot;
  executionError: string | null;
}

export interface BaselineTurnRecord {
  turn: number;
  toolName: string;
  args: unknown;
  before: WorldSnapshot;
  after: WorldSnapshot;
  events: ChangeEvent[];
}

export type AgentName = 'scaffold' | 'baseline' | 'thinking' | 'lite';

export interface AgentRunResult {
  agent: AgentName;
  turns: number;
  totalUsage: UsageRecord[];
  scaffoldTurns?: TurnRecord[];
  baselineTurns?: BaselineTurnRecord[];
  stoppedReason: 'goal-met' | 'max-turns' | 'error' | 'agent-declared-done';
  errorMessage: string | null;
  wallClockMs: number;
}
