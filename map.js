"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
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
      url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    }

    st.tileErrorCount = 0;
    st.baseTileLayer = window.L.tileLayer(url, { maxZoom: 19 }).addTo(st.leafletMap);
    st.baseTileLayer.on("tileerror", () => {
      st.tileErrorCount += 1;
      if (st.tileErrorCount >= 5 && st.mapStyle !== "radar") {
        st.mapStyle = "radar";
        applyTileLayer();
        K.showToast("📡 النت تقيل شوية — حولنا على الرادار التكتيكي!");
      }
    });

    if (st.mapStyle === "satellite") {
      st.labelsTileLayer = window.L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.85 }
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

  function initPersistentMap(center) {
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
      return;
    }

    const map = window.L.map(el, {
      center: [center.lat, center.lng],
      zoom: 18,
      zoomControl: false,
      attributionControl: false,
    });

    map.on("click", (e) => {
      K.App.handleMapTap({ lat: e.latlng.lat, lng: e.latlng.lng, accuracyMeters: 5 });
    });

    st.leafletGroup = window.L.layerGroup().addTo(map);
    st.leafletSelfGroup = window.L.layerGroup().addTo(map);
    st.leafletMap = map;
    applyTileLayer();
    setTimeout(() => map.invalidateSize(true), 150);
  }

  function recenter() {
    const st = K.state;
    const c = st.route === "create"
      ? st.createForm.center
      : (st.engine ? st.engine.getVisibleStateForPlayer(st.user.id).self.coords : st.gps.coords);
    if (st.leafletMap) {
      st.leafletMap.invalidateSize(true);
      st.leafletMap.setView([c.lat, c.lng], 18, { animate: true });
    }
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
          <polygon points="34,7 29,17 39,17" fill="#FFFFFF" opacity="0.92" />
        </svg>
        <div class="self-core-dot ${isImp ? "imposter" : ""}" style="background:${colorHex};"></div>
      </div>
    `;
    return window.L.divIcon({
      className: "self-marker-wrap",
      html,
      iconSize: [68, 68],
      iconAnchor: [34, 34],
    });
  }

  // Ultra-fast heading rotation without rebuilding Leaflet layers
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

  function updateSelfMarkerOnMap(coords, colorHex, isImp, label) {
    const st = K.state;
    if (!st.leafletMap || !st.leafletSelfGroup) return;
    const acc = coords.accuracyMeters || st.gps.accuracy || 10;

    if (!st.selfAccuracyCircle) {
      st.selfAccuracyCircle = window.L.circle([coords.lat, coords.lng], {
        radius: Math.min(acc, 80),
        color: colorHex,
        weight: 1,
        fillColor: colorHex,
        fillOpacity: 0.12,
      }).addTo(st.leafletSelfGroup);
    } else {
      st.selfAccuracyCircle.setLatLng([coords.lat, coords.lng]);
      st.selfAccuracyCircle.setRadius(Math.min(acc, 80));
      st.selfAccuracyCircle.setStyle({ color: colorHex, fillColor: colorHex });
    }

    const colorKey = colorHex + (isImp ? "_1" : "_0");
    if (!st.selfMarker) {
      st.selfMarker = window.L.marker([coords.lat, coords.lng], {
        icon: buildSelfMarkerIcon(colorHex, isImp, st.gps.heading),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(st.leafletSelfGroup);
      st.selfMarkerColorKey = colorKey;
    } else {
      st.selfMarker.setLatLng([coords.lat, coords.lng]);
      if (st.selfMarkerColorKey !== colorKey) {
        st.selfMarker.setIcon(buildSelfMarkerIcon(colorHex, isImp, st.gps.heading));
        st.selfMarkerColorKey = colorKey;
      } else {
        updateHeadingVisualOnly();
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
            lat,
            lng,
            isReal: true,
          };
          if (isStreet) streets.push(item);
          else landmarks.push(item);
        }

        // Prioritize real landmarks (mosques, shops, cafes, parks) first, then fill with real street names
        realPois = [...landmarks.slice(0, 14), ...streets.slice(0, 8)].slice(0, 18);
        if (realPois.length >= 2) break;
      } catch {}
    }

    // Secondary backup: Nominatim reverse geocode for the exact street/neighborhood name
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
              lat: center.lat,
              lng: center.lng,
              isReal: true,
            });
          }
        }
      } catch {}
    }

    if (realPois.length >= 2) {
      K.state.createForm.pois = realPois;
      K.state.createForm.poiSource = `معالم حقيقية (${realPois.length}) 🗺️`;
      if (applyToActiveEngine && K.state.engine) {
        K.state.engine.setPOIs(realPois);
      }
    } else if (realPois.length === 1) {
      const merged = [realPois[0], ...K.Geo.generateFallbackPOIs(center, radius).slice(0, 7)];
      K.state.createForm.pois = merged;
      K.state.createForm.poiSource = "خريطة + معالم المنطقة 📍";
      if (applyToActiveEngine && K.state.engine) {
        K.state.engine.setPOIs(merged);
      }
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

  function updateLayers() {
    const st = K.state;
    if (st.mapStyle === "radar" || typeof window.L === "undefined") {
      renderFallbackRadar();
      return;
    }
    if (!st.leafletMap || !st.leafletGroup) return;
    const g = st.leafletGroup;
    g.clearLayers();

    if (st.route === "create") {
      const f = st.createForm;
      window.L.circle([f.center.lat, f.center.lng], {
        radius: f.radius, color: "#FF2E54", weight: 2.5, fillColor: "#6E1517", fillOpacity: 0.22,
      }).addTo(g);
      window.L.circleMarker([f.center.lat, f.center.lng], {
        radius: 7, color: "#fff", weight: 2.5, fillColor: "#FF2E54", fillOpacity: 1,
      }).bindTooltip("مركز الزون 📍").addTo(g);
      f.pois.forEach((p) => {
        window.L.circleMarker([p.lat, p.lng], {
          radius: 5.5, color: "#6E1517", weight: 2, fillColor: "#F8FAFC", fillOpacity: 1,
        }).bindTooltip(p.name).addTo(g);
      });
      updateSelfMarkerOnMap(st.gps.coords, "#00D4FF", false, "موقعك");
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const isSpread = vis.phase === "SPREAD";

    window.L.circle([vis.zone.center.lat, vis.zone.center.lng], {
      radius: vis.zone.currentRadiusMeters, color: "#FF2E54", weight: 2.5, fillColor: "#6E1517", fillOpacity: 0.14,
    }).addTo(g);

    window.L.circle([vis.zone.nextCenter.lat, vis.zone.nextCenter.lng], {
      radius: vis.zone.nextRadiusMeters, color: "#FFB020", weight: 2, dashArray: "7,7", fillOpacity: 0,
    }).addTo(g);

    if (!isSpread) {
      const activeMission = vis.missions.find((m) => m.status === "in_progress");
      vis.missions.forEach((m) => {
        const isAct = activeMission && activeMission.id === m.id;
        window.L.circleMarker([m.poi.lat, m.poi.lng], {
          radius: isAct ? 9 : 6,
          color: isAct ? "#FFB020" : "#6E1517",
          weight: 2.5,
          fillColor: m.status === "completed" ? "#10B981" : "#FFFFFF",
          fillOpacity: 1,
        }).bindTooltip(m.poi.name, { permanent: Boolean(isAct), direction: "top" }).addTo(g);
      });

      // Show subtle map pins for real nearby places so players recognize AI hints!
      (vis.landmarks || []).forEach((lm) => {
        const isMissionPoi = vis.missions.some((m) => m.poi.name === lm.name);
        if (isMissionPoi) return;
        window.L.circleMarker([lm.lat, lm.lng], {
          radius: 4,
          color: "rgba(0,212,255,0.65)",
          weight: 1.5,
          fillColor: "#0B101B",
          fillOpacity: 0.85,
        }).bindTooltip("📍 " + lm.name, { direction: "top" }).addTo(g);
      });

      if (activeMission) {
        window.L.polyline([
          [vis.self.coords.lat, vis.self.coords.lng],
          [activeMission.poi.lat, activeMission.poi.lng],
        ], { color: "#FFB020", weight: 4, dashArray: "8,8" }).addTo(g);
      }

      if (vis.activeAirdrop) {
        window.L.circleMarker([vis.activeAirdrop.coords.lat, vis.activeAirdrop.coords.lng], {
          radius: 12, color: "#fff", weight: 2.5, fillColor: "#FFB020", fillOpacity: 0.95,
        }).bindTooltip("💼 شنطة إمداد (+45ن)", { permanent: true, direction: "top" }).addTo(g);
      }

      if (vis.decoyPing) {
        window.L.circleMarker([vis.decoyPing.coords.lat, vis.decoyPing.coords.lng], {
          radius: 12, color: "#fff", weight: 2.5, fillColor: "#FF2E54", fillOpacity: 0.92,
        }).bindTooltip("⚠️ إشارة مشبوهة!", { permanent: true, direction: "top" }).addTo(g);
      }

      vis.bodies.filter((b) => !b.reported).forEach((b) => {
        window.L.circleMarker([b.coords.lat, b.coords.lng], {
          radius: 10, color: "#fff", weight: 2.5, fillColor: "#FF2E54", fillOpacity: 0.95,
        }).bindTooltip("💀 جثة: " + b.victimName, { permanent: true, direction: "top" }).addTo(g);
      });

      vis.players.filter((p) => p.coords && p.alive && p.id !== vis.self.id).forEach((p) => {
        window.L.circleMarker([p.coords.lat, p.coords.lng], {
          radius: p.isRedBrokerBroadcast ? 11 : 7.5,
          color: "#FFFFFF",
          weight: 2.5,
          fillColor: p.isRedBrokerBroadcast ? "#FF2E54" : (p.role === "IMPOSTER" ? "#FFB020" : "#00D4FF"),
          fillOpacity: 1,
        }).bindTooltip(p.name + (p.isRedBrokerBroadcast ? " (سمسار 🔴)" : "")).addTo(g);
      });
    }

    const isImp = vis.self.role === "IMPOSTER";
    const selfColor = !vis.self.alive ? "#64748B" : (isImp ? "#FF2E54" : "#00D4FF");
    updateSelfMarkerOnMap(vis.self.coords, selfColor, isImp, vis.self.alive ? "أنت هنا 📍" : "أنت (شبح 👻)");
  }

  K.Map = {
    applyTileLayer,
    cycleStyle,
    initPersistentMap,
    recenter,
    fetchOverpassPOIs,
    updateLayers,
    updateHeadingVisualOnly,
  };
})(window.Kameen);
