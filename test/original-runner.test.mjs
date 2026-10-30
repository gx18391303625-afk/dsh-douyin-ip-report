import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  normalizedLink, validateJob, canonicalVideo, deduplicateResolved, submissionAllowed,
  parseArgs, profilePaths, acquireLock, classifyReceipt, prepareReport, videoReportControl,
  reportDialog, receiptTexts, waitForReceipt, authenticatedSession, resolveTarget, login, run, selfTest,
  REASON, ORIGINAL_PLACEHOLDER,
} from '../skills/douyin-ip-report/scripts/original-runner.mjs';

// Synthetic IDs and strings only; no recorded or user-provided live target fixtures.
const TARGET = 'https://www.douyin.com/video/1000000000000000001';
const TARGET2 = 'https://www.douyin.com/video/1000000000000000002';
const SHORT = 'https://v.douyin.com/OFFLINE_TARGET/';
const ORIGINAL = 'https://v.douyin.com/OFFLINE_ORIGINAL/';
const manifest = (links = [TARGET], originals = Object.fromEntries(links.map(link => [link, ORIGINAL]))) => ({ kind: 'original', links, originals });
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code);

async function fixture(t, job = manifest()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'original-runner-offline-'));
  // Verified absolute temporary directory owned by this test, never a browser profile.
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('original-runner-offline-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const jobPath = path.join(root, 'input.json'), statePath = path.join(root, 'jobs', 'state.json');
  await fs.writeFile(jobPath, JSON.stringify(job));
  return { root, options: { job: jobPath, state: statePath, profile: path.join(root, 'original-browser-profile') }, ledger: path.join(root, 'jobs', 'original-ledger.json') };
}
async function readJSON(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
function mockBrowser({ result = 'success', clickError, beforeClick, preparationError, resolveId } = {}) {
  const calls = { launches: [], clicks: 0, prepared: [], goto: [], closed: 0, resolutions: 0, originalResolutions: 0 };
  const page = { setDefaultTimeout() {}, async goto(url) { calls.goto.push(url); } };
  const context = { pages: () => [page], async close() { calls.closed++; } };
  const dependencies = {
    chromium: { async launchPersistentContext(profile, options) { calls.launches.push({ profile, options }); return context; } },
    async resolveTarget(_page, entry) {
      calls.resolutions++;
      const id = resolveId?.(entry) || entry.targetUrl.match(/\/video\/(\d+)/)?.[1] || '1000000000000000001';
      return { ...entry, videoId: id, canonicalUrl: `https://www.douyin.com/video/${id}` };
    },
    async resolveOriginal(_page, originalUrl) {
      calls.originalResolutions++;
      const id = originalUrl.match(/\/video\/(\d+)/)?.[1] || '2000000000000000001';
      return { videoId: id, canonicalUrl: `https://www.douyin.com/video/${id}` };
    },
    async prepareReport(_page, entry) {
      calls.prepared.push(entry);
      if (preparationError) throw preparationError;
      return { async click() { calls.clicks++; await beforeClick?.(); if (clickError) throw clickError; } };
    },
    async receiptTexts() { return []; },
    async waitForReceipt() { return { status: result, receipt: result === 'success' ? '举报已提交' : result === 'rejected' ? '提交失败' : null }; },
  };
  return { dependencies, calls };
}

test('exact input mappings, supported types, URL normalization and no invented originals', () => {
  assert.equal(normalizedLink('https://v.douyin.com/ABC?x=1'), 'https://v.douyin.com/ABC/');
  assert.equal(normalizedLink(TARGET + '/?x=1'), TARGET);
  for (const url of ['http://www.douyin.com/video/1', 'https://evil.com/video/1', 'https://www.douyin.com@evil.com/video/1', 'https://www.douyin.com/user/1', 'https://v.douyin.com/a/b', 'https://www.douyin.com:444/video/1', null]) throwsCode(() => normalizedLink(url), 'LINK_INVALID');
  assert.equal(validateJob(manifest()).entries[0].originalUrl, ORIGINAL);
  throwsCode(() => validateJob({ ...manifest(), kind: 'patent' }), 'JOB_INVALID');
  throwsCode(() => validateJob({ ...manifest(), originals: {} }), 'MAPPING_INVALID');
  throwsCode(() => validateJob({ ...manifest(), originals: { [TARGET]: ORIGINAL, [TARGET2]: ORIGINAL } }), 'MAPPING_INVALID');
  throwsCode(() => validateJob(manifest([TARGET], { [TARGET]: TARGET })), 'MAPPING_INVALID');
  throwsCode(() => validateJob(manifest([TARGET, TARGET + '/'])), 'JOB_INVALID');
  throwsCode(() => validateJob(manifest([TARGET], { [TARGET]: 'not a URL' })), 'LINK_INVALID');
});

test('browser-resolved target IDs deduplicate aliases and reject conflicting original maps', () => {
  assert.deepEqual(canonicalVideo('https://www.douyin.com/jingxuan?modal_id=123'), { videoId: '123', canonicalUrl: 'https://www.douyin.com/video/123' });
  throwsCode(() => canonicalVideo('https://www.douyin.com/user/123'), 'TARGET_UNVERIFIED');
  const entries = [TARGET, SHORT].map(targetUrl => ({ targetUrl, originalUrl: ORIGINAL, ...canonicalVideo(TARGET) }));
  const unique = deduplicateResolved(entries);
  assert.equal(unique.length, 1);
  assert.deepEqual(unique[0].inputUrls, [TARGET, SHORT]);
  throwsCode(() => deduplicateResolved([entries[0], { ...entries[1], originalUrl: TARGET2 }]), 'MAPPING_CONFLICT');
  throwsCode(() => deduplicateResolved([{ ...entries[0], originalUrl: TARGET }]), 'MAPPING_INVALID');
});

test('guard state rejects unknown, submitting, success, changed jobs and unapproved retries', () => {
  for (const status of ['unknown', 'submitting', 'success']) throwsCode(() => submissionAllowed({ status, fingerprint: 'a' }, 'a', true), 'DUPLICATE_BLOCKED');
  throwsCode(() => submissionAllowed({ status: 'rejected', fingerprint: 'a' }, 'a'), 'RETRY_REQUIRED');
  submissionAllowed({ status: 'rejected', fingerprint: 'a' }, 'a', true);
  throwsCode(() => submissionAllowed({ status: 'rejected', fingerprint: 'a' }, 'b', true), 'STATE_MISMATCH');
  throwsCode(() => submissionAllowed(null, 'a', true), 'NO_FAILED_ATTEMPT');
  throwsCode(() => submissionAllowed({ status: 'prepared', fingerprint: 'a' }, 'a', true), 'NO_FAILED_ATTEMPT');
  throwsCode(() => submissionAllowed({ status: 'corrupt', fingerprint: 'a' }, 'a'), 'STATE_INVALID');
});

test('CLI has no headed fallback and isolates explicit login and self-test', () => {
  assert.equal(parseArgs(['--job', 'a', '--profile', 'b', '--state', 'c']).submit, undefined);
  for (const args of [['--headed'], ['--submit', '--submit'], ['--job'], ['--retry-failed'], ['--self-test', '--submit'], ['--channel', 'firefox'], ['--login-wait'], ['--login', '--submit'], ['--login', '--job', 'a']]) throwsCode(() => parseArgs(args), 'ARGUMENT_INVALID');
  assert.equal(parseArgs(['--login', '--login-wait', '--profile', '/dedicated']).login, true);
});

test('receipt classification requires fresh explicit visible success or rejection, never dialog close', async () => {
  for (const text of ['举报成功', '提交成功', '举报已提交', '举报提交成功！']) assert.equal(classifyReceipt([text]).status, 'success');
  for (const text of ['提交失败', '举报失败：稍后再试', '24小时内已举报过']) assert.equal(classifyReceipt([text]).status, 'rejected');
  for (const texts of [[], ['举报视频'], ['平台将过滤24小时内重复举报的内容'], ['举报成功？请等待'], ['请点击提交成功完成举报']]) assert.equal(classifyReceipt(texts).status, 'unknown');
  assert.equal(classifyReceipt(['举报成功'], ['举报成功']).status, 'unknown');
  assert.equal(classifyReceipt(['举报成功', '提交失败']).status, 'unknown');
  let filtered = false;
  const page = { getByText() { return { filter(options) { filtered = options.visible; return { async allTextContents() { return []; } }; } }; } };
  assert.deepEqual(await receiptTexts(page), []);
  assert.equal(filtered, true);
  assert.equal((await waitForReceipt(page, [], 0)).status, 'unknown');
});

test('profile lock protects all sibling jobs and refuses unrelated profiles', async t => {
  const f = await fixture(t), paths = await profilePaths(f.options.profile);
  const release = await acquireLock(paths);
  await rejectsCode(() => acquireLock(paths), 'JOB_LOCKED');
  await release();
  const release2 = await acquireLock(paths); await release2();
  await rejectsCode(() => profilePaths('/Users/test/Library/Application Support/Google/Chrome'), 'PROFILE_UNSAFE');
  const unrelated = path.join(f.root, 'unrelated'); await fs.mkdir(unrelated); await fs.writeFile(path.join(unrelated, 'Cookies'), 'Do not inspect');
  const mock = mockBrowser();
  await rejectsCode(() => run({ ...f.options, profile: unrelated }, mock.dependencies), 'PROFILE_UNSAFE');
  assert.equal(mock.calls.launches.length, 0);
});

test('default dry-run is headless, never clicks submit, persists prepared and closes context', async t => {
  const f = await fixture(t), mock = mockBrowser();
  const result = await run(f.options, mock.dependencies);
  assert.equal(result.status, 'prepared'); assert.equal(result.submitted, 0);
  assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.closed, 1);
  assert.equal(mock.calls.launches[0].options.headless, true);
  const state = await readJSON(f.options.state);
  assert.equal(state.kind, 'original'); assert.equal(state.link_count, 1); assert.equal(state.status, 'prepared'); assert.ok(state.updated_at);
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'prepared');
});

