// =====================================================
// 語音模組：負責「念英文給你聽」和「聽你講英文並打分數」
// 全部使用瀏覽器內建的 Web Speech API，免費、不需要帳號
// =====================================================
const Speech = (() => {
  // ---------- 1. 念出英文（TTS，Text-To-Speech）----------
  let voice = null;
  let onVoicesChanged = () => {};
  const VOICE_KEY = 'travel-english-voice';

  // iPhone/Mac 內建的「趣味聲音」和舊式合成聲音，聽起來像機器人，要排除
  const ROBOT_NAMES = ['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News',
    'Jester', 'Organ', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Fred', 'Junior', 'Ralph',
    'Kathy', 'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley', 'Deranged', 'Hysterical'];
  const isRobot = v =>
    /eloquence|speech\.synthesis\.voice/i.test(v.voiceURI) ||
    ROBOT_NAMES.some(n => v.name === n || v.name.startsWith(n + ' '));

  // 目前旅程的口音：澳洲 en-AU、加拿大 en-CA
  // 每種口音的優先順序（加拿大腔很少見，美國腔最接近）
  const ACCENT_ORDER = {
    'en-AU': ['en-AU', 'en-NZ', 'en-GB'],
    'en-CA': ['en-CA', 'en-US', 'en-GB']
  };
  let accent = 'en-AU';

  // 幫聲音打分數：目前口音最優先，高品質（Premium/Enhanced/Natural）加分
  function rank(v) {
    const idx = ACCENT_ORDER[accent].indexOf(v.lang.replace('_', '-'));
    let s = idx >= 0 ? 30 - idx * 10 : 5;
    if (/premium/i.test(v.voiceURI + v.name)) s += 5;
    else if (/enhanced|natural|neural|online/i.test(v.voiceURI + v.name)) s += 4;
    if (accent === 'en-AU' && /^(Karen|Lee|Matilda|Catherine|Natasha|William)\b/.test(v.name)) s += 2; // 好聽的澳洲聲音
    if (accent === 'en-CA' && /^(Samantha|Ava|Allison|Susan|Tom|Evan|Nathan)\b/.test(v.name)) s += 2; // 好聽的北美聲音
    return s;
  }

  // 每種口音分開記住你選的聲音（澳洲沿用原本的設定）
  const voiceKey = () => (accent === 'en-AU' ? VOICE_KEY : `${VOICE_KEY}-${accent}`);

  // 可以選的英文聲音（已排除機器人聲，好的排前面）
  function listVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices()
      .filter(v => v.lang.replace('_', '-').startsWith('en') && !isRobot(v))
      .sort((a, b) => rank(b) - rank(a));
  }

  // 挑選聲音：如果你在選單選過就用你選的，否則自動挑分數最高的
  function pickVoice() {
    const voices = listVoices();
    let saved = null;
    try { saved = localStorage.getItem(voiceKey()); } catch {}
    voice = voices.find(v => v.voiceURI === saved) || voices[0] || null;
    onVoicesChanged();
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice; // 有些瀏覽器聲音清單是之後才載入
  }

  function setVoice(uri) {
    try { localStorage.setItem(voiceKey(), uri); } catch {}
    pickVoice();
  }
  const currentVoice = () => voice;

  // 切換旅程時呼叫，例如 setAccent('en-CA')
  function setAccent(lang) {
    if (!ACCENT_ORDER[lang] || lang === accent) return;
    accent = lang;
    if ('speechSynthesis' in window) pickVoice();
  }

  // 防止「開頭被吃掉一兩個音節」：
  // 電腦/藍牙耳機的音效裝置閒置時會休眠，聲音開始後才醒來，開頭就被切掉。
  // 解法：第一次播放時開一個「無聲音軌」一直播著，讓音效裝置保持清醒。
  let audioCtx = null;
  function keepAudioAwake() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.0001; // 小到聽不見，但裝置會保持運作
        const osc = audioCtx.createOscillator();
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        return wait(300); // 第一次多等一下，讓裝置完全醒來
      }
      if (audioCtx.state === 'suspended') return audioCtx.resume().then(() => wait(150));
    } catch {}
    return Promise.resolve();
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // 是不是 iPhone / iPad（新款 iPad 會假裝成 Mac，所以多判斷觸控）
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let current = null; // 保留目前的句子，避免 Chrome 播到一半被回收而中斷

  // rate：1 = 正常速度，0.7 = 慢速
  function speak(text, rate = 1) {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    if (busy) speechSynthesis.cancel();

    const go = () => new Promise(resolve => {
      // 每次念之前重新從系統清單拿聲音，避免用到過期的聲音物件（iPhone 會忽略它）
      const v = voice && (speechSynthesis.getVoices().find(x => x.voiceURI === voice.voiceURI) || voice);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = v ? v.lang : 'en-AU';
      if (v) u.voice = v;
      u.rate = rate;
      u.onend = u.onerror = () => { if (current === u) current = null; resolve(); };
      current = u;
      speechSynthesis.speak(u);
    });

    // iPhone/iPad 規定：必須在點按鈕的「當下」立刻開始念，等待後再念會被忽略或換回預設聲音
    if (IS_IOS) return go();
    // 電腦：先叫醒音效裝置；正在念上一句時稍等一下再念（太快接著念，開頭會被切掉）
    return keepAudioAwake().then(() => (busy ? wait(120) : null)).then(go);
  }

  // ---------- 2. 聽你講話（語音辨識）----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canListen = !!Recognition;

  // 有些手機不支援用 en-AU / en-CA 辨識，失敗過的口音記下來，之後直接改用美式英文
  const badLangs = new Set();

  // 開始聽，講完後回傳辨識出的幾個候選句子（陣列）
  function listen() {
    // 示範發音還在念的話，麥克風會被占用，先停掉
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const lang = badLangs.has(accent) ? 'en-US' : accent; // 用目前旅程的口音來辨識
    return listenOnce(lang).catch(err => {
      if ((err === 'language-not-supported' || err === 'bad-grammar') && lang !== 'en-US') {
        badLangs.add(accent);
        return listenOnce('en-US');
      }
      throw err;
    });
  }

  function listenOnce(lang) {
    return new Promise((resolve, reject) => {
      const rec = new Recognition();
      rec.lang = lang;
      rec.interimResults = false;
      rec.maxAlternatives = 3; // 取 3 個候選，挑最接近的打分
      rec.onresult = e => resolve(Array.from(e.results[0]).map(a => a.transcript));
      // 沒聽到聲音不算錯誤，當成「沒聽到」處理
      rec.onerror = e => (e.error === 'no-speech' ? resolve([]) : reject(e.error));
      rec.onend = () => resolve([]); // 沒聽到任何聲音
      try { rec.start(); } catch { reject('start-failed'); }
    });
  }

  // ---------- 3. 比對打分 ----------
  // 把縮寫展開、數字轉英文，讓 "I'd" 和 "I would"、"4" 和 "four" 都算對
  const CONTRACTIONS = {
    "i'm": 'i am', "i've": 'i have', "i'd": 'i would', "i'll": 'i will',
    "we're": 'we are', "we've": 'we have', "it's": 'it is', "that's": 'that is',
    "there's": 'there is', "here's": 'here is', "what's": 'what is', "where's": 'where is',
    "how're": 'how are', "don't": 'do not', "can't": 'can not', "cannot": 'can not',
    "booking's": 'booking is', "we'll": 'we will', "you're": 'you are'
  };
  const NUMBERS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  // 0~99 的數字轉成英文字，例如 25 → ["twenty", "five"]
  function numberWords(n) {
    if (n < 20) return [NUMBERS[n]];
    if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], NUMBERS[n % 10]] : [TENS[n / 10]];
    return null;
  }

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      // 金額：$50 → 50 dollars；$12.50 → 12 50（念法是 twelve fifty）
      .replace(/\$(\d+)\.(\d\d)\b/g, '$1 $2')
      .replace(/\$(\d+)/g, '$1 dollars')
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .flatMap(w => {
        if (CONTRACTIONS[w]) return CONTRACTIONS[w].split(' ');
        if (/^\d+$/.test(w) && numberWords(+w)) return numberWords(+w);
        // 三位數以上（例如 911、811 電話號碼）一個一個數字念
        if (/^\d{3,}$/.test(w)) return w.split('').map(d => NUMBERS[+d]);
        return [w];
      });
  }

  // 用「最長共同子序列」找出目標句子裡哪些字你有講到
  // 回傳：{ score: 0~100, words: [{ text: 原本的字, ok: true/false }] }
  function compare(target, heard) {
    const displayWords = target.split(/\s+/);           // 畫面上顯示的原始字
    const t = displayWords.map(w => normalize(w));      // 每個原始字展開後的小字
    const flatT = t.flat();
    const h = normalize(heard);

    // 動態規劃表
    const dp = Array.from({ length: flatT.length + 1 }, () => new Array(h.length + 1).fill(0));
    for (let i = flatT.length - 1; i >= 0; i--)
      for (let j = h.length - 1; j >= 0; j--)
        dp[i][j] = flatT[i] === h[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

    // 回推哪些目標小字有對到
    const matched = new Array(flatT.length).fill(false);
    let i = 0, j = 0;
    while (i < flatT.length && j < h.length) {
      if (flatT[i] === h[j]) { matched[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }

    // 原始字的所有小字都對到，才算這個字講對
    let k = 0;
    const words = displayWords.map((text, idx) => {
      const n = t[idx].length;
      const ok = n === 0 || matched.slice(k, k + n).every(Boolean);
      k += n;
      return { text, ok };
    });
    const score = flatT.length ? Math.round(matched.filter(Boolean).length / flatT.length * 100) : 0;
    return { score, words };
  }

  // 從多個候選句子中，挑分數最高的那個
  function bestMatch(target, candidates) {
    let best = { score: 0, words: target.split(/\s+/).map(text => ({ text, ok: false })), heard: '' };
    for (const c of candidates) {
      const r = compare(target, c);
      if (r.score > best.score || !best.heard) best = { ...r, heard: c };
    }
    return best;
  }

  return {
    speak, listen, canListen, compare, bestMatch,
    listVoices, setVoice, currentVoice, setAccent,
    set onVoicesChanged(fn) { onVoicesChanged = fn; }
  };
})();
