// Reviewed source export. No sessions, databases, screenshots, logs or credentials are copied.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export function redactDocumentation(text) {
  return text
    .replace(/[A-Za-z]:\\+Users\\+[^\r\n\x60"<>|]+/g, '<LOCAL_PATH>')
    .replace(/\/Users\/[^\s/]+(?:\/[^\s\x60"<>|，；）]*)?/g, '<LOCAL_PATH>')
    .replace(/session-[a-f0-9]{8}(?:-[a-f0-9]{4}){0,3}(?:-[a-f0-9]{12})?/gi, '<SESSION_ID>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<EMAIL>')
}

export function auditPublicFile(name, content) {
  const rules = [
    ['private home path', /[A-Za-z]:\\+Users\\+|\/Users\/[^/\s]+\//i],
    ['real session identity', /session-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['credential token', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ['bearer literal', /Bearer\s+[A-Za-z0-9._-]{24,}/i],
    ['secret assignment', /(?:api[_-]?key|password|secret|token)\s*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{32,}["']/i],
  ]
  const violations = rules.filter(([, pattern]) => pattern.test(content)).map(([rule]) => rule)
  if (violations.length) throw new Error('Public audit rejected ' + name + ': ' + violations.join(', '))
}

export function exportPublic(root, output) {
  const files = []
  const roots = ['src', 'tests', 'scripts', 'docs', 'handoff', 'validation']
  const allowedExt = new Set(['.ts', '.tsx', '.mjs', '.ps1', '.md', '.json'])
  const visit = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const name = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) visit(name)
      else if (allowedExt.has(path.extname(name))) files.push(name)
    }
  }
  roots.forEach(visit)
  files.push('.editorconfig', '.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'package.json', 'package-lock.json', 'cordis.patch.yml', 'tsconfig.json', 'tsconfig.build.json')
  const prepared = files.sort().map(name => {
    const raw = fs.readFileSync(path.join(root, name), 'utf8')
    const content = (name.endsWith('.md') ? redactDocumentation(raw) : raw).replace(/\r\n/g, '\n')
    auditPublicFile(name, content)
    return { name, content }
  })
  // Validate everything before writing; destination must be separate from private workspace.
  const source = fs.realpathSync(root)
  const destination = path.resolve(output)
  if (destination === source || !destination.startsWith(source + path.sep)) throw new Error('Export must be a dedicated child checkout')
  const expected = new Set([...files, 'PUBLIC_MANIFEST.json'])
  const checkExisting = (relative = '') => {
    const directory = path.join(destination, relative)
    if (!fs.existsSync(directory)) return
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Export cannot contain symlinks')
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!relative && ['.git', 'node_modules', 'lib'].includes(entry.name)) continue
      const name = path.posix.join(relative, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Export cannot contain symlinks')
      if (entry.isDirectory()) checkExisting(name)
      else if (!expected.has(name)) throw new Error('Unexpected file in public checkout: ' + name)
    }
  }
  checkExisting()
  const manifest = prepared.map(({ name, content }) => ({ path: name, sha256: createHash('sha256').update(content).digest('hex') }))
  fs.mkdirSync(destination, { recursive: true })
  for (const { name, content } of prepared) {
    const target = path.join(destination, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  fs.writeFileSync(path.join(destination, 'PUBLIC_MANIFEST.json'), JSON.stringify({ format: 1, scope: 'source-only; private evidence and machine data excluded', files: manifest }, null, 2) + '\n')
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = exportPublic(root, path.join(root, '.public-export'))
  console.log('Reviewed public export: ' + manifest.length + ' text files; private runtime evidence excluded.')
}
