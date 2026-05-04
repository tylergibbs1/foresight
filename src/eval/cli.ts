#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs';
import { runEval, summarize } from './runner.ts';
import { parseArgs } from './args.ts';

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  console.log(`config: ${JSON.stringify({ ...a, out: a.out }, null, 2)}`);

  const result = await runEval({
    model: a.model,
    miniModel: a.miniModel,
    agents: a.agents,
    seeds: a.seeds,
    candidateCount: a.candidates,
    notesToPredictor: a.notesToPredictor,
    scorerMode: a.scorerMode,
    maxTurns: a.maxTurns,
    taskLimit: a.tasks,
    taskFilter: a.taskFilter ? t => t.id.includes(a.taskFilter!) : undefined,
    onProgress: line => console.log(line),
  });

  mkdirSync('results', { recursive: true });
  writeFileSync(a.out, JSON.stringify(result, null, 2));
  console.log(`\nwrote ${a.out}`);

  const summary = summarize(result);
  console.log('\nsummary by (family, agent):');
  console.log(
    `  ${'family'.padEnd(16)} ${'agent'.padEnd(10)} ${'success'.padEnd(10)} ${'destr/run'.padEnd(11)} ${'tokens'.padEnd(10)} ${'cost'.padEnd(10)} failure kinds`,
  );
  for (const s of summary) {
    const kinds = Object.entries(s.failureKindCounts)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    console.log(
      `  ${s.family.padEnd(16)} ${s.agent.padEnd(10)} ` +
        `${`${s.successes}/${s.runs} (${(s.successRate * 100).toFixed(0)}%)`.padEnd(10)} ` +
        `${s.destructiveMean.toFixed(2).padEnd(11)} ` +
        `${String(s.tokensTotal).padEnd(10)} $${s.costUsd.toFixed(4).padEnd(8)} ${kinds}`,
    );
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
