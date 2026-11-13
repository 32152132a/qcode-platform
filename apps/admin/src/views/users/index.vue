<template>
  <PagePanel
    title="用户管理"
    description="管理用户账号与套餐。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><template v-if="auth.can('users:write')"
        ><el-button type="primary" @click="userDialog?.open(load)">创建用户</el-button></template
      ></template
    ><UserDialog ref="userDialog" /><DataTable :rows="data || []" :columns="columns" :actions="actions" /><PasswordDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import UserDialog from './components/UserDialog/index.vue'
  import PasswordDialog from './components/PasswordDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { date, confirmAction } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row[]>(() => '/admin/users'),
    editor = ref<InstanceType<typeof PasswordDialog>>()
  const userDialog=ref<InstanceType<typeof UserDialog>>()
  const columns: Column[] = [
    { prop: 'username', label: '用户', minWidth: 120 },
    { prop: 'plan_name', label: '套餐' },
    { prop: 'role', label: '角色', render: r => ({admin:'管理员',demo:'演示账号',user:'普通用户'}[String(r.role)] || '—') },
    { prop: 'is_active', label: '状态', render: (r) => (r.is_active ? '正常' : '已冻结') },
    { prop: 'created_at', label: '创建时间', minWidth: 175, render: (r) => date(r.created_at) },
    {
      prop: 'last_login_at',
      label: '最后登录',
      minWidth: 175,
      render: (r) => date(r.last_login_at),
    },
    {
      prop: 'credit_usage.used',
      label: '已用金额（元）',
      render: r => amount((r.credit_usage as Row | null)?.used),
    },
    {
      prop: 'credit_usage.limit',
      label: '套餐总额度（元）',
      render: r => amount((r.credit_usage as Row | null)?.limit),
    },
  ]
  function amount(value: unknown) {
    return typeof value === 'number' ? (value / 1000000).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 4}) : '—'
  }
  const writable = (r: Row) =>
    auth.can('users:write') && (r.role !== 'admin' || auth.user?.role === 'admin')
  const actions = computed<RowAction[]>(() => [
    {
      label: '重置密码',
      visible: r => writable(r) && r.role === 'user',
      run: (r) => editor.value?.open(r,load),
    },
    { label: '冻结', visible: r => writable(r) && r.role === 'user' && Boolean(r.is_active),
      run: r => setActive(r, false) },
    { label: '恢复使用', visible: r => writable(r) && r.role === 'user' && !r.is_active,
      run: r => setActive(r, true) },
    {
      label: '删除',
      danger: true,
      visible: (r) => writable(r) && r.role === 'user',
      run: (r) =>
        confirmAction(
          '删除 ' + r.username + '？历史用量保留。',
          () => request('/admin/users/' + r.id, 'DELETE'),
          load
        ),
    },
  ])
  function setActive(row: Row, isActive: boolean) {
    return confirmAction(
      (isActive ? '恢复使用' : '冻结') + ' ' + row.username + '？',
      () => request('/admin/users/' + row.id + '/status', 'PATCH', { isActive }),
      load,
    )
  }
</script>
