<template>
  <div class="form-select-input" :style="selectInputStyle">
    <template v-for="(item, index) in option?.propOption || []" :key="index">
      <!-- 文本输入框 -->
      <el-input
        v-if="item.type === 'input'"
        :model-value="getFieldValue(item.prop)"
        :disabled="item.disabled || option.disabled"
        :placeholder="item.placeholder || '请输入'"
        :controls="false"
        :maxlength="item.maxlength"
        :clearable="item.clearable"
        :autosize="item.autosize || { minRows: 2, maxRows: 4 }"
        @update:model-value="setFieldValue($event, item)"
        @click="eLgsFormClick($event, item.prop, item, modelValue)"
      ></el-input>

      <!-- 数字输入框 -->
      <el-input
        v-else-if="item.type === 'number'"
        :model-value="getFieldValue(item.prop)"
        :disabled="item.disabled || option.disabled"
        :placeholder="item.placeholder || '请输入'"
        :maxlength="item.maxLength"
        :precision="item.precision"
        :clearable="item.clearable"
        :controls="false"
        @update:model-value="setNumberFieldValue($event, item)"
        @click="eLgsFormClick($event, item.prop, item, modelValue)"
      ></el-input>

      <!-- 下拉选择框 -->
      <el-select
        v-else-if="item.type === 'select'"
        :model-value="getFieldValue(item.prop)"
        :disabled="item.disabled || option.disabled"
        :multiple="item.multiple"
        :placeholder="item.placeholder || '请选择'"
        :clearable="item.clearable"
        @update:model-value="setFieldValue($event, item)"
        @click="eLgsFormClick($event, item.prop, item, modelValue)"
      >
        <el-option
          v-for="(opt, ind) in item.options"
          :key="ind"
          :title="opt.label"
          :label="opt.label"
          :value="opt.value"
          :disabled="opt.disabled"
        ></el-option>
      </el-select>

      <!-- 金额组件 -->
      <form-money
        v-else-if="item.type === 'money' || item.type === 'moneyrange'"
        :disabled="item.disabled || option.disabled"
        :option="item"
        v-model="modelValue"
        :placeholder="item.placeholder || '请输入'"
        :clearable="item.clearable"
        @form-item-click="eLgsFormClick"
        @change="eLgsFormChange"
      ></form-money>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import FormMoney from './FormMoney.vue'

  type SelectOption = {
    label: string
    value: any
    disabled?: boolean
  }

  type PropOptionItem = {
    type: string
    prop: string
    width?: string
    disabled?: boolean
    placeholder?: string
    maxlength?: number
    maxLength?: number
    precision?: number
    clearable?: boolean
    autosize?: unknown
    options?: SelectOption[]
    multiple?: boolean
    format?: string
  }

  const modelValue = defineModel<Record<string, any>>({
    default: () => ({}),
  })

  const props = withDefaults(
    defineProps<{
      option?: {
        propOption?: PropOptionItem[]
        disabled?: boolean
      }
    }>(),
    {
      option: () => ({}),
    }
  )

  const emit = defineEmits<{
    (e: 'formItemClick', ...args: unknown[]): void
    (e: 'change', ...args: unknown[]): void
  }>()

  // 计算网格布局样式
  const selectInputStyle = computed(() => {
    const arr = props.option?.propOption?.map((item) => item.width || 'auto') || []
    return {
      'grid-template-columns': arr.join(' '),
      display: 'grid',
      gap: '4px',
    }
  })

  // 表单变化事件
  const eLgsFormChange = (...arg: unknown[]) => {
    emit('change', ...arg)
  }

  // 表单点击事件
  const eLgsFormClick = (...arg: unknown[]) => {
    emit('formItemClick', ...arg)
  }

  const getFieldValue = (prop: string) => {
    return modelValue.value?.[prop]
  }

  const setFieldValue = (value: unknown, item: PropOptionItem) => {
    const prop = item.prop
    const newValue = { ...modelValue.value, [prop]: value }
    modelValue.value = newValue
    eLgsFormChange(value, prop, item, newValue)
  }

  // 数字输入处理
  const setNumberFieldValue = (value: unknown, item: PropOptionItem) => {
    let format: RegExp | null = null

    if (item.format === 'number') {
      format = /[^0-9]/g
    }

    const nextValue = format ? String(value ?? '').replace(format, '') : value
    setFieldValue(nextValue, item)
  }
</script>

<style lang="scss" scoped>
  .form-select-input {
    display: grid;
    gap: 4px;
    width: 100%;

    .el-input,
    .el-select {
      width: 100%;
    }
  }
</style>
