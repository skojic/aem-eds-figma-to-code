#!/usr/bin/env node
/**
 * Append-only run log for the /figma-validate gate.
 *
 * The test suite answers "are the rules implemented correctly?". This answers
 * the other question — "are the rules right?" — by recording one row per run
 * and, later, the corrections review makes. Run counts say a tool is being
 * used; two error rates say whether it works:
 *
 *   false pass — the gate said PASS and review later found a defect it should
 *                have caught. The control failing silently: the expensive
 *                direction.
 *   false fail — the gate said FAIL and the code was fine. This is what gets a
 *                gate switched off, after which its accuracy is irrelevant.
 *
 * A run row is derived from evidence.json through `evaluate()`, never typed
 * in: the verdict, the first failing check, the axe violation count and the
 * CLS all come from the same code that decided the verdict. Unevaluable
 * evidence (the gate's exit 2) is refused, because logging it as anything
 * would put a verdict nobody earned into the totals.
 *
 * Append-only by design. Corrections are new rows that reference a ticket,
 * never edits to an earlier one — a log that can be rewritten is a log whose
 * totals cannot be quoted.
 *
 * Rows carry ticket identifiers, so the log file belongs in the consuming
 * project's .gitignore. The default path is `.figma-validate/runs.jsonl`
 * (config: `run_log_path`).
 *
 * Usage:
 *   node lib/runlog.mjs run <TICKET> --evidence=<path> [--sec=<n>] [--log=<path>]
 *   node lib/runlog.mjs false-pass <TICKET> "<what review caught>" [--log=<path>]
 *   node lib/runlog.mjs false-fail <TICKET> "<why the gate was wrong>" [--log=<path>]
 *   node lib/runlog.mjs report [--log=<path>]
 *
 * Exit codes: 0 ok · 2 usage error or unevaluable evidence.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLS_THRESHOLD, evaluate } from './verdict.mjs';

export const DEFAULT_LOG_PATH = '.figma-validate/runs.jsonl';

/**
 * @typedef {{ type: 'run', ticket: string, verdict: 'PASS' | 'FAIL', check?: string,
 *   sec?: number, a11y?: number, cls?: number, at: string }} RunRecord
 * @typedef {{ type: 'false-pass' | 'false-fail', ticket: string, note: string, at: string }} CorrectionRecord
 * @typedef {RunRecord | CorrectionRecord} LogRecord
 */

/**
 * Builds a run row from evidence. Throws EvidenceError (from evaluate) when the
 * evidence cannot be evaluated — the caller must not log anything then.
 *
 * Unmeasured checks are omitted from the row, never written as 0: a run where
 * axe did not load is "not measured", and counting it as clean would inflate
 * the clean rate with runs where nothing was looked at.
 *
 * @param {string} ticket
 * @param {unknown} evidence
 * @param {{ sec?: number, at?: string }} [extra]
 * @returns {RunRecord}
 */
export function runRecord(ticket, evidence, { sec, at = new Date().toISOString() } = {}) {
  const outcome = evaluate(evidence);
  /** @type {RunRecord} */
  const record = { type: 'run', ticket, verdict: outcome.verdict, at };
  if (outcome.failedChecks[0]) record.check = outcome.failedChecks[0];
  if (typeof sec === 'number') record.sec = sec;
  if (outcome.runtime.axeViolations !== null) record.a11y = outcome.runtime.axeViolations;
  if (outcome.runtime.cls !== null) record.cls = outcome.runtime.cls;
  return record;
}

/**
 * @param {string} path
 * @returns {LogRecord[]}
 */
export function read(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        // A corrupt line must not silently vanish from the totals — that would
        // quietly change a number someone is about to quote.
        throw new Error(`${path} line ${i + 1} is not valid JSON`);
      }
    });
}

/**
 * @param {string} path
 * @param {LogRecord} record
 */
