(() => {
'use strict';

/* =========================================================
   Helpers
   ========================================================= */
const TOKEN_KEY = 'communect_token';
const state = { user: null, meta: null, unread: 0 };
const ui = { annCat: '', assistType: '', lfKind: '', concernStatus: '', concernCat: '', fbMode: 'service', loginMode: 'login' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const render = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join('') : v === false || v == null ? '' : esc(v));
const html = (strs, ...vals) => raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? render(vals[i]) : ''), ''));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const isOfficial = () => state.user?.role === 'official';
const isResident = () => state.user?.role === 'resident';

const fmtDate = (d) => new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (d) => new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short' });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysUntil = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5);
const hoursLabel = (h) => (h == null ? 'n/a' : h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`);
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && t && path !== '/auth/login') { localStorage.removeItem(TOKEN_KEY); state.user = null; renderAccount(); }
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
const mount = (tpl) => { $('#view').innerHTML = tpl.s; };
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

/* =========================================================
   Generic modal form
   fields: { name, label, type, options, required, placeholder, hint, value }
   ========================================================= */
function openForm({ title, intro = '', fields, submitLabel = 'Save', onSubmit }) {
  const dlg = document.createElement('dialog');
  const fieldHtml = (f) => {
    const id = 'f_' + f.name;
    const val = f.value ?? '';
    const req = f.required === false ? '' : 'required';
    let control;
    if (f.type === 'textarea') control = html`<textarea id="${id}" name="${f.name}" ${raw(req)} placeholder="${f.placeholder || ''}">${val}</textarea>`;
    else if (f.type === 'select') control = html`<select id="${id}" name="${f.name}" ${raw(req)}>${f.options.map((o) => html`<option value="${o}" ${raw(o === val ? 'selected' : '')}>${o}</option>`)}</select>`;
    else if (f.type === 'checkbox') return html`<div class="field"><label class="check"><input type="checkbox" name="${f.name}" ${raw(val ? 'checked' : '')}> <span>${f.label}</span></label></div>`;
    else if (f.type === 'rating') {
      return html`<div class="field"><label>${f.label}</label><div class="rate" role="radiogroup" aria-label="${f.label}">
        ${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" name="${f.name}" id="${id}${n}" value="${n}" ${raw(n === 1 ? 'required' : '')}><label for="${id}${n}" title="${n} out of 5">★</label>`)}
      </div></div>`;
    } else control = html`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${val}" ${raw(req)} placeholder="${f.placeholder || ''}" ${f.type === 'number' ? raw('min="1"') : ''}>`;
    return html`<div class="field"><label for="${id}">${f.label}</label>${control}${f.hint ? html`<div class="hint">${f.hint}</div>` : ''}</div>`;
  };
  dlg.innerHTML = html`<form method="dialog">
      <h2>${title}</h2>${intro ? html`<p class="dim">${intro}</p>` : ''}
      <div class="form-error" hidden></div>
      ${fields.map(fieldHtml)}
      <div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">${submitLabel}</button></div>
    </form>`.s;
  document.body.appendChild(dlg);
  const form = $('form', dlg), err = $('.form-error', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    fields.forEach((f) => {
      if (f.type === 'checkbox') data[f.name] = form.elements[f.name].checked;
      else if (f.type === 'rating') data[f.name] = (form.querySelector(`input[name="${f.name}"]:checked`) || {}).value;
      else data[f.name] = form.elements[f.name].value;
    });
    const btn = $('button[type=submit]', dlg); btn.disabled = true; err.hidden = true;
    try { await onSubmit(data); dlg.close(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  });
  dlg.showModal();
  const first = form.querySelector('input,select,textarea'); if (first) first.focus();
}

function confirmBox(message) { return window.confirm(message); }

/* =========================================================
   Shared view pieces
   ========================================================= */
const pill = (s) => html`<span class="pill s-${slug(s)}">${s}</span>`;
const tag = (c) => html`<span class="tag t-${slug(c)}">${c}</span>`;
const empty = (msg) => html`<div class="empty">${msg}</div>`;
const loginPrompt = (what) => html`<div class="notice">Log in to ${what}. <a href="#/login">Log in or create an account</a></div>`;

function annItem(a, manage) {
  return html`<li class="item ${a.urgent ? 'urgent' : ''}">
    <div class="meta">${tag(a.category)}${a.urgent ? html`<span class="urgent-flag">Urgent</span>` : ''}<span>Posted ${fmtDate(a.createdAt)}</span>${a.effectiveDate ? html`<span>Effective ${fmtDate(a.effectiveDate)}</span>` : ''}</div>
    <h3>${a.title}</h3>
    <p>${a.body}</p>
    ${manage ? html`<div class="row"><button class="small" data-act="ann-edit" data-id="${a.id}">Edit</button><button class="small danger" data-act="ann-del" data-id="${a.id}">Delete</button></div>` : ''}
  </li>`;
}
function dateBlock(d) {
  const x = new Date(d + 'T00:00:00');
  return html`<div class="date-block"><div><b>${x.getDate()}</b><span>${x.toLocaleDateString('en-PH', { month: 'short' })}</span></div></div>`;
}
function eventItem(e, { manage = false, compact = false } = {}) {
  const past = e.date < todayStr();
  const full = e.registered >= e.capacity;
  return html`<li class="item event ${past ? 'past' : ''}">
    ${dateBlock(e.date)}
    <div class="body">
      <div class="meta"><span class="tag t-general">${e.type}</span><span>${e.time}</span><span>${e.venue}</span></div>
      <h3>${e.title}</h3>
      ${compact ? '' : html`<p>${e.description}</p>`}
      <div class="meta"><span>${e.registered} of ${e.capacity} registered</span>${e.needsVolunteers ? html`<span>${e.volunteers} volunteers signed up</span>` : ''}${past ? pill('Closed') : full ? pill('Full') : ''}</div>
      ${compact ? '' : eventActions(e, past, full, manage)}
    </div>
  </li>`;
}
function eventActions(e, past, full, manage) {
  const mine = e.myRegistration;
  return html`<div class="row">
    ${!past && !mine && !full ? html`<button class="primary small" data-act="ev-join" data-id="${e.id}" data-role="Participant">Join as participant</button>` : ''}
    ${!past && !mine && !full && e.needsVolunteers ? html`<button class="small" data-act="ev-join" data-id="${e.id}" data-role="Volunteer">Sign up as volunteer</button>` : ''}
    ${mine ? html`<span class="pill s-resolved">You are registered as ${mine.role.toLowerCase()}</span><button class="small" data-act="ev-leave" data-id="${e.id}">Cancel registration</button>` : ''}
    ${manage ? html`<button class="small" data-act="ev-regs" data-id="${e.id}">View registrations</button><button class="small danger" data-act="ev-del" data-id="${e.id}">Delete</button>` : ''}
  </div>`;
}

/* =========================================================
   Views
   ========================================================= */
async function home() {
  const d = await api('/overview');
  const b = d.barangay;
  const urgent = d.announcements.find((a) => a.urgent);
  mount(html`
    ${urgent ? html`<a class="advisory-bar" href="#/announcements"><strong>Advisory</strong><span>${urgent.title}</span></a>` : ''}
    <section class="wrap hero">
      <div>
        <p class="place">${b.name}, ${b.place}</p>
        <h1>Everything happening in the barangay, in one place.</h1>
        <p class="lead">CommuNect connects community information, resident participation, problem resolution, and data-driven decision-making in one platform.</p>
        <div class="row"><a class="btn primary" href="#/concerns">Report a concern</a><a class="btn" href="#/announcements">Read announcements</a></div>
      </div>
      <aside class="glance" aria-label="Barangay overview">
        <h2>Barangay overview</h2>
        <p class="dim">${b.about}</p>
        <dl>
          <dt>Barangay Captain</dt><dd>${b.captain}</dd>
          <dt>Hall hours</dt><dd>${b.hallHours}</dd>
          <dt>Hotlines</dt>
          <dd><ul class="hotlines">${b.hotlines.map((h) => html`<li><span>${h.label}</span><b>${h.number}</b></li>`)}</ul></dd>
        </dl>
      </aside>
    </section>
    <div class="facts">
      <span><b>${d.stats.resolvedConcerns}</b>concerns resolved</span>
      <span><b>${d.stats.upcomingEvents}</b>upcoming events</span>
      <span><b>${d.stats.openPrograms}</b>programs accepting applications</span>
    </div>
    <section class="wrap grid-2">
      <div>
        <div class="page-head"><h2>Latest announcements</h2><a href="#/announcements">See all</a></div>
        <ul class="items">${d.announcements.length ? d.announcements.map((a) => annItem(a, false)) : empty('No announcements yet.')}</ul>
      </div>
      <div>
        <div class="page-head"><h2>Upcoming events</h2><a href="#/events">See all</a></div>
        <ul class="items">${d.events.length ? d.events.map((e) => eventItem(e, { compact: true })) : empty('No upcoming events.')}</ul>
        <div class="panel" style="margin-top:2rem">
          <h3>Need something fixed?</h3>
          <p>Report a problem in your area and follow every update from the barangay until it is resolved.</p>
          <a class="btn primary" href="#/concerns">Submit a concern</a>
        </div>
      </div>
    </section>`);
}

async function announcements() {
  const q = ui.annCat ? '?category=' + encodeURIComponent(ui.annCat) : '';
  const list = await api('/announcements' + q);
  mount(html`<section class="wrap">
    <div class="page-head">
      <div><h1>Announcements</h1><p class="lead">Verified notices from the barangay office: schedules, interruptions, and emergency advisories.</p></div>
      ${isOfficial() ? html`<button class="primary" data-act="ann-new">Post announcement</button>` : ''}
    </div>
    <div class="chips" role="group" aria-label="Filter by category">
      ${['', ...state.meta.announcementCategories].map((c) => html`<button data-act="ann-filter" data-v="${c}" aria-pressed="${String(ui.annCat === c)}">${c || 'All'}</button>`)}
    </div>
    <ul class="items">${list.length ? list.map((a) => annItem(a, isOfficial())) : empty('No announcements in this category.')}</ul>
  </section>`);
  window._ann = list;
}

function annForm(existing) {
  const m = state.meta;
  openForm({
    title: existing ? 'Edit announcement' : 'Post announcement',
    submitLabel: existing ? 'Save changes' : 'Post announcement',
    fields: [
      { name: 'title', label: 'Title', value: existing?.title },
      { name: 'category', label: 'Category', type: 'select', options: m.announcementCategories, value: existing?.category },
      { name: 'body', label: 'Details', type: 'textarea', value: existing?.body, hint: 'Include times, affected areas, and what residents should do.' },
      { name: 'effectiveDate', label: 'Effective date', type: 'date', required: false, value: existing?.effectiveDate, hint: 'Optional. Use for schedules and interruptions.' },
      { name: 'urgent', label: 'Mark as urgent and notify all residents', type: 'checkbox', value: existing?.urgent }
    ],
    onSubmit: async (data) => {
      await api(existing ? '/announcements/' + existing.id : '/announcements', { method: existing ? 'PUT' : 'POST', body: data });
      toast(existing ? 'Changes saved.' : 'Announcement posted.'); refresh();
    }
  });
}

async function concerns() {
  const m = state.meta;
  if (!state.user) {
    mount(html`<section class="wrap">
      <h1>Community concerns</h1>
      <p class="lead">Report a problem in your area and follow it until it is resolved.</p>
      <ol class="steps"><li><b>Submit</b><br><span class="dim">Describe the problem and where it is.</span></li><li><b>Reviewed</b><br><span class="dim">Barangay officials receive and check it.</span></li><li><b>In progress</b><br><span class="dim">A team is assigned. You get updates.</span></li><li><b>Resolved</b><br><span class="dim">Rate how it was handled.</span></li></ol>
      ${loginPrompt('submit a concern and track its status')}
    </section>`);
    return;
  }
  const q = new URLSearchParams();
  if (isOfficial()) { if (ui.concernStatus) q.set('status', ui.concernStatus); if (ui.concernCat) q.set('category', ui.concernCat); }
  const list = await api('/concerns' + (q.toString() ? '?' + q : ''));
  window._concerns = list;

  const timeline = (c) => html`<ol class="timeline">${c.updates.map((u) => html`<li class="s-${slug(u.status).replace(/^./, (x) => x.toUpperCase())}"><b>${u.status}</b> <span class="dim">${fmtDateTime(u.at)} by ${u.by}</span><p>${u.message}</p></li>`)}</ol>`;

  if (isOfficial()) {
    mount(html`<section class="wrap">
      <div class="page-head"><div><h1>Manage concerns</h1><p class="lead">Review reports, post updates, and close them out. Residents are notified of every change.</p></div></div>
      <div class="row" style="margin-bottom:1.5rem">
        <div class="field" style="margin:0"><label for="fs">Status</label><select id="fs" data-act="c-filter" data-k="concernStatus"><option value="">All statuses</option>${m.concernStatuses.map((s) => html`<option ${raw(ui.concernStatus === s ? 'selected' : '')}>${s}</option>`)}</select></div>
        <div class="field" style="margin:0"><label for="fc">Category</label><select id="fc" data-act="c-filter" data-k="concernCat"><option value="">All categories</option>${m.concernCategories.map((s) => html`<option ${raw(ui.concernCat === s ? 'selected' : '')}>${s}</option>`)}</select></div>
      </div>
      <ul class="items">${list.length ? list.map((c) => html`<li class="item">
        <div class="meta">${pill(c.status)}<span>${c.category}</span><span>${c.location}</span><span>${fmtDate(c.createdAt)} by ${c.residentName}</span></div>
        <h3>${c.title}</h3><p>${c.description}</p>
        <div class="row"><button class="primary small" data-act="c-update" data-id="${c.id}">Post update</button></div>
        <details class="concern"><summary>Progress history (${c.updates.length})</summary>${timeline(c)}</details>
      </li>`) : empty('No concerns match these filters.')}</ul>
    </section>`);
    return;
  }

  mount(html`<section class="wrap grid-form">
    <div>
      <h1>Submit a concern</h1>
      <p class="dim">Be specific about the location so the team can find it quickly.</p>
      <form id="concernForm" class="panel">
        <div class="form-error" hidden></div>
        <div class="field"><label for="ct">What is the problem?</label><input id="ct" name="title" required minlength="3" maxlength="120" placeholder="Example: Clogged drainage near the corner"></div>
        <div class="field"><label for="cc">Category</label><select id="cc" name="category">${m.concernCategories.map((c) => html`<option>${c}</option>`)}</select></div>
        <div class="field"><label for="cl">Where is it?</label><input id="cl" name="location" required minlength="2" maxlength="120" placeholder="Purok, street, or landmark"></div>
        <div class="field"><label for="cd">Details</label><textarea id="cd" name="description" required minlength="10" maxlength="2000" placeholder="What happened, how long it has been like this, who is affected"></textarea></div>
        <button class="primary" type="submit">Submit concern</button>
      </form>
    </div>
    <div>
      <h2>My reports</h2>
      <ul class="items">${list.length ? list.map((c) => html`<li class="item">
        <div class="meta">${pill(c.status)}<span>${c.category}</span><span>${c.location}</span><span>Submitted ${fmtDate(c.createdAt)}</span></div>
        <h3>${c.title}</h3>
        <details class="concern" ${raw(c.status !== 'Resolved' ? 'open' : '')}><summary>Updates from the barangay</summary>${timeline(c)}</details>
        ${c.status === 'Resolved' && !c.rated ? html`<button class="small" data-act="c-rate" data-id="${c.id}">Rate how this was handled</button>` : ''}
      </li>`) : empty('You have not submitted any concerns yet. Your reports will show up here with live status updates.')}</ul>
    </div>
  </section>`);
}

async function events() {
  const list = await api('/events');
  const up = list.filter((e) => e.date >= todayStr()), past = list.filter((e) => e.date < todayStr()).reverse();
  mount(html`<section class="wrap">
    <div class="page-head">
      <div><h1>Events and activities</h1><p class="lead">Meetings, sports, clean-up drives, and community programs. Join as a participant or volunteer.</p></div>
      ${isOfficial() ? html`<button class="primary" data-act="ev-new">Add event</button>` : ''}
    </div>
    ${!state.user ? html`<div style="margin-bottom:1.5rem">${loginPrompt('register for events')}</div>` : ''}
    <h2>Upcoming</h2>
    <ul class="items">${up.length ? up.map((e) => eventItem(e, { manage: isOfficial() })) : empty('No upcoming events scheduled.')}</ul>
    ${past.length ? html`<h2 style="margin-top:3rem">Past events</h2><ul class="items">${past.map((e) => eventItem(e, { manage: isOfficial() }))}</ul>` : ''}
  </section>`);
}

async function assistance() {
  const q = ui.assistType ? '?type=' + encodeURIComponent(ui.assistType) : '';
  const list = await api('/assistance' + q);
  mount(html`<section class="wrap">
    <div class="page-head">
      <div><h1>Assistance and opportunities</h1><p class="lead">Scholarships, financial aid, livelihood training, and feeding programs, with requirements and deadlines.</p></div>
      ${isOfficial() ? html`<button class="primary" data-act="as-new">Add program</button>` : ''}
    </div>
    <div class="chips" role="group" aria-label="Filter by program type">
      ${['', ...state.meta.assistanceTypes].map((c) => html`<button data-act="as-filter" data-v="${c}" aria-pressed="${String(ui.assistType === c)}">${c || 'All'}</button>`)}
    </div>
    <ul class="items">${list.length ? list.map((a) => {
      const left = daysUntil(a.deadline);
      return html`<li class="item">
        <div class="meta"><span class="tag t-general">${a.type}</span>${left < 0 ? pill('Closed') : html`<span><b style="color:var(--ink)">Deadline ${fmtDate(a.deadline)}</b>${left <= 7 ? ` (${left === 0 ? 'today' : left + ' day' + (left > 1 ? 's' : '') + ' left'})` : ''}</span>`}</div>
        <h3>${a.title}</h3><p>${a.description}</p>
        <b>Eligibility</b><ul class="ticks">${a.eligibility.map((x) => html`<li>${x}</li>`)}</ul>
        <p><b>How to apply:</b> ${a.howToApply}</p>
        ${isOfficial() ? html`<button class="small danger" data-act="as-del" data-id="${a.id}">Remove program</button>` : ''}
      </li>`;
    }) : empty('No programs in this category right now.')}</ul>
  </section>`);
}

async function lostfound() {
  const q = ui.lfKind ? '?kind=' + ui.lfKind : '';
  const list = await api('/lostfound' + q);
  mount(html`<section class="wrap">
    <div class="page-head">
      <div><h1>Lost and found</h1><p class="lead">Report a lost or found item. Contact the listed person to arrange a safe return, preferably at the barangay hall.</p></div>
      ${state.user ? html`<button class="primary" data-act="lf-new">Report an item</button>` : ''}
    </div>
    ${!state.user ? html`<div style="margin-bottom:1.5rem">${loginPrompt('post an item or see contact details')}</div>` : ''}
    <div class="seg" role="group" aria-label="Filter">
      ${[['', 'All'], ['lost', 'Lost'], ['found', 'Found']].map(([v, l]) => html`<button data-act="lf-filter" data-v="${v}" aria-pressed="${String(ui.lfKind === v)}">${l}</button>`)}
    </div>
    <ul class="items">${list.length ? list.map((i) => html`<li class="item">
      <div class="meta">${pill(i.kind === 'lost' ? 'Lost' : 'Found')}${i.status === 'returned' ? pill('Returned') : ''}<span>${i.location}</span><span>${fmtDate(i.date)}</span></div>
      <h3>${i.item}</h3><p>${i.description}</p>
      ${i.contactPerson ? html`<p><b>Contact:</b> ${i.contactPerson}, ${i.contactNumber}</p>` : html`<p class="dim">Log in to see who to contact.</p>`}
      ${i.canManage ? html`<div class="row">${i.status === 'open' ? html`<button class="small" data-act="lf-return" data-id="${i.id}">Mark as returned</button>` : ''}<button class="small danger" data-act="lf-del" data-id="${i.id}">Remove</button></div>` : ''}
    </li>`) : empty('No items listed.')}</ul>
  </section>`);
}

async function feedback() {
  if (!state.user) {
    mount(html`<section class="wrap"><h1>Feedback and suggestions</h1><p class="lead">Rate barangay services and share ideas that would improve them.</p>${loginPrompt('send feedback')}</section>`); return;
  }
  const mine = isResident() ? await api('/feedback/mine') : [];
  const m = state.meta;
  mount(html`<section class="wrap grid-form">
    <div>
      <h1>Feedback and suggestions</h1>
      <div class="seg" role="group" aria-label="Type of feedback">
        <button data-act="fb-mode" data-v="service" aria-pressed="${String(ui.fbMode === 'service')}">Rate a service</button>
        <button data-act="fb-mode" data-v="suggestion" aria-pressed="${String(ui.fbMode === 'suggestion')}">Send a suggestion</button>
      </div>
      <form id="fbForm" class="panel">
        <div class="form-error" hidden></div>
        <div class="field"><label for="fsv">Which service?</label><select id="fsv" name="service">${m.feedbackServices.map((s) => html`<option>${s}</option>`)}</select></div>
        ${ui.fbMode === 'service' ? html`<div class="field"><label>Your rating</label><div class="rate" role="radiogroup" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" name="rating" id="rt${n}" value="${n}" ${raw(n === 1 ? 'required' : '')}><label for="rt${n}" title="${n} out of 5">★</label>`)}</div></div>` : ''}
        <div class="field"><label for="fm">${ui.fbMode === 'service' ? 'Comments (optional)' : 'Your suggestion'}</label><textarea id="fm" name="message" ${raw(ui.fbMode === 'suggestion' ? 'required minlength="10"' : '')} maxlength="1000" placeholder="${ui.fbMode === 'service' ? 'What went well, and what could be better?' : 'What should the barangay start, stop, or improve?'}"></textarea></div>
        <button class="primary" type="submit">${ui.fbMode === 'service' ? 'Send rating' : 'Send suggestion'}</button>
      </form>
    </div>
    <div>
      <h2>${isResident() ? 'Your submissions' : 'Resident feedback'}</h2>
      ${isResident()
        ? html`<ul class="items">${mine.length ? mine.map((f) => html`<li class="item"><div class="meta"><span>${f.type === 'service' ? 'Service rating' : 'Suggestion'}</span><span>${f.service}</span><span>${fmtDate(f.createdAt)}</span></div>${f.rating ? html`<div class="stars" aria-label="${f.rating} out of 5">${stars(f.rating)}</div>` : ''}${f.message ? html`<p>${f.message}</p>` : ''}</li>`) : empty('Nothing sent yet. Your ratings and suggestions will be listed here.')}</ul>`
        : html`<p>Officials can review all resident feedback in the <a href="#/dashboard/analytics">analytics dashboard</a>.</p>`}
    </div>
  </section>`);
}

/* ---------- login / register ---------- */
function loginView() {
  const reg = ui.loginMode === 'register';
  mount(html`<section class="wrap" style="max-width:560px">
    <h1>${reg ? 'Create a resident account' : 'Log in'}</h1>
    <div class="seg" role="group" aria-label="Account"><button data-act="login-mode" data-v="login" aria-pressed="${String(!reg)}">Log in</button><button data-act="login-mode" data-v="register" aria-pressed="${String(reg)}">Create account</button></div>
    <form id="authForm" class="panel">
      <div class="form-error" hidden></div>
      ${reg ? html`<div class="field"><label for="an">Full name</label><input id="an" name="name" required autocomplete="name"></div>` : ''}
      <div class="field"><label for="ae">Email</label><input id="ae" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="ap">Password</label><input id="ap" name="password" type="password" required ${raw(reg ? 'minlength="8"' : '')} autocomplete="${reg ? 'new-password' : 'current-password'}">${reg ? html`<div class="hint">At least 8 characters.</div>` : ''}</div>
      ${reg ? html`<div class="field"><label for="aa">Purok or address</label><input id="aa" name="address" required autocomplete="street-address"></div>` : ''}
      <button class="primary" type="submit">${reg ? 'Create account' : 'Log in'}</button>
    </form>
    ${reg ? '' : html`<p class="dim" style="margin-top:1rem">Demo accounts: <b>resident@communect.ph</b> / resident123 &nbsp;|&nbsp; <b>official@communect.ph</b> / official123</p>`}
  </section>`);
}

async function notifications() {
  if (!state.user) { location.hash = '#/login'; return; }
  const list = await api('/notifications');
  await api('/notifications/read', { method: 'POST' }); state.unread = 0; renderAccount();
  mount(html`<section class="wrap" style="max-width:760px"><h1>Notifications</h1>
    <ul class="items">${list.length ? list.map((n) => html`<li class="item"><div class="meta"><span>${fmtDateTime(n.createdAt)}</span></div><p>${n.link ? html`<a href="${n.link}">${n.text}</a>` : n.text}</p></li>`) : empty('No notifications yet. Updates on your concerns and new advisories will appear here.')}</ul></section>`);
}

/* ---------- officials dashboard ---------- */
async function dashboard(parts) {
  if (!isOfficial()) {
    mount(html`<section class="wrap"><h1>Officials dashboard</h1><div class="notice">This area is for barangay officials. <a href="#/login">Log in with an official account</a>.</div></section>`); return;
  }
  const tab = parts[0] === 'analytics' ? 'analytics' : 'overview';
  const head = html`<div class="page-head"><div><h1>Officials dashboard</h1></div></div>
    <nav class="tabs" aria-label="Dashboard sections"><a href="#/dashboard" ${raw(tab === 'overview' ? 'aria-current="page"' : '')}>Overview</a><a href="#/dashboard/analytics" ${raw(tab === 'analytics' ? 'aria-current="page"' : '')}>Analytics and reports</a></nav>`;
  if (tab === 'overview') {
    const d = await api('/dashboard/overview');
    const t = d.totals;
    mount(html`<section class="wrap">${head}
      <div class="cards">
        <div class="card c-total"><b>${t.totalReports}</b><span>Total reports</span></div>
        <div class="card c-pending"><b>${t.pending}</b><span>Pending concerns</span></div>
        <div class="card c-resolved"><b>${t.resolved}</b><span>Resolved concerns</span></div>
        <div class="card c-upcoming"><b>${t.upcomingActivities}</b><span>Upcoming activities</span></div>
      </div>
      <div class="grid-2">
        <div><div class="page-head"><h2>Waiting for action</h2><a href="#/concerns">Manage all concerns</a></div>
          <ul class="items">${d.pendingConcerns.length ? d.pendingConcerns.map((c) => html`<li class="item"><div class="meta"><span>${c.category}</span><span>${c.location}</span><span>${fmtDate(c.createdAt)}</span></div><h3>${c.title}</h3><button class="primary small" data-act="c-update" data-id="${c.id}">Post update</button></li>`) : empty('No pending concerns. Everything has been picked up.')}</ul></div>
        <div><div class="page-head"><h2>Upcoming activities</h2><a href="#/events">Manage events</a></div>
          <ul class="items">${d.upcomingEvents.length ? d.upcomingEvents.map((e) => eventItem(e, { compact: true })) : empty('No activities scheduled.')}</ul></div>
      </div>
    </section>`);
    window._concerns = d.pendingConcerns;
    return;
  }

  const a = await api('/dashboard/analytics');
  const maxCat = Math.max(1, ...a.byCategory.map((x) => x.total));
  const maxArea = Math.max(1, ...a.byArea.map((x) => x.total));
  const heatMax = Math.max(1, ...a.categoryByMonth.flatMap((r) => r.counts));
  const maxDist = Math.max(1, ...a.feedback.distribution.map((x) => x.count));
  const bar = (label, val, max, color, shown) => html`<div class="bar-row"><span>${label}</span><div class="track"><div class="fill" style="width:${(val / max) * 100}%;--c:${color}"></div></div><b>${shown ?? val}</b></div>`;

  mount(html`<section class="wrap">${head}
    <div class="section"><h2>Resolution performance</h2>
      <div class="kpis">
        <div class="kpi"><div class="ring" style="--p:${a.resolution.rate.toFixed(0)}"><b>${a.resolution.rate.toFixed(0)}%</b></div><div><b>Resolution rate</b><span>${a.resolution.resolved} of ${a.resolution.total} concerns resolved</span></div></div>
        <div class="kpi"><div><b>${hoursLabel(a.resolution.averageHours)}</b><span>Average time to resolve</span></div></div>
        <div class="kpi"><div><b>${a.feedback.average ? a.feedback.average.toFixed(1) + ' / 5' : 'n/a'}</b><span>Average service rating (${a.feedback.ratedCount} ratings)</span></div></div>
      </div>
      <div class="scroll-x"><table><thead><tr><th>Category</th><th>Average time to resolve</th></tr></thead><tbody>${a.resolution.byCategory.map((r) => html`<tr><td>${r.category}</td><td>${hoursLabel(r.hours)}</td></tr>`)}</tbody></table></div>
    </div>

    <div class="section"><h2>Common concerns by category and month</h2>
      <div class="grid-2">
        <div class="bars">${a.byCategory.map((c) => bar(c.category, c.total, maxCat, 'var(--sky)'))}</div>
        <div class="scroll-x"><table><thead><tr><th>Category</th>${a.months.map((m) => html`<th class="num">${monthLabel(m)}</th>`)}</tr></thead><tbody>
          ${a.categoryByMonth.map((r) => html`<tr><td>${r.category}</td>${r.counts.map((n) => html`<td class="num heat" style="background:rgba(240,195,109,${n ? 0.15 + (n / heatMax) * 0.6 : 0})">${n || ''}</td>`)}</tr>`)}
          <tr><th>All reports</th>${a.perMonth.map((n) => html`<th class="num">${n}</th>`)}</tr>
        </tbody></table></div>
      </div>
    </div>

    <div class="section"><h2>Areas with recurring problems</h2>
      <div class="grid-2">
        <div><p class="dim">Same type of problem reported three or more times in the same area.</p>
          ${a.recurring.length ? html`<div class="scroll-x"><table><thead><tr><th>Area</th><th>Problem</th><th class="num">Reports</th><th class="num">Still open</th></tr></thead><tbody>${a.recurring.map((r) => html`<tr><td>${r.location}</td><td>${r.category}</td><td class="num">${r.count}</td><td class="num">${r.open}</td></tr>`)}</tbody></table></div>` : empty('No recurring problems detected yet.')}</div>
        <div><p class="dim">All reports by area.</p><div class="bars">${a.byArea.map((x) => bar(x.location, x.total, maxArea, 'var(--coral)'))}</div></div>
      </div>
    </div>

    <div class="section"><h2>Resident feedback summary</h2>
      <div class="grid-2">
        <div>
          <h3>Rating distribution</h3>
          <div class="bars">${a.feedback.distribution.map((d) => bar(stars(d.rating), d.count, maxDist, 'var(--sand)'))}</div>
          <h3 style="margin-top:1.5rem">Average by service</h3>
          ${a.feedback.byService.length ? html`<table><tbody>${a.feedback.byService.map((s) => html`<tr><td>${s.service}</td><td class="num">${s.average.toFixed(1)} / 5</td><td class="num dim">${s.count} rating${s.count > 1 ? 's' : ''}</td></tr>`)}</tbody></table>` : empty('No ratings yet.')}
        </div>
        <div>
          <h3>Recent comments and suggestions</h3>
          <ul class="items">${a.feedback.recentComments.length ? a.feedback.recentComments.map((f) => html`<li class="item"><div class="meta"><span>${f.type === 'service' ? 'Rating' : 'Suggestion'}</span><span>${f.service}</span><span>${f.name}, ${fmtDate(f.createdAt)}</span></div>${f.rating ? html`<div class="stars">${stars(f.rating)}</div>` : ''}<p>${f.message}</p></li>`) : empty('No comments yet.')}</ul>
        </div>
      </div>
    </div>

    <div class="section"><h2>Event participation</h2>
      <div class="kpis">
        <div class="kpi"><div><b>${a.events.totalRegistrations}</b><span>Total registrations</span></div></div>
        <div class="kpi"><div><b>${a.events.totalVolunteers}</b><span>Volunteer sign-ups</span></div></div>
        <div class="kpi"><div><b>${a.events.attendanceRate == null ? 'n/a' : a.events.attendanceRate.toFixed(0) + '%'}</b><span>Attendance rate, past events</span></div></div>
      </div>
      <div class="scroll-x"><table><thead><tr><th>Event</th><th>Date</th><th class="num">Registered</th><th class="num">Volunteers</th><th class="num">Attended</th><th>Capacity used</th></tr></thead><tbody>
        ${a.events.stats.map((e) => html`<tr><td>${e.title}<br><span class="dim">${e.type}</span></td><td>${fmtDate(e.date)}</td><td class="num">${e.registered}</td><td class="num">${e.volunteers}</td><td class="num">${e.isPast ? e.attended : 'n/a'}</td><td style="min-width:8rem"><div class="track"><div class="fill" style="width:${Math.min(100, (e.registered / e.capacity) * 100)}%;--c:var(--leaf)"></div></div><span class="dim">${e.registered} of ${e.capacity}</span></td></tr>`)}
      </tbody></table></div>
    </div>
  </section>`);
}

const notFound = () => mount(html`<section class="wrap"><h1>Page not found</h1><p><a href="#/home">Go to the home page</a></p></section>`);

/* =========================================================
   Router
   ========================================================= */
const routes = { '': home, home, announcements, concerns, events, assistance, lostfound, feedback, dashboard, login: loginView, notifications };
async function route(keepScroll = false) {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0];
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === name || (name === '' && a.dataset.nav === 'home') ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#nav').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  const y = window.scrollY;
  if (!keepScroll) mount(html`<p class="loading">Loading…</p>`);
  try { await (routes[name] || notFound)(parts.slice(1)); }
  catch (e) { mount(html`<section class="wrap"><div class="notice error">${e.message}</div></section>`); }
  if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
}
const refresh = () => route(true);

/* =========================================================
   Account bar
   ========================================================= */
function renderAccount() {
  const el = $('#account');
  $('#navDash').hidden = !isOfficial();
  if (!state.user) { el.innerHTML = html`<a class="btn small primary" href="#/login">Log in</a>`.s; return; }
  el.innerHTML = html`<a class="bell" href="#/notifications" aria-label="Notifications${state.unread ? ', ' + state.unread + ' unread' : ''}">Alerts${state.unread ? html`<span class="count">${state.unread}</span>` : ''}</a>
    <span class="who"><strong>${state.user.name}</strong>${isOfficial() ? ' (official)' : ''}</span>
    <button class="small" data-act="logout">Log out</button>`.s;
}
async function loadUser() {
  if (!localStorage.getItem(TOKEN_KEY)) { state.user = null; renderAccount(); return; }
  try { const r = await api('/auth/me'); state.user = r.user; state.unread = r.unread; } catch { state.user = null; }
  renderAccount();
}

/* =========================================================
   Actions (event delegation)
   ========================================================= */
const byId = (list, id) => (list || []).find((x) => x.id === id);

const actions = {
  logout() { localStorage.removeItem(TOKEN_KEY); state.user = null; state.unread = 0; renderAccount(); toast('You are logged out.'); location.hash = '#/home'; route(); },
  'login-mode'(d) { ui.loginMode = d.v; loginView(); },

  'ann-filter'(d) { ui.annCat = d.v; refresh(); },
  'ann-new'() { annForm(); },
  'ann-edit'(d) { annForm(byId(window._ann, d.id)); },
  async 'ann-del'(d) { if (confirmBox('Delete this announcement?')) { await api('/announcements/' + d.id, { method: 'DELETE' }); toast('Announcement deleted.'); refresh(); } },

  'c-update'(d) {
    const c = byId(window._concerns, d.id); if (!c) return;
    openForm({
      title: 'Post an update', intro: `${c.title} (${c.location})`, submitLabel: 'Post update',
      fields: [
        { name: 'status', label: 'Status', type: 'select', options: state.meta.concernStatuses, value: c.status === 'Pending' ? 'In Progress' : c.status },
        { name: 'message', label: 'Update for the resident', type: 'textarea', placeholder: 'What has been done or what happens next' }
      ],
      onSubmit: async (data) => { await api('/concerns/' + c.id, { method: 'PATCH', body: data }); toast('Update posted. The resident has been notified.'); refresh(); }
    });
  },
  'c-rate'(d) {
    openForm({
      title: 'Rate how this was handled', submitLabel: 'Send rating',
      fields: [{ name: 'rating', label: 'Your rating', type: 'rating' }, { name: 'message', label: 'Comments (optional)', type: 'textarea', required: false }],
      onSubmit: async (data) => { await api(`/concerns/${d.id}/rate`, { method: 'POST', body: data }); toast('Thank you for your feedback.'); refresh(); }
    });
  },

  async 'ev-join'(d) {
    if (!state.user) { location.hash = '#/login'; return; }
    await api(`/events/${d.id}/register`, { method: 'POST', body: { role: d.role } });
    toast(d.role === 'Volunteer' ? 'You signed up as a volunteer.' : 'You are registered.'); refresh();
  },
  async 'ev-leave'(d) { await api(`/events/${d.id}/register`, { method: 'DELETE' }); toast('Registration canceled.'); refresh(); },
  async 'ev-del'(d) { if (confirmBox('Delete this event and its registrations?')) { await api('/events/' + d.id, { method: 'DELETE' }); toast('Event deleted.'); refresh(); } },
  'ev-new'() {
    openForm({
      title: 'Add event', submitLabel: 'Add event',
      fields: [
        { name: 'title', label: 'Event name' },
        { name: 'type', label: 'Type', type: 'select', options: state.meta.eventTypes },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'time', label: 'Time', placeholder: 'Example: 2:00 PM' },
        { name: 'venue', label: 'Venue' },
        { name: 'capacity', label: 'Capacity', type: 'number', value: 100 },
        { name: 'description', label: 'Details', type: 'textarea' },
        { name: 'needsVolunteers', label: 'Accept volunteer registrations', type: 'checkbox' }
      ],
      onSubmit: async (data) => { await api('/events', { method: 'POST', body: data }); toast('Event added. Residents were notified.'); refresh(); }
    });
  },
  async 'ev-regs'(d) {
    const regs = await api(`/events/${d.id}/registrations`);
    const dlg = document.createElement('dialog');
    dlg.innerHTML = html`<h2>Registrations</h2>${regs.length ? html`<table><thead><tr><th>Name</th><th>Role</th><th class="num">Attended</th></tr></thead><tbody>${regs.map((r) => html`<tr><td>${r.name}${r.contact ? html`<br><span class="dim">${r.contact}</span>` : ''}</td><td>${r.role}</td><td class="num"><input type="checkbox" style="width:auto" data-rid="${r.id}" ${raw(r.attended ? 'checked' : '')} aria-label="Attended: ${r.name}"></td></tr>`)}</tbody></table>` : empty('No one has registered yet.')}<div class="dialog-actions"><button class="primary" data-close>Done</button></div>`.s;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); refresh(); });
    $('[data-close]', dlg).onclick = () => dlg.close();
    dlg.addEventListener('change', guard(async (e) => { const rid = e.target.dataset.rid; if (rid) await api(`/events/${d.id}/registrations/${rid}`, { method: 'PATCH', body: { attended: e.target.checked } }); }));
    dlg.showModal();
  },

  'as-filter'(d) { ui.assistType = d.v; refresh(); },
  'as-new'() {
    openForm({
      title: 'Add assistance program', submitLabel: 'Add program',
      fields: [
        { name: 'title', label: 'Program name' },
        { name: 'type', label: 'Type', type: 'select', options: state.meta.assistanceTypes },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'eligibility', label: 'Eligibility requirements', type: 'textarea', hint: 'One requirement per line.' },
        { name: 'deadline', label: 'Application deadline', type: 'date' },
        { name: 'howToApply', label: 'How to apply' }
      ],
      onSubmit: async (data) => { await api('/assistance', { method: 'POST', body: data }); toast('Program added. Residents were notified.'); refresh(); }
    });
  },
  async 'as-del'(d) { if (confirmBox('Remove this program?')) { await api('/assistance/' + d.id, { method: 'DELETE' }); toast('Program removed.'); refresh(); } },

  'lf-filter'(d) { ui.lfKind = d.v; refresh(); },
  'lf-new'() {
    openForm({
      title: 'Report a lost or found item', submitLabel: 'Post item',
      fields: [
        { name: 'kind', label: 'Is it lost or found?', type: 'select', options: ['lost', 'found'] },
        { name: 'item', label: 'Item', placeholder: 'Example: Black umbrella' },
        { name: 'description', label: 'Description', type: 'textarea', hint: 'Do not post details only the owner would know. Ask them to describe it when they contact you.' },
        { name: 'location', label: 'Where was it lost or found?' },
        { name: 'date', label: 'Date', type: 'date', value: todayStr() },
        { name: 'contactPerson', label: 'Contact person', value: state.user?.name },
        { name: 'contactNumber', label: 'Contact number', type: 'tel' }
      ],
      onSubmit: async (data) => { await api('/lostfound', { method: 'POST', body: data }); toast('Item posted.'); refresh(); }
    });
  },
  async 'lf-return'(d) { await api('/lostfound/' + d.id, { method: 'PATCH', body: { status: 'returned' } }); toast('Marked as returned.'); refresh(); },
  async 'lf-del'(d) { if (confirmBox('Remove this item?')) { await api('/lostfound/' + d.id, { method: 'DELETE' }); toast('Item removed.'); refresh(); } },

  'fb-mode'(d) { ui.fbMode = d.v; feedback(); }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.act];
  if (fn) guard(fn)(el.dataset, el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset?.act === 'c-filter') { ui[el.dataset.k] = el.value; refresh(); }
});

document.addEventListener('submit', guard(async (e) => {
  const form = e.target;
  const err = $('.form-error', form);
  const fail = (m) => { if (err) { err.textContent = m; err.hidden = false; } else toast(m, true); };
  if (err) err.hidden = true;
  const data = Object.fromEntries(new FormData(form));

  if (form.id === 'authForm') {
    e.preventDefault();
    try {
      const r = await api(ui.loginMode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: data });
      localStorage.setItem(TOKEN_KEY, r.token); state.user = r.user;
      await loadUser(); toast(`Welcome, ${r.user.name}.`);
      location.hash = isOfficial() ? '#/dashboard' : '#/home';
    } catch (ex) { fail(ex.message); }
  } else if (form.id === 'concernForm') {
    e.preventDefault();
    try { await api('/concerns', { method: 'POST', body: data }); toast('Concern submitted. You can track it under My reports.'); refresh(); } catch (ex) { fail(ex.message); }
  } else if (form.id === 'fbForm') {
    e.preventDefault();
    try { await api('/feedback', { method: 'POST', body: { ...data, type: ui.fbMode } }); toast(ui.fbMode === 'service' ? 'Thank you for rating this service.' : 'Thank you for your suggestion.'); refresh(); } catch (ex) { fail(ex.message); }
  }
}));

$('#menuBtn').addEventListener('click', () => {
  const nav = $('#nav'); const open = nav.classList.toggle('open');
  $('#menuBtn').setAttribute('aria-expanded', String(open));
});
window.addEventListener('hashchange', () => route());
setInterval(() => { if (state.user) api('/auth/me').then((r) => { state.unread = r.unread; renderAccount(); }).catch(() => {}); }, 60000);

(async function init() {
  state.meta = await api('/meta');
  await loadUser();
  route();
})().catch((e) => mount(html`<section class="wrap"><div class="notice error">Could not reach the server. ${e.message}</div></section>`));
})();
