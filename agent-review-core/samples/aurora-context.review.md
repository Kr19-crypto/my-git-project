# Review Report

> Source: `samples\aurora.patch`
> Roles: architect, security, tester, maintainer
> Rounds: 1
> Token Budget: 150,000
> Usage: 72,491 tokens (66,904 in / 5,587 out)
> Truncated: false

## Summary

本次从动态插件到静态 bundle 的架构迁移方向正确，功能增强设计合理，但存在发布包缺失关键源码、路径穿越安全漏洞等阻断性问题，以及多项必须修复项，当前状态不建议合入或发布。

## Blocking

- 发布包缺少 we-scene 源码，场景壁纸功能在 npm 安装后完全失效（package.json files 字段未包含 packages/we-scene，host.js 中路径指向不存在）
- /dyn/aurora-scan 接口存在路径穿越漏洞，可扫描任意目录导致信息泄露或 DoS
- /dyn/aurora-hide 接口接受任意 file 路径，可隐藏任意文件或操纵状态
- host.js 中残留未使用的 sandboxPolicy 和 harness 服务获取，与静态 bundle 架构不一致
- aurora-set 和 aurora-list.json 在空列表或全部隐藏时返回 index:-1，可能导致客户端异常
- persist() 静默失败且调用方不检查返回值，用户操作看似成功但状态未持久化

## Suggestions

- 将 we-scene 源码打包进 src/ 目录或作为独立 npm 依赖引入
- 对 aurora-scan 增加白名单目录校验，对 aurora-hide 校验 file 必须存在于 videos 列表
- 清理未使用的服务获取，明确静态 bundle 依赖边界
- 处理空列表边界，返回 index:0 或明确错误
- persist() 失败时向客户端返回警告信息
- 抽象跨插件互斥协议（如 ctx.ambient.register()），避免硬编码字符串常量
- 为 manifest 添加 schemaVersion 字段，预留数据迁移能力
- syncRoutes() 采用先构建后切换的原子性策略，避免部分路由缺失
- 补充核心逻辑单元测试（autoSync、setHidden、renumber 等），使用 mock 宿主
- 将客户端文件明确为 .cjs 或调整 exports 配置，避免 ESM 格式冲突

## Risks

- 发布后场景壁纸功能完全失效，影响用户核心体验
- 路径穿越漏洞可能导致系统目录枚举、文件元数据泄露或资源耗尽
- 空列表边界处理不当可能导致客户端渲染异常或崩溃
- 持久化失败静默导致用户状态丢失，降低信任度
- 跨插件互斥硬编码耦合，未来扩展新背景插件时需修改所有现有插件
- 路由注册非原子性，中途失败可能导致壁纸路由缺失且无回滚机制

## Action Items

- [ ] 立即修复 BLOCKING-1：将 we-scene 源码打包进 src/ 目录或改为独立 npm 依赖，并更新 host.js 中路径解析逻辑
- [ ] 立即修复 MUST-2：为 aurora-scan 增加白名单校验，为 aurora-hide 增加 file 存在性校验
- [ ] 修复 MUST-1：删除 host.js 中 sandboxPolicy 和 harness 的获取
- [ ] 修复 MUST-3：在 aurora-set 和 aurora-list.json 中处理空列表边界，返回 index:0
- [ ] 修复 MUST-4：persist() 失败时返回警告信息给客户端
- [ ] 在干净环境执行 npm pack 验证包内容完整性，并运行集成测试确认功能正常
- [ ] 规划下个版本实现 SHOULD-1 至 SHOULD-4（协议抽象、schemaVersion、原子路由、测试补充）

## Discussion Transcript

### 架构师 (round 1)

## 架构评审意见

### 1. **架构模式转换不彻底（高风险）**

从动态插件到静态 bundle 的转换存在架构不一致：

```javascript
// host.js 中残留动态插件模式
export function apply(ctx) {
    const webServer = ctx.get('webServer')
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')  // 已不再使用
    const harness = ctx.get('harness')  // 已不再使用
```

**问题**：`sandboxPolicy` 和 `harness` 的获取已无实际用途，但代码结构仍保留动态插件的依赖注入模式。这会导致：
- 维护者误以为这些服务仍在使用
- 静态 bundle 模式下这些服务可能不存在，造成隐性初始化成本

**建议**：彻底清理未使用的服务获取，明确静态 bundle 的依赖边界。

### 2. **模块边界模糊（关键问题）**

`host.js` 中 `PLUGIN_DIR` 的解析逻辑存在架构隐患：