test('submit persists submitting in both durable files before mock click and records explicit success', async t => {
  const f = await fixture(t);
  const mock = mockBrowser({ beforeClick: async () => {
    assert.equal((await readJSON(f.options.state)).targets['1000000000000000001'].status, 'submitting');
    assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'submitting');
  } });
  const result = await run({ ...f.options, submit: true }, mock.dependencies);
  assert.equal(result.status, 'submitted'); assert.equal(result.submitted, 1);
  assert.equal(mock.calls.clicks, 1); assert.equal(mock.calls.closed, 1);
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].receipt, '举报已提交');
});

test('unknown receipt is never retried within job, with retry flag, or through another job/state path', async t => {
  const f = await fixture(t), mock = mockBrowser({ result: 'unknown' });
  assert.equal((await run({ ...f.options, submit: true }, mock.dependencies)).status, 'uncertain');
  for (const changes of [{}, { 'retry-failed': true }, { state: path.join(f.root, 'jobs', 'other-state.json') }]) {
    const second = mockBrowser();
    const result = await run({ ...f.options, submit: true, ...changes }, second.dependencies);
    assert.equal(second.calls.clicks, 0); assert.equal(second.calls.prepared.length, 0); assert.equal(result.skipped.length, 1);
  }
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'unknown');
});

