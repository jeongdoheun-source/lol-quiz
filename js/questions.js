'use strict';
/* =====================================================================
 *  questions.js — 템플릿 기반 문제 생성기 (AI 미사용)
 *  · 모든 문제는 5지선다
 *  · 문제는 저장하지 않고 매번 '지금 메모리에 있는 JSON'으로 즉석 생성
 *  · 각 문제는 sig()로 자신이 쓴 값을 기억 → 패치로 값이 바뀌면 재출제
 *  · 게임 수치는 전부 DD/CD에서 읽고, 코드에는 공식(레벨 성장·스킬 가속·방어력)만 둡니다
 *  · 해설은 실제 값을 대입한 계산 과정 + 실전에서의 의미를 단계별로 보여 줍니다
 * ===================================================================== */
const TIER = {
  1: { name: '1단계', range: '마스터', cls: 't1', pts: 1 },
  2: { name: '2단계', range: '그랜드마스터', cls: 't2', pts: 2 },
  3: { name: '3단계', range: '챌린저', cls: 't3', pts: 3 },
  4: { name: '4단계', range: '프로', cls: 't4', pts: 5 },
  5: { name: '5단계', range: '프로 분석가', cls: 't5', pts: 8 },
};
const CATS = { champ: '교전 계산', skill: '스킬·쿨타임 계산', item: '아이템·골드 계산', summ: '소환사 주문 계산' };
const OPTS = 5;

/* ---------- 공식 (게임 메커니즘) ---------- */
const growthMul = n => (n - 1) * (0.7025 + 0.0175 * (n - 1));
const lvlStat = (c, k, n) => c.stats[k] + (c.stats[k + 'perlevel'] || 0) * growthMul(n);
const hasteCd = (cd, ah) => cd * 100 / (100 + ah);
const dmgTaken = res => 100 / (100 + res);       // 받는 피해 배율
const n2 = x => fmt(Math.round(x * 100) / 100);
const n4 = x => fmt(Math.round(x * 10000) / 10000);
const pct = x => fmt(Math.round(x * 1000) / 10) + '%';
const ex = (...lines) => lines.flat().filter(Boolean).join('\n');
const growthLines = (n) => [
  `① 레벨 성장 배수 = (레벨−1) × (0.7025 + 0.0175 × (레벨−1))`,
  `   = ${n - 1} × (0.7025 + 0.0175 × ${n - 1}) = ${n - 1} × ${String(+(0.7025 + 0.0175 * (n - 1)).toFixed(4))} = ${n2(growthMul(n))}`,
];
function lvlLines(c, k, n, label) {
  const b = c.stats[k], g = c.stats[k + 'perlevel'] || 0, add = g * growthMul(n);
  return [...growthLines(n),
    `② 성장분 = 레벨당 ${label} ${fmt(g)} × ${n2(growthMul(n))} = ${n2(add)}`,
    `③ 레벨 ${n} ${label} = 기본 ${fmt(b)} + ${n2(add)} = ${n2(b + add)}`];
}
const growthWhy = () => `💡 성장 배수는 레벨이 오를수록 증가폭이 커집니다 (1→2레벨 +${n2(growthMul(2))}, 17→18레벨 +${n2(growthMul(18) - growthMul(17))}). 그래서 레벨당 성장치가 큰 챔피언은 후반으로 갈수록 격차를 벌립니다.`;

/* ---------- 서명(sig) ---------- */
const getPath = (o, path) => path.split('.').reduce((x, k) => x == null ? x : x[k], o);
const sigC = (k, path) => { const c = S.byKey.get(k); return JSON.stringify(c ? getPath(c, path) : '∅'); };
const sigS = (k, K, f) => { const d = S.details.get(k); if (!d) return '?'; const s = K === 'P' ? d.passive : d.spells.find(x => x.key === K); return JSON.stringify(s ? s[f] : null); };
const sigI = (id, f) => { const I = S.data.items; if (!I) return '?'; const m = I.byId.get(id); return JSON.stringify(m ? getPath(m, f) : null); };
/** 충전식 소환사 주문(강타 등) 안내 문구 */
const chargeTag = s => s.charge ? `(${s.charge.max ? '최대 ' + s.charge.max + '회 ' : ''}충전식)` : '';
const chargeNote = s => {
  const c = s.charge; if (!c) return '';
  if (c.max && c.rech && c.rech !== s.cd) return `※ 「${s.name}」${josa(s.name, '은')} 최대 ${c.max}회까지 충전되는 주문이에요. ${sec(s.cd)}는 연속으로 쓸 때 사이에 필요한 재사용 대기시간이고, 쓴 충전 1회는 ${sec(c.rech)} 뒤에 다시 채워집니다.`;
  if (c.max && c.rech) return `※ 「${s.name}」${josa(s.name, '은')} 최대 ${c.max}회까지 충전되는 주문이에요. 충전 1회가 ${sec(c.rech)}마다 채워집니다.`;
  return `※ 「${s.name}」${josa(s.name, '은')} 여러 번 충전되는 주문이라 위 재사용 대기시간 하나로 모든 상황을 설명할 수 없어요. 정확한 충전 횟수와 시간은 주문 설명을 확인하세요.`;
};
const sigM = id => { const M = S.data.summ; if (!M) return '?'; const s = M.find(x => x.id === id); return JSON.stringify(s ? [s.name, s.cd] : null); };
const sigR = id => { const R = S.data.runes; if (!R) return '?'; const r = R.byId.get(id); return JSON.stringify(r ? [r.name, r.tree, r.slot] : null); };

/* ---------- 공통 빌더 ---------- */
function Q(cat, prompt, correct, wrongs, extra = {}) {
  const labels = [...new Set([correct, ...wrongs].map(String))].slice(0, OPTS);
  if (labels.length < OPTS || labels[0] !== String(correct)) return null;       // 5지선다 보장
  let opts = labels.map(l => ({ label: l, ok: l === String(correct) }));
  if (extra.order) { const o = extra.order.filter(l => labels.includes(l)); if (o.length !== OPTS) return null; opts = o.map(l => ({ label: l, ok: l === String(correct) })); }
  else opts = shuffle(opts);
  const q = { cat, prompt, opts, answer: String(correct), ...extra, version: S.dd };
  try { q.sigVal = q.sig ? q.sig() : null; } catch (e) { q.sigVal = null; }
  return q;
}
const withStats = () => S.champs.filter(c => c.stats);
function champDistractors(c, n = OPTS - 1, pool = S.champs) {
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
  const near = [...new Set(pool.filter(x => typeof x === 'number' && x !== v && x > 0))].sort((a, b) => Math.abs(a - v) - Math.abs(b - v)).slice(0, 8);
  for (const x of shuffle(near)) { if (set.size >= OPTS) break; set.add(x); }
  const st = step || niceStep(v); let k = 1;
  while (set.size < OPTS && k < 60) { const c = +((v + st * (Math.random() < 0.5 ? -k : k))).toFixed(decimals); if (c > 0) set.add(c); k++; }
  return [...set].filter(x => x !== v);
}
/** 5개 구간 보기: A가 크게 우세 / 조금 우세 / 같다 / B가 조금 / B가 크게 */
function bucket5(aName, bName, d, th, verb) {
  const L = [`${J(aName, '이')} ${th} 이상 더 ${verb}`, `${J(aName, '이')} ${th} 미만 차이로 더 ${verb}`, '둘이 같다', `${J(bName, '이')} ${th} 미만 차이로 더 ${verb}`, `${J(bName, '이')} ${th} 이상 더 ${verb}`];
  const ad = Math.abs(d) < 1e-9 ? 0 : d;
  const ans = ad === 0 ? L[2] : ad >= th ? L[0] : ad > 0 ? L[1] : -ad >= th ? L[4] : L[3];
  return { L, ans };
}
function mask(text, names) {
  let t = text;
  const all = names.filter(Boolean).flatMap(n => [n, n.replace(/\s/g, ''), ...(n.includes(' ') ? n.split(' ').filter(w => w.length >= 2) : [])]);
  for (const n of [...new Set(all)].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(reEsc(n), 'gi'), '○○○');
  return t;
}
/** game = true 이면 실제 게임 데이터(bin.json)까지 반영된 챔피언만 사용 */
async function detailed(pred = () => true, game = false) {
  const P = d => (!game || d.gameTried) && pred(d);
  let list = [...S.details.values()].filter(P);
  if (list.length < 5 || Math.random() < 0.4) {
    const pool = S.champs.filter(c => !S.details.has(c.key));
    for (let i = 0; i < 2 && pool.length; i++) {
      try { const d = await loadDetail(pick(pool)); if (game) await applyGame(d); if (P(d)) { prefetch(2); return d; } } catch (e) {}
    }
    if (game) await Promise.allSettled(shuffle([...S.details.values()].filter(d => !d.gameTried)).slice(0, 3).map(applyGame));
    list = [...S.details.values()].filter(P);
  }
  prefetch(2);
  return list.length ? pick(list) : null;
}
async function detailedMany(n, pred = () => true, game = false) {
  const P = d => (!game || d.gameTried) && pred(d);
  let list = [...S.details.values()].filter(P);
  for (let round = 0; round < 3 && list.length < n; round++) {
    const pool = shuffle(S.champs.filter(c => !S.details.has(c.key))).slice(0, Math.max(5, n - list.length + 2));
    await Promise.allSettled(pool.map(c => loadDetail(c)));
    if (game) await Promise.allSettled(shuffle([...S.details.values()].filter(d => !d.gameTried)).slice(0, n + 2).map(applyGame));
    list = [...S.details.values()].filter(P);
    if (detailBroken() || (!pool.length && !game)) break;
  }
  return shuffle(list);
}
/** 충전형(탄약) 스킬은 cooldownTime이 실제 재사용 시간이 아니므로 쿨타임 문제에서 제외 */
const cdOk = s => !!(s && s.cooldown && s.cooldown[0] > 0 && !s.ammo);
const srcOf = arr => [...new Set(arr.filter(Boolean))];
const wasNote = s => s && s.cooldownWas ? `※ Data Dragon에는 ${fmtArr(s.cooldownWas.v)}초로 적혀 있지만, 실제 게임 데이터(CommunityDragon) 값인 ${fmtArr(s.cooldown)}초를 썼어요.` : '';
const spellOf = (d, K) => K === 'P' ? d.passive : d.spells.find(s => s.key === K);
const keyLabel = K => K === 'P' ? '패시브' : K;
const sec = x => fmt(x) + '초';
const gold = x => fmt(x) + '골드';
const mmss = x => { x = Math.round(x); return `${Math.floor(x / 60)}분 ${String(x % 60).padStart(2, '0')}초`; };
const itemStat = (m, label) => (m.stats.find(s => s.label === label) || {}).value || 0;
const statsText = m => m.stats.map(x => `${x.label} ${x.value}${x.pct ? '%' : ''}`).join(', ');

const GENS = [];
const gen = (cat, tier, w, fn, opt = {}) => GENS.push({ cat, tier, w, fn, ...opt });

/* =====================================================================
 *  챔피언 스탯 · 교전
 * ===================================================================== */
