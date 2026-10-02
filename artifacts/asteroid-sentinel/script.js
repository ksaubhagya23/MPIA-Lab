const NASA_FEED_URL = "https://api.nasa.gov/neo/rest/v1/feed";
const NASA_API_KEY = "DEMO_KEY";
const ASTRONOMICAL_UNIT_KM = 149597870.7;
const feedCache = new Map();

let asteroids = [];
let selectedId = null;
let selectedLimit = 7;
let selectedFeedDate = "";
let isLoading = false;
let feedError = "";
let sortBy = "distance";
let sortDirection = 1;
let modalReturnFocus = null;

const rows = document.querySelector("#asteroid-rows");
const searchInput = document.querySelector("#asteroid-search");
const hazardFilter = document.querySelector("#hazard-filter");
const minimumDiameterInput = document.querySelector("#diameter-min");
const maximumDiameterInput = document.querySelector("#diameter-max");
const diameterFilterMessage = document.querySelector("#diameter-filter-message");
const sortSelect = document.querySelector("#sort-select");
const feedForm = document.querySelector("#feed-form");
const feedDate = document.querySelector("#feed-date");
const loadFeedButton = document.querySelector("#load-feed");
const feedStatus = document.querySelector("#feed-status");

function showToast(message, detail = "") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    toast.append(small);
  }
  document.querySelector("#toast-host").append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function numericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatShortDate(dateString) {
  if (!dateString) return "—";
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC"
  }).toUpperCase();
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits })
    : "—";
}

function formatKilometers(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("en-US")} km` : "—";
}

function formatAstronomicalUnits(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(value < 0.001 ? 6 : 4)} AU`;
}

function formatDiameter(meters) {
  if (!Number.isFinite(meters)) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} km`
    : `${Math.round(meters).toLocaleString("en-US")} m`;
}

function formatDiameterRange(asteroid) {
  if (!Number.isFinite(asteroid.diameterMinMeters) || !Number.isFinite(asteroid.diameterMaxMeters)) {
    return "—";
  }
  if (asteroid.diameterMaxMeters >= 1000) {
    const min = (asteroid.diameterMinMeters / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const max = (asteroid.diameterMaxMeters / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${min}–${max} km`;
  }
  const min = Math.round(asteroid.diameterMinMeters).toLocaleString("en-US");
  const max = Math.round(asteroid.diameterMaxMeters).toLocaleString("en-US");
  return `${min}–${max} m`;
}

function normalizeAsteroid(neo, requestedDate) {
  const approaches = Array.isArray(neo.close_approach_data) ? neo.close_approach_data : [];
  const closeApproach = approaches.find((approach) => approach.close_approach_date === requestedDate) || approaches[0];
  if (!closeApproach) return null;

  const diameterMeters = neo.estimated_diameter?.meters;
  const diameterKilometers = neo.estimated_diameter?.kilometers;
  const diameterMinMeters = numericValue(diameterMeters?.estimated_diameter_min)
    ?? (numericValue(diameterKilometers?.estimated_diameter_min) !== null
      ? numericValue(diameterKilometers.estimated_diameter_min) * 1000
      : null);
  const diameterMaxMeters = numericValue(diameterMeters?.estimated_diameter_max)
    ?? (numericValue(diameterKilometers?.estimated_diameter_max) !== null
      ? numericValue(diameterKilometers.estimated_diameter_max) * 1000
      : null);
  const distanceKm = numericValue(closeApproach.miss_distance?.kilometers);
  const distanceAu = numericValue(closeApproach.miss_distance?.astronomical)
    ?? (distanceKm !== null ? distanceKm / ASTRONOMICAL_UNIT_KM : null);
  const velocityKmS = numericValue(closeApproach.relative_velocity?.kilometers_per_second);
  const approachTimestamp = numericValue(closeApproach.epoch_date_close_approach)
    ?? Date.parse(`${closeApproach.close_approach_date ?? requestedDate}T${closeApproach.close_approach_time ?? "00:00"}:00Z`);
  const orbitalData = neo.orbital_data && typeof neo.orbital_data === "object" ? neo.orbital_data : {};

  return {
    id: String(neo.id ?? neo.neo_reference_id ?? neo.name ?? ""),
    name: String(neo.name ?? neo.id ?? "Unnamed near-Earth object"),
    designation: String(neo.designation ?? neo.name ?? neo.neo_reference_id ?? neo.id ?? "Unspecified"),
    neoReferenceId: String(neo.neo_reference_id ?? neo.id ?? "—"),
    date: closeApproach.close_approach_date ?? requestedDate,
    dateFull: String(closeApproach.close_approach_date_full ?? closeApproach.close_approach_date ?? requestedDate),
    approachTimestamp: Number.isFinite(approachTimestamp) ? approachTimestamp : null,
    distanceKm,
    distanceAu,
    diameterMinMeters,
    diameterMaxMeters,
    diameterMeters: diameterMinMeters !== null && diameterMaxMeters !== null
      ? (diameterMinMeters + diameterMaxMeters) / 2
      : diameterMaxMeters ?? diameterMinMeters,
    velocityKmS,
    hazardous: typeof neo.is_potentially_hazardous_asteroid === "boolean"
      ? neo.is_potentially_hazardous_asteroid
      : null,
    jplUrl: String(neo.nasa_jpl_url ?? ""),
    orbitInfo: {
      orbitClass: String(orbitalData.orbit_class?.orbit_class_description
        ?? orbitalData.orbit_class?.orbit_class_type
        ?? orbitalData.orbit_class?.abbreviation
        ?? ""),
      semiMajorAxisAu: numericValue(orbitalData.semi_major_axis),
      orbitalPeriodDays: numericValue(orbitalData.orbital_period),
      inclinationDeg: numericValue(orbitalData.inclination),
      eccentricity: numericValue(orbitalData.eccentricity)
    }
  };
}

