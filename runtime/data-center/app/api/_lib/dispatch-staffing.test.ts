import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchShift } from './dispatch-staffing.ts';

test('day shift uses the selected date in Beijing, independent of server timezone', () => {
  assert.deepEqual(dispatchShift('anchor','2026-09-21',['05:30','09:00','同事']), {role:'anchor',name:'同事',startAt:'2026-09-20T21:30:00.000Z',endAt:'2026-09-21T01:00:00.000Z'});
});
test('night shift and early morning belong to the next calendar date', () => {
  const late=dispatchShift('anchor','2026-09-30',['23:00','02:00','同事'])!;
  assert.equal(late.endAt,'2026-09-30T18:00:00.000Z');
  const early=dispatchShift('assistant','2026-12-31',['02:00','05:30','同事'])!;
  assert.equal(early.startAt,'2026-12-31T18:00:00.000Z');
  assert.equal(early.endAt,'2026-12-31T21:30:00.000Z');
  assert.ok(Date.parse(late.endAt)>Date.parse(late.startAt));
});
test('midnight notation stays on the correct instant',()=>{
  assert.equal(dispatchShift('anchor','2026-09-21',['20:00','24:00','同事'])?.endAt,'2026-09-21T16:00:00.000Z');
  assert.equal(dispatchShift('anchor','2026-09-21',['00:00','02:00','同事'])?.startAt,'2026-09-21T16:00:00.000Z');
});
test('invalid or unassigned shifts cannot create fake coverage',()=>{
  for(const row of [['25:00','02:00','同事'],['23:00','02:70','同事'],['08:00','08:00','同事'],['08:00','09:00',''],['休','休','同事']]) assert.equal(dispatchShift('anchor','2026-09-21',row),null);
  assert.equal(dispatchShift('anchor','2026-02-30',['08:00','09:00','同事']),null);
});
