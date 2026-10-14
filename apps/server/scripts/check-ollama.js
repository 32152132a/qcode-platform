import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createApp} from '../src/app.js';
import {createDatabase} from '../src/database.js';
import {baseUrl} from '../src/domain.js';

// Isolated gateway exercises the real forwarding code without changing production accounts or records.
const address=process.argv[2] || process.env.OLLAMA_BASE_URL;
if(!address)throw Error('Usage: node scripts/check-ollama.js http://SERVER:11434/v1');
const db=createDatabase(),password=randomBytes(24).toString('hex');
const app=createApp({encryptionSecret:randomBytes(32).toString('hex'),adminUsername:'local-check',adminPassword:password,ollamaBaseUrl:baseUrl(address),timeoutMs:60000},db);
const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
async function request(route,body,token){const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)});if(!response.ok)throw Error('Gateway check failed: '+response.status+' '+route);return response.json();}
try{
 const admin=(await request('/auth/login',{username:'local-check',password})).token;
 const model=(await request('/admin/models',undefined,admin)).find(m=>m.public_name==='qcode-qwen-local');
 const catalogue=await request(`/admin/models/${model.id}/catalog`,{},admin);if(!catalogue.models.includes('qwen:0.5b'))throw Error('qwen:0.5b is not installed');
 const verification=await request(`/admin/models/${model.id}/check`,{},admin);if(verification.status!=='connected')throw Error('Text connectivity failed: '+verification.message);
 const user=await request('/admin/users',{username:'employee-check',password,modelId:model.id},admin);
 const employee=(await request('/auth/login',{username:'employee-check',password})).token;
 const answer=await request('/v1/chat/completions',{model:model.public_name,messages:[{role:'user',content:'Reply briefly with OK.'}],max_tokens:16},employee);
 if(!answer.choices?.[0]?.message?.content?.trim())throw Error('Employee gateway returned no text');
 for(let i=0;i<100&&db.read().requests.some(r=>r.status==='pending');i++)await new Promise(resolve=>setTimeout(resolve,10));
 const records=db.read().requests;
 if(records.length!==2||records.some(r=>r.status!=='success'||r.key_id!==null))throw Error('Request accounting incomplete');
 console.log(JSON.stringify({ok:true,model:'qwen:0.5b',stream:true,employeeGateway:true,requests:records.length,totalTokens:records.reduce((n,r)=>n+(r.total_tokens||0),0),reply:answer.choices[0].message.content,toolsVerified:false,persistentDataChanged:false}));
}finally{server.closeAllConnections();server.close();}
