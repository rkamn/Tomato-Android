export type User = {
  _id?: string;
  id?: string;
  customerId?: string;
  customer_id?: string;
  restaurantId?: string;
  restaurant_id?: string;
  shopId?: string;
  shop_id?: string;
  storeId?: string;
  store_id?: string;
  riderId?: string;
  rider_id?: string;
  adminId?: string;
  admin_id?: string;
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  role?: string;
  baseRole?: string;
  permissions?: string[];
  adminRoleTitle?: string;
  isSuperAdmin?: boolean;
  isApproved?: boolean;
  isBlocked?: boolean;
  deliveryVehicle?: string;
  isOnline?: boolean;
  dob?: string;
  gsnNumber?: string;
  address?: string;
  restaurantAddress?: string;
  shopAddress?: string;
  city?: string;
  pincode?: string;
  postalCode?: string;
  digipin?: string;
  cuisine?: string;
  category?: string;
  image?: string;
  photo?: string;
  avatar?: string;
  profilePhoto?: string;
};

export type AccountRole = 'customer' | 'restaurant' | 'shop' | 'deliveryPartner';

export function isAdminUser(user: User): boolean {
  return ['admin', 'superadmin', 'subadmin'].includes(user.role || '')
    || ['admin', 'superadmin', 'subadmin', 'employee'].includes(user.baseRole || '')
    || user.role === 'employee'
    || Boolean(user.adminRoleTitle)
    || Boolean(user.permissions?.length);
}

export function getCustomerId(user?: User | null): string {
  if (!user) return 'cust-1001';
  if (user.customerId) return String(user.customerId);
  if (user.customer_id) return String(user.customer_id);
  const idStr = typeof user.id === 'string' ? user.id : typeof user.id === 'number' ? String(user.id) : '';
  const _idStr = typeof user._id === 'string' ? user._id : typeof user._id === 'number' ? String(user._id) : '';
  if (idStr && (idStr.startsWith('cust-') || idStr.startsWith('CUST-'))) return idStr;
  if (_idStr && (_idStr.startsWith('cust-') || _idStr.startsWith('CUST-'))) return _idStr;
  if (user.role === 'customer' || !user.role) {
    return 'cust-1001';
  }
  return idStr || _idStr || (typeof user.email === 'string' ? user.email : '') || 'cust-1001';
}

export function derive4DigitCode(rawId?: unknown, fallback = 7067): string {
  if (!rawId) return String(fallback);
  const str = String(rawId).trim();
  if (!str) return String(fallback);
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  if (digits.length > 0) {
    return digits.padStart(4, '0');
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) % 9000;
  }
  return String(1000 + Math.abs(hash));
}

