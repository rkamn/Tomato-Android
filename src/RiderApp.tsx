import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Alert,
  Linking,
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
import ProfileAccess from './ProfileAccess';
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

export default function RiderApp({ session, onSignOut, onSessionUserUpdate }: Props) {
  const [tab, setTab] = useState<RiderTab>('available');
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
  const isApproved = session.user.isApproved !== false;
  const knownOfferStatuses = useRef<Map<string, string> | null>(null);

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
    const nextOrders = result.orders || [];
    const eligibleOrders = nextOrders.filter((order) =>
      ['accepted', 'preparing', 'ready_for_pickup'].includes(order.status || ''),
    );
    if (knownOfferStatuses.current) {
      const newOffer = eligibleOrders.find((order) => {
        const previousStatus = knownOfferStatuses.current?.get(order._id);
        return !['accepted', 'preparing', 'ready_for_pickup'].includes(previousStatus || '');
      });
      if (newOffer) {
        Alert.alert(
          'New delivery offer',
          `${newOffer.orderNumber || 'An order'} from ${newOffer.restaurantName || newOffer.shopName || 'a nearby partner'} is ready for rider acceptance.`,
          [
            { text: 'View offer', onPress: () => setTab('available') },
            { text: 'Accept delivery', onPress: () => void updateOrder(newOffer, 'accept') },
          ],
        );
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
    setActiveOrders(result.orders || []);
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

    async function updateForegroundLocation() {
      try {
        if (AppState.currentState !== 'active') return;
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          if (!disposed) {
            setError('Location permission is needed to share your live rider location while you are on duty.');
          }
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (disposed) return;
        const currentLocation = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        };
        await apiRequest('/api/rider/location', session.token, {
          method: 'PUT',
          body: JSON.stringify({ ...currentLocation, isOnline: true }),
        });
        if (!disposed) setLocation((previous) => ({ ...previous, currentLocation, isOnline: true }));
      } catch (reason) {
        if (!disposed) setError(readableError(reason));
      }
    }

    void updateForegroundLocation();
    const interval = setInterval(() => void updateForegroundLocation(), 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
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
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
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
            await onSignOut();
          }
        },
      },
    ]);
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

  const tabs: [RiderTab, string, string][] = [
    ['available', 'Available', '⌕'],
    ['active', 'My route', '➤'],
    ['history', 'Earnings', '₹'],
    ['account', 'Account', '☺'],
  ];

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.brand}>🍅 Tomato</Text>
          <Text style={styles.role}>Delivery partner</Text>
        </View>
        <Pressable onPress={() => void showNotifications()} style={styles.iconButton}>
          <Text style={styles.iconText}>♢</Text>
        </Pressable>
        <Pressable onPress={() => void refresh()} style={styles.iconButton}>
          <Text style={styles.iconText}>↻</Text>
        </Pressable>
        <ProfileAccess
          session={session}
          roleLabel="Delivery partner"
          items={[
            { key: 'available', label: 'Available deliveries', description: 'See orders in your service area', icon: '⌕' },
            { key: 'active', label: 'My deliveries', description: 'Open your current delivery route', icon: '➤' },
            { key: 'history', label: 'Earnings & history', description: 'Review completed deliveries and earnings', icon: '₹' },
            { key: 'account', label: 'Account & payouts', description: 'Manage rider details and payout information', icon: '⚙' },
          ]}
          onNavigate={(key) => setTab(key as RiderTab)}
          onSignOut={signOut}
          onSessionUserUpdate={onSessionUserUpdate}
        />
      </View>
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
            <Text style={styles.eyebrow}>DELIVERY PARTNER</Text>
            <Text style={styles.title}>Available pickups</Text>
            <Text style={styles.subtitle}>Accept a delivery, pick it up, then bring it to the customer.</Text>
            {!isApproved ? (
              <Notice
                title="Approval pending"
                detail="Your rider registration is awaiting administrator approval. Delivery offers will be available after approval."
              />
            ) : (
              <DutyCard online={isOnline} onChange={(value) => void changeDuty(value)} />
            )}
            <View style={styles.dashboardTiles}>
              <DashboardTile label="Offers" value={orders.length} />
              <DashboardTile label="My deliveries" value={activeOrders.length} />
              <DashboardTile label="Duty" value={isOnline ? 'ON' : 'OFF'} />
            </View>
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : orders.length ? (
              orders.map((order) => (
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
                title={isOnline ? 'No pickup orders right now' : 'Go online to receive offers'}
                detail={isOnline ? 'New orders from your service area will appear here.' : 'Your duty status is offline. Switch online when you are ready to work.'}
              />
            )}
          </View>
        )}

        {tab === 'active' && (
          <View>
            <Text style={styles.eyebrow}>YOUR DELIVERIES</Text>
            <Text style={styles.title}>My route</Text>
            <Text style={styles.subtitle}>Pickup and delivery details for orders assigned to you.</Text>
            {!isOnline && <Notice title="You are offline" detail="Go online to update pickup and delivery progress." />}
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : activeOrders.length ? (
              activeOrders.map((order) => (
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
              <Notice title="No active deliveries" detail="Accepted orders will appear here. Check available pickups for a new delivery." />
            )}
          </View>
        )}

        {tab === 'history' && (
          <View>
            <Text style={styles.eyebrow}>DELIVERY PERFORMANCE</Text>
            <Text style={styles.title}>Earnings & history</Text>
            <Text style={styles.subtitle}>Completed orders recorded by Tomato.</Text>
            {history ? (
              <>
                <View style={styles.earningsCard}>
                  <Text style={styles.earningsLabel}>Estimated delivery earnings</Text>
                  <Text style={styles.earningsValue}>{amount(history.totalEarnings)}</Text>
                  <Text style={styles.earningsFoot}>{history.totalDeliveries} completed deliveries · ₹40 per delivery estimate</Text>
                </View>
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
            <Text style={styles.title}>Your duty</Text>
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
                <Text style={styles.cardTitle}>Last shared location</Text>
                <Text style={styles.muted}>
                  {location.currentLocation.lat?.toFixed(5)}, {location.currentLocation.lng?.toFixed(5)}
                </Text>
                <Text style={styles.locationFoot}>Updated while Tomato is open and you are online.</Text>
              </View>
            )}
            <View style={styles.collectionCard}>
              <Text style={styles.cardTitle}>Bank details & payouts</Text>
              {bankLoading && <ActivityIndicator color="#d83a32" style={styles.loader} />}
              <Text style={styles.muted}>
                {bankDetails.isApproved ? 'Approved and locked' : bankDetails.isSubmitted ? 'Submitted, awaiting review' : 'Not yet submitted'}
                {bankDetails.accountNumber ? ` · Account ••••${bankDetails.accountNumber.slice(-4)}` : ''}
              </Text>
              <View style={styles.dashboardTiles}>
                <DashboardTile label="Wallet" value={amount(bankWallet)} />
                <DashboardTile label="Credit points" value={amount(bankCredit)} />
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
        {tabs.map(([id, label, icon]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={styles.tabButton}>
            <Text style={[styles.tabIcon, tab === id && styles.tabActive]}>{icon}</Text>
            <Text style={[styles.tabLabel, tab === id && styles.tabActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DutyCard({ online, onChange }: { online: boolean; onChange: (online: boolean) => void }) {
  return (
    <View style={styles.dutyCard}>
      <View style={styles.flex}>
        <Text style={styles.dutyTitle}>{online ? 'You are online' : 'You are offline'}</Text>
        <Text style={styles.muted}>{online ? 'Ready to receive delivery offers.' : 'Go online when you are ready to work.'}</Text>
      </View>
      <Switch
        accessibilityLabel={online ? 'Go offline' : 'Go online'}
        onValueChange={onChange}
        thumbColor="#fff"
        trackColor={{ false: '#cfc5bc', true: '#49a86a' }}
        value={online}
      />
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

  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.flex}>
          <Text style={styles.orderNumber}>Order #{order.orderNumber || order._id.slice(-6)}</Text>
          <Text style={styles.muted}>{(order.status || 'placed').replaceAll('_', ' ')}</Text>
        </View>
        <Text style={styles.orderAmount}>{amount(order.totalAmount)}</Text>
      </View>
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
        </View>
        {mode !== 'history' && (
          <Pressable onPress={() => openMap(pickupAddress)} style={styles.mapButton}>
            <Text style={styles.mapText}>Map</Text>
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
          {!!phone && <Text style={styles.phone}>{phone}</Text>}
        </View>
        {mode !== 'history' && (
          <Pressable onPress={() => openMap(dropAddress)} style={styles.mapButton}>
            <Text style={styles.mapText}>Map</Text>
          </Pressable>
        )}
      </View>
      {!!items && <Text style={styles.items}>{items}</Text>}
      <Text style={styles.payment}>
        {order.paymentMethod === 'cod' ? `COLLECT ${amount(order.totalAmount)} CASH / UPI` : `${(order.paymentMethod || 'ONLINE').toUpperCase()} · PAID`}
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
                label="Pickup map"
                variant="outline"
                onPress={() => openMap(pickupAddress)}
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
                label="Customer map"
                variant="outline"
                onPress={() => openMap(dropAddress)}
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

function InfoRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, bold && styles.infoBold]}>{label}</Text>
      <Text style={[styles.infoValue, bold && styles.infoBold]}>{value}</Text>
    </View>
  );
}

function DashboardTile({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.dashboardTile}>
      <Text style={styles.dashboardTileValue}>{value}</Text>
      <Text style={styles.dashboardTileLabel}>{label}</Text>
    </View>
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
  title: { color: '#2d2621', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#82786f', fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 16 },
  dutyCard: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 15, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dashboardTiles: { flexDirection: 'row', gap: 8, marginBottom: 13 },
  dashboardTile: { flex: 1, backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 11 },
  dashboardTileValue: { color: '#d83a32', fontSize: 19, fontWeight: '800' },
  dashboardTileLabel: { color: '#766d68', fontSize: 10, fontWeight: '700', marginTop: 3 },
  dutyTitle: { color: '#302923', fontWeight: '800', fontSize: 14 },
  loader: { marginTop: 40 },
  muted: { color: '#82786f', fontSize: 12, lineHeight: 18, marginTop: 3 },
  notice: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 20, marginVertical: 8, gap: 6 },
  noticeEmoji: { fontSize: 30, marginBottom: 2 },
  noticeTitle: { color: '#302923', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  orderCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 11 },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  orderNumber: { color: '#302923', fontSize: 15, fontWeight: '800' },
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
});
