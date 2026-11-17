<template>
  <PagePanel class="log-page"
    title="系统记录"
    description="记录不包含提示词、代码内容或真实 Key。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button @click="exportCsv">导出 CSV</el-button></template
    >
    <el-tabs v-model="mode"
      ><el-tab-pane label="错误与警告" name="errors" /><el-tab-pane
        label="全部请求"
        name="requests" /><el-tab-pane
        v-if="auth.can('audits:read')"
        label="管理操作"
        name="audits"
    /></el-tabs>
    <LogFilters :key="mode" :kind="kind" :errors-only="mode === 'errors'" @search="apply" />
    <QyqTable
      class="log-table"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :data="data?.items || []"
      :columns="columns"
      :total="data?.total || 0"
      height="100%"
      :pagination-config="{ layout: 'total, sizes, prev, pager, next, jumper' }"
    /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import QyqTable from '@/components/qyq-table/index.vue'
  import LogFilters from './components/LogFilters/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { download } from '@/api/request'
  import { date } from '@/utils/forms'
  import { useAuthStore } from '@/stores/auth'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore()
  const mode = ref('errors')
  const kind = computed(() => (mode.value === 'audits' ? 'audits' : 'requests'))
  const rowsPerPage = ref(10)
  const pageSize = computed({
    get: () => rowsPerPage.value,
    set: (value) => {
      page.value = 1
      rowsPerPage.value = value
    },
  })
  const page = ref(1),
    query = ref('&status=errors')
  const { data, loading, error, load } = useResource<{ items: Row[]; total: number }>(
    () => '/admin/' + kind.value + '?offset=' + (page.value - 1) * pageSize.value + '&limit=' + pageSize.value + query.value,
  )
  const statusLabels: Record<string, string> = {
    success: '成功', pending: '进行中', failed: '失败', interrupted: '已中断', cancelled: '已取消',
  }
  const errorLabels: Record<string, string> = {
    CLIENT_DISCONNECTED: '客户端连接断开',
    GATEWAY_BUSY: '网关繁忙',
    INCOMPLETE_STREAM: '流式响应未完成',
    INVALID_FIELD: '请求字段无效',
    INVALID_MESSAGES: '消息格式无效',
    INVALID_MODEL: '模型标识无效',
    INVALID_N: '生成数量无效',
    INVALID_STREAM: '流式参数无效',
    INVALID_UPSTREAM_RESPONSE: '上游响应格式异常',
    KEY_UNAVAILABLE: '没有可用的 API Key',
    MODEL_UNAVAILABLE: '模型不可用',
    PLAN_MODEL_NOT_ALLOWED: '套餐不支持该模型',
    REQUEST_IN_PROGRESS: '请求仍在处理',
    SUBSCRIPTION_EXPIRED: '套餐已过期',
    UPSTREAM_ERROR: '上游服务返回错误',
    UPSTREAM_STREAM_ERROR: '上游流式响应异常',
    UPSTREAM_TIMEOUT: '上游服务超时',
    UPSTREAM_UNAVAILABLE: '上游服务不可用',
    VISION_UNAVAILABLE: '图片识别不可用',
  }
  const columns = computed<Column[]>(() =>
    kind.value === 'requests'
      ? [
          { prop: 'started_at', label: '时间', minWidth: 180, render: (r) => date(r.started_at) },
          ...[
            'username:用户',
            'model_name:模型名称',
            'model:公开模型 ID',
            ...(mode.value === 'requests' ? ['total_tokens:总 Token'] : []),
          ].map((item) => {
            const [prop, label] = item.split(':')
            return { prop, label, minWidth: 120 }
          }),
          { prop: 'duration_ms', label: '耗时（秒）', minWidth: 120,
            render: (r) => typeof r.duration_ms === 'number' ? (r.duration_ms / 1000).toFixed(3).replace(/\.?0+$/, '') : '—' },
          { prop: 'status', label: '状态', minWidth: 120,
            render: (r) => statusLabels[String(r.status)] ?? String(r.status ?? '—') },
          { prop: 'error_code', label: '错误', minWidth: 220, render: (r) => {
            const code = String(r.error_code ?? '')
            return code ? (errorLabels[code] ?? '未分类错误') + '（' + code + '）' : '—'
          } },
        ]
      : [
          { prop: 'time', label: '时间', minWidth: 180, render: (r) => date(r.time) },
          { prop: 'actor', label: '操作人' },
          { prop: 'action', label: '动作', minWidth: 180 },
          { prop: 'target', label: '对象', minWidth: 200 },
        ],
  )
  function apply(values: Record<string, string>) {
    page.value = 1
    if (mode.value === 'errors' && !values.status) values.status = 'errors'
    query.value = '&' + new URLSearchParams(values)
    void load()
  }
  watch(mode, () => {
    page.value = 1
    query.value = mode.value === 'errors' ? '&status=errors' : ''
  })
  async function exportCsv() {
    try {
      await download(
        '/admin/' + kind.value + '/export?' + query.value.slice(1),
        'qcode-' + kind.value + '.csv',
      )
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '导出失败')
    }
  }
</script>

<style scoped lang="scss">
  .page-panel.log-page {
    min-height: 0;
  }
  .log-table {
    flex: 1;
    min-height: 0;
  }
</style>
