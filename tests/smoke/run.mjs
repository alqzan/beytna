#!/usr/bin/env node
// اختبار smoke حقيقي عبر متصفح فعلي (Playwright) ضد Firebase Emulator:
// إنشاء بيت، دعوة، انضمام جهاز ثانٍ، مزامنة ثنائية للمقاضي بلا فقد بيانات، وإبطال جهاز.
// يُشغَّل عبر: npm run test:smoke (يشغّل Firestore+Auth Emulator تلقائياً عبر firebase emulators:exec)
//
// يحمّل هذا الاختبار index.html كما هو (بدون تعديل)، بما فيه استيراد Firebase من gstatic CDN،
// لذا يحتاج اتصال إنترنت خارج بيئات الشبكة المقيَّدة. هذا متوقّع ومقبول لأنه يعمل في CI العادي.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const PORT = 8791
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0])
        if (p === '/') p = '/index.html'
        const full = join(ROOT, p)
        const s = await stat(full)
        if (!s.isFile()) throw new Error('not a file')
        const body = await readFile(full)
        res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404); res.end('not found')
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

const log = (...a) => console.log('[smoke]', ...a)
let failed = false
const fail = (msg) => { console.error('[FAIL]', msg); failed = true }

const server = await startServer()
const BASE = `http://127.0.0.1:${PORT}/index.html?useEmulator=1`
const launchOpts = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
const browser = await chromium.launch(launchOpts)
let pageA, pageB

