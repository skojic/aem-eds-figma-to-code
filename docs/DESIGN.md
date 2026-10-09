# Design: `aem-eds-figma-to-code`

**Date:** 2026-07-08
**Author:** skojic
**Status:** Approved — ready for implementation planning

A portable, EDS/AEM-first skill pack that turns a Figma design into implementation-ready CSS/HTML and validates the result in a real browser. Extracted and generalized from a production Adobe Edge Delivery Services (Helix) project so it can be reused across projects and showcased publicly.

---

## 1. Goal & non-goals

**Goal.** Publish a public GitHub repo (`skojic/aem-eds-figma-to-code`) containing three generalized, reusable Claude Code skills that implement a Figma → spec → build → validate loop for Adobe EDS/AEM work, parameterized so they adapt to any EDS project (and, with effort, non-EDS CSS projects) via a single config file.

**Non-goals.**
- Not extracting the `.agents/` orchestrator pipeline or the CDD glue (out of scope by decision).
- Not shipping the originating project's version as a reference implementation (decision: generalize, not two-layer).
- Not a Claude Code plugin — plain skills repo, copy-paste install.
- No originating-project-identifying content anywhere in the published repo.

## 2. What gets extracted

Three skills, generalized from the source project's `.claude/skills/`:

| Skill | Purpose |
|---|---|
| `figma-specify` | Extract visual/stylistic design context from Figma → write a `design.md` spec (source of truth for HTML/CSS). |
| `figma-screenshot` | Fetch a Figma node PNG via the figma MCP → save as audit-trail evidence next to the spec. |
| `figma-validate` | Drive a browser MCP to render authored content at each breakpoint, compare against the spec + Figma screenshots, spot-check computed styles, run lint/tests, emit PASS/FAIL. |

### Methodology preserved (the transferable value)

These are kept intact because they transfer beyond the originating project:

- **Layout Matrix** — auto-layout facts (flex-direction, gap, alignment) per container per breakpoint; the canonical layout view that prevents "tablet silently inherits into desktop" bugs.
- **Mobile-first CSS file order** — base rules first, then ascending `@media` ladders; restate layout properties on desktop when they differ from tablet.
- **Dynamic-content dimension rule** — never invent `width`/`max-width` on content-sized elements; store only what Figma explicitly has.
- **Token-gap validation** — cross-reference every token used in the spec against the design-system token file; flag gaps rather than inventing values.
- **PASS/FAIL browser validation** — computed-style spot-checks against the Layout Matrix + model-driven visual diff against Figma screenshots, plus lint/test gates.

## 3. Generalization: what becomes config

Everything project-specific is lifted out of the SKILL.md files into one config file. The skills reference config *roles*, never hardcoded names.

| Hardcoded in source | Config field | Notes |
|---|---|---|
| The project's ticket-tracker, Figma, browser, and CMS MCP server names | MCP roles: `ticket_tracker`, `figma`, `browser`, `content_store` | Each optional; `ticket_tracker` and `content_store` can be absent. |
| Ticket ID pattern and JIRA browse URL | `ticket_key_pattern`, `ticket_url_base` | Ticket integration optional — a Figma URL alone is enough to run `figma-specify`. |
| Spec output path (ticket-scoped directory + filename) | `spec_output_path` (template) | Supports a `{ticket}` / `{slug}` placeholder. |
| CMS content path (org/repo/drafts folder for authored blocks) | `content_path_template` | Only used when a `content_store` MCP is configured. |
| Local preview URL for validation | `preview_url_template` | Local render URL for validation. |
| The project's token files and token-layer model | `token_files`, `token_layer_model` (prose) | Layer model described in prose the model reads. |
| The project's theme names | `themes` (list) | Empty list = no theme checks. |
| The project's breakpoint list | `breakpoints` (list of name + min-width) | Drives both spec ladders and validation viewports. |
| EDS block model (`@scope`, `decorate(block)`, block-table) | `component_model` (scoping mechanism + entry point + authoring shape) | **EDS documented as the default**; overridable. |
| `npm run lint` / `npm test` | `lint_cmd`, `test_cmd` | Empty = skip that gate. |

## 4. Config model — single file

- Skills read `figma-to-code.config.md` from the **target project root**; fallback `.claude/figma-to-code.config.md`.
- Markdown format, so token-layer rules and component conventions live as prose the model consumes well, alongside a fenced key/value block for the mechanical fields.
- **Missing config → each skill fail-stops** and points the user at `config/figma-to-code.config.template.md`. No guessing.
- One config per project; the skills themselves stay generic and unedited.

