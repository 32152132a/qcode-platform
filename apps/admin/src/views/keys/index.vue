<template>
  <PagePanel
    title="Key 管理"
    description="凭据加密保存，按站点隔离使用。上游异常后停用，管理员启用后重新参与调用。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('keys:write')" type="primary" @click="add"
        >添加 Key</el-button
      ></template
    ><KeyDialog ref="keyEditor" /><DataTable :rows="data || []" :columns="columns" :actions="actions" /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import KeyDialog from './components/KeyDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { confirmAction } from '@/utils/forms'
  import type { Column, Row } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<import('@/types').Row[]>(() => '/admin/keys')
  const keyEditor = ref<InstanceType<typeof KeyDialog>>()
  const columns: Column[] = [
    { prop: 'name', label: '名称' },
    { prop: 'suffix', label: '末四位' },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '已启用' : '已暂停') },
    { prop: 'source_name', label: '服务站点' },
    { prop: 'disabled_reason', label: '上次停用原因' },
    { prop: 'disabled_at', label: '上次停用时间', render: r => r.disabled_at ? new Date(String(r.disabled_at)).toLocaleString() : '—' },
    { prop: 'tokens', label: '实际 Token' },
    { prop: 'requests', label: '请求数' },
  ]
  const actions = computed<RowAction[]>(() =>
    auth.can('keys:write')
      ? [
          { label: '启用', run: (row) => enable(row) },
          { label: '暂停', run: (row) => confirmAction('暂停此 Key？', () => request('/admin/keys/' + row.id, 'PATCH', { active: false }), load) },
          { label: '编辑', run: row => keyEditor.value?.open(row, load) },
          {
            label: '删除',
            danger: true,
            run: (r) =>
              confirmAction(
                '删除未被引用的 Key？',
                () => request('/admin/keys/' + r.id, 'DELETE'),
                load
              ),
          },
        ]
      : []
  )
  async function enable(row: Row) {
    try {
      await request('/admin/keys/' + row.id, 'PATCH', { active: true });
      ElMessage.success('Key 已启用，下次请求将重新尝试使用');
      await load();
    } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '操作失败'); }
  }
  function add() { keyEditor.value?.open(undefined, load) }
</script>
