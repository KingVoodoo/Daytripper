//! Clipboard watcher for tactical intel (D-Scan dumps and Local chat member lists).
//! Win32 clipboard sequence tracking, gated on the focused EVE client.

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[path = "clipboard_gate.rs"]
mod gate;

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardIntelPayload {
    pub text: String,
    pub at: u64,
}

#[path = "clipboard_reader.rs"]
mod reader;
#[cfg(windows)]
fn read_clipboard_text() -> Option<String> {
    use std::ffi::c_void;
    extern "system" {
        fn OpenClipboard(owner:*mut c_void)->i32;
        fn CloseClipboard()->i32;
        fn GetClipboardData(format:u32)->*mut c_void;
        fn GlobalSize(handle:*mut c_void)->usize;
        fn GlobalLock(handle:*mut c_void)->*mut c_void;
        fn GlobalUnlock(handle:*mut c_void)->i32;
    }
    struct NativeClipboard;
    impl reader::ClipboardApi for NativeClipboard {
        type Handle=*mut c_void;
        fn open(&mut self)->bool { for attempt in 0..4 { if unsafe {OpenClipboard(std::ptr::null_mut())}!=0 {return true;}if attempt<3 {std::thread::sleep(Duration::from_millis(15));} }false }
        fn close(&mut self){unsafe {CloseClipboard();}}
        fn data(&mut self)->Option<Self::Handle>{let h=unsafe {GetClipboardData(13)};(!h.is_null()).then_some(h)}
        fn size(&mut self,h:Self::Handle)->usize{unsafe {GlobalSize(h)}}
        fn lock(&mut self,h:Self::Handle)->Option<*const u16>{let p=unsafe {GlobalLock(h)} as *const u16;(!p.is_null()).then_some(p)}
        fn unlock(&mut self,h:Self::Handle){unsafe {GlobalUnlock(h);}}
    }
    reader::read_text(&mut NativeClipboard)
}

#[cfg(windows)]
pub fn write_clipboard_text(text: &str) -> bool {
    use std::ffi::c_void;
    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(uFormat: u32, hMem: *mut c_void) -> *mut c_void;
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> *mut c_void;
        fn GlobalLock(hMem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(hMem: *mut c_void) -> i32;
    }
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;

    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes_len = utf16.len() * std::mem::size_of::<u16>();

    unsafe {
        let mut opened = false;
        for _ in 0..4 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        if !opened {
            return false;
        }

        EmptyClipboard();

        let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes_len);
        if h_mem.is_null() {
            CloseClipboard();
            return false;
        }

        let ptr = GlobalLock(h_mem) as *mut u16;
        if ptr.is_null() {
            CloseClipboard();
            return false;
        }

        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        GlobalUnlock(h_mem);

        let res = SetClipboardData(CF_UNICODETEXT, h_mem);
        CloseClipboard();
        !res.is_null()
    }
}

