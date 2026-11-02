import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appId = 'org.unhook.desktop';
const helperId = 'org.unhook.system-helper';
const installedLabel = 'org.unhook.installed-system-helper';
const unsafeEntitlements = [
  'com.apple.security.get-task-allow',
  ...[
    'disable-library-validation',
    'allow-dyld-environment-variables',
    'allow-jit',
    'allow-unsigned-executable-memory',
    'disable-executable-page-protection',
  ].map(key => `com.apple.security.cs.${key}`),
];
const developerRequirement =
  'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists';

function numericVersion(value) {
  if (
    !/^\d+\.\d+\.\d+$/.test(value) ||
    value.split('.').some(part => !Number.isSafeInteger(Number(part)))
  )
    throw new Error('Use a numeric major.minor.patch package version.');
  return value.split('.').map(Number);
}

export function compareVersions(a, b) {
  const left = numericVersion(a),
    right = numericVersion(b);
  for (let index = 0; index < 3; index++)
    if (left[index] !== right[index]) return Math.sign(left[index] - right[index]);
  return 0;
}

export function validateBundleMetadata(info, version) {
  numericVersion(version);
  if (info.CFBundleIdentifier !== appId) throw new Error('Expected the Unhook desktop bundle.');
  if (info.CFBundleVersion !== version || info.CFBundleShortVersionString !== version)
    throw new Error('App version differs from package.json; build a fresh app.');
  if (
    !/^\d+(?:\.\d+){0,2}$/.test(info.LSMinimumSystemVersion || '') ||
    Number(info.LSMinimumSystemVersion.split('.')[0]) < 13
  )
    throw new Error('The package requires an app built for macOS 13 or later.');
  if (info.CFBundleExecutable !== 'unhook')
    throw new Error('Expected the Unhook main executable name.');
  return info.CFBundleExecutable;
}

export function validateSignature(display, identifier, expectedTeam) {
  const team = display.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1];
  const flags = display.match(/flags=0x([0-9a-f]+)\(([^\n]*)\)/);
  if (
    !team ||
    !/^Authority=Developer ID Application: /m.test(display) ||
    !flags ||
    (parseInt(flags[1], 16) & 0x10000) === 0 ||
    !/\bruntime\b/.test(flags[2])
  )
    throw new Error(
      'Public packages require Developer ID Application signatures and hardened runtime.',
    );
  if (identifier && display.match(/^Identifier=(.+)$/m)?.[1] !== identifier)
    throw new Error('Unexpected signed executable identifier.');
  if (expectedTeam && team !== expectedTeam)
    throw new Error('All executable signatures must have the same Developer ID team.');
  return team;
}

export function validatePinnedSignature(display, identifier, entitlements) {
  const flags = display.match(/flags=0x([0-9a-f]+)\(([^\n]*)\)/);
  const hash = display.match(/^CDHash=([0-9a-f]{40})$/m)?.[1];
  if (
    !flags ||
    !(parseInt(flags[1], 16) & 0x10000) ||
    !/\bruntime\b/.test(flags[2]) ||
    !hash ||
    (identifier && display.match(/^Identifier=(.+)$/m)?.[1] !== identifier)
  )
    throw new Error(
      'Installed executables require valid code hashes, expected identifiers and hardened runtime.',
    );
  if (unsafeEntitlements.some(key => entitlements[key] === true))
    throw new Error('Unsafe release entitlements are enabled.');
  return hash;
}

export function codeHashPins(hashes) {
  if (
    !hashes.length ||
    hashes.length > 16 ||
    hashes.some(hash => !/^[0-9a-f]{40}$/.test(hash)) ||
    new Set(hashes).size !== hashes.length
  )
    throw new Error('Invalid or duplicate approved executable code hashes.');
  return [...hashes].sort().join('\n') + '\n';
}

export function preserveExistingDirectoryPermissions(info) {
  const header = info.match(/<pkg-info\s[^>]*>/)?.[0];
  if (
    !header ||
    (header.match(/\boverwrite-permissions=/g) || []).length !== 1 ||
    !/\boverwrite-permissions="(?:true|false)"/.test(header)
  )
    throw new Error('Expected exactly one supported package directory-permissions attribute.');
  return info.replace(
    header,
    header.replace(/\boverwrite-permissions="(?:true|false)"/, 'overwrite-permissions="false"'),
  );
}

