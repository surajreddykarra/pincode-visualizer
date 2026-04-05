#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DATA_DIR = REPO_ROOT / "codex-data" / "raw-data"
SOURCE_CSV = RAW_DATA_DIR / "pincodes-source.csv"
MAP_GEOJSON = RAW_DATA_DIR / "india-outline.geojson"
PINS_JSON = RAW_DATA_DIR / "pins.json"
TRIE_JSON = RAW_DATA_DIR / "pin-trie.json"
PREFIX_JSON = RAW_DATA_DIR / "prefix-groups.json"

INDIA_LAT_RANGE = (6.0, 38.5)
INDIA_LON_RANGE = (68.0, 98.5)
OFFICE_SAMPLE_LIMIT = 5

LEVEL_NAMES = {
    0: "zone",
    1: "sub-zone",
    2: "sorting district",
    3: "digit 4",
    4: "digit 5",
    5: "digit 6",
    6: "exact PIN",
}


def clean_text(value: str) -> str:
    value = (value or "").strip()
    return "" if value.upper() == "NA" else value


def parse_coordinate(raw: str) -> float | None:
    value = clean_text(raw)
    if not value:
        return None

    try:
        return float(value)
    except ValueError:
        pass

    numbers = [float(part) for part in re.findall(r"\d+(?:\.\d+)?", value)]
    if not numbers:
        return None

    degrees = numbers[0]
    minutes = numbers[1] if len(numbers) > 1 else 0.0
    seconds = numbers[2] if len(numbers) > 2 else 0.0
    decimal = degrees + minutes / 60.0 + seconds / 3600.0

    upper = value.upper()
    if "S" in upper or "W" in upper:
        decimal *= -1

    return decimal


def in_india_bounds(lat: float, lon: float) -> bool:
    return (
        INDIA_LAT_RANGE[0] <= lat <= INDIA_LAT_RANGE[1]
        and INDIA_LON_RANGE[0] <= lon <= INDIA_LON_RANGE[1]
    )


def normalize_coordinate_pair(lat_raw: str, lon_raw: str) -> tuple[float, float, str] | None:
    lat = parse_coordinate(lat_raw)
    lon = parse_coordinate(lon_raw)
    if lat is None or lon is None:
        return None
    if in_india_bounds(lat, lon):
        return lat, lon, "direct"
    if in_india_bounds(lon, lat):
        return lon, lat, "swapped"
    return None


