import type { WormholeNodeData, WormholeLinkData } from './daytripper-map-types';
export interface ScoutLinkUpdate {
  hubId: number; hubSig: string; destSig: string; whType: string;
  remHours?: number; expAt?: number; isEol: boolean; isFrig: boolean; shipSize?: string;
}
interface LinkFields {
  sourceId: number; sourceSig?: string; targetSig?: string; whCode?: string;
  remainingHours?: number; expiresAt?: number; lifetimeStatus?: 'stable' | 'eol';
  isFrigateOnly?: boolean; shipSize?: string;
}
export function updateScoutLink<T extends LinkFields>(link: T, update: ScoutLinkUpdate): T {
  const existingLink = { ...link };
  const { hubId, hubSig, destSig, whType, remHours, expAt, isEol, isFrig, shipSize } = update;
  const isExistingSourceHub = existingLink.sourceId === hubId;
  if (hubSig !== '???') {
    if (isExistingSourceHub) existingLink.sourceSig = hubSig;
    else existingLink.targetSig = hubSig;
  }
  if (destSig !== '???') {
    if (isExistingSourceHub) existingLink.targetSig = destSig;
    else existingLink.sourceSig = destSig;
  }
  if (whType !== 'WH' && whType !== '???') existingLink.whCode = whType;
  if (remHours !== undefined) existingLink.remainingHours = remHours;
  if (expAt !== undefined) existingLink.expiresAt = expAt;
  existingLink.lifetimeStatus = isEol ? 'eol' : 'stable';
  if (isFrig) existingLink.isFrigateOnly = true;
  if (shipSize) existingLink.shipSize = shipSize;
  return existingLink;
}

export interface ScoutNodeConstruction {
  targetId: number; targetName: string; targetClass: string; secVal?: number;
  hubId: number; defaultX: number; defaultY: number;
}
export function createScoutNode(input: ScoutNodeConstruction): WormholeNodeData & { parentId: number } {
  const { targetId, targetName, targetClass, secVal, hubId, defaultX, defaultY } = input;
  return {
    systemId: targetId,
    systemName: targetName,
    whClass: targetClass,
    security: secVal,
    depth: 1,
    parentId: hubId,
    x: defaultX,
    y: defaultY,
    scoutedBy: 'EVE-Scout'
  };
}
export function createScoutLink(input: ScoutLinkUpdate & { linkId: string; targetId: number }): WormholeLinkData & {
  scoutHub: number; lifetimeStatus: 'stable' | 'eol'; remainingHours?: number;
  expiresAt?: number; shipSize?: string; isStargate: boolean;
} {
  const { linkId, targetId, hubId, hubSig, destSig, whType, isEol, remHours, expAt, isFrig, shipSize } = input;
  return {
    id: linkId,
    scoutHub: hubId,
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
    shipSize: shipSize,
    isStargate: false
  };
}
