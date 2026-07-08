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
├── docs/
│   ├── DESIGN.md                                # this document
│   └── workflow.md                              # specify → screenshot → build → validate loop + prerequisites
├── config/
│   ├── figma-to-code.config.template.md         # every field, blank, with inline guidance
│   └── examples/
│       └── eds-example.config.md                # one generic EDS-style filled example (no originating-project identifiers)
└── skills/
    ├── figma-specify/SKILL.md
    ├── figma-screenshot/SKILL.md
    └── figma-validate/SKILL.md
```

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
