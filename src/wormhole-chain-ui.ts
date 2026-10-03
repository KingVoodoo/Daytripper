import {getHomeSystem,homeDisplayName,systemDisplayName} from './home-system';
import {BoundedDaytripperStream,validSharedChain,escapeDaytripperText} from './daytripper-transport';
import {readBoundedJson} from './bounded-response';
import { configureScannerCapture } from './clipboard-capture';
import { currentBackendAccess, requireBackendAccess, backendGrantKey } from './backend-access';
import type { WormholeNodeData, WormholeLinkData, DaytripperMapData, SystemTacticalStatus } from './daytripper-map-types';
import { updateScoutLink, createScoutNode, createScoutLink } from './daytripper-scout';
import { wormholeLinkCapacityKg } from './wormhole-mass';
import './styles/daytripper-signatures.css';
import { pruneScoutLinks, isActiveScoutSignature, validateScoutSnapshot } from './daytripper-pruning';
import { getLucideSvg, createLucideElement, createShellModuleIcon } from './ui';
import { showToast } from './ui/notify';
import {
  SYSTEM_EFFECTS,
  WORMHOLE_CODES,
  deriveSpaceTypeFromWhSpec,
  type WormholeCodeSpec,
  parseProbeScannerText,
  signatureGuide,
  getWormholeClass,
  type ScannedSignature,
  formatBookmarkString,
  formatWormholeBookmark,
  generateWormholeBookmark,
  getEffectAbbreviation,
  type WormholeBookmarkParams,
  mergeScannedSignatures,
  cleanStaleSignatures,
  isFrigateHole
} from './wormhole-data';
import { getSystemStatics } from './wormhole-statics';
import { setAutopilotDestination, call, popoutModule, isStandaloneModule, onEvent, emitEvent, native, copyToClipboard } from './bridge';
import { universeGraph, TRADE_HUBS, type HybridRouteResult } from './universe-graph';
import { getStoredSystemNote, saveStoredSystemNote } from './system-notes';
import {
  fetchSystemZkill,
  fetchSystemSovereignty,
  fetchSystemRundown,
  type SystemZkillSummary,
  type SystemSovSummary,
  type SystemRundownInfo,
  type ZkillItem
} from './system-intel-service';

import type { ActiveShip } from './ship-summary';

export interface SelectedScoutSystem {
  targetId: number;
  targetName: string;
  targetClass: string;
  regionName?: string;
  whType?: string;
  maxShip?: string;
  remainingHours?: string | number;
  inSig?: string;
  outSig?: string;
  hubSig?: string;
  targetSig?: string;
  hub: 'Thera' | 'Turnur';
  jumps?: number | null;
  expiresAt?: string;
}

export type { SystemTacticalStatus } from './daytripper-map-types';

export interface WormholeJumpLogEntry {
  id: string;
  timestamp: number;
  characterName: string;
  shipName?: string;
  shipTypeName?: string;
  shipTypeId?: number;
  fromSystemId: number;
  toSystemId: number;
  fromSystemName: string;
  toSystemName: string;
  direction: 'out' | 'in';
  massKg: number;
  propState?: 'cold' | 'hot' | 'higgs' | 'custom';
  notes?: string;
}

export interface WormholeNode extends WormholeNodeData {
  parentId?: number;
}

export interface WormholeLink extends WormholeLinkData {
  scoutHub?: number;
  lifetimeStatus: 'stable' | 'eol';
  jumpLog?: WormholeJumpLogEntry[];
  isStargate?: boolean;
  notes?: string;
  shipSize?: string;
  customType?: string;
  remainingHours?: number;
  expiresAt?: number;
}

export function getLinkWhSpec(link: WormholeLink): WormholeCodeSpec | null {
  if (link.returnWhCode && link.returnWhCode.toUpperCase() !== 'K162') {
    const spec = WORMHOLE_CODES[link.returnWhCode.toUpperCase()];
    if (spec) return spec;
  }
  if (link.whCode && link.whCode.toUpperCase() !== 'K162') {
    const spec = WORMHOLE_CODES[link.whCode.toUpperCase()];
    if (spec) return spec;
  }
  if (link.whCode && link.whCode.toUpperCase() === 'K162') {
    return WORMHOLE_CODES['K162'] || null;
  }
  return null;
}


export interface ResolvedShipMass {
  massKg: number;
  isBattleship: boolean;
  isHiggs: boolean;
  hullCategory: string;
  propState: 'cold' | 'hot' | 'higgs' | 'custom';
}

export function resolveShipMassKg(typeName?: string | null, shipName?: string | null, _shipTypeId?: number): ResolvedShipMass {
  const t = (typeName || '').toLowerCase().trim();
  const n = (shipName || '').toLowerCase().trim();

  // Check name indicators for rolling state
  const isHiggs = n.includes('higgs') || n.includes('heavy roll') || n.includes('heavy-roll');
  const isHot = n.includes('hot') || n.includes('500mn') || n.includes('mwd') || n.includes('100mn');

  // 1. Pod / Capsule / Shuttle
  if (t === 'capsule' || t === 'capsule - genolution' || t.includes('pod') || t.includes('shuttle')) {
    return { massKg: 10_000, isBattleship: false, isHiggs: false, hullCategory: 'Capsule', propState: 'cold' };
  }

  // 2. Heavy Interdictors (HIC with zero-mass bubble)
  const isHic = ['devoter', 'phobos', 'broadsword', 'onyx'].includes(t);
  if (isHic) {
    if (n.includes('bubble') || n.includes('zero') || n.includes('500k')) {
      return { massKg: 500_000, isBattleship: false, isHiggs: false, hullCategory: 'Heavy Interdictor (Bubble)', propState: 'custom' };
    }
    return { massKg: 15_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Heavy Interdictor', propState: 'cold' };
  }

  // 3. Frigates / Covert Ops / Stealth Bombers / Interceptors
  const frigateHulls = [
    'heron', 'buzzard', 'anathema', 'cheetah', 'astero', 'pacifier', 'hound', 'manticore',
    'nemesis', 'purifier', 'ares', 'crow', 'claw', 'crusader', 'stiletto', 'raptor',
    'taranis', 'malediction', 'rifter', 'merlin', 'tristan', 'tormentor', 'kestrel',
    'incursus', 'punisher', 'breacher', 'slasher', 'atron', 'condor', 'executioner',
    'dramiel', 'daredevil', 'worm', 'cruor', 'succubus', 'nergal', 'garmur'
  ];
  if (frigateHulls.some(h => t.includes(h)) || t.includes('frigate') || t.includes('interceptor')) {
    return { massKg: 1_200_000, isBattleship: false, isHiggs: false, hullCategory: 'Frigate', propState: 'cold' };
  }

  // 4. Destroyers / Tactical Destroyers / Interdictors
  const destroyerHulls = [
    'sabre', 'flycatcher', 'eris', 'heretic', 'hecate', 'jackdaw', 'confessor', 'svipul',
    'cormorant', 'catalyst', 'thrasher', 'coercer', 'kikimora', 'magus', 'bifrost',
    'pontifex', 'stork', 'algos', 'dragoon', 'corax', 'talwar', 'sunesis'
  ];
  if (destroyerHulls.some(h => t.includes(h)) || t.includes('destroyer') || t.includes('interdictor')) {
    return { massKg: 2_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Destroyer', propState: 'cold' };
  }

  // 5. Capitals / Dreads / Carriers / FAX
  const capitalHulls = [
    'archon', 'chimera', 'thanatos', 'nidhoggur', 'revelation', 'phoenix', 'moros',
    'naglfar', 'apostle', 'minokawa', 'ninazu', 'lif', 'rorqual', 'bane', 'karura', 'hubris', 'valravn'
  ];
  if (capitalHulls.some(h => t.includes(h)) || t.includes('dreadnought') || t.includes('carrier') || t.includes('force auxiliary')) {
    return { massKg: 1_200_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Capital', propState: 'cold' };
  }
  if (t === 'orca') {
    return { massKg: isHiggs ? 500_000_000 : 250_000_000, isBattleship: false, isHiggs, hullCategory: 'Industrial Capital', propState: isHiggs ? 'higgs' : 'cold' };
  }
  if (['charon', 'obelisk', 'fenrir', 'providence', 'rhea', 'anshar', 'nomad', 'ark', 'bowhead'].some(h => t.includes(h)) || t.includes('freighter')) {
    return { massKg: 900_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Freighter', propState: 'cold' };
  }

  // 6. Battleships / Black Ops / Marauders
  const battleshipHulls = [
    'megathron', 'tempest', 'typhoon', 'dominix', 'apocalypse', 'armageddon', 'raven',
    'rokh', 'scorpion', 'bhaalgorn', 'machariel', 'nightmare', 'rattlesnake', 'praxis',
    'leshak', 'nestor', 'kronos', 'paladin', 'vargur', 'golem', 'panther', 'redeemer',
    'sin', 'widow', 'hyperion', 'maelstrom', 'abaddon', 'barghest', 'marshal'
  ];
  const isBs = battleshipHulls.some(h => t.includes(h)) || t.includes('battleship') || t.includes('black ops') || t.includes('marauder');
  if (isBs) {
    if (isHiggs) {
      const mass = isHot ? 300_000_000 : 200_000_000;
      return { massKg: mass, isBattleship: true, isHiggs: true, hullCategory: 'Battleship', propState: isHot ? 'hot' : 'higgs' };
    }
    if (isHot) {
      return { massKg: 148_000_000, isBattleship: true, isHiggs: false, hullCategory: 'Battleship', propState: 'hot' };
    }
    return { massKg: 100_000_000, isBattleship: true, isHiggs: false, hullCategory: 'Battleship', propState: 'cold' };
  }

  // 7. Industrial / Blockade Runner / DST
  const industrialHulls = [
    'epithal', 'tayra', 'mammoth', 'badger', 'bestower', 'sigil', 'iteron', 'kryos',
    'miasmos', 'primaae', 'noctis', 'bustard', 'mastodon', 'impel', 'occator', 'crane',
    'prorator', 'prowler', 'viator', 'procurer', 'retriever', 'covetor', 'skiff', 'mackinaw', 'hulk', 'porpoise'
  ];
  if (industrialHulls.some(h => t.includes(h)) || t.includes('transport') || t.includes('industrial') || t.includes('barge')) {
    return { massKg: 16_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Industrial', propState: 'cold' };
  }

  // 8. Battlecruisers
  const bcHulls = [
    'drake', 'hurricane', 'brutix', 'myrmidon', 'harbinger', 'cyclone', 'ferox',
    'prophecy', 'naga', 'talos', 'tornado', 'oracle', 'drekavac', 'eos', 'astarte',
    'damnation', 'claymore', 'sleipnir', 'nighthawk', 'vulture', 'absolution', 'gnosis'
  ];
  if (bcHulls.some(h => t.includes(h)) || t.includes('battlecruiser') || t.includes('command ship')) {
    return { massKg: 15_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Battlecruiser', propState: 'cold' };
  }

  // 9. Cruisers / Strategic Cruisers (T3C) / HAC / Recons / Logi
  const cruiserHulls = [
    'tengu', 'loki', 'legion', 'proteus', 'cerberus', 'deimos', 'eagle', 'zealot',
    'ishtar', 'muninn', 'vagabond', 'sacrilege', 'falcon', 'rapier', 'pilgrim', 'arazu',
    'rook', 'huginn', 'curse', 'lachesis', 'ikitursa', 'zarmazd', 'rodiva', 'stratios',
    'gila', 'ashimmu', 'phantasm', 'cynabal', 'orthrus', 'thorax', 'rupture', 'caracal',
    'vexor', 'omen', 'moa', 'maller', 'stabber', 'scythe', 'osprey', 'augoror', 'exequror',
    'basilisk', 'scimitar', 'guardian', 'oneiros', 'enforcer', 'bellicose', 'blackbird', 'arbitrator', 'celestis'
  ];
  if (cruiserHulls.some(h => t.includes(h)) || t.includes('cruiser')) {
    return { massKg: 13_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Cruiser', propState: 'cold' };
  }

  return { massKg: 13_000_000, isBattleship: false, isHiggs: false, hullCategory: 'Medium Ship', propState: 'cold' };
}

export function formatMassKg(kg: number): string {
  if (!kg || kg <= 0) return '0 kg';
  if (kg >= 1_000_000_000) return `${(kg / 1_000_000_000).toFixed(2)}B kg`;
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)}M kg`;
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(0)}k kg`;
  return `${kg} kg`;
}

export interface DaytripperMapPage extends DaytripperMapData<WormholeNode, WormholeLink> {
  pan: { x: number; y: number };
  zoom: number;
  viewMode: 'canvas' | 'tree' | 'scout';
  resetPending?: boolean;
  resetVersion?: number;
}

const STORAGE_MAPS_KEY = 'wok_daytripper_maps_v2';
const STORAGE_KEY = 'wok_daytripper_chain_v1';
const STORAGE_PILOTS_KEY = 'wok_daytripper_pilots_v1';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function formatRelativeAge(timestamp?: number): string {
  if (!timestamp) return 'Just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export class DaytripperMapperUI {
  private container: HTMLElement;
  private maps: DaytripperMapPage[] = [];
  private pendingK162Link: WormholeLink | null = null;
  private pendingK162: { requestId: string; mapId: string; linkId: string; fromId: number; fromName: string; toId: number; toName: string; sourceSigId: string } | null = null;
  private activeMapId: string = 'primary';
  private nodes: Map<number, WormholeNode> = new Map();
  private links: WormholeLink[] = [];
  private signatures: Map<number, ScannedSignature[]> = new Map();
  private selectedSystemId: number | null = null;
  private selectedScoutSystem: SelectedScoutSystem | null = null;
  private activeCharacters: Array<{ id: string; name: string; systemId: number; systemName?: string; locationUpdatedAt?: number | null; isScanner?: boolean; isNav?: boolean; isOnline?: boolean; roles?: string[]; ship?: ActiveShip | null }> = [];
  private selectedScannerId: string | null = null;
  private pilotTrackerStrip: HTMLElement | null = null;
  private onBackToMap?: () => void;
  private onRefreshPilots?: () => void | Promise<boolean | void>;
  private viewMode: 'canvas' | 'tree' | 'scout' = 'canvas';
  private pan = { x: 50, y: 50 };
  private zoom = 1.0;
  private autoMappingEnabled: boolean = true;
  private exemptPilots: Set<string> = new Set();
  private scoutSnapshotValid = false;
  private scoutRefreshRunning = false;
  private scoutFetchPromise: Promise<any[]> | null = null;
  private cachedScoutSignatures: any[] | null = null;
  private lastScoutFetchTime: number = 0;
  private isScoutFetching: boolean = false;
  private scoutSearchQuery: string = '';
  private sigFilter: string = 'all';
  private broadcastChannel: BroadcastChannel | null = null;
  private cloudSyncStatus: 'synced' | 'syncing' | 'local' | 'error' = 'local';
  private cachedBaseUrl: string | null = null;
  private backendStopped = false;
  private backendGrant = backendGrantKey();
  private accessRevision = 0;
  private sseClient: BoundedDaytripperStream | null = null;
  private sseReconnectTimeout: any = null;
  private clientId: string = 'client-' + Math.random().toString(36).slice(2) + '-' + Date.now();
  private syncDebounceTimer: any = null;
  private pendingRemoteUpdate: boolean = false;
  private resettingPrimary = false;
  private mapResetRevisions = new Map<string, number>();
  private closestCardCollapsed: boolean = true;
  private legendCollapsed: boolean = true;

  // Daytripper Bookmark & Pre-Jump Target State
  private targetedSignature: {
    systemId: number;
    sigId: string;
    spaceType: string;
    isStatic: boolean;
    isEol: boolean;
    isCrit: boolean;
    isFrig: boolean;
    whCode?: string;
  } | null = null;

  private activeExploration: {
    characterName?: string;
    mapId?: string;
    linkId?: string;
    originSystemId: number;
    originSystemName: string;
    discoveredSystemId: number;
    discoveredSystemName: string;
    sigId: string;
    spaceType: string;
    isStatic: boolean;
    isEol: boolean;
    isCrit: boolean;
    isFrig: boolean;
    whCode?: string;
  } | null = null;

  private latestBookmark: {
    accessGrant?: string | null;
    text: string;
    timestamp: number;
    type: 'forward' | 'breadcrumb';
    fromSystem: string;
    toSystem: string;
    sigId: string;
    parsedSummary?: string;
  } | null = null;

  private hasBackendGrant() {
    if (this.backendStopped) return false;
    if (this.backendGrant && this.backendGrant === backendGrantKey()) return true;
    this.stopBackendAccess();
    return false;
  }

  private clearPrivateStorage(expected = this.backendGrant) {}

  public stopBackendAccess() {
    this.clearPrivateStorage();
    this.backendStopped = true;
    configureScannerCapture(false);
    this.accessRevision++;
    this.sseClient?.close();
    this.sseClient = null;
    if (this.sseReconnectTimeout) clearTimeout(this.sseReconnectTimeout);
    if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
    this.pendingCloudSyncMapIds.clear();
    this.broadcastChannel?.close();
    this.nodes.clear(); this.links = []; this.signatures.clear(); this.maps = [];
  }

  private scheduleCloudSync(delayMs = 3500) {this.cloudSyncStatus="local"; this.updateCloudSyncBadge();}

  private async getAuthToken(): Promise<string | null> {return null;}

  private async getBaseApiUrl(): Promise<string> {throw new Error("Daytripper uses local storage.");}

  private canApplyRemoteChain(mapId: string, version: unknown, revision = this.mapResetRevisions.get(mapId) || 0): boolean {
    const page = this.maps.find(m => m.id === mapId);
    if (!page || page.resetPending || (mapId === 'primary' && this.resettingPrimary)) return false;
    if (revision !== (this.mapResetRevisions.get(mapId) || 0)) return false;
    return !page.resetVersion || (Number.isSafeInteger(Number(version)) && Number(version) > page.resetVersion);
  }

  private async fetchFromCloud(mapId: string, applyToUi = true): Promise<boolean> {return false;}

  constructor(parent: HTMLElement, onBack?: () => void, onRefreshPilots?: () => void | Promise<boolean | void>) {
    this.container = make('div', '', 'daytripper-container');
    this.onBackToMap = onBack;
    this.onRefreshPilots = onRefreshPilots;
    parent.append(this.container);
    this.container.addEventListener('keydown', event => {
      if (event.key !== 'Delete' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"], dialog, .wh-modal-overlay')) return;
      const card = target.closest<HTMLElement>('[data-map-system-id]');
      if (!card) return;
      event.preventDefault(); event.stopPropagation();
      void this.requestRemoveNode(Number(card.dataset.mapSystemId));
    });
    this.loadFromStorage();
    window.addEventListener('daytripper-home-changed',()=>{
      const home=getHomeSystem();if(!home)return;
      const id='home-'+home.id;
      const existing=this.maps.find(m=>m.id===id);
      if(existing)existing.name='Home: '+homeDisplayName(home);
      else this.maps.push(this.createDefaultPage(id,'Home: '+homeDisplayName(home)));
      this.switchMap(id);
    });
    try {
      this.selectedScannerId = localStorage.getItem('wok_daytripper_scanner_pilot') || null;
    } catch {}
    universeGraph.init().then(() => {
      this.renderChainContentOnly();
    });
    const refreshHubs = async () => {
      if (this.backendStopped || this.scoutRefreshRunning || !this.container.isConnected) return;
      this.scoutRefreshRunning = true;
      try { await this.syncHubLiveSignatures('Thera'); await this.syncHubLiveSignatures('Turnur'); }
      finally { this.scoutRefreshRunning = false; }
    };
    void refreshHubs();
    const scoutTimer = window.setInterval(() => {
      if (this.backendStopped || !this.container.isConnected) { window.clearInterval(scoutTimer); return; }
      void refreshHubs();
    }, 60000);
    window.addEventListener('wok-system-notes-updated', () => {
      this.renderChainContentOnly();
    });
    window.addEventListener('wok-font-size-changed', () => {
      if (this.container && this.container.isConnected) {
        this.render();
      }
    });

    // Native capture accepts only fresh revisions in the trusted focus session.
    if (native) {
      configureScannerCapture(localStorage.getItem('wok.daytripperAutoscan') !== '0', this.container);
      void onEvent<{ text: string }>('eve-clipboard-scanner', (payload) => {
        if (!this.backendStopped && this.container.isConnected && payload?.text) this.handleScannerAutoscan(payload.text);
      }).catch(() => {});
    }

    const onFocusCheckClip = () => {
      if (this.container && this.container.isConnected) {
        void this.checkScannerClipboardAutoscan();
      }
    };
    window.addEventListener('focus', onFocusCheckClip);

    this.container.addEventListener('pointerup', () => {
      if (this.pendingRemoteUpdate) {
        const hasActiveModal = Boolean(document.querySelector('.wh-modal, .wh-modal-overlay, .map-system-context-menu, .map-conn-context-menu, .wh-site-guides-drawer'));
        const isEditingInput = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
        if (!hasActiveModal && !isEditingInput) {
          this.pendingRemoteUpdate = false;
          this.renderChainContentOnly();
        }
      }
    });

    const handleDaytripperEvent = (data: any) => {
      if (!this.hasBackendGrant() || (data?.type !== 'set_scanner_pilot' && data?.accessGrant !== this.backendGrant)) return;
      if (data?.type === 'chain_update' && data?.source !== 'self') {
        this.loadFromStorage();
        this.render();
      } else if (data?.type === 'target_sig') {
        const target = data.target ?? data.payload ?? null;
        if (target && (!Number.isSafeInteger(target.systemId) || typeof target.sigId !== 'string')) return;
        this.targetedSignature = target;
        if (target) this.selectedSystemId = target.systemId;
        this.renderChainContentOnly();
      } else if (data?.type === 'latest_bookmark') {
        this.latestBookmark = data.bookmark ?? data.payload ?? null;
        this.updateHeaderBookmarkButton();
      } else if (data?.type === 'reset_bookmark_flow') {
        this.targetedSignature = null;
        this.activeExploration = null;
        this.renderChainContentOnly();
      } else if (data?.type === 'overlay_ready') {
        if (this.pendingK162?.mapId === this.activeMapId) this.sendOverlayEvent({ type: 'k162_catch', request: this.pendingK162 });
      } else if (data?.type === 'select_system') {
        if (Number.isSafeInteger(data.systemId) && this.nodes.has(data.systemId)) {
          this.selectedSystemId = data.systemId;
          this.renderChainContentOnly();
        }
      } else if (data?.type === 'k162_assign') {
        const request = this.pendingK162;
        if (!request || data.request?.requestId !== request.requestId) return;
        const link = this.links.find(l => l.id === request.linkId);
        const code = typeof data.code === 'string' ? data.code.toUpperCase() : '';
        const sig = typeof data.sigId === 'string' ? data.sigId.trim().toUpperCase() : '';
        if (request.mapId !== this.activeMapId || !link || link !== this.pendingK162Link || !WORMHOLE_CODES[code] || code === 'K162' || !/^[A-Z]{3}-[0-9]{3}$/.test(sig)) {
          this.sendOverlayEvent({ type: 'k162_result', error: 'Connection changed or invalid code/signature. Reopen the connection.' });
          return;
        }
        if (link.sourceId !== request.toId && link.targetId !== request.toId) return;
        const signatures = this.signatures.get(request.toId) || [];
        const signature = signatures.find(s => s.id.toUpperCase() === sig);
        if (signature?.linkedLinkId && signature.linkedLinkId !== link.id) {
          this.sendOverlayEvent({ type: 'k162_result', error: 'That signature is already assigned to another connection.' });
          return;
        }
        link.returnWhCode = code;
        if (link.targetId === request.toId) link.targetSig = sig; else link.sourceSig = sig;
        if (signature) signature.linkedLinkId = link.id;
        else {
          signatures.push({ id: sig, group: 'Wormhole', name: code, signalPct: 100, scannedAt: Date.now(), linkedLinkId: link.id });
          this.signatures.set(request.toId, signatures);
        }
        this.recalculateLinkMass(link);
        this.saveToStorage();
        this.pendingK162 = null;
        document.querySelector('.wh-k162-catch-modal')?.remove();
        this.render();
        this.sendOverlayEvent({ type: 'k162_result' });
      } else if (data?.type === 'set_scanner_pilot') {
        if (data.pilotId && String(data.pilotId) !== this.selectedScannerId) {
          this.setScannerPilot(String(data.pilotId), data.pilotName, false);
        }
      }
    };

    try {
      this.broadcastChannel = new BroadcastChannel('wok_daytripper_channel');
      this.broadcastChannel.onmessage = (ev) => {
        handleDaytripperEvent(ev.data);
      };
    } catch {
      // ignore
    }

    void onEvent('wok_daytripper_channel', (payload: any) => {
      handleDaytripperEvent(payload);
    });

    window.addEventListener('storage', (e) => {
      if (this.backendStopped || !this.container.isConnected) return;
      if (e.key === 'wok_daytripper_scanner_pilot' && e.newValue && e.newValue !== this.selectedScannerId) {
        this.setScannerPilot(e.newValue, undefined, false);
      }
    });

    this.render();
    void (async () => {
      // First attempt to load corporate cloud chain for active map
      const fetched = await this.fetchFromCloud(this.activeMapId, true);
      if (fetched) {
        this.cloudSyncStatus = 'synced';
        this.updateCloudSyncBadge();
      } else if (this.hasBackendGrant() && this.maps.some(map => map.resetPending)) {
        await this.syncToCloud(false);
      }
      this.initCloudStream();
    })();
  }

  private scheduleSseReconnect(delayMs = 8000) {}

  private isConnectingStream = false;

  private initCloudStream() {}

  private notifyDaytripperChange() {
    try {
      if (!this.broadcastChannel) {
        this.broadcastChannel = new BroadcastChannel('wok_daytripper_channel');
      }
      this.broadcastChannel.postMessage({
        accessGrant: this.backendGrant,
        type: 'chain_update',
        mapId: this.activeMapId,
        source: 'self',
        timestamp: Date.now()
      });
      if (native) {
        void emitEvent('wok_daytripper_channel', {
          accessGrant: this.backendGrant,
        type: 'chain_update',
          mapId: this.activeMapId,
          source: 'self',
          timestamp: Date.now()
        });
      }
    } catch {
      // ignore
    }
  }

  public notifyTargetedSigChange() {
    try {
      if (this.targetedSignature) {
        localStorage.setItem('wok.daytripperTargetedSig', JSON.stringify(this.targetedSignature));
      } else {
        localStorage.removeItem('wok.daytripperTargetedSig');
      }
      if (!this.broadcastChannel) {
        this.broadcastChannel = new BroadcastChannel('wok_daytripper_channel');
      }
      this.broadcastChannel.postMessage({
        accessGrant: this.backendGrant,
        type: 'target_sig',
        target: this.targetedSignature,
        timestamp: Date.now()
      });
      if (native) {
        void emitEvent('wok_daytripper_channel', {
          accessGrant: this.backendGrant,
        type: 'target_sig',
          target: this.targetedSignature,
          timestamp: Date.now()
        });
      }
    } catch {}
  }

  public notifyLatestBookmarkChange() {
    if (!this.hasBackendGrant()) return;
    try {
      if (this.latestBookmark) {
        localStorage.setItem('wok.daytripperLatestBookmark', JSON.stringify(this.latestBookmark));
      } else {
        localStorage.removeItem('wok.daytripperLatestBookmark');
      }
      if (!this.broadcastChannel) {
        this.broadcastChannel = new BroadcastChannel('wok_daytripper_channel');
      }
      this.broadcastChannel.postMessage({
        accessGrant: this.backendGrant,
        type: 'latest_bookmark',
        bookmark: this.latestBookmark,
        timestamp: Date.now()
      });
      if (native) {
        void emitEvent('wok_daytripper_channel', {
          accessGrant: this.backendGrant,
        type: 'latest_bookmark',
          bookmark: this.latestBookmark,
          timestamp: Date.now()
        });
      }
    } catch {}
    this.updateHeaderBookmarkButton();
  }

  public notifyBookmarkFlowReset() {
    if (!this.hasBackendGrant()) return;
    try {
      if (!this.broadcastChannel) {
        this.broadcastChannel = new BroadcastChannel('wok_daytripper_channel');
      }
      this.broadcastChannel.postMessage({
        accessGrant: this.backendGrant,
        type: 'reset_bookmark_flow',
        timestamp: Date.now()
      });
      if (native) {
        void emitEvent('wok_daytripper_channel', {
          accessGrant: this.backendGrant,
        type: 'reset_bookmark_flow',
          timestamp: Date.now()
        });
      }
    } catch {}
  }

  public resetBookmarkFlow(showToast = true) {
    this.targetedSignature = null;
    this.activeExploration = null;
    try {
      localStorage.removeItem('wok.daytripperTargetedSig');
      localStorage.removeItem('wok.daytripperActiveExploration');
    } catch {}
    this.notifyBookmarkFlowReset();
    this.renderChainContentOnly();
    if (showToast) {
      this.showWaypointToast('Bookmark sequence reset. Ready for next jump.');
    }
  }

  public updateHeaderBookmarkButton() {
    const existingBm = this.container.querySelector('.daytripper-header-bm-btn') as HTMLElement | null;
    const existingReset = this.container.querySelector('.daytripper-header-reset-btn') as HTMLElement | null;
    const btnGroup = this.container.querySelector('.wh-header-btns') as HTMLElement | null;
    if (existingBm) existingBm.remove();
    if (existingReset) existingReset.remove();
    if (btnGroup) {
      if (this.latestBookmark) {
        const bmBtn = make('button', '', 'btn btn-sm btn-success daytripper-header-bm-btn') as HTMLButtonElement;
        bmBtn.type = 'button';
        const bmIcon = getLucideSvg('bookmark', { size: 14 });
        const checkIcon = getLucideSvg('check', { size: 12 });
        bmBtn.innerHTML = `${bmIcon} <span class="bm-code">${escapeDaytripperText(this.latestBookmark.text)}</span> <span class="bm-copied-tag">${checkIcon} Copied</span>`;
        bmBtn.title = `Latest Bookmark: "${this.latestBookmark.text}"\nClick to re-copy to clipboard.\nOutput of Parser: ${this.latestBookmark.parsedSummary || this.latestBookmark.text}`;
        bmBtn.onclick = () => {
          void copyToClipboard(this.latestBookmark!.text);
          this.showWaypointToast(`Re-copied bookmark: "${this.latestBookmark!.text}"`);
        };
        btnGroup.prepend(bmBtn);
      }
      const resetBtn = make('button', '', 'btn btn-sm btn-subtle daytripper-header-reset-btn') as HTMLButtonElement;
      resetBtn.type = 'button';
      const rotateIcon = getLucideSvg('rotate-ccw', { size: 13 });
      resetBtn.innerHTML = `${rotateIcon} <span>Reset Flow</span>`;
      resetBtn.title = 'Reset bookmark sequence and clear targeted exploration flow';
      resetBtn.onclick = () => {
        this.resetBookmarkFlow(true);
      };
      if (this.latestBookmark) {
        btnGroup.insertBefore(resetBtn, btnGroup.children[1] || null);
      } else {
        btnGroup.prepend(resetBtn);
      }
    }
  }

  private isCloudSyncing = false;
  private pendingCloudSyncMapIds = new Set<string>();

  private async syncToCloud(showFeedback = false, mapId = this.activeMapId) {for(const page of this.maps) page.resetPending=false; this.saveToStorage(false); this.cloudSyncStatus="local"; this.updateCloudSyncBadge();}

  private updateCloudSyncBadge() {const badge=this.container.querySelector(".wh-cloud-sync-badge"); if(badge){badge.textContent="Saved on this PC"; badge.setAttribute("title","Maps are stored locally in Daytripper.");}}

  private loadFromStorage() {
 try {
  localStorage.setItem('wok_daytripper_access',this.backendGrant!);
  const saved=JSON.parse(localStorage.getItem(STORAGE_MAPS_KEY)||'null');
  this.maps=Array.isArray(saved?.maps)?saved.maps.filter((m:any)=>m && typeof m.id==='string' && validSharedChain(m)):[];
  const legacy=this.maps.filter(m=>m.id==='fdmlj-base'||m.id.startsWith('fdmlj-'));
  if(legacy.length)localStorage.setItem('daytripper_retired_preset_backup',JSON.stringify(legacy));
  this.maps=this.maps.filter(m=>!legacy.includes(m));
  if(!this.maps.some(m=>m.id==='primary'))this.maps.unshift(this.createDefaultPage('primary','Primary Chain'));
  for(const hub of ['Thera','Turnur'] as const)if(!this.maps.some(m=>m.id===hub.toLowerCase()+'-base'))this.maps.push(this.createHubBasePage(hub));
  this.activeMapId=this.maps.some(m=>m.id===saved?.activeMapId)?saved.activeMapId:'primary';
  const prefs=JSON.parse(localStorage.getItem(STORAGE_PILOTS_KEY)||'{}');
  this.autoMappingEnabled=prefs.autoMappingEnabled!==false;this.exemptPilots=new Set(Array.isArray(prefs.exemptPilots)?prefs.exemptPilots:[]);
  this.activeExploration=JSON.parse(localStorage.getItem('wok.daytripperActiveExploration')||'null');
  this.latestBookmark=JSON.parse(localStorage.getItem('wok.daytripperLatestBookmark')||'null');
  this.targetedSignature=JSON.parse(localStorage.getItem('wok.daytripperTargetedSig')||'null');
 }catch(error){console.error('Unable to restore map',error);if(!this.maps.length)this.maps=[this.createDefaultPage('primary','Primary Chain')];}
 this.switchMap(this.activeMapId,false,false);
}

  public hasConnection(fromId: number, toId: number): boolean {
    return this.links.some(l => (l.sourceId === fromId && l.targetId === toId) || (l.sourceId === toId && l.targetId === fromId));
  }

  public hasPendingExploration(fromId: number, toId: number): boolean {
    if (this.targetedSignature && this.targetedSignature.systemId === fromId) return true;
    if (this.activeExploration) {
      const exp = this.activeExploration;
      return (exp.originSystemId === fromId && exp.discoveredSystemId === toId) ||
             (exp.originSystemId === toId && exp.discoveredSystemId === fromId);
    }
    return false;
  }

  private saveCurrentMapToState() {
    if (this.activeMapId.startsWith('scout-') || this.activeMapId === 'mapping-guide') return;

    const cur = this.maps.find(m => m.id === this.activeMapId);
    if (cur) {
      cur.nodes = [...this.nodes.values()];
      cur.links = this.links;
      cur.signatures = [...this.signatures.entries()].map(([systemId, sigs]) => ({ systemId, sigs }));
      cur.pan = {
        x: isFinite(this.pan.x) ? this.pan.x : (cur.isBaseMap ? 40 : 50),
        y: isFinite(this.pan.y) ? this.pan.y : (cur.isBaseMap ? 30 : 50)
      };
      cur.zoom = isFinite(this.zoom) && this.zoom > 0.1 ? this.zoom : (cur.isBaseMap ? 0.85 : 1.0);
      cur.viewMode = this.viewMode;
      cur.selectedSystemId = this.selectedSystemId;
    }
  }

  private saveToStorage(scheduleSync = true) {
    if (!this.hasBackendGrant()) return;
    this.saveCurrentMapToState();
    try {
      localStorage.setItem(STORAGE_MAPS_KEY, JSON.stringify({
        accessGrant: this.backendGrant,
        maps: this.maps,
        activeMapId: this.activeMapId.startsWith('scout-') || this.activeMapId === 'mapping-guide' ? (this.maps[0]?.id || 'primary') : this.activeMapId
      }));
    } catch {
      // ignore storage quota errors
    }
    this.notifyDaytripperChange();
    if (scheduleSync) this.scheduleCloudSync(3500);
  }

  private savePilotSettings() {
    try {
      localStorage.setItem(STORAGE_PILOTS_KEY, JSON.stringify({
        autoMappingEnabled: this.autoMappingEnabled,
        exemptPilots: [...this.exemptPilots]
      }));
    } catch {
      // ignore
    }
  }

  private createDefaultPage(id: string, name: string): DaytripperMapPage {
 const home=getHomeSystem();const info=home?universeGraph.getSystemInfo(home.id):null;
 return {id,name,nodes:info?[{systemId:info.id,systemName:info.name,whClass:getWormholeClass(info.id,info.security),security:info.security,depth:0,x:100,y:100}]:[],links:[],signatures:[],pan:{x:50,y:50},zoom:1,viewMode:'canvas',selectedSystemId:info?.id??null};
}

  public switchMap(mapId: string, shouldRender = true, saveCurrent = true) {
    if (saveCurrent && this.nodes.size > 0 && this.activeMapId !== 'mapping-guide') {
      this.saveCurrentMapToState();
    }
    if (mapId === 'mapping-guide') {
      this.activeMapId = 'mapping-guide';
      if (shouldRender) this.render();
      return;
    }
    const target = this.maps.find(m => m.id === mapId) || this.maps[0];
    if (!target) return;

    this.activeMapId = target.id;
    this.nodes.clear();

    if (target.id === 'thera-base' || target.name.includes('Thera Base')) {
      void this.syncHubLiveSignatures('Thera', false);
    } else if (target.id === 'turnur-base' || target.name.includes('Turnur Base')) {
      void this.syncHubLiveSignatures('Turnur', false);
    }

    for (const n of target.nodes) {
      if (!isFinite(n.x as number) || !isFinite(n.y as number)) {
{
          n.x = 80 + (n.depth || 0) * 290;
          n.y = 80;
        }
      }
      this.nodes.set(n.systemId, n);
    }
    this.links = [...(target.links || [])];
    this.signatures.clear();
    for (const s of (target.signatures || [])) this.signatures.set(s.systemId, s.sigs);
    this.pan = {
      x: isFinite(target.pan?.x) ? target.pan.x : (target.isBaseMap ? 40 : 50),
      y: isFinite(target.pan?.y) ? target.pan.y : (target.isBaseMap ? 30 : 50)
    };
    this.zoom = isFinite(target.zoom) && target.zoom > 0.1 ? target.zoom : (target.isBaseMap ? 0.85 : 1.0);
    this.viewMode = target.viewMode || 'canvas';
    this.selectedSystemId = target.selectedSystemId ?? this.nodes.keys().next().value ?? null;

    if (shouldRender) {
      this.saveToStorage();
      this.render();
    }
  }

  public addNewMapPage(name = 'New Chain') {
    const id = `map-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const page = this.createDefaultPage(id, name);
    this.maps.push(page);
    this.switchMap(id);
  }

  public deleteMapPage(mapId: string) {
    if (this.maps.length <= 1) return;
    this.maps = this.maps.filter(m => m.id !== mapId);
    if (this.activeMapId === mapId) {
      this.switchMap(this.maps[0].id);
    } else {
      this.saveToStorage();
      this.render();
    }
  }

  public createHubBasePage(hub: 'Thera' | 'Turnur', id?: string): DaytripperMapPage {
    const isThera = hub === 'Thera';
    const hubId = isThera ? 31000005 : 30002086;
    const hubName = isThera ? 'Thera' : 'Turnur';
    const pageId = id || (isThera ? 'thera-base' : 'turnur-base');

    const centerNode: WormholeNode = {
      systemId: hubId,
      systemName: hubName,
      whClass: isThera ? 'Thera' : 'Lowsec',
      security: isThera ? -0.99 : 0.25,
      depth: 0,
      x: 580,
      y: 460,
      customNotes: isThera ? 'W-Space Hub (Uncharted)' : 'Metropolis Hub (Turnur I Transmutation)'
    };

    const nodes: WormholeNode[] = [centerNode];
    const links: WormholeLink[] = [];

    // Filter any already cached signatures
    const hubLower = hub.toLowerCase();
    const sigs = (this.cachedScoutSignatures || []).filter(s =>
      (s.out_system_name || '').toLowerCase() === hubLower ||
      (s.in_system_name || '').toLowerCase() === hubLower
    );

    const cx = 700;
    const cy = 500;
    const N = sigs.length;
    const R = Math.max(380, N * 48);

    for (let i = 0; i < N; i++) {
      const s = sigs[i];
      const isOutHub = (s.out_system_name || '').toLowerCase() === hubLower;
      const targetId = isOutHub ? s.in_system_id : s.out_system_id;
      const targetName = isOutHub ? s.in_system_name : s.out_system_name;
      if (!targetId || targetId === hubId || nodes.some(n => n.systemId === targetId)) continue;

      const targetClass = (s.in_system_class || (targetName.startsWith('J') ? 'C3' : 'K-Space')).toUpperCase();
      const inSig = s.in_signature || '???';
      const outSig = s.out_signature || '???';
      const whType = s.wh_type || 'WH';

      const hubSig = isOutHub ? outSig : inSig;
      const destSig = isOutHub ? inSig : outSig;
      const remHours = s.remaining_hours !== undefined ? Number(s.remaining_hours) : undefined;
      const expAt = s.expires_at ? new Date(s.expires_at).getTime() : undefined;
      const isEol = (remHours !== undefined && remHours <= 4);
      const isFrig = isFrigateHole(whType, s.max_ship_size);

      const sysInfo = universeGraph.getSystemInfo(targetId) || universeGraph.getSystemInfo(targetName);
      let secVal = sysInfo?.security;
      if (secVal === undefined) {
        if (targetId >= 31000000 && targetId < 32000000) secVal = -0.99;
        else if (targetClass === 'HIGHSEC') secVal = 0.8;
        else if (targetClass === 'LOWSEC') secVal = 0.3;
        else if (targetClass === 'NULLSEC') secVal = -0.2;
      }

      const angle = (2 * Math.PI * i) / N - Math.PI / 2;
      const nx = Math.round(cx + R * Math.cos(angle) - 120);
      const ny = Math.round(cy + R * Math.sin(angle) - 40);

      nodes.push({
        systemId: targetId,
        systemName: targetName,
        whClass: targetClass,
        security: secVal,
        depth: 1,
        parentId: hubId,
        x: nx,
        y: ny,
        scoutedBy: 'EVE-Scout'
      });

      links.push({
        id: `wh-${hubId}-${targetId}`,
        sourceId: hubId,
        targetId: targetId,
        sourceSig: hubSig !== '???' ? hubSig : undefined,
        targetSig: destSig !== '???' ? destSig : undefined,
        whCode: whType !== 'WH' && whType !== '???' ? whType : undefined,
        massStatus: 'stable',
        lifetimeStatus: isEol ? 'eol' : 'stable',
        remainingHours: remHours,
        expiresAt: expAt,
        isFrigateOnly: isFrig,
        shipSize: s.max_ship_size,
        isStargate: false
      });
    }

    return {
      id: pageId,
      name: isThera ? 'Thera Base' : 'Turnur Base',
      isBaseMap: true,
      nodes,
      links,
      signatures: [],
      pan: { x: 40, y: 30 },
      zoom: N > 24 ? 0.5 : N > 14 ? 0.65 : 0.8,
      viewMode: 'canvas',
      selectedSystemId: hubId
    };
  }

  public createHubBaseMap(hub: 'Thera' | 'Turnur') {
    const isThera = hub === 'Thera';
    const targetId = isThera ? 'thera-base' : 'turnur-base';
    const hubId = isThera ? 31000005 : 30002086;

    const existing = this.maps.find(m => m.id === targetId || m.name.includes(`${hub} Base`) || (m.isBaseMap && m.nodes.some(n => n.systemId === hubId)));
    if (existing) {
      if (!Array.isArray(existing.nodes) || existing.nodes.length === 0) {
        const fresh = this.createHubBasePage(hub, existing.id);
        existing.nodes = fresh.nodes;
        existing.links = fresh.links;
        existing.pan = fresh.pan;
        existing.zoom = fresh.zoom;
        existing.selectedSystemId = fresh.selectedSystemId;
      }
      this.switchMap(existing.id);
      void this.syncHubLiveSignatures(hub, false);
      return;
    }

    const page = this.createHubBasePage(hub, targetId);
    this.maps.push(page);
    this.switchMap(targetId);
    void this.syncHubLiveSignatures(hub, false);
  }

  public async syncHubLiveSignatures(hub: 'Thera' | 'Turnur', forceRefresh = false): Promise<void> {
    const isThera = hub === 'Thera';
    const hubId = isThera ? 31000005 : 30002086;
    const hubName = isThera ? 'Thera' : 'Turnur';
    const targetMapId = isThera ? 'thera-base' : 'turnur-base';

    const allSigs = await this.fetchScoutSignatures(forceRefresh);
    if (!this.scoutSnapshotValid || !this.container.isConnected) return;
    const hubLower = hub.toLowerCase();
    const matched = allSigs.filter(s => isActiveScoutSignature(s)).filter(s =>
      (s.out_system_name || '').toLowerCase() === hubLower ||
      (s.in_system_name || '').toLowerCase() === hubLower
    );



    const targetMap = this.maps.find(m => m.id === targetMapId || m.name.includes(hub + ' Base'));
    if (!targetMap) return;
    const isCurrentActive = this.activeMapId === targetMap.id;
    const nodes = isCurrentActive ? [...this.nodes.values()] : targetMap.nodes;
    const links = isCurrentActive ? this.links : targetMap.links;
    const liveTargets = new Set<number>(matched.map(s => Number((s.out_system_name || '').toLowerCase() === hubLower ? s.in_system_id : s.out_system_id)));
    const reconciled = pruneScoutLinks(links, nodes, hubId, liveTargets);
    const removedIds = new Set(reconciled.removed.map(link => link.id));
    const removedTargets = new Set(reconciled.removed.map(link => link.sourceId === hubId ? link.targetId : link.sourceId));
    const keepNode = (node: WormholeNode) => !removedTargets.has(node.systemId) || node.scoutedBy !== 'EVE-Scout' || Boolean(node.customNotes) || reconciled.links.some(link => link.sourceId === node.systemId || link.targetId === node.systemId) || this.activeCharacters.some(pilot => pilot.systemId === node.systemId) || (isCurrentActive ? (this.signatures.get(node.systemId)?.length || 0) > 0 : targetMap.signatures.some(entry => entry.systemId === node.systemId && entry.sigs.length > 0));
    if (isCurrentActive) {
      this.links = reconciled.links;
      this.nodes = new Map(nodes.filter(keepNode).map(node => [node.systemId, node]));
      for (const sigs of this.signatures.values()) for (const sig of sigs) if (sig.linkedLinkId && removedIds.has(sig.linkedLinkId)) delete sig.linkedLinkId;
      if (this.selectedSystemId && !this.nodes.has(this.selectedSystemId)) this.selectedSystemId = hubId;
    } else {
      targetMap.links = reconciled.links; targetMap.nodes = nodes.filter(keepNode);
      for (const entry of targetMap.signatures) for (const sig of entry.sigs) if (sig.linkedLinkId && removedIds.has(sig.linkedLinkId)) delete sig.linkedLinkId;
      if (targetMap.selectedSystemId && !targetMap.nodes.some(node => node.systemId === targetMap.selectedSystemId)) targetMap.selectedSystemId = hubId;
    }

    // Ensure hub node exists
    if (isCurrentActive) {
      if (!this.nodes.has(hubId)) {
        this.nodes.set(hubId, {
          systemId: hubId,
          systemName: hubName,
          whClass: isThera ? 'Thera' : 'Lowsec',
          security: isThera ? -0.99 : 0.25,
          depth: 0,
          x: 580,
          y: 460,
          customNotes: isThera ? 'W-Space Hub (Uncharted)' : 'Metropolis Hub (Turnur I Transmutation)'
        });
      }
    } else if (targetMap) {
      if (!targetMap.nodes.some(n => n.systemId === hubId)) {
        targetMap.nodes.push({
          systemId: hubId,
          systemName: hubName,
          whClass: isThera ? 'Thera' : 'Lowsec',
          security: isThera ? -0.99 : 0.25,
          depth: 0,
          x: 580,
          y: 460,
          customNotes: isThera ? 'W-Space Hub (Uncharted)' : 'Metropolis Hub (Turnur I Transmutation)'
        });
      }
    }

    const cx = 700;
    const cy = 500;
    const N = matched.length;
    const R = Math.max(380, N * 48);
    let addedCount = 0;

    for (let i = 0; i < N; i++) {
      const s = matched[i];
      const isOutHub = (s.out_system_name || '').toLowerCase() === hubLower;
      const targetId = isOutHub ? s.in_system_id : s.out_system_id;
      const targetName = isOutHub ? s.in_system_name : s.out_system_name;
      if (!targetId || targetId === hubId) continue;

      const targetClass = (s.in_system_class || (targetName.startsWith('J') ? 'C3' : 'K-Space')).toUpperCase();
      const inSig = s.in_signature || '???';
      const outSig = s.out_signature || '???';
      const whType = s.wh_type || 'WH';

      const hubSig = isOutHub ? outSig : inSig;
      const destSig = isOutHub ? inSig : outSig;
      const remHours = s.remaining_hours !== undefined ? Number(s.remaining_hours) : undefined;
      const expAt = s.expires_at ? new Date(s.expires_at).getTime() : undefined;
      const isEol = (remHours !== undefined && remHours <= 4);
      const isFrig = isFrigateHole(whType, s.max_ship_size);

      const sysInfo = universeGraph.getSystemInfo(targetId) || universeGraph.getSystemInfo(targetName);
      let secVal = sysInfo?.security;
      if (secVal === undefined) {
        if (targetId >= 31000000 && targetId < 32000000) secVal = -0.99;
        else if (targetClass === 'HIGHSEC') secVal = 0.8;
        else if (targetClass === 'LOWSEC') secVal = 0.3;
        else if (targetClass === 'NULLSEC') secVal = -0.2;
      }

      const angle = (2 * Math.PI * i) / N - Math.PI / 2;
      const defaultX = Math.round(cx + R * Math.cos(angle) - 120);
      const defaultY = Math.round(cy + R * Math.sin(angle) - 40);

      const linkId = `wh-${hubId}-${targetId}`;

      if (isCurrentActive) {
        if (!this.nodes.has(targetId)) {
          this.nodes.set(targetId, createScoutNode({ targetId, targetName, targetClass, secVal, hubId, defaultX, defaultY }));
          addedCount++;
        }
        const existingLink = this.links.find(l => (l.sourceId === hubId && l.targetId === targetId) || (l.sourceId === targetId && l.targetId === hubId));
        if (!existingLink) {
          this.links.push(createScoutLink({ linkId, targetId, hubId, hubSig, destSig, whType, isEol, remHours, expAt, isFrig, shipSize: s.max_ship_size }));
        } else {
          Object.assign(existingLink, updateScoutLink(existingLink, { hubId, hubSig, destSig, whType, remHours, expAt, isEol, isFrig, shipSize: s.max_ship_size }));
        }
      } else if (targetMap) {
        if (!targetMap.nodes.some(n => n.systemId === targetId)) {
          targetMap.nodes.push(createScoutNode({ targetId, targetName, targetClass, secVal, hubId, defaultX, defaultY }));
        }
        const existingLink = targetMap.links.find(l => (l.sourceId === hubId && l.targetId === targetId) || (l.sourceId === targetId && l.targetId === hubId));
        if (!existingLink) {
          targetMap.links.push(createScoutLink({ linkId, targetId, hubId, hubSig, destSig, whType, isEol, remHours, expAt, isFrig, shipSize: s.max_ship_size }));
        } else {
          Object.assign(existingLink, updateScoutLink(existingLink, { hubId, hubSig, destSig, whType, remHours, expAt, isEol, isFrig, shipSize: s.max_ship_size }));
        }
      }
    }

    if (isCurrentActive) {
      this.saveToStorage();
      this.render();
      if (addedCount > 0 || forceRefresh) {
        this.showWaypointToast(`Synced ${matched.length} live ${hub} connections from EVE-Scout`);
      }
    } else {
      this.saveToStorage();
    }
  }

  private initDefaultChain() {
    this.selectedSystemId = null;
    const home = getHomeSystem();
    if (home) {
      const page = this.createDefaultPage(this.activeMapId, 'Chain');
      for (const node of page.nodes) this.nodes.set(node.systemId, node);
      this.selectedSystemId = page.selectedSystemId ?? null;
      return;
    }
    const pilot = this.activeCharacters.find(c => c.isScanner) || this.activeCharacters[0];
    if (pilot) this.handleAutoIngestPilot(pilot);
  }

  public updateCharacters(characters: Array<{ id: string; name: string; systemId: number; systemName?: string; locationUpdatedAt?: number | null; isScanner?: boolean; isNav?: boolean; isOnline?: boolean; roles?: string[]; ship?: ActiveShip | null }>) {
    const onlinePilots = characters.filter(c => c.isOnline !== false);
    const pilots = onlinePilots.length > 0 ? onlinePilots : characters;

    let targetScannerId = this.selectedScannerId;
    if (!targetScannerId) {
      try {
        targetScannerId = localStorage.getItem('wok_daytripper_scanner_pilot') || null;
      } catch {}
    }

    if (targetScannerId && pilots.some(c => String(c.id) === String(targetScannerId))) {
      this.selectedScannerId = String(targetScannerId);
    } else if (pilots.some(c => c.isScanner)) {
      const found = pilots.find(c => c.isScanner);
      if (found) this.selectedScannerId = String(found.id);
    } else if (pilots.length > 0) {
      this.selectedScannerId = String(pilots[0].id);
    }

    const updatedPilots = pilots.map(c => ({
      ...c,
      isScanner: this.selectedScannerId ? String(c.id) === String(this.selectedScannerId) : Boolean(c.isScanner)
    }));

    const prevKey = this.activeCharacters.map(c => `${c.id}:${c.systemId}:${c.isScanner}:${c.isNav}`).join('|');
    const newKey = updatedPilots.map(c => `${c.id}:${c.systemId}:${c.isScanner}:${c.isNav}`).join('|');
    this.activeCharacters = updatedPilots;

    // Ensure active scouts are never trapped in exemptPilots
    for (const pilot of updatedPilots) {
      if (pilot.isScanner && this.exemptPilots.has(pilot.name.toLowerCase())) {
        this.exemptPilots.delete(pilot.name.toLowerCase());
        this.savePilotSettings();
      }
    }

    // Observations place the scanner without inventing a wormhole connection.
    if (!this.resettingPrimary && this.autoMappingEnabled && this.activeMapId === 'primary' && prevKey !== newKey) {
      const pilot = updatedPilots.find(c => c.isScanner) || updatedPilots[0];
      if (pilot && !this.exemptPilots.has(pilot.name.toLowerCase())) {
        this.handleAutoIngestPilot(pilot, false);
      }
    }

    if (prevKey !== newKey) {
      this.renderChainContentOnly();
      this.updatePilotTrackerStrip();
    }
  }

  public setScannerPilot(pilotId: string, pilotName?: string, broadcast = true) {
    this.selectedScannerId = String(pilotId);
    try {
      localStorage.setItem('wok_daytripper_scanner_pilot', String(pilotId));
    } catch {}

    for (const c of this.activeCharacters) {
      c.isScanner = String(c.id) === String(pilotId);
    }

    if (broadcast) {
      try {
        if (this.broadcastChannel) {
          this.broadcastChannel.postMessage({
            accessGrant: this.backendGrant,
        type: 'set_scanner_pilot',
            pilotId: String(pilotId),
            pilotName: pilotName || '',
            source: 'daytripper'
          });
        }
        void emitEvent('wok_daytripper_channel', {
          accessGrant: this.backendGrant,
        type: 'set_scanner_pilot',
          pilotId: String(pilotId),
          pilotName: pilotName || '',
          source: 'daytripper'
        });
      } catch {}
    }

    const selected = this.activeCharacters.find(c => String(c.id) === String(pilotId));
    const name = pilotName || selected?.name || 'Selected pilot';
    this.showWaypointToast(`Active Scanner: ${name}`);

    if (selected && selected.systemId && selected.systemId > 0) {
      if (this.nodes.has(selected.systemId)) {
        this.panToSystem(selected.systemId);
      } else if (selected.systemId >= 31000000 && selected.systemId < 32000000) {
        this.handleAutoIngestPilot(selected, true);
      }
    }

    this.renderChainContentOnly();
    this.updatePilotTrackerStrip();
  }

  public handleAutoIngestPilot(
    pilot: { id: string; name: string; systemId: number; systemName?: string; isScanner?: boolean; ship?: ActiveShip | null },
    forceToast = false
  ) {
    if (!pilot.systemId || pilot.systemId <= 0) return;


    if (this.exemptPilots.has(pilot.name.toLowerCase())) {
      const isScout = Boolean(pilot.isScanner || (pilot as any).roles?.some((r: string) => r.toLowerCase() === 'scanner' || r.toLowerCase() === 'scout'));
      if (forceToast || isScout) {
        this.exemptPilots.delete(pilot.name.toLowerCase());
        this.savePilotSettings();
        this.updatePilotTrackerStrip();
      } else {
        return;
      }
    }

    const toId = pilot.systemId;
    const toClass = getWormholeClass(toId, universeGraph.getSystemInfo(toId)?.security);
    const toName = pilot.systemName || universeGraph.getSystemInfo(toId)?.name || getSystemStatics(toId)?.name || (toId >= 31000000 && toId < 32000000 ? `J${toId - 31000000 + 100000}` : `System ${toId}`);

    // Remove only the old untouched starter, preserving mapped history.
    if (!getHomeSystem() && this.nodes.size === 1 && this.nodes.has(30000142) && this.links.length === 0
        && this.signatures.size === 0 && toId !== 30000142) this.nodes.clear();
    if (!this.nodes.has(toId)) {
      this.nodes.set(toId, {
        systemId: toId, systemName: toName, whClass: toClass,
        security: universeGraph.getSystemInfo(toId)?.security,
        depth: 0, x: 100, y: 180 + this.nodes.size * 150
      });
    }
    this.selectedSystemId = toId;
    this.saveToStorage();
    this.renderChainContentOnly();
    this.panToSystem(toId);
    if (forceToast) this.showWaypointToast(`Scanner location: ${toName} (${toClass})`);
  }

  private updatePilotTrackerStrip() {
    if (!this.pilotTrackerStrip) return;
    this.pilotTrackerStrip.replaceChildren();

    for (const pilot of this.activeCharacters) {
      const isSelectedScanner = Boolean(
        pilot.isScanner || (this.selectedScannerId && String(pilot.id) === String(this.selectedScannerId))
      );
      const isKnown = Boolean(pilot.systemId && pilot.systemId > 0 && this.nodes.has(pilot.systemId));
      const whClass = (pilot.systemId && pilot.systemId > 0)
        ? getWormholeClass(pilot.systemId, universeGraph.getSystemInfo(pilot.systemId)?.security)
        : 'In space';
      const isJSpace = Boolean(pilot.systemId && pilot.systemId >= 31000000 && pilot.systemId < 32000000);
      const resolvedName = pilot.systemName || (pilot.systemId ? this.nodes.get(pilot.systemId)?.systemName : null) || (isJSpace ? `J${(pilot.systemId || 0) - 31000000 + 100000}` : (pilot.systemId ? `System ${pilot.systemId}` : 'Docked / In space'));

      const chip = make('button', '', `wh-pilot-portrait ${isSelectedScanner ? 'is-active-scanner' : 'is-standby'}`) as HTMLButtonElement;
      chip.type = 'button';

      const portrait = document.createElement('img');
      portrait.src = `https://images.evetech.net/characters/${encodeURIComponent(pilot.id)}/portrait?size=64`;
      portrait.alt = pilot.name;
      portrait.width = 28;
      portrait.height = 28;
      chip.append(portrait);

      if (isSelectedScanner) {
        const badge = make('span', '', 'wh-pilot-portrait-badge');
        badge.innerHTML = getLucideSvg('search', { size: 10 });
        badge.title = 'Dedicated Active WH Scanner';
        chip.append(badge);

        chip.title = `${pilot.name} [Active Scanner] — ${resolvedName} (${whClass})\nClick to center camera or re-chart`;
        chip.setAttribute('aria-label', `${pilot.name} is active scanner in ${resolvedName}`);
        chip.onclick = () => {
          if (pilot.systemId && pilot.systemId > 0) {
            if (isKnown) {
              this.panToSystem(pilot.systemId);
            } else {
              this.handleAutoIngestPilot(pilot, true);
            }
          } else {
            this.showWaypointToast(`${pilot.name} is the active scanner`);
          }
        };
      } else {
        chip.title = `${pilot.name} — ${resolvedName} (${whClass})\nClick to select ${pilot.name} as active scanner`;
        chip.setAttribute('aria-label', `Select ${pilot.name} as active scanner`);
        chip.onclick = () => {
          this.setScannerPilot(pilot.id, pilot.name, true);
        };
      }

      this.pilotTrackerStrip.append(chip);
    }
  }

  public onCharacterJump(charName: string, fromId: number, toId: number, fromName: string, toName: string, ship?: ActiveShip | null, wormholeConfirmed = false) {
    if (this.resettingPrimary && this.activeMapId === 'primary') return;
    if (!this.autoMappingEnabled) return;
    if (this.exemptPilots.has(charName.toLowerCase())) {
      const isScout = this.activeCharacters.some(c => c.name.toLowerCase() === charName.toLowerCase() && (c.isScanner || c.roles?.some(r => r.toLowerCase() === 'scanner' || r.toLowerCase() === 'scout')));
      if (isScout || this.activeCharacters.length <= 1) {
        this.exemptPilots.delete(charName.toLowerCase());
        this.savePilotSettings();
        this.showWaypointToast(`Auto-unexempted scout ${charName} to record wormhole jump!`);
      } else {
        return;
      }
    }
    if (fromId === toId) return;

    // Gate path / K-space moves do not chain
    const fromClass = getWormholeClass(fromId, universeGraph.getSystemInfo(fromId)?.security);
    const toClass = getWormholeClass(toId, universeGraph.getSystemInfo(toId)?.security);
    const isFromKSpace = fromId < 31000000 || fromId >= 32000000;
    const isToKSpace = toId < 31000000 || toId >= 32000000;
    const isKnownWormhole = this.hasPendingExploration(fromId, toId) || this.hasConnection(fromId, toId);
    if (isFromKSpace && isToKSpace && !wormholeConfirmed && !isKnownWormhole) return;

    this.showWaypointToast(`Jump Tracked: ${charName} (${fromName} -> ${toName})`);

    // Only switch map if user was on the static guide tab
    if (this.activeMapId === 'mapping-guide') this.switchMap('primary', false);
    if (!this.nodes.has(fromId)) {
      this.nodes.set(fromId, {
        systemId: fromId, systemName: fromName, whClass: fromClass,
        security: universeGraph.getSystemInfo(fromId)?.security,
        depth: 0, x: 100, y: 180 + this.nodes.size * 150
      });
    }
    if (!this.nodes.has(toId)) {
      this.addWormholeConnection(fromId, toId, toName, toClass, undefined, undefined, undefined, charName);
    } else if (!this.links.some(l =>
      (l.sourceId === fromId && l.targetId === toId) ||
      (l.sourceId === toId && l.targetId === fromId))) {
      this.links.push({ id: `${fromId}-${toId}`, sourceId: fromId, targetId: toId,
        massStatus: 'stable', lifetimeStatus: 'stable' });
    }

    const linkId = `${fromId}-${toId}`;
    const revLinkId = `${toId}-${fromId}`;
    const candidates = this.links.filter(l => (l.sourceId === fromId && l.targetId === toId) || (l.sourceId === toId && l.targetId === fromId));
    const activeLink = candidates.length === 1 ? candidates[0] : candidates.find(l => {
      const target = this.targetedSignature;
      return target?.systemId === fromId && (l.sourceId === fromId ? l.sourceSig : l.targetSig) === target.sigId;
    });

    // Apply targeted connection parameters to the link
    if (!this.targetedSignature) {
      try {
        const savedTgt = localStorage.getItem('wok.daytripperTargetedSig');
        if (savedTgt) this.targetedSignature = JSON.parse(savedTgt);
      } catch {}
    }

    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    const isFromHomePocket = Boolean(fromNode?.depth === 0 || fromId === getHomeSystem()?.id || this.maps.find(m => m.id === this.activeMapId)?.isBaseMap);
    const storedExploration = this.activeExploration;
    const exp = storedExploration?.characterName === charName.toLowerCase() && storedExploration.mapId === this.activeMapId && storedExploration.linkId === activeLink?.id ? storedExploration : null;
    const isJumpBackExp = Boolean(exp && (
      exp.discoveredSystemId === fromId && exp.originSystemId === toId
    ));
    const isOutwardJump = !isJumpBackExp && Boolean(
      (this.targetedSignature && this.targetedSignature.systemId === fromId) ||
      (isFromHomePocket && !isJumpBackExp) ||
      (fromNode && toNode && toNode.depth > fromNode.depth && !isJumpBackExp)
    );

    const insertionSig = (this.targetedSignature?.systemId === fromId ? this.targetedSignature.sigId : null)
      || (activeLink && (activeLink.sourceId === fromId ? activeLink.sourceSig : activeLink.targetSig))
      || (activeLink && (this.signatures.get(fromId) || []).find(s => s.linkedLinkId === activeLink.id)?.id);
    const scanner = this.activeCharacters.find(c => String(c.id) === this.selectedScannerId);
    const controlsBookmarks = !scanner || scanner.name.toLowerCase() === charName.toLowerCase();
    if (controlsBookmarks && isOutwardJump && activeLink && insertionSig) {
      const tgt = (this.targetedSignature && this.targetedSignature.systemId === fromId) ? this.targetedSignature : null;
      const tgtSigId = insertionSig;
      if (activeLink.sourceId === fromId) activeLink.sourceSig = tgtSigId;
      else activeLink.targetSig = tgtSigId;
      if (tgt?.spaceType) activeLink.customType = tgt.spaceType;
      if (tgt?.whCode) activeLink.whCode = tgt.whCode;
      if (tgt?.isEol) activeLink.lifetimeStatus = 'eol';
      if (tgt?.isCrit) activeLink.massStatus = 'critical';
      if (tgt?.isFrig) activeLink.isFrigateOnly = true;

      // Mark signature in fromId list
      const fromSigs = this.signatures.get(fromId) || [];
      const sItem = fromSigs.find(s => s.id.toUpperCase() === tgtSigId.toUpperCase());
      if (sItem) sItem.linkedLinkId = activeLink.id;

      // 1. Generate return Breadcrumb bookmark (BT)
      const fromStatics = getSystemStatics(fromId) || getSystemStatics(fromName);
      const fromSec = fromNode?.security !== undefined ? fromNode.security : universeGraph.getSystemInfo(fromId)?.security;
      const fromClass = fromNode?.whClass || fromStatics?.whClass;
      const fromEffect = fromNode?.effect || fromStatics?.effect;

      const breadcrumbText = generateWormholeBookmark({
        sigId: tgtSigId,
        isBreadcrumb: true,
        breadcrumbParentName: fromName,
        targetSystemName: fromName,
        targetSecurity: fromSec,
        targetClass: fromClass,
        targetEffect: fromEffect,
        whCode: tgt?.whCode || activeLink.whCode,
        isEol: tgt?.isEol || activeLink.lifetimeStatus === 'eol',
        isCrit: tgt?.isCrit || activeLink.massStatus === 'critical',
        isFrigate: tgt?.isFrig || Boolean(activeLink.isFrigateOnly)
      });
      this.latestBookmark = {
        text: breadcrumbText,
        timestamp: Date.now(),
        accessGrant: this.backendGrant,
        type: 'breadcrumb',
        fromSystem: fromName,
        toSystem: toName,
        sigId: tgtSigId,
        parsedSummary: `Return Breadcrumb to ${fromName} via ${tgtSigId}`
      };
      this.notifyLatestBookmarkChange();
      void copyToClipboard(breadcrumbText);
      this.showWaypointToast(`Breadcrumb Bookmark ready: "${breadcrumbText}"`);

      // Store active exploration context for jump-back detection
      this.activeExploration = {
        characterName: charName.toLowerCase(), mapId: this.activeMapId, linkId: activeLink.id,
        originSystemId: fromId,
        originSystemName: fromName,
        discoveredSystemId: toId,
        discoveredSystemName: toName,
        sigId: tgtSigId,
        spaceType: tgt?.spaceType || activeLink.customType || '',
        isStatic: tgt?.isStatic ?? true,
        isEol: tgt?.isEol ?? (activeLink.lifetimeStatus === 'eol'),
        isCrit: tgt?.isCrit ?? (activeLink.massStatus === 'critical'),
        isFrig: tgt?.isFrig ?? Boolean(activeLink.isFrigateOnly),
        whCode: tgt?.whCode || activeLink.whCode
      };
      try {
        localStorage.setItem('wok.daytripperActiveExploration', JSON.stringify(this.activeExploration));
      } catch {}

      // If initial hole was a K162, popup to catch the connection from the other side
      if (tgt?.whCode === 'K162' || tgt?.spaceType === 'K162' || activeLink.whCode === 'K162') {
        this.showK162CatchModal(activeLink.id, fromId, fromName, toId, toName, tgtSigId);
      }

      this.targetedSignature = null;
      this.notifyTargetedSigChange();
    } else if (controlsBookmarks && isJumpBackExp && exp) {
      // 2. Jump-back detected! Pilot is standing in toId (toName), targeting the wormhole to fromId (fromName)
      const discId = exp.discoveredSystemId === fromId ? fromId : exp.discoveredSystemId;
      const discName = exp.discoveredSystemName || fromName;
      const discInfo = universeGraph.getSystemInfo(discId);
      const discSec = discInfo?.security;
      const discStatics = getSystemStatics(discId) || getSystemStatics(discName);
      const discClass = discStatics?.whClass || getWormholeClass(discId, discSec);
      const discEffect = discStatics?.effect || this.nodes.get(discId)?.effect;

      const fullBookmark = generateWormholeBookmark({
        sigId: exp.sigId,
        targetSpaceType: exp.spaceType,
        isStatic: exp.isStatic,
        targetSystemName: discName,
        targetSecurity: discSec,
        targetClass: discClass,
        targetEffect: discEffect,
        whCode: exp.whCode,
        isEol: exp.isEol,
        isCrit: exp.isCrit,
        isFrigate: exp.isFrig
      });

      this.latestBookmark = {
        text: fullBookmark,
        timestamp: Date.now(),
        accessGrant: this.backendGrant,
        type: 'forward',
        fromSystem: toName,
        toSystem: discName,
        sigId: exp.sigId,
        parsedSummary: `Discovered WH -> ${discName} (${discClass}${discSec !== undefined ? ` ${discSec.toFixed(1)}` : ''}${discEffect ? ` ${discEffect}` : ''})`
      };

      this.notifyLatestBookmarkChange();
      void copyToClipboard(fullBookmark);
      this.showWaypointToast(`Discovered Bookmark Copied: "${fullBookmark}"`);

      // Update link parameters with discovered data
      if (activeLink) {
        if (!activeLink.sourceSig && activeLink.sourceId === toId) activeLink.sourceSig = exp.sigId;
        else if (!activeLink.targetSig && activeLink.targetId === toId) activeLink.targetSig = exp.sigId;
        if (exp.spaceType) activeLink.customType = exp.spaceType;
        if (exp.whCode && exp.whCode !== 'K162') {
          if (activeLink.whCode === 'K162' || !activeLink.whCode) {
            activeLink.returnWhCode = exp.whCode;
            this.showWaypointToast(`Updated K162 mass limits from return path: ${exp.whCode}`);
          } else {
            activeLink.whCode = exp.whCode;
          }
        }
        this.recalculateLinkMass(activeLink);
      }

      this.activeExploration = null;
      try {
        localStorage.removeItem('wok.daytripperActiveExploration');
      } catch {}
    } else if (controlsBookmarks && activeLink) {
      // Fallback jump-back detected across pre-existing tagged link in either direction
      const isSourceAtTo = activeLink.sourceId === toId;
      const isTargetAtTo = activeLink.targetId === toId;
      if (isSourceAtTo || isTargetAtTo) {
        const sigAtTo = isSourceAtTo ? activeLink.sourceSig : activeLink.targetSig;
        const sigInToSigs = sigAtTo || (this.signatures.get(toId) || []).find(s => s.linkedLinkId === activeLink.id)?.id;

        if (sigInToSigs) {
          const discId = fromId;
          const discName = fromName;
          const discInfo = universeGraph.getSystemInfo(discId);
          const discSec = discInfo?.security;
          const discStatics = getSystemStatics(discId) || getSystemStatics(discName);
          const discClass = discStatics?.whClass || getWormholeClass(discId, discSec);
          const discEffect = discStatics?.effect || this.nodes.get(discId)?.effect;

          const fullBookmark = generateWormholeBookmark({
            sigId: sigInToSigs,
            targetSpaceType: activeLink.customType,
            isStatic: activeLink.whCode ? activeLink.whCode !== 'K162' : true,
            targetSystemName: discName,
            targetSecurity: discSec,
            targetClass: discClass,
            targetEffect: discEffect,
            whCode: activeLink.whCode,
            isEol: activeLink.lifetimeStatus === 'eol',
            isCrit: activeLink.massStatus === 'critical',
            isFrigate: Boolean(activeLink.isFrigateOnly || isFrigateHole(activeLink.whCode))
          });

          this.latestBookmark = {
            text: fullBookmark,
            timestamp: Date.now(),
            accessGrant: this.backendGrant,
        type: 'forward',
            fromSystem: toName,
            toSystem: discName,
            sigId: sigInToSigs,
            parsedSummary: `Discovered WH -> ${discName} (${discClass}${discSec !== undefined ? ` ${discSec.toFixed(1)}` : ''}${discEffect ? ` ${discEffect}` : ''})`
          };

          try {
            localStorage.setItem('wok.daytripperLatestBookmark', JSON.stringify(this.latestBookmark));
          } catch {}

          this.notifyLatestBookmarkChange();
          void copyToClipboard(fullBookmark);
          this.showWaypointToast(`Discovered Bookmark Copied: "${fullBookmark}"`);
        }
      }
    }

    this.selectedSystemId = toId;
    this.saveToStorage();
    this.render();
    this.panToSystem(toId);

    // 4. Automated Mass & Jump Log Recording
    const matchingLinks: WormholeLink[] = [];

    if (activeLink) matchingLinks.push(activeLink);

    for (const m of this.maps) {
      if (m.id === this.activeMapId) continue;
      const l = m.links?.find(lk => lk.id === linkId || lk.id === revLinkId);
      if (l && !matchingLinks.includes(l)) matchingLinks.push(l);
    }

    if (matchingLinks.length > 0) {
      const resolved = resolveShipMassKg(ship?.type_name, ship?.ship_name || ship?.name, ship?.ship_type_id);
      for (const link of matchingLinks) {
        if (!link.jumpLog) link.jumpLog = [];
        const isOut = link.sourceId === fromId;
        const entry: WormholeJumpLogEntry = {
          id: `jump-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          characterName: charName,
          shipName: ship?.ship_name || ship?.name,
          shipTypeName: ship?.type_name || resolved.hullCategory,
          shipTypeId: ship?.ship_type_id,
          fromSystemId: fromId,
          toSystemId: toId,
          fromSystemName: fromName,
          toSystemName: toName,
          direction: isOut ? 'out' : 'in',
          massKg: resolved.massKg,
          propState: resolved.propState
        };
        link.jumpLog.push(entry);
        this.recalculateLinkMass(link);
      }
      const massFmt = formatMassKg(resolved.massKg);
      this.showWaypointToast(`Mass Tracked: ${charName} in ${ship?.type_name || resolved.hullCategory} (+${massFmt}) on ${fromName} -> ${toName}`);
    }

    this.updatePilotTrackerStrip();
  }

  public recalculateLinkMass(link: WormholeLink) {
    if (Array.isArray(link.jumpLog)) {
      link.massJumpedKg = link.jumpLog.reduce((acc, j) => acc + (j.massKg || 0), 0);
    }
    const spec = getLinkWhSpec(link);
    const totalMassKg = wormholeLinkCapacityKg(link, spec);

    if (totalMassKg !== null && totalMassKg > 0) {
      const pct = ((link.massJumpedKg || 0) / totalMassKg) * 100;
      if (pct >= 90) {
        link.massStatus = 'critical';
      } else if (pct >= 50) {
        link.massStatus = 'half';
      } else {
        link.massStatus = 'stable';
      }
    }
    this.saveToStorage();
    this.render();
  }

  private renderPilotAvatarGroup(pilots: Array<{ id: string; name: string; isScanner?: boolean }>): HTMLElement {
    const group = make('div', '', 'wh-pilot-avatar-group');
    const pilotNames = pilots.map(p => `${p.name}${p.isScanner ? ' [Scanner]' : ''}`).join(', ');
    group.title = `Pilots in system: ${pilotNames}`;

    for (const pilot of pilots) {
      const wrapper = make('div', '', 'wh-pilot-avatar-wrapper');
      const img = document.createElement('img');
      img.className = 'wh-pilot-avatar-bubble' + (pilot.isScanner ? ' is-scanner' : '');
      img.alt = pilot.name;
      img.title = pilot.isScanner ? `${pilot.name} (Dedicated Scanner)` : pilot.name;
      img.loading = 'lazy';
      img.src = `https://images.evetech.net/characters/${pilot.id}/portrait?size=64`;
      img.onerror = () => {
        const fallback = make('span', pilot.name.slice(0, 1).toUpperCase(), 'wh-pilot-avatar-fallback');
        fallback.title = pilot.name;
        img.replaceWith(fallback);
      };
      wrapper.append(img);
      if (pilot.isScanner) {
        const badge = make('span', '', 'wh-pilot-scanner-badge'); badge.innerHTML = getLucideSvg('search', { size: 12 });
        badge.title = 'Dedicated WH Scanner';
        wrapper.append(badge);
      }
      group.append(wrapper);
    }
    return group;
  }

  public showWaypointToast(msg: string, isError = false) {
    showToast(msg, isError ? 'error' : 'info');
  }

  public setSystemStatus(systemId: number, status: SystemTacticalStatus) {
    const node = this.nodes.get(systemId);
    if (!node) return;
    node.status = status;
    this.saveToStorage();
    this.render();

    const statusMap: Record<string, string> = {
      normal: 'Status cleared (Normal)',
      camped: 'Marked as CAMPED',
      traffic: 'Marked as TRAFFIC',
      eol_crit: 'Marked as EOL / CRITICAL',
      hole_control: 'Marked as HOLE CONTROL'
    };
    this.showWaypointToast(`${node.systemName}: ${statusMap[status] || status}`);
  }

  public toggleLockNode(systemId: number) {
    const node = this.nodes.get(systemId);
    if (!node) return;
    node.locked = !node.locked;
    this.saveToStorage();
    this.render();
    this.showWaypointToast(`${node.systemName}: Position ${node.locked ? 'Locked' : 'Unlocked'}`);
  }

  public showSystemContextMenu(e: MouseEvent, systemId: number, systemName: string) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.querySelector('.map-system-context-menu');
    if (existing) existing.remove();

    const menu = make('div', '', 'map-system-context-menu');
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    menu.style.left = `${Math.max(10, x)}px`;
    menu.style.top = `${Math.max(10, y)}px`;

    const node = this.nodes.get(systemId);

    const header = make('div', '', 'menu-header');
    header.append(make('span', systemName));
    if (node?.status && node.status !== 'normal') {
      const badge = make('span', node.status.toUpperCase(), `sec-badge wh-status-badge-${node.status}`);
      header.append(badge);
    }
    menu.append(header);

    // --- Tactical Status Selection ---
    const statusLabel = make('div', 'Tactical Status', 'menu-section-label');
    menu.append(statusLabel);

    const btnHoleCtrl = make('button', 'Hole Control');
    btnHoleCtrl.title = 'Full friendly hole control (crit/rolled statics, bubble watch, scouts active)';
    btnHoleCtrl.onclick = () => {
      menu.remove();
      this.setSystemStatus(systemId, 'hole_control');
    };

    const btnTraffic = make('button', 'Traffic / Active');
    btnTraffic.title = 'Hostile, neutral or unknown transit traffic observed';
    btnTraffic.onclick = () => {
      menu.remove();
      this.setSystemStatus(systemId, 'traffic');
    };

    const btnEolCrit = make('button', 'EOL or Crit');
    btnEolCrit.title = 'System has an EOL (<4h) or Critical mass wormhole connection';
    btnEolCrit.onclick = () => {
      menu.remove();
      this.setSystemStatus(systemId, 'eol_crit');
    };

    const btnCamped = make('button', 'Camped / Hostile');
    btnCamped.title = 'Active hostile bubble camp, gatecamp, or heavy enemy force present';
    btnCamped.onclick = () => {
      menu.remove();
      this.setSystemStatus(systemId, 'camped');
    };

    const btnClearStatus = make('button', ' Normal / Clear Status');
    btnClearStatus.onclick = () => {
      menu.remove();
      this.setSystemStatus(systemId, 'normal');
    };

    menu.append(btnHoleCtrl, btnTraffic, btnEolCrit, btnCamped, btnClearStatus);

    menu.append(make('div', '', 'menu-divider'));

    // --- Navigation & Autopilot ---
    const navLabel = make('div', 'Navigation (ESI)', 'menu-section-label');
    menu.append(navLabel);

    const characters = (this.activeCharacters || []).filter(c => c && c.id);
    const navPilot = characters.find(c => c.isNav || c.roles?.includes('Navigation'));
    const activePilot = navPilot || characters[0];
    const charId = activePilot ? String(activePilot.id) : undefined;
    const charLabel = activePilot ? ` for ${activePilot.name}${navPilot ? ' [Nav]' : ''}` : '';

    const btnDest = make('button', ` Set Destination${activePilot ? ` (${activePilot.name})` : ''}`);
    btnDest.title = `Set in-game autopilot destination via ESI${charLabel}`;
    btnDest.onclick = async () => {
      menu.remove();
      try {
        await setAutopilotDestination(systemId, { characterId: charId, clearOtherWaypoints: true, addToBeginning: false });
        this.showWaypointToast(` Autopilot set to ${systemName}${charLabel}`);
      } catch (err: any) {
        this.showWaypointToast(`Failed to set destination: ${err.message || err}`, true);
      }
    };
    menu.append(btnDest);

    const btnWaypoint = make('button', ` Add Waypoint${activePilot ? ` (${activePilot.name})` : ''}`);
    btnWaypoint.title = `Add this system to your in-game waypoint route via ESI${charLabel}`;
    btnWaypoint.onclick = async () => {
      menu.remove();
      try {
        await setAutopilotDestination(systemId, { characterId: charId, clearOtherWaypoints: false, addToBeginning: false });
        this.showWaypointToast(` Added ${systemName} to route${charLabel}`);
      } catch (err: any) {
        this.showWaypointToast(`Failed to add waypoint: ${err.message || err}`, true);
      }
    };
    menu.append(btnWaypoint);

    const otherPilots = characters.filter(c => String(c.id) !== String(activePilot?.id));
    for (const alt of otherPilots.slice(0, 3)) {
      const btnAlt = make('button', ` Set Dest (${alt.name})`);
      btnAlt.style.opacity = '0.88';
      btnAlt.onclick = async () => {
        menu.remove();
        try {
          await setAutopilotDestination(systemId, { characterId: String(alt.id), clearOtherWaypoints: true, addToBeginning: false });
          this.showWaypointToast(` Autopilot set to ${systemName} for ${alt.name}`);
        } catch (err: any) {
          this.showWaypointToast(`Failed to set destination: ${err.message || err}`, true);
        }
      };
      menu.append(btnAlt);
    }

    menu.append(make('div', '', 'menu-divider'));

    // --- Wormhole & Mapping Actions ---
    const mapLabel = make('div', 'Mapping & Chain', 'menu-section-label');
    menu.append(mapLabel);

    const btnAddConn = make('button', ' Add Connected Wormhole');
    btnAddConn.onclick = () => {
      menu.remove();
      this.selectedSystemId = systemId;
      this.showAddConnectionModal();
    };
    menu.append(btnAddConn);

    const btnPasteSigs = make('button', ' Paste Signatures');
    btnPasteSigs.onclick = () => {
      menu.remove();
      this.selectedSystemId = systemId;
      void this.importScannerClipboard();
    };
    menu.append(btnPasteSigs);

    const btnSyncScout = make('button', ' Sync EVE-Scout Sigs');
    btnSyncScout.title = 'Fetch live EVE-Scout connections and update or link to this system';
    btnSyncScout.onclick = () => {
      menu.remove();
      void this.updateConnectionsFromEveScout(systemId);
    };
    menu.append(btnSyncScout);

    if (node) {
      const btnLock = make('button', node.locked ? 'Unlock Position' : 'Lock Position');
      btnLock.title = node.locked ? 'Allow dragging this card on the canvas' : 'Prevent accidental dragging on canvas';
      btnLock.onclick = () => {
        menu.remove();
        this.toggleLockNode(systemId);
      };
      menu.append(btnLock);
    }

    const btnFocus = make('button', ' Focus & Select');
    btnFocus.onclick = () => {
      menu.remove();
      this.selectedSystemId = systemId;
      if (node && isFinite(node.x as number) && isFinite(node.y as number)) {
        this.pan.x = window.innerWidth / 3 - (node.x || 0) * this.zoom;
        this.pan.y = window.innerHeight / 3 - (node.y || 0) * this.zoom;
        this.saveToStorage();
      }
      this.render();
    };
    menu.append(btnFocus);

    menu.append(make('div', '', 'menu-divider'));

    // --- Intel & External Links ---
    const intelLabel = make('div', 'Intel & External', 'menu-section-label');
    menu.append(intelLabel);

    const btnCopy = make('button', 'Copy System Name');
    btnCopy.onclick = () => {
      menu.remove();
      void navigator.clipboard.writeText(systemName);
      this.showWaypointToast(`Copied "${systemName}" to clipboard`);
    };
    menu.append(btnCopy);

    const btnZkill = make('button', '️ Open zKillboard');
    btnZkill.onclick = () => {
      menu.remove();
      void call('open_url', { url: `https://zkillboard.com/system/${systemId}/` });
    };
    menu.append(btnZkill);

    const btnDotlan = make('button', ' Open Dotlan');
    btnDotlan.onclick = () => {
      menu.remove();
      void call('open_url', { url: `https://evemaps.dotlan.net/system/${encodeURIComponent(systemName)}` });
    };
    menu.append(btnDotlan);

    if (this.onBackToMap) {
      const btnMap = make('button', '️ View on Universe Map');
      btnMap.onclick = () => {
        menu.remove();
        if (this.onBackToMap) this.onBackToMap();
      };
      menu.append(btnMap);
    }

    if (this.nodes.size > 1) {
      menu.append(make('div', '', 'menu-divider'));
      const btnDel = make('button', ' Remove System from Chain');
      btnDel.style.color = '#f87171';
      btnDel.onclick = async () => {
        menu.remove();
        if (await this.confirmAction(`Remove ${systemName} and its connections from this chain?`)) {
          this.removeNode(systemId);
        }
      };
      menu.append(btnDel);
    }

    document.body.append(menu);

    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    window.addEventListener('pointerdown', dismiss);
  }

  public showTabContextMenu(e: MouseEvent, mapId: string) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.querySelector('.map-tab-context-menu');
    if (existing) existing.remove();

    const page = this.maps.find(m => m.id === mapId);
    if (!page) return;

    const menu = make('div', '', 'map-tab-context-menu');
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 220);
    menu.style.left = `${Math.max(10, x)}px`;
    menu.style.top = `${Math.max(10, y)}px`;

    const header = make('div', '', 'menu-header');
    header.append(make('span', ` ${page.name}`));
    menu.append(header);

    // Rename Tab
    const btnRename = make('button', '️ Rename Chain');
    btnRename.onclick = () => {
      menu.remove();
      const newName = prompt('Enter new chain page name:', page.name);
      if (newName && newName.trim()) {
        page.name = newName.trim();
        this.saveToStorage();
        this.render();
      }
    };
    menu.append(btnRename);

    // Duplicate Chain Tab
    const btnDup = make('button', ' Duplicate Chain');
    btnDup.onclick = () => {
      menu.remove();
      const newId = `chain-${Date.now().toString(36)}`;
      const clonedNodes = JSON.parse(JSON.stringify(page.nodes || []));
      const clonedLinks = JSON.parse(JSON.stringify(page.links || []));
      const clonedSigs = JSON.parse(JSON.stringify(page.signatures || []));
      const newPage: DaytripperMapPage = {
        id: newId,
        name: `${page.name} (Copy)`,
        nodes: clonedNodes,
        links: clonedLinks,
        signatures: clonedSigs,
        pan: { ...(page.pan || { x: 50, y: 50 }) },
        zoom: page.zoom || 1.0,
        viewMode: page.viewMode || 'canvas',
        isBaseMap: false
      };
      this.maps.push(newPage);
      this.switchMap(newId);
      this.showWaypointToast(` Duplicated "${page.name}" to "${newPage.name}"`);
    };
    menu.append(btnDup);

    // Export Chain to JSON / Clipboard
    const btnExport = make('button', ' Export Chain (JSON)');
    btnExport.onclick = () => {
      menu.remove();
      const exportData = JSON.stringify({
        version: 2,
        exportedAt: Date.now(),
        page: {
          name: page.name,
          nodes: page.nodes,
          links: page.links,
          signatures: page.signatures
        }
      }, null, 2);
      void navigator.clipboard.writeText(exportData);
      this.showWaypointToast(` Exported "${page.name}" data to clipboard`);
    };
    menu.append(btnExport);

    menu.append(make('div', '', 'menu-divider'));

    // Reset / Clear systems
    const btnClear = make('button', ' Reset Systems in Chain');
    btnClear.style.color = '#fbbf24';
    btnClear.onclick = async () => {
      menu.remove();
      if (await this.confirmAction(`Reset all systems and connections in "${page.name}"?`)) {
        if (page.id === 'primary') {
          if (!await this.resetPrimaryChain()) return;
        } else if (this.activeMapId === page.id) {
          await this.resetCurrentMap();
        } else {
          page.nodes = [];
          page.links = [];
          page.signatures = [];
          this.saveToStorage();
          this.render();
        }
        this.showWaypointToast(` Reset chain "${page.name}"`);
      }
    };
    menu.append(btnClear);

    // Delete Tab
    const isOfficialBase = page.id === 'thera-base' || page.id === 'turnur-base';
    if (this.maps.length > 1 && !isOfficialBase) {
      const btnDel = make('button', '️ Delete Chain Tab');
      btnDel.style.color = '#f87171';
      btnDel.onclick = async () => {
        menu.remove();
        if (await this.confirmAction(`Delete chain tab "${page.name}"?`)) {
          this.deleteMapPage(page.id);
        }
      };
      menu.append(btnDel);
    }

    document.body.append(menu);
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    window.addEventListener('pointerdown', dismiss);
  }

  public showConnectionContextMenu(e: MouseEvent, linkId: string) {
    e.preventDefault();
    e.stopPropagation();
    const existing = document.querySelector('.map-conn-context-menu');
    if (existing) existing.remove();

    const link = this.links.find(l => l.id === linkId);
    if (!link) return;

    const sourceNode = this.nodes.get(link.sourceId);
    const targetNode = this.nodes.get(link.targetId);

    const menu = make('div', '', 'map-conn-context-menu');
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 240);
    menu.style.left = `${Math.max(10, x)}px`;
    menu.style.top = `${Math.max(10, y)}px`;

    const header = make('div', '', 'menu-header');
    header.append(make('span', ` ${sourceNode?.systemName || 'Source'} ⇄ ${targetNode?.systemName || 'Target'}`));
    menu.append(header);

    const btnEdit = make('button', '️ Edit Connection Details...');
    btnEdit.onclick = () => {
      menu.remove();
      this.showEditConnectionModal(linkId);
    };
    menu.append(btnEdit);

    const btnCycleMass = make('button', `️ Cycle Mass (Now: ${link.massStatus.toUpperCase()})`);
    btnCycleMass.onclick = () => {
      menu.remove();
      this.cycleMassStatus(linkId);
    };
    menu.append(btnCycleMass);

    const btnToggleLife = make('button', ` Toggle EOL (Now: ${link.lifetimeStatus === 'eol' ? 'EOL' : 'LIFE OK'})`);
    btnToggleLife.onclick = () => {
      menu.remove();
      this.toggleLifetimeStatus(linkId);
    };
    menu.append(btnToggleLife);

    const btnRollCalc = make('button', ' Rolling Calculator');
    btnRollCalc.onclick = () => {
      menu.remove();
      this.showRollingCalculatorModal(linkId);
    };
    menu.append(btnRollCalc);

    const btnFlip = make('button', '⇄ Reverse Direction');
    btnFlip.onclick = () => {
      menu.remove();
      const prevSource = link.sourceId;
      link.sourceId = link.targetId;
      link.targetId = prevSource;
      const prevSig = link.sourceSig;
      link.sourceSig = link.targetSig;
      link.targetSig = prevSig;
      this.saveToStorage();
      this.render();
      this.showWaypointToast(`⇄ Reversed connection direction`);
    };
    menu.append(btnFlip);

    menu.append(make('div', '', 'menu-divider'));

    const btnDel = make('button', '️ Delete Connection');
    btnDel.style.color = '#f87171';
    btnDel.onclick = async () => {
      menu.remove();
      if (await this.confirmAction(`Delete connection between ${sourceNode?.systemName} and ${targetNode?.systemName}?`)) {
        this.links = this.links.filter(l => l.id !== linkId);
        this.saveToStorage();
        this.render();
        this.showWaypointToast(`️ Connection removed`);
      }
    };
    menu.append(btnDel);

    document.body.append(menu);
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    window.addEventListener('pointerdown', dismiss);
  }

  public showEditConnectionModal(linkId: string) {
    const link = this.links.find(l => l.id === linkId);
    if (!link) return;

    const sourceNode = this.nodes.get(link.sourceId);
    const targetNode = this.nodes.get(link.targetId);
    if (!sourceNode || !targetNode) return;

    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box');
    box.append(make('h3', `Edit Connection: ${sourceNode.systemName} ⇄ ${targetNode.systemName}`));

    const form = make('div', '', 'wh-form-grid');

    // Direction swap button
    const dirRow = make('div', '', 'wh-form-row');
    const flipBtn = make('button', `⇄ Reverse Direction (Currently: ${sourceNode.systemName} -> ${targetNode.systemName})`, 'map-btn map-btn-xs map-btn-secondary');
    flipBtn.title = 'Swap source and target endpoints and their corresponding signature IDs';
    flipBtn.onclick = () => {
      const prevSource = link.sourceId;
      link.sourceId = link.targetId;
      link.targetId = prevSource;
      const prevSig = link.sourceSig;
      link.sourceSig = link.targetSig;
      link.targetSig = prevSig;
      this.saveToStorage();
      modal.remove();
      this.showEditConnectionModal(linkId);
    };
    dirRow.append(flipBtn);
    form.append(dirRow);

    // Signatures two-column
    const sigGrid = make('div', '', 'wh-form-two-col');
    const sourceSigRow = make('div', '', 'wh-form-row');
    sourceSigRow.append(make('label', `${sourceNode.systemName} Signature ID:`));
    const sourceSigInput = document.createElement('input');
    sourceSigInput.className = 'wh-input';
    sourceSigInput.placeholder = 'e.g. ABC-123 or K162';
    sourceSigInput.value = link.sourceSig || '';
    sourceSigRow.append(sourceSigInput);

    const targetSigRow = make('div', '', 'wh-form-row');
    targetSigRow.append(make('label', `${targetNode.systemName} Signature ID:`));
    const targetSigInput = document.createElement('input');
    targetSigInput.className = 'wh-input';
    targetSigInput.placeholder = 'e.g. XYZ-987 or K162';
    targetSigInput.value = link.targetSig || '';
    targetSigRow.append(targetSigInput);

    sigGrid.append(sourceSigRow, targetSigRow);
    form.append(sigGrid);

    // Wormhole Code selector
    const codeRow = make('div', '', 'wh-form-row');
    codeRow.append(make('label', 'Wormhole Code / Type:'));
    const codeSelect = document.createElement('select');
    codeSelect.className = 'wh-input';
    codeSelect.add(new Option('-- None / Unknown (WH) --', ''));
    for (const code of Object.keys(WORMHOLE_CODES)) {
      const spec = WORMHOLE_CODES[code];
      const opt = new Option(`${code} (${spec.targetSpace}${spec.maxJumpMassTons > 0 ? `, ${(spec.maxJumpMassTons / 1000).toFixed(0)}kt jump` : ''})`, code);
      if (link.whCode === code) opt.selected = true;
      codeSelect.add(opt);
    }
    if (link.whCode && !WORMHOLE_CODES[link.whCode]) {
      const opt = new Option(link.whCode, link.whCode);
      opt.selected = true;
      codeSelect.add(opt);
    }
    codeRow.append(codeSelect);
    form.append(codeRow);

    // Return Code selector for K162 links
    const retRow = make('div', '', 'wh-form-row');
    retRow.append(make('label', 'Return Path Code (for K162 mass limits):'));
    const retSelect = document.createElement('select');
    retSelect.id = 'wh-edit-return-code';
    retSelect.className = 'wh-input';
    retSelect.add(new Option('-- None / Unknown Return Code --', ''));
    for (const codeKey of Object.keys(WORMHOLE_CODES)) {
      if (codeKey === 'K162') continue;
      const spec = WORMHOLE_CODES[codeKey];
      const opt = new Option(`${codeKey} (${spec.targetSpace}, ${(spec.maxMassTons / 1000).toFixed(0)}M kg)`, codeKey);
      if (link.returnWhCode === codeKey) opt.selected = true;
      retSelect.add(opt);
    }
    retRow.append(retSelect);
    form.append(retRow);

    // Mass Status toggles
    const massRow = make('div', '', 'wh-form-row');
    massRow.append(make('label', 'Mass Status:'));
    const massGroup = make('div', '', 'wh-btn-toggle-group');
    let currentMass: 'stable' | 'half' | 'critical' = link.massStatus || 'stable';
    const massBtns: Record<string, HTMLButtonElement> = {};
    const massOpts: Array<{ key: 'stable' | 'half' | 'critical'; label: string; cls?: string }> = [
      { key: 'stable', label: 'Stable (>50%)' },
      { key: 'half', label: 'Verging / Half (<50%)', cls: 'wh-toggle-half' },
      { key: 'critical', label: 'Critical (<10%)', cls: 'wh-toggle-crit' }
    ];
    for (const opt of massOpts) {
      const b = make('button', opt.label, `wh-btn-toggle ${currentMass === opt.key ? `active ${opt.cls || ''}` : ''}`);
      b.onclick = () => {
        currentMass = opt.key;
        for (const [k, btnEl] of Object.entries(massBtns)) {
          btnEl.className = `wh-btn-toggle ${k === currentMass ? `active ${massOpts.find(o => o.key === k)?.cls || ''}` : ''}`;
        }
      };
      massBtns[opt.key] = b;
      massGroup.append(b);
    }
    massRow.append(massGroup);
    form.append(massRow);

    // Life Status toggles
    const lifeRow = make('div', '', 'wh-form-row');
    lifeRow.append(make('label', 'Lifetime Status:'));
    const lifeGroup = make('div', '', 'wh-btn-toggle-group');
    let currentLife: 'stable' | 'eol' = link.lifetimeStatus || 'stable';
    const lifeBtns: Record<string, HTMLButtonElement> = {};
    const lifeOpts: Array<{ key: 'stable' | 'eol'; label: string; cls?: string }> = [
      { key: 'stable', label: 'Life OK (>4h)' },
      { key: 'eol', label: 'EOL (<4h Remaining)', cls: 'wh-toggle-eol' }
    ];
    for (const opt of lifeOpts) {
      const b = make('button', opt.label, `wh-btn-toggle ${currentLife === opt.key ? `active ${opt.cls || ''}` : ''}`);
      b.onclick = () => {
        currentLife = opt.key;
        for (const [k, btnEl] of Object.entries(lifeBtns)) {
          btnEl.className = `wh-btn-toggle ${k === currentLife ? `active ${lifeOpts.find(o => o.key === k)?.cls || ''}` : ''}`;
        }
      };
      lifeBtns[opt.key] = b;
      lifeGroup.append(b);
    }
    lifeRow.append(lifeGroup);
    form.append(lifeRow);

    // Remaining Hours Field
    const hoursRow = make('div', '', 'wh-form-row');
    hoursRow.append(make('label', 'Remaining Lifetime (Hours):'));
    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.className = 'wh-input';
    hoursInput.placeholder = 'e.g. 16, 12, or 2 (<=4 flags as EOL)';
    hoursInput.value = link.remainingHours !== undefined ? String(link.remainingHours) : '';
    hoursInput.oninput = () => {
      const h = parseFloat(hoursInput.value);
      if (!isNaN(h)) {
        currentLife = h <= 4 ? 'eol' : 'stable';
        for (const [k, btnEl] of Object.entries(lifeBtns)) {
          btnEl.className = `wh-btn-toggle ${k === currentLife ? `active ${lifeOpts.find(o => o.key === k)?.cls || ''}` : ''}`;
        }
      }
    };
    hoursRow.append(hoursInput);
    form.append(hoursRow);

    // Ship Size Allowance
    const sizeRow = make('div', '', 'wh-form-row');
    sizeRow.append(make('label', 'Maximum Ship Size:'));
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'wh-input';
    const sizeOptions = [
      { key: '', label: '-- Standard (Up to Battleships) --' },
      { key: 'frigate', label: 'Very Small (Frigates & Destroyers only)' },
      { key: 'cruiser', label: 'Medium (Cruisers & Battlecruisers)' },
      { key: 'battleship', label: 'Large (Battleships, Orcas, Heavy Interdictors)' },
      { key: 'capital', label: 'Very Large (Freighters & Capitals)' },
    ];
    for (const s of sizeOptions) {
      const opt = new Option(s.label, s.key);
      if (link.shipSize === s.key) opt.selected = true;
      sizeSelect.add(opt);
    }
    sizeRow.append(sizeSelect);
    form.append(sizeRow);

    // Frigate Hole Checkbox
    const frigRow = make('div', '', 'wh-form-row');
    const frigLabel = make('label', '', 'wh-form-checkbox-label');
    frigLabel.style.display = 'flex';
    frigLabel.style.alignItems = 'center';
    frigLabel.style.gap = '8px';
    frigLabel.style.cursor = 'pointer';
    const frigCb = document.createElement('input');
    frigCb.type = 'checkbox';
    frigCb.checked = Boolean(link.isFrigateOnly || isFrigateHole(link.whCode, link.shipSize));
    frigLabel.append(frigCb, document.createTextNode(' Frigate Hole Only (Small size restriction, max 5,000t jump mass)'));
    frigRow.append(frigLabel);
    form.append(frigRow);

    codeSelect.onchange = () => {
      if (isFrigateHole(codeSelect.value)) {
        frigCb.checked = true;
        sizeSelect.value = 'frigate';
      }
    };

    // Connection Notes
    const notesRow = make('div', '', 'wh-form-row');
    notesRow.append(make('label', 'Connection Notes:'));
    const notesInput = document.createElement('input');
    notesInput.className = 'wh-input';
    notesInput.placeholder = 'e.g. Bubbled on out gate, camp reported, rolled 2 passes';
    notesInput.value = link.notes || '';
    notesRow.append(notesInput);
    form.append(notesRow);

    // Check EVE-Scout auto-fill
    const eveScoutRow = make('div', '', 'wh-form-row');
    const scoutMatchBtn = make('button', ' Check & Auto-fill from EVE-Scout', 'map-btn map-btn-xs map-btn-secondary');
    scoutMatchBtn.onclick = async () => {
      scoutMatchBtn.disabled = true;
      scoutMatchBtn.textContent = 'Searching EVE-Scout...';
      const sigs = await this.fetchScoutSignatures(true);
      const sName = sourceNode.systemName.toLowerCase();
      const tName = targetNode.systemName.toLowerCase();
      const match = sigs.find(s =>
        ((s.out_system_name || '').toLowerCase() === sName && (s.in_system_name || '').toLowerCase() === tName) ||
        ((s.in_system_name || '').toLowerCase() === sName && (s.out_system_name || '').toLowerCase() === tName)
      );
      if (match) {
        const isOut = (match.out_system_name || '').toLowerCase() === sName;
        sourceSigInput.value = (isOut ? match.out_signature : match.in_signature) || sourceSigInput.value;
        targetSigInput.value = (isOut ? match.in_signature : match.out_signature) || targetSigInput.value;
        if (match.wh_type && match.wh_type !== 'WH') {
          codeSelect.value = match.wh_type;
        }
        const remHours = match.remaining_hours !== undefined ? Number(match.remaining_hours) : undefined;
        if (remHours !== undefined) {
          hoursInput.value = String(remHours);
          currentLife = remHours <= 4 ? 'eol' : 'stable';
          for (const [k, btnEl] of Object.entries(lifeBtns)) {
            btnEl.className = `wh-btn-toggle ${k === currentLife ? `active ${lifeOpts.find(o => o.key === k)?.cls || ''}` : ''}`;
          }
        }
        const isFrig = isFrigateHole(match.wh_type, match.max_ship_size);
        if (isFrig) {
          frigCb.checked = true;
          sizeSelect.value = 'frigate';
        }
        scoutMatchBtn.textContent = ' Filled from EVE-Scout!';
        scoutMatchBtn.style.color = '#34d399';
      } else {
        scoutMatchBtn.textContent = 'No matching EVE-Scout pair found';
        scoutMatchBtn.style.color = '#f87171';
        setTimeout(() => {
          scoutMatchBtn.disabled = false;
          scoutMatchBtn.textContent = ' Check & Auto-fill from EVE-Scout';
          scoutMatchBtn.style.color = '';
        }, 2500);
      }
    };
    eveScoutRow.append(scoutMatchBtn);
    form.append(eveScoutRow);

    box.append(form);

    // Actions
    const actionsRow = make('div', '', 'wh-modal-actions');
    const saveBtn = make('button', 'Save Changes', 'map-btn');
    saveBtn.onclick = () => {
      link.sourceSig = sourceSigInput.value.trim() || undefined;
      link.targetSig = targetSigInput.value.trim() || undefined;
      link.whCode = codeSelect.value || undefined;
      const retCodeSelect = modal.querySelector('#wh-edit-return-code') as HTMLSelectElement | null;
      if (retCodeSelect && retCodeSelect.value) {
        link.returnWhCode = retCodeSelect.value;
      } else if (retCodeSelect) {
        delete link.returnWhCode;
      }
      link.massStatus = currentMass;
      const hoursVal = hoursInput.value.trim() ? parseFloat(hoursInput.value) : undefined;
      link.remainingHours = hoursVal;
      if (hoursVal !== undefined && hoursVal <= 4) {
        currentLife = 'eol';
      }
      link.lifetimeStatus = currentLife;
      link.isFrigateOnly = frigCb.checked;
      link.shipSize = sizeSelect.value || undefined;
      link.notes = notesInput.value.trim() || undefined;
      this.recalculateLinkMass(link);
      this.saveToStorage();
      this.render();
      modal.remove();
      this.showWaypointToast(` Updated connection: ${sourceNode.systemName} ⇄ ${targetNode.systemName}`);
    };

    const delBtn = make('button', 'Delete Connection', 'map-btn map-btn-danger');
    delBtn.onclick = async () => {
      if (await this.confirmAction('Delete this connection?')) {
        this.links = this.links.filter(link => link.id !== linkId);
        this.saveToStorage(); this.render(); modal.remove();
        this.showWaypointToast('Connection removed');
      }
    };

    const cancelBtn = make('button', 'Cancel', 'map-btn map-btn-secondary');
    cancelBtn.onclick = () => modal.remove();

    actionsRow.append(saveBtn, delBtn, cancelBtn);
    box.append(actionsRow);
    modal.append(box);
    document.body.append(modal);
  }

  public async updateConnectionsFromEveScout(targetSystemId?: number): Promise<number> {
    this.showWaypointToast(' Fetching latest EVE-Scout signatures...');
    const sigs = await this.fetchScoutSignatures(true);
    if (!Array.isArray(sigs) || sigs.length === 0) {
      this.showWaypointToast('Failed to fetch EVE-Scout data', true);
      return 0;
    }

    let updatedCount = 0;
    for (const link of this.links) {
      const srcNode = this.nodes.get(link.sourceId);
      const tgtNode = this.nodes.get(link.targetId);
      if (!srcNode || !tgtNode) continue;

      if (targetSystemId && link.sourceId !== targetSystemId && link.targetId !== targetSystemId) {
        continue;
      }

      const sName = srcNode.systemName.toLowerCase();
      const tName = tgtNode.systemName.toLowerCase();

      const match = sigs.find(s =>
        ((s.out_system_name || '').toLowerCase() === sName && (s.in_system_name || '').toLowerCase() === tName) ||
        ((s.in_system_name || '').toLowerCase() === sName && (s.out_system_name || '').toLowerCase() === tName)
      );

      if (match) {
        const isOut = (match.out_system_name || '').toLowerCase() === sName;
        const newSrcSig = (isOut ? match.out_signature : match.in_signature);
        const newTgtSig = (isOut ? match.in_signature : match.out_signature);
        const newCode = match.wh_type && match.wh_type !== 'WH' ? match.wh_type : link.whCode;
        const remHours = match.remaining_hours !== undefined ? Number(match.remaining_hours) : undefined;
        const isEol = (remHours !== undefined && remHours <= 4);
        const isFrig = isFrigateHole(match.wh_type, match.max_ship_size);

        if (newSrcSig && newSrcSig !== '???') link.sourceSig = newSrcSig;
        if (newTgtSig && newTgtSig !== '???') link.targetSig = newTgtSig;
        if (newCode) link.whCode = newCode;
        if (remHours !== undefined) {
          link.remainingHours = remHours;
          link.lifetimeStatus = isEol ? 'eol' : 'stable';
        }
        if (match.expires_at) link.expiresAt = new Date(match.expires_at).getTime();
        if (isFrig) link.isFrigateOnly = true;
        if (match.max_ship_size) link.shipSize = match.max_ship_size;
        updatedCount++;
      }
    }

    this.saveToStorage();
    this.render();

    if (updatedCount > 0) {
      this.showWaypointToast(` Updated ${updatedCount} connection${updatedCount > 1 ? 's' : ''} from EVE-Scout!`);
    } else {
      this.showWaypointToast('No matching connections needed updates from EVE-Scout.');
    }
    return updatedCount;
  }

  public addWormholeConnection(
    sourceId: number,
    targetId: number,
    targetName: string,
    targetClass: string,
    code?: string,
    sourceSig?: string,
    targetSig?: string,
    scoutedBy?: string,
    opts?: {
      isFrigateOnly?: boolean;
      remainingHours?: number;
      expiresAt?: number;
      lifetimeStatus?: 'stable' | 'eol';
      shipSize?: string;
    }
  ) {
    if (!this.nodes.has(targetId)) {
      const parentNode = this.nodes.get(sourceId);
      const parentDepth = parentNode?.depth ?? 0;
      const staticsInfo = getSystemStatics(targetName) || getSystemStatics(targetId);
      const sysInfo = universeGraph.getSystemInfo(targetId) || universeGraph.getSystemInfo(targetName);
      const noteRec = getStoredSystemNote(targetId) || getStoredSystemNote(targetName);

      let sec = sysInfo?.security;
      if (sec === undefined) {
        if (targetId >= 31000000 && targetId < 32000000) sec = -0.99;
        else if (targetClass.toLowerCase().includes('high')) sec = 0.8;
        else if (targetClass.toLowerCase().includes('low')) sec = 0.3;
        else if (targetClass.toLowerCase().includes('null')) sec = -0.2;
      }
      const effect = noteRec?.effect || staticsInfo?.effect;
      const customNotes = noteRec?.notes;

      const existingChildren = this.links.filter(l => l.sourceId === sourceId).length;
      const nx = (parentNode?.x ?? 100) + 290;
      const ny = (parentNode?.y ?? 180) + existingChildren * 150;

      this.nodes.set(targetId, {
        systemId: targetId,
        systemName: targetName,
        whClass: staticsInfo ? staticsInfo.whClass : (sysInfo ? getWormholeClass(targetId, sec) : targetClass),
        security: sec,
        effect,
        statics: staticsInfo?.statics,
        customNotes,
        depth: parentDepth + 1,
        parentId: sourceId,
        x: nx,
        y: ny,
        scoutedBy
      });
    }

    const linkId = `${sourceId}-${targetId}`;
    if (!this.links.some(l => l.id === linkId)) {
      const remHours = opts?.remainingHours;
      const isEol = opts?.lifetimeStatus === 'eol' || (remHours !== undefined && remHours <= 4);
      const isFrig = Boolean(opts?.isFrigateOnly || isFrigateHole(code, opts?.shipSize));
      this.links.push({
        id: linkId,
        sourceId,
        targetId,
        sourceSig,
        targetSig,
        whCode: code,
        massStatus: 'stable',
        lifetimeStatus: isEol ? 'eol' : 'stable',
        remainingHours: remHours,
        expiresAt: opts?.expiresAt,
        isFrigateOnly: isFrig,
        shipSize: opts?.shipSize
      });
    }

    this.selectedSystemId = targetId;
    this.saveToStorage();
    this.render();
  }

  public toggleTargetSignature(systemId: number, sigId: string) {
    if (this.targetedSignature && this.targetedSignature.systemId === systemId && this.targetedSignature.sigId === sigId) {
      this.targetedSignature = null;
      this.notifyTargetedSigChange();
    } else {
      const node = this.nodes.get(systemId);
      const statics = node?.statics || getSystemStatics(systemId)?.statics || [];
      const existingLink = this.links.find(l => l.sourceSig === sigId || l.targetSig === sigId || (this.signatures.get(systemId) || []).find(s => s.id === sigId)?.linkedLinkId === l.id);

      let defaultSpace = 'NS';
      let defaultCode = '';
      let isStatic = false;

      if (existingLink) {
        if (existingLink.returnWhCode) {
          defaultCode = existingLink.returnWhCode;
        } else if (existingLink.whCode) {
          defaultCode = existingLink.whCode;
        }
        if (defaultCode) {
          isStatic = statics.includes(defaultCode.toUpperCase());
          defaultSpace = deriveSpaceTypeFromWhSpec(defaultCode);
        }
      } else if (statics.length > 0) {
        const first = statics[0].toUpperCase();
        defaultCode = first;
        isStatic = true;
        defaultSpace = deriveSpaceTypeFromWhSpec(first);
      }

      this.targetedSignature = {
        systemId,
        sigId,
        spaceType: defaultSpace,
        isStatic,
        isEol: false,
        isCrit: false,
        isFrig: isFrigateHole(defaultCode),
        whCode: defaultCode
      };
      this.notifyTargetedSigChange();
      this.showWaypointToast(`Targeted ${sigId} for in-game warp & pre-jump tagging`);
    }
    this.renderChainContentOnly();
  }

  private syncTargetSignatureToLink(systemId: number, tgt: { sigId: string; whCode?: string; isStatic: boolean; spaceType: string; isEol: boolean; isCrit: boolean; isFrig: boolean }) {
    this.notifyTargetedSigChange();
    const existingLink = this.links.find(l => l.sourceSig === tgt.sigId || l.targetSig === tgt.sigId || (this.signatures.get(systemId) || []).find(s => s.id === tgt.sigId)?.linkedLinkId === l.id);
    if (!existingLink) return;

    if (tgt.whCode && tgt.whCode !== 'K162') {
      if (existingLink.whCode === 'K162' || !existingLink.whCode) {
        existingLink.returnWhCode = tgt.whCode;
      } else {
        existingLink.whCode = tgt.whCode;
      }
    } else if (tgt.whCode === 'K162') {
      existingLink.whCode = 'K162';
    }
    if (tgt.isEol) existingLink.lifetimeStatus = 'eol';
    if (tgt.isCrit) existingLink.massStatus = 'critical';
    if (tgt.isFrig) existingLink.isFrigateOnly = true;
    this.recalculateLinkMass(existingLink);
  }

  private renderFloatingWormholeSigs(node: WormholeNode, container: HTMLElement) {
    const sigs = this.signatures.get(node.systemId) || [];
    const isWormhole = (s: ScannedSignature) =>
      (s.group || '').toLowerCase() === 'wormhole' ||
      (s.name || '').toLowerCase().includes('wormhole') ||
      Boolean(s.linkedLinkId) ||
      Boolean(this.links.some(l => l.sourceSig === s.id || l.targetSig === s.id)) ||
      Boolean(this.targetedSignature?.systemId === node.systemId && this.targetedSignature?.sigId === s.id);

    const whSigs = sigs.filter(isWormhole);
    const candidateSigs = sigs.filter(s => !isWormhole(s) && (s.group === 'Unknown' || (s.name || '').toLowerCase().includes('cosmic signature')));

    if (whSigs.length === 0 && candidateSigs.length === 0) return;

    const whTagsContainer = make('div', '', 'wh-floating-sigs-container');
    const labelText = whSigs.length > 0 ? 'Wormhole Signatures:' : 'Cosmic Signatures:';
    whTagsContainer.append(make('span', labelText, 'wh-floating-sigs-label'));

    // 1. Identified or linked wormhole signatures
    for (const s of whSigs) {
      const isTargeted = this.targetedSignature?.systemId === node.systemId && this.targetedSignature?.sigId === s.id;
      const isLinked = Boolean(s.linkedLinkId || this.links.some(l => l.sourceSig === s.id || l.targetSig === s.id));

      const sigTag = make('button', '', `wh-floating-sig-tag ${isTargeted ? 'targeted' : ''} ${isLinked ? 'linked' : ''}`) as HTMLButtonElement;
      sigTag.type = 'button';
      sigTag.title = isTargeted
        ? `Targeted: ${s.id} (Warp in-game, tag before jump)`
        : isLinked
        ? `Linked: ${s.id}`
        : `Click to target ${s.id} for in-game warp & pre-jump tagging`;

      const tagIcon = getLucideSvg(isTargeted ? 'radio' : 'compass', { size: 12 });
      sigTag.innerHTML = `${tagIcon} <strong>${escapeDaytripperText(s.id)}</strong>${s.name && s.name !== 'Cosmic Signature' && s.name !== 'Unstable Wormhole' ? ` <span class="wh-sig-mini-name">${escapeDaytripperText(s.name)}</span>` : ''}`;

      sigTag.onclick = (e) => {
        e.stopPropagation();
        this.selectedSystemId = node.systemId;
        this.toggleTargetSignature(node.systemId, s.id);
      };

      whTagsContainer.append(sigTag);
    }

    // 2. Unresolved candidate cosmic signatures
    for (const s of candidateSigs) {
      const isTargeted = this.targetedSignature?.systemId === node.systemId && this.targetedSignature?.sigId === s.id;
      const sigTag = make('button', '', `wh-floating-sig-tag ${isTargeted ? 'targeted' : ''}`) as HTMLButtonElement;
      sigTag.type = 'button';
      sigTag.title = isTargeted
        ? `Targeted candidate: ${s.id}`
        : `Cosmic Signature ${s.id}. Click to target for warp & tag connection.`;

      const tagIcon = getLucideSvg(isTargeted ? 'radio' : 'search', { size: 12 });
      sigTag.innerHTML = `${tagIcon} <strong>${escapeDaytripperText(s.id)}</strong> <span class="wh-sig-mini-name">Cosmic</span>`;

      sigTag.onclick = (e) => {
        e.stopPropagation();
        this.selectedSystemId = node.systemId;
        this.toggleTargetSignature(node.systemId, s.id);
      };

      whTagsContainer.append(sigTag);
    }

    container.append(whTagsContainer);
    this.renderPrejumpBar(node, container);
  }

  private renderPrejumpBar(node: WormholeNode, container: HTMLElement) {
    if (!this.targetedSignature || this.targetedSignature.systemId !== node.systemId) return;
    const tgt = this.targetedSignature;

    const bar = make('div', '', 'wh-prejump-bar');

    const titleRow = make('div', '', 'wh-prejump-title');
    const titleLeft = make('span', `Target: ${tgt.sigId} Pre-Jump Connection Lock`, '');
    const resetFlowBtn = make('button', 'Reset Flow', 'map-btn map-btn-xs');
    resetFlowBtn.title = 'Reset bookmark sequence and clear exploration flow';
    resetFlowBtn.onclick = (e) => {
      e.stopPropagation();
      this.resetBookmarkFlow(true);
    };
    const closeBtn = make('button', 'Clear Target', 'map-btn map-btn-xs');
    closeBtn.title = 'Clear targeted signature';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.targetedSignature = null;
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    titleRow.append(titleLeft, resetFlowBtn, closeBtn);
    bar.append(titleRow);

    // Ensure datalist for wandering codes exists in DOM
    let datalistEl = document.getElementById('wh-wandering-codes-list') as HTMLDataListElement | null;
    if (!datalistEl) {
      datalistEl = document.createElement('datalist');
      datalistEl.id = 'wh-wandering-codes-list';
      for (const [codeKey, sp] of Object.entries(WORMHOLE_CODES)) {
        if (codeKey === 'K162') continue;
        const opt = document.createElement('option');
        opt.value = codeKey;
        const cap = sp.maxMassTons >= 100000 ? `${Math.round(sp.maxMassTons / 1000)}M kg` : `${sp.maxMassTons}t`;
        opt.label = `${codeKey} -> ${sp.targetSpace} (${cap})`;
        datalistEl.append(opt);
      }
      document.body.append(datalistEl);
    }

    // Row 1: Wormhole Code Selection (System Statics, K162, Wandering Selector)
    const codeChips = make('div', '', 'wh-prejump-chips');
    const statics = node.statics || getSystemStatics(node.systemId)?.statics || [];

    // 1. Static buttons
    if (statics.length > 0) {
      for (const sc of statics) {
        const spec = WORMHOLE_CODES[sc.toUpperCase()];
        const isSel = tgt.whCode === sc;
        const label = `Static ${sc}${spec ? ` (${spec.targetSpace})` : ''}`;
        const scBtn = make('button', label, `wh-prejump-chip ${isSel ? 'active' : ''}`) as HTMLButtonElement;
        scBtn.type = 'button';
        scBtn.title = `Select static ${sc} (dest: ${spec?.targetSpace || 'W-Space'}, mass: ${spec ? (spec.maxMassTons/1000).toFixed(0) : 2000}M kg)`;
        scBtn.onclick = (e) => {
          e.stopPropagation();
          tgt.whCode = sc;
          tgt.isStatic = true;
          if (spec) {
            tgt.spaceType = deriveSpaceTypeFromWhSpec(spec);
            tgt.isFrig = Boolean(spec.maxJumpMassTons <= 5000);
          }
          this.syncTargetSignatureToLink(node.systemId, tgt);
          this.notifyTargetedSigChange();
          this.renderChainContentOnly();
        };
        codeChips.append(scBtn);
      }
    }

    // 2. K162 Incoming button
    const isK162 = tgt.whCode === 'K162';
    const k162Btn = make('button', 'K162 (Incoming)', `wh-prejump-chip ${isK162 ? 'active' : ''}`) as HTMLButtonElement;
    k162Btn.type = 'button';
    k162Btn.title = 'Incoming K162 connection (mass limits updated once return path is identified)';
    k162Btn.onclick = (e) => {
      e.stopPropagation();
      tgt.whCode = 'K162';
      tgt.isStatic = false;
      tgt.spaceType = 'K162';
      this.syncTargetSignatureToLink(node.systemId, tgt);
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    codeChips.append(k162Btn);

    // 3. Wandering Code Input with datalist autocomplete
    const wanderingWrapper = make('div', '', 'wh-prejump-code-input-wrapper');
    const codeInput = document.createElement('input');
    codeInput.className = 'wh-prejump-code-input';
    codeInput.setAttribute('list', 'wh-wandering-codes-list');
    codeInput.placeholder = 'Wandering Code (e.g. A982)...';
    codeInput.value = (!isK162 && !statics.includes(tgt.whCode || '')) ? (tgt.whCode || '') : '';
    codeInput.title = 'Select or type any non-static wandering wormhole code';
    codeInput.onchange = () => {
      const val = codeInput.value.trim().toUpperCase();
      if (!val) return;
      const spec = WORMHOLE_CODES[val];
      tgt.whCode = val;
      tgt.isStatic = statics.includes(val);
      if (spec) {
        tgt.spaceType = deriveSpaceTypeFromWhSpec(spec);
        tgt.isFrig = Boolean(spec.maxJumpMassTons <= 5000);
      }
      this.syncTargetSignatureToLink(node.systemId, tgt);
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    wanderingWrapper.append(codeInput);
    codeChips.append(wanderingWrapper);

    // 4. Live Spec Pill (Target space + Mass capacity)
    const activeSpec = tgt.whCode ? WORMHOLE_CODES[tgt.whCode.toUpperCase()] : null;
    let specSummaryText = '';
    if (tgt.whCode === 'K162') {
      specSummaryText = 'K162 Incoming: Mass unknown until return path';
    } else if (activeSpec) {
      const capMkg = activeSpec.maxMassTons >= 100_000 ? Math.round(activeSpec.maxMassTons / 1000) : activeSpec.maxMassTons;
      const jumpMkg = activeSpec.maxJumpMassTons >= 1000 ? Math.round(activeSpec.maxJumpMassTons / 1000) : activeSpec.maxJumpMassTons;
      specSummaryText = `${activeSpec.targetSpace} | Cap: ${capMkg.toLocaleString()}M kg | Jump: ${jumpMkg.toLocaleString()}M kg`;
    }
    if (specSummaryText) {
      const specBadge = make('span', specSummaryText, 'wh-prejump-spec-badge');
      codeChips.append(specBadge);
    }
    bar.append(codeChips);

    // Row 2: Nature & Status Modifiers Chips
    const modChips = make('div', '', 'wh-prejump-chips');

    const staticChip = make('button', tgt.isStatic ? 'Static (s)' : 'Wandering (w)', `wh-prejump-chip ${tgt.isStatic ? 'active' : ''}`) as HTMLButtonElement;
    staticChip.type = 'button';
    staticChip.title = 'Toggle Static (s) vs Wandering/K162 (w)';
    staticChip.onclick = (e) => {
      e.stopPropagation();
      tgt.isStatic = !tgt.isStatic;
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    modChips.append(staticChip);

    const eolChip = make('button', 'EOL', `wh-prejump-chip ${tgt.isEol ? 'active' : ''}`) as HTMLButtonElement;
    eolChip.type = 'button';
    eolChip.title = 'Toggle End of Life (<4 hours)';
    eolChip.onclick = (e) => {
      e.stopPropagation();
      tgt.isEol = !tgt.isEol;
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    modChips.append(eolChip);

    const critChip = make('button', 'Crit Mass', `wh-prejump-chip ${tgt.isCrit ? 'active' : ''}`) as HTMLButtonElement;
    critChip.type = 'button';
    critChip.title = 'Toggle Mass Critical (<10% mass)';
    critChip.onclick = (e) => {
      e.stopPropagation();
      tgt.isCrit = !tgt.isCrit;
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    modChips.append(critChip);

    const frigChip = make('button', 'Frig Hole', `wh-prejump-chip ${tgt.isFrig ? 'active' : ''}`) as HTMLButtonElement;
    frigChip.type = 'button';
    frigChip.title = 'Toggle Frigate / small ship size restriction';
    frigChip.onclick = (e) => {
      e.stopPropagation();
      tgt.isFrig = !tgt.isFrig;
      this.notifyTargetedSigChange();
      this.renderChainContentOnly();
    };
    modChips.append(frigChip);

    // Optional manual destination space fallback dropdown if no code is identified
    if (!tgt.whCode) {
      const spaceSelect = document.createElement('select');
      spaceSelect.className = 'wh-input wh-input-xs';
      spaceSelect.style.width = '110px';
      spaceSelect.style.height = '20px';
      spaceSelect.style.fontSize = '10px';
      spaceSelect.add(new Option('-- Manual Dest --', ''));
      const fallbackSpaces = ['NS', 'HS', 'LS', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'TH', 'TU', 'PO'];
      for (const st of fallbackSpaces) {
        const opt = new Option(st, st);
        if (tgt.spaceType === st) opt.selected = true;
        spaceSelect.add(opt);
      }
      spaceSelect.onchange = () => {
        if (spaceSelect.value) {
          tgt.spaceType = spaceSelect.value;
          this.notifyTargetedSigChange();
          this.renderChainContentOnly();
        }
      };
      modChips.append(spaceSelect);
    }

    bar.append(modChips);

    // Row 3: Live Bookmark Preview
    const previewStr = generateWormholeBookmark({
      sigId: tgt.sigId,
      targetSpaceType: tgt.spaceType,
      isStatic: tgt.isStatic,
      targetSystemName: '[Destination]',
      targetSecurity: tgt.spaceType === 'NS' ? -0.9 : tgt.spaceType === 'HS' ? 0.7 : tgt.spaceType === 'LS' ? 0.3 : undefined,
      whCode: tgt.whCode,
      isEol: tgt.isEol,
      isCrit: tgt.isCrit,
      isFrigate: tgt.isFrig
    });

    const previewRow = make('div', '', 'wh-prejump-preview');
    const previewText = make('span', previewStr, '');
    const copyPreviewBtn = make('button', 'Copy', 'map-btn map-btn-xs');
    copyPreviewBtn.title = 'Copy outward destination bookmark preview';
    copyPreviewBtn.onclick = (e) => {
      e.stopPropagation();
      void copyToClipboard(previewStr);
      this.showWaypointToast(`Copied preview: "${previewStr}"`);
    };

    const copyBtBtn = make('button', 'Copy BT', 'map-btn map-btn-xs');
    copyBtBtn.title = 'Copy return breadcrumb bookmark (BT) for this wormhole';
    copyBtBtn.onclick = (e) => {
      e.stopPropagation();
      const fromName = node.systemName || 'Home';
      const btStr = `BT ${tgt.sigId} ${fromName}`;
      void copyToClipboard(btStr);
      this.latestBookmark = {
        text: btStr,
        timestamp: Date.now(),
        accessGrant: this.backendGrant,
        type: 'breadcrumb',
        fromSystem: fromName,
        toSystem: '[Destination]',
        sigId: tgt.sigId,
        parsedSummary: `Return Breadcrumb -> ${fromName}`
      };
      try { localStorage.setItem('wok.daytripperLatestBookmark', JSON.stringify(this.latestBookmark)); } catch {}
      this.notifyLatestBookmarkChange();
      this.updateHeaderBookmarkButton();
      this.showWaypointToast(`Copied return bookmark: "${btStr}"`);
    };

    previewRow.append(previewText, copyPreviewBtn, copyBtBtn);
    bar.append(previewRow);

    container.append(bar);
  }

  public autoArrangeNodes() {
    const cur = this.maps.find(m => m.id === this.activeMapId);

    // Hub-and-Spoke Auto-Arranger for Thera and Turnur (always centers hub, spokes connections radially outward)
    const hubNode = [...this.nodes.values()].find(n =>
      n.systemId === 31000005 || n.systemId === 30002086 ||
      n.systemName.toLowerCase() === 'thera' || n.systemName.toLowerCase() === 'turnur'
    );

    if (hubNode) {
      const hubId = hubNode.systemId;
      const cx = 700;
      const cy = 500;

      // 1. Center Thera / Turnur
      hubNode.x = cx - 120;
      hubNode.y = cy - 40;

      const visited = new Set<number>([hubId]);

      // 2. Find direct spoke connections (sourceId or targetId)
      const directLinks = this.links.filter(l => l.sourceId === hubId || l.targetId === hubId);
      const spokeIds: number[] = [];
      for (const l of directLinks) {
        const otherId = l.sourceId === hubId ? l.targetId : l.sourceId;
        if (otherId !== hubId && this.nodes.has(otherId) && !spokeIds.includes(otherId)) {
          spokeIds.push(otherId);
        }
      }

      const N = spokeIds.length;
      // Radial radius scaled to spoke count so cards do not overlap
      const R = Math.max(380, N * 48);

      for (let i = 0; i < N; i++) {
        const spokeId = spokeIds[i];
        visited.add(spokeId);
        const node = this.nodes.get(spokeId)!;
        const angle = (2 * Math.PI * i) / N - Math.PI / 2; // Start from top (12 o'clock)

        node.x = Math.round(cx + R * Math.cos(angle) - 120);
        node.y = Math.round(cy + R * Math.sin(angle) - 40);

        // 3. Sub-branches (deeper nodes connected off this spoke)
        const queue: Array<{ id: number; level: number; angle: number }> = [];
        for (const l of this.links) {
          const childId = l.sourceId === spokeId ? l.targetId : (l.targetId === spokeId ? l.sourceId : null);
          if (childId && !visited.has(childId) && this.nodes.has(childId)) {
            queue.push({ id: childId, level: 1, angle });
          }
        }

        let subIdx = 0;
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (visited.has(item.id)) continue;
          visited.add(item.id);

          const childNode = this.nodes.get(item.id);
          if (!childNode) continue;

          // Extend radially outward along spoke ray
          const subR = R + item.level * 280;
          const fanAngle = item.angle + (subIdx % 2 === 0 ? 0.08 : -0.08) * Math.ceil(subIdx / 2);
          childNode.x = Math.round(cx + subR * Math.cos(fanAngle) - 120);
          childNode.y = Math.round(cy + subR * Math.sin(fanAngle) - 40);
          subIdx++;

          for (const l of this.links) {
            const nextId = l.sourceId === item.id ? l.targetId : (l.targetId === item.id ? l.sourceId : null);
            if (nextId && !visited.has(nextId) && this.nodes.has(nextId)) {
              queue.push({ id: nextId, level: item.level + 1, angle: fanAngle });
            }
          }
        }
      }

      // 4. Disconnected nodes in side column
      let discY = 80;
      for (const node of this.nodes.values()) {
        if (!visited.has(node.systemId)) {
          node.x = 80;
          node.y = discY;
          discY += 150;
          visited.add(node.systemId);
        }
      }

      this.pan = { x: 50, y: 50 };
      this.zoom = N > 24 ? 0.45 : N > 14 ? 0.6 : N > 8 ? 0.75 : 0.85;
      this.saveToStorage();
      this.render();
      return;
    }

    // General Tree / Graph Auto-Arranger (cycle-safe, no recursion limit or NaN errors)
    const roots = [...this.nodes.values()].filter(n => !n.parentId || !this.nodes.has(n.parentId));
    if (roots.length === 0 && this.nodes.size > 0) {
      roots.push(this.nodes.values().next().value!);
    }

    const visited = new Set<number>();
    let nextY = 80;

    const arrangeTree = (nodeId: number, x: number): number => {
      if (visited.has(nodeId)) {
        const existing = this.nodes.get(nodeId);
        return existing?.y ?? nextY;
      }
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return nextY;

      // Children without cycles
      const children = this.links
        .filter(l => l.sourceId === nodeId)
        .map(l => l.targetId)
        .filter(id => id !== nodeId && this.nodes.has(id) && !visited.has(id));

      if (children.length === 0) {
        node.x = x;
        node.y = nextY;
        nextY += 150;
        return node.y;
      }

      const childYs: number[] = [];
      for (const cid of children) {
        childYs.push(arrangeTree(cid, x + 290));
      }

      node.x = x;
      if (childYs.length > 0) {
        const minY = Math.min(...childYs);
        const maxY = Math.max(...childYs);
        node.y = isFinite(minY) && isFinite(maxY) ? (minY + maxY) / 2 : nextY;
      } else {
        node.y = nextY;
        nextY += 150;
      }
      return node.y;
    };

    for (const r of roots) {
      if (!visited.has(r.systemId)) {
        arrangeTree(r.systemId, 80);
        nextY += 70;
      }
    }

    // Catch any disconnected nodes
    for (const node of this.nodes.values()) {
      if (!visited.has(node.systemId)) {
        node.x = 80;
        node.y = nextY;
        nextY += 150;
        visited.add(node.systemId);
      }
    }

    this.pan = { x: 50, y: 50 };
    this.zoom = 1.0;
    this.saveToStorage();
    this.render();
  }

  private confirmAction(message: string): Promise<boolean> {
    if (document.querySelector('.wh-confirm-dialog')) return Promise.resolve(false);
    const mapId = this.activeMapId;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'wh-confirm-dialog';
    dialog.setAttribute('aria-label', 'Confirm map change');
    const text = make('p', message);
    const actions = make('div', '', 'wh-modal-actions');
    const cancel = make('button', 'Cancel', 'map-btn map-btn-secondary');
    const confirm = make('button', 'Confirm', 'map-btn map-btn-danger');
    actions.append(cancel, confirm); dialog.append(text, actions); document.body.append(dialog);
    return new Promise(resolve => {
      const finish = (accepted: boolean) => {
        dialog.close(); dialog.remove(); previous?.focus();
        resolve(accepted && this.activeMapId === mapId && this.container.isConnected);
      };
      cancel.onclick = () => finish(false);
      confirm.onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.showModal(); cancel.focus();
    });
  }

  private async requestRemoveNode(systemId: number) {
    const node = this.nodes.get(systemId);
    if (!node) return;
    if (this.nodes.size <= 1) { this.showWaypointToast('Keep at least one system on the map.'); return; }
    if (await this.confirmAction(`Remove ${node.systemName}, its connections and saved signatures from this map?`)) this.removeNode(systemId);
  }

  public removeNode(systemId: number) {
    if (this.nodes.size <= 1) return;

    this.nodes.delete(systemId);
    this.links = this.links.filter(l => l.sourceId !== systemId && l.targetId !== systemId);
    this.signatures.delete(systemId);

    if (this.selectedSystemId === systemId) {
      this.selectedSystemId = this.nodes.keys().next().value ?? null;
    }

    this.saveToStorage();
    this.render();
  }

  public cycleMassStatus(linkId: string) {
    const link = this.links.find(l => l.id === linkId);
    if (!link) return;
    if (link.massStatus === 'stable') link.massStatus = 'half';
    else if (link.massStatus === 'half') link.massStatus = 'critical';
    else link.massStatus = 'stable';
    this.saveToStorage();
    this.render();
  }

  public toggleLifetimeStatus(linkId: string) {
    const link = this.links.find(l => l.id === linkId);
    if (!link) return;
    link.lifetimeStatus = link.lifetimeStatus === 'stable' ? 'eol' : 'stable';
    this.saveToStorage();
    this.render();
  }

  private async resetPrimaryChain(): Promise<boolean> {
    if (this.resettingPrimary) return false;
    this.resettingPrimary = true;
    try {
      if (await this.onRefreshPilots?.() === false) {
        this.showWaypointToast('Could not refresh scanner location. Chain was not reset.', true);
        return false;
      }
      let scannerId = this.selectedScannerId;
      try { scannerId = localStorage.getItem('wok_daytripper_scanner_pilot') || scannerId; } catch {}
      const scanner = scannerId ? this.activeCharacters.find(c => String(c.id) === String(scannerId))
        : this.activeCharacters.find(c => c.isScanner);
      const at = scanner?.locationUpdatedAt;
      if (!scanner || scanner.isOnline === false || !Number.isSafeInteger(scanner.systemId) || scanner.systemId <= 0
          || typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > Date.now() || Date.now() - at >= 300_000) {
        this.showWaypointToast('Select a scanner with a fresh current location before resetting. Chain was not reset.', true);
        return false;
      }
      const page = this.maps.find(m => m.id === 'primary');
      if (!page) return false;
      this.mapResetRevisions.set(page.id, (this.mapResetRevisions.get(page.id) || 0) + 1);
      const info = universeGraph.getSystemInfo(scanner.systemId);
      page.nodes = [{systemId: scanner.systemId, systemName: scanner.systemName || info?.name || `System ${scanner.systemId}`,
        whClass: getWormholeClass(scanner.systemId, info?.security), security: info?.security, depth: 0, x: 100, y: 100}];
      page.links = []; page.signatures = [];
      page.pan = {x: 50, y: 50}; page.zoom = 1; page.viewMode = 'canvas';
      page.selectedSystemId = scanner.systemId; page.isBaseMap = false; page.resetPending = true;
      if (this.activeMapId === page.id) {
        this.nodes = new Map(page.nodes.map(n => [n.systemId, n]));
        this.links = []; this.signatures.clear();
        this.pan = {...page.pan}; this.zoom = page.zoom; this.viewMode = page.viewMode;
        this.selectedSystemId = scanner.systemId; this.selectedScoutSystem = null;
        this.targetedSignature = null; this.activeExploration = null; this.latestBookmark = null;
        this.pendingRemoteUpdate = false;
        try {
          for (const key of ['wok.daytripperTargetedSig', 'wok.daytripperActiveExploration', 'wok.daytripperLatestBookmark']) localStorage.removeItem(key);
        } catch {}
        this.notifyBookmarkFlowReset();
      }
      this.saveToStorage(false); this.render();
      if (this.activeMapId === page.id) this.panToSystem(scanner.systemId);
      await this.syncToCloud(false, page.id);
      return true;
    } finally { this.resettingPrimary = false; }
  }

  public async resetCurrentMap() {
    if (this.activeMapId === 'primary') return this.resetPrimaryChain();
    const cur = this.maps.find(m => m.id === this.activeMapId);
    const isThera = Boolean(cur?.id === 'thera-base' || cur?.name.includes('Thera') || this.nodes.has(31000005));
    const isTurnur = Boolean(cur?.id === 'turnur-base' || cur?.name.includes('Turnur') || this.nodes.has(30002086));
if (isThera) {
      const fresh = this.createHubBasePage('Thera', this.activeMapId);
      this.nodes.clear();
      for (const n of fresh.nodes) this.nodes.set(n.systemId, n);
      this.links = [...fresh.links];
      this.signatures.clear();
      this.pan = { ...fresh.pan };
      this.zoom = fresh.zoom;
      this.selectedSystemId = fresh.selectedSystemId ?? null;
      void this.syncHubLiveSignatures('Thera', true);
    } else if (isTurnur) {
      const fresh = this.createHubBasePage('Turnur', this.activeMapId);
      this.nodes.clear();
      for (const n of fresh.nodes) this.nodes.set(n.systemId, n);
      this.links = [...fresh.links];
      this.signatures.clear();
      this.pan = { ...fresh.pan };
      this.zoom = fresh.zoom;
      this.selectedSystemId = fresh.selectedSystemId ?? null;
      void this.syncHubLiveSignatures('Turnur', true);
    } else {
      this.nodes.clear();
      this.links = [];
      this.signatures.clear();
      this.initDefaultChain();
    }
    this.saveToStorage();
    this.render();
  }

  public render() {
    // Repair persisted labels too; live universe data takes precedence over old defaults.
    for (const node of this.nodes.values()) {
      const info = universeGraph.getSystemInfo(node.systemId);
      if (info && node.systemId < 31000000 && node.whClass !== 'Pochven') {
        node.security = info.security;
        node.whClass = getWormholeClass(node.systemId, info.security);
      }
    }

    this.container.replaceChildren();
    this.container.classList.add('daytripper-tabler-shell');

    // Slim toolbar — Companion TopBar already shows the module title
    const header = make('header', '', 'wh-header daytripper-page-toolbar');
    const titleGroup = make('div', '', 'wh-header-left daytripper-toolbar-left');

    if (this.onBackToMap) {
      const backBtn = make('button', 'Universe Map', 'btn btn-sm btn-ghost-secondary') as HTMLButtonElement;
      backBtn.type = 'button';
      backBtn.onclick = () => this.onBackToMap!();
      titleGroup.append(backBtn);
    }
    const daytripperIcon = createShellModuleIcon('daytripper', 'daytripper-page-title-icon');
    if (daytripperIcon) titleGroup.append(daytripperIcon);
    titleGroup.append(make('span', 'Wormhole Mapper', 'daytripper-toolbar-label'));

    this.pilotTrackerStrip = make('div', '', 'wh-pilot-live-strip');
    this.updatePilotTrackerStrip();
    titleGroup.append(this.pilotTrackerStrip);

    header.append(titleGroup);

    const btnGroup = make('div', '', 'wh-header-btns btn-list daytripper-toolbar-right');

    if (this.latestBookmark) {
      const bmBtn = make('button', '', 'btn btn-sm btn-success daytripper-header-bm-btn') as HTMLButtonElement;
      bmBtn.type = 'button';
      const bmIcon = getLucideSvg('bookmark', { size: 14 });
      const checkIcon = getLucideSvg('check', { size: 12 });
      bmBtn.innerHTML = `${bmIcon} <span class="bm-code">${escapeDaytripperText(this.latestBookmark.text)}</span> <span class="bm-copied-tag">${checkIcon} Copied</span>`;
      bmBtn.title = `Latest Bookmark: "${this.latestBookmark.text}"\nClick to re-copy to clipboard.\nOutput of Parser: ${this.latestBookmark.parsedSummary || this.latestBookmark.text}`;
      bmBtn.onclick = () => {
        void copyToClipboard(this.latestBookmark!.text);
        this.showWaypointToast(`Re-copied bookmark: "${this.latestBookmark!.text}"`);
      };
      btnGroup.append(bmBtn);
    }

    const pilotBtn = make('button', `Pilots (${this.exemptPilots.size > 0 ? `${this.exemptPilots.size} ex.` : 'Active'})`, 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
    pilotBtn.type = 'button';
    pilotBtn.title = 'Configure pilot auto-mapping exemptions and session change tracking';
    pilotBtn.onclick = () => this.showPilotExemptionModal();

    const modeBtn = make('button', this.viewMode === 'canvas' ? 'Tree' : 'Graph', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
    modeBtn.type = 'button';
    modeBtn.onclick = () => {
      this.viewMode = this.viewMode === 'canvas' ? 'tree' : 'canvas';
      this.saveToStorage();
      this.render();
    };

    const autoBtn = make('button', 'Auto', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
    autoBtn.type = 'button';
    autoBtn.onclick = () => this.autoArrangeNodes();

    const addBtn = make('button', '+ Connect', 'btn btn-sm btn-primary') as HTMLButtonElement;
    addBtn.type = 'button';
    addBtn.onclick = () => this.showAddConnectionModal();

    const isScannerAuto = localStorage.getItem('wok.daytripperAutoscan') !== '0';
    const autoScanBtn = make('button', `Auto-Scan: ${isScannerAuto ? 'ON' : 'OFF'}`, `btn btn-sm ${isScannerAuto ? 'btn-outline-success active' : 'btn-outline-secondary'}`) as HTMLButtonElement;
    autoScanBtn.type = 'button';
    autoScanBtn.title = 'Toggle Probe Scanner Auto-Scan. When ON, copying probe scanner rows in EVE automatically imports them to the active system.';
    autoScanBtn.onclick = () => {
      const next = localStorage.getItem('wok.daytripperAutoscan') === '0';
      localStorage.setItem('wok.daytripperAutoscan', next ? '1' : '0');
      configureScannerCapture(next, this.container);
      this.render();
      if (next) void this.checkScannerClipboardAutoscan();
    };

    const importBtn = make('button', 'Paste', 'btn btn-sm btn-primary') as HTMLButtonElement;
    importBtn.type = 'button';
    importBtn.onclick = () => void this.importScannerClipboard();

    const overlayBtn = make('button', 'HUD Card', 'btn btn-sm btn-outline-info') as HTMLButtonElement;
    overlayBtn.type = 'button';
    overlayBtn.title = 'Open compact floating Mapping HUD Overlay for the active scanner system (?module=mapping-overlay)';
    overlayBtn.onclick = () => {
      if (native) {
        void call('open_module', { id: 'mapping-overlay' }).catch(() => {});
      } else {
        window.open('/?module=mapping-overlay', '_blank');
      }
    };

    btnGroup.append(autoScanBtn, importBtn, overlayBtn);

    const scoutBtn = make('button', 'EVE-Scout', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
    scoutBtn.type = 'button';
    scoutBtn.onclick = () => void this.showEveScoutModal();

    const updateScoutBtn = make('button', 'Sync', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
    updateScoutBtn.type = 'button';
    updateScoutBtn.title = 'Fetch live EVE-Scout wormhole signatures and update matching connections on this map';
    updateScoutBtn.onclick = async () => {
      updateScoutBtn.disabled = true;
      updateScoutBtn.textContent = 'Syncing...';
      await this.updateConnectionsFromEveScout();
      updateScoutBtn.disabled = false;
      updateScoutBtn.textContent = 'Sync';
    };

    const cur = this.maps.find(m => m.id === this.activeMapId);
    const isThera = Boolean(cur?.id === 'thera-base' || cur?.name.includes('Thera') || this.nodes.has(31000005));
    const isTurnur = Boolean(cur?.id === 'turnur-base' || cur?.name.includes('Turnur') || this.nodes.has(30002086));
    const isHubBase = isThera || isTurnur;

    if (isHubBase) {
      const hub = isThera ? 'Thera' : 'Turnur';
      const syncBtn = make('button', 'Sync Live Sigs', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
      syncBtn.type = 'button';
      syncBtn.title = `Fetch newest live scouted connections for ${hub} from EVE-Scout`;
      syncBtn.onclick = async () => {
        syncBtn.textContent = 'Syncing...';
        await this.syncHubLiveSignatures(hub, true);
        syncBtn.textContent = 'Sync Live Sigs';
      };

      const viewToggleBtn = make('button', this.viewMode === 'scout' ? 'Canvas' : 'Grid', 'btn btn-sm btn-outline-secondary') as HTMLButtonElement;
      viewToggleBtn.type = 'button';
      viewToggleBtn.title = 'Toggle between draggable Canvas Map and static EVE-Scout Card Grid';
      viewToggleBtn.onclick = () => {
        this.viewMode = this.viewMode === 'scout' ? 'canvas' : 'scout';
        this.saveToStorage();
        this.render();
      };
      btnGroup.append(syncBtn, viewToggleBtn);
    }

    const clearBtn = make('button', 'Reset', 'btn btn-sm btn-outline-danger') as HTMLButtonElement;
    clearBtn.type = 'button';
    clearBtn.onclick = async () => { if (await this.confirmAction("Reset all systems and connections on this map?")) await this.resetCurrentMap(); };

    const popoutBtn = make('button', '', 'btn btn-sm btn-outline-secondary daytripper-popout-btn') as HTMLButtonElement;
    popoutBtn.type = 'button';
    popoutBtn.innerHTML = `${getLucideSvg('square-arrow-out-up-right', { size: 16 })}<span>Pop out</span>`;
    popoutBtn.title = 'Open Daytripper in a fullscreen window';
    popoutBtn.hidden = isStandaloneModule('daytripper');
    popoutBtn.onclick = () => { void popoutModule('daytripper').catch((error) => showToast(String(error), true)); };

    btnGroup.append(pilotBtn, modeBtn, autoBtn, addBtn, importBtn, scoutBtn, updateScoutBtn, clearBtn, popoutBtn);
    header.append(btnGroup);
    this.container.append(header);

    // Multi-map tabs — shared wok-subnav chrome
    const tabsRow = make('div', '', 'wh-tabs-row');
    const tabsList = make('div', '', 'wok-subnav wh-tabs-list');

    for (const p of this.maps) {
      const tab = make('button', '', `wok-subnav-btn wh-tab-btn${p.id === this.activeMapId ? ' active is-active' : ''}`) as HTMLButtonElement;
      tab.type = 'button';
      tab.oncontextmenu = (e) => this.showTabContextMenu(e, p.id);
      const title = make('span', p.name, 'wh-tab-name');
      title.title = 'Click to switch tab, double-click to rename, right-click for options';
      title.ondblclick = (e) => {
        e.stopPropagation();
        const newName = prompt('Enter chain page name:', p.name);
        if (newName && newName.trim()) {
          p.name = newName.trim();
          this.saveToStorage();
          this.render();
        }
      };
      tab.onclick = () => {
        if (this.activeMapId !== p.id) {
          this.switchMap(p.id);
        }
      };
      tab.append(title);

      const isOfficialBase = p.id === 'thera-base' || p.id === 'turnur-base';
      if (this.maps.length > 1 && !isOfficialBase) {
        const closeBtn = make('button', '', 'wh-tab-close'); closeBtn.innerHTML = getLucideSvg('x', {size:14}); closeBtn.setAttribute('aria-label', 'Close map');
        closeBtn.title = `Close ${p.name}`;
        closeBtn.onclick = async (event) => { event.stopPropagation(); if (await this.confirmAction(`Delete chain tab "${p.name}"?`)) this.deleteMapPage(p.id); };
        tab.append(closeBtn);
      }
      tabsList.append(tab);
    }

    // Dedicated Guide & Legend Tab
    const isGuideActive = this.activeMapId === 'mapping-guide';
    const guideTab = make('button', '', `wok-subnav-btn wh-tab-btn wh-guide-tab-btn${isGuideActive ? ' active is-active' : ''}`) as HTMLButtonElement;
    guideTab.type = 'button';
    guideTab.title = 'Wormhole Connection Legend & In-Game Bookmarking Standards Guide';
    guideTab.innerHTML = `<span class="wh-tab-name">Guide &amp; Legend</span>`;
    guideTab.onclick = () => {
      if (this.activeMapId !== 'mapping-guide') {
        this.switchMap('mapping-guide');
      }
    };
    tabsList.append(guideTab);

    const tabActions = make('div', '', 'wh-tab-actions btn-list');

    const newTabBtn = make('button', '+ New Chain', 'btn btn-sm btn-primary') as HTMLButtonElement;
    newTabBtn.type = 'button';
    newTabBtn.title = 'Create a new independent mapping page';
    newTabBtn.onclick = () => {
      const name = prompt('Enter new chain page name:', `Chain #${this.maps.length + 1}`);
      if (name !== null) {
        this.addNewMapPage(name.trim() || `Chain #${this.maps.length + 1}`);
      }
    };

    const cloudPill = make('span', 'Local storage', 'wh-cloud-sync-pill is-local');
    cloudPill.title = 'Maps are saved on this PC.';

    tabActions.append(newTabBtn, cloudPill);
    tabsRow.append(tabsList, tabActions);
    this.container.append(tabsRow);

    // Main layout: Chain Workspace (left/center) + System Intel Inspector (right)
    const isGuide = this.activeMapId === 'mapping-guide';
    const body = make('div', '', `wh-body${isGuide ? ' is-guide-active' : ''}`);
    const chainStage = make('div', '', `wh-stage${isGuide ? ' is-guide-stage' : ''}`);
    this.renderChainContent(chainStage);

    const inspector = make('aside', '', `wh-inspector${isGuide ? ' is-guide-inspector' : ''}`);
    if (isGuide) {
      this.renderGuideQuickTools(inspector);
    } else {
      this.renderInspector(inspector);
    }

    body.append(chainStage, inspector);
    this.container.append(body);
  }

  private renderChainContentOnly() {
    const stage = this.container.querySelector('.wh-stage') as HTMLElement | null;
    if (stage) this.renderChainContent(stage);
  }

  private renderChainContent(stage: HTMLElement) {
    if (this.activeMapId === 'mapping-guide') {
      this.renderMappingGuideView(stage);
      return;
    }

    const cur = this.maps.find(m => m.id === this.activeMapId);
    const isTurnur = Boolean(cur?.id === 'turnur-base' || cur?.name.includes('Turnur') || this.nodes.has(30002086));

    if (this.viewMode === 'scout') {
      this.renderScoutHubView(stage, isTurnur ? 'Turnur' : 'Thera');
    } else if (this.activeMapId === 'scout-thera') {
      this.renderScoutHubView(stage, 'Thera');
    } else if (this.activeMapId === 'scout-turnur') {
      this.renderScoutHubView(stage, 'Turnur');
    } else if (this.viewMode === 'canvas') {
      this.renderCanvasGraph(stage);
    } else {
      this.renderChainTree(stage);
    }
  }

  private renderCanvasGraph(stage: HTMLElement) {
    stage.replaceChildren();

    const cur = this.maps.find(m => m.id === this.activeMapId);

    // Ensure all nodes have finite, valid coordinates
    const depthCounts = new Map<number, number>();
    for (const node of this.nodes.values()) {
      if (!isFinite(node.x as number) || !isFinite(node.y as number)) {
{
          const count = depthCounts.get(node.depth || 0) || 0;
          node.x = 80 + (node.depth || 0) * 290;
          node.y = 80 + count * 150;
          depthCounts.set(node.depth || 0, count + 1);
        }
      }
    }

    if (!isFinite(this.pan.x)) this.pan.x = 50;
    if (!isFinite(this.pan.y)) this.pan.y = 50;
    if (!isFinite(this.zoom) || this.zoom <= 0.1) this.zoom = 1.0;

    const viewport = make('div', '', 'wh-canvas-viewport');
    const world = make('div', '', 'wh-canvas-world');
    world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'wh-canvas-svg');

    const badgesLayer = make('div', '', 'wh-canvas-badges-layer');
    const nodesLayer = make('div', '', 'wh-canvas-nodes-layer');

    world.append(svg, badgesLayer, nodesLayer);
    viewport.append(world);
    stage.append(viewport);

    // Render node cards
    for (const node of this.nodes.values()) {
      const card = make('div', '', 'wh-canvas-node');
      card.dataset.id = String(node.systemId);
      card.dataset.mapSystemId = String(node.systemId); card.tabIndex = 0; card.setAttribute('aria-label', node.systemName + '; press Delete to remove');
      card.style.left = `${node.x ?? 80}px`;
      card.style.top = `${node.y ?? 80}px`;
      if (this.selectedSystemId === node.systemId) card.classList.add('selected');
      if (node.status && node.status !== 'normal') card.classList.add(`wh-status-${node.status}`);
      if (node.locked) card.classList.add('wh-node-locked');

      // Header
      const cardHeader = make('div', '', 'wh-node-header');

      // Security status
      let secVal = node.security;
      if (secVal === undefined) {
        const info = universeGraph.getSystemInfo(node.systemId) || universeGraph.getSystemInfo(node.systemName);
        if (info) {
          secVal = info.security;
          node.security = secVal;
        } else if (node.whClass.startsWith('C') || node.whClass === 'Thera') {
          secVal = -0.99;
          node.security = secVal;
        }
      }

      const secText = secVal !== undefined ? (secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1)) : '0.0';
      const secCls = secVal !== undefined
        ? (secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (node.whClass.startsWith('C') || node.whClass === 'Thera' ? 'wspace' : 'nullsec'))
        : 'nullsec';
      const secBadge = make('span', secText, `wh-card-sec-badge ${secCls}`);
      secBadge.title = `Security Status: ${secText}`;

      const shortClass = node.whClass === 'Nullsec' ? 'NS'
        : node.whClass === 'Highsec' ? 'HS'
        : node.whClass === 'Lowsec' ? 'LS'
        : node.whClass === 'Pochven' ? 'Trig'
        : node.whClass;
      const badge = make('span', shortClass, `wh-class-badge wh-class-${node.whClass.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
      badge.title = `Space Class: ${node.whClass}`;
      const title = make('span', systemDisplayName(node.systemId,node.systemName), 'wh-node-title');
      title.title = `${node.systemName} (${node.whClass} ${secText})`;

      const headerLeft = make('div', '', 'wh-node-header-left');
      headerLeft.append(secBadge, badge, title);

      if (node.status && node.status !== 'normal') {
        const statusMap: Record<string, string> = {
          camped: 'CAMPED',
          traffic: 'TRAFFIC',
          eol_crit: 'EOL/CRIT',
          hole_control: 'HOLE CTRL'
        };
        const statusBadge = make('span', statusMap[node.status] || node.status.toUpperCase(), `wh-status-badge wh-status-badge-${node.status}`);
        statusBadge.title = `Tactical System Status: ${node.status}`;
        headerLeft.append(statusBadge);
      }
      if (node.locked) {
        const lockIcon = make('span', '', 'wh-card-lock-badge'); lockIcon.innerHTML = getLucideSvg('lock', {size:14});
        lockIcon.title = 'Card position is locked (right-click to unlock)';
        headerLeft.append(lockIcon);
      }
      cardHeader.append(headerLeft);

      // Actions (+ Connect,  Sigs,  Delete)
      const actions = make('div', '', 'wh-node-actions');
      const addBtn = make('button', '+', 'wh-node-action-btn');
      addBtn.title = 'Add child wormhole connection';
      addBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedSystemId = node.systemId;
        this.showAddConnectionModal();
      };
      actions.append(addBtn);

      const pasteBtn = make('button', '', 'wh-node-action-btn'); pasteBtn.innerHTML = getLucideSvg('clipboard-paste', {size:14}); pasteBtn.setAttribute('aria-label', 'Add signatures from clipboard');
      pasteBtn.title = 'Paste probe scanner signatures';
      pasteBtn.onclick = (e) => {
        e.stopPropagation();
        this.selectedSystemId = node.systemId;
        void this.importScannerClipboard();
      };
      actions.append(pasteBtn);

      if (this.nodes.size > 1) {
        const delBtn = make('button', '', 'wh-node-action-btn wh-node-del-btn'); delBtn.innerHTML = getLucideSvg('trash-2', {size:14}); delBtn.setAttribute('aria-label', 'Remove system');
        delBtn.title = 'Remove node from chain';
        delBtn.onpointerdown = (e) => e.stopPropagation();
        delBtn.onpointerup = (e) => e.stopPropagation();
        delBtn.onclick = async (event) => { event.stopPropagation(); await this.requestRemoveNode(node.systemId); };
        actions.append(delBtn);
      }
      cardHeader.append(actions);
      card.append(cardHeader);

      // Body
      const cardBody = make('div', '', 'wh-node-body');

      // Statics
      if (node.statics && node.statics.length > 0) {
        const staticsRow = make('div', '', 'wh-node-statics-row');
        for (const st of node.statics) {
          staticsRow.append(make('span', st, 'wh-static-pill'));
        }
        cardBody.append(staticsRow);
      }

      // Combat Effect
      if (node.effect) {
        const effRow = make('div', ` ${node.effect}`, 'wh-node-effect-row wh-card-effect-badge');
        effRow.title = SYSTEM_EFFECTS[node.effect]?.description || `${node.effect} Combat Effect`;
        cardBody.append(effRow);
      }

      // Custom Intel Notes
      const noteRec = getStoredSystemNote(node.systemId) || getStoredSystemNote(node.systemName);
      const noteText = node.customNotes || noteRec?.notes;
      if (noteText) {
        const notesRow = make('div', ` ${noteText}`, 'wh-card-notes-preview');
        notesRow.title = `Intel Notes: ${noteText}`;
        cardBody.append(notesRow);
      }

      // Scouted By
      if (node.scoutedBy) {
        const scoutRow = make('div', ` ${node.scoutedBy}`, 'wh-node-scout-row');
        cardBody.append(scoutRow);
      }

      // Active Pilots
      const inSystemPilots = this.activeCharacters.filter(c => c.systemId === node.systemId && c.isOnline !== false && !this.exemptPilots.has(c.name.toLowerCase()));
      if (inSystemPilots.length > 0) {
        const pilotGroup = this.renderPilotAvatarGroup(inSystemPilots);
        cardBody.append(pilotGroup);
      }

      // Signature summary count
      const sigs = this.signatures.get(node.systemId) || [];
      const sigCount = sigs.length;
      const sigSummary = make('div', `${sigCount > 0 ? ` ${sigCount} sigs scanned` : '0 sigs scanned'}`, 'wh-node-sig-summary');
      cardBody.append(sigSummary);

      // Closest Trade Hub Jump Distance Pill (P2)
      const whEdges: [number, number][] = this.links.map(l => [l.sourceId, l.targetId]);
      const hubDistances = universeGraph.calculateClosestHubs(node.systemId, whEdges);
      if (hubDistances.length > 0 && hubDistances[0].totalJumps > 0) {
        const closest = hubDistances[0];
        const hubPill = make('div', ` ${closest.totalJumps}j to ${closest.targetHub.shortName}`, 'wh-node-hub-pill');
        hubPill.title = `Closest Trade Hub: ${closest.targetHub.name} (${closest.totalJumps} jumps: ${closest.whJumps} WH • ${closest.gateJumps} Gate)`;
        cardBody.append(hubPill);
      }

      this.renderFloatingWormholeSigs(node, cardBody);

      card.append(cardBody);

      // System context menu (Set Destination, Add Waypoint, Copy, Map)
      card.oncontextmenu = (e) => {
        this.showSystemContextMenu(e, node.systemId, node.systemName);
      };

      // Node Dragging & Selection
      let isDragging = false;
      let startX = 0, startY = 0;
      let origX = 0, origY = 0;
      let moved = false;

      card.onpointerdown = (e) => {
        if ((e.target as Element).closest('button, a, input, select, textarea, summary')) { e.stopPropagation(); return; }
        if (e.button !== 0) return;
        if (node.locked) return;
        e.stopPropagation();
        card.setPointerCapture(e.pointerId);
        isDragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        origX = node.x ?? 80;
        origY = node.y ?? 80;
      };

      card.onpointermove = (e) => {
        if (!isDragging) return;
        const dx = (e.clientX - startX) / this.zoom;
        const dy = (e.clientY - startY) / this.zoom;
        if (Math.hypot(dx, dy) > 3) moved = true;
        node.x = origX + dx;
        node.y = origY + dy;
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
        this.updateSvgLinks(svg, badgesLayer);
      };

      card.onpointerup = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
        if (!moved) {
          this.selectedSystemId = node.systemId;
          const prevSel = nodesLayer.querySelector('.wh-canvas-node.selected');
          if (prevSel) prevSel.classList.remove('selected');
          card.classList.add('selected');
          const inspector = this.container.querySelector('.wh-inspector') as HTMLElement | null;
          if (inspector) this.renderInspector(inspector);
          this.saveToStorage();
        } else {
          this.saveToStorage();
        }
      };

      nodesLayer.append(card);
    }

    // Viewport Panning & Zooming
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let initialPanX = 0, initialPanY = 0;

    viewport.onpointerdown = (e) => {
      if ((e.target as Element).closest('button, a, input, select, textarea, summary')) return;
      if (e.button !== 0 && e.button !== 1) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      initialPanX = this.pan.x;
      initialPanY = this.pan.y;
      viewport.setPointerCapture(e.pointerId);
    };

    viewport.onpointermove = (e) => {
      if (!isPanning) return;
      this.pan.x = initialPanX + (e.clientX - panStartX);
      this.pan.y = initialPanY + (e.clientY - panStartY);
      world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    };

    viewport.onpointerup = (e) => {
      if (!isPanning) return;
      isPanning = false;
      if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
      this.saveToStorage();
    };

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(2.0, this.zoom * zoomFactor));
      world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
      this.saveToStorage();
    }, { passive: false });

    const isThera = Boolean(cur?.id === 'thera-base' || cur?.name.includes('Thera') || this.nodes.has(31000005));
    const isTurnur = Boolean(cur?.id === 'turnur-base' || cur?.name.includes('Turnur') || this.nodes.has(30002086));
    if (isThera || isTurnur) {
      const cornerCard = this.renderClosestHubEntrancesCard(false);
      if (cornerCard) viewport.append(cornerCard);
    }

    // Always render connection legend HUD widget on each canvas page
    const legendWidget = this.renderCanvasConnectionLegend();
    if (legendWidget) viewport.append(legendWidget);

    this.updateSvgLinks(svg, badgesLayer);
  }

  private updateSvgLinks(svg: SVGSVGElement, badgesLayer: HTMLElement) {
    svg.replaceChildren();
    badgesLayer.replaceChildren();

    const fontScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1;
    const CARD_WIDTH = Math.round(280 * Math.min(fontScale, 1.25));
    const CARD_HEIGHT = Math.round(90 * Math.min(fontScale, 1.25));

    for (const link of this.links) {
      const source = this.nodes.get(link.sourceId);
      const target = this.nodes.get(link.targetId);
      if (!source || !target) continue;

      if (link.isStargate) {
        // Render straight bold line for stargates (bolder than wormholes)
        const scx = (source.x ?? 80) + CARD_WIDTH / 2;
        const scy = (source.y ?? 80) + CARD_HEIGHT / 2;
        const tcx = (target.x ?? 80) + CARD_WIDTH / 2;
        const tcy = (target.y ?? 80) + CARD_HEIGHT / 2;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(scx));
        line.setAttribute('y1', String(scy));
        line.setAttribute('x2', String(tcx));
        line.setAttribute('y2', String(tcy));
        line.setAttribute('stroke', '#475569');
        line.setAttribute('stroke-width', '4.5');
        line.setAttribute('stroke-linecap', 'round');
        line.oncontextmenu = (e) => this.showConnectionContextMenu(e, link.id);
        line.ondblclick = (e) => {
          e.stopPropagation();
          this.showEditConnectionModal(link.id);
        };
        svg.append(line);

        // Subtle gate indicator pill at midpoint
        const midX = (scx + tcx) / 2;
        const midY = (scy + tcy) / 2;
        const pill = make('div', 'GATE', 'wh-stargate-midpill');
        pill.style.left = `${midX}px`;
        pill.style.top = `${midY}px`;
        pill.title = 'Stargate connection (double-click to edit, right-click for options)';
        pill.oncontextmenu = (e) => this.showConnectionContextMenu(e, link.id);
        pill.ondblclick = (e) => {
          e.stopPropagation();
          this.showEditConnectionModal(link.id);
        };
        badgesLayer.append(pill);
      } else {
        // Render curved Bezier line for wormhole connections (multi-directional / radial aware)
        const scx = (source.x ?? 80) + CARD_WIDTH / 2;
        const scy = (source.y ?? 80) + CARD_HEIGHT / 2;
        const tcx = (target.x ?? 80) + CARD_WIDTH / 2;
        const tcy = (target.y ?? 80) + CARD_HEIGHT / 2;

        let sx: number, sy: number, tx: number, ty: number;
        let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

        const deltaX = tcx - scx;
        const deltaY = tcy - scy;

        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          if (deltaX >= 0) {
            // Target is to the right
            sx = scx + CARD_WIDTH / 2;
            sy = scy;
            tx = tcx - CARD_WIDTH / 2;
            ty = tcy;
            const dx = Math.max(40, (tx - sx) * 0.5);
            cp1x = sx + dx;
            cp1y = sy;
            cp2x = tx - dx;
            cp2y = ty;
          } else {
            // Target is to the left
            sx = scx - CARD_WIDTH / 2;
            sy = scy;
            tx = tcx + CARD_WIDTH / 2;
            ty = tcy;
            const dx = Math.max(40, (sx - tx) * 0.5);
            cp1x = sx - dx;
            cp1y = sy;
            cp2x = tx + dx;
            cp2y = ty;
          }
        } else {
          if (deltaY >= 0) {
            // Target is below
            sx = scx;
            sy = scy + CARD_HEIGHT / 2;
            tx = tcx;
            ty = tcy - CARD_HEIGHT / 2;
            const dy = Math.max(40, (ty - sy) * 0.5);
            cp1x = sx;
            cp1y = sy + dy;
            cp2x = tx;
            cp2y = ty - dy;
          } else {
            // Target is above
            sx = scx;
            sy = scy - CARD_HEIGHT / 2;
            tx = tcx;
            ty = tcy + CARD_HEIGHT / 2;
            const dy = Math.max(40, (sy - ty) * 0.5);
            cp1x = sx;
            cp1y = sy - dy;
            cp2x = tx;
            cp2y = ty + dy;
          }
        }

        const isFrig = Boolean(link.isFrigateOnly || isFrigateHole(link.whCode, link.shipSize));
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`);
        
        let strokeColor = link.massStatus === 'critical' ? '#f87171' : link.massStatus === 'half' ? '#fbbf24' : '#38bdf8';
        if (isFrig) {
          strokeColor = '#c084fc';
        }
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', isFrig ? '3' : '2.5');
        path.setAttribute('fill', 'none');
        if (link.lifetimeStatus === 'eol') {
          path.setAttribute('stroke-dasharray', '6 4');
        }
        path.oncontextmenu = (e) => this.showConnectionContextMenu(e, link.id);
        path.ondblclick = (e) => {
          e.stopPropagation();
          this.showEditConnectionModal(link.id);
        };
        svg.append(path);

        const getBezierPt = (t: number) => {
          const mt = 1 - t;
          const mt2 = mt * mt;
          const mt3 = mt2 * mt;
          const t2 = t * t;
          const t3 = t2 * t;
          return {
            x: Math.round(mt3 * sx + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * tx),
            y: Math.round(mt3 * sy + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * ty)
          };
        };

        // Stagger endpoint pills when radiating connections cluster closely together
        const radiatingCount = this.links.filter(l => l.sourceId === source.systemId || l.targetId === source.systemId).length;
        const staggerFactor = radiatingCount > 3 ? (((link.id.charCodeAt(link.id.length - 1) || 0) % 3) - 1) * 0.045 : 0;

        // Source Signature Pill (near source node card)
        if (link.sourceSig) {
          const sT = Math.max(0.12, Math.min(0.28, 0.20 + staggerFactor));
          const sPt = getBezierPt(sT);
          const sPill = make('div', link.sourceSig, 'wh-endpoint-sig-pill wh-sig-source');
          sPill.style.left = `${sPt.x}px`;
          sPill.style.top = `${sPt.y}px`;
          sPill.title = `${source.systemName} Signature: ${link.sourceSig} (Click to copy)`;
          sPill.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(link.sourceSig || '');
            this.showWaypointToast(` Copied ${source.systemName} sig: ${link.sourceSig}`);
          };
          badgesLayer.append(sPill);
        }

        // Target Signature Pill (near target node card)
        if (link.targetSig) {
          const tT = Math.max(0.72, Math.min(0.88, 0.80 - staggerFactor));
          const tPt = getBezierPt(tT);
          const tPill = make('div', link.targetSig, 'wh-endpoint-sig-pill wh-sig-target');
          tPill.style.left = `${tPt.x}px`;
          tPill.style.top = `${tPt.y}px`;
          tPill.title = `${target.systemName} Signature: ${link.targetSig} (Click to copy)`;
          tPill.onclick = (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(link.targetSig || '');
            this.showWaypointToast(` Copied ${target.systemName} sig: ${link.targetSig}`);
          };
          badgesLayer.append(tPill);
        }

        // Midpoint badge
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;

        const badge = make('div', '', `wh-vector-midpill${isFrig ? ' is-frigate' : ''}`);
        badge.style.left = `${midX}px`;
        badge.style.top = `${midY}px`;
        badge.title = 'Click ️ or double-click to edit connection, right-click for options';
        badge.oncontextmenu = (e) => this.showConnectionContextMenu(e, link.id);
        badge.ondblclick = (e) => {
          e.stopPropagation();
          this.showEditConnectionModal(link.id);
        };

        if (isFrig) {
          const frigBadge = make('span', ' FRIG', 'wh-vector-frig-badge');
          frigBadge.title = 'Frigate / Destroyer Size Restricted Hole (<=5,000t jump mass)';
          badge.append(frigBadge);
        }

        if (link.whCode) {
          const codeSpan = make('span', `[${link.whCode}]`, 'wh-vector-code');
          badge.append(codeSpan);
        }

        if (link.sourceSig || link.targetSig) {
          const sigsSpan = make('span', `${link.sourceSig || '?'} -> ${link.targetSig || '?'}`, 'wh-vector-sigs');
          sigsSpan.title = `In/Out: ${source.systemName} (${link.sourceSig || '?'}) -> ${target.systemName} (${link.targetSig || '?'})`;
          badge.append(sigsSpan);
        } else if (!link.whCode) {
          const codeSpan = make('span', 'WH', 'wh-vector-code');
          badge.append(codeSpan);
        }

        const editBtn = make('button', '️', 'wh-vector-btn wh-edit-btn');
        editBtn.title = 'Edit connection signatures, wormhole code, mass & time';
        editBtn.onclick = (e) => {
          e.stopPropagation();
          this.showEditConnectionModal(link.id);
        };
        badge.append(editBtn);

        const jCount = link.jumpLog?.length || 0;
        const massBtnLabel = link.massJumpedKg && link.massJumpedKg > 0
          ? `${link.massStatus.toUpperCase()} ${formatMassKg(link.massJumpedKg)}`
          : link.massStatus.toUpperCase();
        const massBtn = make('button', massBtnLabel, `wh-vector-btn wh-mass-${link.massStatus}`);
        massBtn.title = jCount > 0
          ? `Mass status: ${link.massStatus.toUpperCase()} (${formatMassKg(link.massJumpedKg || 0)} applied across ${jCount} jumps). Click to cycle stage.`
          : 'Cycle mass status: Stable -> Half -> Critical';
        massBtn.onclick = (e) => {
          e.stopPropagation();
          this.cycleMassStatus(link.id);
        };
        badge.append(massBtn);

        const remH = link.remainingHours;
        const eolLabel = link.lifetimeStatus === 'eol'
          ? (remH !== undefined ? `EOL (${remH}h)` : 'EOL')
          : (remH !== undefined ? `️ ${remH}h` : 'LIFE OK');
        const eolBtn = make('button', eolLabel, `wh-vector-btn wh-eol-${link.lifetimeStatus}`);
        eolBtn.title = `Toggle EOL (<4 hours remaining). Current: ${link.lifetimeStatus.toUpperCase()}${remH !== undefined ? ` (~${remH} hours left)` : ''}`;
        eolBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleLifetimeStatus(link.id);
        };
        badge.append(eolBtn);

        const rollBtn = make('button', jCount > 0 ? `️ ${jCount}j` : '️', 'wh-vector-btn wh-roll-btn');
        rollBtn.title = jCount > 0 ? `Open Wormhole Mass & Jump Log (${jCount} jumps logged)` : 'Open Wormhole Mass & Jump Log';
        rollBtn.onclick = (e) => {
          e.stopPropagation();
          this.showRollingCalculatorModal(link.id);
        };
        badge.append(rollBtn);

        badgesLayer.append(badge);
      }
    }
  }

  private showPilotExemptionModal() {
    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box wh-drawer-box');
    box.append(make('h3', ' Pilot Mapping & Auto-Chain Settings'));

    const masterRow = make('label', '', 'wh-master-toggle-label');
    const masterCb = document.createElement('input');
    masterCb.type = 'checkbox';
    masterCb.checked = this.autoMappingEnabled;
    masterCb.onchange = () => {
      this.autoMappingEnabled = masterCb.checked;
      this.savePilotSettings();
    };
    masterRow.append(masterCb, document.createTextNode(' Enable automatic wormhole chaining on character jumps'));
    box.append(masterRow);

    const desc = make('p', 'Check pilots who should be EXEMPT from mapping. When exempt, jumps made by that character (e.g. session changing or scouting) will not auto-add nodes or connections.', 'wh-card-desc');
    box.append(desc);

    const list = make('div', '', 'wh-pilot-exempt-list');
    const allKnownPilots = new Map<string, string>();
    for (const c of this.activeCharacters) {
      allKnownPilots.set(c.name.toLowerCase(), c.name);
    }
    for (const name of this.exemptPilots) {
      if (!allKnownPilots.has(name)) allKnownPilots.set(name, name);
    }

    if (allKnownPilots.size === 0) {
      list.append(make('p', 'No active characters detected yet. Log in or select characters to manage mapping status.', 'wh-empty-msg'));
    } else {
      for (const [key, displayName] of allKnownPilots) {
        const row = make('div', '', 'wh-pilot-exempt-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.exemptPilots.has(key);
        cb.onchange = () => {
          if (cb.checked) {
            this.exemptPilots.add(key);
          } else {
            this.exemptPilots.delete(key);
          }
          this.savePilotSettings();
        };

        const label = make('span', displayName, 'wh-pilot-exempt-name');
        const statusTag = make('span', cb.checked ? ' Exempt (Not Mapping)' : ' Active Mapper', cb.checked ? 'wh-pilot-status-exempt' : 'wh-pilot-status-active');

        cb.addEventListener('change', () => {
          statusTag.textContent = cb.checked ? ' Exempt (Not Mapping)' : ' Active Mapper';
          statusTag.className = cb.checked ? 'wh-pilot-status-exempt' : 'wh-pilot-status-active';
        });

        row.append(cb, label, statusTag);
        list.append(row);
      }
    }
    box.append(list);

    const actions = make('div', '', 'wh-modal-actions');
    const exemptAllBtn = make('button', 'Exempt All', 'map-btn map-btn-secondary');
    exemptAllBtn.onclick = () => {
      for (const key of allKnownPilots.keys()) this.exemptPilots.add(key);
      this.savePilotSettings();
      modal.remove();
      this.showPilotExemptionModal();
    };

    const clearAllBtn = make('button', 'Allow All (Clear Exemptions)', 'map-btn map-btn-secondary');
    clearAllBtn.onclick = () => {
      this.exemptPilots.clear();
      this.savePilotSettings();
      modal.remove();
      this.showPilotExemptionModal();
    };

    const closeBtn = make('button', 'Done', 'map-btn');
    closeBtn.onclick = () => modal.remove();

    actions.append(exemptAllBtn, clearAllBtn, closeBtn);
    box.append(actions);

    modal.append(box);
    document.body.append(modal);
  }

  private renderChainTree(stage: HTMLElement) {
    stage.replaceChildren();

    const treeBox = make('div', '', 'wh-tree-box');
    const list = make('ul', '', 'wh-tree-list');

    // Group nodes by depth
    const maxDepth = Math.max(0, ...[...this.nodes.values()].map(n => n.depth));

    for (let d = 0; d <= maxDepth; d++) {
      const depthNodes = [...this.nodes.values()].filter(n => n.depth === d);
      if (depthNodes.length === 0) continue;

      const depthHeader = make('div', `Level ${d} ${d === 0 ? '(Staging / Home)' : ''}`, 'wh-depth-header');
      list.append(depthHeader);

      for (const node of depthNodes) {
        const item = make('li', '', 'wh-node-item');
        item.dataset.mapSystemId = String(node.systemId); item.tabIndex = 0; item.setAttribute('aria-label', node.systemName + '; press Delete to remove');
        item.onclick = () => {
          this.selectedSystemId = node.systemId;
          this.render();
          this.container.querySelector<HTMLElement>('[data-map-system-id="' + node.systemId + '"]')?.focus();
        };
        if (this.selectedSystemId === node.systemId) item.classList.add('selected');
        if (node.status && node.status !== 'normal') item.classList.add(`wh-status-${node.status}`);
        if (node.locked) item.classList.add('wh-node-locked');

        // Security status
        let secVal = node.security;
        if (secVal === undefined) {
          const info = universeGraph.getSystemInfo(node.systemId) || universeGraph.getSystemInfo(node.systemName);
          if (info) secVal = info.security;
          else if (node.whClass.startsWith('C') || node.whClass === 'Thera') secVal = -0.99;
        }
        const secText = secVal !== undefined ? (secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1)) : '0.0';
        const secCls = secVal !== undefined
          ? (secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (node.whClass.startsWith('C') || node.whClass === 'Thera' ? 'wspace' : 'nullsec'))
          : 'nullsec';
        const secBadge = make('span', secText, `wh-card-sec-badge ${secCls}`);
        secBadge.title = `Security Status: ${secText}`;

        const classBadge = make('span', node.whClass, `wh-class-badge wh-class-${node.whClass.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
        const sysName = make('span', systemDisplayName(node.systemId,node.systemName), 'wh-node-name');
        item.append(secBadge, classBadge, sysName);

        if (node.status && node.status !== 'normal') {
          const statusMap: Record<string, string> = {
            camped: 'CAMPED',
            traffic: 'TRAFFIC',
            eol_crit: 'EOL/CRIT',
            hole_control: 'HOLE CTRL'
          };
          const statusBadge = make('span', statusMap[node.status] || node.status.toUpperCase(), `wh-status-badge wh-status-badge-${node.status}`);
          item.append(statusBadge);
        }
        if (node.locked) {
          const lockBadge = make('span', '', 'wh-card-lock-badge'); lockBadge.innerHTML = getLucideSvg('lock', {size:14}); lockBadge.title = 'Position locked'; item.append(lockBadge);
        }

        if (node.statics && node.statics.length > 0) {
          const staticsTag = make('span', `[${node.statics.join(', ')}]`, 'wh-statics-tag');
          item.append(staticsTag);
        }

        if (node.effect) {
          const effTag = make('span', ` ${node.effect}`, 'wh-effect-tag wh-card-effect-badge');
          effTag.title = SYSTEM_EFFECTS[node.effect]?.description || `${node.effect} Combat Effect`;
          item.append(effTag);
        }

        const noteRec = getStoredSystemNote(node.systemId) || getStoredSystemNote(node.systemName);
        const noteText = node.customNotes || noteRec?.notes;
        if (noteText) {
          const noteTag = make('span', ` ${noteText}`, 'wh-card-notes-preview');
          noteTag.title = `Intel Notes: ${noteText}`;
          item.append(noteTag);
        }

        if (node.scoutedBy) {
          const scoutTag = make('span', ` ${node.scoutedBy}`, 'wh-scout-tag');
          item.append(scoutTag);
        }

        const inSystemPilots = this.activeCharacters.filter(c => c.systemId === node.systemId && c.isOnline !== false && !this.exemptPilots.has(c.name.toLowerCase()));
        if (inSystemPilots.length > 0) {
          const pilotGroup = this.renderPilotAvatarGroup(inSystemPilots);
          item.append(pilotGroup);
        }

        this.renderFloatingWormholeSigs(node, item);

        item.oncontextmenu = (e) => {
          this.showSystemContextMenu(e, node.systemId, node.systemName);
        };

        list.append(item);

        const outgoingLinks = this.links.filter(l => l.sourceId === node.systemId);
        if (outgoingLinks.length > 0) {
          const linkList = make('div', '', 'wh-link-list');
          for (const link of outgoingLinks) {
            const targetNode = this.nodes.get(link.targetId);
            const linkRow = make('div', '', 'wh-link-row');
            linkRow.oncontextmenu = (e) => this.showConnectionContextMenu(e, link.id);

            const isFrig = Boolean(link.isFrigateOnly || isFrigateHole(link.whCode, link.shipSize));
            const sigText = (link.sourceSig || link.targetSig) ? `(${link.sourceSig || '?'} -> ${link.targetSig || '?'}) ` : '';
            const codeText = link.whCode ? `[${link.whCode}] ` : '';
            const frigText = isFrig ? ' FRIG ' : '';
            linkRow.append(make('span', `↳ leads to ${targetNode?.systemName || 'System ' + link.targetId} ${sigText}${codeText}${frigText}`, 'wh-link-label'));

            const editPill = make('button', '️ Edit', 'wh-roll-pill');
            editPill.style.color = '#38bdf8';
            editPill.title = 'Edit connection details, signatures, wormhole code, mass & time';
            editPill.onclick = (e) => {
              e.stopPropagation();
              this.showEditConnectionModal(link.id);
            };
            linkRow.append(editPill);

            const massPill = make('button', link.massStatus.toUpperCase(), `wh-mass-pill wh-mass-${link.massStatus}`);
            massPill.title = 'Click to toggle mass: Stable -> Half -> Critical';
            massPill.onclick = (e) => {
              e.stopPropagation();
              this.cycleMassStatus(link.id);
            };
            linkRow.append(massPill);

            const remH = link.remainingHours;
            const eolLabel = link.lifetimeStatus === 'eol'
              ? (remH !== undefined ? `EOL (${remH}h)` : 'EOL')
              : (remH !== undefined ? `️ ${remH}h` : 'LIFE OK');
            const eolPill = make('button', eolLabel, `wh-eol-pill wh-eol-${link.lifetimeStatus}`);
            eolPill.title = `Click to toggle EOL (<4h remaining). Current: ${link.lifetimeStatus.toUpperCase()}${remH !== undefined ? ` (~${remH} hours left)` : ''}`;
            eolPill.onclick = (e) => {
              e.stopPropagation();
              this.toggleLifetimeStatus(link.id);
            };
            linkRow.append(eolPill);

            const jumpCount = link.jumpLog?.length || 0;
            const massText = link.massJumpedKg && link.massJumpedKg > 0 ? `️ ${formatMassKg(link.massJumpedKg)} (${jumpCount}j)` : '️ Roll / Mass';
            const rollBtn = make('button', massText, 'wh-roll-pill');
            rollBtn.title = jumpCount > 0 ? `${jumpCount} jumps logged (${formatMassKg(link.massJumpedKg || 0)} applied). Click to view Jump & Mass Log.` : 'Open wormhole rolling and mass jump log';
            rollBtn.onclick = (e) => {
              e.stopPropagation();
              this.showRollingCalculatorModal(link.id);
            };
            linkRow.append(rollBtn);

            linkList.append(linkRow);
          }
          list.append(linkList);
        }
      }
    }

    treeBox.append(list);
    stage.append(treeBox);
  }

  private renderInspector(inspector: HTMLElement) {
    inspector.replaceChildren();

    const node = this.selectedSystemId ? this.nodes.get(this.selectedSystemId) : undefined;
    const scoutSys = this.selectedScoutSystem && this.selectedScoutSystem.targetId === this.selectedSystemId ? this.selectedScoutSystem : null;
    const sysInfo = this.selectedSystemId ? universeGraph.getSystemInfo(this.selectedSystemId) : null;

    if (!this.selectedSystemId || (!node && !scoutSys && !sysInfo)) {
      inspector.append(make('p', 'Select a system node from the chain or a scout connection card to view live system intel, recent zKillboard kills, and sovereignty.', 'wh-empty-msg'));
      return;
    }

    const systemId = this.selectedSystemId;
    const systemName = node?.systemName || scoutSys?.targetName || sysInfo?.name || `System #${systemId}`;
    let whClass = node?.whClass || scoutSys?.targetClass || (systemId >= 31000000 ? (systemId === 31000005 ? 'Thera' : 'W-Space') : 'K-Space');
    if (whClass === 'LOWSEC') whClass = 'Lowsec';
    if (whClass === 'HIGHSEC') whClass = 'Highsec';
    if (whClass === 'NULLSEC') whClass = 'Nullsec';

    const staticsInfo = getSystemStatics(systemName) || getSystemStatics(systemId);
    let statics = node?.statics || staticsInfo?.statics;
    let effect = node?.effect || staticsInfo?.effect;
    if (staticsInfo && (!whClass || whClass === 'W-Space' || whClass === 'K-Space')) {
      whClass = staticsInfo.whClass;
    }

    // Security calculation
    let secVal = node?.security ?? sysInfo?.security;
    if (secVal === undefined) {
      if (systemId >= 31000000) secVal = -0.99;
      else if (whClass === 'Highsec') secVal = 0.8;
      else if (whClass === 'Lowsec') secVal = 0.3;
      else if (whClass === 'Nullsec') secVal = -0.2;
    }
    const secText = secVal !== undefined ? (secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1)) : '0.0';
    const secCls = secVal !== undefined
      ? (secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (systemId >= 31000000 || whClass.startsWith('C') || whClass === 'Thera' ? 'wspace' : 'nullsec'))
      : 'nullsec';

    const titleRow = make('div', '', 'wh-inspector-header-row');
    const titleLeft = make('div', '', 'wh-inspector-title-left');
    const secBadge = make('span', secText, `wh-card-sec-badge ${secCls}`);
    secBadge.title = `Security Status: ${secText}`;

    const classBadge = make('span', whClass, `wh-class-badge wh-class-${whClass.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
    const titleH3 = make('h3', systemName, 'wh-inspector-title');

    titleLeft.append(secBadge, classBadge, titleH3);
    if (node?.status && node.status !== 'normal') {
      const statusMap: Record<string, string> = {
        camped: 'CAMPED',
        traffic: 'TRAFFIC',
        eol_crit: 'EOL/CRIT',
        hole_control: 'HOLE CTRL'
      };
      const statusBadge = make('span', statusMap[node.status] || node.status.toUpperCase(), `wh-status-badge wh-status-badge-${node.status}`);
      titleLeft.append(statusBadge);
    }
    titleRow.append(titleLeft);

    const btnSubGroup = make('div', '', 'wh-header-btns');

    // Autopilot Destination Button
    const destBtn = make('button', ' Set Dest', 'map-btn map-btn-xs');
    destBtn.title = `Set in-game autopilot destination to ${systemName}`;
    destBtn.onclick = async () => {
      await setAutopilotDestination(systemId);
      this.showWaypointToast(` Autopilot destination set to ${systemName}`);
    };
    btnSubGroup.append(destBtn);

    // Fleet Broadcast Button
    const fleetBtn = make('button', ' Fleet', 'map-btn map-btn-xs') as HTMLButtonElement;
    fleetBtn.title = `Broadcast destination to all registered fleet members`;
    fleetBtn.onclick = async () => {
      fleetBtn.disabled = true;
      try {
        const activePilot = this.activeCharacters[0];
        const st = await call<{ inFleet: boolean; fleetId?: number }>('fleet_status', { characterId: activePilot?.id });
        if (st?.inFleet && st.fleetId) {
          await call('set_fleet_destination', {
            fleetId: st.fleetId,
            destinationId: systemId,
            characterId: activePilot?.id,
            clearOtherWaypoints: true
          });
          this.showWaypointToast(`Fleet destination broadcast to ${systemName}!`);
        } else {
          await setAutopilotDestination(systemId);
          this.showWaypointToast(` Personal autopilot destination set to ${systemName}`);
        }
      } catch {
        await setAutopilotDestination(systemId);
        this.showWaypointToast(` Autopilot destination set to ${systemName}`);
      } finally {
        fleetBtn.disabled = false;
      }
    };
    btnSubGroup.append(fleetBtn);

    // If scout system or unimported, provide 1-click import to active chain map
    if (!this.nodes.has(systemId)) {
      const importBtn = make('button', '+ Import', 'map-btn map-btn-xs map-btn-accent');
      importBtn.title = 'Import this connection to your active chain map';
      importBtn.onclick = () => {
        const activeMap = this.maps.find(m => !m.id.startsWith('scout-')) || this.maps[0];
        if (activeMap) {
          const hubName = scoutSys?.hub || 'Thera';
          const hubId = hubName === 'Thera' ? 31000005 : 30002086;
          if (!this.nodes.has(hubId)) {
            this.nodes.set(hubId, {
              systemId: hubId,
              systemName: hubName,
              whClass: hubName,
              depth: 0,
              x: 100,
              y: 100
            });
          }
          this.addWormholeConnection(hubId, systemId, systemName, whClass, scoutSys?.whType, scoutSys?.inSig, 'EVE-Scout');
          importBtn.textContent = 'Added';
          (importBtn as HTMLButtonElement).disabled = true;
          this.showWaypointToast(` Added ${systemName} connection to ${activeMap.name}`);
        }
      };
      btnSubGroup.append(importBtn);
    }

    const copyBookmarkBtn = make('button', ' Copy', 'map-btn map-btn-xs');
    copyBookmarkBtn.title = 'Copy standard EVE in-game bookmark format to clipboard';
    copyBookmarkBtn.onclick = () => {
      const staticsText = statics?.length ? ` [${statics.join('/')}]` : '';
      const effText = effect ? ` (${effect})` : '';
      const text = `${systemName} [${whClass}]${staticsText}${effText}`;
      navigator.clipboard.writeText(text);
      copyBookmarkBtn.textContent = ' Copied!';
      setTimeout(() => (copyBookmarkBtn.textContent = ' Copy'), 1500);
    };
    btnSubGroup.append(copyBookmarkBtn);

    if (node && this.nodes.size > 1) {
      const delBtn = make('button', '', 'map-btn map-btn-danger map-btn-xs'); delBtn.innerHTML = getLucideSvg('trash-2', {size:14}); delBtn.setAttribute('aria-label', 'Remove system');
      delBtn.title = 'Remove node from chain map';
      delBtn.onclick = async (event) => { event.stopPropagation(); await this.requestRemoveNode(node.systemId); };
      btnSubGroup.append(delBtn);
    }

    titleRow.append(btnSubGroup);
    inspector.append(titleRow);

    // Tactical Status Selector in Inspector
    if (node) {
      const statusRow = make('div', '', 'wh-inspector-status-bar');
      const statusLabel = make('span', 'Tactical Status:', 'wh-subhead');
      statusLabel.style.fontSize = '10px';
      statusLabel.style.marginRight = '4px';
      statusRow.append(statusLabel);

      const statuses: Array<{ key: SystemTacticalStatus; label: string; cls: string }> = [
        { key: 'normal', label: 'Clear', cls: 'wh-status-btn-normal' },
        { key: 'camped', label: 'Camped', cls: 'wh-status-btn-camped' },
        { key: 'traffic', label: 'Traffic', cls: 'wh-status-btn-traffic' },
        { key: 'eol_crit', label: 'EOL/Crit', cls: 'wh-status-btn-eolcrit' },
        { key: 'hole_control', label: 'Hole Ctrl', cls: 'wh-status-btn-holecontrol' },
      ];

      for (const st of statuses) {
        const btn = make('button', st.label, `wh-status-btn ${st.cls} ${(node.status || 'normal') === st.key ? 'active' : ''}`);
        btn.onclick = () => {
          this.setSystemStatus(node.systemId, st.key);
          this.renderInspector(inspector);
        };
        statusRow.append(btn);
      }
      inspector.append(statusRow);
    }

    // Scout Connection Route Box
    if (scoutSys) {
      const scoutBox = make('div', '', 'wh-inspector-scout-box');
      const scoutHeader = make('div', '', 'wh-inspector-scout-header');
      scoutHeader.append(
        make('span', ` ${scoutSys.hub} Connection`),
        make('span', `️ ${scoutSys.remainingHours ?? '?'}h remaining`)
      );
      scoutBox.append(scoutHeader);

      const scoutGrid = make('div', '', 'wh-inspector-scout-grid');

      const isFrig = isFrigateHole(scoutSys.whType, scoutSys.maxShip);
      const inSigItem = make('div', '', 'wh-inspector-scout-item');
      inSigItem.append(
        make('span', `${systemName} Sig`, 'wh-inspector-scout-lbl'),
        make('span', scoutSys.targetSig || scoutSys.inSig || '???', 'wh-inspector-scout-val in')
      );

      const outSigItem = make('div', '', 'wh-inspector-scout-item');
      outSigItem.append(
        make('span', `${scoutSys.hub} Sig`, 'wh-inspector-scout-lbl'),
        make('span', scoutSys.hubSig || scoutSys.outSig || '???', 'wh-inspector-scout-val out')
      );

      const whTypeItem = make('div', '', 'wh-inspector-scout-item');
      whTypeItem.append(
        make('span', 'Wormhole Code', 'wh-inspector-scout-lbl'),
        make('span', `${scoutSys.whType || 'Unknown WH'}${isFrig ? '  (FRIG)' : ''}`, 'wh-inspector-scout-val')
      );

      const maxShipItem = make('div', '', 'wh-inspector-scout-item');
      maxShipItem.append(
        make('span', 'Mass / Ship Class', 'wh-inspector-scout-lbl'),
        make('span', scoutSys.maxShip || 'Subcapital', 'wh-inspector-scout-val')
      );

      scoutGrid.append(inSigItem, outSigItem, whTypeItem, maxShipItem);
      scoutBox.append(scoutGrid);
      inspector.append(scoutBox);
    }

    // System Rundown Box (Live Public ESI / Universe Data)
    const rundownBox = make('div', '', 'wh-inspector-rundown-box');
    const rundownHeader = make('div', '', 'wh-rundown-header');
    rundownHeader.append(make('h4', ' System Rundown', 'wh-rundown-title'));
    rundownBox.append(rundownHeader);

    const rundownGrid = make('div', '', 'wh-rundown-grid');
    rundownGrid.append(make('div', 'Loading system intel...', 'wh-empty-msg'));
    rundownBox.append(rundownGrid);
    inspector.append(rundownBox);

    void fetchSystemRundown(systemId, systemName).then((rd) => {
      if (this.selectedSystemId !== systemId) return;
      rundownGrid.replaceChildren();

      const regionItem = make('div', '', 'wh-rundown-cell');
      regionItem.append(
        make('span', 'Region / Space', 'wh-rundown-label'),
        make('span', rd.regionName || scoutSys?.regionName || (systemId >= 31000000 ? 'J-Space' : 'Known Space'), 'wh-rundown-val')
      );

      const constItem = make('div', '', 'wh-rundown-cell');
      constItem.append(
        make('span', 'Constellation', 'wh-rundown-label'),
        make('span', rd.constellationName || (systemId >= 31000000 ? 'Uncharted' : 'Constellation Intel'), 'wh-rundown-val')
      );

      const trueSecItem = make('div', '', 'wh-rundown-cell');
      trueSecItem.append(
        make('span', 'True Security', 'wh-rundown-label'),
        make('span', rd.trueSecurityText, `wh-rundown-val ${rd.securityClass}`)
      );

      const celestialsItem = make('div', '', 'wh-rundown-cell');
      celestialsItem.append(
        make('span', 'Celestials', 'wh-rundown-label'),
        make('span', systemId >= 31000000 ? 'Wormhole Dynamics' : `${rd.stargatesCount} Gates • ${rd.stationsCount} Stations • ${rd.planetsCount} Planets`, 'wh-rundown-val')
      );

      rundownGrid.append(regionItem, constItem, trueSecItem, celestialsItem);
    });

    // Sovereignty Section (Live ESI)
    const sovCard = make('div', '', 'wh-inspector-sov-card');
    const sovHeaderRow = make('div', '', 'wh-sov-header-row');
    const sovText = make('div', '', 'wh-sov-text');
    sovText.append(
      make('span', '️ Checking Sovereignty...', 'wh-sov-title'),
      make('span', 'Connecting to ESI sovereignty map...', 'wh-sov-desc')
    );
    sovHeaderRow.append(sovText);
    sovCard.append(sovHeaderRow);
    inspector.append(sovCard);

    void fetchSystemSovereignty(systemId, secVal).then((sov) => {
      if (this.selectedSystemId !== systemId) return;
      sovHeaderRow.replaceChildren();

      if (sov.allianceLogoUrl || sov.factionLogoUrl) {
        const logo = document.createElement('img');
        logo.className = 'wh-sov-logo';
        logo.src = sov.allianceLogoUrl || sov.factionLogoUrl || '';
        logo.alt = sov.title;
        logo.loading = 'lazy';
        logo.onerror = () => (logo.style.display = 'none');
        sovHeaderRow.append(logo);
      }

      const textCol = make('div', '', 'wh-sov-text');
      textCol.append(
        make('span', `️ ${sov.title}`, 'wh-sov-title'),
        make('span', sov.description, 'wh-sov-desc')
      );
      sovHeaderRow.append(textCol);
    });

    // Recent zKillboard Kills Feed (Live Public zKillboard API)
    const zkillCard = make('div', '', 'wh-inspector-zkill-card');
    const zkillHeader = make('div', '', 'wh-zkill-header');
    zkillHeader.append(make('h4', '️ Recent zKillboard Kills', 'wh-zkill-title'));
    const threatPill = make('span', 'SCANNING...', 'wh-threat-badge quiet');
    zkillHeader.append(threatPill);
    zkillCard.append(zkillHeader);

    const statsRow = make('div', '', 'wh-zkill-stats-row');
    statsRow.append(make('span', 'Fetching live kills from zKillboard...', 'wh-card-desc'));
    zkillCard.append(statsRow);

    const killsList = make('div', '', 'wh-zkill-kills-list');
    zkillCard.append(killsList);
    inspector.append(zkillCard);

    void fetchSystemZkill(systemId).then((zkill) => {
      if (this.selectedSystemId !== systemId) return;

      threatPill.textContent = zkill.dangerRating;
      threatPill.className = `wh-threat-badge ${zkill.dangerClass}`;

      statsRow.replaceChildren();
      const killsStat = make('div', '', 'wh-zkill-stat-item');
      killsStat.append(
        make('span', '24h Kills:'),
        make('strong', String(zkill.killsLast24h), 'wh-zkill-stat-val')
      );

      const iskStat = make('div', '', 'wh-zkill-stat-item');
      iskStat.append(
        make('span', 'ISK Destroyed:'),
        make('strong', zkill.formattedTotalIsk, 'wh-zkill-stat-val')
      );

      statsRow.append(killsStat, iskStat);
      killsList.replaceChildren();

      if (zkill.kills.length === 0) {
        killsList.append(make('p', 'No kills recorded on zKillboard in recent activity.', 'wh-empty-msg'));
      } else {
        for (const km of zkill.kills) {
          const item = make('div', '', 'wh-zkill-item');
          item.title = `Click to view killmail on zKillboard (${km.formattedIsk})`;
          item.onclick = (e) => {
            e.stopPropagation();
            try {
              void call('open_url', { url: km.zkillUrl });
            } catch {
              window.open(km.zkillUrl, '_blank', 'noopener,noreferrer');
            }
          };

          const left = make('div', '', 'wh-zkill-left');
          const shipImg = document.createElement('img');
          shipImg.className = 'wh-zkill-ship-img';
          shipImg.src = `https://images.evetech.net/types/${km.victim.shipTypeId}/render?size=64`;
          shipImg.alt = km.victim.shipName || 'Ship';
          shipImg.loading = 'lazy';
          shipImg.onerror = () => {
            shipImg.src = `https://images.evetech.net/types/${km.victim.shipTypeId}/icon?size=32`;
          };

          const victimInfo = make('div', '', 'wh-zkill-victim-info');
          const shipNameSpan = make('span', km.victim.shipName || 'Unknown Hull', 'wh-zkill-ship-name');
          const pilotSpan = make('span', `${km.victim.characterName || 'Pilot'} [${km.victim.corporationName || 'Corp'}]`, 'wh-zkill-pilot-name');
          victimInfo.append(shipNameSpan, pilotSpan);
          left.append(shipImg, victimInfo);

          const right = make('div', '', 'wh-zkill-right');
          const iskSpan = make('span', km.formattedIsk, 'wh-zkill-isk');
          const timeSpan = make('span', km.relativeTime, 'wh-zkill-time');
          right.append(iskSpan, timeSpan);

          item.append(left, right);
          killsList.append(item);
        }

        const moreBtn = make('button', 'View Full System on zKillboard ↗', 'wh-zkill-more-btn');
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          const url = `https://zkillboard.com/system/${systemId}/`;
          try {
            void call('open_url', { url });
          } catch {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        };
        zkillCard.append(moreBtn);
      }
    });

    // System Statics Section
    if (statics && statics.length > 0) {
      const staticsBox = make('div', '', 'wh-statics-box');
      staticsBox.append(make('strong', 'System Statics: '));
      for (const st of statics) {
        const spec = WORMHOLE_CODES[st];
        const label = spec ? `${st} (${spec.targetSpace})` : st;
        staticsBox.append(make('span', label, 'wh-static-badge'));
      }
      inspector.append(staticsBox);
    }

    // System Effect Card
    if (effect && SYSTEM_EFFECTS[effect]) {
      const eff = SYSTEM_EFFECTS[effect];
      const effCard = make('div', '', 'wh-effect-card');
      effCard.append(make('h4', `Combat Effect: ${eff.name}`, 'wh-card-header'));
      effCard.append(make('p', eff.description, 'wh-card-desc'));

      const bonusList = make('ul', '', 'wh-bonus-list');
      for (const b of eff.bonuses) bonusList.append(make('li', b));
      effCard.append(bonusList);
      inspector.append(effCard);
    } else if (node) {
      const effRow = make('div', '', 'wh-effect-select-row');
      const effSelect = document.createElement('select');
      effSelect.className = 'map-btn';
      effSelect.add(new Option('-- Select Combat Effect --', ''));
      for (const key of Object.keys(SYSTEM_EFFECTS)) effSelect.add(new Option(key, key));
      effSelect.onchange = () => {
        node.effect = effSelect.value || undefined;
        this.saveToStorage();
        this.render();
      };
      effRow.append(make('label', 'Assign Effect: '), effSelect);
      inspector.append(effRow);
    }

    // System Notes & Intel Section
    const notesSection = make('div', '', 'wh-inspector-notes-section');
    const notesHeader = make('div', '', 'wh-inspector-notes-header');
    notesHeader.append(make('h4', ' System Intel & Notes', 'wh-section-title'));
    notesSection.append(notesHeader);

    const storedNote = getStoredSystemNote(systemId) || getStoredSystemNote(systemName);
    const initialText = node?.customNotes || storedNote?.notes || '';

    const textarea = document.createElement('textarea');
    textarea.className = 'wh-inspector-notes-textarea';
    textarea.placeholder = 'Enter intel notes for this system (e.g. Hostile structures, local traps, static WHs, PI taxes, bookmarks)...';
    textarea.value = initialText;
    notesSection.append(textarea);

    // Quick tag shortcuts
    const tagsRow = make('div', '', 'wh-inspector-quick-tags');
    const QUICK_TAGS = ['Hostile Citadel', 'Drifter Site', 'POS Active', 'POCO 0%', 'Eviction Threat', 'PI Rich', 'Bait WH'];
    for (const tag of QUICK_TAGS) {
      const tagBtn = make('button', `+ ${tag}`, 'wh-inspector-tag-btn');
      tagBtn.onclick = () => {
        const cur = textarea.value.trim();
        textarea.value = cur ? `${cur} | [${tag}]` : `[${tag}]`;
      };
      tagsRow.append(tagBtn);
    }
    notesSection.append(tagsRow);

    const notesActions = make('div', '', 'wh-inspector-notes-actions');
    const saveNoteBtn = make('button', ' Save System Notes', 'map-btn map-btn-xs map-btn-accent');
    saveNoteBtn.onclick = () => {
      const val = textarea.value.trim();
      if (node) node.customNotes = val || undefined;
      saveStoredSystemNote({
        systemId,
        systemName,
        notes: val,
        effect: node?.effect || effect
      });
      this.saveToStorage();
      this.renderChainContentOnly();
      saveNoteBtn.textContent = ' Saved!';
      setTimeout(() => (saveNoteBtn.textContent = ' Save System Notes'), 1800);
      this.showWaypointToast(` Saved intel notes for ${systemName}`);
    };
    notesActions.append(saveNoteBtn);
    notesSection.append(notesActions);
    inspector.append(notesSection);

    // ==========================================
    //  Wormhole Connections & Mass Log
    // ==========================================
    const connectedLinks = this.links.filter(l => l.sourceId === systemId || l.targetId === systemId);
    if (connectedLinks.length > 0) {
      const connCard = make('div', '', 'wh-inspector-connections-card');
      const connHdr = make('div', '', 'wh-inspector-conn-header');
      connHdr.append(make('h4', ' Wormhole Connections & Mass', 'wh-section-title'));
      connCard.append(connHdr);

      const connList = make('div', '', 'wh-inspector-conn-list');
      for (const link of connectedLinks) {
        const otherId = link.sourceId === systemId ? link.targetId : link.sourceId;
        const otherNode = this.nodes.get(otherId);
        const otherName = otherNode?.systemName || `System #${otherId}`;
        const whSpec = (!link.whCode || link.whCode.toUpperCase() === 'K162') ? getLinkWhSpec(link) : WORMHOLE_CODES[link.whCode] || null;
        const totalMassKg = wormholeLinkCapacityKg(link, whSpec);
        const totalMkg = totalMassKg === null ? null : Math.round(totalMassKg / 1_000_000);
        const jumpedMkg = Math.round((link.massJumpedKg || 0) / 1_000_000);
        const jumpCount = link.jumpLog?.length || 0;
        const pct = totalMassKg === null ? null : Math.min(100, Math.round(((link.massJumpedKg || 0) / totalMassKg) * 100));

        const row = make('div', '', 'wh-inspector-conn-row');

        const top = make('div', '', 'wh-inspector-conn-top');
        const dirText = link.sourceId === systemId ? `-> ${otherName}` : `⬅ from ${otherName}`;
        const targetLabel = make('strong', `${dirText} ${link.whCode ? `[${link.whCode}]` : ''}`);
        const massBadge = make('span', totalMassKg === null ? `${link.massStatus.toUpperCase()} (${jumpedMkg}M kg tracked; capacity Unknown)` : `${link.massStatus.toUpperCase()} (${jumpedMkg}M / ${totalMkg}M kg · ${pct}%)`, `wh-mass-pill wh-mass-${link.massStatus}`);
        top.append(targetLabel, massBadge);

        const bottom = make('div', '', 'wh-inspector-conn-bottom');
        const countText = make('span', `${jumpCount} ${jumpCount === 1 ? 'jump' : 'jumps'} tracked`, 'wh-card-desc');
        countText.style.margin = '0';

        const openLogBtn = make('button', '️ Jump & Mass Log', 'map-btn map-btn-xs');
        openLogBtn.title = 'Open interactive mass tracker and rolling log for this connection';
        openLogBtn.onclick = (e) => {
          e.stopPropagation();
          this.showRollingCalculatorModal(link.id);
        };
        bottom.append(countText, openLogBtn);

        row.append(top, bottom);
        connList.append(row);
      }
      connCard.append(connList);
      inspector.append(connCard);
    }

    // ==========================================
    //  P2: Trade Hub Routes (Hybrid WH + Stargate)
    // ==========================================
    const whEdges: [number, number][] = this.links.map(l => [l.sourceId, l.targetId]);
    const hubDistances = universeGraph.calculateClosestHubs(systemId, whEdges);

    const routesCard = make('div', '', 'wh-inspector-routes-card');
    const routesHeader = make('div', '', 'wh-routes-header');
    routesHeader.append(make('h4', ' Trade Hub Routes (WH + Stargates)', 'wh-section-title'));
    routesCard.append(routesHeader);

    if (hubDistances.length === 0) {
      routesCard.append(make('p', 'No route to trade hubs found from this system.', 'wh-empty-msg'));
    } else {
      const routesList = make('div', '', 'wh-routes-list');
      for (const hr of hubDistances) {
        const routeRow = make('div', '', 'wh-route-row');

        const infoCol = make('div', '', 'wh-route-info');
        const topRow = make('div', '', 'wh-route-top-row');
        topRow.append(
          make('span', hr.targetHub.name, 'wh-route-hub-name'),
          make('span', `${hr.totalJumps}j (${hr.whJumps} WH • ${hr.gateJumps} Gate)`, 'wh-route-jumps-badge')
        );
        infoCol.append(topRow);

        const pathNames = hr.path.map(id => universeGraph.getSystemInfo(id)?.name || String(id));
        if (pathNames.length > 0) {
          const pathPreview = make('div', pathNames.join(' -> '), 'wh-route-path-preview');
          pathPreview.title = pathNames.join(' -> ');
          infoCol.append(pathPreview);
        }

        const actionsCol = make('div', '', 'wh-route-actions');
        const destBtn = make('button', ' Dest', 'map-btn map-btn-xs');
        destBtn.title = `Set in-game autopilot destination to ${hr.targetHub.name}`;
        destBtn.onclick = async () => {
          await setAutopilotDestination(hr.targetHub.id);
          this.showWaypointToast(` Autopilot destination set to ${hr.targetHub.name} (${hr.totalJumps} jumps)`);
        };

        const fleetBtn = make('button', ' Fleet', 'map-btn map-btn-xs') as HTMLButtonElement;
        fleetBtn.title = `Broadcast destination ${hr.targetHub.name} to fleet`;
        fleetBtn.onclick = async () => {
          try {
            const activePilot = this.activeCharacters[0];
            const st = await call<{ inFleet: boolean; fleetId?: number }>('fleet_status', { characterId: activePilot?.id });
            if (st?.inFleet && st.fleetId) {
              await call('set_fleet_destination', {
                fleetId: st.fleetId,
                destinationId: hr.targetHub.id,
                characterId: activePilot?.id,
                clearOtherWaypoints: true
              });
              this.showWaypointToast(` Fleet destination broadcast to ${hr.targetHub.name}!`);
            } else {
              await setAutopilotDestination(hr.targetHub.id);
              this.showWaypointToast(` Personal autopilot destination set to ${hr.targetHub.name}`);
            }
          } catch {
            await setAutopilotDestination(hr.targetHub.id);
            this.showWaypointToast(` Autopilot set to ${hr.targetHub.name}`);
          }
        };

        actionsCol.append(destBtn, fleetBtn);
        routeRow.append(infoCol, actionsCol);
        routesList.append(routeRow);
      }
      routesCard.append(routesList);
    }
    inspector.append(routesCard);

    // ==========================================
    //  P1: Interactive Signature Grid Manager
    // ==========================================
    const allSigs = this.signatures.get(systemId) || [];
    const sigSection = make('div', '', 'wh-sig-section');

    // Header & Toolbar
    const sigHeader = make('div', '', 'wh-sig-header');
    sigHeader.append(make('h4', ` Signatures (${allSigs.length})`, 'wh-section-title'));

    const sigToolbar = make('div', '', 'wh-sig-toolbar');

    const pasteSigBtn = make('button', 'Paste', 'map-btn map-btn-xs');
    pasteSigBtn.title = 'Paste Probe Scanner results directly from clipboard (merges cleanly)';
    pasteSigBtn.onclick = () => void this.importScannerClipboard();

    const addSigBtn = make('button', 'Add sigs', 'map-btn map-btn-xs map-btn-accent');
    addSigBtn.title = 'Import Probe Scanner results from clipboard';
    addSigBtn.onclick = () => void this.importScannerClipboard(systemId);

    const pruneBtn = make('button', 'Prune (>24h)', 'map-btn map-btn-xs map-btn-secondary');
    pruneBtn.title = 'Remove signatures older than 24 hours';
    pruneBtn.onclick = () => {
      const curSigs = this.signatures.get(systemId) || [];
      const cleaned = cleanStaleSignatures(curSigs, 24 * 60 * 60 * 1000);
      const diff = curSigs.length - cleaned.length;
      this.signatures.set(systemId, cleaned);
      this.saveToStorage();
      this.renderInspector(inspector);
      this.renderChainContentOnly();
      this.showWaypointToast(`Pruned ${diff} stale signatures`);
    };

    const clearAllSigsBtn = make('button', 'Clear', 'map-btn map-btn-xs map-btn-danger');
    clearAllSigsBtn.title = 'Clear all signatures for this system';
    clearAllSigsBtn.onclick = async () => {
      if (await this.confirmAction(`Clear all ${allSigs.length} signatures for ${systemName}?`)) {
        this.signatures.delete(systemId);
        this.saveToStorage();
        this.renderInspector(inspector);
        this.renderChainContentOnly();
        this.showWaypointToast(`Cleared signatures for ${systemName}`);
      }
    };

    sigToolbar.append(pasteSigBtn, addSigBtn, pruneBtn, clearAllSigsBtn);
    sigHeader.append(sigToolbar);
    sigSection.append(sigHeader);

    // Filter pills row
    const filterRow = make('div', '', 'wh-sig-filter-row');
    const filterOptions: Array<{ key: string; label: string }> = [
      { key: 'all', label: `All (${allSigs.length})` },
      { key: 'wormhole', label: `Wormhole (${allSigs.filter(s => (s.group || '').toLowerCase().includes('wormhole')).length})` },
      { key: 'relic_data', label: `Relic/Data (${allSigs.filter(s => (s.group || '').toLowerCase().includes('relic') || (s.group || '').toLowerCase().includes('data')).length})` },
      { key: 'gas', label: `Gas (${allSigs.filter(s => (s.group || '').toLowerCase().includes('gas')).length})` },
      { key: 'combat', label: `Combat (${allSigs.filter(s => (s.group || '').toLowerCase().includes('combat')).length})` },
    ];
    for (const fo of filterOptions) {
      const fBtn = make('button', fo.label, `wh-sig-filter-btn ${this.sigFilter === fo.key ? 'active' : ''}`);
      fBtn.onclick = () => {
        this.sigFilter = fo.key;
        this.renderInspector(inspector);
      };
      filterRow.append(fBtn);
    }
    sigSection.append(filterRow);

    // Filtered list
    let filteredSigs = allSigs;
    if (this.sigFilter === 'wormhole') {
      filteredSigs = allSigs.filter(s => (s.group || '').toLowerCase().includes('wormhole'));
    } else if (this.sigFilter === 'relic_data') {
      filteredSigs = allSigs.filter(s => (s.group || '').toLowerCase().includes('relic') || (s.group || '').toLowerCase().includes('data'));
    } else if (this.sigFilter === 'gas') {
      filteredSigs = allSigs.filter(s => (s.group || '').toLowerCase().includes('gas'));
    } else if (this.sigFilter === 'combat') {
      filteredSigs = allSigs.filter(s => (s.group || '').toLowerCase().includes('combat'));
    }

    if (filteredSigs.length === 0) {
      sigSection.append(make('p', allSigs.length === 0 ? 'No signatures scanned yet. Click "Paste" to import from Probe Scanner.' : 'No signatures matching filter.', 'wh-empty-msg'));
    } else {
      const tableWrapper = make('div', '', 'wh-sig-grid-wrapper');
      const table = make('table', '', 'wh-sig-grid-table');

      const thead = make('thead');
      const trh = make('tr');
      trh.append(
        make('th', 'ID'),
        make('th', 'Group'),
        make('th', 'Name / Type'),
        make('th', 'Signal'),
        make('th', 'Age'),
        make('th', 'Actions')
      );
      thead.append(trh);
      table.append(thead);

      const tbody = make('tbody');
      for (const s of filteredSigs) {
        const tr = make('tr', '', 'wh-sig-grid-row');

        // ID cell
        const tdId = make('td', '', 'wh-sig-col-id');
        const idSpan = make('span', s.id, 'wh-sig-id-badge');
        idSpan.title = 'Click to copy signature ID';
        idSpan.onclick = () => {
          navigator.clipboard.writeText(s.id);
          this.showWaypointToast(`Copied ${s.id}`);
        };
        tdId.append(idSpan);

        // Group cell
        const tdGroup = make('td', '', 'wh-sig-col-group');
        const grpCls = (s.group || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
        const grpBadge = make('span', s.group || 'Unknown', `wh-sig-group-pill wh-grp-${grpCls}`);
        tdGroup.append(grpBadge);

        // Name cell
        const tdName = make('td', '', 'wh-sig-col-name');
        const nameSpan = make('span', s.name || 'Unknown Cosmic Signature', 'wh-sig-name-text');
        tdName.append(nameSpan);
        const guide = signatureGuide(s);
        const guideLink = make('a', guide.label, 'wh-sig-guide-link');
        guideLink.href = guide.url; guideLink.target = '_blank'; guideLink.rel = 'noopener noreferrer';
        guideLink.onclick = (event) => { event.preventDefault(); void call('open_url', {url:guide.url}).catch(() => this.showWaypointToast('Unable to open the guide in your browser.')); };
        tdName.append(make('div', guide.status, 'wh-sig-scan-status'), guideLink);
        if (s.notes) {
          const notesSpan = make('span', ` ${s.notes}`, 'wh-sig-notes-inline');
          notesSpan.title = s.notes;
          tdName.append(notesSpan);
        }

        // Signal % cell
        const tdSig = make('td', '', 'wh-sig-col-signal');
        const pct = Math.max(0, Math.min(100, s.signalPct ?? 100));
        const progContainer = make('div', '', 'wh-sig-meter');
        const progFill = make('div', '', `wh-sig-meter-fill ${pct >= 100 ? 'pct-100' : pct >= 75 ? 'pct-75' : pct >= 50 ? 'pct-50' : 'pct-low'}`);
        progFill.style.width = `${pct}%`;
        const progLabel = make('span', `${pct.toFixed(0)}%`, 'wh-sig-meter-label');
        progContainer.append(progFill, progLabel);
        progContainer.title = `Signal strength: ${pct.toFixed(1)}%`;
        tdSig.append(progContainer);

        // Age cell
        const tdAge = make('td', formatRelativeAge(s.scannedAt), 'wh-sig-col-age');

        // Actions cell
        const tdActions = make('td', '', 'wh-sig-col-actions');

        // Wormhole connect button if group is Wormhole and not linked yet
        if ((s.group || '').toLowerCase().includes('wormhole')) {
          const connBtn = make('button', '+ Connect', 'wh-sig-btn wh-sig-btn-connect');
          connBtn.title = `Add connected system from wormhole ${s.id}`;
          connBtn.onclick = () => this.showAddConnectionModal(s.id);
          tdActions.append(connBtn);
        }

        // Copy bookmark
        const copyBmBtn = make('button', '', 'wh-sig-btn'); copyBmBtn.innerHTML = getLucideSvg('copy', { size: 14 });
        copyBmBtn.setAttribute('aria-label', `Copy bookmark for ${s.id}`);
        copyBmBtn.title = 'Copy standard EVE in-game bookmark string';
        copyBmBtn.onclick = () => {
          let bm = '';
          const isWh = (s.group || '').toLowerCase().includes('wormhole');
          const linkedLink = s.linkedLinkId
            ? this.links.find(l => l.id === s.linkedLinkId)
            : this.links.find(l => l.sourceSig === s.id || l.targetSig === s.id);

          if (isWh && linkedLink) {
            const isSource = linkedLink.sourceSig === s.id;
            const destSysId = isSource ? linkedLink.targetId : linkedLink.sourceId;
            const destSysInfo = universeGraph.getSystemInfo(destSysId);
            const destSysName = destSysInfo?.name || this.nodes.get(destSysId)?.systemName || 'Unknown';
            const destSec = destSysInfo?.security;
            const destStatics = getSystemStatics(destSysId) || getSystemStatics(destSysName);
            const destClass = destStatics?.whClass || getWormholeClass(destSysId, destSec);
            const destEffect = destStatics?.effect || this.nodes.get(destSysId)?.effect;

            bm = generateWormholeBookmark({
              sigId: s.id,
              targetSpaceType: linkedLink.customType,
              isStatic: linkedLink.whCode ? linkedLink.whCode !== 'K162' : true,
              targetSystemName: destSysName,
              targetSecurity: destSec,
              targetClass: destClass,
              targetEffect: destEffect,
              whCode: linkedLink.whCode,
              isEol: linkedLink.lifetimeStatus === 'eol',
              isCrit: linkedLink.massStatus === 'critical',
              isFrigate: Boolean(linkedLink.isFrigateOnly || isFrigateHole(linkedLink.whCode))
            });
          } else if (isWh && this.targetedSignature && this.targetedSignature.sigId === s.id) {
            const tgt = this.targetedSignature;
            bm = generateWormholeBookmark({
              sigId: s.id,
              targetSpaceType: tgt.spaceType,
              isStatic: tgt.isStatic,
              targetSystemName: '[Destination]',
              targetSecurity: tgt.spaceType === 'NS' ? -0.9 : tgt.spaceType === 'HS' ? 0.7 : tgt.spaceType === 'LS' ? 0.3 : undefined,
              whCode: tgt.whCode,
              isEol: tgt.isEol,
              isCrit: tgt.isCrit,
              isFrigate: tgt.isFrig
            });
          } else {
            bm = formatBookmarkString(s);
          }
          void copyToClipboard(bm);
          this.showWaypointToast(`Copied: "${bm}"`);
        };
        tdActions.append(copyBmBtn);

        // Edit signature
        const editSigBtn = make('button', '', 'wh-sig-btn'); editSigBtn.innerHTML = getLucideSvg('edit', { size: 14 });
        editSigBtn.setAttribute('aria-label', `Edit signature ${s.id}`);
        editSigBtn.title = 'Edit signature details or notes';
        editSigBtn.onclick = () => this.showEditSignatureModal(systemId, s.id);
        tdActions.append(editSigBtn);

        // Delete signature
        const delSigBtn = make('button', 'Delete', 'wh-sig-btn wh-sig-btn-del');
        delSigBtn.type = 'button';
        delSigBtn.setAttribute('aria-label', `Delete signature ${s.id}`);
        delSigBtn.title = `Delete signature ${s.id}`;
        delSigBtn.onclick = () => {
          const curList = this.signatures.get(systemId) || [];
          this.signatures.set(systemId, curList.filter(x => x.id !== s.id));
          this.saveToStorage();
          this.renderInspector(inspector);
          this.renderChainContentOnly();
        };
        tdActions.append(delSigBtn);

        tr.append(tdId, tdGroup, tdName, tdSig, tdAge, tdActions);
        tbody.append(tr);
      }
      table.append(tbody);
      tableWrapper.append(table);
      sigSection.append(tableWrapper);
    }
    rundownBox.after(sigSection);

  }

  private sendOverlayEvent(event: Record<string, unknown>) {
    if (!this.hasBackendGrant()) return;
    const message = { ...event, accessGrant: this.backendGrant, source: 'daytripper' };
    this.broadcastChannel?.postMessage(message);
    if (native) void emitEvent('wok_daytripper_channel', message);
  }

  public showK162CatchModal(linkId: string, fromId: number, fromName: string, toId: number, toName: string, sourceSigId: string) {
    const existing = document.querySelector('.wh-k162-catch-modal');
    if (existing) existing.remove();

    const link = this.links.find(l => l.id === linkId);
    if (!link) return;

    this.pendingK162Link = link;
    this.pendingK162 = { requestId: `${this.activeMapId}:${linkId}:${Date.now()}`, mapId: this.activeMapId, linkId, fromId, fromName, toId, toName, sourceSigId };
    this.sendOverlayEvent({ type: 'k162_catch', request: this.pendingK162 });
    if (native) void call('open_module', { id: 'mapping-overlay' }).catch(() => {
      this.showWaypointToast('Open the Mapping HUD to assign the return connection.');
    });

    const modal = make('div', '', 'wh-modal-overlay wh-k162-catch-modal');
    const box = make('div', '', 'wh-modal-box');
    box.style.maxWidth = '460px';

    const header = make('div', '', 'wh-modal-header');
    const iconSpan = make('span', '', 'wh-modal-icon');
    iconSpan.innerHTML = getLucideSvg('git-merge', { size: 18 });
    const titleText = make('h3', 'K162 Return Connection Catch', 'wh-modal-title');
    header.append(iconSpan, titleText);
    box.append(header);

    const desc = make('p', '', 'wh-modal-desc');
    desc.style.fontSize = '11px';
    desc.style.color = 'var(--wok-text-secondary)';
    desc.style.margin = '6px 0 12px 0';
    desc.innerHTML = `You jumped through K162 <strong>${escapeDaytripperText(sourceSigId)}</strong> from <strong>${escapeDaytripperText(fromName)}</strong> into <strong>${escapeDaytripperText(toName)}</strong>. Identify the wormhole from this side to lock in mass limits:`;
    box.append(desc);

    const form = make('div', '', 'wh-form');

    // 1. System Statics Quick Buttons (if any)
    const toStatics = getSystemStatics(toId)?.statics || getSystemStatics(toName)?.statics || this.nodes.get(toId)?.statics || [];
    const fromInfo = universeGraph.getSystemInfo(fromId);
    const fromClass = this.nodes.get(fromId)?.whClass || getWormholeClass(fromId, fromInfo?.security);

    if (toStatics.length > 0) {
      const staticsGroup = make('div', '', 'wh-form-row');
      staticsGroup.append(make('label', `${toName} Known Statics:`));
      const chipContainer = make('div', '', 'wh-prejump-chips');

      for (const sc of toStatics) {
        const spec = WORMHOLE_CODES[sc.toUpperCase()];
        const targetSpace = spec ? spec.targetSpace : 'Unknown';
        const isProbable = Boolean(spec && fromClass && (
          spec.targetSpace.toLowerCase().includes(fromClass.toLowerCase()) ||
          (fromClass === 'Highsec' && spec.targetSpace.toLowerCase().includes('high')) ||
          (fromClass === 'Lowsec' && spec.targetSpace.toLowerCase().includes('low')) ||
          (fromClass === 'Nullsec' && spec.targetSpace.toLowerCase().includes('null')) ||
          (fromClass.startsWith('C') && spec.targetSpace.toUpperCase().startsWith(fromClass.toUpperCase()))
        ));

        const capMkg = spec && spec.maxMassTons >= 100_000 ? Math.round(spec.maxMassTons / 1000) : (spec?.maxMassTons || 2000);
        const label = `Static ${sc} (${targetSpace}${isProbable ? ' - Match' : ''})`;
        const btn = make('button', label, `wh-prejump-chip ${isProbable ? 'active' : ''}`) as HTMLButtonElement;
        btn.type = 'button';
        btn.title = `Set return hole as Static ${sc} (${capMkg}M kg capacity)`;
        btn.onclick = () => {
          link.returnWhCode = sc;
          this.recalculateLinkMass(link);
          this.saveToStorage();
          this.render();
          modal.remove();
          this.pendingK162 = null;
          this.sendOverlayEvent({ type: 'k162_result' });
          this.showWaypointToast(`K162 return path locked to Static ${sc} (${capMkg}M kg)`);
        };
        chipContainer.append(btn);
      }
      staticsGroup.append(chipContainer);
      form.append(staticsGroup);
    }

    // 2. Select any Wandering / Non-static WH Code
    const codeRow = make('div', '', 'wh-form-row');
    codeRow.append(make('label', 'Or Select Wandering Wormhole Code:'));
    const codeSelect = document.createElement('select');
    codeSelect.className = 'wh-input';
    codeSelect.add(new Option('-- Select WH Code --', ''));
    for (const [c, sp] of Object.entries(WORMHOLE_CODES)) {
      if (c === 'K162') continue;
      const cap = sp.maxMassTons >= 100000 ? `${Math.round(sp.maxMassTons / 1000)}M kg` : `${sp.maxMassTons}t`;
      codeSelect.add(new Option(`${c} (${sp.targetSpace}, ${cap})`, c));
    }
    codeRow.append(codeSelect);
    form.append(codeRow);

    // 3. Return signature ID on this side (optional)
    const sigRow = make('div', '', 'wh-form-row');
    sigRow.append(make('label', `Signature ID in ${toName} (optional):`));
    const sigInput = document.createElement('input');
    sigInput.className = 'wh-input';
    sigInput.placeholder = 'e.g. XYZ-123';
    sigInput.value = link.targetSig || '';
    sigRow.append(sigInput);
    form.append(sigRow);

    box.append(form);

    // Actions
    const actionsRow = make('div', '', 'wh-modal-actions');
    const saveBtn = make('button', 'Confirm Return Connection', 'map-btn');
    saveBtn.onclick = () => {
      const chosen = codeSelect.value;
      if (chosen) {
        link.returnWhCode = chosen;
      }
      if (sigInput.value.trim()) {
        link.targetSig = sigInput.value.trim().toUpperCase();
        const toSigs = this.signatures.get(toId) || [];
        const sItem = toSigs.find(s => s.id.toUpperCase() === link.targetSig);
        if (sItem) sItem.linkedLinkId = link.id;
      }
      this.recalculateLinkMass(link);
      this.saveToStorage();
      this.render();
      modal.remove();
      this.pendingK162 = null;
      this.sendOverlayEvent({ type: 'k162_result' });
      if (chosen) {
        this.showWaypointToast(`K162 return connection saved as ${chosen}`);
      }
    };

    const skipBtn = make('button', 'Skip / Identify Later', 'map-btn map-btn-secondary');
    skipBtn.onclick = () => modal.remove();

    actionsRow.append(saveBtn, skipBtn);
    box.append(actionsRow);
    modal.append(box);
    document.body.append(modal);
  }

  private showAddConnectionModal(initialSig = '') {
    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box');
    box.append(make('h3', 'Add Connected Wormhole System'));

    const form = make('div', '', 'wh-form-grid');

    // Source system selector
    const sourceLabel = make('label', 'From System:');
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'wh-input';
    for (const [id, n] of this.nodes) {
      const opt = new Option(n.systemName, String(id));
      if (id === this.selectedSystemId) opt.selected = true;
      sourceSelect.add(opt);
    }
    form.append(sourceLabel, sourceSelect);

    // Destination System Input
    const destLabel = make('label', 'To System Name (e.g. J123456 or System Name):');
    const destInput = document.createElement('input');
    destInput.placeholder = 'J123456';
    destInput.className = 'wh-input';
    form.append(destLabel, destInput);

    // Signature ID Input
    const sigLabel = make('label', 'Signature ID (optional):');
    const sigInput = document.createElement('input');
    sigInput.placeholder = 'ABC-123';
    sigInput.value = initialSig;
    sigInput.className = 'wh-input';
    form.append(sigLabel, sigInput);

    // Wormhole Code Selector
    const codeLabel = make('label', 'Wormhole Code (optional):');
    const codeSelect = document.createElement('select');
    codeSelect.className = 'wh-input';
    codeSelect.add(new Option('-- Select Wormhole Code --', ''));
    for (const code of Object.keys(WORMHOLE_CODES)) {
      const spec = WORMHOLE_CODES[code];
      codeSelect.add(new Option(`${code} (${spec.targetSpace})`, code));
    }
    form.append(codeLabel, codeSelect);

    box.append(form);

    const row = make('div', '', 'wh-modal-actions');
    const saveBtn = make('button', 'Add Connection', 'map-btn');
    saveBtn.onclick = () => {
      const targetName = destInput.value.trim();
      if (!targetName) return;

      const sourceId = Number(sourceSelect.value);
      // Determine pseudo system ID if not in DB
      let targetId = 31000000 + Math.floor(Math.random() * 900000);
      const statics = getSystemStatics(targetName);
      if (statics) targetId = statics.systemId;

      const targetClass = statics ? statics.whClass : (codeSelect.value ? WORMHOLE_CODES[codeSelect.value]?.targetSpace : 'W-Space') || 'W-Space';

      this.addWormholeConnection(sourceId, targetId, targetName, targetClass, codeSelect.value || undefined, sigInput.value.trim() || undefined);
      modal.remove();
    };

    const cancelBtn = make('button', 'Cancel', 'map-btn map-btn-secondary');
    cancelBtn.onclick = () => modal.remove();

    row.append(saveBtn, cancelBtn);
    box.append(row);
    modal.append(box);
    document.body.append(modal);
    destInput.focus();
  }

  public async checkScannerClipboardAutoscan() {
    if (native) return; // Never auto-read existing clipboard on desktop focus.
    if (localStorage.getItem('wok.daytripperAutoscan') === '0') return;
    try {
      const text = await navigator.clipboard.readText();
      if (text && (text.includes('Cosmic Signature') || text.includes('Cosmic Anomaly'))) {
        this.handleScannerAutoscan(text);
      }
    } catch {
      /* ignore */
    }
  }

  public handleScannerAutoscan(text: string) {
    if (localStorage.getItem('wok.daytripperAutoscan') === '0') return;
    if (!text || text.length < 10) return;
    if (!text.includes('Cosmic Signature') && !text.includes('Cosmic Anomaly') && !text.includes('Unstable Wormhole')) {
      return;
    }
    const targetSystemId = (this.activeCharacters.find(c => c.isScanner && c.isOnline && this.nodes.has(c.systemId))?.systemId)
      || (this.activeCharacters.find(c => c.isOnline && this.nodes.has(c.systemId))?.systemId)
      || (this.selectedSystemId && this.nodes.has(this.selectedSystemId) ? this.selectedSystemId : null)
      || (this.nodes.size > 0 ? this.nodes.keys().next().value : null);

    if (!targetSystemId || !this.nodes.has(targetSystemId)) return;

    try {
      const incoming = parseProbeScannerText(text);
      if (!incoming.length) return;
      this.signatures.set(targetSystemId, mergeScannedSignatures(this.signatures.get(targetSystemId) || [], incoming));
      this.selectedSystemId = targetSystemId;
      this.saveToStorage();
      this.render();
      this.showWaypointToast(`Auto-scanned ${incoming.length} signatures from Probe Scanner`);
    } catch {
      /* invalid probe scanner rows, ignore */
    }
  }

  private async importScannerClipboard(systemId: number | null = this.selectedSystemId) {
    if (!systemId) return;
    const mapId = this.activeMapId;
    let text: string;
    try { text = await navigator.clipboard.readText(); }
    catch { this.showScannerImportModal(systemId, 'Clipboard access unavailable. Paste Probe Scanner rows below.'); return; }
    if (this.activeMapId !== mapId || !this.nodes.has(systemId)) {
      this.showWaypointToast('Map changed while reading clipboard. Select the system and retry.'); return;
    }
    try { this.importScannerText(text, systemId); }
    catch (error) { this.showWaypointToast((error as Error).message); }
  }

  private importScannerText(text: string, systemId: number) {
    const incoming = parseProbeScannerText(text);
    if (!this.nodes.has(systemId)) throw new Error('The selected system is no longer on this map.');
    this.signatures.set(systemId, mergeScannedSignatures(this.signatures.get(systemId) || [], incoming));
    this.selectedSystemId = systemId;
    this.saveToStorage();
    this.render();
    this.showWaypointToast(`Imported ${incoming.length} Probe Scanner results`);
  }

  private showScannerImportModal(systemId = this.selectedSystemId, message = 'Paste rows copied from the EVE Probe Scanner. Unresolved signatures are accepted.') {
    if (!systemId) return;
    const mapId = this.activeMapId;
    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box');
    box.append(make('h3', 'Paste Probe Scanner results'));
    const status = make('p', message); status.setAttribute('role','status'); box.append(status);
    const textarea = document.createElement('textarea'); textarea.className='wh-textarea';
    textarea.setAttribute('aria-label','Probe Scanner results');
    textarea.placeholder='ABC-123\tCosmic Signature\t\t\t0.0%\t1.50 AU';box.append(textarea);
    const row=make('div','','wh-modal-actions');const importBtn=make('button','Import signatures','map-btn');
    importBtn.onclick=()=>{
      try { if(this.activeMapId!==mapId)throw new Error('Map changed. Close this dialog and retry.');this.importScannerText(textarea.value,systemId);modal.remove(); }
      catch(error){status.textContent=(error as Error).message;}
    };
    const cancelBtn=make('button','Cancel','map-btn map-btn-secondary');cancelBtn.onclick=()=>modal.remove();
    row.append(importBtn,cancelBtn);box.append(row);modal.append(box);document.body.append(modal);textarea.focus();
  }

  private showAddSignatureModal(systemId: number) {
    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box');
    const sysNode = this.nodes.get(systemId);
    box.append(make('h3', `Add Signature to ${sysNode?.systemName || 'System'}`));

    const form = make('div', '', 'wh-form-grid');

    const idRow = make('div', '', 'wh-form-row');
    idRow.append(make('label', 'Signature ID (e.g. ABC-123):'));
    const idInput = document.createElement('input');
    idInput.className = 'wh-input';
    idInput.placeholder = 'ABC-123';
    idRow.append(idInput);
    form.append(idRow);

    const grpRow = make('div', '', 'wh-form-row');
    grpRow.append(make('label', 'Group:'));
    const grpSelect = document.createElement('select');
    grpSelect.className = 'wh-input';
    const groups: Array<ScannedSignature['group']> = ['Wormhole', 'Relic', 'Data', 'Gas', 'Combat', 'Unknown'];
    for (const g of groups) grpSelect.add(new Option(g, g));
    grpRow.append(grpSelect);
    form.append(grpRow);

    const nameRow = make('div', '', 'wh-form-row');
    nameRow.append(make('label', 'Name / Site Type:'));
    const nameInput = document.createElement('input');
    nameInput.className = 'wh-input';
    nameInput.placeholder = 'e.g. Unstable Wormhole, Forgotten Perimeter, Core Reservoir';
    nameRow.append(nameInput);
    form.append(nameRow);

    const sigRow = make('div', '', 'wh-form-row');
    sigRow.append(make('label', 'Signal Strength % (0 - 100):'));
    const sigPctInput = document.createElement('input');
    sigPctInput.type = 'number';
    sigPctInput.className = 'wh-input';
    sigPctInput.min = '0';
    sigPctInput.max = '100';
    sigPctInput.value = '100';
    sigRow.append(sigPctInput);
    form.append(sigRow);

    const notesRow = make('div', '', 'wh-form-row');
    notesRow.append(make('label', 'Notes:'));
    const notesInput = document.createElement('input');
    notesInput.className = 'wh-input';
    notesInput.placeholder = 'e.g. Frigate hole, sleeper wave active, mined 50%';
    notesRow.append(notesInput);
    form.append(notesRow);

    box.append(form);

    const actions = make('div', '', 'wh-modal-actions');
    const saveBtn = make('button', 'Save Signature', 'map-btn');
    saveBtn.onclick = () => {
      const sigId = idInput.value.trim().toUpperCase();
      if (!sigId) return;
      const cur = this.signatures.get(systemId) || [];
      const newSig: ScannedSignature = {
        id: sigId,
        group: grpSelect.value as ScannedSignature['group'],
        name: nameInput.value.trim() || grpSelect.value,
        signalPct: Number(sigPctInput.value) || 100,
        scannedAt: Date.now(),
        notes: notesInput.value.trim() || undefined
      };
      const existingIdx = cur.findIndex(s => s.id === sigId);
      if (existingIdx !== -1) {
        cur[existingIdx] = { ...cur[existingIdx], ...newSig };
      } else {
        cur.push(newSig);
      }
      this.signatures.set(systemId, cur);
      this.saveToStorage();
      modal.remove();
      this.render();
      this.showWaypointToast(`Added signature ${sigId}`);
    };

    const cancelBtn = make('button', 'Cancel', 'map-btn map-btn-secondary');
    cancelBtn.onclick = () => modal.remove();

    actions.append(saveBtn, cancelBtn);
    box.append(actions);
    modal.append(box);
    document.body.append(modal);
    idInput.focus();
  }

  private showEditSignatureModal(systemId: number, sigId: string) {
    const curList = this.signatures.get(systemId) || [];
    const sig = curList.find(s => s.id === sigId);
    if (!sig) return;

    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box');
    box.append(make('h3', `Edit Signature: ${sig.id}`));

    const form = make('div', '', 'wh-form-grid');

    const idRow = make('div', '', 'wh-form-row');
    idRow.append(make('label', 'Signature ID:'));
    const idInput = document.createElement('input');
    idInput.className = 'wh-input';
    idInput.value = sig.id;
    idRow.append(idInput);
    form.append(idRow);

    const grpRow = make('div', '', 'wh-form-row');
    grpRow.append(make('label', 'Group:'));
    const grpSelect = document.createElement('select');
    grpSelect.className = 'wh-input';
    const groups: Array<ScannedSignature['group']> = ['Wormhole', 'Relic', 'Data', 'Gas', 'Combat', 'Unknown'];
    for (const g of groups) {
      const opt = new Option(g, g);
      if (sig.group === g) opt.selected = true;
      grpSelect.add(opt);
    }
    grpRow.append(grpSelect);
    form.append(grpRow);

    const nameRow = make('div', '', 'wh-form-row');
    nameRow.append(make('label', 'Name / Site Type:'));
    const nameInput = document.createElement('input');
    nameInput.className = 'wh-input';
    nameInput.value = sig.name;
    nameRow.append(nameInput);
    form.append(nameRow);

    const sigRow = make('div', '', 'wh-form-row');
    sigRow.append(make('label', 'Signal Strength %:'));
    const sigPctInput = document.createElement('input');
    sigPctInput.type = 'number';
    sigPctInput.className = 'wh-input';
    sigPctInput.min = '0';
    sigPctInput.max = '100';
    sigPctInput.value = String(sig.signalPct ?? 100);
    sigRow.append(sigPctInput);
    form.append(sigRow);

    const notesRow = make('div', '', 'wh-form-row');
    notesRow.append(make('label', 'Notes:'));
    const notesInput = document.createElement('input');
    notesInput.className = 'wh-input';
    notesInput.value = sig.notes || '';
    notesRow.append(notesInput);
    form.append(notesRow);

    box.append(form);

    const actions = make('div', '', 'wh-modal-actions');
    const saveBtn = make('button', 'Save Changes', 'map-btn');
    saveBtn.onclick = () => {
      const updatedId = idInput.value.trim().toUpperCase() || sig.id;
      sig.id = updatedId;
      sig.group = grpSelect.value as ScannedSignature['group'];
      sig.name = nameInput.value.trim() || grpSelect.value;
      sig.signalPct = Number(sigPctInput.value) || 100;
      sig.notes = notesInput.value.trim() || undefined;
      this.saveToStorage();
      modal.remove();
      this.render();
      this.showWaypointToast(`Updated signature ${sig.id}`);
    };

    const cancelBtn = make('button', 'Cancel', 'map-btn map-btn-secondary');
    cancelBtn.onclick = () => modal.remove();

    actions.append(saveBtn, cancelBtn);
    box.append(actions);
    modal.append(box);
    document.body.append(modal);
  }

  private showRollingCalculatorModal(linkId: string) {
    const link = this.links.find(l => l.id === linkId);
    if (!link) return;

    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box wh-roll-modal-box');
    box.append(make('h3', 'Wormhole Mass & Jump Log'));

    const sourceNode = this.nodes.get(link.sourceId);
    const targetNode = this.nodes.get(link.targetId);
    const fromName = sourceNode?.systemName || `System #${link.sourceId}`;
    const toName = targetNode?.systemName || `System #${link.targetId}`;
    const whSpec = getLinkWhSpec(link);

    const subHeader = make('div', '', 'wh-roll-subhdr');
    const connLabel = make('strong', `${fromName} ⇄ ${toName}`);
    subHeader.append(connLabel);
    if (link.whCode) {
      const codeDisplay = link.returnWhCode ? `[${link.whCode} ⇄ ${link.returnWhCode}]` : `[${link.whCode}]`;
      subHeader.append(make('span', codeDisplay, 'wh-vector-code'));
    }
    if (link.isFrigateOnly || isFrigateHole(link.whCode, link.shipSize)) {
      subHeader.append(make('span', 'FRIGATE ONLY (≤5,000t)', 'wh-vector-frig-badge'));
    } else if (whSpec?.maxJumpMassTons) {
      const maxJumpMkg = whSpec.maxJumpMassTons >= 1000 ? Math.round(whSpec.maxJumpMassTons / 1000) : whSpec.maxJumpMassTons;
      subHeader.append(make('span', `Max Single Jump: ${maxJumpMkg.toLocaleString()}M kg`, 'wh-static-badge'));
    }
    box.append(subHeader);

    // If K162 without identified return code, offer instant return code selector
    if (link.whCode === 'K162' && !link.returnWhCode) {
      const k162Notice = make('div', '', 'wh-roll-k162-notice');
      k162Notice.append(make('strong', 'K162 Incoming Connection: Origin Type Unknown'));
      k162Notice.append(make('span', 'Set the origin wormhole code (from return side or system static) to enable rolling mass calculations:'));

      const setRow = make('div', '', 'wh-flex-row-gap');
      const retSelect = document.createElement('select');
      retSelect.className = 'wh-input wh-input-xs';
      retSelect.style.width = '240px';
      retSelect.add(new Option('-- Select Return WH Code --', ''));
      for (const [codeKey, sp] of Object.entries(WORMHOLE_CODES)) {
        if (codeKey === 'K162') continue;
        const cap = sp.maxMassTons >= 100000 ? `${Math.round(sp.maxMassTons / 1000)}M kg` : `${sp.maxMassTons}t`;
        retSelect.add(new Option(`${codeKey} -> ${sp.targetSpace} (${cap})`, codeKey));
      }
      const applyBtn = make('button', 'Set Return Code', 'map-btn map-btn-xs');
      applyBtn.onclick = () => {
        if (retSelect.value) {
          link.returnWhCode = retSelect.value;
          this.recalculateLinkMass(link);
          modal.remove();
          this.showRollingCalculatorModal(linkId);
        }
      };
      setRow.append(retSelect, applyBtn);
      k162Notice.append(setRow);
      box.append(k162Notice);
    }

    // Total mass capacity in Millions of kg (M kg)
    const totalMassKg = wormholeLinkCapacityKg(link, whSpec);
    const totalMassMkg = totalMassKg === null ? null : Math.round(totalMassKg / 1_000_000);

    // Recalculate jumped mass from jumpLog if available
    if (Array.isArray(link.jumpLog) && link.jumpLog.length > 0) {
      link.massJumpedKg = link.jumpLog.reduce((acc, j) => acc + (j.massKg || 0), 0);
    }
    const currentJumpedKg = link.massJumpedKg || 0;
    const jumpedMkg = Math.round(currentJumpedKg / 1_000_000);
    const remainingKg = totalMassKg === null ? null : Math.max(0, totalMassKg - currentJumpedKg);
    const remainingMkg = remainingKg === null ? null : Math.max(0, Math.round(remainingKg / 1_000_000));
    const pctJumped = totalMassKg === null ? null : Math.min(100, Math.round((currentJumpedKg / totalMassKg) * 100));

    // Stats Grid
    const statsGrid = make('div', '', 'wh-roll-stats');
    statsGrid.append(make('div', totalMassMkg === null ? 'Total Capacity: Unknown' : `Total Capacity: ${totalMassMkg.toLocaleString()}M kg`, 'wh-roll-stat'));
    statsGrid.append(make('div', pctJumped === null ? `Mass Jumped: ${jumpedMkg.toLocaleString()}M kg (capacity Unknown)` : `Mass Jumped: ${jumpedMkg.toLocaleString()}M kg (${pctJumped}%)`, 'wh-roll-stat'));
    statsGrid.append(make('div', remainingMkg === null ? 'Est. Remaining: Unknown' : `Est. Remaining: ${remainingMkg.toLocaleString()}M kg`, 'wh-roll-stat'));
    const stageLabel = link.massStatus === 'critical' ? 'Critical (<10%)' : (link.massStatus === 'half' ? 'Half Mass (<50%)' : 'Stable (>50%)');
    statsGrid.append(make('div', totalMassKg === null ? `Manual status: ${link.massStatus}` : `Stage: ${stageLabel}`, 'wh-roll-stat'));
    box.append(statsGrid);

    // Visual Progress Bar
    const barOuter = make('div', '', 'wh-roll-bar-outer');
    const barInner = make('div', '', 'wh-roll-bar-inner');
    barOuter.hidden = totalMassKg === null;
    barInner.style.width = `${pctJumped ?? 0}%`;
    if (pctJumped !== null && pctJumped >= 90) barInner.classList.add('crit');
    else if (pctJumped !== null && pctJumped >= 50) barInner.classList.add('half');
    barOuter.append(barInner);
    box.append(barOuter);

    // Section 1: Attached Jump & Mass Log
    const logSection = make('div', '', 'wh-jump-log-section');
    const logHdr = make('div', '', 'wh-jump-log-hdr');
    const logCount = link.jumpLog?.length || 0;
    logHdr.append(make('h4', `Attached Jump Log (${logCount} ${logCount === 1 ? 'jump' : 'jumps'} tracked)`, 'wh-section-title'));
    logSection.append(logHdr);

    const logList = make('div', '', 'wh-jump-log-list');
    if (!link.jumpLog || link.jumpLog.length === 0) {
      logList.append(make('div', 'No jumps logged yet. Jumps are tracked automatically when pilots traverse this wormhole, or you can record fleet passes below.', 'wh-empty-msg'));
    } else {
      for (let idx = link.jumpLog.length - 1; idx >= 0; idx--) {
        const j = link.jumpLog[idx];
        const row = make('div', '', 'wh-jump-log-row');

        // Left info: Time + Pilot + Ship
        const left = make('div', '', 'wh-jump-log-left');
        const timeStr = new Date(j.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const timeEl = make('span', timeStr, 'wh-jump-time');
        const pilotEl = make('strong', j.characterName, 'wh-jump-pilot');
        const shipInfo = make('span', `${j.shipTypeName || 'Ship'}${j.shipName && j.shipName !== j.shipTypeName ? ` · ${j.shipName}` : ''}`, 'wh-jump-ship');
        left.append(timeEl, pilotEl, shipInfo);

        // Center info: Direction
        const dirEl = make('span', `${j.fromSystemName || 'System'} -> ${j.toSystemName || 'System'}`, 'wh-jump-dir-badge');

        // Right info: Mass Toggles & Value
        const right = make('div', '', 'wh-jump-log-right');
        const isBs = resolveShipMassKg(j.shipTypeName, j.shipName).isBattleship;

        if (isBs) {
          const propGroup = make('div', '', 'wh-jump-prop-group');
          const coldBtn = make('button', 'Cold 100M', `wh-jump-prop-btn is-cold${j.massKg === 100_000_000 ? ' active' : ''}`);
          coldBtn.title = 'Set pass mass to 100M kg (Battleship Cold)';
          coldBtn.onclick = () => {
            j.massKg = 100_000_000;
            j.propState = 'cold';
            this.recalculateLinkMass(link);
            modal.remove();
            this.showRollingCalculatorModal(linkId);
          };

          const hotBtn = make('button', 'Hot 148M', `wh-jump-prop-btn is-hot${j.massKg === 148_000_000 ? ' active' : ''}`);
          hotBtn.title = 'Set pass mass to 148M kg (Battleship Hot MWD)';
          hotBtn.onclick = () => {
            j.massKg = 148_000_000;
            j.propState = 'hot';
            this.recalculateLinkMass(link);
            modal.remove();
            this.showRollingCalculatorModal(linkId);
          };

          const higgsColdBtn = make('button', 'Higgs Cold 200M', `wh-jump-prop-btn is-higgs${j.massKg === 200_000_000 ? ' active' : ''}`);
          higgsColdBtn.title = 'Set pass mass to 200M kg (Higgs Anchor Rig Cold)';
          higgsColdBtn.onclick = () => {
            j.massKg = 200_000_000;
            j.propState = 'higgs';
            this.recalculateLinkMass(link);
            modal.remove();
            this.showRollingCalculatorModal(linkId);
          };

          const higgsHotBtn = make('button', 'Higgs Hot 300M', `wh-jump-prop-btn is-higgs-hot${j.massKg === 300_000_000 ? ' active' : ''}`);
          higgsHotBtn.title = 'Set pass mass to 300M kg (Higgs Anchor Rig + Hot MWD)';
          higgsHotBtn.onclick = () => {
            j.massKg = 300_000_000;
            j.propState = 'hot';
            this.recalculateLinkMass(link);
            modal.remove();
            this.showRollingCalculatorModal(linkId);
          };

          propGroup.append(coldBtn, hotBtn, higgsColdBtn, higgsHotBtn);
          right.append(propGroup);
        } else {
          const massVal = make('span', formatMassKg(j.massKg), 'wh-jump-mass-val');
          right.append(massVal);
        }

        // Delete button
        const delBtn = make('button', '', 'wh-jump-del-btn'); delBtn.innerHTML = getLucideSvg('x', { size: 14 });
        delBtn.title = 'Remove this jump from connection log';
        delBtn.onclick = () => {
          link.jumpLog?.splice(idx, 1);
          this.recalculateLinkMass(link);
          modal.remove();
          this.showRollingCalculatorModal(linkId);
        };
        right.append(delBtn);

        row.append(left, dirEl, right);
        logList.append(row);
      }
    }
    logSection.append(logList);
    box.append(logSection);

    // Section 2: Quick Add Manual Rolling / Fleet Passes
    box.append(make('h4', 'Record Fleet Jump / Rolling Pass:', 'wh-section-title'));
    const passBtns = make('div', '', 'wh-pass-btn-grid');

    const addManualPass = (hullLabel: string, kg: number, propState: 'cold' | 'hot' | 'higgs' | 'custom' = 'cold') => {
      if (!link.jumpLog) link.jumpLog = [];
      link.jumpLog.push({
        id: `jump-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        characterName: 'Fleet Member',
        shipTypeName: hullLabel,
        fromSystemId: link.sourceId,
        toSystemId: link.targetId,
        fromSystemName: fromName,
        toSystemName: toName,
        direction: 'out',
        massKg: kg,
        propState
      });
      this.recalculateLinkMass(link);
      modal.remove();
      this.showRollingCalculatorModal(linkId);
    };

    const makePassBtn = (text: string, hull: string, kg: number, pState: 'cold' | 'hot' | 'higgs' | 'custom') => {
      const b = make('button', text, 'map-btn map-btn-secondary');
      b.onclick = () => addManualPass(hull, kg, pState);
      return b;
    };

    passBtns.append(
      makePassBtn('+ BS Hot MWD (148M)', 'Battleship', 148_000_000, 'hot'),
      makePassBtn('+ BS Cold (100M)', 'Battleship', 100_000_000, 'cold'),
      makePassBtn('+ BS Higgs Hot (300M)', 'Battleship (Higgs)', 300_000_000, 'hot'),
      makePassBtn('+ BS Higgs Cold (200M)', 'Battleship (Higgs)', 200_000_000, 'higgs'),
      makePassBtn('+ Battlecruiser (15M)', 'Battlecruiser', 15_000_000, 'cold'),
      makePassBtn('+ Cruiser / T3C (13M)', 'Cruiser', 13_000_000, 'cold'),
      makePassBtn('+ Frigate / Scout (1.2M)', 'Frigate', 1_200_000, 'cold')
    );

    const customBtn = make('button', '+ Custom Pass...', 'map-btn map-btn-secondary');
    customBtn.onclick = () => {
      const mKgStr = prompt('Enter mass applied in Millions of kg (e.g. 100 for 100M kg, 148 for Hot BS):', '100');
      if (mKgStr) {
        const val = parseFloat(mKgStr);
        if (!isNaN(val) && val > 0) {
          addManualPass('Custom Ship', Math.round(val * 1_000_000), 'custom');
        }
      }
    };
    passBtns.append(customBtn);
    box.append(passBtns);

    // Section 3: Manual Stage Overrides & Reset
    const footerControls = make('div', '', 'wh-roll-footer-controls');

    const stageGroup = make('div', '', 'wh-roll-stage-group');
    stageGroup.append(make('span', 'Force Stage Override:', 'wh-roll-stage-label'));
    const makeStageBtn = (label: string, stage: 'stable' | 'half' | 'critical') => {
      const b = make('button', label, `wh-status-btn ${link.massStatus === stage ? 'active' : ''}`);
      b.onclick = () => {
        link.massStatus = stage;
        this.saveToStorage();
        modal.remove();
        this.showRollingCalculatorModal(linkId);
        this.render();
      };
      return b;
    };
    stageGroup.append(
      makeStageBtn('Stable (>50%)', 'stable'),
      makeStageBtn('Half Mass (<50%)', 'half'),
      makeStageBtn('Critical Mass (<10%)', 'critical')
    );
    footerControls.append(stageGroup);

    const resetBtn = make('button', 'Reset Mass Log (0 kg)', 'map-btn map-btn-danger map-btn-xs');
    resetBtn.onclick = async () => {
      if (await this.confirmAction(`Clear all jump log entries and reset mass to 0 kg for ${fromName} ⇄ ${toName}?`)) {
        link.jumpLog = [];
        link.massJumpedKg = 0;
        link.massStatus = 'stable';
        this.saveToStorage();
        modal.remove();
        this.showRollingCalculatorModal(linkId);
        this.render();
      }
    };
    footerControls.append(resetBtn);
    box.append(footerControls);

    const closeBtn = make('button', 'Close', 'map-btn');
    closeBtn.onclick = () => modal.remove();
    const actionRow = make('div', '', 'wh-modal-actions');
    actionRow.append(closeBtn);
    box.append(actionRow);

    modal.append(box);
    document.body.append(modal);
  }

  private async showEveScoutModal() {
    const modal = make('div', '', 'wh-modal-overlay');
    const box = make('div', '', 'wh-modal-box wh-drawer-box');
    box.append(make('h3', 'Live EVE-Scout Connections (Thera & Turnur)'));
    const statusMsg = make('p', 'Fetching live scouted wormholes from api.eve-scout.com...', 'wh-card-desc');
    box.append(statusMsg);

    const list = make('div', '', 'wh-guides-list');
    box.append(list);

    const closeBtn = make('button', 'Close', 'map-btn');
    closeBtn.onclick = () => modal.remove();
    box.append(closeBtn);

    modal.append(box);
    document.body.append(modal);

    try {
      const res = await fetch('https://api.eve-scout.com/v2/public/signatures', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const sigs = validateScoutSnapshot(await readBoundedJson(res));
      statusMsg.textContent = `Retrieved ${sigs.length} live connections from EVE-Scout Signal Cartel:`;

      for (const s of sigs) {
        const item = make('div', '', 'wh-guide-item');
        const headerRow = make('div', '', 'wh-header-left');
        headerRow.append(make('strong', `${s.out_system_name} ⇄ ${s.in_system_name} [${(s.in_system_class || '').toUpperCase()}]`));
        headerRow.append(make('span', `${s.wh_type || 'Wormhole'} (${s.max_ship_size || 'subcap'})`, 'wh-class-badge'));
        headerRow.append(make('span', `${s.remaining_hours}h left`, 'wh-badge-timer'));
        item.append(headerRow);

        const sub = make('p', `Out Sig: ${s.out_signature} | In Sig: ${s.in_signature} | Region: ${s.in_region_name || 'J-Space'}`, 'wh-card-desc');
        item.append(sub);

        const importBtn = make('button', '+ Import Connection to Chain', 'map-btn map-btn-xs');
        importBtn.onclick = () => {
          if (!this.nodes.has(s.out_system_id)) {
            this.nodes.set(s.out_system_id, {
              systemId: s.out_system_id,
              systemName: s.out_system_name,
              whClass: s.out_system_name === 'Thera' ? 'Thera' : 'K-Space',
              depth: 0
            });
          }
          this.addWormholeConnection(
            s.out_system_id,
            s.in_system_id,
            s.in_system_name,
            (s.in_system_class || 'W-Space').toUpperCase(),
            s.wh_type,
            s.out_signature
          );
          importBtn.textContent = 'Added';
          (importBtn as HTMLButtonElement).disabled = true;
        };
        item.append(importBtn);
        list.append(item);
      }
    } catch (err) {
      statusMsg.textContent = `Could not fetch live EVE-Scout connections (${String(err)}). Check your internet connection.`;
    }
  }

  public switchScoutTab(hubTabId: 'scout-thera' | 'scout-turnur') {
    const hub = hubTabId === 'scout-thera' ? 'Thera' : 'Turnur';
    this.viewMode = 'canvas';
    this.createHubBaseMap(hub);
  }

  private async fetchScoutSignatures(forceRefresh = false): Promise<any[]> {
    if (this.scoutFetchPromise) return this.scoutFetchPromise;
    if (!forceRefresh && this.scoutSnapshotValid && this.cachedScoutSignatures && Date.now() - this.lastScoutFetchTime < 180000) return this.cachedScoutSignatures;
    this.scoutFetchPromise = (async () => {
      this.isScoutFetching = true;
      try {
        const res = await fetch('https://api.eve-scout.com/v2/public/signatures', { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        this.cachedScoutSignatures = validateScoutSnapshot(await readBoundedJson(res));
        this.scoutSnapshotValid = true;
        this.lastScoutFetchTime = Date.now();
        return this.cachedScoutSignatures;
      } catch (err) {
        this.scoutSnapshotValid = false;
        console.warn('[EVE-Scout] Failed to fetch signatures:', err);
        return this.cachedScoutSignatures || [];
      } finally { this.isScoutFetching = false; }
    })();
    try { return await this.scoutFetchPromise; } finally { this.scoutFetchPromise = null; }
  }

  private renderScoutHubView(stage: HTMLElement, hub: 'Thera' | 'Turnur') {
    stage.replaceChildren();

    const container = make('div', '', 'wh-scout-container');

    // Header bar
    const headBar = make('div', '', 'wh-scout-header');
    const titleCol = make('div', '', 'wh-scout-title-col');
    const icon = hub === 'Thera' ? 'Thera' : 'Turnur';
    titleCol.append(
      make('h3', `${icon} ${hub} Scouted Wormhole Connections`, 'wh-scout-title'),
      make('p', `Live public scouted signatures verified by EVE-Scout Signal Cartel`, 'wh-scout-subtitle')
    );

    // Active pilot banner
    const activePilot = this.activeCharacters[0];
    const pilotSysInfo = activePilot ? universeGraph.getSystemInfo(activePilot.systemId) : null;
    const pilotBadge = make('div', '', 'wh-scout-pilot-badge');
    if (activePilot) {
      const secStr = pilotSysInfo ? (pilotSysInfo.security <= -0.9 ? '-1.0' : pilotSysInfo.security.toFixed(1)) : 'J-Space';
      pilotBadge.innerHTML = `Active Pilot: <strong>${escapeDaytripperText(activePilot.name)}</strong> in <strong>${pilotSysInfo?.name || `System ${activePilot.systemId}`}</strong> (${secStr})`;
    } else {
      pilotBadge.textContent = 'Active Pilot: Offline / Unknown System';
    }

    const controls = make('div', '', 'wh-scout-controls');

    // Search filter input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'wh-input wh-scout-search';
    searchInput.placeholder = 'Filter by system, region, or sig (e.g. Jita, Forge, ABC)...';
    searchInput.value = this.scoutSearchQuery;
    searchInput.oninput = () => {
      this.scoutSearchQuery = searchInput.value;
      void renderCardsList();
    };

    // Refresh button
    const refreshBtn = make('button', 'Refresh Live Sigs', 'map-btn map-btn-secondary') as HTMLButtonElement;
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Fetching...';
      await this.fetchScoutSignatures(true);
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Live Sigs';
      void renderCardsList();
    };

    // Open Canvas Map button
    const canvasBtn = make('button', 'Open Canvas Map', 'map-btn map-btn-accent');
    canvasBtn.title = `Switch to the interactive draggable canvas map for ${hub} base`;
    canvasBtn.onclick = () => {
      this.viewMode = 'canvas';
      this.createHubBaseMap(hub);
    };

    controls.append(searchInput, refreshBtn, canvasBtn);
    headBar.append(titleCol, pilotBadge, controls);
    container.append(headBar);

    container.append(this.renderClosestHubEntrancesCard(true));

    // Grid Container
    const gridContainer = make('div', '', 'wh-scout-grid');
    container.append(gridContainer);
    stage.append(container);

    const renderCardsList = async () => {
      gridContainer.replaceChildren();

      const loadingMsg = make('p', 'Fetching scout signatures from EVE-Scout API...', 'wh-card-desc');
      gridContainer.append(loadingMsg);

      const allSigs = await this.fetchScoutSignatures();
      loadingMsg.remove();

      const hubLower = hub.toLowerCase();
      let matched = allSigs.filter(s =>
        (s.out_system_name || '').toLowerCase() === hubLower ||
        (s.in_system_name || '').toLowerCase() === hubLower
      );

      if (this.scoutSearchQuery.trim()) {
        const q = this.scoutSearchQuery.trim().toLowerCase();
        matched = matched.filter(s =>
          (s.in_system_name || '').toLowerCase().includes(q) ||
          (s.out_system_name || '').toLowerCase().includes(q) ||
          (s.in_region_name || '').toLowerCase().includes(q) ||
          (s.in_signature || '').toLowerCase().includes(q) ||
          (s.out_signature || '').toLowerCase().includes(q) ||
          (s.wh_type || '').toLowerCase().includes(q) ||
          (s.in_system_class || '').toLowerCase().includes(q)
        );
      }

      if (matched.length === 0) {
        gridContainer.append(make('p', `No active ${hub} signatures found matching your filter.`, 'wh-empty-msg'));
        return;
      }

      // Sort by stargate jumps if available (closest first)
      const currentSystemId = activePilot?.systemId;

      matched.sort((a, b) => {
        const aTargetId = (a.out_system_name || '').toLowerCase() === hubLower ? a.in_system_id : a.out_system_id;
        const bTargetId = (b.out_system_name || '').toLowerCase() === hubLower ? b.in_system_id : b.out_system_id;
        if (!currentSystemId) return 0;
        const distA = universeGraph.calculateJumps(currentSystemId, aTargetId);
        const distB = universeGraph.calculateJumps(currentSystemId, bTargetId);
        if (distA !== null && distB !== null) return distA - distB;
        if (distA !== null) return -1;
        if (distB !== null) return 1;
        return (a.in_system_name || '').localeCompare(b.in_system_name || '');
      });

      for (const s of matched) {
        const isOutHub = (s.out_system_name || '').toLowerCase() === hubLower;
        const targetId = isOutHub ? s.in_system_id : s.out_system_id;
        const targetName = isOutHub ? s.in_system_name : s.out_system_name;
        const targetClass = (s.in_system_class || (targetName.startsWith('J') ? 'C3' : 'K-Space')).toUpperCase();
        const regionName = s.in_region_name || (targetClass.startsWith('C') ? 'J-Space' : '');
        const inSig = s.in_signature || '???';
        const outSig = s.out_signature || '???';
        const whType = s.wh_type || 'WH';
        const maxShip = s.max_ship_size || 'subcap';
        const remainingHours = s.remaining_hours ?? '?';

        const hubSig = isOutHub ? outSig : inSig;
        const targetSig = isOutHub ? inSig : outSig;
        const isFrig = isFrigateHole(whType, maxShip);

        // Security lookup
        const sysInfo = universeGraph.getSystemInfo(targetId) || universeGraph.getSystemInfo(targetName);
        let secVal = sysInfo?.security;
        if (secVal === undefined) {
          if (targetId >= 31000000 && targetId < 32000000) secVal = -0.99;
          else if (targetClass === 'HIGHSEC') secVal = 0.8;
          else if (targetClass === 'LOWSEC') secVal = 0.3;
          else if (targetClass === 'NULLSEC') secVal = -0.2;
        }
        const secText = secVal !== undefined ? (secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1)) : '0.0';
        const secCls = secVal !== undefined
          ? (secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (targetClass.startsWith('C') ? 'wspace' : 'nullsec'))
          : 'nullsec';

        // Jump distance calculation
        let jumps: number | null = null;
        if (currentSystemId && targetId) {
          jumps = universeGraph.calculateJumps(currentSystemId, targetId);
        }
        const jumpsLabel = jumps !== null ? `${jumps} Jumps` : (targetId >= 31000000 ? 'J-Space' : '');

        // Card Element
        const card = make('div', '', `wh-scout-card${this.selectedSystemId === targetId ? ' selected' : ''}${isFrig ? ' is-frigate' : ''}`);

        // Header
        const cardHeader = make('div', '', 'wh-scout-card-header');
        const leftSide = make('div', '', 'wh-scout-left');
        const secBadge = make('span', secText, `wh-card-sec-badge ${secCls}`);
        secBadge.title = `Security Status: ${secText}`;
        const classBadge = make('span', targetClass, `wh-class-badge wh-class-${targetClass.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
        const nameTitle = make('strong', targetName, 'wh-scout-target-name');

        leftSide.append(secBadge, classBadge, nameTitle);
        const rightSide = make('div', '', 'wh-scout-right');
        const threatBadge = make('span', 'SCANNING', 'wh-threat-badge quiet wh-card-threat-badge');
        threatBadge.title = 'Fetching live zKillboard threat analysis...';
        const regionSpan = make('span', regionName, 'wh-scout-region');
        rightSide.append(threatBadge, regionSpan);
        cardHeader.append(leftSide, rightSide);
        card.append(cardHeader);

        // Fetch live zKillboard threat analysis for scout card
        void fetchSystemZkill(targetId).then((zkill) => {
          threatBadge.textContent = zkill.dangerRating;
          threatBadge.className = `wh-threat-badge ${zkill.dangerClass} wh-card-threat-badge`;
          threatBadge.title = `zKillboard: ${zkill.dangerRating} (${zkill.killsLast24h} kills in 24h, ${zkill.formattedTotalIsk} ISK destroyed)`;
        });

        // In & Out Signatures Box
        const sigsBox = make('div', '', 'wh-scout-sigs-box');

        const inCol = make('div', '', 'wh-scout-sig-col');
        inCol.append(
          make('span', `${targetName} Sig`, 'wh-scout-sig-label'),
          make('span', targetSig, 'wh-scout-sig-val in')
        );

        const arrow = make('span', '⇄', 'wh-scout-sig-sep');

        const outCol = make('div', '', 'wh-scout-sig-col');
        outCol.append(
          make('span', `${hub} Sig`, 'wh-scout-sig-label'),
          make('span', hubSig, 'wh-scout-sig-val out')
        );

        sigsBox.append(inCol, arrow, outCol);
        card.append(sigsBox);

        // Spec / Metadata Row
        const specRow = make('div', '', 'wh-scout-spec-row');
        if (isFrig) {
          const frigBadge = make('span', 'FRIG HOLE', 'wh-scout-pill wh-frig-pill');
          frigBadge.title = 'Frigate/Destroyer Only (<=5,000t jump mass)';
          specRow.append(frigBadge);
        }
        specRow.append(
          make('span', whType, 'wh-scout-pill wh-type'),
          make('span', maxShip, 'wh-scout-pill wh-size'),
          make('span', `${remainingHours}h left`, `wh-scout-pill wh-timer${remainingHours !== '?' && Number(remainingHours) <= 4 ? ' eol' : ''}`)
        );
        if (jumps !== null) {
          const jumpPill = make('span', `${jumps} Jumps`, `wh-scout-pill wh-jumps ${jumps <= 5 ? 'close' : jumps <= 15 ? 'mid' : 'far'}`);
          specRow.append(jumpPill);
        }
        card.append(specRow);

        // Notes preview if existing
        const noteRec = getStoredSystemNote(targetId) || getStoredSystemNote(targetName);
        if (noteRec?.notes) {
          const notePreview = make('div', noteRec.notes, 'wh-card-notes-preview');
          card.append(notePreview);
        }

        // Action Buttons Row
        const btnRow = make('div', '', 'wh-scout-btn-row');

        // Set Dest Button
        const destBtn = make('button', `Set Dest${jumpsLabel ? ` (${jumpsLabel})` : ''}`, 'wh-scout-dest-btn');
        destBtn.title = `Set in-game autopilot destination to ${targetName}`;
        destBtn.onclick = async () => {
          await setAutopilotDestination(targetId);
          this.showWaypointToast(`Autopilot destination set to ${targetName}${jumps !== null ? ` (${jumps} jumps)` : ''}`);
        };

        // Fleet Dest Button
        const fleetBtn = make('button', `Fleet Dest${jumpsLabel ? ` (${jumpsLabel})` : ''}`, 'wh-scout-fleet-btn') as HTMLButtonElement;
        fleetBtn.title = `Broadcast destination to all registered fleet members via ESI`;
        fleetBtn.onclick = async () => {
          fleetBtn.disabled = true;
          try {
            const st = await call<{ inFleet: boolean; fleetId?: number }>('fleet_status', { characterId: activePilot?.id });
            if (st?.inFleet && st.fleetId) {
              await call('set_fleet_destination', {
                fleetId: st.fleetId,
                destinationId: targetId,
                characterId: activePilot?.id,
                clearOtherWaypoints: true
              });
              this.showWaypointToast(`Fleet destination broadcast to ${targetName}!`);
            } else {
              await setAutopilotDestination(targetId);
              this.showWaypointToast(`ℹ️ Not currently in a fleet. Set personal destination to ${targetName}.`);
            }
          } catch {
            await setAutopilotDestination(targetId);
            this.showWaypointToast(`Autopilot destination set to ${targetName}`);
          } finally {
            fleetBtn.disabled = false;
          }
        };

        // Import Button
        const importBtn = make('button', '+ Import', 'wh-scout-import-btn');
        importBtn.title = 'Import this connection to your active chain map';
        importBtn.onclick = () => {
          const activeMap = this.maps.find(m => !m.id.startsWith('scout-')) || this.maps[0];
          if (activeMap) {
            const hubId = (s.out_system_name || '').toLowerCase() === hubLower ? s.out_system_id : s.in_system_id;
            const hubName = (s.out_system_name || '').toLowerCase() === hubLower ? s.out_system_name : s.in_system_name;
            if (!this.nodes.has(hubId)) {
              this.nodes.set(hubId, {
                systemId: hubId,
                systemName: hubName,
                whClass: hub,
                depth: 0,
                x: 100,
                y: 100
              });
            }
            this.addWormholeConnection(
              hubId,
              targetId,
              targetName,
              targetClass,
              whType,
              hubSig !== '???' ? hubSig : undefined,
              targetSig !== '???' ? targetSig : undefined,
              'EVE-Scout',
              {
                isFrigateOnly: isFrig,
                remainingHours: s.remaining_hours !== undefined ? Number(s.remaining_hours) : undefined,
                expiresAt: s.expires_at ? new Date(s.expires_at).getTime() : undefined,
                shipSize: s.max_ship_size
              }
            );
            importBtn.textContent = 'Added';
            (importBtn as HTMLButtonElement).disabled = true;
            this.showWaypointToast(`Added ${targetName} connection to ${activeMap.name}`);
          }
        };

        const isKSpace = targetId < 31000000 && !targetClass.startsWith('C') && targetClass !== 'W-SPACE' && targetClass !== 'THERA';
        if (isKSpace) {
          btnRow.append(destBtn, fleetBtn, importBtn);
        } else {
          (importBtn as HTMLElement).style.flex = '1';
          btnRow.append(importBtn);
        }
        card.append(btnRow);

        // Click selects system for inspector
        card.onclick = (e) => {
          if ((e.target as Element).closest('button, a, input, select, textarea, summary')) { e.stopPropagation(); return; }
          this.selectedSystemId = targetId;
          this.selectedScoutSystem = {
            targetId,
            targetName,
            targetClass,
            regionName,
            whType,
            maxShip,
            remainingHours,
            inSig: targetSig,
            outSig: hubSig,
            hubSig,
            targetSig,
            hub: hub as 'Thera' | 'Turnur',
            jumps,
            expiresAt: s.expires_at
          };
          const allCards = gridContainer.querySelectorAll('.wh-scout-card');
          allCards.forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');

          const inspector = this.container.querySelector('.wh-inspector') as HTMLElement | null;
          if (inspector) this.renderInspector(inspector);
        };

        gridContainer.append(card);
      }
    };

    void renderCardsList();
  }

  public panToSystem(systemId: number) {
    const node = this.nodes.get(systemId);
    if (!node) return;
    this.selectedSystemId = systemId;
    const stage = this.container.querySelector('.wh-stage') as HTMLElement | null;
    const world = this.container.querySelector('.wh-canvas-world') as HTMLElement | null;
    const stageWidth = stage?.clientWidth || window.innerWidth / 2;
    const stageHeight = stage?.clientHeight || window.innerHeight / 2;

    this.pan.x = stageWidth / 2 - (node.x ?? 80) * this.zoom - 120 * this.zoom;
    this.pan.y = stageHeight / 2 - (node.y ?? 80) * this.zoom - 40 * this.zoom;

    if (world) {
      world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    }
    this.saveToStorage();
    this.renderChainContentOnly();
  }

  public getClosestHubEntrance(hub: 'Thera' | 'Turnur', allSigs?: any[]): {
    hub: 'Thera' | 'Turnur';
    targetId: number;
    targetName: string;
    targetClass: string;
    regionName: string;
    jumps: number | null;
    inSig: string;
    outSig: string;
    hubSig: string;
    targetSig: string;
    whType: string;
    maxShip: string;
    remainingHours?: string | number;
    isFrig: boolean;
    secVal?: number;
    secText: string;
    secCls: string;
  } | null {
    const sigs = allSigs || this.cachedScoutSignatures || [];
    if (!Array.isArray(sigs) || sigs.length === 0) {
      if (!this.isScoutFetching && (!this.cachedScoutSignatures || this.cachedScoutSignatures.length === 0)) {
        void this.fetchScoutSignatures().then(() => this.renderChainContentOnly());
      }
      return null;
    }

    const hubLower = hub.toLowerCase();
    const matched = sigs.filter(s =>
      (s.out_system_name || '').toLowerCase() === hubLower ||
      (s.in_system_name || '').toLowerCase() === hubLower
    );
    if (matched.length === 0) return null;

    const activePilot = this.activeCharacters[0];
    const currentSystemId = activePilot?.systemId;

    const candidates: Array<{
      hub: 'Thera' | 'Turnur';
      targetId: number;
      targetName: string;
      targetClass: string;
      regionName: string;
      jumps: number | null;
      inSig: string;
      outSig: string;
      hubSig: string;
      targetSig: string;
      whType: string;
      maxShip: string;
      remainingHours?: string | number;
      isFrig: boolean;
      secVal?: number;
      secText: string;
      secCls: string;
    }> = [];

    for (const s of matched) {
      const isOutHub = (s.out_system_name || '').toLowerCase() === hubLower;
      const targetId = isOutHub ? s.in_system_id : s.out_system_id;
      const targetName = isOutHub ? s.in_system_name : s.out_system_name;
      if (!targetId || targetName.toLowerCase() === hubLower) continue;

      const targetClass = (s.in_system_class || (targetName.startsWith('J') ? 'C3' : 'K-Space')).toUpperCase();
      const regionName = s.in_region_name || (targetClass.startsWith('C') ? 'J-Space' : '');
      const inSig = s.in_signature || '???';
      const outSig = s.out_signature || '???';
      const whType = s.wh_type || 'WH';
      const maxShip = s.max_ship_size || 'subcap';
      const remainingHours = s.remaining_hours ?? '?';

      const hubSig = isOutHub ? outSig : inSig;
      const targetSig = isOutHub ? inSig : outSig;
      const isFrig = isFrigateHole(whType, maxShip);

      const sysInfo = universeGraph.getSystemInfo(targetId) || universeGraph.getSystemInfo(targetName);
      let secVal = sysInfo?.security;
      if (secVal === undefined) {
        if (targetId >= 31000000 && targetId < 32000000) secVal = -0.99;
        else if (targetClass === 'HIGHSEC') secVal = 0.8;
        else if (targetClass === 'LOWSEC') secVal = 0.3;
        else if (targetClass === 'NULLSEC') secVal = -0.2;
      }
      const secText = secVal !== undefined ? (secVal < 0 && secVal > -0.05 ? '0.0' : secVal <= -0.9 ? '-1.0' : secVal.toFixed(1)) : '0.0';
      const secCls = secVal !== undefined
        ? (secVal >= 0.45 ? 'hisec' : secVal > 0.0 ? 'lowsec' : (targetClass.startsWith('C') ? 'wspace' : 'nullsec'))
        : 'nullsec';

      let jumps: number | null = null;
      if (currentSystemId && targetId) {
        jumps = universeGraph.calculateJumps(currentSystemId, targetId);
      }

      candidates.push({
        hub,
        targetId,
        targetName,
        targetClass,
        regionName,
        jumps,
        inSig,
        outSig,
        hubSig,
        targetSig,
        whType,
        maxShip,
        remainingHours,
        isFrig,
        secVal,
        secText,
        secCls
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (a.jumps !== null && b.jumps !== null) return a.jumps - b.jumps;
      if (a.jumps !== null) return -1;
      if (b.jumps !== null) return 1;
      const aIsK = a.targetId < 31000000;
      const bIsK = b.targetId < 31000000;
      if (aIsK && !bIsK) return -1;
      if (!aIsK && bIsK) return 1;
      return a.targetName.localeCompare(b.targetName);
    });

    return candidates[0];
  }

  public renderClosestHubEntrancesCard(isScoutPage = false): HTMLElement {
    const card = make('div', '', `wh-hub-closest-corner-card${this.closestCardCollapsed ? ' collapsed' : ''}${isScoutPage ? ' in-scout-page' : ''}`);
    card.onpointerdown = (e) => e.stopPropagation();
    card.onmousedown = (e) => e.stopPropagation();
    card.onwheel = (e) => e.stopPropagation();

    const activePilot = this.activeCharacters[0];
    const pilotSysInfo = activePilot ? universeGraph.getSystemInfo(activePilot.systemId) : null;
    const pilotSysName = pilotSysInfo?.name || (activePilot ? `System ${activePilot.systemId}` : 'Offline');
    const pilotSec = pilotSysInfo ? (pilotSysInfo.security <= -0.9 ? '-1.0' : pilotSysInfo.security.toFixed(1)) : (activePilot ? 'J-Space' : '');

    const theraEntrance = this.getClosestHubEntrance('Thera');
    const turnurEntrance = this.getClosestHubEntrance('Turnur');

    // Header
    const header = make('div', '', 'wh-hub-closest-header');
    const titleCol = make('div', '', 'wh-hub-closest-title-col');
    titleCol.innerHTML = `
      <div class="wh-hub-closest-title">
        <span class="hub-radar-icon"></span>
        <strong>CLOSEST ENTRANCES</strong>
      </div>
      <div class="wh-hub-closest-pilot-sub">
        ${activePilot ? `Pilot: <strong>${escapeDaytripperText(activePilot.name)}</strong> @ <span>${escapeDaytripperText(pilotSysName)}</span> (${pilotSec})` : 'Active Pilot: <em>Offline / Unknown</em>'}
      </div>
    `;

    const headerActions = make('div', '', 'wh-hub-closest-header-actions');
    
    // Refresh Button
    const refreshBtn = make('button', '', 'wh-hub-closest-icon-btn') as HTMLButtonElement; refreshBtn.innerHTML = getLucideSvg('refresh-cw', { size: 14 });
    refreshBtn.title = 'Refresh live EVE-Scout signatures';
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      refreshBtn.disabled = true;
      refreshBtn.textContent = '...';
      this.onRefreshPilots?.();
      await this.fetchScoutSignatures(true);
      refreshBtn.innerHTML = getLucideSvg('refresh-cw', { size: 14 });
      refreshBtn.disabled = false;
      this.renderChainContentOnly();
    };

    // Toggle Collapse Button
    const toggleBtn = make('button', this.closestCardCollapsed ? '+' : '−', 'wh-hub-closest-icon-btn');
    toggleBtn.title = this.closestCardCollapsed ? 'Expand closest entrance details' : 'Minimize card';
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      this.closestCardCollapsed = !this.closestCardCollapsed;
      card.classList.toggle('collapsed', this.closestCardCollapsed);
      toggleBtn.textContent = this.closestCardCollapsed ? '+' : '−';
      toggleBtn.title = this.closestCardCollapsed ? 'Expand closest entrance details' : 'Minimize card';
    };

    headerActions.append(refreshBtn, toggleBtn);
    header.append(titleCol, headerActions);
    card.append(header);

    // Body
    const body = make('div', '', 'wh-hub-closest-body');

    const renderHubEntry = (hub: 'Thera' | 'Turnur', entrance: ReturnType<typeof this.getClosestHubEntrance>) => {
      const entry = make('div', '', `wh-hub-closest-entry hub-${hub.toLowerCase()}`);
      const icon = hub === 'Thera' ? 'Thera' : 'Turnur';

      if (!entrance) {
        entry.innerHTML = `
          <div class="wh-hub-closest-row">
            <span class="wh-hub-badge ${hub.toLowerCase()}">${icon} ${hub}</span>
            <span class="wh-hub-no-sigs">Loading live signatures...</span>
          </div>
        `;
        return entry;
      }

      const jumpsStr = entrance.jumps !== null ? `${entrance.jumps} Jumps` : (entrance.targetId >= 31000000 ? 'J-Space' : 'No Stargate Route');
      const jumpsBadgeClass = entrance.jumps !== null && entrance.jumps <= 5 ? 'close' : entrance.jumps !== null && entrance.jumps <= 12 ? 'medium' : 'far';

      const entryHead = make('div', '', 'wh-hub-closest-row head-row');
      entryHead.innerHTML = `
        <div class="wh-hub-entry-left">
          <span class="wh-hub-badge ${hub.toLowerCase()}">${icon} ${hub}</span>
          <span class="wh-card-sec-badge ${entrance.secCls}">${entrance.secText}</span>
          <strong class="wh-hub-target-name">${escapeDaytripperText(entrance.targetName)}</strong>
          <span class="wh-hub-target-region">${escapeDaytripperText(entrance.regionName)}</span>
        </div>
        <div class="wh-hub-entry-right">
          <span class="wh-hub-jumps-badge ${jumpsBadgeClass}">${jumpsStr}</span>
        </div>
      `;

      const detailsRow = make('div', '', 'wh-hub-closest-row details-row');
      const frigBadge = entrance.isFrig ? '<span class="wh-frig-badge">FRIG</span>' : '';
      detailsRow.innerHTML = `
        <div class="wh-hub-sigs-spec">
          <span class="sig-pill">${escapeDaytripperText(entrance.targetSig)}</span>
          <span class="sig-arrow">↔</span>
          <span class="sig-pill hub-sig">${escapeDaytripperText(entrance.hubSig)}</span>
          <span class="wh-type-tag">${escapeDaytripperText(entrance.whType)}</span>
          <span class="wh-life-tag">${escapeDaytripperText(entrance.remainingHours)}h</span>
          ${frigBadge}
        </div>
      `;

      // Set Destination Tags / Action Buttons
      const actionsRow = make('div', '', 'wh-hub-closest-row actions-row');
      
      const isKSpace = entrance.targetId < 31000000 && !entrance.targetClass.startsWith('C') && entrance.targetClass !== 'W-SPACE' && entrance.targetClass !== 'THERA';

      if (isKSpace) {
        const destTag = make('button', `Set Dest${entrance.jumps !== null ? ` (${entrance.jumps}J)` : ''}`, 'wh-hub-tag-btn dest-tag');
        destTag.title = `Set in-game autopilot destination to ${entrance.targetName}`;
        destTag.onclick = async (e) => {
          e.stopPropagation();
          await setAutopilotDestination(entrance.targetId);
          this.showWaypointToast(`Autopilot destination set to ${entrance.targetName}${entrance.jumps !== null ? ` (${entrance.jumps} jumps)` : ''}`);
        };

        const fleetTag = make('button', `Fleet Dest`, 'wh-hub-tag-btn fleet-tag') as HTMLButtonElement;
        fleetTag.title = `Broadcast destination to registered fleet members via ESI`;
        fleetTag.onclick = async (e) => {
          e.stopPropagation();
          fleetTag.disabled = true;
          try {
            const st = await call<{ inFleet: boolean; fleetId?: number }>('fleet_status', { characterId: activePilot?.id });
            if (st?.inFleet && st.fleetId) {
              await call('set_fleet_destination', {
                fleetId: st.fleetId,
                destinationId: entrance.targetId,
                characterId: activePilot?.id,
                clearOtherWaypoints: true
              });
              this.showWaypointToast(`Fleet destination broadcast to ${entrance.targetName}!`);
            } else {
              await setAutopilotDestination(entrance.targetId);
              this.showWaypointToast(`ℹ️ Not currently in a fleet. Set personal destination to ${entrance.targetName}.`);
            }
          } catch {
            await setAutopilotDestination(entrance.targetId);
            this.showWaypointToast(`Autopilot destination set to ${entrance.targetName}`);
          } finally {
            fleetTag.disabled = false;
          }
        };

        actionsRow.append(destTag, fleetTag);
      }

      // If node is currently on canvas map, allow Pan/Locate
      if (this.nodes.has(entrance.targetId)) {
        const locateTag = make('button', `Map`, 'wh-hub-tag-btn locate-tag');
        locateTag.title = `Center and select ${entrance.targetName} on current map canvas`;
        locateTag.onclick = (e) => {
          e.stopPropagation();
          this.panToSystem(entrance.targetId);
        };
        actionsRow.append(locateTag);
      }

      entry.onclick = (e) => {
        if ((e.target as Element).closest('button, a, input, select, textarea, summary')) { e.stopPropagation(); return; }
        this.selectedSystemId = entrance.targetId;
        this.selectedScoutSystem = {
          targetId: entrance.targetId,
          targetName: entrance.targetName,
          targetClass: entrance.targetClass,
          regionName: entrance.regionName,
          whType: entrance.whType,
          maxShip: entrance.maxShip,
          remainingHours: entrance.remainingHours,
          inSig: entrance.targetSig,
          outSig: entrance.hubSig,
          hubSig: entrance.hubSig,
          targetSig: entrance.targetSig,
          hub,
          jumps: entrance.jumps
        };
        if (this.nodes.has(entrance.targetId)) {
          this.panToSystem(entrance.targetId);
        } else {
          const inspector = this.container.querySelector('.wh-inspector') as HTMLElement | null;
          if (inspector) this.renderInspector(inspector);
        }
      };

      entry.append(entryHead, detailsRow, actionsRow);
      return entry;
    };

    body.append(renderHubEntry('Thera', theraEntrance));
    body.append(renderHubEntry('Turnur', turnurEntrance));
    card.append(body);

    return card;
  }

  public renderCanvasConnectionLegend(): HTMLElement {
    const card = make('div', '', `wh-canvas-legend-corner${this.legendCollapsed ? ' collapsed' : ''}`);
    card.onpointerdown = (e) => e.stopPropagation();
    card.onmousedown = (e) => e.stopPropagation();
    card.onwheel = (e) => e.stopPropagation();

    // Header
    const header = make('div', '', 'wh-canvas-legend-header');
    const title = make('div', '', 'wh-canvas-legend-title');
    title.innerHTML = `<span class="legend-radar-icon"></span><strong>CONNECTION LEGEND</strong>`;
    
    const headerActions = make('div', '', 'wh-canvas-legend-actions');
    const guideBtn = make('button', 'Guide', 'wh-canvas-legend-btn') as HTMLButtonElement;
    guideBtn.title = 'Open Full Mapping & Bookmarking Guide tab';
    guideBtn.onclick = (e) => {
      e.stopPropagation();
      this.switchMap('mapping-guide');
    };

    const toggleBtn = make('button', this.legendCollapsed ? '+' : '−', 'wh-canvas-legend-btn');
    toggleBtn.title = this.legendCollapsed ? 'Expand Connection Legend' : 'Minimize Legend';
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      this.legendCollapsed = !this.legendCollapsed;
      card.classList.toggle('collapsed', this.legendCollapsed);
      toggleBtn.textContent = this.legendCollapsed ? '+' : '−';
    };

    headerActions.append(guideBtn, toggleBtn);
    header.append(title, headerActions);
    card.append(header);

    // Body
    const body = make('div', '', 'wh-canvas-legend-body');
    body.innerHTML = `
      <div class="wh-legend-grid">
        <div class="wh-legend-item" title="Solid cyan telemetry line. Wormhole has >4h remaining and >50% jump mass.">
          <span class="wh-legend-line wh-line-stable"></span>
          <span class="wh-legend-label">Stable WH</span>
          <span class="wh-legend-note">&gt;4h / &gt;50%</span>
        </div>
        <div class="wh-legend-item" title="Dashed orange line. Less than 4 hours lifetime remaining (End of Life).">
          <span class="wh-legend-line wh-line-eol"></span>
          <span class="wh-legend-label">EOL Alert</span>
          <span class="wh-legend-note">&lt;4h Left</span>
        </div>
        <div class="wh-legend-item" title="Amber line. Less than 50% jump mass remaining (Stage 2 destabilization).">
          <span class="wh-legend-line wh-line-half"></span>
          <span class="wh-legend-label">Half Mass</span>
          <span class="wh-legend-note">&lt;50% Mass</span>
        </div>
        <div class="wh-legend-item" title="Crimson line. Less than 10% jump mass remaining (Stage 3 critical - verge of collapse).">
          <span class="wh-legend-line wh-line-crit"></span>
          <span class="wh-legend-label">Crit Mass</span>
          <span class="wh-legend-note">&lt;10% Mass</span>
        </div>
        <div class="wh-legend-item" title="Purple line with FRIG badge. Frigate & Destroyer size restricted hole (<=5,000 tons jump limit).">
          <span class="wh-legend-line wh-line-frig"></span>
          <span class="wh-legend-label">Frigate</span>
          <span class="wh-legend-note">&lt;=5kt Jump</span>
        </div>
        <div class="wh-legend-item" title="Solid slate line with GATE badge. Permanent Known Space Stargate jump route.">
          <span class="wh-legend-line wh-line-gate"></span>
          <span class="wh-legend-label">Stargate</span>
          <span class="wh-legend-note">Static K-Space</span>
        </div>
      </div>
      <div class="wh-legend-footer">
        <div class="wh-legend-pills-row">
          <span class="wh-legend-subpill" title="Attributed In/Out signature codes at 20% and 80% along the Bezier curve (1-click copy)">[Sig -> Sig]</span>
          <span class="wh-legend-subpill" title="Wormhole lifetime countdown or EOL alert tag">️ Life</span>
          <span class="wh-legend-subpill" title="Interactive mass stage cycler: Stable -> Half -> Crit">Rolling</span>
        </div>
        <button type="button" class="wh-legend-full-guide-link">
          Open Full In-Game Bookmark &amp; Mapping Guide ->
        </button>
      </div>
    `;

    body.querySelector('.wh-legend-full-guide-link')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchMap('mapping-guide');
    });

    card.append(body);
    return card;
  }

  public renderMappingGuideView(stage: HTMLElement): void {
    stage.replaceChildren();

    const guideContainer = make('div', '', 'wh-guide-view-scroll');
    guideContainer.innerHTML = `
      <div class="wh-guide-header-hero">
        <div class="wh-guide-badge-row">
          <span class="wh-guide-pill-hero">DAYTRIPPER TACTICAL MANUAL</span>
          <span class="wh-guide-ver-pill">Alliance Tournament Edition</span>
        </div>
        <h2 class="wh-guide-hero-title">Wormhole Connections, States &amp; In-Game Bookmarking Standards</h2>
        <p class="wh-guide-hero-sub">
          The comprehensive operational handbook for scouts, daytrippers, and fleet commanders. Master connection visualization, mass &amp; EOL lifecycle indicators, tactical coordinate perches, and seamless 1-click in-game bookmarking workflows.
        </p>
      </div>

      <div class="wh-guide-sections-wrap">
        <!-- SECTION 1: CONNECTION LEGEND & STATES -->
        <section class="wh-guide-section-card">
          <div class="wh-guide-sec-header">
            <span class="wh-guide-sec-num">01</span>
            <div>
              <h3>Wormhole Connection Legend &amp; Link States</h3>
              <p>Visual identification matrix for all chain connections, vector strokes, mass stages, and lifetime alerts.</p>
            </div>
          </div>

          <div class="wh-guide-legend-matrix">
            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-stable"></span>
                <span class="wh-legend-midpill-demo">[Sig -> Sig]</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-cyan">Stable Wormhole</strong>
                <p class="wh-legend-card-desc">Healthy connection with <strong>&gt;4 hours</strong> remaining and <strong>&gt;50% jump mass</strong> intact. Default cyan telemetry vector line (#38bdf8).</p>
                <div class="wh-legend-tags">
                  <span class="wh-tag cyan">Stage 1 Mass</span>
                  <span class="wh-tag green">Life OK (&gt;4h)</span>
                </div>
              </div>
            </div>

            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-eol"></span>
                <span class="wh-legend-midpill-demo eol">EOL (&lt;4h)</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-amber">End of Life (EOL)</strong>
                <p class="wh-legend-card-desc">The wormhole has entered its final destabilization stage with <strong>less than 4 hours</strong> of lifetime remaining. Rendered as a pulsing dashed vector line.</p>
                <div class="wh-legend-tags">
                  <span class="wh-tag amber">Pulsing Dash</span>
                  <span class="wh-tag red">Collapse Imminent</span>
                </div>
              </div>
            </div>

            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-half"></span>
                <span class="wh-legend-midpill-demo half">HALF MASS</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-yellow">Destabilized / Half Mass</strong>
                <p class="wh-legend-card-desc">Jump mass has been reduced to <strong>&lt;50% remaining</strong> (Stage 2 mass). Gold vector stroke (#fbbf24). <em>"This wormhole has had its stability reduced by ships passing through it..."</em></p>
                <div class="wh-legend-tags">
                  <span class="wh-tag yellow">Stage 2 Mass</span>
                  <span class="wh-tag blue">Rolling Warning</span>
                </div>
              </div>
            </div>

            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-crit"></span>
                <span class="wh-legend-midpill-demo crit">CRIT MASS</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-red">Critical Mass (Verging)</strong>
                <p class="wh-legend-card-desc">Jump mass is <strong>&lt;10% remaining</strong> (Stage 3 mass). Crimson vector stroke (#f87171). <em>"This wormhole has had its stability critically disrupted and is on the verge of collapse."</em></p>
                <div class="wh-legend-tags">
                  <span class="wh-tag red">Stage 3 Mass</span>
                  <span class="wh-tag red">Do Not Jump Heavy</span>
                </div>
              </div>
            </div>

            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-frig"></span>
                <span class="wh-legend-midpill-demo frig">FRIG</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-purple">Frigate-Only Hole</strong>
                <p class="wh-legend-card-desc">Identifies frigate &amp; destroyer restricted wormholes (C125, Z971, E175, Q003, X820, V301, E545, D845). Max single jump mass <strong>&lt;=5,000 tonnes</strong>. Purple stroke (#c084fc).</p>
                <div class="wh-legend-tags">
                  <span class="wh-tag purple">Frigate / Dessie Only</span>
                  <span class="wh-tag purple">&lt;=5kt Jump Limit</span>
                </div>
              </div>
            </div>

            <div class="wh-legend-card">
              <div class="wh-legend-card-preview">
                <span class="wh-guide-line stroke-gate"></span>
                <span class="wh-legend-midpill-demo gate">GATE</span>
              </div>
              <div class="wh-legend-card-info">
                <strong class="wh-legend-card-title text-slate">Stargate Highway</strong>
                <p class="wh-legend-card-desc">Permanent Known Space (K-Space) stargate connection (e.g. a regional gate route). Solid dark slate line (#475569) with midpoint gate indicator.</p>
                <div class="wh-legend-tags">
                  <span class="wh-tag slate">Infinite Mass</span>
                  <span class="wh-tag slate">Permanent Life</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Midpoint Pills & Endpoint Signatures Detailed -->
          <div class="wh-guide-callout-box">
            <h4>Endpoint Signatures &amp; Vector Midpoint Controls</h4>
            <div class="wh-guide-pill-explainer-grid">
              <div class="wh-explainer-item">
                <span class="wh-endpoint-sig-pill wh-sig-source demo">ABC-123</span>
                <div>
                  <strong>Origin / Hub Signature:</strong> Placed at 20% along the Bezier curve right near the origin node card. Click once to copy signature to clipboard.
                </div>
              </div>
              <div class="wh-explainer-item">
                <span class="wh-endpoint-sig-pill wh-sig-target demo">XYZ-789</span>
                <div>
                  <strong>Destination Signature:</strong> Placed at 80% along the Bezier curve right near the target node card. Click once to copy signature to clipboard.
                </div>
              </div>
              <div class="wh-explainer-item">
                <span class="wh-vector-midpill demo">[ABC -> XYZ]</span>
                <div>
                  <strong>Midpoint Vector Pill:</strong> Shows In/Out signature flow. Double-click or click Edit to edit wormhole type, mass, or lifetime status.
                </div>
              </div>
              <div class="wh-explainer-item">
                <span class="wh-vector-btn demo">Roll</span>
                <div>
                  <strong>Rolling Calculator:</strong> Use rolling controls on any connection to calculate how many hot/cold passes your rolling Megathron or Praxis needs to collapse the hole safely.
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- SECTION 2: IN-GAME BOOKMARKING STANDARDS -->
        <section class="wh-guide-section-card">
          <div class="wh-guide-sec-header">
            <span class="wh-guide-sec-num">02</span>
            <div>
              <h3>In-Game Bookmarking Standards &amp; Nomenclature</h3>
              <p>Corporate naming conventions for Alliance / Corporation Shared Folders. Clear, uniform intel for all fleet members.</p>
            </div>
          </div>

          <div class="wh-guide-standard-box">
            <div class="wh-formula-banner">
              <span class="wh-formula-label">CANONICAL FORMULA:</span>
              <code>[SigID] [Destination Name / Class] [WH Code / Type] [Status]</code>
            </div>

            <table class="wh-guide-table">
              <thead>
                <tr>
                  <th>Connection Type</th>
                  <th>In-Game Bookmark Label</th>
                  <th>Meaning &amp; Tactical Guidance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span class="wh-tag cyan">Static / Outward</span></td>
                  <td><code>ABC J123456 (C3) K162</code></td>
                  <td>Incoming K162 from a C3 J-space system. Standard wormhole connection.</td>
                </tr>
                <tr>
                  <td><span class="wh-tag green">Highsec Trade Exit</span></td>
                  <td><code>XYZ Jita (HS) B274</code></td>
                  <td>B274 direct connection to Highsec, 2 jumps from Jita. Safe for hauling.</td>
                </tr>
                <tr>
                  <td><span class="wh-tag amber">Lowsec Static</span></td>
                  <td><code>DEF Amarr (LS) A239</code></td>
                  <td>A239 Lowsec connection leading to Domain region. Watch out for gate camps.</td>
                </tr>
                <tr>
                  <td><span class="wh-tag purple">Frigate Wormhole</span></td>
                  <td><code>GHI Thera (C125 Frig)</code></td>
                  <td>Thera connection with C125 code. Battleships/Cruisers CANNOT jump!</td>
                </tr>
                <tr>
                  <td><span class="wh-tag red">Dying / EOL Exit</span></td>
                  <td><code>JKL Home (C5) EOL</code></td>
                  <td>Return hole to corp home citadel system with less than 4 hours remaining.</td>
                </tr>
                <tr>
                  <td><span class="wh-tag yellow">Destabilized Mass</span></td>
                  <td><code>MNO Nullsec (NS) E587 Half</code></td>
                  <td>Nullsec connection destabilized to &lt;50% jump mass. Avoid heavy fleets.</td>
                </tr>
                <tr class="highlight-row">
                  <td><span class="wh-tag gold">GOLDEN RULE</span></td>
                  <td><code>ABC Return Home</code> or <code>ABC Home</code></td>
                  <td><strong>Rule #1 of Wormholing:</strong> Bookmark the return hole at 0m IMMEDIATELY upon jumping into a new system!</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Tactical Perches & Safe Spots -->
          <div class="wh-guide-tactical-grid">
            <div class="wh-tactical-card">
              <h4>Tactical Perches (&gt;150km on grid)</h4>
              <p>Place bookmarks <strong>150km - 250km</strong> off the wormhole or stargate in line with a planet or celestial.</p>
              <code>Perch 200km [Gate/WH Name]</code>
              <p class="wh-tactical-note">Allows covert scouts or fleet commanders to warp in, decloak safely off bubble range, and inspect the grid with combat probes and D-Scan before committing.</p>
            </div>

            <div class="wh-tactical-card">
              <h4>Deep Space Safe Spots (Off-Grid)</h4>
              <p>Make bookmarks mid-warp between two distant celestial bodies (&gt;14.3 AU away from all planets).</p>
              <code>SS1 (Moons 2-5)</code> or <code>SS2 (Deep Space)</code>
              <p class="wh-tactical-note">Cannot be reached by standard directional scanner. Only combat scanner probes can locate ships at these safe coordinates.</p>
            </div>

            <div class="wh-tactical-card">
              <h4>Cosmic Sites (Relic / Data / Gas)</h4>
              <p>Label with signature ID so fleet mates can warp directly without re-probing:</p>
              <code>ABC Core Reservoir (Gas C320)</code><br>
              <code>DEF Ruined Sansha Crystal Quarry</code>
              <p class="wh-tactical-note">Tag sleeper danger on higher class sites: <code>GHI Forgotten Core [DANGER: C5 SLEEPERS]</code>.</p>
            </div>
          </div>
        </section>

        <!-- SECTION 3: STEP-BY-STEP WORKFLOW -->
        <section class="wh-guide-section-card">
          <div class="wh-guide-sec-header">
            <span class="wh-guide-sec-num">03</span>
            <div>
              <h3>Step-by-Step Mapping &amp; Bookmarking Routine</h3>
              <p>The standard EVE Online -> Daytripper scout workflow.</p>
            </div>
          </div>

          <div class="wh-steps-flow">
            <div class="wh-step-item">
              <span class="wh-step-badge">STEP 1</span>
              <h4>Probe Scanning &amp; Copy</h4>
              <p>Open Probe Scanner (<kbd>Alt + P</kbd>) in EVE. Unresolved and partially scanned signatures are accepted. Press <kbd>Ctrl + A</kbd> in the probe scanner results window, then <kbd>Ctrl + C</kbd> to copy all signatures to your clipboard.</p>
            </div>

            <div class="wh-step-item">
              <span class="wh-step-badge">STEP 2</span>
              <h4>Import to Daytripper</h4>
              <p>In Daytripper, select your current system card and click <strong>Paste Signatures</strong> in the card header. The button reads copied Probe Scanner rows directly. Daytripper validates and parses and categorizes Wormholes, Relics, Data, Gas, and Combat sites with signal strength.</p>
            </div>

            <div class="wh-step-item">
              <span class="wh-step-badge">STEP 3</span>
              <h4>1-Click Bookmark Creation</h4>
              <p>In the Daytripper Signature Inspector on the right, click <strong>Copy Bookmark String</strong> on any signature. In EVE Online, right-click the wormhole and paste into the Label field. Set Expiry to <strong>2 Days</strong>. <strong>Always Right Click in space!</strong></p>
            </div>

            <div class="wh-step-item">
              <span class="wh-step-badge">STEP 4</span>
              <h4>Jump &amp; Auto-Chain</h4>
              <p>When your scout jumps through the hole, Daytripper's automated pilot tracker detects the character session change, creates the destination node, and links it with verified In/Out signatures automatically!</p>
            </div>
          </div>
        </section>
      </div>
    `;

    stage.append(guideContainer);
  }

  public renderGuideQuickTools(inspector: HTMLElement): void {
    inspector.replaceChildren();

    const box = make('div', '', 'wh-guide-tools-box');
    box.innerHTML = `
      <div class="wh-guide-tools-header">
        <span class="tools-radar-icon"></span>
        <h3>IN-GAME BOOKMARK GENERATOR</h3>
      </div>
      <p class="wh-guide-tools-desc">Generate standardized EVE Online bookmark labels for shared corporation folders with 1-click clipboard copying.</p>

      <div class="wh-bm-builder-form">
        <div class="wh-bm-field">
          <label>Signature ID (3 Letters / Full):</label>
          <input type="text" id="bm-input-sig" value="ABC" placeholder="e.g. ABC or ABC-123" maxlength="7" class="wh-bm-input" />
        </div>

        <div class="wh-bm-field">
          <label>Destination System / Space Class:</label>
          <input type="text" id="bm-input-dest" value="J123456 (C3)" placeholder="e.g. Jita (HS), J123456 (C3), Thera" class="wh-bm-input" />
        </div>

        <div class="wh-bm-field">
          <label>Wormhole Code / Type:</label>
          <div class="wh-bm-input-row">
            <input type="text" id="bm-input-code" value="K162" placeholder="e.g. K162, B274, C125" class="wh-bm-input" />
            <select id="bm-select-code" class="wh-bm-select">
              <option value="">Quick Select...</option>
              <option value="K162">K162 (Incoming)</option>
              <option value="B274">B274 (Highsec)</option>
              <option value="A239">A239 (Lowsec)</option>
              <option value="E587">E587 (Nullsec)</option>
              <option value="H296">H296 (C5 Static)</option>
              <option value="C125">C125 (Thera Frig)</option>
              <option value="Return">Return Hole</option>
            </select>
          </div>
        </div>

        <div class="wh-bm-field">
          <label>Status Tag (Optional):</label>
          <select id="bm-select-status" class="wh-bm-select">
            <option value="">None (Stable)</option>
            <option value="EOL">EOL (&lt;4 hours remaining)</option>
            <option value="Half">Half Mass (&lt;50% remaining)</option>
            <option value="Crit">Crit Mass (&lt;10% remaining)</option>
            <option value="Frig">Frigate Only (&lt;=5kt)</option>
          </select>
        </div>

        <div class="wh-bm-preview-box">
          <span class="wh-bm-preview-label">PREVIEW LABEL:</span>
          <div class="wh-bm-preview-text" id="bm-preview-text">ABC J123456 (C3) K162</div>
        </div>

        <button type="button" class="btn-copy-bm" id="btn-copy-bm">
          Copy Bookmark String to Clipboard
        </button>
      </div>

      <!-- Quick Shortcuts Cheatsheet -->
      <div class="wh-guide-cheatsheet-card">
        <h4>EVE Hotkey Cheatsheet</h4>
        <div class="wh-cheat-row"><kbd>Alt + P</kbd> <span>Probe Scanner Window</span></div>
        <div class="wh-cheat-row"><kbd>Ctrl + B</kbd> <span>Save Location (Bookmark)</span></div>
        <div class="wh-cheat-row"><kbd>Alt + D</kbd> <span>Directional Scanner</span></div>
        <div class="wh-cheat-row"><kbd>Ctrl + A</kbd> <span>Select All Signatures</span></div>
        <div class="wh-cheat-row"><kbd>Ctrl + Space</kbd> <span>Stop Ship Engine</span></div>
      </div>

      <!-- Folder & Expiry Guidance -->
      <div class="wh-guide-folder-card">
        <h4>Bookmark Organization</h4>
        <div class="wh-folder-rule">
          <strong>Folder:</strong> Corporation / Alliance Shared Locations (e.g. <code>Corp Wormholes</code>)
        </div>
        <div class="wh-folder-rule">
          <strong>Wormhole Expiry:</strong> <code>2 Days</code> (prevents clutter)
        </div>
        <div class="wh-folder-rule">
          <strong>Perches &amp; Safe Spots:</strong> <code>Never</code> (permanent)
        </div>
      </div>
    `;

    // Hook up dynamic builder events
    const sigInput = box.querySelector<HTMLInputElement>('#bm-input-sig')!;
    const destInput = box.querySelector<HTMLInputElement>('#bm-input-dest')!;
    const codeInput = box.querySelector<HTMLInputElement>('#bm-input-code')!;
    const codeSelect = box.querySelector<HTMLSelectElement>('#bm-select-code')!;
    const statusSelect = box.querySelector<HTMLSelectElement>('#bm-select-status')!;
    const previewEl = box.querySelector<HTMLElement>('#bm-preview-text')!;
    const copyBtn = box.querySelector<HTMLButtonElement>('#btn-copy-bm')!;

    const updatePreview = () => {
      const formatted = formatWormholeBookmark(
        sigInput.value,
        destInput.value,
        codeInput.value,
        statusSelect.value
      );
      previewEl.textContent = formatted || '(Enter details above)';
    };

    sigInput.oninput = updatePreview;
    destInput.oninput = updatePreview;
    codeInput.oninput = updatePreview;
    statusSelect.onchange = updatePreview;

    codeSelect.onchange = () => {
      if (codeSelect.value) {
        codeInput.value = codeSelect.value;
        updatePreview();
      }
    };

    copyBtn.onclick = () => {
      const text = previewEl.textContent || '';
      if (text && text !== '(Enter details above)') {
        navigator.clipboard.writeText(text);
        this.showWaypointToast(`Copied in-game bookmark: "${text}"`);
        copyBtn.textContent = ' Copied to Clipboard!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy Bookmark String to Clipboard';
          copyBtn.classList.remove('copied');
        }, 2500);
      }
    };

    inspector.append(box);
  }
}
