<p align="center">
  <img src="diagrams/jepa-readme-hero-v3.png" alt="Look before you leap — an AI assistant that imagines its action before doing it" width="100%" />
</p>

# foresight

A small wrapper that makes an LLM agent **predict the outcome of its next
action before running it**, score the prediction against the goal, and refuse
when state shows the action shouldn't happen. Inspired by JEPA-style
world-model prediction, applied to tool-using agents.

In one sentence: the agent imagines a few possible next moves, picks the one
that doesn't break things, and only then acts.

This repo has two things:

1. **[`packages/foresight/`](packages/foresight/)** — the shippable library.
   A single async function (`foresight.gate`) that drops into any agent
   framework. Use this in your own project.
2. **`src/`** — the research scaffold and evaluation harness that produced
   the library. Reproduce the experiment, run the TUI, browse the trap
   tasks. Useful if you want to verify the claims yourself.

---

## The library

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
// → "Visible state shows orders/47 and orders/92 reference user_id='3', so
//    deleting users/3 alone would leave both orders orphaned."
// proceed with the action
```

Plugs into Vercel AI SDK 6 (`needsApproval`), OpenAI Agents SDK
(`ToolInputGuardrail`), LangGraph (interrupt node), or any code that calls
async functions. Stateless, typed errors, AbortSignal, observability hooks,
per-role model split. Full docs: **[`packages/foresight/README.md`](packages/foresight/README.md)**.

---

## The experiment

The library exists because we ran a hypothesis test, found a real signal,
and stripped the result down to its load-bearing parts. The PRD is in
[`PRD.md`](PRD.md); the trap tasks are in `src/tasks/traps.ts`.

### Headline result (54-run paired eval, gpt-5.5, six implicit-trap families)

```
agent      success      destr/run   notes
baseline   7/18  (39%)  0.89        vanilla ToolLoopAgent
thinking   9/18  (50%)  0.61        same model + "think before acting" prompt
scaffold   18/18 (100%) 0.00        full predictor + scorer + calibrator pipeline
```

Scaffold prevented **16 destructive actions in paired comparison, took 0 extra**.
Cost ratio against baseline: ~26×. The economics don't justify general-purpose
use, which is why the library is positioned as a guardrail for **irreversible
actions you don't trust** — not as a replacement for your normal agent loop.

### Reproduce it

```bash
bun install
cp .env.example .env       # add OPENAI_API_KEY
bun test                   # LLM-free smoke tests (no API key needed)
bun run eval:smoke         # one task × one seed × scaffold (~$0.10)
bun run eval               # full paired eval, three agent variants (~$5)
```

---

## How the scaffold works

<p align="center">
  <img src="diagrams/jepa-pipeline-v1.png" alt="Per-turn pipeline of the JEPA scaffold" width="100%" />
</p>

Each agent turn runs six stages:

1. **Proposer** (LLM, no tools) emits 3–8 candidate next actions as inert data.
2. **Validator + dedupe** (deterministic) drops malformed candidates and
   collapses duplicates before any predictor LLM calls run.
3. **Predictor × N** (LLM, parallel, **goal-blind**) produces a typed
   `ChangeEvent[]` prediction plus risk metadata per candidate. Goal-blind so
   it predicts consequences, not desirability.
4. **Scorer** (LLM) ranks the predictions against the goal — penalizing
   irreversibility, data loss, wide blast radius, and unverified preconditions.
5. **Executor** (deterministic) runs the chosen action. The only step that
   mutates state.
6. **Calibrator** (LLM) compares predicted vs actual `ChangeEvent[]` and emits
   a structured note that future predictor calls can use.

Two termination paths:

- **`noop` sentinel** — when state inspection shows no action should be taken
  (e.g. a precondition is missing), the proposer can emit a `noop` candidate.
  If the scorer picks it, the loop exits without mutation.
- **goal-met short-circuit** — at the start of each turn after the first, the
  evaluator checks whether the world already satisfies the goal.

The deterministic correctness metric is F1 on canonical change-event keys
(`<type>:<id>:<op>:<field>`) — no LLM judging in the metric path.

The library uses a simplified version of this pipeline (single action, no
proposer fan-out, no calibration loop) because most production callers
already have an agent that proposes actions; they just want a predictive
gate around the dangerous ones.

## CLI + TUI

```
bun src/eval/cli.ts \
  --agents scaffold,baseline,thinking  # which to run (default: all three)
  --tasks 20                   # cap the number of task instances
  --seeds 3                    # repeats per agent × task
  --candidates 5               # proposer candidate count
  --notes-to-predictor true    # feed calibration notes to predictor
  --scorer-mode comparative    # comparative | independent
  --max-turns 20
  --out results/run-<ts>.json
```

`bun run tui` opens a live dashboard. Press `f` to flip into a per-phase
focus view that shows the proposer's candidates, predictor's typed events,
scorer's rankings, executor's diff, and calibrator's note as each phase fills in.

Three agent variants for paired comparison:

- `scaffold` — the full JEPA-style pipeline.
- `baseline` — vanilla `ToolLoopAgent`, same model and tools, no extra prompt.
- `thinking` — same as baseline plus a "reason before acting" instruction.
  Token-budget control: a scaffold win that doesn't beat `thinking` is just
  "more deliberation tokens", not architectural value.

Runs are paired: same task + same seed → identical initial world state across
all variants.

## Layout

```
packages/
  foresight/            # the shippable library — start here if you just want to use it
    src/                # gate, predict, score, matchEvents, errors, types
    tests/              # 32 tests, including adapter integrations for AI SDK 6,
                        # OpenAI Agents, and LangGraph
    examples/           # runnable quickstart
    README.md           # full library docs

src/                    # the experiment that produced the library
  env/                  # in-memory FS + CRUD world, snapshots, diffs
  tasks/                # task definitions + automated correctness checks
                        # (incl. trap_orphan, trap_overwrite, trap_glob, trap_chain)
  agents/               # proposer, predictor, scorer, calibrator, scaffold, baseline, lite
  eval/                 # runner, metrics, CLI + TUI entrypoints
  test/                 # bun:test smoke tests (LLM-free)

scripts/                # diag.ts (per-turn debugger) + compare.ts (paired analysis)
diagrams/               # README hero + per-turn pipeline diagram
results/                # eval JSON output (gitignored)
PRD.md                  # the design doc
```

## License

MIT
