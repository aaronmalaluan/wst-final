'use strict';
/**
 * CommuNect backend
 * Express + JSON-file storage (no database install needed).
 * Roles: "resident" (self-register) and "official" (seeded / created by an official).
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me-before-deploying';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ------------------------------------------------------------------ */
/* Barangay profile & lists  (edit these for your own barangay)        */
/* ------------------------------------------------------------------ */
const BARANGAY = {
  name: 'Barangay Maligaya',
  place: 'Your City, Your Province',
  captain: 'Hon. Juan Dela Cruz',
  hallHours: 'Monday to Friday, 8:00 AM to 5:00 PM',
  about:
    'A growing community of families, small businesses, and students. The barangay hall is the first stop for permits, assistance programs, and community concerns.',
  hotlines: [
    { label: 'National Emergency', number: '911' },
    { label: 'Barangay Hall', number: '(000) 000-0000' },
    { label: 'Health Center', number: '(000) 000-0000' },
    { label: 'Barangay Peace and Order', number: '(000) 000-0000' }
  ]
};

const META = {
  announcementCategories: ['General', 'Water', 'Electricity', 'Garbage Collection', 'Disaster and Emergency'],
  concernCategories: ['Roads and Drainage', 'Garbage and Sanitation', 'Water Supply', 'Electricity and Street Lights', 'Peace and Order', 'Health and Safety', 'Others'],
  concernStatuses: ['Pending', 'In Progress', 'Resolved'],
  eventTypes: ['Barangay Meeting', 'Sports', 'Clean-up Drive', 'Community Program'],
  assistanceTypes: ['Scholarship', 'Financial Assistance', 'Livelihood', 'Feeding Program'],
  feedbackServices: ['Barangay Hall Services', 'Concern Handling', 'Health Services', 'Peace and Order', 'Programs and Events', 'Other']
};

/* ------------------------------------------------------------------ */
/* Small utilities                                                      */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const uid = () => crypto.randomBytes(5).toString('hex');
const nowISO = () => new Date().toISOString();
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const dateOnly = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const monthKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function str(v, { min = 0, max = 500, name = 'This field' } = {}) {
  v = typeof v === 'string' ? v.trim() : '';
  if (min > 0 && v.length === 0) throw new HttpError(400, `${name} is required.`);
  if (v.length < min) throw new HttpError(400, `${name} must be at least ${min} characters.`);
  if (v.length > max) throw new HttpError(400, `${name} must be ${max} characters or fewer.`);
  return v;
}
function oneOf(v, list, name) {
  if (!list.includes(v)) throw new HttpError(400, `Choose a valid ${name}.`);
  return v;
}
function isoDateStr(v, name, required = true) {
  if (!v && !required) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + 'T00:00:00'))) {
    throw new HttpError(400, `${name} must be a valid date.`);
  }
  return v;
}
function intIn(v, min, max, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/* ---- passwords & tokens ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Storage                                                              */
/* ------------------------------------------------------------------ */
let db;
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function load() {
  if (fs.existsSync(DB_FILE)) { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); return; }
  db = seed();
  save();
  console.log('Created a fresh database with sample data.');
}

function notify(userId, text, link = '') {
  db.notifications.push({ id: uid(), userId, text, link, read: false, createdAt: nowISO() });
}
const notifyOfficials = (text, link) => db.users.filter((u) => u.role === 'official').forEach((u) => notify(u.id, text, link));
const notifyResidents = (text, link) => db.users.filter((u) => u.role === 'resident').forEach((u) => notify(u.id, text, link));

