import { createBlocker } from './blocker.js';
import { LEASE_MS } from './rules.js';

const blocker = createBlocker(chrome);
let port, poll, retry, deadline;
const report = error => {
  console.error('Unhook browser blocking:', error.message);
  void chrome.action.setBadgeText({ text: '!' });
  void chrome.action.setTitle({ title: 'Unhook · browser blocking needs attention' });
};
const apply = async (state, live) => {
  await blocker.update(state, live);
  clearTimeout(deadline);
  await chrome.alarms.clear('unhook-expire');
  if (state?.active) {
    const at = Math.min(state.endsAt, state.updatedAt + LEASE_MS + 1);
    if (at > Date.now()) {
      // Timer handles near deadlines; alarm survives service-worker suspension.
      deadline = setTimeout(() => void blocker.expire().catch(report), at - Date.now());
      await chrome.alarms.create('unhook-expire', { when: at });
    }
  }
};

function connect() {
  if (port) return;
  clearTimeout(retry);
  try {
    const current = chrome.runtime.connectNative('org.unhook.browser');
    port = current;
    current.onMessage.addListener(state => {
      void apply(state, state !== null).catch(async error => {
        await apply(null, false).catch(report);
        report(error);
      });
    });
    current.onDisconnect.addListener(() => {
      // Consume Chrome's lastError; missing hosts are shown in the status popup.
      void chrome.runtime.lastError;
      if (port !== current) return;
      port = undefined;
      clearInterval(poll);
      void apply(null, false).catch(report);
      retry = setTimeout(connect, 5000);
    });
    const request = () => {
      try { current.postMessage({ type: 'getState' }); }
      catch { current.disconnect(); }
    };
    request();
    poll = setInterval(request, 1000);
  } catch (error) {
    report(error);
    retry = setTimeout(connect, 5000);
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'unhook-expire') void blocker.expire().catch(report);
  if (alarm.name === 'unhook-reconnect') connect();
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url || change.status === 'loading' || change.status === 'complete') void blocker.checkTab(tab).catch(report);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(tab => blocker.checkTab(tab)).catch(() => {});
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) void blocker.checkTab({ id: details.tabId, url: details.url }).catch(report);
});

async function start() {
  const saved = await chrome.storage.session.get('state');
  try { await apply(saved.state ?? null, false); }
  catch { await apply(null, false); }
  await chrome.alarms.create('unhook-reconnect', { periodInMinutes: 0.5 });
  connect();
}
void start().catch(report);
