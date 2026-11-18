import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTreeStore} from '../src/knowledge-tree-store.js';
import {splitKnowledge} from '../src/knowledge-tree.js';
import {markdownBlocks} from '../src/knowledge-parser.js';
import {beautifyKnowledge,questionKnowledge} from '../src/knowledge-ai.js';

function imported(store) {
 const row=store.upload(0,{title:'住宿制度',filename:'住宿.md',bytes:Buffer.from('# 适用范围\n2026年普通员工。\n## 上海住宿\n上海每晚520元。')});
 const job=store.next(),nodes=splitKnowledge(markdownBlocks(Buffer.from(job.original).toString()),row.id,row.draft_revision);
 store.complete(row.id,row.draft_revision,nodes);
 return store.library.detail();
}

test('published snapshots and pending deletions survive reopen with client-compatible IDs',()=>{
 const directory=mkdtempSync(join(tmpdir(),'qcode-library-')),filename=join(directory,'knowledge.sqlite');
 let store=createTreeStore(filename);
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  store.library.publish(base.revision,'admin');
  assert.match(store.library.documents()[0].id,/^[a-f0-9]{32}$/);
  const changed=store.library.remove([article.id],base.revision);
  store.close();store=createTreeStore(filename);
  assert.equal(store.library.detail().revision,changed.revision);
  assert.ok(store.library.documents()[0].nodes.some(node=>node.title==='上海住宿'));
  assert.ok(store.library.detail().deleted.some(node=>node.id===article.id));
  store.library.publish(changed.revision,'admin');
  assert.ok(!store.library.documents()[0].nodes.some(node=>node.title==='上海住宿'));
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('deletion preview includes descendant articles and publication remains unchanged until release',()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),parent=base.nodes.find(node=>node.title==='适用范围'),child=base.nodes.find(node=>node.title==='上海住宿');
  store.library.publish(base.revision,'admin');
  const impact=store.library.removalImpact([parent.id],base.revision);
  assert.equal(impact.count,2);assert.ok(impact.ids.includes(child.id));
  assert.equal(store.library.detail().revision,base.revision);
  const changed=store.library.remove([parent.id],base.revision);
  assert.equal(changed.nodes.length,0);
  assert.equal(store.library.documents()[0].nodes.filter(node=>node.kind==='article').length,2);
  store.library.publish(changed.revision,'admin');
  assert.deepEqual(store.library.documents(),[]);
  const reuploaded=store.upload(0,{title:'住宿制度',filename:'住宿.md',bytes:Buffer.from('# 适用范围\n2026年普通员工。\n## 上海住宿\n上海每晚520元。')});
  assert.equal(reuploaded.skipped,undefined);
  assert.equal(store.next().document_id,reuploaded.id);
 }finally{store.close();}
});

test('AI cannot silently drop source evidence or create cyclic directories',()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  assert.throws(()=>store.library.beautify({changes:[{operation:'delete',id:article.id,reason:'删除'}],warnings:[],exclusions:[]},base.revision),{code:'KNOWLEDGE_COVERAGE_MISSING'});
  assert.equal(store.library.detail().revision,base.revision);
  assert.throws(()=>store.library.beautify({changes:[{operation:'update',...article,parentId:article.id,reason:'移动'}],warnings:[],exclusions:[]},base.revision),{code:'INVALID_KNOWLEDGE_TREE'});
  assert.equal(store.library.detail().revision,base.revision);
  const result=store.library.beautify({changes:[{operation:'delete',id:article.id,reason:'移除旧说明'}],warnings:[],exclusions:[{sourceNodeIds:[article.id],reason:'管理员需确认排除这段规则'}]},base.revision);
  assert.equal(result.exclusions.length,1);
 }finally{store.close();}
});

test('a replacement cannot overwrite an article changed during parsing',()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  const row=store.upload(0,{title:article.title,filename:'修改.md',bytes:Buffer.from('新正文'),targetId:article.id,expectedRevision:base.revision});
  const job=store.next();
  const changed=store.library.remove([article.id],base.revision);
  assert.throws(()=>store.complete(row.id,row.draft_revision,splitKnowledge(markdownBlocks('新正文'),row.id,row.draft_revision)),{code:'KNOWLEDGE_CHANGED'});
  assert.equal(store.library.detail().revision,changed.revision);
  assert.equal(store.detail(0,job.document_id).status,'processing');
 }finally{store.close();}
});

test('single-article beautification rejects changes to other articles and no-op results leave the draft unchanged',async()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿'),other=base.nodes.find(node=>node.kind==='article'&&node.id!==article.id);
  const steps=[{action:'read',ids:[other.id]},{action:'finish',changes:[{...other,operation:'update',reason:'修改别篇'}]}];
  await assert.rejects(beautifyKnowledge(base,article.id,async()=>JSON.stringify(steps.shift())),{code:'INVALID_KNOWLEDGE_PLAN'});
  assert.equal(store.library.beautify({changes:[],warnings:['可保留当前结构'],exclusions:[]},base.revision).revision,base.revision);
 }finally{store.close();}
});

