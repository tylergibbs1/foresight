import { generateObject } from 'ai';
import { z } from 'zod';
import { PREDICTOR_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { collectKnownContents, renderState, extractUsage } from './proposer.ts';
import type { ActionLogEntry, CandidateAction, CalibrationNote, Prediction, UsageRecord } from './types.ts';
import type { WorldSnapshot } from '../env/types.ts';

const ChangeEventSchema = z.object({
  target_type: z.enum(['file', 'record']),
  target_id: z
    .string()
    .describe(
      'For files: path. For records: "<collection>/<id>". For RENAME events specifically, target_id MUST be the resulting (new) path; put the previous (old) path in `before`.',
    ),
  operation: z.enum(['create', 'update', 'delete', 'rename', 'noop']),
  field: z.string().nullable().describe('Field name for record updates; null otherwise.'),
  before: z
    .string()
    .nullable()
    .describe('Stringified prior value. For RENAME, the previous path. Null where not applicable.'),
  after: z
    .string()
    .nullable()
    .describe('Stringified resulting value. For RENAME, the new path (== target_id). Null where not applicable.'),
});

const PredictionSchema = z.object({
  expected_changes: z
    .array(ChangeEventSchema)
    .describe('Exhaustive write set. One event per affected (target, field).'),
  side_effects: z
    .array(z.string())
    .describe('Effects beyond direct changes. Empty array if genuinely none.'),
  confidence: z.enum(['low', 'medium', 'high']),
  reversibility: z.enum([
    'fully_reversible',
    'reversible_with_backup',
    'partially_reversible',
    'irreversible',
    'unknown',
  ]),
  data_loss_risk: z.enum(['none', 'low', 'medium', 'high']),
  blast_radius: z.enum(['narrow', 'wide', 'unknown']),
  unverified_preconditions: z
    .array(z.string())
    .describe('Things that must be true for this prediction to hold but aren\'t visible in state.'),
});

export async function predict(opts: {
  model: string;
  state: WorldSnapshot;
  candidate: CandidateAction;
  notes: CalibrationNote[];
  useNotes: boolean;
  pastActions: ActionLogEntry[];
}): Promise<{ prediction: Prediction; usage: UsageRecord }> {
  const stateBlob = renderState(opts.state, collectKnownContents(opts.pastActions));
  const notesBlob =
    opts.useNotes && opts.notes.length
      ? opts.notes
          .map(n => {
            const when = n.applies_when.length ? `when ${n.applies_when.join(' AND ')}` : 'always';
            return `- [${n.applies_to_tool} | ${when}] ${n.lesson}`;
          })
          .join('\n')
      : '(none)';

  const prompt = `\
WORLD STATE:
${stateBlob}

PROPOSED ACTION:
tool: ${opts.candidate.tool}
args: ${JSON.stringify(opts.candidate.args)}

CALIBRATION NOTES (priors from earlier prediction errors; may not all apply):
${notesBlob}

Predict what will be observably true after this action runs. Emit typed events.`;

  const result = await generateObject({
    model: resolveModel(opts.model),
    schema: PredictionSchema,
    system: PREDICTOR_PROMPT,
    prompt,
  });

  return {
    prediction: result.object as Prediction,
    usage: extractUsage('predictor', result.usage),
  };
}
