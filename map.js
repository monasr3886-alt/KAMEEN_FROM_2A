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
      zoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    map.on("click", (e) => {
      K.App.handleMapTap({ lat: e.latlng.lat, lng: e.latlng.lng, accuracyMeters: 5 });
    });

    st.leafletGroup = window.L.layerGroup().addTo(map);
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
      st.leafletMap.setView([c.lat, c.lng], 17, { animate: true });
    }
  }

  async function fetchOverpassPOIs(center, radius) {
    const query = `[out:json][timeout:6];(node["leisure"~"park|playground"](around:${radius},${center.lat},${center.lng});node["amenity"~"cafe|place_of_worship|bench|pharmacy"](around:${radius},${center.lat},${center.lng});node["shop"](around:${radius},${center.lat},${center.lng}););out 25;`;
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const pois = (data.elements || [])
        .filter((el) => el.lat && el.lon && (!el.tags || el.tags.access !== "private"))
        .slice(0, 14)
        .map((el) => ({
          id: "osm-" + el.id,
          name: (el.tags && (el.tags["name:ar"] || el.tags.name)) || "نقطة في الحي",
          category: "landmark",
          lat: el.lat,
          lng: el.lon,
        }));
      if (pois.length >= 3) {
        K.state.createForm.pois = pois;
        K.state.createForm.poiSource = "خريطة حقيقية 🗺️";
      } else {
        throw new Error("few");
      }
    } catch {
      K.state.createForm.pois = K.Geo.generateFallbackPOIs(center, radius);
      K.state.createForm.poiSource = "نقاط ذكية 📍";
    }
    if (K.state.route === "create") {
      updateLayers();
      K.UI.updateHudOnly();
    }
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

    let shapes = `
      <defs>
        <pattern id="rgrid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(0,212,255,0.1)" stroke-width="1"/>
        </pattern>
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
      shapes += `<circle cx="${sc.x}" cy="${sc.y}" r="9.5" fill="${vis.self.role === "IMPOSTER" ? "#FF2E54" : "#00D4FF"}" stroke="#FFFFFF" stroke-width="3"/>`;
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

    // STRICT GUARD: Only render missions, airdrops, bodies, decoys, and other players AFTER spread!
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

    if (vis.self.coords.accuracyMeters && vis.self.coords.accuracyMeters < 65) {
      window.L.circle([vis.self.coords.lat, vis.self.coords.lng], {
        radius: vis.self.coords.accuracyMeters, color: "#00D4FF", weight: 1, fillColor: "#00D4FF", fillOpacity: 0.12,
      }).addTo(g);
    }

    window.L.circleMarker([vis.self.coords.lat, vis.self.coords.lng], {
      radius: 9.5,
      color: "#FFFFFF",
      weight: 3,
      fillColor: !vis.self.alive ? "#64748B" : (vis.self.role === "IMPOSTER" ? "#FF2E54" : "#00D4FF"),
      fillOpacity: 1,
    }).bindTooltip(vis.self.alive ? "أنت هنا 📍" : "أنت (شبح 👻)").addTo(g);
  }

  K.Map = {
    applyTileLayer,
    cycleStyle,
    initPersistentMap,
    recenter,
    fetchOverpassPOIs,
    updateLayers,
  };
})(window.Kameen);
