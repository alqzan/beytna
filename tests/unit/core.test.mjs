import { describe, expect, it } from 'vitest'
import {
  randomHex, diffShoppingUpdates,
  buildBackup, parseBackup, planImport, sha256Hex, BACKUP_SCHEMA_VERSION,
} from '../../lib/core.mjs'

describe('randomHex', () => {
  it('ينتج معرّفات قوية وفريدة بالطول المطلوب', () => {
    const a = randomHex(16)
    const b = randomHex(16)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('diffShoppingUpdates — منع استبدال المصفوفة كاملة', () => {
  const base = [
    { id: 'a', name: 'حليب', category: 'food', completed: false, qty: 1, note: '' },
    { id: 'b', name: 'خبز', category: 'food', completed: false, qty: 2, note: '' },
  ]

  it('لا ينتج أي عملية عندما لا يتغيّر شيء', () => {
    const { creates, updates, softDeletes } = diffShoppingUpdates(base, base)
    expect(creates).toEqual([])
    expect(updates).toEqual([])
    expect(softDeletes).toEqual([])
  })

  it('يكتشف عنصراً جديداً فقط دون لمس البقية (لا يمحو تعديل الطرف الآخر)', () => {
    const next = [...base, { id: 'c', name: 'جبن', category: 'food', completed: false, qty: 1, note: '' }]
    const { creates, updates, softDeletes } = diffShoppingUpdates(base, next)
    expect(creates).toEqual([{ id: 'c', name: 'جبن', category: 'food', completed: false, qty: 1, note: '' }])
    expect(updates).toEqual([])
    expect(softDeletes).toEqual([])
  })

  it('يكتشف تعديل عنصر واحد فقط (مثال: تعليم "خلص")', () => {
    const next = base.map((it) => (it.id === 'b' ? { ...it, completed: true } : it))
    const { creates, updates, softDeletes } = diffShoppingUpdates(base, next)
    expect(creates).toEqual([])
    expect(updates.map((u) => u.id)).toEqual(['b'])
    expect(updates[0].completed).toBe(true)
    expect(softDeletes).toEqual([])
  })

  it('عنصر غائب عن next يُحذف حذفاً ناعماً فقط', () => {
    const next = base.filter((it) => it.id !== 'a')
    const { creates, updates, softDeletes } = diffShoppingUpdates(base, next)
    expect(creates).toEqual([])
    expect(updates).toEqual([])
    expect(softDeletes).toEqual([{ id: 'a' }])
  })

  it('استرجاع (تراجع) عنصر محذوف ناعماً بنفس المعرّف يُعامَل كتحديث (يحافظ على createdAt الأصلي) لا إنشاء جديد', () => {
    const allWithTombstone = [...base, { id: 'z', name: 'بيض', category: 'food', completed: false, qty: 1, note: '', deletedAt: 999 }]
    const next = [...base, { id: 'z', name: 'بيض', category: 'food', completed: false, qty: 1, note: '' }]
    const { creates, updates } = diffShoppingUpdates(allWithTombstone, next)
    expect(creates).toEqual([])
    expect(updates.map((u) => u.id)).toEqual(['z'])
  })
})

describe('نسخة احتياطية: build/parse/checksum', () => {
  const familyData = {
    sections: { rules: [{ id: 'r1', text: 'قاعدة تجريبية وهمية' }], travel: [], packing: [] },
    prefs: { cats: [{ id: 'custom', label: 'مخصص', icon: '⭐' }] },
  }
  const shoppingItems = [{ id: 's1', name: 'أرز', category: 'food', completed: false, qty: 3, note: '' }]

  it('يبني نسخة صالحة يمكن تحليلها مرة أخرى', async () => {
    const backup = await buildBackup(familyData, shoppingItems, 'fake-family-id-for-tests')
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/)
    const parsed = await parseBackup(JSON.stringify(backup))
    expect(parsed.data.shopping[0].name).toBe('أرز')
    expect(parsed.data.prefs.cats[0].label).toBe('مخصص')
  })

  it('يرفض checksum تالف (تعديل يدوي للملف)', async () => {
    const backup = await buildBackup(familyData, shoppingItems, 'fid')
    backup.data.shopping[0].name = 'تم التلاعب'
    await expect(parseBackup(JSON.stringify(backup))).rejects.toThrow(/checksum/)
  })

  it('يرفض schemaVersion غير معروف بصمت لا، برسالة صريحة', async () => {
    const backup = await buildBackup(familyData, shoppingItems, 'fid')
    backup.schemaVersion = 999
    await expect(parseBackup(JSON.stringify(backup))).rejects.toThrow(/schemaVersion/)
  })

  it('يرفض JSON غير صالح', async () => {
    await expect(parseBackup('{ not valid json')).rejects.toThrow(/JSON/)
  })

  it('يحوّل النسخة الخام القديمة إلى نسخة استيراد تلقائياً', async () => {
    const raw = {
      rules: [{ id: 'r-old', text: 'قديم' }], travel: [], packing: [],
      shopping: [{ id: 's-old', name: 'أرز', category: 'food', completed: false }],
      prefs: { cats: [{ id: 'custom', label: 'مخصص', icon: '⭐' }] },
    }
    const parsed = await parseBackup(JSON.stringify({
      schemaVersion: 'legacy-raw-1', familyId: 'beytna', exportedAt: new Date().toISOString(),
      raw, checksum: await sha256Hex(JSON.stringify(raw)),
    }))
    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(parsed.data.sections.rules[0].text).toBe('قديم')
    expect(parsed.data.shopping[0].name).toBe('أرز')
    expect(parsed.data.prefs.cats[0].label).toBe('مخصص')
  })

  it('يرفض النسخة الخام إذا تغيّر checksum', async () => {
    const raw = { rules: [], travel: [], packing: [], shopping: [], prefs: {} }
    await expect(parseBackup(JSON.stringify({
      schemaVersion: 'legacy-raw-1', raw, checksum: '0'.repeat(64),
    }))).rejects.toThrow(/checksum/)
  })
})

describe('planImport — دمج مقابل استبدال', () => {
  const currentSections = { rules: [{ id: 'r1', text: 'موجود' }] }
  const currentShopping = [{ id: 's1', name: 'موجود', category: 'food', completed: false, qty: 1, note: '' }]
  const backupData = {
    sections: { rules: [{ id: 'old', text: 'من النسخة' }] },
    prefs: { cats: [{ id: 'custom', label: 'من النسخة', icon: '⭐' }] },
    shopping: [{ id: 'old', name: 'من النسخة', category: 'food', completed: false, qty: 1, note: '' }],
  }

  it('الدمج يضيف فوق الحالي دون حذفه', () => {
    const { sectionPatches, shoppingNext, prefsNext } = planImport(currentSections, currentShopping, backupData, 'merge')
    expect(sectionPatches.rules).toHaveLength(2)
    expect(shoppingNext).toHaveLength(2)
    expect(prefsNext.cats[0].label).toBe('من النسخة')
  })

  it('الاستبدال يستخدم محتوى النسخة فقط', () => {
    const { sectionPatches, shoppingNext } = planImport(currentSections, currentShopping, backupData, 'replace')
    expect(sectionPatches.rules).toHaveLength(1)
    expect(sectionPatches.rules[0].text).toBe('من النسخة')
    expect(shoppingNext).toHaveLength(1)
  })

  it('المعرّفات المستوردة تُجدَّد لتفادي تصادمها مع IDs محلية', () => {
    const { sectionPatches } = planImport(currentSections, currentShopping, backupData, 'merge')
    expect(sectionPatches.rules.find((r) => r.text === 'من النسخة').id).not.toBe('old')
  })
})
