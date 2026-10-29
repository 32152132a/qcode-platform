<template>
  <PagePanel
    title="问题反馈"
    description="查看员工提交的问题与截图。有效反馈的奖励由管理员确认后手动发放。"
    :loading="loading"
    :error="error"
  >
    <template #actions><el-button @click="load">刷新</el-button></template>
    <DataTable :rows="data || []" :columns="columns" :actions="actions" />
    <FeedbackDetail ref="detail" /><EntityDialog ref="editor" />
  </PagePanel>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import PagePanel from "@/components/PagePanel/index.vue";
import DataTable, { type RowAction } from "@/components/DataTable/index.vue";
import EntityDialog from "@/components/EntityDialog/index.vue";
import FeedbackDetail from "./components/FeedbackDetail/index.vue";
import { useResource } from "@/hooks/useResource";
import { useAuthStore } from "@/stores/auth";
import { request } from "@/api/request";
import { date, confirmAction } from "@/utils/forms";
import type { Row, Column } from "@/types";
const statuses = [
  { value: "pending", label: "待处理" },
  { value: "accepted", label: "已采纳" },
  { value: "rejected", label: "不采纳" },
  { value: "completed", label: "已完成" },
];
const auth = useAuthStore(),
  { data, loading, error, load } = useResource<Row[]>(() => "/admin/feedback");
const detail = ref<InstanceType<typeof FeedbackDetail>>(),
  editor = ref<InstanceType<typeof EntityDialog>>();
const columns: Column[] = [
  { prop: "username", label: "用户" },
  { prop: "phone", label: "联系电话", minWidth: 150 },
  { prop: "content", label: "问题描述", minWidth: 240 },
  { prop: "imageCount", label: "截图数量" },
  {
    prop: "status",
    label: "处理状态",
    render: (r) =>
      statuses.find((s) => s.value === r.status)?.label || "待处理",
  },
  {
    prop: "created_at",
    label: "提交时间",
    minWidth: 180,
    render: (r) => date(r.created_at),
  },
];
const actions = computed<RowAction[]>(() => [
  { label: "查看", run: (r) => detail.value?.open(String(r.id)) },
  ...(auth.can("feedback:write")
    ? [
        { label: "处理", run: processFeedback },
        {
          label: "删除",
          danger: true,
          run: (r: Row) =>
            confirmAction(
              "删除此反馈及截图？",
              () => request("/admin/feedback/" + r.id, "DELETE"),
              load,
            ),
        },
      ]
    : []),
]);
function processFeedback(row: Row) {
  editor.value?.open(
    {
      title: "处理反馈",
      value: { status: row.status, reply: row.reply || "" },
      fields: [
        {
          prop: "status",
          label: "处理状态",
          type: "select",
          required: true,
          options: statuses,
        },
        {
          prop: "reply",
          label: "处理回复",
          type: "textarea",
          props: {
            maxlength: 1000,
            showWordLimit: true,
            autosize: { minRows: 4, maxRows: 8 },
          },
        },
      ],
      save: (value) => request("/admin/feedback/" + row.id, "PUT", value),
    },
    () => {
      void load();
    },
  );
}
</script>
