import { generateObject } from 'ai';
import { z } from 'zod';
import { SCORER_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { collectKnownContents, extractUsage, renderState } from './proposer.ts';
import { describeEvent } from '../env/types.ts';
import type { ActionLogEntry, CandidateAction, Prediction, ScorerOutput, UsageRecord } from './types.ts';
import type { WorldSnapshot } from '../env/types.ts';

const ScoreSchema = z.object({
  rankings: z.array(
    z.object({
      candidate_index: z.number().int().min(0),
      score: z.number().min(0).max(10),
      reasoning: z.string().describe('<= 200 chars.'),
      goal_alignment: z.array(z.string()).describe('Goal criteria this prediction satisfies.'),
      risks: z.array(z.string()).describe('Concerns about this predicted outcome.'),
    }),
  ),
  recommended_index: z.number().int().min(0),
});

export type ScorerMode = 'comparative' | 'independent';

export async function score(opts: {
  model: string;
  goal: string;
  predictions: Prediction[];
  candidates: CandidateAction[];
  state: WorldSnapshot;
  pastActions: ActionLogEntry[];
  mode: ScorerMode;
}): Promise<{ scoring: ScorerOutput; usage: UsageRecord[] }> {
  if (opts.mode === 'comparative') return scoreComparative(opts);
  return scoreIndependent(opts);
}

async function scoreComparative(opts: {
  model: string;
  goal: string;
  predictions: Prediction[];
  candidates: CandidateAction[];
  state: WorldSnapshot;
  pastActions: ActionLogEntry[];
}): Promise<{ scoring: ScorerOutput; usage: UsageRecord[] }> {
  const block = opts.predictions
    .map((p, i) => `Candidate ${i}:\n${formatPrediction(p, opts.candidates[i]?.tool)}`)
    .join('\n\n');
  const stateBlob = renderState(opts.state, collectKnownContents(opts.pastActions));
  const prompt = `\
GOAL:
${opts.goal}

CURRENT WORLD STATE (file content in italics is what the agent has read on
prior turns; "content not yet read" means the agent does NOT know what's in
that file — penalize predictions that overwrite unread files):
${stateBlob}

PREDICTIONS (score by predicted outcome and risk profile; tool names included
so you can apply the unread-file rule above):
${block}

Score each candidate (one entry per candidate, indices 0..${opts.predictions.length - 1}) and pick recommended_index.`;

  const result = await generateObject({
    model: resolveModel(opts.model),
    schema: ScoreSchema,
    system: SCORER_PROMPT,
    prompt,
  });

  return {
    scoring: result.object,
    usage: [extractUsage('scorer', result.usage)],
  };
}

async function scoreIndependent(opts: {
  model: string;
  goal: string;
  predictions: Prediction[];
  candidates: CandidateAction[];
  state: WorldSnapshot;
  pastActions: ActionLogEntry[];
}): Promise<{ scoring: ScorerOutput; usage: UsageRecord[] }> {
  const SingleSchema = z.object({
    score: z.number().min(0).max(10),
    reasoning: z.string(),
    goal_alignment: z.array(z.string()),
    risks: z.array(z.string()),
  });

  const usages: UsageRecord[] = [];
  const rankings = await Promise.all(
    opts.predictions.map(async (p, i) => {
      const prompt = `\
GOAL:
${opts.goal}

PREDICTION:
${formatPrediction(p, opts.candidates[i]?.tool)}

Score this single predicted outcome 0-10.`;
      const r = await generateObject({
        model: resolveModel(opts.model),
        schema: SingleSchema,
        system: SCORER_PROMPT,
        prompt,
      });
      usages.push(extractUsage('scorer', r.usage));
      return { candidate_index: i, ...r.object };
    }),
  );
  const sorted = [...rankings].sort((a, b) => b.score - a.score);
  const recommended = sorted[0]?.candidate_index ?? 0;
  return {
    scoring: { rankings, recommended_index: recommended },
    usage: usages,
  };
}

function formatPrediction(p: Prediction, toolName?: string): string {
  const events = p.expected_changes.length
    ? p.expected_changes.map(e => `    - ${describeEvent(e)}`).join('\n')
    : '    (no observable change predicted)';
  return [
    `  tool: ${toolName ?? 'unknown'}`,
    `  expected_changes:`,
    events,
    `  side_effects: ${JSON.stringify(p.side_effects)}`,
    `  confidence: ${p.confidence}`,
    `  reversibility: ${p.reversibility}`,
    `  data_loss_risk: ${p.data_loss_risk}`,
    `  blast_radius: ${p.blast_radius}`,
    `  unverified_preconditions: ${JSON.stringify(p.unverified_preconditions)}`,
  ].join('\n');
}
