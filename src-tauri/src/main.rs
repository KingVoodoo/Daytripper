#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod portrait; mod callback; mod auth; mod esi; mod store;
mod clipboard_watch; mod eve_clients; mod gamelog_watch; mod local_system_log;
use tauri::Manager;
#[derive(Default)]struct OverlayState { opening: tokio::sync::Mutex<()>, mounted: std::sync::atomic::AtomicUsize }
#[tauri::command]fn overlay_ready(window:tauri::WebviewWindow,state:tauri::State<OverlayState>)->Result<(),String>{
 if window.label()!="mapping-overlay"{return Err("Not an overlay window".into())}
 state.mounted.fetch_add(1,std::sync::atomic::Ordering::SeqCst);eprintln!("Mapping HUD frontend mounted");Ok(())
}
#[tauri::command]fn open_url(url:String)->Result<(),String>{let parsed=reqwest::Url::parse(&url).map_err(|_|"Invalid URL")?;if parsed.scheme()!="https"||!matches!(parsed.host_str(),Some("zkillboard.com"|"evemaps.dotlan.net"|"wiki.eveuniversity.org"|"developers.eveonline.com")){return Err("URL is not allowed".into())}open::that(url).map_err(|e|e.to_string())}
// WebView2 window creation deadlocks in synchronous IPC handlers on Windows.
#[tauri::command]async fn open_module(app:tauri::AppHandle,id:String)->Result<(),String>{
 let state=app.state::<OverlayState>();let _opening=state.opening.lock().await;
 if id!="mapping-overlay" && id!="daytripper" && id!="map"{return Err("Unknown module".into())}
 if id!="mapping-overlay" {let window=app.get_webview_window("main").ok_or("Main window unavailable")?;window.show().map_err(|e|e.to_string())?;return window.set_focus().map_err(|e|e.to_string())}
 if let Some(window)=app.get_webview_window("mapping-overlay"){return window.show().map_err(|e|e.to_string())}
 tauri::WebviewWindowBuilder::new(&app,"mapping-overlay",tauri::WebviewUrl::App("index.html?overlay=1".into())).title("Daytripper Mapping HUD").inner_size(400.,550.).decorations(false).transparent(true).always_on_top(true).skip_taskbar(false).resizable(false).build().map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]fn drag_window(window:tauri::WebviewWindow)->Result<(),String>{window.start_dragging().map_err(|e|e.to_string())}
#[cfg(debug_assertions)]async fn overlay_smoke(app:tauri::AppHandle)->Result<(),String>{
 use std::sync::atomic::Ordering;
 for cycle in 1..=2 {
  let before=app.state::<OverlayState>().mounted.load(Ordering::SeqCst);
  open_module(app.clone(),"mapping-overlay".into()).await?;
  // A second open must reuse the window rather than racing another WebView.
  open_module(app.clone(),"mapping-overlay".into()).await?;
  let started=std::time::Instant::now();
  while app.state::<OverlayState>().mounted.load(Ordering::SeqCst)==before{
   if started.elapsed()>std::time::Duration::from_secs(20){return Err("Overlay frontend did not mount within 20 seconds".into())}
   tokio::time::sleep(std::time::Duration::from_millis(100)).await;
  }
  let window=app.get_webview_window("mapping-overlay").ok_or("Overlay missing")?;
  let size=window.inner_size().map_err(|e|e.to_string())?;
  if size.width<40||size.height<40{return Err("Overlay has invalid bounds".into())}
  if !window.is_visible().map_err(|e|e.to_string())?{return Err("Overlay is not visible".into())}
  app.get_webview_window("main").ok_or("Main missing")?.inner_size().map_err(|e|e.to_string())?;
  eprintln!("Overlay smoke cycle {cycle}: frontend mounted, native window visible, main window responds, {}x{}",size.width,size.height);
  if cycle==1{window.close().map_err(|e|e.to_string())?;let started=std::time::Instant::now();while app.get_webview_window("mapping-overlay").is_some(){if started.elapsed()>std::time::Duration::from_secs(5){return Err("Overlay did not close".into())}tokio::time::sleep(std::time::Duration::from_millis(50)).await;}}
 }
 eprintln!("OVERLAY_SMOKE_PASS");Ok(())
}
fn main(){tauri::Builder::default().manage(OverlayState::default()).manage(auth::Auth::default()).manage(esi::Esi::default()).setup(|app|{
 let directory=app.path().app_data_dir()?;std::fs::create_dir_all(&directory)?;let store=store::Store(directory.join("daytripper.sqlite3"));store.open().map_err(std::io::Error::other)?;if store.get("client_id").map_err(std::io::Error::other)?.is_none(){store.set("client_id",auth::DEFAULT_CLIENT_ID).map_err(std::io::Error::other)?;}app.manage(store);
 clipboard_watch::start_clipboard_watcher(app.handle().clone());gamelog_watch::start_gamelog_watcher(app.handle().clone());
 #[cfg(debug_assertions)]if std::env::args().any(|arg|arg=="--overlay-smoke-test"){let handle=app.handle().clone();tauri::async_runtime::spawn(async move{if let Err(error)=overlay_smoke(handle).await{eprintln!("OVERLAY_SMOKE_FAIL: {error}")}});}
 Ok(())
 }).on_window_event(|window,event|{if matches!(event,tauri::WindowEvent::Destroyed){clipboard_watch::forget_capture_window(window.label());}})
 .invoke_handler(tauri::generate_handler![auth::characters,auth::auth_settings,auth::set_client_id,auth::sign_in,auth::remove_character,esi::character_hub,esi::set_waypoint,store::load_workspace,store::save_workspace,open_url,open_module,overlay_ready,drag_window,clipboard_watch::configure_clipboard_capture,clipboard_watch::set_clipboard_text]).run(tauri::generate_context!()).expect("Daytripper failed to start");}

