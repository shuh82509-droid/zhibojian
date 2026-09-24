import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {coachTargets,createCoachDeviceRecovery} from './coach-device-recovery.mjs';

const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const granted='calendar:calendar:read calendar:calendar.event:read offline_access';

test('operator allowlist matches the serving calendar and identity allowlists',async()=>{
  const server=await readFile(new URL('../../server.js',import.meta.url),'utf8');
  const block=name=>{
    const found=server.match(new RegExp(`const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\}\\);`,'u'));
    assert.ok(found,`${name} is missing from the serving module`);
    return found[1];
  };
  const identities=block('verifiedCoachOpenIds');
  const calendars=block('coachCalendarIds');
  for(const [room,target] of Object.entries(coachTargets)){
    assert.ok(identities.includes(`'${room}':'${target.openId}'`),`coach identity mismatch: ${room}`);
    assert.ok(calendars.includes(`'${room}':'${target.calendarId}'`),`primary calendar mismatch: ${room}`);
  }
});

test('only four fixed coaches may be selected and each token uses its own encrypted calendar file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'coach-device-'));
  const stores=new Set();
  try {
    for(const [room,target] of Object.entries(coachTargets)){
      let clock=1_000_000;
      const calls=[];
      const selected=createCoachDeviceRecovery({room,appId:'cli_test',appSecret:'private_secret',dataDir:dir,
        encryptionKey:randomBytes(32).toString('base64'),now:()=>clock,fetchImpl:async(url,options)=>{
          calls.push({url,options});
          if(url.endsWith('/device_authorization'))return reply({device_code:`device_${room}`,user_code:'XXXX-YYYY',
            verification_uri_complete:'https://accounts.feishu.cn/device?user_code=XXXX-YYYY',expires_in:600,interval:5});
          if(url.endsWith('/oauth/token'))return reply({code:0,access_token:'private_access',refresh_token:'private_refresh',
            expires_in:7200,refresh_token_expires_in:604800,scope:granted});
          if(url.endsWith('/user_info'))return reply({code:0,data:{open_id:target.openId}});
          if(url.includes('/calendars/primary?'))return reply({code:0,data:{calendars:[{user_id:target.openId,
            calendar:{calendar_id:target.calendarId,type:'primary',is_deleted:false}}]}});
          if(decodeURIComponent(url).endsWith('/'+target.calendarId))return reply({code:0,data:{calendar_id:target.calendarId,role:'owner'}});
          throw Error(`unexpected provider path ${url}`);
        }});
      assert.equal(selected.coachName,target.name);
      assert.equal(selected.storePath,join(dir,'lifecycle',`coach-calendar-${room}.json`));
      assert.equal(stores.has(selected.storePath),false);stores.add(selected.storePath);
      const issued=await selected.recovery.issue();assert.equal(issued.authorized,false);
      assert.equal(new URLSearchParams(calls[0].options.body).get('scope'),granted);
      clock+=5000;
      const result=await selected.recovery.poll();assert.equal(result.authorized,true);
      assert.equal(result.calendarId,target.calendarId);
      assert.ok(calls.some(call=>call.url.includes('/calendars/primary?')));
      const encrypted=await readFile(selected.storePath,'utf8');
      assert.doesNotMatch(encrypted,/private_access|private_refresh|device_/u);
    }
    assert.equal(stores.size,4);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('unknown room and missing absolute data directory fail before any credential or provider use',()=>{
  const config={appId:'cli_test',appSecret:'private_secret',dataDir:tmpdir(),encryptionKey:randomBytes(32).toString('base64')};
  for(const room of ['不存在','../官旗','官旗/../优选',''])
    assert.throws(()=>createCoachDeviceRecovery({...config,room}),{code:'unknown_coach_room'});
  assert.throws(()=>createCoachDeviceRecovery({...config,room:'官旗',dataDir:'data'}),{code:'coach_data_dir_invalid'});
});

test('wrong consenting user cannot populate a coach token file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'coach-device-wrong-user-'));
  let clock=1_000_000;
  try {
    const selected=createCoachDeviceRecovery({room:'官旗',appId:'cli_test',appSecret:'private_secret',dataDir:dir,
      encryptionKey:randomBytes(32).toString('base64'),now:()=>clock,fetchImpl:async(url)=>{
        if(url.endsWith('/device_authorization'))return reply({device_code:'private_device',
          verification_uri_complete:'https://accounts.feishu.cn/device?user_code=XXXX-YYYY',expires_in:600,interval:5});
        if(url.endsWith('/oauth/token'))return reply({code:0,access_token:'private_access',refresh_token:'private_refresh',
          expires_in:7200,refresh_token_expires_in:604800,scope:granted});
        if(url.endsWith('/user_info'))return reply({code:0,data:{open_id:'ou_wrong_person'}});
        throw Error('unexpected provider request');
      }});
    await selected.recovery.issue();clock+=5000;
    await assert.rejects(selected.recovery.poll(),{code:'device_wrong_user_or_unverified'});
    await assert.rejects(readFile(selected.storePath,'utf8'),{code:'ENOENT'});
  } finally {await rm(dir,{recursive:true,force:true});}
});
