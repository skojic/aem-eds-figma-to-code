import { spawnSync } from 'node:child_process';
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FAILING_EVIDENCE, PASSING_EVIDENCE, makeProject } from './helpers/project.mjs';

// The unit tests prove the rules. These prove the scripts Claude Code actually
// runs turn those rules into the exit codes and JSON the harness expects — the
// last place a wrong exit code could turn a gate into decoration.

const HOOKS = new URL('../skills/figma-validate/hooks/', import.meta.url).pathname;

/** @param {string} script @param {object} payload */
function run(script, payload) {
  const r = spawnSync('node', [join(HOOKS, script)], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('preflight.mjs (UserPromptExpansion)', () => {
  it('exits 0 for a complete spec dir', () => {
    const { root } = makeProject();
    expect(run('preflight.mjs', { cwd: root, prompt: '/figma-validate T-1' }).code).toBe(0);
  });

  it('exits 2 and names the missing step', () => {
    const { root } = makeProject({ skip: ['png'] });
    const r = run('preflight.mjs', { cwd: root, prompt: '/figma-validate T-1' });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/\/figma-screenshot T-1/);
  });

  it('allows, with a warning, when the ticket cannot be read from the payload', () => {
    const r = run('preflight.mjs', { cwd: '/nowhere', other: 'x' });
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/could not read the ticket/);
  });
});

describe('artifact-check.mjs (PostToolUse)', () => {
  it('exits 2 with the problem list for a bad sidecar', () => {
    const { specDir } = makeProject();
    writeFileSync(join(specDir, 'design.matrix.json'), JSON.stringify({ block: 'x', breakpoints: [], rows: [] }));
    const r = run('artifact-check.mjs', { tool_name: 'Write', tool_input: { file_path: join(specDir, 'design.matrix.json') } });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/breakpoints/);
  });

  it('exits 0 for a good file and for payloads without a path', () => {
    const { specDir } = makeProject();
    expect(run('artifact-check.mjs', { tool_input: { file_path: join(specDir, 'design.matrix.json') } }).code).toBe(0);
    expect(run('artifact-check.mjs', { tool_input: {} }).code).toBe(0);
  });
});

describe('report-guard.mjs (PreToolUse)', () => {
  it('emits a deny decision for a contradicting verdict', () => {
    const { validation } = makeProject();
    writeFileSync(join(validation, 'evidence.json'), JSON.stringify(FAILING_EVIDENCE));
    const r = run('report-guard.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: join(validation, 'report.md'), content: '**Verdict**: PASS' },
    });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  });

  it('is silent for an agreeing verdict', () => {
    const { validation } = makeProject();
    writeFileSync(join(validation, 'evidence.json'), JSON.stringify(PASSING_EVIDENCE));
    const r = run('report-guard.mjs', {
      tool_name: 'Write',
      tool_input: { file_path: join(validation, 'report.md'), content: '**Verdict**: PASS' },
    });
    expect(r).toMatchObject({ code: 0, out: '' });
  });

  it('checks the replacement text of an Edit', () => {
    const { validation } = makeProject();
    writeFileSync(join(validation, 'evidence.json'), JSON.stringify(FAILING_EVIDENCE));
    const r = run('report-guard.mjs', {
      tool_name: 'Edit',
      tool_input: { file_path: join(validation, 'report.md'), old_string: 'FAIL', new_string: '**Verdict**: PASS' },
    });
    expect(JSON.parse(r.out).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('verdict-stop.mjs (Stop)', () => {
  /** A transcript in which the session wrote this evidence file. */
  function session(evidencePath) {
    const { root } = makeProject();
    const transcript = join(root, 'transcript.jsonl');
    writeFileSync(transcript, `${JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: evidencePath } }] },
    })}\n`);
    return transcript;
  }

  it('blocks the stop when no report exists', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    writeFileSync(ev, JSON.stringify(PASSING_EVIDENCE));
    const r = run('verdict-stop.mjs', { transcript_path: session(ev) });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).decision).toBe('block');
  });

  it('downgrades to a warning when the stop hook already fired once', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    writeFileSync(ev, JSON.stringify(PASSING_EVIDENCE));
    const out = JSON.parse(run('verdict-stop.mjs', { transcript_path: session(ev), stop_hook_active: true }).out);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toMatch(/unsatisfied/);
  });

  it('is silent for a finished run and for a session that never validated', () => {
    const { validation } = makeProject();
    const ev = join(validation, 'evidence.json');
    const rp = join(validation, 'report.md');
    writeFileSync(ev, JSON.stringify(PASSING_EVIDENCE));
    writeFileSync(rp, '**Verdict**: PASS');
    const t = Date.now() / 1000;
    utimesSync(ev, t - 10, t - 10);
    utimesSync(rp, t, t);
    expect(run('verdict-stop.mjs', { transcript_path: session(ev) })).toMatchObject({ code: 0, out: '' });
    expect(run('verdict-stop.mjs', { transcript_path: '/does/not/exist' })).toMatchObject({ code: 0, out: '' });
  });
});
