<template>
  <PagePanel
    title="模型与服务"
    description="按服务来源统一配置地址和 Key，员工自动获取已启用的模型。"
    :loading="loading"
    :error="error"
    ><template #actions
      ><el-button @click="load">刷新</el-button
      ><el-button v-if="auth.can('models:write')" type="primary" @click="editSource()"
        >添加服务来源</el-button
      ></template
    ><el-tabs v-model="kind"
      ><el-tab-pane
        v-for="item in categories"
        :key="item.id"
        :label="item.label + ' · ' + sources.filter((s) => s.kind === item.id).length"
        :name="item.id" /></el-tabs
    ><el-empty v-if="!visibleSources.length" description="暂无服务来源，添加后即可自动发现模型" />
    <div v-if="kind === 'relay'" class="recommendation-note">
      <span
        >按上游顺序展示前 30
        个有效文本模型，排除渠道、倍率和测试变体；已有启用及手动添加模型保留。</span
      ><el-switch v-model="showAllModels" active-text="显示全部已添加模型" />
    </div>
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
        <el-table
          :data="displayModels(source)"
          empty-text="暂无符合当前筛选的模型，可同步模型、添加模型或显示全部"
          ><el-table-column label="模型" min-width="220"
            ><template #default="{ row }"
              ><strong>{{ row.name }}</strong
              ><small class="model-id">{{ row.upstream_model }}</small></template
            ></el-table-column
          ><el-table-column label="状态" width="160"
            ><template #default="{ row }"
              ><el-tag
                :type="
                  row.catalog_available === false
                    ? 'danger'
                    : row.active && source.active
                      ? 'success'
                      : 'info'
                "
                >{{
                  row.catalog_available === false
                    ? '上游已下架'
                    : !source.active
                      ? '来源已关闭'
                      : row.active
                        ? '已启用'
                        : '未启用'
                }}</el-tag
              ><el-tag v-if="row.is_default" class="default-tag">默认</el-tag></template
            ></el-table-column
          ><el-table-column label="能力验证" min-width="150"
            ><template #default="{ row }">{{ verification(row) }}</template></el-table-column
          ><el-table-column v-if="auth.can('models:write')" label="操作" width="190"
            ><template #default="{ row }"
              ><el-button link type="primary" @click="modelEditor?.open(row, load)">编辑</el-button
              ><el-button link type="primary" :loading="busy === row.id" @click="check(row)"
                >验证</el-button
              ><el-button link type="primary" @click="toggleModel(row)">{{
                row.active ? '停用' : '启用'
              }}</el-button></template
            ></el-table-column
          ></el-table
        ></el-card
      >
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
  const showAllModels = ref(false)
  const visibleSources = computed(() => sources.value.filter((s) => s.kind === kind.value))
  function displayModels(source: ModelSource) {
    return models.value.filter(
      (model) =>
        model.source_id === source.id &&
        (source.kind !== 'relay' ||
          showAllModels.value ||
          model.recommended !== false ||
          model.active ||
          !model.discovered)
    )
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
  async function sync(source: ModelSource) {
    await run(source.id, async () => {
      await request('/admin/models/sources/' + source.id + '/sync', 'POST', {})
      ElMessage.success('同步完成，新发现的云模型请验证后启用')
    })
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
        label: '启动时自动同步模型',
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
  function verification(model: Model) {
    return model.verification?.status === 'verified'
      ? '流式与工具调用通过'
      : model.verification?.status === 'connected'
        ? '聊天连通，未验证工具'
        : model.verification?.status === 'failed'
          ? '验证失败'
          : '待验证'
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
  .recommendation-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    color: #909399;
    font-size: 12px;
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
  .model-id {
    display: block;
    font-size: 11px;
    color: #9aa3b1;
    margin-top: 6px;
  }
  .default-tag {
    margin-left: 6px;
  }
</style>
