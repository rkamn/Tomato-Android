import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiRequest } from './api';
import { decodeDigipin, formatDigipin, resolveCustomerDigipin } from './digipin';

export type LiveTrackingData = {
  orderId?: string;
  orderNumber?: string;
  status?: string;
  trackingClosed?: boolean;
  isPickedUp?: boolean;
  pickupStatus?: string;
  estimatedMinutes?: number;
  expectedDeliveryTimingMinutes?: number;
  distanceToDeliveryKm?: number;
  restaurantToCustomerDistanceKm?: number;
  distanceToPickupKm?: number;
  rider?: {
    id?: string;
    riderId?: string;
    name?: string;
    displayName?: string;
    phone?: string;
    isOnline?: boolean;
    lastLocationUpdated?: string;
    currentLocation?: { lat?: number; lng?: number };
    location?: { lat?: number; lng?: number };
    digipin?: string;
  };
  customer?: {
    name?: string;
    phone?: string;
    address?: { line1?: string; line2?: string; city?: string; digipin?: string; postalCode?: string };
    location?: { lat?: number; lng?: number };
    digipin?: string;
    pincode?: string;
    isLiveGpsShared?: boolean;
  };
  restaurant?: {
    restaurantId?: string;
    name?: string;
    displayName?: string;
    address?: string;
    location?: { lat?: number; lng?: number };
    digipin?: string;
    phone?: string;
  };
  telemetry?: {
    trackingMode?: string;
    riderPhone?: string;
    isLiveOnline?: boolean;
    riderToRestaurantDistanceKm?: number;
    riderToCustomerDistanceKm?: number;
    etaMinutes?: number;
    lastPingSecondsAgo?: number | null;
    currentLocation?: { lat?: number; lng?: number };
    riderLocation?: { lat?: number; lng?: number };
  };
};

function parseCoord(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !isNaN(val) && isFinite(val) && val !== 0) return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && isFinite(parsed) && parsed !== 0) return parsed;
  }
  return fallback;
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

export type LiveRouteTrackerProps = {
  orderId: string;
  orderNumber?: string;
  initialTracking?: LiveTrackingData | null;
  endpoint?: string;
  token?: string;
  isShop?: boolean;
  onClose?: () => void;
  // Fallbacks:
  fallbackRiderName?: string;
  fallbackRiderPhone?: string;
  fallbackCustomerName?: string;
  fallbackCustomerAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    digipin?: string;
    postalCode?: string;
    coordinates?: number[] | [number, number];
  };
  fallbackCustomerDigipin?: string;
  fallbackStoreName?: string;
  fallbackStoreDigipin?: string;
  fallbackStoreAddress?: string;
  fallbackStoreLocation?: { lat?: number; lng?: number };
  isPickedUp?: boolean;
};

