import { describe, expect, test } from 'bun:test';
import { matchEvents, eventKey, type ChangeEvent } from '../src/index.ts';

const e = (
  target_id: string,
  op: ChangeEvent['operation'],
  field: string | null = null,
): ChangeEvent => ({
  target_type: target_id.includes('/') ? 'record' : 'file',
  target_id,
  operation: op,
  field,
  before: null,
  after: null,
});

describe('matchEvents', () => {
  test('both empty → f1 = 1 (correct noop prediction)', () => {
    const s = matchEvents([], []);
    expect(s.f1).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.predictedOnly).toEqual([]);
    expect(s.actualOnly).toEqual([]);
  });

  test('predicted empty, actual non-empty → f1 = 0', () => {
    const s = matchEvents([], [e('a.ts', 'create')]);
    expect(s.f1).toBe(0);
    expect(s.actualOnly.length).toBe(1);
  });

  test('predicted non-empty, actual empty → f1 = 0', () => {
    const s = matchEvents([e('a.ts', 'create')], []);
    expect(s.f1).toBe(0);
    expect(s.predictedOnly.length).toBe(1);
  });

  test('exact match on canonical key → f1 = 1', () => {
    const ev = e('a.ts', 'create');
    const s = matchEvents([ev], [ev]);
    expect(s.f1).toBe(1);
    expect(s.predictedOnly).toEqual([]);
    expect(s.actualOnly).toEqual([]);
  });

  test('underprediction caps recall', () => {
    const s = matchEvents(
      [e('a.ts', 'create')],
      [e('a.ts', 'create'), e('b.ts', 'create')],
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.f1).toBeCloseTo(2 / 3);
    expect(s.actualOnly.length).toBe(1);
  });

  test('overprediction caps precision', () => {
    const s = matchEvents(
      [e('a.ts', 'create'), e('z.ts', 'create')],
      [e('a.ts', 'create')],
    );
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(1);
    expect(s.f1).toBeCloseTo(2 / 3);
    expect(s.predictedOnly.length).toBe(1);
  });

  test('field-level updates match independently', () => {
    const s = matchEvents(
      [e('users/1', 'update', 'granted')],
      [e('users/1', 'update', 'granted'), e('users/1', 'update', 'tier')],
    );
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  test('canonical key tracks operation and target', () => {
    expect(eventKey(e('a.ts', 'create'))).not.toBe(eventKey(e('a.ts', 'delete')));
    expect(eventKey(e('a.ts', 'create'))).not.toBe(eventKey(e('b.ts', 'create')));
    expect(eventKey(e('users/1', 'update', 'granted'))).not.toBe(
      eventKey(e('users/1', 'update', 'tier')),
    );
  });

  test('truePositive count is exact intersection size', () => {
    const s = matchEvents(
      [e('a.ts', 'create'), e('b.ts', 'create'), e('z.ts', 'delete')],
      [e('a.ts', 'create'), e('b.ts', 'create')],
    );
    expect(s.truePositive).toBe(2);
    expect(s.predictedCount).toBe(3);
    expect(s.actualCount).toBe(2);
  });
});
