import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeStore } from '../src/knowledge-store.js';

test('knowledge lifecycle, hybrid search and owner permissions remain consistent', () => {
 const store=createKnowledgeStore(':memory:',{model:'fixture',dimensions:3});
 try {
  const save=(ownerId,title,content)=>store.save({ownerId,title,filename:'test.md',content});
  const enterprise=save(0,'报销制度','员工 报销 需要 提交 发票');
  const personal=save(1,'个人笔记','我的 报销 项目');
  const hidden=save(2,'其他用户','秘密 报销');
  for(const document of [enterprise,personal,hidden])store.complete(document.owner_id,document.id,document.revision,[[1,0,0]]);
  const search=(scope='all')=>store.search({userId:1,query:'报销',vector:[1,0,0],scope});
  assert.deepEqual(search().map(row=>row.title).sort(),['个人笔记','报销制度']);
  assert.deepEqual(search('enterprise').map(row=>row.title),['报销制度']);
  assert.deepEqual(search('personal').map(row=>row.title),['个人笔记']);
  assert.throws(()=>store.get(1,hidden.id),error=>error.code==='KNOWLEDGE_NOT_FOUND');
  assert.throws(()=>store.remove(1,hidden.id),error=>error.code==='KNOWLEDGE_NOT_FOUND');
  const updated=store.save({ownerId:1,id:personal.id,title:'新笔记',filename:'test.md',content:'全新内容'});
  assert.equal(search('personal').length,0);
  assert.throws(()=>store.complete(1,personal.id,personal.revision,[[1,0,0]]),error=>error.code==='DOCUMENT_CHANGED');
  assert.throws(()=>store.complete(1,personal.id,updated.revision,[[1,0]]),error=>error.code==='INVALID_EMBEDDING');
  assert.equal(store.get(1,personal.id).status,'pending');
  store.markFailed(1,personal.id,updated.revision,'处理失败');assert.equal(store.get(1,personal.id).status,'failed');
  store.complete(1,personal.id,updated.revision,[[1,0,0]]);assert.equal(store.get(1,personal.id).status,'ready');
  store.remove(1,personal.id);assert.equal(search('personal').length,0);
  assert.equal(store.list(2).length,1);assert.equal('content' in store.list(2)[0],false);
  for(let i=0;i<10;i++)save(1,'笔记'+i,'正文');
  assert.throws(()=>save(1,'超限','正文'),error=>error.code==='KNOWLEDGE_LIMIT');
 } finally {store.close();}
});
