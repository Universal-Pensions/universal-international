import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAllEntities } from '../../hooks/useEntity';
import { IS_DEV, MAP_TILE_URL } from '../../config/env';
import styles from './UgandaMap.module.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const UGANDA_CENTER = [1.37, 32.3];
const UGANDA_BOUNDS = [[-1.5, 29.55], [4.25, 35.0]];

// Brand palette
const REGION_COLORS = {
  Central: { fill: '#5E63A8', glow: 'rgba(94, 99, 168, 0.35)' },
  Eastern: { fill: '#2F8F9D', glow: 'rgba(47, 143, 157, 0.35)' },
  Northern: { fill: '#3D3C80', glow: 'rgba(61, 60, 128, 0.35)' },
  Western: { fill: '#7B7FC4', glow: 'rgba(123, 127, 196, 0.35)' },
};

// ─── GeoJSON loaders ─────────────────────────────────────────────────────────
// Module-level cache so subsequent UgandaMap mounts re-use the parsed payload.
// The districts file is ~hundreds of KB; keeping it out of the initial bundle
// (and out of the initial fetch when the user lands at country level) shaves
// LCP on the dashboard. F10 in the audit.
let cachedRegions = null;
let regionsPromise = null;
let cachedDistricts = null;
let districtsPromise = null;

function loadRegions() {
  if (cachedRegions) return Promise.resolve(cachedRegions);
  if (regionsPromise) return regionsPromise;
  regionsPromise = fetch('/uganda-regions.geojson')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => { cachedRegions = data; return data; })
    .catch((err) => { regionsPromise = null; throw err; });
  return regionsPromise;
}

function loadDistricts() {
  if (cachedDistricts) return Promise.resolve(cachedDistricts);
  if (districtsPromise) return districtsPromise;
  districtsPromise = fetch('/uganda-districts.geojson')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => { cachedDistricts = data; return data; })
    .catch((err) => { districtsPromise = null; throw err; });
  return districtsPromise;
}

// Per-feature style cache. Keyed by feature object identity so repeated
// re-renders of the same parsed GeoJSON skip the property lookups. F11.
const regionOverlayStyleCache = new WeakMap();
const districtStyleCache = new WeakMap();

function getCachedRegionStyle(feature, level, selectedRegionName) {
  // Cache key composite: level + selected region. We bucket the cache per
  // (level, selectedRegionName) using nested WeakMaps via the feature.
  let bucket = regionOverlayStyleCache.get(feature);
  const bucketKey = `${level}::${selectedRegionName || ''}`;
  if (bucket && bucket.key === bucketKey) return bucket.style;
  const name = feature.properties.name;
  const colors = REGION_COLORS[name] || { fill: '#5E63A8', glow: 'rgba(94,99,168,0.35)' };
  let style;
  if (level === 'country') {
    style = {
      fillColor: colors.fill,
      fillOpacity: 0.08,
      color: '#c8cad6',
      weight: 0.6,
      opacity: 0.4,
    };
  } else {
    const isSelected = selectedRegionName === name;
    style = {
      fillColor: colors.fill,
      fillOpacity: isSelected ? 0.1 : 0.03,
      color: '#c8cad6',
      weight: isSelected ? 0.6 : 0.3,
      opacity: isSelected ? 0.4 : 0.15,
    };
  }
  regionOverlayStyleCache.set(feature, { key: bucketKey, style });
  return style;
}

function getCachedDistrictStyle(feature, selectedDistrictName) {
  let bucket = districtStyleCache.get(feature);
  const bucketKey = `${selectedDistrictName || ''}`;
  if (bucket && bucket.key === bucketKey) return bucket.style;
  const name = feature.properties.name;
  const region = feature.properties.region;
  const colors = REGION_COLORS[region] || { fill: '#5E63A8', glow: 'rgba(94,99,168,0.35)' };
  const isSelected = selectedDistrictName === name;
  const style = {
    fillColor: 'transparent',
    fillOpacity: 0,
    color: isSelected ? colors.fill : '#a0a5bc',
    weight: isSelected ? 1.5 : 0.5,
    opacity: isSelected ? 0.5 : 0.3,
  };
  districtStyleCache.set(feature, { key: bucketKey, style });
  return style;
}

