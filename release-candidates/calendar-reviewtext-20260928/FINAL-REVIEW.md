# 组 A + B81 适配最终独立复核

结论：冻结 candidate-2042 的本轮纯源码安全范围通过；最终八文件 **495/495，0 fail/cancelled/skipped/todo**。本代理只读复核并新增本记录及固定 SHA 清单，未修改 source/test、生产、Git 或飞书。

## 冻结与执行

明确选中 `calendar-reviewtext-exact-20260928/candidate-2042`，测试前后 source SHA 一致：module `edb7ceab…`、engine `fa30f789…`、server `2590ce6d…`。完整值及八文件 hash 见 [FINAL-SHA256SUMS.txt](./FINAL-SHA256SUMS.txt)；SOURCE-PINS 已与三源码一致。

复跑显式设置 WIS_REVIEWTEXT_MODULE/ENGINE/SERVER 为该候选实际绝对路径及对应完整 `_SHA`；WIS_IDENTITY_REVIEW_ENGINE/SHA 同步选中该 engine。没有使用复制 A117 的 Windows 默认路径替代实际 server 目标。按候选目录的八个明确文件运行 `node --test --test-reporter=tap`，本地 Windows Node 结果：495 tests、495 pass，duration 315.3183 ms。

| 测试文件/范围 | 通过 |
| --- | --- |
| REVIEWTEXT-INDEPENDENT.test.mjs（原独立 A117 的逐字复制） | 117 |
| projection-review.test.mjs（实际 server getter/原文投影） | 83 |
| reviewtext-root.test.mjs | 35 |
| initial-identity-root.test.mjs（B 新适配） | 25 |
| IDENTITY-INDEPENDENT.test.mjs（B 新适配） | 56 |
| FALLBACK-INDEPENDENT-REVIEW.test.mjs / oa-fallback.test.mjs / oa-identity-readback.test.mjs | 63 / 66 / 50 |

独立 scope 脚本另行通过：engine 仅 module import、初审 identity/面评段与招聘 parser；server 仅 projector import、实际 getter与四处精确绑定 guard，其余字节等同 frozen base。无 source 漂移，无删 skip/only 逃逸。

## B81 适配判定

完整读两份新测试和 IDENTITY-ADAPTATION.md，逐项对照旧 B 25+56 反例。旧测试文件 SHA 仍为 `acbdbd9f…` / `5076d4fc…`；没有改写旧文件。新适配是独立副本，不是把旧 81/260 结果充作 V1 正向证明。

- 真实调用选中 sibling module 的 projector，生成 V1 全字段与原始指纹；有效正文变化会重新投影，不能靠过期指纹使危险用例虚假地全部 pending。
- 原 OK/No 正向路径、相同反应/别名、重复相同页仍核对唯一 ID、真实初审结果和正确数字计数；并非全负例套件。
- 双 OK/No、同名多 ID、共享 ID、内容/时间/反应/人员/群/更新时间/媒体/截断变化、缺 ID/日期、另一同名有效来源不能洗掉歧义、影响范围隔离、旧 OA 双签无法恢复、输入不变及独立入职事实全部保留；主要冲突组合仍检查双顺序。
- 旧“面评或 offer 自动通过”改为初审保持、文本线索与业务明确 null，符合组 A 的未绑定边界。旧不完整 plain-text 面评仍保留为负子例，不被新完整 post 正例替换掉。
- 撤回同名旧来源保留两个观察 ID/两个 alternatives；媒体重复仍一个 ID/一个 alternative但整体 pending。原 zero outcome 改 null，同时核对 zero qualified clues/blank bound source等，不把待核验包装成实际 0 人。
- B 的兼容字段 `not-pending`、非布尔及 optional-chain 断言没有被单独当作业务通过依据：其正向同时核唯一 source、OK/No、初审阶段及数值计数；负向同时核空绑定源、null 初审、pending身份/阶段。最终 A117 还显式核 `evaluationEvidence.passed===null`、pending状态、`reviewBindingVerified===false` 及两项业务 group count 为 null。

本轮适配未发现危险断言放宽或遗漏原反例；旧 OA179 的 SHA/scope 适配判定沿用本目录 REVIEW.md，测试正文与业务 assert 未削弱。实际 getter使用虚构 API/反应 stub，但投影与 engine 均为冻结真实源码，不在 getter输出后手填 ready或补反应；tombstone不读反应却保留源，招聘正文不走共享缓存。

## 仍未完成

这里只证明 A/B 窄源码和合成测试保持性。C 正式事件/reviewer/本人完整绑定、D fresh/CAS/durable双签与真实OA、E及其他入口、生产授权/通知/备份回滚/唯一写者/发布读回、四房五节点真人业务仍未验收；招聘提醒和生产发布仍 NO-GO。Windows本地495通过不等于Linux镜像、Git、上线或真实业务通过。
