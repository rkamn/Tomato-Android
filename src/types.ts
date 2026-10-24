export type User = {
  _id?: string;
  id?: string;
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
};

export type AccountRole = 'customer' | 'restaurant' | 'shop' | 'deliveryPartner';

export function isAdminUser(user: User): boolean {
  return ['admin', 'superadmin', 'subadmin'].includes(user.role || '')
    || ['admin', 'superadmin', 'subadmin', 'employee'].includes(user.baseRole || '')
    || user.role === 'employee'
    || Boolean(user.adminRoleTitle)
    || Boolean(user.permissions?.length);
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
  restaurantName?: string;
  restaurantAddress?: string;
  shopAddress?: string;
  customerName?: string;
  customerPhone?: string;
  isPickedUp?: boolean;
  pickupStatus?: string;
  expectedDeliveryTimingMinutes?: number;
  distanceToStoreKm?: number;
  shopName?: string;
  isShopOrder?: boolean;
  isArchived?: boolean;
  items?: OrderItem[];
  createdAt?: string;
  updatedAt?: string;
  deliveryAddress?: {
    label?: string;
    line1?: string;
    line2?: string;
    city?: string;
    postalCode?: string;
    phone?: string;
  };
};

export type CustomerNotification = {
  title?: string;
  message?: string;
  createdAt?: string;
};