function hazardLabel(asteroid) {
  if (asteroid.hazardous === true) return "Potentially hazardous";
  if (asteroid.hazardous === false) return "Not potentially hazardous";
  return "Status unavailable";
}

function hazardClass(asteroid) {
  if (asteroid.hazardous === true) return "hazardous";
  if (asteroid.hazardous === false) return "safe";
  return "unknown";
}

function setFeedMessage(state, message) {
  feedStatus.hidden = false;
  feedStatus.dataset.state = state;
  feedStatus.setAttribute("role", state === "error" ? "alert" : "status");
  feedStatus.textContent = message;
}

function setConnectionStatus(state, label, detail = "") {
  const status = document.querySelector("#api-status");
  const statusLabel = document.querySelector("#api-status-label");
  const dot = document.querySelector("#api-status-dot");
  status.classList.toggle("error", state === "error");
  status.textContent = label;
  statusLabel.textContent = detail;
  dot.classList.remove("loading", "error");
  if (state === "loading") dot.classList.add("loading");
  if (state === "error") dot.classList.add("error");
}

function resetDetails() {
  document.querySelector("#detail-empty").style.display = "grid";
  const detail = document.querySelector("#detail-content");
  detail.style.display = "none";
  detail.innerHTML = "";
}

function renderTable() {
  const query = searchInput.value.trim().toLowerCase();
  const classification = hazardFilter.value;
  const minRaw = minimumDiameterInput.value.trim();
  const maxRaw = maximumDiameterInput.value.trim();
  const minDiameter = minRaw === "" ? null : Number(minRaw);
  const maxDiameter = maxRaw === "" ? null : Number(maxRaw);
  const minInvalid = minRaw !== "" && (!Number.isFinite(minDiameter) || minDiameter < 0);
  const maxInvalid = maxRaw !== "" && (!Number.isFinite(maxDiameter) || maxDiameter < 0);
  const diameterError = minInvalid
    ? "Enter a valid minimum diameter of 0 meters or more."
    : maxInvalid
      ? "Enter a valid maximum diameter of 0 meters or more."
      : minDiameter !== null && maxDiameter !== null && minDiameter > maxDiameter
        ? "Minimum diameter must not exceed maximum diameter."
        : "";
  diameterFilterMessage.hidden = !diameterError;
  diameterFilterMessage.textContent = diameterError;
  minimumDiameterInput.setAttribute("aria-invalid", String(minInvalid || Boolean(diameterError && !maxInvalid)));
  maximumDiameterInput.setAttribute("aria-invalid", String(maxInvalid || Boolean(diameterError && !minInvalid)));

  const list = diameterError ? [] : asteroids.filter((item) => {
    const matchesQuery = `${item.name} ${item.designation} ${item.id}`.toLowerCase().includes(query);
    const matchesHazard = classification === "all"
      || (classification === "hazardous" && item.hazardous === true)
      || (classification === "safe" && item.hazardous === false);
    const matchesMinimum = minDiameter === null || (item.diameterMeters !== null && item.diameterMeters >= minDiameter);
    const matchesMaximum = maxDiameter === null || (item.diameterMeters !== null && item.diameterMeters <= maxDiameter);
    return matchesQuery && matchesHazard && matchesMinimum && matchesMaximum;
  });

  const sortKey = sortBy === "distance" ? "distanceKm"
    : sortBy === "diameter" ? "diameterMeters"
      : sortBy === "velocity" ? "velocityKmS"
        : sortBy === "date" ? "approachTimestamp"
          : "name";
  list.sort((first, second) => {
    if (typeof first[sortKey] === "string") {
      return first[sortKey].localeCompare(second[sortKey]) * sortDirection;
    }
    const a = first[sortKey] ?? Number.POSITIVE_INFINITY;
    const b = second[sortKey] ?? Number.POSITIVE_INFINITY;
    return (a - b) * sortDirection;
  });

  document.querySelector("#table-count").textContent =
    `${list.length}${list.length !== asteroids.length ? ` / ${asteroids.length}` : ""} OBJECT${list.length === 1 ? "" : "S"}`;

  if (!asteroids.length) {
    const message = isLoading
      ? "Loading asteroid records from NASA NeoWs…"
      : feedError
        ? "No NASA feed records are available. Check the message above and try again."
        : selectedFeedDate
          ? "NASA returned no near-Earth objects for this date."
          : "Choose a UTC date to load NASA asteroid records.";
    rows.innerHTML = `<tr><td class="empty-row" colspan="7">${escapeHtml(message)}</td></tr>`;
    return;
  }

  if (!list.length) {
    const emptyMessage = diameterError
      ? "Correct the diameter limits above to show asteroid records."
      : query
        ? `No NASA objects match “${query}”. Try another name or designation, or adjust the filters.`
        : "No NASA objects match the selected diameter and hazard filters.";
    rows.innerHTML = `<tr><td class="empty-row" colspan="7">${escapeHtml(emptyMessage)}</td></tr>`;
    return;
  }

  rows.innerHTML = list.map((item) => {
    const selected = selectedId === item.id ? "selected" : "";
    return `<tr data-id="${escapeHtml(item.id)}" class="${selected}" tabindex="0" aria-label="Select asteroid ${escapeHtml(item.designation)}">
      <td><div class="object-cell"><span class="object-orbit">◉</span><span>${escapeHtml(item.designation)}</span></div></td>
      <td>${escapeHtml(formatDate(item.date))}</td>
      <td class="mono distance">${escapeHtml(formatKilometers(item.distanceKm))}</td>
      <td class="mono">${escapeHtml(formatDiameterRange(item))}</td>
      <td class="mono">${item.velocityKmS === null ? "—" : `${formatNumber(item.velocityKmS, 2)} km/s`}</td>
      <td><span class="hazard ${hazardClass(item)}">${escapeHtml(hazardLabel(item))}</span></td>
      <td class="select-arrow">›</td></tr>`;
  }).join("");

  rows.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => selectAsteroid(row.dataset.id, row));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectAsteroid(row.dataset.id, row);
      }
    });
  });
}

function safeJplUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "ssd.jpl.nasa.gov" ? url.href : "";
  } catch {
    return "";
  }
}

function orbitDetailsMarkup(asteroid) {
  const orbit = asteroid.orbitInfo;
  const details = [
    ["Orbit class", orbit.orbitClass],
    ["Semi-major axis", Number.isFinite(orbit.semiMajorAxisAu) ? `${formatNumber(orbit.semiMajorAxisAu, 5)} AU` : ""],
    ["Orbital period", Number.isFinite(orbit.orbitalPeriodDays) ? `${formatNumber(orbit.orbitalPeriodDays, 2)} days` : ""],
    ["Inclination", Number.isFinite(orbit.inclinationDeg) ? `${formatNumber(orbit.inclinationDeg, 4)}°` : ""],
    ["Eccentricity", Number.isFinite(orbit.eccentricity) ? formatNumber(orbit.eccentricity, 5) : ""]
  ].filter(([, value]) => value);
  const jplUrl = safeJplUrl(asteroid.jplUrl);
  const rowsMarkup = details.length
    ? `<div class="orbit-grid">${details.map(([label, value]) => `<div class="orbit-value"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`
    : `<p class="orbit-unavailable">Orbital parameters are not included in this NeoWs feed record.</p>`;
  const referenceMarkup = jplUrl
    ? `<a class="button detail-action" href="${escapeHtml(jplUrl)}" target="_blank" rel="noopener noreferrer">Open NASA JPL record <span aria-hidden="true">↗</span></a>`
    : `<p class="orbit-unavailable">No JPL reference link was supplied for this object.</p>`;
  return `<section class="orbit-section" aria-label="Orbit and reference information"><h3>Orbit / reference</h3>${rowsMarkup}${referenceMarkup}</section>`;
}

function asteroidModalMarkup(asteroid) {
  const diameter = formatDiameterRange(asteroid);
  const velocity = asteroid.velocityKmS === null ? "Unavailable" : `${formatNumber(asteroid.velocityKmS, 2)} km/s`;
  const distance = `${formatKilometers(asteroid.distanceKm)} · ${formatAstronomicalUnits(asteroid.distanceAu)}`;
  const approachDate = `${asteroid.dateFull} UTC`;
  return `<div class="asteroid-modal-detail">
    <div class="detail-top"><div><p class="section-kicker">Near-Earth object dossier</p><div class="detail-name">${escapeHtml(asteroid.name)}</div><div class="detail-id">NASA designation · ${escapeHtml(asteroid.designation)}</div></div><span class="hazard ${hazardClass(asteroid)}">${escapeHtml(hazardLabel(asteroid))}</span></div>
    <div class="detail-metrics">
      <div class="detail-metric"><small>NASA designation</small><strong>${escapeHtml(asteroid.designation)}</strong></div>
      <div class="detail-metric"><small>NeoWs reference ID</small><strong>${escapeHtml(asteroid.neoReferenceId)}</strong></div>
      <div class="detail-metric"><small>Potentially hazardous</small><strong>${escapeHtml(hazardLabel(asteroid))}</strong></div>
      <div class="detail-metric"><small>Estimated diameter</small><strong>${escapeHtml(diameter)}</strong></div>
      <div class="detail-metric"><small>Relative velocity</small><strong>${escapeHtml(velocity)}</strong></div>
      <div class="detail-metric"><small>Miss distance from Earth</small><strong>${escapeHtml(distance)}</strong></div>
      <div class="detail-metric"><small>Close approach · UTC</small><strong>${escapeHtml(approachDate)}</strong></div>
    </div>
    <p class="detail-copy">Diameter is NASA's estimated range. The potentially hazardous flag is a screening classification, not an impact prediction.</p>
    ${orbitDetailsMarkup(asteroid)}
    <div class="modal-actions"><button class="button primary" id="asteroid-modal-back" type="button"><span aria-hidden="true">←</span> Back to asteroid list</button></div>
  </div>`;
}

function selectAsteroid(id, returnFocusTo = null) {
  const asteroid = asteroids.find((item) => item.id === id);
  if (!asteroid) return;
  selectedId = id;
  renderTable();
  const tableRow = [...rows.querySelectorAll("tr[data-id]")].find((row) => row.dataset.id === id);
  const focusTarget = returnFocusTo?.isConnected ? returnFocusTo : tableRow;
  document.querySelector("#detail-empty").style.display = "none";
  const detail = document.querySelector("#detail-content");
  const jplUrl = safeJplUrl(asteroid.jplUrl);
  const reference = jplUrl
    ? `<a class="button detail-action" href="${escapeHtml(jplUrl)}" target="_blank" rel="noopener noreferrer">Open NASA JPL record <span aria-hidden="true">↗</span></a>`
    : "";
  detail.style.display = "block";
  detail.innerHTML = `<div class="detail-top"><div><div class="detail-name">${escapeHtml(asteroid.name)}</div><div class="detail-id">NeoWs ID ${escapeHtml(asteroid.id)} · NASA JPL</div></div><span class="hazard ${hazardClass(asteroid)}">${escapeHtml(hazardLabel(asteroid))}</span></div>
    <div class="detail-metrics">
      <div class="detail-metric"><small>Close approach · UTC</small><strong>${escapeHtml(asteroid.dateFull)}</strong></div>
      <div class="detail-metric"><small>Miss distance</small><strong>${escapeHtml(formatKilometers(asteroid.distanceKm))}<br>${escapeHtml(formatAstronomicalUnits(asteroid.distanceAu))}</strong></div>
      <div class="detail-metric"><small>Estimated diameter</small><strong>${escapeHtml(formatDiameterRange(asteroid))}</strong></div>
      <div class="detail-metric"><small>Relative velocity</small><strong>${asteroid.velocityKmS === null ? "—" : `${formatNumber(asteroid.velocityKmS, 2)} km/s`}</strong></div>
    </div>
    <p class="detail-copy">Diameter is NASA's estimated range. The potentially hazardous flag is a screening classification, not a prediction of impact or a probability of collision.</p>
    <button class="button detail-action" id="focus-approach">View close-approach list <span aria-hidden="true">→</span></button>${reference}`;
  document.querySelector("#focus-approach").addEventListener("click", () => {
    document.querySelector("#approaches").scrollIntoView({ behavior: "smooth" });
    showToast(`${asteroid.name} selected`, "Showing its NASA close-approach record.");
  });
  openModal("Asteroid details", asteroidModalMarkup(asteroid), focusTarget);
  document.querySelector("#asteroid-modal-back").addEventListener("click", () => {
    closeModal(false);
    document.querySelector("#explorer").scrollIntoView({ behavior: "smooth", block: "start" });
    const currentRow = [...rows.querySelectorAll("tr[data-id]")].find((row) => row.dataset.id === id);
    (currentRow || searchInput).focus({ preventScroll: true });
  });
}

function renderApproaches() {
  const list = [...asteroids]
    .sort((first, second) => (first.distanceKm ?? Infinity) - (second.distanceKm ?? Infinity))
    .slice(0, 8);
  const container = document.querySelector("#approach-list");
  document.querySelector("#approach-date-label").textContent = selectedFeedDate
    ? formatShortDate(selectedFeedDate)
    : "SELECT DATE";

  if (!list.length) {
    const message = isLoading ? "Loading NASA approach records…" : "No approach records for this date.";
    container.innerHTML = `<div class="empty-row">${escapeHtml(message)}</div>`;
    return;
  }

  container.innerHTML = list.map((item) =>
    `<button type="button" class="approach" data-id="${escapeHtml(item.id)}" aria-label="View ${escapeHtml(item.name)} close approach">
      <span class="approach-date">${escapeHtml(formatShortDate(item.date))}</span>
      <span><span class="approach-name">${escapeHtml(item.name)}</span><span class="approach-detail">${escapeHtml(hazardLabel(item))} · ${item.velocityKmS === null ? "velocity unavailable" : `${formatNumber(item.velocityKmS, 2)} km/s`}</span></span>
      <span class="approach-distance">${escapeHtml(formatAstronomicalUnits(item.distanceAu))}<small>${escapeHtml(formatKilometers(item.distanceKm))}</small></span>
    </button>`
  ).join("");
  container.querySelectorAll(".approach").forEach((button) => {
    button.addEventListener("click", () => {
      selectAsteroid(button.dataset.id, button);
    });
  });
}

function setStatValue(selector, value, unit = "") {
  const node = document.querySelector(selector);
  const valueText = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
  if (valueText) valueText.nodeValue = String(value);
  else node.prepend(document.createTextNode(String(value)));
  const unitNode = node.querySelector("em");
  if (unitNode) unitNode.textContent = unit;
}

function renderStats() {
  const total = asteroids.length;
  const hazardous = asteroids.filter((item) => item.hazardous === true).length;
  const closest = asteroids
    .filter((item) => Number.isFinite(item.distanceKm))
    .sort((first, second) => first.distanceKm - second.distanceKm)[0];
  const largest = asteroids
    .filter((item) => Number.isFinite(item.diameterMaxMeters))
    .sort((first, second) => second.diameterMaxMeters - first.diameterMaxMeters)[0];
  const velocities = asteroids.map((item) => item.velocityKmS).filter(Number.isFinite);
  const averageVelocity = velocities.length
    ? velocities.reduce((sum, velocity) => sum + velocity, 0) / velocities.length
    : null;

  document.querySelector("#stat-total").textContent = total.toLocaleString("en-US");
  document.querySelector("#stat-hazardous").textContent = hazardous.toLocaleString("en-US");
  document.querySelector("#stat-total-note").textContent = selectedFeedDate ? formatShortDate(selectedFeedDate) : "NASA NeoWs";
  document.querySelector("#stat-hazard-note").textContent = total
    ? `${(hazardous / total * 100).toFixed(1)}% of feed`
    : "Selected date";
  setStatValue("#stat-closest", closest
    ? (closest.distanceKm >= 1000000 ? (closest.distanceKm / 1000000).toFixed(2) : Math.round(closest.distanceKm).toLocaleString("en-US"))
    : "—", closest ? (closest.distanceKm >= 1000000 ? "M km" : "km") : "");
  setStatValue("#stat-largest", largest ? formatDiameter(largest.diameterMaxMeters).replace(/ (km|m)$/, "") : "—",
    largest ? formatDiameter(largest.diameterMaxMeters).match(/ (km|m)$/)?.[1] ?? "" : "");
  setStatValue("#stat-velocity", averageVelocity === null ? "—" : averageVelocity.toFixed(1), "km/s");

  document.querySelector("#hero-feed-date").textContent = selectedFeedDate ? formatDate(selectedFeedDate) : "—";
  document.querySelector("#hero-nearest").textContent = closest
    ? formatAstronomicalUnits(closest.distanceAu)
    : "—";
}

function renderClassification() {
  const total = asteroids.length;
  const hazardous = asteroids.filter((item) => item.hazardous === true).length;
  const safe = asteroids.filter((item) => item.hazardous === false).length;
  const hazardousPercent = total ? hazardous / total * 100 : 0;
  const safePercent = total ? safe / total * 100 : 0;
  document.querySelector("#hazard-bar").style.width = `${hazardousPercent}%`;
  document.querySelector("#safe-bar").style.width = `${safePercent}%`;
  document.querySelector("#hazard-percent").textContent = total ? `${hazardousPercent.toFixed(1)}%` : "—";
  document.querySelector("#safe-percent").textContent = total ? `${safePercent.toFixed(1)}%` : "—";
}

function renderSizeBands() {
  const bands = [
    (diameter) => diameter < 100,
    (diameter) => diameter >= 100 && diameter < 1000,
    (diameter) => diameter >= 1000 && diameter <= 5000,
    (diameter) => diameter > 5000
  ];
  bands.forEach((matches, index) => {
    const count = asteroids.filter((item) => item.diameterMeters !== null && matches(item.diameterMeters)).length;
    const percent = asteroids.length ? count / asteroids.length * 100 : 0;
    document.querySelector(`#size-bar-${index + 1}`).style.width = `${percent}%`;
    document.querySelector(`#size-count-${index + 1}`).textContent = asteroids.length ? String(count) : "—";
  });
}

