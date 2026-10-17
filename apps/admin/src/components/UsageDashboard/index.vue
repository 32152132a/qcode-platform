<template>
  <PagePanel
    class="usage-dashboard"
    :title="title || '用量统计'"
    description="实际用量与保守计费分开展示。成本由请求时配置单价估算，各币种独立统计。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-date-picker
        v-model="dates"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
      /><el-button @click="apply">查询</el-button
      ><el-button @click="reset">全部日期</el-button></template
    ><template v-if="data"
      ><div class="metrics">
        <el-card v-for="item in metrics" :key="item.label" shadow="never"
          ><span>{{ item.label }}</span
          ><strong>{{ item.value }}</strong></el-card
        >
      </div>
      <el-alert
        :title="
          '成功 ' +
          data.totals.success +
          ' · 失败/中断 ' +
          data.totals.failed +
          ' · 进行中 ' +
          data.totals.pending +
          ' · 统计时区 ' +
          data.timezone
        "
        type="info"
        :closable="false" /><el-card shadow="never"
        ><h3>每日 Token 趋势</h3>
        <div
          v-show="data.days.length"
          ref="chart"
          class="chart"
          role="img"
          aria-label="每日实际 Token 和保守计费 Token 趋势" />
        <el-empty v-if="!data.days.length" description="所选日期暂无请求" /></el-card
      ><el-card shadow="never"
        ><h3>估算成本</h3>
        <p v-if="!Object.keys(data.totals.costs).length">暂无可计算成本</p>
        <p v-for="(amount, currency) in data.totals.costs" :key="currency">
          {{ currency }} {{ Number(amount).toFixed(6) }}
        </p>
        <el-text type="info"
          >{{ data.totals.unknownCost }} 个请求成本未知，不按零成本计算。</el-text
        ></el-card
      ><el-tabs
        ><el-tab-pane label="用户用量排行"
          ><DataTable :rows="data.users" :columns="userColumns" /></el-tab-pane
        ><el-tab-pane label="模型用量"
          ><DataTable :rows="data.models" :columns="groupColumns" /></el-tab-pane
        ><el-tab-pane label="部门用量"
          ><DataTable :rows="data.departments" :columns="groupColumns" /></el-tab-pane
        ><el-tab-pane label="每日数据"
          ><DataTable :rows="data.days" :columns="dayColumns" /></el-tab-pane></el-tabs></template
  ></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
  import * as echarts from 'echarts'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable from '@/components/DataTable/index.vue'
  import { useResource } from '@/hooks/useResource'
  import type { Row, Column } from '@/types'
  defineProps<{ title?: string }>()
  interface Totals {
    requests: number
    success: number
    failed: number
    pending: number
    tokens: number
    chargedTokens: number
    conservativeTokens: number
    unknownCost: number
    costs: Record<string, number>
  }
  interface Usage {
    totals: Totals
    users: Row[]
    models: Row[]
    departments: Row[]
    days: Row[]
    timezone: string
  }
  const query = ref(''),
    dates = ref<string[]>([]),
    chart = ref<HTMLDivElement>(),
    { data, loading, error, load } = useResource<Usage>(() => '/admin/usage' + query.value)
  let instance: echarts.ECharts | undefined, observer: ResizeObserver | undefined
  const metrics = computed(() =>
    data.value
      ? [
          { label: '请求数', value: data.value.totals.requests.toLocaleString() },
          {
            label: '成功率',
            value:
              data.value.totals.success + data.value.totals.failed
                ? (
                    (100 * data.value.totals.success) /
                    (data.value.totals.success + data.value.totals.failed)
                  ).toFixed(1) + '%'
                : '—',
          },
          { label: '实际 Token', value: data.value.totals.tokens.toLocaleString() },
          { label: '保守计费 Token', value: data.value.totals.conservativeTokens.toLocaleString() },
          { label: '计费 Token 合计', value: data.value.totals.chargedTokens.toLocaleString() },
        ]
      : []
  )
  const values: Column[] = [
    { prop: 'requests', label: '请求数' },
    { prop: 'tokens', label: '实际 Token' },
    { prop: 'conservativeTokens', label: '保守计费 Token' },
    { prop: 'chargedTokens', label: '计费 Token 合计' },
    { prop: 'success', label: '成功' },
    { prop: 'failed', label: '失败/中断' },
  ]
  const userColumns = [{ prop: 'username', label: '用户' }, ...values],
    groupColumns = [{ prop: 'name', label: '名称' }, ...values],
    dayColumns = [{ prop: 'date', label: '日期' }, ...values]
  function apply() {
    query.value =
      dates.value?.length === 2
        ? '?' + new URLSearchParams({ from: dates.value[0], to: dates.value[1] })
        : ''
    void load()
  }
  function reset() {
    dates.value = []
    query.value = ''
    void load()
  }
  watch(data, async () => {
    await nextTick()
    if (!chart.value || !data.value) return
    if (!data.value.days.length) {
      instance?.clear()
      return
    }
    if (!instance) {
      instance = echarts.init(chart.value)
      observer = new ResizeObserver(() => instance?.resize())
      observer.observe(chart.value)
    }
    const days = [...data.value.days]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-366)
    instance.resize()
    instance.setOption({
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      textStyle: { fontFamily: 'Inter, Microsoft YaHei, sans-serif' },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        backgroundColor: '#fff',
        borderColor: '#ebeef5',
        textStyle: { fontSize: 12, color: '#606266' },
      },
      legend: {
        left: 10,
        top: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 7,
        itemGap: 20,
        textStyle: { color: '#909399', fontSize: 11 },
        data: ['实际 Token', '保守计费 Token'],
      },
      grid: { left: 12, right: 16, bottom: 12, top: 45, containLabel: true },
      xAxis: {
        type: 'category',
        data: days.map((d) => d.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#909399', fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitNumber: 4,
        axisLabel: {
          color: '#909399',
          fontSize: 10,
          formatter: (value: number) =>
            Intl.NumberFormat('en', { notation: 'compact' }).format(value),
        },
        splitLine: { lineStyle: { color: '#ebeef5', type: 'dashed' } },
      },
      series: [
        {
          name: '实际 Token',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 24,
          data: days.map((d) => d.tokens),
          itemStyle: { color: '#409eff' },
        },
        {
          name: '保守计费 Token',
          type: 'bar',
          stack: 'tokens',
          data: days.map((d) => d.conservativeTokens),
          itemStyle: { color: '#c6e2ff' },
        },
      ],
    })
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    instance?.dispose()
  })
</script>
<style scoped lang="scss">
  .usage-dashboard {
    h3 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 20px;
      color: var(--el-text-color-primary);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 16px;
      .el-card {
        border-radius: var(--admin-radius);
        min-width: 0;
      }
      span {
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
      strong {
        display: block;
        margin-top: 18px;
        font-size: 24px;
        font-weight: 600;
        overflow-wrap: anywhere;
        font-variant-numeric: tabular-nums;
      }
    }
    .chart {
      height: 300px;
      width: 100%;
    }
    @media (max-width: 1000px) {
      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        > .el-card:last-child {
          grid-column: 1/-1;
        }
      }
    }
  }
</style>
