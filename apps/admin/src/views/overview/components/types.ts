export interface UsageGroup {
  userId?: number
  modelId?: string
  username?: string
  name?: string
  date?: string
  requests: number
  tokens: number
  conservativeTokens: number
  chargedTokens: number
  success: number
  failed: number
  pending: number
  costs: Record<string, number>
}
export interface OverviewUsage {
  totals: UsageGroup & { unknownCost: number; unknownUsage: number }
  users: UsageGroup[]
  models: UsageGroup[]
  days: UsageGroup[]
  timezone: string
}
