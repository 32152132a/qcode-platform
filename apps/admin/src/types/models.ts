export interface ModelReference {
  contextWindow?: number
  contextSource?: string
  priceSource?: string
  inputPrice?: number
  cachedInputPrice?: number
  outputPrice?: number
  imagePrice?: number
}
export interface ModelSource {
  id: string
  name: string
  kind: 'local' | 'official' | 'relay'
  base_url: string
  key_id: string | null
  fallback_key_ids?: string[]
  protocol: string
  active: boolean
  auto_sync: boolean
  synced_at?: string
  sync_status?: string
  sync_error?: string
  catalog_workspace_id?: string
  catalog_revision?: string
  catalog?: {
    id: string
    supported_endpoint_types?: string[]
    capabilities?: string[]
    reference?: ModelReference
    unavailable_reason?: string | null
  }[]
}
export interface Model {
  model_type?: 'chat' | 'image'
  capabilities?: string[]
  purposes?: ('image_generation' | 'vision')[]
  id: string
  source_id: string
  name: string
  public_name: string
  upstream_model: string
  provider: string
  protocol: string
  active: boolean
  recommended?: boolean
  discovered?: boolean
  catalog_available?: boolean
  is_default: boolean
  context_window: number
  max_output_tokens: number
  input_price: number
  cached_input_price: number
  image_price: number
  reference?: ModelReference
  output_price: number
  currency: string
  max_tokens_field: string
  stream_usage: boolean
  verification?: { status: string; message?: string }
  [key: string]: unknown
}
