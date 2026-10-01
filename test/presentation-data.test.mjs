import { readFileSync, readdirSync } from 'node:fs';
import { createContext, runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';

// agentic-workflow/data.js is a declarative model whose cross-references break
// silently. A FILES entry pointing at a DIAGRAM id that no longer exists
// renders a selection that highlights nothing; a LAYERS entry no node
// references renders a toggle that does nothing. Both look fine on the page.
//
// data.js is a plain browser script with top-level `const` and no exports, and
// it stays that way: it is evaluated in a vm context here and the globals are
// lifted out. Nothing in agentic-workflow/ is modified to make it testable,
// so the page keeps its no-build, no-dependency property.

const source = readFileSync(new URL('../agentic-workflow/data.js', import.meta.url), 'utf8');

const context = createContext({});
runInNewContext(`${source}\n;globalThis.__model = {
  LAYERS, BASE_LAYERS, EXTENDED_LAYERS, DEFAULT_LAYERS, KIND_LEGEND,
  STAGES, PHASES, FILES, DIAGRAM, SEGMENTS, BUDGET, COMPACT_AT,
};`, context);

const {
  LAYERS, BASE_LAYERS, EXTENDED_LAYERS, DEFAULT_LAYERS,
  STAGES, PHASES, FILES, DIAGRAM, SEGMENTS, BUDGET, COMPACT_AT,
} = context.__model;

const diagramIds = new Set(DIAGRAM.map((n) => n.id));
const layerIds = new Set([...LAYERS.map((l) => l.id), ...DEFAULT_LAYERS.map((l) => l.id)]);
const phaseNumbers = new Set(PHASES.map((p) => p.n));
const stageNumbers = new Set(STAGES.map((s) => s.n));

describe('the model loads', () => {
  it('exposes every collection the renderers read', () => {
    [LAYERS, DEFAULT_LAYERS, STAGES, PHASES, FILES, DIAGRAM, SEGMENTS]
      .forEach((collection) => {
        expect(Array.isArray(collection)).toBe(true);
        expect(collection.length).toBeGreaterThan(0);
      });
    expect(typeof BUDGET).toBe('number');
    expect(typeof COMPACT_AT).toBe('number');
  });
});

describe('FILES', () => {
  it('has unique paths', () => {
    const paths = FILES.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('only references diagram nodes that exist', () => {
    // The failure this catches: clicking the file highlights nothing, with no
    // error anywhere.
    const dangling = FILES
      .filter((f) => f.node !== undefined && !diagramIds.has(f.node))
      .map((f) => `${f.path} → ${f.node}`);
    expect(dangling).toEqual([]);
  });

  it('only appears at a stage the stepper renders', () => {
    const outOfRange = FILES
      .filter((f) => !stageNumbers.has(f.stage))
      .map((f) => `${f.path} @ stage ${f.stage}`);
    expect(outOfRange).toEqual([]);
  });

  it('gives every file a status badge and a title', () => {
    FILES.forEach((f) => {
      expect(f.status, f.path).toBeTruthy();
      expect(f.title, f.path).toBeTruthy();
    });
  });
});

describe('DIAGRAM', () => {
  it('has unique node ids', () => {
    const ids = DIAGRAM.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every node in a phase the board renders', () => {
    const orphans = DIAGRAM
      .filter((n) => n.phase !== undefined && !phaseNumbers.has(n.phase))
      .map((n) => `${n.id} @ phase ${n.phase}`);
    expect(orphans).toEqual([]);
  });

  it('only binds nodes to layers that exist', () => {
    // A node bound to a removed layer is unreachable: no toggle can show it.
    const unknown = DIAGRAM
      .filter((n) => n.layer !== undefined && !layerIds.has(n.layer))
      .map((n) => `${n.id} → ${n.layer}`);
    expect(unknown).toEqual([]);
  });

  it('uses only the two documented visibility modes', () => {
    const bad = DIAGRAM
      .filter((n) => n.mode !== undefined && !['base', 'extended'].includes(n.mode))
      .map((n) => `${n.id} → ${n.mode}`);
    expect(bad).toEqual([]);
  });

  it('uses only documented modes on chips too', () => {
    const bad = [];
    DIAGRAM.forEach((n) => {
      (n.chips ?? []).forEach((chip) => {
        if (chip.mode !== undefined && !['base', 'extended'].includes(chip.mode)) {
          bad.push(`${n.id} chip → ${chip.mode}`);
        }
      });
    });
    expect(bad).toEqual([]);
  });

  it('gives every node a title', () => {
    DIAGRAM.forEach((n) => expect(n.title, n.id).toBeTruthy());
  });
});

describe('LAYERS', () => {
  it('declares no layer that nothing uses', () => {
    // A dead toggle is worse than a missing one: it invites the reader to
    // click something that cannot change the picture.
    const used = new Set(DIAGRAM.map((n) => n.layer).filter(Boolean));
    const usedBySegments = new Set();
    // SEGMENTS predicates close over layer ids; probe them rather than parse.
    LAYERS.forEach((layer) => {
      const base = { stage: STAGES.length - 1, layers: {}, fill: 50 };
      const off = SEGMENTS.filter((s) => s.when({
        ...base,
        layers: Object.fromEntries(LAYERS.map((l) => [l.id, 'off'])),
      })).length;
      const on = SEGMENTS.filter((s) => s.when({
        ...base,
        layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.id === layer.id ? 'extended' : 'off'])),
      })).length;
      if (on !== off) usedBySegments.add(layer.id);
    });

    const dead = LAYERS
      .map((l) => l.id)
      .filter((id) => !used.has(id) && !usedBySegments.has(id));
    expect(dead).toEqual([]);
  });

  it('has unique ids and a label, kind and hint for each', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    LAYERS.forEach((l) => {
      expect(l.label, l.id).toBeTruthy();
      expect(l.kind, l.id).toBeTruthy();
      expect(l.hint, l.id).toBeTruthy();
    });
  });

  it('keeps the base preset a subset of the extended preset', () => {
    BASE_LAYERS.forEach((id) => expect(EXTENDED_LAYERS).toContain(id));
  });

  it('names only real layers in both presets', () => {
    [...BASE_LAYERS, ...EXTENDED_LAYERS].forEach((id) => {
      expect(LAYERS.map((l) => l.id)).toContain(id);
    });
  });
});

