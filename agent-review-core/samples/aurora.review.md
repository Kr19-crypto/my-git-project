# Review Report

> Source: `samples\aurora.patch`
> Roles: architect, security, tester, maintainer
> Rounds: 1
> Token Budget: 120,000
> Usage: 68,858 tokens (63,527 in / 5,331 out)
> Truncated: false

## Summary

本次改动将插件从动态 Cordis 模式迁移到静态 bundle 模式，并新增壁纸隐藏/恢复、与 whale-on-desk 互斥切换等核心功能。架构方向正确，但存在跨插件耦合协议未版本化、索引映射边界错误等阻断性问题，以及路径处理不一致、并发状态竞争、资源清理不完整、路径穿越安全风险等高风险问题。需修复后合入。

## Blocking

- 跨插件耦合协议未版本化：AMBIENT_KEY 和 dsh-ambient-change 事件需增加版本号、schema 校验和 payload 规范，避免隐式协议导致维护和兼容性问题。
- 索引映射逻辑存在边界错误：/dyn/aurora-set 返回的 index 应为可见列表索引而非 videos 数组索引，需修复前后端索引一致性。

## Suggestions

- 统一路径规范化：引入 normalizePath 函数，hidden Set 和 autoSync 删除检测均使用规范化路径，避免大小写和分隔符不一致导致逻辑失效。
- 引入状态互斥锁：使用 withStateLock 包裹所有修改 videos、current、hidden 的 handler，防止并发操作导致状态竞争。
- 完善资源清理：SCENE_GLUE 中增加 dispose 机制，removeAuroraBackground 时清除定时器和事件监听器。
- 增加 manifest 版本字段：加载时做数据迁移，为旧条目补充缺失字段。
- 配置外置：将 CONFIG 中的绝对路径移至环境变量或配置文件。
- 封装客户端 API 层：统一管理 API 端点、错误处理、超时和重试策略。

## Risks

- 路径穿越漏洞：/dyn/aurora-scan 接受任意 path 参数，无白名单校验，可能导致目录枚举和文件信息泄露。
- 隐藏列表绕过：路径规范化不一致可能导致隐藏功能失效。
- 状态不一致：current 索引在隐藏/显示操作后未同步更新，可能导致前端请求已销毁的路由。
- 资源泄漏：setInterval 定时器在 whale 模式下持续运行，浪费资源。

## Action Items

- [ ] 修复 BLOCKER-1：将 AMBIENT_KEY 改为版本化 key（如 'dsh.ambient.background.v1'），事件 payload 增加 protocol 版本字段。
- [ ] 修复 BLOCKER-2：在 /dyn/aurora-set handler 中返回可见列表索引，并同步更新前端逻辑。
- [ ] 实现统一路径规范化函数，并替换所有路径比较逻辑。
- [ ] 为所有状态修改操作添加互斥锁，防止并发竞争。
- [ ] 在 SCENE_GLUE 中实现 dispose 函数，并在 removeAuroraBackground 中调用。
- [ ] 为 /dyn/aurora-scan 添加路径白名单校验。
- [ ] 增加 manifest version 字段及迁移逻辑。
- [ ] 补充单元测试和集成测试，覆盖隐藏/显示/扫描的索引边界场景。

## Discussion Transcript

### 架构师 (round 1)

## 架构评审意见

### 1. **架构模式转换不完整（高优先级）**

代码从"动态 Cordis 插件"迁移到"静态 bundle"模式，但存在架构不一致：

- **`host.js` 仍保留动态插件特征**：`export function apply(ctx)` 中仍使用 `ctx.get('webServer')`、`ctx.get('fs')` 等动态依赖注入，而 `client.js` 已改为静态 bundle 的 `ctx.theme`、`ctx.slots` 直接属性访问。两种模式混用会导致维护者困惑，且未来框架升级时可能产生兼容性问题。

**建议**：明确统一为静态 bundle 模式，host 侧也应改为静态导出 + 显式依赖声明，而非运行时 `ctx.get()`。

---

### 2. **模块边界模糊：跨插件耦合（高优先级）**

新增的 `AMBIENT_KEY = 'dsh.ambient.background'` 与 whale-on-desk 插件通过 localStorage 和自定义事件 `dsh-ambient-change` 耦合：

- **隐式协议**：两个独立插件通过全局 localStorage key 和 window 事件通信，没有版本化协议或 schema 校验
- **硬编码互斥**：Aurora 硬编码了 whale-on-desk 的标识 `'whale-aquarium'`，若 whale 插件改名或增加新背景模式，Aurora 需要发版更新

