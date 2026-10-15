<template>
  <div class="card-title-container">
    <h3 class="card-title" :style="titleStyle">
      <div class="title-line"></div>
      {{ title }}
      <el-tooltip v-if="titleTip" :content="titleTip" placement="top">
        <span class="title-tip">(?)</span>
      </el-tooltip>
    </h3>
    <div class="title-actions">
      <slot name="cardTitleInfo"></slot>
      <slot name="btn"></slot>
    </div>
  </div>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    /**
     * 标题文本
     */
    title: {
      type: String,
      required: true,
    },
    /**
     * 标题提示信息
     */
    titleTip: {
      type: String,
      default: '',
    },
    /**
     * 标题字体粗细
     */
    fontWeight: {
      type: [String, Number],
      default: 'bold',
    },
    /**
     * 标题大小
     */
    size: {
      type: Number,
      default: 16,
    },
  })

  const titleStyle = computed(() => {
    return {
      fontSize: `${props.size}px`,
      fontWeight: props.fontWeight,
    }
  })
</script>

<style scoped>
  .card-title-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding: 0 0 12px 0;
    border-bottom: 1px solid #ebeef5;
  }

  .card-title {
    display: flex;
    align-items: center;
    margin: 0;
    color: #303133;
    line-height: 1.4;
  }

  .title-line {
    width: 3px;
    height: 16px;
    background-color: var(--el-color-primary, #409eff);
    margin-right: 8px;
    border-radius: 2px;
  }

  .title-tip {
    font-size: 12px;
    margin-left: 6px;
    color: #909399;
    cursor: help;
  }

  .title-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
</style>
