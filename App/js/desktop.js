// Desktop interface controller

const HIGHLIGHT = {
  1: { color: '#c4882a', weight: 3, fillOpacity: 0.35 },
  2: { color: '#e8c030', weight: 4, fillOpacity: 0.45 },
  3: { color: '#7aff50', weight: 5, fillOpacity: 0.55 },
};

class DesktopApp {
  constructor() {
    this.polygons   = [];
    this.projects   = [];
    this.filtered   = [];
    this.selectedId = null;
    this.map        = null;
    this.layers     = new Map();  // id -> L.geoJSON layer
    this.speciesTags = [];        // active species filter tags
    this.gpsWatch   = null;
    this.gpsMarker  = null;
  }

  async init() {
    await seedDB.init();
    [this.polygons, this.projects] = await Promise.all([
      seedDB.getAllPolygons(),
      seedDB.getAllProjects()
    ]);

    this._initMap();
    this._renderProjectFilters();
    this._buildSidebarToggles();
    this._bindControls();
    this._applyFilters();
  }

  // ── Map ───────────────────────────────────────────────────
  _initMap() {
    this.map = L.map('desktop-map', {
      center: [37.5, -119.5],
      zoom: 8,
      zoomControl: true
    });

    // Default: ESRI satellite for office use
    this.basemapLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '&copy; Esri', maxZoom: 19 }
    ).addTo(this.map);

    // Labels overlay on satellite
    this.labelsLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, opacity: 0.8 }
    ).addTo(this.map);

    this.currentBasemap = 'esri-imagery';

    this.map.on('click', e => {
      const pt   = turf.point([e.latlng.lng, e.latlng.lat]);
      const hits = this.filtered.filter(p => {
        try { return turf.booleanPointInPolygon(pt, p.geojson); } catch { return false; }
      });
      if (hits.length) this._showDetail(hits[0]);
    });
  }

  _addPolygonToMap(p) {
    const color = p.color || '#5b8c35';
    const layer = L.geoJSON(p.geojson, {
      style: { color, weight: 2, fillColor: color, fillOpacity: 0.25 }
    });
    layer.on('click', e => {
      L.DomEvent.stopPropagation(e);
      this._showDetail(p);
    });
    layer.addTo(this.map);
    this.layers.set(p.id, layer);
  }

  _clearMapLayers() {
    this.layers.forEach(l => this.map.removeLayer(l));
    this.layers.clear();
  }

  switchBasemap(key) {
    const MAPS = {
      'esri-imagery': {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr: '&copy; Esri', labels: true
      },
      'usgs-topo': {
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
        attr: 'USGS', labels: false
      },
      'usgs-imagery': {
        url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
        attr: 'USGS', labels: false
      },
      'open-topo': {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attr: '&copy; OpenTopoMap', labels: false, sub: 'abc'
      },
      'osm': {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attr: '&copy; OSM', labels: false, sub: 'abc'
      }
    };
    const bm = MAPS[key];
    if (!bm) return;
    if (this.basemapLayer) this.map.removeLayer(this.basemapLayer);
    if (this.labelsLayer)  this.map.removeLayer(this.labelsLayer);
    this.basemapLayer = L.tileLayer(bm.url, {
      attribution: bm.attr, maxZoom: 19,
      subdomains: bm.sub || 'a'
    }).addTo(this.map);
    if (bm.labels) {
      this.labelsLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.8 }
      ).addTo(this.map);
    } else {
      this.labelsLayer = null;
    }
    this.currentBasemap = key;
    document.querySelectorAll('.dsk-basemap-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.basemap === key));
  }

  // ── Filters ───────────────────────────────────────────────
  _applyFilters() {
    const seasonDate  = document.getElementById('f-season-date')?.value;
    const yieldMin    = parseInt(document.getElementById('f-yield-min')?.value  ?? 0);
    const yieldMax    = parseInt(document.getElementById('f-yield-max')?.value  ?? 10);
    const abundMin    = parseInt(document.getElementById('f-abund-min')?.value  ?? 0);
    const abundMax    = parseInt(document.getElementById('f-abund-max')?.value  ?? 10);
    const blooming    = document.getElementById('f-blooming')?.value;
    const fire        = document.getElementById('f-fire')?.value;
    const hideSkip    = document.getElementById('f-hide-skip')?.checked;

    const checkedProjs = [...document.querySelectorAll('.proj-filter-cb:checked')].map(c => c.value);
    const anyProj      = document.getElementById('f-proj-any')?.checked ?? true;

    let pool = [...this.polygons];

    // Species tags
    if (this.speciesTags.length) {
      pool = pool.filter(p => {
        const sp = this._getSpecies(p).map(s => s.toLowerCase());
        return this.speciesTags.some(tag => sp.some(s => s.includes(tag) || tag.includes(s)));
      });
    }

    // Season
    if (seasonDate) {
      const d = new Date(seasonDate + 'T12:00:00');
      pool = pool.filter(p => {
        const inS = this._isInSeason(p.attributes.suggestedVisitStart, p.attributes.suggestedVisitEnd, d);
        return inS !== false;
      });
    }

    // Yield range
    pool = pool.filter(p => {
      const y = p.attributes.seedYield ?? 5;
      return y >= yieldMin && y <= yieldMax;
    });

    // Abundance range
    pool = pool.filter(p => {
      const a = p.attributes.relativeAbundance ?? 5;
      return a >= abundMin && a <= abundMax;
    });

    // Blooming filter
    if (blooming === 'yes') pool = pool.filter(p => p.attributes.blooming);
    if (blooming === 'no')  pool = pool.filter(p => !p.attributes.blooming);

    // Fire filter
    if (fire === 'yes') pool = pool.filter(p => p.attributes.recentFire);
    if (fire === 'no')  pool = pool.filter(p => !p.attributes.recentFire);

    // Skip-listed
    if (hideSkip) {
      const yr = new Date().getFullYear();
      pool = pool.filter(p => !p.attributes.skipUntilYear || p.attributes.skipUntilYear <= yr);
    }

    // Projects
    if (checkedProjs.length) {
      pool = pool.filter(p => {
        const pids = p.projectIds || [];
        return anyProj
          ? checkedProjs.some(id => pids.includes(id))
          : checkedProjs.every(id => pids.includes(id));
      });
    }

    this.filtered = pool;
    this._renderMapAndResults();
  }

  _renderMapAndResults() {
    this._clearMapLayers();

    // Score by species matches if tags active
    const scoreMap = new Map();
    if (this.speciesTags.length) {
      this.filtered.forEach(p => {
        const sp   = this._getSpecies(p).map(s => s.toLowerCase());
        const hits = this.speciesTags.filter(tag => sp.some(s => s.includes(tag) || tag.includes(s))).length;
        scoreMap.set(p.id, hits);
      });
    }

    this.filtered.forEach(p => {
      this._addPolygonToMap(p);
      const hits = scoreMap.get(p.id) || 0;
      if (hits > 0) {
        const style = HIGHLIGHT[Math.min(hits, 3)];
        this.layers.get(p.id)?.setStyle(style);
      }
    });

    document.getElementById('dsk-match-count').textContent =
      `${this.filtered.length} area${this.filtered.length !== 1 ? 's' : ''} shown`;

    this._renderResultsList();
  }

  _renderResultsList() {
    const container = document.getElementById('sidebar-results');
    if (!this.filtered.length) {
      container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No areas match current filters.</div>';
      return;
    }

    // Sort by species match score desc, then name
    const scored = this.filtered.map(p => {
      const sp   = this._getSpecies(p).map(s => s.toLowerCase());
      const hits = this.speciesTags.filter(tag => sp.some(s => s.includes(tag) || tag.includes(s))).length;
      return { p, hits };
    }).sort((a, b) => b.hits - a.hits || (a.p.name||'').localeCompare(b.p.name||''));

    container.innerHTML = scored.map(({ p, hits }) => {
      const sp    = this._getSpecies(p);
      const color = p.color || '#5b8c35';
      const hl    = hits > 0 ? HIGHLIGHT[Math.min(hits, 3)].color : color;
      return `<div class="result-row ${this.selectedId === p.id ? 'selected' : ''}"
          onclick="desktop._showDetail(desktop.polygons.find(x=>x.id==='${p.id}'))">
        <div class="rr-color" style="background:${hl}"></div>
        <div class="rr-info">
          <div class="rr-name">${escHtml(p.name)}</div>
          ${sp.length ? `<div class="rr-species">${sp.map(escHtml).join(', ')}</div>` : ''}
          <div class="rr-meta">
            ${p.attributes.seedYield != null ? `Y:${p.attributes.seedYield} ` : ''}
            ${p.attributes.relativeAbundance != null ? `A:${p.attributes.relativeAbundance}` : ''}
            ${p.attributes.dateVisited ? ` · ${p.attributes.dateVisited}` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Detail panel ──────────────────────────────────────────
  _showDetail(p) {
    this.selectedId = p.id;
    const detail = document.getElementById('desktop-detail');
    const a      = p.attributes;
    const sp     = this._getSpecies(p);
    const projNames = (p.projectIds || [])
      .map(id => this.projects.find(pr => pr.id === id)?.name)
      .filter(Boolean).join(', ');

    const field = (label, val) => val != null && val !== ''
      ? `<div><div class="attr-label">${label}</div><div class="attr-value">${escHtml(String(val))}</div></div>`
      : '';

    detail.classList.add('visible');
    detail.innerHTML = `
      <div class="dsk-detail-header">
        <div>
          <div class="dsk-detail-title">${escHtml(p.name)}</div>
          ${sp.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
            ${sp.map(s => `<span class="species-tag">${escHtml(s)}</span>`).join('')}
          </div>` : ''}
        </div>
        ${projNames ? `<div style="font-size:11px;color:var(--accent-amber)">${escHtml(projNames)}</div>` : ''}
        <button class="close-btn" onclick="document.getElementById('desktop-detail').classList.remove('visible');desktop.selectedId=null;desktop._renderResultsList()">✕</button>
      </div>
      <div class="dsk-detail-body">
        ${field('Date Visited', a.dateVisited)}
        <div>
          <div class="attr-label">Seed Yield</div>
          <div class="attr-value">${a.seedYield ?? '—'}/10</div>
        </div>
        <div>
          <div class="attr-label">Abundance</div>
          <div class="attr-value">${a.relativeAbundance ?? '—'}/10</div>
        </div>
        ${field('Tools Used', a.toolsUsed)}
        ${field('Visit Window', a.suggestedVisitStart || a.suggestedVisitEnd ? `${a.suggestedVisitStart||'?'} – ${a.suggestedVisitEnd||'?'}` : null)}
        <div>
          <div class="attr-label">Blooming</div>
          <div class="attr-value"><span class="badge ${a.blooming ? 'badge-yes':'badge-no'}">${a.blooming?'Yes':'No'}</span></div>
        </div>
        <div>
          <div class="attr-label">Recent Fire</div>
          <div class="attr-value"><span class="badge ${a.recentFire ? 'badge-yes':'badge-no'}">${a.recentFire?'Yes':'No'}</span></div>
        </div>
        ${field('Unusual', a.unusualCharacteristics)}
        ${field('Other', a.other)}
        ${field('iNaturalist', a.iNaturalistLink)}
        ${a.customFields ? Object.entries(a.customFields).map(([k,v]) => field(k,v)).join('') : ''}
        ${a.skipUntilYear ? `<div><div class="attr-label">Skip Until</div><div class="attr-value" style="color:var(--accent-amber)">${a.skipUntilYear}</div></div>` : ''}
      </div>`;

    // Pan map to polygon
    const layer = this.layers.get(p.id);
    if (layer) {
      try { this.map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 15 }); } catch {}
    }

    this._renderResultsList();
  }

  // ── Projects sidebar ──────────────────────────────────────
  _renderProjectFilters() {
    const container = document.getElementById('proj-filter-list');
    if (!container) return;
    if (!this.projects.length) {
      container.innerHTML = '<div style="font-size:11px;color:var(--text-muted)">No projects yet.</div>';
      return;
    }
    container.innerHTML = this.projects.map(pr => `
      <label class="project-check-row">
        <input type="checkbox" class="proj-filter-cb dsk-check" value="${pr.id}">
        <span class="project-dot" style="background:${pr.color}"></span>
        ${escHtml(pr.name)}
      </label>`).join('');
    container.querySelectorAll('.proj-filter-cb').forEach(cb =>
      cb.addEventListener('change', () => this._applyFilters()));
  }

  // ── Species tag input ─────────────────────────────────────
  _initSpeciesTagInput() {
    const tagBox = document.getElementById('species-tag-box');
    const input  = document.getElementById('species-tag-input');
    if (!tagBox || !input) return;

    const addTag = (raw) => {
      raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).forEach(tag => {
        if (!this.speciesTags.includes(tag)) {
          this.speciesTags.push(tag);
          const span = document.createElement('span');
          span.className = 'filter-tag';
          span.innerHTML = `${escHtml(tag)} <button data-tag="${escHtml(tag)}">×</button>`;
          span.querySelector('button').addEventListener('click', () => {
            this.speciesTags = this.speciesTags.filter(t => t !== tag);
            span.remove();
            this._applyFilters();
          });
          tagBox.insertBefore(span, input);
        }
      });
      input.value = '';
      this._applyFilters();
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input.value); }
      if (e.key === 'Backspace' && !input.value && this.speciesTags.length) {
        const last = this.speciesTags.pop();
        tagBox.querySelector(`[data-tag="${escHtml(last)}"]`)?.parentElement?.remove();
        this._applyFilters();
      }
    });
    tagBox.addEventListener('click', () => input.focus());
  }

  // ── Export CSV ────────────────────────────────────────────
  exportCSV() {
    const modal = document.getElementById('modal-export');
    modal.classList.remove('hidden');
  }

  doExport() {
    const checked = [...document.querySelectorAll('.col-option input:checked')].map(c => c.value);
    if (!checked.length) { alert('Select at least one column.'); return; }

    const rows = [checked];
    this.filtered.forEach(p => {
      const a  = p.attributes;
      const sp = this._getSpecies(p);
      const projNames = (p.projectIds||[])
        .map(id => this.projects.find(pr => pr.id === id)?.name).filter(Boolean);
      let centLat = '', centLon = '';
      try {
        const c = turf.centroid(p.geojson);
        centLon = c.geometry.coordinates[0].toFixed(6);
        centLat = c.geometry.coordinates[1].toFixed(6);
      } catch {}

      const ALL = {
        name:        p.name || '',
        species:     sp.join('; '),
        projects:    projNames.join('; '),
        layer:       p.plantLayer || '',
        date_visited: a.dateVisited || '',
        seed_yield:  a.seedYield ?? '',
        abundance:   a.relativeAbundance ?? '',
        tools:       a.toolsUsed || '',
        visit_start: a.suggestedVisitStart || '',
        visit_end:   a.suggestedVisitEnd || '',
        blooming:    a.blooming ? 'Yes' : 'No',
        fire:        a.recentFire ? 'Yes' : 'No',
        unusual:     a.unusualCharacteristics || '',
        inat:        a.iNaturalistLink || '',
        other:       a.other || '',
        centroid_lat: centLat,
        centroid_lon: centLon,
        ...(a.customFields || {})
      };
      rows.push(checked.map(k => this._csvCell(ALL[k] ?? '')));
    });

    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `seed_cache_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    document.getElementById('modal-export').classList.add('hidden');
  }

  _csvCell(val) {
    const s = String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }

  // ── GPS ───────────────────────────────────────────────────
  toggleGPS() {
    const btn = document.getElementById('btn-dsk-gps');
    if (this.gpsWatch !== null) {
      navigator.geolocation.clearWatch(this.gpsWatch);
      this.gpsWatch = null;
      if (this.gpsMarker) { this.map.removeLayer(this.gpsMarker); this.gpsMarker = null; }
      btn.classList.remove('active');
      return;
    }
    if (!navigator.geolocation) { alert('GPS not available.'); return; }
    btn.classList.add('active');
    this.gpsWatch = navigator.geolocation.watchPosition(pos => {
      const { latitude: la, longitude: lo } = pos.coords;
      if (!this.gpsMarker) {
        this.gpsMarker = L.circleMarker([la, lo], {
          radius: 8, color: '#fff', weight: 2,
          fillColor: '#3a7abd', fillOpacity: 1
        }).addTo(this.map);
        this.map.setView([la, lo], Math.max(this.map.getZoom(), 13));
      } else {
        this.gpsMarker.setLatLng([la, lo]);
      }
    }, () => { btn.classList.remove('active'); this.gpsWatch = null; },
    { enableHighAccuracy: true });
  }

  // ── Sidebar section toggles ───────────────────────────────
  _buildSidebarToggles() {
    document.querySelectorAll('.sidebar-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const body   = header.nextElementSibling;
        const toggle = header.querySelector('.section-toggle');
        body.classList.toggle('collapsed');
        toggle.classList.toggle('collapsed');
      });
    });
  }

  // ── Wire all controls ─────────────────────────────────────
  _bindControls() {
    this._initSpeciesTagInput();

    // Filter inputs → re-apply
    ['f-season-date','f-yield-min','f-yield-max','f-abund-min','f-abund-max',
     'f-blooming','f-fire','f-hide-skip','f-proj-any'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this._applyFilters());
    });

    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      this.speciesTags = [];
      document.getElementById('species-tag-box').querySelectorAll('.filter-tag').forEach(t => t.remove());
      document.getElementById('f-season-date').value  = '';
      document.getElementById('f-yield-min').value    = 0;
      document.getElementById('f-yield-max').value    = 10;
      document.getElementById('f-abund-min').value    = 0;
      document.getElementById('f-abund-max').value    = 10;
      document.getElementById('f-blooming').value     = 'any';
      document.getElementById('f-fire').value         = 'any';
      document.getElementById('f-hide-skip').checked  = false;
      document.querySelectorAll('.proj-filter-cb').forEach(c => c.checked = false);
      this._applyFilters();
    });

    // Basemap buttons
    document.querySelectorAll('.dsk-basemap-btn').forEach(btn =>
      btn.addEventListener('click', () => this.switchBasemap(btn.dataset.basemap)));

    // GPS
    document.getElementById('btn-dsk-gps')?.addEventListener('click', () => this.toggleGPS());

    // Export
    document.getElementById('btn-export')?.addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-do-export')?.addEventListener('click', () => this.doExport());
    document.getElementById('btn-cancel-export')?.addEventListener('click', () =>
      document.getElementById('modal-export').classList.add('hidden'));

    // Select/deselect all columns
    document.getElementById('btn-cols-all')?.addEventListener('click', () =>
      document.querySelectorAll('.col-option input').forEach(c => { c.checked = true; c.closest('.col-option').classList.add('selected'); }));
    document.getElementById('btn-cols-none')?.addEventListener('click', () =>
      document.querySelectorAll('.col-option input').forEach(c => { c.checked = false; c.closest('.col-option').classList.remove('selected'); }));
    document.querySelectorAll('.col-option').forEach(opt => {
      opt.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') opt.classList.toggle('selected', e.target.checked);
        else { const cb = opt.querySelector('input'); cb.checked = !cb.checked; opt.classList.toggle('selected', cb.checked); }
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────
  _getSpecies(p) {
    const a = p.attributes;
    if (Array.isArray(a.species)) return a.species.filter(Boolean);
    if (a.botanicalName) return [a.botanicalName];
    return [];
  }

  _isInSeason(startStr, endStr, refDate = new Date()) {
    if (!startStr && !endStr) return null;
    const yr = refDate.getFullYear();
    const parse = s => {
      if (!s) return null;
      const d1 = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (d1) return new Date(yr, parseInt(d1[1])-1, parseInt(d1[2]));
      const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const d2 = s.toLowerCase().match(/([a-z]+)\s*(\d+)/);
      if (d2 && months[d2[1].slice(0,3)] !== undefined)
        return new Date(yr, months[d2[1].slice(0,3)], parseInt(d2[2]));
      return null;
    };
    const s = parse(startStr), e = parse(endStr);
    if (s && e) return refDate >= s && refDate <= e;
    if (s) return refDate >= s;
    if (e) return refDate <= e;
    return null;
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const desktop = new DesktopApp();
document.addEventListener('DOMContentLoaded', () => desktop.init());
