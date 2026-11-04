import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import * as Location from 'expo-location';
import { apiPath, apiRequest } from './api';
import {
  decodeDigipin,
  formatDigipin,
  isValidDigipin,
  normalizeDigipin,
  openMapplsMap,
  resolveCustomerDigipin,
  resolveCustomerLocation,
} from './digipin';
import GlobalHeader from './GlobalHeader';
import LiveRouteTracker from './LiveRouteTracker';
import PaymentModal from './PaymentModal';
import type { PaymentSuccessDetails } from './PaymentModal';
import ProfileAccess from './ProfileAccess';
import type { ProfileMenuItem } from './ProfileAccess';
import {
  formatOrderNumber,
  formatOrderStatus,
  getCustomerId,
  getItemVariants,
  getOrderStatusBadgeColors,
  isOrderReturnAccepted,
  isOrderTrackingActive,
  type Bill,
  type OrderTracking,
} from './types';
import type {
  Address,
  CustomerNotification,
  ItemVariant,
  MenuItem,
  Order,
  Session,
  Store,
  User,
} from './types';
import {
  type ServiceArea,
  type ServiceAreaCheckResult,
  loadStoredServiceAreas,
  persistServiceAreas,
  getStorePincode,
  getAddressPincode,
  checkServiceAreaMatch,
  isStoreServiceableForCustomer,
  getStoreCoordinates,
  calculateDistanceKm,
  extractPincode,
  getAllServiceablePincodes,
  isPincodeInServiceAreas,
} from './serviceArea';
import {
  type BrowseMode,
  storeId,
  isStoreOpen,
  normalizeIdString,
  getStoreIds,
  getItemStoreIds,
  getItemStoreName,
  itemBelongsToStore,
  findStoreForItem,
  formatRupees,
  addressSummary,
  getErrorMessage,
  VegBadge,
  NonVegBadge,
  isItemVeg,
  getStoreDietary,
  getCategoryIcon,
  itemMatchesCategory,
  storeMatchesCategory,
} from './customerHelpers';
import { CustomerNotificationsModal } from './CustomerNotificationsModal';
import {
  EmptyState,
  PrimaryButton,
  QuantityControl,
  BillRow,
  DashboardTile,
  ModeButton,
} from './CustomerComponents';
import { OrderCard } from './OrderCard';

const DEFAULT_RESTAURANT_ITEM_IMAGE = require('../assets/tomato.png');
const DEFAULT_LAMBDA_LOGO = require('../assets/lambda.jpg');

export function getDefaultItemImage(isShop?: boolean) {
  return isShop ? DEFAULT_LAMBDA_LOGO : DEFAULT_RESTAURANT_ITEM_IMAGE;
}

export function getDefaultStoreLogo(_isShop?: boolean) {
  return DEFAULT_LAMBDA_LOGO;
}

type Tab = 'browse' | 'cart' | 'orders' | 'addresses' | 'account';
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
type PaymentMethod = 'razorpay' | 'cod' | 'upi' | 'card' | 'netbanking';

const PAYMENT_MODES: {
  id: PaymentMethod;
  name: string;
  icon: string;
  description: string;
  badge?: string;
}[] = [
  {
    id: 'razorpay',
    name: 'Razorpay (Cards, UPI, NetBanking)',
    icon: '⚡',
    description: 'Secured by Razorpay · Pay via UPI, Cards, or Net Banking',
    badge: 'RECOMMENDED',
  },
  {
    id: 'upi',
    name: 'UPI (GPay, PhonePe, Paytm)',
    icon: '📱',
    description: 'Instant zero-fee payment with any UPI application',
    badge: 'POPULAR',
  },
  {
    id: 'card',
    name: 'Credit or Debit Card',
    icon: '💳',
    description: 'Visa, Mastercard, RuPay, Maestro accepted',
  },
  {
    id: 'netbanking',
    name: 'Net Banking',
    icon: '🏦',
    description: 'Direct payment from major Indian banks',
  },
  {
    id: 'cod',
    name: 'Cash on delivery (COD)',
    icon: '💵',
    description: 'Pay cash or scan rider UPI QR code upon delivery',
  },
];

const POPULAR_BANKS = [
  'HDFC Bank',
  'State Bank of India',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Bank',
  'Punjab National Bank',
];

type ReviewTarget = {
  orderId: string;
  itemId: string;
  itemName: string;
  items?: { id: string; name: string }[];
  isShopOrder?: boolean;
};

type Props = {
  session: Session | null;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate?: (user: User) => Promise<void>;
  onRequestSignIn?: () => void;
};

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'browse', label: 'Browse', icon: '⌕' },
  { id: 'cart', label: 'Cart', icon: '🛍' },
  { id: 'orders', label: 'Orders', icon: '📦' },
  { id: 'addresses', label: 'Address', icon: '📍' },
  { id: 'account', label: 'Account', icon: '☺' },
];

type HeroBannerItem = {
  id: string;
  type: 'food' | 'grocery' | 'general';
  tag: string;
  tagColor: string;
  tagBg: string;
  title: string;
  subtitle: string;
  emoji: string;
  secondaryEmoji: string;
  bgColor: string;
  borderColor: string;
  targetMode?: BrowseMode;
};

const HERO_BANNERS: HeroBannerItem[] = [
  {
    id: 'fav-local',
    type: 'general',
    tag: 'FRESH & LOCAL',
    tagColor: '#b42318',
    tagBg: 'rgba(216, 58, 50, 0.12)',
    title: 'Find your next favorite',
    subtitle: 'Local kitchens and shops, delivered fresh.',
    emoji: '🍽️',
    secondaryEmoji: '🛒',
    bgColor: '#fff6f1',
    borderColor: '#fed7aa',
  },
  {
    id: 'food-delight',
    type: 'food',
    tag: 'FOOD FEAST',
    tagColor: '#9a3412',
    tagBg: 'rgba(154, 52, 18, 0.12)',
    title: 'Craving Sizzling Food?',
    subtitle: 'Hot biryanis, pizzas & curries from top kitchens.',
    emoji: '🥘',
    secondaryEmoji: '🍕',
    bgColor: '#fff1ec',
    borderColor: '#fecdd3',
    targetMode: 'restaurant',
  },
  {
    id: 'grocery-mart',
    type: 'grocery',
    tag: 'FARM FRESH',
    tagColor: '#047857',
    tagBg: 'rgba(4, 120, 87, 0.12)',
    title: 'Farm-Fresh Groceries',
    subtitle: 'Daily dairy, crisp veggies, fruits & cooking staples.',
    emoji: '🥦',
    secondaryEmoji: '🥛',
    bgColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    targetMode: 'shop',
  },
  {
    id: 'food-treats',
    type: 'food',
    tag: 'SWEET & SAVORY',
    tagColor: '#b45309',
    tagBg: 'rgba(180, 83, 9, 0.12)',
    title: 'Evening Bites & Sweets',
    subtitle: 'Crispy samosas, chai, chilled shakes & desserts.',
    emoji: '🧋',
    secondaryEmoji: '🍨',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    targetMode: 'restaurant',
  },
  {
    id: 'grocery-pantry',
    type: 'grocery',
    tag: 'PANTRY SAVINGS',
    tagColor: '#1d4ed8',
    tagBg: 'rgba(29, 78, 216, 0.12)',
    title: 'Stock Up Your Pantry',
    subtitle: 'Super-saver packaged goods, drinks & daily care.',
    emoji: '🥫',
    secondaryEmoji: '📦',
    bgColor: '#eff6ff',
    borderColor: '#bfdbfe',
    targetMode: 'shop',
  },
];

