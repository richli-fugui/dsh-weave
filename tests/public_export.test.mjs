import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPublicFile, redactDocumentation, exportPublic } from '../scripts/export-public.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('公开材料移除单双转义用户路径、真实会话与邮箱；扫描失败不打印秘密', () => {
  const win = ['C:', 'Users', 'private-person', 'work'].join(String.fromCharCode(92))
  for (const sample of [win, win.replaceAll(String.fromCharCode(92), String.fromCharCode(92, 92)), ['', 'Users', 'private-person', 'work'].join('/')]) {
    const redacted = redactDocumentation(sample)
    assert.ok(!redacted.includes('private-person'))
    auditPublicFile('sample.md', redacted)
  }
  const session = 'session-' + '12345678-1234-1234-1234-123456789abc'
  assert.ok(!redactDocumentation(session + ' private@example.test').includes(session))
  const secret = 'sk-' + 'x'.repeat(40)
  assert.throws(() => auditPublicFile('unsafe.txt', secret), err => !err.message.includes(secret))
  assert.throws(() => auditPublicFile('unsafe.ts', 'Bearer ' + 'a'.repeat(40)))
  auditPublicFile('safe.ts', 'Authorization: Bearer ${client.apiKey}')
})

test('公开更新仅删除上次清单中未被改动的旧源码，保护额外文件和本地编辑', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-export-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const dir of ['src', 'tests', 'scripts', 'docs', 'handoff', 'validation']) fs.mkdirSync(path.join(root, dir))
  for (const name of ['.editorconfig', '.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'package.json', 'package-lock.json', 'cordis.patch.yml', 'tsconfig.json', 'tsconfig.build.json']) fs.writeFileSync(path.join(root, name), '{}')
  const output = path.join(root, '.public-export')
  const source = path.join(root, 'src', 'removed.ts')
  const target = path.join(output, 'src', 'removed.ts')
  fs.writeFileSync(source, 'export const previous = true\n')
  exportPublic(root, output)
  fs.unlinkSync(source)
  fs.appendFileSync(target, '// local edit\n')
  assert.throws(() => exportPublic(root, output), /modified obsolete/)
  assert.ok(fs.readFileSync(target, 'utf8').includes('local edit'))
  fs.writeFileSync(target, 'export const previous = true\n')
  exportPublic(root, output)
  assert.ok(!fs.existsSync(target))
  fs.writeFileSync(path.join(output, 'unreviewed.md'), 'private scratchpad')
  assert.throws(() => exportPublic(root, output), /Unexpected/)
  assert.ok(fs.existsSync(path.join(output, 'unreviewed.md')))
})
