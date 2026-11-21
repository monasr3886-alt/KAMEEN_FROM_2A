"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  // Persistent keyed marker registries (NEVER call clearLayers() every second!)
  const reg = {
    zoneCircle: null,
    nextZoneCircle: null,
    routeLine: null,
    centerPin: null,
    createPois: new Map(),
    missions: new Map(),
    landmarks: new Map(),
    players: new Map(),
    bodies: new Map(),
    airdrop: null,
    decoy: null,
  };

  // Smooth rAF animator for self dot (Google Maps-style glide without breaking Leaflet zoom!)
  const selfAnim = {
    curLat: null, curLng: null,
    tgtLat: null, tgtLng: null,
    rafId: null,
  };

  function makePinIcon(cls, size, htmlInner = "") {
    return window.L.divIcon({
      className: "kpin-wrap",
      html: `<div class="kpin ${cls}">${htmlInner}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function clearMapRegistry() {
    const st = K.state;
    const g = st.leafletGroup;
    if (!g) return;
    if (reg.zoneCircle) { g.removeLayer(reg.zoneCircle); reg.zoneCircle = null; }
    if (reg.nextZoneCircle) { g.removeLayer(reg.nextZoneCircle); reg.nextZoneCircle = null; }
    if (reg.routeLine) { g.removeLayer(reg.routeLine); reg.routeLine = null; }
    if (reg.centerPin) { g.removeLayer(reg.centerPin); reg.centerPin = null; }
    if (reg.airdrop) { g.removeLayer(reg.airdrop); reg.airdrop = null; }
    if (reg.decoy) { g.removeLayer(reg.decoy); reg.decoy = null; }
    for (const m of [reg.createPois, reg.missions, reg.landmarks, reg.players, reg.bodies]) {
      for (const layer of m.values()) g.removeLayer(layer);
      m.clear();
    }
  }

  function syncKeyedMarkers(mapObj, items, buildFn, updateFn) {
    const g = K.state.leafletGroup;
    if (!g) return;
    const activeKeys = new Set();
    for (const item of items) {
      activeKeys.add(item.key);
      const existing = mapObj.get(item.key);
      if (!existing) {
        const mk = buildFn(item);
        mk.addTo(g);
        mapObj.set(item.key, mk);
      } else {
        updateFn(existing, item);
      }
    }
    for (const [k, mk] of mapObj.entries()) {
      if (!activeKeys.has(k)) {
        g.removeLayer(mk);
        mapObj.delete(k);
      }
    }
  }

  function applyTileLayer() {
    const st = K.state;
    const radarEl = document.getElementById("fallback-radar");
    const leafEl = document.getElementById("persistent-leaflet-map");
    if (!radarEl || !leafEl) return;

    if (st.mapStyle === "radar" || typeof window.L === "undefined") {
      radarEl.classList.remove("hidden");
      leafEl.classList.add("hidden");
      renderFallbackRadar();
      return;
    }

    radarEl.classList.add("hidden");
    leafEl.classList.remove("hidden");
    if (!st.leafletMap) return;

    if (st.baseTileLayer) st.leafletMap.removeLayer(st.baseTileLayer);
    if (st.labelsTileLayer) st.leafletMap.removeLayer(st.labelsTileLayer);

    let url = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    if (st.mapStyle === "satellite") {
      url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    } else if (st.mapStyle === "street") {
      url = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    }

    st.tileErrorCount = 0;
    st.baseTileLayer = window.L.tileLayer(url, {
      maxNativeZoom: 19,
      maxZoom: 20,
      keepBuffer: 4,
    }).addTo(st.leafletMap);

    st.baseTileLayer.on("tileerror", () => {
      st.tileErrorCount += 1;
      if (st.tileErrorCount >= 6 && st.mapStyle !== "radar") {
        st.mapStyle = "radar";
        applyTileLayer();
        K.showToast("📡 النت تقيل شوية — حولنا على الرادار التكتيكي!");
      }
    });

    if (st.mapStyle === "satellite") {
      st.labelsTileLayer = window.L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 19, maxZoom: 20, opacity: 0.85 }
      ).addTo(st.leafletMap);
    }
  }

  function cycleStyle() {
    const order = ["dark", "satellite", "street", "radar"];
    K.state.mapStyle = order[(order.indexOf(K.state.mapStyle) + 1) % order.length];
    K.SFX.play("click");
    applyTileLayer();
    updateLayers();
    K.UI.updateHudOnly();
  }

  function initPersistentMap(center, forceCenter = false) {
    const st = K.state;
    const el = document.getElementById("persistent-leaflet-map");
    if (!el) return;
    void el.offsetHeight;

    if (typeof window.L === "undefined") {
      st.mapStyle = "radar";
      applyTileLayer();
      return;
    }

    if (st.leafletMap) {
      st.leafletMap.invalidateSize(true);
      if (forceCenter && center) {
        st.leafletMap.setView([center.lat, center.lng], Math.max(st.leafletMap.getZoom(), 17), { animate: false });
      }
      return;
    }

    const map = window.L.map(el, {
      center: [center.lat, center.lng],
      zoom: 18,
      minZoom: 12,
      maxZoom: 20,
      zoomControl: false,
      attributionControl: false,
      tapTolerance: 15,
    });

    // Lock out layer mutations during pinch-zoom so markers NEVER shift!
    map.on("zoomstart", () => { st.mapZooming = true; });
    map.on("zoomend", () => {
      st.mapZooming = false;
      updateLayers();
    });

    // Dragging pauses auto-follow (exact Google Maps behavior); tapping 📍 re-locks it
    map.on("dragstart", () => {
      if (st.mapFollowMe) {
        st.mapFollowMe = false;
        const fab = document.getElementById("follow-gps-fab");
        if (fab) fab.classList.remove("active-fab");
      }
    });

    map.on("click", (e) => {
      if (st.mapZooming) return;
      K.App.handleMapTap({ lat: e.latlng.lat, lng: e.latlng.lng, accuracyMeters: 5 });
    });

    st.leafletGroup = window.L.layerGroup().addTo(map);
    st.leafletSelfGroup = window.L.layerGroup().addTo(map);
    st.leafletMap = map;
    applyTileLayer();
    setTimeout(() => map.invalidateSize(true), 180);
  }

  function recenter() {
    const st = K.state;
    st.mapFollowMe = true;
    // In simulation mode, tapping 📍 also re-enables real live GPS if available
    if (st.route === "simulation" && st.gps.hasRealFix) {
      st.simUseRealGps = true;
      K.showToast("📍 الكاميرا والـ GPS الحقيقي شغالين مع حركتك!");
    }
    const c = st.route === "create"
      ? (st.gps.hasRealFix ? st.gps.coords : st.createForm.center)
      : (st.engine ? st.engine.getVisibleStateForPlayer(st.user.id).self.coords : st.gps.coords);
    if (st.leafletMap) {
      st.leafletMap.invalidateSize(true);
      st.leafletMap.setView([c.lat, c.lng], Math.max(st.leafletMap.getZoom(), 18), { animate: true });
    }
    const fab = document.getElementById("follow-gps-fab");
    if (fab) fab.classList.add("active-fab");
  }

  function buildSelfMarkerIcon(colorHex, isImp, headingDeg) {
    const hasHeading = typeof headingDeg === "number" && Number.isFinite(headingDeg);
    const deg = hasHeading ? Math.round(headingDeg) : 0;
    const coneOpacity = hasHeading ? 1 : 0;
    const gradId = isImp ? "coneGradImp" : "coneGradInv";
    const html = `
      <div class="self-marker-box">
        <svg class="self-heading-cone" id="live-heading-cone" viewBox="0 0 68 68" width="68" height="68"
          style="opacity:${coneOpacity};transform:rotate(${deg}deg);">
          <defs>
            <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="${colorHex}" stop-opacity="0.72" />
              <stop offset="100%" stop-color="${colorHex}" stop-opacity="0" />
            </radialGradient>
          </defs>
          <path d="M 34 34 L 15 5 A 34 34 0 0 1 53 5 Z" fill="url(#${gradId})" />
          <polygon points="34,7 29,17 39,17" fill="#FFFFFF" opacity="0.95" />
        </svg>
        <div class="self-core-dot pulse-gps ${isImp ? "imposter" : ""}" style="background:${colorHex};"></div>
      </div>
    `;
    return window.L.divIcon({
      className: "self-marker-wrap",
      html,
      iconSize: [68, 68],
      iconAnchor: [34, 34],
    });
  }

  function updateHeadingVisualOnly() {
    const st = K.state;
    const deg = st.gps.heading;
    if (typeof deg !== "number" || !Number.isFinite(deg)) return;

    const cone = document.getElementById("live-heading-cone");
    if (cone) {
      cone.style.opacity = "1";
      cone.style.transform = `rotate(${Math.round(deg)}deg)`;
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
    if (!st.selfMarker || st.mapZooming) {
      selfAnim.rafId = null;
      return;
    }
    const dLat = selfAnim.tgtLat - selfAnim.curLat;
    const dLng = selfAnim.tgtLng - selfAnim.curLng;
    // Snap when within ~0.15m
    if (Math.abs(dLat) < 0.0000015 && Math.abs(dLng) < 0.0000015) {
      selfAnim.curLat = selfAnim.tgtLat;
      selfAnim.curLng = selfAnim.tgtLng;
      st.selfMarker.setLatLng([selfAnim.curLat, selfAnim.curLng]);
      if (st.selfAccuracyCircle) st.selfAccuracyCircle.setLatLng([selfAnim.curLat, selfAnim.curLng]);
      selfAnim.rafId = null;
      return;
    }
    selfAnim.curLat += dLat * 0.28;
    selfAnim.curLng += dLng * 0.28;
    st.selfMarker.setLatLng([selfAnim.curLat, selfAnim.curLng]);
    if (st.selfAccuracyCircle) st.selfAccuracyCircle.setLatLng([selfAnim.curLat, selfAnim.curLng]);
    selfAnim.rafId = requestAnimationFrame(stepSelfGlide);
  }

  function updateSelfMarkerOnMap(coords, colorHex, isImp) {
    const st = K.state;
    if (!st.leafletMap || !st.leafletSelfGroup || st.mapZooming) return;
    const acc = Math.max(4, Math.min(coords.accuracyMeters || st.gps.accuracy || 10, 120));

    if (!st.selfAccuracyCircle) {
      st.selfAccuracyCircle = window.L.circle([coords.lat, coords.lng], {
        radius: acc,
        color: colorHex,
        weight: 1.2,
        fillColor: colorHex,
        fillOpacity: 0.13,
        interactive: false,
      }).addTo(st.leafletSelfGroup);
    } else {
      st.selfAccuracyCircle.setRadius(acc);
      st.selfAccuracyCircle.setStyle({ color: colorHex, fillColor: colorHex });
    }

    const colorKey = colorHex + (isImp ? "_1" : "_0");
    if (!st.selfMarker) {
      selfAnim.curLat = coords.lat;
      selfAnim.curLng = coords.lng;
      selfAnim.tgtLat = coords.lat;
      selfAnim.tgtLng = coords.lng;
      st.selfMarker = window.L.marker([coords.lat, coords.lng], {
        icon: buildSelfMarkerIcon(colorHex, isImp, st.gps.heading),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(st.leafletSelfGroup);
      st.selfMarkerColorKey = colorKey;
    } else {
      const jumpDist = K.Geo.distanceMeters(
        { lat: selfAnim.curLat ?? coords.lat, lng: selfAnim.curLng ?? coords.lng },
        coords
      );
      selfAnim.tgtLat = coords.lat;
      selfAnim.tgtLng = coords.lng;
      // Instant snap for large jumps (>60m, e.g. initial GPS lock or teleport), smooth glide for walking!
      if (jumpDist > 60 || selfAnim.curLat === null) {
        selfAnim.curLat = coords.lat;
        selfAnim.curLng = coords.lng;
        st.selfMarker.setLatLng([coords.lat, coords.lng]);
        st.selfAccuracyCircle.setLatLng([coords.lat, coords.lng]);
      } else if (!selfAnim.rafId) {
        selfAnim.rafId = requestAnimationFrame(stepSelfGlide);
      }

      if (st.selfMarkerColorKey !== colorKey) {
        st.selfMarker.setIcon(buildSelfMarkerIcon(colorHex, isImp, st.gps.heading));
        st.selfMarkerColorKey = colorKey;
      } else {
        updateHeadingVisualOnly();
      }
    }
  }

  // Called IMMEDIATELY on every GPS watchPosition event for zero-lag movement!
  function setSelfLiveCoords(coords, shouldPanIfFollowing = true) {
    const st = K.state;
    if (st.mapStyle === "radar" || typeof window.L === "undefined") {
      if (st.route === "game" || st.route === "simulation" || st.route === "create") renderFallbackRadar();
      return;
    }
    if (!st.leafletMap || st.mapZooming) return;

    let colorHex = "#00D4FF";
    let isImp = false;
    if (st.engine && (st.route === "game" || st.route === "simulation")) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      isImp = vis.self.role === "IMPOSTER";
      colorHex = !vis.self.alive ? "#64748B" : (isImp ? "#FF2E54" : "#00D4FF");
    }

    updateSelfMarkerOnMap(coords, colorHex, isImp);

    // Smoothly follow the user's walking movement (Google Maps / HideZone Follow Mode)
    if (shouldPanIfFollowing && st.mapFollowMe && (st.route === "game" || st.route === "simulation")) {
      const mapCenter = st.leafletMap.getCenter();
      const driftM = K.Geo.distanceMeters({ lat: mapCenter.lat, lng: mapCenter.lng }, coords);
      if (driftM >= 3) {
        st.leafletMap.panTo([coords.lat, coords.lng], { animate: true, duration: 0.35 });
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

  let lastRouteRendered = null;

  function updateLayers() {
    const st = K.state;
    if (st.mapStyle === "radar" || typeof window.L === "undefined") {
      renderFallbackRadar();
      return;
    }
    // NEVER touch Leaflet layers while user is mid-pinch-zoom!
    if (!st.leafletMap || !st.leafletGroup || st.mapZooming) return;

    if (lastRouteRendered !== st.route) {
      clearMapRegistry();
      lastRouteRendered = st.route;
    }

    const g = st.leafletGroup;

    // --- CREATE ZONE MODE ---
    if (st.route === "create") {
      const f = st.createForm;
      if (!reg.zoneCircle) {
        reg.zoneCircle = window.L.circle([f.center.lat, f.center.lng], {
          radius: f.radius, color: "#FF2E54", weight: 2.5, fillColor: "#6E1517", fillOpacity: 0.22, interactive: false,
        }).addTo(g);
      } else {
        reg.zoneCircle.setLatLng([f.center.lat, f.center.lng]);
        reg.zoneCircle.setRadius(f.radius);
      }

      if (!reg.centerPin) {
        reg.centerPin = window.L.marker([f.center.lat, f.center.lng], {
          icon: makePinIcon("kpin-center", 16),
          interactive: false,
        }).bindTooltip("مركز الزون 📍").addTo(g);
      } else {
        reg.centerPin.setLatLng([f.center.lat, f.center.lng]);
      }

      syncKeyedMarkers(
        reg.createPois,
        f.pois.map((p) => ({ key: p.id + "|" + p.name, ...p })),
        (p) => window.L.marker([p.lat, p.lng], { icon: makePinIcon("kpin-mission", 14), interactive: true }).bindTooltip(p.name),
        (mk, p) => mk.setLatLng([p.lat, p.lng])
      );

      updateSelfMarkerOnMap(st.gps.coords, "#00D4FF", false);
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const isSpread = vis.phase === "SPREAD";

    // Zone circles (updated in-place — NEVER destroyed!)
    if (!reg.zoneCircle) {
      reg.zoneCircle = window.L.circle([vis.zone.center.lat, vis.zone.center.lng], {
        radius: vis.zone.currentRadiusMeters, color: "#FF2E54", weight: 2.5, fillColor: "#6E1517", fillOpacity: 0.14, interactive: false,
      }).addTo(g);
    } else {
      reg.zoneCircle.setLatLng([vis.zone.center.lat, vis.zone.center.lng]);
      reg.zoneCircle.setRadius(vis.zone.currentRadiusMeters);
    }

    if (!reg.nextZoneCircle) {
      reg.nextZoneCircle = window.L.circle([vis.zone.nextCenter.lat, vis.zone.nextCenter.lng], {
        radius: vis.zone.nextRadiusMeters, color: "#FFB020", weight: 2, dashArray: "7,7", fillOpacity: 0, interactive: false,
      }).addTo(g);
    } else {
      reg.nextZoneCircle.setLatLng([vis.zone.nextCenter.lat, vis.zone.nextCenter.lng]);
      reg.nextZoneCircle.setRadius(vis.zone.nextRadiusMeters);
    }

    if (isSpread) {
      syncKeyedMarkers(reg.missions, [], () => null, () => {});
      syncKeyedMarkers(reg.landmarks, [], () => null, () => {});
      syncKeyedMarkers(reg.players, [], () => null, () => {});
      syncKeyedMarkers(reg.bodies, [], () => null, () => {});
      if (reg.routeLine) { g.removeLayer(reg.routeLine); reg.routeLine = null; }
      if (reg.airdrop) { g.removeLayer(reg.airdrop); reg.airdrop = null; }
      if (reg.decoy) { g.removeLayer(reg.decoy); reg.decoy = null; }
    } else {
      const activeMission = vis.missions.find((m) => m.status === "in_progress");

      // Mission Pins (GPU-anchored divIcon markers — ZERO shift on zoom!)
      syncKeyedMarkers(
        reg.missions,
        vis.missions.map((m) => {
          const isAct = Boolean(activeMission && activeMission.id === m.id);
          return { key: `${m.id}|${m.status}|${isAct ? 1 : 0}|${m.poi.name}`, m, isAct };
        }),
        ({ m, isAct }) => {
          const cls = m.status === "completed" ? "kpin-mission done" : (isAct ? "kpin-mission active" : "kpin-mission");
          const sz = isAct ? 24 : 16;
          const ico = m.status === "completed" ? "✓" : (isAct ? "★" : "");
          return window.L.marker([m.poi.lat, m.poi.lng], { icon: makePinIcon(cls, sz, ico), zIndexOffset: isAct ? 400 : 200 })
            .bindTooltip(m.poi.name, { permanent: isAct, direction: "top", offset: [0, -10] });
        },
        (mk, { m }) => mk.setLatLng([m.poi.lat, m.poi.lng])
      );

      // Subtle Real Map Landmarks
      const lmItems = (vis.landmarks || [])
        .filter((lm) => !vis.missions.some((m) => m.poi.name === lm.name))
        .map((lm) => ({ key: lm.id + "|" + lm.name, ...lm }));
      syncKeyedMarkers(
        reg.landmarks,
        lmItems,
        (lm) => window.L.marker([lm.lat, lm.lng], { icon: makePinIcon("kpin-landmark", 10), zIndexOffset: 50 })
          .bindTooltip("📍 " + lm.name, { direction: "top" }),
        (mk, lm) => mk.setLatLng([lm.lat, lm.lng])
      );

      // Active Mission Route Polyline
      if (activeMission) {
        const pts = [[vis.self.coords.lat, vis.self.coords.lng], [activeMission.poi.lat, activeMission.poi.lng]];
        if (!reg.routeLine) {
          reg.routeLine = window.L.polyline(pts, { color: "#FFB020", weight: 4, dashArray: "8,8", interactive: false }).addTo(g);
        } else {
          reg.routeLine.setLatLngs(pts);
        }
      } else if (reg.routeLine) {
        g.removeLayer(reg.routeLine);
        reg.routeLine = null;
      }

      // Supply Drop Pin
      if (vis.activeAirdrop) {
        if (!reg.airdrop) {
          reg.airdrop = window.L.marker([vis.activeAirdrop.coords.lat, vis.activeAirdrop.coords.lng], {
            icon: makePinIcon("kpin-airdrop", 26, "💼"), zIndexOffset: 500,
          }).bindTooltip("💼 إمداد (+45ن)", { permanent: true, direction: "top", offset: [0, -12] }).addTo(g);
        } else {
          reg.airdrop.setLatLng([vis.activeAirdrop.coords.lat, vis.activeAirdrop.coords.lng]);
        }
      } else if (reg.airdrop) {
        g.removeLayer(reg.airdrop);
        reg.airdrop = null;
      }

      // Decoy Ping Pin
      if (vis.decoyPing) {
        if (!reg.decoy) {
          reg.decoy = window.L.marker([vis.decoyPing.coords.lat, vis.decoyPing.coords.lng], {
            icon: makePinIcon("kpin-body", 24, "!"), zIndexOffset: 550,
          }).bindTooltip("⚠️ إشارة مشبوهة!", { permanent: true, direction: "top", offset: [0, -10] }).addTo(g);
        } else {
          reg.decoy.setLatLng([vis.decoyPing.coords.lat, vis.decoyPing.coords.lng]);
        }
      } else if (reg.decoy) {
        g.removeLayer(reg.decoy);
        reg.decoy = null;
      }

      // Bodies Pins
      const bodyItems = vis.bodies.filter((b) => !b.reported).map((b) => ({ key: b.id, ...b }));
      syncKeyedMarkers(
        reg.bodies,
        bodyItems,
        (b) => window.L.marker([b.coords.lat, b.coords.lng], { icon: makePinIcon("kpin-body", 24, "💀"), zIndexOffset: 600 })
          .bindTooltip("💀 جثة: " + b.victimName, { permanent: true, direction: "top", offset: [0, -12] }),
        (mk, b) => mk.setLatLng([b.coords.lat, b.coords.lng])
      );

      // Other Players Pins (visible only during Radar Reveal / Broker / Ghost / Game Over)
      const pItems = vis.players
        .filter((p) => p.coords && p.alive && p.id !== vis.self.id)
        .map((p) => ({ key: `${p.id}|${p.isRedBrokerBroadcast ? 1 : 0}`, ...p }));
      syncKeyedMarkers(
        reg.players,
        pItems,
        (p) => window.L.marker([p.coords.lat, p.coords.lng], {
          icon: makePinIcon(p.isRedBrokerBroadcast ? "kpin-player broker" : "kpin-player", p.isRedBrokerBroadcast ? 22 : 17),
          zIndexOffset: 700,
        }).bindTooltip(p.name + (p.isRedBrokerBroadcast ? " (سمسار 🔴)" : ""), { direction: "top" }),
        (mk, p) => mk.setLatLng([p.coords.lat, p.coords.lng])
      );
    }

    const isImp = vis.self.role === "IMPOSTER";
    const selfColor = !vis.self.alive ? "#64748B" : (isImp ? "#FF2E54" : "#00D4FF");
    updateSelfMarkerOnMap(vis.self.coords, selfColor, isImp);
  }

  K.Map = {
    applyTileLayer,
    cycleStyle,
    initPersistentMap,
    recenter,
    fetchOverpassPOIs,
    updateLayers,
    updateHeadingVisualOnly,
    setSelfLiveCoords,
  };
})(window.Kameen);
