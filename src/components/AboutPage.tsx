import { FolderLock, Heart, RotateCcw, ShieldCheck, Terminal } from 'lucide-react';
import type { AppStatus } from '../types';

export function AboutPage({ status, busy, preview, restore }: { status: AppStatus; busy: boolean; preview: boolean; restore: () => void }) {
  return <>
    <header className="page-heading"><div><div className="eyebrow">QUIET SOFTWARE, CLEAR INTENTIONS</div><h1>About Unhook</h1><p>A small tool for a little more intention.</p></div><span className="version-badge">v0.1.0</span></header>
    <section className="content-panel about-intro"><span className="about-logo"><ShieldCheck size={28} /></span><h2>Your attention belongs to you.</h2><p>Unhook is an open-source website blocker for Windows, macOS, and Linux. Choose your distractions, set aside some time, and get back to the things you care about.</p></section>
    <section className="content-panel about-details"><div><FolderLock size={20} /><div><h2>Local and private</h2><p>Your blocklist, schedule, and focus sessions stay on this device. No account or tracking is needed.</p></div></div><div><Terminal size={20} /><div><h2>Simple under the hood</h2><p>The desktop app adds a clearly marked section to your system’s hosts file and removes it when focus ends. Administrator permissions are required. It requests a DNS cache refresh when rules change; some browsers may keep their own cache.</p><code className="hosts-path">{status.hostsPath}</code></div></div><div><Heart size={20} /><div><h2>Built for a gentle nudge</h2><p>Unhook blocks listed domains and their www aliases. Add other subdomains separately. It is a focus aid, so you can end a session whenever you need to.</p></div></div></section>
    <section className="content-panel recovery-panel"><div><h2>Restore website access</h2><p>End your session and remove Unhook’s entries. A current scheduled window stays paused until it ends.</p></div><button className="secondary-button" disabled={busy} onClick={restore}><RotateCcw size={16} />{preview ? 'Reset preview session' : 'Restore hosts file'}</button></section>
    <p className="page-note">Keep the desktop app running for weekly schedules. Closing its window keeps it in the system tray; choosing Quit restores access. If Unhook exits unexpectedly, reopen it or use the CLI to restore its entries.</p>
  </>;
}
