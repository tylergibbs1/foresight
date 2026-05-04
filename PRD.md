# PRD: JEPA-Style Scaffold for LLM Agents

**Status:** Hypothesis test, not framework
**Stack:** TypeScript, Bun 1.x (primary), Node 24.15.0 (compatibility check), Vercel AI SDK 6
**Provider:** OpenAI
**Last updated:** 2026-05-03 (rev 2: architectural review pass)

## What we're testing

Can a predictor + scorer + calibrator loop wrapped around an LLM agent produce better action selection than a vanilla ReAct agent on tasks with irreversible side effects?

The phase 2 question (build a framework) only makes sense if phase 1 (does the mechanism work) gives us a clear yes.

## Hypothesis

On a defined task set with irreversible actions, an agent using the JEPA scaffold will:

1. Complete more tasks successfully than a baseline `ToolLoopAgent`
2. Execute fewer destructive or wasted actions
3. Show measurable reduction in prediction error across a session (the calibration loop actually does something)

What failure looks like: scaffold matches baseline on success rate but costs 3x more tokens, or the predictor's state summaries are too vague for the scorer to discriminate between candidates.

## Why test before building

Building a framework on an unvalidated mechanism is expensive. If predicted-state abstractions turn out vague, or calibration never converges within a session, the framework abstraction is built on sand. One focused week answers this.

## Architecture

```
Goal + State
     ↓
Proposer (generateObject, no tools)
     ↓ inert ActionSpec[]
Static Validator + Dedupe          ← deterministic, no LLM
     ↓
Predictor × N (generateObject, no tools, goal-blind, fan-out per candidate)
     ↓ Prediction[] with typed change events + risk metadata
Scorer (generateObject)
     ↓ ranking by outcome × risk
Executor (direct tool invocation, no LLM hop)
     ↓
Diff Engine (typed ChangeEvent[])  ← deterministic
     ↓
Calibrator → structured note + F1
```

Only the executor mutates the world. The proposer emits **inert action specs**
(`{tool, args, rationale}`); a static validator drops malformed candidates
against the actual tool schemas; a deterministic dedupe collapses
semantically-equivalent candidates before any predictor calls run.

### Proposer

Generates 3 to 8 candidate actions, deduped to ~5 distinct ones before fan-out.

**Inert by construction.** The proposer is a `generateObject` call with **no
tools attached**. It emits `{tool, args, rationale}` triples as data. The
original sketch used `ToolLoopAgent` with `stopWhen: stepCountIs(1)`, which
does not actually prevent execution: in AI SDK 6, a step includes tool
execution, and `stepCountIs(1)` stops *after* one step has run. Only the
executor materializes a chosen action.

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const ProposalSchema = z.object({
  candidates: z.array(z.object({
    tool: z.string().describe('Name of the tool that would execute this action.'),
    args: z.record(z.string(), z.unknown())
      .describe('Arguments matching the tool input schema.'),
    rationale: z.string().max(160)
      .describe('Why this is a plausible next action.'),
  })).min(3).max(5),
});

const { object: proposal } = await generateObject({
  model: 'openai/gpt-5.4',
  schema: ProposalSchema,
  system: PROPOSER_PROMPT,
  prompt: buildProposerInput(state, goal, toolCatalog),
});
```

Schema note: `z.record()` with arbitrary keys is flagged below as an OpenAI strict-mode gotcha. We use it here only because the args shape varies per tool. If strict mode rejects it, fall back to a stringified-JSON `args` field with a follow-up parse.

### Predictor

Input: current state + one candidate action.
Output: structured prediction with **typed `ChangeEvent[]`**, not strings:

```ts
const ChangeEventSchema = z.object({
  target_type: z.enum(['file', 'record']),
  target_id: z.string(),                    // path or "<collection>/<id>"
  operation: z.enum(['create', 'update', 'delete', 'rename', 'noop']),
  field: z.string().nullable(),             // for record-update field-level events
  before: z.string().nullable(),
  after: z.string().nullable(),
});

