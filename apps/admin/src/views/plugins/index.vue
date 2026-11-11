<template>
  <PagePanel title="插件管理" description="启停变更在员工下次登录客户端时生效。"
    :loading="loading" :error="error || saveError">
    <el-card shadow="never">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="插件">GitHub</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-switch :model-value="data?.githubEnabled === true" :loading="saving"
            :disabled="loading || !data || !auth.can('plugins:write')" aria-label="启用 GitHub 插件"
            @change="update" />
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </PagePanel>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import PagePanel from '@/components/PagePanel/index.vue'
import { useResource } from '@/hooks/useResource'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/api/request'

const auth = useAuthStore()
const { data, loading, error, load } = useResource<{ githubEnabled: boolean }>(() => '/admin/plugins')
const saving = ref(false)
const saveError = ref('')

async function update(value: unknown) {
  if (saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await request('/admin/plugins/github', 'POST', { enabled: value === true })
    await load()
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause.message : '保存插件状态失败'
  } finally {
    saving.value = false
  }
}
</script>
