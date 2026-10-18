<template>
  <section class="team-resources" aria-labelledby="resources-title">
    <header>
      <div><span class="eyebrow">把团队经验，带到每个人的工作台</span><h2 id="resources-title">不只是接入模型，也让 AI 了解你的团队。</h2></div>
      <p>管理员统一配置模型、共享技能与知识资料，员工在客户端同步后使用。</p>
    </header>
    <el-radio-group v-model="selected" aria-label="查看团队资源流程">
      <el-radio-button v-for="item in resources" :key="item.id" :value="item.id">{{ item.label }}</el-radio-button>
    </el-radio-group>
    <div :key="selected" class="resource-flow" :class="{ paused }" aria-live="polite">
      <el-card v-for="(step, index) in active.steps" :key="step.title" shadow="never" class="flow-step" :style="{ '--step': index }">
        <div class="step-heading"><el-icon :size="24"><component :is="step.icon" /></el-icon><span>0{{ index + 1 }}</span></div>
        <el-tag size="small" effect="plain">{{ step.role }}</el-tag>
        <h3>{{ step.title }}</h3><p>{{ step.description }}</p>
      </el-card>
    </div>
    <footer><span>{{ active.note }}</span><el-button text size="small" :aria-pressed="paused" @click="paused = !paused">{{ paused ? '播放动效' : '暂停动效' }}</el-button></footer>
  </section>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { Connection, Document, FolderOpened, Monitor, Reading, SetUp, Upload } from '@element-plus/icons-vue'

  const selected = ref('skills')
  const paused = ref(false)
  const resources = [
    { id: 'models', label: '团队模型', note: '模型地址与 Key 留在后台，上新模型无需重新安装客户端。', steps: [
      { role: '管理员', icon: Connection, title: '接入并启用模型', description: '统一配置官网、本地部署或中转站服务，以及模型 Key 和额度。' },
      { role: '统一分发', icon: SetUp, title: '更新可用模型列表', description: '通过网关向团队提供已启用的模型，不向员工分发真实 Key。' },
      { role: '团队成员', icon: Monitor, title: '选择模型，开始工作', description: '使用团队账号登录，在客户端选择适合任务的模型。' },
    ] },
    { id: 'skills', label: '共享技能 · Skill', note: '流程示意：技能需启用并对当前账号可用；员工可在资料库刷新同步。', steps: [
      { role: '管理员', icon: Upload, title: '发布团队技能', description: '把常用工作规范、操作步骤和任务方法配置为共享 Skill。' },
      { role: '统一分发', icon: SetUp, title: '同步到员工工作台', description: '按启用状态和部门范围分发，团队无需逐台手动安装。' },
      { role: '团队成员', icon: Monitor, title: '让 AI 按团队方法工作', description: '在资料库查看共享技能，处理相关任务时由 AI 按需使用。' },
    ] },
    { id: 'knowledge', label: '团队知识库', note: '流程示意：当前支持 TXT / Markdown 资料，由 AI 按需读取；回答仍需核对来源。', steps: [
      { role: '管理员', icon: Document, title: '上传团队知识资料', description: '集中维护制度、业务说明和操作手册，启用后提供给团队。' },
      { role: '统一分发', icon: FolderOpened, title: '同步团队参考文档', description: '将知识资料同步到员工资料库，更新后可在客户端刷新。' },
      { role: '团队成员', icon: Reading, title: '结合资料，回答问题', description: '提问涉及团队资料时，AI 按需读取相关内容并注明参考来源。' },
    ] },
  ]
  const active = computed(() => resources.find(item => item.id === selected.value) || resources[0]!)
</script>
<style scoped lang="scss">
  .team-resources {
    display: grid; gap: 24px; padding-block: clamp(40px, 6vw, 80px);
    header { max-width: 760px; .eyebrow { color: var(--el-color-primary); font-size: 13px; } h2 { margin: 14px 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.45; letter-spacing: -.6px; } p { margin: 0; } }
    p, footer { color: var(--el-text-color-secondary); font-size: 14px; line-height: 1.8; }
    .resource-flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
    .flow-step {
      min-width: 0; border-radius: 16px; animation: resource-pulse 9s ease-in-out infinite; animation-delay: calc(var(--step) * 3s);
      :deep(.el-card__body) { display: grid; justify-items: start; gap: 14px; padding: 28px; }
      .step-heading { display: flex; align-items: center; justify-content: space-between; width: 100%; color: var(--el-color-primary); span { color: var(--el-text-color-placeholder); font-size: 13px; } }
      h3 { margin: 0; font-size: 19px; font-weight: 600; } p { margin: 0; }
    }
    .paused .flow-step { animation-play-state: paused; }
    footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
    @keyframes resource-pulse { 0%, 33%, 100% { border-color: var(--el-border-color-light); box-shadow: none; } 10%, 23% { border-color: var(--el-color-primary-light-5); box-shadow: 0 8px 28px var(--el-color-primary-light-9); } }
    @media (max-width: 700px) { .resource-flow { grid-template-columns: minmax(0, 1fr); gap: 12px; } .flow-step :deep(.el-card__body) { padding: 22px; } footer { align-items: start; } }
    @media (prefers-reduced-motion: reduce) { .flow-step { animation: none; } footer .el-button { display: none; } }
  }
</style>
