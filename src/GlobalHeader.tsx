import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import ProfileAccess from './ProfileAccess';
import type { ProfileMenuItem } from './ProfileAccess';
import { isAdminUser } from './types';
import type { Session, User } from './types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type GlobalHeaderProps = {
  session: Session;
  brandSubtitle?: string;
  onBrandPress?: () => void;

  // Search
  searchQuery?: string;
  onSearchChange?: (text: string) => void;
  searchPlaceholder?: string;
  showSearch?: boolean;

  // Address, City & Pincode
  addressText?: string;
  city?: string;
  pincode?: string;
  onAddressPress?: () => void;

  // Notifications
  onNotificationPress?: () => void;
  hasUnreadNotifications?: boolean;

  // Additional Actions (e.g. Cart, Refresh)
  rightActions?: React.ReactNode;

  // Profile
  roleLabel: string;
  profileMenuItems: ProfileMenuItem[];
  onNavigateProfile: (key: string) => void;
  onSignOut: () => void;
  onSessionUserUpdate: (user: User) => Promise<void>;
};

export default function GlobalHeader({
  session,
  brandSubtitle,
  onBrandPress,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search…',
  showSearch = true,
  addressText,
  city,
  pincode,
  onAddressPress,
  onNotificationPress,
  hasUnreadNotifications = false,
  rightActions,
  roleLabel,
  profileMenuItems,
  onNavigateProfile,
  onSignOut,
  onSessionUserUpdate,
}: GlobalHeaderProps) {
  const [isFocused, setIsFocused] = useState(false);
  const searchInputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  // Animated Tomato icon values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const tapScale = useRef(new Animated.Value(1)).current;

  // Continuous subtle pulse animation
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const triggerSearchLayout = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const handleBrandPress = () => {
    Animated.sequence([
      Animated.timing(tapScale, {
        toValue: 0.85,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(tapScale, {
        toValue: 1,
        friction: 3.5,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.sequence([
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: -1,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnim, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();

    if (isFocused) {
      triggerSearchLayout();
      setIsFocused(false);
      Keyboard.dismiss();
    }

    onBrandPress?.();
  };

  const rotateDeg = rotateAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-16deg', '0deg', '16deg'],
  });

  const isSearchActive = isFocused || Boolean(searchQuery && searchQuery.trim().length > 0);

  // Determine if user is a restaurant, shop, admin, subadmin, or superadmin
  const rawRole = (session.user.role || session.user.baseRole || '').toLowerCase();
  const labelRole = (roleLabel || '').toLowerCase();
  const isStoreOrAdmin =
    rawRole === 'restaurant'
    || rawRole === 'shop'
    || rawRole === 'admin'
    || rawRole === 'subadmin'
    || rawRole === 'superadmin'
    || Boolean(session.user.isSuperAdmin)
    || isAdminUser(session.user)
    || labelRole.includes('restaurant')
    || labelRole.includes('shop')
    || labelRole.includes('admin')
    || labelRole.includes('subadmin')
    || labelRole.includes('superadmin');

  // Formatted city, address & pincode
  const userCity = (
    city
    || session.user.city
    || (rawRole === 'restaurant' || labelRole.includes('restaurant') ? 'Bengaluru'
      : rawRole === 'shop' || labelRole.includes('shop') ? 'Bengaluru'
      : (rawRole === 'admin' || rawRole === 'subadmin' || rawRole === 'superadmin' || labelRole.includes('admin') || isAdminUser(session.user)) ? 'New Delhi'
      : '')
  ).trim();

  const displayPincode = (
    pincode
    || session.user.pincode
    || session.user.postalCode
    || ((rawRole === 'restaurant' || labelRole.includes('restaurant') || rawRole === 'shop' || labelRole.includes('shop')) ? '560001'
      : (rawRole === 'admin' || rawRole === 'subadmin' || rawRole === 'superadmin' || labelRole.includes('admin') || isAdminUser(session.user)) ? '110001'
      : '')
  ).trim();

  const displayAddress = addressText || (session.user.role === 'customer' ? 'Delivering to you' : 'Service area');

  // Show "<city><pincode>" for restaurants, shops, admins, subadmins, and superadmin
  const locationDisplayText = isStoreOrAdmin
    ? [userCity, displayPincode].filter(Boolean).join(' ')
    : [displayAddress, displayPincode].filter(Boolean).join(' · ');

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        {/* Left Side: Brand and expanding search */}
        <View style={styles.headerMain}>
          <View style={styles.brandSearchRow}>
            {/* Animated Tomato brand */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tomato home"
              onPress={handleBrandPress}
              style={styles.brandButton}
            >
              <Animated.Text
                style={[
                  styles.brandEmoji,
                  {
                    transform: [
                      { scale: Animated.multiply(pulseAnim, tapScale) },
                      { rotate: rotateDeg },
                    ],
                  },
                ]}
              >
                🍅
              </Animated.Text>
              <Text style={styles.brandText}>
                {isSearchActive ? 'T' : 'Tomato'}
              </Text>
            </Pressable>

            {/* Expanding search while typing / focused */}
            {showSearch && onSearchChange && (
              <View style={[styles.searchWrap, isSearchActive && styles.searchWrapExpanded]}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  ref={searchInputRef}
                  accessibilityLabel="Search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  numberOfLines={1}
                  returnKeyType="search"
                  selectionColor="#d83a32"
                  value={searchQuery}
                  placeholder={searchPlaceholder}
                  placeholderTextColor="#78716c"
                  style={styles.searchInput}
                  onFocus={() => {
                    triggerSearchLayout();
                    setIsFocused(true);
                  }}
                  onBlur={() => {
                    triggerSearchLayout();
                    setIsFocused(false);
                  }}
                  onChangeText={(text) => {
                    if (!isFocused) {
                      triggerSearchLayout();
                      setIsFocused(true);
                    }
                    onSearchChange(text);
                  }}
                />
                {Boolean(searchQuery) && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      onSearchChange('');
                    }}
                    style={styles.searchClearBtn}
                  >
                    <Text style={styles.searchClearText}>✕</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Address & Pincode in the header */}
          <Pressable
            disabled={!onAddressPress}
            onPress={onAddressPress}
            style={[styles.addressRow, !onAddressPress && { opacity: 0.9 }]}
          >
            <Text style={styles.locationPin}>📍</Text>
            <Text numberOfLines={1} style={styles.addressText}>
              {locationDisplayText}
            </Text>
            {Boolean(onAddressPress) && <Text style={styles.dropdownCaret}>▾</Text>}
          </Pressable>
        </View>

        {/* Right Side: Notification, custom actions, and Profile Avatar */}
        <View style={styles.headerActions}>
          {Boolean(onNotificationPress) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={onNotificationPress}
              style={styles.iconButton}
            >
              <Text style={styles.notificationIcon}>🔔</Text>
              {hasUnreadNotifications && <View style={styles.unreadDot} />}
            </Pressable>
          )}

          {rightActions}

          <ProfileAccess
            session={session}
            roleLabel={roleLabel}
            iconOnly
            items={profileMenuItems}
            onNavigate={onNavigateProfile}
            onSignOut={onSignOut}
            onSessionUserUpdate={onSessionUserUpdate}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e9e2',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  brandSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  brandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  brandEmoji: {
    fontSize: 20,
    marginRight: 4,
  },
  brandText: {
    fontSize: 19,
    fontWeight: '900',
    color: '#d83a32',
    letterSpacing: -0.4,
  },
  searchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderWidth: 1.5,
    borderColor: '#e7e5e4',
    borderRadius: 19,
    backgroundColor: '#f5f5f4',
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  searchWrapExpanded: {
    borderColor: '#d83a32',
    backgroundColor: '#ffffff',
    shadowColor: '#d83a32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  searchIcon: {
    fontSize: 12,
    marginRight: 4,
    color: '#78716c',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: '#1c1917',
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 2,
    margin: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  searchClearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#e7e5e4',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  searchClearText: {
    fontSize: 10,
    color: '#57534e',
    fontWeight: '700',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingRight: 6,
  },
  locationPin: {
    fontSize: 11,
    marginRight: 3,
  },
  addressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#44403c',
    flexShrink: 1,
  },
  dropdownCaret: {
    fontSize: 12,
    fontWeight: '800',
    color: '#d83a32',
    marginLeft: 3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff7f5',
    borderWidth: 1,
    borderColor: '#fce7e3',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notificationIcon: {
    fontSize: 18,
  },
  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d83a32',
  },
});
