import React from 'react';
import { View } from 'react-native';
import { formatDigipin } from './digipin';
import type { Address, MenuItem, Store } from './types';

export type BrowseMode = 'restaurant' | 'shop';

export function storeId(store: Store): string {
  return store._id || store.id || '';
}

export function isStoreOpen(store?: Store | null): boolean {
  if (!store) return false;
  if (store.isApproved === false) return false;
  if (store.isOpen === false || store.isOnline === false) return false;
  const anyStore = store as Record<string, unknown>;
  if (anyStore.open === false || anyStore.online === false) return false;
  if (typeof anyStore.status === 'string') {
    const s = anyStore.status.toLowerCase().trim();
    if (s === 'closed' || s === 'offline' || s === 'inactive' || s === 'blocked') {
      return false;
    }
  }
  return true;
}

export function normalizeIdString(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.trim().toLowerCase();
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null) {
    const anyObj = val as Record<string, unknown>;
    if (typeof anyObj.toString === 'function' && anyObj.toString !== Object.prototype.toString) {
      const str = anyObj.toString();
      if (str && typeof str === 'string' && str !== '[object Object]') {
        return str.trim().toLowerCase();
      }
    }
    if (anyObj._id && typeof anyObj._id === 'string') return anyObj._id.trim().toLowerCase();
    if (anyObj.id && typeof anyObj.id === 'string') return anyObj.id.trim().toLowerCase();
    if (anyObj.$oid && typeof anyObj.$oid === 'string') return anyObj.$oid.trim().toLowerCase();
  }
  return '';
}

export function getStoreIds(store?: Store | null): string[] {
  if (!store) return [];
  const ids: string[] = [];
  const push = (val: unknown) => {
    const id = normalizeIdString(val);
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(store._id);
  push(store.id);
  const anyStore = store as unknown as Record<string, unknown>;
  push(anyStore.restaurantId);
  push(anyStore.restaurant_id);
  push(anyStore.userId);
  push(anyStore.user_id);
  push(anyStore.user);
  push(anyStore.shopId);
  push(anyStore.shop_id);
  push(anyStore.storeId);
  push(anyStore.store_id);
  return ids;
}

export function getItemStoreIds(item?: MenuItem | null): string[] {
  if (!item) return [];
  const ids: string[] = [];
  const push = (val: unknown) => {
    const id = normalizeIdString(val);
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(item.restaurantId);
  const anyItem = item as unknown as Record<string, unknown>;
  push(anyItem.restaurant_id);
  push(anyItem.restaurant);
  push(anyItem.shopId);
  push(anyItem.shop_id);
  push(anyItem.shop);
  push(anyItem.storeId);
  push(anyItem.store_id);
  push(anyItem.store);
  push(anyItem.userId);
  push(anyItem.user_id);
  return ids;
}

export function getItemStoreName(item?: MenuItem | null): string {
  if (!item) return '';
  const anyItem = item as unknown as Record<string, unknown>;
  const rawRest = item.restaurantId as unknown;
  const rawRestObj = typeof rawRest === 'object' && rawRest !== null ? (rawRest as Record<string, unknown>) : null;
  const anyRestObj = typeof anyItem.restaurant === 'object' && anyItem.restaurant !== null ? (anyItem.restaurant as Record<string, unknown>) : null;
  const anyShopObj = typeof anyItem.shop === 'object' && anyItem.shop !== null ? (anyItem.shop as Record<string, unknown>) : null;
  const anyStoreObj = typeof anyItem.store === 'object' && anyItem.store !== null ? (anyItem.store as Record<string, unknown>) : null;

  const candidate = (
    item.restaurantName ||
    anyItem.restaurant_name ||
    rawRestObj?.name ||
    anyRestObj?.name ||
    anyShopObj?.name ||
    anyStoreObj?.name ||
    anyItem.shopName ||
    anyItem.shop_name ||
    anyItem.storeName ||
    anyItem.store_name ||
    ''
  );
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export function itemBelongsToStore(item?: MenuItem | null, store?: Store | null): boolean {
  if (!item || !store) return false;

  // 1. Direct ID match
  const storeIdStr = normalizeIdString(store._id || store.id);
  const itemRestIdStr = normalizeIdString(item.restaurantId || (item as any).restaurant_id || (item as any).restaurant);
  if (storeIdStr && itemRestIdStr && storeIdStr === itemRestIdStr) {
    return true;
  }

  // 2. ID list intersection
  const storeIds = getStoreIds(store);
  const itemIds = getItemStoreIds(item);
  for (const sId of storeIds) {
    if (itemIds.includes(sId)) return true;
  }

  // 3. Store name match
  const itemStoreName = getItemStoreName(item).toLowerCase();
  const storeName = String(store.name || '').trim().toLowerCase();
  if (itemStoreName && storeName) {
    if (itemStoreName === storeName || itemStoreName.includes(storeName) || storeName.includes(itemStoreName)) {
      return true;
    }
  }

  return false;
}

export function findStoreForItem(item?: MenuItem | null, allStores?: Store[] | null): Store | undefined {
  if (!item || !Array.isArray(allStores)) return undefined;
  return allStores.find((store) => itemBelongsToStore(item, store));
}

export function formatRupees(value: number): string {
  return `₹${Number(value || 0).toFixed(0)}`;
}

export function addressSummary(address: Address): string {
  const parts = [address.line1, address.line2, address.locality, address.city, address.postalCode]
    .filter(Boolean);
  if (address.digipin) {
    parts.push(`DIGIPIN: ${formatDigipin(address.digipin)}`);
  }
  return parts.join(', ');
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export const VegBadge = React.memo(function VegBadge({ size = 13 }: { size?: number }) {
  const dotSize = Math.max(4, Math.round(size * 0.45));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: '#0f8a3c',
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
      }}
    >
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: '#0f8a3c',
        }}
      />
    </View>
  );
});