function inspectSignature(path, arch, identifier) {
  const display = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', '--arch', arch, path], {
    encoding: 'utf8',
  });
  const entitlements = spawnSync(
    '/usr/bin/codesign',
    ['-d', '--entitlements', ':-', '--arch', arch, path],
    { encoding: 'utf8' },
  );
  if (display.status !== 0 || entitlements.status !== 0)
    throw new Error('Cannot inspect executable signature.');
  const values = entitlements.stdout.trim()
    ? JSON.parse(
        run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
          input: entitlements.stdout,
        }),
      )
    : {};
  return {
    hash: validatePinnedSignature(display.stderr, identifier, values),
    display: display.stderr,
  };
}

export function packagePlan(version, architectures, development) {
  numericVersion(version);
  const unique = [...new Set(architectures)].sort();
  if (!unique.length || unique.some(value => !['arm64', 'x86_64'].includes(value)))
    throw new Error('Only arm64, x86_64 and universal macOS payloads are supported.');
  const architecture = unique.length === 2 ? 'universal' : unique[0];
  return {
    filename: `Unhook_${version}_${architecture}${development ? '_PRIVATE_BETA_UNSIGNED' : '_INSTALLED_SERVICE'}.pkg`,
    identifier: `${appId}.installer${development ? '.development' : ''}`,
    architecture,
  };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options });
}

function plist(path) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path]));
}

function ensureConfinedTree(path, bundleRoot) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(path);
    if (!target.startsWith(bundleRoot + sep))
      throw new Error('Bundle symlink escapes the app payload.');
    return;
  }
  if (stat.isDirectory())
    for (const entry of readdirSync(path)) ensureConfinedTree(join(path, entry), bundleRoot);
  else if (!stat.isFile()) throw new Error('Unsupported app payload file type.');
}

