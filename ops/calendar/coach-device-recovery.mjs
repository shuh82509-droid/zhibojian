// Operator-only fallback for four named coaches after a browser PKCE failure.
// This does not install a web route or use another person's calendar token.
import {isAbsolute, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDeviceRecovery} from './calendar-device-recovery.mjs';

export const coachTargets = Object.freeze({
  '官旗':Object.freeze({name:'曾泳淇',openId:'ou_57dd3c1f41a299db90e8a0e8ec39b811',calendarId:'feishu.cn_pQcZPLwwNcPCNorI81UuNc@group.calendar.feishu.cn'}),
  '品牌精选':Object.freeze({name:'梁瑜涵',openId:'ou_e0fb6d700b7761ff10d304fa24fca25e',calendarId:'feishu.cn_tdknXodfOV2BreSu4Qwwlc@group.calendar.feishu.cn'}),
  '优选':Object.freeze({name:'李爽',openId:'ou_7d335ea053a4b824d870cd40cefb39f5',calendarId:'feishu.cn_mUczVPvHhxexy37YFYHZ6b@group.calendar.feishu.cn'}),
  '王鸥美肤':Object.freeze({name:'鲍敏纳',openId:'ou_7bf9975d7038b6d80f381442cd5f233b',calendarId:'feishu.cn_xLLavzycbNr1OKdfHrV1cg@group.calendar.feishu.cn'}),
});

const fail = code => Object.assign(new Error(code), {code});

export function createCoachDeviceRecovery({room,appId,appSecret,dataDir,encryptionKey,fetchImpl,now}) {
  if (!Object.hasOwn(coachTargets, room)) throw fail('unknown_coach_room');
  if (!dataDir || !isAbsolute(dataDir)) throw fail('coach_data_dir_invalid');
  const target=coachTargets[room];
  const storePath=join(dataDir,'lifecycle',`coach-calendar-${room}.json`);
  return {
    room,
    coachName:target.name,
    storePath,
    recovery:createDeviceRecovery({appId,appSecret,calendarId:target.calendarId,expectedOpenId:target.openId,
      storePath,encryptionKey,requireOwnPrimaryCalendar:true,fetchImpl,now}),
  };
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [action,room]=process.argv.slice(2);
    if (!['issue','poll'].includes(action)) throw fail('unknown_action');
    const selected=createCoachDeviceRecovery({room,appId:process.env.FEISHU_APP_ID,appSecret:process.env.FEISHU_APP_SECRET,
      dataDir:process.env.DATA_DIR,encryptionKey:process.env.RECRUITMENT_CALENDAR_OAUTH_KEY});
    console.log(JSON.stringify({ok:true,room,coachName:selected.coachName,...await selected.recovery[action]()}));
  } catch(error) {
    // Never print the device code, token, application credential, or provider body.
    console.log(JSON.stringify({ok:false,code:error.code||'coach_device_recovery_failed'}));
    process.exitCode=1;
  }
}
