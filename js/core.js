'use strict';
/* =====================================================================
 *  core.js — 데이터 로드 · 두 소스 병합 · 패치 변경 감지 · 자동 갱신
 *  모든 수치는 실행 시점에 Data Dragon / CommunityDragon JSON에서 읽습니다.
 * ===================================================================== */
const CFG = {
  BASE_VERSION: '16.22.1',
  LANG_DD: 'ko_KR', LANG_CD: 'ko_kr',
  DD: 'https://ddragon.leagueoflegends.com',
  CD: 'https://raw.communitydragon.org',
  DEFAULT_POLL_MIN: 30,
  PREFETCH: 8,
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('lolquiz:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lolquiz:' + k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ followLatest: true, pollMin: CFG.DEFAULT_POLL_MIN }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

/* ---------- 유틸 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => Math.floor(Math.random() * n);
const pick = a => { if (!a || !a.length) throw new Error('후보 없음'); return a[rand(a.length)]; };
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmt = n => typeof n === 'number' ? String(+n.toFixed(3)) : String(n ?? '');
const fmtArr = a => Array.isArray(a) ? a.map(fmt).join(' / ') : fmt(a);
const r1 = x => Math.round(x * 10) / 10;
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && !isFinite(v));
const strip = s => s ? String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '…').replace(/@[^@\s]{1,40}@/g, '…').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
const trunc = (s, n) => s && s.length > n ? s.slice(0, n) + '…' : (s || '');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }
const timeStr = t => t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
const okv = r => r.status === 'fulfilled' ? r.value : null;


/* ---------- 한국어 조사: 받침을 보고 자동 선택 (이/가, 은/는, 을/를, 과/와, 으로/로) ---------- */
function jong(w) {
  const t = String(w ?? '').replace(/[\s」』)\]"'.,!?%…·°+\-]+$/, '');
  const ch = t[t.length - 1]; if (!ch) return 0;
  const c = ch.charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28;          // 0 = 받침 없음, 8 = ㄹ
  if (/[0-9]/.test(ch)) return [21, 8, 0, 16, 0, 0, 1, 8, 8, 0][+ch];  // 영 일 이 삼 사 오 육 칠 팔 구
  const l = ch.toLowerCase();
  if (l === 'l' || l === 'r') return 8;
  if (l === 'm' || l === 'n') return 4;
  return 0;
}
const JOSA = { 이: ['이', '가'], 은: ['은', '는'], 을: ['을', '를'], 과: ['과', '와'], 이라: ['이라', '라'], 이고: ['이고', '고'], 이며: ['이며', '며'] };
function josa(w, t) {
  const jo = jong(w);
  if (t === '으로') return jo === 0 || jo === 8 ? '로' : '으로';
  const pr = JOSA[t]; return jo ? pr[0] : pr[1];
}
const J = (w, t) => String(w) + josa(w, t);

/* ---------- 네트워크 ---------- */
const ERRORS = [];
function logErr(url, e) {
  const kind = e.name === 'AbortError' ? '시간 초과' : e.kind === 'http' ? e.message
    : e instanceof SyntaxError ? 'JSON 형식 오류' : '접속 차단(CORS/CSP) 또는 네트워크 오류';
  ERRORS.push({ url, kind, at: Date.now() });
  if (ERRORS.length > 40) ERRORS.shift();
  console.warn('[fetch 실패]', kind, url, e);
}
async function getJSON(url, { fresh = false, timeout = 12000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: fresh ? 'no-store' : 'default', mode: 'cors', credentials: 'omit' });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.kind = 'http'; throw e; }
    return await r.json();
  } catch (e) { logErr(url, e); throw e; }
  finally { clearTimeout(t); }
}
function envHints() {
  const h = [];
  let framed = false; try { framed = window.top !== window.self; } catch (e) { framed = true; }
  let opaque = false; try { opaque = location.origin === 'null'; } catch (e) { opaque = true; }
  if (framed || opaque) h.push('미리보기(샌드박스) 창 안에서 열린 것 같아요. 외부 서버 접속이 막힌 화면에서는 데이터를 받을 수 없습니다. 웹 주소로 브라우저에서 열어 주세요.');
  let proto = ''; try { proto = location.protocol; } catch (e) {}
  if (proto === 'file:') h.push('파일을 직접 열었어요(file://). 웹에 올리거나 로컬 서버로 열어 주세요.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) h.push('기기가 오프라인 상태입니다.');
  return h;
}

/* ---------- URL ---------- */
const U = {
  ddVersions: () => `${CFG.DD}/api/versions.json`,
  ddData: (v, f) => `${CFG.DD}/cdn/${v}/data/${CFG.LANG_DD}/${f}`,
  ddSummary: v => U.ddData(v, 'champion.json'),
  ddDetail: (v, id) => U.ddData(v, `champion/${id}.json`),
  ddImg: (v, g, f) => `${CFG.DD}/cdn/${v}/img/${g}/${f}`,
  ddLoading: (id, n) => `${CFG.DD}/cdn/img/champion/loading/${id}_${n}.jpg`,
  ddRuneIcon: path => `${CFG.DD}/cdn/img/${path}`,
  cdMeta: () => `${CFG.CD}/latest/content-metadata.json`,
  cdBase: p => `${CFG.CD}/${p}/plugins/rcp-be-lol-game-data/global`,
  cdData: (p, f) => `${U.cdBase(p)}/${CFG.LANG_CD}/v1/${f}`,
  cdSummary: p => U.cdData(p, 'champion-summary.json'),
  cdDetail: (p, k) => U.cdData(p, `champions/${k}.json`),
  cdGameBin: (p, alias) => `${CFG.CD}/${p}/game/data/characters/${alias}/${alias}.bin.json`,
  cdAsset: (p, path) => path ? `${U.cdBase(p)}/default/${String(path).replace(/^\/?lol-game-data\/assets\//i, '').toLowerCase()}` : null,
};

/* ---------- 상태 ---------- */
const S = {
  dd: null, latest: null, cdPath: null, cdVersion: null,
  champs: [], byKey: new Map(), details: new Map(), pending: new Map(),
  data: {}, extra: {}, needFail: {},
  hash: null, fill: null, lastCheck: 0, nextCheck: 0, fail: 0,
  loading: false, ready: false, game: null, timer: null, detailFail: 0, loadErr: null,
};
const newFill = () => ({ CD: {}, DD: {}, CDG: {}, cdOnlyChamps: 0, ddOnlyChamps: 0 });
function bump(src, field) { if (S.fill) S.fill[src][field] = (S.fill[src][field] || 0) + 1; }
function prefer(field, a, aSrc, b, bSrc) {
  if (!isEmpty(a)) return [a, aSrc];
  if (!isEmpty(b)) { bump(bSrc, field); return [b, bSrc]; }
  return [null, null];
}

/* =====================================================================
 *  버전
 * ===================================================================== */
async function resolveVersions() {
  let dd = CFG.BASE_VERSION, latest = null, list = null;
  try { list = await getJSON(U.ddVersions(), { fresh: true }); latest = list[0]; } catch (e) {}
  if (settings.followLatest && latest) dd = latest;
  else if (list && !list.includes(CFG.BASE_VERSION) && latest) dd = latest;
  let cdLatest = null;
  try { const m = await getJSON(U.cdMeta(), { fresh: true }); cdLatest = m.version || null; } catch (e) {}
  return { dd, latest, cdLatest, list };
}
async function fetchDdSummary(v) {
  const cands = [...new Set([v.dd, v.latest, CFG.BASE_VERSION, v.list && v.list[1]].filter(Boolean))];
  for (const ver of cands) { try { return { ver, data: await getJSON(U.ddSummary(ver)) }; } catch (e) {} }
  return { ver: v.dd, data: null };
}
async function fetchCdSummary(ver, cdLatest) {
  const mm = ver.split('.').slice(0, 2).join('.');
  const cands = [];
  if (settings.followLatest && cdLatest && cdLatest.startsWith(mm + '.')) cands.push('latest');
  cands.push(mm);
  if (!cands.includes('latest')) cands.push('latest');
  for (const p of cands) { try { return { p, data: await getJSON(U.cdSummary(p)) }; } catch (e) {} }
  return { p: 'latest', data: null };
}

/* =====================================================================
 *  챔피언 요약 병합
 * ===================================================================== */
const TAGS = { Fighter: '전사', Tank: '탱커', Mage: '마법사', Assassin: '암살자', Marksman: '원거리 딜러', Support: '서포터' };
const roleToTag = r => { const s = String(r || '').toLowerCase(); return Object.keys(TAGS).find(t => t.toLowerCase() === s) || null; };

function mergeSummary(dd, cd) {
  const byKey = new Map();
  if (dd && dd.data) for (const c of Object.values(dd.data)) {
    byKey.set(+c.key, {
      key: +c.key, id: c.id, alias: c.id, name: c.name, title: c.title, tags: c.tags || [], partype: c.partype,
      stats: c.stats || null, blurb: c.blurb, iconDD: c.image && c.image.full, iconCD: null, ddOk: true, cdOk: false,
      src: { name: 'DD', title: 'DD', tags: 'DD', stats: 'DD' },
    });
  }
  for (const c of (Array.isArray(cd) ? cd : [])) {
    if (!(c.id > 0)) continue;
    let m = byKey.get(c.id);
    if (!m) { m = { key: c.id, id: c.alias, alias: c.alias, tags: [], stats: null, ddOk: false, src: {} }; byKey.set(c.id, m); S.fill.cdOnlyChamps++; }
    m.cdOk = true; m.iconCD = c.squarePortraitPath;
    if (isEmpty(m.name) && c.name) { m.name = c.name; m.src.name = 'CD'; if (m.ddOk) bump('CD', '챔피언 이름'); }
    if (isEmpty(m.alias) && c.alias) m.alias = c.alias;
    if (isEmpty(m.tags) && Array.isArray(c.roles)) {
      const t = c.roles.map(roleToTag).filter(Boolean);
      if (t.length) { m.tags = t; m.src.tags = 'CD'; bump('CD', '역할군'); }
    }
  }
  for (const m of byKey.values()) if (m.ddOk && !m.cdOk) S.fill.ddOnlyChamps++;
  return [...byKey.values()].filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
function iconUrls(c) {
  return [c.iconDD && U.ddImg(S.dd, 'champion', c.iconDD), c.iconCD && U.cdAsset(S.cdPath, c.iconCD),
    U.cdAsset(S.cdPath, `/lol-game-data/assets/v1/champion-icons/${c.key}.png`)].filter(Boolean);
}

/* =====================================================================
 *  챔피언 상세 병합 (필요할 때만 로드)
 * ===================================================================== */
const SLOTS = ['Q', 'W', 'E', 'R'];
const RARITY = { kNoRarity: '일반', kRare: '희귀', kEpic: '서사', kLegendary: '전설', kMythic: '신화', kUltimate: '궁극', kTranscendent: '초월', kExalted: '고귀' };
const DMG = { kPhysical: '물리', kMagic: '마법', kMixed: '혼합' };
function cleanArr(arr, n) {
  if (!Array.isArray(arr)) return null;
  let a = arr.map(Number).filter(x => isFinite(x));
  if (n) a = a.slice(0, n); else while (a.length > 1 && a[a.length - 1] === 0) a.pop();
  return a.length && !a.every(x => x === 0) ? a : null;
}
function mergeDetail(c, dd, cd, ver, p) {
  if (isEmpty(c.title)) { const [t, ts] = prefer('칭호', dd && dd.title, 'DD', cd && cd.title, 'CD'); if (t) { c.title = t; c.src.title = ts; } }
  if (isEmpty(c.tags) && cd && Array.isArray(cd.roles)) { c.tags = cd.roles.map(roleToTag).filter(Boolean); c.src.tags = 'CD'; }
  const [lore, loreSrc] = prefer('스토리', strip(dd && dd.lore), 'DD', strip(cd && cd.shortBio), 'CD');
  const isMana = /마나|mana/i.test(c.partype || '');
  const spells = SLOTS.map((K, i) => {
    const a = dd && dd.spells ? dd.spells[i] : null;
    const cs = cd && Array.isArray(cd.spells) ? cd.spells : [];
    const b = cs.find(s => String(s.spellKey || '').toUpperCase() === K) || cs[i] || null;
    if (!a && !b) return null;
    const maxrank = (a && a.maxrank) || (b && b.maxLevel) || (K === 'R' ? 3 : 5);
    const [name, nS] = prefer('스킬 이름', a && a.name, 'DD', b && b.name, 'CD');
    const [cool, cS] = prefer('재사용 대기시간', cleanArr(b && b.cooldownCoefficients, maxrank), 'CD', cleanArr(a && a.cooldown, maxrank), 'DD');
    const [cost, coS] = prefer('소모값', cleanArr(b && b.costCoefficients, maxrank), 'CD', cleanArr(a && a.cost, maxrank), 'DD');
    const [range, rS] = prefer('사거리', cleanArr(b && b.range, maxrank), 'CD', cleanArr(a && a.range, maxrank), 'DD');
    const [desc, dS] = prefer('스킬 설명', strip(a && a.description), 'DD', strip(b && (b.description || b.dynamicDescription)), 'CD');
    const costText = a ? String(a.costType || '') + String(a.resource || '') : '';
    const manaCost = isMana && a && /마나|mana|cost/i.test(costText) && !/체력|기력|분노|없음/.test(costText) ? cost : null;
    const icons = [a && a.image && U.ddImg(ver, 'spell', a.image.full), U.cdAsset(p, b && b.abilityIconPath)].filter(Boolean);
    return { key: K, name, cooldown: cool, cost, manaCost, range, desc, maxrank, icons, src: { name: nS, cooldown: cS, cost: coS, range: rS, desc: dS } };
  }).filter(s => s && s.name);
  const pa = dd && dd.passive, pb = cd && cd.passive;
  let passive = null;
  if (pa || pb) {
    const [name, nS] = prefer('패시브 이름', pa && pa.name, 'DD', pb && pb.name, 'CD');
    const [desc] = prefer('패시브 설명', strip(pa && pa.description), 'DD', strip(pb && pb.description), 'CD');
    const icons = [pa && pa.image && U.ddImg(ver, 'passive', pa.image.full), U.cdAsset(p, pb && pb.abilityIconPath)].filter(Boolean);
    if (name) passive = { key: 'P', name, desc, icons, src: { name: nS } };
  }
  const skins = new Map();
  for (const s of (dd && dd.skins) || []) skins.set(+s.id, { id: +s.id, num: s.num, base: s.num === 0, name: (s.num === 0 || s.name === 'default') ? c.name : s.name, src: 'DD', imgs: [U.ddLoading(c.id, s.num)] });
  for (const s of (cd && cd.skins) || []) {
    const id = +s.id; let m = skins.get(id);
    if (!m) { m = { id, num: id % 1000, base: !!s.isBase, name: s.isBase ? c.name : s.name, src: 'CD', imgs: [] }; skins.set(id, m); if (dd) bump('CD', '스킨'); }
    const img = U.cdAsset(p, s.loadScreenPath || s.tilePath || s.splashPath); if (img) m.imgs.push(img);
    if (s.rarity) m.rarity = RARITY[s.rarity] || null;
    m.legacy = !!s.isLegacy;
  }
  const damageType = cd && cd.tacticalInfo ? DMG[cd.tacticalInfo.damageType] || null : null;
  return { key: c.key, champ: c, lore, loreSrc, spells, passive, skins: [...skins.values()].filter(s => s.name), damageType };
}
async function loadDetail(c) {
  const k = c.key;
  if (S.details.has(k)) return S.details.get(k);
  if (S.pending.has(k)) return S.pending.get(k);
  const ver = S.dd, p = S.cdPath;
  const job = (async () => {
    const [a, b] = await Promise.allSettled([
      c.ddOk ? getJSON(U.ddDetail(ver, c.id)) : Promise.reject(new Error('no dd')),
      c.cdOk ? getJSON(U.cdDetail(p, k)) : Promise.reject(new Error('no cd')),
    ]);
    const dd = a.status === 'fulfilled' && a.value.data ? a.value.data[c.id] : null;
    const cd = okv(b);
    if (!dd && !cd) { S.detailFail++; throw new Error('detail load failed: ' + c.id); }
    if (ver !== S.dd) throw new Error('stale');
    const d = mergeDetail(c, dd, cd, ver, p);
    S.details.set(k, d); S.detailFail = 0;
    return d;
  })();
  S.pending.set(k, job);
  try { return await job; } finally { S.pending.delete(k); }
}
function prefetch(n = CFG.PREFETCH) {
  const pool = S.champs.filter(c => !S.details.has(c.key) && !S.pending.has(c.key));
  shuffle(pool).slice(0, n).forEach(c => loadDetail(c).catch(() => {}));
}
const detailBroken = () => S.detailFail >= 3 && S.details.size === 0;


/* =====================================================================
 *  실제 게임 데이터 (CommunityDragon game/data/characters/{alias}/{alias}.bin.json)
 *  Data Dragon의 스킬 수치는 갱신이 늦거나 틀린 경우가 있어서,
 *  쿨타임·마나·사거리는 게임 파일 값을 1순위로 씁니다.
 *  배열 규칙: cooldownTime·castRange는 [1]부터, mana는 [0]부터가 스킬 1레벨
 * ===================================================================== */
function parseGameBin(bin) {
  if (!bin || typeof bin !== 'object') return null;
  const entries = Object.entries(bin);
  const rootE = entries.find(([k]) => /\/CharacterRecords\/Root$/i.test(k));
  const rec = rootE ? rootE[1] : (entries.find(([, v]) => v && Array.isArray(v.spellNames)) || [])[1];
  if (!rec || !Array.isArray(rec.spellNames)) return null;
  const byScript = new Map(), byTail = new Map();
  for (const [k, v] of entries) if (v && v.mSpell) { if (v.mScriptName) byScript.set(v.mScriptName, v.mSpell); byTail.set(k.split('/').pop(), v.mSpell); }
  const spells = rec.spellNames.slice(0, 4).map((nm, i) => {
    const sp = byScript.get(nm) || byTail.get(nm) || byTail.get(String(nm).split('/').pop());
    if (!sp) return null;
    const arr = x => Array.isArray(x) ? x.map(Number) : null;
    return { key: SLOTS[i], cd: arr(sp.cooldownTime), mana: arr(sp.mana), range: arr(sp.castRange),
      ammo: !!(sp.mMaxAmmo > 1 || Array.isArray(sp.mAmmoRechargeTime) || sp.mAmmoRechargeTime > 0), raw: sp };
  });
  return { spells };
}

/* ---- 스킬 피해 계산식 (게임 데이터 DataValues + mSpellCalculations) ----
 * mValues[0]은 쓰이지 않고 [1]이 스킬 1레벨 값이에요 (쿨타임 배열과 같은 규칙).
 * 아래 능력치 번호 해석은 공개된 bin 파일 관례를 따른 것이라, 모르는 번호가 나오면 그 계산식은 통째로 버리고 문제를 만들지 않아요. */
const STAT_AP = 0, STAT_AD = 2;                       // mStat 생략/0 = 주문력, 2 = 공격력
const FORM_TOTAL = 0, FORM_BASE = 1, FORM_BONUS = 2;  // mStatFormula 생략/0 = 합계, 1 = 기본, 2 = 추가
function statKind(part) {
  const st = part.mStat == null ? STAT_AP : part.mStat, f = part.mStatFormula == null ? FORM_TOTAL : part.mStatFormula;
  if (st === STAT_AP && f === FORM_TOTAL) return 'ap';
  if (st === STAT_AD) return f === FORM_BONUS ? 'bad' : f === FORM_BASE ? 'bsad' : f === FORM_TOTAL ? 'ad' : null;
  return null;
}
/** 계산식을 { flat, r: {ap, ad, bad, bsad} } 형태(1차식)로 평가. 해석 못 하면 null */
function evalCalc(calc, dv, rank, all, depth = 0) {
  if (!calc || depth > 6) return null;
  const add = (a, b, k = 1) => { if (!a || !b) return null; const r = { ...a.r }; for (const x in b.r) r[x] = (r[x] || 0) + b.r[x] * k; return { flat: a.flat + b.flat * k, r }; };
  const scale = (a, k) => { if (!a) return null; const r = {}; for (const x in a.r) r[x] = a.r[x] * k; return { flat: a.flat * k, r }; };
  const isConst = a => a && !Object.keys(a.r).length;
  const dval = n => { const v = dv[n]; return Array.isArray(v) && typeof v[rank] === 'number' ? v[rank] : null; };
  const part = pt => {
    if (!pt || typeof pt !== 'object') return null;
    const t = String(pt.__type || '');
    if (/^NumberCalculationPart$/.test(t)) return typeof pt.mNumber === 'number' ? { flat: pt.mNumber, r: {} } : null;
    if (/^NamedDataValueCalculationPart$/.test(t)) { const v = dval(pt.mDataValue); return v == null ? null : { flat: v, r: {} }; }
    if (/^StatByCoefficientCalculationPart$/.test(t)) { const k = statKind(pt); return k && typeof pt.mCoefficient === 'number' ? { flat: 0, r: { [k]: pt.mCoefficient } } : null; }
    if (/^StatByNamedDataValueCalculationPart$/.test(t)) { const k = statKind(pt), v = dval(pt.mDataValue); return k && v != null ? { flat: 0, r: { [k]: v } } : null; }
    if (/^SumOfSubPartsCalculationPart$/.test(t)) { let a = { flat: 0, r: {} }; for (const x of pt.mSubparts || []) a = add(a, part(x)); return a; }
    if (/^ProductOfSubPartsCalculationPart$/.test(t)) {
      const a = part(pt.mPart1), b = part(pt.mPart2); if (!a || !b) return null;
      if (isConst(a)) return scale(b, a.flat); if (isConst(b)) return scale(a, b.flat); return null;
    }
    return null;
  };
  const t = String(calc.__type || '');
  if (/^GameCalculationModified$/.test(t)) {
    const base = all && all[calc.mModifiedGameCalculation]; const m = part(calc.mMultiplier);
    const b = evalCalc(base, dv, rank, all, depth + 1); return b && isConst(m) ? scale(b, m.flat) : null;
  }
  if (calc.mDisplayAsPercent) return null;
  let acc = { flat: 0, r: {} };
  for (const x of calc.mFormulaParts || []) acc = add(acc, part(x)); if (!acc) return null;
  if (calc.mMultiplier) { const m = part(calc.mMultiplier); if (!isConst(m)) return null; acc = scale(acc, m.flat); }
  return acc;
}
const DMG_NAME = /damage|dmg/i, DMG_SKIP = /heal|shield|mana|cooldown|reduc|percent|pct|ratio|max.?health|current.?health|missing|\bcap\b|monster|minion.*bonus|tooltip/i;
/** 스킬 하나의 피해 항목 목록: [{ name, ranks: [{flat, r}, ...] }] */
function buildDamage(sp, maxrank) {
  if (!sp) return null;
  const dvArr = sp.DataValues || sp.mDataValues, calcs = sp.mSpellCalculations;
  if (!Array.isArray(dvArr) || !calcs || typeof calcs !== 'object') return null;
  const dv = {}; for (const x of dvArr) if (x && x.mName && Array.isArray(x.mValues)) dv[x.mName] = x.mValues.map(Number);
  const hits = [];
  for (const [name, calc] of Object.entries(calcs)) {
    if (!DMG_NAME.test(name) || DMG_SKIP.test(name)) continue;
    const ranks = [];
    for (let r = 1; r <= maxrank; r++) { const v = evalCalc(calc, dv, r, calcs); if (!v) break; ranks.push(v); }
    if (ranks.length === maxrank && ranks.every(v => v.flat > 0 || Object.keys(v.r).length)) hits.push({ name, ranks });
  }
  return hits.length ? hits : null;
}
async function applyGame(d) {
  if (!d || d.gameTried) return d;
  if (d.gameJob) return d.gameJob;
  const c = d.champ, p = S.cdPath, ver = S.dd, alias = String(c.alias || c.id || '').toLowerCase();
  d.gameJob = (async () => {
    try {
      const g = parseGameBin(await getJSON(U.cdGameBin(p, alias), { timeout: 20000 }));
      if (g && ver === S.dd) {
        d.game = true;
        const isMana = /마나|mana/i.test(c.partype || '');
        for (const gs of g.spells) {
          if (!gs) continue;
          const s = d.spells.find(x => x.key === gs.key); if (!s) continue;
          const m = s.maxrank;
          s.ammo = gs.ammo;
          s.dmg = buildDamage(gs.raw, m);
          s.dmgSrc = s.dmg ? 'CDG' : null;
          const cd = gs.cd && gs.cd.length > m ? gs.cd.slice(1, m + 1) : null;
          if (cd && cd.some(x => x > 0)) {
            if (s.cooldown && JSON.stringify(s.cooldown) !== JSON.stringify(cd)) { s.cooldownWas = { v: s.cooldown, src: s.src.cooldown }; bump('CDG', '스킬 쿨타임'); }
            s.cooldown = cd; s.src.cooldown = 'CDG';
          }
          const mana = gs.mana && gs.mana.length >= m ? gs.mana.slice(0, m) : null;
          if (isMana && mana && mana.some(x => x > 0)) {
            if (s.manaCost && JSON.stringify(s.manaCost) !== JSON.stringify(mana)) bump('CDG', '마나 소모량');
            s.manaCost = mana; s.cost = mana; s.src.cost = 'CDG';
          }
          const rg = gs.range && gs.range.length > m ? gs.range.slice(1, m + 1) : null;
          if (rg && rg[0] > 0) {
            if (s.range && JSON.stringify(s.range) !== JSON.stringify(rg)) bump('CDG', '스킬 사거리');
            s.range = rg; s.src.range = 'CDG';
          }
        }
      }
    } catch (e) { /* 게임 데이터를 못 받으면 CD 챔피언 JSON → DD 순서로 남은 값 사용 */ }
    d.gameTried = true;
    if (ver === S.dd) recordSpellSnapshot(d);
    return d;
  })();
  return d.gameJob;
}

/* =====================================================================
 *  아이템 · 소환사 주문 · 룬 (DD + CD 병합)
 * ===================================================================== */
function parseItemDesc(desc) {
  const stats = [];
  const m = /<stats>([\s\S]*?)<\/stats>/i.exec(desc || '');
  if (m) for (const line of m[1].split(/<br\s*\/?>/i)) {
    const t = strip(line); const r = /^([+-]?\d+(?:\.\d+)?)\s*(%?)\s*(.+)$/.exec(t);
    if (r) stats.push({ label: r[3].trim(), value: +r[1], pct: !!r[2] });
  }
  const clean = x => strip(x).replace(/[:：\-–—]+$/, '').trim();
  const passives = [...(desc || '').matchAll(/<passive>([\s\S]*?)<\/passive>/gi)].map(x => clean(x[1])).filter(x => x.length >= 2 && x.length <= 24);
  const actives = [...(desc || '').matchAll(/<active>([\s\S]*?)<\/active>/gi)].map(x => clean(x[1])).filter(x => x.length >= 2 && x.length <= 24);
  return { stats, passives, actives };
}
function mergeItems(dd, cd, ver, p) {
  const by = new Map(); const ddD = dd && dd.data ? dd.data : null;
  if (ddD) for (const [ids, it] of Object.entries(ddD)) {
    const id = +ids, g = it.gold || {};
    by.set(id, {
      id, name: it.name, desc: it.description || '', plain: it.plaintext || '', total: g.total, base: g.base, sell: g.sell,
      purch: g.purchasable !== false, from: (it.from || []).map(Number), into: (it.into || []).map(Number), tags: it.tags || [],
      sr: it.maps ? !!it.maps['11'] : true, inStore: it.inStore !== false && !it.hideFromAll,
      req: it.requiredChampion || it.requiredAlly || null, statsObj: it.stats || {},
      icons: it.image ? [U.ddImg(ver, 'item', it.image.full)] : [], src: { name: 'DD', total: 'DD', from: 'DD', desc: 'DD' },
    });
  }
  for (const it of (Array.isArray(cd) ? cd : [])) {
    const id = +it.id; let m = by.get(id);
    if (!m) {
      if (ddD) continue; // DD가 있으면 CD 전용 항목(다른 모드)은 제외
      m = { id, name: null, desc: '', plain: '', from: [], into: [], tags: [], sr: true, purch: true, inStore: true, statsObj: {}, icons: [], src: {} };
      by.set(id, m);
    }
    const f = (field, val, label) => { if (isEmpty(m[field]) && !isEmpty(val)) { m[field] = val; m.src[field] = 'CD'; if (ddD) bump('CD', label); } };
    f('name', it.name, '아이템 이름'); f('total', it.priceTotal, '아이템 가격'); f('base', it.price, '조합 비용'); f('desc', it.description, '아이템 설명');
    if (isEmpty(m.from) && Array.isArray(it.from) && it.from.length) { m.from = it.from.map(Number); m.src.from = 'CD'; if (ddD) bump('CD', '하위 아이템'); }
    if (isEmpty(m.into) && Array.isArray(it.to) && it.to.length) { m.into = it.to.map(Number); if (ddD) bump('CD', '상위 아이템'); }
    if (!m.req && (it.requiredChampion || it.requiredAlly)) m.req = it.requiredChampion || it.requiredAlly;
    if (it.inStore === false) m.inStore = false;
    const ic = U.cdAsset(p, it.iconPath); if (ic) m.icons.push(ic);
  }
  for (const m of by.values()) { m.name = strip(m.name); Object.assign(m, parseItemDesc(m.desc)); }
  const ok = m => m.name && m.sr && m.purch && m.inStore && !m.req && m.total > 0 && m.id < 100000;
  const seen = new Set(), list = [];
  for (const m of [...by.values()].sort((a, b) => a.id - b.id)) { if (!ok(m) || seen.has(m.name)) continue; seen.add(m.name); list.push(m); }
  const sr = new Set(list.map(x => x.id));
  for (const m of list) {
    m.fromSR = [...new Set(m.from.filter(i => sr.has(i)))];
    m.intoSR = [...new Set(m.into.filter(i => sr.has(i)))];
    m.kind = (m.tags.includes('Consumable') || m.tags.includes('Trinket')) ? 'consumable'
      : m.tags.includes('Boots') ? 'boots'
      : !m.from.length ? 'basic'
      : m.intoSR.length ? 'epic'
      : m.total >= 2000 ? 'legendary' : 'other';
  }
  // 골드 효율 기준값 (전부 데이터에서 계산)
  // 1) 능력치가 하나뿐인 기본 아이템 → 능력치 1당 가격
  // 2) 고유 효과가 없고 모르는 능력치가 하나뿐인 아이템 → 남은 가격으로 그 능력치 1당 가격 역산 (예: 스킬 가속)
  const goldPer = {};
  for (const m of list) {
    if (m.kind !== 'basic' || m.stats.length !== 1) continue;
    const st = m.stats[0]; if (!(st.value > 0)) continue;
    const per = m.total / st.value;
    if (!goldPer[st.label] || per < goldPer[st.label].per) goldPer[st.label] = { per, item: m.name, label: st.label, how: 'basic' };
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const m of list) {
      if (m.passives.length || m.actives.length || !m.stats.length || m.kind === 'consumable') continue;
      const unk = m.stats.filter(st => !goldPer[st.label]);
      if (unk.length !== 1 || !(unk[0].value > 0)) continue;
      const known = m.stats.filter(st => goldPer[st.label]).reduce((a, st) => a + st.value * goldPer[st.label].per, 0);
      const per = (m.total - known) / unk[0].value;
      if (per > 0) goldPer[unk[0].label] = { per, item: m.name, label: unk[0].label, how: 'derived' };
    }
  }
  const refNames = new Set(Object.values(goldPer).map(g => g.item));
  for (const m of list) {
    m.eff = null; m.isRef = refNames.has(m.name);
    if (m.stats.length && m.stats.every(st => goldPer[st.label])) {
      m.statValue = m.stats.reduce((a, st) => a + st.value * goldPer[st.label].per, 0);
      m.eff = m.statValue / m.total;
    }
  }
  const byName = new Map(list.map(x => [x.name, x]));
  return { byId: by, list, goldPer, byName };
}
/** 설명 글에서 충전식 주문 정보(최대 횟수, 충전 시간)를 읽는다. 못 읽은 값은 null */
function parseCharge(desc) {
  const t = String(desc || ''); if (!/충전/.test(t)) return null;
  const mx = /(?:최대\s*)?(\d+)\s*(?:회|번|개)(?:까지|의)?[^.。]{0,12}충전|충전[^.。]{0,12}?(?:최대\s*)?(\d+)\s*(?:회|번|개)/.exec(t);
  const rc = /(\d+(?:\.\d+)?)\s*초[^.。]{0,10}(?:마다|걸려|후에?)[^.。]{0,10}충전|충전[^.。]{0,25}?(\d+(?:\.\d+)?)\s*초/.exec(t);
  return { max: mx ? +(mx[1] || mx[2]) : null, rech: rc ? +(rc[1] || rc[2]) : null };
}
function mergeSumm(dd, cd, ver, p) {
  const by = new Map();
  if (dd && dd.data) for (const s of Object.values(dd.data)) {
    by.set(+s.key, { id: +s.key, name: s.name, desc: strip(s.description), cd: Array.isArray(s.cooldown) ? +s.cooldown[0] : null,
      modes: s.modes || [], icons: s.image ? [U.ddImg(ver, 'spell', s.image.full)] : [], src: { name: 'DD', cd: 'DD' } });
  }
  for (const s of (Array.isArray(cd) ? cd : [])) {
    let m = by.get(+s.id);
    if (!m) { m = { id: +s.id, modes: [], icons: [], src: {} }; by.set(m.id, m); }
    if (isEmpty(m.name) && s.name) { m.name = s.name; m.src.name = 'CD'; if (dd) bump('CD', '소환사 주문 이름'); }
    if (isEmpty(m.desc) && s.description) { m.desc = strip(s.description); if (dd) bump('CD', '소환사 주문 설명'); }
    if (+s.cooldown > 0 && m.cd !== +s.cooldown) { if (m.cd > 0) bump('CD', '소환사 주문 쿨타임(DD와 다름)'); else if (dd) bump('CD', '소환사 주문 쿨타임'); m.cd = +s.cooldown; m.src.cd = 'CD'; }
    if (!m.modes.length && Array.isArray(s.gameModes)) m.modes = s.gameModes;
    const ic = U.cdAsset(p, s.iconPath); if (ic) m.icons.push(ic);
  }
  for (const m of by.values()) m.charge = parseCharge(m.desc);
  return [...by.values()].filter(s => s.name && s.cd > 0 && s.modes.includes('CLASSIC'));
}
function mergeRunes(dd, perks, styles, ver, p) {
  const perkBy = new Map((Array.isArray(perks) ? perks : []).map(x => [+x.id, x]));
  const trees = [], runes = [];
  if (Array.isArray(dd) && dd.length) {
    for (const t of dd) {
      const tree = { id: t.id, name: t.name, slots: [] }; trees.push(tree);
      (t.slots || []).forEach((sl, si) => {
        const ids = [];
        for (const r of sl.runes || []) {
          const cp = perkBy.get(+r.id);
          const [name] = prefer('룬 이름', r.name, 'DD', cp && cp.name, 'CD');
          const [desc, dS] = prefer('룬 설명', strip(r.shortDesc), 'DD', strip(cp && cp.shortDesc), 'CD');
          if (!name) continue;
          runes.push({ id: +r.id, name, tree: tree.id, treeName: t.name, slot: si, keystone: si === 0, desc,
            icons: [r.icon && U.ddRuneIcon(r.icon), cp && U.cdAsset(p, cp.iconPath)].filter(Boolean), src: { name: 'DD', desc: dS } });
          ids.push(+r.id);
        }
        tree.slots.push(ids);
      });
    }
  } else if (styles && Array.isArray(styles.styles)) {
    for (const t of styles.styles) {
      const tree = { id: t.id, name: t.name, slots: [] }; trees.push(tree); bump('CD', '룬 빌드');
      (t.slots || []).filter(sl => sl.type !== 'kStatMod').forEach((sl, si) => {
        const ids = [];
        for (const id of sl.perks || []) {
          const cp = perkBy.get(+id); if (!cp || !cp.name) continue;
          runes.push({ id: +id, name: cp.name, tree: t.id, treeName: t.name, slot: si, keystone: sl.type === 'kKeyStone', desc: strip(cp.shortDesc),
            icons: [U.cdAsset(p, cp.iconPath)].filter(Boolean), src: { name: 'CD', desc: 'CD' } });
          ids.push(+id);
        }
        tree.slots.push(ids);
      });
    }
  }
  return { trees: trees.filter(t => t.slots.length), runes, byId: new Map(runes.map(r => [r.id, r])) };
}
const EXTRA = {
  async items(ver, p) {
    const [a, b] = await Promise.allSettled([getJSON(U.ddData(ver, 'item.json')), getJSON(U.cdData(p, 'items.json'))]);
    if (!okv(a) && !okv(b)) throw new Error('아이템 데이터 없음');
    return mergeItems(okv(a), okv(b), ver, p);
  },
  async summ(ver, p) {
    const [a, b] = await Promise.allSettled([getJSON(U.ddData(ver, 'summoner.json')), getJSON(U.cdData(p, 'summoner-spells.json'))]);
    if (!okv(a) && !okv(b)) throw new Error('소환사 주문 데이터 없음');
    return mergeSumm(okv(a), okv(b), ver, p);
  },
  async runes(ver, p) {
    const [a, b, c] = await Promise.allSettled([getJSON(U.ddData(ver, 'runesReforged.json')), getJSON(U.cdData(p, 'perks.json')), getJSON(U.cdData(p, 'perkstyles.json'))]);
    if (!okv(a) && !okv(c)) throw new Error('룬 데이터 없음');
    return mergeRunes(okv(a), okv(b), okv(c), ver, p);
  },
};
function ensure(kind) {
  if (S.data[kind]) return Promise.resolve(S.data[kind]);
  if (S.extra[kind]) return S.extra[kind];
  const ver = S.dd, p = S.cdPath;
  const job = EXTRA[kind](ver, p).then(r => {
    if (ver !== S.dd) throw new Error('stale');
    S.data[kind] = r; S.needFail[kind] = 0;
    try { afterExtra(kind, r); } catch (e) { console.warn(e); }
    return r;
  }, e => { S.needFail[kind] = (S.needFail[kind] || 0) + 1; throw e; })
    .finally(() => { if (S.extra[kind] === job) S.extra[kind] = null; });
  S.extra[kind] = job;
  return job;
}

/* =====================================================================
 *  패치 변경 감지 (스냅샷 비교) — 챔피언 스탯 · 스킬 · 아이템 · 소환사 주문
 * ===================================================================== */
const STATS = {
  hp: '기본 체력', hpperlevel: '레벨당 체력', mp: '기본 마나', armor: '기본 방어력', armorperlevel: '레벨당 방어력',
  spellblock: '기본 마법 저항력', movespeed: '기본 이동 속도', attackrange: '기본 공격 사거리', attackdamage: '기본 공격력',
  attackdamageperlevel: '레벨당 공격력', attackspeed: '기본 공격 속도', attackspeedperlevel: '레벨당 공격 속도(%)', hpregen: '기본 체력 재생',
};
function statsHash(champs) { return hash(JSON.stringify(champs.map(c => [c.key, c.name, c.title, c.stats && Object.keys(STATS).map(k => c.stats[k])]))); }
function makeSnap(ver, h, champs) {
  const stats = {};
  for (const c of champs) if (c.stats) { stats[c.key] = {}; for (const k in STATS) stats[c.key][k] = c.stats[k]; }
  return { version: ver, hash: h, stats, names: champs.map(c => c.key) };
}
function diffSnap(prev, champs) {
  const out = [];
  for (const c of champs) {
    const o = prev.stats[c.key];
    if (!o) { if (prev.names && !prev.names.includes(c.key)) out.push({ key: c.key, name: c.name, field: 'new', label: '신규 챔피언', old: null, new: c.name }); continue; }
    if (!c.stats) continue;
    for (const k in STATS) {
      const a = o[k], b = c.stats[k];
      if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 1e-9) out.push({ key: c.key, name: c.name, field: 'stats.' + k, label: STATS[k], old: a, new: b });
    }
  }
  return out;
}
function addChanges(fromVer, toVer, list) {
  if (!list.length) return;
  let D = store.get('lastDiff', null);
  if (!D || D.to !== toVer) D = { from: fromVer, to: toVer, changes: [], at: Date.now() };
  for (const ch of list) {
    const i = D.changes.findIndex(x => x.key === ch.key && x.field === ch.field);
    if (i >= 0) D.changes[i] = ch; else D.changes.push(ch);
  }
  store.set('lastDiff', D);
}
function recordSpellSnapshot(d) {
  const snap = store.get('spellSnap', {});
  const cur = { v: S.dd, g: !!d.game, s: {} };
  for (const s of d.spells) cur.s[s.key] = { n: s.name, cd: s.cooldown, mc: s.manaCost };
  const old = snap[d.key];
  if (old && old.v !== S.dd && !!old.g === cur.g) {
    const ch = [], nm = d.champ.name;
    for (const K of SLOTS) {
      const a = old.s[K], b = cur.s[K]; if (!a || !b) continue;
      if (a.cd && b.cd && JSON.stringify(a.cd) !== JSON.stringify(b.cd)) ch.push({ key: d.key, name: nm, field: `spell.${K}.cd`, label: `${K} 「${b.n}」 재사용 대기시간`, old: a.cd, new: b.cd });
      if (a.mc && b.mc && JSON.stringify(a.mc) !== JSON.stringify(b.mc)) ch.push({ key: d.key, name: nm, field: `spell.${K}.mc`, label: `${K} 「${b.n}」 마나 소모량`, old: a.mc, new: b.mc });
      if (a.n !== b.n) ch.push({ key: d.key, name: nm, field: `spell.${K}.name`, label: `${K} 스킬 이름`, old: a.n, new: b.n });
    }
    addChanges(old.v, S.dd, ch);
  }
  snap[d.key] = cur; store.set('spellSnap', snap);
}
function afterExtra(kind, r) {
  if (kind === 'items') {
    const snap = store.get('itemSnap', null), cur = { v: S.dd, d: {} };
    for (const m of r.list) { cur.d[m.id] = { n: m.name, t: m.total, s: Object.fromEntries(m.stats.map(s => [s.label, s.value])) }; }
    if (snap && snap.v !== S.dd) {
      const ch = [];
      for (const m of r.list) {
        const o = snap.d[m.id]; if (!o) continue;
        if (typeof o.t === 'number' && o.t !== m.total) ch.push({ key: 'i' + m.id, name: m.name, field: 'item.total', label: '가격', old: o.t, new: m.total, unit: '골드' });
        for (const s of m.stats) if (typeof o.s[s.label] === 'number' && o.s[s.label] !== s.value)
          ch.push({ key: 'i' + m.id, name: m.name, field: 'item.' + s.label, label: s.label, old: o.s[s.label], new: s.value, unit: s.pct ? '%' : '' });
      }
      addChanges(snap.v, S.dd, ch);
    }
    store.set('itemSnap', cur);
  }
  if (kind === 'summ') {
    const snap = store.get('summSnap', null), cur = { v: S.dd, d: {} };
    for (const s of r) cur.d[s.id] = s.cd;
    if (snap && snap.v !== S.dd) addChanges(snap.v, S.dd, r.filter(s => typeof snap.d[s.id] === 'number' && snap.d[s.id] !== s.cd)
      .map(s => ({ key: 's' + s.id, name: s.name, field: 'summ.cd', label: '재사용 대기시간', old: snap.d[s.id], new: s.cd, unit: '초' })));
    store.set('summSnap', cur);
  }
}

