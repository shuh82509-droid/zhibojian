import test from "node:test";
import assert from "node:assert/strict";
import { integrationBaseFromPrefix } from "./integration-route.ts";
test("server selects only the known same-origin integration prefixes",()=>{
  assert.equal(integrationBaseFromPrefix("/yxb/wis-marketing-hub/modules/data-center"),"/yxb/wis-marketing-hub");
  assert.equal(integrationBaseFromPrefix("/fd-026222/wis-marketing-hub/modules/data-center"),"/fd-026222/wis-marketing-hub");
  for(const v of [null,"https://evil.example","/other","/yxb/wis-marketing-hub/modules/data-center/../../"])assert.equal(integrationBaseFromPrefix(v),"");
});
