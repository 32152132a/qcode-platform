<template>
  <el-alert :title="summary" :type="error ? 'error' : 'info'" :closable="false">
    <el-button v-if="auth.can('models:write')" text type="primary" @click="edit">配置图片能力</el-button>
  </el-alert>
  <el-dialog v-model="visible" title="图片能力" width="640px" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" destroy-on-close>
    <el-alert v-if="formError" :title="formError" type="error" :closable="false" />
    <QyqForm v-model="form" :columns="1" :show-btn="false" :form-options="fields" :disabled="saving" @submit.prevent />
    <el-collapse><el-collapse-item title="高级设置" name="advanced">
      <QyqForm v-model="form" :columns="1" :show-btn="false" :form-options="advancedFields" :disabled="saving" @submit.prevent />
    </el-collapse-item></el-collapse>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import { request } from '@/api/request'
  import { useAuthStore } from '@/stores/auth'
  import type { Model, ModelSource } from '@/types/models'
  interface ImageSettings { enabled?: boolean; sourceId: string; model: string; dailyImagesPerUser: number; visionModelId: string }
  const props = defineProps<{ sources: ModelSource[]; models: Model[] }>()
  const auth = useAuthStore()
  const visible = ref(false), saving = ref(false), error = ref(''), formError = ref('')
  const value = ref<ImageSettings>()
  const form = ref({sourceId:'',model:'',visionModelId:'',dailyImagesPerUser:10})
  const imageSources = computed(() => props.sources.filter(source => source.kind !== 'local' && source.active && source.key_id))
  const visionModels = computed(() => props.models.filter(model => model.active && model.catalog_available !== false && props.sources.some(source => source.id === model.source_id && source.active)))
  const summary = computed(() => {
    if (error.value) return error.value
    const generation = !value.value?.enabled ? '生图未配置' : imageSources.value.some(source => source.id === value.value?.sourceId) ? '生图可用' : '生图暂不可用'
    const vision = !value.value?.visionModelId ? '识图未配置' : visionModels.value.some(model => model.id === value.value?.visionModelId) ? '识图可用' : '识图模型已下架'
    return '图片能力：' + generation + ' · ' + vision
  })
  const fields = computed<FormItemProp[]>(() => [
    {prop:'sourceId',label:'生图站点',type:'select',clearable:true,options:[...imageSources.value.map(source => ({label:source.name,value:source.id})),...(form.value.sourceId && !imageSources.value.some(source => source.id === form.value.sourceId) ? [{label:'原站点已停用，请重新选择',value:form.value.sourceId,disabled:true}] : [])]},
    {prop:'model',label:'生图模型',type:'input',isNotTrim:true,allowSpecialChars:true,hint:{text:'填写站点支持的生图模型名；站点和模型一起清空即可停用。'}},
    {prop:'visionModelId',label:'默认识图模型',type:'select',clearable:true,options:[...visionModels.value.map(model => ({label:model.name,value:model.id})),...(form.value.visionModelId && !visionModels.value.some(model => model.id === form.value.visionModelId) ? [{label:'原识图模型已下架，请重新选择',value:form.value.visionModelId,disabled:true}] : [])],hint:{text:'选择已接入且支持图片输入的模型；员工上传图片时自动使用，留空则不提供识图。'}},
  ])
  const advancedFields: FormItemProp[] = [{prop:'dailyImagesPerUser',label:'每人每日生图张数',type:'number'}]
  async function load() {
    try { value.value = await request<ImageSettings>('/admin/models/images/settings'); error.value = '' }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '读取图片配置失败' }
  }
  async function edit() {
    await load()
    if (!value.value || error.value) return
    const saved = value.value
    form.value = {sourceId:saved.enabled ? saved.sourceId : '',model:saved.enabled ? saved.model : '',visionModelId:saved.visionModelId || '',dailyImagesPerUser:saved.dailyImagesPerUser}
    formError.value = ''
    visible.value = true
  }
  async function save() {
    if (saving.value) return
    saving.value = true
    formError.value = ''
    try {
      value.value = await request<ImageSettings>('/admin/models/images/settings','PUT',{...form.value,model:form.value.model.trim(),sourceId:form.value.sourceId || '',visionModelId:form.value.visionModelId || '',dailyImagesPerUser:Number(form.value.dailyImagesPerUser)})
      visible.value = false
      ElMessage.success('图片配置已保存')
    } catch (cause) { formError.value = cause instanceof Error ? cause.message : '保存失败' }
    finally { saving.value = false }
  }
  onMounted(load)
</script>
