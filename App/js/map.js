// Map initialization and tile management

const BASEMAPS = {
  'usgs-topo': {
    label: 'USGS Topo',
    desc: 'Best detail — parks, trails, elevation',
    icon: '🗺',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    attr: 'USGS National Map',
    maxZoom: 16
  },
  'usgs-imagery': {
    label: 'USGS Imagery + Topo',
    desc: 'Aerial photo with topo overlay',
    icon: '🛰',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    attr: 'USGS National Map',
    maxZoom: 16
  },
  'osm': {
    label: 'OpenStreetMap',
    desc: 'Community-maintained street map',
    icon: '🌍',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  },
  'open-topo': {
    label: 'OpenTopoMap',
    desc: 'Topographic contours and terrain',
    icon: '⛰',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '&copy; OpenTopoMap contributors',
    maxZoom: 17
  },
  'esri-imagery': {
    label: 'Satellite (ESRI)',
    desc: 'High-res aerial imagery',
    icon: '📡',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '&copy; Esri',
    maxZoom: 19
  }
};

class SeedMap {
  constructor() {
    this.map = null;
    this.drawnItems = null;
    this.drawControl = null;
    this.currentBasemap = 'usgs-topo';
    this.basemapLayer = null;
    this.polygonLayers = new Map(); // id -> leaflet layer
    this.layerGroups = new Map();   // plantLayer name -> L.LayerGroup
    this.hiddenLayers = new Set();
    this.drawingCallback = null;
    this.clickCallback = null;
    this.isDrawing = false;
  }

  init(centerLat = 37.5, centerLng = -119.5, zoom = 8) {
    this.map = L.map('map', {
      center: [centerLat, centerLng],
      zoom,
      zoomControl: true
    });

    this._loadBasemap('usgs-topo');

    this.drawnItems = new L.FeatureGroup();
    this.map.addLayer(this.drawnItems);

    this._initDrawControl();
    this._bindDrawEvents();

    return this;
  }

  _loadBasemap(key) {
    const bm = BASEMAPS[key];
    if (!bm) return;
    if (this.basemapLayer) this.map.removeLayer(this.basemapLayer);
    this.basemapLayer = L.tileLayer(bm.url, {
      attribution: bm.attr,
      maxZoom: bm.maxZoom,
      subdomains: key === 'osm' ? 'abc' : (key === 'open-topo' ? 'abc' : 'a')
    }).addTo(this.map);
    this.currentBasemap = key;
  }

  switchBasemap(key) {
    this._loadBasemap(key);
  }

