# cc-switch-helper

**[English](README.md)** ｜ 中文文档

解决原版 [CC-Switch](https://github.com/farion1231/cc-switch)  **全局单配置硬限制**，实现多终端、多窗口独立绑定不同 API Key / 不同模型，多会话并行互不干扰

> 原生 CC-Switch 所有终端共享一套全局 API 配置，切换配置会全部窗口同步变更；本工具做会话级隔离，一个终端用个人密钥、另一个终端用公司密钥，同时运行，互不冲突。

## 为什么需要这个工具？

CC-Switch 管理 provider 确实方便，但切换是全局的 ： 改了配置，所有 Claude Code 实例都跟着变。

`ccs` 换了个思路：把 provider 配置直接传给每个 `claude` 进程，不走全局配置。这样你可以在一个窗口用 DeepSeek，另一个窗口用 GLM，同时跑，互不影响。

```
窗口 1: ccs deep     → 用 DeepSeek 的 Claude Code
窗口 2: ccs glm      → 用 GLM 的 Claude Code
窗口 3: ccs zcy      → 用自定义 provider 的 Claude Code
```

每个窗口独立运行，切了一个，其他窗口完全不受影响。

<p align="center">
  <img src="./demo.gif" alt="cc-switch-helper demo" />
</p>

CC-Switch 的 provider 配置界面：

<p align="center">
  <img src="./cc-switch.png" alt="cc-switch settings" />
</p>

## 功能

- **会话级配置隔离** — 多终端/多窗口同时用不同 API Key、不同服务商、不同模型，互不干扰
- **交互菜单** — 方向键选 provider，不用记名字
- **模糊匹配** — `ccs deep` 能匹配 "DeepSeek"，`ccs mini` 匹配 "Minimax"
- **全平台** — macOS、Linux、Windows (PowerShell / CMD / Git Bash) 都能用
- **零配置** — 直接读 CC-Switch 的数据库，兼容已有密钥分组和中转配置
- **不侵入** — 不修改 CC-Switch 本体源码，升级 CC-Switch 不影响本工具

## 前置要求

1. 装了 [CC-Switch](https://github.com/farion1231/cc-switch)，并且至少配好一个 Claude provider
2. 装了 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
3. [Node.js](https://nodejs.org/) ≥ 18

## 安装

```bash
npm install -g luckybilly/cc-switch-helper
```

装完之后全局就有 `ccs` 命令了。

## 用法

```
ccs                       # 交互选 provider
ccs <name>                # 模糊匹配 provider 名称
ccs <name> -- <args...>   # 给 claude 传额外参数
ccs --no-skip             # 启动时不加 --dangerously-skip-permissions
ccs --list                # 列出所有配好的 provider
ccs --help                # 看帮助
```

### 举例

```bash
# 弹出交互菜单选一个
ccs
```

<p align="center">
  <img src="./select.png" alt="交互选择 provider" width="500" />
</p>

```bash
# 直接指定 provider（不区分大小写，模糊匹配）
ccs zcy
ccs DeepSeek
ccs glm

# 给 claude 传参数（-- 后面的都算）
ccs zcy -- --resume
ccs DeepSeek -- -p "hello world"

# 不加 --dangerously-skip-permissions 启动（逐条确认权限）
ccs zcy --no-skip

# 看看自己配了哪些 provider
ccs --list
```

### 别名 `cc`

嫌 `ccs` 太长，可以加个别名：

```bash
# ~/.zshrc 或 ~/.bashrc
alias cc=ccs
```

> **注意：** `cc` 在 macOS/Linux 上也是系统 C 编译器的名字。alias 在你的 shell 里优先级更高，但搞 C 项目的时候留意一下。

## 工作原理

1. 从 CC-Switch 的 SQLite 数据库读 provider 列表（`~/.cc-switch/cc-switch.db`）
2. 读你的 Claude 基础配置（`~/.claude/settings.json`）
3. 把选中 provider 的 `env` 和 `enabledPlugins` 合并进去
4. 执行 `claude --settings <json> --dangerously-skip-permissions`

provider 的环境变量会**覆盖**基础配置里的同名项，其他设置（权限、hooks、插件等）保持不变。

`--dangerously-skip-permissions` 是 Claude Code 的内置参数，跳过逐条权限确认让体验更顺畅。如果你希望每次操作都手动审批，加 `--no-skip` 即可跳过这个参数。

## 平台支持

| 平台 | Shell | 状态 |
|------|-------|------|
| macOS | zsh, bash | ✅ |
| Linux | bash, zsh, fish | ✅ |
| Windows | PowerShell | ✅ |
| Windows | CMD | ✅ |
| Windows | Git Bash | ✅ |

## 常见问题

Q：`ccs` 和 CC-Switch 原生切换冲突吗？
>A：不冲突。`ccs` 只影响它启动的那个 claude 进程，不修改全局配置。你可以随时用 CC-Switch 切换默认 provider，不影响已经在跑的 `ccs` 会话。

Q：怎么确认当前窗口用的是哪个 provider？
>A：`ccs` 启动时会打印 `→ Launching [provider-name]`，终端标题栏也能看到。

Q：`--no-skip` 和默认启动有什么区别？
>A：默认带 `--dangerously-skip-permissions`，跳过 Claude Code 的逐条权限确认。加 `--no-skip` 则恢复逐条确认，适合对权限控制要求更高的场景。

## License

MIT
