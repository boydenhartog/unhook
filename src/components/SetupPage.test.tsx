import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../service';
import type { AppStatus, SetupStatus } from '../types';
import { FocusPage } from './FocusPage';
import { SetupPage } from './SetupPage';

const status = (active = false): AppStatus => ({
  settings: defaultSettings(),
  active,
  systemActive: false,
  source: active ? 'manual' : null,
  endsAt: active ? Date.now() + 60_000 : null,
  remainingSeconds: active ? 60 : 0,
  warning: null,
  error: null,
  hostsPath: '/etc/hosts',
});
const setup = (): SetupStatus => ({
  completed: false,
  browserConnected: false,
  extensionPath: '/example/browser-extension',
  extensionVersion: null,
  browserLastSeen: null,
  systemBlockingEnabled: false,
  system: { state: 'notInstalled', message: null },
  login: { state: 'disabled', message: null },
});
const noAction = () => {};
const renderSetup = (connection: SetupStatus, busy = false, preview = false) =>
  renderToStaticMarkup(
    <SetupPage
      setup={connection}
      busy={busy}
      preview={preview}
      firstRun={false}
      systemActive={false}
      restoreSystem={noAction}
      openBrowser={noAction}
      revealExtension={noAction}
      installSystem={noAction}
      openSystemSettings={noAction}
      setSystemBlocking={noAction}
      setLaunchAtLogin={noAction}
      uninstallSystem={noAction}
      finish={noAction}
    />,
  );
function renderFocus(connection: SetupStatus, active = false, preview = false) {
  return renderToStaticMarkup(
    <FocusPage
      status={status(active)}
      setup={connection}
      busy={false}
      preview={preview}
      start={noAction}
      stop={noAction}
      navigate={noAction}
    />,
  );
}

describe('blocking setup and launcher', () => {
  it('requires explicit unpacked installation and waits for acknowledgement', () => {
    const html = renderToStaticMarkup(
      <SetupPage
        setup={setup()}
        busy={false}
        preview={false}
        firstRun={true}
        systemActive={false}
        restoreSystem={noAction}
        openBrowser={noAction}
        revealExtension={noAction}
        installSystem={noAction}
        openSystemSettings={noAction}
        setSystemBlocking={noAction}
        setLaunchAtLogin={noAction}
        uninstallSystem={noAction}
        finish={noAction}
      />,
    );
    expect(html).toContain('Developer mode');
    expect(html).toContain('Load unpacked');
    expect(html).toContain('/example/browser-extension');
    expect(html).toContain('Waiting for the browser companion');
    expect(html).toContain('Set up later');
    expect(html).not.toContain('Browser companion connected');
  });
  it('makes legacy hosts recovery reachable during first-run setup', () => {
    const html = renderToStaticMarkup(
      <SetupPage
        setup={setup()}
        busy={false}
        preview={false}
        firstRun={true}
        systemActive={true}
        restoreSystem={noAction}
        openBrowser={noAction}
        revealExtension={noAction}
        installSystem={noAction}
        openSystemSettings={noAction}
        setSystemBlocking={noAction}
        setLaunchAtLogin={noAction}
        uninstallSystem={noAction}
        finish={noAction}
      />,
    );
    expect(html).toContain('Restore system access');
    expect(html).toContain('Your browser focus session keeps running.');
  });
  it('explains updates without requiring matching companion release numbers', () => {
    const html = renderSetup({ ...setup(), extensionVersion: '0.2.2' });
    expect(html).toContain('Compatible companion versions can differ from the bundled version.');
    expect(html).toContain('Update Unhook first');
    expect(html).not.toContain('Check that its version is');
  });
  it('prevents starting without a connection and keeps an active session stoppable', () => {
    const inactive = renderFocus(setup());
    expect(inactive).toMatch(/<button class="primary-button start-button " disabled=""/);
    const active = renderFocus(setup(), true);
    expect(active).toContain('Your timer is running, but website blocking is unavailable.');
    expect(active).toMatch(/<button class="primary-button start-button stop-button"(?! disabled)/);
    expect(active).toContain('End focus session');
  });
  it('allows connected browser, approved enabled system, and preview sessions', () => {
    for (const connection of [
      { ...setup(), browserConnected: true },
      {
        ...setup(),
        systemBlockingEnabled: true,
        system: { state: 'ready' as const, message: null },
      },
    ]) {
      expect(renderFocus(connection)).toMatch(
        /<button class="primary-button start-button "(?! disabled)/,
      );
    }
    expect(renderFocus(setup(), false, true)).toMatch(
      /<button class="primary-button start-button "(?! disabled)/,
    );
  });
  it('does not permit an enabled system service awaiting approval to imply coverage', () => {
    const html = renderFocus({
      ...setup(),
      systemBlockingEnabled: true,
      system: { state: 'requiresApproval', message: null },
    });
    expect(html).toMatch(/<button class="primary-button start-button " disabled=""/);
    expect(html).toContain('Connect your browser companion before starting a protected session.');
  });
  it('keeps password-based system blocking selectable without a signed helper', () => {
    const connection = {
      ...setup(),
      systemBlockingEnabled: true,
      system: {
        state: 'passwordRequired' as SetupStatus['system']['state'],
        message: 'Administrator permission is required when system blocking changes.',
      },
    };
    const html = renderToStaticMarkup(
      <SetupPage
        setup={connection}
        busy={false}
        preview={false}
        firstRun={false}
        systemActive={false}
        restoreSystem={noAction}
        openBrowser={noAction}
        revealExtension={noAction}
        installSystem={noAction}
        openSystemSettings={noAction}
        setSystemBlocking={noAction}
        setLaunchAtLogin={noAction}
        uninstallSystem={noAction}
        finish={noAction}
      />,
    );
    expect(html).toContain('Use system blocking');
    expect(html).toContain('Administrator permission is required');
    expect(html).not.toContain('System blocking unavailable');
    expect(html).not.toContain('macOS asks you to approve a small background service once');
    expect(renderFocus(connection)).toMatch(
      /<button class="primary-button start-button "(?! disabled)/,
    );
  });
});

