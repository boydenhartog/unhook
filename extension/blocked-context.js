import { isBlockedPageSender } from './page-sender.js';

export function installBlockedContextMessages(api, getContext) {
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'blockedContext') return false;
    if (!isBlockedPageSender(api, sender)) {
      respond({
        ok: false,
        error: 'Focus context requests must come from the Unhook blocked page.',
      });
      return false;
    }
    const parameters = new URL(sender.url).searchParams;
    // Only the configured domain travels with the redirect, never a requested
    // URL, path or query. The provider also checks it against accepted state.
    const sites = parameters.getAll('site');
    const site = sites.length === 1 ? sites[0] : null;
    void Promise.resolve()
      .then(() => getContext(site))
      .then(context => {
        respond({ ok: true, context });
      })
      .catch(() => {
        respond({ ok: false, error: 'Focus status is unavailable. Please try again.' });
      });
    return true;
  });
}
