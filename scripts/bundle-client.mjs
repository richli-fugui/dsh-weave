import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const clientPath = join('lib', 'client.js')
let code = readFileSync(clientPath, 'utf8')

// 1. 替换 ESM 语法为 require / exports
code = code.replace(
  /import\s*\{\s*jsx\s*as\s*_jsx,\s*jsxs\s*as\s*_jsxs\s*\}\s*from\s*["']react\/jsx-runtime["'];?/g,
  'const { jsx: _jsx, jsxs: _jsxs } = require("react/jsx-runtime");',
)
code = code.replace(
  /import\s*\{\s*useState,\s*useEffect\s*\}\s*from\s*["']react["'];?/g,
  'const { useState, useEffect } = require("react");',
)
code = code.replace(/export\s+const\s+(\w+)\s*=/g, 'const $1 = exports.$1 =')
code = code.replace(/export\s+function\s+(\w+)/g, 'function $1')
code = code.replace(/export\s+\{\s*\}\s*;?/g, '')

// 导出挂载
code += `
exports.WorkbenchView = WorkbenchView;
exports.apply = apply;
exports.name = name;
exports.inject = inject;
`

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
