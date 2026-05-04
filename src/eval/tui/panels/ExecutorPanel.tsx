import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { CurrentTurnDetail } from '../state.ts';
import { fmtArgs } from '../format.ts';

export function ExecutorPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running =
    !detail ||
    detail.phase === 'predictor' ||
    detail.phase === 'scorer' ||
    detail.phase === 'executor';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>④ executor</Text>
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : (
          <Text dimColor>  ✓ {((detail.executorMs ?? 0) / 1000).toFixed(2)}s</Text>
        )}
      </Box>
      {detail?.chosen && (
        <Box marginTop={1}>
          <Text bold color="cyan">{detail.chosen.tool}</Text>
          <Text dimColor>  {fmtArgs(detail.chosen.args)}</Text>
        </Box>
      )}
      {detail?.executionError && (
        <Box marginTop={1}>
          <Text color="red">error: {detail.executionError}</Text>
        </Box>
      )}
    </Box>
  );
}
