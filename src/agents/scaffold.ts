import { proposeCandidates } from './proposer.ts';
import { predict } from './predictor.ts';
import { score, type ScorerMode } from './scorer.ts';
import { calibrate, predictionF1 } from './calibrator.ts';
import { dedupe, validate } from './validator.ts';
import { executeChosen } from '../env/tools.ts';
import { diff, diffEvents } from '../env/snapshot.ts';
import type { World } from '../env/world.ts';
import type { ChangeEvent } from '../env/types.ts';
import type { TaskDef } from '../tasks/types.ts';
import type {
  ActionLogEntry,
  AgentRunResult,
  CalibrationNote,
  CandidateAction,
  F1Score,
  Prediction,
  ScorerOutput,
  TurnRecord,
  UsageRecord,
} from './types.ts';

export interface ScaffoldOptions {
  model: string;
  /** Optional per-role model overrides. Default to `model`. */
  proposerModel?: string;
  predictorModel?: string;
  scorerModel?: string;
  calibratorModel?: string;
  world: World;
  task: TaskDef;
  maxTurns: number;
  candidateCount: number;
  notesToPredictor: boolean;
  scorerMode: ScorerMode;
  /** How many recent notes to surface to the predictor. */
  notesWindow?: number;
  /** Streaming callback for live UIs. Called after each completed turn. */
  onTurn?: (rec: TurnRecord) => void;
  /** Per-phase streaming callbacks for focus-mode dashboards. */
  onProposed?: (d: {
    turn: number;
    candidates: CandidateAction[];
    validationFailures: number;
    tokens: number;
    ms: number;
  }) => void;
  onPredicted?: (d: {
    turn: number;
    predictions: Prediction[];
    tokens: number;
    ms: number;
  }) => void;
  onScored?: (d: {
    turn: number;
    scoring: ScorerOutput;
    chosenIndex: number;
    tokens: number;
    ms: number;
  }) => void;
  onExecuted?: (d: {
    turn: number;
    chosen: CandidateAction;
    chosenIndex: number;
    predicted: Prediction;
    actualEvents: ChangeEvent[];
    predictionScore: F1Score;
    executionError: string | null;
    ms: number;
  }) => void;
  onCalibrated?: (d: {
    turn: number;
    note: CalibrationNote;
    tokens: number;
    ms: number;
  }) => void;
}

const DEFAULT_NOTES_WINDOW = 10;

