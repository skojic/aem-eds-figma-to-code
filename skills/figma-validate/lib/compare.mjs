/**
 * Style comparison for the figma-validate gate.
 *
 * Pure: no DOM, no filesystem, no config. Takes an expected declaration from
 * the Layout Matrix and a computed reading from the browser, returns a verdict
 * for that one property.
 *
 * Two kinds of bad input are treated differently on purpose:
 *
 *   - An unparseable **expected** value is a defect in `design.md`. It throws,
 *     because continuing would validate the implementation against a spec
 *     nobody can read.
 *   - An unparseable **computed** value is a blocker failure, not a throw. We
 *     could not verify the property, and "could not verify" must never
 *     resolve to PASS. Failing one row beats aborting the whole run over a
 *     single odd reading.
 *
 * Neither case is allowed to produce a match.
 */

/** Spacing delta tolerated before a mismatch is a blocker, in px. */
export const MINOR_PX_TOLERANCE = 2;

/** Properties compared as keywords rather than lengths. */
const KEYWORD_PROPS = new Set([
  'flex-direction',
  'display',
  'justify-content',
  'align-items',
  'flex-wrap',
]);

/** Properties compared as lengths. */
const LENGTH_PROPS = new Set([
  'gap',
  'row-gap',
  'column-gap',
  'padding',
  'margin',
  'font-size',
]);

/** Thrown when `design.md` itself cannot be read. Distinct from a failed check. */
export class SpecError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SpecError';
  }
}

/**
 * Splits a declaration string into property/value pairs.
 * Accepts the Layout Matrix cell form: `flex-direction: row; gap: 32px`.
 *
 * @param {string} text
 * @returns {{ prop: string, value: string }[]}
 */
export function parseDeclarations(text) {
  if (typeof text !== 'string') {
    throw new SpecError(`expected a declaration string, received ${typeof text}`);
  }
  const trimmed = text.trim().replace(/^`|`$/g, '').trim();
  if (trimmed === '') return [];

  return trimmed
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx === -1) {
        throw new SpecError(`declaration "${part}" has no colon`);
      }
      const prop = part.slice(0, idx).trim().toLowerCase();
      const value = part.slice(idx + 1).trim();
      if (prop === '' || value === '') {
        throw new SpecError(`declaration "${part}" is incomplete`);
      }
      return { prop, value };
    });
}

/**
 * Resolves a CSS length to pixels.
 *
 * `null` means "not a length we can reason about" — the caller decides whether
 * that is a spec defect or an unverifiable reading.
 *
 * @param {string} value
 * @param {{ rootFontSize?: number }} [options]
 * @returns {number | null}
 */
export function toPx(value, options = {}) {
  const { rootFontSize = 16 } = options;
  if (typeof value !== 'string') return null;

  const v = value.trim().toLowerCase();

  // `gap: normal` is the computed value when no gap is set. It lays out
  // identically to a zero gap, so the spec may legitimately say either.
  if (v === 'normal') return 0;

  // Unitless zero is the one unitless length CSS allows.
  if (/^0(\.0+)?$/.test(v)) return 0;

  const match = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(v);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;

  // `em` resolves against the element's own font size, which a computed-style
  // reading has already done. Treating it as rem here would be wrong, so an
  // `em` in the *spec* is refused rather than guessed at.
  if (match[2] === 'em') return null;

  return match[2] === 'rem' ? n * rootFontSize : n;
}

/**
 * Canonicalises a keyword value.
 *
 * The `flex-flow` shorthand means a computed `flex-direction` reading can
 * arrive as `row nowrap`. The first token is the direction.
 *
 * @param {string} prop
 * @param {string} value
 * @returns {string | null}
 */
export function toKeyword(prop, value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (v === '') return null;

  if (prop === 'flex-direction') {
    const first = v.split(' ')[0] ?? '';
    return ['row', 'column', 'row-reverse', 'column-reverse'].includes(first) ? first : null;
  }
  return v;
}

