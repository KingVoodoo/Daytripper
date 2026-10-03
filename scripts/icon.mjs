import {execFileSync} from 'node:child_process';
execFileSync(process.platform==='win32'?'npx.cmd':'npx',['tauri','icon','public/brand/daytripper.png'],{stdio:'inherit',shell:process.platform==='win32'});
