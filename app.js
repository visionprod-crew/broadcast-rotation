/* SLS 방송팀 관리 시스템 — app.js
 * 저장소: 로컬 모드(localStorage) 또는 Firebase 모드(로그인 + Firestore 실시간 공유)
 */
const CFG = window.APP_CONFIG || {};
const OWNER_ID = (CFG.ownerId || 'admin').toLowerCase();
const DOMAIN = CFG.loginDomain || 'vfc-rotation.app';
// 아이디: 한글·영문·숫자 2~20자. Firebase 로그인용 이메일은 한글을 코드값으로 바꿔서 만듦
const ID_RE = /^[a-z0-9._\-가-힣]{2,20}$/;
const ID_MSG = '아이디는 한글·영문·숫자 2~20자로 입력해 주세요 (띄어쓰기 없이)';
const normId = v => String(v || '').trim().replace(/\s+/g, '').toLowerCase();
const idToLocal = id => /^[a-z0-9._-]+$/.test(id) ? id : 'k-' + [...id].map(c => c.codePointAt(0).toString(36)).join('-');
const localToId = l => l.startsWith('k-') ? l.slice(2).split('-').map(x => String.fromCodePoint(parseInt(x, 36))).join('') : l;

/* ───────── 포지션 정의 (시트 구조 그대로) ───────── */
const SLOTS = [
  { k: 'pd',    cam: 'PD',      pos: '',         tag: 'PD'  },
  { k: 'main1', cam: 'Cam1',    pos: 'Main1',    tag: '메인' },
  { k: 'main2', cam: 'Cam2',    pos: 'Main2',    tag: '메인', optional: true },
  { k: 'cam3',  cam: 'Cam3',    pos: 'L-Moving', tag: '3C'  },
  { k: 'cam4',  cam: 'Cam4',    pos: 'R-Moving', tag: '4C'  },
  { k: 'ptz',   cam: 'Cam5, 6', pos: 'PTZ',      tag: 'PTZ' },
  { k: 'jib',   cam: 'Cam7',    pos: 'Jib',      tag: 'Jib' },
  { k: 'text',  cam: 'Text',    pos: '',         tag: '자막' },
];
const MULTI = [{ k: 'spare', label: '예비/휴가' }, { k: 'absent', label: '불참' }];
const ROLE_TAGS = ['PD', '메인', '3C', '4C', 'PTZ', 'Jib', '자막'];
const MEMBER_TYPES = ['팀원', '사역자'];
const ROLES = { owner: '메인 관리자', pastor: '교역자', leader: '팀장', subleader: '부팀장', member: '팀원' };
const ROLE_ORDER = ['owner', 'pastor', 'leader', 'subleader', 'member'];
const ROLE_OPTS = ['pastor', 'leader', 'subleader', 'member'];
const can = {
  editRotation: () => ['owner', 'pastor', 'leader', 'subleader'].includes(store.user?.role),
  editMembers:  () => ['owner', 'pastor', 'leader'].includes(store.user?.role),
  owner:        () => store.user?.role === 'owner',
};
const DEFAULT_SETTINGS = { teamName: '3시예배 방송팀', cardTitle: '3시 방송팀 포지션', footer: '' };

/* ───────── 유틸 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());
const dotDate = s => s.replaceAll('-', '.');
const dow = s => DOW[parseISO(s).getDay()];
const ymOf = s => s.slice(0, 7);
function sundaysOf(ym) {
  const [y, m] = ym.split('-').map(Number); const out = [];
  const d = new Date(y, m - 1, 1); while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  while (d.getMonth() === m - 1) { out.push(toISO(d)); d.setDate(d.getDate() + 7); }
  return out;
}
function shiftYM(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function upcomingSunday() { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return toISO(d); }
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));
function fmtPhone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return d.replace(/(\d{3})(\d+)/, '$1-$2');
  return d.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
}
async function sha(s) {
  if (window.crypto?.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h;
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('브라우저 저장 공간에 저장하지 못했어요'); } }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

function seedData() {
  const s = window.SEED || { members: [], rotations: [] };
  const data = { members: {}, rotations: {}, settings: { ...DEFAULT_SETTINGS } };
  s.members.forEach(m => data.members[m.id] = clone(m));
  s.rotations.forEach(r => data.rotations[r.date] = clone(r));
  return data;
}
function emptyRotation(date) {
  const r = { date, memo: '', spare: [], absent: [] };
  SLOTS.forEach(s => r[s.k] = null); return r;
}
function normalizeImport(obj) {
  if (!obj || !Array.isArray(obj.members) || !Array.isArray(obj.rotations)) throw new Error('로테이션 백업 파일이 아니에요');
  const data = { members: {}, rotations: {}, settings: { ...DEFAULT_SETTINGS, ...(obj.settings || {}) } };
  obj.members.forEach(m => { if (m.id && m.name) data.members[m.id] = { roles: [], type: '팀원', active: true, age: '', phone: '', note: '', ...m }; });
  obj.rotations.forEach(r => { if (r.date) data.rotations[r.date] = { ...emptyRotation(r.date), ...r }; });
  return data;
}

/* ───────── 로컬 저장소 ───────── */
const LS_DATA = 'vfc-rotation:data:v1', LS_USERS = 'vfc-rotation:users:v1', LS_SESSION = 'vfc-rotation:session', LS_UI = 'vfc-rotation:ui';
class LocalStore {
  mode = 'local'; listeners = new Set(); user = null; ready = true;
  async init() {
    let d = lsGet(LS_DATA, null);
    if (!d) { d = seedData(); lsSet(LS_DATA, d); }
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    this.data = d;
    this.users = lsGet(LS_USERS, []);
    const s = lsGet(LS_SESSION, null);
    this.user = this.users.find(u => u.uid === s) || null;
  }
  needsOwnerSetup() { return !this.users.some(u => u.role === 'owner'); }
  _persistUsers() { lsSet(LS_USERS, this.users); }
  async createOwner(loginId, pw, name) {
    if (!this.needsOwnerSetup()) throw new Error('이미 관리자 계정이 있어요');
    const u = { uid: uid('u_'), loginId, name, role: 'owner', hash: await sha(loginId + ':' + pw), createdAt: Date.now() };
    this.users.push(u); this._persistUsers(); this.user = u; lsSet(LS_SESSION, u.uid);
  }
  async login(loginId, pw) {
    const u = this.users.find(x => x.loginId === loginId);
    if (!u || u.hash !== await sha(loginId + ':' + pw)) throw new Error('아이디 또는 비밀번호가 맞지 않아요');
    this.user = u; lsSet(LS_SESSION, u.uid);
  }
  async logout() { this.user = null; lsDel(LS_SESSION); }
  async listUsers() { return this.users.map(({ hash, ...u }) => u); }
  async createUser({ loginId, pw, name, role, memberId = null }) {
    if (this.users.some(u => u.loginId === loginId)) throw new Error('이미 사용 중인 아이디예요');
    this.users.push({ uid: uid('u_'), loginId, name, role, memberId, hash: await sha(loginId + ':' + pw), createdAt: Date.now() });
    this._persistUsers();
  }
  async deleteUser(id) { this.users = this.users.filter(u => u.uid !== id); this._persistUsers(); }
  async setUserRole(id, role) { const u = this.users.find(x => x.uid === id); if (u) u.role = role; this._persistUsers(); if (this.user?.uid === id) this.user.role = role; }
  async resetPassword(id, pw) { const u = this.users.find(x => x.uid === id); u.hash = await sha(u.loginId + ':' + pw); this._persistUsers(); }
  async changePassword(oldPw, newPw) {
    const u = this.users.find(x => x.uid === this.user.uid);
    if (u.hash !== await sha(u.loginId + ':' + oldPw)) throw new Error('현재 비밀번호가 맞지 않아요');
    u.hash = await sha(u.loginId + ':' + newPw); this._persistUsers();
  }
  subscribe(f) { this.listeners.add(f); }
  _save() { lsSet(LS_DATA, this.data); this.listeners.forEach(f => f()); }
  async saveRotation(r) { this.data.rotations[r.date] = clone(r); this._save(); }
  async deleteRotation(date) { delete this.data.rotations[date]; this._save(); }
  async saveMember(m) { this.data.members[m.id] = clone(m); this._save(); }
  async deleteMember(id) { delete this.data.members[id]; this._save(); }
  async saveSettings(s) { this.data.settings = { ...this.data.settings, ...s }; this._save(); }
  async saveAck(date, memberId) { (this.data.acks ||= {})[`${date}_${memberId}`] = { date, memberId, uid: this.user.uid, at: Date.now() }; this._save(); }
  async replaceAll(d) { this.data = { ...clone(d), acks: this.data.acks || {} }; this._save(); }
}

/* ───────── Firebase 저장소 (로그인 + 실시간 공유) ───────── */
class FirebaseStore {
  mode = 'cloud'; listeners = new Set(); user = null; unsubs = []; ready = false;
  data = { members: {}, rotations: {}, settings: { ...DEFAULT_SETTINGS }, acks: {} };
  email(id) { return `${idToLocal(id)}@${DOMAIN}`; }
  async init() {
    const v = '10.12.5', base = `https://www.gstatic.com/firebasejs/${v}/`;
    const [appM, A, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
    Object.assign(this, { appM, A, F });
    this.app = appM.initializeApp(CFG.firebase);
    this.auth = A.getAuth(this.app);
    this.db = F.getFirestore(this.app);
    await new Promise(res => {
      let first = true;
      A.onAuthStateChanged(this.auth, async u => {
        try { await this._setUser(u); } catch (e) { this.authError = e.message; await A.signOut(this.auth); }
        if (first) { first = false; res(); } else rerender();
      });
    });
  }
  async _setUser(u) {
    this.unsubs.forEach(f => f()); this.unsubs = []; this.ready = false;
    if (!u) { this.user = null; return; }
    const { F, db } = this;
    let loginId = localToId(u.email.split('@')[0]);
    const ref = F.doc(db, 'users', u.uid);
    let snap = null; try { snap = await F.getDoc(ref); } catch {}
    let role = loginId === OWNER_ID ? 'owner' : snap?.exists() ? snap.data().role : null;
    if (!role) throw new Error('등록되지 않았거나 삭제된 계정이에요. 메인 관리자에게 문의해 주세요.');
    const name = snap?.exists() ? snap.data().name : '메인 관리자';
    if (snap?.exists() && snap.data().loginId) loginId = snap.data().loginId;
    if (role === 'owner' && !snap?.exists()) await F.setDoc(ref, { loginId, name, role: 'owner', createdAt: Date.now() });
    this.user = { uid: u.uid, loginId, name, role, memberId: snap?.exists() ? snap.data().memberId || null : null };
    this._listen();
  }
  _listen() {
    const { F, db } = this; let got = 0; const done = () => { if (++got >= 3) this.ready = true; this._emit(); };
    this.unsubs.push(F.onSnapshot(F.collection(db, 'members'), s => { const o = {}; s.forEach(d => o[d.id] = d.data()); this.data.members = o; done(); }, e => this._err(e)));
    this.unsubs.push(F.onSnapshot(F.collection(db, 'rotations'), s => { const o = {}; s.forEach(d => o[d.id] = d.data()); this.data.rotations = o; done(); }, e => this._err(e)));
    this.unsubs.push(F.onSnapshot(F.doc(db, 'settings', 'main'), s => { this.data.settings = { ...DEFAULT_SETTINGS, ...(s.data() || {}) }; done(); }, e => this._err(e)));
    // 알림 확인 기록 (보안 규칙이 아직 없으면 조용히 건너뜀)
    this.unsubs.push(F.onSnapshot(F.collection(db, 'acks'), s => { const o = {}; s.forEach(d => o[d.id] = d.data()); this.data.acks = o; this._emit(); }, e => console.warn('acks', e.code)));
  }
  _err(e) { console.error(e); toast('데이터를 불러오지 못했어요: ' + (e.code || e.message)); }
  _emit() { this.listeners.forEach(f => f()); }
  needsOwnerSetup() { return false; }
  _authMsg(e) {
    const m = { 'auth/invalid-credential': '아이디 또는 비밀번호가 맞지 않아요', 'auth/wrong-password': '아이디 또는 비밀번호가 맞지 않아요', 'auth/user-not-found': '아이디 또는 비밀번호가 맞지 않아요', 'auth/email-already-in-use': '이미 만들어진 아이디예요', 'auth/weak-password': '비밀번호는 6자 이상이어야 해요', 'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해주세요', 'auth/network-request-failed': '네트워크 연결을 확인해 주세요' };
    return new Error(m[e.code] || e.message);
  }
  async createOwner(loginId, pw) {
    if (loginId !== OWNER_ID) throw new Error(`관리자 아이디는 config.js에 지정된 "${OWNER_ID}" 이어야 해요`);
    try { await this.A.createUserWithEmailAndPassword(this.auth, this.email(loginId), pw); } catch (e) { throw this._authMsg(e); }
    await this._waitUser();
  }
  async login(loginId, pw) {
    this.authError = null;
    try { await this.A.signInWithEmailAndPassword(this.auth, this.email(loginId), pw); } catch (e) { throw this._authMsg(e); }
    await this._waitUser();
  }
  _waitUser() { return new Promise((res, rej) => { let n = 0; const t = setInterval(() => { if (this.user || this.authError || ++n > 60) { clearInterval(t); this.authError ? rej(new Error(this.authError)) : res(); } }, 100); }); }
  async logout() { await this.A.signOut(this.auth); this.user = null; }
  async listUsers() { const s = await this.F.getDocs(this.F.collection(this.db, 'users')); return s.docs.map(d => ({ uid: d.id, ...d.data() })); }
  async createUser({ loginId, pw, name, role, memberId = null }) {
    this.sec ||= this.appM.initializeApp(CFG.firebase, 'secondary');
    const sa = this.A.getAuth(this.sec);
    let cred; try { cred = await this.A.createUserWithEmailAndPassword(sa, this.email(loginId), pw); } catch (e) { throw this._authMsg(e); }
    await this.F.setDoc(this.F.doc(this.db, 'users', cred.user.uid), { loginId, name, role, memberId, createdAt: Date.now() });
    await this.A.signOut(sa);
  }
  async deleteUser(id) { await this.F.deleteDoc(this.F.doc(this.db, 'users', id)); }
  async setUserRole(id, role) { await this.F.updateDoc(this.F.doc(this.db, 'users', id), { role }); }
  async changePassword(oldPw, newPw) {
    const u = this.auth.currentUser;
    try {
      await this.A.reauthenticateWithCredential(u, this.A.EmailAuthProvider.credential(u.email, oldPw));
      await this.A.updatePassword(u, newPw);
    } catch (e) { throw this._authMsg(e); }
  }
  subscribe(f) { this.listeners.add(f); }
  _clean(o) { return JSON.parse(JSON.stringify(o)); }
  async saveRotation(r) { await this.F.setDoc(this.F.doc(this.db, 'rotations', r.date), this._clean(r)); }
  async deleteRotation(date) { await this.F.deleteDoc(this.F.doc(this.db, 'rotations', date)); }
  async saveMember(m) { await this.F.setDoc(this.F.doc(this.db, 'members', m.id), this._clean(m)); }
  async deleteMember(id) { await this.F.deleteDoc(this.F.doc(this.db, 'members', id)); }
  async saveSettings(s) { await this.F.setDoc(this.F.doc(this.db, 'settings', 'main'), this._clean({ ...this.data.settings, ...s })); }
  async idToken() { return this.auth.currentUser.getIdToken(); }
  async savePushSub(id, data) { await this.F.setDoc(this.F.doc(this.db, 'pushSubs', id), this._clean(data)); }
  async deletePushSub(id) { try { await this.F.deleteDoc(this.F.doc(this.db, 'pushSubs', id)); } catch {} }
  async listMySubs() { const q = this.F.query(this.F.collection(this.db, 'pushSubs'), this.F.where('uid', '==', this.user.uid)); return (await this.F.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() })); }
  async listPushSubs(memberIds) {
    const out = [];
    for (let i = 0; i < memberIds.length; i += 30) {
      const q = this.F.query(this.F.collection(this.db, 'pushSubs'), this.F.where('memberId', 'in', memberIds.slice(i, i + 30)));
      (await this.F.getDocs(q)).forEach(d => out.push({ id: d.id, ...d.data() }));
    }
    return out;
  }
  async saveAck(date, memberId) {
    try { await this.F.setDoc(this.F.doc(this.db, 'acks', `${date}_${memberId}`), { date, memberId, uid: this.user.uid, at: Date.now() }); }
    catch (e) { throw new Error(e.code === 'permission-denied' ? '확인 기능 권한이 아직 설정되지 않았어요 (관리자: Firebase 보안 규칙 업데이트 필요)' : e.message); }
  }
  async replaceAll(d) {
    const { F, db } = this; const ops = [];
    Object.keys(this.data.members).forEach(id => ops.push(b => b.delete(F.doc(db, 'members', id))));
    Object.keys(this.data.rotations).forEach(id => ops.push(b => b.delete(F.doc(db, 'rotations', id))));
    Object.values(d.members).forEach(m => ops.push(b => b.set(F.doc(db, 'members', m.id), this._clean(m))));
    Object.values(d.rotations).forEach(r => ops.push(b => b.set(F.doc(db, 'rotations', r.date), this._clean(r))));
    ops.push(b => b.set(F.doc(db, 'settings', 'main'), this._clean(d.settings || DEFAULT_SETTINGS)));
    for (let i = 0; i < ops.length; i += 400) { const b = F.writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b)); await b.commit(); }
  }
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
}

