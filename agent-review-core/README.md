# Agent Review Roundtable（CLI 原型）

开源、多 Agent 圆桌代码评审引擎。当前是 **CLI-first** 原型，后续再封装 DSH 插件。

## 功能

- 读取本地 git repo 的 diff 或指定 diff 文件；
- 可加载仓库上下文（文件树 + README/package.json 摘要），供评审角色参考；
- 支持角色级模型路由（core 角色用高性能模型，aux 角色用低成本模型）；
- 默认 4 个角色：架构师 / 安全 / 测试 / 维护者；
- 支持自定义角色 JSON；
- 支持多轮圆桌讨论；
- 输出结构化 Review：summary / blocking / suggestions / risks / action_items；
- 支持 Markdown 报告输出与 JSON 输出；
- 支持 Action Items 回灌为下一步开发指令；
- 内置“辅助提示词改进”（Prompt Polish）：CLI/SDK/DSH 输入框均可对草稿给出结构化反馈，并润色成更清晰、可执行的提示词；
- 支持 `--interactive` 人类中途控制（继续/跳过/中止）；
- 提供单文件 Web UI 报告查看器；
- 内置 Token 粗估与硬上限；
- `--mock` 可离线跑通流程。
- `--repo` 模式自动包含未 git add 的新文件（未跟踪文件也会进入评审）；
  - 支持 `--directory` 评审非 git 目录（自动生成目录快照 pseudo-diff）；
- LLM 调用内置超时与自动重试（网络抖动不会浪费整场评审）；
- 开放 SDK 子路径 `agent-review-roundtable/sdk` 与协议文档 `PROTOCOL.md`；
- 内置基础自动化测试（Node Test Runner）；

## 快速开始

```bash
cd agent-review-core
npm install
```

### 运行测试

```bash
npm test
```

### 评审范围说明

| 模式 | 评审对象 | 适用场景 |
|---|---|---|
| `--repo` | 当前工作区 diff（含未跟踪文件） | 评审某次本地修改 / PR |
| `--directory` | 整个目录快照（自动过滤重型目录） | 评审非 git 项目或整个项目源码 |
| `--diff-file` | 指定 patch 文件 | 评审 commit / PR / 导出的 diff |

注意：

- `repo` 模式**不是评审整个仓库**，而是评审当前工作区改动；
- 如果仓库 clean，`repo` 可能几乎没有内容；
- 想评审整个项目时，请使用 `directory`，或先用 `git diff` 生成 patch 后使用 `diffFile`。



### 离线 Mock 跑通

如果使用 `tsx`：

```bash
npm run mock -- --repo C:\Users\Lenovo\DSH-Plugin\dsh-aurora-wallpaper --yes
```

如果 `esbuild` 的 install script 被 npm 阻止，可以：

```bash
npm install-scripts approve esbuild
```

也可以不用 `tsx`，直接编译后用 Node 运行：

```bash
npm run build
npm run mock:built -- --diff-file samples\aurora.patch --yes
```

### 真实 LLM 评审

```bash
$env:LLM_API_KEY="your-api-key"
$env:LLM_BASE_URL="https://api.deepseek.com/v1"

npm run review -- --repo C:\Users\Lenovo\DSH-Plugin\dsh-aurora-wallpaper --yes
```

### 评审非 git 目录

```bash
node dist/cli.js review --directory D:\WORK AREA\automatic --rounds 1 --budget 200000 --yes
```

CLI 会把该目录下的文件生成 pseudo-diff 快照进行评审。


### 使用 diff 文件

```bash
npm run review -- --diff-file ../samples/aurora.patch --yes
```


### 加载仓库上下文

使用 `--repo` 时默认自动加载仓库上下文；也可以对 diff 文件手动指定：

```bash
node dist/cli.js review --diff-file samples\aurora.patch --context-dir C:\Users\Lenovo\DSH-Plugin\dsh-aurora-wallpaper --rounds 1 --yes
```

关闭自动上下文：

```bash
node dist/cli.js review --repo <path> --no-context --rounds 1 --yes
```
### 输出 Markdown 报告

```bash
npm run review:built -- --diff-file samples\aurora.patch --rounds 1 --budget 120000 --yes --output samples\aurora.review.md
```

### 输出 JSON

推荐用 `--output-json` 直接写文件，避免 PowerShell 重定向中文编码问题：

```bash
node dist/cli.js review --diff-file samples\aurora.patch --rounds 1 --budget 120000 --yes --output-json samples\aurora.review.json
```

