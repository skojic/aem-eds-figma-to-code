---
name: figma-specify
description: Extract per-feature visual design context from Figma and save it as a design.md spec (the source of truth for HTML/CSS). Config-driven via figma-to-code.config.md. Explicit invocation only — use only when the user types "/figma-specify" or "figma-specify <ticket-or-slug>".
disable-model-invocation: true
---

# Figma Specify

Extracts **visual and stylistic** per-feature design context from Figma and saves it as a `design.md` spec at the path defined in config (`spec_output_path`, e.g. `drafts/specs/{ticket}/design.md`). This artifact is the source of truth for HTML/CSS during implementation. Ticket scope (functional requirements, content model) stays in the ticket.

## Config (read first)

Read `figma-to-code.config.md` from the project root (fallback
`.claude/figma-to-code.config.md`). If it is missing, **STOP** and tell the
user to copy `config/figma-to-code.config.template.md` from the
aem-eds-figma-to-code pack and fill it in. Do not guess project specifics.

From it, bind: `mcp.figma`, `mcp.ticket_tracker`, `ticket_key_pattern`,
`ticket_url_base`, `spec_output_path`, `token_files`, `token_layer_model`,
`themes`, `breakpoints`, `component_model`. Every reference below to a token
layer, breakpoint set, theme list, scoping mechanism, or output path resolves
against this config — not against any hardcoded project.

**Scope — visual only:**
- HTML element structure and block-scoped CSS class names
- CSS styles: colours, typography, spacing, layout, breakpoints
- CSS custom properties (resolved against the token files listed in config (`token_files`))
- Interactive state appearance (hover, focus, active, disabled)
- Dynamic content element identification (content-dependent sizing)

**NOT captured here** (owned by ticket): functional requirements, acceptance criteria, author-configurable content model, business-language descriptions, behavioral logic.

## Pre-flight

1. **Ticket fetched.** This skill must run after the `mcp.ticket_tracker` server has fetched the `{ticket}` ticket matching `ticket_key_pattern`. If no ticket context is loaded, stop and instruct the user to fetch the ticket first.
2. **Figma reference identified.** Either a Figma URL provided by the user, a link in the ticket, or `figma-design-extractor` agent output.
3. **Block name known.** Resolve from ticket, user input, or feature description. EDS blocks use lowercase hyphenated names (e.g. `teaser`, `link-list`, `language-selector`).

## Step 1: Resolve Output Directory

Default output: the path from config (`spec_output_path`), e.g. `drafts/specs/{ticket}/design.md`. Create the directory if it does not exist.

If a `design.md` already exists at that path, ask user to confirm overwrite or branch (e.g. `design.v2.md`).

## Step 2: Read Figma Design

**Option A — Figma URL via MCP**: Use the `mcp.figma` server (`get_figma_data`) with parsed `fileKey` and `nodeId` from the URL:

```
https://figma.com/design/{fileKey}/{name}?node-id={nodeId}
```

Convert `node-id=1-2` (URL form) to `1:2` (MCP form).

**Option B — Figma desktop app (preferred when available)**: Ask user to select the target frame, then call `get_design_context` on the Figma desktop MCP server.

**Option C — Authentication error**: If MCP returns auth error, call `mcp_auth` first, then retry.

Use the Figma URL the user supplies or the one in the ticket; do not assume a default file key.

## Step 2b: Figma Layout Extraction (mandatory before writing CSS)

For **each** Figma frame that maps to a breakpoint from config (`breakpoints`) (mobile base, tablet 768, desktop 1024, wide 1280/1440), record **auto-layout** facts for every major container in the block:

- **Primary axis**: horizontal vs vertical (maps to `flex-direction: row` vs `column`, or grid template)
- **Gap** between children (maps to `gap`)
- **Alignment** if it affects design (`justify-content`, `align-items`)
- If a breakpoint matches the previous one for a container, write **explicitly**: *"unchanged from 768px"* in the Layout Matrix — do not let implementers infer a missing override

**Card / teaser / list groups**: Frame names alone are **not sufficient** — state the **actual** `flex-direction` per breakpoint (Figma is source of truth). If the ticket prose conflicts with Figma layout, flag it in the Report: *"Ticket vs Figma layout conflict — resolve before implementation."* Do not silently prefer prose over Figma.

## Step 3: Generate design.md

Before writing each CSS rule: if the selector targets a Dynamic Content Element or its container, verify you are not adding width/height (element) or max-width/max-height (container) unless that exact property exists in Figma for that node.

### Mobile-first CSS file order (mandatory)

