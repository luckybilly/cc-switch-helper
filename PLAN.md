# cc-switch-helper 实现计划

## Context

用户在 `~/.zshrc` 中有一个 `cc()` shell 函数，用于从 CC-Switch GUI 的 SQLite 数据库读取多个 Claude Code provider 配置，交互式选择后合并 env 到 `~/.claude/settings.json` 并启动 `claude`。现在需要把它做成一个跨平台 npm CLI 工具（含 Windows），作为 CC-Switch 的命令行伴侣发布到 GitHub。

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js ≥ 18 | Claude Code 用户必有 Node |
| SQLite 读取 | `better-sqlite3` | 有全平台 prebuilt binary，同步 API 简洁 |
| 交互菜单 | `prompts` | 轻量，上下箭头选择体验好 |
| 模糊匹配 | JS 内置（`toLowerCase().includes()`） | 逻辑简单，无需额外依赖 |
| DB 访问模式 | 只读（`readonly: true`） | 避免与 CC-Switch GUI 的锁冲突 |

## 项目结构

```
cc-switch-helper/
├── package.json
├── README.md
├── LICENSE           # MIT
├── .gitignore
├── .npmignore
└── src/
    ├── cli.js        # 入口：解析参数 → 选择 provider → 启动
    ├── db.js         # 读取 CC-Switch SQLite DB，提取 provider 列表
    └── launcher.js   # 合并 settings + spawn claude 进程
```

## 实现细节

### 1. `package.json`

```json
{
  "name": "cc-switch-helper",
  "version": "0.1.0",
  "description": "CLI companion for CC-Switch — quickly switch Claude Code providers",
  "bin": { "ccs": "./src/cli.js" },
  "engines": { "node": ">=18" },
  "os": ["darwin", "linux", "win32"],
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "prompts": "^2.4.2"
  }
}
```

- 命令名 `ccs`（短、好记、不与系统命令冲突）
- 用户可在 zshrc 里保留 `cc` 别名：`alias cc=ccs`

### 2. `src/cli.js`（入口）

```
用法：
  ccs                  # 交互式菜单选择 provider
  ccs <name>           # 模糊匹配 provider 名称
  ccs <name> -- <args> # 传额外参数给 claude
  ccs --list           # 列出所有 provider（不启动）
```

流程：
1. 解析 CLI 参数（手动解析，不引入额外依赖）
2. 调用 `db.js` 读取 providers
3. 无参数 → 调 `prompts` 交互选择；有参数 → 模糊匹配
4. 调 `launcher.js` 合并 settings 并启动 claude

### 3. `src/db.js`

- DB 路径：`path.join(os.homedir(), '.cc-switch', 'cc-switch.db')`
- 以 `readonly: true` 打开，避免文件锁冲突
- SQL：`SELECT name, settings_config, is_current FROM providers WHERE app_type='claude' ORDER BY is_current DESC, name ASC`
- `settings_config` 是 JSON 字符串，解析后提取 `env` 和 `enabledPlugins`

### 4. `src/launcher.js`

- 读取 `~/.claude/settings.json`
- 合并策略：provider 的 `env` 覆盖 settings.json 的同名 env 键，其余字段保留
- 如果 provider 有 `enabledPlugins`，也合并进去
- 用 `child_process.spawn('claude', args, { stdio: 'inherit', shell: true })` 启动
  - `shell: true` 确保 Windows 上能找到 `claude.cmd`
  - `stdio: 'inherit'` 让 claude 接管终端（交互 UI 需要）
- 转发 exit code

### 5. Windows 兼容要点

| 点 | 处理方式 |
|----|---------|
| 路径分隔符 | 全部用 `path.join()` / `os.homedir()`，不硬编码 `/` |
| DB 文件锁 | `better-sqlite3` 的 `readonly: true` 模式 |
| 找到 claude 命令 | `spawn` 加 `shell: true`，Windows 上自动走 `.cmd` |
| 终端颜色/交互 | `prompts` 库原生支持 Windows 终端 |
| shebang 行 | `#!/usr/bin/env node`，npm install 时自动生成 `.cmd` wrapper |

### 6. README.md

- 一句话说清：CC-Switch 的 CLI 伴侣，快速切换 Claude Code provider
- 前置条件：安装 CC-Switch GUI 并配置至少一个 provider
- 安装：`npm install -g cc-switch-helper`
- 用法示例：`ccs`（交互）/ `ccs zcy`（模糊匹配）/ `ccs --list`
- Windows / macOS / Linux 都支持

## 实施步骤

1. 创建 `/Users/qiyi/Documents/codes/ai/cc-switch-helper/` 目录
2. 初始化 `package.json`，安装依赖
3. 实现 `src/db.js` — DB 读取
4. 实现 `src/launcher.js` — settings 合并 + claude 启动
5. 实现 `src/cli.js` — 参数解析 + 交互菜单
6. 添加 `.gitignore`、`LICENSE`
7. 写 `README.md`
8. 本地测试（`npm link` 后跑 `cc-switch`）
9. 用 `gh` 创建 GitHub 远程仓库并推送

## 验证

```bash
# 安装到本地测试
cd /Users/qiyi/Documents/codes/ai/cc-switch-helper
npm link

# 测试交互菜单
ccs

# 测试模糊匹配
ccs zcy

# 测试 list
ccs --list

# 测试传额外参数
ccs zcy -- --resume

# Windows 兼容性无法直接测试，但通过代码审查确保路径/shell 处理正确
```