```javascript
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const weSceneSrc = path.join(PLUGIN_DIR, '..', 'packages', 'we-scene', 'src')
```

**问题**：这个路径假设插件总是从 `src/` 目录加载，且 `packages/we-scene` 总是位于上级目录。在 npm 包分发场景下，`files` 字段只包含 `src`、`cordis.patch.yml`、`README.md`，**`packages/we-scene` 根本不会被包含**！

**影响**：发布到 npm 后，`weSceneSrc` 将指向不存在的路径，场景壁纸渲染功能完全失效。

**建议**：
- 将 `we-scene` 作为独立 npm 依赖引入
- 或将其源码打包进 `src/` 目录
- 至少提供运行时错误检测和清晰的降级策略

### 3. **跨插件通信协议未抽象（架构缺陷）**

与 whale-on-desk 的互斥逻辑直接硬编码在客户端：

```javascript
var AMBIENT_KEY = 'dsh.ambient.background';
var AMBIENT_AURORA = 'aurora';
var AMBIENT_WHALE = 'whale-aquarium';
```

**问题**：
- 通过 `localStorage` + `location.reload()` 实现互斥，是页面级全局状态，无法响应式更新
- 插件间耦合通过字符串常量，无版本兼容机制
- 未来第三个背景插件加入时，需要修改所有现有插件

**建议**：抽象一个 `dsh-ambient` 服务接口（如 `ctx.ambient.register()`），由宿主提供统一管理，插件只需声明自己的背景类型。

### 4. **路由管理重构不完整（一致性问题）**

`syncRoutes()` 引入了整体重装机制，但存在状态不一致风险：

```javascript
function syncRoutes() {
    disposeAllRoutes()
    for (const v of videos) registerFor(v)
}
```

**问题**：`disposeAllRoutes()` 和重新注册之间没有原子性保护。如果 `registerFor()` 中途失败（如文件系统错误），将导致部分壁纸路由缺失，且没有回滚机制。

**建议**：
- 先构建新路由集合，验证成功后再一次性切换
- 或使用版本号标记路由，避免重复注册

### 5. **数据模型演进缺乏版本控制（长期风险）**

manifest 格式从 `{ videos }` 演进到 `{ videos, hidden }`，但没有版本字段：

```javascript
const manifest = JSON.parse(await fs.readText(mt))
if (manifest && Array.isArray(manifest.videos) && manifest.videos.length > 0) {
    videos = manifest.videos.map(...)
}
```

**问题**：未来任何 schema 变更（如添加 `tags`、`lastPlayed`）都需要兼容旧数据，且无法区分"空列表"和"损坏数据"。

**建议**：引入 `schemaVersion` 字段和迁移函数，确保向后兼容。

### 6. **客户端 bundle 格式与模块系统冲突**

`client.js` 使用 `window.__ModuleLoader__.load()`，但 `package.json` 声明 `"type": "module"`：

```json
{
  "type": "module",
  "main": "./src/host.js",
  "exports": {
    "./client": "./src/client.js"
  }
}
```

**问题**：`client.js` 不是 ESM 格式（无 `import`/`export`），但被声明为 ESM 模块。Node.js 环境下直接 `import` 会失败，且构建工具可能混淆。

**建议**：将客户端文件命名为 `.cjs` 或明确在 `exports` 中区分格式。

### 7. **错误处理策略不一致**

`host.js` 中 `persist()` 静默失败：

```javascript
async function persist() {
    try {
        ...
        return true
    } catch (e) { return false }
}
```

但调用方不检查返回值，导致隐藏/扫描操作"成功"但状态未持久化，重启后丢失。

**建议**：对关键操作（如 `setHidden`）提供用户可见的持久化失败提示。

### 安全工程师 (round 1)

## 安全评审意见

### 🔴 BLOCKING-1: 路径穿越漏洞 — `/dyn/aurora-scan` 接口（严重）

**位置**: `src/host.js` — `/dyn/aurora-scan` 路由处理器

```javascript
// 客户端可传入任意 path
var doScan = function (path) {
  var url = '/dyn/aurora-scan' + (path ? '?path=' + encodeURIComponent(path) : '')
  fetch(url, { cache: 'no-store' })
  // ...
}
```

