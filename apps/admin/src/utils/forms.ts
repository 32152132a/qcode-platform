import { ElMessageBox } from 'element-plus'
import type { Field, Row } from '@/types'
export const quotaLabels: Record<string, string> = {
  totalTokens: '总 Token 额度',
  totalRequests: '总请求额度',
  dailyTokens: '每日 Token',
  dailyRequests: '每日请求',
  monthlyTokens: '每月 Token',
  monthlyRequests: '每月请求',
}
export const quotaFields: Field[] = Object.entries(quotaLabels).map(([prop, label]) => ({
  prop,
  label: label + '（0 不限）',
  type: 'number',
}))
export function quotaValues(row: Row = {}, key = 'quotas') {
  const limits = row[key] as Record<string, number> | undefined
  return Object.fromEntries(Object.keys(quotaLabels).map((name) => [name, limits?.[name] || 0]))
}
export const quotaBody = (value: Row) =>
  Object.fromEntries(Object.keys(quotaLabels).map((name) => [name, Number(value[name] || 0)]))
export const date = (value: unknown) => (value ? new Date(String(value)).toLocaleString() : '—')
export const yesNo = [
  { label: '开启', value: 'true' },
  { label: '关闭', value: 'false' },
]
export async function confirmAction(
  message: string,
  action: () => Promise<unknown>,
  success?: () => void
) {
  try {
    await ElMessageBox.confirm(message, '确认操作', { type: 'warning' })
  } catch {
    return
  }
  await action()
  success?.()
}
