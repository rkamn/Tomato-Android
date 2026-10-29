import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import type { Session } from './types';

export type AdminOperationSection = 'finance' | 'bank' | 'billing' | 'coupons' | 'analytics';
type RecordValue = Record<string, unknown>;
type Coupon = RecordValue & { _id?: string; id?: string; code?: string; title?: string; isActive?: boolean };

const titles: Record<AdminOperationSection, string> = {
  finance: 'Finance transfers',
  bank: 'Bank & settlements',
  billing: 'Partner billing',
  coupons: 'Platform coupons',
  analytics: 'Analytics',
};
const adminCouponTypes = [
  'restaurant_item_category',
  'category_occasion',
  'new_user',
  'festival',
  'specific_user',
  'settlement',
  'special_occasion',
  'shop',
  'grocery',
  'instant',
] as const;

function asRecord(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' ? value as RecordValue : {};
}

function asList(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && typeof entry === 'object') as RecordValue[] : [];
}

function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return fallback;
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function InfoLine({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{text(value)}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{text(value, '0')}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatStatusLabel(s: string): string {
  const map: Record<string, string> = {
    placed: 'Order Placed',
    accepted: 'Accepted by Store',
    preparing: 'In Preparation',
    ready_for_pickup: 'Ready for Pickup',
    out_for_delivery: 'Out for Delivery',
    in_transit: 'In Transit',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
  };
  return map[s.toLowerCase()] || s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getStatusColor(s: string): { bg: string; dot: string; text: string } {
  const lower = s.toLowerCase();
  if (lower.includes('deliver') || lower.includes('complete')) {
    return { bg: '#dcfce7', dot: '#16a34a', text: '#15803d' };
  }
  if (lower.includes('cancel') || lower.includes('reject')) {
    return { bg: '#fee2e2', dot: '#dc2626', text: '#b91c1c' };
  }
  if (lower.includes('prep') || lower.includes('cook') || lower.includes('accept')) {
    return { bg: '#dbeafe', dot: '#2563eb', text: '#1d4ed8' };
  }
  if (lower.includes('out') || lower.includes('transit') || lower.includes('ready')) {
    return { bg: '#fef3c7', dot: '#d97706', text: '#b45309' };
  }
  return { bg: '#f1f5f9', dot: '#64748b', text: '#475569' };
}

function parseStatusList(value: unknown): Array<{ status: string; count: number }> {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const obj = asRecord(item);
      return {
        status: String(obj.status || obj.name || obj.label || 'Unknown'),
        count: Number(obj.count || obj.total || obj.orders || 0),
      };
    }).filter((i) => i.count > 0);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([status, count]) => ({
      status,
      count: Number(count) || 0,
    })).filter((i) => i.count > 0);
  }
  return [];
}

function parsePaymentDist(value: unknown): {
  codAmount: number;
  codCount: number;
  onlineAmount: number;
  onlineCount: number;
} {
  const res = { codAmount: 0, codCount: 0, onlineAmount: 0, onlineCount: 0 };
  if (!value || typeof value !== 'object') return res;
  const obj = value as Record<string, unknown>;

  if (obj.codAmount !== undefined || obj.onlineAmount !== undefined) {
    res.codAmount = Number(obj.codAmount || 0);
    res.codCount = Number(obj.codCount || obj.codOrders || 0);
    res.onlineAmount = Number(obj.onlineAmount || 0);
    res.onlineCount = Number(obj.onlineCount || obj.onlineOrders || 0);
    return res;
  }

  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    const num = Number(v) || 0;
    if (key.includes('cod') || key.includes('cash')) {
      res.codAmount += num;
      res.codCount += 1;
    } else {
      res.onlineAmount += num;
      res.onlineCount += 1;
    }
  }
  return res;
}

function parseCodDetails(value: unknown): {
  collected: number;
  inTransit: number;
  total: number;
} {
  const res = { collected: 0, inTransit: 0, total: 0 };
  if (!value || typeof value !== 'object') return res;
  const obj = value as Record<string, unknown>;
  res.collected = Number(obj.collected || obj.settled || obj.cashCollected || 0);
  res.inTransit = Number(obj.inTransit || obj.pending || obj.riderCash || 0);
  res.total = Number(obj.total || res.collected + res.inTransit);
  return res;
}

function parseTopItems(value: unknown): Array<{ name: string; count: number; revenue?: number }> {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const obj = asRecord(item);
      return {
        name: String(obj.name || obj.title || obj.dish || 'Item'),
        count: Number(obj.count || obj.orders || obj.quantity || obj.units || 0),
        revenue: obj.revenue !== undefined || obj.amount !== undefined ? Number(obj.revenue ?? obj.amount) : undefined,
      };
    }).filter((i) => i.count > 0).slice(0, 5);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([name, count]) => ({
      name,
      count: Number(count) || 0,
    })).filter((i) => i.count > 0).slice(0, 5);
  }
  return [];
}

function parseTopStores(value: unknown): Array<{ name: string; orders: number; gmv?: number }> {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const obj = asRecord(item);
      return {
        name: String(obj.name || obj.restaurantName || obj.shopName || obj.storeName || 'Store'),
        orders: Number(obj.orders || obj.count || 0),
        gmv: obj.gmv !== undefined || obj.totalAmount !== undefined || obj.revenue !== undefined
          ? Number(obj.gmv ?? obj.totalAmount ?? obj.revenue)
          : undefined,
      };
    }).filter((i) => i.orders > 0 || (i.gmv !== undefined && i.gmv > 0)).slice(0, 5);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([name, val]) => ({
      name,
      orders: typeof val === 'number' ? val : Number(asRecord(val).orders || 0),
      gmv: typeof val === 'object' ? Number(asRecord(val).gmv || asRecord(val).totalAmount || 0) : undefined,
    })).filter((i) => i.orders > 0 || (i.gmv !== undefined && i.gmv > 0)).slice(0, 5);
  }
  return [];
}

function getPresetDates(preset: string): { startDate: string; endDate: string } {
  const today = new Date();
  const format = (d: Date) => d.toISOString().split('T')[0];
  const endDate = format(today);

  if (preset === 'today') {
    return { startDate: endDate, endDate };
  }
  if (preset === '7d') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { startDate: format(d), endDate };
  }
  if (preset === '30d') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { startDate: format(d), endDate };
  }
  return { startDate: '', endDate: '' };
}

