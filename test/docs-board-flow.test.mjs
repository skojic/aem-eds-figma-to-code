import { readFileSync } from 'node:fs';
import { createContext, runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';

// `docs/workflow.md` describes the three board lanes in prose. That sequence is
// also encoded in `agentic-workflow/data.js` as the order of DIAGRAM entries per
// phase — so the same fact lives in two places and can drift.
//
// The file tree fell behind exactly this way earlier: artifacts were added to
// the skills and not to FILES, every referential-integrity check passed, and the
// page quietly described an older pipeline. Prose is worse, because nothing in it
// is a reference that could break.
//
// The map below is the load-bearing part. A node with no entry fails the suite,
// so adding one to a lane forces a decision about whether the doc should mention
// it. `null` means "deliberately not in the prose" — the prose is a summary, not
// an exhaustive listing, and the extended-only detail nodes do not belong in it.
//
// Tokens are matched as plain substrings and kept deliberately short, so
// rewording a sentence does not break the test while reordering the lane does.

const PROSE_TOKENS = {
  // 01 Specify
  prompt: 'invocation',
  payload: 'request payload',
  'gate-specify': 'pre-flight fail-stops',
  'tool-figma': 'mcp.figma',
  'model-layout': 'layout extraction',
  'out-spec': 'design.matrix.json',
  'sub-tokens': 'token-gap pass',

  // 02 Capture & build
  'step-shot': '/figma-screenshot',
  'tool-figma-img': null,
  'out-shot': 'figma-*.png',
  'human-impl': 'implementation step',

  // 03 Validate
  'step-validate': null,
  'gate-validate': 'pre-flight fail-stops',
  'tool-content': 'content store',
  'tool-browser': 'browser breakpoint loop',
  'sub-diff': 'visual diff',
  'sub-compare': 'computed-style comparison',
  'out-evidence': 'evidence.json',
  'verdict-core': 'lib/cli.mjs',
  verdict: 'PASS / FAIL',
};

/** Lane label in the doc, keyed by phase number. */
const LANE_LABELS = { 1: '01 Specify', 2: '02 Capture & build', 3: '03 Validate' };

const doc = readFileSync(new URL('../docs/workflow.md', import.meta.url), 'utf8');

const context = createContext({});
runInNewContext(
  `${readFileSync(new URL('../agentic-workflow/data.js', import.meta.url), 'utf8')}
   ;globalThis.__m = { DIAGRAM, PHASES };`,
  context,
);
const { DIAGRAM, PHASES } = context.__m;

/**
 * The prose for one lane: from its bold label up to the next blank line, with
 * whitespace collapsed.
 *
 * The collapse is load-bearing. `docs/workflow.md` hard-wraps at roughly 100
 * columns, so "layout extraction" can sit across a line break and a naive
 * substring match misses it — which is exactly how this test failed on its first
 * run. Where a line happens to wrap is a formatting decision and must not change
 * what the test sees.
 *
 * @param {number} phase
 * @returns {string}
 */
function laneProse(phase) {
  const label = LANE_LABELS[phase];
  const start = doc.indexOf(`**${label}**`);
  if (start === -1) throw new Error(`docs/workflow.md has no "**${label}**" lane paragraph`);
  const rest = doc.slice(start);
  const end = rest.indexOf('\n\n');
  const paragraph = end === -1 ? rest : rest.slice(0, end);
  return paragraph.replace(/\s+/g, ' ');
}

const nodesIn = (phase) => DIAGRAM.filter((n) => n.phase === phase);

describe('the token map stays in step with the diagram', () => {
  it('has an entry for every node in a lane', () => {
    // The forcing function: add a node to a lane and this fails until someone
    // decides whether the prose should mention it.
    const missing = DIAGRAM
      .filter((n) => n.phase !== undefined)
      .map((n) => n.id)
      .filter((id) => !(id in PROSE_TOKENS));
    expect(missing).toEqual([]);
  });

  it('has no entry for a node that no longer exists', () => {
    const ids = new Set(DIAGRAM.map((n) => n.id));
    const stale = Object.keys(PROSE_TOKENS).filter((id) => !ids.has(id));
    expect(stale).toEqual([]);
  });

  it('covers every phase the board renders', () => {
    PHASES.forEach((p) => expect(LANE_LABELS[p.n], `phase ${p.n}`).toBeTruthy());
  });
});

describe.each(PHASES.map((p) => p.n))('lane %i in docs/workflow.md', (phase) => {
  const prose = laneProse(phase);
  const documented = nodesIn(phase)
    .map((n) => ({ id: n.id, token: PROSE_TOKENS[n.id] }))
    .filter((e) => e.token !== null && e.token !== undefined);

  it('mentions every node it is meant to', () => {
    const absent = documented
      .filter((e) => !prose.includes(e.token))
      .map((e) => `${e.id} ("${e.token}")`);
    expect(absent).toEqual([]);
  });

  it('mentions them in the order the board draws them', () => {
    // The actual drift this file exists to catch. Reorder two nodes in data.js
    // without touching the doc and this is what fails.
    const positions = documented.map((e) => ({ id: e.id, at: prose.indexOf(e.token) }));
    const sorted = [...positions].sort((a, b) => a.at - b.at);
    expect(sorted.map((p) => p.id)).toEqual(positions.map((p) => p.id));
  });
});

describe('the two artifact-writing steps are called out', () => {
  // These are the nodes that make the architecture legible: the spec plus its
  // sidecar, and the separation of gathering from deciding. If the prose stops
  // naming them the doc still reads fine and stops saying anything.
  it('names the sidecar in lane 1', () => {
    expect(laneProse(1)).toContain('design.matrix.json');
  });

  it('names the evidence file before the verdict tool in lane 3', () => {
    const prose = laneProse(3);
    expect(prose.indexOf('evidence.json')).toBeGreaterThan(-1);
    expect(prose.indexOf('evidence.json')).toBeLessThan(prose.indexOf('lib/cli.mjs'));
  });
});
