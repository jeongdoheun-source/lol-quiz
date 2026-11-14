'use strict';
/* =====================================================================
 *  questions.js — 템플릿 기반 문제 생성기 (AI 미사용)
 *  · 문제는 저장하지 않고 매번 '지금 메모리에 있는 JSON'으로 즉석 생성
 *  · 각 문제는 sig()로 자신이 쓴 값을 기억 → 패치로 값이 바뀌면 재출제
 *  · 수치는 전부 DD/CD에서 읽고, 공식(레벨 성장, 스킬 가속, 방어력)만 코드에 둡니다
 * ===================================================================== */
const TIER = {
  1: { name: '입문', range: '아이언~실버', cls: 't1', pts: 1 },
  2: { name: '중급', range: '골드~에메랄드', cls: 't2', pts: 2 },
  3: { name: '상급', range: '다이아~마스터', cls: 't3', pts: 3 },
  4: { name: '최상급', range: '그랜드마스터~챌린저', cls: 't4', pts: 5 },
};
const CATS = {
  champ: '챔피언 기본기', skill: '스킬·쿨타임', item: '아이템', summ: '소환사 주문', rune: '룬', patch: '패치 변경', fun: '덕력(얼굴·스킨·스토리)',
};
const FORMULA = {
  growth: '성장 공식: 기본 + 성장치 × (레벨−1) × (0.7025 + 0.0175 × (레벨−1))',
  haste: '스킬 가속 공식: 기본 쿨타임 × 100 ÷ (100 + 스킬 가속)',
  armor: '피해 감소 공식: 받는 피해 = 100 ÷ (100 + 방어력)',
};
const growthMul = n => (n - 1) * (0.7025 + 0.0175 * (n - 1));
const lvlStat = (c, k, n) => c.stats[k] + (c.stats[k + 'perlevel'] || 0) * growthMul(n);

/* ---------- 서명(sig): 문제가 의존하는 현재 값 ---------- */
const getPath = (o, path) => path.split('.').reduce((x, k) => x == null ? x : x[k], o);
const sigC = (k, path) => { const c = S.byKey.get(k); return JSON.stringify(c ? getPath(c, path) : '∅'); };
const sigS = (k, K, f) => { const d = S.details.get(k); if (!d) return '?'; const s = K === 'P' ? d.passive : d.spells.find(x => x.key === K); return JSON.stringify(s ? s[f] : null); };
const sigI = (id, f) => { const I = S.data.items; if (!I) return '?'; const m = I.byId.get(id); return JSON.stringify(m ? getPath(m, f) : null); };
const sigM = id => { const M = S.data.summ; if (!M) return '?'; const s = M.find(x => x.id === id); return JSON.stringify(s ? [s.name, s.cd] : null); };
const sigR = id => { const R = S.data.runes; if (!R) return '?'; const r = R.byId.get(id); return JSON.stringify(r ? [r.name, r.tree, r.slot] : null); };

/* ---------- 공통 빌더 ---------- */
function Q(cat, prompt, correct, wrongs, extra = {}) {
  const labels = [...new Set([correct, ...wrongs].map(String))].slice(0, extra.max || 4);
  if (labels.length < 2 || labels[0] !== String(correct)) return null;
  let opts = labels.map(l => ({ label: l, ok: l === String(correct) }));
  if (extra.order) opts = extra.order.filter(l => labels.includes(l)).map(l => ({ label: l, ok: l === String(correct) }));
  else opts = shuffle(opts);
  if (!opts.some(o => o.ok)) return null;
  const q = { cat, prompt, opts, answer: String(correct), ...extra, version: S.dd };
  try { q.sigVal = q.sig ? q.sig() : null; } catch (e) { q.sigVal = null; }
  return q;
}
const withStats = () => S.champs.filter(c => c.stats);
function champDistractors(c, n = 3, pool = S.champs) {
  const same = pool.filter(x => x.key !== c.key && c.tags && c.tags[0] && x.tags && x.tags[0] === c.tags[0]);
  const all = pool.filter(x => x.key !== c.key);
  const src = same.length >= n && Math.random() < 0.6 ? same : all;
  const out = [];
  for (const x of shuffle(src)) { if (out.length >= n) break; if (!out.some(o => o.name === x.name)) out.push(x); }
  return out.map(x => x.name);
}
function niceStep(v) { const a = Math.abs(v); if (a < 1) return 0.025; if (a < 10) return 1; if (a < 30) return 2; if (a < 100) return 5; if (a < 1000) return 25; return 50; }
function numericOptions(v, pool, { step, decimals = 3 } = {}) {
  const set = new Set([v]);
  const near = [...new Set(pool.filter(x => typeof x === 'number' && x !== v && x > 0))].sort((a, b) => Math.abs(a - v) - Math.abs(b - v)).slice(0, 6);
  for (const x of shuffle(near)) { if (set.size >= 4) break; set.add(x); }
  const st = step || niceStep(v); let k = 1;
  while (set.size < 4 && k < 40) { const c = +((v + st * (Math.random() < 0.5 ? -k : k))).toFixed(decimals); if (c > 0) set.add(c); k++; }
  return [...set].filter(x => x !== v);
}
function mask(text, names) {
  let t = text;
  const all = names.filter(Boolean).flatMap(n => [n, n.replace(/\s/g, ''), ...(n.includes(' ') ? n.split(' ').filter(w => w.length >= 2) : [])]);
  for (const n of [...new Set(all)].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(reEsc(n), 'gi'), '○○○');
  return t;
}
async function detailed(pred = () => true) {
  let list = [...S.details.values()].filter(pred);
  if (list.length < 4 || Math.random() < 0.4) {
    const pool = S.champs.filter(c => !S.details.has(c.key));
    for (let i = 0; i < 2 && pool.length; i++) { try { const d = await loadDetail(pick(pool)); if (pred(d)) { prefetch(2); return d; } } catch (e) {} }
    list = [...S.details.values()].filter(pred);
  }
  prefetch(2);
  return list.length ? pick(list) : null;
}
async function detailedMany(n, pred = () => true) {
  let list = [...S.details.values()].filter(pred);
  for (let round = 0; round < 3 && list.length < n; round++) {
    const pool = shuffle(S.champs.filter(c => !S.details.has(c.key))).slice(0, Math.max(4, n - list.length + 2));
    if (!pool.length) break;
    await Promise.allSettled(pool.map(c => loadDetail(c)));
    list = [...S.details.values()].filter(pred);
    if (detailBroken()) break;
  }
  return shuffle(list);
}
const spellOf = (d, K) => K === 'P' ? d.passive : d.spells.find(s => s.key === K);
const keyLabel = K => K === 'P' ? '패시브' : K;
const sec = x => fmt(x) + '초';
const gold = x => fmt(x) + '골드';
const pdf = (a, b) => `${a}와(과) ${b}`;

/* ---------- 생성기 등록 ---------- */
const GENS = [];
const gen = (cat, tier, w, fn, opt = {}) => GENS.push({ cat, tier, w, fn, ...opt });

