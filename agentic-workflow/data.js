/* =============================================================
   Data model for the Figma → Code agentic workflow presentation.
   Everything the UI renders is declared here.
   ============================================================= */

/* --- Toggleable layers -------------------------------------- */
/* Shared layers have three states: 'off' | 'base' | 'extended'.
   The BASE row shows the headline nodes only; the EXTENDED row
   adds the fine-grained ones (individual MCP calls, subagents,
   per-gate fail-stops).                                        */
const LAYERS = [
  { id: 'config',    label: 'Config',    kind: 'context',  hint: 'figma-to-code.config.md + token files loaded into context' },
  { id: 'gates',     label: 'Gates',     kind: 'gate',     hint: 'Pre-flight fail-stop checks — missing data blocks the run' },
  { id: 'hooks',     label: 'Hooks',     kind: 'gate',     hint: 'Claude Code hooks that enforce the gate — pre-flight, schema checks, report guard, stop gate' },
  { id: 'mcp',       label: 'MCP',       kind: 'tool',     hint: 'figma / browser / ticket-tracker / content-store MCP calls' },
  { id: 'subagents', label: 'Subagents', kind: 'subagent', hint: 'Delegated visual-diff and token-resolution passes' },
  { id: 'model',     label: 'Model',     kind: 'model',    hint: 'Model decision points: layout extraction, diff, verdict' },
];

const BASE_LAYERS = ['config', 'gates', 'hooks', 'mcp'];
const EXTENDED_LAYERS = ['config', 'gates', 'hooks', 'mcp', 'subagents', 'model'];
const DEFAULT_LAYERS = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'model',  label: 'Model'  },
];

/* Only the three hues that carry meaning are listed. Everything else is
   neutral and labelled in text on the node itself. */
const KIND_LEGEND = [
  { kind: 'gate',  label: 'Fail-stop gate / hook' },
  { kind: 'tool',  label: 'MCP tool call' },
  { kind: 'model', label: 'Model / decision' },
  { kind: 'step',  label: 'Steps, artifacts, subagents, your step' },
];

/* --- Install stages (0 … 7) --------------------------------- */
const STAGES = [
  { n: 0, label: 'plain', caption: 'Plain EDS project — no skill pack yet. Claude has your source, nothing else.' },
  { n: 1, label: 'specify', caption: 'Skill 1 copied in: /figma-specify can now read Figma and write a spec.' },
  { n: 2, label: 'screenshot', caption: 'Skill 2 copied in: /figma-screenshot saves audit-trail PNGs next to the spec.' },
  { n: 3, label: 'validate', caption: 'Skill 3 copied in: /figma-validate drives a browser and emits PASS/FAIL. Its four hook scripts come with it.' },
  { n: 4, label: 'config', caption: 'Config filled in and the hooks wired into .claude/settings.json. Every skill fail-stops without the config — it is the only project-specific skill file.' },
  { n: 5, label: 'spec', caption: '/figma-specify has run: design.md is the source of truth for HTML/CSS.' },
  { n: 6, label: 'build', caption: '/figma-screenshot has run and you implemented the block from design.md.' },
  { n: 7, label: 'report', caption: '/figma-validate has run: screenshots, snapshots and a PASS/FAIL report.' },
];

/* --- Diagram phases (lanes) --------------------------------- */
const PHASES = [
  { n: 1, key: 'specify',  title: 'Specify',          sub: '/figma-specify — Figma becomes a spec' },
  { n: 2, key: 'build',    title: 'Capture & build',  sub: '/figma-screenshot + your implementation' },
  { n: 3, key: 'validate', title: 'Validate',         sub: '/figma-validate — browser truth, PASS/FAIL' },
];

/* --- Files ---------------------------------------------------
   stage   = the stage at which the file first appears
   status  = badge shown next to the file name
   node    = diagram node id highlighted when the file is selected
   ------------------------------------------------------------- */
