import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {once} from 'node:events';
import {createApp} from '../src/app.js';import {createDatabase} from '../src/database.js';import {syncSkills} from '../../client/skills.mjs';
async function fixture(t,database=createDatabase()){
 const config={encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',baseUrl:'http://127.0.0.1:39998/v1',upstreamModel:'test',publicModel:'qcode-model',upstreamKey:'fake-key'};
 const server=http.createServer(createApp(config,database));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const url=`http://127.0.0.1:${server.address().port}`;
 async function request(route,method='GET',body,token){const r=await fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 const admin=(await request('/auth/login','POST',{username:'admin',password:'admin-password'})).body.token;
 for(const [username,role]of [['employee','user'],['operator','operator']])await request('/admin/users','POST',{username,role,password:'user-password'},admin);
 const login=async username=>(await request('/auth/login','POST',{username,password:'user-password'})).body.token;
 return {request,admin,employee:await login('employee'),operator:await login('operator'),db:database};
}
const document={title:'企业部署说明',filename:'部署.md',summary:'网关地址和部署检查规范',content:'# 团队知识\n\n网关通过 Docker 部署。发布之前必须检查服务健康状态。\n\n成员只能使用网关分配的模型。',active:true};
test('knowledge upload searches and syncs readable references; updates and deletes only managed files',async t=>{
 const f=await fixture(t),created=await f.request('/admin/knowledge','POST',document,f.admin);assert.equal(created.status,201);const id=created.body.id;
 assert.equal((await f.request('/admin/skills','GET',undefined,f.admin)).body.length,0);
 const searched=await f.request('/client/knowledge/search?q='+encodeURIComponent('部署检查'),'GET',undefined,f.employee);assert.equal(searched.status,200);assert.equal(searched.body.results[0].documentId,id);assert.match(searched.body.results[0].excerpt,/Docker/);
 const skills=(await f.request('/client/skills','GET',undefined,f.employee)).body.skills;assert.equal(skills.length,1);assert.match(skills[0].files['SKILL.md'],/references\/document.md/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-knowledge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'skills'),{recursive:true});fs.writeFileSync(path.join(root,'skills','personal-note.txt'),'keep');
 await syncSkills(root,skills);const reference=path.join(root,'skills','qcode-'+id,'references','document.md');assert.match(fs.readFileSync(reference,'utf8'),/Docker/);
 const before=(await f.request('/client/config','GET',undefined,f.employee)).body.skillsRevision;
 await f.request('/admin/knowledge/'+id,'PUT',{...document,content:'新版本使用 Docker Compose，检查健康接口后才能发布。'},f.admin);
 const updated=(await f.request('/client/skills','GET',undefined,f.employee)).body.skills;await syncSkills(root,updated);assert.match(fs.readFileSync(reference,'utf8'),/新版本/);
 assert.notEqual((await f.request('/client/config','GET',undefined,f.employee)).body.skillsRevision,before);
 await f.request('/admin/knowledge/'+id,'PUT',{...document,active:false},f.admin);assert.equal((await f.request('/client/skills','GET',undefined,f.employee)).body.skills.length,0);assert.equal((await f.request('/client/knowledge/search?q=Docker','GET',undefined,f.employee)).body.results.length,0);
 assert.equal((await f.request('/admin/knowledge/search?q=Docker','GET',undefined,f.admin)).body.results.length,1);
 await f.request('/admin/knowledge/'+id,'DELETE',undefined,f.admin);await syncSkills(root,[]);assert.equal(fs.existsSync(reference),false);assert.equal(fs.readFileSync(path.join(root,'skills','personal-note.txt'),'utf8'),'keep');assert.ok(f.db.read().audits.some(a=>a.action==='knowledge.delete'));
});
test('knowledge management rejects unauthorized uploads, alternate skill edits, binary and oversized data',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/admin/knowledge','POST',document,f.employee)).status,403);assert.equal((await f.request('/admin/knowledge','POST',document,f.operator)).status,403);assert.equal((await f.request('/client/knowledge/search?q=hello')).status,401);
 for(const changes of [{filename:'../secret.md'},{filename:'image.pdf'},{content:'binary\0text'},{content:'字'.repeat(22000)},{active:'false'},{content:''}])assert.equal((await f.request('/admin/knowledge','POST',{...document,...changes},f.admin)).status,400);
 const created=await f.request('/admin/knowledge','POST',document,f.admin);assert.equal(created.status,201);
 assert.equal((await f.request('/admin/skills/'+created.body.id,'DELETE',undefined,f.operator)).status,404);
 assert.equal((await f.request('/admin/skills/'+created.body.id,'PUT',{name:'bypass',description:'bad',content:'changed'},f.operator)).status,404);
 assert.equal((await f.request('/admin/knowledge/'+created.body.id,'GET',undefined,f.admin)).body.content,document.content);
});
test('knowledge survives SQLite reopen without a new schema or external vector service',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qcode-knowledge-sqlite-'));const file=path.join(root,'knowledge.sqlite');
 const db=createDatabase(file),f=await fixture(t,db);const created=await f.request('/admin/knowledge','POST',document,f.admin);assert.equal(created.status,201);db.close();
 const reopened=createDatabase(file);t.after(()=>{reopened.close();fs.rmSync(root,{recursive:true,force:true});});const row=reopened.read().skills.find(s=>s.id===created.body.id);assert.equal(row.kind,'knowledge');assert.equal(row.files['references/document.md'],document.content);
});
