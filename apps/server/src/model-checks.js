import { fail, now, id, audit, consumption, baseUrl } from './domain.js';
import { effectiveQuotas, checkQuota } from './policy.js';
import { settingsFor } from './enterprise.js';
import { providerRequest, chatResponse, responseStream } from './providers.js';

async function boundedJson(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > 2*1024*1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Provider response too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Invalid provider JSON'); }
}
async function collectStream(stream) {
  const decoder = new TextDecoder(); let buffer = '', done = false, usage, size = 0;
  const calls = new Map();
  for await (const chunk of stream) {
    const part = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    size += Buffer.byteLength(part); if (size > 2*1024*1024) fail(502, 'INVALID_UPSTREAM_RESPONSE', 'Test response too large');
    buffer += part; let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0,match.index); buffer = buffer.slice(match.index+match[0].length);
      const data = frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if (data === '[DONE]') { done = true; continue; } if (!data) continue;
      let value; try { value = JSON.parse(data); } catch { fail(502,'INVALID_UPSTREAM_RESPONSE','Invalid stream JSON'); }
      if (value.error) fail(502,'UPSTREAM_STREAM_ERROR','Provider stream failed');
      usage = value.usage || usage;
      for (const call of value.choices?.[0]?.delta?.tool_calls || []) {
        const saved = calls.get(call.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) saved.id = call.id;
        if (call.extra_content) saved.extra_content = call.extra_content;
        saved.function.name += call.function?.name || ''; saved.function.arguments += call.function?.arguments || '';
        calls.set(call.index,saved);
      }
    }
  }
  if (!done) fail(502,'INCOMPLETE_STREAM','Test stream ended before completion');
  return { usage, choices: [{ message: { role: 'assistant', content: null, tool_calls: [...calls.values()] } }] };
}
export function registerModelChecks(app, { db, vault, config, activeRequests }) {
  function select(req) {
    const state = db.read(), model = state.models.find(m=>m.id===req.params.id);
    if (!model) fail(404,'MODEL_NOT_FOUND','模型不存在');
    const key = state.keys.find(k=>k.id===(req.body?.keyId || model.key_id));
    if (!key?.active) fail(400,'INVALID_KEY','请先选择启用的 Key');
    return { model: structuredClone(model), key: structuredClone(key) };
  }
  async function catalog(req,res) {
    const state=db.read();
    const selected=req.params.id?select(req):{model:{base_url:baseUrl(req.body?.baseUrl)},key:state.keys.find(k=>k.id===req.body?.keyId&&k.active)};
    const {model,key}=selected;
    if(!key)fail(400,'INVALID_KEY','请选择启用的 Key');
    try {
      const response = await fetch(`${model.base_url}/models`, { redirect:'error',headers:{Authorization:`Bearer ${vault.decrypt(key.secret)}`},signal:AbortSignal.timeout(Math.min(config.timeoutMs,15000)) });
      if (!response.ok) { await response.body?.cancel(); fail(502,'UPSTREAM_ERROR',`模型列表读取失败：HTTP ${response.status}`); }
      const result = await boundedJson(response);
      if (!Array.isArray(result.data)) fail(502,'INVALID_CATALOG','上游未返回兼容模型列表，请手动填写模型名');
      const models = [...new Set(result.data.map(m=>m.id).filter(value=>typeof value==='string' && value.length<=120))].slice(0,1000);
      db.transaction(state=>audit(state,req.user,'model.catalog',model.id || 'draft'));
      res.json({ models, note:'列表可读取不代表模型具有生成、工具调用或余额权限。' });
    } catch(error) { if (error.status) throw error; fail(502,'UPSTREAM_UNAVAILABLE','模型列表读取失败，请检查地址和网络'); }
  }
  app.post('/admin/models/catalog',catalog);
  app.post('/admin/models/:id/catalog',catalog);
  app.post('/admin/models/:id/check', async (req,res) => {
    const { model,key } = select(req); const outputLimit = Math.min(model.max_output_tokens,256);
    async function perform(body) {
      const current=db.read(),currentKey=current.keys.find(k=>k.id===key.id),currentModel=current.models.find(m=>m.id===model.id);
      if(!currentKey?.active||currentKey.secret!==key.secret||JSON.stringify(currentModel)!==JSON.stringify(model))fail(409,'MODEL_CHECK_STALE','模型或 Key 已变化，测试已停止');
      const requestId = id(), start = now(), started = Date.now(), reserved = Buffer.byteLength(JSON.stringify(body))+outputLimit;
      const controller = new AbortController(); let usage, result, status='failed', upstreamStatus, errorCode;
      db.transaction(state=>{
        if (state.requests.filter(r=>r.status==='pending').length>=settingsFor(state).maxActiveRequests) fail(429,'GATEWAY_BUSY','网关繁忙');
        const user=state.users.find(u=>u.id===req.user.id);
        if (state.requests.filter(r=>r.status==='pending'&&r.user_id===user.id).length>=(user.max_concurrent_requests||1)) fail(429,'REQUEST_IN_PROGRESS','已有请求正在进行');
        checkQuota(effectiveQuotas(state,user),consumption(state,user,config.timezone,start),reserved);
        state.requests.push({id:requestId,user_id:user.id,username:user.username,model:model.public_name,model_id:model.id,key_id:key.id,started_at:start,status:'pending',reserved_tokens:reserved,input_tokens:null,output_tokens:null,total_tokens:null,purpose:'model_check'});
      });
      activeRequests.set(requestId,{userId:req.user.id,sessionId:req.session.id,controller,reason:null});
      const timer=setTimeout(()=>controller.abort(),Math.min(config.timeoutMs,30000));
      const cancel=()=>{if(!res.writableFinished)controller.abort();};res.on('close',cancel);
      try {
        const outbound=providerRequest(body,model,vault.decrypt(key.secret),outputLimit);
        const response=await fetch(outbound.url,{method:'POST',redirect:'error',headers:outbound.headers,body:JSON.stringify(outbound.payload),signal:controller.signal});
        upstreamStatus=response.status;
        if(!response.ok){await response.body?.cancel();fail(502,'UPSTREAM_ERROR',`模型测试失败：HTTP ${response.status}`);}
        const type=response.headers.get('content-type')||'';
        if(!type.includes(body.stream?'text/event-stream':'application/json')){await response.body?.cancel();fail(502,'INVALID_UPSTREAM_RESPONSE','上游响应格式不匹配');}
        result=body.stream?await collectStream(model.protocol==='responses'?responseStream(response.body,model):response.body):chatResponse(await boundedJson(response),model);
        if(!Array.isArray(result.choices))fail(502,'INVALID_UPSTREAM_RESPONSE','上游未返回模型响应');
        const tokens=result.usage;
        if(Number.isSafeInteger(tokens?.total_tokens)&&tokens.total_tokens>=0){usage={input_tokens:tokens.prompt_tokens??null,output_tokens:tokens.completion_tokens??null,total_tokens:Math.max(tokens.total_tokens,(tokens.prompt_tokens||0)+(tokens.completion_tokens||0))};}
        status='success';return result;
      }catch(error){errorCode=controller.signal.aborted?'UPSTREAM_TIMEOUT':error.code||'UPSTREAM_UNAVAILABLE';if(error.status)throw error;fail(502,errorCode,'模型测试未完成，请检查网络或超时设置');}
      finally{
        clearTimeout(timer);res.off('close',cancel);activeRequests.delete(requestId);
        db.transaction(state=>{
          const record=state.requests.find(r=>r.id===requestId);
          Object.assign(record,{...usage,status,error_code:errorCode||null,upstream_status:upstreamStatus??null,duration_ms:Date.now()-started,finished_at:now(),charged_tokens:usage?.total_tokens??reserved,usage_source:usage?'provider':'reservation',currency:model.currency||'CNY',input_price:model.input_price||0,output_price:model.output_price||0});
          record.cost_micros=usage?.input_tokens!=null&&usage?.output_tokens!=null?Math.round(usage.input_tokens*(model.input_price||0)+usage.output_tokens*(model.output_price||0)):null;
        });
      }
    }
    let verification={status:'failed',checked_at:now(),key_id:key.id,stream:false,tools:false,tool_result:false};
    try {
      const body={messages:[{role:'user',content:'Call qcode_connection_check with ok=true. Do not call any other tool.'}],tools:[{type:'function',function:{name:'qcode_connection_check',description:'Checks model tool calling without running code.',parameters:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}}],tool_choice:{type:'function',function:{name:'qcode_connection_check'}},stream:true};
      const result=await perform(body);verification.stream=true;
      const call=result.choices[0]?.message?.tool_calls?.[0];
      if(!call?.id||call.function?.name!=='qcode_connection_check')fail(502,'TOOL_CALL_UNSUPPORTED','流式响应成功，但工具调用未通过');
      let args;try{args=JSON.parse(call.function.arguments);}catch{fail(502,'TOOL_CALL_INVALID','工具调用参数不是有效 JSON');}
      if(args.ok!==true)fail(502,'TOOL_CALL_INVALID','工具调用参数不符合测试要求');
      verification.tools=true;
      const follow=await perform({messages:[...body.messages,result.choices[0].message,{role:'tool',tool_call_id:call.id,content:'{"ok":true}'},{role:'user',content:'The tool succeeded. Reply with OK, do not call tools.'}],stream:false});
      if(!follow.choices[0]?.message?.content)fail(502,'TOOL_RESULT_UNSUPPORTED','工具结果回传后未获得文本回复');
      verification.tool_result=true;verification.status='verified';
    }catch(error){verification.error_code=error.code||'UPSTREAM_UNAVAILABLE';verification.message=error.status?error.message:'模型验证失败';}
    let stale=false;
    db.transaction(state=>{
      const saved=state.models.find(m=>m.id===model.id),savedKey=state.keys.find(k=>k.id===key.id);
      if(saved&&savedKey?.active&&savedKey.secret===key.secret&&saved.key_id===key.id&&JSON.stringify(saved)===JSON.stringify(model))saved.verification=verification;
      else stale=true;
      audit(state,req.user,'model.check',model.id);
    });
    if(stale)verification={...verification,status:'stale',message:'测试期间模型或 Key 已变化，请重新验证'};
    res.json(verification);
  });
}
