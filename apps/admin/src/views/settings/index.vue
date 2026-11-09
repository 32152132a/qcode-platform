<template>
  <PagePanel
    title="系统设置"
    description="设置产品名称和网关运行限制。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('settings:write')" type="primary" @click="edit(false)"
        >修改设置</el-button
      ></template
    ><el-card shadow="never"
      ><el-descriptions :column="1" border
        ><el-descriptions-item v-for="(label, key) in labels" :key="key" :label="label">{{
          typeof data?.[key] === 'boolean' ? (data[key] ? '开启' : '关闭') : data?.[key]
        }}</el-descriptions-item></el-descriptions
      ></el-card
    ><el-text type="info" size="small"
      >产品名称在客户端下次启动时生效。</el-text
    >
    <el-collapse
      ><el-collapse-item title="高级设置" name="advanced"
        ><el-descriptions :column="1" border
          ><el-descriptions-item v-for="(label, key) in advancedLabels" :key="key" :label="label">{{
            typeof data?.[key] === 'boolean' ? (data[key] ? '开启' : '关闭') : (data?.[key] ?? '—')
          }}</el-descriptions-item></el-descriptions
        ><el-button v-if="auth.can('settings:write')" @click="edit(true)"
          >修改高级设置</el-button
        ></el-collapse-item
      ></el-collapse
    >
    <EntityDialog ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import type { Row } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row>(() => '/admin/settings'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const labels: Record<string, string> = {
    productName: '产品名称',
  }
  const advancedLabels: Record<string, string> = {
    minimumClientVersion: '最低客户端版本',
    maxActiveRequests: '网关最大并发数',
    auditRetentionDays: '审计保留天数（0 不限）',
  }
  function edit(advanced = false) {
    editor.value?.open(
      {
        title: advanced ? '高级设置' : '产品设置',
        fields: Object.entries(advanced ? advancedLabels : labels).map(([prop, label]) => ({
          prop,
          label,
          type: ['maxActiveRequests', 'auditRetentionDays'].includes(prop) ? 'number' : 'input',
          required: true,
          ...(prop === 'productName' ? { props: { maxlength: 32 } } : {}),
        })),
        value: { ...data.value },
        save: (v) =>
          request(
            '/admin/settings',
            'PUT',
            advanced
              ? {
                  minimumClientVersion: v.minimumClientVersion,
                  maxActiveRequests: Number(v.maxActiveRequests),
                  auditRetentionDays: Number(v.auditRetentionDays),
                }
              : { productName: v.productName },
          ),
      },
      load,
    )
  }
</script>
