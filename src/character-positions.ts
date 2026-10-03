import type {ActiveShip} from './ship-summary';
export interface PositionCharacter {
  id:string;name:string;isMain:boolean;permitted:Record<string,boolean>;ship:ActiveShip|null;
  online?:{online:boolean|null;status:string;updated_at:number|null};
  location:{solar_system_id?:number|null;solar_system_name?:string|null;location_name?:string|null;updated_at?:number|null;status?:string;is_stale?:boolean;scope_missing?:boolean}|null;
}
export interface PositionHub {account:{id:string;name:string};characters:PositionCharacter[]}
export interface MapFilters {main:boolean;alts:boolean;online:boolean;offline:boolean;unknown:boolean}
export const defaultMapFilters:MapFilters={main:true,alts:false,online:true,offline:false,unknown:false};
export function matchesMapFilters(c:PositionCharacter,filters:MapFilters,corporation=false){
  if(!corporation&&c.isMain)return filters.main;
  if(!corporation&&!filters.alts)return false;
  const state=c.permitted?.online&&c.online?.status==='online'&&c.online.online===true?'online':c.permitted?.online&&c.online?.status==='offline'&&c.online.online===false?'offline':'unknown';
  return filters[state];
}
export function onlineSummary(c:Pick<PositionCharacter,'online'|'permitted'>){
  if(!c.permitted?.online)return 'Online status unavailable';
  if(c.online?.status==='offline'&&c.online.online===false)return 'Offline · slower location checks';
  if(c.online?.status==='online'&&c.online.online===true)return 'Online';
  return 'Online status unknown';
}
export function positionSummary(c:PositionCharacter,now=Date.now()) {
  const loc=c.location;
  if(!c.permitted?.location||loc?.scope_missing||loc?.status==='missing_scope')return {systemId:null,updatedAt:null,state:'Location permission unavailable'};
  const id=loc?.solar_system_id;
  if(!Number.isSafeInteger(id)||Number(id)<=0||loc?.status==='unavailable')return {systemId:null,updatedAt:null,state:'Location unavailable'};
  const time=loc?.updated_at;
  const updatedAt=typeof time==='number'&&Number.isFinite(time)&&time>0&&time<=now?time:null;
  const stale=loc?.is_stale||loc?.status==='stale'||(updatedAt!==null&&now-updatedAt>=300_000);
  return {systemId:Number(id),updatedAt,state:stale?'Stale location':updatedAt&&loc?.status==='fresh'?'Last reported location':'Location age unknown'};
}
export function positionGroups(characters:PositionCharacter[],hidden:Set<string>,now=Date.now()) {
  const groups=new Map<number,PositionCharacter[]>();
  for(const c of characters){const p=positionSummary(c,now);if(hidden.has(c.id)||p.systemId===null)continue;const group=groups.get(p.systemId)||[];group.push(c);groups.set(p.systemId,group);}
  return groups;
}
