// IndexedDB — local-first data store

const DB_NAME = 'SeedCache';
const DB_VERSION = 2;

class SeedDB {
  constructor() { this.db = null; }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('polygons')) {
          const s = db.createObjectStore('polygons', { keyPath: 'id' });
          s.createIndex('plantLayer', 'plantLayer', { unique: false });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this); };
      req.onerror  = (e) => reject(e.target.error);
    });
  }

  // ── Polygons ──────────────────────────────────────────────
  async getAllPolygons() { return this._getAll('polygons'); }
  async getPolygon(id)  { return this._get('polygons', id); }

  async savePolygon(polygon) {
    if (!polygon.id) polygon.id = this._uuid();
    polygon.updatedAt = new Date().toISOString();
    if (!polygon.createdAt) polygon.createdAt = polygon.updatedAt;
    // Migrate legacy botanicalName → species array
    if (!polygon.attributes.species) {
      polygon.attributes.species = polygon.attributes.botanicalName
        ? [polygon.attributes.botanicalName]
        : [];
      delete polygon.attributes.botanicalName;
    }
    return this._put('polygons', polygon);
  }

  async deletePolygon(id) { return this._delete('polygons', id); }

  // ── Projects ──────────────────────────────────────────────
  async getAllProjects() { return this._getAll('projects'); }
  async getProject(id)  { return this._get('projects', id); }

  async saveProject(project) {
    if (!project.id) project.id = this._uuid();
    project.updatedAt = new Date().toISOString();
    if (!project.createdAt) project.createdAt = project.updatedAt;
    return this._put('projects', project);
  }

  async deleteProject(id) { return this._delete('projects', id); }

  // ── Settings ──────────────────────────────────────────────
  async getSetting(key) {
    const r = await this._get('settings', key);
    return r ? r.value : null;
  }
  async setSetting(key, value) { return this._put('settings', { key, value }); }

  // ── Internals ─────────────────────────────────────────────
  _getAll(store) {
    return new Promise((resolve, reject) => {
      const tx  = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }
  _get(store, key) {
    return new Promise((resolve, reject) => {
      const tx  = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }
  _put(store, data) {
    return new Promise((resolve, reject) => {
      const tx  = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(data);
      req.onsuccess = () => resolve(data);
      req.onerror   = () => reject(req.error);
    });
  }
  _delete(store, key) {
    return new Promise((resolve, reject) => {
      const tx  = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }
  _uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }
}

window.seedDB = new SeedDB();
