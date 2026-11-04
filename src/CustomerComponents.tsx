import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const EmptyState = React.memo(function EmptyState({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyEmoji}>🍅</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
});

export const PrimaryButton = React.memo(function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
});

export const QuantityControl = React.memo(function QuantityControl({
  quantity,
  onDecrease,
  onIncrease,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.quantityControl}>
      <Pressable accessibilityLabel="Decrease quantity" onPress={onDecrease} style={styles.quantityButton}>
        <Text style={styles.quantityButtonText}>−</Text>
      </Pressable>
      <Text style={styles.quantity}>{quantity}</Text>
      <Pressable accessibilityLabel="Increase quantity" onPress={onIncrease} style={styles.quantityButton}>
        <Text style={styles.quantityButtonText}>+</Text>
      </Pressable>
    </View>
  );
});

export const BillRow = React.memo(function BillRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billBold]}>{value}</Text>
    </View>
  );
});

export const DashboardTile = React.memo(function DashboardTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <View style={styles.dashboardTile}>
      <Text style={styles.dashboardTileValue}>{value}</Text>
      <Text style={styles.dashboardTileLabel}>{label}</Text>
    </View>
  );
});

export const ModeButton = React.memo(function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#eee4db',
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    marginVertical: 14,
  },
  emptyEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyTitle: {
    color: '#302923',
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDetail: {
    color: '#766c64',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 12,
  },
  emptyAction: {
    marginTop: 6,
    backgroundColor: '#d83a32',
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 9,
  },
  emptyActionText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#d83a32',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d83a32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderColor: '#e2d7cf',
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  quantityButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f8f4f0',
  },
  quantityButtonText: {
    color: '#d83a32',
    fontSize: 16,
    fontWeight: '800',
  },
  quantity: {
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: '800',
    color: '#302923',
    minWidth: 26,
    textAlign: 'center',
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  billLabel: {
    color: '#655b53',
    fontSize: 13,
  },
  billValue: {
    color: '#302923',
    fontSize: 13,
    fontWeight: '600',
  },
  billBold: {
    fontWeight: '800',
    color: '#241c16',
    fontSize: 14,
  },
  dashboardTile: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderColor: '#efe6df',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  dashboardTileValue: {
    color: '#d83a32',
    fontSize: 20,
    fontWeight: '800',
  },
  dashboardTileLabel: {
    color: '#766c64',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6efe9',
  },
  modeButtonActive: {
    backgroundColor: '#d83a32',
  },
  modeText: {
    color: '#6e635a',
    fontSize: 13,
    fontWeight: '700',
  },
  modeTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
});

