#!/usr/bin/env node
// check-orbit-inbox.mjs — on-demand check for pending @mention dispatches,
// used by the /orbit-inbox slash command. Self-contained (no imports from
// src/*, only node builtins) for the same reason report-agent-event.mjs is:
// it's copied out to a stable path outside npx's cache so it keeps working
// after the `orbit-agent init` process that installed it has exited.
//
// Lists only — never claims. Claiming (and, if --allow-execute was ever
// turned on, executing) is the running `orbit-agent connect` daemon's job.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_PATH = join(process.env.ORBIT_AGENT_HOME || homedir(), '.orbit-agent', 'config.json');
const TIMEOUT_MS = 10_000;

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const cfg = loadConfig();
  if (!cfg) {
    console.log('orbit-agent: not connected (no config at ~/.orbit-agent/config.json). Run `orbit-agent init` first.');
    return;
  }

  const url = new URL(`${cfg.baseUrl}/api/agent-mention-dispatches`);
  url.searchParams.set('goal_id', cfg.goalId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: controller.signal });
  } catch (err) {
    console.log(`orbit-agent: could not reach ${cfg.baseUrl}: ${err?.message || err}`);
    return;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.log(`orbit-agent: inbox check failed — HTTP ${res.status}${json?.error ? `: ${json.error}` : ''}`);
    return;
  }

  const dispatches = json?.dispatches || [];
  if (dispatches.length === 0) {
    console.log('orbit-agent: no pending @mention dispatches.');
    return;
  }

  console.log(`orbit-agent: ${dispatches.length} pending @mention dispatch(es):`);
  for (const d of dispatches) {
    console.log(`  - ${d.id}  task=${d.task_id ?? 'n/a'}  created=${d.created_at}`);
  }
  console.log('\nRun `orbit-agent connect` to have these claimed and surfaced automatically, or open the task directly in ORBIT.');
}

main()
  .catch((err) => {
    console.error(`orbit-agent: unexpected error: ${err?.message || err}`);
    process.exitCode = 1;
  });
