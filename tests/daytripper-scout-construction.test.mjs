import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const moduleSource=fs.readFileSync('src/daytripper-scout.ts','utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(moduleSource,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const ui=fs.readFileSync('src/wormhole-chain-ui.ts','utf8').replace(/\r\n/g,'\n');
const start=ui.indexOf('      if (isCurrentActive) {',ui.indexOf('const linkId = `wh-${hubId}-${targetId}`'));
assert.ok(start>=0);
const end=ui.indexOf('\n    }\n\n    if (isCurrentActive)',start);
const names=['isCurrentActive','targetMap','targetId','targetName','targetClass','secVal','hubId','defaultX','defaultY','linkId','hubSig','destSig','whType','isEol','remHours','expAt','isFrig','s',...Object.keys(helpers)];
const run=new Function(...names,'let addedCount=0;'+ui.slice(start,end)+';return addedCount;');
function apply(active,map,state,fields={}){
 const f={targetId:2,targetName:'J123',targetClass:'C3',secVal:-0.99,hubId:1,defaultX:580,defaultY:460,linkId:'wh-1-2',hubSig:'AAA',destSig:'BBB',whType:'X702',isEol:false,remHours:5,expAt:100,isFrig:false,s:{max_ship_size:'battleship'},...fields};
 return run.call(state,active,map,...names.slice(2,18).map(n=>f[n]),...Object.values(helpers));
}
for(const fields of [{},{hubSig:'???',destSig:'???',whType:'WH',secVal:undefined,remHours:undefined,expAt:undefined,s:{}},{whType:'???',remHours:0,expAt:0,isEol:true,isFrig:true}])test('actual active/inactive scout construction equality '+JSON.stringify(fields),()=>{
 const state={nodes:new Map(),links:[]};const map={nodes:[],links:[]};
 assert.equal(apply(true,null,state,fields),1);assert.equal(apply(false,map,{nodes:new Map(),links:[]},fields),0);
 assert.deepEqual([...state.nodes.values()],map.nodes);assert.deepEqual(state.links,map.links);
 assert.equal(map.nodes[0].parentId,1);assert.equal(map.links[0].id,'wh-1-2');assert.equal(map.links[0].massStatus,'stable');
 const node=map.nodes[0],link=map.links[0];assert.equal(apply(true,null,state,fields),0);apply(false,map,state,fields);
 assert.equal(state.nodes.size,1);assert.equal(state.links.length,1);assert.equal(map.nodes.length,1);assert.equal(map.links.length,1);assert.equal(map.nodes[0],node);assert.equal(map.links[0],link);
});
test('actual construction branch preserves reversed existing links and manual nodes',()=>{
 for(const active of [true,false]){
 const node={systemId:2,customNotes:'manual',x:99};const link={id:'manual-link',sourceId:2,targetId:1,massStatus:'critical',sourceSig:'old',targetSig:'old',manual:'keep'};
 const state={nodes:new Map([[2,node]]),links:[link]},map={nodes:[node],links:[link]};
 assert.equal(apply(active,map,state),0);assert.equal(link.sourceSig,'BBB');assert.equal(link.targetSig,'AAA');assert.equal(link.massStatus,'critical');assert.equal(link.id,'manual-link');assert.equal(node.x,99);assert.equal(link.manual,'keep');assert.equal(state.links.length,1);assert.equal(map.links.length,1);
 }
});
