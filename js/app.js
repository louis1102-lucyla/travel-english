// =====================================================
// 主程式：載入情境資料、畫出畫面、處理按鈕
// 內容都在 data/scenarios.json，新增句子不需要改這個檔案
// =====================================================
const app = document.getElementById('app');
const pageTitle = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const speedBtn = document.getElementById('speedBtn');

let scenarios = [];

// ---------- 進度：每句話的最高分，存在手機瀏覽器裡 ----------
const STORE_KEY = 'travel-english-progress';
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveScore(id, score) {
  const p = loadProgress();
  p[id] = Math.max(p[id] || 0, score);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch {}
}

// ---------- 語速：正常 / 慢速 ----------
let slow = false;
speedBtn.onclick = () => {
  slow = !slow;
  speedBtn.classList.toggle('on', slow);
};
const rate = () => (slow ? 0.7 : 1);

// 80 分以上算「會了」
const PASS = 80;

// 一個情境裡所有「我要講的句子」，用來算進度
function myLines(s) {
  return [
    ...s.dialogue.map((l, i) => ({ ...l, id: `${s.id}:d${i}` })).filter(l => l.role === 'me'),
    ...s.keyPhrases.map((l, i) => ({ ...l, role: 'me', id: `${s.id}:k${i}` }))
  ];
}

// ---------- 畫面一：情境列表 ----------
function renderList() {
  pageTitle.textContent = '旅遊英文口說';
  backBtn.hidden = true;
  const p = loadProgress();
  app.innerHTML = `<p class="intro">依照行程排列。看中文 → 自己先講 → 聽示範 → 按 🎤 跟讀打分。</p>`;
  app.appendChild(voicePicker());
  for (const s of scenarios) {
    const lines = myLines(s);
    const done = lines.filter(l => (p[l.id] || 0) >= PASS).length;
    const card = document.createElement('button');
    card.className = 'scenario-card';
    card.innerHTML = `
      <span class="emoji">${s.icon}</span>
      <span class="info">
        <div class="title">${s.title}</div>
        <div class="when">${s.when}・${done}/${lines.length} 句已達 ${PASS} 分</div>
        <div class="progress"><div style="width:${(done / lines.length) * 100}%"></div></div>
      </span>`;
    card.onclick = () => (location.hash = `#/s/${s.id}`);
    app.appendChild(card);
  }
}

// ---------- 示範聲音選單 ----------
const REGIONS = { AU: '澳洲', GB: '英國', US: '美國', IE: '愛爾蘭', IN: '印度', ZA: '南非', NZ: '紐西蘭', SG: '新加坡' };
function voiceLabel(v) {
  const region = REGIONS[v.lang.replace('_', '-').split('-')[1]] || v.lang;
  const hq = /premium|enhanced|natural|neural|online/i.test(v.voiceURI + v.name) ? '・高品質' : '';
  const name = v.name.replace(/\s*\(.*\)\s*$/, ''); // 去掉名稱後面括號裡的說明
  return `${region}・${name}${hq}`;
}

function voicePicker() {
  const box = document.createElement('div');
  box.className = 'voice-picker';
  const fill = () => {
    const voices = Speech.listVoices();
    const cur = Speech.currentVoice();
    if (!voices.length) {
      box.innerHTML = '<span class="label">🔈 示範聲音</span><span class="hint">這個瀏覽器沒有英文聲音</span>';
      return;
    }
    box.innerHTML = `
      <label class="label" for="voiceSel">🔈 示範聲音</label>
      <select id="voiceSel">${voices.map(v =>
        `<option value="${escapeHtml(v.voiceURI)}" ${cur && v.voiceURI === cur.voiceURI ? 'selected' : ''}>${escapeHtml(voiceLabel(v))}</option>`).join('')}
      </select>
      <button class="btn" id="voiceTest">試聽</button>`;
    box.querySelector('#voiceSel').onchange = e => {
      Speech.setVoice(e.target.value);
      Speech.speak("G'day! How ya going?", rate());
    };
    box.querySelector('#voiceTest').onclick = () => Speech.speak("G'day! How ya going?", rate());
  };
  fill();
  Speech.onVoicesChanged = () => { if (document.body.contains(box)) fill(); }; // 聲音清單晚載入時更新
  return box;
}

// ---------- 畫面二：情境練習 ----------
function renderScenario(s) {
  pageTitle.textContent = `${s.icon} ${s.title}`;
  backBtn.hidden = false;
  app.innerHTML = `<div class="tips">💡 ${s.tips}</div><h2 class="section-title">對話</h2>`;
  const vocab = s.vocab || {};
  s.dialogue.forEach((l, i) => app.appendChild(lineCard({ ...l, id: `${s.id}:d${i}` }, vocab)));
  const h = document.createElement('h2');
  h.className = 'section-title';
  h.textContent = '必備句';
  app.appendChild(h);
  s.keyPhrases.forEach((l, i) => app.appendChild(lineCard({ ...l, role: 'me', id: `${s.id}:k${i}` }, vocab)));
  window.scrollTo(0, 0);
}

