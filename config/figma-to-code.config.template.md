# figma-to-code project config

Place this file at your project root as `figma-to-code.config.md`
(fallback: `.claude/figma-to-code.config.md`). The three skills read it to
learn your project's specifics. Fill every field; leave a value empty only
where the field's guidance says it is optional.

## Config

```yaml
# --- MCP roles (map each role to the MCP server name in YOUR project) ---
mcp:
  ticket_tracker: ""   # e.g. "jira" — OPTIONAL. Empty = run from a Figma URL only.
  figma: "figma"       # REQUIRED. The Figma MCP server name.
  browser: ""          # e.g. "chrome-devtools" — REQUIRED for figma-validate.
  content_store: ""    # e.g. "da-live" — OPTIONAL headless CMS MCP. Empty = author/serve content yourself.

# --- Ticket integration (only if mcp.ticket_tracker is set) ---
ticket_key_pattern: ""   # e.g. "PROJ-\\d+" — regex your ticket IDs match.
ticket_url_base: ""      # e.g. "https://jira.example.com/browse/" — {key} is appended.

# --- Paths & URLs ---
spec_output_path: "drafts/specs/{ticket}/design.md"   # {ticket} and/or {slug} placeholders.
content_path_template: ""       # e.g. "org/repo/drafts/qa/{slug}.html" — only if content_store set.
preview_url_template: "http://localhost:3000/{slug}"  # local URL figma-validate renders.

# --- Design system ---
token_files:                    # files the token-gap check greps for defined tokens.
  - "styles/styles.css"
themes: []                      # e.g. ["light", "dark"] — empty = no per-theme checks.
breakpoints:                    # name + min-width; drives spec ladders AND validate viewports.
  - { name: "mobile",  min: 320 }
  - { name: "tablet",  min: 768 }
  - { name: "desktop", min: 1024 }

# --- Commands ---
lint_cmd: "npm run lint"        # empty = skip lint gate.
test_cmd: "npm test"            # empty = skip test gate.

# --- Runtime checks (figma-validate Steps 5b/5c) ---
runtime_checks:                 # false = record the check as "skipped" (not measured, never passed).
  axe: true                     # axe-core scoped to the block — any violation fails.
  keyboard: true                # Tab order, visible focus, no trap — any failure fails.
  performance: true             # lab trace — block-caused CLS > 0.1 fails; LCP informational.
axe_core_version: "4.14.0"      # pins the CDN fallback; match your axe-core devDependency if you have one.

# --- Run log (figma-validate Step 8) ---
run_log_path: ".figma-validate/runs.jsonl"   # append-only; rows carry ticket IDs — add to .gitignore.
```

## token_layer_model

Describe, in prose, how your design tokens are layered and which layers block
CSS may reference. Example (Adobe EDS 5-layer): L1 primitives → L2 semantic →
L3 component → L4 theme overrides → L5 section backgrounds. State the rule the
skills must enforce, e.g. "block CSS references L2/L3 only, never L1 directly;
never define `--color-*` in block CSS."

## component_model

Describe how a component is structured in your project so the skills produce
matching HTML/CSS. Cover:

- **Scoping mechanism** — e.g. `@scope (.blockname)`, BEM, CSS Modules.
- **Decoration / entry point** — e.g. EDS `export default function decorate(block)`.
- **Authoring shape** — how authored content arrives (e.g. EDS block-table:
  each row a nested `<div>`, each column a nested `<div>` inside it).
- **Hardcoded-value rules** — e.g. "no hex except `#000`/`#fff`, no `!important`."

Default assumption if you leave this generic: **Adobe Edge Delivery Services
(Helix) blocks** — the model these skills were built for.
