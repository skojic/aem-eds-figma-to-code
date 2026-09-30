import { describe, it, expect } from 'vitest';
import {
  EvidenceError,
  RECURRENCE_THRESHOLD,
  evaluate,
  formatReport,
} from '../skills/figma-validate/lib/verdict.mjs';

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
});
