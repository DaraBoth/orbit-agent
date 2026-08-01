import fs from 'node:fs';
import { PID_PATH, ensureConfigDir } from './config.mjs';

export function writePid(pid = process.pid) {
  ensureConfigDir();
  fs.writeFileSync(PID_PATH, String(pid));
}

export function readPid() {
  try {
    const raw = fs.readFileSync(PID_PATH, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function clearPid() {
  try {
    fs.unlinkSync(PID_PATH);
  } catch {
    // already gone
  }
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    // Signal 0 does no killing — it just probes whether the pid exists and
    // is signalable by us.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
