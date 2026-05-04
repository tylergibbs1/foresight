import { generateObject } from 'ai';
import { z } from 'zod';
import { PROPOSER_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import type { ActionLogEntry, CandidateAction, UsageRecord, CalibrationNote } from './types.ts';
import { toolCatalog } from '../env/tools.ts';
import type { WorldSnapshot } from '../env/types.ts';

const ProposalSchema = z.object({
  candidates: z
    .array(
      z.object({
        tool: z.string().describe('Name of the tool that would execute this action.'),
        args_json: z
          .string()
          .describe('JSON-encoded arguments object matching the tool input schema.'),
        rationale: z
          .string()
          .describe('Short reason this is a plausible next action. <= 160 chars.'),
      }),
    )
    .min(3)
    .max(8),
});

export async function proposeCandidates(opts: {
  model: string;
  goal: string;
  state: WorldSnapshot;
  notes: CalibrationNote[];
  candidateCount: number;
  pastActions: ActionLogEntry[];
}): Promise<{ candidates: CandidateAction[]; usage: UsageRecord }> {
  const catalog = toolCatalog()
    .map(t => `- ${t.name}${t.args}: ${t.description}`)
    .join('\n');

  const known = collectKnownContents(opts.pastActions);
  const stateBlob = renderState(opts.state, known);
  const history = opts.pastActions.length
    ? opts.pastActions
        .map((entry, i) => formatActionLogEntry(entry, i + 1))
        .join('\n')
    : '(none)';

  const notesBlob = opts.notes.length
    ? opts.notes
        .map(n => {
          const when = n.applies_when.length ? ` when ${n.applies_when.join(' AND ')}` : '';
          return `- [${n.applies_to_tool}${when}] ${n.lesson}`;
        })
        .join('\n')
    : '(none)';

  const prompt = `\
GOAL:
${opts.goal}

CURRENT WORLD STATE:
${stateBlob}

ACTIONS TAKEN SO FAR:
${history}

CALIBRATION NOTES (lessons from earlier prediction errors):
${notesBlob}

TOOL CATALOG:
${catalog}

Return ${opts.candidateCount} distinct candidate next actions.`;

  const result = await generateObject({
    model: resolveModel(opts.model),
    schema: ProposalSchema,
    system: PROPOSER_PROMPT,
    prompt,
  });

  const candidates: CandidateAction[] = result.object.candidates.map(c => ({
    tool: c.tool,
    args: safeParseJson(c.args_json),
    rationale: c.rationale,
  }));

  return {
    candidates: candidates.slice(0, opts.candidateCount),
    usage: extractUsage('proposer', result.usage),
  };
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatActionLogEntry(entry: ActionLogEntry, n: number): string {
  const head = `${n}. ${entry.action.tool}(${JSON.stringify(entry.action.args)}) — ${entry.action.rationale}`;
  if (entry.error) {
    return `${head}\n   ERROR: ${entry.error}`;
  }
  const result = formatToolResult(entry.action.tool, entry.result);
  return `${head}\n   → ${result}`;
}

function formatToolResult(tool: string, result: unknown): string {
  if (result === null || result === undefined) return '(no result)';
  // For tools that return content, surface it so the proposer can use it next turn.
  // Cap to ~600 chars to stay within token budget.
  let s: string;
  if (typeof result === 'string') s = result;
  else s = JSON.stringify(result);
  if (s.length > 600) s = `${s.slice(0, 597)}…`;
  return s;
}

/**
 * Per-target content the agent has previously read in this session. Surfacing
 * this in the state blob is essential — without it, the scaffold has no way
 * to write a complete payload back to a file it nominally "read", because the
 * read result is buried in tool history.
 */
export interface KnownContents {
  files: Map<string, string>;
}

export function collectKnownContents(actions: ActionLogEntry[]): KnownContents {
  const files = new Map<string, string>();
  for (const a of actions) {
    if (a.error) continue;
    if (a.action.tool === 'read_file' && typeof a.result === 'string') {
      const path = a.action.args.path as string;
      files.set(path, a.result);
    }
  }
  return { files };
}

export function renderState(state: WorldSnapshot, known?: KnownContents): string {
  const fsLines = Object.entries(state.fs).map(([p, c]) => {
    const content = known?.files.get(p);
    if (content !== undefined) {
      const display = content.length > 800 ? `${content.slice(0, 800)}…[truncated]` : content;
      return `  ${p} (${c.length} bytes, content read on a previous turn):\n${indent(display, 6)}`;
    }
    return `  ${p} (${c.length} bytes; content not yet read)`;
  });
  const crudLines: string[] = [];
  for (const [coll, recs] of Object.entries(state.crud)) {
    crudLines.push(`  ${coll}/`);
    for (const [id, rec] of Object.entries(recs)) {
      crudLines.push(`    ${id}: ${JSON.stringify(rec)}`);
    }
  }
  return [
    'Files:',
    fsLines.length ? fsLines.join('\n') : '  (none)',
    'CRUD:',
    crudLines.length ? crudLines.join('\n') : '  (none)',
  ].join('\n');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => pad + l).join('\n');
}

export function extractUsage(role: string, usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined): UsageRecord {
  const promptTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0;
  const completionTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? promptTokens + completionTokens;
  return { role, promptTokens, completionTokens, totalTokens };
}
