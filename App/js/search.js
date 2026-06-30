// Search — multi-species map highlighting + records tab

const HIGHLIGHT_COLORS = {
  1: { color: '#c4882a', weight: 3, fillOpacity: 0.35 },  // single match — amber
  2: { color: '#e8c030', weight: 4, fillOpacity: 0.45 },  // two matches — gold
  3: { color: '#7aff50', weight: 5, fillOpacity: 0.55 },  // three+ matches — bright
};

class SeedSearch {
  constructor() {
    this._highlighted = new Map(); // id -> original style
  }

  runSearch() {
    const raw        = document.getElementById('search-input').value.trim();
    const filterSzn  = document.getElementById('filter-in-season').checked;
    const filterSkip = document.getElementById('filter-skip-visited').checked;

    // Parse comma-separated species queries
    const queries = raw ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

    this.clearHighlights();

    let pool = polygonMgr.polygons;
    if (filterSkip) {
      const yr = new Date().getFullYear();
      pool = pool.filter(p => !p.attributes.skipUntilYear || p.attributes.skipUntilYear <= yr);
    }
    if (filterSzn) {
      pool = pool.filter(p => {
        const inS = polygonMgr._isInSeason(p.attributes.suggestedVisitStart, p.attributes.suggestedVisitEnd);
        return inS === true || inS === null;
      });
    }

    if (!queries.length) {
      // No species query — show all as a normal list
      this._renderResultList(pool, '');
      return;
    }

    // Score each polygon by how many queried species it contains
    const scored = [];
    pool.forEach(p => {
      const species = polygonMgr.getSpecies(p).map(s => s.toLowerCase());
      const hits    = queries.filter(q => species.some(s => s.includes(q) || q.includes(s)));
      if (hits.length) scored.push({ polygon: p, hits: hits.length });
    });

    // Highlight on map — intensity by match count
    scored.forEach(({ polygon, hits }) => {
      const style = HIGHLIGHT_COLORS[Math.min(hits, 3)];
      const layer = seedMap.polygonLayers.get(polygon.id);
      if (layer) {
        layer.setStyle(style);
        layer.bringToFront();
      }
    });

    this._renderHighlightSummary(scored, queries);
  }

