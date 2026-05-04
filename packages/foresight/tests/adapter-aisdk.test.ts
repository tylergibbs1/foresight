/**
 * Integration test: foresight wired into Vercel AI SDK 6's `needsApproval`.
 *
 * Verifies:
 *   - the adapter typechecks against `tool()` from `ai`
 *   - on rejection, `needsApproval` returns true (block / require approval)
 *   - on approval, `needsApproval` returns false (proceed automatically)
 */
import { describe, expect, test } from 'bun:test';
import { tool } from 'ai';
import { z } from 'zod';
import type { Decision } from '../src/index.ts';

// Mock the gate so we don't need an API key in this test. The shape must
// match what the real `gate()` returns; if the real Decision type changes,
// this test will fail to compile.
function mockGate(decision: Pick<Decision, 'ok' | 'reason'>): Decision {
  return {
    ok: decision.ok,
    reason: decision.reason,
    predicted_changes: [],
    risks: {
      confidence: 'high',
      reversibility: 'fully_reversible',
      data_loss_risk: 'none',
      blast_radius: 'narrow',
      unverified_preconditions: [],
      side_effects: [],
    },
    risks_blocking: decision.ok ? [] : ['mock reject'],
    goal_alignment: decision.ok ? ['mock approve'] : [],
    noop_recommended: false,
    note: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

describe('AI SDK 6 needsApproval adapter', () => {
  test('rejection returns true (block / require approval)', async () => {
    let capturedArgs: unknown = null;
    const t = tool({
      description: 'delete a record',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: async (args, _ctx) => {
        capturedArgs = args;
        const d = mockGate({ ok: false, reason: 'would orphan deps' });
        return !d.ok; // standard adapter shape
      },
      execute: async () => ({ ok: true }),
    });

    // Call the needsApproval handler directly with the AI SDK's expected shape.
    expect(typeof t.needsApproval).toBe('function');
    const fn = t.needsApproval as (args: any, ctx: any) => Promise<boolean>;
    const result = await fn({ id: '3' }, {} as any);
    expect(result).toBe(true);
    expect(capturedArgs).toEqual({ id: '3' });
  });

  test('approval returns false (auto-proceed)', async () => {
    const t = tool({
      description: 'list records',
      inputSchema: z.object({ collection: z.string() }),
      needsApproval: async () => {
        const d = mockGate({ ok: true, reason: 'safe read' });
        return !d.ok;
      },
      execute: async () => [],
    });

    const fn = t.needsApproval as (args: any, ctx: any) => Promise<boolean>;
    expect(await fn({ collection: 'users' }, {} as any)).toBe(false);
  });

  test('the tool itself is well-formed for ToolLoopAgent / generateText', () => {
    const t = tool({
      description: 'demo',
      inputSchema: z.object({ x: z.string() }),
      needsApproval: async () => false,
      execute: async ({ x }) => x,
    });
    // these are the surface bits AI SDK 6 actually consumes
    expect(t.description).toBe('demo');
    expect(typeof t.execute).toBe('function');
    expect(t.inputSchema).toBeDefined();
  });
});
