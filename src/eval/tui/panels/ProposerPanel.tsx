import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { CurrentTurnDetail } from '../state.ts';
import { fmtArgs } from '../format.ts';

export function ProposerPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running = detail === null;
  const candidates = detail?.candidates ?? [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>① proposer</Text>
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : (
          <>
            <Text dimColor>  ✓ {(detail.proposerMs! / 1000).toFixed(1)}s · {detail.proposerTokens} tok</Text>
            {(detail.validationFailures ?? 0) > 0 && (
              <Text color="yellow" dimColor>  · {detail.validationFailures} dropped</Text>
            )}
          </>
        )}
      </Box>
      {!running && candidates.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {candidates.map((c, i) => (
            <Box key={i}>
              <Text dimColor>{String(i).padStart(2)}  </Text>
              <Text bold>{c.tool}</Text>
              <Text dimColor>  {fmtArgs(c.args)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