**建议**：抽象为独立的"背景管理器"服务（可通过 DSH 的 service 机制），由它统一管理背景模式切换和互斥，各壁纸插件只注册自身能力。

---

### 3. **路由管理重构引入状态不一致风险（中优先级）**

`syncRoutes()` 采用"全量销毁重建"策略，但 `current` 索引在隐藏/显示操作后未同步更新：

```javascript
// setHidden 中：
if (hide && videos[current]?.file === target) {
  const visible = visibleVideos()
  current = visible.length > 0 ? videos.findIndex(...) : 0
}
```

当隐藏非当前项时，`current` 指向的 `videos[current]` 可能已被隐藏，但 `current` 数值未变，导致 `/dyn/aurora-video/{current}.mp4` 路由已销毁但前端仍请求。

**建议**：统一封装 `setCurrentByVisibleIndex()` 函数，所有修改列表的操作（hide/unhide/scan/remove）都通过它更新 `current`，确保 `current` 始终指向可见项。

---

### 4. **数据模型演进缺乏版本控制（中优先级）**

manifest 格式从 `{ videos: [...] }` 演进到 `{ videos, hidden: [...] }`，但：

- 无 schema 版本字段，旧版本插件读取新格式会忽略 `hidden`，新版本读取旧格式则 `hidden` 为空数组——尚可容忍，但未来字段继续增加会失控
- `videos` 条目新增 `root` 字段，但 `renumber()` 中保留了 `root: v.root`，而旧 manifest 中的条目没有 `root`，导致 `autoSync` 的删除检测逻辑对旧数据失效

**建议**：manifest 增加 `version` 字段，加载时做迁移（如为旧条目补 `root: ''` 或触发一次全量扫描）。

---

### 5. **安全边界：路径处理不一致（中优先级）**

`autoSync` 中删除检测使用字符串前缀匹配：

```javascript
const prefix = rootPath.replace(/[\\/]+$/, '') + '\\'
v.file.toLowerCase().startsWith(prefix.toLowerCase())
```

而 `setHidden` 直接使用 `v.file` 作为 key。若 `rootPath` 含大小写不一致（如 `D:\Work` vs `d:\work`），或路径分隔符混用（`/` vs `\`），会导致隐藏/删除逻辑失效。

**建议**：统一路径规范化函数（如 `normalizePath()`），所有文件路径比较前先规范化。

---

### 6. **客户端 API 层抽象缺失（低优先级）**

客户端从 `host.call('aurora-list')` 改为直接 `fetch('/dyn/aurora-list.json')`：

- URL 硬编码在客户端代码中，若 host 挂载路径变化（如未来支持多实例），需全局替换
- 无错误处理封装，每个 fetch 调用重复 try-catch 逻辑

**建议**：封装 `api.js` 模块，统一管理 API 端点、错误处理、超时和重试策略。

---

### 7. **清理逻辑不完整（低优先级）**

`removeAuroraBackground()` 只移除 `[data-ambient="aurora"]` 元素，但：

- 未清理 `#aurora-bg` 上绑定的事件监听器（若有）
- 未停止 `SCENE_GLUE` 中启动的 `setInterval(poll, 3000)` 定时器——该定时器在 whale 模式下仍在运行，浪费资源

**建议**：提供全局的 `disposeAurora()` 清理函数，由宿主在模式切换时调用，确保所有资源（定时器、监听器、DOM）被正确释放。

---

### 8. **配置与代码耦合（低优先级）**

