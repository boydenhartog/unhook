export function mountBlockedPage({
  root,
  window: win = globalThis.window,
  api = globalThis.chrome,
}) {
  const doc = root.ownerDocument;
  const contextSummary = root.querySelector('[data-context-summary]');
  const contextDetail = root.querySelector('[data-context-detail]');
  const closeStatus = root.querySelector('#close-status');
  const button = root.querySelector('[data-close]');
  const isPreview =
    ['http:', 'https:'].includes(win.location.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(win.location.hostname) &&
    !api?.runtime?.sendMessage;
  let disposed = false;
  let contextRevision = 0;

  function announce(summary, detail) {
    if (contextSummary.textContent !== summary) contextSummary.textContent = summary;
    if (contextDetail.textContent !== detail) contextDetail.textContent = detail;
  }
  async function updateContext() {
    if (disposed) return;
    const revision = ++contextRevision;
    if (isPreview) {
      announce('SIMULATED PREVIEW', 'Sites are not blocked.');
      return;
    }
    try {
      const response = await api.runtime.sendMessage({ type: 'blockedContext' });
      const context = response?.context;
      if (
        response?.ok !== true ||
        !context ||
        typeof context.active !== 'boolean' ||
        typeof context.connected !== 'boolean' ||
        !(
          context.endsAt === null ||
          (typeof context.endsAt === 'number' && Number.isFinite(context.endsAt))
        )
      )
        throw new Error('Context unavailable');
      if (disposed || revision !== contextRevision) return;
      const site = typeof context.site === 'string' && context.site ? context.site : 'This site';
      if (!context.connected)
        announce('Unhook is disconnected.', 'Blocking status is unavailable.');
      else if (!context.active)
        announce('Focus is off.', 'You can close this tab and try the site again.');
      else {
        const time =
          context.endsAt === null
            ? null
            : new Date(context.endsAt)
                .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                .replace(/\s/g, '\u00a0');
        announce(`${site} is paused.`, time === null ? 'Focus is active.' : `Focus until ${time}.`);
      }
    } catch {
      if (!disposed && revision === contextRevision)
        announce('Blocking status is unavailable.', 'Check Unhook for your current focus session.');
    }
  }
  async function closeTab() {
    if (button.disabled) return;
    button.disabled = true;
    closeStatus.textContent = '';
    try {
      const tab = await api.tabs.getCurrent();
      if (!Number.isInteger(tab?.id) || tab.id < 0) throw new Error('No tab ID');
      await api.tabs.remove(tab.id);
    } catch {
      if (!disposed)
        closeStatus.textContent = 'Close this tab with your browser’s tab close button.';
    } finally {
      if (!disposed) button.disabled = false;
    }
  }
  const onChanged = (_changes, area) => {
    if (area === 'session') void updateContext();
  };
  const onVisibility = () => {
    if (doc.visibilityState !== 'hidden') void updateContext();
  };
  button.addEventListener('click', closeTab);
  api?.storage?.onChanged?.addListener(onChanged);
  doc.addEventListener('visibilitychange', onVisibility);
  const timer = !isPreview
    ? win.setInterval(() => {
        if (doc.visibilityState !== 'hidden') void updateContext();
      }, 1_000)
    : undefined;
  return {
    ready: updateContext(),
    refresh: updateContext,
    dispose() {
      disposed = true;
      win.clearInterval(timer);
      button.removeEventListener('click', closeTab);
      api?.storage?.onChanged?.removeListener(onChanged);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

const root = globalThis.document?.querySelector('#pause');
if (root) mountBlockedPage({ root });