  _initDrawControl() {
    this.drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          allowIntersection: false,
          shapeOptions: { color: '#5b8c35', weight: 2, fillOpacity: 0.2 }
        },
        polyline: false,
        rectangle: {
          shapeOptions: { color: '#5b8c35', weight: 2, fillOpacity: 0.2 }
        },
        circle: false,
        circlemarker: false,
        marker: false
      },
      edit: { featureGroup: this.drawnItems }
    });
  }

  enableDrawMode() {
    this.map.addControl(this.drawControl);
    this.isDrawing = true;
    new L.Draw.Polygon(this.map, this.drawControl.options.draw.polygon).enable();
  }

  disableDrawMode() {
    this.map.removeControl(this.drawControl);
    this.isDrawing = false;
  }

  _bindDrawEvents() {
    this.map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      // Temporarily add so it's visible while form is open
      this.drawnItems.addLayer(layer);
      if (this.drawingCallback) this.drawingCallback(layer);
    });
  }

  onPolygonDrawn(cb) { this.drawingCallback = cb; }
  onPolygonClick(cb) { this.clickCallback = cb; }

  addPolygon(polygonData) {
    const { id, geojson, color, plantLayer } = polygonData;

    const layer = L.geoJSON(geojson, {
      style: {
        color: color || '#5b8c35',
        weight: 2,
        fillOpacity: 0.25,
        fillColor: color || '#5b8c35'
      }
    });

    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (this.clickCallback) this.clickCallback(e.latlng, polygonData);
    });

    // Manage layer groups
    const groupName = plantLayer || '__default__';
    if (!this.layerGroups.has(groupName)) {
      const group = L.layerGroup().addTo(this.map);
      this.layerGroups.set(groupName, group);
    }

    const group = this.layerGroups.get(groupName);
    layer.addTo(group);

    if (this.hiddenLayers.has(groupName)) {
      this.map.removeLayer(group);
    }

    this.polygonLayers.set(id, layer);
    return layer;
  }

  updatePolygon(polygonData) {
    this.removePolygon(polygonData.id);
    this.addPolygon(polygonData);
  }

  removePolygon(id) {
    const layer = this.polygonLayers.get(id);
    if (layer) {
      this.map.eachLayer(l => {
        if (l.hasLayer && l.hasLayer(layer)) l.removeLayer(layer);
      });
      this.layerGroups.forEach(g => {
        if (g.hasLayer && g.hasLayer(layer)) g.removeLayer(layer);
      });
      this.polygonLayers.delete(id);
    }
  }

  highlightPolygons(ids, color = '#c4882a') {
    this.polygonLayers.forEach((layer, id) => {
      if (ids.includes(id)) {
        layer.setStyle({ color, weight: 3, fillOpacity: 0.45, fillColor: color });
        layer.bringToFront();
      } else {
        // Reset to original color from data
        layer.resetStyle && layer.resetStyle();
      }
    });
  }

  resetHighlights() {
    // Reload all polygons resets styles
    this.polygonLayers.forEach((layer) => {
      layer.eachLayer && layer.eachLayer(l => {
        if (l.options && l.options.originalColor) {
          l.setStyle({ color: l.options.originalColor });
        }
      });
    });
  }

  setLayerVisible(groupName, visible) {
    const group = this.layerGroups.get(groupName);
    if (!group) return;
    if (visible) {
      if (!this.map.hasLayer(group)) this.map.addLayer(group);
      this.hiddenLayers.delete(groupName);
    } else {
      this.map.removeLayer(group);
      this.hiddenLayers.add(groupName);
    }
  }

  panToPolygon(id) {
    const layer = this.polygonLayers.get(id);
    if (!layer) return;
    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [40, 40] });
    } catch {}
  }

  findPolygonsAtPoint(latlng, polygonsData) {
    const pt = turf.point([latlng.lng, latlng.lat]);
    return polygonsData.filter(p => {
      try {
        return turf.booleanPointInPolygon(pt, p.geojson);
      } catch { return false; }
    });
  }

  async cacheCurrentArea(onProgress) {
    const bounds = this.map.getBounds();
    const currentZoom = this.map.getZoom();
    const minZ = Math.max(currentZoom - 1, 8);
    const maxZ = Math.min(currentZoom + 3, 16);

    const bm = BASEMAPS[this.currentBasemap];
    const urlTemplate = bm.url;
    const urls = [];

    for (let z = minZ; z <= maxZ; z++) {
      const nw = this._latlngToTile(bounds.getNorth(), bounds.getWest(), z);
      const se = this._latlngToTile(bounds.getSouth(), bounds.getEast(), z);
      for (let x = nw.x; x <= se.x; x++) {
        for (let y = nw.y; y <= se.y; y++) {
          let url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
          // For USGS format: {z}/{y}/{x}
          url = url.replace(/\{s\}/g, 'a');
          urls.push(url);
        }
      }
    }

    const LIMIT = 2000;
    if (urls.length > LIMIT) {
      const keep = urls.filter((_, i) => i < LIMIT);
      if (onProgress) onProgress(`Caching ${keep.length} tiles (zoomed in area)...`);
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CACHE_TILES', urls: keep });
      }
      return keep.length;
    }

    if (onProgress) onProgress(`Caching ${urls.length} tiles...`);
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CACHE_TILES', urls });
    }
    return urls.length;
  }

  _latlngToTile(lat, lng, z) {
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return { x, y };
  }

  getCenter() { return this.map.getCenter(); }
  getZoom() { return this.map.getZoom(); }
}

window.seedMap = new SeedMap();
window.BASEMAPS = BASEMAPS;
