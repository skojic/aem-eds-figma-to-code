import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOG_PATH, main, parseArgs, read, render, runRecord, summarise,
} from '../skills/figma-validate/lib/runlog.mjs';
import { CLS_THRESHOLD, EvidenceError } from '../skills/figma-validate/lib/verdict.mjs';
import {
  AXE_FAILING_EVIDENCE, FAILING_EVIDENCE, PASSING_EVIDENCE, RUNTIME_OK,
} from './helpers/project.mjs';

// These numbers exist to be quoted. A wrong denominator does not crash
// anything — it makes a confident statement false, which is worse.

const run = (ticket, verdict, extra = {}) => ({
  type: 'run', ticket, verdict, at: '2026-10-01T09:00:00.000Z', ...extra,
});
const correction = (type, ticket) => ({
  type, ticket, note: 'review caught it', at: '2026-10-02T09:00:00.000Z',
});
const tmp = () => mkdtempSync(join(tmpdir(), 'runlog-'));

describe('runRecord — rows come from the evidence, not from typing', () => {
  it('derives verdict, axe count and CLS from a passing run', () => {
    const r = runRecord('T-1', PASSING_EVIDENCE, { at: 'x' });
    expect(r).toEqual({ type: 'run', ticket: 'T-1', verdict: 'PASS', a11y: 0, cls: 0.02, at: 'x' });
  });

  it('records the first failing check', () => {
    expect(runRecord('T-1', FAILING_EVIDENCE).check).toBe('layout-matrix');
    expect(runRecord('T-1', AXE_FAILING_EVIDENCE)).toMatchObject({ verdict: 'FAIL', check: 'axe', a11y: 1 });
  });

  it('omits unmeasured checks instead of writing 0', () => {
    // A run where axe never loaded is "not measured". Writing a11y: 0 would
    // count it as a clean run.
    const evidence = {
      ...PASSING_EVIDENCE,
      runtime: { ...RUNTIME_OK, axe: { status: 'not_loaded' }, performance: { status: 'skipped' } },
    };
    const r = runRecord('T-1', evidence);
    expect(r).not.toHaveProperty('a11y');
    expect(r).not.toHaveProperty('cls');
    expect(r.verdict).toBe('FAIL');
  });

  it('refuses evidence the gate cannot evaluate', () => {
    expect(() => runRecord('T-1', { viewports: [] })).toThrow(EvidenceError);
    const { runtime, ...noRuntime } = PASSING_EVIDENCE;
    expect(() => runRecord('T-1', noRuntime)).toThrow(EvidenceError);
  });
});

describe('summarise — empty and degenerate input', () => {
  it('reports zeros and null rates rather than NaN', () => {
    const s = summarise([]);
    expect(s.runs).toBe(0);
    expect(s.passRate).toBeNull();
    expect(s.falsePassRate).toBeNull();
    expect(s.falseFailRate).toBeNull();
    expect(s.medianSec).toBeNull();
    expect(s.firstDay).toBeNull();
  });

  it('does not divide by zero when there are corrections but no runs', () => {
    const s = summarise([correction('false-pass', 'T-1')]);
    expect(s.falsePasses).toBe(1);
    expect(s.falsePassRate).toBeNull();
  });
});

describe('summarise — verdict counts', () => {
  it('counts passes, fails and the pass rate', () => {
    const s = summarise([run('T-1', 'PASS'), run('T-2', 'PASS'), run('T-3', 'PASS'), run('T-4', 'FAIL')]);
    expect(s).toMatchObject({ runs: 4, passes: 3, fails: 1, passRate: 75 });
  });

  it('counts distinct tickets, not runs', () => {
    // Re-running after a fix is normal; conflating the two inflates the sample.
    const s = summarise([run('T-1', 'FAIL'), run('T-1', 'FAIL'), run('T-1', 'PASS')]);
    expect(s.runs).toBe(3);
    expect(s.tickets).toBe(1);
  });

  it('does not count corrections as runs', () => {
    expect(summarise([run('T-1', 'PASS'), correction('false-pass', 'T-1')]).runs).toBe(1);
  });
});

