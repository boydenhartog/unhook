import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, CalendarDays, ChevronRight, CircleHelp, FlaskConical, Globe2, Leaf, Radio, ShieldCheck, Target } from 'lucide-react';
import { useFocus } from './useFocus';
import { FocusPage } from './components/FocusPage';
import { BlocklistPage } from './components/BlocklistPage';
import { SchedulePage } from './components/SchedulePage';
import { AboutPage } from './components/AboutPage';

type Page = 'focus' | 'blocklist' | 'schedule' | 'about';
const navigation = [{ id: 'focus', label: 'Focus', icon: Target }, { id: 'blocklist', label: 'Blocklist', icon: Globe2 }, { id: 'schedule', label: 'Schedule', icon: CalendarDays }] as const;

export default function App() {
  const [page, setPage] = useState<Page>('focus');
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [page]);
  const { status, error, busy, service, run, refresh } = useFocus();
  const active = status?.active;
  return <div className="app-shell">
    <aside className="sidebar"><button className="brand" onClick={() => setPage('focus')} aria-label="Unhook home"><span className="brand-symbol"><Leaf size={23} strokeWidth={2} /></span><span>unhook<span className="brand-period">.</span></span></button><span className="sidebar-label">YOUR WORKSPACE</span><nav aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => <button className={`nav-item ${page === id ? 'current' : ''}`} aria-current={page === id ? 'page' : undefined} key={id} onClick={() => setPage(id)}><Icon size={19} /><span>{label}</span>{page === id && <ChevronRight size={15} />}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-message"><span className="message-icon"><Leaf size={17} /></span><p>A little less scrolling.<br />A little more living.</p></div><button className={`nav-item about-nav ${page === 'about' ? 'current' : ''}`} onClick={() => setPage('about')} aria-current={page === 'about' ? 'page' : undefined}><CircleHelp size={18} />About Unhook<ArrowUpRight size={14} /></button><div className="sidebar-foot"><span className={`status-dot ${active ? 'green-dot' : ''}`} />{service.preview ? 'Browser preview' : active ? 'Focus is active' : 'Running on your device'}<span>0.1.0</span></div></div></aside>
    <div className="main-shell"><div className="window-bar"><span><ShieldCheck size={13} />A quieter corner of your day</span><span className="window-bar-right"><Radio size={13} />{service.preview ? 'Preview workspace' : 'On this device'}</span></div><main>
      {service.preview && <div className="preview-notice"><FlaskConical size={15} /><span><strong>Browser preview</strong><span className="preview-separator">·</span>Explore the app. Website blocking works in the desktop version.</span></div>}
      {(error || status?.error) && <div className="error-notice" role="alert"><AlertCircle size={19} /><div><strong>That change needs your attention</strong><p>{error || status?.error}</p></div><button className="text-button" onClick={() => void refresh()}>Refresh status</button></div>}
      {status?.warning && <div className="warning-notice" role="status"><AlertCircle size={18} /><span>{status.warning}</span></div>}
      {!status ? <div className="loading-state" aria-busy={!error}><span className="loading-mark"><Leaf size={28} /></span><h1>{error ? 'Connection needs attention' : 'A moment of quiet…'}</h1><p>{error ? 'Unhook could not read your focus status. Retry after resolving the message above.' : 'Getting your workspace ready.'}</p></div> : <>
        {page === 'focus' && <FocusPage status={status} busy={busy} preview={service.preview} start={minutes => void run(() => service.startFocus(minutes))} stop={() => void run(() => service.stopFocus())} navigate={setPage} />}
        {page === 'blocklist' && <BlocklistPage settings={status.settings} busy={busy} save={settings => run(() => service.saveSettings(settings))} />}
        {page === 'schedule' && <SchedulePage settings={status.settings} busy={busy} save={settings => run(() => service.saveSettings(settings))} />}
        {page === 'about' && <AboutPage status={status} busy={busy} preview={service.preview} restore={() => void run(() => service.restoreHosts())} />}
      </>}
    </main></div>
  </div>;
}