## 5. Repo layout

```
aem-eds-figma-to-code/
├── README.md                                   # what it is (EDS-first), install, the loop, reuse steps
├── LICENSE                                      # MIT (public showcase)
├── package.json                                 # dev-only: npm test, npm run typecheck
├── tsconfig.json                                # checkJs over the JSDoc annotations; noEmit
├── .github/workflows/ci.yml                     # runs both on push and pull request
├── docs/
│   ├── DESIGN.md                                # this document
│   ├── TESTING.md                               # what is tested, what is not, and why
│   └── workflow.md                              # specify → screenshot → build → validate loop + prerequisites
├── config/
│   ├── figma-to-code.config.template.md         # every field, blank, with inline guidance
│   └── examples/
│       └── eds-example.config.md                # one generic EDS-style filled example (no originating-project identifiers)
├── skills/
│   ├── figma-specify/SKILL.md
│   ├── figma-screenshot/SKILL.md
│   └── figma-validate/
│       ├── SKILL.md
│       ├── lib/                                 # ships WITH the skill — copied in as one directory
│       │   ├── compare.mjs                      # normalise + compare one CSS property
│       │   ├── verdict.mjs                      # the PASS/FAIL rules, executed not interpreted
│       │   ├── cli.mjs                          # exit 0 PASS · 1 FAIL · 2 could not evaluate
│       │   ├── schema.mjs                       # shape checks for design.matrix.json and evidence.json
│       │   ├── guards.mjs                       # the decision logic behind the four hooks
│       │   └── runlog.mjs                       # append-only run log (addendum 2026-10-09)
│       └── hooks/                               # addendum 2026-10-01 — wired via settings.snippet.json
│           ├── preflight.mjs                    # UserPromptExpansion
│           ├── artifact-check.mjs               # PostToolUse
│           ├── report-guard.mjs                 # PreToolUse
│           ├── verdict-stop.mjs                 # Stop
│           ├── stdin.mjs                        # shared payload reader
│           └── settings.snippet.json            # merge into .claude/settings.json
└── test/                                        # repo infrastructure — NOT copied into a project
    ├── helpers/project.mjs                      # shared fixtures and a throwaway project dir
    ├── compare.test.mjs
    ├── verdict.test.mjs
    ├── schema.test.mjs
    ├── guards.test.mjs
    ├── hooks.test.mjs                           # spawns the real hook scripts with Claude Code payloads
    ├── runlog.test.mjs                          # run-log arithmetic: false passes ÷ passes
    ├── skill-contracts.test.mjs                 # guards disable-model-invocation across all skills
    ├── presentation-data.test.mjs               # agentic-workflow/data.js integrity; tree = skills/ exactly
    └── docs-board-flow.test.mjs                 # docs/workflow.md lane prose vs the DIAGRAM order
```

**The `lib/` versus `test/` split is the important line.** `lib/` lives inside the skill directory so the install stays "copy one folder"; `test/` is repo infrastructure and is never copied anywhere. Vitest runs at the repo level over the pack's own logic — it is not a gate inside the pipeline, and `test_cmd` in a consuming project remains a separate, optional thing.

**Artifacts written into a consuming project**, all under the directory `spec_output_path` resolves to:

```
drafts/specs/{ticket}/
├── design.md                       # /figma-specify — the spec, for a human
├── design.matrix.json              # /figma-specify — the Layout Matrix, for the gate
├── figma-{slug}-{viewport}.png     # /figma-screenshot — visual reference
└── validation/                     # /figma-validate
    ├── browser-{viewport}.png
    ├── snapshot-{viewport}.json
    ├── axe-{viewport}[-{theme}].json   # raw axe-core result, scoped to the block
    ├── evidence.json               # everything gathered, BEFORE any verdict exists
    └── report.md                   # the verdict and remediation checklist

.figma-validate/runs.jsonl          # run_log_path — one row per run, gitignored
```

The ordering inside `validation/` is the design: gather, write it all down, then adjudicate. `evidence.json` is what makes a run reproducible and what you read when one fails.

**Reuse later:** copy `skills/*` into a project's `.claude/skills/`, drop a filled `figma-to-code.config.md` at the project root. Tool-agnostic, no plugin machinery.

## 6. Publish flow