describe('summarise — the rates that matter', () => {
  it('measures false passes against PASSES, not all runs', () => {
    // The load-bearing assertion in this file. 1 of 2 passes is 50%; dividing
    // by all 6 runs would report 17% and understate the control's failure.
    const s = summarise([
      run('T-1', 'PASS'), run('T-2', 'PASS'),
      run('T-3', 'FAIL'), run('T-4', 'FAIL'), run('T-5', 'FAIL'), run('T-6', 'FAIL'),
      correction('false-pass', 'T-1'),
    ]);
    expect(s.falsePassRate).toBe(50);
  });

  it('measures false fails against FAILS', () => {
    const s = summarise([
      run('T-1', 'FAIL'), run('T-2', 'FAIL'), run('T-3', 'FAIL'), run('T-4', 'FAIL'),
      run('T-5', 'PASS'),
      correction('false-fail', 'T-1'),
    ]);
    expect(s.falseFailRate).toBe(25);
  });

  it('keeps the two directions separate and keeps every note', () => {
    const s = summarise([
      run('T-1', 'PASS'), run('T-2', 'FAIL'),
      correction('false-pass', 'T-1'), correction('false-fail', 'T-2'),
    ]);
    expect(s).toMatchObject({ falsePasses: 1, falseFails: 1, falsePassRate: 100, falseFailRate: 100 });
    expect(s.notes).toHaveLength(2);
    expect(s.notes[0]).toContain('review caught it');
  });
});

describe('summarise — failing checks, window, duration', () => {
  it('ranks failing checks by frequency and ignores checks on a PASS', () => {
    const s = summarise([
      run('T-1', 'FAIL', { check: 'layout-matrix' }),
      run('T-2', 'FAIL', { check: 'layout-matrix' }),
      run('T-3', 'FAIL', { check: 'axe' }),
      run('T-4', 'PASS', { check: 'axe' }),
    ]);
    expect(s.topChecks).toEqual([['layout-matrix', 2], ['axe', 1]]);
  });

  it('reports the first and last day in order', () => {
    const s = summarise([
      { ...run('T-2', 'PASS'), at: '2026-10-09T09:00:00.000Z' },
      { ...run('T-1', 'PASS'), at: '2026-10-01T09:00:00.000Z' },
    ]);
    expect([s.firstDay, s.lastDay]).toEqual(['2026-10-01', '2026-10-09']);
  });

  it('takes the median duration, not the mean, and ignores missing ones', () => {
    const s = summarise([
      run('T-1', 'PASS', { sec: 40 }), run('T-2', 'PASS', { sec: 50 }),
      run('T-3', 'PASS', { sec: 300 }), run('T-4', 'PASS'),
    ]);
    expect(s.medianSec).toBe(50);
  });
});

describe('summarise — accessibility and CLS', () => {
  it('treats a run without a11y as not measured, never as zero violations', () => {
    const s = summarise([
      run('T-1', 'PASS', { a11y: 0 }), run('T-2', 'FAIL', { a11y: 3 }), run('T-3', 'PASS'),
    ]);
    expect(s).toMatchObject({ a11yMeasured: 2, a11yRunsWithViolations: 1, a11yViolationsTotal: 3 });
  });

  it('counts CLS strictly over the same threshold the gate uses', () => {
    expect(CLS_THRESHOLD).toBe(0.1);
    const s = summarise([
      run('T-1', 'PASS', { cls: 0.01 }),
      run('T-2', 'PASS', { cls: 0.1 }),
      run('T-3', 'FAIL', { cls: 0.25 }),
    ]);
    expect(s).toMatchObject({ clsMeasured: 3, medianCls: 0.1, clsOverThreshold: 1 });
  });

  it('keeps a CLS of exactly 0 as a measurement', () => {
    expect(summarise([run('T-1', 'PASS', { cls: 0 })])).toMatchObject({ clsMeasured: 1, medianCls: 0 });
  });
});

