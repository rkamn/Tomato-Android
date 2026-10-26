export type User = {
  _id?: string;
  id?: string;
  customerId?: string;
  customer_id?: string;
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
};

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
  isDefault?: boolean;
  location?: {
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
  totalAmount?: number;
  restaurantId?: string;
  restaurantName?: string;
  restaurantAddress?: string;
  shopId?: string;
  shopName?: string;
  shopAddress?: string;
  customerName?: string;
  customerPhone?: string;
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
    city?: string;
    postalCode?: string;
    phone?: string;
    digipin?: string;
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
