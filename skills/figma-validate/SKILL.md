---
name: figma-validate
description: Browser-based visual + behavioural validation for a component. Drives the configured browser MCP to render authored content at each configured breakpoint, compares against the design.md spec and Figma screenshots, spot-checks computed styles vs the Layout Matrix, runs lint + tests, emits PASS/FAIL. Config-driven. Explicit invocation only — use only when the user types "/figma-validate" or "figma-validate <ticket-or-slug>".
disable-model-invocation: true
---

# Figma Validate

Companion to [figma-specify](../figma-specify/SKILL.md) and [figma-screenshot](../figma-screenshot/SKILL.md). After implementation, this skill verifies the live block matches the design reference produced by `/figma-specify`.

## Config (read first)

Read `figma-to-code.config.md` (root, fallback `.claude/`). If missing, STOP
and point the user at the template. Bind: `mcp.browser` (REQUIRED — stop if
empty), `mcp.content_store` (OPTIONAL), `spec_output_path`,
`content_path_template`, `preview_url_template`, `breakpoints`, `themes`,
`lint_cmd`, `test_cmd`.

**Spec dir** — defined once, used everywhere below:
`spec_output_path` in config is the FULL path to the spec file including the
filename (e.g. `drafts/specs/{ticket}/design.md`). The **spec dir** for a given
ticket is the directory that contains the spec file — i.e. `spec_output_path`
with `{ticket}` substituted and the trailing `/design.md` filename removed
(e.g. `drafts/specs/{ticket}/`). This is the same directory that
`figma-specify` writes `design.md` into and `figma-screenshot` saves
`figma-*.png` into. All path references below use `<spec-dir>` to mean this
resolved directory.

**content_store behaviour:**
- If `mcp.content_store` is set and `content_path_template` is filled, this
  skill may auto-create missing authored test content via that MCP (never
  overwrite existing content — ask first).
- If `mcp.content_store` is empty, SKIP auto-creation. Expect the user to have
  authored/served content reachable at `preview_url_template`; if nothing
  renders there, STOP and ask.

**Scope — runtime validation only:**
- Render the authored content file in a real browser via the `mcp.browser` server
- Capture screenshots at the viewports from `breakpoints` (config) that have a Figma frame
- Compare against `<spec-dir>/figma-*.png` and the rules in `design.md`
- Spot-check computed CSS (`flex-direction`, `gap`, resolved token colors, font sizes) against the Layout Matrix, **reading expected values from `<spec-dir>/design.matrix.json`** — the structured sidecar `/figma-specify` writes, not the markdown table
- Surface console errors and network failures
- Run `lint_cmd` (config; skip if empty) and `test_cmd` (config; skip if empty)
- **Write `<spec-dir>/validation/evidence.json` and let `lib/cli.mjs` decide the verdict** — see Step 6b. This skill gathers evidence; it does not adjudicate numeric checks

**NOT in scope** (covered elsewhere):
- Producing or editing `design.md` (that is `/figma-specify`)
- Token gap analysis (already produced by `/figma-specify`)
- Static a11y / lint analysis without a browser

## Pre-flight (mandatory — fail-stop if any is missing)

1. **Ticket ID resolvable** — `{ticket}` from invocation argument.
2. **`<spec-dir>/design.md` exists** — produced by `/figma-specify`. If missing, **STOP** and instruct: "Run `/figma-specify {ticket}` first."
2b. **`<spec-dir>/design.matrix.json` exists and parses** — the structured Layout Matrix, also produced by `/figma-specify`. If it is missing or malformed, **STOP** and instruct: "Re-run `/figma-specify {ticket}` to regenerate the sidecar." **Do not fall back to parsing the markdown table**: reconstructing expectations from prose is how a row quietly stops being checked while the report still says PASS.
2c. **Node is available** — `lib/cli.mjs` runs the verdict core. If `node` is not on PATH, **STOP**; do not adjudicate the checks by hand instead.
3. **Figma screenshots exist** under `<spec-dir>/figma-*.png`. If none, **STOP** and instruct: "Run `/figma-screenshot {ticket} <figma-url>` for each frame referenced in design.md, then re-run."
4. **Authored test content** reachable at `preview_url_template` (from config).
   - If `mcp.content_store` is set: probe via that MCP using `content_path_template` (from config); if the entry is missing, **auto-create** it — see Step 1b for content rules.
   - If `mcp.content_store` is empty: verify that `preview_url_template` responds; if nothing renders, **STOP** per the Fail-Stop rule below and ask the user to author or serve content.
   - If the `mcp.content_store` server is unavailable or returns an auth error, **STOP** per the Fail-Stop rule below. Do not silently fall back to asking the user to create the file by hand.