如果希望 JSON 输出到 stdout：

```bash
node dist/cli.js review --diff-file samples\aurora.patch --rounds 1 --budget 120000 --yes --json
```

说明：

- `--json` 时，stdout 只输出 JSON，便于脚本/DSH 插件读取；
- 进度和提示信息输出到 stderr；
- 可同时使用 `--output` 生成 Markdown 文件；
- 可同时使用 `--output-json` 生成 UTF-8 JSON 文件。

### Action Items 回灌

从已保存的评审 JSON 生成“下一步开发指令”：

```bash
node dist/cli.js next --result samples\aurora-context.review.json --include-blocking --include-summary
```

可写入文件：

```bash
node dist/cli.js next --result samples\aurora-context.review.json --include-blocking --include-summary --output samples\next-prompt.md
```

评审完成后直接自动生成回灌文件：

```bash
node dist/cli.js review --diff-file samples\aurora.patch --rounds 1 --budget 120000 --yes --write-back samples\next-prompt.md
```

人类中途控制：

```bash
node dist/cli.js review --diff-file samples\aurora.patch --rounds 2 --budget 120000 --yes --interactive
```

交互时：`Enter` 继续，`S` 跳过当前角色，`A` 中止评审。

### 辅助提示词改进（Prompt Polish）

对草稿同时给出**结构化反馈**（summary / blocking / suggestions / risks / action_items）和**改进后的提示词**：

```bash
node dist/cli.js polish --prompt "帮我把这个命令做成悬浮窗" --feedback
```

默认只输出改进后的提示词便于复制；想看反馈加 `--feedback`，或使用 `--json` 获取完整结构：

```bash
node dist/cli.js polish --prompt-file samples\raw-prompt.txt --context "Windows 11 / .NET Framework 4.6+" --output polished-prompt.md
node dist/cli.js polish --prompt "..." --feedback
node dist/cli.js polish --prompt "..." --json
node dist/cli.js polish --prompt "..." --json --output-json samples\prompt-polish-demo.json
```

模型优先级：`LLM_PROMPT_MODEL` > `LLM_CORE_MODEL` > `deepseek-chat`。


### Web UI 报告查看器

提供一个零依赖的单文件 UI，可直接查看评审报告并复制回灌指令：

```bash
cd agent-review-core
python -m http.server 8080
```

然后浏览器打开：

```text
http://localhost:8080/web/index.html
```

也可以直接双击打开 `web/index.html`，点击“打开 review.json”手动选择 `samples/aurora-context.review.json`。


### DSH 插件适配器（实验）

确保已 build：

```bash
npm run build
```

安装到 DSH profile：

```bash
dsh plugin --profile web add D:\WORK AREA\HACK-Blue-Fat-Fish\agent-review-core
```

安装后，在 DSH 会话里可以要求 Agent：

> “请 review 一下 C:\Users\Lenovo\DSH-Plugin\dsh-aurora-wallpaper 的当前改动”

Agent 会调用工具：

```text
agent_review_roundtable
```

支持参数：`repo` / `directory` / `diffFile` / `path` / `task` / `rounds` / `budget` / `contextDir` / `noContext` / `mock` / `channel`。

插件注册在 `dsh/index.js`，复用 `dist/` 下的核心模块，不额外 spawn CLI。

已注册工具：

- `agent_review_roundtable`
- `agent_review_polish_prompt`
- `agent_review_last_result`
- `agent_review_send_comment`
- `agent_review_pause_channel`
- `agent_review_resume_channel`
- `agent_review_inbox`
- `agent_review_history`
- `agent_review_show`

评审历史/记忆：

- 每次评审完成后自动保存最近 50 条历史；
- 可设置 `ART_HISTORY_FILE` 将历史持久化到 JSON 文件；
- 可用 `agent_review_history` 列出历史；
- 可用 `agent_review_show` 按 id 查看某次评审。


事件驱动自动评审（基础）：

- 设置环境变量 `ART_AUTO_REVIEW=1` 开启；
- 插件监听 DSH `session/event`，在 `turn/end` 时检测会话 cwd；
- 会发出 `auto_review_ready` 事件到侧边栏；
- 当前为基础监听层，自动执行仍需要配置具体触发目录/策略。


实时进度页（DSH 同源访问，评审过程中可打开）：

```text
http://127.0.0.1:3080/plugins/agent-review-roundtable/progress.html
```

页面会通过 SSE 实时显示：