gen('champ', 2, 2, async () => {
  const pool = withStats().filter(x => x.stats.attackdamage > 0 && x.stats.hp > 0 && typeof x.stats.armor === 'number');
  const a = pick(pool), b = pick(pool.filter(x => x.key !== a.key));
  const per = a.stats.attackdamage * dmgTaken(b.stats.armor), hits = Math.ceil(b.stats.hp / per);
  const wr = numericOptions(hits, [Math.ceil(b.stats.hp / a.stats.attackdamage), hits + 1, hits - 1, hits + 2, hits - 2], { step: 1 });
  return Q('champ', `레벨 1에서 아이템·룬·치명타 없이 ${J(a.name, '이')} 기본 공격만으로 ${J(b.name, '을')} 처치하려면 몇 대를 때려야 할까요?`, hits + '대', wr.map(x => x + '대'), {
    srcs: ['DD'], sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats'),
    explain: ex(`① ${b.name}의 방어력 ${fmt(b.stats.armor)} → 받는 물리 피해 배율 = 100 ÷ (100 + ${fmt(b.stats.armor)}) = ${n4(dmgTaken(b.stats.armor))}`,
      `② 평타 1대 피해 = ${a.name} 공격력 ${fmt(a.stats.attackdamage)} × ${n4(dmgTaken(b.stats.armor))} = ${n2(per)}`,
      `③ ${b.name} 체력 ${fmt(b.stats.hp)} ÷ ${n2(per)} = ${n2(b.stats.hp / per)} → 올림하면 ${hits}대`,
      `💡 방어력을 빼먹고 ${fmt(b.stats.hp)} ÷ ${fmt(a.stats.attackdamage)}로 계산하면 ${Math.ceil(b.stats.hp / a.stats.attackdamage)}대가 나와 실제보다 적게 잡게 됩니다. 1레벨 교전에서 몇 대 더 버티는지 감을 잡는 계산이에요.`) });
});
gen('champ', 2, 2, async () => {
  const k = pick(['hp', 'armor', 'spellblock', 'attackdamage']), n = pick([6, 9, 11, 13, 16, 18]);
  const pool = withStats().filter(x => typeof x.stats[k] === 'number' && typeof x.stats[k + 'perlevel'] === 'number');
  const c = pick(pool), rd = k === 'hp' ? Math.round : r1, v = rd(lvlStat(c, k, n));
  return Q('champ', `아이템과 룬이 없을 때 레벨 ${n} ${c.name}의 ${J(LV[k], '은')} 얼마일까요?`, fmt(v), numericOptions(v, pool.map(x => rd(lvlStat(x, k, n))), { decimals: 1 }).map(fmt), {
    srcs: ['DD'], sig: () => sigC(c.key, 'stats.' + k) + sigC(c.key, 'stats.' + k + 'perlevel'), champ: c.key,
    explain: ex(...lvlLines(c, k, n, LV[k]), `→ ${k === 'hp' ? '반올림' : '소수 첫째 자리'} ${fmt(v)}`, Math.abs(growthMul(n) - (n - 1)) > 0.05 ? `⚠️ 흔한 실수: 레벨당 성장치 × (레벨−1) = ${n2(c.stats[k + 'perlevel'] * (n - 1))}로 단순 계산하면 ${n2(c.stats[k] + c.stats[k + 'perlevel'] * (n - 1))}이 나와 틀립니다 (18레벨에서만 두 방식이 같아요).` : '⚠️ 18레벨은 성장 배수가 정확히 17이라 단순 계산과 결과가 같지만, 그 사이 레벨에서는 단순 계산이 틀립니다.', growthWhy()) });
});
gen('champ', 3, 2, async () => {
  const k = pick(['hp', 'armor', 'attackdamage']), n = pick([9, 11, 13, 16, 18]), th = k === 'hp' ? 50 : 3;
  const pool = withStats().filter(x => typeof x.stats[k + 'perlevel'] === 'number');
  const want = Math.random() < 0.6; let P = null;
  for (let i = 0; i < 500 && !P; i++) {
    const a = pick(pool), b = pick(pool); if (a === b || a.stats[k] <= b.stats[k]) continue;
    const an = lvlStat(a, k, n), bn = lvlStat(b, k, n);
    if ((an < bn) === want && Math.abs(an - bn) > 0.5) P = [a, b, an, bn];
  }
  if (!P) return null;
  const [a, b, an, bn] = P, { L, ans } = bucket5(a.name, b.name, an - bn, th, '높다');
  return Q('champ', `레벨 1에서는 ${a.name}의 ${J(LV[k], '이')} ${fmt(a.stats[k])}${josa(fmt(a.stats[k]), '으로')} ${b.name}(${fmt(b.stats[k])})보다 높습니다. 레벨 ${n}에서는 어떻게 될까요?`, ans, L.filter(x => x !== ans), {
    order: L, long: true, srcs: ['DD'], sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats'),
    explain: ex(...growthLines(n),
      `② ${a.name}: ${fmt(a.stats[k])} + ${fmt(a.stats[k + 'perlevel'])} × ${n2(growthMul(n))} = ${n2(an)}`,
      `③ ${b.name}: ${fmt(b.stats[k])} + ${fmt(b.stats[k + 'perlevel'])} × ${n2(growthMul(n))} = ${n2(bn)}`,
      `④ 차이 = ${n2(an)} − ${n2(bn)} = ${n2(Math.round(an * 100) / 100 - Math.round(bn * 100) / 100)} → 「${ans}」`,
      an < bn ? `💡 ${J(a.name, '은')} 레벨 1에서 앞서지만, 레벨당 성장치가 ${fmt(a.stats[k + 'perlevel'])}${josa(fmt(a.stats[k + 'perlevel']), '으로')} ${b.name}(${fmt(b.stats[k + 'perlevel'])})보다 작아서 레벨 ${n}에서는 역전당합니다. 초반에 강한 쪽은 이 레벨 전에 이득을 봐야 해요.`
        : `💡 ${a.name}${josa(a.name, '은')} 레벨 ${n}까지도 우위를 유지합니다. 성장치 차이가 레벨 1 격차를 뒤집기에는 부족해요.`) });
});
gen('champ', 2, 1, async () => {
  const n = pick([1, 6, 11, 18]), c = pick(withStats().filter(x => x.stats.armor && x.stats.armorperlevel != null));
  const ar = lvlStat(c, 'armor', n), red = Math.round((1 - dmgTaken(ar)) * 1000) / 10;
  const wr = [r1(ar), r1(ar / 2), Math.round((1 - dmgTaken(ar * 1.5)) * 1000) / 10, Math.round((1 - dmgTaken(ar * 0.6)) * 1000) / 10, Math.round((1 - dmgTaken(ar * 2)) * 1000) / 10].filter(x => x > 0 && x < 100 && x !== red);
  return Q('champ', `아이템이 없는 레벨 ${n} ${J(c.name, '은')} 방어력 덕분에 물리 피해를 몇 % 덜 받을까요?`, fmt(red) + '%', wr.map(x => fmt(x) + '%'), {
    srcs: ['DD'], sig: () => sigC(c.key, 'stats.armor') + sigC(c.key, 'stats.armorperlevel'), champ: c.key,
    explain: ex(n > 1 ? lvlLines(c, 'armor', n, '방어력') : `① 레벨 1 방어력 = ${fmt(c.stats.armor)}`,
      `④ 받는 피해 = 100 ÷ (100 + ${n2(ar)}) = ${n4(dmgTaken(ar))} → 피해 감소 = 1 − ${n4(dmgTaken(ar))} = ${fmt(red)}%`,
      `⚠️ 방어력 ${n2(ar)}${josa(n2(ar), '을')} 그대로 %로 읽는 실수(${n2(ar)}%)가 흔해요. 방어력은 높아질수록 1당 감소 효과가 줄어들지만, 물리 유효 체력은 방어력 1당 항상 1%씩 늘어납니다.`) });
});
gen('champ', 3, 1, async () => {
  const n = pick([6, 9, 11, 13, 16, 18]); const pool = withStats().filter(x => typeof x.stats.attackspeedperlevel === 'number' && x.stats.attackspeedperlevel > 0);
  const c = pick(pool), v = r1(c.stats.attackspeedperlevel * growthMul(n));
  return Q('champ', `${J(c.name, '이')} 레벨 ${n}까지 레벨업만으로 얻는 추가 공격 속도는 몇 %일까요?`, fmt(v) + '%', numericOptions(v, pool.map(x => r1(x.stats.attackspeedperlevel * growthMul(n))), { step: 1, decimals: 1 }).map(x => fmt(x) + '%'), {
    srcs: ['DD'], sig: () => sigC(c.key, 'stats.attackspeedperlevel'), champ: c.key,
    explain: ex(...growthLines(n), `② 추가 공격 속도 = 레벨당 ${fmt(c.stats.attackspeedperlevel)}% × ${n2(growthMul(n))} = ${fmt(v)}%`,
      Math.abs(growthMul(n) - (n - 1)) > 0.05 ? `⚠️ 단순히 ${fmt(c.stats.attackspeedperlevel)}% × ${n - 1} = ${n2(c.stats.attackspeedperlevel * (n - 1))}%로 계산하면 틀립니다.` : '',
      `💡 레벨업으로 얻는 공격 속도는 '추가 공격 속도'라서 아이템 공격 속도와 똑같이 합산됩니다.`) });
});
gen('champ', 5, 2, async () => {
  const n = pick([1, 6, 11, 16, 18]), pool = withStats().filter(x => x.stats.hp && x.stats.armor);
  const phys = Math.random() < 0.6, rk = phys ? 'armor' : 'spellblock', rl = phys ? '방어력' : '마법 저항력';
  const ehp = c => Math.round(lvlStat(c, 'hp', n) * (1 + lvlStat(c, rk, n) / 100));
  const cs = [], seen = new Set();
  for (const c of shuffle(pool.filter(x => typeof x.stats[rk] === 'number'))) { const v = ehp(c); if (seen.has(v)) continue; seen.add(v); cs.push([c, v]); if (cs.length >= OPTS) break; }
  if (cs.length < OPTS) return null; cs.sort((a, b) => b[1] - a[1]);
  const lines = cs.map(([c, v]) => `• ${c.name}: 체력 ${n2(lvlStat(c, 'hp', n))} × (1 + ${n2(lvlStat(c, rk, n))}/100) = ${v}`);
  return Q('champ', `아이템과 룬이 없는 레벨 ${n} 기준으로 ${phys ? '물리' : '마법'} 피해에 가장 단단한(유효 체력이 가장 높은) 챔피언은 누구일까요?`, cs[0][0].name, cs.slice(1).map(x => x[0].name), {
    srcs: ['DD'], sig: () => cs.map(([c]) => sigC(c.key, 'stats')).join(),
    explain: ex(`유효 체력 = 체력 × (1 + ${rl}/100). ${n > 1 ? `레벨 ${n} 스탯은 성장 배수 ${n2(growthMul(n))}로 계산했어요.` : ''}`, ...lines,
      (() => { const hpTop = [...cs].sort((a, b) => lvlStat(b[0], 'hp', n) - lvlStat(a[0], 'hp', n))[0][0], top = cs[0][0];
        return hpTop === top ? `💡 ${J(top.name, '은')} 체력도 가장 높고 ${rl}까지 반영해도 가장 단단합니다.`
          : `💡 체력만 보면 ${J(hpTop.name, '이')} 가장 높지만, ${J(rl, '을')} 함께 반영하면 ${J(top.name, '이')} 더 단단합니다. 체력 수치만 보고 판단하면 안 되는 이유예요.`; })()) });
});

