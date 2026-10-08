(function (global) {
  'use strict';

  var amapMapHandle = null;
  var expandedMapHandle = null;
  var selectedDriverId = null;
  var focusTaskId = null;
  var routeRebuildToken = 0;
  var balanceRerunTimer = null;
  var amapAutoConnectStarted = false;
  var locateAllBusy = false;
  var AI_CHAT_LS = 'dispatch.aichat.v1';
  var aiChat = loadAiChat();

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function icon(name, cls) {
    return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>';
  }

  function refreshIcons(root) {
    if (global.lucide && global.lucide.createIcons) {
      global.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
    }
  }

  function toast(message, type) {
    var root = $('#toast-root');
    if (!root) return;
    var icons = { success: 'check-circle', warn: 'alert-triangle', error: 'x-circle', info: 'info' };
    var t = el(
      '<div class="toast toast-' + (type || 'info') + '" role="status">' +
        icon(icons[type] || 'info', 'toast-ico') +
        '<span>' + esc(message) + '</span>' +
      '</div>'
    );
    root.appendChild(t);
    refreshIcons(t);
    setTimeout(function () {
      t.classList.add('is-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 240);
    }, 2800);
  }

  function openModal(title, bodyHtml, opts) {
    var root = $('#modal-root');
    if (!root) return;
    root.innerHTML =
      '<div class="modal-backdrop">' +
        '<div class="modal' + (opts && opts.className ? ' ' + esc(opts.className) : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
          '<div class="modal-head"><h3>' + esc(title) + '</h3>' +
            '<button type="button" class="icon-btn modal-close" data-action="close-modal" aria-label="关闭">' + icon('x') + '</button>' +
          '</div>' +
          '<div class="modal-body">' + bodyHtml + '</div>' +
          (opts && opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
        '</div>' +
      '</div>';
    root.querySelector('.modal-backdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
    root.querySelector('.modal-close').addEventListener('click', closeModal);
    var cancel = root.querySelector('[data-action="modal-cancel"]');
    if (cancel) cancel.addEventListener('click', closeModal);
    refreshIcons(root);
    return root;
  }

  function closeModal() {
    if (expandedMapHandle) {
      try { expandedMapHandle.destroy(); } catch (e) { /* ignore */ }
      expandedMapHandle = null;
    }
    var root = $('#modal-root');
    if (root) root.innerHTML = '';
  }

  function destroyAmapMap() {
    if (amapMapHandle) {
      try { amapMapHandle.destroy(); } catch (e) { /* ignore */ }
      amapMapHandle = null;
    }
  }

  function connectSavedAmapKey() {
    if (amapAutoConnectStarted) return;
    amapAutoConnectStarted = true;
    var settings = Store.getState().settings || {};
    var key = String(settings.amapKey || '').trim();
    if (!key) return;

    // 读取本机保存的凭据；失败时 Geo 保持离线模式，不阻塞页面使用。
    Geo.setKey(key, String(settings.amapSecurityCode || '').trim())
      .then(function () {
        renderApp();
      })
      .catch(function () {
        renderApp();
      });
  }

  function confirmDialog(message, onOk, okLabel) {
    openModal('确认操作',
      '<p class="confirm-text">' + esc(message) + '</p>',
      {
        footer:
          '<button type="button" class="btn btn-ghost" data-action="modal-cancel">取消</button>' +
          '<button type="button" class="btn btn-danger" data-action="modal-ok">' + esc(okLabel || '确认') + '</button>'
      }
    );
    var ok = $('#modal-root [data-action="modal-ok"]');
    if (ok) ok.addEventListener('click', function () { closeModal(); if (onOk) onOk(); });
  }

  function currentRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    var known = ['dispatcher', 'driver', 'vehicles', 'settings'];
    return known.indexOf(h) >= 0 ? h : 'dispatcher';
  }

  function todayTitle() {
    return new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
  }

  function km(m) {
    if (m == null) return '--';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
  }

  function fmtDuration(min) {
    var h = Math.floor(min / 60);
    var m = Math.round(min % 60);
    return h ? h + ' 小时' + (m ? ' ' + m + ' 分' : '') : m + ' 分钟';
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function pageHeader(title, sub, actionsHtml) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      (actionsHtml ? '<div class="page-actions">' + actionsHtml + '</div>' : '') + '</div>';
  }

  function topbar() {
    var route = currentRoute();
    var mode = Geo.status();
    var items = [
      ['dispatcher', 'clipboard-list', '调度台'],
      ['driver', 'navigation', '司机看板'],
      ['vehicles', 'truck', '车辆维护'],
      ['settings', 'settings-2', '设置']
    ];
    var links = items.map(function (it) {
      return '<a class="topnav-link' + (route === it[0] ? ' is-active' : '') + '" href="#/' + it[0] + '">' +
        icon(it[1], 'nav-ico') + '<span>' + it[2] + '</span></a>';
    }).join('');
    var modeLabel = mode.mode === 'amap' ? '高德服务' : (mode.loading ? '连接中' : '离线估算');
    var modeClass = mode.mode === 'amap' ? 'is-amap' : (mode.loading ? 'is-loading' : 'is-demo');
    return '<header class="topbar"><div class="topbar-inner">' +
      '<a class="brand" href="#/dispatcher">' + icon('truck', 'brand-ico') + '<span class="brand-name">派车调度台</span></a>' +
      '<nav class="topnav" aria-label="主导航">' + links + '</nav>' +
      '<div class="topbar-right"><span class="mode-badge ' + modeClass + '"><i class="mode-dot"></i>' + esc(modeLabel) + '</span></div>' +
    '</div></header>';
  }

  function bottomNav() {
    var route = currentRoute();
    var items = [
      ['dispatcher', 'clipboard-list', '调度台'],
      ['driver', 'navigation', '看板'],
      ['vehicles', 'truck', '车辆'],
      ['settings', 'settings-2', '设置']
    ];
    return '<nav class="bottom-nav" aria-label="移动端导航">' + items.map(function (it) {
      return '<a class="bottom-link' + (route === it[0] ? ' is-active' : '') + '" href="#/' + it[0] + '">' +
        icon(it[1], 'bottom-ico') + '<span>' + it[2] + '</span></a>';
    }).join('') + '</nav>';
  }

  function statCards(state) {
    var result = state.result;
    var s = state.settings;
    var activeCount = (s.activeVehicleIds || []).length;
    var conflict = result ? result.summary.conflictCount : 0;
    var stats = [
      { label: '今日任务', value: String(state.tasks.length), sub: '个收货点', color: '#2563EB', icon: 'clipboard-list' },
      { label: '出车车辆', value: String(activeCount), sub: '辆已勾选', color: '#0D9488', icon: 'truck' },
      { label: '排班结果', value: result ? result.summary.vehicleCount + ' 车 / ' + result.summary.taskCount + ' 站' : '未排班', sub: result ? '已生成' : '等待智能派车', color: '#F97316', icon: 'route' },
      { label: '时间冲突', value: String(conflict), sub: conflict ? '需要关注' : '全部准时', color: conflict ? '#DC2626' : '#16A34A', icon: 'alert-triangle' },
      { label: '总里程', value: km(result ? result.summary.totalDistanceM : null), sub: result ? '距离估算，时间含缓冲' : '派车后显示', color: '#7C3AED', icon: 'map' }
    ];
    return '<div class="stat-grid">' + stats.map(function (st) {
      return '<div class="stat-card">' +
        '<span class="stat-ico" style="color:' + st.color + ';background:' + st.color + '1A">' + icon(st.icon) + '</span>' +
        '<span class="stat-value">' + esc(st.value) + '</span>' +
        '<span class="stat-label">' + esc(st.label) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function speechSupported() {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  }

  function taskRow(task) {
    var missingAddress = (task.lng == null || task.lat == null) && !(task.address || '').trim();
    var coarseLevels = ['省', '市', '城市', '区县', '乡镇', '村庄', '道路'];
    var coarse = task.lng != null && coarseLevels.indexOf(task.locLevel) >= 0;
    var locClass = task.lng != null ? (coarse ? 'loc-chip is-warn' : 'loc-chip is-ok') : (missingAddress ? 'loc-chip is-empty is-missing' : 'loc-chip is-empty');
    var locText = task.lng != null ? (coarse ? '粗略定位，请核对' : '已定位') : (missingAddress ? '缺地址' : '未定位');
    var seq = String(task.seq || '?').padStart(2, '0');
    return '<div class="task-card' + (missingAddress ? ' is-missing-address' : '') + '" data-task-id="' + esc(task.id) + '">' +
      '<div class="task-grid">' +
        '<div class="tf tf-seq"><span class="tf-label">序号</span><span class="task-seq">' + seq + '</span></div>' +
        '<div class="tf tf-name"><label class="tf-label" for="t-name-' + esc(task.id) + '">店名 / 收货点</label>' +
          '<input id="t-name-' + esc(task.id) + '" class="input" data-field="shopName" value="' + esc(task.shopName || '') + '" placeholder="例：西湖文化广场便利店" maxlength="40"></div>' +
        '<div class="tf tf-phone"><label class="tf-label" for="t-phone-' + esc(task.id) + '">联系电话</label>' +
          '<input id="t-phone-' + esc(task.id) + '" class="input" data-field="phone" value="' + esc(task.phone || '') + '" placeholder="手机 / 座机" maxlength="20" inputmode="tel"></div>' +
        '<div class="tf tf-deadline"><label class="tf-label" for="t-deadline-' + esc(task.id) + '">要求送达</label>' +
          '<input id="t-deadline-' + esc(task.id) + '" class="input" type="time" data-field="deadline" value="' + esc(task.deadline || '') + '"></div>' +
        '<div class="tf tf-addr"><label class="tf-label" for="t-addr-' + esc(task.id) + '">送货地址</label>' +
          '<div class="ac-wrap"><div class="loc-input">' +
            '<input id="t-addr-' + esc(task.id) + '" class="input task-address" data-field="address" value="' + esc(task.address || '') + '" placeholder="输入省市区和详细地址，可自动粗定位" maxlength="120">' +
            (speechSupported() ? '<button type="button" class="icon-btn speech-btn" data-speech-for="task-' + esc(task.id) + '" title="语音输入地址" aria-label="语音输入地址">' + icon('mic') + '</button>' : '') +
            '<button type="button" class="icon-btn" data-action="locate" title="定位此地址" aria-label="定位此地址">' + icon('map-pin') + '</button>' +
          '</div><span class="' + locClass + '" data-loc-chip="task">' + locText + '</span></div>' +
        '</div>' +
        '<div class="tf tf-note"><label class="tf-label" for="t-note-' + esc(task.id) + '">备注</label>' +
          '<input id="t-note-' + esc(task.id) + '" class="input" data-field="note" value="' + esc(task.note || '') + '" placeholder="选填，如：放前台" maxlength="80"></div>' +
        '<div class="tf tf-actions"><span class="tf-label">操作</span><div class="task-actions">' +
          '<button type="button" class="icon-btn task-del" data-action="delete-task" title="删除任务" aria-label="删除任务">' + icon('trash-2') + '</button>' +
        '</div></div>' +
      '</div>' +
    '</div>';
  }

  function tasksPanel(state) {
    var rows = state.tasks.map(taskRow).join('');
    return '<section class="panel tasks-panel">' +
      '<div class="panel-head"><div class="panel-title">' + icon('clipboard-list', 'panel-ico') + '<div><h2>送货任务</h2><p>' + state.tasks.length + ' 个收货点 · 时间冲突会标红</p></div></div>' +
      '<div class="panel-actions">' +
          '<button type="button" class="btn btn-ghost" data-action="load-demo">' + icon('sparkles', 'btn-ico') + '加载示例</button>' +
          '<button type="button" class="btn btn-ghost" data-action="export-json">' + icon('download', 'btn-ico') + '导出</button>' +
          '<button type="button" class="btn btn-ghost" data-action="import">' + icon('upload', 'btn-ico') + '导入</button>' +
          '<button type="button" class="btn btn-ghost" data-action="locate-all"' + (locateAllBusy ? ' disabled' : '') + '>' + icon('map-pin', 'btn-ico') + (locateAllBusy ? '定位中...' : '一键定位') + '</button>' +
          '<button type="button" class="btn btn-danger-ghost" data-action="clear-tasks">' + icon('trash-2', 'btn-ico') + '清空</button>' +
          '<button type="button" class="btn btn-primary" data-action="add-task">' + icon('plus', 'btn-ico') + '新增任务</button>' +
        '</div></div>' +
      (rows ? '<div class="task-list">' + rows + '</div>' :
        '<div class="empty-state">' + icon('inbox', 'empty-ico') + '<p>还没有任务，先新增一条或加载示例数据。</p></div>') +
    '</section>';
  }

  function locField(key, label, value, hasLoc) {
    return '<div class="field"><label class="tf-label">' + label + '</label>' +
      '<div class="ac-wrap"><div class="loc-input">' +
        '<input class="input" data-loc-key="' + key + '" value="' + esc(value || '') + '" placeholder="输入省市区和详细地址" maxlength="120">' +
        (speechSupported() ? '<button type="button" class="icon-btn speech-btn" data-speech-for="loc-' + key + '" title="语音输入地址" aria-label="语音输入地址">' + icon('mic') + '</button>' : '') +
        '<button type="button" class="icon-btn" data-action="locate-setting" data-loc-key="' + key + '" title="定位" aria-label="定位">' + icon('map-pin') + '</button>' +
      '</div><span class="loc-chip is-' + (hasLoc ? 'ok' : 'empty') + '" data-loc-chip="' + key + '">' + (hasLoc ? '已定位' : '未定位') + '</span></div></div>';
  }

  var dispatchBusy = false;
  var dispatchBusyMode = null;

  function taskById(state, id) {
    return (state.tasks || []).find(function (t) { return t.id === id; });
  }

  function vehicleById(state, id) {
    return (state.vehicles || []).find(function (v) { return v.id === id; });
  }

  function activeVehicles(state) {
    return (state.settings.activeVehicleIds || [])
      .map(function (id) { return vehicleById(state, id); })
      .filter(Boolean);
  }

  function loadDriverId() {
    try { return global.localStorage.getItem('dispatch.driver.v1') || ''; } catch (e) { return ''; }
  }

  function saveDriverId(id) {
    try { global.localStorage.setItem('dispatch.driver.v1', id); } catch (e) { /* ignore */ }
  }

  function vehiclePill(state, v) {
    var active = (state.settings.activeVehicleIds || []).indexOf(v.id) >= 0;
    return '<label class="veh-pill' + (active ? ' is-active' : '') + '">' +
      '<input type="checkbox" data-active-vehicle="' + esc(v.id) + '"' + (active ? ' checked' : '') + '>' +
      '<span class="veh-dot" style="background:' + esc(v.color) + '"></span>' +
      '<span class="veh-pill-name">' + esc(v.plateNo || '未填车牌') + '</span>' +
      '<small>' + esc(v.driverName || '未填司机') + '</small>' +
    '</label>';
  }

  function balanceFieldHtml(id, value) {
    var v = Number(value);
    if (!isFinite(v)) v = 70;
    v = Math.max(0, Math.min(100, Math.round(v)));
    return '<div class="field">' +
      '<div class="range-head"><label class="tf-label" for="' + esc(id) + '">工作量均衡</label><span class="range-value">' + v + '%</span></div>' +
      '<input id="' + esc(id) + '" class="input range-input" type="range" min="0" max="100" step="5" data-settings-key="balanceLevel" value="' + v + '" style="--range-fill:' + v + '%">' +
      '<div class="range-scale"><span>效率优先</span><span>均衡优先</span></div>' +
    '</div>';
  }

  function dispatchPanel(state) {
    var s = state.settings;
    var busy = dispatchBusy ? ' disabled' : '';
    var offlineBusy = dispatchBusy && dispatchBusyMode === 'offline';
    var aiBusy = dispatchBusy && dispatchBusyMode === 'ai';
    return '<section class="panel dispatch-panel">' +
      '<div class="panel-head"><div class="panel-title">' + icon('route', 'panel-ico') + '<div><h2>出车设置</h2><p>' + (s.start ? '起点已定位' : '起点未定位') + ' · ' + (s.roundTrip ? '送完返回终点' : '送完原地待命') + '</p></div></div></div>' +
      '<div class="panel-body">' +
        '<div class="field-grid">' +
          locField('start', '出发地', s.startAddr, !!s.start) +
        '</div>' +
        '<label class="switch-row"><input type="checkbox" data-settings-key="roundTrip"' + (s.roundTrip ? ' checked' : '') + '><span class="switch-ui"></span><span class="switch-label">送完返回终点</span></label>' +
        '<p class="settings-note">开启后车辆送完最后一站返回出发地（终点）；关闭则就近原地待命。</p>' +
        '<div class="field-row two">' +
          '<div class="field"><label class="tf-label" for="stop-minutes">停靠分钟</label>' +
            '<input id="stop-minutes" class="input" type="number" min="1" max="120" data-settings-key="stopMinutes" value="' + esc(s.stopMinutes) + '"></div>' +
          '<div class="field"><label class="tf-label" for="default-start">默认发车</label>' +
            '<input id="default-start" class="input" type="time" data-settings-key="defaultStartTime" value="' + esc(s.defaultStartTime) + '"></div>' +
        '</div>' +
        balanceFieldHtml('balance-level', s.balanceLevel) +
        '<p class="settings-note">AI 派车已内置 5 公里就近合车和完工时间均衡；离线按钮只作为不调用 AI 的兜底方案。</p>' +
        '<div class="field"><label class="tf-label">参与车辆</label><div class="veh-pills">' +
          state.vehicles.map(function (v) { return vehiclePill(state, v); }).join('') +
        '</div></div>' +
        '<button type="button" class="btn btn-primary btn-block btn-dispatch"' + busy + ' data-action="dispatch" title="不调用 AI，按就近和时间均衡原则离线派车">' +
          (offlineBusy ? icon('loader', 'btn-ico spin') + '离线排线中...' : icon('route', 'btn-ico') + '离线均衡派车') +
        '</button>' +
        '<button type="button" class="btn btn-ai btn-block btn-ai-dispatch"' + busy + ' data-action="ai-dispatch" title="调用 DeepSeek 生成最终派车方案，失败自动改用离线算法">' +
          (aiBusy ? icon('loader', 'btn-ico spin') + 'AI 排线中...' : icon('sparkles', 'btn-ico') + 'AI 派车') +
        '</button>' +
      '</div></section>';
  }

  function routeMetaHtml(r) {
    var meta = [
      ['站数', r.stops.length + ' 站'],
      ['出发', Planning.toHHMM(r.startMin)],
      ['完工', Planning.toHHMM(r.finishMin)],
      ['里程', km(r.totalDistanceM)],
      ['用时', fmtDuration(r.totalDurationMin)]
    ];
    return meta.map(function (m) {
      return '<span><small>' + m[0] + '</small><b>' + m[1] + '</b></span>';
    }).join('');
  }

  function navLinkForTask(t, primary) {
    if (!t || !(t.address || t.shopName)) return '';
    var label = primary ? '地图搜索' : '导航';
    return '<a class="btn ' + (primary ? 'btn-primary' : 'btn-ghost') + ' btn-sm nav-link" href="' +
      esc(Geo.openMapSearch(t.address, t.shopName || '收货点')) +
      '" target="_blank" rel="noopener">' + icon('navigation', 'btn-ico') + label + '</a>';
  }

  function routeCard(state, r) {
    var stopsHtml = (r.stops || []).map(function (s) {
      var t = taskById(state, s.taskId) || {};
      var nav = navLinkForTask(t, false);
      return '<div class="stop-row' + (s.conflict ? ' is-conflict' : '') + '">' +
        '<span class="stop-order" style="--sc:' + esc(r.color) + '">' + (s.order != null ? s.order : '') + '</span>' +
        '<div class="stop-main">' +
          '<strong>' + esc(t.shopName || '未命名收货点') + '</strong>' +
          '<span class="stop-addr">' + esc(t.address || '') + '</span>' +
          (t.phone ? '<span class="stop-phone">' + esc(t.phone) + '</span>' : '') +
          (t.note ? '<span class="stop-note">' + esc(t.note) + '</span>' : '') +
        '</div>' +
        '<div class="stop-time">' +
          '<span class="eta">' + esc(Planning.toHHMM(s.etaMin)) + '</span>' +
          (t.deadline ? '<span class="deadline' + (s.conflict ? ' is-conflict' : '') + '">截止 ' + esc(t.deadline) + '</span>' : '') +
          (s.conflict ? '<span class="conflict-badge">' + icon('alert-triangle') + '冲突</span>' : '') +
        '</div>' +
        nav +
      '</div>';
    }).join('');
    return '<article class="route-card" style="--rc:' + esc(r.color) + '">' +
      '<div class="route-head">' +
        '<span class="route-color" style="background:' + esc(r.color) + '"></span>' +
        '<div class="route-title"><strong>' + esc(r.label) + '</strong><span>' + esc(r.plateNo) + ' · ' + esc(r.driverName) + '</span></div>' +
        (r.driverPhone ? '<a class="call-link" href="tel:' + esc(r.driverPhone) + '">' + icon('phone', 'btn-ico') + esc(r.driverPhone) + '</a>' : '') +
      '</div>' +
      '<div class="route-meta">' + routeMetaHtml(r) + '</div>' +
      '<div class="route-stops">' + stopsHtml + '</div>' +
    '</article>';
  }

  function driverRouteView(state, r) {
    var stopsHtml = (r.stops || []).map(function (s) {
      var t = taskById(state, s.taskId) || {};
      var nav = navLinkForTask(t, true);
      return '<div class="stop-row' + (s.conflict ? ' is-conflict' : '') + '">' +
        '<span class="stop-order" style="--sc:' + esc(r.color) + '">' + (s.order != null ? s.order : '') + '</span>' +
        '<div class="stop-main">' +
          '<strong>' + esc(t.shopName || '未命名收货点') + '</strong>' +
          '<span class="stop-addr">' + esc(t.address || '') + '</span>' +
          (t.phone ? '<span class="stop-phone">' + esc(t.phone) + '</span>' : '') +
          (t.note ? '<span class="stop-note">' + esc(t.note) + '</span>' : '') +
        '</div>' +
        '<div class="stop-time">' +
          '<span class="eta">' + esc(Planning.toHHMM(s.etaMin)) + '</span>' +
          (t.deadline ? '<span class="deadline' + (s.conflict ? ' is-conflict' : '') + '">截止 ' + esc(t.deadline) + '</span>' : '') +
          (s.conflict ? '<span class="conflict-badge">' + icon('alert-triangle') + '冲突</span>' : '') +
        '</div>' +
        nav +
      '</div>';
    }).join('');
    if (state.settings.roundTrip && (r.stops || []).length) {
      stopsHtml += '<div class="stop-row is-return">' +
        '<span class="stop-order" style="--sc:' + esc(r.color) + '">返</span>' +
        '<div class="stop-main"><strong>返回终点</strong><span class="stop-addr">' + esc(state.settings.startAddr || '出发地') + '</span></div>' +
        '<div class="stop-time"><span class="eta">' + esc(Planning.toHHMM(r.finishMin)) + '</span></div>' +
      '</div>';
    }
    return '<section class="panel driver-route">' +
      '<div class="route-head">' +
        '<span class="route-color" style="background:' + esc(r.color) + '"></span>' +
        '<div class="route-title"><strong>' + esc(r.plateNo || r.label) + '</strong><span>' + esc(r.driverName) + (r.driverPhone ? ' · ' + esc(r.driverPhone) : '') + '</span></div>' +
      '</div>' +
      '<div class="route-meta">' + routeMetaHtml(r) + '</div>' +
      '<div class="route-stops driver-stops">' + stopsHtml + '</div>' +
    '</section>';
  }

  function driverPage(state) {
    var head = pageHeader('司机看板', '按车辆查看今日路线与到达时间');
    var vehicles = state.vehicles || [];
    if (!vehicles.length) {
      return head + '<div class="empty-state">' + icon('truck', 'empty-ico') + '<p>还没有车辆。</p></div>';
    }
    var selected = selectedDriverId && vehicleById(state, selectedDriverId) ? selectedDriverId : vehicles[0].id;
    var options = vehicles.map(function (v) {
      return '<option value="' + esc(v.id) + '"' + (v.id === selected ? ' selected' : '') + '>' +
        esc(v.plateNo || '未填车牌') + ' · ' + esc(v.driverName || '') + '</option>';
    }).join('');
    var body = '<section class="panel driver-select-panel">' +
      '<div class="panel-head"><div class="panel-title">' + icon('truck', 'panel-ico') + '<div><h2>我的车辆</h2><p>' + vehicles.length + ' 辆可选</p></div></div></div>' +
      '<div class="panel-body"><select id="driver-vehicle-select" class="input select">' + options + '</select></div></section>';
    if (!state.result) {
      return head + body + '<div class="panel"><div class="empty-state">' + icon('route', 'empty-ico') + '<p>调度台还没有生成结果。</p></div></div>';
    }
    var route = state.result.routes.filter(function (r) { return r.vehicleId === selected; })[0] || null;
    if (!route) {
      return head + body + '<div class="panel"><div class="empty-state">' + icon('info', 'empty-ico') + '<p>这辆车今天没有排班。</p></div></div>';
    }
    var exportBtn = '<button type="button" class="btn btn-primary" data-action="export-routes-excel" data-vehicle-id="' + esc(route.vehicleId) + '">' + icon('file-spreadsheet', 'btn-ico') + '导出路线 Excel</button>';
    return pageHeader('司机看板', '按车辆查看今日路线与到达时间', exportBtn) + body + driverRouteView(state, route);
  }

  function vehicleCard(v) {
    return '<article class="veh-card" data-vehicle-id="' + esc(v.id) + '">' +
      '<div class="veh-top">' +
        '<label class="color-pick" title="路线颜色"><input type="color" data-vehicle-field="color" value="' + esc(v.color) + '"><span style="background:' + esc(v.color) + '"></span></label>' +
        '<div class="veh-fields">' +
          '<input class="input" data-vehicle-field="plateNo" value="' + esc(v.plateNo) + '" placeholder="车牌号" maxlength="20">' +
          '<input class="input" data-vehicle-field="driverName" value="' + esc(v.driverName) + '" placeholder="司机姓名" maxlength="30">' +
        '</div>' +
        '<button type="button" class="icon-btn veh-del" data-action="delete-vehicle" title="删除车辆" aria-label="删除车辆">' + icon('trash-2') + '</button>' +
      '</div>' +
      '<div class="veh-bottom"><label class="tf-label">司机电话</label>' +
        '<input class="input" data-vehicle-field="driverPhone" value="' + esc(v.driverPhone) + '" placeholder="手机号" maxlength="30" inputmode="tel">' +
      '</div>' +
    '</article>';
  }

  function vehiclesPage(state) {
    var rows = (state.vehicles || []).map(vehicleCard).join('');
    return pageHeader('车辆维护', '管理车牌、司机与路线颜色') +
      '<section class="panel vehicles-panel">' +
        '<div class="panel-head"><div class="panel-title">' + icon('truck', 'panel-ico') + '<div><h2>车辆</h2><p>' + state.vehicles.length + ' 辆</p></div></div>' +
        '<div class="panel-actions"><button type="button" class="btn btn-primary" data-action="add-vehicle">' + icon('plus', 'btn-ico') + '新增车辆</button></div>' +
        '</div>' +
        (rows ? '<div class="veh-grid">' + rows + '</div>' : '<div class="empty-state">' + icon('truck', 'empty-ico') + '<p>还没有车辆。</p></div>') +
      '</section>';
  }

  function settingsPage(state) {
    var s = state.settings;
    var mode = Geo.status();
    var statusLabel = mode.mode === 'amap' ? '已连接高德服务'
      : mode.loading ? '正在连接地图'
      : mode.error ? mode.error
      : '上海离线详细路网：不调用地图 API';
    var modeClass = mode.mode === 'amap' ? 'is-amap' : (mode.loading ? 'is-loading' : 'is-demo');
    return pageHeader('设置', '定位模式与派车偏好') +
      '<div class="settings-grid">' +
        '<section class="panel settings-card"><div class="panel-head"><div class="panel-title">' + icon('map', 'panel-ico') + '<div><h2>上海及周边离线粗定位</h2><p>默认无需 Key，上海详细、周边按城市估算</p></div></div></div>' +
          '<div class="panel-body">' +
            '<p class="mode-line"><span class="mode-badge ' + modeClass + '"><i class="mode-dot"></i>' + esc(statusLabel) + '</span></p>' +
            '<p class="settings-note">上海地址按区县、镇街、商圈和主要道路关键词估算；上海中心城区含 Z14 详细离线路网，放大后可看到路名。苏州、昆山、嘉兴等周边城市只按城市中心附近估算，用于分车、排序和预计到达时间，不代表真实门牌位置。</p>' +
            '<div class="field"><label class="tf-label" for="amap-key-input">高德 JS API Key</label>' +
              '<div class="key-row"><input id="amap-key-input" class="input" type="text" value="' + esc(s.amapKey) + '" placeholder="粘贴 Key" maxlength="80">' +
                '<button type="button" class="btn btn-ghost" data-action="connect-amap">' + icon('plug', 'btn-ico') + '可选连接</button></div>' +
            '</div>' +
            '<div class="field"><label class="tf-label" for="amap-security-input">安全密钥</label>' +
              '<input id="amap-security-input" class="input" type="text" value="' + esc(s.amapSecurityCode) + '" placeholder="粘贴安全密钥" maxlength="80" autocomplete="off">' +
            '</div>' +
          '</div></section>' +
        '<section class="panel settings-card"><div class="panel-head"><div class="panel-title">' + icon('sparkles', 'panel-ico') + '<div><h2>DeepSeek AI 排车</h2><p>用户自己填写 Key，保存在本机浏览器</p></div></div></div>' +
          '<div class="panel-body">' +
            '<div class="field"><label class="tf-label" for="deepseek-key-input">DeepSeek API Key</label>' +
              '<input id="deepseek-key-input" class="input" type="password" value="' + esc(s.deepseekKey) + '" data-settings-key="deepseekKey" placeholder="sk-..." maxlength="200" autocomplete="off">' +
            '</div>' +
            '<p class="settings-note">“AI 派车”和调度台的“AI 调度对话”都会调用 DeepSeek；AI 返回不合格或接口失败时，可自动改用离线算法兜底。</p>' +
          '</div></section>' +
        '<section class="panel settings-card"><div class="panel-head"><div class="panel-title">' + icon('settings-2', 'panel-ico') + '<div><h2>派车偏好</h2><p>默认发车与停靠时长</p></div></div></div>' +
          '<div class="panel-body"><div class="field-grid">' +
            '<div class="field"><label class="tf-label" for="set-stop-minutes">停靠分钟</label><input id="set-stop-minutes" class="input" type="number" min="1" max="120" data-settings-key="stopMinutes" value="' + esc(s.stopMinutes) + '"></div>' +
            '<div class="field"><label class="tf-label" for="set-default-start">默认发车</label><input id="set-default-start" class="input" type="time" data-settings-key="defaultStartTime" value="' + esc(s.defaultStartTime) + '"></div>' +
            balanceFieldHtml('set-balance-level', s.balanceLevel) +
          '</div></div></section>' +
      '</div>';
  }

  function dispatcherPage(state) {
    return pageHeader('调度台', todayTitle()) +
      statCards(state) +
      '<div class="layout-grid">' +
        '<div class="col-main">' + tasksPanel(state) + '</div>' +
        '<div class="col-side">' + dispatchPanel(state) + resultPanel(state) + '</div>' +
      '</div>' +
      aiChatPanel(state);
  }

  function resultPanel(state) {
    var result = state.result;
    var head = '<section class="panel result-panel">' +
      '<div class="panel-head"><div class="panel-title">' + icon('route', 'panel-ico') + '<div><h2>排班结果</h2><p>' + (result ? '生成于 ' + fmtTime(new Date(result.generatedAt)) : '等待智能派车') + '</p></div></div>' +
      (result ? '<div class="panel-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="export-routes-excel" title="导出司机送单路线 Excel">' + icon('file-spreadsheet', 'btn-ico') + '导出 Excel</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="edit-routes">' + icon('edit-3', 'btn-ico') + '手动调整路线</button>' +
        '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="clear-result">' + icon('x', 'btn-ico') + '清除</button>' +
      '</div>' : '') +
      '</div>';
    if (!result) {
      return head + '<div class="panel-body"><div class="empty-state">' + icon('map', 'empty-ico') + '<p>派车后这里会显示每辆车的路线。</p></div></div></section>';
    }
    var stale = Store.resultStale();
    var summary = result.summary || {};
    var finishTimes = result.routes
      .filter(function (r) { return r.stops && r.stops.length; })
      .map(function (r) { return Number(r.finishMin) || 0; });
    var returnSpreadMin = Number(summary.returnSpreadMin);
    if (!isFinite(returnSpreadMin)) {
      returnSpreadMin = finishTimes.length
        ? Math.max.apply(null, finishTimes) - Math.min.apply(null, finishTimes)
        : 0;
    }
    var loadTotal = 0;
    var loadMax = 0;
    var loadMin = Infinity;
    result.routes.forEach(function (r) {
      var d = Number(r.totalDurationMin) || 0;
      loadTotal += d;
      if (d > loadMax) loadMax = d;
      if (d < loadMin) loadMin = d;
    });
    if (!result.routes.length) loadMin = 0;
    var loadBars = result.routes.map(function (r) {
      var d = Number(r.totalDurationMin) || 0;
      var w = loadTotal ? Math.round(d / loadTotal * 1000) / 10 : 0;
      return '<span style="width:' + w + '%;background:' + esc(r.color) + '" title="' +
        esc(r.label + ' · ' + fmtDuration(d)) + '"></span>';
    }).join('');
    var loadHtml = '<div class="route-load">' +
      '<div class="route-load-head"><span>单程负载</span><b>' + fmtDuration(loadMin) + ' - ' + fmtDuration(loadMax) + '</b></div>' +
      '<div class="route-load-track" aria-label="各车辆单程用时占比">' + loadBars + '</div>' +
    '</div>';
    var mapMode = Geo.status();
    var mapModeLabel = mapMode.mode === 'amap' ? '高德地图'
      : mapMode.loading ? '地图连接中（离线底图）'
      : '上海离线路网';
    return head +
      (stale ? '<div class="stale-banner">' + icon('refresh-cw', 'banner-ico') + '<span>任务或车辆有变动，建议重新派车</span></div>' : '') +
      '<div class="result-summary">' +
        '<span><b>' + summary.vehicleCount + '</b>辆车</span>' +
        '<span><b>' + summary.taskCount + '</b>个站点</span>' +
        '<span><b>' + km(summary.totalDistanceM) + '</b>总里程</span>' +
        '<span class="' + (summary.conflictCount ? 'is-warn' : 'is-ok') + '"><b>' + summary.conflictCount + '</b>个冲突</span>' +
        '<span class="' + (returnSpreadMin <= 15 ? 'is-ok' : 'is-warn') + '"><b>' + fmtDuration(returnSpreadMin) + '</b>完工差</span>' +
      '</div>' +
      loadHtml +
      '<div class="route-list">' + result.routes.map(function (r) { return routeCard(state, r); }).join('') + '</div>' +
      '<div class="map-head"><div class="map-title"><h3>路线图</h3>' +
        '<span class="mode-chip">' + esc(mapModeLabel) + '</span>' +
      '</div><button type="button" class="btn btn-ghost btn-sm map-expand-btn" data-action="expand-map" title="放大查看路线图">' +
        icon('maximize-2', 'btn-ico') + '放大查看' +
      '</button>' +
      '</div>' +
      '<div id="map-host" class="map-host"></div>' +
    '</section>';
  }

  function loadAiChat() {
    try {
      var raw = global.localStorage.getItem(AI_CHAT_LS);
      var data = raw ? JSON.parse(raw) : null;
      return {
        messages: Array.isArray(data && data.messages) ? data.messages : [],
        candidate: data && data.candidate ? data.candidate : null,
        busy: false,
        pendingScroll: false
      };
    } catch (e) {
      return { messages: [], candidate: null, busy: false, pendingScroll: false };
    }
  }

  function saveAiChat() {
    try {
      global.localStorage.setItem(AI_CHAT_LS, JSON.stringify({
        messages: aiChat.messages,
        candidate: aiChat.candidate
      }));
    } catch (e) { /* ignore */ }
  }

  function addAiChatMessage(role, text, candidate) {
    var msg = {
      id: 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      role: role,
      text: text || '',
      at: Date.now()
    };
    if (candidate) {
      msg.candidate = candidate;
      aiChat.candidate = candidate;
    }
    aiChat.messages.push(msg);
    if (aiChat.messages.length > 80) aiChat.messages = aiChat.messages.slice(-80);
    saveAiChat();
    return msg;
  }

  function aiChatCandidateFromRoutes(routes) {
    return {
      routes: routes,
      vehicleCount: routes.length,
      taskCount: routes.reduce(function (sum, r) {
        return sum + (r.stops || []).length;
      }, 0)
    };
  }

  function aiChatMessageHtml(m, state) {
    var body = '<div class="ai-msg-bubble">' + esc(m.text || '') + '</div>';
    if (m.candidate && m.candidate.routes && m.candidate.routes.length) {
      var candidate = m.candidate;
      var chips = candidate.routes.map(function (r) {
        var v = vehicleById(state, r.vehicleId) || {};
        var taskCount = (r.stops || []).length;
        return '<span class="ai-cand-chip" style="--cc:' + esc(v.color || r.color || '#2563EB') + '">' +
          esc(v.plateNo || v.driverName || r.label || r.vehicleId) + ' · ' + taskCount + ' 站</span>';
      }).join('');
      body += '<div class="ai-candidate">' +
        '<div class="ai-candidate-head"><strong>AI 候选方案</strong><span>' + candidate.vehicleCount + ' 车 / ' + candidate.taskCount + ' 站</span></div>' +
        '<div class="ai-candidate-routes">' + chips + '</div>' +
        '<div class="ai-candidate-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="ai-chat-apply">' + icon('check', 'btn-ico') + '采用此方案</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="ai-chat-replan">' + icon('refresh-cw', 'btn-ico') + '重新生成</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="ai-msg ai-msg-' + esc(m.role) + '" data-msg-id="' + esc(m.id) + '">' + body + '</div>';
  }

  function aiChatPanel(state) {
    var hasKey = !!state.settings.deepseekKey;
    var messagesHtml = aiChat.messages.length
      ? aiChat.messages.map(function (m) { return aiChatMessageHtml(m, state); }).join('')
      : '<div class="ai-chat-empty">' + icon('message-square', 'empty-ico') +
        '<p>告诉 AI 你想怎么调整：就近合车、时间均衡、调整访问顺序等。</p></div>';
    var vehicleCount = activeVehicles(state).length;
    var spread = state.result && state.result.summary ?
      Number(state.result.summary.returnSpreadMin) : null;
    var ctxItems =
      '<span class="ai-ctx-chip"><i></i>任务 ' + state.tasks.length + ' 个</span>' +
      '<span class="ai-ctx-chip"><i></i>车辆 ' + vehicleCount + ' 辆</span>' +
      (state.result ? '<span class="ai-ctx-chip"><i></i>当前 ' + state.result.routes.length + ' 车 / ' +
        state.result.summary.taskCount + ' 站</span>' +
        (spread != null ? '<span class="ai-ctx-chip"><i></i>完工差 ' + fmtDuration(spread) + '</span>' : '')
      : '<span class="ai-ctx-chip"><i></i>暂无排班结果</span>');
    return '<section class="panel ai-chat-panel">' +
      '<div class="panel-head"><div class="panel-title">' + icon('message-square', 'panel-ico') + '<div><h2>AI 调度对话</h2><p>AI 会读取当前任务、车辆和路线，只有你确认后才采用方案</p></div></div>' +
        '<div class="panel-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="ai-chat-clear">' + icon('trash-2', 'btn-ico') + '清空对话</button>' +
        '</div></div>' +
      '<div class="ai-chat-body">' +
        '<div class="ai-chat-context" aria-label="当前调度上下文">' +
          '<h4>当前上下文</h4><div class="ai-ctx-list">' + ctxItems + '</div>' +
          (hasKey ? '' : '<p class="ai-ctx-tip">请先在设置里填写 DeepSeek API Key。</p>') +
        '</div>' +
        '<div class="ai-chat-main">' +
          '<div class="ai-chat-messages" id="ai-chat-messages">' + messagesHtml + '</div>' +
          (aiChat.busy ? '<div class="ai-chat-loading">' + icon('loader', 'spin') + 'AI 正在分析路线...</div>' : '') +
          '<div class="ai-chat-compose">' +
            '<textarea id="ai-chat-input" rows="2" maxlength="800" placeholder="例如：把闵行和徐汇的放一辆车，各车完工时间尽量接近" ' +
              (aiChat.busy ? 'disabled' : '') + '></textarea>' +
            '<div class="ai-chat-actions">' +
              '<button type="button" class="btn btn-ghost" data-action="ai-chat-replan"' + (aiChat.busy ? ' disabled' : '') + '>' + icon('refresh-cw', 'btn-ico') + '重新生成</button>' +
              '<button type="button" class="btn btn-ai" data-action="ai-chat-send"' + (aiChat.busy ? ' disabled' : '') + '>' + icon('send', 'btn-ico') + '发送</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function buildMapData(state) {
    var result = state.result;
    var start = state.settings.start;
    if (!result || !start) return null;
    var roundTrip = !!state.settings.roundTrip;
    var end = roundTrip ? { lng: start.lng, lat: start.lat } : null;
    var routes = result.routes.map(function (r) {
      var stops = (r.stops || []).map(function (s) {
        var t = taskById(state, s.taskId) || {};
        return Object.assign({}, s, {
          lng: t.lng != null ? t.lng : null,
          lat: t.lat != null ? t.lat : null,
          shopName: t.shopName || '',
          address: t.address || ''
        });
      }).filter(function (s) { return s.lng != null && s.lat != null; });
      var out = Object.assign({}, r, { stops: stops });
      var legs = out.legs && out.legs.length ? out.legs : null;
      if (!legs) {
        var pts = [start].concat(stops.map(function (s) {
          return { lng: s.lng, lat: s.lat };
        }));
        if (end && end.lng != null && end.lat != null) pts.push({ lng: end.lng, lat: end.lat });
        legs = Geo.demoLegs(pts);
      }
      var waypoints = [];
      legs.forEach(function (leg) {
        (leg.path || []).forEach(function (p) {
          var last = waypoints[waypoints.length - 1];
          if (!last || Math.abs(last.lng - p.lng) > 1e-9 || Math.abs(last.lat - p.lat) > 1e-9) {
            waypoints.push(p);
          }
        });
      });
      out.legs = legs;
      out.waypoints = waypoints;
      return out;
    });
    return { start: start, end: end, routes: routes };
  }

  function renderMapHost(host, data, expanded) {
    if (!host || !data) return;
    var handle = null;
    if (Geo.isAmap()) {
      try {
        handle = Geo.renderAmapMap(host, data);
      } catch (err) {
        // 高德地图对象创建失败时回退到可用的离线路线图。
        handle = null;
      }
    }
    if (expanded) expandedMapHandle = handle;
    else amapMapHandle = handle;
    if (!handle) Geo.renderDemoMap(host, data);
    attachMapZoom(host, handle);
  }

  function parseViewBox(svg) {
    var parts = String(svg.getAttribute('viewBox') || '0 0 900 520').split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 900, h: parts[3] || 520 };
  }

  function applyViewBox(svg, vb) {
    var vals = [vb.x, vb.y, vb.w, vb.h].map(function (v) {
      return Math.round(Number(v) * 10) / 10;
    });
    svg.setAttribute('viewBox', vals.join(' '));
  }

  function zoomDemoMap(svg, factor, rx, ry) {
    if (!svg || factor <= 0) return;
    var vb = parseViewBox(svg);
    var W = Number(svg.getAttribute('data-map-w')) || vb.w;
    var H = Number(svg.getAttribute('data-map-h')) || vb.h;
    var nw = Math.max(8, Math.min(W, vb.w / factor));
    var nh = Math.max(8, Math.min(H, vb.h / factor));
    rx = (rx == null) ? 0.5 : Math.max(0, Math.min(1, rx));
    ry = (ry == null) ? 0.5 : Math.max(0, Math.min(1, ry));
    var cx = vb.x + rx * vb.w;
    var cy = vb.y + ry * vb.h;
    var nx = Math.max(0, Math.min(W - nw, cx - rx * nw));
    var ny = Math.max(0, Math.min(H - nh, cy - ry * nh));
    applyViewBox(svg, { x: nx, y: ny, w: nw, h: nh });
    if (Geo && Geo.refreshOfflineLayer) Geo.refreshOfflineLayer(svg);
  }

  function resetDemoMap(svg) {
    if (!svg) return;
    svg.setAttribute('viewBox', svg.getAttribute('data-initial-viewbox') || '0 0 900 520');
    if (Geo && Geo.refreshOfflineLayer) Geo.refreshOfflineLayer(svg);
  }

  function panDemoMap(svg, base, dx, dy) {
    if (!svg) return;
    var W = Number(svg.getAttribute('data-map-w')) || base.w;
    var H = Number(svg.getAttribute('data-map-h')) || base.h;
    var nx = Math.max(0, Math.min(W - base.w, base.x - dx));
    var ny = Math.max(0, Math.min(H - base.h, base.y - dy));
    applyViewBox(svg, { x: nx, y: ny, w: base.w, h: base.h });
    if (Geo && Geo.refreshOfflineLayer) Geo.refreshOfflineLayer(svg);
  }

  function attachDemoMapInteractions(svg) {
    if (!svg || svg.__dispatchZoomAttached) return;
    svg.__dispatchZoomAttached = true;
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      var rx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
      var ry = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
      zoomDemoMap(svg, e.deltaY < 0 ? 1.18 : 1 / 1.18, rx, ry);
    }, { passive: false });

    var drag = null;
    svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('a'))) return;
      drag = { x: e.clientX, y: e.clientY, vb: parseViewBox(svg) };
      svg.classList.add('is-panning');
      if (svg.setPointerCapture) {
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var rect = svg.getBoundingClientRect();
      var dx = rect.width ? (e.clientX - drag.x) / rect.width * drag.vb.w : 0;
      var dy = rect.height ? (e.clientY - drag.y) / rect.height * drag.vb.h : 0;
      panDemoMap(svg, drag.vb, dx, dy);
    });
    function endDrag() {
      drag = null;
      svg.classList.remove('is-panning');
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
  }

  function attachMapZoom(host, handle) {
    if (!host) return;
    var old = host.querySelector('.map-zoom-controls');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var controls = el(
      '<div class="map-zoom-controls">' +
        '<button type="button" class="map-zoom-btn" data-map-zoom="in" title="放大" aria-label="放大">' + icon('plus') + '</button>' +
        '<button type="button" class="map-zoom-btn" data-map-zoom="out" title="缩小" aria-label="缩小">' + icon('minus') + '</button>' +
        '<button type="button" class="map-zoom-btn" data-map-zoom="reset" title="重置视图" aria-label="重置视图">' + icon('maximize') + '</button>' +
      '</div>'
    );
    host.appendChild(controls);
    refreshIcons(controls);
    attachDemoMapInteractions(host.querySelector('svg.demo-map'));
  }

  function handleMapZoom(host, action) {
    if (!host) return;
    var svg = host.querySelector('svg.demo-map');
    if (svg) {
      if (action === 'in') zoomDemoMap(svg, 1.35);
      else if (action === 'out') zoomDemoMap(svg, 1 / 1.35);
      else resetDemoMap(svg);
      return;
    }
    var handle = host.id === 'map-expanded-host' ? expandedMapHandle : amapMapHandle;
    if (handle && handle[action]) handle[action]();
  }

  function renderMapIfNeeded() {
    destroyAmapMap();
    var host = $('#map-host');
    if (!host) return;
    var data = buildMapData(Store.getState());
    if (!data) return;
    renderMapHost(host, data, false);
  }

  function handleExpandMap() {
    var data = buildMapData(Store.getState());
    if (!data) {
      toast('暂无可放大的路线图', 'warn');
      return;
    }
    openModal('路线图放大查看',
      '<div id="map-expanded-host" class="map-expanded-host"></div>',
      { className: 'map-modal' }
    );
    var host = $('#map-expanded-host');
    if (!host) return;
    renderMapHost(host, data, true);
  }

  function assignedTaskIds(result) {
    var assigned = {};
    ((result && result.routes) || []).forEach(function (r) {
      (r.stops || []).forEach(function (s) { assigned[s.taskId] = true; });
    });
    return assigned;
  }

  function cloneResult(result) {
    return JSON.parse(JSON.stringify(result || {}));
  }

  function manualEditVehicles(state) {
    var ids = [];
    function addId(id) {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    (state.settings.activeVehicleIds || []).forEach(addId);
    ((state.result && state.result.routes) || []).forEach(function (r) { addId(r.vehicleId); });
    return ids.map(function (id) { return vehicleById(state, id); }).filter(Boolean);
  }

  function manualStopHtml(state, vehicle, stop, index) {
    var t = taskById(state, stop.taskId) || {};
    return '<div class="manual-stop">' +
      '<span class="manual-stop-order" style="background:' + esc(vehicle.color) + '">' + (index + 1) + '</span>' +
      '<div class="manual-stop-main"><strong>' + esc(t.shopName || t.address || '未命名站点') + '</strong><span>' + esc(t.address || '') + '</span></div>' +
      '<div class="manual-stop-actions">' +
        '<button type="button" class="icon-btn manual-btn" data-route-edit="up" data-vehicle-id="' + esc(vehicle.id) + '" data-task-id="' + esc(stop.taskId) + '" title="上移" aria-label="上移">' + icon('arrow-up') + '</button>' +
        '<button type="button" class="icon-btn manual-btn" data-route-edit="down" data-vehicle-id="' + esc(vehicle.id) + '" data-task-id="' + esc(stop.taskId) + '" title="下移" aria-label="下移">' + icon('arrow-down') + '</button>' +
        '<button type="button" class="icon-btn manual-btn manual-remove-btn" data-route-edit="remove" data-vehicle-id="' + esc(vehicle.id) + '" data-task-id="' + esc(stop.taskId) + '" title="移出" aria-label="移出">' + icon('x') + '</button>' +
      '</div>' +
    '</div>';
  }

  function manualAddSelectHtml(state, vehicle) {
    var assigned = assignedTaskIds(state.result);
    var options = state.tasks.filter(function (t) {
      return !assigned[t.id] && t.lng != null && t.lat != null;
    }).map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.shopName || t.address || '未命名站点') + '</option>';
    }).join('');
    if (!options) {
      return '<select class="input manual-add-select" data-route-edit="add" data-vehicle-id="' + esc(vehicle.id) + '" disabled><option value="">无可添加站点</option></select>';
    }
    return '<select class="input manual-add-select" data-route-edit="add" data-vehicle-id="' + esc(vehicle.id) + '">' +
      '<option value="">加入此车</option>' + options +
    '</select>';
  }

  function manualEditModalBody(state) {
    var assigned = assignedTaskIds(state.result);
    var unassigned = state.tasks.filter(function (t) { return !assigned[t.id]; });
    var vehicles = manualEditVehicles(state);
    return '<div class="manual-edit-count"><span>未分配 ' + unassigned.length + ' 站</span><span>共 ' + state.tasks.length + ' 站</span></div>' +
      vehicles.map(function (v) {
        var route = ((state.result && state.result.routes) || []).filter(function (r) { return r.vehicleId === v.id; })[0] || null;
        var stops = route ? route.stops : [];
        return '<section class="manual-vehicle" style="--vc:' + esc(v.color) + '">' +
          '<div class="manual-vehicle-head">' +
            '<span class="route-color" style="background:' + esc(v.color) + '"></span>' +
            '<div class="manual-vehicle-title"><strong>' + esc(v.plateNo || '未填车牌') + '</strong><span>' + esc(v.driverName || '未填司机') + ' · ' + stops.length + ' 站</span></div>' +
          '</div>' +
          (stops.length ? '<div class="manual-stops">' + stops.map(function (s, i) { return manualStopHtml(state, v, s, i); }).join('') + '</div>' : '<div class="manual-empty">暂未分配</div>') +
          '<div class="manual-add-row">' + manualAddSelectHtml(state, v) + '</div>' +
        '</section>';
      }).join('');
  }

  function handleEditRoutes() {
    var state = Store.getState();
    if (!state.result) {
      toast('请先生成派车结果', 'warn');
      return;
    }
    openModal('手动调整路线',
      '<div class="manual-edit-body">' + manualEditModalBody(state) + '</div>',
      {
        className: 'manual-route-modal',
        footer: '<button type="button" class="btn btn-primary" data-action="modal-cancel">完成</button>'
      }
    );
  }

  function refreshManualModal() {
    var body = $('#modal-root .manual-edit-body');
    if (!body) return;
    body.innerHTML = manualEditModalBody(Store.getState());
  }

  function commitManualResult(next) {
    var state = Store.getState();
    if (!state.result) return;
    next.generatedAt = state.result.generatedAt;
    Store.setResult(next);
    refreshManualModal();
    rebuildResultTiming();
  }

  function handleManualMove(vehicleId, taskId, delta) {
    var state = Store.getState();
    if (!state.result) return;
    var next = cloneResult(state.result);
    var route = next.routes.filter(function (r) { return r.vehicleId === vehicleId; })[0];
    if (!route) return;
    var idx = route.stops.findIndex(function (s) { return s.taskId === taskId; });
    if (idx < 0) return;
    var to = idx + delta;
    if (to < 0 || to >= route.stops.length) return;
    var stop = route.stops.splice(idx, 1)[0];
    route.stops.splice(to, 0, stop);
    commitManualResult(next);
  }

  function handleManualRemove(vehicleId, taskId) {
    var state = Store.getState();
    if (!state.result) return;
    var next = cloneResult(state.result);
    var route = next.routes.filter(function (r) { return r.vehicleId === vehicleId; })[0];
    if (!route) return;
    var idx = route.stops.findIndex(function (s) { return s.taskId === taskId; });
    if (idx < 0) return;
    route.stops.splice(idx, 1);
    if (!route.stops.length) next.routes = next.routes.filter(function (r) { return r.vehicleId !== vehicleId; });
    commitManualResult(next);
  }

  function handleManualAdd(vehicleId, taskId) {
    if (!vehicleId || !taskId) return;
    var state = Store.getState();
    if (!state.result) return;
    if (assignedTaskIds(state.result)[taskId]) {
      toast('该站点已分配', 'warn');
      refreshManualModal();
      return;
    }
    var vehicle = vehicleById(state, vehicleId);
    var task = taskById(state, taskId);
    if (!vehicle) return;
    if (!task || task.lng == null || task.lat == null) {
      toast('该站点尚未定位', 'warn');
      return;
    }
    var next = cloneResult(state.result);
    var route = next.routes.filter(function (r) { return r.vehicleId === vehicleId; })[0];
    if (!route) {
      route = {
        vehicleId: vehicle.id,
        label: vehicle.plateNo || '车辆',
        plateNo: vehicle.plateNo || '',
        driverName: vehicle.driverName || '',
        driverPhone: vehicle.driverPhone || '',
        color: vehicle.color || '#2563EB',
        stops: []
      };
      next.routes.push(route);
    }
    route.stops.push({ taskId: taskId });
    commitManualResult(next);
  }

  function handleManualRouteButton(btn) {
    var vehicleId = btn.getAttribute('data-vehicle-id');
    var taskId = btn.getAttribute('data-task-id');
    var mode = btn.getAttribute('data-route-edit');
    if (mode === 'up') handleManualMove(vehicleId, taskId, -1);
    else if (mode === 'down') handleManualMove(vehicleId, taskId, 1);
    else if (mode === 'remove') handleManualRemove(vehicleId, taskId);
  }

  function rebuildResultTiming() {
    var snapshot = Store.getState();
    var result = snapshot.result;
    var start = snapshot.settings.start;
    if (!result || !start) return;
    var token = ++routeRebuildToken;
    var routes = JSON.parse(JSON.stringify(result.routes));
    var planTasks = snapshot.tasks.map(function (t) {
      return {
        id: t.id,
        shopName: t.shopName,
        address: t.address,
        lng: t.lng,
        lat: t.lat,
        deadline: t.deadline,
        deadlineMin: Planning.minutes(t.deadline)
      };
    });
    Promise.all(routes.filter(function (r) {
      return r.stops && r.stops.length;
    }).map(function (r) {
      var points = [start].concat(r.stops.map(function (s) {
        var t = taskById(snapshot, s.taskId);
        return t && t.lng != null && t.lat != null ? { lng: t.lng, lat: t.lat } : null;
      }).filter(Boolean));
      if (points.length < 2) return Promise.resolve([]);
      return Geo.routeLegs(points).then(function (legs) { r.legs = legs; });
    })).then(function () {
      if (token !== routeRebuildToken) return;
      var latest = Store.getState();
      var next = Planning.applyRealLegs({ routes: routes }, {
        tasks: planTasks,
        defaultStartTime: latest.settings.defaultStartTime,
        stopMinutes: latest.settings.stopMinutes
      });
      next.generatedAt = result.generatedAt;
      Store.setResult(next);
    }).catch(function (err) {
      if (token !== routeRebuildToken) return;
      toast(err && err.message ? err.message : '路线重算失败', 'error');
    });
  }

  function handleExportJSON() {
    var payload = Store.exportJSON();
    var blob = new Blob([payload], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dispatch-data-' + Store.todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('数据已导出', 'success');
  }

  function handleExportRoutesExcel(vehicleId) {
    var state = Store.getState();
    try {
      ExcelImport.downloadRoutes(state, vehicleId || '');
      toast('路线 Excel 已导出', 'success');
    } catch (err) {
      toast(err && err.message ? err.message : '路线导出失败', 'error');
    }
  }

  function handleImport() {
    openModal('导入任务数据',
      '<div class="import-tabs" role="tablist">' +
        '<button type="button" class="import-tab is-active" data-import-tab="excel" role="tab">Excel 导入</button>' +
        '<button type="button" class="import-tab" data-import-tab="json" role="tab">JSON 粘贴</button>' +
      '</div>' +
      '<div class="import-pane is-active" data-import-pane="excel">' +
        '<div class="import-drop" id="import-drop" role="button" tabindex="0">' +
          icon('file-spreadsheet', 'drop-ico') +
          '<span class="drop-title">选择 Excel 文件</span>' +
          '<span class="drop-hint">支持 .xlsx / .xls / .csv，自动识别带表头格式，也支持“序号 / 店名 / 地址”三列简表</span>' +
          '<span class="btn btn-ghost btn-sm drop-btn">选择文件</span>' +
        '</div>' +
        '<input type="file" id="import-excel-file" accept=".xlsx,.xls,.csv" hidden>' +
        '<div id="import-excel-preview" class="import-preview"></div>' +
      '</div>' +
      '<div class="import-pane" data-import-pane="json">' +
        '<p class="confirm-text">粘贴任务、车辆和设置 JSON，导入后会覆盖当前数据。</p>' +
        '<textarea id="import-json-input" class="input import-input" placeholder="{ &quot;tasks&quot;: [], &quot;vehicles&quot;: [] }"></textarea>' +
      '</div>',
      {
        footer:
          '<button type="button" class="btn btn-ghost" data-action="modal-cancel">取消</button>' +
          '<button type="button" class="btn btn-ghost" data-action="import-template">下载模板</button>' +
          '<button type="button" class="btn btn-primary" data-action="import-ok">确认导入</button>'
      }
    );

    var root = $('#modal-root');
    var excelPayload = null;

    $$('[data-import-tab]', root).forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-import-tab');
        $$('[data-import-tab]', root).forEach(function (t) {
          t.classList.toggle('is-active', t === tab);
        });
        $$('[data-import-pane]', root).forEach(function (p) {
          p.classList.toggle('is-active', p.getAttribute('data-import-pane') === key);
        });
      });
    });

    var fileInput = $('#import-excel-file', root);
    var drop = $('#import-drop', root);
    if (fileInput) fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleExcelFile(fileInput.files[0], applyExcelResult);
    });
    if (drop) {
      drop.addEventListener('click', function () { if (fileInput) fileInput.click(); });
      drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (fileInput) fileInput.click();
        }
      });
      drop.addEventListener('dragover', function (e) {
        e.preventDefault();
        drop.classList.add('is-drag');
      });
      drop.addEventListener('dragleave', function () {
        drop.classList.remove('is-drag');
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-drag');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleExcelFile(file, applyExcelResult);
      });
    }

    var templateBtn = root.querySelector('[data-action="import-template"]');
    if (templateBtn) templateBtn.addEventListener('click', function () {
      try {
        ExcelImport.downloadTemplate();
      } catch (err) {
        toast(err && err.message ? err.message : '下载模板失败', 'error');
      }
    });

    var ok = root.querySelector('[data-action="import-ok"]');
    if (ok) ok.addEventListener('click', function () {
      var activeTab = root.querySelector('[data-import-tab].is-active');
      var mode = activeTab ? activeTab.getAttribute('data-import-tab') : 'excel';
      if (mode === 'json') {
        var ta = $('#import-json-input');
        var text = (ta && ta.value || '').trim();
        if (!text) {
          toast('请粘贴 JSON 数据', 'warn');
          return;
        }
        try {
          Store.importJSON(text);
          closeModal();
          toast('导入成功', 'success');
        } catch (err) {
          toast(err && err.message ? err.message : '导入失败', 'error');
        }
      } else {
        var preview = $('#import-excel-preview');
        excelPayload = preview ? preview._payload : null;
        if (!excelPayload) {
          toast('请先选择 Excel 文件', 'warn');
          return;
        }
        if (!excelPayload.tasks.length) {
          toast('文件中没有可导入的任务', 'error');
          return;
        }
        try {
          Store.importExcelData(excelPayload);
          closeModal();
          toast('导入成功：' + excelPayload.tasks.length + ' 个收货点', 'success');
        } catch (err) {
          toast(err && err.message ? err.message : '导入失败', 'error');
        }
      }
    });

    function applyExcelResult(err, result, fileName) {
      var preview = $('#import-excel-preview');
      if (err) {
        excelPayload = null;
        if (preview) {
          preview.innerHTML = '';
          delete preview._payload;
        }
        toast(err && err.message ? err.message : '解析文件失败', 'error');
        return;
      }
      excelPayload = result;
      if (preview) preview._payload = result;
      renderExcelPreview(preview, result, fileName);
    }
  }

  function handleExcelFile(file, done) {
    if (file.size > 10 * 1024 * 1024) {
      toast('文件超过 10MB，请拆分后再导入', 'error');
      return;
    }
    var preview = $('#import-excel-preview');
    var drop = $('#import-drop');
    if (drop) {
      drop.classList.remove('is-drag');
      var title = drop.querySelector('.drop-title');
      if (title) title.textContent = file.name;
    }
    if (preview) preview.innerHTML = '<p class="import-loading">正在解析...</p>';
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var result = ExcelImport.parse(reader.result);
        if (done) done(null, result, file.name);
      } catch (err) {
        if (done) done(err);
      }
    };
    reader.onerror = function () {
      if (done) done(new Error('读取文件失败'));
    };
    reader.readAsArrayBuffer(file);
  }

  function renderExcelPreview(container, result, fileName) {
    if (!container) return;
    var warnings = result.warnings || [];
    var html = '<div class="preview-summary">' +
      '<strong>' + esc(fileName) + '</strong>' +
      '<span>识别到 ' + result.tasks.length + ' 个收货点' +
        (result.vehicles && result.vehicles.length ? '，' + result.vehicles.length + ' 辆车' : '，车辆保持不变') +
        (warnings.length ? '，' + warnings.length + ' 条提醒' : '') +
      '</span>' +
    '</div>' +
    '<div class="preview-list">' +
      result.tasks.slice(0, 5).map(function (t, i) {
        return '<div class="preview-item"><span>' + esc(t.shopName || ('收货点 ' + (i + 1))) + '</span><p>' + esc(t.address) + '</p></div>';
      }).join('') +
      (result.tasks.length > 5 ? '<p class="preview-more">共 ' + result.tasks.length + ' 个收货点</p>' : '') +
    '</div>' +
    (warnings.length ? '<div class="preview-notes">' +
      warnings.slice(0, 4).map(function (w) { return '<p>' + esc(w) + '</p>'; }).join('') +
    '</div>' : '');
    container.innerHTML = html;
  }

  function renderApp() {
    var state = Store.getState();
    var route = currentRoute();
    var pageHtml = route === 'driver' ? driverPage(state)
      : route === 'vehicles' ? vehiclesPage(state)
      : route === 'settings' ? settingsPage(state)
      : dispatcherPage(state);
    $('#app').innerHTML = topbar() + '<main class="page">' + pageHtml + '</main>' + bottomNav();
    refreshIcons();
    renderMapIfNeeded();
    if (aiChat.pendingScroll && route === 'dispatcher') {
      aiChat.pendingScroll = false;
      setTimeout(function () {
        var box = $('#ai-chat-messages');
        if (box) box.scrollTop = box.scrollHeight;
      }, 0);
    }
  }

  var suggestTimer = null;
  var suggestEl = null;
  var suppressSuggestionChangeUntil = 0;
  var suppressSuggestionInput = null;

  function closeSuggest() {
    if (suggestTimer) {
      clearTimeout(suggestTimer);
      suggestTimer = null;
    }
    if (suggestEl && suggestEl.parentNode) suggestEl.parentNode.removeChild(suggestEl);
    suggestEl = null;
  }

  function scheduleSuggest(input) {
    closeSuggest();
    var q = input.value.trim();
    if (!q) return;
    suggestTimer = setTimeout(function () {
      Geo.autocomplete(q).then(function (items) {
        if (document.activeElement !== input) return;
        var wrap = input.closest('.ac-wrap');
        if (!wrap) return;
        var list = el('<div class="suggest-list" role="listbox"></div>');
        items.forEach(function (it) {
          var item = el('<button type="button" class="suggestion-item" role="option"></button>');
          item.innerHTML = '<span>' + esc(it.name) + '</span><small>' + esc(it.address) + '</small>';
          item.dataset.suggestType = input.matches('.task-address') ? 'task' : 'loc';
          item.dataset.suggestKey = input.matches('.task-address')
            ? (input.closest('.task-card') ? input.closest('.task-card').getAttribute('data-task-id') : '')
            : input.getAttribute('data-loc-key');
          item.dataset.lng = it.lng;
          item.dataset.lat = it.lat;
          item.dataset.name = it.name;
          item.dataset.address = it.address || it.name;
          list.appendChild(item);
        });
        wrap.appendChild(list);
        suggestEl = list;
      });
    }, 220);
  }

  function applySuggestion(item) {
    var type = item.getAttribute('data-suggest-type');
    var lng = Number(item.getAttribute('data-lng'));
    var lat = Number(item.getAttribute('data-lat'));
    var name = item.getAttribute('data-name') || '';
    var address = item.getAttribute('data-address') || name;
    var key = item.getAttribute('data-suggest-key');
    closeSuggest();
    if (!isFinite(lng) || !isFinite(lat)) return;
    if (type === 'task') {
      if (key) Store.updateTask(key, { shopName: name, address: address, lng: lng, lat: lat });
    } else {
      var patch = {};
      if (key === 'end') {
        patch.endAddr = address;
        patch.end = { lng: lng, lat: lat };
      } else {
        patch.startAddr = address;
        patch.start = { lng: lng, lat: lat };
      }
      Store.updateSettings(patch);
    }
  }

  function applySuggestionItem(item) {
    var wrap = item.closest('.ac-wrap');
    var input = wrap ? wrap.querySelector('input') : null;
    suppressSuggestionChangeUntil = Date.now() + 600;
    suppressSuggestionInput = input;
    applySuggestion(item);
  }

  function onDocInput(e) {
    var input = e.target;
    if (input.matches && (input.matches('.task-address') || input.matches('[data-loc-key]'))) {
      scheduleSuggest(input);
    }
    if (input.matches && input.matches('[data-settings-key]') && input.type === 'range') {
      input.style.setProperty('--range-fill', input.value + '%');
      var valEl = input.closest('.field') ? input.closest('.field').querySelector('.range-value') : null;
      if (valEl) valEl.textContent = input.value + '%';
    }
  }

  function scheduleBalanceRerun() {
    if (balanceRerunTimer) clearTimeout(balanceRerunTimer);
    balanceRerunTimer = setTimeout(function () {
      balanceRerunTimer = null;
      if (dispatchBusy) {
        scheduleBalanceRerun();
        return;
      }
      if (!Store.getState().tasks.length) return;
      handleDispatch();
    }, 600);
  }

  function onDocChange(e) {
    var target = e.target;
    if (!target.matches) return;
    if (target.matches('[data-route-edit="add"]')) {
      var addVehicleId = target.getAttribute('data-vehicle-id');
      var addTaskId = target.value;
      target.value = '';
      if (addTaskId) handleManualAdd(addVehicleId, addTaskId);
      return;
    }
    var card = target.closest('.task-card');
    if (card && target.matches('[data-field]')) {
      var field = target.getAttribute('data-field');
      if (field === 'address' &&
          Date.now() < suppressSuggestionChangeUntil &&
          target === suppressSuggestionInput) {
        return;
      }
      var patch = {};
      patch[field] = target.value;
      if (field === 'address') {
        var currentTask = taskById(Store.getState(), card.getAttribute('data-task-id'));
        if (!currentTask || target.value !== currentTask.address) {
          patch.lng = null;
          patch.lat = null;
          patch.locLevel = '';
          patch.locSource = '';
        }
      }
      Store.updateTask(card.getAttribute('data-task-id'), patch);
      return;
    }
    if (target.matches('[data-loc-key]')) {
      if (Date.now() < suppressSuggestionChangeUntil &&
          target === suppressSuggestionInput) {
        return;
      }
      var key = target.getAttribute('data-loc-key');
      var lp = {};
      lp[key + 'Addr'] = target.value;
      lp[key] = null;
      Store.updateSettings(lp);
      return;
    }
    if (target.matches('[data-settings-key]')) {
      var sp = {};
      sp[target.getAttribute('data-settings-key')] =
        target.type === 'checkbox' ? target.checked
        : (target.type === 'number' ? Number(target.value) : target.value);
      Store.updateSettings(sp);
      var settingsKey = target.getAttribute('data-settings-key');
      if (settingsKey === 'balanceLevel' || settingsKey === 'roundTrip') scheduleBalanceRerun();
      return;
    }
    if (target.matches('[data-active-vehicle]')) {
      toggleActiveVehicle(target.getAttribute('data-active-vehicle'), target.checked);
      return;
    }
    var vehCard = target.closest('.veh-card');
    if (vehCard && target.matches('[data-vehicle-field]')) {
      var vp = {};
      vp[target.getAttribute('data-vehicle-field')] = target.value;
      Store.updateVehicle(vehCard.getAttribute('data-vehicle-id'), vp);
      return;
    }
    if (target.matches('#driver-vehicle-select')) {
      selectedDriverId = target.value;
      saveDriverId(selectedDriverId);
      renderApp();
    }
  }

  function toggleActiveVehicle(id, checked) {
    var state = Store.getState();
    var ids = (state.settings.activeVehicleIds || []).slice();
    var idx = ids.indexOf(id);
    if (checked && idx < 0) ids.push(id);
    else if (!checked && idx >= 0) ids.splice(idx, 1);
    Store.updateSettings({ activeVehicleIds: ids });
  }

  function handleAddTask() {
    Store.addTask({});
    setTimeout(function () {
      var cards = $$('#app .task-card');
      if (cards.length) {
        var first = cards[cards.length - 1].querySelector('input[data-field="shopName"]');
        if (first) first.focus();
      }
    }, 0);
  }

  function handleDeleteTask(id) {
    confirmDialog('删除这个任务？', function () { Store.removeTask(id); });
  }

  function handleDeleteVehicle(id) {
    confirmDialog('删除这辆车？', function () { Store.removeVehicle(id); });
  }

  function handleLocateTask(btn) {
    var card = btn.closest('.task-card');
    if (!card) return;
    var id = card.getAttribute('data-task-id');
    var input = card.querySelector('.task-address');
    var address = (input.value || '').trim();
    if (!address) {
      toast('请先输入地址', 'warn');
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-loading');
    Geo.geocode(address).then(function (loc) {
      Store.updateTask(id, { lng: loc.lng, lat: loc.lat, locLevel: loc.level || '', locSource: 'amap' });
      var coarse = ['省', '市', '城市', '区县', '乡镇', '村庄', '道路'].indexOf(loc.level) >= 0;
      toast(coarse ? '定位成功，但只到道路/区域级，建议核对' : '定位成功', coarse ? 'warn' : 'success');
    }).catch(function (err) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      toast(err.message || '定位失败', 'error');
    });
  }

  function handleLocateAll() {
    if (locateAllBusy) return;
    var state = Store.getState();
    var pending = (state.tasks || []).filter(function (task) {
      return task.lng == null || task.lat == null;
    });
    if (!pending.length) {
      toast('全部地址已经定位，可以开始派车', 'success');
      return;
    }
    if (!Geo.isAmap()) {
      toast('请先在设置中连接高德服务，再使用一键定位', 'warn');
      return;
    }

    locateAllBusy = true;
    renderApp();
    var success = [];
    var failed = [];
    var cursor = 0;

    function worker() {
      var task = pending[cursor++];
      if (!task) return Promise.resolve();
      var address = (task.address || '').trim();
      if (!address) {
        failed.push({ task: task, message: '缺少地址' });
        return worker();
      }
      return Geo.geocode(address).then(function (loc) {
        Store.updateTask(task.id, {
          lng: loc.lng,
          lat: loc.lat,
          locLevel: loc.level || '',
          locSource: 'amap'
        });
        success.push({ task: task, level: loc.level || '' });
      }).catch(function (err) {
        failed.push({
          task: task,
          message: err && err.message ? err.message : '高德未返回坐标'
        });
      }).then(worker);
    }

    var workers = [];
    var count = Math.min(3, pending.length);
    for (var i = 0; i < count; i += 1) workers.push(worker());
    Promise.all(workers).then(function () {
      locateAllBusy = false;
      renderApp();
      var coarseCount = success.filter(function (item) {
        return ['省', '市', '城市', '区县', '乡镇', '村庄', '道路'].indexOf(item.level) >= 0;
      }).length;
      if (!failed.length) {
        toast('一键定位完成：成功 ' + success.length + ' 个' + (coarseCount ? '，其中 ' + coarseCount + ' 个仅道路/区域级，请核对' : ''), coarseCount ? 'warn' : 'success');
        return;
      }
      var names = failed.slice(0, 4).map(function (item) {
        return item.task.shopName || ('任务' + (item.task.seq || ''));
      }).join('、');
      if (failed.length > 4) names += ' 等';
      toast('已定位 ' + success.length + ' 个' + (coarseCount ? '（' + coarseCount + ' 个粗略）' : '') + '，' + failed.length + ' 个失败：' + names + '。请修正后再派车', 'warn');
    });
  }

  function handleLocateSetting(btn) {
    var key = btn.getAttribute('data-loc-key');
    var wrap = btn.closest('.ac-wrap');
    var input = wrap ? wrap.querySelector('[data-loc-key="' + key + '"]') : null;
    var address = (input && input.value || '').trim();
    if (!address) {
      toast('请先输入地址', 'warn');
      if (input) input.focus();
      return;
    }
    btn.disabled = true;
    Geo.geocode(address).then(function (loc) {
      var patch = {};
      if (key === 'end') {
        patch.endAddr = loc.formatted || address;
        patch.end = { lng: loc.lng, lat: loc.lat };
      } else {
        patch.startAddr = loc.formatted || address;
        patch.start = { lng: loc.lng, lat: loc.lat };
      }
      Store.updateSettings(patch);
      toast('定位成功', 'success');
    }).catch(function (err) {
      btn.disabled = false;
      toast(err.message || '定位失败', 'error');
    });
  }

  function handleConnectAmap() {
    var input = $('#amap-key-input');
    if (!input) return;
    var key = input.value.trim();
    var secInput = $('#amap-security-input');
    var securityCode = (secInput && secInput.value || '').trim();
    Store.updateSettings({ amapKey: key, amapSecurityCode: securityCode });
    Geo.setKey(key, securityCode).then(function (mode) {
      renderApp();
      toast(mode === 'amap' ? '高德服务已连接' : '已切换为上海离线估算', mode === 'amap' ? 'success' : 'info');
    }).catch(function (err) {
      renderApp();
      toast(err.message || '高德连接失败', 'error');
    });
  }

  function highlightMissingAddressTasks(missingIds) {
    $$('#app .task-card').forEach(function (card) {
      if (missingIds.indexOf(card.getAttribute('data-task-id')) >= 0) {
        card.classList.add('is-missing-address');
      }
    });
  }

  function prepareDispatchContext(state, settings, tasks) {
    var start = settings.start;
    var chain = Promise.resolve();

    if (!start || start.lng == null) {
      chain = chain.then(function () {
        if (!(settings.startAddr || '').trim()) throw new Error('请设置出发地');
        return Geo.geocode(settings.startAddr);
      }).then(function (loc) {
        start = { lng: loc.lng, lat: loc.lat };
        Store.updateSettings({ startAddr: loc.formatted || settings.startAddr, start: start });
      });
    }
    return chain.then(function () {
      var unlocated = tasks.filter(function (t) { return t.lng == null || t.lat == null; });
      if (!unlocated.length) return;
      var names = unlocated.slice(0, 5).map(function (t) {
        return '「' + (t.shopName || ('任务' + (t.seq || ''))) + '」';
      }).join('、');
      if (unlocated.length > 5) names += ' 等';
      throw new Error('有 ' + unlocated.length + ' 个地址尚未定位：' + names + '。请先点击“一键定位”，修正失败地址后再派车');
    }).then(function () {
      var latest = Store.getState();
      var vehicles = activeVehicles(latest);
      if (!vehicles.length) throw new Error('请至少勾选一辆车');
      if (!start) throw new Error('请设置出发地');
      var planTasks = tasks.map(function (t) {
        return {
          id: t.id,
          shopName: t.shopName,
          address: t.address,
          lng: t.lng,
          lat: t.lat,
          deadline: t.deadline,
          deadlineMin: Planning.minutes(t.deadline)
        };
      });
      var roundTrip = !!latest.settings.roundTrip;
      var end = roundTrip ? { lng: start.lng, lat: start.lat } : null;
      return {
        latest: latest,
        settings: latest.settings,
        vehicles: vehicles,
        start: start,
        end: end,
        roundTrip: roundTrip,
        planTasks: planTasks
      };
    });
  }

  function planTaskMap(planTasks) {
    var out = {};
    planTasks.forEach(function (t) { out[t.id] = t; });
    return out;
  }

  function routePoints(ctx, route) {
    var taskMap = planTaskMap(ctx.planTasks);
    var pts = [ctx.start].concat((route.stops || []).map(function (s) {
      var t = taskMap[s.taskId];
      return t ? { lng: t.lng, lat: t.lat } : null;
    }).filter(Boolean));
    if (ctx.end && ctx.end.lng != null && ctx.end.lat != null) {
      pts.push({ lng: ctx.end.lng, lat: ctx.end.lat });
    }
    return pts;
  }

  function attachDisplayLegs(routes, ctx) {
    routes.forEach(function (r) {
      var legs = Geo.demoLegs(routePoints(ctx, r));
      var waypoints = [];
      legs.forEach(function (leg) {
        (leg.path || []).forEach(function (p) {
          var last = waypoints[waypoints.length - 1];
          if (!last || Math.abs(last.lng - p.lng) > 1e-9 || Math.abs(last.lat - p.lat) > 1e-9) {
            waypoints.push(p);
          }
        });
      });
      r.legs = legs;
      r.waypoints = waypoints;
    });
    return routes;
  }

  function reorderAIRoutes(routes, ctx) {
    var taskMap = planTaskMap(ctx.planTasks);
    routes.forEach(function (r) {
      if (!r.stops || r.stops.length < 2) return;
      var routeTasks = r.stops.map(function (s) { return taskMap[s.taskId]; }).filter(Boolean);
      if (routeTasks.length !== r.stops.length) return;
      var orderedIds = Planning.optimizeRouteOrder({
        tasks: routeTasks.map(function (t) {
          return { id: t.id, lng: t.lng, lat: t.lat, deadlineMin: t.deadlineMin };
        }),
        start: ctx.start,
        end: ctx.end,
        defaultStartTime: ctx.settings.defaultStartTime,
        stopMinutes: ctx.settings.stopMinutes,
        nearbyDistanceM: ctx.settings.nearbyDistanceM
      });
      if (!orderedIds.length) return;
      var byId = {};
      r.stops.forEach(function (s) { byId[s.taskId] = s; });
      r.stops = orderedIds.map(function (id, i) {
        var s = byId[id];
        s.order = i + 1;
        return s;
      });
    });
  }

  function rebalanceAIRoutes(routes, ctx) {
    if (!routes || routes.length < 2) return;
    var taskIndex = {};
    ctx.planTasks.forEach(function (t, i) { taskIndex[t.id] = i; });
    var routeLists = routes.map(function (r) {
      return (r.stops || []).map(function (s) {
        return taskIndex[s.taskId];
      }).filter(function (i) { return i != null; });
    });
    var matrix = Planning.buildMatrix(ctx.start, ctx.planTasks, ctx.end);
    var balanced = Planning.balanceRoutesByTime(routeLists, {
      tasks: ctx.planTasks,
      matrix: matrix,
      defaultStartTime: ctx.settings.defaultStartTime,
      stopMinutes: ctx.settings.stopMinutes,
      balanceLevel: ctx.settings.balanceLevel,
      nearbyDistanceM: ctx.settings.nearbyDistanceM
    });
    routes.forEach(function (r, ri) {
      r.stops = (balanced[ri] || []).map(function (idx, order) {
        return { taskId: ctx.planTasks[idx].id, order: order + 1 };
      });
    });
  }

  function runOfflineDispatch(ctx) {
    var matrix = Planning.buildMatrix(ctx.start, ctx.planTasks, ctx.end);
    var solverOpts = {
      tasks: ctx.planTasks,
      vehicles: ctx.vehicles,
      matrix: matrix,
      defaultStartTime: ctx.settings.defaultStartTime,
      stopMinutes: ctx.settings.stopMinutes,
      balanceLevel: ctx.settings.balanceLevel,
      nearbyDistanceM: ctx.settings.nearbyDistanceM
    };
    var routes = Planning.solveSmartRoutes(solverOpts);
    routes = routes.filter(function (r) { return r.stops.length; });
    if (!routes.length) throw new Error('任务无法分配');
    return routes.reduce(function (p, r) {
      return p.then(function () {
        return Geo.routeLegs(routePoints(ctx, r)).then(function (legs) { r.legs = legs; });
      });
    }, Promise.resolve()).then(function () {
      var result = Planning.applyRealLegs({ routes: routes }, {
        tasks: ctx.planTasks,
        defaultStartTime: ctx.settings.defaultStartTime,
        stopMinutes: ctx.settings.stopMinutes
      });
      result.generatedAt = new Date().toISOString();
      Store.setResult(result);
      toast('离线均衡派车完成', 'success');
    });
  }

  function finalizeAIRoutes(routes, ctx) {
    rebalanceAIRoutes(routes, ctx);
    reorderAIRoutes(routes, ctx);
    routes = attachDisplayLegs(routes, ctx);
    return routes.reduce(function (p, r) {
      return p.then(function () {
        return Geo.routeLegs(routePoints(ctx, r)).then(function (legs) { r.legs = legs; });
      });
    }, Promise.resolve()).then(function () {
      var result = Planning.applyRealLegs({ routes: routes }, {
        tasks: ctx.planTasks,
        defaultStartTime: ctx.settings.defaultStartTime,
        stopMinutes: ctx.settings.stopMinutes
      });
      result.generatedAt = new Date().toISOString();
      Store.setResult(result);
      return result;
    });
  }

  function runAIDispatch(ctx) {
    if (!global.DeepSeekPlanner) throw new Error('DeepSeek 模块未加载，请刷新页面后重试');
    var startMin = Planning.minutes(ctx.settings.defaultStartTime);
    if (startMin == null) startMin = 480;

    return DeepSeekPlanner.plan({
      apiKey: ctx.settings.deepseekKey,
      defaultStartTime: ctx.settings.defaultStartTime,
      defaultStartMin: startMin,
      stopMinutes: ctx.settings.stopMinutes,
      roundTrip: ctx.roundTrip,
      start: ctx.start,
      end: ctx.end,
      vehicles: ctx.vehicles,
      tasks: ctx.planTasks
    }).then(function (plan) {
      return finalizeAIRoutes(plan.routes || [], ctx).then(function () {
        toast('AI 派车完成', 'success');
      });
    });
  }

  function startDispatch(mode) {
    if (dispatchBusy) return;
    var state = Store.getState();
    var settings = state.settings;
    if (!state.tasks.length) {
      toast('请先添加任务', 'warn');
      return;
    }
    var missingAddressTasks = state.tasks.filter(function (t) {
      return (t.lng == null || t.lat == null) && !(t.address || '').trim();
    });
    if (missingAddressTasks.length) {
      var names = missingAddressTasks.slice(0, 5).map(function (t) {
        return '「' + (t.shopName || ('任务' + (t.seq || ''))) + '」';
      }).join('、');
      if (missingAddressTasks.length > 5) names += ' 等';
      toast('有 ' + missingAddressTasks.length + ' 个任务缺少地址：' + names, 'error');
      highlightMissingAddressTasks(missingAddressTasks.map(function (t) { return t.id; }));
      return;
    }
    dispatchBusy = true;
    dispatchBusyMode = mode;
    renderApp();
    prepareDispatchContext(state, settings, state.tasks.slice()).then(function (ctx) {
      if (mode === 'ai') {
        return runAIDispatch(ctx).catch(function (err) {
          toast('AI 派车失败，已改用离线算法：' + (err && err.message ? err.message : '未知错误'), 'warn');
          return runOfflineDispatch(ctx);
        });
      }
      return runOfflineDispatch(ctx);
    }).catch(function (err) {
      toast(err && err.message ? err.message : '派车失败', 'error');
    }).then(function () {
      dispatchBusy = false;
      dispatchBusyMode = null;
      renderApp();
    });
  }

  function handleDispatch() {
    startDispatch('offline');
  }

  function handleAIDispatch() {
    startDispatch('ai');
  }

  function chatCurrentRoutes(state) {
    return (state && state.result && state.result.routes || []).map(function (r) {
      return {
        vehicleId: r.vehicleId,
        label: r.label || '',
        stops: (r.stops || []).map(function (s) {
          return { taskId: s.taskId, order: s.order };
        })
      };
    });
  }

  function runAiChatTurn(message) {
    var state = Store.getState();
    var startMin = Planning.minutes(state.settings.defaultStartTime);
    if (startMin == null) startMin = 480;
    return prepareDispatchContext(state, state.settings, state.tasks.slice()).then(function (ctx) {
      if (!global.DeepSeekChat) throw new Error('DeepSeek 对话模块未加载，请刷新页面后重试');
      return DeepSeekChat.chat({
        apiKey: ctx.settings.deepseekKey,
        defaultStartTime: ctx.settings.defaultStartTime,
        defaultStartMin: startMin,
        stopMinutes: ctx.settings.stopMinutes,
        start: ctx.start,
        end: ctx.end,
        roundTrip: ctx.roundTrip,
        vehicles: ctx.vehicles,
        tasks: ctx.planTasks,
        currentRoutes: chatCurrentRoutes(Store.getState()),
        history: aiChat.messages.slice(0, -1),
        message: message
      }).then(function (res) {
        var candidate = aiChatCandidateFromRoutes(res.routes || []);
        addAiChatMessage('assistant', res.reply || '方案已生成，确认后即可采用', candidate);
        return candidate;
      });
    });
  }

  function finishAiChatTurn() {
    aiChat.busy = false;
    aiChat.pendingScroll = true;
    renderApp();
  }

  function applyAiChatCandidate(candidate) {
    var state = Store.getState();
    if (!candidate || !candidate.routes || !candidate.routes.length) {
      return Promise.reject(new Error('当前没有可采用的候选方案'));
    }
    return prepareDispatchContext(state, state.settings, state.tasks.slice()).then(function (ctx) {
      var taskIds = {};
      ctx.planTasks.forEach(function (t) { taskIds[t.id] = true; });
      var used = {};
      var valid = candidate.routes.every(function (r) {
        return (r.stops || []).every(function (s) {
          if (!taskIds[s.taskId] || used[s.taskId]) return false;
          used[s.taskId] = true;
          return true;
        });
      });
      if (!valid || Object.keys(used).length !== ctx.planTasks.length) {
        throw new Error('任务已变化，候选方案已失效，请让 AI 重新生成');
      }
      return finalizeAIRoutes(JSON.parse(JSON.stringify(candidate.routes)), ctx).then(function () {
        addAiChatMessage('assistant', '已采用这套方案，路线时间已按实际里程重新计算。', null);
        toast('AI 方案已采用', 'success');
      });
    });
  }

  function aiChatLooksAgree(text) {
    if (!aiChat.candidate) return false;
    return /(同意|采用|就这样|没问题|可以|确认|好的|ok\b)/i.test(text || '');
  }

  function handleAiChatSend() {
    var input = $('#ai-chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    if (aiChat.busy) {
      toast('AI 正在处理，请稍候', 'warn');
      return;
    }
    if (!Store.getState().settings.deepseekKey) {
      addAiChatMessage('user', text);
      addAiChatMessage('assistant', '请先在设置里填写 DeepSeek API Key，才能开始 AI 调度对话。', null);
      renderApp();
      return;
    }
    addAiChatMessage('user', text);
    if (aiChatLooksAgree(text)) {
      var candidate = aiChat.candidate;
      aiChat.busy = true;
      renderApp();
      applyAiChatCandidate(candidate).catch(function (err) {
        addAiChatMessage('assistant', '采用失败：' + (err && err.message ? err.message : '未知错误'), null);
        toast('采用失败', 'error');
      }).then(finishAiChatTurn);
      return;
    }
    aiChat.busy = true;
    renderApp();
    runAiChatTurn(text).catch(function (err) {
      addAiChatMessage('assistant', 'AI 没有生成可用方案：' + (err && err.message ? err.message : '未知错误') + '。可以改用“AI 派车”或“离线均衡派车”。', null);
      toast('AI 对话失败', 'error');
    }).then(finishAiChatTurn);
  }

  function handleAiChatReplan() {
    if (aiChat.busy) return;
    if (!Store.getState().settings.deepseekKey) {
      addAiChatMessage('assistant', '请先在设置里填写 DeepSeek API Key，才能开始 AI 调度对话。', null);
      renderApp();
      return;
    }
    addAiChatMessage('user', '请重新生成一版完整方案，尽量就近合车并让各车完工时间接近。');
    aiChat.busy = true;
    renderApp();
    runAiChatTurn('重新生成一版完整方案，不要沿用旧路线，尽量 5 公里内就近合车，并让各车完工时间接近。')
      .catch(function (err) {
        addAiChatMessage('assistant', 'AI 没有生成可用方案：' + (err && err.message ? err.message : '未知错误') + '。可以改用“AI 派车”或“离线均衡派车”。', null);
        toast('AI 对话失败', 'error');
      }).then(finishAiChatTurn);
  }

  function handleAiChatApply() {
    if (aiChat.busy || !aiChat.candidate) {
      if (!aiChat.candidate) toast('当前没有候选方案，先让 AI 生成一版', 'warn');
      return;
    }
    addAiChatMessage('user', '采用这套方案。');
    aiChat.busy = true;
    renderApp();
    applyAiChatCandidate(aiChat.candidate).catch(function (err) {
      addAiChatMessage('assistant', '采用失败：' + (err && err.message ? err.message : '未知错误'), null);
      toast('采用失败', 'error');
    }).then(finishAiChatTurn);
  }

  function handleAiChatClear() {
    confirmDialog('清空 AI 调度对话？', function () {
      aiChat.messages = [];
      aiChat.candidate = null;
      aiChat.pendingScroll = true;
      saveAiChat();
      renderApp();
    });
  }

  function startSpeech(btn) {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) {
      toast('当前浏览器不支持语音输入', 'warn');
      return;
    }
    var wrap = btn.closest('.loc-input');
    var input = wrap ? wrap.querySelector('input') : null;
    if (!input) return;
    var rec = new SR();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    btn.classList.add('is-listening');
    rec.onresult = function (ev) {
      var text = ev.results[0][0].transcript || '';
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      toast('语音已填入', 'success');
    };
    rec.onerror = function () {
      btn.classList.remove('is-listening');
      toast('语音识别失败', 'error');
    };
    rec.onend = function () {
      btn.classList.remove('is-listening');
    };
    try {
      rec.start();
    } catch (err) {
      btn.classList.remove('is-listening');
      toast('语音启动失败', 'error');
    }
  }

  function onDocClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var sugg = t.closest('.suggestion-item');
    if (sugg) {
      applySuggestionItem(sugg);
      return;
    }
    var speechBtn = t.closest('.speech-btn');
    if (speechBtn) {
      startSpeech(speechBtn);
      return;
    }
    var manualBtn = t.closest('[data-route-edit]');
    if (manualBtn && ['up', 'down', 'remove'].indexOf(manualBtn.getAttribute('data-route-edit')) >= 0) {
      handleManualRouteButton(manualBtn);
      return;
    }
    var mapZoomBtn = t.closest('[data-map-zoom]');
    if (mapZoomBtn) {
      handleMapZoom(mapZoomBtn.closest('.map-host, .map-expanded-host'), mapZoomBtn.getAttribute('data-map-zoom'));
      return;
    }
    var actionEl = t.closest('[data-action]');
    if (!actionEl) {
      if (!t.closest('.ac-wrap')) closeSuggest();
      return;
    }
    var action = actionEl.getAttribute('data-action');
    if (action === 'add-task') {
      handleAddTask();
    } else if (action === 'delete-task') {
      var card = actionEl.closest('.task-card');
      if (card) handleDeleteTask(card.getAttribute('data-task-id'));
    } else if (action === 'clear-tasks') {
      confirmDialog('清空今天的全部任务？', function () { Store.clearTasks(); });
    } else if (action === 'load-demo') {
      confirmDialog('加载示例任务并替换当前任务？', function () { Store.loadDemo(); });
    } else if (action === 'export-json') {
      handleExportJSON();
    } else if (action === 'export-routes-excel') {
      handleExportRoutesExcel(actionEl.getAttribute('data-vehicle-id'));
    } else if (action === 'import') {
      handleImport();
    } else if (action === 'locate-all') {
      handleLocateAll();
    } else if (action === 'dispatch') {
      handleDispatch();
    } else if (action === 'ai-dispatch') {
      handleAIDispatch();
    } else if (action === 'ai-chat-send') {
      handleAiChatSend();
    } else if (action === 'ai-chat-replan') {
      handleAiChatReplan();
    } else if (action === 'ai-chat-apply') {
      handleAiChatApply();
    } else if (action === 'ai-chat-clear') {
      handleAiChatClear();
    } else if (action === 'expand-map') {
      handleExpandMap();
    } else if (action === 'edit-routes') {
      handleEditRoutes();
    } else if (action === 'locate') {
      handleLocateTask(actionEl);
    } else if (action === 'locate-setting') {
      handleLocateSetting(actionEl);
    } else if (action === 'clear-result') {
      confirmDialog('清除当前排班结果？', function () { Store.clearResult(); });
    } else if (action === 'add-vehicle') {
      Store.addVehicle({});
      setTimeout(function () {
        var cards = $$('#app .veh-card');
        if (cards.length) {
          var first = cards[cards.length - 1].querySelector('[data-vehicle-field="plateNo"]');
          if (first) first.focus();
        }
      }, 0);
    } else if (action === 'delete-vehicle') {
      var vehCard = actionEl.closest('.veh-card');
      if (vehCard) handleDeleteVehicle(vehCard.getAttribute('data-vehicle-id'));
    } else if (action === 'connect-amap') {
      handleConnectAmap();
    }
  }

  selectedDriverId = loadDriverId();
  document.addEventListener('statechange', renderApp);
  window.addEventListener('hashchange', renderApp);
  document.addEventListener('pointerdown', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var sugg = t.closest('.suggestion-item');
    if (sugg) {
      e.preventDefault();
      applySuggestionItem(sugg);
    }
  });
  document.addEventListener('click', onDocClick);
  document.addEventListener('input', onDocInput);
  document.addEventListener('change', onDocChange);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'ai-chat-input') {
      e.preventDefault();
      handleAiChatSend();
    }
  });

  connectSavedAmapKey();
  renderApp();
})(window);
