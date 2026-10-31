<template>
  <PagePanel
    title="套餐管理"
    description="等级越大越高级，只允许向上升级。0 元套餐自动开通，付费套餐由管理员核款开通。"
    :loading="loading"
    :error="error"
  >
    <template #actions
      ><el-button @click="load">刷新</el-button
      ><template v-if="auth.can('plans:write')"
        ><el-button @click="paymentEditor?.open()">收款设置</el-button
        ><el-button @click="manualGrant">手动开通</el-button
        ><el-button type="primary" @click="edit()"
          >创建套餐</el-button
        ></template
      ></template
    >
    <el-alert
      title="免费套餐自动开通；付费套餐人工核款。套餐等级决定升级路线，价格不参与等级判断。"
      type="info"
      :closable="false"
      show-icon
    />
    <el-tabs v-model="tab"
      ><el-tab-pane label="套餐配置" name="plans" /><el-tab-pane
        v-if="auth.can('plans:write')"
        label="开通申请"
        name="orders" /><el-tab-pane
        v-if="auth.can('plans:write')"
        label="已开通用户"
        name="members"
    /></el-tabs>
    <DataTable
      :rows="data || []"
      :columns="columns"
      :actions="actions"
    /><EntityDialog ref="editor" /><PaymentSettings ref="paymentEditor" />
  </PagePanel>
</template>
<script setup lang="ts">
import PaymentSettings from "./components/PaymentSettings/index.vue";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import PagePanel from "@/components/PagePanel/index.vue";
import DataTable, { type RowAction } from "@/components/DataTable/index.vue";
import EntityDialog from "@/components/EntityDialog/index.vue";
import { useResource } from "@/hooks/useResource";
import { useAuthStore } from "@/stores/auth";
import { request } from "@/api/request";
import {
  date,
  quotaFields,
  quotaValues,
  quotaBody,
  yesNo,
  confirmAction,
} from "@/utils/forms";
import type { Row, Column, Field } from "@/types";
const auth = useAuthStore(),
  tab = ref("plans"),
  editor = ref<InstanceType<typeof EntityDialog>>(),
  paymentEditor = ref<InstanceType<typeof PaymentSettings>>();
const { data, loading, error, load } = useResource<Row[]>(
  () => "/admin/plans" + (tab.value === "plans" ? "" : "/" + tab.value),
);
const name = (r: Row) => String((r.terms as Row)?.name || r.name || "—");
const amount = (r: Row) =>
  "¥" +
  (Number((r.terms as Row)?.price_cents ?? r.price_cents ?? 0) / 100).toFixed(
    2,
  );
