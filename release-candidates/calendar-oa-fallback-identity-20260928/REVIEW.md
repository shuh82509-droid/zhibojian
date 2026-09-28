# 独立终审：OA 待核验 fallback 与同名送审读回窄修

审查收口：2026-09-28 19:01 上海时间。审查者：同任务子代理 sender_final_gate_review。

## 结论与范围

本候选的两个窄源码目标通过独立合成核验：不再从私聊评分自动覆盖 OA 双签；无有效 OA/唯一送审来源时清除旧考核结论，旧签署摘要与新签署入口共用唯一来源谓词。未发现本次最终冻结范围内的新 P1/P2。审查中发现的空数组与稀疏数组两个同根输入校验 P2 已修复并复测。

**这里只是源码候选验收，不是生产上线、真实 OA 页面验收或 4.9.1 全部完成。完整生产发布仍为 NO-GO。** 原 15 个 P1 审查的其余语法、日历、提醒、fresh/CAS/持久写回等风险未由本补丁全面解决，不将其中局部修复说成全部清零。

## 冻结对象

- server.original.js SHA256：`4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef`
- lifecycle-engine.original.mjs SHA256：`5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0`
- server.js SHA256：`e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c`
- lifecycle-engine.mjs SHA256：`d90bbca1858b1131dfdaa8a7d6a81c7a17f305bd51e6a912105cad755b544133`
- 本审查额外测试 FALLBACK-INDEPENDENT-REVIEW.test.mjs SHA256：`f4dd8a83970732c9aae3e62dd28433abaa0efb0fbb49a73f5ded51362d95b734`

BASELINE.json 是主代理保存的 18:44 基线采样，不是本审查的新鲜生产核验。本代理未接触生产；发布前仍须重新现场核对目标及 CAS。

## 精确静态审查

1. server.js:1704 的 addStructuredAssessments 中已移除 privateAssessmentSource.load / applyPrivateAssessments / private-ready early return。切片 VM 给私聊 load/apply 设置禁止调用计数器；所有评估均为 0 次私聊调用、0 次 OAuth stub 调用。
2. server.js:1706–1714 在读取 journal 前建立 pending 副本：assessmentPassed=null、assessmentEvidence=[]、assessmentEvidenceStatus 待核验、assessmentDisplayStatus 清空；不可用 OA 读回不再保留 dirty true/false、旧证据或考核通过文案。catch 使用 pending，输入对象未被修改。
3. server.js:1718–1735 用源上下文核 OA 摘要；缺签、冲突或身份歧义只保留待核验。合法唯一双签 pass/pass 与 fail/fail 路径保留；合法当前签署证据替代旧证据。stage、真实入职事实、日期、media、timeline、employmentEvidence/assessmentReported 等业务来源字段保持不变；初审通过、面试通过、面评通过、已入职标签保留。
4. lifecycle-engine.mjs:780–823 的 structuredAssessmentSummary 调用 assessmentSubmissionFor，拒绝旧签署在新送审歧义中误恢复通过。实际 parser 以姓名去重后 candidates.length=1 并不能证明唯一；独立重现 submissionMessageCounts=2 时旧引擎 passedCount=1，新引擎为 0 且 bySubmission.passed=null。这里的 0 表示没有已核验双签结果，不是证明真实业务人数为零。
5. lifecycle-engine.mjs:849–873 对 authoritative own numeric count===1、完整 coverage、唯一姓名/来源 ID、真实合法日历日期、所有数组非空且每项合法唯一、单日期归属 fail closed；不接受缺少第五参的旧四参摘要作身份验证。counts 的字符串、NaN、继承属性；日期数组的重复、非法内容、空数组、sparse hole 均保持 pending。
6. server.js:1750、1853 两个真实 recruitment refresh/snapshot 调用传 parsed counts/dailyNames 与 truncation coverage；server.js:2429 新签署入口使用同一 predicate；2442 写后摘要传第五参 snapshot。额外提取 actual submitStructuredAssessment 到 VM：合成唯一双签 pass/fail 读回保留；count2、coverage 截断、缺少 count map 在 contact/lock/合成 write 之前拒绝。该 VM 写仅内存 stub，不证明真实锁或持久提交安全。
7. 精确字节边界测试通过：engine 两个目标函数之外不变；server 除 addStructuredAssessments 与两处 refresh 传参、一处写后摘要传参之外不变。node --check 对两源文件成功；没有执行默认 server。