export function append(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * @param {number} n
 * @param {number} of
 * @returns {number | null} a whole percentage, or null when the denominator is 0
 */
const rate = (n, of) => (of === 0 ? null : Math.round((n / of) * 100));

/**
 * Lower median of a list sorted ascending.
 * @param {number[]} xs
 * @returns {number | null}
 */
const median = (xs) => (xs.length ? /** @type {number} */ (xs[Math.floor(xs.length / 2)]) : null);

/**
 * Aggregates the log.
 *
 * @param {LogRecord[]} records
 */
export function summarise(records) {
  const runs = /** @type {RunRecord[]} */ (records.filter((r) => r.type === 'run'));
  const passes = runs.filter((r) => r.verdict === 'PASS');
  const fails = runs.filter((r) => r.verdict === 'FAIL');
  const falsePasses = records.filter((r) => r.type === 'false-pass');
  const falseFails = records.filter((r) => r.type === 'false-fail');

  /** @type {Map<string, number>} */
  const byCheck = new Map();
  fails.forEach((r) => {
    if (r.check) byCheck.set(r.check, (byCheck.get(r.check) ?? 0) + 1);
  });

  const dates = runs.map((r) => r.at.slice(0, 10)).sort();
  const durations = runs.map((r) => r.sec).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  const a11yRuns = runs.filter((r) => typeof r.a11y === 'number');
  const clsValues = runs.map((r) => r.cls).filter((n) => typeof n === 'number').sort((a, b) => a - b);

  return {
    runs: runs.length,
    tickets: new Set(runs.map((r) => r.ticket)).size,
    passes: passes.length,
    fails: fails.length,
    passRate: rate(passes.length, runs.length),
    falsePasses: falsePasses.length,
    // Denominator is PASSES, not all runs: a false pass is a pass that was
    // wrong. Dividing by every run understates the one number that measures
    // the control.
    falsePassRate: rate(falsePasses.length, passes.length),
    falseFails: falseFails.length,
    falseFailRate: rate(falseFails.length, fails.length),
    topChecks: [...byCheck.entries()].sort((a, b) => b[1] - a[1]),
    firstDay: dates[0] ?? null,
    lastDay: dates[dates.length - 1] ?? null,
    medianSec: median(durations),
    a11yMeasured: a11yRuns.length,
    a11yRunsWithViolations: a11yRuns.filter((r) => /** @type {number} */ (r.a11y) > 0).length,
    a11yViolationsTotal: a11yRuns.reduce((sum, r) => sum + /** @type {number} */ (r.a11y), 0),
    clsMeasured: clsValues.length,
    clsOverThreshold: clsValues.filter((n) => n > CLS_THRESHOLD).length,
    medianCls: median(clsValues),
    notes: [...falsePasses, ...falseFails].map((r) => `${r.type} · ${r.ticket} · ${/** @type {CorrectionRecord} */ (r).note}`),
  };
}

/**
 * @param {ReturnType<typeof summarise>} s
 * @returns {string}
 */
export function render(s) {
  if (s.runs === 0) return 'No runs logged yet.\n';

  /** @type {(string | null)[]} */
  const draft = [
    '',
    `Runs            ${s.runs} across ${s.tickets} ticket(s)`,
    `Window          ${s.firstDay} → ${s.lastDay}`,
    `Verdicts        ${s.passes} PASS · ${s.fails} FAIL  (${s.passRate}% pass)`,
    s.medianSec !== null ? `Median duration ${s.medianSec}s` : null,
    s.a11yMeasured
      ? `Accessibility   ${s.a11yRunsWithViolations} of ${s.a11yMeasured} measured run(s) had axe violations (${s.a11yViolationsTotal} total)`
      : null,
    s.clsMeasured
      ? `CLS (lab)       median ${s.medianCls} · ${s.clsOverThreshold} of ${s.clsMeasured} over ${CLS_THRESHOLD}`
      : null,
    '',
    `False passes    ${s.falsePasses}${s.falsePassRate !== null ? ` of ${s.passes} passes (${s.falsePassRate}%)` : ''}`,
    `False fails     ${s.falseFails}${s.falseFailRate !== null ? ` of ${s.fails} fails (${s.falseFailRate}%)` : ''}`,
    '',
  ];
  const lines = /** @type {string[]} */ (draft.filter((l) => l !== null));

  if (s.topChecks.length) {
    lines.push('Most frequent failing checks');
    s.topChecks.forEach(([check, n]) => lines.push(`  ${String(n).padStart(3)}  ${check}`));
    lines.push('');
  }
  if (s.notes.length) {
    lines.push('Corrections');
    s.notes.forEach((n) => lines.push(`  ${n}`));
    lines.push('');
  }

  // The caveat travels with the numbers rather than being left for a reader
  // to find.
  lines.push('False passes are a floor, not an estimate: one is only recorded when');
  lines.push('review happens to catch it. Small samples say little either way.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Parses `--name=value` flags out of an argument list.
 *
 * @param {string[]} args
 * @returns {{ flags: Record<string, string>, positional: string[] }}
 */
export function parseArgs(args) {
  /** @type {Record<string, string>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  args.forEach((a) => {
    const m = /^--([\w-]+)=(.*)$/.exec(a);
    if (m) flags[/** @type {string} */ (m[1])] = /** @type {string} */ (m[2]);
    else positional.push(a);
  });
  return { flags, positional };
}

const USAGE = `usage:
  node lib/runlog.mjs run <TICKET> --evidence=<path> [--sec=<n>] [--log=<path>]
  node lib/runlog.mjs false-pass <TICKET> "<what review caught>" [--log=<path>]
  node lib/runlog.mjs false-fail <TICKET> "<why the gate was wrong>" [--log=<path>]
  node lib/runlog.mjs report [--log=<path>]
`;

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd?: string, out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {number} exit code
 */
export function main(argv, { cwd = process.cwd(), out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const { flags, positional } = parseArgs(argv);
  const [cmd, ticket, ...rest] = positional;
  const logPath = resolve(cwd, flags.log ?? DEFAULT_LOG_PATH);

  if (cmd === 'report') {
    out(render(summarise(read(logPath))));
    return 0;
  }
  if (!cmd || !ticket) {
    err(USAGE);
    return 2;
  }

  if (cmd === 'run') {
    if (!flags.evidence) {
      err('run needs --evidence=<path to validation/evidence.json>\n');
      return 2;
    }
    let sec;
    if (flags.sec !== undefined) {
      sec = Number(flags.sec);
      if (!Number.isFinite(sec) || sec < 0) {
        err('--sec must be a non-negative number\n');
        return 2;
      }
    }
    let record;
    try {
      const evidence = JSON.parse(readFileSync(resolve(cwd, flags.evidence), 'utf8'));
      record = runRecord(ticket, evidence, { sec });
    } catch (error) {
      err(`not logged — the evidence could not be evaluated: ${error instanceof Error ? error.message : error}\n`);
      return 2;
    }
    append(logPath, record);
    out(`logged ${ticket} ${record.verdict}${record.check ? ` (${record.check})` : ''}\n`);
    return 0;
  }

  if (cmd === 'false-pass' || cmd === 'false-fail') {
    const note = rest.join(' ').trim();
    if (!note) {
      // An unexplained correction is not evidence of anything a month later.
      err('a note is required — what did review actually find?\n');
      return 2;
    }
    append(logPath, { type: cmd, ticket, note, at: new Date().toISOString() });
    out(`logged ${cmd} for ${ticket}\n`);
    return 0;
  }

  err(`unknown command "${cmd}"\n${USAGE}`);
  return 2;
}

// Only run as a CLI, so the module stays importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
