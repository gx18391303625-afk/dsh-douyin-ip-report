import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const name = 'dsh-douyin-ip-report';

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/**
 * Summarise this host's local Douyin complaint tasks.
 * Only state files (kind / status / link count / updated_at) are read; job
 * manifests contain links and complaint text and are deliberately not exposed.
 */
export async function collectSummary() {
  const dir = path.join(dshHome(), 'douyin-report', 'jobs');
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const states = [];
  for (const entry of names) {
    if (!entry.endsWith('.state.json')) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8'));
      if (!data || typeof data !== 'object') continue;
      states.push({
        kind: data.kind === 'trademark' ? 'trademark' : 'patent',
        status: typeof data.status === 'string' ? data.status : 'unknown',
        links: Number.isSafeInteger(data.link_count) ? data.link_count : null,
        updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
      });
    } catch {
      // A half-written or malformed state file must not take the panel down.
    }
  }
  const counts = {};
  for (const state of states) counts[state.status] = (counts[state.status] || 0) + 1;
  states.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    total: states.length,
    counts,
    recent: states.slice(0, 8),
  };
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
  });
}
