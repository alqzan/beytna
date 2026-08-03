import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"
import {
  getFirestore, doc, onSnapshot, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"

const { useState, useEffect, useRef, useMemo, createContext, useContext } = React
const html = htm.bind(React.createElement)

/* =========================================================================
   إعداد Firebase — المزامنة الفورية بين الأجهزة.
   هذه المفاتيح آمنة لتكون علنية (هذا تصميم Firebase). الحماية عبر قواعد Firestore.
   ========================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyDZgcI6_cVVZtE8MVRbmFZm5fkugfEvpa0",
  authDomain: "beytna-1.firebaseapp.com",
  projectId: "beytna-1",
  storageBucket: "beytna-1.firebasestorage.app",
  messagingSenderId: "620832992420",
  appId: "1:620832992420:web:7c1d0fd075d9892d018a31"
}

let db = null
try {
  db = getFirestore(initializeApp(firebaseConfig))
} catch (e) {
  console.error('Firebase init failed — fallback to local', e)
}

/* prefs = إعدادات مشتركة بين الجهازين (الفئات + المتكررات) */
const SECTIONS = ['rules', 'shopping', 'travel', 'packing']
const STORED = [...SECTIONS, 'prefs']
const EMPTY = { rules: [], shopping: [], travel: [], packing: [], prefs: {} }
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ')
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms) } catch {} }

/* ---- تخزين محلي: نسخة احتياطية دائمة تعمل بدون إنترنت ---- */
const Local = {
  read(familyId) {
    const d = { ...EMPTY }
    for (const s of STORED) {
      try {
        const raw = localStorage.getItem(`baytuna_${s}_${familyId}`)
        if (raw) d[s] = JSON.parse(raw)
      } catch {}
    }
    return d
  },
  write(familyId, section, value) {
    try { localStorage.setItem(`baytuna_${section}_${familyId}`, JSON.stringify(value)) } catch {}
  },
  cache(familyId, data) {
    for (const s of STORED) Local.write(familyId, s, data[s])
  },
}

/* =========================================================================
   المتجر المركزي: مستند واحد لكل عائلة في Firestore (families/{familyId})
   onSnapshot = تحديث لحظي عند أي طرف، مع نسخة محلية للعمل بدون إنترنت.
   ========================================================================= */
function useFamilyStore(familyId) {
  const [data, setData] = useState(null) // null = جاري التحميل
  const ref = useRef({ ...EMPTY })

  useEffect(() => {
    if (!familyId) { setData(null); return }

    if (db) {
      let loaded = false
      const docRef = doc(db, 'families', familyId)
      // مؤقّت أمان: لو ما وصلت البيانات خلال ٥ ثواني، افتح بالنسخة المحلية ولا تعلّق
      const timer = setTimeout(() => {
        if (!loaded) {
          const d = Local.read(familyId)
          ref.current = d
          setData(d)
        }
      }, 5000)
      const unsub = onSnapshot(docRef, (snap) => {
        loaded = true
        clearTimeout(timer)
        if (snap.exists()) {
          const d = { ...EMPTY, ...snap.data() }
          ref.current = d
          setData(d)
          Local.cache(familyId, d) // نسخة احتياطية لكل تحديث
        } else {
          setDoc(docRef, { ...EMPTY }).catch(e => console.error(e))
          ref.current = { ...EMPTY }
          setData({ ...EMPTY })
        }
      }, (err) => {
        loaded = true
        clearTimeout(timer)
        console.error('Firestore error — using local', err)
        const d = Local.read(familyId)
        ref.current = d
        setData(d)
      })
      return () => { clearTimeout(timer); unsub() }
    } else {
      const d = Local.read(familyId)
      ref.current = d
      setData(d)
    }
  }, [familyId])

  const updateSection = (section, value) => {
    const next = { ...ref.current, [section]: value }
    ref.current = next
    setData(next) // تحديث تفاؤلي فوري
    Local.write(familyId, section, value)
    if (db) {
      updateDoc(doc(db, 'families', familyId), { [section]: value }).catch(e => console.error(e))
    }
  }

  return { data, updateSection }
}

// واجهة قسم واحد بنفس الـAPI القديمة (items/add/update/remove/replaceAll)
// onRemove(name, prevItems, item) يُستدعى قبل الحذف لدعم التراجع
function section(store, name, onRemove) {
  const items = (store.data && store.data[name]) || []
  return {
    items,
    add: (d) => store.updateSection(name, [...items, { id: genId(), createdAt: Date.now(), ...d }]),
    update: (id, patch) => store.updateSection(name, items.map(it => it.id === id ? { ...it, ...patch } : it)),
    remove: (id) => {
      if (onRemove) onRemove(name, items, items.find(it => it.id === id))
      store.updateSection(name, items.filter(it => it.id !== id))
    },
    replaceAll: (next) => store.updateSection(name, next),
  }
}

/* ---- تفضيلات العرض: محليّة لكل جهاز (ما تنعكس على الطرف الثاني) ---- */
const DEFAULT_UI = { hideDone: false, group: true, collapsed: {}, hiddenTabs: [], hidePacked: false }
function useUI() {
  const [ui, set] = useState(() => {
    try { return { ...DEFAULT_UI, ...JSON.parse(localStorage.getItem('baytuna_ui') || '{}') } }
    catch { return { ...DEFAULT_UI } }
  })
  const patch = (p) => set(prev => {
    const next = { ...prev, ...(typeof p === 'function' ? p(prev) : p) }
    try { localStorage.setItem('baytuna_ui', JSON.stringify(next)) } catch {}
    return next
  })
  return [ui, patch]
}

/* =========================== مكونات مساعدة =========================== */

const Ctx = createContext({})
const useApp = () => useContext(Ctx)