/**
 * Compares one expected declaration against its computed reading.
 *
 * @param {string} prop
 * @param {string} expected value from `design.md`
 * @param {string | null | undefined} computed value read from the browser
 * @param {{ rootFontSize?: number }} [options]
 * @returns {{
 *   prop: string, expected: string, computed: string | null,
 *   match: boolean, severity: 'blocker' | 'minor' | null, reason: string | null
 * }}
 */
export function compareDeclaration(prop, expected, computed, options = {}) {
  const key = String(prop).trim().toLowerCase();
  const computedValue = (computed === null || computed === undefined) ? null : String(computed);

  /** @param {string} reason */
  const unverifiable = (reason) => ({
    prop: key,
    expected,
    computed: computedValue,
    match: false,
    severity: /** @type {'blocker'} */ ('blocker'),
    reason,
  });

  if (computedValue === null || computedValue.trim() === '') {
    return unverifiable('no computed value was captured for this property');
  }

  if (KEYWORD_PROPS.has(key)) {
    const want = toKeyword(key, expected);
    if (want === null) {
      throw new SpecError(`expected value "${expected}" is not valid for ${key}`);
    }
    const got = toKeyword(key, computedValue);
    if (got === null) return unverifiable(`computed value "${computedValue}" is not a valid ${key}`);

    return {
      prop: key,
      expected,
      computed: computedValue,
      match: got === want,
      severity: got === want ? null : 'blocker',
      reason: got === want ? null : `expected ${want}, computed ${got}`,
    };
  }

  if (LENGTH_PROPS.has(key)) {
    const want = toPx(expected, options);
    if (want === null) {
      throw new SpecError(
        `expected value "${expected}" for ${key} is not a px, rem or zero length`,
      );
    }
    const got = toPx(computedValue, options);
    if (got === null) {
      return unverifiable(`computed value "${computedValue}" is not a resolvable length`);
    }

    const delta = Math.abs(got - want);
    if (delta === 0) {
      return {
        prop: key, expected, computed: computedValue, match: true, severity: null, reason: null,
      };
    }
    // A sub-pixel or rounding-scale difference is recorded but is not on its
    // own a blocker — verdict.mjs decides whether it recurs often enough to
    // fail the run.
    const severity = delta <= MINOR_PX_TOLERANCE ? 'minor' : 'blocker';
    return {
      prop: key,
      expected,
      computed: computedValue,
      match: false,
      severity,
      reason: `expected ${want}px, computed ${got}px (${delta.toFixed(2)}px out)`,
    };
  }

  // An unrecognised property is a spec problem: the gate cannot silently
  // ignore a row an author wrote and expects to be checked.
  throw new SpecError(`property "${key}" is not compared by this gate`);
}

/**
 * Compares every declaration for one Layout Matrix row at one breakpoint.
 *
 * @param {{ container: string, breakpoint: string, declarations: string }} row
 * @param {Record<string, string>} computedStyles camelCase or kebab-case keys
 * @param {{ rootFontSize?: number }} [options]
 * @returns {{ container: string, breakpoint: string, results: ReturnType<typeof compareDeclaration>[] }}
 */
export function compareRow(row, computedStyles, options = {}) {
  if (!row || typeof row !== 'object') throw new SpecError('row is missing');
  const { container, breakpoint, declarations } = row;
  if (!container) throw new SpecError('row is missing a container');

  const styles = computedStyles && typeof computedStyles === 'object' ? computedStyles : {};
  /** @param {string} prop @returns {string | undefined} */
  const lookup = (prop) => {
    const camel = prop.replace(/-([a-z])/g, (/** @type {string} */ _, /** @type {string} */ c) => c.toUpperCase());
    return styles[prop] ?? styles[camel];
  };

  const results = parseDeclarations(declarations)
    .map(({ prop, value }) => compareDeclaration(prop, value, lookup(prop), options));

  return { container, breakpoint, results };
}
