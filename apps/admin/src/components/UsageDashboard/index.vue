<template>
  <PagePanel
    class="usage-dashboard"
    title="用量统计"
    description="按真实 Token 统计消耗；调用成本按配置单价计算，不等同于供应商账单。"
    :loading="loading"
    :error="error"
  >
    <template #actions><el-button @click="load">刷新</el-button></template>
    <template v-if="data">
      <el-tabs v-model="tab" class="usage-tabs"
        ><el-tab-pane label="按用户" name="users" /><el-tab-pane
          label="按模型"
          name="models" /><el-tab-pane label="每日明细" name="days"
      /></el-tabs>
      <DataTable :rows="data[tab]" :columns="columns" />
    </template>
  </PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable from '@/components/DataTable/index.vue'
  import { useResource } from '@/hooks/useResource'
  import type { OverviewUsage } from '@/types/usage'
  import type { Column } from '@/types'
  const tab = ref<'users' | 'models' | 'days'>('users')
  const { data, loading, error, load } = useResource<OverviewUsage>(() => '/admin/usage')
  const columns = computed<Column[]>(() => [
    tab.value === 'users'
      ? { prop: 'username', label: '用户' }
      : tab.value === 'models'
        ? { prop: 'name', label: '模型', minWidth: 180 }
        : { prop: 'date', label: '日期', minWidth: 130 },
    { prop: 'inputTokens', label: '输入 Token', minWidth: 125 },
    { prop: 'outputTokens', label: '输出 Token', minWidth: 125 },
    { prop: 'tokens', label: '总 Token', minWidth: 125 },
    {
      prop: 'costs',
      label: '调用成本',
      minWidth: 160,
      render: (row) => cost(row.costs, row.unknownCost),
    },
    { prop: 'requests', label: '请求数' },
    { prop: 'unknownUsage', label: '用量未知', minWidth: 120 },
  ])
  function cost(amounts: unknown, unknownCount: unknown) {
    const values = Object.entries(amounts && typeof amounts === 'object' ? amounts : {}).map(
      ([currency, value]) =>
        currency + ' ' + Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 }),
    )
    return values.length
      ? values.join(' / ') + (unknownCount ? '（部分未知）' : '')
      : unknownCount
        ? '未知'
        : '—'
  }
</script>
<style scoped lang="scss">
  .page-panel.usage-dashboard {
    overflow: hidden;
    :deep(.table), :deep(.page-content) { overflow: hidden; }
    :deep(.data-table) {
      min-height: 0;
    }
    .usage-tabs {
      flex-shrink: 0;
    }
  }
</style>
