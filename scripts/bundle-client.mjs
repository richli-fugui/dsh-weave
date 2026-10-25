import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const clientPath = join('lib', 'client.js')
let code = readFileSync(clientPath, 'utf8')

// 1. 替换 ESM 语法为 require / exports
code = code.replace(
  /import\s*\{([^}]+)\}\s*from\s*["']react\/jsx-runtime["'];?/g,
  (_, imports) => {
    const transformed = imports
      .split(',')
      .map((s) => s.trim().replace(/\s+as\s+/, ': '))
      .filter(Boolean)
      .join(', ')
    return `const { ${transformed} } = require("react/jsx-runtime");`
  },
)
code = code.replace(
  /import\s+React(?:\s*,\s*\{([^}]+)\})?\s+from\s*["']react["'];?/g,
  (_, named) => {
    let res = 'const React = require("react");'
    if (named) {
      const transformed = named
        .split(',')
        .map((s) => s.trim().replace(/\s+as\s+/, ': '))
        .filter(Boolean)
        .join(', ')
      res += `\nconst { ${transformed} } = React;`
    }
    return res
  },
)
code = code.replace(
  /import\s*\{([^}]+)\}\s*from\s*["']react["'];?/g,
  (_, imports) => {
    const transformed = imports
      .split(',')
      .map((s) => s.trim().replace(/\s+as\s+/, ': '))
      .filter(Boolean)
      .join(', ')
    return `const { ${transformed} } = require("react");`
  },
)
const exportedNames = []
code = code.replace(/export\s+const\s+(\w+)\s*=/g, (_, name) => {
  exportedNames.push(name)
  return `const ${name} =`
})
code = code.replace(/export\s+function\s+(\w+)/g, (_, name) => {
  exportedNames.push(name)
  return `function ${name}`
})
code = code.replace(/export\s+class\s+(\w+)/g, (_, name) => {
  exportedNames.push(name)
  return `class ${name}`
})
code = code.replace(/export\s+\{\s*\}\s*;?/g, '')

// 导出挂载（收集到的命名导出统一挂到 exports；export const 亦在此统一挂，
// 避免声明处内联挂载与 hoisting 顺序问题）
for (const name of exportedNames) {
  code += `\nexports.${name} = ${name};`
}

// 2. 包装 window.__ModuleLoader__
const wrapped = `if (typeof window !== "undefined" && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === "function") {
  window.__ModuleLoader__.load({
    id: "dsh-table",
    factory: function(require) {
      var module = { exports: {} };
      var exports = module.exports;
      ${code}
      return module.exports;
    }
  });
} else {
  var module = { exports: {} };
  var exports = module.exports;
  ${code}
}
`

writeFileSync(clientPath, wrapped, 'utf8')
console.log('[bundle-client] lib/client.js 成功打包并封装为 DSH ModuleLoader 格式！')
