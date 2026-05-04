import { describe, expect, test } from 'bun:test';
import { World } from '../env/world.ts';
import { diff, diffEvents } from '../env/snapshot.ts';
import { canonicalizeChanges, eventKey, type ChangeEvent } from '../env/types.ts';
import { predictionF1 } from '../agents/calibrator.ts';
import { dedupe, validate } from '../agents/validator.ts';

describe('canonicalize diff -> events', () => {
  test('crud.update with two changed fields produces two events', () => {
    const w = new World();
    w.crudCreate('users', '1', { name: 'a', verified: false, tier: 'free' });
    const before = w.snapshot();
    w.crudUpdate('users', '1', { verified: true, tier: 'pro' });
    const after = w.snapshot();
    const events = diffEvents(before, after);
    expect(events.length).toBe(2);
    const fields = events.map(e => e.field).sort();
    expect(fields).toEqual(['tier', 'verified']);
    for (const e of events) {
      expect(e.target_type).toBe('record');
      expect(e.target_id).toBe('users/1');
      expect(e.operation).toBe('update');
    }
  });

  test('fs delete + create with identical content collapses into rename', () => {
    const w = new World();
    w.writeFile('src/old_a.ts', 'X');
    const before = w.snapshot();
    w.moveFile('src/old_a.ts', 'src/new_a.ts');
    const after = w.snapshot();
    const events = diffEvents(before, after);
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      target_type: 'file',
      target_id: 'src/new_a.ts',
      operation: 'rename',
      field: null,
      before: 'src/old_a.ts',
      after: 'src/new_a.ts',
    });
  });

  test('fs delete + create with different content stays as two events', () => {
    const w = new World();
    w.writeFile('a.ts', 'X');
    const before = w.snapshot();
    w.deleteFile('a.ts');
    w.writeFile('b.ts', 'Y');
    const after = w.snapshot();
    const events = diffEvents(before, after);
    expect(events.length).toBe(2);
  });

  test('canonicalizeChanges (snapshot-free) leaves delete+create as separate', () => {
    const changes = [
      { kind: 'fs.delete', path: 'a.ts' },
      { kind: 'fs.create', path: 'b.ts', content: 'X' },
    ] as const;
    const events = canonicalizeChanges(changes as never);
    expect(events.length).toBe(2);
  });
});

describe('predictionF1', () => {
  const e = (target_id: string, op: ChangeEvent['operation'], field: string | null = null): ChangeEvent => ({
    target_type: target_id.includes('/') ? 'record' : 'file',
    target_id,
    operation: op,
    field,
    before: null,
    after: null,
  });

  test('both empty -> f1 = 1', () => {
    const s = predictionF1([], []);
    expect(s.f1).toBe(1);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });

  test('predicted empty, actual non-empty -> f1 = 0', () => {
    const s = predictionF1([], [e('a.ts', 'create')]);
    expect(s.f1).toBe(0);
  });

  test('predicted non-empty, actual empty -> f1 = 0', () => {
    const s = predictionF1([e('a.ts', 'create')], []);
    expect(s.f1).toBe(0);
  });

  test('exact match on canonical key -> f1 = 1', () => {
    const ev = e('a.ts', 'create');
    const s = predictionF1([ev], [ev]);
    expect(s.f1).toBe(1);
  });

  test('underprediction caps recall', () => {
    const s = predictionF1(
      [e('a.ts', 'create')],
      [e('a.ts', 'create'), e('b.ts', 'create')],
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.f1).toBeCloseTo(2 / 3);
  });

  test('overprediction caps precision', () => {
    const s = predictionF1(
      [e('a.ts', 'create'), e('z.ts', 'create')],
      [e('a.ts', 'create')],
    );
    expect(s.precision).toBe(0.5);
    expect(s.recall).toBe(1);
    expect(s.f1).toBeCloseTo(2 / 3);
  });

  test('field-level updates match independently', () => {
    const s = predictionF1(
      [e('users/1', 'update', 'granted')],
      [e('users/1', 'update', 'granted'), e('users/1', 'update', 'tier')],
    );
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  test('canonical key tracks operation', () => {
    expect(eventKey(e('a.ts', 'create'))).not.toBe(eventKey(e('a.ts', 'delete')));
  });
});

describe('validator', () => {
  test('rejects unknown tool', () => {
    const v = validate({ tool: 'no_such', args: {}, rationale: '' });
    expect(v.ok).toBe(false);
  });

  test('rejects mismatched args', () => {
    const v = validate({ tool: 'write_file', args: { path: 'a.ts' }, rationale: '' });
    expect(v.ok).toBe(false);
  });

  test('accepts valid args', () => {
    const v = validate({ tool: 'write_file', args: { path: 'a.ts', content: 'X' }, rationale: '' });
    expect(v.ok).toBe(true);
  });
});

describe('dedupe', () => {
  test('collapses semantically identical candidates', () => {
    const out = dedupe([
      { tool: 'write_file', args: { path: 'a', content: 'X' }, rationale: '1' },
      { tool: 'write_file', args: { content: 'X', path: 'a' }, rationale: '2' },
      { tool: 'write_file', args: { path: 'b', content: 'X' }, rationale: '3' },
    ]);
    expect(out.length).toBe(2);
  });
});

// Keep diff() functional for raw-change consumers.
describe('diff still produces raw changes', () => {
  test('counts kinds', () => {
    const w = new World();
    w.writeFile('a', '1');
    const before = w.snapshot();
    w.writeFile('b', '2');
    const after = w.snapshot();
    expect(diff(before, after).map(c => c.kind)).toEqual(['fs.create']);
  });
});
