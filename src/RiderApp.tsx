import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { apiRequest } from './api';
import {
  decodeDigipin,
  formatDigipin,
  isValidDigipin,
  openMapplsMap,
  openNavigationTarget,
  resolveCustomerDigipin,
  resolveCustomerLocation,
} from './digipin';
import GlobalHeader from './GlobalHeader';
import NewDeliveryOfferModal, {
  isOrderInServiceablePincode,
  getOrderPincodes,
  getRiderServiceablePincodes,
} from './NewDeliveryOfferModal';
import ProfileAccess from './ProfileAccess';
import SignOutModal from './SignOutModal';
import { formatOrderNumber, formatOrderStatus, getAccountDisplayId, getOrderStatusBadgeColors } from './types';
import type { Order, Session, User } from './types';

type RiderTab = 'available' | 'active' | 'history' | 'account';
type Earnings = {
  totalDeliveries: number;
  totalEarnings: number;
  codCollections?: { cash?: number; upi?: number; total?: number };
  orders: Order[];
};
type RiderLocation = {
  isOnline?: boolean;
  currentLocation?: { lat?: number; lng?: number };
};
type RiderBankDetails = {
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  panNumber?: string;
  panHolderName?: string;
  upiId?: string;
  isSubmitted?: boolean;
  isApproved?: boolean;
  isLocked?: boolean;
  adminNote?: string;
  riderPayoutPerOrder?: number;
};

