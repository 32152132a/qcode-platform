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
import { splitKnowledge, knowledgeCatalogue, readKnowledgeNodes, summarizeKnowledge } from '../src/knowledge-tree.js';

async function fixture(t,{plan}={}){
 const db=createDatabase(),outbound=[];
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);outbound.push(data);let content='收到';try{const nodes=JSON.parse(data.messages.at(-1).content);const result=Array.isArray(nodes)?{nodes:nodes.map(node=>({id:node.id,summary:node.title.slice(0,50)+'：参考原文'}))}:plan?.(data.messages);content=result===null?null:JSON.stringify(result??{action:'finish',changes:[]});}catch{}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));});
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


test('enterprise upload sends extracted text to AI and stays unpublished until release', async t => {
 const f=await fixture(t,{plan:messages=>{
  const input=JSON.parse(messages[1].content);
  const node=input.incoming?.find(item=>item.title==='上海住宿');
  return {action:'finish',changes:node?[{operation:'update',id:node.id,summary:'住宿上限和票据要求',reason:'完善摘要'}]:[]};
 }});
 const uploaded=await f.request('/admin/knowledge/upload',document,f.admin);
 assert.equal(uploaded.status,202);await f.knowledge.idle();
 const data=(await f.request('/admin/knowledge/list',{},f.admin)).body;
 assert.equal(data.library.nodes.find(node=>node.title==='上海住宿').summary,'住宿上限和票据要求');
 assert.equal(f.outbound.length,1);
 const input=JSON.parse(f.outbound[0].messages[1].content);
 assert.equal(input.scope,'import');assert.match(input.incoming.find(node=>node.title==='上海住宿').text,/520/);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,0);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:'stale'},f.admin)).status,409);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:data.library.revision},f.alice)).status,403);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:data.library.revision},f.admin)).status,200);
 const catalogue=(await f.request('/client/knowledge/catalogue',{},f.alice)).body;
 const node=catalogue.documents[0].nodes.find(node=>node.title==='上海住宿');
 const read=await f.request('/client/knowledge/read',{ids:[node.id]},f.alice);
 assert.equal(read.status,200);assert.ok(read.body.nodes.some(node=>node.text.includes('2026')));
 assert.equal(read.body.nodes.find(item=>item.id===node.id).source.filename,'住宿.md');
 assert.equal((await f.request('/admin/knowledge/'+uploaded.body.id+'/publish',{revision:data.library.revision},f.admin)).status,404);
});

test('replacement and bulk deletion remain drafts until one atomic release; stale references are rejected', async t => {
 const f=await fixture(t);
 await f.request('/admin/knowledge/upload',document,f.admin);await f.knowledge.idle();
 const before=f.knowledge.store.library.detail();
 f.knowledge.store.library.publish(before.revision,'admin');
 const article=before.nodes.find(node=>node.title==='上海住宿');
 const old=f.knowledge.store.library.documents()[0].nodes.find(node=>node.title==='上海住宿');
 const replacement={...document,filename:'替换.md',data:Buffer.from('# 上海住宿\n上海每晚600元。').toString('base64'),targetId:article.id,expectedRevision:before.revision};
 assert.equal((await f.request('/admin/knowledge/upload',replacement,f.admin)).status,202);await f.knowledge.idle();
 let current=f.knowledge.store.library.detail();
 const replacementInput=JSON.parse(f.outbound.at(-1).messages[1].content);
 assert.equal(replacementInput.scope,'replace');assert.match(replacementInput.previous.text,/520/);
 assert.match(replacementInput.incoming[0].text,/600/);
 assert.match(current.nodes.find(node=>node.id===article.id).text,/600/);
 assert.match((await f.request('/client/knowledge/read',{ids:[old.id]},f.alice)).body.nodes[0].text,/520/);
 assert.equal((await f.request('/admin/knowledge/upload',replacement,f.admin)).status,409);
 const exported=await f.request('/admin/knowledge/articles/export',{id:article.id},f.admin);
 assert.match(exported.body.content,/600/);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:current.revision},f.admin)).status,200);
 assert.equal((await f.request('/client/knowledge/read',{ids:[old.id]},f.alice)).status,404);
 const ids=current.nodes.filter(node=>node.kind==='article').map(node=>node.id);
 const staged=await f.request('/admin/knowledge/articles/delete',{ids,revision:current.revision},f.admin);
 assert.equal(staged.status,200);current=staged.body;
 assert.equal(current.nodes.length,0);assert.equal(current.deleted.filter(node=>node.kind==='article').length,ids.length);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,1);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:current.revision},f.admin)).status,200);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,0);
});

