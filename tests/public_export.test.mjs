import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPublicFile, redactDocumentation } from '../scripts/export-public.mjs'

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
