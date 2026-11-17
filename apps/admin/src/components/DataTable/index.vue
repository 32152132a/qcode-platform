<template>
  <div class="data-table">
    <QyqTable
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :data="pageRows"
      :columns="tableColumns"
      :total="total"
      height="100%"
      :pagination-config="serverPagination ? { layout: 'total, prev, pager, next' } : {}"
    >
      <template #actions-cell="{ row }"
        ><div class="row-actions">
          <el-button
            v-for="action in actions.filter((item) => !item.visible || item.visible(row))"
            :key="action.label"
            link
            :type="action.danger ? 'danger' : 'primary'"
            :loading="busy === String(row.id) + action.label"
            @click="run(action, row)"
            >{{ action.label }}</el-button
          >
        </div></template
      >
    </QyqTable>
  </div>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import { usePage } from '@/hooks/usePage'
  import QyqTable from '@/components/qyq-table/index.vue'
  import type { Row, Column } from '@/types'
  export interface RowAction {
    label: string
    danger?: boolean
    visible?: (row: Row) => boolean
    run: (row: Row) => unknown | Promise<unknown>
  }
  const props = withDefaults(
    defineProps<{
      rows: Row[]
      columns: Column[]
      actions?: RowAction[]
      serverPagination?: { page: number; pageSize: number; total: number }
    }>(),
    { actions: () => [] }
  )
  const emit = defineEmits<{ 'page-change': [page: number] }>()
  const busy = ref('')
  const {
    page: localPage,
    pageSize: localPageSize,
    offset,
  } = usePage(() => props.rows.length)
  const total = computed(() => props.serverPagination?.total ?? props.rows.length)
  const currentPage = computed({
    get: () => props.serverPagination?.page ?? localPage.value,
    set: (value) => {
      if (props.serverPagination) emit('page-change', value)
      else localPage.value = value
    },
  })
  const pageSize = computed({
    get: () => props.serverPagination?.pageSize ?? localPageSize.value,
    set: (value) => {
      if (!props.serverPagination) localPageSize.value = value
    },
  })
  const pageRows = computed(() =>
    props.serverPagination
      ? props.rows
      : props.rows.slice(offset.value, offset.value + localPageSize.value)
  )
  const tableColumns = computed(() =>
    props.actions.length
      ? [
          ...props.columns,
          {
            prop: 'actions',
            label: '操作',
            minWidth: props.actions.length === 1 ? 110 : 230,
            fixed: 'right' as const,
            align: 'center' as const,
            headerAlign: 'center' as const,
          },
        ]
      : props.columns
  )
  async function run(action: RowAction, row: Row) {
    busy.value = String(row.id) + action.label
    try {
      await action.run(row)
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      busy.value = ''
    }
  }
</script>
<style scoped lang="scss">
  .data-table {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 240px;
    min-width: 0;
    .row-actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      .el-button {
        margin: 0;
      }
    }
  }
</style>