test('previous successful report is not counted as a new submission on same-job rerun', async t => {
  const f = await fixture(t);
  const first = await run({ ...f.options, submit: true }, mockBrowser().dependencies);
  assert.equal(first.submitted, 1); assert.equal(first.previously_submitted, 0); assert.equal(first.verified_total, 1);
  const mock = mockBrowser();
  const repeated = await run({ ...f.options, submit: true }, mock.dependencies);
  assert.equal(repeated.status, 'already_submitted'); assert.equal(repeated.submitted, 0);
  assert.equal(repeated.previously_submitted, 1); assert.equal(repeated.verified_total, 1);
  assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.prepared.length, 0);
  const state = await readJSON(f.options.state);
  assert.equal(state.status, 'already_submitted'); assert.equal(state.submitted_this_run, 0); assert.equal(state.previously_submitted, 1);
});

test('changed original mapping in another job skips historical success without claiming submission for new evidence', async t => {
  const f = await fixture(t);
  await run({ ...f.options, submit: true }, mockBrowser().dependencies);
  const changedJob = path.join(f.root, 'changed-job.json');
  const changedState = path.join(f.root, 'jobs', 'changed-job-state.json');
  await fs.writeFile(changedJob, JSON.stringify(manifest([TARGET], { [TARGET]: TARGET2 })));
  const mock = mockBrowser();
  const result = await run({ ...f.options, job: changedJob, state: changedState, submit: true }, mock.dependencies);
  assert.equal(result.status, 'already_submitted'); assert.equal(result.submitted, 0);
  assert.equal(result.previously_submitted, 1); assert.equal(result.verified_total, 1);
  assert.equal(result.skipped[0].status, 'success'); assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.prepared.length, 0);
  const state = await readJSON(changedState), ledger = await readJSON(f.ledger);
  assert.equal(state.status, 'already_submitted'); assert.equal(state.submitted_this_run, 0);
  assert.notEqual(state.fingerprint, state.targets['1000000000000000001'].fingerprint);
  assert.equal(ledger.targets['1000000000000000001'].original_url, ORIGINAL);
});