## 本轮独立新增发现与修复

- 临时 engine 010727 版本在目标日期合法时，允许另一个日期的 `[]` 数组通过；纯合成旧双签摘要 actual passedCount=1。最终 d90bbca1 增加 `!names.length`，同输入 pending。
- 临时版本使用 Array.some 跳过 sparse hole，`Object.assign(new Array(2), {0: name})` 可通过合法成员校验并误计 1。最终改 `[...names].some`，hole 变成 undefined 后拒绝。真实 JSON/当前 parser 不生成 sparse hole，未将该输入边界冒充现网事件。
- 原待修 server 曾把“面评通过”业务标签作为考核文本清空；最终窄正则不再包含面评/评估。独立正例已验证其保留。

## 可复现离线测试

三个测试文件均只导入纯 engine，或读取 server 文本后提取目标函数进 VM；所有名字、OpenID、送审 ID、journal、联系人、写入和网络路径均为合成数据。未读取真实 journal/token/grant、未请求 API、未签署真实本人结论、未发送通知、未修改 Git 或生产。

- 独立 FALLBACK-INDEPENDENT-REVIEW.test.mjs：63/63，0 fail、0 skip。
- 实施者 oa-fallback.test.mjs：66/66，0 fail、0 skip，本代理重跑。
- 主代理 oa-identity-readback.test.mjs：50/50，0 fail、0 skip，本代理重跑。
- 最终本地组合：179/179，0 fail、0 skip；包含最终 SHA pin。

```powershell
& H:\node.exe --test --test-reporter=tap .\FALLBACK-INDEPENDENT-REVIEW.test.mjs .\oa-fallback.test.mjs .\oa-identity-readback.test.mjs
```

本地合成测试不等于镜像/服务器运行验证；Linux 重跑、部署身份与真实浏览器/业务验收由主代理另行记录。本审查未构建镜像，也未开服务。

## 仍然 NO-GO 的明确边界

- 原 current audit 的面评全文语法、未知第二人归属、否定/撤回/截断/媒体、初审冲突、群面评同名统计未在本窄修中改动。
- 多人面试日历、标题 80 字截断、初审与反应完整性、日历先于送审、完整源指纹和发送前校验未由本补丁修完。17:00 提醒不可据此次测试放行。
- submitStructuredAssessment 仍在锁外获取可能缓存的 source；锁内没有 fresh source/CAS 重核，仍使用原 writeJsonAtomic，没有新增 durable 保存、结果读回或安全恢复协议。写后第五参一致性仅修身份谓词，不修 TOCTOU/持久化。
- 私聊模块初始化及 `/api/lifecycle/private-assessments` 端点保留（server.js:2450），不是“全系统不再可能读取私聊”的声明。只证明 addStructuredAssessments 不自动调用它。
- 上期送审跨周期 carryover、正式来源/人员授权、真实 OA 登录页面、旧通知链接、唯一写者、备份/回滚、生产目标 CAS、发布与 Git 回传均不在本纯源码审查完成范围。
- 不代替负责人签署、不把合成双签/测试成功当真人业务回执；历史 journal 和实际 stage/入职事实不删除不改写。

因此允许进入后续受控候选准备的只是本次冻结的两个窄源码改动；不得以此开启真实提醒、宣称 4.9.1—4.9.4 或五环节真实闭环已经完成。
