import test from 'node:test';
import assert from 'node:assert/strict';
import { WormholeTransitEvidence } from '../src/daytripper-transit.ts';
import { getWormholeClass } from '../src/wormhole-data.ts';
const at = Date.UTC(2026, 8, 27, 12, 0, 0);
const line = "[ 2026.09.27 12:00:00 ] (notify) Can't navigate while entering wormhole";
test('actual security distinguishes high, low, null and unavailable data', () => {
  assert.equal(getWormholeClass(30000142, 0.95), 'Highsec');
  assert.equal(getWormholeClass(30002086, 0.35), 'Lowsec');
  assert.equal(getWormholeClass(30003276, -0.2), 'Nullsec');
  assert.equal(getWormholeClass(30000142), 'Unknown');
  assert.equal(getWormholeClass(30000142, NaN), 'Unknown');
});
test('explicit entry plus fresh location transition is consumed once for the same pilot', () => {
  const evidence = new WormholeTransitEvidence();
  assert.equal(evidence.record('Pilot', line, at + 1000), true);
  assert.equal(evidence.consume('Other', at - 10000, at + 5000, at + 6000), false);
  assert.equal(evidence.consume('PILOT', at - 10000, at + 5000, at + 6000), true);
  assert.equal(evidence.consume('Pilot', at - 10000, at + 5000, at + 6000), false);
});
test('proximity, collapse, failed jumps, old lines and stale locations cannot prove a transit', () => {
  const evidence = new WormholeTransitEvidence();
  for (const message of ['Your cloak deactivates due to proximity to a nearby Wormhole K162.', 'This wormhole has collapsed', 'Jumping from Jita to Perimeter']) {
    assert.equal(evidence.record('Pilot', '[ 2026.09.27 12:00:00 ] (notify) ' + message, at), false);
  }
  assert.equal(evidence.record('Pilot', line, at + 91000), false);
  for (const [before, after, now] of [[null, at + 5000, at + 6000], [at - 61000, at + 5000, at + 6000], [at - 1000, at - 1, at + 6000], [at - 1000, at + 5000, at + 91000]]) {
    evidence.record('Pilot', line, at);
    assert.equal(evidence.consume('Pilot', before, after, now), false);
  }
});

// Exercise the actual observation method without mounting the desktop DOM.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const uiSource = readFileSync(new URL('../src/wormhole-chain-ui.ts', import.meta.url), 'utf8');
const observation = uiSource.slice(uiSource.indexOf('  public handleAutoIngestPilot('), uiSource.indexOf('  private updatePilotTrackerStrip()'));
const Harness = runInNewContext(ts.transpile(`class Harness { ${observation} }; Harness;`), {
  getWormholeClass, getHomeSystem: () => null, universeGraph: { getSystemInfo: () => ({ security: 0.7 }) }, getSystemStatics: () => null
});
function mapper(nodes = []) {
  return Object.assign(new Harness(), {
    nodes: new Map(nodes.map(n => [n.systemId, n])), links: [], signatures: new Map(), exemptPilots: new Set(),
    saveToStorage() {}, renderChainContentOnly() {}, panToSystem(id) { this.focused = id; }
  });
}
test('scanner observation replaces untouched Jita starter without guessing an edge', () => {
  const ui = mapper([{ systemId: 30000142 }]);
  ui.handleAutoIngestPilot({ id: '1', name: 'Scout', systemId: 30002086, systemName: 'Turnur' });
  assert.deepEqual([...ui.nodes.keys()], [30002086]);
  assert.equal(ui.links.length, 0);
  assert.equal(ui.focused, 30002086);
});
test('scanner movement preserves real chain history and focuses existing systems', () => {
  const ui = mapper([{ systemId: 30000142 }, { systemId: 31000001 }]);
  ui.links.push({ sourceId: 30000142, targetId: 31000001 });
  ui.handleAutoIngestPilot({ id: '1', name: 'Scout', systemId: 30002086, systemName: 'Turnur' });
  assert.equal(ui.nodes.size, 3);
  assert.equal(ui.links.length, 1);
  ui.handleAutoIngestPilot({ id: '1', name: 'Scout', systemId: 31000001 });
  assert.equal(ui.focused, 31000001);
  assert.equal(ui.nodes.size, 3);
  assert.equal(ui.links.length, 1);
});
