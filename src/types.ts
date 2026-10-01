export type Schedule = {
  enabled: boolean; days: number[]; start: string; end: string;
  breakEnabled: boolean; breakStart: string; breakEnd: string;
};
export type Settings = { domains: string[]; schedule: Schedule };
export type AppStatus = {
  settings: Settings; active: boolean; source: 'manual' | 'schedule' | null;
  endsAt: number | null; remainingSeconds: number; warning: string | null;
  error: string | null; hostsPath: string;
};
export type FocusService = {
  preview: boolean;
  getStatus(): Promise<AppStatus>;
  saveSettings(settings: Settings): Promise<AppStatus>;
  startFocus(minutes: number): Promise<AppStatus>;
  stopFocus(): Promise<AppStatus>;
  restoreHosts(): Promise<AppStatus>;
};
