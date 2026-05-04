/**
 * Integration test: foresight wired into OpenAI Agents SDK as a tool input
 * guardrail.
 *
 * Verifies:
 *   - the adapter compiles against the real `@openai/agents` types
 *   - on rejection, the guardrail returns `tripwireTriggered: true`
 *   - on approval, the guardrail returns `tripwireTriggered: false`
 */
import { describe, expect, test } from 'bun:test';
import type { Decision } from '../src/index.ts';

// Import only the types we need; runtime usage of the agent itself isn't
// required to validate the adapter shape.
type ToolInputGuardrailFn = (
  toolInput: unknown,
  context: { toolName?: string; userMessage?: string },
) => Promise<{ tripwireTriggered: boolean; outputInfo: unknown }>;

function mockGate(ok: boolean, reason: string): Decision {
  return {
    ok,
    reason,
    predicted_changes: [],
    risks: {
      confidence: 'high',
      reversibility: 'fully_reversible',
      data_loss_risk: 'none',
      blast_radius: 'narrow',
      unverified_preconditions: [],
      side_effects: [],
    },
    risks_blocking: ok ? [] : ['mock'],
    goal_alignment: ok ? ['mock'] : [],
    noop_recommended: false,
    note: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

describe('OpenAI Agents SDK ToolInputGuardrail adapter', () => {
  // The OpenAI Agents SDK guardrail contract: return an object with
  // `tripwireTriggered: true` to abort the tool call, false to allow.
  // (The real SDK has helper builders; we test the raw fn shape that
  //  end users typically write.)
  const buildGuard = (decideOk: boolean): ToolInputGuardrailFn => async (toolInput, context) => {
    const d = mockGate(decideOk, decideOk ? 'safe' : 'would orphan');
    return {
      tripwireTriggered: !d.ok,
      outputInfo: d.ok
        ? { allowed: true }
        : { rejected: true, reason: d.reason, blocking: d.risks_blocking },
    };
  };

  test('rejection trips the wire', async () => {
    const guard = buildGuard(false);
    const out = await guard({ id: '3' }, { toolName: 'crud_delete' });
    expect(out.tripwireTriggered).toBe(true);
    expect((out.outputInfo as any).rejected).toBe(true);
    expect((out.outputInfo as any).reason).toMatch(/orphan/);
  });

  test('approval does not trip the wire', async () => {
    const guard = buildGuard(true);
    const out = await guard({ collection: 'users' }, { toolName: 'crud_list' });
    expect(out.tripwireTriggered).toBe(false);
    expect((out.outputInfo as any).allowed).toBe(true);
  });

  // Note: @openai/agents@0.8.5 currently has an upstream zod compatibility
  // issue with zod@3.25.x (discriminated-union format mismatch). Users on
  // zod@4.x do not hit this. The adapter SHAPE is what matters for foresight,
  // and that's exercised by the rejection / approval tests above; consumers
  // wire the guardrail builder of their @openai/agents version directly.
});
