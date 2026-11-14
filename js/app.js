'use strict';
/* =====================================================================
 *  app.js — 화면
 * ===================================================================== */
const srcTag = s => s === 'DD' ? `<span class="src dd">Data Dragon ${esc(S.dd)}</span>` : s === 'CD' ? `<span class="src cd">CommunityDragon ${esc(S.cdPath)}</span>` : s === 'CDG' ? `<span class="src cd">CommunityDragon 게임 데이터 ${esc(S.cdPath)}</span>` : '';
let selCats = new Set(store.get('cats2', ['champ', 'skill', 'item', 'summ', 'rune']).filter(k => k in CATS));
let selTiers = new Set(store.get('tiers5', [1, 2, 3, 4, 5]).filter(k => k in TIER));
let selCnt = store.get('cnt', 10);
const best = () => store.get('best2', { acc: null, streak: 0, pts: 0 });

function setDot(s) { $('#dot').className = 'dot ' + s; }
function renderHeader() { $('#verTxt').textContent = S.dd ? `패치 ${S.dd}` : (S.loading ? '불러오는 중…' : '연결 실패'); }
function show(id) { ['home', 'quiz', 'result'].forEach(x => $('#' + x).hidden = x !== id); window.scrollTo(0, 0); }
hooks.onState = setDot;
hooks.onLoaded = () => { renderHeader(); renderHome(); renderSettings(); };
hooks.onUpdated = async () => { await revalidateCurrent(); };

