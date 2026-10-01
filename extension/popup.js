const status = document.getElementById('status');
const render = async () => {
  const { connection, active } = await chrome.storage.session.get(['connection', 'active']);
  status.textContent = connection !== 'connected' ? 'Open Unhook to connect. If it is already open, reopen the updated app.' : active ? 'Connected · focus is active' : 'Connected · ready when you are';
};
chrome.storage.onChanged.addListener(() => void render());
void render();
