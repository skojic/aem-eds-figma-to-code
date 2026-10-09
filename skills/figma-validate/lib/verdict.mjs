/**
 * Verdict aggregation for the figma-validate gate.
 *
 * These rules lived in SKILL.md prose and were re-derived by a model on every
 * run. They are stated once, here, in code:
 *
 *   1. Any blocker delta fails the run.
 *   2. Any Layout Matrix mismatch fails the run — but only at a breakpoint
 *      where the property is actually set. A row inherited from a lower
 *      breakpoint is informational; it has no override to be wrong about.
 *   3. A minor delta (sub-pixel or rounding-scale) is recorded and does not
 *      fail on its own. It fails when the same container and property drift
 *      at two or more viewports, because that is a systematic offset rather
 *      than a rounding artefact.
 *
 * Rule 3 is the reason this module exists. In prose, "unless they recur across
 * viewports" is ambiguous about what recurs and how often. In code it is a
 * threshold with tests around it.
 *
 *   4. Runtime checks — axe-core inside the block, a keyboard pass, and a
 *      lab performance trace — are rules here too, not prose. Any axe
 *      violation, axe failing to load, a keyboard failure, block-caused CLS
 *      over CLS_THRESHOLD, or a lazy first-section image fails the run. LCP and
 *      the Lighthouse score are recorded and never decide anything.
 *
 * Rule 4 carries the same principle as the empty-viewports check: a check
 * that was not measured is not a passed check. Each runtime check must state a
 * status; a project whose browser cannot run one records `skipped` on purpose,
 * and leaving the record out entirely makes the evidence unevaluable.
 *
 * The module never returns anything other than PASS or FAIL. Unusable evidence
 * throws, because a gate that cannot evaluate its input must not emit a
 * verdict at all — silence is safe, PASS is not.
 */

/** Minor deltas at this many viewports or more become a failure. */
export const RECURRENCE_THRESHOLD = 2;

/**
 * Block-caused CLS strictly above this fails the run. 0.1 is the "good"
 * boundary Google publishes for Cumulative Layout Shift; a value exactly at it
 * passes.
 */
export const CLS_THRESHOLD = 0.1;

export const AXE_STATUSES = ['ran', 'not_loaded', 'block_not_found', 'skipped'];
export const CHECK_STATUSES = ['ran', 'skipped'];

export const PASS = 'PASS';
export const FAIL = 'FAIL';

/** Thrown when the evidence file cannot be evaluated. Never a verdict. */
export class EvidenceError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'EvidenceError';
  }
}

/**
 * @typedef {object} Evidence
 * @property {string} [ticket]
 * @property {string} [block]
 * @property {ViewportEvidence[]} viewports
 * @property {{ viewport?: string, severity: string, note?: string }[]} [visualDeltas]
 * @property {Record<string, 'pass' | 'fail' | 'skipped'>} [gates]
 * @property {RuntimeEvidence} runtime
 *
 * @typedef {object} RuntimeEvidence
 * @property {{ status: string, runs?: AxeRun[] }} axe
 * @property {{ status: string, reachedInOrder?: boolean, visibleFocus?: boolean, noTrap?: boolean }} keyboard
 * @property {{ status: string, cls?: number, clsInsideBlock?: boolean | null, lcpMs?: number, firstSectionImageLazy?: boolean | null }} performance
 * @property {{ mobile?: number, desktop?: number }} [lighthouse]
 *
 * @typedef {object} AxeRun
 * @property {string} viewport
 * @property {string} [theme]
 * @property {{ id: string, impact?: string, nodes?: string[] }[]} violations
 * @property {number} [incomplete]
 *
 * @typedef {object} RuntimeSummary
 * @property {string} axe
 * @property {number | null} axeViolations null when axe did not run
 * @property {string} keyboard
 * @property {string} performance
 * @property {number | null} cls null when no trace ran
 * @property {boolean | null} clsInsideBlock
 * @property {number | null} lcpMs
 * @property {{ mobile?: number, desktop?: number } | null} lighthouse
 *
 * @typedef {object} ViewportEvidence
 * @property {string} name
 * @property {RowEvidence[]} [rows]
 * @property {number} [consoleErrors]
 * @property {number} [networkFailures]
 * @property {{ element: string, property: string, expected: string, resolved: string, match: boolean }[]} [tokens]
 *
 * @typedef {object} RowEvidence
 * @property {string} container
 * @property {boolean} [inherited] true when this breakpoint sets no override
 * @property {{ prop: string, match: boolean, severity: string | null, reason: string | null }[]} results
 */