const FILES = [
  {
    path: 'package.json', stage: 0, status: 'committed',
    title: 'Project manifest',
    desc: 'Supplies lint_cmd and test_cmd for the validation gate. Both are optional — figma-validate skips a gate whose command is empty in config, and records it as skipped rather than passed.',
    code: '"scripts": {\n  "lint": "eslint . && stylelint styles/**/*.css"\n}\n\n// test_cmd is optional. Empty = the gate\n// reports "skipped", never "pass".',
  },
  {
    path: 'styles/styles.css', stage: 0, status: 'committed',
    title: 'Design-system tokens',
    desc: 'Listed in config as token_files. figma-specify greps it to prove every var(--…) used in the spec actually exists — anything missing becomes a Token Gap instead of an invented value.',
    code: ':root {\n  /* L1 primitives */\n  --grey-900: #101114;\n  /* L2 semantic */\n  --heading-color: var(--grey-900);\n  --space-md: 1.5rem;\n}',
    node: 'payload',
  },
  {
    path: 'src/blocks/teaser/teaser.js', stage: 6, status: 'you wrote it',
    title: 'Block decoration',
    desc: 'Written by you from the HTML Structure section of design.md. The skills never write block code — this is the human step in the loop.',
    code: "export default function decorate(block) {\n  block.querySelectorAll(':scope > div').forEach((row, i) => {\n    row.classList.add(i === 0 ? 'teaser-media' : 'teaser-body');\n  });\n}",
    node: 'human-impl',
  },
  {
    path: 'src/blocks/teaser/teaser.css', stage: 6, status: 'you wrote it',
    title: 'Block CSS — mobile-first ladder',
    desc: 'Follows the CSS Skeleton: base rules first, then one ascending @media ladder. When desktop differs from tablet the property is restated — never left to cascade inheritance.',
    code: '@scope (.teaser) {\n  :scope { display: flex; flex-direction: column; gap: 24px; }\n\n  @media (width >= 768px) {\n    :scope { flex-direction: row; gap: 32px; }\n  }\n  @media (width >= 1024px) {\n    :scope { gap: 48px; } /* restated, not inherited */\n  }\n}',
    node: 'human-impl',
  },

  {
    path: '.claude/skills/figma-specify/SKILL.md', stage: 1, status: 'pack',
    title: 'Skill — /figma-specify',
    desc: 'Extracts visual/stylistic context from Figma and writes design.md: Layout Matrix, CSS Skeleton, Token Mapping, Dynamic Content rules. Explicit invocation only (disable-model-invocation: true).',
    code: '---\nname: figma-specify\ndisable-model-invocation: true\n---\n\n## Step 2b: Figma Layout Extraction (mandatory)\nRecord flex-direction, gap and alignment\nper container per breakpoint.',
    node: 'prompt',
  },
  {
    path: '.claude/skills/figma-screenshot/SKILL.md', stage: 2, status: 'pack',
    title: 'Skill — /figma-screenshot',
    desc: 'Read-only. Parses fileKey and nodeId from the URL you supply (node-id=1-177 → 1:177), fetches the PNG through the figma MCP and writes it beside design.md.',
    code: '---\nname: figma-screenshot\ndisable-model-invocation: true\n---\n\nNo default file key —\nparse it from the URL the user provides.',
    node: 'step-shot',
  },
  {
    path: '.claude/skills/figma-validate/SKILL.md', stage: 3, status: 'pack',
    title: 'Skill — /figma-validate',
    desc: 'Renders authored content at every configured breakpoint through the browser MCP, spot-checks computed styles against the Layout Matrix, resolves tokens, runs lint + tests, emits PASS/FAIL.',
    code: '---\nname: figma-validate\ndisable-model-invocation: true\n---\n\nPASS requires: no blocker deltas,\nevery Layout Matrix row matching,\nlint_cmd 0, test_cmd 0.',
    node: 'step-validate',
  },
  {
    path: '.claude/skills/figma-validate/hooks/preflight.mjs', stage: 3, status: 'pack',
    title: 'Hook — preflight',
    desc: 'Runs on UserPromptExpansion for /figma-validate. Blocks the run before it starts if the config, design.md, a parseable and well-shaped design.matrix.json or a figma-*.png is missing, and names the skill that produces each one. Exit 2 blocks the expansion.',
    code: '/figma-validate PROJ-123 cannot start:\n  - …/design.matrix.json does not exist —\n    re-run /figma-specify PROJ-123\n  - no figma-*.png in …/PROJ-123 —\n    run /figma-screenshot PROJ-123 <url>',
    node: 'hook-preflight',
  },
  {
    path: '.claude/skills/figma-validate/hooks/artifact-check.mjs', stage: 3, status: 'pack',
    title: 'Hook — artifact check',
    desc: 'Runs on PostToolUse after every Write or Edit. Validates design.matrix.json and validation/evidence.json the moment they are written and hands the exact problems back to the model, so a malformed file is fixed now rather than at the end of a browser loop. Also flags a container the sidecar checks that design.md never mentions.',
    code: '- evidence.json: viewports[0].rows[0].results[0].match\n  must be a boolean\n- design.matrix.json: rows[1] is inherited but has\n  declarations\nFix the file and write it again.',
    node: 'hook-evidence-check',
  },
  {
    path: '.claude/skills/figma-validate/hooks/report-guard.mjs', stage: 3, status: 'pack',
    title: 'Hook — report guard',
    desc: 'Runs on PreToolUse before a Write or Edit. Denies a validation/report.md whose Verdict line differs from what the gate computes from evidence.json, and denies any report at all when the evidence cannot be evaluated — the exit-2 case, where no verdict is the correct output.',
    code: '{ "permissionDecision": "deny",\n  "permissionDecisionReason":\n    "The report says PASS but running the gate\n     over evidence.json gives FAIL." }',
    node: 'hook-report-guard',
  },
  {
    path: '.claude/skills/figma-validate/hooks/verdict-stop.mjs', stage: 3, status: 'pack',
    title: 'Hook — stop gate',
    desc: 'Runs on Stop. A session that wrote evidence.json cannot finish until report.md exists, is newer than the evidence, and states the verdict recomputed from it. Nothing the model recorded is trusted. A stop_hook_active guard lets a second stop through with a warning instead of trapping the session.',
    code: '{ "decision": "block",\n  "reason": "The validation run is not finished:\n    - report.md is older than evidence.json —\n      re-run the gate." }',
    node: 'hook-stop',
  },
  {
    path: 'figma-to-code.config.md', stage: 4, status: 'config',
    title: 'The only project-specific file',
    desc: 'Binds MCP roles, breakpoints, themes, token files, output paths and lint/test commands. Missing → every skill fail-stops and points at the template. The SKILL.md files stay unedited.',
    code: 'mcp:\n  figma: "figma"\n  browser: "chrome-devtools"\n  content_store: "da-live"\nspec_output_path: "drafts/specs/{ticket}/design.md"\nbreakpoints:\n  - { name: "mobile",  min: 320 }\n  - { name: "tablet",  min: 768 }\n  - { name: "desktop", min: 1024 }',
    node: 'payload',
  },

  {
    path: '.claude/settings.json', stage: 4, status: 'config',
    title: 'Hook wiring',
    desc: 'The pack ships hooks/settings.snippet.json; merging it here registers the four hooks at project level. They are project settings, not SKILL.md frontmatter, because frontmatter hooks register only after the skill has run — too late to pre-flight its own invocation — and a frontmatter Stop hook is converted to SubagentStop.',
    code: '"hooks": {\n  "UserPromptExpansion": [{ "matcher": "figma-validate", … }],\n  "PreToolUse":  [{ "matcher": "Write|Edit", … }],\n  "PostToolUse": [{ "matcher": "Write|Edit", … }],\n  "Stop":        [{ … }]\n}',
    node: 'hook-preflight',
  },

  {
    path: 'drafts/specs/PROJ-123/design.md', stage: 5, status: 'generated',
    title: 'The spec — source of truth for HTML/CSS',
    desc: 'Layout Matrix, CSS Skeleton, Design Token Mapping, Dynamic Content Elements, Interactive States, Token Gaps, Visual Acceptance Checklist. Functional requirements stay in the ticket.',
    code: '## Layout Matrix (flex / grid)\n\n| Container      | Mobile   | ≥768px | ≥1024px |\n|----------------|----------|--------|---------|\n| .teaser-inner  | column   | row    | unchanged |\n| .teaser-cta    | column   | row    | row     |',
    node: 'out-spec',
  },
  {
    path: 'drafts/specs/PROJ-123/design.matrix.json', stage: 5, status: 'generated',
    title: 'The Layout Matrix, machine-readable',
    desc: 'The same table as design.md, structured for the gate. One row per container per breakpoint, holding only the properties that breakpoint actually sets. figma-validate reads this file and never the markdown table: that table is generated by figma-specify, so reading it back would mean depending on the shape of our own output. Reorder a column and a row stops being checked — with the report still saying PASS.',
    code: '{\n  "rows": [{\n    "container": ".teaser-inner",\n    "breakpoint": "1024",\n    "declarations": "flex-direction: row; gap: 32px",\n    "inherited": false\n  }, {\n    "container": ".teaser-inner",\n    "breakpoint": "1280",\n    "declarations": "",\n    "inherited": true\n  }]\n}',
    node: 'out-spec',
  },
  {
    path: 'drafts/specs/PROJ-123/figma-teaser-desktop.png', stage: 6, status: 'evidence',
    title: 'Figma reference frame',
    desc: 'Audit-trail evidence so reviewers can read design.md without Figma access — and the reference image figma-validate diffs the browser screenshot against.',
    code: 'figma-{slug}-{viewport}.png\nnode 1:177 · 1440×900',
    node: 'out-shot',
  },
  {
    path: 'drafts/specs/PROJ-123/validation/browser-desktop.png', stage: 7, status: 'evidence',
    title: 'Rendered at the desktop breakpoint',
    desc: 'One screenshot per configured breakpoint, captured through the browser MCP after emulating the viewport and waiting for the block root selector.',
    code: 'emulate  → width 1024, height 800\nwait_for → .teaser\ntake_screenshot',
    node: 'tool-browser',
  },
  {
    path: 'drafts/specs/PROJ-123/validation/snapshot-desktop.json', stage: 7, status: 'evidence',
    title: 'DOM + a11y tree snapshot',
    desc: 'Captured alongside the screenshot so computed-style spot-checks and accessibility structure can be re-read without another browser run.',
    code: '{ "role": "region", "name": "Teaser",\n  "computed": { "flexDirection": "row", "gap": "32px" } }',
    node: 'tool-browser',
  },
  {
    path: 'drafts/specs/PROJ-123/validation/evidence.json', stage: 7, status: 'gathered',
    title: 'Everything gathered, before anything is decided',
    desc: 'The whole input to the verdict, written before the verdict exists: per-viewport computed-style comparisons, token resolutions, console and network counts, visual-delta severities, and the lint/test gate statuses. The split is the point — the skill gathers, the code decides. It also makes a run reproducible: re-running the verdict over the same evidence cannot produce a different answer.',
    code: '{\n  "viewports": [{\n    "name": "desktop",\n    "rows": [{ "container": ".teaser-inner",\n      "inherited": false,\n      "results": [{ "prop": "gap",\n        "match": false, "severity": "minor" }] }],\n    "consoleErrors": 0,\n    "networkFailures": 0\n  }],\n  "gates": { "lint": "pass", "test": "skipped" }\n}',
    node: 'out-evidence',
  },
  {
    path: 'drafts/specs/PROJ-123/validation/report.md', stage: 7, status: 'verdict',
    title: 'PASS / FAIL report',
    desc: 'Verdict plus Layout Matrix verification, token resolution, console/network summary, lint and test results, and a remediation checklist. FAIL sends you back to the implementation step.',
    code: '**Verdict**: FAIL\n\n| Container     | BP   | Expected | Computed | ✓ |\n|---------------|------|----------|----------|---|\n| .teaser-inner | 1024 | gap:48px | gap:32px | ✗ |\n\n- [ ] Restate gap in the ≥1024px block',
    node: 'verdict',
  },
];

