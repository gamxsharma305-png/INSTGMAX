(async function(){
  try {
    var b64 = window.__IDX_P0 + window.__IDX_P1 + window.__IDX_P2 + window.__IDX_P3;
    var bin = Uint8Array.from(atob(b64), function(c){return c.charCodeAt(0)});
    var stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    var text = await new Response(stream).text();
    document.open(); document.write(text); document.close();
  } catch(e) {
    document.body.innerHTML = '<pre style="color:#f87171;padding:16px">Boot failed: '+e+'</pre>';
  }
})();
