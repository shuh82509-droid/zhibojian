import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Only the pure collector module is imported. Every response, identity, clock
// and callback below is synthetic; there is no default fetch, token or server.
const moduleUrl=process.env.WIS_NATIVE_SOURCE_MODULE
  ? pathToFileURL(process.env.WIS_NATIVE_SOURCE_MODULE)
  : new URL('../calendar-native-source-exact-20260928/candidate-2205/native-calendar-source.mjs',import.meta.url);
const expectedSha=process.env.WIS_NATIVE_SOURCE_SHA || 'ef2bf28096e2bc503c7aa07776c19e8734904839ad84a804872abb1f571a57cd';
const moduleBytes=await readFile(moduleUrl);
assert.equal(createHash('sha256').update(moduleBytes).digest('hex'),expectedSha,'exact reviewed source SHA');
// Exact inverse of the three numeric-only source edits reconstructs the whole
// first reviewed module hash, proving every other source byte stayed unchanged.
const numericBlock=[
  '      if (/^[-0-9]/u.test(match[0])) {',
  '        const number = Number(match[0]);',
  "        if (!Number.isFinite(number)) throw new Error('native_value_unverified');",
  '        // JSON.parse silently rounds large integers and long fractional values.',
  '        // Unknown native fields cannot be CAS evidence after lossy decoding.',
  '        // Do not guess decimal precision or silently normalize such values.',
  '        if (!/^-?(?:0|[1-9]\\d*)$/u.test(match[0]) || !Number.isSafeInteger(number) || Object.is(number,-0))',
  "          throw new Error('native_numeric_precision_unverified');",
  '      }',
].join('\n')+'\n';
const source=moduleBytes.toString('utf8');
assert.equal(source.split(numericBlock).length,2,'one numeric scan insertion');
const reconstructed=source.replace(numericBlock,'')
  .replace('Number.isSafeInteger(value) && !Object.is(value,-0)','Number.isFinite(value)')
  .replace("'native_value_unverified','native_numeric_precision_unverified']","'native_value_unverified']");
assert.equal(createHash('sha256').update(reconstructed).digest('hex'),
  '04e86b3422b568c310894805b2ad7466abb69eba130ddbbf903e988e886f7649','numeric-only complete source scope');
const {buildNativeCalendarRequest:query,decodeNativeCalendarEnvelope:decode,collectNativeCalendarSource:collect}
  =await import(moduleUrl.href);

const id='synthetic_review@group.calendar.feishu.cn',approved=[id],actor='ou_synthetic_reader';
const instant=Date.UTC(2026,8,28,14,40),anchor=String(instant/1000-86400);
const raw=data=>JSON.stringify({code:0,data});
const meta=extra=>({calendar_id:id,type:'shared',role:'reader',is_deleted:false,is_third_party:false,...extra});
const event=(eventId='fixture_event_1',extra)=>({event_id:eventId,summary:'虚构测试甲面试',status:'confirmed',
  start_time:{timestamp:String(instant/1000),timezone:'Asia/Shanghai'},
  end_time:{timestamp:String(instant/1000+1800),timezone:'Asia/Shanghai'},...extra});
const page=(items=[],extra)=>({items,has_more:false,...extra});
function fixture({pages=[page([event()])],before=meta(),after=meta(),context={},onRead}={}) {
  const calls=[];let metaCount=0,pageCount=0;
  const readNative=async(request,options)=>{
    assert.ok(Object.isFrozen(request));assert.equal(options.signal.aborted,false);
    calls.push({...request});
    if(onRead)return onRead(request,options,calls);
    const data=request.kind==='metadata'?(metaCount++===0?before:after):pages[pageCount++];
    return typeof data==='string'?data:raw(data);
  };
  return {calls,context:{calendarId:id,approvedCalendarIds:approved,readerOpenId:actor,
    anchorSeconds:anchor,readNative,now:()=>instant,...context}};
}
const pending=(result,reason)=>{
  assert.equal(result.status,'pending');assert.equal(result.readyForReminder,false);
  assert.equal(result.formalScheduleBindingStatus,'pending');assert.equal(result.businessPassed,null);
  assert.equal(result.reviewOutcome,null);assert.equal(result.ownerOpenId,null);
  if(reason)assert.equal(result.reasonCode,reason);
};
async function run(options){const item=fixture(options);return {...item,result:await collect(item.context)};}

