import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { createDatabase, hashPassword } from '../src/database.js';
import { createTreeStore } from '../src/knowledge-tree-store.js';
import { parseKnowledgeFile } from '../src/knowledge-parser.js';
import { splitKnowledge, knowledgeCatalogue, readKnowledgeNodes, planKnowledgeChanges } from '../src/knowledge-tree.js';

async function fixture(t,{plan}={}){
 const db=createDatabase(),outbound=[];
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);outbound.push(data);let content='收到';try{const nodes=JSON.parse(data.messages.at(-1).content);content=JSON.stringify(Array.isArray(nodes)?{nodes:nodes.map(node=>({id:node.id,summary:node.title.slice(0,50)+'：参考原文'}))}:plan?plan(data.messages):{action:'finish',changes:[]});}catch{}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));});
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const app=createApp({encryptionSecret:'a'.repeat(64),adminUsername:'admin',adminPassword:'admin-password',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,upstreamModel:'test',upstreamKey:'fake-key',publicModel:'qcode-model'},db);
 db.transaction(state=>{state.settings.knowledge={sourceId:state.settings.modelSources[0].id,model:'test'};for(const username of ['alice','bob'])state.users.push({id:state.nextUserId++,username,password_hash:hashPassword('user-password'),role:'user',is_active:1,session_limit:2,quotas:{},created_at:new Date().toISOString()});});
 const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await app.locals.knowledge.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));db.close();});
 async function request(route,body={},token){const response=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
 const login=async(username,password)=>(await request('/auth/login',{username,password})).body.token;
 return{request,db,outbound,knowledge:app.locals.knowledge,admin:await login('admin','admin-password'),alice:await login('alice','user-password'),bob:await login('bob','user-password')};
}
const document={title:'住宿制度',filename:'住宿.md',data:Buffer.from('# 住宿制度\n适用于2026年普通员工。\n## 上海住宿\n上海每晚520元，需住宿发票。').toString('base64')};

