<template>
  <section v-loading="loading&&!data" class="knowledge-manager">
    <header class="knowledge-manager__toolbar">
      <h1 class="knowledge-manager__title">企业知识库</h1>
      <div class="knowledge-manager__actions">
      <el-button v-if="canTest" text class="knowledge-manager__test" @click="emit('test')">测试问答</el-button>
      <el-popover v-if="isDraft&&library?.changes.length" placement="bottom-end" width="360" trigger="click">
        <template #reference><el-button link class="knowledge-manager__changes"><span class="knowledge-manager__dot"></span>{{ library.changes.length }} 项待发布</el-button></template>
        <el-scrollbar max-height="300px">
          <p v-for="change in library.changes" :key="change.id">{{ operationNames[change.operation] }} · {{ change.title }}</p>
        </el-scrollbar>
      </el-popover>
      <template v-if="canEdit">
        <el-tooltip content="优化目录、标题和摘要，可大幅提升知识检索命中率。" placement="bottom">
          <el-button class="knowledge-manager__beautify" :icon="MagicStick" :loading="beautifying" :disabled="!library?.nodes.length||busy" @click="beautify()">AI 优化草稿</el-button>
        </el-tooltip>
        <el-button type="primary" :icon="Upload" :disabled="!library?.changes.length||busy" @click="publish">发布全部</el-button>
      </template>
    </div>
    </header>
    <div class="knowledge-manager__status">
      <el-alert v-if="versionMismatch" title="管理端与后台版本不一致，请先更新后台服务后再上传资料" type="error" :closable="false" show-icon />
      <el-alert v-if="error||actionError" :title="error||actionError" type="error" :closable="false" show-icon />
      <p v-if="isDraft&&(uploading||processingCount)" class="knowledge-manager__processing" role="status"><el-icon class="is-loading"><Loading /></el-icon>{{ uploading?uploadProgress:processingCount+' 份资料正在解析或 AI 整理…' }}</p>
      <p v-if="isDraft&&beautifying" class="knowledge-manager__processing" role="status"><el-icon class="is-loading"><Loading /></el-icon>正在整理知识内容，完成后保存为草稿…</p>
      <details v-else-if="isDraft&&library?.review&&(library.review.warnings.length||library.review.exclusions.length)" class="knowledge-manager__notices"><summary>AI 整理记录 · {{ library.review.warnings.length+library.review.exclusions.length }} 项</summary><p v-for="warning in library.review.warnings" :key="warning">{{ warning }}</p><div v-for="(item,index) in library.review.exclusions" :key="index"><p><strong>{{ item.titles.join('、') }}</strong>：{{ item.reason }}</p><blockquote v-if="item.quote">{{ item.quote }}</blockquote></div></details>
    </div>
    <div class="knowledge-manager__workspace">
      <aside class="knowledge-manager__directory">
        <el-tabs v-model="version" class="knowledge-manager__versions">
          <el-tab-pane label="已上线版本" name="published" />
          <el-tab-pane label="草稿" name="draft" />
        </el-tabs>
        <div v-if="canEdit" class="knowledge-manager__tools">
          <el-button :icon="Plus" :disabled="busy" @click="choose()">上传资料</el-button>
          <el-button text :disabled="busy||!articles.length" @click="selecting=!selecting">{{ selecting?'退出批量':'批量管理' }}</el-button>
        </div>
        <el-input v-model="keyword" placeholder="查找目录或文章" :prefix-icon="Search" clearable aria-label="查找目录" />
        <div v-if="canEdit&&selecting" class="knowledge-manager__tools">
          <el-checkbox :model-value="allChecked" @change="checkAll">全选文章</el-checkbox>
          <el-button link type="danger" :disabled="!checked.length||busy" @click="remove(checked)">删除 {{ checked.length || '' }}</el-button>
        </div>
        <el-scrollbar class="knowledge-manager__scroll">
          <el-tree ref="treeRef" :data="tree" node-key="id" :show-checkbox="canEdit&&selecting" :check-strictly="true" :props="{label:'title',disabled:'disabled'}"
            :current-node-key="selectedId" :filter-node-method="matches" default-expand-all highlight-current :expand-on-click-node="false" @node-click="select" @check="checkedChanged">
            <template #default="{data:item}">
              <span class="knowledge-manager__node" :class="{'is-deleted':item.pendingDelete}">
                <el-icon><Folder v-if="item.kind==='folder'"/><Document v-else/></el-icon>
                <span class="knowledge-manager__node-title" :title="item.title">{{ item.title }}</span><span v-if="item.operation" class="knowledge-manager__node-state" :class="'is-'+item.operation">{{ operationNames[item.operation] }}</span>
              </span>
            </template>
          </el-tree>
          <el-empty v-if="!tree.length" :description="isDraft?'暂无草稿文章':'暂无已上线文章'" :image-size="60" />
        </el-scrollbar>
        <input ref="picker" type="file" hidden accept=".md,.txt,.pdf,.docx,.xlsx" multiple @change="upload" />
      </aside>
      <section class="knowledge-manager__reader">
        <template v-if="selected">
          <header class="knowledge-manager__article-heading">
            <div class="knowledge-manager__article-title">
              <span class="knowledge-manager__document-icon"><el-icon><Folder v-if="selected.kind==='folder'"/><Document v-else/></el-icon></span>
              <div class="knowledge-manager__article-label">
                <div class="knowledge-manager__breadcrumb"><el-icon><FolderOpened /></el-icon><span v-for="(title,index) in selectedPath" :key="index">{{ title }}<span v-if="index<selectedPath.length-1" class="knowledge-manager__separator">/</span></span></div>
                <h2>{{ selected.title }}</h2>
                <span class="knowledge-manager__state" :class="{'is-draft':selectedOperation,'is-deleted':selected.pendingDelete}"><span></span>{{ selected.pendingDelete?'已移出草稿':selectedOperation?operationNames[selectedOperation]+' · 待发布':'已发布' }}</span>
              </div>
            </div>
            <el-radio-group v-if="selectedOperation" v-model="readerMode" class="knowledge-manager__reader-mode" size="small" aria-label="文章预览">
              <el-radio-button value="compare">改动对比</el-radio-button>
              <el-radio-button value="content">{{ selected.pendingDelete?'删除前内容':'当前内容' }}</el-radio-button>
            </el-radio-group>
            <div v-if="canEdit&&selected.kind==='article'&&!selected.pendingDelete" class="knowledge-manager__article-actions">
              <el-button class="knowledge-manager__beautify" :icon="MagicStick" :disabled="busy" @click="beautify(selected)">优化这篇</el-button>
              <el-dropdown trigger="click" @command="operate">
              <el-button text :disabled="busy">更多操作<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
              <template #dropdown><el-dropdown-menu>
                <el-dropdown-item command="download">下载 Markdown</el-dropdown-item>
                <el-dropdown-item command="replace">上传替换文章</el-dropdown-item>
                <el-dropdown-item command="delete" divided>删除文章</el-dropdown-item>
              </el-dropdown-menu></template>
              </el-dropdown>
            </div>
          </header>
          <el-scrollbar class="knowledge-manager__scroll">
            <section v-if="selectedOperation&&readerMode==='compare'" class="knowledge-manager__comparison">
              <p v-if="selectedReason" class="knowledge-manager__reason">{{ selectedReason }}</p>
              <ChangeComparison :before="beforeNode" :change="{...selected,operation:selected.pendingDelete?'delete':beforeNode?'update':'add'}" :before-path="nodePath(beforeNode?.parentId,beforeNodes)" :after-path="nodePath(selected.parentId,library?.nodes||[])" :before-label="beforeLabel" :after-label="selected.pendingDelete?'已移出草稿':'当前草稿'" />
              <section v-if="selectedExclusions.length" class="knowledge-manager__exclusions"><strong>剔除与合并说明</strong><div v-for="(item,index) in selectedExclusions" :key="index"><p>{{ item.reason }}</p><blockquote v-if="item.quote">{{ item.quote }}</blockquote></div></section>
            </section>
            <article v-else class="knowledge-manager__article">
              <div v-if="selected.summary" class="knowledge-manager__summary"><span>内容提要</span><p>{{ selected.summary }}</p></div>
              <KnowledgeArticle v-if="selected.text" :content="selected.text" :title="selected.title" />
              <div v-else class="knowledge-manager__links">
                <button v-for="child in directChildren" :key="child.id" type="button" @click="selectedId=child.id"><el-icon><Folder v-if="child.kind==='folder'"/><Document v-else/></el-icon><span>{{ child.title }}</span><el-icon><ArrowRight /></el-icon></button>
              </div>
              <footer v-if="selected.sources.length" class="knowledge-manager__sources"><span>资料来源</span><div><span v-for="source in selectedSources" :key="source"><el-icon><Document /></el-icon>{{ source }}</span></div></footer>
            </article>
          </el-scrollbar>
        </template>
        <el-empty v-else description="选择左侧文章查看内容" />
      </section>
    </div>
    <PublishDialog ref="publishDialog" />
    <UploadIssuesDialog ref="uploadIssuesDialog" />
  </section>
