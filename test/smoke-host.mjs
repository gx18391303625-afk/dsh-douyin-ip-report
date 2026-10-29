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

try {
	const { collectSummary, apply } = await import('../lib/index.js');
	const summary = await collectSummary();
	assert.equal(summary.ok, true);
	assert.equal(summary.total, 3, 'broken state files are ignored and both hosts are read');
	assert.equal(summary.counts.prepared, 1);
	assert.equal(summary.counts.submission_clicked_unverified, 1);
	assert.equal(summary.counts.submitted, 1);
	assert.equal(summary.recent[0].host, 'codex');
	assert.equal(summary.recent[0].status, 'submitted');
	assert.equal(summary.recent[0].kind, 'trademark');
	assert.equal(summary.recent[0].links, 3);
	assert.equal(summary.recent[1].kind, 'trademark');
	assert.equal(summary.recent[1].links, 1);
	assert.equal(summary.recent[2].kind, 'patent');

	let route;
	apply({ inject: (names, callback) => callback({ webServer: { register: (value) => { route = value; } } }) });
	assert.equal(route.kind, 'exact');
	assert.equal(route.path, '/dsh-douyin-report/summary');
	const response = {
		statusCode: null,
		headers: null,
		body: '',
		writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
		end(body) { this.body = body; },
	};
	await route.handler({ method: 'GET' }, response);
	assert.equal(response.statusCode, 200);
	assert.equal(JSON.parse(response.body).total, 3);
	const rejected = { statusCode: null, writeHead(code) { this.statusCode = code; }, end() {} };
	await route.handler({ method: 'POST' }, rejected);
	assert.equal(rejected.statusCode, 405);
	console.log('host smoke passed');
} finally {
	await fs.rm(home, { recursive: true, force: true });
	await fs.rm(codexHome, { recursive: true, force: true });
}
