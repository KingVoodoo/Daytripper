//! EVE client gamelog watcher and damage/combat alert system.
//!
//! Watches `%USERPROFILE%\Documents\EVE\logs\Gamelogs\*_<charID>.txt` for running
//! clients, parses incoming combat lines (damage, tackle, energy neuts), aggregates
//! events per character per second, and emits `eve-combat-alert` events.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CombatAlertEvent {
    pub character_id: u64,
    pub character: String,
    pub kind: String, // "damage" | "tackle" | "neut"
    pub total: i64,
    pub hits: u32,
    pub top_source: String,
    pub is_player: bool,
    pub at: u64, // Unix timestamp in ms
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MiningYieldEvent {
    pub character_id: u64,
    pub character: String,
    pub ore_type: String,
    pub units: i64,
    pub is_critical: bool,
    pub at: u64, // Unix timestamp in ms
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HoldFullEvent {
    pub character_id: u64,
    pub character: String,
    pub module: String,
    pub at: u64, // Unix timestamp in ms
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidDepletedEvent {
    pub character_id: u64,
    pub character: String,
    pub message: String,
    pub at: u64, // Unix timestamp in ms
}

#[derive(Debug, Clone, PartialEq)]
pub enum CombatKind {
    Damage,
    Tackle,
    Neut,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedCombatLine {
    pub kind: CombatKind,
    pub amount: i64,
    pub source: String,
    pub is_player: bool,
}

/// Strip XML/HTML tags like `<color=...>`, `<b>`, `</font>` from text.
pub fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut inside = false;
    for c in s.chars() {
        if c == '<' {
            inside = true;
        } else if c == '>' {
            inside = false;
        } else if !inside {
            out.push(c);
        }
    }
    out.trim().to_string()
}

/// Check if an entity name appears to be a player (CharacterName[CORP](Ship)).
/// NPCs are bare names without corporate ticker brackets.
pub fn is_player_name(source: &str) -> bool {
    source.contains('[') && source.contains(']')
}

/// Extract damage amount from a line containing `0xffcc0000`.
pub fn extract_damage_amount(line: &str) -> Option<i64> {
    let lower = line.to_ascii_lowercase();
    let pos = lower.find("0xffcc0000")?;
    let slice = &line[pos..];
    let b_start = slice.find("<b>")?;
    let b_end = slice[b_start + 3..].find("</b>")?;
    let num_str = &slice[b_start + 3..b_start + 3 + b_end].trim();
    num_str.parse::<i64>().ok()
}

/// Extract source entity name from an incoming damage line.
pub fn extract_damage_source(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let from_pos = lower.find("from")?;
    let slice = &line[from_pos + 4..];

    // Look for separator between source and weapon (e.g., " - " or end of </b>)
    let b_start = slice.find("<b>")?;
    let inner = &slice[b_start + 3..];
    let end = if let Some(dash) = inner.find(" - ") {
        dash
    } else if let Some(b_end) = inner.find("</b>") {
        b_end
    } else {
        inner.len()
    };
    let raw = &inner[..end];
    let cleaned = strip_tags(raw);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Extract energy amount in GJ from a neut/nos line.
pub fn extract_gj_amount(line: &str) -> Option<i64> {
    let lower = line.to_ascii_lowercase();
    let gj_pos = lower.find("gj")?;
    let before = &line[..gj_pos];
    // Find numeric token right before GJ
    let num_chars: String = before
        .chars()
        .rev()
        .skip_while(|c| c.is_whitespace() || *c == '<' || *c == '>' || *c == 'b' || *c == '/')
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    let num_str: String = num_chars.chars().rev().collect();
    num_str.parse::<i64>().map(|v| v.abs()).ok()
}

/// Extract source entity from a neut/nos line.
pub fn extract_neut_source(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let marker = if let Some(p) = lower.find("energy drained to") {
        p + 17
    } else if let Some(p) = lower.find("energy neutralized") {
        p + 18
    } else {
        return None;
    };
    let slice = &line[marker..];
    let cleaned = strip_tags(slice);
    let trimmed = cleaned.trim().trim_start_matches(':').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Extract text between two keywords and strip formatting tags.
pub fn extract_between_tags(line: &str, start_kw: &str, end_kw: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let start_pos = lower.find(start_kw)?;
    let slice = &line[start_pos + start_kw.len()..];
    let slice_lower = slice.to_ascii_lowercase();
    let end_pos = slice_lower.find(end_kw)?;
    let between = &slice[..end_pos];
    let cleaned = strip_tags(between);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Parse a raw gamelog line into a structured combat event.
pub fn parse_combat_line(line: &str) -> Option<ParsedCombatLine> {
    if !line.contains("(combat)") {
        return None;
    }

    let lower = line.to_ascii_lowercase();

    // 1. Ignore outgoing damage (color 0xff00ffff with "to")
    if (lower.contains("0xff00ffff") || lower.contains("<font size=10>to</font>"))
        && !lower.contains("you!")
        && !lower.contains("0xffcc0000")
        && !lower.contains("0xffe57f7f")
    {
        return None;
    }

    // 2. Tackle: warp scramble / disruption attempt directed at you
    if (lower.contains("warp scramble attempt")
        || lower.contains("warp disruption attempt")
        || lower.contains("warp scramble")
        || lower.contains("warp disrupt"))
        && lower.contains("you!")
    {
        let source = extract_between_tags(line, "from", "to").unwrap_or_else(|| "Unknown".into());
        let clean_source = strip_tags(&source);
        let is_player = is_player_name(&clean_source);
        return Some(ParsedCombatLine {
            kind: CombatKind::Tackle,
            amount: 0,
            source: clean_source,
            is_player,
        });
    }

    // 3. Neut / Nos: 0xffe57f7f or energy drained / neutralized
    if lower.contains("0xffe57f7f")
        || lower.contains("energy drained")
        || lower.contains("energy neutralized")
    {
        let amount = extract_gj_amount(line).unwrap_or(0);
        let source = extract_neut_source(line).unwrap_or_else(|| "Unknown".into());
        let clean_source = strip_tags(&source);
        let is_player = is_player_name(&clean_source);
        return Some(ParsedCombatLine {
            kind: CombatKind::Neut,
            amount,
            source: clean_source,
            is_player,
        });
    }

    // 4. Incoming damage: 0xffcc0000 and "from"
    if lower.contains("0xffcc0000") && lower.contains("from") {
        let amount = extract_damage_amount(line).unwrap_or(0);
        let source = extract_damage_source(line).unwrap_or_else(|| "Unknown".into());
        let clean_source = strip_tags(&source);
        let is_player = is_player_name(&clean_source);
        return Some(ParsedCombatLine {
            kind: CombatKind::Damage,
            amount,
            source: clean_source,
            is_player,
        });
    }

    None
}

/// Parse a raw gamelog line into a mining yield event: (ore_type, units, is_critical).
/// Handles both regular mining cycles and "Critical mining success!" bonus yields.
pub fn parse_mining_line(line: &str) -> Option<(String, i64, bool)> {
    if !line.contains("(mining)") {
        return None;
    }

    let clean = strip_tags(line);
    let lower = clean.to_ascii_lowercase();

    let is_critical = lower.contains("critical mining success")
        || lower.contains("you mined an additional")
        || lower.contains("mined an additional");

    let num_slice = if is_critical {
        if let Some(pos) = lower.find("mined an additional ") {
            &clean[pos + "mined an additional ".len()..]
        } else {
            return None;
        }
    } else if let Some(pos) = lower.find("you mined ") {
        &clean[pos + "you mined ".len()..]
    } else if let Some(pos) = lower.find("mined ") {
        &clean[pos + "mined ".len()..]
    } else {
        return None;
    };

    let slice_lower = num_slice.to_ascii_lowercase();
    let (unit_kw_pos, kw_len) = if let Some(pos) = slice_lower.find(" units of ") {
        (pos, " units of ".len())
    } else if let Some(pos) = slice_lower.find(" unit of ") {
        (pos, " unit of ".len())
    } else {
        return None;
    };

    let units_str = num_slice[..unit_kw_pos].trim();
    let sanitized_units = units_str.replace(',', "");
    let units = sanitized_units.parse::<i64>().ok()?;
    if units <= 0 {
        return None;
    }

    let raw_ore = &num_slice[unit_kw_pos + kw_len..];
    let ore_type = raw_ore.trim().trim_end_matches('.').to_string();
    if ore_type.is_empty() {
        return None;
    }

    Some((ore_type, units, is_critical))
}

/// Parse a raw gamelog notification for cargo / ore hold full alerts.
/// Returns the module name that triggered the alert (e.g. "Strip Miner I").
pub fn parse_hold_full_line(line: &str) -> Option<String> {
    if !line.contains("(notify)") {
        return None;
    }

    let clean = strip_tags(line);
    let lower = clean.to_ascii_lowercase();

    if !lower.contains("hold is full") {
        return None;
    }

    // Example: "Your Strip Miner I has completed operations. Ship's cargo hold is full."
    if let Some(start) = lower.find("your ") {
        let after_your = &clean[start + 5..];
        let after_lower = &lower[start + 5..];
        if let Some(end) = after_lower.find(" has completed operations") {
            let module = after_your[..end].trim().to_string();
            if !module.is_empty() {
                return Some(module);
            }
        }
    }

    Some("Mining Module".to_string())
}

/// Parse a raw gamelog notification for asteroid depletion alerts.
pub fn parse_asteroid_depleted_line(line: &str) -> Option<String> {
    if !line.contains("(notify)") {
        return None;
    }
    let clean = strip_tags(line);
    let lower = clean.to_ascii_lowercase();
    if lower.contains("asteroid is depleted")
        || lower.contains("asteroid has been depleted")
        || lower.contains("asteroid depleted")
    {
        Some("The asteroid is depleted.".to_string())
    } else {
        None
    }
}

/// Parse character ID from gamelog filename `YYYYMMDD_HHMMSS_<charID>.txt`.
/// Files without an ID suffix (e.g. `YYYYMMDD_HHMMSS.txt`) are pre-login; ignore.
pub fn parse_char_id_from_filename(filename: &str) -> Option<u64> {
    let stem = filename.strip_suffix(".txt")?;
    let parts: Vec<&str> = stem.split('_').collect();
    if parts.len() < 3 {
        return None;
    }
    let id_part = parts.last()?;
    id_part.parse::<u64>().ok()
}

/// Locate EVE Gamelogs directory on the user's PC.
pub fn find_gamelogs_dir() -> Option<PathBuf> {
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let docs = PathBuf::from(&userprofile)
            .join("Documents")
            .join("EVE")
            .join("logs")
            .join("Gamelogs");
        if docs.is_dir() {
            return Some(docs);
        }
        let onedrive = PathBuf::from(&userprofile)
            .join("OneDrive")
            .join("Documents")
            .join("EVE")
            .join("logs")
            .join("Gamelogs");
        if onedrive.is_dir() {
            return Some(onedrive);
        }
    }
    None
}

/// Read listener character name from gamelog file header.
pub fn read_listener_from_header(path: &Path) -> Option<String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(7);
    }

    let file = options.open(path).ok()?;
    let reader = BufReader::new(file);
    for (i, line_res) in reader.lines().enumerate() {
        if i > 25 {
            break;
        }
        if let Ok(line) = line_res {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("Listener:") {
                let name = rest.trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

struct TrackedClientLog {
    character: String,
    character_id: u64,
    path: PathBuf,
    file: Option<File>,
    last_offset: u64,
    partial: String,
}

struct PendingAggregate {
    character_id: u64,
    character: String,
    kind: CombatKind,
    total: i64,
    hits: u32,
    top_source: String,
    top_amount: i64,
    is_player: bool,
    first_hit_at: Instant,
    last_emit_at: Option<Instant>,
}

/// Match running character names to their newest gamelog file in the directory.
pub fn match_character_gamelogs(
    dir: &Path,
    characters: &[String],
) -> HashMap<String, (u64, PathBuf)> {
    let mut result = HashMap::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return result,
    };

    let mut log_files: Vec<(String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.ends_with(".txt") && parse_char_id_from_filename(file_name).is_some() {
                    log_files.push((file_name.to_string(), path));
                }
            }
        }
    }

    // Sort descending so the newest files (YYYYMMDD_HHMMSS_...) are evaluated first
    log_files.sort_by(|a, b| b.0.cmp(&a.0));

    for character in characters {
        let char_clean = character.trim();
        if char_clean.is_empty() || char_clean.eq_ignore_ascii_case("character select") {
            continue;
        }
        for (file_name, path) in &log_files {
            if let Some(char_id) = parse_char_id_from_filename(file_name) {
                if let Some(listener) = read_listener_from_header(path) {
                    if listener.eq_ignore_ascii_case(char_clean) {
                        result.insert(char_clean.to_string(), (char_id, path.clone()));
                        break;
                    }
                }
            }
        }
    }

    result
}

/// Spawns the background gamelog watcher thread.
pub fn start_gamelog_watcher(app_handle: AppHandle) {
    let running = Arc::new(AtomicBool::new(true));
    let stopper = running.clone();

    let _ = std::thread::Builder::new()
        .name("wok-gamelog-watch".into())
        .spawn(move || {
            let mut tracked_logs: HashMap<String, TrackedClientLog> = HashMap::new();
            let mut last_character_set: Vec<String> = Vec::new();
            let mut aggregates: HashMap<String, PendingAggregate> = HashMap::new();
            let mut last_local_scan = Instant::now() - Duration::from_secs(3);

            while stopper.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(750));

                // 1. Check current running EVE clients
                let current_clients = crate::eve_clients::list_eve_clients().unwrap_or_default();
                let mut current_characters: Vec<String> = current_clients
                    .into_iter()
                    .map(|c| c.character.trim().to_string())
                    .filter(|c| !c.is_empty() && !c.eq_ignore_ascii_case("character select"))
                    .collect();
                current_characters.sort();
                current_characters.dedup();

                // Local logs contain the actual destination, including wormhole transits.
                // Repeat snapshots so newly opened windows receive the current system.
                if last_local_scan.elapsed() >= Duration::from_secs(2) {
                last_local_scan = Instant::now();
                if let Some(dir) = find_gamelogs_dir().and_then(|p| p.parent().map(|p| p.join("Chatlogs"))) {
                    for (character, timestamp, system) in crate::local_system_log::latest(&dir, &current_characters) {
                        let _ = app_handle.emit("eve-local-system", serde_json::json!({
                            "character": character, "timestamp": timestamp, "systemName": system
                        }));
                    }
                }

                }

                // 2. If character set changed, rescan gamelogs directory
                if current_characters != last_character_set {
                    if let Some(log_dir) = find_gamelogs_dir() {
                        let matched = match_character_gamelogs(&log_dir, &current_characters);
                        let mut new_tracked: HashMap<String, TrackedClientLog> = HashMap::new();

                        for (char_name, (char_id, path)) in matched {
                            if let Some(existing) = tracked_logs.remove(&char_name) {
                                if existing.path == path {
                                    new_tracked.insert(char_name, existing);
                                    continue;
                                }
                            }

                            // Open newly matched file at EOF so no past history is replayed
                            let mut options = OpenOptions::new();
                            options.read(true);
                            #[cfg(windows)]
                            {
                                use std::os::windows::fs::OpenOptionsExt;
                                options.share_mode(7);
                            }

                            if let Ok(mut f) = options.open(&path) {
                                let last_offset = f.seek(SeekFrom::End(0)).unwrap_or(0);
                                new_tracked.insert(
                                    char_name.clone(),
                                    TrackedClientLog {
                                        character: char_name,
                                        character_id: char_id,
                                        path,
                                        file: Some(f),
                                        last_offset,
                                        partial: String::new(),
                                    },
                                );
                            }
                        }
                        tracked_logs = new_tracked;
                    }
                    last_character_set = current_characters;
                }

                // 3. Read new bytes from each active log
                for log in tracked_logs.values_mut() {
                    let Some(ref mut file) = log.file else {
                        continue;
                    };
                    if let Ok(meta) = file.metadata() {
                        let current_len = meta.len();
                        if current_len > log.last_offset {
                            let bytes_to_read = (current_len - log.last_offset) as usize;
                            let mut buf = vec![0u8; bytes_to_read];
                            if file.seek(SeekFrom::Start(log.last_offset)).is_ok()
                                && file.read_exact(&mut buf).is_ok()
                            {
                                log.last_offset = current_len;
                                let chunk = String::from_utf8_lossy(&buf);
                                log.partial.push_str(&chunk);

                                while let Some(pos) = log.partial.find('\n') {
                                    let line: String = log.partial.drain(..=pos).collect();
                                    let trimmed = line.trim();
                                    let stripped = strip_tags(trimmed);
                                    let stripped_lower = stripped.to_ascii_lowercase();

                                    // Forward only explicit entry evidence; proximity is not a transit.
                                    if stripped.ends_with("(notify) Can't navigate while entering wormhole") {
                                        let _ = app_handle.emit("eve-wormhole-entry", serde_json::json!({
                                            "character": log.character,
                                            "line": trimmed
                                        }));
                                    }

                                    // Detect stargate jumps and titan/jump-bridge transits.
                                    // EVE writes "(notify) Jumping" the moment a gate jump fires,
                                    // and "(notify) Jump jump!" for titan bridges.
                                    // Emitting eve-system-changed lets the portal overlay call
                                    // refreshLocation() immediately instead of waiting for the poll.
                                    if stripped_lower.contains("(notify)") {
                                        let is_gate_jump = stripped_lower.ends_with("jumping");
                                        let is_bridge_jump = stripped_lower.contains("jump jump");
                                        if is_gate_jump || is_bridge_jump {
                                            let _ = app_handle.emit("eve-system-changed", serde_json::json!({
                                                "character": log.character,
                                                "characterId": log.character_id
                                            }));
                                        }
                                    }

                                    if let Some(parsed) = parse_combat_line(trimmed) {
                                        // Update aggregate for this character
                                        let entry = aggregates
                                            .entry(log.character.to_ascii_lowercase())
                                            .or_insert_with(|| PendingAggregate {
                                                character_id: log.character_id,
                                                character: log.character.clone(),
                                                kind: parsed.kind.clone(),
                                                total: 0,
                                                hits: 0,
                                                top_source: String::new(),
                                                top_amount: 0,
                                                is_player: parsed.is_player,
                                                first_hit_at: Instant::now(),
                                                last_emit_at: None,
                                            });

                                        entry.hits += 1;
                                        entry.total += parsed.amount;

                                        // Escalate kind: Tackle > Neut > Damage
                                        match parsed.kind {
                                            CombatKind::Tackle => entry.kind = CombatKind::Tackle,
                                            CombatKind::Neut => {
                                                if entry.kind != CombatKind::Tackle {
                                                    entry.kind = CombatKind::Neut;
                                                }
                                            }
                                            CombatKind::Damage => {}
                                        }

                                        if parsed.amount >= entry.top_amount
                                            || entry.top_source.is_empty()
                                        {
                                            entry.top_source = parsed.source;
                                            entry.top_amount = parsed.amount;
                                            entry.is_player = parsed.is_player;
                                        }
                                    } else if let Some((ore_type, units, is_critical)) = parse_mining_line(trimmed) {
                                        let at = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0);
                                        let ev = MiningYieldEvent {
                                            character_id: log.character_id,
                                            character: log.character.clone(),
                                            ore_type,
                                            units,
                                            is_critical,
                                            at,
                                        };
                                        let _ = app_handle.emit("eve-mining-yield", &ev);
                                    } else if let Some(module) = parse_hold_full_line(trimmed) {
                                        let at = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0);
                                        let ev = HoldFullEvent {
                                            character_id: log.character_id,
                                            character: log.character.clone(),
                                            module,
                                            at,
                                        };
                                        let _ = app_handle.emit("eve-hold-full", &ev);
                                    } else if let Some(message) = parse_asteroid_depleted_line(trimmed) {
                                        let at = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0);
                                        let ev = AsteroidDepletedEvent {
                                            character_id: log.character_id,
                                            character: log.character.clone(),
                                            message,
                                            at,
                                        };
                                        let _ = app_handle.emit("eve-mining-depleted", &ev);
                                    }
                                }
                            }
                        }
                    }
                }

                // 4. Emit aggregated alerts (max 1 per character per second)
                let mut ready_keys = Vec::new();
                for (key, agg) in &aggregates {
                    let window_ready = agg.first_hit_at.elapsed() >= Duration::from_millis(1000);
                    let rate_limited = agg
                        .last_emit_at
                        .map(|t| t.elapsed() < Duration::from_millis(1000))
                        .unwrap_or(false);
                    if window_ready && !rate_limited {
                        ready_keys.push(key.clone());
                    }
                }

                for key in ready_keys {
                    if let Some(agg) = aggregates.remove(&key) {
                        let kind_str = match agg.kind {
                            CombatKind::Tackle => "tackle",
                            CombatKind::Neut => "neut",
                            CombatKind::Damage => "damage",
                        };

                        let event = CombatAlertEvent {
                            character_id: agg.character_id,
                            character: agg.character,
                            kind: kind_str.to_string(),
                            total: agg.total,
                            hits: agg.hits,
                            top_source: if agg.top_source.is_empty() {
                                "Unknown".into()
                            } else {
                                agg.top_source
                            },
                            is_player: agg.is_player,
                            at: SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64,
                        };

                        let _ = app_handle.emit("eve-combat-alert", event);
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_incoming_player_damage() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0xffcc0000><b>306</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Name[TICK](Cruor)</b><font size=10><color=0x77ffffff> - Dual Light Beam Laser II - Penetrates";
        let parsed = parse_combat_line(line).expect("Should parse incoming player damage");
        assert_eq!(parsed.kind, CombatKind::Damage);
        assert_eq!(parsed.amount, 306);
        assert_eq!(parsed.source, "Name[TICK](Cruor)");
        assert!(parsed.is_player);
    }

    #[test]
    fn test_parse_incoming_npc_damage() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0xffcc0000><b>7</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Coreli Guardian Defender</b><font size=10><color=0x77ffffff> - Glances Off";
        let parsed = parse_combat_line(line).expect("Should parse incoming NPC damage");
        assert_eq!(parsed.kind, CombatKind::Damage);
        assert_eq!(parsed.amount, 7);
        assert_eq!(parsed.source, "Coreli Guardian Defender");
        assert!(!parsed.is_player);
    }

    #[test]
    fn test_ignore_outgoing_damage() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0xff00ffff><b>468</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Coreli Guardian Defender</b><font size=10><color=0x77ffffff> - Penetrates";
        let parsed = parse_combat_line(line);
        assert_eq!(parsed, None);
    }

    #[test]
    fn test_parse_tackle_attempt() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0xffffffff><b>Warp scramble attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b>Coreli Guardian Initiate</b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font>you!";
        let parsed = parse_combat_line(line).expect("Should parse tackle line");
        assert_eq!(parsed.kind, CombatKind::Tackle);
        assert_eq!(parsed.amount, 0);
        assert_eq!(parsed.source, "Coreli Guardian Initiate");
        assert!(!parsed.is_player);
    }

    #[test]
    fn test_parse_energy_neut() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0xffe57f7f><b>-19 GJ</b><color=0x77ffffff><font size=10> energy drained to </font><b><color=0xffffffff>Coreli Guardian Initiate</b>";
        let parsed = parse_combat_line(line).expect("Should parse neut line");
        assert_eq!(parsed.kind, CombatKind::Neut);
        assert_eq!(parsed.amount, 19);
        assert_eq!(parsed.source, "Coreli Guardian Initiate");
        assert!(!parsed.is_player);
    }

    #[test]
    fn test_ignore_miss_line() {
        let line = "[ 2025.12.20 00:17:32 ] (combat) <color=0x77ffffff>Coreli Guardian Defender misses you completely";
        let parsed = parse_combat_line(line);
        assert_eq!(parsed, None);
    }

    #[test]
    fn test_ignore_non_combat_line() {
        let line = "[ 2025.12.20 00:17:32 ] (notify) Warp drive active";
        let parsed = parse_combat_line(line);
        assert_eq!(parsed, None);
    }

    #[test]
    fn test_parse_char_id_from_filename() {
        assert_eq!(
            parse_char_id_from_filename("20251220_001530_12345678.txt"),
            Some(12345678)
        );
        assert_eq!(
            parse_char_id_from_filename("20251220_001530.txt"),
            None
        );
        assert_eq!(
            parse_char_id_from_filename("prelogin.txt"),
            None
        );
    }

    #[test]
    fn test_parse_regular_mining_line() {
        let line = "[ 2026.01.06 00:51:36 ] (mining) <color=0x77ffffff>You mined <font size=12><color=#ff8dc169>17<color=0x77ffffff><font size=10> units of <color=0xffffffff><font size=12>Spodumain IV-Grade";
        let parsed = parse_mining_line(line).expect("Should parse regular mining line");
        assert_eq!(parsed.0, "Spodumain IV-Grade");
        assert_eq!(parsed.1, 17);
        assert!(!parsed.2);
    }

    #[test]
    fn test_parse_critical_mining_line() {
        let line = "[ 2026.01.06 00:51:36 ] (mining) <color=#fff0ff45>Critical mining success!<color=0x77ffffff><font size=10> You mined an additional <color=#fff0ff45><font size=12>41<color=0x77ffffff><font size=10> units of <color=0xffffffff><font size=12>Spodumain IV-Grade";
        let parsed = parse_mining_line(line).expect("Should parse critical mining line");
        assert_eq!(parsed.0, "Spodumain IV-Grade");
        assert_eq!(parsed.1, 41);
        assert!(parsed.2);
    }

    #[test]
    fn test_parse_mining_single_unit_and_comma() {
        let line1 = "[ 2026.01.06 00:51:36 ] (mining) You mined 1 unit of Veldspar";
        let parsed1 = parse_mining_line(line1).expect("Should parse single unit");
        assert_eq!(parsed1.0, "Veldspar");
        assert_eq!(parsed1.1, 1);
        assert!(!parsed1.2);

        let line2 = "[ 2026.01.06 00:51:36 ] (mining) You mined 1,250 units of Compressed Scordite.";
        let parsed2 = parse_mining_line(line2).expect("Should parse comma units");
        assert_eq!(parsed2.0, "Compressed Scordite");
        assert_eq!(parsed2.1, 1250);
        assert!(!parsed2.2);
    }

    #[test]
    fn test_parse_hold_full_notification() {
        let line = "[ 2026.07.19 01:32:00 ] (notify) Your Strip Miner I has completed operations. Ship's cargo hold is full.";
        let module = parse_hold_full_line(line).expect("Should parse hold full");
        assert_eq!(module, "Strip Miner I");

        let line2 = "[ 2026.07.19 01:32:00 ] (notify) Ship's ore hold is full.";
        let module2 = parse_hold_full_line(line2).expect("Should parse generic hold full");
        assert_eq!(module2, "Mining Module");

        let non_hold = "[ 2026.07.19 01:32:00 ] (notify) Warp drive active";
        assert_eq!(parse_hold_full_line(non_hold), None);
    }
}