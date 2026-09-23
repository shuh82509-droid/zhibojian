/* Loaded by the server only for explicitly configured, read-only recovery. */
(() => {
  if (typeof D === 'undefined' || typeof applyAnchorSnapshot !== 'function') return;
  const originalApply = applyAnchorSnapshot;
  const originalStatus = renderLifecycleStatus;
  const originalMetrics = renderMetrics;
  const originalRender = renderAll;
  const clearUnverifiedBaseline = () => {
    D.rooms = Object.fromEntries(ROOM_ORDER.map(room => [room, []]));
    D.reviews = {}; D.schedules = {}; D.latest = {}; D.departed = [];
    D.latestDataDate = ''; D.scoreDate = ''; D.newcomer = {name:'待核验',stage:'源表未提供培养日程'};
    D.metrics = {active:'待核验',regular:'待核验',newcomer:'待核验',senior:'待核验',leaving:'待核验'};
    D.rotationForecast = false; D.rotationNote = '轮转与资源位待核验';
  };
  clearUnverifiedBaseline();
  // A bundled-photo request may have started before this recovery script loaded.
  // It must not overwrite fields from the newly verified source snapshot.
  applyProfiles = () => {};
  loadBundledProfiles = async () => {};
  applyAnchorSnapshot = snapshot => {
    if (snapshot?.recoverySource?.mode !== 'verified_backup') return originalApply(snapshot);
    clearUnverifiedBaseline();
    PROFILE_BY_NAME.clear();
    activeSnapshot = snapshot;
    for (const profile of snapshot.profiles) {
      const name = canonicalAnchorName(profile.name);
      PROFILE_BY_NAME.set(name, {...profile,name});
      const room = ROOM_ORDER.includes(profile.room) ? profile.room : '待核验';
      if (!ROOM_ORDER.includes(room)) { ROOM_ORDER.push(room); ROOM_COLORS[room] = '#82938b'; D.rooms[room] = []; }
      D.rooms[room].push({name,level:profile.level || '职务待核验',slot:'资源位待核验',prevRoom:room,rank:null,prevRank:null,score:null,comment:'近 5 日评价待可验证来源回传。'});
    }
    D.updatedAt = snapshot.generatedAt;
    D.metrics.active = snapshot.profiles.length;
    D.scoreStatus = '原表只读备份；评分与资源位未恢复';
    renderAll();
  };
  renderMetrics = () => {
    if (!activeSnapshot?.recoverySource) return originalMetrics();
    metrics.innerHTML = `<div class="metric active"><span>源表在职主播</span><b>${D.metrics.active}</b><em>读取备份，不代表实时人数</em></div><div class="metric"><span>高级主播</span><b>待核验</b><em>未用旧编制补齐</em></div><div class="metric"><span>新人主播</span><b>待核验</b><em>培养与招聘记录尚待恢复</em></div><div class="metric"><span>待离职</span><b>待核验</b><em>缺少已确认最后工作日</em></div>`;
  };
  renderAll = () => {
    originalRender();
    if (activeSnapshot?.recoverySource) banner.textContent = `原主播表只读备份 · 读取于 ${formatChinaTime(activeSnapshot.recoverySource.fetchedAt)}；所属直播间、化妆师和入职日期来自原表。资源位、近期评价和手工成长记录尚待恢复。经营趋势独立读取，不由备份补造。`;
  };
  renderLifecycleStatus = status => {
    originalStatus(status);
    if (!activeSnapshot?.recoverySource) return;
    stateDot.className = 'state-dot stale';
    refreshTitle.textContent = '原主播表已恢复为只读备份';
    refreshMeta.textContent = `读取于 ${formatChinaTime(activeSnapshot.recoverySource.fetchedAt)} · 非实时同步 · 自动更新与写入暂停`;
    refreshButton.disabled = true; refreshButton.textContent = '恢复期只读';
  };
  renderAll();
  void loadAnchorTrends();
  void loadLifecycle();
  setInterval(loadLifecycle, 5 * 60 * 1000);
})();
