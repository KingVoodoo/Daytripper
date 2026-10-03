import { requireBackendAccess, backendGrantKey, watchBackendAccess } from './backend-access';
import { formatIsk, formatRelativeTime } from './combat-model';
import { universeGraph } from './universe-graph';
import { call, native } from './bridge';

export interface ZkillItem {
  killmailId: number;
  killmailTime: string;
  relativeTime: string;
  totalValue: number;
  formattedIsk: string;
  victim: {
    characterId?: number;
    characterName?: string;
    corporationId?: number;
    corporationName?: string;
    allianceId?: number;
    allianceName?: string;
    shipTypeId: number;
    shipName?: string;
  };
  finalBlow: {
    characterId?: number;
    characterName?: string;
    corporationId?: number;
    corporationName?: string;
    shipTypeId?: number;
    shipName?: string;
  };
  attackersCount: number;
  solo: boolean;
  npc: boolean;
  isCapsule: boolean;
  zkillUrl: string;
}

export interface SystemZkillSummary {
  systemId: number;
  killsLast24h: number;
  killsLast1h: number;
  totalIskDestroyed24h: number;
  formattedTotalIsk: string;
  dangerRating: 'HIGH DANGER' | 'ACTIVE' | 'MODERATE' | 'QUIET';
  dangerClass: 'high' | 'active' | 'moderate' | 'quiet';
  kills: ZkillItem[];
}

export interface SystemSovSummary {
  systemId: number;
  sovType: 'alliance' | 'faction' | 'npc_null' | 'empire' | 'wspace';
  allianceId?: number;
  allianceName?: string;
  allianceLogoUrl?: string;
  corporationId?: number;
  corporationName?: string;
  factionId?: number;
  factionName?: string;
  factionLogoUrl?: string;
  title: string;
  description: string;
}

export interface SystemRundownInfo {
  systemId: number;
  name: string;
  security: number;
  trueSecurityText: string;
  securityClass: string;
  constellationId?: number;
  constellationName?: string;
  regionId?: number;
  regionName?: string;
  stargatesCount: number;
  stationsCount: number;
  planetsCount: number;
}

// In-memory caches to prevent redundant network calls & respect third-party rate limits
const nameCache = new Map<number, string>();
const zkillCache = new Map<number, { data: SystemZkillSummary; fetchedAt: number; accessGrant: string | null }>();
const sovCache = new Map<number, { data: SystemSovSummary; fetchedAt: number; accessGrant: string | null }>();
const rundownCache = new Map<number, { data: SystemRundownInfo; fetchedAt: number }>();

let globalSovMap: Map<number, { alliance_id?: number; corporation_id?: number; faction_id?: number }> | null = null;
let globalSovMapFetchedAt = 0;

// Standard Faction ID lookup table for quick offline & instant resolution
const FACTION_NAMES: Record<number, string> = {
  500001: 'Caldari State',
  500002: 'Minmatar Republic',
  500003: 'Amarr Empire',
  500004: 'Gallente Federation',
  500005: 'Jove Empire',
  500006: 'CONCORD Assembly',
  500007: 'Ammatar Mandate',
  500008: 'Khanid Kingdom',
  500009: 'The Syndicate',
  500010: 'Guristas Pirates',
  500011: 'Angel Cartel',
  500012: 'The Blood Raider Covenant',
  500013: 'The InterBus',
  500014: 'ORE',
  500015: 'Thukker Tribe',
  500016: 'The Servant Sisters of EVE',
  500017: 'The Society of Conscious Thought',
  500018: 'Mordu\'s Legion Command',
  500019: 'Sansha\'s Nation',
  500020: 'Serpentis'
};

/**
 * Batch resolve EVE Online item, character, corporation, and alliance names using public ESI.
 */
