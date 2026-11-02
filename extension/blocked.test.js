// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountBlockedPage } from './blocked.js';

const html = readFileSync('extension/blocked.html', 'utf8');
const tick = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
};
const closeButton = () => document.querySelector('[data-close]');
const contextText = () =>
  document.querySelector('#block-context').textContent.replace(/\s+/g, ' ').trim();
const controllers = [];
function fixture(initial = {}) {
  let context = { active: true, connected: true, endsAt: null, site: 'facebook.com', ...initial };
  const listeners = new Set();
  const sendMessage = vi.fn(async message => {
    if (message.type !== 'blockedContext')
      throw new Error('The quiet page must not request tasks or record visits');
    return { ok: true, context };
  });
  const tabs = { getCurrent: vi.fn(async () => ({ id: 17 })), remove: vi.fn(async () => {}) };
  const changes = {
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
  };
  const app = mountBlockedPage({
    root: document.querySelector('section'),
    api: { runtime: { sendMessage }, tabs, storage: { onChanged: changes } },
    window,
  });
  controllers.push(app);
  return {
    ...app,
    sendMessage,
    tabs,
    listeners,
    async update(next) {
      context = next;
      listeners.forEach(listener => listener({}, 'session'));
      await tick();
    },
  };
}
beforeEach(() => {
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)[1];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  controllers.splice(0).forEach(app => app.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('quiet blocked page', () => {
  it('shows one quiet exit without loading old intentions or counting arrivals', async () => {
    const saved = '{"intention":"Something from three weeks ago","attempts":99}';
    localStorage.setItem('unhook.reflection.preview', saved);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const app = fixture();
    await app.ready;
    expect(document.querySelector('h1').textContent).toBe('This can wait.');
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(closeButton().textContent).toBe('Close tab');
    expect(closeButton().disabled).toBe(false);
    expect(document.querySelector('textarea, form, details, #attempt-count')).toBeNull();
    expect(document.body.textContent).not.toContain('Something from three weeks ago');
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(app.sendMessage.mock.calls.every(([message]) => message.type === 'blockedContext')).toBe(
      true,
    );
    getItem.mockRestore();
    expect(localStorage.getItem('unhook.reflection.preview')).toBe(saved);
  });
  it('provides the heading and exit before JavaScript or focus status loads', () => {
    expect(document.querySelector('h1').textContent).toBe('This can wait.');
    expect(closeButton().disabled).toBe(false);
    expect(document.querySelector('noscript').textContent).toContain('browser');
  });
  it('closes immediately while focus status is still pending', async () => {
    const tabs = { getCurrent: vi.fn(async () => ({ id: 17 })), remove: vi.fn(async () => {}) };
    const sendMessage = vi.fn(() => new Promise(() => {}));
    const app = mountBlockedPage({
      root: document.querySelector('section'),
      api: { runtime: { sendMessage }, tabs },
      window,
    });
    controllers.push(app);
    closeButton().click();
    await tick();
    expect(tabs.remove).toHaveBeenCalledWith(17);
  });
  it('prevents repeated closes in flight and gives manual guidance when closing fails', async () => {
    const app = fixture();
    await app.ready;
    let fail;
    app.tabs.remove.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    closeButton().click();
    closeButton().click();
    await tick();
    expect(app.tabs.remove).toHaveBeenCalledTimes(1);
    expect(closeButton().disabled).toBe(true);
    fail(new Error('Cannot close'));
    await tick();
    expect(document.querySelector('#close-status').textContent).toContain(
      'browser’s tab close button',
    );
    expect(closeButton().disabled).toBe(false);
    closeButton().click();
    await tick();
    expect(app.tabs.remove).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#close-status').textContent).toBe('');
  });
  it('gives manual closing guidance when the tab API is unavailable', async () => {
    const app = fixture();
    delete app.tabs.getCurrent;
    await app.ready;
    closeButton().click();
    await tick();
    expect(document.querySelector('#close-status').textContent).toContain(
      'browser’s tab close button',
    );
    expect(app.tabs.remove).not.toHaveBeenCalled();
  });
  it('shows accepted site and deadline without interpreting URL parameters', async () => {
    const endsAt = new Date('2026-11-02T15:30:00').getTime();
    const app = fixture({ endsAt });
    await app.ready;
    expect(document.querySelector('[data-context-summary]').textContent).toBe(
      'facebook.com is paused.',
    );
    const time = new Date(endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(document.querySelector('[data-context-detail]').textContent).toBe(
      `Focus until ${time.replace(/\s/g, '\u00a0')}.`,
    );
    await app.update({ active: true, connected: true, endsAt: null, site: null });
    expect(contextText()).toBe('This site is paused. Focus is active.');
  });
  it('updates ended and stale focus without replacing the scene or stealing keyboard focus', async () => {
    const app = fixture();
    await app.ready;
    const scene = document.querySelector('.unhook-scene');
    const button = closeButton();
    button.focus();
    await app.update({ active: false, connected: true, endsAt: null, site: null });
    expect(contextText()).toContain('Focus is off');
    await app.update({ active: false, connected: false, endsAt: null, site: null });
    expect(contextText()).toContain('disconnected');
    expect(document.querySelector('.unhook-scene')).toBe(scene);
    expect(closeButton()).toBe(button);
    expect(document.activeElement).toBe(button);
  });
  it('ignores late context replies after a newer refresh', async () => {
    const app = fixture();
    await app.ready;
    let finish;
    app.sendMessage.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const pending = app.refresh();
    await app.update({ active: false, connected: false, endsAt: null, site: null });
    finish({
      ok: true,
      context: { active: true, connected: true, endsAt: null, site: 'facebook.com' },
    });
    await pending;
    expect(contextText()).toContain('disconnected');
  });
  it('reports messaging failure, keeps the exit working, and recovers on refresh', async () => {
    const app = fixture();
    await app.ready;
    app.sendMessage.mockRejectedValueOnce(new Error('Disconnected'));
    await app.refresh();
    expect(contextText()).toContain('Blocking status is unavailable');
    expect(closeButton().disabled).toBe(false);
    expect(localStorage.getItem('unhook.reflection.preview')).toBeNull();
    await app.refresh();
    expect(contextText()).toContain('facebook.com is paused');
  });
  it('polls for expiry and connection changes, and cleans up on disposal', async () => {
    vi.useFakeTimers();
    const app = fixture();
    await app.ready;
    app.sendMessage.mockResolvedValue({
      ok: true,
      context: { active: false, connected: true, endsAt: null, site: null },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(contextText()).toContain('Focus is off');
    app.dispose();
    const count = app.sendMessage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(app.sendMessage).toHaveBeenCalledTimes(count);
    expect(app.listeners.size).toBe(0);
  });
});

describe('explicit local browser preview', () => {
  it('labels simulation and needs no task storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const app = mountBlockedPage({
      root: document.querySelector('section'),
      api: undefined,
      window,
    });
    controllers.push(app);
    await app.ready;
    expect(document.querySelector('[data-context-summary]').textContent).toBe('SIMULATED PREVIEW');
    expect(document.querySelector('[data-context-detail]').textContent).toBe(
      'Sites are not blocked.',
    );
    await app.refresh();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    closeButton().click();
    await tick();
    expect(document.querySelector('#close-status').textContent).toContain(
      'browser’s tab close button',
    );
  });
  it('never treats an extension messaging failure on localhost as a simulated session', async () => {
    const api = {
      runtime: {
        sendMessage: async () => {
          throw new Error('Disconnected');
        },
      },
    };
    const app = mountBlockedPage({ root: document.querySelector('section'), api, window });
    controllers.push(app);
    await app.ready;
    expect(contextText()).toContain('Blocking status is unavailable');
    expect(contextText()).not.toContain('PREVIEW');
  });
});
