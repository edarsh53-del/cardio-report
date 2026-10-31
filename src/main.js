import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, connectAuthEmulator
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  doc, collection, query, orderBy, limit, onSnapshot, getDoc, setDoc, writeBatch, deleteField,
  terminate, clearIndexedDbPersistence
} from 'firebase/firestore';

/* ---------- Firebase ---------- */
/* global __EMULATOR__ */
// __EMULATOR__ is replaced at build time by build.mjs (true only for the local test build),
// so the production bundle drops every emulator branch
const firebaseConfig = __EMULATOR__
  ? {apiKey:'demo-key', authDomain:'demo-cardio.firebaseapp.com', projectId:'demo-cardio', appId:'demo-app'}
  : {
      apiKey: 'AIzaSyCnj0ls3DzVMc-nv5et7sB5XrO9Z6cZuuc',
      authDomain: 'cardio-report.firebaseapp.com',
      projectId: 'cardio-report',
      storageBucket: 'cardio-report.firebasestorage.app',
      messagingSenderId: '863552260181',
      appId: '1:863552260181:web:ee9c2ea14df172e0f6ecdc'
    };
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}),
  ignoreUndefinedProperties: true
});
if (__EMULATOR__) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
// Accounts use a username; Firebase needs an e-mail shape, so the username maps to one on the project's own domain.
const EMAIL_DOMAIN = __EMULATOR__ ? 'demo-cardio.firebaseapp.com' : 'cardio-report.firebaseapp.com';
const emailOf = u => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const WARD = ['ward', 'main'];
const wardDoc = () => doc(db, ...WARD);
const wardColl = c => collection(db, ...WARD, c);
const wardItem = (c, id) => doc(db, ...WARD, c, id);

/* ---------- helpers ---------- */
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function fmtWhen(iso) {
  const d = new Date(iso), n = new Date(), y = new Date(n);
  y.setDate(n.getDate() - 1);
  if (sameDay(d, n)) return fmtTime(d);
  if (sameDay(d, y)) return 'أمس ' + fmtTime(d);
  return DAYS[d.getDay()] + ' ' + fmtTime(d);
}
function uid() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s ?? '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().replace(/\s+/g, ' ').trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const joinEn = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();

/* ---------- vocab ---------- */
const SOURCES = ['ER', 'CCU', 'OPD', 'Cath', 'قسم آخر'];
const DEGREES = [['redness','Redness'],['1','1st'],['2','2nd'],['3','3rd'],['4','4th'],['unst','Unstageable']];
const SITES = ['sacrum','buttocks','heels','upper back','lower back','neck','inner thigh','hip','elbow','shoulder','occiput','ear'];
const SUBSPECS = ['أعصاب','كلى','صدرية','جهاز هضمي','باطنة عامة'];
const SHARED = ['الكلى','الأعصاب','الصدرية','الجراحة','الغدد'];
const VITALS = ['Temp','HR','RR','B.P','SpO2'];
const PUMP_MEDS = ['Heparin','Amiodarone','Nitroglycerin','Furosemide','Dopamine','Dobutamine','Noradrenaline','Insulin'];
const VENTURI = [
  {p:24, l:2,  c:'#2F6FD6', n:'أزرق'},
  {p:28, l:4,  c:'#F2F2F2', n:'أبيض'},
  {p:31, l:6,  c:'#EE8A2A', n:'برتقالي'},
  {p:35, l:8,  c:'#F1C823', n:'أصفر'},
  {p:40, l:8,  c:'#D63B3B', n:'أحمر'},
  {p:60, l:12, c:'#2E9F57', n:'أخضر'}
];
const TR_DEST = ['العناية المركزة ICU','قسم الجراحة','مستشفى آخر'];
const NOTE_TPL = ['يحتاج إلى صيانة: ','نقص في: ','عطل في جهاز: ','تم إبلاغ: '];

const OP_CATS = [['wisdom', 'حكمة'], ['team', 'تحفيز للطاقم'], ['safety', 'سلامة المريض'], ['dua', 'دعاء وأذكار']];
const OP_EMOJI = {
  wisdom: [['🌿','🦜','🍃🕊️'], ['🌸','🌿','🤍'], ['☀️','🌱','🍃'], ['🕊️','🌿','💚']],
  team:   [['☀️','🩺','💪'], ['🌿','🫀','🤍'], ['✨','🥼','🌸'], ['🌸','🩺','✨']],
  safety: [['🛡️','🩺','✅'], ['🧼','🛡️','🤍'], ['🫀','✅','🌿']],
  dua:    [['🌿','🦜','🍃🕊️'], ['🤲','🌙','🤍'], ['🌸','🤲','🍃']]
};
const OP_RAW = {
  wisdom: [
    ['حكمة اليوم', 'الكلمة الطيبة دواء لا يُكتب في الوصفة، لكنها تصل إلى القلب قبل أي علاج.'],
    ['كلمة الصباح', 'الصبر في العمل ليس انتظارًا، بل إتقانٌ ونحن ننتظر.'],
    ['حكمة اليوم', 'من زرع الرحمة في عمله حصد الطمأنينة في قلبه.'],
    ['همسة صباحية', 'الابتسامة في وجه المريض نصف الطريق إلى راحته.'],
    ['حكمة اليوم', 'العمل الصغير المتقن أعظم من العمل الكبير الناقص.'],
    ['كلمة الصباح', 'لا يُقاس العطاء بطول الوقت، بل بصدق النية وحسن الأداء.'],
    ['همسة صباحية', 'من يخفف ألم غيره يجد في قلبه راحة لا تُشترى.'],
    ['حكمة اليوم', 'الهدوء في الأزمات علامة الخبرة، والصبر عليها علامة القوة.'],
    ['صباح جديد', 'كل يوم جديد صفحة بيضاء، فاكتب فيها ما يسرّك أن تقرأه غدًا.'],
    ['كلمة الصباح', 'التعب يزول، ويبقى الأثر الطيب في قلوب من خدمناهم.'],
    ['حكمة اليوم', 'الرحمة لغة يفهمها كل مريض مهما اختلفت لغته.'],
    ['همسة صباحية', 'النجاح ليس ألا نخطئ، بل أن نتعلم من كل خطأ فلا نكرره.'],
    ['كلمة الصباح', 'القلب الذي يرعى القلوب يستحق أن يُرعى أيضًا، فاعتنِ بنفسك.'],
    ['حكمة اليوم', 'الإصغاء للمريض علاج يبدأ قبل أي دواء.'],
    ['صباح جديد', 'أجمل ما في عملنا أن أثره يبقى حتى بعد أن ينتهي الدوام.'],
    ['حكمة اليوم', 'النظام يوفّر الوقت، والوقت في قسمنا قد يعني حياة.']
  ],
  team: [
    ['صباح الهمّة', 'كل مناوبة فرصة جديدة لنصنع فرقًا في حياة مريض.'],
    ['رسالة للفريق', 'أنتم نبض هذا القسم، وبكم يطمئن كل قلب فيه.'],
    ['صباح الخير يا فريق', 'بالتعاون تخفّ المهمة، وبالابتسامة يخفّ التعب.'],
    ['شكرًا لكم', 'شكرًا لكل يد امتدت بالرعاية في ساعات الليل الطويلة.'],
    ['فريق واحد', 'هدف واحد يجمعنا: مريض بخير وقلب مطمئن.'],
    ['رسالة للفريق', 'جهدكم لا يُرى دائمًا، لكن أثره يظهر في كل مريض يتعافى.'],
    ['صباح الهمّة', 'صباح الخير لفريق يعمل بقلبه قبل يديه.'],
    ['بداية طيبة', 'لنبدأ اليوم بنية طيبة، وننهيه برضا وراحة ضمير.'],
    ['رسالة للفريق', 'ما تقدمونه ليس وظيفة فقط، بل رسالة إنسانية عظيمة.'],
    ['معًا', 'معًا نستطيع أن نجعل هذا اليوم أخفّ على كل مريض.'],
    ['صباح الهمّة', 'تعبكم اليوم راحة لمريض وطمأنينة لعائلته.'],
    ['فريق واحد', 'كل كلمة تشجيع بيننا تصنع فريقًا أقوى.'],
    ['رسالة للفريق', 'القسم بخير ما دام فيه فريق يحرص بعضه على بعض.'],
    ['بداية طيبة', 'خذوا نفسًا عميقًا وابدأوا يومكم بثقة، فأنتم أهلٌ لها.']
  ],
  safety: [
    ['سلامة المريض أولاً', 'سلامة المريض تبدأ من التفاصيل الصغيرة: المريض الصحيح، الدواء الصحيح، الوقت الصحيح.'],
    ['تذكير اليوم', 'تأكد مرتين قبل إعطاء أي دواء، فدقيقة تحقق قد تحمي حياة.'],
    ['تذكير اليوم', 'نظافة اليدين أبسط خطوة وأقوى حماية للمريض.'],
    ['سلامة المريض أولاً', 'التسليم الواضح بين المناوبات نصف سلامة المريض.'],
    ['تذكير اليوم', 'تغيير وضعية المريض في وقته يحميه من قرح الفراش.'],
    ['سلامة المريض أولاً', 'لا تتردد في السؤال، فالسؤال أفضل من الخطأ.'],
    ['تذكير اليوم', 'حواجز السرير مرفوعة؟ خطوة بسيطة تمنع السقوط.'],
    ['سلامة المريض أولاً', 'راقب العلامات الحيوية بدقة، فالتغيير الصغير قد يكون إنذارًا مبكرًا.'],
    ['تذكير اليوم', 'التوثيق الدقيق يحمي المريض ويحميك.'],
    ['سلامة المريض أولاً', 'أصغِ لشكوى المريض جيدًا، فهو أول من يشعر بالتغيير.'],
    ['تذكير اليوم', 'تحقق من هوية المريض قبل كل إجراء، مهما كنت متأكدًا.'],
    ['سلامة المريض أولاً', 'راجع الأدوية عالية الخطورة مع زميل قبل إعطائها.'],
    ['تذكير اليوم', 'بلّغ عن أي عطل في الأجهزة فورًا، فالجهاز السليم رعاية أكثر أمانًا.'],
    ['سلامة المريض أولاً', 'المريض المطمئن يتعاون أكثر، فاشرح له ما ستفعله قبل أن تبدأ.']
  ],
  dua: [
    ['اللهم في هذا الصباح', 'اجعل صباحنا جبرًا وفرجًا وخيرًا ورزقًا لا ينتهي.'],
    ['أذكار الصباح', 'أصبحنا وأصبح المُلك لله، والحمد لله، لا إله إلا الله وحده لا شريك له، له المُلك وله الحمد وهو على كل شيء قدير.'],
    ['أذكار الصباح', 'اللهم بك أصبحنا، وبك أمسينا، وبك نحيا، وبك نموت، وإليك النشور.'],
    ['دعاء للمرضى', 'اللهم ربَّ الناس، أذهب البأس، اشفِ أنت الشافي، لا شفاء إلا شفاؤك، شفاءً لا يغادر سقمًا.'],
    ['أذكار الصباح', 'بسم الله الذي لا يضر مع اسمه شيء في الأرض ولا في السماء، وهو السميع العليم.'],
    ['دعاء الصباح', 'اللهم إني أسألك علمًا نافعًا، ورزقًا طيبًا، وعملًا متقبلًا.'],
    ['أذكار الصباح', 'رضيت بالله ربًّا، وبالإسلام دينًا، وبمحمد ﷺ نبيًّا.'],
    ['دعاء للمرضى', 'اللهم ألبس مرضانا ثوب الصحة والعافية، وردّهم إلى أهلهم سالمين.'],
    ['أذكار الصباح', 'يا حيُّ يا قيوم، برحمتك أستغيث، أصلح لي شأني كله، ولا تكلني إلى نفسي طرفة عين.'],
    ['دعاء للفريق', 'اللهم يسّر لنا مناوبتنا، وارزقنا الصبر والحكمة واللطف في عملنا.'],
    ['أذكار الصباح', 'اللهم عافني في بدني، اللهم عافني في سمعي، اللهم عافني في بصري، لا إله إلا أنت.'],
    ['اللهم في هذا الصباح', 'اجعل أيدينا سببًا في شفاء المرضى، واكتب لنا الأجر في كل تعب.'],
    ['أذكار الصباح', 'اللهم ما أصبح بي من نعمة أو بأحد من خلقك فمنك وحدك لا شريك لك، فلك الحمد ولك الشكر.'],
    ['أذكار الصباح', 'حسبي الله لا إله إلا هو، عليه توكلت وهو رب العرش العظيم.']
  ]
};
const OPENINGS = {};
Object.keys(OP_RAW).forEach(k => {
  OPENINGS[k] = OP_RAW[k].map(([head, text], i) => { const e = OP_EMOJI[k][i % OP_EMOJI[k].length]; return {head, text, before:e[0], after:e[1], end:e[2]}; });
});
const OP_ALL = (() => {
  const lists = OP_CATS.map(([k]) => OPENINGS[k]), out = [], n = Math.max(...lists.map(l => l.length));
  for (let i = 0; i < n; i++) lists.forEach(l => { if (l[i]) out.push(l[i]); });
  return out;
})();

const MARK = '<svg class="mark" viewBox="0 0 34 34" aria-hidden="true"><rect width="34" height="34" rx="10" style="fill:var(--heart)"/><path d="M5 18h6l2.2-5.5 3.3 10.5 3.2-14 2.2 9H29" fill="none" style="stroke:var(--mark-ink)" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON = {
  bed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6v13M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/></svg>',
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h4.5"/></svg>',
  report: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4L3 11l7 2.5L12.5 21z"/><path d="M10 13.5L20 4"/></svg>'
};

