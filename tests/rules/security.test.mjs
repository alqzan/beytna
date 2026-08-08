// اختبارات قواعد الإنتاج ضد Firebase Emulator — لا بيانات إنتاج، لا أسرار حقيقية.
// شغّلها عبر: npm run test:rules  (يشغّل المحاكي تلقائياً عبر firebase emulators:exec)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'

const PROJECT_ID = 'demo-beytna'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

/* ---- أدوات اختبار: بيانات وهمية فقط، لا علاقة لها ببيانات حقيقية ---- */
const strongFamilyId = () => randomBytes(16).toString('hex') // 32 حرف hex — يطابق isStrongFamilyId
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex')
const randomInviteToken = () => randomBytes(16).toString('hex')

async function createFamilyAs(uid, familyId) {
  const ctx = testEnv.authenticatedContext(uid)
  const db = ctx.firestore()
  await assertSucceeds(setDoc(doc(db, 'families', familyId), {
    schemaVersion: 2,
    ownerUid: uid,
    createdAt: serverTimestamp(),
    sections: { rules: [], travel: [], packing: [] }, prefs: {},
  }))
  await assertSucceeds(setDoc(doc(db, 'families', familyId, 'members', uid), {
    uid, role: 'owner', joinedAt: serverTimestamp(), deviceLabel: 'جهاز الاختبار ١',
  }))
  return { ctx, db }
}

async function createInviteAs(uid, familyId, { hoursValid = 1 } = {}) {
  const ctx = testEnv.authenticatedContext(uid)
  const db = ctx.firestore()
  const token = randomInviteToken()
  const tokenHash = sha256Hex(token)
  await assertSucceeds(setDoc(doc(db, 'families', familyId, 'invites', tokenHash), {
    createdBy: uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + hoursValid * 3600 * 1000),
    used: false, usedBy: null, usedAt: null,
  }))
  return { token, tokenHash }
}

async function redeemInviteAs(uid, familyId, tokenHash) {
  const ctx = testEnv.authenticatedContext(uid)
  const db = ctx.firestore()
  await assertSucceeds(setDoc(doc(db, 'families', familyId, 'members', uid), {
    uid, role: 'member', joinedAt: serverTimestamp(), deviceLabel: 'جهاز الاختبار ٢',
    joinedViaInvite: tokenHash,
  }))
  await assertSucceeds(updateDoc(doc(db, 'families', familyId, 'invites', tokenHash), {
    used: true, usedBy: uid, usedAt: serverTimestamp(),
  }))
  return { ctx, db }
}

describe('P0 — الوصول العام والعضوية', () => {
  it('مستخدم غير مصادق لا يقرأ مستند عائلة موجود ولا يكتب فيه', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)

    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'families', familyId)))
    await assertFails(setDoc(doc(anon, 'families', familyId, 'members', 'x'), { uid: 'x' }))
    await assertFails(getDocs(collection(anon, 'families', familyId, 'shopping')))
  })

  it('مستخدم مصادق (anonymous) لكنه غير عضو لا يقرأ ولا يكتب في عائلة غيره', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)

    const stranger = testEnv.authenticatedContext('stranger-1').firestore()
    await assertFails(getDoc(doc(stranger, 'families', familyId)))
    await assertFails(getDocs(collection(stranger, 'families', familyId, 'shopping')))
    await assertFails(setDoc(doc(stranger, 'families', familyId, 'shopping', 'item1'), {
      name: 'حليب', category: 'food', completed: false, qty: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'stranger-1', deletedAt: null,
    }))
    // ولا يقدر يمنح نفسه عضوية لمجرد معرفته بـ familyId
    await assertFails(setDoc(doc(stranger, 'families', familyId, 'members', 'stranger-1'), {
      uid: 'stranger-1', role: 'member', joinedAt: serverTimestamp(), deviceLabel: 'x',
    }))
  })

  it('عضو في عائلة A لا يصل إلى عائلة B', async () => {
    const familyA = strongFamilyId()
    const familyB = strongFamilyId()
    await createFamilyAs('user-a', familyA)
    await createFamilyAs('user-b', familyB)

    const aCtx = testEnv.authenticatedContext('user-a').firestore()
    await assertFails(getDoc(doc(aCtx, 'families', familyB)))
    await assertFails(getDocs(collection(aCtx, 'families', familyB, 'members')))
    await assertFails(setDoc(doc(aCtx, 'families', familyB, 'shopping', 'x'), {
      name: 'شي', category: 'other', completed: false, qty: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'user-a', deletedAt: null,
    }))
  })

  it("لا يوجد بديل ثابت: families/beytna مقفول دائماً حتى لو تطابق ownerUid", async () => {
    // نزرع مستند beytna مباشرة بدون قواعد (محاكاة المستند القديم) للتأكد أن القواعد الجديدة تقفله لاحقاً
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'families', 'beytna'), { legacy: true })
    })
    const anyUser = testEnv.authenticatedContext('someone').firestore()
    await assertFails(getDoc(doc(anyUser, 'families', 'beytna')))
    await assertFails(setDoc(doc(anyUser, 'families', 'beytna', 'members', 'someone'), {
      uid: 'someone', role: 'owner', joinedAt: serverTimestamp(), deviceLabel: 'x',
    }))
  })

  it('لا يمكن إنشاء عائلة بمعرّف ثابت/قصير قابل للتخمين', async () => {
    const db = testEnv.authenticatedContext('u1').firestore()
    for (const badId of ['beytna', 'family', 'home', 'a1b2c3']) {
      await assertFails(setDoc(doc(db, 'families', badId), {
        schemaVersion: 2, ownerUid: 'u1', createdAt: serverTimestamp(),
        sections: { rules: [], travel: [], packing: [] }, prefs: {},
      }))
    }
  })

  it('ممنوع سرد (list) العائلات أو الأعضاء أو الدعوات بلا نطاق عائلة صحيح', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const stranger = testEnv.authenticatedContext('stranger-1').firestore()
    await assertFails(getDocs(collection(stranger, 'families')))
    await assertFails(getDocs(collection(stranger, 'families', familyId, 'members')))
    await assertFails(getDocs(collection(stranger, 'families', familyId, 'invites')))
  })
})