/* ------------------------------------------------------------------ */
/* Seed data (sample content so every screen has something to show)     */
/* ------------------------------------------------------------------ */
function seed() {
  const rand = (() => { let s = 20260; return () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const d = { users: [], announcements: [], concerns: [], events: [], registrations: [], assistance: [], lostfound: [], feedback: [], notifications: [] };

  const mkUser = (name, email, pw, role, address) => {
    const u = { id: uid(), name, email, passwordHash: hashPassword(pw), role, address, createdAt: nowISO() };
    d.users.push(u); return u;
  };
  mkUser('Barangay Official', 'official@communect.ph', 'official123', 'official', 'Barangay Hall');
  const demo = mkUser('Maria Santos', 'resident@communect.ph', 'resident123', 'resident', 'Purok 2');
  const extra = [
    mkUser('Pedro Reyes', 'pedro@example.com', crypto.randomBytes(8).toString('hex'), 'resident', 'Purok 3'),
    mkUser('Ana Lopez', 'ana@example.com', crypto.randomBytes(8).toString('hex'), 'resident', 'Riverside'),
    mkUser('Jose Garcia', 'jose@example.com', crypto.randomBytes(8).toString('hex'), 'resident', 'Market Area')
  ];
  const residents = [demo, ...extra];

  /* announcements */
  const ann = (title, body, category, urgent, effectiveDate, ago) =>
    d.announcements.push({ id: uid(), title, body, category, urgent, effectiveDate, createdAt: daysFromNow(-ago).toISOString(), author: 'Barangay Office' });
  ann('Water interruption: Purok 1 to Purok 3',
    'The water district will flush the main line. Expect no water supply from 8:00 AM to 5:00 PM. Store enough water for cooking and drinking, and keep containers covered.',
    'Water', true, dateOnly(daysFromNow(2)), 0);
  ann('Typhoon preparedness: what to do before the signal is raised',
    'Charge phones and power banks, prepare a go-bag with IDs, medicines, and water, and know your evacuation center. The barangay hall gym opens as the evacuation center when Signal No. 2 is raised.',
    'Disaster and Emergency', true, '', 1);
  ann('Water bill payment schedule for this month',
    'Payments are accepted at the barangay collection desk. Purok 1 to 3: the 5th to the 10th. Purok 4 to 6: the 11th to the 15th. Bring your previous receipt. Late payments after the 20th may incur a surcharge.',
    'Water', false, dateOnly(daysFromNow(5)), 2);
  ann('Scheduled electricity interruption on Rizal Street',
    'The power company will replace aging poles along Rizal Street. Power will be off from 9:00 AM to 3:00 PM. Residents who rely on medical equipment should arrange backup power.',
    'Electricity', false, dateOnly(daysFromNow(4)), 3);
  ann('Garbage collection schedule',
    'Biodegradable waste: Monday and Thursday. Non-biodegradable: Tuesday and Friday. Recyclables: first Saturday of the month. Please place bins by the curb before 6:00 AM.',
    'Garbage Collection', false, '', 6);
  ann('Barangay ID and clearance processing hours',
    'Barangay IDs and clearances are processed from 8:00 AM to 4:00 PM. Bring one valid ID and proof of residency.',
    'General', false, '', 9);

  /* events */
  const ev = (title, type, offset, time, venue, description, capacity, needsVolunteers) => {
    const e = { id: uid(), title, type, date: dateOnly(daysFromNow(offset)), time, venue, description, capacity, needsVolunteers, createdAt: nowISO() };
    d.events.push(e); return e;
  };
  const past = ev('Community Zumba and Wellness Day', 'Community Program', -10, '6:00 AM', 'Barangay Covered Court', 'Free group exercise and blood pressure checks for all ages.', 80, false);
  ev('Barangay General Assembly', 'Barangay Meeting', 3, '2:00 PM', 'Barangay Hall', 'Report on the barangay budget and projects, followed by an open forum. All households are encouraged to send a representative.', 200, false);
  ev('Canal and Street Clean-up Drive', 'Clean-up Drive', 7, '6:30 AM', 'Meet at the Barangay Hall', 'Bring gloves and a sack. The barangay provides refreshments and tools. Volunteers help sort waste and guide groups.', 60, true);
  ev('Inter-Purok Basketball League: Opening Day', 'Sports', 12, '3:00 PM', 'Barangay Covered Court', 'Opening ceremony and first games. Team registration is through your Purok leader.', 150, true);
  ev('Free Medical and Dental Mission', 'Community Program', 20, '8:00 AM', 'Barangay Health Center', 'Consultations, dental extraction, and free medicines while supplies last. Priority for seniors and children under 12.', 120, true);
  residents.forEach((r, i) => d.registrations.push({ id: uid(), eventId: past.id, userId: r.id, name: r.name, contact: '', role: 'Participant', attended: i !== 3, createdAt: nowISO() }));

  /* assistance */
  const as = (title, type, description, eligibility, deadlineOffset, howToApply) =>
    d.assistance.push({ id: uid(), title, type, description, eligibility, deadline: dateOnly(daysFromNow(deadlineOffset)), howToApply, createdAt: nowISO() });
  as('Barangay Scholarship Program', 'Scholarship', 'Tuition and allowance support for college and senior high school students from low-income households.',
    ['Resident of the barangay for at least 2 years', 'General weighted average of 85 or higher', 'Family income below the set threshold', 'Not a recipient of another scholarship'], 25,
    'Submit the application form, report card, and certificate of indigency at the barangay hall.');
  as('Emergency Cash Assistance', 'Financial Assistance', 'One-time cash aid for families affected by fire, flood, or the sudden loss of a household earner.',
    ['Registered resident', 'Barangay certification of the incident', 'One application per household'], 14,
    'Go to the Social Welfare desk with your valid ID and incident report.');
  as('Skills Training: Baking and Food Processing', 'Livelihood', 'A 4-week training with a starter kit for graduates who complete all sessions.',
    ['18 years old and above', 'Able to attend all sessions', 'Priority to solo parents and unemployed residents'], 18,
    'Register online or at the hall. Slots are limited to 30 participants.');
  as('Supplemental Feeding Program', 'Feeding Program', 'Weekly hot meals and monitoring for children aged 2 to 5 identified as underweight.',
    ['Child aged 2 to 5', 'Weight screening by the Barangay Nutrition Scholar', 'Parent or guardian attends the monthly nutrition talk'], 40,
    'Bring the child to the Health Center for weighing every Wednesday.');

  /* lost & found */
  const lf = (userId, kind, item, description, location, ago, contactPerson, contactNumber) =>
    d.lostfound.push({ id: uid(), userId, kind, item, description, location, date: dateOnly(daysFromNow(-ago)), contactPerson, contactNumber, status: 'open', createdAt: daysFromNow(-ago).toISOString() });
  lf(demo.id, 'lost', 'Black wallet', 'Contains a student ID and a green sling. Lost while walking from the market.', 'Market Area', 2, 'Maria Santos', '0900 000 0000');
  lf(extra[0].id, 'found', 'Set of keys with a blue keychain', 'Found on a bench near the basketball court. Held at the barangay hall for claiming.', 'Covered Court', 1, 'Barangay Hall Desk', '(000) 000-0000');

  /* concerns spread across the last ~6 months so analytics have shape */
  const cats = META.concernCategories;
  const titles = {
    'Roads and Drainage': ['Clogged drainage along the road', 'Large pothole near the corner'],
    'Garbage and Sanitation': ['Uncollected garbage pile', 'Illegal dumping near the creek'],
    'Water Supply': ['Low water pressure in the morning', 'Leaking water pipe on the street'],
    'Electricity and Street Lights': ['Street light not working', 'Dangling electric wire'],
    'Peace and Order': ['Noise complaint late at night', 'Suspicious persons loitering'],
    'Health and Safety': ['Stagnant water, mosquito breeding site', 'Stray dogs near the school'],
    Others: ['Request for a barangay tanod patrol', 'Damaged waiting shed']
  };
  const weighted = ['Roads and Drainage', 'Roads and Drainage', 'Roads and Drainage', 'Garbage and Sanitation', 'Garbage and Sanitation', 'Garbage and Sanitation', 'Water Supply', 'Water Supply', 'Electricity and Street Lights', 'Electricity and Street Lights', 'Peace and Order', 'Health and Safety', 'Others'];
  const locs = ['Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5', 'Riverside', 'Market Area'];
  const hot = { 'Roads and Drainage': 'Purok 3', 'Garbage and Sanitation': 'Market Area', 'Water Supply': 'Purok 5', 'Electricity and Street Lights': 'Riverside' };
  const feedbackMsgs = ['Fast response, thank you.', 'The problem was fixed, but it took a while.', 'Very helpful tanods.', 'Please keep us updated sooner.', 'Satisfied with the result.'];

  for (let i = 0; i < 46; i++) {
    const ago = Math.floor(rand() * 170);
    const category = pick(weighted);
    const location = hot[category] && rand() < 0.6 ? hot[category] : pick(locs);
    const r = pick(residents);
    const created = daysFromNow(-ago);
    const roll = rand();
    const status = ago > 14 ? (roll < 0.72 ? 'Resolved' : roll < 0.87 ? 'In Progress' : 'Pending') : (roll < 0.2 ? 'Resolved' : roll < 0.55 ? 'In Progress' : 'Pending');
    const c = {
      id: uid(), userId: r.id, residentName: r.name, title: pick(titles[category]), category, location,
      description: 'Reported by a resident. Please inspect the area and advise on the next steps.',
      status, createdAt: created.toISOString(), resolvedAt: null, rated: false,
      updates: [{ at: created.toISOString(), by: 'System', status: 'Pending', message: 'Concern received by the barangay.' }]
    };
    if (status !== 'Pending') {
      const t1 = new Date(created.getTime() + (0.3 + rand()) * 864e5);
      c.updates.push({ at: t1.toISOString(), by: 'Barangay Official', status: 'In Progress', message: 'A team has been assigned and will visit the site.' });
    }
    if (status === 'Resolved') {
      const t2 = new Date(created.getTime() + (1 + rand() * 5) * 864e5);
      c.resolvedAt = t2.toISOString();
      c.updates.push({ at: t2.toISOString(), by: 'Barangay Official', status: 'Resolved', message: 'Work completed and verified on site.' });
      if (rand() < 0.65) {
        c.rated = true;
        const rating = rand() < 0.15 ? 3 : rand() < 0.5 ? 4 : 5;
        d.feedback.push({ id: uid(), userId: r.id, name: r.name, type: 'service', service: 'Concern Handling', rating, message: pick(feedbackMsgs), concernId: c.id, createdAt: t2.toISOString() });
      }
    }
    d.concerns.push(c);
  }
  d.feedback.push(
    { id: uid(), userId: demo.id, name: demo.name, type: 'suggestion', service: 'Programs and Events', rating: null, message: 'Please add evening schedules for livelihood training so working parents can join.', concernId: null, createdAt: daysFromNow(-8).toISOString() },
    { id: uid(), userId: extra[1].id, name: extra[1].name, type: 'service', service: 'Barangay Hall Services', rating: 4, message: 'Clearance processing was quick.', concernId: null, createdAt: daysFromNow(-12).toISOString() },
    { id: uid(), userId: extra[2].id, name: extra[2].name, type: 'suggestion', service: 'Peace and Order', rating: null, message: 'More tanod rounds near the market after 9 PM would help.', concernId: null, createdAt: daysFromNow(-20).toISOString() }
  );
  return d;
}

/* ------------------------------------------------------------------ */
/* App & middleware                                                     */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'"
  });
  next();
});

