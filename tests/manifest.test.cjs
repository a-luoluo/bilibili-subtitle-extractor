const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('manifest bundles both capture worlds and declares the sidePanel.open browser minimum', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '6.7.0');
  assert.ok(Number(manifest.minimum_chrome_version) >= 116);
  const worlds = new Map(manifest.content_scripts.map(script => [script.world, script]));
  assert.equal(worlds.get('MAIN').run_at, 'document_start');
  assert.equal(worlds.get('ISOLATED').run_at, 'document_start');
  const files = [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap(script => script.js), ...Object.values(manifest.icons)];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist in the extension`);
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(manifest.host_permissions.includes('https://*.hdslb.com/*'));
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});

test('toolbar click opens in the user gesture and reports a rejected side panel without an unhandled promise', async () => {
  let click;
  const calls = [];
  const chrome = {
    action: {
      onClicked: { addListener(fn) { click = fn; } },
      setBadgeText(options) { calls.push(['badge', options]); return Promise.resolve(); },
      setTitle(options) { calls.push(['title', options]); return Promise.resolve(); }
    },
    sidePanel: { open(options) { calls.push(['open', options]); return Promise.reject(new Error('unsupported')); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), { chrome });
  click({ id: 7, windowId: 2 });
  assert.equal(calls[0][0], 'open');
  assert.equal(calls[0][1].windowId, 2);
  await flush();
  assert.equal(calls.find(([kind]) => kind === 'badge')[1].text, '!');
  assert.match(calls.find(([kind]) => kind === 'title')[1].title, /侧边栏打开失败/);
  calls.length = 0;
  chrome.sidePanel.open = () => Promise.resolve();
  click({ id: 7, windowId: 2 });
  await flush();
  assert.equal(calls.find(([kind]) => kind === 'badge')[1].text, '');
});


test('Safari conversion preserves capture and host access while replacing the Chrome-only UI', async () => {
  const { createSafariManifest } = await import('../scripts/package.mjs');
  const before = JSON.stringify(manifest);
  const safari = createSafariManifest(manifest);
  assert.equal(JSON.stringify(manifest), before, 'conversion must not change the Chrome manifest');
  assert.equal(safari.manifest_version, 3);
  assert.equal(safari.version, manifest.version);
  assert.equal(safari.action.default_popup, 'sidepanel.html?popup=1');
  assert.equal(safari.browser_specific_settings.safari.strict_min_version, '18.4');
  for (const field of ['minimum_chrome_version', 'side_panel', 'background']) assert.equal(field in safari, false);
  assert.equal(safari.permissions.includes('sidePanel'), false);
  assert.equal(safari.permissions.includes('downloads'), false);
  assert.ok(safari.permissions.includes('scripting'));
  assert.ok(safari.permissions.includes('tabs'));
  assert.deepEqual(safari.content_scripts, manifest.content_scripts);
  assert.deepEqual(safari.host_permissions, manifest.host_permissions);
  assert.deepEqual(safari.action.default_icon, manifest.action.default_icon);
});

test('both reproducible source packages contain their own manifest and Safari omits the Chrome worker', async () => {
  const { buildPackages } = await import('../scripts/package.mjs');
  const first = await buildPackages();
  const second = await buildPackages();
  assert.equal(first.packages.length, 2);
  for (let i = 0; i < first.packages.length; i++) {
    const archive = first.packages[i];
    assert.deepEqual(archive.archive, second.packages[i].archive);
    assert.ok(archive.entries.some(file => file.name === 'capture-main.js'));
    assert.ok(archive.entries.some(file => file.name === 'capture.js'));
    assert.ok(archive.entries.some(file => file.name === 'sidepanel.html'));
    assert.ok(!archive.entries.some(file => /^(?:tests|\.git|scripts)\//.test(file.name)));
  }
  const safari = first.packages.find(item => item.browser === 'safari');
  const chrome = first.packages.find(item => item.browser === 'chrome');
  assert.equal(safari.filename, 'bilibili-subtitle-extractor-safari-6.7.0.zip');
  assert.equal(chrome.filename, 'bilibili-subtitle-extractor-6.7.0.zip');
  const safariManifest = JSON.parse(safari.entries.find(file => file.name === 'manifest.json').data);
  const chromeManifest = JSON.parse(chrome.entries.find(file => file.name === 'manifest.json').data);
  assert.equal(safariManifest.action.default_popup, 'sidepanel.html?popup=1');
  assert.ok(chromeManifest.side_panel);
  assert.equal(safari.entries.some(file => file.name === 'background.js'), false);
  assert.equal(chrome.entries.some(file => file.name === 'background.js'), true);
});
