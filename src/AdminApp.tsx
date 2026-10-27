import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import AdminControlPanel from './AdminControlPanel';
import AdminOperations from './AdminOperations';
import type { AdminOperationSection } from './AdminOperations';
import { formatDigipin } from './digipin';
import GlobalHeader from './GlobalHeader';
import ProfileAccess from './ProfileAccess';
import { isOrderReturnAccepted } from './types';
import type { Order, Session, User } from './types';

type AdminTab = 'dashboard' | 'orders' | 'complaints' | 'accounts' | 'serviceArea' | 'team' | 'controlPanel'
  | AdminOperationSection;
type AccountFilter = 'restaurant' | 'shop' | 'deliveryPartner' | 'customer';
type AdminUser = User & {
  _id: string;
  role: string;
  isApproved?: boolean;
  isBlocked?: boolean;
};
type Complaint = {
  _id: string;
  ticketId?: string;
  userName?: string;
  userRole?: string;
  userEmail?: string;
  userPhone?: string;
  subject?: string;
  description?: string;
  category?: string;
  priority?: string;
  orderRef?: string;
  status?: string;
  adminComment?: string;
  adminResponse?: string;
  resolutionNote?: string;
  updatedAt?: string;
  createdAt?: string;
};
type Dashboard = {
  kpis?: Record<string, number>;
  recentOrders?: Order[];
  ordersByStatus?: Record<string, number>;
};
type AdminOrderResponse = {
  orders?: Order[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    currentDateLabel?: string;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
};
type StaffRole = {
  roleKey: string;
  displayName: string;
  baseRole: string;
  description?: string;
  permissions?: string[];
  assignedCount?: number;
  isSystem?: boolean;
};

const permissions = [
  ['dashboard_view', 'Dashboard'],
  ['orders_manage', 'Orders'],
  ['shops_manage', 'Shops'],
  ['restaurants_manage', 'Restaurants'],
  ['riders_manage', 'Riders'],
  ['customers_manage', 'Customers'],
  ['subadmins_manage', 'Staff'],
] as const;

const tabLabels: Record<AdminTab, string> = {
  dashboard: 'Overview',
  orders: 'Orders',
  complaints: 'Complaints',
  accounts: 'Accounts',
  serviceArea: 'Service area',
  team: 'Team & roles',
  controlPanel: 'Control panel',
  finance: 'Finance',
  bank: 'Bank',
  billing: 'Billing',
  coupons: 'Coupons',
  analytics: 'Analytics',
};

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function money(value: unknown): string {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminApp({
  session,
  onSignOut,
  onSessionUserUpdate,
}: {
  session: Session;
  onSignOut: () => Promise<void>;
  onSessionUserUpdate: (user: User) => Promise<void>;
}) {
  const role = session.user.role || '';
  const isSuperAdmin = role === 'superadmin';
  const isPlatformAdmin = role === 'admin' || isSuperAdmin || session.user.baseRole === 'admin';
  const userPermissions = session.user.permissions || [];
  const hasPermission = (permission: string) =>
    isPlatformAdmin || userPermissions.includes('*') || userPermissions.includes(permission);
  const accountRoleOptions = ([
    ['restaurant', 'Restaurants', hasPermission('restaurants_manage')],
    ['shop', 'Shops', hasPermission('shops_manage') || hasPermission('restaurants_manage')],
    ['deliveryPartner', 'Riders', hasPermission('riders_manage')],
    ['customer', 'Customers', hasPermission('customers_manage')],
  ] as const).filter(([, , allowed]) => allowed);
  const tabs = useMemo(() => {
    const available: AdminTab[] = [];
    if (hasPermission('dashboard_view')) available.push('dashboard');
    if (hasPermission('orders_manage')) available.push('orders');
    available.push('complaints');
    if (
      hasPermission('restaurants_manage')
      || hasPermission('shops_manage')
      || hasPermission('riders_manage')
      || hasPermission('customers_manage')
    ) available.push('accounts');
    if (isPlatformAdmin) available.push('serviceArea');
    if (hasPermission('subadmins_manage') || isPlatformAdmin) available.push('team');
    if (isPlatformAdmin || role === 'subadmin' || session.user.baseRole === 'subadmin') {
      available.push('controlPanel');
    }
    if (isPlatformAdmin) available.push('finance', 'bank', 'billing', 'coupons');
    if (hasPermission('dashboard_view')) available.push('analytics');
    return available;
  }, [role, session.user.baseRole, userPermissions.join(',')]);

  const [tab, setTab] = useState<AdminTab>(tabs[0] || 'dashboard');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [complaintStatus, setComplaintStatus] = useState('all');
  const [adminDraftComments, setAdminDraftComments] = useState<Record<string, string>>({});
  const [orderPage, setOrderPage] = useState(1);
  const [orderPages, setOrderPages] = useState(1);
  const [orderDateLabel, setOrderDateLabel] = useState('');
  const [orderStatus, setOrderStatus] = useState('all');
  const [orderArchive, setOrderArchive] = useState<'active' | 'archived' | 'all'>('active');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [accountRole, setAccountRole] = useState<AccountFilter>(accountRoleOptions[0]?.[0] || 'restaurant');
  const [accountPage, setAccountPage] = useState(1);
  const [accountPages, setAccountPages] = useState(1);
  const [accounts, setAccounts] = useState<AdminUser[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [pincodes, setPincodes] = useState<string[]>([]);
  const [newPincode, setNewPincode] = useState('');
  const [staff, setStaff] = useState<AdminUser[]>([]);
  const [staffRoles, setStaffRoles] = useState<StaffRole[]>([]);
  const [newStaff, setNewStaff] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    title: 'Operations Sub-Admin',
  });
  const [newStaffPermissions, setNewStaffPermissions] = useState<string[]>(['dashboard_view', 'orders_manage']);
  const [newRole, setNewRole] = useState({ displayName: '', roleKey: '', description: '' });
  const [newRolePermissions, setNewRolePermissions] = useState<string[]>(['dashboard_view']);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0] || 'dashboard');
  }, [tabs, tab]);

  useEffect(() => {
    if (!accountRoleOptions.some(([value]) => value === accountRole) && accountRoleOptions[0]) {
      setAccountRole(accountRoleOptions[0][0]);
    }
  }, [accountRole, accountRoleOptions.map(([value]) => value).join(',')]);

  async function loadDashboard() {
    const result = await apiRequest<Dashboard>('/api/admin/dashboard', session.token);
    setDashboard(result);
  }

  async function loadOrders(page = orderPage) {
    const query = new URLSearchParams({
      page: String(page),
      status: orderStatus,
      archived: orderArchive,
    });
    if (orderSearch.trim()) query.set('search', orderSearch.trim());
    const result = await apiRequest<AdminOrderResponse>(
      `/api/admin/orders?${query.toString()}`,
      session.token,
    );
    setOrders(result.orders || []);
    setOrderPage(result.pagination?.currentPage || 1);
    setOrderPages(result.pagination?.totalPages || 1);
    setOrderDateLabel(result.pagination?.currentDateLabel || '');
  }

  async function loadComplaints() {
    const result = await apiRequest<{ complaints?: Complaint[] }>(
      `/api/admin/complaints?status=${encodeURIComponent(complaintStatus)}`,
      session.token,
    );
    setComplaints(result.complaints || []);
  }

  async function loadAccounts(page = accountPage) {
    const query = new URLSearchParams({ role: accountRole, page: String(page), limit: '30' });
    if (accountSearch.trim()) query.set('search', accountSearch.trim());
    const result = await apiRequest<{ users?: AdminUser[]; pagination?: { currentPage: number; totalPages: number } }>(
      `/api/admin/users?${query.toString()}`,
      session.token,
    );
    setAccounts(result.users || []);
    setAccountPage(result.pagination?.currentPage || 1);
    setAccountPages(result.pagination?.totalPages || 1);
  }

  async function loadServiceArea() {
    const result = await apiRequest<{ pincodes?: string[] }>('/api/admin/serviceable-pincodes', session.token);
    setPincodes(result.pincodes || []);
  }

  async function loadTeam() {
    const requests: Promise<unknown>[] = [
      apiRequest<{ subadmins?: AdminUser[] }>('/api/admin/subadmins', session.token)
        .then((result) => setStaff(result.subadmins || [])),
    ];
    if (isPlatformAdmin) {
      requests.push(
        apiRequest<{ roles?: StaffRole[] }>('/api/admin/roles', session.token)
          .then((result) => setStaffRoles(result.roles || [])),
      );
    }
    await Promise.all(requests);
  }

  async function loadCurrentTab() {
    setLoading(true);
    setError('');
    try {
      if (tab === 'dashboard') await loadDashboard();
      if (tab === 'orders') await loadOrders();
      if (tab === 'complaints') await loadComplaints();
      if (tab === 'accounts') await loadAccounts();
      if (tab === 'serviceArea') await loadServiceArea();
      if (tab === 'team') await loadTeam();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadCurrentTab();
  }, [session.token, tab, orderPage, orderStatus, orderArchive, orderSearch, accountRole, accountPage, complaintStatus]);

  async function refresh() {
    setRefreshing(true);
    await loadCurrentTab();
  }

  async function runAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusyId('');
    }
  }

  function confirmAction(title: string, description: string, actionLabel: string, action: () => Promise<void>) {
    Alert.alert(title, description, [
      { text: 'Cancel', style: 'cancel' },
      { text: actionLabel, style: 'destructive', onPress: () => void runAction(actionLabel, action) },
    ]);
  }

  async function updateComplaint(complaint: Complaint, nextStatus: string) {
    const draft = (adminDraftComments[complaint._id] ?? '').trim();
    await runAction(complaint._id, async () => {
      const payload: { status?: string; adminComment?: string } = {};
      if (nextStatus) payload.status = nextStatus;
      if (draft) payload.adminComment = draft;

      const endpointId = encodeURIComponent(complaint.ticketId || complaint._id);
      await apiRequest(`/api/admin/complaints/${endpointId}`, session.token, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }).catch(async () => {
        await apiRequest(`/api/support/tickets/${endpointId}`, session.token, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }).catch(() => null);
      });

      setAdminDraftComments((current) => {
        const next = { ...current };
        delete next[complaint._id];
        return next;
      });
      await loadComplaints();
    });
  }

  async function moderateAccount(account: AdminUser, action: 'approve' | 'reject' | 'block' | 'unblock') {
    const path = action === 'approve' || action === 'reject'
      ? `/api/admin/users/${account._id}/${action}`
      : `/api/admin/users/${account._id}/${action}`;
    await apiRequest(path, session.token, { method: 'POST', body: JSON.stringify({}) });
    await loadAccounts();
  }

  async function addPincode() {
    const value = newPincode.trim();
    if (!/^\d{5,6}$/.test(value)) {
      setError('Enter a valid 5 or 6 digit pincode.');
      return;
    }
    await runAction('add-pincode', async () => {
      await apiRequest('/api/admin/serviceable-pincodes', session.token, {
        method: 'POST',
        body: JSON.stringify({ pincode: value }),
      });
      setNewPincode('');
      await loadServiceArea();
    });
  }

  async function createSubadmin() {
    if (!newStaff.name.trim() || (!newStaff.email.trim() && !newStaff.phone.trim()) || newStaff.password.length < 8) {
      setError('Enter a name, email or phone, and a password of at least 8 characters.');
      return;
    }
    await runAction('create-subadmin', async () => {
      await apiRequest('/api/admin/subadmins', session.token, {
        method: 'POST',
        body: JSON.stringify({
          name: newStaff.name.trim(),
          email: newStaff.email.trim(),
          phone: newStaff.phone.trim(),
          password: newStaff.password,
          adminRoleTitle: newStaff.title.trim(),
          permissions: newStaffPermissions,
        }),
      });
      setNewStaff({ name: '', email: '', phone: '', password: '', title: 'Operations Sub-Admin' });
      setNewStaffPermissions(['dashboard_view', 'orders_manage']);
      await loadTeam();
    });
  }

  async function createCustomRole() {
    if (!newRole.displayName.trim()) {
      setError('Enter a display name for the new role.');
      return;
    }
    await runAction('create-role', async () => {
      await apiRequest('/api/admin/roles', session.token, {
        method: 'POST',
        body: JSON.stringify({
          ...newRole,
          permissions: newRolePermissions,
          baseRole: 'subadmin',
        }),
      });
      setNewRole({ displayName: '', roleKey: '', description: '' });
      await loadTeam();
    });
  }

  async function assignStaffRole(member: AdminUser, staffRole: StaffRole) {
    await runAction(`role-${member._id}`, async () => {
      await apiRequest(`/api/admin/admins/${member._id}/role`, session.token, {
        method: 'PUT',
        body: JSON.stringify({
          role: staffRole.roleKey,
          adminRoleTitle: staffRole.displayName,
          permissions: staffRole.permissions || [],
        }),
      });
      await loadTeam();
    });
  }

  async function bulkArchiveOrders() {
    if (!selectedOrderIds.length) return;
    await runAction('bulk-archive', async () => {
      await apiRequest('/api/admin/orders/bulk-archive', session.token, {
        method: 'POST',
        body: JSON.stringify({
          orderIds: selectedOrderIds,
          isArchived: orderArchive !== 'archived',
        }),
      });
      setSelectedOrderIds([]);
      await loadOrders();
    });
  }

  function bulkDeleteOrders() {
    if (!selectedOrderIds.length) return;
    confirmAction(
      'Permanently delete selected orders?',
      `This will permanently remove ${selectedOrderIds.length} order(s). This action cannot be undone.`,
      'Delete orders',
      async () => {
        await apiRequest('/api/admin/orders/bulk-delete', session.token, {
          method: 'POST',
          body: JSON.stringify({ orderIds: selectedOrderIds }),
        });
        setSelectedOrderIds([]);
        await loadOrders();
      },
    );
  }

  const assignableRoles = staffRoles.filter(
    (staffRole) => !['admin', 'superadmin'].includes(staffRole.baseRole)
      && !['admin', 'superadmin'].includes(staffRole.roleKey),
  );

  const activeSearch = tab === 'accounts' ? accountSearch : orderSearch;
  const handleSearchChange = (text: string) => {
    if (tab === 'accounts') {
      setAccountSearch(text);
    } else {
      setOrderSearch(text);
      if (tab !== 'orders') setTab('orders');
    }
  };

  return (
    <View style={styles.root}>
      <GlobalHeader
        session={session}
        onBrandPress={() => setTab('dashboard')}
        searchQuery={activeSearch}
        onSearchChange={handleSearchChange}
        searchPlaceholder={tab === 'accounts' ? 'Search accounts, emails, roles…' : 'Search orders, customers, stores…'}
        city={session.user.city || 'New Delhi'}
        pincode={pincodes[0] || session.user.pincode || '110001'}
        onNotificationPress={() => setTab('complaints')}
        hasUnreadNotifications={complaints.some((c) => (c.status || '').toLowerCase() === 'open')}
        roleLabel={session.user.adminRoleTitle || label(role)}
        profileMenuItems={tabs.map((item) => ({
          key: item,
          label: tabLabels[item],
          description: item === 'controlPanel'
            ? 'Staff, permissions and platform controls'
            : `Open ${tabLabels[item].toLowerCase()} workspace`,
          icon: item === 'orders' ? '▤' : item === 'complaints' ? '？' : item === 'team' ? '♙' : '◦',
        }))}
        onNavigateProfile={(key) => setTab(key as AdminTab)}
        onSignOut={() => void onSignOut()}
        onSessionUserUpdate={onSessionUserUpdate}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {tabs.map((item) => (
          <Pressable
            key={item}
            onPress={() => setTab(item)}
            style={[styles.tab, tab === item && styles.tabSelected]}
          >
            <Text style={[styles.tabText, tab === item && styles.tabTextSelected]}>{tabLabels[item]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#d83a32" />}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && <Text style={styles.error}>{error}</Text>}
        {loading ? (
          <ActivityIndicator size="large" color="#d83a32" style={styles.loader} />
        ) : (
          <>
            {tab === 'dashboard' && (
              <View>
                <Text style={styles.sectionTitle}>Platform overview</Text>
                {dashboard?.kpis ? (
                  <View style={styles.grid}>
                    {[
                      ['Total orders', dashboard.kpis.totalOrders],
                      ['Active orders', dashboard.kpis.activeOrders],
                      ['Delivered', dashboard.kpis.deliveredOrders],
                      ['Customers', dashboard.kpis.totalCustomers],
                      ['Restaurants', dashboard.kpis.totalRestaurants],
                      ['Pending restaurants', dashboard.kpis.pendingRestaurants],
                      ['Shops', dashboard.kpis.totalShops],
                      ['Pending shops', dashboard.kpis.pendingShops],
                      ['Riders', dashboard.kpis.totalRiders],
                      ['Pending riders', dashboard.kpis.pendingRiders],
                      ['Total revenue', money(dashboard.kpis.totalRevenue)],
                      ['Today revenue', money(dashboard.kpis.todayRevenue)],
                    ].map(([title, value]) => (
                      <View key={String(title)} style={styles.metric}>
                        <Text style={styles.metricValue}>{value ?? 0}</Text>
                        <Text style={styles.metricLabel}>{title}</Text>
                      </View>
                    ))}
                  </View>
                ) : <Text style={styles.muted}>Dashboard metrics are unavailable for this account.</Text>}
                <Text style={styles.sectionTitle}>Recent orders</Text>
                {(dashboard?.recentOrders || []).slice(0, 8).map((order) => (
                  <OrderCard key={order._id} order={order} />
                ))}
              </View>
            )}
            {tab === 'controlPanel' && (
              <AdminControlPanel
                session={session}
                isSuperAdmin={isSuperAdmin}
                canManageProxy={isPlatformAdmin}
              />
            )}
            {(tab === 'finance' || tab === 'bank' || tab === 'billing' || tab === 'coupons' || tab === 'analytics') && (
              <AdminOperations
                session={session}
                section={tab}
                canManage={isPlatformAdmin}
                canTransfer={role === 'admin'}
              />
            )}
            {tab === 'complaints' && (
              <View>
                <Text style={styles.sectionTitle}>Complaints and support tickets</Text>
                <View style={styles.chips}>
                  {['all', 'Open', 'In Review', 'Resolved', 'Closed'].map((status) => (
                    <Chip key={status} title={status} selected={complaintStatus === status} onPress={() => setComplaintStatus(status)} />
                  ))}
                </View>
                {complaints.length ? complaints.map((complaint) => {
                  const normalizedStatus = (complaint.status || 'Open').toLowerCase();
                  const isClosed = ['resolved', 'closed'].includes(normalizedStatus);
                  const isBusy = busyId === complaint._id;
                  const draftComment = adminDraftComments[complaint._id] ?? '';
                  const hasAdminNote = Boolean(complaint.adminComment || complaint.adminResponse || complaint.resolutionNote);

                  return (
                    <View key={complaint._id} style={styles.card}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.cardTitle, { flex: 1, marginRight: 8 }]}>
                          {complaint.ticketId || 'Ticket'} · {complaint.subject || 'Support request'}
                        </Text>
                        <View style={[
                          styles.ticketBadge,
                          normalizedStatus === 'open' && styles.ticketBadgeOpen,
                          normalizedStatus === 'in review' && styles.ticketBadgeReview,
                          normalizedStatus === 'resolved' && styles.ticketBadgeResolved,
                          normalizedStatus === 'closed' && styles.ticketBadgeClosed,
                        ]}>
                          <Text style={[
                            styles.ticketBadgeText,
                            normalizedStatus === 'open' && styles.ticketBadgeTextOpen,
                            normalizedStatus === 'in review' && styles.ticketBadgeTextReview,
                            normalizedStatus === 'resolved' && styles.ticketBadgeTextResolved,
                            normalizedStatus === 'closed' && styles.ticketBadgeTextClosed,
                          ]}>
                            {complaint.status || 'Open'}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.muted}>
                        {complaint.userName || 'Customer'} · {label(complaint.userRole || 'customer')} · Priority: {complaint.priority || 'Normal'}
                        {complaint.createdAt ? ` · ${new Date(complaint.createdAt).toLocaleDateString()}` : ''}
                      </Text>

                      {!!complaint.orderRef && (
                        <Text style={[styles.muted, { fontWeight: '700' }]}>Order: {complaint.orderRef}</Text>
                      )}

                      <Text style={[styles.muted, { color: '#302923', marginTop: 4, marginBottom: 6 }]}>
                        {complaint.description || complaint.category || 'No description provided.'}
                      </Text>

                      {hasAdminNote && (
                        <View style={styles.adminExistingUpdateBox}>
                          <Text style={styles.adminExistingUpdateTitle}>Previous Admin / Support Note:</Text>
                          <Text style={styles.adminExistingUpdateText}>
                            {complaint.adminComment || complaint.adminResponse || complaint.resolutionNote}
                          </Text>
                        </View>
                      )}

                      <TextInput
                        placeholder="Write update or resolution comment for customer..."
                        placeholderTextColor="#9ca3af"
                        value={draftComment}
                        onChangeText={(text) => setAdminDraftComments((prev) => ({ ...prev, [complaint._id]: text }))}
                        style={[styles.input, { minHeight: 40, marginTop: 6, marginBottom: 6 }]}
                        multiline
                      />

                      <View style={styles.chips}>
                        {draftComment.trim().length > 0 && (
                          <Pressable
                            disabled={isBusy}
                            style={[styles.primaryButton, { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#2563eb' }]}
                            onPress={() => void updateComplaint(complaint, complaint.status || 'In Review')}
                          >
                            <Text style={styles.primaryButtonText}>Send Update</Text>
                          </Pressable>
                        )}

                        {normalizedStatus !== 'in review' && !isClosed && (
                          <Pressable
                            disabled={isBusy}
                            style={[styles.secondaryButton, { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12 }]}
                            onPress={() => void updateComplaint(complaint, 'In Review')}
                          >
                            <Text style={styles.secondaryButtonText}>Mark In Review</Text>
                          </Pressable>
                        )}

                        {normalizedStatus !== 'resolved' && (
                          <Pressable
                            disabled={isBusy}
                            style={[styles.primaryButton, { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#166534' }]}
                            onPress={() => void updateComplaint(complaint, 'Resolved')}
                          >
                            <Text style={styles.primaryButtonText}>Resolve</Text>
                          </Pressable>
                        )}

                        {normalizedStatus !== 'closed' && (
                          <Pressable
                            disabled={isBusy}
                            style={[styles.secondaryButton, { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#f3f4f6' }]}
                            onPress={() => void updateComplaint(complaint, 'Closed')}
                          >
                            <Text style={[styles.secondaryButtonText, { color: '#374151' }]}>Close</Text>
                          </Pressable>
                        )}

                        {isClosed && (
                          <Pressable
                            disabled={isBusy}
                            style={[styles.secondaryButton, { minHeight: 34, paddingVertical: 6, paddingHorizontal: 12 }]}
                            onPress={() => void updateComplaint(complaint, 'Open')}
                          >
                            <Text style={styles.secondaryButtonText}>Reopen</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                }) : <Text style={styles.muted}>No complaints in this status.</Text>}
              </View>
            )}
            {tab === 'orders' && (
              <View>
                <Text style={styles.sectionTitle}>Platform orders</Text>
                <View style={styles.chips}>
                  {['all', 'placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled'].map((status) => (
                    <Chip key={status} title={label(status)} selected={orderStatus === status} onPress={() => {
                      setOrderPage(1);
                      setOrderStatus(status);
                    }} />
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    value={orderSearch}
                    onChangeText={setOrderSearch}
                    placeholder="Search order, customer or partner"
                    style={[styles.input, styles.searchInput]}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      setOrderPage(1);
                      void loadOrders(1);
                    }}
                  />
                  <Pressable style={styles.primaryButton} onPress={() => {
                    setOrderPage(1);
                    void loadOrders(1);
                  }}>
                    <Text style={styles.primaryButtonText}>Search</Text>
                  </Pressable>
                </View>
                <View style={styles.chips}>
                  {([
                    ['active', 'Active'],
                    ['archived', 'Archived'],
                    ['all', 'All'],
                  ] as const).map(([value, title]) => (
                    <Chip key={value} title={title} selected={orderArchive === value} onPress={() => {
                      setOrderPage(1);
                      setOrderArchive(value);
                    }} />
                  ))}
                </View>
                {!!orderDateLabel && <Text style={styles.muted}>{orderDateLabel} · Page {orderPage} of {orderPages}</Text>}
                {!!selectedOrderIds.length && (
                  <View style={styles.row}>
                    <Text style={styles.muted}>{selectedOrderIds.length} selected</Text>
                    <Pressable disabled={busyId === 'bulk-archive'} style={styles.secondaryButton} onPress={() => void bulkArchiveOrders()}>
                      <Text style={styles.secondaryButtonText}>{orderArchive === 'archived' ? 'Restore selected' : 'Archive selected'}</Text>
                    </Pressable>
                    <Pressable style={styles.dangerButton} onPress={bulkDeleteOrders}>
                      <Text style={styles.dangerButtonText}>Delete selected</Text>
                    </Pressable>
                  </View>
                )}
                {orders.length ? orders.map((order) => {
                  const normalizedStatus = (order.status || '').toLowerCase();
                  const isCancelled = normalizedStatus === 'cancelled';
                  const returnAccepted = isOrderReturnAccepted(order);
                  const isCancellableByAdmin = !['delivered', 'cancelled', 'returned'].includes(normalizedStatus);
                  return (
                    <OrderCard
                      key={order._id}
                      order={order}
                      action={(
                        <View style={styles.row}>
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => setSelectedOrderIds((selected) =>
                              selected.includes(order._id)
                                ? selected.filter((id) => id !== order._id)
                                : [...selected, order._id],
                            )}
                          >
                            <Text style={styles.secondaryButtonText}>{selectedOrderIds.includes(order._id) ? 'Selected' : 'Select'}</Text>
                          </Pressable>
                          {isCancellableByAdmin && (
                            <Pressable
                              disabled={busyId === order._id}
                              style={[styles.dangerButton, busyId === order._id && styles.disabled]}
                              onPress={() => confirmAction(
                                'Cancel this order?',
                                'As an Administrator, you can cancel this order. The customer and partner will be notified, and tracking will transition to return-to-source mode.',
                                'Cancel Order',
                                async () => {
                                  setBusyId(order._id);
                                  try {
                                    await apiRequest(`/api/admin/orders/${order._id}/status`, session.token, {
                                      method: 'PUT',
                                      body: JSON.stringify({ status: 'cancelled' }),
                                    }).catch(async () => {
                                      await apiRequest(`/api/admin/orders/${order._id}/cancel`, session.token, {
                                        method: 'POST',
                                      }).catch(() => null);
                                    });
                                    await loadOrders();
                                  } finally {
                                    setBusyId('');
                                  }
                                },
                              )}
                            >
                              <Text style={styles.dangerButtonText}>Cancel</Text>
                            </Pressable>
                          )}
                          {isCancelled && !returnAccepted && (
                            <Pressable
                              disabled={busyId === order._id}
                              style={[styles.primaryButton, { backgroundColor: '#166534', minHeight: 38, paddingVertical: 8 }]}
                              onPress={() => confirmAction(
                                'Accept returned order?',
                                'Confirm that the returned goods have been received and accepted by the source (Admin). This will conclude live tracking.',
                                'Accept Return',
                                async () => {
                                  setBusyId(order._id);
                                  try {
                                    await apiRequest(`/api/admin/orders/${order._id}/status`, session.token, {
                                      method: 'PUT',
                                      body: JSON.stringify({
                                        status: 'returned',
                                        returnStatus: 'accepted',
                                        returnAccepted: true,
                                        returnAcceptedBy: 'admin',
                                      }),
                                    }).catch(async () => {
                                      await apiRequest(`/api/admin/orders/${order._id}/return-accept`, session.token, {
                                        method: 'POST',
                                      }).catch(() => null);
                                    });
                                    await loadOrders();
                                  } finally {
                                    setBusyId('');
                                  }
                                },
                              )}
                            >
                              <Text style={styles.primaryButtonText}>Accept Return</Text>
                            </Pressable>
                          )}
                          <Pressable
                            disabled={busyId === order._id}
                            style={styles.secondaryButton}
                            onPress={() => confirmAction(
                              order.isArchived ? 'Restore this order?' : 'Archive this order?',
                              'This changes the order archive state on the platform.',
                              order.isArchived ? 'Restore' : 'Archive',
                              async () => {
                                await apiRequest(`/api/admin/orders/${order._id}/archive`, session.token, {
                                  method: 'PUT',
                                  body: JSON.stringify({ isArchived: !order.isArchived }),
                                });
                                await loadOrders();
                              },
                            )}
                          >
                            <Text style={styles.secondaryButtonText}>{order.isArchived ? 'Restore' : 'Archive'}</Text>
                          </Pressable>
                        </View>
                      )}
                    />
                  );
                }) : <Text style={styles.muted}>No orders on this date.</Text>}
                <View style={styles.row}>
                  <Pressable disabled={orderPage <= 1} style={[styles.secondaryButton, orderPage <= 1 && styles.disabled]} onPress={() => setOrderPage((page) => Math.max(1, page - 1))}>
                    <Text style={styles.secondaryButtonText}>Previous day</Text>
                  </Pressable>
                  <Pressable disabled={orderPage >= orderPages} style={[styles.secondaryButton, orderPage >= orderPages && styles.disabled]} onPress={() => setOrderPage((page) => Math.min(orderPages, page + 1))}>
                    <Text style={styles.secondaryButtonText}>Next day</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {tab === 'accounts' && (
              <View>
                <Text style={styles.sectionTitle}>Customer and partner accounts</Text>
                <View style={styles.chips}>
                  {accountRoleOptions.map(([value, title]) => (
                    <Chip key={value} title={title} selected={accountRole === value} onPress={() => {
                      setAccountPage(1);
                      setAccountRole(value);
                    }} />
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    value={accountSearch}
                    onChangeText={setAccountSearch}
                    placeholder="Search name, email, phone or ID"
                    style={[styles.input, styles.searchInput]}
                    returnKeyType="search"
                    onSubmitEditing={() => {
                      setAccountPage(1);
                      void loadAccounts(1);
                    }}
                  />
                  <Pressable style={styles.primaryButton} onPress={() => {
                    setAccountPage(1);
                    void loadAccounts(1);
                  }}>
                    <Text style={styles.primaryButtonText}>Search</Text>
                  </Pressable>
                </View>
                {accounts.length ? accounts.map((account) => (
                  <View key={account._id} style={styles.card}>
                    <Text style={styles.cardTitle}>{account.name || account.displayName || 'Unnamed account'}</Text>
                    <Text style={styles.muted}>{account.email || account.phone || account._id}</Text>
                    <Text style={styles.muted}>
                      {label(account.role)} · {account.isApproved === false ? 'Pending approval' : 'Approved'} · {account.isBlocked ? 'Blocked' : 'Active'}
                    </Text>
                    {Boolean((account as any).digipin) && (
                      <Text style={[styles.muted, { color: '#0969da', fontWeight: '600' }]}>
                        ⌖ DIGIPIN: {formatDigipin((account as any).digipin)}
                      </Text>
                    )}
                    <View style={styles.chips}>
                      {account.isApproved === false && (
                        <>
                          <Pressable style={styles.primaryButton} onPress={() => confirmAction(
                            'Approve this account?',
                            'Partner approval requires verified bank and PAN details and, for stores, a serviceable pincode.',
                            'Approve',
                            () => moderateAccount(account, 'approve'),
                          )}><Text style={styles.primaryButtonText}>Approve</Text></Pressable>
                          <Pressable style={styles.secondaryButton} onPress={() => confirmAction(
                            'Reject this account?',
                            'This will revoke the account approval.',
                            'Reject',
                            () => moderateAccount(account, 'reject'),
                          )}><Text style={styles.secondaryButtonText}>Reject</Text></Pressable>
                        </>
                      )}
                      <Pressable style={styles.secondaryButton} onPress={() => confirmAction(
                        account.isBlocked ? 'Unblock this account?' : 'Block this account?',
                        'The user will be notified of the account access change.',
                        account.isBlocked ? 'Unblock' : 'Block',
                        () => moderateAccount(account, account.isBlocked ? 'unblock' : 'block'),
                      )}><Text style={styles.secondaryButtonText}>{account.isBlocked ? 'Unblock' : 'Block'}</Text></Pressable>
                    </View>
                  </View>
                )) : <Text style={styles.muted}>No matching accounts found.</Text>}
                <View style={styles.row}>
                  <Pressable disabled={accountPage <= 1} style={[styles.secondaryButton, accountPage <= 1 && styles.disabled]} onPress={() => setAccountPage((page) => Math.max(1, page - 1))}>
                    <Text style={styles.secondaryButtonText}>Previous</Text>
                  </Pressable>
                  <Text style={styles.muted}>Page {accountPage} of {accountPages}</Text>
                  <Pressable disabled={accountPage >= accountPages} style={[styles.secondaryButton, accountPage >= accountPages && styles.disabled]} onPress={() => setAccountPage((page) => Math.min(accountPages, page + 1))}>
                    <Text style={styles.secondaryButtonText}>Next</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {tab === 'serviceArea' && (
              <View>
                <Text style={styles.sectionTitle}>Serviceable pincodes</Text>
                <Text style={styles.muted}>Removing a pincode may automatically unapprove restaurants and shops in that area.</Text>
                <View style={styles.row}>
                  <TextInput
                    value={newPincode}
                    onChangeText={setNewPincode}
                    placeholder="5 or 6 digit pincode"
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.input, styles.searchInput]}
                  />
                  <Pressable style={styles.primaryButton} disabled={busyId === 'add-pincode'} onPress={() => void addPincode()}>
                    <Text style={styles.primaryButtonText}>Add</Text>
                  </Pressable>
                </View>
                {pincodes.map((pincode) => (
                  <View key={pincode} style={[styles.card, styles.row, styles.spaceBetween]}>
                    <Text style={styles.cardTitle}>{pincode}</Text>
                    <Pressable style={styles.dangerButton} onPress={() => confirmAction(
                      `Remove ${pincode}?`,
                      'Partners in this pincode may be automatically marked unapproved.',
                      'Remove',
                      async () => {
                        await apiRequest(`/api/admin/serviceable-pincodes/${encodeURIComponent(pincode)}`, session.token, { method: 'DELETE' });
                        await loadServiceArea();
                      },
                    )}><Text style={styles.dangerButtonText}>Remove</Text></Pressable>
                  </View>
                ))}
                {!pincodes.length && <Text style={styles.muted}>No serviceable pincodes configured.</Text>}
              </View>
            )}
            {tab === 'team' && (
              <View>
                <Text style={styles.sectionTitle}>Administration team</Text>
                {(role === 'admin' || isSuperAdmin) && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Create a sub-admin</Text>
                    <TextInput style={styles.input} placeholder="Full name" value={newStaff.name} onChangeText={(name) => setNewStaff((current) => ({ ...current, name }))} />
                    <TextInput style={styles.input} placeholder="Email (optional)" autoCapitalize="none" keyboardType="email-address" value={newStaff.email} onChangeText={(email) => setNewStaff((current) => ({ ...current, email }))} />
                    <TextInput style={styles.input} placeholder="Phone (optional)" keyboardType="phone-pad" value={newStaff.phone} onChangeText={(phone) => setNewStaff((current) => ({ ...current, phone }))} />
                    <TextInput style={styles.input} placeholder="Temporary password (8+ characters)" secureTextEntry value={newStaff.password} onChangeText={(password) => setNewStaff((current) => ({ ...current, password }))} />
                    <TextInput style={styles.input} placeholder="Role title" value={newStaff.title} onChangeText={(title) => setNewStaff((current) => ({ ...current, title }))} />
                    <Text style={styles.fieldLabel}>Permissions</Text>
                    <View style={styles.chips}>
                      {permissions.map(([key, title]) => (
                        <Chip
                          key={key}
                          title={title}
                          selected={newStaffPermissions.includes(key)}
                          onPress={() => setNewStaffPermissions((current) =>
                            current.includes(key) ? current.filter((permission) => permission !== key) : [...current, key],
                          )}
                        />
                      ))}
                    </View>
                    <Pressable style={styles.primaryButton} disabled={busyId === 'create-subadmin'} onPress={() => void createSubadmin()}>
                      <Text style={styles.primaryButtonText}>Create sub-admin</Text>
                    </Pressable>
                  </View>
                )}
                {staff.map((member) => (
                  <View key={member._id} style={styles.card}>
                    <Text style={styles.cardTitle}>{member.name || 'Staff member'} · {member.adminRoleTitle || label(member.role)}</Text>
                    <Text style={styles.muted}>{member.email || member.phone || member._id}</Text>
                    <Text style={styles.muted}>Role: {label(member.role)} · {member.isBlocked ? 'Blocked' : 'Active'}</Text>
                    {Boolean((member as any).digipin) && (
                      <Text style={[styles.muted, { color: '#0969da', fontWeight: '600' }]}>
                        ⌖ DIGIPIN: {formatDigipin((member as any).digipin)}
                      </Text>
                    )}
                    <Text style={styles.muted}>Permissions: {(member.permissions || []).join(', ') || 'None'}</Text>
                    {isPlatformAdmin
                      && !['admin', 'superadmin'].includes(member.role)
                      && member._id !== (session.user._id || session.user.id)
                      && assignableRoles.length > 0 && (
                        <>
                          <Text style={styles.fieldLabel}>Assign role</Text>
                          <View style={styles.chips}>
                            {assignableRoles.map((staffRole) => (
                              <Pressable
                                key={staffRole.roleKey}
                                disabled={busyId === `role-${member._id}`}
                                style={styles.secondaryButton}
                                onPress={() => confirmAction(
                                  `Assign ${staffRole.displayName}?`,
                                  `This replaces ${member.name || 'this staff member'}'s current role and permissions.`,
                                  'Assign role',
                                  () => assignStaffRole(member, staffRole),
                                )}
                              >
                                <Text style={styles.secondaryButtonText}>{staffRole.displayName}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </>
                      )}
                  </View>
                ))}
                {!staff.length && <Text style={styles.muted}>No staff accounts found.</Text>}
                {isPlatformAdmin && (
                  <>
                    <Text style={styles.sectionTitle}>Custom roles</Text>
                    {isSuperAdmin && (
                      <View style={styles.card}>
                        <Text style={styles.cardTitle}>Create a delegated role</Text>
                        <TextInput style={styles.input} placeholder="Display name" value={newRole.displayName} onChangeText={(displayName) => setNewRole((current) => ({ ...current, displayName }))} />
                        <TextInput style={styles.input} placeholder="Role key (optional)" autoCapitalize="none" value={newRole.roleKey} onChangeText={(roleKey) => setNewRole((current) => ({ ...current, roleKey }))} />
                        <TextInput style={styles.input} placeholder="Description" value={newRole.description} onChangeText={(description) => setNewRole((current) => ({ ...current, description }))} />
                        <Text style={styles.fieldLabel}>Permissions</Text>
                        <View style={styles.chips}>
                          {permissions.map(([key, title]) => (
                            <Chip
                              key={key}
                              title={title}
                              selected={newRolePermissions.includes(key)}
                              onPress={() => setNewRolePermissions((current) =>
                                current.includes(key) ? current.filter((permission) => permission !== key) : [...current, key],
                              )}
                            />
                          ))}
                        </View>
                        <Pressable style={styles.primaryButton} disabled={busyId === 'create-role'} onPress={() => void createCustomRole()}>
                          <Text style={styles.primaryButtonText}>Create custom role</Text>
                        </Pressable>
                      </View>
                    )}
                    {staffRoles.map((staffRole) => (
                      <View key={staffRole.roleKey} style={styles.card}>
                        <Text style={styles.cardTitle}>{staffRole.displayName} · {staffRole.roleKey}</Text>
                        <Text style={styles.muted}>{staffRole.description || 'No description'} · {staffRole.assignedCount || 0} assigned</Text>
                        <Text style={styles.muted}>Base: {label(staffRole.baseRole)} · {staffRole.isSystem ? 'System role' : 'Custom role'}</Text>
                        <Text style={styles.muted}>Permissions: {(staffRole.permissions || []).join(', ') || 'None'}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function OrderCard({ order, action }: { order: Order; action?: React.ReactNode }) {
  const isCancelled = (order.status || '').toLowerCase() === 'cancelled';
  const returnAccepted = isOrderReturnAccepted(order);
  const itemNames = order.items?.map((item) => `${item.name}(${item.quantity || 1})`).join(', ');
  const pickupDigipin = order.pickupDigipin || order.restaurantDigipin || order.shopDigipin;
  const customerDigipin = order.deliveryAddress?.digipin;
  const customerCoords = order.deliveryAddress?.coordinates
    || (order.deliveryAddress as unknown as { location?: { coordinates?: number[] } })?.location?.coordinates;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>#{order.orderNumber || order._id.slice(-6).toUpperCase()} · {label(order.status || 'unknown')}</Text>
      <Text style={styles.muted}>{order.customerName || 'Customer'} · {order.customerPhone || 'No phone'}</Text>
      <Text style={styles.muted}>{order.restaurantName || order.shopName || 'Store'} · {money(order.totalAmount)}</Text>
      {!!pickupDigipin && (
        <Text style={[styles.muted, { color: '#0969da', fontWeight: '600' }]}>
          ⌖ Store Pickup DIGIPIN: {formatDigipin(pickupDigipin)}
        </Text>
      )}
      {customerDigipin ? (
        <Text style={[styles.muted, { color: '#0969da', fontWeight: '600' }]}>
          ⌖ Customer Drop DIGIPIN: {formatDigipin(customerDigipin)}
        </Text>
      ) : customerCoords && customerCoords.length === 2 ? (
        <Text style={[styles.muted, { color: '#166534', fontWeight: '600' }]}>
          📍 Customer Drop GPS: {customerCoords[1].toFixed(5)}, {customerCoords[0].toFixed(5)}
        </Text>
      ) : null}
      {!!itemNames && <Text style={[styles.muted, { fontWeight: '600' }]}>{itemNames}</Text>}
      {isCancelled && (
        <Text style={{ fontSize: 12, fontWeight: '700', color: returnAccepted ? '#166534' : '#c2410c', marginTop: 2, marginBottom: 4 }}>
          {returnAccepted
            ? `✅ Return accepted by ${order.returnAcceptedBy || 'source'}. Tracking ended.`
            : '📦 Cancelled · Return in transit to source (tracking active)'}
        </Text>
      )}
      {!!action && <View style={styles.actionRow}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fffaf5' },
  header: { paddingTop: 54, paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff' },
  headerText: { flex: 1, paddingRight: 12 },
  brand: { color: '#d83a32', fontSize: 23, fontWeight: '900' },
  subtitle: { color: '#6b625d', fontSize: 12, marginTop: 3 },
  signOut: { borderRadius: 10, backgroundColor: '#fff1ed', paddingHorizontal: 12, paddingVertical: 9 },
  signOutText: { color: '#c2352d', fontWeight: '700' },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  tab: { borderRadius: 18, borderWidth: 1, borderColor: '#eaded7', paddingHorizontal: 14, paddingVertical: 9 },
  tabSelected: { borderColor: '#d83a32', backgroundColor: '#d83a32' },
  tabText: { color: '#6b625d', fontSize: 13, fontWeight: '700' },
  tabTextSelected: { color: '#fff' },
  content: { padding: 16, paddingBottom: 36 },
  loader: { marginTop: 40 },
  sectionTitle: { color: '#282321', fontSize: 19, fontWeight: '800', marginTop: 10, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  metric: { width: '48%', flexGrow: 1, borderRadius: 14, padding: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e7e1' },
  metricValue: { color: '#d83a32', fontSize: 20, fontWeight: '900' },
  metricLabel: { color: '#6b625d', fontSize: 12, marginTop: 5 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#f0e7e1', marginBottom: 10 },
  cardTitle: { color: '#292421', fontSize: 15, fontWeight: '800', marginBottom: 5 },
  muted: { color: '#766d68', fontSize: 13, lineHeight: 19, marginVertical: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: '#eaded7', paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#fff' },
  chipSelected: { borderColor: '#d83a32', backgroundColor: '#fff1ed' },
  chipText: { color: '#6b625d', fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: '#c2352d' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 7 },
  spaceBetween: { justifyContent: 'space-between' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#eaded7', borderRadius: 10, paddingHorizontal: 12, marginVertical: 5, color: '#292421', backgroundColor: '#fff' },
  searchInput: { flex: 1 },
  primaryButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: '#d83a32', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9, marginVertical: 4 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  secondaryButton: { minHeight: 38, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff1ed', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 4 },
  secondaryButtonText: { color: '#c2352d', fontWeight: '800', fontSize: 12 },
  dangerButton: { minHeight: 38, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fae7e4', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  dangerButtonText: { color: '#a9241c', fontWeight: '800' },
  disabled: { opacity: 0.45 },
  error: { color: '#a9241c', backgroundColor: '#fae7e4', padding: 12, borderRadius: 10, marginBottom: 10 },
  fieldLabel: { color: '#463e39', fontSize: 13, fontWeight: '700', marginTop: 8 },
  actionRow: { alignItems: 'flex-start', marginTop: 5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  ticketBadgeOpen: { backgroundColor: '#fef3c7', borderColor: '#fde68a' },
  ticketBadgeReview: { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' },
  ticketBadgeResolved: { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' },
  ticketBadgeClosed: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  ticketBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  ticketBadgeTextOpen: { color: '#92400e' },
  ticketBadgeTextReview: { color: '#1e40af' },
  ticketBadgeTextResolved: { color: '#166534' },
  ticketBadgeTextClosed: { color: '#4b5563' },
  adminExistingUpdateBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, padding: 9, marginVertical: 6 },
  adminExistingUpdateTitle: { color: '#15803d', fontSize: 11, fontWeight: '800', marginBottom: 2 },
  adminExistingUpdateText: { color: '#14532d', fontSize: 12, lineHeight: 17 },
});
