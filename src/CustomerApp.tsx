import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiPath, apiRequest } from './api';
import ProfileAccess from './ProfileAccess';
import type { ProfileMenuItem } from './ProfileAccess';
import type {
  Address,
  CustomerNotification,
  MenuItem,
  Order,
  Session,
  Store,
  User,
} from './types';

type Tab = 'browse' | 'cart' | 'orders' | 'addresses' | 'account';
type BrowseMode = 'restaurant' | 'shop';
type CartLine = MenuItem & { quantity: number; availableQuantity?: number };
type Coupon = {
  code: string;
  title?: string;
  description?: string;
  discountValue?: number;
  discountType?: string;
};
type CouponValidation = {
  valid: boolean;
  message?: string;
  totalDiscount?: number;
  appliedCoupons?: { code: string; title?: string; discountAmount?: number }[];
  rejectedCoupons?: { code: string; reason: string }[];
};
type OrderTracking = {
  orderId?: string;
  orderNumber?: string;
  riderUserId?: string;
  status?: string;
  trackingClosed?: boolean;
  estimatedMinutes?: number;
  expectedDeliveryTimingMinutes?: number;
  telemetry?: {
    etaMinutes?: number;
    lastPingSecondsAgo?: number | null;
    isLiveOnline?: boolean;
    riderLocation?: { lat?: number; lng?: number };
    currentLocation?: { lat?: number; lng?: number };
  };
  isPickedUp?: boolean;
  pickupStatus?: string;
  rider?: {
    name?: string;
    phone?: string;
    lastLocationUpdated?: string;
    isOnline?: boolean;
    currentLocation?: { lat?: number; lng?: number };
    location?: { coordinates?: number[] };
  };
};
type Bill = {
  invoiceNumber?: string;
  orderNumber?: string;
  date?: string;
  items?: { name?: string; quantity?: number; price?: number; totalPrice?: number }[];
  subtotal?: number;
  cgst?: number;
  sgst?: number;
  tax?: number;
  deliveryFee?: number;
  grossAmount?: number;
  discountAmount?: number;
  couponCodes?: string[];
  totalAmount?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  orderStatus?: string;
};
type ReviewTarget = { orderId: string; itemId: string; itemName: string };

type Props = {
  session: Session;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'browse', label: 'Browse', icon: '⌕' },
  { id: 'cart', label: 'Cart', icon: '🛍' },
  { id: 'orders', label: 'Orders', icon: '📦' },
  { id: 'addresses', label: 'Address', icon: '📍' },
  { id: 'account', label: 'Account', icon: '☺' },
];

function storeId(store: Store): string {
  return store._id || store.id || '';
}

function formatRupees(value: number): string {
  return `₹${Number(value || 0).toFixed(0)}`;
}

