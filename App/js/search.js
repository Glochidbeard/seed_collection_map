// Search and Records tab logic

class SeedSearch {
  runSearch() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    const filterSeason = document.getElementById('filter-in-season').checked;
    const filterSkip = document.getElementById('filter-skip-visited').checked;

    let results = polygonMgr.polygons;

    if (query) {
      results = results.filter(p => {
        const botanical = (p.attributes.botanicalName || '').toLowerCase();
        const name = (p.name || '').toLowerCase();
        const layer = (p.plantLayer || '').toLowerCase();
        return botanical.includes(query) || name.includes(query) || layer.includes(query);
      });
    }

    if (filterSkip) {
      const thisYear = new Date().getFullYear();
      results = results.filter(p => !p.attributes.skipUntilYear || p.attributes.skipUntilYear <= thisYear);
    }

    if (filterSeason) {
      results = results.filter(p => {
        const inSeason = polygonMgr._isInSeason(p.attributes.suggestedVisitStart, p.attributes.suggestedVisitEnd);
        return inSeason === true || inSeason === null;
      });
    }

    this._renderResults(results, query);
    this._highlightOnMap(results);
  }

  _renderResults(results, query) {
    const container = document.getElementById('search-results');
    if (!results.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-text">No areas found${query ? ` for "${query}"` : ''}.</div>
        </div>`;
      return;
    }

    container.innerHTML = results.map(p => {
      const a = p.attributes;
      const inSeason = polygonMgr._isInSeason(a.suggestedVisitStart, a.suggestedVisitEnd);
      const seasonBadge = inSeason === true
        ? '<span class="season-indicator season-in">✓ In Season</span>'
        : inSeason === false
          ? '<span class="season-indicator season-out">✕ Out of Season</span>'
          : '';
      const color = polygonMgr.getColorForLayer(p.plantLayer);
      const skipBadge = a.skipUntilYear ? `<span class="badge badge-no">Skip '${a.skipUntilYear}</span>` : '';

      return `<div class="result-card" onclick="seedSearch._goToPolygon('${p.id}')"
            style="border-left-color:${color}">
        <div class="result-card-name">${escHtml(p.name)}</div>
        ${a.botanicalName ? `<div class="result-card-botanical">${escHtml(a.botanicalName)}</div>` : ''}
        <div class="result-card-meta">
          ${a.seedYield != null ? `<span class="result-meta-item">Yield: ${a.seedYield}/10</span>` : ''}
          ${a.relativeAbundance != null ? `<span class="result-meta-item">Abundance: ${a.relativeAbundance}/10</span>` : ''}
          ${a.dateVisited ? `<span class="result-meta-item">Visited: ${a.dateVisited}</span>` : ''}
        </div>
        <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap">
          ${seasonBadge}${skipBadge}
        </div>
      </div>`;
    }).join('');
  }

  _highlightOnMap(results) {
    const ids = results.map(p => p.id);
    seedMap.highlightPolygons(ids);
  }

  _goToPolygon(id) {
    // Switch to map tab and show detail
    document.querySelector('[data-tab="tab-map"]').click();
    seedMap.panToPolygon(id);
    const p = polygonMgr.polygons.find(x => x.id === id);
    if (p) polygonMgr.showDetailPanel([p]);
  }

  clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
    seedMap.highlightPolygons([]);
  }
}

class SeedRecords {
  render() {
    const filter = document.getElementById('records-filter').value.toLowerCase();
    const sort = document.getElementById('records-sort').value;

    let list = [...polygonMgr.polygons];

    if (filter) {
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(filter) ||
        (p.attributes.botanicalName || '').toLowerCase().includes(filter) ||
        (p.plantLayer || '').toLowerCase().includes(filter)
      );
    }

    list.sort((a, b) => {
      switch (sort) {
        case 'date': return (b.attributes.dateVisited || '').localeCompare(a.attributes.dateVisited || '');
        case 'yield': return (b.attributes.seedYield || 0) - (a.attributes.seedYield || 0);
        case 'abundance': return (b.attributes.relativeAbundance || 0) - (a.attributes.relativeAbundance || 0);
        default: return (a.name || '').localeCompare(b.name || '');
      }
    });

    const container = document.getElementById('records-list');
    if (!list.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No collection areas yet.<br>Go to the Map tab and draw your first area.</div>
        </div>`;
      return;
    }

    container.innerHTML = list.map(p => {
      const a = p.attributes;
      const color = polygonMgr.getColorForLayer(p.plantLayer) || '#5b8c35';
      return `<div class="record-item" onclick="seedRecords._goToRecord('${p.id}')">
        <div class="record-color" style="background:${color}"></div>
        <div class="record-info">
          <div class="record-name">${escHtml(p.name)}</div>
          ${a.botanicalName ? `<div class="record-botanical">${escHtml(a.botanicalName)}</div>` : ''}
          <div class="record-meta">
            ${a.seedYield != null ? `Yield ${a.seedYield}/10 · ` : ''}
            ${a.relativeAbundance != null ? `Abund ${a.relativeAbundance}/10` : ''}
            ${a.dateVisited ? ` · ${a.dateVisited}` : ''}
          </div>
        </div>
        <div style="font-size:18px;color:var(--text-muted)">›</div>
      </div>`;
    }).join('');
  }

  _goToRecord(id) {
    document.querySelector('[data-tab="tab-map"]').click();
    seedMap.panToPolygon(id);
    const p = polygonMgr.polygons.find(x => x.id === id);
    if (p) polygonMgr.showDetailPanel([p]);
  }
}

window.seedSearch = new SeedSearch();
window.seedRecords = new SeedRecords();