1. Build the repo in a new folder outside the source project's repo.
2. Generalize the three SKILL.md files; write config template, generic example, README, `workflow.md`, LICENSE.
3. **Hard sanitization gate:** grep the whole tree for the originating project's identifiers — project name, ticket prefix, CMS org/repo names, the project's Figma file key, any real ticket/URL. Present results to the user. Zero hits required before proceeding.
4. `git init`, commit.
5. Switch active gh account to `skojic` (`gh auth switch -u skojic`).
6. `gh repo create skojic/aem-eds-figma-to-code --public --source . --remote origin --push`.
7. Verify the repo is live and public; report the URL.

## 7. Risks & decisions

- **Public visibility of a work-derived asset.** Mitigated by the hard sanitization gate (step 3) and by generalizing away all project specifics. The methodology is generic engineering practice, not proprietary content.
- **Over-generalization.** The skills are honestly EDS/AEM-first; the README says so. Non-EDS reuse is possible via `component_model` but documented as "adapt," not "drop-in."
- **Skill invocation.** Source skills use `disable-model-invocation: true` (explicit `/figma-specify` only). Preserved — the generalized skills keep explicit-invocation semantics.
- **`da-live`-style content store is optional.** When no `content_store` MCP is set, `figma-validate` expects the user to point `preview_url_template` at already-authored/local content and skips auto-creation.

## 8. Success criteria

- Repo `skojic/aem-eds-figma-to-code` exists, is public, and pushed.
- Three SKILL.md files contain zero originating-project identifiers and reference only config roles.
- `config/figma-to-code.config.template.md` covers every field in §3.
- README explains install + the loop + reuse in a way a stranger can follow.
- Sanitization grep returns zero hits at publish time.

---

## Addendum — 2026-08-09: interactive presentation

Added after the design above was implemented, so §5 no longer lists the full tree.

`agentic-workflow/` holds a single-page, dependency-free presentation of the loop, published via
GitHub Pages at
**<https://skojic.github.io/aem-eds-figma-to-code/agentic-workflow/>**.

It is documentation, not part of the skill pack — nothing in `skills/` or `config/` depends on it,
and it is not copied into a consuming project. It visualises the same loop `docs/workflow.md`
describes: the files each skill adds to a project across eight install stages, the fail-stop gates,
MCP calls and subagents as toggleable layers, and an estimate of what the cached prefix costs in
context on every turn.

Stack: `index.html`, `styles.css`, `data.js` (all content), `app.js` (renderers). No build step and
no dependencies beyond a webfont; asset paths are relative so the subdirectory deploy needs no
configuration, and a `.nojekyll` marker at the repo root keeps Pages from processing the tree.

---

## Addendum — 2026-09-30: the verdict core, and dev dependencies

§8's success criteria were satisfiable by inspection, with nothing enforcing them. The repo now
has a test suite, and one design decision changed to make the interesting part testable.

**The PASS/FAIL rules moved out of prose into `skills/figma-validate/lib/`.** They were stated in
`figma-validate/SKILL.md` and re-derived by a model on every run: evidence gathering was
deterministic, the decision was not. `compare.mjs` normalises and compares one property,
`verdict.mjs` aggregates, `cli.mjs` is the process boundary. The rules now exist in exactly one
place and SKILL.md defers to it.

**`figma-specify` also emits `design.matrix.json`.** The human-readable Layout Matrix table stays;
the gate reads the sidecar. Parsing markdown this pack generates itself would break silently the
first time an author reordered a column — as a row that stops being checked while the report still
says PASS.

**Dev dependencies do not contradict "no build step".** `package.json` adds `vitest` and
`typescript`, both dev-only. Nothing is compiled and nothing is emitted: types come from JSDoc
annotations checked by `tsc --noEmit`, and the shipped files stay plain ESM that Node runs
directly. The install model in §5 is unchanged — copy `skills/*` and one config file. The
presentation remains dependency-free **at runtime**, which is the property that mattered.

**What the suite covers:** the logic that decides — comparison, verdict, schema and guards. Figma
and the browser are driven through MCP at run time, and the core takes their output as evidence.
Reasoning in `docs/TESTING.md`.

### Future work — the run log *(done 2026-10-09; see the addendum below)*

`figma-validate` writes a per-ticket `report.md` and nothing cumulative, so nothing in the pack
shows whether the gate is *accurate* rather than merely implemented. The remaining piece is an
append-only log, one row per run, with corrections recorded as new rows referencing an earlier run
rather than edits to it — plus a summary over it: run count, pass rate, most frequent failing
checks, and the two error rates that actually measure the control.

