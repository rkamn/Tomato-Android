# Tomato for Android

React Native app for Tomato customers, restaurant/shop partners, riders, and
provisioned admin staff. It connects to the existing Tomato API; it does not
connect directly to MongoDB.

## Requirements

- Node.js and npm
- Android Studio and an Android emulator, or an Android phone with Expo Go
- The Tomato API running and reachable from the device

The API uses the same MongoDB database as the web app (`MONGO_DB_NAME=Tomato_clone`).
Start the API using the existing web repository's instructions before launching
the app.

## Run

```sh
npm install
npm start
```

For the default local HTTP API on the Android emulator, start with
`TOMATO_ALLOW_HTTP=true npm start`, then press `a` in Expo CLI. This opt-in is
only for local development. For a physical device, scan the QR code from Expo
Go and use your computer's LAN address.

By default, the app connects to `http://10.0.2.2:5050` (the Android emulator's
host-machine address). For a physical device or deployed API, set
`EXPO_PUBLIC_API_URL` to a URL reachable from that device before starting Expo:

```sh
TOMATO_ALLOW_HTTP=true EXPO_PUBLIC_API_URL=http://192.168.1.20:5050 npm start
```

Use HTTPS for deployed environments; Android cleartext HTTP is disabled unless
`TOMATO_ALLOW_HTTP=true` is explicitly set. Do not set that flag for production
builds. The API must allow requests from the device's network. The app
authenticates with `/api/auth` and uses the existing
`/api/customer` endpoints for restaurant/shop browsing, addresses, checkout,
and orders. Login credentials are never stored; the API token is stored in
Android's secure storage.

## Features

- Customer account registration and email/phone login
- Right-side profile menu with role-specific shortcuts and profile settings,
  including role-specific profile fields and password changes
- Help & Support for customers, partners, riders, and admin staff with configured
  contact details, role-specific ticket categories, priority selection, ticket
  submission, ticket history, and resolve/reopen controls
- Restaurant and shop browsing, menu search, and a single-store cart
- Checkout with saved delivery addresses, server-validated coupons applied during order creation, and cash on delivery
- Saved-address management, order history with automatic status refresh and server-generated bills, live order/rider tracking, and reviews for delivered items
- Restaurant and shop partner dashboards with open/closed status, incoming
  orders, order acceptance/preparation/pickup status, menu/inventory CRUD,
  business profile editing, partner coupons, finance transfers, and bank/KYC details
- Rider duty toggle, foreground live location updates while online, available
  offers, pickup/delivery workflow, map links, COD collection confirmation,
  delivery history, earnings summary, bank/KYC details, and payout history
- Foreground partner order refresh and rider delivery-offer alerts while the
  relevant orders screen is open; background push notifications are not enabled
- Registration and sign-in for customer, restaurant, shop, and rider roles
- Permission-aware admin workspace with platform KPIs, daily order review and
  archiving, complaint handling, partner/customer account review and blocking,
  serviceable-pincode management, analytics, finance transfers, bank settlements,
  partner billing, and platform coupons
- Admin control panel for staff locations, employee review, custom-role
  management, support contact, and reverse-proxy settings. Admin team
  directory/sub-admin creation is also available. Privileged actions are gated
  in the app and remain subject to the API's role checks.

Rider registrations are pending administrator approval, as in the web app.
Rider location sharing is foreground-only; this app does not request background
location access.

Admin, sub-admin, and super-admin accounts are provisioned through the existing
Tomato administration system; this app does not offer public registration for
privileged roles. Financial operations and other desktop-only administration
pages remain available in the web dashboard.

Card, UPI, and Razorpay payments are not enabled in this mobile version; they
require a supported native payment flow. The API remains responsible for
serviceability, pricing, and order validation. The current API does not expose
a customer self-service order-cancellation endpoint or a rider-initiated payout
request endpoint; the app does not simulate either operation.
