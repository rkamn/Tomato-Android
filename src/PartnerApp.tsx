import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { apiRequest } from './api';
import { formatDigipin } from './digipin';
import GlobalHeader from './GlobalHeader';
import PartnerModules from './PartnerModules';
import ProfileAccess from './ProfileAccess';
import SignOutModal from './SignOutModal';
import { getAccountDisplayId, getItemVariants, isOrderReturnAccepted } from './types';
import type { ItemVariant, MenuItem, Order, Session, User } from './types';

type PartnerRole = 'restaurant' | 'shop';
type PartnerTab = 'orders' | 'catalog' | 'coupons' | 'finance' | 'account';

type PartnerOrder = Order & {
  customerName?: string;
  customerPhone?: string;
  items?: (Order['items'] extends (infer I)[] | undefined ? I : never)[];
  subtotal?: number;
  deliveryAddress?: {
    label?: string;
    line1?: string;
    line2?: string;
    city?: string;
    postalCode?: string;
    phone?: string;
    digipin?: string;
  };
};

type Props = {
  session: Session;
  partnerRole: PartnerRole;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

const statusActions: Record<string, { next: string; label: string }[]> = {
  placed: [{ next: 'accepted', label: '✓ Accept Order' }, { next: 'cancelled', label: '✕ Decline' }],
  accepted: [{ next: 'preparing', label: 'Start preparing' }, { next: 'cancelled', label: '✕ Decline' }],
  preparing: [{ next: 'ready_for_pickup', label: 'Ready for pickup' }, { next: 'cancelled', label: '✕ Decline' }],
  ready_for_pickup: [{ next: 'cancelled', label: '✕ Decline' }],
  out_for_delivery: [{ next: 'cancelled', label: '✕ Decline' }],
};

function money(value: number | undefined): string {
  return `₹${Number(value || 0).toFixed(0)}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function formatStatus(status: string | undefined): string {
  if (!status) return 'Placed';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeColors(status: string | undefined): { bg: string; text: string } {
  const s = (status || '').toLowerCase();
  if (s === 'delivered') return { bg: '#1b8742', text: '#ffffff' };
  if (s === 'accepted') return { bg: '#dcfce7', text: '#15803d' };
  if (s === 'ready_for_pickup' || s === 'pending') return { bg: '#fef08a', text: '#854d0e' };
  if (s === 'cancelled') return { bg: '#fee2e2', text: '#991b1b' };
  if (s === 'preparing') return { bg: '#eff6ff', text: '#1d4ed8' };
  if (s === 'out_for_delivery') return { bg: '#f5f3ff', text: '#6d28d9' };
  return { bg: '#fff0e5', text: '#9b541f' };
}

type FormVariant = {
  id: string;
  name: string;
  price: string;
};

function getDefaultVariants(basePrice: number, isShop: boolean, category = ''): FormVariant[] {
  const p = Math.max(0, Number(basePrice) || 0);
  const cat = (category || '').toLowerCase();

  if (cat.includes('beverage') || cat.includes('drink') || cat.includes('shake') || cat.includes('coffee') || cat.includes('tea') || cat.includes('juice')) {
    return [
      { id: 'regular', name: 'Regular', price: String(Math.round(p)) },
      { id: 'large', name: 'Large', price: String(Math.round(p * 1.35)) },
    ];
  }

  if (isShop || cat.includes('grocery') || cat.includes('dairy') || cat.includes('staple') || cat.includes('produce')) {
    return [
      { id: '500g', name: '500g', price: String(Math.round(p)) },
      { id: '1kg', name: '1 kg', price: String(Math.round(p * 1.85)) },
    ];
  }

  const halfPrice = Math.max(10, Math.round((p * 0.6) / 5) * 5);
  return [
    { id: 'half', name: 'Half', price: String(halfPrice) },
    { id: 'full', name: 'Full', price: String(p) },
  ];
}

function getOrderPriority(order: PartnerOrder): number {
  const s = (order.status || '').toLowerCase();
  if (s === 'placed') return 0; // New (top)
  if (s === 'accepted' || s === 'preparing' || s === 'ready_for_pickup') return 1; // In progress
  if (
    (s === 'out_for_delivery' ||
      s === 'in_transit' ||
      s === 'picked_up' ||
      order.isPickedUp ||
      order.pickupStatus === 'picked_up') &&
    s !== 'delivered' &&
    s !== 'cancelled' &&
    s !== 'returned'
  ) {
    return 2; // Out for Delivery
  }
  if (s === 'delivered') return 3; // Delivered (bottom)
  return 4; // Cancelled / returned
}

export default function PartnerApp({
  session,
  partnerRole,
  onSignOut,
  onSessionUserUpdate,
}: Props) {
  const isShop = partnerRole === 'shop';
  const apiBase = `/api/${partnerRole}`;
  const itemPath = isShop ? 'items' : 'menu';
  const kind = isShop ? 'Shop' : 'Restaurant';
  const isApproved = session.user.isApproved !== false;
  const [tab, setTab] = useState<PartnerTab>('orders');
  type OrderFilter = 'all' | 'new' | 'in_progress' | 'out_for_delivery' | 'delivered_today';
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [savingItem, setSavingItem] = useState(false);
  const [form, setForm] = useState({
    name: '',
    category: isShop ? 'Packaged Goods' : 'Main Course',
    description: '',
    image: '',
    price: '',
    quantity: '10',
    dietary: 'veg',
  });
  const [formVariants, setFormVariants] = useState<FormVariant[]>([]);
  const knownOrderIds = useRef<Set<string> | null>(null);

  async function loadStatus() {
    const result = await apiRequest<{ isOpen?: boolean; isOnline?: boolean }>(
      `${apiBase}/status`,
      session.token,
    );
    const currentlyOpen = result.isOpen ?? result.isOnline ?? false;
    if (!isApproved && currentlyOpen) {
      await apiRequest(`${apiBase}/status`, session.token, {
        method: 'PUT',
        body: JSON.stringify({ isOpen: false }),
      });
      setIsOpen(false);
      return;
    }
    setIsOpen(currentlyOpen);
  }

  async function loadOrders() {
    const result = await apiRequest<{ orders: PartnerOrder[] }>(
      `${apiBase}/orders`,
      session.token,
    );
    const nextOrders = result.orders || [];
    if (knownOrderIds.current) {
      const newOrder = nextOrders.find(
        (order) =>
          order.status === 'placed' && !knownOrderIds.current?.has(order._id),
      );
      if (newOrder) {
        Alert.alert(
          'New customer order',
          `${newOrder.orderNumber || 'An order'} is waiting for ${kind.toLowerCase()} acceptance.`,
          [{ text: 'View orders', onPress: () => setTab('orders') }, { text: 'Dismiss' }],
        );
      }
    }
    knownOrderIds.current = new Set(nextOrders.map((order) => order._id));
    setOrders(nextOrders);
  }

  async function loadItems() {
    const result = await apiRequest<{ items?: MenuItem[]; menu?: MenuItem[] }>(
      `${apiBase}/${itemPath}`,
      session.token,
    );
    setItems(result.items || result.menu || []);
  }

  async function loadAll() {
    setError('');
    setLoading(true);
    try {
      await Promise.all([loadStatus(), loadOrders(), loadItems()]);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [session.token, partnerRole]);

  useEffect(() => {
    if (tab !== 'orders') return;
    const interval = setInterval(() => {
      void loadOrders().catch((reason) => setError(messageFrom(reason)));
    }, 15_000);
    return () => clearInterval(interval);
  }, [tab, session.token, partnerRole]);

  async function toggleOpen(nextOpen: boolean) {
    setSavingStatus(true);
    setError('');
    try {
      await apiRequest(`${apiBase}/status`, session.token, {
        method: 'PUT',
        body: JSON.stringify(isShop ? { isOpen: nextOpen } : { isOpen: nextOpen }),
      });
      setIsOpen(nextOpen);
    } catch (reason) {
      setError(messageFrom(reason));
      await loadStatus().catch(() => undefined);
    } finally {
      setSavingStatus(false);
    }
  }

  async function updateOrder(order: PartnerOrder, nextStatus: string) {
    const confirm = async () => {
      setBusyId(order._id);
      setError('');
      try {
        const bodyPayload = nextStatus === 'returned'
          ? {
              status: 'returned',
              returnStatus: 'accepted',
              returnAccepted: true,
              returnAcceptedBy: isShop ? 'shop' : 'restaurant',
            }
          : { status: nextStatus };
        await apiRequest(`${apiBase}/orders/${order._id}/status`, session.token, {
          method: 'PUT',
          body: JSON.stringify(bodyPayload),
        }).catch(async () => {
          if (nextStatus === 'returned') {
            await apiRequest(`${apiBase}/orders/${order._id}/return-accept`, session.token, {
              method: 'POST',
            }).catch(() => null);
          }
        });
        await loadOrders();
      } catch (reason) {
        setError(messageFrom(reason));
      } finally {
        setBusyId('');
      }
    };

    if (nextStatus === 'cancelled') {
      Alert.alert('Decline this order?', 'The customer will be notified.', [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Decline order', style: 'destructive', onPress: () => void confirm() },
      ]);
    } else if (nextStatus === 'returned') {
      Alert.alert(
        'Accept returned order?',
        `Confirm that ${isShop ? 'the shop' : 'the restaurant'} has received and accepted this returned order. This will officially conclude live tracking.`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Accept return', onPress: () => void confirm() },
        ],
      );
    } else {
      await confirm();
    }
  }

  function handlePriceChange(value: string) {
    setForm((current) => ({ ...current, price: value }));
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      setFormVariants((prev) => {
        if (!prev.length) {
          return getDefaultVariants(num, isShop, form.category);
        }
        if (prev.length === 2 && prev[0].name === 'Half' && prev[1].name === 'Full') {
          const half = Math.max(10, Math.round((num * 0.6) / 5) * 5);
          return [
            { id: 'half', name: 'Half', price: String(half) },
            { id: 'full', name: 'Full', price: String(num) },
          ];
        }
        if (prev.length === 2 && prev[0].name === '500g' && prev[1].name === '1 kg') {
          const oneKg = Math.round(num * 1.85);
          return [
            { id: '500g', name: '500g', price: String(num) },
            { id: '1kg', name: '1 kg', price: String(oneKg) },
          ];
        }
        return prev;
      });
    }
  }

  function applyPreset(preset: string) {
    const base = Number(form.price) || 100;
    if (preset === 'half_full') {
      const half = Math.max(10, Math.round((base * 0.6) / 5) * 5);
      setFormVariants([
        { id: 'half', name: 'Half', price: String(half) },
        { id: 'full', name: 'Full', price: String(base) },
      ]);
    } else if (preset === 'sizes') {
      const small = Math.max(10, Math.round(base * 0.75));
      const large = Math.round(base * 1.35);
      setFormVariants([
        { id: 'small', name: 'Small', price: String(small) },
        { id: 'medium', name: 'Medium', price: String(base) },
        { id: 'large', name: 'Large', price: String(large) },
      ]);
    } else if (preset === 'portions') {
      const large = Math.round(base * 1.35);
      setFormVariants([
        { id: 'regular', name: 'Regular', price: String(base) },
        { id: 'large', name: 'Large', price: String(large) },
      ]);
    } else if (preset === 'weight_shop') {
      const oneKg = Math.round(base * 1.85);
      setFormVariants([
        { id: '500g', name: '500g', price: String(base) },
        { id: '1kg', name: '1 kg', price: String(oneKg) },
      ]);
    } else if (preset === 'pack_shop') {
      const pack2 = Math.round(base * 1.9);
      setFormVariants([
        { id: 'pack1', name: 'Pack of 1', price: String(base) },
        { id: 'pack2', name: 'Pack of 2', price: String(pack2) },
      ]);
    } else if (preset === 'tri_shop') {
      const quarter = Math.max(10, Math.round((base * 0.55) / 5) * 5);
      const oneKg = Math.round(base * 1.85);
      setFormVariants([
        { id: '250g', name: '250g', price: String(quarter) },
        { id: '500g', name: '500g', price: String(base) },
        { id: '1kg', name: '1 kg', price: String(oneKg) },
      ]);
    }
  }

  function addCustomVariant() {
    const base = Number(form.price) || 100;
    setFormVariants((prev) => [
      ...prev,
      {
        id: `var-${Date.now()}-${prev.length}`,
        name: isShop ? `Pack ${prev.length + 1}` : `Portion ${prev.length + 1}`,
        price: String(base),
      },
    ]);
  }

  function updateVariant(index: number, field: 'name' | 'price', value: string) {
    setFormVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    );
  }

  function removeVariant(index: number) {
    setFormVariants((prev) => prev.filter((_, i) => i !== index));
  }

  function startNewItem() {
    setEditingId('');
    setForm({
      name: '',
      category: isShop ? 'Packaged Goods' : 'Main Course',
      description: '',
      image: '',
      price: '',
      quantity: '10',
      dietary: 'veg',
    });
    setFormVariants(getDefaultVariants(100, isShop, isShop ? 'Packaged Goods' : 'Main Course'));
    setFormVisible(true);
  }

  function startEdit(item: MenuItem) {
    setEditingId(item._id);
    setForm({
      name: item.name,
      category: item.category || (isShop ? 'Packaged Goods' : 'Main Course'),
      description: item.description || '',
      image: item.image || '',
      price: String(item.price ?? ''),
      quantity: String((item as MenuItem & { quantity?: number }).quantity ?? 10),
      dietary: (item as MenuItem & { dietary?: string }).dietary || 'veg',
    });
    const loadedVariants = getItemVariants(item);
    setFormVariants(
      loadedVariants.map((v) => ({
        id: v.id,
        name: v.name,
        price: String(v.price),
      })),
    );
    setFormVisible(true);
  }

  async function saveItem() {
    const price = Number(form.price);
    const quantity = Number(form.quantity);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity < 0) {
      setError('Enter an item name and valid non-negative price and quantity.');
      return;
    }
    setSavingItem(true);
    setError('');
    try {
      let finalVariants: ItemVariant[] = formVariants
        .filter((v) => v.name.trim().length > 0)
        .map((v, idx) => ({
          id: v.id || `v-${Date.now()}-${idx}`,
          name: v.name.trim(),
          price: Number.isFinite(Number(v.price)) && Number(v.price) >= 0 ? Number(v.price) : price,
        }));

      if (!finalVariants.length) {
        finalVariants = getDefaultVariants(price, isShop, form.category).map((v) => ({
          id: v.id,
          name: v.name,
          price: Number(v.price) || price,
        }));
      }

      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        image: form.image.trim(),
        price,
        quantity,
        dietary: form.dietary,
        variants: finalVariants,
      };
      await apiRequest(
        editingId ? `${apiBase}/${itemPath}/${editingId}` : `${apiBase}/${itemPath}`,
        session.token,
        {
          method: editingId ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setFormVisible(false);
      setEditingId('');
      await loadItems();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSavingItem(false);
    }
  }

  async function toggleItem(item: MenuItem) {
    setBusyId(item._id);
    setError('');
    try {
      await apiRequest(`${apiBase}/${itemPath}/${item._id}`, session.token, {
        method: 'PUT',
        body: JSON.stringify({ isActive: item.isActive === false }),
      });
      await loadItems();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusyId('');
    }
  }

  function deleteItem(item: MenuItem) {
    Alert.alert(`Delete ${isShop ? 'item' : 'dish'}?`, item.name, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(item._id);
          setError('');
          try {
            await apiRequest(`${apiBase}/${itemPath}/${item._id}`, session.token, {
              method: 'DELETE',
            });
            await loadItems();
          } catch (reason) {
            setError(messageFrom(reason));
          } finally {
            setBusyId('');
          }
        },
      },
    ]);
  }

  async function showNotifications() {
    setError('');
    try {
      const result = await apiRequest<{
        notifications: { title?: string; message?: string }[];
      }>(`${apiBase}/notifications`, session.token);
      const content = result.notifications
        .slice(0, 5)
        .map((entry) => `• ${entry.title || 'Tomato update'}: ${entry.message || ''}`)
        .join('\n\n');
      Alert.alert(`${kind} updates`, content || 'You are all caught up.');
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }

  function signOut() {
    setSignOutModalVisible(true);
  }

  async function performSignOut() {
    setIsSigningOut(true);
    try {
      await apiRequest('/api/auth/logout', session.token, { method: 'POST' });
    } catch (reason) {
      Alert.alert('Could not revoke server session', messageFrom(reason));
    } finally {
      setIsSigningOut(false);
      setSignOutModalVisible(false);
      await onSignOut();
    }
  }

  async function refresh() {
    setRefreshing(true);
    await loadAll();
  }

  const incomingCount = orders.filter((order) => order.status === 'placed').length;
  const activeCount = orders.filter((order) => {
    const s = (order.status || '').toLowerCase();
    return (
      ['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'picked_up'].includes(s) ||
      order.isPickedUp ||
      order.pickupStatus === 'picked_up'
    ) && s !== 'delivered' && s !== 'cancelled' && s !== 'returned';
  }).length;
  const outForDeliveryCount = orders.filter((order) => {
    const s = (order.status || '').toLowerCase();
    return (
      s === 'out_for_delivery' ||
      s === 'in_transit' ||
      order.isPickedUp ||
      order.pickupStatus === 'picked_up'
    ) && s !== 'delivered' && s !== 'cancelled' && s !== 'returned';
  }).length;
  const deliveredTodayCount = orders.filter((order) => {
    const s = (order.status || '').toLowerCase();
    if (s !== 'delivered') return false;
    const dateStr = (order as any).deliveredAt || order.updatedAt || order.createdAt;
    if (!dateStr) return true;
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }).length;
  const salesVolume = orders.reduce((sum, order) => {
    if ((order.status || '').toLowerCase() === 'cancelled') return sum;
    return sum + Number(order.totalAmount || 0);
  }, 0);

  const filteredOrders = useMemo(() => {
    let list = orders.filter((order) => {
      if (orderFilter === 'new') {
        return order.status === 'placed';
      }
      if (orderFilter === 'in_progress') {
        const s = (order.status || '').toLowerCase();
        return (
          ['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'picked_up'].includes(s) ||
          order.isPickedUp ||
          order.pickupStatus === 'picked_up'
        ) && s !== 'delivered' && s !== 'cancelled' && s !== 'returned';
      }
      if (orderFilter === 'out_for_delivery') {
        const s = (order.status || '').toLowerCase();
        return (
          s === 'out_for_delivery' ||
          s === 'in_transit' ||
          order.isPickedUp ||
          order.pickupStatus === 'picked_up'
        ) && s !== 'delivered' && s !== 'cancelled' && s !== 'returned';
      }
      if (orderFilter === 'delivered_today') {
        const s = (order.status || '').toLowerCase();
        if (s !== 'delivered') return false;
        const dateStr = (order as any).deliveredAt || order.updatedAt || order.createdAt;
        if (!dateStr) return true;
        const d = new Date(dateStr);
        const now = new Date();
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }
      return true;
    });

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((order) => {
        const orderNo = (order.orderNumber || '').toLowerCase();
        const cust = (order.customerName || '').toLowerCase();
        const id = (order._id || '').toLowerCase();
        const itemNames = (order.items || []).map((it) => it.name.toLowerCase()).join(' ');
        return orderNo.includes(q) || cust.includes(q) || id.includes(q) || itemNames.includes(q);
      });
    }

    list.sort((a, b) => {
      const pA = getOrderPriority(a);
      const pB = getOrderPriority(b);
      if (pA !== pB) {
        return pA - pB;
      }
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    return list;
  }, [orders, orderFilter, search]);

  return (
    <View style={styles.app}>
      <GlobalHeader
        session={session}
        onBrandPress={() => setTab('orders')}
        searchQuery={search}
        onSearchChange={(text) => setSearch(text)}
        searchPlaceholder={`Search ${isShop ? 'products' : 'dishes'} or orders…`}
        city={session.user.city || 'Bengaluru'}
        pincode={session.user.pincode || '560001'}
        onNotificationPress={() => void showNotifications()}
        rightActions={
          <Pressable onPress={() => void refresh()} style={styles.headerIconButton}>
            <Text style={styles.headerRefreshIcon}>↻</Text>
          </Pressable>
        }
        roleLabel={`${kind} partner`}
        profileMenuItems={[
          { key: 'orders', label: 'Orders', description: 'Accept and manage incoming orders', icon: '▤' },
          { key: 'catalog', label: isShop ? 'Inventory' : 'Menu', description: 'Manage products and availability', icon: '☷' },
          { key: 'coupons', label: 'Coupons & offers', description: 'Manage your promotions', icon: '％' },
          { key: 'finance', label: 'Finance', description: 'View transfers and earnings', icon: '₹' },
          { key: 'account', label: 'Business profile & bank', description: 'Edit business and payout details', icon: '⚙' },
        ]}
        onNavigateProfile={(key) => setTab(key as PartnerTab)}
        onSignOut={performSignOut}
        onSessionUserUpdate={onSessionUserUpdate}
      />
      {!!error && (
        <Pressable onPress={() => setError('')} style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.dismiss}>×</Text>
        </Pressable>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#d83a32" />}
      >
        {tab === 'orders' && (
          <View>
            <Text style={styles.eyebrow}>{kind.toUpperCase()} OPERATIONS</Text>
            <Text style={styles.title}>{isShop ? 'Shop orders' : 'Kitchen orders'}</Text>
            <Text style={styles.subtitle}>Review incoming orders and keep customers updated.</Text>
            {!isApproved && (
              <ApprovalNotice kind={kind} />
            )}
            <View style={styles.statusCard}>
              <View style={styles.flex}>
                <Text style={styles.statusTitle}>{isOpen ? 'Accepting orders' : 'Not accepting orders'}</Text>
                <Text style={styles.muted}>
                  {savingStatus ? 'Updating status…' : `${kind} is ${isOpen ? 'open' : 'closed'}`}
                  {session.user.digipin ? ` · DIGIPIN: ${formatDigipin(session.user.digipin)}` : ''}
                </Text>
              </View>
              <Switch
                accessibilityLabel={`Set ${kind.toLowerCase()} ${isOpen ? 'closed' : 'open'}`}
                disabled={savingStatus || loading || !isApproved}
                onValueChange={(value) => void toggleOpen(value)}
                thumbColor={isOpen ? '#fff' : '#f5f5f5'}
                trackColor={{ false: '#cfc5bc', true: '#49a86a' }}
                value={isOpen}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statsScrollContent}
              style={styles.statsScrollView}
            >
              <StatCard
                label="New"
                value={incomingCount}
                tint="#fff0e5"
                selected={orderFilter === 'new'}
                onPress={() => setOrderFilter((prev) => (prev === 'new' ? 'all' : 'new'))}
              />
              <StatCard
                label="In progress"
                value={activeCount}
                tint="#eaf2ff"
                selected={orderFilter === 'in_progress'}
                onPress={() => setOrderFilter((prev) => (prev === 'in_progress' ? 'all' : 'in_progress'))}
              />
              <StatCard
                label="Out For Delivery"
                value={outForDeliveryCount}
                tint="#f5f3ff"
                selected={orderFilter === 'out_for_delivery'}
                onPress={() => setOrderFilter((prev) => (prev === 'out_for_delivery' ? 'all' : 'out_for_delivery'))}
              />
              <StatCard
                label="Delivered Today"
                value={deliveredTodayCount}
                tint="#dcfce7"
                selected={orderFilter === 'delivered_today'}
                onPress={() => setOrderFilter((prev) => (prev === 'delivered_today' ? 'all' : 'delivered_today'))}
              />
              <StatCard
                label="All Orders"
                value={orders.length}
                tint="#eff7ee"
                selected={orderFilter === 'all'}
                onPress={() => setOrderFilter('all')}
              />
              <StatCard
                label={isShop ? 'Shop Items' : 'Menu Items'}
                value={items.length}
                tint="#fef3c7"
                onPress={() => setTab('catalog')}
              />
              <StatCard
                label="Sales Volume"
                value={money(salesVolume)}
                tint="#fff7ed"
                onPress={() => setTab('finance')}
              />
            </ScrollView>
            {loading ? (
              <ActivityIndicator color="#d83a32" style={styles.loader} />
            ) : filteredOrders.length ? (
              filteredOrders.map((order) => (
                <PartnerOrderCard
                  key={order._id}
                  busy={busyId === order._id}
                  canManage={isApproved}
                  isShop={isShop}
                  order={order}
                  onChange={(status) => void updateOrder(order, status)}
                />
              ))
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🍅</Text>
                <Text style={styles.cardTitle}>
                  {orderFilter === 'all'
                    ? 'No orders yet'
                    : `No ${orderFilter === 'new' ? 'new' : orderFilter === 'in_progress' ? 'in-progress' : orderFilter === 'out_for_delivery' ? 'out for delivery' : 'delivered today'} orders`}
                </Text>
                <Text style={styles.muted}>
                  {orderFilter === 'all'
                    ? 'New customer orders will show up here.'
                    : 'Try selecting a different filter above.'}
                </Text>
                {orderFilter !== 'all' && (
                  <Pressable onPress={() => setOrderFilter('all')} style={styles.resetFilterButton}>
                    <Text style={styles.resetFilterText}>View all orders ({orders.length})</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {tab === 'catalog' && (
          <View>
            <View style={styles.titleRow}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>{kind.toUpperCase()} CATALOG</Text>
                <Text style={styles.title}>{isShop ? 'Inventory' : 'Menu'}</Text>
              </View>
              <Pressable onPress={startNewItem} style={styles.smallPrimary}>
                <Text style={styles.smallPrimaryText}>+ Add</Text>
              </Pressable>
            </View>
            <Text style={styles.subtitle}>Manage what customers can see and order.</Text>
            {formVisible && (
              <View style={styles.formCard}>
                <Text style={styles.cardTitle}>{editingId ? 'Edit listing' : `Add ${isShop ? 'product' : 'dish'}`}</Text>
                <TextInput
                  onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
                  placeholder={isShop ? 'Product name' : 'Dish name'}
                  style={styles.input}
                  value={form.name}
                />
                <TextInput
                  onChangeText={(value) => setForm((current) => ({ ...current, category: value }))}
                  placeholder="Category"
                  style={styles.input}
                  value={form.category}
                />
                <TextInput
                  onChangeText={(value) => setForm((current) => ({ ...current, description: value }))}
                  placeholder="Description"
                  style={[styles.input, styles.multiline]}
                  value={form.description}
                  multiline
                />
                <TextInput
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={(value) => setForm((current) => ({ ...current, image: value }))}
                  placeholder="Image URL (optional)"
                  style={styles.input}
                  value={form.image}
                />
                <View style={styles.inputRow}>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={handlePriceChange}
                    placeholder="Base Price (₹)"
                    style={[styles.input, styles.halfInput]}
                    value={form.price}
                  />
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={(value) => setForm((current) => ({ ...current, quantity: value }))}
                    placeholder="Stock quantity"
                    style={[styles.input, styles.halfInput]}
                    value={form.quantity}
                  />
                </View>
                <Text style={styles.fieldLabel}>Dietary label</Text>
                <View style={styles.dietRow}>
                  {['veg', 'non-veg', 'vegan'].map((diet) => (
                    <Pressable
                      key={diet}
                      onPress={() => setForm((current) => ({ ...current, dietary: diet }))}
                      style={[styles.dietChip, form.dietary === diet && styles.dietChipActive]}
                    >
                      <Text style={[styles.dietText, form.dietary === diet && styles.dietTextActive]}>{diet}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Variants (Portions & Sizes) */}
                <View style={styles.variantsSection}>
                  <View style={styles.variantHeaderRow}>
                    <View style={styles.flex}>
                      <Text style={styles.variantSectionTitle}>Variants (Portions & Sizes)</Text>
                      <Text style={styles.variantSubhint}>
                        {isShop
                          ? 'e.g. 500g, 1 kg, or pack sizes with custom pricing'
                          : 'e.g. Half, Full, or portion sizes with custom pricing'}
                      </Text>
                    </View>
                    <Pressable onPress={addCustomVariant} style={styles.addVariantMiniBtn}>
                      <Text style={styles.addVariantMiniBtnText}>+ Add Variant</Text>
                    </Pressable>
                  </View>

                  {/* Quick Preset Buttons */}
                  <View style={styles.presetButtonsRow}>
                    <Text style={styles.presetLabel}>Presets:</Text>
                    {isShop ? (
                      <>
                        <Pressable onPress={() => applyPreset('weight_shop')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>500g / 1 kg</Text>
                        </Pressable>
                        <Pressable onPress={() => applyPreset('pack_shop')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>Pack of 1 / 2</Text>
                        </Pressable>
                        <Pressable onPress={() => applyPreset('tri_shop')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>250g / 500g / 1kg</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Pressable onPress={() => applyPreset('half_full')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>Half / Full</Text>
                        </Pressable>
                        <Pressable onPress={() => applyPreset('sizes')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>Small / Med / Large</Text>
                        </Pressable>
                        <Pressable onPress={() => applyPreset('portions')} style={styles.presetChip}>
                          <Text style={styles.presetChipText}>Regular / Large</Text>
                        </Pressable>
                      </>
                    )}
                  </View>

                  {/* Variant Input Rows */}
                  {formVariants.map((v, idx) => (
                    <View key={v.id || idx} style={styles.variantInputRow}>
                      <TextInput
                        placeholder={isShop ? 'Variant (e.g. 500g)' : 'Variant (e.g. Half)'}
                        style={[styles.input, styles.variantNameInput]}
                        value={v.name}
                        onChangeText={(name) => updateVariant(idx, 'name', name)}
                      />
                      <TextInput
                        placeholder="Price (₹)"
                        keyboardType="decimal-pad"
                        style={[styles.input, styles.variantPriceInput]}
                        value={v.price}
                        onChangeText={(price) => updateVariant(idx, 'price', price)}
                      />
                      {formVariants.length > 1 && (
                        <Pressable onPress={() => removeVariant(idx)} style={styles.variantRemoveBtn}>
                          <Text style={styles.variantRemoveText}>✕</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>

                <Pressable disabled={savingItem} onPress={() => void saveItem()} style={styles.primary}>
                  <Text style={styles.primaryText}>{savingItem ? 'Saving…' : editingId ? 'Save changes' : 'Add listing'}</Text>
                </Pressable>
                <Pressable onPress={() => setFormVisible(false)} style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            )}
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : items.length ? (
              items.map((item) => {
                const itemVariants = getItemVariants(item);
                return (
                  <View key={item._id} style={styles.itemCard}>
                    <View style={styles.flex}>
                      <Text style={styles.cardTitle}>{item.name}</Text>
                      <Text style={styles.muted}>{item.category || (isShop ? 'Product' : 'Dish')} · {money(item.price)}</Text>
                      {itemVariants.length > 0 && (
                        <View style={styles.itemVariantsRow}>
                          {itemVariants.map((v) => (
                            <View key={v.id} style={styles.itemVariantBadge}>
                              <Text style={styles.itemVariantBadgeText}>
                                {v.name}: {money(v.price)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                      <Text style={[styles.stock, item.isActive === false && styles.stockOff]}>
                        {item.isActive === false ? 'Hidden from customers' : 'Available to customers'}
                      </Text>
                    </View>
                  <View style={styles.itemActions}>
                    <Pressable disabled={busyId === item._id} onPress={() => void toggleItem(item)} style={styles.itemAction}>
                      <Text style={styles.linkText}>{item.isActive === false ? 'Show' : 'Hide'}</Text>
                    </Pressable>
                    <Pressable onPress={() => startEdit(item)} style={styles.itemAction}>
                      <Text style={styles.linkText}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => deleteItem(item)} style={styles.itemAction}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          ) : (
              <Empty title={`No ${isShop ? 'products' : 'dishes'} listed`} detail="Add your first listing to make it visible to Tomato customers." />
            )}
          </View>
        )}

        {tab === 'account' && (
          <View>
            <Text style={styles.eyebrow}>PARTNER ACCOUNT</Text>
            <Text style={styles.title}>Your workspace</Text>
            <View style={styles.accountCard}>
              <Text style={styles.accountName}>{session.user.name || kind}</Text>
              {!!session.user.email && <Text style={styles.muted}>{session.user.email}</Text>}
              {!!session.user.phone && <Text style={styles.muted}>{session.user.phone}</Text>}
              <Text style={styles.accountRole}>{kind.toUpperCase()} PARTNER · {getAccountDisplayId(session.user, partnerRole)}</Text>
              {!isApproved && <Text style={styles.pendingText}>Awaiting administrator approval</Text>}
            </View>
            <PartnerModules session={session} partnerRole={partnerRole} section="account" />
            <Pressable onPress={() => setTab('orders')} style={styles.accountAction}>
              <Text style={styles.actionLabel}>Manage orders</Text><Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable onPress={() => setTab('catalog')} style={styles.accountAction}>
              <Text style={styles.actionLabel}>Manage {isShop ? 'inventory' : 'menu'}</Text><Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable onPress={signOut} style={[styles.accountAction, styles.signOut]}>
              <Text style={styles.deleteText}>Sign out</Text>
            </Pressable>
          </View>
        )}

        {(tab === 'coupons' || tab === 'finance') && (
          <PartnerModules
            session={session}
            partnerRole={partnerRole}
            section={tab}
          />
        )}
      </ScrollView>
      <View style={styles.tabBar}>
        {([
          ['orders', 'Orders', '▤'],
          ['catalog', isShop ? 'Inventory' : 'Menu', '☷'],
          ['coupons', 'Deals', '％'],
          ['finance', 'Finance', '₹'],
          ['account', 'Account', '☺'],
        ] as [PartnerTab, string, string][]).map(([id, label, icon]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={styles.tabButton}>
            <Text style={[styles.tabIcon, tab === id && styles.activeTab]}>{icon}</Text>
            <Text style={[styles.tabLabel, tab === id && styles.activeTab]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <SignOutModal
        visible={signOutModalVisible}
        onClose={() => setSignOutModalVisible(false)}
        onConfirm={performSignOut}
        isLoading={isSigningOut}
      />
    </View>
  );
}

function PartnerOrderCard({
  order,
  isShop,
  busy,
  canManage,
  onChange,
}: {
  order: PartnerOrder;
  isShop: boolean;
  busy: boolean;
  canManage: boolean;
  onChange: (status: string) => void;
}) {
  const status = order.status || 'placed';
  const actions = statusActions[status] || [];
  const isCancelled = status.toLowerCase() === 'cancelled';
  const isDelivered = status.toLowerCase() === 'delivered';
  const isPickedUp = Boolean(
    order.isPickedUp ||
    order.pickupStatus === 'picked_up' ||
    status.toLowerCase() === 'out_for_delivery'
  );
  const returnAccepted = isOrderReturnAccepted(order);
  const itemNames = order.items?.map((item) => `${item.name}(${item.quantity || 1})`).join(', ');
  const address = order.deliveryAddress;
  const rawOrderNumber = order.orderNumber || order._id.slice(-6);
  const formattedOrderNumber = rawOrderNumber.startsWith('#') ? rawOrderNumber : `#${rawOrderNumber}`;
  const statusLabel = formatStatus(status);
  const badgeStyle = statusBadgeColors(status);
  const [showBill, setShowBill] = useState(false);
  const [showTracking, setShowTracking] = useState(false);

  const isRiderAssigned = Boolean(
    (order as any).rider ||
    (order as any).riderId ||
    (order as any).riderUserId ||
    (order as any).assignedRider ||
    (order as any).riderName ||
    ['out_for_delivery', 'picked_up', 'in_transit', 'delivered'].includes((order.status || '').toLowerCase()) ||
    order.isPickedUp ||
    order.pickupStatus === 'picked_up'
  );

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
          <Text style={styles.muted}>{order.customerName || 'Tomato customer'} · {order.createdAt ? new Date(order.createdAt).toLocaleString() : 'New order'}</Text>
          {!!itemNames && <Text style={styles.orderItems}>{itemNames}</Text>}
        </View>
        <View style={styles.orderAmountCol}>
          <Text style={styles.orderTotal}>{money(order.totalAmount)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showBill ? 'Close bill' : 'View bill'}
            onPress={() => setShowBill((prev) => !prev)}
            style={[styles.billIconButton, showBill && styles.billIconButtonActive]}
          >
            <Text style={styles.billIconEmoji}>🧾</Text>
          </Pressable>
        </View>
      </View>
      {showBill && (
        <View style={styles.billBox}>
          <View style={styles.billBoxHeader}>
            <Text style={styles.billBoxTitle}>🧾 Bill Summary</Text>
            <Pressable onPress={() => setShowBill(false)}>
              <Text style={styles.billBoxClose}>✕</Text>
            </Pressable>
          </View>
          {order.items && order.items.length > 0 && (
            <View style={styles.billItemsList}>
              {order.items.map((it, idx) => (
                <View key={idx} style={styles.billItemRow}>
                  <Text style={styles.billItemName} numberOfLines={1}>
                    {it.name} × {it.quantity || 1}
                  </Text>
                  <Text style={styles.billItemPrice}>
                    {money((Number(it.price) || 0) * (it.quantity || 1))}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.billBoxDivider} />
          <View style={styles.billItemRow}>
            <Text style={styles.billItemTotalLabel}>Total Amount</Text>
            <Text style={styles.billItemTotalValue}>{money(order.totalAmount)}</Text>
          </View>
        </View>
      )}
      {(() => {
        const isPaid = (order.paymentStatus || '').toLowerCase() === 'paid';
        const isPending = (order.paymentStatus || '').toLowerCase() === 'pending' || !isPaid;
        const methodRaw = (order.paymentMethod || 'cod').toLowerCase();
        const isCod = methodRaw === 'cod' || methodRaw === 'cash';
        const methodDisplay = isCod ? 'COD' : (order.paymentMethod || 'ONLINE').toUpperCase();
        const paymentStatusDisplay = (order.paymentStatus || (isPaid ? 'paid' : 'pending')).toUpperCase();
        return (
          <Text style={styles.orderDetail}>
            Payment:{' '}
            <Text style={[styles.orderDetail, isCod && { color: '#dc2626', fontWeight: '800' }]}>
              {methodDisplay}
            </Text>
            {' · '}
            <Text style={[
              styles.orderDetail,
              isPaid
                ? { color: '#16a34a', fontWeight: '800' }
                : isPending
                  ? { color: '#ca8a04', fontWeight: '800' }
                  : {},
            ]}>
              {paymentStatusDisplay}
            </Text>
          </Text>
        );
      })()}
      <View style={styles.deliveryRow}>
        <Text style={[styles.orderDetail, styles.flex, { marginTop: 0 }]}>
          Delivery: {address?.line1 ? `${address.line1}${address.line2 ? `, ${address.line2}` : ''}, ${address.city} ${address.postalCode}${address.digipin ? ` · DIGIPIN: ${formatDigipin(address.digipin)}` : ''}` : (address?.city ? `${address.city} ${address.postalCode || ''}`.trim() : 'Standard delivery')}
        </Text>
        {!isDelivered && !isCancelled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isRiderAssigned ? 'Track delivery rider' : 'Rider has not accepted this order yet'}
            disabled={!isRiderAssigned}
            onPress={() => {
              if (!isRiderAssigned) {
                Alert.alert('Rider not accepted', 'Tracking will be enabled once a delivery rider accepts this order.');
                return;
              }
              setShowTracking((prev) => !prev);
            }}
            style={[
              styles.trackIconButton,
              isRiderAssigned ? styles.trackIconButtonActive : styles.trackIconButtonDisabled,
            ]}
          >
            <Text style={[styles.trackIconEmoji, !isRiderAssigned && styles.trackIconEmojiDisabled]}>
              📍
            </Text>
          </Pressable>
        )}
      </View>
      {isPickedUp && !isDelivered && !isCancelled && (
        <Text style={styles.deliveryPartnerNote}>
          This {isShop ? 'shop' : 'restaurant'} order is now with the delivery partner.
        </Text>
      )}
      {showTracking && isRiderAssigned && !isDelivered && !isCancelled && (
        <View style={styles.trackingBox}>
          <View style={styles.trackingBoxHeader}>
            <Text style={styles.trackingBoxTitle}>📍 Live Rider Tracking</Text>
            <Pressable onPress={() => setShowTracking(false)}>
              <Text style={styles.billBoxClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.trackingText}>
            Rider: {(order as any).riderName || (order as any).rider?.name || 'Assigned Delivery Partner'}
          </Text>
          {!!((order as any).riderPhone || (order as any).rider?.phone) && (
            <Text style={styles.trackingText}>
              Phone: {((order as any).riderPhone || (order as any).rider?.phone)}
            </Text>
          )}
          <Text style={styles.trackingStatusText}>
            Status: {order.isPickedUp || order.pickupStatus === 'picked_up'
              ? '📦 Order picked up · On the way to customer'
              : '🚴 Rider accepted · Heading to ' + (isShop ? 'shop' : 'restaurant') + ' for pickup'}
          </Text>
          {(() => {
            const coords = (order as any).rider?.currentLocation || address?.coordinates || address?.location?.coordinates;
            if (coords) {
              const lat = Array.isArray(coords) ? coords[1] : coords.lat;
              const lng = Array.isArray(coords) ? coords[0] : coords.lng;
              if (typeof lat === 'number' && typeof lng === 'number') {
                return (
                  <Pressable
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                      void Linking.openURL(url).catch(() => Alert.alert('Unable to open map'));
                    }}
                    style={styles.viewMapButton}
                  >
                    <Text style={styles.viewMapText}>🗺 View rider route on Google Maps</Text>
                  </Pressable>
                );
              }
            }
            return null;
          })()}
        </View>
      )}

      {isCancelled && !returnAccepted && canManage && (
        <View style={styles.returnBox}>
          <Text style={styles.returnBoxText}>
            📦 Order was cancelled · Item returning to {isShop ? 'shop' : 'restaurant'}
          </Text>
          <Pressable
            disabled={busy}
            onPress={() => onChange('returned')}
            style={[styles.orderAction, styles.acceptReturnAction]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.primaryActionText}>Accept Return ({isShop ? 'Shop' : 'Restaurant'})</Text>
            )}
          </Pressable>
        </View>
      )}

      {isCancelled && returnAccepted && (
        <View style={styles.returnAcceptedBox}>
          <Text style={styles.returnAcceptedText}>
            ✅ Return accepted by {order.returnAcceptedBy || (isShop ? 'shop' : 'restaurant')}. Tracking ended.
          </Text>
        </View>
      )}

      {!!actions.length && canManage && (
        <View style={styles.orderActions}>
          {actions.map((action) => (
            <Pressable
              key={action.next}
              disabled={busy}
              onPress={() => onChange(action.next)}
              style={[
                styles.orderAction,
                action.next === 'cancelled'
                  ? styles.cancelOrderAction
                  : action.next === 'accepted'
                    ? styles.acceptOrderAction
                    : action.next === 'ready_for_pickup'
                      ? styles.readyOrderAction
                      : styles.primaryOrderAction,
              ]}
            >
              {busy ? <ActivityIndicator color={action.next === 'cancelled' ? '#b42318' : action.next === 'ready_for_pickup' ? '#713f12' : '#fff'} /> : (
                <Text style={
                  action.next === 'cancelled'
                    ? styles.cancelActionText
                    : action.next === 'ready_for_pickup'
                      ? styles.readyActionText
                      : styles.primaryActionText
                }>{action.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {!!actions.length && !canManage && (
        <Text style={styles.pendingText}>Order actions are available after partner approval.</Text>
      )}
    </View>
  );
}

function getStatCardBorder(tint: string): string {
  switch (tint) {
    case '#fff0e5': return '#fed7aa';
    case '#eaf2ff': return '#bfdbfe';
    case '#f5f3ff': return '#ddd6fe';
    case '#dcfce7': return '#bbf7d0';
    case '#fef3c7': return '#fde68a';
    case '#eff7ee': return '#bbf7d0';
    case '#fff7ed': return '#fed7aa';
    default: return '#e5e7eb';
  }
}

function StatCard({
  label,
  value,
  tint,
  selected = false,
  onPress,
}: {
  label: string;
  value: number | string;
  tint: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const border = selected ? '#d83a32' : getStatCardBorder(tint);
  const content = (
    <View
      style={[
        styles.statCard,
        { backgroundColor: tint, borderColor: border },
        selected && styles.statCardSelected,
      ]}
    >
      <Text style={[styles.statValue, selected && styles.statValueSelected]}>{value}</Text>
      <Text style={[styles.statLabel, selected && styles.statLabelSelected]} numberOfLines={1}>
        {selected ? `✓ ${label}` : label}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.statCardPressable}>
        {content}
      </Pressable>
    );
  }
  return content;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🍅</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.muted}>{detail}</Text>
    </View>
  );
}

function ApprovalNotice({ kind }: { kind: string }) {
  return (
    <View style={styles.approvalNotice}>
      <Text style={styles.approvalTitle}>{kind} approval pending</Text>
      <Text style={styles.approvalDetail}>
        Your account is awaiting administrator approval. Order status changes are unavailable until approval.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#fffaf5' },
  flex: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0e8e1', flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { fontSize: 21, color: '#d83a32', fontWeight: '800' },
  role: { color: '#7b7169', fontSize: 12, marginTop: 2 },
  headerButton: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#fff1eb' },
  headerIcon: { color: '#c8322a', fontSize: 22 },
  headerIconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff7f5', borderWidth: 1, borderColor: '#fce7e3', alignItems: 'center', justifyContent: 'center' },
  headerRefreshIcon: { color: '#c8322a', fontSize: 18, fontWeight: '700' },
  content: { paddingHorizontal: 17, paddingTop: 20, paddingBottom: 24, flexGrow: 1 },
  errorBanner: { backgroundColor: '#fff1f0', marginHorizontal: 14, marginTop: 9, borderRadius: 11, padding: 10, flexDirection: 'row', alignItems: 'center' },
  errorText: { color: '#b42318', fontSize: 12, lineHeight: 17, flex: 1 },
  dismiss: { color: '#b42318', fontSize: 20, paddingHorizontal: 5 },
  eyebrow: { color: '#d83a32', fontWeight: '800', fontSize: 10, letterSpacing: 1.2, marginBottom: 6 },
  title: { color: '#2d2621', fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: '#82786f', fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 17 },
  statusCard: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  approvalNotice: { backgroundColor: '#fff7e8', borderColor: '#f2dfbd', borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 12 },
  approvalTitle: { color: '#8b521c', fontSize: 13, fontWeight: '800' },
  approvalDetail: { color: '#806744', fontSize: 11, lineHeight: 16, marginTop: 4 },
  statusTitle: { color: '#302923', fontWeight: '800', fontSize: 14 },
  muted: { color: '#82786f', fontSize: 12, lineHeight: 18, marginTop: 3 },
  statsScrollView: { marginBottom: 16 },
  statsScrollContent: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  statCard: { minWidth: 105, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  statCardSelected: { borderWidth: 2, borderColor: '#d83a32' },
  statCardPressable: { minWidth: 105 },
  statValue: { color: '#302923', fontSize: 18, fontWeight: '800' },
  statValueSelected: { color: '#d83a32' },
  statLabel: { color: '#71675f', fontSize: 10, marginTop: 3, textAlign: 'center', fontWeight: '700' },
  statLabelSelected: { color: '#d83a32', fontWeight: '800' },
  resetFilterButton: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#fff0eb', borderWidth: 1, borderColor: '#fcdcd5' },
  resetFilterText: { color: '#d83a32', fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 40 },
  orderCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 11 },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  orderNumberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  orderNumber: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  orderStatusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  orderTotal: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderAmountCol: { alignItems: 'flex-end', justifyContent: 'flex-start', gap: 4 },
  billIconButton: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#fff7f2', borderWidth: 1, borderColor: '#fed7aa', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  billIconButtonActive: { backgroundColor: '#ffedd5', borderColor: '#f97316' },
  billIconEmoji: { fontSize: 16 },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 },
  trackIconButton: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center' },
  trackIconButtonActive: { backgroundColor: '#dbeafe', borderColor: '#3b82f6' },
  trackIconButtonDisabled: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', opacity: 0.4 },
  trackIconEmoji: { fontSize: 16 },
  trackIconEmojiDisabled: { opacity: 0.4 },
  billBox: { marginTop: 10, padding: 12, backgroundColor: '#fffbf5', borderRadius: 12, borderWidth: 1, borderColor: '#fed7aa' },
  billBoxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  billBoxTitle: { fontSize: 13, fontWeight: '800', color: '#7c2d12' },
  billBoxClose: { fontSize: 16, color: '#9a3412', fontWeight: '700', paddingHorizontal: 4 },
  billItemsList: { gap: 4, marginBottom: 8 },
  billItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  billItemName: { fontSize: 12, color: '#431407', flex: 1 },
  billItemPrice: { fontSize: 12, fontWeight: '700', color: '#431407' },
  billBoxDivider: { height: 1, backgroundColor: '#fed7aa', marginVertical: 6 },
  billItemTotalLabel: { fontSize: 12, fontWeight: '800', color: '#431407' },
  billItemTotalValue: { fontSize: 13, fontWeight: '800', color: '#c2410c' },
  trackingBox: { marginTop: 10, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 12, borderWidth: 1, borderColor: '#bae6fd' },
  trackingBoxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  trackingBoxTitle: { fontSize: 13, fontWeight: '800', color: '#0369a1' },
  trackingText: { fontSize: 12, color: '#075985', marginBottom: 3 },
  trackingStatusText: { fontSize: 12, fontWeight: '700', color: '#0284c7', marginTop: 3 },
  viewMapButton: { marginTop: 8, backgroundColor: '#0284c7', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' },
  viewMapText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  orderStatus: { alignSelf: 'flex-start', backgroundColor: '#fff0e5', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, marginTop: 9 },
  orderStatusText: { color: '#9b541f', textTransform: 'capitalize', fontWeight: '800', fontSize: 10 },
  orderItemsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9 },
  orderItems: { color: '#4e453e', fontSize: 12, lineHeight: 18, marginTop: 3 },
  orderDetail: { color: '#83796f', fontSize: 11, lineHeight: 17, marginTop: 4 },
  deliveryPartnerNote: { color: '#0284c7', fontSize: 11, fontWeight: '700', lineHeight: 16, marginTop: 5 },
  orderActions: { flexDirection: 'row', gap: 8, marginTop: 13 },
  orderAction: { flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  primaryOrderAction: { backgroundColor: '#d83a32' },
  acceptOrderAction: { backgroundColor: '#16a34a' },
  readyOrderAction: { backgroundColor: '#eab308' },
  acceptReturnAction: { backgroundColor: '#166534' },
  cancelOrderAction: { backgroundColor: '#fff', borderColor: '#f1d3d0', borderWidth: 1 },
  returnBox: { marginTop: 10, padding: 10, backgroundColor: '#fff7ed', borderRadius: 10, borderWidth: 1, borderColor: '#fed7aa' },
  returnBoxText: { fontSize: 12, color: '#c2410c', fontWeight: '700', marginBottom: 8 },
  returnAcceptedBox: { marginTop: 10, padding: 10, backgroundColor: '#f0fdf4', borderRadius: 10, borderWidth: 1, borderColor: '#bbf7d0' },
  returnAcceptedText: { fontSize: 12, color: '#166534', fontWeight: '700' },
  primaryActionText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  readyActionText: { color: '#713f12', fontWeight: '800', fontSize: 12 },
  cancelActionText: { color: '#b42318', fontWeight: '700', fontSize: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallPrimary: { borderRadius: 11, backgroundColor: '#d83a32', paddingHorizontal: 13, paddingVertical: 10 },
  smallPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  formCard: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  cardTitle: { color: '#302923', fontSize: 14, fontWeight: '800' },
  input: { minHeight: 44, backgroundColor: '#fffaf7', borderColor: '#eee3da', borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, color: '#302923', fontSize: 13, marginTop: 9 },
  multiline: { minHeight: 72, textAlignVertical: 'top', paddingTop: 11 },
  inputRow: { flexDirection: 'row', gap: 8 },
  halfInput: { flex: 1 },
  fieldLabel: { color: '#756b63', fontSize: 11, fontWeight: '700', marginTop: 12 },
  dietRow: { flexDirection: 'row', gap: 7, marginVertical: 9 },
  dietChip: { borderColor: '#eee3da', borderWidth: 1, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10 },
  dietChipActive: { borderColor: '#d83a32', backgroundColor: '#fff0eb' },
  dietText: { color: '#776d65', fontSize: 11, textTransform: 'capitalize' },
  dietTextActive: { color: '#c8322a', fontWeight: '800' },
  variantsSection: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#fff9f6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fcdcd5',
  },
  variantHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  variantSectionTitle: {
    color: '#302923',
    fontSize: 12,
    fontWeight: '800',
  },
  variantSubhint: {
    color: '#8c7d75',
    fontSize: 11,
    marginTop: 2,
  },
  addVariantMiniBtn: {
    backgroundColor: '#d83a32',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  addVariantMiniBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  presetButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6e5f56',
  },
  presetChip: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e7d9d0',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3d3028',
  },
  variantInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  variantNameInput: {
    flex: 2,
    marginTop: 0,
    backgroundColor: '#ffffff',
  },
  variantPriceInput: {
    flex: 1.2,
    marginTop: 0,
    backgroundColor: '#ffffff',
  },
  variantRemoveBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantRemoveText: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: '700',
  },
  itemVariantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
    marginBottom: 3,
  },
  itemVariantBadge: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  itemVariantBadgeText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '700',
  },
  primary: { minHeight: 44, borderRadius: 11, backgroundColor: '#d83a32', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cancel: { alignItems: 'center', padding: 11 },
  cancelText: { color: '#756b63', fontSize: 12, fontWeight: '700' },
  itemCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 9, flexDirection: 'row', gap: 8, alignItems: 'center' },
  stock: { color: '#27734a', fontSize: 10, fontWeight: '700', marginTop: 5 },
  stockOff: { color: '#927c6d' },
  itemActions: { alignItems: 'flex-end', gap: 8 },
  itemAction: { paddingVertical: 3, paddingHorizontal: 4 },
  linkText: { color: '#c8322a', fontWeight: '700', fontSize: 11 },
  deleteText: { color: '#b42318', fontWeight: '700', fontSize: 12 },
  empty: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 22, alignItems: 'center', marginTop: 10, gap: 5 },
  emptyEmoji: { fontSize: 30 },
  accountCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 17, padding: 20, alignItems: 'center', marginVertical: 18 },
  accountName: { color: '#302923', fontWeight: '800', fontSize: 18, marginBottom: 5 },
  accountRole: { color: '#c8322a', backgroundColor: '#fff0eb', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6, marginTop: 11, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  pendingText: { color: '#9b541f', fontSize: 11, fontWeight: '700', marginTop: 10 },
  accountAction: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  actionLabel: { color: '#302923', fontWeight: '700', fontSize: 13 },
  chevron: { color: '#91867d', fontSize: 20, marginTop: -4 },
  signOut: { justifyContent: 'center', marginTop: 10 },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopColor: '#eee7e1', borderTopWidth: 1, paddingTop: 8, paddingBottom: Platform.OS === 'android' ? 17 : 7, minHeight: Platform.OS === 'android' ? 76 : 63 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { color: '#9a8e84', fontSize: 18, height: 22 },
  tabLabel: { color: '#8d8178', fontSize: 10, fontWeight: '600' },
  activeTab: { color: '#d83a32', fontWeight: '800' },
});
