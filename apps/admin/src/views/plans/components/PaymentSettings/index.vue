<template>
  <el-dialog
    v-model="visible"
    title="收款码"
    width="440px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="loading" :rows="4" animated />
    <section v-else class="payment-settings">
      <el-image
        v-if="qrUrl"
        class="payment-preview"
        :src="qrUrl"
        fit="contain"
        :preview-src-list="[qrUrl]"
        preview-teleported
      />
      <el-empty v-else description="暂未设置收款码" :image-size="72" />
      <el-upload
        class="payment-upload"
        :auto-upload="false"
        :show-file-list="false"
        accept="image/png,image/jpeg,image/webp"
        :disabled="saving"
        :on-change="selectImage"
      >
        <el-button :disabled="saving">{{
          qrUrl ? "替换收款码" : "上传收款码"
        }}</el-button>
        <template #tip>
          <el-text type="info" size="small"
            >PNG / JPEG / WebP · 最大 512 KB</el-text
          >
        </template>
      </el-upload>
      <el-text
        v-if="selectedName"
        class="payment-filename"
        type="primary"
        size="small"
      >
        已选择 {{ selectedName }}，保存后生效。
      </el-text>
      <el-text tag="p" type="info" size="small">
        用户申请套餐时显示此收款码，到账后由管理员确认开通。
      </el-text>
    </section>
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
  qrUrl = ref<string | null>(null),
  selectedName = ref(""),
  image = ref<string>();
async function open() {
  visible.value = true;
  loading.value = true;
  error.value = "";
  image.value = undefined;
  selectedName.value = "";
  qrUrl.value = null;
  try {
    const data = await request<PaymentConfig>("/admin/plans/payment-config");
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
  if (!image.value && !qrUrl.value) {
    error.value = "请先上传收款码";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const data = await request<PaymentConfig>(
      "/admin/plans/payment-config",
      "PUT",
      {
        enabled: true,
        recipient: "以二维码所示收款人为准",
        instructions:
          "请备注账号，付款后等待管理员核实，通常约需 5～10 分钟。开通后刷新账号权益即可使用，请勿重复付款。",
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
.payment-settings {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding-block: 8px;
  text-align: center;
  .payment-upload {
    display: grid;
    justify-items: center;
    gap: 8px;
  }
  .payment-preview {
    width: 210px;
    max-width: 100%;
    height: 280px;
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
  }
  .payment-filename {
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
  }
}
</style>
