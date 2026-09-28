import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNativeCalendarRequest as query,decodeNativeCalendarEnvelope as decode,
  collectNativeCalendarSource as collect} from './native-calendar-source.mjs';

const calendarId='feishu.cn_test@group.calendar.feishu.cn', ids=[calendarId];
const instant=Date.UTC(2026,8,28,14,0), anchorSeconds=String(instant/1000-86400);
const envelope=data=>JSON.stringify({code:0,msg:'success',data});
const metadata=(extra={})=>({calendar_id:calendarId,type:'shared',role:'reader',is_deleted:false,
  is_third_party:false,summary:'合成招聘日历',permissions:'private',...extra});
const event=(id='evt_1',extra={})=>({event_id:id,summary:'张三面试',status:'confirmed',
  start_time:{timestamp:String(instant/1000+3600),timezone:'Asia/Shanghai'},
  end_time:{timestamp:String(instant/1000+7200),timezone:'Asia/Shanghai'},
  create_time:String(instant/1000-3600),...extra});
const page=(items=[],extra={})=>({items,has_more:false,sync_token:'sync_fixture',...extra});
function fixture(pages=[page([event()])], options={}) {
  let metadataReads=0, pageReads=0;
  const requests=[];
  const readNative=async (request,{signal})=>{
    requests.push({...request}); assert.equal(signal.aborted,false);
    if(request.kind==='metadata') {
      const data=metadataReads++===0 ? (options.before ?? metadata()) : (options.after ?? metadata());
      return typeof data==='string' ? data : envelope(data);
    }
    const data=pages[pageReads++];
    return typeof data==='string' ? data : envelope(data);
  };
  return {requests,context:{calendarId,approvedCalendarIds:ids,readerOpenId:'ou_fixture',anchorSeconds,
    readNative,now:()=>instant,...options.context}};
}
async function run(pages,options){ const f=fixture(pages,options); return {result:await collect(f.context),requests:f.requests}; }
const pending=(result,reason)=>{ assert.equal(result.status,'pending'); assert.equal(result.readyForReminder,false);
  assert.equal(result.reviewOutcome,null); assert.equal(result.businessPassed,null); if(reason)assert.equal(result.reasonCode,reason); };

test('fixed metadata GET only, no guessed native identity or scope',()=>{
  const url=new URL(query({kind:'metadata',calendarId},ids));
  assert.equal(url.origin,'https://open.feishu.cn');assert.equal(url.search,'');
  assert.equal(url.pathname,`/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}`);
});
test('anchor page uses exact seconds, fixed open_id and opaque token',()=>{
  const opaque='a+/= ?%&中文';
  const url=new URL(query({kind:'anchor_page',calendarId,anchorSeconds,pageToken:opaque,pageSize:50},ids));
  assert.equal(url.searchParams.get('page_token'),opaque);assert.equal(url.searchParams.get('anchor_time'),anchorSeconds);
  assert.equal(url.searchParams.get('user_id_type'),'open_id');assert.equal(url.searchParams.get('page_size'),'50');
  assert.deepEqual([...url.searchParams.keys()],['anchor_time','page_size','user_id_type','page_token']);
});
test('first page does not send page_token',()=>{
  assert.equal(new URL(query({kind:'anchor_page',calendarId,anchorSeconds},ids)).searchParams.has('page_token'),false);
});
for(const [label,patch] of Object.entries({start_time:{start_time:'1'},end_time:{end_time:'2'},sync_token:{sync_token:'x'},
  host:{host:'https://evil.invalid'},method:{method:'POST'},path:{path:'/anything'},user_id_type:{user_id_type:'user_id'},
  size_string:{pageSize:'500'},size_small:{pageSize:49},size_large:{pageSize:1001},anchor_numeric:{anchorSeconds:instant/1000},
  anchor_zero:{anchorSeconds:'0'},anchor_exponent:{anchorSeconds:'1e9'},anchor_float:{anchorSeconds:'12.5'},
  anchor_upper:{anchorSeconds:'4102444800'},token_null:{pageToken:null},token_control:{pageToken:'x\n'},token_format:{pageToken:'x\u200b'}})) {
  test(`query rejects ${label}`,()=>assert.throws(()=>query({kind:'anchor_page',calendarId,anchorSeconds,...patch},ids),
    error=>error.code==='calendar_native_query_denied'));
}
for(const [label,request,allowed] of [
  ['unapproved',{kind:'metadata',calendarId},['other_calendar']],
  ['path_escape',{kind:'metadata',calendarId:'../evil'},ids],
  ['invalid_kind',{kind:'primary',calendarId},ids],
  ['metadata_query',{kind:'metadata',calendarId,pageToken:'x'},ids],
  ['sparse_allowlist',{kind:'metadata',calendarId},[calendarId,,]],
  ['duplicate_allowlist',{kind:'metadata',calendarId},[calendarId,calendarId]],
  ['null_request',null,ids]]) {
  test(`query rejects ${label}`,()=>assert.throws(()=>query(request,allowed)));
}
test('query rejects a getter without invoking it',()=>{
  let evaluated=false;const request={kind:'metadata',get calendarId(){evaluated=true;return calendarId;}};
  assert.throws(()=>query(request,ids));assert.equal(evaluated,false);
});

