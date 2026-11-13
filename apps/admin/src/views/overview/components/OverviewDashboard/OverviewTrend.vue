<template>
  <div class="usage-trend">
    <el-alert v-if="loadError" title="图表加载失败" type="warning" :closable="false">
      <el-button link type="primary" @click="renderChart">重新加载</el-button>
    </el-alert>
    <div v-if="days.length" ref="element" class="chart" role="img" :aria-label="description"></div>
    <el-empty v-else description="暂无请求记录，开始使用后将在这里展示趋势" :image-size="76" />
  </div>
</template>
<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import type { EChartsType } from 'echarts/core'
  import type { UsageGroup } from '@/types/usage'
  const props = defineProps<{ days: UsageGroup[]; metric: 'cost' | 'users' }>()
  const element = ref<HTMLDivElement>()
  const loadError = ref(false)
  const days = computed(() =>
    [...props.days].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-366),
  )
  const description = computed(() => props.metric === 'cost' ? '每日上游成本（人民币估算）' : '每日活跃用户')
  let chart: EChartsType | undefined
  let observer: ResizeObserver | undefined
  let disposed = false
  async function renderChart() {
    loadError.value = false
    await nextTick()
    if (disposed) return
    if (!element.value) {
      observer?.disconnect()
      chart?.dispose()
      chart = undefined
      return
    }
    const echarts = await import('@/components/UsageTrend/chart').catch(() => {
      loadError.value = true
    })
    if (!echarts || disposed || !element.value) return
    if (!chart) {
      chart = echarts.init(element.value, undefined, { renderer: 'svg' })
      observer = new ResizeObserver(() => chart?.resize())
      observer.observe(element.value)
    }
    chart.setOption(
      {
        animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        textStyle: { fontFamily: 'Inter, Microsoft YaHei, sans-serif' },
        color: ['#409eff'],
        tooltip: {
          trigger: 'axis',
          renderMode: 'richText',
          backgroundColor: '#fff',
          borderColor: '#e8ebf3',
          padding: 12,
          textStyle: { color: '#465065', fontSize: 12 },
          valueFormatter: (value: unknown) => Number(value).toLocaleString() + (props.metric === 'cost' ? ' 元' : ' 人'),
        },
        grid: { left: 12, right: 16, top: 20, bottom: 12, containLabel: true },
        xAxis: {
          type: 'category',
          boundaryGap: days.value.length === 1,
          data: days.value.map((day) => day.date),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: '#929aab',
            fontSize: 11,
            margin: 18,
            hideOverlap: true,
            formatter: (value: string) => value.slice(5).replace('-', '/'),
          },
        },
        yAxis: {
          type: 'value',
          minInterval: props.metric === 'cost' ? 0 : 1,
          splitNumber: 4,
          axisLabel: {
            color: '#929aab',
            fontSize: 10,
            formatter: (value: number) =>
              Intl.NumberFormat('en', {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(value),
          },
          splitLine: { lineStyle: { color: '#edf0f5', type: 'dashed' } },
        },
        series: [
          {
            name: description.value,
            type: 'line',
            data: days.value.map(day => props.metric === 'cost' ? day.costs.CNY ?? null : day.activeUsers),
            showSymbol: days.value.length === 1,
            symbolSize: 7,
            lineStyle: { width: 2.5 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#409eff26' },
                { offset: 1, color: '#409eff02' },
              ]),
            },
          },
        ],
      },
      { notMerge: true },
    )
  }
  watch(() => [props.days, props.metric], renderChart, { immediate: true })
  onBeforeUnmount(() => {
    disposed = true
    observer?.disconnect()
    chart?.dispose()
  })
</script>
<style scoped lang="scss">
  .usage-trend {
    min-width: 0;
    .chart {
      width: 100%;
      height: 280px;
    }
    .el-empty {
      min-height: 280px;
    }
    @media (max-width: 540px) {
      .chart {
        height: 230px;
      }
    }
  }
</style>
