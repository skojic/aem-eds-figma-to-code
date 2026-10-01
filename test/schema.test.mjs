import { describe, it, expect } from 'vitest';
import { validateEvidence, validateMatrix } from '../skills/figma-validate/lib/schema.mjs';
import { FAILING_EVIDENCE, MATRIX, PASSING_EVIDENCE } from './helpers/project.mjs';

const clone = (v) => structuredClone(v);

describe('validateMatrix', () => {
  it('accepts the documented sidecar shape', () => {
    expect(validateMatrix(MATRIX)).toEqual([]);
  });

  it.each([
    ['not an object', [], /JSON object/],
    ['no rows', { ...MATRIX, rows: [] }, /verifies nothing/],
    ['no breakpoints', { ...MATRIX, breakpoints: [] }, /breakpoints/],
  ])('rejects %s', (_label, input, pattern) => {
    expect(validateMatrix(input).join('\n')).toMatch(pattern);
  });

  it('rejects a row whose breakpoint matches no declared min', () => {
    const m = clone(MATRIX);
    m.rows[0].breakpoint = '999';
    expect(validateMatrix(m).join('\n')).toMatch(/matches no min/);
  });

  it('rejects an inherited row that carries values', () => {
    // Copying values down asserts an override the CSS does not make.
    const m = clone(MATRIX);
    m.rows[1].declarations = 'gap: 24px';
    expect(validateMatrix(m).join('\n')).toMatch(/inherited but has declarations/);
  });

  it('rejects a non-inherited row with nothing to check', () => {
    const m = clone(MATRIX);
    m.rows[0].declarations = '  ';
    expect(validateMatrix(m).join('\n')).toMatch(/empty declarations/);
  });

  it('reports every problem in one pass', () => {
    const m = clone(MATRIX);
    m.rows[0].container = '';
    m.rows[1].declarations = 'gap: 1px';
    expect(validateMatrix(m).length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateEvidence', () => {
  it('accepts passing and failing evidence', () => {
    expect(validateEvidence(PASSING_EVIDENCE)).toEqual([]);
    expect(validateEvidence(FAILING_EVIDENCE)).toEqual([]);
  });

  it('rejects empty viewports — nothing was verified', () => {
    expect(validateEvidence({ viewports: [] }).join()).toMatch(/nothing was verified/);
  });

  it('rejects a mismatch with no usable severity', () => {
    const e = clone(FAILING_EVIDENCE);
    e.viewports[0].rows[0].results[0].severity = null;
    expect(validateEvidence(e).join('\n')).toMatch(/severity/);
  });

  it('rejects a match that is not a boolean', () => {
    // "false" the string is truthy in careless code; the shape check must catch it.
    const e = clone(PASSING_EVIDENCE);
    e.viewports[0].rows[0].results[0].match = 'false';
    expect(validateEvidence(e).join('\n')).toMatch(/match must be a boolean/);
  });

  it('rejects an unrecognised gate status', () => {
    expect(validateEvidence({ ...PASSING_EVIDENCE, gates: { lint: 'ok' } }).join()).toMatch(/gates\.lint/);
  });

  it('rejects a non-numeric console count', () => {
    const e = clone(PASSING_EVIDENCE);
    e.viewports[0].consoleErrors = '0';
    expect(validateEvidence(e).join()).toMatch(/consoleErrors/);
  });
});
