<template>
  <div class="log-filters" @keydown.enter.prevent="submit">
    <QyqForm v-model="form" :columns="3" :show-btn="false" :form-options="fields" @submit.prevent>
      <template #dates
        ><el-date-picker
          v-model="dates"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          range-separator="至"
          aria-label="统计日期范围"
      /></template>
    </QyqForm>
    <el-button type="primary" @click="submit">查询</el-button>
  </div>
</template>
<script setup lang="ts">
  import { computed, ref } from 'vue'
  import QyqForm from '@/components/qyq-form/index.vue'
  import type { FormItemProp } from '@/components/qyq-form/types'
  import type { Row } from '@/types'
  const props = defineProps<{ kind: 'requests' | 'audits'; errorsOnly?: boolean }>()
  const emit = defineEmits<{ search: [values: Record<string, string>] }>()
  const form = ref<Row>({ search: '', status: '' }),
    dates = ref<[string, string] | null>(null)
  const fields = computed<FormItemProp[]>(() => [
    {
      prop: 'search',
      label: '搜索用户、模型或操作',
      type: 'input',
      placeholder: '搜索用户、模型或操作',
      clearable: true,
      isNotTrim: true,
      allowSpecialChars: true,
    },
    { prop: 'dates', label: '日期范围', type: 'custom' },
    ...(props.kind === 'requests'
      ? [
          {
            prop: 'status',
            label: '请求状态',
            type: 'select' as const,
            placeholder: '全部状态',
            clearable: true,
            options: [
              ...(!props.errorsOnly
                ? [
                    { label: '成功', value: 'success' },
                    { label: '进行中', value: 'pending' },
                  ]
                : []),
              { label: '失败', value: 'failed' },
              { label: '已中断', value: 'interrupted' },
              { label: '已取消', value: 'cancelled' },
            ],
          },
        ]
      : []),
  ])
  function submit() {
    const values: Record<string, string> = { search: String(form.value.search || '') }
    if (dates.value?.length === 2) {
      values.from = dates.value[0]
      values.to = dates.value[1]
    }
    if (props.kind === 'requests' && form.value.status) values.status = String(form.value.status)
    emit('search', values)
  }
</script>
<style scoped lang="scss">
  .log-filters {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-items: end;
    column-gap: 24px;
    min-width: 0;
    > :first-child {
      grid-column: span 3;
      min-width: 0;
    }
    > .el-button {
      justify-self: end;
    }
    :deep(.el-date-editor) {
      min-width: 0;
      width: 100%;
    }
  }
</style>
