<template>
  <div class="advanced-table-wrapper">
    <div v-if="$slots.toolbar" class="advanced-table-toolbar">
      <slot name="toolbar"></slot>
    </div>
    <!-- 表格内容 -->
    <el-table
      v-loading="loading"
      :data="tableData"
      :border="border"
      :stripe="stripe"
      :size="size"
      :max-height="maxHeight"
      :row-key="resolvedRowKey"
      :default-sort="resolvedDefaultSort"
      :cell-style="getCellStyle"
      :header-cell-style="getHeaderCellStyle"
      @sort-change="handleSortChange"
      class="advanced-table"
    >
      <!-- 自定义表头插槽 -->
      <template #header>
        <slot name="header"></slot>
      </template>

      <!-- 表格列渲染 -->
      <el-table-column
        v-for="column in columns"
        :key="column.prop || column.label"
        :prop="column.prop"
        :label="column.label"
        :width="computedColumnWidth(column)"
        :min-width="column.minWidth"
        :fixed="column.fixed"
        :sortable="column.sortable"
        :sort-method="column.sortMethod"
        :sort-by="column.sortBy"
        :sort-orders="column.sortOrders"
        :resizable="column.resizable"
        :align="column.align"
        :header-align="column.headerAlign"
        :show-overflow-tooltip="column.showOverflowTooltip"
      >
        <!-- 自定义列模板插槽 -->
        <template #default="scope">
          <!-- 优先使用局部插槽 -->
          <slot
            :name="`${column.prop || column.label}-cell`"
            :row="scope.row"
            :column="column"
            :index="scope.$index"
          >
            <!-- 操作按钮渲染 -->
            <template v-if="column.buttons && column.buttons.length > 0">
              <div class="operate-buttons">
                <!-- 显示前3个按钮 -->
                <el-button
                  v-for="(button, btnIndex) in column.buttons.slice(0, 3)"
                  :key="btnIndex"
                  :type="button.type || 'primary'"
                  :size="normalizeSize(button.size) || size"
                  :icon="button.icon"
                  @click="handleOperateButtonClick(scope.row)"
                  :class="`operate-button-${btnIndex}`"
                >
                  {{ button.text }}
                </el-button>
                <!-- 更多按钮下拉菜单 -->
                <el-dropdown v-if="column.buttons.length > 3">
                  <el-button type="primary" link :size="size || 'default'">
                    更多<el-icon class="el-icon--right"><arrow-down /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="(button, btnIndex) in column.buttons.slice(3)"
                        :key="btnIndex"
                        @click="handleOperateButtonClick(scope.row)"
                      >
                        <span v-if="button.icon"><el-icon :component="button.icon"></el-icon></span>
                        {{ button.text }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
            <!-- 编码转换 -->
            <template v-else-if="column.codeMap">
              {{ getCodeValue(scope.row[column.prop], column.codeMap) }}
            </template>
            <!-- 自定义渲染函数 -->
            <template v-else-if="column.render">
              {{ column.render(scope.row, column, scope.$index) }}
            </template>
            <!-- 默认显示 + Tooltip提示 -->
            <template v-else>
              <el-tooltip
                v-if="column.tooltip"
                :content="
                  column.tooltipContent
                    ? column.tooltipContent(scope.row, column, scope.$index)
                    : scope.row[column.prop]
                "
                :effect="column.tooltipEffect || 'light'"
                :placement="column.tooltipPlacement || 'top'"
                :disabled="!column.tooltip"
              >
                <span>{{ scope.row[column.prop] }}</span>
              </el-tooltip>
              <span v-else>{{ scope.row[column.prop] }}</span>
            </template>
          </slot>
        </template>

        <!-- 自定义列头插槽 -->
        <template #header-cell="scope">
          <slot :name="`${column.prop || column.label}-header`" :column="scope.column">
            {{ scope.column.label }}
          </slot>
        </template>
      </el-table-column>

      <!-- 自定义表尾插槽 -->
      <template #append>
        <slot name="append"></slot>
      </template>

      <!-- 空状态插槽 -->
      <template #empty>
        <slot name="empty">
          <el-empty description="暂无数据"></el-empty>
        </slot>
      </template>
    </el-table>

    <!-- 分页组件 -->
    <div v-if="showPagination" class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="resolvedPageSizes"
        :layout="resolvedPaginationLayout"
        :total="total"
        :background="resolvedBackground"
        :small="resolvedSmall"
        :hide-on-single-page="resolvedHideOnSinglePage"
        :pager-count="pagerCount"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      >
        <template #prev-text>
          <slot name="pagination-prev">上一页</slot>
        </template>
        <template #next-text>
          <slot name="pagination-next">下一页</slot>
        </template>
      </el-pagination>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'
  import { ArrowDown } from '@element-plus/icons-vue'

  // 类型定义
  interface CodeMap {
    [key: string | number]: string
  }

  interface OperateButton {
    text: string
    type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'text'
    size?: 'large' | 'default' | 'small' | 'mini'
    icon?: any
    disabled?: (row: any, index: number) => boolean
    loading?: (row: any, index: number) => boolean
    onClick: (row: any, index: number) => void
  }

  // 自定义列配置类型
  interface AdvancedTableColumn {
    prop: string
    label: string
    width?: number | string
    minWidth?: number
    fixed?: boolean | 'left' | 'right'
    sortable?: boolean | string
    sortMethod?: (a: any, b: any) => number
    sortBy?: string | string[]
    sortOrders?: Array<'ascending' | 'descending' | null>
    resizable?: boolean
    align?: 'left' | 'center' | 'right'
    headerAlign?: 'left' | 'center' | 'right'
    showOverflowTooltip?: boolean
    codeMap?: CodeMap
    tooltip?: boolean
    tooltipContent?: (row: any, column: AdvancedTableColumn, index: number) => string
    tooltipEffect?: 'dark' | 'light'
    tooltipPlacement?:
      | 'top'
      | 'top-start'
      | 'top-end'
      | 'bottom'
      | 'bottom-start'
      | 'bottom-end'
      | 'left'
      | 'left-start'
      | 'left-end'
      | 'right'
      | 'right-start'
      | 'right-end'
    render?: (row: any, column: AdvancedTableColumn, index: number) => string
    buttons?: Array<{
      type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'text'
      size?: 'large' | 'default' | 'small' | 'mini'
      text: string
      icon?: any
      handler: (row: any) => void
    }>
  }

  // 自定义排序类型
  interface SortConfig {
    prop?: string
    order?: 'ascending' | 'descending' | null
  }

  // 自定义分页配置类型
  interface PaginationConfig {
    pageSizes?: number[]
    layout?: string
    background?: boolean
    small?: boolean
    hideOnSinglePage?: boolean
  }

  interface AdvancedTableProps {
    // 表格数据
    data: any[]
    // 表格列配置
    columns: AdvancedTableColumn[]
    // 加载状态
    loading?: boolean
    // 是否显示边框
    border?: boolean
    // 是否为斑马纹表格
    stripe?: boolean
    // 表格尺寸
    size?: 'large' | 'default' | 'small'
    // 最大高度
    maxHeight?: number | string
    // 行数据的 Key
    rowKey?: string | ((row: any) => string | number)
    // 默认排序
    defaultSort?: SortConfig
    // 显示分页
    showPagination?: boolean
    // 当前页码
    currentPage?: number
    // 每页条数
    pageSize?: number
    // 总条数
    total?: number
    // 分页配置
    paginationConfig?: Partial<PaginationConfig>
    // 显示操作列
    showOperateColumn?: boolean
    // 操作列标题
    operateColumnLabel?: string
    // 操作列宽度
    operateColumnWidth?: number | string
    // 操作列固定
    operateColumnFixed?: boolean | 'left' | 'right'
    // 操作列对齐方式
    operateColumnAlign?: 'left' | 'center' | 'right'
    // 操作列表头对齐方式
    operateColumnHeaderAlign?: 'left' | 'center' | 'right'
    // 操作按钮配置
    operateButtons?: OperateButton[]
  }

  // Props
  const props = withDefaults(defineProps<AdvancedTableProps>(), {
    loading: false,
    border: false,
    stripe: false,
    size: 'default',
    showPagination: true,
    currentPage: 1,
    pageSize: 10,
    total: 0,
    paginationConfig: () => ({}),
    showOperateColumn: false,
    operateColumnLabel: '操作',
    operateColumnWidth: 200,
    operateColumnFixed: 'right',
    operateColumnAlign: 'center',
    operateColumnHeaderAlign: 'center',
    operateButtons: () => [],
  })

  // Emits
  const emit = defineEmits<{
    'update:currentPage': [page: number]
    'update:pageSize': [size: number]
    'sort-change': [sort: SortConfig]
    'operate-button-click': [row: any]
  }>()

  // 计算属性：表格数据
  const tableData = computed(() => props.data)
  const isNarrowScreen = ref(false)
  const normalizeSize = (s?: 'large' | 'default' | 'small' | 'mini') => (s === 'mini' ? 'small' : s)
  const resolvedRowKey = computed(() => {
    if (!props.rowKey) return undefined
    if (typeof props.rowKey === 'string') return props.rowKey
    const fn = props.rowKey
    return (row: any) => String(fn(row) ?? '')
  })

  const resolvedDefaultSort = computed(() => {
    const prop = props.defaultSort?.prop
    const order = props.defaultSort?.order
    if (!prop) return undefined
    if (order !== 'ascending' && order !== 'descending') return undefined
    return { prop, order }
  })
  const updateScreenState = () => {
    isNarrowScreen.value = window.innerWidth <= 768
  }

  const alignConfigByProp = computed(() => {
    const map = new Map<
      string,
      { align?: 'left' | 'center' | 'right'; headerAlign?: 'left' | 'center' | 'right' }
    >()
    for (const c of props.columns) {
      map.set(c.prop, { align: c.align, headerAlign: c.headerAlign })
    }
    return map
  })

  const getCellStyle = (ctx: any): CSSProperties => {
    const prop = String(ctx?.column?.property || '')
    const cfg = alignConfigByProp.value.get(prop)
    const align = cfg?.align || 'center'
    return { textAlign: align }
  }

  const getHeaderCellStyle = (ctx: any): CSSProperties => {
    const prop = String(ctx?.column?.property || '')
    const cfg = alignConfigByProp.value.get(prop)
    const align = cfg?.headerAlign || cfg?.align || 'center'
    return { textAlign: align }
  }

  // 计算属性：动态计算操作列宽度
  const computedColumnWidth = computed(() => {
    return (column: AdvancedTableColumn) => {
      if (!column.buttons) {
        return column.width
      }

      // 基础宽度（按钮+间距）：每个按钮约80px，间距8px
      const baseWidth = 60
      const buttonWidth = 40
      const gapWidth = 8

      // 计算按钮数量：
      // 1. 优先使用columns中operation列的按钮
      // 2. 如果没有则使用props.operateButtons
      let buttonCount = 0
      const operationColumn = props.columns.find((col) => col.prop === 'operation')

      if (operationColumn?.buttons) {
        // 如果operation列有按钮，使用其按钮数量
        buttonCount = operationColumn.buttons.length
      } else {
        // 否则使用props.operateButtons的数量
        buttonCount = props.operateButtons.length
      }

      // 根据按钮数量计算可见按钮数和总宽度
      const visibleButtonCount = Math.min(buttonCount, 3)
      const hasMoreButton = buttonCount > 3
      const totalVisibleElements = visibleButtonCount + (hasMoreButton ? 1 : 0)

      // 计算宽度：基础宽度 + (按钮数量-1)*间距
      const width = baseWidth + (totalVisibleElements - 1) * (buttonWidth + gapWidth)

      // 确保宽度不小于最小宽度，处理operateColumnWidth可能是string的情况
      return Math.max(width, 100)
    }
  })

  // 内部状态：当前页码
  const currentPage = computed({
    get: () => props.currentPage,
    set: (val) => emit('update:currentPage', val),
  })

  // 内部状态：每页条数
  const pageSize = computed({
    get: () => props.pageSize,
    set: (val) => emit('update:pageSize', val),
  })

  // 处理排序变化
  const handleSortChange = (sort: SortConfig) => {
    emit('sort-change', sort)
  }

  const resolvedPageSizes = computed(() => props.paginationConfig.pageSizes || [10, 20, 50, 100])

  const resolvedPaginationLayout = computed(() => {
    if (props.paginationConfig.layout) {
      return props.paginationConfig.layout
    }
    return isNarrowScreen.value ? 'prev, pager, next' : 'total, sizes, prev, pager, next, jumper'
  })

  const resolvedBackground = computed(() =>
    props.paginationConfig.background === undefined ? true : props.paginationConfig.background
  )

  const resolvedSmall = computed(() =>
    props.paginationConfig.small === undefined ? false : props.paginationConfig.small
  )

  const resolvedHideOnSinglePage = computed(() =>
    props.paginationConfig.hideOnSinglePage === undefined
      ? false
      : props.paginationConfig.hideOnSinglePage
  )

  const pagerCount = computed(() => (isNarrowScreen.value ? 5 : 7))

  // 处理页码变化
  const handleCurrentChange = (page: number) => {
    emit('update:currentPage', page)
  }

  // 处理每页条数变化
  const handleSizeChange = (size: number) => {
    emit('update:pageSize', size)
  }

  // 处理操作按钮点击
  const handleOperateButtonClick = (row: any) => {
    emit('operate-button-click', row)
  }

  // 编码转换函数
  const getCodeValue = (code: string | number, codeMap: CodeMap): string => {
    const value = codeMap[code]
    return value !== undefined ? value : String(code)
  }

  onMounted(() => {
    updateScreenState()
    window.addEventListener('resize', updateScreenState)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateScreenState)
  })
</script>

<style lang="scss" scoped>
  .advanced-table-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .advanced-table-toolbar {
    display: flex;
    justify-content: end;
    width: 100%;
  }

  .advanced-table {
    width: 100%;
    flex: 1;
  }

  .advanced-table :deep(.el-table__header-wrapper th.el-table__cell) {
    background: rgba(0, 0, 0, 0.02);
  }

  .advanced-table :deep(.el-table__header-wrapper .cell) {
    color: #606266;
    font-weight: 600;
  }

  .pagination-wrapper {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 12px 0;
  }

  .operate-buttons {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .operate-buttons :deep(.el-button) {
    margin: 0;
  }
</style>
