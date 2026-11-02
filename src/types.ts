export type Schedule = {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
  breakEnabled: boolean;
  breakStart: string;
  breakEnd: string;
};
export type Settings = { domains: string[]; schedule: Schedule };
export type AppStatus = {
  settings: Settings;
  active: boolean;
  systemActive: boolean;
  source: 'manual' | 'schedule' | null;
  endsAt: number | null;
  remainingSeconds: number;
  warning: string | null;
  error: string | null;
  hostsPath: string;
};
export type SetupStatus = {
  completed: boolean;
  browserConnected: boolean;
  extensionPath: string | null;
  extensionVersion: string | null;
  browserLastSeen: number | null;
  systemBlockingEnabled: boolean;
  system: {
    state:
      | 'unsupported'
      | 'unavailable'
      | 'notInstalled'
      | 'requiresApproval'
      | 'ready'
      | 'passwordRequired';
    message: string | null;
    registered?: boolean;
    // Older preview records and callers may omit this additive native field.
    management?: 'installer' | 'embedded' | 'password' | 'unsupported';
  };
  login: {
    state: 'enabled' | 'disabled' | 'requiresApproval' | 'unsupported' | 'unavailable';
    message: string | null;
  };
};
export type SupportedBrowser = 'brave' | 'chrome';
export type FocusService = {
  preview: boolean;
  getStatus(): Promise<AppStatus>;
  saveSettings(settings: Settings): Promise<AppStatus>;
  startFocus(minutes: number): Promise<AppStatus>;
  stopFocus(): Promise<AppStatus>;
  restoreHosts(): Promise<AppStatus>;
  getSetupStatus(): Promise<SetupStatus>;
  openBrowserSetup(browser: SupportedBrowser): Promise<SetupStatus>;
  revealExtension(): Promise<void>;
  completeSetup(): Promise<SetupStatus>;
  installSystemBlocker(): Promise<SetupStatus>;
  uninstallSystemBlocker(): Promise<SetupStatus>;
  setLaunchAtLogin(enabled: boolean): Promise<SetupStatus>;
  openSystemSettings(): Promise<void>;
  setSystemBlocking(enabled: boolean): Promise<AppStatus>;
};
