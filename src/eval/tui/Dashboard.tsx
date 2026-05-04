import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Header } from './Header.tsx';
import { CompletedRuns } from './CompletedRuns.tsx';
import { ActiveRun } from './ActiveRun.tsx';
import { Aggregate } from './Aggregate.tsx';
import type { DashboardState } from './state.ts';

export function Dashboard({
  state,
  mode = 'overview',
}: {
  state: DashboardState;
  mode?: 'overview' | 'focus';
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column">
      <Header state={state} now={now} />
      <CompletedRuns runs={state.completed} />
      <ActiveRun active={state.active} now={now} />
      <Aggregate completed={state.completed} />
      <Box marginTop={1}>
        <Text dimColor>press </Text>
        <Text>f</Text>
        <Text dimColor> for focus mode (per-phase pipeline) · </Text>
        <Text>q</Text>
        <Text dimColor> to quit{state.done ? ' · run complete' : ''}{mode === 'focus' ? ' · in focus' : ''}</Text>
      </Box>
    </Box>
  );
}