app.use((req, res, next) => {
  const h = req.headers.authorization || '';
  const payload = h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  if (payload) req.user = db.users.find((u) => u.id === payload.id);
  next();
});
const needLogin = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue.')));
const needOfficial = (req, res, next) => (req.user && req.user.role === 'official' ? next() : next(new HttpError(403, 'Only barangay officials can do this.')));
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, address: u.address });

/* basic brute-force guard on auth routes: 20 attempts / 10 min / IP */
const attempts = new Map();
function authLimiter(req, res, next) {
  const key = req.ip, now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < 600000);
  if (rec.length >= 20) return next(new HttpError(429, 'Too many attempts. Wait a few minutes and try again.'));
  rec.push(now); attempts.set(key, rec); next();
}

const api = express.Router();
app.use('/api', api);

/* ---- meta & overview ---- */
api.get('/meta', (req, res) => res.json({ ...META, barangay: BARANGAY }));

const today = () => dateOnly(new Date());
const sortAnn = (a, b) => (b.urgent - a.urgent) || b.createdAt.localeCompare(a.createdAt);

api.get('/overview', (req, res) => {
  const upcoming = db.events.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  res.json({
    barangay: BARANGAY,
    stats: {
      resolvedConcerns: db.concerns.filter((c) => c.status === 'Resolved').length,
      upcomingEvents: upcoming.length,
      openPrograms: db.assistance.filter((a) => a.deadline >= today()).length
    },
    announcements: [...db.announcements].sort(sortAnn).slice(0, 4),
    events: upcoming.slice(0, 3).map((e) => withEventCounts(e))
  });
});

