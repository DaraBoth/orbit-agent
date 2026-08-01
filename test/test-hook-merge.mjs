// Proves hook install MERGES into an existing .claude/settings.json rather
// than clobbering it: pre-existing unrelated settings, and pre-existing
// hooks for other events (or the same event from another tool), must
// survive untouched, and running install twice must be idempotent (no
// duplicate entries).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mergeHooksIntoSettings } = await import('../src/hookInstall.mjs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-hook-test-'));
const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

const preExisting = {
  theme: 'dark',
  agentPushNotifEnabled: true,
  hooks: {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo pre-tool-use' }] }],
    PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo some-other-tools-hook' }] }],
  },
};
fs.writeFileSync(settingsPath, JSON.stringify(preExisting, null, 2));

const ourCommand = 'node "/home/user/.orbit-agent/hooks/report-agent-event.mjs"';

// First install.
const result1 = mergeHooksIntoSettings(settingsPath, ourCommand);

assert.equal(result1.theme, 'dark', 'unrelated top-level settings must be preserved');
assert.equal(result1.agentPushNotifEnabled, true, 'unrelated top-level settings must be preserved');

assert.equal(result1.hooks.PreToolUse.length, 1, 'unrelated hook event (PreToolUse) must be untouched');
assert.equal(result1.hooks.PreToolUse[0].hooks[0].command, 'echo pre-tool-use');

assert.equal(result1.hooks.PostToolUse.length, 2, 'existing PostToolUse entry must survive, plus our new one appended');
assert.equal(result1.hooks.PostToolUse[0].hooks[0].command, 'echo some-other-tools-hook', 'pre-existing entry must stay first, unmodified');
assert.equal(result1.hooks.PostToolUse[1].hooks[0].command, ourCommand, 'our entry gets appended');

assert.ok(Array.isArray(result1.hooks.Stop), 'Stop hook block created');
assert.equal(result1.hooks.Stop.length, 1);
assert.equal(result1.hooks.Stop[0].hooks[0].command, ourCommand);

// Re-read from disk to make sure it was actually persisted, not just
// returned in memory.
const onDisk1 = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.deepEqual(onDisk1, result1);

// Second install (idempotency): re-running connect must not duplicate our
// entries, and must still preserve everything else.
const result2 = mergeHooksIntoSettings(settingsPath, ourCommand);
assert.equal(result2.hooks.PostToolUse.length, 2, 'second install must not duplicate our PostToolUse entry');
assert.equal(result2.hooks.Stop.length, 1, 'second install must not duplicate our Stop entry');
assert.equal(result2.hooks.PreToolUse.length, 1, 'unrelated hook still untouched after second install');
assert.equal(result2.theme, 'dark');

// A completely missing settings.json must be created fresh, not throw.
const freshPath = path.join(tmpDir, 'fresh', '.claude', 'settings.json');
const resultFresh = mergeHooksIntoSettings(freshPath, ourCommand);
assert.equal(resultFresh.hooks.PostToolUse.length, 1);
assert.equal(resultFresh.hooks.Stop.length, 1);
assert.ok(fs.existsSync(freshPath));

// Invalid existing JSON must fail loudly rather than silently overwrite
// whatever the user had (which might not even be hook-related).
const brokenPath = path.join(tmpDir, 'broken', '.claude', 'settings.json');
fs.mkdirSync(path.dirname(brokenPath), { recursive: true });
fs.writeFileSync(brokenPath, '{ this is not valid json');
assert.throws(() => mergeHooksIntoSettings(brokenPath, ourCommand), /invalid JSON/);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('test-hook-merge: OK');
