<template>
  <el-dialog
    v-model="visible"
    title="设置模型用途"
    width="520px"
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm
      v-model="form"
      :columns="1"
      :show-btn="false"
      :form-options="fields"
      :disabled="loading || saving"
      @submit.prevent
    />
    <el-alert :title="notice" type="info" :closable="false" />
    <el-collapse v-if="form.purpose === 'image_generation'">
      <el-collapse-item title="高级设置" name="limits">
        <QyqForm
          v-model="form"
          :columns="1"
          :show-btn="false"
          :form-options="limitFields"
          :disabled="loading || saving"
          @submit.prevent
        />
      </el-collapse-item>
    </el-collapse>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="loading || !form.purpose || !!loadError"
        @click="submit"
        >确认</el-button
      >
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Row } from '@/types'
  import type { Model } from '@/types/models'
  import { request } from '@/api/request'

  const visible = ref(false),
    loading = ref(false),
    saving = ref(false),
    error = ref(''),
    loadError = ref(false)
  const model = ref<Model>(),
    form = ref<Row>({ purpose: '', dailyImagesPerUser: 10 })
  const current = ref<{
    enabled?: boolean
    model?: string
    visionModelId?: string
  }>({})
  const fields = computed<FormItemProp[]>(() => [
    {
      prop: 'purpose',
      label: '模型用途',
      type: 'select',
      required: true,
      options: [
        { label: '设为生图模型', value: 'image_generation' },
        {
          label: '设为识图模型',
          value: 'vision',
          disabled: model.value?.model_type === 'image',
        },
        ...(model.value?.purposes?.length
          ? [{ label: '取消当前用途', value: 'none' }]
          : []),
      ],
    },
  ])
  const limitFields: FormItemProp[] = [
    {
      prop: 'dailyImagesPerUser',
      label: '每人每日生图张数',
      type: 'input',
      required: true,
    },
  ]
  const notice = computed(() => {
    if (form.value.purpose === 'none')
      return '取消当前模型的生图、识图指定；不会删除模型。'
    if (form.value.purpose === 'image_generation')
      return `全平台只指定一个生图模型。${current.value.enabled ? '当前为 ' + current.value.model + '，确认后替换。' : ''}确认后启用此模型，仅通过生图接口调用，不出现在对话模型列表中。上游需支持兼容的图片生成接口，实际效果请通过生图试用。`
    if (form.value.purpose === 'vision')
      return '全平台只指定一个识图模型，确认后替换原指定并启用此模型。员工上传图片时自动使用；此模型需支持图片输入，文字对话仍可使用。'
    return '选择用途后，员工端自动使用相应的图片能力，无需员工单独选择模型。'
  })
  let success: (() => void) | undefined
  async function open(item: Model, onSuccess?: () => void) {
    model.value = item
    success = onSuccess
    form.value = { purpose: '', dailyImagesPerUser: 10 }
    current.value = {}
    error.value = ''
    loadError.value = false
    visible.value = true
    loading.value = true
    try {
      const value = await request<{
        enabled: boolean
        model: string
        visionModelId: string
        dailyImagesPerUser: number
      }>('/admin/models/images/settings')
      current.value = value
      form.value.dailyImagesPerUser = value.dailyImagesPerUser
    } catch (cause) {
      loadError.value = true
      error.value =
        cause instanceof Error ? cause.message : '读取配置失败，请重新打开'
    } finally {
      loading.value = false
    }
  }
  async function submit() {
    if (
      !model.value ||
      saving.value ||
      loading.value ||
      loadError.value ||
      !form.value.purpose
    )
      return
    saving.value = true
    error.value = ''
    try {
      await request('/admin/models/' + model.value.id + '/purpose', 'POST', {
        purpose: form.value.purpose,
        ...(form.value.purpose === 'image_generation'
          ? { dailyImagesPerUser: Number(form.value.dailyImagesPerUser) }
          : {}),
      })
      visible.value = false
      ElMessage.success('模型用途已更新')
      success?.()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败'
    } finally {
      saving.value = false
    }
  }
  defineExpose({ open })
</script>