/* ---------- model ---------- */
function newFollow(x) {
  const f = Object.assign({on:false, vitals:[], uop:false, rbs:false, position:null, pain:null, pumps:[], venturi:null, other:''}, x || {});
  if (!Array.isArray(f.vitals)) f.vitals = [];
  if (!Array.isArray(f.pumps)) f.pumps = [];
  return f;
}
function newPatient(x) {
  const p = Object.assign({id:'p' + uid(), name:'', gender:'f', loc:'dept', spec:'cardio', sub:'', bed:'', shared:'', braden:null, bradenNew:false, sores:[], air:false, foley:false, cl:false, cath:false, admitted:false, source:'', edit:null}, x || {});
  if (!Array.isArray(p.sores)) p.sores = [];
  p.follow = newFollow(x && x.follow);
  return p;
}
const isHR = p => p.braden != null && p.braden <= 18;
const who = p => p.gender === 'f' ? 'المريضة' : 'المريض';
function staffName(id) {
  const a = state && state.staff.find(s => s.id === id);
  if (a) return a.name;
  const x = state && (state.extraStaff || []).find(s => s.id === id);
  return x ? x.name : '';
}
const me = () => session.me || {id:session.uid, name:'', role:'nurse'};
const isAdmin = () => me().role === 'admin';
function soreText(s) {
  const w = joinEn(s.sites);
  if (s.degree === 'redness') return 'Redness in ' + w;
  if (s.degree === 'unst') return 'Unstageable bed sore in ' + w;
  return `${({1:'1st',2:'2nd',3:'3rd',4:'4th'})[s.degree]} degree bed sore in ${w}`;
}
const soresLine = p => p.sores.map((s, i) => { const t = soreText(s); return i ? t.charAt(0).toLowerCase() + t.slice(1) : t; }).join(' & ');
function followLines(p) {
  const f = p.follow, L = [];
  if (f.venturi) L.push(`Venturi mask ${f.venturi.p}% ${f.venturi.l}L`);
  const v = VITALS.filter(x => f.vitals.includes(x));
  if (v.length) L.push('Obs V/S: ' + v.join(', '));
  if (f.uop) L.push('Obs UOP');
  if (f.rbs) L.push('Obs RBS');
  if (f.position) L.push(`Change position every ${f.position} hours`);
  f.pumps.forEach(m => L.push(`Syringe pump: ${m.med}${m.rate ? ' ' + m.rate + ' ml/hr' : ''}`));
  if (f.pain != null) L.push(`Pain score ${f.pain}/10 + pain management`);
  if (f.other) L.push(f.other);
  return L;
}
const MAIN_KEYS = ['periodStart', 'counters', 'team', 'responsible', 'opening', 'known', 'extraStaff'];
function defaultMain() {
  return {periodStart:nowIso(), counters:{blood:0, peth:0, morph:0, under:0, dirty:0, clean:0}, team:[], responsible:null, opening:Object.assign({}, OPENINGS.dua[0]), known:[], extraStaff:[]};
}
function pickMain(d) {
  const def = defaultMain(), out = {};
  MAIN_KEYS.forEach(k => { out[k] = d[k] === undefined ? def[k] : d[k]; });
  out.counters = Object.assign({}, def.counters, out.counters || {});
  if (!Array.isArray(out.team)) out.team = [];
  if (!Array.isArray(out.known)) out.known = [];
  if (!Array.isArray(out.extraStaff)) out.extraStaff = [];
  return out;
}

/* ---------- session and live data ---------- */
let state = null;
const session = {uid:null, me:null, meUnsub:null, unsubs:[], started:false, ready:false, retries:0, retryTimer:null};
let gate = {mode:'loading'};
let settingUp = false;
const ui = {tab:'patients', filter:'all', q:'', sheet:null, sheetNew:false, exitMode:null, trDest:'', trErr:'', soreDraft:null, specPick:false, delConfirm:false, issueConfirm:false, copyFallback:false, admitErr:'', dupOk:false, pumpErr:'', op:{cat:'wisdom', shown:[]}, nf:{role:'nurse', name:'', user:'', pass:'', busy:false, err:'', msg:''}, pw:{err:'', msg:'', busy:false}, logoutConfirm:false};
let draft = null, undoOps = null, toastTimer = null, pending = 0, slowTimer = null;

function stopData() {
  session.unsubs.forEach(u => { try { u(); } catch (e) { /* already closed */ } });
  session.unsubs = [];
  session.started = false;
  session.ready = false;
  state = null;
  ui.sheet = null;
}
function startData() {
  session.started = true;
  state = Object.assign(pickMain({}), {patients:[], events:[], notes:[], archive:[], staff:[], currentUser:session.uid});
  const loaded = {main:false, patients:false, events:false, notes:false, staff:false};
  const ready = () => {
    if (!session.ready && Object.values(loaded).every(Boolean)) { session.ready = true; session.retries = 0; showShell(); render(); }
    else if (session.ready) scheduleRender();
  };
  const sub = (q, fn, key) => {
    session.unsubs.push(onSnapshot(q, s => { if (!state) return; fn(s); if (key) loaded[key] = true; ready(); }, onDataError));
  };
  sub(wardDoc(), s => {
    if (!s.exists()) {
      if (!s.metadata.fromCache) setDoc(wardDoc(), defaultMain(), {merge:true}).catch(onWriteError);
      return;
    }
    Object.assign(state, pickMain(s.data()));
    loaded.main = true;
  });
  sub(wardColl('patients'), s => { state.patients = s.docs.map(d => newPatient(Object.assign({}, d.data(), {id:d.id}))); }, 'patients');
  sub(wardColl('events'), s => { state.events = s.docs.map(d => Object.assign({}, d.data(), {id:d.id})); }, 'events');
  sub(wardColl('notes'), s => { state.notes = s.docs.map(d => Object.assign({}, d.data(), {id:d.id})).sort((a, b) => String(a.at).localeCompare(String(b.at))); }, 'notes');
  sub(collection(db, 'staff'), s => { state.staff = s.docs.map(d => Object.assign({}, d.data(), {id:d.id})); }, 'staff');
  sub(query(wardColl('archive'), orderBy('at', 'desc'), limit(60)), s => { state.archive = s.docs.map(d => Object.assign({}, d.data(), {id:d.id})); });
}
function onDataError(e) {
  if (e && e.code === 'permission-denied') {
    // a deactivated account is handled by the account listener; a fresh account can race the server, so retry a few times
    if (session.me && session.retries < 4) {
      session.retries++;
      clearTimeout(session.retryTimer);
      session.retryTimer = setTimeout(() => { if (session.me && session.me.active) { stopData(); startData(); } }, 1200 * session.retries);
    }
    return;
  }
  console.error(e);
}
function onWriteError(e) {
  console.error(e);
  showToast('لم يُحفظ التعديل: ' + authMsg(e));
}

onAuthStateChanged(auth, user => {
  if (session.meUnsub) { session.meUnsub(); session.meUnsub = null; }
  stopData();
  session.me = null;
  closeSheetSilent();
  if (!user) { session.uid = null; decideGate(); return; }
  session.uid = user.uid;
  gate = {mode:'loading', msg:'جارٍ التحقق من الحساب…'};
  renderGate();
  session.meUnsub = onSnapshot(doc(db, 'staff', user.uid), {includeMetadataChanges:true}, snap => {
    const d = snap.exists() ? snap.data() : null;
    // right after first-run setup the staff record exists only locally; the server would refuse reads until it lands
    if (d && snap.metadata.hasPendingWrites && !session.started) return;
    if (!d || d.active !== true) {
      if (settingUp) return;
      if (!d && snap.metadata.fromCache) return; // wait for the server's answer
      stopData();
      session.me = null;
      gate = {mode:'inactive'};
      renderGate();
      return;
    }
    session.me = Object.assign({}, d, {id:user.uid});
    if (!session.started) startData();
    else scheduleRender();
  }, () => { if (!settingUp) { stopData(); gate = {mode:'inactive'}; renderGate(); } });
});
async function decideGate() {
  gate = {mode:'loading'};
  renderGate();
  let mode = 'login';
  try { mode = (await getDoc(doc(db, 'meta', 'setup'))).exists() ? 'login' : 'setup'; }
  catch (e) {
    // the marker is readable by anyone once our rules are published; a refusal means they are not
    if (e && e.code === 'permission-denied') mode = 'rules';
    // offline or unreachable: whoever set up this device can still sign in from the login form
  }
  if (auth.currentUser) return;
  gate = {mode};
  renderGate();
}

