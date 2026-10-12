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
  const MAX_NOTE = 150;

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

    if (!visible.length) {
      holder.append(h('p', { class: 'empty', text: 'هنوز پروژه‌ای در این بخش ثبت نشده است.' }));
    } else {
      const heads = ['کد پروژه', 'نام پروژه', 'تاریخ پیشنهاد', 'مدت (روز)', 'وضعیت', 'توضیحات'];
      if (isAdmin) heads.push('مدیریت');

      const rows = visible.map(p => {
        const cells = [
          h('td', { 'data-label': 'کد پروژه' }, h('span', { class: 'code', text: p.code })),
          h('td', { 'data-label': 'نام پروژه' }, h('span', { class: 'pname', text: p.name }),
            page === 'home' ? h('span', { class: 'pcat', text: kindLabel(p) }) : null),
          h('td', { 'data-label': 'تاریخ پیشنهاد', text: fmtDate(p.date) }),
          h('td', { 'data-label': 'مدت (روز)', text: faNum(p.days) }),
          h('td', { 'data-label': 'وضعیت' },
            h('span', { class: 'stamp ' + (p.status === 'accepted' ? 'accepted' : 'pending'),
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
    if (banner) banner.hidden = !(isAdmin && usingDraft);
  }

  function adminButtons(p) {
    return h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'small',
        text: p.status === 'accepted' ? 'برگرداندن به در انتظار' : 'ثبت قبول شد',
        onclick: () => {
          p.status = p.status === 'accepted' ? 'pending' : 'accepted';
          saveDraft(); render();
          say('وضعیت ' + p.code + ' تغییر کرد. برای انتشار، فایل را کپی کنید.');
        } }),
      h('button', { type: 'button', class: 'small', text: 'ویرایش', onclick: () => startEdit(p) }),
      h('button', { type: 'button', class: 'small danger', text: 'حذف', onclick: () => {
        if (!confirm('پروژه ' + p.code + ' حذف شود؟')) return;
        projects = projects.filter(x => x !== p);
        saveDraft(); render(); refreshCode();
        say('پروژه ' + p.code + ' حذف شد. برای انتشار، فایل را کپی کنید.');
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
    if (!isAdmin || codeTouched || editing) return;
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
    $('f-date').value = p.date;
    $('f-days').value = p.days;
    $('f-status').value = p.status;
    $('f-note').value = p.note || '';
    $('f-save').textContent = 'ذخیره ویرایش';
    $('f-cancel').hidden = false;
    updateCounter();
    $('admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setupAdmin() {
    $('admin').hidden = false;
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
      say(wasEdit ? 'ویرایش ذخیره شد.' : 'پروژه ذخیره شد. برای انتشار، فایل را کپی کنید.');
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
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      load();
      resetForm();
      say('پیش‌نویس پاک شد.');
    });

    resetForm();
  }

  if (isAdmin) setupAdmin();
  load();
})();
