import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPresentation, catalogDisplayFields } from '../src/model-presentation.js';
import { fixture } from './gateway.test.js';

test('model presentation identifies brands without inventing capabilities', () => {
  assert.equal(modelPresentation({upstream_model:'openai/gpt-6.1-sol'}).icon,'openai');
  assert.equal(modelPresentation({upstream_model:'DeepSeek-flash'}).icon,'deepseek');
  assert.equal(modelPresentation({upstream_model:'qwen:0.5b'}).icon,'qwen');
  assert.deepEqual(modelPresentation({upstream_model:'claude-opus-thinking'}).capabilities,['chat']);
  assert.deepEqual(modelPresentation({capabilities:['thinking','vision','vip','source']} ).capabilities,['chat','vision','thinking']);
  assert.equal(modelPresentation({description:'<b>Plain text</b>'}).description,'<b>Plain text</b>');
});

test('client config returns safe presentation with no source or key data', async t => {
  const f=await fixture(t);
  f.db.transaction(state => {
    const model=state.models[0];
    model.upstream_model='claude-opus'; model.description='团队配置的中文简介'; model.capabilities=['vision','thinking'];
  });
  assert.equal((await f.request('/client/config')).status,401);
  const response=await f.request('/client/config','GET',undefined,f.admin);
  assert.equal(response.status,200);
  const model=response.body.models[0];
  assert.equal(model.icon,'claude'); assert.equal(model.description,'团队配置的中文简介');
  assert.deepEqual(model.capabilities,['chat','vision','thinking']);
  assert.equal(model.base_url,undefined); assert.equal(model.key_id,undefined); assert.equal(model.source_id,undefined);
  assert(!JSON.stringify(response.body).includes('secret-provider-key'));
});

test('catalog retains only explicitly advertised safe display fields', () => {
  assert.deepEqual(catalogDisplayFields({description:' 简介 ',capabilities:['vision','vip'],reasoning:true,key:'private'}),{description:'简介',capabilities:['vision','thinking']});
  assert.deepEqual(catalogDisplayFields({id:'thinking-vision-model'}),{});
  assert.deepEqual(catalogDisplayFields({input_modalities:['text','image']}),{capabilities:['vision']});
});
