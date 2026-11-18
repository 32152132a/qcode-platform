<template>
  <section class="knowledge-workspace">
    <el-tabs v-model="tab"><el-tab-pane label="知识管理" name="manage"/><el-tab-pane label="问答测试" name="test"/></el-tabs>
    <KnowledgeManager v-if="tab==='manage'" />
    <KnowledgeTest v-else-if="canTest" />
    <el-empty v-else description="演示账号不执行模型测试" />
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {useAuthStore} from '@/stores/auth'
import KnowledgeManager from '../KnowledgeManager/index.vue'
import KnowledgeTest from '../KnowledgeTest/index.vue'
const tab=ref('manage'),auth=useAuthStore(),canTest=computed(()=>auth.can('knowledge:write'))
</script>
<style scoped lang="scss">
.knowledge-workspace{
  display:flex;flex-direction:column;flex:1;min-height:0;
  >.el-tabs{flex-shrink:0;:deep(.el-tabs__header){margin:0 0 16px}:deep(.el-tabs__nav-wrap::after){height:1px;background:var(--el-border-color-lighter)}:deep(.el-tabs__item){height:42px;font-size:13px}:deep(.el-tabs__active-bar){height:2px;border-radius:2px}}
}
</style>
