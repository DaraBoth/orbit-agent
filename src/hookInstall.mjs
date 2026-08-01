// D1: installs the bundled event-streaming hook script to a stable path and
// wires it into a project's .claude/settings.json — merging into whatever
// hooks block (and any other settings) are already there. Never clobbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_SCRIPT_PATH, ensureConfigDir } from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_HOOK_SOURCE = path.join(__dirname, 'hook-scripts', 'report-agent-event.mjs');

// Copies the hook script to a fixed path outside node_modules/npx's cache
// (~/.orbit-agent/hooks/...) so it keeps working after the npx-run
// `orbit-agent connect` process exits and the cache is evicted — the
// settings.json entry references this stable path, not the package's own
// install location.
export function installHookScript() {
  ensureConfigDir();
  fs.copyFileSync(BUNDLED_HOOK_SOURCE, HOOK_SCRIPT_PATH);
  fs.chmodSync(HOOK_SCRIPT_PATH, 0o700);
  return HOOK_SCRIPT_PATH;
}

function normalizeSettings(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function addHookEntry(hooksBlock, eventName, command, matcher) {
  const list = Array.isArray(hooksBlock[eventName]) ? hooksBlock[eventName] : [];
  const alreadyPresent = list.some(
    (entry) =>
      entry &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h && h.type === 'command' && h.command === command),
  );
  if (!alreadyPresent) {
    const entry = { hooks: [{ type: 'command', command }] };
    if (matcher !== undefined) entry.matcher = matcher;
    list.push(entry);
  }
  hooksBlock[eventName] = list;
}

// Reads, merges, writes. Any settings.json content unrelated to `hooks` (or
// hooks for other events) is preserved byte-for-byte in structure — only
// PostToolUse/Stop gain one additional entry each, and only if our command
// isn't already present (idempotent across repeated `connect` runs).
export function mergeHooksIntoSettings(settingsPath, hookCommand) {
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    try {
      settings = normalizeSettings(JSON.parse(raw));
    } catch {
      throw new Error(`${settingsPath} contains invalid JSON — refusing to overwrite it. Fix or remove it first.`);
    }
  }

  settings.hooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};

  addHookEntry(settings.hooks, 'PostToolUse', hookCommand, '*');
  addHookEntry(settings.hooks, 'Stop', hookCommand, undefined);

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

export function installProjectHooks(projectDir) {
  const hookScriptPath = installHookScript();
  const command = `node ${JSON.stringify(hookScriptPath)}`;
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  mergeHooksIntoSettings(settingsPath, command);
  return { hookScriptPath, settingsPath };
}