5. **Dev server running** — start via your project's local dev command. If port not bound, start it (`run_in_background`) and wait for ready.
6. **`mcp.browser` server available**. If the MCP is not connected, **STOP** per the Fail-Stop rule below — do not substitute.

**Enforced by hooks when installed.** Items 2, 2b and 3 (and the config file)
are also checked by `hooks/preflight.mjs` before this skill starts,
`hooks/artifact-check.mjs` validates `design.matrix.json` and `evidence.json` as
they are written, and the verdict rules below are enforced by
`hooks/report-guard.mjs` and `hooks/verdict-stop.mjs`. The hooks are optional — merge `hooks/settings.snippet.json`
into the project's `.claude/settings.json` (see the README). Installed or not, do the checks above: the hooks are a backstop,
not a substitute.

**Fail-Stop rule:** When any external resource fetch fails — MCP call, URL, API endpoint — STOP immediately. Do not fabricate, infer, or guess the missing content. Report which MCP or resource failed and wait for the user to resolve it.

## Inputs

| Input | Example | Source |
|---|---|---|
| Ticket ID | `{ticket}` | Argument |
| Block name | `teaser` | `design.md` Source block, or ticket title |
| Preview URL | `preview_url_template` (from config) | Config |
| Viewports to test | the viewports from `breakpoints` (config) | Config + `design.md` breakpoint overrides |
| Figma screenshots | `<spec-dir>/figma-*.png` | From `/figma-screenshot` |
| Output dir | `<spec-dir>/validation/` | Created if missing |

## Step 1: Resolve Inputs and Verify Pre-flight

- Parse `{ticket}` from argument.
- Read `<spec-dir>/design.md`. Extract:
  - Block name and block-scoped class names
  - Variants and modifier classes mentioned in `## Variant CSS`
  - Layout Matrix rows (container, breakpoint, expected `flex-direction` + `gap`)
  - Design Token Mapping table (element → CSS property → token name)
  - Breakpoints to test from the viewports in `breakpoints` (config; skip any breakpoint `design.md` does not cover)
  - Visual Acceptance Checklist
- List `<spec-dir>/figma-*.png` to know what to diff against.
- Probe content store for the test file (see Step 1b). Create it if missing (only when `mcp.content_store` is set).
- Local URL to navigate after the file exists: `preview_url_template` (from config).
- `mkdir -p <spec-dir>/validation/`.

## Step 1b: Ensure Test Content Exists (auto-create via `mcp.content_store`)

This step applies ONLY when `mcp.content_store` is set in config.

Content path: `content_path_template` (from config) — e.g. for a DA-backed project using the `da-live` MCP, this would resolve to something like `<org>/<repo>/drafts/<author>/<block-name>.html`, but the exact path is always config-driven.

Use the `mcp.content_store` server's list tool (tool names per that MCP — e.g. `da_list_sources` for the `da-live` MCP) to check whether the file exists. If it does, skip to Step 2.

Otherwise generate content and create the file via the `mcp.content_store` server's create tool (e.g. `da_create_source` for the `da-live` MCP).

### Content generation rules

The file is a full authored HTML document. The shell is fixed; only the `<main>` payload changes per block:

