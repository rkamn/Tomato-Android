import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import type { Session } from './types';

type Section = 'addresses' | 'roles' | 'employees' | 'support' | 'security';
type Location = {
  label?: string;
  line1?: string;
  locality?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  digipin?: string;
};
type StaffMember = {
  _id: string;
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  baseRole?: string;
  adminRoleTitle?: string;
  permissions?: string[];
  isApproved?: boolean;
  isBlocked?: boolean;
  location?: Location;
  assignedLocation?: Location;
};
type StaffRole = {
  id?: string;
  _id?: string;
  roleKey: string;
  displayName: string;
  baseRole: string;
  description?: string;
  permissions?: string[];
  assignedCount?: number;
  isSystem?: boolean;
};
type ControlPanelData = {
  success?: boolean;
  isSuperAdmin?: boolean;
  myLocation?: Location;
  admins?: StaffMember[];
  roles?: StaffRole[];
  supportContact?: { priorityEmail?: string; helpline?: string };
  reverseProxy?: { enabled?: boolean; gatewayPort?: number; backendPort?: number; gatewayUrl?: string; backendUrl?: string };
};

const permissionOptions = [
  ['dashboard_view', 'Dashboard'],
  ['orders_manage', 'Orders'],
  ['shops_manage', 'Shops'],
  ['restaurants_manage', 'Restaurants'],
  ['riders_manage', 'Riders'],
  ['customers_manage', 'Customers'],
  ['subadmins_manage', 'Staff'],
] as const;

