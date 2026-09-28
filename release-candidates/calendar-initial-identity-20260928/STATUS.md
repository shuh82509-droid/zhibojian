# 4.9.1 初审反应与送审身份候选（2026-09-28 19:42轮）

本候选为同任务已批准范围内源码修复，不是生产上线、正式授权或真人五环节验收。没有切换生产、改开关、消费一次性 refresh、发送/补发消息或代办本人业务。完整发布仍 NO-GO。

19:48:46—47 当前 Gateway 实际路由及三服务首末 CAS 稳定；Calendar 唯一 live-routes-r6 owner仍 3e42689cb3536ab8e541eb5e12d3a02579f65cb76bd00e0fb5aabc5e85ab94d4 / c9f28e58，server 4d194296、engine 5880b010。完整证据在同任务 hub-trusted-read-ops-20260928/ROUND-1942。

保留先前所有冻结候选。本候选从上一轮精确 OA 窄修 server e345f9f1 / engine d90bbca1 复制；server未改，engine只修改 reviewerReaction→interviewEvaluation（含新增pure身份索引）与 parseRecruitmentMessages→calendarTitleNamesPerson 两范围。其余原混合 CRLF/LF 字节严格不变，独立守卫验证。

指定审查人 OK/No用集合而非第一条；冲突与已识别送审来源的多ID/多人共ID/同ID全文或精确时间、身份、更新、资源及目标反应差异保留待核；完全一致重复页去重。同ID变成非送审或空正文也参与冲突核验。无ID/非法ID/非法时间/可见截断/原文不一致的已识别送审不被另一合法同名记录洗掉。歧义的submissionEvidence.sourceId为空，initialReview=null，保留真实alternatives和不同非空ID计数，不伪造count0。

cohort的面评/offer仅唯一来源且初审OK才推进；初审No或无表情不被后续覆盖，阶段和funnel同门禁，影响范围不阻断另一合法姓名。上轮OA helper字节不变，blank source拒绝旧双签重新算通过。独立入职来源的hired/actualStartDate/timeline仍由原merge保留，不能当招聘链已核。

本地组合260/260，0fail/skip/cancel：OA回归179、根代理新增25、独立新增56。旧测试复制版的scope增加两范围；旧parser对照仍使用original重现旧pass1，新parser必须blank source/pending/awaiting，原冻结179文件未改。Linux独立回归另见QA-RESULT及ROOT-LINUX证据，不能拿本地回归替代它。

未修全量严格面评/未知第二人/否定/后续相关不可核内容、full raw text和模板slot完整覆盖、多人日历/标题截断/时间、提醒身份与完整指纹、锁内fresh/CAS/durable读回、跨周期链路。findSubmissionNames仍为原有限Han模板识别，非cohort旧显示路径保留；因此本窄修不声称所有输入身份或面評安全。私聊端点/初始化未改。4.9.2正式Opening ON路径风险尚未由本源码改变；四教练当前授权、4.9.4来源/个人休息规则及真实OA/旧链接页面仍未核。

任何发布仍需fresh正式来源与收件身份、当前CAS、6个停用同卷RW隔离、新鲜停机完整备份恢复、保留最新业务数据回滚及真实登录页验收。正式W04真人完成节点仍0；测试、内部sent、Git及候选不冒充真人办理。