/* ---------- writes: diff the local state, send one batch, keep the inverse for undo ---------- */
const DEL = {__del: true};
const byId = arr => { const m = {}; arr.forEach(x => { m[x.id] = clone(x); }); return m; };
const snapState = () => ({patients:byId(state.patients), events:byId(state.events), notes:byId(state.notes), archive:byId(state.archive), main:clone(pickMain(state))});
function fieldDiff(x, y) {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]), before = {}, after = {};
  let n = 0;
  keys.forEach(k => {
    if (k === 'id') return;
    if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) {
      before[k] = x[k] === undefined ? DEL : x[k];
      after[k] = y[k] === undefined ? DEL : y[k];
      n++;
    }
  });
  return n ? {before, after} : null;
}
function diffState(a, b) {
  const ops = [];
  for (const coll of ['patients', 'events', 'notes', 'archive']) {
    const ids = new Set([...Object.keys(a[coll]), ...Object.keys(b[coll])]);
    ids.forEach(id => {
      const x = a[coll][id], y = b[coll][id];
      if (!x && y) ops.push({coll, id, kind:'create', after:y});
      else if (x && !y) ops.push({coll, id, kind:'remove', before:x});
      else { const d = fieldDiff(x, y); if (d) ops.push({coll, id, kind:'patch', before:d.before, after:d.after}); }
    });
  }
  const d = fieldDiff(a.main, b.main);
  if (d) ops.push({coll:'main', kind:'patch', before:d.before, after:d.after});
  return ops;
}
const toFields = o => { const r = {}; Object.keys(o).forEach(k => { r[k] = o[k] === DEL || (o[k] && o[k].__del) ? deleteField() : o[k]; }); return r; };
const stripId = o => { const r = Object.assign({}, o); delete r.id; return r; };
function applyOps(ops, dir) {
  const b = writeBatch(db);
  ops.forEach(op => {
    const ref = op.coll === 'main' ? wardDoc() : wardItem(op.coll, op.id);
    const forward = dir === 'after';
    if (op.kind === 'create') { if (forward) b.set(ref, stripId(op.after)); else b.delete(ref); }
    else if (op.kind === 'remove') { if (forward) b.delete(ref); else b.set(ref, stripId(op.before)); }
    else b.update(ref, toFields(forward ? op.after : op.before));
  });
  pending++;
  updateNet();
  b.commit().catch(onWriteError).finally(() => { pending--; updateNet(); });
}
function commit(fn, msg, soft) {
  if (!state) return;
  const before = snapState();
  fn();
  const ops = diffState(before, snapState());
  if (soft) scheduleRender(); else render();
  if (!ops.length) return;
  applyOps(ops, 'after');
  if (msg) showToast(msg, ops);
}
function showToast(msg, ops) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${ops ? '<button type="button" data-act="undo">تراجع</button>' : ''}`;
  t.hidden = false;
  undoOps = ops || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; undoOps = null; }, 6000);
}
function updateNet() {
  const el = $('net'), tx = $('net-text');
  if (!el) return;
  clearTimeout(slowTimer);
  if (!navigator.onLine) {
    el.hidden = false;
    tx.textContent = pending
      ? 'غير متصل بالإنترنت · التعديلات محفوظة على الجهاز وتُرسل تلقائياً عند عودة الاتصال'
      : 'غير متصل بالإنترنت · يمكنك متابعة العمل، وكل تعديل يُرسل تلقائياً عند عودة الاتصال';
  } else if (pending) {
    slowTimer = setTimeout(() => { if (pending) { el.hidden = false; tx.textContent = 'جارٍ إرسال التعديلات… الاتصال ضعيف'; } }, 3000);
  } else el.hidden = true;
}

/* ---------- report ---------- */
function currentOpening() {
  if (state.opening) return state.opening;
  const n = new Date(), s = new Date(n.getFullYear(), 0, 0);
  return OP_ALL[Math.floor((n - s) / 864e5) % OP_ALL.length];
}
function currentDua() {
  const o = currentOpening();
  return `${o.before}*${o.head}*${o.after}\n${o.text}${o.end ? ' ' + o.end : ''}`;
}
function counts() {
  const P = state.patients, im = P.filter(p => p.spec === 'internal');
  return {
    total:P.length,
    dept:P.filter(p => p.loc === 'dept').length,
    hall:P.filter(p => p.loc === 'hall').length,
    cm:P.filter(p => p.spec === 'cardio' && p.gender === 'm').length,
    cf:P.filter(p => p.spec === 'cardio' && p.gender === 'f').length,
    im:im.length, imD:im.filter(p => p.loc === 'dept').length, imH:im.filter(p => p.loc === 'hall').length
  };
}
const evOf = t => state.events.filter(e => e.type === t).sort((a, b) => String(a.at).localeCompare(String(b.at)));
function autoNotes() {
  const out = [];
  state.patients.filter(p => p.cath).forEach(p => out.push(`${who(p)} ${p.name} في القسطرة القلبية`));
  evOf('dama').forEach(e => {
    const newAdm = state.events.some(a => a.type === 'admit' && a.pid === e.pid);
    out.push(`${who(e.p)} ${e.p.name} ${newAdm ? 'دخول جديد وخروج' : 'خروج'} as DAMA`);
  });
  evOf('escape').forEach(e => out.push(`${who(e.p)} ${e.p.name} 👈 هروب Escape`));
  return out;
}
function generalNotes() {
  const out = [];
  state.patients.filter(p => p.shared).forEach(p => out.push(`${who(p)} ${p.name} ${p.gender === 'f' ? 'مشتركة' : 'مشترك'} بين ${p.spec === 'cardio' ? 'القلب' : 'الباطنة'} و${p.shared}.`));
  evOf('spec').forEach(e => {
    if (e.to === 'internal') out.push(`${who(e.p)} ${e.p.name} 👈 خروج من القلب ...(${e.sub || 'باطنة'})`);
    else out.push(`${who(e.p)} ${e.p.name} 👈 تحويل من الباطنة إلى القلب`);
  });
  return out;
}
const teamPool = () => state.staff.filter(s => s.active).map(s => ({id:s.id, name:s.name})).concat(state.extraStaff || []);
function buildReport() {
  const S = state, P = S.patients, now = new Date(), c = counts(), sep = '━━━━━━━━━━━━━━', L = [];
  L.push('التقرير اليومي قسم القلب الخارجي ❤️🫀');
  L.push(`🔸اليوم: ${DAYS[now.getDay()]}`);
  L.push(`📆التاريخ: ${fmtDate(now)}`);
  L.push(...currentDua().split('\n'));
  L.push(sep);

  L.push('📊📌 *أولاً: الإحصائيات العامة*', '');
  L.push(`* 👥 العدد الكلي للمرضى: (${c.total})`);
  L.push(`* 🏥 إجمالي حالات القسم الخارجي🫀: (${c.dept})`);
  L.push(`* 🛏️ إجمالي حالات القاعة: (${c.hall})`);
  L.push(`* 🌲 حالات القلب رجال: (${c.cm})`);
  L.push(`* 🌲 حالات القلب نساء: (${c.cf})`);
  L.push(`* 🌲 إجمالي حالات الباطنة: (${c.im})`);
  L.push(`(${c.imD} في القسم + ${c.imH} في القاعة)`);
  generalNotes().forEach((t, i) => L.push(`${i + 1}. ${t}`));
  L.push(sep);

  const adm = evOf('admit');
  const aCm = adm.filter(e => e.p.spec === 'cardio' && e.p.gender === 'm');
  const aCf = adm.filter(e => e.p.spec === 'cardio' && e.p.gender === 'f');
  const aIm = adm.filter(e => e.p.spec === 'internal');
  const admLine = (e, i) => `${i + 1}. ${e.p.name} ... ${e.p.source}`;
  L.push('📥🩺 *ثانياً: حالات الدخول*');
  L.push(`🔢 إجمالي حالات الدخول: (${adm.length})`, '');
  L.push(`👨🏻‍⚕️❤️ *مرضى القلب رجال (${aCm.length})*`); aCm.forEach((e, i) => L.push(admLine(e, i)));
  L.push('', `👰❤️ *مرضى القلب نساء (${aCf.length})*`); aCf.forEach((e, i) => L.push(admLine(e, i)));
  L.push('', `♥️🧑‍⚕️ *مرضى الباطنة (${aIm.length})*`); aIm.forEach((e, i) => L.push(admLine(e, i)));
  L.push(sep);

  const dis = evOf('discharge');
  L.push('📤🏠 *ثالثاً: حالات الخروج*', '');
  L.push(`🔢 إجمالي حالات الخروج: (${dis.length})`);
  dis.forEach((e, i) => L.push(`${i + 1}. ${e.p.name}`));
  L.push(sep);

  const tr = evOf('transfer'), de = evOf('death');
  L.push('🔄🏥 *رابعاً: حالات التحويل والوفاة*', '');
  L.push(`* 🔢 حالات التحويل: (${tr.length})`); tr.forEach((e, i) => L.push(`${i + 1}. ${e.p.name} 👈 ${e.to}`));
  L.push(`* 🔢 حالات الوفاة: (${de.length})`); de.forEach((e, i) => L.push(`${i + 1}. ${e.p.name}`));
  L.push(sep);

  const soreP = P.filter(p => p.sores.length);
  const newS = soreP.filter(p => p.sores.every(s => s.isNew)), oldS = soreP.filter(p => !p.sores.every(s => s.isNew));
  const soreRow = (p, i) => `${i + 1}. ${p.name}: ${soresLine(p)}${p.air ? ' (على فرشة هوائية)' : ''}`;
  L.push('🛌🩹 *خامساً: Bed Sores / Degree*', '');
  L.push(`🍀📋 الحالات السابقة (Old Cases): (${oldS.length})`); oldS.forEach((p, i) => L.push(soreRow(p, i)));
  L.push('', `✴️ حالات القرح الفراشية الجديدة: (${newS.length})`); newS.forEach((p, i) => L.push(soreRow(p, i)));
  L.push(`🫴 إجمالي حالات قرح الفراش: (${soreP.length})`);
  L.push(sep);

  const hr = P.filter(isHR), oldH = hr.filter(p => !p.bradenNew), newH = hr.filter(p => p.bradenNew);
  L.push('⚠️🛡️ *سادساً: High-Risk Patients (Braden Scale)*', '');
  L.push(`📋📊 الحالات القديمة (Old High-Risk): (${oldH.length})`); oldH.forEach((p, i) => L.push(`${i + 1}. ${p.name} (${p.braden})`));
  L.push(`🍀 حالات الـ High-Risk الجديدة: (${newH.length})`); newH.forEach((p, i) => L.push(`${i + 1}. ${p.name} (${p.braden})`));
  L.push('', `🫴 إجمالي حالات الـ High risk: (${hr.length})`);
  L.push(sep);

  const fu = P.filter(p => p.follow.on);
  L.push(`⭐🩺 *سابعاً: حالات تحتاج إلى متابعة خاصة: (${fu.length})*`);
  fu.forEach((p, i) => { L.push(`${i + 1}. ${p.name}`); followLines(p).forEach(l => L.push(l)); });
  L.push(sep);

  const k = S.counters;
  L.push('🩸💉 *ثامناً: العناية الدوائية ونقل الدم*', '');
  L.push(`* 🩸 حالات نقل الدم: (${k.blood})`, `* 🟤 بيثدين: (${k.peth})`, `* 🟤 مورفين: (${k.morph})`);
  L.push(sep);
  L.push(`🧺🧼 تحت المرضى 🤕: (${k.under})`, `👉 الشراشف المتسخة: (${k.dirty})`, `👉 الشراشف النظيفة: (${k.clean})`, `👉 إجمالي عدد الشراشف: (${k.under + k.dirty + k.clean})`);
  L.push(sep);

  const notes = autoNotes().concat(S.notes.map(n => n.text));
  L.push('🧚 *ملاحظات عامة* 👉');
  if (notes.length) notes.forEach(t => L.push(`🌲 ${t}`)); else L.push('🌲 لا يوجد');
  L.push('');

  const team = S.team.map(id => ({id, name:staffName(id)})).filter(s => s.name);
  L.push('⛹️ *الفريق المناوب* 🥼');
  team.forEach((s, i) => L.push(`${i + 1}. 🥼ح/ ${s.name} ✨`));
  L.push('');
  const respName = S.responsible ? staffName(S.responsible) : '', prepName = me().name;
  if (respName && respName === prepName) L.push('👈 الحكيم/ة المسؤول/ة ومعد التقرير', `🥼ح/ ${respName} 💫`);
  else {
    if (respName) L.push('👈 الحكيم/ة المسؤول/ة', `🥼ح/ ${respName} 💫`);
    if (prepName) L.push('👈 معد التقرير', `🥼ح/ ${prepName} 💫`);
  }
  L.push('', 'سلامة المريض أولاً ☝️ والله ولي التوفيق 🤲', '');

  const fol = P.filter(p => p.foley), folWard = fol.filter(p => p.loc === 'dept').length, folExt = fol.length - folWard;
  L.push(`1. Admission (${adm.length})`);
  L.push(`2. Discharge (${dis.length})`);
  L.push(`3. Urinary Foley Catheter 👉 (${fol.length}) cases`);
  L.push(`${folExt} in Ext and ${folWard} cases in the ward.`);
  L.push(`4. Central Line 👉 (${P.filter(p => p.cl).length})`);
  L.push(`5. Pressure Ulcers 👉 (${soreP.length})`);
  L.push(`6. Special follow-up (${fu.length})`);
  L.push(`7. Air mattress (${P.filter(p => p.air).length})`);
  return L.join('\n');
}
const richText = t => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
function checks() {
  const w = [];
  if (!state.team.length) w.push('لم يتم تحديد الفريق المناوب. حدده من تبويب «اليوم».');
  if (!state.responsible || !state.team.includes(state.responsible)) w.push('اختر الحكيم/ة المسؤول/ة من تبويب «اليوم».');
  const cath = state.patients.filter(p => p.cath);
  if (cath.length) w.push(`${cath.length === 1 ? 'مريض واحد مسجل' : cath.length + ' مرضى مسجلين'} في القسطرة: تأكد إذا رجع${cath.length === 1 ? '' : 'وا'} قبل الإرسال.`);
  return w;
}
function periodLabel() { const d = new Date(state.periodStart); return `${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${fmtTime(d)}`; }

/* ---------- small builders ---------- */
const chip = (label, on, act, v, extra) => `<button type="button" class="chip" aria-pressed="${!!on}" data-act="${act}" data-v="${esc(v)}" ${extra || ''}>${label}</button>`;
const segBtn = (act, k, v, label, cur, dis) => `<button type="button" data-act="${act}" data-k="${k}" data-v="${v}" aria-pressed="${v === cur}" ${dis ? 'disabled' : ''}>${label}</button>`;
const sw = (label, act, k, on, hint) => `<button type="button" class="sw-row" role="switch" aria-checked="${!!on}" data-act="${act}" data-k="${k}"><span class="sw-t"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</span><span class="toggle" aria-hidden="true"></span></button>`;
const head = (title, sub, lead) => `<div class="sheet-head">${lead || ''}<div class="sh-title"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="icon-btn" data-act="close-sheet" aria-label="إغلاق">${ICON.close}</button></div>`;

/* ---------- patients view ---------- */
const GROUPS = [
  {t:'القسم · قلب رجال', loc:'dept', f:p => p.loc === 'dept' && p.spec === 'cardio' && p.gender === 'm'},
  {t:'القسم · قلب نساء', loc:'dept', f:p => p.loc === 'dept' && p.spec === 'cardio' && p.gender === 'f'},
  {t:'القسم · باطنة', loc:'dept', f:p => p.loc === 'dept' && p.spec === 'internal'},
  {t:'القاعة · باطنة', loc:'hall', f:p => p.loc === 'hall'}
];
const bedNum = b => { const n = parseInt(String(b).replace(/\D/g, ''), 10); return isNaN(n) ? 999 : n; };
function tagsHtml(p) {
  const t = [];
  if (p.admitted) t.push(`<span class="tag new">دخول جديد · ${esc(p.source)}</span>`);
  if (p.cath) t.push('<span class="tag heart">في القسطرة</span>');
  if (isHR(p)) t.push(`<span class="tag risk">Braden ${p.braden}${p.bradenNew ? ' · جديد' : ''}</span>`);
  else if (p.braden != null) t.push(`<span class="tag">Braden ${p.braden}</span>`);
  if (p.sores.length) t.push('<span class="tag sore">قرحة فراش</span>');
  if (p.air) t.push('<span class="tag sore-o">فرشة هوائية</span>');
  if (p.follow.on) t.push('<span class="tag follow">متابعة خاصة</span>');
  if (p.foley) t.push('<span class="tag info">Foley</span>');
  if (p.cl) t.push('<span class="tag info">Central line</span>');
  if (p.shared) t.push(`<span class="tag info">مشترك: ${esc(p.shared)}</span>`);
  if (p.sub) t.push(`<span class="tag">${esc(p.sub)}</span>`);
  return t.length ? `<span class="tags">${t.join('')}</span>` : '';
}
const row = p => `<button type="button" class="prow" data-act="open" data-id="${p.id}"><span class="bed">${esc(p.bed || '–')}</span><span class="pmain"><span class="pname">${esc(p.name)}</span>${tagsHtml(p)}</span>${ICON.chev}</button>`;
function patientList() {
  if (!state.patients.length) {
    return `<div class="inline-box" style="margin-top:18px">
      <p><b>لا يوجد مرضى في القائمة بعد.</b></p>
      <p class="hint">في أول استخدام أضف المرضى الموجودين في القسم الآن (لا يُحسبون دخولاً جديداً)، ثم سجّل الدخول الجديد كالمعتاد.</p>
      <div class="row-btns"><button type="button" class="btn primary" data-act="admit-open" data-v="existing">إضافة مريض موجود</button><button type="button" class="btn" data-act="admit-open">دخول جديد</button></div>
    </div>`;
  }
  const q = norm(ui.q);
  let html = '';
  for (const g of GROUPS) {
    if (ui.filter !== 'all' && ui.filter !== g.loc) continue;
    let list = state.patients.filter(g.f);
    if (q) list = list.filter(p => norm(p.name).includes(q) || norm(p.bed) === q);
    if (!list.length) continue;
    list.sort((a, b) => bedNum(a.bed) - bedNum(b.bed));
    html += `<section class="group"><h3><span>${g.t}</span><span class="num">${list.length}</span></h3><div class="list">${list.map(row).join('')}</div></section>`;
  }
  return html || `<p class="empty">${q ? 'لا يوجد مريض بهذا الاسم.' : 'لا يوجد مرضى هنا.'}</p>`;
}
function viewPatients() {
  const c = counts(), n = t => evOf(t).length;
  const stat = (label, v, cls) => `<div class="stat ${cls || ''}"><b>${v}</b><span>${label}</span></div>`;
  const mv = (label, v) => `<span class="mv"><b>${v}</b> ${label}</span>`;
  return `
  <div class="stats">
    ${stat('العدد الكلي', c.total, 'total')}${stat('القسم', c.dept)}${stat('القاعة', c.hall)}
    ${stat('قلب رجال', c.cm)}${stat('قلب نساء', c.cf)}${stat('باطنة', c.im)}
  </div>
  <button type="button" class="moves" data-act="tab" data-v="day">
    <span class="lbl">حركة الفترة منذ ${esc(periodLabel())}</span>
    ${mv('دخول', n('admit'))}${mv('خروج', n('discharge'))}${mv('DAMA', n('dama'))}${mv('هروب', n('escape'))}${mv('تحويل', n('transfer'))}${mv('وفاة', n('death'))}
  </button>
  <div class="toolbar">
    <input id="q" class="input" type="search" placeholder="ابحث بالاسم أو رقم السرير" value="${esc(ui.q)}" autocomplete="off" aria-label="بحث">
    <div class="seg" role="group" aria-label="المكان">
      ${segBtn('filter', 'f', 'all', 'الكل', ui.filter)}${segBtn('filter', 'f', 'dept', 'القسم', ui.filter)}${segBtn('filter', 'f', 'hall', 'القاعة', ui.filter)}
    </div>
    <button type="button" class="btn primary only-wide" data-act="admit-open">${ICON.plus} دخول جديد</button>
  </div>
  <div id="plist">${patientList()}</div>
  ${state.patients.length ? '<p class="hint" style="margin-top:16px;text-align:center"><button type="button" class="btn sm ghost" data-act="admit-open" data-v="existing">+ إضافة مريض موجود (لا يُحسب دخولاً)</button></p>' : ''}`;
}

/* ---------- day view ---------- */
const EVT = {admit:['دخول','new'], discharge:['خروج','info'], dama:['DAMA','risk'], escape:['هروب','risk'], transfer:['تحويل','info'], death:['وفاة','danger'], spec:['تخصص',''], move:['نقل داخلي','']};
function evRow(e) {
  const [t, c] = EVT[e.type] || [e.type, ''];
  let d = '';
  if (e.type === 'admit') d = 'من ' + e.p.source;
  else if (e.type === 'transfer') d = 'إلى ' + e.to;
  else if (e.type === 'spec') d = e.to === 'internal' ? `من القلب إلى ${e.sub || 'الباطنة'}` : 'من الباطنة إلى القلب';
  else if (e.type === 'move') d = e.to === 'dept' ? 'من القاعة إلى القسم' : 'من القسم إلى القاعة';
  const by = staffName(e.by);
  return `<li class="ev"><span class="tag ${c}">${t}</span><div class="ev-main"><b>${esc(e.p.name)}</b><small>${d ? esc(d) + ' · ' : ''}${fmtWhen(e.at)}${by ? ' · ح/ ' + esc(by) : ''}</small></div><button type="button" class="btn sm ghost" data-act="ev-undo" data-v="${e.id}">إلغاء</button></li>`;
}
function counter(k, label) {
  return `<div class="counter"><span>${label}</span><div class="stepper"><button type="button" data-act="cnt" data-k="${k}" data-v="-1" aria-label="إنقاص ${label}">−</button><output>${state.counters[k]}</output><button type="button" data-act="cnt" data-k="${k}" data-v="1" aria-label="زيادة ${label}">+</button></div></div>`;
}
function viewDay() {
  const evs = state.events.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const k = state.counters, auto = autoNotes(), pool = teamPool();
  return `
  <section class="sec">
    <div class="sec-h"><h2>حركة الفترة</h2><span class="meta">منذ ${esc(periodLabel())}</span></div>
    ${evs.length ? `<ul class="events">${evs.map(evRow).join('')}</ul>` : '<p class="empty">لا توجد حركة في هذه الفترة بعد. الدخول والخروج يظهران هنا.</p>'}
  </section>
  <section class="sec">
    <h2>العناية الدوائية ونقل الدم</h2>
    <div class="counters">${counter('blood', 'حالات نقل الدم')}${counter('peth', 'بيثدين')}${counter('morph', 'مورفين')}</div>
  </section>
  <section class="sec">
    <h2>الشراشف</h2>
    <div class="counters">${counter('under', 'تحت المرضى')}${counter('dirty', 'المتسخة')}${counter('clean', 'النظيفة')}<div class="counter total"><span>الإجمالي</span><output>${k.under + k.dirty + k.clean}</output></div></div>
  </section>
  <section class="sec">
    <h2>ملاحظات عامة</h2>
    ${auto.length ? `<ul class="notes">${auto.map(t => `<li><span class="t">${esc(t)}</span><span class="tag">تلقائي</span></li>`).join('')}</ul>` : ''}
    ${state.notes.length ? `<ul class="notes">${state.notes.map(n => `<li><span class="t">${esc(n.text)}</span><button type="button" class="icon-btn" data-act="note-pin" data-v="${n.id}" aria-pressed="${!!n.pinned}" aria-label="تثبيت للفترة القادمة" title="تبقى بعد إصدار التقرير">${ICON.pin}</button><button type="button" class="icon-btn" data-act="note-del" data-v="${n.id}" aria-label="حذف">${ICON.trash}</button></li>`).join('')}</ul>` : ''}
    <div class="addrow"><input id="note-input" class="input" placeholder="اكتب ملاحظة" autocomplete="off" aria-label="ملاحظة جديدة"><button type="button" class="btn primary" data-act="note-add">إضافة</button></div>
    <div class="chips" style="margin-top:8px">${NOTE_TPL.map(t => chip(esc(t.replace(/: $/, '…')), false, 'note-tpl', t)).join('')}</div>
    <p class="hint" style="margin-top:8px">ملاحظات القسطرة وDAMA والهروب تُكتب تلقائياً. الدبوس يُبقي الملاحظة بعد إصدار التقرير.</p>
  </section>
  <section class="sec">
    <h2>الفريق المناوب</h2>
    <div class="chips">${pool.map(s => chip('ح/ ' + esc(s.name), state.team.includes(s.id), 'team-toggle', s.id)).join('') || '<p class="hint">لا يوجد أسماء بعد.</p>'}</div>
    <div class="addrow" style="margin-top:10px"><input id="staff-input" class="input" placeholder="اسم من غير حساب في البرنامج" autocomplete="off" aria-label="اسم إضافي"><button type="button" class="btn" data-act="staff-add">إضافة</button></div>
    <h3 class="flabel" style="margin:16px 0 8px">الحكيم/ة المسؤول/ة</h3>
    <div class="chips">${state.team.filter(id => staffName(id)).map(id => chip('ح/ ' + esc(staffName(id)), state.responsible === id, 'resp-set', id)).join('') || '<p class="hint">اختر الفريق أولاً.</p>'}</div>
  </section>
  <section class="sec" id="opening">
    <h2>افتتاحية التقرير</h2>
    <div class="bubble mini">${richText(currentDua())}</div>
    <div id="op-box" class="op-box">${opBoxInner()}</div>
  </section>`;
}

/* ---------- report opening (ready-made list) ---------- */
function pick3(cat, avoid) {
  const all = OPENINGS[cat].map((_, i) => i);
  const pool = all.filter(i => !avoid.includes(i));
  const src = pool.length >= 3 ? pool : all;
  for (let i = src.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [src[i], src[j]] = [src[j], src[i]]; }
  return src.slice(0, 3);
}
function opBoxInner() {
  const o = ui.op, sel = state.opening;
  if (!o.shown.length) o.shown = pick3(o.cat, []);
  return `
    <div class="op-h"><b>اختر من القائمة</b><span class="hint">${OP_ALL.length} جملة جاهزة، وتعمل بدون إنترنت.</span></div>
    <div class="chips">${OP_CATS.map(([k, l]) => chip(l, o.cat === k, 'op-cat', k)).join('')}</div>
    <div class="radio-list">${o.shown.map(i => { const it = OPENINGS[o.cat][i]; return `<button type="button" class="radio" data-act="op-pick" data-v="${i}" aria-pressed="${!!(sel && sel.text === it.text)}"><span class="rd"></span><span><b>${esc(it.before)} ${esc(it.head)} ${esc(it.after)}</b><br>${esc(it.text)} ${esc(it.end)}</span></button>`; }).join('')}</div>
    <button type="button" class="btn" data-act="op-more">اقترح غيرها</button>
    <button type="button" class="radio" data-act="op-auto" aria-pressed="${!sel}"><span class="rd"></span><span><b>تلقائي</b><br><span class="hint">جملة مختلفة كل يوم من كل الأنواع</span></span></button>`;
}
function renderOp() { if (!state) return; const el = $('op-box'); if (el) el.innerHTML = opBoxInner(); }

/* ---------- report view ---------- */
function viewReport() {
  const text = buildReport(), w = checks();
  return `
  <div class="rep-actions">
    <button type="button" class="btn primary lg" data-act="copy">${ICON.copy} نسخ التقرير</button>
    <a class="btn lg" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ICON.send} فتح بالواتساب</a>
  </div>
  ${ui.copyFallback ? `<div class="inline-box" style="margin-top:12px"><p>النسخ التلقائي لم ينجح هنا. حدد النص وانسخه يدوياً.</p><textarea id="fallback" class="input" readonly>${esc(text)}</textarea></div>` : ''}
  ${w.length ? `<ul class="checks">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  <div class="opening-row"><span class="hint">الافتتاحية:</span><b>${esc(currentDua().split('\n')[0].replace(/\*/g, ' ').trim())}</b><button type="button" class="btn sm" data-act="goto-opening">تغيير</button></div>
  <div class="bubble only-narrow">${richText(text)}</div>
  <section class="sec" style="margin-top:20px">
    ${ui.issueConfirm ? `<div class="inline-box">
      <p><b>إصدار التقرير وبدء فترة جديدة</b></p>
      <ul class="plain">
        <li>يُحفظ التقرير في الأرشيف.</li>
        <li>تبدأ حركة الفترة من الصفر (دخول، خروج، DAMA، هروب، تحويل، وفاة).</li>
        <li>تصبح الحالات الجديدة (القرح و High risk) قديمة.</li>
        <li>يعود نقل الدم والبيثدين والمورفين إلى صفر.</li>
        <li>يبقى المرضى وعلاماتهم كما هم، وتبقى الملاحظات المثبتة.</li>
      </ul>
      <div class="row-btns"><button type="button" class="btn primary" data-act="issue-confirm">تأكيد الإصدار</button><button type="button" class="btn" data-act="issue-cancel">إلغاء</button></div>
    </div>` : '<button type="button" class="btn block" data-act="issue-open">إصدار التقرير وبدء فترة جديدة</button>'}
  </section>
  <section class="sec archive">
    <h2>التقارير السابقة</h2>
    ${state.archive.length ? `<div class="list">${state.archive.map(a => { const d = new Date(a.at); return `<button type="button" class="prow" data-act="archive-open" data-v="${a.id}"><span class="pmain"><span class="pname">${DAYS[d.getDay()]} ${fmtDate(d)}</span><small>${fmtTime(d)} · أصدره ح/ ${esc(a.by)}</small></span>${ICON.chev}</button>`; }).join('')}</div>` : '<p class="hint">عند إصدار أول تقرير يظهر هنا، ويمكنك فتحه ونسخه في أي وقت.</p>'}
  </section>`;
}
function viewAside() {
  return `<div class="aside-h"><div><h2>التقرير مباشرة</h2><span class="meta">يتحدث مع كل تعديل</span></div><button type="button" class="btn sm" data-act="copy">${ICON.copy} نسخ</button></div><div class="bubble">${richText(buildReport())}</div>`;
}