/* =====================================================================
 *  전체 로드 & 자동 갱신
 * ===================================================================== */
const hooks = { onLoaded: () => {}, onUpdated: async () => {}, onState: () => {} };
function toast(msg) {
  const t = typeof document !== 'undefined' && $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 4200);
}
async function loadAll(v, { reason }) {
  if (S.loading) return;
  S.loading = true; hooks.onState('busy');
  try {
    S.fill = newFill();
    const ddr = await fetchDdSummary(v);
    const ver = ddr.ver, dd = ddr.data;
    const cd = await fetchCdSummary(ver, v.cdLatest);
    if (!dd && !cd.data) throw new Error('두 데이터 소스 모두 불러오지 못했습니다');
    const prevVer = S.dd;
    const champs = mergeSummary(dd, cd.data);
    if (!champs.length) throw new Error('챔피언 데이터가 비어 있습니다');
    const h = statsHash(champs);
    const prevSnap = store.get('snapshot', null);
    let changed = 0;
    if (dd && prevSnap && prevSnap.hash !== h) {
      const diff = diffSnap(prevSnap, champs);
      if (diff.length) {
        const D = store.get('lastDiff', null);
        if (!D || D.to !== ver) store.set('lastDiff', { from: prevSnap.version, to: ver, changes: diff, at: Date.now() });
        else addChanges(prevSnap.version, ver, diff);
      }
      changed = diff.length;
    }
    if (dd) store.set('snapshot', makeSnap(ver, h, champs));
    const oldDetailKeys = [...S.details.keys()];
    const hashChanged = S.hash && S.hash !== h;
    S.dd = ver; S.latest = v.latest || S.latest; S.cdPath = cd.p; S.cdVersion = v.cdLatest;
    S.champs = champs; S.byKey = new Map(champs.map(c => [c.key, c]));
    S.details = new Map(); S.pending = new Map(); S.data = {}; S.extra = {}; S.needFail = {}; S.hash = h;
    S.ready = true; S.fail = 0; S.loadErr = null; S.detailFail = 0;
    if (!dd) toast('Data Dragon 접속 실패 — CommunityDragon 데이터만으로 출제합니다');
    else if (!cd.data) toast('CommunityDragon 접속 실패 — Data Dragon 데이터만으로 출제합니다');
    // 아이템·소환사 주문·룬은 백그라운드로 받아 두고 변경 비교
    ['items', 'summ', 'runes'].forEach(k => ensure(k).catch(() => {}));
    if (reason === 'update') {
      if (hashChanged || prevVer !== ver) toast(`🔄 ${ver} 데이터 적용${changed ? ` · 챔피언 수치 변경 ${changed}건` : ''} — 문제가 새 수치로 자동 갱신됩니다`);
      else toast('데이터를 다시 불러왔어요');
      oldDetailKeys.slice(0, 12).forEach(k => { const c = S.byKey.get(k); if (c) loadDetail(c).catch(() => {}); });
      await hooks.onUpdated();
    } else if (changed) toast(`지난 방문 이후 패치(${prevSnap.version} → ${ver})로 챔피언 수치 ${changed}건이 바뀌었어요`);
    prefetch();
    hooks.onState('ok');
  } catch (e) {
    console.error(e); S.loadErr = e.message || String(e); hooks.onState('err'); throw e;
  } finally { S.loading = false; hooks.onLoaded(); }
}
function schedule() {
  clearTimeout(S.timer);
  const ms = settings.pollMin * 60000 * Math.min(4, 2 ** S.fail);
  S.nextCheck = Date.now() + ms;
  S.timer = setTimeout(() => checkForUpdate(), ms);
  hooks.onLoaded();
}
async function checkForUpdate(mode = '') {
  if (S.loading) return;
  hooks.onState('busy');
  try {
    const v = await resolveVersions();
    S.lastCheck = Date.now(); S.latest = v.latest || S.latest;
    const cdHotfix = S.cdPath === 'latest' && v.cdLatest && S.cdVersion && v.cdLatest !== S.cdVersion;
    if (mode === 'force' || !S.ready || v.dd !== S.dd || cdHotfix) await loadAll(v, { reason: S.ready ? 'update' : 'init' });
    else {
      hooks.onState('ok');
      if (!settings.followLatest && v.latest && v.latest !== S.dd) toast(`새 패치 ${J(v.latest, '이')} 있어요. 설정에서 '최신 패치 자동 추적'을 켜면 적용됩니다.`);
      else if (mode === 'manual') toast(`이미 최신 데이터입니다 (${S.dd})`);
    }
    S.fail = 0;
  } catch (e) {
    S.fail++; hooks.onState('err');
    if (mode) toast('업데이트 확인 실패 — 네트워크를 확인해 주세요');
  } finally { schedule(); }
}