/* --- Diagram -------------------------------------------------
   layer : which toggle controls the node (undefined = always on)
   mode  : 'base'     → visible in BASE and EXTENDED
           'extended' → visible in EXTENDED only
   ------------------------------------------------------------- */
const DIAGRAM = [
  { id: 'prompt', phase: 1, kind: 'step', layer: 'prompt', num: 1,
    title: '/figma-specify PROJ-123', sub: 'Explicit invocation — the model cannot trigger these skills on its own' },

  { id: 'payload', phase: 1, kind: 'payload', title: 'Claude model — request payload',
    sub: 'Cache hierarchy: skills → config → messages' },

  { id: 'gate-specify', phase: 1, kind: 'gate', layer: 'gates', mode: 'base',
    title: 'Pre-flight — fail-stop', sub: 'Missing data is a blocker, not a creative prompt',
    chips: [
      { text: 'figma-to-code.config.md present', mode: 'base' },
      { text: 'mcp.figma connected + authed', mode: 'base' },
      { text: 'ticket fetched (if ticket_tracker set)', mode: 'extended' },
      { text: 'Figma reference resolvable', mode: 'extended' },
      { text: 'block name known', mode: 'extended' },
    ] },

  { id: 'tool-figma', phase: 1, kind: 'tool', layer: 'mcp', mode: 'base',
    title: 'mcp.figma', sub: 'get_figma_data(fileKey, nodeId) — or get_design_context on the desktop app',
    chips: [
      { text: 'node-id=1-177 → 1:177', mode: 'extended' },
      { text: 'auth error → mcp_auth, retry once', mode: 'extended' },
    ] },

  { id: 'model-layout', phase: 1, kind: 'model', layer: 'model', mode: 'base',
    title: 'Layout extraction', sub: 'Auto-layout facts per container per breakpoint → the Layout Matrix',
    chips: [
      { text: 'primary axis → flex-direction', mode: 'extended' },
      { text: 'gap + alignment', mode: 'extended' },
      { text: 'unchanged breakpoints stated explicitly', mode: 'extended' },
      { text: 'ticket vs Figma conflict → flag, never silently prefer prose', mode: 'extended' },
    ] },

  { id: 'out-spec', phase: 1, kind: 'output', num: 2,
    title: 'design.md + design.matrix.json written', sub: 'Layout Matrix · CSS Skeleton · Token Mapping · Interactive States — and the matrix as JSON for the gate' },

  { id: 'hook-matrix-check', phase: 1, kind: 'gate', tag: 'hook', layer: 'hooks', mode: 'extended',
    title: 'Hook · artifact-check', sub: 'PostToolUse — design.matrix.json is validated the moment it is written, and a container design.md never mentions is flagged as drift',
    chips: [
      { text: 'empty matrix → rejected, it verifies nothing', mode: 'extended' },
      { text: 'inherited row carrying values → rejected', mode: 'extended' },
    ] },

  { id: 'sub-tokens', phase: 1, kind: 'subagent', layer: 'subagents', mode: 'base',
    title: 'Token-gap pass', sub: 'Every var(--…) in the spec cross-referenced against token_files; gaps flagged, never invented',
    chips: [{ text: 'comm -23 tokens-used tokens-defined', mode: 'extended' }] },

  { id: 'step-shot', phase: 2, kind: 'step', num: 3,
    title: '/figma-screenshot PROJ-123 <figma-url>', sub: 'Once per major frame referenced by the spec' },

  { id: 'tool-figma-img', phase: 2, kind: 'tool', layer: 'mcp', mode: 'extended',
    title: 'mcp.figma — image', sub: 'base64 PNG → figma-{slug}-{viewport}.png beside design.md' },

  { id: 'out-shot', phase: 2, kind: 'output',
    title: 'figma-*.png saved', sub: 'Audit-trail evidence + the reference for the visual diff' },

  { id: 'human-impl', phase: 2, kind: 'human', num: 4,
    title: 'Implement the block — your step',
    sub: 'HTML from the structure section · mobile-first ladder · no invented width/max-width on dynamic content' },

  { id: 'step-validate', phase: 3, kind: 'step', num: 5,
    title: '/figma-validate PROJ-123', sub: 'Runtime validation only — read-only on code, Figma and the ticket' },

  { id: 'hook-preflight', phase: 3, kind: 'gate', tag: 'hook', layer: 'hooks', mode: 'base',
    title: 'Hook · preflight', sub: 'UserPromptExpansion — blocks /figma-validate before it starts and names the skill that produces what is missing',
    chips: [
      { text: 'config + design.md present', mode: 'base' },
      { text: 'design.matrix.json parses, valid shape', mode: 'base' },
      { text: 'figma-*.png present', mode: 'base' },
      { text: 'exit 2 → the run never starts', mode: 'extended' },
    ] },

  { id: 'gate-validate', phase: 3, kind: 'gate', layer: 'gates', mode: 'base',
    title: 'Pre-flight — fail-stop', sub: 'Any missing prerequisite stops the run and names what to fix',
    chips: [
      { text: 'design.md exists', mode: 'base' },
      { text: 'figma-*.png exists', mode: 'base' },
      { text: 'mcp.browser connected — no substitution', mode: 'base' },
      { text: 'authored test content reachable', mode: 'extended' },
      { text: 'dev server responds within 30s', mode: 'extended' },
    ] },

  { id: 'tool-content', phase: 3, kind: 'tool', layer: 'mcp', mode: 'extended',
    title: 'mcp.content_store', sub: 'Auto-creates the authored test page when missing — never overwrites an existing one' },

  { id: 'tool-browser', phase: 3, kind: 'tool', layer: 'mcp', mode: 'base',
    title: 'mcp.browser — per breakpoint loop', sub: 'Repeats for every viewport in breakpoints that design.md covers',
    chips: [
      { text: 'emulate viewport', mode: 'base' },
      { text: 'take_screenshot', mode: 'base' },
      { text: 'take_snapshot (DOM + a11y)', mode: 'extended' },
      { text: 'evaluate_script → computed styles', mode: 'extended' },
      { text: 'list_console_messages', mode: 'extended' },
      { text: 'list_network_requests (failures)', mode: 'extended' },
    ] },

  { id: 'sub-diff', phase: 3, kind: 'subagent', layer: 'subagents', mode: 'base',
    title: 'Visual diff — the only judgement left', sub: 'Model-driven comparison against the Figma reference, graded blocker / major / minor' },

  { id: 'sub-compare', phase: 3, kind: 'subagent', layer: 'subagents', mode: 'extended',
    title: 'Computed-style comparison', sub: 'lib/compare.mjs normalises first — 2rem vs 32px, gap:normal vs 0px, "row nowrap" vs "row"',
    chips: [
      { text: 'unparseable spec value → fail-stop', mode: 'extended' },
      { text: 'unverifiable reading → blocker, never a pass', mode: 'extended' },
    ] },

  { id: 'out-evidence', phase: 3, kind: 'output',
    title: 'evidence.json written', sub: 'Every check, count and gate status — recorded before the verdict is decided' },

  { id: 'hook-evidence-check', phase: 3, kind: 'gate', tag: 'hook', layer: 'hooks', mode: 'extended',
    title: 'Hook · artifact-check', sub: 'PostToolUse — evidence.json is shape-checked on write; the problems go straight back to the model',
    chips: [
      { text: 'match must be a boolean', mode: 'extended' },
      { text: 'a mismatch needs a severity', mode: 'extended' },
      { text: 'empty viewports → rejected', mode: 'extended' },
    ] },

  { id: 'verdict-core', phase: 3, kind: 'gate', layer: 'gates', mode: 'base',
    title: 'node lib/cli.mjs evidence.json', sub: 'Tested code decides the verdict, not the model — exit 0 PASS, 1 FAIL, 2 could not evaluate',
    chips: [
      { text: 'blocker at any viewport → FAIL', mode: 'base' },
      { text: 'inherited row → no override to check', mode: 'extended' },
      { text: 'minor drift fails only at 2+ viewports', mode: 'extended' },
      { text: 'no viewports captured → exit 2, not PASS', mode: 'extended' },
    ] },

  { id: 'hook-report-guard', phase: 3, kind: 'gate', tag: 'hook', layer: 'hooks', mode: 'base',
    title: 'Hook · report guard', sub: 'PreToolUse — report.md is refused if its verdict differs from the one the gate computes, or if the evidence could not be evaluated',
    chips: [
      { text: 'PASS over failing evidence → denied', mode: 'base' },
      { text: 'unevaluable evidence (exit 2) → no report accepted', mode: 'extended' },
    ] },

  { id: 'hook-stop', phase: 3, kind: 'gate', tag: 'hook', layer: 'hooks', mode: 'base',
    title: 'Hook · stop gate', sub: 'Stop — the session cannot end until report.md exists, is newer than evidence.json and states the recomputed verdict',
    chips: [
      { text: 'verdict recomputed, not trusted', mode: 'base' },
      { text: 'stop_hook_active → one retry, then a warning', mode: 'extended' },
    ] },

  { id: 'verdict', phase: 3, kind: 'verdict', num: 6,
    title: 'PASS / FAIL', sub: 'report.md with remediation checklist',
    branches: [
      { label: 'PASS', tone: 'pass', text: 'Ship it — screenshots, snapshots and report land beside the spec' },
      { label: 'FAIL', tone: 'fail', text: 'Back to step 4 with a file:line remediation list; re-run and re-diff' },
    ] },
];

