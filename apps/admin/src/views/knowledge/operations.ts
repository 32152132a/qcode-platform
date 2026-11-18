import {request} from '@/api/request'

export async function knowledgeOperation<T>(url:string,data:unknown,signal:AbortSignal):Promise<T>{
  const result=await request<T&{error?:{message?:string}}>(url,'POST',data,true,{timeout:1000000,signal})
  if(result.error)throw new Error(result.error.message||'知识处理失败，请重试')
  return result
}