try {
  const ctxA = await browser.newContext()
  pageA = await ctxA.newPage()
  pageA.on('pageerror', (e) => fail('pageA pageerror: ' + e))
  await pageA.goto(BASE)
  await pageA.waitForSelector('text=بيت جديد', { timeout: 20000 })
  log('device A: onboarding shown')

  await pageA.click('text=بيت جديد')
  await pageA.fill('input[placeholder="مثلاً: جهاز أحمد"]', 'جهاز اختبار أ')
  await pageA.click('text=+ إنشاء بيتنا')
  await pageA.waitForSelector('.invite-code', { timeout: 20000 })
  const inviteCode = (await pageA.textContent('.invite-code')).trim()
  if (!inviteCode.includes('.')) fail('invite code missing separator')
  await pageA.click('text=متابعة إلى بيتنا')
  await pageA.waitForSelector('.nav-btn', { timeout: 20000 })
  log('device A: reached main app, family created with random id (no fixed FAMILY_ID)')

  await pageA.click('.nav-btn >> text=السفر')
  await pageA.click('text=+ وجهة جديدة')
  await pageA.fill('input[placeholder="اسم البلد أو الوجهة..."]', 'تركيا')
  await pageA.click('button.btn-primary:has-text("إضافة الوجهة")')
  await pageA.waitForSelector('.dest-open', { timeout: 10000 })
  await pageA.click('.dest-open')
  await pageA.locator('button.btn-primary').filter({ hasText: '+ إضافة مدينة' }).first().click()
  await pageA.fill('input[placeholder="مثلاً: إسطنبول..."]', 'إسطنبول')
  await pageA.click('button.btn-primary:has-text("إضافة المدينة")')
  await pageA.waitForSelector('.city-card', { timeout: 10000 })
  await pageA.click('button:has-text("+ إضافة مكان أو شيء")')
  await pageA.fill('input[placeholder="مثلاً: برج غلطة أو مطعم..."]', 'برج غلطة')
  await pageA.fill('input[placeholder="https://..."]', 'https://maps.google.com/?q=Galata+Tower')
  await pageA.click('button:has-text("+ أضف الرابط")')
  await pageA.fill('textarea[placeholder="الأسعار، وقت الزيارة، الحجز، اللي عجبكم..."]', 'نروح قبل الغروب ونحجز بدري')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.waitForSelector('text=برج غلطة', { timeout: 10000 })
  if (!(await pageA.locator('text=خرائط قوقل').count())) fail('travel place Google Maps link was not shown')
  log('travel: destination, city, place, Google Maps link, and note saved')

  await pageA.click('button:has-text("📅 إضافة يوم")')
  await pageA.fill('input[placeholder="مثلاً: اليوم الأول — الوصول"]', 'اليوم الأول')
  await pageA.fill('input[type="date"]', '2026-09-05')
  await pageA.locator('.overlay').last().locator('select').selectOption({ label: 'إسطنبول' })
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.waitForSelector('text=اليوم الأول', { timeout: 10000 })
  await pageA.click('button:has-text("+ إضافة فقرة لهذا اليوم")')
  await pageA.fill('input[placeholder="مثلاً: فطور ثم برج غلطة"]', 'الوصول وتسجيل الدخول')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.waitForSelector('text=الوصول وتسجيل الدخول', { timeout: 10000 })

  await pageA.click('button:has-text("💰 الميزانية")')
  await pageA.fill('input[placeholder="مثلاً: الفندق أو تذاكر الطيران"]', 'الفندق')
  await pageA.fill('input[placeholder="0"]', '2500')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.waitForSelector('text=الفندق', { timeout: 10000 })

  await pageA.click('button:has-text("🎫 إضافة حجز")')
  await pageA.fill('input[placeholder="مثلاً: فندق إسطنبول"]', 'حجز الفندق')
  await pageA.fill('input[placeholder="اختياري"]', 'ABC123')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.waitForSelector('text=حجز الفندق', { timeout: 10000 })
  log('travel advanced: day plan, day item, budget, and booking saved')

  await pageA.click('.nav-btn >> text=اليوم')
  await pageA.waitForSelector('text=يومنا', { timeout: 10000 })
  await pageA.click('button:has-text("مهمة")')
  await pageA.fill('input[placeholder="مثلاً: حجز موعد الصيانة"]', 'تأكيد خطة السفر')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.locator('.overlay').last().locator('.sheet-x').click()
  await pageA.click('button:has-text("تذكير")')
  await pageA.fill('input[placeholder="مثلاً: دفع فاتورة الإنترنت"]', 'تذكير جوازات السفر')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.locator('.overlay').last().locator('.sheet-x').click()
  await pageA.click('button:has-text("تصويت")')
  await pageA.fill('input[placeholder="مثلاً: وين نتعشى؟"]', 'اختيار المطعم')
  await pageA.fill('textarea[placeholder="مطعم 1\nمطعم 2\nنطبخ بالبيت"]', 'مطعم أ\nمطعم ب')
  await pageA.locator('.overlay').last().locator('button.btn-primary').click()
  await pageA.locator('.overlay').last().locator('.sheet-x').click()
  await pageA.click('button:has-text("قالب")')
  await pageA.click('button:has-text("سفر سريع")')
  await pageA.click('button:has-text("أضف القالب")')
  await pageA.waitForSelector('text=التأكد من الجوازات', { timeout: 10000 })
  await pageA.click('button[title="بحث"]')
  await pageA.fill('input[placeholder="وش تدورون عليه؟"]', 'تأكيد خطة السفر')
  await pageA.waitForSelector('text=تأكيد خطة السفر', { timeout: 10000 })
  log('shared tools: today dashboard, task, recurring-reminder flow, vote, template, and global search')

  await pageA.click('.nav-btn >> text=المقاضي')
  await pageA.fill('.qadd-input', 'حليب')
  await pageA.click('.qadd-go')
  await pageA.waitForSelector('text=حليب', { timeout: 10000 })
  log('device A: added shopping item')

  const ctxB = await browser.newContext()
  pageB = await ctxB.newPage()
  pageB.on('pageerror', (e) => fail('pageB pageerror: ' + e))
  await pageB.goto(BASE)
  await pageB.waitForSelector('text=الانضمام لبيت موجود', { timeout: 20000 })
  await pageB.click('text=الانضمام لبيت موجود')
  await pageB.fill('textarea[placeholder="الصق الرمز هنا..."]', inviteCode)
  await pageB.fill('input[placeholder="اسم جهازك (اختياري)"]', 'جهاز اختبار ب')
  await pageB.click('button.btn-primary:has-text("انضمام")')
  await pageB.waitForSelector('.nav-btn', { timeout: 20000 })
  log('device B: joined via invite')

  await pageB.click('.nav-btn >> text=المقاضي')
  await pageB.waitForSelector('text=حليب', { timeout: 10000 })
  log('device B: sees item added on device A — sync confirmed')

  await pageB.fill('.qadd-input', 'خبز')
  await pageB.click('.qadd-go')
  await pageA.waitForSelector('text=خبز', { timeout: 10000 })
  const halibA = await pageA.locator('text=حليب').count()
  const halibB = await pageB.locator('text=حليب').count()
  if (!halibA || !halibB) fail('data loss: "حليب" disappeared after concurrent add from the other device')
  else log('no data loss on concurrent edits from both devices (P1 shopping subcollection)')

  await pageA.click('button[title="الإعدادات"]')
  await pageA.click('text=بيتك وأجهزتك')
  await pageA.waitForSelector('text=جهاز اختبار ب', { timeout: 10000 })
  await pageA.locator('.member-row', { hasText: 'جهاز اختبار ب' }).locator('.icon-x').click()
  await pageA.click('button:has-text("إبطال")')
  await pageA.waitForTimeout(1000)
  if (await pageA.locator('text=جهاز اختبار ب').count()) fail('revoked device still listed')
  else log('revoke works: device B no longer listed on device A')

  if (!failed) log('ALL SMOKE CHECKS PASSED')
} catch (e) {
  fail('exception: ' + (e && e.stack || e))
} finally {
  await browser.close()
  server.close()
}

process.exit(failed ? 1 : 0)