```text
评审开始 → 架构师开始发言 → 架构师完成发言 → ... → 评审完成
```

另外插件包含 **DSH Web 客户端浮层/可停靠侧边栏（Review Console）**：安装/更新后刷新 DSH Web 页面，右下角会出现面板。

- 可停靠/移动/调宽/关闭；
- 顶部启动栏：输入仓库路径或 `.patch` 路径，点击 **“🚀 启动评审”** 会把评审指令写入 DSH 输入框；
- 实时进度事件；
- 状态栏：显示 channel / 当前角色 / 当前轮次；
- 评审结果区：自动展示 Summary、Blocking、Action Items；
- 控制按钮：暂停、恢复、复制回灌指令、复制 JSON、清空进度；
- Channel 评论输入：可直接给当前 channel 发送评论；
- 输入框右侧还有 **“✨ 润色”** 按钮：把当前草稿 POST 到本插件 `/polish`，返回的改进提示词会写回输入框，并把结构化反馈显示到 Review Console（“辅助提示词改进”）；
- 评审完成后，输入框右侧会出现 **“↩️ 回灌”** 按钮，点击后会把最近一次评审的 Action Items 写入输入框。
- **设置（⚙️）**：可随时配置全局 API Key / 供应商 / 默认模型，也可单独为每个角色（架构/安全/测试/维护者）指定模型与供应商（Base URL）；角色级配置会写入 `agent-review-core/.env`（`LLM_ROLE_<ID>_MODEL` / `LLM_ROLE_<ID>_BASE_URL`），重启后仍生效并与 CLI 共用；已移除首次启动自动弹窗。

当前 UI 按 **PC 端** 设计，可随 DSH Web 窗口宽度自适应；同时会尝试读取当前 DSH/壁纸主题变量与 `dsh.ambient.background`，自动切换风格（whale/aurora），无匹配时默认黑色。

注意：需要 DSH 插件重新加载后生效；若端口不同，以实际 DSH Web 端口为准。



### 自定义角色

复制 `config/roles.example.json`，修改后传入：

```bash
npm run review -- --repo <path> --roles config/my-roles.json --yes
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 空 | 调用 LLM API 的 key |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible base URL |
| `LLM_CORE_MODEL` | 空 | 覆盖所有 `tier: core` 角色（架构/安全/维护者） |
| `LLM_PROMPT_MODEL` | 空 | Prompt Polish/辅助提示词改进专用模型，优先级高于 `LLM_CORE_MODEL` |
| `LLM_AUX_MODEL` | 空 | 覆盖所有 `tier: aux` 角色（测试等辅助角色） |
| `LLM_ROLE_<ROLE_ID>_MODEL` | 空 | 单角色覆盖，优先级最高，如 `LLM_ROLE_ARCHITECT_MODEL` |
| `LLM_ROLE_<ROLE_ID>_BASE_URL` | 空 | 单角色供应商 Base URL 覆盖（角色级供应商），如 `LLM_ROLE_ARCHITECT_BASE_URL=https://openrouter.ai/api/v1` |
| `LLM_TIMEOUT_MS` | `120000` | 单次 LLM 调用超时（毫秒）；超时/瞬时故障会自动重试 |
| `LLM_MAX_RETRIES` | `2` | 自动重试次数上限（0 表示不重试，上限 4） |

也可以创建 `agent-review-core/.env` 文件自动加载（不需要额外依赖）：

```text
LLM_API_KEY=你的 key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_CORE_MODEL=deepseek-reasoner
LLM_AUX_MODEL=deepseek-chat
LLM_PROMPT_MODEL=deepseek-chat  # 可选：辅助提示词改进专用模型
LLM_ROLE_ARCHITECT_MODEL=deepseek-reasoner  # 可选：单角色模型覆盖
LLM_ROLE_ARCHITECT_BASE_URL=https://api.deepseek.com/v1  # 可选：单角色供应商 Base URL
```

`.env` 已 gitignore，不会提交到仓库。


## 规划

- [x] CLI 骨架
- [x] 使用 dsh-aurora-wallpaper 真实 diff 验证
- [x] 输出 Markdown review 报告
- [x] 输出 JSON
- [x] Action Items 回灌
- [x] 辅助提示词改进（Prompt Polish）
- [x] Web UI 报告查看器
- [ ] 接入更精确 token 预估
- [x] 基础自动化测试
- [x] DSH 插件适配器（已安装，agent_review_roundtable 调用成功）
