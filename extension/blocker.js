import { blockedDomain, blockedPageUrl, effectiveState, makeRules, LEASE_MS } from './rules.js';

export function createBlocker(api, now = () => Date.now()) {
  let raw = null,
    connected = false;
  let ruleSignature;
  let applied = false;
  let queue = Promise.resolve();
  const pageUrl = api.runtime.getURL('blocked.html');
  const currentState = () => {
    try {
      return effectiveState(raw, now());
    } catch {
      return effectiveState(null, now());
    }
  };
  const isConnected = () =>
    connected && raw !== null && now() >= raw.updatedAt && now() - raw.updatedAt <= LEASE_MS;
  // Serialize state changes and tab checks so a late start cannot overwrite Stop.
  const enqueue = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const check = async tab => {
    if (tab.id === undefined) return;
    // Several events can describe the same navigation. Read the tab when this
    // queued check runs so stale events cannot reload the reflection document.
    const current = await api.tabs.get(tab.id).catch(() => null);
    const domain = current && blockedDomain(current.pendingUrl || current.url, currentState());
    if (domain) {
      // A closed tab is harmless; do not let it abort enforcement for other tabs.
      await api.tabs.update(tab.id, { url: blockedPageUrl(pageUrl, domain) }).catch(() => {});
    }
  };
  const apply = async () => {
    // A queued context read can run before the background's error recovery.
    // Only a fully applied snapshot can promise a site or session deadline.
    applied = false;
    const state = currentState();
    const rules = makeRules(state, pageUrl);
    const signature = JSON.stringify(rules);
    if (ruleSignature !== signature) {
      const previous = await api.declarativeNetRequest.getDynamicRules();
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: previous.map(rule => rule.id),
        addRules: rules,
      });
      ruleSignature = signature;
    }
    const live = isConnected();
    await api.storage.session.set({
      state: raw,
      connection: live ? 'connected' : 'disconnected',
      active: state.active,
    });
    await api.action.setBadgeText({ text: state.active ? 'ON' : live ? '' : '!' });
    await api.action.setBadgeBackgroundColor({ color: state.active ? '#4b785e' : '#956322' });
    await api.action.setTitle({
      title: state.active
        ? 'Unhook · focus active'
        : live
          ? 'Unhook · ready when you are'
          : 'Unhook · open the desktop app to connect',
    });
    if (state.active) for (const tab of await api.tabs.query({})) await check(tab);
    applied = true;
  };
  return {
    update: (input, live) =>
      enqueue(async () => {
        // Invalid data never becomes a broad browser rule.
        effectiveState(input, now());
        raw = input;
        connected = live;
        await apply();
      }),
    context: siteCandidate =>
      enqueue(() => {
        const state = currentState();
        return {
          active: applied && state.active,
          connected: applied && isConnected(),
          endsAt: applied && state.active ? state.endsAt : null,
          site:
            applied && state.active && state.domains.includes(siteCandidate) ? siteCandidate : null,
        };
      }),
    expire: () => enqueue(apply),
    checkTab: tab => enqueue(() => check(tab)),
  };
}