export async function runScaffold(opts: ScaffoldOptions): Promise<AgentRunResult> {
  const start = performance.now();
  const turns: TurnRecord[] = [];
  const notes: CalibrationNote[] = [];
  const pastActions: ActionLogEntry[] = [];
  const usageAll: UsageRecord[] = [];
  const notesWindow = opts.notesWindow ?? DEFAULT_NOTES_WINDOW;

  let stopped: AgentRunResult['stoppedReason'] = 'max-turns';
  let errorMessage: string | null = null;

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const before = opts.world.snapshot();

    // Goal short-circuit: only valid AFTER the agent has taken at least one
    // action. Otherwise an agent gets free credit on tasks where do-nothing
    // is a valid outcome (e.g. trap_chain when a prereq is missing) without
    // ever demonstrating it considered the world state.
    if (turn > 0 && opts.task.evaluate(opts.world, before).success) {
      stopped = 'goal-met';
      break;
    }

    let propose;
    const proposerStart = performance.now();
    try {
      propose = await proposeCandidates({
        model: opts.proposerModel ?? opts.model,
        goal: opts.task.goal,
        state: before,
        notes: notes.slice(-notesWindow),
        candidateCount: opts.candidateCount,
        pastActions,
      });
    } catch (e) {
      stopped = 'error';
      errorMessage = `proposer: ${describeError(e)}`;
      break;
    }
    usageAll.push(propose.usage);

    // Validate + dedupe before paying for predictor calls.
    const validationFailures: TurnRecord['validationFailures'] = [];
    const validCandidates: CandidateAction[] = [];
    for (const c of propose.candidates) {
      const v = validate(c);
      if (v.ok) validCandidates.push(c);
      else validationFailures.push({ candidate: c, reason: v.reason });
    }
    const candidates = dedupe(validCandidates).slice(0, opts.candidateCount);

    if (candidates.length === 0) {
      stopped = 'error';
      errorMessage = 'no valid candidates after validation/dedupe';
      break;
    }
    opts.onProposed?.({
      turn,
      candidates,
      validationFailures: validationFailures.length,
      tokens: propose.usage.totalTokens,
      ms: performance.now() - proposerStart,
    });

    let predictions;
    const predictorStart = performance.now();
    try {
      predictions = await Promise.all(
        candidates.map(c =>
          predict({
            model: opts.predictorModel ?? opts.model,
            state: before,
            candidate: c,
            notes: notes.slice(-notesWindow),
            useNotes: opts.notesToPredictor,
            pastActions,
          }),
        ),
      );
    } catch (e) {
      stopped = 'error';
      errorMessage = `predictor: ${describeError(e)}`;
      break;
    }
    for (const p of predictions) usageAll.push(p.usage);
    opts.onPredicted?.({
      turn,
      predictions: predictions.map(p => p.prediction),
      tokens: predictions.reduce((s, p) => s + p.usage.totalTokens, 0),
      ms: performance.now() - predictorStart,
    });

    let scoring;
    const scorerStart = performance.now();
    try {
      scoring = await score({
        model: opts.scorerModel ?? opts.model,
        goal: opts.task.goal,
        predictions: predictions.map(p => p.prediction),
        candidates,
        state: before,
        pastActions,
        mode: opts.scorerMode,
      });
    } catch (e) {
      stopped = 'error';
      errorMessage = `scorer: ${describeError(e)}`;
      break;
    }
    for (const u of scoring.usage) usageAll.push(u);

    const chosenIndex = clampIndex(scoring.scoring.recommended_index, candidates.length);
    const chosen = candidates[chosenIndex]!;
    const predicted = predictions[chosenIndex]!.prediction;
    opts.onScored?.({
      turn,
      scoring: scoring.scoring,
      chosenIndex,
      tokens: scoring.usage.reduce((s, u) => s + u.totalTokens, 0),
      ms: performance.now() - scorerStart,
    });

    // Short-circuit: if the proposer emitted a `noop` and the scorer picked
    // it, the agent is declaring termination. Don't run the executor (no
    // world mutation), don't run the calibrator (no observable change to
    // calibrate against), and exit the loop. Modeled after AI SDK 6's
    // hasToolCall('done') stop-condition pattern.
    if (chosen.tool === 'noop') {
      stopped = 'agent-declared-done';
      const after = opts.world.snapshot();
      const actualEvents = diffEvents(before, after);
      const f1 = predictionF1(predicted.expected_changes, actualEvents);
      const usageThisTurn: UsageRecord[] = [
        propose.usage,
        ...predictions.map(p => p.usage),
        ...scoring.usage,
      ];
      const rec: TurnRecord = {
        turn,
        rawCandidates: propose.candidates,
        candidates,
        validationFailures,
        predictions: predictions.map(p => p.prediction),
        scoring: scoring.scoring,
        chosenIndex,
        chosen,
        predicted,
        actualEvents,
        predictionScore: f1,
        calibrationNote: {
          turn,
          applies_to_tool: 'noop',
          applies_when: [],
          observed_error_type: 'no_error',
          lesson: `Agent declared done: ${(chosen.args.reason as string) ?? '(no reason given)'}`,
        },
        usage: usageThisTurn,
        before,
        after,
        executionError: null,
      };
      turns.push(rec);
      pastActions.push({ action: chosen, result: { noop: true }, error: null });
      opts.onTurn?.(rec);
      break;
    }

    const execStart = performance.now();
    let execError: string | null = null;
    let execResult: unknown = null;
    try {
      execResult = await executeChosen(opts.world, chosen.tool, chosen.args);
    } catch (e) {
      execError = describeError(e);
    }
    const after = opts.world.snapshot();
    const actualEvents = diffEvents(before, after);
    const f1 = predictionF1(predicted.expected_changes, actualEvents);
    opts.onExecuted?.({
      turn,
      chosen,
      chosenIndex,
      predicted,
      actualEvents,
      predictionScore: f1,
      executionError: execError,
      ms: performance.now() - execStart,
    });

    let calibration;
    const calibratorStart = performance.now();
    try {
      calibration = await calibrate({
        model: opts.calibratorModel ?? opts.model,
        turn,
        toolName: chosen.tool,
        prediction: predicted,
        actual: actualEvents,
        score: f1,
      });
    } catch (e) {
      stopped = 'error';
      errorMessage = `calibrator: ${describeError(e)}`;
      break;
    }
    usageAll.push(calibration.usage);
    notes.push(calibration.note);
    opts.onCalibrated?.({
      turn,
      note: calibration.note,
      tokens: calibration.usage.totalTokens,
      ms: performance.now() - calibratorStart,
    });

    const usageThisTurn: UsageRecord[] = [
      propose.usage,
      ...predictions.map(p => p.usage),
      ...scoring.usage,
      calibration.usage,
    ];

    const rec: TurnRecord = {
      turn,
      rawCandidates: propose.candidates,
      candidates,
      validationFailures,
      predictions: predictions.map(p => p.prediction),
      scoring: scoring.scoring,
      chosenIndex,
      chosen,
      predicted,
      actualEvents,
      predictionScore: f1,
      calibrationNote: calibration.note,
      usage: usageThisTurn,
      before,
      after,
      executionError: execError,
    };
    turns.push(rec);
    pastActions.push({ action: chosen, result: execResult, error: execError });
    opts.onTurn?.(rec);

    // Suppress no-op execution warning by reading the diff length.
    void diff;
  }

  // Final goal check (loop may have ended on max-turns without a final check).
  if (stopped === 'max-turns') {
    const finalEval = opts.task.evaluate(opts.world, turns[0]?.before ?? opts.world.snapshot());
    if (finalEval.success) stopped = 'goal-met';
  }

  return {
    agent: 'scaffold',
    turns: turns.length,
    totalUsage: usageAll,
    scaffoldTurns: turns,
    stoppedReason: stopped,
    errorMessage,
    wallClockMs: performance.now() - start,
  };
}

function clampIndex(i: number, n: number): number {
  if (!Number.isFinite(i) || i < 0) return 0;
  if (i >= n) return n - 1;
  return Math.floor(i);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
