export interface CombatVictim {
  characterId: number | null;
  characterName: string | null;
  corporationId: number | null;
  corporationName: string | null;
  allianceId: number | null;
  allianceName: string | null;
  shipTypeId: number;
  shipTypeName: string;
  damageTaken: number;
}

export interface CombatAttacker {
  characterId: number | null;
  characterName: string | null;
  corporationId: number | null;
  corporationName: string | null;
  allianceId: number | null;
  allianceName: string | null;
  shipTypeId: number | null;
  shipTypeName: string | null;
  damageDone: number;
  damagePercent: number;
  finalBlow: boolean;
}

export interface CombatItem {
  itemTypeId: number;
  itemTypeName: string;
  flag: number;
  slotGroup: 'high' | 'med' | 'low' | 'rig' | 'subsystem' | 'drone' | 'cargo' | 'other';
  quantityDestroyed: number;
  quantityDropped: number;
  categoryId?: number | null;
  isContained?: boolean;
}

export interface CombatKillmail {
  killmailId: number;
  killmailTime: string;
  solarSystemId: number;
  solarSystemName: string;
  securityStatus: number;
  isKill: boolean;
  isLoss: boolean;
  isSolo: boolean;
  totalValue: number;
  destroyedValue: number;
  droppedValue: number;
  victim: CombatVictim;
  attackersCount: number;
  finalBlow: CombatAttacker;
  attackers: CombatAttacker[];
  items: CombatItem[];
}

export interface CombatMetrics {
  killsCount: number;
  lossesCount: number;
  iskDestroyed: number;
  iskLost: number;
  totalCount?: number;
  efficiencyPercentage: number;
}

export interface CombatApiResponse {
  success: boolean;
  scope: 'personal' | 'corporation';
  metrics: CombatMetrics;
  totalAvailable?: number;
  offset?: number;
  limit?: number;
  kills: CombatKillmail[];
  syncedAt: number | null;
}

