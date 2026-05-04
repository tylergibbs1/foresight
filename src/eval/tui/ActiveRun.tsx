import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { ActiveRunState, ActiveTurn } from './state.ts';
import { agentColor, bar, fmtArgs, fmtElapsed } from './format.ts';

export function ActiveRun({ active, now }: { active: ActiveRunState | null; now: number }) {
  if (!active) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1} minHeight={5}>
        <Text dimColor>idle…</Text>
      </Box>
    );
  }
  const elapsed = fmtElapsed(now - active.startedAt);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={agentColor[active.agent]} paddingX={1}>
      <Box>
        <Spinner />
        <Text>  </Text>
        <Text bold color={agentColor[active.agent]}>{active.agent}</Text>
        <Text dimColor> · </Text>
        <Text>{active.taskId}</Text>
        <Text dimColor>  seed={active.seed}  · {elapsed}</Text>
      </Box>
      {active.turns.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>waiting for first action…</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {active.turns.map(t => (
            <TurnLine key={t.turn} turn={t} agent={active.agent} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function TurnLine({ turn, agent }: { turn: ActiveTurn; agent: ActiveRunState['agent'] }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">t{String(turn.turn).padStart(2)}</Text>
        <Text>  </Text>
        <Text bold>{turn.toolName}</Text>
        <Text dimColor>  {fmtArgs(turn.args)}</Text>
      </Box>
      {agent === 'scaffold' && turn.score && (
        <Box marginLeft={4}>
          <Text dimColor>F1 </Text>
          <Text color={f1Color(turn.score.f1)}>{bar(turn.score.f1, 1, 12)}</Text>
          <Text> </Text>
          <Text>{turn.score.f1.toFixed(2)}</Text>
          <Text dimColor>  P={turn.score.precision.toFixed(2)} R={turn.score.recall.toFixed(2)}</Text>
          {(turn.candidatesCount ?? 0) > 0 && (
            <Text dimColor>  cand={turn.candidatesCount}</Text>
          )}
          {turn.executionError && (
            <Text color="red">  err: {turn.executionError.slice(0, 40)}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function f1Color(f1: number): string {
  if (f1 >= 0.8) return 'green';
  if (f1 >= 0.5) return 'yellow';
  return 'red';
}
