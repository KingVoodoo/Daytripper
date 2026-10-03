import { LocalSystemPositions, type LocalSystemEvent } from './daytripper-local-position';
import {systemDisplayName} from './home-system';
import { useOverlayPanelFocus } from './useOverlayPanelFocus';
import { backendGrantKey } from './backend-access';
import { useBackendAccess } from './useBackendAccess';
import type { WormholeNodeData, WormholeLinkData, DaytripperMapData } from './daytripper-map-types';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ClipboardPaste,
  Compass,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { call, emitEvent, native, onEvent } from './bridge';
import { useOverlayContentBounds } from './useOverlayContentBounds';
import {
  WORMHOLE_CODES,
  SYSTEM_EFFECTS,
  deriveSpaceTypeFromWhSpec,
  generateWormholeBookmark,
  parseProbeScannerText,
  mergeScannedSignatures,
  cleanStaleSignatures,
  type ScannedSignature,
} from './wormhole-data';
import { getSystemStatics } from './wormhole-statics';
import { universeGraph } from './universe-graph';
import './styles/daytripper-module.css';
import './styles/daytripper-signatures.css';
import './styles/mapping-overlay.css';
import './styles/mapping-k162-dialog.css';

const STORAGE_MAPS_KEY = 'wok_daytripper_maps_v2';
const STORAGE_SCANNER_PILOT_KEY = 'wok_daytripper_scanner_pilot';

interface DaytripperLatestBookmark {
  text: string;
  timestamp: number;
  type?: 'forward' | 'breadcrumb' | string;
  fromSystem?: string;
  toSystem?: string;
  sigId?: string;
  sourceSystemId?: number;
  sourceSigId?: string;
  destSystemId?: number;
  parsedSummary?: string;
}

type WormholeNode = WormholeNodeData;

// Overlay retains optional lifetime and legacy aliases.
interface WormholeLink extends WormholeLinkData {
  eol?: boolean;
  frigate?: boolean;
}

type DaytripperMapPage = DaytripperMapData<WormholeNode, WormholeLink>;

// Helper to read signatures for a specific system from the Daytripper array format
function getSigsForSystem(map: DaytripperMapPage | null, systemId: number): ScannedSignature[] {
  if (!map) return [];
  // Daytripper canonical: array of { systemId, sigs }
  if (Array.isArray(map.signatures)) {
    const entry = map.signatures.find((e) => e.systemId === systemId);
    return entry?.sigs || [];
  }
  // Legacy/compat: Record<number, ScannedSignature[]>
  const legacy = map.signatures as unknown as Record<number, ScannedSignature[]>;
  return legacy?.[systemId] || [];
}

// Helper to write updated signatures back into the Daytripper array format
function setSigsForSystem(
  map: DaytripperMapPage,
  systemId: number,
  sigs: ScannedSignature[]
): DaytripperMapPage {
  const existing = Array.isArray(map.signatures) ? [...map.signatures] : [];
  const idx = existing.findIndex((e) => e.systemId === systemId);
  if (idx >= 0) {
    existing[idx] = { systemId, sigs };
  } else {
    existing.push({ systemId, sigs });
  }
  return { ...map, signatures: existing };
}

function clearSigsForSystem(map: DaytripperMapPage, systemId: number): DaytripperMapPage {
  const existing = Array.isArray(map.signatures) ? map.signatures.filter((e) => e.systemId !== systemId) : [];
  existing.push({ systemId, sigs: [] });
  return { ...map, signatures: existing };
}

interface HubCharacter {
  id: string;
  name?: string;
  isMain?: boolean;
  roles?: string[];
  designatedRoles?: string[];
  online?: any;
  location?: { solar_system_id?: number | null; solar_system_name?: string | null };
}

