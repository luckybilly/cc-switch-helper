#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

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

module.exports = { getProviders, getCommonConfig, DB_PATH };