/* ---- auth ---- */
api.post('/auth/register', authLimiter, (req, res) => {
  const name = str(req.body.name, { min: 2, max: 80, name: 'Full name' });
  const email = str(req.body.email, { min: 5, max: 120, name: 'Email' }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = str(req.body.password, { min: 8, max: 100, name: 'Password' });
  const address = str(req.body.address, { min: 2, max: 120, name: 'Purok or address' });
  if (db.users.some((u) => u.email === email)) throw new HttpError(409, 'An account with this email already exists.');
  const user = { id: uid(), name, email, passwordHash: hashPassword(password), role: 'resident', address, createdAt: nowISO() };
  db.users.push(user);
  notify(user.id, 'Welcome to CommuNect. You can now report concerns and join events.', '#/concerns');
  save();
  res.status(201).json({ token: signToken({ id: user.id, exp: Date.now() + 7 * 864e5 }), user: publicUser(user) });
});

api.post('/auth/login', authLimiter, (req, res) => {
  const email = str(req.body.email, { min: 1, max: 120, name: 'Email' }).toLowerCase();
  const password = str(req.body.password, { min: 1, max: 100, name: 'Password' });
  const user = db.users.find((u) => u.email === email);
  if (!user || !checkPassword(password, user.passwordHash)) throw new HttpError(401, 'Email or password is incorrect.');
  res.json({ token: signToken({ id: user.id, exp: Date.now() + 7 * 864e5 }), user: publicUser(user) });
});

api.get('/auth/me', needLogin, (req, res) => res.json({ user: publicUser(req.user), unread: db.notifications.filter((n) => n.userId === req.user.id && !n.read).length }));

/* ---- announcements ---- */
function annInput(b) {
  return {
    title: str(b.title, { min: 3, max: 140, name: 'Title' }),
    body: str(b.body, { min: 10, max: 3000, name: 'Details' }),
    category: oneOf(b.category, META.announcementCategories, 'category'),
    urgent: !!b.urgent,
    effectiveDate: isoDateStr(b.effectiveDate || '', 'Effective date', false)
  };
}
api.get('/announcements', (req, res) => {
  let list = [...db.announcements];
  if (req.query.category) list = list.filter((a) => a.category === req.query.category);
  res.json(list.sort(sortAnn));
});
api.post('/announcements', needOfficial, (req, res) => {
  const a = { id: uid(), ...annInput(req.body), author: req.user.name, createdAt: nowISO() };
  db.announcements.push(a);
  if (a.urgent) notifyResidents(`Urgent: ${a.title}`, '#/announcements');
  save(); res.status(201).json(a);
});
api.put('/announcements/:id', needOfficial, (req, res) => {
  const a = db.announcements.find((x) => x.id === req.params.id);
  if (!a) throw new HttpError(404, 'Announcement not found.');
  Object.assign(a, annInput(req.body)); save(); res.json(a);
});
api.delete('/announcements/:id', needOfficial, (req, res) => {
  const i = db.announcements.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw new HttpError(404, 'Announcement not found.');
  db.announcements.splice(i, 1); save(); res.json({ ok: true });
});

/* ---- community concerns ---- */
api.get('/concerns', needLogin, (req, res) => {
  let list = req.user.role === 'official' ? [...db.concerns] : db.concerns.filter((c) => c.userId === req.user.id);
  if (req.query.status) list = list.filter((c) => c.status === req.query.status);
  if (req.query.category) list = list.filter((c) => c.category === req.query.category);
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});
api.post('/concerns', needLogin, (req, res) => {
  if (req.user.role !== 'resident') throw new HttpError(403, 'Concerns are submitted from resident accounts.');
  const c = {
    id: uid(), userId: req.user.id, residentName: req.user.name,
    title: str(req.body.title, { min: 3, max: 120, name: 'Title' }),
    description: str(req.body.description, { min: 10, max: 2000, name: 'Description' }),
    category: oneOf(req.body.category, META.concernCategories, 'category'),
    location: str(req.body.location, { min: 2, max: 120, name: 'Location' }),
    status: 'Pending', createdAt: nowISO(), resolvedAt: null, rated: false,
    updates: [{ at: nowISO(), by: 'System', status: 'Pending', message: 'Concern received by the barangay.' }]
  };
  db.concerns.push(c);
  notifyOfficials(`New concern: ${c.title} (${c.location})`, '#/concerns');
  save(); res.status(201).json(c);
});
api.patch('/concerns/:id', needOfficial, (req, res) => {
  const c = db.concerns.find((x) => x.id === req.params.id);
  if (!c) throw new HttpError(404, 'Concern not found.');
  const status = oneOf(req.body.status, META.concernStatuses, 'status');
  const message = str(req.body.message, { min: 3, max: 500, name: 'Update message' });
  c.status = status;
  c.resolvedAt = status === 'Resolved' ? nowISO() : null;
  c.updates.push({ at: nowISO(), by: req.user.name, status, message });
  notify(c.userId, `Your concern "${c.title}" is now ${status}.`, '#/concerns');
  save(); res.json(c);
});
api.post('/concerns/:id/rate', needLogin, (req, res) => {
  const c = db.concerns.find((x) => x.id === req.params.id);
  if (!c || c.userId !== req.user.id) throw new HttpError(404, 'Concern not found.');
  if (c.status !== 'Resolved') throw new HttpError(400, 'You can rate a concern after it is resolved.');
  if (c.rated) throw new HttpError(400, 'You already rated this concern.');
  const rating = intIn(req.body.rating, 1, 5, 'Rating');
  const message = str(req.body.message, { max: 500 });
  db.feedback.push({ id: uid(), userId: req.user.id, name: req.user.name, type: 'service', service: 'Concern Handling', rating, message, concernId: c.id, createdAt: nowISO() });
  c.rated = true; save(); res.status(201).json(c);
});

/* ---- events ---- */
function withEventCounts(e, user) {
  const regs = db.registrations.filter((r) => r.eventId === e.id);
  const mine = user ? regs.find((r) => r.userId === user.id) : null;
  return { ...e, registered: regs.length, volunteers: regs.filter((r) => r.role === 'Volunteer').length, attended: regs.filter((r) => r.attended).length, myRegistration: mine ? { id: mine.id, role: mine.role } : null };
}
function eventInput(b) {
  return {
    title: str(b.title, { min: 3, max: 140, name: 'Title' }),
    type: oneOf(b.type, META.eventTypes, 'event type'),
    date: isoDateStr(b.date, 'Date'),
    time: str(b.time, { min: 1, max: 30, name: 'Time' }),
    venue: str(b.venue, { min: 2, max: 140, name: 'Venue' }),
    description: str(b.description, { min: 10, max: 2000, name: 'Details' }),
    capacity: intIn(b.capacity, 1, 5000, 'Capacity'),
    needsVolunteers: !!b.needsVolunteers
  };
}
api.get('/events', (req, res) => {
  res.json(db.events.map((e) => withEventCounts(e, req.user)).sort((a, b) => a.date.localeCompare(b.date)));
});
api.post('/events', needOfficial, (req, res) => {
  const e = { id: uid(), ...eventInput(req.body), createdAt: nowISO() };
  db.events.push(e); notifyResidents(`New event: ${e.title}`, '#/events'); save(); res.status(201).json(e);
});
api.delete('/events/:id', needOfficial, (req, res) => {
  const i = db.events.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw new HttpError(404, 'Event not found.');
  db.events.splice(i, 1);
  db.registrations = db.registrations.filter((r) => r.eventId !== req.params.id);
  save(); res.json({ ok: true });
});
api.post('/events/:id/register', needLogin, (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!e) throw new HttpError(404, 'Event not found.');
  if (e.date < today()) throw new HttpError(400, 'This event has already happened.');
  const role = oneOf(req.body.role || 'Participant', ['Participant', 'Volunteer'], 'role');
  if (role === 'Volunteer' && !e.needsVolunteers) throw new HttpError(400, 'This event is not accepting volunteers.');
  if (db.registrations.some((r) => r.eventId === e.id && r.userId === req.user.id)) throw new HttpError(409, 'You are already registered for this event.');
  if (db.registrations.filter((r) => r.eventId === e.id).length >= e.capacity) throw new HttpError(409, 'This event is full.');
  const reg = { id: uid(), eventId: e.id, userId: req.user.id, name: req.user.name, contact: str(req.body.contact, { max: 40 }), role, attended: false, createdAt: nowISO() };
  db.registrations.push(reg);
  notify(req.user.id, `You are registered as a ${role.toLowerCase()} for "${e.title}".`, '#/events');
  save(); res.status(201).json(reg);
});
api.delete('/events/:id/register', needLogin, (req, res) => {
  const i = db.registrations.findIndex((r) => r.eventId === req.params.id && r.userId === req.user.id);
  if (i < 0) throw new HttpError(404, 'Registration not found.');
  db.registrations.splice(i, 1); save(); res.json({ ok: true });
});
api.get('/events/:id/registrations', needOfficial, (req, res) => res.json(db.registrations.filter((r) => r.eventId === req.params.id)));
api.patch('/events/:id/registrations/:rid', needOfficial, (req, res) => {
  const r = db.registrations.find((x) => x.id === req.params.rid && x.eventId === req.params.id);
  if (!r) throw new HttpError(404, 'Registration not found.');
  r.attended = !!req.body.attended; save(); res.json(r);
});

