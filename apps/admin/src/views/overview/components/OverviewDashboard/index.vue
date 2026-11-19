<template>
  <PagePanel
    class="overview-dashboard"
    title="工作台概览"
    description="连接团队成员与 AI，统一管理账号、模型和使用情况。"
    :error="error"
    transparent
    ><template #actions
      ><el-button :loading="loading" @click="load"><Refresh />刷新数据</el-button></template
    >
    <section class="overview">
      <div class="toolbar">
        <div class="period-label">
          <Calendar /><span>{{ rangeLabel }}</span
          ><span v-if="data" class="timezone">{{ data.timezone }}</span>
        </div>
        <div class="filters">
          <el-date-picker
            v-model="dates"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            range-separator="至"
            aria-label="统计日期范围"
            :clearable="true"
          /><el-button :disabled="loading" @click="applyDates">查询</el-button
          ><el-button text :disabled="loading || !query" @click="resetDates">全部时间</el-button>
        </div>
      </div>

      <div v-if="!data && loading" class="initial-loading" aria-label="正在加载概览">
        <el-skeleton :rows="8" animated />
      </div>
      <template v-if="data">
        <div class="metrics" :aria-busy="loading">
          <article v-for="metric in metrics" :key="metric.label" class="metric">
            <div class="metric-top">
              <span>{{ metric.label }}</span
              ><span class="metric-icon" :class="metric.tone"><component :is="metric.icon" /></span>
            </div>
            <strong>{{ metric.value }}</strong>
            <p v-if="metric.note">{{ metric.note }}</p>
          </article>
        </div>
        <article v-if="data.capabilityCosts" class="panel">
          <div class="panel-heading">
            <div><h2>能力调用成本</h2><p>按所选日期和模型配置单价估算，已包含在上游成本中。</p></div>
          </div>
          <dl class="capability-costs">
            <div v-for="item in capabilityRows" :key="item.key">
              <dt>{{ item.label }}<small v-if="item.note">{{ item.note }}</small></dt>
              <dd>{{ item.amount }}<small v-if="item.unknown">{{ item.unknown }} 笔成本未知</small></dd>
            </div>
          </dl>
        </article>
        <article class="panel">
          <div class="panel-heading">
            <h2>用量趋势</h2>
            <el-radio-group v-model="trendMetric" size="small" aria-label="趋势指标">
              <el-radio-button value="cost">上游成本</el-radio-button>
              <el-radio-button value="users">活跃用户</el-radio-button>
            </el-radio-group>
          </div>
          <OverviewTrend :days="data.days" :metric="trendMetric" />
        </article>
        <div class="rankings">
          <article v-for="ranking in rankings" :key="ranking.title" class="panel ranking-panel">
            <div class="panel-heading">
              <div>
                <h2>{{ ranking.title }}</h2>
                <p>{{ ranking.description }}</p>
              </div>
              <span class="subtle">TOP 5</span>
            </div>
            <div v-if="ranking.rows.length" class="ranking-list">
              <div v-for="(row, index) in ranking.rows" :key="row.key" class="ranking-row">
                <span class="rank" :class="{ first: index === 0 }">{{
                  String(index + 1).padStart(2, '0')
                }}</span>
                <div class="ranking-detail">
                  <div class="ranking-label">
                    <span :title="row.name">{{ row.name }}</span
                    ><b>{{ row.amount }}<small v-if="row.note"> · {{ row.note }}</small></b>
                  </div>
                  <div class="ranking-track">
                    <span :style="{ width: row.share + '%' }"></span>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else description="所选时间暂无用量" :image-size="54" />
          </article>
        </div>
      </template></section
  ></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { Calendar, Connection, DataAnalysis, Refresh, Tickets } from '@element-plus/icons-vue'
  import { useResource } from '@/hooks/useResource'
  import PagePanel from '@/components/PagePanel/index.vue'
  import OverviewTrend from './OverviewTrend.vue'
  import type { OverviewUsage, UsageGroup } from '@/types/usage'
  const trendMetric = ref<'cost' | 'users'>('cost')
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 6)
  const dateText = (date: Date) => new Intl.DateTimeFormat('sv-SE').format(date)
  const dates = ref<[string, string] | null>([dateText(start), dateText(today)])
  const appliedDates = ref(dates.value)
  const query = ref('?' + new URLSearchParams({ from: dateText(start), to: dateText(today) }))
  const { data, loading, error, load } = useResource<OverviewUsage>(
    () => '/admin/usage' + query.value,
  )
  const rangeLabel = computed(() =>
    appliedDates.value ? appliedDates.value.join(' — ') : '全部时间',
  )
  const money = (value: number) => '¥' + value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  })
  const capabilityRows = computed(() => {
    const costs = data.value?.capabilityCosts ?? {}
    const rows = [
      { key: 'knowledge', label: '知识库', note: '' },
      { key: 'embedding', label: '向量', note: '当前仅配置验证，未统计成本' },
    ]
    return rows.map(row => {
      const group = costs[row.key]
      const amounts = Object.entries(group?.costsMicros ?? {}).map(([currency, micros]) => {
        const value = micros / 1_000_000
        if (value > 0 && value < 0.0001) return currency === 'CNY' ? '< ¥0.0001' : '< 0.0001 ' + currency
        return currency === 'CNY' ? money(value) : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) + ' ' + currency
      })
      return { ...row, amount: amounts.join(' · ') || (group?.unknownCost ? '金额未知' : '—'), unknown: group?.unknownCost ?? 0 }
    })
  })
  const metrics = computed(() => {
    if (!data.value) return []
    const { totals, models } = data.value
    const mostUsed = [...models].sort((a, b) => b.activeUsers - a.activeUsers)[0]
    return [
      { label: '收入', value: '¥0.00', icon: Tickets, tone: 'purple' },
      { label: '上游成本（估算）', value: money(totals.costs.CNY ?? 0), icon: DataAnalysis, tone: 'blue',
        note: totals.unknownCost ? `${totals.unknownCost} 笔成本未知` : '' },
      { label: '活跃用户', value: totals.activeUsers.toLocaleString(), icon: Connection, tone: 'green' },
      { label: '使用人数最多的模型', value: mostUsed?.activeUsers ? mostUsed.name : '—', icon: DataAnalysis,
        tone: 'amber', note: mostUsed?.activeUsers ? `${mostUsed.activeUsers} 人使用` : '' },
    ]
  })
  function rankRows(rows: UsageGroup[], field: 'username' | 'name', amount: (row: UsageGroup) => number) {
    const sorted = rows.map(row => ({ row, value: amount(row) }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value).slice(0, 5)
    return sorted.map(({ row, value }) => ({
      key: String(row.userId ?? row.modelId),
      name: row[field] || '未知',
      amount: money(value),
      note: field === 'name' ? `${row.activeUsers} 人` : '',
      share: value / sorted[0].value * 100,
    }))
  }
  const rankings = computed(() => data.value ? [
    { title: '用户额度消耗', description: '按已扣套餐额度排序',
      rows: rankRows(data.value.users, 'username', row => row.chargedMicros / 1_000_000) },
    { title: '模型调用成本', description: '按人民币估算成本排序',
      rows: rankRows(data.value.models, 'name', row => row.costs.CNY ?? 0) },
  ] : [])
  function applyDates() {
    const next = dates.value?.length === 2 ? ([...dates.value] as [string, string]) : null
    const nextQuery = next ? '?' + new URLSearchParams({ from: next[0], to: next[1] }) : ''
    appliedDates.value = next
    if (nextQuery === query.value) void load()
    else query.value = nextQuery
  }
  function resetDates() {
    dates.value = null
    applyDates()
  }
</script>
<style scoped lang="scss">
  .page-panel.overview-dashboard {
    flex: 1 0 auto;
  }
  .overview {
    --muted: var(--el-text-color-secondary);
    display: grid;
    gap: var(--admin-gap);
    min-width: 0;
    color: var(--el-text-color-primary);
    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    h1,
    h2,
    p {
      margin: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--admin-gap);
      padding: 14px 18px;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
    }
    .period-label {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 12px;
      white-space: nowrap;
      > svg {
        color: #8d98b3;
      }
    }
    .timezone {
      color: #99a1b0;
      font-size: 10px;
      padding-left: 5px;
    }
    .filters {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      :deep(.el-date-editor) {
        width: 260px;
        flex-grow: 0;
      }
      .el-button + .el-button {
        margin-left: 0;
      }
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--admin-gap);
    }
    .metric {
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      padding: 20px;
      min-width: 0;
      > strong {
        display: block;
        margin: 17px 0 12px;
        font-size: clamp(24px, 2.2vw, 33px);
        letter-spacing: -0.8px;
        font-weight: 600;
        overflow-wrap: anywhere;
        font-variant-numeric: tabular-nums;
      }
      p {
        font-size: 11px;
        color: var(--muted);
        line-height: 1.6;
      }
    }
    .metric-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: #6e7b91;
    }
    .metric-icon {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 9px;
      &.purple {
        color: #7b79bd;
        background: #f0effb;
      }
      &.blue {
        color: #6d94bd;
        background: #edf4fc;
      }
      &.green {
        color: #6e9c8e;
        background: #eef7f2;
      }
      &.amber {
        color: #b09b73;
        background: #faf5eb;
      }
    }
    .panel {
      min-width: 0;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      padding: 20px;
    }
    .capability-costs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 175px), 1fr));
      gap: 16px;
      margin: 0;
      > div { min-width: 0; border-top: 1px solid var(--admin-border); padding-top: 12px; }
      dt, dd { margin: 0; overflow-wrap: anywhere; }
      dd { margin-top: 9px; font-weight: 600; font-variant-numeric: tabular-nums; }
      small { display: block; color: var(--muted); margin-top: 5px; font-weight: 400; }
    }
    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin-bottom: 22px;
      h2 {
        font-size: 14px;
        font-weight: 600;
      }
      p {
        color: var(--muted);
        font-size: 11px;
        margin-top: 8px;
      }
    }
    .subtle {
      color: #96a0b1;
      font-size: 10px;
    }
    .success {
      background: #8aafa5;
    }
    .failed {
      background: #dbaba3;
    }
    .pending {
      background: #aab7d5;
    }
    .cost-panel .panel-heading {
      margin-bottom: 18px;
    }
    .rankings {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--admin-gap);
    }
    .ranking-list {
      display: grid;
      gap: var(--admin-gap);
      padding-block: 4px 10px;
    }
    .ranking-row {
      display: grid;
      grid-template-columns: 25px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
    }
    .rank {
      color: #aab2c1;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      &.first {
        color: #7c86c1;
      }
    }
    .ranking-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
      margin-bottom: 10px;
      font-size: 11px;
      > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      b {
        font-weight: 500;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      small {
        color: #a1aaba;
        font-weight: 400;
        font-size: 9px;
      }
    }
    .ranking-track {
      height: 4px;
      background: #f1f3f8;
      border-radius: 5px;
      overflow: hidden;
      > span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #9acbfa;
      }
    }
    .ranking-panel:nth-child(2) .ranking-track > span {
      background: #b3c9d9;
    }
    .initial-loading {
      padding: 30px;
      background: var(--admin-surface);
      border-radius: var(--admin-radius);
    }
    @media (max-width: 1200px) {
      .toolbar {
        align-items: flex-start;
        flex-direction: column;
        gap: 12px;
      }
      .metrics {
        gap: 12px;
      }
      .metric {
        padding: 18px;
      }
    }
    @media (max-width: 650px) {
      gap: var(--admin-gap);

      .metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .metric {
        padding: 15px;
        > strong {
          font-size: 25px;
        }
        p {
          font-size: 10px;
        }
      }
      .metric-top {
        font-size: 11px;
      }
      .metric-icon {
        width: 25px;
        height: 25px;
      }
      .rankings {
        grid-template-columns: minmax(0, 1fr);
      }
      .panel {
        padding: 19px 17px;
      }
      .panel-heading {
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 12px;
      }
      .toolbar {
        padding: 14px;
      }
      .filters {
        display: grid;
        width: 100%;
        grid-template-columns: 1fr 1fr;
        :deep(.el-date-editor) {
          width: 100%;
          min-width: 0;
          grid-column: 1/-1;
        }
        .el-button {
          width: 100%;
        }
      }
      .period-label {
        flex-wrap: wrap;
        white-space: normal;
      }
    }
  }
</style>
