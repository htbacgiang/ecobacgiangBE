/**
 * Normalize product unit for consistent storage/display.
 * Requirement: smallest unit is 100g; store/display as "100g".
 */
function normalizeUnit(input) {
  if (input === null || input === undefined) return input;

  const raw = String(input).trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();

  // grams => 100g (accept legacy "100gam" too)
  if (lower === 'gam' || lower === 'g' || lower === 'gram' || lower === 'gr') return '100g';
  if (lower === '100g' || lower === '100 g' || lower === '100gram' || lower === '100 gram') return '100g';
  if (lower === '100gam' || lower === '100 gam') return '100g';

  // keep existing conventions
  if (lower === 'kg') return 'Kg';
  if (lower === 'tui' || lower === 'túi' || lower === 'bag') return 'túi';
  if (lower === 'chai' || lower === 'bottle') return 'chai';
  if (lower === 'hop' || lower === 'hộp' || lower === 'box') return 'hộp';

  return raw;
}

module.exports = { normalizeUnit };