const PredictionSchema = z.object({
  expected_changes: z.array(ChangeEventSchema),
  side_effects: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  reversibility: z.enum([
    'fully_reversible',
    'reversible_with_backup',
    'partially_reversible',
    'irreversible',
    'unknown',
  ]),
  data_loss_risk: z.enum(['none', 'low', 'medium', 'high']),
  blast_radius: z.enum(['narrow', 'wide', 'unknown']),
  unverified_preconditions: z.array(z.string()),
});
```

**Why typed events, not strings.** A schema-only-but-string-valued
`expected_changes: string[]` still requires fuzzy semantic matching to score
against reality, which puts an LLM judge in the middle of the metric. With
typed events, matching is set-equality on a canonical key
(`${target_type}:${target_id}:${operation}:${field}`) against the world's
actual diff — no LLM judging anywhere in the metric path.

**Crucial constraint: goal-blind.** If the predictor knows the goal, it
hallucinates desirable outcomes. The flip side is that goal-blindness can hide
relevant facts (e.g. that a glob would also rename unintended files), so the
schema demands an **exhaustive write set**: one event per affected
(target, field). Underprediction costs as much as overprediction (see F1
below).

**Cost reality check.** This runs N times per agent turn (one call per
candidate). With 5 candidates that's 5 predictor calls before the scorer. Per
turn: 1 proposer + N predictor + 1 scorer + 1 calibrator (executor is direct,
no LLM). Total ≈ 8 LLM calls per turn at N=5.

### Scorer

Input: goal + array of predicted next states (no action descriptions, just predictions).
Output: structured rankings via `generateObject`:

```ts
const ScoreSchema = z.object({
  rankings: z.array(z.object({
    candidate_index: z.number().int().min(0),
    score: z.number().min(0).max(10),
    reasoning: z.string().max(200),
    goal_alignment: z.array(z.string())
      .describe('Which goal criteria this prediction satisfies.'),
    risks: z.array(z.string())
      .describe('Concerns about this predicted outcome.'),
  })),
  recommended_index: z.number().int().min(0),
});
```

Withholding the action descriptions forces the scorer to rank outcomes, not
intentions. But pure outcome-blindness hides operational risk that isn't
visible in the predicted post-state, so the scorer also sees the prediction's
**neutral risk metadata**: `confidence`, `reversibility`, `data_loss_risk`,
`blast_radius`, `unverified_preconditions`, `side_effects`. That keeps the
scorer outcome-focused without making it blind to safety. The numeric `score`
and explicit `recommended_index` give us a deterministic winner without
parsing prose.

### Executor

The only role with tools. A `ToolLoopAgent` configured with `stopWhen: stepCountIs(1)` so it executes the chosen action and returns. Same tool catalog the proposer was told about.

```ts
import { ToolLoopAgent, stepCountIs } from 'ai';

