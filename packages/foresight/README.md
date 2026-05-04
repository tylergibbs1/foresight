# foresight

A drop-in **predictive-approval gate** for LLM agents. Predict an action's
outcome before running it, score that prediction against the goal, return a
structured `approve` / `reject` decision. Plugs into any agent framework via
a single async function — not a framework itself.

```ts
import { foresight } from 'foresight';
import { openai } from '@ai-sdk/openai';

const decision = await foresight.gate({
  goal: 'Remove user 3 from the system',
  action: { tool: 'crud_delete', args: { collection: 'users', id: '3' } },
  state: () => snapshotMyDb(),
  catalog: TOOL_CATALOG,
  model: openai('gpt-5.5'),
});

if (!decision.ok) throw new Error(decision.reason);
// proceed
```

## What it does

```
goal + action + state  →  ┌────────────────────────────────────┐
                          │ predictor (LLM, goal-blind)        │
                          │   → typed ChangeEvent[]            │
                          │   → risk metadata                  │
                          ├────────────────────────────────────┤
                          │ scorer (LLM, sees goal + state)    │
                          │   → approve | reject               │
                          │   → reason / blocking risks /      │
                          │       goal alignment               │
                          ├────────────────────────────────────┤
                          │ note (LLM, optional, best-effort)  │
                          │   → structured lesson              │
                          └────────────────────────────────────┘
                                      → Decision
```

You decide what to do with the decision. Throw. Return early. Surface to UI.
Prompt a human. Escalate. Log. The library is a pure function: no agent loop,
no orchestration, no lifecycle events.

## Why it exists

Existing agent frameworks already provide:

- Human-in-the-loop tool approval (Vercel AI SDK `needsApproval`, LangGraph
  `interrupt()`, OpenAI Agents SDK guardrails).
- Static or LLM-as-validator guardrails ("is this SQL safe?").
- Tool-level safety wrappers.

What none of them do: **predict what an action will *do*, and judge whether
the predicted outcome matches the goal**. That's a different question and
it's the right question for irreversible actions.

`foresight.gate()` is what a sufficiently rich `needsApproval` would look
like if it could imagine the action's consequences automatically.

## Install

```bash
npm install foresight ai zod @ai-sdk/openai
```

Peer deps: `ai >=6.0.0-beta.128`, `zod ^3.23.0`. The provider package
(`@ai-sdk/openai` etc) is whichever one you already use to construct your
model.

## API

Single primary function plus three lower-level pieces and a measurement
helper:

```ts
foresight.gate(opts: GateOptions): Promise<Decision>          // the standard path
foresight.predict(opts: PredictArgs): Promise<{ prediction, usage }>
foresight.score(opts: ScoreArgs): Promise<{ decision, usage }>
foresight.matchEvents(predicted, actual): MatchScore          // post-hoc accuracy
```

### `GateOptions`

```ts
{
  goal: string;                                // what the agent is trying to do
  action: { tool, args, rationale? };          // the action to evaluate (NOT executed)
  state: WorldState | (() => WorldState | Promise<WorldState>);
  catalog: ToolCatalogEntry[];                 // tool name + description + arg shape
  notes?: CalibrationNote[];                   // priors from prior calls (optional)

  model: LanguageModel;                        // default model (e.g. openai('gpt-5.5'))
  predictModel?: LanguageModel;                // override per role
  scoreModel?: LanguageModel;
  noteModel?: LanguageModel;

  skipNote?: boolean;                          // skip the third LLM call
  signal?: AbortSignal;                        // cancellation
  hooks?: GateHooks;                           // observability callbacks
}
```

### `Decision`

```ts
{
  ok: boolean;                                 // approve | reject
  reason: string;                              // single concrete sentence

  predicted_changes: ChangeEvent[];            // typed events
  risks: {
    confidence, reversibility, data_loss_risk,
    blast_radius, unverified_preconditions, side_effects,
  };

  risks_blocking: string[];                    // why it was rejected (UI-renderable)
  goal_alignment: string[];                    // how it advances the goal (when ok)
  noop_recommended: boolean;                   // scorer thinks "do nothing" is right

  note: CalibrationNote | null;                // structured lesson; persist & feed back

  usage: { promptTokens, completionTokens, totalTokens };
}
```

### Errors

`gate()` throws typed errors so callers can branch on cause:

```ts
import {
  ForesightError,           // base; catch all
  ForesightInputError,      // malformed GateOptions — programming error
  ForesightPredictError,    // predictor LLM call failed
  ForesightScoreError,      // scorer LLM call failed (.prediction is preserved)
  ForesightAbortError,      // signal aborted
} from 'foresight';
```

### Observability

Wire each phase into your logger / Langfuse / OpenTelemetry / Logfire:

```ts
await foresight.gate({
  ...,
  hooks: {
    onPredict: ({ usage, ms })           => trace('predict', { ms, ...usage }),
    onScore:   ({ usage, ms, decision }) => trace('score',   { ms, ok: decision.ok }),
    onNote:    ({ usage, ms })           => trace('note',    { ms, ...usage }),
  },
});
```

Hooks are optional; off by default.

### Cancellation

Standard `AbortSignal`:

```ts
await foresight.gate({
  ...,
  signal: AbortSignal.timeout(30_000),
});
// → throws ForesightAbortError on timeout
```

