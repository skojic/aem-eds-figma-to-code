#!/usr/bin/env node
/**
 * Stop.
 *
 * A session that wrote validation/evidence.json may not end until report.md
 * exists, is newer than the evidence, and states the verdict the gate computes.
 * The check re-runs the verdict core itself; nothing the model recorded is
 * trusted.
 *
 * Sessions that never wrote evidence are untouched. `stop_hook_active` is the
 * loop guard: if the model was already sent back once and still cannot comply,
 * the second stop goes through with a visible warning rather than trapping the
 * session.
 */
import { readFileSync } from 'node:fs';
import { checkStop, evidencePathsFromTranscript } from '../lib/guards.mjs';
import { readPayload } from './stdin.mjs';

const payload = await readPayload();

let transcript = '';
try {
  transcript = readFileSync(payload.transcript_path, 'utf8');
} catch {
  process.exit(0);
}

const problems = checkStop(evidencePathsFromTranscript(transcript));
if (problems.length === 0) process.exit(0);

const text = problems.map((p) => `- ${p}`).join('\n');
if (payload.stop_hook_active) {
  process.stdout.write(JSON.stringify({ systemMessage: `figma-validate: stopping with the gate unsatisfied:\n${text}` }));
} else {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `The validation run is not finished:\n${text}` }));
}
