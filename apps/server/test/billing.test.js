import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, moneyMicros, creditUsage, reserveCredit, settleCredit, officialPrice, modelPrice } from '../src/billing.js';

const user = { id: 2, role: 'user' };
const model = { pricing_known: true, currency: 'CNY', input_price: 2, cached_input_price: 0.2, output_price: 8, image_price: 0.1 };
function fixture(limit = 5000000) {
  return { requests: [], subscriptions: [{ id: 'cycle', user_id: 2, terms: { credit_limit_micros: limit },
    expires_at: '2099-01-01', spent_micros: 0 }] };
}
test('reported cache hits are a subset of input and duplicate final usage is settled only once', () => {
  const state = fixture();
  const usage = parseUsage({ prompt_tokens: 10000, completion_tokens: 1000, total_tokens: 11000, prompt_tokens_details: { cached_tokens: 8000 } });
  const record = { id: 'r', subscription_id: 'cycle', status: 'success' };
  state.requests.push(record);
  settleCredit(state, record, model, usage);
  assert.equal(record.cost_micros, 13600); // 2000*2 + 8000*0.2 + 1000*8
  settleCredit(state, record, model, usage);
  assert.equal(state.subscriptions[0].spent_micros, 13600);
  assert.equal(creditUsage(state, user).remaining, 4986400);
  assert.equal(parseUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 8 }).cached_input_tokens, 8);
});
test('missing usage is unknown; missing cache count gets no cache discount and reasoning is not added twice', () => {
  const state = fixture(), record = { subscription_id: 'cycle' };
  settleCredit(state, record, model, null);
  assert.equal(record.cost_micros, null); assert.equal(state.subscriptions[0].spent_micros, 0);
  const second = { subscription_id: 'cycle' };
  settleCredit(state, second, model, parseUsage({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 15 } }));
  assert.equal(second.cost_micros, 180);
});
test('different models and image generation consume the same period credit without creating a wallet', () => {
  const state = fixture();
  settleCredit(state, { subscription_id: 'cycle' }, model, { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 });
  settleCredit(state, { subscription_id: 'cycle' }, { ...model, output_price: 20 }, { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 });
  settleCredit(state, { subscription_id: 'cycle' }, model, null, 1);
  assert.equal(state.subscriptions[0].spent_micros, 100180);
});
test('expiry and exhausted credit reject requests; unfinished reservations release without estimated charges', () => {
  const state = fixture(1000);
  const reserved = reserveCredit(state, user, model, 10, 20);
  state.requests.push({ ...reserved, status: 'pending' });
  assert.equal(creditUsage(state, user).remaining, 820);
  state.requests[0].status = 'failed';
  assert.equal(creditUsage(state, user).remaining, 1000);
  state.subscriptions[0].spent_micros = 1000;
  assert.throws(() => reserveCredit(state, user, model, 0, 1), { code: 'CREDIT_EXHAUSTED' });
  state.subscriptions[0].expires_at = '2000-01-01';
  assert.equal(creditUsage(state, user).remaining, 0);
  assert.throws(() => reserveCredit(state, user, model, 0, 1), { code: 'SUBSCRIPTION_EXPIRED' });
});
test('late responses debit their captured cycle and charges cannot exceed purchased credit', () => {
  const state = fixture(50);
  state.subscriptions.push({ id: 'new-cycle', user_id: 2, terms: { credit_limit_micros: 1000000 }, expires_at: '2099-01-01', spent_micros: 0 });
  const record = { subscription_id: 'cycle' };
  settleCredit(state, record, model, { input_tokens: 100, output_tokens: 100 });
  assert.equal(record.cost_micros, 1000); assert.equal(record.charged_micros, 50);
  assert.equal(state.subscriptions[0].spent_micros, 50); assert.equal(state.subscriptions[1].spent_micros, 0);
});
test('amount validation and unconfigured/foreign-currency models fail explicitly', () => {
  for (const value of [null, -1, 0.0000001, Infinity, '5']) assert.throws(() => moneyMicros(value));
  assert.equal(moneyMicros(5.01), 5010000);
  assert.equal(moneyMicros(5.001), 5001000);
  for (const value of [undefined, { ...model, currency: 'USD' }, { ...model, pricing_known: false }])
    assert.throws(() => reserveCredit(fixture(), user, value, 1, 1), { code: 'MODEL_PRICE_REQUIRED' });
});

test('official reference prices require the matching source and never apply to relay or local models', () => {
  assert.equal(officialPrice({ kind: 'official', base_url: 'https://api.deepseek.com/v1' }, 'deepseek-flash').inputPrice, 2);
  assert.equal(officialPrice({ kind: 'official', base_url: 'https://api.moonshot.cn/v1' }, 'kimi-k3.1-pro').outputPrice, 68);
  assert.equal(officialPrice({ kind: 'relay', base_url: 'https://api.deepseek.com/v1' }, 'deepseek-flash'), null);
  assert.equal(officialPrice({ kind: 'official', base_url: 'https://example.com/v1' }, 'deepseek-flash'), null);
  assert.equal(officialPrice({ kind: 'local', base_url: 'http://localhost:11434/v1' }, 'qwen3.8-flash'), null);
});

test('decimal prices convert exactly and reject sub-micro precision before billing', () => {
  assert.equal(moneyMicros(0.000001), 1);
  assert.equal(moneyMicros(999999.999999), 999999999999);
  assert.equal(modelPrice('0.195800'), '0.195800');
  assert.equal(modelPrice('0.001000'), '0.001000');
  assert.equal(modelPrice('100000.000000'), '100000.000000');
  for (const value of ['0.0000001', 1.0000001, -0.0000001, Infinity, '', '1e-6', null])
    assert.throws(() => modelPrice(value), { code: 'INVALID_PRICE' });
  const state = fixture();
  const record = { subscription_id: 'cycle' };
  settleCredit(state, record, { ...model, input_price: '0.195800', cached_input_price: '0.195800', output_price: '0.992700' },
    { input_tokens: 1000000, output_tokens: 1000000, cached_input_tokens: 500000 });
  assert.equal(record.cost_micros, 1188500);
  const tiny = { subscription_id: 'cycle' };
  settleCredit(state, tiny, { ...model, input_price: 0.000001, output_price: 0.000001 },
    { input_tokens: 500000, output_tokens: 500000, cached_input_tokens: 0 });
  assert.equal(tiny.charged_micros, 1);
});
