(function(){
  try {
    var KEY = 'lumina_unlock_until';
    var TOK = 'lumina_unlock_token';
    var DEV = 'lumina_device_id';

    function deviceId() {
      try {
        var id = localStorage.getItem(DEV);
        if (id && /^[A-Z0-9]{4,8}$/.test(id)) return id;
      } catch (e) {}
      return '';
    }

    try {
      var until = parseInt(localStorage.getItem(KEY) || '0', 10) || 0;
      var token = localStorage.getItem(TOK) || '';
      if (until > Date.now() && !token) {
        localStorage.removeItem(KEY);
        localStorage.removeItem(TOK);
      }
    } catch (e) {}

    var orig = window.fetch;
    window.fetch = function (url, opts) {
      try {
        var u = String(url || '');
        if (u.indexOf('/api/content') !== -1) {
          opts = opts || {};
          var headers = opts.headers || {};
          if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            if (!headers.has('x-device-id') && deviceId()) headers.set('x-device-id', deviceId());
            try {
              var t = localStorage.getItem(TOK);
              if (t && !headers.has('x-unlock-token')) headers.set('x-unlock-token', t);
            } catch (e2) {}
          } else {
            headers = Object.assign({}, headers);
            if (!headers['x-device-id'] && deviceId()) headers['x-device-id'] = deviceId();
            try {
              var t2 = localStorage.getItem(TOK);
              if (t2 && !headers['x-unlock-token']) headers['x-unlock-token'] = t2;
            } catch (e3) {}
            opts.headers = headers;
          }
          if (deviceId() && u.indexOf('deviceId=') === -1) {
            url = u + (u.indexOf('?') >= 0 ? '&' : '?') + 'deviceId=' + encodeURIComponent(deviceId());
          }
        }
      } catch (e4) {}
      return orig.call(this, url, opts);
    };
  } catch (e0) {}
})();