/* ---------- sheets ---------- */
function sheetAdmit() {
  const d = draft, hall = d.loc === 'hall', existing = d.mode === 'existing';
  const names = state.known.filter(n => !state.patients.some(p => p.name === n));
  return `${head(existing ? 'إضافة مريض موجود' : 'دخول جديد', existing ? 'مريض موجود في القسم من قبل، ولا يُحسب دخولاً' : 'الاسم بالكتابة، والباقي اختيارات')}
  <div class="blk">
    <div class="seg">${segBtn('d-set', 'mode', 'new', 'دخول جديد', d.mode)}${segBtn('d-set', 'mode', 'existing', 'مريض موجود', d.mode)}</div>
    <div class="grid-2">
      <div class="field"><label class="flabel" for="ad-name">اسم المريض</label><input id="ad-name" class="input" list="known-names" data-draft="name" value="${esc(d.name)}" placeholder="الاسم الثلاثي" autocomplete="off"></div>
      <div class="field"><label class="flabel" for="ad-bed">السرير</label><input id="ad-bed" class="input" data-draft="bed" value="${esc(d.bed)}" placeholder="اختياري" autocomplete="off"></div>
    </div>
    <datalist id="known-names">${names.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    <div class="field"><span class="flabel">الجنس</span><div class="seg">${segBtn('d-set', 'gender', 'm', 'رجل', d.gender)}${segBtn('d-set', 'gender', 'f', 'امرأة', d.gender)}</div></div>
    <div class="field"><span class="flabel">المكان</span><div class="seg">${segBtn('d-set', 'loc', 'dept', 'القسم', d.loc)}${segBtn('d-set', 'loc', 'hall', 'القاعة', d.loc)}</div></div>
    <div class="field"><span class="flabel">التخصص</span><div class="seg">${segBtn('d-set', 'spec', 'cardio', 'قلب', hall ? 'internal' : d.spec, hall)}${segBtn('d-set', 'spec', 'internal', 'باطنة', hall ? 'internal' : d.spec)}</div>${hall ? '<p class="hint">القاعة للباطنة فقط.</p>' : ''}</div>
    ${existing ? '' : `<div class="field"><span class="flabel">قادم من</span><div class="chips">${SOURCES.map(s => chip(esc(s), d.source === s, 'd-set', s, 'data-k="source"')).join('')}</div></div>`}
    <div class="field"><span class="flabel">Braden <span class="hint">(اختياري، ويمكن إضافته لاحقاً)</span></span><div class="chips tight">${[10,11,12,13,14,15,16,17,18].map(n => chip(n, d.braden === n, 'd-set', n, 'data-k="braden"')).join('')}</div></div>
    <div class="switches">${sw('Urinary Foley Catheter', 'd-set', 'foley', d.foley)}${sw('Central line', 'd-set', 'cl', d.cl)}</div>
    ${ui.admitErr ? `<p class="err" role="alert">${esc(ui.admitErr)}</p>` : ''}
    <button type="button" class="btn primary lg block" data-act="admit-save">${existing ? 'إضافة المريض' : 'تسجيل الدخول'}</button>
  </div>`;
}
function soreEditor() {
  const sd = ui.soreDraft, ready = sd.degree && sd.sites.length;
  const custom = sd.sites.filter(s => !SITES.includes(s));
  return `<div class="inline-box">
    <span class="flabel">الدرجة</span>
    <div class="chips">${DEGREES.map(([k, l]) => chip(l, sd.degree === k, 'sd-degree', k)).join('')}</div>
    <span class="flabel">المكان (يمكن اختيار أكثر من مكان)</span>
    <div class="chips" dir="ltr">${SITES.concat(custom).map(s => chip(esc(s), sd.sites.includes(s), 'sd-site', s)).join('')}</div>
    <div class="addrow"><input id="sd-custom" class="input" dir="ltr" placeholder="مكان آخر بالإنجليزي" autocomplete="off" aria-label="مكان آخر"><button type="button" class="btn" data-act="sd-custom">إضافة</button></div>
    <span class="flabel">الحالة</span>
    <div class="seg">${segBtn('sd-new', 'n', '1', 'جديدة (ظهرت الآن)', sd.isNew ? '1' : '0')}${segBtn('sd-new', 'n', '0', 'قديمة (موجودة من قبل)', sd.isNew ? '1' : '0')}</div>
    <div class="preview ${ready ? '' : 'muted'}">${ready ? esc(soreText(sd)) : 'اختر الدرجة والمكان، وتُكتب الجملة تلقائياً'}</div>
    <div class="row-btns"><button type="button" class="btn primary" data-act="sd-save" ${ready ? '' : 'disabled'}>حفظ القرحة</button><button type="button" class="btn" data-act="sd-cancel">إلغاء</button></div>
  </div>`;
}
function followEditor(p) {
  const f = p.follow, allV = VITALS.every(v => f.vitals.includes(v)), lines = followLines(p);
  return `
    <div class="field"><span class="flabel">Vital signs</span>
      <div class="chips" dir="ltr">${chip('All', allV, 'fu-vital', 'all')}${VITALS.map(v => chip(v, f.vitals.includes(v), 'fu-vital', v)).join('')}</div></div>
    <div class="field"><span class="flabel">المراقبة</span>
      <div class="chips" dir="ltr">${chip('Urine output (UOP)', f.uop, 'fu-flag', 'uop')}${chip('Random blood sugar (RBS)', f.rbs, 'fu-flag', 'rbs')}</div></div>
    <div class="field"><span class="flabel">Change position</span>
      <div class="chips">${chip('لا', !f.position, 'fu-pos', '')}${['2','3','4'].map(h => chip(`كل ${h} ساعات`, f.position === h, 'fu-pos', h)).join('')}</div></div>
    <div class="field"><span class="flabel">Syringe pump</span>
      ${f.pumps.length ? `<ul class="pumps">${f.pumps.map(m => `<li><span class="en">${esc(m.med)}${m.rate ? ' · ' + esc(m.rate) + ' ml/hr' : ''}</span><button type="button" class="icon-btn" data-act="pump-del" data-v="${m.id}" aria-label="حذف">${ICON.trash}</button></li>`).join('')}</ul>` : ''}
      <div class="chips" dir="ltr">${PUMP_MEDS.map(m => chip(m, false, 'pump-med', m)).join('')}</div>
      <div class="pump-add">
        <input id="pump-med" class="input" dir="ltr" placeholder="Medication name" autocomplete="off" aria-label="اسم الدواء">
        <input id="pump-rate" class="input" dir="ltr" inputmode="decimal" placeholder="ml/hr" autocomplete="off" aria-label="المعدل بالساعة">
        <button type="button" class="btn" data-act="pump-add">إضافة</button>
      </div>
      ${ui.pumpErr ? `<p class="err">${esc(ui.pumpErr)}</p>` : ''}
    </div>
    <div class="field"><span class="flabel">Pain score <span class="hint">(مع pain management)</span></span>
      <div class="chips tight" dir="ltr">${[0,1,2,3,4,5,6,7,8,9,10].map(n => chip(n, f.pain === n, 'fu-pain', n)).join('')}${f.pain != null ? chip('مسح', false, 'fu-pain', '') : ''}</div></div>
    <div class="field"><span class="flabel">الأكسجين (Venturi mask)</span>
      <div class="chips" dir="ltr">${VENTURI.map(v => chip(`<i class="dot" style="background:${v.c}" title="${v.n}"></i>${v.p}%`, f.venturi && f.venturi.p === v.p, 'fu-venturi', v.p)).join('')}</div>
      ${f.venturi ? `<div class="braden"><span class="hint">الجريان</span><div class="stepper"><button type="button" data-act="fu-l" data-v="-1" aria-label="إنقاص">−</button><output dir="ltr">${f.venturi.l}L</output><button type="button" data-act="fu-l" data-v="1" aria-label="زيادة">+</button></div></div>` : ''}</div>
    <div class="field"><label class="flabel" for="pf-other">Others</label><input id="pf-other" class="input" dir="auto" data-pfield="other" value="${esc(f.other)}" placeholder="أي متابعة أخرى" autocomplete="off"></div>
    <div class="field"><span class="flabel">كما سيظهر في التقرير</span><div class="preview ${lines.length ? '' : 'muted'}">${lines.length ? lines.map(esc).join('<br>') : 'اختر من الأعلى'}</div></div>`;
}
function sheetPatient(p) {
  const specT = p.spec === 'cardio' ? 'قلب' : 'باطنة' + (p.sub ? ` (${esc(p.sub)})` : '');
  const exitBtn = (v, t, s, cls) => `<button type="button" class="btn ${cls || ''}" data-act="p-exit" data-v="${v}" aria-pressed="${ui.exitMode === v}"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</button>`;
  return `${head(esc(p.name), `${p.loc === 'dept' ? 'القسم' : 'القاعة'} · ${specT} · ${p.gender === 'm' ? 'رجل' : 'امرأة'}`, `<span class="bed lg">${esc(p.bed || '–')}</span>`)}
  ${p.edit ? `<p class="meta">آخر تعديل: ح/ ${esc(p.edit.by)} · ${fmtWhen(p.edit.at)}</p>` : ''}
  <section class="blk">
    <h4>خروج المريض</h4>
    <div class="exit-grid">
      ${exitBtn('discharge', 'خروج', 'بورقة الطبيب')}${exitBtn('dama', 'DAMA', 'على مسؤوليته')}${exitBtn('escape', 'هروب', 'Escape')}
      ${exitBtn('transfer', 'تحويل', 'لمستشفى أو قسم', 'wide')}${exitBtn('death', 'وفاة', '', 'wide death')}
    </div>
    ${ui.exitMode === 'transfer' ? `<div class="inline-box">
      <label class="flabel" for="tr-dest">إلى أين تم التحويل؟</label>
      <input id="tr-dest" class="input" value="${esc(ui.trDest)}" placeholder="اسم المستشفى أو القسم" autocomplete="off">
      <div class="chips">${TR_DEST.map(t => chip(esc(t), ui.trDest === t, 'tr-chip', t)).join('')}</div>
      ${ui.trErr ? `<p class="err">${esc(ui.trErr)}</p>` : ''}
      <div class="row-btns"><button type="button" class="btn primary" data-act="transfer-confirm">تسجيل التحويل</button><button type="button" class="btn" data-act="exit-cancel">إلغاء</button></div>
    </div>` : ''}
    ${ui.exitMode === 'death' ? `<div class="inline-box warn">
      <p>تأكيد تسجيل وفاة ${who(p)} ${esc(p.name)}؟</p>
      <div class="row-btns"><button type="button" class="btn danger" data-act="death-confirm">تأكيد</button><button type="button" class="btn" data-act="exit-cancel">إلغاء</button></div>
    </div>` : ''}
    <p class="hint">DAMA والهروب لا يُحسبان ضمن الخروج، ويُكتبان في الملاحظات تلقائياً.</p>
  </section>
  <section class="blk">
    <h4>الوضع الحالي</h4>
    <div class="switches">${sw('في القسطرة القلبية', 'p-toggle', 'cath', p.cath, 'يبقى محسوباً، ويُكتب في الملاحظات')}</div>
    <div class="field"><span class="flabel">المكان</span>
      <div class="seg">${segBtn('p-loc', 'loc', 'dept', 'القسم', p.loc)}${segBtn('p-loc', 'loc', 'hall', 'القاعة', p.loc, p.spec === 'cardio')}</div>
      ${p.spec === 'cardio' ? '<p class="hint">القاعة للباطنة فقط (لا يوجد فيها أكسجين).</p>' : ''}</div>
    <div class="field"><span class="flabel">التخصص</span>
      <div class="seg">${segBtn('p-spec', 'spec', 'cardio', 'قلب', p.spec, p.loc === 'hall')}${segBtn('p-spec', 'spec', 'internal', 'باطنة', p.spec)}</div>
      ${p.loc === 'hall' ? '<p class="hint">لتحويله للقلب انقله إلى القسم أولاً.</p>' : ''}
      ${ui.specPick ? `<div class="inline-box"><span class="flabel">خروج من القلب إلى:</span><div class="chips">${SUBSPECS.map(s => chip(esc(s), false, 'p-sub', s)).join('')}</div><button type="button" class="btn sm" data-act="spec-cancel">إلغاء</button></div>` : ''}</div>
    <div class="field"><span class="flabel">مشترك مع قسم آخر</span>
      <div class="chips">${chip('لا', !p.shared, 'p-shared', '')}${SHARED.map(o => chip(esc(o), p.shared === o, 'p-shared', o)).join('')}</div></div>
  </section>
  <section class="blk">
    <h4>العناية</h4>
    <div class="switches">${sw('Urinary Foley Catheter', 'p-toggle', 'foley', p.foley)}${sw('Central line', 'p-toggle', 'cl', p.cl)}${sw('فرشة هوائية', 'p-toggle', 'air', p.air)}</div>
  </section>
  <section class="blk">
    <h4>Braden Scale</h4>
    <div class="braden">
      <div class="stepper"><button type="button" data-act="p-braden" data-v="-1" aria-label="إنقاص">−</button><output>${p.braden ?? '–'}</output><button type="button" data-act="p-braden" data-v="1" aria-label="زيادة">+</button></div>
      <span class="bstate ${isHR(p) ? 'risk' : ''}">${p.braden == null ? 'غير مسجل' : isHR(p) ? 'High risk' : 'ليس High risk'}</span>
      ${p.braden != null ? '<button type="button" class="btn sm ghost" data-act="p-braden-clear">مسح</button>' : ''}
    </div>
    <div class="chips tight">${[10,11,12,13,14,15,16,17,18].map(n => chip(n, p.braden === n, 'p-braden-set', n)).join('')}</div>
    ${isHR(p) ? `<div class="seg">${segBtn('p-bnew', 'n', '1', 'حالة جديدة', p.bradenNew ? '1' : '0')}${segBtn('p-bnew', 'n', '0', 'حالة قديمة', p.bradenNew ? '1' : '0')}</div>` : ''}
    <p class="hint">18 أو أقل = High risk، ويُضاف للتقرير تلقائياً.</p>
  </section>
  <section class="blk">
    <h4>قرح الفراش</h4>
    ${p.sores.length ? `<ul class="sores">${p.sores.map(s => `<li><span class="en">${esc(soreText(s))}</span><button type="button" class="chip" data-act="sore-age" data-v="${s.id}" aria-pressed="${!!s.isNew}" title="اضغط للتبديل بين جديدة وقديمة">${s.isNew ? 'جديدة' : 'قديمة'}</button><button type="button" class="icon-btn" data-act="sore-del" data-v="${s.id}" aria-label="حذف">${ICON.trash}</button></li>`).join('')}</ul>` : '<p class="hint">لا توجد قرح مسجلة.</p>'}
    ${ui.soreDraft ? soreEditor() : '<button type="button" class="btn block dashed" data-act="sore-new">+ إضافة قرحة</button>'}
  </section>
  <section class="blk">
    <h4>متابعة خاصة</h4>
    <div class="switches">${sw('يحتاج إلى متابعة خاصة', 'p-toggle', 'follow', p.follow.on)}</div>
    ${p.follow.on ? followEditor(p) : ''}
  </section>
  <section class="blk">
    <h4>تعديل البيانات</h4>
    <div class="grid-2">
      <div class="field"><label class="flabel" for="pf-name">الاسم</label><input id="pf-name" class="input" data-pfield="name" value="${esc(p.name)}" autocomplete="off"></div>
      <div class="field"><label class="flabel" for="pf-bed">السرير</label><input id="pf-bed" class="input" data-pfield="bed" value="${esc(p.bed)}" autocomplete="off"></div>
    </div>
    <div class="field"><span class="flabel">الجنس</span><div class="seg">${segBtn('p-gender', 'gender', 'm', 'رجل', p.gender)}${segBtn('p-gender', 'gender', 'f', 'امرأة', p.gender)}</div></div>
    ${ui.delConfirm ? `<div class="inline-box warn"><p>حذف ${esc(p.name)} من القائمة؟ استخدمه فقط إذا أُدخل بالخطأ، ولن يظهر في الخروج.</p><div class="row-btns"><button type="button" class="btn danger" data-act="p-del-confirm">حذف</button><button type="button" class="btn" data-act="p-del-cancel">إلغاء</button></div></div>` : '<button type="button" class="btn ghost danger-text" data-act="p-del">حذف المريض (إدخال بالخطأ)</button>'}
  </section>`;
}
function sheetAccount() {
  const m = me(), u = auth.currentUser, uname = u && u.email ? u.email.split('@')[0] : '';
  return `${head('ح/ ' + esc(m.name), `<span dir="ltr">${esc(uname)}</span> · ${m.role === 'admin' ? 'مدير' : 'حكيم/ة'}`, `<span class="avatar">${esc((m.name || '?').charAt(0))}</span>`)}
  ${isAdmin() ? `<section class="blk"><h4>المدير</h4><button type="button" class="btn primary block" data-act="staff-open">إدارة الطاقم والحسابات</button></section>` : ''}
  <section class="blk">
    <h4>تغيير كلمة السر</h4>
    <div class="field"><label class="flabel" for="pw-old">كلمة السر الحالية</label><input id="pw-old" class="input" type="password" autocomplete="current-password" dir="ltr"></div>
    <div class="field"><label class="flabel" for="pw-new">كلمة السر الجديدة</label><input id="pw-new" class="input" type="password" autocomplete="new-password" dir="ltr" placeholder="6 أحرف أو أكثر"></div>
    ${ui.pw.err ? `<p class="err">${esc(ui.pw.err)}</p>` : ''}${ui.pw.msg ? `<p class="okmsg">${esc(ui.pw.msg)}</p>` : ''}
    <button type="button" class="btn" data-act="pw-change" ${ui.pw.busy ? 'disabled' : ''}>تغيير كلمة السر</button>
  </section>
  <section class="blk">
    <h4>تسجيل الخروج</h4>
    <p class="hint">يمسح بيانات القسم من هذا الجهاز. استخدمه إذا كان الجهاز مشتركاً أو ليس جهازك.</p>
    ${ui.logoutConfirm ? `<div class="inline-box warn"><p>في ${pending} تعديل لم يُرسل بعد لأن الجهاز غير متصل. إذا خرجت الآن ستضيع هذه التعديلات.</p><div class="row-btns"><button type="button" class="btn danger" data-act="logout-force">خروج على أي حال</button><button type="button" class="btn" data-act="logout-cancel">إلغاء</button></div></div>` : '<button type="button" class="btn danger-text" data-act="logout">تسجيل الخروج</button>'}
  </section>`;
}
function sheetStaff() {
  const n = ui.nf, list = state.staff.slice().sort((a, b) => (b.active - a.active) || String(a.name).localeCompare(String(b.name), 'ar'));
  return `${head('إدارة الطاقم', 'حسابات الدخول إلى البرنامج')}
  <section class="blk">
    <h4>إضافة حكيم/ة</h4>
    <div class="field"><label class="flabel" for="nf-name">الاسم كما يظهر في التقرير</label><input id="nf-name" class="input" data-nf="name" value="${esc(n.name)}" placeholder="مثلاً: حنان طوطح" autocomplete="off"></div>
    <div class="grid-2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="field"><label class="flabel" for="nf-user">اسم المستخدم</label><input id="nf-user" class="input" data-nf="user" value="${esc(n.user)}" dir="ltr" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="hanan"></div>
      <div class="field"><label class="flabel" for="nf-pass">كلمة السر</label><input id="nf-pass" class="input" data-nf="pass" value="${esc(n.pass)}" dir="ltr" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="6+"></div>
    </div>
    <p class="hint">اسم المستخدم بالإنجليزي: حروف صغيرة وأرقام، 3 أحرف أو أكثر.</p>
    <div class="field"><span class="flabel">الصلاحية</span><div class="seg">${segBtn('nf-role', 'r', 'nurse', 'حكيم/ة', n.role)}${segBtn('nf-role', 'r', 'admin', 'مدير', n.role)}</div></div>
    ${n.err ? `<p class="err">${esc(n.err)}</p>` : ''}
    ${n.msg ? `<div class="inline-box"><p class="okmsg">${esc(n.msg.title)}</p><div class="cred">user: ${esc(n.msg.user)}<br>password: ${esc(n.msg.pass)}</div><p class="hint">أعطِ هذه البيانات للحكيم/ة، ويمكنه تغيير كلمة السر من حسابه.</p></div>` : ''}
    <button type="button" class="btn primary block" data-act="nf-create" ${n.busy ? 'disabled' : ''}>${n.busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}</button>
  </section>
  <section class="blk">
    <h4>الحسابات (${list.length})</h4>
    <div class="list">${list.map(s => {
      const self = s.id === session.uid;
      return `<div class="staff-row ${s.active ? '' : 'off'}"><span class="avatar">${esc((s.name || '?').charAt(0))}</span><span class="pmain"><span class="pname">${esc(s.name)}${s.role === 'admin' ? ' <span class="tag new">مدير</span>' : ''}</span><small>${esc(s.username || '')}</small></span>
        ${self ? '<span class="tag">أنت</span>' : `<button type="button" class="btn sm" data-act="st-role" data-v="${s.id}">${s.role === 'admin' ? 'إلغاء المدير' : 'اجعله مدير'}</button><button type="button" class="btn sm ${s.active ? 'danger-text' : ''}" data-act="st-active" data-v="${s.id}">${s.active ? 'إيقاف' : 'تفعيل'}</button>`}</div>`;
    }).join('')}</div>
    <p class="hint">إذا نسي حكيم كلمة السر: أوقف حسابه القديم وأنشئ له حساباً جديداً باسم مستخدم آخر.</p>
  </section>`;
}
function sheetArchive(a) {
  const d = new Date(a.at);
  return `${head(`تقرير ${DAYS[d.getDay()]} ${fmtDate(d)}`, `أصدره ح/ ${esc(a.by)} · ${fmtTime(d)}`)}
  <div class="blk"><button type="button" class="btn primary block" data-act="copy-archive" data-v="${a.id}">${ICON.copy} نسخ هذا التقرير</button><div class="bubble" style="margin-top:0">${richText(a.text)}</div></div>`;
}

