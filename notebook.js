/* =============================================================
   Notebook Module — สมุดจดศัพท์ส่วนตัว (Add-on for English Study Hub)
   v1.1 (2026-07-16) - Flashcard restyled to match vocab flashcard
   - Self-injects mode card + screen + review modal
   - Uses "tenses_notebook_words_v1" localStorage key (isolated)
   - All IDs prefixed with "nb-" to avoid conflicts
   ============================================================= */
(function () {
  "use strict";

  // ==================== CONSTANTS ====================
  const LS_KEY   = "tenses_notebook_words_v1";
  const DICT     = "https://api.dictionaryapi.dev/api/v2/entries/en/";
  const TRANS    = "https://api.mymemory.translated.net/get";
  const SUG      = "https://api.datamuse.com/sug";
  const WORDS    = "https://api.datamuse.com/words";
  const WIKT     = "https://freedictionaryapi.com/api/v1/entries/en/";
  const GTRANS   = "https://translate.googleapis.com/translate_a/single";
  const CORS_PROXY = "https://corsproxy.io/?";

  const STATE = {
    words: [], current: null,
    suggestions: [], suggestIndex: -1,
    review: { cards: [], order: [], pos: 0, known: new Set(), flipped: false },
    searchToken: 0,
    ready: false
  };

  const DICT_CACHE  = new Map();
  const VALID_CACHE = new Map();

  // ==================== HELPERS ====================
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const difficulty = l => ({ A1:1, A2:2, B1:3, B2:4, C1:5, C2:6 }[l] || 3);

  const RE_EN_WORD  = /^[a-z][a-z'\-]*[a-z]$|^[a-z]$/;
  const RE_HAS_THAI = /[\u0E00-\u0E7F]/;

  const isEnglishWord = w => {
    if (!w) return false;
    const s = String(w).trim().toLowerCase();
    return !!s && !s.includes(" ") && RE_EN_WORD.test(s);
  };
  const isThaiText = t => RE_HAS_THAI.test(String(t || ""));

  function shuffleArr(a) {
    const r = [...a];
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  }

  function load()   { try { STATE.words = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { STATE.words = []; } counts(); }
  function save()   { localStorage.setItem(LS_KEY, JSON.stringify(STATE.words)); counts(); }
  function counts() {
    const b = $("nb-cnt-badge"); if (b) b.textContent = STATE.words.length;
    const l = $("nb-list-count"); if (l) l.textContent = STATE.words.length;
  }
  function nextId() { return STATE.words.reduce((m, w) => Math.max(m, +w.id || 0), 0) + 1; }

  async function json(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  // ==================== API LAYER ====================
  async function dictLookup(word) {
    const key = String(word || "").trim().toLowerCase();
    if (!key) throw new Error("empty");
    if (DICT_CACHE.has(key)) return DICT_CACHE.get(key);
    const p = json(DICT + encodeURIComponent(key));
    DICT_CACHE.set(key, p);
    try { return await p; } catch (e) { DICT_CACHE.delete(key); throw e; }
  }

  async function isRealWord(w) {
    if (!isEnglishWord(w)) return false;
    const key = w.toLowerCase();
    if (VALID_CACHE.has(key)) return VALID_CACHE.get(key);
    const p = (async () => {
      try {
        const d = await dictLookup(key);
        if (!Array.isArray(d) || !d[0]?.word) return false;
        const hw = String(d[0].word || "").trim();
        return hw && hw[0] === hw[0].toLowerCase();
      } catch { return false; }
    })();
    VALID_CACHE.set(key, p);
    return p;
  }

  async function validRelated(list, max = 8, headword = "") {
    const hw = String(headword || "").toLowerCase();
    const unique = [...new Set(
      (list || []).map(x => String(x || "").trim().toLowerCase())
        .filter(isEnglishWord).filter(x => x !== hw)
    )].slice(0, 20);
    const checked = await Promise.all(unique.map(async w => (await isRealWord(w)) ? w : null));
    return checked.filter(Boolean).slice(0, max);
  }

  async function validFamily(family, headword) {
    const out = { noun: [], verb: [], adjective: [], adverb: [] };
    await Promise.all(Object.keys(out).map(async k => {
      out[k] = await validRelated(family?.[k] || [], 6, headword);
    }));
    return out;
  }

  async function getFamily(word) {
    try {
      const rows = await json(`${WORDS}?sp=${encodeURIComponent(word)}*&md=p&max=50`);
      const base = word.toLowerCase();
      const fam  = { noun: [], verb: [], adjective: [], adverb: [] };
      for (const r of rows) {
        const w = (r.word || "").toLowerCase();
        if (w === base || w.includes(" ") || w.length > base.length + 8) continue;
        if (!isEnglishWord(w)) continue;
        const tags = r.tags || [];
        if (tags.some(t => t === "n"))   fam.noun.push(w);
        if (tags.some(t => t === "v"))   fam.verb.push(w);
        if (tags.some(t => t === "adj")) fam.adjective.push(w);
        if (tags.some(t => t === "adv")) fam.adverb.push(w);
      }
      Object.keys(fam).forEach(k => fam[k] = [...new Set(fam[k])].slice(0, 8));
      return fam;
    } catch { return { noun: [], verb: [], adjective: [], adverb: [] }; }
  }

  async function estimateLevel(word) {
    try {
      const rows = await json(`${WORDS}?sp=${encodeURIComponent(word)}&md=f&max=1`);
      const freq = Number((rows[0]?.tags || []).find(x => x.startsWith("f:"))?.slice(2) || 0);
      if (freq >= 50)  return "A1";
      if (freq >= 15)  return "A2";
      if (freq >= 5)   return "B1";
      if (freq >= 1)   return "B2";
      if (freq >= 0.2) return "C1";
      return "C2";
    } catch { return "B1"; }
  }

  function normalizePos(p) {
    const s = String(p || "").toLowerCase();
    return ({
      noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.",
      preposition: "prep.", conjunction: "conj.", pronoun: "pron.",
      interjection: "exclam.", determiner: "det.", article: "art.",
      "n.": "n.", "v.": "v.", "adj.": "adj.", "adv.": "adv."
    })[s] || (s || "meaning");
  }

  function normalize(data) {
    const d = data[0] || {};
    const meanings = d.meanings || [];
    const syn = new Set(), ant = new Set();
    const allExamples = [];
    const defs = [], poses = new Set();
    let ipa = (d.phonetic || "").replace(/^\/|\/$/g, ""), audio = "";

    (d.phonetics || []).forEach(p => {
      if (!ipa && p.text)  ipa = p.text.replace(/^\/|\/$/g, "");
      if (!audio && p.audio) audio = p.audio.startsWith("//") ? "https:" + p.audio : p.audio;
    });

    meanings.forEach(m => {
      const pos = normalizePos(m.partOfSpeech);
      poses.add(pos);
      (m.synonyms || []).forEach(x => syn.add(x));
      (m.antonyms || []).forEach(x => ant.add(x));
      (m.definitions || []).forEach(x => {
        if (x.definition) defs.push({ pos, def: x.definition });
        if (x.example)    allExamples.push({ pos, text: x.example });
        (x.synonyms || []).forEach(y => syn.add(y));
        (x.antonyms || []).forEach(y => ant.add(y));
      });
    });

    return {
      word: d.word || "",
      ipa, audio,
      pos: [...poses].filter(Boolean).join(", "),
      definitionEn: defs[0]?.def || "",
      definitionsEn: defs,
      examples: allExamples,
      synonyms: [...syn].slice(0, 20),
      antonyms: [...ant].slice(0, 20)
    };
  }

  const isThaiLang = lc => lc === "th" || lc === "tha" || lc === "th-th" || lc === "thai";

  async function getWiktData(word) {
    try {
      const d = await json(`${WIKT}${encodeURIComponent(word)}?translations=true`);
      const entries = Array.isArray(d) ? d : (d?.entries || []);
      const senses = [], examples = [];
      for (const e of entries) {
        const pos = normalizePos(e.partOfSpeech || "");
        for (const s of (e.senses || [])) {
          const glosses = [];
          for (const t of (s.translations || [])) {
            const lc = (typeof t.language === "string" ? t.language : (t?.language?.code || t?.language?.name || "")).toLowerCase();
            if (isThaiLang(lc)) {
              const g = t.word || t.text || t.translation;
              if (g && isThaiText(g)) glosses.push(g);
            }
          }
          if (glosses.length) senses.push({ pos, definitionEn: s.definition || "", glosses: [...new Set(glosses)] });
          for (const ex of (s.examples || [])) {
            const text = typeof ex === "string" ? ex : (ex?.text || ex?.example || "");
            if (text) examples.push({ pos, text });
          }
        }
      }
      return { senses, examples };
    } catch { return { senses: [], examples: [] }; }
  }

  async function getGoogleDict(word) {
    try {
      const url = `${GTRANS}?client=gtx&sl=en&tl=th`
        + `&dt=t&dt=bd&dt=md&dt=ex&dt=ss`
        + `&q=${encodeURIComponent(word)}`;
      const d = await json(url);

      const mainTh = (d?.[0] || []).map(x => x?.[0] || "").join("").trim();

      const buckets = {};
      for (const entry of (d?.[1] || [])) {
        if (!Array.isArray(entry)) continue;
        const pos = normalizePos(entry?.[0] || "other");
        const senses = entry?.[1] || [];
        const list = [];
        for (const s of senses) {
          let gloss = "", reverse = [], score = 0;
          if (typeof s === "string") {
            gloss = s;
          } else if (Array.isArray(s)) {
            gloss   = String(s[0] || "");
            reverse = Array.isArray(s[1]) ? s[1].filter(x => typeof x === "string") : [];
            score   = Number(s[3] || 0);
          }
          gloss = gloss.trim();
          if (gloss && isThaiText(gloss)) list.push({ gloss, reverse, score });
        }
        if (list.length) {
          list.sort((a, b) => b.score - a.score);
          buckets[pos] = list;
        }
      }

      const gExamples = [];
      for (const arr of (d?.[13] || [])) {
        if (!Array.isArray(arr)) continue;
        for (const ex of arr) {
          const text = String(ex?.[0] || "").replace(/<[^>]+>/g, "").trim();
          if (text) gExamples.push({ pos: "", text });
        }
      }

      return { mainTh, buckets, gExamples };
    } catch { return { mainTh: "", buckets: {}, gExamples: [] }; }
  }

  async function translate(q) {
    if (!q) return "";
    try {
      const d = await json(`${GTRANS}?client=gtx&sl=en&tl=th&dt=t&q=${encodeURIComponent(q)}`);
      return (d?.[0] || []).map(x => x?.[0] || "").join("").trim();
    } catch {
      try {
        const d = await json(`${TRANS}?q=${encodeURIComponent(q)}&langpair=en|th`);
        const raw = d?.responseData?.translatedText || "";
        const el = document.createElement("textarea"); el.innerHTML = raw;
        return el.value;
      } catch { return ""; }
    }
  }

  async function getTatoebaExamples(word) {
    try {
      const target = `https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(word)}&from=eng&sort=relevance`;
      const r = await fetch(CORS_PROXY + encodeURIComponent(target));
      if (!r.ok) return [];
      const d = await r.json();
      const results = d?.results || [];
      return results.slice(0, 5)
        .map(x => ({ pos: "", text: String(x?.text || "").trim() }))
        .filter(x => x.text);
    } catch { return []; }
  }

  function mergeSenses(wiktSenses, googleBuckets) {
    const map = new Map();
    const put = (pos, gloss, reverse = [], defEn = "") => {
      if (!gloss) return;
      const key = normalizePos(pos);
      if (!map.has(key)) map.set(key, new Map());
      const bucket = map.get(key);
      const g = String(gloss).trim();
      if (!g || !isThaiText(g)) return;
      if (!bucket.has(g)) bucket.set(g, { reverse: new Set(), defEn: "" });
      const item = bucket.get(g);
      reverse.forEach(r => item.reverse.add(r));
      if (defEn && !item.defEn) item.defEn = defEn;
    };

    (wiktSenses || []).forEach(s => (s.glosses || []).forEach(g => put(s.pos, g, [], s.definitionEn || "")));
    Object.entries(googleBuckets || {}).forEach(([pos, list]) =>
      list.forEach(s => put(pos, s.gloss, s.reverse || [], ""))
    );

    const out = [];
    for (const [pos, bucket] of map.entries()) {
      const items = [];
      for (const [gloss, meta] of bucket.entries()) {
        items.push({ gloss, reverse: [...meta.reverse], defEn: meta.defEn });
      }
      out.push({ pos, items });
    }
    const order = { "n.":1, "v.":2, "adj.":3, "adv.":4 };
    out.sort((a, b) => (order[a.pos] || 9) - (order[b.pos] || 9));
    return out;
  }

  async function collectExamples(word, dictExamples, wiktExamples, gExamples) {
    const bag = [];
    const seen = new Set();
    const add = arr => (arr || []).forEach(e => {
      const t = String(e?.text || "").trim();
      const key = t.toLowerCase();
      if (t && !seen.has(key)) { seen.add(key); bag.push({ pos: e.pos || "", text: t }); }
    });

    add(dictExamples);
    add(wiktExamples);
    add(gExamples);
    if (bag.length < 3) add(await getTatoebaExamples(word));

    if (!bag.length) bag.push({ pos: "", text: `Try using "${word}" in your own sentence.` });
    return bag.slice(0, 6);
  }

  // ==================== SEARCH UI ====================
  let inputEl, menuEl, timer;

  async function showSuggestions() {
    const q = inputEl.value.trim();
    if (!q) { closeMenu(); return; }
    try {
      const raw = (await json(`${SUG}?s=${encodeURIComponent(q)}&max=12`)).map(x => x.word).filter(isEnglishWord);
      const checked = (await Promise.all(raw.map(async w => (await isRealWord(w)) ? w : null))).filter(Boolean).slice(0, 8);
      STATE.suggestions = checked;
      if (!checked.length) { closeMenu(); return; }
      menuEl.innerHTML = checked.map((w, i) =>
        `<li data-word="${esc(w)}"><span>${esc(w)}</span><span class="nb-suggest-score">${i===0?"คำแนะนำ":"คำใกล้เคียง"}</span></li>`
      ).join("");
      menuEl.classList.add("open");
      STATE.suggestIndex = -1;
      menuEl.querySelectorAll("li").forEach(li => li.onclick = () => choose(li.dataset.word));
    } catch { closeMenu(); }
  }
  function paint(li)   { li.forEach((x, i) => x.classList.toggle("active", i === STATE.suggestIndex)); }
  function choose(w)   { inputEl.value = w; closeMenu(); search(); }
  function closeMenu() { menuEl?.classList.remove("open"); if (menuEl) menuEl.innerHTML = ""; STATE.suggestIndex = -1; }

  async function search() {
    const q = inputEl.value.trim().toLowerCase();
    if (!q) return;
    if (!isEnglishWord(q)) {
      $("nb-result-area").innerHTML = `<div class="nb-card"><div class="nb-alert nb-warning">พิมพ์เฉพาะคำภาษาอังกฤษ (a-z, hyphen, apostrophe) เท่านั้น</div></div>`;
      return;
    }
    closeMenu();
    const token = ++STATE.searchToken;
    $("nb-result-area").innerHTML = "";
    $("nb-loading").style.display = "block";

    try {
      const [dict, rawFamily, level, wikt, gdict] = await Promise.all([
        dictLookup(q), getFamily(q), estimateLevel(q), getWiktData(q), getGoogleDict(q)
      ]);
      if (token !== STATE.searchToken) return;

      const n = normalize(dict);
      const mergedSenses = mergeSenses(wikt.senses, gdict.buckets);
      const examples = await collectExamples(n.word || q, n.examples, wikt.examples, gdict.gExamples);
      if (token !== STATE.searchToken) return;

      const [synonyms, antonyms, family, exampleTh] = await Promise.all([
        validRelated(n.synonyms, 8, n.word),
        validRelated(n.antonyms, 8, n.word),
        validFamily(rawFamily, n.word),
        Promise.all(examples.map(e => translate(e.text)))
      ]);
      if (token !== STATE.searchToken) return;

      STATE.current = {
        ...n,
        synonyms, antonyms, family,
        examples, exampleTh,
        mergedSenses,
        definitionTh: gdict.mainTh || "",
        level
      };
      renderResult();
    } catch {
      if (token !== STATE.searchToken) return;
      let suggestions = [];
      try {
        const raw = (await json(`${SUG}?s=${encodeURIComponent(q)}&max=12`)).map(x => x.word).filter(isEnglishWord);
        suggestions = (await Promise.all(raw.map(async w => (await isRealWord(w)) ? w : null))).filter(Boolean).slice(0, 8);
      } catch {}
      $("nb-result-area").innerHTML = `
        <div class="nb-card">
          <div class="nb-alert nb-warning">ไม่พบคำว่า <strong>${esc(q)}</strong> ลองเลือกคำที่สะกดใกล้เคียงด้านล่าง</div>
          <div class="nb-chip-row">${suggestions.map(w => `<button class="nb-near nb-chip nb-word-link" data-word="${esc(w)}">${esc(w)}</button>`).join("") || "ไม่พบคำแนะนำ"}</div>
        </div>`;
      document.querySelectorAll(".nb-near").forEach(b => b.onclick = () => choose(b.dataset.word));
    } finally {
      if (token === STATE.searchToken) $("nb-loading").style.display = "none";
    }
  }

  // ==================== RENDER RESULT ====================
  function chips(arr, cls = "") {
    return (arr || []).length
      ? arr.map(x => `<button type="button" class="nb-chip nb-word-link ${cls}" data-word="${esc(x)}">${esc(x)}</button>`).join("")
      : `<span class="nb-chip">—</span>`;
  }
  function familyHtml(f) {
    return Object.entries(f).map(([k, v]) => `
      <div class="nb-family-line">
        <strong>${k}</strong>
        <span class="nb-family-inline">
          ${v.length ? v.map(x => `<button type="button" class="nb-family-word nb-word-link" data-word="${esc(x)}">${esc(x)}</button>`).join(" ") : `<span class="nb-empty-family">—</span>`}
        </span>
      </div>`).join("");
  }

  function thaiMeaningHtml(w) {
    const senses = w.mergedSenses || [];
    if (!senses.length) return `<div class="nb-wd-def-th">${esc(w.definitionTh || "ไม่พบคำแปล")}</div>`;
    return senses.map(group => {
      const chipsHtml = group.items.map(it => `<span class="nb-sense-gloss">${esc(it.gloss)}</span>`).join("");
      const firstDef = group.items.find(it => it.defEn)?.defEn || "";
      const defEn = firstDef ? `<div class="nb-auto-note">${esc(firstDef)}</div>` : "";
      return `<div class="nb-pos-group">
        <span class="nb-pos-tag">${esc(group.pos)}</span>
        <div class="nb-sense-inline">${chipsHtml}</div>
        ${defEn}
      </div>`;
    }).join("");
  }

  function examplesHtml(w) {
    if (!w.examples?.length) return `<span class="nb-chip">ไม่พบตัวอย่าง</span>`;
    return w.examples.map((ex, i) => `
      <div class="nb-wd-example">
        ${ex.pos ? `<span class="nb-ex-pos">${esc(ex.pos)}</span>` : ""}
        <div class="nb-ex-text">${esc(ex.text)}</div>
        ${w.exampleTh[i] ? `<div class="nb-auto-note">${esc(w.exampleTh[i])}</div>` : ""}
      </div>`).join("");
  }

  function renderResult() {
    const w = STATE.current;
    const exists = STATE.words.some(x => x.word.toLowerCase() === w.word.toLowerCase());
    $("nb-result-area").innerHTML = `
      <div class="nb-word-detail">
        ${exists ? `<div class="nb-saved-banner">✅ คำนี้อยู่ใน Flashcard ของคุณแล้ว</div>` : ""}
        <div class="nb-wd-head">
          <span class="nb-wd-word">${esc(w.word)}</span>
          ${w.ipa ? `<span class="nb-wd-ipa">/${esc(w.ipa)}/</span>` : ""}
          ${w.audio ? `<button id="nb-audio-btn" class="nb-audio-btn" title="ฟังเสียงอ่าน">🔊</button>` : ""}
          <span class="nb-wd-level">${esc(w.pos)}</span>
          <span class="nb-wd-level nb-header-level">CEFR ~ ${esc(w.level)}</span>
          <button id="nb-add-btn" class="nb-btn nb-btn-primary nb-btn-add-small" ${exists ? "disabled" : ""}>${exists ? "✅ Added" : "➕ Add"}</button>
        </div>
        <div class="nb-auto-note nb-top-note">กด Add แล้วระบบจะบันทึกคำ เวลา และข้อมูลทั้งหมดอัตโนมัติ</div>
        <div class="nb-simple-result-grid">
          <div class="nb-info-box">
            <h4>ความหมายภาษาไทย แยกตามชนิดคำ</h4>
            ${thaiMeaningHtml(w)}
          </div>
          <div class="nb-info-box">
            <h4>ประโยคตัวอย่าง <span class="nb-section-hint">${w.examples.length} ประโยค</span></h4>
            ${examplesHtml(w)}
          </div>
          <div class="nb-info-box">
            <h4>Synonyms <span class="nb-section-hint">กดคำเพื่อค้นหาต่อ</span></h4>
            <div class="nb-chip-row">${chips(w.synonyms)}</div>
          </div>
          <div class="nb-info-box">
            <h4>Antonyms <span class="nb-section-hint">กดคำเพื่อค้นหาต่อ</span></h4>
            <div class="nb-chip-row">${chips(w.antonyms, "nb-antonym")}</div>
          </div>
          <div class="nb-info-box nb-full">
            <h4>Word Family <span class="nb-section-hint">กดคำเพื่อค้นหาต่อ</span></h4>
            <div class="nb-wd-family-grid">${familyHtml(w.family)}</div>
          </div>
        </div>
      </div>`;
    if (w.audio) { const ab = $("nb-audio-btn"); if (ab) ab.onclick = () => new Audio(w.audio).play().catch(() => {}); }
    $("nb-add-btn").onclick = addCurrent;
    document.querySelectorAll("#screen-notebook .nb-word-link").forEach(b => b.onclick = () => {
      inputEl.value = b.dataset.word;
      window.scrollTo({ top: 0, behavior: "smooth" });
      search();
    });
  }

  function addCurrent() {
    const w = STATE.current; if (!w) return;
    if (STATE.words.some(x => x.word.toLowerCase() === w.word.toLowerCase())) return;
    const level = w.level;
    const rec = {
      id: nextId(), word: w.word, pos: w.pos, level, ipa: w.ipa,
      definitionEn: w.definitionEn,
      definitionTh: (w.mergedSenses || []).map(g => g.items.map(i => i.gloss).join(", ")).filter(Boolean).join(" | ") || w.definitionTh,
      example:   w.examples[0]?.text || "",
      exampleTh: w.exampleTh[0] || "",
      examplesAll: w.examples.map((e, i) => ({ pos: e.pos, en: e.text, th: w.exampleTh[i] || "" })),
      synonyms: w.synonyms.map(x => ({ word: x, level })),
      antonyms: w.antonyms.map(x => ({ word: x, level })),
      family:   w.family,
      sensesTh: w.mergedSenses,
      collocations: [], phrases: [],
      tags: ["custom", today()],
      difficulty: difficulty(level),
      frequencyRank: 0,
      savedAt: new Date().toISOString()
    };
    STATE.words.push(rec); save(); renderResult(); renderMyList(); renderFCPreview();
    toast(`✅ เพิ่ม ${rec.word} เข้า Flashcard แล้ว`);
  }

  // ==================== MY LIST ====================
  function renderMyList() {
    const empty = $("nb-mylist-empty"), wrap = $("nb-mylist-table-wrap"), tbody = $("nb-mylist-tbody");
    if (!empty || !wrap || !tbody) return;
    if (!STATE.words.length) { empty.style.display = "block"; wrap.style.display = "none"; return; }
    empty.style.display = "none"; wrap.style.display = "block";
    tbody.innerHTML = [...STATE.words].reverse().map(w => `
      <tr>
        <td><b>${esc(w.word)}</b></td>
        <td>${esc(w.pos)}</td>
        <td>${esc(w.level)}</td>
        <td>${esc(w.definitionTh)}</td>
        <td>${esc((w.savedAt || "").slice(0, 10))}</td>
        <td><button class="nb-mini-btn nb-del" data-id="${w.id}" title="ลบคำนี้">🗑</button></td>
      </tr>`).join("");
    tbody.querySelectorAll(".nb-del").forEach(b => b.onclick = async () => {
      const id = b.dataset.id;
      const w = STATE.words.find(x => x.id == id);
      const ok = await nbConfirm(`ลบคำ "${w?.word || ""}" ออกจากคลังหรือไม่?`);
      if (!ok) return;
      STATE.words = STATE.words.filter(w => w.id != id);
      save(); renderMyList(); renderFCPreview();
    });
  }

  // ==================== FLASHCARDS (VOCAB-STYLE) ====================
  function filtered() {
    const l = $("nb-fc-level-filter").value;
    return STATE.words.filter(w => l === "ALL" || w.level === l);
  }
  function renderFCPreview() {
    const a = filtered();
    const empty = $("nb-fc-empty"); if (empty) empty.style.display = a.length ? "none" : "block";
    const grid = $("nb-fc-preview"); if (!grid) return;
    grid.innerHTML = a.map(w => `
      <div class="nb-fc-card-preview">
        <span class="nb-lvl">${esc(w.level)}</span>
        <div class="nb-w">${esc(w.word)}</div>
        <div class="nb-d">${esc(w.definitionTh)}</div>
      </div>`).join("");
  }

  // ---- TTS (uses browser's SpeechSynthesis) ----
  function speakText(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1.02;
    window.speechSynthesis.speak(u);
  }

  // ---- Review state builders ----
  function startReview(cards) {
    STATE.review = {
      cards,
      order: cards.map((_, i) => i),
      pos: 0,
      known: new Set(),
      flipped: false,
      lastSpokenKey: null
    };
    $("nb-review-modal").style.display = "flex";
    showReview();
  }

  function renderExtrasBack(w) {
    // Synonyms/Antonyms stored as [{word, level}, ...]  OR  ["word", ...]
    const asWords = arr => (arr || []).map(x => {
      if (x && typeof x === "object") return x.word || "";
      return String(x || "");
    }).filter(Boolean);

    const syns = asWords(w.synonyms);
    const ants = asWords(w.antonyms);
    const fam  = w.family || {};

    const chipList = (arr) => arr.length
      ? arr.map(v => `<span class="nb-vf-chip">${esc(v)}</span>`).join("")
      : "";
    const chipFamily = (f) => {
      const entries = Object.entries(f || {}).filter(([, v]) => v && v.length);
      if (!entries.length) return "";
      return entries.map(([p, v]) => {
        const val = Array.isArray(v) ? v.join(", ") : v;
        return `<span class="nb-vf-chip"><span class="nb-vf-pos">${esc(p)}</span>${esc(val)}</span>`;
      }).join("");
    };

    const synHtml = chipList(syns);
    const antHtml = chipList(ants);
    const famHtml = chipFamily(fam);

    $("nb-fc-syn").innerHTML = synHtml;
    $("nb-fc-ant").innerHTML = antHtml;
    $("nb-fc-fam").innerHTML = famHtml;

    $("nb-fc-syn-row").classList.toggle("empty", !synHtml);
    $("nb-fc-ant-row").classList.toggle("empty", !antHtml);
    $("nb-fc-fam-row").classList.toggle("empty", !famHtml);
  }

  function showReview() {
    const st = STATE.review;
    const cardArea = $("nb-review-card-area");
    const doneBox  = $("nb-review-done");
    const controls = $("nb-review-controls");
    const navRow   = $("nb-review-nav-row");

    // Done?
    if (st.pos >= st.order.length) {
      cardArea.style.display = "none";
      controls.style.display = "none";
      navRow.style.display = "none";
      doneBox.style.display = "block";
      $("nb-review-done-stats").textContent = `จำได้แล้ว ${st.known.size} จาก ${st.cards.length} คำ`;
      return;
    }

    cardArea.style.display = "";
    controls.style.display = "";
    navRow.style.display = "";
    doneBox.style.display = "none";

    const w     = st.cards[st.order[st.pos]];
    const total = st.order.length;
    const num   = String((w.id ?? (st.order[st.pos] + 1))).padStart(3, "0");
    const lvl   = w.level || "";

    // Both faces show index + level
    $("nb-fc-face-num").textContent   = "#" + num;
    $("nb-fc-back-num").textContent   = "#" + num;
    $("nb-fc-face-level").textContent = lvl;
    $("nb-fc-back-level").textContent = lvl;

    // Front
    $("nb-fc-face-word").textContent = w.word || "";
    $("nb-fc-face-pos").textContent  = w.pos  || "";

    // Back
    $("nb-fc-face-def-en").textContent  = w.definitionEn || "";
    $("nb-fc-face-def-th").textContent  = w.definitionTh || "";
    $("nb-fc-face-example").textContent = w.example ? `"${w.example}"` : "";

    // Extras (Syn / Ant / Family)
    renderExtrasBack(w);

    // Progress
    $("nb-review-index").textContent = st.pos + 1;
    $("nb-review-total").textContent = total;
    $("nb-review-known-label").textContent = "จำได้แล้ว: " + st.known.size;
    $("nb-review-progress-fill").style.width = Math.round(((st.pos) / total) * 100) + "%";

    // Reset flip
    st.flipped = false;
    $("nb-flashcard").classList.remove("flipped");

    // Nav button state
    $("nb-review-prev").disabled = st.pos === 0;
    $("nb-review-next").disabled = st.pos >= total - 1;

    // Auto-speak on card change (once per card)
    const key = `${st.pos}:${st.order[st.pos]}`;
    if (st.lastSpokenKey !== key) {
      st.lastSpokenKey = key;
      // Do not auto-speak by default; user can press TTS button
      // (Uncomment next line to enable auto-read)
      // speakText(w.word);
    }
  }

  function closeReview() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    $("nb-review-modal").style.display = "none";
  }

  function reviewPrev() {
    const st = STATE.review;
    if (st.pos > 0) { st.pos--; showReview(); }
  }
  function reviewSkip() {
    const st = STATE.review;
    if (st.pos < st.order.length - 1) { st.pos++; showReview(); }
  }
  function reviewKnown() {
    const st = STATE.review;
    if (st.pos >= st.order.length) return;
    st.known.add(st.order[st.pos]);
    st.pos++;
    showReview();
  }
  function reviewAgain() {
    const st = STATE.review;
    if (st.pos >= st.order.length) return;
    const cur = st.order[st.pos];
    st.order.splice(st.pos, 1);
    st.order.push(cur);
    // pos stays the same (points to the next card now)
    showReview();
  }
  function reviewShuffle() {
    const st = STATE.review;
    // Shuffle the remaining queue (from pos to end)
    const head = st.order.slice(0, st.pos);
    const tail = shuffleArr(st.order.slice(st.pos));
    st.order = [...head, ...tail];
    showReview();
    toast("สลับลำดับที่เหลือแล้ว");
  }
  function reviewRestart() {
    const st = STATE.review;
    st.order = st.cards.map((_, i) => i);
    st.pos = 0;
    st.known = new Set();
    st.flipped = false;
    st.lastSpokenKey = null;
    showReview();
  }

  // ==================== TAB SWITCHING ====================
  function setTab(name) {
    document.querySelectorAll("#screen-notebook .nb-tab-btn").forEach(x => x.classList.toggle("active", x.dataset.nbTab === name));
    document.querySelectorAll("#screen-notebook .nb-tab-panel").forEach(x => x.classList.toggle("active", x.id === `nb-tab-${name}`));
    if (name === "mylist")     renderMyList();
    if (name === "flashcards") renderFCPreview();
  }

  // ==================== TOAST + CONFIRM ====================
  function toast(msg) {
    const d = document.createElement("div");
    d.className = "nb-toast";
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1800);
  }

  function nbConfirm(msg) {
    if (typeof window.customConfirm === "function") {
      return window.customConfirm(msg, { title: "ยืนยันการลบ", icon: "🗑️", okText: "ลบ", cancelText: "ยกเลิก" });
    }
    return Promise.resolve(window.confirm(msg));
  }

  // ==================== HTML TEMPLATES ====================
  function screenHTML() {
    return `
      <button class="back-btn">◀ กลับหน้าแรก</button>
      <h2>📖 สมุดจดศัพท์ส่วนตัว</h2>

      <nav class="nb-tabs">
        <button class="nb-tab-btn active" data-nb-tab="search">🔍 ค้นหา &amp; บันทึก</button>
        <button class="nb-tab-btn" data-nb-tab="mylist">📚 คำของฉัน <span id="nb-cnt-badge" class="nb-badge">0</span></button>
        <button class="nb-tab-btn" data-nb-tab="flashcards">🃏 ท่องศัพท์</button>
      </nav>

      <!-- ค้นหา & บันทึก -->
      <section id="nb-tab-search" class="nb-tab-panel active">
        <div class="nb-card">
          <label for="nb-search-input" class="nb-search-label">พิมพ์คำศัพท์ภาษาอังกฤษที่ต้องการค้นหา</label>
          <div class="nb-search-row">
            <div class="nb-search-input-wrap">
              <input id="nb-search-input" type="text"
                     placeholder="เช่น wrecker, resilience, ambition..."
                     autocomplete="off" spellcheck="false" />
              <ul id="nb-word-suggestions" class="nb-word-suggestions"></ul>
            </div>
            <button id="nb-search-btn" class="nb-btn nb-btn-primary">🔍 ค้นหา</button>
          </div>
        </div>
        <div id="nb-loading" class="nb-loading" style="display:none;">
          <div class="nb-spinner"></div>
          <p>กำลังค้นหา...</p>
        </div>
        <div id="nb-result-area"></div>
      </section>

      <!-- คำของฉัน -->
      <section id="nb-tab-mylist" class="nb-tab-panel">
        <div class="nb-toolbar nb-card">
          <div><strong id="nb-list-count">0</strong> คำ · บันทึกไว้ในเบราว์เซอร์ (localStorage)</div>
          <div class="nb-toolbar-actions">
            <label class="nb-btn">
              📥 นำเข้า
              <input type="file" id="nb-import-file" accept=".json" style="display:none" />
            </label>
            <button id="nb-export-btn" class="nb-btn">📤 ส่งออก JSON</button>
            <button id="nb-clear-all-btn" class="nb-btn nb-btn-danger">🗑 ล้างทั้งหมด</button>
          </div>
        </div>
        <div id="nb-mylist-container">
          <div id="nb-mylist-empty" class="nb-empty-state nb-card" style="display:none;">
            <h3>ยังไม่มีคำที่บันทึก 📝</h3>
            <p>ไปที่แท็บ <strong>🔍 ค้นหา &amp; บันทึก</strong> เพื่อเริ่มเก็บคำศัพท์แรกของคุณ</p>
          </div>
          <div id="nb-mylist-table-wrap" class="nb-card" style="display:none;">
            <table class="nb-mylist-table">
              <thead>
                <tr>
                  <th>Word</th><th>POS</th><th>Level</th>
                  <th>แปลไทย</th><th>วันที่บันทึก</th><th></th>
                </tr>
              </thead>
              <tbody id="nb-mylist-tbody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ท่องศัพท์ -->
      <section id="nb-tab-flashcards" class="nb-tab-panel">
        <div class="nb-toolbar nb-card">
          <label>ระดับ:
            <select id="nb-fc-level-filter">
              <option value="ALL">ทั้งหมด</option>
              <option value="A1">A1</option><option value="A2">A2</option>
              <option value="B1">B1</option><option value="B2">B2</option>
              <option value="C1">C1</option><option value="C2">C2</option>
            </select>
          </label>
          <div class="nb-toolbar-actions">
            <button id="nb-fc-shuffle-btn" class="nb-btn">🔀 สุ่มลำดับ</button>
            <button id="nb-fc-start-btn" class="nb-btn nb-btn-primary">▶ เริ่มท่องศัพท์</button>
          </div>
        </div>
        <div id="nb-fc-preview" class="nb-fc-grid"></div>
        <div id="nb-fc-empty" class="nb-empty-state nb-card" style="display:none;">
          <h3>ยังไม่มีคำให้ท่อง 😅</h3>
          <p>เพิ่มคำจากหน้า <strong>🔍 ค้นหา</strong> ก่อนนะ</p>
        </div>
      </section>
    `;
  }

  function modalHTML() {
    return `
      <div class="nb-modal-backdrop"></div>
      <div class="nb-modal-body">
        <button class="nb-modal-close" id="nb-review-close">✕</button>
        <div class="nb-review-eyebrow">🃏 ท่องศัพท์</div>

        <div class="nb-review-progress-row">
          <span><span id="nb-review-index">1</span> / <span id="nb-review-total">1</span></span>
          <span id="nb-review-known-label">จำได้แล้ว: 0</span>
        </div>
        <div class="nb-review-progress-track">
          <div class="nb-review-progress-fill" id="nb-review-progress-fill"></div>
        </div>

        <div id="nb-review-card-area">
          <div class="nb-vc-stage">
            <div class="nb-vc" id="nb-flashcard">
              <div class="nb-vc-face nb-vc-front">
                <div class="nb-vc-index">
                  <span id="nb-fc-face-num">#001</span>
                  <span class="nb-vc-level-tag" id="nb-fc-face-level">B2</span>
                </div>
                <div class="nb-vc-front-word">
                  <div class="nb-vc-word" id="nb-fc-face-word">word</div>
                  <div class="nb-vc-pos" id="nb-fc-face-pos">n.</div>
                  <button class="nb-vc-tts-btn" id="nb-review-tts-btn" type="button" title="ฟังคำอ่าน">🔊 ฟังคำอ่าน</button>
                </div>
                <div class="nb-vc-flip-hint">แตะเพื่อดูความหมาย (หรือกด Space)</div>
              </div>
              <div class="nb-vc-face nb-vc-back">
                <div class="nb-vc-index">
                  <span id="nb-fc-back-num">#001</span>
                  <span class="nb-vc-level-tag" id="nb-fc-back-level">B2</span>
                </div>
                <div class="nb-vc-back-content">
                  <div class="nb-vc-def-en" id="nb-fc-face-def-en"></div>
                  <div class="nb-vc-def-th" id="nb-fc-face-def-th"></div>
                  <div class="nb-vc-example" id="nb-fc-face-example"></div>
                  <div class="nb-vc-extra">
                    <div class="nb-vc-extra-row" id="nb-fc-syn-row">
                      <span class="nb-vc-extra-label nb-vc-extra-syn">Syn</span>
                      <span class="nb-vc-extra-content" id="nb-fc-syn"></span>
                    </div>
                    <div class="nb-vc-extra-row" id="nb-fc-ant-row">
                      <span class="nb-vc-extra-label nb-vc-extra-ant">Ant</span>
                      <span class="nb-vc-extra-content" id="nb-fc-ant"></span>
                    </div>
                    <div class="nb-vc-extra-row" id="nb-fc-fam-row">
                      <span class="nb-vc-extra-label nb-vc-extra-fam">Family</span>
                      <span class="nb-vc-extra-content" id="nb-fc-fam"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="nb-vc-controls" id="nb-review-controls">
          <button class="nb-vc-btn nb-vc-btn-again" id="nb-review-again" type="button">↺ Again</button>
          <button class="nb-vc-btn nb-vc-btn-known" id="nb-review-known" type="button">✓ Know</button>
        </div>

        <div class="nb-vc-nav-row" id="nb-review-nav-row">
          <button class="nb-vc-nav-btn" id="nb-review-prev" type="button">‹ ก่อนหน้า</button>
          <button class="nb-vc-nav-btn nb-vc-nav-btn-shuffle" id="nb-review-shuffle" type="button">⤭ สลับใหม่</button>
          <button class="nb-vc-nav-btn" id="nb-review-next" type="button">ข้าม ›</button>
        </div>

        <div class="nb-vc-done-box" id="nb-review-done" style="display:none">
          <h3>เยี่ยมมาก! ทบทวนครบแล้ว 🎉</h3>
          <p id="nb-review-done-stats">จำได้แล้ว 0 จาก 0 คำ</p>
          <div class="nb-vc-done-actions">
            <button class="nb-vc-btn nb-vc-btn-shuffle" id="nb-review-restart" type="button">ทบทวนอีกครั้ง</button>
            <button class="nb-vc-btn nb-vc-btn-known" id="nb-review-close2" type="button">ปิด</button>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== INJECT + BIND ====================
  function injectMode() {
    const vocabHead = document.querySelector(".home-section-head-vocab");
    const vocabSection = vocabHead?.closest(".home-section");
    const vocabCards = vocabSection?.querySelector(".mode-cards");
    if (!vocabCards) return;
    if (vocabCards.querySelector("[data-mode='notebook']")) return;

    const card = document.createElement("div");
    card.className = "mode-card mode-card-vocab";
    card.setAttribute("data-mode", "notebook");
    card.innerHTML = `<div style="font-size:48px">📖</div><h3>สมุดจดศัพท์ส่วนตัว</h3><p>ค้นคำใหม่ + บันทึกเป็น Flashcard ของตัวเอง</p>`;
    card.addEventListener("click", openNotebook);
    vocabCards.appendChild(card);
  }

  function injectScreen() {
    const container = document.querySelector(".container");
    if (!container) return;
    if ($("screen-notebook")) return;
    const screen = document.createElement("div");
    screen.className = "screen";
    screen.id = "screen-notebook";
    screen.innerHTML = screenHTML();
    container.appendChild(screen);
  }

  function injectModal() {
    if ($("nb-review-modal")) return;
    const modal = document.createElement("div");
    modal.className = "nb-modal";
    modal.id = "nb-review-modal";
    modal.style.display = "none";
    modal.innerHTML = modalHTML();
    document.body.appendChild(modal);
  }

  function bindEvents() {
    // Search input
    inputEl = $("nb-search-input");
    menuEl  = $("nb-word-suggestions");

    inputEl.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(showSuggestions, 150); });
    inputEl.addEventListener("keydown", e => {
      const li = [...menuEl.querySelectorAll("li")];
      if (e.key === "ArrowDown") { e.preventDefault(); STATE.suggestIndex = (STATE.suggestIndex + 1) % Math.max(li.length, 1); paint(li); }
      else if (e.key === "ArrowUp") { e.preventDefault(); STATE.suggestIndex = (STATE.suggestIndex - 1 + li.length) % Math.max(li.length, 1); paint(li); }
      else if (e.key === "Enter") { e.preventDefault(); if (li[STATE.suggestIndex]) choose(li[STATE.suggestIndex].dataset.word); else search(); }
      else if (e.key === "Escape") closeMenu();
    });
    document.addEventListener("click", e => { if (!e.target.closest(".nb-search-input-wrap")) closeMenu(); });

    $("nb-search-btn").onclick = search;

    // Tab switching
    document.querySelectorAll("#screen-notebook .nb-tab-btn").forEach(b =>
      b.addEventListener("click", () => setTab(b.dataset.nbTab))
    );

    // MyList: Export / Import / Clear
    $("nb-export-btn").onclick = () => {
      if (!STATE.words.length) { toast("ยังไม่มีคำ"); return; }
      const payload = {
        version: 3, source: "Custom", batch: 1, level: "Mixed",
        totalWords: STATE.words.length,
        metadata: { created: today(), language: "en", description: "My personal vocabulary" },
        words: STATE.words.map(({ savedAt, ...w }) => w)
      };
      const u = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = u; a.download = `my-vocab-${today()}.json`; a.click();
      URL.revokeObjectURL(u);
    };
    $("nb-import-file").onchange = async e => {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        let added = 0;
        for (const w of (d.words || [])) {
          if (w.word && !STATE.words.some(x => x.word.toLowerCase() === w.word.toLowerCase())) {
            STATE.words.push({ ...w, id: nextId(), savedAt: new Date().toISOString() });
            added++;
          }
        }
        save(); renderMyList(); renderFCPreview();
        toast(`นำเข้า ${added} คำสำเร็จ`);
      } catch { toast("ไฟล์ไม่ถูกต้อง"); }
      e.target.value = "";
    };
    $("nb-clear-all-btn").onclick = async () => {
      const ok = await nbConfirm("ต้องการลบคำทั้งหมดใช่หรือไม่?\nข้อมูลจะไม่สามารถกู้คืนได้");
      if (ok) { STATE.words = []; save(); renderMyList(); renderFCPreview(); }
    };

    // Flashcards preview
    $("nb-fc-level-filter").onchange = renderFCPreview;
    $("nb-fc-shuffle-btn").onclick   = () => { STATE.words.sort(() => Math.random() - .5); save(); renderFCPreview(); toast("สลับลำดับแล้ว"); };
    $("nb-fc-start-btn").onclick     = () => {
      const a = filtered();
      if (!a.length) { toast("ยังไม่มีคำ"); return; }
      startReview(a);
    };

    // ---- Review modal wiring (vocab-style) ----
    // Tap card to flip
    $("nb-flashcard").addEventListener("click", () => {
      const st = STATE.review;
      st.flipped = !st.flipped;
      $("nb-flashcard").classList.toggle("flipped", st.flipped);
    });

    // TTS button (don't propagate to card flip)
    $("nb-review-tts-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const st = STATE.review;
      if (st.pos < st.order.length) speakText(st.cards[st.order[st.pos]].word);
    });

    // Controls (Again / Know) — stop propagation so tapping them doesn't flip
    $("nb-review-again").addEventListener("click", (e) => { e.stopPropagation(); reviewAgain(); });
    $("nb-review-known").addEventListener("click", (e) => { e.stopPropagation(); reviewKnown(); });

    // Nav row (Prev / Shuffle / Skip)
    $("nb-review-prev").addEventListener("click", reviewPrev);
    $("nb-review-shuffle").addEventListener("click", reviewShuffle);
    $("nb-review-next").addEventListener("click", reviewSkip);

    // Done box actions
    $("nb-review-restart").addEventListener("click", reviewRestart);
    $("nb-review-close2").addEventListener("click", closeReview);

    // Close X + backdrop
    $("nb-review-close").addEventListener("click", closeReview);
    document.querySelector("#nb-review-modal .nb-modal-backdrop").addEventListener("click", closeReview);

    // Keyboard shortcuts (review modal only)
    document.addEventListener("keydown", e => {
      const modal = $("nb-review-modal");
      if (!modal || modal.style.display !== "flex") return;
      // Don't hijack typing when focused on an input
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;

      if (e.code === "Space")           { e.preventDefault(); $("nb-flashcard").click(); }
      else if (e.key === "Escape")      { e.preventDefault(); closeReview(); }
      else if (e.key === "ArrowLeft")   { e.preventDefault(); reviewPrev(); }
      else if (e.key === "ArrowRight")  { e.preventDefault(); reviewSkip(); }
      else if (e.key.toLowerCase() === "k") { e.preventDefault(); reviewKnown(); }
      else if (e.key.toLowerCase() === "a") { e.preventDefault(); reviewAgain(); }
    });
  }

  // ==================== OPEN NOTEBOOK SCREEN ====================
  function openNotebook() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const container = document.querySelector(".container");
    if (container) container.classList.remove("is-results");
    $("screen-notebook").classList.add("active");
    load();
    renderMyList();
    renderFCPreview();
    setTab("search");
  }

  // ==================== INIT ====================
  function init() {
    if (STATE.ready) return;
    injectMode();
    injectScreen();
    injectModal();
    bindEvents();
    load();
    renderMyList();
    renderFCPreview();
    STATE.ready = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
