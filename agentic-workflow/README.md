# Agentic Workflow — interactive presentation

A single-page, dependency-free presentation of the `aem-eds-figma-to-code` loop:
**specify → screenshot → build → validate**.

Layout and components are original: a blueprint-grid
backdrop, a full-width hero, a sticky left control rail, a radial context gauge and a
three-lane phase board.

## Run it

No build step and no dependencies. Opening `index.html` straight from disk works (only the
Google Fonts link needs network; without it the system mono/sans stack is used). To serve it
instead, run one of these from this folder and open http://localhost:4173/:

```bash
python3 -m http.server 4173
npx serve . -l 4173
```

Deployed via GitHub Pages (Settings → Pages → deploy from `main`, root) at
https://skojic.github.io/aem-eds-figma-to-code/agentic-workflow/. All asset paths are relative,
so the subdirectory works without configuration; a `.nojekyll` marker at the repo root keeps
Pages from running the files through Jekyll.

## What's interactive

**Hero pipeline** — a static, at-a-glance view of the toolchain: Jira (`ticket_tracker`) → Figma
(design source) → Vitest (`test_cmd` gate) → Browser (`mcp.browser`), wrapped in a frame badged
with the Claude, OpenAI, Gemini and Codex marks. The line under it is deliberately precise: the
**methodology is portable**, but this pack ships as Claude Code skills — and one
`figma-to-code.config.md` binds all four tools.

**Control deck (left rail)** — pill chips toggle *Files* (the stage track and explorer card),
*Diagram* (the phase board) and *Prompt* (the invocation node). Files and Diagram are mutually
protective: switching one off forces the other on, so the stage is never empty. Below them each
workflow layer (Config, Gates, MCP, Subagents, Model) has a three-way segmented control:
`off` hides it, `base` draws the headline path, `extended` additionally reveals the fine-grained
detail — individual MCP calls, the full fail-stop checklist, per-node chips. Hovering or focusing
any control explains that exact combination in the line below the deck.

**Context gauge (left rail)** — a radial dial over a ~200K budget with a dashed tick at the
**83.5%** auto-compaction threshold. It models the payload as a cached prefix plus a conversation:

```
total = cached prefix + (Conversation length % × remaining headroom)
```

The prefix is whatever the current stage and layers actually put in the payload — system prompt,
the SKILL.md files, `figma-to-code.config.md`, token files, `design.md`, Figma vision tokens,
browser snapshots — itemised in the composition list underneath. Because it is a prefix and not a
floor, **every toggle moves the dial**: at stage 7 with all layers extended the reading is ~46%,
dropping to ~39% with Config and MCP off, and the slider at zero exposes the ~24% you pay before
typing a word. Past the tick the dial turns red and the history block on the board collapses to a
`<summary>`, while the cached prefix above it survives untouched — which is the argument for
keeping project specifics in one small config file instead of inlining them into prompts.

The token figures are deliberate estimates, labelled as approximate in the UI; they are there to
show relative cost, not to be quoted as measurements.

**Stage track** — eight ticks, `0`–`7`, from a plain EDS project to a completed validation run.
Files appear as they would on disk: the three `SKILL.md` files, `figma-to-code.config.md`, then the
generated `design.md`, Figma PNGs, your block source and the validation artifacts; newly added
files animate in. Click a file — or focus it and press Enter/Space — to see what it contributes;
the board node it drives lights up, and files with no board counterpart say so. `←` / `→` step
through stages.

**Phase board** — three side-by-side lanes instead of one long stack:
`01 Specify` (invocation → request payload → fail-stops → `mcp.figma` → layout extraction →
`design.md` → token-gap pass), `02 Capture & build` (screenshot capture and *your* implementation
step), `03 Validate` (pre-flight → content store → browser breakpoint loop → visual diff →
verdict), with the FAIL loop back to phase 02. The request-payload node in lane 01 reacts live to
the stage, the layer settings and the conversation slider.

## Colour, accessibility and performance
Colour is deliberately restrained. Only three hues carry meaning on the board — pink for
fail-stop gates, cyan for MCP tool calls, amber for model decisions — and everything else is
neutral. Node type is always stated in text as well, so hue is reinforcement, never the sole
signal. The phase lanes share one neutral accent so they cannot be confused with node types, and
the controls are entirely monochrome: selection is shown with fill and weight, not hue, so the
chrome never competes with the board. The saturated brand colours are confined to the hero
pipeline, where recognition is the point.

- Visible `:focus-visible` rings on every control; the stage track is a tab list, the file tree a
  `tree`/`treeitem` structure, and each layer control a `radiogroup` with arrow-key navigation.
- `prefers-reduced-motion: reduce` disables the remaining animations.
- Body text sits at or above 0.7rem (~11px); the muted and secondary greys clear 4.5:1 on the
  panel background, and the slider is 26px tall so the pointer target clears 24×24px.
- No `filter: blur()` layers; the only looping animation left is the small status dot in the
  eyebrow, and dragging the slider swaps just the payload node rather than rebuilding the board.

## Files

- `index.html` — markup shell
- `styles.css` — palette, hero, rail cards, stage track, phase lanes, node styles
- `data.js` — all content: layers, stages, phases, files, board nodes, token segments
- `app.js` — state, control deck, file tree, board renderer, gauge

Content edits belong in `data.js`; the renderers are generic.
