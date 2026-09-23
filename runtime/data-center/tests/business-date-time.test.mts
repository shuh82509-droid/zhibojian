import test from "node:test";
import assert from "node:assert/strict";
import { businessDateTime } from "../app/business-date-time.ts";
test("UTC source receipt is rendered in Shanghai, including date boundary", () => {
 assert.equal(businessDateTime("2026-09-20T09:45:01.043Z"), "2026-09-20 17:45");
 assert.equal(businessDateTime("2026-09-20T18:10:00Z"), "2026-09-21 02:10");
});
test("explicit offsets and original business local times are not shifted twice", () => {
 assert.equal(businessDateTime("2026-09-20T05:38:00+08:00"), "2026-09-20 05:38");
 assert.equal(businessDateTime("2026-09-20 05:38:00"), "2026-09-20 05:38");
});
test("missing or invalid timestamps never become current time", () => {
 assert.equal(businessDateTime(""), "—");
 assert.equal(businessDateTime("not-a-date"), "待核验");
 assert.equal(businessDateTime("2026-99-20T00:00:00Z"), "待核验");
});
