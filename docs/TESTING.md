# Testing

This repo's subject is a PASS/FAIL gate, so it needs a position on what a test
is for. Three rules, each written after the suite it describes rather than
before — a testing philosophy with no tests behind it is the same defect this
pack exists to remove.

Run everything with `npm test`, and the JSDoc types with `npm run typecheck`.
There is no build step: `checkJs` gives the annotations teeth while the shipped
files stay plain ESM that Node runs directly, because the pack installs by
copying directories.

## 1. Pin a deliberate decision as a test

A decision that looks like an oversight will eventually be "fixed" by someone
who cannot tell the difference. The test is where you leave the note.

`MINOR_PX_TOLERANCE` is 2px, and `compare.test.mjs` asserts that literal value
with a comment saying it is the contract. Widening it would make the gate
quietly accept larger layout drift — a change that makes every existing test
greener, which is exactly why it needs an assertion pointed at it rather than a
comment nobody has to read.

The same applies to `RECURRENCE_THRESHOLD` in `verdict.mjs`: the rule that a
minor delta fails only at two or more viewports looks like laxity in isolation.
It is a considered choice about rounding artefacts versus systematic offsets,
and `verdict.test.mjs` says so.

`CLS_THRESHOLD` is pinned the same way, at the literal `0.1`, with boundary
tests at exactly `0.1` (passes) and `0.11` (fails). `runlog.mjs` imports the
constant rather than restating it, so the run log's "over threshold" count and
the gate cannot disagree about where the line is.

**A corollary that cost us a real test.** The boundary cases in
`compare.test.mjs` were originally written *relative* to `MINOR_PX_TOLERANCE`
— `expected 32px, computed ${32 + MINOR_PX_TOLERANCE}px`. That reads well and
is worthless against a change to the constant, because the expectation moves
with it. Mutation testing (rule 3) caught it. **A test derived from the value
it is testing cannot detect a change to that value.** Pin the literal
somewhere.

## 2. Prefer invariant tests to agreement tests

An agreement test asserts that two things match today. An invariant test
asserts that a whole class of input cannot produce a bad state. The second
survives refactoring and catches cases nobody enumerated.

`verdict.test.mjs` asserts that no input produces a verdict that is neither
`PASS` nor `FAIL`, over a spread of shapes — rather than trusting that the
branch-by-branch cases above it happened to cover everything. The interesting
failure was never "returns the wrong verdict"; it was "returns something that
is not a verdict at all", and only an invariant catches that.

`compare.test.mjs` does the same for the pair of failure modes that matter
here: an unparseable **spec** value throws, because `design.md` is wrong and
validating against an unreadable spec is worse than stopping. An unparseable
**computed** value fails as a blocker, because the gate could not verify the
property, and *could not verify* must never resolve to a match. The invariant
is that neither path can produce `match: true`.

The runtime checks follow the same rule. axe that did not load, or loaded and
found no block, is a blocker — never "zero violations". A runtime check with no
recorded status throws, exactly like an empty viewport list, so the gate exits
2. `verdict.test.mjs` asserts both, plus that a check the config turned off
reports as *not measured, not passed* rather than disappearing.

`skill-contracts.test.mjs` is an invariant over the pack itself: every skill
declares `disable-model-invocation: true`. "Nothing self-triggers" is the
claim in `README.md`, `docs/DESIGN.md` §7 and the presentation. A flag dropped
in an edit would falsify all three with no visible symptom — the skills would
simply start firing on their own.

`presentation-data.test.mjs` is an invariant over `agentic-workflow/data.js`:
every cross-reference resolves, and no declared layer goes unused. Both
failures render as a page that looks correct — a file selection that highlights
nothing, a toggle that changes nothing.

**A corollary that cost us a second test.** Those integrity checks all passed
while the file tree silently omitted two artifacts the skills had started
writing. **A missing entry breaks no reference**, so nothing noticed. Integrity
tests catch broken links; they do not catch absences. Closing that needs a list
that is itself load-bearing, asserted in **both** directions — every artifact a
skill writes must appear in the tree, and every artifact named in the list must
be written by a skill. Listing something the pack does not produce now fails as
loudly as omitting something it does.

`docs-board-flow.test.mjs` applies the same idea to prose. `docs/workflow.md`
describes the three board lanes in reading order, and that order is also the
order of `DIAGRAM` entries per phase — one fact in two places, and the prose copy
has no references in it that could break. The test maps each node to a short
token and asserts the tokens appear in the documented lane in the order the board
draws them. A node with no map entry fails outright, which forces a decision
about whether the doc should mention it; `null` records a deliberate omission,
because the prose is a summary and the `extended`-only detail nodes do not belong
in it.

Tokens are matched as short substrings on purpose, so rewording a sentence is
free while reordering a lane is not. **Whitespace is collapsed before matching**
— the doc hard-wraps, and without that a token straddling a line break silently
fails to match. That is not hypothetical: it is how this suite failed on its
first run.

## 3. Mutation-verify, or it is decoration

Every suite here passed the first time it ran, which proves nothing whatsoever.
A suite that has never been observed to fail is not known to test anything.

So each one was verified by breaking its target and confirming the failure:

- `MINOR_PX_TOLERANCE` 2 → 50 (this is the run that exposed the self-referential
  boundary tests in rule 1)
