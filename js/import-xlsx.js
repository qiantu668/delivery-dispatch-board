(function (global) {
  'use strict';

  function norm(v) {
    return String(v == null ? '' : v)
      .replace(/\s+/g, '')
      .replace(/[（）()]/g, '')
      .toLowerCase();
  }

  function clean(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function cell(row, idx) {
    return row && idx != null && row[idx] != null ? row[idx] : '';
  }

  var TASK_FIELDS = {
    name: ['收货人姓名', '姓名', '联系人', '收货人', '店铺名', '客户名称'],
    phone: ['收货人电话', '联系电话', '手机号', '手机号码', '手机', '电话', '买家电话'],
    province: ['省', '省份', 'province'],
    city: ['市', '城市', 'city'],
    district: ['区县', '区', '县', 'district'],
    town: ['镇', '街道', '乡镇', 'town'],
    detail: ['收货人详细地址', '详细地址', '送货地址', '送单地址', '收货地址', '客户地址', '地址', 'address'],
    note: ['买家留言', '留言', '备注', '备注源表', '说明'],
    deadline: ['截止时间', '要求送达时间', '预计送达时间', '送达时间', 'deadline'],
    lng: ['经度', 'lng', 'longitude'],
    lat: ['纬度', 'lat', 'latitude']
  };

  var VEHICLE_FIELDS = {
    plateNo: ['车牌号', '车牌', '车辆', 'plate'],
    driverName: ['司机姓名', '驾驶员', '司机', '姓名'],
    driverPhone: ['司机电话', '司机手机', '手机号', '手机', '电话'],
    color: ['车辆颜色', '颜色', 'color']
  };

  function detectHeader(grid, fields, required) {
    var maxRows = Math.min(grid.length, 80);
    for (var r = 0; r < maxRows; r++) {
      var row = grid[r];
      if (!row || !row.length) continue;
      var map = {};
      for (var c = 0; c < row.length; c++) {
        var h = norm(row[c]);
        if (!h) continue;
        for (var f in fields) {
          if (map[f] != null || !fields.hasOwnProperty(f)) continue;
          var aliases = fields[f];
          for (var a = 0; a < aliases.length; a++) {
            if (h === norm(aliases[a])) {
              map[f] = c;
              break;
            }
          }
        }
      }
      if (map[required] != null && (map.detail != null || map.name != null || map.phone != null)) {
        return { row: r, map: map };
      }
    }
    return null;
  }

  function buildAddress(province, city, district, town, detail) {
    var segs = [];
    [province, city, district, town].forEach(function (s) {
      if (!s) return;
      if (segs.length && segs[segs.length - 1] === s) return;
      segs.push(s);
    });
    var prefix = segs.join('');
    if (!detail) return prefix;
    if (detail.indexOf(prefix) === 0) return detail;
    for (var i = 0; i < segs.length; i++) {
      var candidate = segs.slice(i).join('');
      if (detail.indexOf(candidate) === 0) {
        return segs.slice(0, i).join('') + detail;
      }
    }
    return prefix + detail;
  }

  function toCoord(v) {
    if (v == null || String(v).trim() === '') return null;
    var n = Number(String(v).trim().replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
  }

  function toDeadline(v) {
    if (v == null || String(v).trim() === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      var hh = ('0' + v.getHours()).slice(-2);
      var mm = ('0' + v.getMinutes()).slice(-2);
      return hh + ':' + mm;
    }
    var s = String(v).trim().replace(/[：]/g, ':');
    if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(s)) return s.slice(0, 5);
    return s.slice(0, 5);
  }

  function ensureShanghaiAddress(v) {
    var a = clean(v);
    if (!a) return '';
    if (/^上海/.test(a)) return a;
    if (/^(江苏|浙江|北京|天津|重庆|广州|深圳|苏州|昆山|太仓|常熟|无锡|常州|南通|嘉兴|湖州)/.test(a)) return a;
    return '上海市' + a;
  }

  function parseTasks(grid, meta, tasks, warnings) {
    for (var r = meta.row + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      var hasValue = row.some(function (v) {
        return v != null && String(v).trim() !== '';
      });
      if (!hasValue) continue;
      var address = buildAddress(
        clean(cell(row, meta.map.province)),
        clean(cell(row, meta.map.city)),
        clean(cell(row, meta.map.district)),
        clean(cell(row, meta.map.town)),
        clean(cell(row, meta.map.detail))
      );
      if (!address) {
        warnings.push('第 ' + (r + 1) + ' 行缺少收货地址，已跳过');
        continue;
      }
      tasks.push({
        shopName: clean(cell(row, meta.map.name)),
        phone: clean(cell(row, meta.map.phone)),
        address: address,
        note: clean(cell(row, meta.map.note)),
        deadline: toDeadline(cell(row, meta.map.deadline)),
        lng: toCoord(cell(row, meta.map.lng)),
        lat: toCoord(cell(row, meta.map.lat))
      });
    }
  }

  function detectCompactTasks(grid) {
    var maxRows = Math.min(grid.length, 80);
    for (var r = 0; r < maxRows; r++) {
      var row = grid[r] || [];
      if (!row.length) continue;
      var seq = clean(cell(row, 0));
      var name = clean(cell(row, 1));
      var address = clean(cell(row, 2));
      if (!name || !address || !/[\u4e00-\u9fa5]/.test(address)) continue;
      var seqHeader = ['序号', '编号', '序'].indexOf(norm(seq)) >= 0;
      var seqNum = /^\d+(\.\d+)?$/.test(seq);
      if (!seqHeader && !seqNum) continue;
      return { compact: true, row: r, hasHeader: seqHeader };
    }
    return null;
  }

  function parseCompactTasks(grid, meta, tasks, warnings) {
    var start = meta.row + (meta.hasHeader ? 1 : 0);
    for (var r = start; r < grid.length; r++) {
      var row = grid[r] || [];
      var hasValue = row.some(function (v) {
        return v != null && String(v).trim() !== '';
      });
      if (!hasValue) continue;
      var seq = clean(cell(row, 0));
      if (!meta.hasHeader && seq !== '' && !/^\d+(\.\d+)?$/.test(seq)) continue;
      var name = clean(cell(row, 1));
      var address = ensureShanghaiAddress(cell(row, 2));
      if (!address) {
        warnings.push('第 ' + (r + 1) + ' 行缺少地址，已跳过');
        continue;
      }
      tasks.push({
        shopName: name,
        phone: '',
        address: address,
        note: '',
        deadline: '',
        lng: null,
        lat: null
      });
    }
  }

  function parseVehicles(grid, meta, vehicles) {
    for (var r = meta.row + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      var hasValue = row.some(function (v) {
        return v != null && String(v).trim() !== '';
      });
      if (!hasValue) continue;
      var plateNo = clean(cell(row, meta.map.plateNo));
      if (!plateNo) continue;
      vehicles.push({
        plateNo: plateNo,
        driverName: clean(cell(row, meta.map.driverName)),
        driverPhone: clean(cell(row, meta.map.driverPhone)),
        color: clean(cell(row, meta.map.color))
      });
    }
  }

  function parse(buffer) {
    if (!global.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
    var wb;
    try {
      wb = global.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    } catch (e) {
      throw new Error('无法解析文件，请确认是 .xlsx / .xls / .csv 格式');
    }
    var tasks = [];
    var vehicles = [];
    var warnings = [];
    var foundTask = false;
    var foundVehicle = false;
    wb.SheetNames.forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      var grid;
      try {
        grid = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
      } catch (e) {
        return;
      }
      if (!grid || !grid.length) return;
      var taskMeta = detectHeader(grid, TASK_FIELDS, 'detail');
      if (taskMeta) {
        parseTasks(grid, taskMeta, tasks, warnings);
        foundTask = true;
      } else {
        var compactMeta = detectCompactTasks(grid);
        if (compactMeta) {
          parseCompactTasks(grid, compactMeta, tasks, warnings);
          foundTask = true;
        }
      }
      var vehicleMeta = detectHeader(grid, VEHICLE_FIELDS, 'plateNo');
      if (vehicleMeta) {
        parseVehicles(grid, vehicleMeta, vehicles);
        foundVehicle = true;
      }
    });
    if (!foundTask) {
      throw new Error('未识别到任务格式，请使用带表头格式，或“序号 / 店名 / 地址”三列简表');
    }
    return {
      tasks: tasks,
      vehicles: foundVehicle ? vehicles : null,
      warnings: warnings
    };
  }

  function toHHMM(min) {
    if (min == null || !isFinite(Number(min))) return '';
    var m = Math.round(Number(min));
    if (m < 0) m = 0;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2);
  }

  function todayString() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function setColWidths(ws, widths) {
    if (!ws || !widths || !widths.length) return;
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
  }

  function routeSheetName(route, used) {
    var base = ((route.plateNo || route.label || '车辆') + '-' + (route.driverName || '司机'))
      .replace(/[\\\/\?\*\[\]:]/g, '')
      .slice(0, 28);
    if (!base) base = '路线';
    var name = base;
    var i = 2;
    while (used[name]) {
      name = base + '-' + i;
      i++;
    }
    used[name] = true;
    return name;
  }

  function routeRows(route, state) {
    var taskById = {};
    state.tasks.forEach(function (t) { taskById[t.id] = t; });
    var roundTrip = !!(state.settings && state.settings.roundTrip);
    var rows = [
      ['车辆', route.plateNo || route.label || '', '司机', route.driverName || '', '电话', route.driverPhone || ''],
      ['出发', toHHMM(route.startMin), roundTrip ? '返回终点' : '完工/待命', toHHMM(route.finishMin), '里程(km)', ((route.totalDistanceM || 0) / 1000).toFixed(1), '预计用时(分钟)', route.totalDurationMin || 0]
    ];
    rows.push(['序号', '店名 / 收货点', '联系电话', '送货地址', '要求送达', '预计到达', '预计离开', '停靠(分钟)', '备注', '冲突']);
    (route.stops || []).forEach(function (s) {
      var t = taskById[s.taskId] || {};
      rows.push([
        s.order != null ? s.order : '',
        t.shopName || '',
        t.phone || '',
        t.address || '',
        t.deadline || '',
        toHHMM(s.etaMin),
        toHHMM(s.departMin),
        state.settings && state.settings.stopMinutes != null ? state.settings.stopMinutes : '',
        t.note || '',
        s.conflict ? '是' : ''
      ]);
    });
    if (roundTrip && (route.stops || []).length) {
      rows.push(['返', '返回终点', '', state.settings.startAddr || '', '', toHHMM(route.finishMin), '', '', '送完返回出发地', '']);
    }
    return rows;
  }

  function downloadRoutes(state, vehicleId) {
    if (!global.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
    if (!state || !state.result || !Array.isArray(state.result.routes)) {
      throw new Error('还没有可导出的排班结果');
    }
    var routes = state.result.routes.filter(function (r) {
      return !vehicleId || r.vehicleId === vehicleId;
    });
    if (!routes.length) throw new Error('这辆车还没有排班路线');

    var wb = global.XLSX.utils.book_new();
    var used = {};
    var dateStr = todayString();
    var roundTrip = !!(state.settings && state.settings.roundTrip);

    if (!vehicleId) {
      var summaryRows = [['车牌', '司机', '电话', '站点数', '出发', roundTrip ? '返回终点' : '完工/待命', '总里程(km)', '预计用时(分钟)', '冲突数']];
      routes.forEach(function (r) {
        summaryRows.push([
          r.plateNo || r.label || '',
          r.driverName || '',
          r.driverPhone || '',
          (r.stops || []).length,
          toHHMM(r.startMin),
          toHHMM(r.finishMin),
          ((r.totalDistanceM || 0) / 1000).toFixed(1),
          r.totalDurationMin || 0,
          r.conflictCount || 0
        ]);
      });
      var summaryWs = global.XLSX.utils.aoa_to_sheet(summaryRows);
      setColWidths(summaryWs, [18, 14, 16, 10, 10, 10, 14, 18, 10]);
      global.XLSX.utils.book_append_sheet(wb, summaryWs, '配送路线');
      used['配送路线'] = true;

      var taskById = {};
      state.tasks.forEach(function (t) { taskById[t.id] = t; });
      var allRows = [['车牌', '司机', '序号', '店名 / 收货点', '联系电话', '送货地址', '要求送达', '预计到达', '预计离开', '备注', '冲突']];
      routes.forEach(function (r) {
        (r.stops || []).forEach(function (s) {
          var t = taskById[s.taskId] || {};
          allRows.push([
            r.plateNo || r.label || '',
            r.driverName || '',
            s.order != null ? s.order : '',
            t.shopName || '',
            t.phone || '',
            t.address || '',
            t.deadline || '',
            toHHMM(s.etaMin),
            toHHMM(s.departMin),
            t.note || '',
            s.conflict ? '是' : ''
          ]);
        });
      });
      var allWs = global.XLSX.utils.aoa_to_sheet(allRows);
      setColWidths(allWs, [18, 14, 6, 18, 14, 45, 10, 12, 12, 20, 6]);
      global.XLSX.utils.book_append_sheet(wb, allWs, '全部站点');
      used['全部站点'] = true;
    }

    routes.forEach(function (r) {
      var ws = global.XLSX.utils.aoa_to_sheet(routeRows(r, state));
      setColWidths(ws, [6, 18, 14, 45, 10, 12, 12, 12, 20, 6]);
      global.XLSX.utils.book_append_sheet(wb, ws, routeSheetName(r, used));
    });

    var fileBase = vehicleId
      ? (routes[0].plateNo || routes[0].driverName || '司机')
      : '全部司机';
    global.XLSX.writeFile(wb, '送单路线-' + fileBase + '-' + dateStr + '.xlsx');
  }

  function downloadTemplate() {
    if (!global.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
    var tasks = [
      ['序号', '店铺名', '联系电话', '地址', '经度', '纬度', '截止时间', '备注'],
      [1, '示例店铺A', '13800000001', '上海市松江区佘山镇世茂纳米魔幻城4幢126号', 121.227, 31.031, '17:30', '请放前台'],
      [2, '示例店铺B', '13800000002', '上海市松江区佘山镇示例路 1 号', 121.2277, 31.0326, '', '']
    ];
    var vehicles = [
      ['车牌号', '司机姓名', '司机电话', '车辆颜色'],
      ['沪A7G5D2', '陈师傅', '13800000001', '#2563EB'],
      ['沪B2K8M9', '林师傅', '13800000002', '#0D9488']
    ];
    var wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.aoa_to_sheet(tasks), '任务');
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.aoa_to_sheet(vehicles), '车辆');
    global.XLSX.writeFile(wb, '派车导入模板.xlsx');
  }

  global.ExcelImport = {
    parse: parse,
    downloadRoutes: downloadRoutes,
    downloadTemplate: downloadTemplate
  };
})(window);
