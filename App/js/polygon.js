// Polygon CRUD, form rendering, detail panel

const LAYER_COLORS = [
  '#5b8c35','#c4882a','#3a7abd','#b54523','#8a5eb5',
  '#2a9d8f','#e9c46a','#f4a261','#264653','#a8dadc'
];

class PolygonManager {
  constructor() {
    this.polygons    = [];
    this.projects    = [];
    this.editingId   = null;
    this.pendingLeafletLayer = null;
    this.formPhotos  = [];
    this.visitPromptId = null;
    this._layerColors  = new Map();
    this._colorIndex   = 0;
  }

  async loadAll() {
    [this.polygons, this.projects] = await Promise.all([
      seedDB.getAllPolygons(),
      seedDB.getAllProjects()
    ]);
    this.polygons.forEach(p => {
      if (p.plantLayer && !this._layerColors.has(p.plantLayer)) {
        this._assignLayerColor(p.plantLayer, p.color);
      }
      seedMap.addPolygon(p);
    });
    this._refreshLayersPanel();
  }

  getColorForLayer(name) {
    if (!name) return LAYER_COLORS[0];
    if (!this._layerColors.has(name)) this._assignLayerColor(name);
    return this._layerColors.get(name);
  }

  _assignLayerColor(name, preferred) {
    const color = preferred || LAYER_COLORS[this._colorIndex % LAYER_COLORS.length];
    this._layerColors.set(name, color);
    this._colorIndex++;
  }

  // ── Species helpers ───────────────────────────────────────
  getSpecies(p) {
    // Support both new array format and legacy string
    const a = p.attributes;
    if (Array.isArray(a.species)) return a.species.filter(Boolean);
    if (a.botanicalName) return [a.botanicalName];
    return [];
  }

  // ── Form ──────────────────────────────────────────────────
  openForm(leafletLayer, existingId = null) {
    this.pendingLeafletLayer = leafletLayer;
    this.editingId  = existingId;
    this.formPhotos = [];

    const existing = existingId ? this.polygons.find(p => p.id === existingId) : null;
    if (existing?.attributes?.pictures) this.formPhotos = [...existing.attributes.pictures];

    document.getElementById('modal-polygon').classList.remove('hidden');
    document.getElementById('form-title').textContent = existing ? 'Edit Collection Area' : 'New Collection Area';
    document.getElementById('btn-delete-polygon').classList.toggle('hidden', !existing);

    this._populateForm(existing);
    this._renderPhotoPreview();
    this._renderProjectChips();
  }

