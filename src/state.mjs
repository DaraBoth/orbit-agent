// Runtime status snapshot (not secret — no token lives here) so `orbit-agent
// status`, run from a fresh process, can report on a `connect` daemon
// running elsewhere without any IPC beyond the filesystem.
import fs from 'node:fs';
import { STATE_PATH, ensureConfigDir } from './config.mjs';

export function writeState(partial) {
  ensureConfigDir();
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    // no prior state, or unreadable — start fresh
  }
  state = { ...state, ...partial, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}
