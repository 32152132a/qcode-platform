<template>
  <PagePanel
    title="工作台概览"
    description="连接团队成员与 AI，统一管理账号、模型和使用情况。"
    :error="error"
    transparent
    ><template #actions
      ><el-button :loading="loading" @click="load"><Refresh />刷新数据</el-button></template
    >
    <section class="overview">
      <PlatformIntro />
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
            <p>{{ metric.note }}</p>
          </article>
        </div>
        <div class="analytics-grid">
          <article class="panel trend-panel">
            <div class="panel-heading">
              <div>
                <h2>用量趋势</h2>
                <p>每日实际用量与保守计费情况</p>
              </div>
              <div class="legend">
                <span><i></i>实际 Token</span><span><i class="conservative"></i>保守计费</span>
              </div>
            </div>
            <UsageTrend :days="data.days" />
            <div class="panel-footnote">
              按有请求的日期展示，最多显示最近 366 个有记录日期。<router-link to="/manage/usage"
                >查看明细 <ArrowRight
              /></router-link>
            </div>
          </article>
          <div class="side-panels">
            <article class="panel status-panel">
              <div class="panel-heading">
                <h2>请求状态</h2>
                <span class="subtle">{{ number(data.totals.requests) }} 次请求</span>
              </div>
              <div
                class="status-track"
                role="img"
                :aria-label="`成功 ${data.totals.success}，失败或中断 ${data.totals.failed}，进行中 ${data.totals.pending}`"
              >
                <span
                  v-for="status in statuses"
                  :key="status.label"
                  :class="status.tone"
                  :style="{ flexGrow: status.value }"
                />
              </div>
              <div v-for="status in statuses" :key="status.label" class="status-row">
                <span><i :class="status.tone"></i>{{ status.label }}</span
                ><b>{{ number(status.value) }}</b
                ><small>{{ percent(status.value, data.totals.requests) }}</small>
              </div>
            </article>
            <article class="panel cost-panel">
              <div class="panel-heading">
                <h2>估算成本</h2>
                <el-tooltip
                  content="按请求发生时的模型单价估算，不同币种分别统计，不等同于供应商账单。"
                  ><span class="help" tabindex="0" aria-label="成本统计说明"><InfoFilled /></span
                ></el-tooltip>
              </div>
              <div v-if="costs.length" class="costs">
                <div v-for="cost in costs" :key="cost.currency">
                  <span>{{ cost.currency }}</span
                  ><strong>{{ cost.amount }}</strong>
                </div>
              </div>
              <p v-else class="no-cost">暂无可计算成本</p>
              <p class="cost-note">
                <Warning />{{ number(data.totals.unknownCost) }}
                个请求成本未知，未按零成本计算。
              </p>
            </article>
          </div>
        </div>
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
                    ><b>{{ number(row.tokens) }} <small>Token</small></b>
                  </div>
                  <div class="ranking-track">
                    <span :style="{ width: row.share + '%' }"></span>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else description="所选时间暂无用量" :image-size="54" />
            <div class="panel-footnote">
              <span>{{ ranking.total }} {{ ranking.unit }}产生请求</span
              ><router-link to="/manage/usage">完整统计 <ArrowRight /></router-link>
            </div>
          </article>
        </div>
        <div class="accounting-note">
          <InfoFilled />
          <p>
            实际 Token 来自上游返回的用量；无法取得用量时采用保守计费。计费 Token 合计
            <b>{{ number(data.totals.chargedTokens) }}</b
            >，其中保守计费 <b>{{ number(data.totals.conservativeTokens) }}</b
            >。
          </p>
        </div>
      </template>
    </section></PagePanel
  >
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import {
    ArrowRight,
    Calendar,
    Connection,
    DataAnalysis,
    InfoFilled,
    Refresh,
    Tickets,
    Warning,
  } from '@element-plus/icons-vue'
  import { useResource } from '@/hooks/useResource'
  import PagePanel from '@/components/PagePanel/index.vue'
  import UsageTrend from '../UsageTrend/index.vue'
  import PlatformIntro from '../PlatformIntro/index.vue'
  import type { OverviewUsage, UsageGroup } from '../types'
  const dates = ref<[string, string] | null>(null)
  const query = ref('')
  const appliedDates = ref<[string, string] | null>(null)
  const { data, loading, error, load } = useResource<OverviewUsage>(
    () => '/admin/usage' + query.value
  )
  const rangeLabel = computed(() =>
    appliedDates.value ? appliedDates.value.join(' — ') : '全部时间'
  )
  const metrics = computed(() => {
    if (!data.value) return []
    const total = data.value.totals
    return [
      {
        label: '总请求数',
        value: number(total.requests),
        note: `${number(total.pending)} 个请求正在进行`,
        icon: Connection,
        tone: 'purple',
      },
      {
        label: '实际 Token',
        value: number(total.tokens),
        note: '上游返回的实际用量',
        icon: DataAnalysis,
        tone: 'blue',
      },
      {
        label: '请求成功率',
        value: percent(total.success, total.success + total.failed),
        note: '仅计算已完成或失败的请求',
        icon: Tickets,
        tone: 'green',
      },
      {
        label: '活跃用户',
        value: number(data.value.users.length),
        note: `使用了 ${data.value.models.length} 个模型`,
        icon: Connection,
        tone: 'amber',
      },
    ]
  })
  const statuses = computed(() =>
    data.value
      ? [
          { label: '成功', value: data.value.totals.success, tone: 'success' },
          {
            label: '失败 / 中断',
            value: data.value.totals.failed,
            tone: 'failed',
          },
          { label: '进行中', value: data.value.totals.pending, tone: 'pending' },
        ]
      : []
  )
  const costs = computed(() =>
    Object.entries(data.value?.totals.costs || {}).map(([currency, amount]) => ({
      currency,
      amount: amount.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }),
    }))
  )
  const rankings = computed(() =>
    data.value
      ? [
          {
            title: '用户用量排行',
            description: '按实际 Token 排序',
            rows: rankRows(data.value.users, 'username'),
            total: data.value.users.length,
            unit: '位用户',
          },
          {
            title: '模型使用分布',
            description: '按实际 Token 排序',
            rows: rankRows(data.value.models, 'name'),
            total: data.value.models.length,
            unit: '个模型',
          },
        ]
      : []
  )
  function number(value: number) {
    return value.toLocaleString('zh-CN')
  }
  function percent(value: number, total: number) {
    return total ? ((value / total) * 100).toFixed(1) + '%' : '—'
  }
  function rankRows(rows: UsageGroup[], field: 'username' | 'name') {
    const sorted = [...rows]
      .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
      .slice(0, 5)
    const maximum = sorted[0]?.tokens || 0
    return sorted.map((row, index) => ({
      key: String(row.userId ?? row.modelId ?? row[field] ?? index),
      name: row[field] || '未知',
      tokens: row.tokens,
      share: maximum ? (row.tokens / maximum) * 100 : 0,
    }))
  }
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
  .overview {
    --muted: #909399;
    display: grid;
    gap: 20px;
    min-width: 0;
    color: #303133;
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
      gap: 20px;
      padding: 14px 18px;
      border: 1px solid #ebeef5;
      border-radius: 4px;
      background: #fff;
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
      gap: 20px;
    }
    .metric {
      border: 1px solid #ebeef5;
      border-radius: 4px;
      background: #fff;
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
    .analytics-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.9fr) minmax(260px, 1fr);
      gap: 20px;
    }
    .panel {
      min-width: 0;
      border: 1px solid #ebeef5;
      border-radius: 4px;
      background: #fff;
      padding: 20px;
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
    .legend {
      display: flex;
      gap: 13px;
      font-size: 10px;
      color: #8790a2;
      flex-wrap: wrap;
      span {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      i {
        width: 14px;
        height: 3px;
        border-radius: 3px;
        background: #409eff;
        &.conservative {
          background: #b4bdcf;
        }
      }
    }
    .panel-footnote {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      border-top: 1px solid #f0f2f7;
      padding-top: 17px;
      margin-top: 12px;
      color: #929bac;
      font-size: 10px;
      line-height: 1.7;
      a {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: #409eff;
        white-space: nowrap;
      }
      svg {
        width: 12px;
        height: 12px;
      }
    }
    .side-panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 20px;
    }
    .status-track {
      display: flex;
      gap: 3px;
      height: 7px;
      background: #f0f2f7;
      border-radius: 5px;
      overflow: hidden;
      margin-bottom: 18px;
      span {
        flex-basis: 0;
      }
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
    .status-row {
      display: grid;
      grid-template-columns: 1fr auto 46px;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      font-size: 11px;
      > span {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #7b8597;
      }
      i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      b {
        font-size: 12px;
        font-weight: 500;
      }
      small {
        text-align: right;
        color: #a0a8b6;
        font-size: 10px;
      }
    }
    .help {
      display: flex;
      color: #a7b0c0;
      svg {
        width: 14px;
        height: 14px;
      }
    }
    .cost-panel .panel-heading {
      margin-bottom: 18px;
    }
    .costs {
      display: grid;
      gap: 10px;
      > div {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      span {
        font-size: 11px;
        color: #8d98ac;
      }
      strong {
        font-weight: 550;
        font-size: 24px;
        letter-spacing: -0.6px;
        overflow-wrap: anywhere;
      }
    }
    .no-cost {
      font-size: 14px;
      color: #9ba4b3;
      margin-bottom: 18px;
    }
    .cost-note {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      font-size: 10px;
      color: #969ead;
      line-height: 1.8;
      margin-top: 14px;
      svg {
        width: 12px;
        height: 12px;
        margin-top: 3px;
      }
    }
    .rankings {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .ranking-list {
      display: grid;
      gap: 20px;
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
    .accounting-note {
      display: flex;
      gap: 9px;
      color: #929bad;
      font-size: 11px;
      line-height: 1.9;
      padding: 0 4px;
      svg {
        width: 13px;
        height: 13px;
        margin-top: 4px;
      }
      b {
        font-weight: 500;
        color: #79859b;
      }
    }
    .initial-loading {
      padding: 30px;
      background: #fff;
      border-radius: 4px;
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
      .analytics-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .side-panels {
        grid-template-columns: 1fr 1fr;
      }
    }
    @media (max-width: 650px) {
      gap: 20px;

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
      .side-panels,
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
      .panel-footnote {
        align-items: flex-start;
      }
    }
  }
</style>
