const test=require('node:test'),assert=require('node:assert/strict');
const clock=require('./schedule-clock');
test('early morning belongs to previous schedule date, never upcoming night',()=>{
 const now=new Date('2026-09-21T02:54:00+08:00');
 assert.equal(clock.businessDate(now),'2026-09-20');
 assert.equal(clock.onShift(['02:00','05:30'],now,'2026-09-20'),true);
 assert.equal(clock.onShift(['02:00','05:30'],now,'2026-09-21'),false);
 assert.equal(clock.onShift(['23:00','05:30'],now,'2026-09-20'),true);
});
test('business boundary and midnight endings are half open',()=>{
 const now=new Date('2026-09-21T05:30:00+08:00');
 assert.equal(clock.businessDate(now),'2026-09-21');
 assert.equal(clock.onShift(['02:00','05:30'],now,'2026-09-20'),false);
 assert.equal(clock.onShift(['05:30','10:00'],now,'2026-09-21'),true);
 assert.equal(clock.onShift(['22:00','24:00'],new Date('2026-09-21T00:00:00+08:00'),'2026-09-20'),false);
});
test('historical/future/invalid dates never borrow current time of day',()=>{
 const now=new Date('2026-09-21T16:00:00+08:00');
 for(const date of ['2026-09-20','2026-09-22','2026-02-30'])assert.equal(clock.onShift(['15:00','18:00'],now,date),false);
 assert.equal(clock.onShift(['15:00','18:00'],now,'2026-09-21'),true);
 assert.equal(clock.onShift(['25:00','26:00'],now,'2026-09-21'),false);
});
