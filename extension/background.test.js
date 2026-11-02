import { afterEach, describe, expect, it, vi } from 'vitest';

const event = () => ({
  listeners: [],
  addListener(listener) {
    this.listeners.push(listener);
  },
});
function fixture(fail = false) {
  const port = {
    onMessage: event(),
    onDisconnect: event(),
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  const api = {
    runtime: {
      id: 'test',
      onMessage: event(),
      connectNative: () => port,
      getManifest: () => ({ version: '0.2.0' }),
      getURL: path => `chrome-extension://test/${path}`,
    },
    alarms: { clear: async () => {}, create: async () => {}, onAlarm: event() },
    tabs: {
      query: async () => [],
      update: async () => {},
      onUpdated: event(),
      onActivated: event(),
    },
    webNavigation: { onCommitted: event() },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {
        if (fail) throw new Error('rules failed');
      },
    },
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {} },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  };
  return {
    api,
    port,
    failRules: () => {
      fail = true;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});
describe('companion installation verification', () => {
  it('handles reflection locally without forwarding user text to the native app', async () => {
    vi.useFakeTimers();
    const { api, port } = fixture();
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.runtime.onMessage.listeners).toHaveLength(2);
    const response = await new Promise(resolve =>
      api.runtime.onMessage.listeners[0](
        { type: 'reflectionAdd', text: 'Finish my work' },
        { id: 'test', tab: { id: 1 }, frameId: 0, url: api.runtime.getURL('blocked.html') },
        resolve,
      ),
    );
    expect(response).toMatchObject({
      ok: true,
      reflection: { tasks: [{ text: 'Finish my work', completed: false }], attempts: 0 },
    });
    expect(port.postMessage.mock.calls).toEqual([[{ type: 'getState' }]]);
  });
  it('reports accepted focus context locally and releases the deadline on expiry', async () => {
    vi.useFakeTimers();
    const { api, port } = fixture();
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    const state = {
      version: 1,
      active: true,
      domains: ['facebook.com'],
      endsAt: Date.now() + 1000,
      updatedAt: Date.now(),
    };
    port.onMessage.listeners[0](state);
    await vi.advanceTimersByTimeAsync(0);
    const sender = {
      id: 'test',
      tab: { id: 1 },
      frameId: 0,
      url: `${api.runtime.getURL('blocked.html')}?site=facebook.com`,
    };
    const context = () =>
      new Promise(resolve =>
        api.runtime.onMessage.listeners[1](
          { type: 'blockedContext', url: 'https://facebook.com/private' },
          sender,
          resolve,
        ),
      );
    const nativeBefore = [...port.postMessage.mock.calls];
    expect(await context()).toEqual({
      ok: true,
      context: { active: true, connected: true, endsAt: state.endsAt, site: 'facebook.com' },
    });
    expect(port.postMessage.mock.calls).toEqual(nativeBefore);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await context()).toEqual({
      ok: true,
      context: { active: false, connected: true, endsAt: null, site: null },
    });
    port.onDisconnect.listeners[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(await context()).toEqual({
      ok: true,
      context: { active: false, connected: false, endsAt: null, site: null },
    });
    expect(JSON.stringify(port.postMessage.mock.calls)).not.toContain('facebook.com');
    expect(JSON.stringify(port.postMessage.mock.calls)).not.toContain('private');
  });
  it('acknowledges only after enforcement succeeds, and ignores receipt replies', async () => {
    vi.useFakeTimers();
    const { api, port } = fixture();
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'getState' });
    const state = {
      version: 1,
      active: true,
      domains: ['example.com'],
      endsAt: Date.now() + 10000,
      updatedAt: Date.now(),
    };
    port.onMessage.listeners[0](state);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'applied',
      updatedAt: state.updatedAt,
      extensionVersion: '0.2.0',
    });
    const calls = port.postMessage.mock.calls.length;
    port.onMessage.listeners[0]({ type: 'ack', ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage.mock.calls).toHaveLength(calls);
  });
  it('does not report readiness when browser rule installation fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, port, failRules } = fixture();
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    failRules();
    port.onMessage.listeners[0]({
      version: 1,
      active: true,
      domains: ['example.com'],
      endsAt: Date.now() + 10000,
      updatedAt: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage.mock.calls.every(([request]) => request.type === 'getState')).toBe(
      true,
    );
  });
  it('uses the advertised protocol for a newer companion release', async () => {
    vi.useFakeTimers();
    const { api, port } = fixture();
    api.runtime.getManifest = () => ({ version: '0.2.9' });
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    const state = {
      version: 1,
      ackProtocolVersion: 1,
      active: true,
      domains: ['example.com'],
      endsAt: Date.now() + 10000,
      updatedAt: Date.now(),
    };
    port.onMessage.listeners[0](state);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'applied',
      updatedAt: state.updatedAt,
      extensionVersion: '0.2.9',
      protocolVersion: 1,
    });
  });
  it('sends the legacy schema to a host that does not advertise a protocol', async () => {
    vi.useFakeTimers();
    const { api, port } = fixture();
    api.runtime.getManifest = () => ({ version: '0.2.2' });
    vi.stubGlobal('chrome', api);
    await import('./background.js');
    await vi.advanceTimersByTimeAsync(0);
    const state = { version: 1, active: false, domains: [], endsAt: null, updatedAt: Date.now() };
    port.onMessage.listeners[0](state);
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'applied',
      updatedAt: state.updatedAt,
      extensionVersion: '0.2.2',
    });
  });
  it.each([2, 0, '1', null])(
    'releases rules without acknowledging an unsupported protocol %s',
    async protocol => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { api, port } = fixture();
      const installed = [];
      api.declarativeNetRequest.updateDynamicRules = async ({ addRules }) =>
        installed.push(addRules);
      vi.stubGlobal('chrome', api);
      await import('./background.js');
      await vi.advanceTimersByTimeAsync(0);
      port.onMessage.listeners[0]({
        version: 1,
        ackProtocolVersion: 1,
        active: true,
        domains: ['example.com'],
        endsAt: Date.now() + 10000,
        updatedAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(installed.at(-1)).toHaveLength(2);
      port.postMessage.mockClear();
      const state = {
        version: 1,
        ackProtocolVersion: protocol,
        active: true,
        domains: ['example.com'],
        endsAt: Date.now() + 10000,
        updatedAt: Date.now(),
      };
      port.onMessage.listeners[0](state);
      await vi.advanceTimersByTimeAsync(0);
      expect(port.postMessage.mock.calls.every(([request]) => request.type === 'getState')).toBe(
        true,
      );
      expect(installed.at(-1)).toEqual([]);
    },
  );
});