/* ---------- render ---------- */
// Live updates re-render the screen. A re-render between a finger going down and coming up
// replaces the button under it and the tap is lost, so renders wait until the pointer is released.
let rafId = 0, pointerDown = false, renderWanted = false;
function scheduleRender() {
  if (pointerDown) { renderWanted = true; return; }
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
const releasePointer = () => { pointerDown = false; if (renderWanted) { renderWanted = false; setTimeout(scheduleRender, 0); } };
document.addEventListener('pointerup', releasePointer, true);
document.addEventListener('pointercancel', releasePointer, true);
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id || !(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return null;
  let s = null, e = null;
  try { s = a.selectionStart; e = a.selectionEnd; } catch (x) { /* not a text field */ }
  return {id:a.id, value:a.value, s, e};
}
function restoreFocus(f) {
  if (!f) return;
  const el = $(f.id);
  if (!el) return;
  if (el.value !== f.value) el.value = f.value;
  if (document.activeElement !== el) el.focus({preventScroll:true});
  try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (x) { /* not a text field */ }
}
function showShell() { $('gate').hidden = true; $('shell').hidden = false; updateNet(); }
function render() {
  if (!state || !session.ready) return;
  const f = captureFocus();
  $('hdr-period').textContent = 'الفترة منذ ' + periodLabel();
  const u = me();
  $('user-chip').innerHTML = `<span class="avatar">${esc((u.name || '?').charAt(0))}</span><span>ح/ ${esc(u.name)}</span>`;
  $('user-chip').setAttribute('aria-label', 'حسابي: ح/ ' + u.name);
  $('view').innerHTML = ui.tab === 'patients' ? viewPatients() : ui.tab === 'day' ? viewDay() : viewReport();
  $('aside').innerHTML = viewAside();
  const labels = {patients:[ICON.bed, 'المرضى'], day:[ICON.day, 'اليوم'], report:[ICON.report, 'التقرير']};
  document.querySelectorAll('.tab').forEach(b => {
    const [ic, t] = labels[b.dataset.v];
    b.innerHTML = ic + `<span>${t}</span>`;
    if (b.dataset.v === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const fab = $('fab');
  fab.innerHTML = ICON.plus + '<span>دخول جديد</span>';
  fab.hidden = ui.tab !== 'patients';
  renderSheet(true);
  restoreFocus(f);
}
function renderSheet(inRender) {
  const root = $('sheet-root');
  const f = inRender ? null : captureFocus();
  const old = root.querySelector('.sheet');
  const st = old && !ui.sheetNew ? old.scrollTop : 0;
  let inner = '', label = '';
  if (ui.sheet && state) {
    const t = ui.sheet.type;
    if (t === 'patient') { const p = cur(); if (p) { inner = sheetPatient(p); label = p.name; } }
    else if (t === 'admit') { inner = sheetAdmit(); label = draft && draft.mode === 'existing' ? 'إضافة مريض موجود' : 'دخول جديد'; }
    else if (t === 'account') { inner = sheetAccount(); label = 'حسابي'; }
    else if (t === 'staff' && isAdmin()) { inner = sheetStaff(); label = 'إدارة الطاقم'; }
    else if (t === 'archive') { const a = state.archive.find(x => x.id === ui.sheet.id); if (a) { inner = sheetArchive(a); label = 'تقرير سابق'; } }
  }
  if (!inner) { ui.sheet = null; root.innerHTML = ''; document.body.classList.remove('locked'); return; }
  root.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="sheet ${ui.sheetNew ? 'enter' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${inner}</div>`;
  root.querySelector('.sheet').scrollTop = st;
  ui.sheetNew = false;
  document.body.classList.add('locked');
  restoreFocus(f);
}
function openSheet(s) {
  Object.assign(ui, {sheet:s, sheetNew:true, exitMode:null, trDest:'', trErr:'', soreDraft:null, specPick:false, delConfirm:false, admitErr:'', dupOk:false, pumpErr:'', logoutConfirm:false});
  ui.pw = {err:'', msg:'', busy:false};
  renderSheet();
}
function closeSheet() { ui.sheet = null; renderSheet(); }
function closeSheetSilent() { ui.sheet = null; const r = $('sheet-root'); if (r) r.innerHTML = ''; document.body.classList.remove('locked'); }
const cur = () => ui.sheet && ui.sheet.type === 'patient' && state ? state.patients.find(p => p.id === ui.sheet.id) : null;

/* ---------- sign-in gate ---------- */
function renderGate() {
  $('shell').hidden = true;
  $('gate').hidden = false;
  const g = gate;
  let body = '';
  if (g.mode === 'loading') body = `<p class="hint">${esc(g.msg || 'جارٍ التحميل…')}</p>`;
  else if (g.mode === 'login') body = `
    <form id="login-form" novalidate>
      <div class="field"><label class="flabel" for="lg-user">اسم المستخدم</label><input id="lg-user" class="input" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
      <div class="field"><label class="flabel" for="lg-pass">كلمة السر</label><input id="lg-pass" class="input" type="password" autocomplete="current-password" required></div>
      <p id="gate-err" class="err" role="alert" hidden></p>
      <button type="submit" id="gate-btn" class="btn primary lg block">دخول</button>
    </form>
    <p class="hint">ما عندك حساب؟ اطلب من المدير إنشاء حساب لك.</p>`;
  else if (g.mode === 'setup') body = `
    <div class="inline-box"><p><b>إعداد البرنامج لأول مرة</b></p><p class="hint">الحساب الذي تنشئه الآن يصبح حساب المدير، ومنه تضيف باقي الطاقم.</p></div>
    <form id="setup-form" novalidate>
      <div class="field"><label class="flabel" for="su-name">اسمك كما يظهر في التقرير</label><input id="su-name" class="input rtl" autocomplete="name" required></div>
      <div class="field"><label class="flabel" for="su-user">اسم المستخدم (بالإنجليزي)</label><input id="su-user" class="input" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="admin" required></div>
      <div class="field"><label class="flabel" for="su-pass">كلمة السر</label><input id="su-pass" class="input" type="password" autocomplete="new-password" placeholder="6 أحرف أو أكثر" required></div>
      <div class="field"><label class="flabel" for="su-pass2">أعد كتابة كلمة السر</label><input id="su-pass2" class="input" type="password" autocomplete="new-password" required></div>
      <p id="gate-err" class="err" role="alert" hidden></p>
      <button type="submit" id="gate-btn" class="btn primary lg block">إنشاء حساب المدير</button>
    </form>`;
  else if (g.mode === 'rules') body = `
    <div class="inline-box warn"><p><b>قواعد الحماية في Firebase غير منشورة بعد.</b></p><p>لا يمكن إعداد البرنامج أو الدخول إليه قبل نشرها.</p></div>
    <ol class="plain">
      <li>افتح Firebase Console ثم <b>Firestore Database</b> (وليس Realtime Database).</li>
      <li>من تبويب <b>Rules</b> امسح الموجود والصق القواعد.</li>
      <li>اضغط <b>Publish</b> وانتظر دقيقة.</li>
    </ol>
    <button type="button" class="btn primary block" data-act="gate-retry">إعادة المحاولة</button>`;
  else if (g.mode === 'inactive') body = `
    <div class="inline-box warn"><p><b>هذا الحساب غير مفعّل في البرنامج.</b></p><p>${esc(g.err || 'اطلب من المدير تفعيل حسابك.')}</p></div>
    <button type="button" class="btn block" data-act="logout-force">تسجيل الخروج</button>`;
  $('gate').innerHTML = `<div class="gate-card"><div class="gate-top">${MARK}<div><h1>تقرير قسم القلب</h1><p class="hint">التقرير اليومي لقسم القلب</p></div></div>${body}</div>`;
  const first = $('gate').querySelector('input');
  if (first) first.focus();
}
function gateError(msg) {
  const e = $('gate-err'), b = $('gate-btn');
  if (e) { e.textContent = msg; e.hidden = !msg; }
  if (b) b.disabled = false;
}
function gateBusy() { gateError(''); const b = $('gate-btn'); if (b) b.disabled = true; }
function authMsg(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return 'اسم المستخدم أو كلمة السر غير صحيحة.';
  if (c.includes('email-already-in-use')) return 'اسم المستخدم هذا مستخدم من قبل. اختر اسماً آخر.';
  if (c.includes('weak-password') || c.includes('password-does-not-meet')) return 'كلمة السر ضعيفة. استخدم 6 أحرف أو أكثر.';
  if (c.includes('too-many-requests')) return 'محاولات كثيرة. انتظر قليلاً ثم حاول.';
  if (c.includes('network-request-failed') || c === 'unavailable') return 'لا يوجد اتصال بالإنترنت.';
  if (c.includes('requires-recent-login')) return 'سجّل الدخول من جديد ثم حاول.';
  if (c.includes('permission-denied')) return 'لا تملك صلاحية لهذا الإجراء.';
  if (c.includes('operation-not-allowed')) return 'الدخول بكلمة السر غير مفعّل في إعدادات Firebase.';
  return 'حدث خطأ' + (c ? ` (${c})` : '') + '.';
}
async function doLogin() {
  const u = $('lg-user').value.trim().toLowerCase(), p = $('lg-pass').value;
  if (!u || !p) return gateError('اكتب اسم المستخدم وكلمة السر.');
  if (!USER_RE.test(u)) return gateError('اسم المستخدم أو كلمة السر غير صحيحة.');
  gateBusy();
  try { await signInWithEmailAndPassword(auth, emailOf(u), p); }
  catch (e) { gateError(authMsg(e)); }
}
async function doSetup() {
  const name = $('su-name').value.trim(), u = $('su-user').value.trim().toLowerCase(), p = $('su-pass').value, p2 = $('su-pass2').value;
  if (!name) return gateError('اكتب اسمك.');
  if (!USER_RE.test(u)) return gateError('اسم المستخدم بالإنجليزي: حروف صغيرة وأرقام، 3 أحرف أو أكثر.');
  if (p.length < 6) return gateError('كلمة السر 6 أحرف أو أكثر.');
  if (p !== p2) return gateError('كلمتا السر غير متطابقتين.');
  gateBusy();
  settingUp = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, emailOf(u), p);
    const at = nowIso(), b = writeBatch(db);
    b.set(doc(db, 'staff', cred.user.uid), {name, username:u, role:'admin', active:true, createdAt:at, createdBy:cred.user.uid});
    b.set(doc(db, 'meta', 'setup'), {done:true, by:cred.user.uid, at});
    await b.commit();
    settingUp = false;
  } catch (e) {
    settingUp = false;
    if (auth.currentUser) { gate = {mode:'inactive', err:'تعذّر إكمال الإعداد: ' + authMsg(e)}; renderGate(); }
    else gateError(authMsg(e));
  }
}

/* ---------- account and staff actions ---------- */
let secondaryAuth = null;
async function createAccount(username, password) {
  if (!secondaryAuth) {
    const app2 = initializeApp(firebaseConfig, 'staff-creator');
    secondaryAuth = initializeAuth(app2, {persistence: inMemoryPersistence});
    if (__EMULATOR__) connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', {disableWarnings: true});
  }
  const cred = await createUserWithEmailAndPassword(secondaryAuth, emailOf(username), password);
  const id = cred.user.uid;
  await signOut(secondaryAuth);
  return id;
}
async function createStaff() {
  const n = ui.nf;
  n.name = ($('nf-name') ? $('nf-name').value : n.name).trim();
  n.user = ($('nf-user') ? $('nf-user').value : n.user).trim().toLowerCase();
  n.pass = $('nf-pass') ? $('nf-pass').value : n.pass;
  n.msg = '';
  const fail = m => { n.err = m; n.busy = false; renderSheet(); };
  if (!n.name) return fail('اكتب اسم الحكيم/ة.');
  if (!USER_RE.test(n.user)) return fail('اسم المستخدم بالإنجليزي: حروف صغيرة وأرقام، 3 أحرف أو أكثر.');
  if (n.pass.length < 6) return fail('كلمة السر 6 أحرف أو أكثر.');
  if (!navigator.onLine) return fail('إنشاء الحسابات يحتاج اتصالاً بالإنترنت.');
  n.busy = true; n.err = ''; renderSheet();
  try {
    const id = await createAccount(n.user, n.pass);
    await setDoc(doc(db, 'staff', id), {name:n.name, username:n.user, role:n.role, active:true, createdAt:nowIso(), createdBy:session.uid});
    ui.nf = {role:'nurse', name:'', user:'', pass:'', busy:false, err:'', msg:{title:`تم إنشاء حساب ${n.name}.`, user:n.user, pass:n.pass}};
    renderSheet();
  } catch (e) { fail(authMsg(e)); }
}
function updateStaff(id, fields) {
  setDoc(doc(db, 'staff', id), fields, {merge:true}).catch(e => showToast('لم يُحفظ: ' + authMsg(e)));
}
async function changePassword() {
  const oldp = $('pw-old').value, newp = $('pw-new').value;
  if (!oldp) { ui.pw = {err:'اكتب كلمة السر الحالية.', msg:'', busy:false}; renderSheet(); return; }
  if (newp.length < 6) { ui.pw = {err:'كلمة السر الجديدة 6 أحرف أو أكثر.', msg:'', busy:false}; renderSheet(); return; }
  ui.pw = {err:'', msg:'', busy:true}; renderSheet();
  try {
    const u = auth.currentUser;
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldp));
    await updatePassword(u, newp);
    ui.pw = {err:'', msg:'تم تغيير كلمة السر.', busy:false};
  } catch (e) { ui.pw = {err:authMsg(e), msg:'', busy:false}; }
  renderSheet();
}
async function doLogout() {
  try { if (session.meUnsub) session.meUnsub(); stopData(); await signOut(auth); } catch (e) { /* signing out anyway */ }
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { /* cache could not be cleared */ }
  location.reload();
}

