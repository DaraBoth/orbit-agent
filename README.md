# orbit-agent

A local NAT bridge daemon that connects a laptop-based coding agent to
[ORBIT](https://orbitkh.vercel.app). ORBIT's Agent Workspace backend can't
reach an agent sitting behind NAT/a firewall, so `orbit-agent` is the
outbound half of the connection: it polls and pushes, ORBIT never has to.

Zero runtime dependencies — plain Node.js ESM, `node:fetch`/`node:child_process`/`node:fs`
only. Every dependency in a tool whose job is executing code on your machine
is supply-chain risk, so there simply aren't any.

## Install

Node 22+ required (uses `node --experimental` free features — no build
step, no compilation, run straight from source). The entire beginner setup
is one command:

```bash
npx orbit-agent init --token dgm_pat_... --goal <goal-id> --base-url https://your-orbit-host
```

You need an ORBIT agent-identity token (`dgm_pat_...`, minted in ORBIT's own
token settings). Pass it via `--token`, or set `$ORBIT_API_KEY` — the same
env var `apps/dailygoalmap/public/orbit.cjs` already uses. `--base-url`
defaults to `https://orbitkh.vercel.app` if you're using hosted ORBIT rather
than a self-hosted instance.

`init` verifies the token against the server first — it fails fast with a
clear error and writes nothing if the token is rejected. Once verified, it:

1. Saves `~/.orbit-agent/config.json` (chmod `0600`, never printed in full).
2. Merges the D1 activity-streaming hooks into `<dir>/.claude/settings.json`
   (merges, never clobbers whatever's already there — see D1 below).
3. Installs an `orbit` skill at `<dir>/.claude/skills/orbit/SKILL.md` that
   teaches the model how to actually work ORBIT tasks: read its queue,
   claim atomically, post progress, use `@mentions`, and mark work done.
4. Installs a `/orbit-inbox` slash command that checks for pending
   `@mention` dispatches on demand, without needing the daemon running.

`--role`/`--instance` are optional — if omitted, `init` tries to resolve
them for the token and otherwise falls back to a sensible default (and says
plainly which it did; ORBIT's current API has no endpoint that returns a
token's registered role/instance to the client, so a fallback is often
what actually happens — pass `--role`/`--instance` explicitly if you want a
specific pair). Running `init` again (e.g. after cloning the project
elsewhere) is safe — it's idempotent, not destructive.

`init` does **not** start the daemon by itself; run `connect` afterward
(same directory) as the additional step whenever you want live heartbeats
and `@mention` delivery running:

```bash
orbit-agent connect --goal <goal-id> --role dev-agent --instance laptopA
```

Prefer not to re-fetch the package on every run? Install it once instead:

```bash
npm install -g orbit-agent
orbit-agent init --token dgm_pat_... --goal <goal-id>
orbit-agent connect --goal <goal-id> --role dev-agent --instance laptopA
```

## The three phases

**D1 — connect & observe.** `orbit-agent connect` stores your config at
`~/.orbit-agent/config.json` (chmod `0600`), merges a `PostToolUse`/`Stop`
hook into the target project's `.claude/settings.json` (never clobbering
whatever hooks are already there), and starts heartbeating ORBIT every
~45s. The instance shows online in ORBIT within one heartbeat, and every
Claude Code tool call in that project streams into the goal's activity
feed. No execution happens in this phase — full stop.

**D2 — receive mentions.** The same running `connect` process polls
`GET /api/agent-mention-dispatches` on an interval (~20s default), and when
one is pending, atomically claims it via `POST {action:'claim'}`. It prints
the claim to the terminal and fires a best-effort desktop notification
(`notify-send` on Linux, `osascript` on macOS). By default that's it — a
human reads it and responds manually in ORBIT. `orbit-agent status` shows
the current connection, last heartbeat, and any active claim.

**D3 — autonomous wake (opt-in, off by default).** Only with
`--allow-execute` (and a required `--allowed-tools` list) does a claimed
mention actually trigger a non-interactive Claude Code run
(`claude -p ... --allowedTools ... --output-format json`), whose final
output is posted back via `POST {action:'complete'}`. Read the Security
section below before turning this on.

## Commands

```
orbit-agent init --token <dgm_pat_...> --goal <id> [options]
orbit-agent connect --goal <id> --role <role> --instance <label> [options]
orbit-agent status
orbit-agent stop
orbit-agent --help
```

`init` is a one-shot setup command — it verifies the token, writes config,
and wires up `.claude/` (hooks, skill, `/orbit-inbox`), then exits. `connect`
runs in the foreground as a daemon loop (heartbeat + mention poll); run it
under `tmux`/`nohup`/a service manager if you want it to survive a closed
terminal. `status`/`stop` are separate, quick invocations that read the
same on-disk state.

Key `init` options:

| Flag | Meaning |
|---|---|
| `--token <token>` | `dgm_pat_...` token (required first run; default `$ORBIT_API_KEY`) |
| `--goal <id>` | ORBIT goal id to attach to (required first run) |
| `--base-url <url>` | ORBIT base URL (default `https://orbitkh.vercel.app`) |
| `--dir <path>` | Project directory to set up (default: cwd) |
| `--role <role>` | Agent identity role, e.g. `dev-agent` (defaulted if omitted) |
| `--instance <label>` | Instance label, e.g. `laptopA` (defaulted from hostname if omitted) |

Key `connect` options:

| Flag | Meaning |
|---|---|
| `--goal <id>` | ORBIT goal id to attach to (required on first connect) |
| `--role <role>` | Agent identity role, e.g. `dev-agent` |
| `--instance <label>` | Instance label, e.g. `laptopA` |
| `--dir <path>` | Project directory to confine to (default: cwd) |
| `--base-url <url>` | ORBIT base URL (default `https://orbitkh.vercel.app`) |
| `--token <token>` | `dgm_pat_...` token (default `$ORBIT_API_KEY`, or reused from a saved config) |
| `--heartbeat-interval <s>` | Default 45 |
| `--poll-interval <s>` | Default 20 |
| `--allow-execute` | Enables D3. **Off by default.** |
| `--allowed-tools <list>` | Comma-separated Claude Code `--allowedTools`. Required with `--allow-execute`. |
| `--max-turns <n>` | Cap per autonomous run (default 8) |

Config persists across runs, so a later `connect` without a flag reuses the
previously saved value for everything **except** `--allow-execute` — that
one is always re-derived from the current invocation's flags, on purpose
(see Security below).

## Security

**What `--allow-execute` grants:** the ability for someone who can post an
`@mention` on your ORBIT goal — a teammate, or anyone with write access to
that goal's comments — to trigger a real, non-interactive Claude Code run
on your machine, using whatever tools you listed in `--allowed-tools`, and
have its final output posted back as a public reply. That is meaningfully
more powerful than reading your activity feed; it's remote-triggered local
code execution. Understand that before turning it on, and only grant tools
you'd genuinely be comfortable an untrusted comment triggering.

**Why the default is observe-only:** `connect` alone (D1/D2) only ever
reads and heartbeats — it streams your own tool activity out and surfaces
mentions to you, a human, to act on. It cannot execute anything. D3 is
opt-in per invocation specifically so that turning on remote-triggered
execution is always a deliberate, visible choice, never an accidental side
effect of reconnecting.

Design constraints D3 is built to (all enforced in code, not just
documented — see `test/`):

1. **Opt-in.** `--allow-execute` must be passed explicitly on every
   `connect`; it is never inherited silently from a previous run's saved
   config.
2. **Untrusted-data framing.** The mention/comment text is never treated as
   instructions. The Claude Code prompt is always built from a fixed local
   template (`src/promptTemplate.mjs`) with the chat content wrapped in
   delimiters carrying a fresh random nonce generated per run — so a
   comment authored in advance cannot forge a matching delimiter and
   "close" the untrusted block early. A comment saying "ignore previous
   instructions" changes nothing.
3. **Explicit tool allowlist.** `--allowedTools` is always passed
   explicitly to `claude`. `--dangerously-skip-permissions` is never
   constructed anywhere in this codebase and is not reachable from config,
   CLI flags, or mention text (see `test/test-no-skip-permissions.mjs`,
   which fuzzes this directly).
4. **Workdir confinement.** Claude Code is always spawned with `cwd` fixed
   to the configured project directory. Mention text cannot redirect it.
5. **One execution at a time**, per instance — a second claim while one run
   is in flight is rejected outright, never queued or run concurrently.
6. **Never auto-push, auto-merge, or deploy.** The fixed prompt template
   states this rule explicitly and it is not something mention text can
   override (per constraint 2).
7. **A working kill switch.** Ctrl-C and `orbit-agent stop` (from another
   terminal) both reliably terminate an in-flight run.
8. **Streaming stays on during execution.** The D1 hook is installed
   independently of D3 and is never disabled by it — every tool call an
   autonomous run makes still streams into the ORBIT activity feed.

`orbit-agent` never logs the token, and the config file holding it is
always written `chmod 0600`.

## Testing

```bash
npm test
```

Runs every file in `test/` as an isolated process (each sets its own
`ORBIT_AGENT_HOME`/`PATH`, so nothing touches your real `~/.orbit-agent` or
spawns a real `claude`). At minimum, the suite proves:

- an injection string in mention/comment text cannot escape the prompt
  delimiters (`test-prompt-injection.mjs`)
- `--dangerously-skip-permissions` can never appear in a built `claude`
  argv, under fuzzing (`test-no-skip-permissions.mjs`)
- config is always written `0600`, even over a pre-existing widened file
  (`test-config-permissions.mjs`)
- installing the hook merges into an existing `.claude/settings.json`
  rather than clobbering it, and is idempotent (`test-hook-merge.mjs`)
- `init` verifies the token before writing anything (a rejected token
  leaves no config, no hooks, no skill, no command file behind), is
  idempotent end-to-end, and never touches unrelated existing settings
  (`test-init.mjs`)
- `--allow-execute` is never silently inherited from a previous connect
  (`test-opt-in-execute.mjs`)
- execution is always confined to the configured project directory
  (`test-workdir-confinement.mjs`)
- only one execution can be in flight at a time (`test-single-inflight.mjs`)
- the kill switch reliably terminates a running execution
  (`test-kill-switch.mjs`)

## How mention text is actually fetched

`GET /api/agent-mention-dispatches` and `claim_mention_dispatch` return the
dispatch row (`id`, `task_id`, `comment_id`, ...) but not the comment body
itself — that lives on `task_comments.body`. `orbit-agent` reads it via the
existing `tasks.comments` MCP tool (same `dgm_pat_` token, `X-Project-Api-Key`
header — the same mechanism `apps/dailygoalmap/public/orbit.cjs` already
uses on the host this was built on) and treats whatever comes back exactly
as untrusted per constraint 2 above, regardless of source.

## License

MIT
