# cc-app

Static HTML/CSS/JS app. No build step, no dependencies beyond Leaflet (loaded from CDN).

## Serve

Any static file server from this directory:

```
python3 -m http.server 8090 --directory cc-app
# or
npx serve cc-app
```

## Data requirement

The app expects a `data/` directory (or symlink) pointing to `cc-data/output/`:

```
ln -s ../cc-data/output cc-app/data
```

The app fetches files from `data/` relative to `index.html`.

## File structure

```
cc-app/
  index.html          # Entry point. Loads Leaflet 1.9.4 from unpkg CDN.
  styles.css           # Dark theme, responsive layout.
  js/
    colors.js          # 9-color palette, color assignment per depth.
    data-loader.js     # Fetches JSON, binary search on sorted coords, trie nav, lazy-load cache.
    map.js             # Leaflet map with Canvas renderer, CartoDB dark tiles, marker rendering.
    search.js          # 6-digit OTP-style input with auto-advance, backspace, paste.
    app.js             # Orchestrator. Wires search -> trie -> map -> legend -> stats.
  data/                # -> symlink to cc-data/output/
    coords.json
    trie-nav.json
    zone-meta.json
    details/
    deep/
```

## Expected directory for a common website

When integrating into a shared site, place files as:

```
{site-root}/
  cc-app/
    index.html
    styles.css
    js/
      app.js
      colors.js
      data-loader.js
      map.js
      search.js
    data/
      coords.json
      trie-nav.json
      zone-meta.json
      details/          # 70 JSON files
      deep/             # 405 JSON files
```

`index.html` is the entry point. All paths are relative. No router needed.
