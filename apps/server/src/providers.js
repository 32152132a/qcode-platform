import { fail } from './domain.js';

export const protocols = ['chat-completions', 'responses'];
export function providerRequest(body, model, secret, outputLimit) {
  const protocol = model.protocol || 'chat-completions';
  if (!protocols.includes(protocol)) fail(400, 'INVALID_PROTOCOL', 'Unsupported model protocol');
  const headers = { 'Content-Type': 'application/json', ...(model.provider === 'ollama' ? {} : { Authorization: `Bearer ${secret}` }) };
  if (protocol === 'chat-completions') {
    const payload = { ...body, model: model.upstream_model, n: 1 };
    delete payload.max_tokens; delete payload.max_completion_tokens;
    payload[model.max_tokens_field || 'max_tokens'] = outputLimit;
    if (body.stream && model.stream_usage) payload.stream_options = { ...(body.stream_options || {}), include_usage: true };
    return { url: `${model.base_url}/chat/completions`, headers, payload };
  }
  for (const field of ['stop','frequency_penalty','presence_penalty','logit_bias','logprobs','top_logprobs','response_format']) {
    if (body[field] != null) fail(400, 'UNSUPPORTED_PARAMETER', `Responses adapter does not support ${field}`);
  }
  const input = [];
  for (const message of body.messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) });
      continue;
    }
    if (!['system','developer','user','assistant'].includes(message.role)) fail(400, 'INVALID_MESSAGES', 'Unsupported message role');
    if (message.content != null && message.content !== '') {
      if (typeof message.content !== 'string' && !Array.isArray(message.content)) fail(400, 'UNSUPPORTED_CONTENT', 'Message content must be text or content parts');
      const content = typeof message.content === 'string' ? message.content : message.content.map(part => {
        if (part.type === 'text') return { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text };
        if (part.type === 'image_url' && part.image_url?.url && message.role === 'user') return { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail || 'auto' };
        fail(400, 'UNSUPPORTED_CONTENT', 'Responses supports text and user images in this adapter');
      });
      input.push({ role: message.role, content });
    }
    for (const call of message.tool_calls || []) {
      if (call.type !== 'function') fail(400, 'UNSUPPORTED_TOOL', 'Only function tools are supported');
      input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  const payload = { model: model.upstream_model, input, stream: Boolean(body.stream), max_output_tokens: outputLimit, store: false };
  for (const field of ['temperature','top_p','parallel_tool_calls']) if (body[field] != null) payload[field] = body[field];
  if (body.reasoning_effort) payload.reasoning = { effort: body.reasoning_effort };
  if (body.tools) payload.tools = body.tools.map(tool => {
    if (tool.type !== 'function') fail(400, 'UNSUPPORTED_TOOL', 'Only function tools are supported');
    return { type: 'function', ...tool.function, strict: tool.function.strict ?? false };
  });
  if (body.tool_choice != null) payload.tool_choice = typeof body.tool_choice === 'string' ? body.tool_choice : { type: 'function', name: body.tool_choice.function?.name };
  return { url: `${model.base_url}/responses`, headers, payload };
}
export function responseUsage(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)) return undefined;
  return { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens };
}
export function chatResponse(result, model) {
  if (model.protocol !== 'responses') return result;
  if (!Array.isArray(result.output) || !['completed','incomplete'].includes(result.status)) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid Responses result');
  const calls = result.output.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }));
  const content = result.output.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(part => part.type === 'output_text' || part.type === 'refusal').map(part => part.text ?? part.refusal).join('');
  return { id: result.id, object: 'chat.completion', created: Math.floor(Date.now()/1000), model: model.public_name,
    choices: [{ index: 0, message: { role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: result.status === 'incomplete' ? 'length' : calls.length ? 'tool_calls' : 'stop' }], usage: responseUsage(result.usage) };
}
// Bound each event and honor downstream backpressure through an async generator.
export async function* responseStream(stream, model) {
  const decoder = new TextDecoder(); let buffer = '', done = false, roleSent = false, responseId = 'qcode-response';
  const calls = new Map();
  const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: responseId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: model.public_name, choices: usage ? [] : [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
  function event(data) {
    if (!data || data === '[DONE]') return [];
    let value; try { value = JSON.parse(data); } catch { fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid Responses stream event'); }
    if (value.error || value.response?.error || ['error','response.failed'].includes(value.type)) fail(502, 'UPSTREAM_STREAM_ERROR', 'Model provider reported a stream error');
    if (done) return [];
    const emitted = [];
    if (value.response?.id) responseId = value.response.id;
    if (!roleSent) { emitted.push(chunk({ role: 'assistant', content: '' })); roleSent = true; }
    if (value.type === 'response.output_text.delta') emitted.push(chunk({ content: value.delta }));
    if (value.type === 'response.refusal.delta') emitted.push(chunk({ content: value.delta }));
    if (value.type === 'response.output_item.added' && value.item?.type === 'function_call') {
      if (calls.size >= 128 || calls.has(value.output_index)) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid tool call count or index');
      const call = { index: calls.size, arguments: value.item.arguments || '' }; calls.set(value.output_index, call);
      emitted.push(chunk({ tool_calls: [{ index: call.index, id: value.item.call_id, type: 'function', function: { name: value.item.name, arguments: call.arguments } }] }));
    }
    if (value.type === 'response.function_call_arguments.delta') {
      const call = calls.get(value.output_index); if (!call) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Tool arguments arrived before tool call');
      if (typeof value.delta !== 'string' || call.arguments.length + value.delta.length > 1024*1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Tool arguments too large');
      call.arguments += value.delta;
      emitted.push(chunk({ tool_calls: [{ index: call.index, function: { arguments: value.delta } }] }));
    }
    if (value.type === 'response.function_call_arguments.done') {
      const call = calls.get(value.output_index); if (!call || typeof value.arguments !== 'string' || value.arguments.length > 1024*1024 || !value.arguments.startsWith(call.arguments)) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid final tool arguments');
      const remaining = value.arguments.slice(call.arguments.length); if (remaining) emitted.push(chunk({ tool_calls: [{ index: call.index, function: { arguments: remaining } }] }));
      call.arguments = value.arguments;
    }
    if (['response.completed','response.incomplete'].includes(value.type)) {
      emitted.push(chunk({}, value.type === 'response.incomplete' ? 'length' : calls.size ? 'tool_calls' : 'stop'));
      const usage = responseUsage(value.response?.usage); if (usage) emitted.push(chunk({}, null, usage));
      emitted.push('data: [DONE]\n\n'); done = true;
    }
    return emitted;
  }
  for await (const bytes of stream) {
    buffer += decoder.decode(bytes, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      if (frame.length > 1024*1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Stream event too large');
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      for (const part of event(data)) yield part;
    }
    if (buffer.length > 1024*1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Stream event too large');
  }
  buffer += decoder.decode();
  if (buffer.trim()) for (const part of event(buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))) yield part;
  if (!done) fail(502, 'INCOMPLETE_STREAM', 'Responses stream ended before completion');
}
