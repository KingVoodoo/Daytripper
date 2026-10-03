import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/daytripper-pruning.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {pruneScoutLinks,isActiveScoutSignature,validateScoutSnapshot}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('Thera and Turnur remove absent feed links including an authoritative empty snapshot',()=>{
 for(const hub of [31000005,30002086]){
 const nodes=[{systemId:1,scoutedBy:'EVE-Scout'},{systemId:2,scoutedBy:'EVE-Scout'}];
 const links=[{id:`wh-${hub}-1`,sourceId:hub,targetId:1},{id:'feed-2',sourceId:hub,targetId:2,scoutHub:hub},{id:'manual',sourceId:hub,targetId:3},{id:'gate',sourceId:hub,targetId:4,isStargate:true}];
 assert.deepEqual(pruneScoutLinks(links,nodes,hub,new Set([1])).links.map(l=>l.id),[`wh-${hub}-1`,'manual','gate']);
 assert.deepEqual(pruneScoutLinks(links,nodes,hub,new Set()).links.map(l=>l.id),['manual','gate']);
 }
});
test('expiry filtering and snapshot validation distinguish empty success from malformed data',()=>{
 const now=Date.now();assert.equal(isActiveScoutSignature({expires_at:new Date(now-1).toISOString()},now),false);
 assert.equal(isActiveScoutSignature({remaining_hours:0},now),false);
 assert.equal(isActiveScoutSignature({remaining_hours:2},now),true);
 assert.deepEqual(validateScoutSnapshot([]),[]);
 for(const invalid of [{error:'offline'},null,[{in_system_id:1}]])assert.throws(()=>validateScoutSnapshot(invalid));
});