export function distributionXml({ version, identifier, architectures, development }) {
  numericVersion(version);
  if (!/^org\.unhook\.desktop\.installer(?:\.development)?$/.test(identifier))
    throw new Error('Unexpected package identifier.');
  const arch = [...new Set(architectures)].sort();
  packagePlan(version, arch, development);
  return `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Install Unhook${development ? ' — Development build' : ''}</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" hostArchitectures="${arch.join(',')}" rootVolumeOnly="true"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <allowed-os-versions><os-version min="13.0"/></allowed-os-versions>
  <choices-outline><line choice="unhook"/></choices-outline>
  <choice id="unhook" visible="false" title="Unhook"><pkg-ref id="${identifier}"/></choice>
  <pkg-ref id="${identifier}" version="${version}" onConclusion="None">Unhook-component.pkg</pkg-ref>
</installer-gui-script>
`;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Build macOS packages on macOS.');
  const args = process.argv.slice(2);
  if (args.some(arg => !['--development', '--skip-build'].includes(arg)))
    throw new Error('Usage: npm run package:macos -- [--development] [--skip-build]');
  const development = args.includes('--development');
  const installerIdentity = process.env.APPLE_INSTALLER_SIGNING_IDENTITY;
  if (
    !development &&
    (!installerIdentity || !/^Developer ID Installer: .+ \([A-Z0-9]{10}\)$/.test(installerIdentity))
  )
    throw new Error(
      'Set APPLE_INSTALLER_SIGNING_IDENTITY to a Developer ID Installer identity, or explicitly use --development.',
    );
  if (!args.includes('--skip-build'))
    run('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app'], { stdio: 'inherit' });
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
  const app = join(targetDir, 'release/bundle/macos/Unhook.app');
  if (!existsSync(app) || lstatSync(app).isSymbolicLink())
    throw new Error('Missing regular Unhook.app bundle; build it first.');
  ensureConfinedTree(app, realpathSync(app));
  const executable = validateBundleMetadata(plist(join(app, 'Contents/Info.plist')), version);
  const codePaths = [
    join(app, 'Contents/MacOS', executable),
    join(app, 'Contents/MacOS/unhook-system-helper'),
    join(app, 'Contents/MacOS/unhook-browser-host'),
  ];
  const helperPlist = plist(
    join(app, 'Contents/Library/LaunchDaemons/org.unhook.system-helper.plist'),
  );
  if (
    helperPlist.Label !== helperId ||
    helperPlist.BundleProgram !== 'Contents/MacOS/unhook-system-helper' ||
    helperPlist.Program ||
    helperPlist.ProgramArguments
  )
    throw new Error('Expected the embedded SMAppService helper configuration.');
  const archSets = codePaths.map(path =>
    run('/usr/bin/lipo', ['-archs', path]).trim().split(/\s+/).sort(),
  );
  if (archSets.some(archs => archs.join(',') !== archSets[0].join(',')))
    throw new Error('App, helper and browser host architectures must match.');
  const plan = packagePlan(version, archSets[0], development);
  let team;
  const outputDir = join(targetDir, 'release/bundle/pkg');
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, plan.filename);
  if (existsSync(output))
    throw new Error(
      `Package already exists: ${basename(output)}. Remove the local artifact explicitly before rebuilding, or increment the release version.`,
    );
  const stage = mkdtempSync(join(tmpdir(), 'unhook-pkg-'));
  try {
    const payload = join(stage, 'payload');
    mkdirSync(join(payload, 'Applications'), { recursive: true });
    run('/usr/bin/ditto', [app, join(payload, 'Applications/Unhook.app')]);
    const stagedApp = join(payload, 'Applications/Unhook.app');
    const stagedHelper = join(stagedApp, 'Contents/MacOS/unhook-system-helper');
    const stagedBrowser = join(stagedApp, 'Contents/MacOS/unhook-browser-host');
    if (development) {
      // Sign only the staging copy; retain the source bundle and reviewed PKGs.
      for (const [path, identifier] of [
        [stagedHelper, helperId],
        [stagedBrowser, 'org.unhook.browser-host'],
        [stagedApp, appId],
      ])
        run('/usr/bin/codesign', [
          '--force',
          '--sign',
          '-',
          '--options',
          'runtime',
          '--identifier',
          identifier,
          path,
        ]);
    }
    const appHashes = [];
    for (const [path, identifier] of [
      [stagedApp, appId],
      [stagedHelper, helperId],
      [stagedBrowser, development ? 'org.unhook.browser-host' : undefined],
    ]) {
      run('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--all-architectures',
        ...(!development ? ['-R', developerRequirement] : []),
        path,
      ]);
      for (const arch of archSets[0]) {
        const signature = inspectSignature(path, arch, identifier);
        if (!development) team = validateSignature(signature.display, identifier, team);
        if (path === stagedApp) appHashes.push(signature.hash);
      }
    }
    if (!development && !installerIdentity.endsWith(`(${team})`))
      throw new Error('Installer and application must use the same Developer ID team.');
    const helperDir = join(payload, 'Library/PrivilegedHelperTools');
    const launchDir = join(payload, 'Library/LaunchDaemons');
    const supportDir = join(payload, 'Library/Application Support/Unhook');
    for (const dir of [helperDir, launchDir, supportDir])
      mkdirSync(dir, { recursive: true, mode: 0o755 });
    run('/usr/bin/ditto', [stagedHelper, join(helperDir, installedLabel)]);
    chmodSync(join(helperDir, installedLabel), 0o755);
    writeFileSync(join(supportDir, 'approved-code-hashes'), codeHashPins(appHashes), {
      mode: 0o644,
    });
    writeFileSync(
      join(launchDir, `${installedLabel}.plist`),
      readFileSync(join(root, 'scripts/mac-pkg/installed-system-helper.plist')),
      { mode: 0o644 },
    );
    // Avoid inheriting group/other writable modes from the development bundle.
    run('/bin/chmod', ['-RN', payload]);
    run('/bin/chmod', ['-R', 'go-w', payload]);
    const components = join(stage, 'components.plist');
    run('/usr/bin/pkgbuild', ['--analyze', '--root', payload, components]);
    const metadata = plist(components);
    if (metadata.length !== 1 || metadata[0].RootRelativeBundlePath !== 'Applications/Unhook.app')
      throw new Error('Unexpected component bundle layout.');
    Object.assign(metadata[0], {
      BundleIsRelocatable: false,
      BundleHasStrictIdentifier: true,
      BundleIsVersionChecked: true,
      BundleOverwriteAction: 'upgrade',
    });
    writeFileSync(components, JSON.stringify(metadata));
    run('/usr/bin/plutil', ['-convert', 'xml1', components]);
    const scripts = join(stage, 'scripts');
    mkdirSync(scripts);
    for (const name of ['preinstall', 'postinstall', 'common.sh']) {
      const source = readFileSync(join(root, 'scripts/mac-pkg', name), 'utf8')
        .replaceAll('@VERSION@', version)
        .replaceAll('@TEAM@', team || '')
        .replaceAll('@DEVELOPMENT@', development ? '1' : '0');
      writeFileSync(join(scripts, name), source, { mode: 0o755 });
    }
    run('/usr/bin/pkgbuild', [
      '--root',
      payload,
      '--component-plist',
      components,
      '--identifier',
      plan.identifier,
      '--version',
      version,
      '--install-location',
      '/',
      '--ownership',
      'recommended',
      '--scripts',
      scripts,
      join(stage, 'Unhook-component-original.pkg'),
    ]);
    // Apple Software Distribution Legacy Guide, File Ownership: existing
    // directories keep their permissions unless Overwrite Permissions is set;
    // files and new directories use archive metadata. Retain root-owned BOM
    // entries but preserve shared parents such as root:admin 775 /Applications.
    // pkgutil(1) documents --expand/--flatten; pkgbuild has no CLI flag for this.
    const component = join(stage, 'component-expanded');
    run('/usr/sbin/pkgutil', ['--expand', join(stage, 'Unhook-component-original.pkg'), component]);
    const packageInfo = join(component, 'PackageInfo');
    writeFileSync(
      packageInfo,
      preserveExistingDirectoryPermissions(readFileSync(packageInfo, 'utf8')),
    );
    run('/usr/sbin/pkgutil', ['--flatten', component, join(stage, 'Unhook-component.pkg')]);
    const resources = join(stage, 'resources');
    mkdirSync(resources);
    for (const name of ['welcome', 'conclusion'])
      writeFileSync(
        join(resources, `${name}.html`),
        readFileSync(join(root, `scripts/mac-pkg/${name}.html`), 'utf8').replaceAll(
          '@DEVELOPMENT_WARNING@',
          development
            ? '<p class="warning"><strong>Unsigned development build.</strong> This package is for private testing. Administrator-authorized installation provides a persistent system service with ad-hoc executable signatures. This installer has no Developer ID publisher signature or notarization; downloaded-package Gatekeeper acceptance requires separate verification.</p>'
            : '',
        ),
      );
    const distribution = join(stage, 'Distribution.xml');
    writeFileSync(
      distribution,
      distributionXml({
        version,
        identifier: plan.identifier,
        architectures: archSets[0],
        development,
      }),
    );
    const builtPackage = join(stage, plan.filename);
    run('/usr/bin/productbuild', [
      '--distribution',
      distribution,
      '--package-path',
      stage,
      '--resources',
      resources,
      ...(!development ? ['--sign', installerIdentity, '--timestamp'] : []),
      builtPackage,
    ]);
    if (!development) {
      const status = run('/usr/sbin/pkgutil', ['--check-signature', builtPackage]);
      if (
        !status.includes(`Developer ID Installer:`) ||
        !status.includes(`(${team})`) ||
        !status.includes('signed by a certificate trusted by')
      )
        throw new Error('Package lacks a trusted Developer ID Installer signature.');
    }
    const expanded = join(stage, 'expanded');
    run('/usr/sbin/pkgutil', ['--expand-full', builtPackage, expanded]);
    const finalInfo = readFileSync(join(expanded, 'Unhook-component.pkg/PackageInfo'), 'utf8');
    if (preserveExistingDirectoryPermissions(finalInfo) !== finalInfo)
      throw new Error('Package would overwrite existing shared-directory permissions.');
    const expandedPayload = join(expanded, 'Unhook-component.pkg/Payload');
    if (
      !existsSync(
        join(expandedPayload, 'Applications/Unhook.app/Contents/MacOS/unhook-system-helper'),
      ) ||
      !existsSync(join(expandedPayload, `Library/PrivilegedHelperTools/${installedLabel}`)) ||
      !existsSync(
        join(expandedPayload, 'Library/Application Support/Unhook/approved-code-hashes'),
      ) ||
      !existsSync(join(expandedPayload, `Library/LaunchDaemons/${installedLabel}.plist`)) ||
      readdirSync(expandedPayload).some(name => !['Applications', 'Library'].includes(name)) ||
      readdirSync(join(expandedPayload, 'Applications')).some(name => name !== 'Unhook.app')
    )
      throw new Error('Package contains unexpected system payload paths.');
    run('/usr/bin/ditto', [builtPackage, output]);
    console.log(
      `Created ${output}\n${development ? 'Private beta: installed daemon supports routine transitions without passwords; clean-machine installation and Gatekeeper acceptance remain unverified.' : 'Signed package built. Notarization and clean-machine installation testing are still required before distribution.'}`,
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
