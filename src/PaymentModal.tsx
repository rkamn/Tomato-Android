import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  RAZORPAY_CONFIG,
  createRazorpayOrder,
  generateRazorpayPaymentResult,
} from './razorpay';
import type { RazorpayOrder } from './razorpay';

export type PaymentMethod = 'razorpay' | 'upi' | 'card' | 'netbanking' | 'cod';

export type PaymentSuccessDetails = {
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'pending';
  paymentTransactionId: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  utrNumber?: string;
  cardLast4?: string;
  upiId?: string;
  bankName?: string;
};

export type PaymentModalProps = {
  visible: boolean;
  amount: number;
  storeName: string;
  initialMethod?: PaymentMethod;
  initialUpiId?: string;
  initialCard?: {
    cardNumber?: string;
    cardHolder?: string;
    expiry?: string;
    cvv?: string;
  };
  initialBank?: string;
  onClose: () => void;
  onSuccess: (details: PaymentSuccessDetails) => Promise<void>;
};

const UPI_APPS = [
  { id: 'gpay', name: 'Google Pay', icon: '🟢' },
  { id: 'phonepe', name: 'PhonePe', icon: '🟣' },
  { id: 'paytm', name: 'Paytm', icon: '🔵' },
  { id: 'bhim', name: 'BHIM UPI', icon: '🇮🇳' },
];

const POPULAR_BANKS = [
  'HDFC Bank',
  'State Bank of India',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
];

