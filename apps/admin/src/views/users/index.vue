<template>
  <PagePanel
    title="用户管理"
    description="管理用户账号、套餐与登录设备。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><template v-if="auth.can('users:write')"
        ><el-button type="primary" @click="edit()">创建用户</el-button></template
      ></template
    ><UserDialog ref="userDialog" /><DataTable :rows="data || []" :columns="columns" :actions="actions" /><PasswordDialog
      ref="editor" /><UserSessionsDialog ref="sessionDialog"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import UserDialog from './components/UserDialog/index.vue'
  import PasswordDialog from './components/PasswordDialog/index.vue'
  import UserSessionsDialog from './components/UserSessionsDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { date, confirmAction } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row[]>(() => '/admin/users'),
    editor = ref<InstanceType<typeof PasswordDialog>>()
  const userDialog=ref<InstanceType<typeof UserDialog>>()
  const sessionDialog = ref<InstanceType<typeof UserSessionsDialog>>()
  const columns: Column[] = [
    { prop: 'username', label: '用户', minWidth: 120 },
    { prop: 'plan_name', label: '套餐' },
    { prop: 'role', label: '角色', render: r => ({admin:'管理员',demo:'演示账号',user:'普通用户'}[String(r.role)] || '—') },
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
      label: '已用 Token',
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
      visible: r => writable(r) && r.role === 'user',
      run: (r) => editor.value?.open(r,load),
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
      label: '切换状态',
      visible: (r) => writable(r) && r.role === 'user',
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
  function edit(row?:Row){userDialog.value?.open(row,load)}
  function openSessions(row: Row) {
    return sessionDialog.value?.open(row, load)
  }
</script>
