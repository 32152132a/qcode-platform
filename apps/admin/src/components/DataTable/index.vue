<template>
  <div class="data-table">
    <QyqForm
      @submit.prevent
      v-if="searchable"
      v-model="search"
      class="table-search"
      :columns="1"
      :show-btn="false"
      :form-options="searchFields"
    />
    <QyqTable
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :data="pageRows"
      :columns="tableColumns"
      :total="total"
      :max-height="440"
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
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import { usePage } from '@/hooks/usePage'
  import QyqTable from '@/components/qyq-table/index.vue'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
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
      searchable?: boolean
      serverPagination?: { page: number; pageSize: number; total: number }
    }>(),
    { actions: () => [], searchable: true }
  )
  const emit = defineEmits<{ 'page-change': [page: number] }>()
  const search = ref<Row>({ query: '' }),
    busy = ref('')
  const searchFields: FormItemProp[] = [
    {
      prop: 'query',
      type: 'input',
      label: '搜索当前列表',
      placeholder: '搜索当前列表',
      clearable: true,
      isNotTrim: true,
      allowSpecialChars: true,
    },
  ]
  const filtered = computed(() =>
    props.rows.filter((row) =>
      JSON.stringify(row)
        .toLowerCase()
        .includes(
          String(search.value.query || '')
            .trim()
            .toLowerCase()
        )
    )
  )
  const {
    page: localPage,
    pageSize: localPageSize,
    offset,
    resetPage,
  } = usePage(() => filtered.value.length)
  const total = computed(() => props.serverPagination?.total ?? filtered.value.length)
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
      : filtered.value.slice(offset.value, offset.value + localPageSize.value)
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
  watch(() => search.value.query, resetPage)
</script>
<style scoped lang="scss">
  .data-table {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 18px;
    .table-search {
      width: 100%;
      max-width: 320px;
      min-width: 0;
    }
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