// ─── Soft bokeh glow icon — radial gradient halo at region centroids ─────────
function createGlowIcon(color, id, size = 180) {
  const gradId = `rg-${id}`;
  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="30%" stop-color="${color}" stop-opacity="0.15"/>
        <stop offset="70%" stop-color="${color}" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#${gradId})" />
  </svg>`;
  return L.divIcon({
    html: svgStr,
    className: styles.glowIcon,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ─── Tile opacity controller ─────────────────────────────────────────────────
function TileOpacityController({ level }) {
  const map = useMap();
  useEffect(() => {
    const opacity = level === 'country' ? 0.2 : 0.08;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        layer.setOpacity(opacity);
      }
    });
  }, [map, level]);
  return null;
}

// ─── Map controller ──────────────────────────────────────────────────────────
function MapController({ bounds, center, zoom, fitOptions, visible = true }) {
  const map = useMap();
  useEffect(() => {
    // Don't fit while hidden (dash mode → display:none → 0×0 container): a fit
    // computed against a zero-size map lands wrong. When `visible` flips back to
    // true this effect re-runs and fits against the real size. The synchronous
    // invalidateSize guarantees the projection is current before we fit.
    if (!visible) return;
    map.invalidateSize({ animate: false });
    if (bounds) {
      const opts = { padding: [50, 50], maxZoom: 10, duration: 0.8, ...fitOptions };
      map.fitBounds(bounds, opts);
    } else if (center && zoom) {
      map.flyTo(center, zoom, { duration: 0.8 });
    }
  }, [map, bounds, center, zoom, fitOptions, visible]);

  // Keep Leaflet's pixel projection in sync with the real container size. If the
  // map mounts (or the layout shifts) while the container is mis-sized, Leaflet's
  // cached origin goes stale and click hit-testing (mouseEventToLayerPoint +
  // _containsPoint) lands OFF the region/district polygons — so hover still works
  // (DOM-based) but a click "does nothing". invalidateSize() recomputes it.
  // Also re-runs whenever the map returns from hidden → visible (the dash⇄map
  // toggle): a container measured under display:none is 0×0, so invalidateSize()
  // must recompute the origin or click hit-testing lands off the polygons.
  useEffect(() => {
    if (!visible) return undefined;
    const fix = () => map.invalidateSize({ animate: false });
    const raf = requestAnimationFrame(fix);
    // Deferred second pass — closes the initial-mount window (lazy + Suspense +
    // animating sibling) where the container width finalises a frame or two late.
    const t = setTimeout(fix, 250);
    // Belt-and-suspenders — re-sync once Leaflet itself reports ready.
    map.whenReady(fix);
    let ro;
    try {
      ro = new ResizeObserver(fix);
      ro.observe(map.getContainer());
    } catch { /* ResizeObserver unsupported — the rAF + timeout passes still correct mount-time sizing */ }
    return () => { cancelAnimationFrame(raf); clearTimeout(t); ro?.disconnect(); };
  }, [map, visible]);

  return null;
}

// ─── Main component ──────────────────────────────────────────────────────────
function UgandaMap({ visible = true }) {
  const { level, selectedIds, drillDown } = useDashboard();
  const [regionsGeo, setRegionsGeo] = useState(null);
  const [districtsGeo, setDistrictsGeo] = useState(null);
  const [geoError, setGeoError] = useState(null);
  // Entity data via hooks
  const { data: regionsArr = [] } = useAllEntities('region');
  const { data: districtsArr = [] } = useAllEntities('district');
  const { data: branchesArr = [] } = useAllEntities('branch');

  const REGIONS_MAP = useMemo(() => Object.fromEntries(regionsArr.map((r) => [r.id, r])), [regionsArr]);
  const DISTRICTS_MAP = useMemo(() => Object.fromEntries(districtsArr.map((d) => [d.id, d])), [districtsArr]);
  const BRANCHES_MAP = useMemo(() => Object.fromEntries(branchesArr.map((b) => [b.id, b])), [branchesArr]);
  const REGION_NAME_TO_ID = useMemo(() => Object.fromEntries(regionsArr.map((r) => [r.name, r.id])), [regionsArr]);
  const DISTRICT_NAME_TO_ID = useMemo(() => Object.fromEntries(districtsArr.map((d) => [d.name, d.id])), [districtsArr]);

  // react-leaflet binds each <GeoJSON> onEachFeature click handler ONCE per layer, so a
  // handler can capture an EMPTY name→id map when the geojson paints before the entity
  // hooks (useAllEntities) resolve — the geojson fetch and the data queries race. That is
  // the real §7f drill-down regression (NOT the pixel-projection/invalidateSize theory):
  // hover still works because it never reads the map, but the click resolves an undefined
  // id → drillDown never fires. Reading the map through an always-current ref resolves the
  // id at CLICK time, so mount/load order no longer matters at any drill level.
  const regionNameToIdRef = useRef(REGION_NAME_TO_ID);
  const districtNameToIdRef = useRef(DISTRICT_NAME_TO_ID);
  useEffect(() => {
    regionNameToIdRef.current = REGION_NAME_TO_ID;
    districtNameToIdRef.current = DISTRICT_NAME_TO_ID;
  }, [REGION_NAME_TO_ID, DISTRICT_NAME_TO_ID]);

  // Regions GeoJSON is small + always required at every drill level — fetch
  // immediately on mount so the base country fill paints right away.
  useEffect(() => {
    let cancelled = false;
    loadRegions()
      .then((data) => { if (!cancelled) setRegionsGeo(data); })
      .catch((err) => { if (cancelled) return; if (IS_DEV) console.error('Failed to load regions GeoJSON:', err); setGeoError(err); });
    return () => { cancelled = true; };
  }, []);

  // Districts GeoJSON is larger (and only strictly needed once the user
  // drills past country level). Defer the fetch:
  //   • Fire immediately when level !== 'country' (needed for layer rendering)
  //   • At country level, schedule a prefetch via requestIdleCallback so the
  //     faint background outlines appear after the critical paint.
  // Fallback: in environments without `requestIdleCallback` we fall back to
  // a short setTimeout so the prefetch still runs. The eager fetch path is
  // kept available for environments without IntersectionObserver (rare
  // ancient browsers, SSR snapshots) by triggering the load synchronously
  // when level !== 'country'.
  useEffect(() => {
    let cancelled = false;
    const needNow = level !== 'country';
    const noIdleSupport = typeof IntersectionObserver === 'undefined';

    const run = () => {
      loadDistricts()
        .then((data) => { if (!cancelled) setDistrictsGeo(data); })
        .catch((err) => { if (cancelled) return; if (IS_DEV) console.error('Failed to load districts GeoJSON:', err); setGeoError(err); });
    };

    if (needNow || noIdleSupport) {
      // Eager fetch — needed for current render OR running in a stripped-down
      // environment where deferring is unsafe (no IntersectionObserver ⇒ very
      // likely no requestIdleCallback either; just load now).
      run();
      return () => { cancelled = true; };
    }

    // Idle prefetch at country level
    const ric = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 200);
    const cic = typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback
      : clearTimeout;
    const handle = ric(() => { if (!cancelled) run(); });
    return () => { cancelled = true; cic(handle); };
  }, [level]);

  const selectedRegionId = selectedIds.region;
  const selectedDistrictId = selectedIds.district;
  const selectedRegion = selectedRegionId ? REGIONS_MAP[selectedRegionId] : null;
  const selectedDistrict = selectedDistrictId ? DISTRICTS_MAP[selectedDistrictId] : null;

  const regionDistricts = useMemo(() => {
    if (!districtsGeo || !selectedRegion) return null;
    return {
      ...districtsGeo,
      features: districtsGeo.features.filter(
        (f) => f.properties.region === selectedRegion.name
      ),
    };
  }, [districtsGeo, selectedRegion]);

  const selectedDistrictGeo = useMemo(() => {
    if (!districtsGeo || !selectedDistrict) return null;
    const feat = districtsGeo.features.find(
      (f) => f.properties.name === selectedDistrict.name
    );
    if (!feat) return null;
    return { type: 'FeatureCollection', features: [feat] };
  }, [districtsGeo, selectedDistrict]);


  const mapView = useMemo(() => {
    // At branch/agent level, stay at district zoom — slide-in panel shows the data
    if ((level === 'branch' || level === 'agent') && selectedDistrict) {
      return { center: [selectedDistrict.center[1], selectedDistrict.center[0]], zoom: 10 };
    }
    if (level === 'district' && selectedDistrict) {
      return { center: [selectedDistrict.center[1], selectedDistrict.center[0]], zoom: 10 };
    }
    if (level === 'region' && selectedRegion) {
      if (regionDistricts && regionDistricts.features.length > 0) {
        const layer = L.geoJSON(regionDistricts);
        return { bounds: layer.getBounds() };
      }
      return { center: [selectedRegion.center[1], selectedRegion.center[0]], zoom: 8 };
    }
    return { bounds: UGANDA_BOUNDS, fitOptions: { paddingTopLeft: [340, 30], paddingBottomRight: [30, 60] } };
  }, [level, selectedRegion, selectedDistrict, regionDistricts]);

  // ─── Style functions ─────────────────────────────────────────────────────────

  // Base country fill — bright white land mass, strong contrast vs gray background
  const baseCountryStyle = useMemo(() => ({
    fillColor: '#f2f3f7',
    fillOpacity: 1,
    color: '#d0d3de',
    weight: 0.6,
    opacity: 0.5,
  }), []);

  // Stable name refs so the style callbacks below have minimal dep churn —
  // the cache key inside the WeakMap helpers handles invalidation.
  const selectedRegionName = selectedRegion ? selectedRegion.name : null;
  const selectedDistrictName = selectedDistrict ? selectedDistrict.name : null;

  // Region overlays — very subtle tints, glow dots provide the color.
  // Style objects are memoized per-feature via WeakMap (see top of file).
  const regionOverlayStyle = useCallback(
    (feature) => getCachedRegionStyle(feature, level, selectedRegionName),
    [level, selectedRegionName]
  );

  const districtStyle = useCallback(
    (feature) => getCachedDistrictStyle(feature, selectedDistrictName),
    [selectedDistrictName]
  );

  const selectedDistrictStyle = useCallback(() => ({
    fillColor: '#5E63A8',
    fillOpacity: 0.1,
    color: '#292867',
    weight: 2,
    opacity: 0.6,
  }), []);

  // ─── Hover — glow effect + fill brightening ──────────────────────────────────
  const highlightRegion = useCallback((e) => {
    const layer = e.target;
    const name = layer.feature.properties.name;
    const colors = REGION_COLORS[name] || { fill: '#5E63A8', glow: 'rgba(94,99,168,0.35)' };
    layer.setStyle({
      fillOpacity: 0.25,
      color: colors.fill,
      weight: 1.2,
      opacity: 0.4,
    });
    const el = layer.getElement();
    if (el) {
      el.style.filter = `drop-shadow(0 0 10px ${colors.glow})`;
    }
    layer.bringToFront();
  }, []);

  const highlightDistrict = useCallback((e) => {
    const layer = e.target;
    const region = layer.feature.properties.region;
    const colors = REGION_COLORS[region] || { fill: '#5E63A8', glow: 'rgba(94,99,168,0.35)' };
    layer.setStyle({
      fillColor: colors.fill,
      fillOpacity: 0.12,
      color: colors.fill,
      weight: 1.2,
      opacity: 0.5,
    });
    const el = layer.getElement();
    if (el) {
      el.style.filter = `drop-shadow(0 0 8px ${colors.glow})`;
    }
    layer.bringToFront();
  }, []);

  const resetHighlight = useCallback((e, styleFunc) => {
    const layer = e.target;
    layer.setStyle(styleFunc(layer.feature));
    const el = layer.getElement();
    if (el) {
      el.style.filter = '';
    }
  }, []);

  // ─── Event handlers ──────────────────────────────────────────────────────────
  const onRegionClick = useCallback((e) => {
    const name = e.target.feature.properties.name;
    const regionId = regionNameToIdRef.current[name];
    if (regionId) drillDown('region', regionId);
  }, [drillDown]);

  const onDistrictClick = useCallback((e) => {
    const name = e.target.feature.properties.name;
    const districtId = districtNameToIdRef.current[name];
    if (districtId) drillDown('district', districtId);
  }, [drillDown]);

  const onEachRegion = useCallback((feature, layer) => {
    layer.on({
      click: onRegionClick,
      mouseover: highlightRegion,
      mouseout: (e) => resetHighlight(e, regionOverlayStyle),
    });
    layer.bindTooltip(feature.properties.name, {
      sticky: true,
      className: styles.mapTooltip,
      direction: 'top',
      offset: [0, -10],
    });
  }, [onRegionClick, highlightRegion, resetHighlight, regionOverlayStyle]);

  const onEachDistrict = useCallback((feature, layer) => {
    layer.on({
      click: onDistrictClick,
      mouseover: highlightDistrict,
      mouseout: (e) => resetHighlight(e, districtStyle),
    });
    // Build the tooltip via DOM nodes (textContent) instead of an HTML string
    // so an unsanitised feature property cannot inject script tags.
    const root = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = feature.properties.name;
    root.appendChild(name);
    root.appendChild(document.createElement('br'));
    const region = document.createElement('span');
    region.style.opacity = '0.6';
    region.textContent = feature.properties.region;
    root.appendChild(region);
    layer.bindTooltip(root, {
      sticky: true,
      className: styles.mapTooltip,
      direction: 'top',
      offset: [0, -10],
    });
  }, [onDistrictClick, highlightDistrict, resetHighlight, districtStyle]);

  const regionKey = useMemo(
    () => `regions-${level}-${selectedRegionId || 'none'}`,
    [level, selectedRegionId]
  );
  const districtKey = useMemo(
    () => `districts-${selectedRegionId}-${selectedDistrictId || 'none'}`,
    [selectedRegionId, selectedDistrictId]
  );

  // Regions failing to load is always fatal. Districts failing is fatal once
  // the user drills past country (the layer is required to render). At
  // country level a districts error just means the faint background outlines
  // won't appear — no need to blank the whole map.
  const districtsCritical = level !== 'country';
  if (geoError && (!regionsGeo || (districtsCritical && !districtsGeo))) {
    return (
      <div className={styles.mapContainer} data-level={level}>
        <div className={styles.errorFallback} role="alert">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="32" height="32">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          <p className={styles.errorMessage}>Map data could not be loaded</p>
          <button
            type="button"
            className={styles.errorRetryBtn}
            onClick={() => { setGeoError(null); window.location.reload(); }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.mapContainer}
      data-level={level}
      role="region"
      aria-label="Map of Uganda — drill into regions, districts and branches. Use the search in the overlay panel for keyboard navigation."
    >
      <MapContainer
        center={UGANDA_CENTER}
        zoom={7.5}
        className={styles.map}
        zoomControl={false}
        attributionControl={false}
        minZoom={6}
        maxZoom={16}
        maxBounds={[[-3, 28], [6, 37]]}
        maxBoundsViscosity={0.8}
        zoomDelta={0.5}
        zoomSnap={0.5}
        wheelPxPerZoomLevel={120}
      >
        {/* Basemap tiles — opt-in, and OFF unless VITE_MAP_TILE_URL is set.
            The old keyless CARTO default is watermarked "API KEY REQUIRED" by
            CARTO server-side; see src/config/env.js for the full reasoning. The
            country/district shapes below are GeoJSON and render without it.
            NB: if you re-enable this, add the provider's required attribution —
            `attributionControl={false}` above means none is shown today. */}
        {MAP_TILE_URL && (
          <TileLayer
            url={MAP_TILE_URL}
            opacity={0.2}
          />
        )}

        <TileOpacityController level={level} />

        <MapController
          bounds={mapView.bounds}
          center={mapView.center}
          zoom={mapView.zoom}
          fitOptions={mapView.fitOptions}
          visible={visible}
        />

        {/* Layer 1: Base country fill — bright white land, covers water */}
        {regionsGeo && (
          <GeoJSON
            key="country-base"
            data={regionsGeo}
            style={() => baseCountryStyle}
            interactive={false}
          />
        )}

        {/* Layer 1b: Faint district outlines — adds geographic detail at country level */}
        {districtsGeo && level === 'country' && (
          <GeoJSON
            key="districts-bg"
            data={districtsGeo}
            style={() => ({
              fillColor: 'transparent',
              fillOpacity: 0,
              color: '#b0b5c8',
              weight: 0.3,
              opacity: 0.35,
            })}
            interactive={false}
          />
        )}

        {/* Layer 2: Colored region overlays — always visible for context */}
        {regionsGeo && (
          <GeoJSON
            key={regionKey}
            data={regionsGeo}
            style={regionOverlayStyle}
            {...(level === 'country' ? { onEachFeature: onEachRegion } : {})}
          />
        )}

        {/* Layer 3: Soft bokeh glow halos at region centroids — country level */}
        {level === 'country' && regionsArr.map((r) => {
          const colors = REGION_COLORS[r.name];
          if (!colors) return null;
          return (
            <Marker
              key={`glow-${r.id}`}
              position={[r.center[1], r.center[0]]}
              icon={createGlowIcon(colors.fill, r.id, 180)}
              interactive={false}
            />
          );
        })}

        {/* Layer 4: District boundaries — shown at region level */}
        {regionDistricts && level === 'region' && (
          <GeoJSON
            key={districtKey}
            data={regionDistricts}
            style={districtStyle}
            onEachFeature={onEachDistrict}
          />
        )}

        {/* Layer 5: Selected district highlight */}
        {selectedDistrictGeo && (level === 'district' || level === 'branch') && (
          <GeoJSON
            key={`selected-${selectedDistrictId}`}
            data={selectedDistrictGeo}
            style={selectedDistrictStyle}
          />
        )}

      </MapContainer>
    </div>
  );
}

export default memo(UgandaMap);
