<template>
  <el-dialog v-model="visible" :title="user ? '编辑 ' + user.username : '创建用户'" width="740px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <QyqForm ref="form" v-model="value" :form-options="fields" :columns="2" :show-btn="false">
      <template #username><el-input v-model="value.username" name="qcode-new-user-name" autocomplete="off" placeholder="请输入新用户账号" maxlength="80" /></template>
      <template #password><el-input v-model="value.password" name="qcode-new-user-password" type="password" autocomplete="new-password" show-password placeholder="请输入初始密码" maxlength="256" /></template>
    </QyqForm>
    <el-text v-if="!user && !plans.length" type="info">暂无启用套餐，请先在套餐管理中创建套餐。</el-text>
    <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import QyqForm from '@/components/qyq-form/index.vue'
import { request } from '@/api/request'
import {initialUserPassword} from '@/utils/forms'
import type {Row,Field} from '@/types'
const visible=ref(false),saving=ref(false),error=ref(''),user=ref<Row>(),value=ref<Row>({}),plans=ref<Row[]>([])
const form=ref<{validate:()=>Promise<boolean>}>()
const fields=computed(()=>{
  const fields:(Field & {disabled?:boolean})[]=[
    ...(!user.value ? [{prop:'username',label:'账号',type:'custom',required:true},{prop:'password',label:'初始密码（10～256 位）',type:'custom',required:true}] : []),
    ...(!user.value ? [{prop:'planId',label:'套餐',type:'select',required:true,options:plans.value.map(plan=>({label:String(plan.name),value:String(plan.id)}))}] : []),
    {prop:'sessionLimit',label:'登录设备上限',type:'number'},
  ]
  return fields.map(field=>({...field,allowSpecialChars:true,clearable:true}))
})
let success:(()=>void)|undefined
async function open(row?:Row,onSuccess?:()=>void){
  user.value=row;value.value={username:'',password:initialUserPassword,planId:'',sessionLimit:row?.session_limit ?? 1}
  error.value='';success=onSuccess;visible.value=true;saving.value=true
  try{const options=await request<{plans:Row[]}>('/admin/users/options');plans.value=options.plans}
  catch(cause){error.value=cause instanceof Error?cause.message:'加载失败'}finally{saving.value=false}
}
async function save(){
  if(saving.value)return
  try{
    if(!user.value && !plans.value.length){error.value='请先创建并启用套餐';return}
    if(!await form.value?.validate())return
    saving.value=true;error.value=''
    const body:Row={}
    if(!user.value || Number(value.value.sessionLimit)!==user.value.session_limit)body.sessionLimit=Number(value.value.sessionLimit)
    if(!user.value){body.username=value.value.username;body.password=value.value.password;body.planId=value.value.planId}
    await request('/admin/users'+(user.value?'/'+user.value.id:''),user.value?'PATCH':'POST',body)
    visible.value=false;value.value={};success?.()
  }catch(cause){error.value=cause instanceof Error?cause.message:'请检查表单内容'}finally{saving.value=false}
}
defineExpose({open})
</script>
