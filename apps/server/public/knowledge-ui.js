function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
export function renderKnowledge({data,api,load,can,notice}){
  if(!document.getElementById('knowledge-styles')){const css=element('link');css.id='knowledge-styles';css.rel='stylesheet';css.href='/knowledge.css';document.head.append(css);}
  const root=element('div','knowledge'),intro=element('p','knowledge-note','上传 UTF-8 TXT 或 Markdown，第一版全员共享。启用资料通过共享 Skill 下发，客户端重新启动后可发现新文档；AI 会按问题选择和读取参考资料。');
  const search=element('form','knowledge-search'),query=element('input');query.type='search';query.placeholder='输入关键词，预览资料匹配结果';query.maxLength=120;query.setAttribute('aria-label','知识库搜索');const searchButton=element('button',null,'搜索'),results=element('div','knowledge-results');results.setAttribute('aria-live','polite');search.append(query,searchButton);
  search.onsubmit=async event=>{event.preventDefault();results.replaceChildren();if(!query.value.trim())return;searchButton.disabled=true;try{
    const {results:matches}=await api('/admin/knowledge/search?q='+encodeURIComponent(query.value.trim()));
    if(!matches.length)results.append(element('p','knowledge-note','没有找到匹配资料，请换个关键词。'));
    for(const match of matches){const result=element('article','knowledge-result');result.append(element('h3',null,match.title+(match.active?'':'（已禁用）')),element('p',null,match.excerpt));results.append(result);}
  }catch(error){notice(error);}finally{searchButton.disabled=false;}};
  const grid=element('div','knowledge-grid');
  async function editDocument(existing){
    let full=existing?await api('/admin/knowledge/'+existing.id):null;
    const dialog=element('dialog','knowledge-editor'),form=element('form'),heading=element('h2',null,full?'编辑资料':'上传资料'),error=element('p','knowledge-error');error.setAttribute('role','alert');
    function field(name,label,type,value){const wrapper=element('label',null,label),input=element(type==='textarea'?'textarea':'input');input.name=name;if(type!=='textarea')input.type=type;input.value=value||'';input.required=true;wrapper.append(input);form.append(wrapper);return input;}
    form.append(heading,element('p','knowledge-note',`单篇最多 ${Math.round(data.limits.bytes/1024)} KB，最多 ${data.limits.documents} 篇；资料按原文保存，不自动改写。`));
    const fileLabel=element('label',null,'选择文档'),file=element('input');file.type='file';file.accept='.txt,.md';file.required=!full;fileLabel.append(file);form.append(fileLabel);
    const title=field('title','标题','text',full?.title),summary=field('summary','简介（帮助 AI 判断相关性）','text',full?.summary),content=field('content','文档正文','textarea',full?.content);
    title.maxLength=100;summary.maxLength=400;summary.required=false;
    const activeLabel=element('label',null,'状态'),active=element('select');for(const [value,text]of [['true','启用，全员可用'],['false','暂不启用']]){const option=element('option',null,text);option.value=value;active.append(option);}active.value=String(full?.active??true);activeLabel.append(active);form.append(activeLabel);
    const actions=element('div','knowledge-actions'),cancel=element('button','secondary','取消'),save=element('button',null,'保存资料');cancel.type='button';cancel.onclick=()=>dialog.close();actions.append(cancel,save);form.append(error,actions);
    let filename=full?.filename||'';
    file.onchange=async()=>{error.textContent='';save.disabled=true;try{const selected=file.files[0];if(!selected)return;if(!/\.(md|txt)$/i.test(selected.name))throw Error('请选择 TXT 或 Markdown 文档');if(selected.size>data.limits.bytes)throw Error('文件超过大小限制');const decoded=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());content.value=decoded;filename=selected.name;if(!title.value)title.value=selected.name.replace(/\.(md|txt)$/i,'').slice(0,100);if(!summary.value)summary.value='团队参考资料：'+title.value;save.disabled=false;}catch(e){error.textContent=e instanceof TypeError?'文档需要使用 UTF-8 编码':e.message;}};
    form.onsubmit=async event=>{event.preventDefault();error.textContent='';save.disabled=true;try{const body={title:title.value,summary:summary.value,filename,content:content.value,active:active.value==='true'};await api(full?'/admin/knowledge/'+full.id:'/admin/knowledge',full?'PUT':'POST',body);dialog.close();await load();}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
    dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  }
  function action(label,handler){const button=element('button','secondary',label);button.type='button';button.onclick=async()=>{button.disabled=true;try{await handler();}catch(e){notice(e);}finally{button.disabled=false;}};return button;}
  for(const document of data.documents){
    const card=element('article','knowledge-card'),actions=element('div','knowledge-actions');
    card.append(element('h3',null,document.title),element('p',null,document.summary),element('span','badge'+(document.active?'':' muted'),document.active?'已启用 · 全员共享':'已禁用'),element('p','knowledge-note',`${document.filename} · ${Math.ceil(document.bytes/1024)} KB · ${document.chunks} 段`));
    if(can('knowledge:write'))actions.append(action('编辑',()=>editDocument(document)),action(document.active?'禁用':'启用',async()=>{const full=await api('/admin/knowledge/'+document.id);await api('/admin/knowledge/'+document.id,'PUT',{...full,active:!full.active});await load();}),action('删除',async()=>{if(confirm('删除这篇资料？客户端下次成功同步后会移除对应的托管文件。')){await api('/admin/knowledge/'+document.id,'DELETE');await load();}}));
    card.append(actions);grid.append(card);
  }
  if(!data.documents.length)grid.append(element('p','empty','还没有资料，上传团队规范、项目说明或常见问题开始使用。'));
  if(can('knowledge:write'))document.getElementById('actions').append(action('上传文档',()=>editDocument()));
  root.append(intro,search,results,grid);document.getElementById('content').replaceChildren(root);
}