```html
<body>
  <header></header>
  <main>
    <!-- one or more authored variants, in this order: -->
    <div><p><strong>V1 — &lt;block-name&gt; — &lt;variant or scenario label&gt;</strong></p></div>
    <div><div class="<block-name> <variant-classes>">
      <!-- authored rows from design.md "HTML Structure" section,
           translated into the block-table shape:
           each block-table row is a nested <div>, each column is a nested <div> inside it.
           Use placeholder copy (h1/h2/h3, p, a) and demo links to https://google.com/. -->
    </div></div>

    <!-- Section overrides (only if design.md mentions them) -->
    <div><div class="section-metadata"><div><div><p>Style</p></div><div><p>background-primary</p></div></div></div></div>

    <!-- Theme override (only if design.md says this block should be tested per theme) -->
    <div class="metadata"><div><div><p>theme</p></div><div><p><!-- theme name from config themes list --></p></div></div></div>
  </main>
  <footer></footer>
</body>
```

**Variant coverage** — one authored block per row in `design.md`'s "Variant CSS" section + one per major Layout Matrix scenario that needs visual differentiation.

**Tokens / colors / images**:
- Do NOT hardcode color hexes in authored content — the content store stores semantic content, not visual styling.
- For images, use a placeholder `<picture>` block with a known media path or upload via the content store's media upload tool if the design requires a specific image. If unsure, omit the image and add a `## TODO` comment in the validation report.
- Use a short demo heading + 1–2 sentences of body copy + 1–2 CTAs (links to `https://google.com/`) per variant.

### Create the file

Use the `mcp.content_store` server's create tool (e.g. `da_create_source` for the `da-live` MCP) with the resolved `content_path_template` path and the generated HTML content.

Re-list to verify the file appears; if not, treat as a Fail-Stop and report the error.

### When the file already exists

Read it via the content store's get tool (e.g. `da_get_source` for the `da-live` MCP). If the existing variants do not cover the design.md acceptance checklist, **STOP** and ask the user whether to extend it or proceed with what's there. Do not silently overwrite — the file may contain author-curated test cases from earlier tickets.

## Step 2: Start / Confirm Dev Server

```bash
# Check if dev server already running (adjust port/path to match your project's local dev command)
curl -fsS http://localhost:3000/ >/dev/null 2>&1 || (echo "Starting dev server…"; <your-local-dev-cmd> &) ; sleep 3
```

Block until the server responds 200 on the block's preview path, or fail-stop after 30s.

## Step 3: Drive the Browser via the `mcp.browser` Server

For each viewport in the viewports from `breakpoints` (config) (filter to what `design.md` covers):

1. `new_page` (or `select_page` if already open) → navigate to the block's local preview URL (`preview_url_template` from config).
2. `emulate` → set viewport width (heights: mobile 667, tablet 1024, desktop 800, wide 900, xl 900).
3. `wait_for` block's root selector (`.<block-name>`) to render.
4. `take_snapshot` (DOM + a11y tree) → save to `<spec-dir>/validation/snapshot-<viewport>.json`.
5. `take_screenshot` → save as `<spec-dir>/validation/browser-<viewport>.png`.
6. `list_console_messages` → record any errors/warnings.
7. `list_network_requests` (filter to failures) → record any 4xx/5xx.
8. `evaluate_script` to read computed styles for each Layout Matrix row:
   ```js
   const el = document.querySelector('.<container-class>');
   const cs = getComputedStyle(el);
   return { flexDirection: cs.flexDirection, gap: cs.gap, display: cs.display };
   ```
   Compare each result against the expected value for that breakpoint in the Layout Matrix.
9. `evaluate_script` to resolve each token in the Design Token Mapping table:
   ```js
   const el = document.querySelector('.<target-class>');
   return getComputedStyle(el).<property>;
   ```
   Confirm the resolved value matches the token's expected resolution in the current theme.

All browser tool names above (e.g. `new_page`, `emulate`, `take_screenshot`) refer to the `mcp.browser` server's tools — use the actual tool names that server exposes.

## Step 4: Visual Diff

For each viewport, place `browser-<viewport>.png` next to the corresponding `figma-*-<viewport>.png` and assess:

- **Layout**: same flex/grid direction, gap, alignment
- **Typography**: matching font family, size hierarchy, line-height
- **Color**: token-resolved colors visually identical
- **Spacing**: padding/margin between major regions consistent
- **Interactive elements**: CTAs, hovers (if hover capture is feasible via `hover` then `take_screenshot`)

