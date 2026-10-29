import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const name = 'dsh-douyin-ip-report';

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function settingsFile() {
  return path.join(dshHome(), 'douyin-report', 'ui-settings.json');
}

/**
 * The final-submit confirmation is a local UI setting. It defaults to on and
 * can only be changed from the sidebar panel; the agent only reads it.
 */
export async function readSettings() {
  try {
    const data = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    return { confirm_before_submit: data.confirm_before_submit !== false };
  } catch {
    return { confirm_before_submit: true };
  }
}

async function writeSettings(confirmBeforeSubmit) {
  const file = settingsFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ confirm_before_submit: confirmBeforeSubmit }, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}

async function readStates(dir, host) {
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
  const states = [];
  for (const entry of names) {
    if (!entry.endsWith('.state.json')) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8'));
      if (!data || typeof data !== 'object') continue;
      states.push({
        host,
        kind: data.kind === 'trademark' ? 'trademark' : 'patent',
        status: typeof data.status === 'string' ? data.status : 'unknown',
        links: Number.isSafeInteger(data.link_count) ? data.link_count : null,
        updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
      });
    } catch {
      // A half-written or malformed state file must not take the panel down.
    }
  }
  return states;
}

/**
 * Summarise this machine's local Douyin complaint tasks.
 * Only state files (host / kind / status / link count / updated_at) are read;
 * job manifests contain links and complaint text and are deliberately not
 * exposed. Both the DSH and the optional Codex host are included, labelled.
 */
export async function collectSummary() {
  const states = [
    ...await readStates(path.join(dshHome(), 'douyin-report', 'jobs'), 'deepseek'),
    ...await readStates(path.join(codexHome(), 'douyin-report', 'jobs'), 'codex'),
  ];
  const counts = {};
  for (const state of states) counts[state.status] = (counts[state.status] || 0) + 1;
  states.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const settings = await readSettings();
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    total: states.length,
    counts,
    recent: states.slice(0, 8),
    confirm_before_submit: settings.confirm_before_submit,
  };
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('body too large');
  }
  return JSON.parse(body || '{}');
}

export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-douyin-report/summary',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' });
          response.end();
          return;
        }
        try {
          const body = await collectSummary();
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          response.end(JSON.stringify(body));
        } catch {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: 'summary unavailable' }));
        }
      },
    });
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-douyin-report/settings',
      handler: async (request, response) => {
        if (request.method === 'GET') {
          try {
            const settings = await readSettings();
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end(JSON.stringify({ ok: true, ...settings }));
          } catch {
            response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ ok: false, error: 'settings unavailable' }));
          }
          return;
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'GET, POST' });
          response.end();
          return;
        }
        try {
          const body = await readJsonBody(request);
          if (typeof body.confirm_before_submit !== 'boolean') {
            response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ ok: false, error: 'confirm_before_submit must be a boolean' }));
            return;
          }
          await writeSettings(body.confirm_before_submit);
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: true, confirm_before_submit: body.confirm_before_submit }));
        } catch (error) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ok: false, error: error.message || 'invalid request' }));
        }
      },
    });
  });
}