function errorHTML(title) {
  const hints = envHints(), recent = ERRORS.slice(-6).reverse();
  return `<div class="t bad">${esc(title)}</div>
    ${hints.map(h => `<div style="margin:6px 0">💡 ${esc(h)}</div>`).join('')}
    ${S.loadErr ? `<div class="mut" style="margin-top:6px">원인: ${esc(S.loadErr)}</div>` : ''}
    ${recent.length ? `<div class="mut" style="margin-top:8px;font-size:12px;word-break:break-all">${recent.map(r => `• ${esc(r.kind)} — ${esc(r.url.replace(/^https:\/\//, ''))}`).join('<br>')}</div>` : ''}`;
}
function renderHome() {
  const pa = S.ready && patchAvailable();
  $('#catChips').innerHTML = Object.entries(CATS).map(([k, v]) =>
    `<button class="chip" data-cat="${k}" aria-pressed="${selCats.has(k) && (k !== 'patch' || pa)}" ${k === 'patch' && !pa ? 'disabled title="이전 패치와 비교할 기록이 아직 없어요"' : ''}>${v}</button>`).join('');
  $('#tierChips').innerHTML = Object.entries(TIER).map(([k, t]) =>
    `<button class="chip tier ${t.cls}" data-tier="${k}" aria-pressed="${selTiers.has(+k)}"><b>${t.name}</b><small>${t.range}</small></button>`).join('');
  $('#cntChips').innerHTML = [[10, '10문제'], [20, '20문제'], [0, '무한 모드']].map(([n, l]) => `<button class="chip" data-cnt="${n}" aria-pressed="${selCnt === n}">${l}</button>`).join('');
  const activeCats = [...selCats].filter(k => k !== 'patch' || pa);
  $('#startBtn').disabled = !S.ready || !activeCats.length || !selTiers.size;
  const b = best();
  $('#stBest').textContent = b.acc == null ? '-' : b.acc + '%';
  $('#stStreak').textContent = b.streak || '-';
  $('#stPts').textContent = b.pts || '-';
  $('#homeSub').innerHTML = S.ready ? `패치 <b>${esc(S.dd)}</b> 데이터로 출제합니다. 모든 수치는 Data Dragon·CommunityDragon에서 실시간으로 읽고, 패치가 바뀌면 문제도 자동으로 바뀌어요.`
    : (S.loading ? 'Data Dragon + CommunityDragon 데이터를 불러오는 중입니다…' : '데이터를 불러오지 못했어요.');
  const eb = $('#errBox');
  if (!S.ready && !S.loading && (S.loadErr || ERRORS.length)) { eb.hidden = false; eb.innerHTML = errorHTML('데이터를 불러오지 못했어요') + '<button class="btn" id="retryLoad" style="margin-top:12px">다시 시도</button>'; }
  else eb.hidden = true;
}
$('#catChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b || b.disabled) return; const k = b.dataset.cat; selCats.has(k) ? selCats.delete(k) : selCats.add(k); store.set('cats2', [...selCats]); renderHome(); });
$('#tierChips').addEventListener('click', e => { const b = e.target.closest('[data-tier]'); if (!b) return; const k = +b.dataset.tier; selTiers.has(k) ? selTiers.delete(k) : selTiers.add(k); store.set('tiers5', [...selTiers]); renderHome(); });
$('#cntChips').addEventListener('click', e => { const b = e.target.closest('[data-cnt]'); if (!b) return; selCnt = +b.dataset.cnt; store.set('cnt', selCnt); renderHome(); });
$('#startBtn').addEventListener('click', startGame);
$('#errBox').addEventListener('click', e => { if (e.target.closest('#retryLoad')) { ERRORS.length = 0; checkForUpdate('force'); renderHome(); } });
$('#brand').addEventListener('click', () => { if (S.game && !S.game.done && S.game.hist.length && !leaveArmed()) return; S.game = null; renderHome(); show('home'); });
function leaveArmed() { if (leaveArmed.t && Date.now() - leaveArmed.t < 2500) return true; leaveArmed.t = Date.now(); toast('한 번 더 누르면 퀴즈를 그만둡니다'); return false; }

function startGame() {
  const pa = patchAvailable();
  S.game = { cats: new Set([...selCats].filter(k => k !== 'patch' || pa)), tiers: new Set(selTiers), total: selCnt, idx: 0, score: 0, pts: 0, streak: 0, bestStreak: 0, q: null, answered: false, hist: [], done: false, seen: new Set() };
  show('quiz'); nextQuestion();
}
async function nextQuestion(replace = false) {
  const G = S.game; if (!G) return;
  if (!replace) { if (G.total && G.idx >= G.total) return finish(); G.idx++; }
  G.answered = false; G.q = null;
  $('#qBody').innerHTML = '<div class="spin"></div>'; $('#qTier').innerHTML = ''; updateProg();
  const q = await makeQuestion(G.cats, G.tiers, G.seen);
  if (S.game !== G) return;
  if (!q) {
    $('#qBody').innerHTML = `<div class="fb" style="border-color:var(--bad)">${errorHTML('문제를 만들지 못했어요')}<div class="mut" style="margin-top:6px">분야나 난이도를 더 선택하거나 잠시 후 다시 시도해 주세요.</div></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="retryQ" style="flex:1">다시 시도</button><button class="btn ghost" id="endBtn">끝내기</button></div>`;
    return;
  }
  G.seen.add(q.prompt + '|' + q.answer);
  G.q = q; renderQuestion(q);
}
async function revalidateCurrent() {
  const G = S.game; if (!G || !G.q || G.answered) return;
  if (await isStale(G.q)) { toast('패치로 이 문제의 수치가 바뀌어 새 문제로 교체했어요'); await nextQuestion(true); }
}
function updateProg() {
  const G = S.game;
  $('#qProg').textContent = G.total ? `${G.idx} / ${G.total} · ${G.pts}점` : `${G.idx}번째 · ${G.pts}점 · 연속 ${G.streak}`;
  $('#qBar').style.width = G.total ? (G.idx / G.total * 100) + '%' : '100%';
}
function imgHTML(urls, cls, zoom) {
  const style = zoom ? `style="transform:scale(${zoom.s.toFixed(2)});transform-origin:${zoom.x}% ${zoom.y}%"` : '';
  return `<div class="media"><div class="frame ${cls}"><img alt="문제 이미지" ${style} src="${esc(urls[0])}" data-alt='${esc(JSON.stringify(urls.slice(1)))}'></div></div>`;
}
function imgFallback(el) {
  let alt = []; try { alt = JSON.parse(el.dataset.alt || '[]'); } catch (e) {}
  if (alt.length) { el.dataset.alt = JSON.stringify(alt.slice(1)); el.src = alt[0]; } else el.style.opacity = .2;
}
function renderQuestion(q) {
  const t = TIER[q.tier];
  $('#qCat').textContent = CATS[q.cat];
  $('#qTier').innerHTML = `<span class="badge ${t.cls}">${t.name} · ${t.range}</span>`;
  const long = q.long || q.opts.some(o => o.label.length > 13);
  $('#qBody').innerHTML = `<h2>${q.raw ? q.prompt : esc(q.prompt)}</h2>
    ${q.img ? imgHTML(q.img, q.imgClass, q.zoom) : ''}
    <div class="opts ${long ? 'long' : ''}">${q.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="k">${i + 1}</span><span>${esc(o.label)}</span></button>`).join('')}</div>
    <div id="fb"></div>`;
  const im = $('#qBody .media img'); if (im) im.addEventListener('error', () => imgFallback(im));
}
$('#qBody').addEventListener('click', e => {
  const b = e.target.closest('.opt'); if (b && !b.disabled) answer(+b.dataset.i);
  if (e.target.closest('#nextBtn')) nextQuestion();
  if (e.target.closest('#endBtn')) finish();
  if (e.target.closest('#retryQ')) nextQuestion(true);
});
document.addEventListener('keydown', e => {
  if ($('#quiz').hidden || !S.game || !S.game.q) return;
  if (!S.game.answered && /^[1-5]$/.test(e.key)) { const i = +e.key - 1; if (i < S.game.q.opts.length) answer(i); }
  else if (S.game.answered && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextQuestion(); }
});
function answer(i) {
  const G = S.game; if (G.answered) return; G.answered = true;
  const q = G.q, ok = q.opts[i].ok, t = TIER[q.tier];
  if (ok) { G.score++; G.pts += t.pts; G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak); } else G.streak = 0;
  G.hist.push({ q, chosen: i, ok });
  document.querySelectorAll('.opt').forEach((b, j) => { b.disabled = true; if (q.opts[j].ok) b.classList.add('ok'); else if (j === i) b.classList.add('bad'); });
  if (q.zoom) { const im = $('.media img'); if (im) im.style.transform = 'scale(1)'; }
  const srcs = [...new Set((q.srcs || []).filter(Boolean))];
  const last = G.total && G.idx >= G.total;
  $('#fb').innerHTML = `<div class="fb"><div class="t ${ok ? 'ok' : 'bad'}">${ok ? `정답! +${t.pts}점` : '오답 — 정답: ' + esc(q.answer)}</div>
      <div class="exp">${esc(q.explain || '')}</div>
      <div>${srcs.map(srcTag).join('')}${srcs.length > 1 ? '<span class="src fill">두 소스 병합</span>' : ''}</div></div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="nextBtn" style="flex:1">${last ? '결과 보기' : '다음 문제'}</button>${G.total ? '' : '<button class="btn ghost" id="endBtn">그만하기</button>'}</div>`;
  updateProg();
  const nb = $('#nextBtn'); if (nb && matchMedia('(hover:hover)').matches) nb.focus();
  nb && nb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function finish() {
  const G = S.game; if (!G) return; G.done = true;
  if (!G.hist.length) { S.game = null; renderHome(); show('home'); return; }
  const n = G.hist.length, acc = Math.round(G.score / n * 100);
  const b = best(); let nb = false;
  if (n >= 10 && (b.acc == null || acc > b.acc)) { b.acc = acc; nb = true; }
  if (G.bestStreak > (b.streak || 0)) { b.streak = G.bestStreak; nb = true; }
  if (G.pts > (b.pts || 0)) { b.pts = G.pts; nb = true; }
  store.set('best2', b);
  const byTier = {}; G.hist.forEach(h => { const t = h.q.tier; byTier[t] = byTier[t] || { n: 0, ok: 0 }; byTier[t].n++; if (h.ok) byTier[t].ok++; });
  let level = null; for (const t of [5, 4, 3, 2, 1]) { const x = byTier[t]; if (x && x.n >= 2 && x.ok / x.n >= 0.7) { level = TIER[t]; break; } }
  const wrong = G.hist.filter(h => !h.ok);
  $('#result').innerHTML = `<h1>결과</h1>
    <p class="sub">패치 ${esc(S.dd)} 기준${nb ? ' · 🏆 최고 기록 갱신!' : ''}</p>
    <div class="stats">
      <div class="stat"><b>${G.score}/${n}</b><span>정답</span></div>
      <div class="stat"><b>${G.pts}</b><span>난이도 점수</span></div>
      <div class="stat"><b>${G.bestStreak}</b><span>최고 연속</span></div>
    </div>
    <div class="label">난이도별 정답률</div>
    <div class="tierbars">${[1, 2, 3, 4, 5].filter(t => byTier[t]).map(t => { const x = byTier[t], p = Math.round(x.ok / x.n * 100);
      return `<div class="tb"><span class="badge ${TIER[t].cls}">${TIER[t].name}</span><div class="tbar"><i style="width:${p}%"></i></div><span>${x.ok}/${x.n}</span></div>`; }).join('')}</div>
    ${level ? `<p class="sub" style="margin-top:12px">지식 수준: <b>${level.range}</b> 문제를 70% 이상 맞혔어요.</p>` : ''}
    <div class="row" style="margin-top:18px"><button class="btn primary" style="flex:1" id="againBtn">다시 하기</button><button class="btn ghost" id="homeBtn">처음으로</button></div>
    ${wrong.length ? `<div class="label">틀린 문제 복습</div><div class="review">${wrong.map(h => `<div><span class="badge ${TIER[h.q.tier].cls}">${TIER[h.q.tier].name}</span> <b>${h.q.raw ? h.q.prompt.replace(/<div[\s\S]*$/, '') : esc(h.q.prompt)}</b><br>
       <span class="down">내 답: ${esc(h.q.opts[h.chosen].label)}</span> · <span class="up">정답: ${esc(h.q.answer)}</span><br><div class="exp mut">${esc(h.q.explain || '')}</div></div>`).join('')}</div>` : ''}`;
  show('result');
  $('#againBtn').onclick = startGame;
  $('#homeBtn').onclick = () => { S.game = null; renderHome(); show('home'); };
}

/* ---------- 설정 ---------- */
function renderSettings() {
  if (!$('#ov').classList.contains('open')) return;
  $('#pinLabel').textContent = `${CFG.BASE_VERSION} 고정`;
  document.querySelectorAll('input[name=track]').forEach(r => r.checked = (r.value === 'latest') === settings.followLatest);
  $('#pollSel').value = String(settings.pollMin);
  const I = S.data.items, M = S.data.summ, R = S.data.runes;
  $('#kv').innerHTML = `<dt>사용 중 (DD)</dt><dd>${esc(S.dd || '-')}</dd><dt>최신 DD</dt><dd>${esc(S.latest || '-')}</dd>
    <dt>CDragon 경로</dt><dd>/${esc(S.cdPath || '-')}/ ${S.cdVersion ? '(' + esc(S.cdVersion) + ')' : ''}</dd>
    <dt>챔피언</dt><dd>${S.champs.length}명 · 상세 ${S.details.size}명</dd>
    <dt>아이템</dt><dd>${I ? I.list.length + '개 (협곡 구매 가능)' : '불러오는 중'}</dd>
    <dt>소환사 주문</dt><dd>${M ? M.length + '개' : '불러오는 중'}</dd>
    <dt>룬</dt><dd>${R ? R.runes.length + '개 · 빌드 ' + R.trees.length + '개' : '불러오는 중'}</dd>
    <dt>마지막 확인</dt><dd>${timeStr(S.lastCheck)}</dd><dt>다음 확인</dt><dd>${timeStr(S.nextCheck)}${S.fail ? ` (실패 ${S.fail}회 → 간격 늘림)` : ''}</dd>`;
  const F = S.fill || newFill(), fl = o => Object.entries(o).map(([k, v]) => `${esc(k)} ${v}`).join(', ') || '없음';
  $('#fillInfo').innerHTML = `<div>• DD에 비어 있어 <b style="color:#c9a6ff">CommunityDragon</b>으로 채움: ${fl(F.CD)}</div>
    <div>• CD에 비어 있어 <b style="color:#8cc3ff">Data Dragon</b>으로 채움: ${fl(F.DD)}</div>
    <div>• Data Dragon과 달라서 <b style="color:#c9a6ff">실제 게임 데이터</b>로 바로잡은 값: ${fl(F.CDG)}</div>
    <div>• CD에만 있는 챔피언 ${F.cdOnlyChamps}명 · DD에만 있는 챔피언 ${F.ddOnlyChamps}명</div>`;
  const D = store.get('lastDiff', null);
  $('#chgInfo').innerHTML = D && D.changes.length ? `<div class="mut" style="font-size:13px;margin-bottom:6px">${esc(D.from)} → ${esc(D.to)} · ${D.changes.length}건</div><div class="changes">${D.changes.slice(0, 120).map(ch => {
      const nm = ch.name || (S.byKey.get(ch.key) || {}).name || ch.key;
      if (ch.field === 'new') return `<div>🆕 ${esc(ch.new)}</div>`;
      const dir = typeof ch.old === 'number' ? (ch.new > ch.old ? 'up' : 'down') : '';
      return `<div>${esc(nm)} · ${esc(ch.label)}: ${esc(fmtArr(ch.old))} → <span class="${dir}">${esc(fmtArr(ch.new))}</span>${esc(ch.unit || '')}</div>`; }).join('')}</div>`
    : '<div class="mut" style="font-size:14px">아직 비교할 이전 패치 기록이 없어요. 다음 패치가 나오면 여기와 "패치 변경" 문제에 자동으로 나타납니다.</div>';
}
$('#verBtn').onclick = () => { $('#ov').classList.add('open'); renderSettings(); };
$('#ovClose').onclick = () => $('#ov').classList.remove('open');
$('#ov').addEventListener('click', e => { if (e.target.id === 'ov') $('#ov').classList.remove('open'); });
document.querySelectorAll('input[name=track]').forEach(r => r.onchange = () => { settings.followLatest = r.value === 'latest'; saveSettings(); checkForUpdate('manual'); });
$('#pollSel').onchange = e => { settings.pollMin = +e.target.value; saveSettings(); schedule(); toast(`${settings.pollMin}분마다 새 패치를 확인합니다`); };
$('#checkNow').onclick = () => checkForUpdate('manual');
$('#forceReload').onclick = () => checkForUpdate('force');
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.ready && Date.now() >= S.nextCheck) checkForUpdate(); });
window.addEventListener('online', () => { if (S.ready) checkForUpdate(); });

(async function init() {
  renderHome(); setDot('busy');
  try { const v = await resolveVersions(); S.lastCheck = Date.now(); await loadAll(v, { reason: 'init' }); }
  catch (e) { toast('데이터를 불러오지 못했어요. 잠시 후 자동으로 다시 시도합니다.'); S.fail++; }
  schedule();
})();
