# DropSync

Instant cross-device clipboard and image sharing. Open a room on your laptop,
open the same room on your phone, and anything pasted or dropped on one
appears on the other in real time. No accounts, no sign-in.

## Stack

- React 18 + Vite 5
- Tailwind CSS
- Framer Motion
- Firebase Firestore (realtime data + rooms) + Hosting
- Cloudinary (image uploads — free tier, no billing account required)
- vite-plugin-pwa (installable, offline-cached app shell)

**Why Cloudinary instead of Firebase Storage:** Firebase Storage now requires
the Blaze (pay-as-you-go) plan even for small projects. Cloudinary's free
tier (25GB storage, 25GB bandwidth/month) covers this app's image uploads
with no card on file, so that's what's wired up by default. Firestore alone
stays on Firebase's free Spark plan.

## 1. Firebase project setup (Firestore only — no billing needed)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Firestore Database** (Build → Firestore Database → Create
   database). Start in test mode if you just want to try it locally first.
3. In Project Settings → General → Your apps, add a **Web app** and copy the
   config values.
4. Copy `.env.example` to `.env`:

   ```
   cp .env.example .env
   ```

   and fill in the six `VITE_FIREBASE_*` values from step 3.

## 2. Cloudinary setup (image uploads — free, no billing needed)

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. On your Cloudinary dashboard, copy your **Cloud name** (shown near the
   top) into `.env` as `VITE_CLOUDINARY_CLOUD_NAME`.
3. Create an **unsigned upload preset** (this lets the browser upload
   directly without exposing your API secret):
   - Settings → Upload → Upload presets → **Add upload preset**
   - Set **Signing Mode** to **Unsigned**
   - (Optional but recommended) restrict it to the `dropsync` folder and to
     image files only
   - Save, then copy the preset name into `.env` as
     `VITE_CLOUDINARY_UPLOAD_PRESET`

That's it — no card, no Blaze plan, no Firebase Storage needed anywhere.

## 3. Run locally

```
npm install
npm run dev
```

Open the printed local URL. To test cross-device sync, open the same URL on
your phone (same Wi‑Fi network) via your machine's local IP, or deploy first
and use the live URL.

## 4. Deploy Firestore rules + Hosting

```
npm install -g firebase-tools   # if you don't have it
firebase login
firebase use --add              # point the CLI at your project

npm run build
firebase deploy --only firestore:rules,hosting
```

`firebase.json` is already configured to serve `dist/` with an SPA rewrite so
client-side routing (`/room/1234`) works on refresh.

## Folder structure

```
src/
  components/    Reusable UI pieces (cards, upload zone, header, modals…)
  pages/         Home.jsx (join screen) and Room.jsx (the clipboard itself)
  lib/           firebase.js (Firestore init), rooms.js, messages.js
                 (Firestore data access), cloudinary.js (image uploads)
  hooks/         useOnlineStatus, useUploadQueue (offline queueing)
  context/       ThemeContext (dark mode)
  utils/         hash.js (room passwords + ID gen), localRooms.js (recent
                 rooms, favourites, device id — all localStorage), time.js
firestore.rules  Firestore access rules
firebase.json    Hosting + rules deployment config
```

## How a room works

- A **room** is just a Firestore document at `rooms/{roomId}` (e.g. `rooms/1234`).
  Typing a room ID and hitting **Join** creates it if it doesn't exist yet, or
  joins it if it does.
- **Messages** (text and images) live in the `rooms/{roomId}/messages`
  subcollection and are streamed to every connected client via a Firestore
  `onSnapshot` listener — that's what makes uploads appear instantly on other
  devices with no refresh.
- **Images** are compressed client-side (via `browser-image-compression`),
  then uploaded directly to Cloudinary from the browser; the returned
  `secure_url` and `public_id` are saved on the Firestore message document.
- **Auto-cleanup**: each message can carry an `expiresAt` timestamp (1h / 6h /
  24h / never, chosen from the room's menu). A client-side interval sweeps and
  deletes anything past its expiry while a room is open. Because there's no
  backend cron in this setup, cleanup only runs while at least one client has
  the room open.
- **Recent rooms, favourites, local nicknames, device id, and theme** are all
  stored in `localStorage` on each device — they're intentionally per-device
  and never synced, so your phone's "recent rooms" list can differ from your
  laptop's.

## Security model — please read

This app has **no authentication system by design** — that's the whole
point of the product. That trade-off has real limits worth knowing before you
put anything sensitive in a room:

- A **room password**, if set, is hashed (SHA-256) client-side and checked
  against the stored hash before joining. This deters casual guessing but is
  **not equivalent to real authentication** — Firestore's rules can't
  cryptographically verify a password without a backend function, so the
  rules mainly enforce document *shape* (field types, sizes, immutability of
  `passwordHash` after creation) rather than gatekeeping reads. Firestore
  rules do allow public **read** access to room documents and messages, since
  the join screen needs to detect whether a room requires a password before
  a user has entered one.
- Treat room IDs (and passwords) like you'd treat a shared Google Doc link:
  anyone who has it can read and write to that room.
- **Image uploads use an unsigned Cloudinary preset**, which means anyone
  who discovers your preset name could technically upload to your account
  (they can't read your other files or your API secret, but they could use
  your free-tier quota). Restricting the preset to a specific folder and
  file type, and keeping an eye on Cloudinary's usage dashboard, is the
  practical mitigation here.
- Don't put anything in a room you wouldn't paste into a public URL —
  this is a *convenience* tool for moving your own clipboard between your own
  devices, not a secure storage system.

## Known trade-offs / things to harden before heavy production use

- **Deleting an image message removes it from the room's view but does not
  delete the file from Cloudinary.** Deleting a Cloudinary asset requires a
  signed request (your API secret), which can't be done safely from the
  browser. If you need real deletion, add a small backend (a Cloud Function
  or any tiny server) that holds the API secret and exposes a delete
  endpoint the app can call instead.
- Deleting a room does not cascade-delete its `messages` subcollection
  server-side (Firestore doesn't cascade deletes). The client currently only
  deletes the room document itself on "Delete room."
- For guaranteed deletion of expired uploads even when no one has a room
  open, add a scheduled Cloud Function that queries the `messages`
  collection group where `expiresAt <= now` and deletes matches — the
  `expiresAt` field is already written on every message specifically so
  this is a drop-in addition later.
- `navigator.clipboard.write` (image copy) and `navigator.share` degrade
  gracefully but aren't available in every browser — the buttons fall back to
  download/copy-link behavior where possible.
- The offline upload queue lives in memory (`useUploadQueue`), so a hard
  refresh while offline will drop anything still queued — it's meant to
  smooth over brief connectivity blips, not long offline stretches.
