// Real Chrome, entirely intercepted local fixture. No requests leave the browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareReport, receiptTexts, classifyReceipt } from '../skills/douyin-ip-report/scripts/original-runner.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const html = `<!doctype html><meta charset="utf-8"><title>Offline original report test</title>
<section id="video-content"><video style="width:320px;height:180px"></video><button id="report">举报</button></section>
<div id="modal" style="display:none"><h2>举报视频</h2><label><input type="radio" name="reason">搬运、抄袭作品</label>
<textarea placeholder="请提供可公开访问的原始链接，并确认发布时间早于被举报内容"></textarea><button id="submit" disabled>提交</button></div>
<div id="toast"></div><script>
window.submissions=0;
document.querySelector('#report').onclick=()=>document.querySelector('#modal').style.display='block';
document.querySelector('input').onchange=()=>window.selected=true;
document.querySelector('textarea').oninput=()=>document.querySelector('#submit').disabled=!window.selected||!document.querySelector('textarea').value;
document.querySelector('#submit').onclick=()=>{window.submissions++;document.querySelector('#toast').textContent='举报成功'};
</script>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  let intercepted=0;
  await context.route('**/*', async route => {intercepted++; await route.fulfill({contentType:'text/html',body:html});});
  const page = await context.newPage();
  await page.goto('https://www.douyin.com/video/1000000000000000001');
  const button = await prepareReport(page, {videoId:'1000000000000000001',originalUrl:'https://v.douyin.com/OFFLINE_FIXTURE/'});
  assert.equal(await button.isEnabled(), true);
  assert.equal(await page.locator('textarea').inputValue(), 'https://v.douyin.com/OFFLINE_FIXTURE/');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  assert.equal(classifyReceipt(await receiptTexts(page)).status,'unknown');
  // Show a fixture receipt without clicking submit, to test real DOM extraction.
  await page.locator('#toast').evaluate(element=>element.textContent='举报成功');
  assert.equal(classifyReceipt(await receiptTexts(page)).status,'success');
  assert.equal(await page.evaluate(()=>window.submissions),0);
  await context.close();
  console.log(JSON.stringify({status:'passed',browser:'installed Chrome',headless:true,fixture_requests_intercepted:intercepted,external_requests:0,submit_clicks:0,tests:['video_scoped_report','reason_selection','original_url_readback','submit_enabled_without_click','receipt_dom_extraction']}));
} finally { await browser.close(); }