test('question tests deduplicate reads, reject invented citations, and stop within budget',async()=>{
 const store=createTreeStore();
 try{
  const base=imported(store);store.library.publish(base.revision,'admin');
  const documents=store.library.documents(),node=documents[0].nodes.find(node=>node.title==='上海住宿');
  const steps=[
   {action:'read',ids:[node.id]},
   {action:'read',ids:[node.id]},
   {action:'answer',supported:true,answer:'上海900元',citations:[{nodeId:node.id,quote:'上海900元'}]},
   {action:'answer',supported:true,answer:'上海每晚520元',citations:[{nodeId:node.id,quote:'上海每晚520元。'}]},
  ];
  const calls=[];
  const result=await questionKnowledge(documents,'上海住宿标准',async messages=>{calls.push(structuredClone(messages));return JSON.stringify(steps.shift());});
  assert.equal(result.calls,4);assert.equal(result.citations.length,1);
  assert.match(calls[2].at(-1).content,/alreadyRead/);
  assert.ok(result.trace.some(item=>item.error));
  let count=0;
  const exhausted=await questionKnowledge(documents,'不在目录中的问题',async()=>{count++;return JSON.stringify({action:'catalogue',parentId:'missing'});});
  assert.equal(count,6);assert.equal(exhausted.supported,false);
 }finally{store.close();}
});

test('exclusion previews accept exact source excerpts and reject invented text',async()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  for(const quote of ['上海每晚520元。','上海每晚900元。']){
   const steps=[{action:'read',ids:[article.id]},{action:'finish',changes:[{...article,operation:'update',reason:'核对摘要'}],warnings:[],exclusions:[{sourceNodeIds:[article.id],reason:'重复条目合并说明',quote}]}];
   const generate=()=>beautifyKnowledge(base,undefined,async()=>JSON.stringify(steps.shift()));
   if(quote.includes('900'))await assert.rejects(generate(),{code:'INVALID_KNOWLEDGE_PLAN'});
   else assert.equal((await generate()).exclusions[0].quote,quote);
  }
 }finally{store.close();}
});

test('AI drafts retain reasons, map added IDs and hide review after publication',()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  const draft=store.library.beautify({changes:[{operation:'add',id:'new-folder',kind:'folder',title:'出差标准',summary:'各地住宿标准',text:'',parentId:null,reason:'按主题分类'},{operation:'update',...article,parentId:'new-folder',reason:'归入出差目录'}],warnings:[],exclusions:[]},base.revision);
  const folder=draft.nodes.find(node=>node.title==='出差标准');
  assert.ok(draft.review.changes.some(change=>change.id===folder.id));
  assert.equal(draft.review.changes.find(node=>node.id===article.id).reason,'归入出差目录');
  assert.deepEqual(draft.publishedNodes,[]);
  assert.throws(()=>store.library.beautify({changes:[]},base.revision),{code:'KNOWLEDGE_CHANGED'});
  store.library.publish(draft.revision,'admin');
  assert.equal(store.library.detail().review,null);
  assert.ok(store.library.detail().publishedNodes.some(node=>node.id===folder.id));
 }finally{store.close();}
});

test('pending AI deletion review survives another upload and clears after publishing',()=>{
 const store=createTreeStore();
 try{
  const base=imported(store),article=base.nodes.find(node=>node.title==='上海住宿');
  const edited=store.library.beautify({changes:[{operation:'delete',id:article.id,reason:'重复内容'}],warnings:[],exclusions:[{sourceNodeIds:[article.id],reason:'合并重复说明'}]},base.revision);
  function upload(filename){
   const row=store.upload(0,{title:'补充资料',filename,bytes:Buffer.from('# 补充资料\n请保留发票。')});
   store.next();store.complete(row.id,row.draft_revision,splitKnowledge(markdownBlocks('# 补充资料\n请保留发票。'),row.id,row.draft_revision));
  }
  upload('补充.md');
  const draft=store.library.detail();
  assert.deepEqual(draft.review.changes,edited.review.changes);
  assert.equal(draft.review.exclusions[0].titles[0],article.title);assert.deepEqual(draft.deleted,[]);
  store.library.publish(draft.revision,'admin');
  upload('另一次补充.md');
  assert.equal(store.library.detail().review,null);
 }finally{store.close();}
});

test('single article changes preserve unrelated curated directory summaries',()=>{
 const store=createTreeStore();
 try{
  const first=imported(store);
  const row=store.upload(0,{title:'财务',filename:'财务.md',bytes:Buffer.from('# 发票\n需要合法发票。')});
  store.next();store.complete(row.id,row.draft_revision,splitKnowledge(markdownBlocks('# 发票\n需要合法发票。'),row.id,row.draft_revision));
  const base=store.library.detail(),folder=base.nodes.find(node=>node.kind==='folder'&&node.title==='财务');
  const curated=store.library.beautify({changes:[{operation:'update',...folder,summary:'财务凭证及票据要求',reason:'提炼目录语义'}],warnings:[],exclusions:[]},base.revision);
  const article=curated.nodes.find(node=>node.title==='上海住宿');
  const changed=store.library.beautify({changes:[{operation:'update',...article,summary:'上海住宿标准及适用条件',reason:'优化摘要'}],warnings:[],exclusions:[]},curated.revision);
  assert.equal(changed.nodes.find(node=>node.id===folder.id).summary,'财务凭证及票据要求');
  assert.ok(first.nodes.some(node=>node.id===article.id));
 }finally{store.close();}
});

test('a rejected read does not consume budget needed by subsequent smaller reads',async()=>{
 const nodes=[0,1,2].map(index=>({id:'node'+index,parentId:null,title:'章节'+index,summary:'摘要',text:String(index).repeat(9000)}));
 const documents=[{id:'doc',title:'资料',filename:'资料.md',scope:'enterprise',revision:'r',nodes}];
 const steps=[{action:'read',ids:['node0']},{action:'read',ids:['node1','node2']},{action:'read',ids:['node1']},{action:'answer',supported:true,answer:'依据章节1',citations:[{nodeId:'node1',quote:'111'}]}];
 const result=await questionKnowledge(documents,'问题',async()=>JSON.stringify(steps.shift()));
 assert.equal(result.supported,true);assert.equal(result.calls,4);
 assert.ok(result.trace.some(step=>step.error));
});
