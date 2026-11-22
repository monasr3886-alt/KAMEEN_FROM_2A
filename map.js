"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const EARTH_R = 6371000;
  const PRIMARY_VECTOR_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  const BACKUP_VECTOR_STYLE = "https://tiles.openfreemap.org/styles/dark";

  let rtlPluginInitialized = false;
  function ensureRtlPlugin() {
    if (rtlPluginInitialized || typeof window.maplibregl === "undefined") return;
    rtlPluginInitialized = true;
    try {
      if (typeof window.maplibregl.setRTLTextPlugin === "function") {
        window.maplibregl.setRTLTextPlugin(
          "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js",
          true
        );
      }
    } catch {}
  }

  const reg = {
    centerPin: null,
    missions: new Map(),
    players: new Map(),
    bodies: new Map(),
    airdrop: null,
    decoy: null,
  };

  const selfAnim = {
    curLat: null, curLng: null,
    tgtLat: null, tgtLng: null,
    accMeters: 10,
    colorHex: "#38BDF8",
    rafId: null,
  };

  let styleReady = false;
  let triedBackupVector = false;
  let lastRouteRendered = null;
  let lastBearingEaseAt = 0;
  let lastZoneSig = "";
  let lastRouteSig = "";
  let lastAccSig = "";

  function createCircleRing(center, radiusMeters, steps = 64, clockwise = false) {
    const r = Math.max(2, radiusMeters || 10);
    const dLat = (r / EARTH_R) * (180 / Math.PI);
    const cosLat = Math.max(0.05, Math.cos((center.lat * Math.PI) / 180));
    const dLng = dLat / cosLat;
    const coords = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const a = clockwise ? -t : t;
      coords.push([center.lng + Math.cos(a) * dLng, center.lat + Math.sin(a) * dLat]);
    }
    return coords;
  }

  function emptyFC() {
    return { type: "FeatureCollection", features: [] };
  }

  // Pure OLED Street Radar: #000000 background + clean street vectors + Arabic street names ONLY!
  function applyStreetRadarStyle(map) {
    try {
      const style = map.getStyle();
      if (!style || !Array.isArray(style.layers)) return;

      let matchedRoads = 0;
      const toHide = [];

      for (const layer of style.layers) {
        const id = String(layer.id || "");
        if (id.startsWith("kameen-")) continue;
        const sl = String(layer["source-layer"] || "").toLowerCase();
        const type = layer.type;

        if (type === "background") {
          try { map.setPaintProperty(id, "background-color", "#000000"); } catch {}
          continue;
        }

        const isRoadLine = type === "line" && (
          (sl === "transportation" || sl === "road") ||
          (/road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|tunnel|bridge/i.test(id) &&
           !/rail|ferry|aero|boundary|admin|water|building/i.test(id))
        );

        if (isRoadLine) {
          matchedRoads += 1;
          try {
            map.setLayoutProperty(id, "visibility", "visible");
            const isCasing = /casing|outline|border/i.test(id);
            const isMajor = /motorway|trunk|primary|highway/i.test(id);
            const isMedium = /secondary|tertiary/i.test(id);
            const isPath = /path|pedestrian|foot|track/i.test(id);

            if (isCasing) {
              map.setPaintProperty(id, "line-color", "#0E0E13");
              map.setPaintProperty(id, "line-opacity", 0.5);
            } else if (isMajor) {
              map.setPaintProperty(id, "line-color", "#5E1624");
              map.setPaintProperty(id, "line-opacity", 0.92);
            } else if (isMedium) {
              map.setPaintProperty(id, "line-color", "#361822");
              map.setPaintProperty(id, "line-opacity", 0.88);
            } else if (isPath) {
              map.setPaintProperty(id, "line-color", "#1A1A22");
              map.setPaintProperty(id, "line-opacity", 0.7);
            } else {
              map.setPaintProperty(id, "line-color", "#23232E");
              map.setPaintProperty(id, "line-opacity", 0.9);
            }
          } catch {}
          continue;
        }

        const isStreetLabel = type === "symbol" && (
          sl === "transportation_name" ||
          sl === "road_label" ||
          (/roadname|road_name|road_label|street_name|highway_name/i.test(id) && !/shield|ref|oneway/i.test(id))
        );

        if (isStreetLabel) {
          try {
            map.setLayoutProperty(id, "visibility", "visible");
            map.setPaintProperty(id, "text-color", "#C8C8D4");
            map.setPaintProperty(id, "text-halo-color", "#000000");
            map.setPaintProperty(id, "text-halo-width", 2.0);
            map.setPaintProperty(id, "text-opacity", 0.92);
          } catch {}
          continue;
        }

        toHide.push(id);
      }

      if (matchedRoads >= 1) {
        for (const hid of toHide) {
          try { map.setLayoutProperty(hid, "visibility", "none"); } catch {}
        }
      }
    } catch {}
  }

  function installGameOverlayLayers(map) {
    try {
      applyStreetRadarStyle(map);

      if (!map.getSource("kameen-zone-src")) map.addSource("kameen-zone-src", { type: "geojson", data: emptyFC() });
      if (!map.getSource("kameen-acc-src")) map.addSource("kameen-acc-src", { type: "geojson", data: emptyFC() });
      if (!map.getSource("kameen-route-src")) map.addSource("kameen-route-src", { type: "geojson", data: emptyFC() });

      if (!map.getLayer("kameen-storm-fill")) {
        map.addLayer({
          id: "kameen-storm-fill", type: "fill", source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "storm"],
          paint: { "fill-color": "#5C0916", "fill-opacity": 0.36 },
        });
      }
      if (!map.getLayer("kameen-zone-line")) {
        map.addLayer({
          id: "kameen-zone-line", type: "line", source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "safe_border"],
          paint: { "line-color": "#EF233C", "line-width": 2.6, "line-opacity": 1 },
        });
      }
      if (!map.getLayer("kameen-next-zone")) {
        map.addLayer({
          id: "kameen-next-zone", type: "line", source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "next_zone"],
          paint: { "line-color": "#F59E0B", "line-width": 2, "line-dasharray": [3, 3], "line-opacity": 0.85 },
        });
      }
      if (!map.getLayer("kameen-acc-fill")) {
        map.addLayer({
          id: "kameen-acc-fill", type: "fill", source: "kameen-acc-src",
          paint: { "fill-color": ["coalesce", ["get", "color"], "#38BDF8"], "fill-opacity": 0.14 },
        });
      }
      if (!map.getLayer("kameen-acc-line")) {
        map.addLayer({
          id: "kameen-acc-line", type: "line", source: "kameen-acc-src",
          paint: { "line-color": ["coalesce", ["get", "color"], "#38BDF8"], "line-width": 1.3, "line-opacity": 0.55 },
        });
      }
      if (!map.getLayer("kameen-route-line")) {
        map.addLayer({
          id: "kameen-route-line", type: "line", source: "kameen-route-src",
          paint: { "line-color": "#F59E0B", "line-width": 3, "line-dasharray": [2.5, 2], "line-opacity": 0.96 },
        });
      }

      styleReady = true;
      lastZoneSig = ""; lastRouteSig = ""; lastAccSig = "";
      updateLayers();
    } catch {}
  }

  function makePinElement(cls, innerHtml, labelText, labelTone = "") {
    const wrap = document.createElement("div");
    wrap.className = "gl-pin-wrap";
    if (labelText) {
      const lbl = document.createElement("div");
      lbl.className = "gl-pin-label" + (labelTone ? " " + labelTone : "");
      lbl.textContent = labelText;
      wrap.appendChild(lbl);
    }
    const dot = document.createElement("div");
    dot.className = "kpin " + cls;
    dot.innerHTML = innerHtml || "";
    wrap.appendChild(dot);
    return wrap;
  }

  function clearMapRegistry() {
    if (reg.centerPin) { reg.centerPin.remove(); reg.centerPin = null; }
    if (reg.airdrop) { reg.airdrop.remove(); reg.airdrop = null; }
    if (reg.decoy) { reg.decoy.remove(); reg.decoy = null; }
    for (const m of [reg.missions, reg.players, reg.bodies]) {
      for (const mk of m.values()) mk.remove();
      m.clear();
    }
  }

  function syncKeyedMarkers(mapObj, items, buildFn, updateFn) {
    const map = K.state.glMap;
    if (!map) return;
    const activeKeys = new Set();
    for (const item of items) {
      activeKeys.add(item.key);
      const existing = mapObj.get(item.key);
      if (!existing) {
        const mk = buildFn(item);
        if (mk) {
          mk.addTo(map);
          mapObj.set(item.key, mk);
        }
      } else {
        updateFn(existing, item);
      }
    }
    for (const [k, mk] of mapObj.entries()) {
      if (!activeKeys.has(k)) {
        mk.remove();
        mapObj.delete(k);
      }
    }
  }

  function updateAccuracyGeoJson(lat, lng, accMeters, colorHex) {
    const map = K.state.glMap;
    if (!map || !styleReady) return;
    const r = Math.max(3, Math.min(accMeters || 10, 100));
    const sig = `${lat.toFixed(5)},${lng.toFixed(5)},${Math.round(r)},${colorHex}`;
    if (sig === lastAccSig) return;
    lastAccSig = sig;
    const src = map.getSource("kameen-acc-src");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { color: colorHex },
        geometry: { type: "Polygon", coordinates: [createCircleRing({ lat, lng }, r, 40, false)] },
      }],
    });
  }

  function applyRadarMode() {
    const st = K.state;
    const radarEl = document.getElementById("fallback-radar");
    const glEl = document.getElementById("persistent-gl-map");
    if (!radarEl || !glEl) return;

    const useOffline = st.mapStyle === "radar_offline" || typeof window.maplibregl === "undefined";
    radarEl.classList.toggle("hidden", !useOffline);
    glEl.classList.toggle("hidden", useOffline);

    if (useOffline) {
      renderFallbackRadar();
      return;
    }
    if (st.glMap) {
      st.glMap.resize();
      updateLayers();
    }
  }

  function cycleStyle() {
    const st = K.state;
    st.mapStyle = st.mapStyle === "radar_streets" ? "radar_offline" : "radar_streets";
    K.SFX.play("radar");
    K.showToast(st.mapStyle === "radar_streets" ? "رادار الشوارع مفعّل" : "رادار أوفلاين صافي");
    applyRadarMode();
    K.UI.updateHudOnly();
  }

  function toggleHeadingUp() {
    const st = K.state;
    st.mapRotateWithMe = !st.mapRotateWithMe;
    K.SFX.play("click");
    if (st.mapRotateWithMe) {
      st.mapFollowMe = true;
      if (st.glMap && typeof st.gps.heading === "number" && Number.isFinite(st.gps.heading)) {
        st.glMap.easeTo({ bearing: st.gps.heading, duration: 240 });
      }
      K.showToast("توجيه الرادار مع حركتك مفعّل");
    } else {
      if (st.glMap) st.glMap.easeTo({ bearing: 0, duration: 260 });
      K.showToast("تثبيت الشمال للأعلى");
    }
    K.UI.updateHudOnly();
  }

  function initPersistentMap(center, forceCenter = false) {
    const st = K.state;
    const el = document.getElementById("persistent-gl-map");
    if (!el) return;
    void el.offsetHeight;

    if (typeof window.maplibregl === "undefined") {
      st.mapStyle = "radar_offline";
      applyRadarMode();
      return;
    }

    ensureRtlPlugin();
    applyRadarMode();

    if (st.glMap) {
      st.glMap.resize();
      if (forceCenter && center) {
        st.glMap.jumpTo({
          center: [center.lng, center.lat],
          zoom: Math.max(st.glMap.getZoom(), 17.8),
          pitch: 0,
        });
      }
      return;
    }

    try {
      // Zero-Lag 2D MapLibre tuning (antialias: false + fadeDuration: 0 + bounded tile cache)
      const map = new window.maplibregl.Map({
        container: el,
        style: PRIMARY_VECTOR_STYLE,
        center: [center.lng, center.lat],
        zoom: 18,
        minZoom: 12.5,
        maxZoom: 20,
        pitch: 0,
        maxPitch: 0,
        pitchWithRotate: false,
        touchPitch: false,
        bearing: 0,
        antialias: false,
        fadeDuration: 0,
        maxTileCacheSize: 20,
        attributionControl: false,
      });

      map.on("style.load", () => installGameOverlayLayers(map));

      map.on("error", (ev) => {
        if (!styleReady && !triedBackupVector && ev && ev.error) {
          triedBackupVector = true;
          map.setStyle(BACKUP_VECTOR_STYLE);
        }
      });

      map.on("rotate", () => updateHeadingVisualOnly());

      map.on("dragstart", (e) => {
        if (e && e.originalEvent && st.mapFollowMe) {
          st.mapFollowMe = false;
          const fab = document.getElementById("follow-gps-fab");
          if (fab) fab.classList.remove("active-fab");
        }
      });

      map.on("rotatestart", (e) => {
        if (e && e.originalEvent && st.mapRotateWithMe) {
          st.mapRotateWithMe = false;
          const fab = document.getElementById("compass-rot-fab");
          if (fab) fab.classList.remove("active-fab");
        }
      });

      map.on("click", (e) => {
        K.App.handleMapTap({ lat: e.lngLat.lat, lng: e.lngLat.lng, accuracyMeters: 4 });
      });

      st.glMap = map;
      setTimeout(() => map.resize(), 140);
    } catch {
      st.mapStyle = "radar_offline";
      applyRadarMode();
    }
  }

  function resize() {
    if (K.state.glMap) K.state.glMap.resize();
  }

  function flyTo(coords, zoom = 18.2, animate = true) {
    const st = K.state;
    if (!st.glMap || !coords) return;
    const opts = { center: [coords.lng, coords.lat], zoom: Math.max(st.glMap.getZoom(), zoom), pitch: 0 };
    if (animate) st.glMap.easeTo({ ...opts, duration: 360 });
    else st.glMap.jumpTo(opts);
  }

  function recenter() {
    const st = K.state;
    st.mapFollowMe = true;
    if (st.route === "simulation" && st.gps.hasRealFix) {
      st.simUseRealGps = true;
    }
    const c = st.route === "create"
      ? (st.gps.hasRealFix ? st.gps.coords : st.createForm.center)
      : (st.engine ? st.engine.getVisibleStateForPlayer(st.user.id).self.coords : st.gps.coords);
    if (st.glMap) {
      st.glMap.resize();
      st.glMap.easeTo({
        center: [c.lng, c.lat],
        zoom: Math.max(st.glMap.getZoom(), 18.2),
        pitch: 0,
        bearing: st.mapRotateWithMe && typeof st.gps.heading === "number" ? st.gps.heading : st.glMap.getBearing(),
        duration: 320,
      });
    }
    const fab = document.getElementById("follow-gps-fab");
    if (fab) fab.classList.add("active-fab");
  }

  function buildSelfMarkerElement(colorHex, relDeg, hasHeading) {
    const wrap = document.createElement("div");
    wrap.className = "self-marker-box";
    wrap.innerHTML = `
      <svg class="self-heading-cone" id="live-heading-cone" viewBox="0 0 72 72" width="72" height="72"
        style="opacity:${hasHeading ? 1 : 0};transform:rotate(${Math.round(relDeg)}deg);">
        <defs>
          <radialGradient id="coneGradSelf" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${colorHex}" stop-opacity="0.72" />
            <stop offset="100%" stop-color="${colorHex}" stop-opacity="0" />
          </radialGradient>
        </defs>
        <path d="M 36 36 L 16 5 A 36 36 0 0 1 56 5 Z" fill="url(#coneGradSelf)" />
        <polygon points="36,8 31,18 41,18" fill="#FFFFFF" opacity="0.96" />
      </svg>
      <div class="self-core-dot" style="background:${colorHex};"></div>
    `;
    return wrap;
  }

  function updateHeadingVisualOnly() {
    const st = K.state;
    const deg = st.gps.heading;
    if (typeof deg !== "number" || !Number.isFinite(deg)) return;

    const mapBearing = st.glMap ? st.glMap.getBearing() : 0;
    const relDeg = ((deg - mapBearing) % 360 + 360) % 360;

    const now = Date.now();
    if (st.glMap && st.mapRotateWithMe && now - lastBearingEaseAt >= 180) {
      lastBearingEaseAt = now;
      st.glMap.easeTo({ bearing: deg, duration: 180, easing: (t) => t });
    }

    const cone = document.getElementById("live-heading-cone");
    if (cone) {
      cone.style.opacity = "1";
      cone.style.transform = `rotate(${Math.round(relDeg)}deg)`;
    }
    const radarCone = document.getElementById("radar-heading-cone");
    if (radarCone) {
      const cx = radarCone.dataset.cx || "200";
      const cy = radarCone.dataset.cy || "350";
      radarCone.setAttribute("transform", `rotate(${Math.round(deg)} ${cx} ${cy})`);
      radarCone.style.opacity = "1";
    }
  }

  function stepSelfGlide() {
    const st = K.state;
    if (!st.selfMarker || !st.glMap) {
      selfAnim.rafId = null;
      return;
    }
    const dLat = selfAnim.tgtLat - selfAnim.curLat;
    const dLng = selfAnim.tgtLng - selfAnim.curLng;
    if (Math.abs(dLat) < 0.0000015 && Math.abs(dLng) < 0.0000015) {
      selfAnim.curLat = selfAnim.tgtLat;
      selfAnim.curLng = selfAnim.tgtLng;
      st.selfMarker.setLngLat([selfAnim.curLng, selfAnim.curLat]);
      updateAccuracyGeoJson(selfAnim.curLat, selfAnim.curLng, selfAnim.accMeters, selfAnim.colorHex);
      selfAnim.rafId = null;
      return;
    }
    selfAnim.curLat += dLat * 0.34;
    selfAnim.curLng += dLng * 0.34;
    st.selfMarker.setLngLat([selfAnim.curLng, selfAnim.curLat]);
    updateAccuracyGeoJson(selfAnim.curLat, selfAnim.curLng, selfAnim.accMeters, selfAnim.colorHex);
    selfAnim.rafId = requestAnimationFrame(stepSelfGlide);
  }

  function updateSelfMarkerOnMap(coords, colorHex) {
    const st = K.state;
    if (!st.glMap) return;
    const acc = Math.max(2.5, Math.min(coords.fusedAccuracy || coords.accuracyMeters || st.gps.accuracy || 10, 100));
    selfAnim.accMeters = acc;
    selfAnim.colorHex = colorHex;

    const hasHeading = typeof st.gps.heading === "number" && Number.isFinite(st.gps.heading);
    const relDeg = hasHeading ? (st.gps.heading - st.glMap.getBearing()) : 0;

    if (!st.selfMarker || st.selfMarkerColorKey !== colorHex) {
      if (st.selfMarker) st.selfMarker.remove();
      selfAnim.curLat = coords.lat; selfAnim.curLng = coords.lng;
      selfAnim.tgtLat = coords.lat; selfAnim.tgtLng = coords.lng;
      const el = buildSelfMarkerElement(colorHex, relDeg, hasHeading);
      st.selfMarker = new window.maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([coords.lng, coords.lat])
        .addTo(st.glMap);
      st.selfMarkerColorKey = colorHex;
      updateAccuracyGeoJson(coords.lat, coords.lng, acc, colorHex);
    } else {
      const jumpDist = K.Geo.distanceMeters(
        { lat: selfAnim.curLat ?? coords.lat, lng: selfAnim.curLng ?? coords.lng },
        coords
      );
      selfAnim.tgtLat = coords.lat; selfAnim.tgtLng = coords.lng;
      if (jumpDist > 45 || selfAnim.curLat === null) {
        selfAnim.curLat = coords.lat; selfAnim.curLng = coords.lng;
        st.selfMarker.setLngLat([coords.lng, coords.lat]);
        updateAccuracyGeoJson(coords.lat, coords.lng, acc, colorHex);
      } else if (!selfAnim.rafId) {
        selfAnim.rafId = requestAnimationFrame(stepSelfGlide);
      }
      updateHeadingVisualOnly();
    }
  }

  function setSelfLiveCoords(coords, shouldPanIfFollowing = true) {
    const st = K.state;
    if (st.mapStyle === "radar_offline" || typeof window.maplibregl === "undefined") {
      if (st.route === "game" || st.route === "simulation" || st.route === "create") renderFallbackRadar();
      return;
    }
    if (!st.glMap) return;

    let colorHex = "#38BDF8";
    if (st.engine && (st.route === "game" || st.route === "simulation")) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      colorHex = !vis.self.alive ? "#94A3B8" : (vis.self.role === "IMPOSTER" ? "#EF233C" : "#38BDF8");
    }

    updateSelfMarkerOnMap(coords, colorHex);

    if (shouldPanIfFollowing && st.mapFollowMe && (st.route === "game" || st.route === "simulation")) {
      const c = st.glMap.getCenter();
      if (K.Geo.distanceMeters({ lat: c.lat, lng: c.lng }, coords) >= 2.5) {
        st.glMap.easeTo({ center: [coords.lng, coords.lat], duration: 280 });
      }
    }
  }

  async function fetchOverpassPOIs(center, radius, applyToActiveEngine = false) {
    const searchR = Math.min(1000, Math.max(radius + 80, 240));
    const query =
      `[out:json][timeout:8];(` +
      `way["name"]["highway"~"primary|secondary|tertiary|residential|unclassified|pedestrian"](around:${searchR},${center.lat},${center.lng});` +
      `nwr["name"]["amenity"~"mosque|place_of_worship|cafe|restaurant|pharmacy|bank|school|hospital|marketplace|parking"](around:${searchR},${center.lat},${center.lng});` +
      `nwr["name"]["leisure"~"park|playground|sports_centre|stadium|garden|club"](around:${searchR},${center.lat},${center.lng});` +
      `);out center 50;`;

    const mirrors = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

    let realPois = [];
    for (const endpoint of mirrors) {
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(endpoint, {
          method: "POST", signal: ctrl.signal,
          body: "data=" + encodeURIComponent(query),
        });
        clearTimeout(tm);
        if (!res.ok) continue;
        const data = await res.json();
        const seenNames = new Set();
        const streets = [];
        const landmarks = [];

        for (const el of (data.elements || [])) {
          if (el.tags && el.tags.access === "private") continue;
          const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
          const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
          if (typeof lat !== "number" || typeof lng !== "number") continue;

          const rawName = (el.tags && (el.tags["name:ar"] || el.tags.name || el.tags["alt_name:ar"])) || "";
          const cleanName = rawName.trim();
          if (!cleanName || cleanName.length < 2) continue;

          const isStreet = Boolean(el.tags && el.tags.highway && !el.tags.amenity && !el.tags.leisure);
          const displayName = isStreet && !/^(شارع|طريق|محور|ميدان|كوبري|حارة|زقاق|ممر)/.test(cleanName)
            ? `شارع ${cleanName}` : cleanName;

          const key = displayName.toLowerCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          const item = { id: "osm-" + el.id, name: displayName, category: isStreet ? "street" : "landmark", lat, lng, isReal: true };
          if (isStreet) streets.push(item);
          else landmarks.push(item);
        }

        realPois = [...streets.slice(0, 12), ...landmarks.slice(0, 6)].slice(0, 18);
        if (realPois.length >= 2) break;
      } catch {}
    }

    if (realPois.length >= 2) {
      K.state.createForm.pois = realPois;
      K.state.createForm.poiSource = `${realPois.length} شارع ونقطة`;
      if (applyToActiveEngine && K.state.engine) K.state.engine.setPOIs(realPois);
    } else {
      K.state.createForm.pois = K.Geo.generateFallbackPOIs(center, radius);
      K.state.createForm.poiSource = "نقاط رادار محلية";
    }

    if (K.state.route === "create" || (applyToActiveEngine && (K.state.route === "game" || K.state.route === "simulation"))) {
      updateLayers();
      K.UI.updateHudOnly();
    }
    return K.state.createForm.pois;
  }

  function renderFallbackRadar() {
    const st = K.state;
    const svg = document.getElementById("fallback-radar");
    if (!svg) return;
    const base = st.route === "create"
      ? st.createForm.center
      : (st.engine ? st.engine.getSnapshot().zone.center : st.gps.coords);
    const radiusRef = st.route === "create"
      ? st.createForm.radius
      : (st.engine ? st.engine.getSnapshot().zone.initialRadiusMeters : 250);
    const scale = 155 / Math.max(120, radiusRef);
    const proj = (c) => ({
      x: 200 + (c.lng - base.lng) * 111320 * Math.cos((base.lat * Math.PI) / 180) * scale,
      y: 350 - (c.lat - base.lat) * 111320 * scale,
    });
    const heading = typeof st.gps.heading === "number" && Number.isFinite(st.gps.heading) ? Math.round(st.gps.heading) : null;

    let shapes = `
      <rect width="400" height="700" fill="#000000"/>
      <circle cx="200" cy="350" r="70" fill="none" stroke="#181820" stroke-width="1"/>
      <circle cx="200" cy="350" r="140" fill="none" stroke="#181820" stroke-width="1"/>
      <circle cx="200" cy="350" r="210" fill="none" stroke="#14141A" stroke-width="1"/>
    `;

    if (st.route === "create") {
      const z = proj(st.createForm.center);
      shapes += `<circle cx="${z.x}" cy="${z.y}" r="${st.createForm.radius * scale}" fill="rgba(239,35,60,0.14)" stroke="#EF233C" stroke-width="2.2"/>`;
      const me = proj(st.gps.coords);
      shapes += `<g id="radar-heading-cone" data-cx="${me.x}" data-cy="${me.y}" style="opacity:${heading !== null ? 1 : 0};" transform="rotate(${heading || 0} ${me.x} ${me.y})">
        <path d="M ${me.x} ${me.y} L ${me.x - 16} ${me.y - 34} A 38 38 0 0 1 ${me.x + 16} ${me.y - 34} Z" fill="#38BDF8" opacity="0.35"/>
      </g><circle cx="${me.x}" cy="${me.y}" r="8" fill="#38BDF8" stroke="#FFFFFF" stroke-width="2.5"/>`;
    } else if (st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isSpread = vis.phase === "SPREAD";
      const z = proj(vis.zone.center);
      const nz = proj(vis.zone.nextCenter);
      shapes += `<circle cx="${z.x}" cy="${z.y}" r="${vis.zone.currentRadiusMeters * scale}" fill="rgba(239,35,60,0.12)" stroke="#EF233C" stroke-width="2.4"/>`;
      shapes += `<circle cx="${nz.x}" cy="${nz.y}" r="${vis.zone.nextRadiusMeters * scale}" fill="none" stroke="#F59E0B" stroke-width="1.6" stroke-dasharray="6,6"/>`;
      const sc = proj(vis.self.coords);
      if (!isSpread) {
        const act = vis.missions.find((m) => m.status === "in_progress");
        if (act) {
          const mp = proj({ lat: act.poi.lat, lng: act.poi.lng });
          shapes += `<line x1="${sc.x}" y1="${sc.y}" x2="${mp.x}" y2="${mp.y}" stroke="#F59E0B" stroke-width="2.8" stroke-dasharray="7,7"/>`;
        }
        vis.missions.forEach((m) => {
          const pt = proj({ lat: m.poi.lat, lng: m.poi.lng });
          const isAct = act && act.id === m.id;
          shapes += `<circle cx="${pt.x}" cy="${pt.y}" r="${isAct ? 7.5 : 5}" fill="${m.status === "completed" ? "#10B981" : "#FFFFFF"}" stroke="${isAct ? "#F59E0B" : "#EF233C"}" stroke-width="2.2"/>`;
        });
        vis.players.filter((p) => p.coords && p.alive && p.id !== vis.self.id).forEach((p) => {
          const pt = proj(p.coords);
          const col = p.isRedBrokerBroadcast ? "#EF233C" : "#38BDF8";
          shapes += `<circle cx="${pt.x}" cy="${pt.y}" r="7" fill="${p.isPingOnly ? "none" : col}" stroke="${col}" stroke-width="2.5"/>`;
          shapes += `<text x="${pt.x}" y="${pt.y - 11}" text-anchor="middle" fill="#E4E4EA" font-size="10" font-weight="800">${K.escHtml(p.name)}</text>`;
        });
      }
      const selfColor = !vis.self.alive ? "#94A3B8" : (vis.self.role === "IMPOSTER" ? "#EF233C" : "#38BDF8");
      shapes += `<g id="radar-heading-cone" data-cx="${sc.x}" data-cy="${sc.y}" style="opacity:${heading !== null ? 1 : 0};" transform="rotate(${heading || 0} ${sc.x} ${sc.y})">
        <path d="M ${sc.x} ${sc.y} L ${sc.x - 16} ${sc.y - 34} A 38 38 0 0 1 ${sc.x + 16} ${sc.y - 34} Z" fill="${selfColor}" opacity="0.35"/>
      </g><circle cx="${sc.x}" cy="${sc.y}" r="8.5" fill="${selfColor}" stroke="#FFFFFF" stroke-width="2.5"/>`;
    }

    svg.innerHTML = shapes;
    svg.onclick = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * 400;
      const py = ((evt.clientY - rect.top) / rect.height) * 700;
      K.App.handleMapTap(K.Geo.offsetCoordinates(base, (350 - py) / scale, (px - 200) / scale));
    };
  }

  function setZoneGeoJson(center, radiusMeters, nextCenter = null, nextRadiusMeters = null) {
    const map = K.state.glMap;
    if (!map || !styleReady) return;
    const sig = `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${Math.round(radiusMeters)}|` +
      (nextCenter && nextRadiusMeters ? `${nextCenter.lat.toFixed(5)},${nextCenter.lng.toFixed(5)},${Math.round(nextRadiusMeters)}` : "");
    if (sig === lastZoneSig) return;
    lastZoneSig = sig;
    const src = map.getSource("kameen-zone-src");
    if (!src) return;

    const worldOuter = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    const features = [
      { type: "Feature", properties: { kind: "storm" }, geometry: { type: "Polygon", coordinates: [worldOuter, createCircleRing(center, radiusMeters, 64, true)] } },
      { type: "Feature", properties: { kind: "safe_border" }, geometry: { type: "LineString", coordinates: createCircleRing(center, radiusMeters, 64, false) } },
    ];
    if (nextCenter && nextRadiusMeters) {
      features.push({
        type: "Feature", properties: { kind: "next_zone" },
        geometry: { type: "LineString", coordinates: createCircleRing(nextCenter, nextRadiusMeters, 56, false) },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }

  function setRouteGeoJson(fromCoords, toCoords) {
    const map = K.state.glMap;
    if (!map || !styleReady) return;
    const sig = (fromCoords && toCoords)
      ? `${fromCoords.lat.toFixed(5)},${fromCoords.lng.toFixed(5)}->${toCoords.lat.toFixed(5)},${toCoords.lng.toFixed(5)}`
      : "EMPTY";
    if (sig === lastRouteSig) return;
    lastRouteSig = sig;
    const src = map.getSource("kameen-route-src");
    if (!src) return;
    if (!fromCoords || !toCoords) { src.setData(emptyFC()); return; }
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: [[fromCoords.lng, fromCoords.lat], [toCoords.lng, toCoords.lat]] },
      }],
    });
  }

  function updateLayers() {
    const st = K.state;
    if (st.mapStyle === "radar_offline" || typeof window.maplibregl === "undefined") {
      renderFallbackRadar();
      return;
    }
    if (!st.glMap) return;

    if (lastRouteRendered !== st.route) {
      clearMapRegistry();
      lastRouteRendered = st.route;
    }

    if (st.route === "create") {
      const f = st.createForm;
      setZoneGeoJson(f.center, f.radius, null, null);
      setRouteGeoJson(null, null);

      if (!reg.centerPin) {
        reg.centerPin = new window.maplibregl.Marker({
          element: makePinElement("kpin-center", "", "مركز الزون", "red"),
          anchor: "bottom",
        }).setLngLat([f.center.lng, f.center.lat]).addTo(st.glMap);
      } else {
        reg.centerPin.setLngLat([f.center.lng, f.center.lat]);
      }

      updateSelfMarkerOnMap(st.gps.coords, "#38BDF8");
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const isSpread = vis.phase === "SPREAD";

    setZoneGeoJson(vis.zone.center, vis.zone.currentRadiusMeters, vis.zone.nextCenter, vis.zone.nextRadiusMeters);

    if (isSpread) {
      setRouteGeoJson(null, null);
      syncKeyedMarkers(reg.missions, [], () => null, () => {});
      syncKeyedMarkers(reg.players, [], () => null, () => {});
      syncKeyedMarkers(reg.bodies, [], () => null, () => {});
      if (reg.airdrop) { reg.airdrop.remove(); reg.airdrop = null; }
      if (reg.decoy) { reg.decoy.remove(); reg.decoy = null; }
    } else {
      const activeMission = vis.missions.find((m) => m.status === "in_progress");

      syncKeyedMarkers(
        reg.missions,
        vis.missions.map((m) => {
          const isAct = Boolean(activeMission && activeMission.id === m.id);
          return { key: `${m.id}|${m.status}|${isAct ? 1 : 0}|${m.poi.name}`, m, isAct };
        }),
        ({ m, isAct }) => {
          const cls = m.status === "completed" ? "kpin-mission done" : (isAct ? "kpin-mission active" : "kpin-mission");
          const ico = m.status === "completed" ? "✓" : (isAct ? "★" : "");
          const lbl = m.status === "completed" ? "" : m.poi.name;
          return new window.maplibregl.Marker({
            element: makePinElement(cls, ico, lbl, isAct ? "gold" : ""),
            anchor: "bottom",
          }).setLngLat([m.poi.lng, m.poi.lat]);
        },
        (mk, { m }) => mk.setLngLat([m.poi.lng, m.poi.lat])
      );

      setRouteGeoJson(activeMission ? vis.self.coords : null, activeMission ? { lat: activeMission.poi.lat, lng: activeMission.poi.lng } : null);

      if (vis.activeAirdrop) {
        if (!reg.airdrop) {
          reg.airdrop = new window.maplibregl.Marker({
            element: makePinElement("kpin-airdrop", "+", "إمداد +45ن", "gold"),
            anchor: "bottom",
          }).setLngLat([vis.activeAirdrop.coords.lng, vis.activeAirdrop.coords.lat]).addTo(st.glMap);
        } else {
          reg.airdrop.setLngLat([vis.activeAirdrop.coords.lng, vis.activeAirdrop.coords.lat]);
        }
      } else if (reg.airdrop) {
        reg.airdrop.remove(); reg.airdrop = null;
      }

      if (vis.decoyPing) {
        if (!reg.decoy) {
          reg.decoy = new window.maplibregl.Marker({
            element: makePinElement("kpin-body", "!", "إشارة مشبوهة", "red"),
            anchor: "bottom",
          }).setLngLat([vis.decoyPing.coords.lng, vis.decoyPing.coords.lat]).addTo(st.glMap);
        } else {
          reg.decoy.setLngLat([vis.decoyPing.coords.lng, vis.decoyPing.coords.lat]);
        }
      } else if (reg.decoy) {
        reg.decoy.remove(); reg.decoy = null;
      }

      syncKeyedMarkers(
        reg.bodies,
        vis.bodies.filter((b) => !b.reported).map((b) => ({ key: b.id, ...b })),
        (b) => new window.maplibregl.Marker({
          element: makePinElement("kpin-body", "×", "جثة: " + b.victimName, "red"),
          anchor: "bottom",
        }).setLngLat([b.coords.lng, b.coords.lat]),
        (mk, b) => mk.setLngLat([b.coords.lng, b.coords.lat])
      );

      // Players: cleanly differentiate Live Broker Red Alert vs Periodic Radar Ping Snapshot ("آخر رصد")!
      const pItems = vis.players
        .filter((p) => p.coords && p.alive && p.id !== vis.self.id)
        .map((p) => ({
          key: `${p.id}|${p.isRedBrokerBroadcast ? "B" : (p.isPingOnly ? "P" : "L")}`,
          ...p,
        }));
      syncKeyedMarkers(
        reg.players,
        pItems,
        (p) => {
          const cls = p.isRedBrokerBroadcast
            ? "kpin-player broker"
            : (p.isPingOnly ? "kpin-player ping-snap" : "kpin-player");
          const tone = p.isRedBrokerBroadcast ? "red" : "cyan";
          const lbl = p.isRedBrokerBroadcast
            ? p.name + " (مكشوف)"
            : (p.isPingOnly ? p.name + " • آخر رصد" : p.name);
          return new window.maplibregl.Marker({
            element: makePinElement(cls, "", lbl, tone),
            anchor: "bottom",
          }).setLngLat([p.coords.lng, p.coords.lat]);
        },
        (mk, p) => mk.setLngLat([p.coords.lng, p.coords.lat])
      );
    }

    const selfColor = !vis.self.alive ? "#94A3B8" : (vis.self.role === "IMPOSTER" ? "#EF233C" : "#38BDF8");
    updateSelfMarkerOnMap(vis.self.coords, selfColor);
  }

  K.Map = {
    applyRadarMode,
    cycleStyle,
    toggleHeadingUp,
    initPersistentMap,
    resize,
    flyTo,
    recenter,
    fetchOverpassPOIs,
    updateLayers,
    updateHeadingVisualOnly,
    setSelfLiveCoords,
  };
})(window.Kameen);
