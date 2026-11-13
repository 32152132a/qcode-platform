<template>
  <PagePanel title="能力配置" description="配置知识整理、向量、识图和生图服务。" :loading="loading" :error="error">
    <template #actions><el-button @click="load">刷新</el-button></template>
    <el-scrollbar><div class="capability-grid"><CapabilityCard v-for="item in entries" :key="item.kind" :kind="item.kind" :title="item.title" :description="item.description" :sources="sources" :models="models" :value="values[item.kind]" :can-write="auth.can('models:write')" @saved="load" /></div></el-scrollbar>
  </PagePanel>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import PagePanel from '@/components/PagePanel/index.vue'
import CapabilityCard from './components/CapabilityCard/index.vue'
import {request} from '@/api/request'
import {useAuthStore} from '@/stores/auth'
import type {Model,ModelSource} from '@/types/models'
import type {Row} from '@/types'
const auth=useAuthStore(),loading=ref(false),error=ref(''),sources=ref<ModelSource[]>([]),models=ref<Model[]>([]),values=ref<Record<string,Row>>({})
const entries=[
 {kind:'knowledge',title:'知识整理模型',description:'用于上传资料的目录和摘要生成，默认优先选择千问 Max。摘要最多100字；切换模型只影响后续处理。'},
 {kind:'embedding',title:'向量模型',description:'用于文档入库和知识库检索。验证会发送一小段测试文本；更换模型需要重建知识库索引。'},
 {kind:'vision',title:'识图模型',description:'当前对话模型无法识图时使用的默认识图服务。'},
 {kind:'image_generation',title:'生图模型',description:'为对话提供图片生成服务；当前接入需支持兼容的图片生成接口。'},
]
async function load(){
 loading.value=true;error.value=''
 try{
  const [sourceList,modelList,images,embedding,knowledge]=await Promise.all([request<ModelSource[]>('/admin/models/sources'),request<Model[]>('/admin/models'),request<Row>('/admin/models/images/settings'),request<Row|null>('/admin/models/embeddings/settings'),request<Row>('/admin/knowledge/settings')])
  sources.value=sourceList;models.value=modelList
  const vision=modelList.find(model=>model.id===images.visionModelId)
  const image=modelList.find(model=>model.id===images.modelId)||modelList.find(model=>model.source_id===images.sourceId&&model.upstream_model===images.model)
  values.value={knowledge,embedding:embedding||{},vision:{sourceId:vision?.source_id||'',modelId:vision?.id||''},image_generation:{sourceId:images.sourceId||'',modelId:image?.id||'',dailyImagesPerUser:images.dailyImagesPerUser}}
 }catch(cause){error.value=cause instanceof Error?cause.message:'读取配置失败'}finally{loading.value=false}
}
void load()
</script>

<style scoped lang="scss">
.capability-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr));
  gap: var(--admin-gap);
  max-width: 68rem;
  padding-bottom: var(--admin-gap);
}
</style>
