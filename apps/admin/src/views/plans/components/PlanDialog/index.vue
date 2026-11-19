<template>
  <el-dialog v-model="visible" :title="plan ? '编辑套餐（仅影响后续开通）' : '创建套餐'" width="740px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="2" :show-btn="false">
      <template #modelIds>
        <el-button :disabled="saving" @click="openModelPicker">已选 {{ selectedModelCount }} 个模型</el-button>
      </template>
    </QyqForm>
    <el-dialog v-model="modelPickerOpen" title="选择与排序模型" width="min(560px, 92vw)"
      append-to-body :close-on-click-modal="false" @closed="draggedModel = undefined">
    <el-select v-model="modelOrder" multiple filterable placeholder="选择对话模型" aria-label="选择对话模型" style="width: 100%">
      <el-option v-for="model in modelOptions" :key="model.value" :label="model.label" :value="model.value" />
    </el-select>
    <p v-if="modelOrder.length" class="model-order-hint">拖动调整顺序，首项为默认模型</p>
    <ol v-if="modelOrder.length" class="model-order" aria-label="套餐模型顺序">
      <li v-for="(id, index) in modelOrder" :key="id" draggable="true" tabindex="0"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="也可用 Alt + ↑ / ↓ 调整顺序"
        @keydown.alt.up.prevent="moveModel(id, index - 1)"
        @keydown.alt.down.prevent="moveModel(id, index + 1)"
        @dragstart="startDrag($event, id)" @dragend="draggedModel = undefined"
        @dragover.prevent @drop.prevent="dropModel(index)">
        <span class="drag-handle" aria-hidden="true">⠿</span>
        <span>{{ modelNames.get(id) || id }}{{ index === 0 ? '（默认）' : '' }}</span>
      </li>
    </ol>
    <template #footer>
      <el-button @click="modelPickerOpen = false">取消</el-button>
      <el-button type="primary" @click="confirmModelPicker">确定</el-button>
    </template>
    </el-dialog>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import QyqForm from '@/components/qyq-form/index.vue'
import { request } from '@/api/request'
import { yesNo } from '@/utils/forms'
import type { Row, Field } from '@/types'
const visible=ref(false),saving=ref(false),error=ref(''),plan=ref<Row>(),value=ref<Row>({}),fields=ref<Field[]>([])
const form=ref<{validate:()=>Promise<boolean>}>()
const modelNames = ref(new Map<string, string>())
const modelOptions = ref<{ label: string; value: string }[]>([])
const modelPickerOpen = ref(false)
const modelOrder = ref<string[]>([])
const selectedModelCount = computed(() => Array.isArray(value.value.modelIds) ? value.value.modelIds.length : 0)
const draggedModel = ref<string>()
function openModelPicker() {
  modelOrder.value = Array.isArray(value.value.modelIds) ? value.value.modelIds.map(String) : []
  modelPickerOpen.value = true
}
function confirmModelPicker() {
  value.value.modelIds = [...modelOrder.value]
  modelPickerOpen.value = false
}
function startDrag(event: DragEvent, id: string) {
  draggedModel.value = id
  event.dataTransfer?.setData('text/plain', id)
}
function moveModel(id: string, index: number) {
  const order = [...modelOrder.value]
  const from = order.indexOf(id)
  if (from < 0 || index < 0 || index >= order.length) return
  order.splice(from, 1)
  order.splice(index, 0, id)
  modelOrder.value = order
}
function dropModel(index: number) {
  if (draggedModel.value) moveModel(draggedModel.value, index)
  draggedModel.value = undefined
}
let success:(()=>void)|undefined
async function open(row?:Row,onSuccess?:()=>void){
  plan.value=row;success=onSuccess;error.value='';visible.value=true;saving.value=true
  value.value={name:row?.name || '',level:row?.level ?? 0,isDefault:String(row?.is_default ?? false),price:Number(row?.price_cents || 0)/100,durationDays:row?.duration_days ?? 30,creditAmount:row?Number(row.credit_limit_micros)/1_000_000:5,modelIds:row?.model_ids || [],active:String(row?.active ?? true),description:row?.description || ''}
  try{
    const models=await request<Row[]>('/admin/models')
    const options = models.filter(model => model.model_type !== 'image' && !(Array.isArray(model.capabilities) && model.capabilities.includes('embedding')))
      .map(model => ({ label: String(model.name), value: String(model.id) }))
    modelNames.value = new Map(options.map(model => [model.value, model.label]))
    const activeIds = new Set(models.filter(model => model.active === true).map(model => String(model.id)))
    modelOptions.value = options.filter(option => activeIds.has(option.value) || (Array.isArray(value.value.modelIds) && value.value.modelIds.includes(option.value)))
    fields.value=[
      {prop:'name',label:'套餐名称',type:'input',required:true,maxlength:40},
      {prop:'level',label:'升级等级（越大越高级）',type:'number',required:true,min:0,max:1000,precision:0},
      {prop:'price',label:'价格（元）',type:'number',required:true,min:0,max:1000000,precision:2},
      {prop:'durationDays',label:'有效天数',type:'number',required:true,min:1,max:366,precision:0},
      {prop:'creditAmount',label:'使用额度（积分）',type:'money',required:true,min:0,max:1_000_000,precision:6},
      {prop:'isDefault',label:'新用户默认套餐',type:'select',options:yesNo},
      {prop:'modelIds',label:'可选对话模型',type:'slot'},
      {prop:'active',label:'上架',type:'select',options:yesNo},
      {prop:'description',label:'套餐说明（选填）',type:'textarea',maxlength:400,autosize:{minRows:3,maxRows:6},style:{gridColumn:'1 / -1'}},
    ].map(field=>({...field,allowSpecialChars:true}))
  }catch(cause){error.value=cause instanceof Error?cause.message:'加载失败'}finally{saving.value=false}
}
async function save(){
  if(saving.value)return
  try{
    if(!await form.value?.validate())return
    saving.value=true;error.value=''
    await request('/admin/plans'+(plan.value?'/'+plan.value.id:''),plan.value?'PUT':'POST',{...value.value,creditAmount:Number(value.value.creditAmount),isDefault:value.value.isDefault==='true',active:value.value.active==='true'})
    visible.value=false;value.value={};success?.()
  }catch(cause){error.value=cause instanceof Error?cause.message:'保存失败'}finally{saving.value=false}
}
defineExpose({open})
</script>
<style scoped>
.model-order-hint { color: var(--el-text-color-secondary); }
.model-order { margin: 0; padding: 0; list-style: none; }
.model-order li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: grab;
}
.model-order span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.model-order .drag-handle { flex: none; color: var(--el-text-color-secondary); }
</style>
