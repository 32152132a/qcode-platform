export interface ModelSource {
  id: string
  name: string
  kind: 'local' | 'official' | 'relay'
  base_url: string
  key_id: string | null
  protocol: string
  active: boolean
  auto_sync: boolean
  synced_at?: string
  sync_status?: string
  sync_error?: string
  catalog?: { id: string }[]
}
export interface Model {
  id: string
  source_id: string
  name: string
  public_name: string
  upstream_model: string
  provider: string
  protocol: string
  active: boolean
  catalog_available?: boolean
  is_default: boolean
  context_window: number
  max_output_tokens: number
  input_price: number
  output_price: number
  currency: string
  max_tokens_field: string
  stream_usage: boolean
  verification?: { status: string; message?: string }
  [key: string]: unknown
}
