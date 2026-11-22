"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const EARTH_R = 6371000;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;
  const MAX_ANCHOR_BIAS_M = 35;

  const F = {
    // Local Tangent Plane (ENU) origin
    originLat: null,
    originLng: null,
    cosLat: 1,

    // 2D Kalman State (m, m/s)
    E: 0, N: 0,
    vE: 0, vN: 0,
    pE: 2500, pN: 2500,
    pVE: 4, pVN: 4,
    lastPredictMs: 0,

    // Optional site bias cancellation
    biasE: 0, biasN: 0, biasActive: false,

    // GNSS telemetry
    hasFix: false,
    rawLat: null, rawLng: null,
    rawAcc: null, fusedAcc: null,
    lastFixMs: 0,
    acceptedFixes: 0,
    rejectedOutliers: 0,
    lastRawAcc: Infinity,

    // Rock-Solid Tilt-Compensated Compass (Circular Median + Circular EMA + Deadband)
    headingDeg: null,
    displayedHeadingDeg: null,
    headingSource: null,
    compassActive: false,
    compassBound: false,
    compassSin: 0,
    compassCos: 1,
    compassReady: false,
    compassBuf: [], // last 7 angles for median spike rejection
    lastHeadingPaintMs: 0,

    // Accelerometer / ZUPT+ / PDR Step Counter
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
    stepPhase: "idle",
    stepPeakVal: 0,
    stepMinVal: 0,

    // Watch & warmup handles
    watchId: null,
    watchdogTimer: null,
    warmupTimers: [],
    autoUnlockInstalled: false,
    lastBoostMs: 0,

    // Callbacks
    onLocationUpdate: null,
    onHeadingUpdate: null,
    onError: null,
  };

  function setOrigin(lat, lng) {
    F.originLat = lat;
    F.originLng = lng;
    F.cosLat = Math.max(0.05, Math.cos(lat * DEG2RAD));
  }

  function llToEnu(lat, lng) {
    return {
      e: (lng - F.originLng) * DEG2RAD * EARTH_R * F.cosLat,
      n: (lat - F.originLat) * DEG2RAD * EARTH_R,
    };
  }

  function enuToLl(e, n) {
    return {
      lat: F.originLat + (n / EARTH_R) * RAD2DEG,
      lng: F.originLng + (e / (EARTH_R * F.cosLat)) * RAD2DEG,
    };
  }

  function shortestAngleDiff(fromDeg, toDeg) {
    return ((toDeg - fromDeg + 540) % 360) - 180;
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

  // Standard W3C 3D Tilt-Compensated Compass Heading (prevents 180° flips when phone is held upright!)
  function computeTiltCompensatedHeading(alphaDeg, betaDeg, gammaDeg) {
    const a = alphaDeg * DEG2RAD;
    const b = betaDeg * DEG2RAD;
    const g = gammaDeg * DEG2RAD;

    const cA = Math.cos(a), sA = Math.sin(a);
    const cB = Math.cos(b), sB = Math.sin(b);
    const cG = Math.cos(g), sG = Math.sin(g);

    // Project device screen top vector (or rear camera normal when upright) onto horizontal EN plane
    const rA = -cA * sG - sA * sB * cG;
    const rB = -sA * sG + cA * sB * cG;
    let heading = Math.atan2(rA, rB) * RAD2DEG;
    if (heading < 0) heading += 360;

    // Account for screen rotation (0, 90, 180, 270)
    const screenAngle = (window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
    return (heading + screenAngle + 360) % 360;
  }

  // Circular Median + Smooth Vector EMA + 3.0° Deadband Hysteresis (ZERO jitter!)
  function feedHeadingSample(rawDeg, source, weight = 0.14) {
    if (typeof rawDeg !== "number" || !Number.isFinite(rawDeg)) return;
    const norm = ((rawDeg % 360) + 360) % 360;

    let filtered = norm;
    if (source === "compass") {
      F.compassBuf.push(norm);
      if (F.compassBuf.length > 7) F.compassBuf.shift();
      // Reject magnetometer spikes via circular trimmed mean around first vector
      if (F.compassBuf.length >= 3) {
        const ref = F.compassReady ? F.headingDeg : F.compassBuf[0];
        const diffs = F.compassBuf.map((ang) => shortestAngleDiff(ref, ang)).sort((x, y) => x - y);
        const mid = diffs[Math.floor(diffs.length / 2)];
        filtered = (ref + mid + 360) % 360;
      }
    }

    const rad = filtered * DEG2RAD;
    const s = Math.sin(rad);
    const c = Math.cos(rad);

    if (!F.compassReady) {
      F.compassSin = s;
      F.compassCos = c;
      F.compassReady = true;
    } else {
      F.compassSin = F.compassSin * (1 - weight) + s * weight;
      F.compassCos = F.compassCos * (1 - weight) + c * weight;
      const mag = Math.hypot(F.compassSin, F.compassCos) || 1;
      F.compassSin /= mag;
      F.compassCos /= mag;
    }

    const smoothDeg = ((Math.atan2(F.compassSin, F.compassCos) * RAD2DEG) + 360) % 360;
    F.headingDeg = smoothDeg;
    F.headingSource = source;

    // Deadband hysteresis: ignore < 3.0° micro-jitter so arrow stays rock-solid
    const now = Date.now();
    const diffFromDisp = F.displayedHeadingDeg === null ? 999 : Math.abs(shortestAngleDiff(F.displayedHeadingDeg, smoothDeg));
    if (diffFromDisp >= 3.0 && now - F.lastHeadingPaintMs >= 80) {
      F.displayedHeadingDeg = smoothDeg;
      F.lastHeadingPaintMs = now;
      if (typeof F.onHeadingUpdate === "function") {
        F.onHeadingUpdate(smoothDeg, source);
      }
    }
  }

  function onDeviceOrientationEvent(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading; // iOS CoreLocation magnetic heading (already tilt-compensated!)
    } else if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      const beta = (typeof e.beta === "number" && Number.isFinite(e.beta)) ? e.beta : 0;
      const gamma = (typeof e.gamma === "number" && Number.isFinite(e.gamma)) ? e.gamma : 0;
      // When phone is nearly flat (|beta| < 25 & |gamma| < 25), standard 360-alpha is cleanest;
      // when tilted in hand (25..85 deg), use full 3D tilt compensation!
      if (Math.abs(beta) < 22 && Math.abs(gamma) < 22) {
        const screenAngle = (window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
        heading = (360 - e.alpha + screenAngle + 360) % 360;
      } else {
        heading = computeTiltCompensatedHeading(e.alpha, beta, gamma);
      }
    }
    if (heading !== null) {
      F.compassActive = true;
      feedHeadingSample(heading, "compass", 0.14);
    }
  }

  function emitFusedCoords(source) {
    if (!F.hasFix || F.originLat === null) return;
    const out = enuToLl(F.E + F.biasE, F.N + F.biasN);
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

    const recentlyStepped = (nowMs - F.lastStepMs) < 1500;
    const stationary = F.motionActive ? (F.isStationary && !recentlyStepped) : false;

    if (stationary) {
      F.vE *= 0.2;
      F.vN *= 0.2;
      F.pE += 0.012 * dt;
      F.pN += 0.012 * dt;
      F.pVE = Math.max(0.04, F.pVE * 0.65);
      F.pVN = Math.max(0.04, F.pVN * 0.65);
      return;
    }

    if (!recentlyStepped) {
      F.E += F.vE * dt;
      F.N += F.vN * dt;
      F.vE *= Math.pow(0.62, dt);
      F.vN *= Math.pow(0.62, dt);
    }

    const qPos = recentlyStepped ? 0.5 : 1.6;
    const qVel = 1.1;
    F.pE += (F.pVE * dt * dt) + qPos * dt;
    F.pN += (F.pVN * dt * dt) + qPos * dt;
    F.pVE = Math.min(16, F.pVE + qVel * dt);
    F.pVN = Math.min(16, F.pVN + qVel * dt);
  }

  // --- 2D ENU Kalman Update with Huber Robust Weighting ---
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

    if (!F.hasFix) {
      setOrigin(rawLat, rawLng);
      F.E = 0; F.N = 0; F.vE = 0; F.vN = 0;
      F.pE = rawAcc * rawAcc;
      F.pN = rawAcc * rawAcc;
      F.pVE = 2; F.pVN = 2;
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

    // Cold-Start Snap: immediate snap when jumping from coarse indoor/cell (>22m) to clean outdoor GNSS (<=10m)
    if (rawAcc <= 10 && (F.lastRawAcc > 22 || curSigma > 18) && rawAcc < F.lastRawAcc * 0.6) {
      F.E = z.e; F.N = z.n; F.vE = 0; F.vN = 0;
      F.pE = rawAcc * rawAcc;
      F.pN = rawAcc * rawAcc;
      F.lastFixMs = now;
      F.lastRawAcc = rawAcc;
      F.acceptedFixes += 1;
      emitFusedCoords("gps_snap");
      return;
    }

    // Outlier / Multipath Rejection Gate
    if (impliedSpeed > 15 && rawAcc > 14 && curSigma < 18) {
      F.rejectedOutliers += 1;
      return;
    }
    if (rawAcc > 50 && curSigma < 15 && dtFix < 15) {
      F.rejectedOutliers += 1;
      return;
    }
    if (F.motionActive && F.isStationary && (now - F.lastStepMs) > 2000 && jumpM > Math.max(15, rawAcc * 1.45) && curSigma < 12) {
      F.rejectedOutliers += 1;
      return;
    }

    // Huber Robust Noise Inflation (stops 1 indoor reflection from yanking the pin!)
    let effAcc = rawAcc;
    if (F.motionActive && F.isStationary) {
      const huberThreshold = Math.max(3.5, curSigma * 1.2);
      if (jumpM > huberThreshold) {
        effAcc = rawAcc * (jumpM / huberThreshold);
      }
    }

    const R = effAcc * effAcc;
    const kE = F.pE / (F.pE + R);
    const kN = F.pN / (F.pN + R);

    const minGain = (!F.isStationary && rawAcc <= 9 && jumpM >= 2.0) ? 0.58 : 0;
    const gE = Math.max(kE, minGain);
    const gN = Math.max(kN, minGain);

    const prevE = F.E, prevN = F.N;
    F.E += gE * innovE;
    F.N += gN * innovN;

    F.pE = Math.max(3.2, (1 - kE) * F.pE);
    F.pN = Math.max(3.2, (1 - kN) * F.pN);

    if (!F.isStationary && dtFix <= 6) {
      const mVE = (F.E - prevE) / dtFix;
      const mVN = (F.N - prevN) / dtFix;
      F.vE = F.vE * 0.5 + mVE * 0.5;
      F.vN = F.vN * 0.5 + mVN * 0.5;
    }

    // Walking COG Heading Fusion (stabilizes compass near metal cars/buildings!)
    if (gpsHeading !== null && gpsSpeed !== null && gpsSpeed > 1.1) {
      feedHeadingSample(gpsHeading, F.compassActive ? "fused" : "gps", F.compassActive ? 0.25 : 0.45);
    } else if (!F.compassActive && jumpM >= 2.0) {
      feedHeadingSample(computeBearingDeg(enuToLl(prevE, prevN), enuToLl(F.E, F.N)), "gps", 0.40);
    }

    if (Math.hypot(F.E, F.N) > 4000) {
      const curLL = enuToLl(F.E, F.N);
      setOrigin(curLL.lat, curLL.lng);
      F.E = 0; F.N = 0;
    }

    F.lastFixMs = now;
    F.lastRawAcc = rawAcc;
    F.acceptedFixes += 1;
    emitFusedCoords("gps_kalman");
  }

  function injectPdrStep(nowMs, peakToValley) {
    F.stepsTotal += 1;
    F.lastStepMs = nowMs;
    F.isStationary = false;
    F.lastMovementMs = nowMs;

    const stride = Math.max(0.58, Math.min(0.88, 0.48 + 0.14 * Math.pow(Math.max(0.5, peakToValley), 0.25)));
    if (!F.hasFix || F.headingDeg === null) return;

    kalmanPredict(nowMs);
    const rad = F.headingDeg * DEG2RAD;
    F.E += stride * Math.sin(rad);
    F.N += stride * Math.cos(rad);
    F.pE = Math.min(400, F.pE + 0.35);
    F.pN = Math.min(400, F.pN + 0.35);
    emitFusedCoords("pdr_step");
  }

  function onDeviceMotionEvent(e) {
    const now = Date.now();
    let linMag = null;

    if (e.acceleration && typeof e.acceleration.x === "number" && Number.isFinite(e.acceleration.x) &&
        (Math.abs(e.acceleration.x) + Math.abs(e.acceleration.y) + Math.abs(e.acceleration.z)) > 0.001) {
      linMag = Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0);
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
      const lx = gx - F.gravity.x, ly = gy - F.gravity.y, lz = gz - F.gravity.z;
      const gNorm = Math.hypot(F.gravity.x, F.gravity.y, F.gravity.z) || 9.81;
      linMag = (lx * F.gravity.x + ly * F.gravity.y + lz * F.gravity.z) / gNorm;
    }

    if (linMag === null || !Number.isFinite(linMag)) return;
    F.motionActive = true;

    F.magWindow.push(linMag);
    if (F.magWindow.length > 22) F.magWindow.shift();

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

    if (F.accVariance < 0.16 && (now - F.lastStepMs) > 1500) {
      F.isStationary = true;
    } else if (F.accVariance > 0.35) {
      F.isStationary = false;
      F.lastMovementMs = now;
    }

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

  function grabHighAccuracyOnce() {
    if (!("geolocation" in navigator)) return;
    try {
      navigator.geolocation.getCurrentPosition(handleRawGpsFix, () => {}, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 10000,
      });
    } catch {}
  }

  function boostLock(fromUserGesture = false) {
    const now = Date.now();
    void enableSensors(fromUserGesture);
    if (now - F.lastBoostMs < 3500) return;
    F.lastBoostMs = now;
    grabHighAccuracyOnce();
    F.warmupTimers.forEach((id) => clearTimeout(id));
    F.warmupTimers = [
      setTimeout(grabHighAccuracyOnce, 1200),
      setTimeout(grabHighAccuracyOnce, 3000),
      setTimeout(grabHighAccuracyOnce, 5500),
    ];
  }

  function installAutoUnlock() {
    if (F.autoUnlockInstalled || typeof window === "undefined") return;
    F.autoUnlockInstalled = true;
    const onGesture = () => {
      void enableSensors(true);
      boostLock(true);
      if (K.SFX && typeof K.SFX.warmup === "function") K.SFX.warmup();
      if (F.compassBound && F.motionBound) {
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("touchstart", onGesture, true);
        window.removeEventListener("click", onGesture, true);
      }
    };
    window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
    window.addEventListener("touchstart", onGesture, { capture: true, passive: true });
    window.addEventListener("click", onGesture, { capture: true, passive: true });
  }

  function start(callbacks = {}) {
    if (callbacks.onLocationUpdate) F.onLocationUpdate = callbacks.onLocationUpdate;
    if (callbacks.onHeadingUpdate) F.onHeadingUpdate = callbacks.onHeadingUpdate;
    if (callbacks.onError) F.onError = callbacks.onError;

    void enableSensors(false);
    installAutoUnlock();

    if (!("geolocation" in navigator)) {
      if (F.onError) F.onError({ code: 0, message: "المتصفح مش بيدعم GPS" });
      return;
    }
    if (F.watchId !== null) return;

    F.lastBoostMs = 0;
    boostLock(false);

    F.watchId = navigator.geolocation.watchPosition(
      handleRawGpsFix,
      (err) => { if (F.onError) F.onError(err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );

    if (F.watchdogTimer) clearInterval(F.watchdogTimer);
    F.watchdogTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - (F.lastFixMs || 0) > 6000) grabHighAccuracyOnce();
    }, 5000);
  }

  function recalibrate(fromUserGesture = true) {
    if (F.watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(F.watchId);
      F.watchId = null;
    }
    F.hasFix = false; F.originLat = null; F.originLng = null;
    F.pE = 2500; F.pN = 2500; F.lastRawAcc = Infinity;
    F.rejectedOutliers = 0; F.acceptedFixes = 0; F.lastBoostMs = 0;
    void enableSensors(fromUserGesture);
    start();
  }

  function setAnchorCalibration(trueLat, trueLng) {
    if (!F.hasFix || F.originLat === null) {
      return { ok: false, error: "استنى الـ GPS يلقط إشارة أولاً" };
    }
    const t = llToEnu(trueLat, trueLng);
    const bE = t.e - F.E, bN = t.n - F.N;
    const dist = Math.hypot(bE, bN);
    if (dist > MAX_ANCHOR_BIAS_M) {
      return { ok: false, error: `المسافة كبيرة (${Math.round(dist)}م — الحد الأقصى ${MAX_ANCHOR_BIAS_M}م)` };
    }
    F.biasE = bE; F.biasN = bN; F.biasActive = true;
    F.pE = Math.min(F.pE, 6.0); F.pN = Math.min(F.pN, 6.0);
    emitFusedCoords("anchor_lock");
    return { ok: true, correctedMeters: Number(dist.toFixed(1)) };
  }

  function clearAnchorCalibration() {
    F.biasE = 0; F.biasN = 0; F.biasActive = false;
    emitFusedCoords("anchor_clear");
  }

  function setManualHeading(deg, source = "sim") {
    feedHeadingSample(deg, source, 0.55);
  }

  function getTelemetry() {
    const speedMps = F.isStationary ? 0 : Math.hypot(F.vE, F.vN);
    const biasMeters = F.biasActive ? Number(Math.hypot(F.biasE, F.biasN).toFixed(1)) : 0;
    let motionMode = "GPS تلقائي";
    if (F.motionActive) {
      if ((Date.now() - F.lastStepMs) < 2200) motionMode = "خطوات PDR";
      else if (F.isStationary) motionMode = "ثابت ZUPT";
      else motionMode = "حركة نشطة";
    }
    const acc = F.fusedAcc ?? F.rawAcc;
    let quality = "waiting";
    if (acc !== null) {
      if (acc <= 4.5) quality = "ultra";
      else if (acc <= 10) quality = "good";
      else if (acc <= 24) quality = "medium";
      else quality = "indoor";
    }
    return {
      hasFix: F.hasFix, rawAcc: F.rawAcc, fusedAcc: F.fusedAcc, quality,
      motionMode, isStationary: F.isStationary,
      motionActive: F.motionActive, compassActive: F.compassActive,
      headingDeg: F.headingDeg, headingArabic: headingToArabic(F.headingDeg),
      stepsTotal: F.stepsTotal, speedKmh: Number((speedMps * 3.6).toFixed(1)),
      acceptedFixes: F.acceptedFixes, rejectedOutliers: F.rejectedOutliers,
      biasActive: F.biasActive, biasMeters,
    };
  }

  K.Location = {
    start, boostLock, installAutoUnlock, recalibrate, enableSensors,
    setAnchorCalibration, clearAnchorCalibration, setManualHeading,
    headingToArabic, computeBearingDeg, getTelemetry,
    _processTestFix: handleRawGpsFix,
    _injectTestStep: injectPdrStep,
  };
})(window.Kameen);
