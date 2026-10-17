<template>
  <el-dialog v-model="visible" title="登录设备" width="650px" destroy-on-close>
    <section class="user-sessions">
      <p>{{ user?.username }} 的有效登录设备。撤销后，该设备需要重新登录。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <DataTable
        v-loading="loading"
        :rows="sessions"
        :columns="columns"
        :actions="actions"
        :searchable="false"
      />
    </section>
  </el-dialog>
</template>
<script setup lang="ts">
  import { ref } from 'vue'
  import { ElMessageBox } from 'element-plus'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import { request } from '@/api/request'
  import { date } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const visible = ref(false),
    loading = ref(false),
    error = ref(''),
    sessions = ref<Row[]>([]),
    user = ref<Row>()
  const columns: Column[] = [
    { prop: 'device', label: '设备', minWidth: 120 },
    { prop: 'created_at', label: '登录时间', minWidth: 175, render: (row) => date(row.created_at) },
  ]
  const actions: RowAction[] = [{ label: '撤销', danger: true, run: revoke }]
  let success: (() => void) | undefined
  let sequence = 0
  async function open(value: Row, onSuccess?: () => void) {
    user.value = value
    success = onSuccess
    sessions.value = []
    visible.value = true
    await load()
  }
  async function load() {
    if (!user.value) return
    const current = ++sequence,
      userId = user.value.id
    loading.value = true
    error.value = ''
    try {
      const result = await request<Row[]>('/admin/users/' + userId + '/sessions')
      if (current === sequence) sessions.value = result
    } catch (cause) {
      if (current === sequence)
        error.value = cause instanceof Error ? cause.message : '读取设备失败'
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  async function revoke(row: Row) {
    if (!user.value) return
    const userId = user.value.id
    try {
      await ElMessageBox.confirm('撤销这个设备登录？', '确认操作', { type: 'warning' })
    } catch {
      return
    }
    await request('/admin/users/' + userId + '/sessions/' + row.id, 'DELETE')
    await load()
    success?.()
  }
  defineExpose({ open })
</script>
<style scoped lang="scss">
  .user-sessions {
    display: grid;
    gap: 16px;
    min-width: 0;
    p {
      margin: 0;
      color: var(--el-text-color-secondary);
      line-height: 1.8;
      font-size: 13px;
    }
  }
</style>