def iter_geo_points(geometry: dict) -> list[tuple[float, float]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates", [])

    if geometry_type == "Polygon":
        return [(lon, lat) for ring in coordinates for lon, lat in ring]
    if geometry_type == "MultiPolygon":
        return [(lon, lat) for polygon in coordinates for ring in polygon for lon, lat in ring]
    raise ValueError(f"Unsupported geometry type: {geometry_type}")


def mercator_project(lon: float, lat: float) -> tuple[float, float]:
    clamped_lat = max(min(lat, 85.0), -85.0)
    lon_radians = math.radians(lon)
    lat_radians = math.radians(clamped_lat)
    y = math.log(math.tan(math.pi / 4.0 + lat_radians / 2.0))
    return lon_radians, y


def dominant_value(counter: Counter) -> str:
    if not counter:
        return ""
    return counter.most_common(1)[0][0]


def group_label(depth: int, child_prefix: str) -> str:
    if depth == 0:
        return f"Zone {child_prefix}"
    if depth == 1:
        return f"Sub-zone {child_prefix}"
    if depth == 2:
        return f"Sorting district {child_prefix}"
    if len(child_prefix) == 6:
        return f"PIN {child_prefix}"
    return f"Digit {len(child_prefix)} = {child_prefix[-1]}"


def build_projection_bounds(map_data: dict) -> dict[str, float]:
    points = iter_geo_points(map_data["features"][0]["geometry"])
    projected = [mercator_project(lon, lat) for lon, lat in points]
    xs = [point[0] for point in projected]
    ys = [point[1] for point in projected]
    lons = [point[0] for point in points]
    lats = [point[1] for point in points]
    return {
        "minX": min(xs),
        "maxX": max(xs),
        "minY": min(ys),
        "maxY": max(ys),
        "minLon": min(lons),
        "maxLon": max(lons),
        "minLat": min(lats),
        "maxLat": max(lats),
    }


def normalize_projected_point(lon: float, lat: float, bounds: dict[str, float]) -> tuple[float, float]:
    x, y = mercator_project(lon, lat)
    x_span = bounds["maxX"] - bounds["minX"]
    y_span = bounds["maxY"] - bounds["minY"]
    x_norm = (x - bounds["minX"]) / x_span if x_span else 0.5
    y_norm = 1.0 - ((y - bounds["minY"]) / y_span if y_span else 0.5)
    return round(x_norm, 6), round(y_norm, 6)


def main() -> None:
    if not SOURCE_CSV.exists():
        raise SystemExit(f"Missing source CSV: {SOURCE_CSV}")
    if not MAP_GEOJSON.exists():
        raise SystemExit(f"Missing India map asset: {MAP_GEOJSON}")

    map_data = json.loads(MAP_GEOJSON.read_text(encoding="utf-8"))
    projection_bounds = build_projection_bounds(map_data)

    by_pin: dict[str, dict] = {}
    stats = Counter()

    with SOURCE_CSV.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            stats["rows"] += 1
            pin = clean_text(row.get("pincode", ""))
            if len(pin) != 6 or not pin.isdigit():
                stats["invalid_pin_rows"] += 1
                continue

            bucket = by_pin.setdefault(
                pin,
                {
                    "pin": pin,
                    "states": Counter(),
                    "districts": Counter(),
                    "circles": Counter(),
                    "regions": Counter(),
                    "divisions": Counter(),
                    "offices": Counter(),
                    "points": [],
                    "coordModes": Counter(),
                    "invalidCoordinateRows": 0,
                    "missingCoordinateRows": 0,
                    "rows": 0,
                },
            )

            bucket["rows"] += 1

            state = clean_text(row.get("statename", ""))
            district_name = clean_text(row.get("district", ""))
            circle = clean_text(row.get("circlename", ""))
            region = clean_text(row.get("regionname", ""))
            division = clean_text(row.get("divisionname", ""))
            office = clean_text(row.get("officename", ""))

            if state:
                bucket["states"][state] += 1
            if district_name:
                bucket["districts"][district_name] += 1
            if circle:
                bucket["circles"][circle] += 1
            if region:
                bucket["regions"][region] += 1
            if division:
                bucket["divisions"][division] += 1
            if office:
                bucket["offices"][office] += 1

            lat_raw = row.get("latitude", "")
            lon_raw = row.get("longitude", "")
            lat = parse_coordinate(lat_raw)
            lon = parse_coordinate(lon_raw)
            if lat is None or lon is None:
                bucket["missingCoordinateRows"] += 1
                stats["missing_coordinate_rows"] += 1
                continue

            normalized = normalize_coordinate_pair(lat_raw, lon_raw)
            if not normalized:
                bucket["invalidCoordinateRows"] += 1
                stats["invalid_coordinate_rows"] += 1
                continue

            fixed_lat, fixed_lon, mode = normalized
            bucket["points"].append((round(fixed_lat, 6), round(fixed_lon, 6)))
            bucket["coordModes"][mode] += 1
            stats[f"{mode}_coordinate_rows"] += 1

    pins: list[dict] = []
    prefix_entries: dict[str, dict] = {}

    for pin_id, pin in enumerate(sorted(by_pin)):
        bucket = by_pin[pin]
        unique_points = sorted(set(bucket["points"]))
        if unique_points:
            lat = sum(point[0] for point in unique_points) / len(unique_points)
            lon = sum(point[1] for point in unique_points) / len(unique_points)
            x_norm, y_norm = normalize_projected_point(lon, lat, projection_bounds)
            stats["mapped_pins"] += 1
        else:
            lat = None
            lon = None
            x_norm = None
            y_norm = None
            stats["unmapped_pins"] += 1

        pins.append(
            {
                "id": pin_id,
                "pin": pin,
                "lat": round(lat, 6) if lat is not None else None,
                "lon": round(lon, 6) if lon is not None else None,
                "x": x_norm,
                "y": y_norm,
                "zone": pin[0],
                "subzone": pin[:2],
                "district": pin[:3],
                "state": dominant_value(bucket["states"]),
                "districtName": dominant_value(bucket["districts"]),
                "circleName": dominant_value(bucket["circles"]),
                "regionName": dominant_value(bucket["regions"]),
                "divisionName": dominant_value(bucket["divisions"]),
                "officeCount": bucket["rows"],
                "mappedOfficeCount": len(unique_points),
                "officeSamples": [name for name, _count in bucket["offices"].most_common(OFFICE_SAMPLE_LIMIT)],
                "coordinateModes": dict(bucket["coordModes"]),
                "missingCoordinateRows": bucket["missingCoordinateRows"],
                "invalidCoordinateRows": bucket["invalidCoordinateRows"],
            }
        )

    stats["unique_pins"] = len(pins)

    def ensure_prefix_entry(prefix: str) -> dict:
        if prefix not in prefix_entries:
            depth = len(prefix)
            prefix_entries[prefix] = {
                "prefix": prefix,
                "depth": depth,
                "level": LEVEL_NAMES[depth],
                "pinIds": [],
                "mappedPinIds": [],
            }
        return prefix_entries[prefix]

    for pin_record in pins:
        pin = pin_record["pin"]
        for depth in range(0, 7):
            prefix = pin[:depth]
            entry = ensure_prefix_entry(prefix)
            entry["pinIds"].append(pin_record["id"])
            if pin_record["x"] is not None and pin_record["y"] is not None:
                entry["mappedPinIds"].append(pin_record["id"])

    sorted_prefixes = sorted(prefix_entries, key=lambda prefix: (len(prefix), prefix))
    children_by_prefix: dict[str, list[str]] = defaultdict(list)
    for prefix in sorted_prefixes:
        if prefix:
            children_by_prefix[prefix[:-1]].append(prefix)

    prefix_groups = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceCsv": str(SOURCE_CSV.relative_to(REPO_ROOT)),
            "mapAsset": str(MAP_GEOJSON.relative_to(REPO_ROOT)),
            "levelNames": LEVEL_NAMES,
            "projection": projection_bounds,
            "stats": dict(stats),
        },
        "prefixes": {},
    }

    for prefix in sorted_prefixes:
        entry = prefix_entries[prefix]
        depth = entry["depth"]
        children = []
        if depth < 6:
            child_prefixes = children_by_prefix[prefix]
            for child_prefix in child_prefixes:
                child_entry = prefix_entries[child_prefix]
                children.append(
                    {
                        "key": child_prefix[-1],
                        "prefix": child_prefix,
                        "label": group_label(depth, child_prefix),
                        "pinCount": len(child_entry["pinIds"]),
                        "mappedPinCount": len(child_entry["mappedPinIds"]),
                        "pinIds": child_entry["pinIds"],
                        "mappedPinIds": child_entry["mappedPinIds"],
                    }
                )

        prefix_groups["prefixes"][prefix] = {
            "prefix": prefix,
            "depth": depth,
            "level": entry["level"],
            "activeDigitIndex": min(depth + 1, 6),
            "pinCount": len(entry["pinIds"]),
            "mappedPinCount": len(entry["mappedPinIds"]),
            "pinIds": entry["pinIds"],
            "mappedPinIds": entry["mappedPinIds"],
            "groups": children,
        }

    def build_trie(prefix: str = "") -> dict:
        entry = prefix_entries[prefix]
        depth = entry["depth"]
        child_candidates = children_by_prefix[prefix]

        return {
            "prefix": prefix,
            "depth": depth,
            "level": entry["level"],
            "pinCount": len(entry["pinIds"]),
            "mappedPinCount": len(entry["mappedPinIds"]),
            "pinIds": entry["pinIds"],
            "mappedPinIds": entry["mappedPinIds"],
            "groups": [
                {
                    "digit": child_prefix[-1],
                    "prefix": child_prefix,
                    "label": group_label(depth, child_prefix),
                    "pinCount": len(prefix_entries[child_prefix]["pinIds"]),
                    "mappedPinCount": len(prefix_entries[child_prefix]["mappedPinIds"]),
                }
                for child_prefix in child_candidates
            ],
            "children": {child_prefix[-1]: build_trie(child_prefix) for child_prefix in child_candidates},
        }

    trie = {
        "meta": prefix_groups["meta"],
        "root": build_trie(""),
    }

    PINS_JSON.write_text(json.dumps(pins, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    PREFIX_JSON.write_text(json.dumps(prefix_groups, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    TRIE_JSON.write_text(json.dumps(trie, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")

    summary = {
        "pins": len(pins),
        "mappedPins": stats["mapped_pins"],
        "unmappedPins": stats["unmapped_pins"],
        "directCoordinateRows": stats["direct_coordinate_rows"],
        "swappedCoordinateRows": stats["swapped_coordinate_rows"],
        "missingCoordinateRows": stats["missing_coordinate_rows"],
        "invalidCoordinateRows": stats["invalid_coordinate_rows"],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
