const DATA_PATHS = {
  pins: "./data/pins.json",
  trie: "./data/pin-trie.json",
  groups: "./data/prefix-groups.json",
  map: "./data/india-outline.geojson",
};

const PALETTE = [
  "#d94841",
  "#f77f00",
  "#f4b400",
  "#43aa8b",
  "#277da1",
  "#4361ee",
  "#8338ec",
  "#ef476f",
  "#118ab2",
  "#6a994e",
];

const HIERARCHY_TITLES = {
  "zone": "Zones",
  "sub-zone": "Sub-zones",
  "sorting district": "Sorting districts",
  "digit 4": "Digit 4 split",
  "digit 5": "Digit 5 split",
  "digit 6": "Final digit split",
  "exact PIN": "Exact PIN",
};

const INDIA_BOUNDS = [
  [6.0, 68.0],
  [38.5, 98.5],
];

const elements = {
  mapStatus: document.getElementById("map-status"),
  pinInput: document.getElementById("pin-input"),
  searchShell: document.getElementById("search-shell"),
  slotRow: document.getElementById("slot-row"),
  clearButton: document.getElementById("clear-button"),
  currentPattern: document.getElementById("current-pattern"),
  activeLevel: document.getElementById("active-level"),
  heroHint: document.getElementById("hero-hint"),
  pinCount: document.getElementById("pin-count"),
  mappedCount: document.getElementById("mapped-count"),
  groupCount: document.getElementById("group-count"),
  trieDepth: document.getElementById("trie-depth"),
  legend: document.getElementById("legend"),
  hoverCard: document.getElementById("hover-card"),
  prefixPath: document.getElementById("prefix-path"),
};

const state = {
  prefix: "",
  pins: [],
  pinsById: [],
  trieRoot: null,
  prefixGroups: null,
  mapGeo: null,
  renderState: null,
  map: null,
  tileLayer: null,
  outlineLayer: null,
  markerLayer: null,
  canvasRenderer: null,
  markersById: new Map(),
  hoveredPinId: null,
};

function sanitizePrefix(raw) {
  return (raw || "").replace(/\D/g, "").slice(0, 6);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function getColor(index) {
  return PALETTE[index % PALETTE.length];
}

function getEntry(prefix) {
  return state.prefixGroups?.prefixes?.[prefix] ?? null;
}

function walkTrie(prefix) {
  let node = state.trieRoot;
  for (const digit of prefix) {
    node = node?.children?.[digit];
    if (!node) {
      return null;
    }
  }
  return node;
}

function buildRenderState(prefix) {
  const trieNode = walkTrie(prefix);
  const entry = getEntry(prefix);

  if (!trieNode || !entry) {
    return {
      prefix,
      trieNode: null,
      entry: null,
      groups: [],
      pinIds: [],
      mappedPinIds: [],
      levelName: "Unknown",
      levelKey: "unknown",
    };
  }

  const groups =
    entry.groups.length > 0
      ? entry.groups
      : [
          {
            key: prefix || "all",
            prefix,
            label: prefix ? `PIN ${prefix}` : "All India",
            pinCount: entry.pinCount,
            mappedPinCount: entry.mappedPinCount,
            pinIds: entry.pinIds,
            mappedPinIds: entry.mappedPinIds,
          },
        ];

  return {
    prefix,
    trieNode,
    entry,
    groups,
    pinIds: entry.pinIds,
    mappedPinIds: entry.mappedPinIds,
    levelName: HIERARCHY_TITLES[entry.level] || entry.level,
    levelKey: entry.level,
  };
}

function updateSlots(prefix) {
  const slots = [...elements.slotRow.children];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const digit = prefix[index];
    slot.textContent = digit ?? "*";
    slot.classList.toggle("filled", Boolean(digit));
    slot.classList.toggle("active", index === Math.min(prefix.length, 5));
  }
}

function setStatusCopy(renderState) {
  if (!renderState.entry) {
    elements.mapStatus.textContent = "No matching prefix found in the trie.";
    return;
  }

  const pattern = (renderState.prefix || "").padEnd(6, "*");
  const total = formatNumber(renderState.entry.pinCount);
  const mapped = formatNumber(renderState.entry.mappedPinCount);
  elements.mapStatus.textContent = `${pattern} currently resolves to ${total} unique PINs, ${mapped} of them with usable coordinates.`;
}

function updateSummary(renderState) {
  const pattern = (renderState.prefix || "").padEnd(6, "*");
  elements.currentPattern.textContent = pattern;
  elements.activeLevel.textContent = renderState.levelName;
  elements.pinCount.textContent = formatNumber(renderState.entry?.pinCount ?? 0);
  elements.mappedCount.textContent = formatNumber(renderState.entry?.mappedPinCount ?? 0);
  elements.groupCount.textContent = formatNumber(renderState.groups.length);
  elements.trieDepth.textContent = `${renderState.prefix.length} / 6`;

  if (!renderState.prefix) {
    elements.heroHint.textContent = "Showing all India zones.";
  } else if (renderState.prefix.length < 6) {
    elements.heroHint.textContent = `${pattern} is active. Click a sidebar group to drill into the next digit.`;
  } else {
    elements.heroHint.textContent = `Exact match for ${renderState.prefix}. Click any chip in the sidebar to zoom back out.`;
  }

  setStatusCopy(renderState);
}

