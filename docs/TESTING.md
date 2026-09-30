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

## Measuring the gate itself

Everything above answers *are the rules implemented correctly?* It does not
answer *are the rules right?* A suite can be green while the gate passes work it
should have stopped. Only field data settles that, and this section is the
method rather than the results.

**No numbers are published here, because this repo has no production runs.** A
reference implementation has no users to measure. Stating the method without
data is honest; printing a dashboard with nothing in it would be the same defect
as the test badge this repo used to carry for a suite that did not exist.

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

A log for this is append-only, one row per run, with corrections as new rows
referencing an earlier run rather than edits to it — a log that can be rewritten
is a log whose totals cannot be quoted. Schema and queries are the remaining
work; see the run log under future work in [DESIGN.md](DESIGN.md).

## What is deliberately not tested

**The pipeline end to end.** "Figma frame → correct CSS" cannot be unit-tested
without Figma and a browser. The verdict core is testable precisely because it
takes gathered evidence as its input; a suite claiming to cover the whole loop
would be theatre.

**The visual diff.** It is a model judgement, labelled as one in
`figma-validate/SKILL.md` and in the presentation. Replacing it with a
pixel-diff library would trade a judgement for noise — a rendered block and a
Figma export differ in ways that are real and irrelevant.

**The presentation's rendering.** `app.js` is exercised by looking at the page.
Exporting its internals to unit-test gauge arithmetic would mean modifying
working code to test a slide deck, and the cost exceeds the value.
