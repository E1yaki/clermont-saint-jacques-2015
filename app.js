(() => {
  'use strict';

  const API = 'https://clermont-videotheque.gariffi.workers.dev';
  const PART_SIZE = 8 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const sortCategories = (items) => [...items].sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' }));
  const state = { token: sessionStorage.getItem('csj_session') || '', role: sessionStorage.getItem('csj_role') || '', videos: [], categories: [], activeVideo: null, visitorId: getVisitorId(), progressTimer: null };

  function getVisitorId() {
    let id = localStorage.getItem('csj_visitor_id');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`); localStorage.setItem('csj_visitor_id', id); }
    return id;
  }
  function setStatus(online, label) { const el = $('connection-status'); el.classList.toggle('online', !!online); el.innerHTML = `<i></i> ${escapeHtml(label)}`; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function formatBytes(bytes) { if (!Number.isFinite(Number(bytes))) return '—'; const n = Number(bytes); if (n < 1024) return `${n} o`; const units = ['Ko','Mo','Go','To']; let v=n/1024, i=0; while(v>=1024 && i<units.length-1){v/=1024;i++;} return `${v.toFixed(v>=10?1:2)} ${units[i]}`; }
  function formatDuration(seconds) { const s = Math.max(0, Math.floor(Number(seconds)||0)); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return h ? `${h} h ${m} min` : `${m} min`; }
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2800); }
  async function api(path, options={}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    const response = await fetch(`${API}${path}`, {...options, headers});
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || `Erreur HTTP ${response.status}`);
    return data;
  }
  function setSession(token, role) { state.token=token; state.role=role; sessionStorage.setItem('csj_session',token); sessionStorage.setItem('csj_role',role); }
  function clearSession() { state.token=''; state.role=''; sessionStorage.removeItem('csj_session'); sessionStorage.removeItem('csj_role'); }
  function showView(name) {
    $('access-view').classList.toggle('hidden', name!=='access'); $('library-view').classList.toggle('hidden', name!=='library'); $('admin-view').classList.toggle('hidden', name!=='admin');
    $('admin-toggle').classList.toggle('hidden', !state.token || state.role!=='admin' || name==='admin'); $('logout-button').classList.toggle('hidden', !state.token);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  async function viewerLogin(secret) { const data=await api('/api/viewer/login',{method:'POST',body:JSON.stringify({token:secret})}); setSession(data.token,'viewer'); await enterLibrary(); }
  async function adminLogin(password) { const data=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password})}); setSession(data.token,'admin'); await enterLibrary(); }
  async function enterLibrary() {
    try { await loadCategories(); await loadVideos(); showView('library'); setStatus(true,'Connecté'); if(state.role==='admin') $('admin-toggle').classList.remove('hidden'); logEvent('visit',null,0); }
    catch(error) { clearSession(); showView('access'); setStatus(false,'Accès refusé'); $('viewer-login-error').textContent=error.message; }
  }
  async function loadCategories() {
    const data=await api('/api/categories'); state.categories=sortCategories((data.categories||[]).map(x=>x.name));
    const filters=$('category-filter'), upload=$('video-category'), previous=filters.value, previousUpload=upload.value;
    filters.innerHTML='<option value="">Toutes les catégories</option>'+state.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    upload.innerHTML=state.categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if(state.categories.includes(previous)) filters.value=previous; if(state.categories.includes(previousUpload)) upload.value=previousUpload;
    $('category-list').innerHTML=state.categories.map(c=>`<span class="category-chip">${escapeHtml(c)}</span>`).join('') || '<span class="muted small">Aucune catégorie.</span>';
  }
  async function loadVideos() {
    const params=new URLSearchParams(); const q=$('search-input').value.trim(), year=$('year-filter').value, category=$('category-filter').value;
    if(q) params.set('q',q); if(year) params.set('year',year); if(category) params.set('category',category);
    const data=await api(`/api/videos?${params.toString()}`); state.videos=data.videos||[]; renderVideos(); renderAdminVideos();
    const years=[...new Set(state.videos.map(v=>v.year).filter(Boolean))].sort((a,b)=>b-a); const select=$('year-filter'), old=select.value;
    select.innerHTML='<option value="">Toutes les années</option>'+years.map(y=>`<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join(''); if(years.map(String).includes(old)) select.value=old;
    $('video-count').textContent=state.videos.length;
  }
  function renderVideos() {
    $('video-count').textContent=state.videos.length;
    $('empty-state').classList.toggle('hidden',state.videos.length!==0);
    $('video-grid').innerHTML=state.videos.map(v=>{
      const date=v.recorded_date ? new Date(`${v.recorded_date}T12:00:00`).toLocaleDateString('fr-FR') : '';
      let people=[]; try{people=JSON.parse(v.people||'[]')}catch{}
      const meta=[date,v.year,formatBytes(v.size_bytes),people.length?people.join(', '):''].filter(Boolean).map(escapeHtml).join('<span>·</span>');
      return `<article class="video-card"><div class="video-thumb" role="button" tabindex="0" data-play="${escapeHtml(v.id)}"><span class="thumb-category">${escapeHtml(v.category||'VIDÉO')}</span><span class="play-button">▶</span><span class="thumb-year">${escapeHtml(v.year||'CLUB')}</span></div><div class="video-info"><h3>${escapeHtml(v.title)}</h3><div class="video-meta">${meta}</div>${v.description?`<p class="video-desc">${escapeHtml(v.description)}</p>`:''}</div></article>`;
    }).join('');
  }
  function renderAdminVideos() {
    $('admin-video-list').innerHTML=state.videos.map(v=>`<div class="admin-video-row"><div><strong>${escapeHtml(v.title)}</strong><small>${escapeHtml(v.category||'—')} · ${escapeHtml(v.year||'Année non précisée')} · ${formatBytes(v.size_bytes)}</small></div><button class="delete-button" type="button" data-delete="${escapeHtml(v.id)}">Supprimer</button></div>`).join('') || '<p class="muted small">Aucune vidéo publiée pour le moment.</p>';
  }
  async function logEvent(type, videoId, duration) { try { await api('/api/events',{method:'POST',body:JSON.stringify({event_type:type,video_id:videoId,visitor_id:state.visitorId,duration_seconds:Math.floor(duration||0)})}); } catch(e) { /* Les statistiques ne doivent pas bloquer la lecture. */ } }
  async function openVideo(id) {
    const video=state.videos.find(v=>v.id===id); if(!video) return;
    try {
      const data=await api(`/api/video/${encodeURIComponent(id)}/ticket`);
      state.activeVideo=video; $('player-title').textContent=video.title; $('player-description').textContent=video.description||'';
      const player=$('video-player'); player.pause(); player.removeAttribute('src'); player.load(); player.src=`${API}/api/video/${encodeURIComponent(id)}?ticket=${encodeURIComponent(data.ticket)}`; $('player-modal').classList.remove('hidden'); player.load();
      await logEvent('play',id,0);
      player.onplay=()=>{clearInterval(state.progressTimer); state.progressTimer=setInterval(()=>{if(!player.paused && player.currentTime>0) logEvent('progress',id,30);},30000);};
      player.onpause=()=>clearInterval(state.progressTimer); player.onended=()=>clearInterval(state.progressTimer);
      player.onerror=()=>toast('Le navigateur ne parvient pas à charger cette vidéo. Vérifie que le fichier MP4 est lisible.');
    } catch(error) { toast(`Lecture impossible : ${error.message}`); }
  }
  function closePlayer() { const p=$('video-player'); p.pause(); p.removeAttribute('src'); p.load(); clearInterval(state.progressTimer); $('player-modal').classList.add('hidden'); state.activeVideo=null; }
  async function loadStats() {
    const [stats,storage]=await Promise.all([api('/api/admin/stats'),api('/api/admin/storage')]);
    $('stat-videos').textContent=stats.videos??'0'; $('stat-visits').textContent=stats.visits??'0'; $('stat-visitors').textContent=stats.uniqueVisitors??'0'; $('stat-plays').textContent=stats.plays??'0'; $('stat-watchtime').textContent=formatDuration(stats.watchedSeconds);
    $('stat-storage').textContent=formatBytes(storage.used); $('stat-storage-detail').textContent=`${storage.percent}% utilisés · ${formatBytes(storage.remaining)} disponibles`;
    $('storage-progress').style.width=`${Math.min(100,storage.percent)}%`; $('storage-progress').style.background=storage.percent>=80?'#ffb45e':'var(--accent)';
    $('top-videos').innerHTML=(stats.topVideos||[]).map(v=>`<div class="top-video"><strong>${escapeHtml(v.title)}</strong><span>${escapeHtml(v.plays)} lectures</span></div>`).join('')||'<p class="muted small">Pas encore de données de lecture.</p>';
  }
  async function showAdmin() { if(state.role!=='admin') return; try { await Promise.all([loadCategories(),loadVideos(),loadStats()]); showView('admin'); } catch(e){toast(e.message);} }
  async function uploadVideo(event) {
    event.preventDefault(); const file=$('video-file').files[0]; const error=$('upload-error'); error.textContent='';
    if(!file) return; if(!file.name.toLowerCase().endsWith('.mp4') && file.type!=='video/mp4'){error.textContent='Sélectionne un fichier MP4.';return;}
    const title=$('video-title').value.trim(), category=$('video-category').value; if(!title||!category){error.textContent='Le titre et la catégorie sont obligatoires.';return;}
    $('upload-button').disabled=true; $('upload-progress-wrap').classList.remove('hidden'); $('upload-progress').style.width='0%'; $('upload-percent').textContent='0 %';
    const updateProgress=(done,total,label)=>{const pct=Math.min(100,Math.round(done/total*100));$('upload-progress').style.width=`${pct}%`;$('upload-percent').textContent=`${pct} %`;$('upload-status').textContent=label;};
    try {
      const metadata={filename:file.name,title,description:$('video-description').value.trim(),recorded_date:$('video-date').value||null,year:$('video-year').value?Number($('video-year').value):undefined,category,people:$('video-people').value.split(',').map(x=>x.trim()).filter(Boolean)};
      const created=await api('/api/admin/upload/create',{method:'POST',body:JSON.stringify({...metadata,size_bytes:file.size})});
      const parts=[]; let uploaded=0; const count=Math.ceil(file.size/PART_SIZE);
      for(let i=0;i<count;i++){
        const chunk=file.slice(i*PART_SIZE,Math.min(file.size,(i+1)*PART_SIZE)); updateProgress(uploaded,file.size,`Envoi de la partie ${i+1}/${count}…`);
        const result=await api(`/api/admin/upload/${encodeURIComponent(created.uploadId)}/part/${i+1}`,{method:'PUT',body:chunk,headers:{'Content-Type':'application/octet-stream'}});
        parts.push({partNumber:i+1,etag:result.etag}); uploaded+=chunk.size; updateProgress(uploaded,file.size,`Partie ${i+1}/${count} envoyée`);
      }
      updateProgress(file.size,file.size,'Finalisation…'); await api('/api/admin/upload/complete',{method:'POST',body:JSON.stringify({uploadId:created.uploadId,parts})});
      $('upload-form').reset(); $('video-year').value=''; toast('Vidéo publiée avec succès.'); await Promise.all([loadVideos(),loadStats()]);
    } catch(e){error.textContent=e.message; toast('Échec de l’envoi.');}
    finally{$('upload-button').disabled=false; setTimeout(()=>$('upload-progress-wrap').classList.add('hidden'),1800);}
  }
  async function addCategory(event) { event.preventDefault(); const name=$('new-category').value.trim(); if(!name)return; try{await api('/api/admin/categories',{method:'POST',body:JSON.stringify({name})});$('new-category').value='';await loadCategories();toast('Catégorie ajoutée.');}catch(e){toast(e.message);} }
  async function deleteVideo(id) { const video=state.videos.find(v=>v.id===id); if(!video||!confirm(`Supprimer définitivement « ${video.title} » et son fichier vidéo ?`))return; try{await api(`/api/admin/videos/${encodeURIComponent(id)}`,{method:'DELETE'});await Promise.all([loadVideos(),loadStats()]);toast('Vidéo supprimée.');}catch(e){toast(e.message);} }
  function makeShareLink() { const secret=$('share-token').value.trim(); $('share-error').textContent=''; if(!secret){$('share-error').textContent='Saisis le code secret des visiteurs.';return;} const url=new URL(location.href); url.hash=`access=${encodeURIComponent(secret)}`; $('share-url').value=url.toString(); $('share-result').classList.remove('hidden'); }
  async function init() {
    $('viewer-login-form').addEventListener('submit',async e=>{e.preventDefault();$('viewer-login-error').textContent='';try{await viewerLogin($('viewer-token').value.trim());$('viewer-token').value='';}catch(err){$('viewer-login-error').textContent=err.message;}});
    $('admin-login-form').addEventListener('submit',async e=>{e.preventDefault();$('admin-login-error').textContent='';try{await adminLogin($('admin-password').value);$('admin-password').value='';}catch(err){$('admin-login-error').textContent=err.message;}});
    $('show-admin-login').addEventListener('click',()=>{$('admin-login-form').classList.toggle('hidden');$('admin-password').focus();});
    $('admin-toggle').addEventListener('click',showAdmin); $('back-library').addEventListener('click',()=>showView('library'));
    $('logout-button').addEventListener('click',()=>{clearSession();showView('access');setStatus(false,'Déconnecté');toast('Vous êtes déconnecté.');});
    $('search-input').addEventListener('input',debounce(()=>loadVideos().catch(e=>toast(e.message)),300)); $('year-filter').addEventListener('change',()=>loadVideos().catch(e=>toast(e.message))); $('category-filter').addEventListener('change',()=>loadVideos().catch(e=>toast(e.message)));
    $('reset-filters').addEventListener('click',()=>{$('search-input').value='';$('year-filter').value='';$('category-filter').value='';loadVideos().catch(e=>toast(e.message));});
    $('video-grid').addEventListener('click',e=>{const card=e.target.closest('[data-play]');if(card)openVideo(card.dataset.play);}); $('video-grid').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-play]')){e.preventDefault();openVideo(e.target.dataset.play);}});
    $('close-player').addEventListener('click',closePlayer); $('player-modal').addEventListener('click',e=>{if(e.target.hasAttribute('data-close-player'))closePlayer();});
    $('upload-form').addEventListener('submit',uploadVideo); $('category-form').addEventListener('submit',addCategory); $('admin-video-list').addEventListener('click',e=>{const b=e.target.closest('[data-delete]');if(b)deleteVideo(b.dataset.delete);});
    $('refresh-admin').addEventListener('click',()=>Promise.all([loadVideos(),loadStats()]).then(()=>toast('Données actualisées.')).catch(e=>toast(e.message)));
    $('make-share-link').addEventListener('click',makeShareLink); $('copy-share-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('share-url').value);toast('Lien copié.');}catch{$('share-url').select();document.execCommand('copy');toast('Lien copié.');}});
    try { const response=await fetch(`${API}/api/health`); if(!response.ok)throw new Error(); setStatus(true,'API disponible'); } catch {setStatus(false,'API inaccessible');}
    if(state.token){await enterLibrary();return;}
    const fragment=new URLSearchParams(location.hash.slice(1)); const secret=fragment.get('access');
    if(secret){history.replaceState(null,'',location.pathname+location.search);try{await viewerLogin(secret);}catch(e){$('viewer-login-error').textContent=e.message;showView('access');}}
    else showView('access');
  }
  function debounce(fn,delay){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};}
  document.addEventListener('DOMContentLoaded',init);
})();
