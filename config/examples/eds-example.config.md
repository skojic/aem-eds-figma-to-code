# figma-to-code project config — Adobe EDS example

An illustrative filled config for a generic Adobe Edge Delivery Services
project. Copy to your project root as `figma-to-code.config.md` and edit.

## Config

```yaml
mcp:
  ticket_tracker: "jira"
  figma: "figma"
  browser: "chrome-devtools"
  content_store: "da-live"

ticket_key_pattern: "PROJ-\\d+"
ticket_url_base: "https://jira.example.com/browse/"

spec_output_path: "drafts/specs/{ticket}/design.md"
content_path_template: "example-org/example-site/drafts/qa/{slug}.html"
preview_url_template: "http://localhost:3000/drafts/qa/{slug}"

token_files:
  - "styles/styles.css"
  - "styles/tokens.css"
themes: ["light", "dark"]
breakpoints:
  - { name: "mobile",  min: 320 }
  - { name: "tablet",  min: 768 }
  - { name: "desktop", min: 1024 }
  - { name: "wide",    min: 1280 }

lint_cmd: "npm run lint"
test_cmd: "npm test"

runtime_checks:
  axe: true
  keyboard: true
  performance: true
axe_core_version: "4.14.0"

run_log_path: ".figma-validate/runs.jsonl"
```

## token_layer_model

Adobe EDS 5-layer architecture in `styles/styles.css`:
L1 primitives → L2 semantic → L3 component → L4 theme overrides → L5 section
backgrounds. Block CSS references **L2/L3 only**, never L1 directly. Never
define `--color-*` inside block CSS; if a needed token is missing, flag a
token gap rather than inventing one.

## component_model

- **Scoping:** `@scope (.blockname) { … }` for every block's CSS.
- **Entry point:** `export default function decorate(block) {}`; reshape the
  authored DOM in place, idempotently. Explicit `.js` import extensions.
- **Authoring shape:** EDS block-table — each authored row is a nested
  `<div>`, each column a nested `<div>` inside it; the block wrapper
  `<div class="blockname">` is added by EDS auto-decoration.
- **Hardcoded-value rules:** tokens via `var(--…)` only; no hex except
  `#000`/`#fff`; no `!important`; mobile-first breakpoints.