### Per-role model split

```ts
import { openai } from '@ai-sdk/openai';

await foresight.gate({
  ...,
  model:        openai('gpt-5.5'),       // default for any role you don't override
  predictModel: openai('gpt-5.5'),       // careful reasoning matters most here
  scoreModel:   openai('gpt-5-mini'),    // structured ranking is easier
  noteModel:    openai('gpt-5-mini'),
});
```

## Stateless calibration

`foresight` doesn't store anything. If you want the predictor to learn from
prior sessions, persist the `note` field yourself and pass the array back in
on the next call:

```ts
const notes = await loadNotesFromDb();
const decision = await foresight.gate({ ..., notes });
if (decision.note) await saveNoteToDb(decision.note);
```

No global state, no internal cache, no surprise side effects. Caller controls
persistence; library does prediction.

## Caching

Not built in. The library is a pure function — wrap it with whatever cache
layer fits your infra (LRU, Redis, KV). A common pattern:

```ts
const cached = await myCache.get(hashOf(goal, action, state));
if (cached) return cached;
const decision = await foresight.gate({...});
await myCache.set(hashOf(goal, action, state), decision);
return decision;
```

Caching at the gate level is rarely the right move (state changes between
calls); cache at the predictor level if anywhere.

## Measuring prediction quality

After running the action, compute the actual diff and compare:

```ts
import { foresight } from 'foresight';
import { diffEvents } from 'foresight/diff';

const before = await snapshotMyState();
await runAction(action);
const after = await snapshotMyState();

const actual = diffEvents(before, after);
const score = foresight.matchEvents(decision.predicted_changes, actual);
// { precision: 1.0, recall: 0.5, f1: 0.67, predictedOnly: [...], actualOnly: [...] }
```

`matchEvents` is deterministic — set-equality on canonical event keys, no LLM
in the metric path.

## Adapter examples

### Vercel AI SDK 6 — `needsApproval`

```ts
import { tool } from 'ai';
import { z } from 'zod';
import { foresight } from 'foresight';

const deleteUser = tool({
  inputSchema: z.object({ collection: z.string(), id: z.string() }),
  needsApproval: async (args, ctx) => {
    const d = await foresight.gate({
      goal: ctx.messages.at(-1)?.content as string,
      action: { tool: 'crud_delete', args },
      state: () => snapshotDb(),
      catalog: TOOL_CATALOG,
      model: openai('gpt-5.5'),
      signal: ctx.abortSignal,
    });
    return !d.ok; // true = require human approval / block
  },
  execute: async args => deleteFromDb(args),
});
```

### OpenAI Agents SDK — `ToolInputGuardrail`

```ts
import type { ToolInputGuardrail } from '@openai/agents';
import { foresight, ForesightAbortError } from 'foresight';

const foresightGuard: ToolInputGuardrail = {
  name: 'foresight',
  execute: async ({ toolInput, context }) => {
    try {
      const d = await foresight.gate({
        goal: context.userMessage,
        action: { tool: context.toolName, args: toolInput },
        state: () => snapshotDb(),
        catalog: TOOL_CATALOG,
        model: openai('gpt-5.5'),
      });
      return d.ok
        ? { behavior: 'allow' }
        : { behavior: 'rejectContent', message: d.reason };
    } catch (e) {
      if (e instanceof ForesightAbortError) return { behavior: 'allow' };
      throw e;
    }
  },
};
```

### LangGraph — node that interrupts on rejection

```ts
import { interrupt } from '@langchain/langgraph';
import { foresight } from 'foresight';

async function foresightCheck(state: AgentState) {
  const d = await foresight.gate({
    goal: state.goal,
    action: state.pending_action,
    state: () => snapshotDb(),
    catalog: TOOL_CATALOG,
    model: openai('gpt-5.5'),
  });
  if (!d.ok) {
    interrupt({
      kind: 'foresight_rejected',
      reason: d.reason,
      blocking: d.risks_blocking,
      predicted: d.predicted_changes,
      noop_recommended: d.noop_recommended,
    });
  }
  return state;
}
```

### No framework — just call it before risky code

```ts
const d = await foresight.gate({ goal, action, state, catalog, model });
if (!d.ok) return { error: d.reason, blocking: d.risks_blocking };
await actuallyDoTheThing(action);
```

## State shape

```ts
type WorldState = {
  fs?:   Record<string, string>;                              // path → content
  crud?: Record<string, Record<string, Record<string, any>>>; // collection → id → record
};
```

If your domain isn't files + records, translate it into this shape before
calling. The predictor's typed `ChangeEvent` schema speaks `target_type`
(`file` | `record`), so anything you can model as one of those works
directly.

## Cost

`foresight.gate()` is 2–3 LLM calls per invocation. Use it on the **5
actions you don't trust**, not on every action. The economics work when each
prevented destructive action saves hours of cleanup.

## Run the quickstart

```bash
git clone https://github.com/...../foresight
cd packages/foresight
bun install
OPENAI_API_KEY=sk-... bun run examples/quickstart.ts
```

The quickstart shows the gate accepting a safe action and rejecting a
destructive one against the same goal. ~$0.20 in API spend.

## Scripts

```
bun run typecheck   # tsc --noEmit
bun run test        # bun:test
bun run build       # tsc to dist/
```

## License

MIT
