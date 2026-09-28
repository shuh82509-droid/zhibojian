# 根审查与组合方式

主代理先读主方案 rev457 完整最新节和下一组 A 完整 PLAN，再读本轮 ROUND-2042 现场安全投影。Calendar 原4d194296/5880b010首末 CAS 未漂移；新源继承精确冻结 server e345f9f1/engine54271b17，并仅增加组 A import、完整消息资格/严格面评段和 parseRecruitmentMessages 两范围。server仅import、getChatMessages范围和四个最终绑定读回 guard。机械重构保留范围外原始混合换行，独立 scope proof 和自身实际入口 VM 证明，而不是复制混杂根仓库整包。

独立攻击先复现4个同ID完整资格缺失/漂移漏洞、2个非常见Cf隐藏第二求职者槽位，以及真正入口先过滤撤回导致engine看不到后续opaque的缺口。补齐完整资格指纹，检测视图全部Cf只作拒绝；招聘入口保留raw tombstone五别名，投影三明确撤回字段，反应仅读active IDs。实际raw API→server→engine合成联测确认删除记录会阻断旧线索；没有向真实API造消息或代替人办理。

OA179新copies仅适配源码scope/hash：生产4d/588固定；原OA重构结果改核已冻server.base(e345)，再断言候选addStructuredAssessments逐字未变；engine范围新增A import及面评段。未改OA业务断言、未删任何case。独立审查逐文件比对了这些适配。老冻结179及原组 B 81文件都原样留存，本轮不是把老260无条件追认为新功能通过。

组 B 回归新copies调用真正projectRecruitmentMessageContent建立合成V1来源，仍检查反应冲突/顺序、不同ID/同ID漂移、共享多人、非法源/时间、未知源、独立另一姓名与实际入职事实。新契约故意将旧cache/不完整源及面评/offer自动绿态降为pending；最终group计数为null而非测得0，线索计数分列。详细适配见IDENTITY-ADAPTATION.md，不篡改旧审查结论。

根35新增检查完整字段漂移、合法独立初审、Cf混合槽位、真实源ID数、只读输入、撤回和独立实际入职事实。语法合格不会输出最终passed或阶段绿态，正式事件/精确评审绑定仍未完成。完整C/D/E、私聊独立端点/初始化和跨周期不由本轮修复冒充安全完成。

全程仅新候选/合成QA/Git归档/原方案记录；未改生产、发送或重试不明消息、消费OAuth、解密日历grant、写表或代办业务。Linux runner和Git精确交付结果另列QA-RESULT及主报告，不等于正式发布。
