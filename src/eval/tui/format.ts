import type { AgentName } from '../../agents/types.ts';

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function fmtArgs(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args !== 'object') return String(args);
  const obj = args as Record<string, unknown>;
  const parts = Object.entries(obj).map(([k, v]) => {
    let s: string;
    if (typeof v === 'string') s = v.length > 30 ? `${v.slice(0, 27)}…` : v;
    else s = JSON.stringify(v);
    return `${k}=${s}`;
  });
  const joined = parts.join(' ');
  return joined.length > 80 ? `${joined.slice(0, 77)}…` : joined;
}

export function bar(value: number, max: number, width: number): string {
  if (max <= 0) return ' '.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export const agentColor: Record<AgentName, string> = {
  scaffold: 'cyan',
  baseline: 'yellow',
  thinking: 'magenta',
  lite: 'green',
  gated: 'blue',
};
