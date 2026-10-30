import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectSummary } from '../lib/index.js';

test('summary preserves original kind and does not expose links or originals', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-summary-test-'));
  const before={DSH_HOME:process.env.DSH_HOME,CODEX_HOME:process.env.CODEX_HOME};
  try {
    process.env.DSH_HOME=path.join(dir,'deepseek'); process.env.CODEX_HOME=path.join(dir,'codex');
    const jobs=path.join(process.env.DSH_HOME,'douyin-report','jobs');
    await fs.mkdir(jobs,{recursive:true});
    await fs.writeFile(path.join(jobs,'fixture.state.json'),JSON.stringify({kind:'original',status:'prepared',link_count:1,updated_at:'2026-10-30T00:00:00Z',targets:{private:'hidden target and original'}}));
    const result=await collectSummary();
    assert.equal(result.recent[0].kind,'original');
    assert.equal(result.recent[0].links,1);
    assert.equal(result.confirm_before_submit,true);
    assert.equal(JSON.stringify(result).includes('hidden'),false);
  } finally {
    for(const [key,value] of Object.entries(before)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
    // mkdtemp's exact prefix-bound path, never a production directory.
    assert.ok(dir.startsWith(path.join(os.tmpdir(),'douyin-summary-test-')));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
