import {getHomeSystem,homeDisplayName} from './home-system';
import { call, native } from './bridge';

export interface UniverseSystemInfo {
  id: number;
  name: string;
  security: number;
  region_id: number;
  space_type: string;
}

class UniverseGraphService {
  private systems: Map<number, UniverseSystemInfo> = new Map();
  private nameToId: Map<string, number> = new Map();
  private adjacency: Map<number, number[]> = new Map();
  private loaded = false;
  private loadingPromise: Promise<boolean> | null = null;

  public async init(): Promise<boolean> {
    if (this.loaded) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {

        const res = await (async ():Promise<{
          dataset: {
            map: {
              systems: Array<{ id: number; name: string; security: number; region_id: number; space_type: string }>;
              edges: Array<[number, number]>;
            };
          };
        }> => {const response=await fetch('/universe.json'); if(!response.ok)throw new Error('Bundled universe unavailable'); return {dataset:await response.json()};})();

        if (res?.dataset?.map?.systems) {
          for (const s of res.dataset.map.systems) {
            this.systems.set(s.id, {
              id: s.id,
              name: s.name,
              security: typeof s.security === 'number' ? s.security : 0.0,
              region_id: s.region_id,
              space_type: s.space_type || 'k_space'
            });
            this.nameToId.set(s.name.toLowerCase(), s.id);
          }
        }

        if (res?.dataset?.map?.edges) {
          for (const [u, v] of res.dataset.map.edges) {
            let listU = this.adjacency.get(u);
            if (!listU) {
              listU = [];
              this.adjacency.set(u, listU);
            }
            listU.push(v);

            let listV = this.adjacency.get(v);
            if (!listV) {
              listV = [];
              this.adjacency.set(v, listV);
            }
            listV.push(u);
          }
        }

        this.loaded = true;
        return true;
      } catch (err) {
        console.warn('[UniverseGraph] Failed to load full map, falling back to local dataset:', err);
        this.initFallbackData();
        this.loaded = true;
        return false;
      }
    })();

    return this.loadingPromise;
  }

  private initFallbackData() {
    // Known core systems for offline/browser mode
    const sampleSystems: UniverseSystemInfo[] = [
      { id: 30000142, name: 'Jita', security: 0.95, region_id: 10000002, space_type: 'k_space' },
      { id: 30000144, name: 'Perimeter', security: 1.0, region_id: 10000002, space_type: 'k_space' },
      { id: 30002187, name: 'Amarr', security: 1.0, region_id: 10000043, space_type: 'k_space' },
      { id: 30002659, name: 'Dodixie', security: 0.87, region_id: 10000032, space_type: 'k_space' },
      { id: 30002510, name: 'Rens', security: 0.89, region_id: 10000030, space_type: 'k_space' },
      { id: 30002053, name: 'Hek', security: 0.55, region_id: 10000042, space_type: 'k_space' },
      { id: 30002086, name: 'Turnur', security: 0.35, region_id: 10000042, space_type: 'k_space' },
      { id: 31000005, name: 'Thera', security: -0.99, region_id: 11000031, space_type: 'w_space' },
    ];
    for (const s of sampleSystems) {
      this.systems.set(s.id, s);
      this.nameToId.set(s.name.toLowerCase(), s.id);
    }

    // Sample adjacency edges for offline calculation
    const sampleEdges: Array<[number, number]> = [];
    for (const [u, v] of sampleEdges) {
      let listU = this.adjacency.get(u);
      if (!listU) {
        listU = [];
        this.adjacency.set(u, listU);
      }
      listU.push(v);

      let listV = this.adjacency.get(v);
      if (!listV) {
        listV = [];
        this.adjacency.set(v, listV);
      }
      listV.push(u);
    }
  }

  public searchSystems(query: string, limit = 20): UniverseSystemInfo[] {
    const needle=query.trim().toLowerCase();
    if(!needle)return [];
    return [...this.systems.values()].filter(s=>s.name.toLowerCase().includes(needle)).sort((a,b)=>Number(!a.name.toLowerCase().startsWith(needle))-Number(!b.name.toLowerCase().startsWith(needle))||a.name.localeCompare(b.name)).slice(0,limit);
  }

  public getSystemInfo(idOrName: number | string): UniverseSystemInfo | null {
    if (typeof idOrName === 'number') {
      const found = this.systems.get(idOrName);
      if (found) return found;
      return null;
    }

    const id = this.nameToId.get(idOrName.trim().toLowerCase());
    if (id !== undefined) return this.systems.get(id) || null;
    return null;
  }

  /**
   * Breadth-First Search (BFS) to compute the shortest stargate route in jumps.
   * Returns:
   *  0: fromId === toId
   *  number > 0: number of stargate jumps
   *  null: unreachable (e.g. wormhole system, disconnected, or graph not loaded)
   */
  public calculateJumps(fromId: number, toId: number): number | null {
    if (fromId === toId) return 0;
    if (!this.adjacency.has(fromId) || !this.adjacency.has(toId)) return null;

    const queue: Array<[number, number]> = [[fromId, 0]];
    const visited = new Set<number>([fromId]);

    while (queue.length > 0) {
      const [current, dist] = queue.shift()!;
      if (current === toId) return dist;

      const neighbors = this.adjacency.get(current);
      if (neighbors) {
        for (const next of neighbors) {
          if (!visited.has(next)) {
            if (next === toId) return dist + 1;
            visited.add(next);
            queue.push([next, dist + 1]);
          }
        }
      }
    }

    return null;
  }

  /**
   * Hybrid Wormhole + Stargate Route Finder (BFS)
   * Treats active wormhole connections as 1-jump traversals alongside known stargates.
   */
  public calculateHybridRoute(
    fromId: number,
    targetHub: TradeHubTarget,
    wormholeEdges: Array<[number, number]>
  ): HybridRouteResult | null {
    if (fromId === targetHub.id) {
      return {
        fromId,
        targetHub,
        totalJumps: 0,
        whJumps: 0,
        gateJumps: 0,
        path: [fromId]
      };
    }

    // Build quick lookup for wormhole edges (bidirectional)
    const whEdgeSet = new Set<string>();
    const whAdjacency = new Map<number, number[]>();
    for (const [u, v] of wormholeEdges) {
      whEdgeSet.add(`${u}:${v}`);
      whEdgeSet.add(`${v}:${u}`);

      let lu = whAdjacency.get(u);
      if (!lu) { lu = []; whAdjacency.set(u, lu); }
      lu.push(v);

      let lv = whAdjacency.get(v);
      if (!lv) { lv = []; whAdjacency.set(v, lv); }
      lv.push(u);
    }

    const queue: Array<[number, number]> = [[fromId, 0]];
    const visited = new Set<number>([fromId]);
    const parent = new Map<number, number>();

    let found = false;

    while (queue.length > 0) {
      const [curr, dist] = queue.shift()!;
      if (curr === targetHub.id) {
        found = true;
        break;
      }

      // 1. Traverse stargates if system is in stargate adjacency
      const gates = this.adjacency.get(curr);
      if (gates) {
        for (const nxt of gates) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            parent.set(nxt, curr);
            queue.push([nxt, dist + 1]);
          }
        }
      }

      // 2. Traverse active wormholes
      const whs = whAdjacency.get(curr);
      if (whs) {
        for (const nxt of whs) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            parent.set(nxt, curr);
            queue.push([nxt, dist + 1]);
          }
        }
      }
    }

    if (!found) return null;

    // Reconstruct path
    const path: number[] = [];
    let step: number | undefined = targetHub.id;
    while (step !== undefined) {
      path.unshift(step);
      step = parent.get(step);
    }

    let whJumps = 0;
    let gateJumps = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const u = path[i];
      const v = path[i + 1];
      if (whEdgeSet.has(`${u}:${v}`)) {
        whJumps++;
      } else {
        gateJumps++;
      }
    }

    return {
      fromId,
      targetHub,
      totalJumps: whJumps + gateJumps,
      whJumps,
      gateJumps,
      path
    };
  }

  /**
   * Calculates hybrid routes to all major Trade Hubs, sorted by closest total jumps.
   */
  public calculateClosestHubs(
    fromId: number,
    wormholeEdges: Array<[number, number]>
  ): HybridRouteResult[] {
    const results: HybridRouteResult[] = [];
    for (const hub of [...TRADE_HUBS, ...(()=>{const home=getHomeSystem();return home&&!TRADE_HUBS.some(h=>h.id===home.id)?[{id:home.id,name:'Home: '+homeDisplayName(home),shortName:homeDisplayName(home),region:'Home'}]:[]})()]) {
      const r = this.calculateHybridRoute(fromId, hub, wormholeEdges);
      if (r) results.push(r);
    }
    results.sort((a, b) => a.totalJumps - b.totalJumps);
    return results;
  }
}

export interface TradeHubTarget {
  id: number;
  name: string;
  shortName: string;
  region: string;
}

export const TRADE_HUBS: TradeHubTarget[] = [
  { id: 30000142, name: 'Jita IV - Moon 4', shortName: 'Jita', region: 'The Forge' },
  { id: 30002187, name: 'Amarr VIII (Oris)', shortName: 'Amarr', region: 'Domain' },
  { id: 30002659, name: 'Dodixie IX - 20', shortName: 'Dodixie', region: 'Sinq Laison' },
  { id: 30002510, name: 'Rens VI - 8', shortName: 'Rens', region: 'Heimatar' },
  { id: 30002053, name: 'Hek VIII - 12', shortName: 'Hek', region: 'Metropolis' },
];

export interface HybridRouteResult {
  fromId: number;
  targetHub: TradeHubTarget;
  totalJumps: number;
  whJumps: number;
  gateJumps: number;
  path: number[];
}

export const universeGraph = new UniverseGraphService();
