import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { CurrentTurnDetail } from '../state.ts';
import { bar } from '../format.ts';

export function ScorerPanel({ detail }: { detail: CurrentTurnDetail | null }) {
  const running = !detail || detail.phase === 'predictor' || detail.phase === 'scorer';
  const scoring = detail?.scoring;
  const chosenIndex = detail?.chosenIndex;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold>③ scorer</Text>
        {running ? (
          <>
            <Text>  </Text>
            <Spinner />
          </>
        ) : detail?.scorerMs !== undefined ? (
          <Text dimColor>  ✓ {(detail.scorerMs / 1000).toFixed(1)}s · {detail.scorerTokens} tok</Text>
        ) : null}
      </Box>
      {scoring && (
        <Box flexDirection="column" marginTop={1}>
          {[...scoring.rankings]
            .sort((a, b) => a.candidate_index - b.candidate_index)
            .map(r => {
              const chosen = r.candidate_index === chosenIndex;
              return (
                <Box key={r.candidate_index}>
                  <Text>{chosen ? '★ ' : '  '}</Text>
                  <Text>{String(r.candidate_index).padEnd(3)}</Text>
                  <Text color={scoreColor(r.score)}>{bar(r.score, 10, 12)}</Text>
                  <Text>  {r.score.toFixed(1).padStart(4)}</Text>
                  <Text dimColor>  {truncate(r.reasoning, 40)}</Text>
                </Box>
              );
            })}
        </Box>
      )}
    </Box>
  );
}

function scoreColor(s: number): string {
  if (s >= 7) return 'green';
  if (s >= 4) return 'yellow';
  return 'red';
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
