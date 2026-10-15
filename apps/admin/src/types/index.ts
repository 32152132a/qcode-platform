export interface User {
  id: number
  username: string
  role: string
  permissions: string[]
  [key: string]: unknown
}
export interface Session {
  token: string
  refreshToken: string
  user: User
}
export type Row = Record<string, unknown>
export interface Column {
  prop: string
  label: string
  minWidth?: number
  render?: (row: Row) => string
}
export interface Field {
  prop: string
  label: string
  type?: string
  required?: boolean
  options?: { label: string; value: string | number }[]
  multiple?: boolean
  hint?: string
  props?: Record<string, unknown>
}
export interface EditorData {
  title: string
  fields: Field[]
  value: Row
  save: (value: Row) => Promise<unknown>
}
