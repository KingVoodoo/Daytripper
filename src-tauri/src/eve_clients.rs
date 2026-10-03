//! EVE client window switcher — EULA-safe OS window management only.
//!
//! Allowed (CCP clarifications on third-party window tools):
//! - Enumerate unmodified EVE client windows via Windows APIs
//! - Bring a selected client to the foreground so the pilot interacts with it
//! - Arrange / swap OS window rectangles (no client injection)
//! - Strip or restore Windows title-bar chrome via GWL_STYLE / GWL_EXSTYLE only
//! - Full-window DWM live thumbnails of unmodified client HWNDs (EVE-O Preview style)
//!
//! Not implemented (and must not be added here):
//! - Reading or writing EVE client process memory
//! - Injecting into the client
//! - Broadcasting keyboard/mouse input to clients
//! - Cropped/partial UI overlays (overview-only, local-only, etc.)
//! - Automating gameplay across multiple clients

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EveClientWindow {
    pub hwnd: String,
    pub title: String,
    pub character: String,
    pub process_id: u32,
    pub minimized: bool,
    pub foreground: bool,
    /// True only when Companion has applied borderless chrome to this HWND.
    pub borderless: bool,
    /// Win32 device name for the monitor currently hosting this HWND (`\\.\DISPLAY1`).
    pub monitor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[tauri::command]
pub fn list_eve_clients() -> Result<Vec<EveClientWindow>, String> {
    platform::list_eve_clients()
}

#[tauri::command]
pub fn minimize_eve_client(hwnd: String) -> Result<(), String> {
    platform::minimize_eve_client(&hwnd)
}

#[tauri::command]
pub fn minimize_all_eve_clients() -> Result<(), String> {
    platform::minimize_all_eve_clients()
}

#[tauri::command]
pub fn focus_eve_client(hwnd: String) -> Result<(), String> {
    platform::focus_eve_client(&hwnd)
}

#[tauri::command]
pub fn focus_relative_eve_client(delta: i32, priority_hwnds: Option<Vec<String>>) -> Result<(), String> {
    platform::focus_relative_eve_client(delta, priority_hwnds.as_deref().unwrap_or(&[]))
}

#[tauri::command]
pub fn focus_last_eve_client() -> Result<(), String> {
    platform::focus_last_eve_client()
}

#[tauri::command]
pub fn focus_last_non_eve_window() -> Result<(), String> {
    platform::focus_last_non_eve_window()
}

#[tauri::command]
pub fn set_eve_client_always_on_top(hwnd: String, enabled: bool) -> Result<(), String> {
    platform::set_eve_client_always_on_top(&hwnd, enabled)
}

/// Strip or restore Windows title-bar chrome on an EVE client HWND.
/// Applies once per HWND; original GWL_STYLE / GWL_EXSTYLE are saved exactly.
/// `monitor` is a Win32 device name (`\\.\DISPLAY2`); omit to keep the current display.
#[tauri::command]
pub fn set_eve_client_borderless(
    hwnd: String,
    enabled: bool,
    monitor: Option<String>,
) -> Result<(), String> {
    platform::set_eve_client_borderless(&hwnd, enabled, monitor.as_deref())
}

#[tauri::command]
pub fn is_eve_client_borderless(hwnd: String) -> bool {
    #[cfg(windows)]
    {
        platform::is_eve_client_borderless(&hwnd)
    }
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        false
    }
}

#[tauri::command]
pub fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    platform::list_displays()
}

/// Restore every modified EVE frame. Call on Companion shutdown.
pub fn restore_all_eve_borderless() {
    platform::restore_all_eve_borderless();
}

#[tauri::command]
pub fn tile_eve_clients(hwnds: Vec<String>, columns: u32) -> Result<(), String> {
    platform::tile_eve_clients(&hwnds, columns.max(1))
}

#[tauri::command]
pub fn swap_eve_client_windows(a: String, b: String) -> Result<(), String> {
    platform::swap_eve_client_windows(&a, &b)
}

#[tauri::command]
pub fn foreground_is_companion() -> bool {
    platform::foreground_is_companion()
}

/// Validate renderer-supplied handles against native process ownership.
pub(crate) fn validate_eve_hwnd(raw: &str) -> Result<usize, String> {
    let value=raw.trim().parse::<usize>().map_err(|_| "Invalid window handle.")?;
    match trusted_clipboard_process(value) {
        Some(pid) if pid != std::process::id() => Ok(value),
        _ => Err("Window is not a current EVE client.".into()),
    }
}

#[cfg(test)]
mod handle_security_tests {
    #[test]
    fn invalid_and_dead_handles_are_rejected() {
        for raw in ["", "0", "-1", "not-a-handle", "18446744073709551615"] { assert!(super::validate_eve_hwnd(raw).is_err()); }
    }
}
/// Identify a verified EVE or Companion window for native clipboard focus checks.
pub fn trusted_clipboard_process(hwnd: usize) -> Option<u32> {
    #[cfg(windows)] { platform::trusted_clipboard_process(hwnd) }
    #[cfg(not(windows))] { let _ = hwnd; None }
}

