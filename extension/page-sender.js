// Reflection data and focus context are private to the extension's top-level
// blocked document. Content scripts, embedded frames and popups cannot read it.
export function isBlockedPageSender(api, sender) {
  if (
    sender?.id !== api.runtime.id ||
    sender?.frameId !== 0 ||
    !Number.isInteger(sender?.tab?.id) ||
    sender.tab.id < 0 ||
    typeof sender.url !== 'string'
  )
    return false;
  try {
    const page = new URL(api.runtime.getURL('blocked.html'));
    const source = new URL(sender.url);
    // URL.origin is 'null' for chrome-extension URLs in some environments.
    return (
      source.protocol === page.protocol &&
      source.host === page.host &&
      source.pathname === page.pathname
    );
  } catch {
    return false;
  }
}
