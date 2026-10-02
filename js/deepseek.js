(function (global) {
  'use strict';

  var API_URL = 'https://api.deepseek.com/chat/completions';
  var MODEL = 'deepseek-chat';

  function clean(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function toNum(v, fallback) {
    if (v == null || String(v).trim() === '') return fallback;
    var n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? Math.round(n) : fallback;
  }

  function toMinute(v, fallback) {
    if (v == null || String(v).trim() === '') return fallback;
    var s = String(v).trim().replace(/[：]/g, ':');
    var m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    return toNum(s, fallback);
  }

  function invalid(message) {
    var err = new Error(message);
    err.repair = true;
    return err;
  }

  function inputPayload(input) {
    return {
      defaultStartTime: input.defaultStartTime,
      defaultStartMin: input.defaultStartMin,
      stopMinutes: input.stopMinutes,
      start: input.start,
      vehicles: input.vehicles.map(function (v) {
        return {
          id: v.id,
          plateNo: v.plateNo || '',
          driverName: v.driverName || '',
          color: v.color || ''
        };
      }),
      tasks: input.tasks.map(function (t) {
        return {
          id: t.id,
          shopName: t.shopName || '',
          address: t.address || '',
          lng: t.lng,
          lat: t.lat,
          deadline: t.deadline || '',
          deadlineMin: t.deadlineMin == null ? null : t.deadlineMin
        };
      }),
      currentRoutes: Array.isArray(input.currentRoutes) ? input.currentRoutes.map(function (r) {
        return {
          vehicleId: r.vehicleId,
          label: r.label || '',
          stops: (r.stops || []).map(function (s) {
            return { taskId: s.taskId, order: s.order };
          })
        };
      }) : []
    };
  }

  function buildMessages(input, repairError) {
    var taskCount = (input.tasks || []).length;
    var vehicleCount = (input.vehicles || []).length;
    var avg = vehicleCount ? taskCount / vehicleCount : 0;
    var minTarget = vehicleCount ? Math.floor(taskCount / vehicleCount) : 0;
    var maxTarget = vehicleCount ? Math.ceil(taskCount / vehicleCount) : 0;
    var system = [
      '你是上海地区专业配送调度员，负责把任务分给车辆并排访问顺序。',
      '只能输出一个 JSON 对象，不要输出 Markdown、解释、时间或里程估算。',
      '',
      '硬性规则：',
      '1. 必须使用全部车辆，每辆车至少分配一个任务。',
      '2. 每个任务必须且只能出现在一辆车上。',
      '3. 任务数必须接近平均：总任务 ' + taskCount + ' 个、车辆 ' + vehicleCount + ' 辆，平均每车约 ' + avg.toFixed(1) + ' 个，最少 ' + minTarget + ' 个、最多 ' + maxTarget + ' 个，任意两车相差不要超过 3 个。',
      '4. 按区域就近分车：同一片区、同一方向的任务尽量放同一辆车，避免把太仓、金山、临港等不同方向或距离很远的点混给同一辆车。',
      '5. 有截止时间的任务要优先安排，顺序尽量在截止时间前到。',
      '6. 每辆车到达一个点后，优先安排它周边5公里内的其他任务；周边没有5公里内任务时再选择较近的下一点。',
      '7. 车辆送完最后一站后原地待命，不需要返回出发地，也不要为“返回时间”绕路。',
      '8. 每辆车的完工时间（最后送达时间）要尽量接近，任意两车完工时间差距尽量控制在 30 分钟以内；不要为了均衡时间刻意绕路。',
      '9. taskId 和 vehicleId 必须原样使用输入中的值，每辆车的任务按建议访问顺序填写。',
      '',
      '只返回这个 JSON 结构：',
      '{"routes":[{"vehicleId":"v1","stops":[{"taskId":"t1","order":1},{"taskId":"t2","order":2}]}]}',
      '不需要输出 startMin、finishMin、etaMin、distanceM、driveMin 等时间里程字段，程序会按实际路线重新计算。'
    ].join('\n');
    var user = '请按规则排车，输入数据如下：\n' + JSON.stringify(inputPayload(input));
    if (repairError) {
      user += '\n\n上一次输出不合格：' + repairError + '。请修正后重新输出完整 JSON。';
    }
    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  function request(key, messages) {
    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: messages
      })
    }).then(function (resp) {
      return resp.text().then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw invalid('DeepSeek 返回内容不是有效 JSON');
        }
        if (!resp.ok) {
          var msg = data && data.error && data.error.message;
          throw new Error(msg || ('DeepSeek 接口错误：' + resp.status));
        }
        var content = data && data.choices && data.choices[0] &&
          data.choices[0].message && data.choices[0].message.content;
        if (!content) throw invalid('DeepSeek 没有返回排车方案');
        return content;
      });
    }, function () {
      throw new Error('DeepSeek 接口请求失败，请检查网络或 Key');
    });
  }

  function parseContent(content) {
    var text = String(content || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw invalid('AI 返回的方案 JSON 无法解析');
    }
  }

  function mapVehicles(vehicles) {
    var map = {};
    vehicles.forEach(function (v) {
      [v.id, v.plateNo, v.driverName, v.label].forEach(function (key) {
        key = clean(key);
        if (key) map[key] = v;
      });
    });
    return map;
  }

  function rawRoutes(raw) {
    var plan = raw && raw.plan ? raw.plan : raw;
    return plan && plan.routes ? plan.routes : [];
  }

  function vehicleForRoute(vehicleByKey, r) {
    return vehicleByKey[clean(r.vehicleId)] ||
      vehicleByKey[clean(r.vehicle_id)] ||
      vehicleByKey[clean(r.plateNo)] ||
      vehicleByKey[clean(r.plate)];
  }

  function taskDistanceKm(a, b) {
    if (!a || !b || a.lng == null || a.lat == null || b.lng == null || b.lat == null) return Infinity;
    var R = 6371;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var sinLat = Math.sin(dLat / 2);
    var sinLng = Math.sin(dLng / 2);
    var h = sinLat * sinLat +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function routeTaskDistance(route, task, taskById, start) {
    var best = Infinity;
    var points = [];
    if (start && start.lng != null) points.push(start);
    (route.stops || []).forEach(function (s) {
      var t = taskById[s.taskId];
      if (t) points.push(t);
    });
    points.forEach(function (p) {
      var d = taskDistanceKm(task, p);
      if (d < best) best = d;
    });
    return best;
  }

  function pickRouteIndex(routes, task, taskById, start) {
    var best = -1;
    var bestScore = Infinity;
    routes.forEach(function (r, i) {
      var count = (r.stops || []).length;
      var d = routeTaskDistance(r, task, taskById, start);
      if (!isFinite(d)) d = 10000;
      var score = count * 10 + d;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best < 0 ? 0 : best;
  }

  function pickMoveIndex(routes, fromIdx, toIdx, taskById, start) {
    var target = routes[toIdx];
    var source = routes[fromIdx];
    var best = -1;
    var bestScore = Infinity;
    (source.stops || []).forEach(function (s, i) {
      var t = taskById[s.taskId];
      if (!t) return;
      var d = routeTaskDistance(target, t, taskById, start);
      if (!isFinite(d)) d = 10000;
      if (d < bestScore) {
        bestScore = d;
        best = i;
      }
    });
    return best;
  }

  function renumberStops(routes) {
    routes.forEach(function (r) {
      (r.stops || []).forEach(function (s, i) {
        s.order = i + 1;
      });
    });
  }

  function repairRouteCoverage(raw, input) {
    var vehicleByKey = mapVehicles(input.vehicles);
    var taskById = {};
    input.tasks.forEach(function (t) { taskById[t.id] = t; });
    var seenVehicle = {};
    var seenTask = {};
    var out = [];

    rawRoutes(raw).forEach(function (r) {
      r = r || {};
      var vehicle = vehicleForRoute(vehicleByKey, r);
      if (!vehicle || seenVehicle[vehicle.id]) return;
      seenVehicle[vehicle.id] = true;
      var stops = [];
      (r.stops || r.tasks || r.orders || []).forEach(function (s) {
        s = s || {};
        var taskId = clean(s.taskId || s.task_id || s.id);
        if (!taskById[taskId] || seenTask[taskId]) return;
        seenTask[taskId] = true;
        stops.push({ taskId: taskId, order: stops.length + 1 });
      });
      out.push({ vehicleId: vehicle.id, stops: stops });
    });

    input.vehicles.forEach(function (v) {
      if (!seenVehicle[v.id]) {
        seenVehicle[v.id] = true;
        out.push({ vehicleId: v.id, stops: [] });
      }
    });

    input.tasks.forEach(function (t) {
      if (seenTask[t.id]) return;
      var idx = pickRouteIndex(out, t, taskById, input.start);
      out[idx].stops.push({ taskId: t.id, order: out[idx].stops.length + 1 });
      seenTask[t.id] = true;
    });

    var guard = 0;
    while (guard++ < 100) {
      var minIdx = -1;
      var maxIdx = -1;
      var minN = Infinity;
      var maxN = -1;
      out.forEach(function (r, i) {
        var n = (r.stops || []).length;
        if (n < minN) { minN = n; minIdx = i; }
        if (n > maxN) { maxN = n; maxIdx = i; }
      });
      if (minN > 0 || maxN <= 1) break;
      var moveIdx = pickMoveIndex(out, maxIdx, minIdx, taskById, input.start);
      if (moveIdx < 0) break;
      out[minIdx].stops.push(out[maxIdx].stops.splice(moveIdx, 1)[0]);
    }

    var total = input.tasks.length;
    var vehicleCount = Math.max(1, input.vehicles.length);
    var maxGap = Math.max(3, Math.ceil(total / vehicleCount * 0.15));
    guard = 0;
    while (guard++ < 100) {
      var counts = out.map(function (r) { return (r.stops || []).length; });
      var lo = Math.min.apply(null, counts);
      var hi = Math.max.apply(null, counts);
      if (hi - lo <= maxGap) break;
      var fromIdx = counts.indexOf(hi);
      var toIdx = counts.indexOf(lo);
      var moveIdx = pickMoveIndex(out, fromIdx, toIdx, taskById, input.start);
      if (moveIdx < 0) moveIdx = 0;
      out[toIdx].stops.push(out[fromIdx].stops.splice(moveIdx, 1)[0]);
    }
    renumberStops(out);
    return { routes: out };
  }

  function normalize(raw, input) {
    var plan = raw && raw.plan ? raw.plan : raw;
    var routes = plan && plan.routes;
    if (!Array.isArray(routes) || !routes.length) throw invalid('AI 没有返回 routes');

    var vehicleByKey = mapVehicles(input.vehicles);
    var taskById = {};
    input.tasks.forEach(function (t) { taskById[t.id] = t; });
    var usedVehicle = {};
    var usedTask = {};
    var out = [];

    routes.forEach(function (r) {
      r = r || {};
      var vehicle = vehicleByKey[clean(r.vehicleId)] ||
        vehicleByKey[clean(r.vehicle_id)] ||
        vehicleByKey[clean(r.plateNo)] ||
        vehicleByKey[clean(r.plate)];
      if (!vehicle) throw invalid('AI 返回了未知车辆：' + clean(r.vehicleId));
      if (usedVehicle[vehicle.id]) throw invalid('AI 重复分配车辆：' + vehicle.id);
      usedVehicle[vehicle.id] = true;

      var rawStops = r.stops || r.tasks || r.orders;
      if (!Array.isArray(rawStops) || !rawStops.length) {
        throw invalid('车辆 ' + vehicle.id + ' 没有任务');
      }
      var stops = rawStops.map(function (s, index) {
        s = s || {};
        var taskId = clean(s.taskId || s.task_id || s.id);
        var task = taskById[taskId];
        if (!task) throw invalid('AI 返回了未知任务：' + taskId);
        if (usedTask[taskId]) throw invalid('AI 重复分配任务：' + taskId);
        usedTask[taskId] = true;
        return { raw: s, task: task, index: index };
      }).sort(function (a, b) {
        var ao = toNum(a.raw.order, a.index + 1);
        var bo = toNum(b.raw.order, b.index + 1);
        return ao - bo;
      });

      var prevDepart = toMinute(r.startMin, input.defaultStartMin);
      var normalizedStops = [];
      var totalDistanceM = 0;
      var totalDriveMin = 0;
      stops.forEach(function (item, index) {
        var s = item.raw;
        var task = item.task;
        var driveMin = Math.max(0, toNum(s.driveMin, 0));
        var distanceM = Math.max(0, toNum(s.distanceM, 0));
        var etaMin = toMinute(s.etaMin, prevDepart + driveMin);
        var departMin = toMinute(s.departMin, etaMin + input.stopMinutes);
        var hasEta = s.etaMin != null && String(s.etaMin).trim() !== '';
        if (hasEta && task.deadlineMin != null && etaMin > task.deadlineMin) {
          throw invalid('任务 ' + task.id + ' 超过截止时间');
        }
        if (s.conflict === true) {
          throw invalid('任务 ' + task.id + ' 被 AI 标记为超时冲突');
        }
        totalDistanceM += distanceM;
        totalDriveMin += driveMin;
        normalizedStops.push({
          taskId: task.id,
          order: index + 1,
          etaMin: etaMin,
          departMin: departMin,
          conflict: false,
          distanceM: distanceM,
          driveMin: driveMin
        });
        prevDepart = departMin;
      });

      var startMin = toMinute(r.startMin, input.defaultStartMin);
      var last = normalizedStops[normalizedStops.length - 1];
      var finishMin = toMinute(r.finishMin, last ? last.departMin : startMin);
      out.push({
        vehicleId: vehicle.id,
        label: vehicle.label || ('车 ' + (out.length + 1)),
        plateNo: vehicle.plateNo || '',
        driverName: vehicle.driverName || '',
        driverPhone: vehicle.driverPhone || '',
        color: vehicle.color || '#2563EB',
        stops: normalizedStops,
        startMin: startMin,
        finishMin: finishMin,
        totalDistanceM: Math.max(0, toNum(r.totalDistanceM, totalDistanceM)),
        totalDurationMin: Math.max(0, toNum(r.totalDurationMin, finishMin - startMin)),
        conflictCount: 0,
        legs: [],
        waypoints: []
      });
    });

    input.vehicles.forEach(function (v) {
      if (!usedVehicle[v.id]) throw invalid('AI 没有使用车辆：' + v.id);
    });
    input.tasks.forEach(function (t) {
      if (!usedTask[t.id]) throw invalid('AI 漏掉任务：' + t.id);
    });

    if (out.length !== input.vehicles.length) {
      throw invalid('AI 返回的车辆数量不正确');
    }
    var counts = out.map(function (r) { return r.stops.length; });
    var minCount = Math.min.apply(null, counts);
    var maxCount = Math.max.apply(null, counts);
    var avgCount = counts.reduce(function (s, c) { return s + c; }, 0) / counts.length;
    var maxGap = Math.max(3, Math.ceil(avgCount * 0.15));
    if (maxCount - minCount > maxGap) {
      throw invalid('任务数分布不均（' + out.map(function (r) {
        return r.vehicleId + ' ' + r.stops.length + ' 个';
      }).join('、') + '），请重新分车：每辆车尽量接近 ' + Math.round(avgCount) +
        ' 个，任意两车相差不要超过 3 个。');
    }
    return { routes: out };
  }

  function plan(input) {
    var key = clean(input && input.apiKey);
    if (!key) {
      var missing = new Error('请先在设置里填写 DeepSeek API Key');
      missing.repair = false;
      return Promise.reject(missing);
    }
    function attempt(msgs) {
      return request(key, msgs).then(parseContent).then(function (raw) {
        return normalize(repairRouteCoverage(raw, input), input);
      });
    }
    return attempt(buildMessages(input)).catch(function (err) {
      if (!err || !err.repair) throw err;
      return attempt(buildMessages(input, err.message)).catch(function (err2) {
        if (!err2 || !err2.repair) throw err2;
        return attempt(buildMessages(input, err2.message));
      });
    });
  }

  function buildChatMessages(input, repairError) {
    var system = [
      '你是上海及周边地区的配送调度 AI，负责和调度员对话、调整分车和访问顺序。',
      '你能读取当前任务、车辆、出发地和当前路线，根据用户要求返回新的完整排车方案。',
      '只能输出一个 JSON 对象，不要输出 Markdown、解释或多余文字。',
      '',
      '输出结构：',
      '{"reply":"给调度员的简短回复","routes":[{"vehicleId":"v1","stops":[{"taskId":"t1","order":1}]}]}',
      '',
      '硬性规则：',
      '1. routes 必须覆盖当前全部任务，每个任务只能出现一次。',
      '2. 默认使用全部车辆；如果用户明确让某辆车待命，则那辆车返回空 stops。',
      '3. 同一片区、5公里范围内的任务优先放同一辆车，并按就近顺序访问；周边5公里内没有任务时再选择较近的下一点。',
      '4. 有截止时间的任务要保证顺序尽量在截止时间前到达，不能安排到截止时间之后。',
      '5. 车辆送完最后一站后原地待命，不返回出发点。',
      '6. 每辆车的完工时间尽量接近，任意两车完工时间差距尽量控制在 30 分钟以内；不要为了均衡时间刻意绕路。',
      '7. 如果用户只是询问或闲聊，routes 返回当前路线原样；如果用户要求调整，routes 返回完整调整后的方案。',
      '8. taskId 和 vehicleId 必须原样使用输入中的值，stops 按访问顺序填写 order。',
      '9. 不要输出 startMin、finishMin、etaMin、distanceM、driveMin 等时间里程字段，程序会按实际路线重新计算。'
    ].join('\n');

    var context = inputPayload(input);
    var history = (input.history || []).filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant') && String(m.text || '').trim();
    }).slice(-12).map(function (m) {
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.text).slice(0, 1600)
      };
    });
    var userText = '用户最新需求：' + String(input.message || '').trim() +
      '\n\n当前任务、车辆和路线数据：\n' + JSON.stringify(context);
    if (repairError) {
      userText += '\n\n上一次输出不合格：' + repairError + '。请修正后重新输出完整 JSON。';
    }
    return [{ role: 'system', content: system }]
      .concat(history)
      .concat([{ role: 'user', content: userText }]);
  }

  function chatRoutes(raw, input) {
    var plan = raw && raw.plan ? raw.plan : raw;
    var routes = plan && plan.routes ? plan.routes : null;
    if (!Array.isArray(routes) || !routes.length) {
      if (Array.isArray(input.currentRoutes) && input.currentRoutes.length) {
        routes = input.currentRoutes.map(function (r) {
          return {
            vehicleId: r.vehicleId,
            stops: (r.stops || []).map(function (s) {
              return { taskId: s.taskId, order: s.order };
            })
          };
        });
      } else {
        throw invalid('AI 没有返回 routes');
      }
    }
    var seen = {};
    routes.forEach(function (r) {
      seen[clean(r.vehicleId)] = true;
    });
    (input.currentRoutes || []).forEach(function (r) {
      if (seen[clean(r.vehicleId)]) return;
      routes = routes.concat([{
        vehicleId: r.vehicleId,
        stops: (r.stops || []).map(function (s) {
          return { taskId: s.taskId, order: s.order };
        })
      }]);
    });
    return normalize(repairRouteCoverage({ routes: routes }, input), input);
  }

  function chat(input) {
    var key = clean(input && input.apiKey);
    if (!key) {
      var missing = new Error('请先在设置里填写 DeepSeek API Key');
      missing.repair = false;
      return Promise.reject(missing);
    }
    function attempt(msgs) {
      return request(key, msgs).then(parseContent).then(function (raw) {
        var normalized = chatRoutes(raw, input);
        var reply = raw && raw.plan ? raw.plan.reply : null;
        if (!reply) reply = raw && (raw.reply || raw.message || raw.summary);
        return {
          reply: clean(reply || '方案已生成，确认后即可采用'),
          routes: normalized.routes
        };
      });
    }
    return attempt(buildChatMessages(input)).catch(function (err) {
      if (!err || !err.repair) throw err;
      return attempt(buildChatMessages(input, err.message)).catch(function (err2) {
        if (!err2 || !err2.repair) throw err2;
        return attempt(buildChatMessages(input, err2.message));
      });
    });
  }

  global.DeepSeekPlanner = {
    plan: plan,
    validateRoutes: normalize,
    model: MODEL
  };
  global.DeepSeekChat = {
    chat: chat,
    model: MODEL
  };
})(window);
