import { useEffect, useRef, useState } from "react";
import { Activity, Clock3, Route, Play, Pause, Square, Trash2, LocateFixed, Gauge, Download, MapPinned } from "lucide-react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

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

const groupTrackSegments = (points) => {
  const segments = [];
  points.forEach((point) => {
    const segmentId = point.segment ?? 0;
    let segment = segments[segments.length - 1];
    if (!segment || segment.id !== segmentId) {
      segment = { id: segmentId, points: [] };
      segments.push(segment);
    }
    segment.points.push(point);
  });
  return segments;
};

const exportTrackAsGpx = (trip) => {
  if (!trip?.trackPoints?.length) return;

  const segments = groupTrackSegments(trip.trackPoints)
    .map(({ points }) => {
      const trackPoints = points.map((point) => {
        const elevation = Number.isFinite(point.altitude) ? `<ele>${point.altitude.toFixed(1)}</ele>` : "";
        return `      <trkpt lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}">${elevation}<time>${point.timestamp}</time></trkpt>`;
      });
      return `    <trkseg>\n${trackPoints.join("\n")}\n    </trkseg>`;
    })
    .join("\n");
  const date = new Date(trip.date).toISOString();
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Stride GPS Tracker" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Stride GPS trip</name><time>${date}</time></metadata>
  <trk>
    <name>Stride GPS trip</name>
${segments}
  </trk>
</gpx>`;
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `stride-${date.slice(0, 10)}.gpx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

function FitTrackBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    const coordinates = points.map((point) => [point.latitude, point.longitude]);
    if (coordinates.length === 1) map.setView(coordinates[0], 16);
    if (coordinates.length > 1) map.fitBounds(coordinates, { padding: [28, 28], maxZoom: 16 });
  }, [map]);
  return null;
}

