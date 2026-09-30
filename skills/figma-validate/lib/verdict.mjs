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
 * The module never returns anything other than PASS or FAIL. Unusable evidence
 * throws, because a gate that cannot evaluate its input must not emit a
 * verdict at all — silence is safe, PASS is not.
 */

/** Minor deltas at this many viewports or more become a failure. */
export const RECURRENCE_THRESHOLD = 2;

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
  return /** @type {Evidence} */ (evidence);
}

/**
 * Evaluates gathered evidence.
 *
 * @param {unknown} input
 * @returns {{
 *   verdict: 'PASS' | 'FAIL',
 *   blockers: string[],
 *   minor: string[],
 *   remediation: string[]
 * }}
 */
export function evaluate(input) {
  const evidence = assertEvidence(input);

  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const minor = [];
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
      });
    });

    (vp.tokens ?? []).forEach((token) => {
      if (token.match) return;
      blockers.push(
        `${token.element} @ ${vp.name}: ${token.property} expected ${token.expected}, resolved ${token.resolved}`,
      );
    });

    if (Number(vp.consoleErrors) > 0) {
      blockers.push(`${vp.name}: ${vp.consoleErrors} console error(s)`);
    }
    if (Number(vp.networkFailures) > 0) {
      blockers.push(`${vp.name}: ${vp.networkFailures} failed network request(s)`);
    }
  });

  // Rule 3: promote systematic drift.
  drift.forEach((viewports, key) => {
    if (viewports.length >= RECURRENCE_THRESHOLD) {
      const [container, prop] = key.split('|');
      blockers.push(
        `${container}: ${prop} drifts at ${viewports.length} viewports (${viewports.join(', ')}) — systematic, not rounding`,
      );
    }
  });

  (evidence.visualDeltas ?? []).forEach((delta) => {
    const severity = String(delta.severity ?? '').toLowerCase();
    const where = delta.viewport ? ` @ ${delta.viewport}` : '';
    const note = delta.note ? `: ${delta.note}` : '';
    if (severity === 'blocker') {
      blockers.push(`visual delta${where}${note}`);
    } else {
      minor.push(`visual delta (${severity || 'unspecified'})${where}${note}`);
    }
  });

  Object.entries(evidence.gates ?? {}).forEach(([name, status]) => {
    if (status === 'fail') blockers.push(`${name} gate failed`);
    else if (status !== 'pass' && status !== 'skipped') {
      throw new EvidenceError(`gate "${name}" has unrecognised status "${status}"`);
    }
  });

  return {
    verdict: blockers.length === 0 ? PASS : FAIL,
    blockers,
    minor,
    remediation: blockers.map((b) => `Fix — ${b}`),
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
