# Workflow: Figma → Spec → Build → Validate

This document describes the end-to-end loop these three skills support and explains how they fit around your own implementation step.

> **Prefer to see it?** The same loop is available as an interactive diagram:
> **[Agentic Workflow presentation](https://skojic.github.io/aem-eds-figma-to-code/agentic-workflow/)**.
> It steps through the files each skill adds to your project, lets you switch the fail-stop gates,
> MCP calls and subagents on and off, and estimates what the loop costs in context.
> Source in [`agentic-workflow/`](../agentic-workflow/).

---

## Overview

```
/figma-specify <ticket-or-slug>      ← extract design context from Figma
/figma-screenshot <ticket-or-slug> <figma-url>   ← save Figma frames as PNG evidence
[ implement the block from design.md — YOUR step ]
/figma-validate <ticket-or-slug>     ← verify the live block against spec + Figma
```

The skills produce the **spec** (`design.md`) and the **check** (PASS/FAIL report). They do not write block JavaScript or CSS — that is the implementation step between screenshot capture and validation.

---

## Prerequisites checklist

Before running any skill, confirm:

- [ ] `figma-to-code.config.md` exists at your project root (fallback: `.claude/figma-to-code.config.md`). See the [config template](../config/figma-to-code.config.template.md) and the [generic EDS example](../config/examples/eds-example.config.md).
- [ ] The Figma MCP (configured as `mcp.figma`) is connected and authenticated.
- [ ] For `/figma-validate`: the browser MCP (configured as `mcp.browser`) is connected.
- [ ] For `/figma-validate`: your local dev server is running (or can be started by the skill).
- [ ] If you use a ticket-tracker MCP (`mcp.ticket_tracker`), the ticket has been fetched before calling `/figma-specify`.
- [ ] If you use a content-store MCP (`mcp.content_store`), the MCP is connected before calling `/figma-validate`.

Missing any required MCP or config → the skill fails immediately and tells you what to fix. It will never guess, infer, or fabricate missing data.

---

## Step 1 — `/figma-specify <ticket-or-slug>`

**What it does:**

Reads the Figma file referenced in the ticket (or supplied directly), extracts visual and stylistic design context — layout, spacing, colours, typography, interactive states — and writes a `design.md` spec at the path configured in `spec_output_path`.

`design.md` becomes the source of truth for HTML and CSS during implementation. Functional requirements and acceptance criteria stay in the ticket.

**Key outputs inside `design.md`:**
- HTML Structure — the semantic DOM hierarchy after decoration
- CSS Skeleton — mobile-first, block-scoped, with `@media` ladder
- Layout Matrix — `flex-direction`, `gap`, alignment per container per breakpoint
- Design Token Mapping — each element's CSS properties mapped to design tokens
- Breakpoints and per-breakpoint overrides
- Dynamic Content Elements — with the no-invented-dimension rule applied
- Interactive States
- Token Gaps — any value present in Figma but absent from the design-system token files
- Visual Acceptance Checklist

**Invocation:**

```
/figma-specify PROJ-123
/figma-specify my-component
```

The skill resolves the output path from `spec_output_path` in config (e.g. `drafts/specs/PROJ-123/design.md`). If the file already exists it asks before overwriting.

**Fail-stop conditions:**
- `figma-to-code.config.md` missing → STOP, point to template.
- `mcp.figma` not connected or auth failure → STOP, report the error.
- Ticket tracker MCP unavailable (when `mcp.ticket_tracker` is set) → STOP, report the error.
- Do not fall back to guessing Figma file keys, token values, or ticket descriptions.

---

## Step 2 — `/figma-screenshot <ticket-or-slug> <figma-url>`

**What it does:**

Fetches a single Figma node as a PNG via the `mcp.figma` server and saves it into the same spec directory as `design.md`. Run once per major frame referenced by the spec (e.g. once for each breakpoint frame you want as audit evidence).

These screenshots become the visual reference for `/figma-validate`.

**Invocation:**

```
/figma-screenshot PROJ-123 https://figma.com/design/<fileKey>/My-Component?node-id=1-177
/figma-screenshot my-component https://figma.com/design/<fileKey>/My-Component?node-id=5-42
```

The skill parses `fileKey` and `nodeId` from the URL you supply. It does not use a default file key. The saved file is named `figma-{slug}-{viewport}.png` (or a name you specify).

**Fail-stop conditions:**
- `figma-to-code.config.md` missing → STOP.
- `mcp.figma` unavailable or auth error → STOP.
- Figma URL not provided → ask; never guess a `fileKey` or `nodeId`.

---

## Implementation step (your work)

With `design.md` and the Figma screenshots in place, implement the block:

1. Use the HTML Structure section to build the decorated DOM.
2. Follow the CSS Skeleton — mobile-first, block-scoped, one ladder per component.
3. Resolve every `var(--…)` against your design-system token files (L2/L3 per the `token_layer_model` in your config); fix any Token Gaps flagged in `design.md` before writing block CSS.
4. Check the Layout Matrix: whenever a container's `flex-direction` or `gap` differs between tablet and desktop, restate it explicitly in the `@media (width >= <desktop-breakpoint>)` block — do not rely on cascade inheritance.
5. Do not invent `width` or `max-width` on Dynamic Content Elements unless Figma explicitly defines the property for that node.

The skills have no involvement in this step.

---

## Step 3 — `/figma-validate <ticket-or-slug>`

**What it does:**

Drives the browser MCP to render the authored test content at each configured breakpoint. Compares browser screenshots against the Figma reference PNGs, spot-checks computed styles from the Layout Matrix via `evaluate_script`, resolves token values, surfaces console errors and failed network requests, runs lint and tests, then emits a PASS/FAIL verdict with a remediation list.

**Invocation:**

```
/figma-validate PROJ-123
/figma-validate my-component
```

**Pre-flight (fail-stop if any is missing):**
1. `design.md` exists at the configured `spec_output_path` for this ticket/slug. If not: run `/figma-specify` first.
2. At least one `figma-*.png` screenshot exists in the same directory. If not: run `/figma-screenshot` first.
3. Authored test content is reachable at `preview_url_template` (from config). If `mcp.content_store` is configured, the skill auto-creates the file when it is missing; if the content-store MCP itself is unavailable it stops rather than asking you to create the file by hand. If no `mcp.content_store` is configured, author and serve the content yourself before running.
4. Dev server is running (or can be started).
5. `mcp.browser` MCP is connected.

**Outputs:**
- `{spec_dir}/validation/browser-<viewport>.png` — one screenshot per breakpoint
- `{spec_dir}/validation/snapshot-<viewport>.json` — DOM + a11y tree
- `{spec_dir}/validation/report.md` — PASS/FAIL verdict, Layout Matrix verification, token resolution, console/network summary, lint/test results, remediation checklist

**PASS** requires:
- All viewport screenshots match their Figma reference (no blocker-level deltas)
- Every Layout Matrix row matches computed style at the relevant breakpoint
- Every Design Token Mapping entry resolves to the expected value
- No console errors or failed network requests for block assets
- `lint_cmd` exits 0 (skipped if not configured)
- `test_cmd` exits 0 (skipped if not configured)

Any blocker delta, Layout Matrix mismatch, lint failure, or test failure → **FAIL**. Fix and re-run.

**Fail-stop conditions:**
- `figma-to-code.config.md` missing → STOP.
- `mcp.browser` not connected → STOP; no substitution with WebFetch or scraping.
- Content-store MCP unavailable (when `mcp.content_store` is set) → STOP; do not fall back to "create the file by hand".
- Dev server not reachable after 30 s → STOP.

---

## Fail-stop behaviour — general rule

All three skills follow the same rule:

> When any external resource fetch fails — MCP call, URL, API endpoint — **STOP immediately**. Do not fabricate, infer, or guess the missing content. Report which MCP or resource failed and wait for the user to resolve it.

Missing data is a blocker, not a creative prompt. This applies to subagents that any skill may spawn.

---

## Adapting to a non-EDS project

The skills default to the Adobe EDS block model. To adapt:

1. Edit the `component_model` section of your `figma-to-code.config.md` — describe your scoping mechanism (BEM, CSS Modules, etc.), component entry point, authoring shape, and hardcoded-value rules.
2. Update `token_layer_model` to describe your token architecture.
3. Set `mcp.content_store` to empty if you do not use a headless CMS MCP; author and serve test content yourself before `/figma-validate`.

The SKILL.md files themselves do not need to be edited — all project specifics are in the config.
