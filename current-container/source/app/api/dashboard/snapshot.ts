type Session = {
  id: string; key: string; shop: string; title: string; startAt: string; durationSeconds: number; status: string;
  gmv: number; cost: number; refund: number; watchers: number; conversion: number; online: number;
};

const sessions: Session[] = [
  { id: "7673636496284470067", key: "WIS官方旗舰店|7673636496284470067", shop: "WIS官方旗舰店", title: "七夕专属好礼，拍一到手42件！", startAt: "2026-08-14 05:50:00", durationSeconds: 27605, status: "live", gmv: 205276.73, cost: 90166.43, refund: 24171.05, watchers: 20310, conversion: 6.002, online: 62 },
  { id: "7673633859984018210", key: "WIS官方旗舰店甄选|7673633859984018210", shop: "WIS官方旗舰店甄选", title: "WIS七夕宠粉专场，给自己的浪漫礼遇！", startAt: "2026-08-14 05:40:00", durationSeconds: 28187, status: "live", gmv: 37481.81, cost: 18142.09, refund: 3589.39, watchers: 7511, conversion: 5.3921, online: 27 },
  { id: "7673654707545541430", key: "WIS官方旗舰店优选|7673654707545541430", shop: "WIS官方旗舰店优选", title: "紧！亮！弹！WIS深海精华次抛重磅上新，焕亮紧致相约七夕！", startAt: "2026-08-14 07:00:00", durationSeconds: 23382, status: "live", gmv: 6513.83, cost: 4283.53, refund: 589.55, watchers: 1369, conversion: 5.3324, online: 7 },
];

const trafficByKey: Record<string, { label: string; value: number; color: string }[]> = {
  "WIS官方旗舰店|7673636496284470067": [{ label: "短视频", value: 25.66, color: "#d7f15b" }, { label: "直播推荐", value: 27.07, color: "#17694f" }, { label: "其他", value: 47.27, color: "#dfe7e2" }],
  "WIS官方旗舰店甄选|7673633859984018210": [{ label: "短视频", value: 14.5, color: "#d7f15b" }, { label: "直播推荐", value: 31.24, color: "#17694f" }, { label: "其他", value: 54.26, color: "#dfe7e2" }],
  "WIS官方旗舰店优选|7673654707545541430": [{ label: "短视频", value: 21.78, color: "#d7f15b" }, { label: "直播推荐", value: 17.42, color: "#17694f" }, { label: "其他", value: 60.8, color: "#dfe7e2" }],
};

const audience = [
  ["Z世代", 3.22], ["小镇青年", 12.86], ["新锐白领", 8.76], ["精致妈妈", 9.45],
  ["资深中产", 15.27], ["都市蓝领", 9.99], ["都市银发", 21.9], ["小镇中老年", 18.55],
].map(([label, value]) => ({ label: String(label), value: Number(value) }));

const trendByKey: Record<string, { hour: string; gmv: number; roi: number; conversion: number }[]> = {
  "WIS官方旗舰店|7673636496284470067": [
    ["06:00",11716.59,3.53], ["07:00",25654.49,2.78], ["08:00",30639.46,2.45], ["09:00",46330.67,2.41], ["10:00",33873.24,2.21], ["11:00",17855.95,2.13], ["12:00",17503.55,2.15], ["13:00",18572.76,2.65],
  ].map(([hour,gmv,roi]) => ({ hour: String(hour), gmv: Number(gmv), roi: Number(roi), conversion: 6.002 })),
  "WIS官方旗舰店甄选|7673633859984018210": [["06:00",1500.83,2.05],["07:00",2265.25,1.7],["08:00",3594.08,2.01],["09:00",5436.19,1.8],["10:00",7104.38,1.87],["11:00",7252.72,1.86],["12:00",4635.53,2.13],["13:00",5687.08,2.63]].map(([hour,gmv,roi]) => ({ hour: String(hour), gmv: Number(gmv), roi: Number(roi), conversion: 5.3921 })),
  "WIS官方旗舰店优选|7673654707545541430": [["07:00",183.15,0.72],["08:00",836.39,1.27],["09:00",660.25,1.77],["10:00",736.76,1.23],["11:00",1058.43,2.43],["12:00",1139.15,2.49],["13:00",1897.35,1.74]].map(([hour,gmv,roi]) => ({ hour: String(hour), gmv: Number(gmv), roi: Number(roi), conversion: 5.3324 })),
};

const staffingByKey: Record<string, { role: string; name: string; startAt: string; endAt: string }[]> = {
  "WIS官方旗舰店|7673636496284470067": [
    { role: "anchor", name: "何嘉慧", startAt: "2026-08-14 13:00:00", endAt: "2026-08-14 16:00:00" },
    { role: "assistant", name: "蒙万叶", startAt: "2026-08-14 10:10:00", endAt: "2026-08-14 15:00:00" },
  ],
};

export function snapshotDashboard(requestedKey: string | null) {
  const selectedSessionKey = sessions.some((item) => item.key === requestedKey) ? requestedKey : sessions[0].key;
  const selected = sessions.find((item) => item.key === selectedSessionKey)!;
  return {
    date: "2026-08-14", minDate: "2026-07-31", maxDate: "2026-08-14", refreshMinutes: 60,
    agent: { name: "直播数据快照", summary: "由已授权数据 MCP 在 2026-08-14 13:30（北京时间）生成的只读快照。" },
    shops: ["WIS官方旗舰店", "WIS官方旗舰店甄选", "WIS官方旗舰店优选", "WIS燕窝面膜护肤店"],
    sessions, recentSessions: sessions, selectedSessionKey,
    traffic: trafficByKey[selectedSessionKey] ?? [], audience: selected.shop === "WIS官方旗舰店" ? audience : [],
    trend: trendByKey[selectedSessionKey] ?? [], staffing: staffingByKey[selectedSessionKey] ?? [],
    visual: { avatarUrl: "", accountName: selected.shop, title: selected.title, background: null },
    fetchedAt: "2026-08-14T13:30:03+08:00",
  };
}
