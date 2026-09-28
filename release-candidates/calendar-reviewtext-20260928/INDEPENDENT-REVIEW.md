# 独立终审：4.9.1 组 A 原文投影与面评语法窄修

结论：本轮约定的纯源码组 A 安全目标通过。只支持完整、明确的单人面评语法；否定/问句/未知第二人/不可核媒体与截断/重复内容/后续不明或撤回不会变成已核面试结论。初审来源、面评文本线索与最终业务绑定分开；`text_ready` 不能提升 `interview_pass/fail`，业务面试统计明确为 null/待核验。

**此结论不是 4.9.1 全功能完成，也不是生产发布、授权或真实业务验收。组 C/D/E、正式来源与发送门禁仍未完成，生产及招聘提醒启用仍 NO-GO。**

仅本目录新增独立测试、scope 脚本和本审查记录；未修改候选、生产、Git；未调用真实 API、OAuth、浏览器、人员名册、消息或 journal。所有消息内容、ID、账号、时间及反应均为虚构内存夹具。

## 冻结对象和精确范围

候选：`calendar-reviewtext-exact-20260928/candidate-2042`，实现者已确认冻结。终测前后 SHA256 相同：

| 对象 | SHA256 |
| --- | --- |
| recruitment-content.mjs | edb7ceabc33cb8758ea0a0072cd2d08ae53700ca8f629b42a878d6994f9c5a5e |
| lifecycle-engine.mjs | fa30f7895774f856527d5e07025edeffb927978a9d2b46146049811648ed06d3 |
| server.js | 2590ce6d3f8ded1b8eebcaaa26f7e77fe5b424b56a64ad2334bb81ab50b9ad5f |
| 独立 reviewtext-independent.test.mjs | a5570ca29f50b183298824e7b7336c104c24aca50e9f001ab696649243618b1e |
| 独立 scope-independent.mjs | d7fe1f1573f3dabc811d4d54e037bde3b37923db68f6d44aab4077f4b5450615 |

冻结 base 为前轮组 B engine `54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954`、server `e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c`；不是把本地 root 或历史生产当本轮候选。

独立只读字节比较通过：

- engine 仅新增 module import、`recruitmentSubmissionIdentity → offerEvent` 段及 `parseRecruitmentMessages → calendarTitleNamesPerson` 段；所有范围外字节等同 frozen base，原 reviewerReaction 集合冲突逻辑未退化。
- server 仅新增 module import、`getChatMessages → findChatByName` 段及四处精确 `parsed.reviewBindingVerified===true &&` 读回/日历推进 guard；其余字节等同 frozen base。四行 guard 逐条数量核对，没有用整 handler 剥离掩盖其他变化。
- module 是新的窄纯函数；不读磁盘/state、不调用网络、不持久化正文。未整包搬运历史 root。

## 源码与实际 adapter 核验

1. 正文按真实 raw JSON 投影，同行节点直接拼接、逐行保留、标题不省略、重复行不去重；raw 字节和完整投影先算指纹，再限制显示 8000。资源/槽位完整计数先于资源显示截断；缺 V1、完整字段、指纹、严格布尔值及 `text===reviewText` 不放行。
2. post 仅受支持单语言/直接文字 AST 和明确 bold 样式；图片/链接/at/未知节点/删除线、parseError、未知字段或多语言体都 pending。Media 占位符不再被忽略。明确末行结果与颜值/表现力唯一字段才构成文本线索；名单以外第二人、不含结果词的额外内容、没有通过/问句/条件句不走全文“通过”搜索。
3. 完整求职者槽位覆盖独立于已成功提取姓名：非 Han、空槽、缺括号/语法、隐藏格式字符及混合源整体 pending。`\p{Cf}` 检测归一化仅增加拒绝证据，不把未知槽位修复后接受；原始 span 与 Han 线索可保留，不扩大人员授权。
4. 同 ID 副本比较包含所有资格字段，缺 V1/完整长度漂移/撤回别名不会被先到的合法副本遮蔽。后续同 reviewer 的全文或 opaque、空正文、撤回、编辑均使旧线索 pending，不按第一条或最新自动赢。
5. 独立执行**实际 server 的 getChatMessages 源码切片**于 deny-network VM：使用合成 raw API 响应，经真实 projector，再直接送 pure engine；不手填 ready flags，也不在 adapter 输出后补反应或变更字段。getMessageReactions stub 只向实际请求到的精确消息 ID 返回虚构 OK，指定 reviewer ID 由 engine 检验；tombstone 不请求反应但仍进入完整观察。
6. 实际 getter 验证五种 raw API 撤回别名 `deleted/is_deleted/isDeleted/recalled/is_recalled` 均保留并映射给 engine；后续 tombstone 导致 pending，原初审 OK 不伪造完成。招聘完整正文不进共享 cache；预置旧绿色 cache 没有被读取或覆盖。非招聘的旧 cache/filter 路径由原始 projection tests 单独回归。
7. 每位候选的 `evaluationEvidence.passed === null`、`status === pending`、`reviewBindingStatus === pending`，全局 `reviewBindingVerified === false`、`reviewSourceStatus === pending` 及 groupEvaluatedCount/groupPassedCount 为 null均显式断言，未用 undefined 或“非 true”替代严格门禁。Offer 仅线索，不洗成面试通过；真实独立入职事实是另一来源，不把它当面试绑定已核验。

