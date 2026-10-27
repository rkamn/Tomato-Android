import { Linking } from 'react-native';

export const DIGIPIN_BOUNDS = {
  minLat: 2.5,
  maxLat: 38.5,
  minLon: 63.5,
  maxLon: 99.5,
};

export const DIGIPIN_GRID = [
  ['F', 'C', '9', '8'],
  ['J', '3', '2', '7'],
  ['K', '4', '5', '6'],
  ['L', 'M', 'P', 'T'],
];

export function normalizeDigipin(value?: unknown): string {
  if (!value) return '';
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  if (!str) return '';
  return str.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidDigipin(value?: unknown): boolean {
  if (!value) return false;
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  if (!str) return false;
  const cleaned = normalizeDigipin(str);
  if (cleaned.length < 6 || cleaned.length > 14) {
    return false;
  }
  return /^[A-Z0-9]+$/.test(cleaned);
}

export function formatDigipin(value?: unknown): string {
  if (!value) return '';
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  if (!str) return '';
  const raw = str.trim().toUpperCase();
  if (raw.includes('-')) return raw;
  const cleaned = raw.replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return raw;
}

/**
 * Encodes latitude & longitude into official India Post 10-character DIGIPIN code.
 */
export function encodeDigipin(lat: number, lon: number): string {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    return '';
  }
  let minLat = DIGIPIN_BOUNDS.minLat;
  let maxLat = DIGIPIN_BOUNDS.maxLat;
  let minLon = DIGIPIN_BOUNDS.minLon;
  let maxLon = DIGIPIN_BOUNDS.maxLon;
  let digipin = '';

  for (let level = 0; level < 10; level++) {
    const latSpan = (maxLat - minLat) / 4;
    const lonSpan = (maxLon - minLon) / 4;

    let rowIndex = Math.floor((maxLat - lat) / latSpan);
    let colIndex = Math.floor((lon - minLon) / lonSpan);

    if (isNaN(rowIndex) || rowIndex < 0) rowIndex = 0;
    if (rowIndex > 3) rowIndex = 3;
    if (isNaN(colIndex) || colIndex < 0) colIndex = 0;
    if (colIndex > 3) colIndex = 3;

    digipin += DIGIPIN_GRID[rowIndex][colIndex];

    maxLat = maxLat - rowIndex * latSpan;
    minLat = maxLat - latSpan;
    minLon = minLon + colIndex * lonSpan;
    maxLon = minLon + lonSpan;
  }

  return formatDigipin(digipin);
}

/**
 * Returns Mappls Map URL for viewing, searching or generating DIGIPIN.
 */
export function getMapplsUrlForDigipin(digipin?: string): string {
  const clean = normalizeDigipin(digipin);
  if (clean) {
    return `https://www.mappls.com/${encodeURIComponent(clean)}`;
  }
  return 'https://www.mappls.com';
}

/**
 * Opens Mappls map portal or DIGIPIN portal directly in the browser / native app.
 */
export async function openMapplsMap(digipin?: string): Promise<void> {
  const url = getMapplsUrlForDigipin(digipin);
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // fallback
  }
  try {
    await Linking.openURL('https://digipin.org.in');
  } catch {
    try {
      await Linking.openURL('https://www.mappls.com');
    } catch {
      // ignore
    }
  }
}

/**
 * Navigates to a delivery destination prioritizing DIGIPIN, and falling back to GPS coordinates.
 */
export async function openNavigationTarget({
  digipin,
  lat,
  lng,
  address,
}: {
  digipin?: string;
  lat?: number;
  lng?: number;
  address?: string;
}): Promise<void> {
  const cleanDigipin = normalizeDigipin(digipin);
  if (cleanDigipin && isValidDigipin(cleanDigipin)) {
    // 1st Priority: Customer / Partner DIGIPIN via Mappls
    await openMapplsMap(cleanDigipin);
    return;
  }

  if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
    // 2nd Priority: GPS Coordinates set/shared by customer
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // fallback
    }
  }

  if (address?.trim()) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }
}

