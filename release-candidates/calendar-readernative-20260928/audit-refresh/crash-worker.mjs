// Local synthetic crash worker. Never invokes real fetch or reads live credentials.
import {readFileSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [modulePath,storePath,mode]=process.argv.slice(2);
if(createHash('sha256').update(readFileSync(modulePath)).digest('hex')!==process.env.WIS_READER_REFRESH_SHA)process.exit(91);
const {createCalendarUserReader}=await import(pathToFileURL(modulePath).href);
const holder=`${storePath}.refresh-hold.json`;
let unlinked=false;
function crash(stage,exitCode){if(process.send)process.send({stage},()=>process.exit(exitCode));else process.exit(exitCode);return new Promise(()=>{});}
const fsImpl={...fs,
  async open(path,...args){
    if(mode==='after-grant-before-save'&&String(path).startsWith(storePath+'.')&&!String(path).startsWith(holder+'.')&&String(path).endsWith('.tmp'))return crash('synthetic_grant_returned_before_save',24);
    return fs.open(path,...args);
  },
  async unlink(path){const result=await fs.unlink(path);if(path===holder)unlinked=true;return result;},
};
const reader=createCalendarUserReader({appId:'cli_fixtureOnly',appSecret:'synthetic_app_secret_not_real',calendarId:'calendar_fixture_readonly',expectedOpenId:'ou_fixtureOwner',ownerLabel:'合成本人',
  redirectUri:'https://fixture.invalid/calendar/callback',storePath,encryptionKey:Buffer.alloc(32,19).toString('base64'),now:()=>Date.parse('2026-09-28T14:05:00.000Z'),
  fsImpl,directorySyncImpl:async()=>{if(mode==='after-unlink-before-dirsync'&&unlinked)return crash('synthetic_hold_unlinked_before_dirsync',25);},diagnostic:()=>{},
  fetchImpl:async(url)=>{
    if(url==='https://accounts.feishu.cn/oauth/v3/token'){
      if(mode==='request-result-unknown')return crash('synthetic_refresh_invoked_result_unknown',23);
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>({code:0,access_token:'synthetic_rotated_access_not_real',refresh_token:'synthetic_rotated_refresh_not_real',expires_in:3600,refresh_token_expires_in:86400,scope:'calendar:calendar:read calendar:calendar.event:read offline_access'})};
    }
    // A successful ordinary event GET must never be reached before crash.
    throw new Error('synthetic worker unexpected network phase');
  },
});
try{await reader.get('/calendar/v4/calendars/calendar_fixture_readonly/events?start_time=1790500000&end_time=1790600000&page_size=50');process.exit(90);}
catch{process.exit(92);}
