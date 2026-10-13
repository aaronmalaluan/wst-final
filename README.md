# CommuNect

A responsive web platform that connects barangay residents and officials: verified announcements, events, assistance programs, concern reporting and tracking, lost and found, feedback, and an analytics dashboard for officials.

**Stack:** HTML, CSS, and JavaScript on the frontend. Node.js (Express) on the backend, storing data in a JSON file (`data/db.json`). No database setup needed.

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 18 or newer. The first start creates `data/db.json` with sample data. To wipe it and start fresh: `npm run reset`.

### Demo accounts

| Role     | Email                    | Password     |
|----------|--------------------------|--------------|
| Official | official@communect.ph    | official123  |
| Resident | resident@communect.ph    | resident123  |

Residents can also create their own account from the Log in page.

## What is included

**Residents:** Home, Announcements (filter by water, electricity, garbage, disaster), Community Concerns (submit, track status, view official updates, rate resolved concerns), Events (join as participant or volunteer), Assistance (requirements and deadlines), Lost and Found, Feedback (rate services, send suggestions), Notifications.

**Officials:** Post, edit, and delete announcements. Add events and view registrations (mark attendance). Add assistance programs. Post status updates on concerns (the resident is notified). Dashboard with summary cards (total reports, pending, resolved, upcoming activities) and an Analytics tab: concerns by category and month, recurring problem areas, average resolution time and rate, feedback summaries, and event participation.

## Project structure

```
server.js          Express API, auth, storage, analytics, seed data
public/index.html  App shell
public/styles.css  Styles (background #345351)
public/app.js      Router, views, forms, charts
data/db.json       Created on first run
```

## Customize

- **Barangay name, captain, hotlines, categories:** edit `BARANGAY` and `META` at the top of `server.js`.
- **Colors:** all in the `:root` block of `public/styles.css`. The base background is `--bg: #345351`.

## Before deploying publicly

- Set a strong secret: `TOKEN_SECRET=your-long-random-string npm start`.
- Change or delete the demo accounts (edit the seed in `server.js` before the first run, or remove users from `data/db.json`).
- Serve over HTTPS (for example behind Nginx or a platform like Render or Railway).
- The JSON file store suits a single barangay with modest traffic. For heavier use, move storage to SQLite or PostgreSQL; all data access goes through the `db` object in `server.js`.
