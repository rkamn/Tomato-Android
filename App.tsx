import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import AuthScreen from './src/AuthScreen';
import CustomerApp from './src/CustomerApp';
import PartnerApp from './src/PartnerApp';
import RiderApp from './src/RiderApp';
import AdminApp from './src/AdminApp';
import { isAdminUser } from './src/types';
import type { AccountRole, Session, User } from './src/types';

const SESSION_KEY = 'tomato.session';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(SESSION_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        const restored = JSON.parse(stored) as Session;
        if (
          restored.token
          && (
            ['customer', 'restaurant', 'shop', 'deliveryPartner'].includes(restored.user?.role || '')
            || isAdminUser(restored.user || {})
          )
        ) {
          setSession(restored);
        } else {
          return SecureStore.deleteItemAsync(SESSION_KEY);
        }
      })
      .catch((error: unknown) => {
        console.warn('Unable to restore Tomato session:', error);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn(token: string, user: User) {
    const nextSession = { token, user };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setSession(null);
  }

  async function updateSessionUser(user: User) {
    if (!session) return;
    const nextSession = {
      ...session,
      user: { ...session.user, ...user },
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {restoring ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#d83a32" />
        </View>
      ) : session ? (
        isAdminUser(session.user) ? (
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fffaf5' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
