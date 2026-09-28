# 独立终审：4.9.1 组 B 初审与送审身份窄修

收口：2026-09-28 19:54 上海时间。范围：同任务虚构夹具、候选 pure engine 静态/本地检查。没有生产、Git、飞书、OAuth、真实消息/journal 或默认 server 执行。

## 结论

本次约定的组 B 窄源码目标通过：初审 OK/No 双值冲突顺序无关地待核；同名多 ID、共享 ID、重复页内容/时间/反应冲突、可识别但不完整的送审来源不再被后续面评/offer 恢复为已通过或已不通过阶段。对应 funnel 的已核结果共用该门禁。完全一致的同 ID 重复页仍保持合法正向路径。

独立新增 56/56 虚构夹具通过；拷贝适配的先前 OA 三组 179/179 通过；组合 235/235、0 fail、0 skip。最终范围未发现新的 P1/P2。

**该结论只适用于冻结窄源码，不是上线或业务验收。其他组 A/C/D、跨周期、完整来源/OA/发送及发布门禁仍未由本补丁全部解决；完整生产发布与招聘提醒启用继续 NO-GO。**

## 冻结对象与精确差异

- 新候选：`H:/codex输出/直播五环节工作流-20260923/calendar-initial-identity-exact-20260928/candidate-3e42689c-1942`
- 新 engine SHA256：`54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954`
- prior/base engine SHA256：`d90bbca1858b1131dfdaa8a7d6a81c7a17f305bd51e6a912105cad755b544133`
- server SHA256 维持上轮：`e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c`
- 本轮独立测试 SHA256：`5076d4fc9f3cfc630826bdd53f449451f76129e71baac90a3db150c59ab59891`

独立只读字节验证：新 engine 仅 `reviewerReaction → interviewEvaluation`（含新增 pure identity helper）与 `parseRecruitmentMessages → calendarTitleNamesPerson` 两段改变，其余每个字节等同 frozen prior/base d90bbca1；server 每个字节仍符合上述 e345f9f1。未运行含 writeFileSync 的 preserve-engine-bytes.mjs；本审查只用自己的只读字符串区间比较和 SHA 验证。

旧 candidate-3e42689c-6de440c4 文件未改动。新拷贝测试改动审查：两段新增 identity 代码纳入 composition 字节范围；新 parser 会 blank sourceId，所以两个旧重现用 oldEngine.parseRecruitmentMessages 保留旧 passedCount=1 的对照，新结果必须 sourceId=''、stage=unmapped、passedCount=0/awaiting。缺 source key 时检查 awaiting/no-key，而非错误期待不存在 key 的 passed=null；这与更严格的 blank-source 行为相符，不是放宽业务门禁。

## 源码契约核验

1. engine:36 的 reviewerReaction 集合化指定 reviewer 的 OK/No，双值返回 null/conflict；同值重复、表情重排、他人反应不会选“第一条”来改变结果。
2. engine:51 identity helper 在任何阶段推进前遍历全部 active 消息。byId 对完整观察投影比较：正文/reviewText、精确 timestamp、更新时间、chat/sender/type、截断标记、资源、指定 reviewer 反应语义。同 ID 后页已不含送审语法或空正文仍参与比较，并将该 ID 曾识别的姓名冻结。
3. 每姓名完整唯一送审 ID、每 ID 单姓名；缺/非法 ID、缺/非法时间、可见截断、重复姓名/副本差异不能被另一同名完整来源洗掉。重复完全一致的页可去重；不同 reviewer 反应顺序而目标语义相同保持正向。
4. engine:247 的 ambiguous 记录 blank submissionEvidence.sourceId 和 date、initialReview=null；engine:253 保留 alternatives；submissionMessageCounts 保留实际不同非空 ID 数（例如同名两条仍为 2，同 ID 冲突仍为 1），不伪造 count0。
5. engine:277 的 canAdvance 对 cohort 必须 source identity 不歧义且初审 OK；缺表情唯一来源保持初审 pending，No 保持 initial_fail，后续 pass/fail 面评或 offer 均不得覆盖。无 cohort 的旧显示路径按约定保留，不能因此称全部面评安全。
6. engine:306/310 初审和面试 funnel 使用同一门禁后的 evidence。影响范围内没有已核初审/面试计数，另一合法独立姓名仍可推进。这里“0 已核通过”不等于现实中 0 人；观察名称数、记录数也不是已确认同名人员数。
7. 上轮 OA helper 未改，blank sourceId 会拒绝旧双签重新恢复。独立虚构双签重现 passedCount=0。
8. parseEmploymentMessages / mergeRecruitmentCandidates 字节未改；合成正式入职来源的 hired、actualStartDate、来源和入职 timeline 在 merge 后保留，招聘来源仍 blank/pending。合成入职事实不代表某位真实同事已办理。

## 独立测试覆盖与命令

IDENTITY-INDEPENDENT.test.mjs 使用显式 WIS_IDENTITY_REVIEW_ENGINE，未指定即拒绝执行；本轮同时设置 WIS_IDENTITY_REVIEW_SHA 验证目标。只导入 pure engine，不导入 server、存储或业务端点。

- 合法唯一 OK/No、唯一面试 pass/fail、offer 待入职。
- OK/No 顺序翻转、重复相同反应、无关人反应、exact duplicate page、语义反应重排。
- 同 ID 不同正文、非送审正文、空正文、同日秒漂移、不同日期、缺/坏时间、反应 flip/missing/dual、不同人，正反输入顺序。
- 同名两 ID、同 ID 两人、缺/坏 ID、缺/坏日期、可见截断，以及另一同名合法源不能解除 pending。
- 唯一无初审表情/No 后续 pass/fail/offer 阻断；影响 scope 隔离；blank-source 旧 OA 拒绝；独立入职事实保留；输入不变。

```powershell
$env:WIS_IDENTITY_REVIEW_ENGINE='H:/codex输出/直播五环节工作流-20260923/calendar-initial-identity-exact-20260928/candidate-3e42689c-1942/lifecycle-engine.mjs'
$env:WIS_IDENTITY_REVIEW_SHA='54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954'
& H:\node.exe --test --test-reporter=tap .\IDENTITY-INDEPENDENT.test.mjs
```

独立 56/56；候选内 copied FALLBACK-INDEPENDENT-REVIEW.test.mjs 63/63、oa-fallback.test.mjs 66/66、oa-identity-readback.test.mjs 50/50；四文件组合 235/235、0 fail/skip。Linux 候选重跑和生产首末 CAS由主代理另行记录，本代理不拿本地测试代替它们。

## 仍然 NO-GO 的边界

- 严格面评否定/多人/未知第二人、后续相关不可核内容、完整原文及 group A 语法未在本窄修重写。当前 source normalizer 的截断/媒体信息不足仍不能由“纯 fixture 标记能拦”消除。
- 多人日历、标题 80 字截断、日历时间/唯一事件、初审与来源完整指纹、正式 17:00 通知门禁等 group C 风险保留。
- 锁内 fresh 来源/CAS、cache、durable 签署提交与严格读回、私聊端点/初始化等 group D/系统边界仍不因本次组 B 门禁变安全。
- 跨周期 carryover、真实人员/源表/OA 页面/旧通知链接、备份回滚/唯一写者、生产切换及 Git 交付、四房五节点真人闭环都不在本合成验收完成范围。

可继续后续受控候选准备；不能启用正式提醒、把 candidate/test/Git 等同生产，或宣称 4.9.1—4.9.4 与五环节全部完成。