/**
 * @param {unknown} evidence
 * @returns {Evidence}
 */
function assertEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new EvidenceError('evidence must be an object');
  }
  const { viewports } = /** @type {Evidence} */ (evidence);
  if (!Array.isArray(viewports)) {
    throw new EvidenceError('evidence.viewports must be an array');
  }
  // A run that captured no viewport verified nothing. Returning PASS here is
  // the single most dangerous thing this module could do.
  if (viewports.length === 0) {
    throw new EvidenceError('evidence.viewports is empty — nothing was verified');
  }
  viewports.forEach((vp, i) => {
    if (!vp || typeof vp !== 'object') {
      throw new EvidenceError(`evidence.viewports[${i}] is not an object`);
    }
    if (!vp.name) throw new EvidenceError(`evidence.viewports[${i}] has no name`);
  });
  assertRuntime(/** @type {Evidence} */ (evidence).runtime);
  return /** @type {Evidence} */ (evidence);
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The runtime section has to say what happened to each check. Silence about a
 * check is treated like an empty viewport list: nothing to evaluate.
 *
 * @param {unknown} runtime
 */
function assertRuntime(runtime) {
  if (!isObject(runtime)) {
    throw new EvidenceError('evidence.runtime is missing — record axe, keyboard and performance, or mark each skipped');
  }
  const { axe, keyboard, performance } = runtime;

  if (!isObject(axe) || !AXE_STATUSES.includes(/** @type {string} */ (axe.status))) {
    throw new EvidenceError(`evidence.runtime.axe.status must be one of ${AXE_STATUSES.join(', ')}`);
  }
  if (axe.status === 'ran') {
    if (!Array.isArray(axe.runs) || axe.runs.length === 0) {
      throw new EvidenceError('evidence.runtime.axe says it ran but records no runs');
    }
    axe.runs.forEach((run, i) => {
      if (!isObject(run) || typeof run.viewport !== 'string' || !Array.isArray(run.violations)) {
        throw new EvidenceError(`evidence.runtime.axe.runs[${i}] needs a viewport and a violations array`);
      }
    });
  }

  if (!isObject(keyboard) || !CHECK_STATUSES.includes(/** @type {string} */ (keyboard.status))) {
    throw new EvidenceError(`evidence.runtime.keyboard.status must be one of ${CHECK_STATUSES.join(', ')}`);
  }
  if (keyboard.status === 'ran') {
    for (const key of ['reachedInOrder', 'visibleFocus', 'noTrap']) {
      if (typeof keyboard[key] !== 'boolean') {
        throw new EvidenceError(`evidence.runtime.keyboard.${key} must be a boolean when the pass ran`);
      }
    }
  }

  if (!isObject(performance) || !CHECK_STATUSES.includes(/** @type {string} */ (performance.status))) {
    throw new EvidenceError(`evidence.runtime.performance.status must be one of ${CHECK_STATUSES.join(', ')}`);
  }
  if (performance.status === 'ran') {
    const { cls } = performance;
    if (typeof cls !== 'number' || !Number.isFinite(cls) || cls < 0) {
      throw new EvidenceError('evidence.runtime.performance.cls must be a non-negative number when the trace ran');
    }
  }
}

/**
 * Applies rule 4. Pushes into the caller's lists and returns what was measured.
 *
 * @param {RuntimeEvidence} runtime
 * @param {string[]} blockers
 * @param {string[]} minor
 * @param {(check: string) => void} failed
 * @returns {RuntimeSummary}
 */
