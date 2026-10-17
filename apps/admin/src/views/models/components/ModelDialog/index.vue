<template>
  <el-dialog
    v-model="visible"
    title="配置模型"
    width="650px"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    destroy-on-close
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm
      @submit.prevent
      ref="basicForm"
      v-model="form"
      :columns="1"
      :show-btn="false"
      :form-options="basicFields"
      :disabled="busy"
    >
      <template #active><el-switch v-model="form.active" aria-label="启用模型" /></template>
      <template #isDefault><el-switch v-model="form.isDefault" aria-label="设为默认" /></template>
    </QyqForm>
    <el-collapse
      ><el-collapse-item title="高级配置" name="advanced">
        <QyqForm
          @submit.prevent
          v-model="form"
          :columns="1"
          :show-btn="false"
          :form-options="advancedFields"
          :disabled="busy"
        >
          <template #streamUsage
            ><el-switch v-model="form.streamUsage" aria-label="请求流式用量"
          /></template>
          <template #pricingKnown
            ><el-switch v-model="form.pricingKnown" aria-label="已确认计价"
          /></template>
          <template v-for="field in numericFields" :key="field.prop" #[field.prop]>
            <el-input-number
              v-model="form[field.prop]"
              :min="field.min"
              :max="field.max"
              :precision="field.precision"
              :aria-label="field.label"
            />
          </template>
        </QyqForm> </el-collapse-item
    ></el-collapse>
    <template #footer
      ><el-button :disabled="busy" @click="visible = false">取消</el-button
      ><el-button type="primary" :loading="busy" @click="save">保存</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
  import { ref } from 'vue'
  import { request } from '@/api/request'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Model } from '@/types/models'
  const visible = ref(false),
    busy = ref(false),
    error = ref(''),
    model = ref<Model>()
  const basicForm = ref<{ validate: () => Promise<boolean> }>()
  const form = ref({
    upstreamModel: '',
    publicName: '',
    name: '',
    active: false,
    isDefault: false,
    protocol: 'chat-completions',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    maxTokensField: 'max_tokens',
    streamUsage: true,
    inputPrice: 0,
    outputPrice: 0,
    currency: 'CNY',
    pricingKnown: false,
  })
  const basicFields: FormItemProp[] = [
    {
      prop: 'name',
      label: '显示名称',
      type: 'input',
      required: true,
      isNotTrim: true,
      allowSpecialChars: true,
    },
    { prop: 'upstreamModel', label: '上游模型', type: 'input', disabled: true },
    {
      prop: 'active',
      label: '启用模型',
      type: 'custom',
      hint: { text: '关闭服务来源时，模型会整体不可用。' },
    },
    { prop: 'isDefault', label: '设为默认', type: 'custom' },
  ]
  const numericFields: {
    prop: 'contextWindow' | 'maxOutputTokens' | 'inputPrice' | 'outputPrice'
    label: string
    min: number
    max?: number
    precision?: number
  }[] = [
    { prop: 'contextWindow', label: '上下文长度', min: 1, max: 2000000 },
    { prop: 'maxOutputTokens', label: '最大输出 Token', min: 1, max: 131072 },
    { prop: 'inputPrice', label: '每百万输入 Token 单价', min: 0, precision: 6 },
    { prop: 'outputPrice', label: '每百万输出 Token 单价', min: 0, precision: 6 },
  ]
  const advancedFields: FormItemProp[] = [
    {
      prop: 'protocol',
      label: '接口协议',
      type: 'select',
      options: [
        { label: 'Chat Completions', value: 'chat-completions' },
        { label: 'Responses', value: 'responses' },
      ],
    },
    ...numericFields
      .slice(0, 2)
      .map((field) => ({ prop: field.prop, label: field.label, type: 'custom' as const })),
    {
      prop: 'maxTokensField',
      label: '输出限制字段',
      type: 'select',
      options: [
        { label: 'max_tokens', value: 'max_tokens' },
        { label: 'max_completion_tokens', value: 'max_completion_tokens' },
      ],
    },
    { prop: 'streamUsage', label: '请求流式用量', type: 'custom' },
    { prop: 'pricingKnown', label: '已确认计价（未确认时成本记为未知）', type: 'custom' },
    ...numericFields
      .slice(2)
      .map((field) => ({ prop: field.prop, label: field.label, type: 'custom' as const })),
    {
      prop: 'currency',
      label: '计价币种',
      type: 'select',
      options: [
        { label: '人民币 CNY', value: 'CNY' },
        { label: '美元 USD', value: 'USD' },
      ],
    },
    { prop: 'publicName', label: '公开模型 ID', type: 'input', disabled: true },
  ]
  let success: (() => void) | undefined
  function open(value: Model, onSuccess: () => void) {
    model.value = value
    form.value = {
      upstreamModel: value.upstream_model,
      publicName: value.public_name,
      name: value.name,
      active: value.active,
      isDefault: value.is_default,
      protocol: value.protocol,
      contextWindow: value.context_window,
      maxOutputTokens: value.max_output_tokens,
      maxTokensField: value.max_tokens_field,
      streamUsage: value.stream_usage,
      inputPrice: value.input_price,
      outputPrice: value.output_price,
      currency: value.currency,
      pricingKnown: value.pricing_known !== false,
    }
    error.value = ''
    success = onSuccess
    visible.value = true
  }
  async function save() {
    if (!model.value || busy.value) return
    try {
      if (!(await basicForm.value?.validate())) return
    } catch {
      return
    }
    busy.value = true
    error.value = ''
    try {
      await request(
        '/admin/models/sources/' + model.value.source_id + '/models/' + model.value.id,
        'PATCH',
        form.value
      )
      visible.value = false
      success?.()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败'
    } finally {
      busy.value = false
    }
  }
  defineExpose({ open })
</script>
