<template>
  <PagePanel
    title="Key 管理"
    description="凭据在服务器加密保存，仅显示末四位。也可以在添加服务来源时直接填写 Key。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('keys:write')" @click="bulk">批量导入</el-button
      ><el-button v-if="auth.can('keys:write')" type="primary" @click="add"
        >添加 Key</el-button
      ></template
    ><DataTable :rows="data || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { confirmAction } from '@/utils/forms'
  import type { Column, Row } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<import('@/types').Row[]>(() => '/admin/keys'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const columns: Column[] = [
    { prop: 'name', label: '名称' },
    { prop: 'suffix', label: '末四位' },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '启用' : '禁用') },
    { prop: 'health', label: '检查结果' },
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
  function add() {
    editor.value?.open(
      {
        title: '添加 Key',
        fields: [
          { prop: 'name', label: '名称', required: true },
          { prop: 'apiKey', label: 'API Key', type: 'password', required: true },
        ],
        value: { name: '', apiKey: '' },
        save: (v) => request('/admin/keys', 'POST', v),
      },
      load
    )
  }
  function bulk() {
    editor.value?.open(
      {
        title: '批量导入 Key',
        fields: [{ prop: 'keys', label: '每行一个 Key', type: 'textarea', required: true }],
        value: { keys: '' },
        save: (v) =>
          request('/admin/keys', 'POST', {
            keys: String(v.keys)
              .split(/\r?\n/)
              .map((k) => k.trim())
              .filter(Boolean)
              .map((apiKey, index) => ({ name: '批量 Key ' + (index + 1), apiKey })),
          }),
      },
      load
    )
  }
  async function checkKey(row: Row) {
    const models = (await request<Row[]>('/admin/models')).filter(
      (model) => model.provider !== 'ollama'
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
