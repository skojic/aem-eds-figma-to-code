import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every runtime check ran and found nothing. */
export const RUNTIME_OK = {
  axe: { status: 'ran', runs: [{ viewport: 'mobile', violations: [], incomplete: 0 }, { viewport: 'desktop', violations: [], incomplete: 0 }] },
  keyboard: { status: 'ran', reachedInOrder: true, visibleFocus: true, noTrap: true },
  performance: { status: 'ran', cls: 0.02, clsInsideBlock: null, lcpMs: 1800, firstSectionImageLazy: false },
  lighthouse: { mobile: 0.96, desktop: 0.98 },
};

export const PASSING_EVIDENCE = {
  block: 'teaser',
  viewports: [{
    name: 'desktop',
    rows: [{ container: '.teaser-inner', results: [{ prop: 'gap', match: true, severity: null, reason: null }] }],
  }],
  gates: { lint: 'pass', test: 'skipped' },
  runtime: RUNTIME_OK,
};

export const FAILING_EVIDENCE = {
  block: 'teaser',
  viewports: [{
    name: 'desktop',
    rows: [{ container: '.teaser-inner', results: [{ prop: 'gap', match: false, severity: 'blocker', reason: 'expected 32px, computed 8px' }] }],
  }],
  runtime: RUNTIME_OK,
};

/** Layout is fine; one axe violation inside the block. */
export const AXE_FAILING_EVIDENCE = {
  ...PASSING_EVIDENCE,
  runtime: {
    ...RUNTIME_OK,
    axe: { status: 'ran', runs: [{ viewport: 'desktop', violations: [{ id: 'color-contrast', impact: 'serious', nodes: ['.teaser-cta'] }] }] },
  },
};

export const MATRIX = {
  block: 'teaser',
  breakpoints: [{ name: 'mobile', min: 320 }, { name: 'tablet', min: 768 }],
  rows: [
    { container: '.teaser-inner', breakpoint: '320', declarations: 'flex-direction: column; gap: 24px', inherited: false },
    { container: '.teaser-inner', breakpoint: '768', declarations: '', inherited: true },
  ],
};

export const CONFIG = [
  '# config',
  '```yaml',
  'spec_output_path: "drafts/specs/{ticket}/design.md"',
  '```',
].join('\n');

/**
 * A throwaway project with a complete spec dir for ticket T-1, ready for
 * /figma-validate. Pass `skip` to leave a piece out.
 *
 * @param {{ skip?: string[] }} [options]
 */
export function makeProject({ skip = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'figma-hooks-'));
  const specDir = join(root, 'drafts/specs/T-1');
  mkdirSync(join(specDir, 'validation'), { recursive: true });
  if (!skip.includes('config')) writeFileSync(join(root, 'figma-to-code.config.md'), CONFIG);
  if (!skip.includes('design')) writeFileSync(join(specDir, 'design.md'), '# Spec\n`.teaser-inner` row at tablet\n');
  if (!skip.includes('matrix')) writeFileSync(join(specDir, 'design.matrix.json'), JSON.stringify(MATRIX));
  if (!skip.includes('png')) writeFileSync(join(specDir, 'figma-teaser-desktop.png'), 'png');
  return { root, specDir, validation: join(specDir, 'validation') };
}
