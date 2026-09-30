import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// The pack's headline architectural claim is that nothing self-triggers:
// README calls it "three explicit-invocation skills", and every SKILL.md sets
// `disable-model-invocation: true`. Nothing enforced that. A flag silently
// dropped in an edit would falsify the README with no test failing and no
// visible symptom — the skills would simply start firing on their own.
//
// These assertions are cheap and they guard the one property the whole design
// rests on.

const SKILLS_DIR = new URL('../skills/', import.meta.url).pathname;

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * Minimal frontmatter reader. Deliberately not a YAML parser: the frontmatter
 * this checks is flat `key: value` by contract, and depending on a parser
 * would let a nested structure pass a check meant to reject one.
 *
 * @param {string} source
 * @returns {{ raw: string, fields: Record<string, string> }}
 */
function readFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) throw new Error('no frontmatter block found');
  const raw = match[1] ?? '';

  /** @type {Record<string, string>} */
  const fields = {};
  let currentKey = null;
  raw.split(/\r?\n/).forEach((line) => {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = /** @type {string} */ (kv[1]);
      fields[currentKey] = (kv[2] ?? '').trim();
      return;
    }
    // Folded continuation lines belong to the previous key.
    if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim();
    }
  });
  return { raw, fields };
}

describe('the skills directory', () => {
  it('contains the three documented skills and nothing unexpected', () => {
    expect(skillDirs).toEqual(['figma-screenshot', 'figma-specify', 'figma-validate']);
  });
});

describe.each(skillDirs)('%s/SKILL.md', (dir) => {
  const source = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8');
  const { fields } = readFrontmatter(source);

  it('has parseable frontmatter with a name and description', () => {
    expect(fields.name).toBeTruthy();
    expect(fields.description).toBeTruthy();
  });

  it('has a name matching its directory', () => {
    // A mismatch means `/name` in the docs invokes something that is not this
    // file, which is the kind of break that only shows up at runtime.
    expect(fields.name).toBe(dir);
  });

  it('declares disable-model-invocation: true', () => {
    // ⛔ Do not relax this. "Nothing self-triggers" is the claim in README,
    // docs/DESIGN.md §7 and the presentation. If a skill genuinely should be
    // model-invocable, the claim has to change first.
    expect(fields['disable-model-invocation']).toBe('true');
  });

  it('states explicit invocation in the description the model reads', () => {
    // The frontmatter flag stops automatic invocation; the description is what
    // tells the model how the skill is meant to be used. Both or neither.
    expect(fields.description.toLowerCase()).toContain('explicit invocation only');
  });

  it('fail-stops rather than guessing when config is missing', () => {
    // Every skill documents a hard stop on a missing config file. This asserts
    // the wording still exists, because "no source, no output" is the other
    // load-bearing rule in the pack.
    expect(source).toMatch(/STOP/);
    expect(source).toContain('figma-to-code.config.md');
  });
});

describe('frontmatter reader', () => {
  // The reader is test infrastructure, so it gets its own coverage — a broken
  // reader would make every assertion above pass vacuously.
  it('rejects a file with no frontmatter', () => {
    expect(() => readFrontmatter('# just a heading')).toThrow();
  });

  it('reads a flat key/value block', () => {
    const { fields } = readFrontmatter('---\nname: x\ndisable-model-invocation: true\n---\nbody');
    expect(fields).toEqual({ name: 'x', 'disable-model-invocation': 'true' });
  });

  it('folds continuation lines into the preceding key', () => {
    const { fields } = readFrontmatter('---\ndescription: one\n  two\n---\n');
    expect(fields.description).toBe('one two');
  });
});
