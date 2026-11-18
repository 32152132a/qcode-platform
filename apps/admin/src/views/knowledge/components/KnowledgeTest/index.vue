<template>
  <section class="knowledge-test">
    <header class="knowledge-test__toolbar">
      <div><strong>检索效果测试</strong><p>使用已发布知识库，模拟用户查询。</p></div>
      <el-radio-group v-model="mode" :disabled="running" size="small"><el-radio-button value="questions">批量问答</el-radio-button><el-radio-button value="keyword">关键词搜索</el-radio-button></el-radio-group>
    </header>
    <template v-if="mode==='questions'">
      <div class="knowledge-test__columns">
        <aside class="knowledge-test__input">
          <div class="knowledge-test__heading"><span class="knowledge-test__symbol"><el-icon><ChatDotRound /></el-icon></span><div><strong>批量提问</strong><p>粘贴问题，每行一个</p></div></div>
          <el-input v-model="questions" type="textarea" :rows="10" :disabled="running" placeholder="输入你关心的问题，检查是否能找到正确依据" aria-label="测试问题" />
          <div class="knowledge-test__actions"><span class="knowledge-test__muted">{{ questionLines.length }} 个问题</span><div><el-button v-if="running" @click="stop">停止</el-button><el-button type="primary" :icon="Position" :disabled="!questionLines.length" :loading="running" @click="start">开始测试</el-button></div></div>
          <div v-if="rows.length" class="knowledge-test__progress"><span>已完成 {{ completed }} / {{ rows.length }}</span><el-progress :percentage="Math.floor(completed/rows.length*100)" :stroke-width="4" :show-text="false" /></div>
        </aside>
        <section class="knowledge-test__results">
          <div class="knowledge-test__results-heading"><strong>测试结果<span v-if="rows.length">{{ rows.length }}</span></strong><el-button text :disabled="running||!rows.length" @click="rows=[]">清空</el-button></div>
          <el-scrollbar class="knowledge-test__scroll">
            <el-empty v-if="!rows.length" description="回答与引用依据会显示在这里" :image-size="72" />
            <el-collapse v-model="expanded" class="knowledge-test__list">
              <el-collapse-item v-for="(row,index) in rows" :key="index" :name="String(index)">
                <template #title><div class="knowledge-test__result-title">
                  <span class="knowledge-test__number">{{ String(index+1).padStart(2,'0') }}</span><span class="knowledge-test__question">{{ row.question }}</span>
                  <span v-if="row.status==='running'" class="knowledge-test__status"><el-icon class="is-loading"><Loading /></el-icon>查询中</span>
                  <span v-else-if="row.status==='done'" class="knowledge-test__status" :class="row.result?.supported?'is-supported':'is-insufficient'"><el-icon><CircleCheck v-if="row.result?.supported"/><Warning v-else/></el-icon>{{ row.result?.supported?'有依据':'依据不足' }}</span>
                  <span v-else-if="row.status==='error'" class="knowledge-test__status is-error"><el-icon><CircleClose /></el-icon>失败</span>
                  <span v-else class="knowledge-test__status">待测试</span>
                </div></template>
                <div class="knowledge-test__result-body">
                  <el-alert v-if="row.error" :title="row.error" type="error" :closable="false" />
                  <template v-if="row.result">
                    <p class="knowledge-test__answer">{{ row.result.answer }}</p>
                    <div v-if="row.result.citations.length" class="knowledge-test__sources"><span>引用依据</span><details v-for="(source,citation) in row.result.citations" :key="citation"><summary><el-icon><Document /></el-icon>{{ source.title }}<small>{{ source.source?.filename }}</small></summary><blockquote>{{ source.quote }}</blockquote></details></div>
                    <el-collapse class="knowledge-test__trace"><el-collapse-item title="调用详情与检索路径" name="trace"><p class="knowledge-test__muted">{{ (row.result.durationMs/1000).toFixed(1) }} 秒 · {{ row.result.calls }} 次调用 · {{ row.result.totalTokens===null?'用量未知':row.result.totalTokens.toLocaleString()+' Token' }}</p><p v-for="(item,step) in row.result.trace" :key="step">{{ step+1 }}. {{ item.action==='read'?'读取正文':'查看目录' }} {{ item.nodes?.map(node=>node.title||node.id).join('、') || item.parentId || '' }}{{ item.error?'：'+item.error:'' }}</p></el-collapse-item></el-collapse>
                  </template>
                  <el-button v-if="row.status!=='running'" link :disabled="running" @click="run([row])">重新测试</el-button>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-scrollbar>
        </section>
      </div>
    </template>
    <template v-else>
      <div class="knowledge-test__search"><el-input v-model="keyword" :prefix-icon="Search" placeholder="输入标题或正文关键词" clearable @keyup.enter="search" /><el-button type="primary" :loading="searching" :disabled="!keyword.trim()" @click="search">搜索</el-button></div>
      <el-alert v-if="searchError" :title="searchError" type="error" :closable="false" />
      <el-scrollbar class="knowledge-test__scroll"><el-empty v-if="!searched" description="搜索已发布的标题、摘要和正文" :image-size="72" /><el-empty v-else-if="!hits.length" description="已发布知识库中没有找到相关内容" :image-size="72" /><article v-for="hit in hits" :key="hit.id" class="knowledge-test__hit"><strong>{{ hit.title }}</strong><p>{{ hit.excerpt }}</p></article></el-scrollbar>
    </template>
  </section>
