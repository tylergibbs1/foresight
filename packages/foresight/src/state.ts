import type { WorldState } from './types.ts';

/**
 * Render a world state into a readable text block for the predictor / scorer.
 *
 * For files, content under 800 chars is shown inline. Larger content is
 * truncated. If a file appears in `state.fs` but its content is the empty
 * string, it's shown as "(empty)" — distinct from the "not in state" case.
 *
 * For records, every record is rendered as JSON. Records are typically small
 * enough to inline.
 */
export function renderState(state: WorldState): string {
  const fsLines: string[] = [];
  for (const [p, c] of Object.entries(state.fs ?? {})) {
    const display = c === '' ? '(empty)' : c.length > 800 ? `${c.slice(0, 800)}…[truncated]` : c;
    if (c === '' || c.length <= 800) {
      fsLines.push(`  ${p} (${c.length} bytes):\n${indent(display, 6)}`);
    } else {
      fsLines.push(`  ${p} (${c.length} bytes):\n${indent(display, 6)}`);
    }
  }
  const crudLines: string[] = [];
  for (const [coll, recs] of Object.entries(state.crud ?? {})) {
    crudLines.push(`  ${coll}/`);
    for (const [id, rec] of Object.entries(recs)) {
      crudLines.push(`    ${id}: ${JSON.stringify(rec)}`);
    }
  }
  return [
    'Files:',
    fsLines.length ? fsLines.join('\n') : '  (none)',
    'Records:',
    crudLines.length ? crudLines.join('\n') : '  (none)',
  ].join('\n');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => pad + l).join('\n');
}

export async function resolveState(
  state: WorldState | (() => Promise<WorldState> | WorldState),
): Promise<WorldState> {
  if (typeof state === 'function') return await state();
  return state;
}
