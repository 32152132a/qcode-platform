<template>
  <el-dialog v-model="visible" title="确认发布全部变更？" width="480px" :close-on-click-modal="false" :show-close="!loading">
    <p>建议先使用 AI 美化，优化目录、标题和摘要，可大幅提升知识检索命中率。</p>
    <el-text type="info">{{ summary }}</el-text>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template #footer>
      <el-button :disabled="loading" @click="beautify">先去美化</el-button>
      <el-button type="primary" :loading="loading" @click="publish">直接发布</el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import {ElMessage} from 'element-plus'
import {request} from '@/api/request'
import type {KnowledgeChange} from '../../types'
const visible=ref(false),loading=ref(false),error=ref(''),summary=ref('')
let revision='',onSuccess:(()=>void)|undefined,onBeautify:(()=>void)|undefined
function open(input:{revision:string;changes:KnowledgeChange[]},success:()=>void,beautify:()=>void){
  revision=input.revision;onSuccess=success;onBeautify=beautify;error.value=''
  const count=(operation:string)=>input.changes.filter(item=>item.kind==='article'&&item.operation===operation).length
  summary.value='新增 '+count('add')+' 篇，修改 '+count('update')+' 篇，删除 '+count('delete')+' 篇；相关目录将一并发布。'
  visible.value=true
}
function beautify(){visible.value=false;onBeautify?.()}
async function publish(){
  if(loading.value)return
  loading.value=true;error.value=''
  try{await request('/admin/knowledge/publish','POST',{revision});visible.value=false;ElMessage.success('全部变更已发布');onSuccess?.()}
  catch(cause){error.value=cause instanceof Error?cause.message:'发布失败'}
  finally{loading.value=false}
}
defineExpose({open})
</script>
