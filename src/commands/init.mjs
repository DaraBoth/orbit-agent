// `orbit-agent init` — the one-command onboarding path. Verifies the token,
// saves config, merges the D1 hooks, and installs the ORBIT skill + the
// /orbit-inbox slash command, all in one shot. Unlike `connect`, this does
// NOT start the daemon — it just gets a project fully wired up; the user
// (or a service manager) runs `connect` separately when they want the
// heartbeat/mention-poll loop actually running.
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveConfig, loadConfig, maskToken } from '../config.mjs';
import { installProjectHooks } from '../hookInstall.mjs';
import { installOrbitSkill, installOrbitInboxCommand } from '../skillInstall.mjs';
import { heartbeat } from '../orbitClient.mjs';

const OPTIONS = {
  token: { type: 'string' },
  goal: { type: 'string' },
  'base-url': { type: 'string' },
  dir: { type: 'string' },
  role: { type: 'string' },
  instance: { type: 'string' },
};

// ORBIT's API contract (api/agent-events.ts, api/agent-heartbeat.ts,
// api/agent-mention-dispatches.ts) has no endpoint that echoes a token's
// registered agent_role/instance_label back to the client — those fields
// are only ever attached server-side, never returned. So --role/--instance
// genuinely can't be "fetched" today; this derives a sensible default
// instead and says so plainly, rather than pretending it fetched something.
function defaultInstanceLabel() {
  const raw = os.hostname() || 'agent';
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'agent').slice(0, 40);
}

export async function runInit(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });

  const existing = loadConfig();

  const projectDir = path.resolve(values.dir || existing?.projectDir || process.cwd());
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`--dir does not exist or is not a directory: ${projectDir}`);
  }

  const baseUrl = (values['base-url'] || existing?.baseUrl || 'https://orbitkh.vercel.app').replace(/\/+$/, '');

  const token = values.token || process.env.ORBIT_API_KEY || existing?.token;
  if (!token || !token.startsWith('dgm_pat_')) {
    throw new Error('No valid token found. Pass --token <dgm_pat_...> (minted as an agent identity in ORBIT), or set $ORBIT_API_KEY.');
  }

  const goalId = values.goal || existing?.goalId;
  if (!goalId) {
    throw new Error('init requires --goal <id> — the ORBIT goal id to attach this project to.');
  }

  // Constraint from the spec: verify BEFORE writing anything, so a bad
  // token never scatters a half-broken setup across the user's project.
  try {
    await heartbeat({ baseUrl, token }, null);
  } catch (err) {
    throw new Error(
      `Token rejected by ${baseUrl}: ${err?.message || err}. Nothing was written — check the token and try again.`,
    );
  }

  let role = values.role || existing?.role;
  let roleNote = null;
  if (!role) {
    role = 'dev-agent';
    roleNote = `no --role given (and ORBIT has no endpoint to look one up for a token) — defaulted to "${role}"`;
  }

  let instance = values.instance || existing?.instance;
  let instanceNote = null;
  if (!instance) {
    instance = defaultInstanceLabel();
    instanceNote = `no --instance given — defaulted to "${instance}" (derived from this machine's hostname)`;
  }

  const cfg = {
    baseUrl,
    token,
    goalId,
    role,
    instance,
    projectDir,
    allowExecute: existing?.allowExecute ?? false,
    allowedTools: existing?.allowedTools ?? [],
    maxTurns: existing?.maxTurns ?? 8,
    heartbeatIntervalMs: existing?.heartbeatIntervalMs ?? 45_000,
    pollIntervalMs: existing?.pollIntervalMs ?? 20_000,
  };

  saveConfig(cfg);
  const { hookScriptPath, settingsPath } = installProjectHooks(projectDir);
  const skillPath = installOrbitSkill(projectDir, cfg);
  const { commandPath, inboxScriptPath } = installOrbitInboxCommand(projectDir);

  console.log(`orbit-agent: token verified against ${baseUrl}`);
  console.log(`orbit-agent: identity — role=${cfg.role} instance=${cfg.instance} goal=${cfg.goalId}`);
  if (roleNote) console.log(`orbit-agent: ${roleNote} (pass --role to set one explicitly)`);
  if (instanceNote) console.log(`orbit-agent: ${instanceNote} (pass --instance to set one explicitly)`);
  console.log(`orbit-agent: token = ${maskToken(cfg.token)}`);
  console.log('\nFiles written:');
  console.log(`  ~/.orbit-agent/config.json          (chmod 0600, holds the token — never committed)`);
  console.log(`  ${hookScriptPath}`);
  console.log(`  ${inboxScriptPath}`);
  console.log(`  ${settingsPath}  (merged, D1 activity-streaming hooks)`);
  console.log(`  ${skillPath}`);
  console.log(`  ${commandPath}`);
  console.log('\nNext steps:');
  console.log('  1. Commit .claude/settings.json, .claude/skills/orbit/, and .claude/commands/orbit-inbox.md if you want the whole team on this setup.');
  console.log('  2. Run `orbit-agent connect` in this directory to start heartbeating and receiving @mentions.');
  console.log('  3. Use /orbit-inbox any time to check for pending mentions without starting the daemon.');

  return { cfg, hookScriptPath, settingsPath, skillPath, commandPath, inboxScriptPath };
}
