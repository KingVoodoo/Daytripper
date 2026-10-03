export interface SystemNoteRecord {
  systemId?: number;
  systemName: string;
  notes: string;
  tags?: string[];
  effect?: string;
  updatedAt: number;
}

const STORAGE_SYSTEM_NOTES_KEY = 'wok_system_notes_v1';

function normalizeKey(idOrName: number | string): string {
  if (typeof idOrName === 'number') return `id:${idOrName}`;
  return `name:${idOrName.trim().toLowerCase()}`;
}

export function getAllStoredSystemNotes(): Record<string, SystemNoteRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_SYSTEM_NOTES_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {};
}

export function getStoredSystemNote(idOrName: number | string): SystemNoteRecord | null {
  if (!idOrName) return null;
  const store = getAllStoredSystemNotes();
  const key = normalizeKey(idOrName);
  if (store[key]) return store[key];

  // Secondary lookup: if searched by ID, try looking for matching systemId in store
  if (typeof idOrName === 'number') {
    for (const rec of Object.values(store)) {
      if (rec.systemId === idOrName) return rec;
    }
  } else {
    const nameLower = idOrName.trim().toLowerCase();
    for (const rec of Object.values(store)) {
      if (rec.systemName.toLowerCase() === nameLower) return rec;
    }
  }

  return null;
}

export function saveStoredSystemNote(params: {
  systemId?: number;
  systemName: string;
  notes: string;
  tags?: string[];
  effect?: string;
}): void {
  const store = getAllStoredSystemNotes();
  const now = Date.now();
  const record: SystemNoteRecord = {
    systemId: params.systemId,
    systemName: params.systemName,
    notes: params.notes.trim(),
    tags: params.tags,
    effect: params.effect,
    updatedAt: now,
  };

  // Key by name and id if present
  if (params.systemName) {
    store[`name:${params.systemName.trim().toLowerCase()}`] = record;
  }
  if (params.systemId) {
    store[`id:${params.systemId}`] = record;
  }

  try {
    localStorage.setItem(STORAGE_SYSTEM_NOTES_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('wok-system-notes-updated', { detail: record }));
  } catch {
    // ignore storage quota
  }
}