/* ---------- patient actions ---------- */
function touch(p) { p.edit = {by:me().name, at:nowIso()}; }
function ev(type, p, x) { return Object.assign({id:'e' + uid(), type, at:nowIso(), by:session.uid, pid:p.id, p:clone(p)}, x || {}); }
function setBraden(p, val) {
  const was = isHR(p);
  p.braden = val == null ? null : clamp(val, 6, 23);
  const now = isHR(p);
  if (now && !was) p.bradenNew = true;
  if (!now) p.bradenNew = false;
}
function withP(fn, msg) { if (!cur()) return; commit(() => { const p = cur(); fn(p); touch(p); }, msg); }
function exitPatient(type, to) {
  const p = cur(); if (!p) return;
  const label = {discharge:'خروج', dama:'DAMA', escape:'هروب', transfer:'تحويل', death:'وفاة'}[type];
  ui.sheet = null;
  commit(() => {
    state.patients = state.patients.filter(x => x.id !== p.id);
    state.events.push(ev(type, p, to ? {to} : {}));
  }, `تم تسجيل ${label}: ${p.name}`);
}
function admitSave() {
  const name = ($('ad-name') ? $('ad-name').value : draft.name).trim();
  draft.name = name;
  draft.bed = ($('ad-bed') ? $('ad-bed').value : draft.bed).trim();
  const existing = draft.mode === 'existing';
  if (!name) { ui.admitErr = 'اكتب اسم المريض.'; renderSheet(); if ($('ad-name')) $('ad-name').focus(); return; }
  if (!draft.gender) { ui.admitErr = 'اختر رجل أو امرأة.'; renderSheet(); return; }
  if (!ui.dupOk && state.patients.some(p => norm(p.name) === norm(name))) {
    ui.admitErr = 'يوجد مريض بنفس الاسم في القسم. اضغط الزر مرة ثانية إذا كنت متأكداً.';
    ui.dupOk = true; renderSheet(); return;
  }
  const p = newPatient({name, bed:draft.bed, gender:draft.gender, loc:draft.loc, spec:draft.loc === 'hall' ? 'internal' : draft.spec, source:existing ? '' : draft.source, admitted:!existing, foley:draft.foley, cl:draft.cl});
  if (draft.braden != null) { p.braden = draft.braden; p.bradenNew = !existing && isHR(p); }
  touch(p);
  ui.sheet = null;
  const keepMode = draft.mode;
  commit(() => {
    state.patients.push(p);
    if (!existing) state.events.push(ev('admit', p));
    if (!state.known.includes(name)) state.known = state.known.concat([name]).slice(-400);
  }, existing ? `تمت إضافة: ${name}` : `تم تسجيل دخول: ${name}`);
  if (keepMode === 'existing') {
    // adding the current census is a run of entries: reopen the form, keeping place and specialty
    draft = {mode:'existing', name:'', bed:'', loc:draft.loc, spec:draft.spec, gender:null, source:'ER', braden:null, foley:false, cl:false};
    openSheet({type:'admit'});
    setTimeout(() => { const n = $('ad-name'); if (n) n.focus(); }, 80);
  }
}
function revertEvent(id) {
  const e = state.events.find(x => x.id === id); if (!e) return;
  const exits = ['discharge', 'dama', 'escape', 'transfer', 'death'];
  commit(() => {
    if (exits.includes(e.type)) {
      if (!state.patients.some(p => p.id === e.pid)) state.patients.push(newPatient(clone(e.p)));
      state.events = state.events.filter(x => x.id !== id);
    } else if (e.type === 'admit') {
      state.patients = state.patients.filter(p => p.id !== e.pid);
      state.events = state.events.filter(x => x.pid !== e.pid);
    } else if (e.type === 'spec') {
      const p = state.patients.find(x => x.id === e.pid);
      if (p) { p.spec = e.from; p.sub = e.prevSub || ''; }
      state.events = state.events.filter(x => x.id !== id);
    } else if (e.type === 'move') {
      const p = state.patients.find(x => x.id === e.pid);
      if (p) p.loc = e.from;
      state.events = state.events.filter(x => x.id !== id);
    }
  }, `تم إلغاء «${(EVT[e.type] || [e.type])[0]}»: ${e.p.name}`);
}
function copyText(text) {
  try {
    navigator.clipboard.writeText(text).then(
      () => showToast('تم نسخ التقرير. الصقه في الواتساب.'),
      () => { ui.copyFallback = true; render(); const f = $('fallback'); if (f) { f.focus(); f.select(); } }
    );
  } catch (e) { ui.copyFallback = true; render(); }
}

