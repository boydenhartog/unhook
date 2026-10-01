import { describe, expect, it } from 'vitest';
import { createBlocker } from './blocker.js';

function browserFixture() {
  const saved = {};
  const tabs = [{ id: 1, url: 'https://www.marktplaats.nl/' }, { id: 2, url: 'https://example.com/' }];
  let rules = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async ({ removeRuleIds, addRules }) => { rules = [...rules.filter(rule => !removeRuleIds.includes(rule.id)), ...addRules]; },
    },
    tabs: { query: async () => tabs, update: async (id, update) => Object.assign(tabs.find(tab => tab.id === id), update) },
    storage: { session: { set: async values => Object.assign(saved, values) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  };
  return { api, saved, tabs, rules: () => rules };
}

describe('extension follows the launcher', () => {
  it('replaces an already-open blocked tab, follows edits, then stops blocking', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    const state = { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 10_000, updatedAt: 1000 };
    await blocker.update(state, true);
    expect(fixture.tabs[0].url).toContain('blocked.html');
    expect(fixture.tabs[1].url).toBe('https://example.com/');
    expect(fixture.rules()).toHaveLength(2);
    await blocker.update({ ...state, domains: ['example.com'] }, true);
    expect(fixture.tabs[1].url).toContain('blocked.html');
    expect(fixture.rules().every(rule => rule.condition.regexFilter.includes('example'))).toBe(true);
    await blocker.update({ ...state, active: false }, true);
    expect(fixture.rules()).toEqual([]);
    expect(fixture.saved.connection).toBe('connected');
  });
  it('guards restored/cached pages and removes expired rules without the app', async () => {
    const fixture = browserFixture();
    let now = 1000;
    const blocker = createBlocker(fixture.api, () => now);
    await blocker.update({ version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 2000, updatedAt: 1000 }, true);
    fixture.tabs[0].url = 'https://marktplaats.nl/';
    await blocker.checkTab(fixture.tabs[0]);
    expect(fixture.tabs[0].url).toContain('blocked.html');
    now = 2000;
    await blocker.expire();
    expect(fixture.rules()).toEqual([]);
    await blocker.update(null, false);
    expect(fixture.saved.connection).toBe('disconnected');
  });
});
