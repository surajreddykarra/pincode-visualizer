/**
 * PinMap - Leaflet map wrapper for the PIN Atlas app.
 * Renders ~19K pincodes as canvas-based circle markers, grouped by color,
 * with rich tooltips and smooth transitions.
 */
const PinMap = (() => {
  let map = null;
  let canvasRenderer = null;
  let markersLayer = null;
  let dimmedLayer = null;
  let tooltip = null;

  // India bounding box (with generous padding)
  const INDIA_BOUNDS = L.latLngBounds(
    L.latLng(6.0, 67.0),   // SW corner
    L.latLng(37.5, 98.0)   // NE corner
  );

  const DIMMED_COLOR = '#3a3a5c';
  const DIMMED_OPACITY = 0.45;

  /**
   * Initialize the Leaflet map in the given container.
   */
  function init(containerId) {
    canvasRenderer = L.canvas({ padding: 0.5 });

    map = L.map(containerId, {
      center: [22.5, 82.0],
      zoom: 5,
      minZoom: 4,
      maxZoom: 18,
      maxBounds: INDIA_BOUNDS.pad(0.2),
      maxBoundsViscosity: 0.9,
      renderer: canvasRenderer,
      zoomControl: true,
      attributionControl: true,
    });

    // CartoDB dark-matter tiles to match the app's dark theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Two layer groups: dimmed (background) and active (foreground)
    dimmedLayer = L.layerGroup().addTo(map);
    markersLayer = L.layerGroup().addTo(map);

    // Add simplified India boundary outline
    addIndiaBoundary();

    // Invalidate size after a tick to handle flex layout
    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => map.invalidateSize());

    return map;
  }

  /**
   * Add a subtle India boundary outline using an inline simplified polygon.
   * This is a very simplified version -- enough to show the country outline.
   */
  function addIndiaBoundary() {
    const indiaOutline = [
      [8.07, 77.55], [8.34, 76.87], [9.54, 76.33], [10.0, 76.24],
      [10.78, 75.93], [11.75, 75.32], [12.74, 74.86], [14.81, 74.05],
      [15.59, 73.81], [16.64, 73.31], [17.65, 73.08], [19.09, 72.86],
      [20.17, 72.83], [20.77, 72.02], [21.45, 72.18], [22.26, 72.34],
      [22.47, 69.14], [23.51, 68.37], [23.91, 68.70], [24.28, 68.86],
      [24.69, 69.58], [25.43, 70.10], [25.77, 70.68], [27.11, 70.45],
      [28.02, 71.10], [29.39, 71.84], [30.97, 73.38], [32.78, 74.56],
      [33.95, 75.37], [34.63, 76.05], [35.49, 77.80], [34.73, 78.73],
      [32.42, 79.48], [30.93, 79.36], [30.18, 81.12], [28.83, 83.35],
      [27.87, 84.14], [27.27, 85.40], [26.60, 86.71], [26.40, 88.02],
      [27.03, 88.78], [28.26, 88.89], [27.26, 92.07], [27.76, 93.15],
      [28.67, 96.15], [27.56, 97.05], [26.39, 97.31], [25.13, 97.73],
      [24.84, 97.38], [24.18, 94.75], [23.72, 93.39], [22.31, 93.38],
      [21.50, 92.67], [21.32, 92.31], [22.15, 92.10], [22.05, 91.44],
      [22.52, 89.56], [21.82, 89.05], [21.56, 88.32], [22.04, 88.11],
      [21.71, 87.12], [21.19, 86.81], [20.63, 86.37], [19.58, 85.05],
      [18.55, 84.05], [17.47, 83.26], [16.59, 82.26], [15.69, 80.22],
      [14.53, 79.89], [13.74, 80.18], [12.63, 80.24], [11.85, 79.84],
      [10.36, 79.84], [9.26, 79.40], [8.96, 78.18], [8.07, 77.55],
    ];
    L.polyline(indiaOutline, {
      color: 'rgba(240, 165, 0, 0.18)',
      weight: 1.5,
      dashArray: '6, 4',
      interactive: false,
    }).addTo(map);
  }

  /**
   * Build a rich HTML tooltip string for a marker.
   */
  function buildTooltipContent(pin, groupLabel, groupMeta) {
    const lines = [`<strong>${pin}</strong>`];
    if (groupLabel) {
      lines.push(`<span class="tt-label">${groupLabel}</span>`);
    }
    if (groupMeta) {
      if (groupMeta.level) {
        lines.push(`<span class="tt-level">${groupMeta.level}</span>`);
      }
      if (groupMeta.pinCount != null) {
        lines.push(`<span class="tt-count">${groupMeta.mappedCount || groupMeta.pinCount} post offices</span>`);
      }
      if (groupMeta.states && groupMeta.states.length > 0) {
        const stateStr = groupMeta.states.length > 3
          ? groupMeta.states.slice(0, 3).join(', ') + '...'
          : groupMeta.states.join(', ');
        lines.push(`<span class="tt-states">${stateStr}</span>`);
      }
    }
    return `<div class="pin-tooltip">${lines.join('<br>')}</div>`;
  }

  /**
   * Render grouped points on the map.
   *
   * @param {Array} groups - [{color, points: [[pin,lat,lng],...], label, meta}]
   * @param {Array} dimmedPoints - [[pin,lat,lng],...] shown in dim gray
   */
  function renderGroups(groups, dimmedPoints = []) {
    // Clear existing markers
    dimmedLayer.clearLayers();
    markersLayer.clearLayers();

    const totalActive = groups.reduce((sum, g) => sum + g.points.length, 0);
    const totalAll = totalActive + dimmedPoints.length;

    // Adaptive sizing based on point count
    const dimRadius = totalAll > 15000 ? 1.5 : 2;
    const activeRadius = totalAll > 15000 ? 2.5 : totalAll > 5000 ? 3 : 3.5;

    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
      // Render dimmed points first (background, non-interactive)
      if (dimmedPoints.length > 0) {
        for (let i = 0; i < dimmedPoints.length; i++) {
          const p = dimmedPoints[i];
          L.circleMarker([p[1], p[2]], {
            radius: dimRadius,
            color: DIMMED_COLOR,
            fillColor: DIMMED_COLOR,
            fillOpacity: DIMMED_OPACITY,
            weight: 0,
            interactive: false,
            renderer: canvasRenderer,
          }).addTo(dimmedLayer);
        }
      }

      // Render active groups (foreground, interactive)
      for (const group of groups) {
        for (let i = 0; i < group.points.length; i++) {
          const p = group.points[i];
          const marker = L.circleMarker([p[1], p[2]], {
            radius: activeRadius,
            color: group.color,
            fillColor: group.color,
            fillOpacity: 0.85,
            weight: 0.5,
            interactive: true,
            renderer: canvasRenderer,
          });

          // Build tooltip
          const tooltipHTML = buildTooltipContent(p[0], group.label, group.meta);
          marker.bindTooltip(tooltipHTML, {
            direction: 'top',
            offset: [0, -6],
            className: 'pin-tooltip-container',
            sticky: false,
          });

          marker.addTo(markersLayer);
        }
      }
    });
  }

  /**
   * Fit map bounds to show all given points with padding.
   */
  function fitToPoints(points) {
    if (!points || points.length === 0) {
      // Reset to India view
      map.setView([22.5, 82.0], 5);
      return;
    }

    if (points.length === 1) {
      map.setView([points[0][1], points[0][2]], 14);
      return;
    }

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const lat = points[i][1];
      const lng = points[i][2];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    const bounds = L.latLngBounds(
      L.latLng(minLat, minLng),
      L.latLng(maxLat, maxLng)
    );

    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 16,
      animate: true,
      duration: 0.5,
    });
  }

  /**
   * Highlight a single point (e.g., on hover from search results).
   * Adds a pulsing marker that stands out.
   */
  function highlightPoint(pin, lat, lng) {
    // Remove previous highlight if any
    if (PinMap._highlightMarker) {
      markersLayer.removeLayer(PinMap._highlightMarker);
    }

    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#ffd54f',
      fillColor: '#f0a500',
      fillOpacity: 1,
      weight: 2,
      renderer: canvasRenderer,
    });

    marker.bindTooltip(`<div class="pin-tooltip"><strong>${pin}</strong></div>`, {
      direction: 'top',
      offset: [0, -10],
      className: 'pin-tooltip-container',
      permanent: true,
    });

    marker.addTo(markersLayer);
    PinMap._highlightMarker = marker;

    map.setView([lat, lng], Math.max(map.getZoom(), 12), { animate: true });
  }

  /**
   * Get the underlying Leaflet map instance.
   */
  function getMap() {
    return map;
  }

  return {
    init,
    renderGroups,
    fitToPoints,
    highlightPoint,
    getMap,
    _highlightMarker: null,
  };
})();
