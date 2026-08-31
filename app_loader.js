(async function(){
  try {
    var bin = Uint8Array.from(atob(window.__GMAX_GZ), function(c){ return c.charCodeAt(0); });
    var stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    var text = await new Response(stream).text();
    var el = document.createElement('script');
    el.textContent = text;
    document.body.appendChild(el);
  } catch (e) {
    document.body.innerHTML = '<pre style="color:#f87171;padding:16px">UI load failed: '+e+'</pre>';
  }
})();
