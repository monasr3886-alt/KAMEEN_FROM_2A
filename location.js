"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const EARTH_R = 6371000;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const MAX_ANCHOR_BIAS_M = 35; // Anti-cheat clamp for manual anchor bias

  // Internal filter & sensor state
  const F = {
    // Local Tangent Plane (ENU) origin
    originLat: null,
    originLng: null,
    cosLat: 1,

    // 2D Kalman State: position (m) & velocity (m/s) in ENU
    E: 0,
    N: 0,
    vE: 0,
    vN: 0,
    pE: 2500,   // position variance East (m^2)
    pN: 2500,   // position variance North (m^2)
    pVE: 4,     // velocity variance East ((m/s)^2)
    pVN: 4,     // velocity variance North ((m/s)^2)
    lastPredictMs: 0,

    // Manual Anchor Bias (eliminates systematic local canyon/multipath offset)
    biasE: 0,
    biasN: 0,
    biasActive: false,

    // Telemetry & quality metrics
    hasFix: false,
    rawLat: null,
    rawLng: null,
    rawAcc: null,
    fusedAcc: null,
    lastFixMs: 0,
    acceptedFixes: 0,
    rejectedOutliers: 0,
    lastRawAcc: Infinity,

    // Compass & Heading
    headingDeg: null,
    headingSource: null,
    compassActive: false,
    compassBound: false,
    lastHeadingPaintMs: 0,

    // Accelerometer / ZUPT / PDR Step Counter
    motionActive: false,
    motionBound: false,
    gravity: { x: 0, y: 0, z: 9.81 },
    gravityReady: false,
    magWindow: [],
    accVariance: 0,
    isStationary: true,
    lastMovementMs: 0,
    stepsTotal: 0,
    lastStepMs: 0,
    stepPhase: "idle", // "idle" | "peak"
    stepPeakVal: 0,
    stepMinVal: 0,
    cadenceStrideM: 0.70,

    // Watch handles
    watchId: null,
    watchdogTimer: null,
    warmupTimers: [],

    // Callbacks
    onLocationUpdate: null,
    onHeadingUpdate: null,
    onError: null,
  };

  // --- ENU Coordinate Projections ---
  function setOrigin(lat, lng) {
    F.originLat = lat;
    F.originLng = lng;
    F.cosLat = Math.max(0.05, Math.cos(lat * DEG2RAD));
  }

  function llToEnu(lat, lng) {
    const north = (lat - F.originLat) * DEG2RAD * EARTH_R;
    const east = (lng - F.originLng) * DEG2RAD * EARTH_R * F.cosLat;
    return { e: east, n: north };
  }

  function enuToLl(e, n) {
    const lat = F.originLat + (n / EARTH_R) * RAD2DEG;
    const lng = F.originLng + (e / (EARTH_R * F.cosLat)) * RAD2DEG;
    return { lat, lng };
  }

  function smoothAngle(prevDeg, nextDeg, alpha) {
    if (prevDeg === null || !Number.isFinite(prevDeg)) return ((nextDeg % 360) + 360) % 360;
    const diff = ((nextDeg - prevDeg + 540) % 360) - 180;
    return ((prevDeg + diff * alpha) + 360) % 360;
  }

  function computeBearingDeg(from, to) {
    const lat1 = from.lat * DEG2RAD, lat2 = to.lat * DEG2RAD;
    const dLng = (to.lng - from.lng) * DEG2RAD;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
  }

  function headingToArabic(deg) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) return "—";
    const n = ((deg % 360) + 360) % 360;
    if (n >= 337.5 || n < 22.5) return "شمال";
    if (n < 67.5) return "شمال شرق";
    if (n < 112.5) return "شرق";
    if (n < 157.5) return "جنوب شرق";
    if (n < 202.5) return "جنوب";
    if (n < 247.5) return "جنوب غرب";
    if (n < 292.5) return "غرب";
    return "شمال غرب";
  }

  function emitFusedCoords(source) {
    if (!F.hasFix || F.originLat === null) return;
    const out = enuToLl(F.E + F.biasE, F.N + F.biasN);
    // Realistic fused 1-sigma accuracy estimate (floor 1.8m when anchored+ZUPT outdoors)
    const sigma = Math.sqrt(Math.max(0.5, (F.pE + F.pN) * 0.5));
    const clampedAcc = Number(Math.max(1.8, Math.min(sigma, F.rawAcc || 99)).toFixed(1));
    F.fusedAcc = clampedAcc;

    const coords = {
      lat: out.lat,
      lng: out.lng,
      accuracyMeters: Math.round(clampedAcc),
      fusedAccuracy: clampedAcc,
      rawAccuracy: F.rawAcc,
      source,
    };
    if (typeof F.onLocationUpdate === "function") {
      F.onLocationUpdate(coords, getTelemetry());
    }
  }

  // --- 2D ENU Kalman Predict ---
  function kalmanPredict(nowMs) {
    if (!F.hasFix) return;
    const dt = F.lastPredictMs ? Math.min(5, Math.max(0.05, (nowMs - F.lastPredictMs) / 1000)) : 0.1;
    F.lastPredictMs = nowMs;

    // ZUPT (Zero-Velocity Update): if phone accelerometer proves user is standing still, clamp velocity & freeze drift!
    const recentlyStepped = (nowMs - F.lastStepMs) < 1600;
    const stationary = F.motionActive ? (F.isStationary && !recentlyStepped) : false;

    if (stationary) {
      F.vE *= 0.25;
      F.vN *= 0.25;
      // Tiny process noise when stationary -> lets GNSS samples average down toward ~2.5-3m!
      F.pE += 0.015 * dt;
      F.pN += 0.015 * dt;
      F.pVE = Math.max(0.05, F.pVE * 0.7);
      F.pVN = Math.max(0.05, F.pVN * 0.7);
      return;
    }

    // Moving state: propagate position with damped velocity if PDR isn't driving steps
    if (!recentlyStepped) {
      F.E += F.vE * dt;
      F.N += F.vN * dt;
      F.vE *= Math.pow(0.65, dt);
      F.vN *= Math.pow(0.65, dt);
    }

    // Adaptive process noise: smaller when walking steadily, larger when moving fast
    const qPos = recentlyStepped ? 0.55 : 1.8;
    const qVel = 1.2;
    F.pE += (F.pVE * dt * dt) + qPos * dt;
    F.pN += (F.pVN * dt * dt) + qPos * dt;
    F.pVE = Math.min(16, F.pVE + qVel * dt);
    F.pVN = Math.min(16, F.pVN + qVel * dt);
  }

  // --- 2D ENU Kalman Update from GNSS Fix ---
  function handleRawGpsFix(pos) {
    const now = Date.now();
    const rawLat = pos.coords.latitude;
    const rawLng = pos.coords.longitude;
    const rawAcc = Math.max(2.5, Number((pos.coords.accuracy || 20).toFixed(1)));
    const gpsSpeed = (typeof pos.coords.speed === "number" && Number.isFinite(pos.coords.speed)) ? pos.coords.speed : null;
    const gpsHeading = (typeof pos.coords.heading === "number" && Number.isFinite(pos.coords.heading)) ? pos.coords.heading : null;

    F.rawLat = rawLat;
    F.rawLng = rawLng;
    F.rawAcc = Math.round(rawAcc);

    // First fix initialization
    if (!F.hasFix) {
      setOrigin(rawLat, rawLng);
      F.E = 0;
      F.N = 0;
      F.vE = 0;
      F.vN = 0;
      F.pE = rawAcc * rawAcc;
      F.pN = rawAcc * rawAcc;
      F.pVE = 2;
      F.pVN = 2;
      F.hasFix = true;
      F.lastFixMs = now;
      F.lastPredictMs = now;
      F.lastRawAcc = rawAcc;
      F.acceptedFixes += 1;
      emitFusedCoords("gps_init");
      return;
    }

    const dtFix = Math.max(0.25, (now - F.lastFixMs) / 1000);
    kalmanPredict(now);

    const z = llToEnu(rawLat, rawLng);
    const innovE = z.e - F.E;
    const innovN = z.n - F.N;
    const jumpM = Math.hypot(innovE, innovN);
    const impliedSpeed = jumpM / dtFix;
    const curSigma = Math.sqrt((F.pE + F.pN) * 0.5);

    // Cold-Start Snap: if phone just upgraded from coarse cell/Wi-Fi (>25m) to clean GNSS (<=12m), snap cleanly!
    if (rawAcc <= 12 && (F.lastRawAcc > 24 || curSigma > 20) && rawAcc < F.lastRawAcc * 0.6) {
      F.E = z.e;
      F.N = z.n;
      F.vE = 0;
      F.vN = 0;
      F.pE = rawAcc * rawAcc;
      F.pN = rawAcc * rawAcc;
      F.lastFixMs = now;
      F.lastRawAcc = rawAcc;
      F.acceptedFixes += 1;
      emitFusedCoords("gps_snap");
      return;
    }

    // Multipath / Cell-Tower Outlier Rejection Gate
    const maxAllowedSpeed = 16; // ~58 km/h (generous for sprinting/bike, blocks tower teleports)
    if (impliedSpeed > maxAllowedSpeed && rawAcc > 16 && curSigma < 18) {
      F.rejectedOutliers += 1;
      return;
    }
    if (rawAcc > 55 && curSigma < 15 && dtFix < 15) {
      F.rejectedOutliers += 1;
      return;
    }
    // Mahalanobis innovation gate against sudden multipath bounce when stationary
    if (F.motionActive && F.isStationary && (now - F.lastStepMs) > 2000 && jumpM > Math.max(18, rawAcc * 1.6) && curSigma < 12) {
      F.rejectedOutliers += 1;
      return;
    }

    // Optimal Kalman Gain K = P / (P + R)
    // Inflate measurement noise R slightly if stationary and reading is noisier than current lock
    let effAcc = rawAcc;
    if (F.motionActive && F.isStationary && rawAcc > curSigma * 1.5) {
      effAcc = rawAcc * 1.4;
    }
    const R = effAcc * effAcc;
    const kE = F.pE / (F.pE + R);
    const kN = F.pN / (F.pN + R);

    // When moving fast with sharp GNSS (<=10m), ensure zero-lag minimum responsiveness (gain floor 0.55)
    const minGain = (!F.isStationary && rawAcc <= 10 && jumpM >= 2.2) ? 0.55 : 0;
    const gE = Math.max(kE, minGain);
    const gN = Math.max(kN, minGain);

    const prevE = F.E, prevN = F.N;
    F.E += gE * innovE;
    F.N += gN * innovN;

    // Update covariance with safe physical floor (~1.8m^2 => ~1.35m floor per axis -> ~1.9m 2D sigma)
    F.pE = Math.max(3.2, (1 - kE) * F.pE);
    F.pN = Math.max(3.2, (1 - kN) * F.pN);

    // Velocity estimate update
    if (!F.isStationary && dtFix <= 6) {
      const mVE = (F.E - prevE) / dtFix;
      const mVN = (F.N - prevN) / dtFix;
      F.vE = F.vE * 0.5 + mVE * 0.5;
      F.vN = F.vN * 0.5 + mVN * 0.5;
    }

    // Heading fusion: blend GPS course-over-ground when moving briskly (>1.3 m/s) to correct magnetic interference
    if (gpsHeading !== null && gpsSpeed !== null && gpsSpeed > 1.3) {
      applyHeading(gpsHeading, F.compassActive ? "fused" : "gps", F.compassActive ? 0.18 : 0.45);
    } else if (!F.compassActive && jumpM >= 1.8) {
      const prevLL = enuToLl(prevE, prevN);
      const curLL = enuToLl(F.E, F.N);
      applyHeading(computeBearingDeg(prevLL, curLL), "gps", 0.42);
    }

    // Re-center tangent plane origin if user walked > 4km from origin
    if (Math.hypot(F.E, F.N) > 4000) {
      const curLL = enuToLl(F.E, F.N);
      setOrigin(curLL.lat, curLL.lng);
      F.E = 0;
      F.N = 0;
    }

    F.lastFixMs = now;
    F.lastRawAcc = rawAcc;
    F.acceptedFixes += 1;
    emitFusedCoords("gps_kalman");
  }

  // --- PDR Step Impulse Injection ---
  function injectPdrStep(nowMs, peakToValley) {
    F.stepsTotal += 1;
    F.lastStepMs = nowMs;
    F.isStationary = false;
    F.lastMovementMs = nowMs;

    // Weinberg adaptive stride length (~0.60m slow walk -> ~0.88m fast walk/jog)
    const stride = Math.max(0.58, Math.min(0.90, 0.48 + 0.14 * Math.pow(Math.max(0.5, peakToValley), 0.25)));
    F.cadenceStrideM = stride;

    if (!F.hasFix || F.headingDeg === null) return;

    kalmanPredict(nowMs);
    const rad = F.headingDeg * DEG2RAD;
    const dE = stride * Math.sin(rad);
    const dN = stride * Math.cos(rad);

    F.E += dE;
    F.N += dN;
    // Slight variance growth per dead-reckoned step (~0.35m^2) so next GNSS fix gently snaps any compass drift
    F.pE = Math.min(400, F.pE + 0.35);
    F.pN = Math.min(400, F.pN + 0.35);

    emitFusedCoords("pdr_step");
  }

  // --- Accelerometer Motion Listener (ZUPT + PDR Step Detector) ---
  function onDeviceMotionEvent(e) {
    const now = Date.now();
    let linMag = null;

    if (e.acceleration && typeof e.acceleration.x === "number" && Number.isFinite(e.acceleration.x) &&
        (Math.abs(e.acceleration.x) + Math.abs(e.acceleration.y) + Math.abs(e.acceleration.z)) > 0.001) {
      // Hardware-separated linear acceleration (best!)
      const ax = e.acceleration.x || 0;
      const ay = e.acceleration.y || 0;
      const az = e.acceleration.z || 0;
      // Signed vertical-dominant magnitude projected along gravity if available, else norm
      linMag = Math.hypot(ax, ay, az);
      // Center around 0 using rolling mean below
    } else if (e.accelerationIncludingGravity && typeof e.accelerationIncludingGravity.x === "number") {
      const gx = e.accelerationIncludingGravity.x || 0;
      const gy = e.accelerationIncludingGravity.y || 0;
      const gz = e.accelerationIncludingGravity.z || 0;
      if (!F.gravityReady) {
        F.gravity = { x: gx, y: gy, z: gz };
        F.gravityReady = true;
      } else {
        const a = 0.86;
        F.gravity.x = a * F.gravity.x + (1 - a) * gx;
        F.gravity.y = a * F.gravity.y + (1 - a) * gy;
        F.gravity.z = a * F.gravity.z + (1 - a) * gz;
      }
      const lx = gx - F.gravity.x;
      const ly = gy - F.gravity.y;
      const lz = gz - F.gravity.z;
      // Project onto gravity axis for clean vertical bounce of human walking!
      const gNorm = Math.hypot(F.gravity.x, F.gravity.y, F.gravity.z) || 9.81;
      const vert = (lx * F.gravity.x + ly * F.gravity.y + lz * F.gravity.z) / gNorm;
      linMag = vert;
    }

    if (linMag === null || !Number.isFinite(linMag)) return;
    F.motionActive = true;

    F.magWindow.push(linMag);
    if (F.magWindow.length > 24) F.magWindow.shift();

    // Compute rolling mean & variance for ZUPT stationary detection
    let sum = 0;
    for (let i = 0; i < F.magWindow.length; i++) sum += F.magWindow[i];
    const mean = sum / F.magWindow.length;
    let varSum = 0;
    for (let i = 0; i < F.magWindow.length; i++) {
      const d = F.magWindow[i] - mean;
      varSum += d * d;
    }
    F.accVariance = varSum / F.magWindow.length;

    const centered = linMag - mean;

    // Stationary threshold (ZUPT)
    if (F.accVariance < 0.16 && (now - F.lastStepMs) > 1500) {
      F.isStationary = true;
    } else if (F.accVariance > 0.35) {
      F.isStationary = false;
      F.lastMovementMs = now;
    }

    // Peak-Valley Step Detector (Refractory 320ms prevents double-counting)
    const dtStep = now - F.lastStepMs;
    if (F.stepPhase === "idle") {
      if (centered > 1.25 && dtStep > 320) {
        F.stepPhase = "peak";
        F.stepPeakVal = centered;
        F.stepMinVal = 0;
      }
    } else if (F.stepPhase === "peak") {
      if (centered > F.stepPeakVal) F.stepPeakVal = centered;
      if (centered < F.stepMinVal) F.stepMinVal = centered;
      if (centered < -0.45) {
        const p2v = F.stepPeakVal - F.stepMinVal;
        F.stepPhase = "idle";
        if (p2v >= 1.7 && p2v <= 14.0 && dtStep > 320) {
          injectPdrStep(now, p2v);
        }
      } else if (dtStep > 1400) {
        F.stepPhase = "idle";
      }
    }
  }

  // --- Compass Orientation Listener ---
  function applyHeading(rawDeg, source, alphaOverride) {
    if (typeof rawDeg !== "number" || !Number.isFinite(rawDeg)) return;
    const alpha = alphaOverride ?? (source === "compass" ? 0.22 : 0.42);
    F.headingDeg = smoothAngle(F.headingDeg, rawDeg, alpha);
    F.headingSource = source;
    const now = Date.now();
    if (now - F.lastHeadingPaintMs >= 60) {
      F.lastHeadingPaintMs = now;
      if (typeof F.onHeadingUpdate === "function") {
        F.onHeadingUpdate(F.headingDeg, source);
      }
    }
  }

  function onDeviceOrientationEvent(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;
    } else if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      const screenAngle = (window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
      heading = (360 - e.alpha + screenAngle) % 360;
    }
    if (heading !== null) {
      F.compassActive = true;
      applyHeading(heading, "compass");
    }
  }

  async function enableSensors(fromUserGesture = false) {
    let compassOk = false;
    let motionOk = false;

    try {
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        if (fromUserGesture) {
          const p = await DeviceOrientationEvent.requestPermission();
          compassOk = (p === "granted");
        }
      } else {
        compassOk = true;
      }
      if (compassOk && !F.compassBound) {
        F.compassBound = true;
        if ("ondeviceorientationabsolute" in window) {
          window.addEventListener("deviceorientationabsolute", onDeviceOrientationEvent, true);
        } else {
          window.addEventListener("deviceorientation", onDeviceOrientationEvent, true);
        }
      }
    } catch {}

    try {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        if (fromUserGesture) {
          const p = await DeviceMotionEvent.requestPermission();
          motionOk = (p === "granted");
        }
      } else {
        motionOk = true;
      }
      if (motionOk && !F.motionBound) {
        F.motionBound = true;
        window.addEventListener("devicemotion", onDeviceMotionEvent, true);
      }
    } catch {}

    return { compassOk, motionOk };
  }

  // --- Manual Precision Anchor Calibration (Site Bias Cancellation) ---
  function setAnchorCalibration(trueLat, trueLng) {
    if (!F.hasFix || F.originLat === null) {
      return { ok: false, error: "استنى الـ GPS يلقط إشارة أولاً قبل المعايرة" };
    }
    const targetEnu = llToEnu(trueLat, trueLng);
    const reqBiasE = targetEnu.e - F.E;
    const reqBiasN = targetEnu.n - F.N;
    const dist = Math.hypot(reqBiasE, reqBiasN);

    if (dist > MAX_ANCHOR_BIAS_M) {
      return {
        ok: false,
        error: `المكان ده بعيد أوي (${Math.round(dist)}م) — الحد الأقصى لمعايرة الترحيل ${MAX_ANCHOR_BIAS_M}م`,
      };
    }

    F.biasE = reqBiasE;
    F.biasN = reqBiasN;
    F.biasActive = true;
    // Tightening local confidence after physical anchor lock
    F.pE = Math.min(F.pE, 6.5);
    F.pN = Math.min(F.pN, 6.5);
    emitFusedCoords("anchor_lock");
    return { ok: true, correctedMeters: Number(dist.toFixed(1)) };
  }

  function clearAnchorCalibration() {
    F.biasE = 0;
    F.biasN = 0;
    F.biasActive = false;
    emitFusedCoords("anchor_clear");
  }

  // --- Start & High-Accuracy Warmup Burst ---
  function start(callbacks = {}) {
    if (callbacks.onLocationUpdate) F.onLocationUpdate = callbacks.onLocationUpdate;
    if (callbacks.onHeadingUpdate) F.onHeadingUpdate = callbacks.onHeadingUpdate;
    if (callbacks.onError) F.onError = callbacks.onError;

    void enableSensors(false);

    if (!("geolocation" in navigator)) {
      if (F.onError) F.onError({ code: 0, message: "المتصفح مش بيدعم GPS" });
      return;
    }
    if (F.watchId !== null) return;

    const handleErr = (err) => {
      if (F.onError) F.onError(err);
    };

    // High-accuracy warmup burst: immediate grab + 2s + 5s kick to force GNSS hardware lock
    const grabNow = () => {
      try {
        navigator.geolocation.getCurrentPosition(handleRawGpsFix, () => {}, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        });
      } catch {}
    };
    grabNow();
    F.warmupTimers.forEach((id) => clearTimeout(id));
    F.warmupTimers = [
      setTimeout(grabNow, 2000),
      setTimeout(grabNow, 5000),
    ];

    F.watchId = navigator.geolocation.watchPosition(
      handleRawGpsFix,
      handleErr,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );

    // Watchdog prevents Android Chrome from sleeping watchPosition while screen is active
    if (F.watchdogTimer) clearInterval(F.watchdogTimer);
    F.watchdogTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - (F.lastFixMs || 0) > 6500) {
        grabNow();
      }
    }, 5500);
  }

  function recalibrate(fromUserGesture = true) {
    if (F.watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(F.watchId);
      F.watchId = null;
    }
    F.hasFix = false;
    F.originLat = null;
    F.originLng = null;
    F.pE = 2500;
    F.pN = 2500;
    F.lastRawAcc = Infinity;
    F.rejectedOutliers = 0;
    F.acceptedFixes = 0;
    void enableSensors(fromUserGesture);
    start();
  }

  function setManualHeading(deg, source = "sim") {
    applyHeading(deg, source, 0.5);
  }

  function getTelemetry() {
    const speedMps = F.isStationary ? 0 : Math.hypot(F.vE, F.vN);
    const biasMeters = F.biasActive ? Number(Math.hypot(F.biasE, F.biasN).toFixed(1)) : 0;
    let motionMode = "تتبع GPS 📡";
    if (F.motionActive) {
      if ((Date.now() - F.lastStepMs) < 2200) motionMode = "ماشي بالخطوات (PDR 👣)";
      else if (F.isStationary) motionMode = "ثابت ومُقفول (ZUPT 🔒)";
      else motionMode = "حركة نشطة 🏃";
    }
    let quality = "waiting";
    const acc = F.fusedAcc ?? F.rawAcc;
    if (acc !== null) {
      if (acc <= 4.5) quality = "ultra";
      else if (acc <= 10) quality = "good";
      else if (acc <= 24) quality = "medium";
      else quality = "indoor";
    }
    return {
      hasFix: F.hasFix,
      rawAcc: F.rawAcc,
      fusedAcc: F.fusedAcc,
      quality,
      motionMode,
      isStationary: F.isStationary,
      motionActive: F.motionActive,
      compassActive: F.compassActive,
      headingDeg: F.headingDeg,
      headingArabic: headingToArabic(F.headingDeg),
      stepsTotal: F.stepsTotal,
      speedKmh: Number((speedMps * 3.6).toFixed(1)),
      acceptedFixes: F.acceptedFixes,
      rejectedOutliers: F.rejectedOutliers,
      biasActive: F.biasActive,
      biasMeters,
    };
  }

  K.Location = {
    start,
    recalibrate,
    enableSensors,
    setAnchorCalibration,
    clearAnchorCalibration,
    setManualHeading,
    headingToArabic,
    computeBearingDeg,
    getTelemetry,
    // Exposed for unit testing & diagnostics
    _processTestFix: handleRawGpsFix,
    _injectTestStep: injectPdrStep,
  };
})(window.Kameen);