/* ───────── 상태 ───────── */
let store;
const ui = Object.assign({ tab: 'month', ym: ymOf(todayISO()), monthView: 'card', weekDate: null, weekMode: 'week', memFilter: 'active', memQuery: '', showCounts: false }, lsGet(LS_UI, {}));
ui.ym = ymOf(todayISO()); ui.weekDate = null;
const saveUI = () => lsSet(LS_UI, { tab: ui.tab, monthView: ui.monthView, memFilter: ui.memFilter });

const D = () => store.data;
const member = id => D().members[id];
// 용병은 명단에 넣지 않고 'g:이름' 형태로 로테이션에 바로 저장
const GUEST = 'g:';
const isGuest = id => typeof id === 'string' && id.startsWith(GUEST);
const guestName = id => id.slice(GUEST.length);
// 화면·이미지·텍스트·CSV 어디서나 용병은 '이름(용병)'으로 표시
// 명단에서 삭제한 팀원은 지난 기록에 'n:이름'으로 남김
const FORMER = 'n:';
const nameOf = id => id ? (isGuest(id) ? `${guestName(id)}(용병)` : String(id).startsWith(FORMER) ? id.slice(FORMER.length) : (member(id)?.name || '(삭제된 팀원)')) : '';
const cardName = nameOf;
function recentGuests() {
  const seen = new Map();
  Object.values(D().rotations).sort((a, b) => b.date.localeCompare(a.date)).forEach(r => [...SLOTS.map(s => r[s.k]), ...(r.spare || []), ...(r.absent || [])].forEach(id => { if (isGuest(id) && !seen.has(id)) seen.set(id, r.date); }));
  return [...seen.keys()].slice(0, 12);
}
const membersSorted = () => Object.values(D().members).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'ko'));
const rotationsOfMonth = ym => Object.values(D().rotations).filter(r => ymOf(r.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
const allDates = () => Object.keys(D().rotations).sort();

function issues(r) {
  const where = {}; const msgs = []; const bad = new Set();
  SLOTS.forEach(s => { if (r[s.k]) (where[r[s.k]] ||= []).push(s.pos || s.cam); });
  Object.entries(where).forEach(([id, ps]) => { if (ps.length > 1) { bad.add(id); msgs.push(`${nameOf(id)} 중복 배정 (${ps.join(', ')})`); } });
  (r.absent || []).forEach(id => { if (where[id]) { bad.add(id); msgs.push(`${nameOf(id)} 불참인데 배정됨`); } });
  (r.spare || []).forEach(id => { if (where[id]) msgs.push(`${nameOf(id)} 예비/휴가와 포지션에 동시에 있음`); });
  return { msgs, bad, where };
}
function countsFor(rots) {
  const c = {};
  rots.forEach(r => {
    SLOTS.forEach(s => { const id = r[s.k]; if (id) (c[id] ||= { n: 0, ab: 0 }).n++; });
    (r.absent || []).forEach(id => (c[id] ||= { n: 0, ab: 0 }).ab++);
  });
  return c;
}

/* ───────── 내 계정 ↔ 명단 연결, 포지션 알림 ───────── */
function myMemberId() {
  const u = store.user; if (!u) return null;
  if (u.memberId && member(u.memberId)) return u.memberId;
  const ms = Object.values(D().members);
  return (ms.find(m => m.name === u.name) || ms.find(m => m.name.replace(/\s.*$/, '') === u.name.replace(/\s.*$/, '')))?.id || null;
}
function memberIdByName(name) {
  const ms = Object.values(D().members), n = String(name || '').trim();
  return (ms.find(m => m.name === n) || ms.find(m => m.name.replace(/\s.*$/, '') === n.replace(/\s.*$/, '')))?.id || null;
}
function positionsOf(r, id) { return SLOTS.filter(s => r[s.k] === id).map(s => s.pos ? `${s.cam} · ${s.pos}` : s.cam); }
function ackOf(r, id) { const a = D().acks?.[`${r.date}_${id}`]; return a && (!r.notifiedAt || a.at >= r.notifiedAt) ? a : null; }
function notifyTargets(r, withSpare) {
  const ids = []; SLOTS.forEach(s => { const id = r[s.k]; if (id && member(id) && !ids.includes(id)) ids.push(id); });
  if (withSpare) (r.spare || []).forEach(id => { if (member(id) && !ids.includes(id)) ids.push(id); });
  return ids;
}
const fmtTime = t => { const d = new Date(t); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function smsHref(nums, body) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const b = encodeURIComponent(body);
  return ios ? `sms:/open?addresses=${nums.join(',')}&body=${b}` : `sms:${nums.join(',')}?body=${b}`;
}
function noticeText(r) { return `${weekText(r)}\n\n앱에서 내 포지션을 확인하고 '확인했어요'를 눌러주세요 👉 ${location.origin + location.pathname}`; }
function myBannerHTML() {
  return pushBannerHTML() + myNextHTML();
}
function myNextHTML() {
  const me = myMemberId(); if (!me) return '';
  const today = todayISO();
  const r = Object.values(D().rotations).filter(x => x.date >= today && (positionsOf(x, me).length || (x.spare || []).includes(me))).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!r) return '';
  const ps = positionsOf(r, me), ack = ackOf(r, me);
  return `<div class="mybanner card">
    <div class="grow"><div class="small muted" style="font-weight:700">${r.notifiedAt ? '📣 포지션 알림' : '내 다음 일정'} · ${dotDate(r.date).slice(5)}(${dow(r.date)})</div>
      <div class="mb-pos">${ps.length ? ps.map(esc).join(', ') : '예비/휴가'}</div></div>
    ${ack ? `<span class="chip spare">✓ 확인함</span>` : r.notifiedAt ? `<button class="btn sm primary" data-act="ack" data-v="${r.date}">확인했어요</button>` : ''}
  </div>`;
}
/* ── 웹 푸시 (아이폰: 홈 화면 앱, 갤럭시: 크롬) ── */
const PUSH = {
  configured: () => store.mode === 'cloud' && !!CFG.vapidPublicKey && !!CFG.pushApi,
  supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  isIOS: () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  state() {
    if (!this.configured()) return 'off';
    if (!this.supported()) return this.isIOS() && !this.standalone() ? 'ios-home' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return lsGet('vfc-rotation:pushOn', false) && Notification.permission === 'granted' ? 'on' : 'ready';
  },
};
let swReg = null;
async function getSW() {
  if (swReg) return swReg;
  swReg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; return swReg;
}
async function subId(endpoint) { return (await sha(endpoint)).slice(0, 32); }
async function enablePush() {
  try {
    const st = PUSH.state();
    if (st === 'ios-home') return openIosGuide();
    if (st === 'unsupported') return toast('이 브라우저는 푸시 알림을 지원하지 않아요');
    if (st === 'denied') return toast('알림이 차단돼 있어요. 휴대폰 설정에서 이 앱 알림을 허용해 주세요');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('알림을 허용해야 받을 수 있어요');
    const reg = await getSW();
    const key = Uint8Array.from(atob(CFG.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    await store.savePushSub(await subId(j.endpoint), { uid: store.user.uid, memberId: myMemberId(), name: store.user.name, endpoint: j.endpoint, keys: j.keys, device: PUSH.isIOS() ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'PC', at: Date.now() });
    lsSet('vfc-rotation:pushOn', true); toast('이 기기에서 알림을 받아요 🔔'); rerender();
  } catch (e) { console.error(e); toast('알림 켜기 실패: ' + (e.message || e)); }
}
async function disablePush() {
  try {
    const reg = await getSW(), sub = await reg.pushManager.getSubscription();
    if (sub) { await store.deletePushSub(await subId(sub.endpoint)); await sub.unsubscribe(); }
  } catch {}
  lsSet('vfc-rotation:pushOn', false); toast('이 기기 알림을 껐어요'); rerender();
}
function openIosGuide() {
  openSheet({ title: '아이폰에서 알림 받기', body: `<ol style="margin:0;padding-left:20px;line-height:1.9;font-size:15px">
    <li>사파리 아래쪽 <b>공유 버튼</b>(□↑)을 눌러요</li><li><b>홈 화면에 추가</b>를 눌러요</li>
    <li>홈 화면에 생긴 <b>SLS 방송팀</b> 아이콘으로 앱을 열어요</li><li>로그인 후 <b>알림 켜기</b>를 누르고 <b>허용</b>을 눌러요</li></ol>
    <p class="muted small" style="margin-top:12px">iOS 16.4 이상에서 지원돼요. 사파리 탭에서는 아이폰 정책상 알림을 받을 수 없어요.</p>` });
}
function pushBannerHTML() {
  const st = PUSH.state();
  if (!['ready', 'ios-home'].includes(st) || lsGet('vfc-rotation:pushHide', false)) return '';
  return `<div class="card pushbanner"><div class="grow"><b>📲 포지션 알림을 폰으로 받아보세요</b><div class="small muted">${st === 'ios-home' ? '아이폰은 홈 화면에 추가한 앱에서 켤 수 있어요' : '배정되면 잠금화면으로 알려드려요'}</div></div>
    <button class="btn sm primary" data-act="pushOn">${st === 'ios-home' ? '방법 보기' : '알림 켜기'}</button><button class="iconbtn" data-act="pushHide" aria-label="닫기" style="width:30px;height:30px;border:0;background:none">${I.x}</button></div>`;
}
async function sendPositionPush(r, ids) {
  if (!PUSH.configured()) return { sent: 0, none: true };
  const subs = await store.listPushSubs(ids);
  if (!subs.length) return { sent: 0, subs: 0 };
  const url = location.origin + location.pathname;
  const items = subs.map(s => {
    const ps = positionsOf(r, s.memberId);
    return { sub: { endpoint: s.endpoint, keys: s.keys }, payload: { title: `📣 ${dotDate(r.date).slice(5)}(${dow(r.date)}) 포지션 알림`, body: `${member(s.memberId)?.name || ''}님 · ${ps.length ? ps.join(', ') : '예비/휴가'}\n앱에서 '확인했어요'를 눌러주세요`, url, tag: 'pos-' + r.date } };
  });
  const res = await fetch(CFG.pushApi, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await store.idToken() }, body: JSON.stringify({ items }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.status);
  const gone = (j.results || []).filter(x => x.gone).map(x => subs.find(s => s.endpoint === x.endpoint)?.id).filter(Boolean);
  for (const id of gone) await store.deletePushSub(id);
  const okMembers = new Set((j.results || []).filter(x => x.ok).map(x => subs.find(s => s.endpoint === x.endpoint)?.memberId));
  return { sent: okMembers.size, subs: subs.length, failed: (j.results || []).filter(x => !x.ok && !x.gone).length };
}

function openNotify(date) {
  let withSpare = false;
  const el = openSheet({ title: `${dotDate(date).slice(5)}(${dow(date)}) 포지션 알림`, body: '<div id="ntBody"></div>', wide: true });
  let subMembers = null;
  const loadSubs = async () => { if (!PUSH.configured()) return; try { subMembers = new Set((await store.listPushSubs(notifyTargets(D().rotations[date], true))).map(s => s.memberId)); draw(); } catch (e) { console.warn(e); } };
  const draw = () => {
    const r = D().rotations[date]; if (!r) return;
    const ids = notifyTargets(r, withSpare);
    const acked = ids.filter(id => ackOf(r, id)).length;
    const nums = ids.map(id => (member(id).phone || '').replace(/\D/g, '')).filter(Boolean);
    const noPhone = ids.filter(id => !member(id).phone).map(id => member(id).name);
    $('#ntBody', el).innerHTML = `
      <div class="banner" style="margin-bottom:12px">${r.notifiedAt ? `<b>앱 알림 보냄</b> · ${fmtTime(r.notifiedAt)}${r.notifiedBy ? ` · ${esc(r.notifiedBy)}` : ''}<br>확인 <b>${acked}</b> / ${ids.length}명` : '아직 앱 알림을 보내지 않았어요. 보내면 대상자가 앱에 들어왔을 때 내 포지션과 <b>확인했어요</b> 버튼이 보여요.'}</div>
      <label class="switch" style="margin:0 0 10px"><div><b>예비/휴가 인원도 포함</b></div><button type="button" class="tgl ${withSpare ? 'on' : ''}" id="ntSp"></button></label>
      <div class="card list">${ids.map(id => { const m = member(id), a = ackOf(r, id), ps = positionsOf(r, id); return `<div class="li" style="padding:11px 14px">
        <div class="grow"><b>${esc(m.name)}</b>${subMembers ? (subMembers.has(id) ? ' <span title="폰 알림 켜짐">📲</span>' : ' <span class="muted small" title="폰 알림 꺼짐">· 폰알림 X</span>') : ''} <span class="muted small">${ps.length ? ps.map(esc).join(', ') : '예비/휴가'}</span><div class="d">${m.phone ? esc(m.phone) : '<span style="color:var(--danger)">연락처 없음</span>'}</div></div>
        ${a ? `<span class="chip spare">✓ ${fmtTime(a.at)}</span>` : r.notifiedAt ? '<span class="chip">미확인</span>' : ''}
      </div>`; }).join('') || '<div class="empty">포지션에 배정된 팀원이 없어요</div>'}</div>
      <div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn primary" id="ntApp" style="height:48px">🔔 ${r.notifiedAt ? '앱 알림 다시 보내기 (확인 초기화)' : '앱 알림 보내기'}</button>
        <a class="btn" id="ntSms" href="${smsHref(nums, noticeText(r))}" style="height:48px">💬 단체 문자 보내기 (${nums.length}명)</a>
        <button class="btn kakao" id="ntKakao" style="height:48px">${I.kakao}카톡 단톡방용 문구 복사</button>
      </div>
      ${noPhone.length ? `<p class="muted small" style="margin:10px 2px 0">연락처가 없어 문자에서 빠지는 사람: ${noPhone.map(esc).join(', ')}</p>` : ''}
      <p class="muted small" style="margin:8px 2px 0">${PUSH.configured() ? '앱 알림은 📲 표시가 있는 사람(폰 알림을 켠 사람)에게 아이폰·갤럭시 알림으로도 가요. ' : ''}단체 문자는 휴대폰의 문자 앱이 열리고, 보내기는 직접 눌러야 해요.</p>`;
    $('#ntSp', el).onclick = () => { withSpare = !withSpare; draw(); };
    $('#ntApp', el).onclick = async () => {
      const btn = $('#ntApp', el); btn.disabled = true; btn.textContent = '보내는 중…';
      try {
        await store.saveRotation({ ...clone(r), notifiedAt: Date.now(), notifiedBy: store.user.name });
        let msg = '앱 알림을 보냈어요';
        try { const p = await sendPositionPush(r, ids); if (!p.none) msg += ` · 폰 알림 ${p.sent}명${p.failed ? ` (실패 ${p.failed})` : ''}`; }
        catch (e) { msg += ` · 폰 알림 실패: ${e.message}`; }
        toast(msg); loadSubs();
      } catch (e) { toast('실패: ' + e.message); }
      draw();
    };
    $('#ntKakao', el).onclick = () => {
      const t = `${ids.map(id => '@' + member(id).name).join(' ')}\n${noticeText(r)}`;
      copyText(t, '복사했어요. 단톡방에 붙여넣기 하세요');
    };
  };
  draw(); loadSubs();
  const off = () => draw(); store.subscribe(off); el._onClose = () => store.listeners.delete(off);
}

/* ───────── 팀원 로테이션 분석 ───────── */
const POS_NAME = { pd: 'PD', main1: '메인', main2: '메인', cam3: '3번캠', cam4: '4번캠', ptz: 'PTZ', jib: 'Jib', text: '자막' };
const POS_ORDER = ['PD', '메인', '3번캠', '4번캠', 'PTZ', 'Jib', '자막'];
const POS_COLOR = { PD: '#e8892b', 메인: '#3a6fd8', '3번캠': '#2c9a6a', '4번캠': '#8b5cf6', PTZ: '#c9a227', Jib: '#e0567f', 자막: '#14a3b8' };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
function analyze(refDate) {
  // refDate 이전(당일 제외) 기록 기준: 최근 / 1개월(30일) / 3개월(91일)
  const m1From = addDays(refDate, -30), m3From = addDays(refDate, -91);
  const rots = Object.values(D().rotations).filter(r => r.date < refDate).sort((a, b) => b.date.localeCompare(a.date));
  const out = {};
  const get = id => out[id] ||= { last: null, m1: { n: 0, c: {}, ab: 0 }, m3: { n: 0, c: {}, ab: 0 } };
  rots.forEach(r => {
    const seen = {};
    SLOTS.forEach(s => { const id = r[s.k]; if (id) (seen[id] ||= []).push(POS_NAME[s.k]); });
    Object.entries(seen).forEach(([id, ps]) => {
      const a = get(id); ps = [...new Set(ps)];
      if (!a.last) a.last = { date: r.date, pos: ps };
      for (const [w, from] of [['m1', m1From], ['m3', m3From]]) if (r.date >= from) ps.forEach(p => { a[w].c[p] = (a[w].c[p] || 0) + 1; a[w].n++; });
    });
    (r.absent || []).forEach(id => { const a = get(id); if (r.date >= m1From) a.m1.ab++; if (r.date >= m3From) a.m3.ab++; });
  });
  return { refDate, m1From, m3From, data: out };
}
const pct = (n, t) => t ? Math.round(n / t * 100) : 0;
function agoText(date, ref) { const d = Math.round((parseISO(ref) - parseISO(date)) / 864e5); return d < 7 ? `${d}일 전` : `${Math.round(d / 7)}주 전`; }
function windowHTML(label, w, sub) {
  const ent = POS_ORDER.filter(p => w.c[p]).map(p => [p, w.c[p]]);
  if (!ent.length) return `<div class="an-row"><div class="an-k">${label}<small>${sub}</small></div><div class="an-v muted small">기록 없음${w.ab ? ` · 불참 ${w.ab}회` : ''}</div></div>`;
  return `<div class="an-row"><div class="an-k">${label}<small>${w.n}회</small></div><div class="an-v">
    <div class="an-bar">${ent.map(([p, n]) => `<i style="flex:${n};background:${POS_COLOR[p]}" title="${p}"></i>`).join('')}</div>
    <div class="an-chips">${ent.map(([p, n]) => `<span><b style="background:${POS_COLOR[p]}"></b>${p} ${n}회 <em>${pct(n, w.n)}%</em></span>`).join('')}${w.ab ? `<span class="ab">불참 ${w.ab}회</span>` : ''}</div>
  </div></div>`;
}
function memberAnalysisHTML(m, a, ref) {
  const last = a?.last;
  return `<div class="card an-card">
    <div class="an-head"><b>${esc(m.name)}</b>${m.age ? `<span class="muted small">${esc(m.age)}</span>` : ''}
      <div class="grow"></div>
      ${last ? `<span class="an-last">최근 <b>${last.pos.join('·')}</b> <span class="muted">${dotDate(last.date).slice(5)} · ${agoText(last.date, ref)}</span></span>` : '<span class="muted small">최근 기록 없음</span>'}
    </div>
    ${windowHTML('1개월', a?.m1 || { n: 0, c: {}, ab: 0 }, '0회')}
    ${windowHTML('3개월', a?.m3 || { n: 0, c: {}, ab: 0 }, '0회')}
  </div>`;
}
function mountAnalysis(root, refDate, focusDate) {
  const res = analyze(refDate);
  ui.anSort ||= lsGet('vfc-rotation:anSort', 'recent'); ui.anQ ||= '';
  root.innerHTML = `<div class="muted small" style="margin:0 2px 10px">${focusDate ? `<b style="color:var(--accent)">${dotDate(focusDate)} 편성 기준</b> · ` : ''}${dotDate(refDate)} 이전 기록 · 1개월 ${dotDate(res.m1From).slice(5)}~ · 3개월 ${dotDate(res.m3From).slice(5)}~</div>
    <div class="searchbox">${I.search}<input class="input an-q" placeholder="이름 검색" value="${esc(ui.anQ)}"></div>
    <div class="seg an-sort" style="margin-bottom:10px">${[['recent', '최근 순'], ['many', '많이 한 순'], ['rest', '오래 쉰 순'], ['name', '명단 순']].map(([k, l]) => `<button class="${ui.anSort === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    <div class="an-legend">${POS_ORDER.map(p => `<span><b style="background:${POS_COLOR[p]}"></b>${p}</span>`).join('')}</div>
    <div class="an-list"></div>`;
  const draw = () => {
    const q = ui.anQ, sort = ui.anSort, A = id => res.data[id];
    let ms = membersSorted().filter(m => (m.active || res.data[m.id]?.m3.n) && (!q || m.name.includes(q)));
    if (sort === 'rest') ms.sort((a, b) => (A(a.id)?.last?.date || '0').localeCompare(A(b.id)?.last?.date || '0'));
    if (sort === 'recent') ms.sort((a, b) => (A(b.id)?.last?.date || '0').localeCompare(A(a.id)?.last?.date || '0'));
    if (sort === 'many') ms.sort((a, b) => (A(b.id)?.m3.n || 0) - (A(a.id)?.m3.n || 0));
    root.querySelector('.an-list').innerHTML = ms.map(m => memberAnalysisHTML(m, A(m.id), refDate)).join('') || '<div class="empty">해당하는 팀원이 없어요</div>';
  };
  draw();
  root.querySelectorAll('.an-sort button').forEach(b => b.onclick = () => { ui.anSort = b.dataset.s; lsSet('vfc-rotation:anSort', ui.anSort); root.querySelectorAll('.an-sort button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  root.querySelector('.an-q').oninput = e => { ui.anQ = e.target.value.trim(); draw(); };
}
function openMemberAnalysis(id) {
  const m = member(id); if (!m) return;
  const today = todayISO(), ref = addDays(today, 1);
  const res = analyze(ref), a = res.data[id] || { last: null, m1: { n: 0, c: {}, ab: 0 }, m3: { n: 0, c: {}, ab: 0 } };
  // 시스템에 저장된 전체 기록
  const all = { n: 0, c: {}, ab: 0 }, hist = [];
  Object.values(D().rotations).sort((x, y) => y.date.localeCompare(x.date)).forEach(r => {
    const ps = [...new Set(SLOTS.filter(s2 => r[s2.k] === id).map(s2 => POS_NAME[s2.k]))];
    const ab = (r.absent || []).includes(id), sp = (r.spare || []).includes(id);
    if (!ps.length && !ab && !sp) return;
    const future = r.date > today;
    if (!future) { ps.forEach(p => { all.c[p] = (all.c[p] || 0) + 1; all.n++; }); if (ab) all.ab++; }
    hist.push({ date: r.date, ps, ab, sp, future });
  });
  const past = hist.filter(h => !h.future && h.ps.length);
  const first = past.at(-1)?.date, served = past.length;
  const topPos = POS_ORDER.filter(p => all.c[p]).sort((x, y) => all.c[y] - all.c[x])[0];
  const byMonth = {}; hist.forEach(h => (byMonth[ymOf(h.date)] ||= []).push(h));
  openSheet({
    title: `${esc(m.name)} 로테이션 분석`, wide: true,
    body: `<div class="muted small" style="margin:-4px 2px 12px">${m.age ? `${esc(m.age)}또래 · ` : ''}${m.note ? `${esc(m.note)} · ` : ''}${m.active ? '활동' : '비활동'} · ${dotDate(today)} 기준</div>
      <div class="stats" style="grid-template-columns:repeat(4,1fr)">
        <div class="card stat"><b>${served}</b><span>전체 출석</span></div>
        <div class="card stat"><b>${topPos || '-'}</b><span>최다 포지션</span></div>
        <div class="card stat"><b style="color:${all.ab ? 'var(--danger)' : 'inherit'}">${all.ab}</b><span>불참</span></div>
        <div class="card stat"><b style="font-size:16px;line-height:1.5">${first ? dotDate(first).slice(2) : '-'}</b><span>첫 기록</span></div>
      </div>
      <div class="an-legend">${POS_ORDER.map(p => `<span><b style="background:${POS_COLOR[p]}"></b>${p}</span>`).join('')}</div>
      <div class="card an-card">
        <div class="an-head"><b>포지션 비중</b><div class="grow"></div>${a.last ? `<span class="an-last">최근 <b>${a.last.pos.join('·')}</b> <span class="muted">${dotDate(a.last.date).slice(5)} · ${agoText(a.last.date, today)}</span></span>` : '<span class="muted small">최근 기록 없음</span>'}</div>
        ${windowHTML('1개월', a.m1, '0회')}
        ${windowHTML('3개월', a.m3, '0회')}
        ${windowHTML('전체', all, '0회')}
      </div>
      <div class="section-title" style="margin-top:18px"><span>전체 기록 · ${hist.length}건</span></div>
      ${hist.length ? Object.entries(byMonth).map(([ym, hs]) => `<div class="grp">${ym.replace('-', '.')} · ${hs.filter(h => h.ps.length).length}회</div>
        <div class="card list">${hs.map(h => `<div class="li" style="padding:10px 14px;gap:10px">
          <b style="width:96px;flex:none;font-size:14px;white-space:nowrap">${dotDate(h.date).slice(5)} <span class="muted" style="font-weight:600">(${dow(h.date)})</span></b>
          <div class="grow" style="display:flex;flex-wrap:wrap;gap:5px">${h.ps.map(p => `<span class="chip" style="background:${POS_COLOR[p]}22;color:${POS_COLOR[p]}">${p}</span>`).join('')}${h.sp ? '<span class="chip spare">예비/휴가</span>' : ''}${h.ab ? '<span class="chip absent">불참</span>' : ''}</div>
          ${h.future ? '<span class="badge">예정</span>' : ''}
        </div>`).join('')}</div>`).join('') : '<div class="card empty">아직 기록이 없어요</div>'}`,
  });
}
function openAnalysis(refDate, focusDate) {
  const el = openSheet({ title: '팀원 로테이션 분석', wide: true, body: '<div class="an-root"></div>' });
  mountAnalysis(el.querySelector('.an-root'), refDate, focusDate);
}
function defaultAnalysisRef() {
  const up = upcomingSunday(), last = sundaysOf(ui.ym).at(-1);
  return ymOf(up) === ui.ym ? addDays(up, 1) : last ? addDays(last, 1) : addDays(todayISO(), 1);
}
// PC(넓은 화면)에서는 월별 화면 오른쪽에 분석 패널 고정
const WIDE = window.matchMedia('(min-width: 1100px)');
function renderSide() {
  let side = $('#side');
  const show = store?.user && WIDE.matches && ui.tab === 'month' && !(store.mode === 'cloud' && !store.ready);
  document.body.classList.toggle('side-on', !!show);
  if (!show) { side?.remove(); return; }
  if (!side) { side = document.createElement('aside'); side.id = 'side'; side.innerHTML = '<div class="side-h"><b>팀원 로테이션 분석</b><span class="muted small">최근 · 1개월 · 3개월</span></div><div class="side-b"></div>'; document.body.appendChild(side); }
  const body = side.querySelector('.side-b'), y = body.scrollTop, hadFocus = document.activeElement?.classList.contains('an-q');
  mountAnalysis(body, ui.sideFocus || defaultAnalysisRef(), ui.sideFocus);
  body.scrollTop = y;
  if (hadFocus) { const i = body.querySelector('.an-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
WIDE.addEventListener?.('change', () => store?.user && rerender());

/* ───────── 아이콘 ───────── */
const I = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.5 3 5.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  kakao: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.7 6.6l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.5 10-7.9S17.5 3 12 3z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 20h16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V9m0 0-4.5 4.5M12 9l4.5 4.5M4 4h16"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
};

/* ───────── 토스트 / 시트 / 확인창 ───────── */
let toastT;
function toast(msg) {
  document.querySelector('.toast')?.remove(); clearTimeout(toastT);
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  toastT = setTimeout(() => t.remove(), 2600);
}
const sheetStack = [];
function openSheet({ title, body, foot = '', onMount, onClose, wide }) {
  const el = document.createElement('div'); el.className = 'sheet'; el._onClose = onClose;
  el.innerHTML = `<div class="panel"${wide ? ' style="max-width:760px"' : ''}><div class="ph"><h2>${title}</h2><button class="iconbtn" data-close>${I.x}</button></div><div class="pb">${body}</div>${foot ? `<div class="pf">${foot}</div>` : ''}</div>`;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) closeSheet(el); });
  $('#sheets').appendChild(el); sheetStack.push(el);
  document.body.style.overflow = 'hidden';
  onMount?.(el); return el;
}
function closeSheet(el = sheetStack.at(-1)) {
  if (!el || !el.isConnected) return; el.remove(); sheetStack.splice(sheetStack.indexOf(el), 1); el._onClose?.();
  if (!sheetStack.length) document.body.style.overflow = '';
}
function choiceBox(msg, buttons) {
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const el = openSheet({ title: '확인', body: `<p style="margin:4px 0 6px;font-size:15px;white-space:pre-line">${esc(msg)}</p>`,
      foot: buttons.map(([v, l, c]) => `<button class="btn ${c} grow" data-v="${v}">${l}</button>`).join(''), onClose: () => fin('cancel') });
    el.querySelectorAll('.pf [data-v]').forEach(b => b.onclick = () => { fin(b.dataset.v); closeSheet(el); });
  });
}
function confirmBox(msg, okLabel = '확인', danger = false) {
  return new Promise(res => {
    const el = openSheet({ title: '확인', body: `<p style="margin:4px 0 6px;font-size:15px;white-space:pre-line">${esc(msg)}</p>`,
      foot: `<button class="btn grow" data-no>취소</button><button class="btn ${danger ? 'danger' : 'primary'} grow" data-yes>${okLabel}</button>` });
    el.querySelector('[data-yes]').onclick = () => { closeSheet(el); res(true); };
    el.querySelector('[data-no]').onclick = () => { closeSheet(el); res(false); };
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) res(false); });
  });
}

/* ───────── 렌더 ───────── */
function rerender() {
  const app = $('#app');
  if (!store.user) { app.innerHTML = renderLogin(); bindLogin(); renderSide(); return; }
  const st = D().settings;
  const roleCls = store.user.role;
  app.innerHTML = `
    <header class="topbar">
      <h1><small>${esc(st.teamName)}</small>SLS 방송팀 관리 시스템</h1>
      <button class="userchip" data-act="me"><span class="avatar">${esc(store.user.name[0] || 'U')}</span>${esc(store.user.name)}${store.user.name !== ROLES[roleCls] ? `<span class="role ${roleCls}">${ROLES[roleCls]}</span>` : ''}</button>
    </header>
    ${store.mode === 'local' ? `<div class="modebar"><span class="dot"></span>로컬 모드 · 이 기기에만 저장돼요</div>` : `<div class="modebar"><span class="dot on"></span>클라우드 연결됨 · 실시간 공유 중</div>`}
    <main class="view" id="view">${renderView()}</main>
    <nav class="tabbar"><div class="in">
      ${[['month', '월별 로테이션', I.cal], ['week', '주간 공지', I.share], ['members', '팀원', I.people], ['settings', '설정', I.gear]].map(([k, l, ic]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${ic}${l}</button>`).join('')}
    </div></nav>
    ${ui.tab === 'members' && can.editMembers() ? `<button class="fab" data-act="addMember" aria-label="팀원 추가">${I.plus}</button>` : ''}`;
  if (ui.tab === 'week') mountWeek();
  if (ui.tab === 'settings' && can.owner()) loadUserList();
  renderSide();
}
function renderView() {
  if (store.mode === 'cloud' && !store.ready) return `<div class="empty">데이터 불러오는 중…</div>`;
  return { month: renderMonth, week: renderWeek, members: renderMembers, settings: renderSettings }[ui.tab]();
}

/* ── 로그인 ── */
function renderLogin() {
  const setup = store.needsOwnerSetup();
  const err = store.authError ? esc(store.authError) : '';
  if (setup || ui.ownerSetup) {
    return `<div class="login"><div class="box">
      <div class="brand">VISION FILM CREW</div>
      <h1>메인 관리자 만들기</h1>
      <p class="muted" style="margin:0 0 18px">처음 한 번만 설정해요. 이 계정으로 팀장·부팀장 계정을 만들 수 있어요.</p>
      <form id="ownerForm">
        <label class="f">이름</label><input class="input" name="name" value="메인 관리자" required>
        <label class="f">관리자 아이디</label><input class="input" name="id" value="${esc(OWNER_ID)}" ${store.mode === 'cloud' ? 'readonly' : ''} autocapitalize="off" required>
        <label class="f">비밀번호 (6자 이상)</label><input class="input" type="password" name="pw" minlength="6" required autocomplete="new-password">
        <label class="f">비밀번호 확인</label><input class="input" type="password" name="pw2" minlength="6" required autocomplete="new-password">
        <div class="err" id="err">${err}</div>
        <button class="btn primary block" style="height:50px;margin-top:6px">관리자 계정 만들기</button>
        ${!setup ? `<button type="button" class="btn ghost block" style="margin-top:8px" data-back>로그인으로 돌아가기</button>` : ''}
      </form></div></div>`;
  }
  return `<div class="login"><div class="box">
    <div class="brand">VISION FILM CREW</div>
    <h1>SLS 방송팀 관리 시스템</h1>
    <p class="muted" style="margin:0 0 18px">${esc(D().settings.teamName)} 포지션 관리</p>
    <form id="loginForm">
      <label class="f">아이디</label><input class="input" name="id" autocapitalize="off" autocomplete="username" required>
      <label class="f">비밀번호</label><input class="input" type="password" name="pw" autocomplete="current-password" required>
      <div class="err" id="err">${err}</div>
      <button class="btn primary block" style="height:50px;margin-top:6px">로그인</button>
      ${store.mode === 'cloud' && location.hash === '#setup' ? `<button type="button" class="btn ghost block" style="margin-top:8px" data-setup>메인 관리자 계정 만들기</button>` : ''}
    </form>
    <p class="muted small" style="margin-top:18px">${store.mode === 'local' ? '로컬 모드: 이 기기 브라우저에만 저장됩니다.' : '계정은 메인 관리자가 만들어 드려요.'}</p>
  </div></div>`;
}
function bindLogin() {
  const f = $('#loginForm'), o = $('#ownerForm'), err = $('#err');
  if (f) {
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      try { await store.login(normId(f.id.value), f.pw.value); rerender(); } catch (x) { err.textContent = x.message; }
    };
    f.querySelector('[data-setup]')?.addEventListener('click', () => { ui.ownerSetup = true; store.authError = null; rerender(); });
  }
  if (o) {
    o.querySelector('[data-back]')?.addEventListener('click', () => { ui.ownerSetup = false; rerender(); });
    o.onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const id = normId(o.id.value);
      if (!ID_RE.test(id)) return err.textContent = ID_MSG;
      if (o.pw.value.length < 6) return err.textContent = '비밀번호는 6자 이상이어야 해요';
      if (o.pw.value !== o.pw2.value) return err.textContent = '비밀번호가 서로 달라요';
      try { await store.createOwner(id, o.pw.value, o.name.value.trim() || '메인 관리자'); ui.ownerSetup = false; rerender(); toast('메인 관리자 계정이 만들어졌어요'); }
      catch (x) { err.textContent = x.message; }
    };
  }
}

/* ── 월별 ── */
function renderMonth() {
  const [y, m] = ui.ym.split('-');
  const rots = rotationsOfMonth(ui.ym);
  const today = todayISO();
  const iss = rots.reduce((n, r) => n + issues(r).msgs.length, 0);
  const counts = countsFor(rots);
  const people = Object.keys(counts).filter(id => counts[id].n > 0).length;
  const missingSundays = sundaysOf(ui.ym).filter(d => !D().rotations[d]);
  const nextDate = rots.find(r => r.date >= today)?.date;
  let html = myBannerHTML() + `
    <div class="monthnav">
      <button class="iconbtn" data-act="ym" data-v="-1" aria-label="이전 달">${I.left}</button>
      <button class="title" data-act="ymPick"><small>${y}년</small>${Number(m)}월 로테이션</button>
      <button class="iconbtn" data-act="ym" data-v="1" aria-label="다음 달">${I.right}</button>
    </div>
    <div class="stats">
      <div class="card stat"><b>${rots.length}</b><span>예배</span></div>
      <div class="card stat"><b>${people}</b><span>참여 인원</span></div>
      <div class="card stat"><b style="color:${iss ? 'var(--danger)' : 'var(--ok)'}">${iss || '✓'}</b><span>${iss ? '확인 필요' : '이상 없음'}</span></div>
    </div>
    <div class="row" style="margin-bottom:12px">
      <div class="seg"><button class="${ui.monthView === 'card' ? 'on' : ''}" data-act="mview" data-v="card">카드</button><button class="${ui.monthView === 'table' ? 'on' : ''}" data-act="mview" data-v="table">시트형 표</button></div>
      <div class="grow"></div>
      <button class="btn sm ghost hide-wide" data-act="analysis">${I.chart}분석</button>
      ${can.editRotation() ? `<button class="btn sm" data-act="addDate">${I.plus}날짜 추가</button>` : ''}
    </div>`;
  if (can.editRotation() && missingSundays.length) {
    html += `<div class="banner row"><div class="grow">이 달 일요일 중 <b>${missingSundays.length}일</b>이 아직 비어 있어요</div><button class="btn sm primary" data-act="fillSundays">일요일 채우기</button></div>`;
  }
  if (!rots.length) html += `<div class="card empty">이 달에는 아직 로테이션이 없어요</div>`;
  else if (ui.monthView === 'table') html += renderTable(rots);
  else html += `<div class="svc-list">${rots.map(r => renderSvc(r, r.date === nextDate, r.date < today)).join('')}</div>`;

  if (rots.length) {
    const ms = membersSorted().filter(mm => mm.active || counts[mm.id]);
    html += `<div class="section-title"><span>인원별 배정 횟수 · ${Number(m)}월</span><button class="btn sm ghost" data-act="toggleCounts">${ui.showCounts ? '접기' : '펼치기'}</button></div>`;
    if (ui.showCounts) html += `<div class="counts">${ms.map(mm => { const c = counts[mm.id] || { n: 0, ab: 0 }; return `<div class="cnt-item ${c.n ? '' : 'zero'}">${esc(mm.name)}<span>${c.n}회${c.ab ? ` · 불참 ${c.ab}` : ''}</span></div>`; }).join('')}</div>`;
  }
  return html;
}
function renderSvc(r, isNext, isPast) {
  const { msgs, bad } = issues(r), me = myMemberId();
  const cells = SLOTS.filter(s => !(s.optional && !r[s.k])).map(s => {
    const id = r[s.k];
    return `<div class="pos"><div class="lbl"><b>${s.pos || s.cam}</b><i>${s.pos ? s.cam : '&nbsp;'}</i></div><div class="nm ${id ? (bad.has(id) ? 'bad' : id === me ? 'me' : '') : 'none'}">${id ? esc(cardName(id)) : '-'}</div></div>`;
  });
  if (cells.length % 2) cells.push('<div class="pos"></div>');
  const chips = (ids, cls) => ids?.length ? ids.map(id => `<span class="chip ${cls}">${esc(nameOf(id))}</span>`).join('') : '<span class="muted small" style="padding-top:3px">없음</span>';
  return `<article class="card svc ${isPast ? 'past' : ''}">
    <div class="svc-head"><div class="svc-date">${dotDate(r.date).slice(5)}<span class="dow">(${dow(r.date)})</span></div>
      ${isNext ? '<span class="badge">이번 주</span>' : isPast ? '<span class="badge past">지남</span>' : ''}
      <div class="grow"></div>
      <button class="btn sm ghost" data-act="toWeek" data-v="${r.date}">${I.share}공지</button>
      ${can.editRotation() && !isPast ? `<button class="btn sm ghost" data-act="notify" data-v="${r.date}" title="포지션 알림">${I.bell}${r.notifiedAt ? `<span class="small">${notifyTargets(r).filter(id => ackOf(r, id)).length}/${notifyTargets(r).length}</span>` : '알림'}</button>` : ''}
      ${can.editRotation() ? `<button class="btn sm" data-act="edit" data-v="${r.date}">${I.pen}편집</button>` : ''}
    </div>
    ${r.memo ? `<div class="memo">📌 ${esc(r.memo)}</div>` : ''}
    <div class="svc-grid">${cells.join('')}</div>
    <div class="svc-foot">
      <div class="line"><span class="k">예비/휴가</span>${chips(r.spare, 'spare')}</div>
      <div class="line"><span class="k">불참</span>${chips(r.absent, 'absent')}</div>
      ${msgs.length ? `<div class="line">${msgs.map(t => `<span class="chip warn">⚠︎ ${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  </article>`;
}
function renderTable(rots) {
  const head = `<tr><th>날짜</th>${SLOTS.filter(s => s.k !== 'main2').map(s => `<th>${s.k === 'main1' ? 'Cam1, 2<small>Main1, 2</small>' : s.k === 'jib' ? 'Cam7<small>Jimmy Jib</small>' : s.pos ? `${s.cam}<small>${s.pos}</small>` : s.cam}</th>`).join('')}<th>예비/휴가</th><th>불참</th></tr>`;
  const body = rots.map(r => {
    const { bad } = issues(r);
    const cell = id => `<td style="${bad.has(id) ? 'color:var(--danger);font-weight:700' : ''}">${esc(nameOf(id))}</td>`;
    return `<tr data-act="${can.editRotation() ? 'edit' : 'toWeek'}" data-v="${r.date}"><td class="d">${dotDate(r.date)}</td>${SLOTS.filter(s => s.k !== 'main2').map(s => s.k === 'main1' ? `<td>${esc([nameOf(r.main1), nameOf(r.main2)].filter(Boolean).join(' / '))}</td>` : cell(r[s.k])).join('')}<td>${esc((r.spare || []).map(nameOf).join(', '))}</td><td class="ab">${esc((r.absent || []).map(nameOf).join(', '))}</td></tr>`;
  }).join('');
  return `<div class="tablewrap card"><table class="rt"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* ── 로테이션 편집 시트 ── */
let draft = null, draftIsNew = false;
function openEditor(date, isNew = false) {
  draft = clone(D().rotations[date] || emptyRotation(date)); draftIsNew = isNew;
  openSheet({
    title: `${dotDate(date)} (${dow(date)}) 포지션`, body: '<div id="edBody"></div>',
    foot: `${!isNew ? `<button class="btn danger" data-act="delRot">삭제</button>` : ''}<button class="btn grow" data-close>취소</button><button class="btn primary grow" data-act="saveRot">저장</button>`,
    onClose: () => { ui.sideFocus = null; renderSide(); },
    onMount: el => { ui.sideFocus = date; renderSide(); el.querySelector('[data-act="saveRot"]').onclick = saveDraft; el.querySelector('[data-act="delRot"]')?.addEventListener('click', delDraft); renderEditorBody(); },
  });
}
function renderEditorBody() {
  const box = $('#edBody'); if (!box) return;
  const { msgs, bad } = issues(draft);
  box.innerHTML = `
    <button class="btn block ghost hide-wide" id="edAn" style="margin-bottom:10px">${I.chart}팀원 로테이션 분석 보기 (최근 · 1개월 · 3개월)</button>
    ${SLOTS.map(s => { const id = draft[s.k]; return `<button class="slot ${id && bad.has(id) ? 'warn' : ''}" data-slot="${s.k}"><div class="lbl"><b>${s.cam}</b><i>${s.pos || (s.k === 'text' ? '자막' : '프로듀서')}${s.optional ? ' · 선택' : ''}</i></div><div class="v ${id ? '' : 'none'}">${id ? esc(nameOf(id)) : '선택 안 함'}</div><span class="chev">${I.chev}</span></button>`; }).join('')}
    ${MULTI.map(mm => { const ids = draft[mm.k] || []; return `<button class="slot" data-slot="${mm.k}"><div class="lbl"><b>${mm.label}</b><i>여러 명 선택</i></div><div class="v ${ids.length ? '' : 'none'}">${ids.length ? ids.map(id => `<span class="chip ${mm.k === 'absent' ? 'absent' : 'spare'}">${esc(nameOf(id))}</span>`).join('') : '없음'}</div><span class="chev">${I.chev}</span></button>`; }).join('')}
    <label class="f">메모 (선택)</label><input class="input" id="memo" placeholder="예: 성탄 특별예배, 장비 점검 등" value="${esc(draft.memo || '')}">
    ${msgs.length ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">${msgs.map(t => `<span class="chip warn">⚠︎ ${esc(t)}</span>`).join('')}</div>` : ''}`;
  box.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => openPicker(b.dataset.slot));
  $('#edAn').onclick = () => openAnalysis(draft.date, draft.date);
  $('#memo').oninput = e => draft.memo = e.target.value;
}
async function saveDraft() {
  try { await store.saveRotation(draft); closeSheet(); toast('저장했어요'); } catch (e) { toast('저장 실패: ' + e.message); }
}
async function delDraft() {
  if (!await confirmBox(`${dotDate(draft.date)} 로테이션을 삭제할까요?`, '삭제', true)) return;
  await store.deleteRotation(draft.date); closeSheet(); toast('삭제했어요');
}

/* ── 이름 선택 시트 ── */
function openPicker(k) {
  const slot = SLOTS.find(s => s.k === k), multi = MULTI.find(m => m.k === k);
  const title = slot ? `${slot.cam}${slot.pos ? ' · ' + slot.pos : ''}` : multi.label;
  let sel = multi ? [...(draft[k] || [])] : draft[k];
  let q = '';
  const monthCounts = countsFor(rotationsOfMonth(ymOf(draft.date)).filter(r => r.date !== draft.date));
  const an = analyze(draft.date).data;
  const el = openSheet({
    title, body: `<div class="row" style="margin-bottom:10px"><div class="searchbox grow" style="margin:0">${I.search}<input class="input" id="pq" placeholder="이름 검색"></div><button class="btn hide-wide" id="pkAn">${I.chart}분석</button></div><div id="pl"></div>
      <div class="grp">용병</div>
      <div class="card" style="padding:12px">
        <div class="row"><input class="input grow" id="guestName" placeholder="용병 이름 입력" maxlength="20" enterkeyhint="done"><button class="btn primary" id="guestAdd">${multi ? '추가' : '선택'}</button></div>
        <div id="guestChips" class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px"></div>
        <div class="muted small" style="margin-top:8px">명단에 저장되지 않고 이 날짜 로테이션에만 이름이 들어가요.</div>
      </div>`,
    foot: multi ? `<button class="btn grow" data-act="clr">모두 해제</button><button class="btn primary grow" data-act="ok">완료</button>` : `<button class="btn grow" data-act="clr">비우기 ( - )</button>`,
  });
  const where = () => { const w = {}; SLOTS.forEach(s => { if (draft[s.k] && s.k !== k) (w[draft[s.k]] ||= []).push(s.pos || s.cam); }); return w; };
  const draw = () => {
    const w = where(); const absent = new Set(draft.absent || []), spare = new Set(draft.spare || []);
    const list = membersSorted().filter(m => !q || m.name.includes(q));
    const fits = m => slot && (m.roles || []).includes(slot.tag);
    const groups = slot ? [
      ['추천 · 가능 포지션', list.filter(m => m.active && fits(m))],
      ['팀원', list.filter(m => m.active && !fits(m))],
      ['비활동', list.filter(m => !m.active)],
    ] : [['팀원', list.filter(m => m.active)], ['비활동', list.filter(m => !m.active)]];
    $('#pl', el).innerHTML = groups.filter(g => g[1].length).map(([g, ms]) => `<div class="grp">${g}</div>` + ms.map(m => {
      const on = multi ? sel.includes(m.id) : sel === m.id;
      const badges = [];
      if (w[m.id]) badges.push(`<span class="chip warn">${esc(w[m.id].join(', '))} 배정됨</span>`);
      if (k !== 'absent' && absent.has(m.id)) badges.push('<span class="chip absent">불참</span>');
      if (k !== 'spare' && spare.has(m.id)) badges.push('<span class="chip spare">예비/휴가</span>');
      if (k === 'absent' && w[m.id]) badges.length = 0, badges.push(`<span class="chip warn">${esc(w[m.id].join(', '))} 배정됨</span>`);
      (m.roles || []).forEach(t => badges.push(`<span class="chip tag">${esc(t)}</span>`));
      const c = monthCounts[m.id]?.n || 0;
      const a = an[m.id], pn = slot ? POS_NAME[slot.k] : null;
      const anLine = a?.last ? `<div class="pk-an">최근 <b>${a.last.pos.join('·')}</b> ${dotDate(a.last.date).slice(5)}${pn ? ` · 3개월 ${pn} <b>${a.m3.c[pn] || 0}회</b>${a.m3.n ? ` (${pct(a.m3.c[pn] || 0, a.m3.n)}%)` : ''}` : ` · 3개월 ${a.m3.n}회`}</div>` : '<div class="pk-an">최근 기록 없음</div>';
      return `<button class="pick ${on ? 'on' : ''} ${(!m.active || absent.has(m.id)) && k !== 'absent' ? 'dim' : ''}" data-id="${m.id}">
        ${multi ? `<span class="chk">${on ? I.check : ''}</span>` : ''}
        <div class="grow"><div class="nm">${esc(m.name)} ${m.age ? `<span class="muted small">${esc(m.age)}</span>` : ''} ${m.note && m.note.length < 8 ? `<span class="muted small">· ${esc(m.note)}</span>` : ''}</div>${anLine}${badges.length ? `<div class="meta">${badges.join('')}</div>` : ''}</div>
        <span class="cnt">이달 ${c}회</span>
        ${!multi && on ? `<span>${I.check}</span>` : ''}
      </button>`;
    }).join('')).join('') || '<div class="empty">검색 결과가 없어요</div>';
    $('#pl', el).querySelectorAll('.pick').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      if (multi) { sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]; draw(); }
      else { draft[k] = id; closeSheet(el); renderEditorBody(); }
    });
    const gs = [...new Set([...(multi ? sel : [sel]).filter(isGuest), ...recentGuests()])];
    $('#guestChips', el).innerHTML = gs.length ? gs.map(g => { const on = multi ? sel.includes(g) : sel === g; return `<button class="chip ${on ? 'spare' : ''}" data-g="${esc(g)}" style="padding:6px 12px;font-size:13.5px">${on ? '✓ ' : ''}${esc(guestName(g))}</button>`; }).join('') : '';
    $('#guestChips', el).querySelectorAll('[data-g]').forEach(b => b.onclick = () => pickGuest(b.dataset.g, true));
  };
  const pickGuest = (g, toggle) => {
    if (multi) { sel = sel.includes(g) ? (toggle ? sel.filter(x => x !== g) : sel) : [...sel, g]; draw(); }
    else { draft[k] = g; closeSheet(el); renderEditorBody(); }
  };
  draw();
  $('#pkAn', el).onclick = () => openAnalysis(draft.date, draft.date);
  $('#pq', el).oninput = e => { q = e.target.value.trim(); draw(); };
  el.querySelector('[data-act="clr"]').onclick = () => { if (multi) { sel = []; draw(); } else { draft[k] = null; closeSheet(el); renderEditorBody(); } };
  el.querySelector('[data-act="ok"]')?.addEventListener('click', () => { draft[k] = sel; closeSheet(el); renderEditorBody(); });
  const addGuest = () => {
    const name = $('#guestName', el).value.trim().replace(/\(용병\)$/, '').trim(); if (!name) return toast('용병 이름을 입력해 주세요');
    $('#guestName', el).value = ''; pickGuest(GUEST + name, false);
  };
  $('#guestAdd', el).onclick = addGuest;
  $('#guestName', el).onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addGuest(); } };
}

/* ── 주간 공지 ── */
let cardBlob = null, cardCanvas = null;
function pickWeekDefault() {
  const dates = allDates(); if (!dates.length) return null;
  const up = upcomingSunday();
  return dates.find(d => d >= up) || dates.find(d => d >= todayISO()) || dates.at(-1);
}
function renderWeek() {
  ui.weekDate ||= pickWeekDefault();
  if (!ui.weekDate) return myBannerHTML() + `<div class="card empty">먼저 월별 로테이션을 입력해 주세요</div>`;
  const ym = ymOf(ui.weekDate);
  const rots = rotationsOfMonth(ym);
  const [y, m] = ym.split('-');
  return `
    <div class="monthnav">
      <button class="iconbtn" data-act="wym" data-v="-1">${I.left}</button>
      <div class="title"><small>${y}년</small>${Number(m)}월 공지</div>
      <button class="iconbtn" data-act="wym" data-v="1">${I.right}</button>
    </div>
    <div class="row" style="margin-bottom:10px"><div class="seg"><button class="${ui.weekMode === 'week' ? 'on' : ''}" data-act="wmode" data-v="week">주간 1장</button><button class="${ui.weekMode === 'month' ? 'on' : ''}" data-act="wmode" data-v="month">이 달 전체</button></div></div>
    ${ui.weekMode === 'week' ? `<div class="datestrip">${rots.map(r => `<button class="dchip ${r.date === ui.weekDate ? 'on' : ''}" data-act="wdate" data-v="${r.date}"><b>${dotDate(r.date).slice(5)}</b><span>${dow(r.date)}요일</span></button>`).join('')}</div>` : ''}
    <div class="preview" id="preview"><div class="muted">이미지 만드는 중…</div></div>
    <div class="sharebar">
      <button class="btn kakao wide" data-act="shareImg">${I.kakao}카카오톡으로 공유</button>
      <button class="btn" data-act="saveImg">${I.down}이미지 저장</button>
      <button class="btn" data-act="copyImg">${I.copy}이미지 복사</button>
      ${ui.weekMode === 'week' ? `<button class="btn ghost wide" style="height:42px;font-size:14px" data-act="copyText">${I.text}텍스트로 복사 (카톡 메시지용)</button>` : ''}
    </div>
    <p class="muted small" style="margin:12px 4px">휴대폰: <b>카카오톡으로 공유</b> → 공유 목록에서 카카오톡 → 방 선택. PC: <b>이미지 복사</b> 후 카톡 PC 대화창에 붙여넣기.</p>`;
}
async function mountWeek() {
  const box = $('#preview'); if (!box || !ui.weekDate) return;
  cardBlob = null;
  await fontsReady();
  const st = D().settings;
  if (ui.weekMode === 'month') cardCanvas = drawMonthImage(ymOf(ui.weekDate), st);
  else { const r = D().rotations[ui.weekDate]; if (!r) { box.innerHTML = '<div class="muted">해당 날짜 데이터가 없어요</div>'; return; } cardCanvas = drawCardImage(r, st); }
  const url = cardCanvas.toDataURL('image/png');
  box.innerHTML = `<img src="${url}" alt="포지션 공지 이미지">`;
  cardCanvas.toBlob(b => cardBlob = b, 'image/png');
}
let fontsP;
function fontsReady() {
  fontsP ||= Promise.race([Promise.all(['400', '600', '700', '800'].map(w => document.fonts?.load(`${w} 20px Pretendard`))), new Promise(r => setTimeout(r, 1500))]).catch(() => {});
  return fontsP;
}
const FONT = `Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
const CARD = { w: 760, head: 78, row: 62 };
function cardHeight() { return CARD.head + CARD.row * 8; }
function drawCard(ctx, x, y, r, st) {
  const { w, head, row } = CARD, c1 = w * 0.25, c2 = w * 0.25, c3 = w * 0.5, h = cardHeight();
  const line = '#d9d4c8', ink = '#1c1b1f', sub = '#55535c';
  ctx.save();
  // 외곽
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  // 헤더
  ctx.fillStyle = '#f6c445'; ctx.fillRect(x, y, w, head);
  ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.font = `800 28px ${FONT}`; ctx.fillText(`${dotDate(r.date)} (${dow(r.date)})`, x + (c1 + c2) / 2, y + head / 2 + 1);
  ctx.font = `700 26px ${FONT}`; ctx.fillText(st.cardTitle || DEFAULT_SETTINGS.cardTitle, x + c1 + c2 + c3 / 2, y + head / 2 + 1);
  // 행
  const rows = [
    ['PD', null, r.pd], ['Cam1', 'Main1', r.main1], ['Cam2', 'Main2', r.main2], ['Cam3', 'L-Moving', r.cam3],
    ['Cam4', 'R-Moving', r.cam4], ['Cam5, 6', 'PTZ', r.ptz], ['Cam7', 'Jib', r.jib], ['Text', null, r.text],
  ];
  rows.forEach(([a, b, id], i) => {
    const ry = y + head + i * row, cy = ry + row / 2 + 1;
    if (i % 2 === 1) { ctx.fillStyle = '#faf8f3'; ctx.fillRect(x, ry, w, row); }
    ctx.fillStyle = sub; ctx.font = `600 23px ${FONT}`;
    if (b) { ctx.fillText(a, x + c1 / 2, cy); ctx.fillText(b, x + c1 + c2 / 2, cy); }
    else { ctx.font = `700 23px ${FONT}`; ctx.fillStyle = ink; ctx.fillText(a, x + (c1 + c2) / 2, cy); }
    ctx.fillStyle = id ? ink : '#a3a1a9'; ctx.font = `${id ? 800 : 500} 27px ${FONT}`;
    ctx.fillText(id ? cardName(id) : '-', x + c1 + c2 + c3 / 2, cy);
    ctx.strokeStyle = line; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + w, ry); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + c1 + c2, ry); ctx.lineTo(x + c1 + c2, ry + row); ctx.stroke();
    if (b) { ctx.beginPath(); ctx.moveTo(x + c1, ry); ctx.lineTo(x + c1, ry + row); ctx.stroke(); }
  });
  ctx.restore();
  ctx.strokeStyle = '#cfc9bb'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.stroke();
}
function makeCanvas(w, h, scale = 2) {
  const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); return [c, ctx];
}
function drawFooter(ctx, W, y, st) {
  if (!st.footer) return;
  ctx.fillStyle = '#8a8792'; ctx.font = `600 17px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(st.footer, W / 2, y);
}
function drawCardImage(r, st) {
  const P = 32, W = CARD.w + P * 2, H = cardHeight() + P * 2 + (st.footer ? 34 : 0);
  const [c, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, W, H);
  drawCard(ctx, P, P, r, st);
  drawFooter(ctx, W, H - P / 2 - 12, st);
  return c;
}
function drawMonthImage(ym, st) {
  const rots = rotationsOfMonth(ym); const [y, m] = ym.split('-');
  const P = 36, G = 28, cols = rots.length > 1 ? 2 : 1, rowsN = Math.max(1, Math.ceil(rots.length / cols)), T = 74;
  const W = P * 2 + cols * CARD.w + (cols - 1) * G, H = P * 2 + T + rowsN * cardHeight() + (rowsN - 1) * G + (st.footer ? 34 : 0);
  const [c, ctx] = makeCanvas(W, H, rots.length > 4 ? 1.5 : 2);
  ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f2a96b'; ctx.beginPath(); ctx.roundRect(P, P, W - P * 2, T - 16, 14); ctx.fill();
  ctx.fillStyle = '#1c1b1f'; ctx.font = `800 32px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${st.teamName} ${y}.${m} 로테이션`, W / 2, P + (T - 16) / 2 + 1);
  rots.forEach((r, i) => drawCard(ctx, P + (i % cols) * (CARD.w + G), P + T + Math.floor(i / cols) * (cardHeight() + G), r, st));
  drawFooter(ctx, W, H - P / 2 - 12, st);
  return c;
}
function fileName() {
  return ui.weekMode === 'month' ? `방송팀_${ymOf(ui.weekDate).replace('-', '')}_로테이션.png` : `방송팀_포지션_${ui.weekDate.replaceAll('-', '')}.png`;
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function shareImage() {
  if (!cardBlob) return toast('이미지를 준비 중이에요. 잠시 후 다시 눌러주세요');
  const file = new File([cardBlob], fileName(), { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(e => { if (e.name !== 'AbortError') { downloadBlob(cardBlob, fileName()); toast('공유가 안 돼서 이미지로 저장했어요'); } });
  } else { downloadBlob(cardBlob, fileName()); toast('이 브라우저는 바로 공유가 안 돼요. 저장된 이미지를 카톡으로 보내주세요'); }
}
async function copyImage() {
  if (!cardBlob) return toast('이미지를 준비 중이에요');
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cardBlob })]); toast('이미지를 복사했어요. 카톡 대화창에 붙여넣기 하세요'); }
  catch { toast('이 브라우저는 이미지 복사를 지원하지 않아요. 이미지 저장을 이용해 주세요'); }
}
function weekText(r) {
  const st = D().settings;
  const L = [`[${st.cardTitle}] ${dotDate(r.date)} (${dow(r.date)})`, '', `PD : ${nameOf(r.pd) || '-'}`];
  SLOTS.slice(1, 7).forEach(s => L.push(`${s.cam} ${s.pos} : ${nameOf(r[s.k]) || '-'}`));
  L.push(`Text : ${nameOf(r.text) || '-'}`);
  if (r.memo) L.push('', `📌 ${r.memo}`);
  return L.join('\n');
}
async function copyText(t, msg = '복사했어요') {
  try { await navigator.clipboard.writeText(t); toast(msg); }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg); }
}