function addressSummary(address: Address): string {
  return [address.line1, address.line2, address.locality, address.city, address.postalCode]
    .filter(Boolean)
    .join(', ');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function CustomerApp({ session, onSignOut, onSessionUserUpdate }: Props) {
  const [tab, setTab] = useState<Tab>('browse');
  const [mode, setMode] = useState<BrowseMode>('restaurant');
  const [restaurants, setRestaurants] = useState<Store[]>([]);
  const [shops, setShops] = useState<Store[]>([]);
  const [restaurantItems, setRestaurantItems] = useState<MenuItem[]>([]);
  const [shopItems, setShopItems] = useState<MenuItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Record<string, Bill>>({});
  const [billBusyId, setBillBusyId] = useState('');
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponValidation, setCouponValidation] = useState<CouponValidation | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, OrderTracking>>({});
  const [trackingErrors, setTrackingErrors] = useState<Record<string, string>>({});
  const [trackingBusyId, setTrackingBusyId] = useState('');
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [search, setSearch] = useState('');
  const [areaMessage, setAreaMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [addressFormVisible, setAddressFormVisible] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [addressForm, setAddressForm] = useState({
    label: 'Home',
    line1: '',
    line2: '',
    locality: '',
    city: '',
    state: '',
    postalCode: '',
    phone: session.user.phone || '',
  });

  const stores = mode === 'shop' ? shops : restaurants;
  const visibleStores = stores.filter(
    (store) => store.isApproved !== false && store.isServiceable !== false,
  );
  const menuItems = mode === 'shop' ? shopItems : restaurantItems;
  const selectedStore = stores.find((store) => storeId(store) === selectedStoreId);
  const currentAddress = addresses.find((address) => address._id === selectedAddressId)
    || addresses.find((address) => address.isDefault)
    || addresses[0];
  const subtotal = useMemo(
    () => cart.reduce((total, item) => total + Number(item.price) * item.quantity, 0),
    [cart],
  );
  const couponDiscount = couponValidation?.valid ? Number(couponValidation.totalDiscount || 0) : 0;
  const estimatedTotal = subtotal ? Math.max(0, subtotal + subtotal * 0.05 + 40 - couponDiscount) : 0;

  async function loadBrowse(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const [restaurantResult, shopResult, restaurantMenu, shopMenu] = await Promise.all([
        apiRequest<{ restaurants: Store[]; isServiceable?: boolean; message?: string }>('/api/customer/restaurants', session.token),
        apiRequest<{ shops: Store[]; isServiceable?: boolean; message?: string }>('/api/customer/shops', session.token),
        apiRequest<{ menu: MenuItem[] }>('/api/customer/menu?type=restaurant', session.token),
        apiRequest<{ menu: MenuItem[] }>('/api/customer/menu?type=shop', session.token),
      ]);
      setRestaurants(restaurantResult.restaurants);
      setShops(shopResult.shops);
      setAreaMessage(
        restaurantResult.isServiceable || shopResult.isServiceable
          ? ''
          : restaurantResult.message || shopResult.message || '',
      );
      setRestaurantItems(restaurantMenu.menu);
      setShopItems(shopMenu.menu);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadAddresses() {
    setError('');
    try {
      const result = await apiRequest<{ addresses: Address[] }>(
        '/api/customer/addresses',
        session.token,
      );
      setAddresses(result.addresses);
      const preferred = result.addresses.find((address) => address.isDefault)
        || result.addresses[0];
      if (preferred) setSelectedAddressId(preferred._id);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  async function loadOrders() {
    setError('');
    try {
      const result = await apiRequest<{ orders: Order[] }>(
        '/api/customer/orders',
        session.token,
      );
      setOrders(result.orders);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  async function loadBill(orderId: string) {
    setBillBusyId(orderId);
    setError('');
    try {
      const result = await apiRequest<{ bill: Bill }>(
        `/api/customer/orders/${encodeURIComponent(orderId)}/bill`,
        session.token,
      );
      setBills((current) => ({ ...current, [orderId]: result.bill }));
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBillBusyId('');
    }
  }

  async function loadAvailableCoupons() {
    setError('');
    try {
      const result = await apiRequest<{ coupons?: Coupon[] }>('/api/customer/coupons', session.token);
      setAvailableCoupons(result.coupons || []);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  async function validateCoupon(code = couponCode) {
    if (!cart.length) {
      setError('Add items to your cart before applying a coupon.');
      return;
    }
    if (!code.trim()) {
      setError('Enter a coupon code.');
      return;
    }
    setValidatingCoupon(true);
    setError('');
    try {
      const storeType = cart[0].storeType || (cart[0].isShopItem ? 'shop' : 'restaurant');
      const store = [...restaurants, ...shops].find((candidate) => storeId(candidate) === cart[0].restaurantId);
      const result = await apiRequest<CouponValidation>('/api/customer/coupons/validate', session.token, {
        method: 'POST',
        body: JSON.stringify({
          couponCodes: [code.trim()],
          items: cart.map((item) => ({
            foodItemId: item._id,
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
          })),
          isShopOrder: storeType === 'shop',
          storeId: cart[0].restaurantId,
          ...(storeType === 'shop'
            ? { shopId: cart[0].restaurantId }
            : { restaurantId: cart[0].restaurantId }),
        }),
      });
      setCouponValidation(result);
      if (result.valid) setCouponCode(code.trim().toUpperCase());
      else setError(result.message || result.rejectedCoupons?.map((item) => item.reason).join(' · ') || 'This coupon cannot be applied.');
      if (store && !store.isOpen) setError('This store is currently closed. Coupon validation succeeded, but orders may not be accepted.');
    } catch (reason) {
      setCouponValidation(null);
      setError(getErrorMessage(reason));
    } finally {
      setValidatingCoupon(false);
    }
  }

  async function loadTracking(orderId: string) {
    setTrackingBusyId(orderId);
    setTrackingOrderId(orderId);
    setTrackingErrors((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    setError('');
    try {
      const result = await apiRequest<{ tracking: OrderTracking }>(
        `/api/customer/orders/${encodeURIComponent(orderId)}/live-tracking`,
        session.token,
      );
      if (!result.tracking) {
        throw new Error('Tomato did not return tracking details for this order.');
      }
      setTrackingByOrder((current) => ({ ...current, [orderId]: result.tracking }));
    } catch (reason) {
      const message = getErrorMessage(reason);
      setTrackingErrors((current) => ({ ...current, [orderId]: message }));
      setError(message);
    } finally {
      setTrackingBusyId('');
    }
  }

  async function submitReview() {
    if (!reviewTarget) return;
    setSavingReview(true);
    setError('');
    try {
      await apiRequest(
        `/api/customer/items/${encodeURIComponent(reviewTarget.itemId)}/reviews`,
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            rating: reviewRating,
            comment: reviewComment.trim(),
            name: session.user.name || '',
          }),
        },
      );
      Alert.alert('Review submitted', `Thanks for reviewing ${reviewTarget.itemName}.`);
      setReviewTarget(null);
      setReviewComment('');
      setReviewRating(5);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setSavingReview(false);
    }
  }

  async function showNotifications() {
    setError('');
    try {
      const result = await apiRequest<{ notifications: CustomerNotification[] }>(
        '/api/customer/notifications',
        session.token,
      );
      const latest = result.notifications
        .slice(0, 5)
        .map((notification) => `• ${notification.title || 'Tomato update'}: ${notification.message || ''}`)
        .join('\n\n');
      Alert.alert('Tomato updates', latest || 'You are all caught up.');
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  useEffect(() => {
    void loadBrowse();
    void loadAddresses();
    void loadOrders();
  }, [session.token]);

  useEffect(() => {
    if (tab === 'orders') void loadOrders();
    if (tab === 'addresses') void loadAddresses();
    if (tab === 'cart') void loadAvailableCoupons();
  }, [tab, session.token]);

  useEffect(() => {
    if (tab !== 'orders') return;
    const interval = setInterval(() => void loadOrders(), 20_000);
    return () => clearInterval(interval);
  }, [tab, session.token]);

  useEffect(() => {
    if (tab !== 'orders' || !trackingOrderId || trackingByOrder[trackingOrderId]?.trackingClosed) return;
    const interval = setInterval(async () => {
      try {
        const result = await apiRequest<{ tracking: OrderTracking }>(
          `/api/customer/orders/${encodeURIComponent(trackingOrderId)}/live-tracking`,
          session.token,
        );
        if (!result.tracking) {
          throw new Error('Tomato did not return tracking details for this order.');
        }
        setTrackingByOrder((current) => ({ ...current, [trackingOrderId]: result.tracking }));
        setTrackingErrors((current) => {
          const next = { ...current };
          delete next[trackingOrderId];
          return next;
        });
      } catch (reason) {
        const message = getErrorMessage(reason);
        setTrackingErrors((current) => ({ ...current, [trackingOrderId]: message }));
        setError(message);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [tab, trackingOrderId, trackingByOrder[trackingOrderId]?.trackingClosed, session.token]);

  const visibleItems = menuItems.filter((item) => {
    const matchesStore = !selectedStoreId || item.restaurantId === selectedStoreId;
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query
      || item.name.toLocaleLowerCase().includes(query)
      || (item.category || '').toLocaleLowerCase().includes(query)
      || (item.description || '').toLocaleLowerCase().includes(query);
    return matchesStore
      && matchesSearch
      && item.isActive !== false
      && item.isAvailable !== false
      && (item.quantity === undefined || item.quantity > 0)
      && (() => {
        const owner = [...restaurants, ...shops].find((store) => storeId(store) === item.restaurantId);
        return !owner || (owner.isApproved !== false && owner.isServiceable !== false);
      })();
  });

  function selectMode(nextMode: BrowseMode) {
    setMode(nextMode);
    setSelectedStoreId('');
    setSearch('');
  }

  function addItem(item: MenuItem) {
    const itemStoreType = item.storeType || (item.isShopItem ? 'shop' : mode);
    const otherStoreInCart = cart.find((line) =>
      line.restaurantId !== item.restaurantId
      || (line.storeType || (line.isShopItem ? 'shop' : mode)) !== itemStoreType,
    );

    if (otherStoreInCart) {
      Alert.alert(
        'Start a new cart?',
        'Your cart can contain items from one restaurant or shop at a time.',
        [
          { text: 'Keep cart', style: 'cancel' },
          {
            text: 'Replace cart',
            style: 'destructive',
            onPress: () => {
              setCouponValidation(null);
              setCouponCode('');
              setCart([{
                ...item,
                storeType: itemStoreType,
                availableQuantity: item.quantity,
                quantity: 1,
              }]);
            },
          },
        ],
      );
      return;
    }

    const existing = cart.find((line) => line._id === item._id);
    if (existing && item.quantity !== undefined && existing.quantity >= item.quantity) {
      Alert.alert('Stock limit reached', `Only ${item.quantity} of this item are currently available.`);
      return;
    }
    setCouponValidation(null);
    setCart((current) => {
      if (!existing) {
        return [...current, {
          ...item,
          storeType: itemStoreType,
          availableQuantity: item.quantity,
          quantity: 1,
        }];
      }
      return current.map((line) => line._id === item._id
        ? { ...line, quantity: line.quantity + 1 }
        : line);
    });
  }

  function changeQuantity(itemId: string, delta: number) {
    const line = cart.find((item) => item._id === itemId);
    if (
      delta > 0
      && line?.availableQuantity !== undefined
      && line.quantity >= line.availableQuantity
    ) {
      Alert.alert('Stock limit reached', `Only ${line.availableQuantity} of this item are currently available.`);
      return;
    }
    setCouponValidation(null);
    setCart((current) => current
      .map((item) => item._id === itemId
        ? { ...item, quantity: item.quantity + delta }
        : item)
      .filter((line) => line.quantity > 0));
  }

  async function saveAddress() {
    if (!addressForm.line1.trim() || !addressForm.city.trim() || !addressForm.postalCode.trim()) {
      setError('Enter a street address, city, and postal code.');
      return;
    }
    setSavingAddress(true);
    setError('');
    try {
      const existingAddress = editingAddressId
        ? addresses.find((address) => address._id === editingAddressId)
        : undefined;
      await apiRequest(
        editingAddressId
          ? `/api/customer/addresses/${editingAddressId}`
          : '/api/customer/addresses',
        session.token,
        {
          method: editingAddressId ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...addressForm,
            label: addressForm.label.trim() || 'Home',
            isDefault: existingAddress?.isDefault ?? addresses.length === 0,
          }),
        },
      );
      setAddressForm({
        label: 'Home',
        line1: '',
        line2: '',
        locality: '',
        city: '',
        state: '',
        postalCode: '',
        phone: session.user.phone || '',
      });
      setAddressFormVisible(false);
      setEditingAddressId('');
      await loadAddresses();
      await loadBrowse(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setSavingAddress(false);
    }
  }

  async function setDefaultAddress(addressId: string) {
    setError('');
    try {
      await apiRequest(`/api/customer/addresses/${addressId}/default`, session.token, {
        method: 'POST',
      });
      setSelectedAddressId(addressId);
      await loadAddresses();
      await loadBrowse(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  function editAddress(address: Address) {
    setEditingAddressId(address._id);
    setAddressForm({
      label: address.label || 'Home',
      line1: address.line1,
      line2: address.line2 || '',
      locality: address.locality || '',
      city: address.city,
      state: address.state || '',
      postalCode: address.postalCode,
      phone: address.phone || session.user.phone || '',
    });
    setAddressFormVisible(true);
    setTab('addresses');
  }

  function deleteAddress(address: Address) {
    Alert.alert('Remove address?', `Remove ${address.label || 'this address'} from your saved places?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setError('');
          try {
            await apiRequest(`/api/customer/addresses/${address._id}`, session.token, {
              method: 'DELETE',
            });
            await loadAddresses();
            await loadBrowse(false);
          } catch (reason) {
            setError(getErrorMessage(reason));
          }
        },
      },
    ]);
  }

  async function placeOrder() {
    if (!cart.length) return;
    if (!currentAddress) {
      setError('Add a delivery address before placing your order.');
      setTab('addresses');
      setAddressFormVisible(true);
      return;
    }

    setPlacingOrder(true);
    setError('');
    const validatedCouponCode = couponValidation?.valid ? couponCode.trim() : '';
    const storeType = cart[0].storeType || (cart[0].isShopItem ? 'shop' : 'restaurant');
    const selectedStore = [...restaurants, ...shops].find(
      (store) => storeId(store) === cart[0].restaurantId,
    );
    try {
      const result = await apiRequest<{ order: Order }>(
        '/api/customer/orders',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            restaurantId: cart[0].restaurantId,
            ...(storeType === 'shop' ? { shopId: cart[0].restaurantId } : {}),
            isShopOrder: storeType === 'shop',
            storeType,
            items: cart.map((item) => ({
              foodItemId: item._id,
              name: item.name,
              quantity: item.quantity,
              price: Number(item.price),
              category: item.category || '',
            })),
            paymentMethod: 'cod',
            ...(validatedCouponCode ? { couponCodes: [validatedCouponCode] } : {}),
            addressId: currentAddress._id,
            deliveryAddress: {
              label: currentAddress.label || 'Home',
              phone: currentAddress.phone || session.user.phone || '',
              line1: currentAddress.line1,
              line2: currentAddress.line2 || '',
              locality: currentAddress.locality || '',
              city: currentAddress.city,
              state: currentAddress.state || '',
              postalCode: currentAddress.postalCode,
              digipin: currentAddress.digipin || '',
              coordinates: currentAddress.location?.coordinates || [],
            },
          }),
        },
      );
      setCart([]);
      setCouponCode('');
      setCouponValidation(null);
      setBills((current) => {
        const next = { ...current };
        delete next[result.order._id];
        return next;
      });
      setTab('orders');
      await loadOrders();
      Alert.alert(
        'Order placed',
        `${result.order.orderNumber || 'Your order'} has been placed with ${selectedStore?.name || 'Tomato'}${validatedCouponCode ? ` using coupon ${validatedCouponCode}` : ''}. Payment method: cash on delivery.`,
      );
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setPlacingOrder(false);
    }
  }

  async function refreshActiveTab() {
    setRefreshing(true);
    if (tab === 'browse') await loadBrowse(false);
    else if (tab === 'addresses') await loadAddresses();
    else if (tab === 'orders') await loadOrders();
    else setRefreshing(false);
  }

  function signOut() {
    Alert.alert('Sign out of Tomato?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void performSignOut() },
    ]);
  }

  async function performSignOut() {
    let revokeError = '';
    try {
      await apiRequest('/api/auth/logout', session.token, { method: 'POST' });
    } catch (reason) {
      revokeError = getErrorMessage(reason);
    }
    await onSignOut();
    if (revokeError) {
      Alert.alert(
        'Signed out on this device',
        `Tomato could not revoke the server session. Sign out again while connected to revoke it. ${revokeError}`,
      );
    }
  }

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>🍅 Tomato</Text>
          <Text style={styles.delivering}>
            Delivering to {currentAddress?.label || 'your area'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Tomato notifications"
            onPress={() => void showNotifications()}
            style={styles.headerIconButton}
          >
            <Text style={styles.notificationIcon}>♢</Text>
          </Pressable>
          <ProfileAccess
            session={session}
            roleLabel="Customer"
            items={[
              { key: 'browse', label: 'Order Online', description: 'Browse restaurants, shops and menus', icon: '⌕' },
              { key: 'orders', label: 'My orders', description: 'Track orders and view bills', icon: '▤' },
              { key: 'addresses', label: 'Saved addresses', description: 'Manage delivery locations', icon: '⌖' },
            ] satisfies ProfileMenuItem[]}
            onNavigate={(key) => setTab(key as Tab)}
            onSignOut={signOut}
            onSessionUserUpdate={onSessionUserUpdate}
          />
        </View>
      </View>

      {!!error && (
        <Pressable onPress={() => setError('')} style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorDismiss}>×</Text>
        </Pressable>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refreshActiveTab()} tintColor="#d83a32" />
        }
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'browse' && (
          <View>
            <Text style={styles.eyebrow}>WHAT ARE YOU CRAVING?</Text>
            <Text style={styles.pageTitle}>Find your next favorite</Text>
            <Text style={styles.pageSubtitle}>Local kitchens and shops, delivered fresh.</Text>
            <View style={styles.dashboardTiles}>
              <Pressable onPress={() => setTab('orders')} style={styles.dashboardTileAction}>
              <DashboardTile
                label="Active orders"
                value={orders.filter((order) => !['delivered', 'cancelled'].includes(order.status || '')).length}
              />
              </Pressable>
              <DashboardTile
                label="Cart items"
                value={cart.reduce((count, line) => count + line.quantity, 0)}
              />
              <DashboardTile label="Addresses" value={addresses.length} />
            </View>
            {!!orders.filter((order) => !['delivered', 'cancelled'].includes(order.status || '')).length && (
              <View style={styles.dashboardOrders}>
                <View style={styles.sectionHeadingRow}>
                  <Text style={styles.sectionTitle}>Track an active order</Text>
                  <Pressable onPress={() => setTab('orders')}>
                    <Text style={styles.link}>All orders</Text>
                  </Pressable>
                </View>
                {orders
                  .filter((order) => !['delivered', 'cancelled'].includes(order.status || ''))
                  .slice(0, 2)
                  .map((order) => (
                    <View key={order._id} style={styles.dashboardOrderRow}>
                      <View style={styles.flex}>
                        <Text style={styles.itemName}>{order.shopName || order.restaurantName || 'Tomato order'}</Text>
                        <Text style={styles.itemDescription}>
                          {order.orderNumber || 'Order'} · {(order.status || 'placed').replaceAll('_', ' ')}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        disabled={trackingBusyId === order._id}
                        onPress={() => {
                          setTab('orders');
                          void loadTracking(order._id);
                        }}
                        style={styles.dashboardTrackButton}
                      >
                        <Text style={styles.dashboardTrackText}>
                          {trackingBusyId === order._id ? 'Loading…' : 'Live tracking'}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
              </View>
            )}
            {!!areaMessage && <Text style={styles.areaNotice}>{areaMessage}</Text>}
            <View style={styles.modeSwitch}>
              <ModeButton active={mode === 'restaurant'} label="Restaurants" onPress={() => selectMode('restaurant')} />
              <ModeButton active={mode === 'shop'} label="Shops" onPress={() => selectMode('shop')} />
            </View>
            <TextInput
              accessibilityLabel="Search dishes"
              onChangeText={setSearch}
              placeholder={mode === 'shop' ? 'Search products or categories' : 'Search dishes or categories'}
              placeholderTextColor="#998f88"
              style={styles.search}
              value={search}
            />
            <Text style={styles.sectionTitle}>{mode === 'shop' ? 'Nearby shops' : 'Nearby restaurants'}</Text>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#d83a32" />
                <Text style={styles.muted}>Finding places near you…</Text>
              </View>
            ) : visibleStores.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeRow}>
                {visibleStores.map((store) => {
                  const id = storeId(store);
                  const selected = selectedStoreId === id;
                  return (
                    <Pressable
                      key={id || store.name}
                      onPress={() => setSelectedStoreId(selected ? '' : id)}
                      style={[styles.storeCard, selected && styles.storeCardSelected]}
                    >
                      {store.image ? (
                        <Image source={{ uri: apiPath(store.image) }} style={styles.storeImage} />
                      ) : (
                        <View style={styles.storeImagePlaceholder}>
                          <Text style={styles.storeEmoji}>{mode === 'shop' ? '🛒' : '🍽️'}</Text>
                        </View>
                      )}
                      <Text numberOfLines={1} style={styles.storeName}>{store.name}</Text>
                      <Text numberOfLines={1} style={styles.storeMeta}>
                        {store.distanceText || store.cuisine || store.category || (store.isOpen === false ? 'Closed' : 'Open')}
                        {store.rating ? ` · ★ ${store.rating}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <EmptyState
                title={`No ${mode === 'shop' ? 'shops' : 'restaurants'} available`}
                detail="Pull down to refresh, or check that your delivery area is serviceable."
              />
            )}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>{selectedStoreId ? 'Menu' : 'Popular near you'}</Text>
              {!!selectedStoreId && (
                <Pressable onPress={() => setSelectedStoreId('')}>
                  <Text style={styles.link}>Show all</Text>
                </Pressable>
              )}
            </View>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#d83a32" />
              </View>
            ) : visibleItems.length ? (
              visibleItems.map((item) => {
                const itemStore = [...restaurants, ...shops].find(
                  (store) => storeId(store) === item.restaurantId,
                );
                const closed = itemStore?.isOpen === false || itemStore?.isOnline === false;
                return (
                  <MenuCard
                    key={item._id}
                    item={item}
                    closed={closed}
                    onAdd={() => addItem(item)}
                  />
                );
              })
            ) : (
              <EmptyState
                title={search ? 'No matches found' : 'No menu items available'}
                detail={search ? 'Try another dish or category.' : 'Choose another place or refresh the list.'}
              />
            )}
          </View>
        )}

        {tab === 'cart' && (
          <View>
            <Text style={styles.eyebrow}>YOUR SELECTION</Text>
            <Text style={styles.pageTitle}>Your cart</Text>
            {!cart.length ? (
              <EmptyState
                title="Your cart is hungry"
                detail="Browse restaurants or shops and add something delicious."
                actionLabel="Browse places"
                onAction={() => setTab('browse')}
              />
            ) : (
              <>
                {cart.map((item) => (
                  <View key={item._id} style={styles.cartItem}>
                    <View style={styles.flex}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemDescription}>{formatRupees(Number(item.price) * item.quantity)}</Text>
                    </View>
                    <QuantityControl
                      quantity={item.quantity}
                      onDecrease={() => changeQuantity(item._id, -1)}
                      onIncrease={() => changeQuantity(item._id, 1)}
                    />
                  </View>
                ))}
                <Text style={styles.sectionTitle}>Deliver to</Text>
                {addresses.length ? (
                  addresses.map((address) => (
                    <Pressable
                      key={address._id}
                      onPress={() => setSelectedAddressId(address._id)}
                      style={[
                        styles.addressOption,
                        (selectedAddressId === address._id || currentAddress?._id === address._id)
                          && styles.addressOptionSelected,
                      ]}
                    >
                      <Text style={styles.radio}>{selectedAddressId === address._id || currentAddress?._id === address._id ? '●' : '○'}</Text>
                      <View style={styles.flex}>
                        <Text style={styles.itemName}>{address.label || 'Delivery address'}</Text>
                        <Text style={styles.itemDescription}>{addressSummary(address)}</Text>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <EmptyState
                    title="Add a delivery address"
                    detail="Orders need a saved delivery address."
                    actionLabel="Add address"
                    onAction={() => {
                      setTab('addresses');
                      setAddressFormVisible(true);
                    }}
                  />
                )}
                <View style={styles.couponCard}>
                  <Text style={styles.sectionTitle}>Apply a coupon</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      autoCapitalize="characters"
                      onChangeText={(value) => {
                        setCouponCode(value);
                        setCouponValidation(null);
                      }}
                      placeholder="Enter coupon code"
                      placeholderTextColor="#998f88"
                      style={[styles.input, styles.halfInput]}
                      value={couponCode}
                    />
                    <PrimaryButton
                      disabled={validatingCoupon || !cart.length}
                      label={validatingCoupon ? 'Checking…' : 'Apply'}
                      onPress={() => void validateCoupon()}
                    />
                  </View>
                  {!!couponValidation?.valid && (
                    <Text style={styles.couponSuccess}>
                      {couponValidation.appliedCoupons?.[0]?.title || couponCode} applied · Save {formatRupees(couponDiscount)}
                    </Text>
                  )}
                  {!!couponValidation && !couponValidation.valid && (
                    <Text style={styles.couponError}>
                      {couponValidation.message || couponValidation.rejectedCoupons?.map((entry) => entry.reason).join(' · ') || 'Coupon could not be applied.'}
                    </Text>
                  )}
                  {!!availableCoupons.length && (
                    <>
                      <Text style={styles.couponListTitle}>Available coupons</Text>
                      {availableCoupons.slice(0, 5).map((coupon) => (
                        <Pressable key={coupon.code} style={styles.couponRow} onPress={() => {
                          setCouponCode(coupon.code);
                          void validateCoupon(coupon.code);
                        }}>
                          <View style={styles.flex}>
                            <Text style={styles.couponCode}>{coupon.code}</Text>
                            <Text style={styles.itemDescription}>{coupon.title || coupon.description || 'Tap to apply'}</Text>
                          </View>
                          <Text style={styles.link}>Use</Text>
                        </Pressable>
                      ))}
                    </>
                  )}
                </View>
                <View style={styles.billCard}>
                  <BillRow label="Subtotal" value={formatRupees(subtotal)} />
                  <BillRow label="Estimated tax" value={formatRupees(subtotal * 0.05)} />
                  <BillRow label="Delivery fee" value={formatRupees(40)} />
                  {!!couponDiscount && <BillRow label="Coupon discount" value={`−${formatRupees(couponDiscount)}`} />}
                  <View style={styles.billDivider} />
                  <BillRow bold label="Estimated total" value={formatRupees(estimatedTotal)} />
                  <Text style={styles.paymentNote}>Cash on delivery · Final amount is calculated by Tomato.</Text>
                </View>
                <PrimaryButton
                  disabled={placingOrder || !addresses.length}
                  label={placingOrder ? 'Placing order…' : `Place cash order · ${formatRupees(estimatedTotal)}`}
                  onPress={() => void placeOrder()}
                />
                {placingOrder && <ActivityIndicator color="#d83a32" style={styles.buttonSpinner} />}
              </>
            )}
          </View>
        )}

        {tab === 'orders' && (
          <View>
            <View style={styles.sectionHeadingRow}>
              <View>
                <Text style={styles.eyebrow}>MADE WITH TOMATO</Text>
                <Text style={styles.pageTitle}>Your orders</Text>
              </View>
              <Pressable onPress={() => void loadOrders()} style={styles.refreshButton}>
                <Text style={styles.refreshText}>Refresh</Text>
              </Pressable>
            </View>
            {orders.length ? orders.map((order) => (
              <OrderCard
                key={order._id}
                order={order}
                tracking={trackingByOrder[order._id]}
                trackingError={trackingErrors[order._id]}
                trackingLoading={trackingBusyId === order._id}
                bill={bills[order._id]}
                billLoading={billBusyId === order._id}
                onTrack={() => void loadTracking(order._id)}
                onViewBill={() => void loadBill(order._id)}
                onReview={(item) => {
                  setReviewTarget({ orderId: order._id, itemId: item.id, itemName: item.name });
                  setReviewRating(5);
                }}
              />
            )) : (
              <EmptyState
                title="No orders yet"
                detail="Your order history and delivery updates will appear here."
                actionLabel="Explore Tomato"
                onAction={() => setTab('browse')}
              />
            )}
            {!!reviewTarget && (
              <View style={styles.formCard}>
                <Text style={styles.sectionTitle}>Review {reviewTarget.itemName}</Text>
                <View style={styles.ratingRow}>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <Pressable key={rating} onPress={() => setReviewRating(rating)} style={styles.ratingButton}>
                      <Text style={[styles.ratingStar, rating <= reviewRating && styles.ratingStarActive]}>★</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  onChangeText={setReviewComment}
                  placeholder="Tell others about this item (optional)"
                  placeholderTextColor="#998f88"
                  style={[styles.input, styles.reviewInput]}
                  value={reviewComment}
                  multiline
                />
                <PrimaryButton disabled={savingReview} label={savingReview ? 'Submitting…' : 'Submit review'} onPress={() => void submitReview()} />
                <Pressable onPress={() => setReviewTarget(null)} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {tab === 'addresses' && (
          <View>
            <Text style={styles.eyebrow}>DELIVERY DETAILS</Text>
            <Text style={styles.pageTitle}>Saved addresses</Text>
            <Text style={styles.pageSubtitle}>Choose where your order should arrive.</Text>
            {addresses.map((address) => (
              <View key={address._id} style={styles.addressCard}>
                <View style={styles.addressTitleRow}>
                  <Text style={styles.itemName}>{address.label || 'Delivery address'}</Text>
                  {address.isDefault && <Text style={styles.defaultBadge}>DEFAULT</Text>}
                </View>
                <Text style={styles.addressText}>{addressSummary(address)}</Text>
                {!!address.phone && <Text style={styles.itemDescription}>{address.phone}</Text>}
                <View style={styles.addressActions}>
                  {!address.isDefault && (
                    <Pressable onPress={() => void setDefaultAddress(address._id)}>
                      <Text style={styles.link}>Set as default</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => deleteAddress(address)}>
                    <Text style={styles.removeLink}>Remove</Text>
                  </Pressable>
                  <Pressable onPress={() => editAddress(address)}>
                    <Text style={styles.link}>Edit</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {!addresses.length && !addressFormVisible && (
              <EmptyState title="No saved addresses" detail="Add an address so Tomato knows where to deliver." />
            )}
            {addressFormVisible ? (
              <View style={styles.formCard}>
                <Text style={styles.sectionTitle}>{editingAddressId ? 'Edit delivery address' : 'New delivery address'}</Text>
                <TextInput
                  onChangeText={(value) => setAddressForm((form) => ({ ...form, label: value }))}
                  placeholder="Label (Home, Work…)"
                  style={styles.input}
                  value={addressForm.label}
                />
                <TextInput
                  onChangeText={(value) => setAddressForm((form) => ({ ...form, line1: value }))}
                  placeholder="House / street address *"
                  style={styles.input}
                  value={addressForm.line1}
                />
                <TextInput
                  onChangeText={(value) => setAddressForm((form) => ({ ...form, line2: value }))}
                  placeholder="Apartment, suite (optional)"
                  style={styles.input}
                  value={addressForm.line2}
                />
                <TextInput
                  onChangeText={(value) => setAddressForm((form) => ({ ...form, locality: value }))}
                  placeholder="Area / locality"
                  style={styles.input}
                  value={addressForm.locality}
                />
                <View style={styles.inputRow}>
                  <TextInput
                    onChangeText={(value) => setAddressForm((form) => ({ ...form, city: value }))}
                    placeholder="City *"
                    style={[styles.input, styles.halfInput]}
                    value={addressForm.city}
                  />
                  <TextInput
                    onChangeText={(value) => setAddressForm((form) => ({ ...form, state: value }))}
                    placeholder="State"
                    style={[styles.input, styles.halfInput]}
                    value={addressForm.state}
                  />
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={(value) => setAddressForm((form) => ({ ...form, postalCode: value }))}
                    placeholder="Postal code *"
                    style={[styles.input, styles.halfInput]}
                    value={addressForm.postalCode}
                  />
                  <TextInput
                    keyboardType="phone-pad"
                    onChangeText={(value) => setAddressForm((form) => ({ ...form, phone: value }))}
                    placeholder="Phone"
                    style={[styles.input, styles.halfInput]}
                    value={addressForm.phone}
                  />
                </View>
                <PrimaryButton
                  disabled={savingAddress}
                  label={savingAddress ? 'Saving…' : editingAddressId ? 'Save changes' : 'Save address'}
                  onPress={() => void saveAddress()}
                />
                <Pressable onPress={() => {
                  setAddressFormVisible(false);
                  setEditingAddressId('');
                }} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <PrimaryButton
                label="+ Add a new address"
                onPress={() => {
                  setEditingAddressId('');
                  setAddressForm({
                    label: 'Home',
                    line1: '',
                    line2: '',
                    locality: '',
                    city: '',
                    state: '',
                    postalCode: '',
                    phone: session.user.phone || '',
                  });
                  setAddressFormVisible(true);
                }}
              />
            )}
          </View>
        )}

        {tab === 'account' && (
          <View>
            <Text style={styles.eyebrow}>YOUR TOMATO ACCOUNT</Text>
            <Text style={styles.pageTitle}>Hello{session.user.name ? `, ${session.user.name.split(' ')[0]}` : ''}</Text>
            <View style={styles.profileCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(session.user.name || 'T').charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.profileName}>{session.user.name || 'Tomato customer'}</Text>
              {!!session.user.email && <Text style={styles.profileDetail}>{session.user.email}</Text>}
              {!!session.user.phone && <Text style={styles.profileDetail}>{session.user.phone}</Text>}
              <Text style={styles.customerBadge}>CUSTOMER ACCOUNT</Text>
            </View>
            <Pressable onPress={() => setTab('orders')} style={styles.menuLink}>
              <Text style={styles.menuLinkText}>📦   Order history</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable onPress={() => setTab('addresses')} style={styles.menuLink}>
              <Text style={styles.menuLinkText}>📍   Saved addresses</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable onPress={signOut} style={[styles.menuLink, styles.signOutLink]}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.tabBar}>
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.id)}
              style={styles.tabButton}
            >
              <View>
                <Text style={[styles.tabIcon, active && styles.activeTabText]}>{item.icon}</Text>
                {item.id === 'cart' && cart.length > 0 && (
                  <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cart.reduce((count, line) => count + line.quantity, 0)}</Text></View>
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.activeTabText]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ModeButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MenuCard({ item, onAdd, closed = false }: { item: MenuItem; onAdd: () => void; closed?: boolean }) {
  const unavailable = closed || (item.quantity !== undefined && item.quantity <= 0);
  return (
    <View style={styles.menuCard}>
      {item.image ? (
        <Image source={{ uri: apiPath(item.image) }} style={styles.menuImage} />
      ) : (
        <View style={styles.menuImagePlaceholder}><Text style={styles.menuEmoji}>{item.isShopItem ? '🥗' : '🍲'}</Text></View>
      )}
      <View style={styles.menuDetails}>
        {!!item.category && <Text style={styles.menuCategory}>{item.category}</Text>}
        <Text numberOfLines={1} style={styles.itemName}>{item.name}</Text>
        {!!item.description && <Text numberOfLines={2} style={styles.itemDescription}>{item.description}</Text>}
        {!!item.rating && <Text style={styles.itemDescription}>★ {item.rating} · {item.reviewCount || 0} reviews</Text>}
        <Text style={styles.price}>{formatRupees(item.price)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={unavailable}
        onPress={onAdd}
        style={[styles.addButton, unavailable && styles.addButtonDisabled]}
      >
        <Text style={[styles.addButtonText, unavailable && styles.closedText]}>
          {closed ? 'CLOSED' : item.quantity !== undefined && item.quantity <= 0 ? 'SOLD OUT' : 'ADD'}
        </Text>
      </Pressable>
    </View>
  );
}

function QuantityControl({
  quantity,
  onDecrease,
  onIncrease,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.quantityControl}>
      <Pressable accessibilityLabel="Decrease quantity" onPress={onDecrease} style={styles.quantityButton}>
        <Text style={styles.quantityButtonText}>−</Text>
      </Pressable>
      <Text style={styles.quantity}>{quantity}</Text>
      <Pressable accessibilityLabel="Increase quantity" onPress={onIncrease} style={styles.quantityButton}>
        <Text style={styles.quantityButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

function BillRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billBold]}>{value}</Text>
    </View>
  );
}

function openRiderLocation(lat: number, lng: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  void Linking.openURL(url).catch(() => Alert.alert('Unable to open maps', 'Install a map application and try again.'));
}

function OrderCard({
  order,
  tracking,
  trackingError,
  trackingLoading,
  bill,
  billLoading,
  onTrack,
  onViewBill,
  onReview,
}: {
  order: Order;
  tracking?: OrderTracking;
  trackingError?: string;
  trackingLoading: boolean;
  bill?: Bill;
  billLoading: boolean;
  onTrack: () => void;
  onViewBill: () => void;
  onReview: (item: { id: string; name: string }) => void;
}) {
  const partner = order.shopName || order.restaurantName || (order.isShopOrder ? 'Tomato shop' : 'Tomato restaurant');
  const status = (order.status || 'placed').replaceAll('_', ' ');
  const isComplete = ['delivered', 'cancelled'].includes(order.status || '');
  const riderLocation = tracking?.rider?.currentLocation || tracking?.telemetry?.riderLocation
    || tracking?.telemetry?.currentLocation;
  const riderLat = riderLocation?.lat;
  const riderLng = riderLocation?.lng;
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderTopRow}>
        <View style={styles.flex}>
          <Text style={styles.orderPlace}>{partner}</Text>
          <Text style={styles.itemDescription}>{order.orderNumber || 'Order'} · {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'Recent'}</Text>
        </View>
        <Text style={styles.orderTotal}>{formatRupees(Number(order.totalAmount || 0))}</Text>
      </View>
      <View style={styles.statusPill}><Text style={styles.statusText}>{status}</Text></View>
      {!!order.items?.length && (
        <Text style={styles.orderItems} numberOfLines={2}>
          {order.items.map((item) => `${item.quantity} × ${item.name}`).join('  ·  ')}
        </Text>
      )}
      {!!order.deliveryAddress?.line1 && (
        <Text style={styles.itemDescription} numberOfLines={1}>
          Delivering to {order.deliveryAddress.label || 'address'} · {order.deliveryAddress.line1}
        </Text>
      )}
      <Text style={styles.paymentNote}>
        {(order.paymentMethod || 'cash').toUpperCase()} · {(order.paymentStatus || 'pending').toUpperCase()}
      </Text>
      <PrimaryButton
        disabled={billLoading}
        label={billLoading ? 'Loading bill…' : bill ? 'Refresh bill' : 'View bill'}
        onPress={onViewBill}
      />
      {!!bill && (
        <View style={styles.billCard}>
          <Text style={styles.trackingTitle}>Invoice {bill.invoiceNumber || bill.orderNumber || order.orderNumber || ''}</Text>
          {!!bill.date && <Text style={styles.itemDescription}>{new Date(bill.date).toLocaleString()}</Text>}
          {(bill.items || []).map((item, index) => (
            <BillRow
              key={`${item.name || 'item'}-${index}`}
              label={`${item.quantity || 1} × ${item.name || 'Item'}`}
              value={formatRupees(Number(item.totalPrice ?? (Number(item.price || 0) * Number(item.quantity || 1))))}
            />
          ))}
          <BillRow label="Subtotal" value={formatRupees(Number(bill.subtotal || 0))} />
          {(bill.cgst !== undefined || bill.sgst !== undefined) ? (
            <>
              <BillRow label="CGST" value={formatRupees(Number(bill.cgst || 0))} />
              <BillRow label="SGST" value={formatRupees(Number(bill.sgst || 0))} />
            </>
          ) : (
            <BillRow label="Tax" value={formatRupees(Number(bill.tax || 0))} />
          )}
          <BillRow label="Delivery fee" value={formatRupees(Number(bill.deliveryFee || 0))} />
          {!!Number(bill.discountAmount || 0) && (
            <BillRow label={`Coupon${bill.couponCodes?.length ? ` (${bill.couponCodes.join(', ')})` : ''}`} value={`−${formatRupees(Number(bill.discountAmount || 0))}`} />
          )}
          <View style={styles.billDivider} />
          <BillRow bold label="Total" value={formatRupees(Number(bill.totalAmount || order.totalAmount || 0))} />
          <Text style={styles.paymentNote}>
            {(bill.paymentMethod || order.paymentMethod || 'cod').toUpperCase()} · {(bill.paymentStatus || order.paymentStatus || 'pending').toUpperCase()}
          </Text>
        </View>
      )}
      {!isComplete && (
        <>
          <PrimaryButton disabled={trackingLoading} label={trackingLoading ? 'Updating tracking…' : tracking ? 'Refresh live tracking' : 'Track order'} onPress={onTrack} />
          {trackingLoading && (
            <View style={styles.trackingCard}>
              <ActivityIndicator color="#d83a32" />
              <Text style={styles.itemDescription}>Loading the latest order and rider details…</Text>
            </View>
          )}
          {!!trackingError && (
            <View style={styles.trackingError}>
              <Text style={styles.trackingErrorText}>Tracking could not be refreshed: {trackingError}</Text>
              <Pressable onPress={onTrack}><Text style={styles.link}>Try again</Text></Pressable>
            </View>
          )}
          {!!tracking && (
            <View style={styles.trackingCard}>
              <Text style={styles.trackingTitle}>{tracking.trackingClosed ? 'Tracking complete' : 'Live delivery status'}</Text>
              <Text style={styles.itemDescription}>
                Status: {(tracking.status || order.status || 'placed').replaceAll('_', ' ')}
                {tracking.isPickedUp || tracking.pickupStatus === 'picked_up'
                  ? ' · Picked up'
                  : tracking.rider
                    ? ' · Rider heading to pickup'
                    : ' · Waiting for rider assignment'}
              </Text>
              {(tracking.estimatedMinutes ?? tracking.expectedDeliveryTimingMinutes) !== undefined && (
                <Text style={styles.itemDescription}>
                  Estimated delivery: {tracking.estimatedMinutes ?? tracking.expectedDeliveryTimingMinutes} min
                </Text>
              )}
              {!tracking.rider && !tracking.trackingClosed && (
                <Text style={styles.itemDescription}>
                  {['placed', 'pending'].includes(tracking.status || order.status || '')
                    ? 'The restaurant or shop needs to accept this order before a rider can accept the delivery.'
                    : 'Your order is accepted. A rider working in your area will appear here after accepting the delivery.'}
                </Text>
              )}
              {!!tracking.rider && typeof tracking.telemetry?.lastPingSecondsAgo === 'number' && (
                <Text style={styles.itemDescription}>
                  Rider location updated {tracking.telemetry.lastPingSecondsAgo < 60
                    ? `${tracking.telemetry.lastPingSecondsAgo} sec ago`
                    : `${Math.floor(tracking.telemetry.lastPingSecondsAgo / 60)} min ago`}
                  {tracking.telemetry.isLiveOnline === false ? ' · rider currently offline' : ''}
                </Text>
              )}
              {!!tracking.rider?.name && <Text style={styles.itemDescription}>Rider: {tracking.rider.name}</Text>}
              {!!tracking.rider?.phone && <Text style={styles.itemDescription}>Rider phone: {tracking.rider.phone}</Text>}
              {typeof riderLat === 'number' && typeof riderLng === 'number' && (
                <Pressable onPress={() => openRiderLocation(riderLat, riderLng)}>
                  <Text style={styles.link}>View rider location on map</Text>
                </Pressable>
              )}
              {!tracking.trackingClosed && <Text style={styles.itemDescription}>Location refreshes every 30 seconds while this screen is active.</Text>}
            </View>
          )}
          {['placed', 'accepted'].includes(order.status || '') && (
            <Text style={styles.itemDescription}>Self-service cancellation is not available in the current Tomato API. Contact support to request a cancellation.</Text>
          )}
        </>
      )}
      {order.status === 'delivered' && (
        <View style={styles.reviewItems}>
          <Text style={styles.reviewItemsTitle}>Rate your items</Text>
          {order.items?.map((item, index) => {
            const id = item.foodItemId || item.itemId || item._id || '';
            return (
              <View key={`${id || item.name}-${index}`} style={styles.reviewItemRow}>
                <Text numberOfLines={1} style={styles.reviewItemName}>{item.name}</Text>
                {id ? (
                  <Pressable onPress={() => onReview({ id, name: item.name })}>
                    <Text style={styles.link}>Review</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.itemDescription}>Unavailable</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function DashboardTile({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.dashboardTile}>
      <Text style={styles.dashboardTileValue}>{value}</Text>
      <Text style={styles.dashboardTileLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyEmoji}>🍅</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#fffaf5' },
  flex: { flex: 1 },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e9e2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { fontSize: 22, fontWeight: '800', color: '#d83a32', letterSpacing: -0.5 },
  delivering: { marginTop: 3, color: '#766b63', fontSize: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconButton: { height: 42, width: 42, borderRadius: 14, backgroundColor: '#f7f2ed', alignItems: 'center', justifyContent: 'center' },
  notificationIcon: { fontSize: 27, color: '#635950' },
  errorBanner: { marginHorizontal: 16, marginTop: 10, padding: 11, backgroundColor: '#fff1f0', borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  errorText: { color: '#b42318', fontSize: 13, lineHeight: 18, flex: 1 },
  errorDismiss: { color: '#b42318', fontSize: 22, paddingLeft: 8 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 26, flexGrow: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#d83a32', letterSpacing: 1.4, marginBottom: 7 },
  pageTitle: { color: '#28221e', fontWeight: '800', fontSize: 25, letterSpacing: -0.6 },
  pageSubtitle: { color: '#80766e', fontSize: 13, marginTop: 5, marginBottom: 18, lineHeight: 19 },
  dashboardTiles: { flexDirection: 'row', gap: 8, marginBottom: 17 },
  dashboardTile: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e8e1', borderRadius: 13, paddingHorizontal: 10, paddingVertical: 11 },
  dashboardTileAction: { flex: 1 },
  dashboardTileValue: { color: '#d83a32', fontSize: 19, fontWeight: '800' },
  dashboardTileLabel: { color: '#766b63', fontSize: 10, fontWeight: '700', marginTop: 3 },
  dashboardOrders: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e8e1', borderRadius: 15, padding: 13, marginBottom: 15 },
  dashboardOrderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f3ece6' },
  dashboardTrackButton: { borderRadius: 9, backgroundColor: '#fff0eb', paddingHorizontal: 10, paddingVertical: 9 },
  dashboardTrackText: { color: '#c8322a', fontSize: 11, fontWeight: '800' },
  areaNotice: { color: '#7b4c20', backgroundColor: '#fff7e8', borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  modeSwitch: { flexDirection: 'row', backgroundColor: '#f4ece5', borderRadius: 14, padding: 4, marginBottom: 12 },
  modeButton: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center' },
  modeButtonActive: { backgroundColor: '#d83a32', shadowColor: '#d83a32', shadowOpacity: 0.2, shadowRadius: 5, elevation: 2 },
  modeText: { fontSize: 13, color: '#665d56', fontWeight: '600' },
  modeTextActive: { color: '#fff', fontWeight: '700' },
  search: { height: 48, borderColor: '#eee3da', borderWidth: 1, backgroundColor: '#fff', borderRadius: 13, paddingHorizontal: 14, color: '#28221e', fontSize: 14, marginBottom: 20 },
  sectionTitle: { color: '#28221e', fontSize: 17, fontWeight: '800', marginBottom: 12 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  link: { color: '#d83a32', fontSize: 13, fontWeight: '700' },
  storeRow: { paddingBottom: 8, gap: 10 },
  storeCard: { backgroundColor: '#fff', borderColor: '#f0e6de', borderWidth: 1, borderRadius: 15, width: 142, padding: 9 },
  storeCardSelected: { borderColor: '#d83a32', borderWidth: 2, padding: 8 },
  storeImage: { width: '100%', height: 78, borderRadius: 10, backgroundColor: '#f6ebe3' },
  storeImagePlaceholder: { width: '100%', height: 78, borderRadius: 10, backgroundColor: '#fff0e8', alignItems: 'center', justifyContent: 'center' },
  storeEmoji: { fontSize: 30 },
  storeName: { marginTop: 8, color: '#2d2621', fontSize: 13, fontWeight: '700' },
  storeMeta: { color: '#877c73', fontSize: 11, marginTop: 3 },
  menuCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 17, padding: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
  menuImage: { width: 78, height: 78, borderRadius: 12, backgroundColor: '#f5ebe4' },
  menuImagePlaceholder: { width: 78, height: 78, borderRadius: 12, backgroundColor: '#fff1e9', alignItems: 'center', justifyContent: 'center' },
  menuEmoji: { fontSize: 31 },
  menuDetails: { flex: 1, paddingHorizontal: 11, alignSelf: 'stretch', justifyContent: 'center' },
  menuCategory: { color: '#d83a32', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  itemName: { color: '#302923', fontSize: 14, fontWeight: '700' },
  itemDescription: { color: '#887e76', fontSize: 11, lineHeight: 15, marginTop: 4 },
  price: { color: '#302923', fontSize: 14, fontWeight: '800', marginTop: 5 },
  addButton: { borderColor: '#d83a32', borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  addButtonDisabled: { borderColor: '#d6ccc4', backgroundColor: '#f7f3ef' },
  addButtonText: { color: '#d83a32', fontWeight: '800', fontSize: 11 },
  closedText: { color: '#8d8178' },
  loadingRow: { paddingVertical: 28, flexDirection: 'row', gap: 10, justifyContent: 'center', alignItems: 'center' },
  muted: { color: '#80766e', fontSize: 13 },
  emptyCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 19, padding: 24, alignItems: 'center', marginVertical: 10 },
  emptyEmoji: { fontSize: 34, marginBottom: 9 },
  emptyTitle: { color: '#302923', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyDetail: { color: '#82786f', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  emptyAction: { marginTop: 15, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: '#fff0eb' },
  emptyActionText: { color: '#c8322a', fontWeight: '700', fontSize: 13 },
  cartItem: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 15, padding: 13, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  quantityControl: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff5f0', borderRadius: 11, paddingHorizontal: 5, paddingVertical: 4 },
  quantityButton: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  quantityButtonText: { color: '#c8322a', fontSize: 18, fontWeight: '700', lineHeight: 22 },
  quantity: { minWidth: 16, textAlign: 'center', color: '#302923', fontWeight: '700' },
  addressOption: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 13, marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  addressOptionSelected: { borderColor: '#d83a32', backgroundColor: '#fff8f4' },
  radio: { color: '#d83a32', fontSize: 18 },
  billCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 15, marginTop: 8, marginBottom: 14 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 5 },
  billLabel: { color: '#756b63', fontSize: 13 },
  billValue: { color: '#302923', fontSize: 13 },
  billBold: { color: '#2b241f', fontWeight: '800', fontSize: 15 },
  billDivider: { height: 1, backgroundColor: '#f0e8e1', marginVertical: 7 },
  paymentNote: { color: '#8a8078', fontSize: 11, marginTop: 9, lineHeight: 16 },
  primaryButton: { minHeight: 50, backgroundColor: '#d83a32', borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonSpinner: { marginTop: 12 },
  refreshButton: { backgroundColor: '#fff0eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  refreshText: { color: '#c8322a', fontSize: 12, fontWeight: '700' },
  orderCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 17, padding: 15, marginBottom: 11 },
  orderTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  orderPlace: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderTotal: { color: '#302923', fontWeight: '800', fontSize: 14 },
  statusPill: { alignSelf: 'flex-start', backgroundColor: '#fff0e1', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, marginTop: 11 },
  statusText: { color: '#9e531b', textTransform: 'capitalize', fontSize: 11, fontWeight: '800' },
  orderItems: { color: '#5d544d', fontSize: 12, marginTop: 10, lineHeight: 18 },
  addressCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 10 },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defaultBadge: { color: '#27734a', backgroundColor: '#e9f6ee', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, fontWeight: '800' },
  addressText: { color: '#6f655d', fontSize: 13, lineHeight: 19, marginTop: 7 },
  addressActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 13 },
  removeLink: { color: '#b42318', fontWeight: '700', fontSize: 13 },
  formCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 13 },
  couponCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12, marginBottom: 10 },
  couponSuccess: { color: '#27734a', fontSize: 11, fontWeight: '700', marginTop: 7 },
  couponError: { color: '#b42318', fontSize: 11, marginTop: 7 },
  couponListTitle: { color: '#4e453e', fontSize: 11, fontWeight: '800', marginTop: 11, marginBottom: 4 },
  couponRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: '#f0e8e1', borderTopWidth: 1, paddingVertical: 8 },
  couponCode: { color: '#c8322a', fontSize: 12, fontWeight: '800' },
  trackingCard: { borderRadius: 11, backgroundColor: '#f4f8ff', padding: 11, marginTop: 9 },
  trackingError: { borderRadius: 11, backgroundColor: '#fff1f0', padding: 11, marginTop: 9 },
  trackingErrorText: { color: '#a9241c', fontSize: 12, lineHeight: 17, marginBottom: 5 },
  trackingTitle: { color: '#214b7a', fontSize: 12, fontWeight: '800' },
  reviewItems: { borderTopColor: '#f0e8e1', borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  reviewItemsTitle: { color: '#4e453e', fontSize: 11, fontWeight: '800', marginBottom: 4 },
  reviewItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6 },
  reviewItemName: { color: '#5d544d', fontSize: 11, flex: 1 },
  ratingRow: { flexDirection: 'row', gap: 8, marginVertical: 7 },
  ratingButton: { padding: 3 },
  ratingStar: { color: '#d7cec7', fontSize: 25 },
  ratingStarActive: { color: '#f2a900' },
  reviewInput: { minHeight: 75, textAlignVertical: 'top', paddingTop: 11 },
  input: { height: 46, borderColor: '#eee3da', borderWidth: 1, backgroundColor: '#fffaf7', borderRadius: 11, paddingHorizontal: 12, color: '#302923', fontSize: 13, marginBottom: 9 },
  inputRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 9 },
  halfInput: { flex: 1 },
  cancelButton: { padding: 12, alignItems: 'center' },
  cancelText: { color: '#756b63', fontWeight: '700' },
  profileCard: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 20, padding: 22, marginTop: 17, marginBottom: 13 },
  avatar: { width: 65, height: 65, borderRadius: 24, backgroundColor: '#ffebe4', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText: { color: '#c8322a', fontWeight: '800', fontSize: 26 },
  profileName: { color: '#302923', fontWeight: '800', fontSize: 18 },
  profileDetail: { color: '#80766e', fontSize: 13, marginTop: 4 },
  customerBadge: { color: '#c8322a', backgroundColor: '#fff0eb', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, fontSize: 9, letterSpacing: 0.7, fontWeight: '800', marginTop: 13 },
  menuLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 13, padding: 15, marginBottom: 8 },
  menuLinkText: { color: '#302923', fontSize: 14, fontWeight: '600' },
  chevron: { color: '#9a8e84', fontSize: 21 },
  signOutLink: { marginTop: 12, justifyContent: 'center' },
  signOutText: { color: '#b42318', fontWeight: '700', fontSize: 14 },
  tabBar: { minHeight: Platform.OS === 'android' ? 76 : 66, flexDirection: 'row', backgroundColor: '#fff', borderTopColor: '#eee7e1', borderTopWidth: 1, paddingBottom: Platform.OS === 'android' ? 17 : 7, paddingTop: 7 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 18, color: '#9a8e84', textAlign: 'center', height: 22 },
  tabLabel: { fontSize: 9, color: '#8d8178', marginTop: 1, fontWeight: '600' },
  activeTabText: { color: '#d83a32', fontWeight: '800' },
  cartBadge: { position: 'absolute', top: -4, right: -11, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: '#d83a32', alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
