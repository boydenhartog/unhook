import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, Coffee, Save } from 'lucide-react';
import { validateSchedule } from '../service';
import type { Schedule, Settings } from '../types';
import { dayNames } from './FocusPage';

export function SchedulePage({ settings, busy, save }: { settings: Settings; busy: boolean; save: (settings: Settings) => Promise<boolean> }) {
  const [schedule, setSchedule] = useState<Schedule>(settings.schedule), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const persistedKey = JSON.stringify(settings.schedule);
  useEffect(() => setSchedule(JSON.parse(persistedKey) as Schedule), [persistedKey]);
  const update = (change: Partial<Schedule>) => { setSchedule(old => ({ ...old, ...change })); setSaved(false); setError(null); };
  const submit = async () => {
    try { validateSchedule(schedule); setError(null); if (await save({ ...settings, schedule })) setSaved(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Check your schedule times.'); }
  };
  const dirty = JSON.stringify(schedule) !== JSON.stringify(settings.schedule);
  return <>
    <header className="page-heading"><div><div className="eyebrow">FIND YOUR RHYTHM</div><h1>Weekly schedule</h1><p>Make focus a regular part of your day.</p></div></header>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <section className="content-panel"><div className="schedule-enable"><span className="large-line-icon"><CalendarDays size={23} /></span><div><h2>Automatic focus</h2><p>Your blocklist follows the hours you choose below.</p></div><label className="switch"><input type="checkbox" aria-label="Enable weekly schedule" checked={schedule.enabled} disabled={busy} onChange={event => update({ enabled: event.target.checked })} /><span /></label></div><div className="form-divider" /><fieldset disabled={busy} className="schedule-fields"><legend>Focus days</legend><div className="weekday-picker">{dayNames.map((day, index) => <button key={day} type="button" aria-pressed={schedule.days.includes(index)} className={schedule.days.includes(index) ? 'selected' : ''} onClick={() => update({ days: schedule.days.includes(index) ? schedule.days.filter(value => value !== index) : [...schedule.days, index].sort() })}>{day}</button>)}</div><div className="time-section"><h3><Clock3 size={16} />Focus hours</h3><div className="time-fields"><label>Start time<input type="time" required value={schedule.start} onChange={event => update({ start: event.target.value })} /></label><span className="time-to">to</span><label>End time<input type="time" required value={schedule.end} onChange={event => update({ end: event.target.value })} /></label></div><p className="field-hint">Times follow your device’s local timezone. Each window starts and ends on the same day.</p></div></fieldset></section>
      <section className="content-panel"><div className="schedule-enable"><span className="large-line-icon"><Coffee size={23} /></span><div><h2>Leave room for a break</h2><p>A little time to step away, every focus day.</p></div><label className="switch"><input type="checkbox" aria-label="Enable daily break" checked={schedule.breakEnabled} disabled={busy} onChange={event => update({ breakEnabled: event.target.checked })} /><span /></label></div>{schedule.breakEnabled && <fieldset disabled={busy} className="break-times"><legend className="sr-only">Break hours</legend><div className="time-fields"><label>Break starts<input type="time" required value={schedule.breakStart} onChange={event => update({ breakStart: event.target.value })} /></label><span className="time-to">to</span><label>Break ends<input type="time" required value={schedule.breakEnd} onChange={event => update({ breakEnd: event.target.value })} /></label></div></fieldset>}</section>
      {error && <p className="inline-error" role="alert">{error}</p>}<div className="save-row"><span role="status">{saved && !dirty ? 'Your schedule is saved.' : dirty ? 'You have unsaved changes.' : 'A routine with a little room to breathe.'}</span><button className="primary-button" disabled={busy || !dirty}><Save size={16} />{busy ? 'Saving…' : 'Save schedule'}</button></div>
    </form><p className="page-note">Keep Unhook running for scheduled focus. Your computer must be awake. On macOS and Linux, a system permission prompt may appear when blocking changes.</p>
  </>;
}
