import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  checkArtifact,
  checkPreflight,
  checkReportWrite,
  checkStop,
  configValue,
  evidencePathsFromTranscript,
  ticketFromPayload,
  verdictIn,
} from '../skills/figma-validate/lib/guards.mjs';
import { FAILING_EVIDENCE, MATRIX, PASSING_EVIDENCE, makeProject } from './helpers/project.mjs';

const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));

describe('checkPreflight', () => {
  it('passes a complete spec dir', () => {
    const { root } = makeProject();
    expect(checkPreflight({ cwd: root, ticket: 'T-1' })).toEqual([]);
  });

  it.each([
    ['config', /config not found|figma-to-code\.config\.md/],
    ['design', /run \/figma-specify T-1 first/],
    ['matrix', /re-run \/figma-specify T-1/],
    ['png', /run \/figma-screenshot T-1/],
  ])('names the fix when %s is missing', (skip, pattern) => {
    const { root } = makeProject({ skip: [skip] });
    expect(checkPreflight({ cwd: root, ticket: 'T-1' }).join('\n')).toMatch(pattern);
  });

  it('refuses a sidecar that does not parse, instead of falling back to the table', () => {
    const { root, specDir } = makeProject();
    write(join(specDir, 'design.matrix.json'), '{ nope');
    expect(checkPreflight({ cwd: root, ticket: 'T-1' }).join('\n')).toMatch(/does not parse/);
  });

  it('refuses a sidecar with the wrong shape', () => {
    const { root, specDir } = makeProject();
    write(join(specDir, 'design.matrix.json'), { ...MATRIX, rows: [] });
    expect(checkPreflight({ cwd: root, ticket: 'T-1' }).join('\n')).toMatch(/verifies nothing/);
  });

  it('accepts the fallback config location', () => {
    const { root } = makeProject({ skip: ['config'] });
    mkdirSync(join(root, '.claude'));
    write(join(root, '.claude/figma-to-code.config.md'), 'spec_output_path: "drafts/specs/{ticket}/design.md"\n');
    expect(checkPreflight({ cwd: root, ticket: 'T-1' })).toEqual([]);
  });
});

describe('configValue / ticketFromPayload', () => {
  it('reads a quoted flat value and returns null when absent', () => {
    expect(configValue('a: "b"\n', 'a')).toBe('b');
    expect(configValue('a: "b"\n', 'z')).toBeNull();
  });

  it('finds the ticket wherever the payload carries the command text', () => {
    expect(ticketFromPayload({ prompt: '/figma-validate PROJ-9' })).toBe('PROJ-9');
    expect(ticketFromPayload({ a: { b: 'figma-validate my-slug extra' } })).toBe('my-slug');
    expect(ticketFromPayload({ prompt: 'hello' })).toBeNull();
  });
});

describe('checkArtifact', () => {
  it('ignores files it does not guard', () => {
    const { specDir } = makeProject();
    expect(checkArtifact(join(specDir, 'design.md'))).toEqual([]);
    expect(checkArtifact(join(specDir, 'nonexistent.json'))).toEqual([]);
  });

  it('accepts a good sidecar and good evidence', () => {
    const { specDir, validation } = makeProject();
    write(join(validation, 'evidence.json'), PASSING_EVIDENCE);
    expect(checkArtifact(join(specDir, 'design.matrix.json'))).toEqual([]);
    expect(checkArtifact(join(validation, 'evidence.json'))).toEqual([]);
  });

  it('reports invalid JSON', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), '{ nope');
    expect(checkArtifact(join(validation, 'evidence.json')).join()).toMatch(/not valid JSON/);
  });

  it('flags a container the sidecar checks but design.md never mentions', () => {
    const { specDir } = makeProject();
    write(join(specDir, 'design.md'), '# a spec about something else');
    expect(checkArtifact(join(specDir, 'design.matrix.json')).join()).toMatch(/disagree/);
  });

  it('does not treat an evidence.json outside validation/ as the gate artifact', () => {
    const { specDir } = makeProject();
    write(join(specDir, 'evidence.json'), '{ nope');
    expect(checkArtifact(join(specDir, 'evidence.json'))).toEqual([]);
  });
});

describe('verdictIn', () => {
  it('reads the verdict line', () => {
    expect(verdictIn('**Verdict**: PASS\n')).toBe('PASS');
    expect(verdictIn('x\n**Verdict**: FAIL')).toBe('FAIL');
  });

  it('does not mistake the template placeholder for a verdict', () => {
    expect(verdictIn('**Verdict**: PASS | FAIL')).toBeNull();
    expect(verdictIn('no verdict here')).toBeNull();
  });
});