/* ---- assistance ---- */
api.get('/assistance', (req, res) => {
  let list = [...db.assistance];
  if (req.query.type) list = list.filter((a) => a.type === req.query.type);
  res.json(list.sort((a, b) => a.deadline.localeCompare(b.deadline)));
});
api.post('/assistance', needOfficial, (req, res) => {
  const b = req.body;
  const eligibility = (Array.isArray(b.eligibility) ? b.eligibility : String(b.eligibility || '').split('\n')).map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
  if (!eligibility.length) throw new HttpError(400, 'List at least one eligibility requirement.');
  const a = {
    id: uid(), title: str(b.title, { min: 3, max: 140, name: 'Title' }), type: oneOf(b.type, META.assistanceTypes, 'program type'),
    description: str(b.description, { min: 10, max: 2000, name: 'Description' }), eligibility,
    deadline: isoDateStr(b.deadline, 'Deadline'), howToApply: str(b.howToApply, { min: 5, max: 500, name: 'How to apply' }), createdAt: nowISO()
  };
  db.assistance.push(a); notifyResidents(`New program: ${a.title}`, '#/assistance'); save(); res.status(201).json(a);
});
api.delete('/assistance/:id', needOfficial, (req, res) => {
  const i = db.assistance.findIndex((x) => x.id === req.params.id);
  if (i < 0) throw new HttpError(404, 'Program not found.');
  db.assistance.splice(i, 1); save(); res.json({ ok: true });
});

