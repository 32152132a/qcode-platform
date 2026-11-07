<template>
  <PagePanel title="企业知识库" description="上传资料，整理完成后可直接查看，确认无误后一键发布。" :loading="loading&&!data" :error="error">
    <template #actions><template v-if="auth.can('knowledge:write')"><el-button :disabled="!ready.length||Boolean(processing)||publishing||editing" :loading="publishing" type="primary" @click="publishReady">一键发布</el-button><el-button :disabled="Boolean(processing)||publishing||editing" @click="choose()">上传资料</el-button></template><input ref="picker" type="file" accept=".md,.txt,.pdf,.docx,.xlsx" hidden multiple @change="upload" /></template>
    <el-alert v-if="uploadError" :title="uploadError" type="error" :closable="false" />
    <KnowledgeWorkspace ref="workspace" :documents="data?.documents||[]" :processing="processing" :can-write="auth.can('knowledge:write')&&!publishing" @changed="load" @replace="choose" @editing="editing=$event" />
  </PagePanel>
</template>
<script setup lang="ts">
import {computed,onScopeDispose,ref,watch} from 'vue'
import {ElMessage} from 'element-plus'
import PagePanel from '@/components/PagePanel/index.vue'
import KnowledgeWorkspace from './components/KnowledgeWorkspace/index.vue'
import {useResource} from '@/hooks/useResource'
import {useAuthStore} from '@/stores/auth'
import {request} from '@/api/request'
import {confirmAction} from '@/utils/forms'
import type {KnowledgeDocument,KnowledgeProgress} from './types'
const auth=useAuthStore(),{data,loading,error,load}=useResource<{documents:KnowledgeDocument[]}>(()=>'/admin/knowledge')
const picker=ref<HTMLInputElement>(),workspace=ref<InstanceType<typeof KnowledgeWorkspace>>(),uploading=ref(false),publishing=ref(false),editing=ref(false),uploadError=ref(''),replacement=ref<KnowledgeDocument>()
const batch=ref<{total:number;sent:number;filename:string;skipped:number;failures:string[];documents:{id:string;revision:string}[]}>()
const ready=computed(()=>(data.value?.documents||[]).filter(row=>row.status==='ready'&&row.draft_revision!==row.published_revision))
const processing=computed<KnowledgeProgress|undefined>(()=>{
 const documents=data.value?.documents||[],pending=documents.filter(row=>['pending','processing'].includes(row.status)),current=batch.value
 if(uploading.value&&current)return{stage:'uploading',completed:current.sent,total:current.total,filename:current.filename,failed:current.failures.length}
 if(!pending.length)return undefined
 const tracked=current&&pending.every(row=>current.documents.some(item=>item.id===row.id&&item.revision===row.draft_revision))?current:undefined
 const items=tracked?tracked.documents.map(item=>documents.find(row=>row.id===item.id&&row.draft_revision===item.revision)).filter((row):row is KnowledgeDocument=>Boolean(row)):documents.filter(row=>row.draft_revision!==row.published_revision)
 const completed=items.filter(row=>['ready','failed'].includes(row.status)).length
 return{stage:'parsing',completed:completed+(tracked?tracked.skipped+tracked.failures.length:0),total:tracked?.total||items.length,filename:(pending.find(row=>row.status==='processing')||pending[0])!.filename,failed:items.filter(row=>row.status==='failed').length+(tracked?.failures.length||0)}
})
function choose(row?:KnowledgeDocument){if(processing.value||publishing.value||editing.value)return;replacement.value=row;if(picker.value){picker.value.multiple=!row;picker.value.click()}}
async function upload(event:Event){
 const input=event.target as HTMLInputElement,files=Array.from(input.files||[]);input.value='';if(!files.length)return
 uploading.value=true;uploadError.value='';const current={total:files.length,sent:0,filename:'',skipped:0,failures:[] as string[],documents:[] as {id:string;revision:string}[]};batch.value=current;let uploaded=0
 try{for(const [index,file]of files.entries()){
  batch.value.filename=file.name
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
   const result=await request<KnowledgeDocument&{skipped?:boolean}>('/admin/knowledge/upload','POST',{id:replacement.value?.id,title:replacement.value?.title||file.name.replace(/\.[^.]+$/,''),filename:file.name,mime:file.type,data:btoa(binary)})
   if(result.skipped)batch.value.skipped++;else{uploaded++;batch.value.documents.push({id:result.id,revision:result.draft_revision})}
  }catch(cause){batch.value.failures.push(file.name+'：'+(cause instanceof Error?cause.message:'上传失败'))}
  batch.value.sent=index+1
 }
 uploadError.value=batch.value.failures.join('；');ElMessage.info(`已上传${uploaded}份${batch.value.skipped?`，跳过相同文件${batch.value.skipped}份`:''}${batch.value.failures.length?`，失败${batch.value.failures.length}份`:''}`);await load()
 }finally{uploading.value=false;replacement.value=undefined}
}
async function publishReady(){
 const items=ready.value.map(row=>({id:row.id,revision:row.draft_revision})),changes=ready.value.reduce((sum,row)=>sum+row.changes,0)
 if(!items.length||processing.value||editing.value)return
 const failed=(data.value?.documents||[]).filter(row=>row.status==='failed').length
 publishing.value=true
 try{await confirmAction(`确认发布${items.length}份资料${changes?`及${changes}项内容更新`:''}？${failed?`另有${failed}份处理失败，不包含在本次发布中。`:''}`,async()=>{await request('/admin/knowledge/publish','POST',{documents:items});ElMessage.success('已发布，用户现在可以使用这些资料');await load()})}
 catch(cause){uploadError.value=cause instanceof Error?cause.message:'发布失败'}finally{publishing.value=false}
}
let timer:ReturnType<typeof setTimeout>|undefined
watch(loading,busy=>{clearTimeout(timer);if(!busy&&data.value?.documents.some(row=>['pending','processing'].includes(row.status)))timer=setTimeout(()=>void load(),3000)})
watch(()=>Boolean(processing.value),(busy,previous)=>{if(previous&&!busy){const first=batch.value?.documents[0];if(first)void workspace.value?.open(first.id)}})
onScopeDispose(()=>clearTimeout(timer))
</script>
