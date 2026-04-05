#!/usr/bin/env node
/**
 * precompute.js - Processes the India pincode CSV and generates optimized
 * data files for the web app.
 *
 * Usage: node cc-data/precompute.js
 *
 * Source: raw-data/pincodes.csv (~165K rows)
 * Output: cc-data/output/ (coords.json, trie-nav.json, zone-meta.json,
 *         details/XX.json, deep/XXX.json)
 *
 * Uses only Node.js built-in modules - no npm dependencies required.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'raw-data', 'pincodes.csv');
const OUTPUT_DIR = path.join(__dirname, 'output');
const DETAILS_DIR = path.join(OUTPUT_DIR, 'details');
const DEEP_DIR = path.join(OUTPUT_DIR, 'deep');

// ---------------------------------------------------------------------------
// Zone metadata (static, first digit of pincode -> zone info)
// ---------------------------------------------------------------------------
const ZONE_META = {
  '1': { name: 'Northern', states: ['Delhi', 'Haryana', 'Himachal Pradesh', 'Punjab', 'Chandigarh', 'Jammu & Kashmir', 'Ladakh'] },
  '2': { name: 'Uttar Pradesh & Uttarakhand', states: ['Uttar Pradesh', 'Uttarakhand'] },
  '3': { name: 'Western', states: ['Rajasthan', 'Gujarat', 'Dadra & Nagar Haveli', 'Daman & Diu'] },
  '4': { name: 'Central & Western', states: ['Maharashtra', 'Madhya Pradesh', 'Goa', 'Chhattisgarh'] },
  '5': { name: 'Southern', states: ['Andhra Pradesh', 'Karnataka', 'Telangana'] },
  '6': { name: 'Southern Peninsular', states: ['Kerala', 'Tamil Nadu', 'Puducherry', 'Lakshadweep'] },
  '7': { name: 'Eastern', states: ['West Bengal', 'Odisha', 'Assam', 'Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura'] },
  '8': { name: 'Bihar & Jharkhand', states: ['Bihar', 'Jharkhand'] },
  '9': { name: 'Army Postal Service', states: ['APS'] },
};

// ---------------------------------------------------------------------------
// India bounding box for coordinate validation
// ---------------------------------------------------------------------------
const LAT_MIN = 6;
const LAT_MAX = 38;
const LNG_MIN = 67;
const LNG_MAX = 98;

// ---------------------------------------------------------------------------
// CSV parser - handles quoted fields containing commas
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------
function isValidCoord(lat, lng) {
  return (
    !isNaN(lat) && !isNaN(lng) &&
    lat >= LAT_MIN && lat <= LAT_MAX &&
    lng >= LNG_MIN && lng <= LNG_MAX
  );
}

function parseCoord(val) {
  if (!val || val === 'NA' || val === 'na' || val === '') return NaN;
  return parseFloat(val);
}

function roundCoord(v) {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Ensure output directories exist
// ---------------------------------------------------------------------------
function ensureDirs() {
  for (const dir of [OUTPUT_DIR, DETAILS_DIR, DEEP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Pincode Precompute ===');
  console.log(`Reading CSV: ${CSV_PATH}`);
  const startTime = Date.now();

  ensureDirs();

  // -----------------------------------------------------------------------
  // Pass 1: Read all rows into memory, organised by pincode
  // -----------------------------------------------------------------------
  // pincodeMap: pin -> { lat, lng, district, state, offices: [{name, type}] }
  const pincodeMap = new Map();
  let totalRows = 0;
  let skippedRows = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line.trim()) continue;

    totalRows++;
    const fields = parseCSVLine(line);

    // Expect 11 columns:
    // 0:circlename 1:regionname 2:divisionname 3:officename
    // 4:pincode 5:officetype 6:delivery 7:district 8:statename
    // 9:latitude 10:longitude
    if (fields.length < 11) {
      skippedRows++;
      continue;
    }

    const pin = fields[4];
    const officeName = fields[3];
    const officeType = fields[5];
    const district = fields[7];
    const state = fields[8];
    const lat = parseCoord(fields[9]);
    const lng = parseCoord(fields[10]);

    if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      skippedRows++;
      continue;
    }

    if (!pincodeMap.has(pin)) {
      pincodeMap.set(pin, {
        lat: NaN,
        lng: NaN,
        district: district || '',
        state: state || '',
        offices: [],
      });
    }

    const entry = pincodeMap.get(pin);
    entry.offices.push({ name: officeName, type: officeType });

    // Use first valid coordinate we encounter for this pincode
    if (isNaN(entry.lat) && isValidCoord(lat, lng)) {
      entry.lat = lat;
      entry.lng = lng;
    }

    // Fill in district/state if missing
    if (!entry.district && district) entry.district = district;
    if (!entry.state && state) entry.state = state;
  }

  const uniquePins = pincodeMap.size;
  let mappedPins = 0;
  for (const [, v] of pincodeMap) {
    if (isValidCoord(v.lat, v.lng)) mappedPins++;
  }

  console.log(`\nCSV parsed:`);
  console.log(`  Total data rows:    ${totalRows}`);
  console.log(`  Skipped rows:       ${skippedRows}`);
  console.log(`  Unique pincodes:    ${uniquePins}`);
  console.log(`  Mapped (w/ coords): ${mappedPins}`);

  // -----------------------------------------------------------------------
  // Generate 1: coords.json
  // -----------------------------------------------------------------------
  console.log('\nGenerating coords.json ...');
  const coordsArr = [];
  for (const [pin, v] of pincodeMap) {
    if (isValidCoord(v.lat, v.lng)) {
      coordsArr.push([pin, roundCoord(v.lat), roundCoord(v.lng)]);
    }
  }
  coordsArr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  writeJSON(path.join(OUTPUT_DIR, 'coords.json'), coordsArr);

  // -----------------------------------------------------------------------
  // Generate 2: zone-meta.json
  // -----------------------------------------------------------------------
  console.log('Generating zone-meta.json ...');
  writeJSON(path.join(OUTPUT_DIR, 'zone-meta.json'), ZONE_META);

  // -----------------------------------------------------------------------
  // Generate 3: trie-nav.json (depth 1-3)
  // -----------------------------------------------------------------------
  console.log('Generating trie-nav.json ...');
  const trieNav = buildTrieNav(pincodeMap);
  writeJSON(path.join(OUTPUT_DIR, 'trie-nav.json'), trieNav);

  // -----------------------------------------------------------------------
  // Generate 4: details/XX.json (one per 2-digit prefix)
  // -----------------------------------------------------------------------
  console.log('Generating details/*.json ...');
  const detailsCount = generateDetails(pincodeMap);
  console.log(`  Created ${detailsCount} detail files`);

  // -----------------------------------------------------------------------
  // Generate 5: deep/XXX.json (one per 3-digit prefix)
  // -----------------------------------------------------------------------
  console.log('Generating deep/*.json ...');
  const deepCount = generateDeep(pincodeMap);
  console.log(`  Created ${deepCount} deep files`);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n=== Done in ${elapsed}s ===`);
  printFileSizes();
}

// ---------------------------------------------------------------------------
// Build trie-nav.json structure (depths 1-3)
// ---------------------------------------------------------------------------
function buildTrieNav(pincodeMap) {
  // Accumulate stats at each prefix level (1, 2, 3 digits)
  // prefixStats[prefix] = { pinCount, mappedCount, latSum, lngSum, states: Set }
  const prefixStats = new Map();

  for (const [pin, v] of pincodeMap) {
    const hasCo = isValidCoord(v.lat, v.lng);
    for (const len of [1, 2, 3]) {
      const prefix = pin.substring(0, len);
      if (!prefixStats.has(prefix)) {
        prefixStats.set(prefix, {
          pinCount: 0, mappedCount: 0,
          latSum: 0, lngSum: 0, states: new Set(),
        });
      }
      const s = prefixStats.get(prefix);
      s.pinCount++;
      if (hasCo) {
        s.mappedCount++;
        s.latSum += v.lat;
        s.lngSum += v.lng;
      }
      if (v.state) s.states.add(v.state);
    }
  }

  const LEVEL_NAMES = { 1: 'Zone', 2: 'Sub-zone', 3: 'Sorting District' };

  // Build nested trie object
  const root = { children: {} };

  for (const [prefix, stats] of prefixStats) {
    const depth = prefix.length;
    const node = {
      prefix,
      depth,
      level: LEVEL_NAMES[depth],
      pinCount: stats.pinCount,
      mappedCount: stats.mappedCount,
      centroidLat: stats.mappedCount > 0 ? roundCoord(stats.latSum / stats.mappedCount) : null,
      centroidLng: stats.mappedCount > 0 ? roundCoord(stats.lngSum / stats.mappedCount) : null,
      states: Array.from(stats.states).sort(),
    };

    // Add zone label at depth 1
    if (depth === 1 && ZONE_META[prefix]) {
      node.label = ZONE_META[prefix].name;
    }

    // Depth 1 and 2 get children objects; depth 3 does not (lazy-loaded)
    if (depth < 3) {
      node.children = {};
    }

    // Place node in the tree
    if (depth === 1) {
      root.children[prefix] = node;
    } else if (depth === 2) {
      const parent = root.children[prefix[0]];
      if (parent) parent.children[prefix[1]] = node;
    } else if (depth === 3) {
      const grandparent = root.children[prefix[0]];
      if (grandparent && grandparent.children[prefix[1]]) {
        grandparent.children[prefix[1]].children[prefix[2]] = node;
      }
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Generate details/XX.json files
// ---------------------------------------------------------------------------
function generateDetails(pincodeMap) {
  // Group pincodes by 2-digit prefix
  const groups = new Map(); // prefix2 -> Map(pin -> {district, state, offices})

  for (const [pin, v] of pincodeMap) {
    const p2 = pin.substring(0, 2);
    if (!groups.has(p2)) groups.set(p2, new Map());
    groups.get(p2).set(pin, v);
  }

  let count = 0;
  for (const [prefix, pins] of groups) {
    const pinsArr = [];
    // Sort pins within this prefix
    const sortedPins = Array.from(pins.keys()).sort();

    for (const pin of sortedPins) {
      const v = pins.get(pin);
      const officeNames = v.offices.map(o => o.name);
      // Up to 3 sample office names
      const sampleOffices = officeNames.slice(0, 3);
      pinsArr.push({
        pin,
        district: v.district,
        state: v.state,
        offices: sampleOffices,
        officeCount: v.offices.length,
      });
    }

    const detail = { prefix, pins: pinsArr };
    writeJSON(path.join(DETAILS_DIR, `${prefix}.json`), detail);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Generate deep/XXX.json files (trie subtree depth 3-6 for each 3-digit prefix)
// ---------------------------------------------------------------------------
function generateDeep(pincodeMap) {
  // Group pincodes by 3-digit prefix
  const groups = new Map(); // prefix3 -> [pin, ...]

  for (const [pin, v] of pincodeMap) {
    const p3 = pin.substring(0, 3);
    if (!groups.has(p3)) groups.set(p3, []);
    groups.get(p3).push({ pin, hasCo: isValidCoord(v.lat, v.lng) });
  }

  let count = 0;
  for (const [prefix3, entries] of groups) {
    // Build subtree for depths 4, 5, 6
    // Each node: { prefix, depth, pinCount, mappedCount, children? }
    // Depth 6 = leaf (individual pincode), no children key needed

    const root = { prefix: prefix3, children: {} };

    for (const { pin, hasCo } of entries) {
      // Digits at positions 3, 4, 5 (0-indexed) give us depth 4, 5, 6
      const d4 = pin[3];
      const d5 = pin[4];
      const d6 = pin[5];

      // Depth 4 node
      if (!root.children[d4]) {
        root.children[d4] = {
          prefix: pin.substring(0, 4),
          depth: 4,
          pinCount: 0,
          mappedCount: 0,
          children: {},
        };
      }
      const n4 = root.children[d4];
      n4.pinCount++;
      if (hasCo) n4.mappedCount++;

      // Depth 5 node
      if (!n4.children[d5]) {
        n4.children[d5] = {
          prefix: pin.substring(0, 5),
          depth: 5,
          pinCount: 0,
          mappedCount: 0,
          children: {},
        };
      }
      const n5 = n4.children[d5];
      n5.pinCount++;
      if (hasCo) n5.mappedCount++;

      // Depth 6 node (leaf - individual pincode)
      if (!n5.children[d6]) {
        n5.children[d6] = {
          prefix: pin,
          depth: 6,
          pinCount: 0,
          mappedCount: 0,
        };
      }
      const n6 = n5.children[d6];
      n6.pinCount++;
      if (hasCo) n6.mappedCount++;
    }

    writeJSON(path.join(DEEP_DIR, `${prefix3}.json`), root);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Utility: write JSON with compact formatting and report size
// ---------------------------------------------------------------------------
function writeJSON(filePath, data) {
  const json = JSON.stringify(data);
  fs.writeFileSync(filePath, json, 'utf-8');
}

// ---------------------------------------------------------------------------
// Print file sizes for all generated outputs
// ---------------------------------------------------------------------------
function printFileSizes() {
  console.log('\nOutput file sizes:');

  // Top-level files
  for (const name of ['coords.json', 'trie-nav.json', 'zone-meta.json']) {
    const fp = path.join(OUTPUT_DIR, name);
    if (fs.existsSync(fp)) {
      const size = fs.statSync(fp).size;
      console.log(`  ${name}: ${formatSize(size)}`);
    }
  }

  // details/ directory total
  printDirStats(DETAILS_DIR, 'details/');

  // deep/ directory total
  printDirStats(DEEP_DIR, 'deep/');
}

function printDirStats(dir, label) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  let totalSize = 0;
  for (const f of files) {
    totalSize += fs.statSync(path.join(dir, f)).size;
  }
  console.log(`  ${label} (${files.length} files): ${formatSize(totalSize)} total`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
