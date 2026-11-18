<template>
  <article class="knowledge-article">
    <template v-for="(block,index) in blocks" :key="index">
      <component v-if="block.kind==='heading'" :is="'h'+block.level">{{ block.text }}</component>
      <pre v-else-if="block.kind==='code'"><code>{{ block.text }}</code></pre>
      <blockquote v-else-if="block.kind==='quote'">{{ block.text }}</blockquote>
      <component v-else-if="block.kind==='list'" :is="block.ordered?'ol':'ul'"><li v-for="(item,line) in block.items" :key="line">{{ item }}</li></component>
      <div v-else-if="block.kind==='table'" class="knowledge-article__table">
        <table><thead><tr><th v-for="(cell,column) in block.columns" :key="column">{{ cell }}</th></tr></thead><tbody><tr v-for="(row,line) in block.rows" :key="line"><td v-for="(cell,column) in row" :key="column">{{ cell }}</td></tr></tbody></table>
      </div>
      <p v-else>{{ block.text }}</p>
    </template>
  </article>
</template>
<script setup lang="ts">
import {computed} from 'vue'
const props=defineProps<{content:string;title:string}>()
type Block={kind:'heading';level:number;text:string}|{kind:'paragraph'|'code'|'quote';text:string}|{kind:'list';ordered:boolean;items:string[]}|{kind:'table';columns:string[];rows:string[][]}
const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split('|').map(value=>value.trim())
const blocks=computed<Block[]>(()=>{
  const lines=props.content.replace(/\r\n?/g,'\n').split('\n'),result:Block[]=[]
  if(lines[0]?.replace(/^#{1,6}\s+/,'').trim()===props.title)lines.shift()
  for(let i=0;i<lines.length;){
    const line=lines[i]!
    if(!line.trim()){i++;continue}
    const fence=line.match(/^(\x60{3,}|~{3,})/)
    if(fence){const text:string[]=[];i++;while(i<lines.length&&!lines[i]!.startsWith(fence[1]!))text.push(lines[i++]!);result.push({kind:'code',text:text.join('\n')});i++;continue}
    const heading=line.match(/^(#{1,6})\s+(.+)/)
    if(heading){result.push({kind:'heading',level:Math.min(heading[1]!.length+1,6),text:heading[2]!});i++;continue}
    if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'')){
      const columns=cells(line),rows:string[][]=[];i+=2
      while(i<lines.length&&lines[i]!.includes('|'))rows.push(cells(lines[i++]!))
      result.push({kind:'table',columns,rows});continue
    }
    if(/^\s*(?:[-*+]|\d+\.)\s+/.test(line)){
      const items:string[]=[],ordered=/^\s*\d+\./.test(line)
      while(i<lines.length&&/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]!))items.push(lines[i++]!.replace(/^\s*(?:[-*+]|\d+\.)\s+/,''))
      result.push({kind:'list',ordered,items});continue
    }
    if(/^>\s?/.test(line)){result.push({kind:'quote',text:line.replace(/^>\s?/,'')});i++;continue}
    const text=[line];i++
    while(i<lines.length&&lines[i]!.trim()&&!/^(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|\x60{3}|~{3})/.test(lines[i]!)){
      if(lines[i]!.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]||''))break
      text.push(lines[i++]!)
    }
    result.push({kind:'paragraph',text:text.join('\n')})
  }
  return result
})
</script>
<style scoped lang="scss">
.knowledge-article{
  line-height:1.95;overflow-wrap:anywhere;font-size:14px;color:var(--el-text-color-regular);
  h2,h3,h4,h5,h6{margin:26px 0 12px;font-size:16px;color:var(--el-text-color-primary);font-weight:600}h2{font-size:18px}p{white-space:pre-wrap;margin:0 0 18px}
  ul,ol{padding-left:24px;margin:0 0 16px}blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid var(--el-border-color);color:var(--el-text-color-secondary)}
  pre{padding:16px;background:var(--el-fill-color-light);border-radius:6px;overflow:auto;white-space:pre-wrap;code{font-family:monospace}}
  &__table{overflow:auto;margin:12px 0 20px;table{border-collapse:collapse;min-width:70%}th,td{padding:10px 16px;border:1px solid var(--el-border-color-lighter);text-align:left}th{background:var(--el-fill-color-light)}}
}
</style>