function renderCharts() {
  const distanceList = [...asteroids]
    .filter((item) => Number.isFinite(item.distanceAu))
    .sort((first, second) => first.distanceAu - second.distanceAu);
  const visibleDistanceList = selectedLimit ? distanceList.slice(0, selectedLimit) : distanceList;
  const chartNode = document.querySelector("#detection-chart");

  if (!visibleDistanceList.length) {
    chartNode.innerHTML = `<div class="chart-empty">${isLoading ? "Loading NASA miss distances…" : "Load a date to chart its NASA miss distances."}</div>`;
  } else {
    const width = 650;
    const height = 140;
    const left = 50;
    const right = 8;
    const top = 9;
    const bottom = 26;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const maxDistance = Math.max(...visibleDistanceList.map((item) => item.distanceAu), 0.0001);
    const points = visibleDistanceList.map((item, index) => ({
      item,
      x: left + (visibleDistanceList.length === 1 ? innerWidth / 2 : innerWidth * index / (visibleDistanceList.length - 1)),
      y: top + innerHeight - item.distanceAu / maxDistance * innerHeight
    }));
    const linePath = points.map((point, index) =>
      `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`
    ).join(" ");
    const areaPath = `${linePath} L${points.at(-1).x},${height - bottom} L${points[0].x},${height - bottom} Z`;
    const yGrid = [0, 1, 2, 3].map((index) => {
      const y = top + index * innerHeight / 3;
      const axis = formatAstronomicalUnits(maxDistance * (1 - index / 3)).replace(" AU", "");
      return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-axis" x="0" y="${y + 3}">${escapeHtml(axis)}</text>`;
    }).join("");
    const labelStep = Math.max(1, Math.ceil(points.length / 8));
    const xLabels = points.map((point, index) => {
      if (index % labelStep !== 0 && index !== points.length - 1) return "";
      const label = point.item.name.length > 8 ? `${point.item.name.slice(0, 7)}…` : point.item.name;
      return `<text class="chart-axis" x="${point.x}" y="${height - 4}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }).join("");
    const dots = points.map((point, index) =>
      `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3" tabindex="0" data-index="${index}" aria-label="${escapeHtml(point.item.name)}: ${escapeHtml(formatAstronomicalUnits(point.item.distanceAu))}"><title>${escapeHtml(point.item.name)} · ${escapeHtml(formatAstronomicalUnits(point.item.distanceAu))} · ${escapeHtml(formatKilometers(point.item.distanceKm))}</title></circle>`
    ).join("");
    chartNode.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="NASA miss distances in astronomical units"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#63d6e9" stop-opacity=".22"/><stop offset="100%" stop-color="#63d6e9" stop-opacity="0"/></linearGradient></defs>${yGrid}<path class="chart-area" d="${areaPath}"/><path class="chart-line" d="${linePath}"/>${dots}${xLabels}</svg><div class="chart-tooltip"></div>`;
    const tooltip = chartNode.querySelector(".chart-tooltip");
    chartNode.querySelectorAll(".chart-point").forEach((point) => {
      const reveal = (event) => {
        const asteroid = visibleDistanceList[Number(point.dataset.index)];
        tooltip.textContent = `${asteroid.name} · ${formatAstronomicalUnits(asteroid.distanceAu)} · ${formatKilometers(asteroid.distanceKm)}`;
        const bounds = chartNode.getBoundingClientRect();
        tooltip.style.display = "block";
        tooltip.style.left = `${Math.max(0, Math.min(bounds.width - 205, event.clientX - bounds.left + 8))}px`;
        tooltip.style.top = `${Math.max(0, event.clientY - bounds.top - 24)}px`;
      };
      point.addEventListener("pointerenter", reveal);
      point.addEventListener("focus", (event) => {
        const rect = event.target.getBoundingClientRect();
        reveal({ clientX: rect.left, clientY: rect.top });
      });
      point.addEventListener("pointerleave", () => { tooltip.style.display = "none"; });
      point.addEventListener("blur", () => { tooltip.style.display = "none"; });
    });
  }

  const velocityList = [...asteroids]
    .filter((item) => Number.isFinite(item.velocityKmS))
    .sort((first, second) => second.velocityKmS - first.velocityKmS);
  const visibleVelocityList = selectedLimit ? velocityList.slice(0, selectedLimit) : velocityList;
  const maxVelocity = Math.max(...visibleVelocityList.map((item) => item.velocityKmS), 0);
  const labelStep = Math.max(1, Math.ceil(visibleVelocityList.length / 10));
  document.querySelector("#mini-bars").innerHTML = visibleVelocityList.length
    ? visibleVelocityList.map((item, index) => {
      const height = maxVelocity ? Math.max(4, item.velocityKmS / maxVelocity * 100) : 4;
      const label = index % labelStep === 0 || index === visibleVelocityList.length - 1
        ? (item.name.length > 7 ? `${item.name.slice(0, 6)}…` : item.name)
        : "";
      return `<div class="bar-col" title="${escapeHtml(item.name)} · ${formatNumber(item.velocityKmS, 2)} km/s"><div class="bar" style="height:${height}%"></div><small>${escapeHtml(label)}</small></div>`;
    }).join("")
    : `<div class="chart-empty">${isLoading ? "Loading NASA velocities…" : "No velocity records for this date."}</div>`;

  const periodText = selectedLimit
    ? `Top ${Math.min(selectedLimit, asteroids.length)} objects`
    : `All ${asteroids.length} objects`;
  document.querySelector("#analytics-period").textContent = periodText;
  document.querySelectorAll(".period-button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.limit) === selectedLimit);
  });
}

