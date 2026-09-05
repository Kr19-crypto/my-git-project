# Review Report

> Source: `samples\aurora.patch`
> Roles: architect, security, tester, maintainer
> Rounds: 1
> Token Budget: 150,000
> Usage: 73,285 tokens (67,113 in / 6,172 out)
> Truncated: false

## Summary

有条件通过（Conditional Pass）。补丁将插件从动态 Cordis 插件迁移至静态 bundle 格式，并新增隐藏/恢复壁纸、与 whale-on-desk 的背景模式互斥等核心功能。整体架构方向正确，但存在 2 个必须修复的阻塞级问题（路径安全校验缺失、沙箱策略被静默移除）和若干中高风险项。建议修复后合入。

## Blocking

- B1: 路径安全校验缺失 - /dyn/aurora-scan?path=、/dyn/aurora-hide?file=、/dyn/aurora-unhide?file= 三个路由接受任意路径参数，未做白名单校验，存在路径穿越和任意文件读取风险。需添加 ALLOWED_ROOTS 白名单校验，对 autoSync() 入口和 hide/unhide 的 file 参数进行路径规范化与目录限制，校验失败返回 400。
- B2: 沙箱策略被静默移除 - persist() 中原先传递 sandboxPolicy 参数，现被移除，可能绕过宿主安全控制或导致运行时错误。需恢复 sandboxPolicy 传递，或明确注释说明移除原因并在 README 中记录沙箱行为变化。

## Suggestions

- H1: 隐藏当前壁纸时索引计算错误 - setHidden() 中隐藏当前壁纸时，current 被设为第一张可见壁纸的索引，而非下一张可见壁纸。应改为从当前位置向后查找下一张可见壁纸，若无则回绕到开头。
- H2: 路由注册与隐藏状态不同步 - syncRoutes() 为所有 videos 注册路由（包括隐藏项），隐藏项仍可通过 URL 直接访问。应改为只注册可见项的路由。
- H3: 错误消息泄露内部路径 - 多个路由直接返回 err.message，可能包含服务端绝对路径。应统一错误响应格式，详细错误只记录在服务端日志。
- M1: 状态修改操作使用 GET 请求 - /dyn/aurora-set、/dyn/aurora-hide、/dyn/aurora-unhide、/dyn/aurora-scan 均为 GET 请求，存在 CSRF 风险。建议改为 POST 请求或校验 Referer/Origin 头。
- M2: 客户端 bundle 可维护性 - client.js 手写 ES5 bundle，无构建工具链，后续维护成本高。建议短期添加注释说明生成来源，长期引入 esbuild 构建步骤。
- M3: 配置硬编码 - CONFIG.workshopDir 等绝对路径硬编码在源码中，不利于跨机器部署。建议支持环境变量覆盖。

## Risks

- R1: 路径穿越与任意文件读取 - 若 B1 未修复，攻击者可扫描系统任意目录、读取敏感文件（如 C:\Windows\System32\config\SAM），或通过构造的 file 参数实施进一步攻击。
- R2: 沙箱绕过 - 若 B2 未修复，插件可能绕过宿主安全策略，导致未授权的文件系统写入，或与宿主沙箱机制冲突引发运行时错误。
- R3: 隐藏功能逻辑缺陷 - 若 H1 未修复，用户隐藏当前壁纸时体验异常（跳回列表开头），可能引发用户困惑或误操作。
- R4: 隐藏项仍可访问 - 若 H2 未修复，隐藏的壁纸文件仍可通过 URL 直接访问，隐藏功能形同虚设，且可能泄露用户不想展示的内容。
- R5: 信息泄露 - 若 H3 未修复，错误消息可能泄露服务端路径和文件系统结构，为攻击者提供侦察信息。
- R6: CSRF 攻击 - 若 M1 未修复，恶意网站可通过 img 或 script 标签发起跨站请求，执行未授权的状态修改操作。
- R7: 配置硬编码导致部署失败 - 若 M3 未修复，插件在其他机器上无法正常运行，需手动修改源码。

## Action Items

