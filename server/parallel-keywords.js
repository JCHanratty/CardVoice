/**
 * Parallel keyword list — mirrors tcdb-scraper/scraper.py _PARALLEL_KEYWORDS.
 * Used by hierarchy migration and insert-type classification.
 */
const PARALLEL_KEYWORDS = [
  'refractor', 'foil', 'pattern', 'gold', 'silver',
  'red', 'blue', 'green', 'purple', 'orange', 'pink', 'black',
  'white', 'yellow', 'fuchsia', 'burgundy', 'navy', 'aqua',
  'neon green', 'sky blue', 'rose gold',
  'superfractor', 'printing plate', 'shimmer', 'wave',
  'holo', 'prizm', 'mojo', 'x-fractor', 'firefractor',
  'chrome', 'numbered', 'serial', 'mini diamond', 'image variation',
  'speckle', 'lava', 'reptilian', 'gumball', 'peanuts',
  'sunflower', 'popcorn', 'steel metal', 'raywave',
  'geometric', 'platinum',
];

module.exports = { PARALLEL_KEYWORDS };