export function MappingOverlayWindow() {
  useEffect(()=>{if(native)void call('overlay_ready').catch(console.error);},[]);
  useOverlayPanelFocus();
  const backendAccess = useBackendAccess();
  const boundsRef = useOverlayContentBounds();
  const localPositions = useRef(new LocalSystemPositions());
  const [pendingCatch, setPendingCatch] = useState<any>(null);
  const catchRequestId = useRef('');
  const [returnCode, setReturnCode] = useState('');
  const [returnSig, setReturnSig] = useState('');
  const [catchStatus, setCatchStatus] = useState('');

  // Active Scanner Pilot & Characters
  const [availableCharacters, setAvailableCharacters] = useState<HubCharacter[]>([]);
  const [selectedPilotId, setSelectedPilotId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_SCANNER_PILOT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isSelectingPilot, setIsSelectingPilot] = useState<boolean>(false);
  const [activePilotName, setActivePilotName] = useState<string>('Scanner');
  const [activePilotId, setActivePilotId] = useState<string>('');

  // Active System Telemetry
  const [currentSystemId, setCurrentSystemId] = useState<number | null>(null);
  const [currentSystemName, setCurrentSystemName] = useState<string>('');

  // Daytripper Chain State
  const [maps, setMaps] = useState<DaytripperMapPage[]>([]);
  const [activeMapId, setActiveMapId] = useState<string>('primary');

  // Targeted Signature & Pre-Jump Target Lock
  const [targetedSigId, setTargetedSigId] = useState<string | null>(null);
  const [targetWhCode, setTargetWhCode] = useState<string>('K162');
  const [customWanderingCode, setCustomWanderingCode] = useState<string>('');
  const [isStatic, setIsStatic] = useState<boolean>(true);
  const [isEol, setIsEol] = useState<boolean>(false);
  const [isCrit, setIsCrit] = useState<boolean>(false);
  const [isFrig, setIsFrig] = useState<boolean>(false);

  // Daytripper Bookmark Flow State
  const [latestBookmark, setLatestBookmark] = useState<DaytripperLatestBookmark | null>(() => {
    try {
      if (localStorage.getItem('wok_daytripper_access') !== backendGrantKey()) return null;
      const raw = localStorage.getItem('wok.daytripperLatestBookmark');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  // UI States
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // BroadcastChannel for cross-window sync
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Load maps from storage
  // Daytripper stores: { maps: [...], activeMapId: '...' } — match that format exactly
  const reloadMaps = useCallback(() => {
    if (!backendAccess.backendAllowed) { setMaps([]); return; }
    try {
      const raw = localStorage.getItem(STORAGE_MAPS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Handle Daytripper's canonical format: { maps: [...], activeMapId: '...' }
        if (parsed?.accessGrant === backendGrantKey(backendAccess) && backendGrantKey(backendAccess) && Array.isArray(parsed.maps) && parsed.maps.length > 0) {
          setMaps(parsed.maps);
          if (parsed.activeMapId) {
            setActiveMapId(parsed.activeMapId);
          }
          return;
        }

      }
    } catch {}
    setMaps([]);
  }, [backendAccess.backendAllowed, backendAccess.subjectKey, backendAccess.revision]);

  // Save maps and notify main Daytripper window
  // Must write the same { maps, activeMapId } object format that Daytripper expects
  const saveAndBroadcast = useCallback((newMaps: DaytripperMapPage[], newActiveMapId?: string) => {
    if (!backendGrantKey(backendAccess) || backendGrantKey(backendAccess) !== backendGrantKey()) return;
    const resolvedMapId = newActiveMapId ?? activeMapId;
    setMaps(newMaps);
    try {
      localStorage.setItem('wok_daytripper_access', backendGrantKey(backendAccess)!);
      localStorage.setItem(STORAGE_MAPS_KEY, JSON.stringify({
        accessGrant: backendGrantKey(backendAccess),
        maps: newMaps,
        activeMapId: resolvedMapId,
      }));
    } catch {}
    try {
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('wok_daytripper_channel');
      }
      channelRef.current.postMessage({
        accessGrant: backendGrantKey(backendAccess),
        type: 'chain_update',
        mapId: resolvedMapId,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    } catch {}
    if (native) {
      void emitEvent('wok_daytripper_channel', {
        accessGrant: backendGrantKey(backendAccess),
        type: 'chain_update',
        mapId: resolvedMapId,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    }
  }, [activeMapId, backendAccess.backendAllowed, backendAccess.subjectKey, backendAccess.revision]);

  // Broadcast targeted signature to Daytripper engine
  const broadcastTargetSig = useCallback((tgtPayload: any) => {
    if (!backendGrantKey(backendAccess) || backendGrantKey(backendAccess) !== backendGrantKey()) return;
    try {
      if (tgtPayload) {
        localStorage.setItem('wok.daytripperTargetedSig', JSON.stringify(tgtPayload));
      } else {
        localStorage.removeItem('wok.daytripperTargetedSig');
      }
    } catch {}
    try {
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('wok_daytripper_channel');
      }
      channelRef.current.postMessage({
        accessGrant: backendGrantKey(backendAccess),
        type: 'target_sig',
        target: tgtPayload,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    } catch {}
    if (native) {
      void emitEvent('wok_daytripper_channel', {
        accessGrant: backendGrantKey(backendAccess),
        type: 'target_sig',
        target: tgtPayload,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    }
  }, [backendAccess.backendAllowed, backendAccess.subjectKey, backendAccess.revision]);

  // Reset bookmark sequence across both Daytripper and Overlay
  const handleResetFlow = useCallback(() => {
    setLatestBookmark(null);
    setTargetedSigId(null);
    try {
      localStorage.removeItem('wok.daytripperLatestBookmark');
      localStorage.removeItem('wok.daytripperTargetedSig');
    } catch {}
    try {
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('wok_daytripper_channel');
      }
      channelRef.current.postMessage({
        accessGrant: backendGrantKey(backendAccess),
        type: 'reset_bookmark_flow',
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    } catch {}
    if (native) {
      void emitEvent('wok_daytripper_channel', {
        accessGrant: backendGrantKey(backendAccess),
        type: 'reset_bookmark_flow',
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    }
  }, []);

  // Initialize broadcast channel and storage listeners
  useEffect(() => {
    let syncDisposed = false;
    setPendingCatch(null); catchRequestId.current = '';
    reloadMaps();

    // Sync targeted signature from storage on mount
    try {
      const rawTgt = localStorage.getItem('wok_daytripper_access') === backendGrantKey(backendAccess) ? localStorage.getItem('wok.daytripperTargetedSig') : null;
      if (rawTgt) {
        const tgt = JSON.parse(rawTgt);
        if (tgt && tgt.sigId) {
          setTargetedSigId(tgt.sigId);
          if (tgt.whCode) setTargetWhCode(tgt.whCode);
          if (tgt.isStatic !== undefined) setIsStatic(Boolean(tgt.isStatic));
          if (tgt.isEol !== undefined) setIsEol(Boolean(tgt.isEol));
          if (tgt.isCrit !== undefined) setIsCrit(Boolean(tgt.isCrit));
          if (tgt.isFrig !== undefined) setIsFrig(Boolean(tgt.isFrig));
        }
      }
    } catch {}

    const handleChannelMessage = (evData: any) => {
      if (!evData || !backendGrantKey(backendAccess) || backendGrantKey(backendAccess) !== backendGrantKey() || (evData.type !== 'set_scanner_pilot' && evData.accessGrant !== backendGrantKey())) return;
      if (evData.type === 'k162_catch' && evData.request?.requestId !== catchRequestId.current) {
        catchRequestId.current = evData.request?.requestId;
        setPendingCatch(evData.request);
        setReturnCode(''); setReturnSig(''); setCatchStatus('');
      }
      if (evData.type === 'k162_result') {
        setCatchStatus(evData.error || 'Connection saved');
        if (!evData.error) { setPendingCatch(null); reloadMaps(); }
      }
      if (evData.type === 'chain_update' && evData.source !== 'mapping-overlay') {
        reloadMaps();
      }
      if (evData.type === 'target_sig' && evData.source !== 'mapping-overlay') {
        const tgt = evData.target ?? evData.payload;
        if (!tgt) {
          setTargetedSigId(null);
        } else {
          setTargetedSigId(tgt.sigId);
          if (tgt.whCode) setTargetWhCode(tgt.whCode);
          if (tgt.isStatic !== undefined) setIsStatic(Boolean(tgt.isStatic));
          if (tgt.isEol !== undefined) setIsEol(Boolean(tgt.isEol));
          if (tgt.isCrit !== undefined) setIsCrit(Boolean(tgt.isCrit));
          if (tgt.isFrig !== undefined) setIsFrig(Boolean(tgt.isFrig));
        }
      }
      if (evData.type === 'latest_bookmark' && evData.source !== 'mapping-overlay') {
        setLatestBookmark(evData.bookmark ?? evData.payload ?? null);
      }
      if (evData.type === 'reset_bookmark_flow' && evData.source !== 'mapping-overlay') {
        setLatestBookmark(null);
        setTargetedSigId(null);
      }
      if (evData.type === 'set_scanner_pilot' && evData.source !== 'mapping-overlay') {
        if (evData.pilotId) {
          setSelectedPilotId(String(evData.pilotId));
        }
      }
    };

    try {
      const ch = new BroadcastChannel('wok_daytripper_channel');
      channelRef.current = ch;
      ch.postMessage({ type: 'overlay_ready', accessGrant: backendGrantKey(backendAccess) });
      ch.onmessage = (ev) => {
        handleChannelMessage(ev.data);
      };
    } catch {}

    let unlistenTauri: (() => void) | undefined;
    if (native) {
      void onEvent('wok_daytripper_channel', (payload: any) => {
        handleChannelMessage(payload);
      }).then((stop) => {
        if (syncDisposed) { stop(); return; }
        unlistenTauri = stop;
        void emitEvent('wok_daytripper_channel', { type: 'overlay_ready', accessGrant: backendGrantKey(backendAccess) });
      });
    }

    const onStorage = (e: StorageEvent) => {
      if (!backendGrantKey(backendAccess) || backendGrantKey(backendAccess) !== backendGrantKey() || localStorage.getItem('wok_daytripper_access') !== backendGrantKey()) return;
      if (e.key === STORAGE_MAPS_KEY) reloadMaps();
      if (e.key === STORAGE_SCANNER_PILOT_KEY) {
        if (e.newValue) setSelectedPilotId(e.newValue);
      }
      if (e.key === 'wok.daytripperLatestBookmark') {
        try {
          setLatestBookmark(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {}
      }
      if (e.key === 'wok.daytripperTargetedSig') {
        try {
          const tgt = e.newValue ? JSON.parse(e.newValue) : null;
          if (!tgt) {
            setTargetedSigId(null);
          } else {
            setTargetedSigId(tgt.sigId);
            if (tgt.whCode) setTargetWhCode(tgt.whCode);
            if (tgt.isStatic !== undefined) setIsStatic(Boolean(tgt.isStatic));
            if (tgt.isEol !== undefined) setIsEol(Boolean(tgt.isEol));
            if (tgt.isCrit !== undefined) setIsCrit(Boolean(tgt.isCrit));
            if (tgt.isFrig !== undefined) setIsFrig(Boolean(tgt.isFrig));
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      syncDisposed = true;
      window.removeEventListener('storage', onStorage);
      channelRef.current?.close();
      if (unlistenTauri) unlistenTauri();
    };
  }, [reloadMaps]);

  // Set initial always-on-top
  useEffect(() => {
    if (native) {
      void getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
    }
  }, []);

  // Poll active characters and location from ESI / Hub every 2.5s
  useEffect(() => {
    let disposed = false;
    let fetchRevision = 0;
    let polling = false;
    setCurrentSystemId(null); setCurrentSystemName('');
    const fetchLocation = async (refresh = false) => {
      if (disposed || polling || !backendAccess.backendAllowed) return;
      polling = true;
      const revision = ++fetchRevision;
      try {
        await universeGraph.init();
        const hub = await call<{
          characters?: HubCharacter[];
        }>('character_hub', { corporation: false, refresh }).catch(() => null);

        if (disposed || revision !== fetchRevision) return;
        if (!hub?.characters?.length) { setCurrentSystemId(null); setCurrentSystemName(''); return; }
        const chars = hub.characters;
        setAvailableCharacters(chars);

        // Character selection priority:
        // 1. Explicitly stored user preference
        // 2. Character with 'Scanner' or 'Scout' in roles
        // 3. Character currently in J-Space (31000000 - 32000000)
        // 4. Non-main alt character
        // 5. Fallback to main or first character
        let scout: HubCharacter | undefined;

        if (selectedPilotId) {
          scout = chars.find((c) => String(c.id) === String(selectedPilotId));
        }

        if (!scout) {
          const isScannerRole = (c: HubCharacter) => {
            const roles = [...(c.roles || []), ...(c.designatedRoles || [])];
            return roles.some((r) => typeof r === 'string' && (r.toLowerCase().includes('scan') || r.toLowerCase().includes('scout')));
          };
          scout = chars.find(isScannerRole);
        }

        if (!scout) {
          // Check if any character is exploring in wormhole space
          scout = chars.find((c) => {
            const sysId = Number(c.location?.solar_system_id || 0);
            return sysId >= 31000000 && sysId <= 32000000;
          });
        }

        if (!scout) {
          // Alt character preferred over main for scouting
          scout = chars.find((c) => !c.isMain && (c.online?.online === true || c.online?.status === 'online')) || chars.find((c) => !c.isMain);
        }

        if (!scout) {
          scout = chars.find((c) => c.isMain) || chars[0];
        }

        if (scout) {
          setActivePilotName(scout.name || 'Scanner');
          setActivePilotId(String(scout.id));
          const local = localPositions.current.get(scout.name || '');
          const sysId = local?.systemId ?? (scout.location?.solar_system_id ? Number(scout.location.solar_system_id) : null);
          const sysName = local?.systemName || scout.location?.solar_system_name || (sysId ? universeGraph.getSystemInfo(sysId)?.name || `System #${sysId}` : '');

          setCurrentSystemId(sysId);
          setCurrentSystemName(sysName);
        }
      } catch {} finally { polling = false; }
    };

    localPositions.current.clear();
    let stopLocal: (() => void) | undefined;
    let stopJump: (() => void) | undefined;
    void onEvent<LocalSystemEvent>('eve-local-system', async event => {
      await universeGraph.init();
      if (!disposed && localPositions.current.record(event, name => universeGraph.getSystemInfo(name))) void fetchLocation();
    }).then(stop => { if (disposed) stop(); else stopLocal = stop; });
    void onEvent('eve-system-changed', () => { void fetchLocation(true); })
      .then(stop => { if (disposed) stop(); else stopJump = stop; });
    void fetchLocation();
    const interval = setInterval(() => { void fetchLocation(); }, 2500);
    return () => {
      disposed = true;
      clearInterval(interval);
      stopLocal?.(); stopJump?.();
    };
  }, [selectedPilotId, backendAccess.backendAllowed, backendAccess.subjectKey]);

  useEffect(() => {
    if (!currentSystemId || !backendGrantKey(backendAccess)) return;
    const event = { type: 'select_system', systemId: currentSystemId, accessGrant: backendGrantKey(backendAccess) };
    channelRef.current?.postMessage(event);
    void emitEvent('wok_daytripper_channel', event);
  }, [currentSystemId, backendAccess.subjectKey, backendAccess.revision]);

  useEffect(() => {
    if (!activePilotId || !backendGrantKey(backendAccess) || (selectedPilotId && selectedPilotId !== activePilotId)) return;
    localStorage.setItem(STORAGE_SCANNER_PILOT_KEY, activePilotId);
    const event = { type: 'set_scanner_pilot', pilotId: activePilotId, pilotName: activePilotName, source: 'mapping-overlay', accessGrant: backendGrantKey(backendAccess) };
    channelRef.current?.postMessage(event);
    void emitEvent('wok_daytripper_channel', event);
  }, [activePilotId, activePilotName, selectedPilotId, backendAccess.subjectKey, backendAccess.revision]);

  // Resolve active map
  const activeMap = useMemo(() => {
    return maps.find((m) => m.id === activeMapId) || maps[0] || null;
  }, [maps, activeMapId]);

  // Resolve active node for the selected system in Daytripper (or fallback to current scanner location)
  const activeNode = useMemo(() => {
    if (!activeMap) return null;
    if (currentSystemId) return activeMap.nodes.find(n => n.systemId === currentSystemId) || null;
    return null;
  }, [activeMap, currentSystemId]);

  // Auto-chart current system into the active chain map if missing
  const handleChartSystem = useCallback(() => {
    if (!currentSystemId || !activeMap) return;
    const staticsInfo = getSystemStatics(currentSystemId) || getSystemStatics(currentSystemName);
    const sysInfo = universeGraph.getSystemInfo(currentSystemId);

    let whClass = staticsInfo?.whClass || (currentSystemId >= 31000000 ? (currentSystemId === 31000005 ? 'Thera' : 'W-Space') : 'K-Space');
    if (whClass === 'K-Space' && sysInfo?.security !== undefined) {
      whClass = sysInfo.security >= 0.45 ? 'Highsec' : sysInfo.security > 0.0 ? 'Lowsec' : 'Nullsec';
    }

    const newNode: WormholeNode = {
      systemId: currentSystemId,
      systemName: currentSystemName || `System #${currentSystemId}`,
      whClass,
      security: sysInfo?.security,
      depth: 0,
      x: 200,
      y: 200,
      effect: staticsInfo?.effect,
      statics: staticsInfo?.statics,
      status: 'normal',
      scoutedBy: activePilotName,
    };

    const updatedNodes = [...activeMap.nodes, newNode];
    const updatedMap = { ...activeMap, nodes: updatedNodes, selectedSystemId: currentSystemId };
    const updatedMaps = maps.map((m) => (m.id === activeMap.id ? updatedMap : m));
    saveAndBroadcast(updatedMaps);
  }, [currentSystemId, currentSystemName, activeMap, maps, activePilotName, saveAndBroadcast]);

  // Effective system info
  const effectiveSystemId = activeNode?.systemId || currentSystemId || 0;
  const effectiveSystemName = activeNode?.systemName || currentSystemName || 'Waiting for pilot location';
  const statics = useMemo(() => {
    if (activeNode?.statics?.length) return activeNode.statics;
    const found = getSystemStatics(effectiveSystemId)?.statics || getSystemStatics(effectiveSystemName)?.statics;
    return found || [];
  }, [activeNode, effectiveSystemId, effectiveSystemName]);

  const effect = activeNode?.effect || getSystemStatics(effectiveSystemId)?.effect || getSystemStatics(effectiveSystemName)?.effect;

  // Resolve signatures for effective node
  // Uses getSigsForSystem() to handle both Daytripper's array format and legacy Record format
  const activeSignatures: ScannedSignature[] = useMemo(() => {
    if (!activeMap || !effectiveSystemId) return [];
    return getSigsForSystem(activeMap, effectiveSystemId);
  }, [activeMap, effectiveSystemId]);

  // Filter wormhole and cosmic candidate signatures
  const isWhSig = useCallback(
    (s: ScannedSignature) =>
      (s.group || '').toLowerCase() === 'wormhole' ||
      (s.name || '').toLowerCase().includes('wormhole') ||
      Boolean(s.linkedLinkId) ||
      (activeMap?.links || []).some((l) => l.sourceSig === s.id || l.targetSig === s.id),
    [activeMap]
  );

  const wormholeSigs = useMemo(() => activeSignatures.filter(isWhSig), [activeSignatures, isWhSig]);
  const cosmicSigs = useMemo(
    () => activeSignatures.filter((s) => !isWhSig(s) && (s.group === 'Unknown' || (s.name || '').toLowerCase().includes('cosmic signature'))),
    [activeSignatures, isWhSig]
  );

  // Security status formatting
  const secVal = useMemo(() => {
    if (activeNode?.security !== undefined) return activeNode.security;
    const info = universeGraph.getSystemInfo(effectiveSystemId) || universeGraph.getSystemInfo(effectiveSystemName);
    if (info?.security !== undefined) return info.security;
    if (activeNode?.whClass?.startsWith('C') || activeNode?.whClass === 'Thera' || effectiveSystemId >= 31000000) return -0.99;
    return 0.0;
  }, [activeNode, effectiveSystemId, effectiveSystemName]);

  const secText = secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1);
  const secCls = secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (activeNode?.whClass?.startsWith('C') || activeNode?.whClass === 'Thera' || effectiveSystemId >= 31000000 ? 'wspace' : 'nullsec');

  const whClass = activeNode?.whClass || (effectiveSystemId >= 31000000 ? 'W-Space' : 'Unknown');
  const shortClass = whClass === 'Nullsec' ? 'NS' : whClass === 'Highsec' ? 'HS' : whClass === 'Lowsec' ? 'LS' : whClass === 'Pochven' ? 'Trig' : whClass;
  const whClassKey = whClass.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Closest trade hub calculation
  const closestHub = useMemo(() => {
    if (!effectiveSystemId) return null;
    const whEdges: [number, number][] = (activeMap?.links || []).map((l) => [l.sourceId, l.targetId]);
    const hubDistances = universeGraph.calculateClosestHubs(effectiveSystemId, whEdges);
    return hubDistances.length > 0 && hubDistances[0].totalJumps > 0 ? hubDistances[0] : null;
  }, [effectiveSystemId, activeMap]);

  // Generated Outward Bookmark String for Targeted Signature
  const outwardBookmarkString = useMemo(() => {
    if (!targetedSigId) return '';
    const code = customWanderingCode.trim().toUpperCase() || targetWhCode || 'WH';
    const spec = WORMHOLE_CODES[code];
    const destSpace = spec ? deriveSpaceTypeFromWhSpec(spec) : (code === 'K162' ? '???' : 'W-Space');

    return generateWormholeBookmark({
      sigId: targetedSigId,
      targetSpaceType: destSpace,
      isStatic,
      targetSystemName: '[Destination]',
      targetSecurity: destSpace === 'NS' ? -0.9 : destSpace === 'HS' ? 0.7 : destSpace === 'LS' ? 0.3 : undefined,
      whCode: code,
      isEol,
      isCrit,
      isFrigate: isFrig,
    });
  }, [targetedSigId, targetWhCode, customWanderingCode, isStatic, isEol, isCrit, isFrig]);

  // Copy helper with flash feedback
  const handleCopyText = (text: string, key: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  // Helper to update pre-jump lock modifiers and broadcast to Daytripper
  const updateTargetModifiers = (partial: Partial<{
    whCode: string;
    isStatic: boolean;
    isEol: boolean;
    isCrit: boolean;
    isFrig: boolean;
    spaceType: string;
  }>) => {
    if (!targetedSigId) return;
    const nextWhCode = partial.whCode !== undefined ? partial.whCode : (customWanderingCode.trim().toUpperCase() || targetWhCode);
    const nextIsStatic = partial.isStatic !== undefined ? partial.isStatic : isStatic;
    const nextIsEol = partial.isEol !== undefined ? partial.isEol : isEol;
    const nextIsCrit = partial.isCrit !== undefined ? partial.isCrit : isCrit;
    const nextIsFrig = partial.isFrig !== undefined ? partial.isFrig : isFrig;
    const spec = WORMHOLE_CODES[nextWhCode];
    const nextSpace = partial.spaceType || (spec ? deriveSpaceTypeFromWhSpec(spec) : (nextWhCode === 'K162' ? '???' : 'W-Space'));

    const updated = {
      systemId: effectiveSystemId,
      sigId: targetedSigId,
      whCode: nextWhCode,
      spaceType: nextSpace,
      isStatic: nextIsStatic,
      isEol: nextIsEol,
      isCrit: nextIsCrit,
      isFrig: nextIsFrig,
    };
    broadcastTargetSig(updated);
  };

  // Toggle targeted signature — Remote control for Daytripper engine
  const handleToggleTarget = (sigId: string) => {
    if (targetedSigId === sigId) {
      setTargetedSigId(null);
      broadcastTargetSig(null);
    } else {
      setTargetedSigId(sigId);
      const firstStatic = statics[0];
      const initialCode = firstStatic || 'K162';
      setTargetWhCode(initialCode);
      setCustomWanderingCode('');
      setIsStatic(Boolean(firstStatic));

      const spec = WORMHOLE_CODES[initialCode];
      const isFrigHole = Boolean(spec?.maxJumpMassTons && spec.maxJumpMassTons <= 5000);
      setIsFrig(isFrigHole);
      setIsEol(false);
      setIsCrit(false);

      const destSpace = spec ? deriveSpaceTypeFromWhSpec(spec) : (initialCode === 'K162' ? '???' : 'W-Space');
      const newTarget = {
        systemId: effectiveSystemId,
        sigId,
        whCode: initialCode,
        spaceType: destSpace,
        isStatic: Boolean(firstStatic),
        isEol: false,
        isCrit: false,
        isFrig: isFrigHole,
      };
      broadcastTargetSig(newTarget);
    }
  };

  // Manual on-demand copy of return breadcrumb bookmark (BT)
  const handleCopyBtBookmark = () => {
    if (!targetedSigId) return;
    const btStr = `BT ${targetedSigId} ${effectiveSystemName}`;
    void navigator.clipboard.writeText(btStr);
    const newBm: DaytripperLatestBookmark = {
      text: btStr,
      timestamp: Date.now(),
      type: 'breadcrumb',
      fromSystem: effectiveSystemName,
      toSystem: '[Destination]',
      sigId: targetedSigId,
      sourceSystemId: effectiveSystemId,
      sourceSigId: targetedSigId,
      parsedSummary: `Return Breadcrumb -> ${effectiveSystemName}`,
    };
    setLatestBookmark(newBm);
    try {
      localStorage.setItem('wok.daytripperLatestBookmark', JSON.stringify(newBm));
    } catch {}
    try {
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('wok_daytripper_channel');
      }
      channelRef.current.postMessage({
        accessGrant: backendGrantKey(backendAccess),
        type: 'latest_bookmark',
        bookmark: newBm,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    } catch {}
    if (native) {
      void emitEvent('wok_daytripper_channel', {
        accessGrant: backendGrantKey(backendAccess),
        type: 'latest_bookmark',
        bookmark: newBm,
        source: 'mapping-overlay',
        timestamp: Date.now(),
      });
    }
    handleCopyText(btStr, 'copy-bt');
  };

  // Paste probe scanner clipboard
  const handlePasteClipboard = async () => {
    if (!activeMap || !effectiveSystemId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      const incoming = parseProbeScannerText(text);
      if (!incoming.length) return;

      const existing = getSigsForSystem(activeMap, effectiveSystemId);
      const merged = mergeScannedSignatures(existing, incoming);

      const updatedMap = setSigsForSystem(activeMap, effectiveSystemId, merged);
      const updatedMaps = maps.map((m) => (m.id === activeMap.id ? updatedMap : m));
      saveAndBroadcast(updatedMaps);
      handleCopyText('Pasted!', 'paste-btn');
    } catch {}
  };

  // Clear signatures / Reset
  const handleClearSignatures = () => {
    if (!activeMap || !effectiveSystemId) return;
    const updatedMap = clearSigsForSystem(activeMap, effectiveSystemId);
    const updatedMaps = maps.map((m) => (m.id === activeMap.id ? updatedMap : m));
    saveAndBroadcast(updatedMaps);
    setTargetedSigId(null);
  };

  // Add child wormhole connection (quick placeholder)
  const handleAddChildConnection = () => {
    const dest = window.prompt('Enter destination system name or ID:');
    if (!dest || !dest.trim() || !activeMap) return;
    const trimmed = dest.trim();
    const info = universeGraph.getSystemInfo(trimmed);
    const destId = info?.id || (trimmed.startsWith('J') ? Number(trimmed.replace('J', '3100')) : 31000000 + Math.floor(Math.random() * 900000));
    const destStatics = getSystemStatics(destId) || getSystemStatics(trimmed);

    const newNode: WormholeNode = {
      systemId: destId,
      systemName: info?.name || trimmed,
      whClass: destStatics?.whClass || (destId >= 31000000 ? 'C5' : 'Nullsec'),
      security: info?.security,
      depth: (activeNode?.depth || 0) + 1,
      x: (activeNode?.x || 200) + 120,
      y: (activeNode?.y || 200) + 80,
      effect: destStatics?.effect,
      statics: destStatics?.statics,
      status: 'normal',
      scoutedBy: activePilotName,
    };

    const newLink: WormholeLink = {
      id: `link-${Date.now()}`,
      sourceId: effectiveSystemId,
      targetId: destId,
      sourceSig: targetedSigId || undefined,
      whCode: targetWhCode !== 'K162' ? targetWhCode : undefined,
      massStatus: isCrit ? 'critical' : 'stable',
      eol: isEol,
      frigate: isFrig,
    };

    const updatedNodes = [...activeMap.nodes, newNode];
    const updatedLinks = [...activeMap.links, newLink];
    const updatedMap = { ...activeMap, nodes: updatedNodes, links: updatedLinks, selectedSystemId: destId };
    const updatedMaps = maps.map((m) => (m.id === activeMap.id ? updatedMap : m));
    saveAndBroadcast(updatedMaps);
  };

  if (!backendAccess.backendAllowed) return <p role="status">Your chosen main does not have WOK backend access.</p>;

  return (
    <div ref={boundsRef} className="wh-mapping-overlay-shell">
      {pendingCatch && <section role="dialog" aria-modal="true" aria-label="Assign K162 return connection" className="wh-canvas-node selected wh-overlay-card wh-k162-overlay-dialog">
        <h3>Assign K162 return connection</h3>
        <p>{pendingCatch.fromName} to {pendingCatch.toName}</p>
        <label>Return wormhole code<select className="wh-input" value={returnCode} onChange={e => setReturnCode(e.target.value)}>
          <option value="">Select code</option>
          {Object.keys(WORMHOLE_CODES).filter(code => code !== 'K162').map(code => <option key={code}>{code}</option>)}
        </select></label>
        <label>Return signature<input className="wh-input" placeholder="ABC-123" value={returnSig} onChange={e => setReturnSig(e.target.value.toUpperCase())} /></label>
        <button type="button" className="map-btn" disabled={!returnCode || !/^[A-Z]{3}-[0-9]{3}$/.test(returnSig)} onClick={() => {
          const event = { type: 'k162_assign', accessGrant: backendGrantKey(backendAccess), request: pendingCatch, code: returnCode, sigId: returnSig };
          channelRef.current?.postMessage(event);
          void emitEvent('wok_daytripper_channel', event);
          setCatchStatus('Saving connection...');
        }}>Assign connection</button>
        <button type="button" className="map-btn" onClick={() => setPendingCatch(null)}>Later</button>
        <p role="status">{catchStatus}</p>
      </section>}
      {!pendingCatch && <div className="wh-canvas-node selected wh-overlay-card">
        {/* 1. Header: Sec Badge, Class Badge, System Title, Action Buttons */}
        <div className="wh-node-header" onPointerDown={event => {
          if (!native || event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
          event.preventDefault();
          // Use the overlay move loop so monitor edges do not trigger Windows Snap.
          void call('drag_window').catch(() => {});
        }}>
          <div className="wh-node-header-left">
            <span className={`wh-card-sec-badge ${secCls}`} title={`Security Status: ${secText}`}>
              {secText}
            </span>
            <span className={`wh-class-badge wh-class-${whClassKey}`} title={`Space Class: ${whClass}`}>
              {shortClass}
            </span>
            <span className="wh-node-title" title={`${effectiveSystemName} (${whClass} ${secText})`}>
              {systemDisplayName(effectiveSystemId,effectiveSystemName)}
            </span>
          </div>

          <div className="wh-node-actions">
            <button type="button" className="wh-node-action-btn" aria-label="Open Daytripper map" title="Open Daytripper map" onClick={()=>{void call('open_module',{id:'daytripper'});}}><Compass size={13}/></button>
            <button type="button" className="wh-node-action-btn" aria-label="Close Mapping HUD" title="Close Mapping HUD" onClick={()=>{if(native)void getCurrentWindow().close();}}><X size={13}/></button>
            <button
              type="button"
              className="wh-node-action-btn"
              title="Add child wormhole connection"
              onClick={handleAddChildConnection}
              aria-label="Add child connection"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="wh-node-action-btn"
              title="Paste probe scanner signatures from clipboard"
              onClick={handlePasteClipboard}
              aria-label="Paste signatures"
            >
              <ClipboardPaste size={13} />
            </button>
            <button
              type="button"
              className="wh-node-action-btn wh-node-del-btn"
              title="Clear scanned signatures"
              onClick={handleClearSignatures}
              aria-label="Clear signatures"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Latest Bookmark Remote-Control Banner */}
        {latestBookmark && (
          <div className="wh-overlay-bm-banner">
            <div
              className="wh-overlay-bm-left"
              onClick={() => handleCopyText(latestBookmark.text, 're-copy-bm')}
              title={`Latest Bookmark: "${latestBookmark.text}"\nClick to copy to clipboard\nParsed: ${latestBookmark.parsedSummary || latestBookmark.text}`}
            >
              <Bookmark size={13} className="wh-overlay-bm-icon" />
              <span className="wh-overlay-bm-code">{latestBookmark.text}</span>
              <span className="wh-overlay-bm-badge">
                <Check size={11} /> {copiedKey === 're-copy-bm' ? 'Copied' : 'Active'}
              </span>
            </div>
            <button
              type="button"
              className="wh-overlay-reset-btn"
              title="Reset bookmark sequence and clear exploration flow"
              onClick={handleResetFlow}
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          </div>
        )}

        {/* 2. Body: Statics, Scout Name, Sigs Count, Hub Distance, Floating Sigs, Pre-Jump Box */}
        <div className="wh-node-body">
          {/* Statics Row */}
          {statics.length > 0 && (
            <div className="wh-node-statics-row">
              {statics.map((sc) => (
                <span key={sc} className="wh-static-pill">
                  {sc}
                </span>
              ))}
            </div>
          )}

          {/* Combat Effect (if any) */}
          {effect && (
            <div className="wh-node-effect-row wh-card-effect-badge" title={SYSTEM_EFFECTS[effect]?.description || `${effect} Combat Effect`}>
              {effect}
            </div>
          )}

          {/* Active Scanner Pilot Name with Selector */}
          <div
            className="wh-node-scout-row"
            onClick={() => availableCharacters.length > 1 && setIsSelectingPilot(!isSelectingPilot)}
            title={availableCharacters.length > 1 ? 'Click to select scanner pilot' : `Active Scanner: ${activePilotName}`}
            style={{ cursor: availableCharacters.length > 1 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <span>{activePilotName}</span>
            {availableCharacters.length > 1 && (
              <span className="wh-pilot-switch-hint">Switch</span>
            )}
          </div>

          {/* Pilot Selector Dropdown */}
          {isSelectingPilot && (
            <div className="wh-pilot-picker-dropdown">
              {availableCharacters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`wh-pilot-picker-item ${String(c.id) === String(activePilotId) ? 'active' : ''}`}
                  onClick={() => {
                    const idStr = String(c.id);
                    setSelectedPilotId(idStr);
                    try {
                      localStorage.setItem(STORAGE_SCANNER_PILOT_KEY, idStr);
                      channelRef.current?.postMessage({
                        accessGrant: backendGrantKey(backendAccess),
        type: 'set_scanner_pilot',
                        pilotId: idStr,
                        pilotName: c.name || '',
                        source: 'mapping-overlay'
                      });
                      void emitEvent('wok_daytripper_channel', {
                        accessGrant: backendGrantKey(backendAccess),
        type: 'set_scanner_pilot',
                        pilotId: idStr,
                        pilotName: c.name || '',
                        source: 'mapping-overlay'
                      });
                    } catch {}
                    setIsSelectingPilot(false);
                  }}
                >
                  <span className="wh-pilot-name">{c.name || `Pilot #${c.id}`}</span>
                  {c.isMain && <span className="wh-pilot-role-chip main">Main</span>}
                </button>
              ))}
            </div>
          )}

          {/* Sigs Scanned Count */}
          <div className="wh-node-sig-summary">
            {activeSignatures.length > 0 ? `${activeSignatures.length} sigs scanned` : '0 sigs scanned'}
          </div>

          {/* Closest Trade Hub Jump Distance Pill */}
          {closestHub && closestHub.totalJumps > 0 && (
            <div className="wh-node-hub-pill" title={`Closest trade hub: ${closestHub.targetHub.name} (${closestHub.totalJumps} jumps)`}>
              {closestHub.totalJumps}j to {closestHub.targetHub.shortName}
            </div>
          )}

          {/* Floating Wormhole / Cosmic Signatures */}
          {(wormholeSigs.length > 0 || cosmicSigs.length > 0) && (
            <div className="wh-floating-sigs-container">
              <span className="wh-floating-sigs-label">
                {wormholeSigs.length > 0 ? 'WORMHOLE SIGNATURES:' : 'COSMIC SIGNATURES:'}
              </span>
              {wormholeSigs.map((s) => {
                const isTargeted = targetedSigId === s.id;
                const isLinked = (activeMap?.links || []).some((l) => l.sourceSig === s.id || l.targetSig === s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`wh-floating-sig-tag ${isTargeted ? 'targeted' : ''} ${isLinked ? 'linked' : ''}`}
                    onClick={() => handleToggleTarget(s.id)}
                    title={isTargeted ? `Target locked: ${s.id}` : `Target ${s.id}`}
                  >
                    {isTargeted ? <Radio size={12} /> : <Compass size={12} />}
                    <strong>{s.id}</strong>
                    {s.name && s.name !== 'Cosmic Signature' && s.name !== 'Unstable Wormhole' && (
                      <span className="wh-sig-mini-name">{s.name}</span>
                    )}
                  </button>
                );
              })}

              {cosmicSigs.map((s) => {
                const isTargeted = targetedSigId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`wh-floating-sig-tag ${isTargeted ? 'targeted' : ''}`}
                    onClick={() => handleToggleTarget(s.id)}
                    title={`Cosmic signature ${s.id}`}
                  >
                    {isTargeted ? <Radio size={12} /> : <Search size={12} />}
                    <strong>{s.id}</strong>
                    <span className="wh-sig-mini-name">Cosmic</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 3. Pre-Jump Connection Lock Toolbar (Shown when a signature is targeted) */}
          {targetedSigId && (
            <div className="wh-prejump-bar">
              <div className="wh-prejump-title">
                <span>Target: {targetedSigId} Pre-Jump Connection Lock</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className="map-btn map-btn-xs"
                    onClick={handleResetFlow}
                    title="Reset bookmark sequence and clear exploration flow"
                  >
                    Reset Flow
                  </button>
                  <button
                    type="button"
                    className="map-btn map-btn-xs"
                    onClick={() => {
                      setTargetedSigId(null);
                      broadcastTargetSig(null);
                    }}
                    title="Clear targeted signature"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Row 1: Wormhole Code Chips */}
              <div className="wh-prejump-chips">
                {statics.map((sc) => {
                  const spec = WORMHOLE_CODES[sc.toUpperCase()];
                  const isSel = targetWhCode === sc;
                  return (
                    <button
                      key={sc}
                      type="button"
                      className={`wh-prejump-chip ${isSel ? 'active' : ''}`}
                      onClick={() => {
                        setTargetWhCode(sc);
                        setCustomWanderingCode('');
                        setIsStatic(true);
                        const isFrigHole = Boolean(spec?.maxJumpMassTons && spec.maxJumpMassTons <= 5000);
                        if (spec) {
                          setIsFrig(isFrigHole);
                        }
                        updateTargetModifiers({ whCode: sc, isStatic: true, isFrig: isFrigHole });
                      }}
                    >
                      Static {sc}{spec ? ` (${spec.targetSpace})` : ''}
                    </button>
                  );
                })}

                <button
                  type="button"
                  className={`wh-prejump-chip ${targetWhCode === 'K162' ? 'active' : ''}`}
                  onClick={() => {
                    setTargetWhCode('K162');
                    setCustomWanderingCode('');
                    setIsStatic(false);
                    updateTargetModifiers({ whCode: 'K162', isStatic: false, spaceType: 'K162' });
                  }}
                >
                  K162 (Incoming)
                </button>

                <div className="wh-prejump-code-input-wrapper">
                  <input
                    type="text"
                    list="wh-overlay-wandering-codes"
                    className="wh-prejump-code-input"
                    placeholder="Wandering Code (e.g. A982)..."
                    value={customWanderingCode}
                    onChange={(e) => {
                      const val = e.target.value.trim().toUpperCase();
                      setCustomWanderingCode(val);
                      if (val) {
                        setTargetWhCode(val);
                        const isStat = statics.includes(val);
                        setIsStatic(isStat);
                        const spec = WORMHOLE_CODES[val];
                        const isFrigHole = Boolean(spec?.maxJumpMassTons && spec.maxJumpMassTons <= 5000);
                        if (spec) {
                          setIsFrig(isFrigHole);
                        }
                        updateTargetModifiers({ whCode: val, isStatic: isStat, isFrig: isFrigHole });
                      }
                    }}
                  />
                  <datalist id="wh-overlay-wandering-codes">
                    {Object.entries(WORMHOLE_CODES).map(([codeKey, sp]) => {
                      if (codeKey === 'K162') return null;
                      const cap = sp.maxMassTons >= 100000 ? `${Math.round(sp.maxMassTons / 1000)}M kg` : `${sp.maxMassTons}t`;
                      return (
                        <option key={codeKey} value={codeKey}>
                          {codeKey} &rarr; {sp.targetSpace} ({cap})
                        </option>
                      );
                    })}
                  </datalist>
                </div>

                {/* Live Spec Pill */}
                {(() => {
                  const activeCode = customWanderingCode.trim().toUpperCase() || targetWhCode;
                  const activeSpec = WORMHOLE_CODES[activeCode];
                  let specSummary = '';
                  if (activeCode === 'K162') {
                    specSummary = 'K162 Incoming: Mass unknown';
                  } else if (activeSpec) {
                    const capMkg = activeSpec.maxMassTons >= 100_000 ? Math.round(activeSpec.maxMassTons / 1000) : activeSpec.maxMassTons;
                    const jumpMkg = activeSpec.maxJumpMassTons >= 1000 ? Math.round(activeSpec.maxJumpMassTons / 1000) : activeSpec.maxJumpMassTons;
                    specSummary = `${activeSpec.targetSpace} | Cap: ${capMkg.toLocaleString()}M kg | Jump: ${jumpMkg.toLocaleString()}M kg`;
                  }
                  return specSummary ? <span className="wh-prejump-spec-badge">{specSummary}</span> : null;
                })()}
              </div>

              {/* Row 2: Nature & Status Modifiers Chips */}
              <div className="wh-prejump-chips">
                <button
                  type="button"
                  className={`wh-prejump-chip ${isStatic ? 'active' : ''}`}
                  onClick={() => {
                    const next = !isStatic;
                    setIsStatic(next);
                    updateTargetModifiers({ isStatic: next });
                  }}
                  title="Toggle Static (s) vs Wandering (w)"
                >
                  {isStatic ? 'Static (s)' : 'Wandering (w)'}
                </button>
                <button
                  type="button"
                  className={`wh-prejump-chip ${isEol ? 'active' : ''}`}
                  onClick={() => {
                    const next = !isEol;
                    setIsEol(next);
                    updateTargetModifiers({ isEol: next });
                  }}
                  title="Toggle End of Life (<4 hours)"
                >
                  EOL
                </button>
                <button
                  type="button"
                  className={`wh-prejump-chip ${isCrit ? 'active' : ''}`}
                  onClick={() => {
                    const next = !isCrit;
                    setIsCrit(next);
                    updateTargetModifiers({ isCrit: next });
                  }}
                  title="Toggle Mass Critical (<10% mass)"
                >
                  Crit Mass
                </button>
                <button
                  type="button"
                  className={`wh-prejump-chip ${isFrig ? 'active' : ''}`}
                  onClick={() => {
                    const next = !isFrig;
                    setIsFrig(next);
                    updateTargetModifiers({ isFrig: next });
                  }}
                  title="Toggle Frigate / small ship size restriction"
                >
                  Frig Hole
                </button>
              </div>

              {/* Row 3: Live Bookmark Preview & Copy */}
              <div className="wh-prejump-preview">
                <span>{outwardBookmarkString}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className="map-btn map-btn-xs"
                    onClick={() => handleCopyText(outwardBookmarkString, 'bm-copy')}
                    title="Copy outward destination bookmark preview to clipboard"
                  >
                    {copiedKey === 'bm-copy' ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    className="map-btn map-btn-xs"
                    onClick={handleCopyBtBookmark}
                    title="Copy return breadcrumb bookmark (BT) for this wormhole"
                  >
                    {copiedKey === 'copy-bt' ? 'Copied' : 'Copy BT'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
