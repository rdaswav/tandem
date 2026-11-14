// The check-in prompt pack: loading, validation and the weekly rotating question.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daysBetween } from './week.js';

const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts', 'prompts.json');

// Rotation counts whole weeks from this date.
export const ROTATION_EPOCH = '2026-01-04';

export const MAX_TEXT_LENGTH = 140;
export const MIN_ROTATING = 12;
export const MAX_FIXED = 6;

const ID_RE = /^[a-z0-9_]+$/;

function checkEntry(entry, where, seen, errors) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${where}: must be an object with id and text`);
    return;
  }
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) {
    errors.push(`${where}: id must be lower case letters, digits and underscore`);
  } else if (seen.has(entry.id)) {
    errors.push(`${where}: duplicate id "${entry.id}"`);
  } else {
    seen.add(entry.id);
  }
  if (typeof entry.text !== 'string' || entry.text.trim().length === 0) {
    errors.push(`${where}: text must not be empty`);
  } else if ([...entry.text].length > MAX_TEXT_LENGTH) {
    errors.push(`${where}: text is longer than ${MAX_TEXT_LENGTH} characters`);
  }
}

// Returns a list of problems. An empty list means the pack is valid.
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['pack must be an object'];

  if (!Number.isInteger(pack.version) || pack.version < 1) errors.push('version must be a whole number, 1 or more');

  const seen = new Set();
  if (!Array.isArray(pack.fixed)) {
    errors.push('fixed must be a list');
  } else {
    if (pack.fixed.length < 1 || pack.fixed.length > MAX_FIXED) {
      errors.push(`fixed must have 1 to ${MAX_FIXED} entries`);
    }
    pack.fixed.forEach((entry, i) => checkEntry(entry, `fixed[${i}]`, seen, errors));
  }
  if (!Array.isArray(pack.rotating)) {
    errors.push('rotating must be a list');
  } else {
    if (pack.rotating.length < MIN_ROTATING) errors.push(`rotating must have at least ${MIN_ROTATING} entries`);
    pack.rotating.forEach((entry, i) => checkEntry(entry, `rotating[${i}]`, seen, errors));
  }
  return errors;
}

let cached = null;

// Loads and validates a pack. The default pack is read once and kept.
export function loadPrompts(file = DEFAULT_FILE) {
  if (file === DEFAULT_FILE && cached) return cached;
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validatePack(pack);
  if (errors.length > 0) throw new Error(`invalid prompt pack: ${errors.join('; ')}`);
  if (file === DEFAULT_FILE) cached = pack;
  return pack;
}

// The rotating prompt for a round. Works from any week start date: it counts
// whole weeks since the epoch (rounding down), so every date in the same
// seven-day span of a given start day lands on the same question.
export function rotatingFor(weekStart, pack = loadPrompts()) {
  const weeks = Math.floor(daysBetween(ROTATION_EPOCH, weekStart) / 7);
  const n = pack.rotating.length;
  return pack.rotating[((weeks % n) + n) % n];
}

// The text for a stored prompt id. A prompt removed from the pack later falls
// back to its id, so old rounds still show something.
export function promptText(id, pack = loadPrompts()) {
  const found = [...pack.fixed, ...pack.rotating].find((p) => p.id === id);
  return found ? found.text : id;
}
