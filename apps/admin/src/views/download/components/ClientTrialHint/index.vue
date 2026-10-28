<template>
  <div class="client-trial" aria-label="员工客户端体验账号">
    <small v-if="username && password">
      员工体验账号：<code>{{ username }}</code>　密码：<code>{{ password }}</code>
      <el-button link size="small" @click="copyAccount">复制账号密码</el-button>
      <span>安装后登录使用，体验范围和额度以后台配置为准。</span>
    </small>
    <small v-else>员工体验账号：待开放。安装后请使用管理员提供的账号登录。</small>
  </div>
</template>
<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  const username = String(import.meta.env.VITE_CLIENT_TRIAL_USERNAME || '').trim()
  const password = String(import.meta.env.VITE_CLIENT_TRIAL_PASSWORD || '')
  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(`账号：${username}\n密码：${password}`)
      ElMessage.success('体验账号已复制')
    } catch { ElMessage.warning('复制失败，请手动复制账号密码') }
  }
</script>
<style scoped lang="scss">
  .client-trial {
    color: var(--el-text-color-secondary); line-height: 1.8;
    small { font-size: 12px; overflow-wrap: anywhere; }
    code { color: var(--el-text-color-regular); }
    span { display: block; }
  }
</style>
