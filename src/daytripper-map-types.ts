import type { ScannedSignature } from './wormhole-data';

// Shared serialized fields; each runtime retains its own required fields and extensions.
export type SystemTacticalStatus = 'normal' | 'camped' | 'traffic' | 'eol_crit' | 'hole_control';

export interface WormholeNodeData {
  systemId: number;
  systemName: string;
  whClass: string;
  security?: number;
  depth: number;
  x?: number;
  y?: number;
  effect?: string;
  statics?: string[];
  status?: SystemTacticalStatus;
  customNotes?: string;
  scoutedBy?: string;
  locked?: boolean;
}

export interface WormholeLinkData {
  id: string;
  sourceId: number;
  targetId: number;
  sourceSig?: string;
  targetSig?: string;
  whCode?: string;
  returnWhCode?: string;
  massStatus: 'stable' | 'half' | 'critical';
  lifetimeStatus?: 'stable' | 'eol';
  isFrigateOnly?: boolean;
  massJumpedKg?: number;
}

export interface DaytripperMapData<N = WormholeNodeData, L = WormholeLinkData> {
  id: string;
  name: string;
  nodes: N[];
  links: L[];
  signatures: Array<{ systemId: number; sigs: ScannedSignature[] }>;
  selectedSystemId?: number | null;
  isBaseMap?: boolean;
  pan?: { x: number; y: number };
  zoom?: number;
  viewMode?: 'canvas' | 'tree' | 'scout';
}
