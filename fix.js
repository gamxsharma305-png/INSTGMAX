(function(){
  try {
    var KEY = 'lumina_unlock_until';
    var TOK = 'lumina_unlock_token';
    var until = parseInt(localStorage.getItem(KEY)||'0',10)||0;
    var token = localStorage.getItem(TOK)||'';
    if (until > Date.now() && !token) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(TOK);
      console.warn('[gmax] cleared timer-only session — unlock again for media');
    }
  } catch (e) {}
})();
