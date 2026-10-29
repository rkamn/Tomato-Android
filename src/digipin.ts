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

const CHAR_MAP: Record<string, { row: number; col: number }> = {};
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    CHAR_MAP[DIGIPIN_GRID[r][c]] = { row: r, col: c };
  }
}

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
 * Decodes an official India Post DIGIPIN into latitude & longitude coordinates.
 */
export function decodeDigipin(value?: unknown): { lat: number; lng: number } | null {
  if (!value) return null;
  const clean = normalizeDigipin(value);
  if (!clean || clean.length < 4) return null;

  let minLat = DIGIPIN_BOUNDS.minLat;
  let maxLat = DIGIPIN_BOUNDS.maxLat;
  let minLon = DIGIPIN_BOUNDS.minLon;
  let maxLon = DIGIPIN_BOUNDS.maxLon;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const pos = CHAR_MAP[ch];
    if (!pos) return null;

    const latSpan = (maxLat - minLat) / 4;
    const lonSpan = (maxLon - minLon) / 4;

    const nextMaxLat = maxLat - pos.row * latSpan;
    const nextMinLat = nextMaxLat - latSpan;
    const nextMinLon = minLon + pos.col * lonSpan;
    const nextMaxLon = nextMinLon + lonSpan;

    maxLat = nextMaxLat;
    minLat = nextMinLat;
    minLon = nextMinLon;
    maxLon = nextMaxLon;
  }

  const lat = Number(((minLat + maxLat) / 2).toFixed(6));
  const lng = Number(((minLon + maxLon) / 2).toFixed(6));

  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

/**
 * Searches a freeform text string for an India Post DIGIPIN pattern (e.g. 39J-438-TJC7 or 39J438TJC7).
 */
export function extractDigipinFromText(text?: unknown): string {
  if (!text || typeof text !== 'string') return '';
  const matches = text.match(/\b([FC98J327K456LMPT]{3}-?[FC98J327K456LMPT]{3}-?[FC98J327K456LMPT]{4})\b/i);
  if (matches && matches[1]) {
    const clean = normalizeDigipin(matches[1]);
    if (isValidDigipin(clean)) return clean;
  }
  return '';
}

/**
 * Resolves customer DIGIPIN across all possible fields on an order, address, or customer object.
 */
export function resolveCustomerDigipin(source?: unknown): string {
  if (!source) return '';
  if (typeof source === 'string') {
    const clean = normalizeDigipin(source);
    if (isValidDigipin(clean)) return clean;
    const extracted = extractDigipinFromText(source);
    if (extracted) return extracted;
    return '';
  }

  if (typeof source !== 'object') return '';
  const obj = source as Record<string, any>;

  const candidates: unknown[] = [
    obj.deliveryAddress?.digipin,
    obj.deliveryAddress?.digiPin,
    obj.deliveryAddress?.deliveryDigipin,
    obj.customerDigipin,
    obj.deliveryDigipin,
    obj.dropDigipin,
    obj.digipin,
    obj.customer?.digipin,
    obj.customer?.address?.digipin,
    obj.user?.digipin,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      const clean = normalizeDigipin(candidate);
      if (isValidDigipin(clean)) return clean;
    }
  }

  // Check postalCode in deliveryAddress if customer entered DIGIPIN in pincode field
  const candidatePostal = obj.deliveryAddress?.postalCode || obj.postalCode;
  if (candidatePostal) {
    const cleanPostal = normalizeDigipin(candidatePostal);
    if (cleanPostal.length === 10 && isValidDigipin(cleanPostal)) {
      return cleanPostal;
    }
  }

  // Check address lines for embedded DIGIPIN
  const addressText = [
    obj.deliveryAddress?.line1,
    obj.deliveryAddress?.line2,
    obj.deliveryAddress?.locality,
    obj.address,
    obj.line1,
    obj.line2,
  ].filter(Boolean).join(' ');

  if (addressText) {
    const extracted = extractDigipinFromText(addressText);
    if (extracted) return extracted;
  }

  return '';
}

/**
 * Detects whether GPS coordinates match the default Bangalore center seed (lat ~12.9716, lng ~77.5946).
 */
export function isDefaultBangaloreCoords(lat?: number, lng?: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return false;
  }
  return (
    Math.abs(lat - 12.9716) < 0.015 &&
    Math.abs(lng - 77.5946) < 0.015
  );
}

/**
 * Resolves exact customer coordinates prioritizing customer DIGIPIN.
 * If customer has a valid DIGIPIN, decodes it into exact lat/lng coordinates.
 * Prevents false fallbacks to default Bangalore coordinates when a DIGIPIN was provided.
 */
export function resolveCustomerLocation(source?: unknown): {
  digipin: string;
  lat?: number;
  lng?: number;
  isFromDigipin: boolean;
  isBangaloreDefault: boolean;
} {
  const digipin = resolveCustomerDigipin(source);
  if (digipin) {
    const decoded = decodeDigipin(digipin);
    if (decoded) {
      return {
        digipin,
        lat: decoded.lat,
        lng: decoded.lng,
        isFromDigipin: true,
        isBangaloreDefault: false,
      };
    }
  }

  // Fallback to raw GPS coordinates if present
  let rawCoords: number[] | undefined;
  if (source && typeof source === 'object') {
    const obj = source as Record<string, any>;
    rawCoords =
      obj.deliveryAddress?.coordinates ||
      obj.deliveryAddress?.location?.coordinates ||
      obj.location?.coordinates ||
      obj.coordinates;
  }

  if (Array.isArray(rawCoords) && rawCoords.length >= 2 && !isNaN(rawCoords[0]) && !isNaN(rawCoords[1])) {
    const lng = Number(rawCoords[0]);
    const lat = Number(rawCoords[1]);
    return {
      digipin: '',
      lat,
      lng,
      isFromDigipin: false,
      isBangaloreDefault: isDefaultBangaloreCoords(lat, lng),
    };
  }

  return {
    digipin: '',
    isFromDigipin: false,
    isBangaloreDefault: false,
  };
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
  let targetLat = lat;
  let targetLng = lng;

  if (cleanDigipin && isValidDigipin(cleanDigipin)) {
    const decoded = decodeDigipin(cleanDigipin);
    if (decoded) {
      targetLat = decoded.lat;
      targetLng = decoded.lng;
    }
    // 1st Priority: Customer / Partner DIGIPIN via Mappls
    await openMapplsMap(cleanDigipin);
    return;
  }

  // If lat/lng matches default Bangalore coordinates and address exists, prefer searching address
  if (isDefaultBangaloreCoords(targetLat, targetLng) && address?.trim()) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // fallback
    }
  }

  if (typeof targetLat === 'number' && typeof targetLng === 'number' && !isNaN(targetLat) && !isNaN(targetLng)) {
    // 2nd Priority: GPS Coordinates set/shared by customer
    const url = `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}`;
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

