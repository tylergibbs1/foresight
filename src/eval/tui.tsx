#!/usr/bin/env bun
import { render } from 'ink';
import { App } from './tui/App.tsx';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const { waitUntilExit } = render(<App args={args} />);
await waitUntilExit();
