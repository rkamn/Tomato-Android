import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiRequest } from './api';
import { isAdminUser } from './types';
import type { AccountRole, User } from './types';

type AuthResponse = { token: string; user: User };

type Props = {
  onAuthenticated: (token: string, user: User) => Promise<void>;
};

export default function AuthScreen({ onAuthenticated }: Props) {
  const [registering, setRegistering] = useState(false);
  const [role, setRole] = useState<AccountRole>('customer');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [digipin, setDigipin] = useState('');
  const [vehicle, setVehicle] = useState('motorcycle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (registering && !name.trim()) {
      setError('Enter your name to create an account.');
      return;
    }
    if (registering && (role === 'restaurant' || role === 'shop') && !digipin.trim()) {
      setError('A pickup DIGIPIN is required to register a restaurant or shop.');
      return;
    }
    if (!identifier.trim() || !password) {
      setError('Enter your email or mobile number and password.');
      return;
    }

    setBusy(true);
    try {
      const isEmail = identifier.trim().includes('@');
      const result = await apiRequest<AuthResponse>(
        registering ? '/api/auth/register' : '/api/auth/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(registering
              ? {
                name: name.trim(),
                role,
                ...(role === 'restaurant'
                  ? { restaurantAddress: pickupAddress.trim(), pincode: pincode.trim(), digipin: digipin.trim() }
                  : {}),
                ...(role === 'shop'
                  ? { shopAddress: pickupAddress.trim(), pincode: pincode.trim(), digipin: digipin.trim() }
                  : {}),
                ...(role === 'deliveryPartner' ? { deliveryVehicle: vehicle } : {}),
              }
              : {}),
            identifier: identifier.trim(),
            ...(isEmail
              ? { email: identifier.trim() }
              : { phone: identifier.trim() }),
            password,
          }),
        },
      );

      if (
        !['customer', 'restaurant', 'shop', 'deliveryPartner'].includes(result.user?.role || '')
        && !( !registering && isAdminUser(result.user || {}) )
      ) {
        setError('This Tomato app supports customer, restaurant, shop, rider, and provisioned admin accounts.');
        return;
      }
      await onAuthenticated(result.token, result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  function toggleMode(next: boolean) {
    setRegistering(next);
    setError('');
    if (!next) setRole('customer');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandMark}>
          <Text style={styles.brandEmoji}>🍅</Text>
        </View>
        <Text style={styles.brand}>Tomato</Text>
        <Text style={styles.tagline}>One Tomato app for every role.</Text>

        <View style={styles.card}>
          <Text style={styles.title}>
            {registering ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text style={styles.subtitle}>
            {registering
              ? 'Choose your account type to get started.'
              : 'Sign in to continue to your Tomato workspace.'}
          </Text>

          {registering && (
            <>
              <Text style={styles.fieldLabel}>I am joining as</Text>
              <View style={styles.roleChoices}>
                {([
                  ['customer', 'Customer'],
                  ['restaurant', 'Restaurant'],
                  ['shop', 'Shop'],
                  ['deliveryPartner', 'Rider'],
                ] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setRole(value);
                      setError('');
                    }}
                    style={[styles.roleChoice, role === value && styles.roleChoiceActive]}
                  >
                    <Text style={[styles.roleChoiceText, role === value && styles.roleChoiceTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Your name"
                autoCapitalize="words"
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor="#998f88"
                style={styles.input}
                value={name}
              />
              {(role === 'restaurant' || role === 'shop') && (
                <>
                  <TextInput
                    autoCapitalize="words"
                    onChangeText={setPickupAddress}
                    placeholder={role === 'shop' ? 'Shop pickup address' : 'Restaurant pickup address'}
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={pickupAddress}
                  />
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={10}
                    onChangeText={setPincode}
                    placeholder="Serviceable pincode"
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={pincode}
                  />
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={setDigipin}
                    placeholder="Pickup location DIGIPIN *"
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={digipin}
                  />
                  <Text style={styles.fieldHint}>The web service requires a DIGIPIN to register partner locations.</Text>
                </>
              )}
              {role === 'deliveryPartner' && (
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setVehicle}
                  placeholder="Delivery vehicle (e.g. motorcycle)"
                  placeholderTextColor="#998f88"
                  style={styles.input}
                  value={vehicle}
                />
              )}
            </>
          )}
          <TextInput
            accessibilityLabel="Email or mobile number"
            autoCapitalize="none"
            autoComplete="username"
            keyboardType="email-address"
            onChangeText={setIdentifier}
            placeholder="Email or mobile number"
            placeholderTextColor="#998f88"
            style={styles.input}
            value={identifier}
          />
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete={registering ? 'new-password' : 'current-password'}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Password"
            placeholderTextColor="#998f88"
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>
                {registering ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </Pressable>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {registering ? 'Already have an account?' : 'New to Tomato?'}
            </Text>
            <Pressable onPress={() => toggleMode(!registering)}>
              <Text style={styles.switchAction}>
                {registering ? ' Sign in' : ' Create account'}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.footnote}>
          Your account and orders are protected by Tomato.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: 44,
    paddingBottom: 34,
  },
  brandMark: {
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffebe4',
    marginBottom: 12,
  },
  brandEmoji: { fontSize: 36 },
  brand: {
    color: '#d83a32',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -1,
  },
  tagline: {
    color: '#756c65',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 28,
  },
  fieldLabel: { color: '#625950', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  fieldHint: { color: '#847a72', fontSize: 11, lineHeight: 16, marginTop: -5, marginBottom: 12 },
  roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  roleChoice: { borderColor: '#ece3dc', borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 11 },
  roleChoiceActive: { borderColor: '#d83a32', backgroundColor: '#fff0eb' },
  roleChoiceText: { color: '#756c65', fontSize: 12, fontWeight: '600' },
  roleChoiceTextActive: { color: '#c8322a', fontWeight: '800' },
  card: {
    backgroundColor: '#fff',
    borderColor: '#f0e8e1',
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    shadowColor: '#4b2f1c',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: { color: '#28221e', fontSize: 23, fontWeight: '800' },
  subtitle: { color: '#776d65', fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 20 },
  input: {
    height: 52,
    backgroundColor: '#fffaf7',
    borderColor: '#ece3dc',
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 15,
    color: '#28221e',
    fontSize: 15,
    marginBottom: 12,
  },
  error: {
    color: '#b42318',
    backgroundColor: '#fff1f0',
    padding: 11,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#d83a32',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.65 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  switchText: { color: '#756c65', fontSize: 13 },
  switchAction: { color: '#c8322a', fontSize: 13, fontWeight: '700' },
  footnote: { textAlign: 'center', color: '#92877f', fontSize: 12, marginTop: 22 },
});