This is a model-visual comparison; do not run a pixel-diff library — flag noticeable deltas with severity (blocker / major / minor).

## Step 5: Theme Checks (if `design.md` lists multiple themes)

If the block is rendered across themes, navigate the preview URL with each theme class applied (the dev server typically respects a `?theme=` query or a body class set via metadata).

For each theme in the themes from `themes` (config); skip theme checks if `themes` is empty:
- Switch theme → `take_screenshot` (via the `mcp.browser` server) → `evaluate_script` to confirm theme token overrides resolved correctly
- Save as `browser-<viewport>-<theme>.png`
- Compare colour-bound elements (CTAs, headings, backgrounds) against the expected token resolution

## Step 6: Lint + Unit Tests

```bash
# Run lint_cmd (config; skip if empty)
<lint_cmd>
# Run test_cmd (config; skip if empty)
<test_cmd>
```

Capture exit codes and any failures. Skip the corresponding step if the config value is empty.

## Step 6b: Write the evidence file and let code decide the verdict

**The verdict is not a judgement call and is not made by reading the rules
below.** Write everything gathered so far to
`<spec-dir>/validation/evidence.json`, then run the verdict tool:

```bash
node <skill-dir>/lib/cli.mjs <spec-dir>/validation/evidence.json
```

It prints the report body and exits **0 for PASS, 1 for FAIL, and 2 when the
evidence could not be evaluated at all**. Treat 2 as a fail-stop, not a
failure: it means the gate did not run, which is a different problem from the
implementation being wrong, and conflating the two is how a broken gate starts
looking like a clean one.

**Evidence shape.** Expected values come from `design.matrix.json` (written by
`/figma-specify`); read that file, never the markdown Layout Matrix table.

```json
{
  "block": "teaser",
  "viewports": [
    {
      "name": "desktop",
      "rows": [
        {
          "container": ".teaser-inner",
          "inherited": false,
          "results": [
            { "prop": "gap", "match": false, "severity": "minor", "reason": "expected 32px, computed 32.5px" }
          ]
        }
      ],
      "tokens": [
        { "element": ".teaser-title", "property": "color", "expected": "var(--heading-color)", "resolved": "rgb(16, 17, 20)", "match": true }
      ],
      "consoleErrors": 0,
      "networkFailures": 0
    }
  ],
  "visualDeltas": [{ "viewport": "desktop", "severity": "minor", "note": "1px CTA offset" }],
  "gates": { "lint": "pass", "test": "skipped" }
}
```

Produce each `results` entry with `lib/compare.mjs` rather than by eye —
`compareRow(row, computedStyles)` handles unit normalisation (`2rem` against
`32px`, `gap: normal` against `0px`, a `flex-flow` shorthand reading such as
`row nowrap` against `row`) and assigns severity. Comparing the strings
directly produces false failures on every one of those cases.

**Your remaining judgement is the visual diff** (Step 4) and the severity you
assign to each visual delta. That genuinely is a judgement and it is labelled
as one. Everything numeric is decided by code.

## Step 7: Report

Write `<spec-dir>/validation/report.md`:

```markdown
# Validation Report — {ticket}

**Verdict**: PASS | FAIL
**Date**: YYYY-MM-DD
**Block**: <name>
**Test content**: <preview_url_template resolved for this block>

## Viewports

| Viewport | Browser screenshot | Figma reference | Match | Notes |
|---|---|---|---|---|
| <breakpoint 1> | browser-<vp>.png | figma-<vp>.png | ✓ / ✗ | … |
| <breakpoint 2> | … | … | … | … |
| <breakpoint N> | … | … | … | … |

## Layout Matrix verification

| Container | Breakpoint | Expected | Computed | Match |
|---|---|---|---|---|
| .block-inner | 1024 | flex-direction: row; gap: 32px | row; 32px | ✓ |

## Token resolution

| Element | Property | Expected token | Resolved value | Match |
|---|---|---|---|---|

## Console / network

- Errors: <count> (list)
- Failed requests: <count> (list)

## Theme checks (if applicable)

| Theme | Viewport | Match | Notes |

## Lint & tests

- `lint_cmd`: pass/fail
- `test_cmd`: pass/fail (X tests)

## Remediation (if FAIL)

- [ ] Fix #1 — file:line — what to change
- [ ] Fix #2 — …
```

