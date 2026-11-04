<template>
  <el-dialog v-model="visible" :title="keyId ? '配置 Key' : '添加 Key'" width="740px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="2" :show-btn="false">
      <template #restoreAt><el-date-picker v-model="value.restoreAt" type="datetime" placeholder="不指定则按恢复间隔或手动启用" value-format="YYYY-MM-DDTHH:mm:ssZ" /></template>
    </QyqForm>
    <el-text type="info">恢复间隔从异常停用时开始计算，0 表示仅手动恢复。指定时间优先，仅生效一次；手动停用会取消待执行的恢复。</el-text>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import QyqForm from '@/components/qyq-form/index.vue'
import { request } from '@/api/request'
import type { Row } from '@/types'
const visible = ref(false), saving = ref(false), error = ref(''), keyId = ref('')
const value = ref<Row>({}), sources = ref<Row[]>([])
const form = ref<{validate: () => Promise<boolean>}>()
const fields = computed(() => [
  {prop:'name',label:'名称',type:'input',required:true},
  ...(!keyId.value ? [{prop:'apiKey',label:'API Key',type:'password',required:true,isNotTrim:true}] : []),
  {prop:'sourceId',label:'服务站点（可暂不绑定）',type:'select',clearable:true,options:sources.value.filter(source => source.kind !== 'local').map(source => ({label:String(source.name),value:String(source.id)}))},
  {prop:'restoreHours',label:'异常后恢复间隔（小时）',type:'number',min:0,max:8760,precision:0},
  {prop:'restoreAt',label:'指定恢复时间（可选）',type:'custom'},
].map(field => ({...field, allowSpecialChars: true})))
let success: (() => void) | undefined
async function open(row: Row | undefined, onSuccess?: () => void) {
  keyId.value = row ? String(row.id) : ''
  value.value = {name: row?.name || '',apiKey:'',sourceId:row?.source_id || '',restoreHours:row?.restore_hours || 0,restoreAt:row?.restore_at || ''}
  success = onSuccess; error.value = ''; visible.value = true; saving.value = true
  try { sources.value = await request<Row[]>('/admin/models/sources') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加载服务站点失败' }
  finally { saving.value = false }
}
async function save() {
  if (saving.value) return
  try {
    if (!await form.value?.validate()) return
    saving.value = true; error.value = ''
    const {apiKey, ...settings} = value.value
    settings.restoreHours = Number(settings.restoreHours)
    await request('/admin/keys' + (keyId.value ? '/' + keyId.value : ''), keyId.value ? 'PATCH' : 'POST', keyId.value ? settings : {...settings,apiKey})
    visible.value = false; success?.()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
defineExpose({open})
</script>
