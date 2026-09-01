(async function(){
  try {
    var b64 = window.__GMAX_FULL || '';
    if(!b64 || b64.length < 1000) throw new Error('full chunk missing');
    var bin = Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); });
    var stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    var text = await new Response(stream).text();
    document.open();
    document.write(text);
    document.close();
  } catch (e) {
    document.body.innerHTML = '<pre style="color:#f87171;padding:16px;font-family:sans-serif">UI load failed: ' + e + '</pre>';
  }
})();
