import { Box, Text } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { fmtElapsed } from './format.ts';
import type { DashboardState } from './state.ts';

export function Header({ state, now }: { state: DashboardState; now: number }) {
  const completedCount = state.completed.length;
  const total = state.totalRuns;
  const pct = total ? Math.floor((completedCount / total) * 100) : 0;
  const elapsedMs = state.startedAt ? Math.max(0, now - state.startedAt) : 0;

  // Cost meter: ratio of scaffold cost to baseline cost across completed runs.
  // Above 4× lights up red (the PRD's gate).
  const ratio = costRatio(state.completed);

  const configLine = state.config
    ? `${state.config.model}  ·  agents=${state.config.agents.join(',')}  ·  candidates=${state.config.candidateCount}  ·  scorer=${state.config.scorerMode}`
    : 'waiting for config…';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text>
        <Text bold color="cyan">JEPA Scaffold Eval</Text>
      </Text>
      <Text wrap="truncate-end" dimColor>
        {configLine}
      </Text>
      <Box marginTop={1}>
        <Box width={40}>
          <ProgressBar value={pct} />
        </Box>
        <Text>  </Text>
        <Text>{completedCount}/{total} runs</Text>
        <Text dimColor>  ·  </Text>
        <Text>{fmtElapsed(elapsedMs)}</Text>
        {ratio !== null && (
          <>
            <Text dimColor>  ·  scaffold/baseline </Text>
            <Text color={ratioColor(ratio)} bold>
              {ratio.toFixed(1)}×
            </Text>
            <Text dimColor>{ratio > 4 ? ' (over PRD gate)' : ''}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function costRatio(completed: { agent: string; estimatedCostUsd: number }[]): number | null {
  let scaffold = 0;
  let baseline = 0;
  for (const r of completed) {
    if (r.agent === 'scaffold') scaffold += r.estimatedCostUsd;
    if (r.agent === 'baseline') baseline += r.estimatedCostUsd;
  }
  if (baseline === 0 || scaffold === 0) return null;
  return scaffold / baseline;
}

function ratioColor(r: number): string {
  if (r <= 4) return 'green';
  if (r <= 8) return 'yellow';
  return 'red';
}
