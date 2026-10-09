import { describe, it, expect } from 'vitest';
import {
  CLS_THRESHOLD,
  EvidenceError,
  RECURRENCE_THRESHOLD,
  evaluate as evaluateRaw,
  formatReport,
} from '../skills/figma-validate/lib/verdict.mjs';
import { RUNTIME_OK } from './helpers/project.mjs';

/**
 * The layout-rule tests below predate the runtime section and are about
 * layout, not accessibility. This wrapper gives any object input a clean
 * runtime record so those tests keep testing one thing. Inputs that already
 * carry `runtime`, and non-object junk, pass through untouched; the runtime
 * tests further down call `evaluateRaw` directly.
 *
 * @param {any} input
 */
const evaluate = (input) => evaluateRaw(
  input && typeof input === 'object' && !Array.isArray(input) && !('runtime' in input)
    ? { ...input, runtime: RUNTIME_QUIET }
    : input,
);

/** Clean runtime with no informational extras, so `minor` counts stay exact. */
const RUNTIME_QUIET = {
  axe: { status: 'ran', runs: [{ viewport: 'desktop', violations: [] }] },
  keyboard: { status: 'ran', reachedInOrder: true, visibleFocus: true, noTrap: true },
  performance: { status: 'ran', cls: 0 },
};

/** Evidence with clean layout and the given runtime overrides. */
const withRuntime = (overrides) => ({
  viewports: [{ name: 'desktop', rows: [] }],
  runtime: { ...RUNTIME_OK, ...overrides },
});

/** A passing row for one container at one viewport. */
const ok = (container = '.teaser-inner') => ({
  container,
  results: [{ prop: 'gap', match: true, severity: null, reason: null }],
});

/** A failing row at a given severity. */
const bad = (severity, container = '.teaser-inner', prop = 'gap') => ({
  container,
  results: [{ prop, match: false, severity, reason: `${prop} is off` }],
});

const viewport = (name, rows) => ({ name, rows });

describe('evaluate — the happy path', () => {
  it('passes when every row matches', () => {
    const out = evaluate({ viewports: [viewport('mobile', [ok()]), viewport('desktop', [ok()])] });
    expect(out.verdict).toBe('PASS');
    expect(out.blockers).toEqual([]);
  });

  it('passes with skipped gates', () => {
    const out = evaluate({
      viewports: [viewport('mobile', [ok()])],
      gates: { lint: 'pass', test: 'skipped' },
    });
    expect(out.verdict).toBe('PASS');
  });
});

describe('evaluate — rule 1: blockers fail', () => {
  it('fails on a blocker row mismatch at a single viewport', () => {
    const out = evaluate({ viewports: [viewport('desktop', [bad('blocker')])] });
    expect(out.verdict).toBe('FAIL');
    expect(out.blockers).toHaveLength(1);
  });

  it('fails on a blocker visual delta', () => {
    const out = evaluate({
      viewports: [viewport('desktop', [ok()])],
      visualDeltas: [{ viewport: 'desktop', severity: 'blocker', note: 'CTA misplaced' }],
    });
    expect(out.verdict).toBe('FAIL');
  });

  it('records a non-blocker visual delta without failing', () => {
    const out = evaluate({
      viewports: [viewport('desktop', [ok()])],
      visualDeltas: [{ viewport: 'desktop', severity: 'minor', note: '1px off' }],
    });
    expect(out.verdict).toBe('PASS');
    expect(out.minor).toHaveLength(1);
  });

  it('fails on console errors and failed requests', () => {
    expect(evaluate({
      viewports: [{ name: 'desktop', rows: [ok()], consoleErrors: 1 }],
    }).verdict).toBe('FAIL');
    expect(evaluate({
      viewports: [{ name: 'desktop', rows: [ok()], networkFailures: 2 }],
    }).verdict).toBe('FAIL');
  });

  it('fails on an unresolved token', () => {
    const out = evaluate({
      viewports: [{
        name: 'desktop',
        rows: [ok()],
        tokens: [{
          element: '.teaser-title',
          property: 'color',
          expected: 'var(--heading-color)',
          resolved: 'rgb(0, 0, 0)',
          match: false,
        }],
      }],
    });
    expect(out.verdict).toBe('FAIL');
  });

  it('fails on a failed gate', () => {
    const out = evaluate({
      viewports: [viewport('desktop', [ok()])],
      gates: { lint: 'fail' },
    });
    expect(out.verdict).toBe('FAIL');
    expect(out.blockers[0]).toContain('lint gate failed');
  });
});

