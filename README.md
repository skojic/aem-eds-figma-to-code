# aem-eds-figma-to-code

A portable, EDS/AEM-first Claude Code skill pack for turning Figma designs into implementation-ready CSS/HTML — and validating the result in a real browser.

---

## What's inside

Three Claude Code skills that implement a Figma → spec → build → validate loop:

| Skill | Invocation | Purpose |
|---|---|---|
| `figma-specify` | `/figma-specify <ticket-or-slug>` | Extract visual/stylistic design context from Figma → write a `design.md` spec (source of truth for HTML/CSS). |
| `figma-screenshot` | `/figma-screenshot <ticket-or-slug> <figma-url>` | Fetch a Figma node PNG via the figma MCP → save it beside the spec as audit-trail evidence. |
| `figma-validate` | `/figma-validate <ticket-or-slug>` | Drive a browser MCP to render authored content at each breakpoint, compare against the spec + Figma screenshots, spot-check computed styles, run lint/tests, emit PASS/FAIL. |

The skills produce the **spec** and the **check**. Writing the actual block code from `design.md` is your step — see [docs/workflow.md](docs/workflow.md).

---

## The methodology

These five practices are encoded in the skills and transfer to any CSS project:

- **Layout Matrix** — for every flex/grid container, record `flex-direction`, `gap`, and alignment at each breakpoint in a table. Prevents the silent "tablet inherits into desktop" bug that is invisible until rendered.
- **Mobile-first CSS file order** — base rules first, then ascending `@media (width >= …)` blocks in a single ladder per component. Never scatter the same selector above and below a media query boundary.
- **Dynamic-content dimension rule** — never invent `width` or `max-width` on content-sized elements. Store only what Figma explicitly provides for that node; omit when unsure.
- **Token-gap validation** — after extracting the spec, cross-reference every `var(--…)` token used against the design-system token files. Flag gaps rather than inventing values in block CSS.
- **PASS/FAIL browser validation** — computed-style spot-checks against the Layout Matrix, model-driven visual diff against Figma screenshots, plus lint and test gates. A binary verdict keeps the review conversation short.

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
       └── figma-validate/SKILL.md
   ```

2. Copy the config template to your project root and fill it in. Run these from the root of a clone of this repo:

   ```bash
   cp config/figma-to-code.config.template.md <your-project>/figma-to-code.config.md
   ```

   See [`config/examples/eds-example.config.md`](config/examples/eds-example.config.md) for a worked generic EDS example. The fallback location is `.claude/figma-to-code.config.md` if you prefer to keep it inside `.claude/`.

3. The skills read `figma-to-code.config.md` on every invocation. If it is missing they fail-stop and point you at the template.

---

## The loop

```
/figma-specify <ticket-or-slug>
    → writes design.md (Layout Matrix, CSS Skeleton, Token Mapping)

/figma-screenshot <ticket-or-slug> <figma-url>
    → saves figma-*.png beside design.md (once per major frame)

[ implement the block from design.md — your step ]

/figma-validate <ticket-or-slug>
    → renders at every breakpoint, diffs vs spec + screenshots, PASS/FAIL
```

Full prerequisites, exact invocations, and fail-stop behaviour are documented in [docs/workflow.md](docs/workflow.md).

---

## Requirements

| Requirement | Role | Notes |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | skill runner | Required. |
| Figma MCP | `mcp.figma` in config | Required. Used by `figma-specify` and `figma-screenshot`. |
| Browser MCP | `mcp.browser` in config | Required for `figma-validate` (e.g. `chrome-devtools` MCP). |
| Ticket-tracker MCP | `mcp.ticket_tracker` in config | Optional. If absent, pass a Figma URL directly to `/figma-specify`. |
| Headless-CMS / content-store MCP | `mcp.content_store` in config | Optional. If absent, author and serve your own test content before running `/figma-validate`. |

---

## License

MIT — see [LICENSE](LICENSE).
