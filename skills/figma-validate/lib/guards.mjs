/**
 * The decision logic behind the four hooks in ../hooks/.
 *
 * Every function here takes plain values and returns plain values, so the rules
 * are testable without spawning a process or faking Claude Code's hook payloads.
 * The hook scripts are thin: read stdin, call one of these, translate the
 * answer into an exit code.
 *
 * Why hooks at all: SKILL.md can only *ask* the model to run the gate, to
 * stop on a failed fetch, to write a verdict that matches the evidence. A hook
 * is executed by the harness, so these rules hold whether or not the model
 * remembers them. The hooks never decide a verdict — `verdict.mjs` still does
 * that. They make it impossible to skip the decision or to contradict it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { evaluate } from './verdict.mjs';
import { validateEvidence, validateMatrix } from './schema.mjs';

const CONFIG_CANDIDATES = ['figma-to-code.config.md', '.claude/figma-to-code.config.md'];

/** @param {string} dir @returns {string | null} */
function readConfig(dir) {
  for (const candidate of CONFIG_CANDIDATES) {
    const path = join(dir, candidate);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return null;
}

/**
 * Reads one flat `key: "value"` line from the config's YAML block. Deliberately
 * not a YAML parser — the same trade the frontmatter reader in the tests makes.
 *
 * @param {string} configText
 * @param {string} key
 * @returns {string | null}
 */
export function configValue(configText, key) {
  const match = new RegExp(`^${key}:\\s*"([^"]*)"`, 'm').exec(configText);
  return match ? (match[1] ?? null) : null;
}

/**
 * Finds the ticket or slug in a UserPromptExpansion payload without depending
 * on which field carries it: the text after the command name, wherever it is.
 *
 * @param {unknown} payload
 * @returns {string | null}
 */
export function ticketFromPayload(payload) {
  /** @type {string[]} */
  const strings = [];
  const walk = (/** @type {unknown} */ v) => {
    if (typeof v === 'string') strings.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(payload);
  for (const s of strings) {
    const m = /figma-validate\s+([^\s]+)/.exec(s);
    if (m) return m[1] ?? null;
  }
  return null;
}

/**
 * Pre-flight for /figma-validate: the mechanical subset of the SKILL.md list —
 * everything checkable from the filesystem. Dev server, browser MCP and content
 * store are runtime conditions and stay with the skill.
 *
 * @param {{ cwd: string, ticket: string }} args
 * @returns {string[]} problems; empty means the run may start
 */
export function checkPreflight({ cwd, ticket }) {
  const config = readConfig(cwd);
  if (config === null) {
    return ['figma-to-code.config.md not found at the project root or in .claude/ — copy config/figma-to-code.config.template.md and fill it in'];
  }

  const specPath = configValue(config, 'spec_output_path');
  if (!specPath) return ['spec_output_path is missing or empty in figma-to-code.config.md'];

  const resolved = specPath.replaceAll('{ticket}', ticket).replaceAll('{slug}', ticket);
  const specDir = resolve(cwd, dirname(resolved));

  /** @type {string[]} */
  const problems = [];
  if (!existsSync(join(specDir, basename(resolved)))) {
    problems.push(`${join(specDir, basename(resolved))} does not exist — run /figma-specify ${ticket} first`);
  }

  const matrixPath = join(specDir, 'design.matrix.json');
  if (!existsSync(matrixPath)) {
    problems.push(`${matrixPath} does not exist — re-run /figma-specify ${ticket} to write the sidecar`);
  } else {
    try {
      const issues = validateMatrix(JSON.parse(readFileSync(matrixPath, 'utf8')));
      issues.forEach((i) => problems.push(`design.matrix.json: ${i}`));
    } catch (error) {
      problems.push(`design.matrix.json does not parse — re-run /figma-specify ${ticket} (${error instanceof Error ? error.message : error})`);
    }
  }

  const hasShot = listDir(specDir).some((n) => /^figma-.*\.png$/.test(n));
  if (!hasShot) {
    problems.push(`no figma-*.png in ${specDir} — run /figma-screenshot ${ticket} <figma-url> for each frame`);
  }

  return problems;
}

/** @param {string} dir @returns {string[]} */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Validates a gate artifact immediately after it is written.
 *
 * @param {string} filePath absolute path of the file that was just written
 * @returns {string[]} problems; empty when the file is fine or not one we guard
 */
export function checkArtifact(filePath) {
  const name = basename(filePath);
  const inValidation = basename(dirname(filePath)) === 'validation';

  const isMatrix = name === 'design.matrix.json';
  const isEvidence = name === 'evidence.json' && inValidation;
  if (!isMatrix && !isEvidence) return [];
  if (!existsSync(filePath)) return [];

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    return [`${name} is not valid JSON: ${error instanceof Error ? error.message : error}`];
  }

  if (isEvidence) return validateEvidence(parsed).map((p) => `${name}: ${p}`);

  const problems = validateMatrix(parsed).map((p) => `${name}: ${p}`);

  // Drift between the sidecar and the human-readable spec. Not a table parse —
  // the docs reject that on purpose — only: every container the gate will check
  // must at least be named in design.md, or one of the two files is wrong.
  const specPath = join(dirname(filePath), 'design.md');
  if (problems.length === 0 && existsSync(specPath) && Array.isArray(parsed.rows)) {
    const spec = readFileSync(specPath, 'utf8');
    const missing = [...new Set(parsed.rows.map((/** @type {{container: string}} */ r) => r.container))]
      .filter((c) => !spec.includes(c));
    missing.forEach((c) => problems.push(`${name}: container ${c} is not mentioned in design.md — the spec and its sidecar disagree`));
  }
  return problems;
}

const VERDICT_LINE = /\*\*Verdict\*\*:\s*(PASS|FAIL)\b(?!\s*\|)/;

/**
 * @param {string} markdown
 * @returns {'PASS' | 'FAIL' | null} null when no verdict is stated (or only the
 *   template placeholder `PASS | FAIL` is present)
 */
export function verdictIn(markdown) {
  const m = VERDICT_LINE.exec(markdown);
  return m ? /** @type {'PASS' | 'FAIL'} */ (m[1]) : null;
}

/**
 * What the evidence at `evidencePath` says the verdict is.
 *
 * @param {string} evidencePath
 * @returns {{ verdict: 'PASS' | 'FAIL' } | { error: string }}
 */
export function expectedVerdict(evidencePath) {
  if (!existsSync(evidencePath)) return { error: `${evidencePath} does not exist` };
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return { error: `${evidencePath} is not valid JSON: ${error instanceof Error ? error.message : error}` };
  }
  try {
    return { verdict: evaluate(evidence).verdict };
  } catch (error) {
    // The gate's exit-2 case: no verdict is the correct output.
    return { error: `the evidence could not be evaluated (gate exit 2): ${error instanceof Error ? error.message : error}` };
  }
}