## 审查发现与复验

实施中曾发现并提出三类实际缺口，均已由实现者修复，本代理没有修改候选：

- 同 ID 资格 key 漏 V1/fullProjectionLength/isDeleted：四项新反例会使先到合法副本保持 text_ready。现双输入顺序全部 pending。
- Cf 检测仅处理常见零宽：U+2066 隔离和 U+202D 方向控制隐藏第二求职者槽位。现完整 Cf detection-only 拒绝扫描及原始语法不修复的反例通过。
- adapter 先过滤撤回源且不传旗标：纯 engine 撤回测试不能证明实际投影完整。现招聘保留 tombstone，新增 raw API → 实际 getter → engine 与精确 reaction target 验证。

最终本轮约定范围未发现未处理 P1/P2。此声明不扩大至下面尚未解决的业务/生产边界。

## 测试结果与旧回归适配检查

- 独立新攻击 117/117，0 fail、0 skip，显式 pin module/engine/server SHA。
- 同时重新运行 native projection/实际 getter 83/83、root integration/scope 35/35。
- OA 三组 179/179：FALLBACK-INDEPENDENT-REVIEW 63、oa-fallback 66、oa-identity-readback 50。
- 六文件组合：**414/414，0 fail、0 skip**；终测前后源码 SHA 和 SOURCE-PINS 一致；三源码 `node --check` 及独立 scope_pass 通过。Windows 本地 Node 验证，不冒充 Linux 构建或线上读回。

旧 OA 文件与前轮 frozen B 逐文件完整 diff 核验：FALLBACK 仅引入 SOURCE-PINS 替换新候选 hash；oa-fallback 保留旧生产重建字节断言，改核 inherited base，并增加 candidate OA slice 与 base 完全一致；oa-identity 只适配新 module import 和允许面评源码区间到 offerEvent。**没有删 case、skip、削弱业务 assert 或改虚构来源**。其余测试正文逐字未变。179 是旧 OA 保持性检查，不是新增 V1/组 C/D/E 的完成证明；旧 B 面试通过正例已由本轮“文本线索但业务 pending”正例替代，未声称旧 260 项全部原样通过。

终测命令的目标为本候选三个明确 SHA；独立文件可用 `WIS_REVIEWTEXT_MODULE/ENGINE/SERVER` 路径与对应 `_SHA` 指定冻结对象。默认仅指 candidate-2042，绝不导入 server 默认启动。

## 剩余 NO-GO 边界

- 组 C：正式日历唯一事件、面评 reviewer/本人身份与事件的精确绑定、完整 fresh 读取上界/跨周期来源、正式 17:00 门禁和可核验业务计数。本轮只建立文本资格，不能把它计入最终面试/通过统计或恢复发送。
- 组 D：真实 OA 登录与用户绑定、锁内 fresh/CAS、cache/persistence、durable 双签严格读回等；旧 OA 合成回归不等于真人签署与持久验收。
- 组 E 与系统边界：私聊路径及其他入口、生产权限/日历刷新、历史数据恢复、正式 source/人员/消息 ledger、网关/唯一写者/备份回滚、真实 OA 页面及发布读回。本次没有接触真实 OAuth 或开启任何开关。
- 4.9.2—4.9.4 与四房五节点真人闭环不在本源码审查完成范围；测试发送、text_ready、接口成功或候选/Git 不能当作业务闭环。

可进入原总方案内的下一受控纯源码候选准备；不得因此宣称全功能完成或生产上线。