function Modal({ title, sub, onClose, children }) {
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="sheet" onClick=${e => e.stopPropagation()}>
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <div>
            <h3>${title}</h3>
            ${sub && html`<p class="sheet-sub">${sub}</p>`}
          </div>
          <button class="sheet-x" onClick=${onClose}>✕</button>
        </div>
        ${children}
      </div>
    </div>
  `
}

function Empty({ emo, text, action, onAction }) {
  return html`
    <div class="empty">
      <div class="emo">${emo}</div>
      <p>${text}</p>
      ${action && html`<button class="empty-btn" onClick=${onAction}>${action}</button>`}
    </div>
  `
}

function Progress({ done, total, tone = 'amber' }) {
  if (!total) return null
  const pct = Math.round((done / total) * 100)
  return html`
    <div class="prog">
      <div class="prog-bar"><span class=${'prog-fill ' + tone} style=${{ width: pct + '%' }}></span></div>
      <span class="prog-txt">${done}/${total}</span>
    </div>
  `
}

function Switch({ on }) {
  return html`<span class=${'switch' + (on ? ' on' : '')}><span class="knob"></span></span>`
}

function OptRow({ icon, title, desc, on, onToggle }) {
  return html`
    <button class="opt-row" onClick=${onToggle}>
      <span class="opt-ico">${icon}</span>
      <span class="opt-txt"><b>${title}</b>${desc && html`<small>${desc}</small>`}</span>
      <${Switch} on=${on} />
    </button>
  `
}

function ActRow({ icon, title, desc, onClick, danger }) {
  return html`
    <button class=${'opt-row' + (danger ? ' danger' : '')} onClick=${onClick}>
      <span class="opt-ico">${icon}</span>
      <span class="opt-txt"><b>${title}</b>${desc && html`<small>${desc}</small>`}</span>
      <span class="opt-go">⌄</span>
    </button>
  `
}

function Stepper({ value, onChange, min = 1, max = 99 }) {
  return html`
    <div class="stepper">
      <button onClick=${() => onChange(Math.max(min, value - 1))} disabled=${value <= min}>−</button>
      <span>${value}</span>
      <button onClick=${() => onChange(Math.min(max, value + 1))} disabled=${value >= max}>+</button>
    </div>
  `
}

/* =========================== ١) قواعد الزواج =========================== */

function MarriageRules({ col }) {
  const { items, add, update, remove } = col
  const { ask } = useApp()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null) // القاعدة تحت التعديل

  const submit = () => {
    const t = norm(text)
    if (!t) return
    if (editing) update(editing.id, { text: t })
    else add({ text: t, pinned: false })
    close()
  }
  const close = () => { setOpen(false); setEditing(null); setText('') }
  const openEdit = (r) => { setEditing(r); setText(r.text); setOpen(true) }

  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  return html`
    <div class="page">
      <div class="page-head">
        <h2>قواعد زواجنا</h2>
        <span class="badge badge-rose">${items.length} قاعدة</span>
      </div>

      ${items.length === 0
        ? html`<${Empty} emo="💌" text="أضف أول قاعدة لزواجكم" action="+ قاعدة جديدة" onAction=${() => setOpen(true)} />`
        : html`
          <div class="list">
            ${sorted.map((r, i) => html`
              <div class=${'card rule' + (r.pinned ? ' pinned' : '')} key=${r.id}>
                <span class="num">${r.pinned ? '⭐' : i + 1}</span>
                <button class="rule-body" onClick=${() => openEdit(r)}><p>${r.text}</p></button>
                <div class="rule-acts">
                  <button class="icon-btn" title="تثبيت" onClick=${() => { buzz(); update(r.id, { pinned: !r.pinned }) }}>
                    ${r.pinned ? '📌' : '📍'}
                  </button>
                  <button class="icon-x" onClick=${() => remove(r.id)}>✕</button>
                </div>
              </div>
            `)}
          </div>
        `}

      <button class="fab fab-rose" onClick=${() => setOpen(true)}>+</button>

      ${open && html`
        <${Modal} title=${editing ? 'تعديل القاعدة ✏️' : 'قاعدة جديدة ✨'} onClose=${close}>
          <textarea
            class="field"
            rows="4"
            dir="rtl"
            autoFocus
            placeholder="اكتب القاعدة أو الاتفاق هنا..."
            value=${text}
            onInput=${e => setText(e.target.value)}
          ></textarea>
          <div class="btn-row">
            <button class="btn btn-primary" disabled=${!norm(text)} onClick=${submit}>${editing ? 'حفظ' : 'إضافة'}</button>
            <button class="btn btn-ghost" onClick=${close}>إلغاء</button>
          </div>
          ${editing && html`
            <button class="link-danger" onClick=${() => ask({
              title: 'حذف القاعدة؟', text: editing.text, ok: 'حذف', danger: true,
              onOk: () => { remove(editing.id); close() }
            })}>🗑️ حذف هذه القاعدة</button>
          `}
        <//>
      `}
    </div>
  `
}

/* =========================== ٢) مقاضي البيت =========================== */

const DEFAULT_CATS = [
  { id: 'food', label: 'مواد غذائية', icon: '🥦' },
  { id: 'home', label: 'منزليات', icon: '🏠' },
  { id: 'health', label: 'صيدلية', icon: '💊' },
  { id: 'clothes', label: 'ملابس', icon: '👕' },
  { id: 'tech', label: 'إلكترونيات', icon: '📱' },
  { id: 'other', label: 'أخرى', icon: '📦' },
]
const FALLBACK_CAT = { id: 'other', label: 'أخرى', icon: '📦' }
const catOf = (cats, id) => cats.find(c => c.id === id) || FALLBACK_CAT

function ShoppingList({ col }) {
  const { items, update, remove, replaceAll } = col
  const { cats, prefs, setPrefs, ui, setUI, ask, notify, openCats } = useApp()

  const [q, setQ] = useState('')
  const [lastCat, setLastCat] = useState(() => localStorage.getItem('baytuna_lastcat') || 'food')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [searchOn, setSearchOn] = useState(false)
  const [tools, setTools] = useState(false)
  const [catPick, setCatPick] = useState(false)
  const [edit, setEdit] = useState(null)
  const inputRef = useRef(null)

  const visibleCats = cats.filter(c => !c.hidden)
  const hiddenIds = cats.filter(c => c.hidden).map(c => c.id)
  const addCat = filter !== 'all' ? filter : lastCat
  const pickCat = (id) => {
    setLastCat(id)
    try { localStorage.setItem('baytuna_lastcat', id) } catch {}
    setCatPick(false)
  }

  /* ---- الإضافة السريعة: تقبل عدة أغراض مفصولة بفاصلة ---- */
  const addMany = (names, cat) => {
    const next = [...items]
    let bumped = 0
    for (const raw of names) {
      const n = norm(raw)
      if (!n) continue
      const i = next.findIndex(it => !it.completed && norm(it.name) === n)
      if (i >= 0) { next[i] = { ...next[i], qty: (next[i].qty || 1) + 1 }; bumped++ }
      else next.push({ id: genId(), createdAt: Date.now(), name: n, category: cat, completed: false, qty: 1 })
    }
    if (next.length === items.length && !bumped) return
    replaceAll(next)
    bumpFreq(names, cat)
    buzz()
    if (bumped) notify('زدنا الكمية للأغراض المكررة 👌')
  }

  const bumpFreq = (names, cat) => {
    const freq = { ...(prefs.freq || {}) }
    for (const raw of names) {
      const n = norm(raw)
      if (!n) continue
      freq[n] = { n: ((freq[n] && freq[n].n) || 0) + 1, c: cat }
    }
    const keys = Object.keys(freq)
    if (keys.length > 60) {
      keys.sort((a, b) => freq[b].n - freq[a].n).slice(60).forEach(k => delete freq[k])
    }
    setPrefs({ freq })
  }

  const submitQuick = () => {
    const parts = q.split(/[،,\n]+/)
    if (!parts.some(p => norm(p))) return
    addMany(parts, addCat)
    setQ('')
  }

  /* ---- الاقتراحات: أكثر الأغراض تكراراً عندكم ---- */
  const suggestions = useMemo(() => {
    const freq = prefs.freq || {}
    const pending = new Set(items.filter(i => !i.completed).map(i => norm(i.name)))
    const qn = norm(q)
    let list = Object.keys(freq).filter(n => !pending.has(n))
    if (qn) list = list.filter(n => n.includes(qn) && n !== qn)
    return list.sort((a, b) => freq[b].n - freq[a].n).slice(0, qn ? 4 : 8)
  }, [prefs.freq, items, q])

  /* ---- التصفية والتجميع ---- */
  const matches = (it) => {
    const cat = it.category || 'other'
    if (search && !norm(it.name).includes(norm(search))) return false
    if (filter === 'all') return !hiddenIds.includes(cat)
    return cat === filter
  }
  const shown = items.filter(matches)
  const pending = shown.filter(i => !i.completed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const done = shown.filter(i => i.completed).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
  const hiddenCount = filter === 'all' && !search
    ? items.filter(i => !i.completed && hiddenIds.includes(i.category || 'other')).length : 0

  const grouped = ui.group && !search
  const groups = useMemo(() => {
    if (!grouped) return null
    const map = new Map()
    for (const it of pending) {
      const k = it.category || 'other'
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(it)
    }
    const out = []
    for (const c of cats) if (map.has(c.id)) { out.push([c, map.get(c.id)]); map.delete(c.id) }
    for (const [k, arr] of map) out.push([{ ...FALLBACK_CAT, id: k }, arr])
    return out
  }, [grouped, pending, cats])

  const toggleCollapsed = (key) => setUI(prev => ({ collapsed: { ...prev.collapsed, [key]: !prev.collapsed[key] } }))

  const toggleDone = (it) => {
    buzz()
    update(it.id, { completed: !it.completed, doneAt: it.completed ? null : Date.now() })
  }

  /* ---- أدوات القائمة ---- */
  const clearDone = () => {
    const prev = items
    const n = items.filter(i => i.completed).length
    replaceAll(items.filter(i => !i.completed))
    setTools(false)
    notify(`🗑️ حذفنا ${n} غرض مكتمل`, { label: '↩︎ تراجع', run: () => replaceAll(prev) })
  }
  const clearAll = () => { setTools(false); ask({
    title: 'تفريغ القائمة كاملة؟',
    text: 'بيتحذف كل الأغراض — بس تقدر تتراجع فوراً.',
    ok: 'تفريغ', danger: true,
    onOk: () => {
      const prev = items
      replaceAll([])
      notify('🧹 فرّغنا القائمة', { label: '↩︎ تراجع', run: () => replaceAll(prev) })
    },
  }) }

  const listText = () => {
    const pend = items.filter(i => !i.completed)
    if (!pend.length) return '🛒 مقاضي البيت\nما بقى شي 🎉'
    const byCat = new Map()
    for (const i of pend) {
      const k = i.category || 'other'
      if (!byCat.has(k)) byCat.set(k, [])
      byCat.get(k).push(i)
    }
    const lines = ['🛒 مقاضي البيت']
    const order = [...cats.map(c => c.id), ...[...byCat.keys()].filter(k => !cats.some(c => c.id === k))]
    for (const k of order) {
      if (!byCat.has(k)) continue
      const c = catOf(cats, k)
      lines.push('', `${c.icon} ${c.label}`)
      for (const i of byCat.get(k)) {
        lines.push(`• ${i.name}${(i.qty || 1) > 1 ? ` ×${i.qty}` : ''}${i.note ? ` (${i.note})` : ''}`)
      }
    }
    return lines.join('\n')
  }
  const copyList = async () => {
    const t = listText()
    setTools(false)
    try { await navigator.clipboard.writeText(t); notify('📋 تم نسخ القائمة') }
    catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
        notify('📋 تم نسخ القائمة')
      } catch { notify('ما قدرنا ننسخ 😕') }
    }
  }
  const shareList = async () => {
    setTools(false)
    try { await navigator.share({ title: 'مقاضي البيت', text: listText() }) } catch {}
  }

  const totalCount = items.length
  const doneCount = items.filter(i => i.completed).length

  const renderItem = (it) => {
    const c = catOf(cats, it.category)
    const qty = it.qty || 1
    return html`
      <div class=${'item' + (it.completed ? ' done' : '')} key=${it.id}>
        <button class=${'check' + (it.completed ? ' on' : '')} onClick=${() => toggleDone(it)}>
          ${it.completed ? '✓' : ''}
        </button>
        <button class="body" onClick=${() => setEdit(it)}>
          <p>${it.name}${qty > 1 && html`<span class="qty">×${qty}</span>`}</p>
          <span>${c.icon} ${c.label}</span>
          ${it.note && html`<span class="note">📝 ${it.note}</span>`}
        </button>
        <button class="icon-x" onClick=${() => remove(it.id)}>✕</button>
      </div>
    `
  }

  return html`
    <div class="page">
      <div class="page-head">
        <h2>مقاضي البيت</h2>
        <div class="head-acts">
          ${totalCount > 0 && html`
            <button class=${'head-btn' + (searchOn ? ' on' : '')} title="بحث"
              onClick=${() => { setSearchOn(v => !v); setSearch('') }}>🔎</button>
          `}
          <button class="head-btn" title="أدوات" onClick=${() => setTools(true)}>⋯</button>
        </div>
      </div>

      ${totalCount > 0 && html`<${Progress} done=${doneCount} total=${totalCount} />`}

      ${searchOn && html`
        <input class="field amber search-field" dir="rtl" autoFocus placeholder="دوّر على غرض..."
          value=${search} onInput=${e => setSearch(e.target.value)} />
      `}

      <div class="chips">
        <button class=${'chip' + (filter === 'all' ? ' active' : '')} onClick=${() => setFilter('all')}>الكل</button>
        ${visibleCats.map(c => html`
          <button key=${c.id} class=${'chip' + (filter === c.id ? ' active' : '')} onClick=${() => setFilter(c.id)}>
            ${c.icon} ${c.label}
          </button>
        `)}
        <button class="chip chip-ghost" onClick=${openCats}>🏷️ الفئات</button>
      </div>

      <div class="qadd">
        <button class="qadd-cat" title="فئة الغرض" onClick=${() => setCatPick(v => !v)}>${catOf(cats, addCat).icon}</button>
        <input
          ref=${inputRef}
          class="qadd-input"
          dir="rtl"
          placeholder="أضف غرض… (افصل بفاصلة)"
          value=${q}
          onInput=${e => setQ(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && submitQuick()}
        />
        <button class="qadd-go" disabled=${!norm(q)} onClick=${submitQuick}>+</button>
      </div>

      ${catPick && html`
        <div class="qadd-cats">
          ${visibleCats.map(c => html`
            <button key=${c.id} class=${'mini-cat' + (addCat === c.id ? ' active' : '')} onClick=${() => pickCat(c.id)}>
              ${c.icon} ${c.label}
            </button>
          `)}
        </div>
      `}

      ${suggestions.length > 0 && html`
        <div class="sugs">
          <span class="sugs-lbl">${norm(q) ? '💡' : '🔁 متكرر:'}</span>
          ${suggestions.map(n => html`
            <button key=${n} class="sug" onClick=${() => { addMany([n], (prefs.freq[n] && prefs.freq[n].c) || addCat); setQ('') }}>
              + ${n}
            </button>
          `)}
        </div>
      `}

      ${hiddenCount > 0 && html`
        <button class="muted-note" onClick=${openCats}>🙈 ${hiddenCount} غرض مخفي داخل فئات مخفية — اضغط للإظهار</button>
      `}

      ${pending.length === 0 && done.length > 0 && !search && html`
        <div class="done-all">🎉 خلصنا كل شي!</div>
      `}

      ${pending.length === 0 && done.length === 0
        ? html`<${Empty} emo="🛍️" text=${search ? 'ما لقينا شي بهالاسم' : 'القائمة فاضية — اكتب فوق وأضف'}
            action=${search ? null : 'يلا نبدأ'} onAction=${() => inputRef.current && inputRef.current.focus()} />`
        : html`
          ${grouped && groups
            ? groups.map(([c, arr]) => {
                const key = 'cat_' + c.id
                const off = ui.collapsed[key]
                return html`
                  <div class="group" key=${key}>
                    <button class="group-head" onClick=${() => toggleCollapsed(key)}>
                      <span class="group-title">${c.icon} ${c.label}</span>
                      <span class="badge badge-gray">${arr.length}</span>
                      <span class=${'caret' + (off ? '' : ' open')}>⌄</span>
                    </button>
                    ${!off && html`<div class="list">${arr.map(renderItem)}</div>`}
                  </div>
                `
              })
            : html`<div class="list">${pending.map(renderItem)}</div>`}

          ${done.length > 0 && html`
            <div class="group" style=${{ marginTop: '18px' }}>
              <button class="group-head" onClick=${() => setUI({ hideDone: !ui.hideDone })}>
                <span class="group-title">✓ خلصت</span>
                <span class="badge badge-gray">${done.length}</span>
                <span class=${'caret' + (ui.hideDone ? '' : ' open')}>⌄</span>
              </button>
              ${!ui.hideDone && html`<div class="list">${done.map(renderItem)}</div>`}
            </div>
            <button class="clear-btn" onClick=${clearDone}>🗑️ حذف المكتملة (${done.length})</button>
          `}
        `}

      ${tools && html`
        <${Modal} title="أدوات القائمة 🧰" sub="خيارات العرض تخصّ جهازك فقط" onClose=${() => setTools(false)}>
          <${OptRow} icon="🗂️" title="تجميع حسب الفئة" desc="كل فئة بمجموعة تقدر تطويها"
            on=${ui.group} onToggle=${() => setUI({ group: !ui.group })} />
          <${OptRow} icon="🙈" title="إخفاء المكتملة" desc="طيّ الأغراض اللي خلصت"
            on=${ui.hideDone} onToggle=${() => setUI({ hideDone: !ui.hideDone })} />
          <div class="sep"></div>
          <${ActRow} icon="🏷️" title="إدارة الفئات" desc="أضف، عدّل، أو أخفِ فئات"
            onClick=${() => { setTools(false); openCats() }} />
          <${ActRow} icon="📋" title="نسخ القائمة" desc="نص جاهز ترسله بالواتساب" onClick=${copyList} />
          ${navigator.share && html`<${ActRow} icon="📤" title="مشاركة القائمة" onClick=${shareList} />`}
          <div class="sep"></div>
          ${done.length > 0 && html`<${ActRow} icon="🗑️" title=${`حذف المكتملة (${done.length})`} onClick=${clearDone} danger />`}
          ${items.length > 0 && html`<${ActRow} icon="🧹" title="تفريغ القائمة كاملة" onClick=${clearAll} danger />`}
          ${Object.keys(prefs.freq || {}).length > 0 && html`
            <${ActRow} icon="✨" title="مسح قائمة المتكررات" desc="نبدأ تعلّم اقتراحاتكم من جديد" danger
              onClick=${() => ask({
                title: 'مسح المتكررات؟', ok: 'مسح', danger: true,
                onOk: () => { setPrefs({ freq: {} }); setTools(false); notify('✨ انمسحت المتكررات') },
              })} />
          `}
        <//>
      `}

      ${edit && html`<${ItemEditor} item=${edit}
        cats=${visibleCats.some(c => c.id === (edit.category || 'other')) ? visibleCats : [...visibleCats, catOf(cats, edit.category)]}
        onClose=${() => setEdit(null)}
        onSave=${(patch) => { update(edit.id, patch); setEdit(null) }}
        onDelete=${() => { remove(edit.id); setEdit(null) }} />`}
    </div>
  `
}

function ItemEditor({ item, cats, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.qty || 1)
  const [cat, setCat] = useState(item.category || 'other')
  const [note, setNote] = useState(item.note || '')

  const save = () => {
    if (!norm(name)) return
    onSave({ name: norm(name), qty, category: cat, note: norm(note) })
  }

  return html`
    <${Modal} title="تعديل الغرض ✏️" onClose=${onClose}>
      <input class="field amber" dir="rtl" autoFocus placeholder="اسم الغرض..."
        value=${name} onInput=${e => setName(e.target.value)}
        onKeyDown=${e => e.key === 'Enter' && save()}
        style=${{ marginBottom: '14px' }} />

      <div class="row-between">
        <span class="row-lbl">الكمية</span>
        <${Stepper} value=${qty} onChange=${setQty} />
      </div>

      <div class="cat-grid" style=${{ margin: '14px 0' }}>
        ${cats.map(c => html`
          <button key=${c.id} class=${'cat-opt' + (cat === c.id ? ' active' : '')} onClick=${() => setCat(c.id)}>
            ${c.icon}<br/>${c.label}
          </button>
        `)}
      </div>

      <input class="field gray" dir="rtl" placeholder="ملاحظة (نوع، ماركة، حجم…)"
        value=${note} onInput=${e => setNote(e.target.value)}
        onKeyDown=${e => e.key === 'Enter' && save()} />

      <div class="btn-row">
        <button class="btn btn-primary amber" disabled=${!norm(name)} onClick=${save}>حفظ</button>
        <button class="btn btn-ghost" onClick=${onClose}>إلغاء</button>
      </div>
      <button class="link-danger" onClick=${onDelete}>🗑️ حذف الغرض</button>
    <//>
  `
}

/* ---- إدارة الفئات (مشتركة بين الجهازين) ---- */
function CategoryManager({ onClose }) {
  const { cats, setPrefs, ask, notify } = useApp()
  const [icon, setIcon] = useState('🛒')
  const [label, setLabel] = useState('')
  const [draft, setDraft] = useState({}) // نكتب محلياً ونحفظ عند الخروج من الحقل

  const save = (next) => setPrefs({ cats: next })
  const toggleHide = (id) => { buzz(); save(cats.map(c => c.id === id ? { ...c, hidden: !c.hidden } : c)) }
  const rename = (id, val) => save(cats.map(c => c.id === id ? { ...c, label: val } : c))
  const valOf = (c) => (draft[c.id] !== undefined ? draft[c.id] : c.label)
  const commit = (c) => {
    const v = norm(valOf(c))
    if (v && v !== c.label) rename(c.id, v)
    setDraft(d => { const n = { ...d }; delete n[c.id]; return n })
  }
  const del = (c) => {
    if (cats.length <= 1) { notify('لازم تبقى فئة وحدة على الأقل 🙂'); return }
    ask({
      title: `حذف فئة «${c.label}»؟`,
      text: 'الأغراض اللي فيها بتنتقل لفئة «أخرى».',
      ok: 'حذف', danger: true,
      onOk: () => save(cats.filter(x => x.id !== c.id)),
    })
  }
  const addCat = () => {
    const l = norm(label)
    if (!l) return
    save([...cats, { id: 'c' + genId(), label: l, icon: norm(icon) || '🛒' }])
    setLabel(''); setIcon('🛒')
    notify('🏷️ أضفنا الفئة')
  }
  const reset = () => ask({
    title: 'رجوع للفئات الأساسية؟', ok: 'رجّع', danger: true,
    onOk: () => save(DEFAULT_CATS.map(c => ({ ...c }))),
  })

  return html`
    <${Modal} title="الفئات 🏷️" sub="التعديل هنا يظهر عند الطرفين" onClose=${onClose}>
      <div class="cat-rows">
        ${cats.map(c => html`
          <div class=${'cat-row' + (c.hidden ? ' off' : '')} key=${c.id}>
            <span class="cat-emo">${c.icon}</span>
            <input class="cat-name" dir="rtl" value=${valOf(c)}
              onInput=${e => { const v = e.target.value; setDraft(d => ({ ...d, [c.id]: v })) }}
              onBlur=${() => commit(c)} />
            <button class="icon-btn" title=${c.hidden ? 'إظهار' : 'إخفاء'} onClick=${() => toggleHide(c.id)}>
              ${c.hidden ? '🙈' : '👁️'}
            </button>
            <button class="icon-x" onClick=${() => del(c)}>✕</button>
          </div>
        `)}
      </div>

      <div class="sep"></div>
      <div class="row-gap">
        <input class="flag-input" value=${icon} onInput=${e => setIcon(e.target.value)} />
        <input class="field gray" dir="rtl" placeholder="فئة جديدة..." value=${label}
          onInput=${e => setLabel(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && addCat()} />
        <button class="btn btn-primary amber" style=${{ flex: '0 0 84px' }} disabled=${!norm(label)} onClick=${addCat}>إضافة</button>
      </div>
      <p class="hint">الإخفاء يخفي الفئة وأغراضها من القائمة بدون ما يحذفها 👌</p>
      <button class="link-danger" onClick=${reset}>↺ رجوع للفئات الأساسية</button>
    <//>
  `
}

/* =========================== ٣) السفر =========================== */

const STATUS = {
  planned: { label: 'مخطط', cls: 'st-planned' },
  soon: { label: 'قريباً', cls: 'st-soon' },
  visited: { label: '✓ تمت الزيارة', cls: 'st-visited' },
}

const FLAGS = {
  'السعودية': '🇸🇦', 'الإمارات': '🇦🇪', 'مصر': '🇪🇬', 'تركيا': '🇹🇷',
  'اليابان': '🇯🇵', 'فرنسا': '🇫🇷', 'إيطاليا': '🇮🇹', 'إسبانيا': '🇪🇸',
  'بريطانيا': '🇬🇧', 'لندن': '🇬🇧', 'أمريكا': '🇺🇸', 'كندا': '🇨🇦', 'أستراليا': '🇦🇺',
  'المالديف': '🇲🇻', 'تايلاند': '🇹🇭', 'سنغافورة': '🇸🇬', 'اليونان': '🇬🇷',
  'المغرب': '🇲🇦', 'الأردن': '🇯🇴', 'لبنان': '🇱🇧', 'سويسرا': '🇨🇭',
  'ألمانيا': '🇩🇪', 'هولندا': '🇳🇱', 'البرتغال': '🇵🇹', 'النمسا': '🇦🇹',
  'إندونيسيا': '🇮🇩', 'بالي': '🇮🇩', 'ماليزيا': '🇲🇾', 'البحرين': '🇧🇭',
  'الكويت': '🇰🇼', 'قطر': '🇶🇦', 'عمان': '🇴🇲', 'جورجيا': '🇬🇪', 'أذربيجان': '🇦🇿',
}

function CountryDetail({ dest, onBack, onUpdate, onDelete }) {
  const { ask } = useApp()
  const places = dest.places || []
  const [open, setOpen] = useState(false)
  const [pName, setPName] = useState('')
  const [pNote, setPNote] = useState('')
  const [notes, setNotes] = useState(dest.notes || '')
  const [rename, setRename] = useState(false)
  const [name, setName] = useState(dest.country)
  const [flag, setFlag] = useState(dest.flag)

  // مزامنة الملاحظات لو عدّلها الطرف الثاني
  useEffect(() => { setNotes(dest.notes || '') }, [dest.notes])

  const addPlace = () => {
    if (!norm(pName)) return
    const place = { id: genId(), name: norm(pName), notes: norm(pNote), visited: false }
    onUpdate({ places: [...places, place] })
    setPName(''); setPNote(''); setOpen(false)
    buzz()
  }
  const togglePlace = (id) => { buzz(); onUpdate({ places: places.map(p => p.id === id ? { ...p, visited: !p.visited } : p) }) }
  const delPlace = (id) => onUpdate({ places: places.filter(p => p.id !== id) })

  const visited = places.filter(p => p.visited).length

  return html`
    <div class="page">
      <button class="back" onClick=${onBack}><span>→</span> رجوع</button>

      <div class="detail-head">
        <div class="flag">${dest.flag}</div>
        <button class="detail-name" onClick=${() => { setName(dest.country); setFlag(dest.flag); setRename(true) }}>
          <h2>${dest.country} <small>✏️</small></h2>
        </button>
        <div class="status-row">
          ${Object.entries(STATUS).map(([k, v]) => html`
            <button
              key=${k}
              class=${'status-opt ' + (dest.status === k ? v.cls + ' active' : '')}
              onClick=${() => onUpdate({ status: k })}
            >${v.label}</button>
          `)}
        </div>
      </div>

      <div style=${{ marginBottom: '16px' }}>
        <div class="section-title">
          <h3>الأماكن 📍</h3>
          ${places.length > 0 && html`<span class="badge badge-gray">${visited}/${places.length}</span>`}
        </div>
        ${places.length > 0 && html`<${Progress} done=${visited} total=${places.length} tone="rose" />`}
        <div class="list">
          ${places.map(p => html`
            <div class=${'place' + (p.visited ? ' done' : '')} key=${p.id}>
              <button class=${'check' + (p.visited ? ' on' : '')} onClick=${() => togglePlace(p.id)}>
                ${p.visited ? '✓' : ''}
              </button>
              <div class="body">
                <p class="title">${p.name}</p>
                ${p.notes && html`<p class="note">${p.notes}</p>`}
              </div>
              <button class="icon-x" onClick=${() => delPlace(p.id)}>✕</button>
            </div>
          `)}
        </div>
        <button class="add-dashed" onClick=${() => setOpen(true)}>+ إضافة مكان</button>
      </div>

      <div>
        <div class="section-title"><h3>ملاحظات 📝</h3></div>
        <textarea
          class="notes-area"
          rows="4"
          dir="rtl"
          placeholder="أكتب خططكم وأفكاركم عن الرحلة..."
          value=${notes}
          onInput=${e => setNotes(e.target.value)}
          onBlur=${() => onUpdate({ notes })}
        ></textarea>
      </div>

      <button class="link-danger" onClick=${() => ask({
        title: `حذف «${dest.country}»؟`, text: 'بتنحذف الأماكن والملاحظات معها.', ok: 'حذف', danger: true,
        onOk: () => { onBack(); onDelete() },
      })}>🗑️ حذف الوجهة</button>

      ${open && html`
        <${Modal} title="إضافة مكان 📍" onClose=${() => setOpen(false)}>
          <input class="field" dir="rtl" autoFocus placeholder="اسم المكان..."
            value=${pName} onInput=${e => setPName(e.target.value)}
            style=${{ marginBottom: '12px' }} />
          <input class="field gray" dir="rtl" placeholder="ملاحظات (اختياري)..."
            value=${pNote} onInput=${e => setPNote(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && addPlace()}
            style=${{ marginBottom: '16px' }} />
          <div class="btn-row" style=${{ marginTop: 0 }}>
            <button class="btn btn-primary" disabled=${!norm(pName)} onClick=${addPlace}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => setOpen(false)}>إلغاء</button>
          </div>
        <//>
      `}

      ${rename && html`
        <${Modal} title="تعديل الوجهة ✏️" onClose=${() => setRename(false)}>
          <div class="row-gap">
            <input class="flag-input" value=${flag} onInput=${e => setFlag(e.target.value)} />
            <input class="field" dir="rtl" autoFocus value=${name}
              onInput=${e => { setName(e.target.value); if (FLAGS[norm(e.target.value)]) setFlag(FLAGS[norm(e.target.value)]) }} />
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" disabled=${!norm(name)}
              onClick=${() => { onUpdate({ country: norm(name), flag }); setRename(false) }}>حفظ</button>
            <button class="btn btn-ghost" onClick=${() => setRename(false)}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
  `
}

function Travel({ col }) {
  const { items, add, update, remove } = col
  const [selId, setSelId] = useState(null)
  const [open, setOpen] = useState(false)
  const [country, setCountry] = useState('')
  const [flag, setFlag] = useState('🌍')
  const [status, setStatus] = useState('planned')
  const [filter, setFilter] = useState('all')

  const selected = items.find(d => d.id === selId)

  const submit = () => {
    if (!norm(country)) return
    add({ country: norm(country), flag: FLAGS[norm(country)] || flag, status, places: [], notes: '' })
    setCountry(''); setFlag('🌍'); setStatus('planned'); setOpen(false)
    buzz()
  }
  const onCountry = (val) => {
    setCountry(val)
    if (FLAGS[norm(val)]) setFlag(FLAGS[norm(val)])
  }

  if (selected) {
    return html`<${CountryDetail}
      dest=${selected}
      onBack=${() => setSelId(null)}
      onUpdate=${(patch) => update(selected.id, patch)}
      onDelete=${() => remove(selected.id)}
    />`
  }

  const shown = filter === 'all' ? items : items.filter(d => (d.status || 'planned') === filter)

  return html`
    <div class="page">
      <div class="page-head">
        <h2>سفراتنا</h2>
        <span class="badge badge-rose">${items.length} وجهة</span>
      </div>

      ${items.length > 1 && html`
        <div class="chips">
          <button class=${'chip' + (filter === 'all' ? ' active rose' : '')} onClick=${() => setFilter('all')}>الكل</button>
          ${Object.entries(STATUS).map(([k, v]) => html`
            <button key=${k} class=${'chip' + (filter === k ? ' active rose' : '')} onClick=${() => setFilter(k)}>${v.label}</button>
          `)}
        </div>
      `}

      ${shown.length === 0
        ? html`<${Empty} emo="🗺️" text=${items.length ? 'ما فيه وجهات بهالحالة' : 'أضف أول وجهة سفر'}
            action=${items.length ? null : '+ وجهة جديدة'} onAction=${() => setOpen(true)} />`
        : html`
          <div class="grid">
            ${shown.map(d => {
              const st = STATUS[d.status] || STATUS.planned
              const places = d.places || []
              const visited = places.filter(p => p.visited).length
              return html`
                <div class="dest" key=${d.id} onClick=${() => setSelId(d.id)}>
                  <button class="icon-x del" onClick=${e => { e.stopPropagation(); remove(d.id) }}>✕</button>
                  <div class="flag">${d.flag}</div>
                  <div class="name">${d.country}</div>
                  <span class=${'status-pill ' + st.cls}>${st.label}</span>
                  ${places.length > 0 && html`<p class="meta">${visited}/${places.length} مكان</p>`}
                </div>
              `
            })}
          </div>
        `}

      <button class="fab fab-rose" onClick=${() => setOpen(true)}>+</button>

      ${open && html`
        <${Modal} title="وجهة جديدة 🌍" onClose=${() => setOpen(false)}>
          <div class="row-gap" style=${{ marginBottom: '16px' }}>
            <input class="flag-input" value=${flag} onInput=${e => setFlag(e.target.value)} />
            <input class="field" dir="rtl" autoFocus placeholder="اسم البلد أو المدينة..."
              value=${country} onInput=${e => onCountry(e.target.value)}
              onKeyDown=${e => e.key === 'Enter' && submit()} />
          </div>
          <p class="hint" style=${{ marginBottom: '12px' }}>العلم يتحدد تلقائياً للدول العربية والمعروفة 🏳️</p>
          <div class="status-pick" style=${{ marginBottom: '20px' }}>
            ${Object.entries(STATUS).map(([k, v]) => html`
              <button key=${k} class=${(status === k ? v.cls + ' active' : '')} onClick=${() => setStatus(k)}>
                ${v.label}
              </button>
            `)}
          </div>
          <div class="btn-row" style=${{ marginTop: 0 }}>
            <button class="btn btn-primary" disabled=${!norm(country)} onClick=${submit}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => setOpen(false)}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
  `
}

/* =========================== ٤) تجهيزات الشنطة =========================== */

function PackingList({ col }) {
  const { items, add, update, remove, replaceAll } = col
  const { ui, setUI, ask, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [fixed, setFixed] = useState(true)
  const [edit, setEdit] = useState(null)

  const submit = () => {
    const parts = name.split(/[،,\n]+/).map(norm).filter(Boolean)
    if (!parts.length) return
    const fresh = parts.map((n, i) => ({ id: genId(), createdAt: Date.now() + i, name: n, fixed, packed: false }))
    replaceAll([...items, ...fresh])
    setName('')
    setOpen(false)
    buzz()
  }

  const sortPacked = (arr) => [...arr].sort((a, b) => (a.packed ? 1 : 0) - (b.packed ? 1 : 0))
  const visible = (arr) => ui.hidePacked ? arr.filter(i => !i.packed) : arr
  const essentials = sortPacked(items.filter(i => i.fixed))
  const optional = sortPacked(items.filter(i => !i.fixed))
  const packed = items.filter(i => i.packed).length

  const newTrip = () => ask({
    title: 'رحلة جديدة؟',
    text: 'بنشيل كل علامات الصح عشان تعبّي من جديد — والأغراض تبقى محفوظة.',
    ok: 'يلا',
    onOk: () => {
      const prev = items
      replaceAll(items.map(i => ({ ...i, packed: false })))
      notify('🧳 جاهزين لرحلة جديدة', { label: '↩︎ تراجع', run: () => replaceAll(prev) })
    },
  })

  const renderGroup = (title, emo, arr, key) => {
    if (!arr.length) return null
    const shown = visible(arr)
    const off = ui.collapsed[key]
    return html`
      <div class="group" key=${key}>
        <button class="group-head" onClick=${() => setUI(prev => ({ collapsed: { ...prev.collapsed, [key]: !prev.collapsed[key] } }))}>
          <span class="group-title">${emo} ${title}</span>
          <span class="badge badge-gray">${arr.filter(i => i.packed).length}/${arr.length}</span>
          <span class=${'caret' + (off ? '' : ' open')}>⌄</span>
        </button>
        ${!off && html`
          <div class="list">
            ${shown.map(it => html`
              <div class=${'item' + (it.packed ? ' done' : '')} key=${it.id}>
                <button class=${'check' + (it.packed ? ' on' : '')} onClick=${() => { buzz(); update(it.id, { packed: !it.packed }) }}>
                  ${it.packed ? '✓' : ''}
                </button>
                <button class="body" onClick=${() => setEdit(it)}><p>${it.name}</p></button>
                <button class="icon-x" onClick=${() => remove(it.id)}>✕</button>
              </div>
            `)}
            ${shown.length === 0 && html`<p class="muted-note plain">كل شي بهالمجموعة انعبّى ✓</p>`}
          </div>
        `}
      </div>
    `
  }

  return html`
    <div class="page">
      <div class="page-head">
        <h2>تجهيزات الشنطة</h2>
        <div class="head-acts">
          ${items.length > 0 && html`
            <button class=${'head-btn' + (ui.hidePacked ? ' on' : '')} title="إخفاء المعبّى"
              onClick=${() => setUI({ hidePacked: !ui.hidePacked })}>${ui.hidePacked ? '🙈' : '👁️'}</button>
          `}
          ${items.length - packed > 0 && html`<span class="badge badge-rose">${items.length - packed} باقي</span>`}
        </div>
      </div>

      ${items.length > 0 && html`<${Progress} done=${packed} total=${items.length} tone="rose" />`}

      ${items.length > 0 && html`
        <button class="clear-btn rose" onClick=${newTrip}>🧳 تجهيز رحلة جديدة (تفريغ العلامات)</button>
      `}

      ${items.length === 0
        ? html`<${Empty} emo="🧳" text="أضف أغراض شنطتك" action="+ أول غرض" onAction=${() => setOpen(true)} />`
        : html`
          ${renderGroup('أساسيات ثابتة', '📌', essentials, 'pack_fixed')}
          ${renderGroup('حسب الرحلة', '🌤️', optional, 'pack_opt')}
        `}

      <button class="fab fab-rose" onClick=${() => setOpen(true)}>+</button>

      ${open && html`
        <${Modal} title="إضافة غرض 🧳" sub="تقدر تكتب عدة أغراض مفصولة بفاصلة" onClose=${() => { setOpen(false); setName('') }}>
          <input
            class="field"
            dir="rtl"
            autoFocus
            placeholder="اسم الغرض..."
            value=${name}
            onInput=${e => setName(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && submit()}
            style=${{ marginBottom: '16px' }}
          />
          <div class="cat-grid" style=${{ gridTemplateColumns: '1fr 1fr', marginBottom: '8px' }}>
            <button class=${'cat-opt' + (fixed ? ' active' : '')} onClick=${() => setFixed(true)}>
              📌<br/>أساسي ثابت
            </button>
            <button class=${'cat-opt' + (!fixed ? ' active' : '')} onClick=${() => setFixed(false)}>
              🌤️<br/>حسب الرحلة
            </button>
          </div>
          <p class="hint" style=${{ marginBottom: '20px' }}>الأساسيات تاخذها كل سفرة، و"حسب الرحلة" تتغيّر من وجهة لوجهة 🧳</p>
          <div class="btn-row" style=${{ marginTop: 0 }}>
            <button class="btn btn-primary" disabled=${!norm(name)} onClick=${submit}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => { setOpen(false); setName('') }}>إلغاء</button>
          </div>
        <//>
      `}

      ${edit && html`<${PackEditor} item=${edit} onClose=${() => setEdit(null)}
        onSave=${(patch) => { update(edit.id, patch); setEdit(null) }}
        onDelete=${() => { remove(edit.id); setEdit(null) }} />`}
    </div>
  `
}

function PackEditor({ item, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item.name)
  const [fixed, setFixed] = useState(!!item.fixed)
  const save = () => norm(name) && onSave({ name: norm(name), fixed })
  return html`
    <${Modal} title="تعديل الغرض ✏️" onClose=${onClose}>
      <input class="field" dir="rtl" autoFocus value=${name}
        onInput=${e => setName(e.target.value)} onKeyDown=${e => e.key === 'Enter' && save()}
        style=${{ marginBottom: '14px' }} />
      <div class="cat-grid" style=${{ gridTemplateColumns: '1fr 1fr', marginBottom: '8px' }}>
        <button class=${'cat-opt' + (fixed ? ' active' : '')} onClick=${() => setFixed(true)}>📌<br/>أساسي ثابت</button>
        <button class=${'cat-opt' + (!fixed ? ' active' : '')} onClick=${() => setFixed(false)}>🌤️<br/>حسب الرحلة</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" disabled=${!norm(name)} onClick=${save}>حفظ</button>
        <button class="btn btn-ghost" onClick=${onClose}>إلغاء</button>
      </div>
      <button class="link-danger" onClick=${onDelete}>🗑️ حذف الغرض</button>
    <//>
  `
}

/* =========================== الإعدادات =========================== */

function Settings({ onClose, theme, setTheme, tabs }) {
  const { ui, setUI, openCats, notify } = useApp()
  const hidden = ui.hiddenTabs || []
  const toggleTab = (id) => {
    const next = hidden.includes(id) ? hidden.filter(t => t !== id) : [...hidden, id]
    if (next.length >= tabs.length) { notify('لازم يبقى قسم واحد على الأقل 🙂'); return }
    setUI({ hiddenTabs: next })
  }
  return html`
    <${Modal} title="الإعدادات ⚙️" onClose=${onClose}>
      <p class="group-lbl">المظهر</p>
      <div class="seg">
        <button class=${theme === 'light' ? 'on' : ''} onClick=${() => setTheme('light')}>☀️ نهاري</button>
        <button class=${theme === 'dark' ? 'on' : ''} onClick=${() => setTheme('dark')}>🌙 ليلي</button>
      </div>

      <p class="group-lbl">الأقسام الظاهرة</p>
      ${tabs.map(t => html`
        <${OptRow} key=${t.id} icon=${t.emo} title=${t.label}
          on=${!hidden.includes(t.id)} onToggle=${() => toggleTab(t.id)} />
      `)}
      <p class="hint">الإخفاء يخصّ جهازك فقط — الطرف الثاني ما يتأثر 👌</p>

      <div class="sep"></div>
      <${ActRow} icon="🏷️" title="فئات المقاضي" desc="أضف أو أخفِ فئات" onClick=${() => { onClose(); openCats() }} />

      <div class="sep"></div>
      <p class="hint">${db ? '☁️ المزامنة الفورية شغالة بين الجهازين' : '💾 حالياً محلي على هذا الجهاز فقط'}</p>
    <//>
  `
}

/* =========================== التطبيق =========================== */

const TABS = [
  { id: 'rules', label: 'القواعد', emo: '💑' },
  { id: 'shopping', label: 'المقاضي', emo: '🛒' },
  { id: 'travel', label: 'السفر', emo: '✈️' },
  { id: 'packing', label: 'الشنطة', emo: '🧳' },
]

// معرّف البيت الثابت — التطبيق لشخصين فقط، فلا حاجة لشاشة إدخال الاسم
const FAMILY_ID = 'beytna'

function App() {
  const [tab, setTabState] = useState(() => localStorage.getItem('baytuna_tab') || 'shopping')
  const setTab = (id) => { setTabState(id); try { localStorage.setItem('baytuna_tab', id) } catch {} }
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('baytuna_theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const store = useFamilyStore(FAMILY_ID)
  const [ui, setUI] = useUI()
  const [settings, setSettings] = useState(false)
  const [catMgr, setCatMgr] = useState(false)
  const [confirmBox, setConfirmBox] = useState(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('baytuna_theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#16151a' : '#fdf4f0')
  }, [theme])
  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  // ---- ارتفاع الكيبورد: نرفع النوافذ فوقه حتى لا يختفي مكان الكتابة ----
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--kb', kb + 'px')
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize) }
  }, [])

  // ---- شريط التنبيهات (مع تراجع اختياري لمدة ١٠ ثواني) ----
  const [snack, setSnack] = useState(null) // { text, action:{label,run}, seq }
  const snackTimer = useRef(null)
  const seq = useRef(0)
  const notify = (text, action) => {
    seq.current++
    setSnack({ text, action, seq: seq.current })
    clearTimeout(snackTimer.current)
    snackTimer.current = setTimeout(() => setSnack(null), action ? 10000 : 3200)
  }
  const closeSnack = () => { clearTimeout(snackTimer.current); setSnack(null) }
  useEffect(() => () => clearTimeout(snackTimer.current), [])

  const shortLabel = (s) => (s.length > 24 ? s.slice(0, 24) + '…' : s)
  const requestUndo = (name, prevItems, item) => {
    const label = (item && (item.name || item.country || item.text)) || ''
    notify(`🗑️ تم الحذف${label ? ': ' + shortLabel(label) : ''}`, {
      label: '↩︎ تراجع',
      run: () => store.updateSection(name, prevItems),
    })
  }

  const ask = (opts) => setConfirmBox(opts)

  const prefs = (store.data && store.data.prefs) || {}
  const setPrefs = (patch) => store.updateSection('prefs', { ...prefs, ...patch })
  const cats = (prefs.cats && prefs.cats.length) ? prefs.cats : DEFAULT_CATS

  const visibleTabs = TABS.filter(t => !(ui.hiddenTabs || []).includes(t.id))
  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some(t => t.id === tab)) setTab(visibleTabs[0].id)
  }, [ui.hiddenTabs])

  if (!store.data) {
    return html`<div class="setup"><div class="setup-card">
      <div class="logo">🏡</div>
      <p class="sub">جاري المزامنة... ☁️</p>
    </div></div>`
  }

  const ctx = { cats, prefs, setPrefs, ui, setUI, ask, notify, openCats: () => setCatMgr(true) }

  return html`
    <${Ctx.Provider} value=${ctx}>
    <div class="app">
      <header class="header">
        <div class="header-brand">
          <span class="logo">🏡</span>
          <h1 class="display">بيتنا</h1>
          <span class="sync" title=${db ? 'مزامنة فورية مفعّلة' : 'محلي فقط'}>${db ? '☁️' : '💾'}</span>
        </div>
        <div class="header-acts">
          <button class="theme-toggle" onClick=${toggleTheme} title=${theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}>
            ${theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button class="theme-toggle" onClick=${() => setSettings(true)} title="الإعدادات">⚙️</button>
        </div>
      </header>

      <main class="main">
        ${tab === 'rules' && html`<${MarriageRules} col=${section(store, 'rules', requestUndo)} key="rules" />`}
        ${tab === 'shopping' && html`<${ShoppingList} col=${section(store, 'shopping', requestUndo)} key="shopping" />`}
        ${tab === 'travel' && html`<${Travel} col=${section(store, 'travel', requestUndo)} key="travel" />`}
        ${tab === 'packing' && html`<${PackingList} col=${section(store, 'packing', requestUndo)} key="packing" />`}
      </main>

      ${snack && html`
        <div class="snackbar" key=${snack.seq} style=${{ '--snack-ms': (snack.action ? 10000 : 3200) + 'ms' }}>
          <span class="snackbar-txt">${snack.text}</span>
          ${snack.action
            ? html`<button class="snackbar-btn" onClick=${() => { snack.action.run(); closeSnack() }}>${snack.action.label}</button>`
            : html`<button class="snackbar-btn" onClick=${closeSnack}>تمام</button>`}
        </div>
      `}

      <nav class="nav">
        <div class="nav-inner">
          ${visibleTabs.map(t => html`
            <button key=${t.id} class=${'nav-btn' + (tab === t.id ? ' active' : '')} onClick=${() => { buzz(4); setTab(t.id) }}>
              ${tab === t.id && html`<span class="tab-line"></span>`}
              <span class="emo">${t.emo}</span>
              <span class="lbl">${t.label}</span>
            </button>
          `)}
        </div>
      </nav>

      ${settings && html`<${Settings} onClose=${() => setSettings(false)} theme=${theme} setTheme=${setTheme} tabs=${TABS} />`}
      ${catMgr && html`<${CategoryManager} onClose=${() => setCatMgr(false)} />`}

      ${confirmBox && html`
        <${Modal} title=${confirmBox.title} onClose=${() => setConfirmBox(null)}>
          ${confirmBox.text && html`<p class="sheet-p">${confirmBox.text}</p>`}
          <div class="btn-row">
            <button class=${'btn ' + (confirmBox.danger ? 'btn-danger' : 'btn-primary')}
              onClick=${() => { const f = confirmBox.onOk; setConfirmBox(null); f && f() }}>
              ${confirmBox.ok || 'تأكيد'}
            </button>
            <button class="btn btn-ghost" onClick=${() => setConfirmBox(null)}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
    <//>
  `
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`)
