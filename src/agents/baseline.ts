import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { BASELINE_PROMPT, THINKING_BASELINE_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { extractUsage } from './proposer.ts';
import { toolSchemas, toolDescriptions, executors } from '../env/tools.ts';
import { diff, diffEvents } from '../env/snapshot.ts';
import type { World } from '../env/world.ts';
import type { AgentName, AgentRunResult, BaselineTurnRecord, UsageRecord } from './types.ts';
import type { TaskDef } from '../tasks/types.ts';

export interface BaselineOptions {
  model: string;
  world: World;
  task: TaskDef;
  maxTurns: number;
  /**
   * 'baseline' = vanilla prompt, no extra reasoning encouragement.
   * 'thinking' = same model, same tools, prompt instructs explicit
   * pre-action deliberation. Token-budget control for the scaffold.
   */
  variant: 'baseline' | 'thinking';
  /** Streaming callback for live UIs. Called after each tool execution. */
  onTurn?: (rec: BaselineTurnRecord) => void;
}

export async function runBaseline(opts: BaselineOptions): Promise<AgentRunResult> {
  const start = performance.now();
  const turnRecords: BaselineTurnRecord[] = [];
  let turnIdx = 0;

  const recorded = <Name extends keyof typeof toolSchemas>(name: Name) =>
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
        // diff() exists for callers that want raw changes; reference it to keep
        // the import live for downstream consumers.
        void diff;
        return result;
      },
    });

  const agent = new ToolLoopAgent({
    model: resolveModel(opts.model),
    instructions: opts.variant === 'thinking' ? THINKING_BASELINE_PROMPT : BASELINE_PROMPT,
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
    const result = await agent.generate({
      prompt: `Goal:\n${opts.task.goal}`,
    });
    usageRecords.push(extractUsage(opts.variant, result.usage));
    if (result.steps?.length === opts.maxTurns) stoppedReason = 'max-turns';
  } catch (e) {
    stoppedReason = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return {
    agent: opts.variant satisfies AgentName,
    turns: turnRecords.length,
    totalUsage: usageRecords,
    baselineTurns: turnRecords,
    stoppedReason,
    errorMessage,
    wallClockMs: performance.now() - start,
  };
}
