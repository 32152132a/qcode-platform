/**
 * qyq-form 组件类型定义
 */

export type FormItemType =
  | 'input'
  | 'textarea'
  | 'password'
  | 'select'
  | 'searchSelect'
  | 'autocomplete'
  | 'radioGroup'
  | 'radio'
  | 'cascader'
  | 'date'
  | 'daterange'
  | 'number'
  | 'money'
  | 'moneyrange'
  | 'selectInput'
  | 'custom'

export interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

export interface DateValidateData {
  /** 是否限制时间范围 */
  isLimitRange?: boolean
  /** 校验时间是否向前（true=往前，false=往后） */
  isBefore?: boolean
  /** 校验类型：year/week/day/months */
  validateType?: 'year' | 'week' | 'day' | 'months'
  /** 校验长度 */
  validateNumber?: number
  /** 单独的限制范围数组 */
  limitRangeArr?: Array<{
    number: number
    type: 'year' | 'week' | 'day' | 'months'
  }>
  /** 是否显示快捷选项 */
  isShowShortcuts?: boolean
}

export interface TipConfig {
  content?: string
  text?: string
  prop?: string
}

export interface HintConfig {
  text?: string
  prop?: string
  style?: Record<string, string>
}

export interface FormItemProp {
  /** 表单的 key */
  prop: string | string[]
  /** 动态表单 key */
  key?: string
  /** 表单类型 */
  type: FormItemType
  /** 标签文本 */
  label?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 字段容器样式，可用于 Grid 跨列/跨行 */
  style?: Record<string, string | number>
  /** 占位符 */
  placeholder?: string
  /** 最大长度 */
  maxlength?: number | string
  /** 是否显示清除按钮 */
  clearable?: boolean
  /** textarea 自动尺寸 */
  autosize?: { minRows?: number; maxRows?: number }
  /** 选项列表（select/radioGroup/radio/cascader） */
  options?: SelectOption[]
  /** 是否多选 */
  multiple?: boolean
  /** 日期配置 */
  dateValidateData?: DateValidateData
  /** 快捷选项 */
  shortcuts?: Array<{ text: string; value: any }>
  /** 允许特殊字符（不过滤空格） */
  allowSpecialChars?: boolean
  /** 不过滤前后空格 */
  isNotTrim?: boolean
  /** 单位 */
  unit?: string
  /** 提示信息 */
  tip?: TipConfig
  /** 提示文本 */
  hint?: HintConfig
  /** 是否显示（v-if 控制） */
  visible?: boolean
  /** 是否必填 */
  required?: boolean
  /** 数字精度 */
  precision?: number
  /** 级联选择器选项 */
  propOption?: Array<{ prop: string }>
  /** 联想输入建议 */
  suggestions?: Array<{
    options?: Array<string | number>
    keywords?: Array<string | number>
  }>
  /** 自动联想聚焦即触发 */
  triggerOnFocus?: boolean
  /** 自动联想防抖 */
  debounce?: number
  /** searchSelect 空状态文案 */
  emptyText?: string
  /** searchSelect 标签字段 */
  labelKey?: string
  /** searchSelect 值字段 */
  valueKey?: string
  /** 自定义搜索正则 */
  regexBuilder?: (query: string, option?: Record<string, any>) => RegExp | null
  /** 自定义匹配方法 */
  matchMethod?: (query: string, option: Record<string, any>, regex: RegExp | null) => boolean
  /** 日期格式化 */
  format?: string | string[]
  /** 禁用日期函数 */
  disableDate?: (time: Date, item: FormItemProp) => boolean
}

export interface FormLabelInfo {
  /** 必填星号位置 */
  requireAsteriskPosition: 'left' | 'right' | 'top'
  /** 标签位置 */
  labelPosition: 'left' | 'right' | 'top'
  /** 标签宽度 */
  labelWidth: string | number
  /** 是否显示冒号 */
  showColon: boolean
}

export interface QyqFormProps {
  /** 表单数据 */
  modelValue: Record<string, any>
  /** 表单配置 */
  formOptions: FormItemProp[]
  /** 校验规则 */
  rules?: Record<string, any>
  /** 表单标签配置 */
  formLabelInfo?: FormLabelInfo
  /** 是否显示按钮 */
  showBtn?: boolean
  /** 按钮位置 */
  btnPosition?: string
  /** 一行显示几列 */
  columns?: number
  /** rule 变化时是否立即校验 */
  validateOnRuleChange?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 标题 */
  title?: string
  /** 标题提示 */
  titleTip?: string
  /** 标题字体粗细 */
  titleFontWeight?: number | string
  /** 标题字号 */
  titleSize?: number
  /** 下拉选项（key 与 prop 一致） */
  selectOptions?: Record<string, SelectOption[]>
}
