type StaticsResolver = (query: string | number) => any;
let _staticsResolver: StaticsResolver | null = null;

export function registerStaticsResolver(fn: StaticsResolver): void {
  _staticsResolver = fn;
}

export interface SystemEffect {
  name: string;
  description: string;
  bonuses: string[];
}

export const SYSTEM_EFFECTS: Record<string, SystemEffect> = {
  'Wolf-Rayet': {
    name: 'Wolf-Rayet',
    description: 'Small gun & armor HP boost system. Ideal for armor frigates and T3 destroyers.',
    bonuses: [
      '+100% Small Weapon Damage (at Class 6)',
      '+100% Armor HP',
      '-50% Signature Radius',
      '-50% Shield Transporter Efficiency'
    ]
  },
  'Magnetar': {
    name: 'Magnetar',
    description: 'Offensive damage boost system with severe tracking & targeting penalties.',
    bonuses: [
      '+100% Damage (at Class 6)',
      '-50% Missile Explosion Velocity',
      '-50% Targeting Range',
      '-50% Tracking Speed'
    ]
  },
  'Pulsar': {
    name: 'Pulsar',
    description: 'Shield HP & Capacitor recharge boost system with armor resistance penalties.',
    bonuses: [
      '+100% Shield HP (at Class 6)',
      '+100% Capacitor Recharge Rate',
      '-50% Armor Resistances',
      '+100% Signature Radius'
    ]
  },
  'Cataclysmic Variable': {
    name: 'Cataclysmic Variable',
    description: 'Capacitor penalty system with remote repair bonuses.',
    bonuses: [
      '-50% Capacitor Capacity',
      '-50% Capacitor Recharge Rate',
      '+100% Remote Shield & Armor Repair Amount',
      '+100% Remote Capacitor Transfer Amount'
    ]
  },
  'Black Hole': {
    name: 'Black Hole',
    description: 'High velocity & missile speed system with targeting penalties.',
    bonuses: [
      '+100% Ship Velocity',
      '-50% Inertia Modifier (slower turn)',
      '+100% Missile Velocity',
      '-50% Targeting Range'
    ]
  },
  'Red Giant': {
    name: 'Red Giant',
    description: 'Overheat & area damage boost system.',
    bonuses: [
      '+100% Overheat Bonus',
      '+100% Smartbomb Damage & Range',
      '+100% Bomb Damage'
    ]
  }
};

export interface WormholeCodeSpec {
  code: string;
  sourceSpace?: string;
  targetSpace: string;
  maxMassTons: number; // e.g. 2,000,000 for 2,000M kg
  maxJumpMassTons: number; // e.g. 375,000 for 375M kg (5,000 for Frigate only)
  lifetimeHours: number;
}

