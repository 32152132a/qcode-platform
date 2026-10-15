<template>
  <el-dialog
    v-model="visible"
    :title="editor?.title"
    width="740px"
    :close-on-click-modal="false"
    destroy-on-close
    ><el-alert v-if="error" :title="error" type="error" :closable="false" /><QyqForm
      v-if="editor"
      ref="form"
      v-model="value"
      :columns="2"
      :form-options="options"
      :show-btn="false"
    /><template #footer
      ><el-button :disabled="saving" @click="visible = false">取消</el-button
      ><el-button type="primary" :loading="saving" @click="submit">保存</el-button></template
    ></el-dialog
  >
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { EditorData, Row } from '@/types'
  const visible = ref(false),
    saving = ref(false),
    error = ref(''),
    value = ref<Row>({}),
    editor = ref<EditorData>()
  const form = ref<{ validate: () => Promise<boolean> }>()
  const options = computed(
    () =>
      editor.value?.fields.map((field) => ({
        ...field,
        type: field.type || 'input',
        isNotTrim: true,
        allowSpecialChars: true,
        placeholder: (field.type === 'select' ? '请选择' : '请输入') + field.label,
        style: field.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined,
      })) || []
  )
  let success: (() => void) | undefined
  function open(data: EditorData, onSuccess?: () => void) {
    editor.value = data
    value.value = JSON.parse(JSON.stringify(data.value))
    success = onSuccess
    error.value = ''
    visible.value = true
  }
  async function submit() {
    if (!editor.value || saving.value) return
    for (const field of editor.value.fields) {
      const item = value.value[field.prop]
      if (field.required && (item === undefined || item === null || item === '')) {
        error.value = '请填写' + field.label
        return
      }
    }
    saving.value = true
    error.value = ''
    try {
      await editor.value.save(value.value)
      visible.value = false
      value.value = {}
      ElMessage.success('已保存')
      success?.()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败'
    } finally {
      saving.value = false
    }
  }
  defineExpose({ open })
</script>