export function formatIsk(val: number): string {
  const num = Number(val) || 0;
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B ISK`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M ISK`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K ISK`;
  return `${num.toLocaleString()} ISK`;
}

export function formatSecStatus(sec: number): { text: string; cssClass: string } {
  const val = Number(sec) || 0;
  const rounded = Math.round(val * 10) / 10;
  let cssClass = 'sec-null';
  if (rounded >= 0.5) {
    cssClass = 'sec-high';
  } else if (rounded > 0.0) {
    cssClass = 'sec-low';
  }
  return {
    text: rounded.toFixed(1),
    cssClass
  };
}

export function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return dateStr;
  }
}

export function isChargeItem(it: CombatItem): boolean {
  if (it.categoryId === 8 || it.isContained) return true;
  if (it.categoryId === 7 || it.categoryId === 18 || it.categoryId === 32) return false;
  
  // Launchers, boosters, and repairer modules themselves are modules, not charges
  if (/Launcher|Booster\s+(I|II|Compact|Restrained)|Repairer/i.test(it.itemTypeName)) return false;

  // Consumables and charges typically drop or destroy with quantity > 1 (modules are always singletons in slots)
  const qty = (it.quantityDestroyed || 0) + (it.quantityDropped || 0);
  if (qty > 1 && !isDroneItem(it)) return true;

  // Name patterns for EVE Online ammunition, crystals, missiles, rockets, probes, paste, cap boosters, and scripts
  return /Rocket|Missile|Torpedo|Probe|Charge|Crystal|Script|Paste|Cap Booster|Nanite|Disrupt Probe|Liquid Ozone|Heavy Water|Antimatter|Plutonium|Iron|Lead|Thorium|Uranium|Tungsten|Iridium|EMP|Fusion|Phased Plasma|Carbonized Lead|Nuclear|Proton|Depleted Uranium|Titanium Sabot|Barrage|Hail|Quake|Tremor|Javelin|Spike|Null|Void|Conflagration|Scorch|Aurora|Gleam|Multifrequency|Gamma|Microwave|Radio|Standard|Infrared|Xray|Ultraviolet|Meson|Occult|Mystic|Tetryon|Baryon|Mining Crystal/i.test(it.itemTypeName);
}

export function isDroneItem(it: CombatItem): boolean {
  if (it.categoryId === 18) return true;
  if (it.flag === 87 || it.slotGroup === 'drone') return true;
  return /Drone|Hornet|Warrior|Acolyte|Hobgoblin|Valkyrie|Infiltrator|Hammerhead|Vespa|Berserker|Ogre|Gila|Bouncer|Curator|Garde|Warden|Gecko/i.test(it.itemTypeName);
}

export function generateEftFromKillmail(km: CombatKillmail): string {
  const shipName = km.victim.shipTypeName || 'Unknown Ship';
  const pilotName = km.victim.characterName || 'Victim';
  const header = `[${shipName}, ${pilotName} - ${km.killmailId}]`;

  const rawItems = km.items || [];
  const extraCargo: Array<{ name: string; qty: number }> = [];

  // Helper to format a rack of modules (low, med, high, rig, subsystem) and pair loaded charges
  function formatSlotRack(slotType: 'low' | 'med' | 'high' | 'rig' | 'subsystem', minFlag: number, maxFlag: number): string[] {
    const rackItems = rawItems.filter(it => it.slotGroup === slotType || (it.flag >= minFlag && it.flag <= maxFlag));
    const modules: CombatItem[] = [];
    const charges: CombatItem[] = [];

    for (const it of rackItems) {
      if (slotType !== 'rig' && slotType !== 'subsystem' && isChargeItem(it)) {
        charges.push(it);
      } else if (isDroneItem(it)) {
        // Captured in drone section
      } else {
        modules.push(it);
      }
    }

    const pairedCharges = new Map<CombatItem, CombatItem>();
    const usedChargeIndices = new Set<number>();

    // Pass 1: exact slot flag match (e.g. module and loaded ammo share flag 27)
    for (const mod of modules) {
      const idx = charges.findIndex((ch, i) => !usedChargeIndices.has(i) && ch.flag === mod.flag);
      if (idx !== -1) {
        usedChargeIndices.add(idx);
        pairedCharges.set(mod, charges[idx]);
      }
    }

    // Build the EFT module lines with optional loaded charge
    const lines: string[] = [];
    for (const mod of modules) {
      const charge = pairedCharges.get(mod);
      if (charge) {
        lines.push(`${mod.itemTypeName},${charge.itemTypeName}`);
      } else {
        lines.push(mod.itemTypeName);
      }
    }

    // Any remaining charges on this rack belong in the cargo hold
    charges.forEach((ch, idx) => {
      if (!usedChargeIndices.has(idx)) {
        const qty = (ch.quantityDestroyed || 0) + (ch.quantityDropped || 0) || 1;
        extraCargo.push({ name: ch.itemTypeName, qty });
      }
    });

    return lines;
  }

  // Standard EFT order: Lows, Meds, Highs, Rigs, Subsystems, Drones, Cargo
  const lows = formatSlotRack('low', 11, 18);
  const meds = formatSlotRack('med', 19, 26);
  const highs = formatSlotRack('high', 27, 34);
  const rigs = formatSlotRack('rig', 92, 99);
  const subsystems = formatSlotRack('subsystem', 125, 132);

  // Drones
  const droneMap = new Map<string, number>();
  for (const it of rawItems) {
    if (isDroneItem(it)) {
      const qty = (it.quantityDestroyed || 0) + (it.quantityDropped || 0) || 1;
      droneMap.set(it.itemTypeName, (droneMap.get(it.itemTypeName) || 0) + qty);
    }
  }
  const drones = Array.from(droneMap.entries()).map(([name, qty]) => `${name} x${qty}`);

  // Cargo Hold
  const cargoMap = new Map<string, number>();
  for (const it of rawItems) {
    if (it.flag === 5 || it.slotGroup === 'cargo' || it.slotGroup === 'other') {
      if (!isDroneItem(it)) {
        const qty = (it.quantityDestroyed || 0) + (it.quantityDropped || 0) || 1;
        cargoMap.set(it.itemTypeName, (cargoMap.get(it.itemTypeName) || 0) + qty);
      }
    }
  }
  for (const extra of extraCargo) {
    cargoMap.set(extra.name, (cargoMap.get(extra.name) || 0) + extra.qty);
  }
  const cargo = Array.from(cargoMap.entries()).map(([name, qty]) => `${name} x${qty}`);

  const sections: string[] = [header];
  sections.push(lows.join('\n'));
  sections.push(meds.join('\n'));
  sections.push(highs.join('\n'));
  if (rigs.length > 0) sections.push(rigs.join('\n'));
  if (subsystems.length > 0) sections.push(subsystems.join('\n'));
  if (drones.length > 0) sections.push(drones.join('\n'));
  if (cargo.length > 0) sections.push(cargo.join('\n'));

  return sections.join('\n\n').trim();
}

