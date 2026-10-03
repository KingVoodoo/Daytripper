import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen,emit} from '@tauri-apps/api/event';
export const native=isTauri();
export async function call<T=unknown>(command:string,args:Record<string,unknown>={}):Promise<T>{
  if(command==='connection_status') return {url:'',signedIn:native && (await invoke<any[]>('characters')).length>0} as T;
  if(command==='fleet_status') return {inFleet:false} as T;
  if(!native) throw new Error('EVE sign-in and pilot tracking require the Daytripper desktop app.');
  return invoke<T>(command,args);
}
export async function onEvent<T>(name:string,handler:(payload:T)=>void){
  if(native) return listen<T>(name,event=>handler(event.payload));
  const fn=(event:Event)=>handler((event as CustomEvent<T>).detail);
  window.addEventListener(name,fn);return ()=>window.removeEventListener(name,fn);
}
export async function emitEvent(name:string,payload:unknown){if(native)await emit(name,payload);else window.dispatchEvent(new CustomEvent(name,{detail:payload}));}
export async function copyToClipboard(text:string){if(native)await call('set_clipboard_text',{text});else await navigator.clipboard.writeText(text);}
export const isStandaloneModule=(_id?:string)=>true;
export const popoutModule=async (id:string)=>call('open_module',{id});
export async function setAutopilotDestination(systemId:number,options?:{characterId?:string;clearOtherWaypoints?:boolean;addToBeginning?:boolean}){return call('set_waypoint',{systemId,characterId:options?.characterId||localStorage.getItem('wok_daytripper_scanner_pilot')||null,clearOtherWaypoints:options?.clearOtherWaypoints??true,addToBeginning:options?.addToBeginning??false});}
