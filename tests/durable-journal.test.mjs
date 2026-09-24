import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import test from 'node:test';
import {writeDurableJsonAtomic} from '../durable-journal.mjs';

function fakeFileSystem({failAt=''}={}) {
  const events=[];
  const record=event=>{events.push(event);if(event===failAt)throw new Error(`forced ${event}`);};
  return {events,operations:{
    async open(_path,mode) {
      record(`open:${mode}`);
      return mode==='wx'
        ? {async writeFile(){record('write');},async sync(){record('file-sync');},async close(){record('file-close');}}
        : {async sync(){record('dir-sync');},async close(){record('dir-close');}};
    },
    async rename(){record('rename');},
    async unlink(){record('unlink');}
  }};
}

test('intent bytes and renamed directory entry are synced before returning',async()=>{
  const fake=fakeFileSystem();
  await writeDurableJsonAtomic('/persist/notification-receipts.json',{schemaVersion:1,receipts:[{state:'sending'}]},
    {fileSystem:fake.operations,nonce:()=> 'test'});
  assert.deepEqual(fake.events,['open:wx','write','file-sync','file-close','rename','open:r','dir-sync','dir-close']);
});

test('failed file sync never renames an intent and cleans its temp file',async()=>{
  const fake=fakeFileSystem({failAt:'file-sync'});
  await assert.rejects(writeDurableJsonAtomic('/persist/notification-receipts.json',{receipts:[]},
    {fileSystem:fake.operations,nonce:()=> 'test'}),/forced file-sync/);
  assert.deepEqual(fake.events,['open:wx','write','file-sync','file-close','unlink']);
});

test('failed directory sync reports uncertainty after rename',async()=>{
  const fake=fakeFileSystem({failAt:'dir-sync'});
  await assert.rejects(writeDurableJsonAtomic('/persist/notification-receipts.json',{receipts:[]},
    {fileSystem:fake.operations,nonce:()=> 'test'}),/forced dir-sync/);
  assert.deepEqual(fake.events,['open:wx','write','file-sync','file-close','rename','open:r','dir-sync','dir-close']);
  assert.equal(fake.events.includes('unlink'),false);
});

test('Linux filesystem readback uses mode 0600 and leaves no temp file',{skip:process.platform!=='linux'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'live-reminder-journal-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
  try {
    const path=join(directory,'notification-receipts.json');
    const value={schemaVersion:1,receipts:[{key:randomUUID(),state:'sending'}]};
    await writeDurableJsonAtomic(path,value);
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),value);
    assert.equal((await stat(path)).mode & 0o777,0o600);
    assert.deepEqual(await readdir(directory),['notification-receipts.json']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
