(() => {
  'use strict';

  const API = 'https://clermont-videotheque.gariffi.workers.dev';
  const PART_SIZE = 8 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);

  const sortCategories = (items) => [...items].sort((a, b) =>
    String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' })
  );

  const state = {
    token: sessionStorage.getItem('csj_session') || '',
    role: sessionStorage.getItem('csj_role') || '',
    videos: [],
    categories: [],
    activeVideo: null,
    editingVideo: null,
    visitorId: getVisitorId(),
    progressTimer: null
  };

  function getVisitorId() {
    let id = localStorage.getItem('csj_visitor_id');
    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('csj_visitor_id', id);
    }
    return id;
  }

  function setStatus(online, label) {
    const el = $('connection-status');
    el.classList.toggle('online', !!online);
    el.innerHTML = `<i></i> ${escapeHtml(label)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes))) return '—';
    const n = Number(bytes);
    if (n < 1024) return `${n} o`;
    const units = ['Ko', 'Mo', 'Go', 'To'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || `Erreur HTTP ${response.status}`);
    return data;
  }

  function setSession(token, role) {
    state.token = token;
    state.role = role;
    sessionStorage.setItem('csj_session', token);
    sessionStorage.setItem('csj_role', role);
  }

  function clearSession() {
    state.token = '';
    state.role = '';
    sessionStorage.removeItem('csj_session');
    sessionStorage.removeItem('csj_role');
  }

  function showView(name) {
    $('access-view').classList.toggle('hidden', name !== 'access');
    $('library-view').classList.toggle('hidden', name !== 'library');
    $('admin-view').classList.toggle('hidden', name !== 'admin');
    $('admin-toggle').classList.toggle('hidden', !state.token || state.role !== 'admin' || name === 'admin');
    $('logout-button').classList.toggle('hidden', !state.token);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function viewerLogin(secret) {
    const data = await api('/api/viewer/login', {
      method: 'POST', body: JSON.stringify({ token: secret })
    });
    setSession(data.token, 'viewer');
    await enterLibrary();
  }

  async function adminLogin(password) {
    const data = await api('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ password })
    });
    setSession(data.token, 'admin');
    await enterLibrary();
  }

  async function enterLibrary() {
    try {
      await loadCategories();
      await loadVideos();
      showView('library');
      setStatus(true, 'Connecté');
      if (state.role === 'admin') $('admin-toggle').classList.remove('hidden');
      else logEvent('visit', null, 0);
    } catch (error) {
      clearSession();
      showView('access');
      setStatus(false, 'Accès refusé');
      $('viewer-login-error').textContent = error.message;
    }
  }

  async function loadCategories() {
    const data = await api('/api/categories');
    state.categories = sortCategories((data.categories || []).map(x => x.name));
    const filters = $('category-filter');
    const upload = $('video-category');
    const editCategory = $('edit-video-category');
    const previousEdit = editCategory ? editCategory.value : '';
    const previous = filters.value;
    const previousUpload = upload.value;

    filters.innerHTML = '<option value="">Toutes les catégories</option>' +
      state.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    upload.innerHTML = state.categories.map(c =>
      `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (editCategory) {
      editCategory.innerHTML = state.categories.map(c =>
        `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      if (state.categories.includes(previousEdit)) editCategory.value = previousEdit;
    }

    if (state.categories.includes(previous)) filters.value = previous;
    if (state.categories.includes(previousUpload)) upload.value = previousUpload;
    $('category-list').innerHTML = state.categories.map(c =>
      `<span class="category-chip">${escapeHtml(c)}</span>`).join('') ||
      '<span class="muted small">Aucune catégorie.</span>';
  }

  async function loadVideos() {
    const params = new URLSearchParams();
    const q = $('search-input').value.trim();
    const year = $('year-filter').value;
    const category = $('category-filter').value;
    if (q) params.set('q', q);
    if (year) params.set('year', year);
    if (category) params.set('category', category);

    const data = await api(`/api/videos?${params.toString()}`);
    state.videos = (data.videos || []).sort((a, b) => {
      const da = a.recorded_date || '';
      const db = b.recorded_date || '';
      return db.localeCompare(da) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    renderVideos();
    renderAdminVideos();

    const years = [...new Set(state.videos.map(v => v.year).filter(Boolean))].sort((a, b) => b - a);
    const select = $('year-filter');
    const old = select.value;
    select.innerHTML = '<option value="">Toutes les années</option>' +
      years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    if (years.map(String).includes(old)) select.value = old;
    $('video-count').textContent = state.videos.length;
  }

  function renderVideos() {
    $('video-count').textContent = state.videos.length;
    $('empty-state').classList.toggle('hidden', state.videos.length !== 0);
    $('video-grid').innerHTML = state.videos.map(v => {
      const date = v.recorded_date
        ? new Date(`${v.recorded_date}T12:00:00`).toLocaleDateString('fr-FR')
        : '';
      let people = [];
      try { people = JSON.parse(v.people || '[]'); } catch { /* données facultatives */ }
      const meta = [date, v.year, formatBytes(v.size_bytes), people.length ? people.join(', ') : '']
        .filter(Boolean).map(escapeHtml).join('<span>·</span>');
      return `<article class="video-card">
        <div class="video-thumb" role="button" tabindex="0" data-play="${escapeHtml(v.id)}">
          ${v.thumbnail_data ? `<img class="video-poster" src="${escapeHtml(v.thumbnail_data)}" alt="Aperçu de ${escapeHtml(v.title)}" loading="lazy">` : ''}
          <span class="thumb-category">${escapeHtml(v.category || 'VIDÉO')}</span>
          <span class="play-button">▶</span>
          <span class="thumb-year">${escapeHtml(v.year || 'CLUB')}</span>
        </div>
        <div class="video-info">
          <h3>${escapeHtml(v.title)}</h3>
          <div class="video-meta">${meta}</div>
          ${v.description ? `<p class="video-desc">${escapeHtml(v.description)}</p>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  // Dans l'administration, toute la ligne ouvre le lecteur.
  // Le bouton Supprimer reste indépendant du clic sur la ligne.
  function renderAdminVideos() {
    $('admin-video-list').innerHTML = state.videos.map(v => `
      <div class="admin-video-row">
        <div class="admin-video-main" data-play="${escapeHtml(v.id)}" role="button" tabindex="0" title="Cliquer pour lire la vidéo">
          <strong>${escapeHtml(v.title)}</strong>
          <small>${escapeHtml(v.category || '—')} · ${escapeHtml(v.year || 'Année non précisée')} · ${formatBytes(v.size_bytes)}</small>
        </div>
        <div class="admin-video-actions">
          <button class="edit-button" type="button" data-edit="${escapeHtml(v.id)}">Modifier</button>
          <button class="delete-button" type="button" data-delete="${escapeHtml(v.id)}">Supprimer</button>
        </div>
      </div>
    `).join('') || '<p class="muted small">Aucune vidéo publiée pour le moment.</p>';
  }

  async function logEvent(type, videoId, duration) {
    try {
      await api('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          event_type: type,
          video_id: videoId,
          visitor_id: state.visitorId,
          duration_seconds: Math.floor(duration || 0)
        })
      });
    } catch (e) { /* Les statistiques ne doivent pas bloquer la lecture. */ }
  }

  async function openVideo(id) {
    const video = state.videos.find(v => String(v.id) === String(id));
    if (!video) return;

    try {
      const data = await api(`/api/video/${encodeURIComponent(id)}/ticket`);
      state.activeVideo = video;
      $('player-title').textContent = video.title;
      $('player-description').textContent = video.description || '';

      const player = $('video-player');
      // Installer les diagnostics avant de définir la source : certains événements
      // peuvent arriver très rapidement après player.load().
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.crossOrigin = 'anonymous';
      player.onerror = () => {
        const messages = {
          1: 'Lecture interrompue.',
          2: 'Erreur réseau : vérifie le ticket vidéo, le Worker et les réponses HTTP Range.',
          3: 'Format vidéo ou audio non décodable par le navigateur. Le MP4 devra peut-être être converti en H.264/AAC.',
          4: 'Format vidéo non pris en charge par le navigateur.'
        };
        const code = player.error?.code;
        const message = messages[code] || 'Le navigateur ne parvient pas à charger cette vidéo.';
        const status = $('player-status');
        if (status) status.textContent = message;
        toast(message);
      };
      player.onloadedmetadata = () => {
        const status = $('player-status');
        if (status) status.textContent = 'Vidéo chargée. Tu peux lancer la lecture.';
      };
      player.onplaying = () => {
        const status = $('player-status');
        if (status) status.textContent = 'Lecture en cours.';
      };
      player.onwaiting = () => {
        const status = $('player-status');
        if (status) status.textContent = 'Chargement de la vidéo…';
      };
      const status = $('player-status');
      if (status) status.textContent = 'Préparation de la vidéo…';

      $('player-modal').classList.remove('hidden');
      player.src = `${API}/api/video/${encodeURIComponent(id)}?ticket=${encodeURIComponent(data.ticket)}`;
      player.load();

      logEvent('play', id, 0);
      player.onplay = () => {
        clearInterval(state.progressTimer);
        state.progressTimer = setInterval(() => {
          if (!player.paused && player.currentTime > 0) logEvent('progress', id, 30);
        }, 30000);
      };
      player.onpause = () => clearInterval(state.progressTimer);
      player.onended = () => clearInterval(state.progressTimer);
    } catch (error) {
      toast(`Lecture impossible : ${error.message}`);
    }
  }

  function closePlayer() {
    const player = $('video-player');
    player.pause();
    player.removeAttribute('src');
    player.load();
    clearInterval(state.progressTimer);
    $('player-modal').classList.add('hidden');
    state.activeVideo = null;
    const status = $('player-status');
    if (status) status.textContent = '';
  }

  async function loadStats() {
    const [stats, storage] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/storage')
    ]);
    $('stat-videos').textContent = stats.videos ?? '0';
    $('stat-visits').textContent = stats.visits ?? '0';
    $('stat-visitors').textContent = stats.uniqueVisitors ?? '0';
    $('stat-plays').textContent = stats.plays ?? '0';
    $('stat-watchtime').textContent = formatDuration(stats.watchedSeconds);
    $('stat-storage').textContent = formatBytes(storage.used);
    $('stat-storage-detail').textContent = `${storage.percent}% utilisés · ${formatBytes(storage.remaining)} disponibles`;
    $('storage-progress').style.width = `${Math.min(100, storage.percent)}%`;
    $('storage-progress').style.background = storage.percent >= 80 ? '#ffb45e' : 'var(--accent)';
    $('top-videos').innerHTML = (stats.topVideos || []).map(v =>
      `<div class="top-video"><strong>${escapeHtml(v.title)}</strong><span>${escapeHtml(v.plays)} lectures</span></div>`
    ).join('') || '<p class="muted small">Pas encore de données de lecture.</p>';
  }

  async function showAdmin() {
    if (state.role !== 'admin') return;
    try {
      await Promise.all([loadCategories(), loadVideos(), loadStats(), loadShareLinks()]);
      showView('admin');
    } catch (e) { toast(e.message); }
  }

  async function uploadVideo(event) {
    event.preventDefault();
    const file = $('video-file').files[0];
    const error = $('upload-error');
    error.textContent = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
      error.textContent = 'Sélectionne un fichier MP4.';
      return;
    }
    const title = $('video-title').value.trim();
    const category = $('video-category').value;
    if (!title || !category) {
      error.textContent = 'Le titre et la catégorie sont obligatoires.';
      return;
    }

    $('upload-button').disabled = true;
    $('upload-progress-wrap').classList.remove('hidden');
    $('upload-progress').style.width = '0%';
    $('upload-percent').textContent = '0 %';

    const updateProgress = (done, total, label) => {
      const pct = Math.min(100, Math.round(done / total * 100));
      $('upload-progress').style.width = `${pct}%`;
      $('upload-percent').textContent = `${pct} %`;
      $('upload-status').textContent = label;
    };

    try {
      const thumbnailMode = $('video-thumbnail-mode').value;
      const thumbnailSecond = Number($('video-thumbnail-second').value || 0);
      let thumbnailData = '';
      if (thumbnailMode === 'video') {
        try { thumbnailData = await captureThumbnailFromFile(file, thumbnailSecond); }
        catch (thumbError) { throw new Error(`Vignette impossible : ${thumbError.message}`); }
      } else {
        const imageFile = $('video-thumbnail-file').files[0];
        if (!imageFile) throw new Error('Sélectionne le fichier image à utiliser comme vignette.');
        thumbnailData = await imageFileToDataUrl(imageFile);
      }
      const metadata = {
        filename: file.name,
        title,
        description: $('video-description').value.trim(),
        recorded_date: $('video-date').value || null,
        year: $('video-year').value ? Number($('video-year').value) : undefined,
        category,
        people: $('video-people').value.split(',').map(x => x.trim()).filter(Boolean)
      };
      const created = await api('/api/admin/upload/create', {
        method: 'POST',
        body: JSON.stringify({ ...metadata, size_bytes: file.size })
      });
      const parts = [];
      let uploaded = 0;
      const count = Math.ceil(file.size / PART_SIZE);

      for (let i = 0; i < count; i++) {
        const chunk = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE));
        updateProgress(uploaded, file.size, `Envoi de la partie ${i + 1}/${count}…`);
        const result = await api(`/api/admin/upload/${encodeURIComponent(created.uploadId)}/part/${i + 1}`, {
          method: 'PUT', body: chunk, headers: { 'Content-Type': 'application/octet-stream' }
        });
        parts.push({ partNumber: i + 1, etag: result.etag });
        uploaded += chunk.size;
        updateProgress(uploaded, file.size, `Partie ${i + 1}/${count} envoyée`);
      }

      updateProgress(file.size, file.size, 'Finalisation…');
      const completed = await api('/api/admin/upload/complete', {
        method: 'POST', body: JSON.stringify({ uploadId: created.uploadId, parts })
      });
      if (thumbnailData && completed.videoId) {
        await api(`/api/admin/videos/${encodeURIComponent(completed.videoId)}/thumbnail`, {
          method: 'POST', body: JSON.stringify({ thumbnail_data: thumbnailData, thumbnail_second: thumbnailSecond })
        });
      }
      $('upload-form').reset();
      $('video-thumbnail-mode').value = 'video';
      updateThumbnailMode();
      $('video-year').value = '';
      toast('Vidéo publiée avec succès.');
      await Promise.all([loadVideos(), loadStats()]);
    } catch (e) {
      error.textContent = e.message;
      toast('Échec de l’envoi.');
    } finally {
      $('upload-button').disabled = false;
      setTimeout(() => $('upload-progress-wrap').classList.add('hidden'), 1800);
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    const name = $('new-category').value.trim();
    if (!name) return;
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      $('new-category').value = '';
      await loadCategories();
      toast('Catégorie ajoutée.');
    } catch (e) { toast(e.message); }
  }

  function openEditVideo(id) {
    const video = state.videos.find(v => String(v.id) === String(id));
    if (!video || state.role !== 'admin') return;
    state.editingVideo = video;
    let people = [];
    try { people = JSON.parse(video.people || '[]'); } catch { people = []; }
    $('edit-video-name').value = video.title || '';
    $('edit-video-description').value = video.description || '';
    $('edit-video-date').value = video.recorded_date || '';
    $('edit-video-year').value = video.year || '';
    $('edit-video-category').value = video.category || state.categories[0] || '';
    $('edit-video-people').value = people.join(', ');
    $('edit-thumbnail-second').value = video.thumbnail_second ?? 0;
    $('edit-thumbnail-mode').value = 'keep';
    $('edit-thumbnail-file').value = '';
    updateEditThumbnailMode();
    $('edit-video-error').textContent = '';
    $('edit-video-modal').classList.remove('hidden');
  }

  function closeEditVideo() {
    $('edit-video-modal').classList.add('hidden');
    state.editingVideo = null;
  }

  async function saveVideoEdits(event) {
    event.preventDefault();
    const video = state.editingVideo;
    if (!video) return;
    const button = $('save-edit-video');
    button.disabled = true;
    $('edit-video-error').textContent = '';
    const thumbnailSecond = Number($('edit-thumbnail-second').value || 0);
    const payload = {
      title: $('edit-video-name').value.trim(),
      description: $('edit-video-description').value.trim(),
      recorded_date: $('edit-video-date').value || null,
      year: $('edit-video-year').value ? Number($('edit-video-year').value) : null,
      category: $('edit-video-category').value,
      people: $('edit-video-people').value.split(',').map(x => x.trim()).filter(Boolean)
    };
    try {
      const thumbMode = $('edit-thumbnail-mode').value;
      if (thumbMode === 'file' && !$('edit-thumbnail-file').files[0]) throw new Error('Sélectionne le fichier image à utiliser comme vignette.');
      await api(`/api/admin/videos/${encodeURIComponent(video.id)}`, {
        method: 'PUT', body: JSON.stringify({ ...payload, thumbnail_second: thumbnailSecond })
      });
      if (thumbMode !== 'keep') {
        let thumbnailData;
        if (thumbMode === 'video') thumbnailData = await captureThumbnailFromVideo(video.id, thumbnailSecond);
        else {
          const imageFile = $('edit-thumbnail-file').files[0];
          if (!imageFile) throw new Error('Sélectionne le fichier image à utiliser comme vignette.');
          thumbnailData = await imageFileToDataUrl(imageFile);
        }
        await api(`/api/admin/videos/${encodeURIComponent(video.id)}/thumbnail`, {
          method: 'POST', body: JSON.stringify({ thumbnail_data: thumbnailData, thumbnail_second: thumbMode === 'video' ? thumbnailSecond : null })
        });
      }
      closeEditVideo();
      await loadVideos();
      toast('Informations de la vidéo mises à jour.');
    } catch (error) {
      $('edit-video-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }


  async function deleteVideo(id) {
    const video = state.videos.find(v => String(v.id) === String(id));
    if (!video || !confirm(`Supprimer définitivement « ${video.title} » et son fichier vidéo ?`)) return;
    try {
      await api(`/api/admin/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await Promise.all([loadVideos(), loadStats()]);
      toast('Vidéo supprimée.');
    } catch (e) { toast(e.message); }
  }

  function captureThumbnailFromFile(file, seconds) {
    const objectUrl = URL.createObjectURL(file);
    return captureFrame(objectUrl, seconds, false).finally(() => URL.revokeObjectURL(objectUrl));
  }

  async function captureThumbnailFromVideo(videoId, seconds) {
    const ticketData = await api(`/api/video/${encodeURIComponent(videoId)}/ticket`);
    const src = `${API}/api/video/${encodeURIComponent(videoId)}?ticket=${encodeURIComponent(ticketData.ticket)}`;
    return captureFrame(src, seconds, true);
  }

  function captureFrame(src, seconds, crossOrigin) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      if (crossOrigin) video.crossOrigin = 'anonymous';
      const cleanup = () => { video.removeAttribute('src'); video.load(); };
      video.onerror = () => { cleanup(); reject(new Error('le navigateur ne peut pas charger la vidéo pour extraire l’image.')); };
      video.onloadedmetadata = () => {
        const target = Math.max(0, Number(seconds) || 0);
        if (target > video.duration) { cleanup(); reject(new Error(`la vidéo dure ${video.duration.toFixed(1)} secondes seulement.`)); return; }
        video.currentTime = target;
      };
      video.onseeked = () => {
        try {
          const width = 640, height = 360;
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, width, height);
          const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
          const w = video.videoWidth * scale, h = video.videoHeight * scale;
          ctx.drawImage(video, (width-w)/2, (height-h)/2, w, h);
          const data = canvas.toDataURL('image/jpeg', 0.72);
          cleanup(); resolve(data);
        } catch (error) { cleanup(); reject(new Error('extraction impossible (canvas ou sécurité CORS).')); }
      };
      video.src = src;
      video.load();
    });
  }


  function getSavedShareUrls() {
    try {
      const current = JSON.parse(localStorage.getItem('csj_share_links') || '{}');
      if (Object.keys(current).length) return current;
      const legacy = JSON.parse(localStorage.getItem('csj_share_link') || 'null');
      if (legacy?.id && legacy?.url) {
        const migrated = { [legacy.id]: legacy.url };
        localStorage.setItem('csj_share_links', JSON.stringify(migrated));
        return migrated;
      }
      return {};
    } catch { return {}; }
  }

  async function loadShareLinks() {
    const box = $('share-links-list');
    if (!box || state.role !== 'admin') return;
    try {
      const data = await api('/api/admin/share-links');
      const saved = getSavedShareUrls();
      const links = data.links || [];
      box.innerHTML = links.map(link => {
        const url = saved[link.id] || '';
        const created = link.created_at ? new Date(link.created_at).toLocaleString('fr-FR') : 'Date inconnue';
        const active = Number(link.active) === 1;
        return `<div class="share-link-row"><div class="share-link-info"><strong>Lien ${escapeHtml(String(link.id).slice(0, 8))} · ${active ? 'Actif' : 'Révoqué'}</strong><small>Créé le ${escapeHtml(created)}</small><div class="share-link-stats"><b>${Number(link.visits || 0)}</b> visites · <b>${Number(link.visitors || 0)}</b> visiteurs uniques</div>${url && active ? `<input class="share-link-url" readonly value="${escapeHtml(url)}" aria-label="URL du lien privé">` : (!url && active ? '<small class="muted">URL disponible uniquement sur le navigateur où le lien a été créé.</small>' : '')}</div><div class="share-link-actions">${url && active ? `<button class="button button-quiet" type="button" data-copy-share="${escapeHtml(link.id)}">Copier</button>` : ''}${active ? `<button class="button button-danger" type="button" data-delete-share="${escapeHtml(link.id)}">Révoquer</button>` : ''}</div></div>`;
      }).join('') || '<p class="muted small">Aucun lien privé actif pour le moment.</p>';
    } catch (error) { box.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
  }

  async function makeShareLink() {
    const secret = $('share-token').value.trim();
    $('share-error').textContent = '';
    if (secret.length < 8) { $('share-error').textContent = 'Choisis un code d’au moins 8 caractères.'; return; }
    try {
      const data = await api('/api/admin/share-links', { method: 'POST', body: JSON.stringify({ secret }) });
      const url = new URL(location.pathname, location.origin);
      url.searchParams.set('access', secret);
      const saved = getSavedShareUrls(); saved[data.id] = url.toString();
      localStorage.setItem('csj_share_links', JSON.stringify(saved));
      $('share-token').value = '';
      await loadShareLinks();
      toast('Lien privé créé.');
    } catch (error) { $('share-error').textContent = error.message; }
  }

  async function deleteShareLink(id) {
    if (!id || !confirm('Révoquer ce lien privé ? Il ne permettra plus d’accéder à la vidéothèque.')) return;
    try {
      await api(`/api/admin/share-links/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const saved = getSavedShareUrls(); delete saved[id];
      localStorage.setItem('csj_share_links', JSON.stringify(saved));
      await loadShareLinks();
      toast('Lien privé révoqué.');
    } catch (error) { $('share-error').textContent = error.message; }
  }

  async function copyShareLink(id) {
    const saved = getSavedShareUrls();
    if (!saved[id]) return;
    try { await navigator.clipboard.writeText(saved[id]); toast('Lien copié.'); }
    catch { toast('Copie impossible dans ce navigateur.'); }
  }

  function updateThumbnailMode() {
    const fromVideo = $('video-thumbnail-mode').value === 'video';
    $('video-thumbnail-second-wrap').classList.toggle('hidden', !fromVideo);
    $('video-thumbnail-file-wrap').classList.toggle('hidden', fromVideo);
  }

  function updateEditThumbnailMode() {
    const mode = $('edit-thumbnail-mode').value;
    $('edit-thumbnail-second-wrap').classList.toggle('hidden', mode !== 'video');
    $('edit-thumbnail-file-wrap').classList.toggle('hidden', mode !== 'file');
  }

  function imageFileToDataUrl(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Format image non accepté. Utilise JPG, PNG ou WebP.');
    if (file.size > 8 * 1024 * 1024) throw new Error('L’image doit faire moins de 8 Mo.');
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 640 / image.width, 360 / image.height);
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) { reject(e); }
        finally { URL.revokeObjectURL(url); }
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire cette image.')); };
      image.src = url;
    });
  }

  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    localStorage.setItem('csj_theme', selected);
    const isDark = selected === 'dark';
    const button = $('theme-toggle');
    if (button) {
      button.setAttribute('aria-label', isDark ? 'Passer en mode clair' : 'Passer en mode sombre');
      button.title = isDark ? 'Passer en mode clair' : 'Passer en mode sombre';
      $('theme-toggle-icon').textContent = isDark ? '☀' : '☾';
      $('theme-toggle-label').textContent = isDark ? 'Mode clair' : 'Mode sombre';
    }
    const meta = $('theme-color-meta');
    if (meta) meta.content = isDark ? '#0b1220' : '#f5f8f5';
  }

  async function init() {
    applyTheme(localStorage.getItem('csj_theme') || 'dark');
    $('theme-toggle').addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    $('viewer-login-form').addEventListener('submit', async e => {
      e.preventDefault();
      $('viewer-login-error').textContent = '';
      try {
        await viewerLogin($('viewer-token').value.trim());
        $('viewer-token').value = '';
      } catch (err) { $('viewer-login-error').textContent = err.message; }
    });

    $('admin-login-form').addEventListener('submit', async e => {
      e.preventDefault();
      $('admin-login-error').textContent = '';
      try {
        await adminLogin($('admin-password').value);
        $('admin-password').value = '';
      } catch (err) { $('admin-login-error').textContent = err.message; }
    });

    $('show-admin-login').addEventListener('click', () => {
      $('admin-login-form').classList.toggle('hidden');
      $('admin-password').focus();
    });

    $('admin-toggle').addEventListener('click', showAdmin);
    $('back-library').addEventListener('click', () => showView('library'));
    $('logout-button').addEventListener('click', () => {
      clearSession();
      showView('access');
      setStatus(false, 'Déconnecté');
      toast('Vous êtes déconnecté.');
    });

    $('search-input').addEventListener('input', debounce(() => loadVideos().catch(e => toast(e.message)), 300));
    $('year-filter').addEventListener('change', () => loadVideos().catch(e => toast(e.message)));
    $('category-filter').addEventListener('change', () => loadVideos().catch(e => toast(e.message)));
    $('reset-filters').addEventListener('click', () => {
      $('search-input').value = '';
      $('year-filter').value = '';
      $('category-filter').value = '';
      loadVideos().catch(e => toast(e.message));
    });

    $('video-grid').addEventListener('click', e => {
      const card = e.target.closest('[data-play]');
      if (card) openVideo(card.dataset.play);
    });
    $('video-grid').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-play]')) {
        e.preventDefault();
        openVideo(e.target.dataset.play);
      }
    });

    $('close-player').addEventListener('click', closePlayer);
    $('player-modal').addEventListener('click', e => {
      if (e.target.hasAttribute('data-close-player')) closePlayer();
    });

    $('upload-form').addEventListener('submit', uploadVideo);
    $('category-form').addEventListener('submit', addCategory);

    // Clic sur une vidéo dans l'administration : ouverture du même lecteur
    // que celui utilisé depuis la bibliothèque.
    $('admin-video-list').addEventListener('click', e => {
      const editButton = e.target.closest('[data-edit]');
      if (editButton) { e.stopPropagation(); openEditVideo(editButton.dataset.edit); return; }
      const deleteButton = e.target.closest('[data-delete]');
      if (deleteButton) {
        e.stopPropagation();
        deleteVideo(deleteButton.dataset.delete);
        return;
      }
      const row = e.target.closest('[data-play]');
      if (row) openVideo(row.dataset.play);
    });
    $('admin-video-list').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('button')) return;
      const row = e.target.closest('[data-play]');
      if (row) {
        e.preventDefault();
        openVideo(row.dataset.play);
      }
    });

    $('edit-video-form').addEventListener('submit', saveVideoEdits);
    $('close-edit-video').addEventListener('click', closeEditVideo);
    $('cancel-edit-video').addEventListener('click', closeEditVideo);
    $('edit-video-modal').addEventListener('click', e => {
      if (e.target.hasAttribute('data-close-edit')) closeEditVideo();
    });

    $('refresh-admin').addEventListener('click', () =>
      Promise.all([loadVideos(), loadStats(), loadShareLinks()])
        .then(() => toast('Données actualisées.'))
        .catch(e => toast(e.message))
    );

    $('make-share-link').addEventListener('click', makeShareLink);
    $('share-links-list').addEventListener('click', e => {
      const del = e.target.closest('[data-delete-share]');
      const copy = e.target.closest('[data-copy-share]');
      if (del) deleteShareLink(del.dataset.deleteShare);
      if (copy) copyShareLink(copy.dataset.copyShare);
    });
    $('video-thumbnail-mode').addEventListener('change', updateThumbnailMode);
    $('edit-thumbnail-mode').addEventListener('change', updateEditThumbnailMode);
    updateThumbnailMode(); updateEditThumbnailMode();
    $('copy-share-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('share-url').value);
        toast('Lien copié.');
      } catch {
        $('share-url').select();
        document.execCommand('copy');
        toast('Lien copié.');
      }
    });

    try {
      const response = await fetch(`${API}/api/health`);
      if (!response.ok) throw new Error();
      setStatus(true, 'API disponible');
    } catch { setStatus(false, 'API inaccessible'); }

    const fragment = new URLSearchParams(location.hash.slice(1));
    const secret = new URLSearchParams(location.search).get('access') || fragment.get('access');
    if (secret) {
      clearSession();
      history.replaceState(null, '', location.pathname);
      try { await viewerLogin(secret); }
      catch (e) {
        $('viewer-login-error').textContent = e.message;
        showView('access');
      }
    } else if (state.token) {
      await enterLibrary();
    } else {
      showView('access');
    }
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  document.addEventListener('DOMContentLoaded', init);
})();
