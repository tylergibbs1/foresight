import { runScaffold } from '../agents/scaffold.ts';
import { runBaseline } from '../agents/baseline.ts';
import { runLite } from '../agents/lite.ts';
import { runGated } from '../agents/gated.ts';
import type { ScorerMode } from '../agents/scorer.ts';
import type { AgentName } from '../agents/types.ts';
import { makeWorld } from '../env/reset.ts';
import { allTasks, type TaskDef } from '../tasks/index.ts';
import { evaluateTask } from './correctness.ts';
import {
  aggregateUsage,
  estimateCostUsd,
  scaffoldSessionMetrics,
  summarizeByFamilyAndAgent,
  type FamilyAgentSummary,
  type PerRunSummary,
} from './metrics.ts';
import type { RunnerEvent } from './events.ts';

export type AgentChoice = AgentName;

export interface RunnerOptions {
  model: string;
  /** Optional per-role overrides for the scaffold's LLM calls. */
  miniModel?: string;
  agents: AgentChoice[];
  taskFilter?: (t: TaskDef) => boolean;
  taskLimit?: number;
  seeds: number;
  candidateCount: number;
  notesToPredictor: boolean;
  scorerMode: ScorerMode;
  maxTurns: number;
  onProgress?: (line: string) => void;
  /** Structured streaming events. Use this for TUIs and dashboards. */
  onEvent?: (event: RunnerEvent) => void;
}

export interface RunnerOutput {
  config: {
    model: string;
    agents: AgentChoice[];
    seeds: number;
    candidateCount: number;
    notesToPredictor: boolean;
    scorerMode: ScorerMode;
    maxTurns: number;
    taskCount: number;
  };
  runs: PerRunSummary[];
  startedAt: string;
  finishedAt: string;
}

export async function runEval(opts: RunnerOptions): Promise<RunnerOutput> {
  const tasks = allTasks
    .filter(opts.taskFilter ?? (() => true))
    .slice(0, opts.taskLimit ?? allTasks.length);
  const startedAt = new Date().toISOString();
  const runs: PerRunSummary[] = [];

  const config: RunnerOutput['config'] = {
    model: opts.model,
    agents: opts.agents,
    seeds: opts.seeds,
    candidateCount: opts.candidateCount,
    notesToPredictor: opts.notesToPredictor,
    scorerMode: opts.scorerMode,
    maxTurns: opts.maxTurns,
    taskCount: tasks.length,
  };
  const totalRuns = tasks.length * opts.seeds * opts.agents.length;
  opts.onEvent?.({ type: 'config', config, totalRuns });

  let runIndex = 0;
  for (const task of tasks) {
    for (let seed = 0; seed < opts.seeds; seed++) {
      for (const agent of opts.agents) {
        const world = makeWorld();
        task.setup(world);
        const initial = world.snapshot();

        opts.onProgress?.(`→ ${task.id}  seed=${seed}  agent=${agent}`);
        opts.onEvent?.({
          type: 'run-start',
          runIndex,
          taskId: task.id,
          family: task.family,
          agent,
          seed,
          goal: task.goal,
        });

        const liteModel = opts.miniModel ?? opts.model;
        const result =
          agent === 'gated'
            ? await runGated({
                model: opts.model,
                world,
                task,
                maxTurns: opts.maxTurns,
                onTurn: rec => {
                  opts.onEvent?.({
                    type: 'baseline-turn',
                    agent: 'baseline', // share rendering with baseline-style agents
                    turn: rec.turn,
                    toolName: rec.toolName,
                    args: rec.args,
                  });
                },
              })
            : agent === 'lite'
            ? await runLite({
                model: liteModel,
                world,
                task,
                maxTurns: opts.maxTurns,
                onTurn: rec => {
                  opts.onEvent?.({
                    type: 'baseline-turn',
                    agent: 'lite',
                    turn: rec.turn,
                    toolName: rec.toolName,
                    args: rec.args,
                  });
                },
              })
            : agent === 'scaffold'
            ? await runScaffold({
                model: opts.model,
                proposerModel: opts.model,
                predictorModel: opts.miniModel ?? opts.model,
                scorerModel: opts.miniModel ?? opts.model,
                calibratorModel: opts.miniModel ?? opts.model,
                world,
                task,
                maxTurns: opts.maxTurns,
                candidateCount: opts.candidateCount,
                notesToPredictor: opts.notesToPredictor,
                scorerMode: opts.scorerMode,
                onTurn: rec => {
                  opts.onEvent?.({
                    type: 'scaffold-turn',
                    agent: 'scaffold',
                    turn: rec.turn,
                    toolName: rec.chosen.tool,
                    args: rec.chosen.args,
                    rationale: rec.chosen.rationale,
                    candidatesCount: rec.candidates.length,
                    validationFailures: rec.validationFailures.length,
                    score: rec.predictionScore,
                    executionError: rec.executionError,
                  });
                },
                onProposed: d => opts.onEvent?.({ type: 'phase-proposer', ...d }),
                onPredicted: d => opts.onEvent?.({ type: 'phase-predictor', ...d }),
                onScored: d => opts.onEvent?.({ type: 'phase-scorer', ...d }),
                onExecuted: d => opts.onEvent?.({ type: 'phase-executor', ...d }),
                onCalibrated: d => opts.onEvent?.({ type: 'phase-calibrator', ...d }),
              })
            : await runBaseline({
                model: opts.model,
                world,
                task,
                maxTurns: opts.maxTurns,
                variant: agent === 'thinking' ? 'thinking' : 'baseline',
                onTurn: rec => {
                  opts.onEvent?.({
                    type: 'baseline-turn',
                    agent: agent === 'thinking' ? 'thinking' : 'baseline',
                    turn: rec.turn,
                    toolName: rec.toolName,
                    args: rec.args,
                  });
                },
              });

        const evaluation = evaluateTask(task, world, initial);
        const usage = aggregateUsage(result.totalUsage);
        const summary: PerRunSummary = {
          taskId: task.id,
          family: task.family,
          difficulty: task.difficulty,
          agent,
          seed,
          success: evaluation.success,
          failureReasons: evaluation.failureReasons,
          destructiveActions: evaluation.destructiveActions,
          destructiveCount: evaluation.destructiveActions.length,
          failureKinds: evaluation.failureKinds,
          executedActionCount: result.turns,
          turns: result.turns,
          stoppedReason: result.stoppedReason,
          errorMessage: result.errorMessage,
          wallClockMs: result.wallClockMs,
          usage,
          estimatedCostUsd: estimateCostUsd(usage, opts.model),
          sessionMetrics: agent === 'scaffold' ? scaffoldSessionMetrics(result) : null,
        };
        runs.push(summary);

        opts.onProgress?.(
          `  ${evaluation.success ? '✓' : '✗'} turns=${result.turns} ` +
            `tokens=${usage.total.totalTokens} cost=$${summary.estimatedCostUsd.toFixed(4)}`,
        );
        opts.onEvent?.({ type: 'run-end', summary });
        runIndex += 1;
      }
    }
  }

  const output: RunnerOutput = {
    config,
    runs,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  opts.onEvent?.({ type: 'done', output });
  return output;
}

export function summarize(output: RunnerOutput): FamilyAgentSummary[] {
  return summarizeByFamilyAndAgent(output.runs);
}
