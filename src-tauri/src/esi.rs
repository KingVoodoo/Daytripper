use std::collections::HashMap;
use serde_json::{json,Value};
use tauri::Manager;
use tokio::sync::Mutex;
use crate::{auth,store::Store};
#[derive(Default)]pub struct Esi {pub cache:Mutex<HashMap<String,(u64,Value)>>,pub blocked_until:Mutex<u64>,pub poll:Mutex<()>}
async fn get(app:&tauri::AppHandle,path:&str,character:Option<&str>,ttl:u64)->Result<Value,String>{
 let state=app.state::<Esi>();let key=format!("{}:{path}",character.unwrap_or("public"));
 if let Some((time,value))=state.cache.lock().await.get(&key){if auth::now()<time+ttl{return Ok(value.clone())}}
 if *state.blocked_until.lock().await>auth::now(){return Err("ESI is rate limited; retrying after cooldown".into())}
 let mut request=auth::client()?.get(format!("https://esi.evetech.net/latest/{path}"));
 if let Some(id)=character{request=request.bearer_auth(auth::access(app,id).await?)}
 let response=request.send().await.map_err(|e|e.to_string())?;
 if matches!(response.status().as_u16(),420|429){let delay=response.headers().get("retry-after").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).unwrap_or(60).clamp(1,3600);*state.blocked_until.lock().await=auth::now()+delay;return Err("ESI rate limit reached; waiting before retry".into())}
 let value=auth::json_response(response).await?;state.cache.lock().await.insert(key,(auth::now(),value.clone()));Ok(value)
}
#[tauri::command]pub async fn character_hub(app:tauri::AppHandle)->Result<Value,String>{
 let state=app.state::<Esi>();let _poll=state.poll.lock().await;let characters=auth::list(&app.state::<Store>())?;let mut output=Vec::new();
 for c in characters {
  let path=format!("characters/{}/location/",c.id);let previous=state.cache.lock().await.get(&format!("{}:{path}",c.id)).cloned();
  let location=get(&app,&path,Some(&c.id),5).await;
  let online=get(&app,&format!("characters/{}/online/",c.id),Some(&c.id),60).await;
  let ship=get(&app,&format!("characters/{}/ship/",c.id),Some(&c.id),5).await;
  let (mut loc,stamp,stale)=match location {Ok(v)=>{let stamp=state.cache.lock().await.get(&format!("{}:{path}",c.id)).map(|v|v.0).unwrap_or(auth::now());(v,stamp,false)},Err(_)=>match previous{Some((t,v))=>(v,t,true),None=>(json!({}),0,true)}};
  loc["updated_at"]=json!(stamp*1000);loc["is_stale"]=json!(stale);loc["status"]=json!(if stale{"stale"}else{"fresh"});
  let mut hull=ship.unwrap_or(Value::Null);if let Some(id)=hull["ship_type_id"].as_u64(){if let Ok(info)=get(&app,&format!("universe/types/{id}/"),None,86400).await{hull["type_name"]=info["name"].clone();hull["mass"]=info["mass"].clone();}}
  let online=online.ok().and_then(|v|v["online"].as_bool());
  output.push(json!({"id":c.id,"name":c.name,"isMain":output.is_empty(),"permitted":{"location":true,"online":true,"ship":true},"location":loc,"ship":hull,"online":{"online":online,"status":match online{Some(true)=>"online",Some(false)=>"offline",None=>"unknown"},"updated_at":auth::now()*1000}}));
 }
 Ok(json!({"account":{"id":"local","name":"Daytripper"},"characters":output}))
}
#[tauri::command]pub async fn set_waypoint(app:tauri::AppHandle,system_id:u64,character_id:Option<String>,clear_other_waypoints:Option<bool>,add_to_beginning:Option<bool>)->Result<(),String>{
 if system_id==0||system_id>i32::MAX as u64{return Err("Invalid destination".into())}
 let id=match character_id{Some(id)=>id,None=>auth::list(&app.state::<Store>())?.first().ok_or("Sign in a character first")?.id.clone()};
 let token=auth::access(&app,&id).await?;
 let response=auth::client()?.post("https://esi.evetech.net/latest/ui/autopilot/waypoint/").bearer_auth(token).query(&[("destination_id",system_id.to_string()),("clear_other_waypoints",clear_other_waypoints.unwrap_or(true).to_string()),("add_to_beginning",add_to_beginning.unwrap_or(false).to_string())]).send().await.map_err(|e|e.to_string())?;
 if !response.status().is_success(){return Err(format!("Waypoint failed ({})",response.status()))}Ok(())
}