test('source is exact pinned pure collector and public contract never provides a permit',async()=>{
  const {result,calls}=await run();assert.equal(result.status,'read_complete');assert.equal(calls.length,3);
  assert.equal(result.readyForReminder,false);assert.equal(result.formalScheduleBindingStatus,'pending');
  assert.equal(result.reviewOutcome,null);assert.equal(result.businessPassed,null);assert.equal(result.ownerOpenId,null);
  assert.equal(result.readerIdentityStatus,'dependency_not_authenticated_by_collector');
});

for(const [label,text]of [
  ['nested escaped key','{"code":0,"data":{"items":[{"event_id":"a","event\\u005fid":"b"}]}}'],
  ['escaped top code','{"c\\u006fde":0,"code":0,"data":{}}'],
  ['unicode surrogate key','{"code":0,"data":{"😀":1,"\\ud83d\\ude00":2}}'],
  ['prototype key','{"code":0,"data":{"__proto__":1,"__proto__":2}}'],
  ['quote escaped key','{"code":0,"data":{"a\\\"b":1,"a\\u0022b":2}}'],
  ['backslash escaped key','{"code":0,"data":{"a\\\\b":1,"a\\u005cb":2}}'],
])test(`raw duplicate decoded keys are rejected: ${label}`,()=>{
  const result=decode(text);assert.equal(result.ok,false);assert.equal(result.reasonCode,'native_json_duplicate_key');
});
for(const text of ['{"code":0,"data":{"x":+1}}','{"code":0,"data":{"x":01}}',
  '{"code":0,"data":{"x":.1}}','{"code":0,"data":{"x":1.}}',
  '{"code":0,"data":{"x":"bad\nstring"}}','{"code":0,"data":{}}{"code":0,"data":{}}'])
  test(`malformed native JSON does not become evidence: ${JSON.stringify(text)}`,()=>assert.equal(decode(text).ok,false));
test('UTF8 raw limit measures bytes, not characters',()=>{
  const text=raw({text:'甲'.repeat(2_800_000)});assert.ok(text.length<8*1024*1024);
  assert.equal(decode(text).reasonCode,'native_raw_size_unverified');
});
test('all native long/unknown fields affect hashes; there is no summary truncation',async()=>{
  const summary='甲'.repeat(50000)+'尾A',record=event('long',{summary,native_extra:{flag:false,unknown:[1,'x',null]}});
  const a=(await run({pages:[page([record])]})).result;
  const b=(await run({pages:[page([{...record,summary:summary.slice(0,-1)+'B'}])]})).result;
  assert.equal(a.status,'read_complete');assert.equal(a.events[0].summary,summary);
  assert.deepEqual(a.events[0].native_extra,record.native_extra);assert.notEqual(a.sourceFingerprint,b.sourceFingerprint);
});
test('raw hash includes complete envelope whitespace and ignored transport message',()=>{
  const a=decode('{"code":0,"msg":"transport A","data":{"x":"native"}}');
  const b=decode(' { "data" : { "x" : "native" }, "msg":"transport B","code":0 } ');
  assert.equal(a.nativeDataHash,b.nativeDataHash);assert.notEqual(a.rawHash,b.rawHash);
});
test('lossy native numeric metadata cannot silently satisfy final metadata CAS',async()=>{
  const before=raw(meta({native_numeric_field:0})).replace('"native_numeric_field":0','"native_numeric_field":9007199254740992');
  const after=before.replace('9007199254740992','9007199254740993');
  assert.notEqual(createHash('sha256').update(before).digest('hex'),createHash('sha256').update(after).digest('hex'));
  const {result}=await run({before,after});pending(result);
});
for(const lexeme of ['1.0000000000000001','0.125','1.0','1e3','1E0','-0','9007199254740993','1e999'])
  test(`unverified raw numeric token ${lexeme} is rejected before semantic hashing`,()=>{
    const result=decode(`{"code":0,"data":{"native_numeric_field":${lexeme}}}`);
    assert.equal(result.ok,false);
  });
