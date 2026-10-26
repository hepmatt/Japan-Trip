# Japan Trip

A shared trip app for two: itinerary, to-do checklist, route map, contacts, and a photo album that syncs live between both phones. It runs on GitHub Pages and installs to the iPhone home screen like an app.

- **App code** lives in this repo and is served by GitHub Pages.
- **Trip data, checklist, contacts, and photos** live in Firebase (Firestore and Cloud Storage), locked to two email addresses by security rules.
- **No personal trip details are in this repo.** The itinerary is loaded once from a `trip-data.json` file inside the app, so it stays in Firebase only.

## Setup (about 20 minutes)

### 1. Create the Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Create a project**. Analytics is not needed.
2. Upgrade to the **Blaze** plan (bottom-left, **Upgrade**). Cloud Storage requires it. Normal use for two people stays inside the free allowance. Set a budget alert at $1 under **Billing > Budgets & alerts**.

### 2. Turn on the services
1. **Authentication > Get started > Sign-in method > Email/Password > Enable.**
2. **Authentication > Users > Add user.** Add yourself and your wife, each with an email and password.
3. **Firestore Database > Create database.** Pick the `us-west2` (Los Angeles) location and start in **production mode**.
4. **Storage > Get started.** Use the same location and production mode.

### 3. Paste the security rules
1. **Firestore Database > Rules:** paste `firestore.rules` from this repo, replace the two placeholder emails with yours (lowercase), and click **Publish**.
2. **Storage > Rules:** paste `storage.rules`, replace the same two emails, and click **Publish**.

Keep the real emails in the console only, not in this public repo.

### 4. Connect the app
1. **Project settings (gear) > General > Your apps > Web (`</>`).** Register an app named "Japan Trip". Hosting is not needed.
2. Copy the `firebaseConfig` object it shows and paste it into `firebase-config.js`, replacing `null`. These values are not secret.
3. **Authentication > Settings > Authorized domains > Add domain:** `hepmatt.github.io`.

### 5. Turn on GitHub Pages
Repo **Settings > Pages > Source: Deploy from a branch > Branch: `main` / root**. The app will be at `https://hepmatt.github.io/Japan-Trip/`.

### 6. Load the trip
Open the app, sign in, tap the person icon at the top right, then **Load trip data** and pick `trip-data.json`. Loading it again later updates the itinerary and adds new checklist items without undoing any checks.

## Install on iPhone
1. Open `https://hepmatt.github.io/Japan-Trip/` in **Safari**.
2. Tap **Share > Add to Home Screen > Add**.
3. Open it from the home screen and sign in there. The home-screen app keeps its own sign-in, separate from Safari.

After the first load, the itinerary, checklist, and contacts work offline. Changes made offline sync when the phone reconnects.

## Files
| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `firebase-config.js` | Your Firebase web config |
| `manifest.webmanifest`, `icons/` | Home-screen app name and icon |
| `sw.js` | Offline caching of the app shell |
| `firestore.rules`, `storage.rules` | Security rules to paste into the Firebase console |
