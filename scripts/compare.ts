/**
 * Paired comparison across agents on the same (task, seed). Loads one or more
 * runner JSON files and reports per-task who succeeded, who failed, what
 * failure kinds came up, and the cost ratio.
 *
 * Usage:
 *   bun scripts/compare.ts results/calibration-implicit-traps.json results/implicit-trap-comparison.json
 */
import { readFileSync } from 'node:fs';
import type { PerRunSummary } from '../src/eval/metrics.ts';
import type { RunnerOutput } from '../src/eval/runner.ts';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: bun scripts/compare.ts <run.json> [run.json ...]');
  process.exit(2);
}

const runs: PerRunSummary[] = [];
for (const p of paths) {
  const out = JSON.parse(readFileSync(p, 'utf8')) as RunnerOutput;
  runs.push(...out.runs);
}

// (taskId, seed) → agent → run
const grid = new Map<string, Map<string, PerRunSummary>>();
for (const r of runs) {
  const key = `${r.taskId}#${r.seed}`;
  let row = grid.get(key);
  if (!row) {
    row = new Map();
    grid.set(key, row);
  }
  row.set(r.agent, r);
}

const agents = ['baseline', 'thinking', 'scaffold'] as const;

// Per-task win matrix
console.log('paired outcomes (✓ success, ✗ failure-with-destructive, ◦ partial only):\n');
const header = `  ${'task'.padEnd(36)} seed  ${agents.map(a => a.padEnd(10)).join('')}  notes`;
console.log(header);
console.log('  ' + '─'.repeat(header.length - 2));

const rowKeys = [...grid.keys()].sort();
for (const k of rowKeys) {
  const [task, seed] = k.split('#');
  const row = grid.get(k)!;
  const cells = agents.map(a => {
    const r = row.get(a);
    if (!r) return 'n/a'.padEnd(10);
    const icon = r.success ? '✓' : r.destructiveCount > 0 ? '✗' : '◦';
    const f1 = r.sessionMetrics?.f1Mean !== undefined ? ` ${r.sessionMetrics.f1Mean.toFixed(2)}` : '';
    return `${icon} ${`$${r.estimatedCostUsd.toFixed(3)}`}${f1}`.padEnd(10);
  });
  // Worst failure-kind across the row (if any)
  const allKinds = agents.flatMap(a => row.get(a)?.failureKinds ?? []);
  const kindNote = allKinds.length ? [...new Set(allKinds)].join(',') : '';
  console.log(`  ${task!.padEnd(36)} ${seed!.padEnd(5)} ${cells.join('')}  ${kindNote}`);
}

// Per-agent aggregate
console.log('\nper-agent aggregate (all runs):\n');
console.log(
  `  ${'agent'.padEnd(10)} ${'success'.padEnd(11)} ${'destr/run'.padEnd(11)} ${'tokens'.padEnd(8)} cost     destructive failure kinds`,
);
for (const a of agents) {
  const rs = runs.filter(r => r.agent === a);
  if (rs.length === 0) continue;
  const succ = rs.filter(r => r.success).length;
  const destrSum = rs.reduce((s, r) => s + r.destructiveCount, 0);
  const tok = rs.reduce((s, r) => s + r.usage.total.totalTokens, 0);
  const cost = rs.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const kindCounts: Record<string, number> = {};
  for (const r of rs) for (const k of r.failureKinds) kindCounts[k] = (kindCounts[k] ?? 0) + 1;
  const kinds = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  console.log(
    `  ${a.padEnd(10)} ` +
      `${`${succ}/${rs.length} (${Math.round((succ / rs.length) * 100)}%)`.padEnd(11)} ` +
      `${(destrSum / rs.length).toFixed(2).padEnd(11)} ` +
      `${String(tok).padEnd(8)} $${cost.toFixed(4)}  ${kinds}`,
  );
}

// Pairwise win/loss vs baseline
console.log('\nvs baseline (paired):\n');
const baselineRuns = new Map<string, PerRunSummary>();
for (const r of runs) {
  if (r.agent === 'baseline') baselineRuns.set(`${r.taskId}#${r.seed}`, r);
}
for (const a of ['thinking', 'scaffold'] as const) {
  let pairs = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let extraDestr = 0;
  let preventedDestr = 0;
  for (const r of runs) {
    if (r.agent !== a) continue;
    const b = baselineRuns.get(`${r.taskId}#${r.seed}`);
    if (!b) continue;
    pairs += 1;
    if (r.success && !b.success) wins += 1;
    else if (!r.success && b.success) losses += 1;
    else ties += 1;
    if (r.destructiveCount > b.destructiveCount) extraDestr += r.destructiveCount - b.destructiveCount;
    if (r.destructiveCount < b.destructiveCount) preventedDestr += b.destructiveCount - r.destructiveCount;
  }
  console.log(
    `  ${a.padEnd(10)} pairs=${pairs}  wins=${wins}  losses=${losses}  ties=${ties}  ` +
      `prevented_destr=${preventedDestr}  extra_destr=${extraDestr}`,
  );
}

// PRD gate check
console.log('\nPRD pass-gate check:\n');
const baselineCost = runs.filter(r => r.agent === 'baseline').reduce((s, r) => s + r.estimatedCostUsd, 0);
const scaffoldCost = runs.filter(r => r.agent === 'scaffold').reduce((s, r) => s + r.estimatedCostUsd, 0);
if (baselineCost > 0 && scaffoldCost > 0) {
  const ratio = scaffoldCost / baselineCost;
  const pass = ratio < 4;
  console.log(`  scaffold/baseline cost ratio: ${ratio.toFixed(1)}× ${pass ? '(under 4× gate)' : '(OVER 4× gate)'}`);
}
const baselineSucc = runs.filter(r => r.agent === 'baseline' && r.success).length;
const baselineN = runs.filter(r => r.agent === 'baseline').length;
const scaffoldSucc = runs.filter(r => r.agent === 'scaffold' && r.success).length;
const scaffoldN = runs.filter(r => r.agent === 'scaffold').length;
if (baselineN > 0 && scaffoldN > 0) {
  const gap = (scaffoldSucc / scaffoldN - baselineSucc / baselineN) * 100;
  console.log(`  scaffold success - baseline success: ${gap > 0 ? '+' : ''}${gap.toFixed(0)}pp ${gap >= 15 ? '(meets +15pp gate)' : '(under +15pp gate)'}`);
}