export const WORMHOLE_CODES: Record<string, WormholeCodeSpec> = {
  "A009": { code: "A009", targetSpace: "C13", maxMassTons: 500000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "A239": { code: "A239", sourceSpace: "Class 2 W-Space", targetSpace: "Lowsec", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "A641": { code: "A641", sourceSpace: "Highsec", targetSpace: "Highsec", maxMassTons: 2000000, maxJumpMassTons: 1000000, lifetimeHours: 16 },
  "A982": { code: "A982", sourceSpace: "Class 3 W-Space", targetSpace: "C6", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "B041": { code: "B041", sourceSpace: "Highsec", targetSpace: "C6", maxMassTons: 5000000, maxJumpMassTons: 375000, lifetimeHours: 48 },
  "B274": { code: "B274", sourceSpace: "Class 2 W-Space", targetSpace: "Highsec", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "B449": { code: "B449", sourceSpace: "Lowsec or Nullsec (0.0)", targetSpace: "Highsec", maxMassTons: 2000000, maxJumpMassTons: 1000000, lifetimeHours: 16 },
  "B520": { code: "B520", sourceSpace: "Class 6 W-Space", targetSpace: "Highsec", maxMassTons: 5000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "B735": { code: "B735", targetSpace: "Drifter (Barbican)", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "C008": { code: "C008", targetSpace: "C5", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "C125": { code: "C125", sourceSpace: "Class 1 W-Space", targetSpace: "C2", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "C140": { code: "C140", sourceSpace: "Class 5 or Class 6 W-Space", targetSpace: "Lowsec", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "C247": { code: "C247", sourceSpace: "Class 4 W-Space", targetSpace: "C3", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "C248": { code: "C248", sourceSpace: "Class 6 W-Space", targetSpace: "Nullsec", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "C391": { code: "C391", sourceSpace: "Class 6 W-Space", targetSpace: "Lowsec", maxMassTons: 5000000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "C414": { code: "C414", targetSpace: "Drifter (Conflux)", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "C729": { code: "C729", sourceSpace: "\"Adjacent\" systems", targetSpace: "Pochven", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "D364": { code: "D364", sourceSpace: "Class 5 W-Space", targetSpace: "C2", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "D382": { code: "D382", sourceSpace: "Class 2 W-Space", targetSpace: "C2", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "D792": { code: "D792", sourceSpace: "Class 5 W-Space", targetSpace: "Highsec", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 24 },
  "D845": { code: "D845", sourceSpace: "Class 3 W-Space", targetSpace: "Highsec", maxMassTons: 5000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "E004": { code: "E004", targetSpace: "C1", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "E175": { code: "E175", sourceSpace: "Class 5 W-Space", targetSpace: "C4", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "E545": { code: "E545", sourceSpace: "Class 2 W-Space", targetSpace: "Nullsec", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "E587": { code: "E587", sourceSpace: "Thera", targetSpace: "Nullsec", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 16 },
  "F135": { code: "F135", sourceSpace: "Class 2 or Class 3 W-Space", targetSpace: "Thera", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "F216": { code: "F216", sourceSpace: "Class 2 to Class 6 W-Space", targetSpace: "Pochven", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "F353": { code: "F353", sourceSpace: "Class 1 W-Space", targetSpace: "Thera", maxMassTons: 100000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "G008": { code: "G008", targetSpace: "C6", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "G024": { code: "G024", sourceSpace: "Class 6 W-Space", targetSpace: "C2", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "H121": { code: "H121", sourceSpace: "Class 1 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "H296": { code: "H296", sourceSpace: "Class 5 W-Space", targetSpace: "C5", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "H900": { code: "H900", sourceSpace: "Class 4 W-Space", targetSpace: "C5", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "I182": { code: "I182", sourceSpace: "Class 3 W-Space", targetSpace: "C2", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "J244": { code: "J244", sourceSpace: "Class 1 W-Space", targetSpace: "Lowsec", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "J377": { code: "J377", sourceSpace: "C1/2/3/4 (+more?)", targetSpace: "Turnur", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "K162": { code: "K162", sourceSpace: "Any", targetSpace: "Incoming Link", maxMassTons: 0, maxJumpMassTons: 0, lifetimeHours: 24 },
  "K329": { code: "K329", sourceSpace: "Class 4 W-Space", targetSpace: "Nullsec", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "K346": { code: "K346", sourceSpace: "Class 3 W-Space", targetSpace: "Nullsec", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "L005": { code: "L005", targetSpace: "C2", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "L031": { code: "L031", sourceSpace: "Nullsec (0.0)", targetSpace: "Thera", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 16 },
  "L477": { code: "L477", sourceSpace: "Class 6 W-Space", targetSpace: "C3", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "L614": { code: "L614", sourceSpace: "Class 1 W-Space", targetSpace: "C5", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "M001": { code: "M001", targetSpace: "C4", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "M164": { code: "M164", sourceSpace: "Lowsec", targetSpace: "Thera", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "M267": { code: "M267", sourceSpace: "Class 5 W-Space", targetSpace: "C3", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "M555": { code: "M555", sourceSpace: "Highsec", targetSpace: "C5", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 24 },
  "M609": { code: "M609", sourceSpace: "Class 1 W-Space", targetSpace: "C4", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "N062": { code: "N062", sourceSpace: "Class 2 W-Space", targetSpace: "C5", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "N110": { code: "N110", sourceSpace: "Class 1 W-Space", targetSpace: "Highsec", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "N290": { code: "N290", sourceSpace: "Class 4 W-Space", targetSpace: "Lowsec", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "N432": { code: "N432", sourceSpace: "Lowsec or Nullsec (0.0)", targetSpace: "C5", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "N766": { code: "N766", sourceSpace: "Class 4 W-Space", targetSpace: "C2", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "N770": { code: "N770", sourceSpace: "Class 3 W-Space", targetSpace: "C5", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "N944": { code: "N944", sourceSpace: "Lowsec or Nullsec (0.0)", targetSpace: "Lowsec", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "N968": { code: "N968", sourceSpace: "Class 3 W-Space", targetSpace: "C3", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "O128": { code: "O128", sourceSpace: "K-space", targetSpace: "C4", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "O477": { code: "O477", sourceSpace: "Class 2 W-Space", targetSpace: "C3", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "O883": { code: "O883", sourceSpace: "Class 1 W-Space", targetSpace: "C3", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "P060": { code: "P060", sourceSpace: "Class 4 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "Q003": { code: "Q003", targetSpace: "Nullsec", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "Q063": { code: "Q063", sourceSpace: "Thera", targetSpace: "Highsec", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "Q317": { code: "Q317", sourceSpace: "Class 6 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "R051": { code: "R051", sourceSpace: "Highsec", targetSpace: "Lowsec", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 16 },
  "R081": { code: "R081", sourceSpace: "Pochven", targetSpace: "C4", maxMassTons: 1000000, maxJumpMassTons: 450000, lifetimeHours: 16 },
  "R259": { code: "R259", targetSpace: "Drifter (Redoubt)", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "R474": { code: "R474", sourceSpace: "Class 2 W-Space", targetSpace: "C6", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "R943": { code: "R943", sourceSpace: "K-space", targetSpace: "C2", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "S047": { code: "S047", sourceSpace: "Class 4 W-Space", targetSpace: "Highsec", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "S104": { code: "S104", sourceSpace: "Class 6 W-Space", targetSpace: "Nullsec", maxMassTons: 3000000, maxJumpMassTons: 300000, lifetimeHours: 24 },
  "S199": { code: "S199", sourceSpace: "Lowsec or Nullsec (0.0)", targetSpace: "Nullsec", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "S804": { code: "S804", sourceSpace: "Class 1 W-Space", targetSpace: "C6", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "S877": { code: "S877", targetSpace: "Drifter (Sentinel)", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "T405": { code: "T405", sourceSpace: "Class 3 W-Space", targetSpace: "C4", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "T458": { code: "T458", sourceSpace: "Highsec", targetSpace: "Thera", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "U210": { code: "U210", sourceSpace: "Class 3 W-Space", targetSpace: "Lowsec", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 23.5 },
  "U319": { code: "U319", sourceSpace: "Lowsec or Nullsec (0.0)", targetSpace: "C6", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 48 },
  "U372": { code: "U372", sourceSpace: "Drone Nullsec (0.0)", targetSpace: "Pochven", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "U574": { code: "U574", sourceSpace: "Class 4 W-Space", targetSpace: "C6", maxMassTons: 3000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "V283": { code: "V283", sourceSpace: "Highsec", targetSpace: "Nullsec", maxMassTons: 3000000, maxJumpMassTons: 1000000, lifetimeHours: 24 },
  "V301": { code: "V301", sourceSpace: "Class 3 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "V753": { code: "V753", sourceSpace: "Class 5 W-Space", targetSpace: "C6", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "V898": { code: "V898", sourceSpace: "Thera", targetSpace: "Lowsec", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "V911": { code: "V911", sourceSpace: "Class 6 W-Space", targetSpace: "C5", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "V928": { code: "V928", targetSpace: "Drifter (Vidette)", maxMassTons: 750000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "W237": { code: "W237", sourceSpace: "Class 6 W-Space", targetSpace: "C6", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "X450": { code: "X450", sourceSpace: "Pochven", targetSpace: "Nullsec", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "X702": { code: "X702", sourceSpace: "K-space", targetSpace: "C3", maxMassTons: 1000000, maxJumpMassTons: 375000, lifetimeHours: 24 },
  "X820": { code: "X820", sourceSpace: "K-space / W-space", targetSpace: "C4/C5", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 16 },
  "X877": { code: "X877", sourceSpace: "Class 4 W-Space", targetSpace: "C4", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "Y683": { code: "Y683", sourceSpace: "Class 2 W-Space", targetSpace: "C4", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "Y790": { code: "Y790", sourceSpace: "Class 5 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "Z006": { code: "Z006", targetSpace: "C3", maxMassTons: 1000000, maxJumpMassTons: 5000, lifetimeHours: 4.5 },
  "Z060": { code: "Z060", sourceSpace: "Class 1 W-Space", targetSpace: "Nullsec", maxMassTons: 1000000, maxJumpMassTons: 62000, lifetimeHours: 24 },
  "Z142": { code: "Z142", sourceSpace: "Class 5 or Class 6 W-Space", targetSpace: "Nullsec", maxMassTons: 3300000, maxJumpMassTons: 2000000, lifetimeHours: 24 },
  "Z457": { code: "Z457", sourceSpace: "Class 6 W-Space", targetSpace: "C4", maxMassTons: 2000000, maxJumpMassTons: 375000, lifetimeHours: 16 },
  "Z647": { code: "Z647", sourceSpace: "Class 2 W-Space", targetSpace: "C1", maxMassTons: 500000, maxJumpMassTons: 62000, lifetimeHours: 16 },
  "Z971": { code: "Z971", sourceSpace: "K-space", targetSpace: "C1", maxMassTons: 100000, maxJumpMassTons: 62000, lifetimeHours: 16 },
};

export function deriveSpaceTypeFromWhSpec(specOrCode?: WormholeCodeSpec | string): string {
  if (!specOrCode) return 'W-Space';
  const spec = typeof specOrCode === 'string' ? WORMHOLE_CODES[specOrCode.toUpperCase()] : specOrCode;
  if (!spec) return typeof specOrCode === 'string' ? specOrCode : 'W-Space';
  const ts = spec.targetSpace;
  if (/^C[1-6]/i.test(ts)) return ts.slice(0, 2).toUpperCase();
  if (ts.toLowerCase().includes('high')) return 'HS';
  if (ts.toLowerCase().includes('low')) return 'LS';
  if (ts.toLowerCase().includes('null')) return 'NS';
  if (ts.toLowerCase().includes('thera')) return 'TH';
  if (ts.toLowerCase().includes('turnur')) return 'TU';
  if (ts.toLowerCase().includes('poch')) return 'PO';
  if (ts.toLowerCase().includes('drifter')) return 'DR';
  if (ts.toLowerCase().includes('incoming') || spec.code === 'K162') return 'K162';
  return ts;
}

export interface WormholeLinkLike {
  whCode?: string;
  returnWhCode?: string;
}

export function getLinkWhSpec(link: WormholeLinkLike): WormholeCodeSpec | null {
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

export function isFrigateHole(whCode?: string, shipSize?: string): boolean {
  if (!whCode && !shipSize) return false;
  const sizeLower = (shipSize || '').toLowerCase();
  if (sizeLower === 'frigate' || sizeLower === 'small') return true;
  if (whCode) {
    const codeUpper = whCode.toUpperCase();
    const frigCodes = new Set(['C125', 'Z971', 'E175', 'Q003', 'X820', 'V301', 'E545', 'D845', 'S877', 'K346', 'K329']);
    if (frigCodes.has(codeUpper)) return true;
    const spec = WORMHOLE_CODES[codeUpper];
    if (spec && spec.maxJumpMassTons && spec.maxJumpMassTons <= 5000) return true;
  }
  return false;
}

export interface ScannedSignature {
  id: string; // e.g. ABC-123
  group: 'Wormhole' | 'Relic' | 'Data' | 'Gas' | 'Combat' | 'Ore' | 'Unknown';
  name: string;
  signalPct: number;
  scannedAt?: number; // timestamp in ms
  linkedLinkId?: string; // ID of connected wormhole link
  notes?: string;
}

/**
 * Formats a ScannedSignature as an EVE in-game bookmark string.
 * Example: "ABC-123 Relic Ruined Sansha Crystal Quarry"
 */
export function formatBookmarkString(sig: ScannedSignature): string {
  const groupLabel = sig.group !== 'Unknown' ? ` ${sig.group}` : '';
  const nameLabel = sig.name && sig.name !== 'Cosmic Signature' && sig.name !== sig.id ? ` ${sig.name}` : '';
  return `${sig.id}${groupLabel}${nameLabel}`.trim();
}

export interface WormholeBookmarkParams {
  sigId: string;
  targetSpaceType?: 'NS' | 'LS' | 'HS' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'TH' | 'TU' | 'PO' | string;
  isStatic?: boolean;
  isBreadcrumb?: boolean;
  breadcrumbParentName?: string;
  targetSystemName?: string;
  targetSecurity?: number;
  targetClass?: string;
  targetEffect?: string;
  whCode?: string;
  isEol?: boolean;
  isCrit?: boolean;
  isFrigate?: boolean;
  notes?: string;
  getSystemStatics?: (query: string | number) => any;
}

export function getEffectAbbreviation(effect?: string): string {
  if (!effect) return '';
  const e = effect.toLowerCase().trim();
  if (e.includes('wolf')) return 'WR';
  if (e.includes('magnetar')) return 'Mag';
  if (e.includes('pulsar')) return 'Pulsar';
  if (e.includes('cataclysmic')) return 'CV';
  if (e.includes('black hole')) return 'BH';
  if (e.includes('red giant')) return 'RG';
  return effect.trim();
}

/**
 * Standardized Daytripper Wormhole Bookmark Generator
 * Format: [Prefix] [SigID] [Destination & Effect] [Modifiers]
 * Examples:
 *   "NSs AMO-656 A2V6-6 -0.9 EOL"
 *   "HSs CKR-912 Orvolle 0.7"
 *   "HSw GMI-252 Uesuro 0.5 frig"
 *   "C6s AMO-656 J130000 Mag"
 *   "BT AMO-656 FD-MLJ"
 */
export function generateWormholeBookmark(params: WormholeBookmarkParams): string {
  const cleanSig = (params.sigId || '').toUpperCase().trim();

  // 1. Breadcrumb Return Bookmark (BT)
  const resolveStatics = params.getSystemStatics || _staticsResolver;

  if (params.isBreadcrumb) {
    const parentName = (params.breadcrumbParentName || params.targetSystemName || 'Home').trim();
    const jMatch = parentName.match(/^J\d{6}/i);
    const jStatics = resolveStatics ? (jMatch ? resolveStatics(jMatch[0]) : resolveStatics(parentName)) : null;

    const resolvedClass = (params.targetClass || jStatics?.whClass || '').toUpperCase().trim();
    const resolvedEffect = params.targetEffect || jStatics?.effect;

    let destDesc = parentName;

    // J-space system: include class (e.g. C1-C6, Thera) and effect if present
    if (jMatch || /^C[1-6]$/i.test(resolvedClass) || resolvedClass === 'THERA' || resolvedClass === 'C13') {
      const cls = /^C[1-6]$/i.test(resolvedClass) ? resolvedClass : (jStatics?.whClass || (resolvedClass ? resolvedClass : ''));
      if (cls && !destDesc.toUpperCase().includes(cls)) {
        destDesc = `${destDesc} ${cls}`.trim();
      }
      const effectAbbr = getEffectAbbreviation(resolvedEffect);
      if (effectAbbr && !destDesc.includes(effectAbbr)) {
        destDesc = `${destDesc} ${effectAbbr}`.trim();
      }
    } else if (params.targetSecurity !== undefined && Number.isFinite(params.targetSecurity)) {
      // K-space system: include security status (e.g. -0.9, 0.7)
      const secVal = params.targetSecurity;
      const secFmt = secVal <= 0 ? (secVal === 0 ? '0.0' : secVal.toFixed(1)) : secVal.toFixed(1);
      if (!destDesc.includes(secFmt)) {
        destDesc = `${destDesc} ${secFmt}`.trim();
      }
    }

    const modifiers: string[] = [];
    if (params.isEol) modifiers.push('EOL');
    if (params.isCrit) modifiers.push('Crit');
    if (params.isFrigate || (params.whCode && isFrigateHole(params.whCode))) modifiers.push('frig');

    const parts = ['BT', cleanSig, destDesc, ...modifiers].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Pre-parse destination and J-space details if destination is J-system (e.g. J130000)
  const rawDest = (params.targetSystemName || '').trim();
  const jMatch = rawDest.match(/^J\d{6}/i);
  const jStatics = resolveStatics ? (jMatch ? resolveStatics(jMatch[0]) : resolveStatics(rawDest)) : null;

  const resolvedClass = (params.targetClass || jStatics?.whClass || '').toUpperCase().trim();
  const resolvedEffect = params.targetEffect || jStatics?.effect;

  // 2. Prefix Tag Resolution (Space type + static/wandering suffix)
  let spacePrefix = (params.targetSpaceType || '').toUpperCase().trim();

  // Clean any accidental trailing 's' or 'w' if caller passed already-suffixed type (e.g. 'C6s')
  if (/^(NS|LS|HS|C[1-6]|TH|TU|PO)[sw]$/i.test(spacePrefix)) {
    spacePrefix = spacePrefix.slice(0, -1);
  }

  // "C6s instead of JS": never use generic 'JS' or 'WH' if a specific class can be identified
  if (!spacePrefix || spacePrefix === 'JS' || spacePrefix === 'WH' || spacePrefix === 'W-SPACE') {
    if (params.whCode) {
      const derived = deriveSpaceTypeFromWhSpec(params.whCode);
      if (derived && derived !== 'W-Space') {
        spacePrefix = derived;
      }
    }
  }
  if (!spacePrefix || spacePrefix === 'JS' || spacePrefix === 'WH' || spacePrefix === 'W-SPACE') {
    if (/^C[1-6]$/i.test(resolvedClass)) {
      spacePrefix = resolvedClass;
    } else if (resolvedClass.toLowerCase() === 'highsec') {
      spacePrefix = 'HS';
    } else if (resolvedClass.toLowerCase() === 'lowsec') {
      spacePrefix = 'LS';
    } else if (resolvedClass.toLowerCase() === 'nullsec') {
      spacePrefix = 'NS';
    } else if (resolvedClass.toLowerCase() === 'thera') {
      spacePrefix = 'TH';
    } else if (resolvedClass.toLowerCase() === 'turnur') {
      spacePrefix = 'TU';
    } else if (resolvedClass.toLowerCase() === 'pochven') {
      spacePrefix = 'PO';
    } else if (params.targetSecurity !== undefined && Number.isFinite(params.targetSecurity)) {
      if (params.targetSecurity >= 0.45) spacePrefix = 'HS';
      else if (params.targetSecurity > 0.0) spacePrefix = 'LS';
      else spacePrefix = 'NS';
    } else if (jMatch) {
      spacePrefix = jStatics?.whClass || 'C6';
    } else {
      spacePrefix = spacePrefix === 'JS' ? (resolvedClass || 'C6') : 'WH';
    }
  }

  // Suffix: 's' for static, 'w' for wandering / K162 / non-static
  const typeSuffix = params.isStatic ? 's' : 'w';
  const prefix = `${spacePrefix}${typeSuffix}`;

  // 3. Destination String Resolution
  let destStr = rawDest;
  const isKSpace = ['HS', 'LS', 'NS'].includes(spacePrefix);

  if (isKSpace) {
    if (params.targetSecurity !== undefined && Number.isFinite(params.targetSecurity)) {
      const secVal = params.targetSecurity;
      const secFmt = secVal <= 0 ? (secVal === 0 ? '0.0' : secVal.toFixed(1)) : secVal.toFixed(1);
      if (!destStr.includes(secFmt)) {
        destStr = `${destStr} ${secFmt}`.trim();
      }
    }
  } else {
    // J-space / Wormhole destination: clean name and append effect abbreviation if present
    if (jMatch) {
      destStr = jMatch[0].toUpperCase();
    }
    const effectAbbr = getEffectAbbreviation(resolvedEffect);
    if (effectAbbr && !destStr.includes(effectAbbr)) {
      destStr = `${destStr} ${effectAbbr}`.trim();
    }
  }

  // 4. Modifiers (EOL, Crit, Frig)
  const modifiers: string[] = [];
  if (params.isEol) {
    modifiers.push('EOL');
  }
  if (params.isCrit) {
    modifiers.push('Crit');
  }
  if (params.isFrigate || (params.whCode && isFrigateHole(params.whCode))) {
    modifiers.push('frig');
  }

  const parts = [prefix, cleanSig, destStr, ...modifiers].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Legacy wrapper for backward compatibility with existing callers.
 */
export function formatWormholeBookmark(
  sigId: string,
  destination: string,
  whCode?: string,
  status?: string
): string {
  const isEol = (status || '').toLowerCase().includes('eol');
  const isCrit = (status || '').toLowerCase().includes('crit');
  const isFrig = (status || '').toLowerCase().includes('frig') || (whCode ? isFrigateHole(whCode) : false);
  const isK162 = (whCode || '').toUpperCase() === 'K162';

  // Determine space type from whCode or destination if available
  let targetSpaceType: string | undefined;
  if (whCode && WORMHOLE_CODES[whCode.toUpperCase()]) {
    const ts = WORMHOLE_CODES[whCode.toUpperCase()].targetSpace;
    if (/^C[1-6]/i.test(ts)) targetSpaceType = ts.slice(0, 2).toUpperCase();
    else if (ts.toLowerCase().includes('high')) targetSpaceType = 'HS';
    else if (ts.toLowerCase().includes('low')) targetSpaceType = 'LS';
    else if (ts.toLowerCase().includes('null')) targetSpaceType = 'NS';
    else if (ts.toLowerCase().includes('thera')) targetSpaceType = 'TH';
  }

  return generateWormholeBookmark({
    sigId,
    targetSpaceType,
    targetSystemName: destination,
    whCode,
    isEol,
    isCrit,
    isFrigate: isFrig,
    isStatic: Boolean(whCode && !isK162 && whCode !== 'WH')
  });
}

/**
 * Merges fresh scanned signatures into an existing list.
 * Preserves linked connections and notes while updating signalPct and timestamps.
 */
export function mergeScannedSignatures(existing: ScannedSignature[], incoming: ScannedSignature[]): ScannedSignature[] {
  const map = new Map<string, ScannedSignature>();
  for (const s of existing) {
    map.set(s.id.toUpperCase(), { ...s });
  }
  const now = Date.now();
  for (const inc of incoming) {
    const key = inc.id.toUpperCase();
    const prev = map.get(key);
    if (prev) {
      prev.group = inc.group !== 'Unknown' ? inc.group : prev.group;
      prev.name = inc.name !== 'Cosmic Signature' ? inc.name : prev.name;
      prev.signalPct = Math.max(prev.signalPct, inc.signalPct);
      prev.scannedAt = now;
      if (inc.linkedLinkId) prev.linkedLinkId = inc.linkedLinkId;
      if (inc.notes) prev.notes = inc.notes;
    } else {
      map.set(key, { ...inc, scannedAt: inc.scannedAt || now });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    // Wormholes at top, then by group, then by ID
    if (a.group === 'Wormhole' && b.group !== 'Wormhole') return -1;
    if (b.group === 'Wormhole' && a.group !== 'Wormhole') return 1;
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Purges signatures older than maxAgeMs (default 24 hours).
 */
export function cleanStaleSignatures(sigs: ScannedSignature[], maxAgeMs = 24 * 60 * 60 * 1000): ScannedSignature[] {
  const cutoff = Date.now() - maxAgeMs;
  return sigs.filter(s => !s.scannedAt || s.scannedAt >= cutoff);
}

/**
 * Parses raw Probe Scanner clipboard text into ScannedSignature objects.
 * Format sample:
 * ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1.50 AU
 */
export function parseProbeScannerText(text: string): ScannedSignature[] {
  if (text.length > 500000) throw new Error('Probe Scanner clipboard is too large.');
  let lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error('Clipboard is empty. Copy rows from the EVE Probe Scanner.');

  // If the very first row is a probe scanner table header, skip it
  const firstParts = lines[0].replace(/^\uFEFF/, '').split('\t').map(v => v.trim().toLowerCase());
  if (firstParts.length >= 4 && (firstParts[0] === 'id' || firstParts[0] === 'signature' || firstParts[1] === 'scan group' || firstParts[1] === 'category')) {
    lines = lines.slice(1);
  }
  if (!lines.length) throw new Error('Clipboard contains only header. Copy signature rows.');

  const now = Date.now();
  return lines.map((line, index) => {
    const parts = line.replace(/^\uFEFF/, '').split('\t').map(value => value.trim());
    const bad = () => new Error(`Row ${index + 1} is not a valid Probe Scanner result. Copy the scanner rows, including ID, group and signal strength.`);
    if (parts.length !== 5 && parts.length !== 6) throw bad();
    const [rawId, category, rawGroup, rawName, signal, distance] = parts;
    if (!/^[A-Z]{3}-\d{3}$/i.test(rawId) || !['Cosmic Signature', 'Cosmic Anomaly'].includes(category)) throw bad();
    if (!/^\d{1,3}(?:[.,]\d+)?%$/.test(signal)) throw bad();
    const signalPct = Number(signal.slice(0,-1).replace(',','.'));
    if (signalPct < 0 || signalPct > 100) throw bad();
    if (distance && !/^(?:[\d.,\s]+\s*(?:AU|km|m)|-)$/i.test(distance)) throw bad();
    const groups: Record<string, ScannedSignature['group']> = {
      Wormhole: 'Wormhole',
      'Wormhole Site': 'Wormhole',
      'Relic Site': 'Relic',
      Relic: 'Relic',
      'Data Site': 'Data',
      Data: 'Data',
      'Gas Site': 'Gas',
      Gas: 'Gas',
      'Combat Site': 'Combat',
      Combat: 'Combat',
      'Ore Site': 'Ore',
      Ore: 'Ore',
      '': 'Unknown',
      Unknown: 'Unknown'
    };
    if (!Object.hasOwn(groups, rawGroup) || /[<>\x00-\x1f]/.test(rawName) || rawName.length > 200) throw bad();
    return {
      id: rawId.toUpperCase(),
      group: groups[rawGroup],
      name: rawName || 'Cosmic Signature',
      signalPct,
      scannedAt: now
    };
  });
}

export function signatureGuide(sig: ScannedSignature): {url: string; label: string; status: string} {
  const pages: Record<ScannedSignature['group'], string> = {Wormhole:'Wormholes',Relic:'Relic_and_data_sites',Data:'Relic_and_data_sites',Gas:'Wormhole_sites',Combat:'Combat_sites',Ore:'Mining',Unknown:'Probe_scanning'};
  const named = Boolean(sig.name && sig.name !== 'Cosmic Signature' && sig.name !== 'Unstable Wormhole' && sig.name !== sig.id);
  const knownSites = new Set(['Barren Perimeter Reservoir','Minor Perimeter Reservoir','Ordinary Perimeter Reservoir','Sizable Perimeter Reservoir','Token Perimeter Reservoir','Bountiful Frontier Reservoir','Vast Frontier Reservoir','Instrumental Core Reservoir','Vital Core Reservoir','Fortification Frontier Stronghold','Outpost Frontier Stronghold','Solar Cell','The Oruze Construct','Core Garrison','Core Stronghold','Superior Sleeper Cache']);
  if (knownSites.has(sig.name)) return {url:'https://wiki.eveuniversity.org/'+encodeURIComponent(sig.name.replaceAll(' ','_')),label:'EVE Uni site guide',status:sig.signalPct>=100?'Resolved':'Partially scanned'};
  return {url:named ? `https://wiki.eveuniversity.org/index.php?search=${encodeURIComponent(sig.name)}&title=Special%3ASearch` : `https://wiki.eveuniversity.org/${pages[sig.group] || 'Probe_scanning'}`,
    label:named ? 'Find site on EVE Uni' : sig.group === 'Unknown' ? 'EVE Uni scanning guide' : 'EVE Uni '+sig.group.toLowerCase()+' guide',
    status:sig.signalPct >= 100 ? 'Resolved' : sig.group === 'Unknown' ? 'Unidentified signature' : 'Partially scanned'};
}


/**
 * Infer Wormhole Class based on system ID or security
 */
export function getWormholeClass(systemId: number, security?: number): string {
  if (systemId >= 31000000 && systemId < 32000000) {
    // J-space system ID range in EVE SDE
    if (systemId >= 31000001 && systemId <= 31000500) return 'C1';
    if (systemId >= 31000501 && systemId <= 31001000) return 'C2';
    if (systemId >= 31001001 && systemId <= 31001500) return 'C3';
    if (systemId >= 31001501 && systemId <= 31002000) return 'C4';
    if (systemId >= 31002001 && systemId <= 31002300) return 'C5';
    if (systemId >= 31002301 && systemId <= 31002600) return 'C6';
    if (systemId === 31000005) return 'Thera';
    return 'W-Space';
  }
  if (security === undefined || !Number.isFinite(security)) return 'Unknown';
  if (security >= 0.45) return 'Highsec';
  if (security > 0.0) return 'Lowsec';
  return 'Nullsec';
}
