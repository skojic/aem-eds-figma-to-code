/**
 * Shape checks for the two JSON artifacts the gate depends on.
 *
 * Both functions return a list of problems rather than throwing, so a hook can
 * show the model every defect in one pass instead of one per round trip. An
 * empty list means the shape is usable — it says nothing about whether the
 * values are *right*; that is the verdict core's job.
 *
 * Kept dependency-free for the same reason as the rest of lib/: the pack
 * installs by copying directories.
 */

import { AXE_STATUSES, CHECK_STATUSES } from './verdict.mjs';

const ROW_SEVERITIES = ['blocker', 'minor'];
const DELTA_SEVERITIES = ['blocker', 'major', 'minor'];
const GATE_STATUSES = ['pass', 'fail', 'skipped'];

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `design.matrix.json`, as written by /figma-specify.
 *
 * @param {unknown} matrix
 * @returns {string[]}
 */
export function validateMatrix(matrix) {
  /** @type {string[]} */
  const problems = [];
  if (!isObject(matrix)) return ['matrix must be a JSON object'];

  if (typeof matrix.block !== 'string' || !matrix.block) problems.push('block must be a non-empty string');

  /** @type {Set<string>} */
  const mins = new Set();
  if (!Array.isArray(matrix.breakpoints) || matrix.breakpoints.length === 0) {
    problems.push('breakpoints must be a non-empty array');
  } else {
    matrix.breakpoints.forEach((bp, i) => {
      if (!isObject(bp) || typeof bp.name !== 'string' || typeof bp.min !== 'number') {
        problems.push(`breakpoints[${i}] needs a string name and a numeric min`);
      } else {
        mins.add(String(bp.min));
      }
    });
  }

  if (!Array.isArray(matrix.rows) || matrix.rows.length === 0) {
    // An empty matrix would make the gate check nothing and still pass.
    problems.push('rows must be a non-empty array — an empty matrix verifies nothing');
    return problems;
  }

  matrix.rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (!isObject(row)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (typeof row.container !== 'string' || !row.container) problems.push(`${at}.container must be a non-empty string`);
    if (typeof row.breakpoint !== 'string') {
      problems.push(`${at}.breakpoint must be a string (the min-width, e.g. "768")`);
    } else if (mins.size > 0 && !mins.has(row.breakpoint)) {
      problems.push(`${at}.breakpoint "${row.breakpoint}" matches no min in breakpoints`);
    }
    if (typeof row.declarations !== 'string') problems.push(`${at}.declarations must be a string`);
    if (typeof row.inherited !== 'boolean') problems.push(`${at}.inherited must be a boolean`);

    // An inherited row asserts "no override here". Carrying values on it would
    // assert an override the CSS does not make; an empty non-inherited row
    // would assert an override with nothing to check.
    if (row.inherited === true && typeof row.declarations === 'string' && row.declarations.trim() !== '') {
      problems.push(`${at} is inherited but has declarations — an inherited row declares no override`);
    }
    if (row.inherited === false && typeof row.declarations === 'string' && row.declarations.trim() === '') {
      problems.push(`${at} is not inherited but has empty declarations`);
    }
  });

  return problems;
}

/**
 * `evidence.json`, as written by /figma-validate before the verdict.
 *
 * @param {unknown} evidence
 * @returns {string[]}
 */
