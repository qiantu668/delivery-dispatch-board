(function (global) {
  'use strict';

  // sync and validation layer
  // patch format check

  var LS_TASKS = 'dispatch.tasks.v1';
  var LS_VEHICLES = 'dispatch.vehicles.v1';
  var LS_SETTINGS = 'dispatch.settings.v1';
  var LS_RESULT = 'dispatch.result.v1';

  var FIXED_START_ADDR = '上海市奉贤区金汇镇沿浦公路2389号12仓3号';
  var FIXED_START = { lng: 121.541458, lat: 30.980046 };

  var DEFAULT_VEHICLES = [
    { id: 'v1', plateNo: '沪A·7G5D2', driverName: '陈师傅', driverPhone: '13800000001', color: '#2563EB' },
    { id: 'v2', plateNo: '沪A·2K8M9', driverName: '林师傅', driverPhone: '13800000002', color: '#0D9488' },
    { id: 'v3', plateNo: '沪A·9P3Q6', driverName: '王师傅', driverPhone: '13800000003', color: '#F59E0B' },
    { id: 'v4', plateNo: '沪A·5R1T8', driverName: '赵师傅', driverPhone: '13800000004', color: '#7C3AED' }
  ];

  var DEMO_TASKS = [
    { id: 't1', seq: 1, shopName: '人民广场便利店', phone: '13900000001', address: '上海市黄浦区人民广场', lng: 121.4737, lat: 31.2304, deadline: '09:00', note: '放冰箱冷藏柜' },
    { id: 't2', seq: 2, shopName: '静安寺专柜', phone: '13900000002', address: '上海市静安区南京西路静安寺', lng: 121.4457, lat: 31.2231, deadline: '09:30', note: '联系前台搬货' },
    { id: 't3', seq: 3, shopName: '徐家汇广场', phone: '13900000003', address: '上海市徐汇区徐家汇', lng: 121.4368, lat: 31.1883, deadline: '', note: '放门口就行' },
    { id: 't4', seq: 4, shopName: '虹桥枢纽门店', phone: '13900000004', address: '上海市闵行区虹桥路', lng: 121.3270, lat: 31.1979, deadline: '10:30', note: '北门收货区' },
    { id: 't5', seq: 5, shopName: '陆家嘴来福士', phone: '13900000005', address: '上海市浦东新区陆家嘴环路', lng: 121.4998, lat: 31.2397, deadline: '11:00', note: '地下车库卸货' },
    { id: 't6', seq: 6, shopName: '五角场商业街', phone: '13900000006', address: '上海市杨浦区五角场', lng: 121.5137, lat: 31.3008, deadline: '', note: '' },
    { id: 't7', seq: 7, shopName: '松江大学城门店', phone: '13900000007', address: '上海市松江区文汇路', lng: 121.2216, lat: 31.0545, deadline: '08:45', note: '早高峰，提前联系' },
    { id: 't8', seq: 8, shopName: '张江配送点', phone: '13900000008', address: '上海市浦东新区张江路', lng: 121.6084, lat: 31.2079, deadline: '', note: '东门岗亭旁' }
  ];

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function defaultSettings() {
    return {
      startAddr: FIXED_START_ADDR,
      start: { lng: FIXED_START.lng, lat: FIXED_START.lat },
      endAddr: '',
      end: null,
      stopMinutes: 10,
      defaultStartTime: '08:00',
      balanceLevel: 70,
      dispatchMode: 'balanced',
      roundTrip: false,
      nearbyDistanceM: 5000,
      activeVehicleIds: DEFAULT_VEHICLES.map(function (v) { return v.id; }),
      amapKey: '',
      amapSecurityCode: '',
      deepseekKey: '',
      dateKey: todayKey(),
      updatedAt: Date.now(),
      changedAt: 0
    };
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function mergeSettings(base, patch) {
    var out = Object.assign({}, base, patch || {});
    out.stopMinutes = clampInt(out.stopMinutes, 1, 120, 10);
    out.balanceLevel = clampInt(out.balanceLevel, 0, 100, 70);
    out.dispatchMode = out.dispatchMode === 'nearby' ? 'nearby' : 'balanced';
    out.roundTrip = !!out.roundTrip;
    out.nearbyDistanceM = clampInt(out.nearbyDistanceM, 5000, 30000, 5000);
    if (out.nearbyDistanceM === 15000) out.nearbyDistanceM = 5000;
    out.deepseekKey = sanitizeText(out.deepseekKey, 200);
    out.activeVehicleIds = Array.isArray(out.activeVehicleIds) ? out.activeVehicleIds : [];
    return out;
  }

  function clampInt(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function sanitizeText(v, max) {
    return String(v == null ? '' : v).slice(0, max || 200);
  }

  function sanitizeColor(v) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : '#2563EB';
  }

  function numOr(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function sanitizeVehicle(raw, index) {
    raw = raw || {};
    return {
      id: sanitizeText(raw.id || 'v-' + Date.now().toString(36) + '-' + index, 40),
      plateNo: sanitizeText(raw.plateNo, 20),
      driverName: sanitizeText(raw.driverName, 30),
      driverPhone: sanitizeText(raw.driverPhone, 30),
      color: sanitizeColor(raw.color)
    };
  }

  function sanitizeTask(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var lng = raw.lng == null ? null : Number(raw.lng);
    var lat = raw.lat == null ? null : Number(raw.lat);
    var hasLoc = lng != null && lat != null && isFinite(lng) && isFinite(lat) && !(lng === 0 && lat === 0);
    return {
      id: sanitizeText(raw.id || 't-' + Date.now().toString(36) + '-' + index, 40),
      seq: clampInt(raw.seq, 1, 9999, index + 1),
      shopName: sanitizeText(raw.shopName, 40),
      phone: sanitizeText(raw.phone, 30),
      address: sanitizeText(raw.address, 160),
      lng: hasLoc ? Math.round(lng * 1e6) / 1e6 : null,
      lat: hasLoc ? Math.round(lat * 1e6) / 1e6 : null,
      deadline: sanitizeText(raw.deadline, 5),
      note: sanitizeText(raw.note, 120)
    };
  }

  function sanitizeStop(raw, index) {
    if (!raw || typeof raw !== 'object' || !raw.taskId) return null;
    return {
      taskId: sanitizeText(raw.taskId, 40),
      order: clampInt(raw.order, 1, 9999, index + 1),
      etaMin: numOr(raw.etaMin, 0),
      departMin: numOr(raw.departMin, 0),
      conflict: !!raw.conflict,
      distanceM: numOr(raw.distanceM, 0),
      driveMin: numOr(raw.driveMin, 0)
    };
  }

  function sanitizeResult(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.routes)) return null;
    var routes = raw.routes
      .filter(function (r) { return r && typeof r === 'object' && r.vehicleId; })
      .map(function (r) {
        return {
          vehicleId: sanitizeText(r.vehicleId, 40),
          label: sanitizeText(r.label, 30),
          plateNo: sanitizeText(r.plateNo, 20),
          driverName: sanitizeText(r.driverName, 30),
          driverPhone: sanitizeText(r.driverPhone, 30),
          color: sanitizeColor(r.color),
          stops: Array.isArray(r.stops) ? r.stops.map(sanitizeStop).filter(Boolean) : [],
          legs: Array.isArray(r.legs) ? r.legs : [],
          waypoints: Array.isArray(r.waypoints) ? r.waypoints : [],
          startMin: numOr(r.startMin, 0),
          finishMin: numOr(r.finishMin, 0),
          totalDistanceM: numOr(r.totalDistanceM, 0),
          totalDurationMin: numOr(r.totalDurationMin, 0),
          conflictCount: numOr(r.conflictCount, 0)
        };
      });
    return {
      routes: routes,
      summary: summarizeRoutes(routes),
      generatedAt: sanitizeText(raw.generatedAt, 40)
    };
  }

  function summarizeRoutes(routes) {
    var taskCount = 0;
    var totalDistanceM = 0;
    var totalDurationMin = 0;
    var conflictCount = 0;
    var finishTimes = [];
    routes.forEach(function (r) {
      taskCount += (r.stops || []).length;
      totalDistanceM += numOr(r.totalDistanceM, 0);
      totalDurationMin += numOr(r.totalDurationMin, 0);
      conflictCount += numOr(r.conflictCount, 0);
      if (r.stops && r.stops.length) finishTimes.push(numOr(r.finishMin, 0));
    });
    return {
      taskCount: taskCount,
      vehicleCount: routes.length,
      totalDistanceM: totalDistanceM,
      totalDurationMin: totalDurationMin,
      conflictCount: conflictCount,
      returnSpreadMin: finishTimes.length
        ? Math.max.apply(null, finishTimes) - Math.min.apply(null, finishTimes)
        : 0
    };
  }

  function sanitizeState(raw) {
    raw = raw || {};
    var vehicles = [];
    if (Array.isArray(raw.vehicles)) {
      vehicles = raw.vehicles.map(sanitizeVehicle);
    } else {
      vehicles = DEFAULT_VEHICLES.map(function (v, i) { return sanitizeVehicle(v, i); });
    }
    var settings = mergeSettings(defaultSettings(), raw.settings || {});
    settings.activeVehicleIds = (settings.activeVehicleIds || []).filter(function (id) {
      return vehicles.some(function (v) { return v.id === id; });
    });
    var tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map(sanitizeTask).filter(Boolean)
      : [];
    return {
      vehicles: vehicles,
      tasks: tasks,
      settings: settings,
      result: sanitizeResult(raw.result)
    };
  }

  var state = load();

  var SESSION_ID = 'd' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var syncChannel = null;
  if (global.BroadcastChannel) {
    try {
      syncChannel = new BroadcastChannel('dispatch-board-sync');
      syncChannel.onmessage = function (e) {
        if (!e.data || e.data.type !== 'state' || !e.data.state) return;
        if (e.data.session === SESSION_ID) return;
        state = sanitizeState(e.data.state);
        resequence(state);
        emitChange(false);
      };
    } catch (e) { /* ignore */ }
  }

  function load() {
    var raw = {
      vehicles: loadJSON(LS_VEHICLES, null),
      tasks: loadJSON(LS_TASKS, []),
      settings: loadJSON(LS_SETTINGS, {}),
      result: loadJSON(LS_RESULT, null)
    };
    var stateObj = sanitizeState(raw);
    var hasFixedStart = stateObj.settings.startAddr === FIXED_START_ADDR &&
      stateObj.settings.start &&
      Math.abs(stateObj.settings.start.lng - FIXED_START.lng) < 1e-6 &&
      Math.abs(stateObj.settings.start.lat - FIXED_START.lat) < 1e-6;
    if (!hasFixedStart) {
      stateObj.settings.startAddr = FIXED_START_ADDR;
      stateObj.settings.start = { lng: FIXED_START.lng, lat: FIXED_START.lat };
      stateObj.settings.changedAt = Date.now();
    }
    resequence(stateObj);

    if (stateObj.settings.dateKey !== todayKey()) {
      stateObj.tasks = [];
      stateObj.result = null;
      stateObj.settings.dateKey = todayKey();
      stateObj.settings.updatedAt = Date.now();
      stateObj.settings.changedAt = Date.now();
    }
    return stateObj;
  }

  function save() {
    state.settings.updatedAt = Date.now();
    localStorage.setItem(LS_TASKS, JSON.stringify(state.tasks));
    localStorage.setItem(LS_VEHICLES, JSON.stringify(state.vehicles));
    localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
    if (state.result) localStorage.setItem(LS_RESULT, JSON.stringify(state.result));
    else localStorage.removeItem(LS_RESULT);
    emitChange();
  }

  function emitChange(broadcast) {
    var ev = new CustomEvent('statechange', { detail: state });
    document.dispatchEvent(ev);
    if (broadcast === false) return;
    if (syncChannel) {
      try {
        syncChannel.postMessage({ type: 'state', state: state, session: SESSION_ID });
      } catch (e) { /* ignore */ }
    }
  }

  function mutate(fn) {
    fn(state);
    state = sanitizeState(state);
    resequence(state);
    save();
  }

  function touch(s) {
    s.settings.changedAt = Date.now();
  }

  function byId(list, id) {
    return list.find(function (x) { return x.id === id; });
  }

  global.Store = {
    getState: function () { return state; },
    todayKey: todayKey,

    addTask: function (data) {
      mutate(function (s) {
        touch(s);
        var maxSeq = s.tasks.reduce(function (m, t) { return Math.max(m, t.seq || 0); }, 0);
        var task = Object.assign({
          id: uid('t'),
          seq: maxSeq + 1,
          shopName: '',
          phone: '',
          address: '',
          lng: null,
          lat: null,
          deadline: '',
          note: ''
        }, data);
        if (!task.id) task.id = uid('t');
        s.tasks.push(task);
      });
    },

    updateTask: function (id, patch) {
      mutate(function (s) {
        touch(s);
        var t = byId(s.tasks, id);
        if (t) Object.assign(t, patch);
      });
    },

    removeTask: function (id) {
      mutate(function (s) {
        touch(s);
        s.tasks = s.tasks.filter(function (t) { return t.id !== id; });
        if (s.result && Array.isArray(s.result.routes)) {
          var removed = s.result.routes.some(function (r) {
            return (r.stops || []).some(function (st) { return st.taskId === id; });
          });
          if (removed) s.result = null;
        }
        resequence(s);
      });
    },

    clearTasks: function () {
      mutate(function (s) {
        touch(s);
        s.tasks = [];
        s.result = null;
        resequence(s);
      });
    },

    setTasks: function (tasks) {
      mutate(function (s) {
        touch(s);
        s.tasks = tasks;
        s.result = null;
        resequence(s);
      });
    },

    addVehicle: function (data) {
      mutate(function (s) {
        touch(s);
        var v = Object.assign({ id: uid('v'), plateNo: '', driverName: '', driverPhone: '', color: '#2563EB' }, data);
        if (!v.id) v.id = uid('v');
        s.vehicles.push(v);
      });
    },

    updateVehicle: function (id, patch) {
      mutate(function (s) {
        touch(s);
        var v = byId(s.vehicles, id);
        if (v) Object.assign(v, patch);
      });
    },

    removeVehicle: function (id) {
      mutate(function (s) {
        touch(s);
        s.vehicles = s.vehicles.filter(function (v) { return v.id !== id; });
        s.settings.activeVehicleIds = s.settings.activeVehicleIds.filter(function (vid) { return vid !== id; });
        if (s.result && Array.isArray(s.result.routes)) {
          s.result.routes = s.result.routes.filter(function (r) { return r.vehicleId !== id; });
          if (!s.result.routes.length) s.result = null;
          else s.result.summary = summarizeRoutes(s.result.routes);
        }
      });
    },

    updateSettings: function (patch) {
      mutate(function (s) {
        touch(s);
        s.settings = mergeSettings(s.settings, patch);
      });
    },

    setResult: function (result) {
      mutate(function (s) { s.result = sanitizeResult(result); });
    },

    clearResult: function () {
      mutate(function (s) { s.result = null; });
    },

    resultStale: function () {
      if (!state.result) return false;
      var generated = Date.parse(state.result.generatedAt);
      if (isNaN(generated)) return true;
      return state.settings.changedAt > generated;
    },

    loadDemo: function () {
      mutate(function (s) {
        touch(s);
        s.tasks = JSON.parse(JSON.stringify(DEMO_TASKS));
        s.settings.startAddr = '上海市普陀区真北路 800 号（配送中心）';
        s.settings.start = { lng: 121.3956, lat: 31.2495 };
        s.settings.endAddr = '';
        s.settings.end = null;
        s.settings.activeVehicleIds = s.vehicles.map(function (v) { return v.id; });
        s.result = null;
        resequence(s);
      });
    },

    clearToday: function () {
      mutate(function (s) {
        touch(s);
        s.tasks = [];
        s.result = null;
        resequence(s);
      });
    },

    exportJSON: function () {
      return JSON.stringify({ tasks: state.tasks, vehicles: state.vehicles, settings: state.settings, result: state.result }, null, 2);
    },

    importJSON: function (str) {
      var data = JSON.parse(str);
      if (!Array.isArray(data.tasks) || !Array.isArray(data.vehicles)) throw new Error('格式不正确');
      var next = sanitizeState({
        vehicles: data.vehicles,
        tasks: data.tasks,
        settings: data.settings || {},
        result: data.result || null
      });
      mutate(function (s) {
        touch(s);
        s.vehicles = next.vehicles;
        s.tasks = next.tasks;
        next.settings.dateKey = todayKey();
        next.settings.changedAt = Date.now();
        s.settings = next.settings;
        s.result = next.result;
      });
    },

    importExcelData: function (data) {
      data = data || {};
      var next = sanitizeState({
        vehicles: data.vehicles && data.vehicles.length ? data.vehicles : state.vehicles,
        tasks: data.tasks || [],
        settings: Object.assign({}, state.settings, data.settings || {}),
        result: null
      });
      mutate(function (s) {
        touch(s);
        s.vehicles = next.vehicles;
        s.tasks = next.tasks;
        next.settings.dateKey = todayKey();
        next.settings.changedAt = Date.now();
        s.settings = next.settings;
        s.result = null;
      });
    }
  };

  function resequence(s) {
    s.tasks.forEach(function (t, i) { t.seq = i + 1; });
  }

  window.addEventListener('storage', function (e) {
    if (e.key === LS_TASKS || e.key === LS_VEHICLES || e.key === LS_SETTINGS || e.key === LS_RESULT) {
      state = load();
      emitChange();
    }
  });

  global.__dispatchStore = global.Store;
})(window);
