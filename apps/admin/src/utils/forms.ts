export const initialUserPassword = 'Qcode@2026'

import { ElMessageBox } from 'element-plus'
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