export async function resolveEveNames(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const toFetch: number[] = [];

  for (const id of ids) {
    if (!id || id <= 0) continue;
    if (FACTION_NAMES[id]) {
      result.set(id, FACTION_NAMES[id]);
      nameCache.set(id, FACTION_NAMES[id]);
      continue;
    }
    const cached = nameCache.get(id);
    if (cached) {
      result.set(id, cached);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return result;

  // Deduplicate IDs
  const uniqueToFetch = Array.from(new Set(toFetch)).slice(0, 400);

  try {
    const res = await fetch('https://esi.evetech.net/latest/universe/names/?datasource=tranquility', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(uniqueToFetch),
      signal: AbortSignal.timeout(6000)
    });

    if (res.ok) {
      const items: Array<{ id: number; name: string; category: string }> = await res.json();
      for (const item of items) {
        nameCache.set(item.id, item.name);
        result.set(item.id, item.name);
      }
    }
  } catch (err) {
    console.warn('[SystemIntel] Failed to resolve EVE names via ESI:', err);
  }

  return result;
}

let cachedBackendInfo: { url: string; token: string | null; checkedAt: number; accessGrant: string } | null = null;

async function getBackendConnection(): Promise<{ url: string; token: string | null; accessGrant: string } | null> {
  return null;
}

export const ZKILL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (900,000ms) to strictly avoid third-party rate limits

const inFlightZkill = new Map<string, Promise<SystemZkillSummary>>();
class BackendGrantChanged extends Error {}
const cacheAvailable = (value: { accessGrant: string | null }) => value.accessGrant === null || value.accessGrant === backendGrantKey();
function assertGrant(grant: string) { if (backendGrantKey() !== grant) throw new BackendGrantChanged('WOK backend access changed.'); }
watchBackendAccess(() => {
  for (const [key, value] of zkillCache) if (!cacheAvailable(value)) zkillCache.delete(key);
  for (const [key, value] of sovCache) if (!cacheAvailable(value)) sovCache.delete(key);
  if (cachedBackendInfo?.accessGrant !== backendGrantKey()) cachedBackendInfo = null;
});

/**
 * Fetch recent kills for a solar system from backend proxy cache, falling back to direct zKillboard API.
 */
export async function fetchSystemZkill(systemId: number): Promise<SystemZkillSummary> {
  if (native) { try { await requireBackendAccess(); } catch {} }
  const requestKey = (backendGrantKey() || 'public') + ':' + systemId;
  const cached = zkillCache.get(systemId);
  if (cached && cacheAvailable(cached) && Date.now() - cached.fetchedAt < ZKILL_CACHE_TTL_MS) {
    return cached.data;
  }

  // Deduplicate concurrent in-flight requests for the same solar system
  const existingPromise = inFlightZkill.get(requestKey);
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = (async () => {
    // 1. Attempt to query hardened backend proxy cache first
    try {
      const conn = await getBackendConnection();
      if (conn?.url) {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (conn.token) headers['Authorization'] = `Bearer ${conn.token}`;
        const resp = await fetch(`${conn.url}/api/companion/intel/system/${systemId}`, {
          headers,
          signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) {
          const body = await resp.json();
          if (body?.success && body?.summary) {
            const raw = body.summary;
            const idsToResolve: number[] = [];
            for (const k of raw.kills || []) {
              if (k.victim?.shipTypeId) idsToResolve.push(k.victim.shipTypeId);
              if (k.victim?.characterId) idsToResolve.push(k.victim.characterId);
              if (k.victim?.corporationId) idsToResolve.push(k.victim.corporationId);
              if (k.victim?.allianceId) idsToResolve.push(k.victim.allianceId);
              if (k.finalBlow?.characterId) idsToResolve.push(k.finalBlow.characterId);
              if (k.finalBlow?.corporationId) idsToResolve.push(k.finalBlow.corporationId);
              if (k.finalBlow?.shipTypeId) idsToResolve.push(k.finalBlow.shipTypeId);
            }
            const names = await resolveEveNames(idsToResolve);
            const enrichedKills: ZkillItem[] = (raw.kills || []).map((k: any) => ({
              killmailId: k.killmailId,
              killmailTime: k.killmailTime,
              relativeTime: formatRelativeTime(k.killmailTime),
              totalValue: k.totalValue || 0,
              formattedIsk: formatIsk(k.totalValue || 0),
              victim: {
                characterId: k.victim?.characterId,
                characterName: k.victim?.characterId ? names.get(k.victim.characterId) : undefined,
                corporationId: k.victim?.corporationId,
                corporationName: k.victim?.corporationId ? names.get(k.victim.corporationId) : undefined,
                allianceId: k.victim?.allianceId,
                allianceName: k.victim?.allianceId ? names.get(k.victim.allianceId) : undefined,
                shipTypeId: k.victim?.shipTypeId || 0,
                shipName: k.victim?.shipTypeId ? (names.get(k.victim.shipTypeId) || `Ship #${k.victim.shipTypeId}`) : 'Unknown Ship'
              },
              finalBlow: {
                characterId: k.finalBlow?.characterId,
                characterName: k.finalBlow?.characterId ? (names.get(k.finalBlow.characterId) || 'Unknown Attacker') : 'NPC Entity',
                corporationId: k.finalBlow?.corporationId,
                corporationName: k.finalBlow?.corporationId ? names.get(k.finalBlow.corporationId) : undefined,
                shipTypeId: k.finalBlow?.shipTypeId,
                shipName: k.finalBlow?.shipTypeId ? names.get(k.finalBlow.shipTypeId) : undefined
              },
              attackersCount: k.attackersCount || 1,
              solo: Boolean(k.solo),
              npc: Boolean(k.npc),
              isCapsule: Boolean(k.isCapsule),
              zkillUrl: k.zkillUrl || `https://zkillboard.com/kill/${k.killmailId}/`
            }));

            const summary: SystemZkillSummary = {
              systemId: raw.systemId,
              killsLast24h: raw.killsLast24h,
              killsLast1h: raw.killsLast1h,
              totalIskDestroyed24h: raw.totalIskDestroyed24h,
              formattedTotalIsk: formatIsk(raw.totalIskDestroyed24h),
              dangerRating: raw.dangerRating,
              dangerClass: raw.dangerClass,
              kills: enrichedKills
            };
            assertGrant(conn.accessGrant);
            zkillCache.set(systemId, { data: summary, fetchedAt: Date.now(), accessGrant: conn.accessGrant });
            return summary;
          }
        }
      }
    } catch (error) {
      if (error instanceof BackendGrantChanged) throw error;
      // Backend proxy unavailable or timed out; fall through to direct fetch
    }

    // Direct fallback fetch from zKillboard
    try {
      const res = await fetch(`https://zkillboard.com/api/solarSystemID/${systemId}/`, {
        headers: {
          'User-Agent': 'WOKAuth-Companion-App (EVE Online Capsuleer Tool)'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok) {
        throw new Error(`zKillboard HTTP ${res.status}`);
      }

      const rawList = await res.json();
      const killmails: any[] = Array.isArray(rawList) ? rawList : [];

      const now = Date.now();
      let kills24h = 0;
      let kills1h = 0;
      let totalIsk24h = 0;

      const idsToResolve: number[] = [];

      for (const km of killmails) {
        const timeMs = new Date(km.killmail_time).getTime();
        const ageMs = now - timeMs;
        const isk = Number(km.zkb?.totalValue ?? km.zkb?.destroyedValue ?? 0);

        if (ageMs <= 86400000) {
          kills24h++;
          totalIsk24h += isk;
        }
        if (ageMs <= 3600000) {
          kills1h++;
        }

        if (km.victim?.ship_type_id) idsToResolve.push(km.victim.ship_type_id);
        if (km.victim?.character_id) idsToResolve.push(km.victim.character_id);
        if (km.victim?.corporation_id) idsToResolve.push(km.victim.corporation_id);
        if (km.victim?.alliance_id) idsToResolve.push(km.victim.alliance_id);

        const finalAtt = (km.attackers || []).find((a: any) => a.final_blow) || km.attackers?.[0];
        if (finalAtt) {
          if (finalAtt.ship_type_id) idsToResolve.push(finalAtt.ship_type_id);
          if (finalAtt.character_id) idsToResolve.push(finalAtt.character_id);
          if (finalAtt.corporation_id) idsToResolve.push(finalAtt.corporation_id);
        }
      }

      // Resolve ship & pilot names in batch
      const names = await resolveEveNames(idsToResolve);

      // Format top 8 recent kills
      const recentKills: ZkillItem[] = killmails.slice(0, 8).map((km) => {
        const victim = km.victim || {};
        const finalAtt = (km.attackers || []).find((a: any) => a.final_blow) || km.attackers?.[0] || {};
        const totalVal = Number(km.zkb?.totalValue ?? km.zkb?.destroyedValue ?? 0);
        const isCapsule = victim.ship_type_id === 670 || victim.ship_type_id === 33328;

        return {
          killmailId: km.killmail_id,
          killmailTime: km.killmail_time,
          relativeTime: formatRelativeTime(km.killmail_time),
          totalValue: totalVal,
          formattedIsk: formatIsk(totalVal),
          victim: {
            characterId: victim.character_id,
            characterName: victim.character_id ? (names.get(victim.character_id) || 'Unknown Pilot') : 'NPC',
            corporationId: victim.corporation_id,
            corporationName: victim.corporation_id ? names.get(victim.corporation_id) : undefined,
            allianceId: victim.alliance_id,
            allianceName: victim.alliance_id ? names.get(victim.alliance_id) : undefined,
            shipTypeId: victim.ship_type_id || 0,
            shipName: victim.ship_type_id ? (names.get(victim.ship_type_id) || `Ship #${victim.ship_type_id}`) : 'Unknown Ship'
          },
          finalBlow: {
            characterId: finalAtt.character_id,
            characterName: finalAtt.character_id ? (names.get(finalAtt.character_id) || 'Unknown Attacker') : 'NPC Entity',
            corporationId: finalAtt.corporation_id,
            corporationName: finalAtt.corporation_id ? names.get(finalAtt.corporation_id) : undefined,
            shipTypeId: finalAtt.ship_type_id,
            shipName: finalAtt.ship_type_id ? names.get(finalAtt.ship_type_id) : undefined
          },
          attackersCount: Array.isArray(km.attackers) ? km.attackers.length : 1,
          solo: Boolean(km.zkb?.solo),
          npc: Boolean(km.zkb?.npc),
          isCapsule,
          zkillUrl: `https://zkillboard.com/kill/${km.killmail_id}/`
        };
      });

      let dangerRating: 'HIGH DANGER' | 'ACTIVE' | 'MODERATE' | 'QUIET' = 'QUIET';
      let dangerClass: 'high' | 'active' | 'moderate' | 'quiet' = 'quiet';

      if (kills1h >= 3 || kills24h >= 8 || totalIsk24h >= 1_500_000_000) {
        dangerRating = 'HIGH DANGER';
        dangerClass = 'high';
      } else if (kills24h >= 3 || kills1h >= 1 || totalIsk24h >= 300_000_000) {
        dangerRating = 'ACTIVE';
        dangerClass = 'active';
      } else if (kills24h >= 1) {
        dangerRating = 'MODERATE';
        dangerClass = 'moderate';
      }

      const summary: SystemZkillSummary = {
        systemId,
        killsLast24h: kills24h,
        killsLast1h: kills1h,
        totalIskDestroyed24h: totalIsk24h,
        formattedTotalIsk: formatIsk(totalIsk24h),
        dangerRating,
        dangerClass,
        kills: recentKills
      };

      zkillCache.set(systemId, { data: summary, fetchedAt: Date.now(), accessGrant: null });
      return summary;
    } catch (err) {
      console.warn(`[SystemIntel] Could not fetch zKillboard for system ${systemId}:`, err);
      // Return previous cached result if available to avoid flashing empty state
      if (cached && cacheAvailable(cached)) {
        return cached.data;
      }
      const fallback: SystemZkillSummary = {
        systemId,
        killsLast24h: 0,
        killsLast1h: 0,
        totalIskDestroyed24h: 0,
        formattedTotalIsk: '0 ISK',
        dangerRating: 'QUIET',
        dangerClass: 'quiet',
        kills: []
      };
      return fallback;
    } finally {
      inFlightZkill.delete(requestKey);
    }
  })();

  inFlightZkill.set(requestKey, fetchPromise);
  return fetchPromise;
}

/**
 * Fetch system sovereignty info from backend proxy cache, falling back to public ESI.
 */
export async function fetchSystemSovereignty(systemId: number, secVal?: number): Promise<SystemSovSummary> {
  if (native) { try { await requireBackendAccess(); } catch {} }
  const cached = sovCache.get(systemId);
  if (cached && cacheAvailable(cached) && Date.now() - cached.fetchedAt < 600000) {
    return cached.data;
  }

  // J-Space check (Thera or C1-C6)
  if (systemId === 31000005 || (systemId >= 31000000 && systemId < 32000000)) {
    const wspaceSov: SystemSovSummary = {
      systemId,
      sovType: 'wspace',
      title: 'W-Space (Unclaimable)',
      description: 'Capsuleer and Sleeper territory. No territorial sovereignty mechanics apply.'
    };
    sovCache.set(systemId, { data: wspaceSov, fetchedAt: Date.now(), accessGrant: null });
    return wspaceSov;
  }

  // 1. Attempt to query hardened backend proxy cache first
  try {
    const conn = await getBackendConnection();
    if (conn?.url) {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (conn.token) headers['Authorization'] = `Bearer ${conn.token}`;
      const resp = await fetch(`${conn.url}/api/companion/intel/sov/${systemId}`, {
        headers,
        signal: AbortSignal.timeout(4000)
      });
      if (resp.ok) {
        const body = await resp.json();
        if (body?.success && body?.sov) {
          const raw = body.sov;
          let allianceName = raw.allianceName;
          let allianceLogoUrl = raw.allianceLogoUrl;
          if (raw.allianceId) {
            allianceLogoUrl = `https://images.evetech.net/alliances/${raw.allianceId}/logo?size=64`;
            if (!allianceName) {
              const names = await resolveEveNames([raw.allianceId]);
              allianceName = names.get(raw.allianceId);
            }
          }
          const sovResult: SystemSovSummary = {
            systemId,
            sovType: raw.sovType,
            allianceId: raw.allianceId,
            allianceName,
            allianceLogoUrl,
            corporationId: raw.corporationId,
            factionId: raw.factionId,
            factionName: raw.factionId ? FACTION_NAMES[raw.factionId] : undefined,
            title: raw.title,
            description: raw.description
          };
          assertGrant(conn.accessGrant);
          sovCache.set(systemId, { data: sovResult, fetchedAt: Date.now(), accessGrant: conn.accessGrant });
          return sovResult;
        }
      }
    }
  } catch (error) {
    if (error instanceof BackendGrantChanged) throw error;
    // Backend proxy unavailable or timed out; fall through to direct ESI fetch
  }

  // Load global sovereignty map from ESI if not cached or older than 30 mins
  if (!globalSovMap || Date.now() - globalSovMapFetchedAt > 1800000) {
    try {
      const res = await fetch('https://esi.evetech.net/latest/sovereignty/map/?datasource=tranquility', {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const list: Array<{ system_id: number; alliance_id?: number; corporation_id?: number; faction_id?: number }> = await res.json();
        const map = new Map<number, { alliance_id?: number; corporation_id?: number; faction_id?: number }>();
        for (const item of list) {
          map.set(item.system_id, item);
        }
        globalSovMap = map;
        globalSovMapFetchedAt = Date.now();
      }
    } catch (err) {
      console.warn('[SystemIntel] Could not fetch ESI sovereignty map:', err);
    }
  }

  const entry = globalSovMap?.get(systemId);
  let summary: SystemSovSummary;

  if (entry?.alliance_id) {
    const names = await resolveEveNames([entry.alliance_id, entry.corporation_id || 0].filter(Boolean));
    const allianceName = names.get(entry.alliance_id) || 'Unknown Alliance';
    const corpName = entry.corporation_id ? names.get(entry.corporation_id) : undefined;

    summary = {
      systemId,
      sovType: 'alliance',
      allianceId: entry.alliance_id,
      allianceName,
      allianceLogoUrl: `https://images.evetech.net/alliances/${entry.alliance_id}/logo?size=64`,
      corporationId: entry.corporation_id,
      corporationName: corpName,
      title: 'Sovereign Alliance',
      description: `Held by ${allianceName}${corpName ? ` (${corpName})` : ''}`
    };
  } else if (entry?.faction_id) {
    const factionName = FACTION_NAMES[entry.faction_id] || (await resolveEveNames([entry.faction_id])).get(entry.faction_id) || 'Empire Faction';
    summary = {
      systemId,
      sovType: 'faction',
      factionId: entry.faction_id,
      factionName,
      factionLogoUrl: `https://images.evetech.net/corporations/${entry.faction_id}/logo?size=64`,
      title: 'Faction Control',
      description: `Controlled by ${factionName}`
    };
  } else {
    // Unclaimable space: determine whether NPC Nullsec or Empire space
    let sec = secVal;
    if (sec === undefined) {
      const info = universeGraph.getSystemInfo(systemId);
      sec = info?.security ?? 0.0;
    }

    if (sec <= 0.0) {
      summary = {
        systemId,
        sovType: 'npc_null',
        title: 'NPC Nullsec',
        description: 'Unclaimable sovereign territory. Open capsuleer space under pirate / faction station jurisdiction.'
      };
    } else {
      summary = {
        systemId,
        sovType: 'empire',
        title: sec >= 0.45 ? 'Highsec Empire Space' : 'Lowsec Empire Space',
        description: 'Standard empire jurisdiction protected by CONCORD / faction police.'
      };
    }
  }

  sovCache.set(systemId, { data: summary, fetchedAt: Date.now(), accessGrant: null });
  return summary;
}

/**
 * Fetch detailed system rundown (true sec, stargates count, station count, planets count, constellation)
 */
export async function fetchSystemRundown(systemId: number, fallbackName?: string): Promise<SystemRundownInfo> {
  const cached = rundownCache.get(systemId);
  if (cached && Date.now() - cached.fetchedAt < 600000) {
    return cached.data;
  }

  const sysInfo = universeGraph.getSystemInfo(systemId);
  const baseName = sysInfo?.name || fallbackName || `System #${systemId}`;
  let baseSec = sysInfo?.security ?? (systemId >= 31000000 ? -0.99 : 0.0);

  let stargatesCount = 0;
  let stationsCount = 0;
  let planetsCount = 0;
  let constellationId: number | undefined;
  let constellationName: string | undefined;

  // J-space has no standard stargates or empire stations
  if (systemId >= 31000000 && systemId < 32000000) {
    baseSec = -0.99;
  } else {
    try {
      const res = await fetch(`https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.security_status === 'number') {
          baseSec = data.security_status;
        }
        stargatesCount = Array.isArray(data.stargates) ? data.stargates.length : 0;
        stationsCount = Array.isArray(data.stations) ? data.stations.length : 0;
        planetsCount = Array.isArray(data.planets) ? data.planets.length : 0;
        constellationId = data.constellation_id;

        if (constellationId) {
          const names = await resolveEveNames([constellationId]);
          constellationName = names.get(constellationId);
        }
      }
    } catch (err) {
      console.warn(`[SystemIntel] Could not fetch ESI universe data for ${systemId}:`, err);
    }
  }

  const trueSecText = baseSec < 0 && baseSec > -0.05 ? '0.0' : baseSec <= -0.95 ? '-1.0' : baseSec.toFixed(2);
  const secClass = baseSec >= 0.45 ? 'hisec' : baseSec > 0.0 ? 'lowsec' : (systemId >= 31000000 ? 'wspace' : 'nullsec');

  const rundown: SystemRundownInfo = {
    systemId,
    name: baseName,
    security: baseSec,
    trueSecurityText: trueSecText,
    securityClass: secClass,
    constellationId,
    constellationName,
    regionId: sysInfo?.region_id,
    stargatesCount,
    stationsCount,
    planetsCount
  };

  rundownCache.set(systemId, { data: rundown, fetchedAt: Date.now() });
  return rundown;
}

export interface SystemHourlyActivity {
  systemId: number;
  shipKills: number;
  npcKills: number;
  podKills: number;
  shipJumps: number;
}

export interface UniverseActivity {
  fetchedAt: number;
  kills: Map<number, { shipKills: number; npcKills: number; podKills: number }>;
  jumps: Map<number, number>;
}

const ACTIVITY_TTL_MS = 5 * 60 * 1000;
let activityCache: UniverseActivity | null = null;
let activityInFlight: Promise<UniverseActivity> | null = null;

export function activityFor(systemId: number, activity: UniverseActivity | null): SystemHourlyActivity {
  const kills = activity?.kills.get(systemId);
  return {
    systemId,
    shipKills: kills?.shipKills || 0,
    npcKills: kills?.npcKills || 0,
    podKills: kills?.podKills || 0,
    shipJumps: activity?.jumps.get(systemId) || 0,
  };
}

/**
 * Public ESI last-hour ship/NPC/pod kills and gate jumps for every system.
 * Cached for 5 minutes to stay inside ESI courtesy limits.
 */
export async function fetchUniverseActivity(): Promise<UniverseActivity> {
  if (activityCache && Date.now() - activityCache.fetchedAt < ACTIVITY_TTL_MS) {
    return activityCache;
  }
  if (activityInFlight) return activityInFlight;

  activityInFlight = (async () => {
    const empty: UniverseActivity = { fetchedAt: Date.now(), kills: new Map(), jumps: new Map() };
    try {
      const [killsRes, jumpsRes] = await Promise.all([
        fetch('https://esi.evetech.net/latest/universe/system_kills/?datasource=tranquility', {
          signal: AbortSignal.timeout(8000),
        }),
        fetch('https://esi.evetech.net/latest/universe/system_jumps/?datasource=tranquility', {
          signal: AbortSignal.timeout(8000),
        }),
      ]);
      const next: UniverseActivity = { fetchedAt: Date.now(), kills: new Map(), jumps: new Map() };
      if (killsRes.ok) {
        const rows: Array<{ system_id: number; ship_kills?: number; npc_kills?: number; pod_kills?: number }> = await killsRes.json();
        for (const row of rows) {
          if (!row?.system_id) continue;
          next.kills.set(row.system_id, {
            shipKills: Number(row.ship_kills) || 0,
            npcKills: Number(row.npc_kills) || 0,
            podKills: Number(row.pod_kills) || 0,
          });
        }
      }
      if (jumpsRes.ok) {
        const rows: Array<{ system_id: number; ship_jumps?: number }> = await jumpsRes.json();
        for (const row of rows) {
          if (!row?.system_id) continue;
          next.jumps.set(row.system_id, Number(row.ship_jumps) || 0);
        }
      }
      activityCache = next;
      return next;
    } catch (err) {
      console.warn('[SystemIntel] Could not fetch ESI universe activity:', err);
      return activityCache || empty;
    } finally {
      activityInFlight = null;
    }
  })();

  return activityInFlight;
}