export function validateEvidence(evidence) {
  /** @type {string[]} */
  const problems = [];
  if (!isObject(evidence)) return ['evidence must be a JSON object'];

  if (!Array.isArray(evidence.viewports) || evidence.viewports.length === 0) {
    // Same reason the verdict core refuses this: nothing was verified.
    problems.push('viewports must be a non-empty array — nothing was verified');
    return problems;
  }

  evidence.viewports.forEach((vp, i) => {
    const at = `viewports[${i}]`;
    if (!isObject(vp)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (typeof vp.name !== 'string' || !vp.name) problems.push(`${at}.name must be a non-empty string`);

    for (const key of ['consoleErrors', 'networkFailures']) {
      if (key in vp && typeof vp[key] !== 'number') problems.push(`${at}.${key} must be a number`);
    }

    const rows = vp.rows ?? [];
    if (!Array.isArray(rows)) {
      problems.push(`${at}.rows must be an array`);
    } else {
      rows.forEach((row, j) => {
        const rat = `${at}.rows[${j}]`;
        if (!isObject(row)) {
          problems.push(`${rat} is not an object`);
          return;
        }
        if (typeof row.container !== 'string' || !row.container) problems.push(`${rat}.container must be a non-empty string`);
        if (!Array.isArray(row.results)) {
          problems.push(`${rat}.results must be an array`);
          return;
        }
        row.results.forEach((r, k) => {
          const qat = `${rat}.results[${k}]`;
          if (!isObject(r)) {
            problems.push(`${qat} is not an object`);
            return;
          }
          if (typeof r.prop !== 'string' || !r.prop) problems.push(`${qat}.prop must be a non-empty string`);
          if (typeof r.match !== 'boolean') problems.push(`${qat}.match must be a boolean`);
          if (r.match === false && !ROW_SEVERITIES.includes(/** @type {string} */ (r.severity))) {
            // A mismatch with no severity would fall through to "blocker" in the
            // verdict core, which is safe — but it means compare.mjs was bypassed.
            problems.push(`${qat} is a mismatch with severity ${JSON.stringify(r.severity)}; expected one of ${ROW_SEVERITIES.join(', ')}`);
          }
        });
      });
    }

    const tokens = vp.tokens ?? [];
    if (!Array.isArray(tokens)) {
      problems.push(`${at}.tokens must be an array`);
    } else {
      tokens.forEach((t, j) => {
        if (!isObject(t) || typeof t.match !== 'boolean' || typeof t.element !== 'string') {
          problems.push(`${at}.tokens[${j}] needs a string element and a boolean match`);
        }
      });
    }
  });

  const deltas = evidence.visualDeltas ?? [];
  if (!Array.isArray(deltas)) {
    problems.push('visualDeltas must be an array');
  } else {
    deltas.forEach((d, i) => {
      const severity = isObject(d) ? String(d.severity ?? '').toLowerCase() : '';
      if (!DELTA_SEVERITIES.includes(severity)) {
        problems.push(`visualDeltas[${i}].severity must be one of ${DELTA_SEVERITIES.join(', ')}`);
      }
    });
  }

  if ('gates' in evidence) {
    if (!isObject(evidence.gates)) {
      problems.push('gates must be an object');
    } else {
      Object.entries(evidence.gates).forEach(([name, status]) => {
        if (!GATE_STATUSES.includes(/** @type {string} */ (status))) {
          problems.push(`gates.${name} is ${JSON.stringify(status)}; expected one of ${GATE_STATUSES.join(', ')}`);
        }
      });
    }
  }

  problems.push(...validateRuntime(evidence.runtime));

  return problems;
}

/**
 * The `runtime` section: axe-core, the keyboard pass and the performance trace.
 * Mirrors the checks `verdict.mjs` throws on, but collects all of them.
 *
 * @param {unknown} runtime
 * @returns {string[]}
 */
function validateRuntime(runtime) {
  if (!isObject(runtime)) {
    // Same reason the verdict core refuses it: silence is not a measurement.
    return ['runtime is missing — record axe, keyboard and performance, or mark each skipped'];
  }
  /** @type {string[]} */
  const problems = [];
  const { axe, keyboard, performance, lighthouse } = runtime;

  if (!isObject(axe) || !AXE_STATUSES.includes(/** @type {string} */ (axe.status))) {
    problems.push(`runtime.axe.status must be one of ${AXE_STATUSES.join(', ')}`);
  } else if (axe.status === 'ran') {
    if (!Array.isArray(axe.runs) || axe.runs.length === 0) {
      problems.push('runtime.axe ran but records no runs');
    } else {
      axe.runs.forEach((run, i) => {
        const at = `runtime.axe.runs[${i}]`;
        if (!isObject(run)) {
          problems.push(`${at} is not an object`);
          return;
        }
        if (typeof run.viewport !== 'string' || !run.viewport) problems.push(`${at}.viewport must be a non-empty string`);
        if (!Array.isArray(run.violations)) {
          problems.push(`${at}.violations must be an array`);
        } else {
          run.violations.forEach((v, j) => {
            if (!isObject(v) || typeof v.id !== 'string') problems.push(`${at}.violations[${j}] needs a string id`);
          });
        }
        if ('incomplete' in run && typeof run.incomplete !== 'number') problems.push(`${at}.incomplete must be a number`);
      });
    }
  }

  if (!isObject(keyboard) || !CHECK_STATUSES.includes(/** @type {string} */ (keyboard.status))) {
    problems.push(`runtime.keyboard.status must be one of ${CHECK_STATUSES.join(', ')}`);
  } else if (keyboard.status === 'ran') {
    ['reachedInOrder', 'visibleFocus', 'noTrap'].forEach((key) => {
      if (typeof keyboard[key] !== 'boolean') problems.push(`runtime.keyboard.${key} must be a boolean when the pass ran`);
    });
  }

  if (!isObject(performance) || !CHECK_STATUSES.includes(/** @type {string} */ (performance.status))) {
    problems.push(`runtime.performance.status must be one of ${CHECK_STATUSES.join(', ')}`);
  } else if (performance.status === 'ran') {
    const { cls } = performance;
    if (typeof cls !== 'number' || !Number.isFinite(cls) || cls < 0) {
      problems.push('runtime.performance.cls must be a non-negative number when the trace ran');
    }
    ['clsInsideBlock', 'firstSectionImageLazy'].forEach((key) => {
      const v = performance[key];
      if (key in performance && v !== null && typeof v !== 'boolean') {
        problems.push(`runtime.performance.${key} must be true, false or null`);
      }
    });
    if ('lcpMs' in performance && typeof performance.lcpMs !== 'number') {
      problems.push('runtime.performance.lcpMs must be a number');
    }
  }

  if (lighthouse !== undefined && !isObject(lighthouse)) problems.push('runtime.lighthouse must be an object');

  return problems;
}