describe('evaluate — rule 2: inherited rows have no override to be wrong about', () => {
  it('does not fail on a mismatch in a row marked inherited', () => {
    // The Layout Matrix says "unchanged from 768px" here, so this breakpoint
    // sets nothing. A difference is information, not a defect.
    const row = { ...bad('blocker'), inherited: true };
    const out = evaluate({ viewports: [viewport('desktop', [row])] });
    expect(out.verdict).toBe('PASS');
    expect(out.minor[0]).toContain('inherited row');
  });

  it('still fails the same mismatch when the breakpoint does set the property', () => {
    const out = evaluate({ viewports: [viewport('desktop', [bad('blocker')])] });
    expect(out.verdict).toBe('FAIL');
  });
});

describe('evaluate — rule 3: minor drift fails only when it recurs', () => {
  it('passes a minor delta at one viewport', () => {
    const out = evaluate({ viewports: [viewport('desktop', [bad('minor')])] });
    expect(out.verdict).toBe('PASS');
    expect(out.minor).toHaveLength(1);
  });

  it('fails the same container and property drifting at the threshold', () => {
    const out = evaluate({
      viewports: [
        viewport('tablet', [bad('minor')]),
        viewport('desktop', [bad('minor')]),
      ],
    });
    expect(out.verdict).toBe('FAIL');
    expect(out.blockers[0]).toContain('systematic, not rounding');
  });

  it('does not aggregate across different properties', () => {
    // Two unrelated one-off roundings are not a systematic offset.
    const out = evaluate({
      viewports: [
        viewport('tablet', [bad('minor', '.teaser-inner', 'gap')]),
        viewport('desktop', [bad('minor', '.teaser-inner', 'padding')]),
      ],
    });
    expect(out.verdict).toBe('PASS');
  });

  it('does not aggregate across different containers', () => {
    const out = evaluate({
      viewports: [
        viewport('tablet', [bad('minor', '.teaser-inner')]),
        viewport('desktop', [bad('minor', '.teaser-cta')]),
      ],
    });
    expect(out.verdict).toBe('PASS');
  });

  it('counts viewports, and the threshold is the documented one', () => {
    expect(RECURRENCE_THRESHOLD).toBe(2);
    const viewports = Array.from({ length: RECURRENCE_THRESHOLD - 1 }, (_, i) => viewport(`vp${i}`, [bad('minor')]));
    expect(evaluate({ viewports }).verdict).toBe('PASS');
    viewports.push(viewport('one-more', [bad('minor')]));
    expect(evaluate({ viewports }).verdict).toBe('FAIL');
  });
});

describe('evaluate — unusable evidence throws rather than returning a verdict', () => {
  // A gate that cannot evaluate its input must not emit a verdict. PASS would
  // be dangerous and FAIL would be a lie; throwing is the only honest option,
  // and cli.mjs maps it to its own exit code.
  it('throws when viewports is empty, because nothing was verified', () => {
    expect(() => evaluate({ viewports: [] })).toThrow(EvidenceError);
  });

  it('throws when viewports is missing or not an array', () => {
    expect(() => evaluate({})).toThrow(EvidenceError);
    expect(() => evaluate({ viewports: 'desktop' })).toThrow(EvidenceError);
  });

  it('throws on junk input', () => {
    [null, undefined, 'nonsense', 42, []].forEach((input) => {
      expect(() => evaluate(input)).toThrow(EvidenceError);
    });
  });

  it('throws when a viewport has no name', () => {
    expect(() => evaluate({ viewports: [{ rows: [] }] })).toThrow(EvidenceError);
  });

  it('throws on an unrecognised gate status rather than ignoring it', () => {
    expect(() => evaluate({
      viewports: [viewport('desktop', [ok()])],
      gates: { lint: 'maybe' },
    })).toThrow(EvidenceError);
  });

  it('never returns a verdict that is neither PASS nor FAIL', () => {
    // The invariant, asserted over a spread of shapes rather than trusting
    // that every branch was covered above.
    const cases = [
      { viewports: [viewport('a', [ok()])] },
      { viewports: [viewport('a', [bad('blocker')])] },
      { viewports: [viewport('a', [bad('minor')])] },
      { viewports: [viewport('a', [{ ...bad('blocker'), inherited: true }])] },
      { viewports: [{ name: 'a' }] },
      { viewports: [{ name: 'a', rows: [] }] },
      { viewports: [{ name: 'a', rows: [{ container: '.x', results: [] }] }] },
    ];
    cases.forEach((input) => {
      expect(['PASS', 'FAIL']).toContain(evaluate(input).verdict);
    });
  });
});

