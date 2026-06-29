import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"
import {
  getFirestore, doc, onSnapshot, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"

const { useState, useEffect, useRef } = React
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

const SECTIONS = ['rules', 'shopping', 'travel']
const EMPTY = { rules: [], shopping: [], travel: [] }
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/* ---- تخزين محلي احتياطي (يُستخدم لو فشل Firebase أو بدون إنترنت) ---- */
const Local = {
  read(familyId) {
    const d = { ...EMPTY }
    for (const s of SECTIONS) {
      try { d[s] = JSON.parse(localStorage.getItem(`baytuna_${s}_${familyId}`) || '[]') } catch {}
    }
    return d
  },
  write(familyId, section, items) {
    localStorage.setItem(`baytuna_${section}_${familyId}`, JSON.stringify(items))
  },
}

/* =========================================================================
   المتجر المركزي: مستند واحد لكل عائلة في Firestore (families/{familyId})
   يحوي الأقسام الثلاثة. onSnapshot = تحديث لحظي عند أي طرف.
   ========================================================================= */
function useFamilyStore(familyId) {
  const [data, setData] = useState(null) // null = جاري التحميل
  const ref = useRef({ ...EMPTY })

  useEffect(() => {
    if (!familyId) { setData(null); return }

    if (db) {
      const docRef = doc(db, 'families', familyId)
      const unsub = onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
          const d = { ...EMPTY, ...snap.data() }
          ref.current = d
          setData(d)
        } else {
          setDoc(docRef, { ...EMPTY }).catch(e => console.error(e))
          ref.current = { ...EMPTY }
          setData({ ...EMPTY })
        }
      }, (err) => {
        console.error('Firestore error — using local', err)
        const d = Local.read(familyId)
        ref.current = d
        setData(d)
      })
      return unsub
    } else {
      const d = Local.read(familyId)
      ref.current = d
      setData(d)
    }
  }, [familyId])

  const updateSection = (section, items) => {
    const next = { ...ref.current, [section]: items }
    ref.current = next
    setData(next) // تحديث تفاؤلي فوري
    if (db) {
      updateDoc(doc(db, 'families', familyId), { [section]: items }).catch(e => console.error(e))
    } else {
      Local.write(familyId, section, items)
    }
  }

  return { data, updateSection }
}

// واجهة قسم واحد بنفس الـAPI القديمة (items/add/update/remove/replaceAll)
function section(store, name) {
  const items = (store.data && store.data[name]) || []
  return {
    items,
    add: (d) => store.updateSection(name, [...items, { id: genId(), createdAt: Date.now(), ...d }]),
    update: (id, patch) => store.updateSection(name, items.map(it => it.id === id ? { ...it, ...patch } : it)),
    remove: (id) => store.updateSection(name, items.filter(it => it.id !== id)),
    replaceAll: (next) => store.updateSection(name, next),
  }
}

/* =========================== مكونات مساعدة =========================== */

