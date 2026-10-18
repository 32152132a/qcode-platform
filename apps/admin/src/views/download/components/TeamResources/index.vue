<template>
  <section class="team-resources" aria-labelledby="resources-title">
    <header data-reveal>
      <span class="eyebrow">团队能力，一处配置</span>
      <h2 id="resources-title">模型、技能和知识，交给团队统一管理。</h2>
      <p>员工登录客户端，同步后即可使用，无需逐台配置。</p>
    </header>
    <div class="resource-cards">
      <el-card v-for="resource in resources" :key="resource.title" shadow="never" data-reveal>
        <el-icon :size="26"><component :is="resource.icon" /></el-icon>
        <h3>{{ resource.title }}</h3><p>{{ resource.description }}</p>
      </el-card>
    </div>
  </section>
</template>
<script setup lang="ts">
  import { Connection, Reading, SetUp } from '@element-plus/icons-vue'

  const resources = [
    { icon: Connection, title: '统一接入模型', description: '接入官网、本地部署或中转站模型，员工直接选择，真实 Key 留在后台。' },
    { icon: SetUp, title: '共享团队技能', description: '发布团队常用的工作方法与规范，员工同步 Skill，无需逐台安装。' },
    { icon: Reading, title: '团队知识库', description: '上传制度、手册和业务资料，员工同步后，AI 在相关任务中按需参考。' },
  ]
</script>
<style scoped lang="scss">
  .team-resources {
    display: grid; gap: 28px; padding-block: clamp(40px, 6vw, 80px);
    header { max-width: 760px; .eyebrow { color: var(--el-color-primary); font-size: 13px; } h2 { margin: 14px 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.45; letter-spacing: -.6px; } }
    p { margin: 0; color: var(--el-text-color-secondary); font-size: 14px; line-height: 1.8; }
    .resource-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
    .el-card { min-width: 0; border-radius: 16px; :deep(.el-card__body) { padding: 28px; } .el-icon { color: var(--el-color-primary); } h3 { margin: 20px 0 12px; font-size: 19px; font-weight: 600; } }
    @media (max-width: 700px) { .resource-cards { grid-template-columns: minmax(0, 1fr); gap: 12px; } .el-card :deep(.el-card__body) { padding: 22px; } }
  }
</style>