/**
 * Decides whether a write to report.md may proceed.
 *
 * @param {{ filePath: string, content: string }} args `content` is the text
 *   being written (Write) or the replacement text (Edit)
 * @returns {string | null} a denial reason, or null to allow
 */
export function checkReportWrite({ filePath, content }) {
  if (basename(filePath) !== 'report.md' || basename(dirname(filePath)) !== 'validation') return null;

  const stated = verdictIn(content);
  const expected = expectedVerdict(join(dirname(filePath), 'evidence.json'));

  if ('error' in expected) {
    return `Cannot write a validation report: ${expected.error}. A gate that cannot evaluate its input emits no verdict — fix the evidence first.`;
  }
  // A partial edit that does not touch the verdict line cannot contradict it.
  if (stated === null) return null;
  if (stated !== expected.verdict) {
    return `The report says ${stated} but running the gate over evidence.json gives ${expected.verdict}. The verdict comes from lib/cli.mjs, not from the model — write what the tool printed.`;
  }
  return null;
}

/**
 * evidence.json paths this session wrote, recovered from the transcript. Scoping
 * the Stop check to these means ordinary sessions that never validated anything
 * are untouched.
 *
 * @param {string} transcriptJsonl
 * @returns {string[]}
 */
export function evidencePathsFromTranscript(transcriptJsonl) {
  /** @type {Set<string>} */
  const paths = new Set();
  for (const line of transcriptJsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      if (block.name !== 'Write' && block.name !== 'Edit') continue;
      const p = block.input?.file_path;
      if (typeof p === 'string' && p.endsWith('/validation/evidence.json')) paths.add(p);
    }
  }
  return [...paths];
}

/**
 * Whether the run may end. Re-derives the verdict from the evidence itself
 * rather than trusting anything the model recorded.
 *
 * @param {string[]} evidencePaths
 * @returns {string[]} problems; empty means the run may stop
 */
export function checkStop(evidencePaths) {
  /** @type {string[]} */
  const problems = [];
  for (const evidencePath of evidencePaths) {
    const reportPath = join(dirname(evidencePath), 'report.md');
    const expected = expectedVerdict(evidencePath);

    if ('error' in expected) {
      problems.push(`${expected.error}. Treat as a fail-stop and report it; do not write a verdict.`);
      continue;
    }
    if (!existsSync(reportPath)) {
      problems.push(`${reportPath} was never written — run node lib/cli.mjs over ${evidencePath} and write the report (gate says ${expected.verdict}).`);
      continue;
    }
    if (statSync(reportPath).mtimeMs < statSync(evidencePath).mtimeMs) {
      problems.push(`${reportPath} is older than ${evidencePath} — the evidence changed after the report was written; re-run the gate.`);
      continue;
    }
    const stated = verdictIn(readFileSync(reportPath, 'utf8'));
    if (stated !== expected.verdict) {
      problems.push(`${reportPath} states ${stated ?? 'no verdict'} but the gate over ${evidencePath} gives ${expected.verdict}.`);
    }
  }
  return problems;
}
