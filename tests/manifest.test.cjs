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
  assert.equal(manifest.version, '6.6.0');
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
