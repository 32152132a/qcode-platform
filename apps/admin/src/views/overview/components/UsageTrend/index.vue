<template>
  <div class="usage-trend">
    <div v-if="days.length" ref="element" class="chart" role="img" :aria-label="description"></div>
    <el-empty v-else description="暂无请求记录，开始使用后将在这里展示趋势" :image-size="76" />
  </div>
</template>
<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import * as echarts from 'echarts'
  import type { UsageGroup } from '../types'
  const props = defineProps<{ days: UsageGroup[] }>()
  const element = ref<HTMLDivElement>()
  const days = computed(() =>
    [...props.days].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-366)
  )
  const description = computed(
    () =>
      `每日 Token 趋势，${days.value.length} 个有记录日期；实际 ${days.value.reduce((sum, day) => sum + day.tokens, 0).toLocaleString()} Token，保守计费 ${days.value.reduce((sum, day) => sum + day.conservativeTokens, 0).toLocaleString()} Token。详细数据可在用量统计页面查看。`
  )
  let chart: echarts.ECharts | undefined
  let observer: ResizeObserver | undefined
  let disposed = false
  async function renderChart() {
    await nextTick()
    if (disposed) return
    if (!element.value) {
      observer?.disconnect()
      chart?.dispose()
      chart = undefined
      return
    }
    if (!chart) {
      chart = echarts.init(element.value, undefined, { renderer: 'svg' })
      observer = new ResizeObserver(() => chart?.resize())
      observer.observe(element.value)
    }
    chart.setOption(
      {
        animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        textStyle: { fontFamily: 'Inter, Microsoft YaHei, sans-serif' },
        color: ['#409eff', '#b4bdcf'],
        tooltip: {
          trigger: 'axis',
          renderMode: 'richText',
          backgroundColor: '#fff',
          borderColor: '#e8ebf3',
          padding: 12,
          textStyle: { color: '#465065', fontSize: 12 },
          valueFormatter: (value: unknown) => Number(value).toLocaleString() + ' Token',
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
          minInterval: 1,
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
            name: '实际 Token',
            type: 'line',
            data: days.value.map((day) => day.tokens),
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
          {
            name: '保守计费 Token',
            type: 'line',
            data: days.value.map((day) => day.conservativeTokens),
            showSymbol: days.value.length === 1,
            symbolSize: 6,
            lineStyle: { width: 1.5, type: 'dashed' },
          },
        ],
      },
      { notMerge: true }
    )
  }
  watch(() => props.days, renderChart, { immediate: true })
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
