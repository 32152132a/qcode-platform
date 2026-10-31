<template>
  <PagePanel title="系统状态" :loading="loading" :error="error"
    ><template #actions><el-button @click="load">刷新</el-button></template>
    <template v-if="data"
      ><el-alert v-if="!error" title="网关运行正常" type="success" :closable="false" show-icon />
      <el-descriptions :column="1" border
        ><el-descriptions-item label="连续运行">{{ duration }}</el-descriptions-item
        ><el-descriptions-item label="进行中的请求"
          >{{ data.pendingRequests }} / {{ data.maxActiveRequests }}</el-descriptions-item
        ><el-descriptions-item label="网关进程内存"
          >{{ Math.round(Number(data.memoryBytes) / 1048576) }} MB</el-descriptions-item
        ></el-descriptions
      >
      <router-link to="/manage/requests"
        ><el-button link type="primary">查看错误与警告</el-button></router-link
      >
      <el-collapse
        ><el-collapse-item title="技术详情" name="details"
          ><el-descriptions :column="1" border
            ><el-descriptions-item v-for="(label, key) in labels" :key="key" :label="label">{{
              data[key] ?? '—'
            }}</el-descriptions-item></el-descriptions
          ></el-collapse-item
        ></el-collapse
      >
    </template></PagePanel
  >
</template>
<script setup lang="ts">
  import { computed } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import { useResource } from '@/hooks/useResource'
  import type { Row } from '@/types'
  const { data, loading, error, load } = useResource<Row>(() => '/admin/system')
  const duration = computed(() => {
    const minutes = Math.floor(Number(data.value?.uptimeSeconds || 0) / 60)
    return (
      Math.floor(minutes / 1440) +
      ' 天 ' +
      Math.floor((minutes % 1440) / 60) +
      ' 小时 ' +
      (minutes % 60) +
      ' 分钟'
    )
  })
  const labels = {
    version: '网关版本',
    storage: '存储方式',
    timezone: '统计时区',
    requestTimeoutMs: '请求超时（毫秒）',
    accessTokenMinutes: '访问令牌有效期（分钟）',
    refreshTokenDays: '登录续期有效期（天）',
  }
</script>
