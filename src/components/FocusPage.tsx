import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Globe2, Play, ShieldCheck, Square } from 'lucide-react';
import type { AppStatus, SetupStatus } from '../types';
import { remainingFocusSeconds, scheduleSummary } from '../time';
const domainInitial = (domain: string) => domain.charAt(0).toUpperCase();

export function FocusPage({
  status,
  setup,
  busy,
  preview,
  start,
  stop,
  navigate,
}: {
  status: AppStatus;
  setup: SetupStatus | null;
  busy: boolean;
  preview: boolean;
  start: (minutes: number) => void;
  stop: () => void;
  navigate: (page: 'blocklist' | 'schedule' | 'setup') => void;
}) {
  const [duration, setDuration] = useState(25),
    [custom, setCustom] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining =
    status.active && status.endsAt
      ? remainingFocusSeconds(status.endsAt, status.remainingSeconds, now)
      : duration * 60;
  const uncertain = status.active && status.endsAt === null;
  const timer = uncertain
    ? '– – : – –'
    : `${Math.floor(remaining / 60)
        .toString()
        .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
  const validDuration = Number.isInteger(duration) && duration >= 1 && duration <= 1440;
  const active = status.active;
  const connected = setup?.browserConnected === true;
  const systemReady =
    setup?.systemBlockingEnabled === true &&
    (setup.system.state === 'ready' || setup.system.state === 'passwordRequired');
  const canBlock = preview || connected || systemReady;
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">A SPACE FOR DEEP WORK</div>
          <h1>Focus mode</h1>
          <p>Give your attention to what matters.</p>
        </div>
      </header>
      {!preview && (
        <div className={`blocking-status ${connected ? 'connected' : ''}`} role="status">
          <Globe2 size={17} />
          <div>
            <strong>
              {connected ? 'Browser companion connected' : 'Browser companion disconnected'}
            </strong>
            <p>
              {connected
                ? 'Start and stop browser blocking here. No administrator password needed.'
                : systemReady
                  ? 'System blocking is available. Connect the companion to block cached browser pages too.'
                  : 'Connect your browser companion before starting a protected session.'}
            </p>
          </div>
          <button className="text-button" onClick={() => navigate('setup')}>
            Setup <ArrowRight size={14} />
          </button>
        </div>
      )}
      <section
        className={`focus-panel ${active ? 'focus-running' : ''}`}
        aria-label="Focus session"
      >
        <div className="timer-shell">
          <svg className="timer-ring" viewBox="0 0 280 280" aria-hidden="true">
            <circle className="timer-track" cx="140" cy="140" r="130" />
            <circle className="timer-progress" cx="140" cy="140" r="130" />
          </svg>
          <div className="timer-content">
            <span className="timer-kicker">{active ? 'TIME REMAINING' : 'FOCUS FOR'}</span>
            <span
              className="timer-digits"
              role="timer"
              aria-label={
                uncertain
                  ? 'Remaining time unavailable'
                  : `${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds`
              }
            >
              {timer}
            </span>
            <span className="timer-caption">
              {uncertain
                ? 'Remaining time is unavailable.'
                : active
                  ? 'One thing at a time.'
                  : 'minutes of uninterrupted time'}
            </span>
          </div>
        </div>
        <div className="duration-options" aria-label="Session duration">
          {[25, 50, 90].map(value => (
            <button
              disabled={busy || active}
              className={!custom && duration === value ? 'selected' : ''}
              aria-pressed={!custom && duration === value}
              key={value}
              onClick={() => {
                setDuration(value);
                setCustom(false);
              }}
            >
              {value} min
            </button>
          ))}
          <button
            className={custom ? 'selected' : ''}
            aria-pressed={custom}
            disabled={busy || active}
            onClick={() => setCustom(true)}
          >
            Custom
          </button>
        </div>
        {custom && (
          <label className="custom-duration">
            Minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={Number.isNaN(duration) ? '' : duration}
              disabled={active || busy}
              onChange={event => setDuration(Number(event.target.value))}
            />
          </label>
        )}
        <button
          className={`primary-button start-button ${active ? 'stop-button' : ''}`}
          disabled={
            busy ||
            (!active && (!validDuration || status.settings.domains.length === 0 || !canBlock))
          }
          onClick={() => (active ? stop() : start(duration))}
        >
          {active ? <Square size={17} /> : <Play size={18} fill="currentColor" />}
          {busy ? 'Updating…' : active ? 'End focus session' : 'Start focusing'}
          {!active && (
            <span className="button-arrow">
              <ArrowRight size={18} />
            </span>
          )}
        </button>
        <p className="session-note">
          {preview
            ? 'Preview only. Websites remain accessible in your browser.'
            : !canBlock
              ? active
                ? 'Your timer is running, but website blocking is unavailable.'
                : 'Complete browser setup to enable blocking.'
              : active
                ? 'You can end your session whenever you need to.'
                : 'Distractions off. Your work, front and center.'}
        </p>
      </section>
      <div className="focus-details">
        <section className="detail-section">
          <div className="section-heading">
            <h2>
              <Globe2 size={17} />
              Your blocklist <span className="count-badge">{status.settings.domains.length}</span>
            </h2>
            <button className="text-button" onClick={() => navigate('blocklist')}>
              Manage <ArrowRight size={14} />
            </button>
          </div>
          <p>
            {canBlock
              ? 'These websites take a break while you focus.'
              : 'Connect the companion to block these websites during focus.'}
          </p>
          <div className="domain-chips">
            {status.settings.domains.length ? (
              status.settings.domains.slice(0, 5).map(domain => (
                <span className="domain-chip" key={domain}>
                  <span className={`site-mark mark-${domain.charCodeAt(0) % 5}`}>
                    {domainInitial(domain)}
                  </span>
                  {domain}
                </span>
              ))
            ) : (
              <span className="muted">Your blocklist is empty. Add a website to get started.</span>
            )}
            {status.settings.domains.length > 5 && (
              <span className="domain-chip">+{status.settings.domains.length - 5} more</span>
            )}
          </div>
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>
              <CalendarDays size={17} />A rhythm that works
            </h2>
            <button className="text-button" onClick={() => navigate('schedule')}>
              Edit schedule <ArrowRight size={14} />
            </button>
          </div>
          <div className="schedule-overview">
            <span className="schedule-icon">
              <CalendarDays size={20} />
            </span>
            <div>
              <strong>{scheduleSummary(status.settings.schedule)}</strong>
              <p>
                {status.settings.schedule.breakEnabled
                  ? `A breather from ${status.settings.schedule.breakStart}–${status.settings.schedule.breakEnd}`
                  : 'An uninterrupted focus window'}
              </p>
            </div>
            <span className={`schedule-state ${status.settings.schedule.enabled ? 'enabled' : ''}`}>
              {status.settings.schedule.enabled && <Check size={13} />}
              {status.settings.schedule.enabled ? 'Enabled' : 'Off'}
            </span>
          </div>
        </section>
      </div>
      <footer className="page-footer">
        <span className="tiny-shield">
          <ShieldCheck size={14} />
          Private by design. Your data stays on this device.
        </span>
        <span>Less noise. More you.</span>
      </footer>
    </>
  );
}
