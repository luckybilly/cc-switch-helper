#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const SQL_QUERY = `
  SELECT name, settings_config, meta, is_current
  FROM providers
  WHERE app_type = 'claude'
  ORDER BY is_current DESC, sort_index ASC, name ASC
`;

const COMMON_CONFIG_KEY = 'common_config_claude';

/**
 * Open the CC-Switch SQLite database in read-only mode (loaded into memory).
 * @returns {Promise<import('sql.js').Database>}
 */
async function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `CC-Switch database not found: ${DB_PATH}\n` +
      'Please install CC-Switch and configure at least one provider first.'
    );
  }
  const buffer = fs.readFileSync(DB_PATH);
  const SQL = await initSqlJs();
  return new SQL.Database(buffer);
}

/**
 * Read the Claude common config that CC-Switch merges into every provider
 * whose meta.commonConfigEnabled is true. Stored as JSON in the `settings`
 * table under the `common_config_claude` key.
 * @returns {Promise<object>} parsed common config (empty object if absent)
 */
async function getCommonConfig() {
  const db = await openDb();
  try {
    const results = db.exec(
      `SELECT value FROM settings WHERE key = '${COMMON_CONFIG_KEY}'`
    );
    if (!results.length || !results[0].values.length) return {};
    try {
      return JSON.parse(results[0].values[0][0]);
    } catch {
      return {};
    }
  } finally {
    db.close();
  }
}

/**
 * Read CC-Switch proxy settings for Claude.
 * @returns {Promise<{enabled: boolean, baseUrl: string | null}>}
 */
async function getProxyConfig() {
  const db = await openDb();
  try {
    let results;
    try {
      results = db.exec(
        "SELECT proxy_enabled, enabled, listen_address, listen_port FROM proxy_config WHERE app_type = 'claude'"
      );
    } catch {
      return { enabled: false, baseUrl: null };
    }

    if (!results.length || !results[0].values.length) {
      return { enabled: false, baseUrl: null };
    }

    const [proxyEnabled, enabled, listenAddress, listenPort] = results[0].values[0];
    const isEnabled = Number(proxyEnabled) === 1 && Number(enabled) === 1;
    const address = normalizeProxyAddress(listenAddress || '127.0.0.1');
    const port = listenPort || 15721;
    return {
      enabled: isEnabled,
      baseUrl: isEnabled ? `http://${address}:${port}` : null,
    };
  } finally {
    db.close();
  }
}

function normalizeProxyAddress(address) {
  const connectHost = address === '0.0.0.0'
    ? '127.0.0.1'
    : address === '::'
      ? '::1'
      : address;
  return connectHost.includes(':') && !connectHost.startsWith('[')
    ? `[${connectHost}]`
    : connectHost;
}

/**
 * Read Claude's current global settings. When CC-Switch proxy routing is enabled,
 * CC-Switch writes ~/.claude/settings.json to point at its local proxy; reusing
 * that env keeps ccs-launched sessions on the same route as plain `claude`.
 * @returns {object} parsed settings (empty object if absent or invalid)
 */
function getClaudeSettings() {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Read all Claude providers from CC-Switch SQLite database.
 * @returns {Promise<Array<{name: string, config: object, commonConfigEnabled: boolean, isCurrent: boolean}>>}
 */
async function getProviders() {
  const db = await openDb();
  try {
    const results = db.exec(SQL_QUERY);
    if (!results.length || !results[0].values.length) {
      throw new Error('No Claude providers found in CC-Switch database.');
    }

    return results[0].values.map(([name, settingsConfig, meta, isCurrent]) => {
      let config;
      try {
        config = JSON.parse(settingsConfig);
      } catch {
        config = { env: {} };
      }

      let commonConfigEnabled = false;
      try {
        commonConfigEnabled = JSON.parse(meta).commonConfigEnabled === true;
      } catch {
        /* leave false */
      }

      return {
        name,
        config,
        commonConfigEnabled,
        isCurrent: !!isCurrent,
      };
    });
  } finally {
    db.close();
  }
}

module.exports = {
  getProviders,
  getCommonConfig,
  getProxyConfig,
  getClaudeSettings,
  DB_PATH,
  CLAUDE_SETTINGS_PATH,
};
