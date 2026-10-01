/**
 * Shared by the four hook scripts: read the JSON payload Claude Code writes to
 * stdin. A payload that cannot be parsed is treated as empty rather than fatal —
 * each hook then finds nothing it recognises and allows, which is correct for an
 * event this pack does not guard.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}
