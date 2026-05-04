/**
 * `gated` agent variant — the head-to-head test for the published foresight
 * library.
 *
 * Architecture: a vanilla `ToolLoopAgent` (no proposer/predictor/scorer/
 * calibrator orchestration) where every MUTATION tool call is pre-checked by
 * `foresight.gate()`. Read-only tool calls bypass the gate.
 *
 * Rejection path: the wrapped tool's `execute` returns a structured error
 * (`{ rejected: true, reason, blocking }`) instead of throwing. The agent's
 * LLM sees the error in its tool result and can react: pick a different
 * action, gather more state, or stop.
 *
 * This is the apples-to-apples comparison against `baseline` — same agent,
 * same model, same tool catalog, only difference is the foresight gate
 * sitting in front of the destructive calls.
 */
import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { BASELINE_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { extractUsage } from './proposer.ts';
import { toolSchemas, toolDescriptions, executors, toolCatalog } from '../env/tools.ts';
import { diff, diffEvents } from '../env/snapshot.ts';
import type { World } from '../env/world.ts';
import type { AgentRunResult, BaselineTurnRecord, UsageRecord } from './types.ts';
import type { TaskDef } from '../tasks/types.ts';
import { foresight } from '../../packages/foresight/src/index.ts';

const MUTATION_TOOLS = new Set([
  'write_file',
  'delete_file',
  'move_file',
  'crud_create',
  'crud_update',
  'crud_delete',
]);

export interface GatedOptions {
  model: string;
  world: World;
  task: TaskDef;
  maxTurns: number;
  /** Streaming callback for live UIs. Called after each tool execution. */
  onTurn?: (rec: BaselineTurnRecord) => void;
  /** Optional override for the foresight gate model. Defaults to opts.model. */
  gateModel?: string;
}

export async function runGated(opts: GatedOptions): Promise<AgentRunResult> {
  const start = performance.now();
  const turnRecords: BaselineTurnRecord[] = [];
  const gateUsage: UsageRecord[] = [];
  let turnIdx = 0;
  const catalog = toolCatalog();
  const gateModelInstance = resolveModel(opts.gateModel ?? opts.model) as any;

  const recorded = <Name extends keyof typeof toolSchemas>(name: Name) =>
    tool({
      description: toolDescriptions[name],
      inputSchema: toolSchemas[name],
      execute: async (args: any) => {
        // Read-only tools and noop bypass the gate.
        if (!MUTATION_TOOLS.has(name)) {
          const before = opts.world.snapshot();
          const result = await executors[name](opts.world, args);
          const after = opts.world.snapshot();
          const rec: BaselineTurnRecord = {
            turn: turnIdx++,
            toolName: name,
            args,
            before,
            after,
            events: diffEvents(before, after),
          };
          turnRecords.push(rec);
          opts.onTurn?.(rec);
          void diff;
          return result;
        }

        // Mutation tool — run foresight.gate first.
        const stateSnapshot = opts.world.snapshot();
        const decision = await foresight.gate({
          goal: opts.task.goal,
          action: { tool: name, args },
          state: stateSnapshot,
          catalog,
          model: gateModelInstance,
          skipNote: true, // not persisting across runs in this eval
        });
        gateUsage.push({
          role: 'foresight_gate',
          promptTokens: decision.usage.promptTokens,
          completionTokens: decision.usage.completionTokens,
          totalTokens: decision.usage.totalTokens,
        });

        if (!decision.ok) {
          // Don't mutate the world. Return a structured error to the agent.
          // The agent's LLM sees this in the next step and can replan.
          const rec: BaselineTurnRecord = {
            turn: turnIdx++,
            toolName: name,
            args,
            before: stateSnapshot,
            after: stateSnapshot, // unchanged — gate blocked
            events: [],
          };
          turnRecords.push(rec);
          opts.onTurn?.(rec);
          return {
            error: 'rejected by foresight gate',
            reason: decision.reason,
            blocking: decision.risks_blocking,
            noop_recommended: decision.noop_recommended,
          };
        }

        // Approved — run the actual tool.
        const before = opts.world.snapshot();
        const result = await executors[name](opts.world, args);
        const after = opts.world.snapshot();
        const rec: BaselineTurnRecord = {
          turn: turnIdx++,
          toolName: name,
          args,
          before,
          after,
          events: diffEvents(before, after),
        };
        turnRecords.push(rec);
        opts.onTurn?.(rec);
        return result;
      },
    });

  const agent = new ToolLoopAgent({
    model: resolveModel(opts.model),
    instructions: BASELINE_PROMPT,
    tools: {
      read_file: recorded('read_file'),
      write_file: recorded('write_file'),
      delete_file: recorded('delete_file'),
      move_file: recorded('move_file'),
      list_files: recorded('list_files'),
      crud_list: recorded('crud_list'),
      crud_get: recorded('crud_get'),
      crud_create: recorded('crud_create'),
      crud_update: recorded('crud_update'),
      crud_delete: recorded('crud_delete'),
    },
    stopWhen: stepCountIs(opts.maxTurns),
  });

  const usageRecords: UsageRecord[] = [];
  let stoppedReason: AgentRunResult['stoppedReason'] = 'goal-met';
  let errorMessage: string | null = null;

  try {
    const result = await agent.generate({ prompt: `Goal:\n${opts.task.goal}` });
    usageRecords.push(extractUsage('gated_agent', result.usage));
    if (result.steps?.length === opts.maxTurns) stoppedReason = 'max-turns';
  } catch (e) {
    stoppedReason = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return {
    agent: 'gated',
    turns: turnRecords.length,
    totalUsage: [...usageRecords, ...gateUsage],
    baselineTurns: turnRecords,
    stoppedReason,
    errorMessage,
    wallClockMs: performance.now() - start,
  };
}
