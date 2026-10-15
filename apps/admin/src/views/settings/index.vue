<template>
  <PagePanel
    title="系统设置"
    description="统一设置组织信息、员工支持提示和网关运行限制。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('settings:write')" type="primary" @click="edit"
        >修改设置</el-button
      ></template
    ><el-card shadow="never"
      ><el-descriptions :column="1" border
        ><el-descriptions-item v-for="(label, key) in labels" :key="key" :label="label">{{
          typeof data?.[key] === 'boolean' ? (data[key] ? '开启' : '关闭') : data?.[key]
        }}</el-descriptions-item></el-descriptions
      ></el-card
    ><EntityDialog ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { yesNo } from '@/utils/forms'
  import type { Row } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row>(() => '/admin/settings'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const labels: Record<string, string> = {
    organizationName: '组织名称',
    supportMessage: '员工支持提示',
    minimumClientVersion: '最低客户端版本',
    autoUpdate: '旧版客户端启动时自动升级',
    maxActiveRequests: '网关最大并发数',
    auditRetentionDays: '审计保留天数（0 不限）',
  }
  function edit() {
    editor.value?.open(
      {
        title: '系统设置',
        fields: Object.entries(labels).map(([prop, label]) => ({
          prop,
          label,
          type:
            prop === 'autoUpdate'
              ? 'select'
              : ['maxActiveRequests', 'auditRetentionDays'].includes(prop)
                ? 'number'
                : 'input',
          options: prop === 'autoUpdate' ? yesNo : undefined,
          required: true,
        })),
        value: { ...data.value, autoUpdate: String(data.value?.autoUpdate ?? false) },
        save: (v) =>
          request('/admin/settings', 'PUT', {
            organizationName: v.organizationName,
            supportMessage: v.supportMessage,
            minimumClientVersion: v.minimumClientVersion,
            autoUpdate: v.autoUpdate === 'true',
            maxActiveRequests: Number(v.maxActiveRequests),
            auditRetentionDays: Number(v.auditRetentionDays),
          }),
      },
      load
    )
  }
</script>
