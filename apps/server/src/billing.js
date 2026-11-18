import { fail, now } from './domain.js';
import { subscriptionFor } from './entitlements.js';

// Fixed CNY tariffs and chosen tiers are documented in CREDIT-BILLING.md.
const officialPrices = {
  'deepseek-flash': [2, 0.04, 8], 'deepseek-v4-pro': [9, 0.3, 27],
  'glm-5.3': [8, 2, 28], 'glm-5.3-flash': [0.8, 0.23, 2.8],
  'doubao-seed-2-1-pro-260915': [6, 1.2, 30], 'doubao-seed-2-1-lite-260915': [0.8, 0.16, 2.7],
  'qwen3.8-max': [12, 1.5, 36], 'qwen3.8-max-0902': [12, 1.5, 36],
  'qwen3.8-flash': [0.8, 0.1, 2.7], 'MiniMax-M3': [4.2, 0.84, 16.8],
  'MiniMax-M3.1-Flash': [1, 0.1, 4], 'kimi-k3.1-pro': [13, 1.3, 68], 'kimi-k3': [20, 2, 100],
};
export function officialPrice(source, model) {
  if (source?.kind !== 'official') return null;
  const host = new URL(source.base_url).hostname;
  const expected = model.startsWith('deepseek') ? 'api.deepseek.com' : model.startsWith('qwen') ? 'dashscope.aliyuncs.com'
    : model.startsWith('glm') ? 'open.bigmodel.cn' : model.startsWith('doubao') ? 'ark.cn-beijing.volces.com'
    : model.startsWith('kimi') ? 'api.moonshot.cn' : 'api.minimaxi.com';
  if (host !== expected) return null;
  if (model === 'doubao-seedream-5-0-flash-260915') return { imagePrice: 0.12, currency: 'CNY', pricingKnown: true };
  const price = officialPrices[model];
  return price ? { contextWindow: /^(deepseek|kimi|doubao)/.test(model) ? 1048576 : 1000000, inputPrice: price[0], cachedInputPrice: price[1], outputPrice: price[2], currency: 'CNY', pricingKnown: true } : null;
}

function decimalUnits(value, precision) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > precision) return null;
  const units = BigInt(match[1]) * 10n ** BigInt(precision)
    + BigInt((match[2] || '').padEnd(precision, '0') || '0');
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
}
export function moneyMicros(value, label = '使用额度') {
  const units = typeof value === 'number' ? decimalUnits(value, 6) : null;
  if (units === null || units > 1_000_000_000_000)
    fail(400, 'INVALID_AMOUNT', `${label}须为 0 至 1000000，最多六位小数`);
  return units;
}
export function modelPriceMicros(value) {
  const units = decimalUnits(value, 6);
  return units !== null && units <= 100_000_000_000 ? units : null;
}
export function modelPrice(value) {
  if (modelPriceMicros(value) === null)
    fail(400, 'INVALID_PRICE', '单价须为 0 至 100000，最多六位小数');
  return String(value);
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function parseUsage(value) {
  if (!value || count(value.total_tokens) === null) return null;
  const input = count(value.prompt_tokens), output = count(value.completion_tokens);
  const cached = count(value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens);
  return { input_tokens: input, output_tokens: output, total_tokens: Math.max(value.total_tokens, (input || 0) + (output || 0)),
    cached_input_tokens: input !== null && cached !== null && cached <= input ? cached : null };
}
export function creditUsage(state, user) {
  const subscription = subscriptionFor(state, user);
  if (!subscription) return null;
  const limit = subscription.terms.credit_limit_micros;
  if (!Number.isSafeInteger(limit) || limit < 0) fail(409, 'BILLING_SETUP_REQUIRED', '套餐计费配置需更新，请联系管理员');
  const used = subscription.spent_micros || 0;
  const reserved = state.requests.filter(row => row.subscription_id === subscription.id && row.status === 'pending')
    .reduce((sum, row) => sum + (row.reserved_cost_micros || 0), 0);
  return { limit, used, remaining: subscription.expires_at <= now() ? 0 : Math.max(0, limit - used - reserved) };
}
// Rates have at most six decimal places. Round only once, at the final micro-yuan boundary.
function requestCost(terms, perImage = false) {
  let total = 0n;
  for (const [quantity, price] of terms) {
    const rate = modelPriceMicros(price);
    if (count(quantity) === null || count(rate) === null) return null;
    total += BigInt(quantity) * BigInt(rate);
  }
  const micros = Number(perImage ? total : (total + 999_999n) / 1_000_000n);
  return count(micros);
}
export function reserveCredit(state, user, model, inputTokens, outputTokens, image = false) {
  const subscription = subscriptionFor(state, user);
  if (!subscription) return { subscription_id: null, reserved_cost_micros: 0 };
  if (subscription.expires_at <= now()) fail(403, 'SUBSCRIPTION_EXPIRED', '额度已到期，请重新开通套餐');
  if (!model || model.pricing_known !== true || model.currency !== 'CNY')
    fail(409, 'MODEL_PRICE_REQUIRED', '模型尚未配置人民币单价，请联系管理员');
  const reserved = image ? requestCost([[1, model.image_price]], true) : requestCost([[inputTokens, model.input_price], [outputTokens, model.output_price]]);
  if (!Number.isSafeInteger(reserved) || reserved < 0) fail(409, 'MODEL_PRICE_REQUIRED', '模型计价配置无效，请联系管理员');
  const available = creditUsage(state, user).remaining;
  if (available <= 0 || reserved > available)
    fail(429, 'CREDIT_EXHAUSTED', '剩余额度不足，请缩短内容或开通更高额度的套餐');
  return { subscription_id: subscription.id, reserved_cost_micros: reserved };
}
export function settleCredit(state, record, model, usage, imageCount = 0) {
  if (record.billing_settled) return;
  // Fixed public tariff: a cache discount applies only to explicitly reported cache hits.
  const cached = usage?.cached_input_tokens ?? 0;
  let value = null;
  if (model?.pricing_known === true) {
    if (imageCount) value = requestCost([[imageCount, model.image_price]], true);
    else if (usage?.input_tokens != null && usage?.output_tokens != null)
      value = requestCost([[usage.input_tokens - cached, model.input_price], [cached, model.cached_input_price ?? model.input_price], [usage.output_tokens, model.output_price]]);
  }
  record.cost_micros = value;
  record.currency = model?.currency || 'CNY';
  for (const field of ['input_price', 'cached_input_price', 'output_price']) {
    if (model?.[field] != null) record[field] = String(model[field]);
  }
  if (imageCount) record.image_price = String(model.image_price);
  record.billing_settled = true;
  const subscription = state.subscriptions.find(item => item.id === record.subscription_id);
  if (subscription && record.cost_micros !== null && record.currency === 'CNY') {
    record.charged_micros = Math.min(record.cost_micros, Math.max(0, subscription.terms.credit_limit_micros - (subscription.spent_micros || 0)));
    subscription.spent_micros = (subscription.spent_micros || 0) + record.charged_micros;
  }
}
