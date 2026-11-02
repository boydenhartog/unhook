import { describe, expect, it, vi } from 'vitest';
import { installBlockedContextMessages } from './blocked-context.js';

function fixture() {
  let listener;
  const api = {
    runtime: {
      id: 'test',
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: {
        addListener: value => {
          listener = value;
        },
      },
    },
  };
  const getContext = vi.fn(async site => ({ active: true, connected: true, endsAt: 2000, site }));
  installBlockedContextMessages(api, getContext);
  const sender = {
    id: 'test',
    frameId: 0,
    tab: { id: 1 },
    url: 'chrome-extension://test/blocked.html?site=facebook.com',
  };
  const call = (message, source = sender) =>
    new Promise(resolve => listener(message, source, resolve));
  return { call, sender, getContext, listener };
}

describe('blocked context messages', () => {
  it('reads the site from the verified page URL, never the message body', async () => {
    const { call, getContext } = fixture();
    expect(
      await call({
        type: 'blockedContext',
        site: 'evil.test',
        url: 'https://facebook.com/private',
      }),
    ).toEqual({
      ok: true,
      context: { active: true, connected: true, endsAt: 2000, site: 'facebook.com' },
    });
    expect(getContext).toHaveBeenCalledWith('facebook.com');
  });
  it.each([
    { id: 'evil' },
    { frameId: 1 },
    { tab: undefined },
    { tab: { id: -1 } },
    { url: 'https://facebook.com/?site=facebook.com' },
    { url: 'chrome-extension://evil/blocked.html?site=facebook.com' },
    { url: 'chrome-extension://test/blocked.html.evil?site=facebook.com' },
    { url: 'chrome-extension://test/blocked.html/child?site=facebook.com' },
  ])('rejects a hostile sender %j', async change => {
    const { call, sender, getContext } = fixture();
    expect((await call({ type: 'blockedContext' }, { ...sender, ...change })).ok).toBe(false);
    expect(getContext).not.toHaveBeenCalled();
  });
  it.each(['', '#site=facebook.com', '?site=facebook.com&site=evil.test'])(
    'does not trust a missing, fragment or duplicate query %s',
    async suffix => {
      const { call, sender, getContext } = fixture();
      await call(
        { type: 'blockedContext' },
        { ...sender, url: `chrome-extension://test/blocked.html${suffix}` },
      );
      expect(getContext).toHaveBeenCalledWith(null);
    },
  );
  it('ignores other extension messages and handles failed reads', async () => {
    const { call, listener, getContext } = fixture();
    expect(listener({ type: 'reflectionVisit' }, {}, vi.fn())).toBe(false);
    getContext.mockRejectedValueOnce(new Error('private diagnostic'));
    expect(await call({ type: 'blockedContext' })).toEqual({
      ok: false,
      error: 'Focus status is unavailable. Please try again.',
    });
  });
});
