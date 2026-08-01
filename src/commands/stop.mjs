import { readPid, isPidAlive, clearPid } from '../pid.mjs';
import { writeState } from '../state.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Constraint 7 (the other half — see claudeRunner.killInFlight for the
// in-process Ctrl-C path): signals the running `connect` process from a
// separate invocation. SIGTERM is handled there by daemon.mjs's shutdown(),
// which kills any in-flight claude child before exiting.
export async function runStop() {
  const pid = readPid();
  if (!pid || !isPidAlive(pid)) {
    console.log('orbit-agent: not running.');
    clearPid();
    return;
  }

  console.log(`orbit-agent: stopping (pid ${pid})...`);
  process.kill(pid, 'SIGTERM');

  for (let i = 0; i < 50; i += 1) {
    await sleep(100);
    if (!isPidAlive(pid)) {
      console.log('orbit-agent: stopped.');
      return;
    }
  }

  console.log('orbit-agent: process did not exit after 5s, sending SIGKILL.');
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
  clearPid();
  writeState({ status: 'stopped', stoppedAt: new Date().toISOString(), executing: false });
}
