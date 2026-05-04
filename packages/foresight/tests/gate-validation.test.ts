import { describe, expect, test } from 'bun:test';
import { gate, ForesightInputError } from '../src/index.ts';

const dummyModel = {} as any;

describe('gate input validation', () => {
  test('rejects empty goal', async () => {
    await expect(
      gate({
        goal: '',
        action: { tool: 'x', args: {} },
        state: {},
        catalog: [{ name: 'x', description: 'x', args: '{}' }],
        model: dummyModel,
      }),
    ).rejects.toBeInstanceOf(ForesightInputError);
  });

  test('rejects empty tool name', async () => {
    await expect(
      gate({
        goal: 'do thing',
        action: { tool: '', args: {} },
        state: {},
        catalog: [{ name: 'x', description: 'x', args: '{}' }],
        model: dummyModel,
      }),
    ).rejects.toBeInstanceOf(ForesightInputError);
  });

  test('rejects empty catalog', async () => {
    await expect(
      gate({
        goal: 'do thing',
        action: { tool: 'x', args: {} },
        state: {},
        catalog: [],
        model: dummyModel,
      }),
    ).rejects.toBeInstanceOf(ForesightInputError);
  });

  test('error message includes the offending field', async () => {
    try {
      await gate({
        goal: '',
        action: { tool: 'x', args: {} },
        state: {},
        catalog: [{ name: 'x', description: 'x', args: '{}' }],
        model: dummyModel,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ForesightInputError);
      expect((e as Error).message).toMatch(/goal/i);
      return;
    }
    throw new Error('expected throw');
  });

  test('rejects pre-aborted signal before any LLM call', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      gate({
        goal: 'do thing',
        action: { tool: 'x', args: {} },
        state: {},
        catalog: [{ name: 'x', description: 'x', args: '{}' }],
        model: dummyModel,
        signal: ac.signal,
      }),
    ).rejects.toThrow(/aborted/i);
  });
});
