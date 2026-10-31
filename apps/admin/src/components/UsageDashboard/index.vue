<template>
  <PagePanel
    class="usage-dashboard"
    title="用量统计"
    description="按真实 Token 统计消耗；调用成本按配置单价计算，不等同于供应商账单。"
    :loading="loading"
    :error="error"
  >
    <template #actions><el-button @click="load">刷新</el-button></template>
    <QyqForm
      v-model="filters"
      :columns="3"
      :form-options="fields"
      :show-btn="false"
      @submit.prevent
    >
      <template #dates
        ><el-date-picker
          v-model="dates"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
      /></template>
    </QyqForm>
    <el-space
      ><el-button type="primary" @click="apply">查询</el-button
      ><el-button @click="reset">重置</el-button></el-space
    >
    <template v-if="data">
      <div class="metrics">
        <el-statistic title="实际 Token" :value="data.totals.tokens" /><el-statistic
          title="请求数"
          :value="data.totals.requests"
        />
        <div>
          <el-text type="info" size="small">模型调用成本</el-text>
          <p>{{ cost(data.totals.costs, data.totals.unknownCost) }}</p>
        </div>
      </div>
      <el-text v-if="data.totals.unknownUsage || data.totals.unknownCost" type="info" size="small"
        >{{ data.totals.unknownUsage }} 个已结束请求未返回用量，{{
          data.totals.unknownCost
        }}
        个请求成本未知；未知部分不按零消耗计算。</el-text
      >
      <el-card class="trend-panel" shadow="never"><UsageTrend :days="data.days" /></el-card>
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
  import { computed, ref, watch } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable from '@/components/DataTable/index.vue'
  import QyqForm from '@/components/qyq-form/index.vue'
  import UsageTrend from '@/components/UsageTrend/index.vue'
  import { useResource } from '@/hooks/useResource'
  import type { OverviewUsage } from '@/types/usage'
  import type { Column } from '@/types'
  import type { FormItemProp } from '@/components/qyq-form/types'
  const query = ref(''),
    dates = ref<string[]>([]),
    filters = ref({ userId: '', modelId: '' }),
    tab = ref<'users' | 'models' | 'days'>('users')
  const options = ref<OverviewUsage>()
  const { data, loading, error, load } = useResource<OverviewUsage>(
    () => '/admin/usage' + query.value,
  )
  const fields = computed<FormItemProp[]>(() => [
    { prop: 'dates', label: '日期范围', type: 'custom' },
    {
      prop: 'userId',
      label: '用户',
      type: 'select',
      clearable: true,
      filterable: true,
      placeholder: '全部用户',
      options: (options.value?.users || []).map((row) => ({
        label: row.username || '未知用户',
        value: String(row.userId),
      })),
    },
    {
      prop: 'modelId',
      label: '模型',
      type: 'select',
      clearable: true,
      filterable: true,
      placeholder: '全部模型',
      options: (options.value?.models || [])
        .filter((row) => row.modelId)
        .map((row) => ({ label: row.name || '未知模型', value: String(row.modelId) })),
    },
  ])
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
  function apply() {
    const params = new URLSearchParams()
    if (dates.value?.length === 2) {
      params.set('from', dates.value[0])
      params.set('to', dates.value[1])
    }
    if (filters.value.userId) params.set('userId', filters.value.userId)
    if (filters.value.modelId) params.set('modelId', filters.value.modelId)
    const next = params.size ? '?' + params : ''
    if (query.value === next) void load()
    else query.value = next
  }
  function reset() {
    filters.value = { userId: '', modelId: '' }
    dates.value = []
    apply()
  }
  watch(data, (value) => {
    if (value && !query.value) options.value = value
  })
</script>
<style scoped lang="scss">
  .usage-dashboard {
    :deep(.data-table) {
      min-height: 420px;
      flex-shrink: 0;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      flex-shrink: 0;
      p {
        margin: 8px 0 0;
        font-size: 22px;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
    }
    .trend-panel {
      flex-shrink: 0;
    }
    .usage-tabs {
      flex-shrink: 0;
    }
    @media (max-width: 650px) {
      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        > :last-child {
          grid-column: 1/-1;
        }
      }
    }
  }
</style>