- [ ] 1. 在 host.js 中添加 ALLOWED_ROOTS 白名单校验函数 isAllowedPath()，并在 autoSync()、/dyn/aurora-hide、/dyn/aurora-unhide 路由中强制校验路径参数，校验失败返回 400。
- [ ] 2. 恢复 persist() 中的 sandboxPolicy 参数传递，或明确注释说明移除原因并在 README 中记录沙箱行为变化。
- [ ] 3. 修复 setHidden() 中隐藏当前壁纸时的索引计算逻辑，改为选择下一张可见壁纸（向后查找，无则回绕）。
- [ ] 4. 修改 syncRoutes() 使其只注册可见项的路由，确保隐藏项无法通过 URL 直接访问。
- [ ] 5. 统一错误响应格式，将详细错误信息记录到服务端日志，客户端只返回通用错误消息。
- [ ] 6. 将状态修改操作（aurora-set、aurora-hide、aurora-unhide、aurora-scan）改为 POST 请求，或添加 Referer/Origin 校验。
- [ ] 7. 在 client.js 文件头部添加注释说明其由源码构建生成，并考虑引入 esbuild 构建步骤。
- [ ] 8. 将 CONFIG 中的硬编码路径改为支持环境变量覆盖（如 AURORA_WORKSHOP_DIR）。
- [ ] 9. 补充测试用例：隐藏当前壁纸的索引跳转、隐藏所有壁纸的边界行为、路径大小写/特殊字符/相似前缀目录、扫描幂等性、双标签页背景模式切换竞态。

## Discussion Transcript

### 架构师 (round 1)

## 架构评审意见

### 1. 核心架构问题：从动态插件到静态 bundle 的迁移不彻底

**严重性：高**

代码显示插件正从动态 Cordis 插件（`return { apply(ctx) }`）迁移到静态 bundle 格式（`window.__ModuleLoader__.load()`），但迁移不完整：

- **host.js** 已正确迁移为 ESM 模块（`export function apply(ctx)`）
- **client.js** 仍保留动态插件的 `ctx.get()` 调用模式，但已改为 `ctx.theme`/`ctx.slots` 直接属性访问

**建议：**
- 明确 client 与 host 的通信边界。当前 client 通过 `fetch('/dyn/...')` 调用宿主，但 host 仍通过 `webServer.register()` 注册路由，两者职责重叠
- 建议将 `/dyn/` 路由注册抽象为统一的 RPC 层，避免 client 直接依赖 URL 结构

### 2. 模块边界模糊：背景模式切换的跨插件耦合

**严重性：高**

新增的 `dsh.ambient.background` localStorage 键和 `dsh-ambient-change` 事件，使 Aurora 与 whale-on-desk 插件形成隐式耦合：

- 通过 localStorage 共享状态，而非通过 DSH 的正式服务接口
- 事件监听使用 `location.reload()` 强制刷新，架构上属于"暴力解耦"
- 两个插件都操作 `data-ambient` DOM 属性，但没有统一的 DOM 所有权协议

**建议：**
- 定义正式的"背景管理器"服务接口（如 `ctx.get('ambientBackground')`），由 DSH 核心或独立模块提供
- 插件通过该服务注册/注销背景提供者，而非直接操作 DOM 和 localStorage
- 若必须保持当前方案，至少将 ambient 协议提取为共享模块，避免两插件各自实现

### 3. 数据持久化与沙箱约束的架构冲突

**严重性：高**

host.js 中 `vaultDir` 从独立目录改为 workspace 内路径，这是对沙箱约束的妥协，但引发架构问题：

- 用户数据（壁纸清单、隐藏列表）与工作区文件混杂，可能被用户误操作
- 沙箱策略（`sandboxPolicy`）被移除，`fs.writeText()` 不再传递 policy 参数，可能绕过安全控制

**建议：**
- 明确沙箱边界：若宿主强制 workspace-write，应通过宿主提供的专用存储 API（如 `ctx.get('storage')`）而非直接文件系统操作
- 若必须使用文件系统，应保留 `sandboxPolicy` 并显式声明所需权限，而非静默移除

### 4. 路由管理重构不完整：状态与路由不同步

**严重性：中**

`syncRoutes()` 在隐藏/恢复壁纸时被调用，但存在时序问题：

```javascript
async function setHidden(file, hide) {
  // ...
  if (alive.has(target)) {
    // 直接修改 current 和调用 syncRoutes()
    // 但此时 videos 数组尚未更新（隐藏项仍在列表中）
  }
}
```