  _populateForm(data) {
    const a    = data ? data.attributes : {};
    const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setV('field-name',        data?.name ?? '');
    setV('field-layer',       data?.plantLayer ?? '');
    setV('field-species',     (Array.isArray(a.species) ? a.species : a.botanicalName ? [a.botanicalName] : []).join(', '));
    setV('field-date-visited', a.dateVisited);
    setV('field-seed-yield',   a.seedYield != null ? a.seedYield : 5);
    setV('field-abundance',    a.relativeAbundance != null ? a.relativeAbundance : 5);
    setV('field-tools',        a.toolsUsed);
    setV('field-visit-start',  a.suggestedVisitStart);
    setV('field-visit-end',    a.suggestedVisitEnd);
    setC('field-blooming',     a.blooming);
    setC('field-fire',         a.recentFire);
    setV('field-unusual',      a.unusualCharacteristics);
    setV('field-inat',         a.iNaturalistLink);
    setV('field-other',        a.other);

    document.getElementById('yield-val').textContent     = a.seedYield ?? 5;
    document.getElementById('abundance-val').textContent = a.relativeAbundance ?? 5;

    // Project checkboxes
    const selected = data?.projectIds ?? [];
    document.getElementById('form-project-list').dataset.selected = JSON.stringify(selected);

    // Custom fields
    document.getElementById('custom-fields-list').innerHTML = '';
    if (a.customFields) {
      Object.entries(a.customFields).forEach(([k, v]) => this._addCustomFieldRow(k, v));
    }

    // Color swatches
    const color = data?.color ?? LAYER_COLORS[0];
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === color);
    });
  }

  _renderProjectChips() {
    const container = document.getElementById('form-project-list');
    if (!container) return;
    const selected  = JSON.parse(container.dataset.selected || '[]');

    if (!this.projects.length) {
      container.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">No projects yet — create one in the Records tab.</span>';
      return;
    }

    container.innerHTML = this.projects.map(proj => {
      const on = selected.includes(proj.id);
      return `<label class="project-chip ${on ? 'on' : ''}" data-id="${proj.id}"
        style="border-color:${proj.color};${on ? `background:${proj.color}20` : ''}">
        <input type="checkbox" value="${proj.id}" ${on ? 'checked' : ''} style="display:none">
        <span style="width:8px;height:8px;border-radius:50%;background:${proj.color};display:inline-block;margin-right:4px"></span>
        ${escHtml(proj.name)}
      </label>`;
    }).join('');

    container.querySelectorAll('.project-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('on');
        const cb = chip.querySelector('input');
        cb.checked = !cb.checked;
        const projColor = this.projects.find(p => p.id === chip.dataset.id)?.color ?? '#888';
        chip.style.background = cb.checked ? projColor + '20' : '';
      });
    });
  }

  _renderPhotoPreview() {
    const grid = document.getElementById('photo-preview-grid');
    if (!grid) return;
    grid.innerHTML = '';
    this.formPhotos.forEach((b64, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'preview-img-wrap';
      wrap.innerHTML = `<img src="${b64}" alt="photo"><button class="preview-remove" data-i="${i}">✕</button>`;
      grid.appendChild(wrap);
    });
    grid.querySelectorAll('.preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.formPhotos.splice(parseInt(btn.dataset.i), 1);
        this._renderPhotoPreview();
      });
    });
  }

  _addCustomFieldRow(key = '', val = '') {
    const list = document.getElementById('custom-fields-list');
    const row  = document.createElement('div');
    row.className = 'custom-field-row';
    row.innerHTML = `
      <input type="text" class="custom-key" placeholder="Field name" value="${escHtml(key)}">
      <input type="text" class="custom-val" placeholder="Value"      value="${escHtml(val)}">
      <button class="btn btn-ghost remove-custom-field">✕</button>`;
    row.querySelector('.remove-custom-field').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  collectFormData() {
    const gV  = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const gC  = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    const gN  = id => { const el = document.getElementById(id); return el ? parseInt(el.value) : 0; };

    const swatch = document.querySelector('.color-swatch.selected');
    const color  = swatch ? swatch.dataset.color : LAYER_COLORS[0];

    // Parse species — split by comma, trim, dedupe empties
    const speciesRaw = gV('field-species');
    const species = speciesRaw
      ? [...new Set(speciesRaw.split(',').map(s => s.trim()).filter(Boolean))]
      : [];

    // Project ids from checked chips
    const projectIds = [...document.querySelectorAll('#form-project-list input:checked')]
      .map(cb => cb.value);

    const customFields = {};
    document.querySelectorAll('.custom-field-row').forEach(row => {
      const k = row.querySelector('.custom-key').value.trim();
      const v = row.querySelector('.custom-val').value.trim();
      if (k) customFields[k] = v;
    });

    return {
      name:       gV('field-name') || 'Unnamed Area',
      plantLayer: gV('field-layer') || '',
      color,
      projectIds,
      attributes: {
        species,
        dateVisited:            gV('field-date-visited'),
        seedYield:              gN('field-seed-yield'),
        relativeAbundance:      gN('field-abundance'),
        toolsUsed:              gV('field-tools'),
        suggestedVisitStart:    gV('field-visit-start'),
        suggestedVisitEnd:      gV('field-visit-end'),
        blooming:               gC('field-blooming'),
        recentFire:             gC('field-fire'),
        unusualCharacteristics: gV('field-unusual'),
        iNaturalistLink:        gV('field-inat'),
        other:                  gV('field-other'),
        pictures:               [...this.formPhotos],
        visitHistory:           [],
        skipUntilYear:          null,
        customFields
      }
    };
  }

  async saveFromForm(leafletLayer) {
    const formData = this.collectFormData();
    const existing = this.editingId ? this.polygons.find(p => p.id === this.editingId) : null;
    const geojson  = leafletLayer ? leafletLayer.toGeoJSON() : existing?.geojson;
    if (!geojson) return null;

    if (existing) {
      formData.attributes.visitHistory  = existing.attributes.visitHistory  || [];
      formData.attributes.skipUntilYear = existing.attributes.skipUntilYear ?? null;
    }

    const polygon = { id: this.editingId || undefined, ...formData, geojson };
    const saved   = await seedDB.savePolygon(polygon);

    const idx = this.polygons.findIndex(p => p.id === saved.id);
    if (idx >= 0) {
      this.polygons[idx] = saved;
      seedMap.updatePolygon(saved);
    } else {
      this.polygons.push(saved);
      if (leafletLayer) seedMap.drawnItems.removeLayer(leafletLayer);
      seedMap.addPolygon(saved);
    }

    if (saved.plantLayer) this._assignLayerColor(saved.plantLayer, saved.color);
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

  // ── Detail panel ──────────────────────────────────────────
  showDetailPanel(polygonsAtPoint) {
    if (!polygonsAtPoint.length) return;
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');
    if (polygonsAtPoint.length === 1) this._renderSingleDetail(polygonsAtPoint[0]);
    else this._renderMultiDetail(polygonsAtPoint);
  }

  hideDetailPanel() {
    document.getElementById('detail-panel').classList.add('hidden');
  }

  _renderSingleDetail(p) {
    const panel   = document.getElementById('detail-panel');
    const a       = p.attributes;
    const species = this.getSpecies(p);
    const inSzn   = this._isInSeason(a.suggestedVisitStart, a.suggestedVisitEnd);
    const projNames = (p.projectIds || [])
      .map(id => this.projects.find(pr => pr.id === id))
      .filter(Boolean)
      .map(pr => `<span class="badge badge-season" style="border-color:${pr.color}">${escHtml(pr.name)}</span>`)
      .join(' ');

    panel.innerHTML = `
      <div class="detail-header">
        <div>
          <div style="font-size:15px;font-weight:bold">${escHtml(p.name)}</div>
          ${p.plantLayer ? `<div style="font-size:11px;color:var(--text-muted)">Layer: ${escHtml(p.plantLayer)}</div>` : ''}
        </div>
        <button class="close-btn" onclick="polygonMgr.hideDetailPanel()">✕</button>
      </div>

      ${species.length ? `
        <div style="padding:6px 16px 2px;display:flex;flex-wrap:wrap;gap:4px">
          ${species.map(s => `<span class="species-tag">${escHtml(s)}</span>`).join('')}
        </div>` : ''}

      ${projNames ? `<div style="padding:4px 16px 6px;display:flex;flex-wrap:wrap;gap:4px">${projNames}</div>` : ''}

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
            <div class="attr-value">${this._seasonBadge(a.suggestedVisitStart, a.suggestedVisitEnd, inSzn)}</div>
          </div>
        </div>
        ${a.toolsUsed ? `<div class="attr-item mb-8"><div class="attr-label">Tools</div><div class="attr-value">${escHtml(a.toolsUsed)}</div></div>` : ''}
        <div class="attr-row">
          <div class="attr-item"><div class="attr-label">Blooming</div>
            <div class="attr-value"><span class="badge ${a.blooming ? 'badge-yes' : 'badge-no'}">${a.blooming ? 'Yes' : 'No'}</span></div>
          </div>
          <div class="attr-item"><div class="attr-label">Recent Fire</div>
            <div class="attr-value"><span class="badge ${a.recentFire ? 'badge-yes' : 'badge-no'}">${a.recentFire ? 'Yes' : 'No'}</span></div>
          </div>
        </div>
        ${a.unusualCharacteristics ? `<div class="attr-item mb-8"><div class="attr-label">Unusual</div><div class="attr-value">${escHtml(a.unusualCharacteristics)}</div></div>` : ''}
        ${a.other ? `<div class="attr-item mb-8"><div class="attr-label">Other</div><div class="attr-value">${escHtml(a.other)}</div></div>` : ''}
        ${a.iNaturalistLink ? `<div class="attr-item mb-8"><div class="attr-label">iNaturalist</div><div class="attr-value" style="font-size:11px;color:var(--accent-green-light);word-break:break-all">${escHtml(a.iNaturalistLink)}</div></div>` : ''}
        ${this._renderCustomFields(a.customFields)}
        ${a.pictures?.length ? `
          <div class="attr-label mb-8">Photos</div>
          <div class="photo-grid">
            ${a.pictures.map((b64, i) => `<img class="photo-thumb" src="${b64}" onclick="polygonMgr._viewPhoto('${p.id}',${i})">`).join('')}
          </div>` : ''}
        ${a.skipUntilYear ? `<div style="margin-top:10px;padding:8px;background:#3a2010;border-radius:4px;font-size:11px;color:var(--accent-amber)">⚠ Skipped until ${a.skipUntilYear}</div>` : ''}
      </div>

      <div class="detail-actions">
        <button class="btn btn-amber"     onclick="polygonMgr._markVisited('${p.id}')">✓ Mark Visited</button>
        <button class="btn btn-secondary" onclick="polygonMgr._editPolygon('${p.id}')">✏ Edit</button>
        <button class="btn btn-secondary" onclick="seedMap.panToPolygon('${p.id}')">⊕ Focus</button>
        <button class="btn btn-danger"    onclick="polygonMgr._confirmDelete('${p.id}')">🗑 Delete</button>
      </div>`;
  }

  _renderMultiDetail(polygons) {
    document.getElementById('detail-panel').innerHTML = `
      <div class="detail-header">
        <div style="font-weight:bold">${polygons.length} Overlapping Areas</div>
        <button class="close-btn" onclick="polygonMgr.hideDetailPanel()">✕</button>
      </div>
      <div style="padding:8px 12px">
        ${polygons.map(p => {
          const species = this.getSpecies(p);
          return `<div class="result-card" onclick="polygonMgr._renderSingleDetail(polygonMgr.polygons.find(x=>x.id==='${p.id}'))">
            <div class="result-card-name">${escHtml(p.name)}</div>
            ${species.length ? `<div class="result-card-botanical">${species.map(s => escHtml(s)).join(', ')}</div>` : ''}
            <div class="result-card-meta">
              <span class="result-meta-item">Yield: ${p.attributes.seedYield ?? '—'}/10</span>
              <span class="result-meta-item">Abundance: ${p.attributes.relativeAbundance ?? '—'}/10</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  _ratingPips(val, style = '') {
    if (val == null || val === '') return '<span class="text-muted">—</span>';
    const n    = parseInt(val);
    const pips = Array.from({length:10}, (_,i) =>
      `<div class="rating-pip ${i < n ? 'filled' + (style ? ' '+style : '') : ''}"></div>`).join('');
    return `<div class="rating-bar">${pips}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${n}/10</div>`;
  }

  _seasonBadge(start, end, inSzn) {
    if (!start && !end) return '<span class="text-muted">—</span>';
    const label = `${start||'?'} – ${end||'?'}`;
    const cls   = inSzn === true ? 'season-in' : inSzn === false ? 'season-out' : 'season-unknown';
    const icon  = inSzn === true ? '✓' : inSzn === false ? '✕' : '?';
    return `<span class="season-indicator ${cls}">${icon} ${label}</span>`;
  }

  _renderCustomFields(customFields) {
    if (!customFields || !Object.keys(customFields).length) return '';
    return Object.entries(customFields).map(([k, v]) =>
      `<div class="attr-item mb-8"><div class="attr-label">${escHtml(k)}</div><div class="attr-value">${escHtml(v)}</div></div>`
    ).join('');
  }

  _isInSeason(startStr, endStr) {
    if (!startStr && !endStr) return null;
    const now  = new Date();
    const yr   = now.getFullYear();
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
    if (s && e) return now >= s && now <= e;
    if (s) return now >= s;
    if (e) return now <= e;
    return null;
  }

  _viewPhoto(polygonId, index) {
    const p = this.polygons.find(x => x.id === polygonId);
    if (!p?.attributes?.pictures?.[index]) return;
    const win = window.open();
    win.document.write(`<img src="${p.attributes.pictures[index]}" style="max-width:100%;max-height:100vh">`);
  }

  async _editPolygon(id) {
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;
    this.hideDetailPanel();
    this.openForm({ toGeoJSON: () => p.geojson }, id);
  }

  async _confirmDelete(id) {
    const p = this.polygons.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await this.deletePolygon(id);
    this.hideDetailPanel();
    seedRecords.render();
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
    const p  = this.polygons.find(x => x.id === id);
    if (!p) return;
    const today = new Date().toISOString().slice(0,10);
    p.attributes.visitHistory = p.attributes.visitHistory || [];
    p.attributes.visitHistory.push({ date: today, wouldReturn });
    if (!wouldReturn) p.attributes.skipUntilYear = new Date().getFullYear() + 1;
    p.attributes.dateVisited = today;
    await seedDB.savePolygon(p);
    document.getElementById('modal-visit').classList.add('hidden');
    this.hideDetailPanel();
  }

  // ── Layers panel ──────────────────────────────────────────
  _refreshLayersPanel() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';
    const names = new Set(this.polygons.map(p => p.plantLayer).filter(Boolean));
    if (!names.size) {
      list.innerHTML = '<div class="text-muted" style="padding:12px;font-size:12px">No layers yet.</div>';
      return;
    }
    names.forEach(name => {
      const color = this.getColorForLayer(name);
      const count = this.polygons.filter(p => p.plantLayer === name).length;
      const div   = document.createElement('div');
      div.className = 'layer-item';
      div.innerHTML = `
        <div class="layer-color-dot" style="background:${color}"></div>
        <div class="layer-name">${escHtml(name)} <span class="text-muted">(${count})</span></div>
        <div class="layer-toggle on" data-layer="${escHtml(name)}"></div>`;
      div.querySelector('.layer-toggle').addEventListener('click', e => {
        const btn = e.currentTarget;
        seedMap.setLayerVisible(name, btn.classList.toggle('on'));
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
window.escHtml    = escHtml;
