import type { Schedule } from './types';

export const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function scheduleSummary(schedule: Schedule): string {
  const days =
    schedule.days.length === 5 && schedule.days.every((day, index) => day === index)
      ? 'Monday–Friday'
      : schedule.days.map(day => dayNames[day]).join(', ');
  return `${days} · ${schedule.start}–${schedule.end}`;
}

export function remainingFocusSeconds(
  endsAt: number,
  reportedSeconds: number,
  now: number,
): number {
  return Math.max(0, Math.min(reportedSeconds, Math.ceil((endsAt - now) / 1000)));
}