/* =====================================================================
 *  스킬 · 쿨타임
 * ===================================================================== */
gen('skill', 2, 2, async () => {
  const d = await detailed(x => x.champ.stats && x.champ.stats.mp > 0 && x.spells.some(s => s.manaCost && s.manaCost[0] > 0), true); if (!d) return null;
  const c = d.champ, s = pick(d.spells.filter(x => x.manaCost && x.manaCost[0] > 0)), n = pick([1, 3, 6]);
  const lv = Math.min(s.manaCost.length, n === 1 ? 1 : n === 3 ? 2 : 3), cost = s.manaCost[lv - 1];
  const mp = lvlStat(c, 'mp', n), times = Math.floor(mp / cost);
  return Q('skill', `레벨 ${n} ${J(c.name, '이')} 마나가 가득 찬 상태에서 ${s.key} 「${s.name}」(${lv}레벨)만 연속으로 쓴다면 몇 번까지 쓸 수 있을까요? (마나 재생·아이템 제외)`, times + '번',
    numericOptions(times, [times + 1, times - 1, times + 2, Math.floor(c.stats.mp / cost)], { step: 1 }).map(x => x + '번'), {
    sig: () => sigS(d.key, s.key, 'manaCost') + sigC(c.key, 'stats.mp') + sigC(c.key, 'stats.mpperlevel'), needs: { d: [d.key] }, champ: c.key, srcs: srcOf([s.src.cost, 'DD']),
    explain: ex(n > 1 ? lvlLines(c, 'mp', n, '최대 마나') : `① 레벨 1 최대 마나 = ${fmt(c.stats.mp)}`,
      `④ ${n2(mp)} ÷ ${s.key} ${lv}레벨 소모량 ${fmt(cost)} = ${n2(mp / cost)} → 내림하면 ${times}번`,
      `💡 ${times}번 쓰고 나면 마나가 ${n2(mp - times * cost)} 남습니다. 라인에서 견제를 몇 번까지 할 수 있는지 이 계산으로 가늠할 수 있어요.`) });
}, { d: true });
gen('skill', 1, 1, async () => {
  const ok = s => s.range && s.range[0] >= 100 && s.range[0] < 5000;
  const d = await detailed(x => x.champ.stats && x.spells.some(ok), true); if (!d) return null;
  const s = pick(d.spells.filter(ok)), ar = d.champ.stats.attackrange, v = s.range[0] - ar;
  const pool = [...S.details.values()].filter(x => x.champ.stats).flatMap(x => x.spells.filter(ok).map(y => y.range[0] - x.champ.stats.attackrange));
  const lab = x => (x > 0 ? '+' : '') + fmt(x);
  const wrs = new Set(); for (const x of numericOptions(Math.abs(v) || 25, pool.map(Math.abs), { step: 25 })) wrs.add(lab(v >= 0 ? x : -x)); wrs.add(lab(-v));
  return Q('skill', `${d.champ.name}의 ${s.key} 「${s.name}」 사거리는 기본 공격 사거리보다 얼마나 길까요? (짧으면 −로 표시)`, lab(v), [...wrs].filter(x => x !== lab(v)), {
    sig: () => sigS(d.key, s.key, 'range') + sigC(d.key, 'stats.attackrange'), needs: { d: [d.key] }, champ: d.key, srcs: [s.src.range, 'DD'],
    explain: ex(`① ${s.key} 사거리 ${fmt(s.range[0])} − 기본 공격 사거리 ${fmt(ar)} = ${lab(v)}`,
      v > 0 ? `💡 이 스킬은 평타보다 ${fmt(v)} 멀리 닿습니다. 상대 평타 사거리 밖에서 이 스킬로 견제하는 게 기본 운영이에요.` : `💡 이 스킬은 평타보다 ${fmt(-v)} 짧아서, 쓰려면 평타 사거리 안으로 더 들어가야 합니다.`) });
}, { d: true });
gen('skill', 3, 2, async () => {
  const ds = await detailedMany(5, d => { const R = spellOf(d, 'R'); return cdOk(R) && R.cooldown[0] >= 20; }, true); if (ds.length < 2) return null;
  const [a, b] = ds, Ra = spellOf(a, 'R'), Rb = spellOf(b, 'R'); const lv = pick([1, 2, 3]);
  const ca = Ra.cooldown[Math.min(lv, Ra.cooldown.length) - 1], cb = Rb.cooldown[Math.min(lv, Rb.cooldown.length) - 1];
  if (ca === cb) return null; const v = Math.abs(ca - cb), first = ca < cb ? a : b, later = ca < cb ? b : a;
  return Q('skill', `한타에서 ${a.champ.name}${josa(a.champ.name, '과')} ${b.champ.name}${josa(b.champ.name, '이')} 동시에 ${lv}레벨 궁극기를 썼습니다. 스킬 가속이 없다면, 궁이 먼저 돌아오는 쪽은 상대보다 몇 초 먼저 궁을 다시 쓸 수 있을까요?`, sec(v),
    numericOptions(v, [ca, cb, Math.round(v / 2), v + 10, v + 20], { step: 5 }).map(sec), {
    srcs: srcOf([Ra.src.cooldown, Rb.src.cooldown]), sig: () => sigS(a.key, 'R', 'cooldown') + sigS(b.key, 'R', 'cooldown'), needs: { d: [a.key, b.key] },
    explain: ex(`① ${a.champ.name} R ${lv}레벨 쿨타임 ${sec(ca)}, ${b.champ.name} R ${lv}레벨 쿨타임 ${sec(cb)}`, `② 차이 = |${ca} − ${cb}| = ${sec(v)}`,
      `💡 ${first.champ.name}${josa(first.champ.name, '은')} 궁을 쓰고 ${sec(Math.min(ca, cb))} 뒤에 다시 쓸 수 있고, 그때부터 ${sec(v)} 동안은 ${later.champ.name}만 궁이 없습니다. 이 틈이 다음 교전을 걸 타이밍이에요.`) });
}, { d: true });
gen('skill', 3, 2, async () => {
  const I = await ensure('items'); const ahItems = I.list.filter(m => itemStat(m, '스킬 가속') > 0 && ['legendary', 'epic', 'boots'].includes(m.kind));
  if (!ahItems.length) return null;
  const d = await detailed(x => x.spells.some(s => cdOk(s) && s.cooldown[0] >= 3), true); if (!d) return null;
  const s = pick(d.spells.filter(x => cdOk(x) && x.cooldown[0] >= 3)), lv = rand(s.cooldown.length), base = s.cooldown[lv];
  const items = shuffle(ahItems).slice(0, 1 + rand(Math.min(2, ahItems.length))), ah = items.reduce((a, m) => a + itemStat(m, '스킬 가속'), 0);
  const v = r1(hasteCd(base, ah));
  const wr = [ah < 100 ? r1(base * (1 - ah / 100)) : null, r1(hasteCd(base, ah * 2)), r1(hasteCd(base, ah / 2)), r1(base - ah / 10), r1(hasteCd(base, ah) + 1), base].filter(x => x > 0 && x !== v);
  return Q('skill', `${d.champ.name}${josa(d.champ.name, '이')} ${items.map(m => m.name).join(' + ')}${josa(items.map(m => m.name).join(' + '), '을')} 샀습니다. 다른 가속이 없다면 ${s.key} 「${s.name}」(${lv + 1}레벨)의 재사용 대기시간은 몇 초일까요?`, sec(v), wr.map(sec), {
    srcs: [s.src.cooldown, 'DD'], sig: () => sigS(d.key, s.key, 'cooldown') + items.map(m => sigI(m.id, 'stats')).join(), needs: { d: [d.key] }, need: 'items',
    explain: ex(`① 스킬 가속 합계 = ${items.map(m => `${m.name} ${itemStat(m, '스킬 가속')}`).join(' + ')} = ${ah}`,
      `② 쿨타임 = 기본 ${fmt(base)}초 × 100 ÷ (100 + ${ah}) = ${fmt(base * 100)} ÷ ${100 + ah} = ${n2(hasteCd(base, ah))} → ${sec(v)}`,
      `③ 줄어든 비율 = ${ah} ÷ (100 + ${ah}) = ${pct(ah / (100 + ah))}`,
      ah < 100 ? `⚠️ 예전 '재사용 대기시간 감소' 방식으로 ${fmt(base)} × (1 − ${ah}%) = ${n2(base * (1 - ah / 100))}초라고 계산하면 틀립니다. 스킬 가속은 많이 쌓을수록 1당 감소율이 줄어들지만, 같은 시간 안에 스킬을 쓰는 횟수는 가속 1당 1%씩 늘어나요.` : '') });
}, { d: true, need: 'items' });
gen('skill', 4, 2, async () => {
  const I = await ensure('items'); const ahItems = I.list.filter(m => itemStat(m, '스킬 가속') > 0 && ['legendary', 'epic', 'boots'].includes(m.kind)); if (!ahItems.length) return null;
  const d = await detailed(x => { const R = spellOf(x, 'R'); return cdOk(R) && R.cooldown.length >= 3 && R.cooldown[0] >= 20; }, true); if (!d) return null;
  const R = spellOf(d, 'R'), base = R.cooldown[R.cooldown.length - 1];
  const items = shuffle(ahItems).slice(0, Math.min(3, ahItems.length)), ah = items.reduce((a, m) => a + itemStat(m, '스킬 가속'), 0);
  const cd = hasteCd(base, ah), times = Math.floor(600 / cd), noAh = Math.floor(600 / base);
  return Q('skill', `궁극기 ${R.cooldown.length}레벨인 ${J(d.champ.name, '이')} ${items.map(m => m.name).join(' + ')}${josa(items.map(m => m.name).join(' + '), '을')} 갖고 있습니다. 10분 동안 궁이 돌아올 때마다 바로 쓴다면, 첫 사용 뒤 최대 몇 번 더 쓸 수 있을까요? (시전 시간 제외)`, times + '번',
    numericOptions(times, [noAh, times + 1, times - 1, times + 2, ah < 100 ? Math.floor(600 / (base * (1 - ah / 100))) : times + 3], { step: 1 }).map(x => x + '번'), {
    srcs: [R.src.cooldown, 'DD'], sig: () => sigS(d.key, 'R', 'cooldown') + items.map(m => sigI(m.id, 'stats')).join(), needs: { d: [d.key] }, need: 'items',
    explain: ex(`① 스킬 가속 = ${items.map(m => `${m.name} ${itemStat(m, '스킬 가속')}`).join(' + ')} = ${ah}`,
      `② R ${R.cooldown.length}레벨 쿨타임 = ${fmt(base)} × 100 ÷ ${100 + ah} = ${n2(cd)}초`,
      `③ 600초 ÷ ${n2(cd)} = ${n2(600 / cd)} → 내림 ${times}번 (가속이 없으면 600 ÷ ${fmt(base)} = ${noAh}번)`,
      `💡 아이템의 스킬 가속 ${ah}만으로 10분에 궁을 ${times - noAh}번 더 씁니다. 같은 시간 동안 쓰는 횟수는 정확히 (100 + 가속)%, 즉 ${100 + ah}%가 돼요.`) });
}, { d: true, need: 'items' });

