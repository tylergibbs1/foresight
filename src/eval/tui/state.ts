import type {
  AgentName,
  CalibrationNote,
  CandidateAction,
  F1Score,
  Prediction,
  ScorerOutput,
} from '../../agents/types.ts';
import type { ChangeEvent } from '../../env/types.ts';
import type { PerRunSummary } from '../metrics.ts';
import type { RunnerEvent } from '../events.ts';
import type { RunnerOutput } from '../runner.ts';

export type Phase = 'proposer' | 'predictor' | 'scorer' | 'executor' | 'calibrator' | 'done';

export interface ActiveTurn {
  turn: number;
  toolName: string;
  args: unknown;
  rationale?: string;
  candidatesCount?: number;
  validationFailures?: number;
  score?: F1Score;
  executionError?: string | null;
}

/** Detailed phase-by-phase state of the *current* turn for focus mode. */
export interface CurrentTurnDetail {
  turn: number;
  phase: Phase;
  candidates?: CandidateAction[];
  validationFailures?: number;
  proposerMs?: number;
  proposerTokens?: number;
  predictions?: Prediction[];
  predictorMs?: number;
  predictorTokens?: number;
  scoring?: ScorerOutput;
  chosenIndex?: number;
  scorerMs?: number;
  scorerTokens?: number;
  chosen?: CandidateAction;
  predicted?: Prediction;
  actualEvents?: ChangeEvent[];
  predictionScore?: F1Score;
  executionError?: string | null;
  executorMs?: number;
  note?: CalibrationNote;
  calibratorMs?: number;
  calibratorTokens?: number;
}

export interface ActiveRunState {
  runIndex: number;
  taskId: string;
  family: string;
  agent: AgentName;
  seed: number;
  goal: string;
  startedAt: number;
  /** Compact list of recent fully-completed turns (overview mode). */
  turns: ActiveTurn[];
  /** Detailed per-phase state for the current turn (focus mode). */
  current: CurrentTurnDetail | null;
  /** F1 score per fully-completed scaffold turn, for the sparkline. */
  f1History: number[];
}

export interface DashboardState {
  config: RunnerOutput['config'] | null;
  totalRuns: number;
  startedAt: number | null;
  completed: PerRunSummary[];
  active: ActiveRunState | null;
  output: RunnerOutput | null;
  done: boolean;
}

export const initialState: DashboardState = {
  config: null,
  totalRuns: 0,
  startedAt: null,
  completed: [],
  active: null,
  output: null,
  done: false,
};

const TURN_WINDOW = 6;

export function reduce(state: DashboardState, event: RunnerEvent): DashboardState {
  switch (event.type) {
    case 'config':
      return {
        ...state,
        config: event.config,
        totalRuns: event.totalRuns,
        startedAt: state.startedAt ?? Date.now(),
      };

    case 'run-start':
      return {
        ...state,
        active: {
          runIndex: event.runIndex,
          taskId: event.taskId,
          family: event.family,
          agent: event.agent,
          seed: event.seed,
          goal: event.goal,
          startedAt: Date.now(),
          turns: [],
          current: null,
          f1History: [],
        },
      };

    case 'phase-proposer': {
      if (!state.active) return state;
      const current: CurrentTurnDetail = {
        turn: event.turn,
        phase: 'predictor',
        candidates: event.candidates,
        validationFailures: event.validationFailures,
        proposerMs: event.ms,
        proposerTokens: event.tokens,
      };
      return { ...state, active: { ...state.active, current } };
    }

    case 'phase-predictor': {
      if (!state.active?.current) return state;
      const current: CurrentTurnDetail = {
        ...state.active.current,
        phase: 'scorer',
        predictions: event.predictions,
        predictorMs: event.ms,
        predictorTokens: event.tokens,
      };
      return { ...state, active: { ...state.active, current } };
    }

    case 'phase-scorer': {
      if (!state.active?.current) return state;
      const current: CurrentTurnDetail = {
        ...state.active.current,
        phase: 'executor',
        scoring: event.scoring,
        chosenIndex: event.chosenIndex,
        scorerMs: event.ms,
        scorerTokens: event.tokens,
      };
      return { ...state, active: { ...state.active, current } };
    }

    case 'phase-executor': {
      if (!state.active?.current) return state;
      const current: CurrentTurnDetail = {
        ...state.active.current,
        phase: 'calibrator',
        chosen: event.chosen,
        chosenIndex: event.chosenIndex,
        predicted: event.predicted,
        actualEvents: event.actualEvents,
        predictionScore: event.predictionScore,
        executionError: event.executionError,
        executorMs: event.ms,
      };
      return { ...state, active: { ...state.active, current } };
    }

    case 'phase-calibrator': {
      if (!state.active?.current) return state;
      const current: CurrentTurnDetail = {
        ...state.active.current,
        phase: 'done',
        note: event.note,
        calibratorMs: event.ms,
        calibratorTokens: event.tokens,
      };
      return { ...state, active: { ...state.active, current } };
    }

    case 'scaffold-turn': {
      if (!state.active) return state;
      const turn: ActiveTurn = {
        turn: event.turn,
        toolName: event.toolName,
        args: event.args,
        rationale: event.rationale,
        candidatesCount: event.candidatesCount,
        validationFailures: event.validationFailures,
        score: event.score,
        executionError: event.executionError,
      };
      const turns = [...state.active.turns, turn].slice(-TURN_WINDOW);
      const f1History = [...state.active.f1History, event.score.f1];
      return {
        ...state,
        active: { ...state.active, turns, f1History, current: null },
      };
    }

    case 'baseline-turn': {
      if (!state.active) return state;
      const turn: ActiveTurn = {
        turn: event.turn,
        toolName: event.toolName,
        args: event.args,
      };
      const turns = [...state.active.turns, turn].slice(-TURN_WINDOW);
      return { ...state, active: { ...state.active, turns } };
    }

    case 'run-end':
      return {
        ...state,
        completed: [...state.completed, event.summary],
        active: null,
      };

    case 'done':
      return { ...state, output: event.output, done: true };
  }
}