const sections: [Section, string][] = [
  ['addresses', 'Locations'],
  ['roles', 'Roles'],
  ['employees', 'Employees'],
  ['support', 'Support'],
  ['security', 'Security'],
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function memberId(member: StaffMember): string {
  return member._id || member.id || '';
}

export default function AdminControlPanel({
  session,
  isSuperAdmin,
  canManageProxy,
}: {
  session: Session;
  isSuperAdmin: boolean;
  canManageProxy: boolean;
}) {
  const [section, setSection] = useState<Section>('addresses');
  const [data, setData] = useState<ControlPanelData | null>(null);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [roleDraft, setRoleDraft] = useState({
    displayName: '',
    roleKey: '',
    description: '',
    permissions: ['dashboard_view'],
  });
  const [editingRoleId, setEditingRoleId] = useState('');
  const [supportDraft, setSupportDraft] = useState({ priorityEmail: '', helpline: '' });
  const [proxyDraft, setProxyDraft] = useState({ enabled: false, gatewayPort: '', backendPort: '' });
  const [locationTarget, setLocationTarget] = useState('');
  const [locationDraft, setLocationDraft] = useState({
    label: '',
    line1: '',
    locality: '',
    city: '',
    state: '',
    postalCode: '',
    digipin: '',
  });
  const [rejectReason, setRejectReason] = useState('');

  async function load() {
    setError('');
    try {
      const result = await apiRequest<ControlPanelData>('/api/admin/control-panel', session.token);
      setData(result);
      setSupportDraft({
        priorityEmail: result.supportContact?.priorityEmail || '',
        helpline: result.supportContact?.helpline || '',
      });
      setProxyDraft({
        enabled: Boolean(result.reverseProxy?.enabled),
        gatewayPort: result.reverseProxy?.gatewayPort ? String(result.reverseProxy.gatewayPort) : '',
        backendPort: result.reverseProxy?.backendPort ? String(result.reverseProxy.backendPort) : '',
      });
      setRoles(result.roles || []);
      if (!result.roles?.length && (isSuperAdmin || session.user.role === 'admin')) {
        const roleResult = await apiRequest<{ roles?: StaffRole[] }>('/api/admin/roles', session.token);
        setRoles(roleResult.roles || []);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session.token]);

  async function runAction(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy('');
    }
  }

  function togglePermission(permission: string) {
    setRoleDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  function editRole(role: StaffRole) {
    setEditingRoleId(role.id || role._id || '');
    setRoleDraft({
      displayName: role.displayName,
      roleKey: role.roleKey,
      description: role.description || '',
      permissions: role.permissions || [],
    });
    setSection('roles');
  }

  async function saveRole() {
    if (!roleDraft.displayName.trim()) {
      setError('Enter a display name for this role.');
      return;
    }
    await runAction('save-role', async () => {
      await apiRequest(
        editingRoleId ? `/api/admin/roles/${encodeURIComponent(editingRoleId)}` : '/api/admin/roles',
        session.token,
        {
          method: editingRoleId ? 'PUT' : 'POST',
          body: JSON.stringify({
            displayName: roleDraft.displayName.trim(),
            ...(editingRoleId ? {} : { roleKey: roleDraft.roleKey.trim(), baseRole: 'subadmin' }),
            description: roleDraft.description.trim(),
            permissions: roleDraft.permissions,
          }),
        },
      );
      setEditingRoleId('');
      setRoleDraft({ displayName: '', roleKey: '', description: '', permissions: ['dashboard_view'] });
      await load();
    });
  }

  function deleteRole(role: StaffRole) {
    const id = role.id || role._id || '';
    if (!id) return;
    Alert.alert('Delete custom role?', `${role.displayName} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void runAction(`delete-role-${id}`, async () => {
          await apiRequest(`/api/admin/roles/${encodeURIComponent(id)}`, session.token, { method: 'DELETE' });
          await load();
        }),
      },
    ]);
  }

  async function saveLocation(member: StaffMember) {
    const id = memberId(member);
    if (!locationDraft.city.trim() || !/^\d{5,6}$/.test(locationDraft.postalCode.trim())) {
      setError('Enter a city and a valid 5 or 6 digit postal code.');
      return;
    }
    await runAction(`location-${id}`, async () => {
      const route = member.baseRole === 'subadmin' || member.role === 'subadmin'
        ? `/api/admin/subadmins/${encodeURIComponent(id)}/location`
        : `/api/admin/admins/${encodeURIComponent(id)}/location`;
      await apiRequest(route, session.token, {
        method: 'PUT',
        body: JSON.stringify({
          ...locationDraft,
          label: locationDraft.label.trim(),
          line1: locationDraft.line1.trim(),
          locality: locationDraft.locality.trim(),
          city: locationDraft.city.trim(),
          state: locationDraft.state.trim(),
          postalCode: locationDraft.postalCode.trim(),
          digipin: locationDraft.digipin.trim(),
        }),
      });
      setLocationTarget('');
      await load();
    });
  }

  async function employeeAction(member: StaffMember, action: 'approve' | 'reject') {
    const id = memberId(member);
    await runAction(`${action}-${id}`, async () => {
      await apiRequest(`/api/admin/employees/${encodeURIComponent(id)}/${action}`, session.token, {
        method: 'PUT',
        ...(action === 'reject' ? { body: JSON.stringify({ reason: rejectReason.trim() || 'Rejected by administrator.' }) } : {}),
      });
      setRejectReason('');
      await load();
    });
  }

  async function saveSupport() {
    await runAction('support', async () => {
      await apiRequest('/api/admin/control-panel/support-contact', session.token, {
        method: 'PUT',
        body: JSON.stringify(supportDraft),
      });
      await load();
    });
  }

  async function saveReverseProxy() {
    const gatewayPort = proxyDraft.gatewayPort ? Number(proxyDraft.gatewayPort) : undefined;
    const backendPort = proxyDraft.backendPort ? Number(proxyDraft.backendPort) : undefined;
    if (
      (gatewayPort !== undefined && (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535))
      || (backendPort !== undefined && (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535))
    ) {
      setError('Ports must be whole numbers between 1 and 65535.');
      return;
    }
    Alert.alert('Update reverse proxy?', 'This changes platform gateway routing settings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Update',
        onPress: () => void runAction('reverse-proxy', async () => {
          await apiRequest('/api/admin/control-panel/reverse-proxy', session.token, {
            method: 'PUT',
            body: JSON.stringify({
              enabled: proxyDraft.enabled,
              ...(gatewayPort ? { gatewayPort } : {}),
              ...(backendPort ? { backendPort } : {}),
            }),
          });
          await load();
        }),
      },
    ]);
  }

  const members = data?.admins || [];

  return (
    <View>
      <Text style={styles.eyebrow}>ADMIN CONTROL</Text>
      <Text style={styles.title}>Control panel</Text>
      <Text style={styles.muted}>Staff locations, delegated roles, employee review and platform controls.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sections}>
        {sections
          .filter(([id]) => id !== 'support' || isSuperAdmin)
          .filter(([id]) => id !== 'roles' || isSuperAdmin)
          .filter(([id]) => id !== 'security' || canManageProxy)
          .map(([id, title]) => (
            <Pressable
              key={id}
              onPress={() => setSection(id)}
              style={[styles.sectionChip, section === id && styles.sectionChipActive]}
            >
              <Text style={[styles.sectionChipText, section === id && styles.sectionChipTextActive]}>{title}</Text>
            </Pressable>
          ))}
      </ScrollView>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? <ActivityIndicator color="#d83a32" style={styles.loader} /> : (
        <>
          {section === 'addresses' && (
            <View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>My assigned location</Text>
                <Text style={styles.muted}>
                  {data?.myLocation
                    ? [data.myLocation.label, data.myLocation.line1, data.myLocation.locality, data.myLocation.city, data.myLocation.state, data.myLocation.postalCode].filter(Boolean).join(', ')
                    : 'No location assigned'}
                </Text>
              </View>
              {isSuperAdmin ? members.map((member) => {
                const id = memberId(member);
                const location = member.location || member.assignedLocation;
                return (
                  <View key={id} style={styles.card}>
                    <Text style={styles.cardTitle}>{member.name || member.adminRoleTitle || 'Staff member'}</Text>
                    <Text style={styles.muted}>{member.email || member.phone || member.role || id}</Text>
                    <Text style={styles.muted}>
                      {location
                        ? [location.label, location.line1, location.locality, location.city, location.state, location.postalCode].filter(Boolean).join(', ')
                        : 'Location not assigned'}
                    </Text>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => {
                        setLocationTarget(locationTarget === id ? '' : id);
                        setLocationDraft({
                          label: location?.label || '',
                          line1: location?.line1 || '',
                          locality: location?.locality || '',
                          city: location?.city || '',
                          state: location?.state || '',
                          postalCode: location?.postalCode || '',
                          digipin: location?.digipin || '',
                        });
                      }}
                    >
                      <Text style={styles.secondaryText}>{locationTarget === id ? 'Close editor' : 'Assign location'}</Text>
                    </Pressable>
                    {locationTarget === id && (
                      <>
                        {([
                          ['label', 'Location label'],
                          ['line1', 'Street address'],
                          ['locality', 'Locality'],
                          ['city', 'City *'],
                          ['state', 'State'],
                          ['postalCode', 'Postal code *'],
                          ['digipin', 'DIGIPIN'],
                        ] as const).map(([field, placeholder]) => (
                          <TextInput
                            key={field}
                            style={styles.input}
                            placeholder={placeholder}
                            value={locationDraft[field]}
                            onChangeText={(value) => setLocationDraft((current) => ({ ...current, [field]: value }))}
                            keyboardType={field === 'postalCode' ? 'number-pad' : 'default'}
                            maxLength={field === 'postalCode' ? 6 : undefined}
                          />
                        ))}
                        <Pressable disabled={busy === `location-${id}`} style={styles.primaryButton} onPress={() => void saveLocation(member)}>
                          <Text style={styles.primaryText}>{busy === `location-${id}` ? 'Saving…' : 'Save location'}</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                );
              }) : <Text style={styles.muted}>Only a superadmin can assign staff locations.</Text>}
            </View>
          )}
          {section === 'employees' && (
            <View>
              {members.length ? members.map((member) => {
                const id = memberId(member);
                return (
                  <View key={id} style={styles.card}>
                    <Text style={styles.cardTitle}>{member.name || 'Staff member'} · {member.adminRoleTitle || member.role || 'Employee'}</Text>
                    <Text style={styles.muted}>{member.email || member.phone || id}</Text>
                    <Text style={styles.muted}>
                      {member.isBlocked ? 'Blocked' : member.isApproved === false ? 'Pending review' : 'Active'}
                      {' · '}{(member.permissions || []).join(', ') || 'No assigned permissions'}
                    </Text>
                    {member.isApproved === false && ['admin', 'superadmin'].includes(session.user.role || '') && (
                      <View style={styles.actions}>
                        <Pressable disabled={!!busy} style={styles.primaryButton} onPress={() => void employeeAction(member, 'approve')}>
                          <Text style={styles.primaryText}>{busy === `approve-${id}` ? 'Approving…' : 'Approve'}</Text>
                        </Pressable>
                        <TextInput
                          value={rejectReason}
                          onChangeText={setRejectReason}
                          placeholder="Rejection reason (optional)"
                          style={[styles.input, styles.flex]}
                        />
                        <Pressable disabled={!!busy} style={styles.dangerButton} onPress={() => Alert.alert(
                          'Reject employee?',
                          'The employee will be notified of the rejection.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Reject', style: 'destructive', onPress: () => void employeeAction(member, 'reject') },
                          ],
                        )}>
                          <Text style={styles.dangerText}>Reject</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              }) : <Text style={styles.muted}>No staff members are listed for this account.</Text>}
            </View>
          )}
          {section === 'roles' && (
            <View>
              {roles.map((role) => {
                const id = role.id || role._id || '';
                return (
                  <View key={id || role.roleKey} style={styles.card}>
                    <Text style={styles.cardTitle}>{role.displayName} · {role.roleKey}</Text>
                    <Text style={styles.muted}>{role.description || 'No description'} · {role.assignedCount || 0} assigned</Text>
                    <Text style={styles.muted}>Permissions: {(role.permissions || []).join(', ') || 'None'}</Text>
                    {!role.isSystem && isSuperAdmin && (
                      <View style={styles.actions}>
                        <Pressable style={styles.secondaryButton} onPress={() => editRole(role)}>
                          <Text style={styles.secondaryText}>Edit</Text>
                        </Pressable>
                        <Pressable disabled={!!role.assignedCount} style={[styles.dangerButton, !!role.assignedCount && styles.disabled]} onPress={() => deleteRole(role)}>
                          <Text style={styles.dangerText}>{role.assignedCount ? 'Assigned' : 'Delete'}</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
              {isSuperAdmin && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{editingRoleId ? 'Edit custom role' : 'Create custom role'}</Text>
                  <TextInput style={styles.input} placeholder="Display name" value={roleDraft.displayName} onChangeText={(value) => setRoleDraft((current) => ({ ...current, displayName: value }))} />
                  {!editingRoleId && <TextInput style={styles.input} placeholder="Role key (optional)" autoCapitalize="none" value={roleDraft.roleKey} onChangeText={(value) => setRoleDraft((current) => ({ ...current, roleKey: value }))} />}
                  <TextInput style={styles.input} placeholder="Description" value={roleDraft.description} onChangeText={(value) => setRoleDraft((current) => ({ ...current, description: value }))} />
                  <Text style={styles.fieldLabel}>Permissions</Text>
                  <View style={styles.actions}>
                    {permissionOptions.map(([value, title]) => (
                      <Pressable key={value} style={[styles.permission, roleDraft.permissions.includes(value) && styles.permissionActive]} onPress={() => togglePermission(value)}>
                        <Text style={[styles.permissionText, roleDraft.permissions.includes(value) && styles.permissionTextActive]}>{title}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable disabled={busy === 'save-role'} style={styles.primaryButton} onPress={() => void saveRole()}>
                    <Text style={styles.primaryText}>{busy === 'save-role' ? 'Saving…' : editingRoleId ? 'Save role' : 'Create role'}</Text>
                  </Pressable>
                  {!!editingRoleId && <Pressable style={styles.secondaryButton} onPress={() => {
                    setEditingRoleId('');
                    setRoleDraft({ displayName: '', roleKey: '', description: '', permissions: ['dashboard_view'] });
                  }}><Text style={styles.secondaryText}>Cancel edit</Text></Pressable>}
                </View>
              )}
            </View>
          )}
          {section === 'support' && isSuperAdmin && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Customer support contact</Text>
              <TextInput style={styles.input} placeholder="Priority email" keyboardType="email-address" autoCapitalize="none" value={supportDraft.priorityEmail} onChangeText={(value) => setSupportDraft((current) => ({ ...current, priorityEmail: value }))} />
              <TextInput style={styles.input} placeholder="Helpline" keyboardType="phone-pad" value={supportDraft.helpline} onChangeText={(value) => setSupportDraft((current) => ({ ...current, helpline: value }))} />
              <Pressable disabled={busy === 'support'} style={styles.primaryButton} onPress={() => void saveSupport()}>
                <Text style={styles.primaryText}>{busy === 'support' ? 'Saving…' : 'Save support contact'}</Text>
              </Pressable>
            </View>
          )}
          {section === 'security' && canManageProxy && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reverse proxy</Text>
              <Text style={styles.muted}>Use only ports approved for your Tomato deployment.</Text>
              <View style={styles.switchRow}>
                <Text style={styles.muted}>Enabled</Text>
                <Switch value={proxyDraft.enabled} onValueChange={(enabled) => setProxyDraft((current) => ({ ...current, enabled }))} />
              </View>
              <TextInput style={styles.input} placeholder="Gateway port" keyboardType="number-pad" value={proxyDraft.gatewayPort} onChangeText={(value) => setProxyDraft((current) => ({ ...current, gatewayPort: value }))} />
              <TextInput style={styles.input} placeholder="Backend port" keyboardType="number-pad" value={proxyDraft.backendPort} onChangeText={(value) => setProxyDraft((current) => ({ ...current, backendPort: value }))} />
              {!!data?.reverseProxy?.gatewayUrl && <Text style={styles.muted}>Gateway: {data.reverseProxy.gatewayUrl}</Text>}
              {!!data?.reverseProxy?.backendUrl && <Text style={styles.muted}>Backend: {data.reverseProxy.backendUrl}</Text>}
              <Pressable disabled={busy === 'reverse-proxy'} style={styles.primaryButton} onPress={() => void saveReverseProxy()}>
                <Text style={styles.primaryText}>{busy === 'reverse-proxy' ? 'Updating…' : 'Update proxy settings'}</Text>
              </Pressable>
            </View>
          )}
          <Pressable style={styles.secondaryButton} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Refresh control panel</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: '#d83a32', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 8 },
  title: { color: '#2d2621', fontSize: 24, fontWeight: '800', marginTop: 4 },
  muted: { color: '#766d68', fontSize: 12, lineHeight: 18, marginTop: 4 },
  sections: { gap: 8, paddingVertical: 12 },
  sectionChip: { borderColor: '#eaded7', borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  sectionChipActive: { borderColor: '#d83a32', backgroundColor: '#d83a32' },
  sectionChipText: { color: '#6b625d', fontWeight: '700', fontSize: 11 },
  sectionChipTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#f0e7e1', marginBottom: 10 },
  cardTitle: { color: '#292421', fontSize: 14, fontWeight: '800' },
  input: { minHeight: 42, borderWidth: 1, borderColor: '#eaded7', borderRadius: 10, paddingHorizontal: 11, marginTop: 8, color: '#292421', backgroundColor: '#fff' },
  fieldLabel: { color: '#463e39', fontSize: 12, fontWeight: '700', marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 8 },
  flex: { flex: 1 },
  primaryButton: { minHeight: 38, justifyContent: 'center', alignItems: 'center', backgroundColor: '#d83a32', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  secondaryButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff1ed', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, marginTop: 8, alignSelf: 'flex-start' },
  secondaryText: { color: '#c2352d', fontWeight: '800', fontSize: 11 },
  dangerButton: { minHeight: 36, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fae7e4', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  dangerText: { color: '#a9241c', fontWeight: '800', fontSize: 11 },
  disabled: { opacity: 0.45 },
  permission: { borderColor: '#eaded7', borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7 },
  permissionActive: { borderColor: '#d83a32', backgroundColor: '#fff1ed' },
  permissionText: { color: '#6b625d', fontSize: 10, fontWeight: '700' },
  permissionTextActive: { color: '#c2352d' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  error: { color: '#a9241c', backgroundColor: '#fae7e4', padding: 10, borderRadius: 9, marginBottom: 8 },
  loader: { marginTop: 25 },
});
