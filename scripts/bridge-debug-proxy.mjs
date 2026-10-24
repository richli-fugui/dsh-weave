// 一次性诊断代理：记录宿主 llm 路由发往桥接的真实请求形状（脱敏），原样转发到 8787。
// 用法：node scripts/bridge-debug-proxy.mjs [listenPort=8879]
import http from 'node:http'
import { writeFileSync } from 'node:fs'

const listenPort = Number(process.argv[2] || 8879)
const UPSTREAM = { host: '127.0.0.1', port: 8787 }

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    let bodyInfo
    try {
      const parsed = JSON.parse(body.toString('utf8'))
      bodyInfo = {
        keys: Object.keys(parsed),
        model: parsed.model,
        stream: parsed.stream,
        messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : undefined,
        messageRoles: Array.isArray(parsed.messages) ? parsed.messages.map((m) => m.role).slice(0, 12) : undefined,
        toolsCount: Array.isArray(parsed.tools) ? parsed.tools.length : undefined,
        toolNames: Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name).slice(0, 30) : undefined,
        maxTokens: parsed.max_tokens ?? parsed.maxTokens,
        otherParams: Object.fromEntries(Object.entries(parsed).filter(([k]) => !['model', 'stream', 'messages', 'tools', 'max_tokens', 'maxTokens'].includes(k))),
      }
    } catch {
      bodyInfo = { parseError: true, bytes: body.length }
    }
    const auth = req.headers['authorization'] ?? '(none)'
    const rec = {
      time: new Date().toISOString(),
      method: req.method,
      url: req.url,
      authPresent: auth !== '(none)',
      authScheme: auth === '(none)' ? 'none' : auth.split(' ')[0],
      authLen: auth === '(none)' ? 0 : auth.length,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['authorization', 'host'].includes(k))),
      body: bodyInfo,
    }
    console.log(JSON.stringify(rec, null, 1))
    // 原始请求体落盘（编号递增），供逐字重放对照实验
    const dumpPath = `${process.env.TEMP || '/tmp'}/bridge-req-${Date.now()}.json`
    try { writeFileSync(dumpPath, body); console.log('body dumped:', dumpPath) } catch {}

    const fwd = http.request(
      { host: UPSTREAM.host, port: UPSTREAM.port, method: req.method, path: req.url, headers: { ...req.headers, host: '127.0.0.1:8787' } },
      (up) => {
        res.writeHead(up.statusCode, up.headers)
        up.pipe(res)
      },
    )
    fwd.on('error', (e) => {
      res.writeHead(502)
      res.end(String(e.message))
    })
    fwd.end(body)
  })
})
server.listen(listenPort, '127.0.0.1', () => console.log(`bridge-debug-proxy on ${listenPort} -> 8787`))
