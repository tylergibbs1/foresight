import type { FsState, CrudState, WorldSnapshot } from './types.ts';

export class World {
  private fs: Map<string, string> = new Map();
  private crud: Map<string, Map<string, Record<string, unknown>>> = new Map();

  // ---------- filesystem ----------

  readFile(path: string): string {
    const v = this.fs.get(path);
    if (v === undefined) throw new Error(`file not found: ${path}`);
    return v;
  }

  writeFile(path: string, content: string): void {
    this.fs.set(path, content);
  }

  deleteFile(path: string): void {
    if (!this.fs.has(path)) throw new Error(`file not found: ${path}`);
    this.fs.delete(path);
  }

  moveFile(from: string, to: string): void {
    const v = this.fs.get(from);
    if (v === undefined) throw new Error(`file not found: ${from}`);
    if (this.fs.has(to)) throw new Error(`destination exists: ${to}`);
    this.fs.delete(from);
    this.fs.set(to, v);
  }

  listFiles(prefix?: string): string[] {
    const all = [...this.fs.keys()].sort();
    return prefix ? all.filter(p => p.startsWith(prefix)) : all;
  }

  hasFile(path: string): boolean {
    return this.fs.has(path);
  }

  // ---------- crud ----------

  crudList(collection: string): Array<{ id: string; record: Record<string, unknown> }> {
    const c = this.crud.get(collection);
    if (!c) return [];
    return [...c.entries()].map(([id, record]) => ({ id, record }));
  }

  crudGet(collection: string, id: string): Record<string, unknown> {
    const rec = this.crud.get(collection)?.get(id);
    if (!rec) throw new Error(`record not found: ${collection}/${id}`);
    return rec;
  }

  crudHas(collection: string, id: string): boolean {
    return this.crud.get(collection)?.has(id) ?? false;
  }

  crudCreate(collection: string, id: string, record: Record<string, unknown>): void {
    let c = this.crud.get(collection);
    if (!c) {
      c = new Map();
      this.crud.set(collection, c);
    }
    if (c.has(id)) throw new Error(`record exists: ${collection}/${id}`);
    c.set(id, { ...record });
  }

  crudUpdate(collection: string, id: string, patch: Record<string, unknown>): void {
    const c = this.crud.get(collection);
    const rec = c?.get(id);
    if (!rec) throw new Error(`record not found: ${collection}/${id}`);
    c!.set(id, { ...rec, ...patch });
  }

  crudDelete(collection: string, id: string): void {
    const c = this.crud.get(collection);
    if (!c?.has(id)) throw new Error(`record not found: ${collection}/${id}`);
    c.delete(id);
  }

  // ---------- snapshot / restore ----------

  snapshot(): WorldSnapshot {
    const fs: FsState = {};
    for (const [k, v] of this.fs) fs[k] = v;
    const crud: CrudState = {};
    for (const [coll, recs] of this.crud) {
      crud[coll] = {};
      for (const [id, rec] of recs) crud[coll]![id] = { ...rec };
    }
    return { fs, crud };
  }

  loadSnapshot(snap: WorldSnapshot): void {
    this.fs = new Map(Object.entries(snap.fs));
    this.crud = new Map(
      Object.entries(snap.crud).map(([coll, recs]) => [
        coll,
        new Map(Object.entries(recs).map(([id, rec]) => [id, { ...rec }])),
      ]),
    );
  }
}
