import test from 'node:test';
import assert from 'node:assert/strict';
import {nextVersion} from '../../../scripts/next-client-version.mjs';

test('release versions advance from the newer local or published version',()=>{
  assert.equal(nextVersion('0.4.1'),'0.4.2');
  assert.equal(nextVersion('0.4.1','0.4.9'),'0.4.10');
  assert.equal(nextVersion('0.5.1','0.4.99'),'0.5.2');
  assert.equal(nextVersion('0.4.99','1.0.0'),'1.0.1');
  assert.equal(nextVersion('0.4.9','0.4.10'),'0.4.11');
  assert.throws(()=>nextVersion('0.4.x'),/Invalid/);
  assert.throws(()=>nextVersion('0.4.1','bad'),/Invalid/);
  assert.throws(()=>nextVersion('0.4.9007199254740991'),/too large/);
});
