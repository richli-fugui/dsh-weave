// 用 DshAIClient 的已授权配置探测桥接的流式支持（与 pi-ai openai-completions 行为对齐）
// 只输出状态与响应形状，不打印密钥。
import { DshAIClient } from '../lib/host/services/ai-client.js'

const client = new DshAIClient()
if (!(await client.checkAvailability())) {
  console.log('bridge unavailable')
  process.exit(0)
}
const base = process.env.WORKBUDDY_BRIDGE_URL || 'http://127.0.0.1:8787/v1'
const model = process.env.WORKBUDDY_BRIDGE_MODEL || 'deepseek-v4.1-flash'
for (const stream of [true, false]) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream,
        messages: [{ role: 'user', content: '只回复两个字：正常' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text()
    console.log(`stream=${stream} status=${res.status} content-type=${res.headers.get('content-type')} body[:160]=`, JSON.stringify(text.slice(0, 160)))
  } catch (err) {
    console.log(`stream=${stream} ERR:`, String(err?.message ?? err))
  }
}
