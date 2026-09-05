# Agent Review Roundtable — Protocol & SDK

本文档描述如何把 Agent Review Roundtable 作为**可复用 SDK** 接入，以及如何用 DSH 多会话实现 A/B 协作。

---

## 1. SDK 使用

构建后通过子路径导入：

```ts
import {
  loadDiff,
  loadRepoContext,
  getDefaultRoles,
  applyRoleModelRouting,
  createConfig,
  runRoundtable,
  buildActionPrompt,
  renderMarkdownReview,
  polishPrompt,
  buildPromptPolishUserMessage,
} from 'agent-review-roundtable/sdk'
```

示例：

```ts
const request = await loadDiff({ repo: '/path/to/repo' })
request.repoContext = await loadRepoContext({ root: '/path/to/repo' })

const roles = applyRoleModelRouting(getDefaultRoles())
const config = createConfig(
  { rounds: 1, budgetLimitTokens: 120000, mock: false, yes: true },
  roles,
)

const result = await runRoundtable(request, config, {
  apiKey: process.env.LLM_API_KEY ?? '',
  baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
})

const nextPrompt = buildActionPrompt(result, {
  includeBlocking: true,
  includeSummary: true,
})

// 辅助提示词改进 / Prompt Polish
const polished = await polishPrompt({
  text: '帮我把这个命令做成悬浮窗',
  instruction: '面向 PowerShell，明确验收标准',
  apiKey: process.env.LLM_API_KEY ?? '',
  baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
  model: process.env.LLM_PROMPT_MODEL ?? process.env.LLM_CORE_MODEL ?? 'deepseek-chat',
})
```

---

## 2. 核心数据协议

所有 Review 结果遵循统一 Schema：

```ts
interface ReviewResult {
  source?: string
  summary: string
  blocking: string[]
  suggestions: string[]
  risks: string[]
  action_items: string[]
  transcript: Speech[]
  truncated: boolean
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}
```

### Action Prompt

Action Items 可转换为“下一步开发指令”：

```ts
const prompt = buildActionPrompt(result, {
  includeBlocking: true,
  includeSummary: true,
})
```

---

## 3. DSH 插件 HTTP 协议

当 DSH 插件加载后，提供以下同源端点：

| Endpoint | 方法 | 说明 |
|---|---|---|
| `/plugins/agent-review-roundtable/events` | GET | SSE 实时进度事件 |
| `/plugins/agent-review-roundtable/progress` | GET | 最近进度状态 JSON |
| `/plugins/agent-review-roundtable/last-result` | GET | 最近一次评审结果 JSON（含 action_prompt） |
| `/plugins/agent-review-roundtable/pause` | POST | 暂停指定 channel |
| `/plugins/agent-review-roundtable/resume` | POST | 恢复指定 channel |
| `/plugins/agent-review-roundtable/comment` | POST | 向指定 channel 发送评论 |
| `/plugins/agent-review-roundtable/polish` | POST | 辅助提示词改进：`{ text, instruction?, context? }` → `{ ok, text, feedback, usage }` |
| `/plugins/agent-review-roundtable/progress.html` | GET | 独立实时进度页 |

### 辅助提示词改进端点

`POST /plugins/agent-review-roundtable/polish`

请求：

```json
{
  "text": "帮我把这个命令做成悬浮窗",
  "instruction": "面向 PowerShell 开发，明确验收标准",
  "context": "Windows 11 / .NET Framework 4.6+"
}
```

成功响应：

```json
{
  "ok": true,
  "text": "改进后的提示词",
  "feedback": {
    "summary": "原提示词目标不清，缺少验收标准。",
    "blocking": ["没有明确运行环境", "没有定义成功标准"],
    "suggestions": ["补充可验证的测试命令"],
    "risks": ["可能在错误 shell 中执行"],
    "action_items": ["补充环境与验收步骤"]
  },
  "model": "deepseek-chat",
  "usage": { "inputTokens": 100, "outputTokens": 50, "totalTokens": 150 }
}
```


---

## 4. 多会话 A/B 协作流程

### 目标

- 会话 A：负责构建/开发；
- 会话 B：负责复核/监督。

### 流程

1. 会话 A 让 Agent 调用 `agent_review_roundtable`；
2. 插件 Host 开始评审；
3. 如果 A 和 B 在同一个 DSH Web 页面/会话体系内，B 的右下角浮层也能看到实时进度；
4. 评审完成后，Host 保存 `lastResult`；
5. 会话 B 可以调用 `agent_review_last_result` 获取 A 最近一次评审结果；
6. B 对结果做复核或补充意见；
7. B 可以把 Action Items 通过“↩️ 回灌”按钮写入自己的输入框，继续让 Agent 修复。

### Channel 双向消息路由

A/B 可共享一个 `channel`，例如 `task-1`。

A 启动评审时带上 channel：

```text
agent_review_roundtable
  repo: C:\...
  channel: task-1
```


> ⚠️ 重要：真正的“A 运行中 → B 暂停/评论 → B 恢复 → A 继续”必须在**两个并行 DSH 会话/窗口**中演示。
> 单一会话里无法同时运行 A 的评审并让 B 在中途操作；单会话只能做“A 跑完 → B 拉结果”的顺序验证。

B 可以在评审过程中：

- 发评论：
  ```text
  agent_review_send_comment
    channel: task-1
    text: 请先修复路径穿越，再继续评审
  ```

- 请求暂停（A 会在下一个角色发言边界等待恢复）：
  ```text
  agent_review_pause_channel
    channel: task-1
  ```

- 恢复：
  ```text
  agent_review_resume_channel
    channel: task-1
  ```

A 可以读取 B 的评论/暂停状态：

```text
agent_review_inbox
  channel: task-1
```

返回：

```json
{
  "ok": true,
  "channel": "task-1",
  "paused": true,
  "messages": [
    { "channel": "task-1", "text": "请先修复路径穿越", "time": 123 }
  ]
}
```


### 会话 B 获取结果

在 DSH 会话 B 中让 Agent：

> “拉取最近的 Agent Review Roundtable 评审结果”

Agent 会调用：

```text
agent_review_last_result
```

返回：

```json
{
  "ok": true,
  "result": {
    "summary": "...",
    "blocking": ["..."],
    "action_items": ["..."],
    "action_prompt": "..."
  }
}
```

---

## 5. 后续扩展点

- 多会话双向消息路由；
- Review 结果持久化/历史；
- 更多 IDE/CI 适配器；
- 精确 Token 预估与成本模型。
