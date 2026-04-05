/**
 * App - main orchestrator for the PIN Atlas application.
 * Ties together DataLoader, PinMap, and the Search UI to provide
 * an interactive exploration of India's ~19K pincodes.
 */
const App = (() => {
  let currentPrefix = '';

  // DOM element references
  const els = {};

  /**
   * Boot the entire application.
   */
  async function init() {
    // Cache DOM references
    els.mapStatus = document.getElementById('map-status');
    els.legend = document.getElementById('legend');
    els.stats = document.getElementById('stats');
    els.info = document.getElementById('info-panel');
    els.pattern = document.getElementById('pin-pattern');

    setStatus('Loading postal data...');

    try {
      // Initialize data and map in parallel where possible
      await DataLoader.init('data');
      PinMap.init('map');
      Search.init();

      // Initial render: all zones
      updateMap();
      updateLegend();
      updateStats();
      updatePattern();
      updateInfo();

      setStatus('');
    } catch (err) {
      console.error('App init failed:', err);
      setStatus('Failed to load data. Please refresh.');
    }
  }

  /**
   * Set or clear the map status overlay text.
   */
  function setStatus(text) {
    if (!els.mapStatus) return;
    els.mapStatus.textContent = text;
    els.mapStatus.style.display = text ? 'block' : 'none';
  }

  /**
   * Called when the user changes the prefix (from search input or legend click).
   */
  function onPrefixChange(newPrefix) {
    // Sanitize: keep only digits
    const sanitized = newPrefix.replace(/\D/g, '').slice(0, 6);
    if (sanitized === currentPrefix) return;

    currentPrefix = sanitized;
    updateMap();
    updateLegend();
    updateStats();
    updatePattern();
    updateInfo();
  }

  // ---- Map rendering ----

  /**
   * Core map update: groups pincodes by the next digit in the hierarchy,
   * colors each group, and dims everything outside the current prefix.
   */
  function updateMap() {
    const prefix = currentPrefix;
    const allCoords = DataLoader.getAllCoords();
    if (!allCoords) return;

    if (prefix.length === 0) {
      // Top level: color every point by its zone digit (first digit)
      renderZoneLevel(allCoords);
    } else {
      // Deeper level: show matching pins grouped by next digit,
      // plus all non-matching pins dimmed.
      renderPrefixLevel(prefix, allCoords);
    }
  }

  /**
   * Render the top-level zone view (no prefix entered).
   * All ~19K points colored by their first digit.
   */
  function renderZoneLevel(allCoords) {
    // Bucket by first digit
    const buckets = {};
    for (let d = 1; d <= 9; d++) buckets[d] = [];

    for (let i = 0; i < allCoords.length; i++) {
      const firstDigit = allCoords[i][0][0];
      if (buckets[firstDigit]) {
        buckets[firstDigit].push(allCoords[i]);
      }
    }

    const groups = [];
    for (let d = 1; d <= 9; d++) {
      if (buckets[d].length === 0) continue;
      const zone = DataLoader.getZoneMeta(String(d));
      const trieNode = DataLoader.getTrieNode(String(d));
      groups.push({
        color: PinColors.forDigit(d, 0),
        points: buckets[d],
        label: zone ? `Zone ${d}: ${zone.name}` : `Zone ${d}`,
        meta: trieNode || null,
      });
    }

    PinMap.renderGroups(groups, []);
    PinMap.fitToPoints(allCoords);
  }

  /**
   * Render a prefix-drilldown view.
   * Active points (matching prefix) are grouped by next digit.
   * All other points are shown dimmed.
   */
  function renderPrefixLevel(prefix, allCoords) {
    const activeCoords = DataLoader.getPinsForPrefix(prefix);

    // Dimmed = everything NOT in the active set
    // For performance, compute dimmed as all coords minus active range
    // Since both are sorted, we can be smart: active is a contiguous slice.
    const allLen = allCoords.length;
    const activeSet = new Set(); // only needed if sets are small
    let dimmedPoints;

    if (activeCoords.length < allLen) {
      // Build dimmed by exclusion. Since getPinsForPrefix returns a slice,
      // we know the start/end indices. For simplicity, just filter.
      const activeFirst = activeCoords.length > 0 ? activeCoords[0][0] : null;
      const activeLast = activeCoords.length > 0 ? activeCoords[activeCoords.length - 1][0] : null;

      dimmedPoints = [];
      for (let i = 0; i < allLen; i++) {
        const pin = allCoords[i][0];
        if (activeFirst && pin >= activeFirst && pin <= activeLast) continue;
        dimmedPoints.push(allCoords[i]);
      }
    } else {
      dimmedPoints = [];
    }

    // Group active coords by the next digit after the prefix
    const nextDigitIdx = prefix.length;
    const buckets = {};

    for (let i = 0; i < activeCoords.length; i++) {
      const pin = activeCoords[i][0];
      const nextDigit = pin[nextDigitIdx];
      if (nextDigit === undefined) {
        // Exact match (6-digit pincode entered)
        if (!buckets['exact']) buckets['exact'] = [];
        buckets['exact'].push(activeCoords[i]);
      } else {
        if (!buckets[nextDigit]) buckets[nextDigit] = [];
        buckets[nextDigit].push(activeCoords[i]);
      }
    }

    // Build groups
    const groups = [];
    const digits = Object.keys(buckets).filter(k => k !== 'exact').sort();

    for (let i = 0; i < digits.length; i++) {
      const d = digits[i];
      const childPrefix = prefix + d;
      const trieNode = getTrieNodeForPrefix(childPrefix);
      const colorIdx = parseInt(d, 10);

      let label = `${childPrefix}${'*'.repeat(6 - childPrefix.length)}`;
      if (trieNode && trieNode.label) {
        label += ` - ${trieNode.label}`;
      }
      if (trieNode && trieNode.states && trieNode.states.length > 0) {
        const stateStr = trieNode.states.length > 2
          ? trieNode.states.slice(0, 2).join(', ') + '...'
          : trieNode.states.join(', ');
        label += ` (${stateStr})`;
      }

      groups.push({
        color: PinColors.forDigit(colorIdx, prefix.length),
        points: buckets[d],
        label: label,
        meta: trieNode || { pinCount: buckets[d].length },
      });
    }

    // Handle exact match bucket
    if (buckets['exact']) {
      groups.push({
        color: '#f0a500',
        points: buckets['exact'],
        label: `${prefix} (exact)`,
        meta: { pinCount: buckets['exact'].length },
      });
    }

    PinMap.renderGroups(groups, dimmedPoints);
    PinMap.fitToPoints(activeCoords);
  }

  /**
   * Get a trie node for any prefix length.
   * For depth <= 3, uses the preloaded trie-nav.
   * For depth > 3, we would need to lazy-load, but for synchronous usage
   * in rendering we fall back to what we have.
   */
  function getTrieNodeForPrefix(prefix) {
    if (prefix.length <= 3) {
      return DataLoader.getTrieNode(prefix);
    }
    // For deeper prefixes, try the nav trie up to depth 3
    // The full deep node would require async loading
    return DataLoader.getTrieNode(prefix.slice(0, 3));
  }

  // ---- Legend ----

  function updateLegend() {
    if (!els.legend) return;

    const prefix = currentPrefix;

    if (prefix.length === 0) {
      renderZoneLegend();
    } else {
      renderPrefixLegend(prefix);
    }
  }

  function renderZoneLegend() {
    let html = '';
    for (let d = 1; d <= 9; d++) {
      const zone = DataLoader.getZoneMeta(String(d));
      const node = DataLoader.getTrieNode(String(d));
      const count = node ? node.mappedCount || node.pinCount : 0;
      const color = PinColors.forDigit(d, 0);
      const name = zone ? zone.name : `Zone ${d}`;

      html += `
        <div class="legend-item" data-prefix="${d}" title="Click to explore Zone ${d}">
          <span class="legend-swatch" style="background:${color}"></span>
          <span class="legend-label">${d} - ${name}</span>
          <span class="legend-count">${count.toLocaleString()}</span>
        </div>`;
    }
    els.legend.innerHTML = html;
    attachLegendListeners();
  }

  function renderPrefixLegend(prefix) {
    const node = DataLoader.getTrieNode(prefix.slice(0, Math.min(prefix.length, 3)));
    let childNodes = {};

    // Determine what children to show
    if (prefix.length <= 3) {
      const trieNode = DataLoader.getTrieNode(prefix);
      if (trieNode && trieNode.children) {
        childNodes = trieNode.children;
      }
    }

    // Build active coords to count by next digit
    const activeCoords = DataLoader.getPinsForPrefix(prefix);
    const nextIdx = prefix.length;
    const digitCounts = {};
    for (let i = 0; i < activeCoords.length; i++) {
      const d = activeCoords[i][0][nextIdx];
      if (d !== undefined) {
        digitCounts[d] = (digitCounts[d] || 0) + 1;
      }
    }

    let html = `<div class="legend-back" data-prefix="${prefix.slice(0, -1)}" title="Go back">
      &larr; Back to ${prefix.slice(0, -1) || 'All Zones'}
    </div>`;

    const digits = Object.keys(digitCounts).sort();
    for (const d of digits) {
      const childPrefix = prefix + d;
      const trieChild = childNodes[d] || null;
      const color = PinColors.forDigit(parseInt(d, 10), prefix.length);
      const count = digitCounts[d];

      let label = `${childPrefix}${'*'.repeat(6 - childPrefix.length)}`;
      if (trieChild && trieChild.states && trieChild.states.length > 0) {
        const stateStr = trieChild.states.length > 2
          ? trieChild.states.slice(0, 2).join(', ') + '...'
          : trieChild.states.join(', ');
        label += ` (${stateStr})`;
      }

      html += `
        <div class="legend-item" data-prefix="${childPrefix}" title="Click to drill into ${childPrefix}">
          <span class="legend-swatch" style="background:${color}"></span>
          <span class="legend-label">${label}</span>
          <span class="legend-count">${count.toLocaleString()}</span>
        </div>`;
    }

    // If this is a full 6-digit pincode, show it
    if (prefix.length === 6) {
      html = `<div class="legend-back" data-prefix="${prefix.slice(0, -1)}" title="Go back">
        &larr; Back to ${prefix.slice(0, -1)}
      </div>
      <div class="legend-item exact-match">
        <span class="legend-swatch" style="background:#f0a500"></span>
        <span class="legend-label">${prefix}</span>
        <span class="legend-count">${activeCoords.length} pin(s)</span>
      </div>`;
    }

    els.legend.innerHTML = html;
    attachLegendListeners();
  }

  function attachLegendListeners() {
    // Click on legend items to drill down
    els.legend.querySelectorAll('.legend-item[data-prefix]').forEach(item => {
      item.addEventListener('click', () => {
        const newPrefix = item.dataset.prefix;
        if (newPrefix.length <= 6) {
          syncSearchInputs(newPrefix);
          onPrefixChange(newPrefix);
        }
      });
      item.style.cursor = 'pointer';
    });

    // Click on "back" to go up
    els.legend.querySelectorAll('.legend-back[data-prefix]').forEach(item => {
      item.addEventListener('click', () => {
        const newPrefix = item.dataset.prefix;
        syncSearchInputs(newPrefix);
        onPrefixChange(newPrefix);
      });
      item.style.cursor = 'pointer';
    });
  }

  /**
   * Sync the 6-slot OTP-style input boxes with a given prefix.
   * This updates the UI so the search boxes reflect legend clicks.
   */
  function syncSearchInputs(prefix) {
    const inputs = document.querySelectorAll('.pin-input-group input');
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].value = i < prefix.length ? prefix[i] : '';
    }
    // Focus the next empty slot
    const nextIdx = Math.min(prefix.length, 5);
    if (inputs[nextIdx]) inputs[nextIdx].focus();
  }

  // ---- Statistics panel ----

  function updateStats() {
    if (!els.stats) return;

    const prefix = currentPrefix;
    const activeCoords = prefix ? DataLoader.getPinsForPrefix(prefix) : DataLoader.getAllCoords();
    if (!activeCoords) return;

    const totalMapped = activeCoords.length;

    // Get trie node for pin count (includes unmapped)
    let trieNode = null;
    if (prefix.length > 0 && prefix.length <= 3) {
      trieNode = DataLoader.getTrieNode(prefix);
    } else if (prefix.length === 0) {
      // Sum all zones
      let totalPins = 0;
      for (let d = 1; d <= 9; d++) {
        const n = DataLoader.getTrieNode(String(d));
        if (n) totalPins += n.pinCount || 0;
      }
      trieNode = { pinCount: totalPins, mappedCount: totalMapped };
    }

    // Count unique states
    const stateSet = new Set();
    if (prefix.length > 0 && prefix.length <= 3) {
      const node = DataLoader.getTrieNode(prefix);
      if (node && node.states) {
        node.states.forEach(s => stateSet.add(s));
      }
    } else if (prefix.length === 0) {
      for (let d = 1; d <= 9; d++) {
        const node = DataLoader.getTrieNode(String(d));
        if (node && node.states) node.states.forEach(s => stateSet.add(s));
      }
    }

    const totalPins = trieNode ? trieNode.pinCount : totalMapped;

    let html = `
      <div class="stat-row">
        <span class="stat-label">Total pincodes</span>
        <span class="stat-value">${totalPins.toLocaleString()}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Mapped on map</span>
        <span class="stat-value">${totalMapped.toLocaleString()}</span>
      </div>`;

    if (stateSet.size > 0) {
      // Filter out "NA"
      const states = [...stateSet].filter(s => s !== 'NA');
      html += `
        <div class="stat-row">
          <span class="stat-label">States / UTs</span>
          <span class="stat-value">${states.length}</span>
        </div>`;
    }

    // Zone info at depth 1
    if (prefix.length === 1) {
      const zone = DataLoader.getZoneMeta(prefix);
      if (zone) {
        html += `
          <div class="stat-zone">
            <strong>Zone ${prefix}: ${zone.name}</strong>
            <div class="stat-states">${zone.states.join(', ')}</div>
          </div>`;
      }
    }

    els.stats.innerHTML = html;
  }

  // ---- Pattern display ----

  function updatePattern() {
    if (!els.pattern) return;
    const prefix = currentPrefix;
    const pattern = prefix + '*'.repeat(6 - prefix.length);
    els.pattern.textContent = pattern;
  }

  // ---- Info panel ----

  function updateInfo() {
    if (!els.info) return;

    const prefix = currentPrefix;

    if (prefix.length === 0) {
      els.info.innerHTML = `
        <p>India's PIN code system uses <strong>6 digits</strong>. The first digit represents the postal zone (1-9), dividing the country into 9 regions.</p>
        <p>Type digits above to explore the hierarchy, or click legend items to drill down.</p>`;
    } else if (prefix.length === 1) {
      const zone = DataLoader.getZoneMeta(prefix);
      if (zone) {
        els.info.innerHTML = `
          <p><strong>Zone ${prefix} - ${zone.name}</strong></p>
          <p>The second digit narrows to a sub-zone within this region, typically corresponding to a state or group of states.</p>
          <p>States: ${zone.states.join(', ')}</p>`;
      }
    } else if (prefix.length === 2) {
      const node = DataLoader.getTrieNode(prefix);
      els.info.innerHTML = `
        <p><strong>Sub-zone ${prefix}</strong></p>
        <p>The third digit identifies the sorting district, which usually corresponds to a major city or administrative region.</p>
        ${node && node.states ? `<p>States: ${node.states.join(', ')}</p>` : ''}`;
    } else if (prefix.length === 3) {
      els.info.innerHTML = `
        <p><strong>Sorting District ${prefix}</strong></p>
        <p>Digits 4-6 identify the specific route, sub-route, and delivery post office within this sorting district.</p>`;
    } else if (prefix.length >= 4 && prefix.length < 6) {
      const levelNames = { 4: 'Route', 5: 'Sub-route' };
      els.info.innerHTML = `
        <p><strong>${levelNames[prefix.length] || 'Detail'}: ${prefix}</strong></p>
        <p>Getting closer to individual post offices. Each additional digit narrows the delivery area.</p>`;
    } else if (prefix.length === 6) {
      els.info.innerHTML = `
        <p><strong>PIN Code: ${prefix}</strong></p>
        <p>This is a specific delivery post office code. Loading details...</p>`;
      // Load and show detail info asynchronously
      loadAndShowDetails(prefix);
    }
  }

  /**
   * Fetch and display detailed information for a specific pincode.
   */
  async function loadAndShowDetails(pin) {
    const prefix2 = pin.slice(0, 2);
    const details = await DataLoader.getDetails(prefix2);
    if (!details || currentPrefix !== pin) return;

    const pinData = details.pins
      ? details.pins.find(p => p.pin === pin)
      : null;

    if (pinData) {
      let html = `<p><strong>PIN Code: ${pin}</strong></p>`;
      if (pinData.district) html += `<p>District: ${pinData.district}</p>`;
      if (pinData.state) html += `<p>State: ${pinData.state}</p>`;
      if (pinData.offices && pinData.offices.length > 0) {
        const officeList = pinData.offices.slice(0, 10).join(', ');
        const extra = pinData.officeCount > 10 ? ` (+${pinData.officeCount - 10} more)` : '';
        html += `<p>Offices: ${officeList}${extra}</p>`;
      }
      els.info.innerHTML = html;
    } else {
      els.info.innerHTML = `<p><strong>PIN Code: ${pin}</strong></p><p>No detailed data available for this pincode.</p>`;
    }
  }

  // ---- Global hook for the Search module ----

  /**
   * The Search module (search.js) calls this when the user types or deletes digits.
   */
  window.onPinPrefixChange = function (prefix) {
    App.onPrefixChange(prefix);
  };

  return { init, onPrefixChange };
})();

// Boot the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
