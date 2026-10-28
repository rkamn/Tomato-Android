import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import { formatDigipin, isValidDigipin, normalizeDigipin } from './digipin';
import type { Session } from './types';

type PartnerRole = 'restaurant' | 'shop';
export type PartnerModuleSection = 'coupons' | 'finance' | 'account';
type Profile = {
  name?: string;
  phone?: string;
  restaurantAddress?: string;
  shopAddress?: string;
  cuisine?: string;
  category?: string;
  digipin?: string;
  gsnNumber?: string;
  isApproved?: boolean;
  isOpen?: boolean;
};
type BankDetails = {
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
  agreementCommissionPercent?: number;
};
type Coupon = {
  _id: string;
  code?: string;
  title?: string;
  description?: string;
  discountType?: string;
  discountValue?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  isActive?: boolean;
  validFrom?: string;
  validUntil?: string;
  targetItemCategory?: string;
  occasionName?: string;
  usageLimitPerUser?: number;
  totalUsageLimit?: number;
};
type FinanceTransfer = Record<string, unknown> & {
  _id?: string;
  id?: string;
  amount?: number;
  transferType?: string;
  purpose?: string;
  senderName?: string;
  senderRole?: string;
  receiverName?: string;
  receiverRole?: string;
  createdAt?: string;
};

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
  );
}

function getCouponSummaryList(summary: Record<string, unknown>, coupons: Coupon[]) {
  const summaryMap: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(summary || {})) {
    const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    summaryMap[norm] = v;
  }

  const total = summaryMap.totalcoupons ?? summaryMap.total ?? coupons.length;
  const active = summaryMap.activecoupons ?? summaryMap.active ?? coupons.filter((c) => c.isActive !== false).length;
  const inactive = summaryMap.inactivecoupons ?? summaryMap.inactive ?? coupons.filter((c) => c.isActive === false).length;
  const redemptions =
    summaryMap.totalredemptions ??
    summaryMap.redemptions ??
    coupons.reduce(
      (sum, c) => sum + Number((c as any).usedCount || (c as any).totalUsage || (c as any).redemptions || 0),
      0,
    );

  return [
    { key: 'total', label: 'Total', value: String(total ?? 0) },
    { key: 'active', label: 'Active', value: String(active ?? 0) },
    { key: 'inactive', label: 'InActive', value: String(inactive ?? 0) },
    { key: 'redeemed', label: 'Redeemed', value: String(redemptions ?? 0) },
  ];
}

