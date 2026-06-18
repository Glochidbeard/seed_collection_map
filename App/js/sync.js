// Offline-first sync with Supabase
// Strategy: IndexedDB is the source of truth. Supabase is the backup + sharing layer.

const DELETED_IDS_KEY = 'ssi_deleted_ids';

class SeedSync {
  constructor() {
    this._syncing = false;
    this._pendingUpserts = new Set(); // ids queued while offline
  }

  get db() { return seedAuth.client?.from('polygons'); }

  // Full bidirectional sync — run on startup when online + authenticated
  async fullSync() {
    if (!this._canSync()) return;
    if (this._syncing) return;
    this._syncing = true;
    this._setStatus('syncing');

    try {
      const [remoteResult, localPolygons] = await Promise.all([
        this.db.select('*').is('deleted_at', null),
        seedDB.getAllPolygons()
      ]);

      if (remoteResult.error) throw remoteResult.error;
      const remote = remoteResult.data;

      const remoteMap = new Map(remote.map(p => [p.id, p]));
      const localMap = new Map(localPolygons.map(p => [p.id, p]));

      // Pull: remote → local (if remote is newer or local is missing)
      for (const r of remote) {
        const local = localMap.get(r.id);
        if (!local || new Date(r.updated_at) > new Date(local.updatedAt)) {
          const converted = this._remoteToLocal(r);
          await seedDB.savePolygon(converted);
          // Update or add on map
          if (local) {
            seedMap.updatePolygon(converted);
          } else {
            seedMap.addPolygon(converted);
            polygonMgr.polygons.push(converted);
          }
          // Update local cache in polygonMgr
          const idx = polygonMgr.polygons.findIndex(p => p.id === converted.id);
          if (idx >= 0) polygonMgr.polygons[idx] = converted;
        }
      }

      // Push: local → remote (if local is newer or remote is missing)
      const toUpsert = [];
      for (const local of localPolygons) {
        const r = remoteMap.get(local.id);
        if (!r || new Date(local.updatedAt) > new Date(r.updated_at)) {
          toUpsert.push(this._localToRemote(local));
        }
      }
      if (toUpsert.length) {
        const { error } = await this.db.upsert(toUpsert);
        if (error) console.warn('Upsert error:', error);
      }

      // Push pending soft-deletes
      await this._flushDeletedIds();

      this._setStatus('synced');
      polygonMgr._refreshLayersPanel();
      if (document.getElementById('tab-records').classList.contains('active')) {
        seedRecords.render();
      }
    } catch (e) {
      console.warn('Sync error:', e);
      this._setStatus('error');
    } finally {
      this._syncing = false;
    }
  }

  // Called every time a polygon is saved locally
  async upsertPolygon(polygon) {
    if (!this._canSync()) {
      this._pendingUpserts.add(polygon.id);
      return;
    }
    try {
      const { error } = await this.db.upsert([this._localToRemote(polygon)]);
      if (error) {
        console.warn('Upsert error:', error);
        this._pendingUpserts.add(polygon.id);
      }
    } catch {
      this._pendingUpserts.add(polygon.id);
    }
  }

  // Called when a polygon is deleted locally
  async deletePolygon(id) {
    // Track deleted ids for when we're online
    const deleted = this._getDeletedIds();
    if (!deleted.includes(id)) {
      deleted.push(id);
      localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(deleted));
    }
    if (this._canSync()) {
      await this._flushDeletedIds();
    }
  }

  // Process anything queued while offline
  async flushPending() {
    if (!this._canSync()) return;

    // Pending upserts
    if (this._pendingUpserts.size) {
      const ids = [...this._pendingUpserts];
      const polygons = await Promise.all(ids.map(id => seedDB.getPolygon(id)));
      const valid = polygons.filter(Boolean).map(p => this._localToRemote(p));
      if (valid.length) {
        const { error } = await this.db.upsert(valid);
        if (!error) this._pendingUpserts.clear();
      }
    }

    await this._flushDeletedIds();
  }

  async _flushDeletedIds() {
    const ids = this._getDeletedIds();
    if (!ids.length || !this._canSync()) return;
    const { error } = await this.db
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids);
    if (!error) {
      localStorage.setItem(DELETED_IDS_KEY, '[]');
    }
  }

  _getDeletedIds() {
    try { return JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]'); }
    catch { return []; }
  }

  _canSync() {
    return navigator.onLine && seedAuth.isAuthenticated() && !!this.db;
  }

  _setStatus(state) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const labels = { syncing: '⟳ Syncing...', synced: '✓ Synced', error: '⚠ Sync error', offline: '⊘ Offline' };
    const colors = { syncing: 'var(--accent-amber)', synced: 'var(--accent-green-light)', error: 'var(--danger)', offline: 'var(--text-muted)' };
    el.textContent = labels[state] || '';
    el.style.color = colors[state] || 'inherit';
  }

  _localToRemote(p) {
    return {
      id: p.id,
      name: p.name,
      plant_layer: p.plantLayer || null,
      color: p.color || null,
      geojson: p.geojson,
      attributes: p.attributes || {},
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString(),
      deleted_at: null,
      created_by: seedAuth.user?.id || null
    };
  }

  _remoteToLocal(r) {
    return {
      id: r.id,
      name: r.name,
      plantLayer: r.plant_layer || '',
      color: r.color || '#5b8c35',
      geojson: r.geojson,
      attributes: r.attributes || {},
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
}

window.seedSync = new SeedSync();
