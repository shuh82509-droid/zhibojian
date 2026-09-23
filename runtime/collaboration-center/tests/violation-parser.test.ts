import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViolation, roomFromScreenshotText, type ChatMessage } from "../app/api/violations/route.ts";

function message(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: "om_1234567890abcdefghij",
    chatName: "直播间违规监控群",
    text,
    imageKeys: [],
    sender: "直播助理",
    createdAt: "2026-08-19T02:30:00.000Z",
    ...overrides,
  };
}

test("extracts the ordered six-field violation ledger and mentioned anchor", () => {
  const row = normalizeViolation(message([
    "违规单号：7675587632948216064",
    "直播间编号：7675489139130764072",
    "违规时间：2026-08-19 10:25",
    "直播间：官旗直播间",
    "违规主播：林澄",
    "违规的详细：功效宣传超出备案范围",
    "违规句：三天彻底祛痘",
    "相关商品：WIS水润面膜",
  ].join("\n")));

  assert.ok(row);
  assert.deepEqual(
    { id: row.id, roomId: row.roomId, time: row.time, detail: row.detail, quote: row.quote, product: row.product },
    {
      id: "7675587632948216064",
      roomId: "7675489139130764072",
      time: "2026-08-19 10:25",
      detail: "功效宣传超出备案范围",
      quote: "三天彻底祛痘",
      product: "WIS水润面膜",
    },
  );
  assert.equal(row.room, "WIS官方旗舰店");
  assert.equal(row.host, "林澄");
  assert.equal("status" in row, false);
  assert.equal("level" in row, false);
});

test("maps the screenshot top-right shop label without collapsing specific shops into 官旗", () => {
  assert.equal(roomFromScreenshotText("WIS官方旗舰店甄选"), "WIS官方旗舰店甄选");
  assert.equal(roomFromScreenshotText("WIS官方旗舰店优选"), "WIS官方旗舰店优选");
  assert.equal(roomFromScreenshotText("WIS燕窝面膜护肤店"), "WIS燕窝面膜护肤店");
  assert.equal(roomFromScreenshotText("WIS官方旗舰店"), "WIS官方旗舰店");
  assert.equal(roomFromScreenshotText("识别不清"), "待确认");
});

test("recognizes an explicitly mentioned anchor but does not use the message sender as anchor", () => {
  const base = "违规单号：7675587632948216064\n直播间编号：7675489139130764072\n违规详情：宣传绝对化功效";
  const mentioned = normalizeViolation(message(`${base}\n主播：@潘小慧`));
  const unknown = normalizeViolation(message(base));
  assert.equal(mentioned?.host, "潘小慧");
  assert.equal(unknown?.host, "待确认");
});

test("filters operational断播重开 messages and generic reminders", () => {
  assert.equal(normalizeViolation(message("官旗直播间刚刚断播，已重开并完成群内报备")), null);
  assert.equal(normalizeViolation(message("提醒大家避免违规，断播后按流程重开")), null);
});

test("does not guess a room from a product name", () => {
  const row = normalizeViolation(message("违规单号：7675587632948216064\n直播间编号：7675489139130764072\n违规通知：存在功效宣传\n违规详情：商品描述不规范\n相关商品：燕窝面膜"));
  assert.equal(row?.room, "待确认");
  assert.equal(row?.roomId, "7675489139130764072");
});

test("parses the compact Feishu violation post and excludes non-anchor mentions", () => {
  const row = normalizeViolation(message([
    "我哪里违规了",
    "违规时间2026/08/19 12:00:47违规单号7675587632948216064",
    "处置对象",
    "直播间7675489139130764072",
    "您在2026-08-19直播口播中，宣传的特殊功效在商详中未体现，属于宣传与实际不符。",
    "违规位置",
    "直播口播",
    "违规句",
    "“脸上有斑斑点点的，它能够帮你淡化”",
    "违规商品(共1件)",
    "【官方正品】WIS晶润紧致眼贴60片补水保湿抗皱紧致去细纹眼膜护肤",
    "直播时间",
    "2026/08/19 08:28:24 - 2026/08/19 08:29:24",
    "@刘慧迅",
    "@梁瑜涵",
    "@赖燕妮",
    "@李晓茏",
  ].join("\n")));
  assert.ok(row);
  assert.equal(row.id, "7675587632948216064");
  assert.equal(row.roomId, "7675489139130764072");
  assert.equal(row.time, "2026/08/19 12:00:47");
  assert.match(row.detail, /宣传的特殊功效/);
  assert.equal(row.quote, "“脸上有斑斑点点的，它能够帮你淡化”");
  assert.match(row.product, /WIS晶润紧致眼贴60片/);
  assert.equal(row.host, "李晓茏");
  assert.equal(row.room, "WIS官方旗舰店甄选");
});
