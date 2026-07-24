#!/usr/bin/env node

const spawn = require('cross-spawn');

/**
 * Resolve the claude command for the current platform.
 * On Windows, npm global bins are .cmd files.
 */
function getClaudeCmd() {
  return process.platform === 'win32' ? 'claude.cmd' : 'claude';
}

/**
 * Deep-clone a JSON value (cc-switch's `Value::clone` equivalent).
 */
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function routeEnvKey(key) {
  return key === 'ANTHROPIC_API_KEY' ||
    key === 'ANTHROPIC_AUTH_TOKEN' ||
    key === 'ANTHROPIC_BASE_URL';
}

function applyProxyRouteEnv(settings, proxyConfig, routeSettings) {
  if (!proxyConfig?.enabled || !routeSettings?.env) {
    return settings;
  }

  const routeEnv = routeSettings.env;
  if (routeEnv.ANTHROPIC_BASE_URL !== proxyConfig.baseUrl) {
    return settings;
  }

  const result = cloneJson(settings);
  result.env = isPlainObject(result.env) ? result.env : {};

  for (const [key, value] of Object.entries(routeEnv)) {
    if (routeEnvKey(key)) {
      result.env[key] = value;
    }
  }

  return result;
}

/**
 * Mirror cc-switch's `json_deep_merge(target, source)` exactly
 * (src-tauri/src/services/provider/live.rs).
 *
 * `source` is merged into `target`:
 *  - object↔object: recurse per key — keys only in `source` are inserted,
 *    keys only in `target` are kept, shared keys recurse
 *  - any leaf or type mismatch: `source` OVERWRITES `target`
 *
 * So when called as `jsonDeepMerge(providerConfig, commonConfig)`, common
 * wins on leaf conflicts — matching cc-switch's effective-settings build.
 * Mutates and returns `target`.
 */
function jsonDeepMerge(target, source) {
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const [key, sourceValue] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = jsonDeepMerge(target[key], sourceValue);
      } else {
        target[key] = cloneJson(sourceValue);
      }
    }
    return target;
  }
  return cloneJson(source);
}

/**
 * Build the effective settings object CC-Switch would write to
 * ~/.claude/settings.json for this provider.
 *
 * CC-Switch stores a shared `common_config_claude` (hooks, statusLine,
 * permissions, plugins, …) in its `settings` table. On switch it builds the
 * effective config as `json_deep_merge(provider.settings_config, common)`
 * when the provider's `meta.commonConfigEnabled` is true AND the common
 * config is non-empty; otherwise it uses the provider's settings_config
 * verbatim. We replicate that here so each `ccs` session matches what
 * CC-Switch produces — common wins on leaf conflicts, recursively.
 *
 * @param {object} commonConfig - parsed common_config_claude
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @param {boolean} commonConfigEnabled - provider's meta.commonConfigEnabled
 * @param {object} [proxyConfig] - CC-Switch proxy routing config
 * @param {object} [routeSettings] - current ~/.claude/settings.json produced by CC-Switch proxy
 * @returns {string} effective settings as compact JSON string
 */
function buildSettings(commonConfig, providerConfig, commonConfigEnabled, proxyConfig, routeSettings) {
  const commonIsEmpty = !commonConfig || Object.keys(commonConfig).length === 0;
  let result;
  if (!commonConfigEnabled || commonIsEmpty) {
    result = cloneJson(providerConfig);
  } else {
    result = cloneJson(providerConfig);
    jsonDeepMerge(result, commonConfig);
  }
  result = applyProxyRouteEnv(result, proxyConfig, routeSettings);
  return JSON.stringify(result);
}

/**
 * Launch claude with the provider's effective settings passed as a JSON
 * string. `claude --settings` accepts either a file path or a JSON string.
 * @param {string} providerName - display name for log
 * @param {object} providerConfig - parsed settings_config from CC-Switch
 * @param {boolean} commonConfigEnabled - provider's meta.commonConfigEnabled
 * @param {object} commonConfig - parsed common_config_claude
 * @param {string[]} extraArgs - additional args passed to claude
 * @param {object} [opts] - options
 * @param {boolean} [opts.noSkip] - skip --dangerously-skip-permissions flag
 * @returns {Promise<number>} exit code
 */
function launch(providerName, providerConfig, commonConfigEnabled, commonConfig, extraArgs = [], opts = {}) {
  const settingsJson = buildSettings(
    commonConfig,
    providerConfig,
    commonConfigEnabled,
    opts.proxyConfig,
    opts.routeSettings
  );

  const cmd = getClaudeCmd();
  const args = ['--settings', settingsJson];
  if (!opts.noSkip) {
    args.push('--dangerously-skip-permissions');
  }
  args.push(...extraArgs);

  console.log(`→ Launching [${providerName}]`);

  return new Promise((resolve) => {
    // cross-spawn is a drop-in for child_process.spawn that safely handles the
    // claude.cmd shim on Windows: it quotes args via windowsVerbatimArguments
    // (no shell, so inline JSON quotes, spaces in paths, and `&`/`|` in
    // user-supplied extraArgs are passed verbatim — no cmd.exe injection or
    // path-splitting). On macOS/Linux it is a plain passthrough. This replaces
    // the prior `shell: true` + temp-file workaround, which (a) re-mangled the
    // inline JSON under cmd.exe, (b) split the temp path when os.tmpdir()
    // contained a space, (c) opened a shell-injection surface via extraArgs,
    // and (d) wrote provider secrets to disk.
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

module.exports = { launch, buildSettings, getClaudeCmd };