function renderDashboard() {
  renderTable();
  renderApproaches();
  renderStats();
  renderClassification();
  renderSizeBands();
  renderCharts();
}

function openModal(title, html, returnFocusTo = document.activeElement) {
  modalReturnFocus = returnFocusTo;
  document.querySelector("#modal-title").textContent = title;
  document.querySelector("#modal-body").innerHTML = html;
  const backdrop = document.querySelector("#modal-backdrop");
  backdrop.classList.add("open");
  document.querySelector(".modal").classList.toggle("wide", title === "Asteroid details");
  document.querySelector("#modal-close").focus();
}

function closeModal(restoreFocus = true) {
  document.querySelector("#modal-backdrop").classList.remove("open");
  document.querySelector(".modal").classList.remove("wide");
  const focusTarget = modalReturnFocus;
  modalReturnFocus = null;
  if (restoreFocus && focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
}

function csvField(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportApproaches() {
  if (!asteroids.length) {
    showToast("No schedule to export", "Load a date with NASA approach records first.");
    return;
  }
  const columns = [
    "Close approach date UTC",
    "Object",
    "Potentially hazardous",
    "Estimated diameter minimum (m)",
    "Estimated diameter maximum (m)",
    "Relative velocity (km/s)",
    "Miss distance (km)",
    "Miss distance (AU)"
  ];
  const csv = [
    columns.map(csvField).join(","),
    ...asteroids.map((item) => [
      item.dateFull,
      item.name,
      item.hazardous === null ? "Unknown" : item.hazardous ? "Yes" : "No",
      item.diameterMinMeters,
      item.diameterMaxMeters,
      item.velocityKmS,
      item.distanceKm,
      item.distanceAu
    ].map(csvField).join(","))
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `asteroid-sentinel-neows-${selectedFeedDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("NASA schedule exported", `${asteroids.length} selected-date approach records saved.`);
}

function handleAction(action) {
  if (action === "about") {
    openModal("About Asteroid Sentinel", `<p>Asteroid Sentinel displays NASA's Near Earth Object Web Service (NeoWs) feed for a date selected in UTC.</p><div class="modal-data">DATA FEED: NASA NEOWS<br>REQUEST: ONE UTC DATE<br>HAZARD FLAG: NASA PHA CLASSIFICATION<br>STORAGE: NONE</div><p>Asteroid Sentinel does not save feed data or make impact predictions.</p>`);
  } else if (action === "settings") {
    openModal("Console settings", `<p>Display preferences for this local session.</p><div class="modal-data">TIME DISPLAY&nbsp;&nbsp; UTC<br>DATA SOURCE&nbsp;&nbsp; NASA NeoWs<br>ALERTS&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; On-screen only</div><p>Feed results are requested directly from NASA and held only in this browser session.</p><button class="button" id="settings-done">Understood</button>`);
    document.querySelector("#settings-done").addEventListener("click", closeModal);
  } else if (action === "risk-info") {
    openModal("About NASA hazard status", `<p>The potentially hazardous asteroid flag comes from NASA NeoWs. It is a screening classification based on estimated size and orbital proximity—not a prediction that an object will impact Earth.</p><div class="modal-data">TRUE · potentially hazardous asteroid<br>FALSE · not classified as potentially hazardous<br>UNKNOWN · flag not present in the feed response</div><p>Use NASA and JPL source records for authoritative scientific context.</p>`);
  } else if (action === "data-notice") {
    openModal("Data notice", `<p>Asteroid Sentinel fetches date-specific asteroid records directly from NASA NeoWs. Close-approach dates, estimated diameters, relative velocities, miss distances, and NASA's potentially hazardous flag are displayed from the feed response.</p><div class="modal-data">Source: api.nasa.gov/neo/rest/v1/feed<br>Measurements are estimates supplied by NASA.<br>The hazard flag is not an impact prediction.<br>No database or server stores the selected feed.</div>`);
  } else if (action === "approach-export") {
    exportApproaches();
  }
}

function updateClock() {
  document.querySelector("#utc-clock").textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

async function loadFeed(date) {
  if (isLoading) return;
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (!date) {
    feedError = "Choose a date before requesting the NASA feed.";
    setFeedMessage("error", feedError);
    return;
  }
  if (date > todayUtc) {
    feedError = "Choose today or an earlier UTC date. Future feed dates are not available.";
    setFeedMessage("error", feedError);
    return;
  }

  isLoading = true;
  feedError = "";
  selectedFeedDate = "";
  selectedId = null;
  asteroids = [];
  resetDetails();
  loadFeedButton.disabled = true;
  loadFeedButton.textContent = "Loading…";
  setFeedMessage("loading", `Requesting NASA NeoWs records for ${formatDate(date)}…`);
  setConnectionStatus("loading", "FETCHING", "Requesting NASA NeoWs data…");
  renderDashboard();

  let timeoutId;
  try {
    let rawRecords = feedCache.get(date);
    const loadedFromCache = Array.isArray(rawRecords);
    if (!loadedFromCache) {
      const url = new URL(NASA_FEED_URL);
      url.searchParams.set("start_date", date);
      url.searchParams.set("end_date", date);
      url.searchParams.set("api_key", NASA_API_KEY);
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), 20000);
      const response = await fetch(url, { signal: controller.signal });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) {
        if (response.status === 429 || payload.code === 429) {
          throw new Error("NASA's public DEMO_KEY rate limit was reached. Wait and try again later.");
        }
        const message = payload.error?.message || payload.msg || `NASA NeoWs returned HTTP ${response.status}.`;
        throw new Error(message);
      }
      rawRecords = payload.near_earth_objects?.[date];
      if (!Array.isArray(rawRecords)) {
        throw new Error("NASA returned a response without asteroid records for that date.");
      }
      feedCache.set(date, rawRecords);
    }

    asteroids = rawRecords
      .map((record) => normalizeAsteroid(record, date))
      .filter((record) => record !== null);
    selectedFeedDate = date;
    feedError = "";
    renderDashboard();

    const loadedAt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
    const message = `Loaded ${asteroids.length} asteroid${asteroids.length === 1 ? "" : "s"} for ${formatDate(date)} from NASA NeoWs${loadedFromCache ? " (session cache)" : ""}.`;
    setFeedMessage("success", message);
    setConnectionStatus("success", "CONNECTED", `${asteroids.length} objects · ${date}`);
    document.querySelector("#last-updated").textContent = `Updated ${loadedAt} UTC · ${date}`;
  } catch (error) {
    asteroids = [];
    selectedFeedDate = "";
    selectedId = null;
    feedError = error.name === "AbortError"
      ? "NASA NeoWs did not respond within 20 seconds. Try again."
      : error instanceof TypeError
        ? "Could not reach api.nasa.gov. Check the connection and try again."
        : error.message || "The NASA feed request failed. Try again.";
    resetDetails();
    renderDashboard();
    setFeedMessage("error", feedError);
    setConnectionStatus("error", "UNAVAILABLE", "NASA NeoWs request failed.");
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    isLoading = false;
    loadFeedButton.disabled = false;
    loadFeedButton.textContent = "Load date";
    renderTable();
    renderApproaches();
    renderCharts();
  }
}

