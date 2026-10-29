import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ddr-summary-'));
const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ddr-codex-'));
process.env.DSH_HOME = home;
process.env.CODEX_HOME = codexHome;
const jobs = path.join(home, 'douyin-report', 'jobs');
await fs.mkdir(jobs, { recursive: true });
await fs.writeFile(path.join(jobs, 'a.state.json'), JSON.stringify({
	kind: 'patent', link_count: 2, status: 'prepared', updated_at: '2026-01-01T00:00:00.000Z',
}));
await fs.writeFile(path.join(jobs, 'b.state.json'), JSON.stringify({
	kind: 'trademark', link_count: 1, status: 'submission_clicked_unverified', updated_at: '2026-01-02T00:00:00.000Z',
}));
await fs.writeFile(path.join(jobs, 'broken.state.json'), '{not json');
const codexJobs = path.join(codexHome, 'douyin-report', 'jobs');
await fs.mkdir(codexJobs, { recursive: true });
await fs.writeFile(path.join(codexJobs, 'c.state.json'), JSON.stringify({
	kind: 'trademark', link_count: 3, status: 'submitted', updated_at: '2026-01-03T00:00:00.000Z',
}));

const makeResponse = () => ({
	statusCode: null,
	headers: null,
	body: '',
	writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
	end(body) { this.body = body; },
});
const jsonRequest = (method, value) => ({
	method,
	async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); },
});

try {
	const { collectSummary, apply } = await import('../lib/index.js');
	const summary = await collectSummary();
	assert.equal(summary.ok, true);
	assert.equal(summary.total, 3, 'broken state files are ignored and both hosts are read');
	assert.equal(summary.counts.prepared, 1);
	assert.equal(summary.counts.submission_clicked_unverified, 1);
	assert.equal(summary.counts.submitted, 1);
	assert.equal(summary.confirm_before_submit, true, 'confirmation defaults to on');
	assert.equal(summary.recent[0].host, 'codex');
	assert.equal(summary.recent[0].status, 'submitted');
	assert.equal(summary.recent[0].kind, 'trademark');
	assert.equal(summary.recent[0].links, 3);
	assert.equal(summary.recent[1].kind, 'trademark');
	assert.equal(summary.recent[1].links, 1);
	assert.equal(summary.recent[2].kind, 'patent');

	const routes = new Map();
	apply({ inject: (names, callback) => callback({ webServer: { register: (value) => routes.set(value.path, value) } }) });
	const summaryRoute = routes.get('/dsh-douyin-report/summary');
	const settingsRoute = routes.get('/dsh-douyin-report/settings');
	assert.ok(summaryRoute, 'summary route must be registered');
	assert.ok(settingsRoute, 'settings route must be registered');

	const summaryResponse = makeResponse();
	await summaryRoute.handler({ method: 'GET' }, summaryResponse);
	assert.equal(summaryResponse.statusCode, 200);
	assert.equal(JSON.parse(summaryResponse.body).total, 3);

	const summaryPost = makeResponse();
	await summaryRoute.handler({ method: 'POST' }, summaryPost);
	assert.equal(summaryPost.statusCode, 405);

	const settingsGet = makeResponse();
	await settingsRoute.handler({ method: 'GET' }, settingsGet);
	assert.equal(settingsGet.statusCode, 200);
	assert.equal(JSON.parse(settingsGet.body).confirm_before_submit, true);

	const settingsOff = makeResponse();
	await settingsRoute.handler(jsonRequest('POST', { confirm_before_submit: false }), settingsOff);
	assert.equal(settingsOff.statusCode, 200);
	assert.equal(JSON.parse(settingsOff.body).confirm_before_submit, false);
	assert.equal((await collectSummary()).confirm_before_submit, false);
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'douyin-report', 'ui-settings.json'), 'utf8')), { confirm_before_submit: false });

	const settingsBad = makeResponse();
	await settingsRoute.handler(jsonRequest('POST', { confirm_before_submit: 'no' }), settingsBad);
	assert.equal(settingsBad.statusCode, 400);
	assert.equal((await collectSummary()).confirm_before_submit, false, 'invalid writes do not change the setting');

	const settingsMethod = makeResponse();
	await settingsRoute.handler({ method: 'PUT' }, settingsMethod);
	assert.equal(settingsMethod.statusCode, 405);

	const settingsOn = makeResponse();
	await settingsRoute.handler(jsonRequest('POST', { confirm_before_submit: true }), settingsOn);
	assert.equal(settingsOn.statusCode, 200);
	assert.equal((await collectSummary()).confirm_before_submit, true);

	console.log('host smoke passed');
} finally {
	await fs.rm(home, { recursive: true, force: true });
	await fs.rm(codexHome, { recursive: true, force: true });
}