#[cfg(windows)]
pub fn clipboard_sequence_number() -> u32 {
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    unsafe { GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
fn read_clipboard_text() -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn write_clipboard_text(_text: &str) -> bool {
    false
}

#[cfg(not(windows))]
pub fn clipboard_sequence_number() -> u32 {
    0
}

/// Fast heuristic to determine if text could be D-Scan results or a pilot list
pub fn looks_like_intel(text: &str) -> bool {
    let clean = text.trim().trim_start_matches('\u{FEFF}').trim();
    if clean.is_empty() || clean.len() > 300_000 {
        return false;
    }

    let mut lines = clean.lines().map(|l| l.trim()).filter(|l| !l.is_empty());
    let first = match lines.next() {
        Some(f) => f,
        None => return false,
    };

    // EFT fit header -> skip (market/fit, not dscan or local members)
    if first.starts_with('[') && first.contains(',') && first.ends_with(']') {
        return false;
    }

    // Probe Scanner / Wormhole signatures -> NOT intel (handled by scanner watcher)
    if is_scanner_data(clean) {
        return false;
    }

    // 1. D-Scan indicators: lines with AU, km, or m distances, or tab-delimited scan format
    let has_dscan_distance = clean.contains(" AU")
        || clean.contains(" km")
        || clean.contains("\t- \t")
        || clean.contains("*\t")
        || (clean.contains('\t')
            && (clean.contains(" m\r") || clean.contains(" m\n") || clean.ends_with(" m")));

    if has_dscan_distance {
        return true;
    }

    // 2. Chat log format: channel headers, timestamps [ 19:00:00 ], showinfo:1377, or Pilot >
    if clean.contains("Channel ID:")
        || clean.contains("Channel Name:")
        || clean.contains("showinfo:1377")
        || clean.contains("Session started:")
    {
        return true;
    }

    for line in std::iter::once(first).chain(lines.clone().take(20)) {
        if line.starts_with('[') && line.contains(']') && line.contains('>') {
            return true;
        }
    }

    // 3. Local member list: lines of character names
    // EVE names: 2-37 chars, letters, digits, spaces, hyphens, periods, quotes
    let sample: Vec<&str> = std::iter::once(first).chain(lines.take(25)).collect();
    let name_like_count = sample
        .iter()
        .filter(|l| {
            let s = l.trim();
            if s.len() < 2 || s.len() > 40 {
                return false;
            }
            if s.contains("http")
                || s.contains('{')
                || s.contains('}')
                || s.contains(';')
                || s.contains("==")
            {
                return false;
            }
            s.chars().all(|c| {
                c.is_alphanumeric() || c == ' ' || c == '-' || c == '\'' || c == '.' || c == '_'
            })
        })
        .count();

    if !sample.is_empty() && name_like_count >= (sample.len() + 1) / 2 {
        return true;
    }

    false
}

/// Identifies probe scanner, cosmic signature, or wormhole bookmark data
pub fn is_scanner_data(text: &str) -> bool {
    let clean = text.trim().trim_start_matches('\u{FEFF}').trim();
    clean.contains("Cosmic Signature")
        || clean.contains("Cosmic Anomaly")
        || clean.contains("Unstable Wormhole")
        || clean.contains(" WH -> ")
        || clean.contains(" WH → ")
        || (clean.contains('\t')
            && (clean.contains("Wormhole")
                || clean.contains("Relic Site")
                || clean.contains("Data Site")
                || clean.contains("Gas Site")
                || clean.contains("Combat Site")))
}


#[path = "clipboard_focus.rs"]
mod focus;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
#[derive(Default)]
struct CaptureControl { session: gate::CaptureSession, intel: HashSet<String>, scanners: HashSet<String> }
static CONTROL: OnceLock<Mutex<CaptureControl>> = OnceLock::new();
fn control() -> &'static Mutex<CaptureControl> { CONTROL.get_or_init(|| Mutex::new(CaptureControl::default())) }
pub(super) fn observe_capture_focus(trusted: bool) {
    if let Ok(mut c)=control().lock() { c.session.observe_focus(trusted,clipboard_sequence_number()); }
}
// Overlay restoration holds session authority while WebView2 creates windows.
// Never wait for that authority on the UI thread needed by window creation.
#[tauri::command(async)]
pub fn configure_clipboard_capture(window: tauri::WebviewWindow, kind: String, enabled: bool) -> Result<(), String> {
    let mut c=control().lock().map_err(|_| "Clipboard capture unavailable.")?;
    let changed=match kind.as_str() {
        "intel" => if enabled {c.intel.insert(window.label().to_owned())}else{c.intel.remove(window.label())},
        "scanner" => if enabled { c.scanners.insert(window.label().to_owned()) } else { c.scanners.remove(window.label()) },
        _ => return Err("Unknown clipboard capture consumer.".into()),
    };
    if changed { let active=!c.intel.is_empty()||!c.scanners.is_empty();c.session.configure(active,clipboard_sequence_number()); }
    log::info!("Clipboard consumer {}: kind={} enabled={} intel_consumers={} scanner_consumers={}", window.label(), kind, enabled, c.intel.len(), c.scanners.len());
    Ok(())
}
pub fn forget_capture_window(label: &str) {
    if let Ok(mut c)=control().lock() { let removed_intel=c.intel.remove(label);let removed_scanner=c.scanners.remove(label);if removed_intel || removed_scanner { let active=!c.intel.is_empty()||!c.scanners.is_empty();c.session.configure(active,clipboard_sequence_number()); } }
}
/// Read only new revisions within the observed native capture session. No clipboard
/// clearing, cached raw-read command, or renderer-supplied process identity exists.
pub fn start_clipboard_watcher(app: AppHandle) {
    focus::start();
    tauri::async_runtime::spawn(async move {
        let mut observed_sequence = clipboard_sequence_number();
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;
            if !focus::ready() { continue; }
            let before=focus::context();let sequence=clipboard_sequence_number();
            let changed = sequence != observed_sequence; observed_sequence = sequence;
            let revision={
                let Ok(mut c)=control().lock() else { continue; };
                c.session.observe_focus(before.is_some(),sequence);
                let revision = c.session.begin(sequence,before.as_ref().map(|s| s.eligible).unwrap_or(false));
                if changed && c.session.enabled && revision.is_none() { log::info!("Clipboard revision skipped: trusted_focus={} eligible_owner={}", before.is_some(), before.as_ref().is_some_and(|s| s.eligible)); }
                revision
            };
            let Some(revision)=revision else { continue; };
            let Some(text)=read_clipboard_text() else { log::info!("Clipboard revision could not be read as bounded Unicode text"); continue; };
            let after=focus::context();
            let Ok(c)=control().lock() else { continue; };
            if before!=after || !c.session.valid(revision,clipboard_sequence_number(),after.as_ref().map(|s| s.eligible).unwrap_or(false)) { continue; }
            let event=if is_scanner_data(&text) && !c.scanners.is_empty() { "eve-clipboard-scanner" } else if looks_like_intel(&text) && !c.intel.is_empty() { "eve-clipboard-intel" } else { continue; };
            let at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_millis() as u64).unwrap_or(0);
            log::info!("Clipboard capture delivered: event={} bytes={}", event, text.len());
            if let Err(error)=app.emit(event,ClipboardIntelPayload {text,at}) { log::error!("Clipboard event delivery failed: {error}"); }
        }
    });
}

#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<bool, String> {
    Ok(write_clipboard_text(&text))
}