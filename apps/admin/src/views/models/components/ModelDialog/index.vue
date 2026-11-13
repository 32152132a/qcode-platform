<template>
  <el-dialog
    v-model="visible"
    :title="model ? '配置模型' : '添加模型 · ' + source?.name"
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
      class="model-fields"
      v-model="form"
      :columns="2"
      :show-btn="false"
      :form-options="basicFields"
      :disabled="busy"
    >
      <template #upstreamModel>
        <el-input v-if="model" :model-value="form.upstreamModel" disabled />
        <el-select v-else v-model="form.upstreamModel" filterable allow-create default-first-option
          :loading="catalogLoading" :disabled="busy" placeholder="搜索或输入上游模型 ID" aria-label="上游模型">
          <el-option v-for="item in catalog" :key="item.id" :label="item.id" :value="item.id"
            :disabled="!!item.unavailable_reason" />
        </el-select>
      </template>
    </QyqForm>
    <p v-if="!isImage" class="price-unit">单价按元／百万 Token 填写</p>
    <QyqForm v-model="form" class="model-numbers" :columns="isImage ? 1 : 2" :show-btn="false" :form-options="requiredFields" :disabled="busy">
      <template v-for="field in requiredNumbers" :key="field.prop" #[field.prop]>
        <FormMoney v-model="form" :option="{ prop: field.prop, precision: field.precision ?? 0 }" :placeholder="field.prop === 'contextWindow' ? '建议 ' + Number(suggestedContext).toLocaleString('zh-CN') + ' Token，按实际填写' : '请输入' + field.label + '单价，免费填 0'" :disabled="busy" />
      </template>
    </QyqForm>
    <QyqForm
      v-if="!isImage"
      @submit.prevent
      v-model="form"
      class="model-fields"
      :columns="model ? 2 : 1"
      :show-btn="false"
      :form-options="model ? protocolFields : protocolFields.slice(0, 1)"
      :disabled="busy"
    >
      <template #streamUsage>
        <el-switch v-model="form.streamUsage" aria-label="请求流式用量" />
      </template>
      <template #supportsVision>
        <el-switch v-model="form.supportsVision" aria-label="模型原生支持识图" />
      </template>
    </QyqForm>
    <template #footer
      ><el-button :disabled="busy" @click="visible = false">取消</el-button
      ><el-button type="primary" :loading="busy" :disabled="catalogLoading" @click="save">保存</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { request } from '@/api/request'
  import FormMoney from '@/components/qyq-form/FormMoney.vue'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Model, ModelSource } from '@/types/models'
  const visible = ref(false),
    busy = ref(false),
    catalogLoading = ref(false),
    error = ref(''),
    model = ref<Model>(),
    source = ref<ModelSource>()
  const catalog = computed(() => source.value?.catalog || [])
  const basicForm = ref<{ validate: () => Promise<boolean> }>()
  const initialForm = () => ({
    upstreamModel: '',
    publicName: '',
    name: '',
    active: false,
    protocol: 'chat-completions',
    contextWindow: undefined as number | string | undefined,
    maxTokensField: 'max_tokens',
    streamUsage: true,
    inputPrice: undefined as number | string | undefined,
    cachedInputPrice: undefined as number | string | undefined,
    imagePrice: undefined as number | string | undefined,
    outputPrice: undefined as number | string | undefined,
    supportsVision: false,
  })
  const form = ref(initialForm())
  const candidate = computed(() => source.value?.catalog?.find(item => item.id === form.value.upstreamModel.trim()))
  const reference = computed(() => model.value?.reference ?? candidate.value?.reference)
  const isImage = computed(() => model.value
    ? model.value.model_type === 'image'
    : candidate.value?.capabilities?.includes('image_generation') === true ||
      /(?:gpt-image|dall-e|seedream|flux|stable-diffusion|sdxl|imagen)/i.test(form.value.upstreamModel))
  const basicFields = computed<FormItemProp[]>(() => [
    {
      prop: 'name',
      label: '显示名称',
      type: 'input',
      required: !!model.value,
      isNotTrim: true,
      allowSpecialChars: true,
    },
    { prop: 'upstreamModel', label: '上游模型', type: 'custom', required: true, allowSpecialChars: true },
  ])
  const numericFields: {
    prop: 'contextWindow' | 'inputPrice' | 'cachedInputPrice' | 'outputPrice' | 'imagePrice'
    label: string
    min: number
    max?: number
    precision?: number
  }[] = [
    { prop: 'contextWindow', label: '上下文长度', min: 1, max: 2000000 },
    { prop: 'inputPrice', label: '普通输入', min: 0, precision: 6 },
    { prop: 'cachedInputPrice', label: '缓存命中输入', min: 0, precision: 6 },
    { prop: 'outputPrice', label: '输出', min: 0, precision: 6 },
    { prop: 'imagePrice', label: '每张图片', min: 0, precision: 6 },
  ]
  const requiredNumbers = computed(() => numericFields.filter(field => (field.prop === 'imagePrice') === isImage.value))
  const suggestedContext = computed(() =>
    source.value?.kind === 'local' || model.value?.provider === 'ollama' ? '32768' : '131072')
  const requiredFields = computed<FormItemProp[]>(() => requiredNumbers.value.map(field => {
    const value = reference.value?.[field.prop]
    const context = field.prop === 'contextWindow'
    return {
      prop: field.prop,
      label: field.label + (context ? '（Token）' : '（元）'),
      type: 'custom',
      required: true,
      ...(value !== undefined ? { hint: {
        text: (context ? reference.value?.contextSource : reference.value?.priceSource)
          + '：' + value.toLocaleString() + '，保存前可修改。',
      } } : {}),
    }
  }))
  watch(candidate, (value, previous) => {
    if (model.value) return
    if (value || previous) {
      const endpoints = value?.supported_endpoint_types?.map(endpoint => endpoint.toLowerCase()) || []
      form.value.protocol = endpoints.some(endpoint => ['openai-response', 'responses'].includes(endpoint)) &&
        !endpoints.some(endpoint => ['openai', 'openai-compatible', 'chat-completions'].includes(endpoint))
        ? 'responses' : source.value?.protocol || 'chat-completions'
    }
    for (const field of numericFields) {
      const current = form.value[field.prop]
      if (current === undefined || current === previous?.reference?.[field.prop])
        form.value[field.prop] = value?.reference?.[field.prop]
    }
  })
  const protocolFields: FormItemProp[] = [
    {
      prop: 'protocol',
      label: '接口协议',
      hint: { text: '默认跟随服务来源。上游文档写 /responses 时选择 Responses，写 /chat/completions 时选择 Chat Completions。' },
      type: 'select',
      options: [
        { label: 'Chat Completions', value: 'chat-completions' },
        { label: 'Responses', value: 'responses' },
      ],
    },
    {
      prop: 'maxTokensField',
      label: '输出限制字段',
      type: 'select',
      options: [
        { label: 'max_tokens', value: 'max_tokens' },
        { label: 'max_completion_tokens', value: 'max_completion_tokens' },
      ],
    },
    { prop: 'supportsVision', label: '模型原生支持识图（按服务实际能力确认）', type: 'custom' },
    { prop: 'streamUsage', label: '请求流式用量', type: 'custom' },
    { prop: 'publicName', label: '公开模型 ID', type: 'input', disabled: true },
  ]
  let success: (() => void) | undefined
  function open(value: Model | undefined, onSuccess: () => void, item?: ModelSource) {
    model.value = value
    source.value = item
    const confirmed = value?.pricing_known === true && value.currency === 'CNY'
    form.value = value ? {
      upstreamModel: value.upstream_model,
      publicName: value.public_name,
      name: value.name,
      active: value.active,
      protocol: value.protocol,
      contextWindow: confirmed ? value.context_window : value.reference?.contextWindow,
      maxTokensField: value.max_tokens_field,
      streamUsage: value.stream_usage,
      inputPrice: confirmed ? value.input_price : value.reference?.inputPrice,
      cachedInputPrice: confirmed ? value.cached_input_price : value.reference?.cachedInputPrice,
      imagePrice: confirmed ? value.image_price : value.reference?.imagePrice,
      outputPrice: confirmed ? value.output_price : value.reference?.outputPrice,
      supportsVision: value.capabilities?.includes('vision') === true,
    } : {
      ...initialForm(),
      protocol: item?.protocol || 'chat-completions',
    }
    error.value = ''
    success = onSuccess
    visible.value = true
    if (!value && item?.active) void readCatalog()
  }
  async function readCatalog() {
    const item = source.value
    if (!item || catalogLoading.value || busy.value) return
    catalogLoading.value = true
    error.value = ''
    try {
      const result = await request<{ source: ModelSource }>('/admin/models/sources/' + item.id + '/sync', 'POST', {})
      if (source.value === item) source.value = result.source
    } catch (cause) {
      if (source.value === item) error.value = (cause instanceof Error ? cause.message : '读取上游目录失败') + '，可以手动输入模型 ID'
    } finally {
      catalogLoading.value = false
    }
  }
  async function save() {
    const sourceId = model.value?.source_id || source.value?.id
    if (!sourceId || busy.value || catalogLoading.value) return
    try {
      if (!(await basicForm.value?.validate())) return
    } catch {
      return
    }
    const missing = requiredNumbers.value.find(field => String(form.value[field.prop] ?? '').trim() === '')
    if (missing) {
      error.value = '请填写' + missing.label
      return
    }
    busy.value = true
    error.value = ''
    try {
      await request(
        '/admin/models/sources/' + sourceId + '/models' + (model.value ? '/' + model.value.id : ''),
        model.value ? 'PATCH' : 'POST',
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

<style scoped>
.price-unit {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
@media (max-width: 540px) {
  .model-fields :deep(.form),
  .model-numbers :deep(.form) { grid-template-columns: minmax(0, 1fr) !important; }
}

</style>
