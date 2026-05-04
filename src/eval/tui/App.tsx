import { useEffect, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Dashboard } from './Dashboard.tsx';
import { Focus } from './Focus.tsx';
import { Summary } from './Summary.tsx';
import { initialState, reduce } from './state.ts';
import type { CliArgs } from '../args.ts';
import { runEval } from '../runner.ts';
import type { RunnerEvent } from '../events.ts';

type Mode = 'overview' | 'focus';

export function App({ args }: { args: CliArgs }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [state, dispatch] = useReducer(reduce, initialState);
  const [mode, setMode] = useState<Mode>(args.mode);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  useInput(
    (input, key) => {
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
        exit();
      } else if (input === 'f') {
        setMode(m => (m === 'overview' ? 'focus' : 'overview'));
      }
    },
    { isActive: isRawModeSupported },
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const onEvent = (e: RunnerEvent) => dispatch(e);

    runEval({
      model: args.model,
      agents: args.agents,
      seeds: args.seeds,
      candidateCount: args.candidates,
      notesToPredictor: args.notesToPredictor,
      scorerMode: args.scorerMode,
      maxTurns: args.maxTurns,
      taskLimit: args.tasks,
      taskFilter: args.taskFilter
        ? t => t.id.includes(args.taskFilter!)
        : undefined,
      onEvent,
    })
      .then(output => {
        mkdirSync('results', { recursive: true });
        writeFileSync(args.out, JSON.stringify(output, null, 2));
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : String(e));
      });
  }, [args]);

  if (errorMsg) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>error</Text>
        <Text>{errorMsg}</Text>
        <Box marginTop={1}>
          <Text dimColor>press q to quit</Text>
        </Box>
      </Box>
    );
  }

  if (state.done && state.output) {
    return (
      <Box flexDirection="column">
        <Dashboard state={state} mode={mode} />
        <Summary output={state.output} outPath={args.out} />
      </Box>
    );
  }

  return mode === 'focus' ? <Focus state={state} /> : <Dashboard state={state} mode={mode} />;
}
