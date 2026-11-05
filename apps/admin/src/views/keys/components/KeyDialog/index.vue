<template>
  <el-dialog v-model="visible" :title="keyId ? '编辑 Key' : '添加 Key'" width="640px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="1" :show-btn="false">
      <template #name><el-input v-model="value.name" name="key-display-name" autocomplete="off" placeholder="请输入 Key 名称" /></template>
      <template #apiKey><el-input v-model="value.apiKey" name="provider-api-key" type="password" show-password autocomplete="new-password" placeholder="请输入 API Key" /></template>
    </QyqForm>
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
  {prop:'name',label:'名称',type:'custom',required:true},
  ...(!keyId.value ? [{prop:'apiKey',label:'API Key',type:'custom',required:true,isNotTrim:true}] : []),
  {prop:'sourceId',label:'服务站点（可暂不绑定）',type:'select',clearable:true,options:sources.value.filter(source => source.kind !== 'local').map(source => ({label:String(source.name),value:String(source.id)}))},
].map(field => ({...field, allowSpecialChars: true})))
let success: (() => void) | undefined
async function open(row?: Row, onSuccess?: () => void) {
  keyId.value = row ? String(row.id) : ''
  value.value = {name:row?.name || '',sourceId:row?.source_id || '',...(!row ? {apiKey:''} : {})}
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
    await request('/admin/keys' + (keyId.value ? '/' + keyId.value : ''), keyId.value ? 'PATCH' : 'POST', value.value)
    visible.value = false; success?.()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { saving.value = false }
}
defineExpose({open})
</script>
