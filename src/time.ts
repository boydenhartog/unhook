export function remainingFocusSeconds(endsAt: number, reportedSeconds: number, now: number): number {
  return Math.max(0, Math.min(reportedSeconds, Math.ceil((endsAt - now) / 1000)));
}
