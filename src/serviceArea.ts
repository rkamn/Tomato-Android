import * as SecureStore from 'expo-secure-store';
import { decodeDigipin } from './digipin';
import type { Address, Store } from './types';

export type ServiceArea = {
  id: string;
  name: string;
  pincodes: string[];
  assignedAdminId?: string;
  assignedAdminName?: string;
  assignedAdminRole?: string;
  city?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
};

export const SERVICE_AREAS_STORAGE_KEY = 'tomato.service_areas.v1';

export async function loadStoredServiceAreas(): Promise<ServiceArea[]> {
  try {
    const raw = await SecureStore.getItemAsync(SERVICE_AREAS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to load stored service areas:', err);
  }
  return [];
}

export async function persistServiceAreas(areas: ServiceArea[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(SERVICE_AREAS_STORAGE_KEY, JSON.stringify(areas));
  } catch (err) {
    console.warn('Failed to persist service areas:', err);
  }
}

export function extractPincode(text?: string): string | undefined {
  if (!text) return undefined;
  const match = String(text).match(/\b([1-9][0-9]{4,5})\b/);
  return match ? match[1] : undefined;
}

export function getStorePincode(store?: Store | null, cartItem?: any): string {
  if (!store && !cartItem) return '';
  const raw = String(
    (store as any)?.pincode ||
    (store as any)?.postalCode ||
    (store as any)?.pickupPincode ||
    cartItem?.pickupPincode ||
    cartItem?.restaurantPincode ||
    cartItem?.shopPincode ||
    ''
  ).trim();

  const matched = extractPincode(raw);
  if (matched) return matched;

  const addr = [
    store?.restaurantAddress,
    store?.shopAddress,
    store?.address,
    cartItem?.restaurantAddress,
    cartItem?.shopAddress,
  ].filter(Boolean).join(' ');

  return extractPincode(addr) || (/^[1-9][0-9]{4,5}$/.test(raw) ? raw : '');
}

export function getAddressPincode(address?: Address | null): string {
  if (!address) return '';
  const raw = String(address.postalCode || (address as any).pincode || '').trim();
  const matched = extractPincode(raw);
  if (matched) return matched;

  const addr = [
    address.line1,
    address.line2,
    address.locality,
    address.city,
    address.state,
  ].filter(Boolean).join(' ');

  return extractPincode(addr) || (/^[1-9][0-9]{4,5}$/.test(raw) ? raw : '');
}

export const DEFAULT_SERVICEABLE_PINCODES = [
  '560001', '560002', '560025', '560038', '560100', '560102', '560103',
  '411057', '411058',
  '845401', '845402',
  '110001', '110002',
];

export const KNOWN_SERVICEABLE_CLUSTERS: string[][] = [
  ['845401', '845402'], // Motihari cluster
  ['560001', '560002', '560025', '560038', '560100', '560102', '560103'], // Bengaluru cluster
  ['411057', '411058'], // Pune cluster
  ['110001', '110002'], // Delhi cluster
];

export type ServiceAreaCheckResult = {
  isServiceable: boolean;
  custPin: string;
  storePin: string;
  reason?: string;
  matchedAreaName?: string;
};

export function checkServiceAreaMatch(params: {
  custPin: string;
  storePin: string;
  serviceAreas?: ServiceArea[];
  isStoreServiceable?: boolean;
  areaMessage?: string;
  isShop?: boolean;
  storeType?: 'restaurant' | 'shop';
  custCoords?: { lat: number; lng: number } | null;
  storeCoords?: { lat: number; lng: number } | null;
  maxDistanceKm?: number;
}): ServiceAreaCheckResult {
  const {
    custPin,
    storePin,
    serviceAreas = [],
    isStoreServiceable,
    areaMessage,
    isShop = false,
    storeType,
    custCoords,
    storeCoords,
    maxDistanceKm = 15,
  } = params;

  const isShopStore = Boolean(isShop || storeType === 'shop');
  const storeLabel = isShopStore ? 'Shop' : 'Restaurant';

  // 1. Explicit backend serviceability flag
  if (isStoreServiceable === false) {
    return {
      isServiceable: false,
      custPin,
      storePin,
      reason: areaMessage && areaMessage.toLowerCase().includes('far')
        ? areaMessage
        : `${storeLabel} is too far: ${storeLabel} is not serviceable in your delivery area (PIN ${custPin || 'N/A'}).`,
    };
  }

  // 2. Explicit backend area message indicating distance issue (ignore restaurant-only message for shop orders)
  if (areaMessage && (areaMessage.toLowerCase().includes('far') || areaMessage.toLowerCase().includes('not serviceable'))) {
    if (!isShopStore || areaMessage.toLowerCase().includes('shop')) {
      return {
        isServiceable: false,
        custPin,
        storePin,
        reason: areaMessage,
      };
    }
  }

  // 3. If neither pin could be resolved
  if (!custPin && !storePin) {
    return { isServiceable: true, custPin: '', storePin: '' };
  }

  const cleanCust = extractPincode(custPin) || String(custPin || '').trim();
  const cleanStore = extractPincode(storePin) || String(storePin || '').trim();

  // 4. Same pincode local delivery: If customer and store share the same pincode, delivery is always serviceable
  if (cleanCust && cleanStore && cleanCust === cleanStore) {
    return {
      isServiceable: true,
      custPin: cleanCust,
      storePin: cleanStore,
      matchedAreaName: 'Local Same-Pincode Delivery',
    };
  }

  // 5. Regional twin cluster (e.g. 845401 & 845402 in Motihari)
  if (cleanCust && cleanStore) {
    const inSameCluster = KNOWN_SERVICEABLE_CLUSTERS.some((cluster) =>
      cluster.includes(cleanCust) && cluster.includes(cleanStore)
    );
    if (inSameCluster) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: cleanStore,
        matchedAreaName: 'Regional Service Cluster',
      };
    }
  }

  // 6. Coordinate / DIGIPIN physical distance check
  if (custCoords && storeCoords && custCoords.lat && custCoords.lng && storeCoords.lat && storeCoords.lng) {
    const dist = calculateDistanceKm(custCoords.lat, custCoords.lng, storeCoords.lat, storeCoords.lng);
    const maxRadius = isShopStore ? Math.max(maxDistanceKm, 25) : maxDistanceKm;
    if (dist <= maxRadius) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: cleanStore,
        matchedAreaName: `Distance verified (~${dist} km)`,
      };
    }
    return {
      isServiceable: false,
      custPin: cleanCust,
      storePin: cleanStore,
      reason: `${storeLabel} is too far: Delivery distance (~${dist} km) exceeds maximum delivery radius (${maxRadius} km).`,
    };
  }

  // 7. For Shops: If the customer selected address is in a serviceable pincode (e.g. 845401),
  // or if store pincode is unlisted/missing, allow shop order without blocking.
  if (isShopStore) {
    if (cleanCust && (isPincodeInServiceAreas(cleanCust, serviceAreas) || !cleanStore)) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: cleanStore,
        matchedAreaName: 'Shop Delivery Area Verified',
      };
    }
  }

  // 8. Check against configured service areas
  if (serviceAreas.length > 0) {
    // If customer pin is in serviceable area list and store pin was not specified
    if (cleanCust && !cleanStore && isPincodeInServiceAreas(cleanCust, serviceAreas)) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: '',
        matchedAreaName: 'Verified Service Area',
      };
    }

    if (!cleanCust || !cleanStore) {
      // If it's a shop and customer pin is known, allow fulfillment
      if (isShopStore && cleanCust) {
        return {
          isServiceable: true,
          custPin: cleanCust,
          storePin: cleanStore,
          matchedAreaName: 'Shop Local Coverage',
        };
      }
      return {
        isServiceable: false,
        custPin: cleanCust,
        storePin: cleanStore,
        reason: `${storeLabel} is too far: Unable to verify delivery coverage for pincodes (Customer: ${cleanCust || 'Missing'}, ${storeLabel}: ${cleanStore || 'Missing'}).`,
      };
    }

    const matchedArea = serviceAreas.find((area) => {
      if (!Array.isArray(area.pincodes)) return false;
      const cleanPins = area.pincodes.map((p) => extractPincode(p) || String(p).trim());
      return cleanPins.includes(cleanCust) && cleanPins.includes(cleanStore);
    });

    if (matchedArea) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: cleanStore,
        matchedAreaName: matchedArea.name,
      };
    }

    // If it's a shop, don't rigidly block if customer pin is in default serviceable list
    if (isShopStore && isPincodeInServiceAreas(cleanCust, serviceAreas)) {
      return {
        isServiceable: true,
        custPin: cleanCust,
        storePin: cleanStore,
        matchedAreaName: 'Shop Regional Coverage',
      };
    }

    // Both pins exist, but no single area contains both
    return {
      isServiceable: false,
      custPin: cleanCust,
      storePin: cleanStore,
      reason: `${storeLabel} is too far: Customer selected address pincode (${cleanCust}) and ${storeLabel.toLowerCase()} pincode (${cleanStore}) are not in the same serviceable area list pincode.`,
    };
  }

  // 9. Fallback when no custom service areas are defined yet:
  if (isShopStore && cleanCust) {
    return { isServiceable: true, custPin: cleanCust, storePin: cleanStore };
  }

  if (cleanCust && cleanStore && cleanCust !== cleanStore) {
    return {
      isServiceable: false,
      custPin: cleanCust,
      storePin: cleanStore,
      reason: `${storeLabel} is too far: Customer selected address pincode (${cleanCust}) and ${storeLabel.toLowerCase()} pincode (${cleanStore}) are not in the same serviceable area list pincode.`,
    };
  }

  return { isServiceable: true, custPin: cleanCust, storePin: cleanStore };
}

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const pLat1 = Number(lat1) || 0;
  const pLon1 = Number(lon1) || 0;
  const pLat2 = Number(lat2) || 0;
  const pLon2 = Number(lon2) || 0;
  if (!pLat1 || !pLon1 || !pLat2 || !pLon2) return 999;
  const R = 6371; // Earth's radius in km
  const dLat = (pLat2 - pLat1) * (Math.PI / 180);
  const dLon = (pLon2 - pLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pLat1 * (Math.PI / 180)) *
      Math.cos(pLat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

export function getStoreCoordinates(store?: Store | null): { lat: number; lng: number } | null {
  if (!store) return null;
  if (store.digipin) {
    const decoded = decodeDigipin(store.digipin);
    if (decoded) return decoded;
  }
  const rawCoords = (store as any).coordinates || (store as any).location?.coordinates;
  if (Array.isArray(rawCoords) && rawCoords.length === 2) {
    const lng = Number(rawCoords[0]);
    const lat = Number(rawCoords[1]);
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return null;
}

export function isStoreServiceableForCustomer(params: {
  store: Store;
  custPin?: string;
  serviceAreas?: ServiceArea[];
  custCoords?: { lat: number; lng: number } | null;
  gpsPin?: string;
  maxDistanceKm?: number;
}): boolean {
  const { store, custPin, serviceAreas = [], custCoords, gpsPin, maxDistanceKm = 15 } = params;

  if (store.isServiceable === false) return false;
  const storePin = getStorePincode(store);

  const storeCoords = getStoreCoordinates(store);
  const isShop = Boolean((store as any).category || store.shopAddress || (store as any).isShop);

  // 1. If customer has a selected address pincode:
  if (custPin) {
    const check = checkServiceAreaMatch({
      custPin,
      storePin,
      serviceAreas,
      isStoreServiceable: store.isServiceable,
      isShop,
      custCoords,
      storeCoords,
      maxDistanceKm,
    });
    return check.isServiceable;
  }

  // 2. If customer has NO selected address, evaluate against current location:
  if (gpsPin) {
    const check = checkServiceAreaMatch({
      custPin: gpsPin,
      storePin,
      serviceAreas,
      isStoreServiceable: store.isServiceable,
      isShop,
      custCoords,
      storeCoords,
      maxDistanceKm,
    });
    if (check.isServiceable) return true;
  }

  if (custCoords) {
    const storeCoords = getStoreCoordinates(store);
    if (storeCoords) {
      const dist = calculateDistanceKm(custCoords.lat, custCoords.lng, storeCoords.lat, storeCoords.lng);
      return dist <= maxDistanceKm;
    }
    if (typeof store.distanceKm === 'number') {
      return store.distanceKm <= maxDistanceKm;
    }
  }

  // Fallback: If no address and no GPS yet, default to allowing store if open and approved
  return true;
}

export function getAllServiceablePincodes(serviceAreas: ServiceArea[] = []): string[] {
  const set = new Set<string>();
  DEFAULT_SERVICEABLE_PINCODES.forEach((p) => set.add(p));
  for (const area of serviceAreas) {
    if (Array.isArray(area.pincodes)) {
      for (const p of area.pincodes) {
        const clean = extractPincode(p) || String(p).trim();
        if (clean) set.add(clean);
      }
    }
  }
  return Array.from(set);
}

export function isPincodeInServiceAreas(pincode?: string, serviceAreas: ServiceArea[] = []): boolean {
  if (!pincode) return false;
  const pin = extractPincode(pincode) || pincode.trim();
  if (!pin) return false;
  const allPins = getAllServiceablePincodes(serviceAreas);
  return allPins.includes(pin);
}