`setHidden` 只更新 `hidden` Set，不更新 `videos` 数组。虽然 `visibleVideos()` 会过滤，但 `current` 索引可能指向隐藏项，且 `syncRoutes()` 仍为隐藏项注册路由。

**建议：**
- 统一数据流：隐藏/恢复操作应通过单一入口修改 `videos` 状态，然后触发路由重建
- 将 `current` 索引与 `visibleVideos()` 解耦，始终存储可见列表索引

### 5. 客户端 bundle 格式的代码可维护性风险

**严重性：中**

client.js 的手写 bundle 格式（`window.__ModuleLoader__.load()`）存在严重可维护性问题：

- 所有 ES6+ 语法被手动降级为 ES5（`var`、函数表达式替代箭头函数）
- React hooks 被拆分为数组解构形式，丧失可读性
- 无构建工具链支持，任何修改都需手动同步两份代码

**建议：**
- 引入构建步骤（如 esbuild/rollup），从源码生成 bundle
- 或使用 DSH 提供的官方 client 开发框架，避免手写模块加载器格式

### 6. 错误处理与恢复策略缺失

**严重性：中**

- `persist()` 失败仅返回 `false`，调用方不处理
- `autoSync()` 中 `videos` 被重新赋值（`videos = videos.filter(...)`），但 `routeByFile` Map 中的旧路由未清理
- 隐藏列表持久化失败时，内存状态与磁盘状态可能不一致

**建议：**
- 为持久化操作添加重试和回滚机制
- 在 `autoSync()` 中，若 `videos` 被重新赋值，应先调用 `disposeAllRoutes()` 清理旧路由

### 7. 配置硬编码与部署灵活性

**严重性：低**

`CONFIG` 中的绝对路径（`D:\steam\...`）使插件无法跨机器部署。虽然注释说明"使用前请修改"，但作为 npm 包分发，应支持环境变量或配置文件覆盖。

**建议：**
- 支持通过环境变量（如 `AURORA_WORKSHOP_DIR`）或 DSH 配置系统注入

### 安全工程师 (round 1)

我以安全工程师视角审查该补丁，发现以下安全风险：

---

## 🔴 BLOCKING 级风险

### 1. 路径穿越漏洞（严重）
**位置**: `src/host.js` - `autoSync()` 函数和 `/dyn/aurora-scan` 路由

**问题**: 
```javascript
// autoSync 函数中
const prefix = rootPath.replace(/[\\/]+$/, '') + '\\'
// ...
videos = videos.filter((v) => {
  if (typeof v.file !== 'string' || !v.file.toLowerCase().startsWith(prefix.toLowerCase())) return true
  // ...
})
```
`rootPath` 来自 `/dyn/aurora-scan?path=` 的查询参数，未做任何路径规范化或沙箱检查。攻击者可传入任意路径（如 `C:\Windows\System32`），导致：
- 扫描系统目录并暴露文件信息
- 通过 `/dyn/aurora-video/{n}.mp4` 路由读取任意文件

**修复建议**:
```javascript
// 添加路径白名单校验
const ALLOWED_ROOTS = [CONFIG.workshopDir, CONFIG.vaultDir]
function isAllowedPath(p) {
  const normalized = path.resolve(p)
  return ALLOWED_ROOTS.some(root => 
    normalized.toLowerCase().startsWith(path.resolve(root).toLowerCase())
  )
}
```

### 2. 任意文件读取漏洞（严重）
**位置**: `src/host.js` - `serveVideo()` 和 `serveScenePkg()` 函数

**问题**:
```javascript
// serveVideo 中
const filePath = v.file  // 来自 manifest 或扫描结果
// 直接使用 filePath 读取文件
```
由于扫描功能可指向任意目录，且 manifest 文件（`vaultDir/.aurora-manifest.json`）可被篡改，攻击者可通过构造恶意 manifest 或利用扫描功能，使 `v.file` 指向任意敏感文件（如 `C:\Windows\System32\config\SAM`），然后通过 `/dyn/aurora-video/0.mp4` 读取。

**修复建议**:
- 对 `v.file` 进行扩展名白名单校验（`.mp4`, `.webm`, `.jpg`, `.png`, `.pkg`）
- 验证文件路径必须在允许的根目录内
- 对 manifest 文件进行完整性校验

