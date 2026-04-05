# PIN Atlas India

This static app reads precomputed artifacts from `../codex-data/raw-data`.

## Run locally

From the repo root:

```bash
python3 -m http.server 8000
```

Then open:

`http://127.0.0.1:8000/codex-app/`

## Rebuild data

```bash
python3 codex-data/scripts/build_pin_data.py
```

## Local assets

- `../codex-data/raw-data/pincodes-source.csv`
- `../codex-data/raw-data/india-outline.geojson`
- `../codex-data/raw-data/pins.json`
- `../codex-data/raw-data/pin-trie.json`
- `../codex-data/raw-data/prefix-groups.json`
