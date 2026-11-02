import { describe, expect, it, vi } from 'vitest';
import { createBlocker } from './blocker.js';

function browserFixture() {
  const saved = {};
  const tabs = [
    { id: 1, url: 'https://www.marktplaats.nl/' },
    { id: 2, url: 'https://example.com/' },
  ];
  let rules = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async ({ removeRuleIds, addRules }) => {
        rules = [...rules.filter(rule => !removeRuleIds.includes(rule.id)), ...addRules];
      },
    },
    tabs: {
      query: async () => tabs,
      get: vi.fn(async id => {
        const tab = tabs.find(tab => tab.id === id);
        if (!tab) throw new Error('Tab was closed');
        return { ...tab };
      }),
      update: vi.fn(async (id, update) => {
        const tab = tabs.find(tab => tab.id === id);
        if (!tab) throw new Error('Tab was closed');
        Object.assign(tab, update);
        delete tab.pendingUrl;
      }),
    },
    storage: { session: { set: async values => Object.assign(saved, values) } },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  };
  return { api, saved, tabs, rules: () => rules };
}

describe('extension follows the launcher', () => {
  it('replaces an already-open blocked tab, follows edits, then stops blocking', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    const state = {
      version: 1,
      active: true,
      domains: ['marktplaats.nl'],
      endsAt: 10_000,
      updatedAt: 1000,
    };
    await blocker.update(state, true);
    expect(fixture.tabs[0].url).toBe('chrome-extension://test/blocked.html?site=marktplaats.nl');
    expect(fixture.tabs[1].url).toBe('https://example.com/');
    expect(fixture.rules()).toHaveLength(2);
    await blocker.update({ ...state, domains: ['example.com'] }, true);
    expect(fixture.tabs[1].url).toContain('blocked.html');
    expect(fixture.rules().every(rule => rule.condition.regexFilter.includes('example'))).toBe(
      true,
    );
    await blocker.update({ ...state, active: false }, true);
    expect(fixture.rules()).toEqual([]);
    expect(fixture.saved.connection).toBe('connected');
  });
  it('guards restored/cached pages and removes expired rules without the app', async () => {
    const fixture = browserFixture();
    let now = 1000;
    const blocker = createBlocker(fixture.api, () => now);
    await blocker.update(
      { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 2000, updatedAt: 1000 },
      true,
    );
    fixture.tabs[0].url = 'https://marktplaats.nl/';
    await blocker.checkTab(fixture.tabs[0]);
    expect(fixture.tabs[0].url).toBe('chrome-extension://test/blocked.html?site=marktplaats.nl');
    now = 2000;
    await blocker.expire();
    expect(fixture.rules()).toEqual([]);
    await blocker.update(null, false);
    expect(fixture.saved.connection).toBe('disconnected');
  });
  it('redirects one arrival once despite queued events with stale blocked URLs', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    const staleTab = { ...fixture.tabs[0] };
    await blocker.update(
      { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 10_000, updatedAt: 1000 },
      true,
    );
    await Promise.all([
      blocker.checkTab(staleTab),
      blocker.checkTab(staleTab),
      blocker.checkTab({ id: 1, url: staleTab.url }),
    ]);
    expect(fixture.api.tabs.update).toHaveBeenCalledTimes(1);

    // A later real attempt can be pending while the reflection document is open.
    fixture.tabs[0].pendingUrl = 'https://marktplaats.nl/new-attempt';
    await Promise.all([blocker.checkTab(staleTab), blocker.checkTab(staleTab)]);
    expect(fixture.api.tabs.update).toHaveBeenCalledTimes(2);
    expect(fixture.tabs[0].url).toBe('chrome-extension://test/blocked.html?site=marktplaats.nl');
  });
  it('uses the current tab URL even when a queued event describes another site', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    await blocker.update(
      { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 10_000, updatedAt: 1000 },
      true,
    );
    fixture.tabs[1].url = 'https://marktplaats.nl/';
    await blocker.checkTab({ id: 2, url: 'https://example.com/' });
    expect(fixture.tabs[1].url).toContain('blocked.html');
  });
  it('continues enforcing other tabs when a queried tab closes before being read', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    fixture.tabs[1].url = 'https://marktplaats.nl/';
    fixture.api.tabs.get.mockImplementation(async id => {
      if (id === 1) throw new Error('Tab was closed');
      return { ...fixture.tabs.find(tab => tab.id === id) };
    });
    await blocker.update(
      { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 10_000, updatedAt: 1000 },
      true,
    );
    expect(fixture.api.tabs.update).toHaveBeenCalledTimes(1);
    expect(fixture.api.tabs.update).toHaveBeenCalledWith(2, {
      url: 'chrome-extension://test/blocked.html?site=marktplaats.nl',
    });
    await expect(
      blocker.checkTab({ id: 99, url: 'https://marktplaats.nl/' }),
    ).resolves.toBeUndefined();
  });
  it('checks lease expiry after an asynchronous current-tab lookup', async () => {
    const fixture = browserFixture();
    let now = 1000;
    const blocker = createBlocker(fixture.api, () => now);
    await blocker.update(
      { version: 1, active: true, domains: ['marktplaats.nl'], endsAt: 2000, updatedAt: 1000 },
      true,
    );
    fixture.api.tabs.update.mockClear();
    fixture.tabs[0].url = 'https://marktplaats.nl/';
    fixture.api.tabs.get.mockImplementation(async id => {
      now = 2000;
      return { ...fixture.tabs.find(tab => tab.id === id) };
    });
    await blocker.checkTab(fixture.tabs[0]);
    expect(fixture.api.tabs.update).not.toHaveBeenCalled();
  });
});

