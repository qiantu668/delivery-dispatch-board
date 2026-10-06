(function (global) {
  'use strict';

  var AMAP_SCRIPT = 'https://webapi.amap.com/maps';
  var ROAD_FACTOR = 1.42;
  var AVG_SPEED = 24;
  var OFFLINE_TIME_BUFFER = 1.2;
  var AMAP_GEOCODE_TIMEOUT = 15000;
  var AMAP_ROUTE_TIMEOUT = 20000;
  var DEMO_CENTER = { lng: 121.47, lat: 31.23 };
  var OFFLINE_MAP_LAYERS = [
    {
      zoom: 10,
      x0: 855,
      y0: 415,
      cols: 5,
      rows: 6,
      tileSize: 256,
      dir: 'assets/map/shanghai-z10/',
      west: 120.5859375,
      east: 122.34375,
      south: 30.448673679287566,
      north: 32.249974455863295
    },
    {
      zoom: 12,
      x0: 3428,
      y0: 1670,
      cols: 5,
      rows: 8,
      tileSize: 256,
      dir: 'assets/map/shanghai-z12/',
      west: 121.30,
      east: 121.72,
      south: 30.95,
      north: 31.50
    },
    {
      zoom: 13,
      x0: 6856,
      y0: 3340,
      cols: 10,
      rows: 15,
      tileSize: 256,
      dir: 'assets/map/shanghai-z13/',
      west: 121.30,
      east: 121.72,
      south: 30.95,
      north: 31.50
    },
    {
      zoom: 14,
      x0: 13717,
      y0: 6684,
      cols: 11,
      rows: 21,
      tileSize: 256,
      dir: 'assets/map/shanghai-z14/',
      west: 121.40,
      east: 121.62,
      south: 31.05,
      north: 31.42
    }
  ];

  var ROUGH_REGIONS = [
    { keys: ['召楼路'], lng: 121.5070, lat: 31.0700, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['竹园路'], lng: 121.4910, lat: 31.0620, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['沈梅东路'], lng: 121.5850, lat: 31.1160, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['三三公路', '振东路'], lng: 121.8320, lat: 30.9850, radiusLng: 0.035, radiusLat: 0.022 },
    { keys: ['芦硕路', '方竹路', '水芸路'], lng: 121.9250, lat: 30.9010, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['龙吴路'], lng: 121.4590, lat: 31.0480, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['颛兴路'], lng: 121.4030, lat: 31.0730, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['山林道', '老宅里路'], lng: 121.4140, lat: 31.1170, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['石龙路', '浦北路'], lng: 121.4210, lat: 31.1600, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['漕宝路'], lng: 121.3850, lat: 31.1660, radiusLng: 0.035, radiusLat: 0.022 },
    { keys: ['紫藤路'], lng: 121.3690, lat: 31.1970, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['丹巴路'], lng: 121.3890, lat: 31.2240, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['虹梅南路'], lng: 121.4050, lat: 31.1550, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['曹安路'], lng: 121.3240, lat: 31.2400, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['鹤槎路'], lng: 121.3180, lat: 31.2420, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['宝安公路'], lng: 121.2810, lat: 31.3810, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['嘉戬公路'], lng: 121.2940, lat: 31.3930, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['叶城路'], lng: 121.2380, lat: 31.4060, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['祁昌路'], lng: 121.2350, lat: 31.4140, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['瞿门路'], lng: 121.1750, lat: 31.3720, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['海仓路'], lng: 121.1160, lat: 31.4490, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['康桥路'], lng: 121.5770, lat: 31.1520, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['环科路', '高科中路'], lng: 121.6080, lat: 31.2030, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['运盐河路'], lng: 121.6840, lat: 31.1350, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['顾唐路'], lng: 121.6320, lat: 31.2470, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['佳林路', '金桥路', '栖山路'], lng: 121.6050, lat: 31.2620, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['双阳支路', '控江路', '本溪路'], lng: 121.5230, lat: 31.2840, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['祥德路', '东江湾路'], lng: 121.4800, lat: 31.2730, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['国权北路', '新二路', '殷高西路'], lng: 121.4900, lat: 31.3280, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['共和新路', '新沪路'], lng: 121.4510, lat: 31.2920, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['聚丰园路'], lng: 121.3830, lat: 31.3410, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['陆翔路', '红林路'], lng: 121.4270, lat: 31.3750, radiusLng: 0.035, radiusLat: 0.022 },
    { keys: ['共宝路'], lng: 121.4490, lat: 31.3370, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['潘泾路'], lng: 121.3870, lat: 31.4080, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['市一路', '集贤路', '罗东路'], lng: 121.3630, lat: 31.4620, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['上南路', '三林路', '杨南路'], lng: 121.5100, lat: 31.1420, radiusLng: 0.035, radiusLat: 0.022 },
    { keys: ['长乐路'], lng: 121.4560, lat: 31.2140, radiusLng: 0.02, radiusLat: 0.013 },
    { keys: ['定西路'], lng: 121.4320, lat: 31.2170, radiusLng: 0.02, radiusLat: 0.013 },
    { keys: ['黄陂南路', '河南南路'], lng: 121.4820, lat: 31.2180, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['金闸公路'], lng: 121.5010, lat: 30.9730, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['国顺路', '通阳路'], lng: 121.4640, lat: 30.9270, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['海思路'], lng: 121.4550, lat: 30.8870, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['海汇街'], lng: 121.3340, lat: 30.7420, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['朱枫公路'], lng: 121.1000, lat: 30.9100, radiusLng: 0.08, radiusLat: 0.05 },
    { keys: ['三新路'], lng: 121.2120, lat: 31.0400, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['文翔路'], lng: 121.2160, lat: 31.0480, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['平原公路'], lng: 121.1530, lat: 30.9790, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['王家库路'], lng: 121.1850, lat: 31.0320, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['沪松公路'], lng: 121.2530, lat: 31.1240, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['泗宝路'], lng: 121.2630, lat: 31.1170, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['华志路'], lng: 121.2300, lat: 31.2320, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['龙联路'], lng: 121.3010, lat: 31.1830, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['沪亭北路', '蒲汇路'], lng: 121.3300, lat: 31.1700, radiusLng: 0.025, radiusLat: 0.016 },
    { keys: ['上海市松江区', '松江区', '佘山镇'], lng: 121.2277, lat: 31.0326, radiusLng: 0.08, radiusLat: 0.05 },
    { keys: ['上海市闵行区', '闵行区'], lng: 121.3817, lat: 31.1129, radiusLng: 0.08, radiusLat: 0.05 },
    { keys: ['上海市青浦区', '青浦区'], lng: 121.1242, lat: 31.1507, radiusLng: 0.09, radiusLat: 0.06 },
    { keys: ['上海市浦东新区', '浦东新区', '陆家嘴'], lng: 121.5447, lat: 31.2222, radiusLng: 0.11, radiusLat: 0.07 },
    { keys: ['上海市嘉定区', '嘉定区'], lng: 121.2653, lat: 31.3756, radiusLng: 0.09, radiusLat: 0.06 },
    { keys: ['黄浦区', '人民广场', '外滩'], lng: 121.4905, lat: 31.2343, radiusLng: 0.05, radiusLat: 0.04 },
    { keys: ['徐汇区', '徐家汇'], lng: 121.4368, lat: 31.1883, radiusLng: 0.07, radiusLat: 0.05 },
    { keys: ['长宁区', '虹桥', '中山公园'], lng: 121.4186, lat: 31.2181, radiusLng: 0.07, radiusLat: 0.05 },
    { keys: ['静安区', '静安寺'], lng: 121.4488, lat: 31.2298, radiusLng: 0.06, radiusLat: 0.04 },
    { keys: ['普陀区', '普陀'], lng: 121.3956, lat: 31.2495, radiusLng: 0.07, radiusLat: 0.05 },
    { keys: ['虹口区', '虹口'], lng: 121.4917, lat: 31.2646, radiusLng: 0.06, radiusLat: 0.04 },
    { keys: ['杨浦区', '五角场'], lng: 121.5137, lat: 31.3008, radiusLng: 0.07, radiusLat: 0.05 },
    { keys: ['上海市', '上海'], lng: 121.4737, lat: 31.2304, radiusLng: 0.22, radiusLat: 0.14 },

    { keys: ['浦江镇'], lng: 121.5030, lat: 31.0690, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['周浦镇'], lng: 121.5800, lat: 31.1110, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['奉城镇'], lng: 121.6610, lat: 30.9130, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['四团镇'], lng: 121.7350, lat: 30.9370, radiusLng: 0.045, radiusLat: 0.028 },
    { keys: ['泥城镇'], lng: 121.8390, lat: 30.9030, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['南汇新城镇', '临港新城', '临港'], lng: 121.9250, lat: 30.9010, radiusLng: 0.07, radiusLat: 0.045 },
    { keys: ['书院镇'], lng: 121.8300, lat: 30.9880, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['吴泾镇'], lng: 121.4650, lat: 31.0440, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['颛桥镇'], lng: 121.3970, lat: 31.0720, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['莘庄镇', '莘庄'], lng: 121.3830, lat: 31.1140, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['梅陇镇'], lng: 121.4210, lat: 31.1200, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['漕河泾街道', '漕河泾'], lng: 121.4170, lat: 31.1620, radiusLng: 0.03, radiusLat: 0.02 },
    { keys: ['江桥镇'], lng: 121.3250, lat: 31.2380, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['马陆镇'], lng: 121.2870, lat: 31.3740, radiusLng: 0.06, radiusLat: 0.04 },
    { keys: ['菊园新区'], lng: 121.2350, lat: 31.3980, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['外冈镇'], lng: 121.1780, lat: 31.3680, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['唐镇'], lng: 121.6520, lat: 31.2050, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['张江镇', '张江'], lng: 121.6050, lat: 31.2000, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['祝桥镇'], lng: 121.7460, lat: 31.1060, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['康桥镇'], lng: 121.5740, lat: 31.1510, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['金桥镇', '金桥'], lng: 121.6250, lat: 31.2650, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['高行镇'], lng: 121.5980, lat: 31.3110, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['顾村镇'], lng: 121.4220, lat: 31.3510, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['杨行镇'], lng: 121.4450, lat: 31.3880, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['罗店镇'], lng: 121.3480, lat: 31.4630, radiusLng: 0.06, radiusLat: 0.04 },
        { keys: ['沿浦公路2389号12仓3号', '沿浦公路2389号', '沿浦公路 2389 号'], lng: 121.541458, lat: 30.980046, radiusLng: 0, radiusLat: 0 },
{ keys: ['金汇镇'], lng: 121.4930, lat: 30.9700, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['南桥镇'], lng: 121.4600, lat: 30.9180, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['泗泾镇'], lng: 121.2540, lat: 31.1110, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['华新镇'], lng: 121.2210, lat: 31.2380, radiusLng: 0.05, radiusLat: 0.032 },
    { keys: ['徐泾镇'], lng: 121.3020, lat: 31.1850, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['七宝镇', '七宝'], lng: 121.3610, lat: 31.1580, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['华漕镇'], lng: 121.3030, lat: 31.2140, radiusLng: 0.04, radiusLat: 0.025 },
    { keys: ['城厢镇'], lng: 121.1220, lat: 31.4480, radiusLng: 0.04, radiusLat: 0.025 },

    { keys: ['崇明区', '崇明岛'], lng: 121.3976, lat: 31.6269, radiusLng: 0.12, radiusLat: 0.08 },
    { keys: ['奉贤区', '奉贤'], lng: 121.4740, lat: 30.9180, radiusLng: 0.12, radiusLat: 0.08 },
    { keys: ['金山区', '金山'], lng: 121.3416, lat: 30.7414, radiusLng: 0.12, radiusLat: 0.08 },
    { keys: ['南汇', '惠南镇', '临港新片区', '临港'], lng: 121.7602, lat: 30.8839, radiusLng: 0.14, radiusLat: 0.09 },
    { keys: ['上海市', '上海'], lng: 121.4737, lat: 31.2304, radiusLng: 0.22, radiusLat: 0.14 },

    { keys: ['苏州市', '苏州'], lng: 120.5853, lat: 31.2989, radiusLng: 0.30, radiusLat: 0.20, level: 'city' },
    { keys: ['昆山市', '昆山'], lng: 120.9807, lat: 31.3856, radiusLng: 0.18, radiusLat: 0.12, level: 'city' },
    { keys: ['太仓市', '太仓'], lng: 121.1306, lat: 31.4579, radiusLng: 0.16, radiusLat: 0.11, level: 'city' },
    { keys: ['常熟市', '常熟'], lng: 120.7525, lat: 31.6546, radiusLng: 0.18, radiusLat: 0.12, level: 'city' },
    { keys: ['张家港市', '张家港'], lng: 120.5550, lat: 31.8755, radiusLng: 0.18, radiusLat: 0.12, level: 'city' },
    { keys: ['无锡市', '无锡'], lng: 120.3119, lat: 31.4912, radiusLng: 0.24, radiusLat: 0.16, level: 'city' },
    { keys: ['常州市', '常州'], lng: 119.9741, lat: 31.8112, radiusLng: 0.26, radiusLat: 0.18, level: 'city' },
    { keys: ['南通市', '南通'], lng: 120.8943, lat: 31.9807, radiusLng: 0.26, radiusLat: 0.18, level: 'city' },
    { keys: ['启东市', '启东'], lng: 121.6574, lat: 31.8082, radiusLng: 0.18, radiusLat: 0.12, level: 'city' },
    { keys: ['嘉兴市', '嘉兴'], lng: 120.7555, lat: 30.7461, radiusLng: 0.24, radiusLat: 0.16, level: 'city' },
    { keys: ['湖州市', '湖州'], lng: 120.0868, lat: 30.8943, radiusLng: 0.24, radiusLat: 0.16, level: 'city' }
  ];

  var KNOWN_PLACES = [
    { name: '金汇沿浦仓', address: '上海市奉贤区金汇镇沿浦公路2389号12仓3号', lng: 121.541458, lat: 30.980046 },
    { name: '人民广场配送点', address: '上海市黄浦区人民广场', lng: 121.4737, lat: 31.2304 },
    { name: '虹桥枢纽门店', address: '上海市闵行区虹桥路', lng: 121.3270, lat: 31.1979 },
    { name: '陆家嘴收货点', address: '上海市浦东新区陆家嘴环路', lng: 121.4998, lat: 31.2397 },
    { name: '徐家汇商圈', address: '上海市徐汇区徐家汇', lng: 121.4368, lat: 31.1883 },
    { name: '五角场配送点', address: '上海市杨浦区五角场', lng: 121.5137, lat: 31.3008 },
    { name: '静安寺门店', address: '上海市静安区南京西路', lng: 121.4457, lat: 31.2231 },
    { name: '张江配送中心', address: '上海市浦东新区张江路', lng: 121.6084, lat: 31.2079 },
    { name: '松江大学城门店', address: '上海市松江区文汇路', lng: 121.2216, lat: 31.0545 }
  ];

  var service = {
    mode: 'demo',
    key: '',
    securityCode: '',
    loadedKey: '',
    loadedCode: '',
    loaded: false,
    loading: false,
    error: ''
  };

  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  function safeColor(v) {
    return COLOR_RE.test(String(v || '')) ? String(v) : '#2563EB';
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setKey(key, securityCode) {
    var k = (key || '').trim();
    var code = (securityCode || '').trim();
    service.key = k;
    service.securityCode = code;
    service.error = '';
    if (!k) {
      service.mode = 'demo';
      service.loaded = false;
      service.loading = false;
      service.loadedKey = '';
      service.loadedCode = '';
      delete window._AMapSecurityConfig;
      return Promise.resolve('demo');
    }
    if (service.mode === 'amap' && service.loaded &&
        service.loadedKey === k && service.loadedCode === code) {
      return Promise.resolve('amap');
    }
    return loadAmapScript(k, code);
  }

  function loadAmapScript(key, securityCode) {
    service.securityCode = securityCode || '';
    if (service.loading) {
      return new Promise(function (resolve, reject) {
        var timer = setInterval(function () {
          if (!service.loading) {
            clearInterval(timer);
            if (service.mode === 'amap') resolve('amap');
            else reject(new Error(service.error || '加载失败'));
          }
        }, 120);
        setTimeout(function () {
          clearInterval(timer);
          reject(new Error('高德地图加载超时，已退回演示模式'));
        }, 12000);
      });
    }

    return new Promise(function (resolve, reject) {
      if (window.AMap && window.AMap.version &&
          service.loadedKey === key && service.loadedCode === service.securityCode) {
        service.mode = 'amap';
        service.loaded = true;
        resolve('amap');
        return;
      }

      service.loading = true;
      var cb = '__dispatchAmapReady';
      var timedOut = false;
      var timeoutTimer = setTimeout(function () {
        timedOut = true;
        service.loading = false;
        service.loaded = false;
        service.loadedKey = '';
        service.loadedCode = '';
        service.mode = 'demo';
        service.error = '高德地图加载超时，已退回演示模式';
        delete window[cb];
        reject(new Error(service.error));
      }, 12000);
      window[cb] = function () {
        if (timedOut) return;
        clearTimeout(timeoutTimer);
        service.loading = false;
        service.loaded = true;
        service.loadedKey = key;
        service.loadedCode = service.securityCode;
        service.mode = 'amap';
        delete window[cb];
        resolve('amap');
      };

      if (service.securityCode) {
        window._AMapSecurityConfig = { securityJsCode: service.securityCode };
      } else {
        delete window._AMapSecurityConfig;
      }

      var s = document.createElement('script');
      s.src = AMAP_SCRIPT + '?v=2.0&key=' + encodeURIComponent(key) +
        '&plugin=AMap.Driving,AMap.Geocoder,AMap.AutoComplete,AMap.PlaceSearch&callback=' + cb +
        (service.securityCode ? '&securityJsCode=' + encodeURIComponent(service.securityCode) : '');
      s.onerror = function () {
        if (timedOut) return;
        clearTimeout(timeoutTimer);
        service.loading = false;
        service.loaded = false;
        service.loadedKey = '';
        service.loadedCode = '';
        service.mode = 'demo';
        service.error = '高德 JS API 加载失败，已退回演示模式';
        delete window[cb];
        reject(new Error(service.error));
      };
      document.head.appendChild(s);
    });
  }

  function autocomplete(query) {
    query = (query || '').trim();
    if (!query) return Promise.resolve([]);

    if (service.mode === 'amap') {
      return new Promise(function (resolve) {
        try {
          var auto = new AMap.AutoComplete({ city: '全国' });
          auto.search(query, function (status, result) {
            if (status === 'complete' && result && result.tips) {
              resolve(result.tips
                .filter(function (t) { return t.location; })
                .slice(0, 8)
                .map(function (t) {
                  return {
                    name: t.name,
                    address: (t.district || '') + (t.address || ''),
                    lng: t.location.lng,
                    lat: t.location.lat,
                    demo: false
                  };
                }));
            } else {
              resolve([]);
            }
          });
        } catch (e) {
          resolve([]);
        }
      });
    }

    var q = query.toLowerCase();
    var hits = KNOWN_PLACES.filter(function (p) {
      return p.name.toLowerCase().indexOf(q) >= 0 || p.address.toLowerCase().indexOf(q) >= 0;
    }).slice(0, 5);
    if (!hits.length) {
      try {
        var rough = roughGeocode(query);
        return Promise.resolve([{
          name: '按当前地址粗定位',
          address: query + (rough.level === 'city' ? '（周边城市粗定位）' : '（上海区域估算）'),
          lng: rough.lng,
          lat: rough.lat,
          demo: true
        }]);
      } catch (e) {
        return Promise.resolve([]);
      }
    }
    return Promise.resolve(hits.map(function (h) {
      return { name: h.name, address: h.address, lng: h.lng, lat: h.lat, demo: true };
    }));
  }

  function normalizeAddressText(address) {
    return String(address || '')
      .replace(/[\u3000\r\n\t]+/g, ' ')
      .replace(/^\s*(地址|送货地址|收货地址)\s*[:：]\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/[，,]+/g, ' ')
      .trim();
  }

  function addressCandidates(address) {
    var raw = String(address || '').trim();
    var normalized = normalizeAddressText(raw);
    var candidates = [];
    function add(value) {
      value = String(value || '').trim();
      if (value && candidates.indexOf(value) < 0) candidates.push(value);
    }
    add(raw);
    add(normalized);
    if (/上海(市)?/.test(normalized) && !/^上海市/.test(normalized)) {
      add('上海市' + normalized.replace(/^上海/, ''));
    }
    if (/上海市|上海/.test(normalized) && /区|县/.test(normalized)) {
      add(normalized.replace(/[（(][^）)]*[）)]/g, ''));
    }
    return candidates.slice(0, 4);
  }

  function formatAmapLocation(location) {
    if (!location) return null;
    var lng = Number(location.lng);
    var lat = Number(location.lat);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    return { lng: lng, lat: lat };
  }

  function geocodeWithAmap(address) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, AMAP_GEOCODE_TIMEOUT);
      try {
        var geocoder = new AMap.Geocoder({ city: '全国' });
        geocoder.getLocation(address, function (status, result) {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          if (status === 'complete' && result && result.geocodes && result.geocodes.length) {
            var g = result.geocodes[0];
            var point = formatAmapLocation(g.location);
            if (point) {
              point.formatted = g.formattedAddress || address;
              resolve(point);
              return;
            }
          }
          reject(new Error(result && (result.info || result.message) || 'not_found'));
        });
      } catch (err) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  function searchAmapPoi(address) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, AMAP_GEOCODE_TIMEOUT);
      try {
        var search = new AMap.PlaceSearch({ city: '全国', pageSize: 10 });
        search.search(address, function (status, result) {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          var pois = result && result.poiList && result.poiList.pois || [];
          for (var i = 0; i < pois.length; i += 1) {
            var point = formatAmapLocation(pois[i].location);
            if (point) {
              point.formatted = pois[i].address || pois[i].name || address;
              resolve(point);
              return;
            }
          }
          reject(new Error(status === 'complete' ? 'not_found' : 'search_failed'));
        });
      } catch (err) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });
  }

  function geocode(address) {
    address = (address || '').trim();
    if (!address) return Promise.reject(new Error('地址为空'));

    if (service.mode === 'amap') {
      var candidates = addressCandidates(address);
      var lastError = '';
      var tryGeocoder = function (index) {
        if (index >= candidates.length) {
          return searchAmapPoi(candidates[0]).catch(function (err) {
            var detail = lastError || (err && err.message) || '未找到';
            throw new Error('高德未找到地址：' + address + '（' + detail + '）');
          });
        }
        return geocodeWithAmap(candidates[index]).catch(function (err) {
          lastError = err && err.message ? err.message : '解析失败';
          return tryGeocoder(index + 1);
        });
      };
      return tryGeocoder(0);
    }

    var known = KNOWN_PLACES.find(function (p) {
      return address.indexOf(p.name) >= 0 || p.name.indexOf(address) >= 0 || address.indexOf(p.address) >= 0;
    });
    if (known) {
      return Promise.resolve({ lng: known.lng, lat: known.lat, formatted: known.address });
    }
    try {
      return Promise.resolve(roughGeocode(address));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function roughGeocode(address) {
    var region = matchRoughRegion(address);
    if (region.unsupported) {
      throw new Error('当前离线粗定位支持上海及周边指定城市，请补充城市名称，例如“苏州市 + 详细地址”');
    }
    var h = fnv1a(address);
    var lngOffset = (((h & 0xffff) % 10000) / 10000 - 0.5) * region.radiusLng;
    var latOffset = ((((h >>> 16) & 0xffff) % 10000) / 10000 - 0.5) * region.radiusLat;
    return {
      lng: round6(region.lng + lngOffset),
      lat: round6(region.lat + latOffset),
      formatted: address,
      rough: true,
      level: region.level || 'district',
      source: region.label
    };
  }

  function matchRoughRegion(address) {
    var text = String(address || '');
    var best = null;
    ROUGH_REGIONS.forEach(function (r) {
      r.keys.forEach(function (key) {
        if (text.indexOf(key) < 0) return;
        var score = key.length;
        if (!best || score > best.score) {
          best = {
            score: score,
            label: key,
            lng: r.lng,
            lat: r.lat,
            radiusLng: r.radiusLng,
            radiusLat: r.radiusLat,
            level: r.level || 'district'
          };
        }
      });
    });
    return best || {
      label: '上海市中心估算',
      lng: DEMO_CENTER.lng,
      lat: DEMO_CENTER.lat,
      radiusLng: 0.24,
      radiusLat: 0.16,
      level: 'city',
      unsupported: /北京|天津|重庆|广州|深圳|东莞|佛山|广东|江苏|浙江|苏州|杭州|南京|无锡|常州|宁波|合肥|武汉|成都|西安/.test(text)
    };
  }

  function routeLegs(points) {
    if (!Array.isArray(points) || points.length < 2) return Promise.resolve([]);
    if (service.mode === 'amap') return routeLegsAmap(points);
    return Promise.resolve(routeLegsDemo(points));
  }

  function routeLegsAmap(points) {
    if (!Array.isArray(points) || points.length < 2) return Promise.resolve([]);
    var searches = [];
    for (var i = 0; i < points.length - 1; i += 1) {
      (function (fromPoint, toPoint, legIndex) {
        searches.push(new Promise(function (resolve, reject) {
        var settled = false;
        var driver = new AMap.Driving({ policy: AMap.DrivingPolicy.LEAST_TIME, showTraffic: true });
        var from = new AMap.LngLat(fromPoint.lng, fromPoint.lat);
        var to = new AMap.LngLat(toPoint.lng, toPoint.lat);
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(new Error('高德路径规划超时：第 ' + (legIndex + 1) + ' 段'));
        }, AMAP_ROUTE_TIMEOUT);
        driver.search(from, to, function (status, result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (status === 'complete' && result.routes && result.routes.length) {
            var route = result.routes[0];
            var path = [];
            route.steps.forEach(function (step) {
              path = path.concat(step.path || []);
            });
            resolve({
              index: legIndex,
              distanceM: route.distance,
              durationMin: Math.max(1, Math.round(route.time / 60)),
              path: path.map(function (p) { return { lng: p.lng, lat: p.lat }; })
            });
          } else {
            var info = result && (result.info || result.message);
            reject(new Error('高德路径规划失败：第 ' + (legIndex + 1) + ' 段' + (info ? '（' + info + '）' : '')));
          }
        });
        }));
      }(points[i], points[i + 1], i));
    }

    return Promise.all(searches).then(function (legs) {
      return legs.sort(function (a, b) { return a.index - b.index; }).map(function (leg) {
        delete leg.index;
        return leg;
      });
    });
  }

  function routeLegsDemo(points) {
    if (!Array.isArray(points) || points.length < 2) return [];
    var legs = [];
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      var straight = haversineM(a, b);
      var dist = straight * ROAD_FACTOR;
      legs.push({
      distanceM: Math.round(dist),
      durationMin: Math.max(1, Math.round(dist / 1000 / AVG_SPEED * 60 * OFFLINE_TIME_BUFFER)),
      path: curvePath(a, b, i)
      });
    }
    return legs;
  }

  function curvePath(a, b, seed) {
    var steps = 9;
    var out = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var lng = a.lng + (b.lng - a.lng) * t;
      var lat = a.lat + (b.lat - a.lat) * t;
      var wobble = Math.sin(t * Math.PI) * 0.0016 * Math.sin(seed * 12.9898 + i * 78.233);
      lng += wobble;
      lat += Math.cos(seed * 4.33 + i * 13.37) * wobble * 0.6;
      out.push({ lng: round6(lng), lat: round6(lat) });
    }
    return out;
  }

  function estimateTravelMin(a, b) {
    var d = haversineM(a, b) * ROAD_FACTOR;
    return Math.max(1, Math.round(d / 1000 / AVG_SPEED * 60 * OFFLINE_TIME_BUFFER));
  }

  function estimateDistanceM(a, b) {
    return Math.round(haversineM(a, b) * ROAD_FACTOR);
  }

  function haversineM(a, b) {
    var R = 6371000;
    var rad = function (x) { return x * Math.PI / 180; };
    var dLat = rad(b.lat - a.lat);
    var dLng = rad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  function openAmapNavigation(lng, lat, name) {
    return 'https://uri.amap.com/navigation?to=' + lng + ',' + lat + ',' + encodeURIComponent(name) +
      '&mode=car&policy=1&src=dispatch_board&coordinate=gaode';
  }

  function openMapSearch(address, name) {
    var q = (address || name || '').trim();
    if (!q) return '#';
    return 'https://uri.amap.com/search?keyword=' + encodeURIComponent(q) + '&src=dispatch_board';
  }

  function webMercatorPx(lng, lat, zoom) {
    var n = 256 * Math.pow(2, zoom);
    var x = (lng + 180) / 360 * n;
    var sinLat = Math.sin(lat * Math.PI / 180);
    var y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
    return { x: x, y: y };
  }

  var OFFLINE_MASTER_ZOOM = OFFLINE_MAP_LAYERS[OFFLINE_MAP_LAYERS.length - 1].zoom;
  var OFFLINE_BASE_LAYER = OFFLINE_MAP_LAYERS[0];

  function layerScale(layer) {
    return Math.pow(2, OFFLINE_MASTER_ZOOM - layer.zoom);
  }

  function layerExtent(layer) {
    var scale = layerScale(layer);
    return {
      w: layer.cols * layer.tileSize * scale,
      h: layer.rows * layer.tileSize * scale,
      origin: webMercatorPx(layer.west, layer.north, OFFLINE_MASTER_ZOOM)
    };
  }

  function layersContaining(points) {
    return OFFLINE_MAP_LAYERS.filter(function (layer) {
      return points.every(function (p) {
        return p.lng >= layer.west && p.lng <= layer.east &&
          p.lat >= layer.south && p.lat <= layer.north;
      });
    });
  }

  function layersTouching(points) {
    return OFFLINE_MAP_LAYERS.filter(function (layer) {
      return points.some(function (p) {
        return p.lng >= layer.west && p.lng <= layer.east &&
          p.lat >= layer.south && p.lat <= layer.north;
      });
    });
  }

  function chooseMapLayer(viewBox, points, px) {
    var visible = points;
    if (px && points.length) {
      var x0 = viewBox.x;
      var y0 = viewBox.y;
      var x1 = viewBox.x + viewBox.w;
      var y1 = viewBox.y + viewBox.h;
      visible = points.filter(function (p) {
        var q = px(p);
        return q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
      });
      if (!visible.length) visible = points;
    }
    var candidates = layersContaining(visible);
    if (!candidates.length) candidates = layersTouching(visible);
    if (!candidates.length) return null;
    var best = candidates[0];
    candidates.forEach(function (layer) {
      var ext = layerExtent(layer);
      var fits = viewBox.w <= ext.w * 1.02 && viewBox.h <= ext.h * 1.02;
      if (fits && layer.zoom > best.zoom) best = layer;
    });
    return best;
  }

  function offlineTileSvg(layer) {
    var out = '';
    var scale = layerScale(layer);
    var ext = layerExtent(layer);
    var globalOrigin = layerExtent(OFFLINE_BASE_LAYER).origin;
    for (var row = 0; row < layer.rows; row++) {
      for (var col = 0; col < layer.cols; col++) {
        var x = layer.x0 + col;
        var y = layer.y0 + row;
        var px = ext.origin.x + col * layer.tileSize * scale - globalOrigin.x;
        var py = ext.origin.y + row * layer.tileSize * scale - globalOrigin.y;
        out += '<image href="' + layer.dir + layer.zoom + '-' + x + '-' + y + '.png" ' +
          'xlink:href="' + layer.dir + layer.zoom + '-' + x + '-' + y + '.png" ' +
          'x="' + px + '" ' +
          'y="' + py + '" ' +
          'width="' + (layer.tileSize * scale) + '" height="' + (layer.tileSize * scale) + '" ' +
          'preserveAspectRatio="none" class="dm-tile"/>';
      }
    }
    return out;
  }

  function currentViewBox(svg) {
    var parts = String(svg.getAttribute('viewBox') || '0 0 900 520').split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 900, h: parts[3] || 520 };
  }

  function refreshOfflineLayer(svg) {
    var group = svg && svg.querySelector('g.dm-tiles');
    if (!group) return;
    var layer = chooseMapLayer(currentViewBox(svg), svg.__dmPoints || [], svg.__dmPx);
    if (!layer) return;
    var zoomKey = String(group.getAttribute('data-zoom'));
    if (zoomKey !== String(layer.zoom)) {
      group.innerHTML = offlineTileSvg(layer);
      group.setAttribute('data-zoom', layer.zoom);
      var label = svg.querySelector('.dm-layer-label');
      if (label) label.textContent = '上海离线底图 · Z' + layer.zoom + ' 详细路网';
    }
  }

  function renderDemoMap(el, data) {
    var all = [];
    if (data.start) all.push(data.start);
    if (data.end) all.push(data.end);
    data.routes.forEach(function (r) {
      r.stops.forEach(function (s) { all.push({ lng: s.lng, lat: s.lat }); });
    });
    var canUseOffline = all.length > 0 && all.some(function (p) {
      return p.lng >= OFFLINE_BASE_LAYER.west && p.lng <= OFFLINE_BASE_LAYER.east &&
        p.lat >= OFFLINE_BASE_LAYER.south && p.lat <= OFFLINE_BASE_LAYER.north;
    });
    var W;
    var H;
    var grid = '';
    var px;
    var activeLayer = null;

    if (canUseOffline) {
      var baseExt = layerExtent(OFFLINE_BASE_LAYER);
      W = Math.round(baseExt.w);
      H = Math.round(baseExt.h);
      var origin = baseExt.origin;
      px = function (p) {
        var w = webMercatorPx(p.lng, p.lat, OFFLINE_MASTER_ZOOM);
        return [Math.round(w.x - origin.x), Math.round(w.y - origin.y)];
      };
      var xs = all.map(function (p) { return px(p)[0]; });
      var ys = all.map(function (p) { return px(p)[1]; });
      var pad = 90;
      var minX = Math.max(0, Math.min.apply(null, xs) - pad);
      var maxX = Math.min(W, Math.max.apply(null, xs) + pad);
      var minY = Math.max(0, Math.min.apply(null, ys) - pad);
      var maxY = Math.min(H, Math.max.apply(null, ys) + pad);
      var vw = Math.min(W, Math.max(520, maxX - minX));
      var vh = Math.min(H, Math.max(420, maxY - minY));
      var vx = Math.max(0, Math.min(minX, W - vw));
      var vy = Math.max(0, Math.min(minY, H - vh));
      var viewBox = [vx, vy, vw, vh].join(' ');
      activeLayer = chooseMapLayer({ x: vx, y: vy, w: vw, h: vh }, all, px);
      if (!activeLayer) activeLayer = OFFLINE_BASE_LAYER;
      grid = offlineTileSvg(activeLayer);
    } else {
      W = 900;
      H = 520;
      var PAD = 46;
      var minLng = Math.min.apply(null, all.map(function (p) { return p.lng; }));
      var maxLng = Math.max.apply(null, all.map(function (p) { return p.lng; }));
      var minLat = Math.min.apply(null, all.map(function (p) { return p.lat; }));
      var maxLat = Math.max.apply(null, all.map(function (p) { return p.lat; }));
      var spanLng = Math.max(maxLng - minLng, 0.012);
      var spanLat = Math.max(maxLat - minLat, 0.012);
      var scale = Math.min((W - PAD * 2) / spanLng, (H - PAD * 2) / spanLat);
      var ox = (W - spanLng * scale) / 2;
      var oy = (H - spanLat * scale) / 2;
      px = function (p) {
        return [Math.round(ox + (p.lng - minLng) * scale), Math.round(H - oy - (p.lat - minLat) * scale)];
      };
      for (var gx = 0; gx <= W; gx += 60) {
        grid += '<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + H + '" class="dm-grid-v"/>';
      }
      for (var gy = 0; gy <= H; gy += 60) {
        grid += '<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" class="dm-grid-h"/>';
      }
      viewBox = '0 0 ' + W + ' ' + H;
    }

    var routesSvg = '';
    data.routes.forEach(function (r) {
      if (!r.waypoints || !r.waypoints.length) return;
      var color = safeColor(r.color);
      var pts = r.waypoints.map(px).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      routesSvg += '<polyline points="' + pts + '" fill="none" stroke="' + color +
        '" stroke-width="4" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round" class="dm-route"/>';
    });

    var stopsSvg = '';
    data.routes.forEach(function (r) {
      var color = safeColor(r.color);
      r.stops.forEach(function (s) {
        var p = px(s);
        stopsSvg += '<g transform="translate(' + p[0] + ',' + p[1] + ')">' +
          '<circle r="16" fill="' + color + '" class="' + (s.conflict ? 'dm-stop dm-conflict' : 'dm-stop') + '"/>' +
          '<text y="5" text-anchor="middle" class="dm-stop-text">' + escHtml(s.order) + '</text>' +
          (s.conflict ? '<circle r="22" class="dm-conflict-ring"/>' : '') +
          '</g>';
      });
    });

    var startP = px(data.start);
    var legend = data.routes.map(function (r) {
      return '<span class="dm-legend-item"><i style="background:' + safeColor(r.color) + '"></i>' + escHtml(r.label) + '</span>';
    }).join('');
    var mapLabel = canUseOffline
      ? '<span class="dm-legend-item dm-legend-demo"><i class="dm-demo-dot"></i><span class="dm-layer-label">上海离线底图 · Z' + activeLayer.zoom + ' 详细路网</span></span>' +
        '<span class="dm-legend-item dm-legend-attribution">© 高德地图</span>'
      : '<span class="dm-legend-item dm-legend-demo"><i class="dm-demo-dot"></i>离线估算</span>';
    var mapAria = canUseOffline ? '上海离线路线图' : '派车路线示意图';

    el.innerHTML =
      '<div class="demo-map-wrap">' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="' + viewBox + '" role="img" aria-label="' + mapAria + '" class="demo-map" preserveAspectRatio="xMidYMid meet" ' +
          'data-map-w="' + W + '" data-map-h="' + H + '" data-initial-viewbox="' + viewBox + '">' +
          '<g class="dm-tiles" data-zoom="' + (activeLayer ? activeLayer.zoom : '') + '">' + grid + '</g>' +
          routesSvg + stopsSvg +
          '<g transform="translate(' + startP[0] + ',' + startP[1] + ')" class="dm-term">' +
            '<circle r="14" fill="#16A34A"/><text y="5" text-anchor="middle" class="dm-term-text">起</text>' +
          '</g>' +
        '</svg>' +
        '<div class="dm-legend">' + legend +
          mapLabel +
        '</div>' +
      '</div>';
    var svg = el.querySelector('svg.demo-map');
    if (svg) {
      svg.__dmPoints = all;
      svg.__dmPx = px;
    }
  }

  function renderAmapMap(el, data) {
    var map = new AMap.Map(el, {
      zoom: 12,
      center: [data.start.lng, data.start.lat],
      resizeEnable: true
    });
    var overlays = [];
    var sameTerm = data.end &&
      Math.abs(data.start.lng - data.end.lng) < 1e-9 &&
      Math.abs(data.start.lat - data.end.lat) < 1e-9;

    data.routes.forEach(function (r) {
      var color = safeColor(r.color);
      if (r.waypoints && r.waypoints.length > 1) {
        overlays.push(new AMap.Polyline({
          path: r.waypoints.map(function (p) { return [p.lng, p.lat]; }),
          strokeColor: color,
          strokeWeight: 5,
          strokeOpacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round'
        }));
      }
      r.stops.forEach(function (s) {
        var tip = (r.label || '') + ' 第' + s.order + '站' + (s.shopName ? ' · ' + s.shopName : '');
        overlays.push(new AMap.Marker({
          position: [s.lng, s.lat],
          content: '<div class="dispatch-marker' + (s.conflict ? ' is-conflict' : '') + '" style="--mc:' + color + '" title="' + escHtml(tip) + '">' + escHtml(s.order) + '</div>',
          offset: new AMap.Pixel(-15, -15)
        }));
      });
    });

    overlays.push(new AMap.Marker({
      position: [data.start.lng, data.start.lat],
      content: '<div class="dispatch-marker dispatch-marker-term" title="出发点">起</div>',
      offset: new AMap.Pixel(-14, -14)
    }));
    if (data.end) {
      overlays.push(new AMap.Marker({
        position: [data.end.lng, data.end.lat],
        content: '<div class="dispatch-marker dispatch-marker-term dispatch-marker-end" title="返回点">终</div>',
        offset: sameTerm ? new AMap.Pixel(-15, 30) : new AMap.Pixel(-14, -14)
      }));
    }

    map.add(overlays);
    map.setFitView(null, false, [54, 54, 54, 54]);
    return {
      destroy: function () { map.destroy(); },
      zoomIn: function () { map.setZoom((map.getZoom() || 12) + 1); },
      zoomOut: function () { map.setZoom(Math.max(3, (map.getZoom() || 12) - 1)); },
      reset: function () {
        map.setZoom(12);
        map.setCenter([data.start.lng, data.start.lat]);
        map.setFitView(null, false, [54, 54, 54, 54]);
      }
    };
  }

  global.Geo = {
    setKey: setKey,
    autocomplete: autocomplete,
    geocode: geocode,
    routeLegs: routeLegs,
    demoLegs: routeLegsDemo,
    estimateTravelMin: estimateTravelMin,
    estimateDistanceM: estimateDistanceM,
    openAmapNavigation: openAmapNavigation,
    openMapSearch: openMapSearch,
    renderDemoMap: renderDemoMap,
    renderAmapMap: renderAmapMap,
    refreshOfflineLayer: refreshOfflineLayer,
    isAmap: function () { return service.mode === 'amap'; },
    status: function () {
      return {
        mode: service.mode,
        key: service.key,
        loading: service.loading,
        error: service.error
      };
    }
  };
})(window);