/* =====================================================================
 *  아이템 · 골드
 * ===================================================================== */
const itemOpt = { need: 'items' };
const statLabelPool = I => { const f = {}; I.list.forEach(m => m.stats.forEach(s => f[s.label] = (f[s.label] || 0) + 1)); return Object.keys(f).filter(k => f[k] >= 2); };
gen('item', 1, 1, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => x.kind === 'legendary' && x.fromSR.length));
  const z = I.byId.get(pick(m.fromSR)), v = m.total - z.total;
  return Q('item', `${J(z.name, '을')} 가진 상태에서 ${J(m.name, '을')} 완성하려면 골드가 얼마나 더 필요할까요?`, gold(v), numericOptions(v, [m.total, m.base, Math.round(v + z.total / 2), v + 100, v - 100], { step: 50 }).map(gold), {
    srcs: ['DD'], sig: () => sigI(m.id, 'total') + sigI(z.id, 'total'),
    explain: ex(`① ${m.name} 총 가격 ${m.total}`, `② 이미 가진 ${z.name} 가격 ${z.total}${josa(z.total, '은')} 그대로 인정됩니다`, `③ ${m.total} − ${z.total} = ${v}골드`, `💡 귀환 전에 이 금액이 모였는지 확인하면 완성 타이밍을 놓치지 않아요.`) });
}, itemOpt);
gen('item', 4, 2, async () => {
  const I = await ensure('items'); const n = pick([6, 9, 11, 13]);
  const phys = Math.random() < 0.6, rl = phys ? '방어력' : '마법 저항력', rk = phys ? 'armor' : 'spellblock';
  const c = pick(withStats().filter(x => typeof x.stats[rk] === 'number' && x.stats[rk + 'perlevel'] != null));
  const H = lvlStat(c, 'hp', n), A = lvlStat(c, rk, n), base = H * (1 + A / 100);
  const cand = I.list.filter(m => ['legendary', 'epic', 'basic'].includes(m.kind) && (itemStat(m, '체력') > 0 || itemStat(m, rl) > 0));
  const cs = [], seen = new Set();
  for (const m of shuffle(cand)) { const h = itemStat(m, '체력'), a = itemStat(m, rl); const gain = Math.round((H + h) * (1 + (A + a) / 100) - base); if (seen.has(gain)) continue; seen.add(gain); cs.push({ m, h, a, gain }); if (cs.length >= OPTS) break; }
  if (cs.length < OPTS) return null; cs.sort((x, y) => y.gain - x.gain);
  return Q('item', `아이템이 없는 레벨 ${n} ${J(c.name, '이')} 다음 중 하나를 산다면, ${phys ? '물리' : '마법'} 피해 기준 유효 체력이 가장 많이 늘어나는 아이템은 무엇일까요?`, cs[0].m.name, cs.slice(1).map(x => x.m.name), {
    long: true, srcs: ['DD'], sig: () => sigC(c.key, 'stats') + cs.map(x => sigI(x.m.id, 'stats')).join(), champ: c.key,
    explain: ex(`① 레벨 ${n} ${c.name}: 체력 ${n2(H)}, ${rl} ${n2(A)} → 유효 체력 ${n2(H)} × (1 + ${n2(A)}/100) = ${Math.round(base)}`,
      ...cs.map(x => `• ${x.m.name} (체력 +${x.h}, ${rl} +${x.a}): (${n2(H + x.h)}) × (1 + ${n2(A + x.a)}/100) − ${Math.round(base)} = +${x.gain}`),
      `💡 체력이 많은 챔피언에게는 ${rl}${josa(rl, '이')}, ${rl}${josa(rl, '이')} 높은 챔피언에게는 체력이 더 효율적입니다. 체력과 ${rl}${josa(rl, '을')} 균형 있게 올릴수록 유효 체력이 가장 많이 늘어요.`) });
}, itemOpt);
gen('item', 3, 1, async () => {
  const I = await ensure('items'); const adItems = I.list.filter(m => itemStat(m, '공격력') > 0 && ['legendary', 'epic', 'basic'].includes(m.kind)); if (!adItems.length) return null;
  const n = pick([1, 3, 6]), pool = withStats().filter(x => x.stats.attackdamage > 0 && x.stats.attackdamageperlevel != null && typeof x.stats.armor === 'number');
  const a = pick(pool), b = pick(pool.filter(x => x.key !== a.key)), it = pick(adItems);
  const AD = lvlStat(a, 'attackdamage', n) + itemStat(it, '공격력'), AR = lvlStat(b, 'armor', n), HP = lvlStat(b, 'hp', n);
  const per = AD * dmgTaken(AR), hits = Math.ceil(HP / per), noItem = Math.ceil(HP / (lvlStat(a, 'attackdamage', n) * dmgTaken(AR)));
  return Q('item', `${it.name}만 산 레벨 ${n} ${J(a.name, '이')} 아이템이 없는 같은 레벨 ${J(b.name, '을')} 기본 공격만으로 처치하려면 몇 대가 필요할까요? (치명타·룬 제외)`, hits + '대',
    numericOptions(hits, [noItem, Math.ceil(HP / AD), hits + 1, hits - 1, hits + 2], { step: 1 }).map(x => x + '대'), {
    long: false, srcs: ['DD'], sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats') + sigI(it.id, 'stats'),
    explain: ex(`① ${a.name} 공격력 = 레벨 ${n} 기본 ${n2(lvlStat(a, 'attackdamage', n))} + ${it.name} ${itemStat(it, '공격력')} = ${n2(AD)}`,
      `② ${b.name} 레벨 ${n}: 체력 ${n2(HP)}, 방어력 ${n2(AR)} → 받는 피해 배율 100 ÷ (100 + ${n2(AR)}) = ${n4(dmgTaken(AR))}`,
      `③ 평타 1대 = ${n2(AD)} × ${n4(dmgTaken(AR))} = ${n2(per)}`, `④ ${n2(HP)} ÷ ${n2(per)} = ${n2(HP / per)} → 올림 ${hits}대`,
      `💡 이 아이템이 없을 때는 ${noItem}대가 필요합니다. 아이템 하나로 줄어드는 평타 수가 바로 라인전 킬각이에요.`) });
}, itemOpt);
gen('item', 5, 2, async () => {
  const I = await ensure('items'); const pool = I.list.filter(x => x.eff && !x.isRef && ['legendary', 'epic', 'boots'].includes(x.kind));
  const cs = [], seen = new Set();
  for (const m of shuffle(pool)) { const e = Math.round(m.eff * 1000); if (seen.has(e)) continue; seen.add(e); cs.push(m); if (cs.length >= OPTS) break; }
  if (cs.length < OPTS) return null; cs.sort((a, b) => b.eff - a.eff);
  const labels = [...new Set(cs.flatMap(m => m.stats.map(s => s.label)))];
  return Q('item', '고유 효과를 빼고 능력치만 골드로 환산했을 때, 골드 효율이 가장 높은 아이템은 무엇일까요?', cs[0].name, cs.slice(1).map(x => x.name), {
    srcs: ['DD'], sig: () => cs.map(m => sigI(m.id, 'total') + sigI(m.id, 'stats')).join(),
    explain: ex(`① 능력치 1당 골드 가치 (모두 이번 패치 데이터에서 계산):`, ...labels.map(l => I.goldPer[l]).filter(Boolean).map(g => `   • ${g.label} 1 = ${n2(g.per)}골드 (${g.item}${g.how === 'derived' ? '에서 역산' : ' 기준'})`),
      `② 아이템별 능력치 가치 ÷ 가격:`, ...cs.map(m => `   • ${m.name}: ${m.stats.map(s => `${s.value}×${n2(I.goldPer[s.label].per)}`).join(' + ')} = ${Math.round(m.statValue)} ÷ ${m.total} = ${pct(m.eff)}`),
      `💡 100%를 넘으면 능력치만으로 가격 이상의 값어치를 합니다. 다만 고유 효과는 계산에서 빠져 있어요.`) });
}, itemOpt);
gen('item', 4, 1, async () => {
  const I = await ensure('items'); const pool = I.list.filter(x => x.eff && !x.isRef && ['legendary', 'epic'].includes(x.kind)); const m = pick(pool), v = Math.round(m.eff * 100);
  return Q('item', `고유 효과를 빼고 능력치만 기본 아이템 가격으로 환산하면, ${m.name}의 가치는 가격 대비 몇 %일까요?`, v + '%', numericOptions(v, pool.map(x => Math.round(x.eff * 100)), { step: 4 }).map(x => x + '%'), {
    img: m.icons, imgClass: 'icon sm', srcs: ['DD'], sig: () => sigI(m.id, 'total') + sigI(m.id, 'stats'),
    explain: ex(...m.stats.map(s => `• ${s.label} ${s.value} × ${n2(I.goldPer[s.label].per)}골드 = ${Math.round(s.value * I.goldPer[s.label].per)} (${I.goldPer[s.label].item}${I.goldPer[s.label].how === 'derived' ? '에서 역산' : ' 기준'})`),
      `합계 ${Math.round(m.statValue)}골드 ÷ 가격 ${m.total}골드 = ${v}%`) });
}, itemOpt);

/* =====================================================================
 *  소환사 주문
 * ===================================================================== */
const summOpt = { need: 'summ' };
gen('summ', 1, 2, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.cd >= 60 && !x.charge)), t = 2 + rand(12), sAt = rand(4) * 15, at = t * 60 + sAt, back = at + s.cd;
  return Q('summ', `상대가 ${mmss(at)}에 「${s.name}」${josa(s.name, '을')} 썼습니다. 소환사 주문 가속이 없다면 다시 쓸 수 있는 가장 빠른 시각은 언제일까요?`, mmss(back),
    [back - 30, back + 30, back - 60, back + 60, at + Math.round(s.cd / 2)].map(mmss), {
    srcs: [s.src.cd], sig: () => sigM(s.id),
    explain: ex(`① 「${s.name}」 쿨타임 ${sec(s.cd)} = ${mmss(s.cd)}`, `② ${mmss(at)} + ${mmss(s.cd)} = ${mmss(back)}`, `💡 채팅에 "${s.name} ${mmss(back).replace('분 ', ':').replace('초', '')}"처럼 돌아오는 시각을 적어 두면 팀 전체가 교전 타이밍을 맞출 수 있어요.`) });
}, summOpt);
gen('summ', 2, 2, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.cd >= 60 && !x.charge)), t = 3 + rand(15), sAt = rand(60), at = t * 60 + sAt;
  const passed = 20 + rand(Math.max(1, Math.floor(s.cd) - 40)), now = at + passed, left = s.cd - passed;
  return Q('summ', `상대 정글러가 ${mmss(at)}에 「${s.name}」${josa(s.name, '을')} 썼고, 지금은 ${mmss(now)}입니다. 다시 쓰기까지 몇 초 남았나요?`, sec(left),
    numericOptions(left, [passed, s.cd - left, left + 15, left - 15, left + 30], { step: 5 }).map(sec), {
    srcs: [s.src.cd], sig: () => sigM(s.id),
    explain: ex(`① 지난 시간 = ${mmss(now)} − ${mmss(at)} = ${passed}초`, `② 남은 시간 = 쿨타임 ${s.cd} − ${passed} = ${left}초`, `💡 ${left}초 안에 교전을 열면 상대는 「${s.name}」 없이 싸워야 합니다.`) });
}, summOpt);

