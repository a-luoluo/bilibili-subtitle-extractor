import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function check() {
  const [manifest, pkg] = await Promise.all([json('manifest.json'), json('package.json')]);
  assert.equal(manifest.manifest_version, 3, 'Only Manifest V3 is supported');
  assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match');
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/, 'Invalid extension version');
  assert(Number.parseInt(manifest.minimum_chrome_version, 10) >= 116, 'Declare Chrome 116+ for sidePanel.open');
  const resources = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(item => item.resources || []),
  ].filter(Boolean);
  for (const resource of resources) assert(files.includes(resource), `Resource missing from package allowlist: ${resource}`);
  const html = await readFile(path.join(root, 'sidepanel.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    assert(files.includes(match[1]), `Side panel script missing from package: ${match[1]}`);
  }
  const entries = await Promise.all(files.map(async name => ({ name, data: await readFile(path.join(root, name)) })));
  for (const file of [...files.filter(name => name.endsWith('.js')), 'scripts/package.mjs']) {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  }
  const archive = makeZip(entries);
  verifyZip(archive, entries);
  return { version: manifest.version, archive };
}

try {
  assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/package.mjs [--check]');
  const { version, archive } = await check();
  if (process.argv.includes('--check')) {
    console.log(`OK: JavaScript, manifest resources and ${files.length} packaged ZIP entries (${version}).`);
  } else {
    const output = path.join(root, 'dist', `bilibili-subtitle-extractor-${version}.zip`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, archive);
    console.log(`Created ${output} (${archive.length} bytes).`);
  }
} catch (error) {
  console.error(error.message);
  if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
}
