<template>
  <el-select
    v-model="modelValue"
    class="search-select"
    :disabled="disabled"
    :multiple="multiple"
    :clearable="clearable"
    :placeholder="placeholder"
    :filterable="filterable"
    :no-data-text="emptyText"
    :filter-method="handleFilter"
    @visible-change="handleVisibleChange"
    @change="handleChange"
  >
    <el-option
      v-for="option in filteredOptions"
      :key="getOptionValue(option)"
      :label="getOptionLabel(option)"
      :value="getOptionValue(option)"
      :disabled="option.disabled"
    >
      <div class="search-select__option" v-html="getHighlightLabel(option)"></div>
    </el-option>
  </el-select>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { buildHighlightHtml } from './highlight'

  type SelectOption = Record<string, any> & {
    label?: string
    value?: any
    disabled?: boolean
  }

  type RegexBuilder = (query: string, option?: SelectOption) => RegExp | null
  type MatchMethod = (query: string, option: SelectOption, regex: RegExp | null) => boolean

  const modelValue = defineModel<any>({
    default: undefined,
  })

  const props = withDefaults(
    defineProps<{
      options?: SelectOption[]
      placeholder?: string
      clearable?: boolean
      multiple?: boolean
      disabled?: boolean
      filterable?: boolean
      emptyText?: string
      labelKey?: string
      valueKey?: string
      regexBuilder?: RegexBuilder
      matchMethod?: MatchMethod
    }>(),
    {
      options: () => [],
      placeholder: '请选择',
      clearable: false,
      multiple: false,
      disabled: false,
      filterable: true,
      emptyText: '暂无数据',
      labelKey: 'label',
      valueKey: 'value',
      regexBuilder: undefined,
      matchMethod: undefined,
    }
  )

  const emit = defineEmits<{
    (e: 'change', value: any): void
  }>()

  const keyword = ref('')

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const getOptionLabel = (option: SelectOption) => String(option?.[props.labelKey] ?? '')

  const getOptionValue = (option: SelectOption) => option?.[props.valueKey]

  const getRegex = (query: string, option?: SelectOption) => {
    const text = query.trim()
    if (!text) {
      return null
    }

    try {
      return props.regexBuilder?.(text, option) || new RegExp(escapeRegExp(text), 'ig')
    } catch {
      return null
    }
  }

  const isMatched = (query: string, option: SelectOption) => {
    const regex = getRegex(query, option)

    if (props.matchMethod) {
      return props.matchMethod(query, option, regex)
    }

    if (!regex) {
      return false
    }

    regex.lastIndex = 0
    return regex.test(getOptionLabel(option))
  }

  const filteredOptions = computed(() => {
    if (!keyword.value.trim()) {
      return props.options
    }

    return props.options.filter((option) => isMatched(keyword.value, option))
  })

  const getHighlightLabel = (option: SelectOption) => {
    const label = getOptionLabel(option)
    const regex = getRegex(keyword.value, option)
    return buildHighlightHtml(label, regex && isMatched(keyword.value, option) ? regex : null)
  }

  const handleFilter = (query: string) => {
    keyword.value = query
  }

  const handleVisibleChange = (visible: boolean) => {
    if (!visible) {
      keyword.value = ''
    }
  }

  const handleChange = (value: any) => {
    emit('change', value)
  }
</script>

<style lang="scss" scoped>
  .search-select {
    width: 100%;
  }

  .search-select__option {
    width: 100%;
  }

  :deep(.search-highlight) {
    color: var(--el-color-primary);
    font-weight: 600;
  }
</style>