/* ---- lost & found (contact details only shown to logged-in users) ---- */
api.get('/lostfound', (req, res) => {
  let list = [...db.lostfound];
  if (req.query.kind) list = list.filter((i) => i.kind === req.query.kind);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map((i) => (req.user ? { ...i, canManage: req.user.role === 'official' || req.user.id === i.userId } : { ...i, contactPerson: null, contactNumber: null, canManage: false })));
});
api.post('/lostfound', needLogin, (req, res) => {
  const b = req.body;
  const i = {
    id: uid(), userId: req.user.id, kind: oneOf(b.kind, ['lost', 'found'], 'type'),
    item: str(b.item, { min: 2, max: 100, name: 'Item name' }), description: str(b.description, { min: 5, max: 600, name: 'Description' }),
    location: str(b.location, { min: 2, max: 120, name: 'Place' }), date: isoDateStr(b.date, 'Date'),
    contactPerson: str(b.contactPerson, { min: 2, max: 80, name: 'Contact person' }), contactNumber: str(b.contactNumber, { min: 5, max: 40, name: 'Contact number' }),
    status: 'open', createdAt: nowISO()
  };
  db.lostfound.push(i); save(); res.status(201).json(i);
});
api.patch('/lostfound/:id', needLogin, (req, res) => {
  const i = db.lostfound.find((x) => x.id === req.params.id);
  if (!i) throw new HttpError(404, 'Item not found.');
  if (req.user.role !== 'official' && req.user.id !== i.userId) throw new HttpError(403, 'Only the poster or an official can update this item.');
  i.status = oneOf(req.body.status, ['open', 'returned'], 'status'); save(); res.json(i);
});
api.delete('/lostfound/:id', needLogin, (req, res) => {
  const idx = db.lostfound.findIndex((x) => x.id === req.params.id);
  if (idx < 0) throw new HttpError(404, 'Item not found.');
  const i = db.lostfound[idx];
  if (req.user.role !== 'official' && req.user.id !== i.userId) throw new HttpError(403, 'Only the poster or an official can remove this item.');
  db.lostfound.splice(idx, 1); save(); res.json({ ok: true });
});

