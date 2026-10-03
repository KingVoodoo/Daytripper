/// Consume every clipboard revision, including rejected ones, so refocusing EVE
/// never replays a copy made while another application was active.
pub fn read_new_intel(
    last_sequence: &mut u32,
    sequence: u32,
    eligible: impl Fn() -> bool,
    read: impl FnOnce() -> Option<String>,
    current_sequence: impl FnOnce() -> u32,
) -> Option<String> {
    if sequence == 0 || sequence == *last_sequence {
        return None;
    }
    *last_sequence = sequence;
    if !eligible() {
        return None;
    }
    let text = read()?;
    // Clipboard access can retry; discard if focus, ownership or content changed.
    if !eligible() || current_sequence() != sequence {
        return None;
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn inactive_copy_is_not_read_or_replayed_on_focus() {
        let mut last = 1;
        assert_eq!(
            read_new_intel(&mut last, 2, || false, || panic!("must not read"), || 2),
            None
        );
        assert_eq!(
            read_new_intel(&mut last, 2, || true, || panic!("must not replay"), || 2),
            None
        );
        assert_eq!(
            read_new_intel(&mut last, 3, || true, || Some("Pilot Name".into()), || 3),
            Some("Pilot Name".into())
        );
    }

    #[test]
    fn focus_or_ownership_change_during_read_discards_text() {
        let mut last = 1;
        let focused = Cell::new(true);
        assert_eq!(
            read_new_intel(
                &mut last,
                2,
                || focused.get(),
                || {
                    focused.set(false);
                    Some("Pilot Name".into())
                },
                || 2
            ),
            None
        );
    }

    #[test]
    fn clipboard_change_during_read_is_rejected() {
        let mut last = 1;
        assert_eq!(
            read_new_intel(&mut last, 2, || true, || Some("stale".into()), || 3),
            None
        );
    }
}

/// Native session baseline. Entering from another application consumes the current
/// revision without reading or changing the system clipboard.
#[derive(Default)]
pub struct CaptureSession { pub enabled: bool, trusted: bool, sequence: u32, generation: u64 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureRevision { sequence: u32, generation: u64 }
/// Both IDs must already be verified through native process image queries.
pub fn eligible_owner(foreground: u32, owner: Option<u32>, companion: u32) -> bool {
    foreground != 0 && owner.filter(|pid| *pid != 0)
        .map(|pid| pid == foreground || foreground == companion || pid == companion).unwrap_or(false)
}
/// A missing owner HWND is different from an existing, untrusted owner HWND.
/// Ownerless updates require verified EVE foreground, never Companion foreground.
/// CaptureSession still requires a fresh revision and uninterrupted trusted focus.
pub fn eligible_capture(foreground: u32, owner_window: usize, owner: Option<u32>, companion: u32) -> bool {
    if owner_window == 0 {
        foreground != 0 && foreground != companion
    } else {
        eligible_owner(foreground, owner, companion)
    }
}
impl CaptureSession {
    pub fn configure(&mut self, enabled: bool, sequence: u32) { self.enabled = enabled; self.sequence = sequence; self.generation = self.generation.wrapping_add(1); }
    pub fn observe_focus(&mut self, trusted: bool, sequence: u32) {
        if !trusted || !self.trusted { self.sequence = sequence; self.generation = self.generation.wrapping_add(1); }
        self.trusted = trusted;
    }
    pub fn begin(&mut self, sequence: u32, eligible: bool) -> Option<CaptureRevision> {
        if sequence == 0 || sequence == self.sequence { return None; }
        self.sequence = sequence;
        if !self.enabled || !self.trusted || !eligible { return None; }
        Some(CaptureRevision { sequence, generation: self.generation })
    }
    pub fn valid(&self, revision: CaptureRevision, sequence: u32, eligible: bool) -> bool { self.enabled && self.trusted && eligible && sequence == revision.sequence && self.generation == revision.generation }
}
#[cfg(test)]
mod session_tests {
    use super::*;
    fn active() -> CaptureSession { let mut s=CaptureSession::default();s.configure(true,10);s.observe_focus(true,10);s }
    #[test] fn enter_ignores_existing_copy() { let mut s=active();assert!(s.begin(10,true).is_none());let r=s.begin(11,true).unwrap();assert!(s.valid(r,11,true)); }
    #[test] fn disabled_never_reads() { let mut s=CaptureSession::default();s.observe_focus(true,10);assert!(s.begin(11,true).is_none()); }
    #[test] fn other_application_copy_is_consumed() {let mut s=active();s.observe_focus(false,11);assert!(s.begin(12,true).is_none());s.observe_focus(true,12);assert!(s.begin(12,true).is_none());assert!(s.begin(13,true).is_some());}
    #[test] fn eve_companion_handoff_keeps_fresh_copy() {let mut s=active();s.observe_focus(true,11);assert!(s.begin(11,true).is_some());}
    #[test] fn unknown_owner_is_consumed_not_replayed() {let mut s=active();assert!(s.begin(11,false).is_none());assert!(s.begin(11,true).is_none());}
    #[test] fn background_copy_is_rejected() {let mut s=active();assert!(s.begin(11,false).is_none());}
    #[test] fn brief_other_app_focus_invalidates_pending_revision() {let mut s=active();let r=s.begin(11,true).unwrap();s.observe_focus(false,11);s.observe_focus(true,11);assert!(!s.valid(r,11,true));}
    #[test] fn focus_or_owner_race_invalidates_read() {let mut s=active();let r=s.begin(11,true).unwrap();assert!(!s.valid(r,11,false));assert!(!s.valid(r,12,true));}
    #[test] fn disabling_invalidates_pending_read() {let mut s=active();let r=s.begin(11,true).unwrap();s.configure(false,11);assert!(!s.valid(r,11,true));}
    #[test] fn reenable_ignores_old_revision() {let mut s=active();s.configure(false,11);s.configure(true,12);assert!(s.begin(12,true).is_none());assert!(s.begin(13,true).is_some());}
    #[test] fn owner_requires_verified_nonzero_identity() {assert!(!eligible_owner(10,None,20));assert!(!eligible_owner(10,Some(0),20));assert!(!eligible_owner(0,Some(10),20));}
    #[test] fn foreground_eve_accepts_own_copy_not_another_background_client() {assert!(eligible_owner(10,Some(10),20));assert!(!eligible_owner(10,Some(11),20));}
    #[test] fn both_companion_handoff_directions_accept_trusted_owner() {assert!(eligible_owner(20,Some(10),20));assert!(eligible_owner(10,Some(20),20));}
    #[test] fn ownerless_copy_requires_verified_eve_foreground() {
        assert!(eligible_capture(10,0,None,20));
        assert!(!eligible_capture(20,0,None,20));
        assert!(!eligible_capture(0,0,None,20));
    }
    #[test] fn untrusted_existing_owner_does_not_get_ownerless_exception() {
        assert!(!eligible_capture(10,123,None,20));
        assert!(!eligible_capture(10,123,Some(0),20));
        assert!(!eligible_capture(10,123,Some(11),20));
        assert!(eligible_capture(10,123,Some(10),20));
    }
    #[test] fn ownerless_fresh_eve_copy_is_accepted_and_revalidated() {
        let mut s=active();
        let eligible=eligible_capture(10,0,None,20);
        let revision=s.begin(11,eligible).unwrap();
        assert!(s.valid(revision,11,eligible));
        assert!(s.begin(11,eligible).is_none());
        assert!(!s.valid(revision,11,eligible_capture(20,0,None,20)));
        assert!(!s.valid(revision,11,eligible_capture(10,123,None,20)));
    }
    #[test] fn ownerless_copy_outside_eve_is_not_replayed_on_return() {
        let mut s=active();
        s.observe_focus(false,10);
        assert!(s.begin(11,eligible_capture(0,0,None,20)).is_none());
        s.observe_focus(true,11);
        assert!(s.begin(11,eligible_capture(10,0,None,20)).is_none());
        assert!(s.begin(12,eligible_capture(10,0,None,20)).is_some());
    }
    #[test] fn ownerless_companion_copy_is_not_replayed_in_eve() {
        let mut s=active();
        assert!(s.begin(11,eligible_capture(20,0,None,20)).is_none());
        assert!(s.begin(11,eligible_capture(10,0,None,20)).is_none());
    }
}