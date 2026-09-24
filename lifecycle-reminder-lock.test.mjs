import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReminderJournalLock } from './lifecycle-reminder-lock.mjs';

const owner = (host,pid) => ({schemaVersion:1,host,pid,nonce:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',acquiredAt:'2026-09-24T01:00:00.000Z'});
async function fixture(operation) {
  const dir=await mkdtemp(join(tmpdir(),'lifecycle-reminder-lock-'));
  try { return await operation(dir,join(dir,'notification-receipts.json.lock')); }
  finally { await rm(dir,{recursive:true,force:true}); }
}

test('normal reminder journal lock has a verifiable owner and releases after work',async()=>fixture(async(_dir,path)=>{
  const lock=createReminderJournalLock({lockPath:path,host:'same-host',pid:1234,probePid:()=> 'alive'});
  assert.equal((await lock.inspect()).state,'free');
  const result=await lock.run(async()=>{
    const actual=JSON.parse(await readFile(join(path,'owner.json'),'utf8'));
    assert.equal(actual.host,'same-host');
    assert.equal(actual.pid,1234);
    assert.equal((await lock.inspect()).state,'active');
    return 'written';
  });
  assert.equal(result,'written');
  assert.equal((await lock.inspect()).state,'free');
}));

test('same-host definitely dead owner is archived before one new operation',async()=>fixture(async(dir,path)=>{
  await mkdir(path);
  await writeFile(join(path,'owner.json'),JSON.stringify(owner('same-host',4321)));
  const lock=createReminderJournalLock({lockPath:path,host:'same-host',pid:1234,probePid:pid=>pid===4321?'dead':'alive'});
  assert.equal((await lock.inspect()).state,'stale_recoverable');
  assert.equal(await lock.run(async()=> 'resumed'),'resumed');
  assert.equal((await lock.inspect()).state,'free');
  const archived=(await readdir(dir)).filter(item=>item.includes('.orphaned-'));
  assert.equal(archived.length,1);
  assert.deepEqual(JSON.parse(await readFile(join(dir,archived[0],'owner.json'),'utf8')),owner('same-host',4321));
}));

test('other host, unknown process and legacy empty locks remain blocked',async()=>fixture(async(_dir,path)=>{
  await mkdir(path);
  const lock=createReminderJournalLock({lockPath:path,host:'same-host',pid:1234,probePid:()=> 'dead'});
  assert.equal((await lock.inspect()).state,'blocked_unknown');
  await assert.rejects(lock.run(async()=>{throw Error('must not run');}),/所有者记录/);
  await writeFile(join(path,'owner.json'),JSON.stringify(owner('other-host',4321)));
  assert.equal((await lock.inspect()).state,'blocked_unknown');
  await assert.rejects(lock.run(async()=>{throw Error('must not run');}),/另一主机/);
  await writeFile(join(path,'owner.json'),JSON.stringify(owner('same-host',4321)));
  const unknown=createReminderJournalLock({lockPath:path,host:'same-host',pid:1234,probePid:()=> 'unknown'});
  assert.equal((await unknown.inspect()).state,'blocked_unknown');
  await assert.rejects(unknown.run(async()=>{throw Error('must not run');}),/无法证明/);
}));

test('live owner and abandoned recovery marker cannot be bypassed',async()=>fixture(async(_dir,path)=>{
  await mkdir(path);
  await writeFile(join(path,'owner.json'),JSON.stringify(owner('same-host',4321)));
  const lock=createReminderJournalLock({lockPath:path,host:'same-host',pid:1234,probePid:()=> 'alive'});
  assert.equal((await lock.inspect()).state,'active');
  await assert.rejects(lock.run(async()=>{throw Error('must not run');}),/仍存在/);
  await mkdir(`${path}.recovery`);
  assert.equal((await lock.inspect()).state,'blocked_unknown');
  await assert.rejects(lock.run(async()=>{throw Error('must not run');}),/恢复标记/);
}));
