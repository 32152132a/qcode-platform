import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './gateway.test.js';
import { providerRequest } from '../src/providers.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=';
const messages = [{role:'user', content:[{type:'text',text:'描述这张图'},{type:'image_url',image_url:{url:image,detail:'low'}}]}];

test('shared image configuration routes images to the default vision model while text stays on the chosen model', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login();
  assert.equal((await f.chat(token,{messages})).body.error.code,'VISION_UNAVAILABLE');
  assert.equal(f.calls(),0); assert.equal(f.db.read().requests.length,0);
  const chat = f.db.read().models[0];
  const vision = (await f.request('/admin/models','POST',{name:'Image reader',publicName:'vision-public',upstreamModel:'vision-upstream',baseUrl:chat.base_url,keyId:f.key.id,maxOutputTokens:32,active:true},f.admin)).body;
  const configure = body => f.request('/admin/models/images/settings','PUT',body,f.admin);
  assert.equal((await f.request('/admin/models/images/settings','PUT',{visionModelId:vision.id},token)).status,403);
  assert.equal((await configure({visionModelId:'missing'})).status,400);
  assert.equal((await configure({visionModelId:vision.id})).status,200);
  assert.equal((await f.chat(token,{messages,max_tokens:100})).status,200);
  assert.equal(f.received().body.model,'vision-upstream');
  assert.equal(f.received().body.max_tokens,32);
  assert.deepEqual(f.received().body.messages,messages);
  assert.equal(f.received().auth,'Bearer secret-provider-key');
  const record = f.db.read().requests[0];
  assert.equal(record.model_id,vision.id); assert.equal(record.purpose,'image_understanding');
  assert.equal(record.total_tokens,5); assert.equal(record.status,'success');
  assert(!JSON.stringify(record).includes(image));
  assert.equal((await f.chat(token)).status,200);
  assert.equal(f.received().body.model,'private-model');
  assert.equal((await configure({visionModelId:''})).status,200);
  assert.equal((await f.chat(token,{messages})).body.error.code,'VISION_UNAVAILABLE');
  assert.equal(f.calls(),2);
});

test('a removed vision model fails safely and never marks the selected chat model as retired', async t => {
  const f = await fixture(t); await f.create(); const token = await f.login();
  const model = f.db.read().models[0];
  await f.request('/admin/models/images/settings','PUT',{visionModelId:model.id},f.admin);
  f.db.transaction(state=>{state.settings.imageGeneration.visionModelId='removed-model';});
  const result = await f.chat(token,{messages});
  assert.equal(result.status,503); assert.equal(result.body.error.code,'VISION_UNAVAILABLE');
  assert.equal(f.calls(),0);
  assert.equal((await f.chat(token)).status,200);
});

test('Responses adapter preserves image bytes, order and detail across follow-up conversation', () => {
  const follow = [...messages,{role:'assistant',content:'一张测试图'},{role:'user',content:'它是什么颜色？'}];
  const request = providerRequest({messages:follow}, {protocol:'responses',upstream_model:'vision-model',base_url:'https://example.invalid/v1'},'server-only-key',64);
  assert.deepEqual(request.payload.input[0].content,[{type:'input_text',text:'描述这张图'},{type:'input_image',image_url:image,detail:'low'}]);
  assert.equal(request.payload.input[2].content,'它是什么颜色？');
  assert.equal(request.payload.store,false);
});