function Modal({ title, onClose, children }) {
  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="sheet" onClick=${e => e.stopPropagation()}>
        <h3>${title}</h3>
        ${children}
      </div>
    </div>
  `
}

function Empty({ emo, text }) {
  return html`<div class="empty"><div class="emo">${emo}</div><p>${text}</p></div>`
}

/* =========================== ١) قواعد الزواج =========================== */

function MarriageRules({ col }) {
  const { items, add, remove } = col
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const submit = () => {
    if (!text.trim()) return
    add({ text: text.trim() })
    setText('')
    setOpen(false)
  }

  return html`
    <div class="page">
      <div class="page-head">
        <h2>قواعد زواجنا</h2>
        <span class="badge badge-rose">${items.length} قاعدة</span>
      </div>

      ${items.length === 0
        ? html`<${Empty} emo="💌" text="أضف أول قاعدة لزواجكم" />`
        : html`
          <div class="list">
            ${items.map((r, i) => html`
              <div class="card rule" key=${r.id}>
                <span class="num">${i + 1}</span>
                <p>${r.text}</p>
                <button class="icon-x" onClick=${() => remove(r.id)}>✕</button>
              </div>
            `)}
          </div>
        `}

      <button class="fab fab-rose" onClick=${() => setOpen(true)}>+</button>

      ${open && html`
        <${Modal} title="قاعدة جديدة ✨" onClose=${() => { setOpen(false); setText('') }}>
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
            <button class="btn btn-primary" disabled=${!text.trim()} onClick=${submit}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => { setOpen(false); setText('') }}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
  `
}

/* =========================== ٢) مقاضي البيت =========================== */

const CATS = [
  { id: 'food', label: 'مواد غذائية', icon: '🥦' },
  { id: 'home', label: 'منزليات', icon: '🏠' },
  { id: 'clothes', label: 'ملابس', icon: '👕' },
  { id: 'tech', label: 'إلكترونيات', icon: '📱' },
  { id: 'other', label: 'أخرى', icon: '📦' },
]
const catOf = (id) => CATS.find(c => c.id === id) || CATS[4]

function ShoppingList({ col }) {
  const { items, add, update, remove, replaceAll } = col
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [cat, setCat] = useState('food')
  const [filter, setFilter] = useState('all')

  const submit = () => {
    if (!name.trim()) return
    add({ name: name.trim(), category: cat, completed: false })
    setName('')
    setOpen(false)
  }

  const sorted = [...items].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0))
  const filtered = filter === 'all' ? sorted : sorted.filter(i => i.category === filter)
  const pending = items.filter(i => !i.completed).length
  const completed = items.filter(i => i.completed)

  return html`
    <div class="page">
      <div class="page-head">
        <h2>مقاضي البيت</h2>
        ${pending > 0 && html`<span class="badge badge-amber">${pending} باقي</span>`}
      </div>

      <div class="chips">
        <button class=${'chip' + (filter === 'all' ? ' active' : '')} onClick=${() => setFilter('all')}>الكل</button>
        ${CATS.map(c => html`
          <button key=${c.id} class=${'chip' + (filter === c.id ? ' active' : '')} onClick=${() => setFilter(c.id)}>
            ${c.icon} ${c.label}
          </button>
        `)}
      </div>

      ${completed.length > 0 && html`
        <button class="clear-btn" onClick=${() => replaceAll(items.filter(i => !i.completed))}>
          🗑️ حذف المكتملة (${completed.length})
        </button>
      `}

      ${filtered.length === 0
        ? html`<${Empty} emo="🛍️" text="لا يوجد عناصر" />`
        : html`
          <div class="list">
            ${filtered.map(it => {
              const c = catOf(it.category)
              return html`
                <div class=${'item' + (it.completed ? ' done' : '')} key=${it.id}>
                  <button class=${'check' + (it.completed ? ' on' : '')} onClick=${() => update(it.id, { completed: !it.completed })}>
                    ${it.completed ? '✓' : ''}
                  </button>
                  <div class="body">
                    <p>${it.name}</p>
                    <span>${c.icon} ${c.label}</span>
                  </div>
                  <button class="icon-x" onClick=${() => remove(it.id)}>✕</button>
                </div>
              `
            })}
          </div>
        `}

      <button class="fab fab-amber" onClick=${() => setOpen(true)}>+</button>

      ${open && html`
        <${Modal} title="إضافة غرض 🛍️" onClose=${() => { setOpen(false); setName('') }}>
          <input
            class="field amber"
            dir="rtl"
            autoFocus
            placeholder="اسم الغرض..."
            value=${name}
            onInput=${e => setName(e.target.value)}
            onKeyDown=${e => e.key === 'Enter' && submit()}
            style=${{ marginBottom: '16px' }}
          />
          <div class="cat-grid" style=${{ marginBottom: '20px' }}>
            ${CATS.map(c => html`
              <button key=${c.id} class=${'cat-opt' + (cat === c.id ? ' active' : '')} onClick=${() => setCat(c.id)}>
                ${c.icon}<br/>${c.label}
              </button>
            `)}
          </div>
          <div class="btn-row" style=${{ marginTop: 0 }}>
            <button class="btn btn-primary amber" disabled=${!name.trim()} onClick=${submit}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => { setOpen(false); setName('') }}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
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

