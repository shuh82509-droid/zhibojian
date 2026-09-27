import {createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdir, open, readFile, rename, rmdir, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

const lifetimeMs = 10 * 60_000;
const tokenPattern = /^([A-Za-z0-9_-]{43})\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/u;
const fail = () => Object.assign(new Error('授权邀请无效、已使用或已过期，请联系管理员重新获取。'), {code:'coach_invite_invalid'});

// An invitation is deliberately not an identity assertion. It only binds a
// short-lived, single-use browser entry to one pre-verified coach open_id;
// Feishu user_info and primary-calendar ownership are checked after OAuth.
export function createCoachCalendarInviteStore({path, signingKey, clock=Date.now}) {
  const key = /^[A-Za-z0-9+/]{43}=$/u.test(signingKey || '') ? Buffer.from(signingKey, 'base64') : Buffer.alloc(0);
  const configured = Boolean(path && key.length === 32);
  // Reuse the existing approved secret only as HKDF input key material. The
  // calendar credential-encryption key is never used directly as a MAC key.
  const inviteKey = configured ? Buffer.from(hkdfSync('sha256',key,
    Buffer.from('WIS live coach calendar authorization v1'),
    Buffer.from('single-use invitation HMAC-SHA256 v1'),32)) : Buffer.alloc(0);
  const hash = id => createHash('sha256').update(id).digest('hex');
  const signature = (id, expiresAt, room, openId) => createHmac('sha256',inviteKey)
    .update(`WIS coach calendar invitation v1\0${id}\0${expiresAt}\0${room}\0${openId}`).digest('base64url');
  const same = (a,b) => {
    const left=Buffer.from(String(a)),right=Buffer.from(String(b));
    return left.length===right.length && timingSafeEqual(left,right);
  };
  function assertConfigured() {
    if (!configured) throw Object.assign(new Error('教练本人授权邀请尚未配置。'),{code:'coach_invite_not_configured'});
  }
  async function read() {
    assertConfigured();
    let contents;
    try { contents=await readFile(path,'utf8'); }
    catch(error) { if(error?.code==='ENOENT') return {version:1,records:[]}; throw error; }
    let journal;
    try { journal=JSON.parse(contents); }
    catch { throw Object.assign(new Error('授权邀请账本不可读，已停止签发和使用。'),{code:'coach_invite_store_invalid'}); }
    if(journal?.version!==1 || !Array.isArray(journal.records) || journal.records.length>10_000
      || journal.records.some(item=>!item || !/^[a-f0-9]{64}$/u.test(item.idHash||'')
        || !['issued','consumed'].includes(item.state) || !Number.isSafeInteger(item.expiresAt)
        || typeof item.room!=='string' || typeof item.openId!=='string'))
      throw Object.assign(new Error('授权邀请账本结构异常，已停止签发和使用。'),{code:'coach_invite_store_invalid'});
    return journal;
  }
  async function save(journal) {
    const temporary=`${path}.${randomBytes(8).toString('hex')}.tmp`;
    let created=false,renamed=false;
    try {
      const file=await open(temporary,'wx',0o600);
      created=true;
      try { await file.writeFile(JSON.stringify(journal),'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary,path);
      renamed=true;
      if(process.platform!=='win32') {
        const directory=await open(dirname(path),'r');
        try { await directory.sync(); }
        finally { await directory.close(); }
      }
    } catch(error) {
      if(created&&!renamed) { try { await unlink(temporary); } catch { /* Preserve the failure. */ } }
      throw error;
    }
  }
  async function exclusive(operation) {
    assertConfigured();
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const lock=`${path}.lock`;
    try { await mkdir(lock,{mode:0o700}); }
    catch { throw Object.assign(new Error('授权邀请账本正在处理或结果待核验。'),{code:'coach_invite_busy'}); }
    try { return await operation(); }
    finally { await rmdir(lock); }
  }
  function verifiedRecord(journal,token) {
    const match=tokenPattern.exec(String(token||''));
    if(!match) throw fail();
    const [,id,expiry,mac]=match;
    const records=journal.records.filter(item=>item.idHash===hash(id));
    if(records.length!==1) throw fail();
    const record=records[0];
    if(record.state!=='issued' || record.expiresAt!==Number(expiry) || record.expiresAt<=clock()
      || !same(mac,signature(id,expiry,record.room,record.openId))) throw fail();
    return record;
  }
  async function issue(room,openId) {
    if(typeof room!=='string' || typeof openId!=='string' || !/^ou_[A-Za-z0-9]+$/u.test(openId)) throw fail();
    return exclusive(async()=>{
      const journal=await read();
      if(journal.records.length>=10_000) throw Object.assign(new Error('授权邀请账本已满，须人工审计。'),{code:'coach_invite_store_full'});
      const id=randomBytes(32).toString('base64url');
      const expiresAt=clock()+lifetimeMs;
      journal.records.push({idHash:hash(id),room,openId,expiresAt,state:'issued'});
      await save(journal);
      return {token:`${id}.${expiresAt}.${signature(id,expiresAt,room,openId)}`,expiresAt};
    });
  }
  async function inspect(token) {
    const journal=await read();
    const {room,openId,expiresAt}=verifiedRecord(journal,token);
    return {room,openId,expiresAt};
  }
  async function consume(token) {
    return exclusive(async()=>{
      const journal=await read();
      const record=verifiedRecord(journal,token);
      record.state='consumed';
      await save(journal); // Durable consumption precedes any Feishu OAuth redirect.
      return {room:record.room,openId:record.openId,expiresAt:record.expiresAt};
    });
  }
  return {configured,issue,inspect,consume};
}
