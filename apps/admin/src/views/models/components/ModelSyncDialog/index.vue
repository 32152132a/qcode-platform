<template>
  <el-dialog
    v-model="visible"
    :title="'同步模型 · ' + (source?.name || '')"
    width="740px"
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="!loading && !saving"
    :show-close="!loading && !saving"
  >
    <section class="model-sync">
      <p class="description">
        从上游列表中选择模型后批量导入。新模型默认关闭，已有模型的名称、参数和启用状态保持不变。
      </p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <QyqForm
        @submit.prevent
        v-model="search"
        :columns="1"
        :show-btn="false"
        :form-options="searchFields"
        :disabled="loading || saving"
      />
      <div class="selection-toolbar">
        <span role="status">共 {{ filtered.length }} 个候选，已选 {{ selectedIds.length }} 个</span>
        <div>
          <el-button
            text
            :disabled="loading || saving || !pageSelectable.length"
            @click="selectPage"
            >选择本页</el-button
          >
          <el-button text :disabled="saving || !selectedIds.length" @click="selectedIds = []"
            >清空选择</el-button
          >
        </div>
      </div>
      <div v-loading="loading" class="catalog">
        <el-checkbox-group
          v-model="selectedIds"
          class="cards"
          :disabled="saving"
          aria-label="候选模型"
        >
          <el-card
            v-for="model in pageModels"
            :key="model.id"
            shadow="never"
            :class="{ selected: selectedIds.includes(model.id) }"
          >
            <el-checkbox
              :value="model.id"
              :disabled="existingIds.has(model.id) || !!model.unavailable_reason"
              :aria-label="model.id"
            >
              <span class="model-name" :title="model.id">{{ model.id }}</span>
            </el-checkbox>
            <span class="model-state">{{
              existingIds.has(model.id)
                ? '已导入 · 保留原配置'
                : model.unavailable_reason || '可导入 · 默认未启用'
            }}</span>
          </el-card>
        </el-checkbox-group>
        <el-empty
          v-if="!loading && !pageModels.length"
          :description="search.query ? '没有匹配的模型' : '暂无候选模型'"
          :image-size="60"
        />
      </div>
      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="filtered.length"
          :pager-count="5"
          layout="prev, pager, next"
          size="small"
          :disabled="loading || saving"
          aria-label="候选模型分页"
        />
      </div>
    </section>
    <template #footer>
      <el-button :disabled="loading || saving" @click="visible = false">取消</el-button>
      <el-button v-if="error && !catalogRevision" :loading="loading" @click="readCatalog"
        >重新读取</el-button
      >
      <el-button
        type="primary"
        :loading="saving"
        :disabled="loading || !selectedIds.length || !catalogRevision"
        @click="submit"
        >导入所选模型（{{ selectedIds.length }}）</el-button
      >
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { ElMessage } from 'element-plus'
  import QyqForm from '@/components/qyq-form/index.vue'
  import { request } from '@/api/request'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Row } from '@/types'
  import type { Model, ModelSource } from '@/types/models'

  const visible = ref(false),
    loading = ref(false),
    saving = ref(false),
    error = ref('')
  const source = ref<ModelSource>(),
    catalog = ref<NonNullable<ModelSource['catalog']>>([])
  const catalogRevision = ref(''),
    selectedIds = ref<string[]>([]),
    existingIds = ref(new Set<string>())
  const search = ref<Row>({ query: '' }),
    page = ref(1)
  const pageSize = 12
  const searchFields: FormItemProp[] = [
    {
      prop: 'query',
      label: '搜索模型',
      type: 'input',
      placeholder: '输入模型名称或版本',
      isNotTrim: true,
      allowSpecialChars: true,
    },
  ]
  const filtered = computed(() =>
    catalog.value.filter((model) =>
      model.id.toLowerCase().includes(
        String(search.value.query || '')
          .trim()
          .toLowerCase()
      )
    )
  )
  const pageModels = computed(() =>
    filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize)
  )
  const pageSelectable = computed(() =>
    pageModels.value.filter(
      (model) => !existingIds.value.has(model.id) && !model.unavailable_reason
    )
  )
  let success: (() => void) | undefined

  function open(item: ModelSource, models: Model[], onSuccess?: () => void) {
    source.value = item
    existingIds.value = new Set(
      models.filter((model) => model.source_id === item.id).map((model) => model.upstream_model)
    )
    selectedIds.value = []
    catalog.value = []
    catalogRevision.value = ''
    search.value = { query: '' }
    page.value = 1
    success = onSuccess
    visible.value = true
    void readCatalog()
  }
  async function readCatalog() {
    if (!source.value || loading.value) return
    loading.value = true
    error.value = ''
    try {
      const result = await request<{ source: ModelSource }>(
        '/admin/models/sources/' + source.value.id + '/sync',
        'POST',
        {}
      )
      catalog.value = result.source.catalog || []
      catalogRevision.value = result.source.catalog_revision || ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '读取模型列表失败'
    } finally {
      loading.value = false
    }
  }
  function selectPage() {
    selectedIds.value = [
      ...new Set([...selectedIds.value, ...pageSelectable.value.map((model) => model.id)]),
    ]
  }
  async function submit() {
    if (!source.value || saving.value || loading.value || !selectedIds.value.length) return
    saving.value = true
    error.value = ''
    try {
      const result = await request<{ added: number; skipped: number }>(
        '/admin/models/sources/' + source.value.id + '/import',
        'POST',
        { modelIds: selectedIds.value, catalogRevision: catalogRevision.value }
      )
      visible.value = false
      ElMessage.success(
        '已导入 ' +
          result.added +
          ' 个模型' +
          (result.skipped ? '，已存在的 ' + result.skipped + ' 个保持不变' : '') +
          '，请验证后启用'
      )
      success?.()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '导入失败，请重试'
    } finally {
      saving.value = false
    }
  }
  watch(
    () => search.value.query,
    () => {
      page.value = 1
    }
  )
  defineExpose({ open })
</script>
<style scoped lang="scss">
  .model-sync {
    display: grid;
    gap: 14px;
    min-width: 0;
    .description {
      margin: 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      line-height: 1.8;
    }
    .selection-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
    .catalog {
      min-height: 140px;
      max-height: 380px;
      overflow-y: auto;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .el-card {
      min-width: 0;
      &.selected {
        border-color: var(--el-color-primary);
        background: var(--el-color-primary-light-9);
      }
    }
    :deep(.el-card__body) {
      display: grid;
      gap: 8px;
      padding: 14px;
    }
    :deep(.el-checkbox) {
      height: auto;
      min-width: 0;
      align-items: flex-start;
      white-space: normal;
    }
    :deep(.el-checkbox__input) {
      margin-top: 3px;
    }
    :deep(.el-checkbox__label) {
      min-width: 0;
      line-height: 1.5;
    }
    .model-name {
      overflow-wrap: anywhere;
    }
    .model-state {
      font-size: 11px;
      color: var(--el-text-color-secondary);
      line-height: 1.5;
    }
    .pagination {
      display: flex;
      justify-content: center;
    }
    @media (max-width: 520px) {
      .cards {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }
</style>
