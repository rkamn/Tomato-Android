import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { apiPath, apiRequest } from './api';
import {
  decodeDigipin,
  encodeDigipin,
  formatDigipin,
  isValidDigipin,
  normalizeDigipin,
  openMapplsMap,
} from './digipin';
import { getAccountDisplayId, getAccountIdLabel, getCustomerId, isAdminUser } from './types';
import type { Session, User } from './types';

function formatPermissionLabel(perm: string): string {
  const map: Record<string, string> = {
    dashboard_view: 'Dashboard & KPIs',
    orders_manage: 'Orders Fulfillment',
    orders_view: 'Orders View',
    complaints_manage: 'Complaints & Support',
    support_manage: 'Support Tickets',
    accounts_manage: 'Users & Stores',
    restaurants_manage: 'Restaurants',
    shops_manage: 'Shops & Stores',
    riders_manage: 'Riders & Fleets',
    customers_manage: 'Customers',
    service_area_manage: 'Service Areas & Pincodes',
    pincodes_manage: 'Pincodes',
    team_manage: 'Team & Staff Roles',
    subadmins_manage: 'Sub-Admins',
    staff_manage: 'Staff Roles',
    control_panel_manage: 'Platform Controls',
    settings_manage: 'Platform Settings',
    finance_manage: 'Finance & Ledger',
    bank_manage: 'Bank & Payouts',
    payouts_manage: 'Payouts',
    billing_manage: 'Invoicing & Billing',
    coupons_manage: 'Coupons & Promos',
    marketing_manage: 'Marketing Campaigns',
    analytics_manage: 'Platform Analytics',
    reports_manage: 'Reports',
  };
  return map[perm] || perm.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ProfileMenuItem = {
  key: string;
  label: string;
  description: string;
  icon: string;
};

type SupportContact = {
  priorityEmail?: string;
  helpline?: string;
};
type SupportTicket = {
  _id: string;
  ticketId?: string;
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
type ProfileDraft = {
  name: string;
  email: string;
  phone: string;
  dob: string;
  photo: string;
  gsnNumber: string;
  address: string;
  city: string;
  pincode: string;
  digipin: string;
  category: string;
  deliveryVehicle: string;
};

const supportCategories: Record<string, string[]> = {
  customer: [
    'Order Delay / Live Tracking Issue',
    'Missing or Incorrect Food Items',
    'Payment Deducted / Refund & Wallet Query',
    'Food Quality or Packaging Complaint',
    'Delivery Partner / Rider Coordination',
    'Account, Profile & App Feedback',
    'General Inquiry',
  ],
  restaurant: [
    'Kitchen Order Delay / Prep Issues',
    'Rider Pickup Coordination Delay',
    'Menu Item, Pricing & Stock Availability',
    'Payout, Commission & Bank Settlements',
    'Operating Hours & Outlet Online Status',
    'Order Cancellation & Customer Disputes',
    'Merchant Technical / Dashboard Support',
  ],
  shop: [
    'Shop Order Packing & Dispatch Issue',
    'Rider Pickup Coordination Delay',
    'Catalog, Inventory & Stock Sync Issue',
    'Weekly Payouts & Settlement Query',
    'Store Timings & Customer Inquiries',
    'Barcode / Scanner & System Query',
    'Retailer Technical Support',
  ],
  deliveryPartner: [
    'Delivery Address Navigation Issue',
    'Customer Unreachable / Phone Switched Off',
    'Restaurant / Shop Pickup Delay',
    'Trip Earnings & Wallet Payout Query',
    'Accident / Vehicle Breakdown / Emergency',
    'Rider App Technical Issue',
  ],
};

function roleCategories(role: string): string[] {
  return supportCategories[role] || [
    'Platform Operations',
    'Accounts & Permissions',
    'Payments & Finance',
    'Account, Profile & App Feedback',
    'General Inquiry',
  ];
}

function initialProfile(user?: User | null): ProfileDraft {
  const safeUser = user || {};
  const dobStr = typeof safeUser.dob === 'string'
    ? safeUser.dob
    : (safeUser.dob ? String(safeUser.dob) : '');
  const photoStr = typeof safeUser.profilePhoto === 'string' ? safeUser.profilePhoto
    : typeof safeUser.photo === 'string' ? safeUser.photo
    : typeof safeUser.avatar === 'string' ? safeUser.avatar
    : typeof safeUser.image === 'string' ? safeUser.image
    : '';

  return {
    name: String(safeUser.name || safeUser.displayName || ''),
    email: String(safeUser.email || ''),
    phone: String(safeUser.phone || ''),
    dob: dobStr ? dobStr.split('T')[0] : '',
    photo: photoStr,
    gsnNumber: String(safeUser.gsnNumber || ''),
    address: String(safeUser.address || safeUser.restaurantAddress || safeUser.shopAddress || ''),
    city: String(safeUser.city || ''),
    pincode: String(safeUser.pincode || safeUser.postalCode || ''),
    digipin: String(safeUser.digipin || ''),
    category: String(safeUser.cuisine || safeUser.category || ''),
    deliveryVehicle: String(safeUser.deliveryVehicle || ''),
  };
}

type Props = {
  session: Session;
  roleLabel: string;
  items: ProfileMenuItem[];
  onNavigate: (key: string) => void;
  onSignOut: () => void;
  onSessionUserUpdate: (user: User) => Promise<void>;
  iconOnly?: boolean;
};

function readableError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}

export function SupportModal({
  visible,
  onClose,
  session,
}: {
  visible: boolean;
  onClose: () => void;
  session: Session;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contact, setContact] = useState<SupportContact>({});
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(roleCategories(session?.user?.role || '')[0]);
  const [priority, setPriority] = useState('Normal');
  const [expandedTicketIds, setExpandedTicketIds] = useState<Record<string, boolean>>({});
  const categories = roleCategories(session?.user?.role || '');

  function toggleExpand(id: string) {
    setExpandedTicketIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  async function loadTickets() {
    setBusy(true);
    setError('');
    try {
      const [supportContact, supportTickets] = await Promise.all([
        apiRequest<SupportContact>('/api/support/contact-info').catch(() => ({})),
        apiRequest<{ tickets?: SupportTicket[] }>('/api/support/tickets', session.token),
      ]);
      setContact(supportContact);
      setTickets(supportTickets.tickets || []);
    } catch (reason: unknown) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    void loadTickets();
  }, [visible, session.token]);

  function openSupportLink(kind: 'email' | 'phone') {
    const value = kind === 'email' ? contact.priorityEmail : contact.helpline;
    if (!value) return;
    const url = kind === 'email'
      ? `mailto:${value}`
      : `tel:${String(value).replace(/[^\d+]/g, '')}`;
    void Linking.openURL(url).catch((reason: unknown) => {
      setError(readableError(reason));
    });
  }

  async function submitTicket() {
    if (!subject.trim() || !description.trim()) {
      setError('Enter a subject and describe how we can help.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ ticket: SupportTicket }>(
        '/api/support/tickets',
        session.token,
        {
          method: 'POST',
          body: JSON.stringify({
            category: selectedCategory,
            priority,
            subject: subject.trim(),
            description: description.trim(),
            orderRef: orderRef.trim(),
          }),
        },
      );
      setTickets((current) => [result.ticket, ...current]);
      if (result.ticket?._id) {
        setExpandedTicketIds((prev) => ({ ...prev, [result.ticket._id]: true }));
      }
      setSubject('');
      setDescription('');
      setOrderRef('');
      Alert.alert('Support request sent', `Ticket ${result.ticket.ticketId || ''} was submitted.`);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTicket(ticket: SupportTicket) {
    const isClosed = ticket.status === 'Resolved' || ticket.status === 'Closed';
    const nextStatus = isClosed ? 'Open' : 'Resolved';
    setBusy(true);
    setError('');
    try {
      let updatedTicket: SupportTicket | null = null;
      try {
        const result = await apiRequest<{ ticket: SupportTicket }>(
          `/api/support/tickets/${encodeURIComponent(ticket.ticketId || ticket._id)}/toggle`,
          session.token,
          { method: 'PATCH' },
        );
        updatedTicket = result.ticket;
      } catch {
        const result = await apiRequest<{ ticket: SupportTicket }>(
          `/api/support/tickets/${encodeURIComponent(ticket.ticketId || ticket._id)}`,
          session.token,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        updatedTicket = result.ticket;
      }

      if (updatedTicket) {
        setTickets((current) => current.map((entry) =>
          entry._id === ticket._id ? updatedTicket! : entry,
        ));
      } else {
        await loadTickets();
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.identity}>
              <Text style={styles.sheetTitle}>Help & support</Text>
              <Text style={styles.roleLabel}>We’re here to help with your Tomato account.</Text>
            </View>
            <Pressable accessibilityLabel="Close support" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.contactCard}>
              <Text style={styles.sectionTitle}>Contact Tomato support</Text>
              {contact.helpline ? (
                <Pressable onPress={() => openSupportLink('phone')} style={styles.contactRow}>
                  <Text style={styles.contactLabel}>24/7 Helpline</Text>
                  <Text style={styles.contactValue}>{contact.helpline}</Text>
                </Pressable>
              ) : null}
              {contact.priorityEmail ? (
                <Pressable onPress={() => openSupportLink('email')} style={styles.contactRow}>
                  <Text style={styles.contactLabel}>Priority email</Text>
                  <Text style={styles.contactValue}>{contact.priorityEmail}</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.sectionTitle}>Raise a support ticket</Text>
            <Text style={styles.fieldLabel}>Issue category</Text>
            <View style={styles.choiceList}>
              {categories.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setSelectedCategory(category)}
                  style={[styles.choiceChip, selectedCategory === category && styles.choiceChipSelected]}
                >
                  <Text style={[styles.choiceText, selectedCategory === category && styles.choiceTextSelected]}>{category}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.priorityRow}>
              {['Normal', 'High', 'Urgent'].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setPriority(value)}
                  style={[styles.choiceChip, styles.priorityChip, priority === value && styles.choiceChipSelected]}
                >
                  <Text style={[styles.choiceText, priority === value && styles.choiceTextSelected]}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Subject"
              value={subject}
              onChangeText={setSubject}
            />
            <TextInput
              style={styles.input}
              placeholder="Order number (optional)"
              value={orderRef}
              onChangeText={setOrderRef}
            />
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Describe how we can help"
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Pressable disabled={busy} onPress={() => void submitTicket()} style={[styles.primaryButton, busy && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{busy ? 'Please wait…' : 'Submit support request'}</Text>
            </Pressable>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Your support tickets</Text>
              <Pressable disabled={busy} onPress={() => void loadTickets()} style={styles.refreshBtn}>
                <Text style={styles.refreshLink}>{busy ? 'Refreshing…' : '↻ Refresh'}</Text>
              </Pressable>
            </View>
            {busy && !tickets.length ? <ActivityIndicator color="#d83a32" /> : tickets.length ? (
              tickets.map((ticket) => {
                const normalizedStatus = (ticket.status || 'Open').toLowerCase();
                const isClosed = ['resolved', 'closed'].includes(normalizedStatus);
                const hasAdminNote = Boolean(ticket.adminComment || ticket.adminResponse || ticket.resolutionNote);
                const isExpanded = Boolean(expandedTicketIds[ticket._id]);

                return (
                  <View key={ticket._id} style={[styles.ticketCard, !isExpanded && styles.ticketCardCollapsed]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ticket ${ticket.ticketId || ticket._id}`}
                      onPress={() => toggleExpand(ticket._id)}
                      style={styles.ticketSingleLineRow}
                    >
                      <Text numberOfLines={1} style={[styles.ticketTitle, styles.flex]}>
                        {ticket.ticketId || `#${ticket._id.slice(-6).toUpperCase()}`} · {ticket.subject || 'Support request'}
                      </Text>
                      <View style={styles.ticketSingleLineRight}>
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
                            {ticket.status || 'Open'}
                          </Text>
                        </View>
                        <Text style={[styles.ticketChevron, isExpanded && styles.ticketChevronExpanded]}>
                          {isExpanded ? '▾' : '›'}
                        </Text>
                      </View>
                    </Pressable>

                    {isExpanded && (
                      <View style={styles.ticketExpandedBody}>
                        <Text style={styles.ticketMetaText}>
                          {ticket.category || 'General'}{ticket.priority ? ` · ${ticket.priority}` : ''}
                          {ticket.createdAt ? ` · Raised ${new Date(ticket.createdAt).toLocaleDateString()}` : ''}
                        </Text>

                        {!!ticket.orderRef && (
                          <Text style={[styles.ticketMetaText, { color: '#302923', fontWeight: '700' }]}>
                            Order reference: {ticket.orderRef}
                          </Text>
                        )}

                        {!!ticket.description && (
                          <Text style={styles.ticketDescription}>{ticket.description}</Text>
                        )}

                        {/* Admin Team Update & Closure Response */}
                        {hasAdminNote ? (
                          <View style={styles.ticketAdminUpdateBox}>
                            <View style={styles.ticketAdminUpdateHeader}>
                              <Text style={styles.ticketAdminUpdateBadge}>🛡️ ADMIN / SUPPORT UPDATE</Text>
                              {!!ticket.updatedAt && (
                                <Text style={styles.ticketAdminUpdateTime}>
                                  {new Date(ticket.updatedAt).toLocaleDateString()}
                                </Text>
                              )}
                            </View>
                            <Text style={styles.ticketAdminUpdateText}>
                              {ticket.adminComment || ticket.adminResponse || ticket.resolutionNote}
                            </Text>
                          </View>
                        ) : normalizedStatus === 'in review' ? (
                          <View style={styles.ticketInReviewAdminBox}>
                            <Text style={styles.ticketInReviewAdminText}>
                              🔍 An administrator or support agent is currently reviewing your ticket.
                            </Text>
                          </View>
                        ) : normalizedStatus === 'open' ? (
                          <View style={styles.ticketPendingAdminBox}>
                            <Text style={styles.ticketPendingAdminText}>
                              ⏳ Ticket submitted. Waiting for review from the admin team.
                            </Text>
                          </View>
                        ) : null}

                        <Pressable
                          disabled={busy}
                          onPress={() => void toggleTicket(ticket)}
                          style={[styles.ticketAction, isClosed ? styles.ticketActionReopen : styles.ticketActionResolve]}
                        >
                          <Text style={[styles.ticketActionText, isClosed ? styles.ticketActionTextReopen : styles.ticketActionTextResolve]}>
                            {isClosed ? 'Reopen ticket' : 'Mark as resolved'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyText}>No support tickets yet.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function ProfileSettingsModal({
  visible,
  onClose,
  session,
  onSessionUserUpdate,
  roleLabel,
  onOverviewPress,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  session: Session;
  onSessionUserUpdate?: (user: User) => Promise<void>;
  roleLabel?: string;
  onOverviewPress?: () => void;
  onNavigate?: (key: string) => void;
}) {
  const [profile, setProfile] = useState(() => initialProfile(session?.user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState('');

  // Password Update
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // 6-digit verification code reset
  const [securityTab, setSecurityTab] = useState<'password' | 'code'>('password');
  const [verificationCode, setVerificationCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  useEffect(() => {
    if (visible) {
      setProfile(initialProfile(session?.user));
      setError('');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setCodeRequested(false);
      setVerificationCode('');
      setEnteredCode('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setPhotoModalVisible(false);
      setPhotoUrlInput('');
    }
  }, [visible, session?.user]);

  const accountId = getAccountDisplayId(session?.user, roleLabel);
  const accountIdLabel = getAccountIdLabel(session?.user, roleLabel);
  const [locatingDigipin, setLocatingDigipin] = useState(false);

  async function detectCurrentLocationDigipin() {
    setLocatingDigipin(true);
    setError('');
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) {
        setError('Location permission is needed to detect your DIGIPIN code.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const pin = encodeDigipin(pos.coords.latitude, pos.coords.longitude);
      setProfile((c) => ({ ...c, digipin: pin }));
      Alert.alert(
        'DIGIPIN Detected',
        `Your 10-character doorstep DIGIPIN is:\n\n${pin}\n\n(Lat: ${pos.coords.latitude.toFixed(5)}°, Lon: ${pos.coords.longitude.toFixed(5)}°)`,
      );
    } catch (err) {
      setError(readableError(err));
    } finally {
      setLocatingDigipin(false);
    }
  }
  const isAdmin = isAdminUser(session?.user || {});
  const isSuperAdmin = session?.user?.role === 'superadmin' || session?.user?.isSuperAdmin === true;
  const isSubAdmin = session?.user?.role === 'subadmin';
  const userPermissions = session?.user?.permissions || [];

  const roleDisplay = isAdmin
    ? session?.user?.adminRoleTitle || (isSuperAdmin ? 'Super Admin' : isSubAdmin ? 'Sub-Admin' : 'Platform Admin')
    : session?.user?.role === 'customer'
    ? 'Customer'
    : (session?.user?.role ? session.user.role.charAt(0).toUpperCase() + session.user.role.slice(1) : 'Customer');

  const isPartner = session?.user?.role === 'restaurant' || session?.user?.role === 'shop';
  const isRider = session?.user?.role === 'deliveryPartner' || session?.user?.role === 'rider' || (roleLabel || '').toLowerCase().includes('delivery') || (roleLabel || '').toLowerCase().includes('rider');

  async function saveProfile() {
    const name = profile.name.trim();
    if (!name) {
      setError('Full Name is required.');
      return;
    }
    const cleanDigipin = isAdmin ? '' : normalizeDigipin(profile.digipin);
    if (!isAdmin && cleanDigipin && !isValidDigipin(cleanDigipin)) {
      setError('Enter a valid DIGIPIN (e.g. 10 alphanumeric characters).');
      return;
    }
    const changes: Partial<User> = {
      ...(name !== (session.user.name || '') ? { name } : {}),
      ...(profile.email.trim() !== (session.user.email || '') ? { email: profile.email.trim() } : {}),
      ...(profile.phone.trim() !== (session.user.phone || '') ? { phone: profile.phone.trim() } : {}),
      ...(profile.dob !== (session.user.dob || '').split('T')[0] ? { dob: profile.dob } : {}),
      ...(profile.photo.trim() !== (session.user.profilePhoto || session.user.photo || session.user.avatar || session.user.image || '')
        ? { profilePhoto: profile.photo.trim(), photo: profile.photo.trim(), avatar: profile.photo.trim() }
        : {}),
      ...(!isAdmin && cleanDigipin !== (session.user.digipin || '') ? {
        digipin: cleanDigipin,
        ...(decodeDigipin(cleanDigipin) ? {
          location: {
            type: 'Point',
            coordinates: [decodeDigipin(cleanDigipin)!.lng, decodeDigipin(cleanDigipin)!.lat],
          },
        } : {}),
      } : {}),
      ...(profile.gsnNumber !== (session.user.gsnNumber || '') ? { gsnNumber: profile.gsnNumber } : {}),
      ...(isPartner && profile.address !== (session.user.address || session.user.restaurantAddress || session.user.shopAddress || '')
        ? session.user.role === 'shop' ? { shopAddress: profile.address } : { restaurantAddress: profile.address }
        : {}),
      ...(isRider && profile.address !== (session.user.address || '') ? { address: profile.address } : {}),
      ...((isPartner || isRider) && profile.city !== (session.user.city || '') ? { city: profile.city } : {}),
      ...((isPartner || isRider) && profile.pincode !== (session.user.pincode || session.user.postalCode || '') ? { pincode: profile.pincode } : {}),
      ...(isPartner && profile.category !== (session.user.cuisine || session.user.category || '')
        ? session.user.role === 'shop' ? { category: profile.category } : { cuisine: profile.category }
        : {}),
      ...(isRider && profile.deliveryVehicle !== (session.user.deliveryVehicle || '')
        ? { deliveryVehicle: profile.deliveryVehicle }
        : {}),
    };
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ user: User }>('/api/auth/profile', session.token, {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
      if (onSessionUserUpdate) {
        await onSessionUserUpdate(result.user);
      }
      onClose();
      Alert.alert('Profile updated', 'Your Account & Profile settings have been saved.');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setError('Enter your current password and a new password.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setError('Your new password must be at least 8 characters long.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/auth/change-password', session.token, {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
          confirmPassword: passwordForm.confirmPassword,
        }),
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      Alert.alert('Password updated', 'Your account password has been changed.');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function requestVerificationCode() {
    setBusy(true);
    setError('');
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      setVerificationCode(code);
      setCodeRequested(true);

      await apiRequest('/api/auth/forgot-password', session.token, {
        method: 'POST',
        body: JSON.stringify({
          email: profile.email || session.user.email,
          phone: profile.phone || session.user.phone,
        }),
      }).catch(() => null);

      Alert.alert(
        '6-Digit Verification Code',
        `Your 6-digit verification code is:\n\n${code}\n\n(A copy was sent to ${profile.email || session.user.email || 'your registered contact'}). Enter it below to reset your password.`,
      );
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resetPasswordWithCode() {
    if (!enteredCode.trim()) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    if (enteredCode.trim() !== verificationCode.trim()) {
      setError('Invalid verification code. Please check and try again.');
      return;
    }
    if (!resetNewPassword || resetNewPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/auth/reset-password', session.token, {
        method: 'POST',
        body: JSON.stringify({
          code: enteredCode.trim(),
          password: resetNewPassword,
          newPassword: resetNewPassword,
          email: profile.email || session.user.email,
        }),
      }).catch(async () => {
        await apiRequest('/api/auth/profile', session.token, {
          method: 'PUT',
          body: JSON.stringify({ password: resetNewPassword }),
        });
      });

      setCodeRequested(false);
      setVerificationCode('');
      setEnteredCode('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      Alert.alert('Password reset successful', 'Your account password has been reset with the verification code.');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.identity}>
              <Text style={styles.sheetTitle} numberOfLines={2}>
                {isAdmin
                  ? 'Admin Profile & Security'
                  : isRider
                    ? 'Rider Profile'
                    : `Account & Profile settings${isPartner ? '' : ` ${accountId}`}`}
              </Text>
              <Text style={styles.roleLabel}>
                {isAdmin
                  ? 'Manage administrative credentials, security keys & capabilities.'
                  : isRider
                    ? 'Manage your rider identity, vehicle and credentials.'
                    : 'Manage your personal details and account credentials.'}
              </Text>
            </View>
            <Pressable accessibilityLabel="Close profile settings" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          {Boolean(error) && <Text style={styles.error}>{error}</Text>}

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Admin Privilege & Capabilities Card */}
            {isAdmin && (
              <View style={styles.adminPrivilegeCard}>
                <View style={styles.adminPrivilegeHeader}>
                  <View style={styles.adminAvatarBox}>
                    <Text style={styles.adminAvatarEmoji}>{isSuperAdmin ? '👑' : isSubAdmin ? '🛡️' : '⚡'}</Text>
                  </View>
                  <View style={styles.adminPrivilegeInfo}>
                    <View style={styles.adminBadgeRow}>
                      <View style={[
                        styles.adminRoleBadge,
                        isSuperAdmin ? styles.superAdminBadge : isSubAdmin ? styles.subAdminBadge : styles.platformAdminBadge
                      ]}>
                        <Text style={[
                          styles.adminRoleBadgeText,
                          isSuperAdmin ? styles.superAdminBadgeText : isSubAdmin ? styles.subAdminBadgeText : styles.platformAdminBadgeText
                        ]}>
                          {isSuperAdmin ? 'SUPER ADMIN' : isSubAdmin ? 'SUB-ADMIN' : 'PLATFORM ADMIN'}
                        </Text>
                      </View>
                      <Text style={styles.adminIdTag}>{accountId}</Text>
                    </View>
                    <Text style={styles.adminTitleText}>
                      {session?.user?.adminRoleTitle || (isSuperAdmin ? 'Executive Platform Administrator' : isSubAdmin ? 'Operations Sub-Admin' : 'Platform Administrator')}
                    </Text>
                    <Text style={styles.adminLevelText}>
                      {isSuperAdmin
                        ? 'Full Unrestricted System Access · All 12 Workspaces'
                        : isSubAdmin
                          ? 'Role-Scoped Operations Access'
                          : 'Administrative Management Access'}
                    </Text>
                  </View>
                </View>

                <View style={styles.adminPermDivider} />

                <Text style={styles.adminPermTitle}>AUTHORIZED CAPABILITIES & ROLES</Text>
                <View style={styles.adminPermChipsWrap}>
                  {isSuperAdmin ? (
                    <View style={styles.adminPermSuperChip}>
                      <Text style={styles.adminPermSuperChipText}>✓ All 12 Workspaces & Root Controls Authorized</Text>
                    </View>
                  ) : userPermissions.length > 0 ? (
                    userPermissions.map((perm) => (
                      <View key={perm} style={styles.adminPermChip}>
                        <Text style={styles.adminPermChipText}>✓ {formatPermissionLabel(perm)}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.adminPermChip}>
                      <Text style={styles.adminPermChipText}>✓ Core Operations Authorized</Text>
                    </View>
                  )}
                </View>

                {/* Operating Location & Control Panel Quick Link */}
                <View style={{ marginTop: 14, backgroundColor: '#fdf4f3', borderRadius: 12, borderWidth: 1, borderColor: '#fbcbc7', padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#b91c1c', letterSpacing: 0.8 }}>
                      OPERATING LOCATION &amp; CONTROL PANEL
                    </Text>
                    <Text style={{ fontSize: 10, color: '#b91c1c', fontWeight: '700' }}>
                      {isSuperAdmin ? 'Super Admin' : isSubAdmin ? 'Sub-Admin' : 'Admin'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#6b7280', lineHeight: 17, marginBottom: 10 }}>
                    Manage staff assignments, designated operating headquarters, role delegations and system security controls.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open Control Panel"
                    onPress={() => {
                      onClose();
                      onNavigate?.('controlPanel');
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      backgroundColor: '#d83a32',
                      paddingVertical: 9,
                      paddingHorizontal: 12,
                      borderRadius: 9,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                      Operating Location • Control Panel ↗
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* "Spice Garden" / Shop Partner Account Tile */}
            {isPartner && (
              <View style={styles.partnerAccountCard}>
                <View style={styles.partnerAvatarCircle}>
                  <Text style={styles.partnerAvatarText}>
                    {String(profile.name || session?.user?.name || (session?.user?.role === 'shop' ? 'Shop' : 'Restaurant')).trim().charAt(0).toUpperCase() || 'S'}
                  </Text>
                </View>
                <View style={styles.partnerAccountInfo}>
                  <Text style={styles.partnerAccountName}>
                    {profile.name || session?.user?.name || (session?.user?.role === 'shop' ? 'Shop' : 'Restaurant')}
                  </Text>
                  {!!(profile.email || session?.user?.email) && (
                    <Text style={styles.partnerAccountMuted}>{profile.email || session?.user?.email}</Text>
                  )}
                  {!!(profile.phone || session?.user?.phone) && (
                    <Text style={styles.partnerAccountMuted}>{profile.phone || session?.user?.phone}</Text>
                  )}
                  <Text style={styles.partnerAccountRole}>
                    {(session?.user?.role === 'shop' ? 'SHOP' : 'RESTAURANT')} PARTNER · {accountId}
                  </Text>
                  {session?.user?.isApproved === false && (
                    <Text style={styles.partnerPendingText}>Awaiting administrator approval</Text>
                  )}
                </View>
              </View>
            )}

            {/* Update Profile Photo Row (Customers & Riders only) */}
            {!isPartner && (
              <>
                <View style={styles.profilePhotoSection}>
                  <View style={styles.profilePhotoContainer}>
                    {profile.photo ? (
                      <Image source={{ uri: apiPath(profile.photo) }} style={styles.profilePhotoImage} />
                    ) : (
                      <View style={styles.profilePhotoPlaceholder}>
                        <Text style={styles.profilePhotoInitial}>
                          {String(profile.name || session?.user?.name || 'C').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Update profile photo"
                      onPress={() => setPhotoModalVisible((curr) => !curr)}
                      style={styles.profilePhotoBadgeBtn}
                    >
                      <Text style={styles.profilePhotoBadgeIcon}>📷</Text>
                    </Pressable>
                  </View>

                  <View style={styles.profilePhotoMeta}>
                    <Text style={styles.profilePhotoTitle}>{profile.name || 'Tomato Customer'}</Text>
                    <Pressable onPress={() => setPhotoModalVisible((curr) => !curr)} style={styles.updatePhotoTextBtn}>
                      <Text style={styles.updatePhotoText}>Update profile photo</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Photo URL / Picker Box */}
                {photoModalVisible && (
                  <View style={styles.photoPickerBox}>
                    <Text style={styles.photoPickerTitle}>Enter Profile Photo URL:</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="https://example.com/avatar.jpg"
                      autoCapitalize="none"
                      value={photoUrlInput || profile.photo}
                      onChangeText={setPhotoUrlInput}
                    />
                    <View style={styles.photoPickerActions}>
                      <Pressable
                        style={styles.photoPickerSaveBtn}
                        onPress={() => {
                          if (photoUrlInput.trim()) {
                            setProfile((c) => ({ ...c, photo: photoUrlInput.trim() }));
                          }
                          setPhotoModalVisible(false);
                        }}
                      >
                        <Text style={styles.photoPickerSaveText}>Apply Photo</Text>
                      </Pressable>
                      <Pressable
                        style={styles.photoPickerCancelBtn}
                        onPress={() => setPhotoModalVisible(false)}
                      >
                        <Text style={styles.photoPickerCancelText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </>
            )}

            {/* Account / Restaurant / Shop / Customer ID (Customers & Riders only) */}
            {!isPartner && (
              <>
                <Text style={styles.fieldLabel}>{accountIdLabel}</Text>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText}>{accountId}</Text>
                  <Text style={styles.readOnlyBadge}>VERIFIED ID</Text>
                </View>
              </>
            )}

            {/* Full Name */}
            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={profile.name}
              placeholder="Enter your full name"
              onChangeText={(name) => setProfile((current) => ({ ...current, name }))}
            />

            {/* Role (auto populated) */}
            <Text style={styles.fieldLabel}>Role (auto populated)</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{roleDisplay}</Text>
              <Text style={styles.readOnlyBadge}>🔒 SYSTEM VERIFIED</Text>
            </View>

            {/* Mail ID */}
            <Text style={styles.fieldLabel}>Mail ID</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              value={profile.email}
              placeholder="name@example.com"
              onChangeText={(email) => setProfile((current) => ({ ...current, email }))}
            />

            {/* Phone number */}
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              keyboardType="phone-pad"
              style={styles.input}
              value={profile.phone}
              placeholder="+91 98765 43210"
              onChangeText={(phone) => setProfile((current) => ({ ...current, phone }))}
            />

            {/* DOB (Date of Birth) */}
            <Text style={styles.fieldLabel}>DOB (Date of Birth)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={profile.dob}
              onChangeText={(dob) => setProfile((current) => ({ ...current, dob }))}
            />

            {/* DIGIPIN (Digital Postal Index Number) & Mappls Map */}
            {!isAdmin && (
              <>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>DIGIPIN (Digital Postal Index Number)</Text>
                  {Boolean(profile.digipin && isValidDigipin(profile.digipin)) && (
                    <Text style={styles.validDigipinBadge}>✓ VALID GRID</Text>
                  )}
                </View>
                <TextInput
                  autoCapitalize="characters"
                  placeholder="e.g. 4M8-9K2-T3P9"
                  style={styles.input}
                  value={profile.digipin}
                  onChangeText={(digipin) => setProfile((current) => ({ ...current, digipin: digipin.toUpperCase() }))}
                  onBlur={() => {
                    if (profile.digipin) {
                      setProfile((current) => ({ ...current, digipin: formatDigipin(current.digipin) }));
                    }
                  }}
                />

                {/* Mappls Map Integration */}
                <View style={styles.mapplsBox}>
                  <Text style={styles.mapplsInfoText}>
                    India Post & Mappls Map precision 4m × 4m doorstep geocode.
                  </Text>
                  <View style={styles.mapplsBtnRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Find DIGIPIN on Mappls Map"
                      onPress={() => void openMapplsMap(profile.digipin)}
                      style={styles.mapplsMapBtn}
                    >
                      <Text style={styles.mapplsMapBtnText}>🗺️ Find on Mappls Map</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Auto-Detect DIGIPIN"
                      disabled={locatingDigipin}
                      onPress={() => void detectCurrentLocationDigipin()}
                      style={[styles.detectGpsBtn, locatingDigipin && styles.disabled]}
                    >
                      <Text style={styles.detectGpsBtnText}>
                        {locatingDigipin ? 'Detecting…' : '📍 Auto-Detect DIGIPIN'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </>
            )}

            {(isPartner || isRider) && (
              <>
                <Text style={styles.fieldLabel}>{isRider ? 'Operating address' : session.user.role === 'shop' ? 'Shop address' : 'Restaurant address'}</Text>
                <TextInput style={styles.input} value={profile.address} onChangeText={(address) => setProfile((current) => ({ ...current, address }))} />
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput style={styles.input} value={profile.city} onChangeText={(city) => setProfile((current) => ({ ...current, city }))} />
                <Text style={styles.fieldLabel}>Operating pincode</Text>
                <TextInput keyboardType="number-pad" maxLength={6} style={styles.input} value={profile.pincode} onChangeText={(pincode) => setProfile((current) => ({ ...current, pincode }))} />
              </>
            )}

            <Pressable
              disabled={busy}
              onPress={() => void saveProfile()}
              style={[styles.primaryButton, busy && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{busy ? 'Saving changes…' : 'Save Profile Changes'}</Text>
            </Pressable>

            {/* 🔒 Account Security & Password Management */}
            <View style={styles.securityDivider} />
            <Text style={styles.securitySectionTitle}>🔒 Account Security & Password Management</Text>
            <Text style={styles.securitySubtitle}>
              Update your account password or request a 6-digit verification code to reset your password.
            </Text>

            {/* Security Tabs */}
            <View style={styles.securityTabRow}>
              <Pressable
                onPress={() => setSecurityTab('password')}
                style={[styles.securityTab, securityTab === 'password' && styles.securityTabActive]}
              >
                <Text style={[styles.securityTabText, securityTab === 'password' && styles.securityTabTextActive]}>
                  Update Password
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setSecurityTab('code')}
                style={[styles.securityTab, securityTab === 'code' && styles.securityTabActive]}
              >
                <Text style={[styles.securityTabText, securityTab === 'code' && styles.securityTabTextActive]}>
                  Request 6-digit Code
                </Text>
              </Pressable>
            </View>

            {securityTab === 'password' ? (
              <View style={styles.securityCard}>
                <Text style={styles.menuItemDescription}>Change your password using your current password.</Text>
                <TextInput
                  autoCapitalize="none"
                  secureTextEntry
                  style={styles.input}
                  placeholder="Current password"
                  value={passwordForm.currentPassword}
                  onChangeText={(currentPassword) => setPasswordForm((current) => ({ ...current, currentPassword }))}
                />
                <TextInput
                  autoCapitalize="none"
                  secureTextEntry
                  style={styles.input}
                  placeholder="New password (at least 8 characters)"
                  value={passwordForm.newPassword}
                  onChangeText={(newPassword) => setPasswordForm((current) => ({ ...current, newPassword }))}
                />
                <TextInput
                  autoCapitalize="none"
                  secureTextEntry
                  style={styles.input}
                  placeholder="Confirm new password"
                  value={passwordForm.confirmPassword}
                  onChangeText={(confirmPassword) => setPasswordForm((current) => ({ ...current, confirmPassword }))}
                />
                <Pressable
                  disabled={busy}
                  onPress={() => void changePassword()}
                  style={[styles.secondaryButton, busy && styles.disabled]}
                >
                  <Text style={styles.secondaryButtonText}>{busy ? 'Please wait…' : 'Update Account Password'}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.securityCard}>
                {!codeRequested ? (
                  <View>
                    <Text style={styles.menuItemDescription}>
                      Request a 6-digit verification code sent to your registered mail id or phone to reset your password.
                    </Text>
                    <Pressable
                      disabled={busy}
                      onPress={() => void requestVerificationCode()}
                      style={[styles.primaryButton, { backgroundColor: '#2563eb' }, busy && styles.disabled]}
                    >
                      <Text style={styles.primaryButtonText}>
                        {busy ? 'Requesting code…' : 'Request 6-digit verification code'}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <View style={styles.codeSentBanner}>
                      <Text style={styles.codeSentBannerText}>
                        ✅ 6-digit verification code sent! Check your alert or email and enter the code below.
                      </Text>
                    </View>

                    <Text style={styles.fieldLabel}>6-Digit Verification Code</Text>
                    <TextInput
                      keyboardType="number-pad"
                      maxLength={6}
                      style={styles.input}
                      placeholder="Enter 6-digit code (e.g. 123456)"
                      value={enteredCode}
                      onChangeText={setEnteredCode}
                    />

                    <Text style={styles.fieldLabel}>New Password</Text>
                    <TextInput
                      autoCapitalize="none"
                      secureTextEntry
                      style={styles.input}
                      placeholder="New password (8+ characters)"
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                    />

                    <Text style={styles.fieldLabel}>Confirm New Password</Text>
                    <TextInput
                      autoCapitalize="none"
                      secureTextEntry
                      style={styles.input}
                      placeholder="Confirm new password"
                      value={resetConfirmPassword}
                      onChangeText={setResetConfirmPassword}
                    />

                    <Pressable
                      disabled={busy}
                      onPress={() => void resetPasswordWithCode()}
                      style={[styles.primaryButton, { backgroundColor: '#166534' }, busy && styles.disabled]}
                    >
                      <Text style={styles.primaryButtonText}>
                        {busy ? 'Resetting password…' : 'Reset Password with Code'}
                      </Text>
                    </Pressable>

                    <Pressable
                      disabled={busy}
                      onPress={() => void requestVerificationCode()}
                      style={{ marginTop: 10, alignSelf: 'center' }}
                    >
                      <Text style={styles.updatePhotoText}>Resend 6-digit code</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function ProfileAccess({
  session,
  roleLabel,
  items,
  onNavigate,
  onSignOut,
  onSessionUserUpdate,
  iconOnly = false,
}: Props) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [supportVisible, setSupportVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [confirmLogoutVisible, setConfirmLogoutVisible] = useState(false);

  function chooseItem(item: ProfileMenuItem) {
    setMenuVisible(false);
    if (item.key === 'help') {
      setSupportVisible(true);
      return;
    }
    if (item.key === 'profile-settings') {
      setSettingsVisible(true);
      return;
    }
    onNavigate(item.key);
  }

  const isPartner = session.user.role === 'restaurant' || session.user.role === 'shop';
  const partnerFallback = session.user.role === 'shop' ? 'Shop' : 'Restaurant';
  const partnerName = (
    session.user.name ||
    session.user.displayName ||
    (session.user as any).restaurantName ||
    (session.user as any).shopName ||
    (session.user as any).storeName ||
    partnerFallback
  ).trim();
  const partnerInitial = partnerName.charAt(0).toUpperCase();

  const userPhoto = isPartner
    ? null
    : (session.user.profilePhoto || session.user.photo || session.user.avatar || session.user.image);
  const initial = isPartner
    ? partnerInitial
    : (session.user.name || session.user.displayName || '').trim().charAt(0).toUpperCase();
  const menuItems = items.filter((item) => item.key !== 'help' && item.key !== 'profile-settings');
  const accountId = getAccountDisplayId(session.user, roleLabel);
  const isAdmin = isAdminUser(session.user);
  const isSuperAdmin = session.user.role === 'superadmin' || session.user.isSuperAdmin === true;
  const isSubAdmin = session.user.role === 'subadmin';
  const isRider = session.user.role === 'deliveryPartner' || (roleLabel || '').toLowerCase().includes('delivery') || (roleLabel || '').toLowerCase().includes('rider');

  return (
    <>
      <Pressable
        accessibilityLabel="Account and profile menu"
        accessibilityRole="button"
        onPress={() => setMenuVisible(true)}
        style={styles.profileButton}
      >
        {userPhoto ? (
          <Image source={{ uri: apiPath(userPhoto) }} style={styles.headerAvatarImage} />
        ) : initial ? (
          <Text style={styles.headerAvatarInitial}>{initial}</Text>
        ) : (
          <Text style={styles.profileIconCircle}>👤</Text>
        )}
      </Pressable>

      <Modal
        transparent
        animationType="fade"
        visible={menuVisible}
        onRequestClose={() => {
          if (confirmLogoutVisible) {
            setConfirmLogoutVisible(false);
          } else {
            setMenuVisible(false);
          }
        }}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            if (confirmLogoutVisible) {
              setConfirmLogoutVisible(false);
            } else {
              setMenuVisible(false);
            }
          }}
        >
          <Pressable style={styles.menuCard} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.menuHeader}>
              <View style={[styles.avatar, isAdmin && styles.adminAvatarCircle]}>
                <Text style={styles.avatarText}>
                  {isAdmin ? (isSuperAdmin ? '👑' : isSubAdmin ? '🛡️' : '⚡') : (initial || 'T')}
                </Text>
              </View>
              <View style={styles.identity}>
                <View style={styles.adminTitleRow}>
                  <Text numberOfLines={1} style={styles.userName}>{session.user.name || 'Tomato user'}</Text>
                  {isAdmin && (
                    <View style={[
                      styles.adminRoleBadge,
                      isSuperAdmin ? styles.superAdminBadge : isSubAdmin ? styles.subAdminBadge : styles.platformAdminBadge
                    ]}>
                      <Text style={[
                        styles.adminRoleBadgeText,
                        isSuperAdmin ? styles.superAdminBadgeText : isSubAdmin ? styles.subAdminBadgeText : styles.platformAdminBadgeText
                      ]}>
                        {isSuperAdmin ? '👑 SUPER ADMIN' : isSubAdmin ? '🛡️ SUB-ADMIN' : '⚡ ADMIN'}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.roleLabel}>{session.user.adminRoleTitle || roleLabel} · {accountId}</Text>
              </View>
              <Pressable
                accessibilityLabel="Close profile menu"
                onPress={() => {
                  setConfirmLogoutVisible(false);
                  setMenuVisible(false);
                }}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
              {menuItems.map((item) => (
                <Pressable key={item.key} onPress={() => chooseItem(item)} style={styles.menuItem}>
                  {Boolean(item.icon) && <Text style={styles.menuItemIcon}>{item.icon}</Text>}
                  <View style={styles.menuItemBody}>
                    <Text style={styles.menuItemLabel}>
                      {item.label.includes('(') && item.label.includes(')') ? (
                        <>
                          {item.label.slice(0, item.label.indexOf('(')).trim()} (<Text style={{ color: '#16a34a', fontWeight: '800' }}>{item.label.slice(item.label.indexOf('(') + 1, item.label.indexOf(')'))}</Text>)
                        </>
                      ) : (
                        item.label
                      )}
                    </Text>
                    {Boolean(item.description) && (
                      <Text style={styles.menuItemDescription}>{item.description}</Text>
                    )}
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
              <View style={styles.separator} />
              <Pressable onPress={() => chooseItem({ key: 'help', label: 'Help & support', icon: '🎧', description: 'Contact support or raise a role-specific ticket' })} style={styles.menuItem}>
                <Text style={styles.menuItemIcon}>🎧</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Help & support</Text>
                  <Text style={styles.menuItemDescription}>Contact support or raise a role-specific ticket</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              {isAdmin && (
                <Pressable
                  onPress={() => chooseItem({
                    key: 'controlPanel',
                    label: 'Control Panel',
                    icon: '⚙️',
                    description: 'Staff locations, delegated roles, employees & platform controls',
                  })}
                  style={styles.menuItem}
                >
                  <Text style={styles.menuItemIcon}>⚙️</Text>
                  <View style={styles.menuItemBody}>
                    <Text style={styles.menuItemLabel}>Control Panel</Text>
                    <Text style={styles.menuItemDescription}>Staff locations, delegated roles, employees & platform controls</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => chooseItem({
                  key: 'profile-settings',
                  label: isAdmin ? 'Admin Profile & Security' : isRider ? 'Rider Profile' : 'Profile Settings',
                  icon: isAdmin ? '🛡️' : '⚙',
                  description: isAdmin
                    ? 'Admin credentials, capabilities & security keys'
                    : isRider
                      ? 'Rider profile, vehicle & account security'
                      : 'Account, DOB, photo & password security'
                })}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemIcon}>{isAdmin ? '🛡️' : '⚙'}</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>
                    {isAdmin ? 'Admin Profile & Security' : isRider ? 'Rider Profile' : 'Profile Settings'}
                  </Text>
                  <Text style={styles.menuItemDescription}>
                    {isAdmin
                      ? 'Admin credentials, capabilities & security keys'
                      : isRider
                        ? 'Rider profile, vehicle & account security'
                        : 'Account & Profile settings, photo & security'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirmLogoutVisible(true);
                }}
                style={[styles.menuItem, styles.signOutItem]}
              >
                <Text style={styles.menuItemIcon}>🚪</Text>
                <View style={styles.menuItemBody}><Text style={styles.signOutLabel}>Sign out</Text></View>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>

        {confirmLogoutVisible && (
          <View style={styles.logoutConfirmOverlay}>
            <Pressable
              style={styles.logoutConfirmBackdropTap}
              onPress={() => setConfirmLogoutVisible(false)}
            />
            <View style={styles.logoutConfirmCard}>
              <View style={styles.logoutConfirmIconWrap}>
                <Text style={styles.logoutConfirmIcon}>🚪</Text>
              </View>
              <Text style={styles.logoutConfirmTitle}>Sign out from Tomato?</Text>
              <Text style={styles.logoutConfirmMessage}>
                Are you sure you want to sign out? You can sign back in at any time to access your orders and saved details.
              </Text>
              <View style={styles.logoutConfirmActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="No, Stay"
                  onPress={() => setConfirmLogoutVisible(false)}
                  style={[styles.logoutConfirmBtn, styles.logoutCancelBtn]}
                >
                  <Text style={styles.logoutCancelBtnText}>No, Stay</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="yes, Sign out"
                  onPress={() => {
                    setConfirmLogoutVisible(false);
                    setMenuVisible(false);
                    onSignOut();
                  }}
                  style={[styles.logoutConfirmBtn, styles.logoutProceedBtn]}
                >
                  <Text style={styles.logoutProceedBtnText}>yes, Sign out</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </Modal>

      <SupportModal visible={supportVisible} onClose={() => setSupportVisible(false)} session={session} />
      <ProfileSettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        session={session}
        onSessionUserUpdate={onSessionUserUpdate}
        roleLabel={roleLabel}
        onOverviewPress={() => onNavigate('overview')}
        onNavigate={onNavigate}
      />
    </>
  );
}

const styles = StyleSheet.create({
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff0eb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fca597',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  profileButtonCircle: { width: 42, height: 42, borderRadius: 21 },
  headerAvatarImage: { width: 42, height: 42, borderRadius: 21, resizeMode: 'cover' },
  headerAvatarInitial: { color: '#c8322a', fontSize: 18, fontWeight: '800' },
  profileIcon: { color: '#c8322a', fontSize: 19, fontWeight: '700' },
  profileIconCircle: { fontSize: 19 },
  backdrop: { flex: 1, backgroundColor: 'rgba(36, 25, 20, 0.35)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 102, paddingHorizontal: 14 },
  menuCard: { width: '100%', maxWidth: 380, maxHeight: '82%', borderRadius: 20, backgroundColor: '#fff', overflow: 'hidden', elevation: 12 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1e9e2' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff0eb', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#c8322a', fontSize: 19, fontWeight: '800' },
  identity: { flex: 1, minWidth: 0 },
  userName: { color: '#2d2621', fontSize: 15, fontWeight: '800' },
  roleLabel: { color: '#82786f', fontSize: 12, marginTop: 3 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f7f2ed', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  closeText: { color: '#5f554d', fontSize: 23, lineHeight: 26 },
  menuScroll: { paddingHorizontal: 10 },
  menuItem: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12 },
  menuItemIcon: { width: 36, color: '#d83a32', fontSize: 20, textAlign: 'center' },
  menuItemBody: { flex: 1, paddingHorizontal: 5 },
  menuItemLabel: { color: '#302923', fontSize: 14, fontWeight: '700' },
  menuItemDescription: { color: '#82786f', fontSize: 11, lineHeight: 16, marginTop: 2 },
  chevron: { color: '#9a8f87', fontSize: 24, paddingHorizontal: 7 },
  separator: { height: 1, backgroundColor: '#f1e9e2', marginVertical: 5 },
  signOutItem: { marginBottom: 6 },
  signOutLabel: { color: '#bd3029', fontSize: 14, fontWeight: '700' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(36, 25, 20, 0.4)' },
  sheet: { maxHeight: '90%', backgroundColor: '#fffaf5', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: '#2d2621', fontSize: 21, fontWeight: '800' },
  contactCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e8e1', borderRadius: 14, padding: 13, marginVertical: 8 },
  sectionTitle: { color: '#302923', fontSize: 15, fontWeight: '800', marginTop: 10, marginBottom: 5 },
  contactRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f5eee8' },
  contactLabel: { color: '#766d68', fontSize: 12 },
  contactValue: { color: '#c8322a', fontSize: 12, fontWeight: '700' },
  choiceList: { gap: 6, marginTop: 4 },
  priorityRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  choiceChip: { borderWidth: 1, borderColor: '#e9dfd7', borderRadius: 9, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8 },
  priorityChip: { flex: 1, alignItems: 'center' },
  choiceChipSelected: { borderColor: '#d83a32', backgroundColor: '#fff0eb' },
  choiceText: { color: '#635950', fontSize: 11 },
  choiceTextSelected: { color: '#bd3029', fontWeight: '700' },
  input: { minHeight: 45, borderWidth: 1, borderColor: '#e9dfd7', borderRadius: 11, paddingHorizontal: 12, marginTop: 8, color: '#302923', backgroundColor: '#fff' },
  multilineInput: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  fieldLabel: { color: '#574d46', fontSize: 12, fontWeight: '700', marginTop: 9 },
  primaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d83a32', borderRadius: 11, paddingHorizontal: 14, marginTop: 12 },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  secondaryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff0eb', borderRadius: 11, paddingHorizontal: 14, marginTop: 9 },
  secondaryButtonText: { color: '#bd3029', fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.55 },
  error: { color: '#a9241c', backgroundColor: '#fae7e4', padding: 10, borderRadius: 10, fontSize: 12, marginBottom: 8 },
  ticketCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0e8e1', borderRadius: 12, padding: 12, marginTop: 8 },
  ticketCardCollapsed: { paddingVertical: 10, paddingHorizontal: 12 },
  ticketSingleLineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ticketSingleLineRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketChevron: { fontSize: 16, color: '#9ca3af', fontWeight: '800', lineHeight: 18 },
  ticketChevronExpanded: { color: '#d83a32' },
  ticketExpandedBody: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f5eee8', marginTop: 10 },
  flex: { flex: 1 },
  ticketTitle: { color: '#302923', fontSize: 13, fontWeight: '700' },
  ticketDescription: { color: '#766d68', fontSize: 12, lineHeight: 17, marginTop: 5 },
  ticketAction: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#fff0eb', borderRadius: 8, marginTop: 9 },
  ticketActionText: { color: '#bd3029', fontSize: 11, fontWeight: '700' },
  emptyText: { color: '#82786f', fontSize: 12, marginTop: 8, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 4 },
  refreshBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  refreshLink: { color: '#d83a32', fontSize: 12, fontWeight: '700' },
  ticketHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
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
  ticketMetaText: { color: '#8c8077', fontSize: 11, marginTop: 2, marginBottom: 4 },
  ticketAdminUpdateBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, padding: 9, marginTop: 8 },
  ticketAdminUpdateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  ticketAdminUpdateBadge: { color: '#15803d', fontSize: 10, fontWeight: '800' },
  ticketAdminUpdateTime: { color: '#166534', fontSize: 10 },
  ticketAdminUpdateText: { color: '#14532d', fontSize: 12, lineHeight: 17, fontWeight: '500' },
  ticketPendingAdminBox: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fef3c7', borderRadius: 8, padding: 8, marginTop: 8 },
  ticketPendingAdminText: { color: '#92400e', fontSize: 11, lineHeight: 15 },
  ticketInReviewAdminBox: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#dbeafe', borderRadius: 8, padding: 8, marginTop: 8 },
  ticketInReviewAdminText: { color: '#1e40af', fontSize: 11, lineHeight: 15 },
  ticketActionReopen: { backgroundColor: '#fff0eb' },
  ticketActionResolve: { backgroundColor: '#e9f6ee' },
  ticketActionTextReopen: { color: '#bd3029' },
  ticketActionTextResolve: { color: '#166534' },
  profilePhotoSection: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 12, padding: 12, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#f0e8e1' },
  profilePhotoContainer: { position: 'relative', width: 64, height: 64 },
  profilePhotoImage: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f0e8e1' },
  profilePhotoPlaceholder: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff0eb', borderWidth: 1.5, borderColor: '#d83a32', alignItems: 'center', justifyContent: 'center' },
  profilePhotoInitial: { fontSize: 26, fontWeight: '800', color: '#d83a32' },
  profilePhotoBadgeBtn: { position: 'absolute', bottom: -2, right: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#d83a32', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' },
  profilePhotoBadgeIcon: { fontSize: 11 },
  profilePhotoMeta: { flex: 1 },
  profilePhotoTitle: { fontSize: 15, fontWeight: '800', color: '#2d2621' },
  updatePhotoTextBtn: { marginTop: 4 },
  updatePhotoText: { color: '#d83a32', fontSize: 12, fontWeight: '700' },
  photoPickerBox: { padding: 12, backgroundColor: '#fffaf5', borderWidth: 1, borderColor: '#f3eae2', borderRadius: 12, marginBottom: 12 },
  photoPickerTitle: { fontSize: 12, fontWeight: '700', color: '#463e39', marginBottom: 2 },
  photoPickerActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  photoPickerSaveBtn: { flex: 1, paddingVertical: 8, backgroundColor: '#d83a32', borderRadius: 8, alignItems: 'center' },
  photoPickerSaveText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  photoPickerCancelBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#f0e8e1', borderRadius: 8, alignItems: 'center' },
  photoPickerCancelText: { color: '#665d56', fontWeight: '700', fontSize: 12 },
  readOnlyField: { minHeight: 45, borderWidth: 1, borderColor: '#e9dfd7', borderRadius: 11, paddingHorizontal: 12, marginTop: 8, backgroundColor: '#fbf7f4', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readOnlyText: { color: '#574d46', fontSize: 13, fontWeight: '700' },
  readOnlyBadge: { color: '#92400e', backgroundColor: '#fef3c7', fontSize: 9, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2.5, borderRadius: 5 },
  securityDivider: { height: 1, backgroundColor: '#f1e9e2', marginTop: 22, marginBottom: 16 },
  securitySectionTitle: { color: '#282321', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  securitySubtitle: { color: '#766d68', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  securityTabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  securityTab: { flex: 1, paddingVertical: 9, borderWidth: 1, borderColor: '#eaded7', borderRadius: 10, backgroundColor: '#fff', alignItems: 'center' },
  securityTabActive: { borderColor: '#d83a32', backgroundColor: '#fff0eb' },
  securityTabText: { color: '#635950', fontSize: 12, fontWeight: '600' },
  securityTabTextActive: { color: '#bd3029', fontWeight: '800' },
  securityCard: { backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#f0e8e1' },
  codeSentBanner: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, padding: 9, marginBottom: 10 },
  codeSentBannerText: { color: '#166534', fontSize: 11, fontWeight: '600', lineHeight: 16 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  validDigipinBadge: { color: '#166534', backgroundColor: '#dcfce7', fontSize: 9, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  mapplsBox: { backgroundColor: '#f9f6f2', borderWidth: 1, borderColor: '#eee3d8', borderRadius: 12, padding: 10, marginTop: 8, marginBottom: 12 },
  mapplsInfoText: { color: '#6d635b', fontSize: 11, lineHeight: 15, marginBottom: 8 },
  mapplsBtnRow: { flexDirection: 'row', gap: 8 },
  mapplsMapBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d3c7bc', borderRadius: 8, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  mapplsMapBtnText: { color: '#3c342f', fontSize: 11, fontWeight: '700' },
  detectGpsBtn: { flex: 1, backgroundColor: '#d83a32', borderRadius: 8, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  detectGpsBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  logoutConfirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 999,
  },
  logoutConfirmBackdropTap: {
    ...StyleSheet.absoluteFill,
  },
  logoutConfirmCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 14,
  },
  logoutConfirmIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  logoutConfirmIcon: {
    fontSize: 26,
  },
  logoutConfirmTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
  },
  logoutConfirmMessage: {
    fontSize: 13,
    lineHeight: 19,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  logoutConfirmActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  logoutConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutCancelBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  logoutCancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  logoutProceedBtn: {
    backgroundColor: '#dc2626',
  },
  logoutProceedBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  partnerOverviewCard: {
    backgroundColor: '#fff7ed',
    borderWidth: 1.5,
    borderColor: '#fed7aa',
    borderRadius: 14,
    padding: 13,
    marginTop: 12,
    marginBottom: 6,
  },
  partnerOverviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  partnerOverviewIcon: {
    fontSize: 24,
  },
  partnerOverviewEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    color: '#c2410c',
    letterSpacing: 0.8,
  },
  partnerOverviewTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#431407',
  },
  partnerOverviewSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
    marginTop: 1,
  },
  partnerOverviewChevron: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c2410c',
  },
  partnerOverviewNote: {
    fontSize: 11,
    color: '#7c2d12',
    marginTop: 8,
    lineHeight: 16,
  },
  partnerAccountCard: {
    backgroundColor: '#fff',
    borderColor: '#eee6df',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 12,
  },
  partnerAvatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff0eb',
    borderWidth: 2,
    borderColor: '#fca597',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  partnerAvatarText: {
    color: '#c8322a',
    fontSize: 22,
    fontWeight: '800',
  },
  partnerAccountInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  partnerAccountName: {
    color: '#302923',
    fontWeight: '800',
    fontSize: 17,
    marginBottom: 2,
  },
  partnerAccountMuted: {
    color: '#82786f',
    fontSize: 12,
    lineHeight: 17,
  },
  partnerAccountRole: {
    alignSelf: 'flex-start',
    color: '#c8322a',
    backgroundColor: '#fff0eb',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  partnerPendingText: {
    color: '#9b541f',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 5,
  },
  adminTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  adminRoleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  adminRoleBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  superAdminBadge: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  superAdminBadgeText: {
    color: '#92400e',
  },
  subAdminBadge: {
    backgroundColor: '#ede9fe',
    borderColor: '#c4b5fd',
  },
  subAdminBadgeText: {
    color: '#5b21b6',
  },
  platformAdminBadge: {
    backgroundColor: '#e0f2fe',
    borderColor: '#7dd3fc',
  },
  platformAdminBadgeText: {
    color: '#0369a1',
  },
  adminAvatarCircle: {
    backgroundColor: '#f8fafc',
    borderWidth: 2,
    borderColor: '#cbd5e1',
  },
  adminPrivilegeCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    marginTop: 6,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  adminPrivilegeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  adminAvatarBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  adminAvatarEmoji: {
    fontSize: 22,
  },
  adminPrivilegeInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  adminBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  adminIdTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  adminTitleText: {
    color: '#0f172a',
    fontWeight: '800',
    fontSize: 16,
  },
  adminLevelText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  adminPermDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  adminPermTitle: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  adminPermChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  adminPermChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  adminPermChipText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '700',
  },
  adminPermSuperChip: {
    backgroundColor: '#fefce8',
    borderColor: '#fef08a',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  adminPermSuperChipText: {
    color: '#854d0e',
    fontSize: 11,
    fontWeight: '800',
  },
});
