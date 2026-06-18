// Main app controller

document.addEventListener('DOMContentLoaded', async () => {

  // ===== SERVICE WORKER =====
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data.type === 'CACHE_DONE') {
          showCacheProgress(`Cached ${e.data.cached} of ${e.data.total} tiles`, 2000);
        }
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  // ===== DB + MAP INIT =====
  await seedDB.init();

  const savedLat  = parseFloat(await seedDB.getSetting('lastLat'))  || 37.5;
  const savedLng  = parseFloat(await seedDB.getSetting('lastLng'))  || -119.5;
  const savedZoom = parseInt(await seedDB.getSetting('lastZoom'))   || 8;
  seedMap.init(savedLat, savedLng, savedZoom);

  seedMap.map.on('moveend', () => {
    const c = seedMap.getCenter();
    seedDB.setSetting('lastLat', c.lat);
    seedDB.setSetting('lastLng', c.lng);
    seedDB.setSetting('lastZoom', seedMap.getZoom());
  });

  // Load local polygons immediately (works offline)
  await polygonMgr.loadAll();

  // ===== AUTH + SYNC =====
  const supabaseReady = seedAuth.init();

  if (supabaseReady) {
    const session = await seedAuth.getSession();

    if (!session) {
      // Not logged in — show login modal (but app is already usable)
      document.getElementById('modal-login').classList.remove('hidden');
    } else {
      // Logged in — kick off background sync
      if (navigator.onLine) seedSync.fullSync();
    }

    seedAuth.onAuthChange(async (event, user) => {
      if (event === 'SIGNED_IN' && user) {
        document.getElementById('modal-login').classList.add('hidden');
        await seedSync.fullSync();
      }
    });

    // Flush pending changes whenever connection returns
    window.addEventListener('online', () => {
      seedSync._setStatus('syncing');
      seedSync.fullSync();
    });
    window.addEventListener('offline', () => seedSync._setStatus('offline'));
    if (!navigator.onLine) seedSync._setStatus('offline');
  }

  // Sign out button
  document.getElementById('btn-sign-out').addEventListener('click', async () => {
    if (!confirm('Sign out? The app will still work offline with your local data.')) return;
    await seedAuth.signOut();
    document.getElementById('modal-login').classList.remove('hidden');
  });

  // ===== LOGIN MODAL =====
  const loginError = document.getElementById('login-error');
  const showLoginError = (msg) => {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
  };

  document.getElementById('btn-do-signin').addEventListener('click', async () => {
    loginError.classList.add('hidden');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { showLoginError('Please enter email and password.'); return; }
    try {
      document.getElementById('btn-do-signin').textContent = 'Signing in...';
      await seedAuth.signIn(email, password);
    } catch (e) {
      showLoginError(e.message || 'Sign in failed.');
    } finally {
      document.getElementById('btn-do-signin').textContent = 'Sign In';
    }
  });

  document.getElementById('btn-do-signup').addEventListener('click', async () => {
    loginError.classList.add('hidden');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { showLoginError('Please enter email and password.'); return; }
    if (password.length < 6) { showLoginError('Password must be at least 6 characters.'); return; }
    try {
      document.getElementById('btn-do-signup').textContent = 'Creating...';
      await seedAuth.signUp(email, password);
      showLoginError(''); // clear
      loginError.style.color = 'var(--accent-green-light)';
      loginError.classList.remove('hidden');
      loginError.textContent = 'Account created! Check your email to confirm, then sign in.';
    } catch (e) {
      loginError.style.color = '';
      showLoginError(e.message || 'Sign up failed.');
    } finally {
      document.getElementById('btn-do-signup').textContent = 'Create Account';
    }
  });

  document.getElementById('btn-skip-login').addEventListener('click', () => {
    document.getElementById('modal-login').classList.add('hidden');
  });

  // Enter key on password field triggers sign in
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-do-signin').click();
  });

  // ===== MAP EVENTS =====
  seedMap.map.on('click', (e) => {
    const hits = seedMap.findPolygonsAtPoint(e.latlng, polygonMgr.polygons);
    if (hits.length) {
      polygonMgr.showDetailPanel(hits);
    } else {
      polygonMgr.hideDetailPanel();
    }
  });

  seedMap.onPolygonDrawn((layer) => {
    polygonMgr.openForm(layer, null);
    document.getElementById('btn-draw').classList.remove('active');
  });

  // ===== OFFLINE BADGE =====
  const offlineBadge = document.getElementById('offline-badge');
  const updateOnline = () => offlineBadge.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  // ===== TAB NAVIGATION =====
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      if (tabId === 'tab-map') setTimeout(() => seedMap.map.invalidateSize(), 50);
      if (tabId === 'tab-records') seedRecords.render();
    });
  });

  // ===== MAP TOOLBAR =====
  document.getElementById('btn-draw').addEventListener('click', () => {
    const btn = document.getElementById('btn-draw');
    if (btn.classList.contains('active')) {
      seedMap.disableDrawMode();
      btn.classList.remove('active');
    } else {
      seedMap.enableDrawMode();
      btn.classList.add('active');
    }
  });

  document.getElementById('btn-layers').addEventListener('click', () => {
    const panel = document.getElementById('layers-panel');
    panel.classList.remove('hidden');
    panel.classList.add('open');
  });

  document.getElementById('btn-layers-close').addEventListener('click', () => {
    document.getElementById('layers-panel').classList.remove('open');
  });

  document.getElementById('btn-basemap').addEventListener('click', () => {
    document.getElementById('modal-basemap').classList.remove('hidden');
    document.querySelectorAll('.basemap-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.basemap === seedMap.currentBasemap);
    });
  });

  document.querySelectorAll('.basemap-option').forEach(btn => {
    btn.addEventListener('click', () => {
      seedMap.switchBasemap(btn.dataset.basemap);
      document.getElementById('modal-basemap').classList.add('hidden');
    });
  });

  document.getElementById('close-basemap-modal').addEventListener('click', () => {
    document.getElementById('modal-basemap').classList.add('hidden');
  });

  document.getElementById('btn-cache').addEventListener('click', async () => {
    showCacheProgress('Calculating tiles...');
    try {
      await seedMap.cacheCurrentArea((msg) => showCacheProgress(msg));
    } catch {
      showCacheProgress('Cache failed — check connection', 3000);
    }
  });

  // ===== POLYGON FORM =====
  document.getElementById('field-seed-yield').addEventListener('input', (e) => {
    document.getElementById('yield-val').textContent = e.target.value;
  });
  document.getElementById('field-abundance').addEventListener('input', (e) => {
    document.getElementById('abundance-val').textContent = e.target.value;
  });

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });

  document.getElementById('field-layer').addEventListener('blur', (e) => {
    const layerName = e.target.value.trim();
    if (layerName) {
      const color = polygonMgr.getColorForLayer(layerName);
      const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
      if (swatch) {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      }
    }
  });

  document.getElementById('photo-upload-area').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    for (const file of Array.from(e.target.files)) {
      polygonMgr.formPhotos.push(await fileToBase64(file));
    }
    polygonMgr._renderPhotoPreview();
    e.target.value = '';
  });

  document.getElementById('btn-add-custom-field').addEventListener('click', () => {
    polygonMgr._addCustomFieldRow();
  });

  // Save polygon — local first, then sync
  document.getElementById('btn-save-polygon').addEventListener('click', async () => {
    const layer  = polygonMgr.pendingLeafletLayer;
    const saved  = await polygonMgr.saveFromForm(layer);
    if (saved) {
      document.getElementById('modal-polygon').classList.add('hidden');
      seedRecords.render();
      seedSync.upsertPolygon(saved); // async, non-blocking
    }
  });

  document.getElementById('btn-cancel-polygon').addEventListener('click', () => {
    if (polygonMgr.pendingLeafletLayer && !polygonMgr.editingId) {
      seedMap.drawnItems.removeLayer(polygonMgr.pendingLeafletLayer);
    }
    polygonMgr.pendingLeafletLayer = null;
    polygonMgr.editingId = null;
    document.getElementById('modal-polygon').classList.add('hidden');
  });

  // Delete polygon — local first, then sync soft-delete
  document.getElementById('btn-delete-polygon').addEventListener('click', async () => {
    if (!polygonMgr.editingId) return;
    if (!confirm('Delete this collection area? This cannot be undone.')) return;
    const id = polygonMgr.editingId;
    await polygonMgr.deletePolygon(id);
    seedSync.deletePolygon(id); // async, non-blocking
    polygonMgr.editingId = null;
    polygonMgr.pendingLeafletLayer = null;
    document.getElementById('modal-polygon').classList.add('hidden');
    polygonMgr.hideDetailPanel();
    seedRecords.render();
  });

  document.getElementById('btn-add-layer').addEventListener('click', () => {
    const name = prompt('New plant layer name:');
    if (name && name.trim()) {
      polygonMgr._assignLayerColor(name.trim());
      polygonMgr._refreshLayersPanel();
    }
  });

  // ===== VISIT PROMPT =====
  document.getElementById('btn-visit-yes').addEventListener('click', async () => {
    await polygonMgr.resolveVisit(true);
    const p = polygonMgr.polygons.find(x => x.id === polygonMgr.visitPromptId);
    if (p) seedSync.upsertPolygon(p);
  });
  document.getElementById('btn-visit-no').addEventListener('click', async () => {
    await polygonMgr.resolveVisit(false);
    const p = polygonMgr.polygons.find(x => x.id === polygonMgr.visitPromptId);
    if (p) seedSync.upsertPolygon(p);
  });
  document.getElementById('btn-visit-cancel').addEventListener('click', () => {
    document.getElementById('modal-visit').classList.add('hidden');
  });

  // ===== SEARCH =====
  document.getElementById('btn-search').addEventListener('click', () => seedSearch.runSearch());
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') seedSearch.runSearch();
  });
  document.getElementById('filter-in-season').addEventListener('change', () => seedSearch.runSearch());
  document.getElementById('filter-skip-visited').addEventListener('change', () => seedSearch.runSearch());

  // ===== RECORDS =====
  document.getElementById('records-filter').addEventListener('input', () => seedRecords.render());
  document.getElementById('records-sort').addEventListener('change', () => seedRecords.render());

  // ===== CLOSE MODALS ON OVERLAY CLICK =====
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !overlay.id.includes('login')) {
        overlay.classList.add('hidden');
      }
    });
  });
});

// ===== HELPERS =====
function showCacheProgress(msg, autoHide = 0) {
  const el = document.getElementById('cache-progress');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (autoHide) setTimeout(() => el.classList.add('hidden'), autoHide);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
