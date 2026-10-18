---
name: figma-screenshot
description: Fetch a Figma node screenshot via the configured Figma MCP and save it beside the design.md spec as audit-trail evidence. Config-driven. Explicit invocation only — use only when the user types "/figma-screenshot" or "figma-screenshot <ticket-or-slug> <figma-url>".
disable-model-invocation: true
---

# Figma Screenshot

Fetches a Figma node screenshot via the `mcp.figma` server and saves it into the spec directory for `{ticket}` so reviewers can audit design.md without Figma access. Read-only — does not modify any code.

This is a companion to [figma-specify](../figma-specify/SKILL.md). Run it once per major Figma frame referenced by `design.md`.

## Config (read first)

Read `figma-to-code.config.md` (root, fallback `.claude/`). If missing, STOP
and point the user at the template. Bind `mcp.figma` and `spec_output_path`.
Save screenshots into the **directory of** `spec_output_path` for this
`{ticket}` — the same folder `figma-specify` writes `design.md` into — so
`figma-validate` finds them.

## Critical Constraints

1. **Read-only** — fetch and save only. Never modifies code, Jira, or styles.
2. **`mcp.figma` server required** — per config, only the `mcp.figma` server is allowed for Figma. No substitutions.
3. **Ticket scope** — saves into the directory derived from `spec_output_path` for `{ticket}`. The ticket must be resolvable from user input or context.

## Inputs to Gather

| Input | Example | Source |
|-------|---------|--------|
| Ticket ID | `{ticket}` (e.g. `PROJ-123`) | User, context, or argument |
| Figma URL | `https://figma.com/design/<fileKey>/<name>?node-id=1-177` (illustrative — real value from user) | User, `design.md`, or ticket |
| `fileKey` | parsed from the URL the user provides | Parsed from URL |
| `nodeId` | `1:177` | Parsed from URL (`node-id=1-177` → `1:177` for MCP) |
| Output filename | `figma-teaser-desktop.png` | User, or inferred from node name + viewport |

No default file key — parse it from the URL the user provides.

## Workflow

### Step 1: Resolve Inputs

- **Ticket ID**: Must be a valid ticket identifier. If not provided, ask the user — never guess.
- **Figma reference**: Parse from URL the user provides. URL form `node-id=1-177` converts to MCP form `1:177` (replace `-` with `:`).
- **Output directory**: the directory of `spec_output_path` for `{ticket}` (e.g. if `spec_output_path` is `drafts/specs/{ticket}/design.md`, the directory is `drafts/specs/{ticket}/` — but use the actual configured value). Create with `mkdir -p` if it does not exist.
- **Output filename**: If user did not specify, use `figma-{slug}-{viewport}.png` where:
  - `{slug}` = lowercased node name with non-alphanumeric replaced by `-` (e.g. `teaser-card-hover`)
  - `{viewport}` = `mobile` / `tablet` / `desktop` / `wide` / `xl` — derived from frame width if obvious, else omit

### Step 2: Fetch the Screenshot

Call the `mcp.figma` server tool that returns a PNG for a node (commonly named `get_screenshot`, `get_image`, or `get_figma_image` — use whichever the connected `mcp.figma` server exposes). Pass `fileKey` and `nodeId`.

Extract the base64-encoded PNG from the response.

### Step 3: Save to Disk

Decode and write to the resolved output path (the directory is derived from `spec_output_path` in config — substitute the real path):

```bash
echo "<base64>" | base64 -d > <spec-dir>/<filename>.png
```

Verify the file exists and is non-empty before reporting success.

### Step 4: Report

Output:
- Saved file path (absolute or repo-relative)
- File size
- Figma node ID + URL captured
- Suggested next step: add a reference line to the spec's `design.md` under the Source section, e.g.
  ```markdown
  - **Figma node** `1:177` — see [figma-teaser-desktop.png](./figma-teaser-desktop.png)
  ```

## Key Rules

- Use absolute paths internally; report repo-relative paths to the user
- If Figma reference cannot be determined, ask the user — do not guess `fileKey` or `nodeId`
- Do not run lint, dev server, browser checks, or git operations
- Do not modify `design.md`, `styles.css`, or any block file
- One invocation = one screenshot. To capture multiple frames, the caller invokes the skill multiple times (or `figma-specify` orchestrates the loop)
