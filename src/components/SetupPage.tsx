import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ExternalLink,
  FolderOpen,
  Globe2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { SetupStatus, SupportedBrowser } from '../types';

type Props = {
  setup: SetupStatus;
  busy: boolean;
  preview: boolean;
  firstRun: boolean;
  systemActive: boolean;
  openBrowser: (browser: SupportedBrowser) => void;
  revealExtension: () => void;
  installSystem: () => void;
  openSystemSettings: () => void;
  setSystemBlocking: (enabled: boolean) => void;
  finish: () => void;
  setLaunchAtLogin: (enabled: boolean) => void;
  uninstallSystem: () => void;
  restoreSystem: () => void;
};

function BrowserSetup({
  setup,
  busy,
  preview,
  openBrowser,
  revealExtension,
}: Pick<Props, 'setup' | 'busy' | 'preview' | 'openBrowser' | 'revealExtension'>) {
  const [browser, setBrowser] = useState<SupportedBrowser>('brave');
  return (
    <section className="content-panel setup-panel" aria-labelledby="browser-setup-title">
      <div className="setup-panel-heading">
        <span className="large-line-icon">
          <Globe2 size={22} />
        </span>
        <div>
          <h2 id="browser-setup-title">Connect your browser</h2>
          <p>Unhook keeps the controls. Its companion blocks websites in your browser.</p>
        </div>
      </div>
      <div className="browser-choices" role="group" aria-label="Browser">
        {(['brave', 'chrome'] as const).map(value => (
          <button
            className={browser === value ? 'selected' : ''}
            aria-pressed={browser === value}
            key={value}
            disabled={busy}
            onClick={() => setBrowser(value)}
          >
            {value === 'brave' ? 'Brave' : 'Chrome'}
          </button>
        ))}
      </div>
      <ol className="setup-instructions">
        <li>
          <span>
            Open your browser’s extensions page and turn on <strong>Developer mode</strong>.
          </span>
        </li>
        <li>
          <span>
            Choose <strong>Load unpacked</strong>, then select the Unhook companion folder below.
          </span>
        </li>
        <li>
          <span>Keep Unhook open. This screen confirms when the companion connects.</span>
        </li>
      </ol>
      {setup.extensionPath && (
        <div className="extension-folder">
          <span>Unhook companion folder</span>
          <code>{setup.extensionPath}</code>
        </div>
      )}
      <div className="setup-actions">
        <button
          className="primary-button"
          disabled={busy || preview}
          onClick={() => openBrowser(browser)}
        >
          Open {browser === 'brave' ? 'Brave' : 'Chrome'} setup <ExternalLink size={15} />
        </button>
        <button
          className="secondary-button"
          disabled={busy || preview || !setup.extensionPath}
          onClick={revealExtension}
        >
          <FolderOpen size={15} />
          Show folder
        </button>
      </div>
      <div
        className={`setup-connection ${setup.browserConnected ? 'connected' : ''}`}
        role="status"
      >
        {setup.browserConnected ? <Check size={17} /> : <span className="status-dot" />}
        <div>
          <strong>
            {setup.browserConnected
              ? 'Browser companion connected'
              : preview
                ? 'Desktop setup required'
                : 'Waiting for the browser companion'}
          </strong>
          <p>
            {setup.browserConnected
              ? `Your browser is ready to follow Unhook’s blocklist${setup.extensionVersion ? ` · v${setup.extensionVersion}` : ''}.`
              : preview
                ? 'Installation and connection checks are available in the desktop app.'
                : 'Compatible companion versions can differ from the bundled version. Update Unhook first, then reload the companion. If it still cannot connect, use Load unpacked with the folder above.'}
          </p>
        </div>
      </div>
      <p className="setup-note">
        No administrator password is needed for browser blocking. Repeat these steps for each
        browser profile you use, and check Connected in that profile’s companion popup.
      </p>
    </section>
  );
}

