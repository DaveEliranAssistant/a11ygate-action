import test from 'node:test';import assert from 'node:assert/strict';import {buildResult} from './qe-result.mjs';
const f={impact:'critical',help:'label',path:'/',selector:'#x'};
test('real package version replaces native 0.0.0, and changes are ordered New Fixed Still open',()=>{const r=buildResult({version:'0.0.0',verdict:'FAIL',threshold:'minor',counts:{new:1,fixed:1,stillOpen:1},findings:{new:[f],fixed:[f],stillOpen:[f]}});assert.equal(r.version,'0.1.0');assert.deepEqual(r.findings.map(f=>f.change),['new','fixed','still-open']);});
