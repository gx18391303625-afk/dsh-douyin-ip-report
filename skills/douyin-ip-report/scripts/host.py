#!/usr/bin/env python3
"""Host-specific local entry point. Never submit unless --submit is provided."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from prepare_job import prepare, write_manifest, InputError


def read_json(path):
    # PowerShell 5.1 and older editors may write a UTF-8 BOM.
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def host_home(host, env=None, user_home=None):
    env = os.environ if env is None else env
    override = env.get('DSH_HOME' if host == 'deepseek' else 'CODEX_HOME')
    root = Path(override).expanduser() if override else Path(user_home or Path.home()) / ('.dsh' if host == 'deepseek' else '.codex')
    return root / 'douyin-report'


def browser_arguments(cfg):
    executable = cfg.get('executable_path')
    if executable:
        if not Path(executable).is_absolute():
            raise ValueError('Browser executable_path must be absolute')
        return ['--executable-path', executable]
    channel = cfg.get('channel', 'chrome')
    if channel not in ('chrome', 'chromium'):
        raise ValueError('Browser channel must be chrome or chromium')
    return ['--channel', channel]


def doctor(node, cfg, env):
    for key in ['node', 'identity', 'materials', 'node_path']:
        if not Path(cfg[key]).exists():
            raise ValueError('Missing host prerequisite: ' + key)
    args = browser_arguments(cfg)
    options = {'executablePath' if args[0] == '--executable-path' else 'channel': args[1]}
    # A fresh ephemeral context exercises the real browser without touching the
    # login profile or visiting a website. No complaint actions run here.
    script = r"""
(async () => {
  let driver;
  try { driver = require('playwright'); } catch { driver = require('playwright-core'); }
  let browser;
  try {
    browser = await driver.chromium.launch({headless: true, ...JSON.parse(process.argv[1])});
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<title>Local browser check</title><p id="check">ready</p>');
    if (await page.locator('#check').textContent() !== 'ready') throw new Error('Browser rendering check failed');
    console.log(JSON.stringify({node: process.version, browserDriverAvailable: true, browserLaunchVerified: true, networkNavigation: false}));
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
"""
    subprocess.run([node, '-e', script, json.dumps(options)], env=env, check=True)
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', required=True, choices=['codex', 'deepseek'])
    p.add_argument('action', choices=['doctor', 'check', 'login', 'prepare', 'run', 'self-test', 'status'])
    p.add_argument('--kind', choices=['patent', 'trademark'])
    source = p.add_mutually_exclusive_group()
    source.add_argument('--links-file', type=Path)
    source.add_argument('--links-workbook', type=Path)
    p.add_argument('--job', type=Path)
    p.add_argument('--submit', action='store_true')
    p.add_argument('--retry-failed', action='store_true')
    p.add_argument('--receipt')
    p.add_argument('--video-ids', type=Path)
    p.add_argument('--max-pages', type=int, default=100)
    a = p.parse_args()
    if (a.receipt or a.video_ids or a.max_pages != 100) and a.action != 'status':
        p.error('history filters only apply to status')
    if not 1 <= a.max_pages <= 200:
        p.error('--max-pages must be between 1 and 200')
    if (a.submit or a.retry_failed) and a.action != 'run':
        p.error('submission flags only apply to run')
    if a.retry_failed and not a.submit:
        p.error('--retry-failed requires --submit')
    if a.job and (a.links_file or a.links_workbook):
        p.error('choose an existing job or new link input, not both')
    home = host_home(a.host)
    cfg = read_json(home / 'config.json')
    if cfg['host'] != a.host:
        raise ValueError('Host config mismatch')
    env = dict(os.environ, NODE_PATH=cfg['node_path'])
    node = cfg['node']
    runner = str(Path(__file__).with_name('runner.mjs'))
    browser_args = browser_arguments(cfg)
    if a.action == 'doctor':
        doctor(node, cfg, env)
        print(json.dumps({'status': 'host_ready', 'host': a.host, 'profile_isolated': True, 'browser_launch_verified': True}))
        return 0
    if a.action == 'check':
        kinds = [a.kind] if a.kind else ['patent', 'trademark']
        for kind in kinds:
            job = prepare(Path(cfg['materials']), kind)
            print(json.dumps({'host': a.host, 'kind': kind, 'evidence_images': len(job['evidence']), 'status': 'checked_only'}))
        return 0
    if a.action == 'self-test':
        return subprocess.call([node, runner, '--self-test', *browser_args], env=env)
    if a.action == 'login':
        return subprocess.call([node, runner, '--login', '--profile', str(home / 'browser-profile'), *browser_args], env=env)
    if a.action == 'status':
        args = [node, runner, '--history', '--profile', str(home / 'browser-profile'), '--max-pages', str(a.max_pages), *browser_args]
        if a.receipt:
            args += ['--receipt', a.receipt]
        if a.video_ids:
            args += ['--video-ids', str(a.video_ids)]
        return subprocess.call(args, env=env)
    if a.job:
        job = read_json(a.job)
        if a.kind and a.kind != job['kind']:
            raise ValueError('Job type does not match --kind')
    else:
        if not a.kind or not (a.links_file or a.links_workbook):
            p.error('supply --kind and an explicit link file, or --job')
        job = prepare(Path(cfg['materials']), a.kind, a.links_file or a.links_workbook, bool(a.links_workbook))
    # A stable task path keeps repeated invocations tied to their submission state.
    job_id = hashlib.sha256(json.dumps(job, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]
    jobs = home / 'jobs'
    jobs.mkdir(mode=0o700, parents=True, exist_ok=True)
    job_path = jobs / (job_id + '.json')
    if not job_path.exists():
        write_manifest(job_path, job)
    elif read_json(job_path) != job:
        raise ValueError('Stored task does not match current input')
    if a.action == 'prepare':
        print(json.dumps({'host': a.host, 'status': 'prepared_not_submitted', 'job': str(job_path), 'links': len(job['links'])}))
        return 0
    args = [node, runner, '--job', str(job_path), '--identity-json', cfg['identity'],
            '--profile', str(home / 'browser-profile'), '--state', str(jobs / (job_id + '.state.json')), *browser_args]
    if a.submit:
        args.append('--submit')
    if a.retry_failed:
        args.append('--retry-failed')
    return subprocess.call(args, env=env)


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, InputError, subprocess.CalledProcessError) as exc:
        print('Host setup/input error: ' + str(exc), file=sys.stderr)
        sys.exit(2)
