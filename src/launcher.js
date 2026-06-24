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
 * Provider enabledPlugins are merged into settings.enabledPlugins.
 * @param {object} baseSettings - parsed settings.json
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @returns {string} merged settings as compact JSON string
 */
function mergeSettings(baseSettings, providerConfig) {
  const merged = { ...baseSettings };

  const providerEnv = providerConfig.env || {};
  merged.env = { ...(merged.env || {}), ...providerEnv };

  const providerPlugins = providerConfig.enabledPlugins;
  if (providerPlugins && typeof providerPlugins === 'object') {
    merged.enabledPlugins = { ...(merged.enabledPlugins || {}), ...providerPlugins };
  }

  return JSON.stringify(merged);
}

/**
 * Resolve the claude command for the current platform.
 * On Windows, npm global bins are .cmd files.
 */
function getClaudeCmd() {
  return process.platform === 'win32' ? 'claude.cmd' : 'claude';
}

/**
 * Launch claude with merged settings passed as a JSON string.
 * claude --settings accepts either a file path or a JSON string directly.
 * @param {string} providerName - display name for log
 * @param {object} providerConfig - parsed settings_config
 * @param {string[]} extraArgs - additional args passed to claude
 * @returns {Promise<number>} exit code
 */
function launch(providerName, providerConfig, extraArgs = []) {
  const baseSettings = readSettings();
  const settingsJson = mergeSettings(baseSettings, providerConfig);

  const cmd = getClaudeCmd();
  const args = ['--settings', settingsJson, '--dangerously-skip-permissions', ...extraArgs];

  console.log(`→ Launching [${providerName}]`);

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });

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