</template>
<script setup lang="ts">
import {computed,onScopeDispose,ref,watch} from 'vue'
import {ElMessage,ElTree} from 'element-plus'
import {Document,Folder,FolderOpened,Plus,Search,MagicStick,Upload,ArrowDown,ArrowRight,Loading} from '@element-plus/icons-vue'
import {useResource} from '@/hooks/useResource'
import {useAuthStore} from '@/stores/auth'
import {request} from '@/api/request'
import {confirmAction} from '@/utils/forms'
import ChangeComparison from '../ChangeComparison/index.vue'
import {knowledgeOperation} from '../../operations'
import PublishDialog from '../PublishDialog/index.vue'
import UploadIssuesDialog from '../UploadIssuesDialog/index.vue'
import KnowledgeArticle from '../KnowledgeArticle/index.vue'
import type {KnowledgeNode,KnowledgeResponse,KnowledgeLibrary,KnowledgeUpload,KnowledgeUploadIssue} from '../../types'
defineProps<{canTest:boolean}>()
const emit=defineEmits<{test:[]}>()
type TreeNode=KnowledgeNode&{children:TreeNode[];operation:string;disabled:boolean}
const {data,loading,error,load}=useResource<KnowledgeResponse>(()=>'/admin/knowledge'),auth=useAuthStore()
const treeRef=ref<InstanceType<typeof ElTree>>(),picker=ref<HTMLInputElement>(),publishDialog=ref<InstanceType<typeof PublishDialog>>()
const uploadIssuesDialog=ref<InstanceType<typeof UploadIssuesDialog>>()
const pendingUploadIds=new Set<string>()
const version=ref('draft'),beautifying=ref(false),readerMode=ref('compare')
const isDraft=computed(()=>version.value==='draft')
let beautifyController:AbortController|undefined
const selectedId=ref(''),keyword=ref(''),selecting=ref(false),checked=ref<string[]>([]),uploading=ref(false),mutating=ref(false),actionError=ref(''),uploadProgress=ref(''),replacement=ref<KnowledgeNode>()
const versionMismatch=computed(()=>Boolean(data.value&&!data.value.library))
const library=computed(()=>data.value?.library),canWrite=computed(()=>auth.can('knowledge:write')&&!versionMismatch.value)
const canEdit=computed(()=>isDraft.value&&canWrite.value)
const uploads=computed(()=>data.value?.uploads||[])
const processingCount=computed(()=>uploads.value.filter(job=>job.status==='pending'||job.status==='processing').length)
const busy=computed(()=>versionMismatch.value||beautifying.value||uploading.value||mutating.value||processingCount.value>0)
const beforeNodes=computed(()=>library.value?.publishedNodes||[])
const nodes=computed(()=>isDraft.value
  ? [...(library.value?.nodes||[]),...(library.value?.deleted||[]).map(node=>({...node,pendingDelete:true}))]
  : beforeNodes.value)
