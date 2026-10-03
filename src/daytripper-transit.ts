/** Correlates explicit wormhole-entry notifications with a fresh location change. */
export class WormholeTransitEvidence {
  private entries = new Map<string, number>();
  record(character: string, line: string, now = Date.now()): boolean {
    const text = line.replace(/<[^>]*>/g, '').trim();
    const match = text.match(/^\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \] \(notify\) Can't navigate while entering wormhole$/);
    if (!match) return false;
    const [, y, m, d, h, min, sec] = match;
    const at = Date.UTC(+y, +m - 1, +d, +h, +min, +sec);
    if (now < at || now - at > 90_000) return false;
    this.entries.set(character.toLowerCase(), at);
    return true;
  }
  consume(character: string, fromAt: number | null, toAt: number | null, now = Date.now()): boolean {
    const key = character.toLowerCase();
    const at = this.entries.get(key);
    this.entries.delete(key); // A later move must never reuse the same hint.
    return at !== undefined && fromAt !== null && toAt !== null
      && fromAt <= at && at - fromAt <= 60_000
      && toAt >= at && toAt <= now && now - at <= 90_000 && now >= at;
  }
}
