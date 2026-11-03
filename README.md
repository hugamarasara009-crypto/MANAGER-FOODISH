# CityFood Accounts Dashboard

React + Vite + Firebase Firestore dashboard based on the supplied Firebase screenshots and feature requirements.

## Included modules

- Overview: today's orders, delivered amount, cancelled amount and delivered COD amount.
- Restaurants: restaurant-specific item subtotal report and physical ledger.
- Riders: delivered COD tracking, collection, fine and salary ledger.
- Online Accounts: bKash and Nagad entries and totals.
- History & Reports: date-range summary and saved ledger entries.

## Requirements

- Node.js 20.19+ or 22.12+
- A Firebase project with a Web App registered
- Firestore enabled
- Firebase Authentication enabled

## Install and run

1. Extract this ZIP.
2. Open the extracted `cityfood-accounts-dashboard` folder in VS Code.
3. Copy `.env.example` to `.env`.
4. Fill the Firebase Web App values in `.env`.
5. Open a terminal in the project folder and run:

```bash
npm install
npm run dev
```

6. Open the local URL printed by Vite (normally http://localhost:5173).

For a production build:

```bash
npm run build
npm run preview
```

## Firebase setup

### Authentication

The current dashboard calls `signInAnonymously()`. In Firebase Console:
- Authentication → Sign-in method → enable Anonymous.

Important: anonymous authentication only creates an authenticated Firebase session. It does not verify that a person is an administrator. The `admins` collection's Gmail string field is data, not proof of identity.

Before production use, replace anonymous access with a verified admin sign-in flow (Google or email/password) and enforce admin authorization with Firestore Security Rules or custom claims.

### Firestore collections read by the dashboard

- `orders`
- `mini_restaurants`
- `riders`

### Accounting collections written/read by the dashboard

- `management_entries`
- `online_entries`

The two accounting collections are expected to be created automatically on the first successful write. Firestore Security Rules must allow only authorized admins to read/write them.

The supplied `firestore.rules` intentionally denies all access as a safe default. It is a template, not a deploy-ready authorization policy. Do not deploy permissive rules such as `allow read, write: if true`.

## Data fields expected

### orders

The dashboard expects fields such as:
- `createdAt` (Firestore Timestamp)
- `orderStatus`
- `payment` (or `paymentMethod`)
- `totalPrice`
- `items` (array of maps)
- `riderId`
- `userName`
- `userPhone`

Restaurant item subtotal matching currently uses each item map's `miniResName` (or `restaurantName`) against the restaurant document's `name`. It multiplies `price * quantity`, and intentionally excludes delivery/service charges.

If your item records use restaurant document IDs instead, ensure each item has `miniResId` or `restaurantId` matching the restaurant document ID. Verify this against real documents before relying on reports.

### mini_restaurants

- document ID
- `name`

### riders

- document ID
- `name`
- `isAvailable`
- `vehicle`

### management_entries (created by dashboard)

- `entityType`: `restaurant` or `rider`
- `entityId`
- `entityName`
- `type`: `collection`, `fine`, or `salary`
- `amount`
- `note`
- `date` (`YYYY-MM-DD`)
- `createdAt`

### online_entries (created by dashboard)

- `method`: `bKash` or `Nagad`
- `amount`
- `note`
- `date` (`YYYY-MM-DD`)
- `createdAt`

## Important verification before live financial use

The supplied screenshots show field names, but they do not reveal all document values or Firestore rules. Verify:
1. The actual `orders.createdAt` type and timezone convention.
2. The exact `orderStatus` values used for delivered/cancelled orders.
3. The exact payment field/value used for COD.
4. Whether item `miniResName` matches restaurant `name` exactly.
5. Whether rider references store a rider document ID or another UID.
6. Security Rules and admin authorization.

This project is a frontend starter built from the supplied schema evidence. It has not been connected to or tested against your live Firebase project from this environment.


## Google admin sign-in

Enable **Authentication → Sign-in method → Google** in Firebase Console. Add the local development domain `localhost` under Authentication → Settings → Authorized domains if it is not already listed. The app signs in with Google and then checks that the signed-in email (lowercase) exists in the `admins` collection's `email` field. Add one document per admin with an `email` string. Firestore Security Rules must independently enforce admin access; this client-side check is not a substitute for secure rules.
