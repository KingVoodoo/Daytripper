use std::sync::atomic::{AtomicBool, Ordering};
static READY: AtomicBool = AtomicBool::new(false);
pub fn ready() -> bool { READY.load(Ordering::Acquire) }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureContext { foreground: usize, foreground_pid: u32, owner: usize, owner_pid: Option<u32>, pub eligible: bool }

#[cfg(windows)]
pub fn context() -> Option<CaptureContext> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    extern "system" { fn GetClipboardOwner() -> *mut std::ffi::c_void; }
    unsafe {
        let foreground=GetForegroundWindow().0 as usize;
        let foreground_pid=crate::eve_clients::trusted_clipboard_process(foreground)?;
        let owner=GetClipboardOwner() as usize;
        let owner_pid=crate::eve_clients::trusted_clipboard_process(owner);
        // Windows can provide text without an owner HWND. Only verified EVE
        // foreground may use that exception; an existing untrusted owner cannot.
        let eligible=super::gate::eligible_capture(foreground_pid,owner,owner_pid,std::process::id());
        Some(CaptureContext {foreground,foreground_pid,owner,owner_pid,eligible})
    }
}
#[cfg(not(windows))]
pub fn context() -> Option<CaptureContext> { None }

#[cfg(windows)]
pub fn start() {
    std::thread::spawn(|| {
        use std::ffi::c_void;
        use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG};
        type HookCallback=unsafe extern "system" fn(*mut c_void,u32,*mut c_void,i32,i32,u32,u32);
        #[link(name="user32")]
        extern "system" {
            fn SetWinEventHook(min:u32,max:u32,module:*mut c_void,callback:Option<HookCallback>,process:u32,thread:u32,flags:u32)->*mut c_void;
            fn UnhookWinEvent(hook:*mut c_void)->i32;
        }
        unsafe extern "system" fn changed(_hook:*mut c_void,_event:u32,hwnd:*mut c_void,_object:i32,_child:i32,_thread:u32,_time:u32) {
            // Classify the event's HWND, including transient external focus;
            // querying only the current HWND could miss an away-and-back switch.
            super::observe_capture_focus(crate::eve_clients::trusted_clipboard_process(hwnd as usize).is_some());
        }
        unsafe {
            let hook=SetWinEventHook(3,3,std::ptr::null_mut(),Some(changed),0,0,0);
            if hook.is_null() { log::error!("Clipboard focus observer could not start; automatic capture is unavailable."); return; }
            super::observe_capture_focus(context().is_some());
            READY.store(true,Ordering::Release);
            log::info!("Clipboard focus observer ready");
            let mut message=MSG::default();
            while GetMessageW(&mut message,None,0,0).0>0 {}
            READY.store(false,Ordering::Release);
            super::observe_capture_focus(false);
            UnhookWinEvent(hook);
        }
    });
}
#[cfg(not(windows))]
pub fn start() {}