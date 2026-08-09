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

## What's interactive

**Control deck (left rail)** — pill chips toggle *Files* (the stage track and explorer card),
*Diagram* (the phase board) and *Prompt* (the invocation node). Files and Diagram are mutually
protective: switching one off forces the other on, so the stage is never empty. Below them each
workflow layer (Config, Gates, MCP, Subagents, Model) has a three-way segmented control: `off`
hides it, `base` draws the headline path, `ext` additionally reveals the fine-grained chips —
individual MCP calls, the full fail-stop checklist, per-node detail. Hovering or focusing any
control explains it in the line below the deck.

**Context gauge (left rail)** — a radial dial over a ~200K budget with a dashed tick at the
**83.5%** auto-compaction threshold. The composition list underneath itemises what is in the
payload at the current stage and layer settings: system prompt, cached SKILL.md prefix, config and
token files, `design.md`, Figma vision tokens, browser snapshots, then conversation messages. The
dial never reads below that fixed prefix, so the slider only grows the message portion. Past the
tick the dial turns red and the history block on the board collapses to a `<summary>` — the cached
skills + config prefix above it survives untouched.

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
verdict), with the FAIL loop back to phase 02.

## Files

- `index.html` — markup shell
- `styles.css` — palette, hero, rail cards, stage track, phase lanes, node styles
- `data.js` — all content: layers, stages, phases, files, board nodes, token segments
- `app.js` — state, control deck, file tree, board renderer, gauge

Content edits belong in `data.js`; the renderers are generic.
