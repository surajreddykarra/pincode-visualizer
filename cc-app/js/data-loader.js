/**
 * DataLoader - loads and caches all data for the PIN Atlas app.
 * Provides binary-search-based prefix lookups on the sorted coords array,
 * trie navigation, and lazy-loading of deep/detail files.
 */
const DataLoader = (() => {
  let coords = null;       // sorted array of ["pincode", lat, lng]
  let trieNav = null;      // trie to depth 3
  let zoneMeta = null;     // zone digit -> {name, states}
  const cache = new Map(); // cache for lazy-loaded deep/ and details/ files
  let basePath = 'data';

  /**
   * Fetch and parse all three bootstrap files in parallel.
   */
  async function init(path = 'data') {
    basePath = path;
    const [coordsResp, trieResp, zoneResp] = await Promise.all([
      fetch(`${basePath}/coords.json`),
      fetch(`${basePath}/trie-nav.json`),
      fetch(`${basePath}/zone-meta.json`),
    ]);

    if (!coordsResp.ok) throw new Error(`Failed to load coords.json: ${coordsResp.status}`);
    if (!trieResp.ok) throw new Error(`Failed to load trie-nav.json: ${trieResp.status}`);
    if (!zoneResp.ok) throw new Error(`Failed to load zone-meta.json: ${zoneResp.status}`);

    coords = await coordsResp.json();
    trieNav = await trieResp.json();
    zoneMeta = await zoneResp.json();
  }

  // --- Binary search helpers ---

  /**
   * Standard lower-bound binary search.
   * Returns the index of the first element where element[0] >= key.
   */
  function lowerBound(key) {
    let lo = 0;
    let hi = coords.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (coords[mid][0] < key) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Given a prefix string (e.g. "41"), compute the start key and end key
   * that bracket all 6-digit pincodes starting with that prefix.
   *
   * prefix "4"  -> start "400000", end "500000"
   * prefix "41" -> start "410000", end "420000"
   * prefix "9"  -> start "900000", end is past the array
   * prefix "99" -> start "990000", end "A00000" (past any real pincode)
   */
  function getPinsForPrefix(prefix) {
    if (!coords) return [];
    if (!prefix || prefix.length === 0) return coords;
    if (prefix.length > 6) return [];

    const padLen = 6 - prefix.length;
    const startKey = prefix + '0'.repeat(padLen);

    // Compute the "next prefix" by incrementing the last digit.
    // For prefix "41", next is "42". For "49", next is "50". For "99", next is ":0" (> any digit).
    const prefixNum = parseInt(prefix, 10);
    const nextPrefixNum = prefixNum + 1;
    const nextPrefixStr = String(nextPrefixNum).padStart(prefix.length, '0');

    // If the incremented prefix overflows the digit width (e.g. "99" + 1 = "100"),
    // that's fine -- "100000" > any 6-digit string starting with "9", so we
    // just search to the end.
    const endKey = nextPrefixStr + '0'.repeat(padLen);

    const startIdx = lowerBound(startKey);
    const endIdx = lowerBound(endKey);

    return coords.slice(startIdx, endIdx);
  }

  /**
   * Walk the preloaded trie-nav (depth <= 3) to find a node for the given prefix.
   * Returns null if path doesn't exist.
   */
  function getTrieNode(prefix) {
    if (!trieNav) return null;
    let node = trieNav;
    for (const digit of prefix) {
      if (!node.children || !(digit in node.children)) return null;
      node = node.children[digit];
    }
    return node;
  }

  /**
   * Lazy-load a deep trie file (deep/XXX.json) for prefixes at depth > 3.
   * @param {string} prefix3 - the 3-digit prefix that identifies the file
   * @param {string} remainingDigits - digits beyond the first 3 to walk
   * @returns {object|null} the trie node, or null
   */
  async function getDeepNode(prefix3, remainingDigits) {
    const cacheKey = `deep/${prefix3}`;
    let deepTrie = cache.get(cacheKey);

    if (!deepTrie) {
      try {
        const resp = await fetch(`${basePath}/deep/${prefix3}.json`);
        if (!resp.ok) return null;
        deepTrie = await resp.json();
        cache.set(cacheKey, deepTrie);
      } catch {
        return null;
      }
    }

    // Walk from the root of the deep trie using remaining digits
    let node = deepTrie;
    for (const digit of remainingDigits) {
      if (!node.children || !(digit in node.children)) return null;
      node = node.children[digit];
    }
    return node;
  }

  /**
   * Lazy-load detail data for a 2-digit sub-zone prefix.
   * Returns the parsed JSON (has .prefix, .pins array with office details).
   */
  async function getDetails(prefix2) {
    const cacheKey = `details/${prefix2}`;
    let details = cache.get(cacheKey);

    if (!details) {
      try {
        const resp = await fetch(`${basePath}/details/${prefix2}.json`);
        if (!resp.ok) return null;
        details = await resp.json();
        cache.set(cacheKey, details);
      } catch {
        return null;
      }
    }
    return details;
  }

  /**
   * Get zone metadata for a single digit (1-9).
   */
  function getZoneMeta(digit) {
    if (!zoneMeta) return null;
    return zoneMeta[digit] || null;
  }

  /**
   * Return the full coords array.
   */
  function getAllCoords() {
    return coords;
  }

  return {
    init,
    getPinsForPrefix,
    getTrieNode,
    getDeepNode,
    getDetails,
    getZoneMeta,
    getAllCoords,
  };
})();
