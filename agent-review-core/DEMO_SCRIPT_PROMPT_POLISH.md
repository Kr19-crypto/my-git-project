
# Agent Review Roundtable — 辅助提示词改进（游园会摊位版 Demo 方案）

> 适用场景：游园会/摊位式验收，访客随到随看、时间不定、深度不同。
> 不按“固定 5 分钟舞台演讲”设计，而是拆成多个可自由组合的互动单元。

---

## 0. 摊位准备

- [ ] 一台演示机，已进入 `D:\WORK AREA\my-git-project\agent-review-core`
- [ ] `npm run build` 已执行
- [ ] 已配置 `LLM_API_KEY` / `LLM_BASE_URL`（`.env` 或环境变量）
- [ ] DSH 已 reload，输入框右侧可见 **“✨ 润色”** 按钮
- [ ] 提前准备“兜底输出”：
  ```bash
  node dist/cli.js polish --prompt "用 PowerShell 做一个悬浮窗，能往终端发命令" --feedback --json --output-json samples\prompt-polish-demo.json
  ```
- [ ] 桌面/摊位牌放一张 **A4 速览卡**：
  - 一句话：给 coding agent 的提示词，先让 AI 评审/改进再开工。
  - 三行卖点：结构化反馈 / 一键润色 / CLI + DSH 都能用。

---

## 1. 摊位动线设计

游园会访客通常停留 30 秒～3 分钟。把摊位设计成三层漏斗：

| 层级 | 访客停留 | 展示动作 | 目标 |
|---|---|---|---|
| L1 路过速看 | 30 秒 | 屏幕循环播放“缺陷 prompt → 反馈 → 改进 prompt” | 让人一眼看懂在做什么 |
| L2 动手体验 | 1–2 分钟 | 让访客自己输入/粘贴 prompt，点“✨ 润色” | 产生“我能玩一下”的参与感 |
| L3 深度讲解 | 2–5 分钟 | 讲技术架构、评审闭环、可复用 SDK/CLI/DSH | 应对评委/技术型访客 |

---

## 2. L1：30 秒路过速看

**屏幕固定展示三块内容：**

```text
访客输入：
  用 PowerShell 写一个悬浮窗，让我能往终端发命令。

AI 反馈：
  Blocking：缺少目标终端/权限一致性/验收标准
  Suggestions：说明发送机制、运行中程序风险
  Risks：可能误输入给正在运行的程序

改进后提示词：
  用 PowerShell + WinForms 做悬浮命令板...
```

**接待话术（10 秒内）：**

> “现在可以让 AI 在写代码前先帮你把提示词改好，顺便告诉你有哪里会踩坑。”

---

## 3. L2：1–2 分钟动手体验（重点）

### 方式 A：DSH 输入框体验（推荐）

1. 请访客现场说一个任务，例如：
   - “帮我写个批量改名脚本”
   - “做一个悬浮命令窗”
2. 把这句话原样输入 DSH 输入框；
3. 点击 **“✨ 润色”**；
4. 让访客看两个结果：
   - 输入框被替换成更完整、更可执行的提示词；
   - Review Console 出现 `Blocking / Suggestions / Risks` 等反馈。

### 方式 B：CLI 体验

```bash
node dist/cli.js polish --prompt "帮我把这个项目部署到服务器" --feedback
```

> 适合访客不想碰鼠标、或想看“代码工具链”形态。

### 互动问题引导

- “你觉得你这个任务缺什么信息？”
- “让它补一条验收标准看看？”
- “要不要试试一个明显有坑的 prompt？”

---

## 4. L3：2–5 分钟深度讲解

给评委/技术访客时，按需讲：

1. **核心模块**：`src/promptPolish.ts`
   - 一次 LLM 调用返回 JSON：`feedback` + `text`
2. **三种调用方式共用同一套逻辑**：
   - CLI：`polish` 命令
   - DSH 工具：`agent_review_polish_prompt`
   - DSH 输入框按钮：`✨ 润色` → `/plugins/agent-review-roundtable/polish`
3. **与 Agent Review Roundtable 的闭环**：
   - 改进提示词 → 开发 Agent 生成代码
   - `agent_review_roundtable` 评审代码
   - Action Items 回灌 → 继续修复
4. **可配置性/技术点**：
   - 模型优先级：`LLM_PROMPT_MODEL` > `LLM_CORE_MODEL` > `deepseek-chat`
   - 角色/供应商路由沿用现有 `.env` / DSH 设置体系
   - 纯 CLI / SDK 也可独立使用，不依赖 DSH

---

## 5. 游园会“打卡式”验收动作

如果验收需要盖章/打勾，每个访客/评审者可以完成以下任一项：

- [ ] 亲手输入一个模糊 prompt，点击“✨ 润色”，看到结构化反馈
- [ ] 让系统输出“改进后提示词”，并指出至少一条它补上的关键约束
- [ ] 用 CLI 执行一次 `polish --feedback --json`，确认能拿到 `feedback` 字段
- [ ] 询问/讲解：这个功能与 `agent_review_roundtable` 如何闭环

---

## 6. 人员与设备分工

| 角色 | 任务 |
|---|---|
| 主接待 1 | 负责 L1/L2，引导访客输入，控制节奏 |
| 主接待 2（可选） | 负责 L3 深度讲解、回答技术问题 |
| 演示机 | 开两个窗口：CLI + DSH，方便随时切换 |
| 备用资料 | 打印输出样例 / JSON 截图，断网时直接看 |

> 单人值守时：优先 L1 + L2，L3 用一句话带过并指向 README/PROTOCOL。

---

## 7. 风险与兜底

| 风险 | 应对 |
|---|---|
| 访客输入太复杂/太奇怪 | 使用准备好的 2–3 个“安全示例 prompt”引导 |
| LLM 网络慢/失败 | 展示提前保存的 `samples\prompt-polish-demo.json` |
| 访客不愿动手 | 只讲 L1，屏幕循环播放对比效果 |
| DSH 没刷新 | 切到 CLI 窗口继续演示 |
| 多人围观 | 屏幕字体调大；讲解控制在 30–60 秒内，把细节留给提问 |

---

## 8. 一句话总结

> **写代码前的提示词，也值得一次 AI 评审。**