export const NonVegBadge = React.memo(function NonVegBadge({ size = 13 }: { size?: number }) {
  const dotSize = Math.max(4, Math.round(size * 0.45));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: '#d83a32',
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
      }}
    >
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: '#d83a32',
        }}
      />
    </View>
  );
});

export function isItemVeg(item?: MenuItem | null): boolean {
  if (!item) return true;
  const anyItem = item as MenuItem & { isVeg?: boolean; dietary?: string };
  if (anyItem.isVeg !== undefined) return Boolean(anyItem.isVeg);
  const dietary = (anyItem.dietary || '').toLowerCase();
  if (dietary === 'veg' || dietary === 'vegan') return true;
  if (dietary === 'non-veg' || dietary === 'nonveg') return false;
  const text = `${item.name || ''} ${item.category || ''} ${item.description || ''}`.toLowerCase();
  if (
    text.includes('chicken') ||
    text.includes('mutton') ||
    text.includes('fish') ||
    text.includes('egg') ||
    text.includes('meat') ||
    text.includes('prawn') ||
    text.includes('pork') ||
    text.includes('beef') ||
    text.includes('non-veg') ||
    text.includes('nonveg')
  ) {
    return false;
  }
  return true;
}

export function getStoreDietary(
  store: Store,
  allItems: MenuItem[],
): { hasVeg: boolean; hasNonVeg: boolean } {
  const storeItems = allItems.filter((i) => itemBelongsToStore(i, store));
  if (!storeItems.length) {
    const storeText = `${store.name} ${store.cuisine || ''} ${store.category || ''}`.toLowerCase();
    const isPureVeg = storeText.includes('pure veg') || storeText.includes('vegetarian');
    const isExplicitNonVeg =
      storeText.includes('chicken') ||
      storeText.includes('mutton') ||
      storeText.includes('meat') ||
      storeText.includes('non-veg');
    if (isPureVeg) return { hasVeg: true, hasNonVeg: false };
    if (isExplicitNonVeg) return { hasVeg: false, hasNonVeg: true };
    return { hasVeg: true, hasNonVeg: false };
  }

  let hasVeg = false;
  let hasNonVeg = false;
  for (const item of storeItems) {
    if (isItemVeg(item)) {
      hasVeg = true;
    } else {
      hasNonVeg = true;
    }
  }
  return { hasVeg, hasNonVeg };
}

export function getCategoryIcon(categoryName?: string | null, mode?: BrowseMode): string {
  const norm = (categoryName || '').trim().toLowerCase();
  if (norm.includes('biryani')) return '🍲';
  if (norm.includes('pizza')) return '🍕';
  if (norm.includes('burger')) return '🍔';
  if (norm.includes('chinese') || norm.includes('noodle') || norm.includes('chow')) return '🍜';
  if (norm.includes('main') || norm.includes('curry') || norm.includes('thali') || norm.includes('gravy')) return '🥘';
  if (norm.includes('bread') || norm.includes('naan') || norm.includes('roti') || norm.includes('paratha')) return '🫓';
  if (norm.includes('snack') || norm.includes('chaat') || norm.includes('fry') || norm.includes('fries') || norm.includes('samosa') || norm.includes('momos')) return '🍟';
  if (norm.includes('beverage') || norm.includes('drink') || norm.includes('tea') || norm.includes('chai') || norm.includes('coffee') || norm.includes('shake') || norm.includes('juice')) return '🧋';
  if (norm.includes('sweet') || norm.includes('mithai') || norm.includes('dessert') || norm.includes('ice cream') || norm.includes('halwa')) return '🍨';
  if (norm.includes('south') || norm.includes('dosa') || norm.includes('idli') || norm.includes('vada')) return '🥞';
  if (norm.includes('cake') || norm.includes('bakery') || norm.includes('pastry')) return '🍰';
  if (norm.includes('grocer') || norm.includes('staple') || norm.includes('atta') || norm.includes('rice') || norm.includes('dal') || norm.includes('oil')) return '🥫';
  if (norm.includes('dairy') || norm.includes('milk') || norm.includes('egg') || norm.includes('paneer') || norm.includes('butter') || norm.includes('cheese') || norm.includes('curd')) return '🥛';
  if (norm.includes('fruit') || norm.includes('veg') || norm.includes('produce')) return '🥦';
  if (norm.includes('meat') || norm.includes('chicken') || norm.includes('fish') || norm.includes('mutton') || norm.includes('kebab')) return '🍗';
  if (norm.includes('packaged') || norm.includes('biscuit') || norm.includes('instant') || norm.includes('namkeen')) return '📦';
  if (norm.includes('personal') || norm.includes('care') || norm.includes('soap') || norm.includes('shampoo')) return '🧴';
  if (norm.includes('clean') || norm.includes('household') || norm.includes('detergent')) return '🧼';
  return mode === 'shop' ? '🛍️' : '🍽️';
}

