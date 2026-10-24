import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { auditPublicFile } from './export-public.mjs'
const manifest = JSON.parse(fs.readFileSync('PUBLIC_MANIFEST.json', 'utf8'))
const expected = new Map(manifest.files.map(file => [file.path, file.sha256]))
expected.set('PUBLIC_MANIFEST.json', null)
const tracked = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
if (tracked.length !== expected.size) throw Error('Index differs from reviewed manifest file count')
for (const record of tracked) {
  const match = /^(\d+) [a-f0-9]+ (\d)\t(.+)$/.exec(record)
  if (!match || !['100644', '100755'].includes(match[1]) || match[2] !== '0' || !expected.has(match[3])) throw Error('Unreviewed index entry')
  const name = match[3]
  const content = execFileSync('git', ['show', ':' + name], { encoding: 'utf8' })
  auditPublicFile(name, content)
  if (expected.get(name) && createHash('sha256').update(content).digest('hex') !== expected.get(name)) throw Error('Staged content differs from manifest: ' + name)
}
console.log('Public index PASS: ' + tracked.length + ' reviewed text files, no unlisted files or symlinks')
