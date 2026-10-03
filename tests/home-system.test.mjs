import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
import {getHomeSystem,saveHomeSystem,HOME_KEY,homeDisplayName,systemDisplayName}from'../src/home-system.ts';
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};globalThis.window=new EventTarget();
test('home choice persists and rejects corrupt or invalid stored identities',()=>{values.clear();assert.equal(getHomeSystem(),null);saveHomeSystem({id:30002187,name:'Amarr'});assert.equal(getHomeSystem().name,'Amarr');values.set(HOME_KEY,'{');assert.equal(getHomeSystem(),null);values.set(HOME_KEY,JSON.stringify({id:-1,name:'bad'}));assert.equal(getHomeSystem(),null)});
const source=readFileSync(new URL('../src/wormhole-chain-ui.ts',import.meta.url),'utf8');const tree=ts.createSourceFile('mapper.ts',source,ts.ScriptTarget.Latest,true);const methods={};function walk(n){if(ts.isMethodDeclaration(n)&&n.name)methods[n.name.getText(tree)]=n.getText(tree);ts.forEachChild(n,walk)}walk(tree);
test('home aliases persist without changing EVE identity and blank names restore the system name',()=>{
 saveHomeSystem({id:30002187,name:'Amarr',label:'  The Nest  '});
 assert.equal(getHomeSystem().id,30002187);assert.equal(getHomeSystem().name,'Amarr');assert.equal(homeDisplayName(getHomeSystem()),'The Nest');
 assert.equal(systemDisplayName(30002187,'Amarr'),'The Nest');assert.equal(systemDisplayName(30000142,'Jita'),'Jita');
 saveHomeSystem({...getHomeSystem(),label:'   '});assert.equal(systemDisplayName(30002187,'Amarr'),'Amarr');
});
test('new chains start at chosen home with no invented gates or preset constellation',()=>{
 const context={getHomeSystem:()=>({id:31000005,name:'Thera'}),universeGraph:{getSystemInfo:()=>({id:31000005,name:'Thera',security:-.99})},getWormholeClass:()=> 'Thera'};
 const Harness=runInNewContext(ts.transpile(`class Harness{${methods.createDefaultPage}};Harness`),context);const page=new Harness().createDefaultPage('test','Test');assert.equal(page.nodes.length,1);assert.equal(page.nodes[0].systemName,'Thera');assert.equal(page.links.length,0);assert.equal(page.selectedSystemId,31000005);
 context.getHomeSystem=()=>null;const empty=new Harness().createDefaultPage('empty','Empty');assert.equal(empty.nodes.length,0);
});
test('retired preset no longer has special coordinates or jump mirroring',()=>{assert.doesNotMatch(source,/FD_MLJ|createFdMlj|fromId === 30003276|name: 'FD-MLJ'/)});
test('bundled routing data covers the full universe with valid endpoints',()=>{const data=JSON.parse(readFileSync(new URL('../public/universe.json',import.meta.url)));const ids=new Set(data.map.systems.map(s=>s.id));assert.ok(ids.size>8000);assert.ok(data.map.edges.length>6000);assert.ok(data.map.edges.every(([a,b])=>ids.has(a)&&ids.has(b)))});