function renderPrefixPath(prefix) {
  const fragments = [
    '<button class="path-chip" data-prefix="">All India</button>',
  ];

  for (let index = 1; index <= prefix.length; index += 1) {
    const fragment = prefix.slice(0, index);
    const label =
      index === 1 ? `Zone ${fragment}` :
      index === 2 ? `Sub-zone ${fragment}` :
      index === 3 ? `District ${fragment}` :
      `Prefix ${fragment}`;
    fragments.push(`<button class="path-chip" data-prefix="${fragment}">${label}</button>`);
  }

  elements.prefixPath.innerHTML = fragments.join("");
}

function renderLegend(renderState) {
  renderPrefixPath(renderState.prefix);

  const items = renderState.groups
    .map((group, index) => {
      const color = getColor(index);
      const action = group.prefix === renderState.prefix && renderState.prefix.length === 6 ? "Focused" : "View";
      return `
        <button class="legend-item legend-button" type="button" data-prefix="${group.prefix}">
          <span class="swatch" style="background:${color}"></span>
          <span class="legend-copy">
            <strong>${group.label}</strong>
            <span class="legend-meta">${formatNumber(group.pinCount)} PINs · ${formatNumber(group.mappedPinCount)} mapped</span>
          </span>
          <span class="legend-action">${action}</span>
        </button>
      `;
    })
    .join("");

  elements.legend.innerHTML =
    items ||
    '<p class="empty-copy">No groups are available for this prefix. Keep typing or clear the search.</p>';
}