const statusLabels: Record<string, string> = {
  pending: "待确认",
  approved: "已开通",
  rejected: "已拒绝",
  cancelled: "已取消",
  active: "使用中",
  expired: "已到期",
};
const columns = computed<Column[]>(() =>
  tab.value === "plans"
    ? [
        { prop: "name", label: "套餐名称" },
        { prop: "level", label: "等级" },
        {
          prop: "is_default",
          label: "默认套餐",
          render: (r) => (r.is_default ? "是" : "—"),
        },
        { prop: "price_cents", label: "价格", render: amount },
        { prop: "duration_days", label: "有效天数" },
        {
          prop: "model_ids",
          label: "对话模型数",
          render: (r) => String((r.model_ids as unknown[]).length),
        },
        {
          prop: "active",
          label: "上架状态",
          render: (r) => (r.active ? "已上架" : "已下架"),
        },
        { prop: "description", label: "说明", minWidth: 200 },
      ]
    : tab.value === "orders"
      ? [
          { prop: "id", label: "订单号", minWidth: 290 },
          { prop: "username", label: "用户" },
          { prop: "phone", label: "联系电话", minWidth: 150 },
          { prop: "terms", label: "申请套餐", render: name },
          { prop: "amount", label: "核对金额", render: amount },
          {
            prop: "status",
            label: "状态",
            minWidth: 100,
            render: (r) => statusLabels[String(r.status)] || String(r.status),
          },
          {
            prop: "verified_transaction_id",
            label: "已核实交易号",
            minWidth: 220,
          },
          { prop: "reply", label: "处理回复", minWidth: 160 },
          {
            prop: "created_at",
            label: "申请时间",
            minWidth: 180,
            render: (r) => date(r.created_at),
          },
        ]
      : [
          { prop: "username", label: "用户" },
          { prop: "terms", label: "当前套餐", render: name },
          {
            prop: "status",
            label: "状态",
            render: (r) => statusLabels[String(r.status)] || String(r.status),
          },
          {
            prop: "started_at",
            label: "开通时间",
            minWidth: 180,
            render: (r) => date(r.started_at),
          },
          {
            prop: "expires_at",
            label: "到期时间",
            minWidth: 180,
            render: (r) => date(r.expires_at),
          },
        ],
);
const actions = computed<RowAction[]>(() =>
  !auth.can("plans:write")
    ? []
    : tab.value === "plans"
      ? [
          { label: "编辑", run: edit },
          {
            label: "删除",
            danger: true,
            run: (r) =>
              confirmAction(
                "删除未使用的套餐？已有开通或申请记录时请改为下架。",
                () => request("/admin/plans/" + r.id, "DELETE"),
                load,
              ),
          },
        ]
      : tab.value === "orders"
        ? [
            {
              label: "确认开通",
              visible: (r) => r.status === "pending",
              run: approve,
            },
            {
              label: "拒绝",
              visible: (r) => r.status === "pending",
              run: reject,
            },
            {
              label: "删除",
              danger: true,
              visible: (r) =>
                ["cancelled", "rejected"].includes(String(r.status)),
              run: (r) =>
                confirmAction(
                  "删除这条已结束的申请？",
                  () => request("/admin/plans/orders/" + r.id, "DELETE"),
                  load,
                ),
            },
          ]
        : [],
);
function approve(row: Row) {
  editor.value?.open(
    {
      title:
        "核对 " +
        row.username +
        " 的 " +
        name(row) +
        "（" +
        amount(row) +
        "）到账并开通",
      value: { transactionId: "" },
      fields:
        Number((row.terms as Row).price_cents) > 0
          ? [{ prop: "transactionId", label: "支付宝交易号（选填）" }]
          : [],
      save: (value) =>
        request("/admin/plans/orders/" + row.id + "/approve", "POST", {
          confirmed: true,
          ...(value.transactionId
            ? { transactionId: String(value.transactionId) }
            : {}),
        }),
    },
    load,
  );
}
async function edit(row?: Row) {
  try {
    const models = await request<Row[]>("/admin/models");
    const fields: Field[] = [
      {
        prop: "level",
        label: "套餐等级（越大越高级）",
        required: true,
        type: "number",
        props: { min: 0, max: 1000, precision: 0 },
      },
      {
        prop: "isDefault",
        label: "新用户默认套餐",
        type: "select",
        options: yesNo,
      },
      {
        prop: "name",
        label: "套餐名称",
        required: true,
        props: { maxlength: 40 },
      },
      {
        prop: "price",
        label: "价格（元）",
        type: "number",
        required: true,
        props: { min: 0, max: 1000000, precision: 2 },
      },
      {
        prop: "durationDays",
        label: "有效天数",
        type: "number",
        required: true,
        props: { min: 1, max: 366 },
      },
      {
        prop: "maxConcurrentRequests",
        label: "并发上限",
        type: "number",
        props: { min: 1, max: 20 },
      },
      {
        prop: "modelIds",
        label: "可选对话模型",
        type: "select",
        multiple: true,
        options: models
          .filter((m) => m.model_type !== "image")
          .map((m) => ({ label: String(m.name), value: String(m.id) })),
      },
      { prop: "active", label: "上架", type: "select", options: yesNo },
      ...quotaFields,
      {
        prop: "description",
        label: "套餐说明",
        type: "textarea",
        props: { maxlength: 400, autosize: { minRows: 3, maxRows: 6 } },
      },
    ];
    editor.value?.open(
      {
        title: row ? "编辑套餐（仅影响后续开通）" : "创建套餐",
        fields,
        value: {
          ...row,
          level: row?.level || 0,
          isDefault: String(row?.is_default ?? false),
          price: Number(row?.price_cents || 0) / 100,
          durationDays: row?.duration_days || 30,
          maxConcurrentRequests: row?.max_concurrent_requests || 1,
          modelIds: row?.model_ids || [],
          active: String(row?.active ?? true),
          ...quotaValues(row),
        },
        save: (v) =>
          request(
            "/admin/plans" + (row ? "/" + row.id : ""),
            row ? "PUT" : "POST",
            {
              name: v.name,
              level: v.level || 0,
              isDefault: v.isDefault === "true",
              description: v.description || "",
              price: v.price,
              durationDays: v.durationDays,
              maxConcurrentRequests: v.maxConcurrentRequests,
              modelIds: v.modelIds || [],
              active: v.active === "true",
              quotas: quotaBody(v),
            },
          ),
      },
      () => {
        void load();
      },
    );
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载模型失败");
  }
}
function reject(row: Row) {
  editor.value?.open(
    {
      title: "拒绝开通申请",
      value: { reply: "" },
      fields: [
        {
          prop: "reply",
          label: "拒绝原因",
          type: "textarea",
          required: true,
          props: { maxlength: 500, autosize: { minRows: 3, maxRows: 6 } },
        },
      ],
      save: (v) =>
        request("/admin/plans/orders/" + row.id + "/reject", "POST", v),
    },
    () => {
      void load();
    },
  );
}
async function manualGrant() {
  try {
    const [users, plans] = await Promise.all([
      request<Row[]>("/admin/users"),
      request<Row[]>("/admin/plans"),
    ]);
    editor.value?.open(
      {
        title: "手动开通（立即替换当前套餐）",
        value: { userId: "", planId: "", confirmed: "" },
        fields: [
          {
            prop: "userId",
            label: "普通用户",
            type: "select",
            required: true,
            options: users
              .filter((u) => u.role === "user" && u.is_active)
              .map((u) => ({ label: String(u.username), value: Number(u.id) })),
          },
          {
            prop: "planId",
            label: "套餐",
            type: "select",
            required: true,
            options: plans
              .filter((p) => p.active)
              .map((p) => ({
                label: String(p.name) + " · " + amount(p),
                value: String(p.id),
              })),
          },
          {
            prop: "confirmed",
            label: "开通确认",
            type: "select",
            required: true,
            options: [
              { label: "已核对收款或免费开通，确认立即替换", value: "yes" },
            ],
          },
        ],
        save: (v) =>
          request("/admin/plans/grants", "POST", {
            userId: v.userId,
            planId: v.planId,
            confirmed: v.confirmed === "yes",
          }),
      },
      () => {
        void load();
      },
    );
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : "加载失败");
  }
}
</script>
