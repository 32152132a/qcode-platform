<template>
  <el-dialog v-model="visible" :title="'重置 ' + user?.username + ' 的密码'" width="520px" :close-on-click-modal="false" destroy-on-close>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form label-position="top" @submit.prevent="save"><el-form-item label="新密码（10～256 位）"><el-input v-model="password" name="qcode-reset-user-password" type="password" autocomplete="new-password" show-password maxlength="256" /></el-form-item></el-form>
    <el-text type="info">重置后该用户所有设备需要重新登录。</el-text>
    <template #footer><el-button :disabled="saving" @click="visible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">确认重置</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import {request} from '@/api/request'
import {initialUserPassword} from '@/utils/forms'
import type {Row} from '@/types'
const visible=ref(false),saving=ref(false),error=ref(''),password=ref(initialUserPassword),user=ref<Row>()
let success:(()=>void)|undefined
function open(row:Row,onSuccess?:()=>void){user.value=row;password.value=initialUserPassword;error.value='';success=onSuccess;visible.value=true}
async function save(){
 if(saving.value || !user.value)return
 if(password.value.length<10 || password.value.length>256){error.value='密码须为 10～256 个字符';return}
 saving.value=true;error.value=''
 try{await request('/admin/users/'+user.value.id+'/password','POST',{password:password.value});password.value='';visible.value=false;success?.()}
 catch(cause){error.value=cause instanceof Error?cause.message:'重置密码失败'}finally{saving.value=false}
}
defineExpose({open})
</script>
