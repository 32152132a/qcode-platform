<template>
  <el-dialog v-model="visible" :title="plan ? '编辑套餐（仅影响后续开通）' : '创建套餐'" width="740px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="2" :show-btn="false">
      <template #tokenLimit>
        <el-space wrap><el-switch v-model="unlimited" active-text="不限额 ∞" /><el-input-number v-if="!unlimited" v-model="value.tokenLimit" :min="0" :max="Number.MAX_SAFE_INTEGER" :precision="0" aria-label="总 Token 额度" /></el-space>
      </template>
    </QyqForm>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import QyqForm from '@/components/qyq-form/index.vue'
import { request } from '@/api/request'
import { yesNo } from '@/utils/forms'
import type { Row, Field } from '@/types'
const visible=ref(false),saving=ref(false),error=ref(''),unlimited=ref(false),plan=ref<Row>(),value=ref<Row>({}),fields=ref<Field[]>([])
const form=ref<{validate:()=>Promise<boolean>}>()
let success:(()=>void)|undefined
async function open(row?:Row,onSuccess?:()=>void){
  plan.value=row;success=onSuccess;error.value='';visible.value=true;saving.value=true
  unlimited.value=row?.token_limit===null
  value.value={name:row?.name || '',level:row?.level ?? 0,isDefault:String(row?.is_default ?? false),price:Number(row?.price_cents || 0)/100,durationDays:row?.duration_days ?? 30,tokenLimit:row?.token_limit ?? 100000,modelIds:row?.model_ids || [],active:String(row?.active ?? true),description:row?.description || ''}
  try{
    const models=await request<Row[]>('/admin/models')
    fields.value=[
      {prop:'name',label:'套餐名称',type:'input',required:true,maxlength:40},
      {prop:'level',label:'升级等级（越大越高级）',type:'number',required:true,min:0,max:1000,precision:0},
      {prop:'price',label:'价格（元）',type:'number',required:true,min:0,max:1000000,precision:2},
      {prop:'durationDays',label:'有效天数',type:'number',required:true,min:1,max:366,precision:0},
      {prop:'tokenLimit',label:'总 Token 额度',type:'custom'},
      {prop:'isDefault',label:'新用户默认套餐',type:'select',options:yesNo},
      {prop:'modelIds',label:'可选对话模型',type:'select',multiple:true,options:models.filter(model=>model.model_type!=='image').map(model=>({label:String(model.name),value:String(model.id)}))},
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
    await request('/admin/plans'+(plan.value?'/'+plan.value.id:''),plan.value?'PUT':'POST',{...value.value,tokenLimit:unlimited.value?null:value.value.tokenLimit,isDefault:value.value.isDefault==='true',active:value.value.active==='true'})
    visible.value=false;value.value={};success?.()
  }catch(cause){error.value=cause instanceof Error?cause.message:'保存失败'}finally{saving.value=false}
}
defineExpose({open})
</script>