describe('checkReportWrite', () => {
  it('allows a report whose verdict matches the evidence', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), PASSING_EVIDENCE);
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '**Verdict**: PASS' })).toBeNull();
  });

  it('denies a hand-written PASS over failing evidence', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), FAILING_EVIDENCE);
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '**Verdict**: PASS' })).toMatch(/gives FAIL/);
  });

  it('denies a FAIL over passing evidence too — the rule is agreement, not optimism', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), PASSING_EVIDENCE);
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '**Verdict**: FAIL' })).toMatch(/gives PASS/);
  });

  it('denies any report when there is no evidence', () => {
    const { validation } = makeProject();
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '**Verdict**: PASS' })).toMatch(/does not exist/);
  });

  it('denies any report when the evidence cannot be evaluated (gate exit 2)', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), { viewports: [] });
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '**Verdict**: PASS' })).toMatch(/exit 2/);
  });

  it('lets a partial edit through when it does not touch the verdict line', () => {
    const { validation } = makeProject();
    write(join(validation, 'evidence.json'), PASSING_EVIDENCE);
    expect(checkReportWrite({ filePath: join(validation, 'report.md'), content: '- [ ] Fix #1' })).toBeNull();
  });

  it('ignores other files, including a report.md outside validation/', () => {
    const { specDir } = makeProject();
    expect(checkReportWrite({ filePath: join(specDir, 'report.md'), content: '**Verdict**: PASS' })).toBeNull();
    expect(checkReportWrite({ filePath: join(specDir, 'notes.md'), content: 'x' })).toBeNull();
  });
});

describe('evidencePathsFromTranscript', () => {
  const line = (name, file_path) => JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input: { file_path } }] },
  });

  it('collects evidence.json writes only', () => {
    const text = [
      line('Write', '/p/specs/T-1/validation/evidence.json'),
      line('Edit', '/p/specs/T-1/validation/evidence.json'),
      line('Write', '/p/specs/T-1/validation/report.md'),
      line('Read', '/p/specs/T-2/validation/evidence.json'),
      'not json',
      '',
    ].join('\n');
    expect(evidencePathsFromTranscript(text)).toEqual(['/p/specs/T-1/validation/evidence.json']);
  });
});

describe('checkStop', () => {
  const settle = (evidencePath, reportPath) => {
    // Make the report strictly newer than the evidence regardless of fs timestamp granularity.
    const t = Date.now() / 1000;
    utimesSync(evidencePath, t - 10, t - 10);
    utimesSync(reportPath, t, t);
  };

  it('has nothing to say when no evidence was written', () => {
    expect(checkStop([])).toEqual([]);
  });

  it('allows a finished run', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    const rp = join(validation, 'report.md');
    write(ev, FAILING_EVIDENCE);
    write(rp, '**Verdict**: FAIL');
    settle(ev, rp);
    expect(checkStop([ev])).toEqual([]);
  });

  it('blocks when the report was never written', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    write(ev, PASSING_EVIDENCE);
    expect(checkStop([ev]).join()).toMatch(/never written/);
  });

  it('blocks a report that disagrees with the evidence', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    const rp = join(validation, 'report.md');
    write(ev, FAILING_EVIDENCE);
    write(rp, '**Verdict**: PASS');
    settle(ev, rp);
    expect(checkStop([ev]).join()).toMatch(/states PASS .* gives FAIL/);
  });

  it('blocks a report with no verdict line', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    const rp = join(validation, 'report.md');
    write(ev, PASSING_EVIDENCE);
    write(rp, '# nothing');
    settle(ev, rp);
    expect(checkStop([ev]).join()).toMatch(/no verdict/);
  });

  it('blocks a stale report — evidence changed after it was written', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    const rp = join(validation, 'report.md');
    write(rp, '**Verdict**: PASS');
    write(ev, PASSING_EVIDENCE);
    const t = Date.now() / 1000;
    utimesSync(rp, t - 10, t - 10);
    utimesSync(ev, t, t);
    expect(checkStop([ev]).join()).toMatch(/older than/);
  });

  it('treats unevaluable evidence as a fail-stop, not a verdict', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    write(ev, { viewports: [] });
    expect(checkStop([ev]).join()).toMatch(/exit 2/);
  });
});
