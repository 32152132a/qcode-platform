import type { Model } from '@/types/models'
export function verificationLabel(model: Model) {
  return model.verification?.status === 'verified'
    ? '流式与工具调用通过'
    : model.verification?.status === 'connected'
      ? '聊天连通，未验证工具'
      : model.verification?.status === 'failed'
        ? '验证失败'
        : '待验证'
}
