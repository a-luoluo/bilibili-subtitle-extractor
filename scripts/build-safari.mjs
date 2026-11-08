#!/usr/bin/env node
// Development-only native packaging using Apple's generated project, never a
// handwritten Xcode project. Requires full Xcode; Command Line Tools are not enough.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = path.join(root, 'dist', 'safari-extension');
const output = path.join(root, 'dist', 'safari-build');
const appName = 'Bilibili Subtitle Extractor';
// Xcode 26.6's packager derives the host ID's last component from PRODUCT_NAME,
// while the extension uses the supplied ID. Keep those components identical.
const bundleIdentifier = 'io.github.aluoluo.bilibili-subtitle-extractor.dev.Bilibili-Subtitle-Extractor';
const args = process.argv.slice(2);

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
}

function findAppleTool(name) {
  const result = spawnSync('/usr/bin/xcrun', ['--find', name], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function projectsIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(directory, entry.name);
    if (entry.name.endsWith('.xcodeproj')) result.push(full);
    else result.push(...await projectsIn(full));
  }
  return result;
}

function readPlist(filename) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', filename]));
}

async function verifyExecutable(bundle, info) {
  assert(typeof info.CFBundleExecutable === 'string' && info.CFBundleExecutable, `Missing executable in ${bundle}`);
  const binary = path.join(bundle, 'Contents', 'MacOS', info.CFBundleExecutable);
  assert((await stat(binary)).mode & 0o111, `Bundle executable is not executable: ${binary}`);
  const architectures = run('/usr/bin/lipo', ['-archs', binary]).trim().split(/\s+/);
  for (const architecture of ['arm64', 'x86_64']) assert(architectures.includes(architecture), `Missing ${architecture} in ${binary}`);
  return { executable: path.relative(bundle, binary), architectures };
}

