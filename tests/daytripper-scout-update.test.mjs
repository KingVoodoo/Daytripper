import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(fs.readFileSync(new URL('../src/daytripper-scout.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {updateScoutLink}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const fields={hubId:1,hubSig:'AAA',destSig:'BBB',whType:'X702',remHours:3,expAt:100,isEol:true,isFrig:true,shipSize:'frigate'};
test('scout update respects forward and reversed signature orientation without mutating input',()=>{
 for(const sourceId of [1,2]){
 const link={sourceId,sourceSig:'old-source',targetSig:'old-target',massStatus:'critical',manual:'keep'};
 const before=structuredClone(link);const next=updateScoutLink(link,fields);
 assert.equal(next.sourceSig,sourceId===1?'AAA':'BBB');assert.equal(next.targetSig,sourceId===1?'BBB':'AAA');
 assert.equal(next.massStatus,'critical');assert.equal(next.manual,'keep');assert.deepEqual(link,before);
 }
});
test('scout update preserves unknown fields, omitted timing and sticky frigate metadata',()=>{
 const link={sourceId:1,sourceSig:'A',targetSig:'B',whCode:'H296',remainingHours:5,expiresAt:9,isFrigateOnly:true,shipSize:'old',lifetimeStatus:'eol'};
 const next=updateScoutLink(link,{...fields,hubSig:'???',destSig:'???',whType:'WH',remHours:undefined,expAt:undefined,isEol:false,isFrig:false,shipSize:''});
 assert.deepEqual(next,{...link,lifetimeStatus:'stable'});
 const zero=updateScoutLink(link,{...fields,remHours:0,expAt:0,whType:'???'});
 assert.equal(zero.remainingHours,0);assert.equal(zero.expiresAt,0);assert.equal(zero.whCode,'H296');
});
