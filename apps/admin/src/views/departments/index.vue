<template>
  <PagePanel
    title="部门管理"
    description="设置部门共享额度与成员默认额度，0 表示不限。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('departments:write')" type="primary" @click="edit()"
        >创建部门</el-button
      ></template
    ><DataTable :rows="data || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { quotaFields, quotaValues, quotaBody, yesNo, confirmAction } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row[]>(() => '/admin/departments'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const columns: Column[] = [
    { prop: 'name', label: '部门' },
    { prop: 'members', label: '成员数' },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '启用' : '停用') },
    {
      prop: 'used',
      label: '已计费 Token',
      render: (r) => String((r.used as Row)?.totalTokens || 0),
    },
  ]
  const actions = computed<RowAction[]>(() =>
    auth.can('departments:write')
      ? [
          { label: '编辑', run: edit },
          {
            label: '恢复共享额度',
            run: (r) =>
              confirmAction(
                '恢复此部门共享额度？不影响成员个人额度。',
                () => request('/admin/departments/' + r.id + '/reset-quota', 'POST', {}),
                load
              ),
          },
          {
            label: '删除',
            danger: true,
            run: (r) =>
              confirmAction(
                '删除空部门？有关联用户或 Skill 时无法删除。',
                () => request('/admin/departments/' + r.id, 'DELETE'),
                load
              ),
          },
        ]
      : []
  )
  async function edit(row?: Row) {
    const models = auth.can('models:read') ? await request<Row[]>('/admin/models') : []
    const keys = auth.can('keys:read') ? await request<Row[]>('/admin/keys') : []
    const opts = (rows: Row[]) => [
      { label: '不指定', value: '' },
      ...rows.map((r) => ({ label: String(r.name), value: String(r.id) })),
    ]
    editor.value?.open(
      {
        title: row ? '编辑部门' : '创建部门',
        fields: [
          { prop: 'name', label: '名称', required: true },
          { prop: 'active', label: '是否启用', type: 'select', options: yesNo },
          { prop: 'modelId', label: '默认模型', type: 'select', options: opts(models) },
          ...(auth.can('keys:read')
            ? [{ prop: 'keyId', label: '部门 Key', type: 'select', options: opts(keys) }]
            : []),
          ...quotaFields.map((f) => ({ ...f, label: '部门共享 ' + f.label })),
          ...quotaFields.map((f) => ({
            ...f,
            prop: 'user_' + f.prop,
            label: '成员默认 ' + f.label,
          })),
        ],
        value: {
          name: row?.name || '',
          active: String(row?.active ?? true),
          modelId: row?.model_id || '',
          keyId: row?.key_id || '',
          ...quotaValues(row),
          ...Object.fromEntries(
            Object.entries(quotaValues(row, 'user_quotas')).map(([k, v]) => ['user_' + k, v])
          ),
        },
        save: (v) =>
          request('/admin/departments' + (row ? '/' + row.id : ''), row ? 'PUT' : 'POST', {
            name: v.name,
            active: v.active === 'true',
            modelId: v.modelId || null,
            ...(auth.can('keys:read') ? { keyId: v.keyId || null } : {}),
            quotas: quotaBody(v),
            userQuotas: quotaBody(
              Object.fromEntries(
                Object.keys(v)
                  .filter((k) => k.startsWith('user_'))
                  .map((k) => [k.slice(5), v[k]])
              )
            ),
          }),
      },
      load
    )
  }
</script>