`CONFIG` 中的绝对路径（`D:\steam\...`、`D:\WORK AREA\...`）硬编码在源码中，且 `v

### 安全工程师 (round 1)

## 安全评审意见（第 1 轮）

### 🔴 BLOCKING-1: 路径穿越漏洞 - `/dyn/aurora-scan` 端点

**位置**: `host.js` - `autoSync()` 和 `/dyn/aurora-scan` handler

**风险**: 攻击者可通过 `path` 参数指定任意文件系统路径进行扫描，无任何路径白名单或沙箱校验。

```javascript
// /dyn/aurora-scan handler
const raw = queryParam(req.url, 'path')
if (raw !== null && raw !== '') result = await autoSync(raw)
```

`autoSync` 会递归读取该目录下所有子目录，并尝试解析 `project.json`。攻击者可指向：
- `C:\Users\` - 枚举用户目录结构
- `D:\` - 扫描整个磁盘
- 任意网络共享路径

**影响**: 目录枚举、文件存在性探测、信息泄露

**修复建议**:
```javascript
// 添加路径白名单校验
const ALLOWED_ROOTS = [WORKSHOP, path.dirname(WORKSHOP)]
function isAllowedScanPath(p) {
  const normalized = path.resolve(p)
  return ALLOWED_ROOTS.some(root => 
    normalized.toLowerCase().startsWith(path.resolve(root).toLowerCase())
  )
}
```

---

### 🔴 BLOCKING-2: 路径穿越漏洞 - `/dyn/aurora-video/{n}.mp4` 和 `/dyn/aurora-scene/{n}.pkg`

**位置**: `host.js` - `serveVideo()` 和 `serveScenePkg()`

**风险**: 虽然 URL 使用数字索引 `n`，但需确认 `videos[n]` 的 `file` 字段是否可能被篡改。如果攻击者能通过其他漏洞（如 manifest 注入）修改 `videos` 数组中的 `file` 路径，则可读取任意文件。

```javascript
// serveVideo 中
const filePath = v.file  // 直接使用存储的路径
```

**影响**: 任意文件读取（如果 file 字段可控）

**修复建议**: 
- 确保 `videos` 数组只从可信的 `autoSync` 结果构建
- 对 `v.file` 做规范化校验，确保在允许的根目录内
- 添加文件扩展名白名单（`.mp4`, `.webm`, `.jpg`, `.png` 等）

---

### 🔴 BLOCKING-3: 任意文件读取 - `/dyn/aurora-lib.js` 打包逻辑

**位置**: `host.js` - boot 函数中 LIB_FILES 读取逻辑

**风险**: 如果 `LIB_FILES` 中的相对路径可被外部影响，或 `weSceneSrc` 配置指向恶意目录，可能导致任意文件内容被读取并返回给客户端。

```javascript
// 需要检查 LIB_FILES 的构建逻辑
for (const rel of LIB_FILES) {
  // 读取 weSceneSrc + rel 的文件内容
}
```

**影响**: 源码泄露、配置信息泄露

**修复建议**: 
- 确保 `weSceneSrc` 在初始化时被固定，不接受运行时修改
- 对 `rel` 路径做规范化，防止 `../` 逃逸

---

### 🟠 HIGH-1: 路径前缀匹配绕过 - 删除检测逻辑

**位置**: `host.js` - `autoSync()` 中的删除检测

```javascript
const prefix = rootPath.replace(/[\\/]+$/, '') + '\\'
v.file.toLowerCase().startsWith(prefix.toLowerCase())
```

**风险**: 
- 路径规范化不一致（`D:\Work` vs `d:\work`）
- 前缀匹配可能被绕过：如 `D:\wallpaper_evil\` 会匹配 `D:\wallpaper\` 前缀
- 大小写不敏感比较在某些文件系统（Linux）上不适用

**影响**: 误删合法壁纸、隐藏列表绕过

**修复建议**:
```javascript
function normalizePath(p) {
  return path.normalize(p).toLowerCase()
}
// 使用 path.relative 判断是否在目录内
const rel = path.relative(rootPath, v.file)
if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
  // 在目录内
}
```

---

### 🟠 HIGH-2: 隐藏列表绕过 - 路径规范化不一致

**位置**: `host.js` - `setHidden()` 和 `isHidden()`

**风险**: `hidden` Set 使用原始 `v.file` 字符串作为 key。如果同一文件通过不同路径格式（如 `D:\dir\file.mp4` vs `d:\DIR\file.mp4`）被引用，可绕过隐藏检查。

**影响**: 隐藏功能失效、列表显示已隐藏内容

**修复建议**: 统一使用规范化路径作为 Set 的 key。

---

### 🟡 MEDIUM-1: 缺少输入校验 - `/dyn/aurora-set` 索引参数

**位置**: `host.js` - `/dyn/aurora-set` handler

```javascript
const n = parseInt(raw, 10)
if (!isNaN(n) && visible.length > 0) {
  const target = visible[((n % visible.length) + visible.length) % visible.length]
```

**风险**: 虽然做了取模运算防止越界，但 `parseInt` 接受 `"1abc"` 这类输入返回 `

### 测试工程师 (round 1)

## 测试工程师评审意见（第 1 轮）

### 🔴 BLOCKING-T1: 隐藏功能与当前索引状态不一致

**位置**: `host.js` - `setHidden()` 函数

**问题**: 当隐藏当前正在播放的壁纸时，`current` 索引更新逻辑存在缺陷：

```javascript
if (hide && videos[current] && videos[current].file === target) {
  const visible = visibleVideos()
  current = visible.length > 0 ? videos.findIndex((v) => v.file === visible[0].file) : 0
}
```

这里将 `current` 设置为可见列表第一项，但前端 `/dyn/aurora-list.json` 返回的 `index` 是 `Math.min(current, Math.max(0, visible.length - 1))`，两者可能不一致。

**测试建议**:
1. 测试场景：3 个壁纸，当前在第 2 个（index=1），隐藏第 2 个
   - 预期：`current` 应指向第 1 个可见壁纸（原第 1 个）
   - 实际：`current` 被设置为 `videos.findIndex(v => v.file === visible[0].file)`，即原第 1 个的索引 0，看起来正确
   - 但需验证：如果隐藏的是第 1 个（index=0），`current` 会指向原第 2 个（索引 1），而前端期望的 index 应该是 0

2. 测试场景：隐藏非当前壁纸，但该壁纸在当前壁纸之前
   - 预期：`current` 应保持不变（指向同一壁纸）
   - 实际：`current` 数值不变，但 `videos[current]` 的引用可能因数组重排而改变

**建议**: 添加单元测试覆盖所有隐藏位置组合（前/中/后），验证 `/dyn/aurora-list.json` 返回的 `index` 始终指向正确的可见壁纸。

---

### 🔴 BLOCKING-T2: 前端索引与后端索引映射错误

**位置**: `client.js` - `go()` 函数与 `host.js` - `/dyn/aurora-set` handler

**问题**: 前端使用 `index` 作为列表索引直接传给后端，但后端 `current` 是 `videos` 数组（包含隐藏项）的索引。当前端显示的是可见列表，用户点击第 3 个可见项（index=2），但实际 `videos` 中可能有隐藏项在前面，导致索引错位。

**测试场景**:
1. 有 5 个壁纸，隐藏第 2 个
2. 前端可见列表为 [0, 2, 3, 4]（原索引）
3. 用户点击可见列表第 3 项（前端 index=2，对应原索引 3）
4. 前端调用 `/dyn/aurora-set?index=2`
5. 后端 `visible[2]` 是原索引 3 的壁纸，`current` 被设为 3 ✓
6. 但前端 `/dyn/aurora-list.json` 返回的 `index` 是 `Math.min(current, ...)` = 3，而前端期望的是 2

**建议**: 
- 后端 `/dyn/aurora-set` 应返回可见列表中的索引，而非 `videos` 数组索引
- 添加集成测试验证隐藏/显示后的索引一致性

---

### 🟠 HIGH-T1: 并发操作导致状态竞争

**位置**: `host.js` - 多个 HTTP handler 同时修改 `videos`、`current`、`hidden`

**问题**: 以下操作可能并发执行，导致状态不一致：
- `/dyn/aurora-hide` 和 `/dyn/aurora-set` 同时请求
- `/dyn/aurora-scan` 和 `/dyn/aurora-hide` 同时请求

**测试建议**:
1. 并发测试：同时发送 10 个 `/dyn/aurora-hide` 请求（不同文件）
2. 并发测试：`/dyn/aurora-scan` 执行中发送 `/dyn/aurora-set`
3. 验证最终状态一致性（`videos.length`、`current` 范围、`hidden.size`）

---

### 🟠 HIGH-T2: 路径规范化不一致导致隐藏失效

**位置**: `host.js` - `setHidden()`、`isHidden()`、`auto

### 维护者/最终评审 (round 1)

## 维护者/最终评审意见（第 1 轮）

### 总体结论

**状态：需修改后合入（Request Changes）**

本次改动将插件从动态 Cordis 模式迁移到静态 bundle 模式，并新增了壁纸隐藏/恢复、与 whale-on-desk 的互斥切换等核心功能。架构方向正确，但存在 **2 个阻断性问题** 和 **4 个高风险问题** 需要解决。

---

### 🔴 阻断性问题（必须修复）

#### BLOCKER-1: 跨插件耦合协议未版本化

**问题**：`AMBIENT_KEY = 'dsh.ambient.background'` 和 `dsh-ambient-change` 事件是 Aurora 与 whale-on-desk 之间的隐式协议，但：
- 无版本号或 schema 校验
- 值域硬编码（`'aurora' | 'whale-aquarium'`）
- 事件无 payload 规范

**修复要求**：
```javascript
// 建议在 README 中明确协议规范，并增加版本检查
const AMBIENT_PROTOCOL_VERSION = 1;
const AMBIENT_KEY = 'dsh.ambient.background.v1';  // 版本化 key

// 事件增加版本信息
window.dispatchEvent(new CustomEvent('dsh-ambient-change', {
  detail: { mode: 'aurora', protocol: AMBIENT_PROTOCOL_VERSION }
}));
```

#### BLOCKER-2: 索引映射逻辑存在边界错误

**问题**：`/dyn/aurora-set` 返回的 `index` 与前端期望不一致。当隐藏项存在时，后端返回的是 `videos` 数组索引，而前端需要的是可见列表索引。

**修复要求**：
```javascript
// /dyn/aurora-set handler 中，返回可见索引而非原始索引
const visibleIndex = visible.findIndex(v => v.file === videos[current]?.file);
res.end(JSON.stringify({ index: visibleIndex >= 0 ? visibleIndex : 0 }));
```

---

### 🟠 高风险问题（强烈建议修复）

#### HIGH-1: 路径处理不一致

**问题**：`hidden` Set 使用原始路径，`autoSync` 使用字符串前缀匹配，路径规范化不统一。

**修复方案**：
```javascript
// 统一路径规范化工具函数
function normalizePath(p) {
  return path.normalize(p).replace(/\\/g, '/').toLowerCase();
}

// hidden Set 存储规范化路径
const hidden = new Set();  // 存储 normalizePath(v.file)

// autoSync 删除检测使用 path.relative
const rel = path.relative(rootPath, v.file);
if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
  // 在目录内
}
```

#### HIGH-2: 并发状态竞争

**问题**：多个 HTTP handler 并发修改 `videos`、`current`、`hidden`，无互斥机制。

**修复方案**：
```javascript
// 引入简单的互斥锁
let stateLock = Promise.resolve();
async function withStateLock(fn) {
  const run = stateLock.then(fn);
  stateLock = run.catch(() => {});
  return run;
}

