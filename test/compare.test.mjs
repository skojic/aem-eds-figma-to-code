import { describe, it, expect } from 'vitest';
import {
  MINOR_PX_TOLERANCE,
  SpecError,
  compareDeclaration,
  compareRow,
  parseDeclarations,
  toKeyword,
  toPx,
} from '../skills/figma-validate/lib/compare.mjs';

describe('toPx', () => {
  it('resolves px', () => {
    expect(toPx('32px')).toBe(32);
    expect(toPx('0.5px')).toBe(0.5);
  });

  it('resolves rem against the root font size', () => {
    expect(toPx('2rem')).toBe(32);
    expect(toPx('2rem', { rootFontSize: 10 })).toBe(20);
  });

  it('treats unitless zero and 0px as the same length', () => {
    expect(toPx('0')).toBe(0);
    expect(toPx('0px')).toBe(0);
    expect(toPx('0.0')).toBe(0);
  });

  it('treats gap: normal as zero', () => {
    // `normal` is what getComputedStyle returns for an unset gap, and it lays
    // out identically to 0. A spec may legitimately write either.
    expect(toPx('normal')).toBe(0);
  });

  it('is whitespace and case insensitive', () => {
    expect(toPx('  32PX  ')).toBe(32);
  });

  it('refuses em, because the browser has already resolved it', () => {
    // Treating em as rem would be silently wrong whenever the element's own
    // font-size differs from the root.
    expect(toPx('2em')).toBeNull();
  });

  it('returns null for values that are not lengths', () => {
    ['auto', 'inherit', '50%', 'row', '', 'abc', '12', null, undefined, 32]
      .forEach((v) => expect(toPx(/** @type {never} */ (v))).toBeNull());
  });
});

describe('toKeyword', () => {
  it('takes the direction out of a flex-flow shorthand reading', () => {
    // getComputedStyle can return "row nowrap" for flex-direction when the
    // shorthand was used. Comparing that string to "row" would fail wrongly.
    expect(toKeyword('flex-direction', 'row nowrap')).toBe('row');
    expect(toKeyword('flex-direction', 'column wrap')).toBe('column');
  });

  it('keeps reverse directions distinct', () => {
    expect(toKeyword('flex-direction', 'row-reverse')).toBe('row-reverse');
    expect(toKeyword('flex-direction', 'row-reverse wrap')).toBe('row-reverse');
  });

  it('rejects a non-direction value for flex-direction', () => {
    expect(toKeyword('flex-direction', 'nowrap')).toBeNull();
    expect(toKeyword('flex-direction', '32px')).toBeNull();
  });

  it('normalises whitespace and case for other keywords', () => {
    expect(toKeyword('justify-content', '  Space-Between ')).toBe('space-between');
  });
});

describe('parseDeclarations', () => {
  it('splits a Layout Matrix cell into pairs', () => {
    expect(parseDeclarations('flex-direction: row; gap: 32px')).toEqual([
      { prop: 'flex-direction', value: 'row' },
      { prop: 'gap', value: '32px' },
    ]);
  });

  it('tolerates the backticks the matrix table wraps cells in', () => {
    expect(parseDeclarations('`gap: 24px`')).toEqual([{ prop: 'gap', value: '24px' }]);
  });

  it('tolerates a trailing semicolon and odd spacing', () => {
    expect(parseDeclarations('  gap:24px ;  ')).toEqual([{ prop: 'gap', value: '24px' }]);
  });

  it('returns nothing for an empty cell', () => {
    expect(parseDeclarations('')).toEqual([]);
    expect(parseDeclarations('   ')).toEqual([]);
  });

  it('throws on a malformed declaration, because the spec is wrong', () => {
    expect(() => parseDeclarations('flex-direction row')).toThrow(SpecError);
    expect(() => parseDeclarations('gap:')).toThrow(SpecError);
    expect(() => parseDeclarations(': 32px')).toThrow(SpecError);
    expect(() => parseDeclarations(/** @type {never} */ (null))).toThrow(SpecError);
  });
});

describe('compareDeclaration — keywords', () => {
  it('matches an equal direction', () => {
    const r = compareDeclaration('flex-direction', 'row', 'row');
    expect(r.match).toBe(true);
    expect(r.severity).toBeNull();
  });

  it('matches through a flex-flow shorthand reading', () => {
    expect(compareDeclaration('flex-direction', 'row', 'row nowrap').match).toBe(true);
  });

  it('blocks on a wrong direction — there is no tolerance for keywords', () => {
    const r = compareDeclaration('flex-direction', 'row', 'column');
    expect(r.match).toBe(false);
    expect(r.severity).toBe('blocker');
    expect(r.reason).toContain('expected row');
  });
});

