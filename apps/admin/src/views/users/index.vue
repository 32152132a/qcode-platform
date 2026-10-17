<template>
  <PagePanel
    title="用户管理"
    description="管理账号、额度与登录设备。额度为 0 表示不限。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><template v-if="auth.can('users:write')"
        ><el-button @click="importCsv">导入 CSV</el-button
        ><el-button @click="template">下载模板</el-button
        ><el-button type="primary" @click="edit()">创建用户</el-button></template
      ></template
    ><DataTable :rows="data || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor" /><UserSessionsDialog ref="sessionDialog"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import UserSessionsDialog from './components/UserSessionsDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { quotaFields, quotaValues, quotaBody, date, confirmAction } from '@/utils/forms'
  import { importUsersCsv, downloadText } from '@/utils/csv'
  import type { Row, Field, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row[]>(() => '/admin/users'),
    editor = ref<InstanceType<typeof EntityDialog>>(),
    sessionDialog = ref<InstanceType<typeof UserSessionsDialog>>()
  const columns: Column[] = [
    { prop: 'username', label: '用户', minWidth: 120 },
    { prop: 'department', label: '部门' },
    { prop: 'role', label: '角色' },
    { prop: 'is_active', label: '状态', render: (r) => (r.is_active ? '启用' : '禁用') },
    { prop: 'created_at', label: '创建时间', minWidth: 175, render: (r) => date(r.created_at) },
    {
      prop: 'last_login_at',
      label: '最后登录',
      minWidth: 175,
      render: (r) => date(r.last_login_at),
    },
    {
      prop: 'active_sessions',
      label: '登录设备',
      render: (r) => String(r.active_sessions) + ' / ' + r.session_limit,
    },
    {
      prop: 'used',
      label: '已计费 Token',
      render: (r) => String((r.used as Row)?.totalTokens || 0),
    },
    {
      prop: 'remaining',
      label: '剩余总 Token',
      render: (r) =>
        (r.remaining as Row)?.totalTokens == null
          ? '不限'
          : String((r.remaining as Row).totalTokens),
    },
  ]
  const writable = (r: Row) =>
    auth.can('users:write') && (r.role !== 'admin' || auth.user?.role === 'admin')
  const actions = computed<RowAction[]>(() => [
    { label: '编辑', visible: writable, run: edit },
    {
      label: '重置密码',
      visible: writable,
      run: (r) =>
        editor.value?.open(
          {
            title: '重置 ' + r.username + ' 密码',
            fields: [
              { prop: 'password', label: '新密码（至少 10 位）', type: 'password', required: true },
            ],
            value: { password: '' },
            save: (value) => request('/admin/users/' + r.id + '/password', 'POST', value),
          },
          load
        ),
    },
    { label: '登录设备', visible: writable, run: openSessions },
    {
      label: '撤销全部登录',
      visible: writable,
      run: (r) =>
        confirmAction(
          '撤销 ' + r.username + ' 的全部登录？',
          () => request('/admin/users/' + r.id + '/revoke-sessions', 'POST', {}),
          load
        ),
    },
    {
      label: '恢复额度',
      visible: writable,
      run: (r) =>
        confirmAction(
          '重置此用户各周期额度？历史记录会保留。',
          () => request('/admin/users/' + r.id + '/reset-quota', 'POST', {}),
          load
        ),
    },
    {
      label: '切换状态',
      visible: (r) => writable(r) && r.role !== 'admin',
      run: (r) =>
        confirmAction(
          (r.is_active ? '禁用' : '启用') + ' ' + r.username + '？',
          () => request('/admin/users/' + r.id + '/status', 'PATCH', { isActive: !r.is_active }),
          load
        ),
    },
    {
      label: '删除',
      danger: true,
      visible: (r) => writable(r) && r.role !== 'admin',
      run: (r) =>
        confirmAction(
          '删除 ' + r.username + '？历史用量保留。',
          () => request('/admin/users/' + r.id, 'DELETE'),
          load
        ),
    },
  ])
  async function edit(row?: Row) {
    try {
      const [departments, models, keys] = await Promise.all([
        request<Row[]>('/admin/departments'),
        auth.can('models:read') ? request<Row[]>('/admin/models') : Promise.resolve([]),
        auth.can('keys:read') ? request<Row[]>('/admin/keys') : Promise.resolve([]),
      ])
      const options = (rows: Row[]) => [
        { label: '不指定', value: '' },
        ...rows.map((r) => ({ label: String(r.name), value: String(r.id) })),
      ]
      const fields: Field[] = [
        ...(!row
          ? [
              { prop: 'username', label: '账号', required: true },
              {
                prop: 'password',
                label: '初始密码（至少 10 位）',
                type: 'password',
                required: true,
              },
            ]
          : []),
        { prop: 'departmentId', label: '部门', type: 'select', options: options(departments) },
        { prop: 'modelId', label: '默认模型', type: 'select', options: options(models) },
        {
          prop: 'quotaMode',
          label: '额度来源',
          type: 'select',
          options: [
            { label: '个人额度', value: 'custom' },
            { label: '继承部门', value: 'department' },
          ],
        },
        { prop: 'sessionLimit', label: '登录设备上限', type: 'number' },
        { prop: 'maxConcurrentRequests', label: '并发请求上限', type: 'number' },
        ...quotaFields,
      ]
      if (auth.can('keys:read'))
        fields.push({
          prop: 'keyId',
          label: '专用 Key（可不指定）',
          type: 'select',
          options: options(keys),
        })
      if (auth.user?.role === 'admin')
        fields.push({
          prop: 'role',
          label: '角色',
          type: 'select',
          options: [
            { label: '普通用户', value: 'user' },
            { label: '运维', value: 'operator' },
            { label: '审计员', value: 'auditor' },
            { label: '管理员', value: 'admin' },
          ],
        })
      editor.value?.open(
        {
          title: row ? '编辑 ' + row.username : '创建用户',
          fields,
          value: {
            ...quotaValues(row),
            username: '',
            password: '',
            departmentId: row?.department_id || '',
            modelId: row?.model_id || '',
            keyId: row?.key_id || '',
            quotaMode: row?.quota_mode || 'custom',
            sessionLimit: row?.session_limit ?? 1,
            maxConcurrentRequests: row?.max_concurrent_requests ?? 1,
            role: row?.role || 'user',
          },
          save: (value) => {
            const body: Row = {
              departmentId: value.departmentId || null,
              modelId: value.modelId || null,
              quotaMode: value.quotaMode,
              maxConcurrentRequests: Number(value.maxConcurrentRequests),
              quotas: quotaBody(value),
            }
            if (!row || Number(value.sessionLimit) !== row.session_limit)
              body.sessionLimit = Number(value.sessionLimit)
            if (auth.can('keys:read')) body.keyId = value.keyId || null
            if (auth.user?.role === 'admin') body.role = value.role
            if (!row) {
              body.username = value.username
              body.password = value.password
            }
            return request('/admin/users' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body)
          },
        },
        load
      )
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '读取失败')
    }
  }
  function openSessions(row: Row) {
    return sessionDialog.value?.open(row, load)
  }
  async function importCsv() {
    try {
      await importUsersCsv(request)
      await load()
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '导入失败')
    }
  }
  function template() {
    downloadText('员工导入模板.csv', '\uFEFF用户名,初始密码,部门\r\n')
  }
</script>
