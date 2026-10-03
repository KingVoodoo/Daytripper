import {useEffect,useState} from 'react';
import {getHomeSystem,saveHomeSystem,homeDisplayName} from './home-system';
import {universeGraph} from './universe-graph';
export function HomeSystemPicker(){
 const [query,setQuery]=useState(getHomeSystem()?.name||''),[choices,setChoices]=useState<{id:number;name:string}[]>([]),[status,setStatus]=useState('');
 const [label,setLabel]=useState(getHomeSystem()?.label||'');
 useEffect(()=>{void universeGraph.init().then(()=>setChoices(universeGraph.searchSystems(query,20)));},[query]);
 return <section className="home-picker"><h3>Home system</h3><p>Choose any known-space or wormhole system. New chains start here. Changing home keeps your existing chains.</p><label>System name<input list="home-systems" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search for your home system"/></label><datalist id="home-systems">{choices.map(s=><option key={s.id} value={s.name}/>)}</datalist><label>Home name (optional)<input value={label} maxLength={64} onChange={e=>setLabel(e.target.value)} placeholder="e.g. The Nest"/></label><p>Shown on your home map and HUD. Leave blank to use the EVE system name.</p><button onClick={()=>{const system=universeGraph.getSystemInfo(query.trim());if(!system){setStatus('Select a valid system from the universe.');return}saveHomeSystem({id:system.id,name:system.name,label});setStatus(`Home saved as ${label.trim()||system.name} (${system.name}).`);}}>Save home</button><p role="status">{status||(!getHomeSystem()?'No home system selected.':'Current home: '+homeDisplayName(getHomeSystem()!))}</p></section>;
}
