<template>
  <div class="search-container">
    <!-- 标题区域 -->
    <CardTitle
      v-if="title"
      :title="title"
      :title-tip="titleTip"
      :font-weight="titleFontWeight"
      :size="titleSize"
    >
      <template #cardTitleInfo>
        <slot name="cardTitleInfo"></slot>
      </template>
      <template #btn>
        <slot name="btn"></slot>
      </template>
    </CardTitle>

    <!-- 表单区域 -->
    <el-form
      ref="searchRef"
      :model="modelValue"
      :require-asterisk-position="formLabelInfo.requireAsteriskPosition"
      :label-position="formLabelInfo.labelPosition"
      :label-width="formLabelInfo.labelWidth"
      :inline="true"
      :validate-on-rule-change="validateOnRuleChange"
      :disabled="disabled"
      :rules="_rules"
      :class="['form', formLabelAlignClass]"
      :style="formStyle"
    >
      <!-- 动态表单字段 -->
      <template v-for="(item, index) in _formOptions">
        <!-- 有标签的表单项 -->
        <FormFieldShell
          v-if="item.label"
          :item="item"
          :key="item.key || `${item.prop}_${index}`"
          :show-colon="formLabelInfo.showColon"
        >
          <!-- 文本输入框（有trim） -->
          <el-input
            v-if="
              (item.type === 'input' || item.type === 'textarea' || item.type === 'password') &&
              !item.isNotTrim
            "
            v-model.trim="modelValue[item.prop]"
            :type="item.type"
            :show-password="item.type === 'password'"
            :disabled="item.disabled"
            :placeholder="item.placeholder || `请输入${item.label}`"
            :maxlength="item.maxlength"
            :clearable="item.clearable"
            :autosize="item.autosize || { minRows: 2, maxRows: 4 }"
            @input="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          ></el-input>

          <!-- 文本输入框（无trim） -->
          <el-input
            v-else-if="
              (item.type === 'input' || item.type === 'textarea' || item.type === 'password') &&
              item.isNotTrim
            "
            v-model="modelValue[item.prop]"
            :type="item.type"
            :show-password="item.type === 'password'"
            :disabled="item.disabled"
            :placeholder="item.placeholder || `请输入${item.label}`"
            :maxlength="item.maxlength"
            :clearable="item.clearable"
            :autosize="item.autosize || { minRows: 2, maxRows: 4 }"
            @input="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          ></el-input>

          <!-- 下拉选择框 -->
          <el-select
            v-else-if="item.type === 'select'"
            v-model="modelValue[item.prop]"
            :disabled="item.disabled"
            :multiple="item.multiple"
            :placeholder="item.placeholder || '请选择'"
            :clearable="formItemClearable(item)"
            @change="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          >
            <el-option
              v-for="(opt, ind) in formItemOptions(item)"
              :key="ind"
              :title="opt.label"
              :label="opt.label"
              :value="opt.value"
              :disabled="opt.disabled"
            ></el-option>
          </el-select>

          <SearchSelect
            v-else-if="item.type === 'searchSelect'"
            v-model="modelValue[item.prop]"
            style="width: 100%"
            :options="formItemOptions(item)"
            :disabled="item.disabled"
            :multiple="item.multiple"
            :placeholder="item.placeholder || '请选择'"
            :clearable="formItemClearable(item)"
            :empty-text="item.emptyText || '暂无数据'"
            :label-key="item.labelKey || 'label'"
            :value-key="item.valueKey || 'value'"
            :regex-builder="item.regexBuilder"
            :match-method="item.matchMethod"
            @change="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          ></SearchSelect>

          <el-autocomplete
            v-else-if="item.type === 'autocomplete'"
            v-model="modelValue[item.prop]"
            style="width: 100%"
            :disabled="item.disabled"
            :placeholder="item.placeholder || `请输入${item.label}`"
            :clearable="item.clearable"
            :trigger-on-focus="item.triggerOnFocus"
            :debounce="item.debounce"
            :fetch-suggestions="
              (queryString, cb) =>
                cb(
                  !(queryString || '').trim()
                    ? []
                    : (item.suggestions || []).flatMap((group) =>
                        [...(group.options || []), ...(group.keywords || [])].some((text) =>
                          String(text).includes((queryString || '').trim())
                        )
                          ? (group.options || []).map((value) => ({
                              value: String(value),
                            }))
                          : []
                      )
                )
            "
            @change="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @input="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @select="(e) => elgsFormChange(e.value, item.prop, item, modelValue)"
          ></el-autocomplete>

          <!-- 单选框组 -->
          <el-radio-group
            v-else-if="item.type === 'radioGroup' || item.type === 'radio'"
            v-model="modelValue[item.prop]"
            :disabled="item.disabled"
            :size="item.size"
            @change="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          >
            <!-- 按钮式单选 -->
            <template v-if="item.type === 'radioGroup'">
              <el-radio-button
                v-for="(opt, ind) in formItemOptions(item)"
                :key="ind"
                :label="opt.label"
                :value="opt.value"
                :disabled="opt.disabled"
                :title="opt.label"
              ></el-radio-button>
            </template>
            <!-- 普通单选 -->
            <template v-else>
              <el-radio
                v-for="(opt, ind) in formItemOptions(item)"
                :key="ind"
                :label="opt.label"
                :value="opt.value"
                :disabled="opt.disabled"
                :title="opt.label"
              ></el-radio>
            </template>
          </el-radio-group>

          <!-- 级联选择器 -->
          <el-cascader
            v-else-if="item.type === 'cascader'"
            v-model="modelValue[item.prop]"
            style="width: 100%"
            :disabled="item.disabled"
            :options="formItemOptions(item)"
            :placeholder="item.placeholder || '请选择'"
            :clearable="item.clearable"
            @change="(e) => elgsFormChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          ></el-cascader>

          <!-- 日期选择器 -->
          <el-date-picker
            v-else-if="item.type === 'date'"
            v-model="modelValue[item.prop]"
            :type="item.type"
            style="width: 100%"
            :format="item.format || 'YYYY-MM-DD'"
            :placeholder="item.placeholder || '请选择'"
            :value-format="item.format || 'YYYY-MM-DD'"
            :disabled="item.disabled"
            :disabled-date="(e) => pickerDisabledDate(e, item)"
            :shortcuts="item.shortcuts"
            :clearable="item.clearable"
            @change="(e) => pickerChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
            @calendar-change="(e) => pickerCalendarChange(e, item.prop, item, modelValue)"
          ></el-date-picker>

          <!-- 日期范围选择器 -->
          <el-date-picker
            v-else-if="item.type === 'daterange'"
            v-model="modelValue[item.prop]"
            range-separator="至"
            unlink-panels
            style="width: 100%"
            :type="item.type"
            :format="item.format || 'YYYY-MM-DD'"
            :disabled="item.disabled"
            :value-format="item.format || 'YYYY-MM-DD'"
            :shortcuts="item.shortcuts"
            :disabled-date="(e) => pickerDisabledDate(e, item)"
            :clearable="item.clearable"
            start-placeholder="请选择"
            end-placeholder="请选择"
            @change="(e) => pickerChange(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
            @calendar-change="(e) => pickerCalendarChange(e, item.prop, item, modelValue)"
          ></el-date-picker>

          <!-- 数字输入框 -->
          <el-input
            v-else-if="item.type === 'number'"
            v-model.trim="modelValue[item.prop]"
            :disabled="item.disabled"
            :placeholder="item.placeholder || `请输入${item.label}`"
            :maxlength="item.maxlength"
            :precision="item.precision"
            :clearable="item.clearable"
            :controls="false"
            @input="(e) => handleInput(e, item.prop, item, modelValue)"
            @click="(e) => elgsFormClick(e, item.prop, item, modelValue)"
          ></el-input>

          <!-- 金额输入组件 -->
          <formMoney
            v-else-if="item.type === 'money' || item.type === 'moneyrange'"
            :disabled="item.disabled"
            :option="item"
            v-model="modelValue"
            :placeholder="
              item.placeholder || (item.type === 'money' ? `请输入${item.label}` : '请输入')
            "
            :clearable="item.clearable"
            @form-item-click="elgsFormClick"
            @change="elgsFormChange"
          ></formMoney>

          <!-- 组合输入组件 -->
          <selectInput
            v-else-if="item.type === 'selectInput'"
            v-model="modelValue"
            :option="item"
            @change="elgsFormChange"
            @form-item-click="elgsFormClick"
          ></selectInput>

          <!-- 自定义插槽 -->
          <div v-else>
            <slot :name="item.prop"></slot>
          </div>

          <template v-if="item.tip?.prop" #tip>
            <slot :name="item.tip.prop"></slot>
          </template>

          <template v-if="item.hint?.prop" #hint>
            <slot :name="item.hint.prop"></slot>
          </template>
        </FormFieldShell>

        <!-- 无标签的自定义插槽 -->
        <slot v-else :name="item.prop"></slot>
      </template>

      <!-- 表单按钮 -->
      <el-form-item v-if="showBtn" class="btns" :style="btnStyle">
        <slot name="elgsFormBtn">
          <el-button @click="resetForm(searchRef)">重置</el-button>
          <el-button type="primary" @click="search">查询</el-button>
        </slot>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
  import { ref, computed } from 'vue'
  import dayjs from 'dayjs'
  import formMoney from './FormMoney.vue'
  import selectInput from './SelectInput.vue'
  import SearchSelect from './SearchSelect.vue'
  import { getDateShortcuts, getPickerDisabledDate } from './date-utils'
  import FormFieldShell from './FormFieldShell.vue'
  import CardTitle from '../CardTitle.vue'

  const modelValue = defineModel('modelValue', {
    type: Object,
    default: () => ({}),
  })

  const props = defineProps({
    /**
     * 表单label和必填星号和输入框的位置
     * @type {Object}
     * @property {String} requireAsteriskPosition 必填星号的位置，可选值：left | right | top
     * @property {String} labelPosition 文字的位置，可选值：left | right | top
     * @property {String} labelAlign 标签文字对齐方式，可选值：left | right
     * @property {String} labelWidth 文字的位置，可选值：auto | 具体的px
     * @property {Boolean} showColon 是否显示 ':'
     */
    formLabelInfo: {
      type: Object,
      default: () => ({
        requireAsteriskPosition: 'right',
        labelPosition: 'top',
        labelAlign: 'left',
        labelWidth: 'auto',
        showColon: false,
      }),
    },

    /**
     * 表单配置项传入的数据对象
     * @type {Array}
     * @property {String|Array} prop 表单的key，如果用moneyrange支持输入[]
     * @property {String} key 用于表单查找，如果有动态表单（点击增加一组表单无限制的那种），传入
     * @property {String} type 表单的类型，可选值：input | textarea | password | select | radioGroup | radio | cascader | date | daterange | number | money | moneyrange | selectInput
     * @property {Boolean} disabled 是否禁用
     * @property {Array} propOption 只支持selectInput，组合输入框
     * @property {String} placeholder 表单输入框内提示文字，input默认：请输入加label，select默认：请选择
     * @property {String} maxlength 表单内容长度
     * @property {Boolean} clearable 是否显示输入框内X号，如果是select，根据枚举项如果没有"全部"的选项默认显示X号
     * @property {Object} autosize 只对textarea生效，输入框大小 默认值 {minRows: 2, maxRows: 4}
     * @property {Array} options 对select | radioGroup | radio | cascader生效，也可以通过selectOptions对象内传入（selectOptions对象的key和prop属性一致）[{label, value}]
     * @property {Object} dateValidateData 只对日期组件生效，限制选择范围
     * @property {Array} shortcuts 快捷按钮或选项
     * @property {Boolean} allowSpecialChars 输入框默认前后不能输入空字符，中间不能输入空字符，allowSpecialChars = true不校验中间是否输入空字符
     * @property {Boolean} isNotTrim 前后中间可以输入空字符
     * @property {String} unit 表单输入框后显示的单位
     * @property {Object|String} hint 表单输入框下显示的提示语，支持插槽，支持对象
     */
    formOptions: {
      type: Array,
      default: () => [],
    },

    /**
     * 表单校验规则
     * @type {Object}
     */
    rules: {
      type: Object,
      default: () => ({}),
    },

    /**
     * 是否显示查询重置按钮
     * @type {Boolean}
     */
    showBtn: {
      type: Boolean,
      default: true,
    },

    /**
     * 查询重置位置，可选值 right | 其他
     * @type {String}
     */
    btnPosition: {
      type: String,
      default: 'right',
    },

    /**
     * 一行展示几个表单项
     * @type {Number}
     */
    columns: {
      type: Number,
      default: 4,
    },

    /**
     * rule改变后是否立马检验一次
     * @type {Boolean}
     */
    validateOnRuleChange: {
      type: Boolean,
      default: false,
    },

    disabled: {
      type: Boolean,
      default: false,
    },

    title: {
      type: String,
      default: '',
    },

    titleTip: {
      type: String,
      default: '',
    },

    titleFontWeight: {
      type: [Number, String],
      default: 'bold',
    },

    titleSize: {
      type: Number,
      default: 16,
    },

    /**
     * 选择框的选项，可以通过这个对象传入，key和prop属性一致
     */
    selectOptions: {
      type: Object,
      default: () => ({}),
    },
  })

  const emit = defineEmits([
    'search',
    'reset',
    'change',
    'calendarChange',
    'formItemClick',
    'update:modelValue',
  ])

  const searchRef = ref(null)
  const startOrEndDate = ref({})

  // 筛选器遍历
  const _formOptions = computed(() => {
    let _formOptions = [...props.formOptions]
    _formOptions = _formOptions.filter((item) => item.visible !== false)

    _formOptions = _formOptions.map((item) => {
      const shortcuts = getDateShortcuts(item)

      let _props = item.props
      if (item.type === 'selectInput') {
        _props = item.propOption?.map((itemC) => itemC.prop)
      }

      return { ...item, shortcuts, _props }
    })

    return _formOptions
  })

  // 表单校验规则
  const _rules = computed(() => {
    const obj = { ...props.rules }

    _formOptions.value.forEach((item) => {
      // item.prop 有可能是数组（必须是两个目前）尤其是金额区间和组合输入框的时候，如果是props是单值返回的是
      // 日期区间特定
      item._props = null
      if (Array.isArray(item.prop) || Array.isArray(item.props)) {
        const _props = Array.isArray(item.prop) ? [...item.prop] : [...item.props]
        item._props = _props
        item.prop = _props[0]
      }

      // item.format 支持传多个参数有可能是数组
      if (item.format) {
        const formatArr = Array.isArray(item.format) ? item.format : [item.format]
        const ruleFormat = []

        formatArr.forEach((itemC) => {
          if (itemC === 'moneyrange') {
            ruleFormat.push({
              trigger: 'blur',
              validator: (rule, value, callback) => handleMoney(rule, value, callback, item),
            })
          }
          if (itemC === 'number') {
            ruleFormat.push({ trigger: 'blur', validator: handleNumber })
          }
          if (itemC === 'code') {
            ruleFormat.push({ trigger: 'blur', validator: handleCode })
          }
          if (itemC === 'letters') {
            ruleFormat.push({ trigger: 'blur', validator: handleLetters })
          }
          if (itemC === 'text') {
            ruleFormat.push({ trigger: 'blur', validator: handleText })
          }
          if (itemC === 'name') {
            ruleFormat.push({ trigger: 'blur', validator: handleName })
          }
          if (itemC === 'notAllSpace') {
            ruleFormat.push({ trigger: 'blur', validator: handleNotAllSpace })
          }
        })

        if (ruleFormat.length) {
          if (obj[item.prop]) {
            obj[item.prop] = [...obj[item.prop], ...ruleFormat]
          } else {
            obj[item.prop] = ruleFormat
          }
        }
      }

      if (item.required) {
        let ruleFormat = []
        if (item._props) {
          ruleFormat = [
            {
              required: true,
              message: `${item.label}不能为空`,
              trigger: ['blur', 'change'],
            },
            {
              trigger: ['blur', 'change'],
              validator: (...args) => handleRequiredArr(item, ...args),
            },
          ]
        } else {
          ruleFormat = [
            {
              required: true,
              message: `${item.label}不能为空`,
              trigger: ['blur', 'change'],
            },
          ]
        }

        if (ruleFormat.length) {
          if (obj[item.prop]) {
            obj[item.prop] = [...obj[item.prop], ...ruleFormat]
          } else {
            obj[item.prop] = ruleFormat
          }
        }
      }

      // 如果是input输入框都需要按输入内容中是否有特殊字符，目前特殊字符只有空格
      if (item.type === 'input' && !item.allowSpecialChars) {
        if (obj[item.prop]) {
          obj[item.prop] = [...obj[item.prop], { trigger: 'blur', validator: handleIllegal }]
        } else {
          obj[item.prop] = [{ trigger: 'blur', validator: handleIllegal }]
        }
      }
    })

    return obj
  })

  // 查询重置按钮自动补位，如果都满了自动新开一行
  const btnStyle = computed(() => {
    const len = _formOptions.value.length
    if (props.btnPosition === 'right') {
      return {
        'grid-column': `${(len % props.columns) + 1} / ${props.columns + 1}`,
        'justify-self': 'flex-end',
      }
    } else {
      return {
        'grid-column': `${(len % props.columns) + 1} / ${props.columns + 1}`,
        'justify-self': 'flex-start',
      }
    }
  })

  const formStyle = computed(() => ({
    'grid-template-columns': `repeat(${props.columns}, 1fr)`,
    gap: props.formLabelInfo.labelPosition === 'top' ? '16px 24px' : '20px 24px',
  }))

  const formLabelAlignClass = computed(() =>
    props.formLabelInfo.labelAlign === 'right' ? 'form--label-right' : 'form--label-left'
  )

  // 获取表单项的选项
  const formItemOptions = (item) => {
    return item.options || props.selectOptions[item.prop] || []
  }

  // 获取表单项是否可清除
  const formItemClearable = (item) => {
    const obj = item.options || props.selectOptions[item.prop] || []
    const isHaveAll = obj.some((itemC) => itemC.label === '全部')

    // 为undefined证明没有估值，通过判断枚举项是否有"全部"，如果有返回false否则true
    if (item.clearable === undefined) {
      return !isHaveAll
    }
    return Boolean(item.clearable)
  }

  // 表单验证方法
  const validate = (callback) => {
    return searchRef.value.validate(callback)
  }

  const resetFields = (prop) => {
    clearArrPropData(prop)
    return searchRef.value.resetFields(prop)
  }

  const validateField = (prop) => {
    return searchRef.value.validateField(prop)
  }

  const clearValidate = (prop) => {
    // clearArrPropData(prop)
    return searchRef.value.clearValidate(prop)
  }

  defineExpose({
    validate,
    resetFields,
    validateField,
    clearValidate,
  })

  // 清空数组属性数据
  const clearArrPropData = (prop) => {
    if (prop) {
      startOrEndDate.value[prop] = {}
      _formOptions.value?.forEach((item) => {
        if (item?._props?.[0] === prop || item?._props?.[1] === prop) {
          const res = item?._props?.[1]
          if (res) {
            modelValue.value[item._props[0]] = ''
            modelValue.value[item._props[1]] = ''
          }
        }
      })
    } else {
      startOrEndDate.value = {}
      _formOptions.value?.forEach((item) => {
        const res = item?._props?.[1]
        if (res) {
          modelValue.value[item._props[0]] = ''
          modelValue.value[item._props[1]] = ''
        }
      })
    }
  }

  // 内置日期校验方法
  const pickerChange = (e, prop, obj, modelValue) => {
    if (!e) {
      startOrEndDate.value[prop] = {}
    }
    elgsFormChange(e, prop, obj, modelValue)
  }

  // 存一下当前选中的值，为了动态校验时间范围的
  const pickerCalendarChange = (e, prop, item, modelValue) => {
    if (e.length > 0) {
      startOrEndDate.value[prop] = {
        startDate: e[0] ? dayjs(e[0]).format('YYYYMMDD') : null,
        endDate: e[1] ? dayjs(e[1]).format('YYYYMMDD') : null,
      }
    } else {
      startOrEndDate.value[prop] = {}
    }
    emit('calendarChange', e, prop, item, modelValue)
  }

  const pickerDisabledDate = (time, item) => {
    return getPickerDisabledDate(time, item, startOrEndDate.value)
  }

  // 搜索按钮点击事件
  const search = () => {
    if (!searchRef.value) return
    searchRef.value.validate((valid) => {
      if (valid) {
        emit('search')
      }
    })
  }

  // 重置表单
  const resetForm = (formEl = undefined) => {
    if (!formEl) return
    // _props 如果是两个值那就证明prop传入的就是两个值但是form表单默认是清除一个值的，所以手动清除第二
    clearArrPropData()
    searchRef.value.resetFields()
    emit('reset')
  }

  // 表单变化事件
  const elgsFormChange = (value, prop, item, modelValue) => {
    emit('change', value, prop, item, modelValue)
  }

  // 表单项点击事件
  const elgsFormClick = (event, prop, item, modelValue) => {
    emit('formItemClick', event, prop, item, modelValue)
  }

  // 内置验证方法
  const handleNumber = (rule, value, callback) => {
    if (!value) callback()
    const reg = new RegExp('^[0-9]+$')
    if (!reg.test(value)) {
      callback(new Error('您输入的格式有限，只支持纯数字'))
    } else {
      callback()
    }
  }

  const handleRequiredArr = (item, rule, value, callback) => {
    if (!modelValue.value[item._props[0]] || !modelValue.value[item._props[1]]) {
      callback(`${item.label}不能为空`)
    } else {
      callback()
    }
  }

  const handleMoney = (rule, value, callback, item) => {
    const start = item.props ? modelValue.value[item.props[0]] : value?.[0]
    const end = item.props ? modelValue.value[item.props[1]] : value?.[1]

    // 如果其中有无值不校验
    if (!start || !end) {
      callback()
      return
    }

    if (Number(start) > Number(end)) {
      callback('最小金额不能大于最大金额')
    } else {
      callback()
    }
  }

  const handleText = (rule, value, callback) => {
    if (!value) callback()
    const reg = new RegExp('^[\u4e00-\u9fa5]*$')
    if (!reg.test(value)) {
      callback(new Error('您输入的格式有误，只支持中文'))
    } else {
      callback()
    }
  }

  const handleName = (rule, value, callback) => {
    // 5.15,所有证件类型姓名规则：不能被数字、不能单个字母、首尾不能有空格、不能有换行符、长度最大14
    if (!value) callback()
    const reg = new RegExp('^(?![0-9]+$)(?![a-zA-Z]$)(?!^ +| +$)(?![\n\r]+).{2,100}$')
    if (!reg.test(value)) {
      callback(new Error('您输入的格式有限，请重新输入'))
    } else {
      callback()
    }
  }

  const handleNotAllSpace = (rule, value, callback) => {
    // 校验是不是全是空白字符
    if (!value) callback()
    const reg = new RegExp('^\\s*$')
    if (reg.test(value)) {
      callback(new Error('您输入的格式有限，请重新输入'))
    } else {
      callback()
    }
  }

  const handleIllegal = (rule, value, callback) => {
    // 校验有没有空格
    if (!value) callback()
    const reg = new RegExp('\\s')
    if (!reg.test(value)) {
      callback()
    } else {
      callback(new Error('您输入的格式有限，请重新输入'))
    }
  }

  const handleCode = (rule, value, callback) => {
    if (!value) callback()
    const reg = new RegExp('^[a-zA-Z0-9]+$')
    if (!reg.test(value)) {
      callback(new Error('您输入的格式有限，只支持字母和数字'))
    } else {
      callback()
    }
  }

  const handleLetters = (rule, value, callback) => {
    if (!value) callback()
    const reg = new RegExp('^[a-zA-Z]+$')
    if (!reg.test(value)) {
      callback(new Error('您输入的格式有限，只支持字母'))
    } else {
      callback()
    }
  }

  // 数字输入处理
  const handleInput = (e, prop, item, modelValue) => {
    let format = ''
    if (item.format === 'number') {
      format = /[^0-9]/g
    }
    // if (item.format === 'code') {
    //   format = /[^a-zA-Z0-9]/g
    // }
    // if (item.format === 'letters') {
    //   format = /[^a-zA-Z]/g
    // }
    // if (item.format === 'text') {
    //   format = /[^\u4e00-\u9fa5]/g
    // }

    if (format) {
      modelValue[prop] = e.replace(format, '')
    }

    elgsFormChange(e, prop, item, modelValue)
  }
