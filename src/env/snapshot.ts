import type { Change, ChangeEvent, WorldSnapshot } from './types.ts';
import { canonicalizeWithSnapshots } from './types.ts';

export function diff(before: WorldSnapshot, after: WorldSnapshot): Change[] {
  const changes: Change[] = [];

  const fsKeys = new Set([...Object.keys(before.fs), ...Object.keys(after.fs)]);
  for (const path of fsKeys) {
    const b = before.fs[path];
    const a = after.fs[path];
    if (b === undefined && a !== undefined) {
      changes.push({ kind: 'fs.create', path, content: a });
    } else if (b !== undefined && a === undefined) {
      changes.push({ kind: 'fs.delete', path });
    } else if (b !== undefined && a !== undefined && b !== a) {
      changes.push({ kind: 'fs.modify', path, before: b, after: a });
    }
  }

  const colls = new Set([...Object.keys(before.crud), ...Object.keys(after.crud)]);
  for (const coll of colls) {
    const b = before.crud[coll] ?? {};
    const a = after.crud[coll] ?? {};
    const ids = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const id of ids) {
      const br = b[id];
      const ar = a[id];
      if (!br && ar) {
        changes.push({ kind: 'crud.create', collection: coll, id, record: ar });
      } else if (br && !ar) {
        changes.push({ kind: 'crud.delete', collection: coll, id });
      } else if (br && ar && JSON.stringify(br) !== JSON.stringify(ar)) {
        changes.push({ kind: 'crud.update', collection: coll, id, before: br, after: ar });
      }
    }
  }

  return changes;
}

export function diffEvents(before: WorldSnapshot, after: WorldSnapshot): ChangeEvent[] {
  return canonicalizeWithSnapshots(before, after, diff(before, after));
}

export function snapshotEquals(a: WorldSnapshot, b: WorldSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
