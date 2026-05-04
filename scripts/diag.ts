import { runScaffold } from '../src/agents/scaffold.ts';
import { makeWorld } from '../src/env/reset.ts';
import { allTasks } from '../src/tasks/index.ts';
import { describeEvent } from '../src/env/types.ts';

const taskId = process.argv[2] ?? 'trap_overwrite.config-version';
const task = allTasks.find(t => t.id === taskId);
if (!task) {
  console.error(`unknown task ${taskId}`);
  process.exit(2);
}

const world = makeWorld();
task.setup(world);

const result = await runScaffold({
  model: process.env.MODEL ?? 'openai/gpt-5.5',
  world,
  task,
  maxTurns: 8,
  candidateCount: 3,
  notesToPredictor: true,
  scorerMode: 'comparative',
  onTurn: rec => {
    console.log(`\n══ turn ${rec.turn} ══`);
    console.log('candidates:');
    for (let i = 0; i < rec.candidates.length; i++) {
      const c = rec.candidates[i]!;
      const star = i === rec.chosenIndex ? '★' : ' ';
      console.log(`  ${star} ${i}  ${c.tool} ${JSON.stringify(c.args).slice(0, 80)}`);
    }
    console.log('predictions:');
    for (let i = 0; i < rec.predictions.length; i++) {
      const p = rec.predictions[i]!;
      const events = p.expected_changes.map(describeEvent).join(' | ') || '(none)';
      console.log(`    ${i}  Δ=${p.expected_changes.length} conf=${p.confidence} ${events.slice(0, 100)}`);
    }
    console.log('scoring:');
    for (const r of rec.scoring.rankings.sort((a, b) => a.candidate_index - b.candidate_index)) {
      const star = r.candidate_index === rec.chosenIndex ? '★' : ' ';
      console.log(`  ${star} ${r.candidate_index}  ${r.score.toFixed(1)}  ${r.reasoning.slice(0, 80)}`);
    }
    console.log(`chose: ${rec.chosen.tool}(${JSON.stringify(rec.chosen.args).slice(0, 80)})`);
    console.log(`F1=${rec.predictionScore.f1.toFixed(2)}  exec=${rec.executionError ?? 'ok'}`);
    console.log(`actual events:`);
    for (const e of rec.actualEvents) console.log(`  - ${describeEvent(e)}`);
    console.log(`note: [${rec.calibrationNote.applies_to_tool}] ${rec.calibrationNote.lesson}`);
  },
});

console.log(`\n──── done: ${result.stoppedReason} after ${result.turns} turns ────`);
const evalRes = task.evaluate(world, world.snapshot());
console.log(`success=${evalRes.success}`);
if (evalRes.failureReasons.length) console.log('failures:', evalRes.failureReasons);
if (evalRes.destructiveActions.length) console.log('destructive:', evalRes.destructiveActions);
