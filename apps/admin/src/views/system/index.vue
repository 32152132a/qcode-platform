<template>
  <PagePanel
    title="系统状态"
    description="备份恢复通过服务器受版本管理的维护命令执行，避免网页误操作。"
    :loading="loading"
    :error="error"
    ><template #actions><el-button @click="load">刷新</el-button></template
    ><el-card shadow="never"
      ><el-descriptions :column="1" border
        ><el-descriptions-item v-for="(label, key) in labels" :key="key" :label="label">{{
          data?.[key]
        }}</el-descriptions-item></el-descriptions
      ></el-card
    ></PagePanel
  >
</template>
<script setup lang="ts">
  import PagePanel from '@/components/PagePanel/index.vue'
  import { useResource } from '@/hooks/useResource'
  import type { Row } from '@/types'
  const { data, loading, error, load } = useResource<Row>(() => '/admin/system')
  const labels: Record<string, string> = {
    version: '网关版本',
    storage: '存储方式',
    timezone: '统计时区',
    requestTimeoutMs: '请求超时 ms',
    uptimeSeconds: '运行时长（秒）',
    pendingRequests: '进行中的请求',
    tokenTtlDays: '令牌期限（天）',
  }
</script>
