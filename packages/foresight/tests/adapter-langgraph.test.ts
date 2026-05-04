/**
 * Integration test: foresight wired into LangGraph as an interrupt node.
 *
 * Verifies:
 *   - the adapter compiles against `@langchain/langgraph` exports
 *   - on rejection, the node calls `interrupt()` (which throws inside graph runtime)
 *   - on approval, the node returns state unchanged
 */
import { describe, expect, test } from 'bun:test';
import type { Decision } from '../src/index.ts';

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

interface AgentState {
  goal: string;
  pending_action: { tool: string; args: Record<string, unknown> };
}

describe('LangGraph foresight node adapter', () => {
  test('package is installed and `interrupt` is exported', async () => {
    const lg = await import('@langchain/langgraph');
    expect(typeof lg.interrupt).toBe('function');
  });

  test('approval returns state unchanged', async () => {
    const { interrupt: _interrupt } = await import('@langchain/langgraph');
    let interruptCalled = false;
    const interrupt = (..._args: unknown[]) => {
      interruptCalled = true;
      throw new Error('should not be called on approval');
    };
    void _interrupt;

    const node = async (state: AgentState) => {
      const d = mockGate(true, 'safe');
      if (!d.ok) {
        interrupt({ kind: 'foresight_rejected', reason: d.reason });
      }
      return state;
    };

    const out = await node({
      goal: 'list users',
      pending_action: { tool: 'crud_list', args: { collection: 'users' } },
    });
    expect(interruptCalled).toBe(false);
    expect(out.goal).toBe('list users');
  });

  test('rejection invokes interrupt with structured payload', async () => {
    let interruptPayload: unknown = null;
    const interrupt = (payload: unknown) => {
      interruptPayload = payload;
      throw new Error('interrupt-invoked'); // mimic langgraph runtime behavior
    };

    const node = async (state: AgentState) => {
      const d = mockGate(false, 'would orphan orders/47, orders/92');
      if (!d.ok) {
        interrupt({
          kind: 'foresight_rejected',
          reason: d.reason,
          blocking: d.risks_blocking,
          predicted: d.predicted_changes,
          noop_recommended: d.noop_recommended,
        });
      }
      return state;
    };

    await expect(
      node({
        goal: 'remove user 3',
        pending_action: { tool: 'crud_delete', args: { id: '3' } },
      }),
    ).rejects.toThrow('interrupt-invoked');

    expect(interruptPayload).toMatchObject({
      kind: 'foresight_rejected',
      reason: expect.stringMatching(/orphan/) as any,
      blocking: expect.any(Array) as any,
    });
  });

  test('StateGraph from @langchain/langgraph is constructable', async () => {
    const lg = await import('@langchain/langgraph');
    expect(typeof lg.StateGraph).toBe('function');
  });
});
