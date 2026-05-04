/**
 * Minimal runnable example. Requires:
 *   bun install
 *   OPENAI_API_KEY=sk-... bun run examples/quickstart.ts
 *
 * Demonstrates the full happy-and-sad path: same goal, two actions, see how
 * the gate handles each. ~$0.20 total in API spend.
 */
import { foresight } from '../src/index.ts';
import { openai } from '@ai-sdk/openai';

const TOOL_CATALOG = [
  { name: 'crud_delete', description: 'Delete a record from a collection.', args: '{ collection: string, id: string }' },
  { name: 'crud_list',   description: 'List records in a collection.',      args: '{ collection: string }' },
  { name: 'crud_update', description: 'Patch a record.',                    args: '{ collection: string, id: string, patch_json: string }' },
];

// A toy world: two users and two orders, both belonging to user 3.
// Deleting user 3 would orphan both orders — that's what we want the gate to catch.
const state = {
  crud: {
    users:  { '1': { name: 'alice' }, '3': { name: 'carol' } },
    orders: { '47': { user_id: '3', total: 12 }, '92': { user_id: '3', total: 5 } },
  },
};

const model = openai('gpt-5.5');

async function check(label: string, action: any) {
  console.log(`\n=== ${label} ===`);
  console.log(`action: ${action.tool}(${JSON.stringify(action.args)})`);
  const decision = await foresight.gate({
    goal: 'Remove user 3 from the system',
    action,
    state,
    catalog: TOOL_CATALOG,
    model,
    signal: AbortSignal.timeout(60_000),
    hooks: {
      onPredict: ({ ms, usage }) => console.log(`  predict: ${ms.toFixed(0)}ms, ${usage.totalTokens} tokens`),
      onScore:   ({ ms, usage, decision }) => console.log(`  score:   ${ms.toFixed(0)}ms, ${usage.totalTokens} tokens, ok=${decision.ok}`),
      onNote:    ({ ms, usage }) => console.log(`  note:    ${ms.toFixed(0)}ms, ${usage.totalTokens} tokens`),
    },
  });
  console.log(`\n→ ok: ${decision.ok}`);
  console.log(`  reason: ${decision.reason}`);
  if (decision.risks_blocking.length) {
    console.log(`  blocking: ${decision.risks_blocking.join('; ')}`);
  }
  console.log(`  reversibility: ${decision.risks.reversibility}, blast: ${decision.risks.blast_radius}`);
  console.log(`  total cost: ${decision.usage.totalTokens} tokens`);
}

// 1. The naive action — delete the user without checking dependents.
//    Gate should REJECT.
await check('naive delete (would orphan)', {
  tool: 'crud_delete',
  args: { collection: 'users', id: '3' },
});

// 2. The safe action — list dependents first.
//    Gate should APPROVE (it's a read; can't break anything).
await check('safe — list dependents first', {
  tool: 'crud_list',
  args: { collection: 'orders' },
});
