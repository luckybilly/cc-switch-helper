# cc-switch-helper

CLI companion for [CC-Switch](https://github.com/anthropics/cc-switch) — quickly switch between Claude Code providers from the terminal.

Reads your CC-Switch provider configurations and launches `claude` with the selected provider's environment variables merged into your settings.

<p align="center">
  <img src="./demo.gif" alt="cc-switch-helper demo" width="600" />
</p>

My cc-switch settings:

<p align="center">
  <img src="./cc-switch.png" alt="cc-switch settings" width="600" />
</p>

## Features

- **Interactive menu** — arrow keys to pick a provider, no need to remember names
- **Fuzzy match** — `ccs deep` matches "DeepSeek", `ccs zcy` matches your ZCY provider
- **Cross-platform** — works on macOS, Linux, and Windows (PowerShell / CMD / Git Bash)
- **Zero config** — reads directly from your CC-Switch database

## Prerequisites

1. [CC-Switch](https://github.com/anthropics/cc-switch) installed with at least one Claude provider configured
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

## Platform support

| Platform | Shell | Status |
|----------|-------|--------|
| macOS | zsh, bash | ✅ |
| Linux | bash, zsh, fish | ✅ |
| Windows | PowerShell | ✅ |
| Windows | CMD | ✅ |
| Windows | Git Bash | ✅ |

## License

MIT
