import type { AgentRunResult, UsageRecord, AgentName } from '../agents/types.ts';
import type { FailureKind } from '../tasks/types.ts';

export interface AggregatedUsage {
  byRole: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }>;
  total: { promptTokens: number; completionTokens: number; totalTokens: number; calls: number };
}

export function aggregateUsage(usages: UsageRecord[]): AggregatedUsage {
  const byRole: AggregatedUsage['byRole'] = {};
  for (const u of usages) {
    const slot = byRole[u.role] ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
    slot.promptTokens += u.promptTokens;
    slot.completionTokens += u.completionTokens;
    slot.totalTokens += u.totalTokens;
    slot.calls += 1;
    byRole[u.role] = slot;
  }
  const total = Object.values(byRole).reduce(
    (acc, v) => ({
      promptTokens: acc.promptTokens + v.promptTokens,
      completionTokens: acc.completionTokens + v.completionTokens,
      totalTokens: acc.totalTokens + v.totalTokens,
      calls: acc.calls + v.calls,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
  );
  return { byRole, total };
}

export function scaffoldSessionMetrics(run: AgentRunResult) {
  if (run.agent !== 'scaffold' || !run.scaffoldTurns?.length) return null;
  const f1s = run.scaffoldTurns.map(t => t.predictionScore.f1);
  const precisions = run.scaffoldTurns.map(t => t.predictionScore.precision);
  const recalls = run.scaffoldTurns.map(t => t.predictionScore.recall);
  const third = Math.max(1, Math.floor(f1s.length / 3));
  const first = f1s.slice(0, third);
  const last = f1s.slice(-third);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  let topScored = 0;
  let scoredDenom = 0;
  for (const t of run.scaffoldTurns) {
    const recIdx = t.scoring.recommended_index;
    const recScore = t.scoring.rankings.find(r => r.candidate_index === recIdx)?.score;
    if (recScore === undefined) continue;
    const max = Math.max(...t.scoring.rankings.map(r => r.score));
    if (recScore >= max - 0.001) topScored += 1;
    scoredDenom += 1;
  }

  return {
    f1Mean: avg(f1s),
    precisionMean: avg(precisions),
    recallMean: avg(recalls),
    f1FirstThird: avg(first),
    f1LastThird: avg(last),
    calibrationDelta: avg(last) - avg(first),
    scorerSelfConsistency: scoredDenom ? topScored / scoredDenom : 0,
  };
}

export interface PerRunSummary {
  taskId: string;
  family: string;
  difficulty: 'easy' | 'medium' | 'hard';
  agent: AgentName;
  seed: number;
  success: boolean;
  failureReasons: string[];
  destructiveActions: string[];
  destructiveCount: number;
  failureKinds: FailureKind[];
  executedActionCount: number;
  turns: number;
  stoppedReason: AgentRunResult['stoppedReason'];
  errorMessage: string | null;
  wallClockMs: number;
  usage: AggregatedUsage;
  estimatedCostUsd: number;
  sessionMetrics?: ReturnType<typeof scaffoldSessionMetrics>;
}

const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  default: { input: 5, output: 15 },
};

export function estimateCostUsd(usage: AggregatedUsage, model: string): number {
  const envIn = Number(process.env.PRICING_INPUT_PER_MTOK);
  const envOut = Number(process.env.PRICING_OUTPUT_PER_MTOK);
  const fallback = PRICING_PER_MTOK[model] ?? PRICING_PER_MTOK.default!;
  const input = Number.isFinite(envIn) && envIn > 0 ? envIn : fallback.input;
  const output = Number.isFinite(envOut) && envOut > 0 ? envOut : fallback.output;
  return (usage.total.promptTokens * input + usage.total.completionTokens * output) / 1_000_000;
}

/** Per (family, agent) aggregates for the printed summary. */
export interface FamilyAgentSummary {
  family: string;
  agent: AgentName;
  runs: number;
  successes: number;
  successRate: number;
  destructiveTotal: number;
  destructiveMean: number;
  tokensTotal: number;
  costUsd: number;
  /** Failure-kind tallies across runs in this group. */
  failureKindCounts: Partial<Record<FailureKind, number>>;
}

export function summarizeByFamilyAndAgent(runs: PerRunSummary[]): FamilyAgentSummary[] {
  const groups = new Map<string, FamilyAgentSummary>();
  for (const r of runs) {
    const key = `${r.family}|${r.agent}`;
    const slot = groups.get(key) ?? {
      family: r.family,
      agent: r.agent,
      runs: 0,
      successes: 0,
      successRate: 0,
      destructiveTotal: 0,
      destructiveMean: 0,
      tokensTotal: 0,
      costUsd: 0,
      failureKindCounts: {},
    };
    slot.runs += 1;
    slot.successes += r.success ? 1 : 0;
    slot.destructiveTotal += r.destructiveCount;
    slot.tokensTotal += r.usage.total.totalTokens;
    slot.costUsd += r.estimatedCostUsd;
    for (const k of r.failureKinds) {
      slot.failureKindCounts[k] = (slot.failureKindCounts[k] ?? 0) + 1;
    }
    groups.set(key, slot);
  }
  for (const s of groups.values()) {
    s.successRate = s.runs ? s.successes / s.runs : 0;
    s.destructiveMean = s.runs ? s.destructiveTotal / s.runs : 0;
  }
  return [...groups.values()].sort((a, b) =>
    a.family === b.family ? a.agent.localeCompare(b.agent) : a.family.localeCompare(b.family),
  );
}
