import { blockedDomain, effectiveState, makeRules, LEASE_MS } from './rules.js';

export function createBlocker(api, now = () => Date.now()) {
  let raw = null, connected = false;
  let ruleSignature;
  let queue = Promise.resolve();
  // Serialize state changes and tab checks so a late start cannot overwrite Stop.
  const enqueue = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const check = async tab => {
    if (tab.id !== undefined && blockedDomain(tab.pendingUrl || tab.url, effectiveState(raw, now()))) {
      // A closed tab is harmless; do not let it abort enforcement for other tabs.
      await api.tabs.update(tab.id, { url: api.runtime.getURL('blocked.html') }).catch(() => {});
    }
  };
  const apply = async () => {
    const state = effectiveState(raw, now());
    const rules = makeRules(state);
    const signature = JSON.stringify(rules);
    if (ruleSignature !== signature) {
      const previous = await api.declarativeNetRequest.getDynamicRules();
      await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: previous.map(rule => rule.id), addRules: rules });
      ruleSignature = signature;
    }
    const live = connected && raw !== null && now() - raw.updatedAt <= LEASE_MS;
    await api.storage.session.set({ state: raw, connection: live ? 'connected' : 'disconnected', active: state.active });
    await api.action.setBadgeText({ text: state.active ? 'ON' : live ? '' : '!' });
    await api.action.setBadgeBackgroundColor({ color: state.active ? '#4b785e' : '#956322' });
    await api.action.setTitle({ title: state.active ? 'Unhook · focus active' : live ? 'Unhook · ready when you are' : 'Unhook · open the desktop app to connect' });
    if (state.active) for (const tab of await api.tabs.query({})) await check(tab);
  };
  return {
    update: (input, live) => enqueue(async () => {
      // Invalid data never becomes a broad browser rule.
      effectiveState(input, now());
      raw = input;
      connected = live;
      await apply();
    }),
    expire: () => enqueue(apply),
    checkTab: tab => enqueue(() => check(tab)),
  };
}
