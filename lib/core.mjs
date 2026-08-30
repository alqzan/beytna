// lib/core.mjs — منطق صِرف بلا اعتماد على DOM/React/Firestore، يُستورد من index.html
// وأيضاً من اختبارات الوحدة (tests/unit) مباشرة عبر Node. يعمل في المتصفح وNode بلا تغيير
// لأن Web Crypto (crypto.getRandomValues / crypto.subtle) متوفرة في كليهما.

export const norm = (s) => (s || '').trim().replace(/\s+/g, ' ')

export const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** بايتات عشوائية قوية cryptographically، كنص hex. familyId = randomHex(16) (32 حرف hex). */
export function randomHex(nBytes) {
  const bytes = new Uint8Array(nBytes)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** تنسيق رمز hex لعرض/طباعة أسهل (لا يؤثر على القيمة الفعلية المُرسَلة). */
export const formatToken = (t) => (t.match(/.{1,4}/g) || [t]).join('-')
export const unformatToken = (t) => (t || '').replace(/[^0-9a-f]/gi, '').toLowerCase()

/**
 * فرق التغييرات بين القائمة الحالية الكاملة (allItems — تشمل المحذوف حذفاً ناعماً)
 * والقائمة المطلوبة (nextItems) لغرض بديل عن "استبدال المصفوفة بالكامل". يُستخدم في
 * useShoppingCollection.replaceAll لتحويل addMany/clearDone/clearAll إلى كتابات لكل
 * وثيقة على حدة (create/update/soft-delete) بدل الكتابة فوق القائمة كاملة، حتى لا يمحو
 * تعديلاً متزامناً من الجهاز الآخر لعنصر لم يتغيّر هنا. دالة صِرفة (pure) لسهولة الاختبار.
 */
export function diffShoppingUpdates(allItems, nextItems) {
  const allById = new Map(allItems.map((it) => [it.id, it]))
  const nextIds = new Set(nextItems.map((it) => it.id))
  const creates = []
  const updates = []
  const softDeletes = []

  for (const it of nextItems) {
    const before = allById.get(it.id)
    const payload = {
      name: it.name,
      category: it.category || 'other',
      completed: !!it.completed,
      qty: it.qty || 1,
      note: it.note || '',
    }
    if (!before) {
      creates.push({ id: it.id, ...payload })
    } else {
      const changed =
        !!before.deletedAt ||
        before.name !== payload.name ||
        (before.category || 'other') !== payload.category ||
        !!before.completed !== payload.completed ||
        (before.qty || 1) !== payload.qty ||
        (before.note || '') !== payload.note
      if (changed) updates.push({ id: it.id, ...payload })
    }
  }
  for (const it of allItems) {
    if (!it.deletedAt && !nextIds.has(it.id)) softDeletes.push({ id: it.id })
  }
  return { creates, updates, softDeletes }
}

/* ---------------------------------------------------------------------- *
 * نسخ احتياطي: schemaVersion + exportedAt + checksum. لا نُصدّر أسرار Auth
 * ولا وثائق العضوية/الدعوات — فقط محتوى العائلة (الأقسام + المقاضي).
 * ---------------------------------------------------------------------- */
export const BACKUP_SCHEMA_VERSION = 1

export async function buildBackup(familyData, shoppingItems, familyId) {
  const sourcePrefs = (familyData && familyData.prefs && typeof familyData.prefs === 'object')
    ? familyData.prefs
    : {}
  const prefs = Object.fromEntries(
    ['cats', 'tabs', 'freq']
      .filter((key) => sourcePrefs[key] !== undefined)
      .map((key) => [key, sourcePrefs[key]])
  )
  const data = {
    sections: (familyData && familyData.sections) || {},
    prefs,
    shopping: (shoppingItems || []).map(({ id, name, category, completed, qty, note }) => ({
      id, name, category, completed: !!completed, qty: qty || 1, note: note || '',
    })),
  }
  const checksum = await sha256Hex(JSON.stringify(data))
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: new Date().toISOString(), familyId, data, checksum }
}

/** يرمي خطأ واضح (لا يقرأ بصمت) عند JSON غير صالح، schema غير مدعوم، أو checksum غير مطابق. */
export async function parseBackup(text) {
  let json
  try { json = JSON.parse(text) } catch { throw new Error('الملف ليس JSON صالحاً') }
  if (!json || typeof json !== 'object') throw new Error('محتوى الملف غير متوقّع')
  if (json.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`نسخة ملف غير مدعومة (schemaVersion=${json.schemaVersion}) — هذا الإصدار يدعم ${BACKUP_SCHEMA_VERSION} فقط`)
  }
  if (!json.data || typeof json.data !== 'object') throw new Error('الملف لا يحتوي بيانات')
  const expected = await sha256Hex(JSON.stringify(json.data))
  if (expected !== json.checksum) throw new Error('الملف تالف أو مُعدَّل يدوياً — checksum غير مطابق')
  return json
}

/**
 * يبني تصحيحات (patches) للدمج/الاستبدال من نسخة احتياطية — صِرفة، لا تكتب بنفسها.
 * mode: 'merge' يضيف فوق الحالي بمعرّفات جديدة، 'replace' يستبدل القسم بالكامل.
 */
export function planImport(currentSections, currentShoppingItems, backupData, mode, currentPrefs = {}) {
  const sectionPatches = {} // { sectionKey: newArray }
  for (const [key, arr] of Object.entries(backupData.sections || {})) {
    if (!Array.isArray(arr)) continue
    const fresh = arr.map((it) => ({ ...it, id: genId() }))
    sectionPatches[key] = mode === 'replace' ? fresh : [...((currentSections || {})[key] || []), ...fresh]
  }
  let shoppingNext = null
  if (Array.isArray(backupData.shopping)) {
    const fresh = backupData.shopping.map((it) => ({ ...it, id: genId() }))
    shoppingNext = mode === 'replace' ? fresh : [...(currentShoppingItems || []), ...fresh]
  }

  const incomingPrefs = (backupData.prefs && typeof backupData.prefs === 'object' && !Array.isArray(backupData.prefs))
    ? backupData.prefs
    : {}
  let prefsNext = null
  if (Object.keys(incomingPrefs).length > 0) {
    if (mode === 'replace') {
      prefsNext = { ...incomingPrefs }
    } else {
      prefsNext = { ...currentPrefs }
      for (const [key, value] of Object.entries(incomingPrefs)) {
        if ((key === 'cats' || key === 'tabs') && Array.isArray(value)) {
          const current = Array.isArray(prefsNext[key]) ? prefsNext[key] : []
          const merged = [...current]
          for (const item of value) {
            const index = item && item.id ? merged.findIndex((existing) => existing && existing.id === item.id) : -1
            if (index >= 0) merged[index] = { ...merged[index], ...item }
            else merged.push(item)
          }
          prefsNext[key] = merged
        } else if (key === 'freq' && value && typeof value === 'object' && !Array.isArray(value)) {
          prefsNext[key] = { ...(prefsNext.freq || {}), ...value }
        } else {
          prefsNext[key] = value
        }
      }
    }
  }
  return { sectionPatches, shoppingNext, prefsNext }
}
