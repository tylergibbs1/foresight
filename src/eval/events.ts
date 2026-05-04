import type {
  AgentName,
  CalibrationNote,
  CandidateAction,
  F1Score,
  Prediction,
  ScorerOutput,
} from '../agents/types.ts';
import type { ChangeEvent } from '../env/types.ts';
import type { PerRunSummary } from './metrics.ts';
import type { RunnerOutput } from './runner.ts';

export interface ScaffoldTurnEvent {
  type: 'scaffold-turn';
  agent: 'scaffold';
  turn: number;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  candidatesCount: number;
  validationFailures: number;
  score: F1Score;
  executionError: string | null;
}

export interface BaselineTurnEvent {
  type: 'baseline-turn';
  agent: 'baseline' | 'thinking' | 'lite';
  turn: number;
  toolName: string;
  args: unknown;
}

export type RunnerEvent =
  | { type: 'config'; config: RunnerOutput['config']; totalRuns: number }
  | {
      type: 'run-start';
      runIndex: number;
      taskId: string;
      family: string;
      agent: AgentName;
      seed: number;
      goal: string;
    }
  | ScaffoldTurnEvent
  | BaselineTurnEvent
  | {
      type: 'phase-proposer';
      turn: number;
      candidates: CandidateAction[];
      validationFailures: number;
      tokens: number;
      ms: number;
    }
  | {
      type: 'phase-predictor';
      turn: number;
      predictions: Prediction[];
      tokens: number;
      ms: number;
    }
  | {
      type: 'phase-scorer';
      turn: number;
      scoring: ScorerOutput;
      chosenIndex: number;
      tokens: number;
      ms: number;
    }
  | {
      type: 'phase-executor';
      turn: number;
      chosen: CandidateAction;
      chosenIndex: number;
      predicted: Prediction;
      actualEvents: ChangeEvent[];
      predictionScore: F1Score;
      executionError: string | null;
      ms: number;
    }
  | {
      type: 'phase-calibrator';
      turn: number;
      note: CalibrationNote;
      tokens: number;
      ms: number;
    }
  | { type: 'run-end'; summary: PerRunSummary }
  | { type: 'done'; output: RunnerOutput };