### 3. 路径穿越 - 隐藏功能（高危）
**位置**: `src/host.js` - `/dyn/aurora-hide` 和 `/dyn/aurora-unhide` 路由

**问题**:
```javascript
// /dyn/aurora-hide 路由
const raw = queryParam(req.url, 'file')
if (raw !== null && raw !== '') {
  await setHidden(raw, true)  // 直接使用用户提供的路径
}
```
攻击者可传入任意文件路径，将其加入隐藏列表。虽然不直接删除文件，但可导致：
- 通过 `hidden` 列表信息泄露系统文件路径
- 配合其他漏洞进行进一步攻击

**修复建议**: 对 `file` 参数进行路径规范化，并验证其在允许的目录范围内。

---

## 🟠 高危风险

### 4. 缺少输入验证 - 扫描路径（高危）
**位置**: `src/host.js` - `/dyn/aurora-scan` 路由

**问题**:
```javascript
const raw = queryParam(req.url, 'path')
if (raw !== null && raw !== '') result = await autoSync(raw)
```
`path` 参数直接传给 `autoSync()`，没有验证：
- 是否是绝对路径
- 是否在允许的目录内
- 是否包含特殊字符（如 `..`）

**修复建议**:
```javascript
function validateScanPath(p) {
  if (typeof p !== 'string' || p.length > 1024) return false
  const resolved = path.resolve(p)
  const allowed = [CONFIG.workshopDir, CONFIG.vaultDir]
  return allowed.some(dir => resolved.toLowerCase().startsWith(dir.toLowerCase()))
}
```

### 5. 敏感信息泄露 - 错误消息（中高危）
**位置**: 多个路由的错误处理

**问题**:
```javascript
// /dyn/aurora-hide 路由
res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }))

// /dyn/aurora-scan 路由
res.end(JSON.stringify({ added: [], removed: [], errors: ['scan 错误: ' + String(err && err.message || err)] }))
```
错误消息直接暴露给客户端，可能泄露：
- 文件系统结构
- 服务端路径信息
- 内部实现细节

**修复建议**: 对错误消息进行脱敏处理，只返回通用错误信息。

---

## 🟡 中危风险

### 6. 缺少 CSRF 防护（中危）
**位置**: 所有 `/dyn/` 路由

**问题**: 所有路由（`aurora-set`, `aurora-scan`, `aurora-hide`, `aurora-unhide`）都是 GET 请求，且无 CSRF token 验证。恶意网站可通过 `<img>` 或 `<script>` 标签发起跨站请求，执行未授权操作。

**修复建议**:
- 将状态修改操作改为 POST 请求
- 添加 CSRF token 验证
- 检查 `Origin` 或

### 测试工程师 (round 1)

# 测试工程师评审意见

## 一、功能测试缺口

### 1. 隐藏/恢复功能缺少边界测试
**严重性：高**

新增的隐藏/恢复功能存在多个未覆盖的边界场景：

```javascript
// 需要测试的场景：
// 1. 隐藏当前正在播放的壁纸
// 2. 隐藏最后一张可见壁纸
// 3. 恢复时 current 索引的正确性
// 4. 隐藏列表持久化失败时的行为
```

**具体测试建议：**
- 隐藏当前壁纸后，`current` 是否正确指向下一张可见壁纸
- 当所有壁纸都被隐藏时，`/dyn/aurora-list.json` 返回的 `index` 是否为 0（当前代码 `Math.min(current, Math.max(0, visible.length - 1))` 在 `visible.length === 0` 时会返回 0，但 UI 可能显示异常）
- 隐藏后立即刷新页面，隐藏状态是否正确恢复
- 恢复全部隐藏壁纸后，`current` 索引是否正确重置

### 2. 背景模式切换的竞态条件
**严重性：高**

```javascript
// client.js 中
window.addEventListener('dsh-ambient-change', onAmbientChange);
// onAmbientChange 直接调用 location.reload()
```

**问题：** 多个标签页同时打开时，一个标签页切换模式会导致所有标签页刷新，可能造成：
- 未保存的设置丢失
- 多个标签页同时刷新导致服务器压力

