import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AppStatus, FocusService, Schedule, Settings, SetupStatus } from './types';

export const defaultSettings = (): Settings => ({
  domains: ['youtube.com', 'facebook.com', 'instagram.com', 'reddit.com', 'x.com'],
  schedule: {
    enabled: false,
    days: [0, 1, 2, 3, 4],
    start: '09:00',
    end: '17:00',
    breakEnabled: true,
    breakStart: '12:30',
    breakEnd: '13:00',
  },
});

export function normalizeDomain(input: string): string {
  const text = input.trim();
  if (!text || /[\s\\*\x00-\x1f\x7f]/.test(text))
    throw new Error('Enter a domain or website URL, such as youtube.com.');
  let domain = text.endsWith('/') ? text.slice(0, -1) : text;
  if (text.includes('://')) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error('That website address is not valid.');
    }
    const authority = text.split('://')[1].split(/[/?#]/)[0];
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      /[:@]/.test(authority)
    ) {
      throw new Error('Use an HTTP or HTTPS website without a port or sign-in details.');
    }
    domain = url.hostname;
  }
  domain = domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.+$/, '');
  const labels = domain.split('.');
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    domain.endsWith('.local') ||
    domain.endsWith('.localhost') ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^[0-9]+$/.test(labels.at(-1)!)
  ) {
    throw new Error(
      'Enter a public domain, such as reddit.com. IP addresses and local hostnames are not supported.',
    );
  }
  return domain;
}

function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use valid times in HH:mm format.');
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}
export function validateSchedule(schedule: Schedule): void {
  if (
    !schedule.days.length ||
    schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(schedule.days).size !== schedule.days.length
  )
    throw new Error('Choose at least one day for your schedule.');
  const start = minutes(schedule.start),
    end = minutes(schedule.end);
  if (start >= end)
    throw new Error('The end time must be later than the start time on the same day.');
  if (schedule.breakEnabled) {
    const breakStart = minutes(schedule.breakStart),
      breakEnd = minutes(schedule.breakEnd);
    if (breakStart <= start || breakEnd >= end || breakStart >= breakEnd)
      throw new Error('The break must fit inside your focus hours, with its end after its start.');
  }
}

function validated(settings: Settings): Settings {
  validateSchedule(settings.schedule);
  if (settings.domains.length > 500)
    throw new Error('Your blocklist can contain up to 500 websites.');
  const domains = settings.domains.map(normalizeDomain);
  if (new Set(domains).size !== domains.length)
    throw new Error('That website is already in your blocklist.');
  return { domains, schedule: { ...settings.schedule, days: [...settings.schedule.days] } };
}

