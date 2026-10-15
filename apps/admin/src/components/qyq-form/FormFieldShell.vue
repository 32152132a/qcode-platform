<template>
  <el-form-item
    :label="`${item.label}${showColon ? ':' : ''}`"
    :prop="item.prop"
    :style="item.style"
    :required="item.required"
  >
    <el-tooltip
      effect="light"
      :trigger-keys="[]"
      :disabled="(item.placeholder || item.label)?.length <= 20"
      :content="item.placeholder || item.label"
      placement="bottom"
    >
      <div class="form-item">
        <slot></slot>

        <div v-if="item.unit || item.tip" class="form-item-prop">
          <span v-if="item.unit" class="form-item-prop-unit">{{ item.unit }}</span>
          <div v-if="item.tip" class="form-item-prop-tip">
            <slot v-if="item.tip?.prop" name="tip"></slot>
            <el-tooltip v-else :content="item.tip?.content || item.tip" effect="light">
              <div class="form-item-prop-tip-tooltip">
                <el-icon class="form-item-prop-tip-tooltip-icon">
                  <QuestionFilled />
                </el-icon>
                <div v-if="item.tip?.text" class="form-item-prop-tip-tooltip-text">
                  {{ item.tip?.text }}
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <div v-if="item.hint?.text || item.hint" :style="item.hint?.style" class="form-item-hint">
          <slot v-if="item.hint?.prop" name="hint"></slot>
          <span v-else class="form-item-hint-text">
            {{ item.hint?.text || item.hint }}
          </span>
        </div>
      </div>
    </el-tooltip>
  </el-form-item>
</template>

<script setup>
  import { QuestionFilled } from '@element-plus/icons-vue'

  defineProps({
    item: {
      type: Object,
      default: () => ({}),
    },
    showColon: {
      type: Boolean,
      default: false,
    },
  })
</script>

<style lang="scss" scoped>
  .form-item {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px;
    position: relative;

    :deep(.el-input),
    :deep(.el-select),
    :deep(.el-cascader),
    :deep(.el-date-editor),
    :deep(.el-input-number),
    :deep(.el-autocomplete),
    :deep(.search-select) {
      width: 100%;
    }

    &-prop {
      display: inline-flex;
      align-items: center;
      width: fit-content;

      &-tip {
        display: inline-block;

        &-tooltip {
          margin-left: 4px;
          color: var(--el-color-primary);
          display: flex;
          justify-content: flex-start;
          align-items: center;

          &-icon {
            color: var(--el-color-primary);
            font-size: 20px;
            display: flex;
            align-items: center;
            transform: translateY(-1px);
          }

          &-text {
            margin-left: 4px;
            cursor: pointer;
          }
        }
      }

      &-unit {
        transform: translateY(-1px);
      }
    }

    &-hint {
      grid-row: 2/3;
      grid-column: 1/3;
      line-height: initial;

      &-text {
        display: grid;
        grid-template-columns: 1fr;
        align-items: center;
        font-size: 12px;
        line-height: 1.5;
        padding: 4px;
        background-color: var(--el-color-primary-light-9);
        border-radius: 4px;
        margin-top: 6px;
        color: #666;
      }
    }
  }
</style>