#[cfg(windows)]
mod platform {
    use super::{DisplayInfo, EveClientWindow};
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, MAX_PATH, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW,
        MonitorFromWindow, DISPLAY_DEVICEW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
        MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AdjustWindowRectEx, EnumWindows, GetClientRect, GetForegroundWindow, GetSystemMetrics,
        GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        AllowSetForegroundWindow, BringWindowToTop, GetWindowThreadProcessId, IsIconic, IsWindow,
        IsWindowVisible, IsZoomed, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow,
        GWL_EXSTYLE, GWL_STYLE, GW_HWNDNEXT, HWND_TOP,
        SM_CXSCREEN, SM_CYSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_MAXIMIZE, SW_MINIMIZE,
        SW_RESTORE, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_CLIENTEDGE,
        WS_EX_COMPOSITED, WS_EX_DLGMODALFRAME, WS_EX_LAYERED, WS_EX_STATICEDGE, WS_EX_TOOLWINDOW,
        WS_EX_WINDOWEDGE, WS_MAXIMIZE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };

    /// Same chrome mask as Borderless Gaming (`MakeWindowBorderless`).
    const CHROME_STYLE: u32 =
        WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0;
    /// Same extended-style mask as Borderless Gaming (including APPWINDOW / LAYERED).
    const CHROME_EXSTYLE: u32 = WS_EX_DLGMODALFRAME.0
        | WS_EX_COMPOSITED.0
        | WS_EX_WINDOWEDGE.0
        | WS_EX_CLIENTEDGE.0
        | WS_EX_LAYERED.0
        | WS_EX_STATICEDGE.0
        | WS_EX_TOOLWINDOW.0
        | WS_EX_APPWINDOW.0;
    const BORDERLESS_ATTEMPTS: u8 = 3;

    #[derive(Clone, Copy)]
    struct SavedFrame {
        original_style: isize,
        original_ex_style: isize,
        original_rect: RECT,
        original_zoomed: bool,
        attempts: u8,
    }

    /// Per-HWND originals. Entry present means borderless was applied once.
    static BORDERLESS: OnceLock<Mutex<HashMap<isize, SavedFrame>>> = OnceLock::new();

    fn borderless_map() -> &'static Mutex<HashMap<isize, SavedFrame>> {
        BORDERLESS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    struct EnumState {
        clients: Vec<EveClientWindow>,
        foreground: HWND,
    }

    static LAST_NON_EVE: Mutex<Option<isize>> = Mutex::new(None);
    static LAST_EVE: Mutex<Option<isize>> = Mutex::new(None);

    pub fn list_eve_clients() -> Result<Vec<EveClientWindow>, String> {
        let foreground = unsafe { GetForegroundWindow() };
        let state = Mutex::new(EnumState {
            clients: Vec::new(),
            foreground,
        });
        unsafe {
            EnumWindows(Some(enum_proc), lparam_from(&state)).map_err(|e| e.to_string())?;
        }
        let mut clients = state
            .into_inner()
            .map_err(|_| "Failed to read client list".to_string())?
            .clients;
        clients.sort_by(|a, b| {
            a.character
                .to_lowercase()
                .cmp(&b.character.to_lowercase())
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        prune_invalid_borderless();
        annotate_borderless(&mut clients);
        Ok(clients)
    }

    fn lparam_from(state: &Mutex<EnumState>) -> windows::Win32::Foundation::LPARAM {
        windows::Win32::Foundation::LPARAM(state as *const Mutex<EnumState> as isize)
    }

    pub fn focus_eve_client(hwnd_str: &str) -> Result<(), String> {
        let hwnd = parse_hwnd(hwnd_str)?;
        unsafe {
            remember_last_non_eve();
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            if !bring_to_foreground(hwnd) {
                return Err(
                    "Windows denied focus. Click the Companion window, then try again.".into(),
                );
            }
            if let Ok(mut guard) = LAST_EVE.lock() {
                *guard = Some(hwnd.0 as isize);
            }
        }
        Ok(())
    }

    pub fn focus_relative_eve_client(delta: i32, priority_hwnds: &[String]) -> Result<(), String> {
        let clients = list_eve_clients()?;
        if clients.is_empty() {
            return Err("No EVE clients running.".into());
        }
        let pool: Vec<&EveClientWindow> = if priority_hwnds.is_empty() {
            clients.iter().collect()
        } else {
            let set: std::collections::HashSet<&str> =
                priority_hwnds.iter().map(|s| s.as_str()).collect();
            let filtered: Vec<&EveClientWindow> = clients
                .iter()
                .filter(|c| set.contains(c.hwnd.as_str()))
                .collect();
            if filtered.is_empty() {
                clients.iter().collect()
            } else {
                filtered
            }
        };
        let current = clients.iter().position(|c| c.foreground);
        let start = current.unwrap_or(0);
        // Map current into pool index if possible.
        let pool_start = current
            .and_then(|ci| {
                let hwnd = clients[ci].hwnd.as_str();
                pool.iter().position(|c| c.hwnd == hwnd)
            })
            .unwrap_or(start.min(pool.len().saturating_sub(1)));
        let len = pool.len() as i32;
        let next = ((pool_start as i32 + delta).rem_euclid(len)) as usize;
        focus_eve_client(&pool[next].hwnd)
    }

    pub fn focus_last_eve_client() -> Result<(), String> {
        unsafe {
            if let Ok(guard) = LAST_EVE.lock() {
                if let Some(raw) = *guard {
                    let hwnd = HWND(raw as *mut _);
                    if IsWindow(hwnd).as_bool() {
                        return focus_eve_client(&format!("{}", raw as usize));
                    }
                }
            }
        }
        // Fallback: foreground EVE or first listed client.
        let clients = list_eve_clients()?;
        if let Some(active) = clients.iter().find(|c| c.foreground) {
            return focus_eve_client(&active.hwnd);
        }
        clients
            .first()
            .map(|c| focus_eve_client(&c.hwnd))
            .unwrap_or_else(|| Err("No EVE clients running.".into()))
    }

    pub fn minimize_eve_client(hwnd_str: &str) -> Result<(), String> {
        let hwnd = parse_hwnd(hwnd_str)?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        Ok(())
    }

    pub fn minimize_all_eve_clients() -> Result<(), String> {
        let clients = list_eve_clients()?;
        for client in clients {
            let _ = minimize_eve_client(&client.hwnd);
        }
        Ok(())
    }

    pub fn focus_last_non_eve_window() -> Result<(), String> {
        unsafe {
            if let Ok(guard) = LAST_NON_EVE.lock() {
                if let Some(raw) = *guard {
                    let hwnd = HWND(raw as *mut _);
                    if IsWindow(hwnd).as_bool() && IsWindowVisible(hwnd).as_bool() {
                        if IsIconic(hwnd).as_bool() {
                            let _ = ShowWindow(hwnd, SW_RESTORE);
                        }
                        if bring_to_foreground(hwnd) {
                            return Ok(());
                        }
                    }
                }
            }
            // Fallback: walk Z-order for the first visible non-EVE top-level window.
            let mut hwnd = GetForegroundWindow();
            for _ in 0..64 {
                hwnd = GetWindow(hwnd, GW_HWNDNEXT).unwrap_or(HWND::default());
                if hwnd.0.is_null() {
                    break;
                }
                if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                    continue;
                }
                if is_eve_client_hwnd(hwnd) {
                    continue;
                }
                let title = window_title(hwnd);
                if title.is_empty() {
                    continue;
                }
                if bring_to_foreground(hwnd) {
                    return Ok(());
                }
            }
        }
        Err("No previous non-EVE window found.".into())
    }

    pub fn set_eve_client_always_on_top(hwnd_str: &str, enabled: bool) -> Result<(), String> {
        let hwnd = parse_hwnd(hwnd_str)?;
        unsafe {
            // Special insert-after values: HWND_TOPMOST (-1) / HWND_NOTOPMOST (-2).
            let after = HWND(if enabled {
                -1isize as *mut _
            } else {
                -2isize as *mut _
            });
            SetWindowPos(
                hwnd,
                after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_displays() -> Result<Vec<DisplayInfo>, String> {
        Ok(unsafe { enumerate_displays() })
    }

    pub fn set_eve_client_borderless(
        hwnd_str: &str,
        enabled: bool,
        monitor: Option<&str>,
    ) -> Result<(), String> {
        let hwnd = parse_hwnd(hwnd_str)?;
        unsafe {
            if !IsWindow(hwnd).as_bool() {
                forget_hwnd(hwnd);
                return Err("That EVE window is no longer valid.".into());
            }
            if !is_eve_client_hwnd(hwnd) {
                return Err("Not a detected EVE client window.".into());
            }
            if enabled {
                apply_borderless_once(hwnd, monitor)
            } else {
                restore_borderless(hwnd)
            }
        }
    }

    pub fn is_eve_client_borderless(hwnd_str: &str) -> bool {
        let Ok(hwnd) = parse_hwnd(hwnd_str) else {
            return false;
        };
        unsafe { !os_caption_present(hwnd) }
    }

    pub fn restore_all_eve_borderless() {
        let keys: Vec<isize> = match borderless_map().lock() {
            Ok(map) => map.keys().copied().collect(),
            Err(_) => return,
        };
        for key in keys {
            let hwnd = HWND(key as *mut _);
            if super::validate_eve_hwnd(&(key as usize).to_string()).is_err() { forget_hwnd(hwnd); continue; }
            let _ = unsafe { restore_borderless(hwnd) };
        }
    }

    fn hwnd_key(hwnd: HWND) -> isize {
        hwnd.0 as isize
    }

    fn forget_hwnd(hwnd: HWND) {
        if let Ok(mut map) = borderless_map().lock() {
            map.remove(&hwnd_key(hwnd));
        }
    }

    fn prune_invalid_borderless() {
        let Ok(mut map) = borderless_map().lock() else {
            return;
        };
        map.retain(|key, _| {
            super::validate_eve_hwnd(&(*key as usize).to_string()).is_ok()
        });
    }

    fn annotate_borderless(clients: &mut [EveClientWindow]) {
        for client in clients.iter_mut() {
            client.borderless = parse_hwnd(&client.hwnd)
                .ok()
                .map(|hwnd| unsafe { !os_caption_present(hwnd) })
                .unwrap_or(false);
        }
    }

    unsafe fn os_caption_present(hwnd: HWND) -> bool {
        if !IsWindow(hwnd).as_bool() {
            return false;
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        if style & WS_CAPTION.0 != 0 {
            return true;
        }
        chrome_height(hwnd) > 8
    }

    unsafe fn chrome_height(hwnd: HWND) -> i32 {
        let mut outer = RECT::default();
        let mut client = RECT::default();
        if GetWindowRect(hwnd, &mut outer).is_err() || GetClientRect(hwnd, &mut client).is_err() {
            return 0;
        }
        (outer.bottom - outer.top) - (client.bottom - client.top)
    }

    fn wide_z(buf: &[u16]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..len]).to_string_lossy().into_owned()
    }

    fn normalize_monitor_id(raw: Option<&str>) -> Option<String> {
        let id = raw.map(str::trim).filter(|s| !s.is_empty())?;
        if id.eq_ignore_ascii_case("current") {
            None
        } else {
            Some(id.to_string())
        }
    }

    unsafe fn monitor_info_ex(hmonitor: HMONITOR) -> Option<MONITORINFOEXW> {
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(
            hmonitor,
            &mut info as *mut MONITORINFOEXW as *mut MONITORINFO,
        )
        .as_bool()
        {
            return None;
        }
        Some(info)
    }

    unsafe fn monitor_device_from_hwnd(hwnd: HWND) -> Option<String> {
        if !IsWindow(hwnd).as_bool() {
            return None;
        }
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let info = monitor_info_ex(hmonitor)?;
        let id = wide_z(&info.szDevice);
        if id.is_empty() {
            None
        } else {
            Some(id)
        }
    }

    unsafe fn monitor_rect(hwnd: HWND) -> Option<RECT> {
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        monitor_info_ex(hmonitor).map(|info| info.monitorInfo.rcMonitor)
    }

    unsafe fn monitor_rect_from_device(id: &str) -> Option<RECT> {
        enumerate_displays()
            .into_iter()
            .find(|d| d.id.eq_ignore_ascii_case(id))
            .map(|d| RECT {
                left: d.x,
                top: d.y,
                right: d.x + d.width,
                bottom: d.y + d.height,
            })
    }

    unsafe fn friendly_monitor_name(device: &str) -> Option<String> {
        let mut adapter = DISPLAY_DEVICEW::default();
        adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        let mut i = 0u32;
        loop {
            if !EnumDisplayDevicesW(PCWSTR::null(), i, &mut adapter, 0).as_bool() {
                break;
            }
            let mut mon = DISPLAY_DEVICEW::default();
            mon.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let mut j = 0u32;
            loop {
                if !EnumDisplayDevicesW(PCWSTR(adapter.DeviceName.as_ptr()), j, &mut mon, 0)
                    .as_bool()
                {
                    break;
                }
                let name = wide_z(&mon.DeviceName);
                if name.eq_ignore_ascii_case(device) {
                    let label = wide_z(&mon.DeviceString).trim().to_string();
                    if !label.is_empty() {
                        return Some(label);
                    }
                }
                j += 1;
                mon = DISPLAY_DEVICEW::default();
                mon.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            }
            i += 1;
            adapter = DISPLAY_DEVICEW::default();
            adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        }
        None
    }

    unsafe extern "system" fn display_enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _lprc: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<DisplayInfo>);
        if let Some(info) = monitor_info_ex(hmonitor) {
            let id = wide_z(&info.szDevice);
            if !id.is_empty() {
                let rect = info.monitorInfo.rcMonitor;
                let primary = info.monitorInfo.dwFlags & 1 != 0;
                let width = (rect.right - rect.left).max(1);
                let height = (rect.bottom - rect.top).max(1);
                let name = friendly_monitor_name(&id).unwrap_or_else(|| {
                    if primary {
                        "Primary".into()
                    } else {
                        format!("Display {}", list.len() + 1)
                    }
                });
                list.push(DisplayInfo {
                    id,
                    name,
                    primary,
                    x: rect.left,
                    y: rect.top,
                    width,
                    height,
                });
            }
        }
        BOOL(1)
    }

    unsafe fn enumerate_displays() -> Vec<DisplayInfo> {
        let mut list: Vec<DisplayInfo> = Vec::new();
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(display_enum_proc),
            LPARAM(&mut list as *mut _ as isize),
        );
        list.sort_by(|a, b| b.primary.cmp(&a.primary).then(a.x.cmp(&b.x)).then(a.y.cmp(&b.y)));
        list
    }

    unsafe fn rect_close(hwnd: HWND, target: RECT) -> bool {
        let mut current = RECT::default();
        if GetWindowRect(hwnd, &mut current).is_err() {
            return false;
        }
        (current.left - target.left).abs() <= 2
            && (current.top - target.top).abs() <= 2
            && (current.right - target.right).abs() <= 2
            && (current.bottom - target.bottom).abs() <= 2
    }

    unsafe fn maybe_move_to_monitor(hwnd: HWND, monitor: Option<&str>) -> Result<(), String> {
        let Some(id) = normalize_monitor_id(monitor) else {
            return Ok(());
        };
        let Some(rect) = monitor_rect_from_device(&id) else {
            return Ok(());
        };
        if rect_close(hwnd, rect) {
            return Ok(());
        }
        commit_borderless_frame(hwnd, rect)
    }

    fn borderless_style(style: u32) -> u32 {
        // WS_MAXIMIZE is a state bit, not chrome, but DWM keeps the caption
        // while it is set and SetWindowPos is ignored on a zoomed window.
        style & !(CHROME_STYLE | WS_MAXIMIZE.0)
    }

    fn borderless_ex_style(ex: u32) -> u32 {
        ex & !CHROME_EXSTYLE
    }

    /// Leave maximize, strip chrome (including WS_MAXIMIZE), then size to the target monitor.
    /// Capture the destination *before* SW_RESTORE — restore often parks the window on another display.
    /// ShowWindow(SW_MAXIMIZE) after strip puts EVE's DWM caption back.
    unsafe fn apply_borderless_once(hwnd: HWND, monitor: Option<&str>) -> Result<(), String> {
        let chosen = normalize_monitor_id(monitor);
        let current_monitor = monitor_rect(hwnd);
        let named_rect = chosen
            .as_deref()
            .and_then(|id| monitor_rect_from_device(id));
        let fill_rect = named_rect.or(current_monitor);
        let was_iconic = IsIconic(hwnd).as_bool();
        let was_zoomed = IsZoomed(hwnd).as_bool();
        // Capture the rendered area before stripping the non-client frame.
        // Reusing the outer rectangle enlarges ordinary windows by the caption/borders.
        let original_client_rect = client_screen_rect(hwnd)?;

        let saved = {
            let mut map = borderless_map()
                .lock()
                .map_err(|_| "Borderless state lock failed.".to_string())?;
            if let Some(mut existing) = map.get(&hwnd_key(hwnd)).copied() {
                if !os_caption_present(hwnd) {
                    drop(map);
                    return maybe_move_to_monitor(hwnd, monitor);
                }
                if existing.attempts >= BORDERLESS_ATTEMPTS {
                    existing.attempts = 0;
                    map.insert(hwnd_key(hwnd), existing);
                }
                existing
            } else {
                let original_style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let original_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let mut original_rect = RECT::default();
                GetWindowRect(hwnd, &mut original_rect).map_err(|e| {
                    format!("Could not read the EVE window frame: {e}")
                })?;
                let frame = SavedFrame {
                    original_style,
                    original_ex_style,
                    original_rect,
                    original_zoomed: was_zoomed,
                    attempts: 0,
                };
                map.insert(hwnd_key(hwnd), frame);
                frame
            }
        };

        let mut attempts = saved.attempts;
        let mut last_style = saved.original_style as u32;
        for _ in 1..=BORDERLESS_ATTEMPTS {
            if attempts >= BORDERLESS_ATTEMPTS {
                break;
            }
            attempts = attempts.saturating_add(1);

            if IsIconic(hwnd).as_bool() || IsZoomed(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            let current_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            let new_style = borderless_style(current_style);
            let new_ex = borderless_ex_style(current_ex);
            last_style = new_style;
            SetWindowLongPtrW(hwnd, GWL_STYLE, new_style as isize);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex as isize);

            let fill = named_rect.is_some() || saved.original_zoomed || was_iconic || was_zoomed;
            let target = if fill {
                fill_rect.unwrap_or(saved.original_rect)
            } else {
                original_client_rect
            };
            if let Err(error) = commit_borderless_frame(hwnd, target) {
                remember_attempts(hwnd, attempts);
                let _ = restore_borderless(hwnd);
                return Err(format!("Could not apply borderless frame: {error}"));
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            if !os_caption_present(hwnd) {
                remember_attempts(hwnd, 0);
                log::info!(
                    "borderless apply hwnd={:#x} style {:#x} -> {:#x} zoomed={} monitor={:?} attempt={}",
                    hwnd_key(hwnd) as usize,
                    saved.original_style as u32,
                    new_style,
                    saved.original_zoomed,
                    chosen,
                    attempts
                );
                return Ok(());
            }
        }

        remember_attempts(hwnd, attempts);
        log::warn!(
            "borderless apply failed hwnd={:#x} style {:#x} -> {:#x} chromeH={} zoomed={}",
            hwnd_key(hwnd) as usize,
            saved.original_style as u32,
            last_style,
            chrome_height(hwnd),
            IsZoomed(hwnd).as_bool()
        );
        Err("Windows kept the title bar after 3 tries. Toggle Borderless off and on again.".into())
    }

    fn remember_attempts(hwnd: HWND, attempts: u8) {
        if let Ok(mut map) = borderless_map().lock() {
            if let Some(frame) = map.get_mut(&hwnd_key(hwnd)) {
                frame.attempts = attempts;
            }
        }
    }

    unsafe fn restore_borderless(hwnd: HWND) -> Result<(), String> {
        let saved = {
            let mut map = borderless_map()
                .lock()
                .map_err(|_| "Borderless state lock failed.".to_string())?;
            map.remove(&hwnd_key(hwnd))
        };
        if !IsWindow(hwnd).as_bool() {
            return Ok(());
        }

        let original_style = if let Some(saved) = saved {
            let s = saved.original_style as u32;
            if s & WS_CAPTION.0 != 0 {
                s
            } else {
                s | WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0
            }
        } else {
            let cur = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            cur | WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0
        };
        let original_ex = if let Some(saved) = saved {
            saved.original_ex_style as u32 | WS_EX_WINDOWEDGE.0
        } else {
            (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) | WS_EX_WINDOWEDGE.0
        };

        SetWindowLongPtrW(hwnd, GWL_STYLE, original_style as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, original_ex as isize);

        if let Some(saved) = saved {
            if saved.original_zoomed {
                let _ = commit_frame(hwnd, saved.original_rect);
                let _ = ShowWindow(hwnd, SW_MAXIMIZE);
            } else {
                let mut wrapped = client_screen_rect(hwnd).unwrap_or(saved.original_rect);
                let _ = AdjustWindowRectEx(
                    &mut wrapped,
                    WINDOW_STYLE(original_style),
                    false,
                    WINDOW_EX_STYLE(original_ex),
                );
                let _ = commit_frame(hwnd, wrapped);
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
        } else {
            if let Ok(mut wrapped) = client_screen_rect(hwnd) {
                let _ = AdjustWindowRectEx(
                    &mut wrapped,
                    WINDOW_STYLE(original_style),
                    false,
                    WINDOW_EX_STYLE(original_ex),
                );
                let _ = commit_frame(hwnd, wrapped);
            }
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        // Force Windows DWM to recompute and repaint the non-client caption and borders
        let _ = windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            hwnd,
            HWND(std::ptr::null_mut()),
            0,
            0,
            0,
            0,
            windows::Win32::UI::WindowsAndMessaging::SWP_FRAMECHANGED
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOZORDER
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE,
        );
        Ok(())
    }

    unsafe fn client_screen_rect(hwnd: HWND) -> Result<RECT, String> {
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client).map_err(|e| e.to_string())?;
        let mut top_left = POINT {
            x: client.left,
            y: client.top,
        };
        let mut bottom_right = POINT {
            x: client.right,
            y: client.bottom,
        };
        if !ClientToScreen(hwnd, &mut top_left).as_bool()
            || !ClientToScreen(hwnd, &mut bottom_right).as_bool()
        {
            return Err("Could not map the EVE client area to screen coordinates.".into());
        }
        Ok(RECT {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        })
    }

    unsafe fn commit_frame(hwnd: HWND, rect: RECT) -> Result<(), String> {
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        SetWindowPos(
            hwnd,
            None,
            rect.left,
            rect.top,
            width,
            height,
            SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    unsafe fn commit_borderless_frame(hwnd: HWND, rect: RECT) -> Result<(), String> {
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        SetWindowPos(
            hwnd,
            None,
            rect.left,
            rect.top,
            width,
            height,
            // Allow EVE to process WM_WINDOWPOSCHANGING when resizing its render surface.
            SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOOWNERZORDER,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    unsafe fn remember_last_non_eve() {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            return;
        }
        if is_eve_client_hwnd(foreground) {
            return;
        }
        // Ignore our own untitled / empty shells.
        let title = window_title(foreground);
        if title.is_empty() {
            return;
        }
        if let Ok(mut guard) = LAST_NON_EVE.lock() {
            *guard = Some(foreground.0 as isize);
        }
    }

    unsafe fn is_eve_client_hwnd(hwnd: HWND) -> bool {
        inspect_window(hwnd, GetForegroundWindow()).is_some()
    }

    pub fn tile_eve_clients(hwnds: &[String], columns: u32) -> Result<(), String> {
        if hwnds.is_empty() {
            return Ok(());
        }
        if hwnds.len() > 128 { return Err("Too many EVE windows.".into()); }
        let validated: Vec<HWND> = hwnds.iter().map(|raw| parse_hwnd(raw)).collect::<Result<_,_>>()?;
        let cols = columns.max(1).min(128) as i32;
        let count = hwnds.len() as i32;
        let rows = ((count + cols - 1) / cols).max(1);
        let (screen_w, screen_h) = unsafe {
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };
        let cell_w = screen_w / cols;
        let cell_h = screen_h / rows;
        for (index, hwnd) in validated.into_iter().enumerate() {
            let i = index as i32;
            let col = i % cols;
            let row = i / cols;
            let x = col * cell_w;
            let y = row * cell_h;
            unsafe {
                if IsIconic(hwnd).as_bool() {
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                }
                SetWindowPos(
                    hwnd,
                    None,
                    x,
                    y,
                    cell_w,
                    cell_h,
                    SWP_NOZORDER | SWP_SHOWWINDOW,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn swap_eve_client_windows(a_str: &str, b_str: &str) -> Result<(), String> {
        let a = parse_hwnd(a_str)?;
        let b = parse_hwnd(b_str)?;
        if a == b {
            return Ok(());
        }
        unsafe {
            let mut ra = RECT::default();
            let mut rb = RECT::default();
            GetWindowRect(a, &mut ra).map_err(|e| e.to_string())?;
            GetWindowRect(b, &mut rb).map_err(|e| e.to_string())?;
            if IsIconic(a).as_bool() {
                let _ = ShowWindow(a, SW_RESTORE);
            }
            if IsIconic(b).as_bool() {
                let _ = ShowWindow(b, SW_RESTORE);
            }
            let aw = ra.right - ra.left;
            let ah = ra.bottom - ra.top;
            let bw = rb.right - rb.left;
            let bh = rb.bottom - rb.top;
            SetWindowPos(a, None, rb.left, rb.top, bw, bh, SWP_NOZORDER | SWP_SHOWWINDOW)
                .map_err(|e| e.to_string())?;
            SetWindowPos(b, None, ra.left, ra.top, aw, ah, SWP_NOZORDER | SWP_SHOWWINDOW)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn trusted_clipboard_process(raw: usize) -> Option<u32> {
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        unsafe {
            if hwnd.0.is_null() || !IsWindow(hwnd).as_bool() { return None; }
            let mut pid = 0; GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 { return None; }
            if pid == std::process::id() { return Some(pid); }
            let image = process_image_path(pid)?;
            if Path::new(&image).file_name()?.to_str()?.eq_ignore_ascii_case("exefile.exe") { Some(pid) } else { None }
        }
    }

    pub fn foreground_is_companion() -> bool {
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground.0.is_null() {
                return false;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(foreground, Some(&mut pid));
            pid != 0 && pid == std::process::id()
        }
    }

    /// Restore only when iconic — never SW_RESTORE a maximized/normal window
    /// (that would exit maximize and feel like "unmaximize on client swap").
    unsafe fn restore_if_minimized(hwnd: HWND) {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
    }

    unsafe fn bring_to_foreground(hwnd: HWND) -> bool {
        restore_if_minimized(hwnd);
        if SetForegroundWindow(hwnd).as_bool() {
            let _ = BringWindowToTop(hwnd);
            return true;
        }
        // Overlay orbs are WS_EX_NOACTIVATE, so the click never makes Companion
        // foreground. Attach this thread (the one that got the mouse down) to
        // both the current foreground and the target EVE client.
        let current = GetCurrentThreadId();
        let foreground = GetForegroundWindow();
        let target_thread = GetWindowThreadProcessId(hwnd, None);
        let foreground_thread = GetWindowThreadProcessId(foreground, None);
        let attach_fg = foreground_thread != 0 && foreground_thread != current;
        let attach_tg = target_thread != 0 && target_thread != current;
        if attach_fg {
            let _ = AttachThreadInput(foreground_thread, current, true);
        }
        if attach_tg && target_thread != foreground_thread {
            let _ = AttachThreadInput(target_thread, current, true);
        }
        let _ = AllowSetForegroundWindow(u32::MAX);
        restore_if_minimized(hwnd);
        let _ = BringWindowToTop(hwnd);
        let _ = SetWindowPos(
            hwnd,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        );
        let ok = SetForegroundWindow(hwnd).as_bool() || GetForegroundWindow() == hwnd;
        if attach_tg && target_thread != foreground_thread {
            let _ = AttachThreadInput(target_thread, current, false);
        }
        if attach_fg {
            let _ = AttachThreadInput(foreground_thread, current, false);
        }
        ok
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: windows::Win32::Foundation::LPARAM) -> BOOL {
        let state = &*(lparam.0 as *const Mutex<EnumState>);
        if let Ok(mut guard) = state.lock() {
            if let Some(client) = inspect_window(hwnd, guard.foreground) {
                guard.clients.push(client);
            }
        }
        BOOL(1)
    }

    unsafe fn inspect_window(hwnd: HWND, foreground: HWND) -> Option<EveClientWindow> {
        if !IsWindowVisible(hwnd).as_bool() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let path = process_image_path(pid)?;
        let file_name = Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if file_name != "exefile.exe" {
            return None;
        }
        let title = window_title(hwnd);
        if !title.to_ascii_lowercase().starts_with("eve") {
            return None;
        }
        let character = parse_character(&title);
        let minimized = IsIconic(hwnd).as_bool();
        Some(EveClientWindow {
            hwnd: format!("{}", hwnd.0 as usize),
            title,
            character,
            process_id: pid,
            minimized,
            foreground: hwnd == foreground,
            borderless: false,
            monitor: monitor_device_from_hwnd(hwnd),
        })
    }

    unsafe fn process_image_path(pid: u32) -> Option<String> {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; MAX_PATH as usize];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if result.is_err() || size == 0 {
            return None;
        }
        Some(
            OsString::from_wide(&buf[..size as usize])
                .to_string_lossy()
                .into_owned(),
        )
    }

    unsafe fn window_title(hwnd: HWND) -> String {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; (len as usize) + 1];
        let written = GetWindowTextW(hwnd, &mut buf);
        if written <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..written as usize])
    }

    fn parse_character(title: &str) -> String {
        let trimmed = title.trim();
        if let Some(rest) = trimmed.strip_prefix("EVE - ") {
            let name = rest.trim();
            if !name.is_empty() {
                return name.to_string();
            }
        }
        if trimmed.eq_ignore_ascii_case("EVE") {
            return "Character select".to_string();
        }
        trimmed.to_string()
    }

    fn parse_hwnd(raw: &str) -> Result<HWND, String> {
        let value=super::validate_eve_hwnd(raw)?;
        Ok(HWND(value as *mut _))
    }

    #[cfg(test)]
    mod style_mask_tests {
        use super::*;
        use windows::Win32::UI::WindowsAndMessaging::{
            WS_MAXIMIZE, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_VISIBLE,
        };

        #[test]
        fn strip_chrome_leaves_visible() {
            let style = WS_VISIBLE.0
                | WS_POPUP.0
                | WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_SYSMENU.0
                | WS_MINIMIZEBOX.0
                | WS_MAXIMIZEBOX.0;
            let next = borderless_style(style);
            assert_eq!(next & WS_CAPTION.0, 0);
            assert_eq!(next & WS_THICKFRAME.0, 0);
            assert_eq!(next & WS_SYSMENU.0, 0);
            assert_ne!(next & WS_VISIBLE.0, 0);
            assert_ne!(next & WS_POPUP.0, 0);
        }

        #[test]
        fn strip_clears_maximize_state() {
            let style = 0x95CF_0000;
            let next = borderless_style(style);
            assert_eq!(next & WS_CAPTION.0, 0);
            assert_eq!(next & WS_MAXIMIZE.0, 0);
            assert_eq!(next, 0x9400_0000);
        }

        #[test]
        fn strip_ex_chrome_matches_borderless_gaming() {
            let ex = WS_EX_APPWINDOW.0 | CHROME_EXSTYLE;
            let next = borderless_ex_style(ex);
            assert_eq!(next & WS_EX_APPWINDOW.0, 0);
            assert_eq!(next & WS_EX_WINDOWEDGE.0, 0);
            assert_eq!(next & WS_EX_LAYERED.0, 0);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::EveClientWindow;

    pub fn list_eve_clients() -> Result<Vec<EveClientWindow>, String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn focus_eve_client(_hwnd: &str) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn focus_relative_eve_client(_delta: i32, _priority_hwnds: &[String]) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn focus_last_eve_client() -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn minimize_eve_client(_hwnd: &str) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn minimize_all_eve_clients() -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn focus_last_non_eve_window() -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn set_eve_client_always_on_top(_hwnd: &str, _enabled: bool) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn set_eve_client_borderless(
        _hwnd: &str,
        _enabled: bool,
        _monitor: Option<&str>,
    ) -> Result<(), String> {
        Err("EVE client borderless mode is only available on Windows.".into())
    }

    pub fn list_displays() -> Result<Vec<super::DisplayInfo>, String> {
        Ok(Vec::new())
    }

    pub fn restore_all_eve_borderless() {}

    pub fn tile_eve_clients(_hwnds: &[String], _columns: u32) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn swap_eve_client_windows(_a: &str, _b: &str) -> Result<(), String> {
        Err("EVE client switching is only available on Windows.".into())
    }

    pub fn foreground_is_companion() -> bool {
        false
    }

}