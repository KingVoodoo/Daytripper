import {build} from 'esbuild';
import fs from 'node:fs';
await build({entryPoints:['src/arwes-callback.ts'],bundle:true,format:'iife',minify:true,target:'es2022',outfile:'src-tauri/src/arwes-callback.js',legalComments:'inline'});
const font=(name,file,weight)=>`@font-face{font-family:'${name}';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}) format('woff2')}`;
fs.writeFileSync('src-tauri/src/callback-fonts.css',[
 font('Orbitron','node_modules/@fontsource/orbitron/files/orbitron-latin-600-normal.woff2',600),
 font('Rajdhani','node_modules/@fontsource/rajdhani/files/rajdhani-latin-500-normal.woff2',500),
 font('Share Tech Mono','node_modules/@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff2',400)
].join('\n'));