// 所有修改状态的 handler 都通过 withStateLock 包裹
```

#### HIGH-3: 资源清理不完整

**问题**：`removeAuroraBackground()` 只移除 DOM 元素，但 `SCENE_GLUE` 中的 `setInterval(poll, 3000)` 定时器在 whale 模式下仍在运行。

**修复方案**：
```javascript
// SCENE_GLUE 中增加清理机制
const sceneGlue = `
  let pollTimer = null;
  // ... 原有代码
  window.__auroraDispose = function() {
    if (pollTimer) clearInterval(pollTimer);
    // 清理其他资源
  };
`;

// removeAuroraBackground 中调用
function removeAuroraBackground() {
  if (window.__auroraDispose) window.__auroraDispose();
  document.querySelectorAll('[data-ambient="aurora"]').forEach(el => el.remove());
}
```

#### HIGH-4: 安全边界 - 路径穿越风险

**问题**：`/dyn/aurora-scan` 接受任意 `path` 参数，无白名单校验。

**修复方案**：
```javascript
// 在 autoSync 入口添加路径校验
const ALLOWED_ROOTS = [WORKSHOP];
function isAllowedPath(p) {
  const normalized = path.resolve(p);
  return ALLOWED_ROOTS.some(root => 
    normalized.toLowerCase().startsWith(path.resolve(root).toLowerCase())
  );
}

// autoSync 开头
if (!isAllowedPath(rootPath)) {
  return { added: [], removed: [], errors: [`路径不在允许范围内: ${rootPath}`] };
}
```

---

### 📋 其他建议

1. **manifest 版本化**：增加 `version: 2` 字段，加载时做迁移
2. **配置外置**：将 `CONFIG` 中的绝对路径移到环境变量或配置文件
3. **错误处理统一**：封装 `apiFetch()` 函数，统一处理 HTTP 错误和 JSON 解析
4. **测试补充**：增加隐藏/显示/扫描的集成测试，覆盖索引边界场景

---

### 合入条件

- [ ] BLOCKER-1 和 BLOCKER-2 已修复
- [ ] HIGH-1 至 HIGH-4 已处理或有明确处理计划
- [ ] 补充必要的单元测试和集成测试
- [ ] README 更新跨插件协议说明

修复完成后可进入第 2 轮评审。
