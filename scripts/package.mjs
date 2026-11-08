import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
  'manifest.json',
  'background.js',
  'capture.js',
  'capture-main.js',
  'sidepanel.html',
  'sidepanel.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'README.md',
  'INSTALL-MAC.md',
  'INSTALL-SAFARI.md',
  'CHANGELOG.md',
].sort();
const json = async file => JSON.parse((await readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Stored ZIP entries keep this tiny build dependency-free. Fixed order, date and
// permissions produce identical bytes on every build from the same source files.
function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const filename = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    assert(data.length < 0xffffffff, 'ZIP64 files are not supported');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01, 00:00:00.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0.
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function verifyZip(archive, entries) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), entries.length);
  let cursor = archive.readUInt32LE(end + 16);
  for (const { name, data } of entries) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const nameLength = archive.readUInt16LE(cursor + 28);
    assert.equal(archive.subarray(cursor + 46, cursor + 46 + nameLength).toString(), name);
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const extracted = archive.subarray(start, start + archive.readUInt32LE(cursor + 24));
    assert.deepEqual(extracted, data, `ZIP contents differ: ${name}`);
    assert.equal(crc32(extracted), archive.readUInt32LE(cursor + 16));
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
}

export function createSafariManifest(chromeManifest) {
  const manifest = structuredClone(chromeManifest);
  manifest.permissions = (manifest.permissions || []).filter(permission => !['sidePanel', 'downloads'].includes(permission));
  delete manifest.minimum_chrome_version;
  delete manifest.side_panel;
  delete manifest.background;
  manifest.action = { ...manifest.action, default_popup: 'sidepanel.html?popup=1' };
  manifest.browser_specific_settings = {
    ...manifest.browser_specific_settings,
    safari: { strict_min_version: '18.4' },
  };
  return manifest;
}

function checkResources(manifest, bundledFiles, browser) {
  const resources = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(item => item.resources || []),
  ].filter(Boolean);
  for (const resource of resources) {
    const filename = resource.split(/[?#]/, 1)[0];
    assert(bundledFiles.includes(filename), `${browser}: resource missing from package allowlist: ${resource}`);
  }
}

export async function buildPackages() {
  const [manifest, pkg] = await Promise.all([json('manifest.json'), json('package.json')]);
  assert.equal(manifest.manifest_version, 3, 'Only Manifest V3 is supported');
  assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match');
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, 'Invalid extension version');
  assert(Number.parseInt(manifest.minimum_chrome_version, 10) >= 116, 'Declare Chrome 116+ for sidePanel.open');
  checkResources(manifest, files, 'Chrome');
  const html = await readFile(path.join(root, 'sidepanel.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    assert(files.includes(match[1]), `Side panel script missing from package: ${match[1]}`);
  }
  const entries = await Promise.all(files.map(async name => ({ name, data: await readFile(path.join(root, name)) })));
  for (const file of [...files.filter(name => name.endsWith('.js')), 'scripts/package.mjs', 'scripts/build-safari.mjs']) {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  }
  const safariManifest = createSafariManifest(manifest);
  const safariEntries = entries.filter(entry => entry.name !== 'background.js').map(entry => entry.name === 'manifest.json'
    ? { name: entry.name, data: Buffer.from(JSON.stringify(safariManifest, null, 2) + '\n') }
    : entry);
  checkResources(safariManifest, safariEntries.map(entry => entry.name), 'Safari');
  assert.equal(safariManifest.action.default_popup, 'sidepanel.html?popup=1');
  assert(!safariManifest.background && !safariManifest.side_panel && !safariManifest.minimum_chrome_version);
  assert(!safariManifest.permissions.some(permission => ['downloads', 'sidePanel'].includes(permission)));
  const packages = [
    { browser: 'chrome', filename: `bilibili-subtitle-extractor-${manifest.version}.zip`, entries },
    { browser: 'safari', filename: `bilibili-subtitle-extractor-safari-${manifest.version}.zip`, entries: safariEntries },
  ].map(item => ({ ...item, archive: makeZip(item.entries) }));
  for (const item of packages) verifyZip(item.archive, item.entries);
  return { version: manifest.version, packages };
}

async function main() {
  assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/package.mjs [--check]');
  const { version, packages } = await buildPackages();
  if (process.argv.includes('--check')) {
    console.log(`OK: JavaScript, Chrome/Safari manifest resources and ZIP contents (${version}).`);
    return;
  }
  const dist = path.join(root, 'dist');
  await mkdir(dist, { recursive: true });
  for (const item of packages) {
    const output = path.join(dist, item.filename);
    await writeFile(output, item.archive);
    console.log(`Created ${output} (${item.archive.length} bytes).`);
  }
  // Rebuild only this generated directory so removed Chrome files cannot linger.
  const safariFolder = path.join(dist, 'safari-extension');
  await rm(safariFolder, { recursive: true, force: true });
  for (const entry of packages.find(item => item.browser === 'safari').entries) {
    const output = path.join(safariFolder, entry.name);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, entry.data);
  }
  console.log(`Prepared Safari source folder: ${safariFolder}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    if (error.stderr) console.error(error.stderr.toString());
    process.exitCode = 1;
  });
}
