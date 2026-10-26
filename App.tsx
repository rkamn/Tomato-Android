import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { ApiError, apiRequest, setUnauthorizedHandler } from './src/api';
import AuthScreen from './src/AuthScreen';
import CustomerApp from './src/CustomerApp';
import PartnerApp from './src/PartnerApp';
import RiderApp from './src/RiderApp';
import AdminApp from './src/AdminApp';
import { isAdminUser } from './src/types';
import type { AccountRole, Session, User } from './src/types';

const SESSION_KEY = 'tomato.session';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Tomato Root ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>🍅</Text>
          <Text style={styles.errorTitle}>Tomato encountered an issue</Text>
          <Text style={styles.errorDetail}>
            {this.state.error?.message || 'An unexpected error occurred during application startup.'}
          </Text>
          <Pressable
            style={styles.errorBtn}
            onPress={async () => {
              try {
                await SecureStore.deleteItemAsync(SESSION_KEY);
              } catch {}
              this.setState({ hasError: false, error: null });
            }}
          >
            <Text style={styles.errorBtnText}>Clear Session & Restart</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    setUnauthorizedHandler(() => {
      void signOut();
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 400);
    });

    Promise.race([
      SecureStore.getItemAsync(SESSION_KEY).catch(() => null),
      timeoutPromise,
    ])
      .then((stored) => {
        if (!active || !stored) return;
        try {
          const restored = JSON.parse(stored) as Session;
          if (
            restored?.token
            && (
              ['customer', 'restaurant', 'shop', 'deliveryPartner'].includes(restored.user?.role || '')
              || isAdminUser(restored.user || {})
            )
          ) {
            const user = {
              ...restored.user,
              ...((restored.user?.role === 'customer' || !restored.user?.role) && !restored.user?.customerId
                ? { customerId: 'cust-1001' }
                : {}),
            };
            setSession({ token: restored.token, user });

            // Background non-blocking profile validation
            apiRequest<{ user: User }>('/api/auth/profile', restored.token)
              .then((res) => {
                if (active && res?.user) {
                  const updatedUser = {
                    ...user,
                    ...res.user,
                    ...((res.user.role === 'customer' || user.role === 'customer' || !res.user.role) && !res.user.customerId && !user.customerId
                      ? { customerId: 'cust-1001' }
                      : {}),
                  };
                  setSession({ token: restored.token, user: updatedUser });
                }
              })
              .catch((err) => {
                if (err instanceof ApiError && err.status === 401) {
                  void signOut();
                }
              });
            return;
          }
        } catch {
          // ignore parsing error
        }
        void SecureStore.deleteItemAsync(SESSION_KEY).catch(() => null);
      })
      .catch((error: unknown) => {
        console.warn('Unable to restore Tomato session:', error);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });

    return () => {
      active = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  async function signIn(token: string, user: User) {
    const normalizedUser = {
      ...user,
      ...((user.role === 'customer' || !user.role) && !user.customerId ? { customerId: 'cust-1001' } : {}),
    };
    const nextSession = { token, user: normalizedUser };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(nextSession)).catch(() => null);
    setSession(nextSession);
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => null);
    setSession(null);
  }

  async function updateSessionUser(user: User) {
    if (!session) return;
    const mergedUser = {
      ...session.user,
      ...user,
      ...((user.role === 'customer' || session.user.role === 'customer' || !user.role) && !user.customerId && !session.user.customerId
        ? { customerId: 'cust-1001' }
        : {}),
    };
    const nextSession = {
      ...session,
      user: mergedUser,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(nextSession)).catch(() => null);
    setSession(nextSession);
  }

  return (
    <ErrorBoundary>
      <View style={styles.root}>
        <StatusBar style="dark" />
        {restoring ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#d83a32" />
          </View>
        ) : session ? (
          isAdminUser(session.user || {}) ? (
            <AdminApp session={session} onSignOut={signOut} onSessionUserUpdate={updateSessionUser} />
          ) : session.user.role === 'customer' ? (
            <CustomerApp session={session} onSignOut={signOut} onSessionUserUpdate={updateSessionUser} />
          ) : session.user.role === 'deliveryPartner' ? (
            <RiderApp session={session} onSignOut={signOut} onSessionUserUpdate={updateSessionUser} />
          ) : session.user.role === 'restaurant' || session.user.role === 'shop' ? (
            <PartnerApp
              session={session}
              partnerRole={session.user.role as Extract<AccountRole, 'restaurant' | 'shop'>}
              onSignOut={signOut}
              onSessionUserUpdate={updateSessionUser}
            />
          ) : (
            <AuthScreen onAuthenticated={signIn} />
          )
        ) : (
          <AuthScreen onAuthenticated={signIn} />
        )}
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fffaf5' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorContainer: {
    flex: 1,
    backgroundColor: '#fffaf5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorEmoji: { fontSize: 48, marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: '800', color: '#2d2621', marginBottom: 8 },
  errorDetail: { fontSize: 13, color: '#786d65', textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  errorBtn: { backgroundColor: '#d83a32', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },
  errorBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