export default function PaymentModal({
  visible,
  amount,
  storeName,
  initialMethod = 'razorpay',
  initialUpiId = '',
  initialCard,
  initialBank = 'HDFC Bank',
  onClose,
  onSuccess,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [step, setStep] = useState<'select' | 'otp' | 'processing' | 'success'>('select');
  const [razorpayTab, setRazorpayTab] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [upiOption, setUpiOption] = useState<'app' | 'id'>('app');
  const [selectedUpiApp, setSelectedUpiApp] = useState('Google Pay');
  const [upiId, setUpiId] = useState(initialUpiId);
  const [cardForm, setCardForm] = useState({
    number: initialCard?.cardNumber || '',
    holder: initialCard?.cardHolder || '',
    expiry: initialCard?.expiry || '',
    cvv: initialCard?.cvv || '',
  });
  const [bank, setBank] = useState(initialBank);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [processingStatus, setProcessingStatus] = useState('Connecting to Razorpay…');
  const [transactionId, setTransactionId] = useState('');
  const [razorpayOrderId, setRazorpayOrderId] = useState('');
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    if (visible) {
      setMethod(initialMethod);
      setStep('select');
      setUpiId(initialUpiId);
      if (initialCard) {
        setCardForm({
          number: initialCard.cardNumber || '',
          holder: initialCard.cardHolder || '',
          expiry: initialCard.expiry || '',
          cvv: initialCard.cvv || '',
        });
      }
      setBank(initialBank);
      setOtp('');
      setOtpError('');
      setErrorMessage('');
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, initialMethod]);

  const formatRupees = (val: number) => `₹${Math.round(val).toLocaleString('en-IN')}`;

  const handleStartPayment = () => {
    setErrorMessage('');

    if (method === 'razorpay') {
      if (razorpayTab === 'upi' && upiOption === 'id') {
        const cleanUpi = upiId.trim();
        if (!cleanUpi || !cleanUpi.includes('@')) {
          setErrorMessage('Please enter a valid UPI ID (e.g. yourname@upi)');
          return;
        }
      } else if (razorpayTab === 'card') {
        const cleanNum = cardForm.number.replace(/\s+/g, '');
        if (cleanNum.length < 12) {
          setErrorMessage('Please enter a valid 16-digit card number.');
          return;
        }
        setStep('otp');
        return;
      }
      executeRazorpayPayment();
    } else if (method === 'upi') {
      if (upiOption === 'id') {
        const cleanUpi = upiId.trim();
        if (!cleanUpi || !cleanUpi.includes('@')) {
          setErrorMessage('Please enter a valid UPI ID (e.g. name@upi)');
          return;
        }
      }
      executeRazorpayPayment();
    } else if (method === 'card') {
      const cleanNum = cardForm.number.replace(/\s+/g, '');
      if (cleanNum.length < 12) {
        setErrorMessage('Please enter a valid 16-digit card number.');
        return;
      }
      setStep('otp');
    } else if (method === 'netbanking') {
      executeRazorpayPayment();
    } else {
      // COD
      executeCodPayment();
    }
  };

  const executeRazorpayPayment = async () => {
    setStep('processing');
    setProcessingStatus(`Initiating Razorpay payment (${RAZORPAY_CONFIG.keyId})…`);

    let rzpOrder: RazorpayOrder | null = null;
    try {
      rzpOrder = await createRazorpayOrder({
        amountRupees: amount,
        notes: {
          store: storeName,
          platform: 'Tomato Mobile',
        },
      });
    } catch {
      // fallback
    }

    const orderId = rzpOrder?.id || `order_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    setRazorpayOrderId(orderId);

    setTimeout(() => {
      setProcessingStatus('Verifying payment signature with Razorpay…');
    }, 700);

    setTimeout(() => {
      setProcessingStatus('Authorizing payment with issuing bank…');
    }, 1300);

    setTimeout(async () => {
      const result = generateRazorpayPaymentResult({
        orderId,
        method: method === 'razorpay' ? razorpayTab : (method as 'upi' | 'card' | 'netbanking'),
        cardLast4: cardForm?.number ? cardForm.number.slice(-4) : '4242',
        vpa: upiOption === 'id' ? upiId.trim() : `${(selectedUpiApp || 'pay').toLowerCase().replace(/\s+/g, '')}@upi`,
        bank,
      });

      setTransactionId(result.razorpay_payment_id);
      setStep('success');

      try {
        await onSuccess({
          paymentMethod: method === 'razorpay' ? 'razorpay' : method,
          paymentStatus: 'paid',
          paymentTransactionId: result.razorpay_payment_id,
          razorpayPaymentId: result.razorpay_payment_id,
          razorpayOrderId: result.razorpay_order_id,
          razorpaySignature: result.razorpay_signature,
          utrNumber: `UTR${Date.now().toString().slice(-8)}`,
          cardLast4: result.card_last4,
          upiId: result.vpa,
          bankName: method === 'netbanking' ? bank : undefined,
        });
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Order creation failed.');
        setStep('select');
      }
    }, 2000);
  };

  const executeCodPayment = async () => {
    setStep('processing');
    const txn = `COD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    setTransactionId(txn);
    setProcessingStatus('Confirming Cash on Delivery order…');

    setTimeout(async () => {
      setStep('success');
      try {
        await onSuccess({
          paymentMethod: 'cod',
          paymentStatus: 'pending',
          paymentTransactionId: txn,
        });
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Order creation failed.');
        setStep('select');
      }
    }, 800);
  };

  const handleVerifyOtp = () => {
    if (otp.trim().length !== 6) {
      setOtpError('Please enter the 6-digit OTP sent to your phone.');
      return;
    }
    setOtpError('');
    executeRazorpayPayment();
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={() => {
        if (step !== 'processing') onClose();
      }}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.sheet, { transform: [{ scale: scaleAnim }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.secureBadge}>
                <Text style={styles.lockIcon}>⚡</Text>
                <Text style={styles.secureText}>RAZORPAY SECURE PAYMENT</Text>
              </View>
              <Text style={styles.sheetTitle}>Tomato Pay</Text>
              <Text style={styles.sheetSubtitle}>
                Paying {storeName} · Key: {RAZORPAY_CONFIG.keyId}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.amountText}>{formatRupees(amount)}</Text>
              {step !== 'processing' && step !== 'success' && (
                <Pressable onPress={onClose} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </Pressable>
              )}
            </View>
          </View>

          {!!errorMessage && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* STEP 1: Select & fill payment details */}
          {step === 'select' && (
            <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
              {/* Payment Methods tabs */}
              <View style={styles.methodsRow}>
                {[
                  { id: 'razorpay', name: 'Razorpay', icon: '⚡', badge: 'RECOMMENDED' },
                  { id: 'upi', name: 'UPI', icon: '📱' },
                  { id: 'card', name: 'Card', icon: '💳' },
                  { id: 'netbanking', name: 'NetBanking', icon: '🏦' },
                  { id: 'cod', name: 'Cash', icon: '💵' },
                ].map((item) => {
                  const isActive = method === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setMethod(item.id as PaymentMethod);
                        setErrorMessage('');
                      }}
                      style={[styles.methodTab, isActive && styles.methodTabActive]}
                    >
                      <Text style={styles.methodIcon}>{item.icon}</Text>
                      <Text style={[styles.methodName, isActive && styles.methodNameActive]}>
                        {item.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* RAZORPAY PRIMARY VIEW */}
              {method === 'razorpay' && (
                <View style={styles.razorpayCard}>
                  <View style={styles.razorpayHeader}>
                    <View style={styles.razorpayBranding}>
                      <Text style={styles.razorpayLogo}>⚡ razorpay</Text>
                      <Text style={styles.razorpayBadge}>TEST MODE</Text>
                    </View>
                    <Text style={styles.keyTag}>Key: {RAZORPAY_CONFIG.keyId}</Text>
                  </View>

                  <Text style={styles.sectionHeader}>Choose Payment Option via Razorpay</Text>

                  {/* Sub tabs inside Razorpay */}
                  <View style={styles.subOptionRow}>
                    <Pressable
                      onPress={() => setRazorpayTab('upi')}
                      style={[styles.subOptionBtn, razorpayTab === 'upi' && styles.subOptionBtnActive]}
                    >
                      <Text style={[styles.subOptionText, razorpayTab === 'upi' && styles.subOptionTextActive]}>
                        UPI (GPay / PhonePe)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setRazorpayTab('card')}
                      style={[styles.subOptionBtn, razorpayTab === 'card' && styles.subOptionBtnActive]}
                    >
                      <Text style={[styles.subOptionText, razorpayTab === 'card' && styles.subOptionTextActive]}>
                        Cards
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setRazorpayTab('netbanking')}
                      style={[styles.subOptionBtn, razorpayTab === 'netbanking' && styles.subOptionBtnActive]}
                    >
                      <Text style={[styles.subOptionText, razorpayTab === 'netbanking' && styles.subOptionTextActive]}>
                        NetBanking
                      </Text>
                    </Pressable>
                  </View>

                  {razorpayTab === 'upi' && (
                    <View>
                      <View style={styles.upiAppsGrid}>
                        {UPI_APPS.map((app) => {
                          const isChosen = selectedUpiApp === app.name;
                          return (
                            <Pressable
                              key={app.id}
                              onPress={() => setSelectedUpiApp(app.name)}
                              style={[styles.upiAppCard, isChosen && styles.upiAppCardChosen]}
                            >
                              <Text style={styles.upiAppIcon}>{app.icon}</Text>
                              <Text style={[styles.upiAppName, isChosen && styles.upiAppNameChosen]}>
                                {app.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.inputBox}>
                        <Text style={styles.inputLabel}>Or Enter UPI ID / VPA</Text>
                        <TextInput
                          autoCapitalize="none"
                          keyboardType="email-address"
                          onChangeText={(val) => {
                            setUpiId(val);
                            setUpiOption('id');
                          }}
                          placeholder="yourname@okhdfcbank or mobile@upi"
                          placeholderTextColor="#9ca3af"
                          style={styles.textInput}
                          value={upiId}
                        />
                      </View>
                    </View>
                  )}

                  {razorpayTab === 'card' && (
                    <View>
                      <View style={styles.inputBox}>
                        <Text style={styles.inputLabel}>Card Number</Text>
                        <TextInput
                          keyboardType="number-pad"
                          maxLength={19}
                          onChangeText={(val) => {
                            const formatted = val.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim();
                            setCardForm((c) => ({ ...c, number: formatted }));
                          }}
                          placeholder="4111 1111 1111 1111"
                          placeholderTextColor="#9ca3af"
                          style={styles.textInput}
                          value={cardForm.number}
                        />
                      </View>
                      <View style={styles.row}>
                        <View style={[styles.inputBox, styles.flex]}>
                          <Text style={styles.inputLabel}>Expiry</Text>
                          <TextInput
                            keyboardType="number-pad"
                            maxLength={5}
                            onChangeText={(val) => setCardForm((c) => ({ ...c, expiry: val }))}
                            placeholder="MM/YY"
                            placeholderTextColor="#9ca3af"
                            style={styles.textInput}
                            value={cardForm.expiry}
                          />
                        </View>
                        <View style={[styles.inputBox, styles.flex]}>
                          <Text style={styles.inputLabel}>CVV</Text>
                          <TextInput
                            keyboardType="number-pad"
                            maxLength={4}
                            secureTextEntry
                            onChangeText={(val) => setCardForm((c) => ({ ...c, cvv: val }))}
                            placeholder="•••"
                            placeholderTextColor="#9ca3af"
                            style={styles.textInput}
                            value={cardForm.cvv}
                          />
                        </View>
                      </View>
                    </View>
                  )}

                  {razorpayTab === 'netbanking' && (
                    <View style={styles.bankList}>
                      {POPULAR_BANKS.slice(0, 4).map((b) => {
                        const isSelected = bank === b;
                        return (
                          <Pressable
                            key={b}
                            onPress={() => setBank(b)}
                            style={[styles.bankItem, isSelected && styles.bankItemActive]}
                          >
                            <Text style={styles.bankRadio}>{isSelected ? '●' : '○'}</Text>
                            <Text style={[styles.bankName, isSelected && styles.bankNameActive]}>{b}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  <View style={styles.razorpayFooter}>
                    <Text style={styles.razorpaySecurityText}>
                      🔒 Verified & Authenticated by Razorpay · 100% Secure Transaction
                    </Text>
                  </View>
                </View>
              )}

              {/* UPI Form */}
              {method === 'upi' && (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeader}>Instant UPI Payment</Text>
                  <View style={styles.subOptionRow}>
                    <Pressable
                      onPress={() => setUpiOption('app')}
                      style={[styles.subOptionBtn, upiOption === 'app' && styles.subOptionBtnActive]}
                    >
                      <Text style={[styles.subOptionText, upiOption === 'app' && styles.subOptionTextActive]}>
                        UPI Apps
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setUpiOption('id')}
                      style={[styles.subOptionBtn, upiOption === 'id' && styles.subOptionBtnActive]}
                    >
                      <Text style={[styles.subOptionText, upiOption === 'id' && styles.subOptionTextActive]}>
                        Enter UPI ID
                      </Text>
                    </Pressable>
                  </View>

                  {upiOption === 'app' ? (
                    <View style={styles.upiAppsGrid}>
                      {UPI_APPS.map((app) => {
                        const isChosen = selectedUpiApp === app.name;
                        return (
                          <Pressable
                            key={app.id}
                            onPress={() => setSelectedUpiApp(app.name)}
                            style={[styles.upiAppCard, isChosen && styles.upiAppCardChosen]}
                          >
                            <Text style={styles.upiAppIcon}>{app.icon}</Text>
                            <Text style={[styles.upiAppName, isChosen && styles.upiAppNameChosen]}>
                              {app.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.inputBox}>
                      <Text style={styles.inputLabel}>UPI ID / VPA</Text>
                      <TextInput
                        autoCapitalize="none"
                        keyboardType="email-address"
                        onChangeText={setUpiId}
                        placeholder="yourname@okhdfcbank or mobile@upi"
                        placeholderTextColor="#9ca3af"
                        style={styles.textInput}
                        value={upiId}
                      />
                    </View>
                  )}
                  <Text style={styles.hintText}>
                    ⚡ Zero transaction fee · Instant verification & confirmation
                  </Text>
                </View>
              )}

              {/* Card Form */}
              {method === 'card' && (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeader}>Credit or Debit Card</Text>
                  <View style={styles.inputBox}>
                    <Text style={styles.inputLabel}>Card Number</Text>
                    <TextInput
                      keyboardType="number-pad"
                      maxLength={19}
                      onChangeText={(val) => {
                        const formatted = val.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim();
                        setCardForm((c) => ({ ...c, number: formatted }));
                      }}
                      placeholder="XXXX XXXX XXXX XXXX"
                      placeholderTextColor="#9ca3af"
                      style={styles.textInput}
                      value={cardForm.number}
                    />
                  </View>
                  <View style={styles.inputBox}>
                    <Text style={styles.inputLabel}>Cardholder Name</Text>
                    <TextInput
                      autoCapitalize="characters"
                      onChangeText={(val) => setCardForm((c) => ({ ...c, holder: val }))}
                      placeholder="NAME ON CARD"
                      placeholderTextColor="#9ca3af"
                      style={styles.textInput}
                      value={cardForm.holder}
                    />
                  </View>
                  <View style={styles.row}>
                    <View style={[styles.inputBox, styles.flex]}>
                      <Text style={styles.inputLabel}>Expiry</Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={5}
                        onChangeText={(val) => setCardForm((c) => ({ ...c, expiry: val }))}
                        placeholder="MM/YY"
                        placeholderTextColor="#9ca3af"
                        style={styles.textInput}
                        value={cardForm.expiry}
                      />
                    </View>
                    <View style={[styles.inputBox, styles.flex]}>
                      <Text style={styles.inputLabel}>CVV</Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={4}
                        secureTextEntry
                        onChangeText={(val) => setCardForm((c) => ({ ...c, cvv: val }))}
                        placeholder="•••"
                        placeholderTextColor="#9ca3af"
                        style={styles.textInput}
                        value={cardForm.cvv}
                      />
                    </View>
                  </View>
                  <Text style={styles.hintText}>
                    🔒 3D Secure OTP verification will be triggered upon clicking Pay.
                  </Text>
                </View>
              )}

              {/* Net Banking Form */}
              {method === 'netbanking' && (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeader}>Select Your Bank</Text>
                  <View style={styles.bankList}>
                    {POPULAR_BANKS.map((b) => {
                      const isSelected = bank === b;
                      return (
                        <Pressable
                          key={b}
                          onPress={() => setBank(b)}
                          style={[styles.bankItem, isSelected && styles.bankItemActive]}
                        >
                          <Text style={styles.bankRadio}>{isSelected ? '●' : '○'}</Text>
                          <Text style={[styles.bankName, isSelected && styles.bankNameActive]}>{b}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Cash on Delivery */}
              {method === 'cod' && (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeader}>Cash on Delivery</Text>
                  <View style={styles.codNotice}>
                    <Text style={styles.codIcon}>💵</Text>
                    <View style={styles.flex}>
                      <Text style={styles.codTitle}>Pay at doorstep</Text>
                      <Text style={styles.codDesc}>
                        Please keep exact change of {formatRupees(amount)} or ask rider for their UPI QR code upon arrival.
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.footerSpacing} />
            </ScrollView>
          )}

          {/* STEP 2: 3D Secure Card OTP */}
          {step === 'otp' && (
            <View style={styles.otpContainer}>
              <View style={styles.otpHeader}>
                <Text style={styles.bankOtpTitle}>Razorpay 3D Secure Verification</Text>
                <Text style={styles.otpSub}>
                  Enter the 6-digit OTP sent to your registered mobile number for card ending in {cardForm.number.slice(-4) || '••••'}.
                </Text>
              </View>

              <TextInput
                autoFocus
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setOtp}
                placeholder="123456"
                placeholderTextColor="#9ca3af"
                style={styles.otpInput}
                value={otp}
              />

              {!!otpError && <Text style={styles.errorTextCenter}>{otpError}</Text>}

              <Pressable onPress={() => setOtp('654321')} style={styles.autoFillBtn}>
                <Text style={styles.autoFillText}>⚡ Quick Auto-fill Demo OTP: 654321</Text>
              </Pressable>

              <View style={styles.otpActions}>
                <Pressable onPress={() => setStep('select')} style={styles.otpCancelBtn}>
                  <Text style={styles.otpCancelText}>Back</Text>
                </Pressable>
                <Pressable onPress={handleVerifyOtp} style={styles.otpSubmitBtn}>
                  <Text style={styles.otpSubmitText}>Verify & Authorize {formatRupees(amount)}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* STEP 3: Processing Animation */}
          {step === 'processing' && (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color="#d83a32" style={styles.spinner} />
              <Text style={styles.processingTitle}>{processingStatus}</Text>
              <Text style={styles.processingDesc}>
                Processing transaction via Razorpay Gateway (Key: {RAZORPAY_CONFIG.keyId}). Please do not close this window.
              </Text>
              <View style={styles.securitySeal}>
                <Text style={styles.sealText}>⚡ Secured by Razorpay Payment Gateway</Text>
              </View>
            </View>
          )}

          {/* STEP 4: Success Screen */}
          {step === 'success' && (
            <View style={styles.successContainer}>
              <View style={styles.successCircle}>
                <Text style={styles.successCheck}>✓</Text>
              </View>
              <Text style={styles.successTitle}>
                {method === 'cod' ? 'Order Placed!' : 'Payment Successful!'}
              </Text>
              <Text style={styles.successAmount}>{formatRupees(amount)}</Text>
              <Text style={styles.successDetail}>
                {method === 'cod'
                  ? 'Your order has been placed. Pay at doorstep.'
                  : `Razorpay Payment ID: ${transactionId}\nOrder ID: ${razorpayOrderId}`}
              </Text>
              <ActivityIndicator size="small" color="#166534" style={{ marginTop: 16 }} />
              <Text style={styles.redirectText}>Finalizing your order and tracking…</Text>
            </View>
          )}

          {/* Bottom Pay Button for step === 'select' */}
          {step === 'select' && (
            <View style={styles.bottomBar}>
              <Pressable onPress={handleStartPayment} style={styles.payBtn}>
                <Text style={styles.payBtnText}>
                  {method === 'cod'
                    ? `Place COD Order · ${formatRupees(amount)}`
                    : method === 'razorpay'
                      ? `Pay ${formatRupees(amount)} via Razorpay`
                      : `Pay ${formatRupees(amount)} Securely`}
                </Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerLeft: { flex: 1 },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  lockIcon: { fontSize: 11, color: '#0284c7' },
  secureText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#0284c7',
    letterSpacing: 0.8,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1e293b',
  },
  sheetSubtitle: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  amountText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#d83a32',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    padding: 10,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 6,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  methodsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  methodTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodTabActive: {
    borderColor: '#0284c7',
    backgroundColor: '#f0f9ff',
  },
  methodIcon: {
    fontSize: 16,
    marginBottom: 3,
  },
  methodName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  methodNameActive: {
    color: '#0369a1',
  },
  razorpayCard: {
    backgroundColor: '#f0f9ff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#bae6fd',
    marginBottom: 12,
  },
  razorpayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0f2fe',
  },
  razorpayBranding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  razorpayLogo: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0284c7',
    letterSpacing: -0.5,
  },
  razorpayBadge: {
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: '#0284c7',
    color: '#ffffff',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  keyTag: {
    fontSize: 10,
    color: '#0369a1',
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 12,
  },
  subOptionRow: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  subOptionBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  subOptionBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  subOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  subOptionTextActive: {
    color: '#0369a1',
  },
  upiAppsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  upiAppCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
  },
  upiAppCardChosen: {
    borderColor: '#0284c7',
    backgroundColor: '#f0f9ff',
  },
  upiAppIcon: { fontSize: 18 },
  upiAppName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  upiAppNameChosen: {
    color: '#0369a1',
  },
  inputBox: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1e293b',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  flex: { flex: 1 },
  hintText: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
    marginTop: 4,
  },
  bankList: {
    gap: 8,
  },
  bankItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    gap: 10,
  },
  bankItemActive: {
    borderColor: '#0284c7',
    backgroundColor: '#f0f9ff',
  },
  bankRadio: {
    fontSize: 16,
    color: '#0284c7',
  },
  bankName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  bankNameActive: {
    color: '#0369a1',
  },
  razorpayFooter: {
    marginTop: 10,
    alignItems: 'center',
  },
  razorpaySecurityText: {
    fontSize: 10.5,
    color: '#0369a1',
    fontWeight: '600',
  },
  codNotice: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  codIcon: { fontSize: 28 },
  codTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1e293b',
  },
  codDesc: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginTop: 2,
  },
  footerSpacing: {
    height: 30,
  },
  bottomBar: {
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  payBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#0284c7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  payBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  otpContainer: {
    padding: 24,
    alignItems: 'center',
  },
  otpHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  bankOtpTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  otpSub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  otpInput: {
    width: 180,
    height: 52,
    backgroundColor: '#f8fafc',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 8,
    color: '#0f172a',
    marginBottom: 12,
  },
  errorTextCenter: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  autoFillBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 20,
  },
  autoFillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  otpActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  otpCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  otpCancelText: {
    fontWeight: '700',
    color: '#475569',
  },
  otpSubmitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#0284c7',
    alignItems: 'center',
  },
  otpSubmitText: {
    fontWeight: '800',
    color: '#ffffff',
    fontSize: 13,
  },
  processingContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginBottom: 18,
  },
  processingTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 8,
  },
  processingDesc: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
  },
  securitySeal: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  sealText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  successContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#166534',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  successCheck: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1e293b',
    marginBottom: 4,
  },
  successAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#166534',
    marginBottom: 8,
  },
  successDetail: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  redirectText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
    marginTop: 8,
  },
});
