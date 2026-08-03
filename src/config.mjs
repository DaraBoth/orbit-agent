// Config + runtime-state paths and I/O. All local state lives under one
// directory so `orbit-agent stop`/`status` (a different process invocation
// than `connect`) can find it.
//
// ORBIT_AGENT_HOME overrides the base directory. Tests use it to avoid
// touching a real $HOME — and real usage needs it to run MORE THAN ONE agent
// identity on the same machine, since all state is keyed off this one dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseDir = process.env.ORBIT_AGENT_HOME || os.homedir();

export const CONFIG_DIR = path.join(baseDir, '.orbit-agent');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const STATE_PATH = path.join(CONFIG_DIR, 'state.json');
export const PID_PATH = path.join(CONFIG_DIR, 'orbit-agent.pid');
export const HOOK_SCRIPT_PATH = path.join(CONFIG_DIR, 'hooks', 'report-agent-event.mjs');
export const INBOX_SCRIPT_PATH = path.join(CONFIG_DIR, 'hooks', 'check-orbit-inbox.mjs');

export function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG_DIR, 0o700);
  fs.mkdirSync(path.dirname(HOOK_SCRIPT_PATH), { recursive: true, mode: 0o700 });
}

// Secrets (the dgm_pat_ token) live in this file — chmod 0600 and never
// logged. Written with mode at creation time AND chmod'd explicitly
// afterward, since an existing file from a prior run keeps its old mode
// across a plain writeFileSync with a `mode` option.
// Warns when this overwrites a DIFFERENT identity. All local state lives in
// one directory keyed off ORBIT_AGENT_HOME, so running two identities on one
// machine (e.g. dev-agent and pm-agent side by side) needs a separate
// ORBIT_AGENT_HOME per identity — otherwise the second silently clobbers the
// first, and a later `stop`/`status`/`init` acts on the wrong one.
export function saveConfig(cfg) {
  const prev = loadConfig();
  if (prev && (prev.role !== cfg.role || prev.instance !== cfg.instance)) {
    console.warn(
      `orbit-agent: WARNING — replacing the saved identity ` +
      `${prev.role}@${prev.instance} with ${cfg.role}@${cfg.instance} in ${CONFIG_PATH}.\n` +
      `orbit-agent:   To run both on this machine, give each its own state dir:\n` +
      `orbit-agent:     ORBIT_AGENT_HOME=~/.orbit-${cfg.role} orbit-agent ...`,
    );
  }
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// For display only — never print the real token.
export function maskToken(token) {
  if (!token || typeof token !== 'string') return '(none)';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}
