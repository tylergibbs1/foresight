import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { describeEvent, eventKey } from '../../../env/types.ts';
import { bar } from '../format.ts';
import type { CurrentTurnDetail } from '../state.ts';

export function DiffPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running =
    !detail ||
    detail.phase === 'predictor' ||
    detail.phase === 'scorer' ||
    detail.phase === 'executor';
  const score = detail?.predictionScore;
  const predicted = detail?.predicted?.expected_changes ?? [];
  const actual = detail?.actualEvents ?? [];

  const predictedKeys = new Set(predicted.map(eventKey));
  const actualKeys = new Set(actual.map(eventKey));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>⑤ predicted vs actual</Text>
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : score ? (
          <>
            <Text dimColor>  </Text>
            <Text color={f1Color(score.f1)}>{bar(score.f1, 1, 10)}</Text>
            <Text> </Text>
            <Text>F1 {score.f1.toFixed(2)}</Text>
            <Text dimColor>  P={score.precision.toFixed(2)} R={score.recall.toFixed(2)}</Text>
          </>
        ) : null}
      </Box>
      {!running && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Box flexDirection="column" width="50%">
              <Text dimColor>predicted</Text>
              {predicted.length === 0 && <Text dimColor>  (none)</Text>}
              {predicted.map((e, i) => {
                const matched = actualKeys.has(eventKey(e));
                return (
                  <Box key={i}>
                    <Text color={matched ? 'green' : 'yellow'}>{matched ? '✓ ' : '? '}</Text>
                    <Text dimColor>{describeEvent(e)}</Text>
                  </Box>
                );
              })}
            </Box>
            <Box flexDirection="column" width="50%">
              <Text dimColor>actual</Text>
              {actual.length === 0 && <Text dimColor>  (none)</Text>}
              {actual.map((e, i) => {
                const matched = predictedKeys.has(eventKey(e));
                return (
                  <Box key={i}>
                    <Text color={matched ? 'green' : 'red'}>{matched ? '✓ ' : '! '}</Text>
                    <Text dimColor>{describeEvent(e)}</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function f1Color(f1: number): string {
  if (f1 >= 0.8) return 'green';
  if (f1 >= 0.5) return 'yellow';
  return 'red';
}