function RouteMap({ points }) {
  const segments = groupTrackSegments(points);
  const center = points.length ? [points[0].latitude, points[0].longitude] : [0, 0];
  const lastPoint = points[points.length - 1];

  return (
    <MapContainer center={center} zoom={points.length ? 13 : 2} scrollWheelZoom className="leaflet-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitTrackBounds points={points} />
      {segments.map((segment) => {
        const coordinates = segment.points.map((point) => [point.latitude, point.longitude]);
        return coordinates.length > 1 ? (
          <Polyline key={segment.id} positions={coordinates} pathOptions={{ color: "#159b83", weight: 5, opacity: 0.9 }} />
        ) : (
          <CircleMarker key={segment.id} center={coordinates[0]} radius={6} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#159b83", fillOpacity: 1 }} />
        );
      })}
      {points.length > 1 && <>
        <CircleMarker center={center} radius={6} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#159b83", fillOpacity: 1 }} />
        <CircleMarker center={[lastPoint.latitude, lastPoint.longitude]} radius={6} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#e25555", fillOpacity: 1 }} />
      </>}
    </MapContainer>
  );
}

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
  const [trackPoints, setTrackPoints] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [activeSince, setActiveSince] = useState(null);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const watchId = useRef(null);
  const lastPosition = useRef(null);
  const distanceRef = useRef(0);
  const speedRef = useRef(0);
  const startedAt = useRef(null);
  const elapsedBeforePause = useRef(0);
  const trackSegment = useRef(0);

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
      const current = {
        latitude: c.latitude,
        longitude: c.longitude,
        altitude: c.altitude,
        timestamp: new Date(position.timestamp).toISOString()
      };
      let nextSpeed = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 3.6 : 0;
      let shouldRecord = true;
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
  } else {
    shouldRecord = false;
    nextSpeed = 0;
  }
}
      if (shouldRecord) {
        lastPosition.current = current;
        setTrackPoints((points) => [...points, { ...current, segment: trackSegment.current }]);
      }
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
      setSelectedRouteId("current");
      setMessage("Resuming trip…");
      startWatching();
      return;
    }
    distanceRef.current = 0;
    speedRef.current = 0;
    lastPosition.current = null;
    trackSegment.current = 0;
    elapsedBeforePause.current = 0;
    startedAt.current = Date.now();
    setDistance(0); setSpeed(0); setElapsed(0); setMaxSpeed(0); setAccuracy(null);
    setTrackPoints([]);
    setSelectedRouteId("current");
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
    lastPosition.current = null;
    trackSegment.current += 1;
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
        maxSpeed,
        trackPoints
      };
      setHistory(old => [trip, ...old].slice(0, 100));
      setSelectedRouteId(trip.id);
    }
    setStatus("idle"); setSpeed(0); setDistance(0); setElapsed(0); setMaxSpeed(0);
    setActiveSince(null); setAccuracy(null); setMessage("Trip saved. Ready for another?");
    distanceRef.current = 0; lastPosition.current = null; startedAt.current = null;
    elapsedBeforePause.current = 0;
  };

  const clearHistory = () => {
    if (window.confirm("Delete all saved trips?")) {
      setHistory([]);
      setSelectedRouteId(status === "idle" ? null : "current");
    }
  };

  useEffect(() => () => stopWatching(), []);

  const avgSpeed = elapsed > 0 ? distance / (elapsed / 3600) : 0;
  const selectedTrip = history.find((trip) => trip.id === selectedRouteId) ?? history[0] ?? null;
  const showingCurrentRoute = status !== "idle" && selectedRouteId === "current";
  const displayedPoints = showingCurrentRoute ? trackPoints : selectedTrip?.trackPoints ?? [];
  const routeKey = showingCurrentRoute ? "current-trip" : selectedTrip?.id ?? "empty-route";
  const exportTrip = showingCurrentRoute
    ? { date: new Date(startedAt.current ?? Date.now()).toISOString(), trackPoints: displayedPoints }
    : selectedTrip;
  const routeTitle = showingCurrentRoute
    ? status === "paused" ? "Paused trip" : "Current trip"
    : selectedTrip
      ? new Date(selectedTrip.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "No trip selected";

  return (
    <main className="app-shell">
     <header className="topbar">
  <div className="brand-mark"><Route size={23} /></div>
  <div>
    <div className="brand-name">stride<span>.</span></div>
    <div className="brand-sub">GPS ACTIVITY TRACKER</div>
  </div>
  <div className={`gps-pill ${status === "running" ? "is-tracking" : status === "paused" ? "is-paused" : ""}`}>
    <span className="dot" />
    {status === "running" ? "TRACKING" : status === "paused" ? "PAUSED" : "GPS READY"}
  </div>
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

      <section className="map-section">
        <div className="map-heading">
          <div>
            <div className="section-eyebrow"><MapPinned size={14} /> ROUTE MAP</div>
            <h2>{routeTitle}</h2>
          </div>
          <div className="map-actions">
            {status !== "idle" && !showingCurrentRoute && <button className="map-live-btn" onClick={() => setSelectedRouteId("current")}>Live trip</button>}
            {displayedPoints.length > 0 && <button className="export-btn" onClick={() => exportTrackAsGpx(exportTrip)}><Download size={15} /> Export GPX</button>}
          </div>
        </div>
        {displayedPoints.length > 0 ? (
          <div className="route-map"><RouteMap key={routeKey} points={displayedPoints} /></div>
        ) : (
          <div className="map-empty panel">
            {showingCurrentRoute
              ? "Waiting for an accurate GPS position to draw your route."
              : selectedTrip
                ? "No GPS route was recorded for this trip."
                : "Start a trip to record and view your route here."}
          </div>
        )}
      </section>

      <section className="history-section">
        <div className="history-heading"><div><div className="section-eyebrow">YOUR ACTIVITY</div><h2>Trip history <span>{history.length}</span></h2></div>{history.length > 0 && <button className="clear-btn" onClick={clearHistory}><Trash2 size={14} /> Clear</button>}</div>
        {history.length === 0 ? <div className="empty-state panel"><div className="empty-icon"><Route size={23} /></div><strong>No trips yet</strong><p>Your completed trips will show up here.</p></div> :
          <div className="trip-list">{history.map(trip => <article className={`trip-card panel ${selectedRouteId === trip.id ? "is-selected" : ""}`} key={trip.id}><div className="trip-icon"><Route size={18} /></div><div className="trip-main"><strong>{fmtDistance(trip.distance)} km</strong><span>{new Date(trip.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · {fmtTime(trip.duration)}</span></div><div className="trip-right"><strong>{trip.avgSpeed.toFixed(1)} <small>km/h</small></strong><span>avg speed</span></div><button className="trip-map-btn" aria-label="View trip route" title={trip.trackPoints?.length ? "View route" : "No GPS route saved"} disabled={!trip.trackPoints?.length} onClick={() => setSelectedRouteId(trip.id)}><MapPinned size={16} /></button></article>)}</div>}
      </section>
      <footer>MADE FOR THE JOURNEY <span>·</span> GPS-POWERED</footer>
    </main>
  );
}