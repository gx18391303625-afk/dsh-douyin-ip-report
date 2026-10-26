#!/usr/bin/env node
/** Local deterministic Douyin runner. No model calls and no OS input control. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const REPORT_URL = 'https://www.douyin.com/qinquan/report?enter_from=pc_douyin';
const HISTORY_URL = 'https://www.douyin.com/qinquan/history?enter_from=pc_douyin';
const LINKS_PLACEHOLDER = '请粘贴要举报的内容链接或抖音号，最多1000条，粘贴后请点击「开始识别」';
const REPORT_KINDS = {
  patent: { name: '假冒专利', placeholder: '如未经许可使用我的专利，专利为我个人所有，我已提供专利证书' },
  trademark: { name: '假冒商标', placeholder: '被投诉内容未经许可使用了我注册的商标' },
};
const FINAL_STATES = new Set(['submitting', 'submission_clicked_unverified', 'submitted']);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
const uploadSelections = new WeakMap();

export class WorkflowError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function stop(code, message) { throw new WorkflowError(code, message); }
function playwright() {
  try { return require('playwright'); }
  catch {
    try { return require('playwright-core'); }
    catch { stop('DEPENDENCY_MISSING', 'Install Playwright or configure the host Node module path.'); }
  }
}
async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { stop('JSON_INVALID', 'A required JSON file is missing or invalid.'); }
}
async function privateJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await fs.rename(temp, file);
}
export function normalizedLink(link) {
  let u;
  try { u = new URL(link); } catch { stop('LINK_INVALID', 'Invalid complaint link.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port ||
      !['www.douyin.com', 'v.douyin.com'].includes(u.hostname)) stop('LINK_INVALID', 'Unsupported complaint link.');
  if (u.hostname === 'www.douyin.com' && !/^\/video\/\d+\/?$/.test(u.pathname)) stop('LINK_INVALID', 'Unsupported video URL.');
  if (u.hostname === 'v.douyin.com' && !/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) stop('LINK_INVALID', 'Unsupported short URL.');
  return `https://${u.hostname}${u.pathname.replace(/\/$/, '')}`;
}
export async function validateJob(job, identities) {
  if (job.schema_version !== 1 || !['patent', 'trademark'].includes(job.kind)) stop('JOB_INVALID', 'Unsupported manifest.');
  if (typeof job.description !== 'string' || !job.description.trim() || job.description.length > 500) stop('JOB_INVALID', 'Description must contain 1–500 UTF-16 units.');
  if (!Array.isArray(job.links) || !job.links.length || job.links.length > 1000) stop('JOB_INVALID', 'Supply 1–1000 complaint links.');
  const links = job.links.map(normalizedLink);
  if (new Set(links).size !== links.length) stop('JOB_INVALID', 'Manifest contains duplicate links; rerun preflight.');
  const identity = identities?.[job.kind];
  if (!identity || typeof identity.organization !== 'string' || !identity.organization.trim() ||
      typeof identity.phone !== 'string' || !/^\d{6,20}$/.test(identity.phone) ||
      (identity.email !== undefined && identity.email !== '' && (typeof identity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)))) {
    stop('IDENTITY_INVALID', 'Provide this complaint type’s organization and phone, plus email if required by the website.');
  }
  if (!Array.isArray(job.evidence) || job.evidence.length !== (job.kind === 'patent' ? 6 : 1)) stop('JOB_INVALID', 'Evidence image count does not match the selected complaint type.');
  const files = [...job.evidence, job.business_license, job.identity_reference];
  for (const record of files) {
    if (!record || typeof record.path !== 'string' || !path.isAbsolute(record.path)) stop('MATERIAL_INVALID', 'Material paths must be absolute.');
    let data;
    try { data = await fs.readFile(record.path); } catch { stop('MATERIAL_MISSING', 'A material file is missing or unreadable.'); }
    if (!data.length || data.length > 5_000_000 || record.bytes !== data.length || hash(data) !== record.sha256) stop('MATERIAL_CHANGED', 'Material changed after preflight; regenerate the manifest.');
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = data.subarray(0, 3).equals(Buffer.from([255,216,255]));
    if (!((png && record.media_type === 'image/png') || (jpg && record.media_type === 'image/jpeg'))) stop('MATERIAL_INVALID', 'Image signature does not match its media type.');
  }
  const fingerprint = hash(JSON.stringify({ kind: job.kind, description: job.description, links,
    evidence: job.evidence.map(f => f.sha256), license: job.business_license.sha256, identity }));
  return { job: { ...job, links }, identity, fingerprint };
}
export function submissionAllowed(prior, fingerprint, retryFailed) {
  if (!prior) {
    if (retryFailed) stop('NO_FAILED_ATTEMPT', '--retry-failed requires a previously recorded explicit submission failure.');
    return;
  }
  if (prior.fingerprint !== fingerprint) stop('STATE_MISMATCH', 'State belongs to another job or identity; use its matching inputs.');
  if (FINAL_STATES.has(prior.status)) stop('DUPLICATE_BLOCKED', 'Submission already clicked or its outcome is uncertain. Check the platform record; do not resubmit this job.');
  if (prior.status === 'failed' && !retryFailed) stop('RETRY_REQUIRED', 'An explicit submission failure was recorded. Retry only with --retry-failed.');
  if (retryFailed && prior.status !== 'failed') stop('NO_FAILED_ATTEMPT', 'Only an explicit submission failure permits --retry-failed.');
}

async function visible(locator) { return locator.filter({ visible: true }); }
async function unique(locator, label, hidden = false) {
  const target = hidden ? locator : await visible(locator);
  if (!await target.count()) await target.waitFor({ state: hidden ? 'attached' : 'visible', timeout: 15000 });
  if (await target.count() !== 1) stop('UI_UNCALIBRATED', `Expected one ${label}; the page needs selector calibration.`);
  return target;
}
export async function complaintLinksField(page) {
  // Tiptap's placeholder is on a child paragraph and may disappear after typing.
  return unique(page.getByPlaceholder(LINKS_PLACEHOLDER, { exact: true }).or(
    page.locator('div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]')
  ), 'complaint links');
}
export async function complaintLinksValue(page) {
  const field = await complaintLinksField(page);
  // Paragraph blocks can contribute extra blank lines to innerText.
  return field.evaluate(el => (el.isContentEditable ? el.innerText : el.value)
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n'));
}
export function browserLinkText(job) {
  // Douyin's form parser requires the trailing slash on v.douyin.com links.
  // Keep the canonical manifest/fingerprint unchanged for retry protection.
  return job.links.map(link => new URL(link).hostname === 'v.douyin.com' ? link.replace(/\/$/, '') + '/' : link).join('\n');
}
export async function requireReportForm(page, code = 'LOGIN_UNVERIFIED') {
  await assertNoChallenge(page);
  try {
    const field = await complaintLinksField(page);
    for (const name of ['假冒专利', '假冒商标', '开始识别']) {
      await unique(page.getByRole('button', { name, exact: true }), name);
    }
    await assertNoChallenge(page);
    return field;
  } catch (error) {
    await assertNoChallenge(page);
    if (error.name === 'TimeoutError') stop(code, 'The report form is unavailable. Check the dedicated browser login session.');
    throw error;
  }
}
async function verifyReportKind(page, kind, timeout = 15000) {
  const expected = REPORT_KINDS[kind];
  if (!expected) stop('JOB_INVALID', 'Unsupported complaint type.');
  // These type-specific placeholders were verified on the real report page.
  const description = page.getByPlaceholder(expected.placeholder, { exact: true }).filter({ visible: true });
  try { await description.waitFor({ state: 'visible', timeout }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    stop('REPORT_KIND_UNVERIFIED', 'The report form did not switch to the requested complaint type.');
  }
  await unique(description, 'complaint type description');
}
export async function selectComplaintKind(page, kind, timeout = 15000) {
  const expected = REPORT_KINDS[kind];
  if (!expected) stop('JOB_INVALID', 'Unsupported complaint type.');
  await clickText(page, [expected.name]);
  await verifyReportKind(page, kind, timeout);
}
async function textControl(page, names, role = 'button', required = true) {
  const end = Date.now() + (required ? 15000 : 0);
  do {
  for (const name of names) {
    let candidate = await visible(page.getByRole(role, { name, exact: true }));
    if (await candidate.count()) return unique(candidate, name);
    candidate = await visible(page.getByText(name, { exact: true }));
    if (await candidate.count()) return unique(candidate, name);
  }
    if (required) await page.waitForTimeout(200);
  } while (Date.now() < end);
  if (required) stop('UI_UNCALIBRATED', `Cannot uniquely locate ${names[0]}.`);
  return null;
}
async function clickText(page, names, role) { await (await textControl(page, names, role)).click(); }
async function scopedControl(page, labels, selector, label) {
  for (const text of labels) {
    const anchor = await visible(page.getByText(text, { exact: true }));
    if (!await anchor.count()) continue;
    await unique(anchor, text);
    const token = `runner-${crypto.randomUUID()}`;
    const located = await anchor.evaluate((element, { selector, token }) => {
      for (let wrapper = element; wrapper && wrapper !== document.body; wrapper = wrapper.parentElement) {
        const inputs = wrapper.querySelectorAll(selector);
        if (inputs.length === 1) { wrapper.setAttribute('data-report-runner-scope', token); return true; }
        if (inputs.length > 1) return false;
      }
      return false;
    }, { selector, token });
    if (!located) stop('UI_UNCALIBRATED', `Cannot uniquely scope ${label}.`);
    return unique(page.locator(`[data-report-runner-scope="${token}"]`).locator(selector), label, true);
  }
  stop('UI_UNCALIBRATED', `Missing section for ${label}.`);
}
async function fillField(page, value, { labels = [], placeholders = [], label }) {
  for (const name of labels) {
    const target = await visible(page.getByLabel(name, { exact: true }));
    if (await target.count()) { await (await unique(target, label)).fill(value); return; }
  }
  for (const placeholder of placeholders) {
    const target = await visible(page.getByPlaceholder(placeholder, { exact: true }));
    if (await target.count()) { await (await unique(target, label)).fill(value); return; }
  }
  const target = await scopedControl(page, labels, 'input:not([type=file]):not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea', label);
  await target.fill(value);
}
async function assertNoChallenge(page) {
  const title = await page.title();
  const visibleText = await page.locator('body').innerText();
  if (/安全验证|滑块验证|请完成验证|请完成下方验证|拖动滑块|点击验证/.test(title + '\n' + visibleText)) stop('HUMAN_VERIFICATION_REQUIRED', 'Complete the platform verification in an interactive login session; automation has paused.');
}
export async function uploadSection(page, labels, records) {
  const input = await scopedControl(page, labels, 'input[type=file]:not(.semi-upload-hidden-input-replace)', 'upload input');
  if (records.length > 1 && !await input.getAttribute('multiple').then(x => x !== null)) stop('UI_UNCALIBRATED', 'This upload input does not support the required multiple files.');
  const selectionToken = crypto.randomUUID();
  const emptyBeforeSelection = await input.evaluate((el, token) => {
    const upload = el.closest('.semi-upload');
    if (upload) upload.setAttribute('data-report-upload-selection', token);
    return !!upload && upload.querySelectorAll('[role="listitem"]').length === 0;
  }, selectionToken);
  await input.setInputFiles(records.map(f => f.path));
  // Semi UI clears this native input after consuming its change event.
  // Any retained selection must match; completion is checked in the upload cards.
  const selected = await input.evaluate(el => [...el.files].map(f => f.name));
  if (selected.length) assert.deepEqual(selected, records.map(f => path.basename(f.path)), 'File input selection mismatch');
  const selections = uploadSelections.get(page) || new Map();
  selections.set(labels.join('\n'), { names: records.map(f => path.basename(f.path)).sort(), emptyBeforeSelection, token: selectionToken });
  uploadSelections.set(page, selections);
}
export async function recognizedIds(page) {
  const containers = page.locator('.semi-table-container').filter({ hasText: /共成功识别\s*\d+\s*条/ }).filter({ visible: true });
  if (!await containers.count()) return [];
  const results = await unique(containers, 'recognition result table');
  return results.evaluate(container => {
    const total = Number(container.innerText.match(/共成功识别\s*(\d+)\s*条/)?.[1]);
    const ids = [];
    for (const row of container.querySelectorAll('tbody tr')) {
      if (!row.getClientRects().length) continue;
      const rowIds = new Set();
      for (const link of row.querySelectorAll('a[href]')) {
        try {
          const url = new URL(link.getAttribute('href'), 'https://www.douyin.com');
          if (url.hostname !== 'www.douyin.com') continue;
          const id = url.pathname.match(/^\/video\/(\d+)\/?$/)?.[1] ||
            (url.pathname === '/jingxuan' ? url.searchParams.get('modal_id') : null);
          if (id && /^\d+$/.test(id)) rowIds.add(id);
        } catch {}
      }
      if (rowIds.size !== 1) return [];
      ids.push(...rowIds);
    }
    // A summary count alone does not verify rows hidden by pagination or filtering.
    return ids.length === total && new Set(ids).size === total ? ids : [];
  });
}
async function waitForRecognition(page, job, timeout = 30000) {
  const requested = job.links.map(link => new URL(link).pathname.match(/^\/video\/(\d+)$/)?.[1]).filter(Boolean);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await assertNoChallenge(page);
    const ids = await recognizedIds(page);
    if (ids.length === job.links.length && requested.every(id => ids.includes(id))) return ids;
    await page.waitForTimeout(500);
  }
  stop('RECOGNITION_UNVERIFIED', 'Could not verify that all supplied links were recognized. Inspect the page and calibrate result selectors before submitting.');
}
export async function waitForUploadEvidence(page, job, timeout = 30000, labels = ['证明材料']) {
  const names = job.evidence.map(record => path.basename(record.path)).sort();
  const selection = uploadSelections.get(page)?.get(labels.join('\n'));
  // The license widget omits img.alt. Accept its one remote thumbnail only after
  // this run selected the exact file into an initially empty license widget.
  const input = await scopedControl(page, labels, 'input[type=file]:not(.semi-upload-hidden-input-replace)', 'upload input');
  const sameWidget = selection && await input.evaluate((el, token) => el.closest('.semi-upload')?.getAttribute('data-report-upload-selection') === token, selection.token);
  const unnamedLicense = labels.includes('上传公司营业执照') && names.length === 1 && sameWidget && selection?.emptyBeforeSelection &&
    JSON.stringify(selection.names) === JSON.stringify(names);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await assertNoChallenge(page);
    const status = await input.evaluate(el => {
      const upload = el.closest('.semi-upload');
      if (!upload) return null;
      const cards = [...upload.querySelectorAll('[role="listitem"]')];
      const failed = /上传失败|文件上传失败/.test(upload.innerText) || !!upload.querySelector('[class*="file-card-error"], [class*="file-card-fail"]');
      const pending = !!upload.querySelector('[role="progressbar"], .semi-progress, .semi-spin-spinning') || /上传中|正在上传/.test(upload.innerText);
      return { failed, pending, files: cards.map(card => {
        const img = card.querySelector('img');
        return { name: img?.alt, ready: !!img && /^https:\/\//.test(img.src) && img.complete && img.naturalWidth > 0 };
      }) };
    });
    if (status?.failed) stop('UPLOAD_FAILED', 'The platform explicitly reports an upload failure.');
    if (status && !status.pending && status.files.length === names.length && status.files.every(file => file.ready) &&
        (JSON.stringify(status.files.map(file => file.name).sort()) === JSON.stringify(names) ||
          (unnamedLicense && status.files.length === 1 && !status.files[0].name))) return;
    // Synthetic/legacy text lists remain supported only inside the identified input section.
    if (status === null) {
      const text = await input.evaluate(el => el.parentElement.innerText);
      if (/上传失败|文件上传失败/.test(text)) stop('UPLOAD_FAILED', 'The platform explicitly reports an upload failure.');
      if (names.every(name => text.includes(name)) && !/上传中|正在上传/.test(text)) return;
    }
    await page.waitForTimeout(250);
  }
  stop('UPLOAD_UNVERIFIED', 'Cannot verify every material in the upload list as complete. No final submission was clicked.');
}
export async function verifySelectedIdentity(page, identity) {
  const organization = await unique(page.getByText(identity.organization, { exact: true }), 'selected organization');
  const confirmed = await organization.evaluate((element, phone) => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const text = parent.innerText || '';
      if (text.includes('权利组织') && text.includes('联系电话')) {
        // Compare only the phone row, accepting the platform's visible prefix/suffix mask.
        const shown = text.split('联系电话')[1]?.trim().split('\n')[0].replace(/[\s-]/g, '').replace(/^\+86/, '');
        const phoneMatches = shown === phone || (shown && /^\d{3}\*{4}\d{4}$/.test(shown) && phone.length === 11 &&
          [...shown].every((digit, i) => digit === '*' || digit === phone[i]));
        const card = parent.querySelector(':scope > svg[viewBox="0 0 28 25"]') ? parent : parent.parentElement;
        const selected = !!card?.querySelector(':scope > svg[viewBox="0 0 28 25"]');
        return !!phoneMatches && selected;
      }
      if (parent.querySelector('form') || parent.tagName === 'FORM') break;
    }
    return false;
  }, identity.phone);
  if (!confirmed || await (await visible(page.getByRole('dialog'))).count()) stop('IDENTITY_UNVERIFIED', 'Cannot verify the selected organization card and its visible phone details.');
}
async function chooseIdentity(page, identity, job) {
  await clickText(page, ['自己举报'], 'radio');
  await clickText(page, ['组织'], 'radio');
  const existing = await visible(page.getByText(identity.organization, { exact: true }));
  if (await existing.count() === 1) { await existing.click(); await verifySelectedIdentity(page, identity); return; }
  if (await existing.count() > 1) stop('UI_UNCALIBRATED', 'Multiple organization cards match the supplied identity.');
  const selector = await textControl(page, ['选择身份信息'], 'button', false);
  if (selector) await selector.click();
  const card = await visible(page.getByText(identity.organization, { exact: true }));
  if (await card.count()) { await (await unique(card, 'organization card')).click(); await verifySelectedIdentity(page, identity); return; }
  await clickText(page, ['创建新身份']);
  await page.getByPlaceholder('请与资质证照上的名称保持一致', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await fillField(page, identity.organization, { labels: ['组织名称'], placeholders: ['请与资质证照上的名称保持一致'], label: 'organization name' });
  await fillField(page, identity.phone, { labels: ['电话', '联系电话', '电话号码', '手机号'], label: 'contact phone' });
  if (identity.email) await fillField(page, identity.email, { labels: ['邮箱', '联系邮箱', '电子邮箱'], label: 'contact email' });
  await uploadSection(page, ['上传公司营业执照', '上传证件'], [job.business_license]);
  await waitForUploadEvidence(page, { evidence: [job.business_license] }, 30000, ['上传公司营业执照', '上传证件']);
  await clickText(page, ['保存并使用']);
  await page.getByText(identity.organization, { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await unique(page.getByText(identity.organization, { exact: true }), 'saved organization');
  await verifySelectedIdentity(page, identity);
}
export async function prepareForm(page, job, identity, { identityStep = true, timeout = 30000 } = {}) {
  await assertNoChallenge(page);
  await selectComplaintKind(page, job.kind);
  await (await complaintLinksField(page)).fill(browserLinkText(job));
  await clickText(page, ['开始识别']);
  await waitForRecognition(page, job, timeout);
  await fillField(page, job.description, {
    labels: ['遇到的侵权问题'],
    placeholders: [REPORT_KINDS[job.kind].placeholder],
    label: 'complaint description',
  });
  await uploadSection(page, ['证明材料'], job.evidence);
  await waitForUploadEvidence(page, job, timeout);
  if (identityStep) await chooseIdentity(page, identity, job);
  // Identity creation may navigate away and back. Require the original form data
  // and recognition results still to be present before enabling final submission.
  await verifyReportKind(page, job.kind);
  if (await complaintLinksValue(page) !== browserLinkText(job)) stop('FORM_UNVERIFIED', 'Complaint links were changed or lost during identity selection.');
  const descriptions = await page.locator('textarea,input[type=text],input:not([type])').evaluateAll(els => els.map(el => el.value));
  if (!descriptions.includes(job.description)) stop('FORM_UNVERIFIED', 'Complaint description was changed or lost during identity selection.');
  await waitForRecognition(page, job, timeout);
  await waitForUploadEvidence(page, job, timeout);
  const notice = page.getByRole('checkbox', { name: /已知悉。材料转送需知/ });
  const checkbox = await unique(notice, 'material forwarding acknowledgement');
  if (!await checkbox.isChecked()) {
    const wrapper = await visible(page.locator('.semi-checkbox').filter({ has: notice }));
    if (await wrapper.count()) await (await unique(wrapper, 'material forwarding checkbox wrapper')).click();
    else await checkbox.check();
  }
  await assertNoChallenge(page);
  if (!await checkbox.isChecked()) stop('FORM_UNVERIFIED', 'The required acknowledgement was not checked.');
  return unique(page.getByRole('button', { name: '提交', exact: true }), 'final submit button');
}
export async function outcome(page, baseline = '') {
  // Never interpret the static notice “无法识别...24小时内重复举报” as submission failure.
  const body = await page.locator('body').innerText();
  const previousLines = new Set(baseline.split('\n').map(line => line.trim()));
  const newLines = body.split('\n').map(line => line.trim()).filter(line => !previousLines.has(line));
  if (newLines.some(line => /^(举报提交失败|提交失败|提交未成功|未提交成功|提交出错)(?:$|[，,。！!：:\s])/.test(line))) return 'failed';
  if (newLines.some(line => /^(举报提交成功|举报成功|提交成功)[。！!\s]*$/.test(line))) return 'submitted';
  return 'submission_clicked_unverified';
}

export function receiptURL(id) {
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) stop('ARGUMENT_INVALID', 'Receipt ID must contain digits only.');
  return `https://www.douyin.com/qinquan/history/${id}__c__2?enter_from=pc_douyin`;
}
export function receiptCounts(text) {
  const counts = {};
  for (const label of ['全部', '审核中', '提交失败', '举报成功', '举报失败', '已撤销', '已完成']) {
    const matches = [...text.matchAll(new RegExp(`${label}[（(]\\s*(\\d+)\\s*[）)]`, 'g'))];
    if (matches.length > 1) stop('HISTORY_UNVERIFIED', 'Ambiguous receipt totals.');
    if (matches.length) counts[label] = Number(matches[0][1]);
  }
  if (!Number.isSafeInteger(counts['全部'])) stop('HISTORY_UNVERIFIED', 'The receipt total is unavailable.');
  return counts;
}
export function paginationRange(text) {
  const match = text.match(/显示第\s*(\d+)\s*条\s*[-–—]\s*第\s*(\d+)\s*条[，,]\s*共\s*(\d+)\s*条/);
  if (!match) stop('HISTORY_UNVERIFIED', 'The table pagination range is unavailable.');
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start < 1 || end < start || end > total) stop('HISTORY_UNVERIFIED', 'Invalid table pagination range.');
  return { start, end, total };
}
export function receiptRows(rows) {
  return rows.map(cells => {
    if (!Array.isArray(cells) || ![5, 6].includes(cells.length) || cells.some(cell => typeof cell !== 'string')) stop('HISTORY_UNVERIFIED', 'Unexpected receipt columns.');
    const values = cells.map(cell => cell.trim());
    const [object, rawLink, status] = values;
    // Receipts that contain pending supplements add a 「补充原因」 column.
    const reason = values.length === 6 ? values[3] : '';
    const detail = values.length === 6 ? values[4] : values[3];
    let link;
    try { link = new URL(rawLink); } catch { stop('HISTORY_UNVERIFIED', 'A receipt row has no supported video URL.'); }
    const videoId = link.pathname.match(/^\/video\/(\d+)\/?$/)?.[1] || (link.pathname === '/jingxuan' ? link.searchParams.get('modal_id') : null);
    if (link.protocol !== 'https:' || link.hostname !== 'www.douyin.com' || link.username || link.password || link.port || !/^\d+$/.test(videoId || '') || !status) stop('HISTORY_UNVERIFIED', 'A receipt row has no verified video ID or progress.');
    return { video_id: videoId, video_url: `https://www.douyin.com/video/${videoId}`, object, status, reason, detail,
      duplicate_submission: status === '提交失败' && /24\s*小时内.*举报过|重复举报/.test(detail) };
  });
}
export function historyRows(rows) {
  return rows.map(cells => {
    if (!Array.isArray(cells) || cells.length !== 6 || cells.some(cell => typeof cell !== 'string')) stop('HISTORY_UNVERIFIED', 'Unexpected history columns.');
    const [id, kind, , submittedAt, status] = cells.map(cell => cell.trim());
    return { receipt_id: id, receipt_url: receiptURL(id), kind, submitted_at: submittedAt, status };
  });
}
export function targetVideoIds(text) {
  let entries;
  if (text.trim().startsWith('[')) {
    try { entries = JSON.parse(text); } catch { stop('ARGUMENT_INVALID', 'Video ID JSON is invalid.'); }
  } else entries = text.trim().split(/\s+/).filter(Boolean);
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) stop('ARGUMENT_INVALID', 'Supply 1–1000 numeric video IDs or full video URLs.');
  return [...new Set(entries.map(value => {
    if (typeof value !== 'string') stop('ARGUMENT_INVALID', 'Video IDs must be strings to preserve precision.');
    if (/^\d{1,30}$/.test(value)) return value;
    const id = value.match(/^https:\/\/www\.douyin\.com\/video\/(\d{1,30})\/?$/)?.[1];
    if (!id) stop('ARGUMENT_INVALID', 'Use numeric video IDs or full video URLs, not short links.');
    return id;
  }))];
}
export function matchReceiptTargets(ids, receipts) {
  return ids.map(videoId => {
    const records = receipts.flatMap(receipt => receipt.items.filter(item => item.video_id === videoId)
      .map(item => ({ receipt_id: receipt.receipt_id, receipt_url: receipt.receipt_url, kind: receipt.kind ?? null, ...item })));
    const duplicates = records.filter(item => item.duplicate_submission);
    const duplicateKinds = new Set(duplicates.map(item => item.kind));
    const original = records.filter(item => !item.duplicate_submission && item.status !== '提交失败'
      && (!duplicates.length || (item.kind && duplicateKinds.has(item.kind))));
    const allKindsCovered = !duplicates.length || (!duplicateKinds.has(null) && [...duplicateKinds].every(kind => original.some(item => item.kind === kind)));
    const statuses = [...new Set(original.map(item => item.status))];
    return { video_id: videoId, status: records.length ? 'found' : 'unknown',
      original_status: statuses.length === 1 && allKindsCovered ? statuses[0] : 'unknown',
      reason: !records.length ? 'No matching record in the inspected receipts.' : !original.length || !allKindsCovered ? 'No verified non-failed original record of the same complaint type was found.' : statuses.length > 1 ? 'Multiple original records have different statuses; inspect records individually.' : null,
      records };
  });
}

// Only pagination controls are clicked here; report submission and withdrawal
// controls are never queried. Each page must match its displayed row range.
export async function readHistoryTable(page, type, budget = { remaining: 100 }, timeout = 15000) {
  const expectedHeaders = type === 'receipt' ? ['举报对象', '举报内容', '当前进度', '详情', '操作'] : ['举报ID', '侵权类型', '举报描述', '提交时间', '当前进度', '操作'];
  const parse = type === 'receipt' ? receiptRows : historyRows;
  const collected = [], seen = new Set();
  let expectedStart = 1, expectedTotal;
  while (true) {
    if (budget.remaining <= 0) return { items: collected, complete: false, stop_reason: 'page_limit', total: expectedTotal ?? null };
    const end = Date.now() + timeout;
    let snapshot, range;
    while (Date.now() < end) {
      await assertNoChallenge(page);
      const tables = page.locator('.semi-table-container').filter({ visible: true });
      const pagination = page.locator('.semi-table-pagination-info').filter({ visible: true });
      if (await tables.count() === 1 && await pagination.count() === 1) {
        snapshot = await tables.evaluate(el => ({ headers: [...el.querySelectorAll('thead th')].map(th => th.innerText.trim()), rows: [...el.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText)) }));
        try { range = paginationRange(await pagination.innerText()); } catch { range = undefined; }
        if (range?.start === expectedStart && JSON.stringify(snapshot.headers) === JSON.stringify(expectedHeaders) && snapshot.rows.length === range.end - range.start + 1) break;
      }
      snapshot = undefined;
      await page.waitForTimeout(150);
    }
    if (!snapshot || !range || range.start !== expectedStart) stop('HISTORY_UNVERIFIED', 'Could not verify the history table, row range, or login session.');
    if (expectedTotal !== undefined && range.total !== expectedTotal) stop('HISTORY_CHANGED', 'The table total changed during reading; rerun the read-only query.');
    expectedTotal = range.total;
    const items = parse(snapshot.rows);
    for (const item of items) {
      const key = type === 'receipt' ? item.video_id : item.receipt_id;
      if (seen.has(key)) stop('HISTORY_UNVERIFIED', 'Pagination repeated a record; results are incomplete.');
      seen.add(key);
      collected.push(item);
    }
    budget.remaining--;
    if (range.end === range.total) return { items: collected, complete: true, total: range.total };
    if (budget.remaining <= 0) return { items: collected, complete: false, stop_reason: 'page_limit', total: range.total };
    const next = await unique(page.locator('.semi-table-pagination-outer').getByRole('button', { name: 'Next', exact: true }), 'next history page');
    if (await next.getAttribute('aria-disabled') !== 'false') stop('HISTORY_UNVERIFIED', 'The next history page is unavailable before the final row.');
    expectedStart = range.end + 1;
    await next.click();
  }
}
export async function readReceipt(page, id, budget) {
  const url = receiptURL(id);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByText(new RegExp(`举报详情[（(]ID${id}[）)]`)).waitFor({ state: 'visible', timeout: 15000 });
  await assertNoChallenge(page);
  // A new receipt can initially show temporary zero counts while loading.
  await page.getByText(/^全部[（(]\d+[）)]$/).waitFor({ state: 'visible', timeout: 15000 });
  const table = await readHistoryTable(page, 'receipt', budget);
  const counts = receiptCounts(await page.locator('body').innerText());
  if (table.total !== null && counts['全部'] !== table.total) stop('HISTORY_CHANGED', 'Receipt totals do not agree with the inspected rows.');
  return { receipt_id: id, receipt_url: url, checked_at: now(), counts, ...table };
}
async function historyQuery(options, profile, channelOptions) {
  if (['submit', 'retry-failed', 'job', 'state', 'identity-json', 'login'].some(key => options[key])) stop('ARGUMENT_INVALID', 'History queries cannot fill, submit, or alter job state.');
  const maxPages = options['max-pages'] === undefined ? 100 : Number(options['max-pages']);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) stop('ARGUMENT_INVALID', '--max-pages must be an integer from 1 to 200.');
  if (options.receipt) receiptURL(options.receipt);
  const ids = options['video-ids'] ? targetVideoIds(await fs.readFile(options['video-ids'], 'utf8')) : null;
  const budget = { remaining: maxPages };
  const context = await playwright().chromium.launchPersistentContext(profile, { headless: !options.headed, acceptDownloads: false, ...channelOptions });
  try {
    const page = context.pages()[0] || await context.newPage();
    let history;
    const receipts = [];
    if (options.receipt) receipts.push(await readReceipt(page, options.receipt, budget));
    else {
      await page.goto(HISTORY_URL, { waitUntil: 'domcontentloaded' });
      history = await readHistoryTable(page, 'history', budget);
      if (ids) {
        for (const record of history.items) {
          if (budget.remaining <= 0) break;
          receipts.push({ ...await readReceipt(page, record.receipt_id, budget), kind: record.kind, submitted_at: record.submitted_at });
        }
      }
    }
    const complete = (!history || history.complete) && receipts.every(receipt => receipt.complete) && (!ids || !history || receipts.length === history.items.length);
    console.log(JSON.stringify({ status: complete ? 'history_read' : 'history_partial', read_only: true, checked_at: now(), complete,
      pages_read: maxPages - budget.remaining, ...(history ? { history } : {}), receipts, ...(ids ? { targets: matchReceiptTargets(ids, receipts) } : {}) }));
  } finally { await context.close(); }
}

function parseArgs(argv) {
  const options = {};
  const flags = new Set(['login', 'submit', 'retry-failed', 'headed', 'self-test', 'help', 'history']);
  const valued = new Set(['job', 'profile', 'identity-json', 'state', 'channel', 'executable-path', 'receipt', 'video-ids', 'max-pages']);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || (!flags.has(name) && !valued.has(name)) || name in options) stop('ARGUMENT_INVALID', 'Unknown or duplicate command-line option.');
    if (flags.has(name)) options[name] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) stop('ARGUMENT_INVALID', 'An option value is missing.'); options[name] = argv[++i]; }
  }
  return options;
}
function help() {
  console.log('Usage:\n  node runner.mjs --login --profile ABS_PROFILE [--channel chrome]\n  node runner.mjs --job ABS_JOB --identity-json ABS_IDENTITY --profile ABS_PROFILE --state ABS_STATE [--channel chrome] [--headed] [--submit] [--retry-failed]\n  node runner.mjs --history --profile ABS_PROFILE [--receipt ID] [--video-ids FILE] [--max-pages 100] [--channel chrome]\n  node runner.mjs --self-test [--channel chrome]\nBrowser override: --executable-path ABS_BROWSER takes precedence over --channel.\nDefault: fill and verify form without clicking final submission. History queries are read-only and never change job states. Identity JSON: {"patent":{"organization":"...","phone":"...","email":"..."},"trademark":{...}}');
}
async function profileDirectory(raw) {
  if (!raw || !path.isAbsolute(raw)) stop('PROFILE_REQUIRED', '--profile must name an absolute dedicated browser profile directory.');
  const profile = path.resolve(raw);
  const portablePath = profile.replaceAll('\\', '/');
  if (/(?:Google[ /]Chrome|Chromium|Microsoft[ /]Edge)(?:[ /]|$)/i.test(portablePath) || /\/Library\/Application Support\//.test(portablePath) || profile === os.homedir() || profile === path.parse(profile).root) stop('PROFILE_UNSAFE', 'Use a new dedicated profile directory, not a daily browser profile or home directory.');
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const marker = path.join(profile, '.douyin-report-runner-profile');
  try { await fs.access(marker); }
  catch {
    if ((await fs.readdir(profile)).length) stop('PROFILE_UNSAFE', 'A new automation profile must be empty. Existing unrelated profiles are not accepted.');
    await fs.writeFile(marker, 'Dedicated Douyin report browser profile\n', { flag: 'wx', mode: 0o600 });
  }
  return profile;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.channel && !['chrome', 'chromium'].includes(options.channel)) stop('ARGUMENT_INVALID', '--channel supports only chrome or chromium.');
  let channelOptions = options.channel ? { channel: options.channel } : {};
  if (options['executable-path']) {
    if (!path.isAbsolute(options['executable-path']) || !(await fs.stat(options['executable-path']).catch(() => null))?.isFile()) stop('ARGUMENT_INVALID', '--executable-path must name an existing absolute browser executable file.');
    channelOptions = { executablePath: options['executable-path'] };
  }
  if (options.help) { help(); return; }
  if (options['self-test']) { await selfTest(channelOptions); return; }
  const profile = await profileDirectory(options.profile);
  if (options.history || options.receipt) { await historyQuery(options, profile, channelOptions); return; }
  if (options['video-ids'] || options['max-pages']) stop('ARGUMENT_INVALID', '--video-ids and --max-pages require --history or --receipt.');
  if (options.login) {
    if (options.submit || options['retry-failed']) stop('ARGUMENT_INVALID', '--login cannot submit.');
    const context = await playwright().chromium.launchPersistentContext(profile, { headless: false, ...channelOptions });
    try {
      const page = context.pages()[0] || await context.newPage();
      await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      try { await terminal.question('请在专用浏览器扫码并完成所需验证，然后回到终端按 Enter 保存登录会话。'); }
      finally { terminal.close(); }
      await requireReportForm(page);
      console.log(JSON.stringify({ status: 'login_form_available', submitted: false }));
    } finally { await context.close(); }
    return;
  }
  if (!options.job || !options['identity-json'] || !options.state) stop('ARGUMENT_INVALID', '--job, --identity-json and --state are required.');
  if (options['retry-failed'] && !options.submit) stop('ARGUMENT_INVALID', '--retry-failed must be paired with --submit.');
  const { job, identity, fingerprint } = await validateJob(await readJSON(options.job), await readJSON(options['identity-json']));
  const statePath = path.resolve(options.state);
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = statePath + '.lock';
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch { stop('JOB_LOCKED', 'This job state is already in use. Inspect a stale lock before removing it.'); }
  let context, state, afterClick = false;
  const save = async status => {
    state = { ...state, status, updated_at: now() };
    await privateJSON(statePath, state);
    await fs.appendFile(statePath + '.jsonl', JSON.stringify({ at: now(), fingerprint, status, attempt: state.attempt }) + '\n', { mode: 0o600 });
  };
  try {
    let prior;
    try { await fs.access(statePath); prior = await readJSON(statePath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    submissionAllowed(prior, fingerprint, !!options['retry-failed']);
    state = { version: 1, fingerprint, status: 'preparing', attempt: (prior?.attempt || 0) + 1, kind: job.kind, link_count: job.links.length, created_at: prior?.created_at || now() };
    await save('preparing');
    context = await playwright().chromium.launchPersistentContext(profile, { headless: !options.headed, acceptDownloads: false, ...channelOptions });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
    await requireReportForm(page, 'LOGIN_REQUIRED');
    const submit = await prepareForm(page, job, identity);
    if (!await submit.isEnabled()) stop('FORM_UNVERIFIED', 'Final submit is disabled; required inputs may be incomplete.');
    await save('prepared');
    if (options.submit) {
      const baseline = await page.locator('body').innerText();
      await save('submitting'); // Persist before click: even a crash during click cannot cause an automatic duplicate.
      afterClick = true;
      await submit.click();
      await save('submission_clicked_unverified');
      const end = Date.now() + 15000;
      let result = 'submission_clicked_unverified';
      while (Date.now() < end && result === 'submission_clicked_unverified') {
        await page.waitForTimeout(500);
        result = await outcome(page, baseline);
      }
      await save(result);
    }
    console.log(JSON.stringify({ status: state.status, kind: job.kind, links: job.links.length, evidence_images: job.evidence.length, attempt: state.attempt, submitted: state.status === 'submitted' }));
  } catch (e) {
    if (state && !FINAL_STATES.has(state.status) && state.status !== 'failed') await save(afterClick ? 'submission_clicked_unverified' : 'preparation_failed');
    throw e;
  } finally {
    if (context) await context.close().catch(() => {});
    await lock.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}

export async function selfTest(channelOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-runner-test-'));
  let browser;
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1MAAAAASUVORK5CYII=', 'base64');
    const file = path.join(root, 'evidence.png');
    await fs.writeFile(file, png);
    const record = { path: file, bytes: png.length, media_type: 'image/png', sha256: hash(png) };
    const job = { schema_version: 1, kind: 'trademark', description: 'Mock complaint', links: ['https://www.douyin.com/video/123'], evidence: [record], business_license: record, identity_reference: record };
    const identity = { organization: 'Test organization', phone: '13800000000', email: '' };
    const checked = await validateJob(job, { trademark: identity });
    assert.equal(checked.job.links.length, 1);
    assert.throws(() => submissionAllowed({ fingerprint: checked.fingerprint, status: 'submission_clicked_unverified' }, checked.fingerprint, true), /already clicked/);
    assert.throws(() => submissionAllowed({ fingerprint: checked.fingerprint, status: 'failed' }, checked.fingerprint, false), /retry-failed/);
    submissionAllowed({ fingerprint: checked.fingerprint, status: 'failed' }, checked.fingerprint, true);
    await fs.writeFile(file, Buffer.concat([png, Buffer.from('changed')]));
    await assert.rejects(validateJob(job, { trademark: identity }), /changed after preflight/);
    await fs.writeFile(file, png);
    browser = await playwright().chromium.launch({ headless: true, ...channelOptions });
    const page = await browser.newPage();
    // All browser tests run against synthetic local DOM: no Douyin request or report is sent.
    await page.route('**/*', route => route.abort());
    const mockForm = rich => `<button data-kind="portrait">曝光肖像</button><button data-kind="patent">假冒专利</button><button data-kind="trademark">假冒商标</button>
      ${rich ? `<div contenteditable="true" role="textbox" class="tiptap ProseMirror"><p data-placeholder="${LINKS_PLACEHOLDER}"><br></p></div>` : `<textarea placeholder="${LINKS_PLACEHOLDER}"></textarea>`}
      <button id="recognize">开始识别</button><div id="results" class="semi-table-container"></div>
      <label>遇到的侵权问题<textarea id="description" placeholder="在第3秒使用了我的照片，未经我允许使用我的肖像等"></textarea></label>
      <section><span>证明材料</span><input type="file" multiple><div id="files"></div></section>
      <section><span>上传公司营业执照</span><input type="file"></section>
      <label><input type="checkbox">*已知悉。材料转送需知：Mock</label><button id="submit">提交</button><div id="receipt"></div>
      <script>
        (() => {
        window.clicks=0;window.kind='portrait';
        const kinds=${JSON.stringify(REPORT_KINDS)};
        for (const button of document.querySelectorAll('[data-kind]')) button.onclick=()=>{
          window.kind=button.dataset.kind;
          document.querySelector('#description').placeholder=kinds[window.kind]?.placeholder || '肖像问题';
        };
        document.querySelector('#recognize').onclick=()=>document.querySelector('#results').innerHTML='<table><thead><tr><th>共成功识别1条</th></tr></thead><tbody><tr><td><a href="https://www.douyin.com/jingxuan?modal_id=123">recognized video</a></td></tr></tbody></table>';
        document.querySelector('input[type=file]').onchange=e=>document.querySelector('#files').textContent=[...e.target.files].map(f=>f.name).join(',');
        document.querySelector('#submit').onclick=()=>{window.clicks++;document.querySelector('#receipt').textContent='提交失败'};
        })();
      </script>`;
    await page.setContent(mockForm(false));
    await requireReportForm(page);
    assert.equal(await page.evaluate(() => window.kind), 'portrait', 'Login check must accept the default category');
    await prepareForm(page, job, identity, { identityStep: false, timeout: 1000 });
    assert.equal(await page.evaluate(() => window.clicks), 0, 'Prepare must not click submit');
    assert.equal(await page.locator('section').nth(1).locator('input').evaluate(el => el.files.length), 0, 'Evidence must not land in license input');
    assert.deepEqual(await recognizedIds(page), ['123']);
    await page.getByRole('button', { name: '提交', exact: true }).click();
    assert.equal(await outcome(page), 'failed');
    await page.locator('#receipt').evaluate(el => el.textContent = '平台将自动去除重复、无法识别的链接、及你在24小时内重复举报的内容');
    assert.equal(await outcome(page), 'submission_clicked_unverified', 'Static recognition notice is not a submission failure');
    await page.locator('#receipt').evaluate(el => el.textContent = '提交成功');
    assert.equal(await outcome(page), 'submitted');
    await page.setContent(mockForm(true));
    await requireReportForm(page);
    const multiline = 'https://www.douyin.com/video/123\nhttps://www.douyin.com/video/456';
    await (await complaintLinksField(page)).fill(multiline);
    await page.locator('[data-placeholder]').evaluateAll(els => els.forEach(el => el.removeAttribute('data-placeholder')));
    assert.equal(await complaintLinksValue(page), multiline, 'Rich text readback must survive disappearing placeholder decoration');
    await prepareForm(page, { ...job, kind: 'patent' }, identity, { identityStep: false, timeout: 1000 });
    assert.equal(await page.evaluate(() => window.kind), 'patent');
    assert.equal(await page.evaluate(() => window.clicks), 0);
    await page.setContent(mockForm(true));
    await prepareForm(page, job, identity, { identityStep: false, timeout: 1000 });
    assert.equal(await page.evaluate(() => window.kind), 'trademark');
    assert.equal(await page.evaluate(() => window.clicks), 0);
    await page.setContent(mockForm(true));
    await page.locator('[data-kind="patent"]').evaluate(el => el.onclick = null);
    await assert.rejects(selectComplaintKind(page, 'patent', 200), error => error.code === 'REPORT_KIND_UNVERIFIED');
    await page.locator('.tiptap').evaluate(el => el.after(el.cloneNode(true)));
    await assert.rejects(complaintLinksField(page), /Expected one/);
    await page.setContent('<section><span>证明材料</span><input type="file"><input type="file"></section>');
    await assert.rejects(uploadSection(page, ['证明材料'], [record]), /uniquely scope/);
    await page.setContent('<section><span>证明材料</span><input type="file"></section><section><span>证明材料</span><input type="file"></section>');
    await assert.rejects(uploadSection(page, ['证明材料'], [record]), /Expected one/);
    assert.deepEqual(receiptRows([['视频/图集', 'https://www.douyin.com/video/123', '审核中', '正在审核', '查看']]).map(row => [row.reason, row.detail]),
      [['', '正在审核']], 'Five-column receipt rows must still parse');
    assert.deepEqual(receiptRows([['视频/图集', 'https://www.douyin.com/video/123', '待补充材料', '补充原因', '详情', '查看']]).map(row => [row.reason, row.detail]),
      [['补充原因', '详情']], 'Six-column receipt rows with 补充原因 must parse');
    console.log(JSON.stringify({ status: 'tests_passed', tests: ['manifest_hash_check', 'duplicate_submission_guard', 'failed_retry_guard', 'mock_form_prepare_without_submit', 'scoped_file_upload', 'recognized_video_ids', 'explicit_failure', 'static_notice_not_failure', 'explicit_success', 'ambiguous_input_stop', 'ambiguous_section_stop', 'default_category_login', 'rich_text_multiline_readback', 'default_to_patent', 'default_to_trademark', 'unchanged_category_stop', 'ambiguous_editor_stop', 'receipt_columns'], live_requests: 0 }));
  } finally { if (browser) await browser.close(); await fs.rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'stopped', code: error instanceof WorkflowError ? error.code : 'AUTOMATION_ERROR', message: error instanceof WorkflowError ? error.message : 'Browser operation failed. Inspect the local form or calibrate selectors; no automatic retry was performed.' }));
    process.exitCode = 2;
  });
}
