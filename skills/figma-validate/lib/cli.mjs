#!/usr/bin/env node
/**
 * Command-line entry point for the verdict core.
 *
 *   node lib/cli.mjs <spec-dir>/validation/evidence.json
 *
 * Prints the report to stdout and exits 0 on PASS, 1 on FAIL, 2 when the
 * evidence could not be evaluated at all.
 *
 * The three exit codes matter: a caller that cannot distinguish "failed the
 * check" from "could not run the check" will eventually treat the second as
 * the first, and a broken gate then looks like a clean one. `verdict.mjs`
 * keeps that distinction by throwing rather than returning; this file keeps it
 * at the process boundary.
 *
 * Kept separate from verdict.mjs so that module stays a pure import with no
 * process, argv or filesystem access.
 */
import { readFile } from 'node:fs/promises';
import { evaluate, formatReport, PASS } from './verdict.mjs';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_UNEVALUATED = 2;

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write('usage: node lib/cli.mjs <evidence.json>\n');
    return EXIT_UNEVALUATED;
  }

  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    process.stderr.write(`could not read ${path}: ${messageOf(error)}\n`);
    return EXIT_UNEVALUATED;
  }

  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`${path} is not valid JSON: ${messageOf(error)}\n`);
    return EXIT_UNEVALUATED;
  }

  let outcome;
  try {
    outcome = evaluate(evidence);
  } catch (error) {
    process.stderr.write(`evidence could not be evaluated: ${messageOf(error)}\n`);
    return EXIT_UNEVALUATED;
  }

  process.stdout.write(`${formatReport(outcome, {
    ticket: evidence.ticket,
    block: evidence.block,
    date: new Date().toISOString().slice(0, 10),
  })}\n`);

  return outcome.verdict === PASS ? EXIT_PASS : EXIT_FAIL;
}

process.exitCode = await main();
