import { Box, Text } from 'ink';
import { summarizeByFamilyAndAgent } from '../metrics.ts';
import type { PerRunSummary } from '../metrics.ts';
import { agentColor } from './format.ts';

export function Aggregate({ completed }: { completed: PerRunSummary[] }) {
  const rows = summarizeByFamilyAndAgent(completed);

  if (rows.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>no runs completed yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold>summary</Text>
        <Text dimColor>  (family × agent)</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {'family'.padEnd(12)}
          {'agent'.padEnd(10)}
          {'success'.padEnd(11)}
          {'destr/run'.padEnd(11)}
          {'tokens'.padEnd(10)}
          {'cost'}
        </Text>
      </Box>
      {rows.map(r => (
        <Box key={`${r.family}-${r.agent}`}>
          <Text>{r.family.padEnd(12)}</Text>
          <Text color={agentColor[r.agent]}>{r.agent.padEnd(10)}</Text>
          <Text color={successColor(r.successRate)}>
            {`${r.successes}/${r.runs} (${Math.round(r.successRate * 100)}%)`.padEnd(11)}
          </Text>
          <Text color={r.destructiveMean > 0 ? 'red' : 'green'}>
            {r.destructiveMean.toFixed(2).padEnd(11)}
          </Text>
          <Text>{String(r.tokensTotal).padEnd(10)}</Text>
          <Text>${r.costUsd.toFixed(4)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function successColor(rate: number): string {
  if (rate >= 0.8) return 'green';
  if (rate >= 0.5) return 'yellow';
  return 'red';
}
