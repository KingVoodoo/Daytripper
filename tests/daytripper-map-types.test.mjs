import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

test('shared map contracts preserve main requirements and permissive serialized fields', () => {
 const filename=path.resolve('src/__map_contract_fixture__.ts');
 const source=`import type {WormholeNodeData, WormholeLinkData, DaytripperMapData} from './daytripper-map-types';
 import type {WormholeLink, DaytripperMapPage, SystemTacticalStatus} from './wormhole-chain-ui';
 const node: WormholeNodeData={systemId:1,systemName:'A',whClass:'C1',depth:0};
 const link: WormholeLinkData={id:'L',sourceId:1,targetId:2,massStatus:'stable'};
 const partial: DaytripperMapData={id:'M',name:'M',nodes:[node],links:[link],signatures:[]};
 const fullLink: WormholeLink={...link,lifetimeStatus:'stable',scoutHub:1,jumpLog:[]};
 const full: DaytripperMapPage={...partial,links:[fullLink],pan:{x:0,y:0},zoom:1,viewMode:'canvas'};
 const shared: DaytripperMapData=full;
 const tactical: SystemTacticalStatus='hole_control';
 // @ts-expect-error main runtime requires lifetimeStatus
 const badLink: WormholeLink=link;
 // @ts-expect-error main runtime requires viewport and required link lifetime
 const badMap: DaytripperMapPage=partial;
 // @ts-expect-error shared serialized signatures remain canonical arrays
 const badSignatures: DaytripperMapData={...partial,signatures:{1:[]}};
 const future={...full,unknownField:{retained:true}};
 const accepted: DaytripperMapData=future;
 `;
 const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
 const options=ts.parseJsonConfigFileContent(config.config,ts.sys,'.').options;
 const host=ts.createCompilerHost(options);const read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.readFile=p=>path.resolve(p)===filename?source:read(p);
 host.fileExists=p=>path.resolve(p)===filename||exists(p);
 const program=ts.createProgram([filename],options,host);
 const diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
});

test('shared contracts emit no runtime dependencies or data transformation',()=>{
 const text=fs.readFileSync('src/daytripper-map-types.ts','utf8');
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 assert.equal(js.trim(),'export {};');
});
