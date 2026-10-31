<template>
  <PagePanel
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
    <DataTable
      :rows="data?.items || []"
      :columns="columns"
      :searchable="false"
      :server-pagination="{ page, pageSize: 25, total: data?.total || 0 }"
      @page-change="changePage"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable from '@/components/DataTable/index.vue'
  import LogFilters from './components/LogFilters/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { download } from '@/api/request'
  import { date } from '@/utils/forms'
  import { useAuthStore } from '@/stores/auth'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore()
  const mode = ref('errors')
  const kind = computed(() => (mode.value === 'audits' ? 'audits' : 'requests'))
  const page = ref(1),
    query = ref('&status=errors')
  const { data, loading, error, load } = useResource<{ items: Row[]; total: number }>(
    () => '/admin/' + kind.value + '?offset=' + (page.value - 1) * 25 + '&limit=25' + query.value,
  )
  const columns = computed<Column[]>(() =>
    kind.value === 'requests'
      ? [
          { prop: 'started_at', label: '时间', minWidth: 180, render: (r) => date(r.started_at) },
          ...[
            'username:用户',
            'model:模型',
            'input_tokens:输入 Token',
            'output_tokens:输出 Token',
            'total_tokens:总 Token',
            'duration_ms:耗时 ms',
            'status:状态',
            'error_code:错误',
          ].map((item) => {
            const [prop, label] = item.split(':')
            return { prop, label, minWidth: 120 }
          }),
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
  function changePage(value: number) {
    page.value = value
  }
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