function SystemSetup({
  setup,
  busy,
  preview,
  installSystem,
  openSystemSettings,
  setSystemBlocking,
  uninstallSystem,
}: Pick<
  Props,
  | 'setup'
  | 'busy'
  | 'preview'
  | 'installSystem'
  | 'openSystemSettings'
  | 'setSystemBlocking'
  | 'uninstallSystem'
>) {
  const state = setup.system.state;
  const passwordRequired = state === 'passwordRequired';
  const installerManaged = setup.system.management === 'installer';
  const registered =
    setup.system.registered === true || state === 'ready' || state === 'requiresApproval';
  return (
    <section className="content-panel setup-panel" aria-labelledby="system-setup-title">
      <div className="setup-panel-heading">
        <span className="large-line-icon">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id="system-setup-title">
            Add system blocking <span className="optional-label">Optional</span>
          </h2>
          <p>Also block listed domains through your system’s hosts file.</p>
        </div>
      </div>
      {installerManaged ? (
        <p className="system-explanation">
          Installed by the Unhook package with administrator permission during installation. Once
          connected, ordinary focus and schedule changes need no additional password. macOS may
          still require installation or background approvals.
        </p>
      ) : passwordRequired ? (
        <p className="system-explanation">
          This build uses the existing administrator password prompt for system blocking. Starting,
          stopping, scheduled changes and quitting may ask for permission. Browser-only blocking
          needs no password.
        </p>
      ) : (
        state !== 'unsupported' && (
          <p className="system-explanation">
            Enable this signed build’s background service here, then approve it in System Settings
            if macOS asks. You can also install the Unhook package with administrator permission.
            Once the service connects, schedules can change system blocking without daily password
            prompts.
          </p>
        )
      )}
      <div className={`setup-connection ${state === 'ready' ? 'connected' : ''}`} role="status">
        {state === 'ready' ? <Check size={17} /> : <span className="status-dot" />}
        <div>
          <strong>
            {state === 'ready'
              ? 'System service connected'
              : passwordRequired
                ? 'System blocking available · password required'
                : state === 'requiresApproval'
                  ? 'Waiting for macOS approval'
                  : state === 'notInstalled'
                    ? 'System service is not installed'
                    : 'System blocking unavailable'}
          </strong>
          <p>
            {setup.system.message ||
              (state === 'ready'
                ? 'Choose whether to use system blocking during focus sessions.'
                : state === 'requiresApproval'
                  ? 'Approve Unhook in System Settings → General → Login Items & Extensions.'
                  : 'Browser blocking is ready to use without this step.')}
          </p>
        </div>
      </div>
      {state === 'notInstalled' && !installerManaged && (
        <button className="secondary-button" disabled={busy || preview} onClick={installSystem}>
          Enable system service <ArrowRight size={15} />
        </button>
      )}
      {(state === 'requiresApproval' || (installerManaged && state === 'unavailable')) && (
        <button className="primary-button" disabled={busy || preview} onClick={openSystemSettings}>
          Open System Settings <ExternalLink size={15} />
        </button>
      )}
      {(state === 'ready' || passwordRequired) && (
        <label className="system-toggle">
          <span>
            <strong>Use system blocking</strong>
            <span>Apply the hosts file blocklist during focus sessions.</span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={setup.systemBlockingEnabled}
              disabled={busy || preview}
              onChange={event => setSystemBlocking(event.target.checked)}
            />
            <span />
          </span>
        </label>
      )}
      {registered && (
        <div className="system-service-removal">
          <p className="setup-note">
            Removing the service restores Unhook’s system entries and turns off system blocking.
            Browser focus keeps running.{' '}
            {installerManaged
              ? 'Reinstall the Unhook package to resume system blocking.'
              : 'Enable and approve the service again to resume system blocking.'}
          </p>
          <button className="text-button" disabled={busy || preview} onClick={uninstallSystem}>
            Remove system service
          </button>
        </div>
      )}
      <p className="setup-note">
        Browser blocking remains controlled by Unhook. System blocking adds coverage for other apps;
        browsers can still keep their own caches.
      </p>
    </section>
  );
}