type Props = {
  session: Session;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

function amount(value: number | undefined): string {
  return `₹${Number(value || 0).toFixed(0)}`;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function destination(order: Order, pickup: boolean): string {
  if (pickup) {
    return order.restaurantAddress || order.shopAddress || order.restaurantName || order.shopName || 'Tomato partner';
  }
  return [
    order.deliveryAddress?.line1,
    order.deliveryAddress?.line2,
    order.deliveryAddress?.city,
    order.deliveryAddress?.postalCode,
  ].filter(Boolean).join(', ');
}

function openMap(address: string) {
  if (!address.trim()) {
    Alert.alert('Address unavailable', 'Tomato has not provided a map address for this order.');
    return;
  }
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  void Linking.openURL(url).catch(() => Alert.alert('Unable to open maps', 'Install a map application and try again.'));
}

async function navigateToCustomer(order: Order) {
  const custLoc = resolveCustomerLocation(order);
  const dropAddress = destination(order, false);

  // 1st Priority: Customer DIGIPIN (decoded to exact lat/lng coordinates)
  // 2nd Priority (if DIGIPIN not set): Verified Customer GPS Location
  // Fallback: Street Address Text
  await openNavigationTarget({
    digipin: custLoc.digipin,
    lat: custLoc.lat,
    lng: custLoc.lng,
    address: dropAddress,
  });
}

async function navigateToPickup(order: Order) {
  const digipin = order.pickupDigipin || order.restaurantDigipin || order.shopDigipin;
  const pickupAddress = destination(order, true);

  // Shop / Restaurant pickup uses DIGIPIN
  await openNavigationTarget({
    digipin,
    address: pickupAddress,
  });
}

function extractPincode(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b([1-9][0-9]{5})\b/);
  return match ? match[1] : undefined;
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const pLat1 = Number(lat1) || 0;
  const pLon1 = Number(lon1) || 0;
  const pLat2 = Number(lat2) || 0;
  const pLon2 = Number(lon2) || 0;
  const R = 6371; // Earth radius in km
  const dLat = (pLat2 - pLat1) * (Math.PI / 180);
  const dLon = (pLon2 - pLon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pLat1 * (Math.PI / 180)) * Math.cos(pLat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const clampedA = Math.max(0, Math.min(1, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  const res = Number((R * c).toFixed(2));
  return isNaN(res) ? 1.5 : res;
}

/**
 * Checks if an order has been accepted or assigned to ANY rider.
 * Once accepted by any rider, it must not be shown to other riders.
 */
function isOrderAcceptedByAnyRider(order: Order): boolean {
  if (!order) return false;
  const orderRider = (order as any).rider;
  const orderRiderId = String((order as any).riderId || orderRider?.id || orderRider?.riderId || (order as any).assignedRiderId || '').trim();
  const orderRiderUserId = String((order as any).riderUserId || orderRider?._id || '').trim();
  const orderRiderName = String((order as any).riderName || orderRider?.name || orderRider?.displayName || '').trim();
  const orderRiderPhone = String((order as any).riderPhone || orderRider?.phone || '').trim();
  const status = String(order.status || '').toLowerCase().trim();
  const isAcceptedStatus = ['accepted_by_rider', 'out_for_delivery', 'picked_up', 'in_transit', 'delivered', 'completed'].includes(status);
  const isPickedUp = Boolean(order.isPickedUp || order.pickupStatus === 'picked_up');

  return Boolean(
    orderRiderId ||
    orderRiderUserId ||
    orderRiderName ||
    orderRiderPhone ||
    isAcceptedStatus ||
    isPickedUp
  );
}

/**
 * Checks if an order is assigned specifically to THIS current rider.
 */
function isOrderAssignedToRider(order: Order, currentUser: User): boolean {
  if (!order || !currentUser) return false;
  const currentRiderId = String(currentUser.riderId || currentUser.rider_id || '').toLowerCase().trim();
  const currentUserId = String(currentUser._id || currentUser.id || '').toLowerCase().trim();
  const currentPartnerId = String(getAccountDisplayId(currentUser) || '').toLowerCase().trim();
  const currentPhone = String(currentUser.phone || '').replace(/[^\d]/g, '');
  const currentName = String(currentUser.name || '').toLowerCase().trim();

  const orderRider = (order as any).rider;
  const orderRiderId = String((order as any).riderId || orderRider?.id || orderRider?.riderId || (order as any).assignedRiderId || '').toLowerCase().trim();
  const orderRiderUserId = String((order as any).riderUserId || orderRider?._id || '').toLowerCase().trim();
  const orderRiderPhone = String((order as any).riderPhone || orderRider?.phone || '').replace(/[^\d]/g, '');
  const orderRiderName = String((order as any).riderName || orderRider?.name || orderRider?.displayName || '').toLowerCase().trim();

  // Match by Rider ID (e.g. rider-7067 or database identifier)
  if (orderRiderId) {
    if (currentRiderId && orderRiderId === currentRiderId) return true;
    if (currentUserId && orderRiderId === currentUserId) return true;
    if (currentPartnerId && orderRiderId === currentPartnerId) return true;
  }

  // Match by Rider User ID
  if (orderRiderUserId) {
    if (currentUserId && orderRiderUserId === currentUserId) return true;
    if (currentRiderId && orderRiderUserId === currentRiderId) return true;
    if (currentPartnerId && orderRiderUserId === currentPartnerId) return true;
  }

  // Match by Phone Number
  if (currentPhone && orderRiderPhone && currentPhone === orderRiderPhone) {
    return true;
  }

  // Match by Rider Name
  if (currentName && orderRiderName && currentName === orderRiderName) {
    return true;
  }

  return false;
}

/**
 * Determines whether an order is in the rider's serviceable area.
 * A rider can see ONLY orders in their serviceable area, not from other areas.
 * Strict Rule: When pincodes are available, the order must match the rider's serviceable pincode(s).
 */
function isOrderInServiceableArea(
  order: Order,
  rider: User,
  riderLocation?: { lat?: number; lng?: number } | null,
  activeAreaPincode?: string,
): boolean {
  if (!order || !rider) return true;

  const riderPins = getRiderServiceablePincodes(rider, activeAreaPincode);
  const { pickupPin, deliveryPin, allPins } = getOrderPincodes(order);

  // 1. PINCODE CHECK: If order has pincodes, STRICTLY match rider's serviceable pincode(s).
  // Non-serviceable pincodes must NEVER pass via city or GPS fallbacks.
  if (allPins.length > 0 || pickupPin || deliveryPin) {
    return riderPins.some((pin) => pin === pickupPin || pin === deliveryPin || allPins.includes(pin));
  }

  // Fallback ONLY when the order has NO pincode anywhere (legacy data):
  const riderCity = String(rider.city || '').trim().toLowerCase();
  const riderDigipin = String(rider.digipin || '').trim().toUpperCase();

  const pickupAddress = destination(order, true);
  const dropAddress = destination(order, false);

  const deliveryCity = String(order.deliveryAddress?.city || '').trim().toLowerCase();
  const pickupCity = String(
    (order as any).pickupCity ||
    (order as any).restaurantCity ||
    (order as any).shopCity ||
    ''
  ).trim().toLowerCase();

  const pickupDigipin = String(order.pickupDigipin || order.restaurantDigipin || order.shopDigipin || '').trim().toUpperCase();
  const deliveryDigipin = String(resolveCustomerDigipin(order) || order.deliveryAddress?.digipin || '').trim().toUpperCase();

  // DIGIPIN CHECK: Match first 2 regional quadrant characters
  if (riderDigipin && riderDigipin.length >= 2) {
    const riderQuad = riderDigipin.replace(/[^A-Z0-9]/g, '').slice(0, 2);
    if (pickupDigipin && pickupDigipin.replace(/[^A-Z0-9]/g, '').startsWith(riderQuad)) {
      return true;
    }
    if (deliveryDigipin && deliveryDigipin.replace(/[^A-Z0-9]/g, '').startsWith(riderQuad)) {
      return true;
    }
  }

  // CITY CHECK (only for orders lacking pincode)
  if (riderCity) {
    if (deliveryCity && (deliveryCity.includes(riderCity) || riderCity.includes(deliveryCity))) {
      return true;
    }
    if (pickupCity && (pickupCity.includes(riderCity) || riderCity.includes(pickupCity))) {
      return true;
    }
    if (pickupAddress.toLowerCase().includes(riderCity) || dropAddress.toLowerCase().includes(riderCity)) {
      return true;
    }
  }

  // GPS PROXIMITY CHECK (only for orders lacking pincode)
  if (riderLocation?.lat && riderLocation?.lng) {
    const custLoc = resolveCustomerLocation(order);
    const targetLat = custLoc.lat;
    const targetLng = custLoc.lng;
    if (typeof targetLat === 'number' && typeof targetLng === 'number' && !custLoc.isBangaloreDefault) {
      const dist = calculateDistanceKm(riderLocation.lat, riderLocation.lng, targetLat, targetLng);
      if (dist <= 15) {
        return true;
      }
    }
  }

  // If rider has a configured area and order doesn't match any criteria, filter out
  return false;
}

export default function RiderApp({ session, onSignOut, onSessionUserUpdate }: Props) {
  const [tab, setTab] = useState<RiderTab>('available');
  const [overviewModalVisible, setOverviewModalVisible] = useState(false);
  const [isOnline, setIsOnline] = useState(
    session.user.isApproved !== false && (session.user.isOnline ?? false),
  );
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<Earnings | null>(null);
  const [location, setLocation] = useState<RiderLocation | null>(null);
  const [bankDetails, setBankDetails] = useState<RiderBankDetails>({});
  const [bankWallet, setBankWallet] = useState(0);
  const [bankCredit, setBankCredit] = useState(0);
  const [payouts, setPayouts] = useState<Record<string, unknown>[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [bankForm, setBankForm] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    panNumber: '',
    panHolderName: '',
    upiId: '',
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [newDeliveryOffer, setNewDeliveryOffer] = useState<Order | null>(null);
  const isApproved = session.user.isApproved !== false;
  const knownOfferStatuses = useRef<Map<string, string> | null>(null);

  // Serviceable Area State
  const [operatingPincode, setOperatingPincode] = useState(
    String(session.user.pincode || session.user.postalCode || ''),
  );
  const [operatingCity, setOperatingCity] = useState(String(session.user.city || ''));
  const [areaPincodeInput, setAreaPincodeInput] = useState(
    String(session.user.pincode || session.user.postalCode || ''),
  );
  const [areaCityInput, setAreaCityInput] = useState(String(session.user.city || ''));
  const [savingOperatingArea, setSavingOperatingArea] = useState(false);
  const [filteredOutCount, setFilteredOutCount] = useState(0);

  async function saveOperatingArea() {
    const cleanPin = String(areaPincodeInput || '').trim();
    const cleanCity = String(areaCityInput || '').trim();
    const extractedPins = cleanPin.match(/\b([1-9][0-9]{5})\b/g);
    if (cleanPin && (!extractedPins || extractedPins.length === 0)) {
      setError('Enter a valid 6-digit Indian PIN code (e.g. 560001).');
      return;
    }
    setSavingOperatingArea(true);
    setError('');
    try {
      await apiRequest('/api/auth/profile', session.token, {
        method: 'PUT',
        body: JSON.stringify({ pincode: cleanPin, city: cleanCity }),
      });
      await onSessionUserUpdate({
        ...session.user,
        pincode: cleanPin,
        city: cleanCity,
      });
      setOperatingPincode(cleanPin);
      setOperatingCity(cleanCity);
      Alert.alert(
        'Serviceable Area Updated',
        `Your delivery zone is now set to PIN ${cleanPin || 'Default'} ${cleanCity ? `(${cleanCity})` : ''}.`,
      );
      await loadAvailable();
    } catch (err) {
      setError(readableError(err));
    } finally {
      setSavingOperatingArea(false);
    }
  }

  async function loadStatus() {
    const result = await apiRequest<{ isOnline: boolean }>('/api/rider/status', session.token);
    if (!isApproved && result.isOnline) {
      await apiRequest('/api/rider/status', session.token, {
        method: 'PUT',
        body: JSON.stringify({ isOnline: false }),
      });
      setIsOnline(false);
      return;
    }
    setIsOnline(result.isOnline);
  }

  async function loadLocation() {
    const result = await apiRequest<RiderLocation>('/api/rider/location', session.token);
    setLocation(result);
    setIsOnline(result.isOnline ?? false);
  }

  async function loadAvailable() {
    if (!isApproved) {
      setOrders([]);
      return;
    }
    const result = await apiRequest<{ orders: Order[]; isOnline?: boolean }>(
      '/api/rider/orders/available',
      session.token,
    );
    const rawOrders = result.orders || [];

    // Filter 1: Exclude orders accepted by ANY rider
    // "once order is accepted by any rider then it should show only to him, not to any other riders"
    const openOrders = rawOrders.filter((order) => {
      if (isOrderAcceptedByAnyRider(order)) return false;
      return ['placed', 'accepted', 'preparing', 'ready_for_pickup'].includes(order.status || '');
    });

    // Filter 2: Serviceable area filter
    // "a rider can see only the order in his servicable area not from other servicable area"
    const nextOrders = openOrders.filter((order) =>
      isOrderInServiceableArea(order, session.user, location?.currentLocation, operatingPincode)
    );

    const outsideAreaCount = openOrders.length - nextOrders.length;
    setFilteredOutCount(Math.max(0, outsideAreaCount));

    const eligibleOrders = nextOrders.filter((order) =>
      ['accepted', 'preparing', 'ready_for_pickup'].includes(order.status || ''),
    );
    if (knownOfferStatuses.current) {
      const newOffer = eligibleOrders.find((order) => {
        const previousStatus = knownOfferStatuses.current?.get(order._id);
        const isFresh = !['accepted', 'preparing', 'ready_for_pickup'].includes(previousStatus || '');
        return isFresh && isOrderInServiceablePincode(order, session.user, operatingPincode);
      });
      if (newOffer && isOnline && isApproved) {
        setNewDeliveryOffer(newOffer);
      }
    }
    knownOfferStatuses.current = new Map(
      nextOrders.map((order) => [order._id, order.status || 'placed']),
    );
    setOrders(nextOrders);
    if (result.isOnline !== undefined) setIsOnline(result.isOnline);
  }

  async function loadActive() {
    const result = await apiRequest<{ orders: Order[] }>('/api/rider/orders/active', session.token);
    const rawActive = result.orders || [];

    // "once order is accepted by any rider then it should show only to him, not to any other riders"
    // Keep ONLY orders assigned to THIS logged-in rider
    const myActiveOrders = rawActive.filter((order) => {
      if (isOrderAcceptedByAnyRider(order)) {
        return isOrderAssignedToRider(order, session.user);
      }
      return true;
    });

    setActiveOrders(myActiveOrders);
  }

  async function loadHistory() {
    const result = await apiRequest<Earnings>('/api/rider/orders/history', session.token);
    setHistory(result);
  }

  async function loadBankDetails() {
    setBankLoading(true);
    try {
      const result = await apiRequest<{
        bankDetails?: RiderBankDetails;
        walletBalance?: number;
        creditPoint?: number;
        payouts?: Record<string, unknown>[];
      }>('/api/rider/bank-details', session.token);
      const details = result.bankDetails || {};
      setBankDetails(details);
      setBankWallet(Number(result.walletBalance || 0));
      setBankCredit(Number(result.creditPoint || 0));
      setPayouts(result.payouts || []);
      setBankForm((current) => ({
        ...current,
        accountHolderName: details.accountHolderName || current.accountHolderName,
        bankName: details.bankName || current.bankName,
        ifscCode: details.ifscCode || current.ifscCode,
        panHolderName: details.panHolderName || current.panHolderName,
        upiId: details.upiId || current.upiId,
      }));
    } finally {
      setBankLoading(false);
    }
  }

  async function saveBankDetails() {
    if (
      !bankForm.accountHolderName.trim()
      || !bankForm.bankName.trim()
      || bankForm.accountNumber.trim().length < 6
      || !bankForm.ifscCode.trim()
      || !bankForm.panNumber.trim()
      || !bankForm.panHolderName.trim()
    ) {
      setError('Enter the account holder, bank, account number, IFSC and PAN details.');
      return;
    }
    setSavingBank(true);
    setError('');
    try {
      await apiRequest('/api/rider/bank-details', session.token, {
        method: 'PUT',
        body: JSON.stringify({
          ...bankForm,
          accountHolderName: bankForm.accountHolderName.trim(),
          bankName: bankForm.bankName.trim(),
          accountNumber: bankForm.accountNumber.trim(),
          ifscCode: bankForm.ifscCode.trim().toUpperCase(),
          panNumber: bankForm.panNumber.trim().toUpperCase(),
          panHolderName: bankForm.panHolderName.trim(),
          upiId: bankForm.upiId.trim(),
        }),
      });
      setBankForm((current) => ({ ...current, accountNumber: '', panNumber: '' }));
      await loadBankDetails();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setSavingBank(false);
    }
  }

  async function loadAll() {
    setError('');
    setLoading(true);
    try {
      await Promise.all([
        loadStatus(),
        ...(isApproved ? [loadLocation()] : []),
        loadAvailable(),
        loadActive(),
        loadHistory(),
      ]);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [session.token]);

  useEffect(() => {
    if (tab === 'available') void loadAvailable().catch((reason) => setError(readableError(reason)));
    if (tab === 'active') void loadActive().catch((reason) => setError(readableError(reason)));
    if (tab === 'history') void loadHistory().catch((reason) => setError(readableError(reason)));
    if (tab === 'account') void loadBankDetails().catch((reason) => setError(readableError(reason)));
  }, [tab, session.token]);

  useEffect(() => {
    if (tab !== 'available' || !isOnline || !isApproved) return;
    const interval = setInterval(() => {
      void loadAvailable().catch((reason) => setError(readableError(reason)));
    }, 15_000);
    return () => clearInterval(interval);
  }, [tab, isOnline, isApproved, session.token]);

  useEffect(() => {
    if (!isOnline || !isApproved) return;
    let disposed = false;
    let locationWatcher: Location.LocationSubscription | null = null;

    async function startLiveGpsTracking() {
      try {
        if (AppState.currentState !== 'active') return;
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          if (!disposed) {
            setError('Location permission is needed for live GPS tracking while on duty.');
          }
          return;
        }

        // Fetch initial high-accuracy position immediately
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        if (!disposed && position?.coords) {
          const currentLocation = {
            lat: Number(position.coords.latitude.toFixed(6)),
            lng: Number(position.coords.longitude.toFixed(6)),
            speed: position.coords.speed ?? 0,
            heading: position.coords.heading ?? 0,
          };
          setLocation((previous) => ({ ...previous, currentLocation, isOnline: true }));
          void apiRequest('/api/rider/location', session.token, {
            method: 'PUT',
            body: JSON.stringify({ ...currentLocation, isOnline: true }),
          }).catch(() => null);
        }

        // Start real-time live GPS stream (every 4s or 5m moved)
        locationWatcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 4000,
            distanceInterval: 5,
          },
          (pos) => {
            if (disposed || !pos?.coords) return;
            const liveLoc = {
              lat: Number(pos.coords.latitude.toFixed(6)),
              lng: Number(pos.coords.longitude.toFixed(6)),
              speed: pos.coords.speed ?? 0,
              heading: pos.coords.heading ?? 0,
            };
            setLocation((previous) => ({ ...previous, currentLocation: liveLoc, isOnline: true }));
            void apiRequest('/api/rider/location', session.token, {
              method: 'PUT',
              body: JSON.stringify({ ...liveLoc, isOnline: true }),
            }).catch(() => null);
          },
        );
      } catch (reason) {
        if (!disposed) setError(readableError(reason));
      }
    }

    void startLiveGpsTracking();

    return () => {
      disposed = true;
      if (locationWatcher) {
        locationWatcher.remove();
      }
    };
  }, [isOnline, isApproved, session.token]);

  async function changeDuty(next: boolean) {
    setError('');
    try {
      if (next) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setError('Allow foreground location access before going online so customers can track deliveries.');
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const currentLocation = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        };
        await apiRequest('/api/rider/location', session.token, {
          method: 'PUT',
          body: JSON.stringify({ ...currentLocation, isOnline: true }),
        });
        setLocation((previous) => ({ ...previous, currentLocation, isOnline: true }));
      } else {
        await apiRequest('/api/rider/status', session.token, {
          method: 'PUT',
          body: JSON.stringify({ isOnline: false }),
        });
      }
      setIsOnline(next);
      await loadAvailable();
    } catch (reason) {
      setError(readableError(reason));
      await loadStatus().catch(() => undefined);
    }
  }

  async function orderAction(order: Order, action: 'accept' | 'reject' | 'pickup' | 'deliver') {
    if (!order._id) return;
    if ((action === 'accept' || action === 'pickup' || action === 'deliver') && !isOnline) {
      setError('Go online before updating a delivery.');
      return;
    }
    if (action === 'deliver' && order.paymentMethod === 'cod') {
      Alert.alert(
        `Collect ${amount(order.totalAmount)} COD`,
        'Confirm the payment method you received from the customer.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Cash', onPress: () => void updateOrder(order, action, 'cash') },
          { text: 'UPI', onPress: () => void updateOrder(order, action, 'upi') },
        ],
      );
      return;
    }
    if (action === 'deliver') {
      Alert.alert('Confirm delivery', 'Has the order been delivered to the customer?', [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Delivered', onPress: () => void updateOrder(order, action) },
      ]);
      return;
    }
    if (action === 'reject') {
      Alert.alert('Reject delivery offer?', 'This order will be removed from your available offers.', [
        { text: 'Keep offer', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => void updateOrder(order, action) },
      ]);
      return;
    }
    await updateOrder(order, action);
  }

  async function updateOrder(order: Order, action: 'accept' | 'reject' | 'pickup' | 'deliver', codCollectedVia?: 'cash' | 'upi') {
    setBusyId(order._id);
    setError('');
    const path = action === 'accept'
      ? `/api/rider/orders/${order._id}/accept`
      : action === 'reject'
        ? `/api/rider/orders/${order._id}/reject`
        : action === 'pickup'
          ? `/api/rider/orders/${order._id}/pickup`
          : `/api/rider/orders/${order._id}/deliver`;
    try {
      await apiRequest(path, session.token, {
        method: 'POST',
        ...(action === 'deliver' ? { body: JSON.stringify({ codCollectedVia }) } : {}),
      });

      // Immediate local state update for exclusivity:
      // Once accepted by THIS rider, it belongs only to him and disappears from available offers
      if (action === 'accept') {
        const currentRiderId = getAccountDisplayId(session.user);
        const assignedOrder: Order = {
          ...order,
          status: 'out_for_delivery',
          riderId: currentRiderId,
          riderName: session.user.name || 'Tomato Delivery Partner',
          riderPhone: session.user.phone,
          assignedRiderId: currentRiderId,
        };
        setActiveOrders((prev) => [assignedOrder, ...prev.filter((o) => o._id !== order._id)]);
        setOrders((prev) => prev.filter((o) => o._id !== order._id));
      }

      await Promise.all([loadAvailable(), loadActive()]);
      if (action === 'accept') setTab('active');
      if (action === 'deliver') {
        await loadHistory();
        Alert.alert('Delivery complete', 'Tomato order status has been updated.');
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusyId('');
    }
  }

  async function showNotifications() {
    setError('');
    try {
      const result = await apiRequest<{
        notifications: { title?: string; message?: string }[];
      }>('/api/rider/notifications', session.token);
      const content = result.notifications
        .slice(0, 5)
        .map((notification) => `• ${notification.title || 'Tomato update'}: ${notification.message || ''}`)
        .join('\n\n');
      Alert.alert('Rider updates', content || 'You are all caught up.');
    } catch (reason) {
      setError(readableError(reason));
    }
  }

  function signOut() {
    setSignOutModalVisible(true);
  }

  async function performSignOut() {
    setIsSigningOut(true);
    try {
      if (isOnline) {
        await apiRequest('/api/rider/status', session.token, {
          method: 'PUT',
          body: JSON.stringify({ isOnline: false }),
        });
      }
      await apiRequest('/api/auth/logout', session.token, { method: 'POST' });
    } catch (reason) {
      Alert.alert('Unable to finish sign out', readableError(reason));
    } finally {
      setIsSigningOut(false);
      setSignOutModalVisible(false);
      await onSignOut();
    }
  }

  async function refresh() {
    setRefreshing(true);
    if (tab === 'history') {
      try {
        await loadHistory();
      } catch (reason) {
        setError(readableError(reason));
      } finally {
        setRefreshing(false);
      }
    } else {
      await loadAll();
    }
  }

  const todayEarnings = useMemo(() => {
    if (!history?.orders?.length) return 0;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const payoutRate = Number(bankDetails.riderPayoutPerOrder) || 40;

    const todayOrders = history.orders.filter((order) => {
      const time = new Date((order as any).deliveredAt || order.updatedAt || order.createdAt || 0).getTime();
      return time >= startOfDay;
    });

    return todayOrders.reduce((sum, order) => {
      const orderEarning = Number((order as any).riderEarnings || (order as any).riderPayout || (order as any).riderFee) || payoutRate;
      return sum + orderEarning;
    }, 0);
  }, [history?.orders, bankDetails.riderPayoutPerOrder]);

  const tabs: [RiderTab, string, string][] = [
    ['available', 'Available', '🚴'],
    ['active', 'Active', '🚀'],
    ['history', 'Trip Earnings', '₹'],
    ['account', 'Bank & Payouts', '🏦'],
  ];

  const normalizedSearch = search.trim().toLowerCase();

  const filteredAvailableOrders = orders.filter((o) => {
    if (!normalizedSearch) return true;
    return (
      (o.orderNumber || '').toLowerCase().includes(normalizedSearch) ||
      (o.restaurantName || '').toLowerCase().includes(normalizedSearch) ||
      (o.shopName || '').toLowerCase().includes(normalizedSearch) ||
      destination(o, false).toLowerCase().includes(normalizedSearch) ||
      destination(o, true).toLowerCase().includes(normalizedSearch)
    );
  });

  const filteredActiveOrders = activeOrders.filter((o) => {
    if (!normalizedSearch) return true;
    return (
      (o.orderNumber || '').toLowerCase().includes(normalizedSearch) ||
      (o.restaurantName || '').toLowerCase().includes(normalizedSearch) ||
      (o.shopName || '').toLowerCase().includes(normalizedSearch) ||
      destination(o, false).toLowerCase().includes(normalizedSearch) ||
      destination(o, true).toLowerCase().includes(normalizedSearch)
    );
  });

  const deliveredOrdersCount = history?.totalDeliveries ?? (history?.orders?.length || 0);
  const codCollectionsTotal =
    history?.codCollections?.total ??
    ((history?.codCollections?.cash || 0) + (history?.codCollections?.upi || 0));
  const tripEarningsTotal = history?.totalEarnings ?? (deliveredOrdersCount * 40);

  function renderDashboardTiles(currentTab: 'available' | 'active' | 'history') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dashboardTilesRow}
        style={styles.dashboardTilesScroll}
      >
        <DashboardTile
          label="Available Pickups"
          value={filteredAvailableOrders.length}
          isActive={currentTab === 'available'}
          onPress={() => setTab('available')}
          theme="orange"
        />
        <DashboardTile
          label="Active Delivery"
          value={filteredActiveOrders.length}
          isActive={currentTab === 'active'}
          onPress={() => setTab('active')}
          theme="blue"
        />
        <DashboardTile
          label="Delivered Orders"
          value={deliveredOrdersCount}
          isActive={currentTab === 'history'}
          onPress={() => setTab('history')}
          theme="purple"
        />
        <DashboardTile
          label="Trip Earnings"
          value={amount(todayEarnings)}
          isActive={currentTab === 'history'}
          onPress={() => setTab('history')}
          theme="green"
        />
        <DashboardTile
          label="Collections"
          value={amount(codCollectionsTotal)}
          isActive={false}
          onPress={() => setOverviewModalVisible(true)}
          theme="amber"
        />
      </ScrollView>
    );
  }

  return (
    <View style={styles.app}>
      <GlobalHeader
        session={session}
        onBrandPress={() => setTab('available')}
        searchQuery={search}
        onSearchChange={(text) => setSearch(text)}
        searchPlaceholder="Search deliveries, addresses…"
        addressText={operatingCity || 'Rider Service Area'}
        pincode={operatingPincode || session.user.pincode || 'Active Grid'}
        onNotificationPress={() => void showNotifications()}
        rightActions={
          <Pressable onPress={() => void refresh()} style={styles.iconButton}>
            <Text style={styles.iconText}>↻</Text>
          </Pressable>
        }
        profileBottomAction={
          isApproved ? (
            <RiderDutyToggle
              value={isOnline}
              onValueChange={(value) => void changeDuty(value)}
              compact
            />
          ) : undefined
        }
        roleLabel="Delivery partner"
        profileMenuItems={[
          {
            key: 'overview',
            label: 'Overview',
            description: 'Delivery Performance & Payout Report',
            icon: '🏠',
          },
          {
            key: 'available',
            label: 'Available Pickups',
            description: 'See orders in your service area',
            icon: '🚴',
          },
          {
            key: 'active',
            label: 'Active Delivery',
            description: 'Open your current delivery route',
            icon: '🚀',
          },
          {
            key: 'history',
            label: 'Trip Earnings',
            description: 'Review completed deliveries and earnings',
            icon: '₹',
          },
          {
            key: 'account',
            label: 'Bank & Payouts',
            description: 'Manage rider details and payout information',
            icon: '🏦',
          },
        ]}
        onNavigateProfile={(key) => {
          if (key === 'overview') {
            void loadHistory();
            setOverviewModalVisible(true);
          } else {
            setTab(key as RiderTab);
          }
        }}
        onSignOut={performSignOut}
        onSessionUserUpdate={onSessionUserUpdate}
      />
      {!!error && (
        <Pressable onPress={() => setError('')} style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text><Text style={styles.dismiss}>×</Text>
        </Pressable>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#d83a32" />}
      >
        {tab === 'available' && (
          <View>
            <View style={styles.riderHeaderRow}>
              <View style={styles.riderHeaderInfo}>
                <Text style={[styles.eyebrow, { marginBottom: 0 }]}>DELIVERY PARTNER</Text>
                <Text style={styles.riderHeaderName}>· {session.user.name || 'Rider'}</Text>
              </View>
            </View>
            <Text style={styles.title}>Available pickups</Text>
            <Text style={styles.subtitle}>Accept a delivery, pick it up, then bring it to the customer.</Text>
            {!isApproved && (
              <Notice
                title="Approval pending"
                detail="Your rider registration is awaiting administrator approval. Delivery offers will be available after approval."
              />
            )}

            {/* Serviceable Area Protected Zone Banner */}
            <View style={styles.serviceAreaBanner}>
              <View style={styles.serviceAreaLeft}>
                <Text style={styles.serviceAreaEyebrow}>📍 SERVICEABLE AREA</Text>
                <Text style={styles.serviceAreaTitle}>
                  {operatingPincode ? `PIN ${operatingPincode}` : 'Active Delivery Grid'}
                  {operatingCity ? ` · ${operatingCity}` : ''}
                </Text>
                <Text style={styles.serviceAreaSub}>
                  Showing offers exclusively in your delivery zone
                </Text>
              </View>
              <View style={styles.serviceAreaBadge}>
                <Text style={styles.serviceAreaBadgeText}>LOCAL ZONE</Text>
              </View>
            </View>

            {renderDashboardTiles('available')}
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : filteredAvailableOrders.length ? (
              filteredAvailableOrders.map((order) => (
                <RiderOrderCard
                  key={order._id}
                  order={order}
                  mode="available"
                  busy={busyId === order._id}
                  online={isOnline && isApproved}
                  onAction={(action) => void orderAction(order, action)}
                />
              ))
            ) : (
              <Notice
                title={isOnline ? 'No pickup orders in your area' : 'Go online to receive offers'}
                detail={isOnline ? `New pickup orders from your serviceable area (${operatingPincode || 'local grid'}) will appear here.` : 'Your duty status is offline. Switch online when you are ready to work.'}
              />
            )}
          </View>
        )}

        {tab === 'active' && (
          <View>
            <Text style={styles.eyebrow}>YOUR DELIVERIES</Text>
            <Text style={styles.title}>Active Delivery ({filteredActiveOrders.length})</Text>
            <Text style={styles.subtitle}>Orders accepted by you. Exclusive to your delivery route.</Text>

            {renderDashboardTiles('active')}
            {!isOnline && <Notice title="You are offline" detail="Go online to update pickup and delivery progress." />}
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : filteredActiveOrders.length ? (
              filteredActiveOrders.map((order) => (
                <RiderOrderCard
                  key={order._id}
                  order={order}
                  mode="active"
                  busy={busyId === order._id}
                  online={isOnline}
                  onAction={(action) => void orderAction(order, action)}
                />
              ))
            ) : (
              <Notice title="No active deliveries" detail="Accepted orders will appear here exclusively for you. Check available pickups for new offers." />
            )}
          </View>
        )}

        {tab === 'history' && (
          <View>
            <Text style={styles.eyebrow}>DELIVERY PERFORMANCE</Text>
            <Text style={styles.title}>
              Trip Earnings (<Text style={styles.greenAmountText}>{amount(todayEarnings)}</Text>)
            </Text>
            <Text style={styles.subtitle}>Completed orders recorded by Tomato.</Text>
            {renderDashboardTiles('history')}
            {history ? (
              <>
                <View style={styles.collectionCard}>
                  <Text style={styles.cardTitle}>COD collections</Text>
                  <InfoRow label="Cash" value={amount(history.codCollections?.cash)} />
                  <InfoRow label="UPI" value={amount(history.codCollections?.upi)} />
                  <InfoRow label="Total collected" value={amount(history.codCollections?.total)} bold />
                </View>
                {history.orders.map((order) => (
                  <RiderOrderCard
                    key={order._id}
                    order={order}
                    mode="history"
                    busy={false}
                    online={false}
                    onAction={() => undefined}
                  />
                ))}
                {!history.orders.length && <Notice title="No completed deliveries yet" detail="Once you finish deliveries, they will be listed here." />}
              </>
            ) : loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : (
              <Pressable onPress={() => void loadHistory()} style={styles.refreshButton}>
                <Text style={styles.refreshText}>Load earnings</Text>
              </Pressable>
            )}
          </View>
        )}

        {tab === 'account' && (
          <View>
            <Text style={styles.eyebrow}>RIDER ACCOUNT</Text>
            <Text style={styles.title}>Bank & Payouts</Text>
            <View style={styles.accountCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(session.user.name || 'R').charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.accountName}>{session.user.name || 'Tomato rider'}</Text>
              {!!session.user.phone && <Text style={styles.muted}>{session.user.phone}</Text>}
              {!!session.user.deliveryVehicle && <Text style={styles.muted}>Vehicle: {session.user.deliveryVehicle}</Text>}
              <Text style={[styles.approvalBadge, !isApproved && styles.pendingBadge]}>
                {isApproved ? 'APPROVED RIDER' : 'AWAITING APPROVAL'}
              </Text>
            </View>
            {isApproved ? (
              <DutyCard online={isOnline} onChange={(value) => void changeDuty(value)} />
            ) : (
              <Notice title="Duty controls unavailable" detail="You can go online after your rider account is approved." />
            )}
            {location?.currentLocation && (
              <View style={styles.locationCard}>
                <View style={styles.liveTrackingHeader}>
                  <Text style={styles.livePulseDot}>🟢</Text>
                  <Text style={styles.cardTitle}>Live GPS Tracking Active</Text>
                </View>
                <Text style={styles.muted}>
                  Rider GPS: {location.currentLocation.lat?.toFixed(5)}, {location.currentLocation.lng?.toFixed(5)}
                </Text>
                <Text style={styles.locationFoot}>Live GPS coordinates are actively streamed for customer and store tracking.</Text>
              </View>
            )}
            {/* Serviceable Delivery Zone Card */}
            <View style={styles.collectionCard}>
              <View style={styles.liveTrackingHeader}>
                <Text style={styles.livePulseDot}>📍</Text>
                <Text style={styles.cardTitle}>Serviceable Delivery Zone</Text>
              </View>
              <Text style={styles.muted}>
                You receive delivery offers exclusively in your assigned serviceable area. Orders accepted by any rider are exclusive to that rider.
              </Text>
              <Text style={styles.serviceFieldLabel}>Operating Pincode(s)</Text>
              <TextInput
                style={styles.bankInput}
                placeholder="6-digit PIN code(s) (e.g. 560001)"
                value={areaPincodeInput}
                onChangeText={setAreaPincodeInput}
                keyboardType="numbers-and-punctuation"
                maxLength={35}
              />
              <Text style={styles.serviceFieldLabel}>City / Region</Text>
              <TextInput
                style={styles.bankInput}
                placeholder="City (e.g. Bengaluru)"
                value={areaCityInput}
                onChangeText={setAreaCityInput}
              />
              <View style={styles.serviceAreaSaveBtn}>
                <ActionButton
                  disabled={savingOperatingArea}
                  label={savingOperatingArea ? 'Updating zone…' : 'Update serviceable zone'}
                  onPress={() => void saveOperatingArea()}
                />
              </View>
            </View>

            <View style={styles.collectionCard}>
              <Text style={styles.cardTitle}>Bank details & payouts</Text>
              {bankLoading && <ActivityIndicator color="#d83a32" style={styles.loader} />}
              <Text style={styles.muted}>
                {bankDetails.isApproved ? 'Approved and locked' : bankDetails.isSubmitted ? 'Submitted, awaiting review' : 'Not yet submitted'}
                {bankDetails.accountNumber ? ` · Account ••••${bankDetails.accountNumber.slice(-4)}` : ''}
              </Text>
              <View style={styles.dashboardTiles}>
                <DashboardTile label="Wallet" value={amount(bankWallet)} theme="teal" />
                <DashboardTile label="Credit points" value={amount(bankCredit)} theme="rose" />
              </View>
              {!!bankDetails.adminNote && <Text style={styles.locationFoot}>{bankDetails.adminNote}</Text>}
              {bankDetails.riderPayoutPerOrder !== undefined && (
                <InfoRow label="Payout per delivery" value={amount(bankDetails.riderPayoutPerOrder)} />
              )}
              {bankDetails.isApproved || bankDetails.isLocked ? (
                <Text style={styles.muted}>Approved bank information is locked. Contact Tomato support to request changes.</Text>
              ) : (
                <>
                  {([
                    ['accountHolderName', 'Account holder'],
                    ['bankName', 'Bank name'],
                    ['accountNumber', 'Account number'],
                    ['ifscCode', 'IFSC code'],
                    ['panNumber', 'PAN number'],
                    ['panHolderName', 'PAN holder name'],
                    ['upiId', 'UPI ID (optional)'],
                  ] as const).map(([field, placeholder]) => (
                    <TextInput
                      key={field}
                      style={styles.bankInput}
                      placeholder={placeholder}
                      value={bankForm[field]}
                      onChangeText={(value) => setBankForm((current) => ({ ...current, [field]: value }))}
                      autoCapitalize={field === 'ifscCode' || field === 'panNumber' ? 'characters' : 'words'}
                      secureTextEntry={field === 'accountNumber' || field === 'panNumber'}
                    />
                  ))}
                  <ActionButton
                    disabled={savingBank}
                    label={savingBank ? 'Submitting…' : 'Submit bank details'}
                    onPress={() => void saveBankDetails()}
                  />
                </>
              )}
              {payouts.map((payout, index) => (
                <View key={String(payout._id || payout.id || index)} style={styles.payoutRow}>
                  <InfoRow label="Payout" value={amount(Number(payout.amount))} />
                  <InfoRow label="Status" value={String(payout.status || '—')} />
                  <InfoRow label="Reference" value={String(payout.utrCode || payout.transactionId || '—')} />
                </View>
              ))}
              {!payouts.length && <Text style={styles.muted}>No payouts recorded yet.</Text>}
            </View>
            <Pressable onPress={signOut} style={styles.signOutButton}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      <View style={styles.tabBar}>
        {tabs.map(([id, label, icon]) => {
          const hasParens = label.includes('(') && label.includes(')');
          const mainLabel = hasParens ? label.split('(')[0].trim() : label;
          const parensContent = hasParens ? label.slice(label.indexOf('(') + 1, label.indexOf(')')) : '';

          return (
            <Pressable key={id} onPress={() => setTab(id)} style={styles.tabButton}>
              <Text style={[styles.tabIcon, tab === id && styles.tabActive]}>{icon}</Text>
              <Text style={[styles.tabLabel, tab === id && styles.tabActive]} numberOfLines={1}>
                {mainLabel}
                {hasParens && (
                  <Text>
                    {' '}(<Text style={styles.tabGreenAmount}>{parensContent}</Text>)
                  </Text>
                )}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <NewDeliveryOfferModal
        visible={Boolean(newDeliveryOffer)}
        order={newDeliveryOffer}
        rider={session.user}
        operatingPincode={operatingPincode}
        isLoading={busyId === newDeliveryOffer?._id}
        onAccept={async (order) => {
          try {
            await updateOrder(order, 'accept');
            setNewDeliveryOffer(null);
          } catch (err) {
            setError(readableError(err));
          }
        }}
        onViewOffer={() => {
          setTab('available');
          setNewDeliveryOffer(null);
        }}
        onClose={() => setNewDeliveryOffer(null)}
      />
      <SignOutModal
        visible={signOutModalVisible}
        onClose={() => setSignOutModalVisible(false)}
        onConfirm={performSignOut}
        isLoading={isSigningOut}
      />
      <RiderPerformanceReportModal
        visible={overviewModalVisible}
        onClose={() => setOverviewModalVisible(false)}
        session={session}
        history={history}
        availableOrders={filteredAvailableOrders}
        activeOrders={activeOrders}
        isOnline={isOnline}
        isApproved={isApproved}
        location={location}
        operatingPincode={operatingPincode}
        operatingCity={operatingCity}
        bankWallet={bankWallet}
      />
    </View>
  );
}

function getWeekInfo(d: Date = new Date()) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // 0 for Monday, 6 for Sunday
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day, 0, 0, 0, 0);
  const sunday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 6, 23, 59, 59, 999);

  // ISO 8601 week number (counting updates automatically)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(target.getFullYear(), 0, 4 - jan4Day);
  const diffDays = Math.round((target.getTime() - firstMonday.getTime()) / 86400000);
  const weekNum = 1 + Math.floor(diffDays / 7);

  return { weekNum, startMs: monday.getTime(), endMs: sunday.getTime() };
}

type ReportPeriod = 'all' | 'today' | 'week' | 'current_week' | 'prev_week' | 'month';

function RiderPerformanceReportModal({
  visible,
  onClose,
  session,
  history,
  availableOrders,
  activeOrders,
  isOnline,
  isApproved,
  location,
  operatingPincode,
  operatingCity,
  bankWallet,
}: {
  visible: boolean;
  onClose: () => void;
  session: Session;
  history: Earnings | null;
  availableOrders: Order[];
  activeOrders: Order[];
  isOnline: boolean;
  isApproved: boolean;
  location: RiderLocation | null;
  operatingPincode?: string;
  operatingCity?: string;
  bankWallet?: number;
}) {
  const [period, setPeriod] = useState<ReportPeriod>('today');

  useEffect(() => {
    if (visible) {
      setPeriod('today');
    }
  }, [visible]);

  const currWeek = useMemo(() => getWeekInfo(new Date()), []);
  const prevWeek = useMemo(() => getWeekInfo(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), []);

  const periodOptions: [ReportPeriod, string][] = useMemo(() => [
    ['all', 'All Time'],
    ['today', 'Today'],
    ['week', 'Last 7 Days'],
    ['current_week', `W-${currWeek.weekNum}`],
    ['prev_week', `W-${prevWeek.weekNum}`],
    ['month', 'This Month'],
  ], [currWeek.weekNum, prevWeek.weekNum]);

  const periodOrders = useMemo(() => {
    const list = history?.orders || [];
    if (period === 'all') return list;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfDay - 7 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return list.filter((order) => {
      const time = new Date((order as any).deliveredAt || order.updatedAt || order.createdAt || 0).getTime();
      if (period === 'today') return time >= startOfDay;
      if (period === 'week') return time >= startOfWeek;
      if (period === 'current_week') return time >= currWeek.startMs && time <= currWeek.endMs;
      if (period === 'prev_week') return time >= prevWeek.startMs && time <= prevWeek.endMs;
      if (period === 'month') return time >= startOfMonth;
      return true;
    });
  }, [history?.orders, period, currWeek, prevWeek]);

  const stats = useMemo(() => {
    const deliveredCount = period === 'all'
      ? (history?.totalDeliveries ?? periodOrders.length)
      : periodOrders.length;
    const estimatedEarnings = period === 'all'
      ? (history?.totalEarnings ?? deliveredCount * 40)
      : deliveredCount * 40;

    const codOrders = periodOrders.filter((o) => {
      const method = (o.paymentMethod || '').toLowerCase();
      return method === 'cod' || method === 'cash';
    });
    const codAmount = period === 'all' && history?.codCollections?.total !== undefined
      ? history.codCollections.total
      : codOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    const prepaidOrders = periodOrders.filter((o) => {
      const method = (o.paymentMethod || '').toLowerCase();
      return method !== 'cod' && method !== 'cash';
    });
    const prepaidAmount = prepaidOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    const codCash = period === 'all' && history?.codCollections?.cash !== undefined
      ? history.codCollections.cash
      : codAmount;
    const codUpi = period === 'all' && history?.codCollections?.upi !== undefined
      ? history.codCollections.upi
      : 0;

    return {
      deliveredCount,
      estimatedEarnings,
      codCount: codOrders.length,
      codAmount,
      codCash,
      codUpi,
      prepaidCount: prepaidOrders.length,
      prepaidAmount,
      activeCount: activeOrders.length,
      availableCount: availableOrders.length,
    };
  }, [periodOrders, period, history, activeOrders.length, availableOrders.length]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.reportModalContainer}>
        {/* Header */}
        <View style={styles.reportModalHeader}>
          <View style={styles.flex}>
            <Text style={styles.reportEyebrow}>TOMATO DISPATCH REPORT</Text>
            <Text style={styles.reportMainTitle}>Overview</Text>
            <Text style={styles.reportSubTitle}>Rider Performance & Delivery Report</Text>
          </View>
          <Pressable onPress={onClose} style={styles.reportCloseButton} accessibilityLabel="Close report">
            <Text style={styles.reportCloseText}>×</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.reportScroll} contentContainerStyle={styles.reportContent} showsVerticalScrollIndicator={false}>
          {/* Rider Identity Card */}
          <View style={styles.reportRiderCard}>
            <View style={styles.reportRiderTop}>
              <View style={styles.reportAvatarCircle}>
                <Text style={styles.reportAvatarText}>
                  {String(session.user.name || 'R').trim().charAt(0).toUpperCase() || 'R'}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.reportRiderName}>{session.user.name || 'Delivery Partner'}</Text>
                <Text style={styles.reportRiderId}>
                  ID: {getAccountDisplayId(session.user)} · {session.user.deliveryVehicle || 'Two Wheeler'}
                </Text>
              </View>
              <View style={[styles.reportStatusBadge, { backgroundColor: isOnline ? '#dcfce7' : '#f1f5f9' }]}>
                <Text style={[styles.reportStatusBadgeText, { color: isOnline ? '#15803d' : '#64748b' }]}>
                  {isOnline ? '● ON DUTY' : '○ STANDBY'}
                </Text>
              </View>
            </View>

            <View style={styles.reportZoneBar}>
              <Text style={styles.reportZoneText}>
                📍 Serviceable Grid: PIN {operatingPincode || session.user.pincode || '560001'} {operatingCity ? `· ${operatingCity}` : ''}
              </Text>
              {location?.currentLocation && (
                <Text style={styles.reportGpsText}>
                  🟢 GPS: {(Number(location.currentLocation.lat) || 0).toFixed(4)}, {(Number(location.currentLocation.lng) || 0).toFixed(4)}
                </Text>
              )}
            </View>
          </View>

          {/* Time Range Selector: All filters displayed in the same row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.periodRow}
            style={styles.periodScrollWrapper}
          >
            {periodOptions.map(([p, label]) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={[styles.periodChip, period === p && styles.periodChipActive]}
              >
                <Text style={[styles.periodChipText, period === p && styles.periodChipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Key Rider KPIs Grid */}
          <Text style={styles.sectionHeaderTitle}>Earnings & Delivery Volume</Text>
          <View style={styles.kpiGrid}>
            <View style={[styles.kpiCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
              <Text style={styles.kpiLabel}>ESTIMATED EARNINGS</Text>
              <Text style={[styles.kpiValue, { color: '#15803d' }]}>{amount(stats.estimatedEarnings)}</Text>
              <Text style={styles.kpiSubhint}>₹40 / completed delivery</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
              <Text style={styles.kpiLabel}>COMPLETED DELIVERIES</Text>
              <Text style={[styles.kpiValue, { color: '#1d4ed8' }]}>{stats.deliveredCount}</Text>
              <Text style={styles.kpiSubhint}>Fulfilled successfully</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: '#faf5ff', borderColor: '#e9d5ff' }]}>
              <Text style={styles.kpiLabel}>ACTIVE ON ROAD</Text>
              <Text style={[styles.kpiValue, { color: '#7e22ce' }]}>{stats.activeCount}</Text>
              <Text style={styles.kpiSubhint}>Assigned to you now</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
              <Text style={styles.kpiLabel}>AVAILABLE PICKUPS</Text>
              <Text style={[styles.kpiValue, { color: '#c2410c' }]}>{stats.availableCount}</Text>
              <Text style={styles.kpiSubhint}>In your serviceable area</Text>
            </View>
          </View>

          {/* COD & Cash In Hand Collections */}
          <Text style={styles.sectionHeaderTitle}>Cash on Delivery (COD) Collections</Text>
          <View style={styles.paymentCard}>
            <View style={styles.paymentItem}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentEmoji}>💵</Text>
                <Text style={styles.paymentType}>Cash Collected</Text>
              </View>
              <Text style={styles.paymentAmount}>{amount(stats.codCash)}</Text>
              <Text style={styles.paymentSubtext}>{stats.codCount} COD order{stats.codCount === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.paymentVerticalDivider} />
            <View style={styles.paymentItem}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentEmoji}>📱</Text>
                <Text style={styles.paymentType}>UPI Collected</Text>
              </View>
              <Text style={styles.paymentAmount}>{amount(stats.codUpi)}</Text>
              <Text style={styles.paymentSubtext}>Direct to partner</Text>
            </View>
          </View>
          <View style={styles.codSummaryNotice}>
            <Text style={styles.codSummaryTitle}>💼 Cash-in-Hand Total: {amount(stats.codAmount)}</Text>
            <Text style={styles.codSummaryText}>
              All cash collected on delivery must be deposited according to your shift reconciliation schedule.
            </Text>
          </View>

          {/* Delivery Operations Breakdown */}
          <Text style={styles.sectionHeaderTitle}>Delivery Operations Funnel</Text>
          <View style={styles.funnelCard}>
            <View style={styles.funnelRow}>
              <View style={styles.funnelDotAndLabel}>
                <View style={[styles.funnelDot, { backgroundColor: '#16a34a' }]} />
                <Text style={styles.funnelLabel}>Completed & Delivered</Text>
              </View>
              <Text style={styles.funnelValue}>{stats.deliveredCount}</Text>
            </View>
            <View style={styles.funnelDivider} />
            <View style={styles.funnelRow}>
              <View style={styles.funnelDotAndLabel}>
                <View style={[styles.funnelDot, { backgroundColor: '#2563eb' }]} />
                <Text style={styles.funnelLabel}>Active In-Transit / Pickup</Text>
              </View>
              <Text style={styles.funnelValue}>{stats.activeCount}</Text>
            </View>
            <View style={styles.funnelDivider} />
            <View style={styles.funnelRow}>
              <View style={styles.funnelDotAndLabel}>
                <View style={[styles.funnelDot, { backgroundColor: '#ea580c' }]} />
                <Text style={styles.funnelLabel}>Available in Grid</Text>
              </View>
              <Text style={styles.funnelValue}>{stats.availableCount}</Text>
            </View>
          </View>

          {/* Recent Deliveries Log */}
          <Text style={styles.sectionHeaderTitle}>Completed Deliveries ({periodOrders.length})</Text>
          <View style={styles.recentOrdersCard}>
            {periodOrders.length > 0 ? (
              periodOrders.map((order, idx) => {
                const formattedNum = formatOrderNumber(order);
                const store = order.restaurantName || order.shopName || 'Partner Store';
                const isCod = (order.paymentMethod || '').toLowerCase() === 'cod' || (order.paymentMethod || '').toLowerCase() === 'cash';
                const drop = destination(order, false);
                return (
                  <View key={order._id || idx} style={[styles.recentOrderRow, idx > 0 && styles.recentOrderDivider]}>
                    <View style={styles.recentOrderLeft}>
                      <View style={styles.recentOrderBadgeRow}>
                        <Text style={styles.recentOrderNumber}>{formattedNum}</Text>
                        <View style={[styles.recentPayBadge, { backgroundColor: isCod ? '#fee2e2' : '#dcfce7' }]}>
                          <Text style={[styles.recentPayText, { color: isCod ? '#991b1b' : '#15803d' }]}>
                            {isCod ? 'COD' : 'PAID'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.recentStoreName} numberOfLines={1}>🏪 {store}</Text>
                      {Boolean(drop) && (
                        <Text style={styles.recentDropAddress} numberOfLines={1}>📍 {drop}</Text>
                      )}
                    </View>
                    <View style={styles.recentOrderRight}>
                      <Text style={styles.recentOrderAmount}>{amount(order.totalAmount)}</Text>
                      <Text style={styles.recentDeliveryReward}>+₹40 reward</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.noItemsText}>No delivery records found for this period.</Text>
            )}
          </View>

          {/* Close button */}
          <Pressable onPress={onClose} style={styles.reportDoneButton} accessibilityRole="button">
            <Text style={styles.reportDoneButtonText}>Close Report</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function DutyCard({ online, onChange }: { online: boolean; onChange: (online: boolean) => void }) {
  return (
    <View style={styles.dutyCard}>
      <View style={styles.flex}>
        <Text style={styles.dutyTitle}>{online ? 'You are open (online)' : 'You are closed (offline)'}</Text>
        <Text style={styles.muted}>{online ? 'Ready to receive delivery offers.' : 'Go online when you are ready to work.'}</Text>
      </View>
      <RiderDutyToggle value={online} onValueChange={onChange} />
    </View>
  );
}

function RiderOrderCard({
  order,
  mode,
  busy,
  online,
  onAction,
}: {
  order: Order;
  mode: 'available' | 'active' | 'history';
  busy: boolean;
  online: boolean;
  onAction: (action: 'accept' | 'reject' | 'pickup' | 'deliver') => void;
}) {
  const pickedUp = Boolean(order.isPickedUp || order.pickupStatus === 'picked_up');
  const phone = order.deliveryAddress?.phone || order.customerPhone;
  const items = order.items?.map((item) => `${item.quantity || 1} × ${item.name}`).join(' · ');
  const pickupAddress = destination(order, true);
  const dropAddress = destination(order, false);

  const pickupDigipin = order.pickupDigipin || order.restaurantDigipin || order.shopDigipin;
  const customerLoc = resolveCustomerLocation(order);
  const customerDigipin = customerLoc.digipin;
  const hasCustomerDigipin = customerLoc.isFromDigipin;
  const hasCustomerGps = !hasCustomerDigipin && typeof customerLoc.lat === 'number' && typeof customerLoc.lng === 'number' && !customerLoc.isBangaloreDefault;
  const customerGpsLng = customerLoc.lng;
  const customerGpsLat = customerLoc.lat;

  const formattedOrderNumber = formatOrderNumber(order);
  const statusLabel = formatOrderStatus(order.status || 'placed');
  const badgeStyle = getOrderStatusBadgeColors(order.status || 'placed');

  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.flex}>
          <View style={styles.orderNumberRow}>
            <Text style={styles.orderNumber}>{formattedOrderNumber}</Text>
            <View style={[styles.orderStatusBadge, { backgroundColor: badgeStyle.bg }]}>
              <Text style={[styles.orderStatusBadgeText, { color: badgeStyle.text }]}>
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.orderAmount}>{amount(order.totalAmount)}</Text>
      </View>
      {mode === 'available' && (
        <View style={styles.serviceableOrderPill}>
          <Text style={styles.serviceableOrderPillText}>
            📍 In Your Serviceable Area · Exclusive Pickup
          </Text>
        </View>
      )}
      {mode === 'active' && (
        <View style={styles.exclusiveActivePill}>
          <Text style={styles.exclusiveActivePillText}>
            🔒 Assigned to You · Exclusive Delivery
          </Text>
        </View>
      )}
      {mode !== 'history' && (
        <View style={[styles.progressBadge, pickedUp ? styles.progressDelivered : styles.progressPickup]}>
          <Text style={[styles.progressText, pickedUp ? styles.progressDeliveredText : styles.progressPickupText]}>
            {mode === 'available' ? 'PICKUP AVAILABLE' : pickedUp ? 'OUT FOR DELIVERY' : 'ON THE WAY TO PICKUP'}
          </Text>
        </View>
      )}
      <View style={styles.routeBlock}>
        <Text style={styles.routeIcon}>●</Text>
        <View style={styles.flex}>
          <Text style={styles.routeLabel}>PICKUP {order.shopName ? 'SHOP' : 'RESTAURANT'}</Text>
          <Text style={styles.routeName}>{order.shopName || order.restaurantName || 'Tomato partner'}</Text>
          <Text style={styles.muted}>{pickupAddress}</Text>
          {!!pickupDigipin && (
            <View style={styles.routingTargetBadgeDigipin}>
              <Text style={styles.routingTargetTextDigipin}>⌖ Pickup DIGIPIN: {formatDigipin(pickupDigipin)}</Text>
            </View>
          )}
        </View>
        {mode !== 'history' && (
          <Pressable
            onPress={() => void navigateToPickup(order)}
            style={pickupDigipin ? styles.mapButtonDigipin : styles.mapButton}
          >
            <Text style={pickupDigipin ? styles.mapTextDigipin : styles.mapText}>
              {pickupDigipin ? 'DIGIPIN' : 'Map'}
            </Text>
          </Pressable>
        )}
      </View>
      <View style={styles.routeDivider} />
      <View style={styles.routeBlock}>
        <Text style={[styles.routeIcon, styles.dropIcon]}>●</Text>
        <View style={styles.flex}>
          <Text style={styles.routeLabel}>CUSTOMER DROP</Text>
          <Text style={styles.routeName}>{order.customerName || 'Tomato customer'}</Text>
          <Text style={styles.muted}>{dropAddress || 'Delivery address unavailable'}</Text>
          
          {hasCustomerDigipin ? (
            <View style={styles.routingTargetBadgeDigipin}>
              <Text style={styles.routingTargetTextDigipin}>
                ⌖ Deliver to DIGIPIN: {formatDigipin(customerDigipin)}
              </Text>
            </View>
          ) : hasCustomerGps ? (
            <View style={styles.routingTargetBadgeGps}>
              <Text style={styles.routingTargetTextGps}>
                📍 Deliver to Customer GPS: {customerGpsLat?.toFixed(5)}, {customerGpsLng?.toFixed(5)}
              </Text>
            </View>
          ) : (
            <Text style={styles.phone}>Text address fallback</Text>
          )}

          {!!phone && <Text style={styles.phone}>{phone}</Text>}
        </View>
        {mode !== 'history' && (
          <Pressable
            onPress={() => void navigateToCustomer(order)}
            style={hasCustomerDigipin ? styles.mapButtonDigipin : styles.mapButton}
          >
            <Text style={hasCustomerDigipin ? styles.mapTextDigipin : styles.mapText}>
              {hasCustomerDigipin ? 'DIGIPIN' : hasCustomerGps ? 'GPS Map' : 'Map'}
            </Text>
          </Pressable>
        )}
      </View>
      {!!items && <Text style={styles.items}>{items}</Text>}
      <Text style={styles.payment}>
        {order.paymentMethod === 'cod' ? (
          <Text>
            <Text style={{ color: '#dc2626', fontWeight: '800' }}>COD</Text>
            {` · COLLECT ${amount(order.totalAmount)} CASH / UPI`}
          </Text>
        ) : (
          <Text>
            {`${(order.paymentMethod || 'ONLINE').toUpperCase()} · `}
            <Text style={{ color: '#16a34a', fontWeight: '800' }}>PAID</Text>
          </Text>
        )}
      </Text>
      {mode === 'available' && order.status === 'placed' && (
        <Text style={styles.waitingText}>Waiting for the restaurant or shop to accept this order.</Text>
      )}
      {mode === 'available' && order.status !== 'placed' && (
        <View style={styles.actions}>
          <ActionButton
            disabled={busy}
            label="Reject"
            variant="outline"
            onPress={() => onAction('reject')}
          />
          <ActionButton
            disabled={busy || !online}
            label={busy ? 'Working…' : 'Accept delivery'}
            onPress={() => onAction('accept')}
          />
        </View>
      )}
      {mode === 'active' && (
        <View style={styles.actions}>
          {!pickedUp ? (
            <>
              <ActionButton
                disabled={busy}
                label={pickupDigipin ? 'Pickup DIGIPIN' : 'Pickup map'}
                variant="outline"
                onPress={() => void navigateToPickup(order)}
              />
              <ActionButton
                disabled={busy || !online}
                label={busy ? 'Updating…' : 'Confirm pickup'}
                onPress={() => onAction('pickup')}
              />
            </>
          ) : (
            <>
              <ActionButton
                disabled={busy}
                label={hasCustomerDigipin ? 'Customer DIGIPIN' : hasCustomerGps ? 'Customer GPS Map' : 'Customer map'}
                variant="outline"
                onPress={() => void navigateToCustomer(order)}
              />
              <ActionButton
                disabled={busy || !online}
                label={busy ? 'Updating…' : 'Mark delivered'}
                onPress={() => onAction('deliver')}
              />
            </>
          )}
        </View>
      )}
      {mode === 'history' && (
        <Text style={styles.muted}>
          Completed {order.updatedAt || order.createdAt ? new Date(order.updatedAt || order.createdAt || '').toLocaleDateString() : ''}
        </Text>
      )}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        variant === 'outline' && styles.outlineButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text style={[styles.actionText, variant === 'outline' && styles.outlineText]}>{label}</Text>
    </Pressable>
  );
}