export default function CustomerApp({ session, onSignOut, onSessionUserUpdate, onRequestSignIn }: Props) {
  const [tab, setTab] = useState<Tab>('browse');
  const [mode, setMode] = useState<BrowseMode>('restaurant');
  const [dietaryFilter, setDietaryFilter] = useState<'all' | 'veg' | 'non-veg'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
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
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const customerId = getCustomerId(session?.user);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [toastInfo, setToastInfo] = useState<{ name: string; price: number } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastFadeAnim = useRef(new Animated.Value(0)).current;
  const toastTranslateAnim = useRef(new Animated.Value(15)).current;

  const showAddToCartToast = useCallback((name: string, price: number) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastInfo({ name, price });
    toastFadeAnim.setValue(0);
    toastTranslateAnim.setValue(15);
    Animated.parallel([
      Animated.timing(toastFadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslateAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    toastTimeoutRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastFadeAnim, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(toastTranslateAnim, {
          toValue: 12,
          duration: 240,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setToastInfo(null);
      });
    }, 2800);
  }, [toastFadeAnim, toastTranslateAnim]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  const brandScale = useRef(new Animated.Value(1)).current;
  const tomatoWobble = useRef(new Animated.Value(0)).current;
  const tomatoFlip = useRef(new Animated.Value(0)).current;

  function triggerBrandAnimation() {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(brandScale, {
          toValue: 0.88,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.spring(brandScale, {
          toValue: 1,
          friction: 3.5,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(tomatoWobble, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(tomatoWobble, {
          toValue: -1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(tomatoWobble, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }

  const wobbleRotation = tomatoWobble.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-14deg', '0deg', '14deg'],
  });

  const flipRotation = tomatoFlip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
    triggerBrandAnimation();
  }, []);

  useEffect(() => {
    triggerBrandAnimation();
  }, [searchFocused]);

  useEffect(() => {
    const flipInterval = setInterval(() => {
      tomatoFlip.setValue(0);
      Animated.timing(tomatoFlip, {
        toValue: 1,
        duration: 750,
        useNativeDriver: true,
      }).start();
    }, 10000);

    return () => clearInterval(flipInterval);
  }, [tomatoFlip]);

  function triggerSearchLayout() {
    try {
      if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    } catch {
      // Safe fallback if LayoutAnimation is unsupported or disabled
    }
  }

  const bannerScrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [bannerWidth, setBannerWidth] = useState(Dimensions.get('window').width - 36);

  useEffect(() => {
    if (bannerWidth <= 0) return;
    const interval = setInterval(() => {
      setActiveBannerIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % HERO_BANNERS.length;
        bannerScrollRef.current?.scrollTo({
          x: nextIndex * bannerWidth,
          animated: true,
        });
        return nextIndex;
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [bannerWidth]);

  const handleBannerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (bannerWidth <= 0) return;
    const contentOffsetX = e.nativeEvent.contentOffset.x;
    const newIndex = Math.round(contentOffsetX / bannerWidth);
    if (newIndex >= 0 && newIndex < HERO_BANNERS.length && newIndex !== activeBannerIndex) {
      setActiveBannerIndex(newIndex);
    }
  };

  const goToBanner = (index: number) => {
    setActiveBannerIndex(index);
    bannerScrollRef.current?.scrollTo({
      x: index * bannerWidth,
      animated: true,
    });
  };

  const handleBannerPress = (banner: HeroBannerItem) => {
    if (banner.targetMode && mode !== banner.targetMode) {
      selectMode(banner.targetMode);
    }
  };

  const [areaMessage, setAreaMessage] = useState('');
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const lastAlertedServiceKey = useRef<string>('');
  const [currentGpsCoords, setCurrentGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentGpsPincode, setCurrentGpsPincode] = useState<string>('');
  const [currentGpsCity, setCurrentGpsCity] = useState<string>('');
  const [isLocating, setIsLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notifications, setNotifications] = useState<CustomerNotification[]>([]);
  const [notificationsModalVisible, setNotificationsModalVisible] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [addressFormVisible, setAddressFormVisible] = useState(false);
  const [addressDropdownVisible, setAddressDropdownVisible] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState('');
  const [editingAddressId, setEditingAddressId] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [couponDropdownExpanded, setCouponDropdownExpanded] = useState(false);
  const [paymentDropdownExpanded, setPaymentDropdownExpanded] = useState(true);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('razorpay');
  const [upiId, setUpiId] = useState('');
  const [cardForm, setCardForm] = useState({
    cardNumber: '',
    cardHolder: '',
    expiry: '',
    cvv: '',
  });
  const [selectedBank, setSelectedBank] = useState('HDFC Bank');
  const [addressForm, setAddressForm] = useState({
    label: 'Home',
    line1: '',
    line2: '',
    locality: '',
    city: '',
    state: '',
    postalCode: '',
    phone: session?.user?.phone || '',
    digipin: session?.user?.digipin || '',
    coordinates: [] as number[],
  });
  const [detectingGps, setDetectingGps] = useState(false);

  const defaultAddress = useMemo(
    () => addresses.find((address) => address.isDefault) || addresses[0],
    [addresses]
  );
  const currentAddress = useMemo(() => {
    if (!session || selectedAddressId === 'current_location' || !addresses.length) {
      return undefined;
    }
    if (selectedAddressId) {
      return addresses.find((address) => address._id === selectedAddressId) || defaultAddress;
    }
    return defaultAddress;
  }, [session, addresses, selectedAddressId, defaultAddress]);

  const hasSelectedAddress = Boolean(currentAddress && selectedAddressId !== 'current_location');
  const activeCustomerPincode = useMemo(() => {
    return hasSelectedAddress && currentAddress ? getAddressPincode(currentAddress) : currentGpsPincode;
  }, [hasSelectedAddress, currentAddress, currentGpsPincode]);

  // Automatically switch to default address after login
  const prevSessionTokenRef = useRef<string | null>(session?.token || null);
  useEffect(() => {
    const currentToken = session?.token || null;
    const isNewLogin = !prevSessionTokenRef.current && Boolean(currentToken);
    prevSessionTokenRef.current = currentToken;

    if (isNewLogin) {
      void loadAddresses().then(() => {
        void loadBrowse(false);
      });
    }
  }, [session?.token]);

  useEffect(() => {
    if (session && addresses.length > 0) {
      if (!selectedAddressId || selectedAddressId === 'current_location') {
        const preferred = addresses.find((a) => a.isDefault) || addresses[0];
        if (preferred) {
          setSelectedAddressId(preferred._id);
        }
      }
    }
  }, [session, addresses]);

  const detectDeviceLocation = useCallback(async (silent = false) => {
    if (isLocating) return;
    setIsLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        if (silent) {
          setIsLocating(false);
          return;
        }
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        if (!silent) {
          Alert.alert('Location permission needed', 'Please enable location permission to view restaurants and shops near your current location.');
        }
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      setCurrentGpsCoords({ lat, lng });

      try {
        const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (reverse && reverse[0]) {
          const revPin = extractPincode(reverse[0].postalCode || '') || reverse[0].postalCode || '';
          const revCity = reverse[0].city || reverse[0].subregion || '';
          if (revPin) setCurrentGpsPincode(revPin);
          if (revCity) setCurrentGpsCity(revCity);
        }
      } catch {}
    } catch (e) {
      if (!silent) console.warn('Failed to detect device location:', e);
    } finally {
      setIsLocating(false);
    }
  }, [isLocating]);

  useEffect(() => {
    if (!selectedAddressId || selectedAddressId === 'current_location' || !addresses.length) {
      void detectDeviceLocation(true);
    }
  }, [selectedAddressId, addresses.length, detectDeviceLocation]);

  const allStores = useMemo(() => [...restaurants, ...shops], [restaurants, shops]);
  const allMenuItems = useMemo(() => [...restaurantItems, ...shopItems], [restaurantItems, shopItems]);

  const stores = mode === 'shop' ? shops : restaurants;
  const menuItems = mode === 'shop' ? shopItems : restaurantItems;

  const selectedStore = useMemo(() => {
    const found = allStores.find((store) => storeId(store) === selectedStoreId)
      || stores.find((store) => storeId(store) === selectedStoreId);
    if (found && !isStoreOpen(found)) {
      return null;
    }
    return found;
  }, [allStores, stores, selectedStoreId]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return menuItems.filter((item) => {
      const ownerStore = findStoreForItem(item, allStores);
      // When restaurant or shop is closed, do not display its items
      if (ownerStore && !isStoreOpen(ownerStore)) {
        return false;
      }
      // Filter out items whose store is not in the customer's selected address/pincode serviceable area
      if (ownerStore && !isStoreServiceableForCustomer({
        store: ownerStore,
        custPin: hasSelectedAddress ? activeCustomerPincode : undefined,
        serviceAreas,
        custCoords: currentGpsCoords,
        gpsPin: !hasSelectedAddress ? currentGpsPincode : undefined,
      })) {
        return false;
      }
      const anyItem = item as Record<string, unknown>;
      if (anyItem.isOpen === false || anyItem.isStoreOpen === false || anyItem.isOnline === false) {
        return false;
      }

      const matchesStore = !selectedStoreId || (selectedStore ? itemBelongsToStore(item, selectedStore) : (
        normalizeIdString(item.restaurantId) === normalizeIdString(selectedStoreId) ||
        (selectedStore && String((selectedStore as Store).name || '').trim().toLowerCase() === getItemStoreName(item).toLowerCase())
      ));
      if (!matchesStore) return false;

      const isVeg = isItemVeg(item);
      if (dietaryFilter === 'veg' && !isVeg) return false;
      if (dietaryFilter === 'non-veg' && isVeg) return false;

      if (selectedCategory && !itemMatchesCategory(item, selectedCategory)) {
        return false;
      }

      const storeName = (ownerStore?.name || getItemStoreName(item) || '').toLocaleLowerCase();
      const storeCuisine = (ownerStore?.cuisine || '').toLocaleLowerCase();
      const storeCategory = (ownerStore?.category || '').toLocaleLowerCase();
      const storeAddress = (ownerStore?.restaurantAddress || ownerStore?.shopAddress || ownerStore?.address || (item as any).restaurantAddress || '').toLocaleLowerCase();

      const itemName = (item.name || '').toLocaleLowerCase();
      const itemCategory = (item.category || '').toLocaleLowerCase();
      const itemDesc = (item.description || '').toLocaleLowerCase();

      const matchesSearch = !query
        || itemName.includes(query)
        || itemCategory.includes(query)
        || itemDesc.includes(query)
        || storeName.includes(query)
        || storeCuisine.includes(query)
        || storeCategory.includes(query)
        || storeAddress.includes(query);

      return matchesSearch
        && item.isActive !== false
        && item.isAvailable !== false
        && (item.quantity === undefined || item.quantity > 0);
    });
  }, [
    menuItems,
    search,
    selectedStoreId,
    selectedStore,
    allStores,
    dietaryFilter,
    selectedCategory,
    hasSelectedAddress,
    activeCustomerPincode,
    serviceAreas,
    currentGpsCoords,
    currentGpsPincode,
  ]);

  const visibleStores = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const hasCategory = Boolean(selectedCategory && selectedCategory.toLowerCase() !== 'all');

    const matchedStores: Store[] = [];
    const addedStoreKeys = new Set<string>();

    const isServiceableForCustomer = (store: Store) => {
      const activePin = hasSelectedAddress
        ? activeCustomerPincode
        : currentGpsPincode || activeCustomerPincode;
      return isStoreServiceableForCustomer({
        store,
        custPin: activePin || undefined,
        serviceAreas,
        custCoords: currentGpsCoords,
        gpsPin: !hasSelectedAddress ? currentGpsPincode : undefined,
      });
    };

    const addStore = (store: Store) => {
      // Must be currently open and approved
      if (!isStoreOpen(store)) return;
      if (store.isServiceable === false) return;
      if (!isServiceableForCustomer(store)) return;
      const key = (normalizeIdString(store._id || store.id) || String(store.name || '').trim().toLowerCase());
      if (!key || addedStoreKeys.has(key)) return;
      addedStoreKeys.add(key);
      matchedStores.push(store);
    };

    const sortStoresByProximity = (list: Store[]) => {
      if (!hasSelectedAddress && currentGpsCoords) {
        return [...list].sort((a, b) => {
          const coordsA = getStoreCoordinates(a);
          const coordsB = getStoreCoordinates(b);
          const distA = coordsA ? calculateDistanceKm(currentGpsCoords.lat, currentGpsCoords.lng, coordsA.lat, coordsA.lng) : (a.distanceKm ?? 999);
          const distB = coordsB ? calculateDistanceKm(currentGpsCoords.lat, currentGpsCoords.lng, coordsB.lat, coordsB.lng) : (b.distanceKm ?? 999);
          return distA - distB;
        });
      }
      return list;
    };

    const storePassesDietary = (store: Store) => {
      if (dietaryFilter === 'all') return true;
      const { hasVeg, hasNonVeg } = getStoreDietary(store, menuItems);
      if (dietaryFilter === 'veg' && !hasVeg) return false;
      if (dietaryFilter === 'non-veg' && !hasNonVeg) return false;
      return true;
    };

    // 1. When category is selected (and no search query):
    if (hasCategory && !query) {
      // (A) Check stores in current mode
      for (const store of stores) {
        if (!isStoreOpen(store)) continue;
        if (!storePassesDietary(store)) continue;
        if (storeMatchesCategory(store, selectedCategory, menuItems)) {
          addStore(store);
        }
      }

      // (B) Check allStores (to include stores across all lists regardless of distance filter)
      for (const store of allStores) {
        if (!isStoreOpen(store)) continue;
        if (!storePassesDietary(store)) continue;
        if (storeMatchesCategory(store, selectedCategory, allMenuItems)) {
          addStore(store);
        }
      }

      // (C) For every matching menu item in visibleItems, add its selling store!
      for (const item of visibleItems) {
        const owner = findStoreForItem(item, allStores);
        if (owner && isStoreOpen(owner) && storePassesDietary(owner)) {
          addStore(owner);
        }
      }

      // (D) Also check allMenuItems: any open restaurant selling an item in this category is guaranteed to appear!
      for (const item of allMenuItems) {
        const owner = findStoreForItem(item, allStores);
        if (!owner || !isStoreOpen(owner)) continue;
        if (dietaryFilter === 'veg' && !isItemVeg(item)) continue;
        if (dietaryFilter === 'non-veg' && isItemVeg(item)) continue;
        if (!itemMatchesCategory(item, selectedCategory)) continue;

        if (storePassesDietary(owner)) {
          addStore(owner);
        }
      }

      return sortStoresByProximity(matchedStores);
    }

    // 2. When NOT searching and NO category selected:
    if (!query) {
      const filtered = stores.filter((store) => {
        if (!isStoreOpen(store)) return false;
        if (store.isServiceable === false) return false;
        if (!isServiceableForCustomer(store)) return false;
        return storePassesDietary(store);
      });
      return sortStoresByProximity(filtered);
    }

    // 3. When searching (with or without category):
    // (A) Check stores in current mode whose name, cuisine, category, or address matches query
    for (const store of stores) {
      if (!isStoreOpen(store)) continue;
      if (!storePassesDietary(store)) continue;
      if (hasCategory && !storeMatchesCategory(store, selectedCategory, menuItems)) continue;

      const storeName = (store.name || '').toLocaleLowerCase();
      const storeCuisine = (store.cuisine || '').toLocaleLowerCase();
      const storeCategory = (store.category || '').toLocaleLowerCase();
      const storeAddress = (store.restaurantAddress || store.shopAddress || store.address || '').toLocaleLowerCase();

      if (
        storeName.includes(query) ||
        storeCuisine.includes(query) ||
        storeCategory.includes(query) ||
        storeAddress.includes(query)
      ) {
        addStore(store);
      }
    }

    // (B) For every matching menu item in visibleItems, add its selling store!
    for (const item of visibleItems) {
      const owner = findStoreForItem(item, allStores);
      if (owner && isStoreOpen(owner) && storePassesDietary(owner)) {
        addStore(owner);
      }
    }

    // (C) Also check allStores if any open store sells any item in allMenuItems matching query
    for (const store of allStores) {
      if (!isStoreOpen(store)) continue;
      if (!storePassesDietary(store)) continue;
      if (hasCategory && !storeMatchesCategory(store, selectedCategory, allMenuItems)) continue;

      const key = (normalizeIdString(store._id || store.id) || String(store.name || '').trim().toLowerCase());
      if (addedStoreKeys.has(key)) continue;

      const sellsMatchingItem = allMenuItems.some((item) => {
        if (!itemBelongsToStore(item, store)) return false;
        if (dietaryFilter === 'veg' && !isItemVeg(item)) return false;
        if (dietaryFilter === 'non-veg' && isItemVeg(item)) return false;
        if (hasCategory && !itemMatchesCategory(item, selectedCategory)) return false;
        const itemName = (item.name || '').toLocaleLowerCase();
        const itemCategory = (item.category || '').toLocaleLowerCase();
        const itemDesc = (item.description || '').toLocaleLowerCase();
        return (
          itemName.includes(query) ||
          itemCategory.includes(query) ||
          itemDesc.includes(query)
        );
      });

      if (sellsMatchingItem) {
        addStore(store);
      }
    }

    return sortStoresByProximity(matchedStores);
  }, [
    search,
    stores,
    allStores,
    menuItems,
    allMenuItems,
    visibleItems,
    dietaryFilter,
    mode,
    selectedCategory,
    hasSelectedAddress,
    activeCustomerPincode,
    serviceAreas,
    currentGpsCoords,
    currentGpsPincode,
  ]);

  const displayedCategories = useMemo(() => {
    const defaultList = mode === 'shop'
      ? ['Groceries', 'Dairy & Eggs', 'Snacks', 'Beverage', 'Packaged Goods', 'Sweets', 'Fruits & Veg']
      : ['Main Course', 'Chinese', 'Biryani', 'Pizza', 'Snacks', 'Beverage', 'Sweets', 'Breads'];

    const dynamicSet = new Set<string>();
    for (const item of menuItems) {
      if (item.category && item.category.trim()) {
        dynamicSet.add(item.category.trim());
      }
    }

    const combined: string[] = ['All'];
    for (const name of defaultList) {
      combined.push(name);
    }
    for (const name of dynamicSet) {
      if (!combined.some((c) => c.toLowerCase() === name.toLowerCase())) {
        combined.push(name);
      }
    }

    const findImageForCategory = (catName: string): string => {
      if (catName === 'All') return '';
      const found = menuItems.find((item) => Boolean(item.image) && itemMatchesCategory(item, catName))
        || allMenuItems.find((item) => Boolean(item.image) && itemMatchesCategory(item, catName));
      return found?.image || '';
    };

    return combined.map((name) => ({
      id: name,
      name,
      icon: name === 'All' ? (mode === 'shop' ? '🛍️' : '✨') : getCategoryIcon(name, mode),
      image: findImageForCategory(name),
    }));
  }, [mode, menuItems, allMenuItems]);
  const defaultPostalCode = activeCustomerPincode || defaultAddress?.postalCode || session?.user?.pincode || session?.user?.postalCode || '';
  const subtotal = useMemo(
    () => cart.reduce((total, item) => total + Number(item.price) * item.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(
    () => cart.reduce((count, item) => count + item.quantity, 0),
    [cart],
  );
  const couponDiscount = couponValidation?.valid ? Number(couponValidation.totalDiscount || 0) : 0;
  const estimatedTotal = subtotal ? Math.max(0, subtotal + subtotal * 0.05 + 40 - couponDiscount) : 0;

  const cartStore = useMemo(() => {
    if (!cart.length) return undefined;
    const firstItem = cart[0];
    return allStores.find((store) => {
      const ids = getStoreIds(store);
      return ids.includes(normalizeIdString(firstItem.restaurantId)) || itemBelongsToStore(firstItem, store);
    }) || allStores.find((store) => storeId(store) === firstItem.restaurantId);
  }, [cart, allStores]);

  const cartCustPin = useMemo(() => getAddressPincode(currentAddress), [currentAddress]);
  const cartStorePin = useMemo(() => getStorePincode(cartStore, cart[0]), [cartStore, cart]);

  const cartServiceability: ServiceAreaCheckResult = useMemo(() => {
    if (!cart.length || !currentAddress) {
      return { isServiceable: true, custPin: cartCustPin, storePin: cartStorePin };
    }
    return checkServiceAreaMatch({
      custPin: cartCustPin,
      storePin: cartStorePin,
      serviceAreas,
      isStoreServiceable: cartStore?.isServiceable,
      areaMessage,
    });
  }, [cart, currentAddress, cartCustPin, cartStorePin, cartStore, serviceAreas, areaMessage]);

  const showTooFarPopup = useCallback((checkResult?: ServiceAreaCheckResult) => {
    const res = checkResult || cartServiceability;
    const cust = res.custPin || 'N/A';
    const store = res.storePin || 'N/A';
    Alert.alert(
      'Restaurant is too far',
      `Customer selected address pincode (${cust}) and restaurant pincode (${store}) are not in the same serviceable area list pincode.\n\nPayment is not allowed before updating the address and pincode to a serviceable location. Please update your delivery address or choose another restaurant.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update Address',
          style: 'default',
          onPress: () => {
            setTab('addresses');
            setAddressFormVisible(true);
          },
        },
      ],
    );
  }, [cartServiceability]);

  useEffect(() => {
    apiRequest<{ pincodes?: string[]; adminZones?: any }>(
      '/api/customer/serviceable-pincodes',
    )
      .then((res) => {
        let apiAreas: ServiceArea[] = [];
        if (Array.isArray(res?.adminZones)) {
          apiAreas = res.adminZones
            .map((zone: any, idx: number) => ({
              id: zone.adminId || `zone-${idx}`,
              name: zone.adminName || zone.name || `Admin Zone ${idx + 1}`,
              pincodes: Array.isArray(zone.pincodes)
                ? zone.pincodes
                    .map((p: any) => extractPincode(p) || String(p).trim())
                    .filter(Boolean)
                : [],
              createdAt: new Date().toISOString(),
            }))
            .filter((a: ServiceArea) => a.pincodes.length > 0);
        } else if (res?.adminZones && typeof res.adminZones === 'object') {
          apiAreas = Object.entries(res.adminZones)
            .map(([zoneName, pins]) => ({
              id: `zone-${zoneName}`,
              name: zoneName,
              pincodes: Array.isArray(pins)
                ? (pins as any[])
                    .map((p: any) => extractPincode(p) || String(p).trim())
                    .filter(Boolean)
                : [],
              createdAt: new Date().toISOString(),
            }))
            .filter((a: ServiceArea) => a.pincodes.length > 0);
        }
        if (apiAreas.length === 0 && Array.isArray(res?.pincodes) && res.pincodes.length > 0) {
          const cleanPins = res.pincodes
            .map((p: any) => extractPincode(p) || String(p).trim())
            .filter(Boolean);
          apiAreas = [
            {
              id: 'zone-default',
              name: 'Primary Service Zone',
              pincodes: cleanPins,
              createdAt: new Date().toISOString(),
            },
          ];
        }
        if (apiAreas.length > 0) {
          setServiceAreas(apiAreas);
          void persistServiceAreas(apiAreas);
        }
      })
      .catch(() => {
        void loadStoredServiceAreas().then((stored) => {
          if (stored && stored.length > 0) {
            setServiceAreas(stored);
          }
        });
      });
  }, [tab]);

  useEffect(() => {
    if (tab === 'cart' && cart.length > 0 && currentAddress && !cartServiceability.isServiceable) {
      const alertKey = `${currentAddress._id}_${cartStore?._id || cart[0]?.restaurantId}_${cartServiceability.custPin}_${cartServiceability.storePin}`;
      if (lastAlertedServiceKey.current !== alertKey) {
        lastAlertedServiceKey.current = alertKey;
        setError(cartServiceability.reason || 'Restaurant is too far: Customer selected address pincode and restaurant pincode are not in the same serviceable area list pincode.');
        showTooFarPopup(cartServiceability);
      }
    }
  }, [tab, cart.length, currentAddress, cartStore?._id, cartServiceability, showTooFarPopup]);

  async function loadBrowse(
    showSpinner = true,
    customPin?: string,
    customCoords?: { lat: number; lng: number } | null,
  ) {
    if (showSpinner) setLoading(true);
    setError('');

    const targetPin =
      customPin !== undefined
        ? customPin
        : hasSelectedAddress && currentAddress
          ? getAddressPincode(currentAddress)
          : currentGpsPincode;

    const targetCoords =
      customCoords !== undefined
        ? customCoords
        : hasSelectedAddress &&
            currentAddress &&
            Array.isArray(currentAddress.coordinates) &&
            currentAddress.coordinates.length === 2
          ? { lat: currentAddress.coordinates[1], lng: currentAddress.coordinates[0] }
          : currentGpsCoords;

    const targetDigipin =
      hasSelectedAddress && currentAddress?.digipin ? currentAddress.digipin : '';

    const queryParts: string[] = [];
    if (targetPin) queryParts.push(`pincode=${encodeURIComponent(targetPin)}`);
    if (targetCoords) {
      queryParts.push(`lat=${encodeURIComponent(targetCoords.lat)}`);
      queryParts.push(`lng=${encodeURIComponent(targetCoords.lng)}`);
    }
    if (targetDigipin) queryParts.push(`digipin=${encodeURIComponent(targetDigipin)}`);
    const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';

    try {
      const [restaurantResult, shopResult, restaurantMenu, shopMenu] = await Promise.all([
        apiRequest<{ restaurants: Store[]; isServiceable?: boolean; message?: string }>(
          `/api/customer/restaurants${queryString}`,
          session?.token,
        ),
        apiRequest<{ shops: Store[]; isServiceable?: boolean; message?: string }>(
          `/api/customer/shops${queryString}`,
          session?.token,
        ),
        apiRequest<{ menu: MenuItem[] }>(
          `/api/customer/menu?type=restaurant${targetPin ? `&pincode=${encodeURIComponent(targetPin)}` : ''}`,
          session?.token,
        ),
        apiRequest<{ menu: MenuItem[] }>(
          `/api/customer/menu?type=shop${targetPin ? `&pincode=${encodeURIComponent(targetPin)}` : ''}`,
          session?.token,
        ),
      ]);
      setRestaurants(restaurantResult.restaurants || []);
      setShops(shopResult.shops || []);
      setAreaMessage(
        restaurantResult.isServiceable || shopResult.isServiceable
          ? ''
          : restaurantResult.message || shopResult.message || '',
      );
      setRestaurantItems(restaurantMenu.menu || []);
      setShopItems(shopMenu.menu || []);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (tab === 'browse' || tab === 'cart') {
      void loadBrowse(false);
    }
  }, [activeCustomerPincode, currentGpsCoords?.lat, currentGpsCoords?.lng, selectedAddressId, tab]);

  async function loadAddresses() {
    if (!session?.token) {
      setAddresses([]);
      return;
    }
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
    if (!session?.token) {
      setOrders([]);
      return;
    }
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
    if (bills[orderId]) {
      setBills((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      return;
    }
    setBillBusyId(orderId);
    setError('');
    try {
      const result = await apiRequest<{ bill: Bill }>(
        `/api/customer/orders/${encodeURIComponent(orderId)}/bill`,
        session?.token,
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
      const result = await apiRequest<{ coupons?: Coupon[] }>('/api/customer/coupons', session?.token);
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
      const result = await apiRequest<CouponValidation>('/api/customer/coupons/validate', session?.token, {
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
    if (trackingByOrder[orderId]) {
      setTrackingByOrder((current) => {
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      if (trackingOrderId === orderId) setTrackingOrderId('');
      return;
    }
    const order = orders.find((o) => o._id === orderId);
    const normalizedStatus = (order?.status || 'placed').toLowerCase().trim();
    if (['placed', 'pending'].includes(normalizedStatus)) {
      Alert.alert(
        'Order not yet accepted',
        `The ${order?.isShopOrder ? 'shop' : 'restaurant'} has not accepted this order yet. Live tracking will be enabled as soon as the order is accepted.`,
      );
      return;
    }

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
        session?.token,
      );
      if (!result.tracking) {
        throw new Error('Tomato did not return tracking details for this order.');
      }
      setTrackingByOrder((current) => ({
        ...current,
        [orderId]: {
          ...result.tracking,
          returnAccepted: result.tracking.returnAccepted ?? order?.returnAccepted,
          returnStatus: result.tracking.returnStatus ?? order?.returnStatus,
          returnAcceptedBy: result.tracking.returnAcceptedBy ?? order?.returnAcceptedBy,
        },
      }));
    } catch (reason) {
      if (normalizedStatus === 'cancelled') {
        // Keep active return tracking visible for cancelled orders
        setTrackingByOrder((current) => ({
          ...current,
          [orderId]: {
            orderId,
            orderNumber: order?.orderNumber,
            status: 'cancelled',
            returnStatus: order?.returnStatus || 'in_transit',
            returnAccepted: order?.returnAccepted || false,
            returnAcceptedBy: order?.returnAcceptedBy,
            trackingClosed: Boolean(order?.returnAccepted || order?.returnStatus === 'accepted'),
          },
        }));
      } else {
        const message = getErrorMessage(reason);
        setTrackingErrors((current) => ({ ...current, [orderId]: message }));
        setError(message);
      }
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
        session?.token,
        {
          method: 'POST',
          body: JSON.stringify({
            rating: reviewRating,
            comment: reviewComment.trim(),
            name: session?.user?.name || '',
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
    setNotificationsModalVisible(true);
    setLoadingNotifications(true);
    try {
      const result = await apiRequest<{ notifications: CustomerNotification[] }>(
        '/api/customer/notifications',
        session?.token,
      );
      setNotifications(result.notifications || []);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setLoadingNotifications(false);
    }
  }

  useEffect(() => {
    void loadBrowse();
    void loadAddresses();
    void loadOrders();
  }, [session?.token]);

  useEffect(() => {
    if (tab === 'orders') void loadOrders();
    if (tab === 'addresses') void loadAddresses();
    if (tab === 'cart') void loadAvailableCoupons();
  }, [tab, session?.token]);

  useEffect(() => {
    if (tab !== 'orders' || !session?.token) return;
    const interval = setInterval(() => void loadOrders(), 20_000);
    return () => clearInterval(interval);
  }, [tab, session?.token]);

  useEffect(() => {
    if (tab !== 'orders' || !trackingOrderId) return;
    const trackedOrder = orders.find((o) => o._id === trackingOrderId);
    const trackingInfo = trackingByOrder[trackingOrderId];
    if (trackedOrder && !isOrderTrackingActive(trackedOrder, trackingInfo)) return;
    if (trackingInfo?.trackingClosed) return;

    const interval = setInterval(async () => {
      try {
        const result = await apiRequest<{ tracking: OrderTracking }>(
          `/api/customer/orders/${encodeURIComponent(trackingOrderId)}/live-tracking`,
          session?.token,
        );
        if (result.tracking) {
          setTrackingByOrder((current) => ({
            ...current,
            [trackingOrderId]: {
              ...result.tracking,
              returnAccepted: result.tracking.returnAccepted ?? trackedOrder?.returnAccepted,
              returnStatus: result.tracking.returnStatus ?? trackedOrder?.returnStatus,
              returnAcceptedBy: result.tracking.returnAcceptedBy ?? trackedOrder?.returnAcceptedBy,
            },
          }));
          setTrackingErrors((current) => {
            const next = { ...current };
            delete next[trackingOrderId];
            return next;
          });
        }
      } catch (reason) {
        if ((trackedOrder?.status || '').toLowerCase() !== 'cancelled') {
          const message = getErrorMessage(reason);
          setTrackingErrors((current) => ({ ...current, [trackingOrderId]: message }));
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [tab, trackingOrderId, trackingByOrder[trackingOrderId]?.trackingClosed, orders, session?.token]);



  function selectMode(nextMode: BrowseMode) {
    setMode(nextMode);
    setSelectedStoreId('');
    setSelectedCategory('');
    setSearch('');
  }

  function addItem(item: MenuItem, variant?: ItemVariant) {
    const itemStore = findStoreForItem(item, allStores);
    if (itemStore && !isStoreOpen(itemStore)) {
      Alert.alert('Store closed', `${itemStore.name || 'This store'} is currently closed and not accepting orders.`);
      return;
    }

    const itemStoreType = item.storeType || (item.isShopItem ? 'shop' : mode);
    const otherStoreInCart = cart.find((line) =>
      line.restaurantId !== item.restaurantId
      || (line.storeType || (line.isShopItem ? 'shop' : mode)) !== itemStoreType,
    );

    const lineId = variant ? `${item._id}::${variant.id}` : item._id;
    const lineName = variant ? `${item.name} (${variant.name})` : item.name;
    const linePrice = variant ? variant.price : item.price;

    const cartLinePayload: CartLine = {
      ...item,
      _id: lineId,
      name: lineName,
      price: linePrice,
      storeType: itemStoreType,
      availableQuantity: item.quantity,
      selectedVariant: variant,
      quantity: 1,
    };

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
              setCart([cartLinePayload]);
              showAddToCartToast(lineName, linePrice);
            },
          },
        ],
      );
      return;
    }

    const existing = cart.find((line) => line._id === lineId);
    if (existing && item.quantity !== undefined && existing.quantity >= item.quantity) {
      Alert.alert('Stock limit reached', `Only ${item.quantity} of this item are currently available.`);
      return;
    }
    setCouponValidation(null);
    setCart((current) => {
      if (!existing) {
        return [...current, cartLinePayload];
      }
      return current.map((line) => line._id === lineId
        ? { ...line, quantity: line.quantity + 1 }
        : line);
    });
    showAddToCartToast(lineName, linePrice);
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

  async function detectCurrentGpsLocation() {
    setDetectingGps(true);
    setError('');
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Location permission is required to detect your current GPS location.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const lat = Number(position.coords.latitude.toFixed(6));
      const lng = Number(position.coords.longitude.toFixed(6));

      let geocodedCity = '';
      let geocodedPostal = '';
      let geocodedArea = '';
      try {
        const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (reverse && reverse[0]) {
          geocodedCity = reverse[0].city || reverse[0].subregion || '';
          geocodedPostal = reverse[0].postalCode || '';
          geocodedArea = reverse[0].district || reverse[0].street || '';
        }
      } catch {}

      setAddressForm((form) => ({
        ...form,
        coordinates: [lng, lat],
        city: form.city || geocodedCity,
        postalCode: form.postalCode || geocodedPostal,
        locality: form.locality || geocodedArea,
      }));

      Alert.alert(
        'GPS Location Detected',
        `Current GPS location (${lat.toFixed(5)}, ${lng.toFixed(5)}) set for delivery. If you have not set a DIGIPIN, your delivery rider will navigate using this GPS location.`,
      );
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setDetectingGps(false);
    }
  }

  async function saveAddress() {
    if (!addressForm.line1.trim() || !addressForm.city.trim() || !addressForm.postalCode.trim()) {
      setError('Enter a street address, city, and postal code.');
      return;
    }
    const cleanDigipin = normalizeDigipin(addressForm.digipin);
    if (cleanDigipin && !isValidDigipin(cleanDigipin)) {
      setError('Enter a valid delivery DIGIPIN (e.g. 10 alphanumeric characters).');
      return;
    }

    const pin = extractPincode(addressForm.postalCode) || addressForm.postalCode.trim();
    if (!pin || pin.length < 5) {
      setError('Enter a valid postal pincode (e.g. 6 digits).');
      return;
    }

    // Follow the rule of serviceable area list pincode:
    if (serviceAreas.length > 0) {
      const allPins = getAllServiceablePincodes(serviceAreas);
      if (allPins.length > 0 && !allPins.includes(pin)) {
        const errorMsg = `Pincode ${pin} is outside Tomato's serviceable areas. Please enter an address with a serviceable pincode (${allPins.join(', ')}).`;
        setError(errorMsg);
        Alert.alert('Address Outside Serviceable Area', errorMsg, [{ text: 'OK' }]);
        return;
      }
    }

    // If there is an active item in cart, verify it matches the restaurant serviceable area
    if (cart.length > 0 && cartStore) {
      const storePin = getStorePincode(cartStore, cart[0]);
      const match = checkServiceAreaMatch({
        custPin: pin,
        storePin,
        serviceAreas,
        isStoreServiceable: cartStore.isServiceable,
      });
      if (!match.isServiceable) {
        const errorMsg = `Restaurant is too far: The entered address pincode (${pin}) and restaurant pincode (${storePin || 'N/A'}) are not in the same serviceable area list pincode.`;
        setError(errorMsg);
        Alert.alert(
          'Restaurant is too far',
          `${errorMsg}\n\nPlease enter an address within the restaurant's serviceable area or choose another restaurant.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    if (!session?.token) {
      setError('Please login first to save your delivery address.');
      if (onRequestSignIn) onRequestSignIn();
      return;
    }

    setSavingAddress(true);
    setError('');
    try {
      const existingAddress = editingAddressId
        ? addresses.find((address) => address._id === editingAddressId)
        : undefined;
      const decodedFromDigipin = cleanDigipin ? decodeDigipin(cleanDigipin) : null;
      const coords = decodedFromDigipin
        ? [decodedFromDigipin.lng, decodedFromDigipin.lat]
        : addressForm.coordinates?.length === 2
          ? addressForm.coordinates
          : existingAddress?.coordinates || existingAddress?.location?.coordinates || [];

      const savedRes = await apiRequest<{ address: Address }>(
        editingAddressId
          ? `/api/customer/addresses/${editingAddressId}`
          : '/api/customer/addresses',
        session.token,
        {
          method: editingAddressId ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...addressForm,
            postalCode: pin,
            label: addressForm.label.trim() || 'Home',
            digipin: cleanDigipin,
            coordinates: coords,
            location: coords.length === 2 ? { type: 'Point', coordinates: coords } : undefined,
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
        phone: session?.user?.phone || '',
        digipin: session?.user?.digipin || '',
        coordinates: [],
      });
      setAddressFormVisible(false);
      setEditingAddressId('');
      if (savedRes?.address?._id) {
        setSelectedAddressId(savedRes.address._id);
      }
      await loadAddresses();
      await loadBrowse(false);
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setSavingAddress(false);
    }
  }

  async function setDefaultAddress(addressId: string) {
    if (!session?.token) {
      if (onRequestSignIn) onRequestSignIn();
      return;
    }
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

  async function chooseDefaultAddress(addressId: string) {
    setSettingDefaultId(addressId);
    try {
      await setDefaultAddress(addressId);
      setAddressDropdownVisible(false);
    } finally {
      setSettingDefaultId('');
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
      phone: address.phone || session?.user?.phone || '',
      digipin: address.digipin || '',
      coordinates: address.coordinates || address.location?.coordinates || [],
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
          if (!session?.token) return;
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

  function checkCurrentLocationServiceability(): { isServiceable: boolean; reason?: string } {
    const cleanGpsPin = extractPincode(currentGpsPincode) || currentGpsPincode.trim();
    if (!cleanGpsPin) {
      return { isServiceable: true };
    }

    if (cartStore) {
      const storePin = getStorePincode(cartStore, cart[0]);
      const match = checkServiceAreaMatch({
        custPin: cleanGpsPin,
        storePin,
        serviceAreas,
        isStoreServiceable: cartStore.isServiceable,
        areaMessage,
      });
      if (!match.isServiceable) {
        return {
          isServiceable: false,
          reason: `Your location is out of serviceable area: Current location pincode (${cleanGpsPin}) and restaurant pincode (${storePin || 'N/A'}) are not in the same serviceable area list pincode.`,
        };
      }
    }

    if (serviceAreas.length > 0) {
      const allPins = getAllServiceablePincodes(serviceAreas);
      if (allPins.length > 0 && !allPins.includes(cleanGpsPin)) {
        return {
          isServiceable: false,
          reason: `Your location is out of serviceable area: Current location pincode (${cleanGpsPin}) is not in the serviceable area list pincode (${allPins.join(', ')}).`,
        };
      }
    }

    return { isServiceable: true };
  }

  function startPaymentFlow() {
    if (!cart.length) return;

    // Check if current location pincode is not in the serviceable area list pincode
    if (!hasSelectedAddress || !session) {
      const locCheck = checkCurrentLocationServiceability();
      if (!locCheck.isServiceable) {
        const msg = locCheck.reason || `Your location is out of serviceable area. Current location pincode (${currentGpsPincode || 'N/A'}) is not in the serviceable area list pincode.`;
        setError(msg);
        Alert.alert(
          'Location Out of Serviceable Area',
          `${msg}\n\nPayment is not allowed before updating your location to a serviceable area.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Check if customer is attempting payment before login
    if (!session) {
      const loginMsg = 'Please login first before making payment.';
      setError(loginMsg);
      Alert.alert(
        'Please login first',
        'You must sign in to your Tomato account to proceed with payment and complete your order.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign in / Register',
            style: 'default',
            onPress: () => {
              if (onRequestSignIn) {
                onRequestSignIn();
              }
            },
          },
        ]
      );
      return;
    }

    // Check if delivery address is not set
    if (!currentAddress || selectedAddressId === 'current_location' || !addresses.length) {
      const addrMsg = 'Please add a delivery address before making payment.';
      setError(addrMsg);
      Alert.alert(
        'Delivery Address Required',
        'Your delivery address is not set. Please add a delivery address to complete your order. Note: The address must follow the rule of our serviceable area list pincodes.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add Address',
            style: 'default',
            onPress: () => {
              setTab('addresses');
              setEditingAddressId('');
              setAddressForm({
                label: 'Home',
                line1: '',
                line2: '',
                locality: currentGpsCity || '',
                city: currentGpsCity || '',
                state: '',
                postalCode: currentGpsPincode || '',
                phone: session?.user?.phone || '',
                digipin: session?.user?.digipin || '',
                coordinates: currentGpsCoords ? [currentGpsCoords.lng, currentGpsCoords.lat] : [],
              });
              setAddressFormVisible(true);
            },
          },
        ]
      );
      return;
    }

    if (!cartServiceability.isServiceable) {
      const msg = cartServiceability.reason || 'Restaurant is too far: Customer selected address pincode and restaurant pincode are not in the same serviceable area list pincode.';
      setError(msg);
      showTooFarPopup(cartServiceability);
      return;
    }
    setError('');
    setPaymentModalVisible(true);
  }

  async function placeOrder() {
    if (!cart.length) return;

    // Check if current location pincode is not in the serviceable area list pincode
    if (!hasSelectedAddress || !session) {
      const locCheck = checkCurrentLocationServiceability();
      if (!locCheck.isServiceable) {
        const msg = locCheck.reason || `Your location is out of serviceable area. Current location pincode (${currentGpsPincode || 'N/A'}) is not in the serviceable area list pincode.`;
        setError(msg);
        Alert.alert(
          'Location Out of Serviceable Area',
          `${msg}\n\nPayment is not allowed before updating your location to a serviceable area.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Check if customer is attempting payment before login
    if (!session) {
      const loginMsg = 'Please login first before making payment.';
      setError(loginMsg);
      Alert.alert(
        'Please login first',
        'You must sign in to your Tomato account to proceed with payment and complete your order.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign in / Register',
            style: 'default',
            onPress: () => {
              if (onRequestSignIn) {
                onRequestSignIn();
              }
            },
          },
        ]
      );
      return;
    }

    // Check if delivery address is not set
    if (!currentAddress || selectedAddressId === 'current_location' || !addresses.length) {
      const addrMsg = 'Please add a delivery address before making payment.';
      setError(addrMsg);
      Alert.alert(
        'Delivery Address Required',
        'Your delivery address is not set. Please add a delivery address to complete your order. Note: The address must follow the rule of our serviceable area list pincodes.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Add Address',
            style: 'default',
            onPress: () => {
              setTab('addresses');
              setEditingAddressId('');
              setAddressForm({
                label: 'Home',
                line1: '',
                line2: '',
                locality: currentGpsCity || '',
                city: currentGpsCity || '',
                state: '',
                postalCode: currentGpsPincode || '',
                phone: session?.user?.phone || '',
                digipin: session?.user?.digipin || '',
                coordinates: currentGpsCoords ? [currentGpsCoords.lng, currentGpsCoords.lat] : [],
              });
              setAddressFormVisible(true);
            },
          },
        ]
      );
      return;
    }

    if (!cartServiceability.isServiceable) {
      const msg = cartServiceability.reason || 'Restaurant is too far: Customer selected address pincode and restaurant pincode are not in the same serviceable area list pincode.';
      setError(msg);
      showTooFarPopup(cartServiceability);
      return;
    }
    if (selectedPaymentMethod === 'cod') {
      const txn = `COD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      await completeOrderWithPayment({
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        paymentTransactionId: txn,
      });
      return;
    }
    startPaymentFlow();
  }

  async function completeOrderWithPayment(paymentDetails: PaymentSuccessDetails) {
    if (!cart.length || !currentAddress || !session?.token) return;
    if (!cartServiceability.isServiceable) {
      const msg = cartServiceability.reason || 'Restaurant is too far: Customer selected address pincode and restaurant pincode are not in the same serviceable area list pincode.';
      setError(msg);
      showTooFarPopup(cartServiceability);
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
            paymentMethod: paymentDetails.paymentMethod,
            paymentStatus: paymentDetails.paymentStatus,
            paymentTransactionId: paymentDetails.paymentTransactionId,
            paidAt: paymentDetails.paymentStatus === 'paid' ? new Date().toISOString() : undefined,
            ...(paymentDetails.razorpayPaymentId ? { razorpayPaymentId: paymentDetails.razorpayPaymentId } : {}),
            ...(paymentDetails.razorpayOrderId ? { razorpayOrderId: paymentDetails.razorpayOrderId } : {}),
            ...(paymentDetails.razorpaySignature ? { razorpaySignature: paymentDetails.razorpaySignature } : {}),
            ...(paymentDetails.utrNumber ? { utrNumber: paymentDetails.utrNumber, utrReference: paymentDetails.utrNumber } : {}),
            ...(paymentDetails.upiId ? { upiId: paymentDetails.upiId } : {}),
            ...(paymentDetails.cardLast4 ? { cardLast4: paymentDetails.cardLast4 } : {}),
            ...(paymentDetails.bankName ? { bankName: paymentDetails.bankName } : {}),
            ...(validatedCouponCode ? { couponCodes: [validatedCouponCode] } : {}),
            addressId: currentAddress._id,
            ...(() => {
              const resolvedCustDigipin = resolveCustomerDigipin(currentAddress) || normalizeDigipin(session?.user?.digipin);
              const decodedCust = resolvedCustDigipin ? decodeDigipin(resolvedCustDigipin) : null;
              const targetCoords = decodedCust
                ? [decodedCust.lng, decodedCust.lat]
                : (Array.isArray(currentAddress.coordinates) && currentAddress.coordinates.length === 2)
                  ? currentAddress.coordinates
                  : currentAddress.location?.coordinates || [];

              return {
                customerDigipin: resolvedCustDigipin || undefined,
                digipin: resolvedCustDigipin || undefined,
                deliveryAddress: {
                  label: currentAddress.label || 'Home',
                  phone: currentAddress.phone || session?.user?.phone || '',
                  line1: currentAddress.line1,
                  line2: currentAddress.line2 || '',
                  locality: currentAddress.locality || '',
                  city: currentAddress.city,
                  state: currentAddress.state || '',
                  postalCode: currentAddress.postalCode,
                  digipin: resolvedCustDigipin || '',
                  coordinates: targetCoords,
                  location: targetCoords.length === 2 ? { type: 'Point', coordinates: targetCoords } : undefined,
                },
              };
            })(),
          }),
        },
      );
      setPaymentModalVisible(false);
      setCart([]);
      setCouponCode('');
      setCouponValidation(null);
      setBills((current) => {
        const next = { ...current };
        if (result?.order?._id) {
          delete next[result.order._id];
        }
        return next;
      });
      setTab('orders');
      void loadOrders();
      const paymentLabel = paymentDetails.paymentMethod === 'cod'
        ? 'Cash on delivery'
        : paymentDetails.paymentMethod === 'razorpay'
          ? `Razorpay (${paymentDetails.razorpayPaymentId || paymentDetails.paymentTransactionId})`
          : paymentDetails.paymentMethod === 'upi'
            ? `UPI${paymentDetails.upiId ? ` (${paymentDetails.upiId})` : ''}`
            : paymentDetails.paymentMethod === 'card'
              ? 'Credit/Debit Card'
              : `Net Banking (${paymentDetails.bankName || selectedBank})`;
      Alert.alert(
        paymentDetails.paymentStatus === 'paid' ? 'Payment Confirmed & Order Placed' : 'Order Placed',
        `${result?.order?.orderNumber || 'Your order'} has been placed with ${selectedStore?.name || 'Tomato'}${validatedCouponCode ? ` using coupon ${validatedCouponCode}` : ''}.\n\nPayment Mode: ${paymentLabel}\nStatus: ${paymentDetails.paymentStatus.toUpperCase()}\nTransaction ID: ${paymentDetails.paymentTransactionId}`,
      );
    } catch (reason) {
      setError(getErrorMessage(reason));
      throw reason;
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
    setLogoutModalVisible(true);
  }

  async function performSignOut() {
    let revokeError = '';
    setIsLoggingOut(true);
    try {
      if (session?.token) {
        await apiRequest('/api/auth/logout', session.token, { method: 'POST' });
      }
    } catch (reason) {
      revokeError = getErrorMessage(reason);
    } finally {
      setIsLoggingOut(false);
      setLogoutModalVisible(false);
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
      <GlobalHeader
        session={session}
        onRequestSignIn={onRequestSignIn}
        onBrandPress={() => {
          setTab('browse');
          setSelectedStoreId('');
          setSelectedCategory('');
        }}
        searchQuery={search}
        onSearchChange={(text) => {
          if (selectedStoreId && text.trim()) {
            setSelectedStoreId('');
          }
          setSearch(text);
          if (tab !== 'browse') setTab('browse');
        }}
        searchPlaceholder="Search dishes, restaurants…"
        addressText={
          hasSelectedAddress
            ? (currentAddress?.label || currentAddress?.locality || currentAddress?.city || 'Selected address')
            : (currentGpsCity ? `Near ${currentGpsCity}` : 'Current Location')
        }
        pincode={
          hasSelectedAddress
            ? activeCustomerPincode
            : (currentGpsPincode || 'GPS')
        }
        onAddressPress={() => setAddressDropdownVisible(true)}
        onNotificationPress={() => void showNotifications()}
        hasUnreadNotifications={notifications.length > 0}
        rightActions={
          <Pressable
            accessibilityLabel={`Cart with ${cartCount} items`}
            onPress={() => setTab('cart')}
            style={styles.headerIconButton}
          >
            <Text style={styles.headerCartIcon}>🛒</Text>
            {cartCount > 0 && (
              <View style={styles.headerCartBadge}>
                <Text style={styles.headerCartBadgeText}>{cartCount}</Text>
              </View>
            )}
          </Pressable>
        }
        roleLabel="Customer"
        profileMenuItems={[
          { key: 'browse', label: 'Order Online', description: 'Browse restaurants, shops and menus', icon: '⌕' },
          { key: 'orders', label: 'My orders', description: 'Track orders and view bills', icon: '▤' },
          { key: 'addresses', label: 'Saved addresses', description: 'Manage delivery locations', icon: '⌖' },
        ]}
        onNavigateProfile={(key) => setTab(key as Tab)}
        onSignOut={performSignOut}
        onSessionUserUpdate={onSessionUserUpdate}
      />

      <CustomerNotificationsModal
        visible={notificationsModalVisible}
        onClose={() => setNotificationsModalVisible(false)}
        notifications={notifications}
        loading={loadingNotifications}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setAddressDropdownVisible(false)}
        transparent
        visible={addressDropdownVisible}
      >
        <Pressable
          onPress={() => setAddressDropdownVisible(false)}
          style={styles.dropdownModalBackdrop}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.dropdownModalSheet}>
            <View style={styles.dropdownModalHeader}>
              <View style={styles.flex}>
                <Text style={styles.dropdownModalTitle}>Select delivery address</Text>
                <Text style={styles.dropdownModalSubtitle}>
                  Choose default address to check available kitchens and shops in your area
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close address selector"
                onPress={() => setAddressDropdownVisible(false)}
                style={styles.dropdownModalCloseButton}
              >
                <Text style={styles.dropdownModalCloseText}>×</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.dropdownAddressList} keyboardShouldPersistTaps="handled">
              {/* Option to use Device GPS Location */}
              <Pressable
                disabled={isLocating}
                onPress={async () => {
                  setSelectedAddressId('current_location');
                  setAddressDropdownVisible(false);
                  await detectDeviceLocation(false);
                }}
                style={[
                  styles.dropdownAddressCard,
                  !hasSelectedAddress && styles.dropdownAddressCardSelected,
                  { borderColor: !hasSelectedAddress ? '#d83a32' : '#bbf7d0', backgroundColor: !hasSelectedAddress ? '#fff8f4' : '#f0fdf4' },
                ]}
              >
                <View style={styles.dropdownAddressRadio}>
                  {isLocating ? (
                    <ActivityIndicator color="#d83a32" size="small" />
                  ) : (
                    <Text style={[styles.dropdownRadioText, !hasSelectedAddress && styles.dropdownRadioTextSelected]}>
                      {!hasSelectedAddress ? '●' : '○'}
                    </Text>
                  )}
                </View>
                <View style={styles.flex}>
                  <View style={styles.dropdownAddressTitleRow}>
                    <Text style={[styles.dropdownAddressLabel, { color: '#166534' }]}>📍 Current Location (GPS)</Text>
                    {!hasSelectedAddress && <Text style={styles.selectedAreaBadge}>ACTIVE</Text>}
                  </View>
                  <Text style={styles.dropdownAddressText}>
                    {currentGpsCoords
                      ? `Lat: ${currentGpsCoords.lat.toFixed(4)}, Lng: ${currentGpsCoords.lng.toFixed(4)}${currentGpsCity ? ` · ${currentGpsCity}` : ''}`
                      : 'Tap to detect device GPS and browse nearest stores'}
                  </Text>
                  {!!currentGpsPincode && (
                    <View style={styles.dropdownAddressMetaRow}>
                      <Text style={[styles.dropdownPincodeBadge, { backgroundColor: '#dcfce7', color: '#15803d' }]}>
                        Detected PIN: {currentGpsPincode}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>

              {addresses.map((address) => {
                const isCurrent = currentAddress?._id === address._id;
                const isBusy = settingDefaultId === address._id;
                return (
                  <Pressable
                    key={address._id}
                    disabled={isBusy}
                    onPress={() => void chooseDefaultAddress(address._id)}
                    style={[
                      styles.dropdownAddressCard,
                      isCurrent && styles.dropdownAddressCardSelected,
                    ]}
                  >
                    <View style={styles.dropdownAddressRadio}>
                      {isBusy ? (
                        <ActivityIndicator color="#d83a32" size="small" />
                      ) : (
                        <Text style={[styles.dropdownRadioText, isCurrent && styles.dropdownRadioTextSelected]}>
                          {isCurrent ? '●' : '○'}
                        </Text>
                      )}
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.dropdownAddressTitleRow}>
                        <Text style={styles.dropdownAddressLabel}>{address.label || 'Delivery address'}</Text>
                        {address.isDefault && <Text style={styles.defaultBadge}>DEFAULT</Text>}
                        {isCurrent && !address.isDefault && (
                          <Text style={styles.selectedAreaBadge}>SELECTED</Text>
                        )}
                      </View>
                      <Text style={styles.dropdownAddressText}>{addressSummary(address)}</Text>
                      <View style={styles.dropdownAddressMetaRow}>
                        <Text style={styles.dropdownPincodeBadge}>Pincode: {address.postalCode}</Text>
                        {!!address.digipin && (
                          <Text style={styles.dropdownDigipinBadge}>⌖ DIGIPIN: {formatDigipin(address.digipin)}</Text>
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })}

              {!addresses.length && (
                <View style={styles.dropdownEmptyState}>
                  <Text style={styles.dropdownEmptyTitle}>No saved addresses</Text>
                  <Text style={styles.dropdownEmptyDetail}>
                    Add your delivery address with area pincode to browse local restaurants and shops.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.dropdownModalFooter}>
              <PrimaryButton
                label="+ Add new delivery address"
                onPress={() => {
                  setAddressDropdownVisible(false);
                  setEditingAddressId('');
                  setAddressForm({
                    label: 'Home',
                    line1: '',
                    line2: '',
                    locality: '',
                    city: '',
                    state: '',
                    postalCode: '',
                    phone: session?.user?.phone || '',
                    digipin: session?.user?.digipin || '',
                    coordinates: [],
                  });
                  setAddressFormVisible(true);
                  setTab('addresses');
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
        onTouchStart={() => {
          if (searchFocused) {
            triggerSearchLayout();
            setSearchFocused(false);
            Keyboard.dismiss();
          }
        }}
        onScrollBeginDrag={() => {
          if (searchFocused) {
            triggerSearchLayout();
            setSearchFocused(false);
            Keyboard.dismiss();
          }
        }}
      >
        {tab === 'browse' && (
          <View>
            <View style={styles.headerEyebrowRow}>
              <DynamicTicker
                coupons={availableCoupons}
                onSelectCoupon={(code) => {
                  setCouponCode(code);
                  void validateCoupon(code);
                  setTab('cart');
                }}
              />
              <View style={styles.compactModeSwitch}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectMode('restaurant')}
                  style={[styles.compactModeButton, mode === 'restaurant' && styles.compactModeButtonActive]}
                >
                  <Text style={[styles.compactModeText, mode === 'restaurant' && styles.compactModeTextActive]}>
                    Restaurants
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectMode('shop')}
                  style={[styles.compactModeButton, mode === 'shop' && styles.compactModeButtonActive]}
                >
                  <Text style={[styles.compactModeText, mode === 'shop' && styles.compactModeTextActive]}>
                    Shops
                  </Text>
                </Pressable>
              </View>
            </View>
            {/* Dynamic Sliding Banners Hero with Floating Static Translucent Dietary Toggle */}
            <View
              style={styles.heroBannerContainer}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0 && Math.abs(w - bannerWidth) > 2) {
                  setBannerWidth(w);
                }
              }}
            >
              {/* Floating Static Translucent Dietary Toggle */}
              <View style={styles.floatingDietaryToggleContainer}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show all foods"
                  onPress={() => setDietaryFilter('all')}
                  style={[
                    styles.dietaryToggleBtn,
                    dietaryFilter === 'all' && styles.dietaryToggleBtnActiveAll,
                  ]}
                >
                  <Text
                    style={[
                      styles.dietaryToggleText,
                      dietaryFilter === 'all' && styles.dietaryToggleTextActiveAll,
                    ]}
                  >
                    All
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show vegetarian only"
                  onPress={() => setDietaryFilter(dietaryFilter === 'veg' ? 'all' : 'veg')}
                  style={[
                    styles.dietaryToggleBtn,
                    dietaryFilter === 'veg' && styles.dietaryToggleBtnActiveVeg,
                  ]}
                >
                  <VegBadge size={9} />
                  <Text
                    style={[
                      styles.dietaryToggleText,
                      dietaryFilter === 'veg' && styles.dietaryToggleTextActiveVeg,
                    ]}
                  >
                    V
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show non-vegetarian only"
                  onPress={() => setDietaryFilter(dietaryFilter === 'non-veg' ? 'all' : 'non-veg')}
                  style={[
                    styles.dietaryToggleBtn,
                    dietaryFilter === 'non-veg' && styles.dietaryToggleBtnActiveNonVeg,
                  ]}
                >
                  <NonVegBadge size={9} />
                  <Text
                    style={[
                      styles.dietaryToggleText,
                      dietaryFilter === 'non-veg' && styles.dietaryToggleTextActiveNonVeg,
                    ]}
                  >
                    NV
                  </Text>
                </Pressable>
              </View>

              {/* Dynamically Sliding Banners Track */}
              <ScrollView
                ref={bannerScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={handleBannerScrollEnd}
                contentContainerStyle={styles.heroBannerTrack}
              >
                {HERO_BANNERS.map((banner) => (
                  <Pressable
                    key={banner.id}
                    onPress={() => handleBannerPress(banner)}
                    style={[
                      styles.heroBannerSlide,
                      { width: bannerWidth, backgroundColor: banner.bgColor },
                    ]}
                  >
                    <View style={[styles.heroBannerTag, { backgroundColor: banner.tagBg }]}>
                      <Text style={[styles.heroBannerTagText, { color: banner.tagColor }]}>
                        {banner.tag}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.heroBannerTitle}>
                      {banner.title}
                    </Text>
                    <Text numberOfLines={2} style={styles.heroBannerSubtitle}>
                      {banner.subtitle}
                    </Text>
                    <View style={styles.heroBannerDecorEmojis} pointerEvents="none">
                      <Text style={styles.heroBannerEmoji}>{banner.emoji}</Text>
                      <Text style={styles.heroBannerEmoji}>{banner.secondaryEmoji}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Pagination Indicator Dots */}
              <View style={styles.heroPaginationRow}>
                {HERO_BANNERS.map((banner, index) => (
                  <Pressable
                    key={banner.id}
                    hitSlop={6}
                    onPress={() => goToBanner(index)}
                    style={[
                      styles.heroPaginationDot,
                      activeBannerIndex === index && styles.heroPaginationDotActive,
                    ]}
                  />
                ))}
              </View>
            </View>

            {!!areaMessage && <Text style={styles.areaNotice}>{areaMessage}</Text>}

            {/* Horizontal Categories Row of Square Boxes */}
            <View style={styles.categoriesSection}>
              <View style={styles.categoriesHeaderRow}>
                <Text style={styles.categoriesHeaderTitle}>
                  {mode === 'shop' ? 'Categories' : 'Categories'}
                </Text>
                {!!selectedCategory && (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setSelectedCategory('')}
                    style={styles.clearCategoryBtn}
                  >
                    <Text style={styles.clearCategoryText}>Clear filter ✕</Text>
                  </Pressable>
                )}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryScrollContainer}
              >
                {displayedCategories.map((cat) => {
                  const isSelected = (!selectedCategory && cat.name === 'All') || selectedCategory === cat.name;
                  return (
                    <Pressable
                      key={cat.id || cat.name}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${cat.name}`}
                      onPress={() => {
                        if (cat.name === 'All' || selectedCategory === cat.name) {
                          setSelectedCategory('');
                        } else {
                          setSelectedCategory(cat.name);
                        }
                      }}
                      style={styles.categoryItemWrapper}
                    >
                      {/* Square Box with FULL SIZE IMAGE */}
                      <View
                        style={[
                          styles.categorySquareBox,
                          isSelected && styles.categorySquareBoxActive,
                        ]}
                      >
                        {cat.image ? (
                          <Image
                            source={{ uri: apiPath(cat.image) }}
                            style={styles.categoryFullImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.categoryEmojiPlaceholder}>
                            <Text style={styles.categoryFullEmoji}>{cat.icon}</Text>
                          </View>
                        )}
                      </View>

                      {/* Category name written BELOW the category image */}
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.categoryNameBelow,
                          isSelected && styles.categoryNameBelowActive,
                        ]}
                      >
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <Text style={styles.sectionTitle}>
              {search.trim()
                ? `${mode === 'shop' ? 'Shops' : 'Restaurants'} selling or matching "${search.trim()}"`
                : selectedCategory
                  ? `${mode === 'shop' ? 'Shops' : 'Restaurants'} with ${selectedCategory}`
                  : (mode === 'shop' ? 'Nearby shops' : 'Nearby restaurants')}
            </Text>
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
                    <StoreCardWithSlider
                      key={id || store.name}
                      store={store}
                      isSelected={selected}
                      onSelect={() => setSelectedStoreId(selected ? '' : id)}
                      menuItems={menuItems}
                      allMenuItems={allMenuItems}
                      dietaryFilter={dietaryFilter}
                      mode={mode}
                      onAddItem={(item) => addItem(item)}
                    />
                  );
                })}
              </ScrollView>
            ) : (
              <EmptyState
                title={
                  search
                    ? `No ${mode === 'shop' ? 'shops' : 'restaurants'} matching "${search}"`
                    : selectedCategory
                      ? `No ${mode === 'shop' ? 'shops' : 'restaurants'} found for "${selectedCategory}"`
                      : hasSelectedAddress
                        ? `No ${mode === 'shop' ? 'shops' : 'restaurants'} in PIN ${activeCustomerPincode}`
                        : `No ${mode === 'shop' ? 'shops' : 'restaurants'} near you`
                }
                detail={
                  search || selectedCategory
                    ? 'Try another category or tap Clear filter.'
                    : hasSelectedAddress
                      ? `There are no active ${mode === 'shop' ? 'shops' : 'restaurants'} covering your selected pincode (${activeCustomerPincode}). Tap Change above to choose another address or use current GPS location.`
                      : 'No open stores detected near your GPS location. Tap Change above to select a delivery address.'
                }
                actionLabel="Change location"
                onAction={() => setAddressDropdownVisible(true)}
              />
            )}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>
                {selectedStore
                  ? `${selectedStore.name} ${mode === 'shop' ? 'Products' : 'Menu'}`
                  : search.trim()
                    ? `Items matching "${search.trim()}"`
                    : selectedCategory
                      ? `${selectedCategory} Items`
                      : 'Popular near you'}
              </Text>
              {!!(selectedStoreId || selectedCategory) && (
                <Pressable onPress={() => { setSelectedStoreId(''); setSelectedCategory(''); }}>
                  <Text style={styles.link}>Show all</Text>
                </Pressable>
              )}
            </View>
            {!!selectedStore && (
              <View style={styles.selectedStoreCard}>
                <View style={styles.selectedStoreHeaderRow}>
                  <Text style={styles.selectedStoreName}>{selectedStore.name}</Text>
                  <View style={styles.storeDietaryBadges}>
                    {getStoreDietary(selectedStore, menuItems).hasVeg && <VegBadge size={13} />}
                    {getStoreDietary(selectedStore, menuItems).hasNonVeg && <NonVegBadge size={13} />}
                  </View>
                </View>
                <Text style={styles.selectedStoreAddress}>
                  {selectedStore.restaurantAddress || selectedStore.shopAddress || selectedStore.address || ''}
                </Text>
                {!!selectedStore.digipin && (
                  <Text style={styles.selectedStoreDigipin}>⌖ Pickup DIGIPIN: {formatDigipin(selectedStore.digipin)}</Text>
                )}
              </View>
            )}
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#d83a32" />
              </View>
            ) : visibleItems.length ? (
              <View style={styles.menuItemsGrid}>
                {visibleItems.filter(Boolean).map((item) => {
                  const itemKey = item._id || (item as unknown as { id?: string }).id || `${item.name}-${item.price}`;
                  const itemStore = findStoreForItem(item, allStores);
                  const storeDisplayName = itemStore?.name || getItemStoreName(item) || '';
                  const closed = itemStore?.isOpen === false || itemStore?.isOnline === false;
                  return (
                    <MenuCard
                      key={itemKey}
                      item={item}
                      closed={closed}
                      storeName={storeDisplayName}
                      onPressStore={itemStore ? () => setSelectedStoreId(storeId(itemStore)) : undefined}
                      onAdd={(variant) => addItem(item, variant)}
                      isShop={Boolean(mode === 'shop' || (itemStore as any)?.type === 'shop' || (itemStore as any)?.isShop || Boolean(itemStore?.shopAddress))}
                    />
                  );
                })}
              </View>
            ) : (
              <EmptyState
                title={
                  search
                    ? 'No matches found'
                    : selectedCategory
                      ? `No items found in "${selectedCategory}"`
                      : 'No menu items available'
                }
                detail={
                  search || selectedCategory
                    ? 'Try another category or tap Clear filter.'
                    : 'Choose another place or refresh the list.'
                }
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
                {!cartServiceability.isServiceable && (
                  <View style={styles.tooFarBanner}>
                    <View style={styles.tooFarHeader}>
                      <Text style={styles.tooFarIcon}>🚫</Text>
                      <Text style={styles.tooFarTitle}>Restaurant is too far</Text>
                    </View>
                    <Text style={styles.tooFarText}>
                      Customer selected address pincode <Text style={styles.tooFarBold}>({cartServiceability.custPin || 'N/A'})</Text> and restaurant pincode <Text style={styles.tooFarBold}>({cartServiceability.storePin || 'N/A'})</Text> are not in the same serviceable area list pincode.
                    </Text>
                    <Text style={styles.tooFarSubtext}>
                      Delivery cannot be fulfilled for this distance. Payment is blocked until you update your delivery address to a serviceable location.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setTab('addresses');
                        setAddressFormVisible(true);
                      }}
                      style={styles.tooFarUpdateBtn}
                    >
                      <Text style={styles.tooFarUpdateBtnText}>📍 Update Address & Pincode</Text>
                    </Pressable>
                  </View>
                )}
                <Text style={styles.sectionTitle}>Deliver to</Text>
                {addresses.length ? (
                  addresses.map((address) => {
                    const addrPin = getAddressPincode(address);
                    const isAddrServiceable = checkServiceAreaMatch({
                      custPin: addrPin,
                      storePin: cartStorePin,
                      serviceAreas,
                      isStoreServiceable: cartStore?.isServiceable,
                      areaMessage,
                    }).isServiceable;

                    return (
                      <Pressable
                        key={address._id}
                        onPress={() => {
                          setSelectedAddressId(address._id);
                          const testCheck = checkServiceAreaMatch({
                            custPin: addrPin,
                            storePin: cartStorePin,
                            serviceAreas,
                            isStoreServiceable: cartStore?.isServiceable,
                            areaMessage,
                          });
                          if (!testCheck.isServiceable) {
                            showTooFarPopup(testCheck);
                          }
                        }}
                        style={[
                          styles.addressOption,
                          (selectedAddressId === address._id || currentAddress?._id === address._id)
                            && styles.addressOptionSelected,
                          !isAddrServiceable && styles.addressOptionUnserviceable,
                        ]}
                      >
                        <Text style={styles.radio}>{selectedAddressId === address._id || currentAddress?._id === address._id ? '●' : '○'}</Text>
                        <View style={styles.flex}>
                          <View style={styles.addressNameRow}>
                            <Text style={styles.itemName}>{address.label || 'Delivery address'}</Text>
                            {!isAddrServiceable ? (
                              <View style={styles.addressUnserviceableBadge}>
                                <Text style={styles.addressUnserviceableText}>
                                  🚫 Outside area ({addrPin || 'No PIN'})
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.addressServiceableBadge}>
                                <Text style={styles.addressServiceableText}>
                                  ✓ Serviceable ({addrPin})
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.itemDescription}>{addressSummary(address)}</Text>
                        </View>
                      </Pressable>
                    );
                  })
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
                {/* Apply a coupon Dropdown (Contracted by default) */}
                <View style={styles.couponCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Toggle apply a coupon section"
                    onPress={() => setCouponDropdownExpanded((prev) => !prev)}
                    style={styles.collapsibleHeaderRow}
                  >
                    <View style={styles.collapsibleHeaderLeft}>
                      <Text style={styles.collapsibleHeaderIcon}>🏷️</Text>
                      <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Apply a coupon</Text>
                      {couponValidation?.valid && (
                        <View style={styles.couponAppliedBadge}>
                          <Text style={styles.couponAppliedBadgeText}>✓ Applied</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.collapsibleHeaderRight}>
                      {couponValidation?.valid ? (
                        <Text style={styles.couponAppliedDiscount}>-{formatRupees(couponDiscount)}</Text>
                      ) : !couponDropdownExpanded ? (
                        <Text style={styles.collapsibleActionText}>Add coupon</Text>
                      ) : null}
                      <Text style={styles.dropdownChevron}>{couponDropdownExpanded ? '▴' : '▾'}</Text>
                    </View>
                  </Pressable>

                  {couponDropdownExpanded && (
                    <View style={styles.collapsibleContent}>
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
                  )}
                </View>

                {/* Payment mode Dropdown (Default expanded, collapsible by user) */}
                <View style={styles.paymentCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Toggle payment mode section"
                    onPress={() => setPaymentDropdownExpanded((prev) => !prev)}
                    style={styles.collapsibleHeaderRow}
                  >
                    <View style={styles.collapsibleHeaderLeft}>
                      <Text style={styles.collapsibleHeaderIcon}>💳</Text>
                      <View>
                        <Text style={[styles.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Payment mode</Text>
                        {!paymentDropdownExpanded && (
                          <Text style={styles.paymentSelectedSummary}>
                            {selectedPaymentMethod === 'cod'
                              ? '💵 Cash on Delivery'
                              : selectedPaymentMethod === 'razorpay'
                                ? '⚡ Razorpay'
                                : selectedPaymentMethod === 'upi'
                                  ? '📱 UPI Payment'
                                  : selectedPaymentMethod === 'card'
                                    ? '💳 Credit/Debit Card'
                                    : `🏦 Net Banking (${selectedBank})`}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.collapsibleHeaderRight}>
                      {paymentDropdownExpanded && (
                        <Text style={styles.collapsibleActionText}>Collapse</Text>
                      )}
                      <Text style={styles.dropdownChevron}>{paymentDropdownExpanded ? '▴' : '▾'}</Text>
                    </View>
                  </Pressable>

                  {paymentDropdownExpanded && (
                    <View style={styles.collapsibleContent}>
                      <Text style={styles.paymentSubtitle}>Choose how you want to pay</Text>

                  {PAYMENT_MODES.map((mode) => {
                    const isSelected = selectedPaymentMethod === mode.id;
                    return (
                      <Pressable
                        key={mode.id}
                        onPress={() => setSelectedPaymentMethod(mode.id)}
                        style={[
                          styles.paymentOption,
                          isSelected && styles.paymentOptionSelected,
                        ]}
                      >
                        <Text style={styles.paymentRadio}>{isSelected ? '●' : '○'}</Text>
                        <Text style={styles.paymentIcon}>{mode.icon}</Text>
                        <View style={styles.flex}>
                          <View style={styles.paymentOptionHeader}>
                            <Text style={styles.paymentOptionName}>{mode.name}</Text>
                            {!!mode.badge && <Text style={styles.paymentBadge}>{mode.badge}</Text>}
                          </View>
                          <Text style={styles.itemDescription}>{mode.description}</Text>
                        </View>
                      </Pressable>
                    );
                  })}

                  {selectedPaymentMethod === 'upi' && (
                    <View style={styles.paymentDetailBox}>
                      <Text style={styles.paymentDetailTitle}>Enter UPI ID / VPA (Optional)</Text>
                      <TextInput
                        autoCapitalize="none"
                        keyboardType="email-address"
                        onChangeText={setUpiId}
                        placeholder="e.g. mobile@upi, name@okhdfcbank"
                        placeholderTextColor="#998f88"
                        style={styles.input}
                        value={upiId}
                      />
                      <Text style={styles.fieldHint}>Leave empty to scan rider QR upon delivery or confirm via UPI app.</Text>
                    </View>
                  )}

                  {selectedPaymentMethod === 'card' && (
                    <View style={styles.paymentDetailBox}>
                      <Text style={styles.paymentDetailTitle}>Card details</Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={19}
                        onChangeText={(val) => setCardForm((prev) => ({ ...prev, cardNumber: val }))}
                        placeholder="Card number (16 digits)"
                        placeholderTextColor="#998f88"
                        style={styles.input}
                        value={cardForm.cardNumber}
                      />
                      <TextInput
                        autoCapitalize="characters"
                        onChangeText={(val) => setCardForm((prev) => ({ ...prev, cardHolder: val }))}
                        placeholder="Cardholder name"
                        placeholderTextColor="#998f88"
                        style={styles.input}
                        value={cardForm.cardHolder}
                      />
                      <View style={styles.inputRow}>
                        <TextInput
                          keyboardType="number-pad"
                          maxLength={5}
                          onChangeText={(val) => setCardForm((prev) => ({ ...prev, expiry: val }))}
                          placeholder="MM/YY"
                          placeholderTextColor="#998f88"
                          style={[styles.input, styles.halfInput]}
                          value={cardForm.expiry}
                        />
                        <TextInput
                          keyboardType="number-pad"
                          maxLength={4}
                          secureTextEntry
                          onChangeText={(val) => setCardForm((prev) => ({ ...prev, cvv: val }))}
                          placeholder="CVV"
                          placeholderTextColor="#998f88"
                          style={[styles.input, styles.halfInput]}
                          value={cardForm.cvv}
                        />
                      </View>
                    </View>
                  )}

                  {selectedPaymentMethod === 'netbanking' && (
                    <View style={styles.paymentDetailBox}>
                      <Text style={styles.paymentDetailTitle}>Select Bank</Text>
                      <View style={styles.bankChoiceGrid}>
                        {POPULAR_BANKS.map((bank) => {
                          const isBankActive = selectedBank === bank;
                          return (
                            <Pressable
                              key={bank}
                              onPress={() => setSelectedBank(bank)}
                              style={[styles.bankChip, isBankActive && styles.bankChipActive]}
                            >
                              <Text style={[styles.bankChipText, isBankActive && styles.bankChipTextActive]}>
                                {bank}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}
                    </View>
                  )}
                </View>

                <View style={styles.billCard}>
                  <BillRow label="Subtotal" value={formatRupees(subtotal)} />
                  <BillRow label="Estimated tax" value={formatRupees(subtotal * 0.05)} />
                  <BillRow label="Delivery fee" value={formatRupees(40)} />
                  {!!couponDiscount && <BillRow label="Coupon discount" value={`−${formatRupees(couponDiscount)}`} />}
                  <View style={styles.billDivider} />
                  <BillRow bold label="Estimated total" value={formatRupees(estimatedTotal)} />
                  <Text style={styles.paymentNote}>
                    {selectedPaymentMethod === 'cod'
                      ? 'Cash on delivery · Pay cash or UPI to rider at doorstep'
                      : selectedPaymentMethod === 'upi'
                        ? 'UPI · Instant prepaid order'
                        : selectedPaymentMethod === 'card'
                          ? 'Card · Secure prepaid checkout'
                          : `Net Banking (${selectedBank}) · Instant prepaid order`}
                  </Text>
                </View>
                {!session ? (
                  <View style={[styles.paymentBlockedWarning, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
                    <Text style={[styles.paymentBlockedText, { color: '#c2410c' }]}>
                      👤 You are browsing as a guest. Please sign in to place your order and make payment.
                    </Text>
                  </View>
                ) : (!addresses.length || !currentAddress || selectedAddressId === 'current_location') ? (
                  <View style={[styles.paymentBlockedWarning, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
                    <Text style={[styles.paymentBlockedText, { color: '#c2410c' }]}>
                      📍 Delivery address not set. Please add a delivery address within our serviceable areas to place order.
                    </Text>
                  </View>
                ) : !cartServiceability.isServiceable ? (
                  <View style={styles.paymentBlockedWarning}>
                    <Text style={styles.paymentBlockedText}>
                      🚫 Payment disabled: Delivery address pincode ({cartServiceability.custPin || 'N/A'}) and restaurant pincode ({cartServiceability.storePin || 'N/A'}) are not in the same serviceable area list pincode.
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (session && currentAddress && !cartServiceability.isServiceable) {
                      showTooFarPopup(cartServiceability);
                    }
                  }}
                >
                  <PrimaryButton
                    disabled={
                      placingOrder ||
                      Boolean(session && currentAddress && !cartServiceability.isServiceable)
                    }
                    label={
                      !session
                        ? (!checkCurrentLocationServiceability().isServiceable
                            ? 'Location out of serviceable area'
                            : `Sign in to place order · ${formatRupees(estimatedTotal)}`)
                        : (!addresses.length || !currentAddress || selectedAddressId === 'current_location')
                          ? 'Add delivery address to place order'
                          : !cartServiceability.isServiceable
                            ? 'Restaurant is too far · Update address to pay'
                            : placingOrder
                              ? 'Placing order…'
                              : selectedPaymentMethod === 'razorpay'
                                ? `Pay with Razorpay · ${formatRupees(estimatedTotal)}`
                                : selectedPaymentMethod === 'cod'
                                  ? `Place cash order · ${formatRupees(estimatedTotal)}`
                                  : selectedPaymentMethod === 'upi'
                                    ? `Pay via UPI · ${formatRupees(estimatedTotal)}`
                                    : selectedPaymentMethod === 'card'
                                      ? `Pay with Card · ${formatRupees(estimatedTotal)}`
                                      : `Pay via Net Banking · ${formatRupees(estimatedTotal)}`
                    }
                    onPress={() => {
                      void placeOrder();
                    }}
                  />
                </Pressable>
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
            {!session ? (
              <EmptyState
                title="Please sign in"
                detail="Sign in to view and track your orders."
                actionLabel="Sign in / Register"
                onAction={() => (onRequestSignIn ? onRequestSignIn() : onSignOut())}
              />
            ) : orders.length ? (
              orders.map((order) => (
                <OrderCard
                  key={order._id}
                  order={order}
                  tracking={trackingByOrder[order._id]}
                  trackingError={trackingErrors[order._id]}
                  trackingLoading={trackingBusyId === order._id}
                  bill={bills[order._id]}
                  billLoading={billBusyId === order._id}
                  sessionToken={session?.token || ''}
                onTrack={() => void loadTracking(order._id)}
                onViewBill={() => void loadBill(order._id)}
                onReview={(item) => {
                  const items = (order.items || []).map((it) => ({
                    id: it.foodItemId || it.itemId || it._id || '',
                    name: it.name,
                  }));
                  const isShopOrder = Boolean(order.isShopOrder || order.shopId || order.shopName);
                  setReviewTarget({
                    orderId: order._id,
                    itemId: item.id || items[0]?.id || '',
                    itemName: item.name || items[0]?.name || 'Item',
                    items,
                    isShopOrder,
                  });
                  setReviewRating(item.rating ?? 5);
                  setReviewComment('');
                }}
              />
            ))) : (
              <EmptyState
                title="No orders yet"
                detail="Your order history and delivery updates will appear here."
                actionLabel="Explore Tomato"
                onAction={() => setTab('browse')}
              />
            )}
            <Modal
              animationType="fade"
              transparent
              visible={Boolean(reviewTarget)}
              onRequestClose={() => setReviewTarget(null)}
            >
              <Pressable
                style={styles.reviewModalBackdrop}
                onPress={() => setReviewTarget(null)}
              >
                <Pressable style={styles.reviewModalCard} onPress={(e) => e.stopPropagation()}>
                  <View style={styles.reviewModalHeader}>
                    <View style={styles.reviewModalTitleRow}>
                      <Text style={styles.reviewModalIcon}>★</Text>
                      <Text style={styles.reviewModalTitle} numberOfLines={1}>
                        Review {reviewTarget?.itemName || 'Item'}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setReviewTarget(null)}
                      style={styles.reviewModalClose}
                      accessibilityRole="button"
                      accessibilityLabel="Close review popup"
                    >
                      <Text style={styles.reviewModalCloseText}>✕</Text>
                    </Pressable>
                  </View>

                  {Boolean(reviewTarget?.items && reviewTarget.items.length > 1) && (
                    <View style={styles.reviewItemSelectorContainer}>
                      <Text style={styles.reviewItemSelectorLabel}>
                        Select {reviewTarget?.isShopOrder ? 'item' : 'dish'} to review:
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewItemChipsRow}>
                        {reviewTarget?.items?.map((it, idx) => {
                          const isSelected = it.id === reviewTarget.itemId || (!reviewTarget.itemId && idx === 0);
                          return (
                            <Pressable
                              key={`${it.id || it.name}-${idx}`}
                              onPress={() => setReviewTarget((curr) => curr ? { ...curr, itemId: it.id, itemName: it.name } : null)}
                              style={[styles.reviewItemChip, isSelected && styles.reviewItemChipSelected]}
                            >
                              <Text style={[styles.reviewItemChipText, isSelected && styles.reviewItemChipTextSelected]} numberOfLines={1}>
                                {it.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}

                  <Text style={styles.reviewRatePrompt}>
                    {reviewTarget?.isShopOrder ? 'How was the product and quality?' : 'How was the taste and quality?'}
                  </Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <Pressable
                        key={rating}
                        onPress={() => setReviewRating(rating)}
                        style={styles.ratingButton}
                        accessibilityRole="button"
                        accessibilityLabel={`${rating} star rating`}
                      >
                        <Text style={[styles.ratingStar, rating <= reviewRating && styles.ratingStarActive]}>★</Text>
                      </Pressable>
                    ))}
                  </View>

                  <TextInput
                    onChangeText={setReviewComment}
                    placeholder="Tell others what you loved about this dish (optional)…"
                    placeholderTextColor="#998f88"
                    style={[styles.input, styles.reviewInput]}
                    value={reviewComment}
                    multiline
                  />

                  <PrimaryButton
                    disabled={savingReview}
                    label={savingReview ? 'Submitting review…' : 'Submit Review'}
                    onPress={() => void submitReview()}
                  />

                  <Pressable onPress={() => setReviewTarget(null)} style={styles.cancelButton}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          </View>
        )}

        {tab === 'addresses' && (
          <View>
            <Text style={styles.eyebrow}>DELIVERY DETAILS</Text>
            <Text style={styles.pageTitle}>Saved addresses</Text>
            <Text style={styles.pageSubtitle}>Choose where your order should arrive.</Text>
            {!session ? (
              <EmptyState
                title="Sign in to save addresses"
                detail="Please sign in or register to view, manage, and save your delivery addresses."
                actionLabel="Sign in / Register"
                onAction={() => (onRequestSignIn ? onRequestSignIn() : Alert.alert('Sign in', 'Please sign in to manage your addresses.'))}
              />
            ) : (
              <>
                {addresses.map((address) => (
                  <View key={address._id} style={styles.addressCard}>
                    <View style={styles.addressTitleRow}>
                      <Text style={styles.itemName}>{address.label || 'Delivery address'}</Text>
                      {address.isDefault && <Text style={styles.defaultBadge}>DEFAULT</Text>}
                    </View>
                    <Text style={styles.addressText}>{addressSummary(address)}</Text>
                    {!!address.digipin && (
                      <View style={styles.digipinPill}>
                        <Text style={styles.digipinPillText}>⌖ DIGIPIN: {formatDigipin(address.digipin)}</Text>
                      </View>
                    )}
                    {Array.isArray(address.coordinates) && address.coordinates.length === 2 && (
                      <View style={styles.gpsRow}>
                        <Text style={styles.gpsPillText}>📍 Live GPS: {address.coordinates[1].toFixed(5)}, {address.coordinates[0].toFixed(5)}</Text>
                      </View>
                    )}
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
                    <TextInput
                      autoCapitalize="characters"
                      onChangeText={(value) => setAddressForm((form) => ({ ...form, digipin: value.toUpperCase() }))}
                      placeholder="Delivery DIGIPIN (e.g. 4M8-9K2-T3P9)"
                      style={styles.input}
                      value={addressForm.digipin}
                    />
                    <View style={styles.addressDigipinActionRow}>
                      <Pressable
                        onPress={() => void openMapplsMap(addressForm.digipin)}
                        style={styles.addressMapplsBtn}
                      >
                        <Text style={styles.addressMapplsBtnText}>🗺️ Find DIGIPIN on Mappls</Text>
                      </Pressable>
                      <Pressable
                        disabled={detectingGps}
                        onPress={() => void detectCurrentGpsLocation()}
                        style={styles.addressGpsDetectBtn}
                      >
                        <Text style={styles.addressGpsDetectBtnText}>
                          {detectingGps ? '📍 Detecting GPS…' : '📍 Set Current GPS'}
                        </Text>
                      </Pressable>
                    </View>
                    {Array.isArray(addressForm.coordinates) && addressForm.coordinates.length === 2 && (
                      <View style={styles.gpsLocationActiveBadge}>
                        <Text style={styles.gpsLocationActiveText}>
                          📍 Current GPS Location Set: {addressForm.coordinates[1].toFixed(5)}, {addressForm.coordinates[0].toFixed(5)}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.fieldHint}>
                      {addressForm.digipin
                        ? '✓ DIGIPIN is set. Your delivery rider will navigate via this DIGIPIN.'
                        : addressForm.coordinates?.length === 2
                          ? '✓ GPS location set. Since DIGIPIN is not set, rider will navigate using this GPS location.'
                          : 'Tip: You can set a DIGIPIN or your current device GPS location for delivery.'}
                    </Text>
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
                        phone: session?.user?.phone || '',
                        digipin: session?.user?.digipin || '',
                        coordinates: [],
                      });
                      setAddressFormVisible(true);
                    }}
                  />
                )}
              </>
            )}
          </View>
        )}

        {tab === 'account' && (
          <View>
            <Text style={styles.eyebrow}>YOUR TOMATO ACCOUNT</Text>
            {session?.user ? (
              <>
                <Text style={styles.pageTitle}>Hello{session.user.name && typeof session.user.name === 'string' ? `, ${session.user.name.split(' ')[0]}` : ''}</Text>
                <View style={styles.profileCard}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{String(session.user.name || 'T').charAt(0).toUpperCase()}</Text></View>
                  <Text style={styles.profileName}>{session.user.name || 'Tomato customer'}</Text>
                  <Text style={styles.customerBadge}>CUSTOMER ACCOUNT · {customerId}</Text>
                  {Boolean(session.user.email) && <Text style={styles.profileDetail}>{session.user.email}</Text>}
                  {Boolean(session.user.phone) && <Text style={styles.profileDetail}>{session.user.phone}</Text>}
                  {Boolean(session.user.digipin) && (
                    <Pressable onPress={() => void openMapplsMap(session.user.digipin)} style={styles.digipinRow}>
                      <Text style={styles.profileDetail}>⌖ DIGIPIN: {formatDigipin(session.user.digipin)}</Text>
                      <Text style={styles.mapplsPillSmall}>Mappls Map ↗</Text>
                    </Pressable>
                  )}
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
                  <Text style={styles.signOutText}>🚪   Sign out</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.pageTitle}>Guest User</Text>
                <View style={styles.profileCard}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>👤</Text></View>
                  <Text style={styles.profileName}>Browsing as Guest</Text>
                  <Text style={styles.customerBadge}>NOT SIGNED IN</Text>
                  <Text style={styles.profileDetail}>Sign in to save addresses, track orders and pay securely.</Text>
                </View>
                <Pressable
                  onPress={() => onRequestSignIn ? onRequestSignIn() : onSignOut()}
                  style={[styles.menuLink, { backgroundColor: '#d83a32', borderRadius: 12, marginTop: 14 }]}
                >
                  <Text style={[styles.menuLinkText, { color: '#ffffff', fontWeight: '800' }]}>🔑   Sign in / Register</Text>
                  <Text style={[styles.chevron, { color: '#ffffff' }]}>›</Text>
                </Pressable>
              </>
            )}
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

      <PaymentModal
        visible={paymentModalVisible}
        amount={estimatedTotal}
        storeName={selectedStore?.name || (cart[0] && getItemStoreName(cart[0])) || 'Tomato'}
        initialMethod={selectedPaymentMethod}
        initialUpiId={upiId}
        initialCard={cardForm}
        initialBank={selectedBank}
        onClose={() => setPaymentModalVisible(false)}
        onSuccess={completeOrderWithPayment}
      />

      <Modal
        animationType="fade"
        transparent
        visible={logoutModalVisible}
        onRequestClose={() => {
          if (!isLoggingOut) setLogoutModalVisible(false);
        }}
      >
        <Pressable
          style={styles.logoutModalBackdrop}
          onPress={() => {
            if (!isLoggingOut) setLogoutModalVisible(false);
          }}
        >
          <Pressable style={styles.logoutModalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.logoutModalIconWrap}>
              <Text style={styles.logoutModalIcon}>🚪</Text>
            </View>
            <Text style={styles.logoutModalTitle}>Sign out from Tomato?</Text>
            <Text style={styles.logoutModalMessage}>
              Are you sure you want to sign out? You can sign back in at any time to access your orders, cart, and profile.
            </Text>
            <View style={styles.logoutModalActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="No, Stay"
                disabled={isLoggingOut}
                onPress={() => setLogoutModalVisible(false)}
                style={[styles.logoutModalBtn, styles.logoutCancelBtn]}
              >
                <Text style={styles.logoutCancelBtnText}>No, Stay</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="yes, Sign out"
                disabled={isLoggingOut}
                onPress={() => void performSignOut()}
                style={[styles.logoutModalBtn, styles.logoutConfirmBtn]}
              >
                <Text style={styles.logoutConfirmBtnText}>
                  {isLoggingOut ? 'Signing out...' : 'yes, Sign out'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {toastInfo && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.cartToastContainer,
            {
              opacity: toastFadeAnim,
              transform: [{ translateY: toastTranslateAnim }],
            },
          ]}
        >
          <Pressable
            accessibilityRole="alert"
            accessibilityLabel={`item ${toastInfo.name}   ${formatRupees(toastInfo.price)} added to cart.`}
            onPress={() => {
              if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
              setToastInfo(null);
            }}
            style={styles.cartToastCard}
          >
            <View style={styles.cartToastIconBubble}>
              <Text style={styles.cartToastIcon}>✓</Text>
            </View>
            <View style={styles.cartToastContent}>
              <Text style={styles.cartToastText}>
                item <Text style={styles.cartToastItemName}>{toastInfo.name}</Text>   <Text style={styles.cartToastPrice}>{formatRupees(toastInfo.price)}</Text> added to cart.
              </Text>
            </View>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Dismiss notification"
              onPress={() => {
                if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
                setToastInfo(null);
              }}
              style={styles.cartToastCloseBtn}
            >
              <Text style={styles.cartToastCloseText}>×</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

type DynamicHighlight = {
  id: string;
  type: 'craving' | 'offer' | 'ad' | 'message';
  badge: string;
  badgeBg: string;
  badgeColor: string;
  text: string;
  subtext?: string;
  actionText?: string;
  couponCode?: string;
};

const DEFAULT_HIGHLIGHTS: DynamicHighlight[] = [
  {
    id: 'craving',
    type: 'craving',
    badge: 'CRAVING',
    badgeBg: '#dc2626',
    badgeColor: '#ffffff',
    text: 'WHAT ARE YOU CRAVING?',
    subtext: 'Explore top kitchens & neighborhood shops near you',
  },
  {
    id: 'offer-1',
    type: 'offer',
    badge: 'OFFER',
    badgeBg: '#ea580c',
    badgeColor: '#ffffff',
    text: 'FLAT ₹100 OFF on ₹299+',
    subtext: 'Use code FEAST100 at checkout',
    couponCode: 'FEAST100',
    actionText: 'Apply',
  },
  {
    id: 'ad-grocery',
    type: 'ad',
    badge: 'PROMO',
    badgeBg: '#2563eb',
    badgeColor: '#ffffff',
    text: 'Shop grocery & dairy fresh!',
    subtext: 'Delivered in minutes from neighborhood marts',
  },
  {
    id: 'offer-free-delivery',
    type: 'offer',
    badge: 'FREE DELIVERY',
    badgeBg: '#059669',
    badgeColor: '#ffffff',
    text: 'Free delivery on orders ₹199+',
    subtext: 'No coupon needed, auto-applied at checkout',
  },
  {
    id: 'msg-fresh',
    type: 'message',
    badge: 'FRESH',
    badgeBg: '#7c3aed',
    badgeColor: '#ffffff',
    text: 'Local kitchens, delivered hot!',
    subtext: 'FSSAI hygienic verified partners only',
  },
];

function DynamicTicker({
  coupons,
  onSelectCoupon,
}: {
  coupons: Coupon[];
  onSelectCoupon: (code: string) => void;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const animFade = useRef(new Animated.Value(1)).current;
  const animY = useRef(new Animated.Value(0)).current;

  const highlights = useMemo<DynamicHighlight[]>(() => {
    const list = [...DEFAULT_HIGHLIGHTS];
    for (const c of coupons.slice(0, 4)) {
      list.push({
        id: `coupon-${c.code}`,
        type: 'offer',
        badge: 'DISCOUNT',
        badgeBg: '#d97706',
        badgeColor: '#ffffff',
        text: `${c.code}: ${c.title || c.description || 'Special Discount'}`,
        subtext: c.description || c.title,
        couponCode: c.code,
        actionText: 'Apply',
      });
    }
    return list;
  }, [coupons]);

  useEffect(() => {
    if (highlights.length <= 1) return;
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(animFade, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(animY, {
          toValue: -12,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setIndex((prev) => (prev + 1) % highlights.length);
        animY.setValue(12);
        Animated.parallel([
          Animated.timing(animFade, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(animY, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [highlights.length, animFade, animY]);

  const current = highlights[index] || highlights[0];
  if (!current) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View offers, ads and messages"
        onPress={() => setModalVisible(true)}
        style={styles.dynamicTickerWrapper}
      >
        <Animated.View
          style={[
            styles.dynamicTickerContent,
            {
              opacity: animFade,
              transform: [{ translateY: animY }],
            },
          ]}
        >
          <View
            style={[
              styles.dynamicTickerBadge,
              { backgroundColor: current.badgeBg },
            ]}
          >
            <Text
              style={[
                styles.dynamicTickerBadgeText,
                { color: current.badgeColor },
              ]}
            >
              {current.badge}
            </Text>
          </View>
          <Text numberOfLines={1} style={styles.dynamicTickerText}>
            {current.text}
          </Text>
          <Text style={styles.dynamicTickerSparkle}>›</Text>
        </Animated.View>
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.dynamicModalBackdrop}
          onPress={() => setModalVisible(false)}
        >
          <Pressable style={styles.dynamicModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.dynamicModalHeader}>
              <View style={styles.dynamicModalHeaderTitleRow}>
                <Text style={styles.dynamicModalIcon}>✨</Text>
                <Text style={styles.dynamicModalTitle}>Offers & Highlights</Text>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                style={styles.dynamicModalClose}
              >
                <Text style={styles.dynamicModalCloseText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.dynamicModalScroll} showsVerticalScrollIndicator={false}>
              {highlights.map((item) => (
                <View key={item.id} style={styles.dynamicModalItem}>
                  <View style={styles.dynamicModalItemTop}>
                    <View
                      style={[
                        styles.dynamicTickerBadge,
                        { backgroundColor: item.badgeBg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dynamicTickerBadgeText,
                          { color: item.badgeColor },
                        ]}
                      >
                        {item.badge}
                      </Text>
                    </View>
                    {item.couponCode && (
                      <Pressable
                        onPress={() => {
                          setModalVisible(false);
                          onSelectCoupon(item.couponCode!);
                        }}
                        style={styles.dynamicModalApplyBtn}
                      >
                        <Text style={styles.dynamicModalApplyText}>APPLY</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.dynamicModalItemText}>{item.text}</Text>
                  {!!item.subtext && (
                    <Text style={styles.dynamicModalItemSubtext}>
                      {item.subtext}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function StoreCardWithSlider({
  store,
  isSelected,
  onSelect,
  menuItems,
  allMenuItems,
  dietaryFilter,
  mode,
  onAddItem,
}: {
  store: Store;
  isSelected: boolean;
  onSelect: () => void;
  menuItems: MenuItem[];
  allMenuItems: MenuItem[];
  dietaryFilter: 'all' | 'veg' | 'non-veg';
  mode: BrowseMode;
  onAddItem: (item: MenuItem) => void;
}) {
  const { hasVeg, hasNonVeg } = getStoreDietary(store, menuItems);

  // Collect all items available inside this restaurant
  const storeItems = useMemo(() => {
    let items = menuItems.filter((item) => {
      if (item.isActive === false || item.isAvailable === false) return false;
      return itemBelongsToStore(item, store);
    });

    if (!items.length) {
      items = allMenuItems.filter((item) => {
        if (item.isActive === false || item.isAvailable === false) return false;
        return itemBelongsToStore(item, store);
      });
    }

    if (dietaryFilter === 'veg') {
      items = items.filter((item) => isItemVeg(item));
    } else if (dietaryFilter === 'non-veg') {
      items = items.filter((item) => !isItemVeg(item));
    }

    return items.filter(Boolean);
  }, [menuItems, allMenuItems, store, dietaryFilter]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemImageError, setItemImageError] = useState(false);
  const [storeAvatarError, setStoreAvatarError] = useState(false);
  const [storeFallbackError, setStoreFallbackError] = useState(false);
  const isShopStore = Boolean(mode === 'shop' || (store as any).type === 'shop' || (store as any).isShop || Boolean(store.shopAddress));
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Reset index if store items change or shrink
  useEffect(() => {
    if (currentIndex >= storeItems.length && storeItems.length > 0) {
      setCurrentIndex(0);
    }
  }, [storeItems.length, currentIndex]);

  // Auto-sliding every 3.5 seconds across all available items
  useEffect(() => {
    if (storeItems.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % storeItems.length);
    }, 3500);

    return () => clearInterval(interval);
  }, [storeItems.length]);

  // Smooth slide and fade animation when item changes
  useEffect(() => {
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [currentIndex, slideAnim]);

  const activeItem = (storeItems && storeItems.length > 0)
    ? (storeItems[currentIndex] || storeItems[0])
    : undefined;

  const isShopItem = Boolean(
    isShopStore ||
    activeItem?.isShopItem ||
    (activeItem as any)?.storeType === 'shop' ||
    (activeItem as any)?.mode === 'shop' ||
    (activeItem as any)?.isShop
  );
  const hasCustomItemImage = Boolean(activeItem?.image && !itemImageError);

  useEffect(() => {
    setItemImageError(false);
  }, [currentIndex, activeItem?._id, activeItem?.image]);

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  const opacity = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });

  const isClosed = store.isOpen === false || store.isOnline === false;

  if (!isStoreOpen(store)) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${store.name}`}
      onPress={onSelect}
      style={[styles.storeCard, isSelected && styles.storeCardSelected]}
    >
      {/* Restaurant Header */}
      <View style={styles.storeCardHeader}>
        <View style={styles.storeCardAvatarWrap}>
          {store.image && !storeAvatarError ? (
            <Image
              source={{ uri: apiPath(store.image) }}
              style={styles.storeCardAvatar}
              onError={() => setStoreAvatarError(true)}
            />
          ) : (
            <View
              style={[
                styles.storeCardAvatarPlaceholder,
                isShopStore ? styles.shopDefaultImageBg : styles.restaurantDefaultImageBg,
              ]}
            >
              <Image
                source={getDefaultStoreLogo(isShopStore)}
                style={styles.storeCardAvatarIcon}
                resizeMode="contain"
              />
            </View>
          )}
        </View>

        <View style={styles.storeCardInfo}>
          <View style={styles.storeCardNameRow}>
            <Text numberOfLines={1} style={styles.storeCardName}>
              {store.name}
            </Text>
            <View style={styles.storeDietaryBadges}>
              {hasVeg && <VegBadge size={10} />}
              {hasNonVeg && <NonVegBadge size={10} />}
            </View>
          </View>

          <View style={styles.storeCardMetaRow}>
            {!!store.rating && (
              <View style={styles.storeCardRatingBadge}>
                <Text style={styles.storeCardRatingText}>★ {store.rating}</Text>
              </View>
            )}
            <Text numberOfLines={1} style={styles.storeCardCuisine}>
              {store.cuisine || store.category || (isClosed ? 'Closed' : 'Open')}
              {store.distanceText ? ` · ${store.distanceText}` : ''}
            </Text>
          </View>
        </View>
      </View>

      {/* Items Slider: shows all items available inside it & slides */}
      {storeItems.length > 0 && activeItem ? (
        <View style={styles.storeItemsSliderBox}>
          {/* Square Item Box */}
          <Animated.View
            style={[
              styles.slidingItemSquareBox,
              {
                opacity,
                transform: [{ translateX }],
              },
            ]}
          >
            {/* Dish / Product Image in Square Area */}
            <View style={styles.slidingItemSquareImageWrap}>
              {hasCustomItemImage ? (
                <Image
                  source={{ uri: apiPath(activeItem.image) }}
                  style={styles.slidingItemSquareImage}
                  resizeMode="cover"
                  onError={() => setItemImageError(true)}
                />
              ) : (
                <View
                  style={[
                    styles.defaultItemImageContainer,
                    isShopItem ? styles.shopDefaultImageBg : styles.restaurantDefaultImageBg,
                  ]}
                >
                  <Image
                    source={getDefaultItemImage(isShopItem)}
                    style={styles.defaultItemImage}
                    resizeMode="contain"
                  />
                </View>
              )}
              <View style={styles.slidingItemSquareHeaderRow}>
                <View style={[styles.slidingItemSquareBadgeAndName, !activeItem.category && styles.flex]}>
                  {isItemVeg(activeItem) ? <VegBadge size={10} /> : <NonVegBadge size={10} />}
                  <Text numberOfLines={1} style={styles.slidingItemSquareNameBesideBadge}>
                    {activeItem.name}
                  </Text>
                </View>
                {!!activeItem.category && (
                  <View style={styles.slidingItemSquareCategoryCorner}>
                    <Text numberOfLines={1} style={styles.slidingItemSquareCategoryText}>
                      {activeItem.category}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Dish / Product Details */}
            <View style={styles.slidingItemSquareDetails}>
              <View style={styles.menuSquareTopRow}>
                <Text numberOfLines={1} style={[styles.slidingItemSquareDescription, styles.flex]}>
                  {activeItem.description?.trim() || activeItem.category || 'Fresh & delicious'}
                </Text>
                {!!activeItem.rating && (
                  <Text style={styles.menuSquareRating}>★ {activeItem.rating}</Text>
                )}
              </View>

              <View style={styles.slidingItemSquareBottomRow}>
                <Text style={styles.slidingItemSquarePrice}>{formatRupees(activeItem.price)}</Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${activeItem.name} to cart`}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onAddItem(activeItem);
                  }}
                  style={styles.slidingItemSquareAddBtn}
                >
                  <Text style={styles.slidingItemSquareAddBtnText}>+ ADD</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>

          {/* Pagination Dots */}
          {storeItems.length > 1 && (
            <View style={styles.sliderDotsRow}>
              {storeItems.map((_, dotIndex) => (
                <Pressable
                  key={dotIndex}
                  hitSlop={5}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setCurrentIndex(dotIndex);
                  }}
                  style={[
                    styles.sliderDot,
                    currentIndex === dotIndex && styles.sliderDotActive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        /* Fallback if no items currently match */
        <View style={styles.storeNoItemsBox}>
          {store.image && !storeFallbackError ? (
            <Image
              source={{ uri: apiPath(store.image) }}
              style={styles.storeCardFallbackImage}
              onError={() => setStoreFallbackError(true)}
            />
          ) : (
            <View
              style={[
                styles.storeCardAvatarPlaceholderLarge,
                isShopStore ? styles.shopDefaultImageBg : styles.restaurantDefaultImageBg,
              ]}
            >
              <Image
                source={getDefaultStoreLogo(isShopStore)}
                style={styles.storeCardAvatarIconLarge}
                resizeMode="contain"
              />
            </View>
          )}
          <Text style={styles.storeNoItemsText}>
            Tap to explore {mode === 'shop' ? 'items' : 'menu'}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function MenuCard({
  item,
  onAdd,
  closed = false,
  storeName,
  onPressStore,
  isShop,
}: {
  item: MenuItem;
  onAdd: (variant?: ItemVariant) => void;
  closed?: boolean;
  storeName?: string;
  onPressStore?: () => void;
  isShop?: boolean;
}) {
  const variants = useMemo(() => (item ? getItemVariants(item) : []), [item]);
  const [selectedVariant, setSelectedVariant] = useState<ItemVariant>(() => (variants[0] || (item ? { id: 'default', name: 'Regular', price: item.price } : { id: 'default', name: 'Regular', price: 0 })));
  const [variantPickerVisible, setVariantPickerVisible] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [item?._id, item?.image]);

  if (!item) return null;
  const unavailable = closed || (item.quantity !== undefined && item.quantity <= 0);
  const isVeg = isItemVeg(item);
  const isShopItem = Boolean(
    isShop ?? (
      item.isShopItem ||
      (item as any).storeType === 'shop' ||
      (item as any).mode === 'shop' ||
      (item as any).isShop
    )
  );
  const hasCustomImage = Boolean(item.image && !imageError);

  return (
    <View style={styles.menuCardSquare}>
      {/* Top: Square Image */}
      <View style={styles.menuSquareImageWrap}>
        {hasCustomImage ? (
          <Image
            source={{ uri: apiPath(item.image) }}
            style={styles.menuSquareImage}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View
            style={[
              styles.defaultItemImageContainer,
              isShopItem ? styles.shopDefaultImageBg : styles.restaurantDefaultImageBg,
            ]}
          >
            <Image
              source={getDefaultItemImage(isShopItem)}
              style={styles.defaultItemImage}
              resizeMode="contain"
            />
          </View>
        )}
        <View style={styles.menuSquareHeaderRow}>
          <View style={[styles.menuSquareBadgeAndName, !item.category && styles.flex]}>
            {isVeg ? <VegBadge size={10} /> : <NonVegBadge size={10} />}
            <Text numberOfLines={1} style={styles.menuSquareNameBesideBadge}>
              {item.name}
            </Text>
          </View>
          {!!item.category && (
            <View style={styles.menuSquareCategoryBadge}>
              <Text numberOfLines={1} style={styles.menuSquareCategoryText}>
                {item.category}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Bottom: Item Details (Highly Translucent) */}
      <View style={styles.menuSquareDetails}>
        <View style={styles.menuSquareTopRow}>
          <Text numberOfLines={1} style={styles.menuSquareDescription}>
            {item.description?.trim() || item.category || 'Fresh & delicious'}
          </Text>
          {!!item.rating && (
            <Text style={styles.menuSquareRating}>★ {item.rating}</Text>
          )}
        </View>

        <View style={styles.menuSquareBottomRow}>
          <View style={styles.menuSquarePriceAndVariant}>
            <Text style={styles.menuSquarePrice}>{formatRupees(selectedVariant.price)}</Text>
            {variants.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select variant for ${item.name}. Currently ${selectedVariant.name}`}
                onPress={() => setVariantPickerVisible(true)}
                style={styles.menuSquareVariantPill}
              >
                <Text numberOfLines={1} style={styles.menuSquareVariantText}>
                  {selectedVariant.name}
                </Text>
                <Text style={styles.menuSquareVariantCaret}>▾</Text>
              </Pressable>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={unavailable}
            onPress={() => onAdd(selectedVariant)}
            style={[styles.menuSquareAddBtn, unavailable && styles.addButtonDisabled]}
          >
            <Text style={[styles.menuSquareAddBtnText, unavailable && styles.closedText]}>
              {closed ? 'CLOSED' : item.quantity !== undefined && item.quantity <= 0 ? 'SOLD' : '+ ADD'}
            </Text>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={variantPickerVisible}
        onRequestClose={() => setVariantPickerVisible(false)}
      >
        <Pressable
          style={styles.variantModalBackdrop}
          onPress={() => setVariantPickerVisible(false)}
        >
          <Pressable style={styles.variantModalCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.variantModalHeader}>
              <View style={styles.variantModalTitleRow}>
                <Text style={styles.variantModalIcon}>🍽️</Text>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={styles.variantModalTitle}>{item.name}</Text>
                  <Text style={styles.variantModalSubtitle}>Choose size or portion</Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Close variant selector"
                onPress={() => setVariantPickerVisible(false)}
                style={styles.variantModalCloseBtn}
              >
                <Text style={styles.variantModalCloseText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.variantOptionsList}>
              {variants.map((v) => {
                const isSelected = v.id === selectedVariant.id;
                return (
                  <Pressable
                    key={v.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      setSelectedVariant(v);
                      setVariantPickerVisible(false);
                    }}
                    style={[
                      styles.variantOptionRow,
                      isSelected && styles.variantOptionRowSelected,
                    ]}
                  >
                    <View style={[styles.variantRadioCircle, isSelected && styles.variantRadioCircleSelected]}>
                      {isSelected && <View style={styles.variantRadioInnerDot} />}
                    </View>
                    <Text style={[styles.variantOptionName, isSelected && styles.variantOptionNameSelected]}>
                      {v.name}
                    </Text>
                    <Text style={[styles.variantOptionPrice, isSelected && styles.variantOptionPriceSelected]}>
                      {formatRupees(v.price)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#fffaf5' },
  flex: { flex: 1 },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e9e2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandAnimatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  brand: { fontSize: 19, fontWeight: '900', color: '#d83a32', letterSpacing: -0.4 },
  headerLeft: { flex: 1, minWidth: 0, marginRight: 8 },
  brandSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  headerSearchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderWidth: 1.5,
    borderColor: '#14532d',
    borderRadius: 18,
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  headerSearchIcon: { fontSize: 11, marginRight: 2, color: '#14532d' },
  headerSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: '#1a1a1a',
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 3,
    margin: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  headerSearchClear: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#e7efe8',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 3,
  },
  headerSearchClearText: { fontSize: 10, color: '#14532d', fontWeight: '800' },
  deliveringButton: { flex: 1, minWidth: 0, paddingRight: 8 },
  deliveringRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 4 },
  delivering: { color: '#766b63', fontSize: 12, flexShrink: 1 },
  dropdownCaret: { color: '#d83a32', fontSize: 13, fontWeight: '800', paddingLeft: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  headerIconButton: { height: 36, width: 36, borderRadius: 18, backgroundColor: '#f7f2ed', alignItems: 'center', justifyContent: 'center' },
  notificationIcon: { fontSize: 15, color: '#4a4037' },
  headerCartIcon: { fontSize: 15, color: '#4a4037' },
  headerCartBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#d83a32',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  headerCartBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  errorBanner: { marginHorizontal: 16, marginTop: 10, padding: 11, backgroundColor: '#fff1f0', borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  errorText: { color: '#b42318', fontSize: 13, lineHeight: 18, flex: 1 },
  errorDismiss: { color: '#b42318', fontSize: 22, paddingLeft: 8 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 26, flexGrow: 1 },
  headerEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 6,
  },
  dynamicTickerWrapper: {
    flex: 1,
    minWidth: 0,
    marginRight: 6,
    height: 32,
    backgroundColor: '#fff4eb',
    borderWidth: 1.5,
    borderColor: '#fed7aa',
    borderRadius: 16,
    paddingHorizontal: 8,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#d83a32',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  dynamicTickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dynamicTickerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  dynamicTickerBadgeText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.4,
  },
  dynamicTickerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.2,
  },
  dynamicTickerSparkle: {
    fontSize: 15,
    color: '#b91c1c',
    fontWeight: '900',
    marginRight: 1,
  },
  dynamicModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 15, 12, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dynamicModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
    maxHeight: '75%',
  },
  dynamicModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e8e0',
    marginBottom: 10,
  },
  dynamicModalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dynamicModalIcon: {
    fontSize: 16,
  },
  dynamicModalTitle: {
    color: '#28221e',
    fontSize: 14,
    fontWeight: '800',
  },
  dynamicModalClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#f6ede5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dynamicModalCloseText: {
    color: '#695f56',
    fontSize: 12,
    fontWeight: '700',
  },
  dynamicModalScroll: {
    maxHeight: 320,
  },
  dynamicModalItem: {
    backgroundColor: '#fffaf6',
    borderWidth: 1,
    borderColor: '#f2e7de',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  dynamicModalItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dynamicModalItemText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 17,
  },
  dynamicModalItemSubtext: {
    color: '#52453c',
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 2,
  },
  dynamicModalApplyBtn: {
    backgroundColor: '#d83a32',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dynamicModalApplyText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  compactModeSwitch: { flexDirection: 'row', backgroundColor: '#f4ece5', borderRadius: 22, padding: 3, borderWidth: 2, borderColor: '#1a73e8' },
  compactModeButton: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 18 },
  compactModeButtonActive: { backgroundColor: '#d83a32', shadowColor: '#d83a32', shadowOpacity: 0.2, shadowRadius: 3, elevation: 2 },
  compactModeText: { fontSize: 11, color: '#6e645c', fontWeight: '700' },
  compactModeTextActive: { color: '#fff', fontWeight: '800' },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#d83a32', letterSpacing: 1.4, marginBottom: 7 },
  titleDietaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    gap: 6,
  },
  heroBannerContainer: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f0e3d8',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  floatingDietaryToggleContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.84)', // Translucent!
    borderRadius: 20,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(235, 225, 215, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  heroBannerTrack: {
    flexDirection: 'row',
  },
  heroBannerSlide: {
    minHeight: 126,
    paddingTop: 12,
    paddingBottom: 28,
    paddingLeft: 14,
    paddingRight: 110, // Leaves room for floating toggle on top-right!
    justifyContent: 'center',
    position: 'relative',
  },
  heroBannerTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    marginBottom: 6,
  },
  heroBannerTagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  heroBannerTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#28221e',
    letterSpacing: -0.4,
    marginBottom: 3,
  },
  heroBannerSubtitle: {
    fontSize: 11.5,
    lineHeight: 15.5,
    color: '#6e635b',
    fontWeight: '500',
  },
  heroBannerDecorEmojis: {
    position: 'absolute',
    right: 12,
    bottom: 8,
    flexDirection: 'row',
    gap: 4,
    opacity: 0.28,
  },
  heroBannerEmoji: {
    fontSize: 32,
  },
  heroPaginationRow: {
    position: 'absolute',
    bottom: 8,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 10,
  },
  heroPaginationDot: {
    width: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(60, 50, 45, 0.2)',
  },
  heroPaginationDotActive: {
    width: 18,
    backgroundColor: '#d83a32',
  },
  dietaryToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3ece5',
    borderRadius: 14,
    padding: 2,
    borderWidth: 1,
    borderColor: '#e5dbd1',
    flexShrink: 0,
  },
  dietaryToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 11,
  },
  dietaryToggleBtnActiveAll: {
    backgroundColor: '#28221e',
  },
  dietaryToggleBtnActiveVeg: {
    backgroundColor: '#eaf6ed',
    borderWidth: 1,
    borderColor: '#0f8a3c',
  },
  dietaryToggleBtnActiveNonVeg: {
    backgroundColor: '#fef1f0',
    borderWidth: 1,
    borderColor: '#d83a32',
  },
  dietaryToggleText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#6e645c',
  },
  dietaryToggleTextActiveAll: {
    color: '#ffffff',
    fontWeight: '800',
  },
  dietaryToggleTextActiveVeg: {
    color: '#0f8a3c',
    fontWeight: '800',
  },
  dietaryToggleTextActiveNonVeg: {
    color: '#d83a32',
    fontWeight: '800',
  },
  pageTitle: {
    flex: 1,
    color: '#28221e',
    fontWeight: '800',
    fontSize: 18.5,
    letterSpacing: -0.4,
  },
  pageSubtitle: {
    color: '#80766e',
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
    lineHeight: 16,
  },
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
  categoriesSection: {
    marginTop: 4,
    marginBottom: 16,
  },
  categoriesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  categoriesHeaderTitle: {
    color: '#28221e',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  clearCategoryBtn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  clearCategoryText: {
    color: '#d83a32',
    fontSize: 11,
    fontWeight: '700',
  },
  categoryScrollContainer: {
    paddingBottom: 6,
    gap: 10,
  },
  categoryItemWrapper: {
    alignItems: 'center',
    width: 74,
  },
  categorySquareBox: {
    width: 74,
    height: 74,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#eee3da',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    position: 'relative',
  },
  categorySquareBoxActive: {
    borderColor: '#d83a32',
    borderWidth: 2.5,
    backgroundColor: '#fff5f2',
    shadowColor: '#d83a32',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 3,
  },
  categoryFullImage: {
    width: '100%',
    height: '100%',
  },
  categoryEmojiPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#fff7f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryFullEmoji: {
    fontSize: 38,
  },
  categoryNameBelow: {
    fontSize: 11,
    fontWeight: '700',
    color: '#473d36',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 74,
  },
  categoryNameBelowActive: {
    color: '#d83a32',
    fontWeight: '800',
  },
  sectionTitle: { color: '#28221e', fontSize: 17, fontWeight: '800', marginBottom: 12 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  link: { color: '#d83a32', fontSize: 13, fontWeight: '700' },
  storeRow: { paddingBottom: 8, gap: 12 },
  storeCard: {
    backgroundColor: '#ffffff',
    borderColor: '#eee3da',
    borderWidth: 1.5,
    borderRadius: 18,
    width: 275,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  storeCardSelected: {
    borderColor: '#d83a32',
    backgroundColor: '#fffdfb',
    borderWidth: 2,
    padding: 9.5,
  },
  storeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeCardAvatarWrap: {
    marginRight: 9,
  },
  storeCardAvatar: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f5ebe4',
  },
  storeCardAvatarPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#fff1e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeCardAvatarEmoji: {
    fontSize: 18,
  },
  storeCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  storeCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  storeCardName: {
    flex: 1,
    color: '#28221e',
    fontSize: 13.5,
    fontWeight: '800',
  },
  storeCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  storeCardRatingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  storeCardRatingText: {
    color: '#b45309',
    fontSize: 9.5,
    fontWeight: '800',
  },
  storeCardCuisine: {
    flex: 1,
    color: '#85786f',
    fontSize: 10.5,
  },
  storeItemsSliderBox: {
    marginTop: 4,
  },
  storeItemsSliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sliderTagWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderTagText: {
    color: '#b42318',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sliderCounterText: {
    color: '#8a7e75',
    fontSize: 9,
    fontWeight: '700',
  },
  sliderNavControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderArrowBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#f4eae1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderArrowText: {
    color: '#554a42',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  slidingItemSquareBox: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#eee4db',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    position: 'relative',
    height: 140,
  },
  slidingItemSquareImageWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: '#fbf5f0',
    position: 'relative',
    overflow: 'hidden',
  },
  slidingItemSquareImage: {
    width: '100%',
    height: '100%',
  },
  slidingItemSquarePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 35,
    backgroundColor: '#fff2eb',
  },
  slidingItemSquareEmoji: {
    fontSize: 32,
  },
  slidingItemSquareHeaderRow: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  slidingItemSquareBadgeAndName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    maxWidth: '74%',
  },
  slidingItemSquareNameBesideBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1e293b',
    flexShrink: 1,
  },
  slidingItemSquareBadgeCorner: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 4,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  slidingItemSquareCategoryCorner: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  slidingItemSquareCategoryText: {
    color: '#d83a32',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  slidingItemSquareDetails: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.55)',
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 6,
  },
  slidingItemSquareDescription: {
    color: '#1e293b',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    textShadowColor: 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  slidingItemSquareName: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  slidingItemSquareBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slidingItemSquarePrice: {
    color: '#14532d',
    fontSize: 13,
    fontWeight: '900',
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  slidingItemSquareAddBtn: {
    backgroundColor: '#d83a32',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  slidingItemSquareAddBtnText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  slidingItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 11,
    padding: 6,
    borderWidth: 1,
    borderColor: '#f0e5dc',
  },
  slidingItemImageWrap: {
    position: 'relative',
    width: 58,
    height: 58,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#fbf5f0',
  },
  slidingItemImage: {
    width: '100%',
    height: '100%',
  },
  slidingItemImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff2eb',
  },
  slidingItemEmoji: {
    fontSize: 24,
  },
  slidingItemBadgeCorner: {
    position: 'absolute',
    top: 3,
    left: 3,
    backgroundColor: '#ffffff',
    borderRadius: 3,
    padding: 1,
  },
  slidingItemDetails: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
  },
  slidingItemCategory: {
    color: '#d83a32',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  slidingItemName: {
    color: '#2d251f',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  slidingItemPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slidingItemPrice: {
    color: '#15803d',
    fontSize: 12.5,
    fontWeight: '800',
  },
  slidingItemAddBtn: {
    backgroundColor: '#d83a32',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  slidingItemAddBtnText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
  },
  sliderDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 6,
  },
  sliderDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e6dad0',
  },
  sliderDotActive: {
    width: 12,
    backgroundColor: '#d83a32',
  },
  storeNoItemsBox: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  storeCardFallbackImage: {
    width: '100%',
    height: 70,
    borderRadius: 10,
    backgroundColor: '#f5ebe4',
    marginBottom: 4,
  },
  storeCardAvatarPlaceholderLarge: {
    width: '100%',
    height: 60,
    borderRadius: 10,
    backgroundColor: '#fff1e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  storeNoItemsText: {
    color: '#94877e',
    fontSize: 10,
    fontWeight: '600',
  },
  storeImage: { width: '100%', height: 78, borderRadius: 10, backgroundColor: '#f6ebe3' },
  storeImagePlaceholder: { width: '100%', height: 78, borderRadius: 10, backgroundColor: '#fff0e8', alignItems: 'center', justifyContent: 'center' },
  storeEmoji: { fontSize: 30 },
  storeNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  storeName: { flex: 1, color: '#2d2621', fontSize: 13, fontWeight: '700', marginRight: 4 },
  storeDietaryBadges: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  selectedStoreHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  storeMeta: { color: '#877c73', fontSize: 11, marginTop: 3 },
  menuItemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  menuCardSquare: {
    width: '48.2%',
    minHeight: 184,
    aspectRatio: 1,
    backgroundColor: '#ffffff',
    borderColor: '#eee4db',
    borderWidth: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 2,
    position: 'relative',
  },
  menuSquareImageWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: '#fbf6f0',
    position: 'relative',
    overflow: 'hidden',
  },
  menuSquareImage: {
    width: '100%',
    height: '100%',
  },
  menuSquareImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 45,
    backgroundColor: '#fff1e9',
  },
  menuSquareEmoji: {
    fontSize: 40,
  },
  defaultItemImageContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 28,
  },
  defaultItemImage: {
    width: 60,
    height: 60,
  },
  restaurantDefaultImageBg: {
    backgroundColor: '#fff1f0',
  },
  shopDefaultImageBg: {
    backgroundColor: '#fef9ee',
  },
  storeCardAvatarIcon: {
    width: 24,
    height: 24,
  },
  storeCardAvatarIconLarge: {
    width: 38,
    height: 38,
  },
  menuSquareHeaderRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  menuSquareBadgeAndName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    maxWidth: '74%',
  },
  menuSquareNameBesideBadge: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1e293b',
    flexShrink: 1,
  },
  menuSquareBadgeCorner: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 5,
    padding: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  menuSquareCategoryBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  menuSquareCategoryText: {
    color: '#d83a32',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  menuSquareDetails: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.55)',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 7,
  },
  menuSquareTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    marginBottom: 3,
  },
  menuSquareDescription: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#1e293b',
    textShadowColor: 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginRight: 4,
  },
  menuSquareName: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '900',
    color: '#111827',
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginRight: 4,
  },
  menuSquareRating: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#92400e',
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  menuSquareBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  menuSquarePrice: {
    fontSize: 13,
    fontWeight: '900',
    color: '#14532d',
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  menuSquarePriceAndVariant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  menuSquareVariantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#fff4ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
  },
  menuSquareVariantText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#c2410c',
  },
  menuSquareVariantCaret: {
    fontSize: 8,
    fontWeight: '800',
    color: '#ea580c',
  },
  variantModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.60)',
    justifyContent: 'flex-end',
  },
  variantModalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'android' ? 24 : 34,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
  },
  variantModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e8e0',
    marginBottom: 8,
  },
  variantModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  variantModalIcon: {
    fontSize: 22,
  },
  variantModalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
  },
  variantModalSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  variantModalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantModalCloseText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  variantOptionsList: {
    paddingVertical: 4,
    gap: 8,
  },
  variantOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  variantOptionRowSelected: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
  },
  variantRadioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  variantRadioCircleSelected: {
    borderColor: '#ea580c',
  },
  variantRadioInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ea580c',
  },
  variantOptionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  variantOptionNameSelected: {
    color: '#c2410c',
    fontWeight: '800',
  },
  variantOptionPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: '#15803d',
  },
  variantOptionPriceSelected: {
    color: '#166534',
  },
  menuSquareAddBtn: {
    backgroundColor: '#d83a32',
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuSquareAddBtnText: {
    color: '#ffffff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  menuCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 17, padding: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
  menuImage: { width: 78, height: 78, borderRadius: 12, backgroundColor: '#f5ebe4' },
  menuImagePlaceholder: { width: 78, height: 78, borderRadius: 12, backgroundColor: '#fff1e9', alignItems: 'center', justifyContent: 'center' },
  menuEmoji: { fontSize: 31 },
  menuDetails: { flex: 1, paddingHorizontal: 11, alignSelf: 'stretch', justifyContent: 'center' },
  menuItemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  menuCategory: { color: '#d83a32', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  itemName: { color: '#302923', fontSize: 14, fontWeight: '700' },
  itemStoreRow: { marginTop: 2, marginBottom: 2, alignSelf: 'flex-start' },
  itemStoreText: { color: '#b91c1c', fontSize: 11, fontWeight: '700' },
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
  addressOptionUnserviceable: { borderColor: '#fca5a5', backgroundColor: '#fff8f8' },
  addressNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  addressUnserviceableBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: '#f87171' },
  addressUnserviceableText: { color: '#b91c1c', fontSize: 10.5, fontWeight: '700' },
  addressServiceableBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: '#86efac' },
  addressServiceableText: { color: '#15803d', fontSize: 10.5, fontWeight: '700' },
  tooFarBanner: { backgroundColor: '#fff1f0', borderColor: '#fca5a5', borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 16 },
  tooFarHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  tooFarIcon: { fontSize: 18 },
  tooFarTitle: { fontSize: 15, fontWeight: '800', color: '#b91c1c' },
  tooFarText: { fontSize: 13, color: '#7f1d1d', lineHeight: 18, marginBottom: 6 },
  tooFarBold: { fontWeight: '800', color: '#991b1b' },
  tooFarSubtext: { fontSize: 12, color: '#991b1b', lineHeight: 16, opacity: 0.9 },
  tooFarUpdateBtn: { alignSelf: 'flex-start', backgroundColor: '#b91c1c', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginTop: 10 },
  tooFarUpdateBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  serviceLocationPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  serviceLocationLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  serviceLocationIcon: { fontSize: 18 },
  serviceLocationTitle: { color: '#1e293b', fontSize: 13, fontWeight: '800' },
  serviceLocationSubtitle: { color: '#64748b', fontSize: 11, marginTop: 1 },
  serviceLocationChangeBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, marginLeft: 8 },
  serviceLocationChangeText: { color: '#d83a32', fontSize: 11.5, fontWeight: '700' },
  paymentBlockedWarning: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, marginBottom: 10 },
  paymentBlockedText: { color: '#b91c1c', fontSize: 12, fontWeight: '700', lineHeight: 17 },
  radio: { color: '#d83a32', fontSize: 18 },
  billCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 15, marginTop: 8, marginBottom: 14 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 5 },
  billLabel: { color: '#756b63', fontSize: 13 },
  billValue: { color: '#302923', fontSize: 13 },
  billBold: { color: '#2b241f', fontWeight: '800', fontSize: 15 },
  billDivider: { height: 1, backgroundColor: '#f0e8e1', marginVertical: 7 },
  paymentNote: { color: '#8a8078', fontSize: 11, marginTop: 9, lineHeight: 16 },
  paymentNoteRow: { color: '#8a8078', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  primaryButton: { minHeight: 50, backgroundColor: '#d83a32', borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 8 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonSpinner: { marginTop: 12 },
  refreshButton: { backgroundColor: '#fff0eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  refreshText: { color: '#c8322a', fontSize: 12, fontWeight: '700' },
  orderCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 17, padding: 15, marginBottom: 11 },
  orderTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderPlace: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderAmountAndBillRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderTotal: { color: '#302923', fontWeight: '800', fontSize: 14 },
  orderNumberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4, minHeight: 32 },
  orderNumberAndStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap', flex: 1 },
  orderNumber: { color: '#302923', fontWeight: '800', fontSize: 13.5 },
  orderStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  orderStatusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  orderDateMuted: { color: '#8c8178', fontSize: 11, fontWeight: '600' },
  orderStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
  statusPill: { alignSelf: 'flex-start', backgroundColor: '#fff0e1', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 },
  statusPillDelivered: { backgroundColor: '#1b8742' },
  statusTextDelivered: { color: '#ffffff' },
  statusPillReturning: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  statusTextReturning: { color: '#c2410c' },
  statusPillReturned: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  statusTextReturned: { color: '#166534' },
  statusText: { color: '#9e531b', textTransform: 'capitalize', fontSize: 11, fontWeight: '800' },
  orderIconButton: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fff7f2', borderColor: '#f5cdc3', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  orderIconButtonActive: { backgroundColor: '#d83a32', borderColor: '#d83a32' },
  orderIconButtonDisabled: { backgroundColor: '#f5f2ef', borderColor: '#e4ddd6', opacity: 0.5 },
  orderActionIconEmoji: { fontSize: 14 },
  orderActionIconEmojiDisabled: { opacity: 0.5 },
  waitingForAcceptanceBox: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#f7e5cb', borderRadius: 9 },
  waitingForAcceptanceText: { color: '#92400e', fontSize: 11, fontWeight: '700', lineHeight: 16 },
  orderItemsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  orderItems: { color: '#5d544d', fontSize: 12, lineHeight: 18 },
  reviewStringBtn: { paddingVertical: 2, paddingLeft: 6, alignItems: 'center', justifyContent: 'center' },
  orderDeliveryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  orderRatingStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 1, marginLeft: 6 },
  orderStarIcon: { color: '#f2a900', fontSize: 16, lineHeight: 18 },
  addressCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 10 },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defaultBadge: { color: '#27734a', backgroundColor: '#e9f6ee', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, fontWeight: '800' },
  addressText: { color: '#6f655d', fontSize: 13, lineHeight: 19, marginTop: 7 },
  addressActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 13 },
  removeLink: { color: '#b42318', fontWeight: '700', fontSize: 13 },
  formCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 13 },
  collapsibleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  collapsibleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  collapsibleHeaderIcon: {
    fontSize: 16,
  },
  collapsibleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapsibleActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d83a32',
  },
  dropdownChevron: {
    fontSize: 14,
    fontWeight: '800',
    color: '#685e56',
    marginLeft: 2,
  },
  collapsibleContent: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f5eee8',
  },
  couponAppliedBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  couponAppliedBadgeText: {
    color: '#15803d',
    fontSize: 10,
    fontWeight: '800',
  },
  couponAppliedDiscount: {
    fontSize: 12,
    fontWeight: '800',
    color: '#16a34a',
  },
  paymentSelectedSummary: {
    fontSize: 11,
    fontWeight: '600',
    color: '#685e56',
    marginTop: 2,
  },
  couponCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12, marginBottom: 10 },
  couponSuccess: { color: '#27734a', fontSize: 11, fontWeight: '700', marginTop: 7 },
  couponError: { color: '#b42318', fontSize: 11, marginTop: 7 },
  couponListTitle: { color: '#4e453e', fontSize: 11, fontWeight: '800', marginTop: 11, marginBottom: 4 },
  couponRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: '#f0e8e1', borderTopWidth: 1, paddingVertical: 8 },
  couponCode: { color: '#c8322a', fontSize: 12, fontWeight: '800' },
  trackingCard: { borderRadius: 11, backgroundColor: '#f4f8ff', padding: 11, marginTop: 9 },
  trackingCardCancelled: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  trackingError: { borderRadius: 11, backgroundColor: '#fff1f0', padding: 11, marginTop: 9 },
  trackingErrorText: { color: '#a9241c', fontSize: 12, lineHeight: 17, marginBottom: 5 },
  trackingTitle: { color: '#214b7a', fontSize: 12, fontWeight: '800' },
  trackingTitleCancelled: { color: '#c2410c' },
  sourceAcceptancePendingBox: { marginTop: 7, paddingVertical: 6, paddingHorizontal: 9, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 8 },
  sourceAcceptancePendingText: { color: '#92400e', fontSize: 11, fontWeight: '700', lineHeight: 16 },
  reviewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 15, 12, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  reviewModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
  },
  reviewModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e8e0',
    marginBottom: 12,
  },
  reviewModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  reviewModalIcon: {
    fontSize: 18,
    color: '#f2a900',
  },
  reviewModalTitle: {
    color: '#28221e',
    fontSize: 16,
    fontWeight: '800',
  },
  reviewModalClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f6ede5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewModalCloseText: {
    color: '#695f56',
    fontSize: 13,
    fontWeight: '700',
  },
  reviewItemSelectorContainer: {
    marginBottom: 10,
  },
  reviewItemSelectorLabel: {
    color: '#6e645c',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  reviewItemChipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  reviewItemChip: {
    borderWidth: 1,
    borderColor: '#e8ded6',
    borderRadius: 8,
    backgroundColor: '#faf6f2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  reviewItemChipSelected: {
    borderColor: '#d83a32',
    backgroundColor: '#fff0eb',
  },
  reviewItemChipText: {
    color: '#695f56',
    fontSize: 11,
    fontWeight: '600',
  },
  reviewItemChipTextSelected: {
    color: '#c8322a',
    fontWeight: '800',
  },
  reviewRatePrompt: {
    color: '#554b43',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
    marginBottom: 4,
  },
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
  fieldHint: { color: '#7a7068', fontSize: 11, marginTop: -4, marginBottom: 8 },
  digipinPill: { alignSelf: 'flex-start', backgroundColor: '#f0f5ff', borderColor: '#d3e2fb', borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 5 },
  digipinPillText: { color: '#255ab4', fontSize: 11, fontWeight: '700' },
  digipinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f0f5ff', borderWidth: 1, borderColor: '#d3e2fb', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, marginTop: 6, alignSelf: 'stretch' },
  mapplsPillSmall: { fontSize: 10, fontWeight: '800', color: '#1d4ed8' },
  addressDigipinActionRow: { flexDirection: 'row', gap: 8, marginBottom: 8, marginTop: -4, flexWrap: 'wrap' },
  addressMapplsBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f5efe8', borderRadius: 7, borderWidth: 1, borderColor: '#e4d8cc' },
  addressMapplsBtnText: { color: '#4a3f37', fontSize: 11, fontWeight: '700' },
  addressGpsDetectBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f0fdf4', borderRadius: 7, borderWidth: 1, borderColor: '#bbf7d0' },
  addressGpsDetectBtnText: { color: '#166534', fontSize: 11, fontWeight: '800' },
  gpsLocationActiveBadge: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
  gpsLocationActiveText: { color: '#166534', fontSize: 11, fontWeight: '700' },
  gpsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, marginTop: 4, alignSelf: 'flex-start' },
  gpsPillText: { color: '#166534', fontSize: 11, fontWeight: '700' },
  selectedStoreCard: { backgroundColor: '#fff', borderColor: '#eee4dc', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  selectedStoreName: { color: '#302923', fontWeight: '800', fontSize: 14 },
  selectedStoreAddress: { color: '#70655d', fontSize: 12, marginTop: 2 },
  selectedStoreDigipin: { color: '#255ab4', fontSize: 11, fontWeight: '700', marginTop: 4 },
  cartBadge: { position: 'absolute', top: -4, right: -11, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: '#d83a32', alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  dropdownModalBackdrop: { flex: 1, backgroundColor: 'rgba(36, 25, 20, 0.45)', justifyContent: 'flex-end' },
  dropdownModalSheet: { maxHeight: '82%', backgroundColor: '#fffaf5', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: Platform.OS === 'android' ? 24 : 32, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 16 },
  dropdownModalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, borderBottomWidth: 1, borderBottomColor: '#f1e9e2', paddingBottom: 12 },
  dropdownModalTitle: { color: '#2d2621', fontSize: 18, fontWeight: '800' },
  dropdownModalSubtitle: { color: '#766d68', fontSize: 12, marginTop: 2, lineHeight: 17 },
  dropdownModalCloseButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f2eae2', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  dropdownModalCloseText: { color: '#5f554d', fontSize: 21, fontWeight: '600', lineHeight: 23 },
  dropdownAddressList: { maxHeight: 380 },
  dropdownAddressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e8e1', borderRadius: 14, padding: 13, marginBottom: 9 },
  dropdownAddressCardSelected: { borderColor: '#d83a32', backgroundColor: '#fff8f5' },
  dropdownAddressRadio: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  dropdownRadioText: { fontSize: 17, color: '#b5aca4' },
  dropdownRadioTextSelected: { color: '#d83a32', fontWeight: '800' },
  dropdownAddressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dropdownAddressLabel: { color: '#302923', fontSize: 14, fontWeight: '800' },
  selectedAreaBadge: { color: '#d83a32', backgroundColor: '#fff0eb', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 9, fontWeight: '800' },
  dropdownAddressText: { color: '#685e56', fontSize: 12, lineHeight: 17, marginTop: 4 },
  dropdownAddressMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  dropdownPincodeBadge: { color: '#914d18', backgroundColor: '#fef3e9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, fontWeight: '700' },
  dropdownDigipinBadge: { color: '#255ab4', backgroundColor: '#f0f5ff', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, fontWeight: '700' },
  dropdownEmptyState: { padding: 22, alignItems: 'center' },
  dropdownEmptyTitle: { color: '#302923', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  dropdownEmptyDetail: { color: '#766d68', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  dropdownModalFooter: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1e9e2' },
  paymentCard: { backgroundColor: '#fff', borderColor: '#f0e8e1', borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12, marginBottom: 10 },
  paymentSubtitle: { color: '#7a7068', fontSize: 12, marginTop: -6, marginBottom: 12 },
  paymentOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fffaf7', borderColor: '#eee3da', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 10 },
  paymentOptionSelected: { borderColor: '#d83a32', backgroundColor: '#fff5f2' },
  paymentRadio: { fontSize: 16, color: '#d83a32', width: 20, textAlign: 'center' },
  paymentIcon: { fontSize: 20 },
  paymentOptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paymentOptionName: { color: '#302923', fontSize: 13, fontWeight: '700' },
  paymentBadge: { color: '#27734a', backgroundColor: '#e9f6ee', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8, fontWeight: '800' },
  paymentDetailBox: { marginTop: 6, marginBottom: 8, padding: 12, backgroundColor: '#fffaf5', borderWidth: 1, borderColor: '#f3eae2', borderRadius: 12 },
  paymentDetailTitle: { color: '#4e453e', fontSize: 11, fontWeight: '800', marginBottom: 8 },
  bankChoiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  bankChip: { borderWidth: 1, borderColor: '#e9dfd7', borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7 },
  bankChipActive: { borderColor: '#d83a32', backgroundColor: '#fff0eb' },
  bankChipText: { color: '#635950', fontSize: 11, fontWeight: '600' },
  bankChipTextActive: { color: '#bd3029', fontWeight: '800' },
  notificationModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 15, 12, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  notificationModalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  notificationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e8e0',
    marginBottom: 6,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  notificationModalIcon: {
    fontSize: 13,
  },
  notificationModalTitle: {
    color: '#28221e',
    fontSize: 8.5,
    fontWeight: '800',
  },
  notificationCountBadge: {
    backgroundColor: '#d83a32',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  notificationCountBadgeText: {
    color: '#ffffff',
    fontSize: 6,
    fontWeight: '800',
  },
  notificationModalClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f6ede5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationModalCloseText: {
    color: '#695f56',
    fontSize: 10,
    fontWeight: '700',
  },
  notificationScrollView: {
    maxHeight: 124,
  },
  notificationScrollContent: {
    paddingVertical: 2,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#faf6f2',
    borderWidth: 1,
    borderColor: '#eee4db',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    marginBottom: 4,
    gap: 6,
  },
  notificationItemLast: {
    marginBottom: 0,
  },
  notificationBullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d83a32',
    marginTop: 3,
  },
  notificationBody: {
    flex: 1,
  },
  notificationItemTitle: {
    color: '#28221e',
    fontSize: 7.5,
    fontWeight: '800',
    lineHeight: 10,
  },
  notificationItemMessage: {
    color: '#6b6158',
    fontSize: 6.5,
    lineHeight: 9.5,
    marginTop: 1,
  },
  notificationItemTime: {
    color: '#9c9187',
    fontSize: 5.5,
    marginTop: 2,
  },
  notificationScrollHint: {
    textAlign: 'center',
    color: '#8b8077',
    fontSize: 6,
    fontWeight: '600',
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f4ede6',
  },
  notificationLoadingBox: {
    paddingVertical: 18,
    alignItems: 'center',
    gap: 6,
  },
  notificationLoadingText: {
    color: '#80756d',
    fontSize: 6.5,
  },
  notificationEmptyBox: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  notificationEmptyText: {
    color: '#6e645c',
    fontSize: 7,
    fontWeight: '700',
  },
  logoutModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  logoutModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  logoutModalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoutModalIcon: {
    fontSize: 28,
  },
  logoutModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
  },
  logoutModalMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
  },
  logoutModalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  logoutModalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCancelBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  logoutCancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  logoutConfirmBtn: {
    backgroundColor: '#dc2626',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  logoutConfirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  cartToastContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 88 : 78,
    left: 14,
    right: 14,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartToastCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#1f2937',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cartToastIconBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartToastIcon: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 16,
  },
  cartToastContent: {
    flex: 1,
  },
  cartToastText: {
    color: '#f3f4f6',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  cartToastItemName: {
    color: '#ffffff',
    fontWeight: '700',
  },
  cartToastPrice: {
    color: '#34d399',
    fontWeight: '800',
  },
  cartToastCloseBtn: {
    padding: 4,
    marginLeft: 2,
  },
  cartToastCloseText: {
    color: '#9ca3af',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 18,
  },
});
