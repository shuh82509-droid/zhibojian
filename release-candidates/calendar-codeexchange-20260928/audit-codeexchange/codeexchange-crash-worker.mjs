// Synthetic crash worker: fake code/grant only, no environment app credentials or real fetch.
import {readFileSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [modulePath,storePath,mode]=process.argv.slice(2);
if(createHash('sha256').update(readFileSync(modulePath)).digest('hex')!==process.env.WIS_CODEEXCHANGE_SHA)process.exit(91);
globalThis.fetch=async()=>{throw new Error('synthetic crash worker refuses live network');};
const {createCalendarUserReader}=await import(pathToFileURL(modulePath).href);
const holder=storePath+'.code-hold.json';
let unlinked=false;
function crash(stage,exitCode){
  if(process.send)process.send({stage},()=>process.exit(exitCode));else process.exit(exitCode);
  return new Promise(()=>{});
}
const fsImpl={...fs,
  async readFile(path,...args){
    const value=await fs.readFile(path,...args);
    if(mode==='intent-readback-before-post'&&path===holder)return crash('intent_readback_before_POST',23);
    return value;
  },
  async open(path,...args){
    if(mode==='grant-before-save'&&args[0]==='wx'&&String(path).startsWith(storePath+'.')
      &&!String(path).startsWith(holder+'.')&&!String(path).startsWith(storePath+'.refresh-hold.json.'))
      return crash('verified_grant_before_save',26);
    return fs.open(path,...args);
  },
  async rename(from,to){
    const result=await fs.rename(from,to);
    if(mode==='saved-before-readback'&&to===storePath)return crash('saved_before_grant_readback',27);
    return result;
  },
  async unlink(path){const result=await fs.unlink(path);if(path===holder)unlinked=true;return result;},
};
const SCOPE='calendar:calendar:read calendar:calendar.event:read offline_access';
const reader=createCalendarUserReader({appId:'cli_syntheticCodeOnly',appSecret:'synthetic_APP_SECRET_never_real',
  calendarId:'calendar_synthetic_code_only',expectedOpenId:'ou_synthetic_code_owner',ownerLabel:'合成授权人',
  redirectUri:'https://fixture.invalid/readonly-code-callback',storePath,encryptionKey:Buffer.alloc(32,37).toString('base64'),
  now:()=>Date.parse('2026-09-28T15:45:00.000Z'),fsImpl,
  directorySyncImpl:async()=>{if(mode==='hold-unlinked-before-dirsync'&&unlinked)return crash('code_hold_unlinked_before_dirsync',28);},
  diagnostic:()=>{},
  fetchImpl:async url=>{
    if(url==='https://open.feishu.cn/open-apis/authen/v2/oauth/token'){
      if(mode==='request-result-unknown')return crash('code_POST_result_unknown',24);
      if(mode==='pause-post'){
        if(process.send)process.send({stage:'code_POST_paused'});
        return new Promise((_resolve,reject)=>{
          process.on('message',message=>{if(message.release==='reject_synthetic_result')reject(new Error('synthetic result is unknown'));});
        });
      }
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({code:0,access_token:'synthetic_ACCESS_never_real',
        refresh_token:'synthetic_REFRESH_never_real',expires_in:3600,refresh_token_expires_in:86400,scope:SCOPE})};
    }
    if(url==='https://open.feishu.cn/open-apis/authen/v1/user_info'){
      if(mode==='userinfo-after-grant')return crash('userinfo_after_code_grant',25);
      return {ok:true,status:200,json:async()=>({code:0,data:{open_id:'ou_synthetic_code_owner'}})};
    }
    if(url==='https://open.feishu.cn/open-apis/calendar/v4/calendars/calendar_synthetic_code_only')
      return {ok:true,status:200,json:async()=>({code:0,data:{role:'reader'}})};
    throw new Error('synthetic worker unexpected HTTP phase');
  },
});
const attempt=reader.begin();
try{await reader.complete({code:'synthetic_AUTH_CODE_never_real',state:attempt.state,cookieState:attempt.state});process.exit(90);}
catch{process.exit(92);}
