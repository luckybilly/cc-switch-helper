# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-07-10

### Fixed

- **`ccs` now launches claude on Windows.** Launching any provider on Windows
  crashed synchronously with `Error: spawn EINVAL` (errno -4071) at `launcher.js`.
  Root cause: on Windows the `claude` global bin is a `.cmd` shim, and Node
  (>=18.20.2 / 20.12.2 / 21.7.3, per CVE-2024-27980) refuses to spawn `.cmd` /
  `.bat` files without a shell. The spawn is now performed via `cross-spawn`,
  which safely invokes the `.cmd` shim with proper argument quoting
  (`windowsVerbatimArguments`) — no shell, so inline JSON quotes, spaces in the
  settings path, and `&`/`|` in user-supplied `--` args are passed verbatim. This
  also avoids writing provider settings (which may carry API keys) to a temp file.

### Changed

- Added `cross-spawn` as a runtime dependency.

## [0.3.0] - 2026-07-01

### Changed

- **Settings are now built the way CC-Switch builds them.** `ccs` now reads the
  shared `common_config_claude` from CC-Switch's `settings` table and deep-merges
  it onto the provider's `settings_config` when `meta.commonConfigEnabled` is
  true (and the common config is non-empty); otherwise the provider's config is
  passed through verbatim. This mirrors `json_deep_merge(provider, common)` from
  CC-Switch's `live.rs` — a fully recursive merge where **common config wins on
  leaf conflicts**. Previously `ccs` either merged onto the on-disk
  `~/.claude/settings.json` (which leaked the previous provider's snapshot) or
  passed `settings_config` through without the common config, dropping hooks,
  statusLine, permissions, and plugins for providers that share the common
  config.

### Added

- `-V`, `--version` flag to print the installed version.
- `getCommonConfig()` in `db.js` to read `common_config_claude`; per-provider
  `commonConfigEnabled` is now surfaced from `getProviders()`.

## [0.2.0] - 2026-06-24

### Added

- `--no-skip` flag to launch without `--dangerously-skip-permissions` for
  tighter per-action permission control.
- Restructured README with a "Why" section highlighting per-window provider
  switching, plus cross-language links and demo images.

## [0.1.0] - 2026-06-24

### Added

- Initial release — cross-platform CLI companion for CC-Switch.
- Interactive provider selection and fuzzy name matching.
- Reads providers directly from CC-Switch's SQLite database.
- Passes the provider config to `claude --settings` as a JSON string (no temp
  file).
