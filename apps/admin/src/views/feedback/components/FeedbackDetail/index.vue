<template>
  <el-dialog v-model="visible" title="反馈详情" width="740px" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-skeleton v-if="loading" :rows="4" animated />
    <template v-else-if="entry">
      <el-descriptions :column="1" border
        ><el-descriptions-item label="用户">{{
          entry.username
        }}</el-descriptions-item
        ><el-descriptions-item label="联系电话">{{
          entry.phone
        }}</el-descriptions-item
        ><el-descriptions-item label="提交时间">{{
          date(entry.created_at)
        }}</el-descriptions-item
        ><el-descriptions-item label="问题描述"
          ><el-text class="feedback-content">{{
            entry.content
          }}</el-text></el-descriptions-item
        ><el-descriptions-item label="处理回复">{{
          entry.reply || "暂无回复"
        }}</el-descriptions-item></el-descriptions
      >
      <div class="feedback-images">
        <el-image
          v-for="image in entry.images"
          :key="image.url"
          :src="image.url"
          :alt="image.name"
          fit="contain"
          :preview-src-list="entry.images.map((item) => item.url)"
          preview-teleported
        />
      </div>
      <el-text type="info"
        >截图链接 15 分钟有效，过期后请关闭并重新查看。</el-text
      >
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { request } from "@/api/request";
import { date } from "@/utils/forms";
type Detail = {
  username: string;
  phone: string;
  created_at: string;
  content: string;
  reply: string;
  images: { name: string; url: string }[];
};
const visible = ref(false),
  loading = ref(false),
  error = ref(""),
  entry = ref<Detail>();
async function open(id: string) {
  visible.value = true;
  loading.value = true;
  error.value = "";
  entry.value = undefined;
  try {
    entry.value = await request<Detail>("/admin/feedback/" + id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "加载失败";
  } finally {
    loading.value = false;
  }
}
defineExpose({ open });
</script>
<style scoped lang="scss">
.feedback-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.feedback-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-block: 16px;
  .el-image {
    height: 160px;
  }
}
</style>
