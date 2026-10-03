const key='daytripper_click_sounds';
let context:AudioContext|undefined;
export function soundsEnabled(){try{return localStorage.getItem(key)!=='off'}catch{return true}}
export function setSoundsEnabled(enabled:boolean){try{localStorage.setItem(key,enabled?'on':'off')}catch{/* The toggle still works when storage is unavailable. */}muted=!enabled;}
let muted=!soundsEnabled();
export function installClickSounds(){
 // Called only by the main app. The Mapping HUD never installs this listener.
 const click=(event:MouseEvent)=>{
  if(muted||!event.isTrusted||!(event.target instanceof Element))return;
  const button=event.target.closest('button,[role="button"]');
  if(!button||button.matches(':disabled,[aria-disabled="true"]')||button.closest('[inert]'))return;
  try{
   context??=new AudioContext();void context.resume().catch(()=>{});
   const tone=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
   tone.type='sine';tone.frequency.setValueAtTime(1150,now);tone.frequency.exponentialRampToValueAtTime(700,now+.045);
   gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.025,now+.004);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);
   tone.connect(gain);gain.connect(context.destination);tone.start(now);tone.stop(now+.06);tone.onended=()=>{tone.disconnect();gain.disconnect()};
  }catch{/* Audio failure must never block a control. */}
 };
 document.addEventListener('click',click,true);return()=>document.removeEventListener('click',click,true);
}