for(const lexeme of ['0','-7','9007199254740991','-9007199254740991'])
  test(`safe integer raw token ${lexeme} may be observed but is no permit`,()=>{
    const result=decode(`{"code":0,"data":{"native_numeric_field":${lexeme}}}`);
    assert.equal(result.ok,true);assert.equal(result.data.native_numeric_field,Number(lexeme));
  });

test('empty middle pages and cancelled/recurring/future/out-of-range observations are retained',async()=>{
  const records=[event('cancelled',{status:'cancelled'}),event('series',{recurrence:'FREQ=DAILY',is_exception:false}),
    event('future',{summary:'测试甲、测试乙面试',start_time:{timestamp:'4000000000'}})];
  const {result,calls}=await run({pages:[page([],{has_more:true,page_token:'n1'}),
    page([],{has_more:true,page_token:'n2'}),page(records)]});
  assert.equal(result.status,'read_complete');assert.deepEqual(result.events,records);assert.equal(calls.length,5);
  assert.equal(result.observedPages,3);assert.deepEqual(calls.filter(item=>item.kind==='anchor_page').map(item=>item.pageToken),['','n1','n2']);
});
for(const repeated of [event('duplicate'),event('duplicate',{status:'cancelled'}),event('duplicate',{summary:'changed'})])
  test(`duplicate same event ID across pages never dedupes ${JSON.stringify(repeated)}`,async()=>{
    const {result,calls}=await run({pages:[page([event('duplicate')],{has_more:true,page_token:'next'}),page([repeated])]});
    pending(result,'native_event_id_duplicate');assert.equal(calls.length,3);
  });
for(const token of [undefined,'',null,0,'bad\n','bad\u2066'])test(`nonterminal cursor ${JSON.stringify(token)} is not completion`,async()=>{
  const {result,calls}=await run({pages:[page([],{has_more:true,page_token:token})]});
  pending(result,'native_cursor_unverified');assert.equal(calls.length,2);
});
test('empty pages with a cursor loop stop without extra metadata or retries',async()=>{
  const {result,calls}=await run({pages:[page([],{has_more:true,page_token:'a'}),
    page([],{has_more:true,page_token:'b'}),page([],{has_more:true,page_token:'a'})]});
  pending(result,'native_cursor_unverified');assert.equal(calls.length,4);
});
for(const pageToken of [null,23,'terminal_nonces_not_verified'])test(`terminal cursor contradiction is pending: ${String(pageToken)}`,async()=>{
  pending((await run({pages:[page([],{page_token:pageToken})]})).result,'native_terminal_cursor_conflict');
});
test('exact maximum 200 pages proves observed sequence only, with 202 requests',async()=>{
  const pages=Array.from({length:200},(_,i)=>page([],{has_more:i<199,...(i<199?{page_token:'p'+i}:{})}));
  const {result,calls}=await run({pages});assert.equal(result.status,'read_complete');assert.equal(result.observedPages,200);
  assert.equal(calls.length,202);assert.equal(result.readyForReminder,false);
});
test('200 nonterminal pages hit cap without requesting page 201 or final metadata',async()=>{
  const pages=Array.from({length:200},(_,i)=>page([],{has_more:true,page_token:'p'+i}));
  const {result,calls}=await run({pages});pending(result,'native_page_cap_exceeded');assert.equal(calls.length,201);
});
test('event budget is checked on observed rows, not deduped count',async()=>{
  const {result,calls}=await run({pages:[page([event('a'),event('b'),event('c')])],context:{maxEvents:2}});
  pending(result,'native_event_cap_exceeded');assert.equal(calls.length,2);
});
test('aggregate bytes include metadata before/after and every full page',async()=>{
  const padding='x'.repeat(8*1024*1024-1024);
  const metadata=raw(meta({padding}));
  const pages=[page([],{has_more:true,page_token:'a',padding}),page([],{has_more:true,page_token:'b',padding}),page([],{padding})];
  const {result,calls}=await run({before:metadata,after:metadata,pages});
  pending(result,'native_total_bytes_exceeded');assert.equal(calls.length,5);
});
test('metadata late mismatch/liveness loss cannot satisfy original source',async()=>{
  const {result,calls}=await run({after:meta({is_deleted:true})});
  pending(result,'native_calendar_liveness_unverified');assert.equal(calls.length,3);
});
for(const [field,value]of [['role','owner'],['type','primary'],['summary','changed native text'],['unknown',false]])
  test(`final metadata drift is checked for ${field}`,async()=>{
    pending((await run({after:meta({[field]:value})})).result,'native_calendar_metadata_drift');
  });

