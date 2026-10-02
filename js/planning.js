(function (global) {
  'use strict';

  function minutes(str) {
    if (str == null || str === '') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function toHHMM(min) {
    var m = Math.round(min || 0);
    if (m < 0) m = 0;
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function taskDeadlineMin(t) {
    if (t && t.deadlineMin != null && isFinite(Number(t.deadlineMin))) return Number(t.deadlineMin);
    return minutes(t && t.deadline);
  }

  function buildMatrix(start, tasks, end) {
    var coords = [start]
      .concat(tasks.map(function (t) { return { lng: t.lng, lat: t.lat }; }));
    var n = tasks.length;
    var hasEnd = !!(end && end.lng != null && end.lat != null);
    if (hasEnd) coords.push(end);
    var size = n + (hasEnd ? 2 : 1);
    var dist = [];
    var time = [];
    for (var i = 0; i < size; i++) {
      dist.push([]);
      time.push([]);
      for (var j = 0; j < size; j++) {
        if (i === j) {
          dist[i][j] = 0;
          time[i][j] = 0;
        } else {
          dist[i][j] = Geo.estimateDistanceM(coords[i], coords[j]);
          time[i][j] = Geo.estimateTravelMin(coords[i], coords[j]);
        }
      }
    }
    return { coords: coords, dist: dist, time: time, n: n, size: size, hasEnd: hasEnd };
  }

  function solveRoutes(opts) {
    var tasks = opts.tasks;
    var vehicles = opts.vehicles;
    var matrix = opts.matrix;
    var n = tasks.length;
    var k = vehicles.length;
    var hasEnd = !!matrix.hasEnd;
    var nearbyDistanceM = Number(opts.nearbyDistanceM) > 0 ? Number(opts.nearbyDistanceM) : 5000;
    if (!n) throw new Error('没有可排任务');
    if (!k) throw new Error('没有可用车辆');
    var routes = [];
    var assigned = new Array(n).fill(false);
    var defaultStart = minutes(opts.defaultStartTime);
    if (defaultStart == null) defaultStart = 480;
    var balanceLevel = Number(opts.balanceLevel);
    if (!isFinite(balanceLevel)) balanceLevel = 0;
    if (balanceLevel < 0) balanceLevel = 0;
    if (balanceLevel > 100) balanceLevel = 100;
    var balanceWeight = balanceLevel * 0.6;

    for (var vi = 0; vi < k; vi++) routes.push([]);

    function seq(route) {
      var out = [0].concat(route.map(function (x) { return x + 1; }));
      if (hasEnd) out.push(n + 1);
      return out;
    }

    function travel(route) {
      var s = seq(route);
      var c = 0;
      for (var j = 0; j < s.length - 1; j++) c += matrix.time[s[j]][s[j + 1]];
      return c;
    }

    function penalty(route) {
      var cur = defaultStart;
      var prev = 0;
      var p = 0;
      route.forEach(function (i) {
        cur += matrix.time[prev][i + 1];
        var dl = taskDeadlineMin(tasks[i]);
        if (dl != null && cur > dl) p += 40 + (cur - dl);
        cur += opts.stopMinutes;
        prev = i + 1;
      });
      return p;
    }

    function routeLoad(route) {
      return travel(route) + route.length * opts.stopMinutes;
    }

    function routeStart(route) {
      var deadlines = route
        .map(function (i) { return taskDeadlineMin(tasks[i]); })
        .filter(function (d) { return d != null; });
      var earliest = deadlines.length ? Math.min.apply(null, deadlines) : null;
      var start = defaultStart;
      if (earliest != null && route.length) {
        var driveFirst = matrix.time[0][route[0] + 1];
        var latest = earliest - driveFirst;
        if (latest >= 300) start = Math.min(start, latest);
      }
      return start;
    }

    function routeMetrics(route) {
      var start = routeStart(route);
      var cur = start;
      var prev = 0;
      var conflicts = 0;
      route.forEach(function (i) {
        cur += matrix.time[prev][i + 1];
        var dl = taskDeadlineMin(tasks[i]);
        if (dl != null && cur > dl) conflicts++;
        cur += opts.stopMinutes;
        prev = i + 1;
      });
      return {
        startMin: start,
        finishMin: hasEnd ? cur + matrix.time[prev][n + 1] : cur,
        conflictCount: conflicts
      };
    }

    function routeFinish(route) {
      return routeMetrics(route).finishMin;
    }

    function balanceCost(route) {
      if (!balanceWeight || !route.length) return 0;
      var durationFromDefault = Math.max(0, routeFinish(route) - defaultStart);
      return balanceWeight * Math.pow(durationFromDefault / 60, 2);
    }

    function countConflicts(route) {
      var cur = defaultStart;
      var prev = 0;
      var c = 0;
      route.forEach(function (i) {
        cur += matrix.time[prev][i + 1];
        var dl = taskDeadlineMin(tasks[i]);
        if (dl != null && cur > dl) c++;
        cur += opts.stopMinutes;
        prev = i + 1;
      });
      return c;
    }

    function reorderNearbyFirst(route) {
      var remaining = route.slice();
      var out = [];
      var prev = 0;
      while (remaining.length) {
        var nearby = remaining.filter(function (i) {
          return matrix.dist[prev][i + 1] <= nearbyDistanceM;
        });
        var candidates = nearby.length ? nearby : remaining;
        var best = candidates[0];
        var bestDist = matrix.dist[prev][best + 1];
        for (var ci = 1; ci < candidates.length; ci++) {
          var d = matrix.dist[prev][candidates[ci] + 1];
          if (d < bestDist) {
            best = candidates[ci];
            bestDist = d;
          }
        }
        out.push(best);
        remaining.splice(remaining.indexOf(best), 1);
        prev = best + 1;
      }
      return out;
    }

    function nearbyViolations(route) {
      var remaining = route.slice();
      var prev = 0;
      var count = 0;
      route.forEach(function (i) {
        remaining.splice(remaining.indexOf(i), 1);
        var hasNearby = remaining.some(function (j) {
          return matrix.dist[prev][j + 1] <= nearbyDistanceM;
        });
        if (hasNearby && matrix.dist[prev][i + 1] > nearbyDistanceM) count++;
        prev = i + 1;
      });
      return count;
    }

    function improveRouteOrder(route) {
      if (route.length > 1) {
        var nearbyOrder = reorderNearbyFirst(route);
        if (nearbyOrder.join('|') !== route.join('|') &&
            travel(nearbyOrder) <= travel(route) * 1.1 &&
            routeCost(nearbyOrder) <= routeCost(route) + 15) {
          route.splice.apply(route, [0, route.length].concat(nearbyOrder));
        }
      }
      var changed = true;
      while (changed) {
        changed = false;
        for (var a = 0; a < route.length - 1 && !changed; a++) {
          for (var b = a + 1; b < route.length && !changed; b++) {
            var nr = route.slice();
            var seg = nr.splice(a, b - a + 1).reverse();
            nr.splice.apply(nr, [a, 0].concat(seg));
            if (routeCost(nr) < routeCost(route) - 0.001) {
              route.splice.apply(route, [0, route.length].concat(nr));
              changed = true;
            }
          }
        }
      }
      var finalNearby = reorderNearbyFirst(route);
      if (finalNearby.join('|') !== route.join('|')) {
        var beforeViolations = nearbyViolations(route);
        var afterViolations = nearbyViolations(finalNearby);
        if (afterViolations < beforeViolations ||
            (afterViolations === beforeViolations && routeCost(finalNearby) < routeCost(route) - 0.001)) {
          route.splice.apply(route, [0, route.length].concat(finalNearby));
        }
      }
    }

    function rebalanceRoutes(routes) {
      if (balanceWeight <= 0 || routes.length < 2) return;
      var strength = Math.min(1, balanceWeight / 60);
      var maxPasses = strength >= 0.5 ? 40 : 20;
      for (var pass = 0; pass < maxPasses; pass++) {
        var beforeMax = -1;
        var from = -1;
        for (var ri = 0; ri < routes.length; ri++) {
          var ld = routeLoad(routes[ri]);
          if (ld > beforeMax) {
            beforeMax = ld;
            from = ri;
          }
        }
        var best = null;
        for (var to = 0; to < routes.length; to++) {
          if (to === from) continue;
          if (routeLoad(routes[to]) >= beforeMax - 1) continue;
          for (var ti = 0; ti < routes[from].length; ti++) {
            var task = routes[from][ti];
            var oldFrom = routes[from].slice();
            oldFrom.splice(ti, 1);
            for (var p = 0; p <= routes[to].length; p++) {
              var nr = routes[to].slice();
              nr.splice(p, 0, task);
              var afterFrom = routeLoad(oldFrom);
              var afterTo = routeLoad(nr);
              var afterMax = Math.max(afterFrom, afterTo);
              var maxGain = beforeMax - afterMax;
              var minGain = 1 + (1 - strength) * 3;
              if (maxGain < minGain) continue;
              var beforePen = penalty(routes[from]) + penalty(routes[to]);
              var afterPen = penalty(oldFrom) + penalty(nr);
              var beforeConf = countConflicts(routes[from]) + countConflicts(routes[to]);
              var afterConf = countConflicts(oldFrom) + countConflicts(nr);
              if (afterConf > beforeConf) continue;
              if (afterPen > beforePen + maxGain * 0.5 * strength) continue;
              var driveDelta = (travel(oldFrom) + travel(nr)) - (travel(routes[from]) + travel(routes[to]));
              var driveCap = 2 + (1 - strength) * 2;
              if (driveDelta > maxGain * driveCap) continue;
              var score = maxGain * 2 - driveDelta;
              if (!best || score > best.score ||
                  (Math.abs(score - best.score) < 1e-9 && maxGain > best.maxGain)) {
                best = {
                  from: from,
                  to: to,
                  ti: ti,
                  p: p,
                  maxGain: maxGain,
                  score: score,
                  driveDelta: driveDelta
                };
              }
            }
          }
        }
        if (!best) break;
        var taskMove = routes[best.from][best.ti];
        routes[best.from].splice(best.ti, 1);
        routes[best.to].splice(best.p, 0, taskMove);
        improveRouteOrder(routes[best.from]);
        improveRouteOrder(routes[best.to]);
      }
    }

    function rebalanceReturnTimes(routes) {
      if (balanceLevel <= 0 || routes.length < 2 || n < routes.length) return;
      var targetSpread = Math.max(4, 60 * (1 - balanceLevel / 100));

      function activeIndexes() {
        return routes.map(function (r, ri) {
          return r.length ? ri : -1;
        }).filter(function (ri) { return ri >= 0; });
      }

      function summary() {
        var indexes = activeIndexes();
        var metrics = indexes.map(function (ri) {
          return { ri: ri, metrics: routeMetrics(routes[ri]) };
        });
        var finishes = metrics.map(function (x) { return x.metrics.finishMin; });
        var max = Math.max.apply(null, finishes);
        var min = Math.min.apply(null, finishes);
        return {
          metrics: metrics,
          max: max,
          min: min,
          spread: max - min,
          conflicts: metrics.reduce(function (sum, x) {
            return sum + x.metrics.conflictCount;
          }, 0)
        };
      }

      var maxPasses = balanceLevel >= 80 ? 80 : 45;
      for (var pass = 0; pass < maxPasses; pass++) {
        var before = summary();
        if (before.spread <= targetSpread) break;
        var best = null;

        before.metrics.forEach(function (fromInfo) {
          var from = fromInfo.ri;
          if (routes[from].length <= 1) return;

          for (var ti = 0; ti < routes[from].length; ti++) {
            var task = routes[from][ti];
            var oldFrom = routes[from].slice();
            oldFrom.splice(ti, 1);

            before.metrics.forEach(function (toInfo) {
              var to = toInfo.ri;
              if (to === from) return;

              for (var p = 0; p <= routes[to].length; p++) {
                var nextTo = routes[to].slice();
                nextTo.splice(p, 0, task);
                var oldFromMetrics = routeMetrics(oldFrom);
                var nextToMetrics = routeMetrics(nextTo);
                var after = before.metrics.map(function (info) {
                  if (info.ri === from) return { ri: from, metrics: oldFromMetrics };
                  if (info.ri === to) return { ri: to, metrics: nextToMetrics };
                  return info;
                });
                var finishes = after.map(function (x) { return x.metrics.finishMin; });
                var afterMax = Math.max.apply(null, finishes);
                var afterMin = Math.min.apply(null, finishes);
                var afterSpread = afterMax - afterMin;
                var afterConflicts = after.reduce(function (sum, x) {
                  return sum + x.metrics.conflictCount;
                }, 0);

                if (afterConflicts > before.conflicts) continue;

                var spreadGain = before.spread - afterSpread;
                var maxGain = before.max - afterMax;
                var minGain = afterMin - before.min;
                var driveDelta = (travel(oldFrom) + travel(nextTo)) -
                  (travel(routes[from]) + travel(routes[to]));

                // Only accept moves that improve the return-time balance.
                if (spreadGain < 0.5 && maxGain < 1 && minGain < 1) continue;

                var score = spreadGain * 12 + maxGain * 3 + minGain -
                  Math.max(0, driveDelta) * 0.35;
                if (!best || score > best.score) {
                  best = {
                    from: from,
                    to: to,
                    taskIndex: ti,
                    insertAt: p,
                    score: score,
                    spreadGain: spreadGain,
                    maxGain: maxGain,
                    driveDelta: driveDelta
                  };
                }
              }
            });
          }
        });

        if (!best) break;
        var moved = routes[best.from][best.taskIndex];
        routes[best.from].splice(best.taskIndex, 1);
        routes[best.to].splice(best.insertAt, 0, moved);
        improveRouteOrder(routes[best.from]);
        improveRouteOrder(routes[best.to]);
      }
    }

    function routeCost(route) {
      return travel(route) + penalty(route) + balanceCost(route);
    }

    var order = [];
    var withDeadline = [];
    var without = [];
    tasks.forEach(function (t, i) {
      if (taskDeadlineMin(t) != null) withDeadline.push(i);
      else without.push(i);
    });
    withDeadline.sort(function (a, b) { return taskDeadlineMin(tasks[a]) - taskDeadlineMin(tasks[b]); });
    without.sort(function (a, b) {
      return Geo.estimateTravelMin(matrix.coords[0], matrix.coords[a + 1]) -
        Geo.estimateTravelMin(matrix.coords[0], matrix.coords[b + 1]);
    });
    order = withDeadline.concat(without);

    var seedCount = Math.min(k, n, order.length);
    for (var si = 0; si < seedCount; si++) routes[si].push(order[si]);
    order = order.slice(seedCount);

    function bestForTask(i) {
      var best = { delta: Infinity, ri: -1, pos: -1 };
      var second = Infinity;
      routes.forEach(function (r, ri) {
        for (var p = 0; p <= r.length; p++) {
          var nr = r.slice();
          nr.splice(p, 0, i);
          var delta = routeCost(nr) - routeCost(r);
          if (delta < best.delta) {
            second = best.delta;
            best = { delta: delta, ri: ri, pos: p };
          } else if (delta < second) {
            second = delta;
          }
        }
      });
      return { best: best, second: second };
    }

    while (order.length) {
      var candidates = order.map(function (i) {
        var info = bestForTask(i);
        return {
          i: i,
          regret: info.second - info.best.delta,
          delta: info.best.delta,
          ri: info.best.ri,
          pos: info.best.pos
        };
      });
      candidates.sort(function (a, b) {
        return (b.regret - a.regret) || (a.delta - b.delta);
      });
      var pick = candidates[0];
      routes[pick.ri].splice(pick.pos, 0, pick.i);
      order.splice(order.indexOf(pick.i), 1);
    }

    routes.forEach(function (r) { improveRouteOrder(r); });

    var improved = true;
    var iter = 0;
    while (improved && iter < 90) {
      improved = false;
      iter++;

      for (var i = 0; i < n && !improved; i++) {
        var curRi = -1;
        var curPos = -1;
        for (var ri2 = 0; ri2 < k; ri2++) {
          var pos2 = routes[ri2].indexOf(i);
          if (pos2 >= 0) { curRi = ri2; curPos = pos2; break; }
        }
        var best = null;
        for (var ri = 0; ri < k; ri++) {
          var r = routes[ri];
          for (var p = 0; p <= r.length; p++) {
            if (ri === curRi && (p === curPos || p === curPos + 1)) continue;
            var nr = r.slice();
            var oldR = routes[curRi].slice();
            oldR.splice(oldR.indexOf(i), 1);
            var before;
            var after;
            if (ri === curRi) {
              nr.splice(p, 0, i);
              nr.splice(curPos + (p <= curPos ? 1 : 0), 1);
              after = routeCost(nr);
              before = routeCost(r);
            } else {
              nr.splice(p, 0, i);
              before = routeCost(r) + routeCost(oldR);
              after = routeCost(nr) + routeCost(oldR);
            }
            var delta = after - before;
            if (delta < -0.001 && (ri === curRi || routes[curRi].length > 1) && (!best || delta < best.delta)) {
              best = { ri: ri, p: p, delta: delta };
            }
          }
        }
        if (best) {
          routes[best.ri].splice(best.p, 0, i);
          var removeFrom = routes[curRi];
          removeFrom.splice(removeFrom.indexOf(i), 1);
          improved = true;
        }
      }

      if (!improved) {
        for (var ri3 = 0; ri3 < k && !improved; ri3++) {
          var r3 = routes[ri3];
          for (var a = 0; a < r3.length - 1 && !improved; a++) {
            for (var b = a + 1; b < r3.length && !improved; b++) {
              var nr3 = r3.slice();
              var seg = nr3.splice(a, b - a + 1).reverse();
              nr3.splice.apply(nr3, [a, 0].concat(seg));
              if (routeCost(nr3) < routeCost(r3) - 0.001) {
                routes[ri3] = nr3;
                improved = true;
              }
            }
          }
        }
      }
    }

    rebalanceRoutes(routes);
    rebalanceReturnTimes(routes);
    routes.forEach(function (r) { improveRouteOrder(r); });

    return vehicles.map(function (v, ri) {
      var timeline = computeRouteTimeline(routes[ri], opts);
      return {
        vehicleId: v.id,
        label: '车 ' + (ri + 1),
        plateNo: v.plateNo,
        driverName: v.driverName,
        driverPhone: v.driverPhone,
        color: v.color,
        stops: timeline.stops,
        startMin: timeline.startMin,
        finishMin: timeline.finishMin,
        totalDistanceM: timeline.totalDistanceM,
        totalDurationMin: timeline.totalDurationMin,
        conflictCount: timeline.stops.filter(function (s) { return s.conflict; }).length,
        legs: [],
        waypoints: []
      };
    });
  }

  function solveSmartRoutes(opts) {
    return solveRoutes(opts);
  }

  function clusterCentroid(cluster, tasks) {
    var lng = 0;
    var lat = 0;
    cluster.forEach(function (i) {
      lng += tasks[i].lng;
      lat += tasks[i].lat;
    });
    return { lng: lng / cluster.length, lat: lat / cluster.length };
  }

  function nearestClusterPair(clusters, tasks) {
    var best = null;
    for (var i = 0; i < clusters.length; i++) {
      for (var j = i + 1; j < clusters.length; j++) {
        var d = Geo.estimateDistanceM(clusterCentroid(clusters[i], tasks), clusterCentroid(clusters[j], tasks));
        if (!best || d < best.d) best = { i: i, j: j, d: d };
      }
    }
    return best;
  }

  function mergeClusterAt(clusters, pair) {
    clusters[pair.i] = clusters[pair.i].concat(clusters[pair.j]);
    clusters.splice(pair.j, 1);
  }

  function clusterTasksByProximity(tasks, vehicleCount, thresholdM) {
    var clusters = tasks.map(function (_, i) { return [i]; });
    while (clusters.length > 1) {
      var pair = nearestClusterPair(clusters, tasks);
      if (!pair || pair.d > thresholdM) break;
      mergeClusterAt(clusters, pair);
    }
    while (clusters.length > vehicleCount) {
      var forcePair = nearestClusterPair(clusters, tasks);
      if (!forcePair) break;
      mergeClusterAt(clusters, forcePair);
    }
    return clusters;
  }

  function solveNearbyRoutes(opts) {
    var tasks = opts.tasks;
    var vehicles = opts.vehicles;
    var n = tasks.length;
    var k = vehicles.length;
    if (!n) throw new Error('没有可排任务');
    if (!k) throw new Error('没有可用车辆');
    var thresholdM = Number(opts.nearbyDistanceM) > 0 ? Number(opts.nearbyDistanceM) : 5000;
    var clusters = clusterTasksByProximity(tasks, k, thresholdM);
    var start = opts.matrix.coords[0];
    var end = opts.matrix.hasEnd ? opts.matrix.coords[opts.matrix.size - 1] : null;
    var routes = clusters.map(function (cluster, ci) {
      var subTasks = cluster.map(function (i) { return tasks[i]; });
      var subMatrix = buildMatrix(start, subTasks, null);
      var out = solveRoutes(Object.assign({}, opts, {
        tasks: subTasks,
        vehicles: [vehicles[ci % k]],
        matrix: subMatrix,
        balanceLevel: 0
      }));
      return out[0];
    });
    return routes
      .filter(function (r) { return r && r.stops && r.stops.length; })
      .map(function (r, ci) {
        return Object.assign({}, r, { label: '车 ' + (ci + 1) });
      });
  }

  function computeRouteTimeline(route, opts) {
    var tasks = opts.tasks;
    var matrix = opts.matrix;
    var n = tasks.length;
    var defaultStart = minutes(opts.defaultStartTime);
    if (defaultStart == null) defaultStart = 480;

    var deadlines = route
      .map(function (i) { return taskDeadlineMin(tasks[i]); })
      .filter(function (d) { return d != null; });
    var earliest = deadlines.length ? Math.min.apply(null, deadlines) : null;
    var start = defaultStart;
    if (earliest != null && route.length) {
      var driveFirst = matrix.time[0][route[0] + 1];
      var latest = earliest - driveFirst;
      if (latest >= 300) start = Math.min(start, latest);
    }

    var stops = [];
    var cur = start;
    var prev = 0;
    var totalDist = 0;
    var totalDur = 0;
    route.forEach(function (taskIdx, orderIdx) {
      var drive = matrix.time[prev][taskIdx + 1];
      var dist = matrix.dist[prev][taskIdx + 1];
      var arrival = cur + drive;
      var dl = taskDeadlineMin(tasks[taskIdx]);
      stops.push({
        taskId: tasks[taskIdx].id,
        order: orderIdx + 1,
        etaMin: arrival,
        departMin: arrival + opts.stopMinutes,
        conflict: dl != null && arrival > dl,
        distanceM: dist,
        driveMin: drive
      });
      cur = arrival + opts.stopMinutes;
      prev = taskIdx + 1;
      totalDist += dist;
      totalDur += drive + opts.stopMinutes;
    });
    if (matrix.hasEnd) {
      totalDur += matrix.time[prev][n + 1];
      totalDist += matrix.dist[prev][n + 1];
    }
    return {
      stops: stops,
      startMin: start,
      finishMin: cur,
      totalDistanceM: totalDist,
      totalDurationMin: totalDur
    };
  }

  function applyRealLegs(result, opts) {
    var taskById = {};
    opts.tasks.forEach(function (t) { taskById[t.id] = t; });
    var defaultStart = minutes(opts.defaultStartTime);
    if (defaultStart == null) defaultStart = 480;

    result.routes.forEach(function (r) {
      var legs = r.legs || [];
      var routeTasks = r.stops.map(function (s) { return taskById[s.taskId]; });
      var deadlines = routeTasks
        .map(function (t) { return taskDeadlineMin(t); })
        .filter(function (d) { return d != null; });
      var earliest = deadlines.length ? Math.min.apply(null, deadlines) : null;
      var start = defaultStart;
      if (earliest != null && legs.length) {
        var latest = earliest - legs[0].durationMin;
        if (latest >= 300) start = Math.min(start, latest);
      }

      var stops = [];
      var cur = start;
      legs.forEach(function (leg, idx) {
        if (idx >= routeTasks.length) return;
        var task = routeTasks[idx];
        var arrival = cur + leg.durationMin;
        stops.push({
          taskId: task.id,
          order: idx + 1,
          etaMin: arrival,
          departMin: arrival + opts.stopMinutes,
          conflict: taskDeadlineMin(task) != null && arrival > taskDeadlineMin(task),
          distanceM: leg.distanceM,
          driveMin: leg.durationMin
        });
        cur = arrival + opts.stopMinutes;
      });

      var waypoints = [];
      legs.forEach(function (leg) {
        leg.path.forEach(function (p) {
          var last = waypoints[waypoints.length - 1];
          if (!last || Math.abs(last.lng - p.lng) > 1e-9 || Math.abs(last.lat - p.lat) > 1e-9) {
            waypoints.push(p);
          }
        });
      });

      r.stops = stops;
      r.legs = legs;
      r.waypoints = waypoints;
      r.startMin = start;
      r.finishMin = legs.length ? cur : start;
      r.totalDistanceM = legs.reduce(function (sum, leg) { return sum + leg.distanceM; }, 0);
      r.totalDurationMin = legs.reduce(function (sum, leg) { return sum + leg.durationMin; }, 0) + stops.length * opts.stopMinutes;
      r.conflictCount = stops.filter(function (s) { return s.conflict; }).length;
    });

    var totalDist = 0;
    var totalDur = 0;
    var conflicts = 0;
    var finishTimes = [];
    result.routes.forEach(function (r) {
      totalDist += r.totalDistanceM;
      totalDur += r.totalDurationMin;
      conflicts += r.conflictCount;
      if (r.stops && r.stops.length) finishTimes.push(r.finishMin);
    });
    var returnSpreadMin = finishTimes.length
      ? Math.max.apply(null, finishTimes) - Math.min.apply(null, finishTimes)
      : 0;
    result.summary = {
      taskCount: result.routes.reduce(function (sum, r) { return sum + r.stops.length; }, 0),
      vehicleCount: result.routes.length,
      totalDistanceM: totalDist,
      totalDurationMin: totalDur,
      conflictCount: conflicts,
      returnSpreadMin: returnSpreadMin
    };
    return result;
  }

  function optimizeRouteOrder(opts) {
    var tasks = opts.tasks || [];
    if (!tasks.length) return [];
    var start = opts.start;
    var end = opts.end || null;
    var matrix = buildMatrix(start, tasks, end);
    var route = tasks.map(function (_, i) { return i; });
    var hasEnd = !!matrix.hasEnd;
    var nearbyDistanceM = Number(opts.nearbyDistanceM) > 0 ? Number(opts.nearbyDistanceM) : 5000;
    var defaultStart = minutes(opts.defaultStartTime);
    if (defaultStart == null) defaultStart = 480;
    var stopMinutes = Math.max(0, Number(opts.stopMinutes) || 0);

    function seq(r) {
      var out = [0].concat(r.map(function (x) { return x + 1; }));
      if (hasEnd) out.push(matrix.n + 1);
      return out;
    }

    function travel(r) {
      var s = seq(r);
      var c = 0;
      for (var j = 0; j < s.length - 1; j++) c += matrix.time[s[j]][s[j + 1]];
      return c;
    }

    function penalty(r) {
      var cur = defaultStart;
      var prev = 0;
      var p = 0;
      r.forEach(function (i) {
        cur += matrix.time[prev][i + 1];
        var dl = taskDeadlineMin(tasks[i]);
        if (dl != null && cur > dl) p += 40 + (cur - dl);
        cur += stopMinutes;
        prev = i + 1;
      });
      return p;
    }

    function cost(r) {
      return travel(r) + penalty(r);
    }

    function nearbyViolations(r) {
      var remaining = r.slice();
      var prev = 0;
      var count = 0;
      r.forEach(function (i) {
        remaining.splice(remaining.indexOf(i), 1);
        var hasNearby = remaining.some(function (j) {
          return matrix.dist[prev][j + 1] <= nearbyDistanceM;
        });
        if (hasNearby && matrix.dist[prev][i + 1] > nearbyDistanceM) count++;
        prev = i + 1;
      });
      return count;
    }

    route = (function nearbyOrder(r) {
      var remaining = r.slice();
      var out = [];
      var prev = 0;
      while (remaining.length) {
        var nearby = remaining.filter(function (i) {
          return matrix.dist[prev][i + 1] <= nearbyDistanceM;
        });
        var candidates = nearby.length ? nearby : remaining;
        var best = candidates[0];
        var bestDist = matrix.dist[prev][best + 1];
        for (var ci = 1; ci < candidates.length; ci++) {
          var d = matrix.dist[prev][candidates[ci] + 1];
          if (d < bestDist) {
            best = candidates[ci];
            bestDist = d;
          }
        }
        out.push(best);
        remaining.splice(remaining.indexOf(best), 1);
        prev = best + 1;
      }
      return out;
    })(route);

    var improved = true;
    var guard = 0;
    while (improved && guard < 300) {
      improved = false;
      guard++;
      for (var a = 0; a < route.length - 1 && !improved; a++) {
        for (var b = a + 1; b < route.length && !improved; b++) {
          var nr = route.slice();
          var seg = nr.splice(a, b - a + 1).reverse();
          nr.splice.apply(nr, [a, 0].concat(seg));
          if (cost(nr) < cost(route) - 0.001) {
            route = nr;
            improved = true;
          }
        }
      }
    }
    var finalNearby = (function (r) {
      var remaining = r.slice();
      var out = [];
      var prev = 0;
      while (remaining.length) {
        var nearby = remaining.filter(function (i) {
          return matrix.dist[prev][i + 1] <= nearbyDistanceM;
        });
        var candidates = nearby.length ? nearby : remaining;
        var best = candidates[0];
        var bestDist = matrix.dist[prev][best + 1];
        for (var ci = 1; ci < candidates.length; ci++) {
          var d = matrix.dist[prev][candidates[ci] + 1];
          if (d < bestDist) {
            best = candidates[ci];
            bestDist = d;
          }
        }
        out.push(best);
        remaining.splice(remaining.indexOf(best), 1);
        prev = best + 1;
      }
      return out;
    })(route);
    if (finalNearby.join('|') !== route.join('|')) {
      var beforeViolations = nearbyViolations(route);
      var afterViolations = nearbyViolations(finalNearby);
      if (afterViolations < beforeViolations ||
          (afterViolations === beforeViolations && cost(finalNearby) < cost(route) - 0.001)) {
        route = finalNearby;
      }
    }
    return route.map(function (i) { return tasks[i].id; });
  }

  function balanceRoutesByTime(routeLists, opts) {
    var tasks = opts.tasks || [];
    var matrix = opts.matrix;
    var k = routeLists.length;
    var n = tasks.length;
    if (!n || k < 2) return routeLists;
    var defaultStart = minutes(opts.defaultStartTime);
    if (defaultStart == null) defaultStart = 480;
    var stopMinutes = Math.max(0, Number(opts.stopMinutes) || 0);
    var balanceLevel = Number(opts.balanceLevel);
    if (!isFinite(balanceLevel)) balanceLevel = 70;
    balanceLevel = Math.max(0, Math.min(100, balanceLevel));
    var nearbyDistanceM = Number(opts.nearbyDistanceM) > 0 ? Number(opts.nearbyDistanceM) : 5000;
    var targetSpread = Math.max(5, Math.round(60 * (1 - balanceLevel / 100)));
    var routes = routeLists.map(function (r) { return r.slice(); });

    function seq(route) {
      return [0].concat(route.map(function (x) { return x + 1; }));
    }

    function travel(route) {
      var s = seq(route);
      var c = 0;
      for (var j = 0; j < s.length - 1; j++) c += matrix.time[s[j]][s[j + 1]];
      return c;
    }

    function routeStart(route) {
      var deadlines = route
        .map(function (i) { return taskDeadlineMin(tasks[i]); })
        .filter(function (d) { return d != null; });
      var earliest = deadlines.length ? Math.min.apply(null, deadlines) : null;
      var start = defaultStart;
      if (earliest != null && route.length) {
        var latest = earliest - matrix.time[0][route[0] + 1];
        if (latest >= 300) start = Math.min(start, latest);
      }
      return start;
    }

    function metrics(route) {
      var start = routeStart(route);
      var cur = start;
      var prev = 0;
      var conflicts = 0;
      route.forEach(function (i) {
        cur += matrix.time[prev][i + 1];
        var dl = taskDeadlineMin(tasks[i]);
        if (dl != null && cur > dl) conflicts++;
        cur += stopMinutes;
        prev = i + 1;
      });
      return { startMin: start, finishMin: cur, conflictCount: conflicts };
    }

    function reorderNearby(route) {
      var remaining = route.slice();
      var out = [];
      var prev = 0;
      while (remaining.length) {
        var nearby = remaining.filter(function (i) {
          return matrix.dist[prev][i + 1] <= nearbyDistanceM;
        });
        var candidates = nearby.length ? nearby : remaining;
        var best = candidates[0];
        var bestDist = matrix.dist[prev][best + 1];
        for (var ci = 1; ci < candidates.length; ci++) {
          var d = matrix.dist[prev][candidates[ci] + 1];
          if (d < bestDist) {
            best = candidates[ci];
            bestDist = d;
          }
        }
        out.push(best);
        remaining.splice(remaining.indexOf(best), 1);
        prev = best + 1;
      }
      return out;
    }

    function nearbyViolations(route) {
      var remaining = route.slice();
      var prev = 0;
      var count = 0;
      route.forEach(function (i) {
        remaining.splice(remaining.indexOf(i), 1);
        var hasNearby = remaining.some(function (j) {
          return matrix.dist[prev][j + 1] <= nearbyDistanceM;
        });
        if (hasNearby && matrix.dist[prev][i + 1] > nearbyDistanceM) count++;
        prev = i + 1;
      });
      return count;
    }

    routes = routes.map(reorderNearby);
    var maxPasses = balanceLevel >= 80 ? 80 : 50;
    for (var pass = 0; pass < maxPasses; pass++) {
      var before = routes.map(metrics);
      var finishes = before.map(function (m) { return m.finishMin; });
      var spread = Math.max.apply(null, finishes) - Math.min.apply(null, finishes);
      var conflicts = before.reduce(function (sum, m) { return sum + m.conflictCount; }, 0);
      if (spread <= targetSpread) break;

      var best = null;
      for (var fi = 0; fi < k; fi++) {
        if (routes[fi].length <= 1) continue;
        for (var ti = 0; ti < routes[fi].length; ti++) {
          var task = routes[fi][ti];
          var oldFrom = routes[fi].slice();
          oldFrom.splice(ti, 1);
          for (var to = 0; to < k; to++) {
            if (to === fi) continue;
            for (var p = 0; p <= routes[to].length; p++) {
              var nextTo = routes[to].slice();
              nextTo.splice(p, 0, task);
              var oldFromM = metrics(oldFrom);
              var nextToM = metrics(nextTo);
              var after = before.map(function (m, ri) {
                if (ri === fi) return oldFromM;
                if (ri === to) return nextToM;
                return m;
              });
              var afterFinishes = after.map(function (m) { return m.finishMin; });
              var afterSpread = Math.max.apply(null, afterFinishes) - Math.min.apply(null, afterFinishes);
              var afterConflicts = after.reduce(function (sum, m) { return sum + m.conflictCount; }, 0);
              if (afterConflicts > conflicts) continue;

              var spreadGain = spread - afterSpread;
              var maxGain = Math.max.apply(null, finishes) - Math.max.apply(null, afterFinishes);
              var minGain = Math.min.apply(null, afterFinishes) - Math.min.apply(null, finishes);
              if (spreadGain < 0.5 && maxGain < 1 && minGain < 1) continue;

              var driveDelta = (travel(oldFrom) + travel(nextTo)) -
                (travel(routes[fi]) + travel(routes[to]));
              var beforeNearby = nearbyViolations(routes[fi]) + nearbyViolations(routes[to]);
              var afterNearby = nearbyViolations(oldFrom) + nearbyViolations(nextTo);
              if (afterNearby > beforeNearby + 2) continue;
              var detourCap = 8 + (1 - balanceLevel / 100) * 18;
              if (driveDelta > detourCap) continue;

              var score = spreadGain * 12 + maxGain * 3 + minGain -
                Math.max(0, driveDelta) * 0.35 -
                (afterNearby - beforeNearby) * 8;
              if (!best || score > best.score) {
                best = { fi: fi, ti: ti, to: to, p: p, score: score };
              }
            }
          }
        }
      }
      if (!best) break;

      var movedTask = routes[best.fi][best.ti];
      routes[best.fi].splice(best.ti, 1);
      routes[best.to].splice(best.p, 0, movedTask);
      routes[best.fi] = reorderNearby(routes[best.fi]);
      routes[best.to] = reorderNearby(routes[best.to]);
    }
    return routes;
  }

  global.Planning = {
    minutes: minutes,
    toHHMM: toHHMM,
    buildMatrix: buildMatrix,
    solveRoutes: solveRoutes,
    solveSmartRoutes: solveSmartRoutes,
    solveNearbyRoutes: solveNearbyRoutes,
    applyRealLegs: applyRealLegs,
    optimizeRouteOrder: optimizeRouteOrder,
    balanceRoutesByTime: balanceRoutesByTime
  };
})(window);
