#!/usr/bin/env node
// report-agent-event.mjs — Claude Code PostToolUse/Stop hook, installed by
// `orbit-agent connect` into a project's .claude/settings.json (see
// ../hookInstall.mjs). This is what makes D1's "tool activity streams into
// the goal feed" true, and per D3 safety constraint 8 it must keep running
// unmodified during autonomous (--allow-execute) runs too — nothing in D3
// disables or bypasses this file.
//
// Unlike orbit's own scripts/agent-hooks/report-agent-event.mjs (which
// reads AGENT_EVENT_TOKEN/AGENT_EVENT_GOAL_ID/AGENT_EVENT_INGEST_URL from
// the environment), this copy reads the same information from
// ~/.orbit-agent/config.json — Claude Code's hooks config has no per-hook
// env-var injection we can rely on, but orbit-agent already persists this
// exact data there. Same event-ingest contract either way
// (POST /api/agent-events, Authorization: Bearer dgm_pat_...).
//
// Payload contract: only ever sends an ALLOWLIST of known-safe, structured
// fields (tool name, file path, PR url, counts) — never raw tool
// input/output/command text. api/agent-events.ts still runs its own
// server-side redaction as a mandatory backstop, but this script must not
// rely on that — it should never ship a raw blob in the first place.
//
// No-ops (exit 0, no output) whenever config is missing/unreadable, so it's
// safe to leave wired into .claude/settings.json even on a machine that
// hasn't run `orbit-agent connect` (or has since disconnected).

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_HOME = process.env.ORBIT_AGENT_HOME || homedir();
const CONFIG_PATH = join(CONFIG_HOME, '.orbit-agent', 'config.json');
const TIMEOUT_MS = 2500;
const READ_FLUSH_THRESHOLD = 25;

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

function loadAgentConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg?.token || !cfg?.goalId) return null;
    return {
      token: cfg.token,
      goalId: cfg.goalId,
      ingestUrl: `${(cfg.baseUrl || 'https://orbitkh.vercel.app').replace(/\/+$/, '')}/api/agent-events`,
    };
  } catch {
    return null;
  }
}

function safePath(value) {
  const s = typeof value === 'string' ? value : '';
  return s.slice(0, 300) || 'a file';
}

function firstLine(text) {
  return String(text || '').split('\n')[0].slice(0, 200);
}

function extractPrUrl(text) {
  const match = String(text || '').match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
  return match ? match[0] : null;
}

function looksLikeError(toolResponse) {
  if (toolResponse && typeof toolResponse === 'object' && toolResponse.error) return true;
  const text = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse ?? '');
  return /^\s*error[:\s]/i.test(text.slice(0, 200));
}

function statePath(sessionId) {
  return join(tmpdir(), `orbit-agent-events-${sessionId || 'default'}.json`);
}

function loadState(sessionId) {
  const p = statePath(sessionId);
  if (!existsSync(p)) return { count: 0, tools: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { count: 0, tools: [] };
  }
}

function saveState(sessionId, state) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {
    // best-effort only
  }
}

function clearState(sessionId) {
  try {
    unlinkSync(statePath(sessionId));
  } catch {
    // nothing to clear
  }
}

function flushBatchEvent(state) {
  if (!state.count) return null;
  const names = [...new Set(state.tools)].join(', ');
  return {
    event_type: 'tool_use_batch',
    summary: `Used ${names || 'read'} tools ${state.count} time${state.count === 1 ? '' : 's'}`,
    payload: { count: state.count, tools: state.tools },
  };
}

function classifyPostToolUse(toolName, toolInput, toolResponse) {
  if (looksLikeError(toolResponse)) {
    return {
      surfaced: true,
      event_type: 'error',
      summary: `${toolName} failed: ${firstLine(typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse))}`,
      payload: { tool: toolName },
    };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const path = safePath(toolInput?.file_path || toolInput?.path);
    return {
      surfaced: true,
      event_type: 'file_write',
      summary: `Wrote ${path}`,
      payload: { tool: toolName, file_path: path },
    };
  }

  if (toolName === 'Bash') {
    const cmd = String(toolInput?.command || '');
    if (/\bgit\s+commit\b/.test(cmd)) {
      return { surfaced: true, event_type: 'commit', summary: `git commit: ${firstLine(cmd)}`, payload: { tool: 'Bash' } };
    }
    if (/\bgit\s+push\b/.test(cmd)) {
      return { surfaced: true, event_type: 'push', summary: 'git push', payload: { tool: 'Bash' } };
    }
    if (/\bgh\s+pr\s+create\b/.test(cmd)) {
      const url = extractPrUrl(typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse ?? ''));
      return {
        surfaced: true,
        event_type: 'pr_link',
        summary: url ? `Opened pull request: ${url}` : 'Opened a pull request',
        payload: { tool: 'Bash', url },
      };
    }
  }

  if (READ_TOOLS.has(toolName) || toolName === 'Bash') {
    return { surfaced: false, tool: toolName };
  }

  return {
    surfaced: true,
    event_type: 'tool_use',
    summary: `Used ${toolName}`,
    payload: { tool: toolName },
  };
}

async function postEvents(agentConfig, events) {
  if (events.length === 0) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(agentConfig.ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentConfig.token}` },
      body: JSON.stringify({ goal_id: agentConfig.goalId, events }),
      signal: controller.signal,
    });
  } catch {
    // Best-effort telemetry — never fail or block the hook on a network error.
  } finally {
    clearTimeout(timer);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const agentConfig = loadAgentConfig();
  if (!agentConfig) return; // not connected on this machine — no-op

  const raw = await readStdin().catch(() => '');
  let hookPayload;
  try {
    hookPayload = JSON.parse(raw);
  } catch {
    return;
  }

  const sessionId = hookPayload?.session_id || 'default';
  const hookEvent = hookPayload?.hook_event_name;

  if (hookEvent === 'Stop') {
    const state = loadState(sessionId);
    const events = [];
    const batch = flushBatchEvent(state);
    if (batch) events.push(batch);
    events.push({ event_type: 'completion', summary: 'Agent session ended', payload: {} });
    clearState(sessionId);
    await postEvents(agentConfig, events);
    return;
  }

  if (hookEvent !== 'PostToolUse') return;

  const toolName = hookPayload?.tool_name || 'unknown';
  const result = classifyPostToolUse(toolName, hookPayload?.tool_input, hookPayload?.tool_response);

  if (!result.surfaced) {
    const state = loadState(sessionId);
    state.count = (state.count || 0) + 1;
    state.tools = [...(state.tools || []), result.tool].slice(-50);
    if (state.count >= READ_FLUSH_THRESHOLD) {
      const batch = flushBatchEvent(state);
      clearState(sessionId);
      if (batch) await postEvents(agentConfig, [batch]);
    } else {
      saveState(sessionId, state);
    }
    return;
  }

  const state = loadState(sessionId);
  const events = [];
  const batch = flushBatchEvent(state);
  if (batch) events.push(batch);
  clearState(sessionId);
  events.push({ event_type: result.event_type, summary: result.summary, payload: result.payload });
  await postEvents(agentConfig, events);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
