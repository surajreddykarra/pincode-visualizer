const PinColors = (() => {
  // 9 bold, distinguishable colors for zones
  const PALETTE = [
    '#E53935', // Red - Zone 1
    '#1E88E5', // Blue - Zone 2
    '#43A047', // Green - Zone 3
    '#FB8C00', // Orange - Zone 4
    '#8E24AA', // Purple - Zone 5
    '#00897B', // Teal - Zone 6
    '#D81B60', // Magenta - Zone 7
    '#6D4C41', // Brown - Zone 8
    '#00ACC1', // Cyan - Zone 9
  ];

  const DIMMED_COLOR = 'rgba(100, 100, 100, 0.15)';
  const HIGHLIGHT_COLOR = '#FFD54F'; // Gold for deep selections

  // Get color for a group at the current depth
  // groupIndex cycles through PALETTE
  function getColor(groupIndex) {
    return PALETTE[groupIndex % PALETTE.length];
  }

  // Get zone color specifically (zone digit 1-9 maps to index 0-8)
  function getZoneColor(zoneDigit) {
    return PALETTE[(parseInt(zoneDigit) - 1) % PALETTE.length];
  }

  /**
   * Get color for a digit at a given depth.
   * At depth 0 (zones), digit 1-9 maps to palette index 0-8.
   * At deeper depths, cycle through the palette by digit value.
   */
  function forDigit(digit, depth) {
    const d = parseInt(digit, 10);
    if (depth === 0) {
      // Zone level: digit 1-9 -> index 0-8
      return PALETTE[(d - 1 + PALETTE.length) % PALETTE.length];
    }
    // Sub-zone and deeper: cycle through palette by digit
    return PALETTE[d % PALETTE.length];
  }

  return { PALETTE, DIMMED_COLOR, HIGHLIGHT_COLOR, getColor, getZoneColor, forDigit };
})();
