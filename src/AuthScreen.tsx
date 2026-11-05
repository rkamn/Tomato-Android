import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import { decodeDigipin, isValidDigipin, normalizeDigipin } from './digipin';
import { isAdminUser } from './types';
import type { AccountRole, User } from './types';

type AuthResponse = { token: string; user: User };

type Props = {
  onAuthenticated: (token: string, user: User) => Promise<void>;
  onCancel?: () => void;
};

export default function AuthScreen({ onAuthenticated, onCancel }: Props) {
  const [registering, setRegistering] = useState(false);
  const [role, setRole] = useState<AccountRole>('customer');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pickupAddress, setPickupAddress] = useState('');
  const [pincode, setPincode] = useState('');
  const [digipin, setDigipin] = useState('');
  const [vehicle, setVehicle] = useState('motorcycle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardOpen(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardOpen(false);
      if (!registering) {
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [registering]);

  function slideUpForInput(yOffset = 130) {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: yOffset, animated: true });
    }, 80);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: yOffset, animated: true });
    }, 260);
  }

  async function submit() {
    setError('');
    if (registering && !name.trim()) {
      setError('Enter your name to create an account.');
      return;
    }
    const cleanDigipin = normalizeDigipin(digipin);
    if (registering && (role === 'restaurant' || role === 'shop')) {
      if (!cleanDigipin) {
        setError('A pickup DIGIPIN is required to register a restaurant or shop.');
        return;
      }
      if (!isValidDigipin(cleanDigipin)) {
        setError('Enter a valid pickup DIGIPIN (e.g. 10 alphanumeric characters).');
        return;
      }
    }
    if (registering && role === 'customer' && cleanDigipin && !isValidDigipin(cleanDigipin)) {
      setError('Enter a valid delivery DIGIPIN (e.g. 10 alphanumeric characters).');
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
                  ? {
                    restaurantAddress: pickupAddress.trim(),
                    pincode: pincode.trim(),
                    digipin: cleanDigipin,
                    ...(decodeDigipin(cleanDigipin) ? {
                      location: { type: 'Point', coordinates: [decodeDigipin(cleanDigipin)!.lng, decodeDigipin(cleanDigipin)!.lat] },
                    } : {}),
                  }
                  : {}),
                ...(role === 'shop'
                  ? {
                    shopAddress: pickupAddress.trim(),
                    pincode: pincode.trim(),
                    digipin: cleanDigipin,
                    ...(decodeDigipin(cleanDigipin) ? {
                      location: { type: 'Point', coordinates: [decodeDigipin(cleanDigipin)!.lng, decodeDigipin(cleanDigipin)!.lat] },
                    } : {}),
                  }
                  : {}),
                ...(role === 'customer' && cleanDigipin
                  ? {
                    digipin: cleanDigipin,
                    ...(decodeDigipin(cleanDigipin) ? {
                      location: { type: 'Point', coordinates: [decodeDigipin(cleanDigipin)!.lng, decodeDigipin(cleanDigipin)!.lat] },
                    } : {}),
                  }
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
      const userWithCustomer = {
        ...result.user,
        ...((result.user?.role === 'customer' || !result.user?.role) && !result.user?.customerId
          ? { customerId: 'cust-1001' }
          : {}),
        ...(result.user?.role === 'restaurant' && !result.user?.restaurantId
          ? { restaurantId: 'rest-7067' }
          : {}),
        ...(result.user?.role === 'shop' && !result.user?.shopId
          ? { shopId: 'shop-7067' }
          : {}),
        ...((result.user?.role === 'deliveryPartner' || result.user?.role === 'rider') && !result.user?.riderId
          ? { riderId: 'rider-7067' }
          : {}),
      };
      await onAuthenticated(result.token, userWithCustomer);
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
      <View style={styles.ambientBackground} pointerEvents="none">
        <View style={styles.ambientOrb1} />
        <View style={styles.ambientOrb2} />
        <View style={styles.ambientOrb3} />
        <View style={styles.ambientOrb4} />
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.container,
          keyboardOpen && styles.containerKeyboardOpen,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {Boolean(onCancel) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sign in and browse as guest"
            onPress={onCancel}
            style={styles.cancelGuestBtn}
          >
            <Text style={styles.cancelGuestBtnText}>✕ Continue as guest</Text>
          </Pressable>
        )}
        <View style={styles.brandMark}>
          <Text style={styles.brandEmoji}>🍅</Text>
        </View>
        <Text style={styles.brand}>Tomato</Text>
        <Text style={styles.tagline}>One app for Food & Grocery</Text>

        <View style={styles.card}>
          <Text style={styles.title}>
            {registering ? 'Create your account' : 'Welcome back'}
          </Text>
          <Text style={styles.subtitle}>
            {registering
              ? 'Choose your account type to get started.'
              : 'Sign in to continue Tomato workspace.'}
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
                onFocus={() => slideUpForInput(80)}
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
                    onFocus={() => slideUpForInput(140)}
                    placeholder={role === 'shop' ? 'Shop pickup address' : 'Restaurant pickup address'}
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={pickupAddress}
                  />
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={10}
                    onChangeText={setPincode}
                    onFocus={() => slideUpForInput(180)}
                    placeholder="Serviceable pincode"
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={pincode}
                  />
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={setDigipin}
                    onFocus={() => slideUpForInput(220)}
                    placeholder="Pickup location DIGIPIN *"
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={digipin}
                  />
                  <Text style={styles.fieldHint}>The web service requires a DIGIPIN to register partner locations.</Text>
                </>
              )}
              {role === 'customer' && (
                <>
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={setDigipin}
                    onFocus={() => slideUpForInput(180)}
                    placeholder="Delivery DIGIPIN (optional)"
                    placeholderTextColor="#998f88"
                    style={styles.input}
                    value={digipin}
                  />
                  <Text style={styles.fieldHint}>Add your National Addressing Grid DIGIPIN for precise doorstep deliveries.</Text>
                </>
              )}
              {role === 'deliveryPartner' && (
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setVehicle}
                  onFocus={() => slideUpForInput(160)}
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
            onFocus={() => slideUpForInput(registering ? 220 : 130)}
            placeholder="Email or mobile number"
            placeholderTextColor="#998f88"
            style={styles.input}
            value={identifier}
          />
          <View style={styles.passwordContainer}>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete={registering ? 'new-password' : 'current-password'}
              onChangeText={setPassword}
              onFocus={() => slideUpForInput(registering ? 270 : 170)}
              onSubmitEditing={submit}
              placeholder="Password"
              placeholderTextColor="#998f88"
              secureTextEntry={!showPassword}
              style={styles.passwordInput}
              value={password}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'View password'}
              hitSlop={8}
              onPress={() => setShowPassword((prev) => !prev)}
              style={styles.eyeButton}
            >
              <View style={styles.eyeIconWrapper}>
                <Text style={[styles.eyeIcon, showPassword && styles.eyeIconActive]}>👁️</Text>
                {!showPassword && <View style={styles.eyeSlash} />}
              </View>
            </Pressable>
          </View>

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
  flex: { flex: 1, backgroundColor: '#fdfbf9' },
  ambientBackground: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  ambientOrb1: {
    position: 'absolute',
    top: -50,
    left: -40,
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: '#ff5c50',
    opacity: 0.28,
  },
  ambientOrb2: {
    position: 'absolute',
    top: 60,
    right: -60,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#ffaa55',
    opacity: 0.32,
  },
  ambientOrb3: {
    position: 'absolute',
    top: '42%',
    left: -70,
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: '#ff7f73',
    opacity: 0.22,
  },
  ambientOrb4: {
    position: 'absolute',
    bottom: -60,
    right: -40,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#ffa366',
    opacity: 0.25,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: 44,
    paddingBottom: 34,
  },
  containerKeyboardOpen: {
    justifyContent: 'flex-start',
    paddingTop: 20,
    paddingBottom: 280,
  },
  cancelGuestBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 7,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
    shadowColor: '#a82c24',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cancelGuestBtnText: {
    color: '#65574c',
    fontSize: 12,
    fontWeight: '700',
  },
  brandMark: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    marginBottom: 12,
    shadowColor: '#d83a32',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  brandEmoji: { fontSize: 38 },
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
    marginBottom: 26,
  },
  fieldLabel: { color: '#574d44', fontSize: 12, fontWeight: '700', marginBottom: 8 },
  fieldHint: { color: '#847a72', fontSize: 11, lineHeight: 16, marginTop: -5, marginBottom: 12 },
  roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  roleChoice: {
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    borderColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1.2,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  roleChoiceActive: {
    borderColor: '#d83a32',
    backgroundColor: 'rgba(255, 235, 230, 0.92)',
  },
  roleChoiceText: { color: '#756c65', fontSize: 12, fontWeight: '600' },
  roleChoiceTextActive: { color: '#c8322a', fontWeight: '800' },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: 1.5,
    borderRadius: 30,
    padding: 24,
    shadowColor: '#9e2d24',
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  title: { color: '#28221e', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#776d65', fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 20 },
  input: {
    height: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1.5,
    borderRadius: 26,
    paddingHorizontal: 20,
    color: '#28221e',
    fontSize: 15,
    marginBottom: 12,
    shadowColor: '#a82c24',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  passwordContainer: {
    height: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1.5,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingRight: 8,
    paddingLeft: 4,
    shadowColor: '#a82c24',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  passwordInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: 16,
    color: '#28221e',
    fontSize: 15,
  },
  eyeButton: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeIconWrapper: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  eyeIcon: {
    fontSize: 18,
    opacity: 0.55,
  },
  eyeIconActive: {
    opacity: 1,
  },
  eyeSlash: {
    position: 'absolute',
    width: 19,
    height: 2,
    backgroundColor: '#786d65',
    transform: [{ rotate: '-45deg' }],
    borderRadius: 1,
  },
  error: {
    color: '#b42318',
    backgroundColor: 'rgba(255, 241, 240, 0.92)',
    borderColor: 'rgba(254, 205, 202, 0.8)',
    borderWidth: 1,
    padding: 11,
    borderRadius: 14,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: '#d83a32',
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderTopWidth: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#d83a32',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
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
