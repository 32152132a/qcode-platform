<template>
  <el-dialog v-model="visible" class="upload-issues-dialog" title="资料上传问题" width="740px" style="--admin-dialog-max-width: 740px; --admin-radius: 12px; --el-dialog-padding-primary: min(24px, 5vw)" align-center @closed="clear">
    <template #header="{titleId}"><h2 :id="titleId" class="upload-issues-dialog__title">资料上传问题</h2></template>
    <el-scrollbar max-height="min(62vh, 520px)">
      <ul class="upload-issues">
        <li v-for="(issue,index) in issues" :key="index">
          <header class="upload-issues__file"><strong>{{ issue.filename }}</strong><span>{{ issue.stage }}</span></header>
          <div class="upload-issues__cause">
            <el-icon aria-hidden="true"><WarningFilled /></el-icon>
            <div><strong v-if="issue.location">{{ issue.location }}</strong><p>{{ issue.reason }}</p></div>
          </div>
          <section v-if="issue.excerpt" class="upload-issues__excerpt">
            <header><strong>原文片段</strong><span>第 {{ issue.excerpt[0].line }}–{{ issue.excerpt[issue.excerpt.length-1].line }} 行</span></header>
            <div v-for="line in issue.excerpt" :key="line.line" class="upload-issues__line" :class="{'is-invalid':line.afterMarker!==undefined}">
              <span>{{ line.line }}</span>
              <code>{{ line.text }}<template v-if="line.afterMarker!==undefined"><mark>空字符</mark>{{ line.afterMarker }}</template></code>
            </div>
          </section>
          <div v-if="issue.retry||issue.remove">
            <el-button v-if="issue.retry" link type="primary" @click="act(issue.retry)">重试</el-button>
            <el-button v-if="issue.remove" link type="danger" @click="act(issue.remove)">移除</el-button>
          </div>
        </li>
      </ul>
    </el-scrollbar>
    <template #footer>
      <el-button type="primary" @click="visible=false">知道了</el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import {WarningFilled} from '@element-plus/icons-vue'
import type {KnowledgeUploadIssue} from '../../types'

const visible=ref(false),issues=ref<KnowledgeUploadIssue[]>([])
function open(items:KnowledgeUploadIssue[]){
  issues.value=visible.value?[...issues.value,...items]:items
  visible.value=true
}
function act(action:()=>void){visible.value=false;action()}
function clear(){if(!visible.value)issues.value=[]}
defineExpose({open})
</script>
<style scoped lang="scss">
.upload-issues-dialog__title{margin:0;font-size:19px;font-weight:600}
.upload-issues{
  list-style:none;margin:0;padding:0;
  li{display:grid;gap:14px;overflow-wrap:anywhere}
  li+li{margin-top:18px;padding-top:16px;border-top:1px solid var(--el-border-color-lighter)}
  &__file{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;
    span{font-size:12px;color:var(--el-text-color-secondary)}
  }
  &__cause{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;padding:13px 15px;border:1px solid var(--el-color-danger-light-7);border-radius:8px;background:var(--el-color-danger-light-9);
    .el-icon,strong{color:var(--el-color-danger)}
    .el-icon{margin-top:2px;font-size:16px}
    p{margin:0;color:var(--el-text-color-regular);line-height:1.5}
    strong+p{margin-top:4px}
  }
  &__excerpt{border:1px solid var(--el-border-color-lighter);border-radius:8px;overflow:hidden;
    header{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;background:var(--el-fill-color-lighter);
      span{font-size:12px;color:var(--el-text-color-secondary)}
    }
  }
  &__line{display:grid;grid-template-columns:40px minmax(0,1fr);padding:8px 0;font-size:13px;line-height:1.65;
    >span{text-align:center;color:var(--el-text-color-secondary);border-right:1px solid var(--el-border-color-lighter)}
    code{padding-inline:12px;color:var(--el-text-color-primary);white-space:pre-wrap}
    &.is-invalid{background:var(--el-color-danger-light-9)}
    mark{margin-inline:4px;padding:2px 5px;border-radius:4px;background:var(--el-color-danger-light-8);color:var(--el-color-danger);font-size:11px;font-weight:600}
  }
}
</style>