/* ── 팀원 ── */
function renderMembers() {
  const yearCounts = countsFor(Object.values(D().rotations).filter(r => r.date.startsWith(todayISO().slice(0, 4))));
  const q = ui.memQuery;
  const all = membersSorted();
  if (!['all', 'active', 'off'].includes(ui.memFilter)) ui.memFilter = 'active';
  const f = { all: () => true, active: m => m.active, off: m => !m.active }[ui.memFilter];
  const list = all.filter(f).filter(m => !q || m.name.includes(q) || (m.phone || '').includes(q));
  const n = k => all.filter({ all: () => true, active: m => m.active, off: m => !m.active }[k]).length;
  return `
    <div class="row" style="margin:6px 0 12px"><div style="font-size:22px;font-weight:800;letter-spacing:-.02em" class="grow">팀원 명단</div><span class="muted small">${all.length}명</span></div>
    <div class="searchbox">${I.search}<input class="input" id="memq" placeholder="이름·연락처 검색" value="${esc(q)}"></div>
    <div class="seg" style="margin-bottom:12px">${[['active', '활동'], ['off', '비활동'], ['all', '전체']].map(([k, l]) => `<button class="${ui.memFilter === k ? 'on' : ''}" data-act="memf" data-v="${k}">${l} ${n(k)}</button>`).join('')}</div>
    <div class="card list">${list.map(m => `
      <div class="mem ${m.active ? '' : 'off'}">
        <button class="row grow" style="text-align:left;gap:12px" data-act="openMember" data-v="${m.id}">
          <div class="av ${/팀장/.test(m.note || '') ? 'leader' : ''}">${esc(m.name[0])}</div>
          <div class="grow">
            <div class="nm"><span>${esc(m.name)}</span>${m.age ? `<span class="age">${esc(m.age)}또래</span>` : ''}${m.note ? `<span class="chip ${/팀장/.test(m.note) ? 'warn' : ''}" style="font-size:11.5px;padding:1px 8px">${esc(m.note)}</span>` : ''}${m.type !== '팀원' ? `<span class="chip tag">${esc(m.type)}</span>` : ''}</div>
            <div class="sub">${m.phone ? esc(m.phone) : '<span style="color:var(--mute)">연락처 없음</span>'} · 올해 ${yearCounts[m.id]?.n || 0}회 ${(m.roles || []).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>
          </div>
        </button>
        <div class="mem-acts">
          <button class="btn sm" data-act="openMember" data-v="${m.id}">${can.editMembers() ? '수정' : '정보'}</button>
          <button class="btn sm" data-act="memberAn" data-v="${m.id}">${I.chart}분석</button>
          ${m.phone ? `<a class="callbtn" href="tel:${esc(m.phone.replace(/\D/g, ''))}" aria-label="전화">${I.phone}</a>` : ''}
        </div>
      </div>`).join('') || '<div class="empty">해당하는 팀원이 없어요</div>'}</div>`;
}
function openMemberEditor(id) {
  const isNew = !id; const editable = can.editMembers();
  let m = isNew ? { id: uid('m_'), name: '', age: '', phone: '', note: '', roles: [], type: '팀원', active: true, order: Object.keys(D().members).length } : clone(member(id));
  const ro = editable ? '' : 'readonly';
  const el = openSheet({
    title: isNew ? '팀원 추가' : editable ? '팀원 정보' : esc(m.name),
    body: `
      <label class="f">이름 *</label><input class="input" id="mName" value="${esc(m.name)}" ${ro}>
      <div class="row" style="gap:10px">
        <div style="width:34%"><label class="f">또래 (연생)</label><input class="input" id="mAge" inputmode="numeric" maxlength="4" placeholder="예: 02" value="${esc(m.age)}" ${ro}></div>
        <div class="grow"><label class="f">연락처</label><input class="input" id="mPhone" inputmode="tel" placeholder="010-0000-0000" value="${esc(m.phone)}" ${ro}></div>
      </div>
      <label class="f">비고</label><input class="input" id="mNote" placeholder="예: 팀장, 부팀장, 교환 학생" value="${esc(m.note)}" ${ro}>
      <label class="f">가능 포지션 <span style="font-weight:500">(포지션 선택 시 추천에 사용)</span></label>
      <div class="tagpick" id="mRoles">${ROLE_TAGS.map(t => `<button type="button" class="${m.roles?.includes(t) ? 'on' : ''}" data-t="${t}" ${editable ? '' : 'disabled'}>${t}</button>`).join('')}</div>
      <label class="f">구분</label>
      <div class="seg" id="mType">${MEMBER_TYPES.map(t => `<button type="button" class="${m.type === t ? 'on' : ''}" data-t="${t}" ${editable ? '' : 'disabled'}>${t}</button>`).join('')}</div>
      <div class="switch"><div><b>활동 중</b><div class="muted small">끄면 비활동으로 분류돼요 (기록은 유지)</div></div><button type="button" class="tgl ${m.active ? 'on' : ''}" id="mActive" ${editable ? '' : 'disabled'}></button></div>
      ${!isNew && m.phone ? `<div class="row" style="margin-top:14px"><a class="btn grow" href="tel:${esc(m.phone.replace(/\D/g, ''))}">${I.phone}전화</a><a class="btn grow" href="sms:${esc(m.phone.replace(/\D/g, ''))}">문자</a><button class="btn grow" id="mCopy">${I.copy}번호 복사</button></div>` : ''}`,
    foot: editable ? `${!isNew ? '<button class="btn danger" id="mDel">삭제</button>' : ''}<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="mSave">저장</button>` : `<button class="btn grow" data-close>닫기</button>`,
  });
  $('#mPhone', el).oninput = e => e.target.value = fmtPhone(e.target.value);
  $('#mCopy', el)?.addEventListener('click', () => copyText(m.phone, '번호를 복사했어요'));
  if (!editable) return;
  el.querySelectorAll('#mRoles button').forEach(b => b.onclick = () => b.classList.toggle('on'));
  el.querySelectorAll('#mType button').forEach(b => b.onclick = () => { el.querySelectorAll('#mType button').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#mActive', el).onclick = e => e.currentTarget.classList.toggle('on');
  $('#mSave', el).onclick = async () => {
    m.name = $('#mName', el).value.trim(); if (!m.name) return toast('이름을 입력해 주세요');
    if (Object.values(D().members).some(x => x.name === m.name && x.id !== m.id)) return toast('같은 이름의 팀원이 이미 있어요');
    m.age = $('#mAge', el).value.trim(); m.phone = fmtPhone($('#mPhone', el).value); m.note = $('#mNote', el).value.trim();
    m.roles = [...el.querySelectorAll('#mRoles button.on')].map(b => b.dataset.t);
    m.type = el.querySelector('#mType button.on')?.dataset.t || '팀원';
    m.active = $('#mActive', el).classList.contains('on');
    await store.saveMember(m); closeSheet(el); toast(isNew ? '팀원을 추가했어요' : '저장했어요');
  };
  $('#mDel', el)?.addEventListener('click', async () => {
    const used = Object.values(D().rotations).filter(r => SLOTS.some(s => r[s.k] === m.id) || r.spare?.includes(m.id) || r.absent?.includes(m.id)).length;
    if (used) {
      const pick = await choiceBox(`${m.name}님은 로테이션 기록에 ${used}번 있어요.\n· 비활동으로 변경: 명단에 남고 목록에서만 뒤로 빠져요\n· 삭제: 명단에서 지워지고, 지난 로테이션 기록의 이름은 그대로 남아요`,
        [['cancel', '취소', ''], ['delete', '삭제', 'danger'], ['inactive', '비활동으로 변경', 'primary']]);
      if (pick === 'inactive') { m.active = false; await store.saveMember(m); closeSheet(el); toast('비활동으로 바꿨어요'); }
      if (pick === 'delete') {
        const tag = FORMER + m.name;
        for (const r of Object.values(D().rotations)) {
          let ch = false; const n = clone(r);
          SLOTS.forEach(s2 => { if (n[s2.k] === m.id) { n[s2.k] = tag; ch = true; } });
          ['spare', 'absent'].forEach(k2 => { if ((n[k2] || []).includes(m.id)) { n[k2] = n[k2].map(x => x === m.id ? tag : x); ch = true; } });
          if (ch) await store.saveRotation(n);
        }
        await store.deleteMember(m.id); closeSheet(el); toast('명단에서 삭제했어요 (지난 기록의 이름은 유지)');
      }
      return;
    }
    if (!await confirmBox(`${m.name}님을 명단에서 삭제할까요?`, '삭제', true)) return;
    await store.deleteMember(m.id); closeSheet(el); toast('삭제했어요');
  });
}

/* ── 설정 ── */
function renderSettings() {
  const u = store.user, st = D().settings;
  const li = (act, ic, title, desc, extra = '') => `<button class="li" data-act="${act}" ${extra}><span class="ic">${ic}</span><div class="grow"><b>${title}</b>${desc ? `<div class="d">${desc}</div>` : ''}</div><span class="muted">${I.chev}</span></button>`;
  return `
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin:6px 0 4px">설정</div>
    ${PUSH.configured() ? (() => { const st = PUSH.state(); const desc = { on: '이 기기에서 포지션 알림을 받고 있어요', ready: '켜면 포지션이 배정됐을 때 잠금화면으로 알려드려요', 'ios-home': '아이폰은 홈 화면에 추가한 앱에서 켤 수 있어요', denied: '알림이 차단됨 · 휴대폰 설정에서 허용해 주세요', unsupported: '이 브라우저는 푸시 알림을 지원하지 않아요' }[st];
      return `<div class="section-title">이 기기 알림</div><div class="card list"><div class="li"><span class="ic">${I.bell}</span><div class="grow"><b>포지션 알림 ${st === 'on' ? '켜짐' : '꺼짐'}</b><div class="d">${desc}</div></div>
        ${st === 'on' ? `<button class="btn sm" data-act="pushOff">끄기</button>` : st === 'ready' ? `<button class="btn sm primary" data-act="pushOn">켜기</button>` : st === 'ios-home' ? `<button class="btn sm" data-act="pushOn">방법</button>` : ''}</div>
        ${st === 'on' && can.editRotation() ? `<button class="li" data-act="pushTest"><span class="ic">${I.share}</span><div class="grow"><b>나에게 테스트 알림 보내기</b></div><span class="muted">${I.chev}</span></button>` : ''}</div>`; })() : ''}
    <div class="section-title">내 계정</div>
    <div class="card list">
      <div class="li"><span class="ic">${I.user}</span><div class="grow"><b>${esc(u.name)}</b><div class="d">아이디 ${esc(u.loginId)} · ${ROLES[u.role]}</div></div></div>
      ${li('changePw', I.key, '비밀번호 변경', '')}
      ${li('logout', I.logout, '로그아웃', '')}
    </div>
    ${can.owner() ? `
    <div class="section-title">계정 관리 <span class="muted small" style="font-weight:600">메인 관리자 전용</span></div>
    <div class="card list" id="userList"><div class="li muted">불러오는 중…</div></div>
    <div class="row" style="margin-top:8px"><button class="btn grow" data-act="addUser">${I.plus}계정 만들기</button><button class="btn grow" data-act="bulkUsers">${I.people}명단에서 한 번에 만들기</button></div>
    <div class="muted small" style="margin:8px 4px">권한 — <b>교역자·팀장</b>: 로테이션·팀원 편집, 알림 / <b>부팀장</b>: 로테이션 편집, 알림 / <b>팀원</b>: 보기만 가능, 내 포지션 확인</div>
    <div class="section-title">공지 이미지 문구</div>
    <div class="card list">${li('editTexts', I.pen, '팀 이름 · 카드 제목 · 하단 문구', `${esc(st.teamName)} / ${esc(st.cardTitle)}${st.footer ? ' / ' + esc(st.footer) : ''}`)}</div>` : ''}
    ${can.editRotation() ? `<div class="section-title">데이터</div>
    <div class="card list">
      ${li('exportJson', I.down, '백업 파일 내보내기 (JSON)', '전체 데이터를 파일로 저장')}
      ${li('exportCsv', I.file, '시트 형식으로 내보내기 (CSV)', '엑셀·구글 시트에서 열 수 있어요')}
      ${can.owner() ? li('importJson', I.upload, '백업 파일 가져오기', '현재 데이터를 파일 내용으로 교체') : ''}
      ${can.owner() ? li('resetSeed', I.file, '기존 시트 데이터로 되돌리기', '2026.01~11 원본 로테이션 + 명단') : ''}
    </div>` : ''}
    <div class="section-title">연결 상태</div>
    <div class="card" style="padding:14px;font-size:13.5px">
      ${store.mode === 'local' ? `<b>로컬 모드</b><div class="muted" style="margin-top:4px">데이터와 계정이 이 기기 브라우저에만 저장돼요. 팀장·부팀장이 각자 폰에서 같은 데이터를 쓰려면 README의 <b>Firebase 연결</b>을 진행해 주세요.</div>` : `<b>클라우드 모드 (Firebase)</b><div class="muted" style="margin-top:4px">모든 기기에서 같은 데이터가 실시간으로 공유돼요.</div>`}
    </div>
    <p class="muted small" style="text-align:center;margin:22px 0 4px">VISION FILM CREW · SLS 방송팀 관리 시스템</p>`;
}
async function changeUserRole(sel) {
  const uid2 = sel.dataset.uid, role = sel.value, name = sel.closest('.li')?.querySelector('b')?.textContent || '';
  if (!await confirmBox(`${name}님의 역할을 ${ROLES[role]}(으)로 바꿀까요?`, '변경')) { loadUserList(); return; }
  try { await store.setUserRole(uid2, role); toast(`${ROLES[role]}(으)로 바꿨어요`); } catch (e) { toast('변경 실패: ' + e.message); }
  loadUserList();
}
async function loadUserList() {
  const box = $('#userList'); if (!box) return;
  try {
    const users = (await store.listUsers()).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    box.innerHTML = users.map(u => `<div class="li"><span class="avatar" style="width:34px;height:34px;border-radius:10px">${esc((u.name || '?')[0])}</span><div class="grow"><b>${esc(u.name)}</b> <span class="role ${u.role}">${ROLES[u.role]}</span><div class="d">아이디 ${esc(u.loginId)}</div></div>
      ${u.role !== 'owner' ? `<select class="input role-sel" data-uid="${u.uid}" style="height:34px;width:auto;padding:0 8px;font-size:13px">${ROLE_OPTS.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLES[r]}</option>`).join('')}</select>${store.mode === 'local' ? `<button class="btn sm ghost" data-act="resetUserPw" data-v="${u.uid}">비번 초기화</button>` : ''}<button class="btn sm danger" data-act="delUser" data-v="${u.uid}" data-n="${esc(u.name)}">삭제</button>` : ''}</div>`).join('');
      box.querySelectorAll('.role-sel').forEach(x => x.onchange = () => changeUserRole(x));
  } catch (e) { box.innerHTML = `<div class="li muted">계정 목록을 불러오지 못했어요 (${esc(e.message)})</div>`; }
}
async function openBulkUsers() {
  let existing = [];
  try { existing = await store.listUsers(); } catch {}
  const hasName = new Set(existing.map(u => u.name)), hasId = new Set(existing.map(u => u.loginId));
  const ms = membersSorted().filter(m => m.active);
  const defRole = m => /강도사|전도사|목사|교역자/.test((m.note || '') + m.name) || m.type === '사역자' ? 'pastor' : /부팀장/.test(m.note || '') ? 'subleader' : /팀장/.test(m.note || '') ? 'leader' : 'member';
  const defOn = m => /팀장|부팀장/.test(m.note || '') || /강도사|전도사|목사/.test(m.name);
  const el = openSheet({
    title: '명단에서 계정 한 번에 만들기', wide: true,
    body: `<p class="muted small" style="margin:-4px 2px 12px">체크한 사람의 계정을 같은 초기 비밀번호로 만들어요. 아이디는 이름(한글)으로 채워뒀고 바꿀 수 있어요.</p>
      <div class="card list">${ms.map(m => { const done = hasName.has(m.name); return `<div class="li" data-mid="${m.id}" style="gap:10px;${done ? 'opacity:.5' : ''}">
        <input type="checkbox" class="bu-on" ${!done && defOn(m) ? 'checked' : ''} ${done ? 'disabled' : ''} style="width:20px;height:20px;flex:none">
        <div style="width:84px;flex:none;font-size:14px"><b>${esc(m.name)}</b><div class="d">${done ? '계정 있음' : esc(m.note || '')}</div></div>
        <input class="input bu-id" style="height:38px;flex:1;min-width:0;padding:0 8px;font-size:13.5px" value="${esc(m.name.replace(/\s.*$/, ''))}" autocapitalize="off" ${done ? 'disabled' : ''}>
        <select class="input bu-role" style="height:38px;width:78px;flex:none;padding:0 6px;font-size:13.5px" ${done ? 'disabled' : ''}>${ROLE_OPTS.map(r => `<option value="${r}" ${defRole(m) === r ? 'selected' : ''}>${ROLES[r]}</option>`).join('')}</select>
      </div>`; }).join('')}</div>
      <label class="f">초기 비밀번호 (6자 이상, 모두 동일)</label><input class="input" id="buPw" type="text" autocomplete="off" placeholder="예: 123456">
      <div class="err" id="buErr"></div><div id="buLog" class="small muted"></div>`,
    foot: `<button class="btn grow" data-close>닫기</button><button class="btn primary grow" id="buGo">체크한 계정 만들기</button>`,
  });
  $('#buGo', el).onclick = async () => {
    const err = $('#buErr', el), log = $('#buLog', el); err.textContent = ''; log.innerHTML = '';
    const pw = $('#buPw', el).value;
    if (pw.length < 6) return err.textContent = '비밀번호는 6자 이상이어야 해요';
    const rows = [...el.querySelectorAll('[data-mid]')].filter(r => r.querySelector('.bu-on').checked).map(r => ({ name: member(r.dataset.mid).name, memberId: r.dataset.mid, loginId: normId(r.querySelector('.bu-id').value), role: r.querySelector('.bu-role').value }));
    if (!rows.length) return err.textContent = '만들 사람을 체크해 주세요';
    const bad = rows.find(r => !ID_RE.test(r.loginId) || r.loginId === OWNER_ID || hasId.has(r.loginId));
    if (bad) return err.textContent = `${bad.name}: ${ID_RE.test(bad.loginId) ? '이미 쓰는 아이디예요' : ID_MSG}`;
    if (new Set(rows.map(r => r.loginId)).size !== rows.length) return err.textContent = '아이디가 서로 겹쳐요';
    $('#buGo', el).disabled = true;
    const ok = [];
    for (const r of rows) {
      try { await store.createUser({ ...r, pw }); ok.push(r); log.innerHTML += `<div>✓ ${esc(r.name)} · ${esc(r.loginId)} · ${ROLES[r.role]}</div>`; }
      catch (e) { log.innerHTML += `<div style="color:var(--danger)">✕ ${esc(r.name)}: ${esc(e.message)}</div>`; }
    }
    $('#buGo', el).disabled = false; loadUserList();
    toast(`${ok.length}개 계정을 만들었어요`);
    if (ok.length) log.innerHTML += `<div style="margin-top:8px"><button class="btn sm" id="buCopy">${I.copy}아이디 목록 복사</button></div>`;
    $('#buCopy', el)?.addEventListener('click', () => copyText(`[SLS 방송팀 관리 시스템 계정]\n${location.origin + location.pathname}\n` + ok.map(r => `${r.name} (${ROLES[r.role]}) 아이디: ${r.loginId}`).join('\n') + `\n초기 비밀번호는 따로 안내드려요. 로그인 후 설정 > 비밀번호 변경에서 바꿔주세요.`, '아이디 목록을 복사했어요'));
  };
}
function openAddUser() {
  const el = openSheet({
    title: '계정 만들기',
    body: `
      <label class="f">역할</label><div class="seg" id="uRole"><button type="button" data-v="pastor">교역자</button><button type="button" class="on" data-v="leader">팀장</button><button type="button" data-v="subleader">부팀장</button><button type="button" data-v="member">팀원</button></div>
      <label class="f">이름</label><input class="input" id="uName" placeholder="예: 김민" list="memNames">
      <datalist id="memNames">${membersSorted().filter(m => m.active).map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
      <label class="f">아이디 (한글·영문·숫자 2~20자)</label><input class="input" id="uId" autocapitalize="off" placeholder="예: 김민">
      <label class="f">초기 비밀번호 (6자 이상)</label><input class="input" id="uPw" autocomplete="new-password">
      <p class="muted small">만든 뒤 아이디·비밀번호를 당사자에게 전달해 주세요. 본인이 설정 &gt; 비밀번호 변경에서 바꿀 수 있어요.</p>
      <div class="err" id="uErr"></div>`,
    foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="uSave">만들기</button>`,
  });
  el.querySelectorAll('#uRole button').forEach(b => b.onclick = () => { el.querySelectorAll('#uRole button').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#uSave', el).onclick = async () => {
    const err = $('#uErr', el); err.textContent = '';
    const name = $('#uName', el).value.trim(), loginId = normId($('#uId', el).value), pw = $('#uPw', el).value;
    const role = el.querySelector('#uRole .on').dataset.v;
    if (!name) return err.textContent = '이름을 입력해 주세요';
    if (!ID_RE.test(loginId)) return err.textContent = ID_MSG;
    if (loginId === OWNER_ID) return err.textContent = '관리자 아이디와 같을 수 없어요';
    if (pw.length < 6) return err.textContent = '비밀번호는 6자 이상이어야 해요';
    $('#uSave', el).disabled = true;
    try { await store.createUser({ loginId, pw, name, role, memberId: memberIdByName(name) }); closeSheet(el); toast(`${ROLES[role]} 계정을 만들었어요`); loadUserList(); }
    catch (e) { err.textContent = e.message; $('#uSave', el).disabled = false; }
  };
}
function openChangePw() {
  const el = openSheet({
    title: '비밀번호 변경',
    body: `<label class="f">현재 비밀번호</label><input class="input" type="password" id="p0" autocomplete="current-password">
      <label class="f">새 비밀번호 (6자 이상)</label><input class="input" type="password" id="p1" autocomplete="new-password">
      <label class="f">새 비밀번호 확인</label><input class="input" type="password" id="p2" autocomplete="new-password"><div class="err" id="pErr"></div>`,
    foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="pSave">변경</button>`,
  });
  $('#pSave', el).onclick = async () => {
    const e = $('#pErr', el), a = $('#p1', el).value;
    if (a.length < 6) return e.textContent = '비밀번호는 6자 이상이어야 해요';
    if (a !== $('#p2', el).value) return e.textContent = '새 비밀번호가 서로 달라요';
    try { await store.changePassword($('#p0', el).value, a); closeSheet(el); toast('비밀번호를 바꿨어요'); } catch (x) { e.textContent = x.message; }
  };
}
function openEditTexts() {
  const st = D().settings;
  const el = openSheet({
    title: '공지 이미지 문구',
    body: `<label class="f">팀 이름 (상단·월간 이미지 제목)</label><input class="input" id="tTeam" value="${esc(st.teamName)}">
      <label class="f">카드 제목 (주간 카드 오른쪽 위)</label><input class="input" id="tCard" value="${esc(st.cardTitle)}">
      <label class="f">하단 문구 (선택)</label><input class="input" id="tFoot" placeholder="예: VISION FILM CREW · 30분 전까지 세팅 완료!" value="${esc(st.footer)}">`,
    foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="tSave">저장</button>`,
  });
  $('#tSave', el).onclick = async () => {
    await store.saveSettings({ teamName: $('#tTeam', el).value.trim() || DEFAULT_SETTINGS.teamName, cardTitle: $('#tCard', el).value.trim() || DEFAULT_SETTINGS.cardTitle, footer: $('#tFoot', el).value.trim() });
    closeSheet(el); toast('저장했어요');
  };
}
function exportJson() {
  const el = openSheet({
    title: '백업 파일 내보내기',
    body: `<div class="switch" style="margin-top:0"><div><b>연락처 포함</b><div class="muted small">GitHub 등 공개된 곳에 올릴 파일이면 꺼주세요</div></div><button class="tgl on" id="ePh"></button></div>`,
    foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="eGo">${I.down}내보내기</button>`,
  });
  $('#ePh', el).onclick = e => e.currentTarget.classList.toggle('on');
  $('#eGo', el).onclick = () => {
    const withPhone = $('#ePh', el).classList.contains('on');
    const out = { app: 'vfc-rotation', version: 1, exportedAt: new Date().toISOString(), settings: D().settings,
      members: membersSorted().map(m => withPhone ? m : { ...m, phone: '' }), rotations: Object.values(D().rotations).sort((a, b) => a.date.localeCompare(b.date)) };
    downloadBlob(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `방송팀_로테이션_백업_${todayISO()}.json`);
    closeSheet(el); toast('백업 파일을 저장했어요');
  };
}
function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['날짜', 'PD', 'Cam1, 2 (Main1, 2)', 'Cam3 (L-Moving)', 'Cam4 (R-Moving)', 'Cam5, 6 (PTZ)', 'Cam7 (Jimmy Jib)', 'Text', '예비/휴가', '불참', '메모']];
  Object.values(D().rotations).sort((a, b) => a.date.localeCompare(b.date)).forEach(r => rows.push([dotDate(r.date), nameOf(r.pd), [nameOf(r.main1), nameOf(r.main2)].filter(Boolean).join(' / '), nameOf(r.cam3), nameOf(r.cam4), nameOf(r.ptz), nameOf(r.jib), nameOf(r.text), (r.spare || []).map(nameOf).join(', '), (r.absent || []).map(nameOf).join(', '), r.memo || '']));
  downloadBlob(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), `방송팀_로테이션_${todayISO()}.csv`);
  toast('CSV 파일을 저장했어요');
}
function importJson() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const data = normalizeImport(JSON.parse(await f.text()));
      if (!await confirmBox(`팀원 ${Object.keys(data.members).length}명, 로테이션 ${Object.keys(data.rotations).length}건으로 현재 데이터를 교체할까요?`, '가져오기', true)) return;
      await store.replaceAll(data); toast('가져오기 완료');
    } catch (e) { toast('가져오기 실패: ' + e.message); }
  };
  inp.click();
}

/* ───────── 이벤트 ───────── */
const ACT = {
  tab: v => { ui.tab = v; saveUI(); rerender(); window.scrollTo(0, 0); },
  ym: v => { ui.ym = shiftYM(ui.ym, +v); rerender(); },
  ymPick: () => {
    const years = [...new Set([...allDates().map(d => d.slice(0, 4)), todayISO().slice(0, 4)])].sort();
    const el = openSheet({ title: '월 선택', body: years.map(y => `<div class="grp">${y}년</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${Array.from({ length: 12 }, (_, i) => { const ym = `${y}-${pad(i + 1)}`; const n = rotationsOfMonth(ym).length; return `<button class="btn ${ym === ui.ym ? 'primary' : n ? '' : 'ghost'}" data-ym="${ym}" style="height:52px;flex-direction:column;gap:0">${i + 1}월<span style="font-size:11px;font-weight:600;opacity:.6">${n ? n + '회' : ''}</span></button>`; }).join('')}</div>`).join('') + `<div style="margin-top:10px"><button class="btn block ghost" data-ym="${shiftYM(`${years.at(-1)}-12`, 1)}">${Number(years.at(-1)) + 1}년 1월로 이동</button></div>` });
    el.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { ui.ym = b.dataset.ym; closeSheet(el); rerender(); });
  },
  mview: v => { ui.monthView = v; saveUI(); rerender(); },
  toggleCounts: () => { ui.showCounts = !ui.showCounts; rerender(); },
  edit: v => openEditor(v),
  analysis: () => openAnalysis(defaultAnalysisRef()),
  addDate: () => {
    const sug = sundaysOf(ui.ym).find(d => !D().rotations[d]) || `${ui.ym}-01`;
    const el = openSheet({ title: '날짜 추가', body: `<label class="f">예배 날짜</label><input class="input" type="date" id="nd" value="${sug}"><p class="muted small">일요일 외 특별예배도 추가할 수 있어요.</p>`, foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="ndGo">다음</button>` });
    $('#ndGo', el).onclick = () => { const d = $('#nd', el).value; if (!d) return; closeSheet(el); ui.ym = ymOf(d); rerender(); D().rotations[d] ? openEditor(d) : openEditor(d, true); };
  },
  fillSundays: async () => { const miss = sundaysOf(ui.ym).filter(d => !D().rotations[d]); for (const d of miss) await store.saveRotation(emptyRotation(d)); toast(`${miss.length}개 날짜를 추가했어요`); },
  toWeek: v => { ui.tab = 'week'; ui.weekDate = v; ui.weekMode = 'week'; saveUI(); rerender(); window.scrollTo(0, 0); },
  wdate: v => { ui.weekDate = v; rerender(); },
  wmode: v => { ui.weekMode = v; rerender(); },
  wym: v => {
    const months = [...new Set(allDates().map(ymOf))], t = months[months.indexOf(ymOf(ui.weekDate)) + +v];
    if (!t) return toast('더 이상 로테이션이 없어요');
    ui.weekDate = rotationsOfMonth(t)[0].date; rerender();
  },
  shareImg: () => shareImage(),
  saveImg: () => cardBlob ? (downloadBlob(cardBlob, fileName()), toast('이미지를 저장했어요')) : toast('이미지를 준비 중이에요'),
  copyImg: () => copyImage(),
  copyText: () => copyText(weekText(D().rotations[ui.weekDate]), '텍스트를 복사했어요. 카톡에 붙여넣기 하세요'),
  memf: v => { ui.memFilter = v; saveUI(); rerender(); },
  openMember: v => openMemberEditor(v),
  memberAn: v => openMemberAnalysis(v),
  notify: v => openNotify(v),
  pushOn: () => enablePush(),
  pushOff: () => disablePush(),
  pushHide: () => { lsSet('vfc-rotation:pushHide', true); rerender(); },
  pushTest: async () => {
    try {
      const subs = await store.listMySubs();
      if (!subs.length) return toast('이 계정에 등록된 기기가 없어요');
      const res = await fetch(CFG.pushApi, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await store.idToken() }, body: JSON.stringify({ items: subs.map(s => ({ sub: { endpoint: s.endpoint, keys: s.keys }, payload: { title: '🔔 테스트 알림', body: 'SLS 방송팀 관리 시스템 알림이 잘 와요!', url: location.origin + location.pathname, tag: 'test' } })) }) });
      const j = await res.json().catch(() => ({}));
      toast(res.ok ? `테스트 알림 ${j.sent}건 보냈어요` : '실패: ' + (j.error || res.status));
    } catch (e) { toast('실패: ' + e.message); }
  },
  ack: async v => { const me = myMemberId(); if (!me) return toast('명단과 연결된 계정이 아니에요'); try { await store.saveAck(v, me); toast('확인했어요 👍'); } catch (e) { toast(e.message); } },
  addMember: () => openMemberEditor(null),
  me: () => { ui.tab = 'settings'; saveUI(); rerender(); },
  changePw: () => openChangePw(),
  logout: async () => { if (!await confirmBox('로그아웃할까요?', '로그아웃')) return; await store.logout(); rerender(); },
  addUser: () => openAddUser(),
  bulkUsers: () => openBulkUsers(),
  delUser: async (v, el) => { if (!await confirmBox(`${el.dataset.n}님의 계정을 삭제할까요?\n삭제하면 더 이상 로그인해서 볼 수 없어요.`, '삭제', true)) return; await store.deleteUser(v); toast('계정을 삭제했어요'); loadUserList(); },
  resetUserPw: async v => {
    const el = openSheet({ title: '비밀번호 초기화', body: `<label class="f">새 비밀번호 (6자 이상)</label><input class="input" id="rp">`, foot: `<button class="btn grow" data-close>취소</button><button class="btn primary grow" id="rpGo">변경</button>` });
    $('#rpGo', el).onclick = async () => { const p = $('#rp', el).value; if (p.length < 6) return toast('6자 이상 입력해 주세요'); await store.resetPassword(v, p); closeSheet(el); toast('비밀번호를 바꿨어요'); };
  },
  editTexts: () => openEditTexts(),
  exportJson: () => exportJson(),
  exportCsv: () => exportCsv(),
  importJson: () => importJson(),
  resetSeed: async () => { if (!await confirmBox('현재 데이터를 지우고 기존 구글 시트 데이터(2026.01~11 로테이션 + 명단)로 되돌릴까요?\n연락처는 백업 파일 가져오기로 넣을 수 있어요.', '되돌리기', true)) return; await store.replaceAll(seedData()); toast('되돌렸어요'); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); f(el.dataset.v, el); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'memq') { ui.memQuery = e.target.value; const pos = e.target.selectionStart; rerender(); const i = $('#memq'); i.focus(); i.setSelectionRange(pos, pos); }
});

/* ───────── 시작 ───────── */
(async function boot() {
  $('#app').innerHTML = '<div class="login"><div class="muted">불러오는 중…</div></div>';
  try {
    store = CFG.firebase ? new FirebaseStore() : new LocalStore();
    await store.init();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="login"><div class="box"><h1>연결 오류</h1><p class="muted">Firebase에 연결하지 못했어요. config.js 설정과 인터넷 연결을 확인해 주세요.</p><pre class="small" style="white-space:pre-wrap">${esc(e.message)}</pre></div></div>`;
    return;
  }
  if (PUSH.configured() && PUSH.supported()) getSW().catch(e => console.warn('sw', e));
  store.subscribe(() => {
    if (!store.user) return;
    const y = window.scrollY; rerender(); window.scrollTo(0, y);
    if (sheetStack.length && draft) renderEditorBody();
  });
  rerender();
})();