describe('evaluate — rule 4: runtime checks are rules, not prose', () => {
  it('passes when every runtime check ran clean', () => {
    const out = evaluateRaw(withRuntime({}));
    expect(out.verdict).toBe('PASS');
    expect(out.runtime.axeViolations).toBe(0);
    expect(out.runtime.cls).toBe(0.02);
  });

  it('fails on any axe violation inside the block', () => {
    const out = evaluateRaw(withRuntime({
      axe: { status: 'ran', runs: [{ viewport: 'mobile', theme: 'dark', violations: [{ id: 'color-contrast', impact: 'serious', nodes: ['.cta'] }] }] },
    }));
    expect(out.verdict).toBe('FAIL');
    expect(out.blockers[0]).toContain('color-contrast');
    expect(out.blockers[0]).toContain('mobile/dark');
    expect(out.runtime.axeViolations).toBe(1);
    expect(out.failedChecks).toEqual(['axe']);
  });

  it('fails when axe did not load — an unmeasured check is not a passed check', () => {
    const out = evaluateRaw(withRuntime({ axe: { status: 'not_loaded' } }));
    expect(out.verdict).toBe('FAIL');
    expect(out.runtime.axeViolations).toBeNull();
  });

  it('fails when axe found no block to scan', () => {
    expect(evaluateRaw(withRuntime({ axe: { status: 'block_not_found' } })).verdict).toBe('FAIL');
  });

  it('records axe incomplete items for manual review without failing', () => {
    const out = evaluateRaw(withRuntime({
      axe: { status: 'ran', runs: [{ viewport: 'desktop', violations: [], incomplete: 2 }] },
    }));
    expect(out.verdict).toBe('PASS');
    expect(out.minor.join('\n')).toContain('2 incomplete');
  });

  it.each(['reachedInOrder', 'visibleFocus', 'noTrap'])('fails when keyboard %s is false', (key) => {
    const out = evaluateRaw(withRuntime({ keyboard: { ...RUNTIME_OK.keyboard, [key]: false } }));
    expect(out.verdict).toBe('FAIL');
    expect(out.failedChecks).toEqual(['keyboard']);
  });

  it('pins the CLS threshold at 0.1', () => {
    // The literal is the contract (docs/TESTING.md rule 1). Raising it makes
    // every test greener and the gate blinder.
    expect(CLS_THRESHOLD).toBe(0.1);
  });

  it('passes CLS exactly at the threshold and fails just above it', () => {
    const perf = (cls) => ({ performance: { status: 'ran', cls, clsInsideBlock: true } });
    expect(evaluateRaw(withRuntime(perf(0.1))).verdict).toBe('PASS');
    expect(evaluateRaw(withRuntime(perf(0.11))).verdict).toBe('FAIL');
  });

  it('fails a high CLS nobody attributed, and records one attributed outside the block', () => {
    const unattributed = evaluateRaw(withRuntime({ performance: { status: 'ran', cls: 0.3, clsInsideBlock: null } }));
    expect(unattributed.verdict).toBe('FAIL');
    expect(unattributed.blockers[0]).toContain('not attributed');

    const outside = evaluateRaw(withRuntime({ performance: { status: 'ran', cls: 0.3, clsInsideBlock: false } }));
    expect(outside.verdict).toBe('PASS');
    expect(outside.minor.join('\n')).toContain('outside the block');
  });

  it('fails a lazy first-section image', () => {
    const out = evaluateRaw(withRuntime({ performance: { status: 'ran', cls: 0, firstSectionImageLazy: true } }));
    expect(out.verdict).toBe('FAIL');
    expect(out.failedChecks).toEqual(['lazy-image']);
  });

  it('never lets LCP or Lighthouse decide the verdict', () => {
    const out = evaluateRaw(withRuntime({
      performance: { status: 'ran', cls: 0, lcpMs: 99999 },
      lighthouse: { mobile: 0.1, desktop: 0.1 },
    }));
    expect(out.verdict).toBe('PASS');
    expect(out.minor.join('\n')).toMatch(/LCP 99999ms/);
    expect(out.minor.join('\n')).toMatch(/Lighthouse/);
  });

  it('records a skipped check as not measured, never as passed', () => {
    const out = evaluateRaw(withRuntime({
      axe: { status: 'skipped' }, keyboard: { status: 'skipped' }, performance: { status: 'skipped' },
    }));
    expect(out.verdict).toBe('PASS');
    expect(out.minor.filter((m) => m.includes('not measured, not passed'))).toHaveLength(3);
    expect(out.runtime).toMatchObject({ axeViolations: null, cls: null });
  });

  it('names the failed checks in first-seen order', () => {
    const out = evaluateRaw({
      viewports: [{ name: 'desktop', rows: [bad('blocker')], consoleErrors: 1 }],
      gates: { lint: 'fail' },
      runtime: { ...RUNTIME_OK, axe: { status: 'not_loaded' } },
    });
    expect(out.failedChecks).toEqual(['layout-matrix', 'console', 'lint', 'axe']);
  });
});