const H = {
  tab: el => { ui.tab = el.dataset.v; ui.issueConfirm = false; ui.copyFallback = false; render(); window.scrollTo(0, 0); },
  filter: el => { ui.filter = el.dataset.v; render(); },
  open: el => openSheet({type:'patient', id:el.dataset.id}),
  'close-sheet': closeSheet,
  'admit-open': el => {
    draft = {mode:el.dataset.v === 'existing' ? 'existing' : 'new', name:'', bed:'', loc:'dept', spec:'cardio', gender:null, source:'ER', braden:null, foley:false, cl:false};
    openSheet({type:'admit'});
    setTimeout(() => { const n = $('ad-name'); if (n) n.focus(); }, 80);
  },
  'd-set': el => {
    const k = el.dataset.k, v = el.dataset.v;
    if ($('ad-name')) draft.name = $('ad-name').value;
    if ($('ad-bed')) draft.bed = $('ad-bed').value;
    if (k === 'foley' || k === 'cl') draft[k] = !draft[k];
    else if (k === 'braden') draft.braden = draft.braden === +v ? null : +v;
    else draft[k] = v;
    if (k === 'loc' && v === 'hall') draft.spec = 'internal';
    ui.admitErr = '';
    renderSheet();
  },
  'admit-save': admitSave,
  'p-exit': el => {
    const t = el.dataset.v;
    if (t === 'transfer' || t === 'death') { ui.exitMode = ui.exitMode === t ? null : t; ui.trDest = ''; ui.trErr = ''; renderSheet(); return; }
    exitPatient(t);
  },
  'exit-cancel': () => { ui.exitMode = null; renderSheet(); },
  'tr-chip': el => { ui.trDest = el.dataset.v; ui.trErr = ''; const i = $('tr-dest'); if (i) i.value = ui.trDest; renderSheet(); },
  'transfer-confirm': () => {
    const v = ($('tr-dest') ? $('tr-dest').value : ui.trDest).trim();
    if (!v) { ui.trErr = 'اكتب إلى أين تم التحويل.'; renderSheet(); return; }
    exitPatient('transfer', v);
  },
  'death-confirm': () => exitPatient('death'),
  'p-toggle': el => { const k = el.dataset.k; withP(p => { if (k === 'follow') p.follow.on = !p.follow.on; else p[k] = !p[k]; }); },
  'p-loc': el => {
    const v = el.dataset.v, p = cur(); if (!p || p.loc === v || (v === 'hall' && p.spec === 'cardio')) return;
    const from = p.loc;
    commit(() => { const q = cur(); state.events.push(ev('move', q, {from, to:v})); q.loc = v; touch(q); }, v === 'dept' ? `انتقل إلى القسم: ${p.name}` : `انتقل إلى القاعة: ${p.name}`);
  },
  'p-spec': el => {
    const v = el.dataset.v, p = cur(); if (!p) return;
    if (p.spec === v) { ui.specPick = false; renderSheet(); return; }
    if (v === 'internal') { ui.specPick = true; renderSheet(); return; }
    if (p.loc === 'hall') return;
    commit(() => { const q = cur(); state.events.push(ev('spec', q, {from:q.spec, prevSub:q.sub, to:'cardio'})); q.spec = 'cardio'; q.sub = ''; touch(q); }, `تحويل إلى القلب: ${p.name}`);
  },
  'p-sub': el => {
    const sub = el.dataset.v === 'باطنة عامة' ? '' : el.dataset.v, p = cur(); if (!p) return;
    ui.specPick = false;
    commit(() => { const q = cur(); state.events.push(ev('spec', q, {from:q.spec, prevSub:q.sub, to:'internal', sub})); q.spec = 'internal'; q.sub = sub; touch(q); }, `خروج من القلب: ${p.name}`);
  },
  'spec-cancel': () => { ui.specPick = false; renderSheet(); },
  'p-shared': el => withP(p => { p.shared = el.dataset.v; }),
  'p-gender': el => withP(p => { p.gender = el.dataset.v; }),
  'p-braden': el => withP(p => { setBraden(p, p.braden == null ? 18 : p.braden + (+el.dataset.v)); }),
  'p-braden-set': el => withP(p => { setBraden(p, p.braden === +el.dataset.v ? null : +el.dataset.v); }),
  'p-braden-clear': () => withP(p => setBraden(p, null)),
  'p-bnew': el => withP(p => { p.bradenNew = el.dataset.v === '1'; }),
  'sore-new': () => { ui.soreDraft = {degree:null, sites:[], isNew:true}; renderSheet(); },
  'sd-degree': el => { ui.soreDraft.degree = el.dataset.v; renderSheet(); },
  'sd-site': el => { const s = ui.soreDraft.sites, v = el.dataset.v, i = s.indexOf(v); if (i >= 0) s.splice(i, 1); else s.push(v); renderSheet(); },
  'sd-custom': () => { const i = $('sd-custom'), v = i ? i.value.trim() : ''; if (i) i.value = ''; if (v && !ui.soreDraft.sites.includes(v)) ui.soreDraft.sites.push(v); renderSheet(); },
  'sd-new': el => { ui.soreDraft.isNew = el.dataset.v === '1'; renderSheet(); },
  'sd-save': () => {
    const sd = ui.soreDraft; if (!sd || !sd.degree || !sd.sites.length) return;
    ui.soreDraft = null;
    withP(p => p.sores.push({id:'s' + uid(), degree:sd.degree, sites:sd.sites.slice(), isNew:!!sd.isNew}), 'تمت إضافة القرحة');
  },
  'sd-cancel': () => { ui.soreDraft = null; renderSheet(); },
  'sore-age': el => withP(p => { const s = p.sores.find(x => x.id === el.dataset.v); if (s) s.isNew = !s.isNew; }),
  'sore-del': el => withP(p => { p.sores = p.sores.filter(s => s.id !== el.dataset.v); }, 'تم حذف القرحة'),
  'fu-vital': el => withP(p => {
    const f = p.follow, v = el.dataset.v;
    if (v === 'all') f.vitals = VITALS.every(x => f.vitals.includes(x)) ? [] : VITALS.slice();
    else { const i = f.vitals.indexOf(v); if (i >= 0) f.vitals.splice(i, 1); else f.vitals.push(v); }
  }),
  'fu-flag': el => withP(p => { const k = el.dataset.v; p.follow[k] = !p.follow[k]; }),
  'fu-pos': el => withP(p => { p.follow.position = el.dataset.v || null; }),
  'fu-pain': el => withP(p => { const v = el.dataset.v; p.follow.pain = v === '' || p.follow.pain === +v ? null : +v; }),
  'fu-venturi': el => withP(p => { const v = VENTURI.find(x => x.p === +el.dataset.v); p.follow.venturi = p.follow.venturi && p.follow.venturi.p === v.p ? null : {p:v.p, l:v.l}; }),
  'fu-l': el => withP(p => { if (p.follow.venturi) p.follow.venturi.l = clamp(p.follow.venturi.l + (+el.dataset.v), 1, 15); }),
  'pump-med': el => { const i = $('pump-med'); if (i) { i.value = el.dataset.v; const r = $('pump-rate'); if (r) r.focus(); } },
  'pump-add': () => {
    const mi = $('pump-med'), ri = $('pump-rate');
    const med = (mi ? mi.value : '').trim(), rate = (ri ? ri.value : '').trim();
    if (!med) { ui.pumpErr = 'اكتب اسم الدواء أو اختره من الأعلى.'; renderSheet(); return; }
    ui.pumpErr = '';
    if (mi) mi.value = '';
    if (ri) { ri.value = ''; ri.blur(); }
    withP(p => p.follow.pumps.push({id:'m' + uid(), med, rate}));
  },
  'pump-del': el => withP(p => { p.follow.pumps = p.follow.pumps.filter(m => m.id !== el.dataset.v); }, 'تم حذف الـ Syringe pump'),
  'p-del': () => { ui.delConfirm = true; renderSheet(); },
  'p-del-cancel': () => { ui.delConfirm = false; renderSheet(); },
  'p-del-confirm': () => {
    const p = cur(); if (!p) return;
    ui.sheet = null;
    commit(() => { state.patients = state.patients.filter(x => x.id !== p.id); state.events = state.events.filter(e => e.pid !== p.id); }, `تم حذف ${p.name}`);
  },
  'ev-undo': el => revertEvent(el.dataset.v),
  cnt: el => commit(() => { const k = el.dataset.k; state.counters = Object.assign({}, state.counters, {[k]:Math.max(0, state.counters[k] + (+el.dataset.v))}); }),
  'note-add': () => {
    const i = $('note-input'), v = i ? i.value.trim() : '';
    if (!v) { if (i) i.focus(); return; }
    i.value = '';
    commit(() => { state.notes.push({id:'n' + uid(), text:v, pinned:false, at:nowIso(), by:session.uid}); });
  },
  'note-tpl': el => { const i = $('note-input'); if (i) { i.value = el.dataset.v; i.focus(); i.setSelectionRange(i.value.length, i.value.length); } },
  'note-pin': el => commit(() => { const n = state.notes.find(x => x.id === el.dataset.v); if (n) n.pinned = !n.pinned; }),
  'note-del': el => commit(() => { state.notes = state.notes.filter(x => x.id !== el.dataset.v); }, 'تم حذف الملاحظة'),
  'team-toggle': el => commit(() => {
    const id = el.dataset.v;
    if (state.team.includes(id)) { state.team = state.team.filter(x => x !== id); if (state.responsible === id) state.responsible = null; }
    else state.team = state.team.concat([id]);
  }),
  'resp-set': el => commit(() => { state.responsible = el.dataset.v; }),
  'staff-add': () => {
    const i = $('staff-input'), v = i ? i.value.replace(/^\s*ح\s*\/\s*/, '').trim() : '';
    if (!v) { if (i) i.focus(); return; }
    i.value = '';
    commit(() => { const id = 'x' + uid(); state.extraStaff = state.extraStaff.concat([{id, name:v}]); state.team = state.team.concat([id]); });
  },
  'op-cat': el => { ui.op.cat = el.dataset.v; ui.op.shown = pick3(ui.op.cat, []); renderOp(); },
  'op-more': () => { ui.op.shown = pick3(ui.op.cat, ui.op.shown); renderOp(); },
  'op-pick': el => { const it = OPENINGS[ui.op.cat][+el.dataset.v]; if (it) commit(() => { state.opening = Object.assign({}, it); }, 'تم اختيار الافتتاحية'); },
  'op-auto': () => commit(() => { state.opening = null; }, 'الافتتاحية تتغير تلقائياً كل يوم'),
  'goto-opening': () => { ui.tab = 'day'; ui.copyFallback = false; ui.issueConfirm = false; render(); const o = $('opening'); if (o) o.scrollIntoView({block:'start'}); },
  copy: () => copyText(buildReport()),
  'copy-archive': el => { const a = state.archive.find(x => x.id === el.dataset.v); if (a) copyText(a.text); },
  'issue-open': () => { ui.issueConfirm = true; render(); },
  'issue-cancel': () => { ui.issueConfirm = false; render(); },
  'issue-confirm': () => {
    ui.issueConfirm = false;
    const text = buildReport();
    commit(() => {
      state.archive.unshift({id:'r' + uid(), at:nowIso(), by:me().name, byId:session.uid, text});
      state.events = [];
      state.patients.forEach(p => { p.admitted = false; p.bradenNew = false; p.sores.forEach(s => { s.isNew = false; }); });
      state.counters = Object.assign({}, state.counters, {blood:0, peth:0, morph:0});
      state.notes = state.notes.filter(n => n.pinned);
      state.periodStart = nowIso();
    }, 'تم إصدار التقرير وحفظه في الأرشيف');
  },
  'archive-open': el => openSheet({type:'archive', id:el.dataset.v}),
  'user-open': () => openSheet({type:'account'}),
  'staff-open': () => { ui.nf = {role:'nurse', name:'', user:'', pass:'', busy:false, err:'', msg:''}; openSheet({type:'staff'}); },
  'nf-role': el => { ui.nf.role = el.dataset.v; renderSheet(); },
  'nf-create': () => createStaff(),
  'st-active': el => { const s = state.staff.find(x => x.id === el.dataset.v); if (s && s.id !== session.uid) updateStaff(s.id, {active:!s.active}); },
  'st-role': el => { const s = state.staff.find(x => x.id === el.dataset.v); if (s && s.id !== session.uid) updateStaff(s.id, {role:s.role === 'admin' ? 'nurse' : 'admin'}); },
  'pw-change': () => changePassword(),
  'gate-retry': () => decideGate(),
  logout: () => { if (pending > 0 && !navigator.onLine) { ui.logoutConfirm = true; renderSheet(); return; } doLogout(); },
  'logout-force': () => doLogout(),
  'logout-cancel': () => { ui.logoutConfirm = false; renderSheet(); },
  undo: () => {
    if (!undoOps) return;
    const ops = undoOps;
    undoOps = null;
    $('toast').hidden = true;
    applyOps(ops, 'before');
    showToast('تم التراجع');
  }
};