test('AI directly saves a reviewable draft without publishing and rejects stale or unread changes', async t => {
 let actions=[];
 const f=await fixture(t,{plan:()=>actions.shift()});
 await f.request('/admin/knowledge/upload',document,f.admin);await f.knowledge.idle();
 const base=f.knowledge.store.library.detail(),node=base.nodes.find(node=>node.title==='上海住宿');
 const change={operation:'update',...node,summary:'上海普通员工每晚520元',reason:'精简摘要，保留原条件'};
 actions=[{action:'read',ids:[node.id]},{action:'finish',changes:[change],warnings:[],exclusions:[]}];
 const response=await f.request('/admin/knowledge/beautify',{revision:base.revision,nodeId:node.id},f.admin);
 assert.equal(response.status,200);assert.equal(response.body.changed,true);
 const applied=response.body.library;
 assert.equal(applied.nodes.find(item=>item.id===node.id).summary,change.summary);
 assert.deepEqual(applied.nodes.find(item=>item.id===node.id).sources,node.sources);
 assert.deepEqual(applied.publishedNodes,[]);assert.equal(applied.review.changes.find(item=>item.id===node.id).reason,change.reason);
 assert.equal((await f.request('/client/knowledge/catalogue',{},f.alice)).body.documents.length,0);
 assert.equal((await f.request('/admin/knowledge/beautify',{revision:base.revision},f.admin)).status,409);
 f.knowledge.store.library.publish(applied.revision,'admin');
 actions=[{action:'finish',changes:[change],warnings:[],exclusions:[]},null];
 const start=f.outbound.length;
 const rejected=await f.request('/admin/knowledge/beautify',{revision:applied.revision,nodeId:node.id},f.admin);
 assert.equal(rejected.status,502);
 assert.equal(rejected.body.error.code,'INVALID_KNOWLEDGE_PLAN');
 assert.match(rejected.body.error.message,/未读取/);
 assert.equal(f.outbound.length,start+2);
 assert.equal(f.knowledge.store.library.snapshot().revision,applied.revision);
 assert.equal(f.knowledge.store.library.snapshot('published').revision,applied.revision);
 actions=[null,{action:'finish',changes:[]}];
 const recovered=await f.request('/admin/knowledge/beautify',{revision:applied.revision,nodeId:node.id},f.admin);
 assert.equal(recovered.status,200);
 assert.equal(recovered.body.changed,false);
 assert.ok(f.outbound.every(body=>!Object.hasOwn(body,'max_tokens')));
});

test('published question tests read real evidence and reject mixed batch versions', async t => {
 let actions=[];
 const f=await fixture(t,{plan:()=>actions.shift()});
 const empty=await f.request('/admin/knowledge/test',{question:'上海住宿？'},f.admin);
 assert.equal(empty.status,200);assert.equal(empty.body.supported,false);assert.equal(f.outbound.length,0);
 await f.request('/admin/knowledge/upload',document,f.admin);await f.knowledge.idle();
 const base=f.knowledge.store.library.detail();f.knowledge.store.library.publish(base.revision,'admin');
 const node=f.knowledge.store.library.documents()[0].nodes.find(item=>item.title==='上海住宿');
 actions=[{action:'read',ids:[node.id]},{action:'answer',supported:true,answer:'上海每晚520元，需住宿发票。',citations:[{nodeId:node.id,quote:'上海每晚520元，需住宿发票。'}]}];
 const result=await f.request('/admin/knowledge/test',{question:'上海住宿标准是多少？'},f.admin);
 assert.equal(result.status,200);assert.equal(result.body.supported,true);assert.equal(result.body.calls,2);assert.equal(result.body.totalTokens,300);
 assert.equal(result.body.trace[0].action,'read');assert.equal(result.body.citations[0].source.filename,'住宿.md');
 assert.equal((await f.request('/admin/knowledge/search',{query:'520'},f.admin)).body.items.length,1);
 assert.equal((await f.request('/admin/knowledge/test',{question:'问题',revision:'stale'},f.admin)).status,409);
 assert.equal((await f.request('/admin/knowledge/test',{question:'问题'},f.alice)).status,403);
 const personal=(await f.request('/client/knowledge/upload',document,f.alice)).body;await f.knowledge.idle();
 assert.equal((await f.request('/client/knowledge/'+personal.id+'/download',{},f.bob)).status,404);
});

