<template>
  <PagePanel
    title="Key 管理"
    description="凭据加密保存，按站点隔离使用。上游异常后停用，管理员或定时恢复后重新参与调用。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('keys:write')" @click="bulk">批量导入</el-button
      ><el-button v-if="auth.can('keys:write')" type="primary" @click="add"
        >添加 Key</el-button
      ></template
    ><KeyDialog ref="keyEditor" /><DataTable :rows="data || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import KeyDialog from './components/KeyDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { confirmAction } from '@/utils/forms'
  import type { Column, Row } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<import('@/types').Row[]>(() => '/admin/keys'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const keyEditor = ref<InstanceType<typeof KeyDialog>>()
  const columns: Column[] = [
    { prop: 'name', label: '名称' },
    { prop: 'suffix', label: '末四位' },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '启用' : '禁用') },
    { prop: 'source_name', label: '服务站点' },
    { prop: 'disabled_reason', label: '上次停用原因' },
    { prop: 'disabled_at', label: '上次停用时间', render: r => r.disabled_at ? new Date(String(r.disabled_at)).toLocaleString() : '—' },
    { prop: 'restore_at', label: '下次恢复', render: r => r.restore_at ? new Date(String(r.restore_at)).toLocaleString() : '—' },
    { prop: 'restore_hours', label: '异常后恢复', render: r => r.restore_hours ? r.restore_hours + ' 小时后' : '仅手动' },
    { prop: 'tokens', label: '实际 Token' },
    { prop: 'unknown_usage', label: '用量未知请求' },
    {
      prop: 'assigned_users',
      label: '分配用户',
      render: (r) => (Array.isArray(r.assigned_users) ? r.assigned_users.join('、') : '—'),
    },
    { prop: 'requests', label: '请求数' },
  ]
  const actions = computed<RowAction[]>(() =>
    auth.can('keys:write')
      ? [
          {
            label: '配置',
            run: configure,
          },
          {
            label: '检查',
            run: checkKey,
          },
          {
            label: '替换 Key',
            run: (r) =>
              editor.value?.open(
                {
                  title: '替换 Key，保留现有绑定',
                  fields: [{ prop: 'apiKey', label: '新 Key', type: 'password', required: true }],
                  value: { apiKey: '' },
                  save: (v) => request('/admin/keys/' + r.id, 'PATCH', v),
                },
                load
              ),
          },
          {
            label: '切换状态',
            run: (r) =>
              confirmAction(
                (r.active ? '禁用' : '启用') + '此 Key？',
                () => request('/admin/keys/' + r.id, 'PATCH', { active: !r.active }),
                load
              ),
          },
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
  async function sourceField(): Promise<import('@/types').Field> {
    const sources = await request<Row[]>('/admin/models/sources')
    return { prop: 'sourceId', label: '服务站点（可暂不绑定）', type: 'select', options: sources
      .filter(source => source.kind !== 'local')
      .map(source => ({ label: String(source.name), value: String(source.id) })) }
  }
  function configure(row: Row) { keyEditor.value?.open(row, load) }
  function add() { keyEditor.value?.open(undefined, load) }
  async function bulk() {
    editor.value?.open(
      {
        title: '批量导入 Key',
        fields: [await sourceField(), { prop: 'keys', label: '每行一个 Key', type: 'textarea', required: true }],
        value: { keys: '', sourceId: '' },
        save: (v) =>
          request('/admin/keys', 'POST', {
            keys: String(v.keys)
              .split(/\r?\n/)
              .map((k) => k.trim())
              .filter(Boolean)
              .map((apiKey, index) => ({ name: '批量 Key ' + (index + 1), apiKey, sourceId: v.sourceId })),
          }),
      },
      load
    )
  }
  async function checkKey(row: Row) {
    const models = (await request<Row[]>('/admin/models')).filter(
      (model) => model.provider !== 'ollama' && (!row.source_id || model.source_id === row.source_id)
    )
    editor.value?.open(
      {
        title: '检查 Key 连通性',
        fields: [
          {
            prop: 'modelId',
            label: '通过哪个模型服务检查',
            type: 'select',
            required: true,
            options: models.map((model) => ({
              label: String(model.name),
              value: String(model.id),
            })),
          },
        ],
        value: { modelId: models.find((model) => model.key_id === row.id)?.id || '' },
        save: async (value) => {
          const result = await request<{ health: string; note: string }>(
            '/admin/keys/' + row.id + '/check',
            'POST',
            value
          )
          ElMessage.info(
            result.health === 'reachable'
              ? '列表鉴权连通；生成与工具能力请到模型页面验证。'
              : '检查结果：' + result.health
          )
          return result
        },
      },
      load
    )
  }
</script>
