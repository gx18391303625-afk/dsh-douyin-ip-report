#!/usr/bin/env node
/** Original-work video reports only. Headless dedicated profile; no OS input. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const REASON = '搬运、抄袭作品';
export const ORIGINAL_PLACEHOLDER = '请提供可公开访问的原始链接，并确认发布时间早于被举报内容';
const BLOCKED = new Set(['submitting', 'unknown', 'success']);
const STATUSES = new Set([...BLOCKED, 'rejected', 'prepared', 'preparing', 'preparation_failed']);
const now = () => new Date().toISOString();
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class OriginalRunnerError extends Error {
  constructor(code, message) { super(message); this.name = 'OriginalRunnerError'; this.code = code; }
}
function stop(code, message) { throw new OriginalRunnerError(code, message); }

export function normalizedLink(value) {
  if (typeof value !== 'string' || value !== value.trim()) stop('LINK_INVALID', 'Links must be exact HTTPS Douyin URLs.');
  let url;
  try { url = new URL(value); } catch { stop('LINK_INVALID', 'Invalid Douyin URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.douyin.com', 'v.douyin.com'].includes(url.hostname)) stop('LINK_INVALID', 'Only HTTPS Douyin video or short URLs are accepted.');
  if (url.hostname === 'www.douyin.com' && !/^\/video\/\d{1,30}\/?$/.test(url.pathname)) stop('LINK_INVALID', 'Expected a Douyin video URL.');
  if (url.hostname === 'v.douyin.com' && !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) stop('LINK_INVALID', 'Expected a Douyin short URL.');
  // Tracking parameters are not part of identity; short URLs retain their required slash.
  return `https://${url.hostname}${url.pathname.replace(/\/$/, '')}${url.hostname === 'v.douyin.com' ? '/' : ''}`;
}
export function validateJob(input) {
  if (!input || input.kind !== 'original' || (input.schema_version !== undefined && input.schema_version !== 1)) stop('JOB_INVALID', 'Expected an original-work job.');
  if (!Array.isArray(input.links) || !input.links.length || input.links.length > 1000) stop('JOB_INVALID', 'Supply 1–1000 user-provided targets.');
  if (!input.originals || typeof input.originals !== 'object' || Array.isArray(input.originals)) stop('MAPPING_INVALID', 'An exact target-to-original mapping is required.');
  const keys = Object.keys(input.originals);
  if (keys.length !== input.links.length || new Set(input.links).size !== input.links.length || input.links.some(link => !Object.hasOwn(input.originals, link)) || keys.some(key => !input.links.includes(key))) stop('MAPPING_INVALID', 'Original mapping keys must exactly match the supplied targets, with no extras or omissions.');
  const entries = input.links.map(target => ({ targetUrl: normalizedLink(target), originalUrl: normalizedLink(input.originals[target]) }));
  if (new Set(entries.map(entry => entry.targetUrl)).size !== entries.length) stop('JOB_INVALID', 'Duplicate normalized input targets.');
  if (entries.some(entry => entry.targetUrl === entry.originalUrl)) stop('MAPPING_INVALID', 'A target cannot also be its own original.');
  const fingerprint = digest({ kind: 'original', entries });
  return { kind: 'original', entries, fingerprint };
}
export function canonicalVideo(urlValue) {
  let url;
  try { url = new URL(urlValue); } catch { stop('TARGET_UNVERIFIED', 'Browser did not resolve a target video URL.'); }
  const id = url.pathname.match(/^\/video\/(\d{1,30})\/?$/)?.[1] || (url.pathname === '/jingxuan' ? url.searchParams.get('modal_id') : null);
  if (url.protocol !== 'https:' || url.hostname !== 'www.douyin.com' || url.username || url.password || url.port || !/^\d{1,30}$/.test(id || '')) stop('TARGET_UNVERIFIED', 'Browser must resolve the supplied target to an exact Douyin video ID.');
  return { videoId: id, canonicalUrl: `https://www.douyin.com/video/${id}` };
}
export function deduplicateResolved(entries) {
  const unique = new Map();
  for (const entry of entries) {
    if (!/^\d{1,30}$/.test(entry.videoId || '')) stop('TARGET_UNVERIFIED', 'Missing verified target ID.');
    const directOriginal = entry.originalUrl.match(/^https:\/\/www\.douyin\.com\/video\/(\d+)$/)?.[1];
    if (directOriginal === entry.videoId || entry.originalVideoId === entry.videoId) stop('MAPPING_INVALID', 'Resolved target is its own original.');
    const prior = unique.get(entry.videoId);
    if (prior && prior.originalUrl !== entry.originalUrl) stop('MAPPING_CONFLICT', 'Aliases of the same target have different original URLs.');
    if (prior) prior.inputUrls.push(entry.targetUrl);
    else unique.set(entry.videoId, { ...entry, inputUrls: [entry.targetUrl] });
  }
  return [...unique.values()];
}
export function submissionAllowed(record, fingerprint, retryFailed = false) {
  if (!record) {
    if (retryFailed) stop('NO_FAILED_ATTEMPT', '--retry-failed requires an explicit rejection for this same job and video.');
    return;
  }
  if (!STATUSES.has(record.status)) stop('STATE_INVALID', 'Unknown persisted status; refusing to bypass submission guards.');
  if (BLOCKED.has(record.status)) stop('DUPLICATE_BLOCKED', 'This video was submitted or its result is unknown. Never retry it automatically.');
  if (record.fingerprint !== fingerprint) stop('STATE_MISMATCH', 'This video belongs to another job; its state cannot be reused.');
  if (record.status === 'rejected' && !retryFailed) stop('RETRY_REQUIRED', 'Explicit rejection requires --retry-failed --submit.');
  if (retryFailed && record.status !== 'rejected') stop('NO_FAILED_ATTEMPT', 'Only an explicit rejection can be retried.');
}
export function parseArgs(argv) {
  const result = {}, flags = new Set(['submit', 'retry-failed', 'self-test', 'help', 'login', 'login-wait']);
  const valued = new Set(['job', 'profile', 'state', 'channel', 'executable-path']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i], name = token.replace(/^--/, '');
    if (!token.startsWith('--') || (!flags.has(name) && !valued.has(name)) || Object.hasOwn(result, name)) stop('ARGUMENT_INVALID', 'Unknown or duplicate option; headful/OS fallbacks are not supported.');
    if (flags.has(name)) result[name] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) stop('ARGUMENT_INVALID', `Missing --${name} value.`);
      result[name] = argv[++i];
    }
  }
  if (result['login-wait'] && !result.login) stop('ARGUMENT_INVALID', '--login-wait requires --login.');
  if (result.login && ['submit', 'retry-failed', 'job', 'state', 'self-test'].some(key => result[key])) stop('ARGUMENT_INVALID', '--login is an isolated interactive action and cannot prepare or submit reports.');
  if (result['retry-failed'] && !result.submit) stop('ARGUMENT_INVALID', '--retry-failed requires --submit.');
  if (result['self-test'] && Object.keys(result).some(key => !['self-test', 'channel', 'executable-path'].includes(key))) stop('ARGUMENT_INVALID', '--self-test is offline and accepts no job/profile/submit options.');
  if (result.channel && !['chrome', 'chromium'].includes(result.channel)) stop('ARGUMENT_INVALID', '--channel supports chrome or chromium only.');
  return result;
}
async function json(file, optional = false) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    stop('JSON_INVALID', `Missing or invalid JSON: ${file}`);
  }
}
async function privateJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
}
export async function profilePaths(raw) {
  if (!raw || !path.isAbsolute(raw)) stop('PROFILE_REQUIRED', '--profile must be an absolute dedicated original browser profile.');
  const profile = path.resolve(raw), portable = profile.replaceAll('\\', '/');
  if (profile === os.homedir() || profile === path.parse(profile).root || /(?:Google[ /]Chrome|Chromium|Microsoft[ /]Edge)(?:[ /]|$)/i.test(portable) || /\/Library\/Application Support\//.test(portable)) stop('PROFILE_UNSAFE', 'Never use a daily Chrome/Edge profile or home directory.');
  await fs.mkdir(path.dirname(profile), { recursive: true, mode: 0o700 });
  // Resolve the parent before deriving locks/ledger: path aliases share the same guard.
  const realParent = await fs.realpath(path.dirname(profile));
  const resolved = path.join(realParent, path.basename(profile));
  const stat = await fs.lstat(resolved).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) stop('PROFILE_UNSAFE', 'Profile cannot be a symbolic link or non-directory.');
  if (realParent !== path.dirname(profile)) return profilePaths(resolved);
  const jobs = path.join(realParent, 'jobs');
  const jobsStat = await fs.lstat(jobs).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (resolved === jobs || jobsStat?.isSymbolicLink() || (jobsStat && !jobsStat.isDirectory())) stop('PROFILE_UNSAFE', 'Jobs must be a real sibling directory, separate from the profile.');
  return { profile: resolved, jobs, ledger: path.join(jobs, 'original-ledger.json'), lock: path.join(jobs, 'original-runner.lock') };
}
async function initializeProfile(profile) {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const names = await fs.readdir(profile);
  const markers = ['.douyin-original-runner-profile', '.douyin-report-runner-profile'];
  if (names.length && !markers.some(marker => names.includes(marker))) stop('PROFILE_UNSAFE', 'Existing unrelated browser profiles are not accepted or inspected.');
  const marker = path.join(profile, markers[0]);
  if (!names.includes(markers[0])) await fs.writeFile(marker, 'Dedicated Douyin original-work report profile\n', { flag: 'wx', mode: 0o600 });
}
export async function acquireLock(paths) {
  await fs.mkdir(paths.jobs, { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await fs.open(paths.lock, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; stop('JOB_LOCKED', 'An original runner holds this jobs/profile lock. Inspect stale locks manually; never auto-remove them.'); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, profile: paths.profile, started_at: now() }) + '\n'); }
  catch (error) { await handle.close(); await fs.unlink(paths.lock); throw error; }
  return async () => { await handle.close(); await fs.unlink(paths.lock); };
}
async function unique(locator, label, timeout = 15000) {
  const found = locator.filter({ visible: true });
  if (!await found.count()) await found.waitFor({ state: 'visible', timeout });
  if (await found.count() !== 1) stop('UI_UNCALIBRATED', `Expected one visible ${label}.`);
  return found;
}
export async function assertNoChallenge(page) {
  const text = await page.locator('body').innerText();
  if (/安全验证|滑块验证|请完成验证|请完成下方验证|拖动滑块|点击验证/.test(text)) stop('HUMAN_VERIFICATION_REQUIRED', 'Stop for interactive verification in the dedicated session; no headful fallback.');
  if (/扫码登录|登录后继续举报|请先登录/.test(text)) stop('LOGIN_REQUIRED', 'Dedicated original profile needs login; this runner never opens a headful browser.');
}
export async function resolveTarget(page, entry) {
  await page.goto(entry.targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(url => {
    try { canonicalVideo(url.href); return true; } catch { return false; }
  }, { timeout: 20000 });
  await assertNoChallenge(page);
  const resolved = canonicalVideo(page.url());
  const suppliedId = entry.targetUrl.match(/^https:\/\/www\.douyin\.com\/video\/(\d+)$/)?.[1];
  if (suppliedId && suppliedId !== resolved.videoId) stop('TARGET_MISMATCH', 'Direct target navigation changed its video ID.');
  return { ...entry, ...resolved };
}
export async function resolveOriginal(page, originalUrl) {
  const resolved = await resolveTarget(page, { targetUrl: originalUrl });
  return { videoId: resolved.videoId, canonicalUrl: resolved.canonicalUrl };
}
export async function videoReportControl(page, videoId) {
  const current = canonicalVideo(page.url());
  if (current.videoId !== videoId) stop('TARGET_MISMATCH', 'Page no longer displays the requested target.');
  const token = `original-${crypto.randomUUID()}`;
  // Start from the actual visible video, never a user-card/report-user menu.
  // Fail closed if multiple visible videos or no tight content-scoped control exists.
  const scoped = await page.evaluate(({ token }) => {
    const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const videos = [...document.querySelectorAll('video')].filter(visible);
    if (videos.length !== 1) return false;
    for (let wrapper = videos[0].parentElement; wrapper && wrapper !== document.body; wrapper = wrapper.parentElement) {
      if (wrapper.querySelectorAll('video').length !== 1) return false;
      const candidates = [...wrapper.querySelectorAll('button,[role="button"],a,span,div')].filter(element => visible(element) && (element.getAttribute('aria-label') || element.textContent.trim()) === '举报');
      const leaves = candidates.filter(element => !candidates.some(other => other !== element && element.contains(other)));
      if (leaves.length > 1) return false;
      if (leaves.length === 1) {
        const candidate = leaves[0];
        if (candidate.closest('[data-e2e*="user"],[data-e2e*="author"],[class*="user-card"],[class*="UserCard"]')) return false;
        candidate.setAttribute('data-original-report-control', token);
        return true;
      }
    }
    return false;
  }, { token });
  if (!scoped) stop('UI_UNCALIBRATED', 'Cannot uniquely scope 举报 to the target video content (never report a user).');
  return unique(page.locator(`[data-original-report-control="${token}"]`), 'video report control');
}
export async function reportDialog(page) {
  const dialogs = page.getByRole('dialog').filter({ hasText: '举报视频' }).filter({ visible: true });
  if (await dialogs.count()) return unique(dialogs, 'video report dialog');
  // Some Douyin versions expose no dialog role. Scope from exact 举报视频 title,
  // never from the whole body, and require the original-work reason in that scope.
  const title = await unique(page.getByText('举报视频', { exact: true }), 'report-video title');
  const token = `original-dialog-${crypto.randomUUID()}`;
  const scoped = await title.evaluate((element, token) => {
    for (let wrapper = element.parentElement; wrapper && wrapper !== document.body; wrapper = wrapper.parentElement) {
      if ((wrapper.innerText || '').includes('搬运、抄袭作品')) { wrapper.setAttribute('data-original-report-dialog', token); return true; }
    }
    return false;
  }, token);
  if (!scoped) stop('UI_UNCALIBRATED', 'No tightly scoped video report dialog was found.');
  return unique(page.locator(`[data-original-report-dialog="${token}"]`), 'video report dialog');
}
export async function prepareReport(page, entry) {
  await assertNoChallenge(page);
  await (await videoReportControl(page, entry.videoId)).click();
  const dialog = await reportDialog(page);
  const reason = await unique(dialog.getByText(REASON, { exact: true }), 'original-work reason');
  await reason.click();
  const field = await unique(dialog.getByPlaceholder(ORIGINAL_PLACEHOLDER, { exact: true }), 'original URL textbox');
  await field.fill(entry.originalUrl);
  if (await field.inputValue() !== entry.originalUrl) stop('FORM_UNVERIFIED', 'Original URL was changed or lost.');
  if (canonicalVideo(page.url()).videoId !== entry.videoId) stop('TARGET_MISMATCH', 'Target changed while preparing the report.');
  await assertNoChallenge(page);
  const button = await unique(dialog.getByRole('button', { name: '提交', exact: true }), 'original report submit');
  if (!await button.isEnabled()) stop('FORM_UNVERIFIED', 'Original report submit is disabled.');
  return button;
}
const SUCCESS = /^(?:举报成功|提交成功|举报已提交|举报提交成功)[。！!\s]*$/;
const REJECTED = /^(?:举报提交失败|提交失败|提交未成功|未提交成功|提交出错|举报失败|24\s*小时内已举报过|你已举报过该视频|您已举报过该视频)(?:$|[，,。！!：:\s])/;
export function classifyReceipt(texts, baseline = []) {
  const old = new Set(baseline.map(text => text.trim()));
  const fresh = texts.map(text => text.trim()).filter(text => text && !old.has(text));
  const success = fresh.filter(text => SUCCESS.test(text));
  const rejected = fresh.filter(text => REJECTED.test(text));
  if (success.length && rejected.length) return { status: 'unknown', receipt: 'Conflicting visible success and rejection messages.' };
  if (success.length) return { status: 'success', receipt: success[0] };
  if (rejected.length) return { status: 'rejected', receipt: rejected[0] };
  return { status: 'unknown', receipt: null };
}
export async function receiptTexts(page) {
  // getByText exact + visible filtering excludes hidden templates and static text
  // containing one of these phrases. Dialog disappearance is deliberately ignored.
  return page.getByText(new RegExp(`${SUCCESS.source}|${REJECTED.source}`)).filter({ visible: true }).allTextContents();
}
export async function waitForReceipt(page, baseline, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const result = classifyReceipt(await receiptTexts(page), baseline);
    if (result.status !== 'unknown' || result.receipt) return result;
    if (Date.now() >= end) return result;
    await page.waitForTimeout(200);
  } while (true);
}
function validateLedger(ledger) {
  if (ledger.schema_version !== 1 || ledger.kind !== 'original' || !ledger.targets || typeof ledger.targets !== 'object' || Array.isArray(ledger.targets)) stop('LEDGER_INVALID', 'Unrecognized original ledger; never reset it automatically.');
  for (const [id, record] of Object.entries(ledger.targets)) {
    if (!/^\d{1,30}$/.test(id) || !record || !STATUSES.has(record.status) || typeof record.fingerprint !== 'string') stop('LEDGER_INVALID', 'Invalid original ledger record; inspect it manually.');
  }
}
export async function run(options, dependencies = {}) {
  if (!options.job || !options.state || !options.profile) stop('ARGUMENT_INVALID', '--job, --profile and --state are required.');
  if (options['retry-failed'] && !options.submit) stop('ARGUMENT_INVALID', '--retry-failed requires --submit.');
  const job = validateJob(await json(path.resolve(options.job)));
  const paths = await profilePaths(options.profile);
  const jobPath = await fs.realpath(path.resolve(options.job));
  await fs.mkdir(path.dirname(path.resolve(options.state)), { recursive: true, mode: 0o700 });
  const statePath = path.join(await fs.realpath(path.dirname(path.resolve(options.state))), path.basename(options.state));
  const stateStat = await fs.lstat(statePath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (stateStat?.isSymbolicLink() || [paths.ledger, paths.lock, jobPath].includes(statePath) || statePath.startsWith(paths.profile + path.sep)) stop('STATE_UNSAFE', 'State must be separate from manifest, profile and shared ledger/lock, without symlink aliases.');
  const release = await acquireLock(paths);
  let context, state, ledger, active;
  let submittedThisRun = 0, previouslySubmitted = 0;
  const persist = async () => {
    state.updated_at = now();
    state.link_count = job.entries.length;
    const statuses = Object.values(state.targets).map(row => row.status);
    state.status = statuses.some(status => ['unknown', 'submitting'].includes(status)) ? 'uncertain'
      : statuses.includes('rejected') ? 'submission_failed'
      : statuses.includes('preparation_failed') ? 'preparation_failed'
      : statuses.includes('preparing') ? 'preparing'
      : statuses.length && statuses.every(status => status === 'success') ? (submittedThisRun ? 'submitted' : 'already_submitted') : 'prepared';
    state.submitted_this_run = submittedThisRun;
    state.previously_submitted = previouslySubmitted;
    state.verified_total = statuses.filter(status => status === 'success').length;
    // Ledger first: a crash between the two writes must never allow another job
    // or a changed state path to repeat a potentially submitted target.
    await privateJSON(paths.ledger, ledger);
    await privateJSON(statePath, state);
  };
  const record = async (entry, status, extra = {}) => {
    const value = { ...state.targets[entry.videoId], fingerprint: job.fingerprint, status, job_path: jobPath, state_path: statePath, target_url: entry.canonicalUrl, input_urls: entry.inputUrls, original_url: entry.originalUrl, original_video_id: entry.originalVideoId, updated_at: now(), ...extra };
    state.targets[entry.videoId] = value;
    ledger.targets[entry.videoId] = value;
    await persist();
  };
  try {
    await initializeProfile(paths.profile);
    if ((await fs.lstat(paths.ledger).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }))?.isSymbolicLink()) stop('LEDGER_INVALID', 'Ledger cannot be a symbolic link.');
    ledger = await json(paths.ledger, true) || { schema_version: 1, kind: 'original', targets: {} };
    validateLedger(ledger);
    const prior = await json(statePath, true);
    if (prior && (prior.schema_version !== 1 || prior.kind !== 'original' || prior.fingerprint !== job.fingerprint || !prior.targets || typeof prior.targets !== 'object' || Array.isArray(prior.targets))) stop('STATE_MISMATCH', 'State does not match this exact target/original job.');
    state = prior || { schema_version: 1, kind: 'original', fingerprint: job.fingerprint, job_path: jobPath, targets: {}, created_at: now() };
    // Reject known dangerous prior state before launching any browser, even if
    // someone removed the corresponding ledger record.
    for (const value of Object.values(state.targets)) {
      if (!value || !STATUSES.has(value.status)) stop('STATE_INVALID', 'Invalid persisted target state.');
    }
    let chromium = dependencies.chromium;
    if (!chromium) {
      try { chromium = require('playwright-core').chromium; }
      catch { stop('DEPENDENCY_MISSING', 'Configure NODE_PATH for the runtime playwright-core package.'); }
    }
    const launch = { headless: true, acceptDownloads: false };
    if (options['executable-path']) {
      if (!path.isAbsolute(options['executable-path']) || !(await fs.stat(options['executable-path']).catch(() => null))?.isFile()) stop('ARGUMENT_INVALID', '--executable-path must be an existing absolute executable file.');
      launch.executablePath = options['executable-path'];
    } else if (options.channel) launch.channel = options.channel;
    context = await chromium.launchPersistentContext(paths.profile, launch);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    const resolved = [];
    for (const entry of job.entries) resolved.push(await (dependencies.resolveTarget || resolveTarget)(page, entry));
    const originals = new Map();
    for (const entry of resolved) {
      if (!originals.has(entry.originalUrl)) {
        const original = await (dependencies.resolveOriginal || resolveOriginal)(page, entry.originalUrl);
        if (!/^\d{1,30}$/.test(original?.videoId || '')) stop('ORIGINAL_UNVERIFIED', 'The supplied original did not resolve to a verified Douyin video ID.');
        originals.set(entry.originalUrl, original.videoId);
      }
      entry.originalVideoId = originals.get(entry.originalUrl);
    }
    const entries = deduplicateResolved(resolved), skipped = [];
    // Preflight every canonical ID before any form is submitted.
    const pending = [];
    for (const entry of entries) {
      const shared = ledger.targets[entry.videoId], local = state.targets[entry.videoId];
      const dangerous = [shared, local].find(value => value && BLOCKED.has(value.status));
      if (dangerous) {
        state.targets[entry.videoId] = dangerous;
        ledger.targets[entry.videoId] = dangerous;
        if (dangerous.status === 'success') previouslySubmitted++;
        skipped.push({ video_id: entry.videoId, status: dangerous.status, reason: 'already_submitted_or_unknown' });
        continue;
      }
      const existing = shared || local;
      if (shared && local && (shared.fingerprint !== local.fingerprint || shared.status !== local.status)) stop('STATE_MISMATCH', 'Local state and shared ledger disagree; inspect before retrying.');
      if (options.submit) {
        submissionAllowed(existing, job.fingerprint, !!options['retry-failed']);
        if (existing?.status === 'rejected' && (existing.job_path !== jobPath || existing.state_path !== statePath)) stop('STATE_MISMATCH', 'Retry must reuse the rejected job and its original state path.');
      }
      else {
        if (existing?.fingerprint !== undefined && existing.fingerprint !== job.fingerprint) stop('STATE_MISMATCH', 'Target is already bound to another job.');
        if (existing?.status === 'rejected') stop('RETRY_REQUIRED', 'Preserving the explicit rejection: only --retry-failed --submit can change this record.');
      }
      pending.push(entry);
    }
    for (const entry of pending) {
      active = entry;
      await record(entry, 'preparing');
      await page.goto(entry.canonicalUrl, { waitUntil: 'domcontentloaded' });
      const button = await (dependencies.prepareReport || prepareReport)(page, entry);
      await record(entry, 'prepared');
      if (options.submit) {
        const baseline = await (dependencies.receiptTexts || receiptTexts)(page);
        await record(entry, 'submitting', { attempt: (state.targets[entry.videoId].attempt || 0) + 1, receipt: null });
        // From this point any exception is unknown, including a click timeout.
        await button.click();
        await record(entry, 'unknown');
        const result = await (dependencies.waitForReceipt || waitForReceipt)(page, baseline);
        if (!['success', 'rejected', 'unknown'].includes(result.status)) stop('RECEIPT_INVALID', 'Unexpected receipt classification.');
        if (result.status === 'success') submittedThisRun++;
        await record(entry, result.status, { receipt: result.receipt });
      }
      active = null;
    }
    await persist();
    const statuses = entries.map(entry => state.targets[entry.videoId]?.status || ledger.targets[entry.videoId]?.status);
    return { status: state.status, kind: 'original', submitted: submittedThisRun, previously_submitted: previouslySubmitted, verified_total: statuses.filter(status => status === 'success').length, target_count: job.entries.length, unique_target_count: entries.length, prepared: statuses.filter(status => status === 'prepared').length, unknown: statuses.filter(status => status === 'unknown' || status === 'submitting').length, rejected: statuses.filter(status => status === 'rejected').length, skipped, state_path: statePath, ledger_path: paths.ledger };
  } catch (error) {
    if (active && state && ledger) {
      const status = state.targets[active.videoId]?.status;
      // A failed persistence operation might already have stored submitting in
      // one file. Never downgrade it to a preparation failure.
      if (status === 'submitting' || status === 'unknown') await record(active, 'unknown', { error_code: error.code || 'RUNNER_ERROR' }).catch(() => {});
      else if (!['success', 'rejected'].includes(status)) await record(active, 'preparation_failed', { error_code: error.code || 'RUNNER_ERROR' }).catch(() => {});
    } else if (state) {
      // Resolution/login can fail before a canonical ID is known. Keep a task
      // level failure instead of inventing per-video rows or losing the task.
      const uncertain = state.status === 'uncertain' || Object.values(state.targets).some(row => ['submitting', 'unknown'].includes(row.status));
      state.status = uncertain ? 'uncertain' : Object.values(state.targets).some(row => row.status === 'rejected') ? 'submission_failed' : 'preparation_failed';
      state.error_code = error.code || 'RUNNER_ERROR';
      state.submitted_this_run = submittedThisRun;
      state.previously_submitted = previouslySubmitted;
      state.verified_total = Object.values(state.targets).filter(row => row.status === 'success').length;
      state.link_count = job.entries.length;
      state.updated_at = now();
      await privateJSON(statePath, state).catch(() => {});
    }
    throw error;
  } finally {
    if (context) await context.close().catch(() => {});
    await release();
  }
}
export async function authenticatedSession(page, context) {
  // Cookies are read only from this dedicated Playwright context. Never inspect
  // another Chrome profile, and never persist cookie values in state/output.
  const cookies = await context.cookies('https://www.douyin.com/');
  const session = cookies.some(cookie => ['sessionid', 'sessionid_ss'].includes(cookie.name) && cookie.value && (cookie.expires === -1 || cookie.expires * 1000 > Date.now()));
  const account = page.locator('[data-e2e="user-avatar"], [data-e2e="user-info"]').filter({ visible: true });
  const logout = page.getByText('退出登录', { exact: true }).filter({ visible: true });
  return !!session && (!!await account.count() || !!await logout.count());
}
export async function login(options, dependencies = {}) {
  if (options.submit || options['retry-failed'] || options.job || options.state) stop('ARGUMENT_INVALID', 'Login cannot prepare or submit reports.');
  const paths = await profilePaths(options.profile), release = await acquireLock(paths);
  let context;
  try {
    await initializeProfile(paths.profile);
    let chromium = dependencies.chromium;
    if (!chromium) {
      try { chromium = require('playwright-core').chromium; }
      catch { stop('DEPENDENCY_MISSING', 'Configure NODE_PATH for the runtime playwright-core package.'); }
    }
    const launch = { headless: false, acceptDownloads: false };
    if (options['executable-path']) {
      if (!path.isAbsolute(options['executable-path']) || !(await fs.stat(options['executable-path']).catch(() => null))?.isFile()) stop('ARGUMENT_INVALID', '--executable-path must be an existing absolute executable file.');
      launch.executablePath = options['executable-path'];
    } else if (options.channel) launch.channel = options.channel;
    // The only headed path is an explicit --login action, never a fallback.
    context = await chromium.launchPersistentContext(paths.profile, launch);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded' });
    if (options['login-wait']) {
      process.stderr.write('请在专用浏览器扫码登录；核验登录后将自动关闭。\n');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (!await authenticatedSession(page, context)) {
        if (Date.now() >= deadline) stop('LOGIN_TIMEOUT', 'No authenticated dedicated session was verified within 5 minutes.');
        await page.waitForTimeout(1000);
      }
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question('请在专用浏览器完成登录，再回到终端按 Enter 核验。'); }
      finally { terminal.close(); }
      if (!await authenticatedSession(page, context)) stop('LOGIN_UNVERIFIED', 'QR display or terminal confirmation alone is not proof of login.');
    }
    return { status: 'login_form_available', kind: 'original', authenticated: true, submitted: false };
  } finally {
    if (context) await context.close().catch(() => {});
    await release();
  }
}
export async function selfTest() {
  // Offline guards only. Complete browser/storage mocks live in test/original-runner*.mjs.
  const target = 'https://www.douyin.com/video/1000000000000000001';
  const original = 'https://v.douyin.com/OFFLINE_FIXTURE/';
  const checked = validateJob({ kind: 'original', links: [target], originals: { [target]: original } });
  assert.equal(checked.entries[0].originalUrl, original);
  assert.throws(() => validateJob({ kind: 'patent', links: [target], originals: { [target]: original } }));
  assert.throws(() => submissionAllowed({ status: 'unknown', fingerprint: checked.fingerprint }, checked.fingerprint, true));
  assert.equal(classifyReceipt(['举报已提交']).status, 'success');
  assert.equal(classifyReceipt([]).status, 'unknown');
  assert.equal(classifyReceipt(['提交失败']).status, 'rejected');
  return { status: 'self_test_passed', offline: true, live_submissions: 0 };
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log('Usage: original-runner.mjs --job JOB --profile ABS_DEDICATED_PROFILE --state STATE [--channel chrome|chromium | --executable-path ABS_BROWSER] [--submit] [--retry-failed]\n       original-runner.mjs --self-test\nDefault is headless dry-run: fill original-work video dialog, never submit, close context.'); return; }
  const result = options['self-test'] ? await selfTest() : options.login ? await login(options) : await run(options);
  console.log(JSON.stringify(result));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'error', code: error.code || 'RUNNER_ERROR', message: error.message })); process.exitCode = 1; });
}
