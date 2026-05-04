import { join } from 'node:path';
import type { AgentChoice } from './runner.ts';
import type { ScorerMode } from '../agents/scorer.ts';

export interface CliArgs {
  agents: AgentChoice[];
  tasks?: number;
  seeds: number;
  candidates: number;
  notesToPredictor: boolean;
  scorerMode: ScorerMode;
  maxTurns: number;
  model: string;
  /** If set, scaffold uses this model for predictor/scorer/calibrator. Proposer stays on `model`. */
  miniModel?: string;
  out: string;
  taskFilter?: string;
  /** TUI only: which mode to start in. */
  mode: 'overview' | 'focus';
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    agents: ['lite', 'baseline', 'thinking', 'scaffold'],
    seeds: 3,
    candidates: 5,
    notesToPredictor: true,
    scorerMode: 'comparative',
    maxTurns: 20,
    model: process.env.MODEL ?? 'openai/gpt-5.5',
    out: join('results', `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    mode: 'overview',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--agents': out.agents = next()!.split(',').map(s => s.trim() as AgentChoice); break;
      case '--tasks': out.tasks = Number(next()); break;
      case '--seeds': out.seeds = Number(next()); break;
      case '--candidates': out.candidates = Number(next()); break;
      case '--notes-to-predictor': out.notesToPredictor = next() !== 'false'; break;
      case '--scorer-mode': out.scorerMode = next() as ScorerMode; break;
      case '--max-turns': out.maxTurns = Number(next()); break;
      case '--model': out.model = next()!; break;
      case '--mini-model': out.miniModel = next()!; break;
      case '--out': out.out = next()!; break;
      case '--task-filter': out.taskFilter = next(); break;
      case '--mode': {
        const v = next();
        if (v !== 'overview' && v !== 'focus') {
          console.error(`--mode must be overview or focus, got ${v}`);
          process.exit(2);
        }
        out.mode = v;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        if (a !== undefined && a.startsWith('--')) {
          console.error(`unknown arg: ${a}`);
          process.exit(2);
        }
    }
  }
  return out;
}

export function printHelp() {
  console.log(`Usage: bun src/eval/cli.ts [options]
       bun src/eval/tui.tsx [options]

Options:
  --agents scaffold,baseline,thinking  (default: all three)
  --tasks N                   cap number of task instances
  --seeds N                   repeats per agent x task (default: 3)
  --candidates N              proposer candidate count (default: 5)
  --notes-to-predictor BOOL   feed calibration notes to predictor (default: true)
  --scorer-mode MODE          comparative | independent (default: comparative)
  --max-turns N               (default: 20)
  --model STRING              (default: $MODEL or openai/gpt-5.5)
  --task-filter STRING        substring to filter task ids by
  --out PATH                  output JSON path
  --mode overview|focus       (TUI only) which mode to start in
`);
}