document.querySelectorAll(".nav-link[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    const target = button.dataset.target;
    document.querySelector(`#${target}`).scrollIntoView({ behavior: "smooth" });
    document.querySelector("#current-crumb").textContent = button.textContent.trim();
  });
});
document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.scroll}`).scrollIntoView({ behavior: "smooth" }));
});
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => handleAction(button.dataset.action));
});
document.querySelectorAll(".period-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedLimit = Number(button.dataset.limit);
    renderCharts();
  });
});
feedForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadFeed(feedDate.value);
});
searchInput.addEventListener("input", renderTable);
hazardFilter.addEventListener("change", renderTable);
minimumDiameterInput.addEventListener("input", renderTable);
maximumDiameterInput.addEventListener("input", renderTable);
sortSelect.addEventListener("change", () => {
  sortBy = sortSelect.value;
  sortDirection = 1;
  renderTable();
});
document.querySelectorAll("th button[data-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    if (sortBy === button.dataset.sort) sortDirection *= -1;
    else {
      sortBy = button.dataset.sort;
      sortDirection = 1;
    }
    sortSelect.value = sortBy;
    renderTable();
  });
});
document.querySelector("#search-focus").addEventListener("click", () => {
  document.querySelector("#explorer").scrollIntoView({ behavior: "smooth" });
  window.setTimeout(() => searchInput.focus(), 450);
});
document.querySelector("#notifications").addEventListener("click", () => {
  showToast("No alert service configured", "NASA feed data is available, but alerts are not enabled.");
});
document.querySelector("#modal-close").addEventListener("click", closeModal);
document.querySelector("#modal-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "modal-backdrop") closeModal();
});
document.addEventListener("keydown", (event) => {
  const modalBackdrop = document.querySelector("#modal-backdrop");
  if (!modalBackdrop.classList.contains("open")) return;
  if (event.key === "Escape") {
    closeModal();
    return;
  }
  if (event.key === "Tab") {
    const focusable = [...modalBackdrop.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

feedDate.max = new Date().toISOString().slice(0, 10);
feedDate.value = feedDate.max;
renderDashboard();
updateClock();
window.setInterval(updateClock, 1000);
loadFeed(feedDate.value);