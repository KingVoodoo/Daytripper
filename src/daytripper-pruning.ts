export interface ScoutLink {
  id: string; sourceId: number; targetId: number; isStargate?: boolean;
  scoutHub?: number; expiresAt?: number;
}
export interface ScoutNode { systemId: number; scoutedBy?: string; customNotes?: string; }

// Only feed-owned links are reconciled. Manual links and stargates remain intact.
export function pruneScoutLinks<T extends ScoutLink>(links: T[], nodes: ScoutNode[], hubId: number, liveTargets: Set<number>, now = Date.now()): { links: T[]; removed: T[] } {
  const removed: T[] = [];
  const kept = links.filter(link => {
    if (link.isStargate || (link.sourceId !== hubId && link.targetId !== hubId)) return true;
    const target = link.sourceId === hubId ? link.targetId : link.sourceId;
    const legacy = link.id === `wh-${hubId}-${target}` && nodes.some(node => node.systemId === target && node.scoutedBy === 'EVE-Scout');
    if (link.scoutHub !== hubId && !legacy) return true;
    const expired = Number.isFinite(link.expiresAt) && Number(link.expiresAt) <= now;
    if (!liveTargets.has(target) || expired) { removed.push(link); return false; }
    return true;
  });
  return {links: kept, removed};
}

export function isActiveScoutSignature(row: any, now = Date.now()): boolean {
  const expiry = row.expires_at ? Date.parse(row.expires_at) : NaN;
  return !(Number.isFinite(expiry) && expiry <= now) && !(row.remaining_hours != null && Number(row.remaining_hours) <= 0);
}

export function validateScoutSnapshot(value: unknown): any[] {
  if (!Array.isArray(value) || value.length > 500 || value.some(row => !row || !Number.isSafeInteger(Number(row.in_system_id)) || Number(row.in_system_id) <= 0 || !Number.isSafeInteger(Number(row.out_system_id)) || Number(row.out_system_id) <= 0 || typeof row.in_system_name !== 'string' || typeof row.out_system_name !== 'string' || row.in_system_name.length > 256 || row.out_system_name.length > 256 || Object.values(row).some(field => typeof field === 'string' && field.length > 4096) || (row.remaining_hours != null && (typeof row.remaining_hours !== 'number' || !Number.isFinite(row.remaining_hours) || row.remaining_hours < 0)))) throw new Error('Invalid EVE-Scout snapshot');
  return value;
}
