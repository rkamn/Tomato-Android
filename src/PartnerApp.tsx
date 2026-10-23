import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import PartnerModules from './PartnerModules';
import ProfileAccess from './ProfileAccess';
import type { MenuItem, Order, Session, User } from './types';

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
  };
};

type Props = {
  session: Session;
  partnerRole: PartnerRole;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

const statusActions: Record<string, { next: string; label: string }[]> = {
  placed: [{ next: 'accepted', label: 'Accept order' }, { next: 'cancelled', label: 'Cancel' }],
  accepted: [{ next: 'preparing', label: 'Start preparing' }, { next: 'cancelled', label: 'Cancel' }],
  preparing: [{ next: 'ready_for_pickup', label: 'Ready for pickup' }, { next: 'cancelled', label: 'Cancel' }],
};

function money(value: number | undefined): string {
  return `₹${Number(value || 0).toFixed(0)}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
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
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
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
        await apiRequest(`${apiBase}/orders/${order._id}/status`, session.token, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus }),
        });
        await loadOrders();
      } catch (reason) {
        setError(messageFrom(reason));
      } finally {
        setBusyId('');
      }
    };

    if (nextStatus === 'cancelled') {
      Alert.alert('Cancel this order?', 'The customer will be notified.', [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: () => void confirm() },
      ]);
    } else {
      await confirm();
    }
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
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        image: form.image.trim(),
        price,
        quantity,
        dietary: form.dietary,
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
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest('/api/auth/logout', session.token, { method: 'POST' });
          } catch (reason) {
            Alert.alert('Could not revoke server session', messageFrom(reason));
          } finally {
            await onSignOut();
          }
        },
      },
    ]);
  }

  async function refresh() {
    setRefreshing(true);
    await loadAll();
  }

  const incomingCount = orders.filter((order) => order.status === 'placed').length;
  const activeCount = orders.filter((order) =>
    ['accepted', 'preparing', 'ready_for_pickup'].includes(order.status || ''),
  ).length;

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.brand}>🍅 Tomato</Text>
          <Text style={styles.role}>{kind} workspace</Text>
        </View>
        <Pressable onPress={() => void showNotifications()} style={styles.headerButton}>
          <Text style={styles.headerIcon}>♢</Text>
        </Pressable>
        <Pressable onPress={() => void refresh()} style={styles.headerButton}>
          <Text style={styles.headerIcon}>↻</Text>
        </Pressable>
        <ProfileAccess
          session={session}
          roleLabel={`${kind} partner`}
          items={[
            { key: 'orders', label: 'Orders', description: 'Accept and manage incoming orders', icon: '▤' },
            { key: 'catalog', label: isShop ? 'Inventory' : 'Menu', description: 'Manage products and availability', icon: '☷' },
            { key: 'coupons', label: 'Coupons & offers', description: 'Manage your promotions', icon: '％' },
            { key: 'finance', label: 'Finance', description: 'View transfers and earnings', icon: '₹' },
            { key: 'account', label: 'Business profile & bank', description: 'Edit business and payout details', icon: '⚙' },
          ]}
          onNavigate={(key) => setTab(key as PartnerTab)}
          onSignOut={signOut}
          onSessionUserUpdate={onSessionUserUpdate}
        />
      </View>
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
                <Text style={styles.muted}>{savingStatus ? 'Updating status…' : `${kind} is ${isOpen ? 'open' : 'closed'}`}</Text>
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
            <View style={styles.statsRow}>
              <StatCard label="New" value={incomingCount} tint="#fff0e5" />
              <StatCard label="In progress" value={activeCount} tint="#eaf2ff" />
              <StatCard label="All orders" value={orders.length} tint="#eff7ee" />
            </View>
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : orders.length ? (
              orders.map((order) => (
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
              <Empty title="No orders yet" detail="New customer orders will show up here." />
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
                    onChangeText={(value) => setForm((current) => ({ ...current, price: value }))}
                    placeholder="Price (₹)"
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
                <Pressable disabled={savingItem} onPress={() => void saveItem()} style={styles.primary}>
                  <Text style={styles.primaryText}>{savingItem ? 'Saving…' : editingId ? 'Save changes' : 'Add listing'}</Text>
                </Pressable>
                <Pressable onPress={() => setFormVisible(false)} style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            )}
            {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : items.length ? (
              items.map((item) => (
                <View key={item._id} style={styles.itemCard}>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    <Text style={styles.muted}>{item.category || (isShop ? 'Product' : 'Dish')} · {money(item.price)}</Text>
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
              ))
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
              <Text style={styles.accountRole}>{kind.toUpperCase()} PARTNER</Text>
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
  const itemNames = order.items?.map((item) => `${item.quantity || 1} × ${item.name}`).join('  ·  ');
  const address = order.deliveryAddress;
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.flex}>
          <Text style={styles.orderNumber}>#{order.orderNumber || order._id.slice(-6)}</Text>
          <Text style={styles.muted}>{order.customerName || 'Tomato customer'} · {order.createdAt ? new Date(order.createdAt).toLocaleString() : 'New order'}</Text>
        </View>
        <Text style={styles.orderTotal}>{money(order.totalAmount)}</Text>
      </View>
      <View style={styles.orderStatus}><Text style={styles.orderStatusText}>{status.replaceAll('_', ' ')}</Text></View>
      {!!itemNames && <Text style={styles.orderItems}>{itemNames}</Text>}
      <Text style={styles.orderDetail}>Payment: {(order.paymentMethod || 'cash').toUpperCase()} · {(order.paymentStatus || 'pending').toUpperCase()}</Text>
      {!!address?.line1 && (
        <Text style={styles.orderDetail}>
          Delivery: {address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city} {address.postalCode}
        </Text>
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
                action.next === 'cancelled' ? styles.cancelOrderAction : styles.primaryOrderAction,
              ]}
            >
              {busy ? <ActivityIndicator color={action.next === 'cancelled' ? '#b42318' : '#fff'} /> : (
                <Text style={action.next === 'cancelled' ? styles.cancelActionText : styles.primaryActionText}>{action.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {!actions.length && (
        <Text style={styles.muted}>This {isShop ? 'shop' : 'restaurant'} order is now with the delivery partner.</Text>
      )}
      {!!actions.length && !canManage && (
        <Text style={styles.pendingText}>Order actions are available after partner approval.</Text>
      )}
    </View>
  );
}

function StatCard({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={[styles.statCard, { backgroundColor: tint }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
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
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 13, padding: 12 },
  statValue: { color: '#302923', fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#71675f', fontSize: 10, marginTop: 3 },
  loader: { marginTop: 40 },
  orderCard: { backgroundColor: '#fff', borderColor: '#eee6df', borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 11 },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  orderNumber: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderTotal: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderStatus: { alignSelf: 'flex-start', backgroundColor: '#fff0e5', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, marginTop: 9 },
  orderStatusText: { color: '#9b541f', textTransform: 'capitalize', fontWeight: '800', fontSize: 10 },
  orderItems: { color: '#4e453e', fontSize: 12, lineHeight: 18, marginTop: 10 },
  orderDetail: { color: '#83796f', fontSize: 11, lineHeight: 17, marginTop: 7 },
  orderActions: { flexDirection: 'row', gap: 8, marginTop: 13 },
  orderAction: { flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  primaryOrderAction: { backgroundColor: '#d83a32' },
  cancelOrderAction: { backgroundColor: '#fff', borderColor: '#f1d3d0', borderWidth: 1 },
  primaryActionText: { color: '#fff', fontWeight: '800', fontSize: 12 },
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