function LoginSetup({
  setup,
  busy,
  preview,
  setLaunchAtLogin,
  openSystemSettings,
}: Pick<Props, 'setup' | 'busy' | 'preview' | 'setLaunchAtLogin' | 'openSystemSettings'>) {
  const state = setup.login.state;
  const available = state === 'enabled' || state === 'disabled';
  return (
    <section className="content-panel setup-panel" aria-labelledby="login-setup-title">
      <div className="setup-panel-heading">
        <div>
          <h2 id="login-setup-title">Keep your schedule running</h2>
          <p>
            Schedules run while Unhook is open and your Mac is awake. Launch it automatically when
            you sign in.
          </p>
        </div>
      </div>
      <label className="system-toggle">
        <span>
          <strong>Launch Unhook at login</strong>
          <span>Keep Unhook in the menu bar after you sign in.</span>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            aria-label="Launch Unhook at login"
            checked={state === 'enabled'}
            disabled={busy || preview || !available}
            onChange={event => setLaunchAtLogin(event.target.checked)}
          />
          <span />
        </span>
      </label>
      {state === 'requiresApproval' && (
        <div className="setup-connection" role="status">
          <span className="status-dot" />
          <div>
            <strong>Launch at login needs approval</strong>
            <p>
              {setup.login.message ||
                'Allow Unhook in System Settings → General → Login Items & Extensions. It will show as enabled after macOS approval.'}
            </p>
            <div className="setup-actions">
              <button
                className="secondary-button"
                disabled={busy || preview}
                onClick={openSystemSettings}
              >
                Open System Settings <ExternalLink size={15} />
              </button>
              <button
                className="text-button"
                disabled={busy || preview}
                onClick={() => setLaunchAtLogin(false)}
              >
                Cancel login request
              </button>
            </div>
          </div>
        </div>
      )}
      {(state === 'unsupported' || state === 'unavailable') && (
        <p className="setup-note" role="status">
          {setup.login.message ||
            'Launch at login is unavailable on this device. Open Unhook before your scheduled focus hours.'}
        </p>
      )}
    </section>
  );
}

export function SetupPage(props: Props) {
  const [step, setStep] = useState<'browser' | 'system'>('browser');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const { setup, busy, firstRun, finish } = props;
  return (
    <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">{firstRun ? 'A QUICK START' : 'YOUR BLOCKING CONNECTIONS'}</div>
          <h1 ref={heading} tabIndex={-1}>
            {firstRun ? 'Set up Unhook' : 'Blocking setup'}
          </h1>
          <p>
            {firstRun
              ? 'Connect your browser once. Start and stop focus here.'
              : 'Connect another browser or manage system blocking.'}
          </p>
        </div>
      </header>
      {firstRun && (
        <div
          className="setup-progress"
          aria-label={`Setup step ${step === 'browser' ? 1 : 2} of 2`}
        >
          <span className={step === 'browser' ? 'current' : 'done'}>1 · Browser</span>
          <span className={step === 'system' ? 'current' : ''}>2 · System (optional)</span>
        </div>
      )}
      {props.systemActive && !setup.systemBlockingEnabled && (
        <section className="content-panel recovery-panel">
          <div>
            <h2>Restore previous system entries</h2>
            <p>
              Unhook still has hosts file entries from an earlier session. Remove them to use
              browser blocking only.{' '}
              {setup.system.management === 'installer'
                ? 'Restore uses the installed service. If it is unavailable, repair the package or approve the service first.'
                : 'macOS may ask for your password once.'}{' '}
              Your browser focus session keeps running.
            </p>
          </div>
          <button className="secondary-button" disabled={busy} onClick={props.restoreSystem}>
            <RotateCcw size={16} />
            Restore system access
          </button>
        </section>
      )}
      {(!firstRun || step === 'browser') && <BrowserSetup {...props} />}
      {(!firstRun || step === 'system') && (
        <>
          <SystemSetup {...props} />
          <LoginSetup {...props} />
        </>
      )}
      {firstRun && (
        <div className="setup-footer">
          {step === 'browser' ? (
            <>
              <span>You can return to Setup whenever you need.</span>
              <button
                className={setup.browserConnected ? 'primary-button' : 'secondary-button'}
                disabled={busy}
                onClick={() => setStep('system')}
              >
                {setup.browserConnected ? 'Continue' : 'Set up later'}
                <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <>
              <button className="text-button" disabled={busy} onClick={() => setStep('browser')}>
                Back to browser setup
              </button>
              <button className="primary-button" disabled={busy} onClick={finish}>
                {busy ? 'Saving…' : 'Finish setup'}
                <ArrowRight size={15} />
              </button>
            </>
          )}
        </div>
      )}
      {!firstRun && (
        <button className="text-button" disabled={busy} onClick={finish}>
          Back to focus <ArrowRight size={14} />
        </button>
      )}
    </>
  );
}
