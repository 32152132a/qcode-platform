<template>
  <div class="admin-layout">
    <aside>
      <router-link class="brand" to="/download"
        ><img src="/branding/qcode-96.png" alt="QCode" /><span
          >QCode<small>团队 AI 控制台</small></span
        ></router-link
      >
      <nav>
        <router-link v-for="item in items" :key="item.id" :to="'/manage/' + item.id">{{
          item.label
        }}</router-link>
      </nav>
      <div class="account">
        <span>{{ auth.user?.username }}</span
        ><el-button text @click="logout">退出登录</el-button>
      </div>
    </aside>
    <main>
      <div class="mobile-nav">
        <el-select :model-value="route.path" @change="router.push"
          ><el-option
            v-for="item in items"
            :key="item.id"
            :label="item.label"
            :value="'/manage/' + item.id"
        /></el-select>
      </div>
      <router-view />
    </main>
  </div>
</template>
<script setup lang="ts">
  import { computed } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useAuthStore } from '@/stores/auth'
  const auth = useAuthStore(),
    router = useRouter(),
    route = useRoute()
  const entries = [
    ['overview', '工作台概览', 'usage'],
    ['users', '用户管理', 'users'],
    ['models', '模型与服务', 'models'],
    ['keys', 'Key 管理', 'keys'],
    ['departments', '部门管理', 'departments'],
    ['skills', '共享 Skill', 'skills'],
    ['knowledge', '知识库', 'knowledge'],
    ['usage', '用量统计', 'usage'],
    ['requests', '请求日志', 'requests'],
    ['audits', '操作审计', 'audits'],
    ['settings', '系统设置', 'settings'],
    ['system', '系统状态', 'system'],
  ]
  const items = computed(() =>
    entries.filter((item) => auth.can(item[2] + ':read')).map(([id, label]) => ({ id, label }))
  )
  async function logout() {
    await auth.logout()
    await router.replace('/login')
  }
</script>
<style scoped lang="scss">
  .admin-layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 100vh;
    aside {
      display: flex;
      flex-direction: column;
      padding: 30px 20px;
      background: white;
      border-right: 1px solid #e9edf4;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 23px;
      font-weight: 650;
      padding: 0 12px 30px;
      img {
        width: 38px;
        height: 38px;
      }
      small {
        display: block;
        font-size: 11px;
        font-weight: 400;
        color: #8b94a5;
        margin-top: 5px;
      }
    }
    nav {
      display: grid;
      gap: 5px;
      a {
        padding: 12px 16px;
        border-radius: 9px;
        color: #727e90;
        font-size: 14px;
        &.router-link-active {
          color: #465fcb;
          background: #eef1fd;
          font-weight: 600;
        }
        &:hover {
          background: #f5f7fc;
        }
      }
    }
    .account {
      margin-top: auto;
      padding: 30px 10px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    main {
      padding: 44px clamp(24px, 5vw, 100px);
      min-width: 0;
      max-width: 1700px;
      width: 100%;
      margin: 0 auto;
    }
    .mobile-nav {
      display: none;
    }
    @media (max-width: 800px) {
      grid-template-columns: minmax(0, 1fr);
      aside {
        display: none;
      }
      main {
        padding: 24px 16px;
      }
      .mobile-nav {
        display: block;
        margin-bottom: 24px;
      }
    }
  }
</style>
