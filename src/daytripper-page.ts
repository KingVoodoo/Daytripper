import { LocalSystemPositions, type LocalSystemEvent } from './daytripper-local-position';
import { requireBackendAccess, watchBackendAccess } from './backend-access';
import { listen } from '@tauri-apps/api/event';
import { WormholeTransitEvidence } from './daytripper-transit';
import { call, native } from './bridge';
import { universeGraph } from './universe-graph';
import { positionSummary, type PositionHub } from './character-positions';
import { DaytripperMapperUI } from './wormhole-chain-ui';
import './styles/daytripper-module.css';
import './styles/daytripper-tabler.css';

export async function mountDaytripper(parent: HTMLElement): Promise<void> {
  parent.replaceChildren();
  parent.classList.add('daytripper-tabler-shell');

  const access = await requireBackendAccess().catch(() => null);
  if (!access) { parent.textContent = 'Your chosen main does not have WOK backend access.'; return; }
  await universeGraph.init();

  let disposed = false;
  let daytripperUI: DaytripperMapperUI | null = null;
  let pilotSyncRevision = 0;
  const prevLocations = new Map<string, { id: number; name: string; at: number | null }>();
  const transitEvidence = new WormholeTransitEvidence();
  const localPositions = new LocalSystemPositions();
  const stopLocalSystem = native ? await listen<LocalSystemEvent>('eve-local-system', event => {
    if (disposed) return;
    if (localPositions.record(event.payload, name => universeGraph.getSystemInfo(name))) void fetchAndSyncPilots();
  }) : () => {};
  const pilotPosition = (c: PositionHub['characters'][number]) => {
    const local = localPositions.get(c.name);
    return local ? { systemId: local.systemId, updatedAt: Math.floor(local.seen / 1000) * 1000, state: 'Local log' } : positionSummary(c);
  };
  const stopEvidence = native ? await listen<{ character: string; line: string }>('eve-wormhole-entry', event => {
    transitEvidence.record(event.payload.character, event.payload.line);
  }) : () => {};

  // When a gate or titan bridge jump fires the gamelog emits eve-system-changed.
  // Call fetchAndSyncPilots immediately so jump detection and chain updates
  // happen in ~2-3 s (ESI propagation) instead of waiting up to 8 s (5 s poll + ESI).
  let jumpRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const stopSystemChange = native ? await listen<{ character: string; characterId: number }>('eve-system-changed', () => {
    void fetchAndSyncPilots(true);
    if (jumpRefreshTimer !== null) clearTimeout(jumpRefreshTimer);
    jumpRefreshTimer = setTimeout(() => {
      if (!disposed) void fetchAndSyncPilots(true);
      jumpRefreshTimer = null;
    }, 3000);
  }) : () => {};

  let polling = false;
  async function fetchAndSyncPilots(force = false) {
    if (disposed || polling) return false;
    polling = true;
    const revision = ++pilotSyncRevision;
    try {
      if (native) {
        const conn = await call<{ url: string; signedIn: boolean }>('connection_status').catch(() => null);
        if (!conn?.signedIn) {
          if (daytripperUI) daytripperUI.updateCharacters([]);
          return false;
        }
      }

      const hub = await call<PositionHub>('character_hub', { corporation: false, refresh: force }).catch(() => null);
      if (disposed || revision !== pilotSyncRevision || !hub?.characters) return false;

      const allChars = hub.characters || [];
      const isCharacterOnline = (c: any) => {
        if (localPositions.get(c.name)) return true;
        if (c.online?.online === true || c.online?.status === 'online') return true;
        if (c.online?.online === false || c.online?.status === 'offline') return false;
        const loc = c.location;
        if (loc?.updated_at && (Date.now() - loc.updated_at < 600_000)) return true;
        return false;
      };

      const allOnlineChars = allChars.filter(isCharacterOnline);
      const mapperPilots = allOnlineChars.length > 0 ? allOnlineChars : allChars;

      let storedScannerId = '';
      try {
        storedScannerId = localStorage.getItem('wok_daytripper_scanner_pilot') || '';
      } catch {}

      const resolvedScannerId = (storedScannerId && mapperPilots.some(c => String(c.id) === String(storedScannerId)))
        ? String(storedScannerId)
        : (mapperPilots[0] ? String(mapperPilots[0].id) : '');

      const activePilots = mapperPilots.map(c => {
        const pos = pilotPosition(c);
        const isScanner = resolvedScannerId ? String(c.id) === resolvedScannerId : false;
        const isNav = Boolean((c as any).roles?.includes('Navigation') || (c as any).designatedRoles?.includes('Navigation'));
        const online = isCharacterOnline(c);
        const currSys = pos.systemId ? universeGraph.getSystemInfo(pos.systemId) : null;
        const currName = currSys?.name || c.location?.solar_system_name || (pos.systemId ? `System ${pos.systemId}` : '');
        return {
          id: String(c.id),
          name: c.name,
          systemId: pos.state === 'Stale location' ? 0 : (pos.systemId ?? 0),
          systemName: currName,
          locationUpdatedAt: pos.updatedAt,
          isScanner,
          isNav,
          isOnline: online,
          roles: (c as any).roles,
          ship: c.ship
        };
      });

      if (daytripperUI) daytripperUI.updateCharacters(activePilots);

      // Auto-detect wormhole jumps (only for online mapper pilots)
      for (const c of mapperPilots) {
        const pos = pilotPosition(c);
        if (!pos.systemId || !isCharacterOnline(c) || pos.state === 'Stale location') continue;
        const storageKey = `wok_pilot_last_loc_${c.id}`;
        let prev = prevLocations.get(c.id);
        if (!prev) {
          try {
            const raw = localStorage.getItem(storageKey);
            if (raw) prev = JSON.parse(raw);
          } catch {}
        }

        const currSys = universeGraph.getSystemInfo(pos.systemId);
        const currName = currSys?.name || c.location?.solar_system_name || `System ${pos.systemId}`;

        if (prev && prev.id && prev.id !== pos.systemId) {
          const isStargate = universeGraph.calculateJumps(prev.id, pos.systemId) === 1;
          const bothKSpace = (prev.id < 31000000 || prev.id >= 32000000) && (pos.systemId < 31000000 || pos.systemId >= 32000000);
          const isKnownWormhole = Boolean(
            daytripperUI?.hasConnection(prev.id, pos.systemId) ||
            daytripperUI?.hasPendingExploration(prev.id, pos.systemId)
          );
          const confirmed = transitEvidence.consume(c.name, prev.at, pos.updatedAt);
          if (!isStargate && (!bothKSpace || confirmed || isKnownWormhole) && daytripperUI) {
            daytripperUI.onCharacterJump(c.name, prev.id, pos.systemId, prev.name, currName, c.ship, Boolean(confirmed || isKnownWormhole));
          }
        }
        prevLocations.set(c.id, { id: pos.systemId, name: currName, at: pos.updatedAt });
        try {
          localStorage.setItem(storageKey, JSON.stringify({ id: pos.systemId, name: currName, at: pos.updatedAt }));
        } catch {}
      }
      return true;
    } catch (err) {
      console.warn('[Daytripper Page] Pilot sync error:', err);
      return false;
    } finally { polling = false; }
  }

  daytripperUI = new DaytripperMapperUI(
    parent,
    undefined,
    () => fetchAndSyncPilots(true)
  );

  const stopAccess = watchBackendAccess(next => {
    if (!parent.isConnected || !next.backendAllowed || next.subjectKey !== access.subjectKey) {
      disposed = true;
      daytripperUI?.stopBackendAccess();
      stopEvidence();
      stopLocalSystem();
      localPositions.clear();
      stopSystemChange();
      if (jumpRefreshTimer !== null) clearTimeout(jumpRefreshTimer);
      parent.textContent = 'Your chosen main does not have WOK backend access.';
    }
  });
  void fetchAndSyncPilots(true);

  const pollInterval = setInterval(() => {
    if (disposed) {
      clearInterval(pollInterval);
      stopAccess();
      window.removeEventListener('focus', onFocus);
      return;
    }
    if (!document.hidden) {
      void fetchAndSyncPilots(true);
    }
  }, 5000);

  const onFocus = () => {
    if (!disposed) void fetchAndSyncPilots(true);
  };
  window.addEventListener('focus', onFocus);

  window.addEventListener('unload', () => {
    disposed = true;
    stopAccess();
    daytripperUI?.stopBackendAccess();
    stopEvidence();
    stopLocalSystem();
    localPositions.clear();
    stopSystemChange();
    if (jumpRefreshTimer !== null) clearTimeout(jumpRefreshTimer);
    clearInterval(pollInterval);
    window.removeEventListener('focus', onFocus);
  }, { once: true });
}
