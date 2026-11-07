<template>
  <el-card class="capability-card" shadow="never">
    <template #header><strong>{{ title }}</strong></template>
    <p>{{ description }}</p>
    <QyqForm ref="form" v-model="selection" :form-options="fields" :columns="2" :show-btn="false" :disabled="saving || !canWrite" @change="changed">
      <template #model><el-select v-model="selection.model" filterable allow-create default-first-option placeholder="选择或输入模型ID"><el-option v-for="item in textOptions" :key="item.id" :label="item.id" :value="item.id" /></el-select></template>
    </QyqForm>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-text v-if="kind === 'embedding' && value?.dimensions" type="info">当前向量维度：{{ value.dimensions }}</el-text>
    <el-button v-if="canWrite" type="primary" :loading="saving" @click="save">{{ textModel ? '验证并保存' : '保存' }}</el-button>
  </el-card>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import QyqForm from '@/components/qyq-form/index.vue'
import {request} from '@/api/request'
import type {Model,ModelSource} from '@/types/models'
import type {Row,Field} from '@/types'
const props=defineProps<{kind:string;title:string;description:string;sources:ModelSource[];models:Model[];value?:Row;canWrite:boolean}>()
const emit=defineEmits<{saved:[]}>()
const selection=ref<Row>({}),saving=ref(false),error=ref(''),form=ref<{validate:()=>Promise<boolean>}>()
const source=computed(()=>props.sources.find(source=>source.id===selection.value.sourceId))
const textModel=computed(()=>['embedding','knowledge'].includes(props.kind))
const textOptions=computed(()=>source.value?.catalog?.filter(model=>props.kind==='embedding'?model.capabilities?.includes('embedding'):!model.capabilities?.some(value=>['embedding','image_generation'].includes(value)))||[])
const candidates=computed(()=>props.models.filter(model=>model.source_id===selection.value.sourceId&&model.catalog_available!==false&&(props.kind==='vision'?model.model_type!=='image'&&model.capabilities?.includes('vision'):model.model_type==='image'||model.capabilities?.includes('image_generation'))))
const fields=computed<Field[]>(()=>[
 {prop:'sourceId',label:'渠道',type:'select',required:true,options:props.sources.filter(source=>source.active).map(source=>({label:source.name,value:source.id}))},
 textModel.value?{prop:'model',label:props.kind==='embedding'?'向量模型':'整理模型',type:'custom',required:true}:{prop:'modelId',label:'模型',type:'select',required:true,options:candidates.value.map(model=>({label:model.name,value:model.id}))},
 ...(props.kind==='image_generation'?[{prop:'dailyImagesPerUser',label:'每人每日生图张数',type:'number',min:1,max:1000}]:[]),
].map(field=>({...field,allowSpecialChars:true})))
async function save(){
 if(saving.value||!await form.value?.validate())return
 saving.value=true;error.value=''
 const previous=props.value||{},model=String(selection.value.model||'').trim()
 const changing=textModel.value
  ? Boolean(previous.model&&(previous.sourceId!==selection.value.sourceId||previous.model!==model))
  : Boolean(previous.modelId&&previous.modelId!==selection.value.modelId)
 if(changing){
  try{await ElMessageBox.confirm(
   props.kind==='embedding'?'更换向量模型或渠道后，已有知识库索引将无法匹配，需要重新向量化后才能检索。文档原文保留，重建可能产生接口费用。是否继续更换？':'更换后，后续请求将使用新的'+props.title+'。是否继续？',
   '确认更换'+props.title,{type:'warning',confirmButtonText:'确认更换',cancelButtonText:'取消',closeOnClickModal:false}
  )}catch{saving.value=false;return}
 }
 try{
  if(textModel.value)await request(props.kind==='embedding'?'/admin/models/embeddings/settings':'/admin/knowledge/settings','PUT',{sourceId:selection.value.sourceId,model,confirmChange:changing})
  else await request('/admin/models/'+selection.value.modelId+'/purpose','POST',{purpose:props.kind,...(props.kind==='image_generation'?{dailyImagesPerUser:Number(selection.value.dailyImagesPerUser||10)}:{})})
  ElMessage.success('配置已保存');emit('saved')
 }catch(cause){error.value=cause instanceof Error?cause.message:'保存失败'}finally{saving.value=false}
}
watch(()=>props.value,value=>{selection.value={...value}},{immediate:true})
function changed(_value:unknown,prop:string){if(prop==='sourceId'){selection.value.modelId='';selection.value.model=''}}
</script>
<style scoped lang="scss">
.capability-card {&:not(:last-child){margin-bottom:var(--admin-gap)}p{margin:0 0 16px;color:var(--el-text-color-secondary);font-size:12px}.el-button{margin-top:12px}.el-text{display:block}}
</style>