function evaluateRuntime(runtime, blockers, minor, failed) {
  const { axe, keyboard, performance, lighthouse } = runtime;

  /** @type {number | null} */
  let axeViolations = null;
  if (axe.status === 'not_loaded') {
    blockers.push('axe-core did not load — accessibility was not measured, which is not a pass');
    failed('axe');
  } else if (axe.status === 'block_not_found') {
    blockers.push('axe-core found no element matching the block selector — the block did not render or the selector is wrong');
    failed('axe');
  } else if (axe.status === 'skipped') {
    minor.push('axe skipped by config — accessibility not measured, not passed');
  } else {
    let count = 0;
    (axe.runs ?? []).forEach((run) => {
      const where = run.theme ? `${run.viewport}/${run.theme}` : run.viewport;
      run.violations.forEach((v) => {
        count += 1;
        const nodes = v.nodes?.length ?? 0;
        blockers.push(`axe @ ${where}: ${v.id}${v.impact ? ` (${v.impact})` : ''} on ${nodes} element(s)`);
        failed('axe');
      });
      if (Number(run.incomplete) > 0) {
        minor.push(`axe @ ${where}: ${run.incomplete} incomplete item(s) for manual review`);
      }
    });
    axeViolations = count;
  }

  if (keyboard.status === 'skipped') {
    minor.push('keyboard pass skipped by config — not measured, not passed');
  } else {
    if (keyboard.reachedInOrder === false) blockers.push('keyboard: not every focusable block element was reached in order');
    if (keyboard.visibleFocus === false) blockers.push('keyboard: at least one focused element shows no visible focus indicator');
    if (keyboard.noTrap === false) blockers.push('keyboard: focus is trapped inside the block');
    if (!keyboard.reachedInOrder || !keyboard.visibleFocus || !keyboard.noTrap) failed('keyboard');
  }

  /** @type {number | null} */
  let cls = null;
  /** @type {boolean | null} */
  let clsInsideBlock = null;
  /** @type {number | null} */
  let lcpMs = null;
  if (performance.status === 'skipped') {
    minor.push('performance trace skipped by config — CLS not measured, not passed');
  } else {
    cls = /** @type {number} */ (performance.cls);
    clsInsideBlock = performance.clsInsideBlock ?? null;
    if (cls > CLS_THRESHOLD) {
      // An unattributed shift fails: the test page is almost only the block,
      // so "no element named" is not evidence the block is innocent.
      if (clsInsideBlock === false) {
        minor.push(`CLS ${cls} is above ${CLS_THRESHOLD} but attributed outside the block`);
      } else {
        const why = clsInsideBlock === true ? 'inside the block' : 'not attributed to any element';
        blockers.push(`CLS ${cls} exceeds ${CLS_THRESHOLD} (${why})`);
        failed('cls');
      }
    }
    if (performance.firstSectionImageLazy === true) {
      blockers.push('the first-section image is loading="lazy" — it is the likely LCP element and must load eagerly');
      failed('lazy-image');
    }
    if (typeof performance.lcpMs === 'number') {
      lcpMs = performance.lcpMs;
      minor.push(`LCP ${lcpMs}ms — lab figure on a local server, informational only`);
    }
  }

  if (isObject(lighthouse)) {
    const parts = /** @type {('mobile' | 'desktop')[]} */ (['mobile', 'desktop'])
      .filter((k) => typeof lighthouse[k] === 'number')
      .map((k) => `${k} ${lighthouse[k]}`);
    if (parts.length) minor.push(`Lighthouse accessibility (page-level, context only): ${parts.join(' · ')}`);
  }

  return {
    axe: axe.status,
    axeViolations,
    keyboard: keyboard.status,
    performance: performance.status,
    cls,
    clsInsideBlock,
    lcpMs,
    lighthouse: isObject(lighthouse) ? lighthouse : null,
  };
}

/**
 * Evaluates gathered evidence.
 *
 * @param {unknown} input
 * @returns {{
 *   verdict: 'PASS' | 'FAIL',
 *   blockers: string[],
 *   minor: string[],
 *   remediation: string[],
 *   failedChecks: string[],
 *   runtime: RuntimeSummary
 * }}
 */