export function scheduleWindow(
  schedule: Schedule,
  timestamp: number,
): { end: number; activeUntil: number | null } | null {
  if (!schedule.enabled) return null;
  const date = new Date(timestamp),
    day = (date.getDay() + 6) % 7;
  if (!schedule.days.includes(day)) return null;
  const at = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).getTime();
  };
  const start = at(schedule.start),
    end = at(schedule.end);
  if (timestamp < start || timestamp >= end) return null;
  if (!schedule.breakEnabled) return { end, activeUntil: end };
  const breakStart = at(schedule.breakStart),
    breakEnd = at(schedule.breakEnd);
  return {
    end,
    activeUntil:
      timestamp >= breakStart && timestamp < breakEnd
        ? null
        : timestamp < breakStart
          ? breakStart
          : end,
  };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type PreviewState = {
  settings: Settings;
  manualEndsAt: number | null;
  suppressedUntil: number | null;
  setupCompleted: boolean;
};
const storageKey = 'unhook.preview.v1';
export function createPreviewService(storage: Storage, now = () => Date.now()): FocusService {
  let state: PreviewState = {
    settings: defaultSettings(),
    manualEndsAt: null,
    suppressedUntil: null,
    setupCompleted: false,
  };
  try {
    const saved = storage.getItem(storageKey);
    if (saved) {
      const candidate = JSON.parse(saved) as PreviewState;
      state = {
        settings: validated(candidate.settings),
        manualEndsAt: Number.isFinite(candidate.manualEndsAt) ? candidate.manualEndsAt : null,
        suppressedUntil: Number.isFinite(candidate.suppressedUntil)
          ? candidate.suppressedUntil
          : null,
        setupCompleted: candidate.setupCompleted === true,
      };
    }
  } catch {
    /* A malformed preview record starts with safe defaults. */
  }
  const persist = (next: PreviewState) => {
    storage.setItem(storageKey, JSON.stringify(next));
    state = next;
  };
  const status = (): AppStatus => {
    const timestamp = now(),
      window = scheduleWindow(state.settings.schedule, timestamp);
    const manual = state.manualEndsAt !== null && state.manualEndsAt > timestamp;
    const scheduledEnd = window?.activeUntil ?? null;
    const scheduled =
      scheduledEnd !== null &&
      !(state.suppressedUntil !== null && state.suppressedUntil > timestamp);
    const endsAt = manual ? state.manualEndsAt : scheduled ? scheduledEnd : null;
    return {
      settings: structuredClone(state.settings),
      active: endsAt !== null,
      systemActive: false,
      source: manual ? 'manual' : scheduled ? 'schedule' : null,
      endsAt,
      remainingSeconds: endsAt === null ? 0 : Math.ceil((endsAt - timestamp) / 1000),
      warning: null,
      error: null,
      hostsPath: 'Browser preview · no system files are modified',
    };
  };
  const setup = (): SetupStatus => ({
    completed: state.setupCompleted,
    browserConnected: false,
    extensionPath: null,
    extensionVersion: null,
    browserLastSeen: null,
    systemBlockingEnabled: false,
    system: {
      state: 'unavailable',
      management: 'unsupported',
      registered: false,
      message:
        'Setup is available in the desktop app. This preview does not install browser extensions or system services.',
    },
    login: { state: 'unavailable', message: 'Launch at login is available in the desktop app.' },
  });
  const stop = async () => {
    const window = scheduleWindow(state.settings.schedule, now());
    persist({
      ...state,
      manualEndsAt: null,
      suppressedUntil: window ? window.end : state.suppressedUntil,
    });
    return status();
  };
  return {
    preview: true,
    getStatus: async () => status(),
    saveSettings: async settings => {
      const next = validated(settings);
      if (!next.domains.length && state.manualEndsAt !== null && state.manualEndsAt > now())
        throw new Error('Stop focus before removing the final website.');
      const scheduleChanged =
        JSON.stringify(next.schedule) !== JSON.stringify(state.settings.schedule);
      persist({
        ...state,
        settings: next,
        suppressedUntil: scheduleChanged ? null : state.suppressedUntil,
      });
      return status();
    },
    startFocus: async duration => {
      if (!Number.isInteger(duration) || duration < 1 || duration > 1440)
        throw new Error('Choose a focus duration between 1 and 1,440 minutes.');
      if (!state.settings.domains.length)
        throw new Error('Add a website to your blocklist before starting focus.');
      persist({ ...state, manualEndsAt: now() + duration * 60_000 });
      return status();
    },
    stopFocus: stop,
    restoreHosts: async () => status(),
    getSetupStatus: async () => setup(),
    openBrowserSetup: async () => setup(),
    revealExtension: async () => {},
    completeSetup: async () => {
      persist({ ...state, setupCompleted: true });
      return setup();
    },
    installSystemBlocker: async () => setup(),
    uninstallSystemBlocker: async () => {
      throw new Error('System service removal is available in the desktop app.');
    },
    setLaunchAtLogin: async () => {
      throw new Error('Launch at login is available in the desktop app.');
    },
    openSystemSettings: async () => {},
    setSystemBlocking: async enabled => {
      if (enabled) throw new Error('System blocking is available in the desktop app.');
      return status();
    },
  };
}

export function createService(): FocusService {
  if (!isTauri()) return createPreviewService(localStorage);
  return {
    preview: false,
    getStatus: () => invoke<AppStatus>('get_status'),
    saveSettings: settings => invoke<AppStatus>('save_settings', { settings }),
    startFocus: minutes => invoke<AppStatus>('start_focus', { minutes }),
    stopFocus: () => invoke<AppStatus>('stop_focus'),
    restoreHosts: () => invoke<AppStatus>('restore_hosts'),
    getSetupStatus: () => invoke<SetupStatus>('get_setup_status'),
    openBrowserSetup: browser => invoke<SetupStatus>('open_browser_setup', { browser }),
    revealExtension: () => invoke<void>('reveal_extension'),
    completeSetup: () => invoke<SetupStatus>('complete_setup'),
    installSystemBlocker: () => invoke<SetupStatus>('install_system_blocker'),
    uninstallSystemBlocker: () => invoke<SetupStatus>('uninstall_system_blocker'),
    setLaunchAtLogin: enabled => invoke<SetupStatus>('set_launch_at_login', { enabled }),
    openSystemSettings: () => invoke<void>('open_system_settings'),
    setSystemBlocking: enabled => invoke<AppStatus>('set_system_blocking', { enabled }),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Unhook could not complete that change. Please try again.';
}
