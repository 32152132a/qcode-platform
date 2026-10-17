<template>
  <el-result icon="warning" title="404" sub-title="抱歉，您访问的页面不存在">
    <template #extra
      ><el-space wrap
        ><el-button type="primary" @click="router.replace('/')">返回首页</el-button
        ><el-button @click="goBack">返回上一页</el-button></el-space
      ></template
    >
  </el-result>
</template>
<script setup lang="ts">
  import { useRouter } from 'vue-router'
  const router = useRouter()
  function goBack() {
    if (window.history.state?.back) router.back()
    else void router.replace('/')
  }
</script>