test('failed and unreadable imports leave no draft changes or model calls and do not block ready files', async t => {
 const f=await fixture(t);
 await f.request('/admin/knowledge/upload',document,f.admin);
 const bad=(await f.request('/admin/knowledge/upload',{...document,filename:'bad.txt',data:Buffer.from('bad\0text').toString('base64')},f.admin)).body;
 const scan=(await f.request('/admin/knowledge/upload',{...document,filename:'扫描.pdf',data:pdfFixture(null).toString('base64')},f.admin)).body;
 await f.knowledge.idle();
 const current=f.knowledge.store.library.detail();
 assert.equal(f.knowledge.store.detail(0,bad.id).status,'failed');
 const unreadable=f.knowledge.store.detail(0,scan.id);
 assert.equal(unreadable.status,'needs_recognition');assert.match(unreadable.error,/第1页/);
 assert.equal(f.outbound.length,1);
 assert.equal(f.knowledge.store.library.documents().length,0);
 assert.equal((await f.request('/admin/knowledge/publish',{revision:current.revision},f.admin)).status,200);
 assert.equal((await f.request('/admin/knowledge/uploads/'+scan.id+'/delete',{},f.admin)).status,200);
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

test('knowledge upload accepts files over 2 MB without relaxing ordinary JSON endpoints or authentication',async t=>{
 const f=await fixture(t),large={title:'大文档',filename:'large.txt',data:Buffer.alloc(3*1024*1024,65).toString('base64')};
 assert.equal((await f.request('/client/knowledge/upload',large)).status,401);
 assert.equal((await f.request('/client/knowledge/upload',large,f.alice)).status,202);
 await f.knowledge.idle();const result=(await f.request('/client/knowledge/list',{},f.alice)).body.documents[0];assert.equal(result.bytes,3*1024*1024);assert.equal(result.status,'failed');assert.match(result.error,/正文|20万|拆分/);
 assert.equal((await f.request('/auth/login',large)).status,413);
});

test('summary generation corrects invalid JSON and oversized summaries once, retaining original node identities', async () => {
  const node = { id: 'node-1', title: '制度', text: '上海住宿每晚500元。', summary: '' };
  for (const invalid of ['{"nodes":[', JSON.stringify({nodes:[{id:node.id,summary:'长'.repeat(101)}]}), 'null', '{"nodes":[null]}']) {
    let calls = 0;
    const result = await summarizeKnowledge([node], async messages => {
      calls++;
      if (calls === 1) return invalid;
      assert.equal(messages.length, 4);
      assert.match(messages.at(-1).content, /修正/);
      return '说明：```json\n' + JSON.stringify({nodes:[{id:node.id,summary:'上海住宿每晚500元'}]}) + '\n```';
    });
    assert.equal(calls, 2);
    assert.equal(result[0].summary, '上海住宿每晚500元');
    assert.equal(result[0].id, node.id);
    assert.equal(node.summary, '');
  }
  let calls = 0;
  await assert.rejects(summarizeKnowledge([node], async () => {
    calls++;
    return JSON.stringify({nodes:[{id:'foreign',summary:'错误节点'}]});
  }), {code:'INVALID_KNOWLEDGE_SUMMARY'});
  assert.equal(calls, 2);
});

test('successful import batches are not committed when a later batch fails', async t => {
 const f=await fixture(t,{plan:messages=>{
  const input=JSON.parse(messages[1].content);
  if (!input.incoming.some(node=>node.title==='章节1')) return {action:'finish',changes:[{operation:'update',id:'unread',title:'无效改动',reason:'测试失败'}]};
  return {action:'finish',changes:[{operation:'update',id:input.incoming[0].id,summary:'整理后的摘要',reason:'测试成功批次'}]};
 }});
 const markdown=Array.from({length:7},(_,index)=>'# 章节'+(index+1)+'\n正文内容').join('\n\n');
 const before=f.knowledge.store.library.snapshot();
 const upload=await f.request('/admin/knowledge/upload',{...document,filename:'多章节.md',data:Buffer.from(markdown).toString('base64')},f.admin);
 assert.equal(upload.status,202);await f.knowledge.idle();
 assert.equal(f.outbound.length,3);
 assert.equal(f.knowledge.store.detail(0,upload.body.id).status,'failed');
 assert.equal(f.knowledge.store.library.snapshot().revision,before.revision);
 assert.deepEqual(f.knowledge.store.library.snapshot().nodes,[]);
});


test('knowledge import keeps the existing parent and retries invalid plan details once', async t => {
 const f=await fixture(t,{plan:messages=>{
  const {incoming:[node]}=JSON.parse(messages[1].content);
  const correction=messages.length>2?JSON.parse(messages.at(-1).content):null;
  const change={operation:'update',id:node.id,parentId:node.parentId,summary:'核对过的摘要',reason:'补充检索摘要'};
  return {action:'finish',changes:[change],exclusions:correction?[]:[{sourceNodeIds:[node.id],reason:'重复内容',quote:'原文不存在的片段'}]};
 }});
 const result=await f.request('/admin/knowledge/upload',document,f.admin);
 await f.knowledge.idle();
 assert.equal(f.knowledge.store.detail(0,result.body.id).status,'ready');
 assert.equal(f.outbound.length,2);
 assert.match(JSON.parse(f.outbound[1].messages.at(-1).content).error,/逐字/);
 const id=JSON.parse(f.outbound[0].messages[1].content).incoming[0].id;
 assert.equal(f.knowledge.store.library.snapshot().nodes.find(node=>node.id===id).summary,'核对过的摘要');
});
