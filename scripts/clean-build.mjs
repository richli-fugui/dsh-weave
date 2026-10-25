import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// tsc does not remove output for deleted sources. Only delete this repository's generated lib.
const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const target = path.resolve(root, 'lib')
if (path.dirname(target) !== root || path.basename(target) !== 'lib') throw Error('Invalid generated output target')
if (fs.existsSync(target)) {
  if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) throw Error('Refusing linked generated output')
  fs.rmSync(target, { recursive: true })
}
