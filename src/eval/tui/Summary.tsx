import { Box, Text } from 'ink';
import { summarizeByFamilyAndAgent } from '../metrics.ts';
import type { RunnerOutput } from '../runner.ts';
import { agentColor } from './format.ts';

export function Summary({ output, outPath }: { output: RunnerOutput; outPath: string }) {
  const rows = summarizeByFamilyAndAgent(output.runs);
  const totalCost = output.runs.reduce((s, r) => s + r.estimatedCostUsd, 0);
  const totalTokens = output.runs.reduce((s, r) => s + r.usage.total.totalTokens, 0);

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
      <Box>
        <Text bold color="green">eval complete</Text>
        <Text dimColor>  · </Text>
        <Text>{output.runs.length} runs</Text>
        <Text dimColor>  · </Text>
        <Text>{totalTokens} tokens</Text>
        <Text dimColor>  · </Text>
        <Text>${totalCost.toFixed(4)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>wrote </Text>
        <Text>{outPath}</Text>
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
          <Text>{`${r.successes}/${r.runs} (${Math.round(r.successRate * 100)}%)`.padEnd(11)}</Text>
          <Text>{r.destructiveMean.toFixed(2).padEnd(11)}</Text>
          <Text>{String(r.tokensTotal).padEnd(10)}</Text>
          <Text>${r.costUsd.toFixed(4)}</Text>
        </Box>
      ))}
    </Box>
  );
}