/* --- Context fill segments -----------------------------------
   tokens  = approximate size of the segment
   when()  = whether the segment is currently in the payload
   ------------------------------------------------------------- */
const SEGMENTS = [
  { id: 'system',  label: 'System prompt + tools',   tokens: 11000, tone: 'neutral', cached: true,
    when: () => true },
  { id: 'skills',  label: 'SKILL.md files (pack)',   tokens: 9400,  tone: 'cyan',    cached: true,
    when: (s) => s.stage >= 1 },
  { id: 'config',  label: 'figma-to-code.config.md', tokens: 1300,  tone: 'purple',  cached: true,
    when: (s) => s.stage >= 4 && s.layers.config !== 'off' },
  { id: 'tokens',  label: 'token_files (styles.css)', tokens: 4200, tone: 'purple',  cached: true,
    when: (s) => s.stage >= 4 && s.layers.config === 'extended' },
  { id: 'spec',    label: 'design.md',               tokens: 5200,  tone: 'green',   cached: false,
    when: (s) => s.stage >= 5 },
  { id: 'images',  label: 'Figma PNG (vision tokens)', tokens: 3400, tone: 'orange', cached: false,
    when: (s) => s.stage >= 6 && s.layers.mcp !== 'off' },
  { id: 'browser', label: 'Browser snapshots + screenshots', tokens: 12600, tone: 'pink', cached: false,
    when: (s) => s.stage >= 7 && s.layers.mcp !== 'off' },
];

const BUDGET = 200000;          // ~200K context window
const COMPACT_AT = 83.5;        // auto-compaction threshold, %
