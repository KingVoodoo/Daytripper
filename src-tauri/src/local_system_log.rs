//! Read only EVE Local channel system notifications, never player chat.
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16_lossy(&bytes[2..].chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect::<Vec<_>>())
    } else { String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string() }
}

pub fn system_change(line: &str) -> Option<(&str, &str)> {
    let (stamp, message) = line.trim().trim_start_matches('\u{feff}').strip_prefix("[ ")?.split_once(" ] ")?;
    let system = message.strip_prefix("EVE System > Channel changed to Local : ")?.trim();
    if stamp.len() != 19 || system.is_empty() || system.len() > 100 { return None; }
    Some((stamp, system))
}

// A bounded header + tail read handles UTF-16, rotation, and partially written lines.
pub fn latest(dir: &Path, characters: &[String]) -> Vec<(String, String, String)> {
    let mut paths: Vec<_> = fs::read_dir(dir).into_iter().flatten().flatten()
        .map(|e| e.path()).filter(|p| p.file_name().and_then(|s| s.to_str())
            .map(|s| s.starts_with("Local_") && s.ends_with(".txt")).unwrap_or(false)).collect();
    paths.sort(); paths.reverse();
    let mut found = HashMap::new();
    for path in paths {
        if found.len() == characters.len() { break; }
        let mut opts = OpenOptions::new(); opts.read(true);
        #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; opts.share_mode(7); }
        let Ok(mut file) = opts.open(path) else { continue };
        let Ok(meta) = file.metadata() else { continue };
        // Ignore old sessions left behind by another install or character login.
        if meta.modified().ok().and_then(|t| t.elapsed().ok()).map(|d| d.as_secs() > 86400).unwrap_or(true) { continue; }
        let mut header = vec![0; 4096.min(meta.len() as usize)];
        if file.read_exact(&mut header).is_err() { continue; }
        let header_text = decode(&header);
        let Some(listener) = header_text.lines().find_map(|l| l.trim().trim_start_matches('\u{feff}').strip_prefix("Listener:").map(str::trim)) else { continue };
        let Some(character) = characters.iter().find(|c| c.eq_ignore_ascii_case(listener)) else { continue };
        if found.contains_key(character) { continue; }
        let offset = meta.len().saturating_sub(65536) & !1;
        if file.seek(SeekFrom::Start(offset)).is_err() { continue; }
        let mut tail = vec![0; (meta.len() - offset) as usize];
        if file.read_exact(&mut tail).is_err() { continue; }
        if offset > 0 && header.starts_with(&[0xff, 0xfe]) { tail.splice(0..0, [0xff, 0xfe]); }
        let text = decode(&tail);
        // Drop an incomplete final line so the next poll can read it in full.
        let complete = text.rsplit_once('\n').map(|(s, _)| s).unwrap_or("");
        if let Some((stamp, system)) = complete.lines().rev().find_map(system_change) {
            found.insert(character.clone(), (stamp.to_string(), system.to_string()));
        }
    }
    found.into_iter().map(|(c, (t, s))| (c, t, s)).collect()
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn parses_system_not_player_messages() {
        assert_eq!(system_change("[ 2026.10.03 12:01:02 ] EVE System > Channel changed to Local : J123456"), Some(("2026.10.03 12:01:02", "J123456")));
        assert!(system_change("[ 2026.10.03 12:01:02 ] Pilot > Channel changed to Local : Jita").is_none());
        assert!(system_change("[ 2026.10.03 12:01:02 ] EVE System > Channel changed to Local : ").is_none());
    }
    #[test] fn handles_per_line_bom() {
        assert_eq!(system_change("\u{feff}[ 2026.10.03 12:01:02 ] EVE System > Channel changed to Local : Jita"), Some(("2026.10.03 12:01:02", "Jita")));
    }
    #[test] fn reads_latest_complete_line_and_rotation() {
        let dir = std::env::temp_dir().join(format!("wok-local-log-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, text: &str| {
            let mut bytes = vec![0xff, 0xfe];
            bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
            fs::write(dir.join(name), bytes).unwrap();
        };
        write("Local_20261003_120000_1.txt", "Listener: Pilot\r\n\u{feff}[ 2026.10.03 12:01:02 ] EVE System > Channel changed to Local : Jita\r\n[ 2026.10.03 12:02:02 ] EVE System > Channel changed to Local : Partial");
        assert_eq!(latest(&dir, &["Pilot".into()])[0].2, "Jita");
        assert!(latest(&dir, &["Other".into()]).is_empty());
        write("Local_20261003_130000_1.txt", "Listener: Pilot\r\n[ 2026.10.03 13:01:02 ] EVE System > Channel changed to Local : J123456\r\n");
        assert_eq!(latest(&dir, &["Pilot".into()])[0].2, "J123456");
        fs::remove_file(dir.join("Local_20261003_120000_1.txt")).unwrap();
        fs::remove_file(dir.join("Local_20261003_130000_1.txt")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test] fn decodes_utf16() {
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend("Listener: Pilot\r\n".encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(decode(&bytes), "Listener: Pilot\r\n");
    }
}