describe('evaluate — missing runtime evidence is unevaluable, not a pass', () => {
  const base = { viewports: [{ name: 'desktop', rows: [] }] };

  it('throws when the runtime section is absent', () => {
    expect(() => evaluateRaw(base)).toThrow(/runtime is missing/);
  });

  it.each(['axe', 'keyboard', 'performance'])('throws when %s has no status', (key) => {
    expect(() => evaluateRaw({ ...base, runtime: { ...RUNTIME_OK, [key]: {} } })).toThrow(EvidenceError);
  });

  it('throws when axe claims to have run but recorded nothing', () => {
    expect(() => evaluateRaw({ ...base, runtime: { ...RUNTIME_OK, axe: { status: 'ran', runs: [] } } }))
      .toThrow(/no runs/);
  });

  it('throws when the keyboard pass ran but a result is not a boolean', () => {
    const keyboard = { status: 'ran', reachedInOrder: true, visibleFocus: 'yes', noTrap: true };
    expect(() => evaluateRaw({ ...base, runtime: { ...RUNTIME_OK, keyboard } })).toThrow(/visibleFocus/);
  });

  it.each([undefined, null, -0.1, Number.NaN, '0.02'])('throws when the trace ran and cls is %s', (cls) => {
    const performance = { status: 'ran', cls };
    expect(() => evaluateRaw({ ...base, runtime: { ...RUNTIME_OK, performance } })).toThrow(/cls/);
  });
});

describe('formatReport', () => {
  it('states the verdict first', () => {
    const out = evaluate({ viewports: [viewport('desktop', [ok()])] });
    expect(formatReport(out)).toMatch(/^\*\*Verdict\*\*: PASS/);
  });

  it('lists blockers and a remediation checkbox per blocker', () => {
    const out = evaluate({ viewports: [viewport('desktop', [bad('blocker')])] });
    const report = formatReport(out, { block: 'teaser', date: '2026-09-30' });
    expect(report).toContain('## Blockers');
    expect(report).toContain('## Remediation');
    expect(report).toContain('- [ ] Fix —');
    expect(report).toContain('**Block**: teaser');
  });

  it('omits empty sections', () => {
    const out = evaluate({ viewports: [viewport('desktop', [ok()])] });
    const report = formatReport(out);
    expect(report).not.toContain('## Blockers');
    expect(report).not.toContain('## Remediation');
  });

  it('always states what the runtime checks measured', () => {
    const ran = formatReport(evaluateRaw(withRuntime({})));
    expect(ran).toContain('## Accessibility & performance');
    expect(ran).toContain('0 violation(s) inside the block');
    expect(ran).toContain('CLS: 0.02');

    const skipped = formatReport(evaluateRaw(withRuntime({ axe: { status: 'not_loaded' }, performance: { status: 'skipped' } })));
    expect(skipped).toContain('axe-core: not_loaded');
    expect(skipped).toContain('CLS: skipped');
  });
});