The **CSS Skeleton** section MUST emit rules in this **physical order** so the cascade matches the mobile-first mental model and reviews stay predictable.

The ladder is driven by the `breakpoints` list in `figma-to-code.config.md`. The pack ships with five default breakpoints — 320, 768, 1024, 1280, and 1440 px — but the actual values for **this project** come from config, so always resolve from there.

1. **Base (mobile, first breakpoint from config)** — all rules **without** `@media`, scoped via the mechanism in `component_model` (default `@scope`). No desktop-only values here.
2. **`@media (width >= <2nd breakpoint from config>)`** — next-up overrides (pack default: 768 px)
3. **`@media (width >= <3rd breakpoint from config>)`** — next-up overrides (pack default: 1024 px)
4. **`@media (width >= <4th breakpoint from config>)`** — only if Figma includes a frame at this width (pack default: 1280 px)
5. **`@media (width >= <5th breakpoint from config>)`** — only if Figma includes an XL frame (pack default: 1440 px)

Use the breakpoints listed in config (`breakpoints`); emit only the breakpoint blocks for which Figma provides frames.

**Rules:**
- Do **not** place a desktop `@media` block **above** base mobile rules for the same component
- Do **not** scatter the same selector across the file; use **one breakpoint ladder** per logical component
- When desktop differs from tablet for a property (e.g. `flex-direction`), the **desktop** media block MUST set that property again — otherwise the browser keeps the tablet value and the bug is invisible until rendered

### Layout Matrix (mandatory section)

Add a `## Layout Matrix (flex / grid)` section immediately **after** the Code Scaffold section, **before** Design Token Mapping. Use a table derived from Step 2b:

> **Pack defaults shown** — the column header pixel values (768, 1024, 1280, 1440) are the pack's default breakpoints. Consumers replace these with the actual values from `breakpoints` in `figma-to-code.config.md`.

| Container (block-scoped class) | Mobile (base) | Tablet (≥768px) | Desktop (≥1024px) | Wide (≥1280px) | XL (≥1440px) |
|---|---|---|---|---|---|
| e.g. `.teaser-inner` | `flex-direction: column; gap: 24px` | `flex-direction: row; gap: 32px` | *unchanged from 768px* | `gap: 48px` | *unchanged* |

Include **every** flex/grid wrapper that changes or could be misread across breakpoints (inner rows, item groups, reversed variants).

### Structure design.md with these sections

```markdown
# Design Reference: [Block Name] — {ticket}

## Source
- **Ticket**: {ticket_url_base}{ticket}
- **Figma**: https://figma.com/design/{fileKey}/{name}?node-id={nodeId}
- **Extracted**: YYYY-MM-DD

## Code Scaffold

### HTML Structure
[Semantic HTML hierarchy after `decorate(block)` runs]
[Block-scoped class names added during decoration, e.g. `.teaser-item`, `.teaser-image`]
[Initial authored structure: nested `<div>` rows/columns from the block table — what comes from EDS auto-decoration before this block's JS reshapes it]

### CSS Skeleton

All new block CSS MUST use the scoping mechanism from `component_model` (default `@scope`) per project convention in `CLAUDE.md`. The Figma root frame maps to the block wrapper `<div class="blockname">`. Authored content renders as nested `<div>` rows/columns inside the wrapper.

> **Pack defaults shown** — the pixel values in this skeleton (768, 1024, 1280) are the pack's default breakpoints. Always substitute the actual values from `breakpoints` in `figma-to-code.config.md`.

```css
@scope (.blockname) {
  /* 1. Base (mobile, first breakpoint from config) — no @media */
  :scope {
    position: relative;
    width: 100%;
    padding: var(--space-md);
  }

  .blockname-content {
    /* descendant mobile styles */
    color: var(--text-color);
  }

  /* 2. Tablet (pack default: 768px — use config value) */
  @media (width >= 768px) {
    .blockname-content {
      /* tablet overrides */
    }
  }

  /* 3. Desktop (pack default: 1024px — use config value) */
  @media (width >= 1024px) {
    .blockname-content {
      /* desktop overrides — set again if different from tablet */
    }
  }

  /* 4. Wide (pack default: 1280px — use config value; only if Figma has a frame at this width) */
  @media (width >= 1280px) {
    /* … */
  }
}
```

**Token rules:**
- Every color, spacing, radius, typography value MUST resolve to a token from the token files listed in config (`token_files`) at the layer described in `token_layer_model` (L2/L3 preferred), or a justified `var(--…, fallback)`
- Never define `--color-*` in block CSS. If a needed token is missing from the token files, flag it in the Report as a *token gap* — do not invent one in block CSS
- No hardcoded hex except `#000`/`#fff`
- No `!important`

