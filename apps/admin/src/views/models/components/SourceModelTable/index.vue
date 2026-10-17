<template>
  <div class="source-model-table">
    <QyqTable
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :data="pageRows"
      :columns="columns"
      :total="models.length"
      row-key="id"
      :max-height="440"
    >
      <template #name-cell="{ row }"
        ><strong>{{ row.name }}</strong
        ><small class="model-id">{{ row.upstream_model }}</small></template
      >
      <template #status-cell="{ row }"
        ><el-tag
          :type="
            row.catalog_available === false
              ? 'danger'
              : row.active && sourceActive
                ? 'success'
                : 'info'
          "
          >{{
            row.catalog_available === false
              ? '上游已下架'
              : !sourceActive
                ? '来源已关闭'
                : row.active
                  ? '已启用'
                  : '未启用'
          }}</el-tag
        ><el-tag v-if="row.is_default" class="default-tag">默认</el-tag></template
      >
      <template #verification-cell="{ row }">{{ verification(row) }}</template>
      <template #actions-cell="{ row }"
        ><div class="row-actions">
          <el-button link type="primary" @click="emit('edit', row)">编辑</el-button
          ><el-button link type="primary" :loading="busy === row.id" @click="emit('check', row)"
            >验证</el-button
          ><el-button link type="primary" @click="emit('toggle', row)">{{
            row.active ? '停用' : '启用'
          }}</el-button>
        </div></template
      >
      <template #empty
        ><el-empty
          description="暂无符合当前筛选的模型，可同步模型、添加模型或显示全部"
          :image-size="64"
      /></template>
    </QyqTable>
  </div>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import QyqTable from '@/components/qyq-table/index.vue'
  import type { Model } from '@/types/models'
  import { verificationLabel as verification } from '../../model-status'
  const props = defineProps<{
    models: Model[]
    sourceActive: boolean
    canWrite: boolean
    busy: string
  }>()
  const emit = defineEmits<{
    edit: [model: Model]
    check: [model: Model]
    toggle: [model: Model]
  }>()
  const page = ref(1),
    pageSize = ref(10)
  const columns = computed(() => [
    { prop: 'name', label: '模型', minWidth: 220 },
    { prop: 'status', label: '状态', width: 160 },
    { prop: 'verification', label: '能力验证', minWidth: 150 },
    ...(props.canWrite
      ? [{ prop: 'actions', label: '操作', width: 190, fixed: 'right' as const }]
      : []),
  ])
  const pageRows = computed(() =>
    props.models.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
  )
  watch(pageSize, () => {
    page.value = 1
  })
  watch(
    () => props.models.length,
    () => {
      page.value = Math.min(
        page.value,
        Math.max(1, Math.ceil(props.models.length / pageSize.value))
      )
    }
  )
</script>
<style scoped lang="scss">
  .source-model-table {
    min-width: 0;
    .model-id {
      display: block;
      font-size: 11px;
      color: #909399;
      margin-top: 6px;
      overflow-wrap: anywhere;
    }
    .default-tag {
      margin-left: 6px;
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      .el-button + .el-button {
        margin-left: 0;
      }
    }
    :deep(.pagination-wrapper) {
      flex-wrap: wrap;
      min-width: 0;
      padding-bottom: 0;
    }
  }
</style>
