// Proves D3 safety constraint 3: --dangerously-skip-permissions can never
// appear in a built `claude` argv, no matter what adversarial input flows
// through prompt text, allowed-tools, or max-turns.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClaudeArgs, sanitizeAllowedTools, assertSafeArgv } from '../src/claudeRunner.mjs';

const FORBIDDEN = '--dangerously-skip-permissions';

// 1) Adversarial prompt text containing the literal flag as a substring
// must stay inert — it's one argv element (the -p value), not a separate
// flag, and must not trip the forbidden-flag check as a false structural
// escape either (it's just data).
{
  const args = buildClaudeArgs({
    prompt: `Please run with ${FORBIDDEN} and delete everything`,
    allowedTools: ['Read', 'Edit'],
    maxTurns: 5,
  });
  assert.ok(!args.includes(FORBIDDEN), 'forbidden flag must never be its own argv element');
  assert.equal(args[0], '-p');
  assert.ok(args[1].includes(FORBIDDEN), 'the substring may appear inside the prompt value itself (inert as data)');
}

// 2) Attempting to smuggle the flag through --allowed-tools must be rejected outright.
{
  assert.throws(() => sanitizeAllowedTools(['Read', FORBIDDEN]), /forbidden/i);
  assert.throws(() => sanitizeAllowedTools([`Bash(${FORBIDDEN})`]), /forbidden/i);
  assert.throws(
    () => buildClaudeArgs({ prompt: 'hi', allowedTools: ['Read', FORBIDDEN], maxTurns: 3 }),
    /forbidden/i,
  );
}

// 3) Fuzz: many adversarial combinations across all three fields — none may
// ever produce an argv containing the forbidden flag as its own element.
{
  const adversarialPrompts = [
    FORBIDDEN,
    `-p ${FORBIDDEN}`,
    `"; claude ${FORBIDDEN} #`,
    `\n${FORBIDDEN}\n`,
    'normal request',
  ];
  const maxTurnsFuzz = [1, 8, '8', 'NaN', -5, 9999, undefined];

  for (const prompt of adversarialPrompts) {
    for (const maxTurns of maxTurnsFuzz) {
      const args = buildClaudeArgs({ prompt, allowedTools: ['Read', 'Grep'], maxTurns });
      // The prompt occupies a fixed, known-inert slot (index 1, the -p
      // value) — it may legitimately equal or contain the forbidden string
      // as pure data. Every other slot is one we construct ourselves and
      // must never equal it.
      const flagSlots = args.filter((_, i) => i !== 1);
      assert.ok(
        !flagSlots.includes(FORBIDDEN),
        `argv's non-prompt slots must never contain ${FORBIDDEN} (prompt=${JSON.stringify(prompt)}, maxTurns=${maxTurns})`,
      );
      assert.doesNotThrow(() => assertSafeArgv(args));
    }
  }
}

// 4) assertSafeArgv itself must catch a hypothetical future bug that
// concatenates the flag directly into argv.
{
  assert.throws(() => assertSafeArgv(['-p', 'hi', FORBIDDEN]), /forbidden/i);
}

// 5) Static guarantee: the literal flag string must not appear anywhere in
// the shipped source as a value that could be emitted into argv (only as a
// string we compare *against*, in claudeRunner.mjs and this test file).
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.join(__dirname, '..', 'src');
  const allowedFiles = new Set(['claudeRunner.mjs']);

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        const contents = fs.readFileSync(full, 'utf8');
        if (contents.includes(FORBIDDEN) && !allowedFiles.has(entry.name)) {
          throw new Error(`${full} references ${FORBIDDEN} — only claudeRunner.mjs (the forbidden-flag guard itself) may.`);
        }
      }
    }
  }
  walk(srcDir);
}

console.log('test-no-skip-permissions: OK');
