// Installs the ORBIT skill (behaviour guidance for the model — how to work
// tasks) and the /orbit-inbox slash command into a project's .claude/
// directory. Separate from hookInstall.mjs because these are plain
// create-or-overwrite files (no merge-with-existing-content concern like
// settings.json has) — writing the same generated content on every `init`
// is what makes this idempotent, not a dedup check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INBOX_SCRIPT_PATH, ensureConfigDir } from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILL_SOURCE = path.join(__dirname, 'templates', 'orbit-skill.md');
const BUNDLED_INBOX_COMMAND_SOURCE = path.join(__dirname, 'templates', 'orbit-inbox-command.md');
const BUNDLED_INBOX_SCRIPT_SOURCE = path.join(__dirname, 'hook-scripts', 'check-orbit-inbox.mjs');

function fillTemplate(template, replacements) {
  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(key, value);
  }
  return out;
}

// Same npx-cache-eviction reasoning as hookInstall.js's installHookScript:
// copied to a stable path outside the package's own install location, so
// the /orbit-inbox command keeps working after `init`'s npx cache is gone.
export function installInboxScript() {
  ensureConfigDir();
  fs.copyFileSync(BUNDLED_INBOX_SCRIPT_SOURCE, INBOX_SCRIPT_PATH);
  fs.chmodSync(INBOX_SCRIPT_PATH, 0o700);
  return INBOX_SCRIPT_PATH;
}

export function installOrbitSkill(projectDir, cfg) {
  const skillDir = path.join(projectDir, '.claude', 'skills', 'orbit');
  fs.mkdirSync(skillDir, { recursive: true });
  const template = fs.readFileSync(BUNDLED_SKILL_SOURCE, 'utf8');
  const filled = fillTemplate(template, {
    __GOAL_ID__: cfg.goalId,
    __BASE_URL__: cfg.baseUrl,
    __ROLE__: cfg.role,
    __INSTANCE__: cfg.instance,
  });
  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillPath, filled);
  return skillPath;
}

export function installOrbitInboxCommand(projectDir) {
  const inboxScriptPath = installInboxScript();
  const commandsDir = path.join(projectDir, '.claude', 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });
  const template = fs.readFileSync(BUNDLED_INBOX_COMMAND_SOURCE, 'utf8');
  const filled = fillTemplate(template, { __INBOX_SCRIPT_PATH__: inboxScriptPath });
  const commandPath = path.join(commandsDir, 'orbit-inbox.md');
  fs.writeFileSync(commandPath, filled);
  return { commandPath, inboxScriptPath };
}