describe('SEGMENTS and the context budget', () => {
  it('fits inside the budget with every layer fully enabled', () => {
    // If the fixed prefix exceeded BUDGET the gauge would render a negative
    // headroom and the page would silently claim an impossible figure.
    const all = Object.fromEntries(LAYERS.map((l) => [l.id, 'extended']));
    const total = SEGMENTS
      .filter((s) => s.when({ stage: STAGES.length - 1, layers: all, fill: 0 }))
      .reduce((sum, s) => sum + s.tokens, 0);
    expect(total).toBeLessThan(BUDGET);
  });

  it('never shrinks as stages advance', () => {
    // Every stage adds files; none removes them. A segment predicate that
    // regressed would show the cached prefix getting cheaper over time.
    const all = Object.fromEntries(LAYERS.map((l) => [l.id, 'extended']));
    const totals = STAGES.map((s) => SEGMENTS
      .filter((seg) => seg.when({ stage: s.n, layers: all, fill: 0 }))
      .reduce((sum, seg) => sum + seg.tokens, 0));
    totals.forEach((total, i) => {
      if (i > 0) expect(total).toBeGreaterThanOrEqual(totals[i - 1]);
    });
  });

  it('has unique ids and a positive token cost each', () => {
    const ids = SEGMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    SEGMENTS.forEach((s) => expect(s.tokens, s.id).toBeGreaterThan(0));
  });

  it('puts the compaction threshold inside the gauge range', () => {
    expect(COMPACT_AT).toBeGreaterThan(0);
    expect(COMPACT_AT).toBeLessThan(100);
  });
});

describe('the file tree covers what the skills actually write', () => {
  // This group exists because the tree silently fell behind. design.matrix.json
  // and evidence.json were added to the skills and not to FILES, so the
  // presentation showed a pipeline producing artifacts it never mentioned — and
  // the referential-integrity checks above all passed, because a *missing*
  // entry breaks no reference.
  //
  // The check runs both ways: an artifact named here must be written by a skill
  // AND must appear in the tree. Listing something the pack does not produce
  // fails just as loudly as omitting something it does.
  const ARTIFACTS = [
    'design.md',
    'design.matrix.json',
    'evidence.json',
    'report.md',
    'figma-',
    'browser-',
    'snapshot-',
    'preflight.mjs',
    'artifact-check.mjs',
    'report-guard.mjs',
    'verdict-stop.mjs',
    'settings.json',
  ];

  const skillSources = ['figma-specify', 'figma-screenshot', 'figma-validate']
    .map((name) => readFileSync(
      new URL(`../skills/${name}/SKILL.md`, import.meta.url),
      'utf8',
    ))
    .join('\n');

  it.each(ARTIFACTS)('%s is described by a skill', (artifact) => {
    expect(skillSources).toContain(artifact);
  });

  it.each(ARTIFACTS)('%s appears in the presentation file tree', (artifact) => {
    const paths = FILES.map((f) => f.path);
    expect(paths.some((p) => p.includes(artifact))).toBe(true);
  });

  it('shows every hook script the pack ships, and nothing it does not', () => {
    // The hooks directory is the source of truth. A script added there and not
    // to FILES leaves the page describing a pack with fewer guards than it has;
    // a tree entry with no script behind it describes a guard that does not exist.
    const shipped = readdirSync(new URL('../skills/figma-validate/hooks/', import.meta.url))
      .filter((f) => f.endsWith('.mjs') && f !== 'stdin.mjs')
      .sort();
    const shown = FILES
      .map((f) => f.path)
      .filter((path) => path.startsWith('.claude/skills/figma-validate/hooks/'))
      .map((path) => path.split('/').pop())
      .sort();
    expect(shown).toEqual(shipped);
  });

  it('binds every hook file to a node in the hooks layer', () => {
    const hookNodes = DIAGRAM.filter((n) => n.layer === 'hooks').map((n) => n.id);
    expect(hookNodes.length).toBeGreaterThanOrEqual(4);
    FILES.filter((f) => f.path.includes('/hooks/')).forEach((f) => {
      expect(hookNodes, f.path).toContain(f.node);
    });
  });

  it('explains every artifact it shows, like package.json does', () => {
    // A file in the tree with no desc renders an empty detail pane, which is
    // worse than not listing it.
    FILES.forEach((f) => {
      expect(f.desc, f.path).toBeTruthy();
      expect(f.desc.length, f.path).toBeGreaterThan(40);
    });
  });
});

describe('STAGES', () => {
  it('is numbered contiguously from zero', () => {
    expect(STAGES.map((s) => s.n)).toEqual(STAGES.map((_, i) => i));
  });

  it('gives every stage a label and caption', () => {
    STAGES.forEach((s) => {
      expect(s.label, String(s.n)).toBeTruthy();
      expect(s.caption, String(s.n)).toBeTruthy();
    });
  });
});
