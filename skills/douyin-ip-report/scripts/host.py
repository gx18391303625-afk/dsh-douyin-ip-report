#!/usr/bin/env python3
"""Host-specific local entry point. Never submit unless --submit is provided."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
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


def _host_root(host):
    override = os.environ.get('DSH_HOME' if host == 'deepseek' else 'CODEX_HOME')
    return Path(override).expanduser() if override else Path.home() / ('.dsh' if host == 'deepseek' else '.codex')


def find_node(host):
    """Prefer the host's bundled Node, then PATH, then common installs."""
    roots = []
    for base in (_host_root(host), Path.home() / ('.dsh' if host == 'deepseek' else '.codex')):
        roots += sorted((base / 'dsh-runtimes').glob('*/dependencies/node/bin/node'), reverse=True)
    if host == 'codex':
        roots += sorted((Path.home() / '.cache' / 'codex-runtimes').glob('*/dependencies/node/bin/node'), reverse=True)
    found = shutil.which('node')
    if found:
        roots.append(Path(found))
    roots += [Path('/opt/homebrew/bin/node'), Path('/usr/local/bin/node'), Path('/usr/bin/node')]
    for candidate in roots:
        try:
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
        except OSError:
            continue
    return ''


def find_node_path(host, home):
    """Find a node_modules directory that already has playwright(-core)."""
    candidates = [home / 'node_modules']
    for base in (_host_root(host), Path.home() / ('.dsh' if host == 'deepseek' else '.codex')):
        candidates += sorted((base / 'profiles').glob('*/node_modules'))
    candidates.append(Path(__file__).resolve().parent / 'node_modules')
    for candidate in candidates:
        if (candidate / 'playwright-core').exists() or (candidate / 'playwright').exists():
            return candidate
    return home / 'node_modules'


def write_private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.chmod(temp, 0o600)
    os.replace(temp, path)


def init_home(host, home):
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    materials = home / 'materials'
    materials.mkdir(exist_ok=True, mode=0o700)
    identity = home / 'identity.json'
    if not identity.exists():
        write_private_json(identity, {
            'patent': {'organization': '', 'phone': '', 'email': ''},
            'trademark': {'organization': '', 'phone': '', 'email': ''},
        })
    config = home / 'config.json'
    if not config.exists():
        write_private_json(config, {
            'host': host,
            'node': find_node(host),
            'node_path': str(find_node_path(host, home)),
            'identity': str(identity),
            'materials': str(materials),
            'channel': 'chrome',
        })
    cfg = read_json(config)
    template_dir = Path(__file__).resolve().parent.parent / 'templates'
    copied = []
    for source, target in [
        (template_dir / '侵权问题话术.xlsx', materials / '侵权问题话术.xlsx'),
        (template_dir / 'materials.README.md', materials / 'README.md'),
        (template_dir / 'materials.json.example', materials / 'materials.json.example'),
    ]:
        if source.exists() and not target.exists():
            shutil.copyfile(source, target)
            copied.append(target.name)
    node = cfg.get('node') or ''
    node_path = Path(cfg.get('node_path') or home / 'node_modules')
    playwright = (node_path / 'playwright-core').exists() or (node_path / 'playwright').exists()
    script = Path(__file__).resolve()
    next_steps = [
        '编辑 identity.json，填入真实组织名称和联系电话',
        '按 materials/README.md 放入证明材料、身份截图和营业执照（或改 materials.json）',
        f'运行 python3 "{script}" --host {host} check',
        f'运行 python3 "{script}" --host {host} login，扫码登录（agent 运行会自动等待）',
    ]
    if not node:
        next_steps.insert(0, '安装 Node.js 20+，或把 config.json 的 node 改成 Node 的绝对路径')
    if not playwright:
        next_steps.insert(0, f'安装 Playwright：cd "{home}" && npm init -y && npm install playwright-core@1.64.1')
    print(json.dumps({
        'status': 'initialized',
        'host': host,
        'home': str(home),
        'config': str(config),
        'identity': str(identity),
        'materials': str(materials),
        'node': node or None,
        'node_path': str(node_path),
        'playwright_found': playwright,
        'templates_copied': copied,
        'next': next_steps,
    }, ensure_ascii=False))
    return 0


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
    if not node or not Path(node).is_file() or not os.access(node, os.X_OK):
        raise ValueError('Node.js not found or not executable; edit config.json or install Node.js 20+.')
    for key in ['identity', 'materials']:
        if not Path(cfg[key]).exists():
            raise ValueError(f'Missing {key}: {cfg[key]}. Run init or fix config.json.')
    node_path = Path(cfg.get('node_path', ''))
    if not node_path.is_dir() or not ((node_path / 'playwright-core').exists() or (node_path / 'playwright').exists()):
        raise ValueError(f'node_path {node_path} does not contain playwright-core; install it with npm or edit config.json.')
    warnings = []
    try:
        identity = read_json(cfg['identity'])
        for kind in ('patent', 'trademark'):
            item = identity.get(kind) or {}
            if not item.get('organization') or not item.get('phone'):
                warnings.append(f'identity.{kind} is incomplete')
    except (OSError, ValueError, KeyError):
        warnings.append('identity.json is invalid')
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
    try:
        subprocess.run([node, '-e', script, json.dumps(options)], env=env, check=True)
    except subprocess.CalledProcessError as exc:
        raise ValueError('Playwright or Chrome check failed; verify node_path contains playwright-core and Google Chrome is installed.') from exc
    return warnings


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', required=True, choices=['codex', 'deepseek'])
    p.add_argument('action', choices=['init', 'doctor', 'check', 'login', 'prepare', 'run', 'self-test', 'status'])
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
    if a.action == 'init':
        return init_home(a.host, home)
    if not (home / 'config.json').exists():
        print(json.dumps({
            'status': 'needs_init',
            'message': f'Run first: python3 "{Path(__file__).resolve()}" --host {a.host} init',
        }, ensure_ascii=False))
        return 2
    cfg = read_json(home / 'config.json')
    if cfg['host'] != a.host:
        raise ValueError('Host config mismatch')
    env = dict(os.environ, NODE_PATH=cfg['node_path'])
    node = cfg['node']
    runner = str(Path(__file__).with_name('runner.mjs'))
    browser_args = browser_arguments(cfg)
    if a.action == 'doctor':
        warnings = doctor(node, cfg, env)
        print(json.dumps({
            'status': 'host_ready' if not warnings else 'needs_setup',
            'host': a.host,
            'profile_isolated': True,
            'browser_launch_verified': True,
            'warnings': warnings,
        }, ensure_ascii=False))
        return 0
    if a.action == 'check':
        kinds = [a.kind] if a.kind else ['patent', 'trademark']
        for kind in kinds:
            job = prepare(Path(cfg['materials']), kind)
            if job['description'].startswith('（请替换'):
                print(f'Warning: {kind} description is still the template placeholder; edit 侵权问题话术.xlsx before submitting.', file=sys.stderr)
            print(json.dumps({'host': a.host, 'kind': kind, 'evidence_images': len(job['evidence']), 'status': 'checked_only'}))
        return 0
    if a.action == 'self-test':
        return subprocess.call([node, runner, '--self-test', *browser_args], env=env)
    if a.action == 'login':
        args = [node, runner, '--login', '--profile', str(home / 'browser-profile'), *browser_args]
        if not sys.stdin.isatty():
            args.append('--login-wait')
        return subprocess.call(args, env=env)
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