**测试建议：**
- 双标签页场景：标签页 A 切换到 whale 模式，标签页 B 是否立即刷新
- 快速连续切换模式（< 1秒内多次点击），是否产生多次 reload
- 验证 `localStorage` 写入失败时的降级行为（`setAmbientMode` 中 catch 后仍调用 `location.reload()`）

### 3. 扫描功能的幂等性
**严重性：中**

```javascript
// autoSync 中新增的删除逻辑
videos = videos.filter((v) => {
  if (typeof v.file !== 'string' || !v.file.toLowerCase().startsWith(prefix.toLowerCase())) return true
  if (alive.has(v.file)) return true
  removed.push(v.title)
  return false
})
```

**测试建议：**
- 连续两次扫描同一目录，第二次不应报告任何 `removed` 项
- 扫描目录 A 后，再扫描目录 B，目录 A 的壁纸不应被误删
- 扫描不存在的目录，错误处理是否正确（`errors` 数组应包含该路径）

## 二、边界条件测试

### 4. 路径处理边界
**严重性：高**

```javascript
// 路径前缀匹配逻辑
const prefix = rootPath.replace(/[\\/]+$/, '') + '\\'
v.file.toLowerCase().startsWith(prefix.toLowerCase())
```

**测试用例：**
- 路径大小写不匹配（Windows 不区分大小写，但代码用 `toLowerCase()` 处理）
- 路径末尾是否有分隔符（`D:\wallpapers` vs `D:\wallpapers\`）
- 路径包含特殊字符（空格、Unicode、`..`）
- 路径为根目录（`D:\`）时，`prefix` 是否正确
- 路径包含相似前缀的目录（如 `D:\wallpapers` 和 `D:\wallpapers2`）

### 5. 索引边界
**严重性：高**

```javascript
// /dyn/aurora-set 路由
const n = parseInt(raw, 10)
if (!isNaN(n) && visible.length > 0) {
  const target = visible[((n % visible.length) + visible.length) % visible.length]
  const idx = videos.findIndex((v) => v.file === target.file)
  if (idx >= 0) current = idx
}
```

**测试用例：**
- `index` 为负数（如 `-1`）
- `index` 为极大值（如 `999999`）
- `index` 为非数字（如 `abc`）
- `index` 为浮点数（如 `1.5`）
- `visible.length === 0` 时的行为

### 6. 隐藏列表边界
**严重性：中**

**测试用例：**
- 隐藏一个不存在的文件路径
- 重复隐藏同一文件
- 隐藏后文件被删除（磁盘上），恢复时如何处理
- 隐藏列表超过 1000 项时的性能

### 维护者/最终评审 (round 1)

# 最终评审意见

## 总体结论

**结论：有条件通过（Conditional Pass）**

本补丁将插件从动态 Cordis 插件迁移至静态 bundle 格式，并新增隐藏/恢复壁纸、与 whale-on-desk 的背景模式互斥等核心功能。整体架构方向正确，但存在 **2 个必须修复的阻塞级问题** 和若干中高风险项。建议修复后合入。

---

## 🔴 必须修改项（Blocking）

### B1. 路径安全校验缺失（安全工程师已指出，确认阻塞）

**问题**：`/dyn/aurora-scan?path=`、`/dyn/aurora-hide?file=`、`/dyn/aurora-unhide?file=` 三个路由接受任意路径参数，未做白名单校验。攻击者可：
- 扫描系统任意目录并泄露文件信息
- 通过构造的 `file` 参数读取敏感文件

**修改要求**：
```javascript
// 在 host.js 顶部添加
const ALLOWED_ROOTS = [CONFIG.workshopDir, CONFIG.vaultDir]
function isAllowedPath(p) {
  if (typeof p !== 'string' || p.length > 1024) return false
  const resolved = path.resolve(p)
  return ALLOWED_ROOTS.some(root => 
    resolved.toLowerCase().startsWith(path.resolve(root).toLowerCase())
  )
}
```
- `autoSync()` 入口校验 `rootPath`
- `/dyn/aurora-hide` 和 `/dyn/aurora-unhide` 校验 `file` 参数
- 校验失败返回 400

### B2. 沙箱策略被静默移除（架构师已指出，确认阻塞）

**问题**：`persist()` 中原先传递 `sandboxPolicy` 参数，现被移除。若宿主强制 workspace-write 沙箱，直接调用 `fs.writeText()` 可能绕过安全控制或导致运行时错误。

**修改要求**：
```javascript
async function persist() {
  try {
    const policy = sandboxPolicy ? sandboxPolicy.resolve({}) : undefined
    const mt = await fs.resolve(MANIFEST)
    await fs.writeText(mt, JSON.stringify({ videos, hidden: [...hidden] }, null, 2), undefined, undefined, policy)
    return true
  } catch (e) { return false }
}
```
若 `sandboxPolicy` 确实不可用，需在代码注释中明确说明原因，并在 README 中记录沙箱行为变化。

---

## 🟠 高风险项（强烈建议修复）

### H1. 隐藏当前壁纸时索引计算错误

**问题**：`setHidden()` 中隐藏当前壁纸时：
```javascript
if (hide && videos[current] && videos[current].file === target) {
  const visible = visibleVideos()
  current = visible.length > 0 ? videos.findIndex((v) => v.file === visible[0].file) : 0
}
```
`visibleVideos()` 在 `hidden.add(target)` 之后调用，此时 `target` 已被过滤。但 `current` 被设为 `visible[0]` 的索引——这会将当前播放跳转到**第一张**可见壁纸，而非**下一张**。用户隐藏正在观看的壁纸时，体验是突然跳回列表开头。

**修改建议**：
```javascript
if (hide && videos[current] && videos[current].file === target) {
  // 找到当前壁纸在 videos 中的位置，选择下一张可见壁纸
  const curIdx = current
  // 从当前位置向后找下一张可见的
  let next = -1
  for (let i = curIdx + 1; i < videos.length; i++) {
    if (!hidden.has(videos[i].file)) { next = i; break }
  }
  if (next === -1) {
    // 没有下一张，找第一张可见的
    for (let i = 0; i < curIdx; i++) {
      if (!hidden.has(videos[i].file)) { next = i; break }
    }
  }
  current = next >= 0 ? next : 0
}
```

### H2. 路由注册与隐藏状态不同步

**问题**：`syncRoutes()` 为所有 `videos` 注册路由（包括隐藏项）。虽然隐藏项不会出现在列表中，但其视频/场景文件仍可通过 `/dyn/aurora-video/{n}.mp4` 直接访问。若隐藏的语义是"用户不想看到"，路由应同步移除。

**修改建议**：`syncRoutes()` 只注册可见项：
```javascript
function syncRoutes() {
  disposeAllRoutes()
  for (const v of visibleVideos()) registerFor(v)
}
```
注意：`visibleVideos()` 依赖 `hidden` Set，需确保在调用前已更新。

### H3. 错误消息泄露内部路径

**问题**：多个路由直接返回 `err.message`，可能包含服务端绝对路径。

**修改建议**：统一错误响应格式：
```javascript
function sendError(res, err, msg = '操作失败') {
  res.writeHead(500, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: msg }))
  console.error('[aurora]', err)  // 详细错误只记录在服务端日志
}
```

---

## 🟡 中风险项（建议修复）

### M1. 状态修改操作使用 GET 请求

**问题**：`/dyn/aurora-set`、`/dyn/aurora-hide`、`/dyn/aurora-unhide`、`/dyn/aurora-scan` 均为 GET 请求，存在 CSRF 风险。

**修改建议**：
- 改为 POST 请求
- 或至少校验 `Referer`/`Origin` 头

### M2. 客户端 bundle 可维护性

**问题**：client.js 手写 ES5 bundle，无构建工具链，后续维护成本高。

**修改建议**：
- 短期：在文件头部添加注释说明"此文件由 src/client.src.js 构建生成，勿手改"
- 长期：引入 esbuild 构建步骤

### M3. 配置硬编码

**问题**：`CONFIG.workshopDir` 等绝对路径硬编码在源码中。

**修改建议**：支持环境变量覆盖：
```javascript
const CONFIG = {
  workshopDir: process.env.AURORA_WORKSHOP_DIR || 'D:\\steam\\steamapps\\workshop\\content\\431960',
  // ...
}
```

---

## ✅ 通过项确认

以下方面评审通过，无需修改：

1. **ESM 迁移**：host.js 正确使用 `export function apply(ctx)` 和 `export const inject`
