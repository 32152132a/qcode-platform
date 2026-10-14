const families = [['deepseek','DeepSeek'],['gpt','GPT / OpenAI'],['gemini','Gemini / Google'],['claude','Claude / Anthropic'],['grok','Grok / xAI'],['mistral','Mistral'],['custom','其他模型']];
const connections = {
  custom: {name:'自定义服务 / 中转站',url:'',protocol:'chat-completions'},
  vectorengine: {name:'VectorEngine 中转站',url:'https://api.vectorengine.ai/v1',protocol:'chat-completions'},
  deepseek: {name:'DeepSeek 官方',url:'https://api.deepseek.com/v1',protocol:'chat-completions'},
  openai: {name:'OpenAI 官方',url:'https://api.openai.com/v1',protocol:'responses'},
  google: {name:'Gemini 官方兼容入口',url:'https://generativelanguage.googleapis.com/v1beta/openai',protocol:'chat-completions'},
};
export function modelCards(models, keys, { edit, test, writable }) {
  const grid=document.createElement('div');grid.className='model-grid';
  for(const model of models){
    const card=document.createElement('article');card.className='model-card';
    const heading=document.createElement('h3');heading.textContent=model.name;
    const description=document.createElement('p');description.textContent=`${families.find(([id])=>id===model.provider)?.[1]||'自定义模型'} · ${model.protocol==='responses'?'Responses':'Chat Completions'}`;
    const badge=document.createElement('span');badge.className=model.active&&model.verification?.status==='verified'?'badge':'badge muted';badge.textContent=!model.active?'已禁用':model.verification?.status==='verified'?'流式及工具验证通过':model.verification?.status==='failed'?'验证未通过':'配置已保存 · 待验证';
    const info=document.createElement('dl');
    for(const [name,value] of [['员工模型名',model.public_name],['上游模型',model.upstream_model],['服务地址',model.base_url],['默认 Key',keys.find(k=>k.id===model.key_id)?.name||(model.key_id?'已绑定':'使用用户或部门 Key')]]){
      const title=document.createElement('dt'),text=document.createElement('dd');title.textContent=name;text.textContent=value;info.append(title,text);
    }
    const actions=document.createElement('div');actions.className='actions';
    if(writable)for(const [label,handler] of [['配置',()=>edit(model)],['验证模型',()=>test(model)]]){const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await handler();}finally{button.disabled=false;}};actions.append(button);}
    if(model.is_default){const defaultLabel=document.createElement('span');defaultLabel.className='badge';defaultLabel.textContent='默认模型';actions.append(defaultLabel);}
    card.append(heading,description,badge,info,actions);grid.append(card);
  }
  if(!models.length){grid.className='empty';grid.textContent='添加模型服务，验证后分配给用户或部门。';}
  return grid;
}
export function openModelEditor({model,keys,api,onSaved}) {
  const dialog=document.getElementById('editor'),form=document.getElementById('editor-form'),fields=document.getElementById('fields'),error=document.getElementById('editor-error');
  document.getElementById('editor-title').textContent=model?'配置模型':'添加模型服务';fields.replaceChildren();error.textContent='';
  const values=new Map();
  function field(parent,name,label,value,{options,type='text',required=true}={}){
    const wrapper=document.createElement('label');wrapper.textContent=label;
    const input=document.createElement(options?'select':'input');input.name=name;input.setAttribute('aria-label',label);
    if(options)for(const [value,text]of options){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}else input.type=type;
    input.value=value??'';input.required=required;
    if(type==='number'){input.min='0';input.step=['inputPrice','outputPrice'].includes(name)?'0.000001':'1';}
    wrapper.append(input);parent.append(wrapper);values.set(name,input);return input;
  }
  const basics=document.createElement('div');basics.className='model-editor-section';
  field(basics,'provider','模型品牌',model?.provider||'custom',{options:families});
  const connection=field(basics,'connection','服务来源','custom',{options:Object.entries(connections).map(([id,p])=>[id,p.name]),required:false});
  field(basics,'baseUrl','服务地址',model?.base_url||'');
  field(basics,'keyId','默认 Key（来自 Key 管理）',model?.key_id||'',{options:[['','使用用户或部门 Key'],...keys.filter(k=>k.active).map(k=>[k.id,`${k.name} · …${k.suffix}`])],required:false});
  field(basics,'upstreamModel','上游真实模型名',model?.upstream_model||'');
  field(basics,'name','显示名称',model?.name||'');
  field(basics,'publicName','员工可见模型名',model?.public_name||'');
  field(basics,'active','是否启用',String(model?.active??false),{options:[['false','暂不启用'],['true','启用，允许已分配用户使用']]});
  const note=document.createElement('p');note.className='model-editor-note';note.textContent='Key 优先级：用户专用 → 部门专用 → 模型默认。支持 Chat Completions 和 Responses；原生 Gemini / Anthropic 地址请使用兼容中转入口。模型名按服务商实际支持的名称填写，不能用聊天项目中的 vectorengine- 前缀。保存不会自动验证；测试会产生少量实际请求和用量。';
  const advanced=document.createElement('details');advanced.className='model-advanced';const summary=document.createElement('summary');summary.textContent='高级配置';advanced.append(summary);const advancedFields=document.createElement('div');advancedFields.className='model-editor-section';advanced.append(advancedFields);
  field(advancedFields,'protocol','接口协议',model?.protocol||'chat-completions',{options:[['chat-completions','Chat Completions（兼容中转、Gemini、Claude 等）'],['responses','Responses（GPT / 部分中转站）']]});
  field(advancedFields,'maxOutputTokens','每次最大输出 Token',model?.max_output_tokens||8192,{type:'number'});
  field(advancedFields,'contextWindow','模型上下文长度',model?.context_window||131072,{type:'number'});
  field(advancedFields,'maxTokensField','Chat Completions 输出上限字段',model?.max_tokens_field||'max_tokens',{options:[['max_tokens','max_tokens'],['max_completion_tokens','max_completion_tokens']]});
  field(advancedFields,'streamUsage','流式用量统计',String(model?.stream_usage??true),{options:[['true','请求上游返回用量'],['false','不支持时保守计费']]});
  field(advancedFields,'inputPrice','每百万输入 Token 单价',model?.input_price||0,{type:'number'});
  field(advancedFields,'outputPrice','每百万输出 Token 单价',model?.output_price||0,{type:'number'});
  field(advancedFields,'currency','计价币种',model?.currency||'CNY',{options:[['CNY','CNY'],['USD','USD']]});
  field(advancedFields,'isDefault','设为默认模型',String(model?.is_default??false),{options:[['false','否'],['true','是']]});
  fields.append(basics,note,advanced);
  connection.onchange=()=>{const preset=connections[connection.value];values.get('baseUrl').value=preset.url;values.get('protocol').value=preset.protocol;};
  values.get('provider').onchange=()=>{if(!model){const family=values.get('provider').value;values.get('name').value=families.find(([id])=>id===family)[1];values.get('publicName').value=`qcode-${family}`;}};
  const catalogueButton=document.createElement('button');catalogueButton.type='button';catalogueButton.className='secondary';catalogueButton.textContent='读取服务支持的模型列表';
  const catalogStatus=document.createElement('p');catalogStatus.className='model-editor-note';catalogStatus.setAttribute('role','status');fields.append(catalogStatus);
  const list=document.createElement('datalist');list.id='provider-model-list';values.get('upstreamModel').setAttribute('list',list.id);fields.append(catalogueButton,list);
  catalogueButton.onclick=async()=>{error.textContent='';catalogueButton.disabled=true;try{
    if(!values.get('keyId').value)throw Error('读取列表需要选择默认 Key；请先在 Key 管理中添加中转站 Key');
    const data=await api('/admin/models/catalog','POST',{baseUrl:values.get('baseUrl').value,keyId:values.get('keyId').value});list.replaceChildren();for(const name of data.models){const option=document.createElement('option');option.value=name;list.append(option);}catalogStatus.textContent=`已读取 ${data.models.length} 个模型，在上游模型输入框中选择。`;
  }catch(e){error.textContent=e.message;}finally{catalogueButton.disabled=false;}};
  form.onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;error.textContent='';try{
    const data=Object.fromEntries([...values].filter(([name])=>name!=='connection').map(([name,input])=>[name,input.value]));
    for(const name of ['streamUsage','isDefault','active'])data[name]=data[name]==='true';
    for(const name of ['maxOutputTokens','contextWindow','inputPrice','outputPrice'])data[name]=Number(data[name]);data.keyId||=null;
    await api(model?`/admin/models/${model.id}`:'/admin/models',model?'PUT':'POST',data);dialog.close();await onSaved();
  }catch(e){error.textContent=e.message;if(advanced.querySelector(':invalid'))advanced.open=true;}finally{submit.disabled=false;}};
  const revealInvalid=event=>{if(advanced.contains(event.target))advanced.open=true;};
  form.addEventListener('invalid',revealInvalid,true);
  dialog.addEventListener('close',()=>form.removeEventListener('invalid',revealInvalid,true),{once:true});
  dialog.showModal();dialog.scrollTop=0;
}