/* =====================================================================
 *  룬
 * ===================================================================== */
const runeOpt = { need: 'runes' };
/* =====================================================================
 *  스킬 피해 (4단계) — 게임 데이터의 DataValues · mSpellCalculations 값만 사용
 * ===================================================================== */
const STAT_KO = { ap: '주문력', ad: '총 공격력', bad: '추가 공격력', bsad: '기본 공격력' };
const hasDmg = d => d.spells.some(s => s.dmg && s.dmg.length);
/** 피해 항목 이름에서 시전 단계·적중 구역을 읽어 문장으로 만든다 (모르면 게임 데이터 항목명과 순번만 보여 줌) */
function hitInfo(s, h) {
  const idx = s.dmg.indexOf(h) + 1, tot = s.dmg.length;
  const ORD = [[/(?:^|[^a-z])(?:first|1st)/i, 1], [/second|2nd|recast/i, 2], [/third|3rd/i, 3], [/fourth|4th/i, 4]];
  let step = (ORD.find(([re]) => re.test(h.name.replace(/([a-z])([A-Z])/g, '$1 $2'))) || [])[1];
  if (!step) { const m = /(?:[A-Za-z])([1-5])(?:Damage|Dmg)?$/.exec(h.name) || /^[QWER]([1-5])/.exec(h.name); if (m) step = +m[1]; }
  const words = String(h.name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  const area = words.some(w => ['sweet', 'sweetspot', 'center', 'centre', 'core', 'tip', 'inner'].includes(w)) ? '가장 효과가 큰 구역에 맞은 경우' : words.some(w => ['edge', 'outer', 'rim'].includes(w)) ? '가장자리에 맞은 경우' : '';
  const parts = [];
  if (tot > 1) parts.push(`총 ${tot}개 중 ${idx}번째`);
  if (step) parts.push(`${step}번째 시전(타격) 단계`);
  const where = parts.length ? `${parts.join(', ')}인 ` : '';
  return { idx, tot, step, area, where, tag: `「${h.name}」`, text: `${where}피해 항목 「${h.name}」${area ? `, ${area}` : ''}` };
}
const rankDmg = (h, r) => h.ranks[r - 1];
const dmgValue = (v, st) => v.flat + Object.entries(v.r).reduce((a, [k, c]) => a + c * (st[k] || 0), 0);
const kinds = v => Object.keys(v.r).filter(k => v.r[k]);
const pctC = x => +(x * 100).toFixed(2);
const dmgPick = async (pred = () => true) => {
  const ds = await detailedMany(6, d => hasDmg(d), true); if (!ds.length) return null;
  for (const d of ds) {
    const c = S.byKey.get(d.key) || d.champ; if (!c || !c.stats) continue;
    const cand = []; for (const s of d.spells) if (s.dmg) for (const h of s.dmg) for (let r = 1; r <= h.ranks.length; r++) if (pred(h.ranks[r - 1], h, s, c)) cand.push({ d, c, s, h, r });
    if (cand.length) return pick(cand);
  }
  return null;
};
const needsKey = x => ({ d: [x.d.key] });
const dmgSig = x => () => sigS(x.d.key, x.s.key, 'dmg');
const dmgNote = x => `※ 계산식은 게임 데이터의 「${x.h.name}」 항목이에요. 피해는 방어력·마법 저항력·피해 감소 효과를 적용하기 전 수치입니다.`;

gen('skill', 3, 3, async () => {
  const x = await dmgPick(v => kinds(v).length >= 1 && kinds(v).length <= 2); if (!x) return null;
  const { d, c, s, h, r } = x, v = rankDmg(h, r), hi = hitInfo(s, h), n = pick([3, 6, 9, 11, 13, 16]);
  const baseAD = lvlStat(c, 'attackdamage', n), st = {}, given = [];
  const usesAD = kinds(v).some(k => k !== 'ap');
  if (v.r.ap) { st.ap = pick([60, 100, 150, 200, 250, 300, 400, 500]); given.push(`주문력 ${st.ap}`); }
  if (usesAD) {
    const bonus = pick([20, 40, 60, 80, 100, 130, 160, 200]); st.bsad = baseAD; st.bad = bonus; st.ad = baseAD + bonus;
    given.push(`기본 공격력 ${n2(baseAD)}, 추가 공격력 ${bonus}(총 공격력 ${n2(baseAD + bonus)})`);
  }
  const ans = Math.round(dmgValue(v, st));
  const wrong = new Set();
  const add = t => { t = Math.round(t); if (t !== ans && t > 0) wrong.add(t); };
  if (r > 1) add(dmgValue(rankDmg(h, r - 1), st)); if (r < h.ranks.length) add(dmgValue(rankDmg(h, r + 1), st));
  add(v.flat);
  if (v.r.bad) add(dmgValue({ flat: v.flat, r: { ad: v.r.bad } }, st));
  if (v.r.ad) add(dmgValue({ flat: v.flat, r: { bad: v.r.ad } }, st));
  if (v.r.ap) add(v.flat + v.r.ap * st.ap * 2);
  const wr = [...wrong].slice(0, OPTS - 1); const pool = h.ranks.map(z => dmgValue(z, st));
  const opts = [...new Set([...wr, ...numericOptions(ans, pool, { step: Math.max(5, Math.round(ans * 0.04)) })])].filter(t => t !== ans).slice(0, OPTS - 1);
  const stepLines = kinds(v).map(k => `${STAT_KO[k]} ${fmt(k === 'ap' ? st.ap : k === 'ad' ? n2(st.ad) : k === 'bad' ? st.bad : n2(st.bsad))} × ${fmt(pctC(v.r[k]))}% = ${n2((k === 'ap' ? st.ap : st[k]) * v.r[k])}`);
  return Q('skill', `레벨 ${n} ${J(d.champ.name, '이')} ${s.key} 「${s.name}」 ${r}레벨로 ${hi.text}에 해당하는 피해를 한 번 적중시켰습니다. ${given.join(', ')}일 때 들어가는 피해는 얼마일까요? (방어력·마법 저항력 적용 전, 반올림)`,
    fmt(ans), opts.map(fmt), {
      long: true, sig: dmgSig(x), needs: needsKey(x), champ: d.key, srcs: ['CDG', 'DD'],
      explain: ex(`① ${r}레벨 기본 피해: ${fmt(v.flat)}`, '② 계수 적용:', ...stepLines.map(l => `• ${l}`),
        `③ 합계: ${fmt(v.flat)} + ${kinds(v).map(k => n2((k === 'ap' ? st.ap : st[k]) * v.r[k])).join(' + ')} = ${n2(dmgValue(v, st))} → 반올림 ${fmt(ans)}`,
        usesAD ? `💡 계수가 「추가 공격력」이면 기본 공격력은 빼고 템·룬으로 늘어난 공격력만 곱합니다. 총 공격력과 헷갈리는 게 가장 흔한 실수예요. (이 문제의 기본 공격력은 레벨 ${n}의 ${n2(baseAD)})` : '💡 주문력 계수 스킬은 주문력 아이템 한 개를 사면 계수만큼 피해가 늘어납니다. 기본 피해는 스킬 레벨로만 오릅니다.',
        hi.tot > 1 ? `💡 같은 스킬이라도 ${hi.tot}개 항목 중 어느 쪽인지에 따라 값이 다릅니다. 이 문제는 「${h.name}」 기준이에요.` : '', dmgNote(x)) });
}, { d: true });

gen('skill', 4, 3, async () => {
  const I = await ensure('items');
  const items = I.list.filter(m => ['legendary', 'epic', 'basic'].includes(m.kind) && (itemStat(m, '공격력') > 0 || itemStat(m, '주문력') > 0)
    && !/공격력|주문력/.test(strip((m.desc || '').replace(/<stats>[\s\S]*?<\/stats>/i, ''))));
  if (items.length < 2) return null;
  const x = await dmgPick(v => kinds(v).length >= 1); if (!x) return null;
  const { d, c, s, h, r } = x, v = rankDmg(h, r), hi = hitInfo(s, h), n = pick([6, 9, 11, 13, 16]);
  const fit = items.filter(m => (v.r.ap && itemStat(m, '주문력') > 0) || ((v.r.ad || v.r.bad) && itemStat(m, '공격력') > 0));
  if (!fit.length) return null;
  const bought = shuffle(fit).slice(0, Math.random() < 0.5 ? 1 : 2);
  const AP = bought.reduce((a, m) => a + itemStat(m, '주문력'), 0), BAD = bought.reduce((a, m) => a + itemStat(m, '공격력'), 0);
  const baseAD = lvlStat(c, 'attackdamage', n), st = { ap: AP, bad: BAD, bsad: baseAD, ad: baseAD + BAD };
  const val = (vv, o = st) => dmgValue(vv, o), ans = Math.round(val(v));
  const none = Math.round(val(v, { ap: 0, bad: 0, bsad: baseAD, ad: baseAD }));
  if (ans === none) return null;
  const wrong = new Set(); const add = t => { t = Math.round(t); if (t !== ans && t > 0) wrong.add(t); };
  add(none); add(v.flat); if (r > 1) add(val(rankDmg(h, r - 1))); if (r < h.ranks.length) add(val(rankDmg(h, r + 1)));
  if (v.r.ad || v.r.bad) add(val({ flat: v.flat, r: { ad: v.r.bad || v.r.ad } }, { ad: baseAD + BAD, bad: baseAD + BAD }) );
  const pool = bought.length > 1 ? [val(v, { ...st, ap: AP - itemStat(bought[1], '주문력'), bad: BAD - itemStat(bought[1], '공격력'), ad: baseAD + BAD - itemStat(bought[1], '공격력') })] : [];
  const opts = [...new Set([...wrong, ...numericOptions(ans, pool.map(Math.round).concat(h.ranks.map(z => Math.round(val(z)))), { step: Math.max(5, Math.round(ans * 0.04)) })])].filter(t => t !== ans).slice(0, OPTS - 1);
  const names = bought.map(m => m.name).join(' + ');
  const stepLines = kinds(v).map(k => { const sv = k === 'ap' ? AP : k === 'bad' ? BAD : k === 'ad' ? baseAD + BAD : baseAD; return `${STAT_KO[k]} ${n2(sv)} × ${fmt(pctC(v.r[k]))}% = ${n2(sv * v.r[k])}`; });
  return Q('skill', `레벨 ${n} ${J(d.champ.name, '이')} 아이템으로 ${names}만 가지고 있습니다. ${s.key} 「${s.name}」 ${r}레벨로 ${hi.text}에 해당하는 피해를 한 번 적중시키면 들어가는 피해는 얼마일까요? (룬·아이템 고유 효과·방어력과 마법 저항력은 무시, 반올림)`,
    fmt(ans), opts.map(fmt), {
      long: true, need: 'items', sig: () => dmgSig(x)() + bought.map(m => sigI(m.id, 'stats')).join(), needs: needsKey(x), champ: d.key, srcs: ['CDG', 'DD'],
      explain: ex(`① 아이템 능력치: ${bought.map(m => `${m.name}(${statsText(m)})`).join(' + ')} → 주문력 ${AP}, 추가 공격력 ${BAD}`,
        `② ${r}레벨 기본 피해 ${fmt(v.flat)}에 계수 적용:`, ...stepLines.map(l => `• ${l}`),
        `③ 합계: ${fmt(v.flat)} + ${kinds(v).map(k => { const sv = k === 'ap' ? AP : k === 'bad' ? BAD : k === 'ad' ? baseAD + BAD : baseAD; return n2(sv * v.r[k]); }).join(' + ')} = ${n2(val(v))} → 반올림 ${fmt(ans)}`,
        `비교: 아이템이 없을 때는 ${fmt(none)}이므로 이 아이템으로 피해가 ${fmt(ans - none)} 늘었습니다.`,
        (v.r.ad || v.r.bsad) ? `💡 레벨 ${n} 기본 공격력은 ${n2(baseAD)}이고, 계수 종류(총/추가/기본)에 따라 곱하는 값이 달라집니다.` : '💡 주문력 계수 스킬은 아이템 하나가 곧 계수만큼의 피해 증가로 이어집니다. 아이템 가격 대비 피해 증가를 비교할 때 쓰는 계산이에요.', dmgNote(x)) });
}, { d: true, need: 'items' });

/* =====================================================================
 *  고난도 계산 문제 (마스터 이상) — 수치는 전부 DD/CD/게임 데이터, 코드에는 공식만
 * ===================================================================== */
const LVS = [6, 8, 9, 11, 13, 14, 16, 18];
const LV = { hp: '체력', armor: '방어력', spellblock: '마법 저항력', attackdamage: '공격력', mp: '마나' };
const armorItems = I => I.list.filter(m => ['legendary', 'epic', 'basic'].includes(m.kind) && itemStat(m, '방어력') > 0);
const adItemsOf = I => I.list.filter(m => ['legendary', 'epic', 'basic'].includes(m.kind) && itemStat(m, '공격력') > 0);
const asItemsOf = I => I.list.filter(m => ['legendary', 'epic', 'basic', 'boots'].includes(m.kind) && itemStat(m, '공격 속도') > 0);
const penArmor = (ar, p, f) => Math.max(0, ar * (1 - p / 100) - f);
const intOpts = (ans, cands, step) => [...new Set([...cands.map(Math.round), ...numericOptions(ans, [], { step })])].filter(x => x !== ans && x > 0);
/** 공격 속도 = 기본 + 공속 계수 × 추가 공속%(레벨 성장 + 아이템) */
const asAt = (c, d, n, itemPct) => {
  const bonus = (c.stats.attackspeedperlevel || 0) * growthMul(n) + itemPct;
  return { bonus, ratio: d.asRatio, as: c.stats.attackspeed + d.asRatio * bonus / 100 };
};
const AS_CAP = 2.5;

/* 관통 후 평타 피해 */
gen('champ', 3, 3, async () => {
  const I = await ensure('items'); const AI = adItemsOf(I), RI = armorItems(I); if (!AI.length || !RI.length) return null;
  const pool = withStats().filter(x => x.stats.attackdamageperlevel != null && x.stats.armorperlevel != null);
  const a = pick(pool), b = pick(pool.filter(x => x.key !== a.key)), n = pick(LVS), m = pick(LVS);
  const ia = pick(AI), ib = Math.random() < 0.6 ? pick(RI) : null;
  const p = pick([18, 25, 30, 35, 40]), f = pick([0, 8, 10, 15, 18, 22, 26]);
  const AD = lvlStat(a, 'attackdamage', n) + itemStat(ia, '공격력');
  const AR = lvlStat(b, 'armor', m) + (ib ? itemStat(ib, '방어력') : 0), eff = penArmor(AR, p, f);
  const ans = Math.round(AD * dmgTaken(eff));
  const wrong = intOpts(ans, [AD * dmgTaken(AR), AD * dmgTaken(Math.max(0, (AR - f) * (1 - p / 100))), AD * dmgTaken(Math.max(0, AR * (1 - p / 100))), AD * dmgTaken(Math.max(0, AR - f)), AD * (1 - eff / 100)], 3);
  return Q('champ', `레벨 ${n} ${J(a.name, '이')} ${ia.name}만 들고, ${ib ? `${ib.name}만 든` : '아이템이 없는'} 레벨 ${m} ${b.name}에게 평타를 칩니다. ${a.name}에게 방어구 관통력 ${p}%와 물리 관통력 ${J(f, '이')} 있다면 평타 1대의 실제 피해는 얼마일까요? (치명타·룬 제외, 반올림)`,
    fmt(ans), wrong.map(fmt), {
      long: true, need: 'items', srcs: ['DD'], champ: a.key, sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats') + sigI(ia.id, 'stats') + (ib ? sigI(ib.id, 'stats') : ''),
      explain: ex(`① ${a.name} 공격력 = 레벨 ${n} 기본 ${n2(lvlStat(a, 'attackdamage', n))} + ${ia.name} ${itemStat(ia, '공격력')} = ${n2(AD)}`,
        `② ${b.name} 방어력 = 레벨 ${m} 기본 ${n2(lvlStat(b, 'armor', m))}${ib ? ` + ${ib.name} ${itemStat(ib, '방어력')}` : ''} = ${n2(AR)}`,
        `③ 관통 적용 순서: % 관통 먼저, 고정 관통은 나중 → ${n2(AR)} × (1 − ${p}%) − ${f} = ${n2(AR * (1 - p / 100))} − ${f} = ${n2(eff)}${AR * (1 - p / 100) - f < 0 ? ' (0 아래로는 내려가지 않아요)' : ''}`,
        `④ 받는 피해 배율 = 100 ÷ (100 + ${n2(eff)}) = ${n4(dmgTaken(eff))}`,
        `⑤ ${n2(AD)} × ${n4(dmgTaken(eff))} = ${n2(AD * dmgTaken(eff))} → ${fmt(ans)}`,
        `⚠️ 고정 관통을 먼저 빼면 ${J(Math.round(AD * dmgTaken(Math.max(0, (AR - f) * (1 - p / 100)))), '으로')} 계산돼 틀립니다. 관통이 없으면 ${Math.round(AD * dmgTaken(AR))}입니다.`,
        `💡 상대 방어력이 높을수록 % 관통의 가치가, 낮을수록 고정 관통의 가치가 커집니다.`) });
}, { need: 'items' });

/* % 관통 vs 고정 관통 선택 */
gen('champ', 4, 2, async () => {
  const pool = withStats().filter(x => x.stats.armorperlevel != null);
  const b = pick(pool), m = pick(LVS), I = await ensure('items'), RI = armorItems(I);
  const ib = RI.length && Math.random() < 0.7 ? pick(RI) : null;
  const AR = lvlStat(b, 'armor', m) + (ib ? itemStat(ib, '방어력') : 0);
  const combos = [], seen = new Set();
  for (const x of shuffle([[0, 10], [0, 18], [0, 26], [0, 32], [20, 0], [25, 0], [30, 0], [35, 0], [40, 0], [30, 10], [18, 18], [25, 12], [35, 8], [20, 20], [40, 5]])) {
    const e = r1(penArmor(AR, x[0], x[1])); if (seen.has(e)) continue; seen.add(e); combos.push({ p: x[0], f: x[1], e }); if (combos.length >= OPTS) break;
  }
  if (combos.length < OPTS) return null; combos.sort((x, y) => x.e - y.e);
  const lab = x => [x.p ? `방어구 관통력 ${x.p}%` : '', x.f ? `물리 관통력 ${x.f}` : ''].filter(Boolean).join(' + ');
  return Q('champ', `${ib ? `${ib.name}만 든` : '아이템이 없는'} 레벨 ${m} ${b.name}에게 물리 피해를 가장 많이 넣을 수 있는 관통 조합은 무엇일까요?`, lab(combos[0]), combos.slice(1).map(lab), {
    long: true, need: 'items', srcs: ['DD'], champ: b.key, sig: () => sigC(b.key, 'stats') + (ib ? sigI(ib.id, 'stats') : ''),
    explain: ex(`① ${b.name} 방어력 = 레벨 ${m} 기본 ${n2(lvlStat(b, 'armor', m))}${ib ? ` + ${ib.name} ${itemStat(ib, '방어력')}` : ''} = ${n2(AR)}`,
      '② 조합별 남는 방어력 (% 관통 → 고정 관통 순서) / 받는 피해 배율:',
      ...combos.map(x => `• ${lab(x)}: ${n2(AR)} × (1 − ${x.p}%) − ${x.f} = ${fmt(x.e)} → ${pct(dmgTaken(x.e))}`),
      `💡 방어력 ${n2(AR)} 기준으로는 「${lab(combos[0])}」가 가장 많이 깎습니다. 상대 방어력이 바뀌면 순위도 바뀌니, 탱커가 많은 판인지 보고 관통 아이템을 고르세요.`) });
}, { need: 'items' });

/* 평타 DPS (게임 데이터의 공속 계수 사용) */
gen('champ', 4, 2, async () => {
  const I = await ensure('items'); const SI = asItemsOf(I); if (!SI.length) return null;
  const d = await detailed(x => x.asRatio > 0 && x.champ.stats && x.champ.stats.attackspeed > 0, true); if (!d) return null;
  const c = S.byKey.get(d.key) || d.champ, n = pick(LVS), its = shuffle(SI).slice(0, 1 + rand(2));
  const itemPct = its.reduce((a, m) => a + itemStat(m, '공격 속도'), 0), bad = its.reduce((a, m) => a + itemStat(m, '공격력'), 0);
  const A = asAt(c, d, n, itemPct); if (A.as > AS_CAP) return null;
  const AD = lvlStat(c, 'attackdamage', n) + bad, dps = AD * A.as, ans = Math.round(dps);
  const naive = AD * (c.stats.attackspeed * (1 + A.bonus / 100));
  const wrong = intOpts(ans, [naive, AD * (c.stats.attackspeed + A.bonus / 100), lvlStat(c, 'attackdamage', n) * A.as, AD * asAt(c, d, n, 0).as, AD * c.stats.attackspeed], 3);
  const names = its.map(m => m.name).join(' + ');
  return Q('champ', `레벨 ${n} ${J(c.name, '이')} ${names}만 가지고 있습니다. 치명타 없이 평타만 칠 때 초당 피해(DPS)는 얼마일까요? (방어력 적용 전, 반올림)`, fmt(ans), wrong.map(fmt), {
    long: true, need: 'items', needs: { d: [d.key] }, champ: c.key, srcs: ['CDG', 'DD'], sig: () => sigC(c.key, 'stats') + its.map(m => sigI(m.id, 'stats')).join(),
    explain: ex(`① 추가 공격 속도 = 레벨 성장 ${fmt(c.stats.attackspeedperlevel)}% × ${n2(growthMul(n))} + 아이템 ${itemPct}% = ${n2(A.bonus)}%`,
      `② 공격 속도 = 기본 ${fmt(c.stats.attackspeed)} + 공속 계수 ${fmt(A.ratio)} × ${n2(A.bonus)}% = ${n4(A.as)}`,
      bad ? `③ 공격력 = 레벨 ${n} 기본 ${n2(lvlStat(c, 'attackdamage', n))} + 아이템 ${bad} = ${n2(AD)}` : `③ 공격력 = 레벨 ${n} 기본 ${n2(AD)} (아이템 공격력 없음)`,
      `④ DPS = ${n2(AD)} × ${n4(A.as)} = ${n2(dps)} → ${fmt(ans)}`,
      Math.abs(A.ratio - c.stats.attackspeed) > 1e-6 ? `⚠️ ${c.name}의 공속 계수(${fmt(A.ratio)})는 기본 공격 속도(${fmt(c.stats.attackspeed)})와 달라요. 기본 공속에 그대로 %를 곱하면 ${Math.round(naive)}로 틀립니다.` : `💡 ${J(c.name, '은')} 공속 계수와 기본 공속이 같아서, 기본 공속 × (1 + 추가 %)로 계산해도 결과가 같아요.`,
      `※ 공속 계수는 CommunityDragon 게임 데이터(attackSpeedRatio) 값입니다. 공격 속도 상한(${AS_CAP})을 넘는 경우는 출제하지 않아요.`) });
}, { d: true, need: 'items' });

/* 평타로 처치하는 데 걸리는 시간 */
gen('champ', 5, 2, async () => {
  const I = await ensure('items'); const AI = adItemsOf(I), SI = asItemsOf(I); if (!AI.length || !SI.length) return null;
  const d = await detailed(x => x.asRatio > 0 && x.champ.stats && x.champ.stats.attackspeed > 0, true); if (!d) return null;
  const a = S.byKey.get(d.key) || d.champ, b = pick(withStats().filter(x => x.key !== a.key && x.stats.armorperlevel != null));
  const n = pick(LVS), m = pick(LVS), it1 = pick(AI), s2 = SI.filter(x => x.id !== it1.id), it2 = s2.length ? pick(s2) : null;
  const its = [it1, it2].filter(Boolean), itemPct = its.reduce((s, m2) => s + itemStat(m2, '공격 속도'), 0), bad = its.reduce((s, m2) => s + itemStat(m2, '공격력'), 0);
  const A = asAt(a, d, n, itemPct); if (A.as > AS_CAP) return null;
  const AD = lvlStat(a, 'attackdamage', n) + bad, AR = lvlStat(b, 'armor', m), HP = lvlStat(b, 'hp', m);
  const per = AD * dmgTaken(AR), hits = Math.ceil(HP / per), t = (hits - 1) / A.as, ans = r1(t);
  if (hits < 3) return null;
  const wrong = [r1(hits / A.as), r1((hits - 2) / A.as), r1(HP / (per * A.as)), r1(Math.ceil(HP / AD - 1) / A.as), r1(hits / A.as + 0.5)].filter(x => x !== ans && x > 0);
  const names = its.map(x => x.name).join(' + ');
  return Q('champ', `레벨 ${n} ${J(a.name, '이')} ${names}만 들고, 아이템이 없는 레벨 ${m} ${J(b.name, '을')} 평타로만 처치하려고 합니다. 첫 평타가 0초에 들어간다면 마지막 평타는 몇 초에 들어갈까요? (치명타·재생 제외, 소수 첫째 자리)`,
    sec(ans), [...new Set(wrong)].map(sec), {
      long: true, need: 'items', needs: { d: [d.key] }, champ: a.key, srcs: ['CDG', 'DD'], sig: () => sigC(a.key, 'stats') + sigC(b.key, 'stats') + its.map(x => sigI(x.id, 'stats')).join(),
      explain: ex(`① 공격력 ${n2(AD)}, 공격 속도 = ${fmt(a.stats.attackspeed)} + ${fmt(A.ratio)} × ${n2(A.bonus)}% = ${n4(A.as)}`,
        `② ${b.name}: 체력 ${n2(HP)}, 방어력 ${n2(AR)} → 평타 1대 = ${n2(AD)} × 100 ÷ (100 + ${n2(AR)}) = ${n2(per)}`,
        `③ 필요한 평타 = ${n2(HP)} ÷ ${n2(per)} = ${n2(HP / per)} → 올림 ${hits}대`,
        `④ 평타 간격 = 1 ÷ ${n4(A.as)} = ${n4(1 / A.as)}초 → 마지막 평타 시각 = (${hits} − 1) × ${n4(1 / A.as)} = ${n2(t)} → ${sec(ans)}`,
        `⚠️ ${hits} × 간격으로 계산하면 ${sec(r1(hits / A.as))}가 나옵니다. 첫 평타는 0초에 들어가므로 간격은 ${hits - 1}번뿐이에요.`,
        `💡 이 시간이 상대 CC 지속시간이나 아군 합류 시간보다 짧은지 비교하면, 들어갈지 말지를 숫자로 판단할 수 있어요.`) });
}, { d: true, need: 'items' });

/* 추격: 신발 이속 차이로 거리 좁히기 */
gen('champ', 4, 1, async () => {
  const I = await ensure('items'); const B = I.list.filter(m => m.kind === 'boots' && itemStat(m, '이동 속도') > 0); if (!B.length) return null;
  const pool = withStats().filter(x => x.stats.movespeed > 0);
  for (let i = 0; i < 30; i++) {
    const a = pick(pool), b = pick(pool.filter(x => x.key !== a.key)), bootA = pick(B), bootB = Math.random() < 0.5 ? pick(B) : null;
    const va = a.stats.movespeed + itemStat(bootA, '이동 속도'), vb = b.stats.movespeed + (bootB ? itemStat(bootB, '이동 속도') : 0);
    if (va > 415 || vb > 415 || va - vb < 5) continue;   // 415 초과 구간은 이동 속도 감쇠가 걸려서 제외
    const D = pick([150, 200, 300, 400, 500]), t = D / (va - vb), ans = r1(t);
    const wrong = [r1(D / va), r1(D / vb), r1(D / (va - vb) / 2), r1(t + 1), r1(D / (a.stats.movespeed - b.stats.movespeed || 1))].filter(x => x > 0 && x !== ans);
    return Q('champ', `${bootA.name}${josa(bootA.name, '을')} 신은 ${J(a.name, '이')} ${bootB ? `${bootB.name}${josa(bootB.name, '을')} 신은` : '신발이 없는'} ${J(b.name, '을')} 쫓고 있습니다. 둘 사이 거리가 ${D}이고 둘 다 일직선으로 달린다면 몇 초 뒤에 따라잡을까요? (다른 이동 속도 효과 없음, 소수 첫째 자리)`,
      sec(ans), [...new Set(wrong)].map(sec), {
        long: true, need: 'items', srcs: ['DD'], champ: a.key, sig: () => sigC(a.key, 'stats.movespeed') + sigC(b.key, 'stats.movespeed') + sigI(bootA.id, 'stats') + (bootB ? sigI(bootB.id, 'stats') : ''),
        explain: ex(`① ${a.name} 이동 속도 = ${fmt(a.stats.movespeed)} + ${itemStat(bootA, '이동 속도')} = ${va}`,
          bootB ? `② ${b.name} 이동 속도 = ${fmt(b.stats.movespeed)} + ${itemStat(bootB, '이동 속도')} = ${vb}` : `② ${b.name} 이동 속도 = ${vb} (신발 없음)`,
          `③ 좁혀지는 속도 = ${va} − ${vb} = ${va - vb} (초당)`, `④ ${D} ÷ ${va - vb} = ${n2(t)} → ${sec(ans)}`,
          `💡 이속 차이가 ${va - vb}뿐이라 거리 ${D}${josa(D, '을')} 좁히는 데 ${sec(ans)}가 걸립니다. 둔화나 점멸 없이 추격할지 판단할 때 이 숫자를 보세요.`) });
  }
  return null;
}, { need: 'items' });

/* 스킬 가속 목표치 */
gen('skill', 3, 2, async () => {
  const d = await detailed(x => x.spells.some(s => cdOk(s) && s.cooldown[0] >= 4), true); if (!d) return null;
  const s = pick(d.spells.filter(x => cdOk(x) && x.cooldown[0] >= 4)), lv = rand(s.cooldown.length), base = s.cooldown[lv];
  const target = r1(base * pick([0.55, 0.6, 0.65, 0.7, 0.75, 0.8])); if (target <= 0 || target >= base) return null;
  const need = Math.ceil(100 * (base / target - 1) - 1e-9);
  const wrong = intOpts(need, [100 * (1 - target / base), need + 5, need - 5, (base - target) * 10, need + 10], 3);
  return Q('skill', `${d.champ.name}의 ${s.key} 「${s.name}」(${lv + 1}레벨) 재사용 대기시간을 ${sec(target)} 이하로 만들려면 스킬 가속이 최소 얼마 필요할까요?`, fmt(need), wrong.map(fmt), {
    needs: { d: [d.key] }, champ: d.key, srcs: [s.src.cooldown], sig: () => sigS(d.key, s.key, 'cooldown'),
    explain: ex(`① 공식: 쿨타임 = 기본 × 100 ÷ (100 + 가속) → 가속 = 100 × (기본 ÷ 목표 − 1)`,
      `② 100 × (${fmt(base)} ÷ ${fmt(target)} − 1) = 100 × ${n4(base / target - 1)} = ${n2(100 * (base / target - 1))} → 올림 ${need}`,
      `③ 확인: ${fmt(base)} × 100 ÷ (100 + ${need}) = ${n2(hasteCd(base, need))}초 ≤ ${fmt(target)}초`,
      `⚠️ '쿨감 %'처럼 (1 − ${fmt(target)}/${fmt(base)}) × 100으로 계산하면 ${Math.round(100 * (1 - target / base))}이 나와 부족합니다.`, wasNote(s)) });
}, { d: true });

/* 한 교전 시간 동안 스킬 사용 횟수 */
gen('skill', 3, 2, async () => {
  const I = await ensure('items'); const AH = I.list.filter(m => itemStat(m, '스킬 가속') > 0 && ['legendary', 'epic', 'boots'].includes(m.kind)); if (!AH.length) return null;
  const d = await detailed(x => x.spells.some(s => s.key !== 'R' && cdOk(s)), true); if (!d) return null;
  const s = pick(d.spells.filter(x => x.key !== 'R' && cdOk(x))), lv = s.cooldown.length, base = s.cooldown[lv - 1];
  const its = shuffle(AH).slice(0, 1 + rand(2)), ah = its.reduce((a, m) => a + itemStat(m, '스킬 가속'), 0), cd = hasteCd(base, ah);
  const T = pick([10, 12, 15, 20, 25, 30]); if (cd >= T) return null;
  const ans = Math.floor(T / cd + 1e-9) + 1;
  const wrong = intOpts(ans, [Math.floor(T / cd), Math.floor(T / base) + 1, Math.floor(T / (base * (1 - ah / 100))) + 1, ans + 1, ans + 2], 1);
  const names = its.map(m => m.name).join(' + ');
  return Q('skill', `${s.key} 「${s.name}」${josa(s.name, '을')} ${lv}레벨(최대)까지 올린 ${J(d.champ.name, '이')} ${names}만 가지고 있습니다. 교전 시작(0초)에 바로 쓰고 쿨이 돌 때마다 쓴다면 ${T}초 교전 동안 몇 번 쓸 수 있을까요? (${T}초 시점 포함)`,
    ans + '번', wrong.map(x => x + '번'), {
      long: true, need: 'items', needs: { d: [d.key] }, champ: d.key, srcs: srcOf([s.src.cooldown, 'DD']), sig: () => sigS(d.key, s.key, 'cooldown') + its.map(m => sigI(m.id, 'stats')).join(),
      explain: ex(`① 스킬 가속 = ${its.map(m => `${m.name} ${itemStat(m, '스킬 가속')}`).join(' + ')} = ${ah}`,
        `② 쿨타임 = ${fmt(base)} × 100 ÷ (100 + ${ah}) = ${n2(cd)}초`,
        `③ 사용 시각: 0초${Array.from({ length: ans - 1 }, (_, i) => `, ${n2(cd * (i + 1))}초`).join('')} → ${T}초 안에 ${ans}번`,
        `⚠️ ${T} ÷ ${n2(cd)} = ${n2(T / cd)}만 보고 ${Math.floor(T / cd)}번이라고 하면 0초에 쓴 첫 번째를 빠뜨린 거예요.`, wasNote(s)) });
}, { d: true, need: 'items' });

/* 마나 재생으로 다음 스킬까지 걸리는 시간 */
gen('skill', 3, 1, async () => {
  const d = await detailed(x => x.champ.stats && x.champ.stats.mpregen > 0 && x.spells.some(s => s.manaCost && s.manaCost[0] > 0), true); if (!d) return null;
  const c = S.byKey.get(d.key) || d.champ, s = pick(d.spells.filter(x => x.manaCost && x.manaCost[0] > 0)), n = pick([3, 5, 6, 8, 9, 11]);
  const lv = Math.min(s.manaCost.length, Math.ceil(n / 2)), cost = s.manaCost[lv - 1], reg = lvlStat(c, 'mpregen', n), t = cost / (reg / 5), ans = r1(t);
  const wrong = [r1(cost / reg), r1(cost / (c.stats.mpregen / 5)), r1(t * 5 / 4), r1(t + 2), r1(cost / reg * 5 / 2)].filter(x => x > 0 && x !== ans);
  return Q('skill', `마나가 0인 레벨 ${n} ${J(c.name, '이')} 기본 마나 재생만으로 ${s.key} 「${s.name}」(${lv}레벨, 마나 ${fmt(cost)})${josa(s.name, '을')} 다시 쓸 마나를 모으려면 몇 초가 걸릴까요? (아이템·룬 제외, 소수 첫째 자리)`,
    sec(ans), [...new Set(wrong)].map(sec), {
      long: true, needs: { d: [d.key] }, champ: c.key, srcs: srcOf([s.src.cost, 'DD']), sig: () => sigS(d.key, s.key, 'manaCost') + sigC(c.key, 'stats'),
      explain: ex(...lvlLines(c, 'mpregen', n, '마나 재생(5초당)'), `④ 초당 마나 재생 = ${n2(reg)} ÷ 5 = ${n4(reg / 5)}`, `⑤ ${fmt(cost)} ÷ ${n4(reg / 5)} = ${n2(t)} → ${sec(ans)}`,
        `⚠️ 마나 재생 수치는 5초 기준이라, ${fmt(cost)} ÷ ${n2(reg)}로 계산하면 ${sec(r1(cost / reg))}로 5배 짧게 나옵니다.`,
        `💡 이 시간 동안 견제를 못 한다는 뜻이라, 라인전 마나 관리와 귀환 타이밍을 정할 때 씁니다.`) });
}, { d: true });

/* 소환사 주문 가속이 있을 때 돌아오는 시각 */
gen('summ', 2, 2, async () => {
  const M = await ensure('summ'); const s = pick(M.filter(x => x.cd >= 60 && !x.charge));
  const h = pick([10, 12, 15, 18, 20, 25, 30, 33]), cd = hasteCd(s.cd, h), at = (2 + rand(18)) * 60 + rand(60), back = Math.round(at + cd);
  const wr = [Math.round(at + s.cd), Math.round(at + s.cd * (1 - h / 100)), back + 10, back - 10, Math.round(at + s.cd - h)].map(mmss).filter(x => x !== mmss(back));
  return Q('summ', `상대가 ${mmss(at)}에 「${s.name}」${josa(s.name, '을')} 썼습니다. 상대에게 소환사 주문 가속 ${h}이 있다면 다시 쓸 수 있는 시각은 언제일까요? (초 단위 반올림)`, mmss(back), [...new Set(wr)], {
    need: 'summ', srcs: [s.src.cd], sig: () => sigM(s.id),
    explain: ex(`① 쿨타임 = ${s.cd} × 100 ÷ (100 + ${h}) = ${n2(cd)}초`, `② ${mmss(at)} + ${n2(cd)}초 = ${mmss(back)}`,
      `⚠️ 가속을 %로 보고 ${s.cd} × (1 − ${h}%)로 계산하면 ${J(mmss(Math.round(at + s.cd * (1 - h / 100))), '이')} 나와 틀립니다.`,
      `💡 가속 ${h}이면 ${s.name} 쿨이 ${n2(s.cd - cd)}초 줄어요. 채팅에 시각을 적을 때 가속 여부를 꼭 반영하세요.`) });
}, { need: 'summ' });

/* 골드 1000당 유효 체력 증가 */
gen('item', 5, 2, async () => {
  const I = await ensure('items'); const n = pick(LVS);
  const phys = Math.random() < 0.6, rl = phys ? '방어력' : '마법 저항력', rk = phys ? 'armor' : 'spellblock';
  const c = pick(withStats().filter(x => x.stats[rk + 'perlevel'] != null));
  const H = lvlStat(c, 'hp', n), A = lvlStat(c, rk, n), base = H * (1 + A / 100);
  const cand = I.list.filter(m => ['legendary', 'epic', 'basic'].includes(m.kind) && m.total > 0 && (itemStat(m, '체력') > 0 || itemStat(m, rl) > 0));
  const cs = [], seen = new Set();
  for (const m of shuffle(cand)) { const h = itemStat(m, '체력'), a = itemStat(m, rl); const per = r1(((H + h) * (1 + (A + a) / 100) - base) / m.total * 1000); if (seen.has(per)) continue; seen.add(per); cs.push({ m, h, a, per }); if (cs.length >= OPTS) break; }
  if (cs.length < OPTS) return null; cs.sort((x, y) => y.per - x.per);
  return Q('item', `아이템이 없는 레벨 ${n} ${J(c.name, '이')} ${phys ? '물리' : '마법'} 피해에 버티려고 합니다. 골드 1000당 유효 체력이 가장 많이 늘어나는 아이템은 무엇일까요? (고유 효과 제외)`, cs[0].m.name, cs.slice(1).map(x => x.m.name), {
    long: true, need: 'items', srcs: ['DD'], champ: c.key, sig: () => sigC(c.key, 'stats') + cs.map(x => sigI(x.m.id, 'stats') + sigI(x.m.id, 'total')).join(),
    explain: ex(`① 레벨 ${n} ${c.name}: 체력 ${n2(H)}, ${rl} ${n2(A)} → 유효 체력 ${Math.round(base)}`,
      ...cs.map(x => `• ${x.m.name} (${x.m.total}골드, 체력 +${x.h}, ${rl} +${x.a}): (${n2(H + x.h)} × (1 + ${n2(A + x.a)}/100) − ${Math.round(base)}) ÷ ${x.m.total} × 1000 = ${fmt(x.per)}`),
      `💡 비싼 완성 아이템보다 싼 재료가 골드당 효율이 높은 경우가 많아요. 귀환 골드가 애매할 때 어떤 재료부터 살지 정하는 계산입니다.`) });
}, { need: 'items' });

/* 아이템 완성까지 걸리는 시간 */
gen('item', 2, 1, async () => {
  const I = await ensure('items'); const m = pick(I.list.filter(x => x.kind === 'legendary' && x.fromSR && x.fromSR.length)); if (!m) return null;
  const z = I.byId.get(pick(m.fromSR)); if (!z) return null;
  const g = pick([0, 150, 300, 450, 600]), gpm = pick([350, 400, 450, 500, 550, 600]), need = m.total - z.total - g; if (need <= 0) return null;
  const ans = Math.ceil(need / (gpm / 60) - 1e-9);
  const wrong = intOpts(ans, [Math.ceil((m.total - g) / (gpm / 60)), Math.ceil((m.base - g) / (gpm / 60)), Math.ceil(need / gpm), ans + 30, ans - 30], 10);
  return Q('item', `${J(z.name, '을')} 갖고 ${g}골드가 있는 상태에서 분당 ${gpm}골드를 번다면, ${m.name} 완성 골드가 모이기까지 몇 초가 걸릴까요? (올림)`, sec(ans), wrong.map(sec), {
    need: 'items', srcs: ['DD'], sig: () => sigI(m.id, 'total') + sigI(z.id, 'total'),
    explain: ex(`① 필요 골드 = ${m.name} ${m.total} − 보유 재료 ${z.name} ${z.total} − 현재 ${g} = ${need}`,
      `② 초당 골드 = ${gpm} ÷ 60 = ${n2(gpm / 60)}`, `③ ${need} ÷ ${n2(gpm / 60)} = ${n2(need / (gpm / 60))} → 올림 ${ans}초 (${mmss(ans)})`,
      `💡 이 시간에 귀환 이동 시간을 더하면, 언제 리콜해야 다음 교전 전에 아이템이 완성되는지 알 수 있어요.`) });
}, { need: 'items' });

/* =====================================================================
 *  패치 변경 (이전 버전 스냅샷과 비교해 자동 생성)
 * ===================================================================== */
const patchDiff = () => { const D = store.get('lastDiff', null); return D && D.to === S.dd ? D : null; };
const patchAvailable = () => { const D = patchDiff(); return !!(D && D.changes.some(x => x.field !== 'new')); };
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
      if (!q || q.opts.length !== OPTS) continue;
      q.tier = g.tier; q.need = q.need || g.need;
      const key = q.prompt + '|' + q.answer;
      if (seen && seen.has(key) && tries < 30) continue;
      return q;
    } catch (e) { if (!/후보 없음/.test(e.message)) console.warn('[문제 생성 실패]', g.cat, e); }
  }
  return null;
}
async function isStale(q) {
  if (!q.sig) return false;
  const jobs = [];
  if (q.need) jobs.push(ensure(q.need).catch(() => {}));
  ((q.needs && q.needs.d) || []).forEach(k => { const c = S.byKey.get(k); if (c) jobs.push(loadDetail(c).catch(() => {})); });
  await Promise.all(jobs);
  let now; try { now = q.sig(); } catch (e) { return true; }
  return now !== q.sigVal;
}
