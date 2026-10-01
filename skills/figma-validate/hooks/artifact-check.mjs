#!/usr/bin/env node
/**
 * PostToolUse, matcher `Write|Edit`.
 *
 * Validates design.matrix.json and validation/evidence.json the moment they are
 * written. Exit 2 feeds the problem list back to the model so it fixes the file
 * now, rather than the gate tripping over it at the end of a browser loop.
 */
import { checkArtifact } from '../lib/guards.mjs';
import { readPayload } from './stdin.mjs';

const payload = await readPayload();
const filePath = payload.tool_input?.file_path;
if (typeof filePath !== 'string') process.exit(0);

const problems = checkArtifact(filePath);
if (problems.length > 0) {
  process.stderr.write(`${problems.map((p) => `- ${p}`).join('\n')}\nFix the file and write it again.\n`);
  process.exit(2);
}