describe('P0 — استرداد الدعوة (Invite Redemption)', () => {
  it('جهاز ثانٍ ينضم برمز دعوة صالح ويصبح عضواً، والدعوة تُستهلك مرة واحدة فقط', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const { tokenHash } = await createInviteAs('owner-1', familyId)

    // قبل الانضمام: الجهاز الثاني غير عضو
    const before = testEnv.authenticatedContext('device-2').firestore()
    await assertFails(getDoc(doc(before, 'families', familyId)))

    await redeemInviteAs('device-2', familyId, tokenHash)

    const after = testEnv.authenticatedContext('device-2').firestore()
    await assertSucceeds(getDoc(doc(after, 'families', familyId)))

    // محاولة استخدام نفس الدعوة من جهاز ثالث يجب أن تفشل (مستخدمة بالفعل)
    const third = testEnv.authenticatedContext('device-3').firestore()
    await assertFails(setDoc(doc(third, 'families', familyId, 'members', 'device-3'), {
      uid: 'device-3', role: 'member', joinedAt: serverTimestamp(), deviceLabel: 'x',
      joinedViaInvite: tokenHash,
    }))
  })

  it('دعوة منتهية الصلاحية لا تصلح للانضمام', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    // ننشئ دعوة صالحة قصيراً جداً ثم نتحقق أن دعوة بتاريخ انتهاء في الماضي تُرفض عند الإنشاء أصلاً
    const ctx = testEnv.authenticatedContext('owner-1').firestore()
    const token = randomInviteToken()
    const tokenHash = sha256Hex(token)
    await assertFails(setDoc(doc(ctx, 'families', familyId, 'invites', tokenHash), {
      createdBy: 'owner-1', createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() - 1000), // منتهية بالفعل
      used: false, usedBy: null, usedAt: null,
    }))
  })

  it('لا فائدة من تخمين معرّف دعوة: get على هاش خاطئ يرجع "غير موجود" لا محتوى حقيقياً، وlist ممنوع دائماً لغير الأعضاء', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    await createInviteAs('owner-1', familyId)
    const stranger = testEnv.authenticatedContext('stranger-1').firestore()
    // get بمعرّف مخمَّن مسموح به شكلياً (لأن القاعدة لا تفرّق بين معرّف صحيح وخاطئ) لكنه لا يكشف شيئاً حقيقياً
    const snap = await assertSucceeds(getDoc(doc(stranger, 'families', familyId, 'invites', 'guessed-id-0000')))
    expect(snap.exists()).toBe(false)
    // الحماية الفعلية: سرد كل الدعوات (list) لاكتشافها بدل التخمين ممنوع كلياً على غير الأعضاء
    await assertFails(getDocs(collection(stranger, 'families', familyId, 'invites')))
  })

  it('عضو يقدر يبطل دعوة لم تُستخدم بعد (تدوير)', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const { tokenHash } = await createInviteAs('owner-1', familyId)
    const ctx = testEnv.authenticatedContext('owner-1').firestore()
    await assertSucceeds(updateDoc(doc(ctx, 'families', familyId, 'invites', tokenHash), { used: true }))

    const late = testEnv.authenticatedContext('device-late').firestore()
    await assertFails(setDoc(doc(late, 'families', familyId, 'members', 'device-late'), {
      uid: 'device-late', role: 'member', joinedAt: serverTimestamp(), deviceLabel: 'x',
      joinedViaInvite: tokenHash,
    }))
  })
})

