import { fetchWithKeys, sourceKeyIds } from './key-pool.js';
import { fail, text, audit } from './domain.js';

export async function embedTexts({db, vault, config}, {sourceId, model, texts}) {
  const state=db.read(),source=state.settings.modelSources.find(item=>item.id===sourceId && item.active);
  if(!source)fail(400,'INVALID_SOURCE','请选择启用的服务站点');
  model=text(model,'向量模型',200);
  if(!Array.isArray(texts)||!texts.length||texts.length>32||texts.some(value=>typeof value!=='string'||!value.trim()||value.length>12000))fail(400,'INVALID_EMBEDDING_INPUT','每批支持 1～32 个文本片段');
  const keys=source.kind==='local'?[null]:sourceKeyIds(source).map(id=>state.keys.find(key=>key.id===id&&key.active)).filter(Boolean);
  if(!keys.length)fail(503,'KEY_UNAVAILABLE','此站点暂无可用 Key');
  const response=await fetchWithKeys({db,keys,signal:AbortSignal.timeout(Math.min(config.timeoutMs,30000)),build:key=>({
    url:source.base_url+'/embeddings',method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+vault.decrypt(key.secret)}:{})},body:JSON.stringify({model,input:texts,encoding_format:'float'}),
  })});
  if(!response.ok){await response.body?.cancel();fail(502,'EMBEDDING_UPSTREAM_ERROR','向量接口返回 HTTP '+response.status+'，请检查模型与接口地址');}
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4*1024*1024)fail(502,'EMBEDDING_RESPONSE_TOO_LARGE','向量响应超过大小限制');chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(502,'INVALID_EMBEDDING_RESPONSE','向量接口返回格式无效');}
  if(!Array.isArray(value?.data)||value.data.length!==texts.length)fail(502,'INVALID_EMBEDDING_RESPONSE','向量数量与输入文本不一致');
  const vectors=new Array(texts.length);
  for(const item of value.data){
    if(!item||typeof item!=='object'||!Number.isInteger(item.index)||item.index<0||item.index>=texts.length||vectors[item.index]||!Array.isArray(item.embedding)||!item.embedding.length||item.embedding.length>4096||item.embedding.some(value=>typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value))))fail(502,'INVALID_EMBEDDING_RESPONSE','向量序号、维度或数值无效');
    vectors[item.index]=item.embedding;
  }
  const dimensions=vectors[0].length;
  if(vectors.some(vector=>vector.length!==dimensions))fail(502,'INVALID_EMBEDDING_RESPONSE','向量维度不一致');
  return {vectors,dimensions};
}
export function registerEmbeddingSettings(app, services){
  const {db}=services;
  app.post('/admin/models/embeddings/settings/detail',(_req,res)=>res.json(db.read().settings.embedding||null));
  app.post('/admin/models/embeddings/settings/update',async(req,res)=>{
    const sourceId=text(req.body?.sourceId,'服务站点',100),model=text(req.body?.model,'向量模型',200);
    const snapshot=db.read(),previous=snapshot.settings.embedding;
    const changing=previous&&(previous.sourceId!==sourceId||previous.model!==model);
    if(changing&&req.body.confirmChange!==true)fail(409,'EMBEDDING_CHANGE_CONFIRMATION_REQUIRED','更换向量模型需要二次确认，并重建已有知识库索引');
    const source=snapshot.settings.modelSources.find(item=>item.id===sourceId);
    if(!source)fail(400,'INVALID_SOURCE','服务站点不存在');
    const {dimensions}=await embedTexts(services,{sourceId,model,texts:['知识库连接检查']});
    const saved=db.transaction(state=>{
      if(JSON.stringify(state.settings.embedding)!==JSON.stringify(previous))fail(409,'CONFIG_CHANGED','向量配置已被修改，请刷新后重新确认');
      if(previous&&!changing&&previous.dimensions!==dimensions)fail(409,'EMBEDDING_DIMENSIONS_CHANGED','上游向量维度已变化，已保留原配置。请先处理索引重建后再保存');
      const current=state.settings.modelSources.find(item=>item.id===sourceId);
      if(!current?.active||current.revision!==source.revision)fail(409,'SOURCE_CHANGED','服务站点已变化，请重新验证');
      const value={sourceId,model,dimensions};state.settings.embedding=value;audit(state,req.user,'embedding.settings.update',sourceId);return value;
    });res.json(saved);
  });
}