describe('blocked page focus context', () => {
  const state = {
    version: 1,
    active: true,
    domains: ['marktplaats.nl'],
    endsAt: 30_000,
    updatedAt: 1000,
  };
  it('reports only a configured site and current deadline after queued state changes', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    const update = blocker.update(state, true);
    const context = blocker.context('marktplaats.nl');
    await update;
    expect(await context).toEqual({
      active: true,
      connected: true,
      endsAt: 30_000,
      site: 'marktplaats.nl',
    });
    for (const candidate of [
      'www.marktplaats.nl',
      'https://marktplaats.nl/private',
      'evil.test',
      '<script>',
    ]) {
      expect((await blocker.context(candidate)).site).toBeNull();
    }
    expect(fixture.saved).not.toHaveProperty('site');
    expect(JSON.stringify(fixture.saved)).not.toContain('private');
  });
  it('clears active site and deadline on stop, deadline, disconnect and stale lease', async () => {
    const fixture = browserFixture();
    let now = 1000;
    const blocker = createBlocker(fixture.api, () => now);
    await blocker.update(state, true);
    now = 16_001;
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: false,
      endsAt: null,
      site: null,
    });
    now = 1000;
    await blocker.update({ ...state, endsAt: 2000 }, true);
    now = 2000;
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: true,
      endsAt: null,
      site: null,
    });
    await blocker.update({ ...state, active: false, updatedAt: now }, true);
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: true,
      endsAt: null,
      site: null,
    });
    await blocker.update(null, false);
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: false,
      endsAt: null,
      site: null,
    });
  });
  it('withholds accepted context after enforcement failure, then recovers on a successful retry', async () => {
    const fixture = browserFixture();
    const blocker = createBlocker(fixture.api, () => 1000);
    const installRules = fixture.api.declarativeNetRequest.updateDynamicRules;
    fixture.api.declarativeNetRequest.updateDynamicRules = vi
      .fn()
      .mockRejectedValueOnce(new Error('Rules could not be installed'))
      .mockImplementation(installRules);
    const failed = blocker.update(state, true);
    const queuedContext = blocker.context('marktplaats.nl');
    await expect(failed).rejects.toThrow('Rules could not be installed');
    expect(await queuedContext).toEqual({
      active: false,
      connected: false,
      endsAt: null,
      site: null,
    });
    expect(fixture.rules()).toEqual([]);
    await blocker.update(state, true);
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: true,
      connected: true,
      endsAt: 30_000,
      site: 'marktplaats.nl',
    });
    fixture.api.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('Removal failed'),
    );
    await expect(blocker.update({ ...state, active: false }, true)).rejects.toThrow(
      'Removal failed',
    );
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: false,
      endsAt: null,
      site: null,
    });
  });
  it('handles backwards clock changes without exposing a stale active deadline', async () => {
    const fixture = browserFixture();
    let now = 1000;
    const blocker = createBlocker(fixture.api, () => now);
    await blocker.update(state, true);
    now = 900;
    expect(await blocker.context('marktplaats.nl')).toEqual({
      active: false,
      connected: false,
      endsAt: null,
      site: null,
    });
  });
});
