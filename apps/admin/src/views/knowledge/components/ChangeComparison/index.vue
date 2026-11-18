<template>
  <section class="change-comparison">
    <div v-for="field in fields" :key="field.label" class="change-comparison__field">
      <h4>{{ field.label }}</h4>
      <div v-if="field.rows" class="change-comparison__diff">
        <div class="change-comparison__diff-heading"><span>{{ beforeLabel }}</span><span>{{ afterLabel }}</span></div>
        <div v-for="(row,index) in field.rows" :key="index" class="change-comparison__diff-row">
          <div class="change-comparison__line" :class="{'is-removed':row.before?.changed,'is-empty':!row.before}"><span>{{ row.before?.number }}</span><span>{{ row.before?.changed?'-':'' }}</span><code>{{ row.before?.text || ' ' }}</code></div>
          <div class="change-comparison__line" :class="{'is-added':row.after?.changed,'is-empty':!row.after}"><span>{{ row.after?.number }}</span><span>{{ row.after?.changed?'+':'' }}</span><code>{{ row.after?.text || ' ' }}</code></div>
        </div>
        <p v-if="!field.rows.length" class="change-comparison__unchanged">无正文内容</p>
      </div>
      <div v-else class="change-comparison__columns">
        <div class="change-comparison__before"><span>{{ beforeLabel }}</span><pre>{{ field.before || '无' }}</pre></div>
        <div class="change-comparison__after"><span>{{ afterLabel }}</span><pre>{{ field.after || '无' }}</pre></div>
      </div>
    </div>
    <p v-if="!fields.length" class="change-comparison__unchanged">正文未变更，仅调整目录概述或来源关联。</p>
  </section>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {diffLines} from './diff'
import type {KnowledgeNode} from '../../types'
const props=defineProps<{before?:KnowledgeNode;change:KnowledgeNode & {operation:string};beforePath:string;afterPath:string;beforeLabel:string;afterLabel:string}>()
const fields=computed(()=>{
  const before=props.before,change=props.change,deleted=change.operation==='delete'
  if(deleted||!before){
    const content=(node:KnowledgeNode|undefined)=>node?(node.kind==='folder'?node.summary:node.text):''
    return [{label:change.kind==='folder'?'目录概述':'全文',before:content(before),after:deleted?'':content(change),rows:diffLines(content(before),deleted?'':content(change))}]
  }
  const items=[
    {label:'节点类型',before:before.kind==='folder'?'目录':'文章',after:change.kind==='folder'?'目录':'文章'},
    {label:'文章标题',before:before.title,after:change.title},
    {label:'所在目录',before:props.beforePath,after:props.afterPath},
    {label:'内容摘要',before:before.summary,after:change.summary},
    {label:'正文',before:before.text,after:change.text},
  ]
  return items.filter(item=>item.before!==item.after||item.label==='正文'&&Boolean(item.before||item.after)).map(item=>({...item,rows:item.label==='正文'?diffLines(item.before,item.after):null}))
})
</script>
<style scoped lang="scss">
.change-comparison{
  &__field{margin:18px 0;h4{font-size:12px;margin:0 0 8px;font-weight:500;color:var(--el-text-color-secondary)}}
  &__diff{border:1px solid var(--el-border-color-lighter);border-radius:6px;overflow:hidden}
  &__diff-heading,&__diff-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  &__diff-heading{background:var(--el-fill-color-lighter);font-size:11px;color:var(--el-text-color-secondary);span{padding:10px 12px}}
  &__line{display:grid;grid-template-columns:30px 14px minmax(0,1fr);align-items:start;min-width:0;line-height:1.9;font-size:12px;padding:2px 8px 2px 0;>span{text-align:center;color:var(--el-text-color-placeholder);user-select:none}code{font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere} &:first-child{border-right:1px solid var(--el-border-color-lighter)}&.is-removed{background:var(--el-color-danger-light-9)}&.is-added{background:var(--el-color-success-light-9)}&.is-empty{background:var(--el-fill-color-lighter)}}
  &__columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  &__before,&__after{min-width:0;padding:12px 14px;border-radius:6px;border:1px solid var(--el-border-color-lighter);>span{font-size:11px;color:var(--el-text-color-secondary)}pre{font:inherit;font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0 0;max-height:240px;overflow:auto}}
  &__before{background:var(--el-color-danger-light-9)}&__after{background:var(--el-color-success-light-9)}
  &__unchanged{font-size:12px;color:var(--el-text-color-secondary)}
  @media(max-width:650px){&__columns{grid-template-columns:1fr}}
}
</style>