export function evaluate(input) {
  const evidence = assertEvidence(input);

  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const minor = [];
  /**
   * Which kinds of check failed, in first-seen order. The run log records the
   * first one, so "most frequent failing check" is computed, not typed.
   * @type {string[]}
   */
  const failedChecks = [];
  const failed = (/** @type {string} */ check) => {
    if (!failedChecks.includes(check)) failedChecks.push(check);
  };
  /** Minor drift keyed by `container|prop`, collecting the viewports it hit. */
  const drift = new Map();

  evidence.viewports.forEach((vp) => {
    (vp.rows ?? []).forEach((row) => {
      (row.results ?? []).forEach((result) => {
        if (result.match) return;

        const where = `${row.container} @ ${vp.name}`;
        const detail = result.reason ?? 'mismatch';

        // Rule 2: no override at this breakpoint means nothing to fail on.
        if (row.inherited) {
          minor.push(`${where}: ${result.prop} differs on an inherited row (${detail})`);
          return;
        }

        if (result.severity === 'minor') {
          const key = `${row.container}|${result.prop}`;
          const seen = drift.get(key) ?? [];
          seen.push(vp.name);
          drift.set(key, seen);
          minor.push(`${where}: ${result.prop} ${detail}`);
          return;
        }

        blockers.push(`${where}: ${result.prop} ${detail}`);
        failed('layout-matrix');
      });
    });

    (vp.tokens ?? []).forEach((token) => {
      if (token.match) return;
      blockers.push(
        `${token.element} @ ${vp.name}: ${token.property} expected ${token.expected}, resolved ${token.resolved}`,
      );
      failed('token');
    });

    if (Number(vp.consoleErrors) > 0) {
      blockers.push(`${vp.name}: ${vp.consoleErrors} console error(s)`);
      failed('console');
    }
    if (Number(vp.networkFailures) > 0) {
      blockers.push(`${vp.name}: ${vp.networkFailures} failed network request(s)`);
      failed('network');
    }
  });

  // Rule 3: promote systematic drift.
  drift.forEach((viewports, key) => {
    if (viewports.length >= RECURRENCE_THRESHOLD) {
      const [container, prop] = key.split('|');
      blockers.push(
        `${container}: ${prop} drifts at ${viewports.length} viewports (${viewports.join(', ')}) — systematic, not rounding`,
      );
      failed('layout-matrix');
    }
  });

  (evidence.visualDeltas ?? []).forEach((delta) => {
    const severity = String(delta.severity ?? '').toLowerCase();
    const where = delta.viewport ? ` @ ${delta.viewport}` : '';
    const note = delta.note ? `: ${delta.note}` : '';
    if (severity === 'blocker') {
      blockers.push(`visual delta${where}${note}`);
      failed('visual');
    } else {
      minor.push(`visual delta (${severity || 'unspecified'})${where}${note}`);
    }
  });

  Object.entries(evidence.gates ?? {}).forEach(([name, status]) => {
    if (status === 'fail') {
      blockers.push(`${name} gate failed`);
      failed(name);
    } else if (status !== 'pass' && status !== 'skipped') {
      throw new EvidenceError(`gate "${name}" has unrecognised status "${status}"`);
    }
  });

  const runtime = evaluateRuntime(evidence.runtime, blockers, minor, failed);

  return {
    verdict: blockers.length === 0 ? PASS : FAIL,
    blockers,
    minor,
    remediation: blockers.map((b) => `Fix — ${b}`),
    failedChecks,
    runtime,
  };
}

/**
 * Renders the report body written to `<spec-dir>/validation/report.md`.
 *
 * @param {ReturnType<typeof evaluate>} outcome
 * @param {{ ticket?: string, block?: string, date?: string }} [meta]
 * @returns {string}
 */
export function formatReport(outcome, meta = {}) {
  const lines = [
    `**Verdict**: ${outcome.verdict}`,
    meta.date ? `**Date**: ${meta.date}` : null,
    meta.block ? `**Block**: ${meta.block}` : null,
    '',
  ].filter((l) => l !== null);

  const r = outcome.runtime;
  lines.push(
    '## Accessibility & performance',
    `- axe-core: ${r.axe === 'ran' ? `${r.axeViolations} violation(s) inside the block` : r.axe}`,
    `- Keyboard pass: ${r.keyboard}`,
    `- CLS: ${r.cls === null ? r.performance : `${r.cls} (gate: ≤ ${CLS_THRESHOLD}${r.clsInsideBlock === false ? ', shift outside the block' : ''})`}`,
    '',
  );

  if (outcome.blockers.length) {
    lines.push('## Blockers', ...outcome.blockers.map((b) => `- ${b}`), '');
  }
  if (outcome.minor.length) {
    lines.push('## Recorded, not failing', ...outcome.minor.map((m) => `- ${m}`), '');
  }
  if (outcome.remediation.length) {
    lines.push('## Remediation', ...outcome.remediation.map((r) => `- [ ] ${r}`), '');
  }
  return lines.join('\n');
}
