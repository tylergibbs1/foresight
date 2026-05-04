import { ToolLoopAgent, hasToolCall, stepCountIs, tool } from 'ai';
import { LITE_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { extractUsage } from './proposer.ts';
import { toolSchemas, toolDescriptions, executors, type ToolName } from '../env/tools.ts';
import { diffEvents } from '../env/snapshot.ts';
import type { World } from '../env/world.ts';
import type { AgentRunResult, BaselineTurnRecord, UsageRecord } from './types.ts';
import type { TaskDef } from '../tasks/types.ts';

/**
 * Lite agent: a single `ToolLoopAgent` with the full typed-tool catalog
 * (including the `noop` sentinel) and a prompt that encodes the three safety
 * rules the scaffold's predictor/scorer were enforcing implicitly:
 *   1. read before mutating
 *   2. verify preconditions before applying
 *   3. emit `noop` when the right answer is "do nothing"
 *
 * No predictor, no scorer, no calibrator — one LLM call per turn.
 *
 * Termination: `stepCountIs(maxTurns)` OR `hasToolCall('noop')`.
 */
export interface LiteOptions {
  model: string;
  world: World;
  task: TaskDef;
  maxTurns: number;
  onTurn?: (rec: BaselineTurnRecord) => void;
}

export async function runLite(opts: LiteOptions): Promise<AgentRunResult> {
  const start = performance.now();
  const turnRecords: BaselineTurnRecord[] = [];
  let turnIdx = 0;

  const recorded = <Name extends ToolName>(name: Name) =>
    tool({
      description: toolDescriptions[name],
      inputSchema: toolSchemas[name],
      execute: async (args: any) => {
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
    instructions: LITE_PROMPT,
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
      noop: recorded('noop'),
    },
    stopWhen: [stepCountIs(opts.maxTurns), hasToolCall('noop')],
  });

  const usageRecords: UsageRecord[] = [];
  let stoppedReason: AgentRunResult['stoppedReason'] = 'goal-met';
  let errorMessage: string | null = null;

  try {
    const result = await agent.generate({ prompt: `Goal:\n${opts.task.goal}` });
    usageRecords.push(extractUsage('lite', result.usage));
    // If the agent declared done via the noop tool, mark it explicitly.
    const lastTool = turnRecords[turnRecords.length - 1]?.toolName;
    if (lastTool === 'noop') {
      stoppedReason = 'agent-declared-done';
    } else if (result.steps?.length === opts.maxTurns) {
      stoppedReason = 'max-turns';
    }
  } catch (e) {
    stoppedReason = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return {
    agent: 'lite',
    turns: turnRecords.length,
    totalUsage: usageRecords,
    baselineTurns: turnRecords,
    stoppedReason,
    errorMessage,
    wallClockMs: performance.now() - start,
  };
}
