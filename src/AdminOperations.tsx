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

export default function AdminOperations({
  session,
  section,
  canManage,
  canTransfer,
}: {
  session: Session;
  section: AdminOperationSection;
  canManage: boolean;
  canTransfer: boolean;
}) {
  const [data, setData] = useState<RecordValue>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bankMode, setBankMode] = useState<'partners' | 'settlements'>('partners');
  const [editingCouponId, setEditingCouponId] = useState('');
  const [analyticsRange, setAnalyticsRange] = useState({ startDate: '', endDate: '' });
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

  async function load() {
    setLoading(true);
    setError('');
    if (
      section === 'analytics'
      && Boolean(analyticsRange.startDate) !== Boolean(analyticsRange.endDate)
    ) {
      setError('Enter both analytics dates, or leave both blank for all-time analytics.');
      setLoading(false);
      return;
    }
    if (
      section === 'analytics'
      && analyticsRange.startDate
      && (!/^\d{4}-\d{2}-\d{2}$/.test(analyticsRange.startDate)
        || !/^\d{4}-\d{2}-\d{2}$/.test(analyticsRange.endDate))
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
        if (analyticsRange.startDate && analyticsRange.endDate) {
          query.set('startDate', analyticsRange.startDate);
          query.set('endDate', analyticsRange.endDate);
        } else {
          query.set('allTime', 'true');
        }
        result = asRecord(await apiRequest<unknown>(`/api/admin/analytics?${query.toString()}`, session.token));
      }
      setData(result);
    } catch (reason) {
      setError(errorMessage(reason));
      setData({});
    } finally {
      setLoading(false);
    }
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
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Analytics date range</Text>
                <TextInput style={styles.input} placeholder="Start date (YYYY-MM-DD)" autoCapitalize="none" value={analyticsRange.startDate} onChangeText={(value) => setAnalyticsRange((current) => ({ ...current, startDate: value }))} />
                <TextInput style={styles.input} placeholder="End date (YYYY-MM-DD)" autoCapitalize="none" value={analyticsRange.endDate} onChangeText={(value) => setAnalyticsRange((current) => ({ ...current, endDate: value }))} />
                <Pressable style={styles.secondaryButton} onPress={() => void load()}>
                  <Text style={styles.secondaryText}>Apply date range</Text>
                </Pressable>
              </View>
              <View style={styles.metrics}>
                {[
                  ['Total GMV', analytics.totalGMV],
                  ['Period GMV', analytics.periodGMV],
                  ['Lifetime GMV', analytics.lifetimeGMV],
                  ['Period orders', analytics.periodOrdersCount],
                  ['All orders', analytics.totalOrdersCount],
                  ['Delivered', analytics.deliveredOrdersCount],
                  ['Active', analytics.activeOrdersCount],
                  ['Cancelled', analytics.cancelledOrdersCount],
                  ['Fulfillment', analytics.fulfillmentRate],
                  ['Average order', analytics.avgOrderValue],
                  ['Units sold', analytics.totalUnitsSold],
                ].map(([label, value]) => (
                  <Metric key={String(label)} label={String(label)} value={String(label).includes('GMV') || String(label).includes('Average') ? money(value) : value} />
                ))}
              </View>
              {[
                ['Orders by status', analytics.ordersByStatus],
                ['Payment distribution', analytics.paymentDistribution],
                ['COD details', analytics.codDetails],
                ['Top dishes', analytics.topDishes],
                ['Top restaurants', analytics.topRestaurants],
              ].map(([title, value]) => (
                <View key={String(title)} style={styles.card}>
                  <Text style={styles.cardTitle}>{String(title)}</Text>
                  <Text style={styles.muted}>{JSON.stringify(value ?? {})}</Text>
                </View>
              ))}
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
});