function synthesizeAnalytics(
  apiRes: RecordValue,
  dashRes: RecordValue,
  ordersList: RecordValue[],
  range: { startDate: string; endDate: string },
  dashboardData?: RecordValue | null,
): RecordValue {
  const apiAnalytics = asRecord(apiRes.analytics || apiRes.data || apiRes.stats || apiRes.kpis || apiRes);
  const dashKpis = asRecord(dashRes.kpis || dashboardData?.kpis);
  const dashStatus = asRecord(dashRes.ordersByStatus || dashboardData?.ordersByStatus);

  const filteredOrders = (range.startDate && range.endDate)
    ? ordersList.filter((o) => {
        const created = String(o.createdAt || o.date || '').split('T')[0];
        return created >= range.startDate && created <= range.endDate;
      })
    : ordersList;

  const orderCount = filteredOrders.length;
  const gmvTotal = filteredOrders.reduce((sum, o) => sum + (Number(o.totalAmount || o.amount) || 0), 0);
  const deliveredOrders = filteredOrders.filter((o) =>
    ['delivered', 'completed'].includes(String(o.status || '').toLowerCase()),
  );
  const activeOrders = filteredOrders.filter((o) =>
    ['placed', 'accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'in_transit'].includes(
      String(o.status || '').toLowerCase(),
    ),
  );
  const cancelledOrders = filteredOrders.filter((o) =>
    ['cancelled', 'rejected'].includes(String(o.status || '').toLowerCase()),
  );

  const statusMap: Record<string, number> = {};
  filteredOrders.forEach((o) => {
    const s = String(o.status || 'placed').toLowerCase();
    statusMap[s] = (statusMap[s] || 0) + 1;
  });

  const paymentDist = { codAmount: 0, codCount: 0, onlineAmount: 0, onlineCount: 0 };
  const topDishesMap: Record<string, { name: string; count: number; revenue: number }> = {};
  const topRestaurantsMap: Record<string, { name: string; orders: number; gmv: number }> = {};
  let codCollected = 0;
  let codInTransit = 0;

  filteredOrders.forEach((o) => {
    const amount = Number(o.totalAmount || o.amount) || 0;
    const isCod = o.paymentMethod === 'cod' || o.isCashOnDelivery || String(o.paymentType || '').toLowerCase() === 'cod';
    if (isCod) {
      paymentDist.codAmount += amount;
      paymentDist.codCount += 1;
      if (['delivered', 'completed'].includes(String(o.status || '').toLowerCase())) {
        codCollected += amount;
      } else if (['out_for_delivery', 'in_transit'].includes(String(o.status || '').toLowerCase())) {
        codInTransit += amount;
      }
    } else {
      paymentDist.onlineAmount += amount;
      paymentDist.onlineCount += 1;
    }

    const restName = String(o.restaurantName || o.shopName || o.storeName || 'Store');
    if (!topRestaurantsMap[restName]) {
      topRestaurantsMap[restName] = { name: restName, orders: 0, gmv: 0 };
    }
    topRestaurantsMap[restName].orders += 1;
    topRestaurantsMap[restName].gmv += amount;

    if (Array.isArray(o.items)) {
      o.items.forEach((item: any) => {
        const iName = String(item?.name || item?.title || item?.dish || 'Item');
        const iQty = Number(item?.quantity || item?.count || 1);
        const iPrice = Number(item?.price || 0) * iQty;
        if (!topDishesMap[iName]) {
          topDishesMap[iName] = { name: iName, count: 0, revenue: 0 };
        }
        topDishesMap[iName].count += iQty;
        topDishesMap[iName].revenue += iPrice;
      });
    }
  });

  const totalGMV = apiAnalytics.totalGMV
    ?? apiAnalytics.totalRevenue
    ?? dashKpis.totalRevenue
    ?? (gmvTotal > 0 ? gmvTotal : 0);

  const periodGMV = apiAnalytics.periodGMV
    ?? (range.startDate ? gmvTotal : (dashKpis.todayRevenue ?? apiAnalytics.todayRevenue ?? totalGMV));

  const lifetimeGMV = apiAnalytics.lifetimeGMV ?? totalGMV;

  const totalOrdersCount = apiAnalytics.totalOrdersCount
    ?? apiAnalytics.totalOrders
    ?? dashKpis.totalOrders
    ?? (orderCount > 0 ? orderCount : 0);

  const deliveredOrdersCount = apiAnalytics.deliveredOrdersCount
    ?? apiAnalytics.deliveredOrders
    ?? dashKpis.deliveredOrders
    ?? (deliveredOrders.length > 0 ? deliveredOrders.length : 0);

  const activeOrdersCount = apiAnalytics.activeOrdersCount
    ?? apiAnalytics.activeOrders
    ?? dashKpis.activeOrders
    ?? (activeOrders.length > 0 ? activeOrders.length : 0);

  const cancelledOrdersCount = apiAnalytics.cancelledOrdersCount
    ?? apiAnalytics.cancelledOrders
    ?? (cancelledOrders.length > 0 ? cancelledOrders.length : 0);

  const fulfillmentRate = apiAnalytics.fulfillmentRate
    ?? (Number(totalOrdersCount) > 0
      ? `${Math.round(((Number(deliveredOrdersCount) || 0) / Number(totalOrdersCount)) * 100)}%`
      : '100%');

  const avgOrderValue = apiAnalytics.avgOrderValue
    ?? (Number(totalOrdersCount) > 0 && Number(totalGMV) > 0
      ? Math.round(Number(totalGMV) / Number(totalOrdersCount))
      : 0);

  const totalUnitsSold = apiAnalytics.totalUnitsSold
    ?? (filteredOrders.reduce((sum, o) => sum + (Array.isArray(o.items) ? o.items.length : 1), 0));

  const ordersByStatus = apiAnalytics.ordersByStatus
    ?? (Object.keys(dashStatus).length > 0 ? dashStatus : statusMap);

  const paymentDistribution = apiAnalytics.paymentDistribution ?? paymentDist;

  const codDetails = apiAnalytics.codDetails ?? {
    collected: codCollected,
    inTransit: codInTransit,
    total: codCollected + codInTransit,
  };

  const topDishes = apiAnalytics.topDishes
    ?? Object.values(topDishesMap).sort((a, b) => b.count - a.count).slice(0, 5);

  const topRestaurants = apiAnalytics.topRestaurants
    ?? Object.values(topRestaurantsMap).sort((a, b) => b.gmv - a.gmv).slice(0, 5);

  return {
    analytics: {
      totalGMV,
      periodGMV,
      lifetimeGMV,
      totalOrdersCount,
      deliveredOrdersCount,
      activeOrdersCount,
      cancelledOrdersCount,
      fulfillmentRate,
      avgOrderValue,
      totalUnitsSold,
      ordersByStatus,
      paymentDistribution,
      codDetails,
      topDishes,
      topRestaurants,
    },
  };
}

