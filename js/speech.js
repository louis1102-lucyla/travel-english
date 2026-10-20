// =====================================================
// 語音模組：負責「念英文給你聽」和「聽你講英文並打分數」
// 全部使用瀏覽器內建的 Web Speech API，免費、不需要帳號
// =====================================================
const Speech = (() => {
  // ---------- 1. 念出英文（TTS，Text-To-Speech）----------
  let voice = null;

  // 挑選聲音：優先澳洲口音，沒有就用英國、再沒有就用任何英文
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    voice =
      voices.find(v => v.lang === 'en-AU') ||
      voices.find(v => v.lang === 'en-GB') ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice; // 有些瀏覽器聲音清單是之後才載入
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

  let current = null; // 保留目前的句子，避免 Chrome 播到一半被回收而中斷

  // rate：1 = 正常速度，0.7 = 慢速
  async function speak(text, rate = 1) {
    if (!('speechSynthesis' in window)) return;
    await keepAudioAwake();
    // 正在念上一句時先停掉，並稍等一下再念（太快接著念，開頭會被切掉）
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      await wait(120);
    }
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice ? voice.lang : 'en-AU';
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onend = u.onerror = () => { if (current === u) current = null; resolve(); };
      current = u;
      speechSynthesis.speak(u);
    });
  }

  // ---------- 2. 聽你講話（語音辨識）----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canListen = !!Recognition;

  // 開始聽，講完後回傳辨識出的幾個候選句子（陣列）
  function listen() {
    return new Promise((resolve, reject) => {
      const rec = new Recognition();
      rec.lang = 'en-AU';
      rec.interimResults = false;
      rec.maxAlternatives = 3; // 取 3 個候選，挑最接近的打分
      rec.onresult = e => resolve(Array.from(e.results[0]).map(a => a.transcript));
      rec.onerror = e => reject(e.error);
      rec.onend = () => resolve([]); // 沒聽到任何聲音
      rec.start();
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
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .flatMap(w => {
        if (CONTRACTIONS[w]) return CONTRACTIONS[w].split(' ');
        if (/^\d+$/.test(w) && numberWords(+w)) return numberWords(+w);
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

  return { speak, listen, canListen, compare, bestMatch };
})();