  _renderResultList(polygons, query) {
    const container = document.getElementById('search-results');
    if (!polygons.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">No areas found.</div></div>`;
      return;
    }
    container.innerHTML = polygons.map(p => {
      const species = polygonMgr.getSpecies(p);
      const color   = polygonMgr.getColorForLayer(p.plantLayer);
      return `<div class="result-card" onclick="seedSearch._goToPolygon('${p.id}')" style="border-left-color:${color}">
        <div class="result-card-name">${escHtml(p.name)}</div>
        ${species.length ? `<div class="result-card-botanical">${species.map(escHtml).join(', ')}</div>` : ''}
        <div class="result-card-meta">
          ${p.attributes.seedYield != null ? `<span class="result-meta-item">Yield: ${p.attributes.seedYield}/10</span>` : ''}
          ${p.attributes.relativeAbundance != null ? `<span class="result-meta-item">Abundance: ${p.attributes.relativeAbundance}/10</span>` : ''}
          ${p.attributes.dateVisited ? `<span class="result-meta-item">${p.attributes.dateVisited}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  _renderHighlightSummary(scored, queries) {
    const container = document.getElementById('search-results');
    const multi     = scored.filter(s => s.hits > 1);

    container.innerHTML = `
      <div style="padding:10px 0 6px">
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
          <strong style="color:var(--text-primary)">${scored.length}</strong> area${scored.length !== 1 ? 's' : ''} found for:
          ${queries.map(q => `<span class="species-tag">${escHtml(q)}</span>`).join(' ')}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;margin-bottom:12px">
          <div><span style="display:inline-block;width:12px;height:12px;background:#c4882a;border-radius:2px;margin-right:5px"></span>1 species match</div>
          <div><span style="display:inline-block;width:12px;height:12px;background:#e8c030;border-radius:2px;margin-right:5px"></span>2 species match</div>
          <div><span style="display:inline-block;width:12px;height:12px;background:#7aff50;border-radius:2px;margin-right:5px"></span>3+ species match</div>
        </div>
        ${multi.length ? `<div style="font-size:12px;color:var(--accent-amber-light);margin-bottom:8px">
          ★ ${multi.length} area${multi.length !== 1 ? 's' : ''} contain multiple searched species
        </div>` : ''}
      </div>
      <div>
        ${scored.sort((a,b) => b.hits - a.hits).map(({ polygon: p, hits }) => {
          const species  = polygonMgr.getSpecies(p);
          const style    = HIGHLIGHT_COLORS[Math.min(hits, 3)];
          return `<div class="result-card" onclick="seedSearch._goToPolygon('${p.id}')"
              style="border-left-color:${style.color};border-left-width:${style.weight}px">
            <div class="result-card-name">${escHtml(p.name)}</div>
            ${species.length ? `<div class="result-card-botanical">${species.map(escHtml).join(', ')}</div>` : ''}
            <div class="result-card-meta">
              <span class="result-meta-item" style="color:${style.color}">${hits} of ${queries.length} species</span>
              ${p.attributes.seedYield != null ? `<span class="result-meta-item">Yield: ${p.attributes.seedYield}/10</span>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  clearHighlights() {
    seedMap.polygonLayers.forEach((layer, id) => {
      const p = polygonMgr.polygons.find(x => x.id === id);
      if (p) {
        layer.setStyle({
          color: p.color || '#5b8c35',
          weight: 2,
          fillOpacity: 0.25,
          fillColor: p.color || '#5b8c35'
        });
      }
    });
  }

  _goToPolygon(id) {
    document.querySelector('[data-tab="tab-map"]').click();
    seedMap.panToPolygon(id);
    const p = polygonMgr.polygons.find(x => x.id === id);
    if (p) polygonMgr.showDetailPanel([p]);
  }
}

// ── Records tab ───────────────────────────────────────────────
class SeedRecords {
  render() {
    const filter = document.getElementById('records-filter').value.toLowerCase();
    const sort   = document.getElementById('records-sort').value;

    let list = [...polygonMgr.polygons];

    if (filter) {
      list = list.filter(p => {
        const species = polygonMgr.getSpecies(p).join(' ').toLowerCase();
        return (p.name||'').toLowerCase().includes(filter) ||
               species.includes(filter) ||
               (p.plantLayer||'').toLowerCase().includes(filter);
      });
    }

    list.sort((a,b) => {
      switch (sort) {
        case 'date':      return (b.attributes.dateVisited||'').localeCompare(a.attributes.dateVisited||'');
        case 'yield':     return (b.attributes.seedYield||0) - (a.attributes.seedYield||0);
        case 'abundance': return (b.attributes.relativeAbundance||0) - (a.attributes.relativeAbundance||0);
        default:          return (a.name||'').localeCompare(b.name||'');
      }
    });

    const container = document.getElementById('records-list');

    // Projects section at top
    const projectsHtml = this._renderProjectsSection();

    if (!list.length) {
      container.innerHTML = projectsHtml + `<div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">No areas yet.<br>Go to Map and draw your first area.</div></div>`;
      return;
    }

    container.innerHTML = projectsHtml + list.map(p => {
      const species = polygonMgr.getSpecies(p);
      const color   = polygonMgr.getColorForLayer(p.plantLayer) || '#5b8c35';
      return `<div class="record-item" onclick="seedRecords._goToRecord('${p.id}')">
        <div class="record-color" style="background:${color}"></div>
        <div class="record-info">
          <div class="record-name">${escHtml(p.name)}</div>
          ${species.length ? `<div class="record-botanical">${species.map(escHtml).join(', ')}</div>` : ''}
          <div class="record-meta">
            ${p.attributes.seedYield != null ? `Yield ${p.attributes.seedYield}/10 · ` : ''}
            ${p.attributes.relativeAbundance != null ? `Abund ${p.attributes.relativeAbundance}/10` : ''}
            ${p.attributes.dateVisited ? ` · ${p.attributes.dateVisited}` : ''}
          </div>
        </div>
        <div style="font-size:18px;color:var(--text-muted)">›</div>
      </div>`;
    }).join('');

    // Wire project form
    const createBtn = document.getElementById('btn-create-project');
    if (createBtn) createBtn.addEventListener('click', () => this._createProject());
  }

  _renderProjectsSection() {
    const projects = polygonMgr.projects;
    return `
      <div style="padding:10px 0 6px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent-amber);padding:0 2px 6px;border-bottom:1px solid var(--border)">
          Projects
        </div>
        <div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:6px">
          ${projects.map(pr => `
            <div class="project-badge" style="border-color:${pr.color}" onclick="seedRecords._filterByProject('${pr.id}')">
              <span style="width:8px;height:8px;border-radius:50%;background:${pr.color};display:inline-block"></span>
              ${escHtml(pr.name)}
              <button class="remove-project-btn" onclick="event.stopPropagation();seedRecords._deleteProject('${pr.id}')" title="Delete project">×</button>
            </div>`).join('')}
          <div style="display:flex;gap:4px;align-items:center">
            <input type="text" id="new-project-name" placeholder="New project..." style="font-size:12px;padding:4px 8px;width:130px">
            <button id="btn-create-project" class="btn btn-secondary" style="padding:4px 8px;font-size:11px">+</button>
          </div>
        </div>
      </div>
      <div style="border-top:1px solid var(--border);margin-bottom:6px"></div>`;
  }

  async _createProject() {
    const input = document.getElementById('new-project-name');
    const name  = input?.value.trim();
    if (!name) return;
    const color = LAYER_COLORS[polygonMgr.projects.length % LAYER_COLORS.length];
    const proj  = await seedDB.saveProject({ name, color, description: '' });
    polygonMgr.projects.push(proj);
    input.value = '';
    this.render();
    polygonMgr._renderProjectChips(); // refresh open form if any
  }

  async _deleteProject(id) {
    if (!confirm('Delete this project? Polygons assigned to it will not be deleted.')) return;
    await seedDB.deleteProject(id);
    polygonMgr.projects = polygonMgr.projects.filter(p => p.id !== id);
    // Remove from polygon projectIds
    for (const poly of polygonMgr.polygons) {
      if ((poly.projectIds||[]).includes(id)) {
        poly.projectIds = poly.projectIds.filter(x => x !== id);
        await seedDB.savePolygon(poly);
      }
    }
    this.render();
  }

  _filterByProject(id) {
    document.querySelector('[data-tab="tab-map"]').click();
    const matching = polygonMgr.polygons.filter(p => (p.projectIds||[]).includes(id));
    const ids      = matching.map(p => p.id);
    const proj     = polygonMgr.projects.find(p => p.id === id);
    seedMap.highlightPolygons(ids, proj?.color || '#c4882a');
    if (ids.length) seedMap.panToPolygon(ids[0]);
  }

  _goToRecord(id) {
    document.querySelector('[data-tab="tab-map"]').click();
    seedMap.panToPolygon(id);
    const p = polygonMgr.polygons.find(x => x.id === id);
    if (p) polygonMgr.showDetailPanel([p]);
  }
}

window.seedSearch  = new SeedSearch();
window.seedRecords = new SeedRecords();
