<template>
  <el-dialog
    v-model="visible"
    title="人工收款设置"
    width="620px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="loading" :rows="4" animated />
    <template v-else>
      <el-alert
        title="仅展示付款信息，不会自动扣款或自动开通。请使用适用于当前业务的收款方式，确认开通前核对实际到账。"
        type="info"
        :closable="false"
        show-icon
      />
      <QyqForm
        v-model="value"
        :columns="1"
        :form-options="fields"
        :show-btn="false"
        :disabled="saving"
      />
      <el-space direction="vertical" alignment="start">
        <el-switch
          v-model="enabled"
          active-text="显示人工收款信息"
          :disabled="saving"
        />
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept="image/png,image/jpeg,image/webp"
          :disabled="saving"
          :on-change="selectImage"
        >
          <el-button :disabled="saving">上传或替换收款码</el-button>
          <template #tip
            ><el-text type="info" size="small"
              >PNG、JPEG、WebP，最大 512
              KB；图片保存在服务器私有数据库。</el-text
            ></template
          >
        </el-upload>
        <el-text v-if="selectedName" type="primary"
          >已选择 {{ selectedName }}，保存后可预览。</el-text
        >
        <el-image
          v-if="qrUrl"
          class="payment-preview"
          :src="qrUrl"
          fit="contain"
          :preview-src-list="[qrUrl]"
          preview-teleported
        />
      </el-space>
    </template>
    <template #footer
      ><el-button :disabled="saving" @click="visible = false">取消</el-button
      ><el-button
        type="primary"
        :disabled="loading"
        :loading="saving"
        @click="save"
        >保存</el-button
      ></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { ElMessage, type UploadFile } from "element-plus";
import QyqForm from "@/components/qyq-form/index.vue";
import { request } from "@/api/request";
type PaymentConfig = {
  enabled: boolean;
  recipient: string;
  instructions: string;
  qrUrl: string | null;
};
const visible = ref(false),
  loading = ref(false),
  saving = ref(false),
  error = ref(""),
  enabled = ref(false),
  qrUrl = ref<string | null>(null),
  selectedName = ref(""),
  image = ref<string>();
const value = ref({ recipient: "", instructions: "" });
const fields = [
  {
    prop: "recipient",
    label: "收款人",
    type: "input",
    isNotTrim: true,
    allowSpecialChars: true,
    maxlength: 80,
  },
  {
    prop: "instructions",
    label: "付款说明",
    type: "textarea",
    isNotTrim: true,
    allowSpecialChars: true,
    maxlength: 500,
  },
];
async function open() {
  visible.value = true;
  loading.value = true;
  error.value = "";
  image.value = undefined;
  selectedName.value = "";
  qrUrl.value = null;
  try {
    const data = await request<PaymentConfig>("/admin/plans/payment-config");
    value.value = {
      recipient: data.recipient,
      instructions: data.instructions,
    };
    enabled.value = data.enabled;
    qrUrl.value = data.qrUrl;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
async function selectImage(file: UploadFile) {
  error.value = "";
  if (
    !file.raw ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.raw.type) ||
    file.raw.size > 512 * 1024
  ) {
    error.value = "请选择最大 512 KB 的 PNG、JPEG 或 WebP 图片";
    return;
  }
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("图片读取失败"));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file.raw!);
    });
    image.value = data;
    selectedName.value = file.name;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "图片读取失败";
  }
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const data = await request<PaymentConfig>(
      "/admin/plans/payment-config",
      "PUT",
      {
        ...value.value,
        enabled: enabled.value,
        ...(image.value ? { image: image.value } : {}),
      },
    );
    qrUrl.value = data.qrUrl;
    image.value = undefined;
    selectedName.value = "";
    ElMessage.success("收款设置已保存，客户端刷新后生效");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存失败";
  } finally {
    saving.value = false;
  }
}
defineExpose({ open });
</script>
<style scoped lang="scss">
.payment-preview {
  width: 180px;
  max-width: 100%;
}
</style>