describe('compareDeclaration — lengths', () => {
  it('tolerates exactly two pixels, and that number is the contract', () => {
    // Pinned as a literal on purpose. The boundary tests below are written
    // relative to MINOR_PX_TOLERANCE, which makes them insensitive to a change
    // in the constant itself — a mutation run proved it. This assertion is the
    // one that fails if the tolerance is widened, and a widened tolerance means
    // the gate silently accepts larger layout drift.
    expect(MINOR_PX_TOLERANCE).toBe(2);
    expect(compareDeclaration('gap', '32px', '34px').severity).toBe('minor');
    expect(compareDeclaration('gap', '32px', '35px').severity).toBe('blocker');
  });

  it('matches equal lengths across units', () => {
    expect(compareDeclaration('gap', '2rem', '32px').match).toBe(true);
    expect(compareDeclaration('gap', '0', 'normal').match).toBe(true);
    expect(compareDeclaration('gap', '0px', '0').match).toBe(true);
  });

  it('records a sub-pixel difference as minor, not a blocker', () => {
    const r = compareDeclaration('gap', '32px', '32.5px');
    expect(r.match).toBe(false);
    expect(r.severity).toBe('minor');
  });

  it('treats a difference at the tolerance boundary as minor', () => {
    const r = compareDeclaration('gap', '32px', `${32 + MINOR_PX_TOLERANCE}px`);
    expect(r.severity).toBe('minor');
  });

  it('treats a difference just past the boundary as a blocker', () => {
    const r = compareDeclaration('gap', '32px', `${32 + MINOR_PX_TOLERANCE + 0.01}px`);
    expect(r.severity).toBe('blocker');
  });

  it('is symmetric about the direction of the difference', () => {
    expect(compareDeclaration('gap', '32px', '48px').severity).toBe('blocker');
    expect(compareDeclaration('gap', '48px', '32px').severity).toBe('blocker');
  });
});

describe('compareDeclaration — unverifiable readings never pass', () => {
  // The distinction this group protects: a bad *spec* is the author's bug and
  // throws; a bad *computed reading* means the gate could not verify, which
  // must fail rather than abort or pass.
  it('fails as a blocker when no computed value was captured', () => {
    [null, undefined, '', '   '].forEach((computed) => {
      const r = compareDeclaration('gap', '32px', /** @type {never} */ (computed));
      expect(r.match).toBe(false);
      expect(r.severity).toBe('blocker');
    });
  });

  it('fails as a blocker when the computed value is not a resolvable length', () => {
    const r = compareDeclaration('gap', '32px', 'auto');
    expect(r.match).toBe(false);
    expect(r.severity).toBe('blocker');
    expect(r.reason).toContain('not a resolvable length');
  });

  it('fails as a blocker when the computed keyword is not valid for the property', () => {
    const r = compareDeclaration('flex-direction', 'row', 'nowrap');
    expect(r.match).toBe(false);
    expect(r.severity).toBe('blocker');
  });

  it('throws when the SPEC value is unusable', () => {
    expect(() => compareDeclaration('gap', 'auto', '32px')).toThrow(SpecError);
    expect(() => compareDeclaration('gap', '2em', '32px')).toThrow(SpecError);
    expect(() => compareDeclaration('flex-direction', 'sideways', 'row')).toThrow(SpecError);
  });

  it('throws on a property it does not know how to compare', () => {
    // Silently ignoring a row an author wrote is the failure mode here: they
    // would believe it was checked.
    expect(() => compareDeclaration('box-shadow', '0 0 4px red', '0 0 4px red'))
      .toThrow(SpecError);
  });
});

describe('compareRow', () => {
  const row = {
    container: '.teaser-inner',
    breakpoint: '1024',
    declarations: 'flex-direction: row; gap: 32px',
  };

  it('reads computed styles given in camelCase', () => {
    const { results } = compareRow(row, { flexDirection: 'row', gap: '32px' });
    expect(results.every((r) => r.match)).toBe(true);
  });

  it('reads computed styles given in kebab-case', () => {
    const { results } = compareRow(row, { 'flex-direction': 'row', gap: '32px' });
    expect(results.every((r) => r.match)).toBe(true);
  });

  it('carries the container and breakpoint through for reporting', () => {
    const out = compareRow(row, { flexDirection: 'row', gap: '32px' });
    expect(out.container).toBe('.teaser-inner');
    expect(out.breakpoint).toBe('1024');
  });

  it('blocks every declaration when no styles were captured at all', () => {
    const { results } = compareRow(row, /** @type {never} */ (null));
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.severity === 'blocker')).toBe(true);
  });

  it('throws when the row itself is malformed', () => {
    expect(() => compareRow(/** @type {never} */ (null), {})).toThrow(SpecError);
    expect(() => compareRow(/** @type {never} */ ({ breakpoint: '1024' }), {})).toThrow(SpecError);
  });
});
