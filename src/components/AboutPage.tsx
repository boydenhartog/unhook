import { FolderLock, Heart, RotateCcw, ShieldCheck, Terminal } from 'lucide-react';
import { version } from '../../package.json';
import type { AppStatus } from '../types';

export function AboutPage({
  status,
  busy,
  preview,
  restore,
}: {
  status: AppStatus;
  busy: boolean;
  preview: boolean;
  restore: () => void;
}) {
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">QUIET SOFTWARE, CLEAR INTENTIONS</div>
          <h1>About Unhook</h1>
          <p>A small tool for a little more intention.</p>
        </div>
        <span className="version-badge">v{version}</span>
      </header>
      <section className="content-panel about-intro">
        <span className="about-logo">
          <ShieldCheck size={28} />
        </span>
        <h2>Your attention belongs to you.</h2>
        <p>
          Unhook is an open-source website blocker for Windows, macOS, and Linux. Choose your
          distractions, set aside some time, and get back to the things you care about.
        </p>
      </section>
      <section className="content-panel about-details">
        <div>
          <FolderLock size={20} />
          <div>
            <h2>Local and private</h2>
            <p>
              Your blocklist, schedule, and focus sessions stay on this device. No account or
              tracking is needed.
            </p>
          </div>
        </div>
        <div>
          <Terminal size={20} />
          <div>
            <h2>Simple under the hood</h2>
            <p>
              The companion extension follows the desktop app’s blocklist and focus sessions.
              Browser blocking needs no administrator password. Optional system blocking uses a
              background service that macOS approves once, then adds and removes Unhook’s marked
              hosts file entries during focus.
            </p>
            <code className="hosts-path">{status.hostsPath}</code>
          </div>
        </div>
        <div>
          <Heart size={20} />
          <div>
            <h2>Built for a gentle nudge</h2>
            <p>
              Unhook blocks listed domains and their www aliases. Add other subdomains separately.
              It is a focus aid, so you can end a session whenever you need to.
            </p>
          </div>
        </div>
      </section>
      <section className="content-panel recovery-panel">
        <div>
          <h2>Restore the hosts file</h2>
          <p>
            Remove Unhook’s system entries and turn off system blocking. Manage your current browser
            focus session on the Focus page.
          </p>
        </div>
        <button className="secondary-button" disabled={busy || preview} onClick={restore}>
          <RotateCcw size={16} />
          {preview ? 'Desktop recovery only' : 'Restore hosts file'}
        </button>
      </section>
      <p className="page-note">
        Keep the desktop app running for weekly schedules. Closing its window keeps it in the system
        tray; choosing Quit restores access. If Unhook exits unexpectedly, reopen it to recover its
        session status.
      </p>
    </>
  );
}