- `RECURRENCE_THRESHOLD` 2 → 99
- `disable-model-invocation: true` → `false` in one skill
- a `FILES[].node` in `data.js` pointed at an id that does not exist
- `evidence.json` renamed out of the `FILES` tree
- two lane-3 `DIAGRAM` nodes swapped, with `docs/workflow.md` left untouched
- `CLS_THRESHOLD` 0.1 → 0.5
- axe `not_loaded` treated as a clean run instead of a blocker
- the run log's false-pass denominator changed from passes to all runs

Every one failed as intended, by name, and was restored. **Do this before
calling a suite done.** It is fast, and it is the only step that distinguishes a
test suite from a green badge.

Three of the checks in this repo found something while being written rather than
afterwards: `checkJs` surfaced nine real type errors on its first run, the
tolerance mutation exposed the self-referential assertions above, and the
doc-versus-diagram suite failed on a line-wrapping assumption nobody had
considered. A test that never surprises its author is usually asserting what the
author already believed.

One practical note: if you script this, restore the file explicitly. An `EXIT`
trap does not fire in a persistent shell session, and a mutation can survive
the run that was supposed to clean it up.

## Testing the hooks

The hook rules are pure functions (`lib/guards.mjs`, `lib/schema.mjs`) tested like
the verdict core. `hooks.test.mjs` then spawns the real scripts with payloads in
the shape Claude Code sends, because a correct rule behind a wrong exit code is
the same as no rule — a hook that exits 1 instead of 2 does not block. The settings
snippet is checked in both directions: every command names a script that exists,
and every script is wired in.

Nine mutations were applied and each was caught: the contradicting-verdict check,
the partial-edit rule, the placeholder lookahead in `verdictIn`, the stale-report
comparison, the Stop verdict comparison, the sidecar drift check, two schema rules,
and the `stop_hook_active` loop guard.

Payloads are built from the shapes the Claude Code hooks reference documents, so
the scripts are exercised the way the harness calls them: JSON on stdin, a decision
on stdout or an exit code.

The runtime rules needed no hook changes — the guards call `evaluate()` and
`validateEvidence()`, so a new rule there is enforced everywhere at once.
`hooks.test.mjs` pins that rather than assuming it: a PASS over evidence whose
only failure is an axe violation is denied, and any report over evidence with no
runtime record is denied as unevaluable.

## Coverage

`npm run test:coverage` prints line and branch coverage for the shipped modules
(`skills/**/lib`, `skills/**/hooks`) and CI runs it. It is **reported, not
gated**. A percentage threshold rewards tests written for the number; the check
that matters here is mutation-verification (rule 3).

One figure needs reading carefully: the hook scripts and `lib/cli.mjs` show 0%.
The hooks are exercised — `hooks.test.mjs` spawns them as real processes — but
V8 coverage is collected in the test process and does not follow a child
process, so the 0% is a limit of the measurement rather than proof of an untested
file. The logic those scripts call lives in `guards.mjs`, `schema.mjs` and
`verdict.mjs`, which are covered directly. `cli.mjs` is thin, but it is the one
file in `lib/` with no direct test of its own.

## Measuring the gate itself

Everything above answers *are the rules implemented correctly?* It does not
answer *are the rules right?* A suite can be green while the gate passes work it
should have stopped. The run log answers that second question, from the runs
themselves.

The two numbers worth collecting are error rates in **opposite directions**, and
they are not symmetric:

- **False pass** — the gate said PASS and review later found a defect it should
  have caught. This is the control failing silently, which is the expensive
  direction: nobody is alerted, and the defect ships.
- **False fail** — the gate said FAIL and the code was fine. This is what drives
  abandonment. A gate that cries wolf gets switched off, and a switched-off gate
  has no accuracy worth discussing.

Most instrumentation reports neither. Run counts, pass counts and token spend are
**activity** metrics: they establish that a tool is being used, not that it is
doing its job. Either error rate above says more than all of them together.

Three details decide whether the numbers mean anything:

1. **False passes are measured against passes, not against all runs.** A false
   pass is a pass that was wrong, so the denominator is the passes. Dividing by
   total runs understates it — on one sample, by a factor of three — and
   understating the number that measures the control is the error that matters.
2. **False fails are measured against fails**, by the same logic.
3. **False passes are structurally undercounted.** You only learn of one if
   review happens to notice. The figure is therefore a floor, not an estimate,
   and should be quoted that way.

The log is `skills/figma-validate/lib/runlog.mjs`: append-only JSONL, one row per
run, with corrections as new rows referencing a ticket rather than edits to an
earlier one — a log that can be rewritten is a log whose totals cannot be quoted.
A run row is **derived from `evidence.json` through `evaluate()`**, so the verdict
and measurements in the log are the gate's own, and evidence the gate cannot
evaluate is refused rather than logged. A check that was not measured is left
out of the row, never written as 0.

`runlog.test.mjs` pins all three details above, the first one hardest: with 2
passes, 4 fails and 1 false pass the rate must read 50%, not the 17% a total-runs
denominator would give. The arithmetic is the part most likely to be quoted and
least likely to crash when wrong.

## What the suite leaves to the run

**Figma and the browser.** At run time the skills drive Figma, the browser and
the authored page through the MCP servers named in the config. The suite covers
what decides the outcome: the verdict core takes the gathered evidence as its
input, which is exactly what makes it testable on its own.

**The visual diff.** It is a model judgement, labelled as one in
`figma-validate/SKILL.md` and in the presentation. Replacing it with a
pixel-diff library would trade a judgement for noise — a rendered block and a
Figma export differ in ways that are real and irrelevant.

**The presentation's rendering.** `app.js` is exercised by looking at the page.
Exporting its internals to unit-test gauge arithmetic would mean modifying
working code to test a slide deck, and the cost exceeds the value.
