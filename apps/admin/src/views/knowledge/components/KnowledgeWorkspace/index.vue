<template>
  <section class="knowledge-workspace">
    <KnowledgeManager v-show="!testing" :can-test="canTest" @test="testing=true" />
    <template v-if="testing">
      <header class="knowledge-workspace__test-heading">
        <h1>测试问答</h1>
        <el-button text :icon="ArrowLeft" @click="testing=false">返回知识库</el-button>
      </header>
      <KnowledgeTest />
    </template>
  </section>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue'
import {ArrowLeft} from '@element-plus/icons-vue'
import {useAuthStore} from '@/stores/auth'
import KnowledgeManager from '../KnowledgeManager/index.vue'
import KnowledgeTest from '../KnowledgeTest/index.vue'
const testing=ref(false),auth=useAuthStore(),canTest=computed(()=>auth.can('knowledge:write'))
</script>
<style scoped lang="scss">
.knowledge-workspace{
  display:flex;flex-direction:column;flex:1;min-height:0;
  &__test-heading{
    display:flex;align-items:center;justify-content:space-between;gap:12px;
    min-height:44px;border-bottom:1px solid var(--el-border-color-lighter);
    h1{margin:0;font-size:17px}
  }
}
</style>