test('enterprise publication and private documents use server ACL at every read',async t=>{
 const f=await fixture(t),shared=await f.request('/admin/knowledge/upload',document,f.admin);assert.equal(shared.status,202);await f.knowledge.idle();
 const id=shared.body.id,detail=await f.request('/admin/knowledge/'+id+'/detail',{},f.admin);assert.equal(detail.body.status,'ready');assert.equal(detail.body.published,false);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,0);
 assert.equal((await f.request('/admin/knowledge/'+id+'/publish',{revision:detail.body.draft_revision},f.admin)).status,200);
 const catalogue=(await f.request('/client/knowledge/catalogue',{},f.alice)).body;assert.equal(catalogue.documents.length,1);
 const node=detail.body.nodes.find(node=>node.title==='上海住宿');
 const read=await f.request('/client/knowledge/read',{ids:[node.id]},f.alice);assert.equal(read.status,200);assert.equal(read.body.nodes.length,2);assert.ok(read.body.nodes.some(node=>node.text.includes('适用于2026')));
 const personal=await f.request('/client/knowledge/upload',{...document,title:'个人资料'},f.alice);assert.equal(personal.status,202);await f.knowledge.idle();
 const owned=(await f.request('/client/knowledge/'+personal.body.id+'/download',{},f.alice)).body.document;
 for(const [route,body]of [[`/client/knowledge/${owned.id}/download`,{}],[`/client/knowledge/${owned.id}/delete`,{}],[`/client/knowledge/${owned.id}/received`,{revision:owned.revision}],['/client/knowledge/read',{ids:[owned.nodes[0].id]}]])assert.equal((await f.request(route,body,f.bob)).status,404);
 assert.equal((await f.request('/admin/knowledge/'+owned.id+'/detail',{},f.admin)).status,404);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.bob)).body.documents.length,1);
 const skills=(await f.request('/client/skills',{},f.alice)).body.skills;
 assert.equal(skills.filter(skill=>skill.name==='qcode-knowledge').length,1);assert.ok(skills.every(skill=>!Object.values(skill.files).some(text=>text.includes('上海每晚520元'))));
 await f.request('/admin/knowledge/'+id+'/unpublish',{},f.admin);assert.equal((await f.request('/client/knowledge/read',{ids:[node.id]},f.alice)).status,404);
});
test('new revisions retain published evidence until release; deletion removes access',async t=>{
 const f=await fixture(t);const uploaded=(await f.request('/admin/knowledge/upload',document,f.admin)).body;await f.knowledge.idle();
 const old=f.knowledge.store.detail(0,uploaded.id);f.knowledge.store.publish(0,old.id,old.draft_revision);
 await f.request('/admin/knowledge/upload',{...document,id:old.id,data:Buffer.from('# 新制度\n上海每晚600元。').toString('base64')},f.admin);await f.knowledge.idle();
 assert.ok(f.knowledge.store.published(2,old.id).nodes.some(node=>node.text.includes('520')));
 const next=f.knowledge.store.detail(0,old.id);assert.notEqual(next.draft_revision,old.draft_revision);
 f.knowledge.store.edit(0,next.id,{revision:next.draft_revision,nodeId:next.nodes[0].id,title:'新制度',summary:'2026年新住宿制度'});
 f.knowledge.store.publish(0,next.id,next.draft_revision);
 assert.equal((await f.request('/client/knowledge/read',{ids:[old.nodes[0].id]},f.alice)).status,404);
 const original=(await f.request('/admin/knowledge/'+old.id+'/original',{revision:old.draft_revision},f.admin)).body;assert.match(Buffer.from(original.data,'base64').toString(),/520/);
 await f.request('/admin/knowledge/'+old.id+'/delete',{},f.admin);assert.equal((await f.request('/client/knowledge/shared/'+old.id+'/detail',{},f.alice)).status,404);
});
test('personal results remain server-side until a matching download acknowledgement; cloud memory is absent',async t=>{
 const f=await fixture(t),uploaded=(await f.request('/client/knowledge/upload',document,f.alice)).body;await f.knowledge.idle();
 const bundle=await f.request('/client/knowledge/'+uploaded.id+'/download',{},f.alice);assert.equal(bundle.status,200);assert.match(Buffer.from(bundle.body.original.data,'base64').toString(),/520/);assert.match(bundle.body.checksum,/^[a-f0-9]{64}$/);
 assert.equal((await f.request('/client/knowledge/list',{},f.alice)).body.documents.length,1);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,0);
 assert.equal((await f.request('/client/knowledge/'+uploaded.id+'/received',{revision:'wrong'},f.alice)).status,409);
 assert.equal((await f.request('/client/knowledge/'+uploaded.id+'/download',{},f.alice)).status,200);
 assert.equal((await f.request('/client/knowledge/'+uploaded.id+'/received',{revision:bundle.body.document.revision},f.alice)).status,200);
 assert.equal((await f.request('/client/knowledge/list',{},f.alice)).body.documents.length,0);
 assert.equal((await f.request('/client/knowledge/'+uploaded.id+'/download',{},f.alice)).status,404);
 assert.equal((await f.request('/client/knowledge/memory/detail',{},f.alice)).status,404);
 assert.equal((await f.request('/client/knowledge/memory/update',{content:'secret'},f.alice)).status,404);
});
test('reused numeric account IDs cannot inherit personal processing jobs',async t=>{
 const f=await fixture(t);
 const uploaded=(await f.request('/client/knowledge/upload',document,f.alice)).body;await f.knowledge.idle();
 f.db.transaction(state=>{state.users.find(user=>user.username==='alice').created_at='2030-01-01T00:00:00.000Z';});
 assert.equal((await f.request('/client/knowledge/'+uploaded.id+'/download',{},f.alice)).status,404);
});
test('invalid files and failures are explicit and retryable',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/admin/knowledge/upload',document,f.alice)).status,403);
 for(const body of [{...document,filename:'../secret.md'},{...document,data:'not base64!'},{...document,filename:'test.doc'}])assert.equal((await f.request('/client/knowledge/upload',body,f.alice)).status,400);
 const row=(await f.request('/client/knowledge/upload',{...document,data:Buffer.from('bad\0text').toString('base64')},f.alice)).body;await f.knowledge.idle();
 const failed=(await f.request('/client/knowledge/list',{},f.alice)).body.documents.find(item=>item.id===row.id);assert.equal(failed.status,'failed');assert.ok(failed.error);assert.equal(failed.published,false);
 assert.equal((await f.request('/client/knowledge/'+row.id+'/retry',{},f.bob)).status,404);
});
test('temporary personal jobs survive reopen until delivery is acknowledged',()=>{
 const root=mkdtempSync(join(tmpdir(),'qcode-tree-')),file=join(root,'knowledge.sqlite');let store=createTreeStore(file);
 try{const row=store.upload(2,{title:'个人',filename:'a.md',bytes:Buffer.from('# 正文\n资料')});store.complete(row.id,row.draft_revision,[{id:'node',text:'资料',title:'正文',summary:'资料',parentId:null}]);store.close();store=createTreeStore(file);assert.equal(store.catalogue(2).length,0);assert.equal(store.list(2).length,1);assert.equal(store.download(2,row.id).document.nodes.length,1);store.received(2,row.id,row.draft_revision);assert.equal(store.list(2).length,0);}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('XLSX parsing retains sheet, addresses and cached text; source blocks preserve long sections',async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('标准');sheet.addRow(['城市','住宿上限']);sheet.addRow(['上海',520]);
 const blocks=await parseKnowledgeFile('标准.xlsx',Buffer.from(await workbook.xlsx.writeBuffer()));assert.equal(blocks[0].source.sheet,'标准');assert.match(blocks[0].text,/B2: 520/);
 const nodes=splitKnowledge([{title:'规则',level:1,text:'适用条件\n\n'+'正文说明。'.repeat(400)+'\n\n结束',source:{page:2}}],'doc','revision');assert.ok(nodes.length>1);assert.ok(nodes.every(node=>node.source.page===2));
 const documents=[{id:'doc',title:'规则',scope:'personal',revision:'revision',filename:'a.md',nodes}];assert.ok(readKnowledgeNodes(documents,[nodes.at(-1).id]).nodes.some(node=>node.text.includes('适用条件')));
 const many=Array.from({length:40},(_,i)=>({id:'d'+i,title:'文档'+i,scope:'enterprise',revision:'r',nodes:Array.from({length:8},(_,j)=>({id:`${i}:${j}`,parentId:null,title:'章节'+j,summary:'知识摘要'.repeat(20)}))}));
 const result=knowledgeCatalogue(many);assert.equal(result.mode,'children');assert.ok(result.nextCursor);assert.equal(knowledgeCatalogue(many,{cursor:result.nextCursor}).items[0].id,'d'+result.nextCursor);
});
function pdfFixture(text){
 const stream=text===null?'0 0 50 50 re f':`BT /F1 12 Tf 20 80 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let value='%PDF-1.4\n';const offsets=[0];for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(value));value+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const position=Buffer.byteLength(value);value+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`;
 return Buffer.from(value);
}
test('PDF text is page referenced; image-only PDFs fail explicitly; DOCX extraction reads complete paragraphs',async()=>{
 const pdf=await parseKnowledgeFile('policy.pdf',pdfFixture('Budget 520'));assert.equal(pdf[0].source.page,1);assert.match(pdf[0].text,/Budget 520/);
 await assert.rejects(parseKnowledgeFile('scan.pdf',pdfFixture(null)),/没有可提取的文字/);
 const bytes=readFileSync(new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx',import.meta.url));
 const docx=await parseKnowledgeFile('sample.docx',bytes);assert.ok(docx.some(block=>block.text.trim()));assert.equal(docx[0].source.format,'docx');
});

function readyDocument(store,title,body){
 const row=store.upload(0,{title,filename:title+'.md',bytes:Buffer.from(body)});
 const nodes=splitKnowledge([{title,level:1,text:body,source:{lineStart:1,lineEnd:2}}],row.id,row.draft_revision).map(node=>({...node,summary:title}));
 store.complete(row.id,row.draft_revision,nodes);
 return store.detail(0,row.id);
}
const updateDraft=(target,source)=>({operation:'update',documentId:target.id,documentTitle:target.title,baseRevision:target.draft_revision,nodeId:target.nodes[0].id,parentId:null,before:{title:target.nodes[0].title,summary:target.nodes[0].summary,text:target.nodes[0].text},title:target.title,summary:'2027年适用新标准，保留2026年旧标准',text:target.nodes[0].text+'\n\n2027年起上海住宿上限600元。',sourceNodeIds:[source.nodes[0].id],reason:'新通知补充2027年的标准'});

test('incremental planner reads evidence before proposing changes and rejects unread or foreign targets',async()=>{
 const store=createTreeStore();
 try{
  const target=readyDocument(store,'差旅制度','2026年住宿上限520元。');store.publish(0,target.id,target.draft_revision);
  const source=readyDocument(store,'新通知','2027年住宿上限600元。'),change=updateDraft(target,source);
  const docs=store.catalogue(0).filter(doc=>doc.id===target.id),messages=[];
  const actions=[{action:'read',ids:[target.nodes[0].id]},{action:'finish',changes:[change]}];
  const plan=await planKnowledgeChanges(docs,source.nodes,async input=>{messages.push(structuredClone(input));return JSON.stringify(actions.shift());});
  assert.equal(plan.length,1);assert.match(messages[1].at(-1).content,/520元/);assert.equal(plan[0].before.text,target.nodes[0].text);
  await assert.rejects(planKnowledgeChanges(docs,source.nodes,async()=>JSON.stringify({action:'finish',changes:[change]})),/未读取/);
  const foreign={...change,documentId:'f'.repeat(32)};
  await assert.rejects(planKnowledgeChanges(docs,source.nodes,async()=>JSON.stringify({action:'finish',changes:[foreign]})),/无权限/);
  const append={...change,operation:'add',nodeId:undefined,parentId:target.nodes[0].id,title:'2027补充标准'};
  const appendActions=[{action:'read',ids:[target.nodes[0].id]},{action:'finish',changes:[append]}];
  const added=await planKnowledgeChanges(docs,source.nodes,async()=>JSON.stringify(appendActions.shift()));
  assert.equal(added[0].before,null);store.complete(source.id,source.draft_revision,source.nodes,added);store.publish(0,source.id,source.draft_revision);
  const published=store.published(0,target.id);assert.equal(published.nodes.length,2);assert.equal(published.nodes[1].parentId,published.nodes[0].id);
  let calls=0;assert.deepEqual(await planKnowledgeChanges([],source.nodes,async()=>{calls++;}),[]);assert.equal(calls,0);
 }finally{store.close();}
});

test('reviewed publication updates existing knowledge atomically, keeps originals and withdraws derived evidence',()=>{
 const store=createTreeStore();
 try{
  const target=readyDocument(store,'差旅制度','2026年住宿上限520元。');store.publish(0,target.id,target.draft_revision);
  const source=readyDocument(store,'补充通知','2027年住宿上限600元。');
  store.complete(source.id,source.draft_revision,source.nodes,[updateDraft(target,source)]);
  assert.match(store.published(7,target.id).nodes[0].text,/520/);assert.doesNotMatch(store.published(7,target.id).nodes[0].text,/600/);
  const result=store.publishMany(0,[{id:source.id,revision:source.draft_revision}]);assert.deepEqual(result,{published:1,updated:1});
  const revised=store.published(7,target.id);assert.match(revised.nodes[0].text,/600/);assert.match(revised.nodes[0].text,/2026年/);assert.notEqual(revised.nodes[0].id,target.nodes[0].id);
  assert.equal(revised.nodes[0].sources.length,2);assert.equal(revised.nodes[0].sources[1].documentId,source.id);
  const unchanged=store.upload(0,{id:target.id,title:target.title,filename:'差旅制度.md',bytes:Buffer.from('2026年住宿上限520元。')});assert.equal(unchanged.skipped,true);assert.equal(unchanged.draft_revision,revised.revision);
  assert.match(Buffer.from(store.original(0,target.id,target.draft_revision).data,'base64').toString(),/520/);
  assert.doesNotMatch(Buffer.from(store.original(0,target.id).data,'base64').toString(),/600/);
  assert.throws(()=>readKnowledgeNodes(store.catalogue(7),[target.nodes[0].id]),/已更新/);
  store.unpublish(0,source.id);assert.equal(store.published(7,target.id).nodes.length,0);
  store.publish(0,source.id,source.draft_revision);assert.equal(store.published(7,target.id).nodes.length,1);
 }finally{store.close();}
});

test('bulk publication rejects conflicting or stale plans without partial release; dismissal and duplicate upload are explicit',()=>{
 const store=createTreeStore();
 try{
  const target=readyDocument(store,'差旅制度','2026年住宿上限520元。');store.publish(0,target.id,target.draft_revision);
  const first=readyDocument(store,'通知一','2027年起600元。'),second=readyDocument(store,'通知二','2028年起700元。');
  for(const source of [first,second])store.complete(source.id,source.draft_revision,source.nodes,[updateDraft(target,source)]);
  assert.throws(()=>store.publishMany(0,[first,second].map(source=>({id:source.id,revision:source.draft_revision}))),/同一章节/);
  assert.equal(store.detail(0,first.id).published,false);assert.equal(store.detail(0,second.id).published,false);assert.equal(store.detail(0,target.id).draft_revision,target.draft_revision);
  store.dismiss(0,second.id,second.draft_revision,0);assert.equal(store.detail(0,second.id).proposals.length,0);
  store.publish(0,first.id,first.draft_revision);
  store.complete(second.id,second.draft_revision,second.nodes,[updateDraft(target,second)]);
  assert.throws(()=>store.publish(0,second.id,second.draft_revision),/已修改或撤回/);assert.equal(store.detail(0,second.id).published,false);
  store.retry(0,second.id);assert.equal(store.detail(0,second.id).status,'pending');assert.equal(store.detail(0,second.id).proposals.length,0);
  const duplicate=store.upload(0,{title:'重复',filename:'通知一.md',bytes:Buffer.from('2027年起600元。')});assert.equal(duplicate.skipped,true);assert.equal(duplicate.id,first.id);
 }finally{store.close();}
});

test('HTTP processing prepares reviewed changes and bulk release is permission checked',async t=>{
 const f=await fixture(t,{plan:messages=>{
  const initial=JSON.parse(messages[1].content),target=initial.existing.documents[0],node=target.nodes[0];
  if(messages.length===2)return{action:'read',ids:[node.id]};
  const old=JSON.parse(messages.at(-1).content).result.nodes[0];
  return{action:'finish',changes:[{operation:'update',documentId:target.id,nodeId:node.id,title:node.title,summary:'保留旧制度，补充新通知',text:old.text+'\n\n2027年起上海每晚600元。',sourceNodeIds:[initial.newNodes[0].id],reason:'补充新生效日期和金额'}]};
 }});
 const uploaded=(await f.request('/admin/knowledge/upload',document,f.admin)).body;await f.knowledge.idle();
 let detail=f.knowledge.store.detail(0,uploaded.id);await f.request('/admin/knowledge/'+detail.id+'/publish',{revision:detail.draft_revision},f.admin);
 const supplement=(await f.request('/admin/knowledge/upload',{title:'新通知',filename:'通知.md',data:Buffer.from('# 新通知\n2027年起上海每晚600元。').toString('base64')},f.admin)).body;await f.knowledge.idle();
 detail=f.knowledge.store.detail(0,supplement.id);assert.equal(detail.status,'ready');assert.equal(detail.proposals.length,1);assert.equal(detail.changes,1);
 const documents=[{id:detail.id,revision:detail.draft_revision}];
 assert.equal((await f.request('/admin/knowledge/publish',{documents},f.alice)).status,403);
 assert.equal((await f.request('/admin/knowledge/publish',{documents},f.admin)).status,200);
 const read=f.knowledge.store.published(2,uploaded.id);assert.match(read.nodes[0].text,/600/);assert.equal(read.nodes[0].sources.length,2);
 assert.ok(f.db.read().requests.filter(item=>item.purpose==='knowledge_index').length>=4);
  assert.equal((await f.request('/admin/knowledge/publish',{documents:[null]},f.admin)).status,400);
});

test('draft editing changes reviewed content only, keeps originals and drops proposals based on corrected source text',()=>{
 const store=createTreeStore();
 try{
  const target=readyDocument(store,'差旅制度','2026年住宿上限520元。');store.publish(0,target.id,target.draft_revision);
  const source=readyDocument(store,'补充通知','2027年起600元。');store.complete(source.id,source.draft_revision,source.nodes,[updateDraft(target,source)]);
  const proposal=store.detail(0,source.id).proposals[0];
  store.edit(0,source.id,{revision:source.draft_revision,proposalIndex:0,title:'人工确认标准',summary:'需住宿发票',text:proposal.text+'\n必须提供住宿发票。'});
  let detail=store.detail(0,source.id);assert.match(detail.proposals[0].text,/住宿发票/);assert.equal(detail.proposals[0].baseRevision,proposal.baseRevision);assert.deepEqual(detail.proposals[0].sourceNodeIds,proposal.sourceNodeIds);
  const result=store.edit(0,source.id,{revision:source.draft_revision,nodeId:source.nodes[0].id,title:'补充通知',summary:'修正适用年度',text:'2028年起600元。'});
  assert.equal(result.discardedChanges,1);detail=store.detail(0,source.id);assert.equal(detail.proposals.length,0);assert.equal(detail.nodes[0].text,'2028年起600元。');
  assert.match(Buffer.from(store.original(0,source.id).data,'base64').toString(),/2027年/);assert.doesNotMatch(store.published(0,target.id).nodes[0].text,/600/);
  for(const text of ['', '字'.repeat(12001)])assert.throws(()=>store.edit(0,source.id,{revision:source.draft_revision,nodeId:source.nodes[0].id,title:'测试',summary:'摘要',text}),/正文/);
  store.publish(0,source.id,source.draft_revision);
  assert.throws(()=>store.edit(0,source.id,{revision:source.draft_revision,nodeId:source.nodes[0].id,title:'测试',summary:'摘要',text:'修改'}),/撤回发布/);
 }finally{store.close();}
});

test('knowledge upload accepts files over 2 MB without relaxing ordinary JSON endpoints or authentication',async t=>{
 const f=await fixture(t),large={title:'大文档',filename:'large.txt',data:Buffer.alloc(3*1024*1024,65).toString('base64')};
 assert.equal((await f.request('/client/knowledge/upload',large)).status,401);
 assert.equal((await f.request('/client/knowledge/upload',large,f.alice)).status,202);
 await f.knowledge.idle();const result=(await f.request('/client/knowledge/list',{},f.alice)).body.documents[0];assert.equal(result.bytes,3*1024*1024);assert.equal(result.status,'failed');assert.match(result.error,/正文|20万|拆分/);
 assert.equal((await f.request('/auth/login',large)).status,413);
});
