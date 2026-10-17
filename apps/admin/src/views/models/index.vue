<template>
  <PagePanel
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
      description="暂无服务来源，添加后可读取列表并选择模型导入" />
    <div class="source-list">
      <el-card v-for="source in visibleSources" :key="source.id" shadow="never"
        ><template #header
          ><div class="source-heading">
            <div>
              <h2>{{ source.name }}</h2>
              <p>{{ source.base_url }}</p>
            </div>
            <el-switch
              :model-value="source.active"
              :disabled="!auth.can('models:write') || busy === source.id"
              active-text="启用"
              inactive-text="关闭"
              @change="toggle(source)"
            /></div
        ></template>
        <div class="source-toolbar">
          <el-tag :type="source.sync_status === 'failed' ? 'warning' : 'info'">{{
            source.synced_at
              ? '上次同步 ' + new Date(source.synced_at).toLocaleString()
              : '尚未同步'
          }}</el-tag
          ><el-tag v-if="source.sync_status === 'failed'" type="warning">{{
            source.sync_error
          }}</el-tag>
          <div v-if="auth.can('models:write')" class="buttons">
            <el-button
              :loading="busy === source.id"
              :disabled="!source.active"
              @click="sync(source)"
              >同步模型</el-button
            ><el-button @click="editSource(source)">配置来源</el-button
            ><el-button @click="addModel(source)">添加模型</el-button
            ><el-button
              v-if="!models.some((m) => m.source_id === source.id)"
              type="danger"
              text
              @click="removeSource(source)"
              >删除</el-button
            >
          </div>
        </div>
        <SourceModelTable
          :models="displayModels(source)"
          :source-active="source.active"
          :can-write="auth.can('models:write')"
          :busy="busy"
          @edit="(model) => modelEditor?.open(model, load)"
          @check="check"
          @toggle="toggleModel"
      /></el-card>
    </div>
    <ModelSyncDialog ref="syncDialog" /><EntityDialog ref="editor" /><ModelDialog ref="modelEditor"
  /></PagePanel>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import PagePanel from '@/components/PagePanel/index.vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import ModelDialog from './components/ModelDialog/index.vue'
  import ModelSyncDialog from './components/ModelSyncDialog/index.vue'
  import SourceModelTable from './components/SourceModelTable/index.vue'
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
  const syncDialog = ref<InstanceType<typeof ModelSyncDialog>>()
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
  async function toggle(source: ModelSource) {
    if (source.active) {
      try {
        await ElMessageBox.confirm(
          '关闭后，此来源的所有模型立即停止接受新请求，保留配置和历史用量。',
          '关闭服务来源',
          { type: 'warning' }
        )
      } catch {
        return
      }
    }
    await run(source.id, () =>
      request('/admin/models/sources/' + source.id, 'PUT', { active: !source.active })
    )
  }
  function sync(source: ModelSource) {
    syncDialog.value?.open(source, models.value, load)
  }
  async function editSource(source?: ModelSource) {
    try {
      const keys = auth.can('keys:read') ? await request<Row[]>('/admin/keys') : []
      const category = source?.kind || kind.value
      let preset = 'http://localhost:11434/v1'
      if (category === 'local')
        preset = String((await request<Row>('/admin/models/ollama-preset')).baseUrl)
      const fields: Field[] = [{ prop: 'name', label: '来源名称', required: true }]
      if (category !== 'official')
        fields.push({ prop: 'baseUrl', label: '服务基础地址', required: true })
      if (category !== 'local')
        fields.push(
          { prop: 'apiKey', label: source ? '替换 Key（留空保留）' : 'API Key', type: 'password' },
          {
            prop: 'keyId',
            label: '或选择已有 Key',
            type: 'select',
            options: keys
              .filter((k) => k.active)
              .map((k) => ({ label: String(k.name) + ' · …' + k.suffix, value: String(k.id) })),
          }
        )
      fields.push({
        prop: 'autoSync',
        label: '启动时自动刷新模型列表',
        type: 'select',
        options: [
          { label: '开启', value: 'true' },
          { label: '关闭', value: 'false' },
        ],
      })
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
            keyId: source?.key_id || '',
            apiKey: '',
            autoSync: String(source?.auto_sync ?? true),
          },
          save: (value) =>
            request(
              '/admin/models/sources' + (source ? '/' + source.id : ''),
              source ? 'PUT' : 'POST',
              { ...value, kind: category, autoSync: value.autoSync === 'true' }
            ),
        },
        load
      )
    } catch (cause) {
      ElMessage.error(cause instanceof Error ? cause.message : '读取配置失败')
    }
  }
  function addModel(source: ModelSource) {
    editor.value?.open(
      {
        title: '添加模型 · ' + source.name,
        fields: [
          {
            prop: 'upstreamModel',
            label: '上游模型',
            type: source.catalog?.length ? 'select' : 'input',
            required: true,
            options: source.catalog?.map((m) => ({ label: m.id, value: m.id })),
          },
          { prop: 'name', label: '显示名称（可留空）' },
        ],
        value: { upstreamModel: '', name: '' },
        save: (value) => request('/admin/models/sources/' + source.id + '/models', 'POST', value),
      },
      load
    )
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
            verification({ ...model, verification: { status: String(result.status) } })
        ),
        type: ['verified', 'connected'].includes(String(result.status)) ? 'success' : 'warning',
      })
    })
  }
  async function toggleModel(model: Model) {
    if (!model.active && model.provider !== 'ollama' && model.verification?.status !== 'verified') {
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
  .source-tab-label {
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    gap: 8px;
  }
  .source-list {
    display: grid;
    gap: 20px;
    .el-card {
      border-radius: 4px;
    }
  }
  .source-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    h2 {
      font-size: 15px;
      margin: 0;
    }
    p {
      color: #8b95a5;
      font-size: 12px;
      overflow-wrap: anywhere;
      margin: 8px 0 0;
    }
  }
  .source-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    .buttons {
      margin-left: auto;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
  }
</style>
