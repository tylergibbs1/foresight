import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { CurrentTurnDetail } from '../state.ts';

export function CalibratorPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running = !detail || detail.phase !== 'done';
  const note = detail?.note;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>⑥ calibrator</Text>
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : detail?.calibratorMs !== undefined ? (
          <Text dimColor>  ✓ {((detail.calibratorMs ?? 0) / 1000).toFixed(1)}s · {detail.calibratorTokens} tok</Text>
        ) : null}
      </Box>
      {note && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>tool </Text>
            <Text>{note.applies_to_tool}</Text>
            <Text dimColor>  ·  err </Text>
            <Text color={note.observed_error_type === 'no_error' ? 'green' : 'yellow'}>
              {note.observed_error_type}
            </Text>
          </Box>
          {note.applies_when.length > 0 && (
            <Box>
              <Text dimColor>when  </Text>
              <Text>{note.applies_when.join(' AND ')}</Text>
            </Box>
          )}
          <Box>
            <Text dimColor>lesson  </Text>
            <Text italic>{note.lesson}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
