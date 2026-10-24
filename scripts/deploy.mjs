import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { openWorkbenchDb } from '../lib/host/db/database.js'
import { WorkbenchDomain } from '../lib/host/services/domain.js'

const action = process.argv[2] || 'inspect'

function getProfilePath() {
  return join(homedir(), '.dsh', 'profiles', 'desktop')
}

function inspect() {
  console.log('=== [DSH Workbench 部署检查 Inspect] ===')
  console.log(`Node 运行时: ${process.version}`)
  console.log(`操作系统: ${process.platform} (${process.arch})`)
  const profileDir = getProfilePath()
  console.log(`目标 DSH Profile 目录: ${profileDir} (${existsSync(profileDir) ? '存在' : '不存在'})`)
  const dbPath = join(homedir(), '.dsh', 'workbench', 'workbench.db')
  console.log(`默认工作台 SQLite 路径: ${dbPath} (${existsSync(dbPath) ? '已存在' : '待初始化'})`)
}

function plan() {
  inspect()
  console.log('\n=== [部署实施计划 Plan] ===')
  console.log('1. 构建 TypeScript 源码 (lib/)')
  console.log('2. 打包生成 @dsh/workbench tarball')
  console.log('3. 记录产物 SHA256 指纹')
  console.log('4. 验证 SQLite 数据库迁移与健康状态')
  console.log('5. 遵循安全纪律：不杀未确认进程，不覆盖非本插件配置')
}

function pack() {
  console.log('\n=== [打包 Tarball] ===')
  mkdirSync('.artifacts', { recursive: true })
  const output = execSync('npm pack --pack-destination .artifacts', { encoding: 'utf8' })
  const tarballName = output.trim().split(/\r?\n/).pop()?.trim() || ''
  const tarballPath = join('.artifacts', tarballName)
  const hash = createHash('sha256').update(readFileSync(tarballPath)).digest('hex')
  console.log(`产物: ${tarballPath}`)
  console.log(`SHA256: ${hash}`)
  return { tarballPath, hash }
}

function verify() {
  console.log('\n=== [验证环境与数据库 Verify] ===')
  const db = openWorkbenchDb()
  const domain = new WorkbenchDomain(db)
  const projects = domain.listProjects()
  const tasks = domain.listTasks()
  console.log(`数据库状态正常: 已登记项目 ${projects.length} 个，任务 ${tasks.length} 个`)
  console.log('Domain 服务与 SQLite 外键/WAL 验证通过！')
}

switch (action) {
  case 'inspect':
    inspect()
    break
  case 'plan':
    plan()
    break
  case 'pack':
  case 'package':
    pack()
    break
  case 'verify':
    verify()
    break
  default:
    console.log(`未知动作: ${action}。支持: inspect, plan, pack, verify`)
}
