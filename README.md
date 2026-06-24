# cc-switch-helper

English ｜ **[中文文档](README.zh-CN.md)**

Overcomes the **global single-config limitation** of the original [CC-Switch](https://github.com/farion1231/cc-switch), enabling per-terminal, per-window binding of different API keys and models — multiple sessions running in parallel without interference.

> The native CC-Switch shares one global API config across all terminals — switching providers changes every window at once. This tool provides session-level isolation: one terminal on a personal key, another on a company key, running side by side with no conflicts.

## Why?

CC-Switch is a great tool for managing Claude Code providers, but switching providers changes the global config — every running Claude Code instance picks up the change.

`ccs` takes a different approach: it passes the provider settings directly to each `claude` process. This means you can run DeepSeek in one terminal and GLM in another, at the same time, without ever touching the global config.

```
Terminal 1: ccs deep     → Claude Code running DeepSeek
Terminal 2: ccs glm      → Claude Code running GLM
Terminal 3: ccs zcy      → Claude Code running your custom provider
```

Each window is independent. Switch providers in one — the others stay untouched.

<p align="center">
  <img src="./demo.gif" alt="cc-switch-helper demo" />
</p>

CC-Switch provider configuration panel:

<p align="center">
  <img src="./cc-switch.png" alt="cc-switch settings" />
</p>

## Features

- **Session-level config isolation** — run different API keys, providers, and models across multiple terminals/windows simultaneously, no interference
- **Interactive menu** — arrow keys to pick a provider, no need to remember names
- **Fuzzy match** — `ccs deep` matches "DeepSeek", `ccs mini` matches "Minimax"
- **Cross-platform** — works on macOS, Linux, and Windows (PowerShell / CMD / Git Bash)
- **Zero config** — reads directly from your CC-Switch database, compatible with existing key groups and relay configs
- **Non-invasive** — does not modify CC-Switch source code; CC-Switch upgrades won't affect this tool

## Prerequisites

1. [CC-Switch](https://github.com/farion1231/cc-switch) installed with at least one Claude provider configured
2. [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
3. [Node.js](https://nodejs.org/) ≥ 18

## Install

```bash
npm install -g luckybilly/cc-switch-helper
```

This registers the `ccs` command globally.

## Usage

```
ccs                       # Interactive provider selection
ccs <name>                # Fuzzy-match provider by name
ccs <name> -- <args...>   # Pass extra arguments to claude
ccs --no-skip             # Launch without --dangerously-skip-permissions
ccs --list                # List all configured providers
ccs --help                # Show help
```

### Examples

```bash
# Pick from an interactive menu
ccs
```

<p align="center">
  <img src="./select.png" alt="Interactive provider selection" width="500" />
</p>

```bash
# Launch with a specific provider (case-insensitive fuzzy match)
ccs zcy
ccs DeepSeek
ccs glm

# Pass extra arguments to claude (everything after --)
ccs zcy -- --resume
ccs DeepSeek -- -p "hello world"

# Launch without --dangerously-skip-permissions (review each permission)
ccs zcy --no-skip

# See all your configured providers
ccs --list
```

### Alias to `cc`

If you prefer the shorter `cc` command, add an alias to your shell config:

```bash
# ~/.zshrc or ~/.bashrc
alias cc=ccs
```

> **Note:** `cc` is also the system C compiler on macOS/Linux. The alias takes priority in your shell, but be aware if you work with C projects.

## How it works

1. Reads providers from CC-Switch's SQLite database (`~/.cc-switch/cc-switch.db`)
2. Reads your base Claude settings from `~/.claude/settings.json`
3. Merges the selected provider's `env` and `enabledPlugins` into the base settings
4. Launches `claude --settings <json> --dangerously-skip-permissions`

The provider's environment variables **override** same-named keys in your base settings, while all other settings (permissions, hooks, plugins, etc.) are preserved.

`--dangerously-skip-permissions` is a built-in Claude Code flag that skips per-action permission prompts for a smoother experience. Add `--no-skip` to restore per-action approval, useful when you want tighter permission control.

## Platform support

| Platform | Shell | Status |
|----------|-------|--------|
| macOS | zsh, bash | ✅ |
| Linux | bash, zsh, fish | ✅ |
| Windows | PowerShell | ✅ |
| Windows | CMD | ✅ |
| Windows | Git Bash | ✅ |

## FAQ

Q: Does `ccs` conflict with switching providers in CC-Switch?
>A: No. `ccs` only affects the claude process it launches — it doesn't touch the global config. You can switch providers in CC-Switch anytime without affecting running `ccs` sessions.

Q: How do I know which provider a window is using?
>A: `ccs` prints `→ Launching [provider-name]` on startup. The terminal title bar also shows it.

Q: What's the difference between default and `--no-skip`?
>A: Default includes `--dangerously-skip-permissions`, which skips Claude Code's per-action permission prompts. `--no-skip` restores per-action approval, useful for tighter security control.

## License

MIT
