import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { saveConfig, loadConfig, maskToken } from '../config.mjs';
import { installProjectHooks } from '../hookInstall.mjs';
import { startDaemon } from '../daemon.mjs';
import { sanitizeAllowedTools } from '../claudeRunner.mjs';

const OPTIONS = {
  goal: { type: 'string' },
  role: { type: 'string' },
  instance: { type: 'string' },
  dir: { type: 'string' },
  'base-url': { type: 'string' },
  token: { type: 'string' },
  'heartbeat-interval': { type: 'string' },
  'poll-interval': { type: 'string' },
  'allow-execute': { type: 'boolean', default: false },
  'allowed-tools': { type: 'string' },
  'max-turns': { type: 'string' },
};

function clampSeconds(value, fallbackSeconds, min, max) {
  const parsed = value === undefined ? fallbackSeconds : Number.parseInt(value, 10);
  const n = Number.isFinite(parsed) ? parsed : fallbackSeconds;
  return Math.max(min, Math.min(max, n));
}

export async function runConnect(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false });

  const existing = loadConfig();

  const goalId = values.goal || existing?.goalId;
  const role = values.role || existing?.role;
  const instance = values.instance || existing?.instance;
  if (!goalId || !role || !instance) {
    throw new Error('connect requires --goal <id> --role <role> --instance <label> (first run needs all three).');
  }

  const projectDir = path.resolve(values.dir || existing?.projectDir || process.cwd());
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`--dir does not exist or is not a directory: ${projectDir}`);
  }

  const baseUrl = (values['base-url'] || existing?.baseUrl || 'https://orbit.vongpichdaraboth.com').replace(/\/+$/, '');

  const token = values.token || process.env.ORBIT_API_KEY || existing?.token;
  if (!token || !token.startsWith('dgm_pat_')) {
    throw new Error('No valid token found. Pass --token <dgm_pat_...>, set $ORBIT_API_KEY, or run connect once with one to save it.');
  }

  // Constraint 1: this must be re-asserted on every connect, never
  // inherited silently from a previous run's saved config — omitting the
  // flag always means observe-only, even on a machine that had it enabled
  // before.
  const allowExecute = Boolean(values['allow-execute']);
  let allowedTools = [];
  if (allowExecute) {
    const raw = values['allowed-tools'];
    if (!raw) {
      throw new Error('--allow-execute requires --allowed-tools <comma,separated,list> (e.g. "Read,Edit,Bash(git *)").');
    }
    allowedTools = sanitizeAllowedTools(raw.split(','));
  }

  const cfg = {
    baseUrl,
    token,
    goalId,
    role,
    instance,
    projectDir,
    allowExecute,
    allowedTools,
    maxTurns: clampSeconds(values['max-turns'], existing?.maxTurns ?? 8, 1, 50),
    heartbeatIntervalMs: clampSeconds(values['heartbeat-interval'], (existing?.heartbeatIntervalMs ?? 45_000) / 1000, 10, 600) * 1000,
    pollIntervalMs: clampSeconds(values['poll-interval'], (existing?.pollIntervalMs ?? 20_000) / 1000, 5, 600) * 1000,
  };

  saveConfig(cfg);

  const { hookScriptPath, settingsPath } = installProjectHooks(projectDir);

  console.log(`orbit-agent: connected as instance=${cfg.instance} role=${cfg.role} goal=${cfg.goalId}`);
  console.log(`orbit-agent: token = ${maskToken(cfg.token)}`);
  console.log(`orbit-agent: project dir = ${cfg.projectDir}`);
  console.log(`orbit-agent: hook installed at ${hookScriptPath}`);
  console.log(`orbit-agent: merged into ${settingsPath}`);
  console.log(
    `orbit-agent: autonomous execution = ${
      cfg.allowExecute ? `ENABLED (allowed tools: ${cfg.allowedTools.join(', ')})` : 'disabled (observe-only, default)'
    }`,
  );
  console.log('orbit-agent: press Ctrl-C, or run `orbit-agent stop` from another terminal, to disconnect.\n');

  await startDaemon(cfg);
}