**The `**Verdict**:` line must be the one `lib/cli.mjs` printed.** With the
hooks installed, a report that states a different verdict than the gate computes
from `evidence.json` is refused, no report is accepted when the evidence cannot
be evaluated (exit 2), and the session cannot end with a stale or missing report.

Then output a concise summary to the conversation:
- Verdict (PASS / FAIL)
- Top 3 issues (if FAIL)
- Path to `report.md` and the screenshots
- Next step: PR (if PASS) or fix list (if FAIL)

## PASS / FAIL Criteria

**These rules live in `lib/verdict.mjs` and are executed, not interpreted.**
They are described here so a reader knows what the tool does; the tool is the
authority. If this section and the code ever disagree, the code is right and
this section is a bug.

**PASS** requires all of:
- No blocker visual delta at any viewport
- Every Layout Matrix row matching computed style **at a breakpoint that sets
  the property** — a row marked `inherited` declares no override, so a
  difference there is recorded as information, not a failure
- Every token in the Design Token Mapping resolving to its expected value
- No console errors and no failed network requests
- `lint_cmd` and `test_cmd` exiting 0, or skipped when the config value is empty

**Minor deltas** — spacing within **2px** — are recorded and do not fail on
their own. They fail when **the same container and the same property** drift at
**two or more viewports**, because that is a systematic offset rather than a
rounding artefact. Drift on different properties, or on different containers,
does not aggregate.

**Unusable evidence is not a verdict.** No viewports captured, a malformed
evidence file, or an unrecognised gate status makes the tool exit **2** without
emitting PASS or FAIL. A gate that cannot evaluate its input must not report a
result — the dangerous failure here is a PASS nobody earned.

**An unverifiable reading fails rather than passes.** If a computed value is
missing or cannot be resolved to a length, that property is a blocker: the gate
did not verify it, and "did not verify" must never resolve to a match.

The thresholds are `MINOR_PX_TOLERANCE` and `RECURRENCE_THRESHOLD` in
`lib/compare.mjs` and `lib/verdict.mjs`, both pinned by tests. See
`docs/TESTING.md` for why they are pinned as literals rather than derived.

## Key Rules

- **Fail-stop on missing prerequisites**: design.md, Figma screenshots, dev server, `mcp.browser` server, `mcp.content_store` server (when configured) — all required. Stop and ask; never guess.
- **Test content is auto-created via `mcp.content_store`** when missing and `mcp.content_store` is configured — see Step 1b. If the MCP itself is unavailable, fail-stop (do not fall back to "ask user to create manually" — that defeats the automation).
- **Existing content files are NOT silently overwritten.** If the file exists but its variants don't cover design.md, ask before extending it.
- **Read-only on code**: this skill never edits block JS/CSS. If FAIL, report remediation and exit; the user or a fix agent re-runs after fixing.
- **Read-only on Figma and the ticket**: no MCP writes.
- **`mcp.browser` server only for the browser** — no substitution with WebFetch or screenshot scraping.
- **`mcp.content_store` server only for content store writes** — no curl fallback, no UI automation via the browser MCP.
- **Idempotent on validation output**: re-running the skill overwrites `<spec-dir>/validation/` for that ticket. Safe to run on every iteration. Content store files are *not* overwritten — only created when missing.

## Integration with existing agents

Runs standalone via `/figma-validate`. Read-only on code, Figma, and the ticket; it reports remediation and exits, it does not fix code.

## What this skill does NOT do

- Does not modify tickets
- Does not modify Figma
- Does not edit existing content store files (it *can* create the test file when missing; it never overwrites)
- Does not edit `design.md`, block JS, block CSS, or global styles
- Does not create a feature branch or commit
- Does not run a pixel-diff library — visual comparison is model-driven, not byte-identical
