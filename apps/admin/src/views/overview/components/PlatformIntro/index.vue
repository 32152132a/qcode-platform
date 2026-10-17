<template>
  <section class="platform-intro" aria-labelledby="platform-title">
    <header class="intro-heading">
      <span class="eyebrow">团队 AI 工作平台</span>
      <h2 id="platform-title">员工安装即用，团队统一管理</h2>
      <p>把账号、模型和使用管理留在后台，让每个人专注于自己的工作。</p>
    </header>
    <div class="roles">
      <article class="role employee">
        <div class="role-heading"><span class="role-icon"><Monitor /></span><span>给团队成员</span></div>
        <h3>一个客户端，开始使用 AI</h3>
        <p>下载安装客户端，使用团队账号登录，即可选择管理员已启用的模型，无需自行配置模型地址或 API Key。</p>
        <ol class="steps" aria-label="员工使用流程"><li>安装客户端</li><li>登录团队账号</li><li>开始对话与工作</li></ol>
        <router-link class="entry" to="/">前往客户端下载 <ArrowRight /></router-link>
      </article>
      <article class="role admin">
        <div class="role-heading"><span class="role-icon"><Setting /></span><span>给管理员</span></div>
        <h3>统一接入，集中管理</h3>
        <p>创建员工账号，接入官网、本地部署或中转站模型，统一管理 Key、额度与使用记录。后续上新模型，员工无需重新安装。</p>
        <nav class="admin-entries" aria-label="平台管理快捷入口">
          <router-link v-for="entry in entries" :key="entry.path" :to="entry.path">
            <component :is="entry.icon" /><span><b>{{ entry.label }}</b><small>{{ entry.description }}</small></span><ArrowRight />
          </router-link>
        </nav>
      </article>
    </div>
    <footer><Lock /><span>模型 Key 由后台保管，员工使用自己的账号；工作文件在员工电脑上处理，模型请求通过网关统一转发。</span></footer>
  </section>
</template>
<script setup lang="ts">
  import { ArrowRight, Connection, DataAnalysis, Lock, Monitor, Setting, User } from '@element-plus/icons-vue'
  import { getSession } from '@/api/request'

  const entries = [
    { path: '/manage/users', permission: 'users:read', icon: User, label: '管理团队账号', description: '创建账号、管理状态与额度' },
    { path: '/manage/models', permission: 'models:read', icon: Connection, label: '接入与启用模型', description: '官网模型 · 本地部署 · 中转站' },
    { path: '/manage/usage', permission: 'usage:read', icon: DataAnalysis, label: '查看团队用量', description: '请求记录、Token 与估算成本' },
  ].filter(entry => getSession()?.user.permissions.includes(entry.permission))
</script>
<style scoped lang="scss">
  .platform-intro {
    display: grid;
    gap: 26px;
    padding: clamp(22px, 3vw, 38px);
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 12px;
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    .intro-heading {
      display: grid;
      gap: 12px;
      .eyebrow { color: var(--el-color-primary); font-size: 12px; font-weight: 600; }
      h2 { margin: 0; font-size: clamp(22px, 2.4vw, 30px); font-weight: 600; letter-spacing: -.6px; line-height: 1.4; }
      p { margin: 0; color: var(--el-text-color-secondary); font-size: 14px; line-height: 1.8; }
    }
    .roles { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; }
    .role {
      display: grid;
      align-content: start;
      gap: 14px;
      min-width: 0;
      padding: 24px;
      border-radius: 10px;
      background: var(--el-fill-color-lighter);
      h3 { margin: 0; font-size: 19px; font-weight: 600; }
      > p { margin: 0; max-width: 54ch; font-size: 13px; line-height: 1.9; color: var(--el-text-color-regular); }
    }
    .role-heading { display: flex; align-items: center; gap: 9px; color: var(--el-text-color-secondary); font-size: 12px; }
    .role-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--el-bg-color); color: var(--el-color-primary); }
    svg { width: 16px; height: 16px; flex-shrink: 0; }
    .steps { display: grid; gap: 12px; padding-left: 20px; margin: 6px 0 8px; font-size: 13px; color: var(--el-text-color-regular); li::marker { color: var(--el-color-primary); font-weight: 600; } }
    .entry { display: inline-flex; align-items: center; justify-self: start; gap: 10px; min-height: 40px; color: var(--el-color-primary); font-size: 13px; font-weight: 500; }
    .admin-entries {
      display: grid;
      gap: 4px;
      a { display: grid; grid-template-columns: 18px minmax(0, 1fr) 16px; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); color: inherit; &:last-child { border: 0; } &:hover { color: var(--el-color-primary); } }
      span { display: grid; gap: 5px; }
      b { font-size: 13px; font-weight: 500; }
      small { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
    }
    a { text-decoration: none; &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 4px; border-radius: 4px; } }
    footer { display: flex; align-items: flex-start; gap: 9px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.8; svg { margin-top: 3px; } }
    @media (max-width: 800px) { .roles { grid-template-columns: minmax(0, 1fr); gap: 16px; } .role { padding: 20px; } }
  }
</style>
