#!/usr/bin/env node
// "بناء" بسيط لموقع ثابت بدون حزمة أدوات (Vite قادم في P2):
// - يتحقق من صحة JSON لملفات firebase.
// - يستخرج <script type="module"> من index.html ويتحقق من صحة الصياغة (syntax) عبر node --check.
// - يتأكد أن FAMILY_ID الثابت غير موجود في المسار الجديد.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

let failed = false
const fail = (msg) => { console.error('✗ ' + msg); failed = true }
const ok = (msg) => console.log('✓ ' + msg)

// 1) JSON صحيح
for (const f of ['firebase.json', 'firestore.indexes.json', '.firebaserc', 'package.json']) {
  try {
    JSON.parse(readFileSync(f, 'utf8'))
    ok(`${f} صياغة JSON صحيحة`)
  } catch (e) {
    fail(`${f} فشل تحليل JSON: ${e.message}`)
  }
}

// 2) استخراج سكربت الوحدة من index.html وفحص صياغته
const html = readFileSync('index.html', 'utf8')
const m = html.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/)
if (!m) {
  fail('لم يتم العثور على <script type="module"> الرئيسي داخل index.html')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'beytna-build-'))
  const tmp = join(dir, 'inline.mjs')
  writeFileSync(tmp, m[1])
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
    ok('صياغة سكربت index.html صحيحة (node --check)')
  } catch (e) {
    fail('خطأ صياغة في سكربت index.html:\n' + e.stderr?.toString())
  }

  // 3) لا معرّف عائلة ثابت في المسار الجديد
  if (/FAMILY_ID\s*=\s*['"]beytna['"]/.test(m[1])) {
    fail("عُثر على FAMILY_ID = 'beytna' ثابت — يجب ألا يوجد معرّف عائلة ثابت في المسار الجديد")
  } else {
    ok("لا يوجد FAMILY_ID = 'beytna' ثابت في index.html")
  }
}

if (failed) {
  console.error('\nfailed: build-check')
  process.exit(1)
}
console.log('\nbuild-check passed')
