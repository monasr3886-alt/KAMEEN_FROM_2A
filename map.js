"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const EARTH_R = 6371000;

  // Enable crisp Arabic connected RTL text inside MapLibre GL WebGL maps
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

  // Persistent keyed DOM markers registry (ZERO drift, ZERO flicker on zoom/rotate)
  const reg = {
    centerPin: null,
    createPois: new Map(),
    missions: new Map(),
    landmarks: new Map(),
    players: new Map(),
    bodies: new Map(),
    airdrop: null,
    decoy: null,
  };

  // Smooth 60fps animator for player dot + metric accuracy ring
  const selfAnim = {
    curLat: null, curLng: null,
    tgtLat: null, tgtLng: null,
    accMeters: 10,
    colorHex: "#00D4FF",
    rafId: null,
  };

  let styleReady = false;
  let lastRouteRendered = null;
  let lastBearingEaseAt = 0;

  function createCircleRing(center, radiusMeters, steps = 72, clockwise = false) {
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

  function getSatelliteStyleSpec() {
    return {
      version: 8,
      sources: {
        "esri-sat": {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
        },
        "esri-lbl": {
          type: "raster",
          tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        { id: "sat-base", type: "raster", source: "esri-sat" },
        { id: "sat-labels", type: "raster", source: "esri-lbl", paint: { "raster-opacity": 0.9 } },
      ],
    };
  }

  function getStyleSpec(styleKey) {
    if (styleKey === "street3d") return "https://tiles.openfreemap.org/styles/liberty";
    if (styleKey === "satellite") return getSatelliteStyleSpec();
    return "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  }

  // Dynamically extrude 3D tactical buildings on Carto Dark Matter & any vector style without crashing
  function inject3DBuildingsIfAvailable(map) {
    try {
      const style = map.getStyle();
      if (!style || !style.layers) return;
      if (map.getLayer("kameen-3d-buildings") || map.getLayer("building-3d")) return;

      const buildingLayer = style.layers.find(
        (l) => l.source && l["source-layer"] && /building/i.test(l["source-layer"]) && l.type === "fill"
      );
      if (!buildingLayer) return;

      const firstLabel = style.layers.find((l) => l.type === "symbol" && l.layout && l.layout["text-field"]);
      const beforeId = firstLabel ? firstLabel.id : undefined;
      const isDark = K.state.mapStyle === "dark3d";

      map.addLayer(
        {
          id: "kameen-3d-buildings",
          source: buildingLayer.source,
          "source-layer": buildingLayer["source-layer"],
          type: "fill-extrusion",
          minzoom: 14.5,
          paint: {
            "fill-extrusion-color": isDark
              ? ["interpolate", ["linear"], ["zoom"], 15, "#151F33", 18, "#223252"]
              : "#CBD5E1",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              ["get", "height"],
              11
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              ["get", "min_height"],
              0
            ],
            "fill-extrusion-opacity": isDark ? 0.86 : 0.78,
          },
        },
        beforeId
      );
    } catch {}
  }

  // Install WebGL GeoJSON layers: Battle Royale Storm Fog, Double Neon Zone Ring, Next Zone, Accuracy Ring, Glowing Route
  function installGameOverlayLayers(map) {
    try {
      inject3DBuildingsIfAvailable(map);

      if (!map.getSource("kameen-zone-src")) {
        map.addSource("kameen-zone-src", { type: "geojson", data: emptyFC() });
      }
      if (!map.getSource("kameen-acc-src")) {
        map.addSource("kameen-acc-src", { type: "geojson", data: emptyFC() });
      }
      if (!map.getSource("kameen-route-src")) {
        map.addSource("kameen-route-src", { type: "geojson", data: emptyFC() });
      }

      // 1. Battle Royale Storm Fog OUTSIDE the safe zone
      if (!map.getLayer("kameen-storm-fill")) {
        map.addLayer({
          id: "kameen-storm-fill",
          type: "fill",
          source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "storm"],
          paint: {
            "fill-color": "#7F1D1D",
            "fill-opacity": 0.34,
          },
        });
      }

      // 2. Soft Neon Outer Glow for Zone Boundary
      if (!map.getLayer("kameen-zone-glow")) {
        map.addLayer({
          id: "kameen-zone-glow",
          type: "line",
          source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "safe_border"],
          paint: {
            "line-color": "#FF2E54",
            "line-width": 11,
            "line-blur": 7,
            "line-opacity": 0.55,
          },
        });
      }

      // 3. Razor-Sharp Safe Zone Core Line
      if (!map.getLayer("kameen-zone-line")) {
        map.addLayer({
          id: "kameen-zone-line",
          type: "line",
          source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "safe_border"],
          paint: {
            "line-color": "#FF2E54",
            "line-width": 2.6,
            "line-opacity": 0.98,
          },
        });
      }

      // 4. Next Shrink Zone Dashed Golden Ring
      if (!map.getLayer("kameen-next-zone")) {
        map.addLayer({
          id: "kameen-next-zone",
          type: "line",
          source: "kameen-zone-src",
          filter: ["==", ["get", "kind"], "next_zone"],
          paint: {
            "line-color": "#FFB020",
            "line-width": 2.2,
            "line-dasharray": [3, 3],
            "line-opacity": 0.92,
          },
        });
      }

      // 5. True Metric GPS Accuracy Circle Polygon
      if (!map.getLayer("kameen-acc-fill")) {
        map.addLayer({
          id: "kameen-acc-fill",
          type: "fill",
          source: "kameen-acc-src",
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "#00D4FF"],
            "fill-opacity": 0.14,
          },
        });
      }
      if (!map.getLayer("kameen-acc-line")) {
        map.addLayer({
          id: "kameen-acc-line",
          type: "line",
          source: "kameen-acc-src",
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#00D4FF"],
            "line-width": 1.4,
            "line-opacity": 0.55,
          },
        });
      }

      // 6. Active Mission Glowing Tactical Path
      if (!map.getLayer("kameen-route-glow")) {
        map.addLayer({
          id: "kameen-route-glow",
          type: "line",
          source: "kameen-route-src",
          paint: {
            "line-color": "#FFB020",
            "line-width": 9,
            "line-blur": 5,
            "line-opacity": 0.42,
          },
        });
      }
      if (!map.getLayer("kameen-route-line")) {
        map.addLayer({
          id: "kameen-route-line",
          type: "line",
          source: "kameen-route-src",
          paint: {
            "line-color": "#FDE68A",
            "line-width": 3.2,
            "line-dasharray": [2.2, 2],
            "line-opacity": 0.98,
          },
        });
      }

      styleReady = true;
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
    for (const m of [reg.createPois, reg.missions, reg.landmarks, reg.players, reg.bodies]) {
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
    const src = map.getSource("kameen-acc-src");
    if (!src) return;
    const ring = createCircleRing({ lat, lng }, Math.max(4, Math.min(accMeters || 10, 120)), 48, false);
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { color: colorHex },
        geometry: { type: "Polygon", coordinates: [ring] },
      }],
    });
  }

  function applyTileLayer() {
    const st = K.state;
    const radarEl = document.getElementById("fallback-radar");
    const glEl = document.getElementById("persistent-gl-map");
    if (!radarEl || !glEl) return;

    if (st.mapStyle === "radar" || typeof window.maplibregl === "undefined") {
      radarEl.classList.remove("hidden");
      glEl.classList.add("hidden");
      renderFallbackRadar();
      return;
    }

    radarEl.classList.add("hidden");
    glEl.classList.remove("hidden");
    if (!st.glMap) return;

    styleReady = false;
    st.glMap.setStyle(getStyleSpec(st.mapStyle));
  }

  function cycleStyle() {
    const order = ["dark3d", "street3d", "satellite", "radar"];
    const idx = order.indexOf(K.state.mapStyle);
    K.state.mapStyle = order[(idx + 1) % order.length];
    K.SFX.play("click");
    applyTileLayer();
    K.UI.updateHudOnly();
  }

  function toggle3D() {
    const st = K.state;
    st.map3D = !st.map3D;
    K.SFX.play("click");
    if (st.glMap) {
      st.glMap.easeTo({ pitch: st.map3D ? 52 : 0, duration: 420 });
    }
    K.UI.updateHudOnly();
  }

  function toggleHeadingUp() {
    const st = K.state;
    st.mapRotateWithMe = !st.mapRotateWithMe;
    K.SFX.play("click");
    if (st.mapRotateWithMe) {
      st.mapFollowMe = true;
      void K.App.startCompass(true);
      if (st.glMap && typeof st.gps.heading === "number" && Number.isFinite(st.gps.heading)) {
        st.glMap.easeTo({ bearing: st.gps.heading, duration: 300 });
      }
      K.showToast("🧭 الخريطة بتلف معاك 360° دلوقتي!");
    } else {
      if (st.glMap) st.glMap.easeTo({ bearing: 0, duration: 320 });
      K.showToast("🧭 تم تثبيت الشمال لفوق");
    }
    K.UI.updateHudOnly();
  }

  function initPersistentMap(center, forceCenter = false) {
    const st = K.state;
    const el = document.getElementById("persistent-gl-map");
    if (!el) return;
    void el.offsetHeight;

    if (typeof window.maplibregl === "undefined") {
      st.mapStyle = "radar";
      applyTileLayer();
      return;
    }

    ensureRtlPlugin();

    if (st.glMap) {
      st.glMap.resize();
      if (forceCenter && center) {
        st.glMap.jumpTo({
          center: [center.lng, center.lat],
          zoom: Math.max(st.glMap.getZoom(), 17.5),
          pitch: st.map3D ? 52 : 0,
        });
      }
      return;
    }

    try {
      const map = new window.maplibregl.Map({
        container: el,
        style: getStyleSpec(st.mapStyle),
        center: [center.lng, center.lat],
        zoom: 18,
        minZoom: 12,
        maxZoom: 21,
        pitch: st.map3D ? 52 : 0,
        bearing: 0,
        antialias: true,
        attributionControl: false,
      });

      map.on("style.load", () => {
        installGameOverlayLayers(map);
      });

      map.on("error", (ev) => {
        // Auto-fallback smoothly if style server fails completely
        if (!styleReady && ev && ev.error && st.mapStyle === "street3d") {
          st.mapStyle = "dark3d";
          map.setStyle(getStyleSpec("dark3d"));
        }
      });

      map.on("rotate", () => {
        updateHeadingVisualOnly();
      });

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
        K.App.handleMapTap({ lat: e.lngLat.lat, lng: e.lngLat.lng, accuracyMeters: 5 });
      });

      st.glMap = map;
      setTimeout(() => map.resize(), 180);
    } catch {
      st.mapStyle = "radar";
      applyTileLayer();
    }
  }

  function resize() {
    if (K.state.glMap) K.state.glMap.resize();
  }

  function flyTo(coords, zoom = 18.2, animate = true) {
    const st = K.state;
    if (!st.glMap || !coords) return;
    const opts = {
      center: [coords.lng, coords.lat],
      zoom: Math.max(st.glMap.getZoom(), zoom),
      pitch: st.map3D ? 52 : 0,
    };
    if (animate) st.glMap.easeTo({ ...opts, duration: 500 });
    else st.glMap.jumpTo(opts);
  }

  function recenter() {
    const st = K.state;
    st.mapFollowMe = true;
    if (st.route === "simulation" && st.gps.hasRealFix) {
      st.simUseRealGps = true;
      K.showToast("📍 الكاميرا والـ GPS الحقيقي شغالين مع حركتك!");
    }
    const c = st.route === "create"
      ? (st.gps.hasRealFix ? st.gps.coords : st.createForm.center)
      : (st.engine ? st.engine.getVisibleStateForPlayer(st.user.id).self.coords : st.gps.coords);
    if (st.glMap) {
      st.glMap.resize();
      st.glMap.easeTo({
        center: [c.lng, c.lat],
        zoom: Math.max(st.glMap.getZoom(), 18.2),
        pitch: st.map3D ? 52 : 0,
        bearing: st.mapRotateWithMe && typeof st.gps.heading === "number" ? st.gps.heading : st.glMap.getBearing(),
        duration: 420,
      });
    }
    const fab = document.getElementById("follow-gps-fab");
    if (fab) fab.classList.add("active-fab");
  }

  function buildSelfMarkerElement(colorHex, isImp, relDeg, hasHeading) {
    const wrap = document.createElement("div");
    wrap.className = "self-marker-box";
    const gradId = isImp ? "coneGradImp" : "coneGradInv";
    wrap.innerHTML = `
      <svg class="self-heading-cone" id="live-heading-cone" viewBox="0 0 76 76" width="76" height="76"
        style="opacity:${hasHeading ? 1 : 0};transform:rotate(${Math.round(relDeg)}deg);">
        <defs>
          <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${colorHex}" stop-opacity="0.78" />
            <stop offset="100%" stop-color="${colorHex}" stop-opacity="0" />
          </radialGradient>
        </defs>
        <path d="M 38 38 L 16 4 A 38 38 0 0 1 60 4 Z" fill="url(#${gradId})" />
        <polygon points="38,7 32,18 44,18" fill="#FFFFFF" opacity="0.96" />
      </svg>
      <div class="self-core-dot pulse-gps ${isImp ? "imposter" : ""}" style="background:${colorHex};"></div>
    `;
    return wrap;
  }

  function updateHeadingVisualOnly() {
    const st = K.state;
    const deg = st.gps.heading;
    if (typeof deg !== "number" || !Number.isFinite(deg)) return;

    const mapBearing = st.glMap ? st.glMap.getBearing() : 0;
    const relDeg = ((deg - mapBearing) % 360 + 360) % 360;

    // In 360° Heading-Up mode, smoothly rotate the entire 3D map with the player!
    const now = Date.now();
    if (st.glMap && st.mapRotateWithMe && now - lastBearingEaseAt >= 130) {
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
    const compassEl = document.getElementById("hud-compass-lbl");
    if (compassEl) {
      compassEl.textContent = "🧭 " + K.App.headingToArabic(deg);
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
    if (Math.abs(dLat) < 0.0000012 && Math.abs(dLng) < 0.0000012) {
      selfAnim.curLat = selfAnim.tgtLat;
      selfAnim.curLng = selfAnim.tgtLng;
      st.selfMarker.setLngLat([selfAnim.curLng, selfAnim.curLat]);
      updateAccuracyGeoJson(selfAnim.curLat, selfAnim.curLng, selfAnim.accMeters, selfAnim.colorHex);
      selfAnim.rafId = null;
      return;
    }
    selfAnim.curLat += dLat * 0.28;
    selfAnim.curLng += dLng * 0.28;
    st.selfMarker.setLngLat([selfAnim.curLng, selfAnim.curLat]);
    updateAccuracyGeoJson(selfAnim.curLat, selfAnim.curLng, selfAnim.accMeters, selfAnim.colorHex);
    selfAnim.rafId = requestAnimationFrame(stepSelfGlide);
  }

  function updateSelfMarkerOnMap(coords, colorHex, isImp) {
    const st = K.state;
    if (!st.glMap) return;
    const acc = Math.max(3, Math.min(coords.accuracyMeters || st.gps.accuracy || 10, 120));
    selfAnim.accMeters = acc;
    selfAnim.colorHex = colorHex;

    const colorKey = colorHex + (isImp ? "_1" : "_0");
    const hasHeading = typeof st.gps.heading === "number" && Number.isFinite(st.gps.heading);
    const relDeg = hasHeading ? (st.gps.heading - st.glMap.getBearing()) : 0;

    if (!st.selfMarker || st.selfMarkerColorKey !== colorKey) {
      if (st.selfMarker) st.selfMarker.remove();
      selfAnim.curLat = coords.lat;
      selfAnim.curLng = coords.lng;
      selfAnim.tgtLat = coords.lat;
      selfAnim.tgtLng = coords.lng;
      const el = buildSelfMarkerElement(colorHex, isImp, relDeg, hasHeading);
      st.selfMarker = new window.maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([coords.lng, coords.lat])
        .addTo(st.glMap);
      st.selfMarkerColorKey = colorKey;
      updateAccuracyGeoJson(coords.lat, coords.lng, acc, colorHex);
    } else {
      const jumpDist = K.Geo.distanceMeters(
        { lat: selfAnim.curLat ?? coords.lat, lng: selfAnim.curLng ?? coords.lng },
        coords
      );
      selfAnim.tgtLat = coords.lat;
      selfAnim.tgtLng = coords.lng;
      if (jumpDist > 55 || selfAnim.curLat === null) {
        selfAnim.curLat = coords.lat;
        selfAnim.curLng = coords.lng;
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
    if (st.mapStyle === "radar" || typeof window.maplibregl === "undefined") {
      if (st.route === "game" || st.route === "simulation" || st.route === "create") renderFallbackRadar();
      return;
    }
    if (!st.glMap) return;

    let colorHex = "#00D4FF";
    let isImp = false;
    if (st.engine && (st.route === "game" || st.route === "simulation")) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      isImp = vis.self.role === "IMPOSTER";
      colorHex = !vis.self.alive ? "#64748B" : (isImp ? "#FF2E54" : "#00D4FF");
    }

    updateSelfMarkerOnMap(coords, colorHex, isImp);

    if (shouldPanIfFollowing && st.mapFollowMe && (st.route === "game" || st.route === "simulation")) {
      const c = st.glMap.getCenter();
      const driftM = K.Geo.distanceMeters({ lat: c.lat, lng: c.lng }, coords);
      if (driftM >= 2.5) {
        st.glMap.easeTo({
          center: [coords.lng, coords.lat],
          duration: 340,
        });
      }
    }
  }

  async function fetchOverpassPOIs(center, radius, applyToActiveEngine = false) {
    const searchR = Math.min(1100, Math.max(radius + 90, 260));
    const query =
      `[out:json][timeout:8];(` +
      `nwr["name"]["amenity"~"mosque|place_of_worship|cafe|restaurant|fast_food|pharmacy|bank|school|hospital|clinic|marketplace|fuel|parking|cinema|library"](around:${searchR},${center.lat},${center.lng});` +
      `nwr["name"]["shop"](around:${searchR},${center.lat},${center.lng});` +
      `nwr["name"]["leisure"~"park|playground|sports_centre|stadium|garden|club"](around:${searchR},${center.lat},${center.lng});` +
      `nwr["name"]["building"~"mosque|commercial|mall|school|university|hospital"](around:${searchR},${center.lat},${center.lng});` +
      `way["name"]["highway"~"primary|secondary|tertiary|residential|unclassified|pedestrian"](around:${searchR},${center.lat},${center.lng});` +
      `);out center 60;`;

    const mirrors = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];

    let realPois = [];
    for (const endpoint of mirrors) {
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 7500);
        const res = await fetch(endpoint, {
          method: "POST",
          signal: ctrl.signal,
          body: "data=" + encodeURIComponent(query),
        });
        clearTimeout(tm);
        if (!res.ok) continue;
        const data = await res.json();
        const seenNames = new Set();
        const landmarks = [];
        const streets = [];

        for (const el of (data.elements || [])) {
          if (el.tags && el.tags.access === "private") continue;
          const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
          const lng = typeof el.lon === "number" ? el.lon : el.center?.lon;
          if (typeof lat !== "number" || typeof lng !== "number") continue;

          const rawName = (el.tags && (el.tags["name:ar"] || el.tags.name || el.tags["alt_name:ar"])) || "";
          const cleanName = rawName.trim();
          if (!cleanName || cleanName.length < 2) continue;

          const isStreet = Boolean(el.tags && el.tags.highway && !el.tags.amenity && !el.tags.shop && !el.tags.leisure);
          const displayName = isStreet && !/^(شارع|طريق|محور|ميدان|كوبري|حارة|زقاق|ممر)/.test(cleanName)
            ? `شارع ${cleanName}`
            : cleanName;

          const key = displayName.toLowerCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);

          const item = {
            id: "osm-" + el.id,
            name: displayName,
            category: isStreet ? "street" : "landmark",
            lat, lng, isReal: true,
          };
          if (isStreet) streets.push(item);
          else landmarks.push(item);
        }

        realPois = [...landmarks.slice(0, 14), ...streets.slice(0, 8)].slice(0, 18);
        if (realPois.length >= 2) break;
      } catch {}
    }

    if (realPois.length < 2) {
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${center.lat}&lon=${center.lng}&accept-language=ar`,
          { signal: ctrl.signal }
        );
        clearTimeout(tm);
        if (res.ok) {
          const j = await res.json();
          const addr = j.address || {};
          const road = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood;
          if (road) {
            realPois.push({
              id: "nom-center",
              name: /^(شارع|طريق|ميدان|حي)/.test(road) ? road : `شارع ${road}`,
              category: "street",
              lat: center.lat, lng: center.lng, isReal: true,
            });
          }
        }
      } catch {}
    }

    if (realPois.length >= 2) {
      K.state.createForm.pois = realPois;
      K.state.createForm.poiSource = `معالم حقيقية (${realPois.length}) 🗺️`;
      if (applyToActiveEngine && K.state.engine) K.state.engine.setPOIs(realPois);
    } else if (realPois.length === 1) {
      const merged = [realPois[0], ...K.Geo.generateFallbackPOIs(center, radius).slice(0, 7)];
      K.state.createForm.pois = merged;
      K.state.createForm.poiSource = "خريطة + معالم المنطقة 📍";
      if (applyToActiveEngine && K.state.engine) K.state.engine.setPOIs(merged);
    } else {
      K.state.createForm.pois = K.Geo.generateFallbackPOIs(center, radius);
      K.state.createForm.poiSource = "معالم محلية 📍";
    }

    if (K.state.route === "create") {
      updateLayers();
      K.UI.updateHudOnly();
    } else if (applyToActiveEngine && (K.state.route === "game" || K.state.route === "simulation")) {
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
      <defs>
        <pattern id="rgrid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(0,212,255,0.1)" stroke-width="1"/>
        </pattern>
        <radialGradient id="radarBeam" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stop-color="#00D4FF" stop-opacity="0.65" />
          <stop offset="100%" stop-color="#00D4FF" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="700" fill="#05070B"/>
      <rect width="400" height="700" fill="url(#rgrid)"/>
    `;

    if (st.route === "create") {
      const z = proj(st.createForm.center);
      shapes += `<circle cx="${z.x}" cy="${z.y}" r="${st.createForm.radius * scale}" fill="rgba(110,21,23,0.28)" stroke="#FF2E54" stroke-width="2.5"/>`;
      st.createForm.pois.forEach((p) => {
        const pt = proj(p);
        shapes += `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="#F8FAFC" stroke="#6E1517" stroke-width="2"/>`;
      });
      const me = proj(st.gps.coords);
      shapes += `<g id="radar-heading-cone" data-cx="${me.x}" data-cy="${me.y}" style="opacity:${heading !== null ? 1 : 0};" transform="rotate(${heading || 0} ${me.x} ${me.y})">
        <path d="M ${me.x} ${me.y} L ${me.x - 18} ${me.y - 36} A 40 40 0 0 1 ${me.x + 18} ${me.y - 36} Z" fill="url(#radarBeam)"/>
      </g>`;
      shapes += `<circle cx="${me.x}" cy="${me.y}" r="8" fill="#00D4FF" stroke="#FFFFFF" stroke-width="2.5"/>`;
    } else if (st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isSpread = vis.phase === "SPREAD";
      const z = proj(vis.zone.center);
      const nz = proj(vis.zone.nextCenter);
      shapes += `<circle cx="${z.x}" cy="${z.y}" r="${vis.zone.currentRadiusMeters * scale}" fill="rgba(110,21,23,0.2)" stroke="#FF2E54" stroke-width="2.5"/>`;
      shapes += `<circle cx="${nz.x}" cy="${nz.y}" r="${vis.zone.nextRadiusMeters * scale}" fill="none" stroke="#FFB020" stroke-width="1.8" stroke-dasharray="6,6"/>`;

      const sc = proj(vis.self.coords);
      if (!isSpread) {
        const act = vis.missions.find((m) => m.status === "in_progress");
        if (act) {
          const mp = proj({ lat: act.poi.lat, lng: act.poi.lng });
          shapes += `<line x1="${sc.x}" y1="${sc.y}" x2="${mp.x}" y2="${mp.y}" stroke="#FFB020" stroke-width="3.5" stroke-dasharray="8,8"/>`;
        }
        vis.missions.forEach((m) => {
          const pt = proj({ lat: m.poi.lat, lng: m.poi.lng });
          const isAct = act && act.id === m.id;
          shapes += `<circle cx="${pt.x}" cy="${pt.y}" r="${isAct ? 8 : 5.5}" fill="${m.status === "completed" ? "#10B981" : "#FFFFFF"}" stroke="${isAct ? "#FFB020" : "#6E1517"}" stroke-width="2.5"/>`;
          if (isAct) shapes += `<text x="${pt.x}" y="${pt.y - 12}" text-anchor="middle" fill="#FFB020" font-size="11" font-weight="800">${K.escHtml(m.poi.name)}</text>`;
        });
        if (vis.activeAirdrop) {
          const ad = proj(vis.activeAirdrop.coords);
          shapes += `<circle cx="${ad.x}" cy="${ad.y}" r="10" fill="#FFB020" stroke="#fff" stroke-width="2.5"/>`;
          shapes += `<text x="${ad.x}" y="${ad.y - 14}" text-anchor="middle" fill="#FDE68A" font-size="11" font-weight="900">💼 إمداد</text>`;
        }
        if (vis.decoyPing) {
          const dp = proj(vis.decoyPing.coords);
          shapes += `<circle cx="${dp.x}" cy="${dp.y}" r="11" fill="rgba(255,46,84,0.45)" stroke="#FF2E54" stroke-width="2.5"/>`;
        }
        vis.bodies.filter((b) => !b.reported).forEach((b) => {
          const bp = proj(b.coords);
          shapes += `<circle cx="${bp.x}" cy="${bp.y}" r="9" fill="#FF2E54" stroke="#fff" stroke-width="2"/>`;
        });
        vis.players.filter((p) => p.coords && p.alive && p.id !== vis.self.id).forEach((p) => {
          const pt = proj(p.coords);
          shapes += `<circle cx="${pt.x}" cy="${pt.y}" r="7.5" fill="${p.isRedBrokerBroadcast ? "#FF2E54" : "#00D4FF"}" stroke="#fff" stroke-width="2"/>`;
        });
      }
      const selfColor = !vis.self.alive ? "#64748B" : (vis.self.role === "IMPOSTER" ? "#FF2E54" : "#00D4FF");
      shapes += `<g id="radar-heading-cone" data-cx="${sc.x}" data-cy="${sc.y}" style="opacity:${heading !== null ? 1 : 0};" transform="rotate(${heading || 0} ${sc.x} ${sc.y})">
        <path d="M ${sc.x} ${sc.y} L ${sc.x - 18} ${sc.y - 36} A 40 40 0 0 1 ${sc.x + 18} ${sc.y - 36} Z" fill="${selfColor}" opacity="0.38"/>
        <polygon points="${sc.x},${sc.y - 28} ${sc.x - 5},${sc.y - 19} ${sc.x + 5},${sc.y - 19}" fill="#FFFFFF"/>
      </g>`;
      shapes += `<circle cx="${sc.x}" cy="${sc.y}" r="9.5" fill="${selfColor}" stroke="#FFFFFF" stroke-width="3"/>`;
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
    const src = map.getSource("kameen-zone-src");
    if (!src) return;

    const worldOuter = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    const holeCW = createCircleRing(center, radiusMeters, 72, true);
    const borderCCW = createCircleRing(center, radiusMeters, 72, false);

    const features = [
      {
        type: "Feature",
        properties: { kind: "storm" },
        geometry: { type: "Polygon", coordinates: [worldOuter, holeCW] },
      },
      {
        type: "Feature",
        properties: { kind: "safe_border" },
        geometry: { type: "LineString", coordinates: borderCCW },
      },
    ];

    if (nextCenter && nextRadiusMeters) {
      features.push({
        type: "Feature",
        properties: { kind: "next_zone" },
        geometry: { type: "LineString", coordinates: createCircleRing(nextCenter, nextRadiusMeters, 64, false) },
      });
    }

    src.setData({ type: "FeatureCollection", features });
  }

  function setRouteGeoJson(fromCoords, toCoords) {
    const map = K.state.glMap;
    if (!map || !styleReady) return;
    const src = map.getSource("kameen-route-src");
    if (!src) return;
    if (!fromCoords || !toCoords) {
      src.setData(emptyFC());
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [[fromCoords.lng, fromCoords.lat], [toCoords.lng, toCoords.lat]],
        },
      }],
    });
  }

  function updateLayers() {
    const st = K.state;
    if (st.mapStyle === "radar" || typeof window.maplibregl === "undefined") {
      renderFallbackRadar();
      return;
    }
    if (!st.glMap) return;

    if (lastRouteRendered !== st.route) {
      clearMapRegistry();
      lastRouteRendered = st.route;
    }

    // --- CREATE ZONE MODE ---
    if (st.route === "create") {
      const f = st.createForm;
      setZoneGeoJson(f.center, f.radius, null, null);
      setRouteGeoJson(null, null);

      if (!reg.centerPin) {
        reg.centerPin = new window.maplibregl.Marker({
          element: makePinElement("kpin-center", "", "مركز الزون 📍", "red"),
          anchor: "bottom",
        }).setLngLat([f.center.lng, f.center.lat]).addTo(st.glMap);
      } else {
        reg.centerPin.setLngLat([f.center.lng, f.center.lat]);
      }

      syncKeyedMarkers(
        reg.createPois,
        f.pois.slice(0, 12).map((p) => ({ key: p.id + "|" + p.name, ...p })),
        (p) => new window.maplibregl.Marker({
          element: makePinElement("kpin-mission", "", p.name),
          anchor: "bottom",
        }).setLngLat([p.lng, p.lat]),
        (mk, p) => mk.setLngLat([p.lng, p.lat])
      );

      updateSelfMarkerOnMap(st.gps.coords, "#00D4FF", false);
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const isSpread = vis.phase === "SPREAD";

    setZoneGeoJson(vis.zone.center, vis.zone.currentRadiusMeters, vis.zone.nextCenter, vis.zone.nextRadiusMeters);

    if (isSpread) {
      setRouteGeoJson(null, null);
      syncKeyedMarkers(reg.missions, [], () => null, () => {});
      syncKeyedMarkers(reg.landmarks, [], () => null, () => {});
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
          const lbl = isAct ? m.poi.name : (m.status === "completed" ? "" : m.poi.name);
          const tone = isAct ? "gold" : "";
          return new window.maplibregl.Marker({
            element: makePinElement(cls, ico, lbl, tone),
            anchor: "bottom",
          }).setLngLat([m.poi.lng, m.poi.lat]);
        },
        (mk, { m }) => mk.setLngLat([m.poi.lng, m.poi.lat])
      );

      const lmItems = (vis.landmarks || [])
        .filter((lm) => !vis.missions.some((m) => m.poi.name === lm.name))
        .slice(0, 6)
        .map((lm) => ({ key: lm.id + "|" + lm.name, ...lm }));
      syncKeyedMarkers(
        reg.landmarks,
        lmItems,
        (lm) => new window.maplibregl.Marker({
          element: makePinElement("kpin-landmark", "", lm.name, "cyan"),
          anchor: "bottom",
        }).setLngLat([lm.lng, lm.lat]),
        (mk, lm) => mk.setLngLat([lm.lng, lm.lat])
      );

      if (activeMission) {
        setRouteGeoJson(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng });
      } else {
        setRouteGeoJson(null, null);
      }

      if (vis.activeAirdrop) {
        if (!reg.airdrop) {
          reg.airdrop = new window.maplibregl.Marker({
            element: makePinElement("kpin-airdrop", "💼", "شنطة إمداد (+45ن)", "gold"),
            anchor: "bottom",
          }).setLngLat([vis.activeAirdrop.coords.lng, vis.activeAirdrop.coords.lat]).addTo(st.glMap);
        } else {
          reg.airdrop.setLngLat([vis.activeAirdrop.coords.lng, vis.activeAirdrop.coords.lat]);
        }
      } else if (reg.airdrop) {
        reg.airdrop.remove();
        reg.airdrop = null;
      }

      if (vis.decoyPing) {
        if (!reg.decoy) {
          reg.decoy = new window.maplibregl.Marker({
            element: makePinElement("kpin-body", "!", "⚠️ إشارة مشبوهة", "red"),
            anchor: "bottom",
          }).setLngLat([vis.decoyPing.coords.lng, vis.decoyPing.coords.lat]).addTo(st.glMap);
        } else {
          reg.decoy.setLngLat([vis.decoyPing.coords.lng, vis.decoyPing.coords.lat]);
        }
      } else if (reg.decoy) {
        reg.decoy.remove();
        reg.decoy = null;
      }

      const bodyItems = vis.bodies.filter((b) => !b.reported).map((b) => ({ key: b.id, ...b }));
      syncKeyedMarkers(
        reg.bodies,
        bodyItems,
        (b) => new window.maplibregl.Marker({
          element: makePinElement("kpin-body", "💀", "جثة: " + b.victimName, "red"),
          anchor: "bottom",
        }).setLngLat([b.coords.lng, b.coords.lat]),
        (mk, b) => mk.setLngLat([b.coords.lng, b.coords.lat])
      );

      const pItems = vis.players
        .filter((p) => p.coords && p.alive && p.id !== vis.self.id)
        .map((p) => ({ key: `${p.id}|${p.isRedBrokerBroadcast ? 1 : 0}`, ...p }));
      syncKeyedMarkers(
        reg.players,
        pItems,
        (p) => new window.maplibregl.Marker({
          element: makePinElement(
            p.isRedBrokerBroadcast ? "kpin-player broker" : "kpin-player",
            "",
            p.name + (p.isRedBrokerBroadcast ? " 🔴" : ""),
            p.isRedBrokerBroadcast ? "red" : "cyan"
          ),
          anchor: "bottom",
        }).setLngLat([p.coords.lng, p.coords.lat]),
        (mk, p) => mk.setLngLat([p.coords.lng, p.coords.lat])
      );
    }

    const isImp = vis.self.role === "IMPOSTER";
    const selfColor = !vis.self.alive ? "#64748B" : (isImp ? "#FF2E54" : "#00D4FF");
    updateSelfMarkerOnMap(vis.self.coords, selfColor, isImp);
  }

  K.Map = {
    applyTileLayer,
    cycleStyle,
    toggle3D,
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
