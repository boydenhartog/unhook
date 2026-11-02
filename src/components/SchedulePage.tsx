import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, Coffee } from 'lucide-react';
import { errorMessage, validateSchedule } from '../service';
import type { Schedule, Settings } from '../types';
import { dayNames } from '../time';

export function SchedulePage({
  settings,
  busy,
  save,
}: {
  settings: Settings;
  busy: boolean;
  save: (settings: Settings) => Promise<boolean>;
}) {
  const [schedule, setSchedule] = useState<Schedule>(settings.schedule),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false),
    [retryable, setRetryable] = useState(false);
  const inFlight = useRef(false);
  const persistedKey = JSON.stringify(settings.schedule);
  useEffect(() => setSchedule(JSON.parse(persistedKey) as Schedule), [persistedKey]);
  const persist = async (next: Schedule) => {
    if (inFlight.current) return;
    setSaved(false);
    setError(null);
    setRetryable(false);
    try {
      validateSchedule(next);
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      if (await save({ ...settings, schedule: next })) setSaved(true);
      else {
        setError('Could not save changes. Your saved schedule is still in effect.');
        setRetryable(true);
      }
    } catch (failure) {
      setError(errorMessage(failure));
      setRetryable(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const update = (change: Partial<Schedule>) => {
    if (busy || inFlight.current) return;
    const next = { ...schedule, ...change };
    setSchedule(next);
    void persist(next);
  };
  const disabled = busy || saving;
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">FIND YOUR RHYTHM</div>
          <h1>Weekly schedule</h1>
          <p>Make focus a regular part of your day.</p>
        </div>
      </header>
      <div
        className={`schedule-feedback${error ? ' schedule-feedback-error' : ''}`}
        role={error ? 'alert' : 'status'}
        aria-atomic="true"
      >
        <span>
          {error ||
            (saving
              ? 'Saving changes…'
              : saved
                ? 'All changes saved.'
                : 'Changes save automatically.')}
        </span>
        {retryable && (
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => void persist(schedule)}
          >
            Retry
          </button>
        )}
      </div>
      <div aria-busy={saving}>
        <section className="content-panel">
          <div className="schedule-enable">
            <span className="large-line-icon">
              <CalendarDays size={23} />
            </span>
            <div>
              <h2>Automatic focus</h2>
              <p>Your blocklist follows the hours you choose below.</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-label="Enable weekly schedule"
                checked={schedule.enabled}
                disabled={disabled}
                onChange={event => update({ enabled: event.target.checked })}
              />
              <span />
            </label>
          </div>
          <div className="form-divider" />
          <fieldset className="schedule-fields">
            <legend>Focus days</legend>
            <div className="weekday-picker">
              {dayNames.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  aria-pressed={schedule.days.includes(index)}
                  className={schedule.days.includes(index) ? 'selected' : ''}
                  onClick={() =>
                    update({
                      days: schedule.days.includes(index)
                        ? schedule.days.filter(value => value !== index)
                        : [...schedule.days, index].sort(),
                    })
                  }
                >
                  {day}
                </button>
              ))}
            </div>
            <div className="time-section">
              <h3>
                <Clock3 size={16} />
                Focus hours
              </h3>
              <div className="time-fields">
                <label>
                  Start time
                  <input
                    type="time"
                    required
                    readOnly={disabled}
                    value={schedule.start}
                    onChange={event => update({ start: event.target.value })}
                  />
                </label>
                <span className="time-to">to</span>
                <label>
                  End time
                  <input
                    type="time"
                    required
                    readOnly={disabled}
                    value={schedule.end}
                    onChange={event => update({ end: event.target.value })}
                  />
                </label>
              </div>
              <p className="field-hint">
                Times follow your device’s local timezone. Each window starts and ends on the same
                day.
              </p>
            </div>
          </fieldset>
        </section>
        <section className="content-panel">
          <div className="schedule-enable">
            <span className="large-line-icon">
              <Coffee size={23} />
            </span>
            <div>
              <h2>Leave room for a break</h2>
              <p>A little time to step away, every focus day.</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-label="Enable daily break"
                checked={schedule.breakEnabled}
                disabled={disabled}
                onChange={event => update({ breakEnabled: event.target.checked })}
              />
              <span />
            </label>
          </div>
          {schedule.breakEnabled && (
            <fieldset className="break-times">
              <legend className="sr-only">Break hours</legend>
              <div className="time-fields">
                <label>
                  Break starts
                  <input
                    type="time"
                    required
                    readOnly={disabled}
                    value={schedule.breakStart}
                    onChange={event => update({ breakStart: event.target.value })}
                  />
                </label>
                <span className="time-to">to</span>
                <label>
                  Break ends
                  <input
                    type="time"
                    required
                    readOnly={disabled}
                    value={schedule.breakEnd}
                    onChange={event => update({ breakEnd: event.target.value })}
                  />
                </label>
              </div>
            </fieldset>
          )}
        </section>
      </div>
      <p className="page-note">
        Keep Unhook running for scheduled focus. Your computer must be awake. On macOS and Linux, a
        system permission prompt may appear when blocking changes.
      </p>
    </>
  );
}
