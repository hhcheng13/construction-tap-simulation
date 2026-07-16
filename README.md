# Construction Tap Simulation

This repository is a classroom construction management game for GitHub Pages. Students open the mobile-first `index.html` page and tap to contribute work for one of five trades, while the lecturer controls the live simulation and reviews CPM, Gantt, S-curve, and Line of Balance views from `dashboard.html`.

## Project Purpose

- Demonstrate trade sequencing and floor-by-floor dependencies.
- Show how bottlenecks, fatigue, weather, and robotic assistance affect production.
- Let many students interact with one shared simulation using Firebase Realtime Database.

## File Structure

- `index.html` - student page with team selection and one large WORK button.
- `dashboard.html` - lecturer dashboard with controls, KPIs, and four visualizations.
- `simulation.js` - simulation rules, task sequencing, validation, and shared state helpers.
- `firebase-config.js` - Firebase web configuration in `export const firebaseConfig = { ... }` format.
- `README.md` - setup, deployment, and troubleshooting.

## How State Works

- Shared state is stored in Firebase Realtime Database at `games/live`.
- Student taps call a Firebase transaction and run `applyTap(...)` from `simulation.js`.
- The transaction updates the next eligible trade task, team counters, productivity multipliers, history, and event log together.
- The dashboard subscribes with `onValue(...)`, sanitizes incoming state, and updates the four visualizations from the stored live data and history.

## Firebase Setup

1. Create a Firebase project.
2. Create a Realtime Database in test mode.
3. Register a Web App in Firebase.
4. Copy the Firebase config into `firebase-config.js`.
5. Deploy classroom test rules.

Warning: permissive public rules are only acceptable for classroom development and short-lived demos. They should not be used for a public long-term deployment.

Recommended classroom development rules:

```json
{
  "rules": {
    "games": {
      "live": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Recommended next-step hardening for a real deployment:

- Add Firebase Authentication.
- Restrict writes to authenticated users or lecturer-only controls.
- Validate expected numeric and string fields in rules.
- Separate student tap writes from lecturer control writes if you need stronger role isolation.

## GitHub Pages Deployment

1. Push the repository to GitHub.
2. Open repository Settings > Pages.
3. Publish from the main branch root.
4. Wait for the Pages site to finish building.

Use relative imports and keep the repository name in the URL path. This project is designed to work from a subpath such as:

- Student URL: `https://hhcheng13.github.io/construction-tap-simulation/`
- Lecturer dashboard URL: `https://hhcheng13.github.io/construction-tap-simulation/dashboard.html`

## How To Run The Game

1. Open the lecturer dashboard URL.
2. Click `Initialize / Reset`.
3. Click `Start`.
4. Ask students to open the student URL and choose their assigned trade.
5. Use `Pause`, `Rain`, `Fatigue`, and `Robot Assistance` during the exercise as needed.

## Simulation Notes

- Five trades are modeled: Excavation, Foundation, Structure, Envelope, and MEP.
- The building has 10 floors.
- Each trade must finish the previous floor before moving up.
- Each floor must follow the trade sequence Excavation -> Foundation -> Structure -> Envelope -> MEP.
- History is stored in Firebase so the S-curve survives page reloads.

## Troubleshooting

`Lecturer has not initialized the game.`

- Open `dashboard.html`.
- Click `Initialize / Reset`.
- Confirm your Firebase rules allow reads and writes to `games/live`.

`Firebase permission denied`

- Recheck the Realtime Database rules.
- Confirm `firebase-config.js` points to the correct project and database URL.
- Make sure you published the rules to the same Firebase project used by the site.

`GitHub Pages 404`

- Confirm the repository name in the URL is `construction-tap-simulation`.
- Confirm Pages is publishing from the repository root.
- Wait a minute and reload after the Pages deployment completes.

`Charts not loading`

- Check browser devtools for blocked CDN requests to Chart.js or Mermaid.
- Confirm the page is being served over HTTPS from GitHub Pages.
- Make sure `dashboard.html` can import `./simulation.js` and `./firebase-config.js` with relative paths.

## Commit And Push

```bash
git add .
git commit -m "Upgrade construction simulation"
git push
```
