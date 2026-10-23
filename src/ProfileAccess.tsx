import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import type { Session, User } from './types';

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
  status?: string;
  createdAt?: string;
};
type ProfileDraft = {
  name: string;
  email: string;
  phone: string;
  dob: string;
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

function initialProfile(user: User): ProfileDraft {
  return {
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    dob: user.dob ? user.dob.split('T')[0] : '',
    gsnNumber: user.gsnNumber || '',
    address: user.address || user.restaurantAddress || user.shopAddress || '',
    city: user.city || '',
    pincode: user.pincode || user.postalCode || '',
    digipin: user.digipin || '',
    category: user.cuisine || user.category || '',
    deliveryVehicle: user.deliveryVehicle || '',
  };
}

type Props = {
  session: Session;
  roleLabel: string;
  items: ProfileMenuItem[];
  onNavigate: (key: string) => void;
  onSignOut: () => void;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

function readableError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
}

export default function ProfileAccess({
  session,
  roleLabel,
  items,
  onNavigate,
  onSignOut,
  onSessionUserUpdate,
}: Props) {
  const [menuVisible, setMenuVisible] = useState(false);
  const [supportVisible, setSupportVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contact, setContact] = useState<SupportContact>({});
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(roleCategories(session.user.role || '')[0]);
  const [priority, setPriority] = useState('Normal');
  const [profile, setProfile] = useState(() => initialProfile(session.user));
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const isPartner = session.user.role === 'restaurant' || session.user.role === 'shop';
  const isRider = session.user.role === 'deliveryPartner' || session.user.role === 'rider';
  const categories = roleCategories(session.user.role || '');

  useEffect(() => {
    if (!supportVisible) return;
    let active = true;
    setBusy(true);
    setError('');
    Promise.all([
      apiRequest<SupportContact>('/api/support/contact-info'),
      apiRequest<{ tickets?: SupportTicket[] }>('/api/support/tickets', session.token),
    ])
      .then(([supportContact, supportTickets]) => {
        if (!active) return;
        setContact(supportContact);
        setTickets(supportTickets.tickets || []);
      })
      .catch((reason: unknown) => {
        if (active) setError(readableError(reason));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [supportVisible, session.token]);

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
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ ticket: SupportTicket }>(
        `/api/support/tickets/${encodeURIComponent(ticket.ticketId || ticket._id)}/toggle`,
        session.token,
        { method: 'PATCH' },
      );
      setTickets((current) => current.map((entry) =>
        entry._id === ticket._id ? result.ticket : entry,
      ));
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    const name = profile.name.trim();
    if (!name) {
      setError('Name is required.');
      return;
    }
    const changes: Partial<User> = {
      ...(name !== (session.user.name || '') ? { name } : {}),
      ...(profile.email.trim() !== (session.user.email || '') ? { email: profile.email.trim() } : {}),
      ...(profile.phone.trim() !== (session.user.phone || '') ? { phone: profile.phone.trim() } : {}),
      ...(profile.dob !== (session.user.dob || '').split('T')[0] ? { dob: profile.dob } : {}),
      ...(profile.gsnNumber !== (session.user.gsnNumber || '') ? { gsnNumber: profile.gsnNumber } : {}),
      ...(profile.digipin !== (session.user.digipin || '') ? { digipin: profile.digipin } : {}),
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
      setSettingsVisible(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ user: User }>('/api/auth/profile', session.token, {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
      await onSessionUserUpdate(result.user);
      setSettingsVisible(false);
      Alert.alert('Profile updated', 'Your account settings have been saved.');
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
      Alert.alert('Password updated', 'Your Tomato account password has been changed.');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

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

  function chooseItem(item: ProfileMenuItem) {
    setMenuVisible(false);
    if (item.key === 'help') {
      setSupportVisible(true);
      return;
    }
    if (item.key === 'profile-settings') {
      setProfile({
        ...initialProfile(session.user),
      });
      setError('');
      setSettingsVisible(true);
      return;
    }
    onNavigate(item.key);
  }

  return (
    <>
      <Pressable
        accessibilityLabel="Profile menu. My orders, saved addresses, help and support, profile settings"
        accessibilityRole="button"
        onPress={() => setMenuVisible(true)}
        style={styles.profileButton}
      >
        <Text style={styles.profileIcon}>👤</Text>
        <Text style={styles.profileButtonLabel}>Profile</Text>
      </Pressable>

      <Modal transparent animationType="fade" visible={menuVisible} onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuVisible(false)}>
          <Pressable style={styles.menuCard} onPress={() => undefined}>
            <View style={styles.menuHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(session.user.name || 'T').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.identity}>
                <Text numberOfLines={1} style={styles.userName}>{session.user.name || 'Tomato user'}</Text>
                <Text style={styles.roleLabel}>{roleLabel}</Text>
              </View>
              <Pressable accessibilityLabel="Close profile menu" onPress={() => setMenuVisible(false)} style={styles.closeButton}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
              {items.map((item) => (
                <Pressable key={item.key} onPress={() => chooseItem(item)} style={styles.menuItem}>
                  <Text style={styles.menuItemIcon}>{item.icon}</Text>
                  <View style={styles.menuItemBody}>
                    <Text style={styles.menuItemLabel}>{item.label}</Text>
                    <Text style={styles.menuItemDescription}>{item.description}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
              <View style={styles.separator} />
              <Pressable onPress={() => chooseItem({ key: 'help', label: 'Help & support', icon: '？', description: '' })} style={styles.menuItem}>
                <Text style={styles.menuItemIcon}>？</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Help & support</Text>
                  <Text style={styles.menuItemDescription}>Contact support or raise a role-specific ticket</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              <Pressable onPress={() => chooseItem({ key: 'profile-settings', label: 'Profile Settings', icon: '⚙', description: '' })} style={styles.menuItem}>
                <Text style={styles.menuItemIcon}>⚙</Text>
                <View style={styles.menuItemBody}>
                  <Text style={styles.menuItemLabel}>Profile Settings</Text>
                  <Text style={styles.menuItemDescription}>Update your name and contact details</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setMenuVisible(false);
                  onSignOut();
                }}
                style={[styles.menuItem, styles.signOutItem]}
              >
                <Text style={styles.menuItemIcon}>⇥</Text>
                <View style={styles.menuItemBody}><Text style={styles.signOutLabel}>Sign out</Text></View>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent animationType="slide" visible={supportVisible} onRequestClose={() => setSupportVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.identity}>
                <Text style={styles.sheetTitle}>Help & support</Text>
                <Text style={styles.roleLabel}>We’re here to help with your Tomato account.</Text>
              </View>
              <Pressable accessibilityLabel="Close support" onPress={() => setSupportVisible(false)} style={styles.closeButton}>
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
              <Text style={styles.sectionTitle}>Your support tickets</Text>
              {busy && !tickets.length ? <ActivityIndicator color="#d83a32" /> : tickets.length ? (
                tickets.map((ticket) => (
                  <View key={ticket._id} style={styles.ticketCard}>
                    <Text style={styles.ticketTitle}>{ticket.ticketId || 'Ticket'} · {ticket.subject || 'Support request'}</Text>
                    <Text style={styles.menuItemDescription}>{ticket.status || 'Open'}{ticket.createdAt ? ` · ${new Date(ticket.createdAt).toLocaleDateString()}` : ''}</Text>
                    {!!ticket.description && <Text style={styles.ticketDescription}>{ticket.description}</Text>}
                    <Pressable
                      disabled={busy}
                      onPress={() => void toggleTicket(ticket)}
                      style={styles.ticketAction}
                    >
                      <Text style={styles.ticketActionText}>
                        {ticket.status === 'Resolved' || ticket.status === 'Closed' ? 'Reopen ticket' : 'Mark resolved'}
                      </Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No support tickets yet.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal transparent animationType="slide" visible={settingsVisible} onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.identity}>
                <Text style={styles.sheetTitle}>Profile Settings</Text>
                <Text style={styles.roleLabel}>Manage your Tomato account details.</Text>
              </View>
              <Pressable accessibilityLabel="Close profile settings" onPress={() => setSettingsVisible(false)} style={styles.closeButton}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} value={profile.name} onChangeText={(name) => setProfile((current) => ({ ...current, name }))} />
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput autoCapitalize="none" keyboardType="email-address" style={styles.input} value={profile.email} onChangeText={(email) => setProfile((current) => ({ ...current, email }))} />
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput keyboardType="phone-pad" style={styles.input} value={profile.phone} onChangeText={(phone) => setProfile((current) => ({ ...current, phone }))} />
            <Text style={styles.fieldLabel}>Date of birth</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={profile.dob}
              onChangeText={(dob) => setProfile((current) => ({ ...current, dob }))}
            />
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
            {isPartner && (
              <>
                <Text style={styles.fieldLabel}>{session.user.role === 'shop' ? 'Shop category' : 'Cuisine'}</Text>
                <TextInput style={styles.input} value={profile.category} onChangeText={(category) => setProfile((current) => ({ ...current, category }))} />
                <Text style={styles.fieldLabel}>GST / GSN number</Text>
                <TextInput autoCapitalize="characters" style={styles.input} value={profile.gsnNumber} onChangeText={(gsnNumber) => setProfile((current) => ({ ...current, gsnNumber }))} />
                <Text style={styles.fieldLabel}>DIGIPIN</Text>
                <TextInput autoCapitalize="characters" style={styles.input} value={profile.digipin} onChangeText={(digipin) => setProfile((current) => ({ ...current, digipin }))} />
              </>
            )}
            {isRider && (
              <TextInput
                style={styles.input}
                placeholder="Delivery vehicle"
                value={profile.deliveryVehicle}
                onChangeText={(deliveryVehicle) => setProfile((current) => ({ ...current, deliveryVehicle }))}
              />
            )}
            {session.user.role === 'admin' && (
              <>
                <Text style={styles.fieldLabel}>GST / GSN number</Text>
                <TextInput autoCapitalize="characters" style={styles.input} value={profile.gsnNumber} onChangeText={(gsnNumber) => setProfile((current) => ({ ...current, gsnNumber }))} />
              </>
            )}
            <Pressable disabled={busy} onPress={() => void saveProfile()} style={[styles.primaryButton, busy && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save profile'}</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>Account security</Text>
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
            <Pressable disabled={busy} onPress={() => void changePassword()} style={[styles.secondaryButton, busy && styles.disabled]}>
              <Text style={styles.secondaryButtonText}>{busy ? 'Please wait…' : 'Change password'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  profileButton: { minWidth: 78, height: 42, borderRadius: 14, backgroundColor: '#fff0eb', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 9 },
  profileIcon: { color: '#c8322a', fontSize: 20, fontWeight: '700' },
  profileButtonLabel: { color: '#c8322a', fontSize: 12, fontWeight: '800' },
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
  ticketTitle: { color: '#302923', fontSize: 13, fontWeight: '700' },
  ticketDescription: { color: '#766d68', fontSize: 12, lineHeight: 17, marginTop: 5 },
  ticketAction: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#fff0eb', borderRadius: 8, marginTop: 9 },
  ticketActionText: { color: '#bd3029', fontSize: 11, fontWeight: '700' },
  emptyText: { color: '#82786f', fontSize: 12, marginTop: 8, marginBottom: 12 },
});
