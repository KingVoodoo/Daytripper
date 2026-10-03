export function escapeDaytripperText(value:unknown):string {
 return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

export function validSharedChain(chain:any):boolean {
 if(!chain||!Array.isArray(chain.nodes)||chain.nodes.length>1000||!Array.isArray(chain.links)||chain.links.length>2000||!Array.isArray(chain.signatures)||chain.signatures.length>1000)return false;
 let fields=0,strings=0;
 const walk=(v:any,depth=0):boolean=>{
  if(depth>12||++fields>100000)return false;
  if(typeof v==='string'){strings+=v.length;return v.length<=4096&&strings<=500000;}
  if(typeof v==='number')return Number.isFinite(v);
  if(v&&typeof v==='object'){if(Array.isArray(v)&&v.length>5000)return false;for(const [k,x]of Object.entries(v)){if(k.length>128||!walk(x,depth+1))return false;}}
  return true;
 };
 if(!walk(chain))return false;
 const ids=new Set<number>();
 for(const n of chain.nodes){if(!n||!Number.isSafeInteger(n.systemId)||n.systemId<=0||ids.has(n.systemId)||typeof n.systemName!=='string'||typeof n.whClass!=='string'||!Number.isFinite(n.depth))return false;ids.add(n.systemId);}
 const links=new Set<string>();
 for(const l of chain.links){if(!l||typeof l.id!=='string'||!l.id||links.has(l.id)||!ids.has(l.sourceId)||!ids.has(l.targetId))return false;links.add(l.id);}
 let count=0;const systems=new Set<number>();
 for(const s of chain.signatures){if(!s||!ids.has(s.systemId)||systems.has(s.systemId)||!Array.isArray(s.sigs)||s.sigs.length>500)return false;systems.add(s.systemId);count+=s.sigs.length;if(count>5000)return false;for(const sig of s.sigs)if(!sig||typeof sig.id!=='string'||typeof sig.name!=='string')return false;}
 return true;
}

// Unlike EventSource, this reader caps an event before accumulating/decoding it.
// Reconnection remains the caller's responsibility, so every reconnect obtains
// a fresh one-use ticket and rechecks the current backend grant.
export class BoundedDaytripperStream {
 readyState=0;
 onopen:(()=>void)|null=null;
 onmessage:((event:{data:string})=>void)|null=null;
 onerror:((error:unknown)=>void)|null=null;
 private controller=new AbortController();
 constructor(url:string){void this.read(url);}
 close(){this.readyState=2;this.controller.abort();}
 private async read(url:string){
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await fetch(url,{signal:this.controller.signal,credentials:'omit',headers:{Accept:'text/event-stream'}});
   if(!response.ok||!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')||!response.body)throw new Error('Invalid Daytripper stream.');
   reader=response.body.getReader();this.readyState=1;this.onopen?.();
   const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',data='',eventBytes=0;
   while(this.readyState===1){
    const {done,value}=await reader.read();if(done)throw new Error('Daytripper stream ended.');
    // Slice transport chunks before decoding; never build an unbounded event.
    for(let offset=0;offset<value.length;offset+=16384){
     const slice=value.subarray(offset,offset+16384);
     eventBytes+=slice.length;
     if(eventBytes>2000000)throw new Error('Daytripper event exceeds the byte limit.');
     pending+=decoder.decode(slice,{stream:true});
     let newline:number;
     while((newline=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,newline).replace(/\r$/,'');pending=pending.slice(newline+1);
      if(!line){if(data)this.onmessage?.({data:data.slice(0,-1)});if(this.readyState!==1)return;data='';eventBytes=new TextEncoder().encode(pending).length;}
      else if(line.startsWith('data:'))data+=line.slice(5).replace(/^ /,'')+'\n';
     }
    }
   }
  }catch(error){if(!this.controller.signal.aborted){this.readyState=2;this.onerror?.(error);}}
  finally{if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
 }
}
