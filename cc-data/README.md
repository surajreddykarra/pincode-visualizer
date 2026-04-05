# cc-data

Pre-computation pipeline. Reads `raw-data/pincodes.csv` and generates optimized JSON files for the app.

## Run

```
node cc-data/precompute.js
```

Outputs to `cc-data/output/`. Takes ~0.5s.

## Output files

All files go under `output/`.

| File | Size | Purpose |
|---|---|---|
| `coords.json` | 497 KB | Sorted `[pincode, lat, lng]` array (19,550 entries) |
| `trie-nav.json` | 77 KB | Trie to depth 3 (zone/subzone/district) with centroids, states, counts |
| `zone-meta.json` | 1 KB | Zone digit (1-9) to name and states |
| `details/{XX}.json` | 70 files | Per 2-digit prefix: pin list with district, state, office names |
| `deep/{XXX}.json` | 405 files | Per 3-digit prefix: trie subtree for digits 4-6 |

### Initial load (what the app fetches on startup)

- `coords.json`
- `trie-nav.json`
- `zone-meta.json`

### Lazy-loaded (fetched on demand as user types 4+ digits or hovers)

- `details/{XX}.json`
- `deep/{XXX}.json`