export function getAccountDisplayId(user?: User | null, defaultRole?: string): string {
  if (!user) {
    const fallbackRole = (defaultRole || '').toLowerCase();
    if (fallbackRole.includes('restaurant')) return 'rest-7067';
    if (fallbackRole.includes('shop')) return 'shop-7067';
    if (fallbackRole.includes('rider') || fallbackRole.includes('delivery')) return 'rider-7067';
    return 'cust-1001';
  }

  const role = (user.role || user.baseRole || defaultRole || '').toLowerCase();

  if (role.includes('restaurant')) {
    const explicit = user.restaurantId || user.restaurant_id || user.storeId || user.store_id;
    if (explicit && typeof explicit === 'string') {
      const trimmed = explicit.trim();
      if (/^rest-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      if (/^\d+$/.test(trimmed)) return `rest-${trimmed}`;
      return `rest-${derive4DigitCode(trimmed, 7067)}`;
    }
    const idVal = user.id || user._id;
    if (idVal && typeof idVal === 'string') {
      const trimmed = idVal.trim();
      if (/^rest-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      return `rest-${derive4DigitCode(trimmed, 7067)}`;
    }
    return 'rest-7067';
  }

  if (role.includes('shop')) {
    const explicit = user.shopId || user.shop_id || user.storeId || user.store_id;
    if (explicit && typeof explicit === 'string') {
      const trimmed = explicit.trim();
      if (/^shop-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      if (/^\d+$/.test(trimmed)) return `shop-${trimmed}`;
      return `shop-${derive4DigitCode(trimmed, 7067)}`;
    }
    const idVal = user.id || user._id;
    if (idVal && typeof idVal === 'string') {
      const trimmed = idVal.trim();
      if (/^shop-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      return `shop-${derive4DigitCode(trimmed, 7067)}`;
    }
    return 'shop-7067';
  }

  if (role.includes('rider') || role.includes('delivery')) {
    const explicit = user.riderId || user.rider_id;
    if (explicit && typeof explicit === 'string') {
      const trimmed = explicit.trim();
      if (/^rider-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      if (/^\d+$/.test(trimmed)) return `rider-${trimmed}`;
      return `rider-${derive4DigitCode(trimmed, 7067)}`;
    }
    const idVal = user.id || user._id;
    if (idVal && typeof idVal === 'string') {
      const trimmed = idVal.trim();
      if (/^rider-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      return `rider-${derive4DigitCode(trimmed, 7067)}`;
    }
    return 'rider-7067';
  }

  if (isAdminUser(user)) {
    const explicit = user.adminId || user.admin_id;
    if (explicit && typeof explicit === 'string') {
      const trimmed = explicit.trim();
      if (/^admin-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      if (/^\d+$/.test(trimmed)) return `admin-${trimmed}`;
      return `admin-${derive4DigitCode(trimmed, 1001)}`;
    }
    const idVal = user.id || user._id;
    if (idVal && typeof idVal === 'string') {
      const trimmed = idVal.trim();
      if (/^admin-\d+$/i.test(trimmed)) return trimmed.toLowerCase();
      return `admin-${derive4DigitCode(trimmed, 1001)}`;
    }
    return 'admin-1001';
  }

  // Customer or default
  return getCustomerId(user);
}

export function getAccountIdLabel(user?: User | null, defaultRole?: string): string {
  const role = (user?.role || user?.baseRole || defaultRole || '').toLowerCase();
  if (role.includes('restaurant')) return 'Restaurant ID';
  if (role.includes('shop')) return 'Shop ID';
  if (role.includes('rider') || role.includes('delivery')) return 'Rider ID';
  if (isAdminUser(user || {})) return 'Admin ID';
  return 'Customer ID';
}

export type Session = {
  token: string;
  user: User;
};

export type Store = {
  _id?: string;
  id?: string;
  name: string;
  image?: string;
  address?: string;
  restaurantAddress?: string;
  shopAddress?: string;
  cuisine?: string;
  category?: string;
  digipin?: string;
  distanceText?: string;
  distanceKm?: number;
  isApproved?: boolean;
  isServiceable?: boolean;
  rating?: number | null;
  reviewCount?: number;
  isOpen?: boolean;
  isOnline?: boolean;
};

export type ItemVariant = {
  id: string;
  name: string;
  price: number;
};

export type MenuItem = {
  _id: string;
  name: string;
  description?: string;
  image?: string;
  price: number;
  category?: string;
  restaurantId: string;
  restaurantName?: string;
  isAvailable?: boolean;
  isActive?: boolean;
  quantity?: number;
  rating?: number | null;
  reviewCount?: number;
  isShopItem?: boolean;
  storeType?: 'restaurant' | 'shop';
  variants?: ItemVariant[];
  selectedVariant?: ItemVariant;
};

export function getItemVariants(item?: MenuItem | null): ItemVariant[] {
  if (!item) return [];
  const rawVariants = (item as unknown as { variants?: Array<{ id?: string; name?: string; label?: string; price?: number }> }).variants;
  if (Array.isArray(rawVariants) && rawVariants.length > 0) {
    return rawVariants.map((v, i) => ({
      id: v.id || `${item._id}-v-${i}`,
      name: v.name || v.label || `Variant ${i + 1}`,
      price: typeof v.price === 'number' ? v.price : Number(item.price) || 0,
    }));
  }

  const basePrice = Math.max(0, Number(item.price) || 0);
  const cat = (item.category || '').toLowerCase();

  if (cat.includes('beverage') || cat.includes('drink') || cat.includes('shake') || cat.includes('coffee') || cat.includes('tea') || cat.includes('juice')) {
    return [
      { id: 'regular', name: 'Regular', price: Math.round(basePrice) },
      { id: 'large', name: 'Large', price: Math.round(basePrice * 1.35) },
    ];
  }

  if (item.isShopItem || cat.includes('grocery') || cat.includes('dairy') || cat.includes('staple') || cat.includes('produce')) {
    return [
      { id: '500g', name: '500g', price: Math.round(basePrice) },
      { id: '1kg', name: '1 kg', price: Math.round(basePrice * 1.85) },
    ];
  }

  const halfPrice = Math.max(20, Math.round((basePrice * 0.6) / 5) * 5);
  return [
    { id: 'half', name: 'Half', price: halfPrice },
    { id: 'full', name: 'Full', price: basePrice },
  ];
}

export type Address = {
  _id: string;
  label?: string;
  line1: string;
  line2?: string;
  locality?: string;
  city: string;
  state?: string;
  postalCode: string;
  phone?: string;
  digipin?: string;
  coordinates?: number[];
  isDefault?: boolean;
  location?: {
    type?: string;
    coordinates?: number[];
  };
};

export type OrderItem = {
  _id?: string;
  itemId?: string;
  foodItemId?: string;
  name: string;
  quantity: number;
  price?: number;
  unitPrice?: number;
  totalPrice?: number;
};

export type Order = {
  _id: string;
  orderNumber?: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentTransactionId?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  totalAmount?: number;
  restaurantId?: string;
  restaurantName?: string;
  restaurantAddress?: string;
  shopId?: string;
  shopName?: string;
  shopAddress?: string;
  customerName?: string;
  customerPhone?: string;
  riderId?: string;
  riderUserId?: string;
  assignedRiderId?: string;
  riderName?: string;
  riderPhone?: string;
  rider?: {
    id?: string;
    riderId?: string;
    _id?: string;
    name?: string;
    displayName?: string;
    phone?: string;
  };
  isPickedUp?: boolean;
  pickupStatus?: string;
  expectedDeliveryTimingMinutes?: number;
  distanceToStoreKm?: number;
  isShopOrder?: boolean;
  isArchived?: boolean;
  items?: OrderItem[];
  pickupDigipin?: string;
  restaurantDigipin?: string;
  shopDigipin?: string;
  createdAt?: string;
  updatedAt?: string;
  deliveryAddress?: {
    label?: string;
    line1?: string;
    line2?: string;
    locality?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    phone?: string;
    digipin?: string;
    coordinates?: number[];
    location?: {
      type?: string;
      coordinates?: number[];
    };
  };
  returnStatus?: 'pending' | 'in_transit' | 'returned' | 'accepted' | string;
  returnAccepted?: boolean;
  returnAcceptedBy?: 'restaurant' | 'shop' | 'admin' | string;
  returnAcceptedAt?: string;
};

export function isOrderReturnAccepted(
  order: Order,
  tracking?: { returnAccepted?: boolean; returnStatus?: string; trackingClosed?: boolean },
): boolean {
  return Boolean(
    order.returnAccepted ||
    order.returnStatus === 'accepted' ||
    order.status === 'returned' ||
    tracking?.returnAccepted ||
    tracking?.returnStatus === 'accepted' ||
    (order.status === 'cancelled' && tracking?.trackingClosed)
  );
}

export function isOrderTrackingActive(
  order: Order,
  tracking?: { returnAccepted?: boolean; returnStatus?: string; trackingClosed?: boolean },
): boolean {
  const status = (order.status || 'placed').toLowerCase().trim();
  // Tracking ends when delivered to customer
  if (status === 'delivered') return false;
  // If order is cancelled, tracking remains active until returned to source and source accepts the return
  if (status === 'cancelled') {
    return !isOrderReturnAccepted(order, tracking);
  }
  // If returned or rejected, tracking is ended
  if (['returned', 'rejected'].includes(status)) return false;
  // Otherwise order is active
  return true;
}

export type CustomerNotification = {
  title?: string;
  message?: string;
  createdAt?: string;
};

export function formatOrderNumber(orderOrNumber?: { orderNumber?: string | number; _id?: string } | string | number | null): string {
  if (orderOrNumber === null || orderOrNumber === undefined) return '#000000';
  let raw: string;
  if (typeof orderOrNumber === 'object') {
    const o = orderOrNumber as { orderNumber?: string | number; _id?: string };
    if (o.orderNumber !== undefined && o.orderNumber !== null && String(o.orderNumber).trim() !== '') {
      raw = String(o.orderNumber).trim();
    } else if (o._id) {
      raw = String(o._id).slice(-6).toUpperCase();
    } else {
      raw = '000000';
    }
  } else {
    raw = String(orderOrNumber).trim();
  }
  if (!raw) raw = '000000';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

export function formatOrderStatus(status: unknown): string {
  if (!status || typeof status !== 'string') return 'Placed';
  const clean = String(status).trim();
  if (!clean) return 'Placed';
  return clean.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getOrderStatusBadgeColors(status: unknown): { bg: string; text: string } {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'delivered') return { bg: '#1b8742', text: '#ffffff' };
  if (s === 'accepted' || s === 'accepted_by_rider') return { bg: '#dcfce7', text: '#15803d' };
  if (s === 'ready_for_pickup' || s === 'pending') return { bg: '#fef08a', text: '#854d0e' };
  if (s === 'cancelled') return { bg: '#fee2e2', text: '#991b1b' };
  if (s === 'preparing') return { bg: '#eff6ff', text: '#1d4ed8' };
  if (s === 'out_for_delivery' || s === 'in_transit' || s === 'picked_up') return { bg: '#f5f3ff', text: '#6d28d9' };
  if (s === 'returned') return { bg: '#fef2f2', text: '#b91c1c' };
  return { bg: '#fff0e5', text: '#9b541f' };
}
