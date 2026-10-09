export function renderEnterprise(section,data,ui){
  const {content,toolbar,api,button,table,edit,load,actions,can,quotaLabels}=ui;
  const quotaFields=(prefix,value,label)=>Object.entries(quotaLabels).map(([key,title],index)=>({name:prefix+key,label:title+'（0 为不限）',type:'number',value:value?.[key]||0,...(index===0?{group:label}:{})}));
  const readQuotas=(prefix,form)=>Object.fromEntries(Object.keys(quotaLabels).map(key=>[key,Number(form[prefix+key])]));
  async function departmentEditor(department){
    const models=can('models:read')?await api('/admin/models'):[],keys=can('keys:read')?await api('/admin/keys'):[];
    const fields=[{name:'name',label:'部门名称',value:department?.name},{name:'active',label:'部门状态',options:[['true','启用'],['false','停用']],value:String(department?.active??true)},
      {name:'modelId',label:'部门默认模型',options:[['','跟随系统默认'],...models.map(m=>[m.id,m.name])],value:department?.model_id}];
    if(can('keys:write'))fields.push({name:'keyId',label:'部门共享 Key',options:[['','不设置共享 Key'],...keys.map(k=>[k.id,`${k.name} · ${k.suffix}`])],value:department?.key_id});
    fields.push(...quotaFields('shared_',department?.quotas,'部门共享额度'),...quotaFields('user_',department?.user_quotas,'成员默认额度（选择继承部门的用户生效）'));
    edit(department?'编辑部门':'创建部门',fields,async form=>{const body={name:form.name,active:form.active==='true',modelId:form.modelId||null,quotas:readQuotas('shared_',form),userQuotas:readQuotas('user_',form)};if(can('keys:write'))body.keyId=form.keyId||null;await api(department?`/admin/departments/${department.id}`:'/admin/departments',department?'PUT':'POST',body);});
  }
  async function skillEditor(skill){
    const departments=await api('/admin/departments');
    const extra={...skill?.files};delete extra['SKILL.md'];
    edit(skill?'编辑共享 Skill':'发布共享 Skill',[
      {name:'name',label:'标识名称（小写字母、数字和短横线）',value:skill?.name},
      {name:'active',label:'状态',options:[['true','启用并同步到客户端'],['false','停用并移除托管副本']],value:String(skill?.active??true)},
      {name:'description',label:'用途说明',value:skill?.description,wide:true},
      {name:'departmentIds',label:'适用部门（按住 Ctrl 多选；不选为全员）',options:departments.map(d=>[d.id,d.name]),multiple:true,value:skill?.department_ids||[],required:false,wide:true},
      {name:'content',label:'Skill 指令内容（Markdown）',type:'textarea',value:skill?.content,wide:true},
      {name:'files',label:'附加文本文件（可选，JSON 对象；高级设置）',type:'textarea',value:Object.keys(extra).length?JSON.stringify(extra,null,2):'',required:false,wide:true},
    ],form=>api(skill?`/admin/skills/${skill.id}`:'/admin/skills',skill?'PUT':'POST',{name:form.name,description:form.description,content:form.content,active:form.active==='true',departmentIds:form.departmentIds,files:form.files?JSON.parse(form.files):{}}));
  }
  if(section==='departments'){
    if(can('departments:write'))toolbar.append(button('创建部门',()=>departmentEditor(),false));
    content.append(table(['部门','成员','状态','共享 Token 已用 / 总额度','操作'],data.map(d=>[d.name,d.members,d.active?'启用':'停用',`${d.used.totalTokens} / ${d.quotas.totalTokens||'不限'}`,can('departments:write')?actions(button('编辑',()=>departmentEditor(d)),button('恢复额度',async()=>{if(confirm(`重置 ${d.name} 的部门共享额度？成员个人额度保持不变。`)){await api(`/admin/departments/${d.id}/reset-quota`,'POST',{});await load();}}),button('删除',async()=>{if(confirm(`删除部门 ${d.name}？请先移出成员。`)){await api(`/admin/departments/${d.id}`,'DELETE');await load();}})):'只读'])));
    return true;
  }
  if(section==='skills'){
    if(can('skills:write'))toolbar.append(button('发布 Skill',()=>skillEditor(),false));
    content.append(table(['Skill','用途','适用范围','状态','更新时间','操作'],data.map(s=>[s.name,s.description,s.department_ids.length?`${s.department_ids.length} 个部门`:'全员',s.active?'已发布':'已停用',new Date(s.updated_at).toLocaleString(),can('skills:write')?actions(button('编辑',()=>skillEditor(s)),button('删除',async()=>{if(confirm(`删除 ${s.name}？客户端下一次同步时移除托管副本。`)){await api(`/admin/skills/${s.id}`,'DELETE');await load();}})):'只读'])));
    return true;
  }
  if(section==='settings'){
    if(can('settings:write'))toolbar.append(button('修改设置',()=>edit('系统设置',[
      {name:'organizationName',label:'组织名称',value:data.organizationName},{name:'minimumClientVersion',label:'最低客户端版本',value:data.minimumClientVersion},
      {name:'supportMessage',label:'员工支持提示',value:data.supportMessage,wide:true},
      {name:'autoUpdate',label:'客户端自动升级',options:[['false','关闭（员工手动执行 qcode update）'],['true','启动时自动校验并升级']],value:String(data.autoUpdate)},
      {name:'maxActiveRequests',label:'网关最大同时请求数',type:'number',min:1,value:data.maxActiveRequests},
      {name:'auditRetentionDays',label:'审计归档保留天数（归档命令使用；0 为无限）',type:'number',value:data.auditRetentionDays,wide:true},
    ],form=>api('/admin/settings','PUT',{...form,autoUpdate:form.autoUpdate==='true',maxActiveRequests:Number(form.maxActiveRequests),auditRetentionDays:Number(form.auditRetentionDays)})),false));
    const names={organizationName:'组织名称',supportMessage:'员工支持提示',minimumClientVersion:'最低客户端版本',autoUpdate:'启动时自动升级',maxActiveRequests:'网关最大同时请求数',auditRetentionDays:'审计保留天数'};
    content.append(table(['配置项','当前值'],Object.entries(data).map(([key,value])=>[names[key]||key,typeof value==='boolean'?(value?'已开启':'已关闭'):value])));
    const info=document.createElement('p');info.className='subheading';info.textContent='员工端安装：下载 ZIP 后解压并运行 install.ps1；首次安装会校验并安装 Node.js 和 Harness。';content.append(info);
    toolbar.append(button('下载员工客户端',async()=>{const response=await fetch('/downloads/manifest.json');const manifest=await response.json();if(!response.ok)throw new Error(manifest.error?.message||'安装包尚未生成');const link=document.createElement('a');link.href=manifest.downloadUrl;link.download='';link.click();}));
    return true;
  }
  return false;
}
