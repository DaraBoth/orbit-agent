import { loadConfig, maskToken } from '../config.mjs';
import { readState } from '../state.mjs';
import { readPid, isPidAlive } from '../pid.mjs';

export async function runStatus() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log('orbit-agent: not connected (no config found). Run `orbit-agent connect` first.');
    return;
  }

  const state = readState();
  const pid = readPid();
  const alive = isPidAlive(pid);

  console.log(`orbit-agent status`);
  console.log(`  goal:          ${cfg.goalId}`);
  console.log(`  role:          ${cfg.role}`);
  console.log(`  instance:      ${cfg.instance}`);
  console.log(`  project dir:   ${cfg.projectDir}`);
  console.log(`  base url:      ${cfg.baseUrl}`);
  console.log(`  token:         ${maskToken(cfg.token)}`);
  console.log(`  execution:     ${cfg.allowExecute ? `ENABLED (${(cfg.allowedTools || []).join(', ')})` : 'disabled (observe-only)'}`);
  console.log(`  process:       ${alive ? `running (pid ${pid})` : 'not running'}`);

  if (state) {
    console.log(`  last heartbeat: ${state.lastHeartbeatAt || '(none yet)'}${state.lastHeartbeatOk === false ? ' (FAILED: ' + state.lastHeartbeatError + ')' : ''}`);
    console.log(`  current claim: ${state.currentClaim ? `${state.currentClaim.id} (task ${state.currentClaim.task_id ?? 'n/a'})` : '(none)'}`);
    console.log(`  executing:     ${state.executing ? `yes (dispatch ${state.executingDispatchId})` : 'no'}`);
    console.log(`  state updated: ${state.updatedAt}`);
  } else {
    console.log('  no runtime state recorded yet (has connect ever run?).');
  }

  if (!alive && state?.status === 'running') {
    console.log('\n  Note: state says "running" but the process is not alive — it likely crashed or was killed without a clean shutdown.');
  }
}
