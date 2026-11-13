<template>
  <PagePanel class="models-page"
    title="模型与服务"
    description="支持多个服务站点；每个站点独立配置地址、Key 和模型，员工统一获取已启用模型。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('models:write')" type="primary" @click="editSource()">{{
        addSourceLabel
      }}</el-button></template
    ><el-tabs v-model="kind"
      ><el-tab-pane v-for="item in categories" :key="item.id" :name="item.id"
        ><template #label>
          <span class="source-tab-label">
            <span>{{ item.label }}</span>
            <el-badge
              :value="sources.filter((source) => source.kind === item.id).length"
              :show-zero="true"
              type="info"
              :title="sources.filter((source) => source.kind === item.id).length + ' 个服务站点'"
              :aria-label="
                sources.filter((source) => source.kind === item.id).length + ' 个服务站点'
              "
            />
          </span> </template></el-tab-pane></el-tabs
    ><el-empty
      v-if="!visibleSources.length"
      description="暂无服务来源，请先添加来源" />
    <div class="source-list">
      <SourceCard
        v-for="source in visibleSources"
        :key="source.id"
        :title="source.name"
        :address="source.base_url"
        >
        <template #status>
          <el-tag v-if="source.kind !== 'local'" type="info">{{ (source.key_id ? 1 : 0) + (source.fallback_key_ids?.length || 0) }} 个 Key</el-tag>
          <el-tag :type="source.sync_status === 'failed' ? 'warning' : 'info'">{{
            source.synced_at
              ? '上次同步 ' + new Date(source.synced_at).toLocaleString()
              : '尚未同步'
          }}</el-tag
          ><el-tag v-if="source.sync_status === 'failed'" type="warning">{{
            source.sync_error
          }}</el-tag>
        </template>
        <template v-if="auth.can('models:write')" #actions>
          <el-button @click="editSource(source)">配置来源</el-button>
          <el-button @click="addModel(source)">添加模型</el-button>
          <el-button
            v-if="!models.some((m) => m.source_id === source.id)"
            type="danger"
            text
            @click="removeSource(source)"
            >删除</el-button
          >
        </template>
        <SourceModelTable
          :models="displayModels(source)"
          :source-active="source.active"
          :can-write="auth.can('models:write')"
          :busy="busy"
          @edit="(model) => modelEditor?.open(model, load)"
          @check="check"
          @toggle="toggleModel"
          @remove="removeModel"
      /></SourceCard>
    </div>
    <EntityDialog ref="editor" /><ModelDialog ref="modelEditor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import ModelDialog from './components/ModelDialog/index.vue'
  import SourceModelTable from './components/SourceModelTable/index.vue'
  import SourceCard from './components/SourceCard/index.vue'
  import { verificationLabel as verification } from './model-status'
  import { request } from '@/api/request'
  import { useAuthStore } from '@/stores/auth'
  import type { Model, ModelSource } from '@/types/models'
  import type { Field, Row } from '@/types'
  const auth = useAuthStore(),
    kind = ref('local'),
    sources = ref<ModelSource[]>([]),
    models = ref<Model[]>([]),
    loading = ref(false),
    busy = ref(''),
    error = ref(''),
    editor = ref<InstanceType<typeof EntityDialog>>(),
    modelEditor = ref<InstanceType<typeof ModelDialog>>()
  const categories = [
    { id: 'local', label: '本地部署' },
    { id: 'official', label: '官网模型' },
    { id: 'relay', label: '中转站' },
  ]
  const addSourceLabel = computed(() =>
    kind.value === 'relay' ? '添加中转站' : kind.value === 'local' ? '添加本地服务' : '添加官网服务'
  )
  const visibleSources = computed(() => sources.value.filter((s) => s.kind === kind.value))
  function displayModels(source: ModelSource) {
    return models.value.filter((model) => model.source_id === source.id)
  }
  async function load() {
    loading.value = true
    error.value = ''
    try {
      ;[sources.value, models.value] = await Promise.all([
        request<ModelSource[]>('/admin/models/sources'),
        request<Model[]>('/admin/models'),
      ])
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      loading.value = false
    }
  }
  async function run(id: string, action: () => Promise<unknown>) {
    busy.value = id
    try {
      await action()
      await load()
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      busy.value = ''
    }
  }
  async function editSource(source?: ModelSource) {
    try {
      const keys = auth.can('keys:read') ? await request<Row[]>('/admin/keys') : []
      const category = source?.kind || kind.value
      let preset = 'http://localhost:11434/v1'
      if (category === 'local')
        preset = String((await request<Row>('/admin/models/ollama-preset')).baseUrl)
      const fields: Field[] = [{ prop: 'name', label: '来源名称', required: true }]
      fields.push({ prop: 'baseUrl', label: '服务基础地址', required: true })
      if (category !== 'local')
        fields.push(
          {
            prop: 'keyIds',
            label: '站点 Key 池（按选择顺序使用）',
            type: 'select',
            multiple: true,
            options: keys
              .filter((k) => !k.source_id || k.source_id === source?.id)
              .map((k) => ({
                label: String(k.name) + ' · …' + k.suffix + (k.active ? '' : '（已停用）'),
                value: String(k.id),
              })),
          }
        )
      if (source?.kind === 'official' && new URL(source.base_url).hostname === 'dashscope.aliyuncs.com')
        fields.push({ prop: 'catalogWorkspaceId', label: '百炼北京工作空间 ID（选填）', hint: '填写后使用百炼工作空间目录读取规格和价格。对话继续使用上面的服务地址。' })
      editor.value?.open(
        {
          title: source
            ? '配置服务来源'
            : '添加' + categories.find((c) => c.id === category)?.label + '来源',
          fields,
          value: {
            name:
              source?.name ||
              (category === 'official'
                ? 'DeepSeek 官方'
                : category === 'local'
                  ? '本地 Ollama'
                  : ''),
            baseUrl:
              source?.base_url ||
              (category === 'official'
                ? 'https://api.deepseek.com/v1'
                : category === 'local'
                  ? preset
                  : ''),
            keyIds: [source?.key_id, ...(source?.fallback_key_ids || [])].filter(Boolean),
            catalogWorkspaceId: source?.catalog_workspace_id || '',
          },
          save: (value) =>
            request(
              '/admin/models/sources' + (source ? '/' + source.id : ''),
              source ? 'PUT' : 'POST',
              { ...value, kind: category }
            ),
        },
        load
      )
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '读取配置失败')
    }
  }
  function addModel(source: ModelSource) {
    modelEditor.value?.open(undefined, load, source)
  }
  async function check(model: Model) {
    try {
      await ElMessageBox.confirm('将发送少量真实模型请求，计入用量和配额，是否继续？', '验证模型', {
        type: 'warning',
      })
    } catch {
      return
    }
    await run(model.id, async () => {
      const result = await request<Row>('/admin/models/' + model.id + '/check', 'POST', {}, true, {
        timeout: 180000,
      })
      ElMessage({
        message: String(
          result.message ||
            verification({
              ...model,
              verification: { status: String(result.status) },
            })
        ),
        type: ['verified', 'connected'].includes(String(result.status)) ? 'success' : 'warning',
      })
    })
  }
  async function toggleModel(model: Model) {
    if (!model.active && model.model_type !== 'image' && model.provider !== 'ollama' && model.verification?.status !== 'verified') {
      try {
        await ElMessageBox.confirm(
          '此模型尚未通过工具调用验证，可能只能聊天。仍要启用？',
          '启用未验证模型',
          { type: 'warning' }
        )
      } catch {
        return
      }
    }
    await run(model.id, () =>
      request('/admin/models/sources/' + model.source_id + '/models/' + model.id, 'PATCH', {
        active: !model.active,
      })
    )
  }
  async function removeModel(model: Model) {
    try {
      await ElMessageBox.confirm(
        '删除模型“' + model.name + '”？员工的默认选择将清除，历史调用与用量保留。可通过「添加模型」重新添加。',
        '删除模型',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    await run(model.id, () =>
      request('/admin/models/sources/' + model.source_id + '/models/' + model.id, 'DELETE')
    )
  }
  async function removeSource(source: ModelSource) {
    try {
      await ElMessageBox.confirm('删除空来源 ' + source.name + '？', '确认删除', {
        type: 'warning',
      })
    } catch {
      return
    }
    await run(source.id, () => request('/admin/models/sources/' + source.id, 'DELETE'))
  }
  void load()
</script>
<style scoped lang="scss">
  .page-panel.models-page {
    overflow: hidden;
    :deep(.table), :deep(.page-content) { overflow: hidden; }
    :deep(.el-tabs) { flex-shrink: 0; }
  }
  .source-tab-label {
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    gap: 8px;
  }
  .source-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: max-content;
    align-content: start;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    gap: var(--admin-gap);
  }
</style>
