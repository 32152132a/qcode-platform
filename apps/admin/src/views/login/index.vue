<template>
  <div class="login">
    <router-link class="back" to="/">← 返回下载首页</router-link
    ><el-card
      ><img src="/brand-logo.svg" alt="QCode" />
      <h1>登录管理控制台</h1>
      <p>统一管理团队、模型和使用额度</p>
      <el-alert v-if="demoSelected" title="演示账号可浏览后台，提交操作不会修改数据" type="info" :closable="false" />
      <el-form label-position="top" @submit.prevent="submit"
        ><el-form-item label="账号"
          ><el-input
            v-model="username"
            autocomplete="username"
            placeholder="请输入管理员账号" /></el-form-item
        ><el-form-item label="密码"
          ><el-input
            v-model="password"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入密码" /></el-form-item
        ><el-alert v-if="error" :title="error" type="error" :closable="false" /><el-button
          type="primary"
          native-type="submit"
          :loading="busy"
          >登录</el-button
        ></el-form
      ><el-button v-if="demo" link type="primary" :disabled="busy" @click="useDemo">体验演示版</el-button>
      </el-card
    >
  </div>
</template>
<script setup lang="ts">
  import { ref, computed, onMounted } from 'vue'
  import { request } from '@/api/request'
  import { useRouter, useRoute } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  const username = ref(''),
    password = ref(''),
    busy = ref(false),
    error = ref(''),
    auth = useAuthStore(),
    router = useRouter(),
    route = useRoute()
  const demo = ref<{ username: string; password: string } | null>(null)
  const demoSelected = computed(() => !!demo.value && username.value === demo.value.username)
  onMounted(async () => {
    try {
      const result = await request<{ enabled: boolean; username?: string; password?: string }>('/auth/demo')
      if (result.enabled && result.username && result.password) demo.value = { username: result.username, password: result.password }
    } catch { /* Keep normal login available when demo configuration cannot be read. */ }
  })
  function useDemo() {
    if (!demo.value) return
    username.value = demo.value.username
    password.value = demo.value.password
    error.value = ''
  }
  async function submit() {
    if (!username.value || !password.value) {
      error.value = '请输入账号和密码'
      return
    }
    busy.value = true
    error.value = ''
    try {
      await auth.login(username.value, password.value)
      password.value = ''
      const destination = String(route.query.redirect || '/manage/overview')
      await router.replace(destination.startsWith('/manage/') ? destination : '/manage/overview')
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '登录失败'
    } finally {
      busy.value = false
    }
  }
</script>
<style scoped lang="scss">
  .login {
    min-height: 100vh;
    display: grid;
    align-content: center;
    justify-items: center;
    padding: 28px;
    gap: 28px;
    .back {
      color: #8290a3;
    }
    .el-card {
      width: min(440px, 100%);
      padding: 18px;
      border: 1px solid #e9edf4;
      box-shadow: 0 20px 70px #283e5910;
      border-radius: 20px;
    }
    img {
      width: 48px;
      height: 48px;
    }
    h1 {
      font-size: 24px;
      margin: 24px 0 10px;
    }
    p {
      color: #8a94a5;
      margin-bottom: 28px;
    }
    .el-button {
      width: 100%;
      margin-top: 20px;
      height: 44px;
    }
  }
</style>
