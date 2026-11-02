import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareVersions,
  validateBundleMetadata,
  validateSignature,
  packagePlan,
  distributionXml,
  validatePinnedSignature,
  codeHashPins,
  preserveExistingDirectoryPermissions,
} from './package-macos.mjs';

describe('macOS installer release boundary', () => {
  it('compares numeric versions rather than lexicographic strings', () => {
    expect(compareVersions('0.10.0', '0.2.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1);
    expect(() => compareVersions('0.2.0-beta', '0.2.0')).toThrow();
  });
  it('rejects stale builds, unrelated bundles and an unsupported deployment target', () => {
    const good = {
      CFBundleIdentifier: 'org.unhook.desktop',
      CFBundleExecutable: 'unhook',
      CFBundleVersion: '0.2.0',
      CFBundleShortVersionString: '0.2.0',
      LSMinimumSystemVersion: '13.0',
    };
    expect(validateBundleMetadata(good, '0.2.0')).toBe('unhook');
    for (const invalid of [
      { CFBundleIdentifier: 'other.app' },
      { CFBundleVersion: '0.1.0' },
      { LSMinimumSystemVersion: '10.13' },
      { CFBundleExecutable: '../other' },
      { CFBundleExecutable: 'another-app' },
    ]) {
      expect(() => validateBundleMetadata({ ...good, ...invalid }, '0.2.0')).toThrow();
    }
  });
  it('requires Developer ID, expected identifier and hardened runtime', () => {
    const good =
      'Identifier=org.unhook.desktop\nflags=0x10000(runtime)\nAuthority=Developer ID Application: Example (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\n';
    expect(validateSignature(good, 'org.unhook.desktop')).toBe('ABCDEFGHIJ');
    for (const invalid of [
      good.replace('runtime', 'adhoc'),
      good.replace('Developer ID Application', 'Apple Development'),
      good.replace('org.unhook.desktop', 'other.app'),
      good.replace('ABCDEFGHIJ\n', 'not set\n'),
    ]) {
      expect(() => validateSignature(invalid, 'org.unhook.desktop')).toThrow();
    }
    expect(() => validateSignature(good, 'org.unhook.desktop', 'OTHER12345')).toThrow();
  });
  it('never emits an unsigned package under the public release filename or receipt', () => {
    expect(packagePlan('0.2.0', ['arm64'], false)).toEqual({
      filename: 'Unhook_0.2.0_arm64_INSTALLED_SERVICE.pkg',
      identifier: 'org.unhook.desktop.installer',
      architecture: 'arm64',
    });
    expect(packagePlan('0.2.0', ['x86_64', 'arm64'], true)).toEqual({
      filename: 'Unhook_0.2.0_universal_PRIVATE_BETA_UNSIGNED.pkg',
      identifier: 'org.unhook.desktop.installer.development',
      architecture: 'universal',
    });
    expect(() => packagePlan('0.2.0', ['i386'], false)).toThrow();
    expect(() => packagePlan('0.2.0', [], false)).toThrow();
  });
  it('accepts hardened ad-hoc code hashes and rejects unsafe entitlements', () => {
    const good =
      'Identifier=org.unhook.desktop\nflags=0x10002(adhoc,runtime)\nCDHash=' +
      'a'.repeat(40) +
      '\n';
    expect(validatePinnedSignature(good, 'org.unhook.desktop', {})).toBe('a'.repeat(40));
    for (const value of [
      good.replace('10002', '2'),
      good.replace('org.unhook.desktop', 'evil.app'),
      good.replace('a'.repeat(40), 'bad'),
    ])
      expect(() => validatePinnedSignature(value, 'org.unhook.desktop', {})).toThrow();
    for (const key of [
      'get-task-allow',
      'cs.disable-library-validation',
      'cs.allow-dyld-environment-variables',
      'cs.allow-jit',
      'cs.allow-unsigned-executable-memory',
      'cs.disable-executable-page-protection',
    ])
      expect(() =>
        validatePinnedSignature(good, 'org.unhook.desktop', {
          ['com.apple.security.' + key]: true,
        }),
      ).toThrow();
    expect(codeHashPins(['b'.repeat(40), 'a'.repeat(40)])).toBe(
      'a'.repeat(40) + '\n' + 'b'.repeat(40) + '\n',
    );
    expect(() => codeHashPins(['a'.repeat(40), 'a'.repeat(40)])).toThrow();
  });
  it('keeps existing directory permissions while retaining archive ownership metadata', () => {
    const input =
      '<pkg-info overwrite-permissions="true" auth="root"><payload numberOfFiles="2"/></pkg-info>';
    expect(preserveExistingDirectoryPermissions(input)).toBe(
      input.replace('overwrite-permissions="true"', 'overwrite-permissions="false"'),
    );
    expect(preserveExistingDirectoryPermissions(preserveExistingDirectoryPermissions(input))).toBe(
      input.replace('overwrite-permissions="true"', 'overwrite-permissions="false"'),
    );
    expect(() => preserveExistingDirectoryPermissions('<pkg-info auth="root"/>')).toThrow();
    expect(() =>
      preserveExistingDirectoryPermissions(
        '<pkg-info overwrite-permissions="false" overwrite-permissions="true"/>',
      ),
    ).toThrow();
  });
  it('limits Installer to macOS 13 and the supported fixed system destination', () => {
    const xml = distributionXml({
      version: '0.2.0',
      identifier: 'org.unhook.desktop.installer',
      architectures: ['arm64'],
      development: false,
    });
    expect(xml).toContain('hostArchitectures="arm64"');
    expect(xml).toContain('rootVolumeOnly="true"');
    expect(xml).toContain('enable_currentUserHome="false"');
    expect(xml).toContain('os-version min="13.0"');
    expect(() =>
      distributionXml({
        version: '0.2.0',
        identifier: '<untrusted>',
        architectures: ['arm64'],
        development: false,
      }),
    ).toThrow();
  });
});

describe.skipIf(process.platform === 'win32')(
  'installer lifecycle in an isolated filesystem',
  () => {
    function fixture(callback) {
      const folder = mkdtempSync(join(tmpdir(), 'unhook-install-test-'));
      try {
        const app = join(folder, 'Applications/Unhook.app');
        const library = join(folder, 'Library');
        const helper = join(library, 'PrivilegedHelperTools/org.unhook.installed-system-helper');
        const job = join(library, 'LaunchDaemons/org.unhook.installed-system-helper.plist');
        const pins = join(library, 'Application Support/Unhook/approved-code-hashes');
        for (const dir of [
          join(app, 'Contents/MacOS'),
          join(library, 'PrivilegedHelperTools'),
          join(library, 'LaunchDaemons'),
          join(library, 'Application Support/Unhook'),
        ])
          mkdirSync(dir, { recursive: true });
        writeFileSync(join(app, 'Contents/MacOS/unhook'), 'app');
        writeFileSync(
          join(app, 'Contents/Info.plist'),
          JSON.stringify({ CFBundleIdentifier: 'org.unhook.desktop', CFBundleVersion: '0.1.0' }),
        );
        writeFileSync(pins, 'a'.repeat(40) + '\n');
        writeFileSync(
          job,
          JSON.stringify({
            Label: 'org.unhook.installed-system-helper',
            ProgramArguments: [
              '/Library/PrivilegedHelperTools/org.unhook.installed-system-helper',
              '--installed',
            ],
            Sockets: {
              Control: { SockPathName: '/var/run/org.unhook.installed-system-helper.sock' },
            },
          }),
        );
        writeFileSync(
          helper,
          '#!/bin/sh\necho restore >> "' +
            folder +
            '/trace"\n[ ! -f "' +
            folder +
            '/restore-fail" ]\n',
          { mode: 0o755 },
        );
        const tool = join(folder, 'tool');
        writeFileSync(
          tool,
          `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const mode=process.argv[2],args=process.argv.slice(3);const root=__dirname;const marker=name=>fs.existsSync(path.join(root,name));const trace=s=>fs.appendFileSync(path.join(root,'trace'),s+'\\n');
if(mode==='os')console.log('13.0');
else if(mode==='app')process.exit(marker('app-running')?0:1);
else if(mode==='launch'){trace(args.join(' '));if(args[0]==='print')process.exit(marker(args[1].includes('installed-')?'installed-running':'embedded-running')?0:1);if(args[0]==='bootstrap'&&marker('bootstrap-fail'))process.exit(1);}
else if(mode==='stat'){const f=args.at(-1);console.log(args[1]==='%u'?'0':((marker('wrong-owner')&&f.endsWith('approved-code-hashes')?'501':'0')+' '+(fs.statSync(f).mode&511).toString(8)+' '+(marker('hardlink')&&f.endsWith('approved-code-hashes')?'2':'1')));}
else if(mode==='ls')console.log(marker('acl')?'permissions\\n 0: user:other allow write':'no ACL');
else if(mode==='find')console.log(marker('unsafe-tree')?'unsafe':'');
else if(mode==='lipo')console.log(marker('universal')?'arm64 x86_64':'arm64');
else if(mode==='signature'){if(args.includes('--verify'))process.exit(marker('invalid-signature')?1:0);if(args.includes('--entitlements')){if(marker('unsafe-entitlement'))console.log('entitlements');}else{const arch=args[args.indexOf('--arch')+1];console.error('Identifier='+ (args.at(-1).endsWith('Unhook.app')?'org.unhook.desktop':'org.unhook.system-helper')+'\\nflags=0x10002(adhoc,runtime)\\nTeamIdentifier=not set\\nCDHash='+(arch==='x86_64'?'b':'a').repeat(40));}}
else if(mode==='plist'){if(args[1].includes('com.apple.security.')){if(marker('unsafe-entitlement')&&args[1].endsWith('allow-jit'))console.log('true');else process.exit(1);}else {let value=JSON.parse(fs.readFileSync(args[2],'utf8'));for(const part of args[1].replace('Print :','').split(':'))value=value[part];console.log(value);}}
`,
          { mode: 0o755 },
        );
        const transform = source =>
          source
            .replaceAll('/Applications', join(folder, 'Applications'))
            .replaceAll('/Library', library)
            .replaceAll('/usr/bin/sw_vers', `${tool} os`)
            .replaceAll('/usr/bin/pgrep', `${tool} app`)
            .replaceAll('/bin/launchctl', `${tool} launch`)
            .replaceAll('/usr/bin/stat', `${tool} stat`)
            .replaceAll('/bin/ls', `${tool} ls`)
            .replaceAll('/usr/bin/find', `${tool} find`)
            .replaceAll('/usr/bin/codesign', `${tool} signature`)
            .replaceAll('/usr/bin/lipo', `${tool} lipo`)
            .replaceAll('/usr/libexec/PlistBuddy', `${tool} plist`)
            .replaceAll('@VERSION@', '0.2.0')
            .replaceAll('@TEAM@', 'ABCDEFGHIJ')
            .replaceAll('@DEVELOPMENT@', '1');
        // Only private script copies substitute fixed tools and paths. Production
        // installer scripts have no environment or runtime fixture bypass.
        for (const name of ['common.sh', 'preinstall', 'postinstall'])
          writeFileSync(
            join(folder, name),
            transform(readFileSync(new URL('./mac-pkg/' + name, import.meta.url), 'utf8')),
          );
        writeFileSync(job, readFileSync(job, 'utf8').replaceAll('/Library', library));
        const execute = (name = 'preinstall', volume = '/') =>
          spawnSync('/bin/sh', [join(folder, name), 'package', '/', volume], { encoding: 'utf8' });
        const mark = name => writeFileSync(join(folder, name), 'yes');
        const trace = () => readFileSync(join(folder, 'trace'), 'utf8');
        callback({ folder, app, library, helper, job, pins, execute, mark, trace });
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
    it('accepts an upgrade only after stopping and restoring the old helper', () =>
      fixture(({ execute, mark, trace }) => {
        mark('installed-running');
        expect(execute().status).toBe(0);
        expect(trace()).toContain('bootout system/org.unhook.installed-system-helper\nrestore');
      }));
    it('refuses running app, embedded-manager conflicts and failed restoration', () =>
      fixture(({ folder, execute, mark, trace }) => {
        mark('app-running');
        expect(execute().stderr).toContain('Quit Unhook');
        rmSync(join(folder, 'app-running'));
        mark('embedded-running');
        expect(execute().stderr).toContain('Remove system service');
        rmSync(join(folder, 'embedded-running'));
        mark('restore-fail');
        expect(execute().stderr).toContain('Could not restore');
        expect(trace()).toContain('bootstrap system');
      }));
    it('rejects unsafe service ownership, writable ancestors and symlink destinations before executing root code', () =>
      fixture(({ folder, library, helper, execute, mark }) => {
        mark('wrong-owner');
        expect(execute().stderr).toContain('owned by root');
        rmSync(join(folder, 'wrong-owner'));
        chmodSync(join(library, 'Application Support'), 0o777);
        expect(execute().stderr).toContain('not be writable');
        chmodSync(join(library, 'Application Support'), 0o755);
        mark('acl');
        expect(execute().stderr).toContain('unexpected ACLs');
        rmSync(join(folder, 'acl'));
        mark('hardlink');
        expect(execute().stderr).toContain('multiple hard links');
        rmSync(join(folder, 'hardlink'));
        rmSync(helper);
        symlinkSync(folder, helper);
        expect(execute().stderr).toContain('Symbolic link');
      }));
    it('rejects alternate disks, downgrades and unrelated app bundles', () =>
      fixture(({ app, execute }) => {
        expect(execute('preinstall', '/Volumes/Other').stderr).toContain('startup disk');
        writeFileSync(
          join(app, 'Contents/Info.plist'),
          JSON.stringify({ CFBundleIdentifier: 'org.unhook.desktop', CFBundleVersion: '0.3.0' }),
        );
        expect(execute().stderr).toContain('Downgrades');
        writeFileSync(
          join(app, 'Contents/Info.plist'),
          JSON.stringify({ CFBundleIdentifier: 'other.app', CFBundleVersion: '0.1.0' }),
        );
        expect(execute().stderr).toContain('different application');
      }));
    it(
      'verifies every architecture pin before bootstrapping and is safe to repeat',
      () =>
        fixture(({ pins, execute, mark, trace }) => {
          expect(execute('postinstall').status).toBe(0);
          expect(execute('postinstall').status).toBe(0);
          mark('universal');
          expect(execute('postinstall').stderr).toContain('differ from approved pins');
          writeFileSync(pins, 'a'.repeat(40) + '\n' + 'b'.repeat(40) + '\n');
          expect(execute('postinstall').status).toBe(0);
          expect(trace()).toContain('bootstrap system');
        }),
      15000,
    );
    it(
      'fails closed on malformed pins, unsafe code, writable app content and bootstrap failure',
      () =>
        fixture(({ pins, folder, execute, mark }) => {
          writeFileSync(pins, 'BAD\n');
          expect(execute('postinstall').stderr).toContain('Invalid approved');
          writeFileSync(pins, 'a'.repeat(40) + '\n');
          mark('unsafe-entitlement');
          expect(execute('postinstall').stderr).toContain('Unsafe executable entitlement');
          rmSync(join(folder, 'unsafe-entitlement'));
          mark('invalid-signature');
          expect(execute('postinstall').stderr).toContain('Invalid executable signature');
          rmSync(join(folder, 'invalid-signature'));
          mark('unsafe-tree');
          expect(execute('postinstall').stderr).toContain('unprotected files');
          rmSync(join(folder, 'unsafe-tree'));
          mark('bootstrap-fail');
          expect(execute('postinstall').stderr).toContain('Cannot load installed daemon');
        }),
      15000,
    );
  },
);

describe.skipIf(process.platform !== 'darwin')(
  'package archive metadata roundtrip without installation',
  () => {
    it('preserves root BOM metadata while disabling existing-directory permission replacement', () => {
      const folder = mkdtempSync(join(tmpdir(), 'unhook-pkg-metadata-test-'));
      try {
        const payload = join(folder, 'payload');
        mkdirSync(join(payload, 'Applications/Fixture.app'), { recursive: true });
        writeFileSync(join(payload, 'Applications/Fixture.app/file'), 'fixture', { mode: 0o644 });
        const original = join(folder, 'original.pkg');
        const rewritten = join(folder, 'rewritten.pkg');
        const expanded = join(folder, 'expanded');
        const checked = join(folder, 'checked');
        execFileSync('/usr/bin/pkgbuild', [
          '--root',
          payload,
          '--ownership',
          'recommended',
          '--identifier',
          'org.unhook.package-fixture',
          '--version',
          '1.0.0',
          '--install-location',
          '/',
          original,
        ]);
        execFileSync('/usr/sbin/pkgutil', ['--expand', original, expanded]);
        const metadata = join(expanded, 'PackageInfo');
        const bom = readFileSync(join(expanded, 'Bom'));
        const archive = readFileSync(join(expanded, 'Payload'));
        writeFileSync(
          metadata,
          preserveExistingDirectoryPermissions(readFileSync(metadata, 'utf8')),
        );
        execFileSync('/usr/sbin/pkgutil', ['--flatten', expanded, rewritten]);
        execFileSync('/usr/sbin/pkgutil', ['--expand', rewritten, checked]);
        const finalInfo = readFileSync(join(checked, 'PackageInfo'), 'utf8');
        expect(finalInfo).toContain('overwrite-permissions="false"');
        expect(finalInfo).toContain('auth="root"');
        expect(readFileSync(join(checked, 'Bom'))).toEqual(bom);
        expect(readFileSync(join(checked, 'Payload'))).toEqual(archive);
        const listing = execFileSync('/usr/bin/lsbom', [join(checked, 'Bom')], {
          encoding: 'utf8',
        });
        expect(listing).toMatch(/Fixture\.app\/file\s+100644\s+0\/0/);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  },
);
