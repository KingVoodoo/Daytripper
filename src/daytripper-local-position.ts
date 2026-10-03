export interface LocalSystemEvent { character: string; timestamp: string; systemName: string }
export class LocalSystemPositions {
  private positions = new Map<string, { systemId: number; systemName: string; at: number; seen: number }>();
  record(event: LocalSystemEvent, resolve: (name: string) => { id: number; name: string } | null, now = Date.now()): boolean {
    if (!event || typeof event.character !== 'string' || typeof event.systemName !== 'string' || typeof event.timestamp !== 'string') return false;
    const at = Date.parse(event.timestamp.replace(/^(\d{4})\.(\d{2})\.(\d{2}) /, '$1-$2-$3T') + 'Z');
    if (!Number.isFinite(at) || at > now + 5000 || now - at > 86400000) return false;
    const system = resolve(event.systemName);
    if (!system || !Number.isSafeInteger(system.id) || system.id <= 0) return false;
    const key = event.character.trim().toLowerCase();
    const previous = this.positions.get(key);
    if (previous && at < previous.at) return false;
    this.positions.set(key, { systemId: system.id, systemName: system.name, at, seen: now });
    return !previous || previous.at !== at || previous.systemId !== system.id;
  }
  get(character: string, now = Date.now()) {
    const position = this.positions.get(character.trim().toLowerCase());
    return position && now - position.seen < 10000 ? position : null;
  }
  clear() { this.positions.clear(); }
}
