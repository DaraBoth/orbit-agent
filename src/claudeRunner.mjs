// D3: runs Claude Code non-interactively against a claimed mention. Every
// one of the eight ORBIT-task safety constraints that applies to execution
// mechanics (not to the opt-in gate itself, which lives in commands/connect.mjs)
// is enforced here:
//   3. explicit --allowedTools, and --dangerously-skip-permissions can never
//      reach argv, from config or otherwise.
//   4. workdir confinement — spawned with cwd fixed to the configured
//      project dir, no other path is ever passed.
//   5. one in-flight execution per instance.
//   7. a working kill switch (killInFlight, used by SIGINT/SIGTERM and
//      `orbit-agent stop`).
import { spawn } from 'node:child_process';
import { buildMentionPrompt } from './promptTemplate.mjs';

const FORBIDDEN_FLAG = '--dangerously-skip-permissions';

// Deliberately conservative: letters/digits/underscore for the tool name,
// optionally followed by a parenthesized scope like "Bash(git *)" — the
// shape Claude Code's --allowedTools already uses. Anything else is
// rejected rather than guessed at.
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\([^()]*\))?$/;

let inFlight = null; // { child, dispatchId } | null

export function isExecuting() {
  return inFlight !== null;
}

export function currentDispatchId() {
  return inFlight?.dispatchId ?? null;
}

export function sanitizeAllowedTools(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const cleaned = list.map((t) => String(t).trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error('--allow-execute requires a non-empty --allowed-tools list.');
  }
  for (const tool of cleaned) {
    if (tool.toLowerCase().includes('dangerously-skip-permissions')) {
      throw new Error(`Refusing forbidden token in --allowed-tools: ${tool}`);
    }
    if (!TOOL_NAME_PATTERN.test(tool)) {
      throw new Error(`Refusing unrecognized --allowed-tools entry: ${tool}`);
    }
  }
  return cleaned;
}

// Pure, independently testable: builds the argv array for `claude` without
// touching the filesystem or spawning anything. Every field that could
// possibly be attacker- or config-influenced (prompt text, tool list,
// max-turns) flows through here as a single opaque argv element each —
// spawn() (no shell:true, see below) passes argv straight to execve, so
// nothing inside any one element can introduce a new flag.
export function buildClaudeArgs({ prompt, allowedTools, maxTurns }) {
  const tools = sanitizeAllowedTools(allowedTools);
  const turns = Math.max(1, Math.min(50, Number.parseInt(maxTurns, 10) || 8));
  const args = ['-p', prompt, '--allowedTools', tools.join(','), '--max-turns', String(turns), '--output-format', 'json'];
  assertSafeArgv(args);
  return args;
}

// Defense in depth: even though nothing above ever constructs this flag,
// assert it on every call site right before spawning. This is what
// test/test-no-skip-permissions.mjs exercises directly.
//
// Index 1 is always the `-p` prompt value (see buildClaudeArgs) and is
// exempt from this scan on purpose: spawn() runs with no shell, so argv is
// handed straight to execve — nothing in the prompt's *content* can ever be
// reinterpreted as a separate flag, only consumed as that one string value.
// Flagging it here would just make execution fail closed (safely) whenever
// a mention happens to quote the flag's name, which is unnecessary. Every
// other slot is a flag/value we construct ourselves (or, for the tool
// list, a value already vetted by sanitizeAllowedTools), so any occurrence
// there means a real bug upstream and must abort.
const PROMPT_VALUE_INDEX = 1;

export function assertSafeArgv(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (i === PROMPT_VALUE_INDEX) continue;
    if (String(args[i]).includes(FORBIDDEN_FLAG)) {
      throw new Error(`Refusing to spawn claude: forbidden flag detected (${FORBIDDEN_FLAG}).`);
    }
  }
  return args;
}

function extractSummary(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return '(orbit-agent: the run produced no output)';
  try {
    const parsed = JSON.parse(trimmed);
    const text = parsed?.result ?? parsed?.summary ?? null;
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 4000);
  } catch {
    // not JSON (or --output-format json shape changed) — fall back to raw text below
  }
  return trimmed.slice(0, 4000);
}

// Runs one claimed mention through Claude Code and resolves with a
// human-readable summary suitable for posting back as the dispatch reply.
export async function executeMention(cfg, dispatch) {
  if (inFlight) {
    throw new Error('An execution is already in progress for this instance (one at a time).');
  }

  const { prompt } = buildMentionPrompt({
    mentionText: dispatch.mentionText || '',
    projectDir: cfg.projectDir,
    taskId: dispatch.task_id,
    dispatchId: dispatch.id,
  });

  const args = buildClaudeArgs({ prompt, allowedTools: cfg.allowedTools, maxTurns: cfg.maxTurns });

  return new Promise((resolve, reject) => {
    // shell:false (the spawn default) is load-bearing: argv is passed
    // straight to execve, never through /bin/sh, so nothing in the prompt
    // or tool list can be reinterpreted as shell syntax.
    const child = spawn('claude', args, {
      cwd: cfg.projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    inFlight = { child, dispatchId: dispatch.id };

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('error', (err) => {
      inFlight = null;
      reject(err);
    });

    child.on('close', (code) => {
      inFlight = null;
      if (code === 0) {
        resolve({ summary: extractSummary(stdout), stdout, stderr, code });
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim().slice(0, 500) || '(no stderr)'}`));
      }
    });
  });
}

// Constraint 7: Ctrl-C and `orbit-agent stop` both route here.
export function killInFlight() {
  if (inFlight) {
    inFlight.child.kill('SIGTERM');
  }
}
