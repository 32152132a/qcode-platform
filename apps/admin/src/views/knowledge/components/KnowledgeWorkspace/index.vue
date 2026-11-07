<template>
  <section v-if="processing" class="knowledge-waiting" role="status" aria-live="polite">
    <el-icon class="is-loading" :size="32"><Loading /></el-icon>
    <h2>{{ processing.stage==='uploading'?'正在上传资料':'正在整理资料' }}</h2>
    <p>{{ processing.stage==='uploading'?'已上传':'已处理' }} {{ processing.completed }} / {{ processing.total }} 份<span v-if="processing.failed">，其中 {{ processing.failed }} 份失败</span></p>
    <el-progress :percentage="Math.floor(processing.completed/Math.max(processing.total,1)*100)" :stroke-width="8" />
    <el-text type="info">{{ processing.filename }}</el-text>
    <el-text type="info">整理完成后自动显示详情，可按需修改后一键发布。</el-text>
  </section>
  <el-empty v-else-if="!documents.length" description="点击“上传资料”，一次选择多份文档开始整理" />
  <div v-else class="knowledge-workspace">
    <aside class="knowledge-workspace__directory">
      <el-input v-model="keyword" placeholder="查找目录" clearable aria-label="查找知识目录" />
      <el-scrollbar class="knowledge-workspace__scroll">
        <el-tree ref="treeRef" :data="tree" node-key="id" :props="{label:'title'}" :filter-node-method="matches" :current-node-key="currentKey" default-expand-all highlight-current :expand-on-click-node="false" @node-click="select" />
      </el-scrollbar>
    </aside>
    <section v-loading="loading" class="knowledge-workspace__reader">
      <el-alert v-if="error||document?.error" :title="error||document?.error||''" type="error" :closable="false" />
      <template v-if="document">
        <header class="knowledge-workspace__toolbar">
          <div><strong>{{ document.title }}</strong><el-text type="info">{{ status }}</el-text></div>
          <div v-if="canWrite" class="knowledge-workspace__actions">
            <el-button v-if="editable&&(selected||proposal)&&!editing" :disabled="saving" @click="beginEdit">编辑</el-button>
            <el-dropdown trigger="click" @command="operate">
              <el-button :disabled="editing">更多操作</el-button>
              <template #dropdown><el-dropdown-menu>
                <el-dropdown-item command="replace">替换文件</el-dropdown-item>
                <el-dropdown-item v-if="document.status==='failed'||publishable" command="retry">重新整理</el-dropdown-item>
                <el-dropdown-item v-if="document.published" command="unpublish">撤回发布</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除资料</el-dropdown-item>
              </el-dropdown-menu></template>
            </el-dropdown>
          </div>
        </header>
        <el-scrollbar class="knowledge-workspace__scroll">
          <article v-if="draft" class="knowledge-workspace__article">
            <el-input v-model="draft.title" maxlength="100" aria-label="标题" />
            <el-input v-model="draft.summary" type="textarea" :rows="3" maxlength="100" show-word-limit aria-label="摘要" />
            <el-input v-model="draft.text" type="textarea" :rows="14" maxlength="12000" show-word-limit aria-label="正文" />
            <el-text type="info">修改保存为待发布内容，原始上传文件保留。</el-text>
            <div><el-button type="primary" :loading="saving" @click="saveNode">确定</el-button><el-button :disabled="saving" @click="cancelEdit">取消</el-button></div>
          </article>
          <article v-else-if="proposal" class="knowledge-workspace__article">
            <h2>{{ proposal.operation==='add'?'新增章节':'修改章节' }} · {{ proposal.title }}</h2>
            <el-text type="info">所属资料：{{ proposal.documentTitle }}</el-text>
            <p>{{ proposal.reason }}</p>
            <div class="knowledge-workspace__comparison">
              <section><h3>修改前</h3><pre>{{ proposal.before?.text||'新增章节，无旧内容' }}</pre></section>
              <section><h3>发布后</h3><pre>{{ proposal.text }}</pre></section>
            </div>
            <el-text type="info">依据：{{ document.filename }}；原文件保留，发布后才会更新关联章节。</el-text>
            <el-button v-if="publishable&&canWrite" class="knowledge-workspace__ignore" :loading="saving" @click="dismiss">忽略这项修改</el-button>
          </article>
          <article v-else-if="selected" class="knowledge-workspace__article">
            <h2>{{ selected.title }}</h2><p v-if="selected.summary" class="knowledge-workspace__summary">{{ selected.summary }}</p>
            <el-text type="info">{{ location }}</el-text>
            <pre>{{ selected.text }}</pre>
          </article>
          <el-empty v-else :description="document.status==='failed'?'处理失败，可重新处理或替换文件':'资料处理中，完成后会显示目录与原文'" />
        </el-scrollbar>
      </template>
      <el-empty v-else-if="!loading" description="从左侧选择资料或章节" />
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElMessage,ElTree} from 'element-plus'
import {Loading} from '@element-plus/icons-vue'
import {request} from '@/api/request'
import {confirmAction} from '@/utils/forms'
import type {KnowledgeDocument,KnowledgeNode,KnowledgeProgress} from '../../types'

