export type FsState = Record<string, string>;
export type CrudState = Record<string, Record<string, Record<string, unknown>>>;

export interface WorldSnapshot {
  fs: FsState;
  crud: CrudState;
}

/** Raw, low-level diff entry produced by snapshot.ts. */
export type Change =
  | { kind: 'fs.create'; path: string; content: string }
  | { kind: 'fs.delete'; path: string }
  | { kind: 'fs.modify'; path: string; before: string; after: string }
  | { kind: 'crud.create'; collection: string; id: string; record: Record<string, unknown> }
  | { kind: 'crud.update'; collection: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: 'crud.delete'; collection: string; id: string };

/**
 * Canonical, structured event used for predictor output AND for matching
 * against the actual world diff. The canonical key
 * `${target_type}:${target_id}:${operation}:${field ?? ''}` is what the
 * F1 metric matches on.
 */
export interface ChangeEvent {
  target_type: 'file' | 'record';
  /** For files: path. For records: `${collection}/${id}`. */
  target_id: string;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'noop';
  /** For record updates, the field that changed. null otherwise. */
  field: string | null;
  /** Stringified prior value. For renames: the previous path. */
  before: string | null;
  /** Stringified resulting value. For renames: the new path (== target_id). */
  after: string | null;
}

export function eventKey(e: ChangeEvent): string {
  return `${e.target_type}:${e.target_id}:${e.operation}:${e.field ?? ''}`;
}

/**
 * Canonicalize a raw diff into ChangeEvents. Pairs an `fs.create` and
 * `fs.delete` with identical content into a single `rename` event so that the
 * predictor can emit one rename instead of having to predict a delete+create
 * pair.
 *
 * crud.update with N changed fields produces N events (one per field), so the
 * F1 score reflects per-field correctness.
 */
export function canonicalizeChanges(changes: Change[]): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  // Note: rename detection requires the before-snapshot; see
  // canonicalizeWithSnapshots for that. This base function leaves
  // delete+create pairs as two separate events.

  for (const c of changes) {
    switch (c.kind) {
      case 'fs.create':
        events.push({ target_type: 'file', target_id: c.path, operation: 'create', field: null, before: null, after: c.content });
        break;
      case 'fs.delete':
        events.push({ target_type: 'file', target_id: c.path, operation: 'delete', field: null, before: null, after: null });
        break;
      case 'fs.modify':
        events.push({ target_type: 'file', target_id: c.path, operation: 'update', field: null, before: c.before, after: c.after });
        break;
      case 'crud.create':
        events.push({ target_type: 'record', target_id: `${c.collection}/${c.id}`, operation: 'create', field: null, before: null, after: JSON.stringify(c.record) });
        break;
      case 'crud.delete':
        events.push({ target_type: 'record', target_id: `${c.collection}/${c.id}`, operation: 'delete', field: null, before: null, after: null });
        break;
      case 'crud.update': {
        const tid = `${c.collection}/${c.id}`;
        const keys = new Set([...Object.keys(c.before), ...Object.keys(c.after)]);
        let any = false;
        for (const k of keys) {
          const b = JSON.stringify(c.before[k] ?? null);
          const a = JSON.stringify(c.after[k] ?? null);
          if (b !== a) {
            events.push({ target_type: 'record', target_id: tid, operation: 'update', field: k, before: b, after: a });
            any = true;
          }
        }
        if (!any) {
          events.push({ target_type: 'record', target_id: tid, operation: 'noop', field: null, before: null, after: null });
        }
        break;
      }
    }
  }

  return events;
}

/**
 * Smarter canonicalization that uses the before-snapshot to pair delete+create
 * pairs of identical content into a single rename event.
 */
export function canonicalizeWithSnapshots(
  before: WorldSnapshot,
  after: WorldSnapshot,
  changes: Change[],
): ChangeEvent[] {
  const events = canonicalizeChanges(changes);
  // Look for delete/create pairs we can collapse.
  const deleted = events.filter(e => e.target_type === 'file' && e.operation === 'delete');
  const created = events.filter(e => e.target_type === 'file' && e.operation === 'create');
  if (deleted.length === 0 || created.length === 0) return events;

  const collapsed: ChangeEvent[] = [];
  const usedDel = new Set<string>();
  const usedCre = new Set<string>();

  for (const d of deleted) {
    const oldContent = before.fs[d.target_id];
    if (oldContent === undefined) continue;
    const match = created.find(
      c => !usedCre.has(c.target_id) && after.fs[c.target_id] === oldContent,
    );
    if (match) {
      usedDel.add(d.target_id);
      usedCre.add(match.target_id);
      collapsed.push({
        target_type: 'file',
        target_id: match.target_id,
        operation: 'rename',
        field: null,
        before: d.target_id,
        after: match.target_id,
      });
    }
  }

  const remaining = events.filter(e => {
    if (e.target_type !== 'file') return true;
    if (e.operation === 'delete' && usedDel.has(e.target_id)) return false;
    if (e.operation === 'create' && usedCre.has(e.target_id)) return false;
    return true;
  });
  return [...remaining, ...collapsed];
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case 'fs.create': return `created file ${c.path}`;
    case 'fs.delete': return `deleted file ${c.path}`;
    case 'fs.modify': return `modified file ${c.path}`;
    case 'crud.create': return `created ${c.collection}/${c.id}`;
    case 'crud.update': return `updated ${c.collection}/${c.id}`;
    case 'crud.delete': return `deleted ${c.collection}/${c.id}`;
  }
}

export function describeEvent(e: ChangeEvent): string {
  switch (e.operation) {
    case 'create': return `create ${e.target_type} ${e.target_id}`;
    case 'delete': return `delete ${e.target_type} ${e.target_id}`;
    case 'rename': return `rename ${e.before} -> ${e.after}`;
    case 'update':
      return e.field
        ? `update ${e.target_type} ${e.target_id} field ${e.field}: ${e.before} -> ${e.after}`
        : `update ${e.target_type} ${e.target_id}`;
    case 'noop': return `no observable change to ${e.target_type} ${e.target_id}`;
  }
}