</template>
<script setup lang="ts">
import {computed,onScopeDispose,ref} from 'vue'
import {Loading,CircleCheck,CircleClose,Warning,ChatDotRound,Search,Position,Document} from '@element-plus/icons-vue'
import {request} from '@/api/request'
import {knowledgeOperation} from '../../operations'
import type {KnowledgeAnswer} from '../../types'
type Row={question:string;status:'waiting'|'running'|'done'|'error';result?:KnowledgeAnswer;error?:string}
const mode=ref('questions'),questions=ref(''),rows=ref<Row[]>([]),expanded=ref<string[]>([]),running=ref(false)
const keyword=ref(''),searching=ref(false),searchError=ref(''),searched=ref(false),hits=ref<{id:string;title:string;excerpt:string}[]>([])
const questionLines=computed(()=>questions.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean))
const completed=computed(()=>rows.value.filter(row=>['done','error'].includes(row.status)).length)
let controller:AbortController|undefined,batchRevision:string|undefined
function start(){
  if(running.value)return
  rows.value=questionLines.value.map(question=>({question,status:'waiting'}));expanded.value=[];batchRevision=undefined;void run(rows.value)
}
async function run(items:Row[]){
  if(running.value)return
  running.value=true;controller=new AbortController();const current=controller
  try{
    for(const row of items){
      if(current.signal.aborted)break
      row.status='running';row.error=undefined;row.result=undefined
      try{
        row.result=await knowledgeOperation<KnowledgeAnswer>('/admin/knowledge/test',{question:row.question,revision:batchRevision},current.signal)
        batchRevision=row.result.revision;row.status='done'
        if(expanded.value.length===0)expanded.value=[String(rows.value.indexOf(row))]
      }catch(cause){
        row.status=current.signal.aborted?'waiting':'error';row.error=current.signal.aborted?undefined:cause instanceof Error?cause.message:'测试失败'
      }
    }
  }finally{running.value=false}
}
function stop(){controller?.abort()}
async function search(){
  if(!keyword.value.trim()||searching.value)return
  searching.value=true;searchError.value='';searched.value=true
  try{hits.value=(await request<{items:typeof hits.value}>('/admin/knowledge/search','POST',{query:keyword.value})).items}
  catch(cause){searchError.value=cause instanceof Error?cause.message:'搜索失败'}
  finally{searching.value=false}
}
onScopeDispose(stop)
</script>
<style scoped lang="scss">
.knowledge-test{
  display:flex;flex-direction:column;gap:24px;flex:1;min-height:0;
  &__toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:8px 0 0;strong{font-size:16px;font-weight:600}p{font-size:12px;color:var(--el-text-color-secondary);margin:7px 0 0}}
  &__columns{display:grid;grid-template-columns:minmax(290px,34%) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:24px;flex:1;min-height:0;overflow:hidden}
  &__input,&__results{display:flex;flex-direction:column;gap:20px;min-height:0;min-width:0;border:1px solid var(--el-border-color-lighter);border-radius:10px;padding:22px}
  &__input{overflow:auto;background:var(--el-fill-color-lighter);>.el-textarea{flex:1;min-height:100px;display:grid}:deep(.el-textarea__inner){height:100%;resize:none;font-size:13px;line-height:1.9;padding:12px 14px;box-shadow:0 0 0 1px var(--el-border-color-lighter) inset;border-radius:7px}}
  &__heading{display:flex;align-items:center;gap:12px;strong{font-weight:600}p{font-size:12px;color:var(--el-text-color-secondary);margin:6px 0 0}}
  &__symbol{display:grid;place-items:center;width:36px;height:36px;background:var(--el-bg-color);color:var(--el-color-primary);border:1px solid var(--el-border-color-lighter);border-radius:9px;font-size:18px}
  &__results{padding:0 22px 18px;gap:0}
  &__results-heading{display:flex;align-items:center;justify-content:space-between;min-height:68px;border-bottom:1px solid var(--el-border-color-lighter);strong{display:flex;align-items:center;gap:10px;font-weight:600;span{font-size:11px;font-weight:400;padding:2px 7px;border-radius:4px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary)}}.el-button{font-size:12px}}
  &__actions{display:flex;align-items:center;justify-content:space-between;gap:12px;:deep(.el-button){border-radius:6px;font-size:12px}}
  &__progress{display:grid;gap:10px;font-size:12px;color:var(--el-text-color-secondary);padding-top:16px;border-top:1px solid var(--el-border-color-lighter)}
  &__scroll{flex:1;min-height:0}
  &__list{border:0;:deep(.el-collapse-item__header){height:auto;min-height:66px}:deep(.el-collapse-item__content){padding-bottom:18px}}
  &__result-title{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:14px 10px 14px 0}
  &__number{flex-shrink:0;font-size:11px;font-variant-numeric:tabular-nums;color:var(--el-text-color-placeholder)}
  &__question{flex:1;text-align:left;line-height:1.7;overflow-wrap:anywhere;font-weight:500}
  &__status{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;font-size:11px;line-height:1.8;color:var(--el-text-color-secondary);&.is-supported{color:var(--el-color-success)}&.is-insufficient{color:var(--el-color-warning)}&.is-error{color:var(--el-color-danger)}}
  &__result-body{padding-left:24px}
  &__answer{white-space:pre-wrap;line-height:1.95;font-size:14px;margin:0 0 20px}
  &__sources{display:grid;gap:7px;margin-bottom:18px;>span{font-size:11px;color:var(--el-text-color-secondary)}details{padding:10px 12px;border:1px solid var(--el-border-color-lighter);border-radius:6px;background:var(--el-fill-color-lighter)}summary{cursor:pointer;line-height:1.8;font-size:12px;.el-icon{margin-right:6px;vertical-align:middle}small{margin-left:8px;color:var(--el-text-color-secondary)}}blockquote{margin:12px 0 0;padding-left:12px;border-left:2px solid var(--el-border-color);color:var(--el-text-color-regular);white-space:pre-wrap;line-height:1.8}}
  &__trace{margin:10px 0;border-top:1px solid var(--el-border-color-lighter);:deep(.el-collapse-item__header){min-height:42px;font-size:12px;color:var(--el-text-color-secondary);font-weight:400}p{margin:6px 0;line-height:1.8;font-size:12px;overflow-wrap:anywhere}}
  &__muted{font-size:12px;color:var(--el-text-color-secondary)}
  &__search{display:grid;grid-template-columns:minmax(0,420px) auto;gap:12px;align-self:start}
  &__hit{padding:20px 0;border-bottom:1px solid var(--el-border-color-lighter);p{line-height:1.8;margin-bottom:0;white-space:pre-wrap}}
  @media(max-width:850px){&__toolbar{align-items:flex-start;flex-wrap:wrap}&__columns{grid-template-columns:1fr;overflow:auto;grid-template-rows:auto minmax(320px,1fr)}&__results{min-height:320px}&__input,&__results{padding:18px}&__result-body{padding-left:0}}
}
</style>
