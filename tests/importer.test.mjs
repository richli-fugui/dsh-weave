import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'
import { MarkdownCardImporter } from '../lib/importers/markdown.js'

test('Gate 2 Markdown 旧卡只读导入与幂等测试', async (t) => {
  const db = openWorkbenchDb({ dbPath: ':memory:' })
  const domain = new WorkbenchDomain(db)
  const importer = new MarkdownCardImporter(domain)

  // 创建临时 Markdown 目录与样例卡
  const testDir = mkdtempSync(join(tmpdir(), 'dsh-workbench-test-cards-'))

  const card1Content = `---
id: TC-1001
title: 重构网络层
project: CoreNetwork
project_root: C:\\Projects\\CoreNetwork
status: Active
priority: 80
blocked_by: []
---

## Goal
重构 HTTP 与 WebSocket 客户端为统一接口。

## Acceptance
所有单测通过，网络断开时自动进入重连模式。
`

  const card2Content = `---
id: TC-1002
title: 补齐断网测试
project: CoreNetwork
project_root: C:\\Projects\\CoreNetwork
status: Ready
priority: 50
blocked_by: ['TC-1001']
---

## Goal
添加断网重连用例。

## Acceptance
模拟网关挂断，重连 3 次后抛出明确错误。
`

  writeFileSync(join(testDir, 'TC-1001.md'), card1Content, 'utf8')
  writeFileSync(join(testDir, 'TC-1002.md'), card2Content, 'utf8')

  await t.test('1. 预览导入（只读、无副作用）', () => {
    const preview = importer.preview(testDir)
    assert.equal(preview.totalScanned, 2)
    assert.equal(preview.newCards.length, 2)
    assert.equal(preview.duplicateCards.length, 0)

    const c1 = preview.newCards.find((c) => c.id === 'TC-1001')
    assert(c1)
    assert.equal(c1.title, '重构网络层')
    assert.equal(c1.project, 'CoreNetwork')
    assert.equal(c1.priority, 80)
    assert(c1.goal.includes('重构 HTTP 与 WebSocket'))

    // 验证原 Markdown 文件内容逐字节未变
    assert.equal(readFileSync(join(testDir, 'TC-1001.md'), 'utf8'), card1Content)
    assert.equal(readFileSync(join(testDir, 'TC-1002.md'), 'utf8'), card2Content)
  })

  await t.test('2. 执行导入并验证数据模型', () => {
    const preview = importer.preview(testDir)
    const result = importer.execute(preview.newCards)
    assert.equal(result.importedCount, 2)
    assert.equal(result.skippedCount, 0)

    // 检查项目已自动建立
    const projects = domain.listProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].title, 'CoreNetwork')
    assert.equal(projects[0].rootPath, 'C:\\Projects\\CoreNetwork')

    // 检查任务状态与依赖
    const t1 = domain.getTask('TC-1001')
    assert.equal(t1.title, '重构网络层')
    assert.equal(t1.statusCode, 'in_progress')
    assert.equal(t1.priorityCode, 'urgent') // priority 80 -> urgent

    const t2 = domain.getTask('TC-1002')
    assert.equal(t2.title, '补齐断网测试')
    assert.equal(t2.statusCode, 'todo')
    assert.deepEqual(t2.dependencies, ['TC-1001'])
  })

  await t.test('3. 重复执行导入（幂等去重）', () => {
    const preview = importer.preview(testDir)
    assert.equal(preview.newCards.length, 0)
    assert.equal(preview.duplicateCards.length, 2)

    // 再次执行，不会新增或报错
    const result = importer.execute(preview.newCards)
    assert.equal(result.importedCount, 0)

    // 原文件依然完整无修改
    assert.equal(readFileSync(join(testDir, 'TC-1001.md'), 'utf8'), card1Content)
  })

  // 清理临时文件
  rmSync(testDir, { recursive: true, force: true })
})