test('click timeout remains unknown and closes context, never preparation failure', async t => {
  const f = await fixture(t), mock = mockBrowser({ clickError: new Error('click timed out') });
  await assert.rejects(run({ ...f.options, submit: true }, mock.dependencies), /click timed out/);
  assert.equal((await readJSON(f.options.state)).status, 'uncertain');
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'unknown');
  assert.equal(mock.calls.closed, 1);
});

test('explicit rejection alone enables same-job --retry-failed and dry-run cannot erase it', async t => {
  const f = await fixture(t);
  await run({ ...f.options, submit: true }, mockBrowser({ result: 'rejected' }).dependencies);
  await rejectsCode(() => run({ ...f.options, submit: true }, mockBrowser().dependencies), 'RETRY_REQUIRED');
  await rejectsCode(() => run(f.options, mockBrowser().dependencies), 'RETRY_REQUIRED');
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'rejected');
  const retry = mockBrowser();
  const result = await run({ ...f.options, submit: true, 'retry-failed': true }, retry.dependencies);
  assert.equal(result.status, 'submitted'); assert.equal(retry.calls.clicks, 1);
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].attempt, 2);
});

test('short-link aliases resolve before any report, and canonical duplicates submit only once', async t => {
  const f = await fixture(t, manifest([TARGET, SHORT]));
  let mock;
  mock = mockBrowser({ beforeClick: async () => assert.equal(mock.calls.resolutions, 2) });
  const result = await run({ ...f.options, submit: true }, mock.dependencies);
  assert.equal(result.unique_target_count, 1); assert.equal(mock.calls.clicks, 1);
});

test('conflicting alias originals fail before any preparation or submission', async t => {
  const f = await fixture(t, manifest([TARGET, SHORT], { [TARGET]: ORIGINAL, [SHORT]: TARGET2 })), mock = mockBrowser();
  await rejectsCode(() => run({ ...f.options, submit: true }, mock.dependencies), 'MAPPING_CONFLICT');
  assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.prepared.length, 0); assert.equal(mock.calls.closed, 1);
});

test('preparation failure closes context and is not recorded as explicit platform rejection', async t => {
  const f = await fixture(t), mock = mockBrowser({ preparationError: new Error('missing reason') });
  await assert.rejects(run({ ...f.options, submit: true }, mock.dependencies), /missing reason/);
  assert.equal((await readJSON(f.options.state)).status, 'preparation_failed');
  assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.closed, 1);
});

test('corrupt ledger is fail-closed and fingerprint mismatch cannot use another state', async t => {
  const f = await fixture(t), mock = mockBrowser();
  await run(f.options, mock.dependencies);
  const changed = manifest([TARGET], { [TARGET]: TARGET2 });
  await fs.writeFile(f.options.job, JSON.stringify(changed));
  await rejectsCode(() => run(f.options, mockBrowser().dependencies), 'STATE_MISMATCH');
  await fs.writeFile(f.ledger, '{broken');
  await rejectsCode(() => run(f.options, mockBrowser().dependencies), 'JSON_INVALID');
});

