// IndexedDB wrapper for Speedy Seed Insurance

const DB_NAME = 'SeedInsurance';
const DB_VERSION = 1;

class SeedDB {
  constructor() { this.db = null; }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('polygons')) {
          const s = db.createObjectStore('polygons', { keyPath: 'id' });
          s.createIndex('botanicalName', 'attributes.botanicalName', { unique: false });
          s.createIndex('plantLayer', 'plantLayer', { unique: false });
        }
        if (!db.objectStoreNames.contains('layers')) {
          db.createObjectStore('layers', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllPolygons() { return this._getAll('polygons'); }
  async getPolygon(id) { return this._get('polygons', id); }

  async savePolygon(polygon) {
    if (!polygon.id) polygon.id = this._uuid();
    polygon.updatedAt = new Date().toISOString();
    if (!polygon.createdAt) polygon.createdAt = polygon.updatedAt;
    return this._put('polygons', polygon);
  }

  async deletePolygon(id) { return this._delete('polygons', id); }

  async getAllLayers() { return this._getAll('layers'); }

  async saveLayer(layer) { return this._put('layers', layer); }

  async deleteLayer(name) { return this._delete('layers', name); }

  async getSetting(key) {
    const r = await this._get('settings', key);
    return r ? r.value : null;
  }

  async setSetting(key, value) { return this._put('settings', { key, value }); }

  _getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _get(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _put(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(data);
      req.onsuccess = () => resolve(data);
      req.onerror = () => reject(req.error);
    });
  }

  _delete(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  _uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }
}

window.seedDB = new SeedDB();