export default function LiveRouteTracker({
  orderId,
  orderNumber,
  initialTracking,
  endpoint,
  token,
  isShop = false,
  onClose,
  fallbackRiderName,
  fallbackRiderPhone,
  fallbackCustomerName,
  fallbackCustomerAddress,
  fallbackCustomerDigipin,
  fallbackStoreName,
  fallbackStoreDigipin,
  fallbackStoreAddress,
  fallbackStoreLocation,
  isPickedUp: initialIsPickedUp,
}: LiveRouteTrackerProps) {
  const [tracking, setTracking] = useState<LiveTrackingData | null>(initialTracking || null);
  const [loading, setLoading] = useState(!initialTracking && Boolean(endpoint && token));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function loadTracking(isManualRefresh = false) {
    if (!endpoint || !token) return;
    if (isManualRefresh) setRefreshing(true);
    try {
      const res = await apiRequest<{ tracking?: LiveTrackingData }>(endpoint, token);
      if (res?.tracking) {
        setTracking(res.tracking);
        setError('');
      }
    } catch (err) {
      if (isManualRefresh) {
        setError(err instanceof Error ? err.message : 'Unable to refresh rider tracking');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (initialTracking) {
      setTracking(initialTracking);
    }
  }, [initialTracking]);

  useEffect(() => {
    if (!endpoint || !token) return;
    void loadTracking();

    // Auto-poll coordinates every 12 seconds while tracker is open
    const interval = setInterval(() => {
      void loadTracking();
    }, 12000);

    return () => clearInterval(interval);
  }, [endpoint, token, orderId]);

  // Resolve Rider Data
  const rider = tracking?.rider;
  const riderName = String(rider?.displayName || rider?.name || fallbackRiderName || 'Delivery Partner');
  const riderPhone = String(rider?.phone || fallbackRiderPhone || tracking?.telemetry?.riderPhone || '');
  const isOnline = tracking?.telemetry?.isLiveOnline ?? rider?.isOnline ?? true;

  const riderLocation = rider?.currentLocation || rider?.location || tracking?.telemetry?.currentLocation;
  const decodedRiderLocation = decodeDigipin(rider?.digipin);
  const riderLat = parseCoord(riderLocation?.lat ?? decodedRiderLocation?.lat, 12.9716);
  const riderLng = parseCoord(riderLocation?.lng ?? decodedRiderLocation?.lng, 77.5946);

  // Resolve Customer Destination Data
  const customer = tracking?.customer;
  const custName = String(customer?.name || fallbackCustomerName || 'Customer');
  const custAddr = customer?.address || fallbackCustomerAddress;
  const custAddressLine = custAddr?.line1
    ? `${custAddr.line1}${custAddr.line2 ? `, ${custAddr.line2}` : ''}${custAddr.city ? `, ${custAddr.city}` : ''}`
    : 'Customer Delivery Address';
  const custDigipin =
    resolveCustomerDigipin(customer) ||
    resolveCustomerDigipin(custAddr) ||
    (fallbackCustomerDigipin ? resolveCustomerDigipin(fallbackCustomerDigipin) : '') ||
    String(customer?.digipin || custAddr?.digipin || fallbackCustomerAddress?.digipin || '');
  const custPincode = String(customer?.pincode || custAddr?.postalCode || '');

  const decodedCustLocation = decodeDigipin(custDigipin);
  const custLocation = customer?.location;
  const rawCustomerCoords = fallbackCustomerAddress?.coordinates;
  const fallbackCustLat = Array.isArray(rawCustomerCoords) ? rawCustomerCoords[1] : undefined;
  const fallbackCustLng = Array.isArray(rawCustomerCoords) ? rawCustomerCoords[0] : undefined;

  // PRIORITY 1: Decoded customer DIGIPIN, PRIORITY 2: Live GPS, Fallback: Bangalore center
  const custLat = decodedCustLocation?.lat ?? parseCoord(custLocation?.lat ?? fallbackCustLat, 12.9815);
  const custLng = decodedCustLocation?.lng ?? parseCoord(custLocation?.lng ?? fallbackCustLng, 77.6095);

  // Resolve Restaurant / Shop Data
  const store = tracking?.restaurant;
  const storeName = String(store?.displayName || store?.name || fallbackStoreName || (isShop ? 'Shop' : 'Restaurant'));
  const storeDigipin = String(store?.digipin || fallbackStoreDigipin || '');
  const decodedStoreLocation = decodeDigipin(storeDigipin);
  const storeAddress = String(store?.address || fallbackStoreAddress || '');
  const storeLocation = store?.location;
  const storeLat = decodedStoreLocation?.lat ?? parseCoord(storeLocation?.lat ?? fallbackStoreLocation?.lat, 12.9698);
  const storeLng = decodedStoreLocation?.lng ?? parseCoord(storeLocation?.lng ?? fallbackStoreLocation?.lng, 77.5890);

  // Pickup and Delivery status
  const isPickedUp = Boolean(
    tracking?.isPickedUp ||
    tracking?.pickupStatus === 'picked_up' ||
    initialIsPickedUp
  );

  // 1. Distance & Time between Rider and Store (Pickup Leg)
  const telemetryRiderStoreDist =
    tracking?.telemetry?.riderToRestaurantDistanceKm ??
    tracking?.distanceToPickupKm;
  const distToStore =
    telemetryRiderStoreDist !== undefined && Number(telemetryRiderStoreDist) > 0
      ? Number(Number(telemetryRiderStoreDist).toFixed(2))
      : calculateDistanceKm(riderLat, riderLng, storeLat, storeLng);
  const approxMinutesToStore = Math.max(2, Math.round(3 + distToStore * 3));

  // 2. Distance & Time between Rider and Customer (Delivery Leg)
  const calculatedDistToCustomer = calculateDistanceKm(riderLat, riderLng, custLat, custLng);
  const telemetryRiderCustDist =
    tracking?.telemetry?.riderToCustomerDistanceKm ??
    tracking?.distanceToDeliveryKm;
  // If customer DIGIPIN is decoded, prefer exact calculated distance over legacy server seed telemetry
  const distToCustomer =
    decodedCustLocation
      ? calculatedDistToCustomer
      : telemetryRiderCustDist !== undefined && Number(telemetryRiderCustDist) > 0
        ? Number(Number(telemetryRiderCustDist).toFixed(2))
        : calculatedDistToCustomer;

  const telemetryEta =
    tracking?.telemetry?.etaMinutes ??
    tracking?.expectedDeliveryTimingMinutes ??
    tracking?.estimatedMinutes;
  const approxMinutesToCustomer =
    telemetryEta !== undefined && Number(telemetryEta) > 0
      ? Math.round(Number(telemetryEta))
      : Math.max(2, Math.round(5 + distToCustomer * 3.5));

  // Active target based on pickup status:
  // - When accepted (!isPickedUp): show path ONLY between Rider and Store (Shop/Restaurant)
  // - When picked up (isPickedUp): show path between Rider and Customer delivery address
  const activeDist = isPickedUp ? distToCustomer : distToStore;
  const activeMinutes = isPickedUp ? approxMinutesToCustomer : approxMinutesToStore;
  const activeDestLat = isPickedUp ? custLat : storeLat;
  const activeDestLng = isPickedUp ? custLng : storeLng;

  // Telemetry Ping timing
  const lastPingSec = tracking?.telemetry?.lastPingSecondsAgo;
  const lastPingText =
    typeof lastPingSec === 'number'
      ? lastPingSec < 60
        ? `${lastPingSec}s ago`
        : `${Math.floor(lastPingSec / 60)}m ago`
      : 'Active';

  // Google Maps turn-by-turn highlighted route directions URL
  // When !isPickedUp: Rider -> Store
  // When isPickedUp: Rider -> Customer
  const googleMapsRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${riderLat},${riderLng}&destination=${activeDestLat},${activeDestLng}&travelmode=driving`;

  function openRouteInGoogleMaps() {
    void Linking.openURL(googleMapsRouteUrl).catch(() => {
      Alert.alert('Map Error', 'Unable to open Google Maps navigation route.');
    });
  }

  function callRider() {
    if (!riderPhone) {
      Alert.alert('Phone not available', 'Rider phone number is not available yet.');
      return;
    }
    const tel = `tel:${riderPhone.replace(/[^\d+]/g, '')}`;
    void Linking.openURL(tel).catch(() => {
      Alert.alert('Unable to dial', `Please dial: ${riderPhone}`);
    });
  }

  return (
    <View style={styles.container}>
      {/* Tracker Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>📍 Live Rider Tracking</Text>
          <Text style={styles.headerSub}>
            {orderNumber ? `Order #${orderNumber} · ` : ''}Real-time GPS telemetry
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh rider live location"
            disabled={refreshing || loading}
            onPress={() => void loadTracking(true)}
            style={styles.refreshBtn}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#0284c7" />
            ) : (
              <Text style={styles.refreshBtnText}>↻</Text>
            )}
          </Pressable>
          {Boolean(onClose) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close live rider tracking"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Stage Banner */}
      <View style={[styles.stageBanner, isPickedUp ? styles.stageBannerPickedUp : styles.stageBannerEnRoute]}>
        <Text style={styles.stageEmoji}>{isPickedUp ? '📦' : '🚴'}</Text>
        <Text style={[styles.stageText, isPickedUp ? styles.stageTextPickedUp : styles.stageTextEnRoute]}>
          {isPickedUp
            ? 'Order Picked Up · En route to customer delivery location'
            : `Rider accepted · Heading to ${isShop ? 'shop' : 'restaurant'} for pickup`}
        </Text>
      </View>

      {/* KPI Cards: Distance, Time to Reach, GPS Status */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>
            {isPickedUp ? 'DISTANCE TO CUSTOMER' : `DISTANCE TO ${isShop ? 'SHOP' : 'RESTAURANT'}`}
          </Text>
          <Text style={styles.kpiValueMain}>~{activeDist} km</Text>
          <Text style={styles.kpiFoot}>
            {isPickedUp ? 'Rider ➔ Customer' : `Rider ➔ ${isShop ? 'Shop' : 'Restaurant'}`}
          </Text>
        </View>

        <View style={[styles.kpiCard, styles.kpiCardHighlight]}>
          <Text style={[styles.kpiLabel, styles.kpiLabelHighlight]}>
            {isPickedUp ? 'TIME TO REACH' : 'TIME TO PICKUP'}
          </Text>
          <Text style={[styles.kpiValueMain, styles.kpiValueHighlight]}>~{activeMinutes} mins</Text>
          <Text style={[styles.kpiFoot, styles.kpiFootHighlight]}>
            {isPickedUp ? 'Approx. delivery time' : 'Approx. pickup arrival'}
          </Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>GPS STATUS</Text>
          <Text style={[styles.kpiValueSmall, isOnline ? styles.gpsOnline : styles.gpsOffline]}>
            {isOnline ? '🟢 Live GPS' : '⚪ Signal Standby'}
          </Text>
          <Text style={styles.kpiFoot}>{lastPingText}</Text>
        </View>
      </View>

      {/* Satellite Radar View: Live Rider & Highlighted Path */}
      <View style={styles.radarBox}>
        {/* Radar Header */}
        <View style={styles.radarHeader}>
          <Text style={styles.radarHeaderTitle}>
            {isPickedUp ? '📡 DISPATCH RADAR · TO CUSTOMER' : `📡 DISPATCH RADAR · TO ${isShop ? 'SHOP' : 'RESTAURANT'}`}
          </Text>
          <Text style={styles.radarHeaderGps}>
            {isOnline ? '🟢 LIVE GPS STREAM ACTIVE' : '🟡 SIGNAL STANDBY'}
          </Text>
        </View>

        {/* Highlighted Route Beam Visualizer: Only Rider -> Store (when accepted) or Rider -> Customer (when picked up) */}
        <View style={styles.routeVisualizer}>
          {/* Node 1: Rider Current Live Location */}
          <View style={styles.waypointNodeRider}>
            <View style={styles.riderPulseRing}>
              <View style={styles.riderIconCircle}>
                <Text style={styles.waypointEmoji}>🚴</Text>
              </View>
            </View>
            <Text style={styles.riderLiveTag}>🟢 LIVE LOCATION</Text>
            <Text style={styles.riderNameTag} numberOfLines={1}>{riderName}</Text>
          </View>

          {/* THE HIGHLIGHTED PATH (Active Leg) */}
          <View style={styles.highlightedPathWrapper}>
            <View style={styles.highlightedPathBeam} />
            <View style={styles.highlightedPathBadge}>
              <Text style={styles.highlightedPathText}>
                ══▶ ~{activeDist} km · ~{activeMinutes}m ▶══
              </Text>
            </View>
            <Text style={styles.highlightedPathSub}>
              {isPickedUp ? 'HIGHLIGHTED ROUTE TO CUSTOMER' : `HIGHLIGHTED ROUTE TO ${isShop ? 'SHOP' : 'RESTAURANT'}`}
            </Text>
          </View>

          {/* Node 2: Destination (Store if !isPickedUp, Customer if isPickedUp) */}
          <View style={styles.waypointNode}>
            <View style={isPickedUp ? styles.customerIconCircle : styles.storeIconCircle}>
              <Text style={styles.waypointEmoji}>{isPickedUp ? '🏠' : '🏪'}</Text>
            </View>
            <Text style={styles.waypointLabel} numberOfLines={1}>
              {isPickedUp ? custName : storeName}
            </Text>
            <Text style={styles.waypointRole}>
              {isPickedUp ? 'Customer Delivery' : `${isShop ? 'Shop' : 'Restaurant'} Pickup`}
            </Text>
            {Boolean(isPickedUp ? custDigipin : storeDigipin) && (
              <Text style={styles.waypointDigipin}>
                [{formatDigipin(isPickedUp ? custDigipin : storeDigipin)}]
              </Text>
            )}
          </View>
        </View>

        {/* Live Coordinates Bar */}
        <View style={styles.coordinatesBar}>
          <Text style={styles.coordinatesText}>
            📍 Rider GPS: <Text style={styles.coordinatesMono}>{(Number(riderLat) || 12.9716).toFixed(4)}, {(Number(riderLng) || 77.5946).toFixed(4)}</Text>
          </Text>
          <Text style={styles.coordinatesDivider}>•</Text>
          <Text style={styles.coordinatesText}>
            {isPickedUp ? '🏠 Customer: ' : `🏪 ${isShop ? 'Shop: ' : 'Restaurant: '}`}
            <Text style={styles.coordinatesMono}>{(Number(activeDestLat) || 0).toFixed(4)}, {(Number(activeDestLng) || 0).toFixed(4)}</Text>
          </Text>
        </View>
      </View>

      {/* Waypoint Detail Cards */}
      <View style={styles.detailsRow}>
        {/* Rider Card */}
        <View style={styles.detailCard}>
          <View style={styles.detailCardHeader}>
            <Text style={styles.detailCardTitle}>🚴 Delivery Rider</Text>
            <Text style={styles.detailCardStatus}>{isOnline ? '🟢 Live' : 'Offline'}</Text>
          </View>
          <Text style={styles.detailCardName}>{riderName}</Text>
          {Boolean(riderPhone) ? (
            <View style={styles.riderPhoneRow}>
              <Text style={styles.detailCardMuted}>📱 {riderPhone}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Call rider"
                onPress={callRider}
                style={styles.callRiderBtn}
              >
                <Text style={styles.callRiderText}>📞 Call</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.detailCardMuted}>📱 Connected via system tracking</Text>
          )}
        </View>

        {/* Destination Card (Store if !isPickedUp, Customer if isPickedUp) */}
        <View style={styles.detailCard}>
          <View style={styles.detailCardHeader}>
            <Text style={styles.detailCardTitle}>
              {isPickedUp ? '🏠 Delivery Address' : `🏪 ${isShop ? 'Shop' : 'Restaurant'} Pickup`}
            </Text>
            {Boolean(isPickedUp ? custDigipin : storeDigipin) && (
              <Text style={styles.digipinPill}>
                📍 {formatDigipin(isPickedUp ? custDigipin : storeDigipin)}
              </Text>
            )}
          </View>
          <Text style={styles.detailCardName}>
            {isPickedUp ? custName : storeName}
          </Text>
          <Text style={styles.detailCardMuted} numberOfLines={2}>
            {isPickedUp ? custAddressLine : (storeAddress || `${storeName} pickup location`)}
          </Text>
          {Boolean(isPickedUp && custPincode) && (
            <Text style={styles.pincodeFoot}>PIN: {custPincode}</Text>
          )}
          {!isPickedUp && (
            <Text style={styles.pickupWaitingFoot}>⏳ Awaiting order pickup</Text>
          )}
        </View>
      </View>

      {/* Action: Open in Google Maps */}
      <View style={styles.actionsBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open highlighted route on Google Maps"
          onPress={openRouteInGoogleMaps}
          style={styles.googleMapsBtn}
        >
          <Text style={styles.googleMapsBtnText}>
            🗺️ View Highlighted Path in Google Maps
          </Text>
          <Text style={styles.googleMapsBtnSub}>
            Turn-by-turn live navigation to {isPickedUp ? 'Customer' : (isShop ? 'Shop' : 'Restaurant')} (~{activeDist} km · ~{activeMinutes} mins)
          </Text>
        </Pressable>
      </View>

      {Boolean(error) && (
        <Text style={styles.errorText}>⚠️ {error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginTop: 10,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#bae6fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    color: '#0284c7',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  stageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 10,
    gap: 6,
  },
  stageBannerPickedUp: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  stageBannerEnRoute: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  stageEmoji: {
    fontSize: 15,
  },
  stageText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stageTextPickedUp: {
    color: '#166534',
  },
  stageTextEnRoute: {
    color: '#1e40af',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
  },
  kpiCardHighlight: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  kpiLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 2,
    textAlign: 'center',
  },
  kpiLabelHighlight: {
    color: '#15803d',
  },
  kpiValueMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  kpiValueHighlight: {
    color: '#16a34a',
  },
  kpiValueSmall: {
    fontSize: 11.5,
    fontWeight: '800',
    textAlign: 'center',
    marginVertical: 2,
  },
  gpsOnline: {
    color: '#16a34a',
  },
  gpsOffline: {
    color: '#94a3b8',
  },
  kpiFoot: {
    fontSize: 9.5,
    color: '#94a3b8',
    marginTop: 1,
  },
  kpiFootHighlight: {
    color: '#166534',
  },
  radarBox: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  radarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  radarHeaderTitle: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  radarHeaderGps: {
    color: '#22c55e',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  routeVisualizer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    position: 'relative',
  },
  waypointNode: {
    alignItems: 'center',
    width: 85,
  },
  waypointNodeRider: {
    alignItems: 'center',
    width: 85,
    zIndex: 2,
  },
  storeIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  customerIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  riderPulseRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(34, 197, 94, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#22c55e',
    marginBottom: 2,
  },
  riderIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waypointEmoji: {
    fontSize: 15,
  },
  waypointLabel: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  waypointRole: {
    color: '#94a3b8',
    fontSize: 8.5,
    textAlign: 'center',
    marginTop: 1,
  },
  waypointDigipin: {
    color: '#38bdf8',
    fontSize: 8,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  riderLiveTag: {
    color: '#4ade80',
    fontSize: 8.5,
    fontWeight: '800',
    textAlign: 'center',
  },
  riderNameTag: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  legLineCompleted: {
    flex: 0.6,
    height: 3,
    backgroundColor: '#22c55e',
    marginHorizontal: 4,
    borderRadius: 2,
  },
  legArrowCompleted: {
    alignSelf: 'flex-end',
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderLeftColor: '#22c55e',
    borderTopWidth: 3,
    borderTopColor: 'transparent',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    marginTop: -1.5,
  },
  highlightedPathWrapper: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
    position: 'relative',
    paddingVertical: 12,
  },
  highlightedPathBeam: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: '#38bdf8',
    borderRadius: 3,
    shadowColor: '#38bdf8',
    shadowRadius: 5,
    shadowOpacity: 0.9,
    elevation: 4,
  },
  highlightedPathBadge: {
    backgroundColor: '#0284c7',
    borderWidth: 1,
    borderColor: '#7dd3fc',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 3,
  },
  highlightedPathText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  highlightedPathSub: {
    color: '#38bdf8',
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 3,
  },
  coordinatesBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 8,
  },
  coordinatesText: {
    color: '#94a3b8',
    fontSize: 9.5,
  },
  coordinatesMono: {
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  coordinatesDivider: {
    color: '#475569',
    marginHorizontal: 6,
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  detailCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 9,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailCardTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailCardStatus: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#16a34a',
  },
  digipinPill: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#0369a1',
    backgroundColor: '#e0f2fe',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  detailCardName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 2,
  },
  detailCardMuted: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 15,
  },
  pincodeFoot: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 2,
  },
  pickupWaitingFoot: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#ca8a04',
    marginTop: 2,
  },
  riderPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  callRiderBtn: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  callRiderText: {
    color: '#15803d',
    fontSize: 10.5,
    fontWeight: '700',
  },
  actionsBar: {
    marginTop: 2,
  },
  googleMapsBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleMapsBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '800',
  },
  googleMapsBtnSub: {
    color: '#bae6fd',
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