### Absolute Overlay Layout (MANDATORY when applicable)

When the design uses `position: absolute; inset: 0` for both a background element and a content overlay, those children do not contribute to the block's height. The block will collapse to zero unless it has explicit dimensions.

**If the Figma design has this pattern** (full-bleed background + overlaid content):
1. Add to `:scope` (`.blockname` root): `min-height`, `aspect-ratio`, or ensure at least one in-flow child provides height
2. Add a `## Layout Caveats` section flagging the requirement
3. Use the design's aspect ratios per breakpoint (e.g. 1:3 mobile, 2:3 tablet, 3:2 desktop)

## Layout Matrix (flex / grid)

[Mandatory table — from Step 2b. Figma auto-layout → `flex-direction` / `gap` / key alignments per container per breakpoint from config (`breakpoints`).]

## Design Token Mapping

| Element | CSS Property | Token | Fallback / Note |
|---|---|---|---|
| e.g. `.teaser-title` | `color` | `--heading-color` (L2) | resolves via theme token cascade |
| `.teaser-cta` | `background-color` | `--button-primary-bg` (L3) | — |
| `.teaser` | `padding-block` | `--space-section-y` (L2) | — |

Always reference L2 (semantic) or L3 (component) tokens per `token_layer_model` — never L1 primitives directly. If a needed token is missing from the token files listed in config (`token_files`), add an "❗ Token gap" row.

## Breakpoints & Per-Breakpoint CSS Overrides

| Breakpoint | Min-width | Behaviour |
|---|---|---|
| Mobile base | (first in config `breakpoints`) | … |
| Tablet | 768px | … |
| Desktop | 1024px | … |
| Wide | 1280px | … (omit if no Figma frame) |
| XL | 1440px | … (omit if no Figma frame) |

Use the breakpoints listed in config (`breakpoints`). For layout-affecting properties (`flex-direction`, `gap`, fixed rail/column widths), restate them in the row even if the Layout Matrix already covers them — the matrix is the canonical layout view, this is the prose narrative.

**Inheritance warning:** If desktop should **not** inherit tablet layout, say so explicitly in this section AND in the `@media (width >= 1024px)` CSS block (set the property again).

## Dynamic Content Elements

Dynamic content elements = elements whose size or count varies with authored content (e.g. badge counts 0–N, repeatable cards, JS-updated values).

| Element | Container | Count/Sizing | Dimension rule applied |
|---|---|---|---|
| e.g. `.teaser-badge` | `.teaser-badges` | 0–3 badges, content-sized | No `width`/`min-width` on badge; no `max-width` on container |

**Rule (MANDATORY)**: No `width`/`height`/`min-*` on the element; no `max-width`/`max-height` on the container — unless Figma **explicitly** has that property. Never convert Figma `width` to `max-width`. If unsure, omit.

## Interactive States

| Element | Default | Hover | Focus | Active | Disabled |
|---|---|---|---|---|---|
| `.teaser-cta` | `color: var(--button-primary-color)` | `color: var(--button-primary-color-hover)` | `outline: 2px solid var(--focus-color)` | … | `opacity: 0.5; pointer-events: none` |

Use ARIA-driven states for styling where applicable (`aria-expanded`, `aria-selected`).

## Theme Behaviour

The themes listed in config (`themes`); if empty, skip theme sections. Themes override tokens at the body-level (L4 per `token_layer_model`). This block should consume L2/L3 tokens only — no theme-specific `.blockname` overrides in block CSS.

If a token override is needed for this block in a specific theme, document it here and propose the override in the appropriate token file (from `token_files`) under the L4 selector. Do not put `.{theme-class} .blockname { … }` in the block CSS file.

## Visual Acceptance Checklist

- [ ] Mobile (first breakpoint from config `breakpoints`): [specific visual check, e.g. "title and CTA stack vertically with 16px gap"]
- [ ] Tablet (768px): [specific check, including at least one Layout Matrix row]
- [ ] Desktop (1024px): [specific check, including at least one Layout Matrix row]
- [ ] Wide (1280px): [if applicable]
- [ ] Theme checks per config (`themes`): [one entry per theme — token-bound visual check for each; omit section if `themes` is empty]
- [ ] Hover/focus states render per Interactive States table
- [ ] No hardcoded hex except `#000`/`#fff` (run `grep -E ':\s*#[0-9a-fA-F]{3,8}' <block source directory>`)
- [ ] All colours resolve to L2/L3 tokens (run `grep 'var(--color-' <block source directory>`)

