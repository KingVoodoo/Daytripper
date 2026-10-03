use base64::{engine::general_purpose::URL_SAFE_NO_PAD,Engine};
use rand::RngCore;
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::{Emitter,Manager};
use tokio::{io::{AsyncReadExt,AsyncWriteExt},sync::Mutex};
use crate::store::Store;
pub const CALLBACK:&str="http://localhost:17321/callback";
pub const DEFAULT_CLIENT_ID:&str="6b46b6f62f054b0cbb8d98c9e7856647";
pub const SCOPES:&str="esi-location.read_location.v1 esi-location.read_online.v1 esi-location.read_ship_type.v1 esi-ui.write_waypoint.v1";
#[derive(Default)]pub struct Auth {pub gate:Mutex<()>,pub login:Mutex<()>}
#[derive(Serialize,Deserialize,Clone)]pub struct Character {pub id:String,pub name:String}
#[derive(Serialize,Deserialize)]struct Token {access_token:String,refresh_token:String,expires_in:u64,#[serde(default)]expires_at:u64}
#[derive(Deserialize)]struct Claims{sub:String,name:String,exp:u64}
pub fn now()->u64{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()}
pub fn client()->Result<reqwest::Client,String>{reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(15)).user_agent("Daytripper/0.1.0").build().map_err(|e|e.to_string())}
pub async fn json_response(mut response:reqwest::Response)->Result<Value,String>{
 if !response.status().is_success(){return Err(format!("EVE request failed ({})",response.status()))}
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{if bytes.len()+chunk.len()>8_000_000{return Err("Response too large".into())}bytes.extend_from_slice(&chunk)}
 serde_json::from_slice(&bytes).map_err(|e|e.to_string())
}
fn entry(client_id:&str,id:&str)->Result<keyring::Entry,String>{keyring::Entry::new("Daytripper.EVE",&format!("{client_id}:{id}")).map_err(|e|e.to_string())}
pub fn list(store:&Store)->Result<Vec<Character>,String>{serde_json::from_str(&store.get("characters")?.unwrap_or_else(||"[]".into())).map_err(|e|e.to_string())}
#[tauri::command]pub fn characters(store:tauri::State<Store>)->Result<Vec<Character>,String>{list(&store)}
#[tauri::command]pub fn auth_settings(store:tauri::State<Store>)->Result<Value,String>{Ok(json!({"clientId":store.get("client_id")?.unwrap_or_default(),"callback":CALLBACK,"scopes":SCOPES}))}
#[tauri::command]pub async fn set_client_id(app:tauri::AppHandle,client_id:String)->Result<(),String>{
 if client_id.len()<10||client_id.len()>128||!client_id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'){return Err("Enter a valid public EVE application Client ID".into())}
 let auth=app.state::<Auth>();let _login=auth.login.try_lock().map_err(|_|"Finish or cancel the current login first")?;let _guard=auth.gate.lock().await;
 let store=app.state::<Store>();if !list(&store)?.is_empty()&&store.get("client_id")?.as_deref()!=Some(&client_id){return Err("Remove linked characters before changing the Client ID".into())}store.set("client_id",&client_id)
}
fn random()->String{let mut bytes=[0;32];rand::thread_rng().fill_bytes(&mut bytes);URL_SAFE_NO_PAD.encode(bytes)}
async fn validate(token:&str,client_id:&str)->Result<Claims,String>{
 use jsonwebtoken::{decode,decode_header,DecodingKey,Validation,Algorithm,jwk::JwkSet};
 let header=decode_header(token).map_err(|_|"Invalid EVE token")?;
 if header.alg!=Algorithm::RS256{return Err("Unexpected token algorithm".into())}
 let keys: JwkSet=serde_json::from_value(json_response(client()?.get("https://login.eveonline.com/oauth/jwks").send().await.map_err(|e|e.to_string())?).await?).map_err(|e|e.to_string())?;
 let key=keys.find(header.kid.as_deref().ok_or("Missing token key")?).ok_or("Unknown token key")?;
 let mut rules=Validation::new(Algorithm::RS256);rules.set_audience(&[client_id]);rules.set_issuer(&["https://login.eveonline.com","login.eveonline.com"]);
 let data=decode::<Claims>(token,&DecodingKey::from_jwk(key).map_err(|e|e.to_string())?,&rules).map_err(|_|"EVE token validation failed")?;
 // EVE tokens must also target EVE Online in addition to this application.
 let payload=token.split('.').nth(1).ok_or("Invalid token")?;
 let raw:Value=serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).map_err(|_|"Invalid token")?).map_err(|_|"Invalid token")?;
 if !raw["aud"].as_array().is_some_and(|a|a.iter().any(|v|v=="EVE Online")){return Err("Missing EVE audience".into())}
 if !data.claims.sub.starts_with("CHARACTER:EVE:"){return Err("Invalid character identity".into())}Ok(data.claims)
}
#[tauri::command]pub async fn sign_in(app:tauri::AppHandle)->Result<Character,String>{
 let auth=app.state::<Auth>();let _login=auth.login.try_lock().map_err(|_|"A sign-in is already in progress")?;
 let client_id=app.state::<Store>().get("client_id")?.ok_or("Enter your EVE Client ID first")?;
 let listener=tokio::net::TcpListener::bind("127.0.0.1:17321").await.map_err(|_|"Sign-in callback port 17321 is already in use")?;
 let verifier=random();let state=random();let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
 let mut url=reqwest::Url::parse("https://login.eveonline.com/v2/oauth/authorize/").unwrap();
 url.query_pairs_mut().extend_pairs([("response_type","code"),("client_id",client_id.as_str()),("redirect_uri",CALLBACK),("scope",SCOPES),("state",state.as_str()),("code_challenge",challenge.as_str()),("code_challenge_method","S256")]);
 open::that(url.as_str()).map_err(|e|e.to_string())?;
 let (code,mut callback_stream)=tokio::time::timeout(std::time::Duration::from_secs(180),async{
  loop {let(mut stream,_)=listener.accept().await.map_err(|e|e.to_string())?;let mut buffer=vec![0;8192];
   let n=tokio::time::timeout(std::time::Duration::from_secs(3),stream.read(&mut buffer)).await.map_err(|_|"Callback timed out")?.map_err(|e|e.to_string())?;
   let request=String::from_utf8_lossy(&buffer[..n]);let target=request.lines().next().and_then(|v|v.strip_prefix("GET ")).and_then(|v|v.split(' ').next()).unwrap_or("");
   let parsed=reqwest::Url::parse(&format!("http://localhost:17321{target}")).map_err(|_|"Invalid callback")?;
   let query:std::collections::HashMap<_,_>=parsed.query_pairs().into_owned().collect();
   if parsed.path()!="/callback"||query.get("state")!=Some(&state){let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").await;continue}
   let result=query.get("code").cloned().ok_or_else(||"EVE sign-in was cancelled or denied".to_string());
   return Ok::<_,String>((result,stream));
  }
 }).await.map_err(|_|"EVE sign-in timed out; try again")??;
 let result=async {
 let code=code?;
 let value=json_response(client()?.post("https://login.eveonline.com/v2/oauth/token").form(&[("grant_type","authorization_code"),("code",code.as_str()),("client_id",client_id.as_str()),("code_verifier",verifier.as_str()),("redirect_uri",CALLBACK)]).send().await.map_err(|e|e.to_string())?).await?;
 let mut token:Token=serde_json::from_value(value).map_err(|_|"Invalid token response")?;let claims=validate(&token.access_token,&client_id).await?;
 let id=claims.sub.strip_prefix("CHARACTER:EVE:").ok_or("Invalid subject")?.to_string();id.parse::<u64>().map_err(|_|"Invalid character ID")?;
 token.expires_at=claims.exp;let character=Character{id,name:claims.name};let _guard=auth.gate.lock().await;
 entry(&client_id,&character.id)?.set_password(&serde_json::to_string(&token).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let store=app.state::<Store>();let mut all=list(&store)?;all.retain(|c|c.id!=character.id);all.push(character.clone());store.set("characters",&serde_json::to_string(&all).map_err(|e|e.to_string())?)?;
 let _=app.emit("characters-changed",());Ok(character)
 }.await;
 crate::callback::reply(&app,&mut callback_stream,&result).await;
 result
}
pub async fn access(app:&tauri::AppHandle,id:&str)->Result<String,String>{
 let auth=app.state::<Auth>();let _guard=auth.gate.lock().await;let store=app.state::<Store>();
 if !list(&store)?.iter().any(|c|c.id==id){return Err("Character is not linked".into())}
 let client_id=store.get("client_id")?.ok_or("Missing Client ID")?;let key=entry(&client_id,id)?;
 let mut token:Token=serde_json::from_str(&key.get_password().map_err(|_|"Sign in to this character again")?).map_err(|_|"Invalid saved credential")?;
 if token.expires_at<=now()+60{
  let value=json_response(client()?.post("https://login.eveonline.com/v2/oauth/token").form(&[("grant_type","refresh_token"),("refresh_token",token.refresh_token.as_str()),("client_id",client_id.as_str())]).send().await.map_err(|e|e.to_string())?).await?;
  let next:Token=serde_json::from_value(value).map_err(|_|"Invalid refresh response")?;let claims=validate(&next.access_token,&client_id).await?;
  if claims.sub!=format!("CHARACTER:EVE:{id}"){return Err("Refreshed identity mismatch".into())}token=next;token.expires_at=claims.exp;
  key.set_password(&serde_json::to_string(&token).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 }Ok(token.access_token)
}
#[tauri::command]pub async fn remove_character(app:tauri::AppHandle,id:String)->Result<(),String>{
 let auth=app.state::<Auth>();let _guard=auth.gate.lock().await;let store=app.state::<Store>();let client_id=store.get("client_id")?.ok_or("Missing Client ID")?;
 match entry(&client_id,&id)?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>(),Err(e)=>return Err(e.to_string())}
 let mut all=list(&store)?;all.retain(|c|c.id!=id);store.set("characters",&serde_json::to_string(&all).map_err(|e|e.to_string())?)?;let _=app.emit("characters-changed",());Ok(())
}
