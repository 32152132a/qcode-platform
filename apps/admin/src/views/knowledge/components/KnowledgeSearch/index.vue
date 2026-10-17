<template>
  <div
    class="knowledge-search"
    role="search"
    aria-label="知识库内容检索"
    @keydown.enter.prevent="submit"
  >
    <QyqForm
      v-model="search"
      :columns="1"
      :show-btn="false"
      :form-options="fields"
      @change="handleChange"
    />
    <el-button type="primary" @click="submit">检索</el-button>
  </div>
</template>
<script setup lang="ts">
  import { ref, watch } from 'vue'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Row } from '@/types'
  const query = defineModel<string>({ required: true })
  const emit = defineEmits<{ search: [] }>()
  const search = ref<Row>({ query: query.value })
  const fields: FormItemProp[] = [
    {
      prop: 'query',
      label: '搜索知识库内容',
      type: 'input',
      placeholder: '搜索知识库内容',
      clearable: true,
      isNotTrim: true,
      allowSpecialChars: true,
    },
  ]
  function handleChange(value: unknown) {
    query.value = String(value || '')
    if (!value) emit('search')
  }
  function submit() {
    query.value = String(search.value.query || '')
    emit('search')
  }
  watch(
    () => search.value.query,
    (value) => {
      query.value = String(value || '')
    }
  )
  watch(query, (value) => {
    if (value !== search.value.query) search.value = { query: value }
  })
</script>
<style scoped lang="scss">
  .knowledge-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 12px;
    width: 100%;
    max-width: 420px;
    min-width: 0;
    > .el-button {
      margin-bottom: 0;
    }
  }
</style>