test('one request timeout aborts, and late callback completion cannot trigger another request',async()=>{
  let observedSignal;
  const item=fixture({context:{maxDurationMs:8},onRead:async(request,options,calls)=>{
    if(calls.length===1)return raw(meta());observedSignal=options.signal;
    return new Promise(resolve=>setTimeout(()=>resolve(raw(page([event()]))),25));
  }});
  const result=await collect(item.context);pending(result,'native_read_timeout');assert.equal(item.calls.length,2);
  assert.equal(observedSignal.aborted,true);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(item.calls.length,2);
});
test('clock rollback after a page response fails before final metadata',async()=>{
  let current=instant;
  const item=fixture({context:{now:()=>current},onRead:async(request)=>{
    if(request.kind==='metadata')return raw(meta());current--;return raw(page([event()]));
  }});
  pending(await collect(item.context),'native_clock_regressed');assert.equal(item.calls.length,2);
});
for(const now of [()=>NaN,()=>Infinity,()=>0,()=>-1,()=>4102444800000,()=>instant+0.5])
  test(`invalid clock ${String(now())} rejects before first request`,async()=>{
    const item=fixture({context:{now}});pending(await collect(item.context),'native_clock_unverified');assert.equal(item.calls.length,0);
  });
test('readNative failure and private native bodies are absent from failure result',async()=>{
  const item=fixture({onRead:async()=>{throw new Error('SYNTHETIC_PRIVATE_BODY');}});
  const result=await collect(item.context);pending(result,'native_read_failed');assert.equal(item.calls.length,1);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_BODY'),false);
  assert.equal(Object.hasOwn(result,'metadata'),false);assert.equal(Object.hasOwn(result,'pages'),false);
});

test('metadata reader/writer/owner are roles only, not event/personal ownership',async()=>{
  for(const role of ['reader','writer','owner']){
    const {result}=await run({before:meta({role,owner_open_id:actor}),after:meta({role,owner_open_id:actor})});
    assert.equal(result.status,'read_complete');assert.equal(result.ownerOpenId,null);
    assert.equal(result.fieldEvidence.ownerOpenId,'not_exposed');assert.equal(result.readyForReminder,false);
  }
});
test('missing event update/delete fields remain missing, never default false/time',async()=>{
  const {result}=await run();assert.equal(result.status,'read_complete');
  for(const field of ['updatedAt','update_time','deleted','is_deleted','ownerOpenId'])assert.equal(Object.hasOwn(result.events[0],field),false);
  assert.equal(result.fieldEvidence.eventUpdateTime,'not_exposed');assert.equal(result.fieldEvidence.eventDeleted,'not_exposed');
});
test('an event only needs native ID for observation; missing start/status is not a normalized schedule',async()=>{
  const native={event_id:'opaque_only',native_extra:'unchanged'};
  const {result}=await run({pages:[page([native])]});assert.equal(result.status,'read_complete');assert.deepEqual(result.events,[native]);
  assert.equal(result.readyForReminder,false);assert.equal(result.formalScheduleBindingStatus,'pending');
});
test('complete anchor coverage does not claim both recruitment cycles or business binding',async()=>{
  const {result}=await run();assert.equal(result.status,'read_complete');
  assert.equal(Object.hasOwn(result,'oldCycleComplete'),false);assert.equal(Object.hasOwn(result,'newCycleComplete'),false);
  assert.equal(Object.hasOwn(result,'bindingVerified'),false);assert.equal(result.reviewOutcome,null);
});
test('fixed metadata query rejects symbol/accessor/extra controls and never invokes getter',()=>{
  let invoked=false;const request={kind:'metadata',get calendarId(){invoked=true;return id;}};
  assert.throws(()=>query(request,approved));assert.equal(invoked,false);
  assert.throws(()=>query({kind:'metadata',calendarId:id,[Symbol('extra')]:true},approved));
  assert.throws(()=>query({kind:'metadata',calendarId:id,start_time:'1'},approved));
});
