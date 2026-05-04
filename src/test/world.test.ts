import { describe, expect, test } from 'bun:test';
import { World } from '../env/world.ts';
import { diff } from '../env/snapshot.ts';
import { executeChosen, makeTools } from '../env/tools.ts';

describe('World fs', () => {
  test('write/read/move/delete', () => {
    const w = new World();
    w.writeFile('a.ts', 'hello');
    expect(w.readFile('a.ts')).toBe('hello');
    w.moveFile('a.ts', 'b.ts');
    expect(w.hasFile('a.ts')).toBe(false);
    expect(w.readFile('b.ts')).toBe('hello');
    w.deleteFile('b.ts');
    expect(w.hasFile('b.ts')).toBe(false);
  });

  test('moveFile fails on missing source or existing destination', () => {
    const w = new World();
    expect(() => w.moveFile('x', 'y')).toThrow();
    w.writeFile('x', '1');
    w.writeFile('y', '2');
    expect(() => w.moveFile('x', 'y')).toThrow();
  });
});

describe('World crud', () => {
  test('create/get/update/delete', () => {
    const w = new World();
    w.crudCreate('users', '1', { name: 'a', verified: true });
    expect(w.crudGet('users', '1').name).toBe('a');
    w.crudUpdate('users', '1', { granted: true });
    expect(w.crudGet('users', '1').granted).toBe(true);
    expect(w.crudGet('users', '1').name).toBe('a');
    w.crudDelete('users', '1');
    expect(w.crudHas('users', '1')).toBe(false);
  });
});

describe('snapshot diff', () => {
  test('detects fs and crud changes', () => {
    const w = new World();
    w.writeFile('a', '1');
    w.crudCreate('c', 'x', { v: 1 });
    const before = w.snapshot();
    w.writeFile('b', '2');
    w.deleteFile('a');
    w.crudUpdate('c', 'x', { v: 2 });
    const after = w.snapshot();
    const d = diff(before, after);
    const kinds = d.map(c => c.kind).sort();
    expect(kinds).toEqual(['crud.update', 'fs.create', 'fs.delete']);
  });
});

describe('executeChosen', () => {
  test('runs a tool by name and arg map', async () => {
    const w = new World();
    await executeChosen(w, 'write_file', { path: 'a.ts', content: 'x' });
    expect(w.readFile('a.ts')).toBe('x');
  });

  test('rejects unknown tool', async () => {
    const w = new World();
    await expect(executeChosen(w, 'no_such_tool', {})).rejects.toThrow();
  });

  test('parses crud_update patch_json', async () => {
    const w = new World();
    w.crudCreate('users', '1', { name: 'a' });
    await executeChosen(w, 'crud_update', {
      collection: 'users',
      id: '1',
      patch_json: '{"granted":true}',
    });
    expect(w.crudGet('users', '1').granted).toBe(true);
  });

  test('makeTools produces a fixed catalog', () => {
    const w = new World();
    const tools = makeTools(w);
    expect(Object.keys(tools).sort()).toEqual([
      'crud_create',
      'crud_delete',
      'crud_get',
      'crud_list',
      'crud_update',
      'delete_file',
      'list_files',
      'move_file',
      'read_file',
      'write_file',
    ]);
  });
});
