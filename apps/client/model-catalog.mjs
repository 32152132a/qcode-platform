// Old gateways expose a single model; an explicit empty list means no models.
export function clientModels(config) {
  if (Array.isArray(config.models)) return config.models;
  return config.model ? [{ id: 'qcode-model', name: config.model, upstreamId: config.model, contextWindow: config.contextWindow, maxOutputTokens: config.maxOutputTokens, toolCall: true }] : [];
}