function uiMock({ reportScope = true, dialogRole = true, reasonCount = 1, submitEnabled = true, readback = ORIGINAL } = {}) {
  const calls = { report: 0, reason: 0, submit: 0, filled: null, videoScoped: false };
  function locator(count = 1, methods = {}) {
    const loc = { filter() { return this; }, async count() { return count; }, async waitFor() { if (!count) throw new Error('Timeout'); }, ...methods };
    return loc;
  }
  const submit = locator(1, { async isEnabled() { return submitEnabled; }, async click() { calls.submit++; } });
  const field = locator(1, { async fill(value) { calls.filled = value; }, async inputValue() { return readback; } });
  const reason = locator(reasonCount, { async click() { calls.reason++; } });
  const dialog = locator(1, {
    getByText(text) { assert.equal(text, REASON); return reason; },
    getByPlaceholder(text) { assert.equal(text, ORIGINAL_PLACEHOLDER); return field; },
    getByRole(role, options) { assert.equal(role, 'button'); assert.equal(options.name, '提交'); return submit; },
  });
  const page = {
    url: () => TARGET,
    async evaluate(_fn, data) { assert.ok(data.token.startsWith('original-')); calls.videoScoped = true; return reportScope; },
    locator(selector) {
      if (selector === 'body') return { async innerText() { return 'offline video content'; } };
      if (selector.startsWith('[data-original-report-control=')) return locator(1, { async click() { calls.report++; } });
      if (selector.startsWith('[data-original-report-dialog=')) return dialog;
      throw new Error(`Unexpected locator: ${selector}`);
    },
    getByRole(role) { assert.equal(role, 'dialog'); return dialogRole ? dialog : locator(0); },
    getByText(text) { assert.equal(text, '举报视频'); return locator(1, { async evaluate() { return true; } }); },
  };
  return { page, calls, submit };
}

test('UI preparation uses video-scoped report, exact original reason/placeholder and never submits', async () => {
  const mock = uiMock();
  const button = await prepareReport(mock.page, { videoId: '1000000000000000001', originalUrl: ORIGINAL });
  assert.equal(button, mock.submit); assert.equal(mock.calls.report, 1); assert.equal(mock.calls.reason, 1);
  assert.equal(mock.calls.filled, ORIGINAL); assert.equal(mock.calls.submit, 0); assert.equal(mock.calls.videoScoped, true);
});

test('UI guards refuse wrong target, unscoped report-user control, ambiguous reason and lost URL', async () => {
  await rejectsCode(() => videoReportControl(uiMock().page, '999'), 'TARGET_MISMATCH');
  await rejectsCode(() => videoReportControl(uiMock({ reportScope: false }).page, '1000000000000000001'), 'UI_UNCALIBRATED');
  await rejectsCode(() => prepareReport(uiMock({ reasonCount: 2 }).page, { videoId: '1000000000000000001', originalUrl: ORIGINAL }), 'UI_UNCALIBRATED');
  await rejectsCode(() => prepareReport(uiMock({ readback: 'changed' }).page, { videoId: '1000000000000000001', originalUrl: ORIGINAL }), 'FORM_UNVERIFIED');
  await rejectsCode(() => prepareReport(uiMock({ submitEnabled: false }).page, { videoId: '1000000000000000001', originalUrl: ORIGINAL }), 'FORM_UNVERIFIED');
  assert.ok(await reportDialog(uiMock({ dialogRole: false }).page));
});

test('login verification requires dedicated session cookie and visible authenticated UI, not QR alone', async () => {
  let visible = 0;
  const page = { locator() { return { filter() { return this; }, async count() { return visible; } }; }, getByText() { return this.locator(); } };
  const context = { async cookies() { return [{ name: 'sessionid', value: 'test-only', expires: -1 }]; } };
  assert.equal(await authenticatedSession(page, context), false);
  visible = 1; assert.equal(await authenticatedSession(page, context), true);
  assert.equal(await authenticatedSession(page, { async cookies() { return []; } }), false);
});

test('short original resolving to target is rejected before any report; evidence resolutions are deduplicated', async t => {
  const f = await fixture(t), mock = mockBrowser();
  mock.dependencies.resolveOriginal = async () => canonicalVideo(TARGET);
  await rejectsCode(() => run({ ...f.options, submit: true }, mock.dependencies), 'MAPPING_INVALID');
  assert.equal(mock.calls.clicks, 0); assert.equal(mock.calls.prepared.length, 0);
  const state = await readJSON(f.options.state);
  assert.equal(state.status, 'preparation_failed'); assert.equal(state.error_code, 'MAPPING_INVALID'); assert.deepEqual(state.targets, {});
  const g = await fixture(t, manifest([TARGET, TARGET2])), second = mockBrowser();
  await run(g.options, second.dependencies);
  assert.equal(second.calls.originalResolutions, 1);
});