const articles=computed(()=>nodes.value.filter(node=>node.kind==='article'&&!node.pendingDelete))
const allChecked=computed(()=>articles.value.length>0&&checked.value.length===articles.value.length)
const selected=computed(()=>nodes.value.find(node=>node.id===selectedId.value))
const selectedPath=computed(()=>nodePath(selected.value?.parentId,nodes.value).split(' / '))
const selectedOperation=computed(()=>selected.value?operation(selected.value.id):'')
const beforeNode=computed(()=>beforeNodes.value.find(node=>node.id===selectedId.value))
const beforeLabel='已发布版本'
const selectedReason=computed(()=>library.value?.review?.changes.find(change=>change.id===selectedId.value)?.reason||'')
const selectedExclusions=computed(()=>(library.value?.review?.exclusions||[]).filter(item=>item.sourceNodeIds.includes(selectedId.value)))
function nodePath(parentId:string|null|undefined,items:KnowledgeNode[]){
  const titles:string[]=[],seen=new Set<string>();let id=parentId
  while(id&&!seen.has(id)){seen.add(id);const node=items.find(node=>node.id===id);if(!node)break;titles.unshift(node.title);id=node.parentId}
  return ['知识目录',...titles].join(' / ')
}
const selectedSources=computed(()=>[...new Set((selected.value?.sources||[]).map(source=>{
  const location=source.page?'第 '+source.page+' 页':source.sheet?source.sheet:source.lineStart?'第 '+source.lineStart+' 行':''
  return source.filename+(location?' · '+location:'')
}))])
const directChildren=computed(()=>nodes.value.filter(node=>node.parentId===selectedId.value))
const operationNames:Record<string,string>={add:'新增',update:'修改',delete:'删除'}
function operation(id:string){if(!isDraft.value)return '';return library.value?.changes.find(change=>change.id===id)?.operation||(nodes.value.some(node=>node.id===id&&node.pendingDelete)?'delete':'')}
const tree=computed(()=>{
  const mapped=new Map(nodes.value.map(node=>[node.id,{...node,children:[] as TreeNode[],operation:operation(node.id),disabled:node.kind!=='article'||Boolean(node.pendingDelete)}]))
  const roots:TreeNode[]=[]
  for(const node of mapped.values()){const parent=node.parentId&&mapped.get(node.parentId);if(parent)parent.children.push(node);else roots.push(node)}
  return roots
})
function matches(value:string,node:Record<string,unknown>){return String(node.title||'').toLocaleLowerCase().includes(value.toLocaleLowerCase())}
function select(node:TreeNode){selectedId.value=node.id;readerMode.value='compare'}
function checkedChanged(){checked.value=(treeRef.value?.getCheckedNodes()||[]).filter(node=>node.kind==='article'&&!node.pendingDelete).map(node=>String(node.id))}
function checkAll(){checked.value=allChecked.value?[]:articles.value.map(node=>node.id);treeRef.value?.setCheckedKeys(checked.value)}
function isUploadFailed(job:KnowledgeUpload){
  return job.status==='failed'||job.status==='needs_recognition'
}
function uploadIssue(job:KnowledgeUpload):KnowledgeUploadIssue{
  return {
    filename:job.filename,
    reason:job.error||'处理失败，请重试',
    stage:job.status==='needs_recognition'?'待文字识别':'已上传 · 处理失败',
    retry:job.status==='failed'?()=>void retry(job.id):undefined,
    remove:()=>void removeUpload(job.id),
  }
}
function checkUploadResults(){
  if(uploading.value||!data.value||!pendingUploadIds.size)return
  const jobs=data.value.uploads.filter(job=>pendingUploadIds.has(job.id))
  const finished=jobs.filter(job=>job.status==='ready'||isUploadFailed(job))
  if(finished.length!==pendingUploadIds.size)return
  pendingUploadIds.clear()
  const issues=finished.filter(isUploadFailed).map(uploadIssue)
  if(issues.length)uploadIssuesDialog.value?.open(issues)
}
function textUploadIssue(file:File,bytes:Uint8Array):KnowledgeUploadIssue|undefined{
  if(!/\.(md|txt)$/i.test(file.name))return
  const issue={filename:file.name,stage:'上传前校验'}
  let text
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
  catch{return {...issue,reason:'文件不是 UTF-8 编码，请另存为 UTF-8 后重新上传'}}
  if(!text.trim())return {...issue,reason:'正文为空，请补充内容后重新上传'}
  const invalid=text.indexOf('\0')
  if(invalid===-1)return
  const lines=text.split(/\r\n|\r|\n/)
  const index=lines.findIndex(line=>line.includes('\0'))
  const offset=lines[index].indexOf('\0')
  const before=lines[index].slice(0,offset),after=lines[index].slice(offset+1)
  const start=Math.max(0,index-1)
  const excerpt=lines.slice(start,index+2).map((line,position)=>{
    const number=start+position+1
    if(number!==index+1)return {line:number,text:line.slice(0,180)+(line.length>180?'…':'')}
    return {line:number,text:(before.length>120?'…':'')+before.slice(-120),afterMarker:after.slice(0,120)+(after.length>120?'…':'')}
  })
  return {
    ...issue,
    location:'第 '+(index+1)+' 行第 '+([...before].length+1)+' 列有空字符',
    reason:'请删除标记处的字符，保存为 UTF-8 后重新上传。',
    excerpt,
  }
}
function choose(node?:KnowledgeNode){replacement.value=node;if(picker.value){picker.value.multiple=!node;picker.value.click()}}
async function upload(event:Event){
  const input=event.target as HTMLInputElement,files=Array.from(input.files||[]);input.value='';if(!files.length)return
  uploading.value=true;actionError.value=''
  let completed=0,skipped=0
  const issues:KnowledgeUploadIssue[]=[]
  try{
    for(const file of files){
      uploadProgress.value='正在上传 '+file.name
      let stage='上传前校验'
      try{
        if(!/\.(md|txt|pdf|docx|xlsx)$/i.test(file.name))throw new Error('支持 Markdown、TXT、PDF、DOCX 和 XLSX')
        if(!file.size)throw new Error('文件不能为空')
        const uploadLimit=data.value?.limits?.uploadBytes
        if(uploadLimit&&file.size>uploadLimit)throw new Error('文件超过上传上限，请拆分后上传')
        const bytes=new Uint8Array(await file.arrayBuffer())
        const issue=textUploadIssue(file,bytes)
        if(issue){issues.push(issue);continue}
        let binary=''
        for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
        stage='上传请求失败'
        const result=await request<KnowledgeUpload&{skipped?:boolean}>('/admin/knowledge/upload','POST',{title:replacement.value?.title||file.name.replace(/\.[^.]+$/,''),filename:file.name,mime:file.type,data:btoa(binary),...(replacement.value?{targetId:replacement.value.id,expectedRevision:library.value?.revision}:{})})
        if(isUploadFailed(result))issues.push(uploadIssue(result))
        else{
          if(result.status!=='ready')pendingUploadIds.add(result.id)
          if(result.skipped)skipped++
          else completed++
        }
      }catch(cause){issues.push({filename:file.name,stage,reason:cause instanceof Error?cause.message:'请重试'})}
    }
    if(issues.length)uploadIssuesDialog.value?.open(issues)
    if(completed||skipped){
      const results:string[]=[]
      if(completed)results.push('已接收 '+completed+' 份，等待解析和整理')
      if(skipped)results.push('已跳过 '+skipped+' 份重复资料')
      ElMessage({message:results.join('；'),type:issues.length?'warning':'success'})
      await load()
    }
  }finally{
    uploading.value=false;replacement.value=undefined;uploadProgress.value=''
    checkUploadResults()
  }
}
async function beautify(node?:KnowledgeNode){
  if(!library.value||busy.value)return
  beautifying.value=true;actionError.value='';beautifyController=new AbortController()
  try{
    const result=await knowledgeOperation<{library:KnowledgeLibrary;changed:boolean;warnings:string[]}>('/admin/knowledge/beautify',{revision:library.value.revision,nodeId:node?.id},beautifyController.signal)
    if(data.value)data.value={...data.value,library:result.library}
    readerMode.value='compare'
    if(!result.changed){ElMessage.info(result.warnings[0]||'当前内容无需调整');return}
    ElMessage.success('AI 优化已保存为草稿，可在目录中查看改动')
  }catch(cause){if(!beautifyController.signal.aborted)actionError.value=cause instanceof Error?cause.message:'美化失败'}
  finally{beautifying.value=false}
}
function publish(){
  if(library.value)publishDialog.value?.open({revision:library.value.revision,changes:library.value.changes},()=>void load(),()=>beautify())
}
async function remove(ids:string[]){
  if(!library.value)return
  const revision=library.value.revision
  try{
    const impact=await request<{count:number;titles:string[]}>('/admin/knowledge/articles/delete/preview','POST',{ids,revision})
    await confirmAction('将删除 '+impact.count+' 篇文章（含下级文章）：'+impact.titles.join('、')+'。相关目录将一并调整，发布全部后生效。',async()=>{
    mutating.value=true
    try{await request('/admin/knowledge/articles/delete','POST',{ids,revision});checked.value=[];treeRef.value?.setCheckedKeys([]);await load();ElMessage.success('删除已保存为草稿')}
    finally{mutating.value=false}
  })}catch(cause){actionError.value=cause instanceof Error?cause.message:'删除失败'}
}
async function retry(id:string){
  try{
    await request('/admin/knowledge/'+id+'/retry','POST')
    pendingUploadIds.add(id)
    await load()
  }catch(cause){actionError.value=cause instanceof Error?cause.message:'重试失败'}
}
async function removeUpload(id:string){try{await request('/admin/knowledge/uploads/'+id,'DELETE');await load()}catch(cause){actionError.value=cause instanceof Error?cause.message:'移除失败'}}
async function operate(command:string){
  const node=selected.value;if(!node)return
  if(command==='replace'){choose(node);return}
  if(command==='delete'){await remove([node.id]);return}
  if(command==='download'){
    try{
      const result=await request<{filename:string;content:string}>('/admin/knowledge/articles/export','POST',{id:node.id})
      const url=URL.createObjectURL(new Blob([result.content],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a')
      link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(cause){actionError.value=cause instanceof Error?cause.message:'下载失败'}
  }
}
let timer:ReturnType<typeof setTimeout>|undefined
watch(keyword,value=>treeRef.value?.filter(value))
watch(version,()=>{
  selecting.value=false;checked.value=[];treeRef.value?.setCheckedKeys([])
  keyword.value='';readerMode.value='compare'
})
watch(nodes,()=>{
  if(!nodes.value.some(node=>node.id===selectedId.value))selectedId.value=articles.value[0]?.id||nodes.value[0]?.id||''
})
watch(data,checkUploadResults)
watch(loading,value=>{clearTimeout(timer);if(!value&&processingCount.value)timer=setTimeout(()=>void load(),2000)})
onScopeDispose(()=>{clearTimeout(timer);beautifyController?.abort()})
</script>
<style scoped lang="scss">
.knowledge-manager{
  display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0;flex:1;
  &__toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:49px;padding:0 2px 9px}
  &__title{display:flex;align-items:center;gap:9px;margin:0;font-size:17px;font-weight:600;white-space:nowrap;
    &::before{content:'';width:3px;height:17px;border-radius:2px;background:var(--el-color-primary)}
  }
  &__separator{margin:0 10px;color:var(--el-text-color-placeholder)}
  &__actions,&__tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;:deep(.el-button+.el-button){margin-left:0}}
  &__actions{justify-content:flex-end;flex-shrink:0;:deep(.el-button){border-radius:7px;height:34px}}
  &__test{color:var(--el-text-color-secondary);padding-inline:9px}
  &__changes{font-size:12px;:deep(>span){gap:6px}}
  &__beautify:not(.is-disabled){color:var(--el-color-primary);border-color:var(--el-color-primary-light-8);background:linear-gradient(120deg,var(--el-color-primary-light-9),var(--el-bg-color))}
  &__workspace{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:0;grid-row:3;border:1px solid var(--el-border-color-lighter);border-radius:10px;overflow:hidden}
  &__directory,&__reader{display:flex;flex-direction:column;min-height:0;min-width:0}
  &__directory{gap:9px;padding:10px 12px 12px;background:var(--el-fill-color-lighter);border-right:1px solid var(--el-border-color-lighter);
    >.el-input{padding:0 4px;box-sizing:border-box}
    :deep(.el-input__wrapper){background:var(--el-bg-color);border-radius:6px}
    :deep(.el-tree){background:transparent;--el-tree-node-hover-bg-color:var(--el-fill-color-light)}
    :deep(.el-tree-node__content){height:31px;margin:2px 0;border-radius:6px;padding-right:10px}
    :deep(.el-tree-node.is-current>.el-tree-node__content){color:var(--el-color-primary);background:var(--el-color-primary-light-9);font-weight:500}
    :deep(.el-tree-node__expand-icon){color:var(--el-text-color-placeholder)}
  }
  &__versions{
    :deep(.el-tabs__header){margin:0}
    :deep(.el-tabs__item){height:35px;padding-inline:13px;font-size:13px}
  }
  &__tools{padding:0 4px;gap:6px;:deep(.el-button){height:29px;padding-inline:10px;border-radius:6px;font-size:12px}}
  &__reader{padding:12px 20px 0;gap:10px;background:var(--el-bg-color)}
  &__scroll{flex:1;min-height:0}
  &__node{display:flex;align-items:center;gap:8px;min-width:0;width:100%;font-size:13px;
    >.el-icon{flex-shrink:0;color:var(--el-text-color-secondary)}
    &.is-deleted .knowledge-manager__node-title{text-decoration:line-through;color:var(--el-text-color-placeholder)}
  }
  &__node-state{margin-left:auto;font-size:10px;flex-shrink:0;line-height:1.8;&.is-add{color:var(--el-color-success)}&.is-update{color:var(--el-color-warning)}&.is-delete{color:var(--el-color-danger)}}
  &__status{display:grid;gap:10px}
  &__processing{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:var(--el-color-primary);font-size:13px}
  &__notices{font-size:12px;color:var(--el-text-color-secondary);margin-bottom:14px;summary{cursor:pointer}p{line-height:1.8}}
  &__comparison{padding-right:12px}
  &__reason{margin:2px 0 8px;padding:7px 10px;border-radius:6px;background:var(--el-color-primary-light-9);font-size:12px;line-height:1.8;color:var(--el-text-color-regular)}
  &__exclusions{padding:14px;background:var(--el-color-warning-light-9);border-radius:6px;font-size:12px;line-height:1.8;blockquote{margin:8px 0;border-left:2px solid var(--el-border-color);padding-left:12px;white-space:pre-wrap}}
  &__node-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  &__dot{width:5px;height:5px;flex-shrink:0;border-radius:50%;background:var(--el-color-primary)}
  &__breadcrumb{display:flex;align-items:center;flex-wrap:wrap;gap:7px;font-size:12px;color:var(--el-text-color-secondary);.knowledge-manager__separator{margin:0 2px 0 8px}}
  &__article-heading{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--el-border-color-lighter);
    h2{margin:3px 0 1px;font-size:19px;line-height:1.35;font-weight:600;overflow-wrap:anywhere}
    :deep(.el-button){height:29px;padding-inline:10px;font-size:12px}
  }
  &__article-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;:deep(.el-button){border-radius:6px}}
  &__article-title{display:flex;flex:1;align-items:center;gap:10px;min-width:0}
  &__article-label{min-width:0}
  &__document-icon{display:grid;place-items:center;width:34px;height:37px;border:1px solid var(--el-border-color-lighter);border-radius:8px;background:var(--el-fill-color-lighter);color:var(--el-color-primary);font-size:17px;flex-shrink:0}
  &__state{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--el-text-color-secondary);>span{width:5px;height:5px;background:var(--el-color-success);border-radius:50%}&.is-draft>span{background:var(--el-color-warning)}&.is-deleted>span{background:var(--el-color-danger)}}
  &__article{max-width:800px;padding:0 16px 32px 0;line-height:1.8}
  &__summary{padding:14px 18px;border-radius:7px;background:var(--el-fill-color-lighter);margin-bottom:26px;>span{font-size:11px;letter-spacing:1px;color:var(--el-text-color-secondary)}p{margin:4px 0 0;font-size:13px;color:var(--el-text-color-regular)}}
  &__links{display:grid;gap:8px;button{display:flex;align-items:center;gap:10px;padding:14px;border:1px solid var(--el-border-color-lighter);border-radius:7px;background:var(--el-bg-color);color:var(--el-text-color-regular);text-align:left;font:inherit;cursor:pointer;span{flex:1}&:hover{border-color:var(--el-color-primary-light-7);color:var(--el-color-primary)}}}
  &__sources{margin-top:36px;padding-top:18px;border-top:1px solid var(--el-border-color-lighter);font-size:12px;color:var(--el-text-color-secondary);>div{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px;>span{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--el-border-color-lighter);border-radius:5px;background:var(--el-fill-color-lighter);overflow-wrap:anywhere}}}
  @media(max-width:1100px){
    &__workspace{grid-template-columns:230px minmax(0,1fr)}
    &__article-heading{flex-wrap:wrap}
    &__article-title{flex-basis:100%}
  }
  @media(max-width:760px){
    &__toolbar{align-items:flex-start;flex-wrap:wrap}
    &__actions{flex-shrink:1;justify-content:flex-start}
    &__workspace{grid-template-columns:1fr;grid-template-rows:minmax(125px,35%) minmax(0,1fr)}
    &__directory{border-right:0;border-bottom:1px solid var(--el-border-color-lighter)}
    &__reader{padding-inline:12px}
  }
}
</style>
