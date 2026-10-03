import {call,native} from './bridge';
const owned=(key:string)=>key.startsWith('wok')||key.startsWith('daytripper');
export async function initPersistence(){
 if(!native)return;
 const saved=await call<Record<string,string>>('load_workspace');
 // localStorage is the shared WebView working copy; SQLite is the restart backup.
 if(!Object.keys(localStorage).some(owned))for(const [key,value]of Object.entries(saved))if(owned(key))localStorage.setItem(key,value);
 let last='',running=false;
 const save=async()=>{if(running)return;const data=Object.fromEntries(Object.keys(localStorage).filter(owned).sort().map(key=>[key,localStorage.getItem(key)!]));const json=JSON.stringify(data);if(json===last)return;running=true;try{await call('save_workspace',{data});last=json;}catch(error){window.dispatchEvent(new CustomEvent('persistence-error',{detail:String(error)}));}finally{running=false}};
 setInterval(()=>void save(),750);window.addEventListener('blur',()=>void save());
}
