// Thin client for the ORBIT Agent Workspace HTTP contract. Every call is
// plain fetch with a bounded timeout — no retry/backoff cleverness, callers
// (daemon.mjs) already run on their own interval and tolerate a failed tick.

const DEFAULT_TIMEOUT_MS = 10_000;

async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const message = (json && json.error) || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(cfg) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.token}`,
  };
}

export async function heartbeat(cfg, currentTaskId) {
  return requestJson(`${cfg.baseUrl}/api/agent-heartbeat`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: { current_task_id: currentTaskId ?? null },
  });
}

export async function listDispatches(cfg) {
  const url = new URL(`${cfg.baseUrl}/api/agent-mention-dispatches`);
  url.searchParams.set('goal_id', cfg.goalId);
  return requestJson(url, { headers: authHeaders(cfg) });
}

export async function claimDispatch(cfg) {
  return requestJson(`${cfg.baseUrl}/api/agent-mention-dispatches`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: { action: 'claim' },
  });
}

export async function completeDispatch(cfg, dispatchId, replyBody) {
  return requestJson(`${cfg.baseUrl}/api/agent-mention-dispatches`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: { action: 'complete', dispatch_id: dispatchId, body: replyBody },
  });
}

export async function postEvents(cfg, events) {
  return requestJson(`${cfg.baseUrl}/api/agent-events`, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: { goal_id: cfg.goalId, events },
  });
}

// agent-mention-dispatches only returns the dispatch row (id, comment_id,
// task_id, ...) — never the comment text itself (see
// supabase/migrations/20260731000004_agent_workspace_f4_mention_dispatch.sql
// in the orbit repo: mention_dispatches has no body column, the text lives
// on task_comments.body). The MCP endpoint's `tasks.comments` tool is the
// existing, already-live way to read it (same dgm_pat_ token; the same
// mechanism apps/dailygoalmap/public/orbit.cjs already uses successfully on
// this host) — a different header (X-Project-Api-Key) than the Bearer auth
// the F1-F4 endpoints use, but the same underlying token.
export async function fetchCommentBody(cfg, taskId, commentId) {
  const result = await requestJson(`${cfg.baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-Api-Key': cfg.token },
    body: { tool: 'tasks.comments', input: { task_id: taskId, limit: 50 } },
  });
  const comments = result?.comments || [];
  const match = comments.find((c) => c.id === commentId);
  if (match) return match.body || '';
  // Fall back to the most recent comment rather than failing outright —
  // the prompt template still frames whatever text we got as untrusted, so
  // a wrong-but-real comment is safer to hand to the model than nothing.
  return comments.length > 0 ? comments[comments.length - 1].body || '' : '';
}
