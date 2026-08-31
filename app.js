(function(){
  const KEY='lumina_unlock_until', UNLOCK_TOKEN_KEY='lumina_unlock_token', DEVICE_KEY='lumina_device_id', ADMIN_KEY='lumina_admin_until';
  let sharedPosts=[], sharedStories=[], sharedAbout=[], sharedBrand={name:'GMAX Hub',tag:'Study feed',logo:'',avatar:''};
  let adminPinSession='';
  function getUntil(){try{return parseInt(localStorage.getItem(KEY)||'0',10)||0}catch(e){return 0}}
  function setUntil(t){try{localStorage.setItem(KEY,String(t))}catch(e){}}
  function getUnlockToken(){try{return localStorage.getItem(UNLOCK_TOKEN_KEY)||''}catch(e){return ''}}
  function setUnlockToken(t){try{if(t)localStorage.setItem(UNLOCK_TOKEN_KEY,t);else localStorage.removeItem(UNLOCK_TOKEN_KEY)}catch(e){}}
  function isUnlockedNow(){return getUntil()>Date.now()}
  function getDeviceId(){
    try{let id=localStorage.getItem(DEVICE_KEY);if(id&&/^[A-Z0-9]{4,8}$/.test(id))return id;
      const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';id='';
      for(let i=0;i<6;i++)id+=c[Math.floor(Math.random()*c.length)];
      localStorage.setItem(DEVICE_KEY,id);return id}catch(e){return 'DEVICE1'}
  }
  function applyUnlockState(){
    const ok=getUntil()>Date.now();
    document.getElementById('feed').classList.toggle('locked',!ok);
    const chip=document.getElementById('timerChip');
    if(ok){chip.style.display='inline-flex';
      const tick=()=>{const left=getUntil()-Date.now();if(left<=0){localStorage.removeItem(KEY);localStorage.removeItem(UNLOCK_TOKEN_KEY);applyUnlockState();loadSharedContent();return}
        const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
        document.getElementById('timerVal').textContent=[h,m,sec].map(n=>String(n).padStart(2,'0')).join(':');
        setTimeout(tick,1000)};tick();
    } else chip.style.display='none';
  }
  function mediaBlock(url,title){
    if(!isUnlockedNow()||!url){
      return '<div class="post-media"><div style="text-align:center;padding:40px"><div style="font-size:28px">🔒</div><div>Protected</div><div style="font-weight:700;margin-top:6px">'+(title||'Post').replace(/</g,'').slice(0,40)+'</div></div></div>';
    }
    if(/\.(mp4|webm)(\?|$)/i.test(url)) return '<div class="post-media"><video src="'+url.replace(/"/g,'')+'" playsinline muted loop autoplay></video></div>';
    return '<div class="post-media"><img src="'+url.replace(/"/g,'')+'" alt="" draggable="false"/></div>';
  }
  function renderPosts(){
    const el=document.getElementById('posts');
    const posts=sharedPosts||[];
    if(!posts.length){el.innerHTML='<p style="padding:16px;color:var(--muted)">No posts yet — Admin se add + Publish karo</p>';return}
    el.innerHTML=posts.map(p=>{
      const av=(isUnlockedNow()&&(p.avatar||sharedBrand.avatar))?'<img src="'+String(p.avatar||sharedBrand.avatar).replace(/"/g,'')+'" alt=""/>':(p.user||'G')[0].toUpperCase();
      return '<article class="post"><div class="post-head"><div class="post-av">'+av+'</div><div><strong>'+(p.user||'')+'</strong></div></div>'
        +mediaBlock(p.media,p.title)+'<div class="caption"><strong>'+(p.user||'')+'</strong> '+(p.caption||'')+'</div></article>';
    }).join('');
  }
  function renderStories(){
    const row=document.getElementById('storiesRow');
    const stories=sharedStories||[];
    if(!stories.length){row.innerHTML='';return}
    row.innerHTML=stories.map(s=>{
      const media=(isUnlockedNow()&&s.media)?'<img src="'+String(s.media).replace(/"/g,'')+'" alt=""/>':(s.name||'S')[0];
      return '<div class="story"><div class="ring">'+media+'</div>'+(s.name||'')+'</div>';
    }).join('');
  }
  function renderAbout(){
    const deck=document.getElementById('aboutDeck');
    const about=sharedAbout&&sharedAbout.length?sharedAbout:[
      {badge:'Slide 1',title:'GMAX Hub',body:'Study feed with gated access.'},
      {badge:'Slide 2',title:'Private',body:'Blurred until you verify the code.'},
      {badge:'Slide 3',title:'For educators',body:'Share one link with your class.'}
    ];
    deck.innerHTML=about.map(a=>'<div class="about-card"><div style="font-size:11px;color:var(--accent)">'+(a.badge||'')+'</div><h2>'+(a.title||'')+'</h2><p style="color:var(--muted)">'+(a.body||'')+'</p></div>').join('');
  }
  function applyBrand(){
    document.getElementById('brandName').textContent=sharedBrand.name||'GMAX Hub';
    document.getElementById('brandTag').textContent=sharedBrand.tag||'';
    const logo=document.getElementById('brandLogo');
    if(sharedBrand.logo&&isUnlockedNow()) logo.innerHTML='<img src="'+sharedBrand.logo.replace(/"/g,'')+'" alt=""/>';
    else logo.textContent=(sharedBrand.name||'G')[0];
    const ni=document.getElementById('brandNameInput'); if(ni) ni.value=sharedBrand.name||'';
    const li=document.getElementById('brandLogoInput'); if(li) li.value=sharedBrand.logo||'';
    const ai=document.getElementById('brandAvatarInput'); if(ai) ai.value=sharedBrand.avatar||'';
  }
  function renderAdminList(){
    const box=document.getElementById('adminList');
    if(!sharedPosts.length){box.innerHTML='<em style="color:var(--muted)">No posts</em>';return}
    box.innerHTML=sharedPosts.map(p=>'<div style="display:flex;justify-content:space-between;margin:6px 0"><span>'+(p.title||'')+'</span><button type="button" data-del="'+p.id+'" style="color:#f87171;background:0;border:0">del</button></div>').join('');
    box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{sharedPosts=sharedPosts.filter(p=>p.id!==b.getAttribute('data-del'));renderAdminList();renderPosts()});
  }
  function refreshAll(){applyBrand();renderStories();renderPosts();renderAbout();renderAdminList()}
  async function loadSharedContent(){
    try{
      const tok=getUnlockToken();
      const headers={'x-device-id':getDeviceId()};
      if(tok) headers['x-unlock-token']=tok;
      const q='/api/content?t='+Date.now()+'&deviceId='+encodeURIComponent(getDeviceId())+(tok?'&token='+encodeURIComponent(tok):'');
      const r=await fetch(q,{cache:'no-store',headers});
      const d=await r.json();
      if(d&&d.ok&&d.content){
        sharedPosts=Array.isArray(d.content.posts)?d.content.posts:[];
        sharedStories=Array.isArray(d.content.stories)?d.content.stories:[];
        if(Array.isArray(d.content.about)) sharedAbout=d.content.about;
        if(d.content.brand) sharedBrand=Object.assign(sharedBrand,d.content.brand);
      }
    }catch(e){}
    refreshAll();
  }
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
      document.getElementById({home:'screenHome',about:'screenAbout',admin:'screenAdmin'}[tab.dataset.tab]).classList.add('active');
      if(tab.dataset.tab==='admin') showAdmin();
    };
  });
  const modal=document.getElementById('unlockModal');
  function openUnlock(){modal.classList.add('show')}
  function closeUnlock(){modal.classList.remove('show')}
  document.getElementById('btnOpenUnlock').onclick=openUnlock;
  document.getElementById('btnUnlockTop').onclick=openUnlock;
  document.getElementById('pwClose').onclick=closeUnlock;
  document.getElementById('pwSubmit').onclick=async()=>{
    const val=(document.getElementById('pwInput').value||'').trim().replace(/\s+/g,'');
    const err=document.getElementById('pwErr');
    if(!/^\d{12}$/.test(val)){err.textContent='12-digit code';return}
    err.textContent='';
    try{
      const r=await fetch('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:val,deviceId:getDeviceId()})});
      const d=await r.json();
      if(d.ok&&d.until){
        setUntil(d.until);
        if(d.unlockToken) setUnlockToken(d.unlockToken);
        applyUnlockState();
        closeUnlock();
        await loadSharedContent();
      } else err.textContent=d.error||'Invalid';
    }catch(e){err.textContent='Network error'}
  };
  document.getElementById('pwGetKeyBtn').onclick=async()=>{
    try{
      const r=await fetch('/api/get-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:getDeviceId()})});
      const d=await r.json();
      const url=d&&(d.shortUrl||d.fallbackUrl);
      if(url) location.href=url; else document.getElementById('pwErr').textContent=d.error||'Key failed';
    }catch(e){document.getElementById('pwErr').textContent='Network error'}
  };
  function adminOk(){try{return parseInt(localStorage.getItem(ADMIN_KEY)||'0',10)>Date.now()}catch(e){return false}}
  function showAdmin(){
    const ok=adminOk();
    document.getElementById('adminLoginBox').style.display=ok?'none':'block';
    document.getElementById('adminDash').style.display=ok?'block':'none';
    if(ok) renderAdminList();
  }
  document.getElementById('adminLoginBtn').onclick=async()=>{
    const pin=document.getElementById('adminPin').value||'';
    const err=document.getElementById('adminErr');err.textContent='';
    try{
      const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
      const d=await r.json();
      if(d.ok&&d.until){localStorage.setItem(ADMIN_KEY,String(d.until));adminPinSession=pin;showAdmin()}
      else err.textContent=d.error||'Login failed';
    }catch(e){err.textContent='Network error'}
  };
  document.getElementById('adminLogout').onclick=()=>{localStorage.removeItem(ADMIN_KEY);adminPinSession='';showAdmin()};
  document.getElementById('apAdd').onclick=()=>{
    const user=(document.getElementById('apUser').value||'Gmax').trim();
    const title=(document.getElementById('apTitle').value||'').trim();
    const caption=(document.getElementById('apCaption').value||'').trim();
    const media=(document.getElementById('apMedia').value||'').trim();
    if(!title&&!caption&&!media){alert('Title/caption/media bharo');return}
    if(media&&!/^https?:\/\//i.test(media)){alert('Media https:// se');return}
    sharedPosts.unshift({id:'c'+Date.now(),user,title:title||'Post',caption,media,likes:0,time:'JUST NOW',place:'Feed'});
    document.getElementById('apTitle').value='';document.getElementById('apCaption').value='';document.getElementById('apMedia').value='';
    refreshAll(); alert('Draft — Publish dabao');
  };
  document.getElementById('asAdd').onclick=()=>{
    const name=(document.getElementById('asName').value||'Story').trim();
    const media=(document.getElementById('asMedia').value||'').trim();
    sharedStories.unshift({id:'s'+Date.now(),name,title:name,media,body:''});
    refreshAll(); alert('Story draft — Publish dabao');
  };
  document.getElementById('adminPublishAll').onclick=async()=>{
    const err=document.getElementById('publishErr');err.textContent='';err.className='err';
    if(!adminPinSession){const pin=prompt('Admin PIN:');if(!pin)return;adminPinSession=pin}
    sharedBrand={name:document.getElementById('brandNameInput').value||sharedBrand.name,tag:sharedBrand.tag,logo:document.getElementById('brandLogoInput').value||'',avatar:document.getElementById('brandAvatarInput').value||''};
    try{
      const r=await fetch('/api/content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:adminPinSession,posts:sharedPosts,stories:sharedStories,brand:sharedBrand,about:sharedAbout})});
      const d=await r.json();
      if(!r.ok||!d.ok){err.textContent=d.error||('Fail '+r.status);if(r.status===401)adminPinSession='';return}
      sharedPosts=d.content&&d.content.posts||sharedPosts;
      sharedStories=d.content&&d.content.stories||sharedStories;
      err.className='ok';
      err.textContent='Published · posts='+(d.counts&&d.counts.posts!=null?d.counts.posts:sharedPosts.length);
      refreshAll();
    }catch(e){err.textContent='Network error'}
  };
  applyUnlockState();
  showAdmin();
  loadSharedContent();
})();
