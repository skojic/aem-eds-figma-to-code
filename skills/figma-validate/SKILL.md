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
- Spot-check computed CSS (`flex-direction`, `gap`, resolved token colors, font sizes) against the Layout Matrix
- Surface console errors and network failures
- Run `lint_cmd` (config; skip if empty) and `test_cmd` (config; skip if empty)
- Emit a PASS/FAIL verdict with remediation steps

**NOT in scope** (covered elsewhere):
- Producing or editing `design.md` (that is `/figma-specify`)
- Token gap analysis (already produced by `/figma-specify`)
- Static a11y / lint analysis without a browser

## Pre-flight (mandatory — fail-stop if any is missing)

1. **Ticket ID resolvable** — `{ticket}` from invocation argument.
2. **`<spec-dir>/design.md` exists** — produced by `/figma-specify`. If missing, **STOP** and instruct: "Run `/figma-specify {ticket}` first."
3. **Figma screenshots exist** under `<spec-dir>/figma-*.png`. If none, **STOP** and instruct: "Run `/figma-screenshot {ticket} <figma-url>` for each frame referenced in design.md, then re-run."
4. **Authored test content** reachable at `preview_url_template` (from config).
   - If `mcp.content_store` is set: probe via that MCP using `content_path_template` (from config); if the entry is missing, **auto-create** it — see Step 1b for content rules.
   - If `mcp.content_store` is empty: verify that `preview_url_template` responds; if nothing renders, **STOP** per the Fail-Stop rule below and ask the user to author or serve content.
   - If the `mcp.content_store` server is unavailable or returns an auth error, **STOP** per the Fail-Stop rule below. Do not silently fall back to asking the user to create the file by hand.
5. **Dev server running** — start via your project's local dev command. If port not bound, start it (`run_in_background`) and wait for ready.
6. **`mcp.browser` server available**. If the MCP is not connected, **STOP** per the Fail-Stop rule below — do not substitute.

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

Then output a concise summary to the conversation:
- Verdict (PASS / FAIL)
- Top 3 issues (if FAIL)
- Path to `report.md` and the screenshots
- Next step: PR (if PASS) or fix list (if FAIL)

## PASS / FAIL Criteria

**PASS** requires all of:
- Every viewport's browser screenshot visually matches its Figma reference (no blocker deltas)
- Every Layout Matrix row matches computed style at the right breakpoint
- Every token in the Design Token Mapping resolves to the expected value in the current theme
- No console errors, no failed network requests for block assets
- `lint_cmd` exits 0 (skipped if config is empty)
- `test_cmd` exits 0 (skipped if config is empty)

Any blocker delta, any Layout Matrix mismatch at the breakpoint where the property is set, any lint or test failure → **FAIL**.

Minor deltas (e.g. 1–2px spacing rounding) are recorded but do not fail the run unless they recur across viewports.

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