/* ---------- DOM events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const h = H[el.dataset.act];
  if (h) h(el, e);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'login-form') doLogin();
  else if (e.target.id === 'setup-form') doSetup();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { ui.q = t.value; const l = $('plist'); if (l) l.innerHTML = patientList(); return; }
  if (t.dataset && t.dataset.draft && draft) { draft[t.dataset.draft] = t.value; if (t.dataset.draft === 'name') ui.dupOk = false; }
  if (t.dataset && t.dataset.nf) ui.nf[t.dataset.nf] = t.value;
  if (t.id === 'tr-dest') ui.trDest = t.value;
});
document.addEventListener('change', e => {
  const t = e.target, f = t.dataset && t.dataset.pfield; if (!f) return;
  const p = cur(); if (!p) return;
  const v = t.value.trim();
  if (f === 'name' && !v) { t.value = p.name; return; }
  // `change` fires on blur, often in the middle of a tap on another control: render softly
  commit(() => { const q = cur(); if (f === 'other') q.follow.other = v; else q[f] = v; touch(q); }, null, true);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.sheet) { closeSheet(); return; }
  if (e.key !== 'Enter') return;
  const id = e.target.id;
  const map = {'ad-name':'admit-save', 'ad-bed':'admit-save', 'note-input':'note-add', 'staff-input':'staff-add', 'sd-custom':'sd-custom', 'tr-dest':'transfer-confirm', 'pump-rate':'pump-add', 'pump-med':'pump-add', 'pw-new':'pw-change'};
  if (map[id]) { e.preventDefault(); H[map[id]](); }
});
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

/* ---------- installable app ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    // a new version is active; reload only when it will not interrupt typing
    const go = () => { if (!ui.sheet && !captureFocus()) location.reload(); else setTimeout(go, 15000); };
    go();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => { /* works without offline shell */ });
}
if (__EMULATOR__) {
  window.__test = {buildReport: () => buildReport(), state: () => state, pending: () => pending};
}