`docs/TESTING.md` §"Measuring the gate itself" holds the measurement design, including why false
passes and false fails need different denominators and why the false-pass figure is a floor rather
than an estimate. **Deliberately no dependencies when it lands** — a flat file, not a database.
The pack's install model is copy three directories and one config file, and a database dependency
would mean the pack could not be installed without one.

---

## Addendum — 2026-10-01: enforcement hooks

**Decision.** Add four Claude Code hooks around the verdict core (pre-flight, artifact schema check, report guard, stop gate). They enforce that the gate runs and that nothing contradicts it; they never compute a verdict.

**Why.** Moving the verdict into `verdict.mjs` fixed *how* it is decided but not *whether* the model runs it, writes what it printed, or stops when evidence is unusable. Those were still prose.

**Placement.** Project-level `settings.json`, not SKILL.md frontmatter. Frontmatter hooks register only after the skill is invoked, which is too late to pre-flight the invocation, and a frontmatter `Stop` hook is converted to `SubagentStop`. The scripts still ship inside `skills/figma-validate/hooks/` so copying the skill directory carries them.

**Logic lives in `lib/`.** `guards.mjs` and `schema.mjs` are pure and dependency-free like the rest of `lib/`; the hook scripts are thin adapters. The adapters are tested by spawning them with realistic payloads.

**Fail-open points.** If `node` is missing the pre-flight blocks, but the other three would be a non-blocking error; validation cannot run without node anyway. If the `UserPromptExpansion` payload carries no recognisable ticket, pre-flight allows with a warning rather than blocking on a shape it cannot read.

**Deliberately not built.** Auto-running `/figma-validate` after edits (slow, races the gate); block-CSS lint on edit; a spec-freeze prompt; an audit log. Each is plausible, none closes a gap the gate has today.

---

## Addendum — 2026-10-09: runtime checks and the run log

Ported from the originating project's local improvements, where they had been running as prose in
its copy of `figma-validate`.

**Decision 1 — runtime accessibility and performance are rules in the core, not prose.** The
originating skill told the model to fail on axe violations, a failed keyboard pass or CLS over 0.1.
Here those are rule 4 in `verdict.mjs`, read from a new required `runtime` section of
`evidence.json`, and the hooks enforce them without changes because they already call `evaluate()`.
Copying them as prose would have reopened exactly the gap the 2026-09-30 addendum closed.

- **Gating:** any axe-core violation inside the block; axe failing to load or finding no block; any
  keyboard failure (order, visible focus, trap); CLS above `CLS_THRESHOLD` (0.1) unless attributed
  outside the block; a lazy-loaded first-section image.
- **Informational only:** LCP, the Lighthouse accessibility score, axe `incomplete` items. Lab
  timings on a local server are not field data, Lighthouse cannot be scoped to one block, and
  `incomplete` means axe could not decide.
- **Missing runtime evidence is unevaluable (exit 2), not a pass.** A project whose browser MCP
  cannot trace sets `runtime_checks.performance: false` and the skill records `skipped`, which the
  report shows as *not measured*. The alternative — treating an absent record as skipped — would
  have kept older evidence files valid, and was rejected because it lets an omission pass silently.
- **axe-core is not a dependency of the pack.** The skill injects it into the page under test, from
  the consuming project's `node_modules` if served, else a CDN copy pinned by `axe_core_version`.
  The pack's install model is unchanged.

**Decision 2 — the run log lands as `lib/runlog.mjs`.** It implements the "Future work" above.
Three differences from the originating version: rows are derived from `evidence.json` through
`evaluate()` rather than typed as CLI flags; `CLS_THRESHOLD` is imported, not duplicated; and the
report text is written for any team reading it. The log path is config
(`run_log_path`) and belongs in the consuming project's `.gitignore`.

**Decision 3 — coverage is reported in CI, not gated.** `@vitest/coverage-v8` and `vitest` are both
pinned to 5.0.3, because the plugin declares an exact peer version. Dev-only, like the rest of
`package.json`. Vitest 5 requires Node 22.12 or later, so that is the floor for running the test
suite; the pack itself has no dependencies and its Node requirement is unchanged.

**Not ported.** The originating project's agent-pipeline instruction changes (out of scope by §1),
its tests for its own application code, and its SonarCloud upload.
