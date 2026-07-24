import { OpenMultiAgent, type AgentConfig } from '@open-multi-agent/core'
import { z } from 'zod'
import { hasLiveCredential, liveModelConfig } from '../server/oma-runner.js'

if (!hasLiveCredential()) {
  console.error('缺少 DEEPSEEK_API_KEY；未执行真实模型预检。')
  process.exit(1)
}

const config = liveModelConfig()
const schema = z.object({
  ok: z.literal(true),
  dataLabel: z.literal('模拟数据'),
})
const agent: AgentConfig = {
  name: 'demo-preflight',
  provider: config.provider,
  model: config.model,
  systemPrompt: 'Return JSON only. This is a connectivity check for a simulated-data local demo.',
  outputSchema: schema,
  maxTurns: 2,
  maxTokens: 200,
  timeoutMs: 20_000,
  callTimeoutMs: 15_000,
  temperature: 0,
  extraBody: {
    thinking: { type: 'disabled' },
  },
}

const oma = new OpenMultiAgent({
  defaultProvider: config.provider,
  defaultModel: config.model,
})
const result = await oma.runAgent(
  agent,
  'Return exactly {"ok":true,"dataLabel":"模拟数据"}.',
  { runId: `bom-preflight-${Date.now()}` },
)
if (!result.success || schema.safeParse(result.structured).success === false) {
  console.error('OMA 真实模型预检失败。')
  process.exit(1)
}

console.log(`OMA preflight passed: provider=${config.provider} model=${config.model}`)
console.log(`runId=${result.identity?.runId ?? 'unavailable'}`)
console.log(
  `tokens=${result.tokenUsage.input_tokens + result.tokenUsage.output_tokens}`,
)