/* ---- feedback ---- */
api.post('/feedback', needLogin, (req, res) => {
  const b = req.body;
  const type = oneOf(b.type, ['service', 'suggestion'], 'feedback type');
  const f = {
    id: uid(), userId: req.user.id, name: req.user.name, type,
    service: oneOf(b.service, META.feedbackServices, 'service'),
    rating: type === 'service' ? intIn(b.rating, 1, 5, 'Rating') : null,
    message: str(b.message, { min: type === 'suggestion' ? 10 : 0, max: 1000, name: 'Message' }),
    concernId: null, createdAt: nowISO()
  };
  db.feedback.push(f); notifyOfficials(`New ${type === 'service' ? 'service rating' : 'suggestion'} from ${req.user.name}`, '#/dashboard/analytics'); save();
  res.status(201).json(f);
});
api.get('/feedback/mine', needLogin, (req, res) => res.json(db.feedback.filter((f) => f.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

/* ---- notifications ---- */
api.get('/notifications', needLogin, (req, res) => res.json(db.notifications.filter((n) => n.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)));
api.post('/notifications/read', needLogin, (req, res) => { db.notifications.forEach((n) => { if (n.userId === req.user.id) n.read = true; }); save(); res.json({ ok: true }); });

/* ---- official dashboard ---- */
api.get('/dashboard/overview', needOfficial, (req, res) => {
  const c = db.concerns;
  const upcoming = db.events.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  res.json({
    totals: {
      totalReports: c.length,
      pending: c.filter((x) => x.status === 'Pending').length,
      inProgress: c.filter((x) => x.status === 'In Progress').length,
      resolved: c.filter((x) => x.status === 'Resolved').length,
      upcomingActivities: upcoming.length
    },
    pendingConcerns: c.filter((x) => x.status === 'Pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 6),
    upcomingEvents: upcoming.slice(0, 5).map((e) => withEventCounts(e))
  });
});

api.get('/dashboard/analytics', needOfficial, (req, res) => {
  const c = db.concerns;

  // last 6 months (oldest first)
  const months = [];
  const base = new Date(); base.setDate(1);
  for (let i = 5; i >= 0; i--) { const d = new Date(base.getFullYear(), base.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }

  const byCategory = META.concernCategories.map((cat) => ({ category: cat, total: c.filter((x) => x.category === cat).length }));
  const categoryByMonth = META.concernCategories.map((cat) => ({
    category: cat,
    counts: months.map((m) => c.filter((x) => x.category === cat && monthKey(x.createdAt) === m).length)
  }));
  const perMonth = months.map((m) => c.filter((x) => monthKey(x.createdAt) === m).length);

  // recurring problems: same category repeated in the same area
  const groups = {};
  c.forEach((x) => {
    const k = `${x.location}||${x.category}`;
    groups[k] = groups[k] || { location: x.location, category: x.category, count: 0, open: 0 };
    groups[k].count++; if (x.status !== 'Resolved') groups[k].open++;
  });
  const recurring = Object.values(groups).filter((g) => g.count >= 3).sort((a, b) => b.count - a.count).slice(0, 8);
  const byArea = Object.entries(c.reduce((m, x) => ((m[x.location] = (m[x.location] || 0) + 1), m), {})).map(([location, total]) => ({ location, total })).sort((a, b) => b.total - a.total);

  // resolution performance
  const resolved = c.filter((x) => x.status === 'Resolved' && x.resolvedAt);
  const avgHours = resolved.length ? resolved.reduce((s, x) => s + (new Date(x.resolvedAt) - new Date(x.createdAt)) / 36e5, 0) / resolved.length : 0;
  const resolutionRate = c.length ? (c.filter((x) => x.status === 'Resolved').length / c.length) * 100 : 0;
  const avgHoursByCategory = META.concernCategories.map((cat) => {
    const r = resolved.filter((x) => x.category === cat);
    return { category: cat, hours: r.length ? r.reduce((s, x) => s + (new Date(x.resolvedAt) - new Date(x.createdAt)) / 36e5, 0) / r.length : null };
  });

  // feedback
  const rated = db.feedback.filter((f) => f.rating);
  const distribution = [5, 4, 3, 2, 1].map((n) => ({ rating: n, count: rated.filter((f) => f.rating === n).length }));
  const byService = META.feedbackServices.map((s) => {
    const r = rated.filter((f) => f.service === s);
    return { service: s, count: r.length, average: r.length ? r.reduce((a, f) => a + f.rating, 0) / r.length : null };
  }).filter((x) => x.count);
  const recentComments = [...db.feedback].filter((f) => f.message).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
    .map((f) => ({ name: f.name, type: f.type, service: f.service, rating: f.rating, message: f.message, createdAt: f.createdAt }));

  // events
  const eventStats = db.events.map((e) => withEventCounts(e)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
    .map((e) => ({ id: e.id, title: e.title, type: e.type, date: e.date, capacity: e.capacity, registered: e.registered, volunteers: e.volunteers, attended: e.attended, isPast: e.date < today() }));
  const pastEvents = eventStats.filter((e) => e.isPast && e.registered);
  const attendanceRate = pastEvents.length ? (pastEvents.reduce((s, e) => s + e.attended, 0) / pastEvents.reduce((s, e) => s + e.registered, 0)) * 100 : null;

  res.json({
    months, perMonth, byCategory, categoryByMonth, byArea, recurring,
    resolution: { averageHours: avgHours, rate: resolutionRate, resolved: resolved.length, total: c.length, byCategory: avgHoursByCategory },
    feedback: { count: db.feedback.length, ratedCount: rated.length, average: rated.length ? rated.reduce((s, f) => s + f.rating, 0) / rated.length : null, distribution, byService, recentComments },
    events: { stats: eventStats, totalRegistrations: db.registrations.length, totalVolunteers: db.registrations.filter((r) => r.role === 'Volunteer').length, attendanceRate }
  });
});

/* ---- 404 for unknown API routes, static frontend, error handler ---- */
api.use((req, res, next) => next(new HttpError(404, 'That API route does not exist.')));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'The request body is not valid JSON.');
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side. Try again.' : err.message });
});

load();
app.listen(PORT, () => {
  console.log(`CommuNect running at http://localhost:${PORT}`);
  console.log('Demo logins:  official@communect.ph / official123   |   resident@communect.ph / resident123');
});
