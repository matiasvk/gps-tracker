import { useEffect, useRef, useState } from "react";
import { Activity, Clock3, Route, Play, Pause, Square, Trash2, LocateFixed, Gauge } from "lucide-react";

const STORAGE_KEY = "stride-trips-v1";
const fmtTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
};
const fmtDistance = (km) => km < 10 ? km.toFixed(2) : km.toFixed(1);
const haversineKm = (a, b) => {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude), lat2 = rad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

export default function App() {
  const [status, setStatus] = useState("idle"); // idle | running | paused
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [accuracy, setAccuracy] = useState(null);
  const [message, setMessage] = useState("Ready when you are");
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [activeSince, setActiveSince] = useState(null);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const watchId = useRef(null);
  const lastPosition = useRef(null);
  const distanceRef = useRef(0);
  const speedRef = useRef(0);
  const startedAt = useRef(null);
  const elapsedBeforePause = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
  }, [history]);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      if (activeSince) setElapsed(elapsedBeforePause.current + Math.floor((Date.now() - activeSince) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [status, activeSince]);

  const stopWatching = () => {
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  };

  const startWatching = () => {
    if (!("geolocation" in navigator)) {
      setMessage("This browser does not support GPS location.");
      return;
    }
    setMessage("Waiting for GPS fix…");
    watchId.current = navigator.geolocation.watchPosition(position => {
      const c = position.coords;
      setAccuracy(Math.round(c.accuracy));
      if (c.accuracy > 60) {
        setMessage(`GPS accuracy is ±${Math.round(c.accuracy)} m. Waiting for a better signal…`);
        return;
      }
      const current = { latitude: c.latitude, longitude: c.longitude, timestamp: position.timestamp };
      let nextSpeed = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : 0;
     if (lastPosition.current) {
  const prev = lastPosition.current;
  const km = haversineKm(prev, current);
  const seconds = Math.max(0.5, (current.timestamp - prev.timestamp) / 1000);
  const calculatedKmh = (km / seconds) * 3600;

  // 1. Cap maximum plausible speed (e.g. 150 km/h) to discard teleportation jumps
  // 2. Allow smaller real movements down to 1 meter (0.001 km)
  if (calculatedKmh <= 150) {
    if (km >= 0.001) { 
      distanceRef.current += km;
      setDistance(distanceRef.current);
    }
    
    if (!Number.isFinite(c.speed) || c.speed < 0) {
      nextSpeed = calculatedKmh < 0.5 ? 0 : calculatedKmh;
    }
  }
}
      lastPosition.current = current;
      if (nextSpeed > 180) nextSpeed = 0;
      speedRef.current = nextSpeed;
      setSpeed(nextSpeed);
      setMaxSpeed(old => Math.max(old, nextSpeed));
      setMessage("GPS tracking active");
    }, error => {
      const text = error.code === 1 ? "Location permission was denied. Allow location access in browser settings." :
        error.code === 2 ? "GPS position unavailable. Try moving outdoors." : "GPS timed out. Keep the page open and try again.";
      setMessage(text);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  };

  const startTrip = () => {
    if (status === "paused") {
      setActiveSince(Date.now());
      setStatus("running");
      setMessage("Resuming trip…");
      startWatching();
      return;
    }
    distanceRef.current = 0;
    speedRef.current = 0;
    lastPosition.current = null;
    elapsedBeforePause.current = 0;
    startedAt.current = Date.now();
    setDistance(0); setSpeed(0); setElapsed(0); setMaxSpeed(0); setAccuracy(null);
    setActiveSince(Date.now());
    setStatus("running");
    startWatching();
  };

  const pauseTrip = () => {
    elapsedBeforePause.current = elapsed;
    setActiveSince(null);
    setStatus("paused");
    setSpeed(0);
    stopWatching();
    setMessage("Trip paused");
  };

  const finishTrip = () => {
    stopWatching();
    const finalElapsed = status === "running" && activeSince
      ? elapsedBeforePause.current + Math.floor((Date.now() - activeSince) / 1000)
      : elapsed;
    if (startedAt.current && (distanceRef.current > 0 || finalElapsed > 0)) {
      const trip = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString(),
        distance: distanceRef.current,
        duration: finalElapsed,
        avgSpeed: finalElapsed > 0 ? distanceRef.current / (finalElapsed / 3600) : 0,
        maxSpeed
      };
      setHistory(old => [trip, ...old].slice(0, 100));
    }
    setStatus("idle"); setSpeed(0); setDistance(0); setElapsed(0); setMaxSpeed(0);
    setActiveSince(null); setAccuracy(null); setMessage("Trip saved. Ready for another?");
    distanceRef.current = 0; lastPosition.current = null; startedAt.current = null;
    elapsedBeforePause.current = 0;
  };

  const clearHistory = () => {
    if (window.confirm("Delete all saved trips?")) setHistory([]);
  };

  useEffect(() => () => stopWatching(), []);

  const avgSpeed = elapsed > 0 ? distance / (elapsed / 3600) : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Route size={23} /></div>
        <div><div className="brand-name">stride<span>.</span></div><div className="brand-sub">GPS ACTIVITY TRACKER</div></div>
        <div className={`gps-pill ${status === "running" ? "is-live" : ""}`}><span className="dot" />{status === "running" ? "TRACKING" : status === "paused" ? "PAUSED" : "GPS READY"}</div>
      </header>

      <section className="hero panel">
        <div className="section-eyebrow"><Activity size={15} /> CURRENT SPEED</div>
        <div className="speed-reading"><span>{status === "idle" ? "0.0" : speed.toFixed(1)}</span><small>km/h</small></div>
        <div className="speed-track"><div className="speed-fill" style={{ width: `${Math.min(speed / 140 * 100, 100)}%` }} /></div>
        <div className="speed-scale"><span>0 km/h</span><span>140 km/h</span></div>
        <div className="gps-status"><span className={`status-light ${status === "running" ? "green" : ""}`} />{message}</div>
        {accuracy !== null && <div className="accuracy">GPS accuracy ±{accuracy} m</div>}
      </section>

      <section className="metrics-grid">
        <div className="metric panel"><div className="metric-icon teal"><Route size={19} /></div><div className="metric-label">DISTANCE</div><div className="metric-value">{fmtDistance(distance)} <small>km</small></div><div className="metric-note">Total traveled</div></div>
        <div className="metric panel"><div className="metric-icon purple"><Clock3 size={19} /></div><div className="metric-label">DURATION</div><div className="metric-value timer">{fmtTime(elapsed)}</div><div className="metric-note">Trip time</div></div>
      </section>

      <section className="stats-row panel">
        <div><span className="stat-label"><Gauge size={14} /> AVERAGE SPEED</span><strong>{avgSpeed.toFixed(1)} <small>km/h</small></strong></div>
        <div className="stat-divider" />
        <div><span className="stat-label"><Activity size={14} /> TOP SPEED</span><strong>{maxSpeed.toFixed(1)} <small>km/h</small></strong></div>
      </section>

      <section className="controls">
        {status === "idle" ? <button className="btn btn-start" onClick={startTrip}><Play size={18} fill="currentColor" /> Start trip</button> :
          status === "running" ? <button className="btn btn-pause" onClick={pauseTrip}><Pause size={18} fill="currentColor" /> Pause trip</button> :
          <button className="btn btn-start" onClick={startTrip}><Play size={18} fill="currentColor" /> Resume trip</button>}
        {status !== "idle" && <button className="btn btn-stop" onClick={finishTrip}><Square size={17} fill="currentColor" /> Finish</button>}
      </section>
      <div className="privacy-note"><LocateFixed size={15} /><span>Your location stays on this device. Keep this page open while tracking.</span></div>

      <section className="history-section">
        <div className="history-heading"><div><div className="section-eyebrow">YOUR ACTIVITY</div><h2>Trip history <span>{history.length}</span></h2></div>{history.length > 0 && <button className="clear-btn" onClick={clearHistory}><Trash2 size={14} /> Clear</button>}</div>
        {history.length === 0 ? <div className="empty-state panel"><div className="empty-icon"><Route size={23} /></div><strong>No trips yet</strong><p>Your completed trips will show up here.</p></div> :
          <div className="trip-list">{history.map(trip => <article className="trip-card panel" key={trip.id}><div className="trip-icon"><Route size={18} /></div><div className="trip-main"><strong>{fmtDistance(trip.distance)} km</strong><span>{new Date(trip.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · {fmtTime(trip.duration)}</span></div><div className="trip-right"><strong>{trip.avgSpeed.toFixed(1)} <small>km/h</small></strong><span>avg speed</span></div></article>)}</div>}
      </section>
      <footer>MADE FOR THE JOURNEY <span>·</span> GPS-POWERED</footer>
    </main>
  );
}