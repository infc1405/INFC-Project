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
  const STATUS = { pending: 'در انتظار', accepted: 'قبول شد', rejected: 'واگذار نشد' };
  const KEY = 'infc_project_draft_v1';
  const PUB_KEY = 'infc_project_published_v1';
  const CONF_KEY = 'infc_github_conf_v1';
  const MAX_NOTE = 150;
  const MAX_SITE = 30;

  const page = document.body.dataset.page;               // home | web | programming | logo | status
  const hasAdminFlag = new URLSearchParams(location.search).has('admin');
  const isAdmin = (page === 'home' || page === 'status') && hasAdminFlag;
  const hasForm = isAdmin && page === 'home';

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
  let showRejected = false;    // admin only: show "not awarded" projects

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
    if (hasForm) refreshCode();
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
      say(okText + ' ارسال خودکار انجام نشد چون توکن در «تنظیمات اتصال» (صفحه ادمین) وارد نشده است.', true);
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
  const byDateDesc = (a, b) =>
    (b.date || '').localeCompare(a.date || '') || a.code.localeCompare(b.code);

  function renderStatus() {
    const holder = document.getElementById('ledger');
    holder.replaceChildren();
    if (!isAdmin) {
      holder.append(h('p', { class: 'empty', text: 'این صفحه فقط برای مدیر سایت است.' }));
      return;
    }

    const heads = ['کد پروژه', 'نام پروژه', 'سایت', 'تاریخ پیشنهاد', 'مدت (روز)', 'وضعیت', 'مدیریت'];
    const section = (title, status, emptyText) => {
      const list = projects.filter(p => p.status === status).sort(byDateDesc);
      const box = h('section', { style: 'margin-bottom:28px;' },
        h('h2', { text: title + ' (' + faNum(list.length) + ')' }));
      if (!list.length) {
        box.append(h('p', { class: 'empty', text: emptyText }));
        return box;
      }
      const rows = list.map(p => h('tr', {},
        h('td', { 'data-label': 'کد پروژه' }, h('span', { class: 'code', text: p.code })),
        h('td', { 'data-label': 'نام پروژه' }, h('span', { class: 'pname', text: p.name }),
          h('span', { class: 'pcat', text: kindLabel(p) })),
        h('td', { 'data-label': 'سایت', text: p.site || '—' }),
        h('td', { 'data-label': 'تاریخ پیشنهاد', text: fmtDate(p.date) }),
        h('td', { 'data-label': 'مدت (روز)', text: faNum(p.days) }),
        h('td', { 'data-label': 'وضعیت' },
          h('span', { class: 'stamp ' + p.status, text: STATUS[p.status] })),
        h('td', { 'data-label': 'مدیریت' },
          h('div', { class: 'row-actions' },
            h('button', { type: 'button', class: 'small', text: 'برگرداندن به در انتظار',
              onclick: () => {
                p.status = 'pending';
                saveDraft(); render();
                push('وضعیت ' + p.code + ' به «در انتظار» برگشت.');
              } })))));
      box.append(h('table', {},
        h('thead', {}, h('tr', {}, heads.map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, rows)));
      return box;
    };

    holder.append(
      section('قبول‌شده‌ها', 'accepted', 'هنوز پروژه‌ای قبول نشده است.'),
      section('واگذارنشده‌ها', 'rejected', 'پروژه واگذارنشده‌ای وجود ندارد.'));

    const banner = document.getElementById('draft-banner');
    if (banner) banner.hidden = !(usingDraft && !isPublished());
  }

  function render() {
    if (page === 'status') { renderStatus(); return; }

    const visible = projects
      .filter(p => page === 'home' || p.category === page)
      .filter(p => p.status !== 'rejected' || (isAdmin && showRejected))
      .sort(byDateDesc);

    const counted = visible.filter(p => p.status !== 'rejected');
    const accepted = counted.filter(p => p.status === 'accepted').length;
    const pending = counted.length - accepted;
    const summary = document.getElementById('summary');
    if (summary) {
      summary.textContent = counted.length
        ? `${faNum(counted.length)} پروژه ثبت شده است؛ ${faNum(accepted)} مورد قبول شده و ${faNum(pending)} مورد در انتظار است.`
        : '';
    }

    const holder = document.getElementById('ledger');
    holder.replaceChildren();
    if (page === 'home' && !isAdmin) {
      const rowStyle = 'display:flex;justify-content:space-between;align-items:center;' +
        'padding:14px 16px;margin-bottom:10px;background:#fff;border:1px solid #d9dfc8;border-radius:12px;';
      holder.append(h('div', {},
        Object.keys(KINDS).map(k => {
          const n = projects.filter(p => kindOf(p) === k && p.status !== 'rejected').length;
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
            h('span', { class: 'stamp ' + (STATUS[p.status] ? p.status : 'pending'),
                        text: STATUS[p.status] || STATUS.pending })),
          h('td', { class: 'cell-note note', 'data-label': 'توضیحات', text: (p.note || '').slice(0, MAX_NOTE) })
        ];
        if (isAdmin) cells.push(h('td', { 'data-label': 'مدیریت' }, adminButtons(p)));
        return h('tr', {}, cells);
      });

      holder.append(h('table', {},
        h('thead', {}, h('tr', {}, heads.map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, rows)));
    }

    const banner = document.getElementById('draft-banner');
    if (banner) banner.hidden = !(isAdmin && usingDraft && !isPublished());
  }

  function adminButtons(p) {
    return h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'small',
        text: p.status === 'accepted' ? 'برگرداندن به در انتظار' : 'ثبت قبول شد',
        onclick: () => {
          p.status = p.status === 'accepted' ? 'pending' : 'accepted';
          saveDraft(); render();
          push('وضعیت ' + p.code + ' تغییر کرد.');
        } }),
      h('button', { type: 'button', class: 'small',
        text: p.status === 'rejected' ? 'برگرداندن به در انتظار' : 'واگذار نشد',
        onclick: () => {
          p.status = p.status === 'rejected' ? 'pending' : 'rejected';
          saveDraft(); render();
          push('وضعیت ' + p.code + ' تغییر کرد.');
        } }),
      h('button', { type: 'button', class: 'small', text: 'ویرایش', onclick: () => startEdit(p) }),
      h('button', { type: 'button', class: 'small danger', text: 'حذف', onclick: () => {
        if (!confirm('پروژه ' + p.code + ' حذف شود؟')) return;
        projects = projects.filter(x => x !== p);
        saveDraft(); render(); refreshCode();
        push('پروژه ' + p.code + ' حذف شد.');
      } }));
  }

  /* ---------- admin form (home page, ?admin) ---------- */
  const $ = id => document.getElementById(id);
  let codeTouched = false;

  function say(text, isErr = false) {
    const m = $('admin-msg');
    if (!m) return;
    m.textContent = text;
    m.className = 'msg' + (isErr ? ' err' : '');
  }

  function suggestCode(kind) {
    const pre = KINDS[kind].prefix;
    const re = new RegExp('^' + pre + '-(\\d+)$');
    const max = projects.reduce((m, p) => {
      const mt = p.code.match(re);
      return mt ? Math.max(m, +mt[1]) : m;
    }, 0);
    return pre + '-' + String(max + 1).padStart(3, '0');
  }

  function refreshCode() {
    if (!hasForm || codeTouched || editing) return;
    $('f-code').value = suggestCode($('f-category').value);
  }

  function updateCounter() {
    const n = $('f-note').value.length;
    const c = $('f-count');
    c.textContent = faNum(n) + ' از ' + faNum(MAX_NOTE) + ' نویسه';
    c.className = 'counter' + (n >= MAX_NOTE ? ' max' : '');
  }

  function resetForm() {
    editing = null;
    codeTouched = false;
    $('proj-form').reset();
    $('f-date').value = new Date().toISOString().slice(0, 10);
    $('f-save').textContent = 'ذخیره پروژه';
    $('f-cancel').hidden = true;
    updateCounter();
    refreshCode();
  }

  function startEdit(p) {
    editing = p.code;
    $('f-category').value = kindOf(p);
    $('f-code').value = p.code;
    $('f-name').value = p.name;
    $('f-site').value = p.site || '';
    $('f-date').value = p.date;
    $('f-days').value = p.days;
    $('f-status').value = p.status;
    $('f-note').value = p.note || '';
    $('f-save').textContent = 'ذخیره ویرایش';
    $('f-cancel').hidden = false;
    updateCounter();
    $('admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildConnectionBox() {
    const c = loadConf();
    const owner = h('input', { id: 'gh-owner', dir: 'ltr', value: c.owner });
    const repo = h('input', { id: 'gh-repo', dir: 'ltr', value: c.repo });
    const token = h('input', { id: 'gh-token', dir: 'ltr', type: 'password',
      autocomplete: 'off', placeholder: c.token ? 'توکن ذخیره شده است (برای تغییر، توکن جدید وارد کنید)' : 'github_pat_...' });
    const msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });

    const box = h('details', { class: 'gh-conf' },
      h('summary', { text: 'تنظیمات اتصال به GitHub' }),
      h('p', { class: 'hint', text: 'این اطلاعات فقط در مرورگر همین گوشی ذخیره می‌شود و داخل فایل‌های سایت قرار نمی‌گیرد.' }),
      h('div', { class: 'grid' },
        h('div', { class: 'field' }, h('label', { for: 'gh-owner', text: 'نام کاربری گیت‌هاب' }), owner),
        h('div', { class: 'field' }, h('label', { for: 'gh-repo', text: 'نام مخزن' }), repo),
        h('div', { class: 'field wide' }, h('label', { for: 'gh-token', text: 'توکن' }), token)),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'primary', text: 'ذخیره تنظیمات', onclick: () => {
          const cur = loadConf();
          cur.owner = owner.value.trim() || 'infc1405';
          cur.repo = repo.value.trim() || 'INFC-Project';
          if (token.value.trim()) cur.token = token.value.trim();
          saveConf(cur);
          token.value = '';
          token.placeholder = 'توکن ذخیره شده است (برای تغییر، توکن جدید وارد کنید)';
          msg.textContent = 'تنظیمات ذخیره شد.';
          msg.className = 'msg';
        } }),
        h('button', { type: 'button', class: 'danger', text: 'حذف توکن از این گوشی', onclick: () => {
          const cur = loadConf();
          cur.token = '';
          saveConf(cur);
          token.placeholder = 'github_pat_...';
          msg.textContent = 'توکن از این گوشی حذف شد.';
          msg.className = 'msg';
        } }),
        h('button', { type: 'button', text: 'ارسال همه پروژه‌ها به GitHub', onclick: () => {
          push('همه پروژه‌ها');
        } })),
      msg);
    if (!c.token) box.open = true;
    return box;
  }

  function setupAdmin() {
    $('admin').hidden = false;
    const hint = document.querySelector('#admin .hint');
    if (hint) {
      hint.textContent = 'با زدن «ذخیره پروژه» اطلاعات به‌صورت خودکار در GitHub ثبت می‌شود و حدود ۲ دقیقه بعد در سایت نمایش داده می‌شود. دکمه «کپی فایل» فقط برای حالت اضطراری است.';
    }
    $('proj-form').before(buildConnectionBox());

    const wrap = $('show-rejected-wrap');
    if (wrap) {
      wrap.hidden = false;
      $('show-rejected').addEventListener('change', e => {
        showRejected = e.target.checked;
        render();
      });
    }

    $('f-category').addEventListener('change', refreshCode);
    $('f-code').addEventListener('input', () => { codeTouched = true; });
    $('f-note').addEventListener('input', updateCounter);
    $('f-cancel').addEventListener('click', () => { resetForm(); say(''); });

    $('proj-form').addEventListener('submit', e => {
      e.preventDefault();
      const rec = {
        code: $('f-code').value.trim().toUpperCase(),
        name: $('f-name').value.trim(),
        category: KINDS[$('f-category').value].category,
        site: $('f-site').value.trim().slice(0, MAX_SITE),
        date: $('f-date').value,
        days: parseInt($('f-days').value, 10),
        status: $('f-status').value,
        note: $('f-note').value.trim().slice(0, MAX_NOTE)
      };
      if (!rec.code || !rec.name || !rec.date || !(rec.days > 0)) {
        say('کد، نام، تاریخ و تعداد روز را کامل وارد کنید.', true);
        return;
      }
      if (projects.some(p => p.code === rec.code && p.code !== editing)) {
        say('کد ' + rec.code + ' قبلاً استفاده شده است.', true);
        return;
      }
      if (editing) projects = projects.map(p => (p.code === editing ? rec : p));
      else projects.push(rec);

      saveDraft(); render();
      const wasEdit = !!editing;
      resetForm();
      push(wasEdit ? 'ویرایش ذخیره شد.' : 'پروژه ذخیره شد.');
    });

    $('btn-copy').addEventListener('click', async () => {
      const text = JSON.stringify(projects, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        $('copy-out').hidden = true;
        say('فایل کپی شد. در GitHub محتوای projects.json را با آن جایگزین کنید.');
      } catch (e) {
        const out = $('copy-out');
        out.hidden = false;
        out.value = text;
        out.focus();
        out.select();
        say('کپی خودکار انجام نشد؛ متن زیر را دستی کپی کنید.', true);
      }
    });

    $('btn-reset').addEventListener('click', () => {
      if (!confirm('پیش‌نویس این گوشی پاک شود و دوباره projects.json منتشرشده نمایش داده شود؟')) return;
      try { localStorage.removeItem(KEY); localStorage.removeItem(PUB_KEY); } catch (e) { /* ignore */ }
      load();
      resetForm();
      say('پیش‌نویس پاک شد.');
    });

    resetForm();
  }

  if (hasForm) setupAdmin();
  load();
})();
