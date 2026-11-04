<template>
  <el-dialog v-model="visible" :title="user ? '编辑 ' + user.username : '创建用户'" width="740px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="2" :show-btn="false">
      <template #username><el-input v-model="value.username" name="qcode-new-user-name" autocomplete="off" placeholder="请输入新用户账号" maxlength="80" /></template>
      <template #password><el-input v-model="value.password" name="qcode-new-user-password" type="password" autocomplete="new-password" show-password placeholder="请输入初始密码" maxlength="256" /></template>
    </QyqForm>
    <el-text v-if="!plans.length && value.role === 'user'" type="info">暂无启用套餐，使用个人额度配置。</el-text>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QyqForm from '@/components/qyq-form/index.vue'
import { request } from '@/api/request'
import {useAuthStore} from '@/stores/auth'
import {initialUserPassword,quotaFields,quotaValues,quotaBody} from '@/utils/forms'
import type {Row,Field} from '@/types'
const auth=useAuthStore(),visible=ref(false),saving=ref(false),error=ref(''),user=ref<Row>(),value=ref<Row>({}),plans=ref<Row[]>([]),models=ref<Row[]>([])
const form=ref<{validate:()=>Promise<boolean>}>()
const selectedPlan=computed(()=>plans.value.find(plan=>plan.id===value.value.planId))
const modelOptions=computed(()=>{
  const ids=user.value?.plan_model_ids || selectedPlan.value?.model_ids
  if(!user.value && value.value.role==='user' && plans.value.length && !selectedPlan.value)return []
  return models.value.filter(model=>model.active && model.model_type!=='image' && (value.value.role!=='user' || !Array.isArray(ids) || ids.includes(model.id)))
})
const fields=computed(()=>{
  const fields:(Field & {disabled?:boolean})[]=[
    ...(!user.value ? [{prop:'username',label:'账号',type:'custom',required:true},{prop:'password',label:'初始密码（10～256 位）',type:'custom',required:true}] : []),
    ...(!user.value && value.value.role==='user' && plans.value.length ? [{prop:'planId',label:'套餐',type:'select',required:true,options:plans.value.map(plan=>({label:String(plan.name),value:String(plan.id)}))}] : []),
    {prop:'modelId',label:'默认模型',type:'select',options:modelOptions.value.map(model=>({label:String(model.name),value:String(model.id)})),disabled:!user.value && value.value.role==='user' && plans.value.length>0 && !selectedPlan.value},
    {prop:'sessionLimit',label:'登录设备上限',type:'number'},
    ...(!(value.value.role==='user' && (selectedPlan.value || user.value?.plan_id)) ? [{prop:'maxConcurrentRequests',label:'并发请求上限',type:'number'},...quotaFields] : []),
  ]
  if(auth.user?.role==='admin')fields.push({prop:'role',label:'角色',type:'select',required:true,options:[{label:'普通用户',value:'user'},{label:'运维',value:'operator'},{label:'审计员',value:'auditor'},{label:'演示账号',value:'demo'},{label:'管理员',value:'admin'}]})
  return fields.map(field=>({...field,allowSpecialChars:true,clearable:field.prop!=='role'}))
})
let success:(()=>void)|undefined
async function open(row?:Row,onSuccess?:()=>void){
  user.value=row;value.value={...quotaValues(row),username:'',password:initialUserPassword,planId:'',modelId:row?.model_id || '',sessionLimit:row?.session_limit ?? 1,maxConcurrentRequests:row?.max_concurrent_requests ?? 1,role:row?.role || 'user'}
  error.value='';success=onSuccess;visible.value=true;saving.value=true
  try{const options=await request<{plans:Row[];models:Row[]}>('/admin/users/options');plans.value=options.plans;models.value=options.models}
  catch(cause){error.value=cause instanceof Error?cause.message:'加载失败'}finally{saving.value=false}
}
async function save(){
  if(saving.value)return
  try{
    if(!await form.value?.validate())return
    saving.value=true;error.value=''
    const body:Row={modelId:value.value.modelId || null}
    if(!user.value || Number(value.value.sessionLimit)!==user.value.session_limit)body.sessionLimit=Number(value.value.sessionLimit)
    if(auth.user?.role==='admin')body.role=value.value.role
    if(!(value.value.role==='user' && (selectedPlan.value || user.value?.plan_id))){body.quotas=quotaBody(value.value);body.maxConcurrentRequests=Number(value.value.maxConcurrentRequests)}
    if(!user.value){body.username=value.value.username;body.password=value.value.password;body.planId=value.value.role==='user' ? value.value.planId || null : null}
    await request('/admin/users'+(user.value?'/'+user.value.id:''),user.value?'PATCH':'POST',body)
    visible.value=false;value.value={};success?.()
  }catch(cause){error.value=cause instanceof Error?cause.message:'请检查表单内容'}finally{saving.value=false}
}
watch(()=>value.value.planId,()=>{if(!user.value)value.value.modelId=''}, {flush:'sync'})
defineExpose({open})
</script>
