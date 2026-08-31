(async function(){
  try {
    var bin = Uint8Array.from(atob(window.__IDX_A + window.__IDX_B), function(c){return c.charCodeAt(0)});
    var stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    var text = await new Response(stream).text();
    document.open();
    document.write(text);
    document.close();
  } catch(e) {
    document.body.innerHTML = '<pre style="color:#f87171;padding:16px">Boot failed: '+e+'</pre>';
  }
})();
