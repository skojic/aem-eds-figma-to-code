#!/usr/bin/env node
/**
 * UserPromptExpansion, matcher `figma-validate`.
 *
 * Stops /figma-validate before it starts when the files it needs are not there,
 * and says which skill produces each one. Exit 2 blocks the expansion; the
 * message on stderr is shown to the user.
 *
 * Only the filesystem-checkable part of the pre-flight lives here. The dev
 * server, browser MCP and content store are runtime conditions and remain with
 * the skill's own fail-stop rules.
 */
import { checkPreflight, ticketFromPayload } from '../lib/guards.mjs';
import { readPayload } from './stdin.mjs';

const payload = await readPayload();
const ticket = ticketFromPayload(payload);

if (!ticket) {
  // Cannot tell which spec dir to check. Allow, but say so — blocking on an
  // unrecognised payload shape would make every run fail for a reason the user
  // cannot act on.
  process.stderr.write('figma-validate preflight: could not read the ticket from the hook payload; skipping the file checks.\n');
  process.exit(0);
}

const problems = checkPreflight({ cwd: payload.cwd ?? process.cwd(), ticket });
if (problems.length > 0) {
  process.stderr.write(`/figma-validate ${ticket} cannot start:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(2);
}
