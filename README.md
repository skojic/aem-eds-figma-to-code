# aem-eds-figma-to-code

A portable, EDS/AEM-first Claude Code skill pack for turning Figma designs into implementation-ready CSS/HTML — and validating the result in a real browser.

**[▶ See the interactive workflow presentation](https://skojic.github.io/aem-eds-figma-to-code/agentic-workflow/)** — step through the files the pack adds to your project, toggle each layer of the loop, and watch the context budget fill. Source in [`agentic-workflow/`](agentic-workflow/).

---

## What's inside

Three Claude Code skills that implement a Figma → spec → build → validate loop:

| Skill | Invocation | Purpose |
|---|---|---|
| `figma-specify` | `/figma-specify <ticket-or-slug>` | Extract visual/stylistic design context from Figma → write a `design.md` spec (source of truth for HTML/CSS). |
| `figma-screenshot` | `/figma-screenshot <ticket-or-slug> <figma-url>` | Fetch a Figma node PNG via the figma MCP → save it beside the spec as audit-trail evidence. |
| `figma-validate` | `/figma-validate <ticket-or-slug>` | Drive a browser MCP to render authored content at each breakpoint, compare against the spec + Figma screenshots, spot-check computed styles, run axe-core, a keyboard pass and a CLS trace, run lint/tests, emit PASS/FAIL and log the run. |

The skills produce the **spec** and the **check**. Writing the actual block code from `design.md` is your step — see [docs/workflow.md](docs/workflow.md).

### The verdict is decided by code, not by the model

`figma-validate` gathers evidence — computed styles at each breakpoint, token
resolutions, console and network state, axe-core results scoped to the block, a
keyboard pass, a lab CLS (Cumulative Layout Shift) trace, lint and test exit
codes — writes it to `validation/evidence.json`, and then runs a tested core over
it:

```bash
node skills/figma-validate/lib/cli.mjs <spec-dir>/validation/evidence.json
# exit 0 PASS · 1 FAIL · 2 could not evaluate
```

`lib/compare.mjs` normalises units before comparing, so `2rem` matches `32px`,
`gap: normal` matches `0px`, and a `flex-flow` reading of `row nowrap` matches
`row`. `lib/verdict.mjs` applies the PASS/FAIL rules. Both are plain ESM with
no dependencies, typed via JSDoc and covered by `npm test`.

The third exit code is the point: **a gate that cannot evaluate its input must
not report a result.** No viewports captured, a malformed evidence file, or no
record of the runtime checks exits 2 rather than emitting a verdict nobody
earned. The same principle runs through the accessibility rules: axe failing to
load is a FAIL, never "zero violations".

### Measuring the gate, not just running it

After each verdict, `lib/runlog.mjs` appends one row to an append-only log,
derived from `evidence.json` by the same code that decided the verdict.
Reviewers add `false-pass` and `false-fail` corrections later, and `report`
prints the two rates that measure the control — false passes over **passes**,
false fails over **fails**:

```bash
node skills/figma-validate/lib/runlog.mjs report --log=.figma-validate/runs.jsonl
```

The one judgement left is the visual diff against the Figma reference, and it is
labelled as a judgement. See [docs/TESTING.md](docs/TESTING.md) for how the
suite is built and why — and for how the run log measures whether the gate is
*accurate* rather than merely implemented, which is a different question and the
more interesting one.

```bash
npm test               # verdict core · run log · hooks · skill contracts · presentation data · docs vs diagram
npm run test:coverage  # the same, with line/branch coverage for skills/**/lib and hooks (reported, not gated)
npm run typecheck      # JSDoc types via checkJs — no build step, no emitted output
```

---

## Why hooks

The verdict is already decided by code. What code cannot do from inside a
SKILL.md is make sure it *ran*. Everything around the gate is an instruction to
the model — run `cli.mjs`, write what it printed, stop when a fetch fails — and an
instruction can be forgotten, skipped, or quietly contradicted. A hook is executed
by Claude Code itself, so the rule holds whether or not the model remembers it.

The hooks never decide a verdict. `verdict.mjs` still does that. They close the
gaps around it:

| Hook | Event | What it enforces |
|---|---|---|
| `preflight.mjs` | `UserPromptExpansion` on `/figma-validate` | Blocks the run before it starts if the config, `design.md`, a parseable and well-shaped `design.matrix.json`, or a `figma-*.png` is missing — and names the skill that produces each. |
| `artifact-check.mjs` | `PostToolUse` on `Write`/`Edit` | Validates `design.matrix.json` and `evidence.json` the moment they are written, so a malformed file is fixed immediately instead of at the end of a browser loop. Also flags a sidecar container that `design.md` never mentions. |
| `report-guard.mjs` | `PreToolUse` on `Write`/`Edit` | Refuses a `report.md` whose `**Verdict**:` contradicts what the gate computes from `evidence.json`, and refuses any report when the evidence cannot be evaluated (the exit-2 case). |
| `verdict-stop.mjs` | `Stop` | A session that wrote `evidence.json` cannot finish until `report.md` exists, is newer than the evidence, and states the recomputed verdict. A `stop_hook_active` guard lets a second stop through with a warning rather than trapping the session. |

Two properties are deliberate. The checks are **pure functions** in
`lib/guards.mjs` and `lib/schema.mjs`, tested like the verdict core; the hook
scripts only translate them into exit codes and JSON. And the Stop hook
**re-derives** the verdict rather than trusting anything recorded earlier, so a
tampered or stale report is caught by recomputation, not by comparison with
another claim.

Scope: the hooks check files, not browser state, so the dev
server, browser MCP and content store stay with the skill's fail-stop rules. They
are project-level settings, not SKILL.md frontmatter, because frontmatter hooks
register only after the skill has run and a frontmatter `Stop` hook is converted
to `SubagentStop`. And they enforce *agreement with the gate*, not that the gate's
thresholds are right — that question is in [docs/TESTING.md](docs/TESTING.md).

---

## The methodology

These five practices are encoded in the skills and transfer to any CSS project:

- **Layout Matrix** — for every flex/grid container, record `flex-direction`, `gap`, and alignment at each breakpoint in a table. Prevents the silent "tablet inherits into desktop" bug that is invisible until rendered.
- **Mobile-first CSS file order** — base rules first, then ascending `@media (width >= …)` blocks in a single ladder per component. Never scatter the same selector above and below a media query boundary.
- **Dynamic-content dimension rule** — never invent `width` or `max-width` on content-sized elements. Store only what Figma explicitly provides for that node; omit when unsure.
- **Token-gap validation** — after extracting the spec, cross-reference every `var(--…)` token used against the design-system token files. Flag gaps rather than inventing values in block CSS.
- **PASS/FAIL browser validation** — computed-style spot-checks against the Layout Matrix, model-driven visual diff against Figma screenshots, axe-core and a keyboard pass scoped to the block, a CLS gate, plus lint and test gates. A binary verdict keeps the review conversation short.

---

## EDS/AEM-first, parameterized to adapt

The skills were extracted and generalized from real-world Adobe Edge Delivery Services (Helix) work, so their defaults reflect that environment. The component model (`@scope`, `export default function decorate(block)`, block-table authoring), token layering (L1 primitives → L2 semantic → L3 component → L4 theme overrides → L5 section backgrounds), and headless-CMS content store are Adobe EDS-shaped.

The methodology on top transfers to other CSS projects by editing the `component_model` section in the config file. The skills themselves stay unedited; the config is the only project-specific file.

---

## Install

1. Copy the three skill directories into your project's `.claude/skills/` folder:

   ```bash
   cp -r skills/figma-specify skills/figma-screenshot skills/figma-validate <your-project>/.claude/skills/
   ```

   Expected structure:

   ```
   .claude/
   └── skills/
       ├── figma-specify/SKILL.md
       ├── figma-screenshot/SKILL.md
       └── figma-validate/
           ├── SKILL.md
           ├── lib/      verdict core, comparison, schema checks, hook logic, run log
           └── hooks/    four hook scripts + settings.snippet.json
   ```

   Copy `figma-validate` as a whole directory: the skill runs `lib/cli.mjs` and
   `lib/runlog.mjs`, and the hooks import from `lib/`.

2. Copy the config template to your project root and fill it in. Run these from the root of a clone of this repo:

   ```bash
   cp config/figma-to-code.config.template.md <your-project>/figma-to-code.config.md
   ```

   See [`config/examples/eds-example.config.md`](config/examples/eds-example.config.md) for a worked generic EDS example. The fallback location is `.claude/figma-to-code.config.md` if you prefer to keep it inside `.claude/`.

3. The skills read `figma-to-code.config.md` on every invocation. If it is missing they fail-stop and point you at the template.

4. *(Optional, recommended)* Enable the [hooks](#why-hooks): merge
   `.claude/skills/figma-validate/hooks/settings.snippet.json` into your project's
   `.claude/settings.json`. The scripts travel with the `figma-validate` directory
   you already copied; the snippet assumes that location.

5. Add the run log to your project's `.gitignore` — its rows carry ticket IDs:

   ```bash
   echo '.figma-validate/' >> <your-project>/.gitignore
   ```

   (Use your `run_log_path` from the config if you changed the default.)

---

## The loop

```
/figma-specify <ticket-or-slug>
    → design.md           the spec, for you
    → design.matrix.json  the Layout Matrix, structured for the gate

/figma-screenshot <ticket-or-slug> <figma-url>
    → figma-*.png         beside design.md (once per major frame)

[ implement the block from design.md — your step ]

/figma-validate <ticket-or-slug>
    → browser-*.png · snapshot-*.json
    → axe-*.json          axe-core scoped to the block, plus keyboard pass and CLS trace
    → evidence.json       everything gathered, before anything is decided
    → node lib/cli.mjs evidence.json
    → report.md           the verdict and a remediation checklist
```

Everything lands in the directory `spec_output_path` resolves to, with the validation artifacts in a `validation/` subfolder. The order inside it is the point: **gather, write it all down, then adjudicate.**

Full prerequisites, exact invocations, and fail-stop behaviour are documented in [docs/workflow.md](docs/workflow.md). The rationale behind the pack — what was generalized, what became config, and why — is in [docs/DESIGN.md](docs/DESIGN.md).

---

## Requirements

| Requirement | Role | Notes |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | skill runner | Required. |
| Node.js 18+ | runs the verdict core and the hooks | Required for `figma-validate` — it shells out to `lib/cli.mjs`. No packages to install: the modules are dependency-free ESM. If `node` is not on PATH the skill fail-stops rather than adjudicating the checks by hand. |
| Figma MCP | `mcp.figma` in config | Required. Used by `figma-specify` and `figma-screenshot`. |
| Browser MCP | `mcp.browser` in config | Required for `figma-validate` (e.g. `chrome-devtools` MCP). The performance trace and the Lighthouse score need a browser MCP that offers them; without one, set `runtime_checks.performance: false` and the check is recorded as skipped. |
| axe-core | loaded into the page under test | Not a pack dependency. Served from your project's `node_modules/axe-core` if your dev server exposes it, otherwise a jsDelivr copy pinned by `axe_core_version`. If neither loads, the run fails rather than reporting zero violations. |
| Ticket-tracker MCP | `mcp.ticket_tracker` in config | Optional. If absent, pass a Figma URL directly to `/figma-specify`. |
| Headless-CMS / content-store MCP | `mcp.content_store` in config | Optional. If absent, author and serve your own test content before running `/figma-validate`. |

---

## License

MIT — see [LICENSE](LICENSE).
