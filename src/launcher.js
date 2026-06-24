#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Read the main Claude Code settings.json.
 * @returns {object}
 */
function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    throw new Error(`Claude settings not found: ${SETTINGS_PATH}`);
  }
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
}

/**
 * Merge a provider's config into the base settings.
 * Provider env vars override same-named keys in settings.env.
 * Provider enabledPlugins are merged (union) into settings.enabledPlugins.
 * @param {object} baseSettings - parsed settings.json
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @returns {object} merged settings object
 */
function mergeSettings(baseSettings, providerConfig) {
  const merged = { ...baseSettings };

  // Merge env: provider env overrides base env
  const providerEnv = providerConfig.env || {};
  merged.env = { ...(merged.env || {}), ...providerEnv };

  // Merge enabledPlugins if provider defines them
  const providerPlugins = providerConfig.enabledPlugins;
  if (providerPlugins && typeof providerPlugins === 'object') {
    merged.enabledPlugins = { ...(merged.enabledPlugins || {}), ...providerPlugins };
  }

  return merged;
}

/**
 * Write merged settings to a temp file, cleaned up on process exit.
 * @param {object} settingsObj
 * @returns {string} temp file path
 */
function writeTempSettings(settingsObj) {
  const tmpDir = path.join(os.tmpdir(), 'ccs');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `settings-${process.pid}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(settingsObj, null, 2), 'utf-8');

  // Cleanup on exit
  const cleanup = () => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  return tmpFile;
}

/**
 * Resolve the claude command for the current platform.
 * On Windows, npm global bins are .cmd files; on Unix they are plain executables.
 */
function getClaudeCmd() {
  return process.platform === 'win32' ? 'claude.cmd' : 'claude';
}

/**
 * Launch claude with merged settings.
 * @param {string} providerName - display name for log
 * @param {object} providerConfig - parsed settings_config
 * @param {string[]} extraArgs - additional args passed to claude
 * @returns {Promise<number>} exit code
 */
function launch(providerName, providerConfig, extraArgs = []) {
  const baseSettings = readSettings();
  const merged = mergeSettings(baseSettings, providerConfig);
  const tmpFile = writeTempSettings(merged);

  const cmd = getClaudeCmd();
  const args = ['--settings', tmpFile, '--dangerously-skip-permissions', ...extraArgs];

  console.log(`→ Launching [${providerName}]`);

  return new Promise((resolve) => {
    // No shell needed: cmd is explicit (claude.cmd on Windows, claude on Unix)
    const child = spawn(cmd, args, {
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      console.error(`Failed to launch claude: ${err.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      resolve(code ?? 0);
    });
  });
}

module.exports = { launch, mergeSettings, readSettings, SETTINGS_PATH };