function CountryDetail({ dest, onBack, onUpdate }) {
  const places = dest.places || []
  const [open, setOpen] = useState(false)
  const [pName, setPName] = useState('')
  const [pNote, setPNote] = useState('')
  const [notes, setNotes] = useState(dest.notes || '')

  // مزامنة الملاحظات لو عدّلها الطرف الثاني
  useEffect(() => { setNotes(dest.notes || '') }, [dest.notes])

  const addPlace = () => {
    if (!pName.trim()) return
    const place = { id: Date.now().toString(), name: pName.trim(), notes: pNote.trim(), visited: false }
    onUpdate({ places: [...places, place] })
    setPName(''); setPNote(''); setOpen(false)
  }
  const togglePlace = (id) => onUpdate({ places: places.map(p => p.id === id ? { ...p, visited: !p.visited } : p) })
  const delPlace = (id) => onUpdate({ places: places.filter(p => p.id !== id) })

  const visited = places.filter(p => p.visited).length

  return html`
    <div class="page">
      <button class="back" onClick=${onBack}><span>→</span> رجوع</button>

      <div class="detail-head">
        <div class="flag">${dest.flag}</div>
        <h2>${dest.country}</h2>
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
            <button class="btn btn-primary" disabled=${!pName.trim()} onClick=${addPlace}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => setOpen(false)}>إلغاء</button>
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

  const selected = items.find(d => d.id === selId)

  const submit = () => {
    if (!country.trim()) return
    add({ country: country.trim(), flag: FLAGS[country.trim()] || flag, status, places: [], notes: '' })
    setCountry(''); setFlag('🌍'); setStatus('planned'); setOpen(false)
  }
  const onCountry = (val) => {
    setCountry(val)
    if (FLAGS[val.trim()]) setFlag(FLAGS[val.trim()])
  }

  if (selected) {
    return html`<${CountryDetail}
      dest=${selected}
      onBack=${() => setSelId(null)}
      onUpdate=${(patch) => update(selected.id, patch)}
    />`
  }

  return html`
    <div class="page">
      <div class="page-head">
        <h2>سفراتنا</h2>
        <span class="badge badge-rose">${items.length} وجهة</span>
      </div>

      ${items.length === 0
        ? html`<${Empty} emo="🗺️" text="أضف أول وجهة سفر" />`
        : html`
          <div class="grid">
            ${items.map(d => {
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
            <button class="btn btn-primary" disabled=${!country.trim()} onClick=${submit}>إضافة</button>
            <button class="btn btn-ghost" onClick=${() => setOpen(false)}>إلغاء</button>
          </div>
        <//>
      `}
    </div>
  `
}

/* =========================== شاشة الإعداد =========================== */

function SetupScreen({ onSetup }) {
  const [name, setName] = useState('')
  return html`
    <div class="setup">
      <div class="setup-card">
        <div class="logo">🏡</div>
        <h1 class="display">بيتنا</h1>
        <p class="sub">تطبيقكم المشترك ❤️</p>
        <div class="warn">
          <div class="t">☁️ مزامنة فورية مفعّلة</div>
          <div class="d">اكتبوا نفس اسم البيت أنت وزوجتك على أي جهاز، وكل شي يتزامن بينكم لحظياً.</div>
        </div>
        <form class="setup-form" onSubmit=${e => { e.preventDefault(); if (name.trim()) onSetup(name.trim()) }}>
          <input class="field" dir="rtl" placeholder="اسم بيتكم (مثال: بيت محمد)"
            value=${name} onInput=${e => setName(e.target.value)} />
          <button type="submit" class="btn btn-primary" disabled=${!name.trim()} style=${{ padding: '14px' }}>
            ابدأ ✨
          </button>
        </form>
      </div>
    </div>
  `
}

/* =========================== التطبيق =========================== */

const TABS = [
  { id: 'rules', label: 'القواعد', emo: '💑' },
  { id: 'shopping', label: 'المقاضي', emo: '🛒' },
  { id: 'travel', label: 'السفر', emo: '✈️' },
]

function App() {
  const [familyId, setFamilyId] = useState(() => localStorage.getItem('baytuna_family_id'))
  const [tab, setTab] = useState('rules')
  const store = useFamilyStore(familyId)

  const setup = (id) => {
    localStorage.setItem('baytuna_family_id', id)
    setFamilyId(id)
  }
  const logout = () => {
    if (confirm('تبي تغيّر اسم البيت؟ بياناتك تبقى محفوظة.')) {
      localStorage.removeItem('baytuna_family_id')
      setFamilyId(null)
    }
  }

  if (!familyId) return html`<${SetupScreen} onSetup=${setup} />`

  if (!store.data) {
    return html`<div class="setup"><div class="setup-card">
      <div class="logo">🏡</div>
      <p class="sub">جاري المزامنة... ☁️</p>
    </div></div>`
  }

  return html`
    <div class="app">
      <header class="header">
        <div class="header-brand">
          <span class="logo">🏡</span>
          <h1 class="display">بيتنا</h1>
          <span class="sync" title=${db ? 'مزامنة فورية مفعّلة' : 'محلي فقط'}>${db ? '☁️' : '💾'}</span>
        </div>
        <button class="header-fam" onClick=${logout}>
          <span>${familyId}</span><span>⚙️</span>
        </button>
      </header>

      <main class="main">
        ${tab === 'rules' && html`<${MarriageRules} col=${section(store, 'rules')} key="rules" />`}
        ${tab === 'shopping' && html`<${ShoppingList} col=${section(store, 'shopping')} key="shopping" />`}
        ${tab === 'travel' && html`<${Travel} col=${section(store, 'travel')} key="travel" />`}
      </main>

      <nav class="nav">
        <div class="nav-inner">
          ${TABS.map(t => html`
            <button key=${t.id} class=${'nav-btn' + (tab === t.id ? ' active' : '')} onClick=${() => setTab(t.id)}>
              ${tab === t.id && html`<span class="tab-line"></span>`}
              <span class="emo">${t.emo}</span>
              <span class="lbl">${t.label}</span>
            </button>
          `)}
        </div>
      </nav>
    </div>
  `
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`)