function Notice({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeEmoji}>🍅</Text>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.muted}>{detail}</Text>
    </View>
  );
}

function RiderDutyToggle({
  value,
  onValueChange,
  disabled = false,
  compact = false,
}: {
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`Rider duty is ${value ? 'open' : 'close'}`}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={compact ? 8 : undefined}
      style={[
        compact ? styles.dutyToggleTrackCompact : styles.dutyToggleTrack,
        value ? styles.dutyToggleTrackOpen : styles.dutyToggleTrackClose,
        disabled && styles.dutyToggleDisabled,
      ]}
    >
      {value ? (
        <View style={compact ? styles.dutyToggleContentOpenCompact : styles.dutyToggleContentOpen}>
          <Text style={compact ? styles.dutyToggleTextOpenCompact : styles.dutyToggleTextOpen}>Open</Text>
          <View style={compact ? styles.dutyToggleThumbCompact : styles.dutyToggleThumb} />
        </View>
      ) : (
        <View style={compact ? styles.dutyToggleContentCloseCompact : styles.dutyToggleContentClose}>
          <View style={compact ? styles.dutyToggleThumbCompact : styles.dutyToggleThumb} />
          <Text style={compact ? styles.dutyToggleTextCloseCompact : styles.dutyToggleTextClose}>Close</Text>
        </View>
      )}
    </Pressable>
  );
}

function InfoRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  const isZeroRupees = typeof value === 'string' && (value === '₹0' || value.includes('₹0'));
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, bold && styles.infoBold]}>{label}</Text>
      <Text style={[styles.infoValue, bold && styles.infoBold, isZeroRupees && styles.dashboardTileValueRupees]}>{value}</Text>
    </View>
  );
}

type DashboardTileTheme = 'orange' | 'blue' | 'purple' | 'green' | 'amber' | 'teal' | 'rose' | 'default';

const TILE_THEMES: Record<
  DashboardTileTheme,
  {
    bg: string;
    border: string;
    activeBorder: string;
    activeBg: string;
    labelColor: string;
    valueColor: string;
    dotColor: string;
  }
> = {
  orange: {
    bg: '#fff7ed',
    border: '#fed7aa',
    activeBorder: '#ea580c',
    activeBg: '#ffedd5',
    labelColor: '#9a3412',
    valueColor: '#c2410c',
    dotColor: '#ea580c',
  },
  blue: {
    bg: '#eff6ff',
    border: '#bfdbfe',
    activeBorder: '#2563eb',
    activeBg: '#dbeafe',
    labelColor: '#1e40af',
    valueColor: '#1d4ed8',
    dotColor: '#2563eb',
  },
  purple: {
    bg: '#faf5ff',
    border: '#e9d5ff',
    activeBorder: '#9333ea',
    activeBg: '#f3e8ff',
    labelColor: '#6b21a8',
    valueColor: '#7e22ce',
    dotColor: '#9333ea',
  },
  green: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    activeBorder: '#16a34a',
    activeBg: '#dcfce7',
    labelColor: '#166534',
    valueColor: '#15803d',
    dotColor: '#16a34a',
  },
  amber: {
    bg: '#fffbeb',
    border: '#fde68a',
    activeBorder: '#d97706',
    activeBg: '#fef3c7',
    labelColor: '#92400e',
    valueColor: '#b45309',
    dotColor: '#d97706',
  },
  teal: {
    bg: '#f0fdfa',
    border: '#99f6e4',
    activeBorder: '#0d9488',
    activeBg: '#ccfbf1',
    labelColor: '#115e59',
    valueColor: '#0f766e',
    dotColor: '#0d9488',
  },
  rose: {
    bg: '#fff1f2',
    border: '#fecdd3',
    activeBorder: '#e11d48',
    activeBg: '#ffe4e6',
    labelColor: '#9f1239',
    valueColor: '#be123c',
    dotColor: '#e11d48',
  },
  default: {
    bg: '#ffffff',
    border: '#cfc4b8',
    activeBorder: '#d83a32',
    activeBg: '#fff7f5',
    labelColor: '#6c625a',
    valueColor: '#302923',
    dotColor: '#d83a32',
  },
};

