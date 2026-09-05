#!/usr/bin/env node
/**
 * Agent Review Roundtable — DSH plugin load validation.
 *
 * DSH loads the plugin straight from the live working tree (junction
 * C:\Users\Lenovo\DSH-Plugin\agent-review-roundtable -> this repo), so a
 * structurally broken dsh/index.js crashes `dsh` at boot. This script is the
 * gate that catches the failure BEFORE dsh is started or before a broken file
 * is committed.
 *
 * Three stages:
 *   1. static  — parse dsh/index.js and reject any executable statement at
 *      module top level (this file's convention is: imports, the apply()
 *      function and small helpers only). Catches the recurring "ctx is not
 *      defined" bug class where experimental code ends up outside apply()
 *      regardless of indentation.
 *   2. import  — dynamically import the module (reproduces the DSH loader
 *      behaviour; any top-level ReferenceError surfaces here).
 *   3. smoke   — invoke apply() with a stub ctx so registration-time errors
 *      (tools / HTTP endpoints) are caught too.
 *
 * Usage:
 *   node scripts/check-plugin.mjs [file]           # full check (default)
 *   node scripts/check-plugin.mjs --static-only    # fast (pre-commit hook)
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const target = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : join(root, 'dsh', 'index.js')
const staticOnly = process.argv.includes('--static-only')

const failures = []
const ok = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => failures.push(msg)

// --- Stage 1: static structure analysis ----------------------------------
async function staticCheck() {
  console.log(`检查 ${target} 顶层结构…`)
  const source = await readFile(target, 'utf8')

  let ts = null
  try {
    const require = createRequire(import.meta.url)
    ts = require('typescript')
  } catch { /* typescript unavailable (no devDeps) — fall back below */ }

  let violations = 0
  const report = (lineNo, text) => {
    if (violations === 0) {
      fail('存在模块顶层游离的可执行语句（很可能引用了仅在 apply() 内定义的 ctx/emitProgress 等，DSH 加载时会抛 ReferenceError）:')
    }
    violations++
    fail(`  第 ${lineNo} 行: ${text}`)
  }

  if (ts) {
    const sf = ts.createSourceFile('plugin.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    for (const stmt of sf.statements) {
      const isDecl =
        ts.isImportDeclaration(stmt) ||
        ts.isExportDeclaration(stmt) ||
        ts.isFunctionDeclaration(stmt) ||
        ts.isVariableStatement(stmt) ||
        ts.isEmptyStatement(stmt)
      if (isDecl) continue
      const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf))
      const first = stmt.getText(sf).split('\n')[0].trim().slice(0, 140)
      report(line + 1, first)
    }
  } else {
    // Fallback: crude column-0 scan when typescript is not installed.
    const lines = source.split('\n')
    lines.forEach((line, i) => {
      if (!/^[A-Za-z_(]/.test(line)) return
      if (/^(import|export|function|const|let|var|#!|\/\/|\/\*)/.test(line)) return
      report(i + 1, line.trim().slice(0, 140))
    })
  }

  if (violations === 0) ok('无顶层游离可执行语句')
}

// --- Stage 2+3: runtime import & apply smoke -----------------------------
async function runtimeCheck() {
  if (staticOnly) return
  console.log('运行时导入（模拟 DSH loader）…')
  let mod
  try {
    mod = await import(`file://${target.split('\\').join('/')}`)
  } catch (error) {
    fail(`模块导入失败（DSH 启动时会报同样错误）: ${error.message}`)
    return
  }
  if (typeof mod.apply !== 'function') {
    fail('未导出 apply() 函数')
    return
  }
  ok(`导入成功（导出: ${Object.keys(mod).join(', ')}）`)

  console.log('apply() 冒烟测试（桩 ctx）…')
  const httpRegs = []
  const fakeHttpCtx = {
    webServer: { register: (entry) => httpRegs.push(entry) },
    effect: (fn) => { try { fn() } catch (e) { fail(`HTTP 注册失败: ${e.message}`) } },
  }
  const registered = []
  const ctx = {
    credentials: {},
    tools: { register: (t) => registered.push(t) },
    inject: (features, cb) => { if (features.includes('webServer')) cb(fakeHttpCtx) },
    on: () => {},
    get: () => ({}),
  }
  try {
    mod.apply(ctx)
  } catch (error) {
    fail(`apply() 抛出异常: ${error.message}`)
    return
  }
  if (registered.length === 0) {
    fail('apply() 未注册任何工具')
  } else {
    ok(`工具注册成功 (${registered.length}): ${registered.map((t) => t.name || (t.definition && t.definition.name)).join(', ')}`)
  }
  if (httpRegs.length > 0) ok(`HTTP 端点注册 ${httpRegs.length} 个`)
}

await staticCheck()
await runtimeCheck()

if (failures.length > 0) {
  console.error('\n❌ 插件校验未通过:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\n✅ 插件可通过 DSH 加载')
