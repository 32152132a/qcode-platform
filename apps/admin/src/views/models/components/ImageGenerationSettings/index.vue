<template>
  <el-alert :title="summary" :type="noticeType" :closable="false">
    <el-button v-if="auth.can('models:write')" text type="primary" @click="edit">配置生图</el-button>
  </el-alert>
  <EntityDialog ref="editor" />
</template>
<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import EntityDialog from '@/components/EntityDialog/index.vue'
  import { request } from '@/api/request'
  import { useAuthStore } from '@/stores/auth'
  import { yesNo } from '@/utils/forms'
  import type { ModelSource } from '@/types/models'
  interface ImageSettings { enabled: boolean; sourceId: string; model: string; dailyImagesPerUser: number }
  const props = defineProps<{ sources: ModelSource[] }>()
  const auth = useAuthStore()
  const editor = ref<InstanceType<typeof EntityDialog>>()
  const value = ref<ImageSettings>()
  const error = ref('')
  const sources = computed(() => props.sources.filter(source => source.kind !== 'local' && source.active && source.key_id))
  const configuredSource = computed(() => sources.value.find(source => source.id === value.value?.sourceId))
  const noticeType = computed(() => error.value ? 'error' : value.value?.enabled && !configuredSource.value ? 'warning' : 'info')
  const summary = computed(() => {
    if (error.value) return error.value
    if (!value.value?.enabled) return '对话生图未启用'
    if (!configuredSource.value) return '对话生图暂不可用：站点已停用、删除或未配置 Key'
    return '对话生图：' + value.value.model + ' · 每人每日最多 ' + value.value.dailyImagesPerUser + ' 张'
  })
  async function load() {
    try { value.value = await request<ImageSettings>('/admin/models/images/settings'); error.value = '' }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '读取生图配置失败' }
  }
  async function edit() {
    await load()
    if (!value.value || error.value) return
    editor.value?.open({
      title: '对话生图',
      fields: [
        { prop: 'enabled', label: '启用生图', type: 'select', options: yesNo, required: true },
        { prop: 'sourceId', label: '生图服务站点', type: 'select', options: sources.value.map(s => ({ label: s.name, value: s.id })) },
        { prop: 'model', label: '生图模型', hint: '填写站点支持的模型名，如 gpt-image-2。' },
        { prop: 'dailyImagesPerUser', label: '每人每日张数', type: 'number', required: true },
      ],
      value: { ...value.value, enabled: String(value.value.enabled) },
      save: v => request('/admin/models/images/settings', 'PUT', { ...v, enabled: v.enabled === 'true', dailyImagesPerUser: Number(v.dailyImagesPerUser) }),
    }, load)
  }
  onMounted(load)
</script>