async function main() {
  assert(args.every(arg => ['--help', '--check'].includes(arg)), 'Usage: node scripts/build-safari.mjs [--check | --help]');
  if (args.includes('--help')) {
    console.log('Usage: node scripts/build-safari.mjs [--check]');
    console.log('Run npm run package first to create dist/safari-extension.');
    console.log('Requires macOS and full Xcode. Uses the official Safari packager (or older converter).');
    console.log('Creates a universal, unsigned development .app.zip and SHA-256. Does not install or change Safari settings.');
    console.log('--check validates prerequisites without generating or building a project.');
    return;
  }
  assert(process.platform === 'darwin', 'Native Safari packaging requires macOS with full Xcode.');
  const packagerName = ['safari-web-extension-packager', 'safari-web-extension-converter'].find(findAppleTool);
  if (!packagerName) {
    throw new Error('Full Xcode is required: xcrun could not find safari-web-extension-packager or safari-web-extension-converter. Command Line Tools cannot build this app. Use a Mac with Xcode selected (DEVELOPER_DIR may select it), or the macOS CI job.');
  }
  const xcodeVersion = run('/usr/bin/xcodebuild', ['-version']).trim();
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8')); }
  catch { throw new Error('Missing or invalid dist/safari-extension/manifest.json. Run npm run package first.'); }
  assert(manifest.manifest_version === 3, 'Expected a Manifest V3 Safari extension.');
  assert(typeof manifest.version === 'string' && /^\d+(?:\.\d+){0,3}$/.test(manifest.version), 'Invalid extension version.');
  assert(!manifest.side_panel && !manifest.permissions?.includes('sidePanel'), 'The source must be the Safari variant without Chrome sidePanel keys.');
  const runtimeFiles = (await filesIn(source)).filter(file => /\.(?:js|mjs|json|html|css|png|svg)$/i.test(file));
  assert(runtimeFiles.length > 1, 'The Safari source folder is incomplete.');
  if (args.includes('--check')) {
    console.log(`OK: ${packagerName}, ${xcodeVersion.replace(/\n/g, ', ')}, Safari extension ${manifest.version}.`);
    return;
  }

  await mkdir(output, { recursive: true });
  // Each invocation has its own generated project; previous output is never erased.
  const work = await mkdtemp(path.join(output, 'run-'));
  const generated = path.join(work, 'Generated');
  const derivedData = path.join(work, 'DerivedData');
  console.log(`Generating official Safari project with ${packagerName}…`);
  run('/usr/bin/xcrun', [packagerName, source, '--project-location', generated,
    '--app-name', appName, '--bundle-identifier', bundleIdentifier, '--macos-only',
    '--swift', '--copy-resources', '--no-open', '--no-prompt'], { stdio: 'inherit' });
  const projects = await projectsIn(generated);
  assert.equal(projects.length, 1, `Expected one generated Xcode project; found ${projects.length}.`);
  const project = projects[0];
  const listing = JSON.parse(run('/usr/bin/xcodebuild', ['-project', project, '-list', '-json']));
  const schemes = listing.project?.schemes || [];
  const appSchemes = schemes.filter(scheme => !/extension|test/i.test(scheme));
  const scheme = schemes.find(value => value === appName) || schemes.find(value => value === appName + ' (macOS)') || (appSchemes.length === 1 ? appSchemes[0] : null);
  assert(scheme, `Cannot identify the generated app scheme. Available schemes: ${schemes.join(', ')}`);

  const buildArgs = ['-project', project, '-scheme', scheme, '-configuration', 'Release',
    '-sdk', 'macosx', '-destination', 'generic/platform=macOS', '-derivedDataPath', derivedData,
    'ARCHS=arm64 x86_64', 'ONLY_ACTIVE_ARCH=NO', 'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'DEVELOPMENT_TEAM=',
    // Extension URLs and byte-for-byte verification require unmodified assets.
    'COMPRESS_PNG_FILES=NO', 'STRIP_PNG_TEXT=NO', 'COMBINE_HIDPI_IMAGES=NO',
    `MARKETING_VERSION=${manifest.version}`, `CURRENT_PROJECT_VERSION=${manifest.version}`];
  const settings = JSON.parse(run('/usr/bin/xcodebuild', [...buildArgs, '-showBuildSettings', '-json']));
  const appSettings = settings.map(item => item.buildSettings).filter(value => value && value.WRAPPER_EXTENSION === 'app');
  assert.equal(appSettings.length, 1, `Expected one host app product; found ${appSettings.length}.`);
  assert.equal(appSettings[0].PRODUCT_BUNDLE_IDENTIFIER, bundleIdentifier, 'The packager generated an unexpected host bundle identifier.');
  // Some Xcode versions report only explicit scheme buildables here. The
  // embedded extension is checked again from its final Info.plist below.
  const extensionSettings = settings.map(item => item.buildSettings).filter(value => value && value.WRAPPER_EXTENSION === 'appex');
  for (const extension of extensionSettings) {
    assert(extension.PRODUCT_BUNDLE_IDENTIFIER?.startsWith(bundleIdentifier + '.'),
      `Extension bundle identifier ${extension.PRODUCT_BUNDLE_IDENTIFIER} must be prefixed with host ${bundleIdentifier}.`);
  }
  console.log('Building unsigned macOS development app (arm64 + x86_64)…');
  run('/usr/bin/xcodebuild', [...buildArgs, 'build'], { stdio: 'inherit' });
  const app = path.join(appSettings[0].TARGET_BUILD_DIR, appSettings[0].FULL_PRODUCT_NAME);
  assert(app.endsWith('.app'), 'Xcode did not report a macOS app product.');
  const appInfo = readPlist(path.join(app, 'Contents', 'Info.plist'));
  assert.equal(appInfo.CFBundlePackageType, 'APPL', 'The host product is not an app bundle.');
  const appBinary = await verifyExecutable(app, appInfo);
  const plugins = path.join(app, 'Contents', 'PlugIns');
  const extensions = [];
  for (const entry of await readdir(plugins, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.appex')) continue;
    const extension = path.join(plugins, entry.name);
    const info = readPlist(path.join(extension, 'Contents', 'Info.plist'));
    if (info.NSExtension?.NSExtensionPointIdentifier !== 'com.apple.Safari.web-extension') continue;
    assert(info.CFBundleIdentifier?.startsWith(appInfo.CFBundleIdentifier + '.'), 'The embedded extension bundle identifier does not match its host.');
    const binary = await verifyExecutable(extension, info);
    const resources = path.join(extension, 'Contents', 'Resources');
    for (const file of runtimeFiles) {
      const relative = path.relative(source, file);
      assert.deepEqual(await readFile(path.join(resources, relative)), await readFile(file), `Embedded extension resource differs: ${relative}`);
    }
    extensions.push({ bundle: entry.name, bundleIdentifier: info.CFBundleIdentifier, ...binary });
  }
  assert.equal(extensions.length, 1, 'Expected exactly one embedded Safari web extension.');

  const artifact = path.join(root, 'dist', `bilibili-subtitle-extractor-${manifest.version}-safari-development.app.zip`);
  const temporaryZip = path.join(work, 'development.app.zip');
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, temporaryZip]);
  run('/usr/bin/unzip', ['-tq', temporaryZip]);
  const sha256 = createHash('sha256').update(await readFile(temporaryZip)).digest('hex');
  await rename(temporaryZip, artifact);
  await writeFile(artifact + '.sha256', sha256 + '  ' + path.basename(artifact) + '\n');
  const report = {
    version: manifest.version, packager: packagerName, xcode: xcodeVersion,
    project: path.relative(root, project), scheme, app: path.relative(root, app),
    appBundleIdentifier: appInfo.CFBundleIdentifier, appBinary, extensions,
    verifiedRuntimeFiles: runtimeFiles.length, artifact: path.relative(root, artifact), sha256,
    codeSigning: 'disabled', notarized: false, distribution: 'development-only',
    note: 'Unsigned development build. Not a Developer ID signed/notarized release and not tested by this script in Safari. No installation or Safari security-setting changes are performed.'
  };
  await writeFile(path.join(output, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Created ${artifact}`);
  console.log('Verified host app, embedded Safari extension, both CPU architectures, runtime resources and ZIP integrity.');
  console.log('This is an unsigned development artifact, not a signed/notarized public release.');
}

main().catch(error => {
  console.error(error.message);
  if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
});
