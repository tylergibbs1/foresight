import { Box, Static, Text } from 'ink';
import type { PerRunSummary } from '../metrics.ts';
import { agentColor } from './format.ts';

export function CompletedRuns({ runs }: { runs: PerRunSummary[] }) {
  // Items are append-only (the runner emits run-end strictly in order), so
  // <Static> can render once per item and never reflow.
  return (
    <Static items={runs}>
      {run => <CompletedRow key={`${run.taskId}-${run.seed}-${run.agent}`} run={run} />}
    </Static>
  );
}

function CompletedRow({ run }: { run: PerRunSummary }) {
  const icon = run.success ? '✓' : '✗';
  const iconColor = run.success ? 'green' : 'red';
  const f1 = run.sessionMetrics?.f1Mean;
  const f1Str = f1 !== undefined ? `f1=${f1.toFixed(2)}` : '';
  return (
    <Box>
      <Text color={iconColor}>{icon} </Text>
      <Text dimColor>{run.taskId.padEnd(34)}</Text>
      <Text color={agentColor[run.agent]}>{run.agent.padEnd(9)}</Text>
      <Text dimColor>seed={run.seed}  </Text>
      <Text>turns={String(run.turns).padStart(2)}  </Text>
      <Text color={run.destructiveCount > 0 ? 'red' : 'gray'}>
        destr={run.destructiveCount}
      </Text>
      <Text dimColor>  tok={String(run.usage.total.totalTokens).padStart(5)}  ${run.estimatedCostUsd.toFixed(4)}</Text>
      {f1Str && <Text dimColor>  {f1Str}</Text>}
    </Box>
  );
}
