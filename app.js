(() => {
  'use strict';

  const CATS = {
    web:         { title: 'پروژه‌های وب',          prefix: 'WP', label: 'وب' },
    programming: { title: 'پروژه‌های برنامه‌نویسی', prefix: 'PG', label: 'برنامه‌نویسی' },
    logo:        { title: 'پروژه‌های لوگو و طراحی', prefix: 'LG', label: 'لوگو و طراحی' }
  };
  const KINDS = {
    wp:          { category: 'web',         prefix: 'WP', label: 'وب (وردپرس)' },
    html:        { category: 'web',         prefix: 'HT', label: 'وب (کدنویسی HTML)' },
    programming: { category: 'programming', prefix: 'PG', label: 'برنامه‌نویسی' },
    logo:        { category: 'logo',        prefix: 'LG', label: 'لوگو و طراحی' }
  };
  const kindOf = p => Object.keys(KINDS).find(k => (p.code || '').startsWith(KINDS[k].prefix + '-'))
    || Object.keys(KINDS).find(k => KINDS[k].category === p.category);
  const kindLabel = p => (KINDS[kindOf(p)] || CATS[p.category] || { label: '' }).label;
  const STATUS = { pending: 'در انتظار', accepted: 'قبول شد' };
  const KEY = 'infc_project_draft_v1';
  const PUB_KEY = 'infc_project_published_v1';
  const CONF_KEY = 'infc_github_conf_v1';
  const MAX_NOTE = 150;
  const MAX_SITE = 30;

  const page = document.body.dataset.page;               // home | web | programming | logo
  const isAdmin = page === 'home' && new URLSearchParams(location.search).has('admin');

  const faNum = n => Number(n).toLocaleString('fa-IR');
  const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
  const fmtDate = iso => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? '' : dateFmt.format(d);
  };

  function h(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && node.append(c));
    return node;
  }

  let projects = [];
  let usingDraft = false;
  let editing = null;          // code of the project being edited

  /* ---------- GitHub settings (stored only in this browser) ---------- */
  function loadConf() {
    const def = { owner: 'infc1405', repo: 'INFC-Project', token: '' };
    try {
      const saved = JSON.parse(localStorage.getItem(CONF_KEY) || '{}');
      return Object.assign(def, saved);
    } catch (e) { return def; }
  }
  function saveConf(c) {
    try { localStorage.setItem(CONF_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
  }

  /* ---------- load ---------- */
  async function load() {
    let base = [];
    try {
      const res = await fetch('projects.json', { cache: 'no-store' });
      base = await res.json();
    } catch (e) { base = []; }

    let draft = null;
    if (isAdmin) { try { draft = localStorage.getItem(KEY); } catch (e) { /* ignore */ } }

    usingDraft = false;
    projects = base;
    if (draft) {
      try { projects = JSON.parse(draft); usingDraft = true; } catch (e) { projects = base; }
    }
    render();
    if (isAdmin) refreshCode();
  }

  function saveDraft() {
    try { localStorage.setItem(KEY, JSON.stringify(projects)); usingDraft = true; } catch (e) { /* ignore */ }
  }

  function isPublished() {
    try { return localStorage.getItem(PUB_KEY) === JSON.stringify(projects); } catch (e) { return false; }
  }
  function markPublished() {
    try { localStorage.setItem(PUB_KEY, JSON.stringify(projects)); } catch (e) { /* ignore */ }
  }

  /* ---------- publish to GitHub ---------- */
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function apiError(status) {
    if (status === 401) return 'توکن نامعتبر یا منقضی شده است.';
    if (status === 403) return 'دسترسی توکن کافی نیست (Contents باید Read and write باشد).';
    if (status === 404) return 'مخزن یا فایل پیدا نشد؛ نام کاربری و نام مخزن را بررسی کنید.';
    if (status === 409 || status === 422) return 'تداخل در نسخه فایل؛ دوباره تلاش کنید.';
    return 'خطای GitHub (' + status + ').';
  }

  async function doPublish() {
    const c = loadConf();
    const url = 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' +
      encodeURIComponent(c.repo) + '/contents/projects.json';
    const headers = {
      'Authorization': 'Bearer ' + c.token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const text = JSON.stringify(projects, null, 2) + '\n';
    const content = toBase64(text);

    for (let attempt = 0; attempt < 2; attempt++) {
      const g = await fetch(url, { headers, cache: 'no-store' });
      let sha;
      if (g.ok) sha = (await g.json()).sha;
      else if (g.status !== 404) throw new Error(apiError(g.status));

      const body = { message: 'Update projects.json from admin', content };
      if (sha) body.sha = sha;
      const r = await fetch(url, {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify(body)
      });
      if (r.ok) return;
      if ((r.status === 409 || r.status === 422) && attempt === 0) continue;
      throw new Error(apiError(r.status));
    }
  }

  let queue = Promise.resolve();
  function push(okText) {
    const c = loadConf();
    if (!c.token) {
      say(okText + ' ارسال خودکار انجام نشد چون توکن در «تنظیمات اتصال» وارد نشده است.', true);
      return;
    }
    say('در حال ارسال به GitHub...');
    queue = queue
      .then(doPublish)
      .then(() => {
        markPublished();
        render();
        say(okText + ' به GitHub ارسال شد؛ تا حدود ۲ دقیقه دیگر در سایت نمایش داده می‌شود.');
      })
      .catch(e => {
        say('ارسال به GitHub ناموفق بود: ' + e.message + ' تغییر روی همین گوشی ذخیره شده است.', true);
      });
  }

  /* ---------- render ---------- */
  function render() {
    const visible = projects
      .filter(p => page === 'home' || p.category === page)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.code.localeCompare(b.code));

    const accepted = visible.filter(p => p.status === 'accepted').length;
    const pending = visible.length - accepted;
    const summary = document.getElementById('summary');
    if (summary) {
      summary.textContent = visible.length
        ? `${faNum(visible.length)} پروژه ثبت شده است؛ ${faNum(accepted)} مورد قبول شده و ${faNum(pending)} مورد در انتظار است.`
        : '';
    }

    const holder = document.getElementById('ledger');
    holder.replaceChildren();

    if (page === 'home' && !isAdmin) {
      const rowStyle = 'display:flex;justify-content:space-between;align-items:center;' +
        'padding:14px 16px;margin-bottom:10px;background:#fff;border:1px solid #d9dfc8;border-radius:12px;';
      holder.append(h('div', {},
        Object.keys(KINDS).map(k => {
          const n = projects.filter(p => kindOf(p) === k).length;
          return h('div', { style: rowStyle },
            h('span', { text: 'پروژه ' + KINDS[k].label }),
            h('strong', { text: faNum(n) + ' مورد' }));
        })));
      return;
    }

    if (!visible.length) {
      holder.append(h('p', { class: 'empty', text: 'هنوز پروژه‌ای در این بخش ثبت نشده است.' }));
    } else {
      const heads = ['کد پروژه', 'نام پروژه', 'سایت', 'تاریخ پیشنهاد', 'مدت (روز)', 'وضعیت', 'توضیحات'];
      if (isAdmin) heads.push('مدیریت');

      const rows = visible.map(p => {
        const cells = [
          h('td', { 'data-label': 'کد پروژه' }, h('span', { class: 'code', text: p.code })),
          h('td', { 'data-label': 'نام پروژه' }, h('span', { class: 'pname', text: p.name }),
            page === 'home' ? h('span', { class: 'pcat', text: kindLabel(p) }) : null),
          h('td', { 'data-label': 'سایت', text: p.site || '—' }),
          h('td', { 'data-label': 'تاریخ پیشنهاد', text: fmtDate(p.date) }),
          h('td', { 'data-label': 'مدت (روز)', text: faNum(p.days) }),
          h('td', { 'data-label': 'وضعیت' },
            h('span', { class: 'stamp ' + (p.status === 'accepted' ? 'accepted' : 'pending'),
                        text: STATUS[p.status] || STATUS.pending })),
          h('td', { class: 'cell-note note', 'data-label': 'توضیحات'