describe('render', () => {
  it('says so when the log is empty', () => {
    expect(render(summarise([]))).toBe('No runs logged yet.\n');
  });

  it('prints both error rates with their denominators and the undercount caveat', () => {
    const text = render(summarise([run('T-1', 'PASS'), run('T-2', 'FAIL'), correction('false-pass', 'T-1')]));
    expect(text).toContain('False passes    1 of 1 passes (100%)');
    expect(text).toContain('False fails     0 of 1 fails (0%)');
    expect(text).toMatch(/floor, not an estimate/);
  });
});

describe('read', () => {
  it('returns nothing for a log that does not exist yet', () => {
    expect(read(join(tmp(), 'nope.jsonl'))).toEqual([]);
  });

  it('skips blank lines', () => {
    const p = join(tmp(), 'runs.jsonl');
    writeFileSync(p, `${JSON.stringify(run('T-1', 'PASS'))}\n\n\n`);
    expect(read(p)).toHaveLength(1);
  });

  it('throws on a corrupt line instead of silently dropping it', () => {
    const p = join(tmp(), 'runs.jsonl');
    writeFileSync(p, `${JSON.stringify(run('T-1', 'PASS'))}\nnot json\n`);
    expect(() => read(p)).toThrow(/line 2/);
  });
});

describe('main — the CLI', () => {
  /** Runs main with captured output in a scratch directory. */
  const cli = (args, cwd = tmp()) => {
    let out = '';
    let err = '';
    const code = main(args, { cwd, out: (s) => { out += s; }, err: (s) => { err += s; } });
    return { code, out, err, cwd };
  };

  it('defaults the log to .figma-validate/runs.jsonl', () => {
    expect(DEFAULT_LOG_PATH).toBe('.figma-validate/runs.jsonl');
  });

  it('logs a run from an evidence file and appends rather than rewrites', () => {
    const cwd = tmp();
    writeFileSync(join(cwd, 'evidence.json'), JSON.stringify(AXE_FAILING_EVIDENCE));
    expect(cli(['run', 'T-1', '--evidence=evidence.json', '--sec=42'], cwd).code).toBe(0);
    expect(cli(['run', 'T-1', '--evidence=evidence.json'], cwd).code).toBe(0);
    const rows = read(join(cwd, DEFAULT_LOG_PATH));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ verdict: 'FAIL', check: 'axe', a11y: 1, sec: 42 });
  });

  it('refuses to log unevaluable evidence and writes nothing', () => {
    const cwd = tmp();
    writeFileSync(join(cwd, 'evidence.json'), JSON.stringify({ viewports: [] }));
    const r = cli(['run', 'T-1', '--evidence=evidence.json'], cwd);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not logged/);
    expect(read(join(cwd, DEFAULT_LOG_PATH))).toEqual([]);
  });

  it('honours --log for the path', () => {
    const cwd = tmp();
    expect(cli(['false-fail', 'T-1', 'contrast was over an image', '--log=custom/log.jsonl'], cwd).code).toBe(0);
    expect(readFileSync(join(cwd, 'custom/log.jsonl'), 'utf8')).toContain('false-fail');
  });

  it.each([
    [['run', 'T-1']],
    [['run', 'T-1', '--evidence=e.json', '--sec=-3']],
    [['false-pass', 'T-1']],
    [['nonsense', 'T-1']],
    [[]],
  ])('exits 2 on bad usage: %j', (args) => {
    expect(cli(args).code).toBe(2);
  });

  it('runs as a real process', () => {
    // The CLI guard compares import.meta.url with argv[1]; a mistake there
    // makes `node lib/runlog.mjs` silently do nothing.
    const cwd = tmp();
    const script = new URL('../skills/figma-validate/lib/runlog.mjs', import.meta.url).pathname;
    const r = spawnSync('node', [script, 'report'], { cwd, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('No runs logged yet.\n');
  });
});

describe('parseArgs', () => {
  it('separates flags from positional arguments', () => {
    expect(parseArgs(['run', 'T-1', '--evidence=a=b.json'])).toEqual({
      flags: { evidence: 'a=b.json' },
      positional: ['run', 'T-1'],
    });
  });
});
