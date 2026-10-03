use rusqlite::{params, Connection};
use serde_json::Value;
use std::{collections::BTreeMap, path::PathBuf};
pub struct Store(pub PathBuf);
impl Store {
 pub fn open(&self)->Result<Connection,String>{
  let db=Connection::open(&self.0).map_err(|e|e.to_string())?;
  db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
  db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|e|e.to_string())?;Ok(db)
 }
 pub fn get(&self,key:&str)->Result<Option<String>,String>{use rusqlite::OptionalExtension; self.open()?.query_row("SELECT value FROM settings WHERE key=?",[key],|r|r.get(0)).optional().map_err(|e|e.to_string())}
 pub fn set(&self,key:&str,value:&str)->Result<(),String>{self.open()?.execute("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|e|e.to_string())?;Ok(())}
}
#[tauri::command]
pub fn load_workspace(store:tauri::State<Store>)->Result<Value,String>{Ok(serde_json::from_str(&store.get("workspace")?.unwrap_or_else(||"{}".into())).map_err(|e|e.to_string())?)}
#[tauri::command]
pub fn save_workspace(store:tauri::State<Store>,data:BTreeMap<String,String>)->Result<(),String>{
 let json=serde_json::to_string(&data).map_err(|e|e.to_string())?;
 if json.len()>10_000_000{return Err("Workspace exceeds 10 MB".into())}
 if data.keys().any(|k|!(k.starts_with("wok")||k.starts_with("daytripper"))){return Err("Invalid workspace key".into())}
 store.set("workspace",&json)
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn local_store_survives_reopen_and_keeps_configuration_separate(){
  let path=std::env::temp_dir().join(format!("daytripper-test-{}-{}.sqlite3",std::process::id(),crate::auth::now()));
  {let store=Store(path.clone());store.set("client_id","public-id").unwrap();store.set("workspace",r#"{"daytripper_home_system":"Amarr"}"#).unwrap();}
  {let store=Store(path.clone());assert_eq!(store.get("client_id").unwrap().unwrap(),"public-id");assert!(store.get("workspace").unwrap().unwrap().contains("Amarr"));store.set("workspace","{}").unwrap();assert_eq!(store.get("client_id").unwrap().unwrap(),"public-id");}
  std::fs::remove_file(path).unwrap();
 }
}