function renderHoverCard(pinRecord) {
  if (!pinRecord) {
    elements.hoverCard.innerHTML =
      '<p class="empty-copy">Hover a pin on the map to inspect the aggregated PIN metadata.</p>';
    return;
  }

  const coordMode = Object.entries(pinRecord.coordinateModes || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
  const officeSamples = pinRecord.officeSamples.length
    ? pinRecord.officeSamples.join(", ")
    : "No office samples available";
  const tags = [
    `Zone ${pinRecord.zone}`,
    `Sub-zone ${pinRecord.subzone}`,
    `District ${pinRecord.district}`,
    `${pinRecord.officeCount} offices`,
  ]
    .map((tag) => `<span class="detail-tag">${tag}</span>`)
    .join("");

  elements.hoverCard.innerHTML = `
    <article class="detail-keyline">
      <strong>${pinRecord.pin}</strong>
      <p>${pinRecord.state || "Unknown state"} · ${pinRecord.districtName || "Unknown district"}</p>
      <p class="detail-meta">Representative point: ${
        pinRecord.lat != null ? `${pinRecord.lat}, ${pinRecord.lon}` : "No renderable coordinate"
      }</p>
      <div class="detail-tag-row">${tags}</div>
    </article>
    <article class="detail-keyline">
      <p><strong>Office sample</strong></p>
      <p>${officeSamples}</p>
      <p class="detail-meta">Coordinate cleanup: ${coordMode || "No valid coordinates"}</p>
    </article>
  `;
}

function pointRadius(pinCount) {
  if (pinCount > 10000) return 3.2;
  if (pinCount > 5000) return 3.6;
  if (pinCount > 2500) return 4.0;
  if (pinCount > 1000) return 4.4;
  return 4.8;
}

function defaultMarkerStyle(renderState) {
  return {
    radius: pointRadius(renderState.entry?.mappedPinCount ?? 0),
    stroke: false,
    fillColor: "#a9b0bb",
    fillOpacity: renderState.prefix ? 0.22 : 0.86,
  };
}

function selectedMarkerStyle(color, renderState, isHovered) {
  return {
    radius: pointRadius(renderState.entry?.mappedPinCount ?? 0) + (isHovered ? 2.2 : 0),
    stroke: isHovered,
    weight: isHovered ? 1.4 : 0,
    color: isHovered ? "#fffaf2" : color,
    fillColor: color,
    fillOpacity: 0.9,
  };
}

function setHoveredPin(pinId) {
  if (state.hoveredPinId === pinId) {
    return;
  }

  state.hoveredPinId = pinId;
  renderHoverCard(pinId == null ? getExactPinRecord() : state.pinsById[pinId]);
  syncMarkerStyles(state.renderState);
}

function getExactPinRecord() {
  return state.renderState?.prefix.length === 6 && state.renderState.entry?.pinIds.length
    ? state.pinsById[state.renderState.entry.pinIds[0]]
    : null;
}

function syncMarkerStyles(renderState) {
  if (!renderState?.entry) {
    return;
  }

  const colorByPinId = new Map();
  renderState.groups.forEach((group, index) => {
    const color = getColor(index);
    group.mappedPinIds.forEach((pinId) => colorByPinId.set(pinId, color));
  });

  const mutedStyle = defaultMarkerStyle(renderState);
  for (const [pinId, marker] of state.markersById) {
    const selectedColor = colorByPinId.get(pinId);
    if (selectedColor) {
      marker.setStyle(selectedMarkerStyle(selectedColor, renderState, state.hoveredPinId === pinId));
    } else {
      marker.setStyle(mutedStyle);
    }
  }
}

function zoomToRenderState(renderState) {
  if (!state.map || !renderState?.entry) {
    return;
  }

  if (!renderState.prefix) {
    state.map.fitBounds(INDIA_BOUNDS, { padding: [24, 24] });
    return;
  }

  if (!renderState.entry.mappedPinIds.length) {
    return;
  }

  if (renderState.entry.mappedPinIds.length === 1) {
    const pin = state.pinsById[renderState.entry.mappedPinIds[0]];
    state.map.setView([pin.lat, pin.lon], 10, { animate: true });
    return;
  }

  const bounds = L.latLngBounds(
    renderState.entry.mappedPinIds.map((pinId) => {
      const pin = state.pinsById[pinId];
      return [pin.lat, pin.lon];
    }),
  );
  state.map.fitBounds(bounds.pad(0.18), { padding: [28, 28], maxZoom: 9 });
}

function applyPrefix(prefix, options = {}) {
  state.prefix = sanitizePrefix(prefix);
  elements.pinInput.value = state.prefix;
  state.renderState = buildRenderState(state.prefix);
  updateSlots(state.prefix);
  updateSummary(state.renderState);
  renderLegend(state.renderState);
  syncMarkerStyles(state.renderState);

  const exactRecord = getExactPinRecord();
  if (state.hoveredPinId != null && !state.renderState.entry?.pinIds.includes(state.hoveredPinId)) {
    state.hoveredPinId = null;
  }
  renderHoverCard(state.hoveredPinId == null ? exactRecord : state.pinsById[state.hoveredPinId]);

  if (options.zoom !== false) {
    zoomToRenderState(state.renderState);
  }
}

function initMap() {
  state.canvasRenderer = L.canvas({ padding: 0.5 });
  state.map = L.map("leaflet-map", {
    preferCanvas: true,
    zoomSnap: 0.25,
    minZoom: 4,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: true,
  });

  state.tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  state.outlineLayer = L.geoJSON(state.mapGeo, {
    style: {
      color: "#825627",
      weight: 2,
      opacity: 0.65,
      fillColor: "#fff4db",
      fillOpacity: 0.09,
    },
    interactive: false,
  }).addTo(state.map);

  state.markerLayer = L.layerGroup().addTo(state.map);

  state.pins.forEach((pin) => {
    if (pin.lat == null || pin.lon == null) {
      return;
    }

    const marker = L.circleMarker([pin.lat, pin.lon], {
      ...defaultMarkerStyle({ entry: { mappedPinCount: state.pins.length }, prefix: "" }),
      renderer: state.canvasRenderer,
      interactive: true,
      bubblingMouseEvents: false,
    });

    marker.on("mouseover", () => setHoveredPin(pin.id));
    marker.on("mouseout", () => setHoveredPin(null));
    marker.on("click", () => applyPrefix(pin.pin));
    marker.addTo(state.markerLayer);
    state.markersById.set(pin.id, marker);
  });
}

function bindEvents() {
  elements.searchShell.addEventListener("click", () => elements.pinInput.focus());
  elements.searchShell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.pinInput.focus();
    }
  });

  elements.pinInput.addEventListener("input", (event) => {
    applyPrefix(event.target.value);
  });

  elements.clearButton.addEventListener("click", () => {
    applyPrefix("");
    elements.pinInput.focus();
  });

  elements.legend.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prefix]");
    if (!button) {
      return;
    }
    applyPrefix(button.dataset.prefix || "");
    elements.pinInput.focus();
  });

  elements.prefixPath.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prefix]");
    if (!button) {
      return;
    }
    applyPrefix(button.dataset.prefix || "");
    elements.pinInput.focus();
  });
}

async function loadData() {
  const [pins, trie, groups, mapGeo] = await Promise.all(
    Object.values(DATA_PATHS).map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load ${path}`);
      }
      return response.json();
    }),
  );

  state.pins = pins;
  state.pinsById = pins;
  state.trieRoot = trie.root;
  state.prefixGroups = groups;
  state.mapGeo = mapGeo;
}

async function init() {
  try {
    await loadData();
    initMap();
    bindEvents();
    applyPrefix("", { zoom: true });
  } catch (error) {
    elements.mapStatus.textContent = "Failed to load local data assets. Serve the repo over a local HTTP server and try again.";
    elements.legend.innerHTML = `<p class="empty-copy">${error.message}</p>`;
    console.error(error);
  }
}

init();