export default function PartnerModules({
  session,
  partnerRole,
  section,
}: {
  session: Session;
  partnerRole: PartnerRole;
  section: PartnerModuleSection;
}) {
  const apiBase = `/api/${partnerRole}`;
  const kind = partnerRole === 'shop' ? 'Shop' : 'Restaurant';
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile>({});
  const [bankDetails, setBankDetails] = useState<BankDetails>({});
  const [walletBalance, setWalletBalance] = useState(0);
  const [creditPoint, setCreditPoint] = useState(0);
  const [payouts, setPayouts] = useState<Record<string, unknown>[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [transfers, setTransfers] = useState<FinanceTransfer[]>([]);
  const [couponSummary, setCouponSummary] = useState<Record<string, unknown>>({});
  const [createFormVisible, setCreateFormVisible] = useState(false);
  const [couponForm, setCouponForm] = useState({
    code: '',
    title: '',
    description: '',
    discountType: 'percentage',
    discountValue: '',
    minOrderAmount: '',
    maxDiscountAmount: '',
    targetItemCategory: '',
    occasionName: '',
    usageLimitPerUser: '',
    totalUsageLimit: '',
    validFrom: '',
    validUntil: '',
  });
  const [editingCouponId, setEditingCouponId] = useState('');
  const [transferForm, setTransferForm] = useState({
    recipientId: '',
    transferType: 'wallet',
    amount: '',
    purpose: '',
    orderNumber: '',
  });
  const [createTransferVisible, setCreateTransferVisible] = useState(false);
  const [transferTypeDropdownOpen, setTransferTypeDropdownOpen] = useState(false);
  const [bankForm, setBankForm] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    panNumber: '',
    panHolderName: '',
    upiId: '',
    adminNote: '',
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (section === 'coupons') {
        const result = await apiRequest<{ coupons?: Coupon[]; summary?: Record<string, unknown> }>(
          `${apiBase}/coupons`,
          session.token,
        );
        setCoupons(result.coupons || []);
        setCouponSummary(result.summary || {});
      } else if (section === 'finance') {
        const [result, bankResult] = await Promise.all([
          apiRequest<{ records?: FinanceTransfer[] }>(
            `${apiBase}/finance/transfers?page=1&limit=50`,
            session.token,
          ),
          apiRequest<{ walletBalance?: number; creditPoint?: number }>(
            `${apiBase}/bank-details`,
            session.token,
          ),
        ]);
        setTransfers(result.records || []);
        setWalletBalance(Number(bankResult.walletBalance || 0));
        setCreditPoint(Number(bankResult.creditPoint || 0));
      } else {
        const [profileResult, bankResult] = await Promise.all([
          apiRequest<{ profile?: Profile }>(`${apiBase}/profile`, session.token),
          apiRequest<{
            bankDetails?: BankDetails;
            walletBalance?: number;
            creditPoint?: number;
            payouts?: Record<string, unknown>[];
          }>(`${apiBase}/bank-details`, session.token),
        ]);
        const nextProfile = profileResult.profile || {};
        const nextBank = bankResult.bankDetails || {};
        setProfile(nextProfile);
        setBankDetails(nextBank);
        setWalletBalance(Number(bankResult.walletBalance || 0));
        setCreditPoint(Number(bankResult.creditPoint || 0));
        setPayouts(bankResult.payouts || []);
        setBankForm((current) => ({
          ...current,
          accountHolderName: nextBank.accountHolderName || current.accountHolderName,
          bankName: nextBank.bankName || current.bankName,
          accountNumber: nextBank.accountNumber || current.accountNumber,
          ifscCode: nextBank.ifscCode || current.ifscCode,
          panNumber: nextBank.panNumber || current.panNumber,
          panHolderName: nextBank.panHolderName || current.panHolderName,
          upiId: nextBank.upiId || current.upiId,
          adminNote: nextBank.adminNote || current.adminNote,
        }));
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [section, session.token, partnerRole]);

  async function runAction(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError('');
    try {
      await action();
      await load();
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy('');
    }
  }

  async function saveProfile() {
    const cleanDigipin = normalizeDigipin(profile.digipin);
    if (cleanDigipin && !isValidDigipin(cleanDigipin)) {
      setError('Enter a valid DIGIPIN (e.g. 10 alphanumeric characters).');
      return;
    }
    await runAction('profile', async () => {
      await apiRequest(`${apiBase}/profile`, session.token, {
        method: 'PUT',
        body: JSON.stringify({
          name: profile.name?.trim(),
          phone: profile.phone?.trim(),
          ...(partnerRole === 'shop'
            ? { shopAddress: profile.shopAddress?.trim(), category: profile.category?.trim() }
            : { restaurantAddress: profile.restaurantAddress?.trim(), cuisine: profile.cuisine?.trim() }),
          digipin: cleanDigipin,
          gsnNumber: profile.gsnNumber?.trim(),
        }),
      });
    });
  }

  async function saveBankDetails() {
    const accountNumber = bankForm.accountNumber.trim();
    const accountHolderName = bankForm.accountHolderName.trim();
    const panHolderName = bankForm.panHolderName.trim();
    const bankName = bankForm.bankName.trim();
    const ifscCode = bankForm.ifscCode.trim().toUpperCase();
    const panNumber = bankForm.panNumber.trim().toUpperCase();

    if (
      !accountHolderName ||
      !panHolderName ||
      !bankName ||
      accountNumber.length < 6 ||
      !ifscCode ||
      !panNumber
    ) {
      setError('Please fill in Account Holder Name, Name on PAN Card, Bank Name, Account Number, IFSC, and PAN.');
      return;
    }

    const normBank = accountHolderName.toLowerCase().replace(/\s+/g, ' ');
    const normPan = panHolderName.toLowerCase().replace(/\s+/g, ' ');
    if (normBank !== normPan) {
      setError(`Bank Account Holder Name ("${accountHolderName}") MUST match the Name on PAN Card ("${panHolderName}").`);
      return;
    }

    await runAction('bank-details', async () => {
      const res = await apiRequest<{ message?: string }>(`${apiBase}/bank-details`, session.token, {
        method: 'PUT',
        body: JSON.stringify({
          accountHolderName,
          panHolderName,
          bankName,
          accountNumber,
          ifscCode,
          panNumber,
          upiId: bankForm.upiId.trim(),
          adminNote: bankForm.adminNote.trim(),
        }),
      });
      setBankForm((current) => ({ ...current, accountNumber: '', panNumber: '' }));
      Alert.alert('Details Submitted', res?.message || 'Bank & PAN details submitted for admin verification!');
    });
  }

  function startEditCoupon(coupon: Coupon) {
    setEditingCouponId(coupon._id);
    setCreateFormVisible(true);
    setCouponForm({
      code: coupon.code || '',
      title: coupon.title || '',
      description: coupon.description || '',
      discountType: coupon.discountType || 'percentage',
      discountValue: String(coupon.discountValue ?? ''),
      minOrderAmount: String(coupon.minOrderAmount ?? ''),
      maxDiscountAmount: String(coupon.maxDiscountAmount ?? ''),
      targetItemCategory: coupon.targetItemCategory || '',
      occasionName: coupon.occasionName || '',
      usageLimitPerUser: String(coupon.usageLimitPerUser ?? ''),
      totalUsageLimit: String(coupon.totalUsageLimit ?? ''),
      validFrom: coupon.validFrom || '',
      validUntil: coupon.validUntil || '',
    });
  }

  async function saveCoupon() {
    const discountValue = Number(couponForm.discountValue);
    if (!couponForm.code.trim() || !couponForm.title.trim() || !Number.isFinite(discountValue) || discountValue <= 0) {
      setError('Enter a coupon code, title and positive discount value.');
      return;
    }
    const optionalAmounts = [
      ['Minimum order amount', couponForm.minOrderAmount],
      ['Maximum discount', couponForm.maxDiscountAmount],
      ['Per-user usage limit', couponForm.usageLimitPerUser],
      ['Total usage limit', couponForm.totalUsageLimit],
    ] as const;
    for (const [label, rawValue] of optionalAmounts) {
      if (rawValue && (!Number.isFinite(Number(rawValue)) || Number(rawValue) < 0)) {
        setError(`${label} must be a non-negative number.`);
        return;
      }
    }
    if (
      [couponForm.usageLimitPerUser, couponForm.totalUsageLimit]
        .some((value) => value && !Number.isInteger(Number(value)))
    ) {
      setError('Coupon usage limits must be whole numbers.');
      return;
    }
    if (
      (couponForm.validFrom && Number.isNaN(Date.parse(couponForm.validFrom)))
      || (couponForm.validUntil && Number.isNaN(Date.parse(couponForm.validUntil)))
    ) {
      setError('Enter valid coupon dates in ISO date format.');
      return;
    }
    await runAction('coupon', async () => {
      const payload = {
        code: couponForm.code.trim().toUpperCase(),
        title: couponForm.title.trim(),
        description: couponForm.description.trim(),
        discountType: couponForm.discountType,
        discountValue,
        ...(couponForm.minOrderAmount ? { minOrderAmount: Number(couponForm.minOrderAmount) } : {}),
        ...(couponForm.maxDiscountAmount ? { maxDiscountAmount: Number(couponForm.maxDiscountAmount) } : {}),
        ...(couponForm.targetItemCategory.trim() ? { targetItemCategory: couponForm.targetItemCategory.trim() } : {}),
        ...(couponForm.occasionName.trim() ? { occasionName: couponForm.occasionName.trim() } : {}),
        ...(couponForm.usageLimitPerUser ? { usageLimitPerUser: Number(couponForm.usageLimitPerUser) } : {}),
        ...(couponForm.totalUsageLimit ? { totalUsageLimit: Number(couponForm.totalUsageLimit) } : {}),
        ...(couponForm.validFrom ? { validFrom: couponForm.validFrom } : {}),
        ...(couponForm.validUntil ? { validUntil: couponForm.validUntil } : {}),
      };
      await apiRequest(
        editingCouponId ? `${apiBase}/coupons/${encodeURIComponent(editingCouponId)}` : `${apiBase}/coupons`,
        session.token,
        {
          method: editingCouponId ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setEditingCouponId('');
      setCreateFormVisible(false);
      setCouponForm({
        code: '',
        title: '',
        description: '',
        discountType: 'percentage',
        discountValue: '',
        minOrderAmount: '',
        maxDiscountAmount: '',
        targetItemCategory: '',
        occasionName: '',
        usageLimitPerUser: '',
        totalUsageLimit: '',
        validFrom: '',
        validUntil: '',
      });
    });
  }

  async function toggleCoupon(coupon: Coupon) {
    await runAction(`toggle-${coupon._id}`, async () => {
      await apiRequest(`${apiBase}/coupons/${encodeURIComponent(coupon._id)}/toggle`, session.token, {
        method: 'PATCH',
      });
    });
  }

  function deleteCoupon(coupon: Coupon) {
    Alert.alert('Delete coupon?', `Remove ${coupon.code || coupon.title || 'this coupon'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void runAction(`delete-${coupon._id}`, async () => {
          await apiRequest(`${apiBase}/coupons/${encodeURIComponent(coupon._id)}`, session.token, {
            method: 'DELETE',
          });
        }),
      },
    ]);
  }

  async function createTransfer() {
    const amount = Number(transferForm.amount);
    if (!transferForm.recipientId.trim() || !transferForm.purpose.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter a recipient ID, positive amount and transfer purpose.');
      return;
    }
    Alert.alert('Confirm transfer?', `${money(amount)} will be transferred to the recipient.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Transfer',
        onPress: () => void runAction('transfer', async () => {
          await apiRequest(`${apiBase}/finance/transfer`, session.token, {
            method: 'POST',
            body: JSON.stringify({
              recipientId: transferForm.recipientId.trim(),
              transferType: transferForm.transferType,
              amount,
              purpose: transferForm.purpose.trim(),
              ...(transferForm.orderNumber.trim() ? { orderNumber: transferForm.orderNumber.trim() } : {}),
            }),
          });
          setTransferForm({ recipientId: '', transferType: 'wallet', amount: '', purpose: '', orderNumber: '' });
          setCreateTransferVisible(false);
          setTransferTypeDropdownOpen(false);
        }),
      },
    ]);
  }

  const isBankApproved = Boolean(bankDetails.isApproved || profile.isApproved);
  const isBankLocked = Boolean(bankDetails.isLocked);
  const isBankSubmitted = Boolean(bankDetails.isSubmitted);

  let bankBadgeLabel = '⚠️ Not Submitted';
  let bankBadgeVariant: 'approved' | 'ready' | 'pending' = 'pending';

  if (isBankApproved && isBankLocked) {
    bankBadgeLabel = '🔒 Approved & Locked';
    bankBadgeVariant = 'approved';
  } else if (isBankSubmitted) {
    bankBadgeLabel = '⏳ Submitted — Pending Admin Approval';
    bankBadgeVariant = 'ready';
  }

  const normBank = bankForm.accountHolderName.trim().toLowerCase().replace(/\s+/g, ' ');
  const normPan = bankForm.panHolderName.trim().toLowerCase().replace(/\s+/g, ' ');
  const showNameMatch = !isBankLocked && Boolean(normBank || normPan);
  const isNameMatched = Boolean(normBank && normPan && normBank === normPan);

  const agreementCommission = Number(bankDetails.agreementCommissionPercent ?? 15);
  const agreementFssai = bankDetails.adminNote || bankForm.adminNote || '';

  return (
    <View style={styles.content}>
      {section !== 'account' && (
        <>
          <Text style={styles.eyebrow}>{kind.toUpperCase()} WORKSPACE</Text>
          <Text style={styles.title}>
            {section === 'coupons' ? 'Your Coupons' : 'Finance & Transfer Ledger'}
          </Text>
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : (
        <>
          {section === 'coupons' && (
            <View>
              <View style={styles.metrics}>
                {getCouponSummaryList(couponSummary, coupons).map((metric) => (
                  <View key={metric.key} style={styles.metric}>
                    <Text style={styles.metricValue}>{metric.value}</Text>
                    <Text style={[styles.metricLabel, styles.metricLabelPlain]}>{metric.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.card}>
                <Pressable
                  onPress={() => setCreateFormVisible((prev) => !prev)}
                  style={[styles.couponCreateHeaderRow, !createFormVisible && { marginBottom: 0 }]}
                  accessibilityRole="button"
                  accessibilityLabel={createFormVisible ? 'Collapse create coupon form' : 'Expand create coupon form'}
                >
                  <Text style={[styles.cardTitle, { marginBottom: 0 }]}>
                    {editingCouponId ? 'Edit coupon' : 'Create a coupon'}
                  </Text>
                  <View style={styles.expandIconButton}>
                    <Text style={styles.expandIconText}>{createFormVisible ? '−' : '+'}</Text>
                  </View>
                </Pressable>
                {createFormVisible && (
                  <>
                    <TextInput style={styles.input} placeholder="Coupon code" autoCapitalize="characters" value={couponForm.code} onChangeText={(value) => setCouponForm((current) => ({ ...current, code: value }))} />
                    <TextInput style={styles.input} placeholder="Title" value={couponForm.title} onChangeText={(value) => setCouponForm((current) => ({ ...current, title: value }))} />
                    <TextInput style={styles.input} placeholder="Description" value={couponForm.description} onChangeText={(value) => setCouponForm((current) => ({ ...current, description: value }))} />
                    <TextInput style={styles.input} placeholder="Discount type (percentage or fixed)" autoCapitalize="none" value={couponForm.discountType} onChangeText={(value) => setCouponForm((current) => ({ ...current, discountType: value }))} />
                    <TextInput style={styles.input} placeholder="Discount value" keyboardType="decimal-pad" value={couponForm.discountValue} onChangeText={(value) => setCouponForm((current) => ({ ...current, discountValue: value }))} />
                    <TextInput style={styles.input} placeholder="Minimum order (optional)" keyboardType="decimal-pad" value={couponForm.minOrderAmount} onChangeText={(value) => setCouponForm((current) => ({ ...current, minOrderAmount: value }))} />
                    <TextInput style={styles.input} placeholder="Maximum discount (optional)" keyboardType="decimal-pad" value={couponForm.maxDiscountAmount} onChangeText={(value) => setCouponForm((current) => ({ ...current, maxDiscountAmount: value }))} />
                    <TextInput style={styles.input} placeholder="Target item category (optional)" value={couponForm.targetItemCategory} onChangeText={(value) => setCouponForm((current) => ({ ...current, targetItemCategory: value }))} />
                    <TextInput style={styles.input} placeholder="Occasion name (optional)" value={couponForm.occasionName} onChangeText={(value) => setCouponForm((current) => ({ ...current, occasionName: value }))} />
                    <TextInput style={styles.input} placeholder="Per-user usage limit (optional)" keyboardType="number-pad" value={couponForm.usageLimitPerUser} onChangeText={(value) => setCouponForm((current) => ({ ...current, usageLimitPerUser: value }))} />
                    <TextInput style={styles.input} placeholder="Total usage limit (optional)" keyboardType="number-pad" value={couponForm.totalUsageLimit} onChangeText={(value) => setCouponForm((current) => ({ ...current, totalUsageLimit: value }))} />
                    <TextInput style={styles.input} placeholder="Valid from (ISO date)" value={couponForm.validFrom} onChangeText={(value) => setCouponForm((current) => ({ ...current, validFrom: value }))} />
                    <TextInput style={styles.input} placeholder="Valid until (ISO date)" value={couponForm.validUntil} onChangeText={(value) => setCouponForm((current) => ({ ...current, validUntil: value }))} />
                    <Pressable disabled={busy === 'coupon'} style={styles.primaryButton} onPress={() => void saveCoupon()}>
                      <Text style={styles.primaryText}>{busy === 'coupon' ? 'Saving…' : editingCouponId ? 'Save changes' : 'Create coupon'}</Text>
                    </Pressable>
                    {!!editingCouponId && (
                      <Pressable
                        style={styles.secondaryButton}
                        onPress={() => {
                          setEditingCouponId('');
                          setCreateFormVisible(false);
                        }}
                      >
                        <Text style={styles.secondaryText}>Cancel edit</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>
              {coupons.map((coupon) => (
                <View key={coupon._id} style={styles.card}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle}>{coupon.code} · {coupon.title}</Text>
                    <Text style={styles.status}>{coupon.isActive ? 'ACTIVE' : 'INACTIVE'}</Text>
                  </View>
                  <InfoLine label="Discount" value={`${coupon.discountValue ?? 0} ${coupon.discountType || ''}`} />
                  <InfoLine label="Minimum order" value={money(coupon.minOrderAmount)} />
                  <InfoLine label="Maximum discount" value={money(coupon.maxDiscountAmount)} />
                  <InfoLine label="Valid until" value={coupon.validUntil || '—'} />
                  <View style={styles.actions}>
                    <Pressable disabled={!!busy} style={styles.secondaryButton} onPress={() => void toggleCoupon(coupon)}>
                      <Text style={styles.secondaryText}>{coupon.isActive ? 'Deactivate' : 'Activate'}</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => startEditCoupon(coupon)}><Text style={styles.secondaryText}>Edit</Text></Pressable>
                    <Pressable style={styles.dangerButton} onPress={() => deleteCoupon(coupon)}><Text style={styles.dangerText}>Delete</Text></Pressable>
                  </View>
                </View>
              ))}
              {!coupons.length && <Text style={styles.muted}>No coupons listed yet.</Text>}
            </View>
          )}
          {section === 'finance' && (
            <View>
              <View style={styles.metrics}>
                <View style={styles.metric}><Text style={styles.metricValue}>{money(walletBalance)}</Text><Text style={styles.metricLabel}>Wallet balance</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{money(creditPoint)}</Text><Text style={styles.metricLabel}>Credit points</Text></View>
              </View>
              <View style={styles.card}>
                <Pressable
                  onPress={() => setCreateTransferVisible((prev) => !prev)}
                  style={[styles.couponCreateHeaderRow, !createTransferVisible && { marginBottom: 0 }]}
                  accessibilityRole="button"
                  accessibilityLabel={createTransferVisible ? 'Collapse transfer funds form' : 'Expand transfer funds form'}
                >
                  <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Transfer Funds / Points</Text>
                  <View style={styles.expandIconButton}>
                    <Text style={styles.expandIconText}>{createTransferVisible ? '−' : '+'}</Text>
                  </View>
                </Pressable>

                {createTransferVisible && (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Recipient user ID"
                      value={transferForm.recipientId}
                      onChangeText={(value) => setTransferForm((current) => ({ ...current, recipientId: value }))}
                    />

                    {/* Transfer Type Dropdown */}
                    <View style={styles.dropdownContainer}>
                      <Text style={styles.dropdownLabel}>Transfer type</Text>
                      <Pressable
                        onPress={() => setTransferTypeDropdownOpen((prev) => !prev)}
                        style={styles.dropdownTrigger}
                        accessibilityRole="button"
                        accessibilityLabel="Select transfer type"
                      >
                        <View style={styles.dropdownTriggerLeft}>
                          <Text style={styles.dropdownTriggerIcon}>
                            {transferForm.transferType === 'wallet' ? '👛' : '⭐'}
                          </Text>
                          <Text style={styles.dropdownTriggerText}>
                            {transferForm.transferType === 'wallet' ? 'Wallet Balance' : 'Credit Points'}
                          </Text>
                        </View>
                        <Text style={styles.dropdownArrow}>{transferTypeDropdownOpen ? '▲' : '▼'}</Text>
                      </Pressable>

                      {transferTypeDropdownOpen && (
                        <View style={styles.dropdownMenu}>
                          <Pressable
                            style={[
                              styles.dropdownOption,
                              transferForm.transferType === 'wallet' && styles.dropdownOptionActive,
                            ]}
                            onPress={() => {
                              setTransferForm((c) => ({ ...c, transferType: 'wallet' }));
                              setTransferTypeDropdownOpen(false);
                            }}
                          >
                            <View style={styles.dropdownOptionLeft}>
                              <Text style={styles.dropdownOptionIcon}>👛</Text>
                              <View>
                                <Text
                                  style={[
                                    styles.dropdownOptionTitle,
                                    transferForm.transferType === 'wallet' && styles.dropdownOptionTitleActive,
                                  ]}
                                >
                                  Wallet Balance
                                </Text>
                                <Text style={styles.dropdownOptionSub}>
                                  Available: {money(walletBalance)}
                                </Text>
                              </View>
                            </View>
                            {transferForm.transferType === 'wallet' && (
                              <Text style={styles.dropdownCheck}>✓</Text>
                            )}
                          </Pressable>

                          <View style={styles.dropdownDivider} />

                          <Pressable
                            style={[
                              styles.dropdownOption,
                              transferForm.transferType === 'credit_points' && styles.dropdownOptionActive,
                            ]}
                            onPress={() => {
                              setTransferForm((c) => ({ ...c, transferType: 'credit_points' }));
                              setTransferTypeDropdownOpen(false);
                            }}
                          >
                            <View style={styles.dropdownOptionLeft}>
                              <Text style={styles.dropdownOptionIcon}>⭐</Text>
                              <View>
                                <Text
                                  style={[
                                    styles.dropdownOptionTitle,
                                    transferForm.transferType === 'credit_points' && styles.dropdownOptionTitleActive,
                                  ]}
                                >
                                  Credit Points
                                </Text>
                                <Text style={styles.dropdownOptionSub}>
                                  Available: {money(creditPoint)}
                                </Text>
                              </View>
                            </View>
                            {transferForm.transferType === 'credit_points' && (
                              <Text style={styles.dropdownCheck}>✓</Text>
                            )}
                          </Pressable>
                        </View>
                      )}
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder="Amount"
                      keyboardType="decimal-pad"
                      value={transferForm.amount}
                      onChangeText={(value) => setTransferForm((current) => ({ ...current, amount: value }))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Purpose"
                      value={transferForm.purpose}
                      onChangeText={(value) => setTransferForm((current) => ({ ...current, purpose: value }))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Order number (optional)"
                      value={transferForm.orderNumber}
                      onChangeText={(value) => setTransferForm((current) => ({ ...current, orderNumber: value }))}
                    />
                    <Pressable
                      disabled={busy === 'transfer'}
                      style={styles.primaryButton}
                      onPress={() => void createTransfer()}
                    >
                      <Text style={styles.primaryText}>
                        {busy === 'transfer' ? 'Transferring…' : 'Transfer'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
              <Text style={styles.ledgerSectionTitle}>Finance & Transfer Ledger</Text>
              {transfers.map((transfer, index) => (
                <View key={String(transfer._id || transfer.id || index)} style={styles.card}>
                  <Text style={styles.cardTitle}>{money(transfer.amount)} · {transfer.transferType || 'Transfer'}</Text>
                  <InfoLine label="Purpose" value={String(transfer.purpose || '—')} />
                  <InfoLine label="Sender" value={`${transfer.senderName || '—'} · ${transfer.senderRole || '—'}`} />
                  <InfoLine label="Recipient" value={`${transfer.receiverName || '—'} · ${transfer.receiverRole || '—'}`} />
                  <InfoLine label="Date" value={String(transfer.createdAt || '—')} />
                </View>
              ))}
              {!transfers.length && <Text style={styles.muted}>No finance transfers found.</Text>}
            </View>
          )}
          {section === 'account' && (
            <View style={styles.webPanelCard}>
              <View style={styles.webPanelHeader}>
                <View style={styles.webPanelTitleBlock}>
                  <Text
                    style={styles.webPanelTitle}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    🏦 Bank Details, PAN KYC & Payout Agreement
                  </Text>
                  <Text style={styles.webPanelSubtitle}>
                    Submit your Bank Account, IFSC Code, and PAN Card details to receive order payouts from Tomato. Your{' '}
                    <Text style={styles.webPanelSubtitleBold}>
                      Bank Account Holder Name must exactly match the Name on your PAN Card
                    </Text>{' '}
                    for account approval.
                  </Text>
                </View>
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.statusBadgePill,
                      bankBadgeVariant === 'approved'
                        ? styles.badgeApproved
                        : bankBadgeVariant === 'ready'
                          ? styles.badgeReady
                          : styles.badgePending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        bankBadgeVariant === 'approved'
                          ? styles.badgeTextApproved
                          : bankBadgeVariant === 'ready'
                            ? styles.badgeTextReady
                            : styles.badgeTextPending,
                      ]}
                    >
                      {bankBadgeLabel}
                    </Text>
                  </View>
                </View>
              </View>

              {isBankLocked && (
                <View style={styles.lockBanner}>
                  <View style={styles.bannerRow}>
                    <Text style={styles.bannerIcon}>🔒</Text>
                    <View style={styles.bannerTextCol}>
                      <Text style={styles.lockBannerTitle}>Bank & PAN Details Approved & Locked</Text>
                      <Text style={styles.lockBannerText}>
                        Your bank details and PAN KYC have been verified and approved by Tomato Admin. For security, bank details are{' '}
                        <Text style={styles.lockBannerBold}>non-editable once approved</Text>. If you need to update your bank account, please raise a request to Admin via Help & Support.
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {!isBankLocked && (
                <View style={styles.pendingBanner}>
                  <View style={styles.bannerRow}>
                    <Text style={styles.bannerIcon}>⚠️</Text>
                    <View style={styles.bannerTextCol}>
                      <Text style={styles.pendingBannerTitle}>Mandatory for Partner Approval & Payouts</Text>
                      <Text style={styles.pendingBannerText}>
                        Please submit accurate bank account and PAN details. Order payouts will not be processed without approved bank details. The{' '}
                        <Text style={styles.pendingBannerBold}>Account Holder Name must match your PAN</Text>.
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.agreementStrip}>
                <View style={styles.agreementStripLeft}>
                  <Text style={styles.agreementStripEyebrow}>TOMATO PAYOUT AGREEMENT</Text>
                  <Text style={styles.agreementStripMain}>
                    Tomato Platform Commission Agreement:{' '}
                    <Text style={styles.agreementStripBold}>{agreementCommission}%</Text> (Remaining order amount settled to your bank account)
                  </Text>
                </View>
                {Boolean(agreementFssai) && (
                  <Text style={styles.agreementStripNote}>FSSAI No. : {agreementFssai}</Text>
                )}
              </View>

              <View style={styles.bankFormContainer}>
                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>Bank Account Holder Name *</Text>
                  <TextInput
                    style={[styles.input, isBankLocked && styles.inputLocked]}
                    value={bankForm.accountHolderName}
                    editable={!isBankLocked}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, accountHolderName: val }))}
                    placeholder="Exact name as per bank passbook/cheque"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>Name on PAN Card *</Text>
                  <TextInput
                    style={[styles.input, isBankLocked && styles.inputLocked]}
                    value={bankForm.panHolderName}
                    editable={!isBankLocked}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, panHolderName: val }))}
                    placeholder="Exact name as printed on PAN card"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                {showNameMatch && (
                  <View
                    style={[
                      styles.nameMatchBox,
                      isNameMatched ? styles.nameMatchBoxSuccess : styles.nameMatchBoxError,
                    ]}
                  >
                    <Text
                      style={[
                        styles.nameMatchMsg,
                        isNameMatched ? styles.nameMatchMsgSuccess : styles.nameMatchMsgError,
                      ]}
                    >
                      {isNameMatched
                        ? '✅ Bank Account Holder Name matches Name on PAN Card.'
                        : '⚠️ Bank Account Holder Name MUST match Name on PAN Card for admin approval.'}
                    </Text>
                  </View>
                )}

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>PAN Card Number (10 Characters) *</Text>
                  <TextInput
                    style={[styles.input, styles.monoInput, isBankLocked && styles.inputLocked]}
                    value={bankForm.panNumber}
                    editable={!isBankLocked}
                    autoCapitalize="characters"
                    maxLength={10}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, panNumber: val.toUpperCase() }))}
                    placeholder="e.g. ABCDE1234F"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>Bank Name *</Text>
                  <TextInput
                    style={[styles.input, isBankLocked && styles.inputLocked]}
                    value={bankForm.bankName}
                    editable={!isBankLocked}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, bankName: val }))}
                    placeholder="e.g. HDFC Bank, SBI, ICICI Bank"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>Bank Account Number *</Text>
                  <TextInput
                    style={[styles.input, styles.monoInput, isBankLocked && styles.inputLocked]}
                    value={bankForm.accountNumber}
                    editable={!isBankLocked}
                    keyboardType="number-pad"
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, accountNumber: val }))}
                    placeholder="Enter bank account number"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>IFSC Code (11 Characters) *</Text>
                  <TextInput
                    style={[styles.input, styles.monoInput, isBankLocked && styles.inputLocked]}
                    value={bankForm.ifscCode}
                    editable={!isBankLocked}
                    autoCapitalize="characters"
                    maxLength={11}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, ifscCode: val.toUpperCase() }))}
                    placeholder="e.g. HDFC0001234"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>UPI ID (Optional for Instant Settlement)</Text>
                  <TextInput
                    style={[styles.input, isBankLocked && styles.inputLocked]}
                    value={bankForm.upiId}
                    editable={!isBankLocked}
                    autoCapitalize="none"
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, upiId: val }))}
                    placeholder="e.g. merchant@okaxis"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.fieldLabel}>
                    Agreement Note (FSSAI Registration Number & Expiry) *
                  </Text>
                  <TextInput
                    style={[styles.input, isBankLocked && styles.inputLocked]}
                    value={bankForm.adminNote}
                    editable={!isBankLocked}
                    onChangeText={(val) => setBankForm((cur) => ({ ...cur, adminNote: val }))}
                    placeholder="Shop and restaurant has to share FSSAI registration number and expiry (e.g. FSSAI: 11223344556677, Exp: 08/2028)"
                    placeholderTextColor="#9ca3af"
                  />
                  <Text style={styles.bankNoteHint}>
                    📌 Mandatory for Shop & Restaurant: Please enter your FSSAI Registration Number and Expiry Date.
                  </Text>
                </View>

                {!isBankLocked && (
                  <View style={styles.submitRow}>
                    <Pressable
                      style={[styles.primaryButton, busy === 'bank-details' && styles.disabledButton]}
                      disabled={busy === 'bank-details'}
                      onPress={() => void saveBankDetails()}
                    >
                      <Text style={styles.primaryText}>
                        {busy === 'bank-details' ? 'Saving...' : '💾 Submit Bank & PAN Details for Verification'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
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
  content: { paddingBottom: 24 },
  eyebrow: { color: '#d83a32', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 8 },
  title: { color: '#2d2621', fontSize: 23, fontWeight: '800', marginTop: 4, marginBottom: 10 },
  card: { backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, borderRadius: 15, padding: 14, marginBottom: 11 },
  cardTitle: { color: '#302923', fontSize: 14, fontWeight: '800', marginBottom: 5 },
  couponCreateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
    marginBottom: 8,
  },
  expandIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff0eb',
    borderWidth: 1,
    borderColor: '#fcdcd5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandIconText: {
    color: '#d83a32',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  input: { minHeight: 42, borderColor: '#eee3da', borderWidth: 1, backgroundColor: '#fffaf7', borderRadius: 10, paddingHorizontal: 11, color: '#302923', fontSize: 12, marginTop: 8 },
  muted: { color: '#82786f', fontSize: 12, lineHeight: 18, marginTop: 4 },
  error: { color: '#b42318', backgroundColor: '#fff1f0', padding: 10, borderRadius: 9, marginBottom: 8 },
  loader: { marginTop: 25 },
  metrics: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  metric: { flex: 1, borderRadius: 12, backgroundColor: '#fff', borderColor: '#eee5dd', borderWidth: 1, padding: 12 },
  metricValue: { color: '#d83a32', fontSize: 18, fontWeight: '800' },
  metricLabel: { color: '#766d68', fontSize: 10, marginTop: 4, textTransform: 'capitalize' },
  metricLabelPlain: { textTransform: 'none' },
  primaryButton: { minHeight: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: '#d83a32', borderRadius: 10, paddingHorizontal: 12, marginTop: 10 },
  disabledButton: { opacity: 0.65 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  secondaryButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff1ed', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, marginTop: 7 },
  secondaryText: { color: '#c2352d', fontWeight: '800', fontSize: 11 },
  dangerButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fae7e4', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, marginTop: 7 },
  dangerText: { color: '#a9241c', fontSize: 11, fontWeight: '800' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 5 },
  status: { color: '#27734a', backgroundColor: '#e9f6ee', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  infoLabel: { color: '#82786f', fontSize: 11 },
  infoValue: { color: '#302923', fontSize: 11, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  notice: { color: '#81551f', fontSize: 11, marginTop: 6 },
  payout: { borderTopColor: '#f0e8e1', borderTopWidth: 1, marginTop: 8, paddingTop: 6 },
  dropdownContainer: {
    marginTop: 8,
  },
  dropdownLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#766d68',
    marginBottom: 4,
  },
  dropdownTrigger: {
    minHeight: 42,
    borderColor: '#eee3da',
    borderWidth: 1,
    backgroundColor: '#fffaf7',
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dropdownTriggerIcon: {
    fontSize: 16,
  },
  dropdownTriggerText: {
    color: '#302923',
    fontSize: 12,
    fontWeight: '700',
  },
  dropdownArrow: {
    color: '#82786f',
    fontSize: 11,
  },
  dropdownMenu: {
    backgroundColor: '#ffffff',
    borderColor: '#fcdcd5',
    borderWidth: 1.5,
    borderRadius: 12,
    marginTop: 4,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  dropdownOptionActive: {
    backgroundColor: '#fff0eb',
  },
  dropdownOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownOptionIcon: {
    fontSize: 18,
  },
  dropdownOptionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#302923',
  },
  dropdownOptionTitleActive: {
    color: '#d83a32',
    fontWeight: '800',
  },
  dropdownOptionSub: {
    fontSize: 10,
    color: '#82786f',
    marginTop: 1,
  },
  dropdownCheck: {
    color: '#d83a32',
    fontSize: 14,
    fontWeight: '800',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#f3e8df',
    marginVertical: 4,
  },
  ledgerSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#302923',
    marginTop: 10,
    marginBottom: 8,
  },
  flex: { flex: 1 },
  webPanelCard: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  webPanelHeader: {
    marginBottom: 14,
  },
  webPanelTitleBlock: {
    marginBottom: 6,
  },
  webPanelTitle: {
    color: '#0f172a',
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  webPanelSubtitle: {
    color: '#64748b',
    fontSize: 12.5,
    lineHeight: 18,
  },
  webPanelSubtitleBold: {
    fontWeight: '700',
    color: '#334155',
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 6,
    marginBottom: 2,
  },
  statusBadgePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeApproved: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  badgeReady: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  badgePending: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  statusBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  badgeTextApproved: {
    color: '#166534',
  },
  badgeTextReady: {
    color: '#1e40af',
  },
  badgeTextPending: {
    color: '#92400e',
  },
  lockBanner: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  pendingBanner: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bannerIcon: {
    fontSize: 18,
    marginRight: 10,
    marginTop: 1,
  },
  bannerTextCol: {
    flex: 1,
  },
  lockBannerTitle: {
    color: '#14532d',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 3,
  },
  lockBannerText: {
    color: '#14532d',
    fontSize: 11.5,
    lineHeight: 16,
  },
  lockBannerBold: {
    fontWeight: '700',
  },
  pendingBannerTitle: {
    color: '#92400e',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 3,
  },
  pendingBannerText: {
    color: '#92400e',
    fontSize: 11.5,
    lineHeight: 16,
  },
  pendingBannerBold: {
    fontWeight: '700',
  },
  agreementStrip: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  agreementStripLeft: {
    marginBottom: 4,
  },
  agreementStripEyebrow: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  agreementStripMain: {
    color: '#1e293b',
    fontSize: 12.5,
    lineHeight: 18,
  },
  agreementStripBold: {
    fontWeight: '800',
    color: '#0f172a',
  },
  agreementStripNote: {
    color: '#64748b',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 4,
  },
  bankFormContainer: {
    marginTop: 2,
  },
  formGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 2,
  },
  monoInput: {
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  inputLocked: {
    backgroundColor: '#f1f5f9',
    color: '#64748b',
    borderColor: '#cbd5e1',
  },
  nameMatchBox: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    borderWidth: 1,
  },
  nameMatchBoxSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  nameMatchBoxError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  nameMatchMsg: {
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
  },
  nameMatchMsgSuccess: {
    color: '#15803d',
  },
  nameMatchMsgError: {
    color: '#dc2626',
  },
  bankNoteHint: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    lineHeight: 15,
  },
  submitRow: {
    marginTop: 6,
    marginBottom: 6,
  },
});
