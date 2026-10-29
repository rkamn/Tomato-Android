import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { resolveCustomerDigipin } from './digipin';
import type { Order, User } from './types';

export type NewDeliveryOfferModalProps = {
  visible: boolean;
  order: Order | null;
  rider: User;
  operatingPincode?: string;
  onAccept: (order: Order) => void | Promise<void>;
  onViewOffer: () => void;
  onClose: () => void;
  isLoading?: boolean;
};

function extractPincode(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b([1-9][0-9]{5})\b/);
  return match ? match[1] : undefined;
}

export function getRiderServiceablePincodes(rider?: User | null, activeAreaPincode?: string): string[] {
  const raw = String(activeAreaPincode || rider?.pincode || rider?.postalCode || '').trim();
  if (!raw) return ['560001'];
  const matches = raw.match(/\b([1-9][0-9]{5})\b/g);
  if (matches && matches.length > 0) {
    return Array.from(new Set(matches));
  }
  const clean = raw.replace(/\D/g, '');
  if (clean.length === 6) return [clean];
  return ['560001'];
}

export function getOrderPincodes(order?: Order | null): { pickupPin: string; deliveryPin: string; allPins: string[] } {
  if (!order) return { pickupPin: '', deliveryPin: '', allPins: [] };
  const pickupAddress = order.restaurantAddress || order.shopAddress || order.restaurantName || order.shopName || '';
  const dropAddress = [
    order.deliveryAddress?.line1,
    order.deliveryAddress?.line2,
    order.deliveryAddress?.locality,
    order.deliveryAddress?.city,
    order.deliveryAddress?.postalCode,
  ].filter(Boolean).join(', ');

  const rawPickup = String(
    (order as any).pickupPincode ||
    (order as any).restaurantPincode ||
    (order as any).shopPincode ||
    (order as any).pickupAddress?.postalCode ||
    extractPincode(pickupAddress) ||
    ''
  ).trim();

  const rawDelivery = String(
    order.deliveryAddress?.postalCode ||
    (order as any).deliveryAddress?.pincode ||
    (order as any).customerPincode ||
    extractPincode(dropAddress) ||
    ''
  ).trim();

  const pickupPin = extractPincode(rawPickup) || (/^[1-9][0-9]{5}$/.test(rawPickup) ? rawPickup : '');
  const deliveryPin = extractPincode(rawDelivery) || (/^[1-9][0-9]{5}$/.test(rawDelivery) ? rawDelivery : '');

  const set = new Set<string>();
  if (pickupPin) set.add(pickupPin);
  if (deliveryPin) set.add(deliveryPin);

  const pickupMatches = pickupAddress.match(/\b([1-9][0-9]{5})\b/g);
  if (pickupMatches) pickupMatches.forEach((p) => set.add(p));

  const dropMatches = dropAddress.match(/\b([1-9][0-9]{5})\b/g);
  if (dropMatches) dropMatches.forEach((p) => set.add(p));

  return {
    pickupPin,
    deliveryPin,
    allPins: Array.from(set),
  };
}

export function isOrderInServiceablePincode(
  order: Order | null | undefined,
  rider: User | null | undefined,
  activeAreaPincode?: string,
): boolean {
  if (!order || !rider) return false;
  const riderPins = getRiderServiceablePincodes(rider, activeAreaPincode);
  const { pickupPin, deliveryPin, allPins } = getOrderPincodes(order);

  if (allPins.length === 0 && !pickupPin && !deliveryPin) {
    return false;
  }

  return riderPins.some((pin) => pin === pickupPin || pin === deliveryPin || allPins.includes(pin));
}