export function itemMatchesCategory(item?: MenuItem | null, category?: string | null): boolean {
  if (!item) return false;
  if (!category || category.toLowerCase() === 'all') return true;
  const target = category.toLowerCase().trim();
  const itemCat = (item.category || '').toLowerCase().trim();
  const itemName = (item.name || '').toLowerCase().trim();
  const itemDesc = (item.description || '').toLowerCase().trim();

  if (itemCat === target) return true;
  if (itemCat && (itemCat.includes(target) || target.includes(itemCat))) return true;
  if (itemName.includes(target)) return true;
  if (itemDesc.includes(target)) return true;

  // Keyword associations for popular food & grocery categories
  if (target === 'biryani' && (itemName.includes('biryani') || itemCat.includes('biryani'))) return true;
  if (target === 'pizza' && (itemName.includes('pizza') || itemCat.includes('pizza'))) return true;
  if (target === 'burger' && (itemName.includes('burger') || itemCat.includes('burger'))) return true;
  if (target === 'breads' && (itemName.includes('naan') || itemName.includes('roti') || itemName.includes('paratha') || itemName.includes('kulcha') || itemCat.includes('bread'))) return true;
  if (target === 'chinese' && (itemName.includes('noodle') || itemName.includes('manchurian') || itemName.includes('chow') || itemName.includes('fried rice') || itemCat.includes('chinese'))) return true;
  if (target === 'beverage' && (itemName.includes('shake') || itemName.includes('juice') || itemName.includes('tea') || itemName.includes('coffee') || itemName.includes('drink') || itemCat.includes('beverage'))) return true;
  if (target === 'sweets' && (itemName.includes('sweet') || itemName.includes('halwa') || itemName.includes('gulab') || itemName.includes('rasgulla') || itemName.includes('ice cream') || itemCat.includes('sweet') || itemCat.includes('dessert'))) return true;
  if (target === 'snacks' && (itemName.includes('snack') || itemName.includes('samosa') || itemName.includes('pakoda') || itemName.includes('fry') || itemName.includes('chaat') || itemCat.includes('snack'))) return true;
  if (target === 'main course' && (itemCat.includes('main') || itemName.includes('curry') || itemName.includes('paneer') || itemName.includes('dal') || itemName.includes('masala') || itemName.includes('gravy') || itemName.includes('thali') || itemName.includes('korma'))) return true;
  if (target === 'groceries' && (itemCat.includes('grocer') || itemName.includes('oil') || itemName.includes('atta') || itemName.includes('rice') || itemName.includes('dal') || itemName.includes('sugar') || itemName.includes('salt'))) return true;
  if (target.includes('dairy') && (itemCat.includes('dairy') || itemName.includes('milk') || itemName.includes('paneer') || itemName.includes('butter') || itemName.includes('curd') || itemName.includes('cheese') || itemName.includes('egg'))) return true;

  return false;
}

export function storeMatchesCategory(store: Store, category: string, itemsList: MenuItem[]): boolean {
  if (!category || category.toLowerCase() === 'all') return true;
  const target = category.toLowerCase().trim();
  const cuisine = (store.cuisine || '').toLowerCase();
  const cat = (store.category || '').toLowerCase();

  if (cuisine.includes(target) || cat.includes(target)) return true;

  // Keyword associations for store cuisine/category
  if (target === 'chinese' && (cuisine.includes('chinese') || cat.includes('chinese'))) return true;
  if (target === 'biryani' && (cuisine.includes('biryani') || cuisine.includes('mughlai') || cuisine.includes('hyderabadi'))) return true;
  if (target === 'pizza' && (cuisine.includes('pizza') || cuisine.includes('italian'))) return true;
  if (target === 'main course' && (cuisine.includes('north indian') || cuisine.includes('indian') || cuisine.includes('thali') || cuisine.includes('mughlai'))) return true;
  if (target === 'groceries' && (cuisine.includes('grocer') || cat.includes('grocer') || cat.includes('supermarket'))) return true;

  // Check if store sells ANY item in this category:
  return itemsList.some((item) => {
    if (!itemBelongsToStore(item, store)) return false;
    return itemMatchesCategory(item, category);
  });
}

