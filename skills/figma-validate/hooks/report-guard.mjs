#!/usr/bin/env node
/**
 * PreToolUse, matcher `Write|Edit`.
 *
 * Refuses a validation/report.md whose stated verdict contradicts what the gate
 * computes from evidence.json, and refuses any report when the evidence cannot
 * be evaluated at all. This is the check that stops a hand-written PASS.
 */
import { checkReportWrite } from '../lib/guards.mjs';
import { readPayload } from './stdin.mjs';

const payload = await readPayload();
const input = payload.tool_input ?? {};
const filePath = input.file_path;
if (typeof filePath !== 'string') process.exit(0);

const content = typeof input.content === 'string' ? input.content : String(input.new_string ?? '');
const reason = checkReportWrite({ filePath, content });

if (reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}
