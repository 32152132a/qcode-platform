<template>
  <div class="data-table">
    <el-input
      v-model="search"
      placeholder="搜索当前列表"
      clearable
      aria-label="搜索当前列表"
    /><QyqTable :data="filtered" :columns="tableColumns" :show-pagination="false"
      ><template #actions-cell="{ row }"
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
      ></QyqTable
    >
  </div>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import QyqTable from '@/components/qyq-table/index.vue'
  import type { Row, Column } from '@/types'
  export interface RowAction {
    label: string
    danger?: boolean
    visible?: (row: Row) => boolean
    run: (row: Row) => unknown | Promise<unknown>
  }
  const props = withDefaults(
    defineProps<{ rows: Row[]; columns: Column[]; actions?: RowAction[] }>(),
    { actions: () => [] }
  )
  const search = ref(''),
    busy = ref('')
  const filtered = computed(() =>
    props.rows.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(search.value.toLowerCase())
    )
  )
  const tableColumns = computed(() =>
    props.actions.length
      ? [...props.columns, { prop: 'actions', label: '操作', minWidth: 230 }]
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
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 18px;
    > .el-input {
      max-width: 320px;
    }
    .row-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .row-actions .el-button {
      margin: 0;
    }
  }
</style>