const executor = new ToolLoopAgent({
  model: 'openai/gpt-5.4',
  system: EXECUTOR_PROMPT,
  tools: { /* fs + crud */ },
  stopWhen: stepCountIs(1),
});
```

Approval-gate hooks stay off for the eval so scaffold and baseline are comparable.

### Calibrator

After execution, diff predicted events against actual events. Two pieces.

1. **Deterministic precision / recall / F1.** No LLM judging. We canonicalize
   the world diff into the same `ChangeEvent` shape the predictor emits and
   match by canonical key:

```ts
const predicted = new Set(prediction.expected_changes.map(eventKey));
const actual    = new Set(diffEvents(before, after).map(eventKey));
const tp        = [...predicted].filter(k => actual.has(k)).length;
const precision = tp / predicted.size;     // 0 → no LLM judge
const recall    = tp / actual.size;
const f1        = 2 * precision * recall / (precision + recall);
```

   Empty-set handling matters and is explicit:

   - `predicted=∅, actual=∅` → F1 = 1 (correct noop prediction).
   - `predicted=∅, actual=N>0` → F1 = 0 (missed everything).
   - `predicted=N>0, actual=∅` → F1 = 0 (phantom predictions).

   Filesystem `delete + create-with-same-content` pairs collapse to a single
   `rename` event during canonicalization so the predictor can emit one event,
   not two. CRUD updates produce one event per changed field, so per-field
   correctness shows up in the score.

2. **Structured calibration notes**, capped to a sliding window of the last K
   (default 10) so notes can't accumulate into prompt pollution:

```ts
const CalibrationNoteSchema = z.object({
  applies_to_tool: z.string(),
  applies_when: z.array(z.string()),
  observed_error_type: z.enum([
    'missed_target', 'phantom_change', 'wrong_field', 'wrong_value',
    'underprediction', 'overprediction', 'noop_mispredicted', 'no_error',
  ]),
  lesson: z.string(),
});
```

   Conditioning notes on `applies_to_tool` and `applies_when` is what keeps
   them from turning into superstitions. A lesson learned from
   `crud_update` shouldn't fire for `move_file`.

## Model strategy

Single OpenAI model across all roles for the first run: `gpt-5.4`, addressed via the AI SDK 6 gateway-style string `'openai/gpt-5.4'`. Same model on the baseline for a clean comparison.

If costs balloon (likely — 5 candidates means **1 + 5 + 1 + 1 + 1 = 9 LLM calls per agent turn**, not 5), consider splitting:

- Proposer: `gpt-5.4` (the hardest reasoning step)
- Predictor: `gpt-5.4-mini` or equivalent fast tier (constrained schema task, fanned out N×)
- Scorer: `gpt-5.4-mini` (constrained ranking task)
- Calibrator: `gpt-5.4-mini` (simple diff summarization)

Model splitting is a phase 1.5 optimization, not phase 1. Start with one model so we don't confound results — but do project the bill from a single end-to-end task on day 5 before committing the full eval.

## Why AI SDK 6 specifically

Three features land directly on what we need:

1. **`ToolLoopAgent`** gives us a clean baseline ReAct implementation without rewriting the loop, and a clean executor for the scaffold.
2. **`generateObject` with Zod** gives us strict schema enforcement on the proposer, predictor, scorer, and calibrator. This is the discipline that makes JEPA-flavored prediction work.
3. **`Output.object` on `ToolLoopAgent`** is the option that answers open question 5: a tool-using agent can also emit a final typed result. We don't need it for the predictor (no tools, plain `generateObject` is simpler), but if a future variant wants the executor to *both* run an action and report a structured post-condition, that's the path.
4. **DevTools** gives us per-step visibility into a multi-LLM-role flow. Without it, debugging this scaffold is going to be miserable.

## Why structured outputs are load-bearing

Structured outputs aren't a polish item here. They're the discipline that makes the whole experiment measurable.

**At the predictor.** Free-form prose hides vagueness inside hedging language ("might", "could potentially", "in some cases"). A schema field can't. Either there's an entry in `side_effects` or there isn't. Either `reversibility` is `'destructive'` or it isn't. The predictor has to commit.

**At the scorer.** Once predictions are structured, the scorer's job collapses from "read three paragraphs and rank them" to "given these three structured deltas, score against the goal." Easier task, more reproducible. Numeric `score` per candidate plus `recommended_index`, both parsable in code.

**At the calibrator.** This is where structure pays off most. Comparing structured `expected_changes` arrays against actual environment diffs is closer to set membership than to LLM-judged similarity. We can compute prediction accuracy as a real number and plot calibration delta over a session. Without structure, "did calibration improve" is itself an LLM judgment, and the hypothesis becomes unfalsifiable.

Without this discipline the project is just prompt-chaining. With it, there's a measurable abstraction layer between "what happens in the world" and "how we score it."

### Schema design constraints (OpenAI structured outputs gotchas)

OpenAI's structured outputs (used under the hood by `generateObject`) are strict. Things to design around:

- Avoid `z.union()` of complex objects. Use enums or discriminated unions instead.
- Avoid `z.record()` with arbitrary keys — models hallucinate or refuse. Use fixed object shapes when you can. The proposer's per-tool `args` is the one place we knowingly violate this; the fallback is a stringified-JSON field.
- `z.string().describe()` annotations get passed to the model and meaningfully change behavior. Treat them as mini-prompts on each field.
- Keep nesting shallow. Three levels deep is the practical limit before required fields start dropping.
- Mark optional fields with `.nullable()` rather than `.optional()` for OpenAI's strict mode compatibility.
- `.min()` / `.max()` on arrays and strings translate to JSON Schema constraints OpenAI mostly respects, but treat them as soft hints — validate post-hoc rather than relying on the model never violating them.

## Test environment

A Bun-served sandbox: filesystem operations under `/tmp/jepa-test-<uuid>/` plus a small CRUD API using `Bun.serve` with in-memory state.

Three task families:

1. **File refactors:** rename files matching a pattern, leave others alone
2. **Conditional updates:** update record N only if record M exists and has property P
3. **Sequenced operations:** apply migration B only if migration A succeeded

Each task has:

- Automated correctness check (final state diff against expected state)
- Easy way to fail destructively (delete wrong file, update wrong record, run migrations out of order)
- Branching choices where prediction should help

Target: 15 to 20 task instances. Run each task 3 times per agent variant for variance.

## Stack details

| Concern | Choice |
|---|---|
| Runtime (primary) | Bun 1.x |
| Runtime (compat check) | Node 24.15.0 |
| Language | TypeScript (Bun handles directly, no separate compile step) |
| Agent framework | Vercel AI SDK 6 (`ai` package, beta channel) |
| Provider package | `@ai-sdk/openai` (or gateway model strings via `'openai/...'`) |
| Model | `gpt-5.4` (uniform across roles for phase 1) |
| Schema validation | Zod (already required by AI SDK) |
| Test runner | `bun:test` (Jest-like) |
| HTTP server (mock CRUD) | `Bun.serve` |
| File IO | `Bun.file`, `Bun.write` |
| Lockfile | `bun.lock` (text format, current Bun) |
| Observability | AI SDK DevTools |
| Results | JSON files, one per run, parsed in analysis script |

### Required env

```
OPENAI_API_KEY=sk-...
```

### Why Bun

Faster install matters when the experiment iterates on dependency tweaks. Native TypeScript means no `tsx`/`ts-node` indirection. `Bun.serve` is a clean way to spin up the mock CRUD without bringing in Express. Built-in test runner means one less thing to configure.

### Why Node 24.15.0 still matters

Production agent frameworks generally target Node. We verify the test harness runs cleanly on Node 24.15.0 at least once before phase 2. This catches Bun-specific API leakage early rather than hitting it during framework migration.

### Project layout

```
jepa-scaffold-test/
├── package.json          # ai (6 beta), @ai-sdk/openai, zod
├── bun.lock
├── tsconfig.json
├── .env                  # OPENAI_API_KEY (gitignored)
├── src/
│   ├── agents/
│   │   ├── baseline.ts   # ToolLoopAgent (control)
│   │   ├── proposer.ts   # generateObject, no tools
│   │   ├── predictor.ts  # generateObject, no tools
│   │   ├── scorer.ts     # generateObject, no tools
│   │   ├── executor.ts   # ToolLoopAgent, stepCountIs(1)
│   │   ├── calibrator.ts # generateObject + semanticMatch helper
│   │   └── scaffold.ts   # orchestrator (treatment)
│   ├── env/
│   │   ├── fs-sandbox.ts # filesystem tool implementations
│   │   ├── crud-server.ts# Bun.serve mock API
│   │   └── reset.ts      # per-run cleanup
│   ├── tasks/
│   │   ├── refactors.ts
│   │   ├── conditionals.ts
│   │   └── migrations.ts
│   ├── eval/
│   │   ├── runner.ts     # iterates tasks × agents × seeds
│   │   ├── correctness.ts# state diff checks
│   │   └── metrics.ts
│   └── prompts/          # plain markdown, loaded as strings
└── results/              # JSON output, gitignored
```

## Baselines (two of them, paired)

A scaffold win against a single vanilla baseline doesn't tell us *why* it won
— the scaffold spends multiples more reasoning tokens per turn, and a
"think-before-acting" prompt on the same model might produce most of the gain
for free. So we run two control variants:

- **Baseline A — vanilla.** `ToolLoopAgent`, `stopWhen: stepCountIs(20)`, same
  model, same tools. No deliberation prompt.
- **Baseline B — thinking.** Same agent and tools, with an instruction prompt
  that tells the model to reason out loud before each tool call (consequences,
  precondition checks, reversibility). Token-budget control.

Treatment and both baselines are run **paired**: same task, same seed, same
initial world state. This is the most important control to have. If the
scaffold beats vanilla but ties thinking, the answer is "explicit
deliberation is most of the value, the scaffold itself is overhead." If it
beats both, the architecture is doing real work.

## Metrics

Per task:

- Success (binary, automated)
- Destructive-action count (unrelated state the agent modified)
- Executed action count
- Tokens by role (proposer, predictor × N, scorer, calibrator, baseline,
  thinking)
- Wall clock time
- Estimated dollar cost

Per session (scaffold only):

- Prediction F1 mean (deterministic, set-equality on canonical keys)
- Precision / recall reported separately so under- vs over-prediction is
  visible
- Calibration delta = F1 mean over the last third of turns − F1 mean over the
  first third
- Scorer self-consistency: did `recommended_index` match the highest-scored
  candidate (sanity check on the scorer's own output)

Reported **by task family** (refactor / conditional / migration), not just
in aggregate, since the scaffold may only help on one family. Aggregate
numbers can hide the actual signal.

## Decision rule

The scaffold passes only if it beats **both** baselines (vanilla and
thinking), with the gap holding inside at least one task family.

Scaffold passes if, for at least one task family:

- Scaffold success rate is at least 15 pp above **the better of the two
  baselines**, **OR** destructive-action count is at least 50% lower than
  the better baseline at comparable success rate.
- **AND** calibration delta is positive and meaningful (not just seed noise).
- **AND** token cost ratio (scaffold / better baseline) is under 4×.

If scaffold beats vanilla but ties thinking, the architecture is
indistinguishable from "spend more tokens deliberating" — that's not
evidence for the JEPA-style structure. Anything weaker than the rule above
means we redesign or kill.

## Out of scope

- Training anything
- Multimodal inputs
- Tools beyond filesystem + mock CRUD
- Web or browser environments
- Multi-agent coordination
- Production-grade error handling, retries, observability beyond DevTools
- Other model providers (Anthropic, Google, etc.). OpenAI only for phase 1
- Context7 MCP integration (interesting for phase 2 if we want the predictor to ground state summaries in real library behavior, but adds variables we don't want now)

## Timeline

- Day 1: Bun project setup, AI SDK 6 + `@ai-sdk/openai` wiring, mock CRUD via `Bun.serve`, fs sandbox tool
- Day 2: Task set definitions + automated correctness checks + eval runner skeleton
- Day 3: Baseline `ToolLoopAgent`, validate it can actually solve and fail tasks (sanity check; baseline failure rate must be > 30% or tasks get redesigned)
- Day 4: Predictor + scorer in isolation (the risky parts), adversarial spot-checks for scorer gaming
- Day 5: Full scaffold orchestrator + calibrator, end-to-end run on a few tasks, **project full-eval cost from this run before committing to day 6**
- Day 6: Full eval (all tasks × both agents × 3 seeds), collect data
- Day 7: Analysis, writeup, framework decision
- Day 8 (buffer): Node 24.15.0 compat run, retry any flaky cases

## Eval power

15–20 task instances × 3 seeds × 3 variants is 135–180 runs total. That's
fine for "is there a signal at all?" but underpowered for tight CIs. We
report by task family precisely so a strong within-family signal isn't
washed out by a weak overall one. If phase 1 passes by a thin margin in
aggregate, the deciding question is "does it pass cleanly within at least one
family?" If yes, scope phase 2 to that family. If no, kill.

## Open questions the experiment should answer

1. What's the right granularity for predicted states? Too detailed and it's full state reconstruction. Too vague and the scorer can't rank.
2. Should calibration notes feed the predictor, or does that pollute predictions with goal-shaped bias?
3. Does the scorer do better seeing N predictions at once (comparative) or scored independently?
4. Sweet spot for candidate count? 3, 5, or more? (Cost scales linearly here — predictor calls = candidate count.)
5. ~~Does AI SDK 6's `Output.object` on a `ToolLoopAgent` give us a cleaner predictor than separate `generateObject` calls?~~ Answered: no for the predictor (it has no tools), but `Output.object` is the right shape if a future variant wants the executor to emit a typed post-condition alongside execution.
6. Where does the scaffold actually win or lose? File refactors, conditionals, or migrations?

## Risks

- **Predictor laziness:** model paraphrases the action description instead of reasoning about consequences. Mitigation: schema forces side effects and reversibility, which paraphrasing won't surface. Day 4 isolation test is where we catch this.
- **Scorer gaming:** scorer infers the action from the prediction and ranks based on action quality not outcome quality. Mitigation: feed it adversarial predictions on day 4 and see if it's fooled.
- **Calibration noise:** prediction error is small enough that "improvement over session" is just luck. Mitigation: enough tasks per session, multiple sessions, report variance not just means.
- **Task set too easy:** baseline solves everything, no room for scaffold to win. Mitigation: validate baseline failure rate is above 30% before running the full eval. If baseline is acing tasks, redesign before continuing.
- **Cost overrun:** ≈8 LLM calls per agent turn × turns × 20 tasks × 3 seeds × 3 variants adds up. Mitigation: project the bill from one full task on day 5 and cut to model-splitting before committing. Validation+dedupe before predictor fan-out caps the candidate count cheaply.
- **Token-budget confound:** the scaffold spends more reasoning tokens than vanilla. Mitigation: the thinking baseline (variant B) provides a same-token-budget control. Decision rule requires beating both.
- **Calibration-note pollution:** notes overgeneralize and create superstitions. Mitigation: notes are conditioned on `applies_to_tool` + `applies_when` (so they don't fire across tools), and a sliding window of K=10 caps memory.
- **Bun ecosystem gap:** some AI SDK transitive dep behaves differently on Bun vs Node. Mitigation: catch in the day 8 compat run, fall back to Node 24.15.0 if it gets ugly. AI SDK is officially Bun-supported, so this should be unlikely.

## Phase 2 (only if hypothesis passes)

If the scaffold wins clearly, the framework would offer:

- Predictor/scorer/calibrator as composable wrappers around any `ToolLoopAgent`
- Plug-in state-diff implementations per environment type
- Session calibration memory as a first-class abstraction
- Multi-provider support (Anthropic, Google) via AI Gateway model strings, since the scaffold logic itself is provider-agnostic
- Optional Context7 MCP integration so predictors can ground predictions in real library docs when reasoning about code changes

That's a separate doc, separate decision, separate budget.
