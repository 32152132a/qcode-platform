<template>
  <div class="form-money">
    <!-- 金额范围模式 -->
    <div v-if="option.type === 'moneyrange'" class="form-money-input">
      <!-- 第一个输入框 -->
      <el-input
        v-if="option._props"
        v-model="firstValue"
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(0)"
        @input="handleMoneyFormat($event, 0)"
        @blur="() => handleBlur(0)"
      />
      <el-input
        v-else-if="option.prop && modelValue[option.prop]"
        v-model="rangeFirstValue"
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(0)"
        @input="handleMoneyFormat($event, 0)"
        @blur="() => handleBlur(0)"
      />
      <el-input
        v-else
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(0)"
        @input="handleMoneyFormat($event, 0)"
        @blur="() => handleBlur(0)"
      />

      <span class="separator">至</span>

      <!-- 第二个输入框 -->
      <el-input
        v-if="option._props"
        v-model="secondValue"
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(1)"
        @input="handleMoneyFormat($event, 1)"
        @blur="() => handleBlur(1)"
      />
      <el-input
        v-else-if="option.prop && modelValue[option.prop]"
        v-model="rangeSecondValue"
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(1)"
        @input="handleMoneyFormat($event, 1)"
        @blur="() => handleBlur(1)"
      />
      <el-input
        v-else
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleClick(1)"
        @input="handleMoneyFormat($event, 1)"
        @blur="() => handleBlur(1)"
      />
    </div>

    <!-- 单个金额模式 -->
    <div v-else class="money-only">
      <el-input
        v-model="singleValue"
        :disabled="disabled"
        :placeholder="placeholder || '请输入'"
        :clearable="clearable"
        @click="handleSingleClick"
        @input="handleMoneyFormat"
        @blur="handleSingleBlur"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  const modelValue = defineModel<Record<string, any>>({
    default: () => ({}),
  })

  const props = withDefaults(
    defineProps<{
      option?: Record<string, any>
      disabled?: boolean
      placeholder?: string
      clearable?: boolean
    }>(),
    {
      option: () => ({}),
      disabled: false,
      placeholder: '',
      clearable: false,
    }
  )

  const emit = defineEmits<{
    (e: 'change', ...args: unknown[]): void
    (e: 'formItemClick', ...args: unknown[]): void
  }>()

  // 计算属性来处理各种数据格式
  const firstValue = computed<string>({
    get() {
      if (props.option._props && modelValue.value[props.option._props[0]] !== undefined) {
        return String(modelValue.value[props.option._props[0]] ?? '')
      }
      return ''
    },
    set(value: string) {
      if (props.option._props) {
        const newValue = { ...modelValue.value }
        newValue[props.option._props[0]] = value
        modelValue.value = newValue
      }
    },
  })

  const secondValue = computed<string>({
    get() {
      if (props.option._props && modelValue.value[props.option._props[1]] !== undefined) {
        return String(modelValue.value[props.option._props[1]] ?? '')
      }
      return ''
    },
    set(value: string) {
      if (props.option._props) {
        const newValue = { ...modelValue.value }
        newValue[props.option._props[1]] = value
        modelValue.value = newValue
      }
    },
  })

  const rangeFirstValue = computed<string>({
    get() {
      if (!props.option.prop) return ''
      const val = modelValue.value?.[props.option.prop]
      if (!Array.isArray(val)) return ''
      return String(val[0] ?? '')
    },
    set(value: string) {
      if (!props.option.prop) return
      const newValue = { ...modelValue.value }
      const current = Array.isArray(newValue[props.option.prop])
        ? [...(newValue[props.option.prop] as string[])]
        : ['', '']
      current[0] = value
      newValue[props.option.prop] = current
      modelValue.value = newValue
    },
  })

  const rangeSecondValue = computed<string>({
    get() {
      if (!props.option.prop) return ''
      const val = modelValue.value?.[props.option.prop]
      if (!Array.isArray(val)) return ''
      return String(val[1] ?? '')
    },
    set(value: string) {
      if (!props.option.prop) return
      const newValue = { ...modelValue.value }
      const current = Array.isArray(newValue[props.option.prop])
        ? [...(newValue[props.option.prop] as string[])]
        : ['', '']
      current[1] = value
      newValue[props.option.prop] = current
      modelValue.value = newValue
    },
  })

  const singleValue = computed<string>({
    get() {
      if (props.option.prop && modelValue.value[props.option.prop] !== undefined) {
        return String(modelValue.value[props.option.prop] ?? '')
      }
      return ''
    },
    set(value: string) {
      if (props.option.prop) {
        const newValue = { ...modelValue.value }
        newValue[props.option.prop] = value
        modelValue.value = newValue
        emit('change', value, props.option.prop, props.option, newValue)
      }
    },
  })

  const getMoneyPrecision = () => {
    const precision = Number(props.option?.precision)
    return Number.isInteger(precision) && precision >= 0 ? precision : 2
  }

  const formatMoneyParts = (parts: string[], padDecimal = false) => {
    const precision = getMoneyPrecision()
    const integerPart = String(parts[0] ?? '')
      .replace(/,/g, '')
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

    if (precision === 0) {
      return integerPart
    }

    const hasDecimal = parts.length > 1
    const decimalPart = String(parts[1] ?? '')
      .replace(/[^\d]/g, '')
      .slice(0, precision)

    if (!hasDecimal && !padDecimal) {
      return integerPart
    }

    if (padDecimal) {
      return `${integerPart}.${decimalPart.padEnd(precision, '0')}`
    }

    return `${integerPart}.${decimalPart}`
  }

  // 金额格式化函数
  const handleMoneyFormat = (value: unknown, index?: number) => {
    if (value === undefined || value === null) return ''

    const formattedValue = String(value)
      .replace(/[^\d.]/g, '') // 移除非数字和点号
      .replace(/^\./g, '') // 移除开头的点号
      .replace(/(\..*)\./g, '$1') // 确保只有一个点号
    const result = formatMoneyParts(formattedValue.split('.'))

    // 根据类型设置值
    if (props.option.type === 'moneyrange') {
      if (props.option._props) {
        const newValue = { ...modelValue.value }
        newValue[props.option._props[index as number]] = result
        modelValue.value = newValue
        emit('change', [
          newValue[props.option._props[0]],
          newValue[props.option._props[1]],
          props.option._props[index as number],
          props.option,
          newValue,
        ])
      } else if (props.option.prop) {
        const newValue = { ...modelValue.value }
        const current = Array.isArray(newValue[props.option.prop])
          ? [...(newValue[props.option.prop] as string[])]
          : ['', '']
        current[index as number] = result
        newValue[props.option.prop] = current
        modelValue.value = newValue
        emit('change', newValue[props.option.prop], props.option.prop, props.option, newValue)
      }
    }
  }

  // 失去焦点时处理
  const handleBlur = (index: number) => {
    let value = ''

    if (props.option.type === 'moneyrange') {
      if (props.option._props) {
        value = (modelValue.value[props.option._props[index]] as string) || ''
      } else if (props.option.prop && modelValue.value[props.option.prop]) {
        value = (modelValue.value[props.option.prop] as any)?.[index] || ''
      }
    }

    if (!value) return

    const result = formatMoneyParts(value.split('.'), true)

    // 更新值
    if (props.option._props) {
      const newValue = { ...modelValue.value }
      newValue[props.option._props[index]] = result
      modelValue.value = newValue
    } else if (props.option.prop) {
      const newValue = { ...modelValue.value }
      const current = Array.isArray(newValue[props.option.prop])
        ? [...(newValue[props.option.prop] as string[])]
        : ['', '']
      current[index] = result
      newValue[props.option.prop] = current
      modelValue.value = newValue
    }
  }

  const handleSingleBlur = () => {
    if (!singleValue.value) return

    singleValue.value = formatMoneyParts(String(singleValue.value).split('.'), true)
  }

  // 点击事件处理
  const handleClick = (index: number) => {
    if (props.option._props) {
      emit(
        'formItemClick',
        modelValue.value[props.option._props[index]],
        props.option._props[index],
        props.option,
        modelValue.value
      )
    } else if (props.option.prop) {
      emit(
        'formItemClick',
        (modelValue.value[props.option.prop] as any)?.[index],
        `${props.option.prop}[${index}]`,
        props.option,
        modelValue.value
      )
    }
  }

  const handleSingleClick = () => {
    emit(
      'formItemClick',
      modelValue.value[props.option.prop],
      props.option.prop,
      props.option,
      modelValue.value
    )
  }
</script>

<style lang="scss" scoped>
  .form-money {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }

  .form-money-input {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: center;
    padding: 0 4px;
    border: 1px solid #dcdfe6;
    border-radius: 4px;
    width: 100%;
    position: relative;
    transition: 0.3s all;

    &:hover {
      border-color: var(--el-border-color-hover);
    }

    .separator {
      font-weight: 400;
      color: #303133;
      text-align: center;
      white-space: nowrap;
      line-height: 32px;
    }
  }

  .money-only {
    width: 100%;
  }

  // Element Plus 样式覆盖
  .form-money-input :deep(.el-input__wrapper) {
    box-shadow: none !important;
    border-radius: 4px;
    min-height: 32px;

    &:hover {
      box-shadow: none !important;
    }

    &.is-focus {
      box-shadow: none !important;
    }
  }

  .money-only :deep(.el-input__wrapper) {
    min-height: 32px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px var(--el-border-color) inset !important;

    &:hover {
      box-shadow: 0 0 0 1px var(--el-border-color-hover) inset !important;
    }

    &.is-focus {
      box-shadow: 0 0 0 1px var(--el-color-primary) inset !important;
    }
  }

  :deep(.el-input__inner) {
    text-align: center;
  }
</style>
