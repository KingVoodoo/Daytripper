export const HOME_KEY='daytripper_home_system';
export interface HomeSystem{id:number;name:string;label?:string}
export function getHomeSystem():HomeSystem|null{
 try{const value=JSON.parse(localStorage.getItem(HOME_KEY)||'null');return value&&Number.isSafeInteger(value.id)&&value.id>0&&typeof value.name==='string'?value:null;}catch{return null;}
}
export function homeDisplayName(home:HomeSystem):string{return typeof home.label==='string'&&home.label.trim()?home.label.trim():home.name;}
export function systemDisplayName(id:number,name:string):string{const home=getHomeSystem();return home?.id===id?homeDisplayName(home):name;}
export function saveHomeSystem(value:HomeSystem){const label=value.label?.trim().slice(0,64);localStorage.setItem(HOME_KEY,JSON.stringify({...value,label:label||undefined}));window.dispatchEvent(new Event('daytripper-home-changed'));}
