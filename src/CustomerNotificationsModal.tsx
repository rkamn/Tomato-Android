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

export type CustomerNotification = {
  title?: string;
  message?: string;
  createdAt?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  notifications: CustomerNotification[];
  loading: boolean;
};

export const CustomerNotificationsModal = React.memo(function CustomerNotificationsModal({
  visible,
  onClose,
  notifications,
  loading,
}: Props) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.icon}>🔔</Text>
              <Text style={styles.title}>Notifications & Updates</Text>
              {notifications.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{notifications.length}</Text>
                </View>
              )}
            </View>
            <Pressable
              accessibilityLabel="Close notifications"
              onPress={onClose}
              style={styles.closeBtn}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#d83a32" size="small" />
              <Text style={styles.loadingText}>Loading updates…</Text>
            </View>
          ) : notifications.length > 0 ? (
            <>
              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={true}
              >
                {notifications.map((item, index) => (
                  <View
                    key={`${item.createdAt || ''}-${index}`}
                    style={[
                      styles.item,
                      index === notifications.length - 1 && styles.itemLast,
                    ]}
                  >
                    <View style={styles.bullet} />
                    <View style={styles.body}>
                      <Text style={styles.itemTitle}>
                        {item.title || 'Tomato update'}
                      </Text>
                      <Text style={styles.itemMessage}>
                        {item.message || ''}
                      </Text>
                      {!!item.createdAt && (
                        <Text style={styles.itemTime}>
                          {new Date(item.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          ·{' '}
                          {new Date(item.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
              {notifications.length > 3 && (
                <Text style={styles.scrollHint}>
                  ↕ Showing latest 3 · Scroll to view {notifications.length - 3} older update
                  {notifications.length - 3 > 1 ? 's' : ''}
                </Text>
              )}
            </>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>You are all caught up!</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 15, 12, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: 1.5,
    borderRadius: 20,
    padding: 12,
    shadowColor: '#a82c24',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e8e0',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  icon: {
    fontSize: 13,
  },
  title: {
    color: '#28221e',
    fontSize: 8.5,
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: '#d83a32',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  countBadgeText: {
    color: '#ffffff',
    fontSize: 6,
    fontWeight: '800',
  },
  closeBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f6ede5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#695f56',
    fontSize: 10,
    fontWeight: '700',
  },
  scrollView: {
    maxHeight: 124,
  },
  scrollContent: {
    paddingVertical: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#faf6f2',
    borderWidth: 1,
    borderColor: '#eee4db',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 7,
    marginBottom: 4,
    gap: 6,
  },
  itemLast: {
    marginBottom: 0,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d83a32',
    marginTop: 3,
  },
  body: {
    flex: 1,
  },
  itemTitle: {
    color: '#28221e',
    fontSize: 7.5,
    fontWeight: '800',
    lineHeight: 10,
  },
  itemMessage: {
    color: '#6b6158',
    fontSize: 6.5,
    lineHeight: 9.5,
    marginTop: 1,
  },
  itemTime: {
    color: '#9c9187',
    fontSize: 5.5,
    marginTop: 2,
  },
  scrollHint: {
    textAlign: 'center',
    color: '#8b8077',
    fontSize: 6,
    fontWeight: '600',
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f4ede6',
  },
  loadingBox: {
    paddingVertical: 18,
    alignItems: 'center',
    gap: 6,
  },
  loadingText: {
    color: '#80756d',
    fontSize: 6.5,
  },
  emptyBox: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6e645c',
    fontSize: 7,
    fontWeight: '700',
  },
});

