// Main app controller

document.addEventListener('DOMContentLoaded', async () => {

  // ── Service worker ────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data.type === 'CACHE_DONE')
          showCacheProgress(`Cached ${e.data.cached} of ${e.data.total} tiles`, 2000);
      });
    } catch (err) { console.warn('SW failed:', err); }
  }

  // ── DB + map init ─────────────────────────────────────────
  await seedDB.init();

  const lat  = parseFloat(await seedDB.getSetting('lastLat'))  || 37.5;
  const lng  = parseFloat(await seedDB.getSetting('lastLng'))  || -119.5;
  const zoom = parseInt(await seedDB.getSetting('lastZoom'))   || 8;
  seedMap.init(lat, lng, zoom);

  seedMap.map.on('moveend', () => {
    const c = seedMap.getCenter();
    seedDB.setSetting('lastLat',  c.lat);
    seedDB.setSetting('lastLng',  c.lng);
    seedDB.setSetting('lastZoom', seedMap.getZoom());
  });

  await polygonMgr.loadAll();

  // ── Map interactions ──────────────────────────────────────
  seedMap.map.on('click', e => {
    if (seedMap.isDrawing) return;
    const hits = seedMap.findPolygonsAtPoint(e.latlng, polygonMgr.polygons);
    hits.length ? polygonMgr.showDetailPanel(hits) : polygonMgr.hideDetailPanel();
  });

  seedMap.onPolygonDrawn(layer => {
    polygonMgr.openForm(layer, null);
    document.getElementById('btn-draw').classList.remove('active');
  });

  // ── GPS ───────────────────────────────────────────────────
  let gpsWatchId   = null;
  let gpsMarker    = null;
  let gpsAccCircle = null;
  let gpsFollowing = false;
  let headingWatch = null;
  let gpsHeading   = null;   // degrees from north

  function _gpsIcon(acquiring = false) {
    return L.divIcon({
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<div class="gps-dot-wrap${acquiring ? ' gps-acquiring' : ''}">
               <div class="gps-heading-cone" id="gps-cone"></div>
               <div class="gps-pulse"></div>
               <div class="gps-inner"></div>
             </div>`
    });
  }

  function _updateHeadingCone(deg) {
    const cone = document.getElementById('gps-cone');
    if (!cone) return;
    cone.style.display = 'block';
    cone.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
  }

  function _startHeading() {
    if (headingWatch) return;
    const handler = e => {
      if (e.absolute && e.alpha != null) {
        gpsHeading = e.alpha;
        _updateHeadingCone(gpsHeading);
      }
    };
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires permission
      DeviceOrientationEvent.requestPermission()
        .then(p => { if (p === 'granted') window.addEventListener('deviceorientationabsolute', handler, true); })
        .catch(() => {});
    } else {
      window.addEventListener('deviceorientationabsolute', handler, true);
    }
    headingWatch = handler;
  }

  function _stopHeading() {
    if (headingWatch) {
      window.removeEventListener('deviceorientationabsolute', headingWatch, true);
      headingWatch = null;
    }
  }

  document.getElementById('btn-gps').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('GPS not available on this device.'); return; }
    const btn = document.getElementById('btn-gps');

    if (gpsWatchId !== null) {
      // If already following, tapping again just re-centres
      if (gpsMarker && gpsFollowing === false) {
        gpsFollowing = true;
        seedMap.map.panTo(gpsMarker.getLatLng());
        return;
      }
      // Second tap while following → turn off
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
      _stopHeading();
      if (gpsMarker)    { seedMap.map.removeLayer(gpsMarker);    gpsMarker = null; }
      if (gpsAccCircle) { seedMap.map.removeLayer(gpsAccCircle); gpsAccCircle = null; }
      gpsFollowing = false;
      btn.classList.remove('active');
      return;
    }

    btn.classList.add('active');
    showCacheProgress('Acquiring GPS…');

    // Amber "acquiring" dot while waiting for first fix
    gpsMarker = L.marker([0, 0], { icon: _gpsIcon(true), zIndexOffset: 1000 });

    gpsWatchId = navigator.geolocation.watchPosition(pos => {
      const { latitude: la, longitude: lo, accuracy: acc } = pos.coords;

      if (!gpsMarker._map) {
        // First real fix — place marker and zoom in
        gpsMarker.setLatLng([la, lo]);
        gpsMarker.addTo(seedMap.map);
        gpsAccCircle = L.circle([la, lo], {
          radius: acc, color: '#3a7abd', weight: 1,
          fillColor: '#3a7abd', fillOpacity: 0.08, interactive: false
        }).addTo(seedMap.map);
        seedMap.map.setView([la, lo], Math.max(seedMap.getZoom(), 15));
        gpsFollowing = true;
        showCacheProgress(`GPS locked · ±${Math.round(acc)} m`, 2500);
        // Switch from amber to blue now that we have a fix
        gpsMarker.setIcon(_gpsIcon(false));
        _startHeading();
      } else {
        gpsMarker.setLatLng([la, lo]);
        gpsMarker.setIcon(_gpsIcon(false));
        gpsAccCircle.setLatLng([la, lo]).setRadius(acc);
        if (gpsFollowing) seedMap.map.panTo([la, lo]);
        if (gpsHeading !== null) _updateHeadingCone(gpsHeading);
      }
    }, err => {
      console.warn('GPS error:', err);
      // Don't kill the watch on a transient error — keep trying
      if (err.code === err.PERMISSION_DENIED) {
        btn.classList.remove('active');
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
        showCacheProgress('GPS permission denied', 3000);
      }
    }, { enableHighAccuracy: true, maximumAge: 2000 });
  });

  // Dragging stops auto-follow; tapping GPS button re-enables it
  seedMap.map.on('dragstart', () => { gpsFollowing = false; });

  // ── Offline badge ─────────────────────────────────────────
  const badge      = document.getElementById('offline-badge');
  const updateOnline = () => badge.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online',  updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  // ── Tab navigation ────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
      if (tabId === 'tab-map')     setTimeout(() => seedMap.map.invalidateSize(), 50);
      if (tabId === 'tab-records') seedRecords.render();
      if (tabId === 'tab-search')  seedSearch.clearHighlights();
    });
  });

  // ── Map toolbar ───────────────────────────────────────────
  document.getElementById('btn-draw').addEventListener('click', () => {
    const btn = document.getElementById('btn-draw');
    if (btn.classList.contains('active')) {
      seedMap.disableDrawMode(); btn.classList.remove('active');
    } else {
      seedMap.enableDrawMode(); btn.classList.add('active');
    }
  });

  document.getElementById('btn-layers').addEventListener('click', () => {
    document.getElementById('layers-panel').classList.remove('hidden');
    document.getElementById('layers-panel').classList.add('open');
  });
  document.getElementById('btn-layers-close').addEventListener('click', () => {
    document.getElementById('layers-panel').classList.remove('open');
  });

  document.getElementById('btn-basemap').addEventListener('click', () => {
    document.getElementById('modal-basemap').classList.remove('hidden');
    document.querySelectorAll('.basemap-option').forEach(b =>
      b.classList.toggle('active', b.dataset.basemap === seedMap.currentBasemap));
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
    if (!navigator.onLine) {
      showCacheProgress("You're offline — tiles cached while online are still available", 3000);
      return;
    }
    showCacheProgress('Calculating tiles...');
    try { await seedMap.cacheCurrentArea(msg => showCacheProgress(msg)); }
    catch { showCacheProgress('Cache failed — check connection', 3000); }
  });

  // ── Polygon form ──────────────────────────────────────────
  document.getElementById('field-seed-yield').addEventListener('input', e =>
    document.getElementById('yield-val').textContent = e.target.value);
  document.getElementById('field-abundance').addEventListener('input', e =>
    document.getElementById('abundance-val').textContent = e.target.value);

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });

  document.getElementById('field-layer').addEventListener('blur', e => {
    const name = e.target.value.trim();
    if (!name) return;
    const color  = polygonMgr.getColorForLayer(name);
    const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
    if (swatch) {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    }
  });

  document.getElementById('photo-upload-area').addEventListener('click', () =>
    document.getElementById('photo-input').click());

  document.getElementById('photo-input').addEventListener('change', async e => {
    for (const file of Array.from(e.target.files))
      polygonMgr.formPhotos.push(await fileToBase64(file));
    polygonMgr._renderPhotoPreview();
    e.target.value = '';
  });

  document.getElementById('btn-add-custom-field').addEventListener('click', () =>
    polygonMgr._addCustomFieldRow());

  document.getElementById('btn-save-polygon').addEventListener('click', async () => {
    const saved = await polygonMgr.saveFromForm(polygonMgr.pendingLeafletLayer);
    if (saved) {
      document.getElementById('modal-polygon').classList.add('hidden');
      seedRecords.render();
    }
  });

  document.getElementById('btn-cancel-polygon').addEventListener('click', () => {
    seedMap.drawnItems.clearLayers();
    polygonMgr.pendingLeafletLayer = null;
    polygonMgr.editingId = null;
    document.getElementById('modal-polygon').classList.add('hidden');
  });

  document.getElementById('btn-delete-polygon').addEventListener('click', async () => {
    if (!polygonMgr.editingId) return;
    if (!confirm('Delete this area? Cannot be undone.')) return;
    const id = polygonMgr.editingId;
    await polygonMgr.deletePolygon(id);
    polygonMgr.editingId = null;
    polygonMgr.pendingLeafletLayer = null;
    document.getElementById('modal-polygon').classList.add('hidden');
    polygonMgr.hideDetailPanel();
    seedRecords.render();
  });

  document.getElementById('btn-add-layer').addEventListener('click', () => {
    const name = prompt('New plant layer name:');
    if (name?.trim()) {
      polygonMgr._assignLayerColor(name.trim());
      polygonMgr._refreshLayersPanel();
    }
  });

  // ── Visit prompt ──────────────────────────────────────────
  document.getElementById('btn-visit-yes').addEventListener('click', () => polygonMgr.resolveVisit(true));
  document.getElementById('btn-visit-no').addEventListener('click',  () => polygonMgr.resolveVisit(false));
  document.getElementById('btn-visit-cancel').addEventListener('click', () =>
    document.getElementById('modal-visit').classList.add('hidden'));

  // ── Search ────────────────────────────────────────────────
  document.getElementById('btn-search').addEventListener('click',    () => seedSearch.runSearch());
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') seedSearch.runSearch();
  });
  document.getElementById('filter-in-season').addEventListener('change',  () => seedSearch.runSearch());
  document.getElementById('filter-skip-visited').addEventListener('change', () => seedSearch.runSearch());

  // ── Records ───────────────────────────────────────────────
  document.getElementById('records-filter').addEventListener('input',  () => seedRecords.render());
  document.getElementById('records-sort').addEventListener('change',   () => seedRecords.render());

  // ── Close modals on overlay tap ───────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(overlay =>
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    }));
});

// ── Helpers ───────────────────────────────────────────────────
function showCacheProgress(msg, autoHide = 0) {
  const el = document.getElementById('cache-progress');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (autoHide) setTimeout(() => el.classList.add('hidden'), autoHide);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
