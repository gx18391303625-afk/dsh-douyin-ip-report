import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

let loaded;
globalThis.window = {
	__ModuleLoader__: {
		load(spec) { loaded = spec; },
	},
};
globalThis.document = {
	head: { appendChild() {} },
	querySelector() { return null; },
	createElement() { return { dataset: {}, style: {}, textContent: '' }; },
};

const clientUrl = new URL('../lib/client.js', import.meta.url);
const source = await fs.readFile(clientUrl, 'utf8');
assert.match(source, /提交前确认/, 'panel must expose the confirmation toggle');
assert.match(source, /ddr-switch/, 'panel must render the toggle switch');
assert.match(source, /\/dsh-douyin-report\/settings/, 'panel must persist the setting through the host route');
await import(clientUrl.href + '?smoke=' + Date.now());

assert.equal(loaded.id, 'dsh-douyin-ip-report', 'ModuleLoader id must match the package name');
assert.equal(typeof loaded.factory, 'function', 'client half must expose a factory');

const reactMock = {
	createElement: (...args) => args,
	useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
	useEffect() {},
	useCallback: (fn) => fn,
};
const moduleExports = loaded.factory((name) => (name === 'react' ? reactMock : {}));
assert.equal(typeof moduleExports.apply, 'function', 'client half must export apply');
assert.deepEqual(moduleExports.inject, ['slots']);

const registrations = [];
const ctx = {
	slots: {
		inject(name, callback) { if (name === 'sidebar.panellist') callback(); },
		register(options) { registrations.push(options); return () => {}; },
	},
};
moduleExports.apply(ctx);

const main = registrations.find((item) => item.name === 'main');
const row = registrations.find((item) => item.name === 'sidebar.panellist');
assert.ok(main, 'must register the main panel');
assert.ok(row, 'must register the sidebar row');
assert.equal(main.key, 'dsh-douyin-report');
assert.equal(row.id, 'dsh-douyin-report');
assert.equal(typeof row.label, 'function');
assert.equal(row.label(), '抖音举报');

console.log('client smoke passed');