// ---------- 單字中文註解 ----------
// 把句子裡出現在 vocab 的單字/片語包成 <span class="gloss">，滑鼠移過去（手機點一下）顯示中文
const escapeHtml = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function glossify(text, vocab) {
  const keys = Object.keys(vocab).sort((a, b) => b.length - a.length); // 長的片語優先比對
  if (!keys.length) return escapeHtml(text);
  const lookup = Object.fromEntries(keys.map(k => [k.toLowerCase(), vocab[k]]));
  const pattern = new RegExp(`\\b(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return escapeHtml(text).replace(pattern, m =>
    `<span class="gloss" tabindex="0" data-zh="${escapeHtml(lookup[m.toLowerCase()])}">${m}</span>`);
}

// 註解框如果超出螢幕左右邊緣，往內推回來
function placeTip(el) {
  el.style.setProperty('--shift', '0px');
  const zh = el.dataset.zh;
  const probe = document.createElement('span');
  probe.className = 'gloss-probe';
  probe.textContent = zh;
  document.body.appendChild(probe);
  const tipW = probe.offsetWidth;
  probe.remove();
  const r = el.getBoundingClientRect();
  const center = r.left + r.width / 2;
  const margin = 8, vw = document.documentElement.clientWidth;
  let shift = 0;
  if (center - tipW / 2 < margin) shift = margin - (center - tipW / 2);
  else if (center + tipW / 2 > vw - margin) shift = vw - margin - (center + tipW / 2);
  el.style.setProperty('--shift', `${shift}px`);
}
document.addEventListener('mouseover', e => {
  const g = e.target.closest('.gloss');
  if (g) placeTip(g);
});
// 手機沒有「滑鼠移過去」，改成點一下打開、點別處關閉
document.addEventListener('click', e => {
  const g = e.target.closest('.gloss');
  document.querySelectorAll('.gloss.open').forEach(x => x !== g && x.classList.remove('open'));
  if (g) { placeTip(g); g.classList.toggle('open'); }
});

// 一句話的卡片
function lineCard(line, vocab = {}) {
  const el = document.createElement('div');
  const isMe = line.role === 'me';
  el.className = `line ${isMe ? 'me' : 'staff'}`;
  const best = loadProgress()[line.id];

  // 我要講的句子：英文先模糊，逼自己先想；對方的句子：直接顯示
  el.innerHTML = `
    <div class="who">${isMe ? '🙋 我' : '🧑‍💼 對方'}${best != null ? `・最高 ${best} 分` : ''}</div>
    <div class="zh">${line.zh}</div>
    <div class="en ${isMe ? 'hidden' : ''}">${glossify(line.en, vocab)}</div>
    <div class="actions">
      ${isMe ? '<button class="btn" data-act="reveal">👀 看英文</button>' : ''}
      <button class="btn" data-act="play">🔊 聽</button>
      ${isMe && Speech.canListen ? '<button class="btn primary" data-act="mic">🎤 跟讀</button>' : ''}
    </div>
    <div class="result" hidden></div>`;

  const en = el.querySelector('.en');
  const result = el.querySelector('.result');

  el.querySelector('[data-act="play"]').onclick = () => {
    en.classList.remove('hidden');
    Speech.speak(line.en, rate());
  };
  const revealBtn = el.querySelector('[data-act="reveal"]');
  if (revealBtn) revealBtn.onclick = () => en.classList.toggle('hidden');

  const micBtn = el.querySelector('[data-act="mic"]');
  if (micBtn) micBtn.onclick = async () => {
    micBtn.classList.add('recording');
    micBtn.textContent = '🎤 聽你說…';
    try {
      const candidates = await Speech.listen();
      const r = Speech.bestMatch(line.en, candidates);
      showResult(result, r);
      if (r.heard) saveScore(line.id, r.score);
    } catch (err) {
      result.hidden = false;
      result.textContent = err === 'not-allowed'
        ? '請允許瀏覽器使用麥克風。'
        : `沒有聽清楚（${err}），再試一次。`;
    }
    micBtn.classList.remove('recording');
    micBtn.textContent = '🎤 跟讀';
  };
  return el;
}

// 顯示分數，講錯或漏講的字會標成橘色
function showResult(box, r) {
  box.hidden = false;
  if (!r.heard) {
    box.textContent = '沒有聽到聲音，再試一次。';
    return;
  }
  const cls = r.score >= PASS ? 'good' : 'bad';
  const msg = r.score >= PASS ? '很好！' : '橘色的字再練一下';
  box.innerHTML = `
    <div><span class="score ${cls}">${r.score} 分</span>　${msg}</div>
    <div>${r.words.map(w => `<span class="${w.ok ? 'word-ok' : 'word-miss'}">${w.text}</span>`).join(' ')}</div>
    <div class="heard">辨識到：「${r.heard}」</div>`;
}

// ---------- 換頁：網址 #/s/customs 代表進入「入境與海關」 ----------
function route() {
  const m = location.hash.match(/^#\/s\/(.+)$/);
  const s = m && scenarios.find(x => x.id === m[1]);
  s ? renderScenario(s) : renderList();
}
backBtn.onclick = () => (location.hash = '');
window.addEventListener('hashchange', route);

// ---------- 啟動 ----------
document.getElementById('noMic').hidden = Speech.canListen;
fetch('data/scenarios.json')
  .then(r => r.json())
  .then(data => { scenarios = data; route(); })
  .catch(() => { app.textContent = '載入情境資料失敗，請用 serve.ps1 開啟（不能直接雙擊 index.html）。'; });
