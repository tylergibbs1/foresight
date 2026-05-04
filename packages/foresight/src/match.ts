import type { ChangeEvent, MatchScore } from './types.ts';
import { eventKey } from './types.ts';

/**
 * Deterministic precision/recall/F1 over typed change events using canonical
 * keys. **No LLM in the metric path** — pure set-equality on
 * `<target_type>:<target_id>:<operation>:<field>`.
 *
 * Empty-set semantics:
 * - `predicted=∅, actual=∅` → f1 = 1 (correct noop prediction)
 * - `predicted=∅, actual>0` → f1 = 0 (missed everything)
 * - `predicted>0, actual=∅` → f1 = 0 (phantom predictions)
 * - else → standard F1
 *
 * @example
 * import { foresight } from 'foresight';
 *
 * const decision = await foresight.gate({...});
 * await runAction();
 * const actual = computeMyDiff();
 * const score = foresight.matchEvents(decision.predicted_changes, actual);
 * console.log(score.f1, score.predictedOnly, score.actualOnly);
 */
export function matchEvents(
  predicted: ChangeEvent[],
  actual: ChangeEvent[],
): MatchScore {
  const predictedKeys = new Set(predicted.map(eventKey));
  const actualKeys = new Set(actual.map(eventKey));

  if (predictedKeys.size === 0 && actualKeys.size === 0) {
    return {
      precision: 1,
      recall: 1,
      f1: 1,
      truePositive: 0,
      predictedCount: 0,
      actualCount: 0,
      predictedOnly: [],
      actualOnly: [],
    };
  }
  if (predictedKeys.size === 0 || actualKeys.size === 0) {
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      truePositive: 0,
      predictedCount: predictedKeys.size,
      actualCount: actualKeys.size,
      predictedOnly: [...predictedKeys],
      actualOnly: [...actualKeys],
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
    predictedOnly: [...predictedKeys].filter(k => !actualKeys.has(k)),
    actualOnly: [...actualKeys].filter(k => !predictedKeys.has(k)),
  };
}