const props=defineProps<{documents:KnowledgeDocument[];canWrite:boolean;processing?:KnowledgeProgress}>()
const emit=defineEmits<{changed:[];replace:[document:KnowledgeDocument];editing:[value:boolean]}>()
const treeRef=ref<InstanceType<typeof ElTree>>(),keyword=ref(''),loading=ref(false),saving=ref(false),error=ref(''),draft=ref<Pick<KnowledgeNode,'title'|'summary'|'text'>>()
const document=ref<KnowledgeDocument>(),selected=ref<KnowledgeNode>(),proposalIndex=ref<number>(),details=ref<Record<string,KnowledgeDocument>>({})
let sequence=0
type DirectoryNode={id:string;title:string;documentId:string;node?:KnowledgeNode;proposalIndex?:number;children:DirectoryNode[]}
const labels:Record<string,string>={pending:'等待整理',processing:'整理中',ready:'待发布',failed:'处理失败'}
const editing=computed(()=>Boolean(draft.value)||saving.value)
const publishable=computed(()=>document.value?.status==='ready'&&document.value.draft_revision!==document.value.published_revision)
const editable=computed(()=>props.canWrite&&publishable.value)
const proposal=computed(()=>proposalIndex.value===undefined?undefined:document.value?.proposals[proposalIndex.value])
const currentKey=computed(()=>proposalIndex.value===undefined?selected.value?.id||document.value?.id:document.value?.id+':proposal:'+proposalIndex.value)
const status=computed(()=>{const value=document.value;if(!value)return '';return value.published?(value.published_revision===value.draft_revision?'已发布':'旧版使用中 · 新版'+(labels[value.status]||'')):(labels[value.status]||'未发布')})
const tree=computed(()=>props.documents.map(item=>{
  const map=new Map<string,DirectoryNode>()
  for(const node of details.value[item.id]?.nodes||[])map.set(node.id,{id:node.id,title:node.title,documentId:item.id,node,children:[]})
  const children:DirectoryNode[]=[]
  for(const node of map.values()){const parent=node.node?.parentId&&map.get(node.node.parentId);if(parent)parent.children.push(node);else children.push(node)}
  const proposals=details.value[item.id]?.proposals||[]
  if(proposals.length)children.push({id:item.id+':proposals',title:`有更新（${proposals.length}）`,documentId:item.id,children:proposals.map((change,index)=>({id:item.id+':proposal:'+index,title:(change.operation==='add'?'新增 · ':'修改 · ')+change.title,documentId:item.id,proposalIndex:index,children:[]}))})
  return{id:item.id,title:item.title+(item.published?'':' · '+(labels[item.status]||'未发布'))+(item.changes?' · 有更新':''),documentId:item.id,children}
}))
const location=computed(()=>{const source=selected.value?.source;if(!source)return '';if(source.page)return `来源：${document.value?.filename} · 第${source.page}页`;if(source.sheet)return `来源：${source.sheet} · 第${source.rowStart}～${source.rowEnd}行`;return `来源：${document.value?.filename} · 第${source.lineStart||1}～${source.lineEnd||1}行`})
function matches(value:string,node:Record<string,unknown>){return String(node.title||'').toLocaleLowerCase().includes(value.toLocaleLowerCase())}
function cancelEdit(){draft.value=undefined}
function beginEdit(){const value=proposal.value||selected.value;if(editable.value&&value)draft.value={title:value.title,summary:value.summary,text:value.text}}
async function open(id:string,nodeId?:string){
  const current=++sequence;loading.value=true;cancelEdit();error.value='';selected.value=undefined;proposalIndex.value=undefined
  try{const value=await request<KnowledgeDocument>('/admin/knowledge/'+id);if(current!==sequence)return;document.value=value;details.value[id]=value;const node=value.nodes.find(node=>node.id===nodeId)||value.nodes[0];selected.value=node?{...node}:undefined}
  catch(cause){if(current===sequence){document.value=undefined;error.value=cause instanceof Error?cause.message:'读取失败'}}
  finally{if(current===sequence)loading.value=false}
}
async function select(item:DirectoryNode){if(editing.value){treeRef.value?.setCurrentKey(currentKey.value);ElMessage.info('请先确定或取消修改');return}if(item.documentId!==document.value?.id)await open(item.documentId,item.node?.id);if(document.value?.id!==item.documentId)return;proposalIndex.value=item.proposalIndex;const node=item.node||document.value.nodes[0];selected.value=node?{...node}:undefined}
async function saveNode(){
  const value=document.value,content=draft.value,index=proposalIndex.value,node=selected.value
  if(!value||!content||saving.value)return
  saving.value=true;error.value=''
  const save=async()=>{await request('/admin/knowledge/'+value.id+'/node','POST',{revision:value.draft_revision,...(index===undefined?{nodeId:node?.id}:{proposalIndex:index}),...content});await open(value.id,node?.id);if(index!==undefined)proposalIndex.value=index;ElMessage.success('修改已保存，待一键发布');emit('changed')}
  try{
    const related=index===undefined&&content.text!==node?.text&&value.proposals.some(item=>item.sourceNodeIds.includes(node?.id||''))
    if(related)await confirmAction('修改正文会移除依据此章节生成的关联建议，避免发布不一致的内容。是否确认？',save);else await save()
  }catch(cause){error.value=cause instanceof Error?cause.message:'保存失败'}finally{saving.value=false}
}
async function dismiss(){
  const value=document.value,index=proposalIndex.value;if(!value||index===undefined||saving.value)return
  saving.value=true;error.value=''
  try{await request('/admin/knowledge/'+value.id+'/proposals/dismiss','POST',{revision:value.draft_revision,index});await open(value.id);emit('changed')}
  catch(cause){error.value=cause instanceof Error?cause.message:'操作失败'}finally{saving.value=false}
}
async function operate(command:string){
  const value=document.value;if(!value||saving.value)return
  if(command==='replace'){emit('replace',value);return}
  const run=async()=>{await request('/admin/knowledge/'+value.id+(command==='delete'?'':'/'+command),command==='delete'?'DELETE':'POST');emit('changed')}
  try{if(command==='delete'||command==='unpublish')await confirmAction(command==='delete'?'删除资料及其所有原文版本？':'撤回后用户将无法检索此资料，是否继续？',run);else await run()}
  catch(cause){error.value=cause instanceof Error?cause.message:'操作失败'}
}
watch(keyword,value=>treeRef.value?.filter(value))
watch(editing,value=>emit('editing',value))
watch(()=>props.documents,items=>{
  for(const id of Object.keys(details.value))if(!items.some(item=>item.id===id))delete details.value[id]
  if(!items.length){sequence++;loading.value=false;document.value=undefined;selected.value=undefined;proposalIndex.value=undefined;return}
  const previous=document.value,current=items.find(item=>item.id===previous?.id)
  if(!current){void open(items[0]!.id);return}
  if(!editing.value&&previous&&(current.draft_revision!==previous.draft_revision||current.published_revision!==previous.published_revision||current.status!==previous.status||current.changes!==previous.changes))void open(current.id,selected.value?.id)
},{immediate:true})
defineExpose({open})
</script>
<style scoped lang="scss">
.knowledge-workspace{
  display:grid;grid-template-columns:minmax(220px,27%) minmax(0,1fr);flex:1;min-height:0;min-width:0;gap:var(--admin-gap);
  &__directory,&__reader{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;min-width:0;gap:16px}
  &__directory{border-right:1px solid var(--el-border-color-lighter);padding-right:var(--admin-gap)}
  &__reader{display:flex;flex-direction:column}
  &__scroll{min-height:0;min-width:0;flex:1}
  &__toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;strong{display:block;margin-bottom:8px;overflow-wrap:anywhere}}
  &__actions{display:flex;gap:8px;align-items:center}
  &__article{display:grid;gap:16px;padding-right:12px;h2,p,pre{margin:0}h2{font-size:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8}}
  &__summary{padding:12px;background:var(--el-fill-color-light);border-radius:var(--el-border-radius-base);color:var(--el-text-color-secondary)}
  &__ignore{justify-self:start}
  &__comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;section{padding:16px;border:1px solid var(--el-border-color-lighter);border-radius:var(--el-border-radius-base);min-width:0}h3{font-size:14px;margin:0 0 12px}}
  @media(max-width:700px){grid-template-columns:1fr;grid-template-rows:minmax(130px,30%) minmax(0,1fr);&__directory{border-right:0;border-bottom:1px solid var(--el-border-color-lighter);padding:0 0 12px}&__comparison{grid-template-columns:1fr}}
}
.knowledge-waiting{display:grid;justify-items:center;align-content:center;gap:20px;flex:1;min-height:0;padding:24px;h2,p{margin:0}h2{font-size:20px}.el-icon{color:var(--el-color-primary)}.el-progress{width:min(440px,100%)}.el-text{max-width:100%;overflow-wrap:anywhere;text-align:center}}
</style>
