'use strict';

// Authoritative pricing logic — the server always recomputes this so the
// stored totals can never be tampered with from the browser.
//
//   barrels (pricing_mode = 'flat')  ->  charge = rate * quantity
//   boxes/other (pricing_mode='volume') -> charge = rate * volume_each * quantity
//
// Volume is L*W*H converted to ft3 (inches) or CBM (cm).

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeVolumeEach(length, width, height, dimUnit) {
  const l = num(length), w = num(width), h = num(height);
  if (l <= 0 || w <= 0 || h <= 0) return { volume: 0, unit: dimUnit === 'cm' ? 'CBM' : 'ft3' };
  if (dimUnit === 'cm') {
    // cm^3 -> cubic meters
    return { volume: (l * w * h) / 1_000_000, unit: 'CBM' };
  }
  // inches^3 -> cubic feet
  return { volume: (l * w * h) / 1728, unit: 'ft3' };
}

function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

// Normalize one raw item (from the client) into a priced item ready to store.
function priceItem(raw) {
  const item_type = String(raw.item_type || 'barrel').toLowerCase();
  const pricing_mode = raw.pricing_mode
    ? String(raw.pricing_mode).toLowerCase()
    : (item_type === 'barrel' ? 'flat' : 'volume');

  const quantity = Math.max(0, Math.min(1000, Math.round(num(raw.quantity) || 1)));
  const rate = num(raw.rate);
  const dim_unit = raw.dim_unit === 'cm' ? 'cm' : 'in';

  let volume_each = 0;
  let volume_unit = dim_unit === 'cm' ? 'CBM' : 'ft3';
  let line_charge = 0;

  if (pricing_mode === 'volume') {
    const v = computeVolumeEach(raw.length, raw.width, raw.height, dim_unit);
    volume_each = round2(v.volume);          // rounded for display/storage
    volume_unit = v.unit;
    line_charge = round2(rate * v.volume * quantity); // charge on exact volume
  } else {
    // flat (barrels)
    line_charge = round2(rate * quantity);
  }

  return {
    item_type,
    description: raw.description ? String(raw.description) : null,
    quantity,
    length: num(raw.length) || null,
    width: num(raw.width) || null,
    height: num(raw.height) || null,
    dim_unit,
    weight: raw.weight != null && raw.weight !== '' ? num(raw.weight) : null,
    weight_unit: raw.weight_unit === 'kg' ? 'kg' : 'lb',
    declared_value: raw.declared_value != null && raw.declared_value !== '' ? num(raw.declared_value) : null,
    pricing_mode,
    rate,
    volume_each,
    volume_unit,
    line_charge,
    sort_order: Math.round(num(raw.sort_order)),
  };
}

// Roll a list of priced items up into shipment-level totals.
function totalsFor(items) {
  let total_pieces = 0, total_weight = 0, total_value = 0, total_charge = 0;
  for (const it of items) {
    const q = num(it.quantity);
    total_pieces += q;
    total_weight += num(it.weight) * q;
    total_value += num(it.declared_value) * q;
    total_charge += num(it.line_charge);
  }
  return {
    total_pieces,
    total_weight: round2(total_weight),
    total_value: round2(total_value),
    total_charge: round2(total_charge),
  };
}

module.exports = { priceItem, totalsFor, computeVolumeEach, round2, num };
