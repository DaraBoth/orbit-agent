// The `connect` daemon loop: D1 heartbeats, D2 mention poll/claim/surface,
// and (only if cfg.allowExecute) D3 execution. Runs in the foreground
// process started by `orbit-agent connect`; `orbit-agent status`/`stop` are
// separate process invocations that talk to this one only through
// state.mjs/pid.mjs on disk.
import * as orbit from './orbitClient.mjs';
import { writePid, clearPid } from './pid.mjs';
import { writeState, readState } from './state.mjs';
import { executeMention, killInFlight, isExecuting } from './claudeRunner.mjs';
import { notify } from './notify.mjs';

export async function startDaemon(cfg) {
  writePid();
  writeState({
    status: 'running',
    goalId: cfg.goalId,
    role: cfg.role,
    instance: cfg.instance,
    projectDir: cfg.projectDir,
    allowExecute: cfg.allowExecute,
    allowedTools: cfg.allowedTools,
    startedAt: new Date().toISOString(),
    currentClaim: null,
    executing: false,
  });

  let stopping = false;
  let hbTimer = null;
  let pollTimer = null;

  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`\norbit-agent: received ${signal}, shutting down...`);
    killInFlight(); // constraint 7: kill switch
    if (hbTimer) clearInterval(hbTimer);
    if (pollTimer) clearInterval(pollTimer);
    writeState({ status: 'stopped', stoppedAt: new Date().toISOString(), executing: false });
    clearPid();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const heartbeatOnce = async () => {
    try {
      const currentTaskId = readState()?.currentClaim?.task_id ?? null;
      await orbit.heartbeat(cfg, currentTaskId);
      writeState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatOk: true, lastHeartbeatError: null });
    } catch (err) {
      writeState({ lastHeartbeatAt: new Date().toISOString(), lastHeartbeatOk: false, lastHeartbeatError: String(err?.message || err) });
    }
  };

  const runExecution = async (dispatch) => {
    writeState({ executing: true, executingDispatchId: dispatch.id });
    try {
      const mentionText = await orbit.fetchCommentBody(cfg, dispatch.task_id, dispatch.comment_id);
      const result = await executeMention(cfg, { ...dispatch, mentionText });
      await orbit.completeDispatch(cfg, dispatch.id, result.summary);
      console.log(`orbit-agent: dispatch ${dispatch.id} completed and reply posted.`);
    } catch (err) {
      const message = `orbit-agent could not complete this automatically: ${String(err?.message || err)}`.slice(0, 4000);
      try {
        await orbit.completeDispatch(cfg, dispatch.id, message);
      } catch {
        // if even the failure reply can't post, there's nothing more to do locally
      }
      console.error(`orbit-agent: execution failed for dispatch ${dispatch.id}: ${err?.message || err}`);
    } finally {
      writeState({ executing: false, executingDispatchId: null, currentClaim: null });
    }
  };

  const pollOnce = async () => {
    if (isExecuting()) return; // constraint 5: one in-flight execution per instance
    try {
      const listed = await orbit.listDispatches(cfg);
      if (!listed?.dispatches || listed.dispatches.length === 0) return;

      const claimed = await orbit.claimDispatch(cfg);
      const dispatch = claimed?.dispatch;
      if (!dispatch) return; // nothing left to claim (another poll/instance beat us to it)

      writeState({ currentClaim: dispatch });
      console.log(`orbit-agent: claimed mention dispatch ${dispatch.id} (task ${dispatch.task_id ?? 'n/a'}).`);
      notify('ORBIT mention claimed', `Dispatch ${dispatch.id} on task ${dispatch.task_id ?? 'n/a'}`);

      if (!cfg.allowExecute) {
        console.log('orbit-agent: autonomous execution is disabled (observe-only) — review and reply manually in Orbit.');
        return;
      }
      await runExecution(dispatch);
    } catch (err) {
      console.error(`orbit-agent: mention poll error: ${err?.message || err}`);
    }
  };

  await heartbeatOnce();
  hbTimer = setInterval(heartbeatOnce, cfg.heartbeatIntervalMs);
  pollTimer = setInterval(pollOnce, cfg.pollIntervalMs);
  await pollOnce();

  // Keep the process alive; shutdown() is the only exit path.
  await new Promise(() => {});
}
