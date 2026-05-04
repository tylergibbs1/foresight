import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ProposerPanel } from './panels/ProposerPanel.tsx';
import { PredictorPanel } from './panels/PredictorPanel.tsx';
import { ScorerPanel } from './panels/ScorerPanel.tsx';
import { ExecutorPanel } from './panels/ExecutorPanel.tsx';
import { DiffPanel } from './panels/DiffPanel.tsx';
import { CalibratorPanel } from './panels/CalibratorPanel.tsx';
import { Sparkline } from './Sparkline.tsx';
import { agentColor, fmtElapsed } from './format.ts';
import type { DashboardState } from './state.ts';

export function Focus({ state }: { state: DashboardState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const active = state.active;
  if (!active) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>focus mode · waiting for the next active run…</Text>
        <Box marginTop={1}>
          <Text dimColor>press </Text>
          <Text>f</Text>
          <Text dimColor> to return to overview, </Text>
          <Text>q</Text>
          <Text dimColor> to quit</Text>
        </Box>
      </Box>
    );
  }

  // Only scaffold runs have phase data; for baseline/thinking, fall through
  // to a degraded view.
  if (active.agent !== 'scaffold') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>focus mode is scaffold-only.</Text>
        <Text dimColor>active run is </Text>
        <Text color={agentColor[active.agent]}>{active.agent}</Text>
        <Text dimColor> · waiting for next scaffold run, or press </Text>
        <Text>f</Text>
        <Text dimColor> for overview.</Text>
      </Box>
    );
  }

  const detail = active.current;
  const elapsed = fmtElapsed(now - active.startedAt);
  const f1 = detail?.predictionScore?.f1;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor={agentColor[active.agent]} paddingX={1}>
        <Box>
          <Text bold color={agentColor[active.agent]}>focus</Text>
          <Text dimColor>  ·  </Text>
          <Text wrap="truncate-end">{active.taskId}</Text>
          <Text dimColor>  ·  seed={active.seed}  ·  {elapsed}  ·  turn {detail?.turn ?? active.turns.length}</Text>
        </Box>
        <Box>
          <Text dimColor>F1 </Text>
          <Sparkline values={active.f1History} width={12} />
          {f1 !== undefined && <Text dimColor>  cur {f1.toFixed(2)}</Text>}
        </Box>
      </Box>

      <ProposerPanel detail={detail} />
      <PredictorPanel detail={detail} />
      <ScorerPanel detail={detail} />
      <ExecutorPanel detail={detail} />
      <DiffPanel detail={detail} />
      <CalibratorPanel detail={detail} />

      <Box marginTop={1}>
        <Text dimColor>press </Text>
        <Text>f</Text>
        <Text dimColor> for overview · </Text>
        <Text>q</Text>
        <Text dimColor> to quit</Text>
      </Box>
    </Box>
  );
}