**风险**: 攻击者可通过 `fetch('/dyn/aurora-scan?path=C:\\Users\\Public\\...')` 或 `path=C:\\Windows\\System32` 等路径，让服务端扫描任意目录。`autoSync()` 会递归读取目录内容并尝试解析为壁纸，可能造成：
- **信息泄露**: 目录枚举、文件元数据（标题、类型）泄露
- **资源耗尽**: 扫描超大目录（如 `C:\`）导致 DoS

**修复建议**:
```javascript
// 白名单校验：仅允许 WORKSHOP 目录或用户明确配置的目录
const ALLOWED_ROOTS = new Set([WORKSHOP, CONFIG.vaultDir])
// 或至少校验路径前缀
if (!raw.startsWith(WORKSHOP) && !raw.startsWith(CONFIG.vaultDir)) {
  res.writeHead(403)
  res.end(JSON.stringify({ ok: false, error: 'forbidden path' }))
  return
}
```

---

### 🔴 BLOCKING-2: 路径穿越漏洞 — `/dyn/aurora-hide` 接口（严重）

**位置**: `src/host.js` — `/dyn/aurora-hide` 路由处理器

```javascript
const raw = queryParam(req.url, 'file')
if (raw !== null && raw !== '') {
  await setHidden(raw, true)  // 任意 file 路径被加入 hidden 集合
```

**风险**: 攻击者可传入任意文件路径（如 `C:\Windows\system32\config\SAM`）加入隐藏列表。虽然不直接读取文件，但：
- 可导致合法壁纸被隐藏（可用性影响）
- 结合 `/dyn/aurora-unhide` 可操纵状态
- 路径被持久化到 manifest，可能被其他组件误用

**修复建议**: 校验 `file` 参数必须是 `videos` 列表中已存在的路径：
```javascript
if (!videos.some(v => v.file === raw)) {
  res.writeHead(400)
  res.end(JSON.stringify({ ok: false, error: 'unknown file' }))
  return
}
```

---

### 🔴 BLOCKING-3: 任意文件读取 — `/dyn/aurora-video/{n}.mp4` 与 `/dyn/aurora-scene/{n}.pkg`（严重）

**位置**: `src/host.js` — `serveVideo()` 和 `serveScenePkg()`

```javascript
// serveVideo 中
const v = videos[n]
if (!v) { res.writeHead(404); res.end(); return }
const fullPath = v.file  // 来自 manifest，可能被篡改

// serveScenePkg 中
const pkgPath = WORKSHOP + '\\' + v.folder + '\\scene.pkg'
```

**风险**: 虽然 `n` 是数字索引，但 `v.file` 和 `v.folder` 来自 manifest 文件。如果攻击者能写入 manifest（例如通过路径穿越或其他漏洞），可构造任意文件路径，导致**任意文件读取**。此外，`serveVideo` 的 handler 中可能直接使用 `v.file` 作为文件路径。

**修复建议**:
- 对 `v.file` 做规范化校验，确保在允许的根目录内
- 使用 `path.resolve()` 后检查前缀
- manifest 文件应设置严格的权限控制

---

### 🟠 高危: 缺少输入校验 — `queryParam` 解析

**位置**: `src/host.js` — 多个路由处理器

```javascript
const raw = queryParam(req.url, 'index')
const n = parseInt(raw, 10)  // 未校验 NaN 后的边界
```

**风险**: `parseInt` 接受 `"1abc"` → `1`，`"0x10"` → `16` 等非常规输入。虽然当前逻辑有 `isNaN` 检查，但建议使用更严格的解析：

```javascript
const n = Number.parseInt(raw, 10)
if (!Number.isInteger(n) || n < 0) { /* 400 */ }
```

---

### 🟡 中危: 路径规范化不一致

**位置**: `src/host.js` — `autoSync()` 中路径前缀匹配

```javascript
const prefix = rootPath.replace(/[\\/]+$/, '') + '\\'
// ...
if (typeof v.file !== 'string' || !v.file.toLowerCase().startsWith(prefix.toLowerCase())) return true
```

**风险**: 大小写不敏感的前缀匹配在 Windows 上可行，但 `rootPath` 可能包含 `..` 或符号链接，导致前缀匹配绕过。建议使用 `path.resolve()` 规范化后再比较。

---

### 🟡 中危: 敏感路径硬编码泄露

**位置**: `src/host.js` — CONFIG 默认值

```javascript

### 测试工程师 (round 1)

# 测试工程师评审意见

## 一、可测试性问题

### 1.1 缺少单元测试框架和测试用例
**严重程度**: 高  
**位置**: 整个项目  
**问题**: 项目没有任何测试文件或测试配置。考虑到这是一个涉及文件系统操作、HTTP 路由、状态管理的复杂插件，缺少自动化测试将导致回归风险极高。

**建议**:
```json
// package.json 添加
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

### 1.2 核心逻辑与 I/O 耦合
**严重程度**: 高  
**位置**: `src/host.js`  
**问题**: `autoSync()`、`setHidden()`、`persist()` 等核心业务逻辑直接依赖 `fs` 服务，难以在测试环境中模拟。

**建议**:
```javascript
// 将核心逻辑抽取为纯函数，便于单元测试
export function filterRemovedVideos(videos, aliveFiles, prefix) {
  return videos.filter(v => {
    if (typeof v.file !== 'string' || !v.file.toLowerCase().startsWith(prefix.toLowerCase())) return true
    return aliveFiles.has(v.file)
  })
}

export function renumberVideos(videos) {
  return videos.map((v, i) => ({ ...v, n: i }))
}

export function calculateVisibleIndex(videos, hidden, current) {
  const visible = videos.filter(v => !hidden.has(v.file))
  return Math.min(current, Math.max(0, visible.length - 1))
}
```

### 1.3 缺少集成测试环境
**严重程度**: 中  
**位置**: 项目整体  
**问题**: 插件依赖 DSH 宿主环境（`ctx.get('webServer')`、`ctx.get('fs')` 等），没有提供 mock 或测试宿主。

**建议**:
```javascript
// 创建测试用的 mock 宿主
export function createMockContext() {
  const routes = new Map()
  const disposers = []
  
  return {
    get: (key) => {
      switch(key) {
        case 'webServer':
          return {
            register: (route) => {
              routes.set(route.path, route.handler)
              const dispose = () => routes.delete(route.path)
              disposers.push(dispose)
              return dispose
            }
          }
        case 'fs':
          return createMockFs()
        // ... 其他服务
      }
    }
  }
}
```

## 二、边界条件测试

### 2.1 空列表边界
**严重程度**: 高  
**位置**: `src/host.js` - `aurora-set` 路由  
**问题**: 当 `visible.length === 0` 时，`aurora-set` 返回的 index 计算可能出错。

**测试用例**:
```javascript
describe('aurora-set with empty list', () => {
  test('should return index -1 when no visible videos', async () => {
    // 设置 videos = [], hidden = new Set()
    const response = await fetch('/dyn/aurora-set?index=0')
    const data = await response.json()
    expect(data.index).toBe(-1) // 当前实现可能返回 -1
    // 建议：返回 0 或明确错误
  })
})
```

### 2.2 隐藏所有壁纸后的行为
**严重程度**: 高  
**位置**: `src/host.js` - `setHidden()`  
**问题**: 当所有壁纸都被隐藏时，`current` 索引处理可能越界。

**测试用例**:
```javascript
describe('hide all wallpapers', () => {
  test('current index should be 0 when all hidden', async () => {
    // 有 3 个壁纸，全部隐藏
    for (let i = 0; i < 3; i++) {
      await fetch(`/dyn/aurora-hide?file=${encodeURIComponent(videos[i].file)}`)
    }
    const response = await fetch('/dyn/aurora-list.json')
    const data = await response.json()
    expect(data.videos).toHaveLength(0)
    expect(data.index).toBe(0)
  })
})
```

### 2.3 路径边界情况
**严重程度**: 中  
**位置**: `src/host.js` - `autoSync()`  
**问题**: 路径前缀匹配使用 `startsWith`，可能误匹配相似路径。

**测试用例

### 维护者/最终评审 (round 1)

# 最终评审意见

## 总体结论

**状态：有条件通过（需修复后合入）**

本次从动态插件到静态 bundle 的架构迁移方向正确，功能增强（隐藏/恢复、跨插件互斥）设计合理。但存在 **1 个阻断性问题** 和 **多个必须修复项**，不建议在当前状态下发布。

---

## 🔴 阻断性问题（必须修复）

### BLOCKING-1: 发布包缺少 we-scene 源码（功能完全失效）

**位置**: `package.json` + `src/host.js`

**问题**: `files` 字段只包含 `src/`、`cordis.patch.yml`、`README.md`，但 `host.js` 中 `weSceneSrc` 默认指向 `path.join(PLUGIN_DIR, '..', 'packages', 'we-scene', 'src')`。发布到 npm 后该路径不存在，场景壁纸渲染功能完全失效。

**修复方案**（三选一）：
1. **推荐**：将 `we-scene` 源码打包进 `src/` 目录（如 `src/we-scene/`），更新路径
2. 将 `we-scene` 发布为独立 npm 包并作为 dependency
3. 在 `files` 中添加 `packages/we-scene/src`，但需确认包体积可接受

---

## 🟠 必须修复项

### MUST-1: 清理未使用的服务获取

**位置**: `src/host.js` 第 311-314 行

```javascript
const sandboxPolicy = ctx.get('sandboxPolicy')  // 已不再使用
const harness = ctx.get('harness')  // 已不再使用
```

**问题**: 残留的动态插件依赖注入模式，静态 bundle 下这些服务可能不存在，造成隐性初始化成本。

**修复**: 删除这两行，只保留 `webServer` 和 `fs`。

### MUST-2: 路径穿越漏洞修复

**位置**: `/dyn/aurora-scan` 和 `/dyn/aurora-hide` 接口

**问题**: 
- `aurora-scan` 接受任意 `path` 参数，可扫描系统任意目录
- `aurora-hide` 接受任意 `file` 参数，可隐藏任意路径

**修复**:
```javascript
// aurora-scan: 白名单校验
const ALLOWED_ROOTS = new Set([WORKSPATH, CONFIG.vaultDir])
if (raw && ![...ALLOWED_ROOTS].some(root => raw.toLowerCase().startsWith(root.toLowerCase()))) {
  res.writeHead(403)
  res.end(JSON.stringify({ ok: false, error: 'forbidden path' }))
  return
}

// aurora-hide: 校验 file 必须存在于 videos 列表
if (!videos.some(v => v.file === raw)) {
  res.writeHead(400)
  res.end(JSON.stringify({ ok: false, error: 'unknown file' }))
  return
}
```

### MUST-3: 空列表边界处理

**位置**: `/dyn/aurora-set` 和 `/dyn/aurora-list.json`

**问题**: 当所有壁纸被隐藏或列表为空时，`aurora-set` 返回 `index: -1`，客户端可能异常。

**修复**:
```javascript
// aurora-set 中
const visible = visibleVideos()
if (visible.length === 0) {
  res.end(JSON.stringify({ index: 0 }))
  return
}

// aurora-list.json 中
const visible = visibleVideos()
res.end(JSON.stringify({
  index: visible.length > 0 ? Math.min(current, visible.length - 1) : 0,
  // ...
}))
```

### MUST-4: 持久化失败的用户提示

**位置**: `persist()` 函数及调用方

**问题**: `persist()` 静默失败，调用方不检查返回值，用户操作"成功"但重启后状态丢失。

**修复**: 
```javascript
async function persist() {
  try {
    // ... 现有逻辑
    return true
  } catch (e) {
    console.error('[aurora] persist failed:', e)
    return false
  }
}

// setHidden 中
const ok = await persist()
if (!ok) {
  // 返回警告给客户端
  res.end(JSON.stringify({ ok: true, warning: '状态未能持久化，重启后可能丢失' }))
}
```

---

## 🟡 建议改进（非阻断）

### SHOULD-1: 跨插件通信协议抽象

**位置**: `src/client.js` 中 `AMBIENT_KEY` 等常量

**建议**: 将 `dsh.ambient.background` 的读写封装为独立模块，未来新增背景插件时只需实现统一接口。

### SHOULD-2: manifest 版本控制

**位置**: `src/host.js` 中 manifest 读写

**建议**: 添加 `schemaVersion: 1` 字段，为未来数据迁移预留空间。

### SHOULD-3: 路由注册原子性

**位置**: `syncRoutes()` 函数

**建议**: 先构建新路由集合，验证成功后再一次性切换，避免中途失败导致部分路由缺失。

### SHOULD-4: 补充测试

**建议**: 至少为核心逻辑（`autoSync`、`setHidden`、`renumber`）添加单元测试，使用 mock 的 `fs` 和 `webServer`。

---

## 风险评估

| 风险 | 等级 | 说明 |
|------|------|------|
| 发布后场景壁纸失效 | 🔴 高 | we-scene 源码未打包，需在发布前解决 |
| 路径穿越导致信息泄露 | 🔴 高 | 需立即修复，否则存在安全漏洞 |
| 空列表导致客户端异常 | 🟠 中 | 需处理边界条件 |
| 状态持久化失败 | 🟡 低 | 影响用户体验，但不影响核心功能 |
| 跨插件互斥耦合 | 🟡 低 | 当前可接受，未来需抽象 |

---

## 最终建议

1. **立即修复** BLOCKING-1 和 MUST-2（安全漏洞）
2. **合入前修复** MUST-1、MUST-3、MUST-4
3. **下个版本规划** SHOULD-1 至 SHOULD-4
4. **发布前验证**：在干净环境执行 `npm pack`，确认包内容完整且功能可用

修复完成后可合入，但建议在发布前进行完整的集成测试。