export default function NewDeliveryOfferModal({
  visible,
  order,
  rider,
  operatingPincode,
  onAccept,
  onViewOffer,
  onClose,
  isLoading = false,
}: NewDeliveryOfferModalProps) {
  if (!order) return null;

  const orderPins = getOrderPincodes(order);
  const riderPins = getRiderServiceablePincodes(rider, operatingPincode);
  const matchedPin = riderPins.find(
    (pin) => pin === orderPins.pickupPin || pin === orderPins.deliveryPin || orderPins.allPins.includes(pin)
  ) || riderPins[0] || '560001';

  const storeName = order.restaurantName || order.shopName || (order.isShopOrder ? 'Shop Partner' : 'Restaurant Partner');
  const pickupAddress = order.restaurantAddress || order.shopAddress || storeName;
  const dropAddress = [
    order.deliveryAddress?.line1,
    order.deliveryAddress?.line2,
    order.deliveryAddress?.locality,
    order.deliveryAddress?.city,
    order.deliveryAddress?.postalCode,
  ].filter(Boolean).join(', ') || 'Customer address';

  const customerDigipin = resolveCustomerDigipin(order) || order.deliveryAddress?.digipin || '';
  const orderNumber = order.orderNumber || order._id.slice(-6).toUpperCase();
  const isCod = order.paymentMethod === 'cod';
  const totalAmount = Number(order.totalAmount || 0);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={() => {
        if (!isLoading) onClose();
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          if (!isLoading) onClose();
        }}
      >
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation?.()}>
          {/* Header Bar */}
          <View style={styles.headerRow}>
            <View style={styles.badgeRow}>
              <View style={styles.servicePill}>
                <Text style={styles.servicePillText}>📍 IN YOUR SERVICEABLE ZONE</Text>
              </View>
              <View style={styles.pinPill}>
                <Text style={styles.pinPillText}>PIN {matchedPin}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss popup"
              disabled={isLoading}
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={8}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Main Title Banner */}
          <View style={styles.titleBanner}>
            <View style={styles.iconCircle}>
              <Text style={styles.headerIcon}>🛵</Text>
            </View>
            <View style={styles.titleInfo}>
              <Text style={styles.headerTitle}>New Delivery Offer Ready!</Text>
              <View style={styles.orderMetaRow}>
                <Text style={styles.orderIdBadge}>#{orderNumber}</Text>
                <Text style={styles.orderStatusBadge}>● Ready for Pickup</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
            {/* Context Message */}
            <View style={styles.messageBox}>
              <Text style={styles.messageText}>
                An order matching your serviceable pincode <Text style={styles.messageBold}>({matchedPin})</Text> is waiting for pickup. Accept immediately to secure this delivery trip!
              </Text>
            </View>

            {/* Route Tile: Store to Customer */}
            <View style={styles.routeContainer}>
              {/* Pickup Box */}
              <View style={styles.stopCard}>
                <View style={styles.stopHeader}>
                  <Text style={styles.stopTagPickup}>🏪 PICKUP STORE</Text>
                  {!!orderPins.pickupPin && (
                    <Text style={styles.pinTag}>PIN {orderPins.pickupPin}</Text>
                  )}
                </View>
                <Text style={styles.stopName}>{storeName}</Text>
                <Text style={styles.stopAddress} numberOfLines={2}>{pickupAddress}</Text>
              </View>

              {/* Connecting Divider */}
              <View style={styles.connectorRow}>
                <View style={styles.connectorLine} />
                <Text style={styles.connectorLabel}>↓ deliver to customer</Text>
                <View style={styles.connectorLine} />
              </View>

              {/* Drop Box */}
              <View style={[styles.stopCard, styles.stopCardDrop]}>
                <View style={styles.stopHeader}>
                  <Text style={styles.stopTagDrop}>👤 CUSTOMER DROP</Text>
                  {!!orderPins.deliveryPin && (
                    <Text style={styles.pinTag}>PIN {orderPins.deliveryPin}</Text>
                  )}
                </View>
                <Text style={styles.stopName}>{order.customerName || 'Customer'}</Text>
                <Text style={styles.stopAddress} numberOfLines={2}>{dropAddress}</Text>
                {!!customerDigipin && (
                  <View style={styles.digipinRow}>
                    <Text style={styles.digipinLabel}>📍 DIGIPIN: </Text>
                    <Text style={styles.digipinValue}>{customerDigipin}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Highlights Bar */}
            <View style={styles.highlightsBar}>
              <View style={styles.highlightCol}>
                <Text style={styles.highlightLabel}>BILL AMOUNT</Text>
                <Text style={styles.highlightValue}>₹{totalAmount.toFixed(0)}</Text>
              </View>
              <View style={styles.highlightDivider} />
              <View style={styles.highlightCol}>
                <Text style={styles.highlightLabel}>PAYMENT</Text>
                <Text style={[styles.paymentBadge, isCod ? styles.paymentCod : styles.paymentPaid]}>
                  {isCod ? 'Cash (COD)' : 'Paid Online'}
                </Text>
              </View>
              <View style={styles.highlightDivider} />
              <View style={styles.highlightCol}>
                <Text style={styles.highlightLabel}>TRIP EARNING</Text>
                <Text style={styles.earningsValue}>₹40</Text>
              </View>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Accept delivery order"
              disabled={isLoading}
              onPress={() => void onAccept(order)}
              style={[styles.btn, styles.acceptBtn, isLoading && styles.btnDisabled]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.acceptBtnText}>✓ Accept Delivery</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View in available pickups"
              disabled={isLoading}
              onPress={onViewOffer}
              style={[styles.btn, styles.viewBtn]}
            >
              <Text style={styles.viewBtnText}>📋 View Available Pickups</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss offer for now"
              disabled={isLoading}
              onPress={onClose}
              style={styles.dismissBtn}
            >
              <Text style={styles.dismissBtnText}>Dismiss for now</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 390,
    maxHeight: '90%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#fed7aa',
    shadowColor: '#d83a32',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  servicePill: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  servicePillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.5,
  },
  pinPill: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pinPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  titleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  headerIcon: {
    fontSize: 24,
  },
  titleInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  orderMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  orderIdBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d83a32',
  },
  orderStatusBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  scrollArea: {
    maxHeight: 330,
  },
  messageBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  messageText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#166534',
  },
  messageBold: {
    fontWeight: '800',
    color: '#14532d',
  },
  routeContainer: {
    gap: 6,
    marginBottom: 12,
  },
  stopCard: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 14,
    padding: 12,
  },
  stopCardDrop: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  stopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stopTagPickup: {
    fontSize: 10,
    fontWeight: '800',
    color: '#c2410c',
    letterSpacing: 0.5,
  },
  stopTagDrop: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
  },
  pinTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    backgroundColor: '#ffffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
  },
  stopName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 2,
  },
  stopAddress: {
    fontSize: 12,
    lineHeight: 16,
    color: '#64748b',
  },
  digipinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  digipinLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  digipinValue: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0369a1',
  },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  connectorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  connectorLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  highlightsBar: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  highlightCol: {
    alignItems: 'center',
    flex: 1,
  },
  highlightLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 3,
    letterSpacing: 0.3,
  },
  highlightValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  paymentBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  paymentCod: {
    color: '#d97706',
  },
  paymentPaid: {
    color: '#16a34a',
  },
  earningsValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#15803d',
  },
  highlightDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#cbd5e1',
  },
  actions: {
    gap: 8,
    marginTop: 4,
  },
  btn: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.65,
  },
  acceptBtn: {
    backgroundColor: '#16a34a',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  acceptBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  viewBtn: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  viewBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  dismissBtn: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  dismissBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
});

