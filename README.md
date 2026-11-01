# تقرير قسم القلب

برنامج ويب لإعداد التقرير اليومي لقسم القلب: قائمة المرضى، الدخول والخروج، قرح الفراش، Braden، المتابعة الخاصة، والتقرير الجاهز للواتساب.

- يعمل على الجوال والكمبيوتر، ويمكن إضافته إلى الشاشة الرئيسية كتطبيق.
- البيانات مشتركة بين الطاقم عبر Firebase، ويعمل بدون إنترنت ويرسل التعديلات عند عودة الاتصال.
- كل حكيم يدخل بحسابه، والمدير يضيف الحسابات من داخل البرنامج.

الرابط: https://cardio-report.web.app

## كيف يعمل

| الملف | الوظيفة |
|---|---|
| `src/main.js` | منطق البرنامج كاملاً: الدخول، المزامنة، الشاشات، وبناء نص التقرير |
| `src/index.html` | الصفحة والتنسيق |
| `src/sw.js` | يحفظ واجهة البرنامج على الجهاز ليفتح بدون إنترنت |
| `firestore.rules` | قواعد الحماية في Firebase |
| `docs/` | النسخة المبنية التي تُنشر (لا تُعدَّل يدوياً) |
| `.github/workflows/deploy.yml` | ينشر `docs/` على Firebase Hosting مع كل دفع إلى `main` |

البيانات في Firestore:
- `staff/{uid}`: حسابات الطاقم (الاسم، اسم المستخدم، الصلاحية، مفعّل أو لا).
- `ward/main`: إعدادات الفترة (بداية الفترة، العدادات، الفريق، الافتتاحية).
- `ward/main/patients`، `events`، `notes`، `archive`: المرضى، حركة الفترة، الملاحظات، والتقارير الصادرة.
- `meta/setup`: علامة أن الإعداد الأول تم.

أسماء المستخدمين تتحول إلى بريد بالشكل `username@cardio-report.firebaseapp.com` لأن Firebase يحتاج بريداً؛ لا تُرسل أي رسائل إليه.

## التعديل والنشر

```bash
npm install
npm run build        # يبني docs/
git add -A && git commit -m "..." && git push
```

مع كل دفع إلى `main` ينشر GitHub Actions مجلد `docs/` على Firebase Hosting (`cardio-report.web.app`).
النشر يحتاج سراً في المستودع باسم `FIREBASE_SERVICE_ACCOUNT`: مفتاح JSON لحساب خدمة عنده صلاحية Firebase Hosting Admin.

قواعد Firestore لا تُنشر مع الكود: عند تعديل `firestore.rules` انسخ محتواه إلى Firebase Console ← Firestore Database ← Rules ← Publish.

## التجربة محلياً مع محاكي Firebase

```bash
npm run build:emulator                         # يبني test-out/ موصولاً بالمحاكي
npx firebase-tools emulators:start --only auth,firestore --project demo-cardio
python3 -m http.server 5050 --directory test-out
```
