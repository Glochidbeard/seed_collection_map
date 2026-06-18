// Polygon CRUD, form rendering, and detail panel

const LAYER_COLORS = [
  '#5b8c35','#c4882a','#3a7abd','#b54523','#8a5eb5',
  '#2a9d8f','#e9c46a','#f4a261','#264653','#a8dadc'
];

class PolygonManager {
  constructor() {
    this.polygons = []; // all loaded polygon data
    this.editingId = null;
    this.pendingLeafletLayer = null;
    this.formPhotos = []; // base64 photos for current form session
    this.visitPromptId = null;
    this._layerColors = new Map(); // plantLayer name -> color
    this._colorIndex = 0;
  }

  async loadAll() {
    this.polygons = await seedDB.getAllPolygons();
    this.polygons.forEach(p => {
      if (p.plantLayer && !this._layerColors.has(p.plantLayer)) {
        this._assignLayerColor(p.plantLayer, p.color);
      }
      seedMap.addPolygon(p);
    });
    this._refreshLayersPanel();
  }

  getColorForLayer(layerName) {
    if (!layerName) return LAYER_COLORS[0];
    if (!this._layerColors.has(layerName)) {
      this._assignLayerColor(layerName);
    }
    return this._layerColors.get(layerName);
  }

  _assignLayerColor(name, preferredColor) {
    const color = preferredColor || LAYER_COLORS[this._colorIndex % LAYER_COLORS.length];
    this._layerColors.set(name, color);
    this._colorIndex++;
  }

  // ===== FORM =====
  openForm(leafletLayer, existingId = null) {
    this.pendingLeafletLayer = leafletLayer;
    this.editingId = existingId;
    this.formPhotos = [];

    const existing = existingId ? this.polygons.find(p => p.id === existingId) : null;
    if (existing && existing.attributes.pictures) {
      this.formPhotos = [...existing.attributes.pictures];
    }

    const overlay = document.getElementById('modal-polygon');
    overlay.classList.remove('hidden');

    document.getElementById('form-title').textContent = existing ? 'Edit Collection Area' : 'New Collection Area';
    document.getElementById('btn-delete-polygon').classList.toggle('hidden', !existing);

    this._populateForm(existing);
    this._renderPhotoPreview();
  }