/* =====================================================================
 *  챔피언 기본기
 * ===================================================================== */
gen('champ', 1, 2, async () => {
  const c = pick(withStats().filter(x => x.stats.attackrange > 0)); const v = c.stats.attackrange;
  const B = [[0, 200, '200 이하'], [201, 400, '201 ~ 400'], [401, 525, '401 ~ 525'], [526, 1e9, '526 이상']];
  const ans = B.find(b => v >= b[0] && v <= b[1])[2];
  return Q('champ', `${c.name}의 기본 공격 사거리는 어느 구간일까요?`, ans, B.map(b => b[2]).filter(x => x !== ans),
    { order: B.map(b => b[2]), explain: `${c.name} 기본 공격 사거리 ${fmt(v)} (기본 형태 기준)`, srcs: ['DD'], sig: () => sigC(c.key, 'stats.attackrange'), champ: c.key });
});
gen('champ', 1, 1, async () => {
  const freq = {}; S.champs.forEach(c => { if (c.partype) freq[c.partype] = (freq[c.partype] || 0) + 1; });
  const types = Object.keys(freq).sort((a, b) => freq[b] - freq[a]); if (types.length < 3) return null;
  const rare = S.champs.filter(c => c.partype && c.partype !== types[0]);
  const c = Math.random() < 0.6 && rare.length ? pick(rare) : pick(S.champs.filter(x => x.partype));
  return Q('champ', `${c.name}이(가) 스킬에 쓰는 자원은?`, c.partype, shuffle(types.filter(t => t !== c.partype)).slice(0, 3),
    { explain: `${c.name} — ${c.partype}`, srcs: ['DD'], sig: () => sigC(c.key, 'partype'), champ: c.key });
});
gen('champ', 1, 1, async () => {
  const tag = pick(Object.keys(TAGS));
  const has = S.champs.filter(c => c.tags && c.tags[0] === tag), not = S.champs.filter(c => c.tags && c.tags.length && !c.tags.includes(tag));
  if (!has.length || not.length < 3) return null;
  const c = pick(has), wr = shuffle(not).slice(0, 3);
  return Q('champ', `다음 중 주 역할군이 '${TAGS[tag]}'인 챔피언은?`, c.name, wr.map(x => x.name),
    { explain: [c, ...wr].map(x => `${x.name}: ${x.tags.map(t => TAGS[t] || t).join('/')}`).join(' · '), srcs: [c.src.tags], sig: () => sigC(c.key, 'tags') });
});
gen('champ', 1, 1, async () => {
  const ds = await detailedMany(4, d => spellOf(d, 'R')); if (ds.length < 4) return null;
  const d = ds[0], R = spellOf(d, 'R');
  return Q('champ', `${d.champ.name}의 궁극기(R) 이름은?`, R.name, ds.slice(1).map(x => spellOf(x, 'R').name),
    { explain: trunc(R.desc, 150), srcs: [R.src.name], sig: () => sigS(d.key, 'R', 'name'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
function pairCompare(k, label, more) {
  return async () => {
    const pool = withStats().filter(x => typeof x.stats[k] === 'number');
    const a = pick(pool); const same = pool.filter(x => x.key !== a.key && x.tags[0] === a.tags[0]);
    const b = pick(same.length ? same : pool.filter(x => x.key !== a.key));
    const va = a.stats[k], vb = b.stats[k];
    const ans = va === vb ? '같다' : (va > vb ? a.name : b.name);
    return Q('champ', `${a.name} vs ${b.name} — ${label} 비교: ${more} 쪽은?`, ans, [a.name, b.name, '같다'].filter(x => x !== ans),
      { max: 3, order: [a.name, b.name, '같다'], explain: `${a.name} ${fmt(va)} · ${b.name} ${fmt(vb)}`, srcs: ['DD'], sig: () => sigC(a.key, 'stats.' + k) + sigC(b.key, 'stats.' + k) });
  };
}
gen('champ', 2, 2, pairCompare('attackrange', '기본 공격 사거리', '더 긴'));
gen('champ', 2, 1, pairCompare('movespeed', '기본 이동 속도', '더 빠른'));
gen('champ', 2, 1, pairCompare('hp', '레벨 1 체력', '더 높은'));
gen('champ', 2, 2, async () => {
  const k = pick(['hp', 'armor', 'spellblock', 'movespeed', 'attackrange', 'attackdamage']);
  const pool = withStats().filter(c => typeof c.stats[k] === 'number');
  const chosen = [], seen = new Set();
  for (const c of shuffle(pool)) { if (chosen.length >= 4) break; if (!seen.has(c.stats[k])) { seen.add(c.stats[k]); chosen.push(c); } }
  if (chosen.length < 4) return null;
  const hi = Math.random() < 0.6, sorted = [...chosen].sort((a, b) => hi ? b.stats[k] - a.stats[k] : a.stats[k] - b.stats[k]);
  return Q('champ', `다음 중 ${STATS[k]} 수치가 가장 ${hi ? '높은' : '낮은'} 챔피언은?`, sorted[0].name, sorted.slice(1).map(x => x.name),
    { explain: sorted.map(x => `${x.name} ${fmt(x.stats[k])}`).join(' · '), srcs: ['DD'], sig: () => chosen.map(x => sigC(x.key, 'stats.' + k)).join() });
});
gen('champ', 3, 2, async () => {
  const k = pick(['hp', 'armor', 'spellblock', 'movespeed', 'attackrange', 'attackdamage', 'attackspeed', 'hpperlevel', 'armorperlevel']);
  const pool = withStats().filter(c => typeof c.stats[k] === 'number' && c.stats[k] > 0);
  const c = pick(pool), v = c.stats[k];
  return Q('champ', `${c.name}의 ${STATS[k]}은(는)?`, fmt(v), numericOptions(v, pool.map(x => x.stats[k])).map(fmt),
    { explain: `${c.name} ${STATS[k]} ${fmt(v)}`, srcs: ['DD'], sig: () => sigC(c.key, 'stats.' + k), champ: c.key });
});
gen('champ', 3, 1, async () => {
  const pool = withStats().filter(x => x.stats.attackrange >= 400);
  const a = pick(pool), b = pick(pool.filter(x => x.stats.attackrange !== a.stats.attackrange));
  const v = Math.abs(a.stats.attackrange - b.stats.attackrange);
  const diffs = []; for (let i = 0; i < 40; i++) { const dv = Math.abs(pick(pool).stats.attackrange - pick(pool).stats.attackrange); if (dv > 0) diffs.push(dv); }
  return Q('champ', `라인전 사거리 싸움: ${pdf(a.name, b.name)}의 기본 공격 사거리 차이는?`, fmt(v), numericOptions(v, diffs, { step: 25 }).map(fmt),
    { explain: `${a.name} ${fmt(a.stats.attackrange)} · ${b.name} ${fmt(b.stats.attackrange)}`, srcs: ['DD'], sig: () => sigC(a.key, 'stats.attackrange') + sigC(b.key, 'stats.attackrange') });
});
const LV_STATS = { hp: '체력', armor: '방어력', spellblock: '마법 저항력', attackdamage: '공격력' };
gen('champ', 3, 2, async () => {
  const k = pick(Object.keys(LV_STATS)), n = pick([6, 9, 11, 13, 16, 18]);
  const pool = withStats().filter(x => typeof x.stats[k] === 'number' && typeof x.stats[k + 'perlevel'] === 'number');
  const c = pick(pool), rd = k === 'hp' ? Math.round : r1;
  const v = rd(lvlStat(c, k, n));
  return Q('champ', `레벨 ${n} ${c.name}의 ${LV_STATS[k]}은(는)? (아이템·룬 제외)`, fmt(v), numericOptions(v, pool.map(x => rd(lvlStat(x, k, n))), { decimals: 1 }).map(fmt),
    { explain: `${fmt(c.stats[k])} + ${fmt(c.stats[k + 'perlevel'])} × ${fmt(r1(growthMul(n) * 1000) / 1000)} = ${fmt(v)}. ${FORMULA.growth}`, srcs: ['DD'],
      sig: () => sigC(c.key, 'stats.' + k) + sigC(c.key, 'stats.' + k + 'perlevel'), champ: c.key });
});
gen('champ', 4, 2, async () => {
  const k = pick(['hp', 'armor', 'attackdamage']), n = pick([9, 11, 13, 16, 18]);
  const pool = withStats().filter(x => typeof x.stats[k + 'perlevel'] === 'number');
  const want = Math.random() < 0.6; let P = null;
  for (let i = 0; i < 400 && !P; i++) {
    const a = pick(pool), b = pick(pool); if (a === b || a.stats[k] <= b.stats[k]) continue;
    const an = lvlStat(a, k, n), bn = lvlStat(b, k, n);
    if ((an < bn) === want && Math.abs(an - bn) > 0.5) P = [a, b, an, bn];
  }
  if (!P) return null;
  const [a, b, an, bn] = P, rd = k === 'hp' ? Math.round : r1;
  const A = `${a.name} 쪽이 높다`, B = `${b.name} 쪽이 높다`;
  return Q('champ', `레벨 1 ${LV_STATS[k]}은(는) ${a.name}(${fmt(a.stats[k])})이(가) ${b.name}(${fmt(b.stats[k])})보다 높습니다. 레벨 ${n}에서는?`, an > bn ? A : B, [an > bn ? B : A, '같다'],
    { max: 3, order: [A, B, '같다'], explain: `레벨 ${n}: ${a.name} ${fmt(rd(an))} · ${b.name} ${fmt(rd(bn))} (레벨당 성장 ${fmt(a.stats[k + 'perlevel'])} vs ${fmt(b.stats[k + 'perlevel'])}). ${FORMULA.growth}`,
      srcs: ['DD'], sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats') });
});
gen('champ', 4, 1, async () => {
  const n = pick([1, 6, 11, 16, 18]), pool = withStats().filter(x => x.stats.hp && x.stats.armor);
  const ehp = c => Math.round(lvlStat(c, 'hp', n) * (1 + lvlStat(c, 'armor', n) / 100));
  const cs = [], seen = new Set();
  for (const c of shuffle(pool)) { const v = ehp(c); if (seen.has(v)) continue; seen.add(v); cs.push([c, v]); if (cs.length >= 4) break; }
  if (cs.length < 4) return null; cs.sort((a, b) => b[1] - a[1]);
  return Q('champ', `레벨 ${n}, 아이템·룬 없이 물리 피해 기준 유효 체력이 가장 높은 챔피언은? (유효 체력 = 체력 × (1 + 방어력/100))`, cs[0][0].name, cs.slice(1).map(x => x[0].name),
    { explain: cs.map(([c, v]) => `${c.name} ${v}`).join(' · ') + `. ${FORMULA.growth}`, srcs: ['DD'], sig: () => cs.map(([c]) => sigC(c.key, 'stats')).join() });
});
gen('champ', 4, 1, async () => {
  const n = pick([1, 6, 11, 18]); const c = pick(withStats().filter(x => x.stats.armor && x.stats.armorperlevel != null));
  const ar = r1(lvlStat(c, 'armor', n)); const red = Math.round((1 - 100 / (100 + ar)) * 1000) / 10;
  const wr = [Math.round(ar * 10) / 10, Math.round(ar / 2 * 10) / 10, Math.round((1 - 100 / (100 + ar * 1.5)) * 1000) / 10, Math.round((1 - 100 / (100 + ar * 0.6)) * 1000) / 10]
    .filter(x => x > 0 && x < 100 && x !== red);
  return Q('champ', `레벨 ${n} ${c.name}(아이템 없음)은 물리 피해를 몇 % 덜 받을까요?`, fmt(red) + '%', wr.map(x => fmt(x) + '%'),
    { explain: `방어력 ${fmt(ar)} → 1 − 100/(100+${fmt(ar)}) = ${fmt(red)}%. ${FORMULA.armor}`, srcs: ['DD'], sig: () => sigC(c.key, 'stats.armor') + sigC(c.key, 'stats.armorperlevel'), champ: c.key });
});

/* =====================================================================
 *  스킬 · 쿨타임
 * ===================================================================== */
gen('skill', 1, 2, async () => {
  const d = await detailed(x => x.spells.length === 4); if (!d) return null;
  const all = [...d.spells, d.passive].filter(Boolean), s = pick(all);
  if (all.filter(x => x.name === s.name).length > 1) return null;
  const order = ['패시브', 'Q', 'W', 'E', 'R'];
  return Q('skill', `「${s.name}」은(는) ${d.champ.name}의 어떤 스킬일까요?`, keyLabel(s.key), order.filter(x => x !== keyLabel(s.key)),
    { max: 5, order, explain: trunc(s.desc, 150), srcs: [s.src.name], sig: () => sigS(d.key, s.key, 'name'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 2, 1, async () => {
  const d = await detailed(x => x.spells.some(s => s.icons.length)); if (!d) return null;
  const s = pick([...d.spells, d.passive].filter(x => x && x.icons.length));
  return Q('skill', '이 스킬 아이콘의 주인은?', d.champ.name, champDistractors(d.champ),
    { img: s.icons, imgClass: 'icon', explain: `${d.champ.name} ${keyLabel(s.key)} 「${s.name}」`, srcs: [s.src.name], sig: () => sigS(d.key, s.key, 'name'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 2, 1, async () => {
  const d = await detailed(x => x.spells.length); if (!d) return null;
  const s = pick([...d.spells, d.passive].filter(Boolean)); if (s.name.includes(d.champ.name)) return null;
  return Q('skill', `「${s.name}」(${keyLabel(s.key)}) 스킬을 가진 챔피언은?`, d.champ.name, champDistractors(d.champ),
    { explain: trunc(s.desc, 150), srcs: [s.src.name], sig: () => sigS(d.key, s.key, 'name'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 2, 2, async () => {
  const ds = await detailedMany(4, d => { const R = spellOf(d, 'R'); return R && R.cooldown && R.cooldown[0] > 0; }); if (!ds.length) return null;
  const d = ds[0], R = spellOf(d, 'R'), v = R.cooldown[0];
  return Q('skill', `${d.champ.name}의 궁극기 「${R.name}」 1레벨 재사용 대기시간은?`, sec(v), numericOptions(v, ds.map(x => spellOf(x, 'R').cooldown[0])).map(sec),
    { explain: `레벨별 ${fmtArr(R.cooldown)}초`, srcs: [R.src.cooldown], sig: () => sigS(d.key, 'R', 'cooldown'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 3, 2, async () => {
  const ds = await detailedMany(4, d => d.spells.some(s => s.key !== 'R' && s.cooldown && s.cooldown[0] > 0)); if (!ds.length) return null;
  const d = ds[0], s = pick(d.spells.filter(x => x.key !== 'R' && x.cooldown && x.cooldown[0] > 0));
  const maxR = Math.random() < 0.5, i = maxR ? s.cooldown.length - 1 : 0, v = s.cooldown[i];
  const pool = ds.flatMap(x => x.spells.filter(y => y.key === s.key && y.cooldown).map(y => y.cooldown[Math.min(i, y.cooldown.length - 1)]));
  return Q('skill', `${d.champ.name}의 ${s.key} 「${s.name}」 ${maxR ? '최대 레벨(' + s.cooldown.length + ')' : '1레벨'} 재사용 대기시간은?`, sec(v), numericOptions(v, pool).map(sec),
    { explain: `레벨별 ${fmtArr(s.cooldown)}초`, srcs: [s.src.cooldown], sig: () => sigS(d.key, s.key, 'cooldown'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 3, 1, async () => {
  const ds = await detailedMany(4, d => { const R = spellOf(d, 'R'); return R && R.cooldown && R.cooldown[0] > 0; });
  const cs = [], seen = new Set();
  for (const d of ds) { const v = spellOf(d, 'R').cooldown[0]; if (seen.has(v)) continue; seen.add(v); cs.push([d, v]); if (cs.length >= 4) break; }
  if (cs.length < 4) return null;
  const lo = Math.random() < 0.5; cs.sort((a, b) => lo ? a[1] - b[1] : b[1] - a[1]);
  return Q('skill', `다음 중 궁극기 1레벨 쿨타임이 가장 ${lo ? '짧은' : '긴'} 챔피언은? (한타 각 계산)`, cs[0][0].champ.name, cs.slice(1).map(x => x[0].champ.name),
    { explain: cs.map(([d, v]) => `${d.champ.name} ${sec(v)}`).join(' · '), srcs: ['DD'], sig: () => cs.map(([d]) => sigS(d.key, 'R', 'cooldown')).join(), needs: { d: cs.map(([d]) => d.key) } });
}, { d: true });
gen('skill', 3, 1, async () => {
  const ds = await detailedMany(6, d => d.spells.some(s => s.cooldown && s.cooldown.length > 1));
  const all = ds.flatMap(d => d.spells.filter(s => s.cooldown && s.cooldown.length > 1).map(s => ({ d, s })));
  const flat = all.filter(x => new Set(x.s.cooldown).size === 1), dec = all.filter(x => new Set(x.s.cooldown).size > 1);
  if (!flat.length || dec.length < 3) return null;
  const c = pick(flat), wr = shuffle(dec).slice(0, 3);
  const lab = x => `${x.d.champ.name} ${x.s.key} 「${x.s.name}」`;
  return Q('skill', '다음 중 스킬 레벨을 올려도 재사용 대기시간이 줄지 않는 스킬은?', lab(c), wr.map(lab),
    { long: true, explain: [c, ...wr].map(x => `${lab(x)}: ${fmtArr(x.s.cooldown)}초`).join(' · '), srcs: ['DD'], sig: () => [c, ...wr].map(x => sigS(x.d.key, x.s.key, 'cooldown')).join(), needs: { d: [c, ...wr].map(x => x.d.key) } });
}, { d: true });
gen('skill', 3, 1, async () => {
  const d = await detailed(x => x.spells.some(s => s.manaCost && s.manaCost[0] > 0)); if (!d) return null;
  const s = pick(d.spells.filter(x => x.manaCost && x.manaCost[0] > 0)), v = s.manaCost[0];
  const pool = [...S.details.values()].flatMap(x => x.spells.filter(y => y.manaCost).map(y => y.manaCost[0]));
  return Q('skill', `${d.champ.name}의 ${s.key} 「${s.name}」 1레벨 마나 소모량은? (마나 관리)`, fmt(v), numericOptions(v, pool, { step: 5 }).map(fmt),
    { explain: `레벨별 ${fmtArr(s.manaCost)}`, srcs: [s.src.cost], sig: () => sigS(d.key, s.key, 'manaCost'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 3, 1, async () => {
  const ok = s => s.range && s.range[0] >= 100 && s.range[0] < 5000;
  const d = await detailed(x => x.spells.some(ok)); if (!d) return null;
  const s = pick(d.spells.filter(ok)), v = s.range[0];
  const pool = [...S.details.values()].flatMap(x => x.spells.filter(ok).map(y => y.range[0]));
  return Q('skill', `${d.champ.name}의 ${s.key} 「${s.name}」 사거리는?`, fmt(v), numericOptions(v, pool, { step: 25 }).map(fmt),
    { explain: `레벨별 ${fmtArr(s.range)} · 기본 공격 사거리 ${fmt(d.champ.stats ? d.champ.stats.attackrange : '-')}`, srcs: [s.src.range], sig: () => sigS(d.key, s.key, 'range'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 4, 2, async () => {
  const d = await detailed(x => x.spells.some(s => s.cooldown && s.cooldown[0] >= 3)); if (!d) return null;
  const s = pick(d.spells.filter(x => x.cooldown && x.cooldown[0] >= 3));
  const lv = rand(s.cooldown.length), base = s.cooldown[lv], ah = pick([20, 30, 45, 60, 80, 100, 120]);
  const v = r1(base * 100 / (100 + ah));
  const wr = [ah < 100 ? r1(base * (1 - ah / 100)) : null, r1(base * 100 / (100 + ah * 1.5)), r1(base * 100 / (100 + ah * 0.5)), r1(base - ah / 10)].filter(x => x > 0 && x !== v);
  return Q('skill', `스킬 가속 ${ah}일 때 ${d.champ.name}의 ${s.key} 「${s.name}」(${lv + 1}레벨) 재사용 대기시간은?`, sec(v), wr.map(sec),
    { explain: `${fmt(base)} × 100 ÷ (100 + ${ah}) = ${fmt(v)}초. ${FORMULA.haste} (가속 ${ah} ≈ 쿨타임 ${fmt(Math.round(ah / (100 + ah) * 1000) / 10)}% 감소)`,
      srcs: [s.src.cooldown], sig: () => sigS(d.key, s.key, 'cooldown'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });
gen('skill', 4, 1, async () => {
  const d = await detailed(x => { const R = spellOf(x, 'R'); return R && R.cooldown && R.cooldown.length >= 3 && R.cooldown[0] >= 20; }); if (!d) return null;
  const R = spellOf(d, 'R'), ah = pick([30, 50, 70, 100]), base = R.cooldown[R.cooldown.length - 1];
  const times = Math.floor(600 / (base * 100 / (100 + ah)));
  const wr = [Math.floor(600 / base), ah < 100 ? Math.floor(600 / (base * (1 - ah / 100))) : times + 3, times + 2, Math.max(1, times - 2)].filter(x => x !== times && x > 0 && x < times * 4);
  return Q('skill', `${d.champ.name}이(가) 궁극기 ${R.cooldown.length}레벨·스킬 가속 ${ah}일 때, 10분 동안 쿨타임마다 궁을 쓰면 최대 몇 번 쓸 수 있을까요? (첫 사용 제외, 시전 시간 무시)`, String(times), wr.map(String),
    { explain: `쿨타임 ${fmt(base)} × 100 ÷ ${100 + ah} = ${fmt(r1(base * 100 / (100 + ah)))}초 → 600 ÷ 그 값 = ${times}회. ${FORMULA.haste}`, srcs: [R.src.cooldown], sig: () => sigS(d.key, 'R', 'cooldown'), needs: { d: [d.key] }, champ: d.key });
}, { d: true });

/* =====================================================================
 *  아이템
 * ===================================================================== */
const itemOpt = { need: 'items' };
const statLabelPool = I => { const f = {}; I.list.forEach(m => m.stats.forEach(s => f[s.label] = (f[s.label] || 0) + 1)); return Object.keys(f).filter(k => f[k] >= 3); };
gen('item', 1, 2, async () => {
  const I = await ensure('items'); const pool = I.list.filter(m => ['basic', 'boots', 'consumable'].includes(m.kind)); const m = pick(pool);
  return Q('item', `${m.name}의 가격은?`, gold(m.total), numericOptions(m.total, pool.map(x => x.total), { step: 25 }).map(gold),
    { img: m.icons, imgClass: 'icon sm', explain: trunc(m.plain || m.stats.map(s => `${s.value}${s.pct ? '%' : ''} ${s.label}`).join(', '), 120), srcs: [m.src.total], sig: () => sigI(m.id, 'total') });
}, itemOpt);
gen('item', 1, 2, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => x.stats.length && ['legendary', 'epic', 'boots', 'basic'].includes(x.kind)));
  const labels = statLabelPool(I), has = new Set(m.stats.map(s => s.label));
  const s = pick(m.stats); const wr = shuffle(labels.filter(l => !has.has(l))).slice(0, 3);
  return Q('item', `다음 중 ${m.name}이(가) 주는 능력치는?`, s.label, wr,
    { img: m.icons, imgClass: 'icon sm', explain: m.stats.map(x => `${x.value}${x.pct ? '%' : ''} ${x.label}`).join(', '), srcs: [m.src.desc], sig: () => sigI(m.id, 'stats') });
}, itemOpt);
gen('item', 2, 2, async () => {
  const I = await ensure('items'); const pool = I.list.filter(m => m.kind === 'legendary'); const m = pick(pool);
  return Q('item', `${m.name}의 총 가격은?`, gold(m.total), numericOptions(m.total, pool.map(x => x.total), { step: 50 }).map(gold),
    { img: m.icons, imgClass: 'icon sm', explain: `하위: ${m.fromSR.map(i => I.byId.get(i).name).join(' + ') || '-'} · 조합 비용 ${gold(m.base)}`, srcs: [m.src.total], sig: () => sigI(m.id, 'total') });
}, itemOpt);
gen('item', 2, 2, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => ['legendary', 'epic', 'boots'].includes(x.kind) && x.fromSR.length >= 2));
  const fromNames = [...new Set(m.fromSR.map(i => I.byId.get(i).name))];
  const others = I.list.filter(x => ['basic', 'epic'].includes(x.kind) && !m.fromSR.includes(x.id) && !fromNames.includes(x.name));
  const wrong = pick(others);
  return Q('item', `${m.name}의 하위 아이템(재료)이 아닌 것은?`, wrong.name, fromNames.slice(0, 3),
    { img: m.icons, imgClass: 'icon sm', explain: `${m.name} = ${m.from.map(i => (I.byId.get(i) || {}).name).filter(Boolean).join(' + ')} + 조합 비용 ${gold(m.base)}`, srcs: [m.src.from], sig: () => sigI(m.id, 'from') });
}, itemOpt);
gen('item', 2, 2, async () => {
  const I = await ensure('items'); const leg = I.list.filter(x => x.kind === 'legendary');
  const b = pick(I.list.filter(x => ['basic', 'epic'].includes(x.kind) && x.intoSR.some(i => leg.some(l => l.id === i))));
  const ok = leg.filter(l => b.intoSR.includes(l.id)), c = pick(ok);
  const wr = shuffle(leg.filter(l => !b.intoSR.includes(l.id) && !l.fromSR.includes(b.id))).slice(0, 3).map(x => x.name);
  return Q('item', `${b.name}(으)로 만들 수 있는 아이템은?`, c.name, wr,
    { img: b.icons, imgClass: 'icon sm', explain: `${b.name} → ${ok.map(x => x.name).join(', ')}`, srcs: ['DD'], sig: () => sigI(b.id, 'into') + sigI(c.id, 'from') });
}, itemOpt);
gen('item', 2, 1, async () => {
  const I = await ensure('items'); const map = new Map();
  for (const m of I.list) for (const p of [...new Set([...m.passives, ...m.actives])]) { if (!map.has(p)) map.set(p, []); map.get(p).push(m); }
  const uniq = [...map.entries()].filter(([, v]) => v.length === 1 && ['legendary', 'epic', 'boots'].includes(v[0].kind));
  const [p, [m]] = pick(uniq);
  const wr = shuffle(I.list.filter(x => x.kind === m.kind && x.id !== m.id)).slice(0, 3).map(x => x.name);
  return Q('item', `「${p}」 효과를 가진 아이템은?`, m.name, wr,
    { explain: trunc(strip(m.desc), 160), srcs: [m.src.desc], sig: () => sigI(m.id, 'passives') + sigI(m.id, 'actives') });
}, itemOpt);
gen('item', 2, 1, async () => {
  const I = await ensure('items'); const pool = I.list.filter(m => m.sell > 0 && ['legendary', 'boots', 'basic', 'epic'].includes(m.kind)); const m = pick(pool);
  return Q('item', `${m.name}을(를) 상점에 되팔면 받는 골드는?`, gold(m.sell), numericOptions(m.sell, pool.map(x => x.sell), { step: 10 }).map(gold),
    { img: m.icons, imgClass: 'icon sm', explain: `가격 ${gold(m.total)} · 판매가 ${gold(m.sell)} (${Math.round(m.sell / m.total * 100)}%)`, srcs: ['DD'], sig: () => sigI(m.id, 'sell') });
}, itemOpt);
gen('item', 3, 2, async () => {
  const I = await ensure('items'); const pool = I.list.filter(m => ['legendary', 'epic'].includes(m.kind) && m.base > 0); const m = pick(pool);
  return Q('item', `${m.name}의 조합 비용(하위 아이템을 다 가졌을 때 추가로 내는 골드)은?`, gold(m.base), numericOptions(m.base, pool.map(x => x.base), { step: 25 }).map(gold),
    { img: m.icons, imgClass: 'icon sm', explain: `총 ${gold(m.total)} = ${m.from.map(i => { const x = I.byId.get(i); return x ? `${x.name} ${x.total}` : ''; }).filter(Boolean).join(' + ')} + 조합 ${m.base}`, srcs: ['DD'], sig: () => sigI(m.id, 'base') });
}, itemOpt);
gen('item', 3, 2, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => x.stats.length && ['legendary', 'epic', 'boots'].includes(x.kind)));
  const s = pick(m.stats); const pool = I.list.flatMap(x => x.stats.filter(y => y.label === s.label).map(y => y.value));
  const u = v => fmt(v) + (s.pct ? '%' : '');
  return Q('item', `${m.name}이(가) 주는 ${s.label}은(는)?`, u(s.value), numericOptions(s.value, pool, { step: s.value < 10 ? 1 : 5 }).map(u),
    { img: m.icons, imgClass: 'icon sm', explain: m.stats.map(x => `${x.value}${x.pct ? '%' : ''} ${x.label}`).join(', '), srcs: [m.src.desc], sig: () => sigI(m.id, 'stats') });
}, itemOpt);
gen('item', 3, 1, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => x.kind === 'legendary' && x.fromSR.length));
  const z = I.byId.get(pick(m.fromSR)), v = m.total - z.total;
  const wr = [m.total, m.base, v + z.total / 2].map(Math.round).filter(x => x !== v && x > 0).concat(numericOptions(v, [], { step: 100 }));
  return Q('item', `${z.name}을(를) 가진 상태에서 ${m.name}을(를) 완성하려면 추가로 필요한 골드는?`, gold(v), wr.map(gold),
    { explain: `${m.total} − ${z.total} = ${v}`, srcs: ['DD'], sig: () => sigI(m.id, 'total') + sigI(z.id, 'total') });
}, itemOpt);
gen('item', 4, 2, async () => {
  const I = await ensure('items'); const pool = I.list.filter(x => x.eff && !x.isRef && ['legendary', 'epic', 'boots'].includes(x.kind));
  const cs = [], seen = new Set();
  for (const m of shuffle(pool)) { const e = Math.round(m.eff * 1000); if (seen.has(e)) continue; seen.add(e); cs.push(m); if (cs.length >= 4) break; }
  if (cs.length < 4) return null; cs.sort((a, b) => b.eff - a.eff);
  const ref = [...new Set(cs.flatMap(m => m.stats.map(s => s.label)))].map(l => I.goldPer[l]).filter(Boolean).map(g => `${g.label} 1당 ${fmt(r1(g.per))}골드(${g.item}${g.how === 'derived' ? '에서 역산' : ''})`).join(', ');
  return Q('item', '능력치만 골드로 환산했을 때 골드 효율이 가장 높은 아이템은? (고유 효과 제외)', cs[0].name, cs.slice(1).map(x => x.name),
    { explain: cs.map(m => `${m.name} ${Math.round(m.eff * 100)}%`).join(' · ') + `. 기준가(기본 아이템에서 계산): ${ref}`, srcs: ['DD'], sig: () => cs.map(m => sigI(m.id, 'total') + sigI(m.id, 'stats')).join() });
}, itemOpt);
gen('item', 4, 1, async () => {
  const I = await ensure('items'); const pool = I.list.filter(x => x.eff && !x.isRef && ['legendary', 'epic'].includes(x.kind)); const m = pick(pool);
  const v = Math.round(m.eff * 100);
  return Q('item', `${m.name}의 능력치 골드 가치는 가격 대비 몇 %일까요? (기본 아이템 기준 환산, 고유 효과 제외)`, v + '%', numericOptions(v, pool.map(x => Math.round(x.eff * 100)), { step: 4 }).map(x => x + '%'),
    { img: m.icons, imgClass: 'icon sm', explain: `능력치 가치 ${Math.round(m.statValue)}골드 ÷ 가격 ${m.total}골드 = ${v}% (${m.stats.map(s => `${s.label} ${s.value}×${fmt(r1(I.goldPer[s.label].per))}`).join(' + ')})`, srcs: ['DD'], sig: () => sigI(m.id, 'total') + sigI(m.id, 'stats') });
}, itemOpt);

/* =====================================================================
 *  소환사 주문
 * ===================================================================== */
const summOpt = { need: 'summ' };
gen('summ', 1, 3, async () => {
  const M = await ensure('summ'); const s = pick(M);
  return Q('summ', `소환사 주문 「${s.name}」의 재사용 대기시간은?`, sec(s.cd), numericOptions(s.cd, M.map(x => x.cd), { step: 15 }).map(sec),
    { img: s.icons, imgClass: 'icon sm', explain: trunc(s.desc, 150), srcs: [s.src.cd], sig: () => sigM(s.id) });
}, summOpt);
gen('summ', 1, 2, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.desc)); if (M.length < 4) return null;
  return Q('summ', `다음 설명의 소환사 주문은?<div class="quote">“${esc(trunc(mask(s.desc, [s.name]), 200))}”</div>`, s.name, shuffle(M.filter(x => x.id !== s.id)).slice(0, 3).map(x => x.name),
    { raw: true, srcs: [s.src.name], explain: `재사용 대기시간 ${sec(s.cd)}`, sig: () => sigM(s.id) });
}, summOpt);
gen('summ', 1, 1, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.icons.length));
  return Q('summ', '이 아이콘의 소환사 주문은?', s.name, shuffle(M.filter(x => x.id !== s.id)).slice(0, 3).map(x => x.name),
    { img: s.icons, imgClass: 'icon', srcs: [s.src.name], explain: `재사용 대기시간 ${sec(s.cd)}`, sig: () => sigM(s.id) });
}, summOpt);
gen('summ', 2, 2, async () => {
  const M = await ensure('summ'); const cs = [], seen = new Set();
  for (const s of shuffle(M)) { if (seen.has(s.cd)) continue; seen.add(s.cd); cs.push(s); if (cs.length >= 4) break; }
  if (cs.length < 4) return null; const lo = Math.random() < 0.5; cs.sort((a, b) => lo ? a.cd - b.cd : b.cd - a.cd);
  return Q('summ', `다음 중 재사용 대기시간이 가장 ${lo ? '짧은' : '긴'} 소환사 주문은?`, cs[0].name, cs.slice(1).map(x => x.name),
    { explain: cs.map(s => `${s.name} ${sec(s.cd)}`).join(' · '), srcs: ['DD'], sig: () => cs.map(s => sigM(s.id)).join() });
}, summOpt);
gen('summ', 3, 1, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.cd >= 60)); const t = pick([2, 3, 5]);
  const used = rand(Math.floor(s.cd / 2)) + 10; const left = s.cd - used;
  const at = t * 60 + left; const mm = x => `${Math.floor(x / 60)}분 ${String(x % 60).padStart(2, '0')}초`;
  return Q('summ', `상대가 ${t}분 00초에 「${s.name}」을(를) 썼습니다. 다시 쓸 수 있는 가장 빠른 시각은? (가속 없음)`, mm(t * 60 + s.cd), [mm(t * 60 + s.cd - 30), mm(t * 60 + s.cd + 30), mm(at)].filter(x => x !== mm(t * 60 + s.cd)),
    { explain: `${t}:00 + ${sec(s.cd)} = ${mm(t * 60 + s.cd)}`, srcs: [s.src.cd], sig: () => sigM(s.id) });
}, summOpt);

/* =====================================================================
 *  룬
 * ===================================================================== */
const runeOpt = { need: 'runes' };
gen('rune', 1, 2, async () => {
  const R = await ensure('runes'); const r = pick(R.runes); const names = R.trees.map(t => t.name);
  return Q('rune', `「${r.name}」 룬은 어느 룬 빌드에 있을까요?`, r.treeName, names.filter(n => n !== r.treeName),
    { max: 5, order: names, img: r.icons, imgClass: 'icon sm', explain: `${r.treeName} · ${r.keystone ? '핵심 룬' : (r.slot + 1) + '번째 줄'} — ${trunc(r.desc, 120)}`, srcs: [r.src.name], sig: () => sigR(r.id) });
}, runeOpt);
gen('rune', 2, 2, async () => {
  const R = await ensure('runes'); const k = pick(R.runes.filter(r => r.keystone)); const wr = shuffle(R.runes.filter(r => !r.keystone)).slice(0, 3);
  return Q('rune', '다음 중 핵심 룬은?', k.name, wr.map(x => x.name),
    { explain: [k, ...wr].map(r => `${r.name}: ${r.treeName} ${r.keystone ? '핵심' : (r.slot + 1) + '줄'}`).join(' · '), srcs: [k.src.name], sig: () => [k, ...wr].map(r => sigR(r.id)).join() });
}, runeOpt);
gen('rune', 2, 1, async () => {
  const R = await ensure('runes'); const t = pick(R.trees.filter(x => x.slots[0] && x.slots[0].length >= 2));
  const mine = t.slots[0].map(id => R.byId.get(id)).filter(Boolean); const other = pick(R.runes.filter(r => r.keystone && r.tree !== t.id));
  return Q('rune', `다음 중 「${t.name}」의 핵심 룬이 아닌 것은?`, other.name, mine.slice(0, 3).map(x => x.name),
    { explain: `${t.name} 핵심 룬: ${mine.map(x => x.name).join(', ')} · ${other.name}은(는) ${other.treeName}`, srcs: ['DD'], sig: () => sigR(other.id) + mine.map(x => sigR(x.id)).join() });
}, runeOpt);
gen('rune', 3, 2, async () => {
  const R = await ensure('runes'); const r = pick(R.runes.filter(x => !x.keystone));
  const t = R.trees.find(x => x.id === r.tree); const row = t.slots[r.slot].filter(id => id !== r.id).map(id => R.byId.get(id)).filter(Boolean);
  if (!row.length) return null; const c = pick(row);
  const wr = shuffle(R.runes.filter(x => x.tree === r.tree && !x.keystone && x.slot !== r.slot)).slice(0, 3);
  return Q('rune', `「${r.name}」와(과) 같은 줄이라 동시에 고를 수 없는 룬은?`, c.name, wr.map(x => x.name),
    { explain: `${t.name} ${r.slot + 1}번째 줄: ${[r, ...row].map(x => x.name).join(' / ')}`, srcs: ['DD'], sig: () => sigR(r.id) + sigR(c.id) });
}, runeOpt);
gen('rune', 3, 1, async () => {
  const R = await ensure('runes'); const r = pick(R.runes.filter(x => x.desc && x.desc.length > 15));
  const same = R.runes.filter(x => x.id !== r.id && x.tree === r.tree); const wr = shuffle(same.length >= 3 ? same : R.runes.filter(x => x.id !== r.id)).slice(0, 3);
  return Q('rune', `다음 설명의 룬은?<div class="quote">“${esc(trunc(mask(r.desc, [r.name]), 200))}”</div>`, r.name, wr.map(x => x.name),
    { raw: true, explain: `${r.treeName} · ${r.keystone ? '핵심 룬' : (r.slot + 1) + '번째 줄'}`, srcs: [r.src.desc], sig: () => sigR(r.id) });
}, runeOpt);
gen('rune', 4, 1, async () => {
  const R = await ensure('runes'); const t = pick(R.trees); const pool = R.runes.filter(x => x.tree !== t.id && !x.keystone);
  // 보조 룬으로는 핵심 룬을 고를 수 없음 — 가능한 조합 판별
  const k = pick(R.runes.filter(x => x.keystone && x.tree === t.id)); const sub = pick(pool);
  const bad = pick(R.runes.filter(x => x.keystone && x.tree !== t.id));
  const sameRow = R.runes.filter(x => x.tree === sub.tree && x.slot === sub.slot && x.id !== sub.id);
  if (!sameRow.length) return null; const dup = pick(sameRow);
  const A = `주 ${t.name}(${k.name}) + 보조 ${sub.name}`, B = `주 ${t.name}(${k.name}) + 보조 ${bad.name}`, C = `보조로 ${sub.name}와(과) ${dup.name}을(를) 함께 선택`;
  return Q('rune', '다음 중 실제로 가능한 룬 조합은?', A, [B, C],
    { max: 3, long: true, explain: `보조 빌드에서는 핵심 룬을 고를 수 없고(${bad.name}=${bad.treeName} 핵심), 같은 줄의 룬은 하나만 고를 수 있어요(${sub.name}·${dup.name} = ${sub.treeName} ${sub.slot + 1}번째 줄).`, srcs: ['DD'], sig: () => [k, sub, bad, dup].map(r => sigR(r.id)).join() });
}, runeOpt);

/* =====================================================================
 *  덕력
 * ===================================================================== */
gen('fun', 1, 2, async () => {
  const c = pick(S.champs.filter(x => iconUrls(x).length));
  return Q('fun', '이 초상화의 챔피언은?', c.name, champDistractors(c), { img: iconUrls(c), imgClass: 'icon', explain: `${c.name} — ${c.title || ''}`, srcs: [c.iconDD ? 'DD' : 'CD'], sig: () => sigC(c.key, 'name'), champ: c.key });
});
gen('fun', 2, 1, async () => {
  const d = await detailed(x => x.skins.some(s => s.imgs.length)); if (!d) return null;
  const s = pick(d.skins.filter(x => x.imgs.length));
  return Q('fun', '확대된 일러스트의 챔피언은?', d.champ.name, champDistractors(d.champ),
    { img: s.imgs, imgClass: 'splash', zoom: { s: 1.3 + Math.random() * 1.1, x: 20 + rand(60), y: 15 + rand(50) }, explain: `「${s.name}」${s.rarity ? ` · ${s.rarity} 등급` : ''}`, srcs: [s.src, s.rarity ? 'CD' : null], champ: d.key });
}, { d: true });
gen('fun', 2, 1, async () => {
  const c = pick(S.champs.filter(x => x.title));
  return Q('fun', `「${c.title}」 칭호를 가진 챔피언은?`, c.name, champDistractors(c), { explain: `${c.name} — ${c.title}`, srcs: [c.src.title], sig: () => sigC(c.key, 'title'), champ: c.key });
});
gen('fun', 2, 1, async () => {
  const d = await detailed(x => x.skins.some(s => !s.base)); if (!d) return null;
  const s = pick(d.skins.filter(x => !x.base)), m = mask(s.name, [d.champ.name, d.champ.alias]); if (!m.includes('○')) return null;
  return Q('fun', `「${m}」 스킨의 챔피언은?`, d.champ.name, champDistractors(d.champ),
    { explain: `「${s.name}」${s.rarity ? ` · ${s.rarity} 등급` : ''}${s.legacy ? ' · 레거시' : ''}`, srcs: [s.src, s.rarity ? 'CD' : null], champ: d.key });
}, { d: true });
gen('fun', 3, 1, async () => {
  let c, text, src;
  if (Math.random() < 0.5 || detailBroken()) { c = pick(S.champs.filter(x => x.blurb)); text = strip(c.blurb); src = 'DD'; }
  else { const d = await detailed(x => x.lore); if (!d) return null; c = d.champ; text = d.lore; src = d.loreSrc; }
  if (!text) return null;
  let t = mask(text, [c.name, c.alias, c.id]);
  if (t.length > 220) { const cut = t.slice(0, 220), i = cut.lastIndexOf('. '); t = (i > 80 ? cut.slice(0, i + 1) : cut) + '…'; }
  return Q('fun', `이 이야기의 주인공은?<div class="quote">“${esc(t)}”</div>`, c.name, champDistractors(c), { raw: true, explain: `${c.name} — ${c.title || ''}`, srcs: [src], champ: c.key });
});

/* =====================================================================
 *  패치 변경 (이전 버전 스냅샷과 비교해 자동 생성)
 * ===================================================================== */
const patchDiff = () => { const D = store.get('lastDiff', null); return D && D.to === S.dd ? D : null; };
const patchAvailable = () => { const D = patchDiff(); return !!(D && D.changes.some(x => x.field !== 'new')); };
gen('patch', 3, 3, async () => {
  const D = patchDiff(); if (!D) return null;
  const list = D.changes.filter(x => x.field !== 'new' && (typeof x.old === 'number' || Array.isArray(x.old)));
  if (!list.length) return null;
  const ch = pick(list), u = ch.unit || '';
  const name = ch.name || (S.byKey.get(ch.key) || {}).name || '?';
  const f = v => fmtArr(v) + u;
  const delta = (o, n, m) => Array.isArray(o) ? o.map((x, i) => +(x + ((n[i] ?? x) - x) * m).toFixed(3)) : +(o + (n - o) * m).toFixed(3);
  const right = `${f(ch.old)} → ${f(ch.new)}`;
  return Q('patch', `${D.from} → ${D.to} 패치에서 ${name}의 ${ch.label}은(는) 어떻게 바뀌었나요?`, right,
    [`${f(ch.old)} → ${f(delta(ch.old, ch.new, -1))}`, `${f(ch.old)} → ${f(delta(ch.old, ch.new, 2))}`, '변경 없음'],
    { long: true, explain: `실제 변경: ${right}`, srcs: ['DD'] });
});
gen('patch', 2, 1, async () => {
  const D = patchDiff(); if (!D) return null;
  const nums = D.changes.filter(x => typeof x.old === 'number' && typeof x.new === 'number' && x.field.startsWith('stats.'));
  const byName = new Map(); nums.forEach(x => byName.set(x.name, x));
  if (!byName.size) return null;
  const ch = pick([...byName.values()]); const up = ch.new > ch.old;
  const unchanged = shuffle(S.champs.filter(c => !D.changes.some(x => x.key === c.key))).slice(0, 3).map(c => c.name);
  return Q('patch', `이번 패치(${D.to})에서 기본 스탯이 바뀐 챔피언은?`, ch.name, unchanged,
    { explain: `${ch.name} ${ch.label}: ${fmt(ch.old)} → ${fmt(ch.new)} (${up ? '상향' : '하향'})`, srcs: ['DD'] });
});

/* =====================================================================
 *  출제
 * ===================================================================== */
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const usableGen = g => (g.cat !== 'patch' || patchAvailable()) && !(g.d && detailBroken()) && !(g.need && (S.needFail[g.need] || 0) >= 2);
async function makeQuestion(cats, tiers, seen) {
  let gens = GENS.filter(g => cats.has(g.cat) && tiers.has(g.tier) && usableGen(g));
  if (!gens.length) gens = GENS.filter(g => cats.has(g.cat) && usableGen(g));
  if (!gens.length) { gens = GENS.filter(usableGen); if (gens.length && !makeQuestion._w) { makeQuestion._w = true; toast('선택한 분야의 데이터를 받지 못해 다른 분야 문제로 대체합니다'); } }
  if (!gens.length) return null;
  const total = gens.reduce((a, g) => a + g.w, 0), deadline = Date.now() + 20000;
  for (let tries = 0; tries < 40 && Date.now() < deadline; tries++) {
    let r = Math.random() * total, g = gens[0];
    for (const x of gens) { r -= x.w; if (r <= 0) { g = x; break; } }
    if (!usableGen(g)) continue;
    try {
      const q = await withTimeout(g.fn(), 9000);
      if (!q || q.opts.length < 2) continue;
      q.tier = g.tier; q.need = g.need;
      const key = q.prompt + '|' + q.answer;
      if (seen && seen.has(key) && tries < 30) continue;
      return q;
    } catch (e) { if (!/후보 없음/.test(e.message)) console.warn('[문제 생성 실패]', g.cat, e); }
  }
  return null;
}
/** 패치 적용 후, 풀던 문제가 의존하는 값이 바뀌었는지 확인 */
async function isStale(q) {
  if (!q.sig) return false;
  const jobs = [];
  if (q.need) jobs.push(ensure(q.need).catch(() => {}));
  const keys = (q.needs && q.needs.d) || [];
  keys.forEach(k => { const c = S.byKey.get(k); if (c) jobs.push(loadDetail(c).catch(() => {})); });
  await Promise.all(jobs);
  let now; try { now = q.sig(); } catch (e) { return true; }
  return now !== q.sigVal;
}
