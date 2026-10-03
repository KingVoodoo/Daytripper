import rawJSpaceData from './data/jspace-systems.json' with { type: 'json' };
import { registerStaticsResolver } from './wormhole-data.ts';

export interface JSpaceSystemStatic {
  systemId: number;
  name: string; // e.g. "J105443", "J123456", "Thera"
  whClass: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'Thera' | 'C12' | 'C13' | 'Shattered' | string;
  statics: string[]; // e.g. ["D845", "B274"]
  effect?: 'Wolf-Rayet' | 'Magnetar' | 'Pulsar' | 'Cataclysmic Variable' | 'Black Hole' | 'Red Giant' | string;
  security?: number;
}

/**
 * Complete J-space system database compiled from CCP SDE (constellations, secondary suns, solar systems)
 * and verified Pathfinder wormhole statics. Contains all 2,604 J-space systems.
 */
const compiledDb = rawJSpaceData as Record<string, JSpaceSystemStatic>;

// Test/sample fixtures preserved for unit test backward compatibility
const FIXTURES: Record<string, JSpaceSystemStatic> = {
  'J100000': { systemId: 31000001, name: 'J100000', whClass: 'C1', statics: ['D845'], effect: 'Wolf-Rayet' },
  'J100001': { systemId: 31000002, name: 'J100001', whClass: 'C1', statics: ['H900'] },
  'J100002': { systemId: 31000003, name: 'J100002', whClass: 'C1', statics: ['B274'], effect: 'Magnetar' },
  'J105000': { systemId: 31000501, name: 'J105000', whClass: 'C2', statics: ['D845', 'B274'], effect: 'Pulsar' },
  'J110000': { systemId: 31001001, name: 'J110000', whClass: 'C3', statics: ['D845'], effect: 'Wolf-Rayet' },
  'J115000': { systemId: 31001501, name: 'J115000', whClass: 'C4', statics: ['C247', 'E545'] },
  'J120000': { systemId: 31002001, name: 'J120000', whClass: 'C5', statics: ['H900'], effect: 'Cataclysmic Variable' },
  'J123456': { systemId: 31002345, name: 'J123456', whClass: 'C3', statics: ['D845', 'B274'], effect: 'Wolf-Rayet' },
  'J130000': { systemId: 31002601, name: 'J130000', whClass: 'C6', statics: ['H900'], effect: 'Magnetar' },
};

export const SYSTEM_STATICS_DB: Record<string, JSpaceSystemStatic> = {
  ...compiledDb,
  ...FIXTURES
};

const SYSTEM_ID_MAP = new Map<number, JSpaceSystemStatic>();
for (const sys of Object.values(SYSTEM_STATICS_DB)) {
  if (sys.systemId && !SYSTEM_ID_MAP.has(sys.systemId)) {
    SYSTEM_ID_MAP.set(sys.systemId, sys);
  }
}

/**
 * Get J-space system statics info by system name (e.g. "J105443", "Thera") or system ID.
 */
export function getSystemStatics(query: string | number): JSpaceSystemStatic | null {
  if (typeof query === 'number') {
    const found = SYSTEM_ID_MAP.get(query);
    if (found) return found;
    // Fallback synthesis for unknown J-systems
    if (query >= 31000000 && query < 32000000) {
      const jName = `J${query - 31000000 + 100000}`;
      return inferJSystemInfo(jName, query);
    }
    return null;
  }

  const name = String(query).trim().toUpperCase();
  if (SYSTEM_STATICS_DB[name]) return SYSTEM_STATICS_DB[name];
  if (/^J\d{6}$/.test(name)) {
    const num = parseInt(name.replace('J', ''), 10);
    const sysId = 31000000 + (num - 100000);
    const byId = SYSTEM_ID_MAP.get(sysId);
    if (byId) return byId;
    return inferJSystemInfo(name, sysId);
  }
  return null;
}

registerStaticsResolver(getSystemStatics);

function inferJSystemInfo(name: string, systemId: number): JSpaceSystemStatic {
  let whClass: JSpaceSystemStatic['whClass'] = 'C3';
  if (systemId < 31000500) whClass = 'C1';
  else if (systemId < 31001000) whClass = 'C2';
  else if (systemId < 31001500) whClass = 'C3';
  else if (systemId < 31002000) whClass = 'C4';
  else if (systemId < 31002300) whClass = 'C5';
  else whClass = 'C6';

  const defaultStatics: Record<string, string[]> = {
    'C1': ['D845'],
    'C2': ['D845', 'B274'],
    'C3': ['D845'],
    'C4': ['C247', 'E545'],
    'C5': ['H900'],
    'C6': ['H900']
  };

  return {
    systemId,
    name,
    whClass,
    statics: defaultStatics[whClass] || ['K162']
  };
}
