import { toolSchemas, type ToolName } from '../env/tools.ts';
import type { CandidateAction } from './types.ts';

/**
 * Static validator: drop candidates with unknown tool names or argument shapes
 * that don't match the tool's input schema. Cheap and deterministic — runs
 * before any predictor calls.
 */
export function validate(c: CandidateAction): { ok: true } | { ok: false; reason: string } {
  if (!(c.tool in toolSchemas)) {
    return { ok: false, reason: `unknown tool: ${c.tool}` };
  }
  const schema = toolSchemas[c.tool as ToolName];
  const result = schema.safeParse(c.args);
  if (!result.success) {
    return {
      ok: false,
      reason: `args do not match ${c.tool} schema: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }
  return { ok: true };
}

/**
 * Deterministic dedupe: collapse candidates with identical (tool, normalized
 * args) to a single entry. Normalization sorts object keys recursively so
 * `{a:1,b:2}` and `{b:2,a:1}` collapse.
 */
export function dedupe(candidates: CandidateAction[]): CandidateAction[] {
  const seen = new Map<string, CandidateAction>();
  for (const c of candidates) {
    const key = `${c.tool}|${stableStringify(c.args)}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
