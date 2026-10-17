const brands = [
  ['deepseek', /deepseek/i, 'DeepSeek 模型，用于对话、内容处理与编程任务。'],
  ['claude', /claude/i, 'Claude 模型，用于问答、写作与编程任务。'],
  ['gemini', /gemini/i, 'Gemini 模型，用于问答、内容处理与创作。'],
  ['openai', /(?:^|[\s/])(?:gpt[-\s]|o[1-9](?:[-\s]|$))|openai/i, 'GPT 模型，用于问答、写作与编程任务。'],
  ['grok', /grok/i, 'Grok 模型，用于日常问答与内容处理。'],
  ['doubao', /doubao|豆包/i, '豆包模型，用于日常问答与内容处理。'],
  ['qwen', /qwen|千问|通义/i, 'Qwen 模型，用于日常问答与内容处理。'],
]

// Presentation is a whitelist, never a provider URL, key or source name.
export function modelPresentation(model) {
  const identity = String(model.upstream_model || model.public_name || model.name || '')
  const brand = brands.find(([, pattern]) => pattern.test(identity))
  const declared = Array.isArray(model.capabilities) ? model.capabilities : []
  const capabilities = ['chat']
  if (declared.includes('vision')) capabilities.push('vision')
  if (declared.includes('thinking')) capabilities.push('thinking')
  return {
    icon: brand?.[0] || 'models',
    description: typeof model.description === 'string' && model.description.trim()
      ? model.description.trim().slice(0, 300)
      : brand?.[2] || '团队已接入的对话模型，具体能力以服务配置为准。',
    capabilities,
  }
}

export function catalogDisplayFields(raw) {
  const result = {}
  if (typeof raw.description === 'string' && raw.description.trim()) result.description = raw.description.trim().slice(0, 300)
  const capabilities = new Set(Array.isArray(raw.capabilities) ? raw.capabilities : [])
  if (raw.reasoning === true) capabilities.add('thinking')
  if (Array.isArray(raw.input_modalities) && raw.input_modalities.includes('image')) capabilities.add('vision')
  const supported = ['chat', 'vision', 'thinking'].filter(value => capabilities.has(value))
  if (supported.length) result.capabilities = supported
  return result
}
