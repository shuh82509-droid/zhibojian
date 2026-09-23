(function(root) {
  'use strict';
  const dayMs=86400000, offsetMs=8*3600000, boundaryMinutes=330;
  function calendarDate(now=new Date()) { return new Date(+now+offsetMs).toISOString().slice(0,10); }
  function businessDate(now=new Date()) { return calendarDate(new Date(+now-boundaryMinutes*60000)); }
  function minute(value) {
    const m=/^(\d{1,2}):(\d{2})$/.exec(String(value));
    if(!m || +m[1]>24 || +m[2]>59 || (+m[1]===24 && +m[2]!==0)) return NaN;
    return +m[1]*60 + +m[2];
  }
  function onShift(range,now=new Date(),date=businessDate(now)) {
    if(!range || !/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
    const base=Date.parse(date+'T00:00:00+08:00');
    if(!Number.isFinite(base) || calendarDate(new Date(base))!==date)return false;
    let start=minute(range[0]),end=minute(range[1]);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start===end)return false;
    if(start<boundaryMinutes)start+=1440;
    if(end<=boundaryMinutes)end+=1440;
    if(end<=start)end+=1440;
    return +now>=base+start*60000 && +now<base+end*60000;
  }
  function timelineMinute(now=new Date()) {return ((+now+offsetMs)%dayMs)/60000;}
  const api={calendarDate,businessDate,onShift,timelineMinute};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.ScheduleClock=api;
})(typeof window==='object'?window:globalThis);
