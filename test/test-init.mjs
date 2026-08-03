// Proves the `init` onboarding flow: a bad token aborts BEFORE any file is
// written (no config, no .claude/skills, no .claude/commands, settings.json
// untouched); a good token writes config at 0600, merges hooks without
// clobbering pre-existing unrelated settings, and installs the skill +
// /orbit-inbox command; running init twice is fully idempotent (no
// duplicated hook entries, no duplicated skill/command files).
//
// Network is mocked via globalThis.fetch (orbitClient.mjs calls the bare
// global at request time, so this is safe to set before importing it) —
// no real ORBIT server involved, consistent with every other test here
// never touching the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-init-home-'));
process.env.ORBIT_AGENT_HOME = tmpHome;

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-agent-init-project-'));

const settingsPath = path.join(projectDir, '.claude', 'settings.json');
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      theme: 'dark',
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo unrelated' }] }] },
    },
    null,
    2,
  ),
);

let heartbeatCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.includes('/api/agent-heartbeat')) {
    throw new Error(`test stub: unexpected fetch to ${u}`);
  }
  heartbeatCalls += 1;
  const auth = (opts.headers && opts.headers.Authorization) || '';
  if (auth !== 'Bearer dgm_pat_goodtoken') {
    return new Response(JSON.stringify({ error: 'Unauthorized. Missing or invalid agent token.' }), { status: 401 });
  }
  return new Response(JSON.stringify({ success: true }), { status: 200 });
};

const { runInit } = await import('../src/commands/init.mjs');

// 1) Bad token must abort before any file is written.
let threw = false;
try {
  await runInit(['--token', 'dgm_pat_badtoken', '--goal', 'goal-1', '--dir', projectDir]);
} catch {
  threw = true;
}
assert.ok(threw, 'init must throw when the token is rejected');
assert.ok(!fs.existsSync(path.join(tmpHome, '.orbit-agent', 'config.json')), 'no config must be written on a rejected token');
assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'skills')), 'no skill dir must be written on a rejected token');
assert.ok(!fs.existsSync(path.join(projectDir, '.claude', 'commands')), 'no commands dir must be written on a rejected token');
const settingsAfterBadToken = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(settingsAfterBadToken.hooks.PreToolUse.length, 1, 'settings.json must be untouched by a failed init');
assert.ok(!settingsAfterBadToken.hooks.PostToolUse, 'no PostToolUse hook must be added on a failed init');

// 2) Good token, first run.
await runInit(['--token', 'dgm_pat_goodtoken', '--goal', 'goal-1', '--dir', projectDir, '--role', 'dev-agent', '--instance', 'laptopA']);

const configPath = path.join(tmpHome, '.orbit-agent', 'config.json');
assert.ok(fs.existsSync(configPath), 'config.json must exist after a successful init');
const mode = fs.statSync(configPath).mode & 0o777;
assert.equal(mode, 0o600, `config must be 0600, got ${mode.toString(8)}`);

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(cfg.goalId, 'goal-1');
assert.equal(cfg.role, 'dev-agent');
assert.equal(cfg.instance, 'laptopA');
assert.equal(cfg.allowExecute, false, 'init must never enable autonomous execution');

const skillPath = path.join(projectDir, '.claude', 'skills', 'orbit', 'SKILL.md');
assert.ok(fs.existsSync(skillPath), '/orbit skill must be installed');
assert.ok(fs.readFileSync(skillPath, 'utf8').includes('goal-1'), 'skill file should reference the connected goal id');

const commandPath = path.join(projectDir, '.claude', 'commands', 'orbit-inbox.md');
assert.ok(fs.existsSync(commandPath), '/orbit-inbox command must be installed');

const settingsAfterFirst = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(settingsAfterFirst.theme, 'dark', 'unrelated top-level settings must survive');
assert.equal(settingsAfterFirst.hooks.PreToolUse.length, 1, 'unrelated pre-existing hook must survive');
assert.equal(settingsAfterFirst.hooks.PostToolUse.length, 1, 'exactly one PostToolUse entry after first init');
assert.equal(settingsAfterFirst.hooks.Stop.length, 1, 'exactly one Stop entry after first init');

// 3) Second run: idempotency.
await runInit(['--token', 'dgm_pat_goodtoken', '--goal', 'goal-1', '--dir', projectDir, '--role', 'dev-agent', '--instance', 'laptopA']);

const settingsAfterSecond = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
assert.equal(settingsAfterSecond.hooks.PostToolUse.length, 1, 'second init must not duplicate the PostToolUse hook entry');
assert.equal(settingsAfterSecond.hooks.Stop.length, 1, 'second init must not duplicate the Stop hook entry');
assert.equal(settingsAfterSecond.hooks.PreToolUse.length, 1, 'unrelated hook still untouched after second init');

const skillFilesAfterSecond = fs.readdirSync(path.join(projectDir, '.claude', 'skills', 'orbit'));
assert.deepEqual(skillFilesAfterSecond, ['SKILL.md'], 'second init must not create duplicate skill files');
const commandFilesAfterSecond = fs.readdirSync(path.join(projectDir, '.claude', 'commands'));
assert.deepEqual(commandFilesAfterSecond, ['orbit-inbox.md'], 'second init must not create duplicate command files');

assert.equal(heartbeatCalls, 3, 'exactly one verification call per init invocation (1 bad + 2 good)');

fs.rmSync(tmpHome, { recursive: true, force: true });
fs.rmSync(projectDir, { recursive: true, force: true });
console.log('test-init: OK');