function DashboardTile({
  label,
  value,
  isActive = false,
  onPress,
  theme = 'default',
}: {
  label: string;
  value: number | string;
  isActive?: boolean;
  onPress?: () => void;
  theme?: DashboardTileTheme;
}) {
  const t = TILE_THEMES[theme] || TILE_THEMES.default;
  const isZeroRupees = typeof value === 'string' && (value === '₹0' || value.includes('₹0'));
  const isRupees = typeof value === 'string' && value.includes('₹');

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}${isActive ? ' (currently active)' : ''}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.dashboardTile,
        {
          backgroundColor: isActive ? t.activeBg : t.bg,
          borderColor: isActive ? t.activeBorder : t.border,
          borderWidth: isActive ? 2 : 1.5,
        },
        pressed && Boolean(onPress) && styles.dashboardTilePressed,
      ]}
    >
      <View style={styles.dashboardTileHeader}>
        <Text
          style={[
            styles.dashboardTileValue,
            { color: isZeroRupees ? '#16a34a' : t.valueColor },
            isActive && { color: isZeroRupees ? '#16a34a' : t.activeBorder, fontWeight: '900' },
          ]}
        >
          {value}
        </Text>
        {isActive && (
          <View
            style={[
              styles.dashboardTileActiveDot,
              { backgroundColor: t.dotColor },
            ]}
          />
        )}
      </View>
      <Text
        style={[
          styles.dashboardTileLabel,
          { color: t.labelColor },
          isActive && { fontWeight: '800' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#fffaf5' },
  flex: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14, backgroundColor: '#fff', borderBottomColor: '#f0e8e1', borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { color: '#d83a32', fontWeight: '800', fontSize: 21 },
  role: { color: '#7b7169', fontSize: 12, marginTop: 2 },
  iconButton: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#fff0eb', alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#c8322a', fontSize: 22 },
  content: { flexGrow: 1, padding: 17, paddingTop: 20, paddingBottom: 24 },
  errorBanner: { backgroundColor: '#fff1f0', marginHorizontal: 14, marginTop: 9, borderRadius: 11, padding: 10, flexDirection: 'row', alignItems: 'center' },
  errorText: { color: '#b42318', fontSize: 12, lineHeight: 17, flex: 1 },
  dismiss: { color: '#b42318', fontSize: 20, paddingHorizontal: 5 },
  eyebrow: { color: '#d83a32', fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 6 },
  riderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  riderHeaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    gap: 5,
  },
  riderHeaderName: {
    color: '#1f2937',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.2,
  },
  riderStatusText: {
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.2,
  },
  riderStatusOnline: {
    color: '#16a34a',
  },
  riderStatusOffline: {
    color: '#dc2626',
  },
  headerDutySwitch: {
    transform: Platform.OS === 'ios' ? [{ scale: 0.8 }] : [{ scale: 0.9 }],
  },
  dutyToggleTrack: {
    width: 78,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 3,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  dutyToggleTrackCompact: {
    width: 54,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 2.5,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 1,
    elevation: 2,
  },
  dutyToggleTrackOpen: {
    backgroundColor: '#16a34a',
    borderWidth: 1.5,
    borderColor: '#15803d',
  },
  dutyToggleTrackClose: {
    backgroundColor: '#dc2626',
    borderWidth: 1.5,
    borderColor: '#b91c1c',
  },
  dutyToggleDisabled: {
    opacity: 0.5,
  },
  dutyToggleContentOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 7,
    paddingRight: 1,
  },
  dutyToggleContentOpenCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4.5,
    paddingRight: 1,
  },
  dutyToggleContentClose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 1,
    paddingRight: 7,
  },
  dutyToggleContentCloseCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 1,
    paddingRight: 4.5,
  },
  dutyToggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  dutyToggleThumbCompact: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  dutyToggleTextOpen: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dutyToggleTextOpenCompact: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  dutyToggleTextClose: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dutyToggleTextCloseCompact: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  dashboardTileValueRupees: {
    color: '#16a34a',
  },
  greenAmountText: {
    color: '#16a34a',
    fontWeight: '800',
  },
  tabGreenAmount: {
    color: '#16a34a',
    fontWeight: '800',
  },
  title: { color: '#2d2621', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#82786f', fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 16 },
  dutyCard: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 15, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dashboardTilesScroll: {
    marginBottom: 14,
  },
  dashboardTilesRow: {
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 2,
    alignItems: 'stretch',
  },
  dashboardTiles: { flexDirection: 'row', gap: 9, marginBottom: 14 },
  dashboardTile: {
    minWidth: 114,
    flex: 1,
    backgroundColor: '#fff',
    borderColor: '#cfc4b8',
    borderWidth: 1.5,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    justifyContent: 'space-between',
  },
  dashboardTileActive: {
    borderColor: '#d83a32',
    borderWidth: 2,
    backgroundColor: '#fff7f5',
    shadowColor: '#d83a32',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 3,
  },
  dashboardTilePressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  dashboardTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dashboardTileValue: { color: '#302923', fontSize: 19, fontWeight: '800' },
  dashboardTileValueActive: { color: '#d83a32' },
  dashboardTileActiveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#d83a32',
  },
  dashboardTileLabel: { color: '#6c625a', fontSize: 10, fontWeight: '700', marginTop: 3 },
  dashboardTileLabelActive: { color: '#d83a32', fontWeight: '800' },
  dutyTitle: { color: '#302923', fontWeight: '800', fontSize: 14 },
  loader: { marginTop: 40 },
  muted: { color: '#82786f', fontSize: 12, lineHeight: 18, marginTop: 3 },
  notice: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 20, marginVertical: 8, gap: 6 },
  noticeEmoji: { fontSize: 30, marginBottom: 2 },
  noticeTitle: { color: '#302923', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  orderCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 11 },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  orderNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  orderNumber: { color: '#302923', fontSize: 15, fontWeight: '800' },
  orderStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  orderStatusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  orderAmount: { color: '#302923', fontSize: 15, fontWeight: '800' },
  progressBadge: { alignSelf: 'flex-start', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, marginTop: 9 },
  progressPickup: { backgroundColor: '#eff6ff' },
  progressDelivered: { backgroundColor: '#e9f6ee' },
  progressText: { fontSize: 9, fontWeight: '800' },
  progressPickupText: { color: '#1d4ed8' },
  progressDeliveredText: { color: '#27734a' },
  routeBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14 },
  routeIcon: { color: '#d83a32', fontSize: 12, marginTop: 2 },
  dropIcon: { color: '#39a164' },
  routeLabel: { color: '#897e75', fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  routeName: { color: '#302923', fontSize: 13, fontWeight: '700', marginTop: 3 },
  mapButton: { borderColor: '#eadfd7', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9 },
  mapText: { color: '#c8322a', fontSize: 10, fontWeight: '800' },
  mapButtonDigipin: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 9 },
  mapTextDigipin: { color: '#1d4ed8', fontSize: 10, fontWeight: '800' },
  routingTargetBadgeDigipin: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start' },
  routingTargetTextDigipin: { color: '#1d4ed8', fontSize: 10.5, fontWeight: '800' },
  routingTargetBadgeGps: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start' },
  routingTargetTextGps: { color: '#166534', fontSize: 10.5, fontWeight: '800' },
  digipinPillBadge: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start' },
  digipinPillBadgeText: { color: '#1d4ed8', fontSize: 10.5, fontWeight: '800' },
  gpsPillBadge: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start' },
  gpsPillBadgeText: { color: '#166534', fontSize: 10.5, fontWeight: '800' },
  liveTrackingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  livePulseDot: { fontSize: 12 },
  routeDivider: { height: 1, backgroundColor: '#f0e8e1', marginLeft: 21, marginTop: 11 },
  phone: { color: '#c8322a', fontSize: 11, fontWeight: '700', marginTop: 4 },
  items: { color: '#5d544d', fontSize: 11, lineHeight: 17, marginTop: 12 },
  payment: { color: '#8e561f', fontSize: 10, fontWeight: '800', backgroundColor: '#fff7e8', alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 7, marginTop: 11 },
  waitingText: { color: '#897e75', fontSize: 11, lineHeight: 16, marginTop: 11 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 13 },
  actionButton: { flex: 1, minHeight: 41, borderRadius: 10, backgroundColor: '#d83a32', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { color: '#fff', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  outlineButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eadfd7' },
  outlineText: { color: '#c8322a' },
  disabledButton: { opacity: 0.5 },
  earningsCard: { backgroundColor: '#e9f6ee', borderRadius: 17, padding: 18, marginVertical: 12 },
  earningsLabel: { color: '#38644a', fontSize: 12, fontWeight: '700' },
  earningsValue: { color: '#214b34', fontSize: 31, fontWeight: '800', marginTop: 4 },
  earningsFoot: { color: '#557363', fontSize: 11, marginTop: 5 },
  collectionCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 15, padding: 14, marginBottom: 12 },
  bankInput: { minHeight: 42, borderColor: '#eee3da', borderWidth: 1, backgroundColor: '#fffaf7', borderRadius: 10, paddingHorizontal: 11, color: '#302923', fontSize: 12, marginTop: 8 },
  payoutRow: { borderTopColor: '#f0e8e1', borderTopWidth: 1, marginTop: 8, paddingTop: 5 },
  refreshButton: { backgroundColor: '#fff0eb', borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, alignSelf: 'flex-start', marginTop: 4 },
  refreshText: { color: '#c8322a', fontWeight: '800', fontSize: 13 },
  cardTitle: { color: '#302923', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { color: '#766c64', fontSize: 12 },
  infoValue: { color: '#302923', fontSize: 12 },
  infoBold: { fontWeight: '800' },
  accountCard: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 17, padding: 20, marginVertical: 15 },
  avatar: { height: 63, width: 63, borderRadius: 22, backgroundColor: '#fff0eb', alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  avatarText: { color: '#c8322a', fontSize: 25, fontWeight: '800' },
  accountName: { color: '#302923', fontSize: 17, fontWeight: '800', marginBottom: 3 },
  approvalBadge: { color: '#27734a', backgroundColor: '#e9f6ee', fontSize: 9, fontWeight: '800', letterSpacing: 0.7, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, marginTop: 11 },
  pendingBadge: { color: '#9b541f', backgroundColor: '#fff0e5' },
  locationCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 13 },
  locationFoot: { color: '#8c8178', fontSize: 10, marginTop: 6 },
  signOutButton: { backgroundColor: '#fff', borderColor: '#f0d8d5', borderWidth: 1, borderRadius: 12, alignItems: 'center', padding: 13, marginTop: 8 },
  signOutText: { color: '#b42318', fontSize: 13, fontWeight: '700' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopColor: '#eee7e1', borderTopWidth: 1, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 17 : 7, minHeight: Platform.OS === 'android' ? 76 : 63 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { color: '#9a8e84', fontSize: 18, height: 22 },
  tabLabel: { color: '#8d8178', fontSize: 9, fontWeight: '600' },
  tabActive: { color: '#d83a32', fontWeight: '800' },
  serviceAreaBanner: {
    backgroundColor: '#fff',
    borderColor: '#fed7aa',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 13,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#ea580c',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  serviceAreaLeft: {
    flex: 1,
  },
  serviceAreaEyebrow: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#ea580c',
    letterSpacing: 0.8,
  },
  serviceAreaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
    marginTop: 2,
  },
  serviceAreaSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  serviceAreaBadge: {
    backgroundColor: '#ffedd5',
    borderColor: '#fdba74',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  serviceAreaBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#c2410c',
    letterSpacing: 0.5,
  },
  filteredOutNotice: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  filteredOutText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  serviceFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 9,
    marginBottom: 1,
  },
  serviceAreaSaveBtn: {
    marginTop: 12,
  },
  serviceableOrderPill: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  serviceableOrderPillText: {
    color: '#15803d',
    fontSize: 10,
    fontWeight: '800',
  },
  exclusiveActivePill: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  exclusiveActivePillText: {
    color: '#1d4ed8',
    fontSize: 10,
    fontWeight: '800',
  },
  reportModalContainer: { flex: 1, backgroundColor: '#f8fafc' },
  reportModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 18,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  reportEyebrow: { fontSize: 10, fontWeight: '800', color: '#ea580c', letterSpacing: 0.8 },
  reportMainTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginTop: 1 },
  reportSubTitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  reportCloseButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  reportCloseText: { fontSize: 20, fontWeight: '700', color: '#475569', lineHeight: 22 },
  reportScroll: { flex: 1 },
  reportContent: { padding: 16, paddingBottom: 40 },
  reportRiderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  reportRiderTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffedd5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fdba74',
  },
  reportAvatarText: { fontSize: 18, fontWeight: '800', color: '#c2410c' },
  reportRiderName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  reportRiderId: { fontSize: 12, color: '#64748b', marginTop: 2 },
  reportStatusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  reportStatusBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  reportZoneBar: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  reportZoneText: { fontSize: 11.5, fontWeight: '600', color: '#334155' },
  reportGpsText: { fontSize: 11, fontWeight: '700', color: '#16a34a', fontFamily: 'monospace' },
  periodScrollWrapper: { marginBottom: 16 },
  periodRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 2 },
  periodChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  periodChipActive: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  periodChipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  periodChipTextActive: { color: '#ffffff' },
  sectionHeaderTitle: { fontSize: 13, fontWeight: '800', color: '#334155', marginBottom: 8, marginTop: 4, letterSpacing: 0.3 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpiCard: { width: '48%', borderRadius: 12, borderWidth: 1, padding: 12, minHeight: 88, justifyContent: 'space-between' },
  kpiLabel: { fontSize: 9.5, fontWeight: '800', color: '#64748b', letterSpacing: 0.5 },
  kpiValue: { fontSize: 18, fontWeight: '900', marginVertical: 3 },
  kpiSubhint: { fontSize: 10, color: '#64748b', fontWeight: '500' },
  paymentCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 10,
  },
  paymentItem: { flex: 1, alignItems: 'center' },
  paymentHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  paymentEmoji: { fontSize: 14 },
  paymentType: { fontSize: 11, fontWeight: '700', color: '#475569' },
  paymentAmount: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  paymentSubtext: { fontSize: 10, color: '#64748b', marginTop: 2 },
  paymentVerticalDivider: { width: 1, backgroundColor: '#e2e8f0', marginHorizontal: 8 },
  codSummaryNotice: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    marginBottom: 16,
  },
  codSummaryTitle: { fontSize: 12.5, fontWeight: '800', color: '#92400e', marginBottom: 2 },
  codSummaryText: { fontSize: 11, color: '#78350f', lineHeight: 16 },
  funnelCard: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 16 },
  funnelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  funnelDotAndLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelDot: { width: 8, height: 8, borderRadius: 4 },
  funnelLabel: { fontSize: 12.5, fontWeight: '600', color: '#334155' },
  funnelValue: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  funnelDivider: { height: 1, backgroundColor: '#f1f5f9' },
  recentOrdersCard: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 18 },
  recentOrderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9 },
  recentOrderDivider: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  recentOrderLeft: { flex: 1, paddingRight: 8 },
  recentOrderBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  recentOrderNumber: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  recentPayBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  recentPayText: { fontSize: 9, fontWeight: '800' },
  recentStoreName: { fontSize: 11.5, color: '#334155', fontWeight: '600' },
  recentDropAddress: { fontSize: 10.5, color: '#64748b', marginTop: 1 },
  recentOrderRight: { alignItems: 'flex-end' },
  recentOrderAmount: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  recentDeliveryReward: { fontSize: 10, fontWeight: '700', color: '#16a34a', marginTop: 1 },
  noItemsText: { fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingVertical: 14 },
  reportDoneButton: {
    backgroundColor: '#ea580c',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  reportDoneButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});
