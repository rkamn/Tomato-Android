import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BillRow } from './CustomerComponents';
import { formatRupees } from './customerHelpers';
import { formatDigipin, resolveCustomerDigipin } from './digipin';
import LiveRouteTracker from './LiveRouteTracker';
import {
  type Bill,
  type BillItem,
  type Order,
  type OrderTracking,
  formatOrderNumber,
  formatOrderStatus,
  getOrderStatusBadgeColors,
  isOrderReturnAccepted,
  isOrderTrackingActive,
} from './types';

export function openRiderLocation(lat: number, lng: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  void Linking.openURL(url).catch(() =>
    Alert.alert('Unable to open maps', 'Install a map application and try again.'),
  );
}

export type OrderCardProps = {
  order: Order;
  tracking?: OrderTracking;
  trackingError?: string;
  trackingLoading: boolean;
  bill?: Bill;
  billLoading: boolean;
  onTrack: () => void;
  onViewBill: () => void;
  onReview: (item: { id: string; name: string; rating?: number }) => void;
  sessionToken?: string;
  customerProfileDigipin?: string;
};

export const OrderCard = React.memo(function OrderCard({
  order,
  tracking,
  trackingError,
  trackingLoading,
  bill,
  billLoading,
  onTrack,
  onViewBill,
  onReview,
  sessionToken,
  customerProfileDigipin,
}: OrderCardProps) {
  const effectiveCustomerDigipin =
    resolveCustomerDigipin(order) ||
    order.deliveryAddress?.digipin ||
    (order as any).customerDigipin ||
    (order as any).digipin ||
    customerProfileDigipin ||
    '';

  const isShopOrder = Boolean(
    order.isShopOrder ||
    (order as any).isShop ||
    (order as any).storeType === 'shop' ||
    (order as any).orderType === 'shop' ||
    (order as any).type === 'shop' ||
    order.shopId ||
    order.shopName ||
    order.shopAddress ||
    order.shopDigipin ||
    (order.orderNumber && String(order.orderNumber).toUpperCase().includes('SHOP')) ||
    (order as any).restaurantId?.toLowerCase?.()?.startsWith('shop') ||
    (order as any).restaurantId?.toLowerCase?.()?.startsWith('sh-') ||
    order.restaurantName?.toLowerCase()?.includes('shop') ||
    (tracking as any)?.isShopOrder ||
    (tracking as any)?.isShop ||
    (tracking as any)?.storeType === 'shop' ||
    (tracking as any)?.restaurant?.restaurantId?.toLowerCase?.()?.startsWith('shop') ||
    (tracking as any)?.restaurant?.name?.toLowerCase?.()?.includes('shop') ||
    order.items?.some((it: any) => it.isShop || it.storeType === 'shop' || it.category?.toLowerCase()?.includes('shop'))
  );
  const partner =
    order.shopName || order.restaurantName || (isShopOrder ? 'Tomato shop' : 'Tomato restaurant');
  const normalizedStatus = (order.status || 'placed').toLowerCase().trim();
  const isDelivered = normalizedStatus === 'delivered';
  const isCancelled = normalizedStatus === 'cancelled';
  const returnAccepted = isOrderReturnAccepted(order, tracking);
  const isTrackingActive = isOrderTrackingActive(order, tracking);
  const isAcceptedByStore = !['placed', 'pending'].includes(normalizedStatus);
  const isTrackingDisabled = (!isCancelled && !isAcceptedByStore) || trackingLoading;
  const isComplete = !isTrackingActive;
  const formattedOrderNumber = formatOrderNumber(order);
  const statusLabel = isCancelled
    ? returnAccepted
      ? `Returned to ${order.returnAcceptedBy || partner}`
      : 'Cancelled · Returning'
    : formatOrderStatus(order.status || 'placed');
  const badgeStyle = getOrderStatusBadgeColors(order.status || 'placed');
  const riderLocation =
    tracking?.rider?.currentLocation ||
    tracking?.telemetry?.riderLocation ||
    tracking?.telemetry?.currentLocation;
  const riderLat = riderLocation?.lat;
  const riderLng = riderLocation?.lng;

  return (
    <View style={styles.orderCard}>
      {/* Row 1: Partner name on left, Amount + Bill icon on right */}
      <View style={styles.orderTopRow}>
        <Text style={[styles.orderPlace, styles.flex]} numberOfLines={1}>
          {partner}
        </Text>
        <View style={styles.orderAmountAndBillRow}>
          <Text style={styles.orderTotal}>{formatRupees(Number(order.totalAmount || 0))}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bill ? 'Close bill invoice' : 'View bill invoice'}
            disabled={billLoading}
            onPress={onViewBill}
            style={[styles.orderIconButton, bill && styles.orderIconButtonActive]}
          >
            {billLoading ? (
              <ActivityIndicator size="small" color="#d83a32" />
            ) : (
              <Text style={styles.orderActionIconEmoji}>🧾</Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Row 2: Order number + Status badge + Date on left, Track icon on right */}
      <View style={styles.orderNumberRow}>
        <View style={styles.orderNumberAndStatusRow}>
          <Text style={styles.orderNumber}>{formattedOrderNumber}</Text>
          <View style={[styles.orderStatusBadge, { backgroundColor: badgeStyle.bg }]}>
            <Text style={[styles.orderStatusBadgeText, { color: badgeStyle.text }]}>
              {statusLabel}
            </Text>
          </View>
          {!!order.createdAt && (
            <Text style={styles.orderDateMuted}>
              · {new Date(order.createdAt).toLocaleDateString()}
            </Text>
          )}
        </View>
        {!isComplete && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              !isAcceptedByStore && !isCancelled
                ? 'Tracking disabled until order is accepted by store'
                : tracking
                  ? 'Hide tracking'
                  : isCancelled
                    ? 'Track return to source'
                    : 'Track order'
            }
            disabled={isTrackingDisabled}
            onPress={onTrack}
            style={[
              styles.orderIconButton,
              tracking && styles.orderIconButtonActive,
              isTrackingDisabled && styles.orderIconButtonDisabled,
            ]}
          >
            {trackingLoading ? (
              <ActivityIndicator size="small" color="#d83a32" />
            ) : (
              <Text
                style={[
                  styles.orderActionIconEmoji,
                  isTrackingDisabled && styles.orderActionIconEmojiDisabled,
                ]}
              >
                {isCancelled ? '🔄' : '📍'}
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Row 3: Payment method & status (left aligned) */}
      <View style={styles.orderPaymentRow}>
        <Text style={styles.paymentNoteRow}>
          {(() => {
            const isPaid = (order.paymentStatus || '').toLowerCase() === 'paid';
            const isPending = (order.paymentStatus || '').toLowerCase() === 'pending' || !isPaid;
            const methodRaw = (order.paymentMethod || 'cod').toLowerCase();
            const isCod = methodRaw === 'cod' || methodRaw === 'cash';
            const methodLabel =
              methodRaw === 'razorpay' ? '⚡ RAZORPAY' : isCod ? 'COD' : methodRaw.toUpperCase();
            return (
              <>
                <Text style={isCod ? { color: '#dc2626', fontWeight: '800' } : undefined}>
                  {methodLabel}
                </Text>
                {' · '}
                <Text
                  style={
                    isPaid
                      ? { color: '#16a34a', fontWeight: '800' }
                      : isPending
                        ? { color: '#ca8a04', fontWeight: '800' }
                        : undefined
                  }
                >
                  {(order.paymentStatus || (isPaid ? 'paid' : 'pending')).toUpperCase()}
                </Text>
              </>
            );
          })()}
        </Text>
      </View>

      {!!order.items?.length && (
        <View style={styles.orderItemsRow}>
          <Text style={[styles.orderItems, styles.flex]} numberOfLines={2}>
            {order.items.map((item) => `${item.name}${item.brand ? ` (${item.brand})` : ''}(${item.quantity ?? 1})`).join(', ')}
          </Text>
          {isDelivered && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Review ordered items"
              onPress={() => {
                const item = order.items?.[0];
                const id = item?.foodItemId || item?.itemId || item?._id || '';
                if (item) onReview({ id, name: item.name });
              }}
              style={styles.reviewStringBtn}
            >
              <Text style={styles.link}>Review</Text>
            </Pressable>
          )}
        </View>
      )}

      {!!order.deliveryAddress?.line1 && (
        <View style={styles.orderDeliveryRow}>
          <Text style={[styles.itemDescription, styles.flex]} numberOfLines={2}>
            {order.deliveryAddress.label || 'Delivery'} · {order.deliveryAddress.line1}
            {effectiveCustomerDigipin
              ? ` (DIGIPIN: ${formatDigipin(effectiveCustomerDigipin)})`
              : ''}
          </Text>
          {isDelivered && (
            <View style={styles.orderRatingStarsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${star} stars`}
                  onPress={() => {
                    const item = order.items?.[0];
                    const id = item?.foodItemId || item?.itemId || item?._id || '';
                    if (item) onReview({ id, name: item.name, rating: star });
                  }}
                  hitSlop={3}
                >
                  <Text style={styles.orderStarIcon}>★</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {!!(order.pickupDigipin || order.restaurantDigipin || order.shopDigipin) && (
        <Text style={styles.itemDescription}>
          Pickup DIGIPIN:{' '}
          {formatDigipin(
            order.pickupDigipin || order.restaurantDigipin || order.shopDigipin,
          )}
        </Text>
      )}

      {!!bill && (
        <View style={styles.billCard}>
          <Text style={styles.trackingTitle}>
            Invoice {bill.invoiceNumber || bill.orderNumber || order.orderNumber || ''}
          </Text>
          {!!bill.date && (
            <Text style={styles.itemDescription}>{new Date(bill.date).toLocaleString()}</Text>
          )}
          {(bill.items || []).map((item: BillItem, index: number) => (
            <BillRow
              key={`${item.name || 'item'}-${index}`}
              label={`${item.quantity || 1} × ${item.name || 'Item'}`}
              value={formatRupees(
                Number(
                  item.totalPrice ?? Number(item.price || 0) * Number(item.quantity || 1),
                ),
              )}
            />
          ))}
          <BillRow label="Subtotal" value={formatRupees(Number(bill.subtotal || 0))} />
          {bill.cgst !== undefined || bill.sgst !== undefined ? (
            <>
              <BillRow label="CGST" value={formatRupees(Number(bill.cgst || 0))} />
              <BillRow label="SGST" value={formatRupees(Number(bill.sgst || 0))} />
            </>
          ) : (
            <BillRow label="Tax" value={formatRupees(Number(bill.tax || 0))} />
          )}
          <BillRow label="Delivery fee" value={formatRupees(Number(bill.deliveryFee || 0))} />
          {!!Number(bill.discountAmount || 0) && (
            <BillRow
              label={`Coupon${bill.couponCodes?.length ? ` (${bill.couponCodes.join(', ')})` : ''}`}
              value={`−${formatRupees(Number(bill.discountAmount || 0))}`}
            />
          )}
          <View style={styles.billDivider} />
          <BillRow
            bold
            label="Total"
            value={formatRupees(Number(bill.totalAmount || order.totalAmount || 0))}
          />
          <Text style={styles.paymentNote}>
            {(() => {
              const rawMethod = (bill.paymentMethod || order.paymentMethod || 'cod').toLowerCase();
              const isCod = rawMethod === 'cod' || rawMethod === 'cash';
              const rawStatus = (bill.paymentStatus || order.paymentStatus || '').toLowerCase();
              const isPaid = rawStatus === 'paid';
              const isPending = rawStatus === 'pending' || !isPaid;
              return (
                <>
                  <Text style={isCod ? { color: '#dc2626', fontWeight: '800' } : undefined}>
                    {isCod ? 'COD' : rawMethod.toUpperCase()}
                  </Text>
                  {' · '}
                  <Text
                    style={
                      isPaid
                        ? { color: '#16a34a', fontWeight: '800' }
                        : isPending
                          ? { color: '#ca8a04', fontWeight: '800' }
                          : undefined
                    }
                  >
                    {(rawStatus || (isPaid ? 'paid' : 'pending')).toUpperCase()}
                  </Text>
                </>
              );
            })()}
          </Text>
        </View>
      )}

      {!isComplete && (
        <>
          {trackingLoading && (
            <View style={styles.trackingCard}>
              <ActivityIndicator color="#d83a32" />
              <Text style={styles.itemDescription}>
                Loading the latest order and rider details…
              </Text>
            </View>
          )}
          {!!trackingError && (
            <View style={styles.trackingError}>
              <Text style={styles.trackingErrorText}>
                Tracking could not be refreshed: {trackingError}
              </Text>
              <Pressable onPress={onTrack}>
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          )}
          {!!tracking && (
            <View style={[styles.trackingCard, isCancelled && styles.trackingCardCancelled]}>
              <Text style={[styles.trackingTitle, isCancelled && styles.trackingTitleCancelled]}>
                {isCancelled
                  ? returnAccepted
                    ? 'Tracking complete'
                    : '🔄 Live return tracking'
                  : tracking.trackingClosed
                    ? 'Tracking complete'
                    : 'Live delivery status'}
              </Text>
              {isCancelled ? (
                <>
                  <Text style={styles.itemDescription}>
                    Status:{' '}
                    <Text
                      style={{
                        fontWeight: '800',
                        color: returnAccepted ? '#166534' : '#b42318',
                      }}
                    >
                      {returnAccepted
                        ? `Returned & accepted by ${order.returnAcceptedBy || partner}`
                        : `Cancelled · Returning to ${partner}`}
                    </Text>
                  </Text>
                  <Text style={styles.itemDescription}>
                    {returnAccepted
                      ? `The return was accepted by ${order.returnAcceptedBy || partner}. Tracking has officially ended.`
                      : `Order was cancelled. Tracking remains active until the package is returned and accepted by the source (${partner}).`}
                  </Text>
                  {!returnAccepted && (
                    <View style={styles.sourceAcceptancePendingBox}>
                      <Text style={styles.sourceAcceptancePendingText}>
                        ⏳ Awaiting return acceptance from: {partner} or Admin
                      </Text>
                    </View>
                  )}
                  {!!tracking.rider && (
                    <Text style={styles.itemDescription}>
                      Rider returning order: {tracking.rider.name || 'Assigned rider'}
                      {tracking.rider.phone ? ` · ${tracking.rider.phone}` : ''}
                    </Text>
                  )}
                  {typeof riderLat === 'number' && typeof riderLng === 'number' && (
                    <Pressable onPress={() => openRiderLocation(riderLat, riderLng)}>
                      <Text style={styles.link}>View rider return route on map</Text>
                    </Pressable>
                  )}
                  {!returnAccepted && (
                    <Text style={styles.itemDescription}>
                      Tracking refreshes automatically while this screen is open.
                    </Text>
                  )}
                </>
              ) : (
                <>
                  {tracking.rider ? (
                    <LiveRouteTracker
                      orderId={order._id}
                      orderNumber={order.orderNumber}
                      initialTracking={tracking as any}
                      endpoint={`/api/customer/orders/${encodeURIComponent(order._id)}/live-tracking`}
                      token={sessionToken}
                      isShop={isShopOrder}
                      fallbackRiderName={tracking.rider?.name}
                      fallbackRiderPhone={tracking.rider?.phone}
                      fallbackCustomerName={order.customerName}
                      fallbackCustomerAddress={order.deliveryAddress}
                      fallbackCustomerDigipin={
                        effectiveCustomerDigipin || resolveCustomerDigipin(order) || order.deliveryAddress?.digipin
                      }
                      fallbackStoreName={partner}
                      fallbackStoreDigipin={
                        order.pickupDigipin || order.restaurantDigipin || order.shopDigipin
                      }
                      fallbackStoreAddress={order.restaurantAddress || order.shopAddress}
                      isPickedUp={Boolean(
                        tracking.isPickedUp || tracking.pickupStatus === 'picked_up',
                      )}
                    />
                  ) : (
                    <>
                      <Text style={styles.itemDescription}>
                        Status: {(tracking.status || order.status || 'placed').replaceAll('_', ' ')}{' '}
                        · Waiting for rider assignment
                      </Text>
                      {(tracking.estimatedMinutes ?? tracking.expectedDeliveryTimingMinutes) !==
                        undefined && (
                        <Text style={styles.itemDescription}>
                          Estimated delivery:{' '}
                          {tracking.estimatedMinutes ?? tracking.expectedDeliveryTimingMinutes} min
                        </Text>
                      )}
                      {!tracking.trackingClosed && (
                        <Text style={styles.itemDescription}>
                          {['placed', 'pending'].includes(tracking.status || order.status || '')
                            ? 'The restaurant or shop needs to accept this order before a rider can accept the delivery.'
                            : 'Your order is accepted. A rider working in your area will appear here after accepting the delivery.'}
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  orderCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 15,
    marginBottom: 11,
    shadowColor: '#a82c24',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  orderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderPlace: { color: '#302923', fontWeight: '800', fontSize: 15 },
  orderAmountAndBillRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderTotal: { color: '#302923', fontWeight: '800', fontSize: 14 },
  orderNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
    minHeight: 32,
  },
  orderNumberAndStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
    flex: 1,
  },
  orderNumber: { color: '#302923', fontWeight: '800', fontSize: 13.5 },
  orderStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  orderStatusBadgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  orderDateMuted: { color: '#8c8178', fontSize: 11, fontWeight: '600' },
  orderStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
  },
  orderIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#fff7f2',
    borderColor: '#f5cdc3',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderIconButtonActive: { backgroundColor: '#d83a32', borderColor: '#d83a32' },
  orderIconButtonDisabled: { backgroundColor: '#f5f2ef', borderColor: '#e4ddd6', opacity: 0.5 },
  orderActionIconEmoji: { fontSize: 14 },
  orderActionIconEmojiDisabled: { opacity: 0.5 },
  paymentNoteRow: { color: '#8a8078', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  orderPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 4,
    marginBottom: 4,
  },
  orderItemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  orderItems: { color: '#5d544d', fontSize: 12, lineHeight: 18 },
  reviewStringBtn: {
    paddingVertical: 2,
    paddingLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { color: '#c8322a', fontWeight: '700', fontSize: 12 },
  orderDeliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  itemDescription: { color: '#887e76', fontSize: 11, lineHeight: 15, marginTop: 4 },
  orderRatingStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 1, marginLeft: 6 },
  orderStarIcon: { color: '#f2a900', fontSize: 16, lineHeight: 18 },
  billCard: {
    backgroundColor: '#fff',
    borderColor: '#f0e8e1',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    marginTop: 8,
    marginBottom: 14,
  },
  trackingTitle: { color: '#214b7a', fontSize: 12, fontWeight: '800' },
  trackingTitleCancelled: { color: '#c2410c' },
  billDivider: { height: 1, backgroundColor: '#f0e8e1', marginVertical: 7 },
  paymentNote: { color: '#8a8078', fontSize: 11, marginTop: 9, lineHeight: 16 },
  trackingCard: { borderRadius: 11, backgroundColor: '#f4f8ff', padding: 11, marginTop: 9 },
  trackingCardCancelled: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  trackingError: { borderRadius: 11, backgroundColor: '#fff1f0', padding: 11, marginTop: 9 },
  trackingErrorText: { color: '#a9241c', fontSize: 12, lineHeight: 17, marginBottom: 5 },
  sourceAcceptancePendingBox: {
    marginTop: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
  },
  sourceAcceptancePendingText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
});
