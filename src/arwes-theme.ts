import {createFrame,createFrameOctagonSettings,createFrameCornersSettings,animateFrameAssembler,type Frame} from '@arwes/frames';
import {cspSafeFrame} from './arwes-frame-math';

const panels=['.app-header','.wh-header','.wh-canvas-viewport','.wh-canvas-node','.wh-node-item','.wh-inspector-status-bar','.wh-inspector-rundown-box','.wh-inspector-connections-card','.wh-inspector-routes-card','.wh-inspector-sov-card','.wh-inspector-zkill-card','.wh-inspector-notes-section','.wh-sig-panel','.wh-sig-section','.wh-scout-card','.wh-guide-hero','.wh-guide-section-card','.wh-bm-builder-form','.wh-guide-cheatsheet-card','.wh-guide-folder-card','.wh-legend-card','.wh-modal-box','.wh-roll-modal-box','.wh-confirm-dialog','.settings-panel','.splash-feature','.splash-content','.wh-canvas-legend-corner'];
const selector=['button',...panels].join(',');

/** Decorates existing controls with real Arwes SVG frames without replacing their DOM or handlers. */
export function installArwesTheme(){
 if(document.documentElement.classList.contains('overlay-window'))return()=>{};
 const frames=new Map<HTMLElement,{svg:SVGSVGElement;frame:Frame;animation?:ReturnType<typeof animateFrameAssembler>}>();
 const pending=new Set<HTMLElement>();let raf=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const decorate=(host:HTMLElement)=>{
  if(!host.isConnected||frames.has(host)||host.closest('.overlay-window'))return;
  if(getComputedStyle(host).position==='static')host.style.position='relative';
  host.classList.add('dt-framed');
  const small=host.matches('button');
  const corners=host.matches('.splash-content,.wh-canvas-viewport');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('dt-arwes-frame');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  host.append(svg);
  const settings=corners?createFrameCornersSettings({animated:false,cornerLength:28,strokeWidth:1}):createFrameOctagonSettings({animated:false,squareSize:small?5:12,leftTop:false,rightTop:true,leftBottom:true,rightBottom:false});
  const frame=createFrame(svg,cspSafeFrame(settings));
  const record:{svg:SVGSVGElement;frame:Frame;animation?:ReturnType<typeof animateFrameAssembler>}={svg,frame};
  frames.set(host,record);
  if(!small&&!reduced.matches&&host.getBoundingClientRect().width>0){record.animation=animateFrameAssembler({element:svg,duration:.35});}
 };
 const collect=(node:HTMLElement)=>{if(node.matches(selector))pending.add(node);node.querySelectorAll<HTMLElement>(selector).forEach(el=>pending.add(el));};
 const flush=()=>{
  raf=0;
  for(const [host,record]of frames){if(!host.isConnected||!host.contains(record.svg)){record.animation?.cancel();record.frame.remove();frames.delete(host);if(host.isConnected)pending.add(host)}}
  for(const host of pending)decorate(host);pending.clear();
 };
 collect(document.body);flush();
 const observer=new MutationObserver(records=>{
  let changed=false;
  for(const record of records){if(record.type === 'attributes' && record.target instanceof HTMLElement && frames.has(record.target) && !record.target.classList.contains('dt-framed')){record.target.classList.add('dt-framed')}for(const node of record.addedNodes){if(node instanceof HTMLElement){collect(node);changed=true}}
   if(record.removedNodes.length){changed=true;if(record.target instanceof HTMLElement&&record.target.matches(selector))pending.add(record.target)}
  }
  if(changed&&!raf)raf=requestAnimationFrame(flush);
 });
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 return()=>{observer.disconnect();cancelAnimationFrame(raf);for(const[host,record]of frames){record.animation?.cancel();record.frame.remove();record.svg.remove();host.classList.remove('dt-framed')}frames.clear()};
}


