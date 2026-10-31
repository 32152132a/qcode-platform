export interface UsageGroup extends Record<string, unknown> {
  userId?: number
  modelId?: string
  username?: string
  name?: string
  date?: string
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  unknownUsage: number
  unknownCost: number
  success: number
  failed: number
  pending: number
  costs: Record<string, number>
}
export interface OverviewUsage {
  totals: UsageGroup
  users: UsageGroup[]
  models: UsageGroup[]
  days: UsageGroup[]
  timezone: string
}
