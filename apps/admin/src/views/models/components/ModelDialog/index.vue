<template>
  <el-dialog v-model="visible" title="配置模型" width="650px" :close-on-click-modal="false"
    ><el-alert v-if="error" :title="error" type="error" :closable="false" /><el-form
      label-position="top"
      ><el-form-item label="显示名称"><el-input v-model="form.name" /></el-form-item
      ><el-form-item label="上游模型"
        ><el-input :model-value="model?.upstream_model" disabled /></el-form-item
      ><el-form-item label="启用模型"
        ><el-switch v-model="form.active" /><span class="hint"
          >关闭服务来源时，模型会整体不可用。</span
        ></el-form-item
      ><el-form-item label="设为默认"><el-switch v-model="form.isDefault" /></el-form-item
      ><el-collapse
        ><el-collapse-item title="高级配置" name="advanced"
          ><el-form-item label="接口协议"
            ><el-select v-model="form.protocol"
              ><el-option label="Chat Completions" value="chat-completions" /><el-option
                label="Responses"
                value="responses" /></el-select></el-form-item
          ><el-form-item label="上下文长度"
            ><el-input-number v-model="form.contextWindow" :min="1" :max="2000000" /></el-form-item
          ><el-form-item label="最大输出 Token"
            ><el-input-number v-model="form.maxOutputTokens" :min="1" :max="131072" /></el-form-item
          ><el-form-item label="输出限制字段"
            ><el-select v-model="form.maxTokensField"
              ><el-option label="max_tokens" value="max_tokens" /><el-option
                label="max_completion_tokens"
                value="max_completion_tokens" /></el-select></el-form-item
          ><el-form-item label="请求流式用量"><el-switch v-model="form.streamUsage" /></el-form-item
          ><el-form-item label="已确认计价（未确认时成本记为未知）"
            ><el-switch v-model="form.pricingKnown" /></el-form-item
          ><el-form-item label="每百万输入 Token 单价"
            ><el-input-number v-model="form.inputPrice" :min="0" :precision="6" /></el-form-item
          ><el-form-item label="每百万输出 Token 单价"
            ><el-input-number v-model="form.outputPrice" :min="0" :precision="6" /></el-form-item
          ><el-form-item label="计价币种"
            ><el-select v-model="form.currency"
              ><el-option label="人民币 CNY" value="CNY" /><el-option
                label="美元 USD"
                value="USD" /></el-select></el-form-item
          ><el-form-item label="公开模型 ID"
            ><el-input
              :model-value="model?.public_name"
              disabled /></el-form-item></el-collapse-item></el-collapse></el-form
    ><template #footer
      ><el-button @click="visible = false">取消</el-button
      ><el-button type="primary" :loading="busy" @click="save">保存</el-button></template
    ></el-dialog
  >
</template>
<script setup lang="ts">
  import { ref } from 'vue'
  import { request } from '@/api/request'
  import type { Model } from '@/types/models'
  const visible = ref(false),
    busy = ref(false),
    error = ref(''),
    model = ref<Model>()
  const form = ref({
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
  let success: (() => void) | undefined
  function open(value: Model, onSuccess: () => void) {
    model.value = value
    form.value = {
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
    if (!model.value) return
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
<style scoped lang="scss">
  .hint {
    font-size: 12px;
    color: #8b95a7;
    margin-left: 14px;
  }
</style>
