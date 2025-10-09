(function(){
  window.__env = window.__env || {};
  // Defaults; can be overridden on server by editing this file during deploy
  window.__env.apiBaseUrl = window.__env.apiBaseUrl || "https://staj.salihkarakaya.com.tr";
  // Optional: if set, overrides SignalR url; otherwise client uses https://<host>/ws in prod and /ws in dev
  // window.__env.wsUrl = "wss://staj.salihkarakaya.com.tr/ws";
})();
