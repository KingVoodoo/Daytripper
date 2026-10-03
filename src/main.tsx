import {installArwesTheme} from './arwes-theme';
import '@fontsource/orbitron/600.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/share-tech-mono';
import {installClickSounds,soundsEnabled,setSoundsEnabled} from './ui-click-sounds';
import {Splash} from './Splash';
import {HomeSystemPicker} from './HomeSystemPicker';
import {getHomeSystem} from './home-system';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LogIn,Settings,PanelTop,UserMinus,X} from 'lucide-react';
import {call,native,onEvent} from './bridge';
import {mountDaytripper} from './daytripper-page';
import {MappingOverlayWindow} from './MappingOverlayWindow';
import {initPersistence} from './persistence';
import './ui/tokens.css';
import './ui/host-chrome.css';
import './app.css';
import './main-scifi.css';
function App(){
 const [sound,setSound]=useState(soundsEnabled);
 useEffect(installClickSounds,[]);
 useEffect(installArwesTheme,[]);
 const [splash,setSplash]=useState(true);
 const mapper=useRef<HTMLDivElement>(null);const mounted=useRef(false);
 const [settings,setSettings]=useState(false),[clientId,setClientId]=useState(''),[pilots,setPilots]=useState<{id:string;name:string}[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>{if(native){setPilots(await call('characters'));const auth=await call<{clientId:string}>('auth_settings');setClientId(auth.clientId);if(!auth.clientId)setSettings(true)}};
 useEffect(()=>{if(!mounted.current&&mapper.current){mounted.current=true;void mountDaytripper(mapper.current).catch(e=>setMessage(String(e)))}void refresh().catch(e=>setMessage(String(e)));let dispose:(()=>void)|undefined;void onEvent('characters-changed',()=>void refresh()).then(fn=>dispose=fn);const fail=(e:Event)=>setMessage((e as CustomEvent).detail);window.addEventListener('persistence-error',fail);return()=>{dispose?.();window.removeEventListener('persistence-error',fail)}},[]);
 const login=async()=>{if(!clientId){setSettings(true);return}setBusy(true);setMessage('Complete EVE sign-in in your browser.');try{await call('sign_in');await refresh();setMessage('Character linked. Pilot tracking is active.')}catch(e){setMessage(String(e))}finally{setBusy(false)}};
 return <><div inert={splash||settings}><header className="app-header"><div className="brand"><img src="/brand/daytripper.png" alt="" width={36} height={36}/><strong>Daytripper</strong><span>Standalone wormhole mapper</span></div><nav><button aria-label="Button click sounds" aria-pressed={sound} onClick={()=>{setSoundsEnabled(!sound);setSound(!sound)}}>Sound {sound?'on':'off'}</button><button onClick={()=>void call('open_module',{id:'mapping-overlay'}).catch(e=>setMessage(String(e)))}><PanelTop size={18}/>Mapping HUD</button><button disabled={!native||busy} onClick={()=>setSplash(true)}><LogIn size={18}/>Characters</button><button onClick={()=>setSettings(true)}><Settings size={18}/>Settings</button></nav></header>{(!native||message)&&<div className="app-status" role="status">{message||'Browser preview — launch the desktop app for EVE sign-in, pilot tracking, and the overlay.'}</div>}<div ref={mapper} className="mapper-host"/></div>{splash&&<div inert={settings}><Splash pilots={pilots} busy={busy} message={message} native={native} onLogin={()=>void login()} onEnter={()=>setSplash(false)} onSettings={()=>setSettings(true)}/></div> }{settings&&<div className="settings-shade"><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><h2 id="settings-title">Daytripper settings</h2><button aria-label="Close settings" onClick={()=>setSettings(false)}><X size={20}/></button></header><p>Maps, signatures, notes, and settings stay on this PC. EVE credentials are protected by Windows Credential Manager.</p><HomeSystemPicker/><label>EVE application Client ID<input value={clientId} onChange={e=>setClientId(e.target.value.trim())}/></label><p>Register an EVE application with callback <code>http://localhost:17321/callback</code>. Use the four scopes below. No client secret is required.</p><pre>esi-location.read_location.v1{'\n'}esi-location.read_online.v1{'\n'}esi-location.read_ship_type.v1{'\n'}esi-ui.write_waypoint.v1</pre><button disabled={!native||!clientId||busy} onClick={()=>void call('set_client_id',{clientId}).then(()=>{setMessage('EVE application settings saved.');setSettings(false)}).catch(e=>setMessage(String(e)))}>Save Client ID</button><h3>Linked characters</h3>{pilots.length===0?<p>No characters linked yet.</p>:pilots.map(p=><div className="pilot-row" key={p.id}><span>{p.name}</span><button aria-label={`Remove ${p.name}`} onClick={()=>void call('remove_character',{id:p.id}).then(refresh).catch(e=>setMessage(String(e)))}><UserMinus size={18}/>Remove</button></div>)}<p>Removing a character stops tracking it and removes its local credential. Your maps remain saved.</p>{message&&<p role="status">{message}</p>}</section></div>}</>;
}
async function start(){await initPersistence();const overlay=new URLSearchParams(location.search).has('overlay');document.documentElement.classList.add(overlay?'overlay-window':'main-window');createRoot(document.getElementById('root')!).render(overlay?<MappingOverlayWindow/>:<App/>);}
void start().catch(error=>{document.getElementById('root')!.textContent=`Daytripper could not load local storage: ${error}`});
