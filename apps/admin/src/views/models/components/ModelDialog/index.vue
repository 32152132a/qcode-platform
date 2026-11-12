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
    <div v-if="!model && source?.active" class="catalog-picker">
      <el-button :loading="catalogLoading" :disabled="busy" @click="readCatalog">读取上游目录</el-button>
      <el-select v-if="catalog.length" v-model="form.upstreamModel" filterable
        placeholder="选择上游模型" aria-label="选择上游模型" :disabled="busy || catalogLoading">
        <el-option v-for="item in catalog" :key="item.id" :label="item.id" :value="item.id"
          :disabled="!!item.unavailable_reason" />
      </el-select>
    </div>
    <QyqForm
      @submit.prevent
      ref="basicForm"
      v-model="form"
      :columns="1"
      :show-btn="false"
      :form-options="isImage ? basicFields.filter(field => field.prop !== 'isDefault') : basicFields"
      :disabled="busy"
    >
      <template #active><el-switch v-model="form.active" aria-label="启用模型" /></template>
      <template #isDefault><el-switch v-model="form.isDefault" aria-label="设为默认" /></template>
    </QyqForm>
    <QyqForm v-model="form" :columns="1" :show-btn="false" :form-options="requiredFields" :disabled="busy">
      <template v-for="field in requiredNumbers" :key="field.prop" #[field.prop]>
        <el-input-number v-model="form[field.prop]" :min="field.min" :max="field.max"
          :precision="field.precision" :aria-label="field.label" />
      </template>
    </QyqForm>
    <el-collapse v-if="!isImage"
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
          <template #supportsVision><el-switch v-model="form.supportsVision" aria-label="模型原生支持识图" /></template>
          <template #maxOutputTokens>
            <el-input-number v-model="form.maxOutputTokens" :min="1" :max="131072" aria-label="最大输出 Token" />
          </template>
        </QyqForm> </el-collapse-item
    ></el-collapse>
    <template #footer
      ><el-button :disabled="busy" @click="visible = false">取消</el-button
      ><el-button type="primary" :loading="busy" :disabled="catalogLoading" @click="save">保存</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { request } from '@/api/request'
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
    isDefault: false,
    protocol: 'chat-completions',
    contextWindow: undefined as number | undefined,
    maxOutputTokens: 8192,
    maxTokensField: 'max_tokens',
    streamUsage: true,
    inputPrice: undefined as number | undefined,
    cachedInputPrice: undefined as number | undefined,
    imagePrice: undefined as number | undefined,
    outputPrice: undefined as number | undefined,
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
    { prop: 'upstreamModel', label: '上游模型', type: 'input', required: true, disabled: !!model.value, allowSpecialChars: true },
    {
      prop: 'active',
      label: '启用模型',
      type: 'custom',
      hint: { text: '关闭服务来源时，模型会整体不可用。' },
    },
    { prop: 'isDefault', label: '设为默认', type: 'custom' },
  ])
  const numericFields: {
    prop: 'contextWindow' | 'inputPrice' | 'cachedInputPrice' | 'outputPrice' | 'imagePrice'
    label: string
    min: number
    max?: number
    precision?: number
  }[] = [
    { prop: 'contextWindow', label: '上下文长度', min: 1, max: 2000000 },
    { prop: 'inputPrice', label: '每百万普通输入 Token 单价', min: 0, precision: 6 },
    { prop: 'cachedInputPrice', label: '每百万缓存输入 Token 单价', min: 0, precision: 6 },
    { prop: 'outputPrice', label: '每百万输出 Token 单价', min: 0, precision: 6 },
    { prop: 'imagePrice', label: '每张图片单价', min: 0, precision: 6 },
  ]
  const requiredNumbers = computed(() => numericFields.filter(field => (field.prop === 'imagePrice') === isImage.value))
  const requiredFields = computed<FormItemProp[]>(() => requiredNumbers.value.map(field => {
    const value = reference.value?.[field.prop]
    const context = field.prop === 'contextWindow'
    const suggested = source.value?.kind === 'local' || model.value?.provider === 'ollama' ? '32,768' : '131,072'
    return {
      prop: field.prop,
      label: field.label + (context ? '（Token）' : '（元）'),
      type: 'custom',
      required: true,
      hint: {
        text: value !== undefined
          ? (context ? reference.value?.contextSource : reference.value?.priceSource) + '：' + value.toLocaleString() + '，保存前可修改。'
          : context ? '可先参考 ' + suggested + '，请按服务实际限制填写。'
            : '按实际渠道填写人民币单价，确认免费可填 0。',
      },
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
    { prop: 'maxOutputTokens', label: '最大输出 Token', type: 'custom' },
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
      isDefault: value.is_default,
      protocol: value.protocol,
      contextWindow: confirmed ? value.context_window : value.reference?.contextWindow,
      maxOutputTokens: value.max_output_tokens,
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
      maxOutputTokens: item?.kind === 'local' ? 256 : 8192,
    }
    error.value = ''
    success = onSuccess
    visible.value = true
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
      if (source.value === item) error.value = cause instanceof Error ? cause.message : '读取上游目录失败'
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
    const missing = requiredNumbers.value.find(field => typeof form.value[field.prop] !== 'number')
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
.catalog-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.catalog-picker .el-select {
  flex: 1;
  min-width: 0;
}
</style>