for(const [label,raw,reason] of [
  ['invalid','not-json','native_json_invalid'],['scalar','42','native_response_unverified'],
  ['code_string','{"code":"0","data":{}}','native_response_unverified'],
  ['upstream_error','{"code":193003,"data":{}}','native_response_unverified'],
  ['data_missing','{"code":0}','native_response_unverified'],
  ['data_array','{"code":0,"data":[]}','native_response_unverified'],
  ['top_duplicate','{"code":1,"code":0,"data":{}}','native_json_duplicate_key'],
  ['escaped_duplicate','{"code":0,"data":{"role":1,"r\\u006fle":2}}','native_json_duplicate_key'],
  ['nested_duplicate','{"code":0,"data":{"items":[{"event_id":"a","event_id":"b"}]}}','native_json_duplicate_key'],
  ['nonfinite','{"code":0,"data":{"x":1e999}}','native_value_unverified'],
  ['trailing','{"code":0,"data":{}}x','native_json_invalid'],
  ['colon','{"code":0,"data" {}}','native_json_invalid']]) {
  test(`raw envelope rejects ${label}`,()=>{const r=decode(raw);assert.equal(r.ok,false);assert.equal(r.reasonCode,reason);});
}
test('canonical data hash preserves all fields but ignores key order and msg',()=>{
  const a=decode('{"code":0,"msg":"x","data":{"a":1,"b":2}}');
  const b=decode('{"msg":"y","code":0,"data":{"b":2,"a":1}}');
  assert.equal(a.nativeDataHash,b.nativeDataHash);assert.notEqual(a.rawHash,b.rawHash);
});
for(const value of ['9007199254740992','9007199254740993','-9007199254740993','1.0000000000000001','0.1','1e0','-0'])
  test('raw numeric precision cannot be normalized into verified source '+value,()=>{
    const r=decode('{"code":0,"data":{"unknown_native_number":'+value+'}}');
    assert.equal(r.ok,false);assert.equal(r.reasonCode,'native_numeric_precision_unverified');
  });
test('distinct rounded raw numeric fields never become a complete metadata CAS',async()=>{
  const before=envelope(metadata()).replace('"role":"reader"','"role":"reader","native_number":9007199254740992');
  const after=envelope(metadata()).replace('"role":"reader"','"role":"reader","native_number":9007199254740993');
  const result=(await run(undefined,{before,after})).result;
  pending(result,'native_numeric_precision_unverified');
});
test('raw response byte limit/depth limit fail closed',()=>{
  assert.equal(decode(' '.repeat(8*1024*1024+1)).reasonCode,'native_raw_size_unverified');
  assert.equal(decode('{"code":0,"data":{"x":'+ '['.repeat(70)+'0'+']'.repeat(70)+'}}').reasonCode,'native_json_depth_unverified');
});