export default function AdminOperations({
  session,
  section,
  canManage,
  canTransfer,
  dashboardData,
}: {
  session: Session;
  section: AdminOperationSection;
  canManage: boolean;
  canTransfer: boolean;
  dashboardData?: RecordValue | null;
}) {
  const [data, setData] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bankMode, setBankMode] = useState<'partners' | 'settlements'>('partners');
  const [editingCouponId, setEditingCouponId] = useState('');
  const [analyticsRange, setAnalyticsRange] = useState({ startDate: '', endDate: '' });
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [agreementDraft, setAgreementDraft] = useState({
    paymentId: '',
    riderPayoutAmount: '',
    agreementCommissionPercent: '',
    partnerPayoutAmount: '',
    adminNote: '',
  });
  const [form, setForm] = useState({
    recipientId: '',
    transferType: 'wallet',
    amount: '',
    purpose: '',
    orderNumber: '',
    code: '',
    title: '',
    description: '',
    couponType: 'festival',
    sponsorType: 'tomato',
    discountType: 'percentage',
    discountValue: '',
    minOrderAmount: '',
    maxDiscountAmount: '',
    targetItemCategory: '',
    occasionName: '',
    targetUserIdentifier: '',
    applicableStoreType: '',
    usageLimitPerUser: '',
    totalUsageLimit: '',
    validFrom: '',
    validUntil: '',
  });

  async function load(customRange?: { startDate: string; endDate: string }) {
    setLoading(true);
    setError('');
    const effectiveRange = customRange || analyticsRange;
    if (
      section === 'analytics'
      && Boolean(effectiveRange.startDate) !== Boolean(effectiveRange.endDate)
    ) {
      setError('Enter both analytics dates, or leave both blank for all-time analytics.');
      setLoading(false);
      return;
    }
    if (
      section === 'analytics'
      && effectiveRange.startDate
      && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveRange.startDate)
        || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveRange.endDate))
    ) {
      setError('Enter analytics dates in YYYY-MM-DD format.');
      setLoading(false);
      return;
    }
    try {
      let result: RecordValue;
      if (section === 'finance') {
        result = asRecord(await apiRequest<unknown>('/api/admin/finance/transfers?page=1&limit=50', session.token));
      } else if (section === 'bank') {
        const path = bankMode === 'partners' ? '/api/admin/bank/partners' : '/api/admin/bank/settlements';
        result = asRecord(await apiRequest<unknown>(path, session.token));
      } else if (section === 'billing') {
        result = asRecord(await apiRequest<unknown>('/api/admin/billing/partners?week=all', session.token));
      } else if (section === 'coupons') {
        result = asRecord(await apiRequest<unknown>('/api/admin/coupons', session.token));
      } else {
        const query = new URLSearchParams();
        if (effectiveRange.startDate && effectiveRange.endDate) {
          query.set('startDate', effectiveRange.startDate);
          query.set('endDate', effectiveRange.endDate);
        } else {
          query.set('allTime', 'true');
        }

        let analyticsRes: RecordValue = {};
        try {
          analyticsRes = asRecord(await apiRequest<unknown>(`/api/admin/analytics?${query.toString()}`, session.token));
        } catch {
          try {
            analyticsRes = asRecord(await apiRequest<unknown>('/api/admin/analytics', session.token));
          } catch {
            analyticsRes = {};
          }
        }

        let dashRes: RecordValue = {};
        let ordersList: RecordValue[] = [];
        try {
          const [dash, ord] = await Promise.all([
            apiRequest<{ kpis?: Record<string, number>; ordersByStatus?: Record<string, number> }>('/api/admin/dashboard', session.token).catch(() => null),
            apiRequest<{ orders?: Array<Record<string, unknown>> }>('/api/admin/orders?limit=100', session.token).catch(() => null),
          ]);
          if (dash) dashRes = asRecord(dash);
          if (ord?.orders) ordersList = asList(ord.orders);
        } catch {
          // Ignore secondary failures
        }

        result = synthesizeAnalytics(analyticsRes, dashRes, ordersList, effectiveRange, dashboardData);
      }
      setData(result);
    } catch (reason) {
      setError(errorMessage(reason));
      setData({});
    } finally {
      setLoading(false);
    }
  }

  function applyPresetPeriod(key: 'all' | 'today' | '7d' | '30d') {
    setSelectedPeriod(key);
    const range = getPresetDates(key);
    setAnalyticsRange(range);
    void load(range);
  }

  useEffect(() => {
    void load();
  }, [section, bankMode, session.token]);

  async function runAction(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError('');
    try {
      await action();
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy('');
    }
  }

  async function createTransfer() {
    const amount = Number(form.amount);
    if (!form.recipientId.trim() || !form.purpose.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter a recipient ID, positive amount, and transfer purpose.');
      return;
    }
    Alert.alert('Confirm transfer?', `${money(amount)} will be transferred to ${form.recipientId.trim()}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Transfer',
        onPress: () => void runAction('transfer', async () => {
          await apiRequest('/api/admin/finance/transfer', session.token, {
            method: 'POST',
            body: JSON.stringify({
              recipientId: form.recipientId.trim(),
              transferType: form.transferType,
              amount,
              purpose: form.purpose.trim(),
              ...(form.orderNumber.trim() ? { orderNumber: form.orderNumber.trim() } : {}),
            }),
          });
          setForm((current) => ({ ...current, recipientId: '', amount: '', purpose: '', orderNumber: '' }));
        }),
      },
    ]);
  }

  async function paySettlement(settlement: RecordValue, target: 'partner' | 'rider' | 'both') {
    const paymentId = text(settlement._id || settlement.paymentId, '');
    if (!paymentId) {
      setError('This settlement does not include a payment ID.');
      return;
    }
    Alert.alert('Confirm payout?', `Send ${target} payout for settlement ${paymentId}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pay',
        style: 'destructive',
        onPress: () => void runAction(`payout-${paymentId}`, async () => {
          await apiRequest(`/api/admin/bank/settlements/${encodeURIComponent(paymentId)}/payout`, session.token, {
            method: 'POST',
            body: JSON.stringify({ target }),
          });
        }),
      },
    ]);
  }

  async function updateSettlementAgreement() {
    const paymentId = agreementDraft.paymentId;
    const amountFields = {
      riderPayoutAmount: agreementDraft.riderPayoutAmount,
      agreementCommissionPercent: agreementDraft.agreementCommissionPercent,
      partnerPayoutAmount: agreementDraft.partnerPayoutAmount,
    };
    const body: RecordValue = { adminNote: agreementDraft.adminNote.trim() };
    for (const [key, value] of Object.entries(amountFields)) {
      if (value.trim()) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
          setError('Agreement amounts and commission must be non-negative numbers.');
          return;
        }
        body[key] = numeric;
      }
    }
    await runAction(`agreement-${paymentId}`, async () => {
      await apiRequest(`/api/admin/bank/settlements/${encodeURIComponent(paymentId)}/agreement`, session.token, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setAgreementDraft({ paymentId: '', riderPayoutAmount: '', agreementCommissionPercent: '', partnerPayoutAmount: '', adminNote: '' });
    });
  }

  async function approveBankPartner(partner: RecordValue) {
    const id = text(partner._id || partner.id || partner.userId, '');
    if (!id) {
      setError('This partner record does not include a user ID.');
      return;
    }
    Alert.alert('Approve bank details?', `Approve bank details for ${text(partner.name, 'this partner')}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: () => void runAction(`bank-${id}`, async () => {
          await apiRequest(`/api/admin/bank/partners/${encodeURIComponent(id)}`, session.token, {
            method: 'PUT',
            body: JSON.stringify({ approvePartner: true }),
          });
        }),
      },
    ]);
  }

  async function unlockBankPartner(partner: RecordValue) {
    const id = text(partner._id || partner.id || partner.userId, '');
    if (!id) {
      setError('This partner record does not include a user ID.');
      return;
    }
    Alert.alert('Unlock bank details?', 'The partner will be able to submit updated bank information.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlock',
        onPress: () => void runAction(`unlock-bank-${id}`, async () => {
          await apiRequest(`/api/admin/bank/partners/${encodeURIComponent(id)}`, session.token, {
            method: 'PUT',
            body: JSON.stringify({ unlockForUserEdit: true }),
          });
        }),
      },
    ]);
  }

  async function settlePartner(partner: RecordValue) {
    const nestedPartner = asRecord(partner.partner);
    const id = text(partner.partnerId || partner._id || partner.id || partner.userId || nestedPartner._id || nestedPartner.id, '');
    const rawRole = text(partner.role || partner.partnerType || partner.partnerRole || nestedPartner.role, '').toLowerCase();
    const role = rawRole.includes('shop')
      ? 'shop'
      : rawRole.includes('restaurant')
        ? 'restaurant'
        : rawRole.includes('delivery')
          ? 'deliveryPartner'
          : rawRole;
    if (!id || !['restaurant', 'shop', 'deliveryPartner'].includes(role)) {
      setError('Partner billing entry is missing a valid restaurant, shop or rider ID/role.');
      return;
    }
    Alert.alert('Settle partner billing?', `Settle pending billing for ${text(partner.name, role)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Settle',
        onPress: () => void runAction(`settle-${id}`, async () => {
          await apiRequest(`/api/admin/billing/partners/${role}/${encodeURIComponent(id)}/settle`, session.token, {
            method: 'POST',
          });
        }),
      },
    ]);
  }

  async function createCoupon() {
    const discountValue = Number(form.discountValue);
    if (!form.code.trim() || !form.title.trim() || !Number.isFinite(discountValue) || discountValue <= 0) {
      setError('Enter a coupon code, title and positive discount value.');
      return;
    }
    const optionalAmounts = [
      ['Minimum order amount', form.minOrderAmount],
      ['Maximum discount', form.maxDiscountAmount],
      ['Per-user usage limit', form.usageLimitPerUser],
      ['Total usage limit', form.totalUsageLimit],
    ] as const;
    for (const [label, rawValue] of optionalAmounts) {
      if (rawValue && (!Number.isFinite(Number(rawValue)) || Number(rawValue) < 0)) {
        setError(`${label} must be a non-negative number.`);
        return;
      }
    }
    if (
      [form.usageLimitPerUser, form.totalUsageLimit]
        .some((value) => value && !Number.isInteger(Number(value)))
    ) {
      setError('Coupon usage limits must be whole numbers.');
      return;
    }
    if (
      (form.validFrom && Number.isNaN(Date.parse(form.validFrom)))
      || (form.validUntil && Number.isNaN(Date.parse(form.validUntil)))
    ) {
      setError('Enter valid coupon dates in ISO date format.');
      return;
    }
    await runAction(editingCouponId || 'create-coupon', async () => {
      await apiRequest(
        editingCouponId
          ? `/api/admin/coupons/${encodeURIComponent(editingCouponId)}`
          : '/api/admin/coupons',
        session.token,
        {
        method: editingCouponId ? 'PUT' : 'POST',
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          title: form.title.trim(),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          couponType: form.couponType,
          sponsorType: form.sponsorType,
          discountType: form.discountType,
          discountValue,
          ...(form.minOrderAmount ? { minOrderAmount: Number(form.minOrderAmount) } : {}),
          ...(form.maxDiscountAmount ? { maxDiscountAmount: Number(form.maxDiscountAmount) } : {}),
          ...(form.targetItemCategory.trim() ? { targetItemCategory: form.targetItemCategory.trim() } : {}),
          ...(form.occasionName.trim() ? { occasionName: form.occasionName.trim() } : {}),
          ...(form.targetUserIdentifier.trim() ? { targetUserIdentifier: form.targetUserIdentifier.trim() } : {}),
          ...(form.applicableStoreType ? { applicableStoreType: form.applicableStoreType } : {}),
          ...(form.usageLimitPerUser ? { usageLimitPerUser: Number(form.usageLimitPerUser) } : {}),
          ...(form.totalUsageLimit ? { totalUsageLimit: Number(form.totalUsageLimit) } : {}),
          ...(form.validFrom ? { validFrom: form.validFrom } : {}),
          ...(form.validUntil ? { validUntil: form.validUntil } : {}),
          isActive: true,
        }),
        },
      );
      setEditingCouponId('');
      setForm((current) => ({ ...current, code: '', title: '', discountValue: '', minOrderAmount: '', maxDiscountAmount: '' }));
    });
  }

  function editCoupon(coupon: Coupon) {
    const id = text(coupon._id || coupon.id, '');
    if (!id) {
      setError('This coupon does not include an ID.');
      return;
    }
    setEditingCouponId(id);
    setForm((current) => ({
      ...current,
      code: text(coupon.code, ''),
      title: text(coupon.title, ''),
      description: text(coupon.description, ''),
      couponType: text(coupon.couponType, 'festival'),
      sponsorType: text(coupon.sponsorType, 'tomato'),
      discountType: text(coupon.discountType, 'percentage'),
      discountValue: text(coupon.discountValue, ''),
      minOrderAmount: text(coupon.minOrderAmount, ''),
      maxDiscountAmount: text(coupon.maxDiscountAmount, ''),
      targetItemCategory: text(coupon.targetItemCategory, ''),
      occasionName: text(coupon.occasionName, ''),
      targetUserIdentifier: text(coupon.targetUserIdentifier, ''),
      applicableStoreType: text(coupon.applicableStoreType, ''),
      usageLimitPerUser: text(coupon.usageLimitPerUser, ''),
      totalUsageLimit: text(coupon.totalUsageLimit, ''),
      validFrom: text(coupon.validFrom, ''),
      validUntil: text(coupon.validUntil, ''),
    }));
  }

  async function deleteCoupon(coupon: Coupon) {
    const id = text(coupon._id || coupon.id, '');
    if (!id) {
      setError('This coupon does not include an ID.');
      return;
    }
    Alert.alert('Delete coupon?', `Remove ${coupon.code || coupon.title || id}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void runAction(`coupon-${id}`, async () => {
          await apiRequest(`/api/admin/coupons/${encodeURIComponent(id)}`, session.token, { method: 'DELETE' });
        }),
      },
    ]);
  }

  async function toggleAdminCoupon(coupon: Coupon) {
    const id = text(coupon._id || coupon.id, '');
    if (!id) {
      setError('This coupon does not include an ID.');
      return;
    }
    await runAction(`coupon-${id}`, async () => {
      await apiRequest(`/api/admin/coupons/${encodeURIComponent(id)}`, session.token, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !coupon.isActive }),
      });
    });
  }

  const analytics = asRecord(data.analytics || data);
  const summary = asRecord(data.summary || data.counts);
  const transfers = asList(data.transfers || data.records);
  const partners = asList(data.partners || data.partnerDirectory);
  const settlements = asList(data.settlements);
  const coupons = asList(data.coupons) as Coupon[];
  const billingPartners = asList(data.billingList || data.partners || data.billingPartners || data.results);

  return (
    <View>
      <Text style={styles.eyebrow}>ADMIN OPERATIONS</Text>
      <Text style={styles.title}>{titles[section]}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : (
        <>
          {section === 'finance' && (
            <View>
              {canTransfer && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Create a transfer</Text>
                  <TextInput style={styles.input} placeholder="Recipient user ID" value={form.recipientId} onChangeText={(value) => setForm((current) => ({ ...current, recipientId: value }))} />
                  <TextInput style={styles.input} placeholder="Transfer type: wallet or credit_points" value={form.transferType} onChangeText={(value) => setForm((current) => ({ ...current, transferType: value }))} autoCapitalize="none" />
                  <TextInput style={styles.input} placeholder="Amount" keyboardType="decimal-pad" value={form.amount} onChangeText={(value) => setForm((current) => ({ ...current, amount: value }))} />
                  <TextInput style={styles.input} placeholder="Purpose" value={form.purpose} onChangeText={(value) => setForm((current) => ({ ...current, purpose: value }))} />
                  <TextInput style={styles.input} placeholder="Order number (optional)" value={form.orderNumber} onChangeText={(value) => setForm((current) => ({ ...current, orderNumber: value }))} />
                  <Pressable disabled={busy === 'transfer'} style={styles.primaryButton} onPress={() => void createTransfer()}>
                    <Text style={styles.primaryText}>{busy === 'transfer' ? 'Transferring…' : 'Create transfer'}</Text>
                  </Pressable>
                </View>
              )}
              <View style={styles.metrics}>
                {Object.entries(asRecord(data.summary)).slice(0, 4).map(([key, value]) => (
                  <Metric key={key} label={key.replaceAll('_', ' ')} value={typeof value === 'number' && key.toLowerCase().includes('balance') ? money(value) : value} />
                ))}
              </View>
              {transfers.map((entry, index) => (
                <View key={text(entry._id || entry.id, String(index))} style={styles.card}>
                  <Text style={styles.cardTitle}>{money(entry.amount)} · {text(entry.transferType || entry.type)}</Text>
                  <InfoLine label="Purpose" value={entry.purpose} />
                  <InfoLine label="Sender" value={`${text(entry.senderName)} · ${text(entry.senderRole)}`} />
                  <InfoLine label="Recipient" value={`${text(entry.receiverName)} · ${text(entry.receiverRole)}`} />
                  <InfoLine label="Status" value={entry.status} />
                  <InfoLine label="Date" value={entry.createdAt} />
                </View>
              ))}
              {!transfers.length && <Text style={styles.muted}>No finance transfers were returned.</Text>}
            </View>
          )}
          {section === 'bank' && (
            <View>
              <View style={styles.actions}>
                {(['partners', 'settlements'] as const).map((mode) => (
                  <Pressable key={mode} style={[styles.secondaryButton, bankMode === mode && styles.selectedButton]} onPress={() => setBankMode(mode)}>
                    <Text style={styles.secondaryText}>{mode === 'partners' ? 'Partners' : 'Settlements'}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.metrics}>
                {Object.entries(summary).slice(0, 4).map(([key, value]) => (
                  <Metric key={key} label={key.replaceAll('_', ' ')} value={value} />
                ))}
              </View>
              {bankMode === 'partners' ? partners.map((partner, index) => (
                <View key={text(partner.partnerId || partner._id || partner.id, String(index))} style={styles.card}>
                  <Text style={styles.cardTitle}>{text(partner.name, 'Partner')} · {text(partner.role)}</Text>
                  <InfoLine label="Email / phone" value={partner.email || partner.phone} />
                  <InfoLine label="Bank" value={asRecord(partner.bankDetails).bankName} />
                  <InfoLine label="Account holder" value={asRecord(partner.bankDetails).accountHolderName} />
                  <InfoLine label="IFSC" value={asRecord(partner.bankDetails).ifscCode} />
                  <InfoLine label="Approval" value={asRecord(partner.bankDetails).isApproved ?? partner.isApproved} />
                  {asRecord(partner.bankDetails).isApproved !== true && partner.isApproved !== true && (
                    <Pressable disabled={!!busy} style={styles.primaryButton} onPress={() => void approveBankPartner(partner)}>
                      <Text style={styles.primaryText}>Approve bank / partner</Text>
                    </Pressable>
                  )}
                  {canManage && asRecord(partner.bankDetails).isLocked === true && (
                    <Pressable disabled={!!busy} style={styles.secondaryButton} onPress={() => void unlockBankPartner(partner)}>
                      <Text style={styles.secondaryText}>Unlock user bank edits</Text>
                    </Pressable>
                  )}
                </View>
              )) : settlements.map((settlement, index) => (
                <View key={text(settlement._id || settlement.paymentId, String(index))} style={styles.card}>
                  <Text style={styles.cardTitle}>{text(settlement.orderNumber || settlement._id, 'Settlement')}</Text>
                  <InfoLine label="Partner" value={settlement.partnerName || settlement.recipientName} />
                  <InfoLine label="Type" value={settlement.orderType || settlement.partnerRole} />
                  <InfoLine label="Status" value={settlement.status} />
                  <InfoLine label="Partner payout" value={money(settlement.partnerPayoutAmount)} />
                  <InfoLine label="Rider payout" value={money(settlement.riderPayoutAmount)} />
                  {agreementDraft.paymentId === text(settlement._id || settlement.paymentId, '') ? (
                    <View>
                      <TextInput style={styles.input} placeholder="Rider payout amount" keyboardType="decimal-pad" value={agreementDraft.riderPayoutAmount} onChangeText={(value) => setAgreementDraft((current) => ({ ...current, riderPayoutAmount: value }))} />
                      <TextInput style={styles.input} placeholder="Commission percent" keyboardType="decimal-pad" value={agreementDraft.agreementCommissionPercent} onChangeText={(value) => setAgreementDraft((current) => ({ ...current, agreementCommissionPercent: value }))} />
                      <TextInput style={styles.input} placeholder="Partner payout amount" keyboardType="decimal-pad" value={agreementDraft.partnerPayoutAmount} onChangeText={(value) => setAgreementDraft((current) => ({ ...current, partnerPayoutAmount: value }))} />
                      <TextInput style={styles.input} placeholder="Admin note" value={agreementDraft.adminNote} onChangeText={(value) => setAgreementDraft((current) => ({ ...current, adminNote: value }))} />
                      <Pressable disabled={busy === `agreement-${agreementDraft.paymentId}`} style={styles.primaryButton} onPress={() => void updateSettlementAgreement()}>
                        <Text style={styles.primaryText}>Save agreement</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={styles.secondaryButton} onPress={() => setAgreementDraft({
                      paymentId: text(settlement._id || settlement.paymentId, ''),
                      riderPayoutAmount: String(settlement.riderPayoutAmount ?? ''),
                      agreementCommissionPercent: String(settlement.agreementCommissionPercent ?? ''),
                      partnerPayoutAmount: String(settlement.partnerPayoutAmount ?? ''),
                      adminNote: String(settlement.adminNote ?? ''),
                    })}>
                      <Text style={styles.secondaryText}>Edit agreement</Text>
                    </Pressable>
                  )}
                  <View style={styles.actions}>
                    {(['partner', 'rider', 'both'] as const).map((target) => (
                      <Pressable
                        key={target}
                        disabled={!!busy || ['paid', 'settled', 'completed'].includes(String(settlement.status || '').toLowerCase())}
                        style={styles.secondaryButton}
                        onPress={() => void paySettlement(settlement, target)}
                      >
                        <Text style={styles.secondaryText}>
                          {['paid', 'settled', 'completed'].includes(String(settlement.status || '').toLowerCase()) ? 'Paid' : `Pay ${target}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              {bankMode === 'partners' && !partners.length && <Text style={styles.muted}>No bank partners returned.</Text>}
              {bankMode === 'settlements' && !settlements.length && <Text style={styles.muted}>No settlements returned.</Text>}
            </View>
          )}
          {section === 'billing' && (
            <View>
              {billingPartners.map((partner, index) => (
                <View key={text(partner._id || partner.id, String(index))} style={styles.card}>
                  <Text style={styles.cardTitle}>{text(partner.name, 'Partner')} · {text(partner.partnerType)}</Text>
                  <InfoLine label="Week" value={partner.week || partner.weekLabel} />
                  <InfoLine label="Status" value={partner.status} />
                  <InfoLine label="Orders" value={partner.totalOrders} />
                  <InfoLine label="Gross volume" value={money(partner.grossVolume)} />
                  <InfoLine label="Total payable" value={money(partner.totalPayable)} />
                  <InfoLine label="Total paid" value={money(partner.totalPaid)} />
                  <InfoLine label="Pending balance" value={money(partner.totalPending)} />
                  <Pressable
                    disabled={!!busy || Number(partner.totalPending || 0) <= 0 || String(partner.payoutStatus || '').toLowerCase() === 'paid'}
                    style={styles.primaryButton}
                    onPress={() => void settlePartner(partner)}
                  >
                    <Text style={styles.primaryText}>
                      {busy === `settle-${text(partner.partnerId || partner._id || partner.id, '')}`
                        ? 'Settling…'
                        : Number(partner.totalPending || 0) <= 0 ? 'No pending balance' : 'Settle weekly balance'}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {!billingPartners.length && <Text style={styles.muted}>No billing partners were returned.</Text>}
            </View>
          )}
          {section === 'coupons' && (
            <View>
              {canManage && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{editingCouponId ? 'Edit platform coupon' : 'Create platform coupon'}</Text>
                  <TextInput style={styles.input} placeholder="Code" autoCapitalize="characters" value={form.code} onChangeText={(value) => setForm((current) => ({ ...current, code: value }))} />
                  <TextInput style={styles.input} placeholder="Title" value={form.title} onChangeText={(value) => setForm((current) => ({ ...current, title: value }))} />
                  <TextInput style={styles.input} placeholder="Description (optional)" value={form.description} onChangeText={(value) => setForm((current) => ({ ...current, description: value }))} />
                  <Text style={styles.fieldLabel}>Coupon type</Text>
                  <View style={styles.actions}>
                    {adminCouponTypes.map((value) => (
                      <Pressable key={value} style={[styles.secondaryButton, form.couponType === value && styles.selectedButton]} onPress={() => setForm((current) => ({ ...current, couponType: value }))}>
                        <Text style={styles.secondaryText}>{value.replaceAll('_', ' ')}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.fieldLabel}>Sponsor</Text>
                  <View style={styles.actions}>
                    {(['tomato', 'common'] as const).map((value) => (
                      <Pressable key={value} style={[styles.secondaryButton, form.sponsorType === value && styles.selectedButton]} onPress={() => setForm((current) => ({ ...current, sponsorType: value }))}>
                        <Text style={styles.secondaryText}>{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.fieldLabel}>Discount type</Text>
                  <View style={styles.actions}>
                    {(['percentage', 'flat'] as const).map((value) => (
                      <Pressable key={value} style={[styles.secondaryButton, form.discountType === value && styles.selectedButton]} onPress={() => setForm((current) => ({ ...current, discountType: value }))}>
                        <Text style={styles.secondaryText}>{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput style={styles.input} placeholder="Discount value" keyboardType="decimal-pad" value={form.discountValue} onChangeText={(value) => setForm((current) => ({ ...current, discountValue: value }))} />
                  <TextInput style={styles.input} placeholder="Minimum order amount (optional)" keyboardType="decimal-pad" value={form.minOrderAmount} onChangeText={(value) => setForm((current) => ({ ...current, minOrderAmount: value }))} />
                  <TextInput style={styles.input} placeholder="Maximum discount (optional)" keyboardType="decimal-pad" value={form.maxDiscountAmount} onChangeText={(value) => setForm((current) => ({ ...current, maxDiscountAmount: value }))} />
                  <TextInput style={styles.input} placeholder="Target item category (optional)" value={form.targetItemCategory} onChangeText={(value) => setForm((current) => ({ ...current, targetItemCategory: value }))} />
                  <TextInput style={styles.input} placeholder="Occasion name (optional)" value={form.occasionName} onChangeText={(value) => setForm((current) => ({ ...current, occasionName: value }))} />
                  <TextInput style={styles.input} placeholder="Target customer email/phone (optional)" value={form.targetUserIdentifier} onChangeText={(value) => setForm((current) => ({ ...current, targetUserIdentifier: value }))} />
                  <TextInput style={styles.input} placeholder="Applicable store type (optional)" value={form.applicableStoreType} onChangeText={(value) => setForm((current) => ({ ...current, applicableStoreType: value }))} />
                  <TextInput style={styles.input} placeholder="Per-user usage limit (optional)" keyboardType="number-pad" value={form.usageLimitPerUser} onChangeText={(value) => setForm((current) => ({ ...current, usageLimitPerUser: value }))} />
                  <TextInput style={styles.input} placeholder="Total usage limit (optional)" keyboardType="number-pad" value={form.totalUsageLimit} onChangeText={(value) => setForm((current) => ({ ...current, totalUsageLimit: value }))} />
                  <TextInput style={styles.input} placeholder="Valid from (ISO date)" value={form.validFrom} onChangeText={(value) => setForm((current) => ({ ...current, validFrom: value }))} />
                  <TextInput style={styles.input} placeholder="Valid until (ISO date)" value={form.validUntil} onChangeText={(value) => setForm((current) => ({ ...current, validUntil: value }))} />
                  <Pressable disabled={busy === (editingCouponId || 'create-coupon')} style={styles.primaryButton} onPress={() => void createCoupon()}>
                    <Text style={styles.primaryText}>{busy === 'create-coupon' || busy === editingCouponId ? 'Saving…' : editingCouponId ? 'Save coupon' : 'Create coupon'}</Text>
                  </Pressable>
                  {!!editingCouponId && <Pressable style={styles.secondaryButton} onPress={() => setEditingCouponId('')}><Text style={styles.secondaryText}>Cancel edit</Text></Pressable>}
                </View>
              )}
              {coupons.map((coupon, index) => (
                <View key={text(coupon._id || coupon.id, String(index))} style={styles.card}>
                  <Text style={styles.cardTitle}>{coupon.code || 'Coupon'} · {coupon.title || 'Untitled'}</Text>
                  <InfoLine label="Discount" value={`${text(coupon.discountValue)} ${text(coupon.discountType)}`} />
                  <InfoLine label="Status" value={coupon.isActive} />
                  <InfoLine label="Uses" value={coupon.usedCount || coupon.totalUsage} />
                  {canManage && (
                    <View style={styles.actions}>
                      <Pressable style={styles.secondaryButton} onPress={() => editCoupon(coupon)}>
                        <Text style={styles.secondaryText}>Edit</Text>
                      </Pressable>
                      <Pressable disabled={!!busy} style={styles.secondaryButton} onPress={() => void toggleAdminCoupon(coupon)}>
                        <Text style={styles.secondaryText}>{coupon.isActive ? 'Deactivate' : 'Activate'}</Text>
                      </Pressable>
                      <Pressable disabled={!!busy} style={styles.dangerButton} onPress={() => void deleteCoupon(coupon)}>
                        <Text style={styles.dangerText}>{busy === `coupon-${text(coupon._id || coupon.id, '')}` ? 'Deleting…' : 'Delete coupon'}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
              {!coupons.length && <Text style={styles.muted}>No platform coupons were returned.</Text>}
            </View>
          )}
          {section === 'analytics' && (
            <View>
              {/* Filter Card with Presets and Custom Range */}
              <View style={styles.card}>
                <View style={styles.analyticsTitleRow}>
                  <Text style={styles.cardTitle}>Analytics date range</Text>
                  <View style={styles.liveBadge}>
                    <Text style={styles.liveBadgeDot}>●</Text>
                    <Text style={styles.liveBadgeText}>LIVE TELEMETRY</Text>
                  </View>
                </View>
                <Text style={styles.analyticsSubhint}>
                  Filter platform GMV, fulfillment and order distribution.
                </Text>

                {/* Preset Chips */}
                <View style={styles.presetFilterRow}>
                  {(
                    [
                      ['all', 'All Time'],
                      ['today', 'Today'],
                      ['7d', 'Last 7 Days'],
                      ['30d', 'Last 30 Days'],
                    ] as const
                  ).map(([key, label]) => (
                    <Pressable
                      key={key}
                      onPress={() => applyPresetPeriod(key)}
                      style={[
                        styles.presetFilterChip,
                        selectedPeriod === key && styles.presetFilterChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetFilterChipText,
                          selectedPeriod === key && styles.presetFilterChipTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Custom Date Inputs Fixed Horizontally */}
                <View style={styles.horizontalDateRangeRow}>
                  <TextInput
                    style={styles.horizontalDateInput}
                    placeholder="Start (YYYY-MM-DD)"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                    value={analyticsRange.startDate}
                    onChangeText={(value) => {
                      setSelectedPeriod('all');
                      setAnalyticsRange((current) => ({ ...current, startDate: value }));
                    }}
                  />
                  <Text style={styles.horizontalDateTo}>to</Text>
                  <TextInput
                    style={styles.horizontalDateInput}
                    placeholder="End (YYYY-MM-DD)"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                    value={analyticsRange.endDate}
                    onChangeText={(value) => {
                      setSelectedPeriod('all');
                      setAnalyticsRange((current) => ({ ...current, endDate: value }));
                    }}
                  />
                  <Pressable style={styles.horizontalApplyBtn} onPress={() => void load()}>
                    <Text style={styles.horizontalApplyText}>Apply</Text>
                  </Pressable>
                </View>
              </View>

              {/* Key Platform KPIs Grid */}
              <Text style={styles.analyticsSectionHeading}>SALES & PLATFORM PERFORMANCE</Text>
              <View style={styles.analyticsKpiGrid}>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
                  <Text style={styles.kpiLabel}>Total Platform GMV</Text>
                  <Text style={[styles.kpiValue, { color: '#c2410c' }]}>{money(analytics.totalGMV)}</Text>
                  <Text style={styles.kpiSubhint}>Lifetime gross platform volume</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                  <Text style={styles.kpiLabel}>Period Sales Volume</Text>
                  <Text style={[styles.kpiValue, { color: '#15803d' }]}>{money(analytics.periodGMV)}</Text>
                  <Text style={styles.kpiSubhint}>{selectedPeriod === 'today' ? 'Today revenue' : 'In selected time range'}</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }]}>
                  <Text style={styles.kpiLabel}>Total Orders</Text>
                  <Text style={[styles.kpiValue, { color: '#1d4ed8' }]}>{text(analytics.totalOrdersCount, '0')}</Text>
                  <Text style={styles.kpiSubhint}>Recorded order transactions</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
                  <Text style={styles.kpiLabel}>Delivered Orders</Text>
                  <Text style={[styles.kpiValue, { color: '#047857' }]}>{text(analytics.deliveredOrdersCount, '0')}</Text>
                  <Text style={styles.kpiSubhint}>Fulfillment: {text(analytics.fulfillmentRate, '100%')}</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#faf5ff', borderColor: '#e9d5ff' }]}>
                  <Text style={styles.kpiLabel}>Active Pipeline</Text>
                  <Text style={[styles.kpiValue, { color: '#7e22ce' }]}>{text(analytics.activeOrdersCount, '0')}</Text>
                  <Text style={styles.kpiSubhint}>In prep or out for delivery</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#fff1f2', borderColor: '#fecdd3' }]}>
                  <Text style={styles.kpiLabel}>Cancelled Orders</Text>
                  <Text style={[styles.kpiValue, { color: '#be123c' }]}>{text(analytics.cancelledOrdersCount, '0')}</Text>
                  <Text style={styles.kpiSubhint}>Rejected or cancelled</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#fefce8', borderColor: '#fef08a' }]}>
                  <Text style={styles.kpiLabel}>Avg. Order Value (AOV)</Text>
                  <Text style={[styles.kpiValue, { color: '#a16207' }]}>{money(analytics.avgOrderValue)}</Text>
                  <Text style={styles.kpiSubhint}>Per platform order</Text>
                </View>
                <View style={[styles.analyticsKpiCard, { backgroundColor: '#f0fdfa', borderColor: '#99f6e4' }]}>
                  <Text style={styles.kpiLabel}>Items & Units Sold</Text>
                  <Text style={[styles.kpiValue, { color: '#0f766e' }]}>{text(analytics.totalUnitsSold, '0')}</Text>
                  <Text style={styles.kpiSubhint}>Dishes & products dispatched</Text>
                </View>
              </View>

              {/* Orders by Status Card */}
              {(() => {
                const statusList = parseStatusList(analytics.ordersByStatus);
                const totalOrd = Number(analytics.totalOrdersCount) || statusList.reduce((acc, s) => acc + s.count, 0) || 1;
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Orders by Status Breakdown</Text>
                    {statusList.length ? (
                      <View style={styles.statusListWrap}>
                        {statusList.map((item) => {
                          const percent = Math.min(100, Math.round((item.count / totalOrd) * 100));
                          const color = getStatusColor(item.status);
                          return (
                            <View key={item.status} style={styles.statusRow}>
                              <View style={styles.statusRowHeader}>
                                <View style={styles.statusDotWrap}>
                                  <View style={[styles.statusDot, { backgroundColor: color.dot }]} />
                                  <Text style={styles.statusName}>{formatStatusLabel(item.status)}</Text>
                                </View>
                                <View style={[styles.statusBadge, { backgroundColor: color.bg }]}>
                                  <Text style={[styles.statusBadgeText, { color: color.text }]}>
                                    {item.count} orders ({percent}%)
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.progressBarTrack}>
                                <View style={[styles.progressBarFill, { width: `${percent}%`, backgroundColor: color.dot }]} />
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.muted}>No status history recorded yet.</Text>
                    )}
                  </View>
                );
              })()}

              {/* Payment Distribution Card */}
              {(() => {
                const dist = parsePaymentDist(analytics.paymentDistribution);
                const totalRev = (dist.codAmount + dist.onlineAmount) || 1;
                const codPct = Math.min(100, Math.round((dist.codAmount / totalRev) * 100));
                const onlinePct = Math.min(100, Math.round((dist.onlineAmount / totalRev) * 100));
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Payment Method Distribution</Text>
                    <View style={styles.paymentDistWrap}>
                      <View style={styles.paymentDistCard}>
                        <View style={styles.paymentIconRow}>
                          <Text style={styles.paymentIcon}>💵</Text>
                          <View style={styles.flex}>
                            <Text style={styles.paymentTypeTitle}>Cash on Delivery (COD)</Text>
                            <Text style={styles.paymentAmount}>{money(dist.codAmount)}</Text>
                          </View>
                          <Text style={styles.paymentCountBadge}>{dist.codCount} orders ({codPct}%)</Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                          <View style={[styles.progressBarFill, { width: `${codPct}%`, backgroundColor: '#16a34a' }]} />
                        </View>
                      </View>

                      <View style={styles.paymentDistCard}>
                        <View style={styles.paymentIconRow}>
                          <Text style={styles.paymentIcon}>💳</Text>
                          <View style={styles.flex}>
                            <Text style={styles.paymentTypeTitle}>Digital / Online Payments</Text>
                            <Text style={styles.paymentAmount}>{money(dist.onlineAmount)}</Text>
                          </View>
                          <Text style={styles.paymentCountBadge}>{dist.onlineCount} orders ({onlinePct}%)</Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                          <View style={[styles.progressBarFill, { width: `${onlinePct}%`, backgroundColor: '#2563eb' }]} />
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* COD Details Card */}
              {(() => {
                const cod = parseCodDetails(analytics.codDetails);
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Cash on Delivery (COD) Settlements</Text>
                    <View style={styles.codSummaryRow}>
                      <View style={styles.codMetricBox}>
                        <Text style={styles.codMetricValue}>{money(cod.collected)}</Text>
                        <Text style={styles.codMetricLabel}>Collected & Settled</Text>
                      </View>
                      <View style={styles.codMetricBox}>
                        <Text style={[styles.codMetricValue, { color: '#d97706' }]}>{money(cod.inTransit)}</Text>
                        <Text style={styles.codMetricLabel}>In Transit with Riders</Text>
                      </View>
                      <View style={styles.codMetricBox}>
                        <Text style={[styles.codMetricValue, { color: '#2563eb' }]}>{money(cod.total)}</Text>
                        <Text style={styles.codMetricLabel}>Total COD Handled</Text>
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* Top Dishes Card */}
              {(() => {
                const dishes = parseTopItems(analytics.topDishes);
                const medals = ['🥇', '🥈', '🥉', '4', '5'];
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Top-Selling Dishes & Items</Text>
                    {dishes.length ? (
                      dishes.map((item, idx) => (
                        <View key={`${item.name}-${idx}`} style={styles.rankItemRow}>
                          <View style={[styles.rankBadge, idx === 0 ? styles.rankGold : idx === 1 ? styles.rankSilver : idx === 2 ? styles.rankBronze : styles.rankDefault]}>
                            <Text style={styles.rankBadgeText}>{medals[idx] || `${idx + 1}`}</Text>
                          </View>
                          <View style={styles.flex}>
                            <Text style={styles.rankName}>{item.name}</Text>
                            <Text style={styles.rankMeta}>{item.count} orders sold</Text>
                          </View>
                          {item.revenue !== undefined && (
                            <Text style={styles.rankAmount}>{money(item.revenue)}</Text>
                          )}
                        </View>
                      ))
                    ) : (
                      <Text style={styles.muted}>No dishes data recorded yet.</Text>
                    )}
                  </View>
                );
              })()}

              {/* Top Performing Restaurants Card */}
              {(() => {
                const stores = parseTopStores(analytics.topRestaurants);
                const medals = ['🥇', '🥈', '🥉', '4', '5'];
                return (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Top Performing Restaurants & Shops</Text>
                    {stores.length ? (
                      stores.map((item, idx) => (
                        <View key={`${item.name}-${idx}`} style={styles.rankItemRow}>
                          <View style={[styles.rankBadge, idx === 0 ? styles.rankGold : idx === 1 ? styles.rankSilver : idx === 2 ? styles.rankBronze : styles.rankDefault]}>
                            <Text style={styles.rankBadgeText}>{medals[idx] || `${idx + 1}`}</Text>
                          </View>
                          <View style={styles.flex}>
                            <Text style={styles.rankName}>{item.name}</Text>
                            <Text style={styles.rankMeta}>{item.orders} orders fulfilled</Text>
                          </View>
                          {item.gmv !== undefined && (
                            <Text style={styles.rankAmount}>{money(item.gmv)}</Text>
                          )}
                        </View>
                      ))
                    ) : (
                      <Text style={styles.muted}>No restaurant data recorded yet.</Text>
                    )}
                  </View>
                );
              })()}
            </View>
          )}
          <Pressable style={styles.secondaryButton} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Refresh</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: '#d83a32', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 8 },
  title: { color: '#2d2621', fontSize: 23, fontWeight: '800', marginTop: 4, marginBottom: 10 },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#f0e7e1', marginBottom: 10 },
  cardTitle: { color: '#292421', fontSize: 14, fontWeight: '800', marginBottom: 7 },
  muted: { color: '#766d68', fontSize: 12, lineHeight: 18, marginTop: 3 },
  input: { minHeight: 42, borderWidth: 1, borderColor: '#eaded7', borderRadius: 10, paddingHorizontal: 11, marginTop: 8, color: '#292421', backgroundColor: '#fff' },
  fieldLabel: { color: '#463e39', fontSize: 12, fontWeight: '700', marginTop: 10 },
  infoLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  infoLabel: { color: '#766d68', fontSize: 11, flex: 1 },
  infoValue: { color: '#292421', fontSize: 11, fontWeight: '700', flex: 1, textAlign: 'right' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 },
  metric: { width: '48%', flexGrow: 1, backgroundColor: '#fff', borderColor: '#f0e7e1', borderWidth: 1, borderRadius: 12, padding: 12 },
  metricValue: { color: '#d83a32', fontSize: 17, fontWeight: '800' },
  metricLabel: { color: '#766d68', fontSize: 10, marginTop: 4, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginVertical: 6 },
  primaryButton: { minHeight: 38, justifyContent: 'center', alignItems: 'center', backgroundColor: '#d83a32', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  secondaryButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff1ed', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  selectedButton: { backgroundColor: '#f3d6d1' },
  secondaryText: { color: '#c2352d', fontWeight: '800', fontSize: 11 },
  dangerButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fae7e4', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, alignSelf: 'flex-start', marginTop: 7 },
  dangerText: { color: '#a9241c', fontWeight: '800', fontSize: 11 },
  error: { color: '#a9241c', backgroundColor: '#fae7e4', padding: 10, borderRadius: 9, marginBottom: 8 },
  loader: { marginTop: 25 },
  flex: { flex: 1 },
  analyticsTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#dcfce7', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  liveBadgeDot: { fontSize: 8, color: '#16a34a' },
  liveBadgeText: { fontSize: 9, fontWeight: '800', color: '#15803d', letterSpacing: 0.5 },
  analyticsSubhint: { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 10 },
  presetFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  presetFilterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  presetFilterChipActive: { backgroundColor: '#eff6ff', borderColor: '#2563eb' },
  presetFilterChipText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  presetFilterChipTextActive: { color: '#1d4ed8', fontWeight: '800' },
  horizontalDateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  horizontalDateInput: {
    flex: 1,
    minHeight: 40,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: '#111827',
  },
  horizontalDateTo: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    paddingHorizontal: 2,
  },
  horizontalApplyBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 13,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  horizontalApplyText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  analyticsSectionHeading: { fontSize: 12, fontWeight: '800', color: '#475569', letterSpacing: 0.8, marginTop: 14, marginBottom: 8 },
  analyticsKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  analyticsKpiCard: { width: '48%', flexGrow: 1, borderRadius: 12, borderWidth: 1.2, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  kpiLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  kpiValue: { fontSize: 18, fontWeight: '900' },
  kpiSubhint: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  statusListWrap: { gap: 10, marginTop: 4 },
  statusRow: { marginVertical: 3 },
  statusRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  statusDotWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusName: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  statusBadgeText: { fontSize: 10, fontWeight: '700' },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: '#f1f5f9', overflow: 'hidden' },
  progressBarFill: { height: 6, borderRadius: 3 },
  paymentDistWrap: { gap: 8, marginTop: 4 },
  paymentDistCard: { padding: 11, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  paymentIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  paymentIcon: { fontSize: 20 },
  paymentTypeTitle: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  paymentAmount: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginTop: 1 },
  paymentCountBadge: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  codSummaryRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  codMetricBox: { flex: 1, padding: 11, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' },
  codMetricValue: { fontSize: 16, fontWeight: '800', color: '#15803d' },
  codMetricLabel: { fontSize: 10, fontWeight: '600', color: '#64748b', marginTop: 2, textAlign: 'center' },
  rankItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankGold: { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fcd34d' },
  rankSilver: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  rankBronze: { backgroundColor: '#ffedd5', borderWidth: 1, borderColor: '#fed7aa' },
  rankDefault: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  rankBadgeText: { fontSize: 13, fontWeight: '800' },
  rankName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  rankMeta: { fontSize: 11, color: '#64748b', marginTop: 1 },
  rankAmount: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
});
