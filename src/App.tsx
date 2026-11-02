import { useEffect, useState } from 'react';
import { version } from '../package.json';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  Globe2,
  Leaf,
  Radio,
  Settings2,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { useFocus } from './useFocus';
import { useSetup } from './useSetup';
import { FocusPage } from './components/FocusPage';
import { BlocklistPage } from './components/BlocklistPage';
import { SchedulePage } from './components/SchedulePage';
import { AboutPage } from './components/AboutPage';
import { SetupPage } from './components/SetupPage';

type Page = 'focus' | 'blocklist' | 'schedule' | 'setup' | 'about';
const navigation = [
  { id: 'focus', label: 'Focus', icon: Target },
  { id: 'blocklist', label: 'Blocklist', icon: Globe2 },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
] as const;

export default function App() {
  const [page, setPage] = useState<Page>('focus');
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [page]);
  const { status, error, busy, service, run, refresh } = useFocus();
  const connection = useSetup(service);
  const firstRun = connection.setup !== null && !connection.setup.completed;
  const currentPage = firstRun ? 'setup' : page;
  const allBusy = busy || connection.busy;
  const finishSetup = () =>
    void connection.run(async () => {
      await service.completeSetup();
      setPage('focus');
    });
  const restoreSystem = () =>
    void connection.run(async () => {
      await run(() => service.restoreHosts());
    });
  const uninstallSystem = () =>
    void connection.run(async () => {
      await service.uninstallSystemBlocker();
      await refresh();
    });
  const setSystemBlocking = (enabled: boolean) =>
    void connection.run(async () => {
      await run(() => service.setSystemBlocking(enabled));
    });
  const active = status?.active;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('focus')} aria-label="Unhook home">
          <span className="brand-symbol">
            <Leaf size={23} strokeWidth={2} />
          </span>
          <span>
            unhook<span className="brand-period">.</span>
          </span>
        </button>
        <span className="sidebar-label">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${currentPage === id ? 'current' : ''}`}
              aria-current={currentPage === id ? 'page' : undefined}
              disabled={firstRun}
              key={id}
              onClick={() => setPage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {currentPage === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item about-nav ${currentPage === 'setup' ? 'current' : ''}`}
            onClick={() => setPage('setup')}
            aria-current={currentPage === 'setup' ? 'page' : undefined}
          >
            <Settings2 size={18} />
            Setup
            <ArrowUpRight size={14} />
          </button>
          <button
            className={`nav-item about-nav ${currentPage === 'about' ? 'current' : ''}`}
            disabled={firstRun}
            onClick={() => setPage('about')}
            aria-current={currentPage === 'about' ? 'page' : undefined}
          >
            <CircleHelp size={18} />
            About Unhook
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-foot">
            <span className={`status-dot ${active ? 'green-dot' : ''}`} />
            {service.preview
              ? 'Browser preview'
              : active
                ? 'Focus is active'
                : 'Running on your device'}
            <span>{version}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="window-bar">
          <span>
            <ShieldCheck size={13} />A quieter corner of your day
          </span>
          <span className="window-bar-right">
            <Radio size={13} />
            {service.preview ? 'Preview workspace' : 'On this device'}
          </span>
        </div>
        <main>
          {service.preview && (
            <div className="preview-notice">
              <FlaskConical size={15} />
              <span>
                <strong>Browser preview</strong>
                <span className="preview-separator">·</span>Explore the app. Website blocking works
                in the desktop version.
              </span>
            </div>
          )}
          {(error || status?.error) && (
            <div className="error-notice" role="alert">
              <AlertCircle size={19} />
              <div>
                <strong>That change needs your attention</strong>
                <p>{error || status?.error}</p>
              </div>
              <button className="text-button" onClick={() => void refresh()}>
                Refresh status
              </button>
            </div>
          )}
          {connection.error && (
            <div className="error-notice" role="alert">
              <AlertCircle size={19} />
              <div>
                <strong>Setup needs your attention</strong>
                <p>{connection.error}</p>
              </div>
              <button className="text-button" onClick={() => void connection.refresh()}>
                Refresh setup
              </button>
            </div>
          )}
          {status?.warning && (
            <div className="warning-notice" role="status">
              <AlertCircle size={18} />
              <span>{status.warning}</span>
            </div>
          )}
          {!status ? (
            <div className="loading-state" aria-busy={!error}>
              <span className="loading-mark">
                <Leaf size={28} />
              </span>
              <h1>{error ? 'Connection needs attention' : 'A moment of quiet…'}</h1>
              <p>
                {error
                  ? 'Unhook could not read your focus status. Retry after resolving the message above.'
                  : 'Getting your workspace ready.'}
              </p>
            </div>
          ) : (
            <>
              {currentPage === 'focus' && (
                <FocusPage
                  status={status}
                  setup={connection.setup}
                  busy={allBusy}
                  preview={service.preview}
                  start={minutes => void run(() => service.startFocus(minutes))}
                  stop={() => void run(() => service.stopFocus())}
                  navigate={setPage}
                />
              )}
              {currentPage === 'blocklist' && (
                <BlocklistPage
                  settings={status.settings}
                  busy={allBusy}
                  save={settings => run(() => service.saveSettings(settings))}
                />
              )}
              {currentPage === 'schedule' && (
                <SchedulePage
                  settings={status.settings}
                  busy={allBusy}
                  save={settings => run(() => service.saveSettings(settings))}
                />
              )}
              {currentPage === 'setup' &&
                (connection.setup ? (
                  <SetupPage
                    setup={connection.setup}
                    busy={allBusy}
                    preview={service.preview}
                    firstRun={firstRun}
                    systemActive={status.systemActive}
                    restoreSystem={restoreSystem}
                    openBrowser={browser =>
                      void connection.run(() => service.openBrowserSetup(browser))
                    }
                    revealExtension={() => void connection.run(() => service.revealExtension())}
                    installSystem={() => void connection.run(() => service.installSystemBlocker())}
                    uninstallSystem={uninstallSystem}
                    setLaunchAtLogin={enabled =>
                      void connection.run(() => service.setLaunchAtLogin(enabled))
                    }
                    openSystemSettings={() =>
                      void connection.run(() => service.openSystemSettings())
                    }
                    setSystemBlocking={setSystemBlocking}
                    finish={finishSetup}
                  />
                ) : (
                  <p role="status">Reading your setup…</p>
                ))}
              {currentPage === 'about' && (
                <AboutPage
                  status={status}
                  busy={allBusy}
                  preview={service.preview}
                  restore={() => void run(() => service.restoreHosts())}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
