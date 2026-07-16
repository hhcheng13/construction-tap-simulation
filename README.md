# Construction Tap Simulation

A classroom simulation for five construction crews (test):

1. Excavation
2. Foundation
3. Structure
4. Envelope
5. MEP

Students use `index.html`. The lecturer projects `dashboard.html`.

## Why Firebase is needed

GitHub Pages only hosts static HTML/CSS/JavaScript. Firebase Realtime Database provides shared live state across all student phones.

## Setup

1. Create a Firebase project.
2. Create a Realtime Database.
3. Register a Web App.
4. Copy the Firebase configuration into `firebase-config.js`.
5. For initial testing only, use temporary database rules:

```json
{
  "rules": {
    "games": {
      ".read": true,
      ".write": true
    }
  }
}
```

Do not use open rules for a public long-term deployment.

6. Push all files to a GitHub repository.
7. Enable GitHub Pages from the repository settings.
8. Open:
   - Player: `https://YOURNAME.github.io/REPOSITORY/`
   - Dashboard: `https://YOURNAME.github.io/REPOSITORY/dashboard.html`

## Teaching sequence

- Round 1: unlimited tapping, observe bottlenecks.
- Round 2: discuss precedence and blocked crews.
- Round 3: introduce fatigue/productivity variability.
- Round 4: add cost, rework, equipment breakdown, or safety events.

## Important limitation

The current prototype trusts the browser. A student can technically manipulate requests. This is acceptable for a controlled classroom demonstration, but a production version should use Firebase Authentication, stricter rules, and server-side validation.