test('preflight login failure persists a task failure without invented IDs and preserves uncertain prior state', async t => {
  const f = await fixture(t), mock = mockBrowser();
  const loginError = Object.assign(new Error('login required'), { code: 'LOGIN_REQUIRED' });
  mock.dependencies.resolveTarget = async () => { throw loginError; };
  await rejectsCode(() => run(f.options, mock.dependencies), 'LOGIN_REQUIRED');
  let state = await readJSON(f.options.state);
  assert.equal(state.status, 'preparation_failed'); assert.equal(state.error_code, 'LOGIN_REQUIRED'); assert.deepEqual(state.targets, {});
  await run({ ...f.options, submit: true }, mockBrowser({ result: 'unknown' }).dependencies);
  await rejectsCode(() => run(f.options, mock.dependencies), 'LOGIN_REQUIRED');
  state = await readJSON(f.options.state);
  assert.equal(state.status, 'uncertain'); assert.equal(state.targets['1000000000000000001'].status, 'unknown');
});

test('local uncertain row restores the shared guard if ledger row is missing', async t => {
  const f = await fixture(t);
  await run({ ...f.options, submit: true }, mockBrowser({ result: 'unknown' }).dependencies);
  await fs.writeFile(f.ledger, JSON.stringify({ schema_version: 1, kind: 'original', targets: {} }));
  const mock = mockBrowser();
  await run({ ...f.options, submit: true }, mock.dependencies);
  assert.equal(mock.calls.clicks, 0);
  assert.equal((await readJSON(f.ledger)).targets['1000000000000000001'].status, 'unknown');
});

test('explicit rejection cannot be retried through a changed state path', async t => {
  const f = await fixture(t);
  await run({ ...f.options, submit: true }, mockBrowser({ result: 'rejected' }).dependencies);
  const mock = mockBrowser();
  await rejectsCode(() => run({ ...f.options, state: path.join(f.root, 'jobs', 'changed-state.json'), submit: true, 'retry-failed': true }, mock.dependencies), 'STATE_MISMATCH');
  assert.equal(mock.calls.clicks, 0);
});

test('target browser redirects must preserve direct IDs and short links resolve only supported Douyin videos', async () => {
  let current = TARGET;
  const page = {
    async goto(url) { current = url === SHORT ? TARGET : TARGET2; },
    async waitForURL(predicate) { assert.equal(predicate(new URL(current)), true); },
    locator() { return { async innerText() { return ''; } }; },
    url: () => current,
  };
  assert.equal((await resolveTarget(page, { targetUrl: SHORT, originalUrl: ORIGINAL })).videoId, '1000000000000000001');
  await rejectsCode(() => resolveTarget(page, { targetUrl: TARGET, originalUrl: ORIGINAL }), 'TARGET_MISMATCH');
});

test('explicit login alone launches headed homepage and never opens a report or submits', async t => {
  const f = await fixture(t), calls = { options: null, urls: [], closed: 0 };
  const account = { filter() { return this; }, async count() { return 1; } };
  const page = { setDefaultTimeout() {}, async goto(url) { calls.urls.push(url); }, locator() { return account; }, getByText() { return account; } };
  const context = { pages: () => [page], async cookies() { return [{ name: 'sessionid', value: 'offline-only', expires: -1 }]; }, async close() { calls.closed++; } };
  const dependencies = { chromium: { async launchPersistentContext(_profile, options) { calls.options = options; return context; } } };
  const result = await login({ profile: f.options.profile, 'login-wait': true }, dependencies);
  assert.equal(result.authenticated, true); assert.equal(result.submitted, false);
  assert.equal(calls.options.headless, false); assert.deepEqual(calls.urls, ['https://www.douyin.com/']); assert.equal(calls.closed, 1);
  await rejectsCode(() => login({ profile: f.options.profile, submit: true }, dependencies), 'ARGUMENT_INVALID');
});

test('state cannot alias the ledger via a directory symlink', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'jobs'));
  const alias = path.join(f.root, 'alias'); await fs.symlink(path.join(f.root, 'jobs'), alias);
  await rejectsCode(() => run({ ...f.options, state: path.join(alias, 'original-ledger.json') }, mockBrowser().dependencies), 'STATE_UNSAFE');
});

test('self-test is deterministic offline guard-only', async () => {
  assert.deepEqual(await selfTest(), { status: 'self_test_passed', offline: true, live_submissions: 0 });
});