test('complete native source is never a schedule/reminder/owner/business permit',async()=>{
  const {result:r,requests}=await run();assert.equal(r.status,'read_complete');
  assert.equal(r.readyForReminder,false);assert.equal(r.formalScheduleBindingStatus,'pending');
  assert.equal(r.ownerOpenId,null);assert.equal(r.ownerIdentityStatus,'not_exposed_by_calendar_get');
  assert.equal(r.reviewOutcome,null);assert.equal(r.businessPassed,null);
  assert.equal(Object.hasOwn(r.events[0],'updatedAt'),false);assert.equal(Object.hasOwn(r.events[0],'deleted'),false);
  assert.equal(r.observedPages,1);assert.equal(r.observedEvents,1);assert.equal(requests.length,3);
  assert.match(r.sourceFingerprint,/^[0-9a-f]{64}$/u);assert.match(r.transportFingerprint,/^[0-9a-f]{64}$/u);
  assert.equal(r.readStartedAt,new Date(instant).toISOString());assert.equal(r.readCompletedAt,r.readStartedAt);
});
for(const role of ['reader','writer','owner']) test(`native ${role} role is readable, never personal ownership`,async()=>{
  const {result:r}=await run(undefined,{before:metadata({role}),after:metadata({role})});
  assert.equal(r.status,'read_complete');assert.equal(r.ownerOpenId,null);assert.equal(r.readyForReminder,false);
});
for(const [label,extra,reason] of [
  ['id',{calendar_id:'wrong_calendar'},'native_calendar_id_mismatch'],
  ['google',{type:'google'},'native_calendar_type_unverified'],
  ['unknown_type',{type:'unknown'},'native_calendar_type_unverified'],
  ['busy',{role:'free_busy_reader'},'native_calendar_details_unavailable'],
  ['deleted',{is_deleted:true},'native_calendar_liveness_unverified'],
  ['missing_deleted',{is_deleted:undefined},'native_calendar_liveness_unverified'],
  ['third_party',{is_third_party:true},'native_calendar_liveness_unverified'],
  ['missing_third_party',{is_third_party:undefined},'native_calendar_liveness_unverified']]) {
  test(`metadata rejects ${label}`,async()=>pending((await run(undefined,{before:metadata(extra)})).result,reason));
}
test('native metadata must be data top-level, not inferred from calendar wrapper',async()=>{
  pending((await run(undefined,{before:{calendar:metadata()}})).result,'native_calendar_id_mismatch');
});
test('metadata change on final read invalidates source',async()=>{
  pending((await run(undefined,{after:metadata({color:123})})).result,'native_calendar_metadata_drift');
});
test('empty intermediate page continues; all cancelled/multiname/outside records remain',async()=>{
  const records=[event('a',{status:'cancelled'}),event('b',{summary:'张三、李四面试'}),
    event('c',{start_time:{timestamp:String(instant/1000+100*86400)}})];
  const {result:r,requests}=await run([page([],{has_more:true,page_token:'next_1'}),page(records)]);
  assert.equal(r.status,'read_complete');assert.deepEqual(r.events,records);assert.equal(r.readyForReminder,false);
  assert.equal(requests[2].pageToken,'next_1');assert.equal(r.observedPages,2);assert.equal(r.observedEvents,3);
});
for(const [label,data,reason] of [
  ['missing_boolean',{items:[]},'native_page_schema_unverified'],
  ['string_boolean',{items:[],has_more:'false'},'native_page_schema_unverified'],
  ['missing_items',{has_more:false},'native_page_schema_unverified'],
  ['missing_cursor',page([],{has_more:true}),'native_cursor_unverified'],
  ['empty_cursor',page([],{has_more:true,page_token:''}),'native_cursor_unverified'],
  ['terminal_nonempty',page([],{page_token:'unexpected'}),'native_terminal_cursor_conflict'],
  ['terminal_number',page([],{page_token:12}),'native_terminal_cursor_conflict'],
  ['terminal_null',page([],{page_token:null}),'native_terminal_cursor_conflict'],
  ['sync_null',page([],{sync_token:null}),'native_sync_token_unverified'],
  ['bad_event_id',page([{summary:'x'}]),'native_event_identity_unverified'],
  ['duplicate_event',page([event(),event()]),'native_event_id_duplicate'],
  ['duplicate_changed',page([event(),event('evt_1',{summary:'李四面试'})]),'native_event_id_duplicate']]) {
  test(`page rejects ${label}`,async()=>pending((await run([data])).result,reason));
}
test('cursor cycle is rejected without retry',async()=>{
  const {result,requests}=await run([page([],{has_more:true,page_token:'x'}),page([],{has_more:true,page_token:'y'}),
    page([],{has_more:true,page_token:'x'})]);pending(result,'native_cursor_unverified');
  assert.equal(requests.length,4);
});
test('no same-event dedupe across pages',async()=>{
  pending((await run([page([event()],{has_more:true,page_token:'next'}),page([event()])])).result,'native_event_id_duplicate');
});
test('page cap does not claim terminal or read final metadata',async()=>{
  const {result,requests}=await run([page([],{has_more:true,page_token:'next'})],{context:{maxPages:1}});
  pending(result,'native_page_cap_exceeded');assert.equal(requests.length,2);
});
test('event cap and actual page-size violations remain pending',async()=>{
  pending((await run([page([event('a'),event('b')])],{context:{maxEvents:1}})).result,'native_event_cap_exceeded');
  pending((await run([page(Array.from({length:51},(_,i)=>event('e'+i)))],{context:{pageSize:50}})).result,'native_page_size_exceeded');
});
test('native field change changes semantic source fingerprint',async()=>{
  const a=(await run([page([event()])])).result;
  const b=(await run([page([event('evt_1',{new_native_field:{state:'changed'}})])])).result;
  assert.notEqual(a.sourceFingerprint,b.sourceFingerprint);assert.equal(b.events[0].new_native_field.state,'changed');
});
test('transport nonce/order change is not a source-field change; evidence retained separately',async()=>{
  const records=[event('a'),event('b')];
  const a=(await run([page([records[0]],{has_more:true,page_token:'x'}),page([records[1]])])).result;
  const b=(await run([page([records[1]],{has_more:true,page_token:'y'}),page([records[0]],{sync_token:'fresh'})])).result;
  assert.equal(a.sourceFingerprint,b.sourceFingerprint);assert.notEqual(a.transportFingerprint,b.transportFingerprint);
  assert.equal(a.pages[0].nativeData.page_token,'x');assert.equal(b.pages[0].nativeData.page_token,'y');
});
test('fetch failure is sanitized, not retried',async()=>{
  let calls=0;const {context}=fixture();context.readNative=async()=>{calls++;throw new Error('secret-value-fixture');};
  const result=await collect(context);pending(result,'native_read_failed');assert.equal(calls,1);
  assert.equal(JSON.stringify(result).includes('secret-value-fixture'),false);
});
test('clock rollback and elapsed-time limit fail closed',async()=>{
  let tick=0;let f=fixture();f.context.now=()=>instant-(tick++>1?1:0);
  pending(await collect(f.context),'native_clock_regressed');
  tick=0;f=fixture();f.context.now=()=>instant+(tick++>1?120001:0);
  pending(await collect(f.context),'native_read_timeout');
});
test('hanging source is actually bounded and receives an abort signal',async()=>{
  const {context}=fixture();let signal;context.maxDurationMs=15;
  context.readNative=async(_,options)=>{signal=options.signal;return new Promise(()=>{});};
  const result=await collect(context);pending(result,'native_read_timeout');assert.equal(signal.aborted,true);
});
for(const [label,patch] of Object.entries({bad_reader:{readerOpenId:{}},bad_clock:{now:()=>NaN},
  large_cap:{maxPages:201},bad_event_cap:{maxEvents:20001},bad_duration:{maxDurationMs:120001},
  unapproved_source:{approvedCalendarIds:['wrong_calendar']},bad_anchor:{anchorSeconds:'0'}})) {
  test(`collector rejects ${label}`,async()=>{const {context}=fixture();pending(await collect({...context,...patch}));});
}
