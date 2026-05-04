import { generateObject } from 'ai';
import { z } from 'zod';
import { CALIBRATOR_PROMPT } from './prompts.ts';
import { resolveModel } from './model.ts';
import { extractUsage } from './proposer.ts';
import type { CalibrationNote, F1Score, Prediction, UsageRecord } from './types.ts';
import { describeEvent, eventKey, type ChangeEvent } from '../env/types.ts';

const CalibrationNoteSchema = z.object({
  applies_to_tool: z.string(),
  applies_when: z.array(z.string()),
  observed_error_type: z.enum([
    'missed_target',
    'phantom_change',
    'wrong_field',
    'wrong_value',
    'underprediction',
    'overprediction',
    'noop_mispredicted',
    'no_error',
  ]),
  lesson: z.string().describe('One concrete, actionable rule. <= 200 chars.'),
});

/**
 * Deterministic precision/recall/F1 over typed change events using canonical
 * keys. No LLM judging.
 *
 * Empty-set handling, per the review:
 *   predicted=∅, actual=∅  → f1=1 (correct noop prediction)
 *   predicted=∅, actual=N>0 → f1=0 (missed everything)
 *   predicted=N>0, actual=∅ → f1=0 (phantom predictions)
 *   else                   → standard F1
 */
export function predictionF1(predicted: ChangeEvent[], actual: ChangeEvent[]): F1Score {
  const predictedKeys = new Set(predicted.map(eventKey));
  const actualKeys = new Set(actual.map(eventKey));

  if (predictedKeys.size === 0 && actualKeys.size === 0) {
    return { precision: 1, recall: 1, f1: 1, truePositive: 0, predictedCount: 0, actualCount: 0 };
  }
  if (predictedKeys.size === 0 || actualKeys.size === 0) {
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      truePositive: 0,
      predictedCount: predictedKeys.size,
      actualCount: actualKeys.size,
    };
  }

  let tp = 0;
  for (const k of predictedKeys) if (actualKeys.has(k)) tp += 1;

  const precision = tp / predictedKeys.size;
  const recall = tp / actualKeys.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    truePositive: tp,
    predictedCount: predictedKeys.size,
    actualCount: actualKeys.size,
  };
}

export async function calibrate(opts: {
  model: string;
  turn: number;
  toolName: string;
  prediction: Prediction;
  actual: ChangeEvent[];
  score: F1Score;
}): Promise<{ note: CalibrationNote; usage: UsageRecord }> {
  const predictedLines = opts.prediction.expected_changes.map(describeEvent);
  const actualLines = opts.actual.map(describeEvent);
  const prompt = `\
TOOL: ${opts.toolName}

PREDICTED EVENTS:
${predictedLines.length ? predictedLines.map(l => `  - ${l}`).join('\n') : '  (none)'}

ACTUAL EVENTS:
${actualLines.length ? actualLines.map(l => `  - ${l}`).join('\n') : '  (none)'}

DETERMINISTIC SCORE:
  precision=${opts.score.precision.toFixed(2)} recall=${opts.score.recall.toFixed(2)} f1=${opts.score.f1.toFixed(2)}
  matched=${opts.score.truePositive} predicted=${opts.score.predictedCount} actual=${opts.score.actualCount}

Produce the structured calibration note. If f1 == 1, observed_error_type is "no_error".`;

  const result = await generateObject({
    model: resolveModel(opts.model),
    schema: CalibrationNoteSchema,
    system: CALIBRATOR_PROMPT,
    prompt,
  });

  return {
    note: { turn: opts.turn, ...result.object },
    usage: extractUsage('calibrator', result.usage),
  };
}