</script>

<style lang="scss" scoped>
  .search-container {
    --el-component-size: 32px;
    --el-input-height: 32px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }

  :deep(.el-form-item__error) {
    padding-top: 4px;
  }

  .form {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    align-items: flex-start;
    gap: 16px 24px;
  }

  .form-item {
    :deep(.el-input),
    :deep(.el-select),
    :deep(.el-cascader),
    :deep(.el-date-editor),
    :deep(.el-input-number) {
      width: 100%;
    }
  }

  .el-form-item {
    margin: 0;
    min-width: 0;
    align-items: flex-start;
  }

  :deep(.el-form-item__content) {
    width: 100%;
    min-width: 0;
  }

  :deep(.el-input__inner),
  :deep(.el-textarea__inner),
  :deep(input),
  :deep(textarea) {
    /* 统一到 16px，避免移动端浏览器聚焦时触发自动放大。 */
    font-size: 16px;
  }

  .form--label-left :deep(.el-form-item__label) {
    justify-content: flex-start;
    text-align: left;
  }

  .form--label-right :deep(.el-form-item__label) {
    justify-content: flex-end;
    text-align: right;
  }

  .btns {
    justify-content: flex-end;
    align-self: flex-end;
    align-items: flex-end;
    justify-self: flex-end;
  }
</style>