describe('automatic scheduling setup', () => {
  it('shows the operating system login state without requiring system blocking', () => {
    const html = renderSetup({ ...setup(), login: { state: 'enabled', message: null } });
    expect(html).toContain('Launch Unhook at login');
    expect(html).toMatch(/aria-label="Launch Unhook at login"[^>]*checked=""/);
    expect(html).toContain('Schedules run while Unhook is open');
  });
  it('keeps a login request awaiting macOS approval separate from enabled', () => {
    const html = renderSetup({ ...setup(), login: { state: 'requiresApproval', message: null } });
    expect(html).toContain('Launch at login needs approval');
    expect(html).toContain('Cancel login request');
    expect(html).toMatch(/aria-label="Launch Unhook at login"[^>]*disabled=""/);
    expect(html).toContain('Open System Settings');
    expect(html).not.toMatch(/aria-label="Launch Unhook at login"[^>]*checked=""/);
  });
  it('disables login changes while busy, in preview, and when unsupported', () => {
    for (const html of [
      renderSetup(setup(), true),
      renderSetup(setup(), false, true),
      renderSetup({ ...setup(), login: { state: 'unsupported', message: null } }),
    ]) {
      expect(html).toMatch(/aria-label="Launch Unhook at login"[^>]*disabled=""/);
    }
  });
  it('distinguishes installed and approved services and offers service removal', () => {
    const approved = renderSetup({ ...setup(), system: { state: 'ready', message: null } });
    expect(approved).toContain('System service connected');
    expect(approved).toContain('Remove system service');
    expect(approved).toContain('Browser focus keeps running');
    const pending = renderSetup({
      ...setup(),
      system: { state: 'requiresApproval', message: null },
    });
    expect(pending).toContain('Waiting for macOS approval');
    expect(pending).toContain('Remove system service');
    expect(pending).not.toContain('Use system blocking');
  });
  it('allows cleanup of a registered service that is no longer reachable', () => {
    const html = renderSetup({
      ...setup(),
      system: { state: 'unavailable', registered: true, message: 'Service is not reachable.' },
    });
    expect(html).toContain('Remove system service');
    expect(html).not.toContain('Use system blocking');
  });
  it('does not offer service removal for the unsigned password fallback', () => {
    const html = renderSetup({ ...setup(), system: { state: 'passwordRequired', message: null } });
    expect(html).not.toContain('Remove system service');
    expect(html).not.toContain('without daily password prompts');
  });
});

describe('package-installed system blocking', () => {
  it('shows connected installer service without another service registration', () => {
    const html = renderSetup({
      ...setup(),
      system: { state: 'ready', management: 'installer', registered: true, message: null },
    });
    expect(html).toContain('Installed by the Unhook package');
    expect(html).toContain('administrator permission during installation');
    expect(html).not.toContain('Enable system service');
    expect(html).not.toContain('then approve it');
    expect(html).toContain('Reinstall the Unhook package');
  });
  it('explains installed service recovery without implying a password fallback', () => {
    const connection: SetupStatus = {
      ...setup(),
      system: { state: 'unavailable', management: 'installer', registered: true, message: null },
    };
    const html = renderToStaticMarkup(
      <SetupPage
        setup={connection}
        busy={false}
        preview={false}
        firstRun={false}
        systemActive={true}
        restoreSystem={noAction}
        openBrowser={noAction}
        revealExtension={noAction}
        installSystem={noAction}
        openSystemSettings={noAction}
        setSystemBlocking={noAction}
        setLaunchAtLogin={noAction}
        uninstallSystem={noAction}
        finish={noAction}
      />,
    );
    expect(html).toContain('Restore uses the installed service.');
    expect(html).not.toContain('macOS may ask for your password once.');
  });
  it('offers package repair without password fallback when installed service fails', () => {
    const html = renderSetup({
      ...setup(),
      system: {
        state: 'unavailable',
        management: 'installer',
        registered: true,
        message: 'Reinstall the Unhook package to repair the system service.',
      },
    });
    expect(html).toContain('Reinstall the Unhook package');
    expect(html).not.toContain('Use system blocking');
    expect(html).not.toContain('Enable system service');
    expect(html).not.toContain('Enable and approve the service again');
    expect(html).toContain('Open System Settings');
  });
});
