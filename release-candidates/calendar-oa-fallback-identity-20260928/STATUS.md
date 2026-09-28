# 4.9.1 考核回退与唯一来源窄候选：仅源码，生产 NO-GO

本目录是同一任务的新独立 exact-current 候选。旧 candidate-3e42689c-0b0a793b、所有既有候选和 audit491 投影保持不动。源取自 fresh 精确运行别名 `live-routes-r6` 的唯一 owner，而不是历史 container pin。完整 ID/image/startedAt/原始校验值及现场关闭开关在 BASELINE.json。

冻结 server：`e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c`；冻结 engine：`d90bbca1858b1131dfdaa8a7d6a81c7a17f305bd51e6a912105cad755b544133`。

## 精确改动

子代理只改 server 的 `addStructuredAssessments` 和明确批准的三处 sourceIdentity wire。主代理独占改 engine 的 `structuredAssessmentSummary` 与 `assessmentSubmissionFor`；双方没有编辑同一源文件。

server 先复制候选，仅把考核视图保守置为：assessmentPassed=null、assessmentEvidence=[]、assessmentEvidenceStatus=待核验、assessmentDisplayStatus=''。仅考核/考评/双人确认状态段与裸通过/未通过标签归 pending；面试、面评、初审通过及已入职文案不当作 OA 考核结论清掉。失读、缺失、坏 journal、空/不匹配记录、不完整源及身份待核时返回已清理视图，不能把任意预置 true/false/旧证据或缓存 display 当现行 OA 结论。真实 stage/date/startDate/入职事实/timeline/submission/media 和 assessmentReported 原样保留；历史 timeline 中报告过的通过不被篡改成新业务事实。

匹配当前唯一送审来源且两位负责人结论一致时，仍使用 actual 原版双签 pass/fail 文案与签字证据，不改变阶段或入职事实。部分签字/冲突用当前结构化证据替换旧缓存，保持待确认或冲突，并非通过。

两处 refresh/snapshot 调用传当前 parse 的 submissionMessageCounts、dailyNames 和截断 coverage；签署后 summary 回读第五参传现有 snapshot，不改签署锁/写入逻辑。server 其余完整字节保持原样，见 SOURCE-CHANGE.patch 和第一项 byte-boundary 测试。SOURCE-CHANGE.patch 仅包含 server 差异，不是包含 engine 的完整候选 patch；engine 两函数的范围与逐字节边界以 root 实际源码、测试及 ROOT-REVIEW 为准。

engine 复用实际 assessmentSubmissionFor 的唯一身份规则；缺少 context 不推定 counts=1。仅自有 numeric1 计数、真实有效日期键、非空/无稀疏洞/合法唯一姓名数组、单日单候选单消息、完整覆盖可放行。实际解析时同名被折叠为一候选但原计数仍为多送审的情况不会复用旧签字通过。engine 其余字节由 root 测试核验不变。

## 实际回归

最终 root 独立 Linux Node v22.23.2 在七个源/fixture SHA 严格一致后完成 179/179、0 fail、0 skipped、0 cancelled。实现 66 项 + root 唯一身份 50 项 + 独立 reviewer 63 项（含最后追加的 5 项 actual submit 函数 VM），最终日志 ROOT-LINUX-179-TAP.txt SHA `ac5f8dd6c858a7b1be417b14dcec05f889e6afa2dd400f1b10d15aa2a81936fd`，头部 reviewer fixture SHA 为冻结最终 `f4dd8a83...`。root 本地组合也为 179/179。完整命令与小 metadata 见 run-isolated-qa.sh、QA-RESULT.json。

实现代理先前的 174/174 轮 reviewer fixture 是 `41a36ee0...`，QA-LINUX-TAP.txt 原样保留。之后 reviewer 加 source SHA pin，root 一次严格读回因 fixture 不一致 exit66、未开始任何测试，不称通过；同步后 root 174/174 的 `ba46e0a7...` 轮在 ROOT-LINUX-FINAL-TAP.txt 原样保留。reviewer 最后追加 5 项 actual submit VM 后明确冻结 `f4dd8a83...`，root 再次严格核七文件并完成上述最终 179；源 server/engine 未变。没有用旧日志冒充新 fixture 的 Linux 证明。

初轮 170 项有 1 项真实失败（额外空日期姓名数组未封锁）；QA-FIRST-FAILURE.txt 保留来源 SHA、失败断言和计数。root 按真实 parse 不产生空日期数组的契约补空/稀疏洞 predicate，冻结新 engine d90bbca 后重新全部回归，不覆盖失败证据或放宽独立测试。

测试只读本目录源码、pure engine exports 和 VM 抽取函数。候选/人名/签字/日期/来源/journal 全是合成，readFile/getChatMessages/readCalendar/writeJsonAtomic 等均为无真实数据的 mock；不导入默认 server，不监听端口、不执行计时器，不读私聊、OAuth、凭据、实际 journal 或飞书 API。

## 独立 Linux recipe

远端：`/home/brand-marketing/fandow-apps/fd-026222/runtime/calendar-oa-fallback-source-20260928.bGbkRD`。现有不可变正式 Calendar 镜像 c9f28e58 仅作 Node runner，未构建或启动候选服务。recipe 强制 entrypoint=node、network none、read-only、non-root10001、drop ALL、no-new-privileges；仅独立 QA 目录只读 bind 与空 /tmp tmpfs，没有正式卷/别名/配置/凭据/Docker socket。QA env 明确 reminders=false、scheduler=0。

18:57:41 上海时间 postQA 再按实际运行别名解析，owner仍唯一，正式仍原 3e42689c/c9f28e58/server4d194296/engine5880b010，healthy；reminders=false、leader=false、scheduler=0。仅这份快照，不替代发布时新鲜核验。

## 未完成与关闭边界

未建镜像、未部署、未推 Git、未请求飞书/用户 OAuth、未读写业务数据或正式容器。server 默认入口和独立 private-assessments 路由/初始化仍原样；本候选只阻断当前考核函数自动私聊读取，不能声称所有其他路径全无私聊访问。实际生产与 QA 关闭开关没有启用。

其他已审计 P1、原源权限/收件身份与消息账本、日历授权、提醒首激活/有效时间、安全发送、停机备份/旧 RW 隔离/最新数据回滚、真实 OA 页面与真人业务验收仍未完成。179 个合成测试不代表 4.9.1 或四项需求完整实现，不代表生产上线，也不代表真人工作流闭环；生产 NO-GO，未经完整门禁不能启用。
