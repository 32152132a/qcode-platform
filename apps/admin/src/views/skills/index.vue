<template>
  <PagePanel
    title="共享 Skill"
    description="由后台统一发布，客户端自动同步；停用后移除托管副本。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('skills:write')" type="primary" @click="edit()"
        >发布 Skill</el-button
      ></template
    ><DataTable :rows="data || []" :columns="columns" :actions="actions" /><EntityDialog
      ref="editor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import PagePanel from '@/components/PagePanel/index.vue'
  import DataTable, { type RowAction } from '@/components/DataTable/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { useResource } from '@/hooks/useResource'
  import { useAuthStore } from '@/stores/auth'
  import { request } from '@/api/request'
  import { date, yesNo, confirmAction } from '@/utils/forms'
  import type { Row, Column } from '@/types'
  const auth = useAuthStore(),
    { data, loading, error, load } = useResource<Row[]>(() => '/admin/skills'),
    editor = ref<InstanceType<typeof EntityDialog>>()
  const columns: Column[] = [
    { prop: 'name', label: 'Skill' },
    { prop: 'description', label: '用途', minWidth: 220 },
    { prop: 'active', label: '状态', render: (r) => (r.active ? '已发布' : '已停用') },
    { prop: 'updated_at', label: '更新时间', minWidth: 175, render: (r) => date(r.updated_at) },
  ]
  const actions = computed<RowAction[]>(() =>
    auth.can('skills:write')
      ? [
          { label: '编辑', run: edit },
          {
            label: '删除',
            danger: true,
            run: (r) =>
              confirmAction(
                '删除此 Skill？客户端下次同步时移除托管副本。',
                () => request('/admin/skills/' + r.id, 'DELETE'),
                load
              ),
          },
        ]
      : []
  )
  async function edit(row?: Row) {
    const departments = await request<Row[]>('/admin/departments')
    editor.value?.open(
      {
        title: row ? '编辑 Skill' : '发布 Skill',
        fields: [
          { prop: 'name', label: '名称（小写字母、数字、短横线）', required: true },
          { prop: 'description', label: '用途描述', required: true },
          {
            prop: 'content',
            label: 'Skill 内容',
            type: 'textarea',
            required: true,
            props: { autosize: { minRows: 8, maxRows: 18 } },
          },
          { prop: 'active', label: '启用', type: 'select', options: yesNo },
          {
            prop: 'departmentIds',
            label: '适用部门（不选即全员）',
            type: 'select',
            multiple: true,
            props: { multiple: true },
            options: departments.map((d) => ({ label: String(d.name), value: String(d.id) })),
          },
          { prop: 'files', label: '附加文件 JSON（可选）', type: 'textarea' },
        ],
        value: {
          name: row?.name || '',
          description: row?.description || '',
          content: row?.content || '',
          active: String(row?.active ?? true),
          departmentIds: row?.department_ids || [],
          files: JSON.stringify(
            Object.fromEntries(
              Object.entries((row?.files || {}) as Row).filter(([name]) => name !== 'SKILL.md')
            ),
            null,
            2
          ),
        },
        save: (v) =>
          request('/admin/skills' + (row ? '/' + row.id : ''), row ? 'PUT' : 'POST', {
            name: v.name,
            description: v.description,
            content: v.content,
            active: v.active === 'true',
            departmentIds: v.departmentIds,
            files: JSON.parse(String(v.files || '{}')),
          }),
      },
      load
    )
  }
</script>