  _populateForm(data) {
    const a = data ? data.attributes : {};
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal('field-name', data ? data.name : '');
    setVal('field-layer', data ? (data.plantLayer || '') : '');
    setVal('field-botanical', a.botanicalName);
    setVal('field-date-visited', a.dateVisited);
    setVal('field-seed-yield', a.seedYield != null ? a.seedYield : 5);
    setVal('field-abundance', a.relativeAbundance != null ? a.relativeAbundance : 5);
    setVal('field-tools', a.toolsUsed);
    setVal('field-visit-start', a.suggestedVisitStart);
    setVal('field-visit-end', a.suggestedVisitEnd);
    setChecked('field-blooming', a.blooming);
    setChecked('field-fire', a.recentFire);
    setVal('field-unusual', a.unusualCharacteristics);
    setVal('field-inat', a.iNaturalistLink);
    setVal('field-other', a.other);

    this._updateRangeDisplay('field-seed-yield', 'yield-val');
    this._updateRangeDisplay('field-abundance', 'abundance-val');

    // Custom fields
    const customList = document.getElementById('custom-fields-list');
    customList.innerHTML = '';
    if (a.customFields) {
      Object.entries(a.customFields).forEach(([k, v]) => this._addCustomFieldRow(k, v));
    }

    // Color swatches
    const selectedColor = data ? data.color : LAYER_COLORS[0];
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === selectedColor);
    });
  }

  _updateRangeDisplay(inputId, displayId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (input && display) display.textContent = input.value;
  }

  _renderPhotoPreview() {
    const grid = document.getElementById('photo-preview-grid');
    grid.innerHTML = '';
    this.formPhotos.forEach((b64, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'preview-img-wrap';
      wrap.innerHTML = `<img src="${b64}" alt="photo ${i+1}">
        <button class="preview-remove" data-index="${i}">✕</button>`;
      grid.appendChild(wrap);
    });
    grid.querySelectorAll('.preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.formPhotos.splice(parseInt(btn.dataset.index), 1);
        this._renderPhotoPreview();
      });
    });
  }

  _addCustomFieldRow(key = '', val = '') {
    const list = document.getElementById('custom-fields-list');
    const row = document.createElement('div');
    row.className = 'custom-field-row';
    row.innerHTML = `
      <input type="text" class="custom-key" placeholder="Field name" value="${key}">
      <input type="text" class="custom-val" placeholder="Value" value="${val}">
      <button class="btn btn-ghost remove-custom-field">✕</button>`;
    row.querySelector('.remove-custom-field').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  collectFormData() {
    const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const getChecked = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    const getNum = id => { const el = document.getElementById(id); return el ? parseInt(el.value) : 0; };

    const selectedSwatch = document.querySelector('.color-swatch.selected');
    const color = selectedSwatch ? selectedSwatch.dataset.color : LAYER_COLORS[0];

    const customFields = {};
    document.querySelectorAll('.custom-field-row').forEach(row => {
      const k = row.querySelector('.custom-key').value.trim();
      const v = row.querySelector('.custom-val').value.trim();
      if (k) customFields[k] = v;
    });

    return {
      name: getVal('field-name') || 'Unnamed Area',
      plantLayer: getVal('field-layer') || '',
      color,
      attributes: {
        botanicalName: getVal('field-botanical'),
        dateVisited: getVal('field-date-visited'),
        seedYield: getNum('field-seed-yield'),
        relativeAbundance: getNum('field-abundance'),
        toolsUsed: getVal('field-tools'),
        suggestedVisitStart: getVal('field-visit-start'),
        suggestedVisitEnd: getVal('field-visit-end'),
        blooming: getChecked('field-blooming'),
        recentFire: getChecked('field-fire'),
        unusualCharacteristics: getVal('field-unusual'),
        iNaturalistLink: getVal('field-inat'),
        other: getVal('field-other'),
        pictures: [...this.formPhotos],
        visitHistory: [],
        skipUntilYear: null,
        customFields
      }
    };
  }

  async saveFromForm(leafletLayer) {
    const formData = this.collectFormData();

    let existing = null;
    if (this.editingId) {
      existing = this.polygons.find(p => p.id === this.editingId);
    }

    const geojson = leafletLayer
      ? leafletLayer.toGeoJSON()
      : (existing ? existing.geojson : null);

    if (!geojson) return null;

    // Merge visit history from existing
    if (existing) {
      formData.attributes.visitHistory = existing.attributes.visitHistory || [];
      formData.attributes.skipUntilYear = existing.attributes.skipUntilYear;
    }

    const polygon = {
      id: this.editingId || undefined,
      ...formData,
      geojson
    };

    const saved = await seedDB.savePolygon(polygon);

    // Update local cache
    const idx = this.polygons.findIndex(p => p.id === saved.id);
    if (idx >= 0) {
      this.polygons[idx] = saved;
      seedMap.updatePolygon(saved);
    } else {
      this.polygons.push(saved);
      if (leafletLayer) seedMap.drawnItems.removeLayer(leafletLayer);
      seedMap.addPolygon(saved);
    }

    // Update layer color map
    if (saved.plantLayer) {
      this._assignLayerColor(saved.plantLayer, saved.color);
    }

    this._refreshLayersPanel();
    this.editingId = null;
    this.pendingLeafletLayer = null;
    return saved;
  }

  async deletePolygon(id) {
    await seedDB.deletePolygon(id);
    this.polygons = this.polygons.filter(p => p.id !== id);
    seedMap.removePolygon(id);
    this._refreshLayersPanel();
  }

  // ===== DETAIL PANEL =====
  showDetailPanel(polygonsAtPoint) {
    if (!polygonsAtPoint.length) return;

    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');

    if (polygonsAtPoint.length === 1) {
      this._renderSingleDetail(polygonsAtPoint[0]);
    } else {
      this._renderMultiDetail(polygonsAtPoint);
    }
  }

  hideDetailPanel() {
    document.getElementById('detail-panel').classList.add('hidden');
  }

  _renderSingleDetail(p) {
    const panel = document.getElementById('detail-panel');
    const a = p.attributes;
    const inSeason = this._isInSeason(a.suggestedVisitStart, a.suggestedVisitEnd);

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div style="font-size:15px;font-weight:bold;color:var(--text-primary)">${escHtml(p.name)}</div>
          ${p.plantLayer ? `<div style="font-size:11px;color:var(--text-muted)">Layer: ${escHtml(p.plantLayer)}</div>` : ''}
        </div>
        <button class="close-btn" onclick="polygonMgr.hideDetailPanel()">✕</button>
      </div>

      ${p.attributes.botanicalName ? `
        <div style="padding:6px 16px;font-style:italic;color:var(--text-secondary);font-size:12px;">
          ${escHtml(a.botanicalName)}
        </div>` : ''}

      <div class="detail-body">
        <div class="attr-row">
          <div class="attr-item">
            <div class="attr-label">Seed Yield</div>
            <div class="attr-value">${this._ratingPips(a.seedYield, 'amber')}</div>
          </div>
          <div class="attr-item">
            <div class="attr-label">Abundance</div>
            <div class="attr-value">${this._ratingPips(a.relativeAbundance)}</div>
          </div>
        </div>

        <div class="attr-row">
          <div class="attr-item">
            <div class="attr-label">Last Visited</div>
            <div class="attr-value">${a.dateVisited || '<span class="text-muted">—</span>'}</div>
          </div>
          <div class="attr-item">
            <div class="attr-label">Season</div>
            <div class="attr-value">${this._seasonBadge(a.suggestedVisitStart, a.suggestedVisitEnd, inSeason)}</div>
          </div>
        </div>

        ${a.toolsUsed ? `
          <div class="attr-item mb-8">
            <div class="attr-label">Tools Used</div>
            <div class="attr-value">${escHtml(a.toolsUsed)}</div>
          </div>` : ''}

        <div class="attr-row">
          <div class="attr-item">
            <div class="attr-label">Blooming</div>
            <div class="attr-value"><span class="badge ${a.blooming ? 'badge-yes' : 'badge-no'}">${a.blooming ? 'Yes' : 'No'}</span></div>
          </div>
          <div class="attr-item">
            <div class="attr-label">Recent Fire</div>
            <div class="attr-value"><span class="badge ${a.recentFire ? 'badge-yes' : 'badge-no'}">${a.recentFire ? 'Yes' : 'No'}</span></div>
          </div>
        </div>

        ${a.unusualCharacteristics ? `
          <div class="attr-item mb-8">
            <div class="attr-label">Unusual Characteristics</div>
            <div class="attr-value">${escHtml(a.unusualCharacteristics)}</div>
          </div>` : ''}

        ${a.other ? `
          <div class="attr-item mb-8">
            <div class="attr-label">Other Notes</div>
            <div class="attr-value">${escHtml(a.other)}</div>
          </div>` : ''}

        ${a.iNaturalistLink ? `
          <div class="attr-item mb-8">
            <div class="attr-label">iNaturalist</div>
            <div class="attr-value" style="word-break:break-all;font-size:12px;color:var(--accent-green-light)">${escHtml(a.iNaturalistLink)}</div>
          </div>` : ''}

        ${this._renderCustomFields(a.customFields)}

        ${a.pictures && a.pictures.length ? `
          <div class="attr-label mb-8">Photos</div>
          <div class="photo-grid">
            ${a.pictures.map((b64, i) => `<img class="photo-thumb" src="${b64}" alt="photo ${i+1}"
              onclick="polygonMgr._viewPhoto('${p.id}', ${i})">`).join('')}
          </div>` : ''}

        ${a.skipUntilYear ? `
          <div style="margin-top:10px;padding:8px;background:#3a2010;border-radius:4px;font-size:11px;color:var(--accent-amber)">
            ⚠ Skipped until ${a.skipUntilYear} season
          </div>` : ''}

        ${a.visitHistory && a.visitHistory.length ? `
          <div class="attr-label mt-8">Visit History</div>
          ${a.visitHistory.slice(-3).map(v => `
            <div style="font-size:11px;color:var(--text-muted);padding:2px 0">${v.date} — ${v.wouldReturn ? 'Would return' : 'Skip season'}</div>`).join('')}
          ` : ''}
      </div>

      <div class="detail-actions">
        <button class="btn btn-amber" onclick="polygonMgr._markVisited('${p.id}')">✓ Mark Visited</button>
        <button class="btn btn-secondary" onclick="polygonMgr._editPolygon('${p.id}')">✏ Edit</button>
        <button class="btn btn-secondary" onclick="seedMap.panToPolygon('${p.id}')">⊕ Focus</button>
        <button class="btn btn-danger" onclick="polygonMgr._confirmDelete('${p.id}')">🗑 Delete</button>
      </div>`;
  }

  _renderMultiDetail(polygons) {
    const panel = document.getElementById('detail-panel');
    panel.innerHTML = `
      <div class="detail-header">
        <div style="font-weight:bold">${polygons.length} Overlapping Areas</div>
        <button class="close-btn" onclick="polygonMgr.hideDetailPanel()">✕</button>
      </div>
      <div style="padding:8px 12px">
        ${polygons.map(p => `
          <div class="result-card" onclick="polygonMgr._renderSingleDetail(polygonMgr.polygons.find(x=>x.id==='${p.id}'))">
            <div class="result-card-name">${escHtml(p.name)}</div>
            ${p.attributes.botanicalName ? `<div class="result-card-botanical">${escHtml(p.attributes.botanicalName)}</div>` : ''}
            <div class="result-card-meta">
              <span class="result-meta-item">Yield: ${p.attributes.seedYield ?? '—'}/10</span>
              <span class="result-meta-item">Abundance: ${p.attributes.relativeAbundance ?? '—'}/10</span>
            </div>
          </div>`).join('')}
      </div>`;
  }

  _ratingPips(val, style = '') {
    if (val == null || val === '') return '<span class="text-muted">—</span>';
    const n = parseInt(val);
    const pips = Array.from({length: 10}, (_, i) =>
      `<div class="rating-pip ${i < n ? 'filled' + (style ? ' ' + style : '') : ''}"></div>`
    ).join('');
    return `<div class="rating-bar">${pips}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${n}/10</div>`;
  }

  _seasonBadge(start, end, inSeason) {
    if (!start && !end) return '<span class="text-muted">—</span>';
    const label = `${start || '?'} – ${end || '?'}`;
    const cls = inSeason === true ? 'season-in' : inSeason === false ? 'season-out' : 'season-unknown';
    const icon = inSeason === true ? '✓' : inSeason === false ? '✕' : '?';
    return `<span class="season-indicator ${cls}">${icon} ${label}</span>`;
  }

  _renderCustomFields(customFields) {
    if (!customFields || !Object.keys(customFields).length) return '';
    return Object.entries(customFields).map(([k, v]) => `
      <div class="attr-item mb-8">
        <div class="attr-label">${escHtml(k)}</div>
        <div class="attr-value">${escHtml(v)}</div>
      </div>`).join('');
  }

  _isInSeason(startStr, endStr) {
    if (!startStr && !endStr) return null;
    const now = new Date();
    const year = now.getFullYear();
    const try_parse = (s) => {
      if (!s) return null;
      // Try MM-DD or Month Day or MM/DD
      const parts = s.match(/(\d{1,2})[\/\-](\d{1,2})/);
      if (parts) return new Date(year, parseInt(parts[1]) - 1, parseInt(parts[2]));
      // Try month name
      const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const m = s.toLowerCase().match(/([a-z]+)\s*(\d+)/);
      if (m && months[m[1].slice(0,3)] !== undefined) {
        return new Date(year, months[m[1].slice(0,3)], parseInt(m[2]));
      }
      return null;
    };
    const start = try_parse(startStr);
    const end = try_parse(endStr);
    if (!start && !end) return null;
    if (start && end) return now >= start && now <= end;
    if (start) return now >= start;
    if (end) return now <= end;
    return null;
  }

  _viewPhoto(polygonId, index) {
    const p = this.polygons.find(x => x.id === polygonId);
    if (!p || !p.attributes.pictures[index]) return;
    const win = window.open();
    win.document.write(`<img src="${p.attributes.pictures[index]}" style="max-width:100%;max-height:100vh">`);
  }

  async _confirmDelete(id) {
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await this.deletePolygon(id);
    seedSync.deletePolygon(id);
    this.hideDetailPanel();
    seedRecords.render();
  }

  async _editPolygon(id) {
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;
    this.hideDetailPanel();
    // Use the existing geojson, no new leaflet layer needed
    const fakeLayer = { toGeoJSON: () => p.geojson };
    this.openForm(fakeLayer, id);
  }

  async _markVisited(id) {
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;
    this.visitPromptId = id;
    document.getElementById('visit-area-name').textContent = p.name;
    document.getElementById('modal-visit').classList.remove('hidden');
  }

  async resolveVisit(wouldReturn) {
    const id = this.visitPromptId;
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;

    const today = new Date().toISOString().slice(0, 10);
    p.attributes.visitHistory = p.attributes.visitHistory || [];
    p.attributes.visitHistory.push({ date: today, wouldReturn });

    if (!wouldReturn) {
      p.attributes.skipUntilYear = new Date().getFullYear() + 1;
    }

    p.attributes.dateVisited = today;
    await seedDB.savePolygon(p);

    document.getElementById('modal-visit').classList.add('hidden');
    this.hideDetailPanel();
  }

  // ===== LAYERS PANEL =====
  _refreshLayersPanel() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';

    const layerNames = new Set(this.polygons.map(p => p.plantLayer).filter(Boolean));
    if (!layerNames.size) {
      list.innerHTML = '<div class="text-muted" style="padding:12px;font-size:12px">No plant layers yet. Draw an area and assign a layer name.</div>';
      return;
    }

    layerNames.forEach(name => {
      const color = this.getColorForLayer(name);
      const count = this.polygons.filter(p => p.plantLayer === name).length;
      const div = document.createElement('div');
      div.className = 'layer-item';
      div.innerHTML = `
        <div class="layer-color-dot" style="background:${color}"></div>
        <div class="layer-name">${escHtml(name)} <span class="text-muted">(${count})</span></div>
        <div class="layer-toggle on" data-layer="${escHtml(name)}" title="Toggle visibility"></div>`;
      div.querySelector('.layer-toggle').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const isOn = btn.classList.toggle('on');
        seedMap.setLayerVisible(name, isOn);
      });
      list.appendChild(div);
    });
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.polygonMgr = new PolygonManager();
window.escHtml = escHtml;
