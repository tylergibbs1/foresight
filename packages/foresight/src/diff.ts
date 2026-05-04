/**
 * Optional helper: compute typed `ChangeEvent[]` from before/after snapshots
 * of the canonical `WorldState` shape. Use this if your domain naturally maps
 * to files + CRUD records. If your domain is different, write your own diff
 * that emits `ChangeEvent[]`.
 *
 * Imported as `foresight/diff` to keep it out of the default surface.
 */
import type { ChangeEvent, WorldState } from './types.ts';

export function diffEvents(before: WorldState, after: WorldState): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  // ── files ──
  const beforeFs = before.fs ?? {};
  const afterFs = after.fs ?? {};
  const fsKeys = new Set([...Object.keys(beforeFs), ...Object.keys(afterFs)]);

  // First pass: detect rename pairs (delete + create with identical content)
  const usedDel = new Set<string>();
  const usedCre = new Set<string>();
  for (const path of fsKeys) {
    const b = beforeFs[path];
    const a = afterFs[path];
    if (b !== undefined && a === undefined) {
      // candidate delete; look for create with same content
      const match = Object.entries(afterFs).find(
        ([p2, c2]) => beforeFs[p2] === undefined && c2 === b && !usedCre.has(p2),
      );
      if (match) {
        const [newPath] = match;
        usedDel.add(path);
        usedCre.add(newPath);
        events.push({
          target_type: 'file',
          target_id: newPath,
          operation: 'rename',
          field: null,
          before: path,
          after: newPath,
        });
      }
    }
  }

  // Second pass: remaining file changes
  for (const path of fsKeys) {
    const b = beforeFs[path];
    const a = afterFs[path];
    if (b === undefined && a !== undefined && !usedCre.has(path)) {
      events.push({ target_type: 'file', target_id: path, operation: 'create', field: null, before: null, after: a });
    } else if (b !== undefined && a === undefined && !usedDel.has(path)) {
      events.push({ target_type: 'file', target_id: path, operation: 'delete', field: null, before: null, after: null });
    } else if (b !== undefined && a !== undefined && b !== a) {
      events.push({ target_type: 'file', target_id: path, operation: 'update', field: null, before: b, after: a });
    }
  }

  // ── records ──
  const beforeCrud = before.crud ?? {};
  const afterCrud = after.crud ?? {};
  const collections = new Set([...Object.keys(beforeCrud), ...Object.keys(afterCrud)]);
  for (const coll of collections) {
    const b = beforeCrud[coll] ?? {};
    const a = afterCrud[coll] ?? {};
    const ids = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const id of ids) {
      const target_id = `${coll}/${id}`;
      const br = b[id];
      const ar = a[id];
      if (!br && ar) {
        events.push({ target_type: 'record', target_id, operation: 'create', field: null, before: null, after: JSON.stringify(ar) });
      } else if (br && !ar) {
        events.push({ target_type: 'record', target_id, operation: 'delete', field: null, before: null, after: null });
      } else if (br && ar && JSON.stringify(br) !== JSON.stringify(ar)) {
        const keys = new Set([...Object.keys(br), ...Object.keys(ar)]);
        for (const k of keys) {
          const bv = JSON.stringify(br[k] ?? null);
          const av = JSON.stringify(ar[k] ?? null);
          if (bv !== av) {
            events.push({ target_type: 'record', target_id, operation: 'update', field: k, before: bv, after: av });
          }
        }
      }
    }
  }

  return events;
}
