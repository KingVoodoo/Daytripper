// Preserve the catalog's existing unit convention; callers own missing-capacity policy.
export function wormholeCapacityKg(maxMassTons: number | null | undefined, fallbackKg = 2_000_000_000): number {
  return maxMassTons
    ? (maxMassTons >= 100_000 ? maxMassTons * 1000 : maxMassTons * 1_000_000)
    : fallbackKg;
}

// A K162 label does not establish originating capacity; getLinkWhSpec supplies any verified return type.
export function wormholeLinkCapacityKg(link: { whCode?: string }, spec: { maxMassTons?: number } | null): number | null {
  const unknownOrigin = !link.whCode || link.whCode.toUpperCase() === 'K162';
  if (unknownOrigin && !(Number.isFinite(spec?.maxMassTons) && Number(spec?.maxMassTons) > 0)) return null;
  return wormholeCapacityKg(spec?.maxMassTons, 2_000_000_000);
}
