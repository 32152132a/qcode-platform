<template>
  <PagePanel
    title="团队知识库"
    description="上传 UTF-8 TXT 或 Markdown，每篇最多 64 KB；通过共享 Skill 同步，无需向量数据库。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('knowledge:write')" type="primary" @click="picker?.click()"
        >上传文档</el-button
      ><input ref="picker" type="file" accept=".md,.txt" hidden @change="upload" /></template
    ><el-input v-model="query" placeholder="搜索知识库内容" clearable @keyup.enter="search"
      ><template #append><el-button @click="search">检索</el-button></template></el-input
    ><el-alert v-if="searchError" :title="searchError" type="error" :closable="false" /><el-card
      v-for="result in results"
      :key="String(result.documentId)"
      shadow="never"
      ><h3>{{ result.title }}</h3>
      <p>{{ result.excerpt }}</p></el-card
    ><DataTable :rows="data?.documents || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { ElMessage } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { date, yesNo, confirmAction } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<{ documents: Row[] }>(() => '/admin/knowledge'),
    editor = ref<InstanceType<typeof EntityDialog>>(),
    picker = ref<HTMLInputElement>(),
    query = ref(''),
    results = ref<Row[]>([]),
    searchError = ref('')
  const columns: Column[] = [
    { prop: 'title', label: '标题' },
    { prop: 'filename', label: '文件' },
    { prop: 'bytes', label: '大小（字节）' },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '已启用' : '已停用') },
    { prop: 'updated_at', label: '更新时间', minWidth: 180, render: (r) => date(r.updated_at) },
  ]
  const actions = computed<RowAction[]>(() =>
    auth.can('knowledge:write')
      ? [
          { label: '编辑', run: async (r) => edit(await request<Row>('/admin/knowledge/' + r.id)) },
          {
            label: '删除',
            danger: true,
            run: (r) =>
              confirmAction(
                '删除此资料？客户端下次同步时移除托管文件。',
                () => request('/admin/knowledge/' + r.id, 'DELETE'),
                load
              ),
          },
        ]
      : []
  )
  function edit(row: Row, isNew = false) {
    editor.value?.open(
      {
        title: isNew ? '上传知识文档' : '编辑知识文档',
        fields: [
          { prop: 'title', label: '标题', required: true },
          { prop: 'filename', label: '文件名', required: true },
          { prop: 'summary', label: '简介' },
          { prop: 'active', label: '启用', type: 'select', options: yesNo },
          {
            prop: 'content',
            label: '内容',
            type: 'textarea',
            required: true,
            props: { autosize: { minRows: 12, maxRows: 24 } },
          },
        ],
        value: { ...row, active: String(row.active ?? true) },
        save: (v) =>
          request('/admin/knowledge' + (isNew ? '' : '/' + row.id), isNew ? 'POST' : 'PUT', {
            title: v.title,
            filename: v.filename,
            summary: v.summary,
            content: v.content,
            active: v.active === 'true',
          }),
      },
      () => {
        results.value = []
        void load()
      }
    )
  }
  async function upload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > 65536) {
      ElMessage.error('单篇文档最多 64 KB')
      return
    }
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      edit(
        {
          title: file.name.replace(/\.[^.]+$/, ''),
          filename: file.name,
          content,
          summary: '',
          active: true,
        },
        true
      )
    } catch {
      ElMessage.error('请上传 UTF-8 编码的纯文本文档')
    }
  }
  async function search() {
    searchError.value = ''
    if (!query.value.trim()) {
      results.value = []
      return
    }
    try {
      results.value = (
        await request<{ results: Row[] }>(
          '/admin/knowledge/search?q=' + encodeURIComponent(query.value)
        )
      ).results
    } catch (cause) {
      searchError.value = cause instanceof Error ? cause.message : '检索失败'
    }
  }
</script>