## Embedded Blocks

[Child blocks or referenced fragments and their required styles. List by name.]

## EDS Block Integration

- Block wrapper: outer `<div class="blockname">` is added by EDS auto-decoration
- This block's `decorate(block)` reshapes the authored structure (rows/columns from the block table) into the final semantic HTML
- Block options (variants, e.g. `(reversed, dark)`) are added as classes on the wrapper — handle in `decorate()` per `building-blocks` skill
- ARIA attributes/roles go on decorated elements
- Decoration must be idempotent (re-running `decorate` on the same block must not break it)

## Token Gaps (if any)

List any colour/spacing/typography value present in Figma but not represented by a token in the token files listed in config (`token_files`). Each entry should propose the token name, layer (L2 or L3 per `token_layer_model`), value, and where it should be added. Implementer will resolve these before block CSS.

## Variant CSS

When the Figma design includes variants (e.g. `dark`, `reversed`, `wide`), include the **actual CSS values** here — not just the class name. If Figma has no frame for a stated variant, add a "Variant CSS (when used)" subsection with suggested values and note that implementer must verify with Figma.
```

## Step 4: Write design.md

Write to the path resolved from config (`spec_output_path`). Verify the file contains all mandatory sections:

- Source block (ticket + Figma URLs + date)
- Code Scaffold (HTML + CSS Skeleton in mobile-first order with the scoping mechanism from `component_model`)
- Layout Matrix
- Design Token Mapping
- Breakpoints & Per-Breakpoint CSS Overrides
- Dynamic Content Elements (with rule applied)
- Interactive States
- Theme Behaviour
- Visual Acceptance Checklist
- Embedded Blocks (or "None")
- EDS Block Integration
- Token Gaps (or "None")
- Variant CSS (if applicable)

## Step 5: Token Gap Validation

After writing, cross-reference every token used in the CSS Skeleton against the token files listed in config (`token_files`):

```bash
# spec_output_path comes from figma-to-code.config.md (pack default: drafts/specs/{ticket}/design.md)
SPEC="<resolved spec_output_path for {ticket}>"

# Tokens used in design.md but missing from token files
# token_files comes from figma-to-code.config.md (pack default: styles/styles.css — iterate over all listed files)
grep -oE 'var\(--[a-z0-9-]+' "$SPEC" | sort -u > /tmp/tokens-used.txt
grep -oE '--[a-z0-9-]+:' <primary token file from config token_files> | sort -u | sed 's/:$//' > /tmp/tokens-defined.txt
comm -23 /tmp/tokens-used.txt <(sed 's/^/var(/' /tmp/tokens-defined.txt | sort -u)
```

Any output = token gap. Add each to the "Token Gaps" section in design.md.

## Step 6: Report

Output a concise report:
- design.md path
- Sections present (confirm all mandatory ones)
- Layout Matrix row count
- Token gaps detected
- Ticket vs Figma conflicts flagged (if any)
- Next phase: implementation

## Key Rules

- **Ticket is source of truth for functional requirements**; design.md is source of truth for HTML/CSS
- Do NOT modify the ticket from this skill
- If Figma implies content/functional changes not in the ticket (new variants, different content model), flag them in the Report — do not silently diverge
- CSS must be vanilla, block-scoped via the scoping mechanism from `component_model` (default `@scope`), using the breakpoints listed in config (`breakpoints`) mobile-first
- Map Figma values to tokens from the token files listed in config (`token_files`) at L2/L3 per `token_layer_model`; never L1 directly in block CSS
- **Dynamic content**: store only what Figma explicitly has; never convert `width` → `max-width`; omit when unsure
- **Variant CSS**: when design.md mentions a variant class, include actual property values, not just the class name
- **Mobile-first file order**: CSS Skeleton MUST follow base → 768 → 1024 → 1280 → 1440 (per `breakpoints` config); never interleave desktop before mobile for the same component
- **Layout Matrix**: MUST exist; implementers use it to avoid missing desktop overrides (e.g. tablet inherits into desktop by default)
- **Ticket vs Figma**: flag conflicts in the Report; do not overwrite either source

## Integration

Runs standalone after the ticket (if any) is fetched. Produces only the `design.md` artifact; implementation and validation are separate steps.

## What this skill does NOT do

- Does not modify tickets
- Does not write block JS or CSS — only the `design.md` reference artifact
- Does not extract or update global tokens (that is `figma-design-extractor` / `design-system-analyzer`)
- Does not run lint, dev server, or browser checks
- Does not create a feature branch or commit files
