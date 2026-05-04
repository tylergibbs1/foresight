import { describe, expect, test } from 'bun:test';
import { diffEvents } from '../src/diff.ts';

describe('diffEvents', () => {
  test('detects file create', () => {
    const events = diffEvents({}, { fs: { 'a.ts': 'hello' } });
    expect(events).toEqual([
      { target_type: 'file', target_id: 'a.ts', operation: 'create', field: null, before: null, after: 'hello' },
    ]);
  });

  test('detects file delete', () => {
    const events = diffEvents({ fs: { 'a.ts': 'x' } }, { fs: {} });
    expect(events).toEqual([
      { target_type: 'file', target_id: 'a.ts', operation: 'delete', field: null, before: null, after: null },
    ]);
  });

  test('detects file update', () => {
    const events = diffEvents({ fs: { 'a.ts': 'old' } }, { fs: { 'a.ts': 'new' } });
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      target_type: 'file', target_id: 'a.ts', operation: 'update', field: null, before: 'old', after: 'new',
    });
  });

  test('collapses delete + create with identical content into rename', () => {
    const events = diffEvents(
      { fs: { 'old.ts': 'X' } },
      { fs: { 'new.ts': 'X' } },
    );
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      target_type: 'file', target_id: 'new.ts', operation: 'rename', field: null, before: 'old.ts', after: 'new.ts',
    });
  });

  test('keeps delete + create separate when contents differ', () => {
    const events = diffEvents(
      { fs: { 'a.ts': 'X' } },
      { fs: { 'b.ts': 'Y' } },
    );
    expect(events.length).toBe(2);
    const ops = events.map(e => e.operation).sort();
    expect(ops).toEqual(['create', 'delete']);
  });

  test('detects record create', () => {
    const events = diffEvents(
      {},
      { crud: { users: { '1': { name: 'a' } } } },
    );
    expect(events.length).toBe(1);
    expect(events[0]?.target_type).toBe('record');
    expect(events[0]?.target_id).toBe('users/1');
    expect(events[0]?.operation).toBe('create');
  });

  test('record update emits one event per changed field', () => {
    const events = diffEvents(
      { crud: { users: { '1': { name: 'a', verified: false, tier: 'free' } } } },
      { crud: { users: { '1': { name: 'a', verified: true, tier: 'pro' } } } },
    );
    expect(events.length).toBe(2);
    const fields = events.map(e => e.field).sort();
    expect(fields).toEqual(['tier', 'verified']);
    for (const e of events) {
      expect(e.target_type).toBe('record');
      expect(e.target_id).toBe('users/1');
      expect(e.operation).toBe('update');
    }
  });

  test('record delete', () => {
    const events = diffEvents(
      { crud: { users: { '1': { name: 'a' } } } },
      { crud: { users: {} } },
    );
    expect(events.length).toBe(1);
    expect(events[0]?.operation).toBe('delete');
    expect(events[0]?.target_id).toBe('users/1');
  });

  test('empty diff', () => {
    const events = diffEvents(
      { fs: { 'a.ts': 'x' }, crud: { users: { '1': {} } } },
      { fs: { 'a.ts': 'x' }, crud: { users: { '1': {} } } },
    );
    expect(events).toEqual([]);
  });
});
