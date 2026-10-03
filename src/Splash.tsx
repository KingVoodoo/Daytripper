import {useEffect,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,LogIn,Pause,Play,Settings} from 'lucide-react';
import slides from './splash-slides.json';
import './splash.css';
type Pilot={id:string;name:string};
export function Splash({pilots,busy,message,native,onLogin,onEnter,onSettings}:{pilots:Pilot[];busy:boolean;message:string;native:boolean;onLogin:()=>void;onEnter:()=>void;onSettings:()=>void}){
 const [index,setIndex]=useState(0);
 const [paused,setPaused]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{if(paused)return;const timer=setInterval(()=>setIndex(i=>(i+1)%slides.length),9000);return()=>clearInterval(timer)},[paused]);
 const slide=slides[index];
 return <section className="splash" aria-label="Welcome to Daytripper">
  <div className="splash-hero"><img className="splash-background" src={`/splash/${slide.art}.png`} alt=""/>
  <main className="splash-content"><img className="splash-logo" src="/brand/daytripper.png" alt="Daytripper — Scan, map, explore, profit"/>
   <p className="splash-eyebrow">YOUR NEXT CONNECTION</p><h1>Chart your way<br/>through the unknown.</h1>
   <p className="splash-intro">Your standalone wormhole mapper. Scan signatures, build your chain, and keep the Mapping HUD beside EVE.</p>
   <div className="splash-actions"><button className="splash-primary" disabled={!native||busy} onClick={onLogin}><LogIn size={18}/>{busy?'Waiting for EVE…':pilots.length?'Add EVE character':'Sign in with EVE'}</button>
   <button disabled={busy} onClick={onEnter}>{pilots.length?'Enter Daytripper':'Continue locally'}<ArrowRight size={18}/></button></div>
   {pilots.length>0&&<p className="splash-pilots">Linked: {pilots.map(p=>p.name).join(', ')}</p>}
   <p className="splash-status" role="status">{message||(!native?'Browser preview. EVE sign-in and Mapping HUD are available in the desktop app.':'EVE sign-in opens securely in your browser.')}</p>
   <button className="splash-settings" onClick={onSettings}><Settings size={16}/>Settings</button>
  </main></div>
  <footer className="splash-feature"><div><p className="splash-eyebrow">{slide.region} / {String(index+1).padStart(2,'0')} OF 08</p><h2>{slide.title}</h2><p>{slide.description}</p></div>
   <nav aria-label="Splash slides"><button aria-label="Previous slide" onClick={()=>setIndex(i=>(i+7)%8)}><ChevronLeft size={18}/></button><button aria-label={paused?'Play slideshow':'Pause slideshow'} onClick={()=>setPaused(!paused)}>{paused?<Play size={18}/>:<Pause size={18}/>}</button><button aria-label="Next slide" onClick={()=>setIndex(i=>(i+1)%8)}><ChevronRight size={18}/></button></nav>
  </footer>
 </section>
}