describe('P0 — إبطال جهاز (Revoke)', () => {
  it('حذف وثيقة العضوية يقطع الوصول فوراً', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const { tokenHash } = await createInviteAs('owner-1', familyId)
    await redeemInviteAs('device-2', familyId, tokenHash)

    const owner = testEnv.authenticatedContext('owner-1').firestore()
    await assertSucceeds(deleteDoc(doc(owner, 'families', familyId, 'members', 'device-2')))

    const revoked = testEnv.authenticatedContext('device-2').firestore()
    await assertFails(getDoc(doc(revoked, 'families', familyId)))
  })
})

describe('P0 — التحقق من الشكل (schema validation)', () => {
  it('يرفض حقول غير معروفة أو shopping كمصفوفة داخل مستند العائلة', async () => {
    const familyId = strongFamilyId()
    const ctx = testEnv.authenticatedContext('u1').firestore()
    await assertFails(setDoc(doc(ctx, 'families', familyId), {
      schemaVersion: 2, ownerUid: 'u1', createdAt: serverTimestamp(),
      sections: { rules: [], travel: [], packing: [] }, prefs: {},
      shopping: [{ name: 'ممنوع' }], // الحقل القديم غير مسموح بعد الترحيل للـ subcollection
    }))
  })

  it('يرفض sections كمصفوفة بدل خريطة، وأقساماً أكثر من الحد المسموح', async () => {
    const familyId = strongFamilyId()
    const ctx = testEnv.authenticatedContext('u1').firestore()
    await assertFails(setDoc(doc(ctx, 'families', familyId), {
      schemaVersion: 2, ownerUid: 'u1', createdAt: serverTimestamp(),
      sections: [], prefs: {},
    }))
    const tooMany = {}
    for (let i = 0; i < 30; i++) tooMany['s' + i] = []
    await assertFails(setDoc(doc(ctx, 'families', familyId), {
      schemaVersion: 2, ownerUid: 'u1', createdAt: serverTimestamp(),
      sections: tooMany, prefs: {},
    }))
  })

  it('يرفض تغيير ownerUid عند التحديث', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const ctx = testEnv.authenticatedContext('owner-1').firestore()
    await assertFails(updateDoc(doc(ctx, 'families', familyId), { ownerUid: 'hacker' }))
  })

  it('يرفض غرض مقاضي بحقول أو أنواع غير صحيحة', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const ctx = testEnv.authenticatedContext('owner-1').firestore()
    await assertFails(setDoc(doc(ctx, 'families', familyId, 'shopping', 'bad1'), {
      name: 'حليب', category: 'food', completed: false, qty: -5, // كمية غير صحيحة
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'owner-1', deletedAt: null,
    }))
    await assertFails(setDoc(doc(ctx, 'families', familyId, 'shopping', 'bad2'), {
      name: 'حليب', category: 'food', completed: false, qty: 1, extra: 'غير مسموح',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'owner-1', deletedAt: null,
    }))
    await assertFails(setDoc(doc(ctx, 'families', familyId, 'shopping', 'bad3'), {
      name: 'حليب', category: 'food', completed: false, qty: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'someone-else', deletedAt: null,
    }))
  })

  it('يقبل غرض مقاضي صحيح ويرفض الحذف الصلب (يجب استخدام deletedAt)', async () => {
    const familyId = strongFamilyId()
    await createFamilyAs('owner-1', familyId)
    const ctx = testEnv.authenticatedContext('owner-1').firestore()
    const itemRef = doc(ctx, 'families', familyId, 'shopping', 'ok1')
    await assertSucceeds(setDoc(itemRef, {
      name: 'حليب', category: 'food', completed: false, qty: 2,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'owner-1', deletedAt: null,
    }))
    await assertFails(deleteDoc(itemRef))
    await assertSucceeds(updateDoc(itemRef, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'owner-1' }))
  })
})
