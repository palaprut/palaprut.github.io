// ============ DAY / NIGHT THEME ============
const THEME_KEY = "tenses_theme";
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.querySelector("#settings-toggle-btn .settings-toggle-icon");
  if(icon) icon.textContent = theme === "dark" ? "☀️" : "⚙️";
}
function getInitialTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved === "dark" || saved === "light") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
applyTheme(getInitialTheme());
document.addEventListener("DOMContentLoaded", () => {
  const settingsBtn = document.getElementById("settings-toggle-btn");
  const settingsOverlay = document.getElementById("settings-overlay");
  const settingsCloseBtn = document.getElementById("settings-close-btn");
  const settingsThemeBtn = document.getElementById("settings-theme-btn");
  const settingsTtsToggle = document.getElementById("settings-tts-toggle");
  const settingsVoiceSelect = document.getElementById("settings-tts-voice-select");
  const settingsVocabWordsPerDay = document.getElementById("settings-vocab-words-per-day");
  const settingsVocabStartDate = document.getElementById("settings-vocab-start-date");
  if(settingsBtn){
    settingsBtn.onclick = () => {
      if(settingsOverlay){
        settingsOverlay.classList.add("active");
        settingsOverlay.setAttribute("aria-hidden", "false");
      }
    };
  }
  const closeSettings = () => {
    if(settingsOverlay){
      settingsOverlay.classList.remove("active");
      settingsOverlay.setAttribute("aria-hidden", "true");
    }
  };
  if(settingsCloseBtn) settingsCloseBtn.onclick = closeSettings;
  if(settingsOverlay) settingsOverlay.onclick = e => { if(e.target === settingsOverlay) closeSettings(); };
  document.addEventListener("keydown", e => { if(e.key === "Escape") closeSettings(); });
  if(settingsThemeBtn){
    settingsThemeBtn.onclick = () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      settingsThemeBtn.classList.remove("spin"); void settingsThemeBtn.offsetWidth; settingsThemeBtn.classList.add("spin");
    };
  }
  if(settingsTtsToggle){
    settingsTtsToggle.checked = isAutoReadEnabled();
    settingsTtsToggle.onchange = () => setAutoReadEnabled(settingsTtsToggle.checked);
  }
  if(settingsVoiceSelect){
    settingsVoiceSelect.onchange = () => {
      const picked = ttsVoices.find(v => v.voiceURI === settingsVoiceSelect.value);
      if(picked){
        ttsChosenVoice = picked;
        localStorage.setItem(TTS_VOICE_KEY, picked.voiceURI);
        speakText("This is what I sound like now.");
      }
    };
  }
  if(settingsVocabWordsPerDay){
    settingsVocabWordsPerDay.value = getVocabWordsPerDay();
    settingsVocabWordsPerDay.onchange = () => {
      const nextValue = setVocabWordsPerDay(settingsVocabWordsPerDay.value);
      settingsVocabWordsPerDay.value = nextValue;
      vocabState = buildVocabStructure();
      if(document.getElementById("screen-vocab")?.classList.contains("active")) {
        openVocabHome();
      }
    };
  }
  if(settingsVocabStartDate){
    settingsVocabStartDate.value = getVocabStartDate();
    settingsVocabStartDate.onchange = () => {
      setVocabStartDate(settingsVocabStartDate.value);
      vocabState = buildVocabStructure();
      if(document.getElementById("screen-vocab")?.classList.contains("active")) {
        openVocabHome();
      }
    };
  }
  applyTheme(getInitialTheme());
});

// ============ BUILD SETS (round-robin) ============
// QUESTIONS is populated asynchronously from questions.json (see initApp() at bottom of this file)
let QUESTIONS = [];
let SETS = [];

function buildSets(){
  SETS = Array.from({length:10}, () => []);
  QUESTIONS.forEach((q, i) => SETS[i % 10].push(i));
  for(let i=0;i<SETS.length;i++) SETS[i] = shuffleArr(SETS[i]);
}
// Shuffle helper (used by buildSets)
function shuffleArr(a){const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}

// ============ APP STATE ============
const state = {currentQuiz: null, chartInstances: {}};
const HK = "tenses_history_v4";

// ============ TEXT-TO-SPEECH (auto-read question) ============
const TTS_KEY = "tenses_tts_autoread";
const TTS_VOICE_KEY = "tenses_tts_voice";
const isAutoReadEnabled = () => localStorage.getItem(TTS_KEY) === "1";
function syncTtsToggleUI(){
  document.querySelectorAll(".tts-toggle input").forEach(toggle => {
    toggle.checked = isAutoReadEnabled();
  });
}
const setAutoReadEnabled = on => {
  localStorage.setItem(TTS_KEY, on ? "1" : "0");
  syncTtsToggleUI();
};

let ttsVoices = [];
let ttsChosenVoice = null;

// Rank voices so natural/neural cloud voices (Google, Microsoft "Online/Natural", Apple)
// are offered before the old robotic offline/default engines.
function voiceQualityScore(v){
  const n = v.name.toLowerCase();
  let score = 0;
  if(/online|natural|neural/.test(n)) score += 100;
  if(/google/.test(n)) score += 60;
  if(/microsoft/.test(n) && /aria|jenny|guy|ryan/.test(n)) score += 60;
  if(/samantha|daniel|karen|moira|tessa|alex/.test(n)) score += 40; // decent Apple voices
  if(/^en-us|^en-gb|^en_/.test(v.lang.toLowerCase()) || v.lang.toLowerCase().startsWith("en")) score += 20;
  if(/compact|espeak|robot/.test(n)) score -= 50;
  return score;
}

function loadTtsVoices(){
  ttsVoices = (window.speechSynthesis?.getVoices() || []).filter(v => v.lang && v.lang.toLowerCase().startsWith("en"));
  if(ttsVoices.length === 0) ttsVoices = window.speechSynthesis?.getVoices() || [];
  ttsVoices.sort((a,b) => voiceQualityScore(b) - voiceQualityScore(a));

  const savedURI = localStorage.getItem(TTS_VOICE_KEY);
  const selects = Array.from(document.querySelectorAll(".tts-voice-select"));
  selects.forEach(select => {
    select.innerHTML = ttsVoices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    const match = ttsVoices.find(v => v.voiceURI === savedURI);
    const picked = match || ttsChosenVoice || ttsVoices[0] || null;
    if(picked){
      ttsChosenVoice = picked;
      select.value = picked.voiceURI;
    }
    select.style.display = ttsVoices.length > 1 ? "" : "none";
  });

  if(selects.length === 0){
    ttsChosenVoice = ttsVoices.find(v => v.voiceURI === savedURI) || ttsVoices[0] || null;
  }
}
if("speechSynthesis" in window){
  loadTtsVoices();
  window.speechSynthesis.onvoiceschanged = loadTtsVoices;
}

function speakText(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // stop anything currently being read
  // Replace underscores (blank spaces in the question) with spaced commas so the
  // speech engine pauses there instead of skipping over them silently.
  const spoken = String(text).replace(/_+/g, " , , , ");
  const utter = new SpeechSynthesisUtterance(spoken);
  if(ttsChosenVoice){
    utter.voice = ttsChosenVoice;
    utter.lang = ttsChosenVoice.lang;
  } else {
    utter.lang = "en-US";
  }
  // rate close to natural speaking pace + a touch of pitch variation reads
  // less flat/robotic than the previous fixed 0.9 rate with default pitch.
  utter.rate = 0.95;
  utter.pitch = 1.02;
  window.speechSynthesis.speak(utter);
}

// ============ UTILS ============
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const formatQuestionBlank = s => esc(s).replace(/_+/g, m => `<span class="blank-underscore">${m}</span>`);
const shuffle = shuffleArr;
const showScreen = id => {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const container = document.querySelector('.container');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  // when showing results, make the outer container act as the results card
  if (container) {
    if (id === 'screen-results') container.classList.add('is-results');
    else container.classList.remove('is-results');
  }
};
const levelClass = l => ({"A1-A2":"level-a12","B1":"level-b1","B2-C1":"level-b2c1"}[l]||"level-a12");
const lvlBar = l => ({"A1-A2":"lvl-a12","B1":"lvl-b1","B2-C1":"lvl-b2c1"}[l]||"lvl-a12");
const getHist = () => {try{return JSON.parse(localStorage.getItem(HK))||[]}catch{return []}};
const saveHist = r => {const h=getHist();h.push(r);localStorage.setItem(HK,JSON.stringify(h));};
const fmtDate = iso => new Date(iso).toLocaleString("th-TH",{dateStyle:"short",timeStyle:"short"});
const destroyChart = n => {if(state.chartInstances[n]){state.chartInstances[n].destroy();delete state.chartInstances[n];}};
// Fallback: ถ้า Chart.js โหลดไม่ได้จาก CDN จะไม่ให้หน้า Results/History พัง
if (typeof Chart === "undefined") {
  window.Chart = function(){ return { destroy:function(){} }; };
}
function customConfirm(message, opts = {}){
  return new Promise(resolve => {
    const overlay = document.getElementById("app-modal-overlay");
    const title = document.getElementById("app-modal-title");
    const msg = document.getElementById("app-modal-message");
    const icon = document.getElementById("app-modal-icon");
    const ok = document.getElementById("app-modal-ok");
    const cancel = document.getElementById("app-modal-cancel");
    title.textContent = opts.title || "ยืนยันการทำรายการ";
    msg.textContent = message || "";
    icon.textContent = opts.icon || "⚠️";
    ok.textContent = opts.okText || "ตกลง";
    cancel.textContent = opts.cancelText || "ยกเลิก";
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    const cleanup = (val) => { overlay.classList.remove("active"); overlay.setAttribute("aria-hidden", "true"); ok.onclick=null; cancel.onclick=null; overlay.onclick=null; document.onkeydown=null; resolve(val); };
    ok.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
    overlay.onclick = e => { if(e.target === overlay) cleanup(false); };
    document.onkeydown = e => { if(e.key === "Escape") cleanup(false); };
  });
}

// Fallback: ถ้า Chart.js โหลดไม่ได้จาก CDN จะไม่ให้หน้า Results/History พัง
if (typeof Chart === "undefined") {
  window.Chart = function(){ return { destroy:function(){} }; };
}


// ============ HOME ============
document.querySelectorAll(".mode-card").forEach(c => c.onclick = () => {
  const m = c.dataset.mode;
  if(m==="set"){initSets();showScreen("screen-sets");}
  else if(m==="random"){resetRandom();showScreen("screen-random");}
  else if(m==="learn"){renderLearn();showScreen("screen-learn");}
  else if(m==="vocab"){openVocabHome();showScreen("screen-vocab");}
  else if(m==="vocab-stats"){if(!vocabState) vocabState = buildVocabStructure();showScreen("screen-vocab");showVocabSub("vocab-stats");renderVocabStats();}
  else {renderHistory();showScreen("screen-history");}
});
// document.querySelectorAll(".back-btn").forEach(b => b.onclick = () => showScreen("screen-home"));
document.addEventListener("click",(e)=>{

    if(e.target.classList.contains("back-btn")){
        showScreen("screen-home");
    }

});
// ============ SETS ============
function initSets(){
  const c = document.getElementById("set-cards");
  c.innerHTML = "";
  SETS.forEach((s,i) => {
    const el = document.createElement("div");
    el.className = "set-card";
    el.innerHTML = `<div style="font-size:32px">📖</div><h3>Set ${i+1}</h3><p>${s.length} ข้อ</p>`;
    el.onclick = () => startQuiz("set", {setIndex:i+1}, s);
    c.appendChild(el);
  });
}

// ============ RANDOM ============
let rSel = {lvl:null, count:null};
function resetRandom(){
  rSel = {lvl:null, count:null};
  document.querySelectorAll(".difficulty-btn,.count-btn").forEach(b=>b.classList.remove("active"));
  updateRandomStatus();
}
function poolFor(lvl){
  return lvl==="Mixed" 
    ? QUESTIONS.map((_,i)=>i) 
    : QUESTIONS.map((q,i)=>q.level===lvl?i:-1).filter(i=>i>=0);
}
function updateRandomStatus(){
  const s = document.getElementById("random-status");
  const btn = document.getElementById("random-start");
  if(!rSel.lvl){s.textContent = "กรุณาเลือกระดับความยากก่อน";btn.disabled = true;return;}
  const p = poolFor(rSel.lvl);
  s.textContent = `จำนวนข้อในคลัง (${rSel.lvl}): ${p.length} ข้อ`;
  btn.disabled = !(rSel.count && p.length >= rSel.count);
}
document.querySelectorAll(".difficulty-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".difficulty-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  rSel.lvl = b.dataset.lvl;
  updateRandomStatus();
});
document.querySelectorAll(".count-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".count-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  rSel.count = parseInt(b.dataset.count);
  updateRandomStatus();
});
document.getElementById("random-start").onclick = () => {
  const p = poolFor(rSel.lvl);
  const pick = shuffle(p).slice(0, rSel.count);
  startQuiz("random", {level:rSel.lvl, count:rSel.count}, pick);
};

// ============ START QUIZ ============
function startQuiz(mode, params, indices){
  const shIdx = shuffle(indices);
  const items = shIdx.map(i => {
    const s = QUESTIONS[i];
    return {q:s.q, choices:shuffle(s.choices), answer:s.answer, tense:s.tense, level:s.level, explain:s.explain, srcIndex:i};
  });
  state.currentQuiz = {mode, params, items, answers:new Array(items.length).fill(null), current:0};
  showScreen("screen-quiz");
  renderQuestion();
}


function renderQuestion(){
  const cq = state.currentQuiz;
  if(!cq || !cq.items || cq.items.length === 0) return;

  // Keep current question index in valid range
  if(cq.current < 0) cq.current = 0;
  if(cq.current >= cq.items.length) cq.current = cq.items.length - 1;

  const it = cq.items[cq.current];
  const total = cq.items.length;
  const answered = cq.answers.filter(a => a !== null).length;
  const pct = Math.round(((cq.current + 1) / total) * 100);
  const titleEl = document.getElementById("quiz-title");
  if(titleEl){
    if(cq.mode === "set") titleEl.innerHTML = `<span class="pill">📖 Set ${esc(cq.params.setIndex)}</span>`;
    else if(cq.mode === "tense") titleEl.innerHTML = `<span class="pill">🎯 ${esc(cq.params.tense)} • ${total} ข้อ</span>`;
    else titleEl.innerHTML = `<span class="pill">🎲 Random ${esc(cq.params.level || "Mixed")} • ${total} ข้อ</span>`;
  }

  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("quiz-info").textContent = `ข้อ ${cq.current + 1}/${total} • ตอบแล้ว ${answered}/${total}`;
  document.getElementById("question-badge").textContent = `${it.tense} • ${it.level}`;
  document.getElementById("question-text").innerHTML = formatQuestionBlank(it.q);

  // Auto-read: only speak when we've actually moved to a different question,
  // not on every re-render (e.g. when just selecting a choice).
  if(cq._lastSpokenIndex !== cq.current){
    cq._lastSpokenIndex = cq.current;
    if(isAutoReadEnabled()) speakText(it.q);
  }

  const choices = document.getElementById("choices");
  choices.innerHTML = "";
  it.choices.forEach(ch => {
    const btn = document.createElement("button");
    btn.className = "choice-btn" + (cq.answers[cq.current] === ch ? " selected" : "");
    btn.textContent = ch;
    btn.onclick = () => {
      cq.answers[cq.current] = ch;
      renderQuestion();
    };
    choices.appendChild(btn);
  });

  document.getElementById("prev-btn").disabled = cq.current === 0;
  document.getElementById("next-btn").disabled = cq.current === total - 1;
  document.getElementById("submit-btn").style.display = cq.current === total - 1 ? "inline-block" : "inline-block";

  renderQuestionNav();
}

function renderQuestionNav(){

    const cq = state.currentQuiz;

    const nav =
        document.getElementById("question-nav");

    if(!nav || !cq) return;

    const answeredCount = cq.answers.filter(a => a !== null).length;
    const countEl = document.getElementById("question-nav-count");
    if(countEl) countEl.textContent = `${cq.current+1}/${cq.items.length} • ตอบแล้ว ${answeredCount}`;

    nav.innerHTML = "";

    cq.items.forEach((item,index)=>{

        const btn =
            document.createElement("button");

        btn.classList.add("q-nav-btn");

        if(index === cq.current){

            btn.classList.add("current");

        }else if(cq.answers[index] !== null){

            btn.classList.add("answered");

        }else{

            btn.classList.add("unanswered");

        }

        btn.textContent = index + 1;

        btn.onclick = ()=>{

            cq.current = index;

            renderQuestion();

        };

        nav.appendChild(btn);

    });
}
document.getElementById("prev-btn").onclick = () => {
  const cq = state.currentQuiz;
  if(!cq) return;
  cq.current = Math.max(0, cq.current - 1);
  renderQuestion();
};
document.getElementById("next-btn").onclick = () => {
  const cq = state.currentQuiz;
  if(!cq) return;
  cq.current = Math.min(cq.items.length - 1, cq.current + 1);
  renderQuestion();
};
document.getElementById("submit-btn").onclick = async () => {
  const cq = state.currentQuiz;
  if(!cq) return;
  const un = cq.answers.filter(a=>a===null).length;
  if(un>0){
    const ok = await customConfirm(`ยังตอบไม่ครบ ${un} ข้อ
ต้องการส่งคำตอบเลยหรือไม่?`, {title:"ส่งคำตอบ", icon:"📝", okText:"ส่งคำตอบ", cancelText:"กลับไปทำต่อ"});
    if(!ok) return;
  }
  finishQuiz();
};

document.getElementById("exit-quiz-btn").onclick = async () => {
  const ok = await customConfirm("ต้องการออกจากข้อสอบหรือไม่?\nความคืบหน้าจะไม่ถูกบันทึก", {title:"ออกจากข้อสอบ", icon:"🚪", okText:"ออกจากข้อสอบ", cancelText:"ทำต่อ"});
  if(ok){state.currentQuiz=null;showScreen("screen-home");}
};
// ============ FINISH + RESULTS ============
function computeStats(items, answers){
  let correct = 0;
  const pL = {}, pT = {};
  items.forEach((it, i) => {
    const ok = answers[i] === it.answer;
    if(ok) correct++;
    pL[it.level] = pL[it.level] || {c:0, t:0};
    pL[it.level].t++;
    if(ok) pL[it.level].c++;
    pT[it.tense] = pT[it.tense] || {c:0, t:0};
    pT[it.tense].t++;
    if(ok) pT[it.tense].c++;
  });
  const total = items.length;
  const pct = total ? Math.round(correct/total*100) : 0;
  return {correct, total, pct, pL, pT};
}

function finishQuiz(){
  const cq = state.currentQuiz;
  const {correct, total, pct, pL, pT} = computeStats(cq.items, cq.answers);
  const hist = getHist();
  const prev = hist[hist.length-1];
  // Store a lean copy of each item (no shuffled choices needed for review) plus the user's answers,
  // so this attempt can be reopened later from the history screen with full detail.
  const itemsForHistory = cq.items.map(it => ({
    q: it.q, tense: it.tense, level: it.level, explain: it.explain, answer: it.answer, srcIndex: it.srcIndex
  }));
  const rec = {date:new Date().toISOString(), mode:cq.mode, params:cq.params, correct, total, percentage:pct, items:itemsForHistory, answers:cq.answers};
  saveHist(rec);
  showResults({correct, total, pct, pL, pT, prev, items:cq.items, answers:cq.answers});
}

// Reopen a past attempt from the history screen in the same full results view (charts + detail).
function viewHistoryResult(idx){
  const hist = getHist();
  const rec = hist[idx];
  if(!rec || !rec.items){
    // Older history entries saved before this feature won't have item detail.
    customConfirm("ประวัติรายการนี้บันทึกไว้ก่อนที่จะรองรับการดูรายละเอียดแบบเต็ม จึงไม่มีข้อมูลให้แสดงครับ", {title:"ไม่มีรายละเอียด", icon:"ℹ️", okText:"เข้าใจแล้ว", cancelText:"ปิด"});
    return;
  }
  const {correct, total, pct, pL, pT} = computeStats(rec.items, rec.answers);
  const prev = hist[idx-1];
  // Let "ทำใหม่" work from a historical view too, by restoring it as the active quiz.
  state.currentQuiz = {mode:rec.mode, params:rec.params, items:rec.items, answers:rec.answers, current:0};
  showResults({correct, total, pct, pL, pT, prev, items:rec.items, answers:rec.answers});
}

function showResults(r){
  showScreen("screen-results");
  document.getElementById("score-num").textContent = r.pct + "%";
  document.getElementById("score-fraction").textContent = r.correct + "/" + r.total + " ข้อ";
  document.getElementById("score-circle").style.setProperty("--p", r.pct);
  let em="📚", en="สู้ๆ ครั้งหน้าดีขึ้นแน่นอน!";
  if(r.pct>=90){em="🏆"; en="ยอดเยี่ยมมาก! คุณเก่งจริง!";}
  else if(r.pct>=75){em="🎉"; en="ทำได้ดีมาก!";}
  else if(r.pct>=60){em="👍"; en="เกือบดีแล้ว ทบทวนอีกนิด!";}
  else if(r.pct>=40){em="💪"; en="พยายามต่อไป ทบทวนจุดที่ผิด!";}
  document.getElementById("score-emoji").textContent = em;
  document.getElementById("score-encouragement").textContent = en;
  const comp = document.getElementById("score-comparison");
  if(r.prev){
    const d = r.pct - r.prev.percentage;
    if(d>0) comp.innerHTML = `<span style="color:#4caf50">▲ ดีขึ้น +${d}% จากครั้งก่อน (${r.prev.percentage}%)</span>`;
    else if(d<0) comp.innerHTML = `<span style="color:#f44336">▼ ลดลง ${d}% จากครั้งก่อน (${r.prev.percentage}%)</span>`;
    else comp.innerHTML = `<span style="color:#666">= เท่าเดิม (${r.prev.percentage}%)</span>`;
  } else {
    comp.innerHTML = `<span style="color:#666">🎯 นี่คือครั้งแรกของคุณ!</span>`;
  }
  const sm = document.getElementById("summary-metrics");
  if(sm){
    const wrong = r.total - r.correct;
    const bestLevel = Object.entries(r.pL).sort((a,b)=>(b[1].c/b[1].t)-(a[1].c/a[1].t))[0];
    const weakCount = Object.entries(r.pT).filter(([t,v])=>v.c/v.t < 0.6).length;
    sm.innerHTML = `
      <div class="summary-metric"><div class="metric-label">คะแนนรวม</div><div class="metric-value">${r.pct}%</div><div class="metric-sub">${r.correct}/${r.total} ข้อ</div></div>
      <div class="summary-metric"><div class="metric-label">ตอบถูก</div><div class="metric-value">${r.correct}</div><div class="metric-sub">ผิด ${wrong} ข้อ</div></div>
      <div class="summary-metric"><div class="metric-label">ระดับที่ทำได้ดีที่สุด</div><div class="metric-value" style="font-size:23px">${bestLevel ? esc(bestLevel[0]) : "-"}</div><div class="metric-sub">อัตราถูกสูงสุด</div></div>
      <div class="summary-metric"><div class="metric-label">หัวข้อที่ควรทบทวน</div><div class="metric-value">${weakCount}</div><div class="metric-sub">Tense ต่ำกว่า 60%</div></div>`;
  }

  // Doughnut
  try {
    destroyChart("dh");
    state.chartInstances.dh = new Chart(document.getElementById("chart-doughnut"), {
      type:"doughnut",
      data:{labels:["ถูก","ผิด"], datasets:[{
        data:[r.correct, r.total-r.correct],
        backgroundColor:["#22c55e","#ef4444"],
        borderColor:"#ffffff",
        borderWidth:5,
        hoverOffset:8,
        spacing:2
      }]},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        cutout:"64%",
        animation:{duration:850, easing:"easeOutQuart"},
        plugins:{
          legend:{position:"bottom", labels:{usePointStyle:true, pointStyle:"circle", boxWidth:9, boxHeight:9, padding:18, color:"#475467", font:{family:"Prompt", size:12, weight:"600"}}},
          tooltip:{backgroundColor:"#101828", titleFont:{family:"Prompt", weight:"700"}, bodyFont:{family:"Prompt"}, padding:12, cornerRadius:12, displayColors:true}
        }
      }
    });
  } catch(err) { console.error("chart-doughnut failed:", err); }

  // Level bar
  const lL = ["A1-A2","B1","B2-C1"];
  const getLevelStat = l => r.pL[l] || {c:0, t:0};
  try {
    destroyChart("lv");
    state.chartInstances.lv = new Chart(document.getElementById("chart-level"), {
      type:"bar",
      data:{labels:lL, datasets:[
        {label:"ถูก", data:lL.map(l=>getLevelStat(l).c), backgroundColor:"#22c55e", borderRadius:9, borderSkipped:false},
        {label:"ผิด", data:lL.map(l=>getLevelStat(l).t-getLevelStat(l).c), backgroundColor:"#ef4444", borderRadius:9, borderSkipped:false}
      ]},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{duration:850, easing:"easeOutQuart"},
        plugins:{
          legend:{position:"bottom", labels:{usePointStyle:true, pointStyle:"rectRounded", boxWidth:18, boxHeight:8, padding:16, color:"#475467", font:{family:"Prompt", size:12, weight:"600"}}},
          tooltip:{backgroundColor:"#101828", titleFont:{family:"Prompt", weight:"700"}, bodyFont:{family:"Prompt"}, padding:12, cornerRadius:12}
        },
        datasets:{bar:{barPercentage:.72, categoryPercentage:.62}},
        scales:{
          x:{stacked:true, grid:{display:false, drawBorder:false}, ticks:{color:"#667085", font:{family:"Prompt", size:12, weight:"600"}}},
          y:{stacked:true, beginAtZero:true, ticks:{precision:0, color:"#98a2b3", font:{family:"Prompt", size:11}}, grid:{color:"rgba(102,112,133,.14)", drawBorder:false}}
        }
      }
    });
  } catch(err) { console.error("chart-level failed:", err); }

  // Tense bar - always show all 12 tenses
  const tL = [
    "Present Simple",
    "Present Continuous",
    "Present Perfect",
    "Present Perfect Continuous",
    "Past Simple",
    "Past Continuous",
    "Past Perfect",
    "Past Perfect Continuous",
    "Future Simple",
    "Future Continuous",
    "Future Perfect",
    "Future Perfect Continuous"
  ];
  const getTenseStat = t => r.pT[t] || {c:0, t:0};
  try {
    const tenseMax = Math.max(...tL.map(t=>getTenseStat(t).t), 1);
    destroyChart("tn");
    state.chartInstances.tn = new Chart(document.getElementById("chart-tense"), {
      type:"bar",
      data:{labels:tL, datasets:[
        {label:"Correct", data:tL.map(t=>getTenseStat(t).c), backgroundColor:"#22c55e", borderColor:"#22c55e", borderWidth:0, borderRadius:{topLeft:8,topRight:8,bottomLeft:8,bottomRight:8}, borderSkipped:false},
        {label:"Incorrect", data:tL.map(t=>getTenseStat(t).t-getTenseStat(t).c), backgroundColor:"#ef4444", borderColor:"#ef4444", borderWidth:0, borderRadius:{topLeft:8,topRight:8,bottomLeft:8,bottomRight:8}, borderSkipped:false}
      ]},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{duration:900, easing:"easeOutQuart"},
        layout:{padding:{top:4,right:8,bottom:0,left:0}},
        plugins:{
          legend:{
            position:"top",
            align:"center",
            labels:{usePointStyle:true, pointStyle:"rectRounded", boxWidth:34, boxHeight:10, padding:18, color:"#667085", font:{family:"Prompt", size:12, weight:"600"}}
          },
          tooltip:{
            backgroundColor:"#101828",
            titleFont:{family:"Prompt", size:13, weight:"700"},
            bodyFont:{family:"Prompt", size:12},
            padding:12,
            cornerRadius:12,
            displayColors:true,
            callbacks:{
              afterBody:function(items){
                const idx = items[0].dataIndex;
                const t = tL[idx];
                const stat = getTenseStat(t);
                const pct = stat.t ? Math.round(stat.c/stat.t*100) : 0;
                return 'Score: ' + stat.c + '/' + stat.t + ' (' + pct + '%)';
              }
            }
          }
        },
        datasets:{bar:{barPercentage:.78, categoryPercentage:.72}},
        scales:{
          x:{
            stacked:true,
            ticks:{maxRotation:42, minRotation:42, color:"#667085", padding:10, font:{family:"Prompt", size:12, weight:"500"}},
            grid:{color:"rgba(102,112,133,.10)", drawBorder:false}
          },
          y:{
            stacked:true,
            beginAtZero:true,
            suggestedMax:Math.max(4, Math.ceil(tenseMax * 1.12)),
            ticks:{precision:0, stepSize:1, color:"#667085", padding:8, font:{family:"Prompt", size:12}},
            grid:{color:"rgba(102,112,133,.16)", drawBorder:false}
          }
        }
      }
    });
  } catch(err) { console.error("chart-tense failed:", err); }

  // Level progress bars
  try {
    const lpc = document.getElementById("level-progress-container");
    lpc.innerHTML = "";
    Object.entries(r.pL).forEach(([l, v]) => {
      const p = v.t ? Math.round(v.c/v.t*100) : 0;
      lpc.innerHTML += `<div class="level-progress"><div style="font-weight:600;margin-bottom:5px">${esc(l)}: ${v.c}/${v.t} (${p}%)</div><div class="level-progress-bar"><div class="level-progress-fill ${lvlBar(l)}" style="width:${p}%">${p}%</div></div></div>`;
    });
  } catch(err) { console.error("level-progress failed:", err); }

  // Weak tenses
  try {
    const wl = document.getElementById("weak-list");
    wl.innerHTML = "";
    const weak = Object.entries(r.pT).filter(([t, v]) => v.t && v.c/v.t < 0.6);
    if(weak.length === 0){
      wl.innerHTML = "<li style='background:#e8f5e9;border-left-color:#4caf50'>เยี่ยมมาก! ไม่มี Tense ที่ต่ำกว่า 60%</li>";
    } else {
      weak.forEach(([t, v]) => {
        const p = Math.round(v.c/v.t*100);
        wl.innerHTML += `<li><strong>${esc(t)}</strong>: ${v.c}/${v.t} (${p}%) - ควรทบทวน</li>`;
      });
    }
  } catch(err) { console.error("weak-list failed:", err); }

  // Detail
  try {
    const dt = document.getElementById("tab-detail");
    dt.innerHTML = "";
    r.items.forEach((it, i) => {
      const ok = r.answers[i] === it.answer;
      const ua = r.answers[i] || "(ไม่ได้ตอบ)";
      dt.innerHTML += `<div class="result-item ${ok?"correct":"incorrect"}">
        <div style="margin-bottom:8px">
          <span style="font-size:20px">${ok?"✅":"❌"}</span>
          <span class="badge-tense">${esc(it.tense)}</span>
          <span class="badge-level ${levelClass(it.level)}">${esc(it.level)}</span>
        </div>
        <div style="font-weight:500;margin-bottom:8px">${i+1}. ${esc(it.q)}</div>
        <div>คำตอบของคุณ: <strong style="color:${ok?"#4caf50":"#f44336"}">${esc(ua)}</strong></div>
        ${!ok ? `<div>คำตอบที่ถูก: <strong style="color:#4caf50">${esc(it.answer)}</strong></div>` : ""}
        <div class="explain-box">💡 ${esc(it.explain)}</div>
      </div>`;
    });
  } catch(err) { console.error("detail-tab failed:", err); }

  // Reset tab to summary
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  document.querySelector(".tab-btn[data-tab='summary']").classList.add("active");
  document.getElementById("tab-summary").classList.add("active");
}

document.querySelectorAll(".tab-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.getElementById("tab-" + b.dataset.tab).classList.add("active");
});
document.getElementById("retry-btn").onclick = () => {
  const cq = state.currentQuiz;
  if(!cq) return;
  const idx = cq.items.map(x => x.srcIndex);
  startQuiz(cq.mode, cq.params, idx);
};
document.getElementById("home-btn").onclick = () => showScreen("screen-home");

// ============ HISTORY ============
function renderHistory() {

    const h = getHist();

    const stats = document.getElementById("history-stats");
    const list = document.getElementById("history-list");

    if (!h || h.length === 0) {

        stats.innerHTML = `
            <div class="stat-card">
                <div class="stat-num">0</div>
                <div class="stat-label">ยังไม่มีประวัติ</div>
            </div>
        `;

        list.innerHTML =
            "<p style='text-align:center;color:#999'>ยังไม่มีประวัติการทำข้อสอบ</p>";

        return;
    }

    const count = h.length;
    const avg = Math.round(
        h.reduce((sum,x)=>sum+x.percentage,0)/count
    );

    const max = Math.max(...h.map(x=>x.percentage));

    stats.innerHTML = `
        <div class="stat-card">
            <div class="stat-num">${count}</div>
            <div class="stat-label">จำนวนครั้ง</div>
        </div>

        <div class="stat-card">
            <div class="stat-num">${avg}%</div>
            <div class="stat-label">คะแนนเฉลี่ย</div>
        </div>

        <div class="stat-card">
            <div class="stat-num">${max}%</div>
            <div class="stat-label">คะแนนสูงสุด</div>
        </div>

        <div class="stat-card">
            <div class="stat-num">${h[h.length-1].percentage}%</div>
            <div class="stat-label">ครั้งล่าสุด</div>
        </div>
    `;

    list.innerHTML = "";

    [...h].reverse().forEach((item, i)=>{

        const originalIdx = h.length - 1 - i;
        const wrong = (item.total||0) - (item.correct||0);
        const hasDetail = !!item.items;

        list.innerHTML += `
            <div class="history-item${hasDetail ? " clickable" : ""}" data-idx="${originalIdx}">
                <div>
                    <strong>${new Date(item.date).toLocaleString()}</strong><br>
                    ${item.mode === "set" ? "โหมดชุด" : item.mode === "tense" ? `เรียนรู้ • ${esc(item.params?.tense||"")}` : "โหมดสุ่ม"} • ถูก ${item.correct}/${item.total} • ผิด ${wrong} ข้อ
                </div>

                <div style="display:flex;align-items:center;gap:10px">
                    <span class="score-badge ${
                        item.percentage >= 80
                            ? "high"
                            : item.percentage >= 60
                            ? "mid"
                            : "low"
                    }">
                        ${item.percentage}%
                    </span>
                    <button class="history-delete-btn" data-idx="${originalIdx}" title="ลบรายการนี้" type="button">🗑️</button>
                </div>
            </div>
        `;
    });

    list.querySelectorAll(".history-item.clickable").forEach(el => {
      el.onclick = () => viewHistoryResult(parseInt(el.dataset.idx, 10));
    });

    list.querySelectorAll(".history-delete-btn").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation(); // don't also trigger the parent's "open detail" click
        deleteHistoryItem(parseInt(btn.dataset.idx, 10));
      };
    });

    createHistoryChart(h);
}

async function deleteHistoryItem(idx){
  const h = getHist();
  const item = h[idx];
  if(!item) return;
  const ok = await customConfirm(
    `ต้องการลบประวัติวันที่ ${new Date(item.date).toLocaleString()} (${item.correct}/${item.total}, ${item.percentage}%) ใช่หรือไม่?\nข้อมูลจะไม่สามารถกู้คืนได้`,
    {title:"ลบรายการนี้", icon:"🗑️", okText:"ลบรายการนี้", cancelText:"ยกเลิก"}
  );
  if(!ok) return;
  h.splice(idx, 1);
  localStorage.setItem(HK, JSON.stringify(h));
  renderHistory();
}
document.getElementById("delete-history-btn").onclick = async () => {
  const ok = await customConfirm("ต้องการลบประวัติทั้งหมดใช่หรือไม่?\nข้อมูลจะไม่สามารถกู้คืนได้", {title:"ลบประวัติทั้งหมด", icon:"🗑️", okText:"ลบทั้งหมด", cancelText:"ยกเลิก"});
  if(ok){
    localStorage.removeItem(HK);
    renderHistory();
  }
};

// ============ LEARN MODE (เรียนรู้ Tense) ============
const TENSE_INFO = {
  "Present Simple": {group:"present", struct:"S + V1 (เอกพจน์เติม s/es)",
    trick:"เรื่องปกติ ความจริงทั่วไป กิจวัตร สังเกต always, usually, every day"},
  "Present Continuous": {group:"present", struct:"S + am/is/are + V-ing",
    trick:"กำลังทำอยู่ตอนนี้ หรือแผนที่นัดไว้แล้ว สังเกต now, Look!, Listen!"},
  "Present Perfect": {group:"present", struct:"S + have/has + V3",
    trick:"เชื่อมอดีตกับปัจจุบัน เน้นผลลัพธ์ สังเกต already, just, yet, ever, since, for"},
  "Present Perfect Continuous": {group:"present", struct:"S + have/has been + V-ing",
    trick:"เน้นความต่อเนื่องจากอดีตถึงปัจจุบัน มักมี for/since กำกับ"},
  "Past Simple": {group:"past", struct:"S + V2",
    trick:"เหตุการณ์จบแล้วในอดีต มีเวลาชัดเจน เช่น yesterday, last week, ago"},
  "Past Continuous": {group:"past", struct:"S + was/were + V-ing",
    trick:"กำลังทำอยู่ ณ จุดหนึ่งในอดีต มักถูกอีกเหตุการณ์ขัดจังหวะ สังเกต when/while"},
  "Past Perfect": {group:"past", struct:"S + had + V3",
    trick:"เกิดและจบก่อนอีกเหตุการณ์ในอดีต (อดีตซ้อนอดีต) สังเกต before, after, by the time"},
  "Past Perfect Continuous": {group:"past", struct:"S + had been + V-ing",
    trick:"เน้นความต่อเนื่องก่อนอีกจุดหนึ่งในอดีต มักมี for + when/before"},
  "Future Simple": {group:"future", struct:"S + will + V1",
    trick:"คาดการณ์ ตัดสินใจฉับพลัน หรือสัญญา — ถ้าเป็นแผนไว้แล้วมักใช้ be going to แทน"},
  "Future Continuous": {group:"future", struct:"S + will be + V-ing",
    trick:"กำลังเกิดขึ้น ณ จุดหนึ่งในอนาคต สังเกต this time tomorrow, at 8 p.m. tomorrow"},
  "Future Perfect": {group:"future", struct:"S + will have + V3",
    trick:"จะเสร็จสมบูรณ์เมื่อถึงเวลาหนึ่งในอนาคต มักมี by + เวลาอนาคต"},
  "Future Perfect Continuous": {group:"future", struct:"S + will have been + V-ing",
    trick:"เน้นความต่อเนื่องนานเท่าไหร่เมื่อถึงจุดหนึ่งในอนาคต มักมีทั้ง by... และ for..."}
};
const TENSE_ORDER = ["Present Simple","Present Continuous","Present Perfect","Present Perfect Continuous",
  "Past Simple","Past Continuous","Past Perfect","Past Perfect Continuous",
  "Future Simple","Future Continuous","Future Perfect","Future Perfect Continuous"];

function levelsForTense(tense){
  const set = new Set(QUESTIONS.filter(q=>q.tense===tense).map(q=>q.level));
  return ["A1-A2","B1","B2-C1"].filter(l=>set.has(l));
}
function examplesForTense(tense, n){
  const pool = QUESTIONS.filter(q=>q.tense===tense);
  return shuffle(pool.map((_,i)=>i)).slice(0,n).map(i=>pool[i]);
}
function tenseToThai(sentence, answer){
  // ใช้ประโยคจริงพร้อมเติมคำตอบลงในช่องว่างเพื่อโชว์เป็นตัวอย่างที่สมบูรณ์
  return String(sentence).replace(/_+/g, `<span class="highlight">${esc(answer)}</span>`);
}

function renderLearnGroup(containerId, group){
  const el = document.getElementById(containerId);
  if(!el) return;
  const tenses = TENSE_ORDER.filter(t => TENSE_INFO[t].group === group);
  el.innerHTML = `<div class="learn-card-grid">${tenses.map((t,idx)=>{
    const info = TENSE_INFO[t];
    const lvls = levelsForTense(t);
    const exs = examplesForTense(t, 2);
    const badges = lvls.map(l=>`<span class="badge-level ${levelClass(l)}">${esc(l)}</span>`).join("");
    const exHtml = exs.map(q => `<div class="learn-example"><div class="ex-en">${tenseToThai(q.q, q.answer)}</div><div class="ex-th">${esc(q.explain.split(" — ")[0])}</div></div>`).join("");
    return `<div class="learn-card" data-tense="${esc(t)}">
      <div class="learn-card-header"><span>${idx+1}. ${esc(t)}</span><span class="learn-level-badges">${badges}</span></div>
      <div class="learn-struct">${esc(info.struct)}</div>
      ${exHtml || "<p style='color:#94a3b8;font-size:13px'>ไม่มีตัวอย่างในคลัง</p>"}
      <div class="learn-trick"><strong>🔎 จุดสังเกต & วิธีใช้</strong>${esc(info.trick)}</div>
      <div class="learn-card-actions">
        <button class="learn-action-btn learn-view-btn" data-tense="${esc(t)}" type="button">📖 ดูตัวอย่างเพิ่มเติม</button>
        <button class="learn-action-btn learn-try-btn" data-tense="${esc(t)}" type="button">🎯 ลองทำข้อสอบ</button>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function renderLearnSummaryTable(){
  const body = document.getElementById("learn-summary-body");
  if(!body) return;
  const rows = [
    {label:"Present", key:"present"},
    {label:"Past", key:"past"},
    {label:"Future", key:"future"}
  ];
  const cols = ["Simple","Continuous","Perfect","Perfect Continuous"];
  body.innerHTML = rows.map(r=>{
    const tds = cols.map(c=>{
      const tenseName = `${r.label} ${c}`;
      const info = TENSE_INFO[tenseName];
      return `<td><span class="t-struct">${esc(info.struct)}</span><span class="t-desc">${esc(info.trick.split("สังเกต")[0].trim())}</span></td>`;
    }).join("");
    return `<tr><th>${r.label}</th>${tds}</tr>`;
  }).join("");
}

function renderLearn(){
  renderLearnGroup("learn-present", "present");
  renderLearnGroup("learn-past", "past");
  renderLearnGroup("learn-future", "future");
  renderLearnSummaryTable();
}

function startTenseQuiz(tenseName){
  const pool = QUESTIONS.map((q,i)=> q.tense===tenseName ? i : -1).filter(i=>i>=0);
  if(pool.length === 0) return;
  const count = Math.min(10, pool.length);
  const pick = shuffle(pool).slice(0, count);
  startQuiz("tense", {tense:tenseName}, pick);
}

document.querySelectorAll(".learn-tab-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".learn-tab-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".learn-group").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.getElementById("learn-" + b.dataset.group).classList.add("active");
});

// Event delegation for the "ดูตัวอย่าง" / "ลองทำข้อสอบ" buttons inside the freshly-rendered learn cards
document.getElementById("screen-learn").addEventListener("click", (e) => {
  const tryBtn = e.target.closest(".learn-try-btn");
  if(tryBtn){ startTenseQuiz(tryBtn.dataset.tense); return; }
  const viewBtn = e.target.closest(".learn-view-btn");
  if(viewBtn){ openTenseModal(viewBtn.dataset.tense); return; }
});

// ============ TENSE DETAIL MODAL (ดูตัวอย่างแยกตามระดับ) ============
const MODAL_LEVELS = ["A1-A2", "B1", "B2-C1"];
let tenseModalState = {tense: null, level: null};

function openTenseModal(tense){
  if(!tense) return;
  const overlay = document.getElementById("tense-modal-overlay");
  const title = document.getElementById("tense-modal-title");
  const levelsBar = document.getElementById("tense-modal-levels");
  if(!overlay || !title || !levelsBar) return;

  title.textContent = `📘 ${tense}`;
  const available = levelsForTense(tense);
  const startLevel = available[0] || MODAL_LEVELS[0];
  tenseModalState = {tense, level: startLevel};

  levelsBar.innerHTML = MODAL_LEVELS.map(l => {
    const enabled = available.includes(l);
    return `<button class="tense-lvl-btn ${lvlBar(l)} ${l===startLevel?"active":""}" data-lvl="${l}" ${enabled?"":"disabled"}>${l}</button>`;
  }).join("");

  levelsBar.querySelectorAll(".tense-lvl-btn").forEach(btn => {
    btn.onclick = () => {
      if(btn.disabled) return;
      levelsBar.querySelectorAll(".tense-lvl-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      tenseModalState.level = btn.dataset.lvl;
      renderTenseModalBody();
    };
  });

  renderTenseModalBody();
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
}

function renderTenseModalBody(){
  const body = document.getElementById("tense-modal-body");
  if(!body) return;
  const {tense, level} = tenseModalState;
  const pool = QUESTIONS.filter(q => q.tense === tense && q.level === level);
  if(pool.length === 0){
    body.innerHTML = `<p class="tense-modal-empty">ยังไม่มีตัวอย่างในระดับ ${esc(level)} สำหรับ Tense นี้ครับ</p>`;
    return;
  }
  const items = shuffle(pool.map((_, i) => i)).slice(0, 10).map(i => pool[i]);
  body.innerHTML = `<div class="tense-example-grid">${items.map(q => `
    <div class="tense-ex-card ${lvlBar(level)}">
      <div class="tense-ex-en">${tenseToThai(q.q, q.answer)}</div>
      <div class="tense-ex-explain">💡 ${esc(q.explain)}</div>
    </div>`).join("")}</div>`;
}

function closeTenseModal(){
  const overlay = document.getElementById("tense-modal-overlay");
  if(!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
}

document.getElementById("tense-modal-close")?.addEventListener("click", closeTenseModal);
document.getElementById("tense-modal-overlay")?.addEventListener("click", (e) => {
  if(e.target.id === "tense-modal-overlay") closeTenseModal();
});
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closeTenseModal();
});

// ============ VOCAB MODULE (คลังคำศัพท์ Oxford 5000) ============
// ข้อมูลคำศัพท์โหลดจาก words.json (ดูใน initApp)
// รองรับทั้ง format เก่าเป็น array และ format ใหม่จากไฟล์แนบ Oxford 5000 JSON
// internal shape: [id, word, pos, level, defEn, defTh, example, synonyms, antonyms, family]
let VOCAB_WORDS = [];
let vocabState = null;
const VOCAB_MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const VOCAB_WORDS_PER_DAY_KEY = "tenses_vocab_words_per_day";
const VOCAB_START_DATE_KEY = "tenses_vocab_start_date";
function getVocabWordsPerDay(){
  const saved = parseInt(localStorage.getItem(VOCAB_WORDS_PER_DAY_KEY), 10);
  return Number.isFinite(saved) && saved > 0 ? saved : 20;
}
function setVocabWordsPerDay(value){
  const parsed = parseInt(value, 10);
  const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
  localStorage.setItem(VOCAB_WORDS_PER_DAY_KEY, String(safeValue));
  return safeValue;
}
function toDateInputValue(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseVocabStartDate(value){
  if(!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
function getVocabStartDate(){
  const saved = localStorage.getItem(VOCAB_START_DATE_KEY);
  if(saved){
    const parsed = parseVocabStartDate(saved);
    return toDateInputValue(parsed);
  }
  return toDateInputValue(new Date());
}
function setVocabStartDate(value){
  const parsed = parseVocabStartDate(value);
  const normalized = toDateInputValue(parsed);
  localStorage.setItem(VOCAB_START_DATE_KEY, normalized);
  return normalized;
}

function normalizeVocabWordObject(w, index){
  return [
    typeof w.id !== "undefined" ? w.id : index + 1,
    w.word || "",
    w.pos || "",
    w.level || "",
    w.definitionEn || w.defEn || "",
    w.definitionTh || w.defTh || "",
    w.example || "",
    Array.isArray(w.synonyms) ? w.synonyms : [],
    Array.isArray(w.antonyms) ? w.antonyms : [],
    (w.family && typeof w.family === "object") ? w.family : {}
  ];
}

function normalizeVocabWords(raw){
  if(Array.isArray(raw)){
    return raw.map((w, i) => Array.isArray(w) ? w : normalizeVocabWordObject(w, i));
  }
  if(raw && Array.isArray(raw.words)){
    return raw.words.map((w, i) => normalizeVocabWordObject(w, i));
  }
  console.warn("normalizeVocabWords: Unrecognized words.json shape", raw);
  return [];
}

// ---- Persistent stats: per-day flashcard recall + per-level quiz performance ----
const VOCAB_DAY_STATS_KEY = "tenses_vocab_day_stats_v1";
const VOCAB_LEVEL_STATS_KEY = "tenses_vocab_level_stats_v1";
const getVocabDayStats = () => { try{ return JSON.parse(localStorage.getItem(VOCAB_DAY_STATS_KEY)) || {}; }catch{ return {}; } };
const saveVocabDayStat = (dayIndex, known, total) => {
  const all = getVocabDayStats();
  all[dayIndex] = {known, total};
  localStorage.setItem(VOCAB_DAY_STATS_KEY, JSON.stringify(all));
};
const getVocabLevelStats = () => { try{ return JSON.parse(localStorage.getItem(VOCAB_LEVEL_STATS_KEY)) || {}; }catch{ return {}; } };
const addVocabLevelStats = (byLevel) => {
  const all = getVocabLevelStats();
  Object.entries(byLevel).forEach(([lvl, v]) => {
    all[lvl] = all[lvl] || {correct:0, total:0};
    all[lvl].correct += v.correct;
    all[lvl].total += v.total;
  });
  localStorage.setItem(VOCAB_LEVEL_STATS_KEY, JSON.stringify(all));
};

function normalizeVocabEntry(w, index){
  if(Array.isArray(w)) return w;
  if(w && typeof w === "object"){
    return [
      typeof w.id !== "undefined" ? w.id : index + 1,
      w.word || "",
      w.pos || "",
      w.level || "",
      w.definitionEn || w.defEn || "",
      w.definitionTh || w.defTh || "",
      w.example || "",
      Array.isArray(w.synonyms) ? w.synonyms : [],
      Array.isArray(w.antonyms) ? w.antonyms : [],
      (w.family && typeof w.family === "object") ? w.family : {}
    ];
  }
  return [index + 1, "", "", "", "", "", "", [], [], {}];
}

function buildVocabStructure(){
  const WORDS_PER_DAY = getVocabWordsPerDay();
  const DAYS_PER_WEEK = 5;
  const days = [];
  const normalizedWords = VOCAB_WORDS.map((w, i) => normalizeVocabEntry(w, i));
  for(let i=0;i<normalizedWords.length;i+=WORDS_PER_DAY) days.push(normalizedWords.slice(i, i+WORDS_PER_DAY));

  const today = new Date();
  today.setHours(0,0,0,0);
  const scheduleStartDate = parseVocabStartDate(getVocabStartDate());
  scheduleStartDate.setHours(0,0,0,0);
  const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

  // จัดวันท่องศัพท์ให้ตรงกับวันจันทร์-ศุกร์จริง เริ่มจากวันที่ตั้งค่า
  const studyDates = [];
  {
    let cursor = new Date(scheduleStartDate);
    while(studyDates.length < days.length){
      if(!isWeekend(cursor)) studyDates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const dateKey = d => `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  const dateToDayIndex = {};
  studyDates.forEach((d, i) => { dateToDayIndex[dateKey(d)] = i; });

  // จัดกลุ่มวันท่องศัพท์เป็นสัปดาห์ละ 5 วัน แล้วหาวันสอบ (เสาร์-อาทิตย์ถัดไป)
  const weeks = [];
  for(let i=0;i<days.length;i+=DAYS_PER_WEEK){
    weeks.push({dayIndices: Array.from({length: Math.min(DAYS_PER_WEEK, days.length-i)}, (_,k)=>i+k)});
  }
  const nextSaturdayAfter = d => { const c = new Date(d); do{ c.setDate(c.getDate()+1); } while(c.getDay() !== 6); return c; };
  weeks.forEach(w => {
    const lastDate = studyDates[w.dayIndices[w.dayIndices.length-1]];
    const sat = nextSaturdayAfter(lastDate);
    const sun = new Date(sat); sun.setDate(sun.getDate()+1);
    w.quizDates = [sat, sun];
  });
  const dateToQuizWeek = {};
  weeks.forEach((w, wi) => { w.quizDates.forEach(d => { dateToQuizWeek[dateKey(d)] = wi; }); });

  return {
    days, weeks, dateKey, dateToDayIndex, dateToQuizWeek, today,
    dayCompleted: new Array(days.length).fill(false),
    quizCompleted: new Array(weeks.length).fill(false),
    viewYear: today.getFullYear(), viewMonth: today.getMonth(),
    currentDay: 0, dayIndices: [], pos: 0, known: new Set(), flipped: false,
    quizWeekIndex: 0, quizQuestions: [], quizPos: 0, quizScore: 0, quizAnswered: false,
    _lastSpokenCardKey: null, _lastSpokenQuizKey: null
  };
}

function showVocabSub(id){
  document.querySelectorAll("#screen-vocab .vocab-subscreen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(id);
  if(target) target.classList.add("active");
}

document.getElementById("vocabBackToSelectFromStats").onclick = () => openVocabHome();

function renderVocabStats(){
  const dayStats = getVocabDayStats();
  const levelStats = getVocabLevelStats();
  const dayEntries = Object.entries(dayStats).sort((a,b) => Number(a[0]) - Number(b[0]));
  const hasData = dayEntries.length > 0 || Object.keys(levelStats).length > 0;
  document.getElementById("vocabStatsEmpty").style.display = hasData ? "none" : "block";

  // Metrics
  const totalKnown = dayEntries.reduce((s,[,v]) => s+v.known, 0);
  const totalWords = dayEntries.reduce((s,[,v]) => s+v.total, 0);
  const totalNotYet = totalWords - totalKnown;
  const daysAttempted = dayEntries.length;
  const quizTotal = Object.values(levelStats).reduce((s,v)=>s+v.total,0);
  const quizCorrect = Object.values(levelStats).reduce((s,v)=>s+v.correct,0);
  const quizPct = quizTotal ? Math.round((quizCorrect/quizTotal)*100) : 0;
  document.getElementById("vocabStatsMetrics").innerHTML = `
    <div class="summary-metric"><div class="metric-label">คำที่จำได้แล้ว</div><div class="metric-value">${totalKnown}</div><div class="metric-sub">จาก ${totalWords} คำ (${daysAttempted} วัน)</div></div>
    <div class="summary-metric"><div class="metric-label">คำที่ยังจำไม่ได้</div><div class="metric-value">${totalNotYet}</div><div class="metric-sub">รวมทุกวันที่ท่องแล้ว</div></div>
    <div class="summary-metric"><div class="metric-label">คะแนนแบบทดสอบเฉลี่ย</div><div class="metric-value">${quizPct}%</div><div class="metric-sub">${quizCorrect}/${quizTotal} ข้อ</div></div>
    <div class="summary-metric"><div class="metric-label">ระดับที่ทำแบบทดสอบแล้ว</div><div class="metric-value" style="font-size:23px">${Object.keys(levelStats).length}</div><div class="metric-sub">ระดับคำศัพท์</div></div>`;

  // Chart 1: words not-yet-known per day
  try {
    destroyChart("vd");
    const labels = dayEntries.map(([d]) => "Day " + (Number(d)+1));
    const notKnown = dayEntries.map(([,v]) => v.total - v.known);
    const known = dayEntries.map(([,v]) => v.known);
    state.chartInstances.vd = new Chart(document.getElementById("chart-vocab-days"), {
      type:"bar",
      data:{labels, datasets:[
        {label:"จำได้แล้ว", data:known, backgroundColor:"#22c55e", borderRadius:6, borderSkipped:false},
        {label:"ยังจำไม่ได้", data:notKnown, backgroundColor:"#ef4444", borderRadius:6, borderSkipped:false}
      ]},
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:850, easing:"easeOutQuart"},
        plugins:{legend:{position:"top", labels:{usePointStyle:true, pointStyle:"rectRounded", boxWidth:18, boxHeight:8, padding:16, font:{family:"Prompt", size:12, weight:"600"}}}},
        datasets:{bar:{barPercentage:.7, categoryPercentage:.6}},
        scales:{
          x:{stacked:true, grid:{display:false, drawBorder:false}, ticks:{font:{family:"Prompt", size:11}}},
          y:{stacked:true, beginAtZero:true, ticks:{precision:0, font:{family:"Prompt", size:11}}, grid:{color:"rgba(102,112,133,.14)", drawBorder:false}}
        }
      }
    });
  } catch(err) { console.error("chart-vocab-days failed:", err); }

  // Chart 2: quiz performance by level
  try {
    destroyChart("vl");
    const levels = Object.keys(levelStats).sort();
    const pcts = levels.map(l => levelStats[l].total ? Math.round((levelStats[l].correct/levelStats[l].total)*100) : 0);
    state.chartInstances.vl = new Chart(document.getElementById("chart-vocab-level"), {
      type:"bar",
      data:{labels:levels, datasets:[{
        label:"% ถูก", data:pcts,
        backgroundColor:levels.map(l => l==="C1" ? "#f59e0b" : "#3b82f6"),
        borderRadius:9, borderSkipped:false
      }]},
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:850, easing:"easeOutQuart"},
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:(ctx)=>{ const l=levels[ctx.dataIndex]; const v=levelStats[l]; return `${v.correct}/${v.total} (${ctx.raw}%)`; }}}
        },
        datasets:{bar:{barPercentage:.55, categoryPercentage:.6}},
        scales:{
          x:{grid:{display:false, drawBorder:false}, ticks:{font:{family:"Prompt", size:12, weight:"600"}}},
          y:{beginAtZero:true, max:100, ticks:{callback:v=>v+"%", font:{family:"Prompt", size:11}}, grid:{color:"rgba(102,112,133,.14)", drawBorder:false}}
        }
      }
    });
  } catch(err) { console.error("chart-vocab-level failed:", err); }

  // Chart 3: overall known vs not-yet-known doughnut
  try {
    destroyChart("vk");
    state.chartInstances.vk = new Chart(document.getElementById("chart-vocab-known"), {
      type:"doughnut",
      data:{labels:["จำได้แล้ว","ยังจำไม่ได้"], datasets:[{
        data:[totalKnown, totalNotYet],
        backgroundColor:["#22c55e","#ef4444"],
        borderColor:"#ffffff", borderWidth:5, hoverOffset:8, spacing:2
      }]},
      options:{
        responsive:true, maintainAspectRatio:false, cutout:"64%",
        animation:{duration:850, easing:"easeOutQuart"},
        plugins:{legend:{position:"bottom", labels:{usePointStyle:true, pointStyle:"circle", boxWidth:9, boxHeight:9, padding:18, font:{family:"Prompt", size:12, weight:"600"}}}}
      }
    });
  } catch(err) { console.error("chart-vocab-known failed:", err); }
}

function openVocabHome(){
  if(!vocabState) vocabState = buildVocabStructure();
  showVocabSub("vocab-select");
  renderVocabCalendar();
}

function renderVocabCalendar(){
  const st = vocabState;
  document.getElementById("vocabMonthLabel").textContent = `${VOCAB_MONTHS_TH[st.viewMonth]} ${st.viewYear}`;
  const calDays = document.getElementById("vocabCalDays");
  calDays.innerHTML = "";

  const firstOfMonth = new Date(st.viewYear, st.viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(st.viewYear, st.viewMonth+1, 0).getDate();

  for(let i=0;i<startWeekday;i++){
    const empty = document.createElement("div");
    empty.className = "vocab-cal-cell empty";
    calDays.appendChild(empty);
  }
  for(let d=1; d<=daysInMonth; d++){
    const cellDate = new Date(st.viewYear, st.viewMonth, d);
    const key = st.dateKey(cellDate);
    const isToday = key === st.dateKey(st.today);
    const dayIdx = st.dateToDayIndex.hasOwnProperty(key) ? st.dateToDayIndex[key] : null;
    const quizWeek = st.dateToQuizWeek.hasOwnProperty(key) ? st.dateToQuizWeek[key] : null;

    const cell = document.createElement("div");
    let cls = "vocab-cal-cell" + (isToday ? " today" : "");
    let tagHtml = "";
    if(dayIdx !== null){
      cls += " study" + (st.dayCompleted[dayIdx] ? " complete" : "");
      tagHtml = `<span class="vocab-day-tag">Day ${dayIdx+1}</span>`;
    } else if(quizWeek !== null){
      cls += " quiz" + (st.quizCompleted[quizWeek] ? " complete" : "");
      tagHtml = `<span class="vocab-day-tag">สอบ Wk${quizWeek+1}</span>`;
    }
    cell.className = cls;
    cell.innerHTML = `<span class="vocab-date-num">${d}</span>${tagHtml}`;
    if(dayIdx !== null) cell.onclick = () => openVocabDay(dayIdx);
    else if(quizWeek !== null) cell.onclick = () => openVocabQuiz(quizWeek);
    calDays.appendChild(cell);
  }
}

document.getElementById("vocabPrevMonth").onclick = () => {
  const st = vocabState; if(!st) return;
  st.viewMonth--; if(st.viewMonth < 0){ st.viewMonth = 11; st.viewYear--; }
  renderVocabCalendar();
};
document.getElementById("vocabNextMonth").onclick = () => {
  const st = vocabState; if(!st) return;
  st.viewMonth++; if(st.viewMonth > 11){ st.viewMonth = 0; st.viewYear++; }
  renderVocabCalendar();
};

// ---- Flashcard deck ----
function openVocabDay(i){
  const st = vocabState;
  st.currentDay = i;
  st.dayIndices = st.days[i].map((_,idx)=>idx);
  st.pos = 0;
  st.known = new Set();
  document.getElementById("vocabDeckEyebrow").textContent = "Day " + (i+1);
  document.getElementById("vocabDoneHeading").textContent = `เยี่ยมมาก! ครบวันที่ ${i+1} แล้ว 🎉`;
  showVocabSub("vocab-deck");
  renderVocabCard();
}

function renderVocabExtras(synonyms, antonyms, family){
  const synRow = document.getElementById("vocabSynRow");
  const antRow = document.getElementById("vocabAntRow");
  const famRow = document.getElementById("vocabFamRow");
  const synEl  = document.getElementById("vocabSyn");
  const antEl  = document.getElementById("vocabAnt");
  const famEl  = document.getElementById("vocabFam");
  if(!synRow || !antRow || !famRow) return;
  const chipList = (arr) => (Array.isArray(arr) && arr.length)
    ? arr.map(x => {
        const v = (x && typeof x === "object") ? (x.word || JSON.stringify(x)) : x;
        return `<span class="vf-chip">${esc(v)}</span>`;
      }).join("")
    : "";
  const chipFamily = (fam) => {
    if(!fam || typeof fam !== "object") return "";
    const entries = Object.entries(fam).filter(([,v]) => v);
    if(!entries.length) return "";
    return entries.map(([p,v]) => {
      const val = Array.isArray(v) ? v.join(", ") : v;
      return `<span class="vf-chip"><span class="vf-pos">${esc(p)}</span>${esc(val)}</span>`;
    }).join("");
  };
  const synHtml = chipList(synonyms);
  const antHtml = chipList(antonyms);
  const famHtml = chipFamily(family);
  synEl.innerHTML = synHtml;
  antEl.innerHTML = antHtml;
  famEl.innerHTML = famHtml;
  synRow.classList.toggle("empty", !synHtml);
  antRow.classList.toggle("empty", !antHtml);
  famRow.classList.toggle("empty", !famHtml);
}

function renderVocabCard(){
  const st = vocabState;
  const dayWords = st.days[st.currentDay];
  const cardArea = document.getElementById("vocabCardArea");
  const doneBox = document.getElementById("vocabDoneBox");

  if(st.pos >= st.dayIndices.length){
    cardArea.style.display = "none";
    doneBox.style.display = "block";
    document.getElementById("vocabDoneStats").textContent = `จำได้แล้ว ${st.known.size} จาก ${dayWords.length} คำ`;
    if(st.known.size >= dayWords.length) st.dayCompleted[st.currentDay] = true;
    saveVocabDayStat(st.currentDay, st.known.size, dayWords.length);
    return;
  }
  cardArea.style.display = "block";
  doneBox.style.display = "none";

  const w = dayWords[st.dayIndices[st.pos]];
  const [num, word, pos, level, defEn, defTh, example, synonyms, antonyms, family] = w;
  document.getElementById("vocabFrontIndex").textContent = "#" + String(num).padStart(3,"0");
  document.getElementById("vocabBackIndex").textContent = "#" + String(num).padStart(3,"0");
  document.getElementById("vocabFrontWord").textContent = word;
  document.getElementById("vocabFrontPos").textContent = pos;
  const lvlText = level === "N/A" ? "C1" : level;
  document.getElementById("vocabFrontLevel").textContent = lvlText;
  document.getElementById("vocabBackLevel").textContent = lvlText;
  document.getElementById("vocabDefEn").textContent = defEn;
  document.getElementById("vocabDefTh").textContent = defTh;
  document.getElementById("vocabExample").innerHTML = "“" + vocabFillSentence(example, word) + "”";
  renderVocabExtras(synonyms, antonyms, family);

  document.getElementById("vocabProgressLabel").textContent = (st.pos+1) + " / " + st.dayIndices.length;
  document.getElementById("vocabKnownLabel").textContent = "จำได้แล้ว: " + st.known.size;
  document.getElementById("vocabProgressFill").style.width = Math.round((st.pos/st.dayIndices.length)*100) + "%";

  if(isAutoReadEnabled()){
    const cardKey = `${st.currentDay}:${st.dayIndices[st.pos]}`;
    if(st._lastSpokenCardKey !== cardKey){
      st._lastSpokenCardKey = cardKey;
      speakText(word);
    }
  }

  st.flipped = false;
  document.getElementById("vocabCard").classList.remove("flipped");
}

document.getElementById("vocabCard").onclick = () => {
  const st = vocabState; if(!st) return;
  st.flipped = !st.flipped;
  document.getElementById("vocabCard").classList.toggle("flipped", st.flipped);
};
document.getElementById("vocabBtnKnown").onclick = (e) => {
  e.stopPropagation();
  const st = vocabState;
  st.known.add(st.dayIndices[st.pos]);
  st.pos++;
  renderVocabCard();
};
document.getElementById("vocabBtnAgain").onclick = (e) => {
  e.stopPropagation();
  const st = vocabState;
  const cur = st.dayIndices[st.pos];
  st.dayIndices.splice(st.pos, 1);
  st.dayIndices.push(cur);
  renderVocabCard();
};
document.getElementById("vocabBtnPrev").onclick = () => {
  const st = vocabState; if(st.pos > 0){ st.pos--; renderVocabCard(); }
};
document.getElementById("vocabBtnSkip").onclick = () => {
  const st = vocabState; if(st.pos < st.dayIndices.length-1){ st.pos++; renderVocabCard(); }
};
document.getElementById("vocabBtnShuffleReset").onclick = () => {
  const st = vocabState;
  st.dayIndices = shuffle(st.dayIndices);
  st.pos = 0;
  renderVocabCard();
};
document.getElementById("vocabBtnRestart").onclick = () => {
  const st = vocabState;
  st.dayIndices = st.days[st.currentDay].map((_,idx)=>idx);
  st.pos = 0;
  st.known = new Set();
  renderVocabCard();
};
document.getElementById("vocabBtnBackFromDone").onclick = () => openVocabHome();
document.getElementById("vocabBackToSelect").onclick = () => openVocabHome();
document.getElementById("vocabBackToSelectFromQuiz").onclick = () => openVocabHome();

document.addEventListener("keydown", (e) => {
  const screenVocab = document.getElementById("screen-vocab");
  const deckSub = document.getElementById("vocab-deck");
  if(!screenVocab.classList.contains("active") || !deckSub.classList.contains("active")) return;
  if(e.code === "Space"){ e.preventDefault(); document.getElementById("vocabCard").click(); }
  if(e.key === "ArrowRight") document.getElementById("vocabBtnSkip").click();
  if(e.key === "ArrowLeft") document.getElementById("vocabBtnPrev").click();
});

// ---- Quiz (แบบทดสอบท้ายสัปดาห์) ----
// คืนค่า {words, days} ที่เรียงลำดับตรงกัน (shuffle ไปด้วยกัน) เพื่อให้รู้ว่าแต่ละคำมาจาก Day ไหน
function buildVocabQuizQuestions(weekIndex){
  const st = vocabState;
  const dayIdxs = st.weeks[weekIndex].dayIndices;
  let pool = [];
  let dayMap = [];
  dayIdxs.forEach(di => {
    st.days[di].forEach(w => { pool.push(w); dayMap.push(di); });
  });
  const order = shuffle(pool.map((_,i)=>i));
  return {words: order.map(i=>pool[i]), days: order.map(i=>dayMap[i])};
}

// สลับ quizQuestions + quizDayIndex ไปพร้อมกันเพื่อรักษาความสัมพันธ์คำ<->วัน
function shuffleVocabQuizOrder(st){
  const idx = shuffle(st.quizQuestions.map((_,i)=>i));
  st.quizQuestions = idx.map(i=>st.quizQuestions[i]);
  st.quizDayIndex = idx.map(i=>st.quizDayIndex[i]);
}

function openVocabQuiz(weekIndex){
  const st = vocabState;
  st.quizWeekIndex = weekIndex;
  const built = buildVocabQuizQuestions(weekIndex);
  st.quizQuestions = built.words;
  st.quizDayIndex = built.days;
  st.quizAnswers = new Array(st.quizQuestions.length).fill(null);
  st.quizChoices = st.quizQuestions.map(w => vocabBuildChoices(w[1], st.quizQuestions));
  st.quizPos = 0;
  st.quizScore = 0;
  document.getElementById("vocabQuizEyebrow").textContent = "Week " + (weekIndex+1) + " • Quiz";
  document.getElementById("vocabQuizTitle").textContent = "แบบทดสอบสัปดาห์ที่ " + (weekIndex+1);
  showVocabSub("vocab-quiz");
  document.getElementById("vocabQuizArea").style.display = "block";
  document.getElementById("vocabQuizResult").style.display = "none";
  renderVocabQuiz();
}

function vocabWordRegex(word){
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  // Match the base word plus any trailing letters (covers -s/-es/-ed/-ing inflections,
  // e.g. "absorb" -> "absorbed", "accelerate" -> "accelerated") so the answer word is
  // always found and blanked out, even when the sentence uses a conjugated form.
  return new RegExp("\\b" + escaped + "[a-z]*", "i");
}

function vocabBlankSentence(sentence, word){
  const re = vocabWordRegex(word);
  if(!re.test(sentence)){
    // Fallback: no match at all (shouldn't normally happen) — blank the whole sentence's
    // last word rather than risk leaking the answer.
    return esc(sentence);
  }
  const marked = sentence.replace(re, "@@VOCABBLANK@@");
  return esc(marked).replace("@@VOCABBLANK@@", `<span class="vocab-quiz-blank">&nbsp;</span>`);
}

// สร้างข้อความสำหรับอ่านออกเสียง โดยแทนคำเฉลยด้วยช่องว่าง เพื่อไม่ให้เผยคำตอบ
function vocabQuizSpokenText(sentence, word){
  const re = vocabWordRegex(word);
  if(!re.test(sentence)) return sentence;
  return sentence.replace(re, "____");
}

const vocabLevelClass = l => l === "C1" ? "level-b2c1" : l === "B2" ? "level-b1" : "level-a12";
const vocabLevelText = l => l === "N/A" ? "C1" : l;

function vocabFillSentence(sentence, word){
  const re = vocabWordRegex(word);
  const match = sentence.match(re);
  if(!match) return esc(sentence);
  const marked = sentence.replace(re, "@@VOCABFILL@@");
  return esc(marked).replace("@@VOCABFILL@@", `<span class="highlight">${esc(match[0])}</span>`);
}

function vocabBuildChoices(correctWord, pool){
  const words = pool.map(w => w[1]).filter(w => w.toLowerCase() !== correctWord.toLowerCase());
  const distractors = shuffle(words).slice(0, 3);
  return shuffle([correctWord, ...distractors]);
}

function renderVocabQuiz(){
  const st = vocabState;
  const total = st.quizQuestions.length;
  if(st.quizPos < 0) st.quizPos = 0;
  if(st.quizPos >= total) st.quizPos = total - 1;

  const w = st.quizQuestions[st.quizPos];
  const [num, word, pos, level, defEn, defTh, example] = w;
  const answered = st.quizAnswers.filter(a => a !== null).length;

  document.getElementById("vocabQuizIndex").textContent = `คำที่ ${st.quizPos+1} / ${total}`;
  document.getElementById("vocabQuizSentence").innerHTML = vocabBlankSentence(example, word);

  const choices = st.quizChoices[st.quizPos];
  const optionsBox = document.getElementById("vocabQuizOptions");
  optionsBox.innerHTML = "";
  choices.forEach(choice => {
    const btn = document.createElement("button");
    btn.className = "vocab-quiz-option" + (st.quizAnswers[st.quizPos] === choice ? " selected" : "");
    btn.textContent = choice;
    btn.onclick = () => {
      st.quizAnswers[st.quizPos] = choice;
      renderVocabQuiz();
    };
    optionsBox.appendChild(btn);
  });

  document.getElementById("vocabQuizProgressLabel").textContent = `${st.quizPos+1} / ${total} • ตอบแล้ว ${answered}/${total}`;
  document.getElementById("vocabQuizScoreLabel").textContent = "ตอบแล้ว: " + answered;
  document.getElementById("vocabQuizProgressFill").style.width = Math.round(((st.quizPos+1)/total)*100) + "%";

  if(isAutoReadEnabled()){
    const quizKey = `${st.quizWeekIndex}:${st.quizPos}`;
    if(st._lastSpokenQuizKey !== quizKey){
      st._lastSpokenQuizKey = quizKey;
      speakText(vocabQuizSpokenText(example, word));
    }
  }

  document.getElementById("vocabQuizPrevBtn").disabled = st.quizPos === 0;
  document.getElementById("vocabQuizNextBtn").disabled = st.quizPos === total - 1;

  renderVocabQuizNav();
}

function renderVocabQuizNav(){
  const st = vocabState;
  const nav = document.getElementById("vocabQuizNav");
  if(!nav) return;
  const answeredCount = st.quizAnswers.filter(a => a !== null).length;
  const countEl = document.getElementById("vocabQuizNav-count");
  if(countEl) countEl.textContent = `${st.quizPos+1}/${st.quizQuestions.length} • ตอบแล้ว ${answeredCount}`;
  nav.innerHTML = "";
  st.quizQuestions.forEach((_, index) => {
    const btn = document.createElement("button");
    btn.classList.add("q-nav-btn");
    if(index === st.quizPos) btn.classList.add("current");
    else if(st.quizAnswers[index] !== null) btn.classList.add("answered");
    else btn.classList.add("unanswered");
    btn.textContent = index + 1;
    btn.onclick = () => { st.quizPos = index; renderVocabQuiz(); };
    nav.appendChild(btn);
  });
}

document.getElementById("vocabQuizPrevBtn").onclick = () => {
  const st = vocabState; if(!st) return;
  st.quizPos = Math.max(0, st.quizPos - 1);
  renderVocabQuiz();
};
document.getElementById("vocabQuizNextBtn").onclick = () => {
  const st = vocabState; if(!st) return;
  st.quizPos = Math.min(st.quizQuestions.length - 1, st.quizPos + 1);
  renderVocabQuiz();
};
document.getElementById("vocabQuizSubmitBtn").onclick = async () => {
  const st = vocabState; if(!st) return;
  const un = st.quizAnswers.filter(a => a === null).length;
  if(un > 0){
    const ok = await customConfirm(`ยังตอบไม่ครบ ${un} คำ\nต้องการส่งคำตอบเลยหรือไม่?`, {title:"ส่งคำตอบ", icon:"📝", okText:"ส่งคำตอบ", cancelText:"กลับไปทำต่อ"});
    if(!ok) return;
  }
  finishVocabQuiz();
};

function finishVocabQuiz(){
  const st = vocabState;
  st.quizScore = st.quizQuestions.reduce((sum, w, i) => sum + (st.quizAnswers[i] && st.quizAnswers[i].toLowerCase() === w[1].toLowerCase() ? 1 : 0), 0);
  st.quizCompleted[st.quizWeekIndex] = true;
  const total = st.quizQuestions.length;
  const pct = total ? Math.round((st.quizScore/total)*100) : 0;

  const byLevel = {};
  st.quizQuestions.forEach((w, i) => {
    const lvl = vocabLevelText(w[3]);
    byLevel[lvl] = byLevel[lvl] || {correct:0, total:0};
    byLevel[lvl].total++;
    if(st.quizAnswers[i] && st.quizAnswers[i].toLowerCase() === w[1].toLowerCase()) byLevel[lvl].correct++;
  });
  addVocabLevelStats(byLevel);

  document.getElementById("vocabQuizArea").style.display = "none";
  document.getElementById("vocabQuizResult").style.display = "block";
  document.getElementById("vocabQuizScoreBig").textContent = st.quizScore + "/" + total;
  document.getElementById("vocabQuizResultText").textContent = `ตอบถูก ${pct}% ของคำศัพท์สัปดาห์นี้`;

  // Doughnut: จำได้ (ตอบถูก) vs จำไม่ได้ (ตอบผิด/ไม่ได้ตอบ)
  try {
    destroyChart("vqd");
    state.chartInstances.vqd = new Chart(document.getElementById("chart-vocab-quiz-doughnut"), {
      type:"doughnut",
      data:{labels:["จำได้","จำไม่ได้"], datasets:[{
        data:[st.quizScore, total - st.quizScore],
        backgroundColor:["#22c55e","#ef4444"],
        borderColor:"#ffffff", borderWidth:5, hoverOffset:8, spacing:2
      }]},
      options:{
        responsive:true, maintainAspectRatio:false, cutout:"64%",
        animation:{duration:850, easing:"easeOutQuart"},
        plugins:{legend:{position:"bottom", labels:{usePointStyle:true, pointStyle:"circle", boxWidth:9, boxHeight:9, padding:18, font:{family:"Prompt", size:12, weight:"600"}}}}
      }
    });
  } catch(err) { console.error("chart-vocab-quiz-doughnut failed:", err); }

  // Bar: คำนั้นอยู่วันไหนบ้าง — ผลถูก/ผิดแยกตามวันที่ท่องคำนั้นมา
  try {
    const dayIdxs = st.weeks[st.quizWeekIndex].dayIndices;
    const byDay = {};
    dayIdxs.forEach(di => { byDay[di] = {correct:0, total:0}; });
    st.quizQuestions.forEach((w, i) => {
      const di = st.quizDayIndex[i];
      byDay[di].total++;
      if(st.quizAnswers[i] && st.quizAnswers[i].toLowerCase() === w[1].toLowerCase()) byDay[di].correct++;
    });
    const labels = dayIdxs.map(di => "Day " + (di+1));
    const correctData = dayIdxs.map(di => byDay[di].correct);
    const wrongData = dayIdxs.map(di => byDay[di].total - byDay[di].correct);
    destroyChart("vqbd");
    state.chartInstances.vqbd = new Chart(document.getElementById("chart-vocab-quiz-byday"), {
      type:"bar",
      data:{labels, datasets:[
        {label:"จำได้", data:correctData, backgroundColor:"#22c55e", borderRadius:6, borderSkipped:false},
        {label:"จำไม่ได้", data:wrongData, backgroundColor:"#ef4444", borderRadius:6, borderSkipped:false}
      ]},
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:850, easing:"easeOutQuart"},
        plugins:{legend:{position:"top", labels:{usePointStyle:true, pointStyle:"rectRounded", boxWidth:18, boxHeight:8, padding:16, font:{family:"Prompt", size:12, weight:"600"}}}},
        datasets:{bar:{barPercentage:.6, categoryPercentage:.6}},
        scales:{
          x:{stacked:true, grid:{display:false, drawBorder:false}, ticks:{font:{family:"Prompt", size:12, weight:"600"}}},
          y:{stacked:true, beginAtZero:true, ticks:{precision:0, font:{family:"Prompt", size:11}}, grid:{color:"rgba(102,112,133,.14)", drawBorder:false}}
        }
      }
    });
  } catch(err) { console.error("chart-vocab-quiz-byday failed:", err); }

  const detail = document.getElementById("vocabQuizDetail");
  detail.innerHTML = "";
  st.quizQuestions.forEach((w, i) => {
    const [num, word, pos, level, defEn, defTh, example] = w;
    const ua = st.quizAnswers[i];
    const ok = ua && ua.toLowerCase() === word.toLowerCase();
    const dayTag = (st.quizDayIndex && st.quizDayIndex[i] !== undefined) ? `Day ${st.quizDayIndex[i]+1}` : "";
    detail.innerHTML += `<div class="result-item ${ok?"correct":"incorrect"}">
      <div style="margin-bottom:8px">
        <span style="font-size:20px">${ok?"✅":"❌"}</span>
        <span class="badge-tense">${esc(word)}</span>
        ${dayTag ? `<span class="badge-tense">${esc(dayTag)}</span>` : ""}
        <span class="badge-level ${vocabLevelClass(level)}">${esc(vocabLevelText(level))}</span>
      </div>
      <div style="font-weight:500;margin-bottom:8px">${i+1}. ${vocabFillSentence(example, word)}</div>
      <div>คำตอบของคุณ: <strong style="color:${ok?"#4caf50":"#f44336"}">${esc(ua || "(ไม่ได้ตอบ)")}</strong></div>
      ${!ok ? `<div>คำตอบที่ถูก: <strong style="color:#4caf50">${esc(word)}</strong></div>` : ""}
      <div class="explain-box">💡 ${esc(defEn)} — ${esc(defTh)}</div>
    </div>`;
  });
}

document.getElementById("vocabBtnQuizRetry").onclick = () => {
  const st = vocabState;
  shuffleVocabQuizOrder(st);
  st.quizAnswers = new Array(st.quizQuestions.length).fill(null);
  st.quizChoices = st.quizQuestions.map(w => vocabBuildChoices(w[1], st.quizQuestions));
  st.quizPos = 0;
  st.quizScore = 0;
  document.getElementById("vocabQuizArea").style.display = "block";
  document.getElementById("vocabQuizResult").style.display = "none";
  renderVocabQuiz();
};
document.getElementById("vocabBtnQuizBack").onclick = () => openVocabHome();

// ============ INIT (load question bank, then boot the app) ============
let historyChart = null;

async function initApp(){
  try {
    const res = await fetch("questions.json");
    QUESTIONS = await res.json();
  } catch (err) {
    console.error("โหลดคลังข้อสอบ (questions.json) ไม่สำเร็จ:", err);
    QUESTIONS = [];
  }

  try {
    const vRes = await fetch("words.json");
    const rawVocab = await vRes.json();
    VOCAB_WORDS = normalizeVocabWords(rawVocab);
  } catch (err) {
    console.error("โหลดคลังคำศัพท์ (words.json) ไม่สำเร็จ:", err);
    VOCAB_WORDS = [];
  }

  buildSets();

  document.getElementById("total-count").textContent = QUESTIONS.length + "+";

  // TTS controls
  loadTtsVoices();
  const settingsTtsToggle = document.getElementById("settings-tts-toggle");
  if(settingsTtsToggle){
    settingsTtsToggle.checked = isAutoReadEnabled();
    settingsTtsToggle.onchange = () => setAutoReadEnabled(settingsTtsToggle.checked);
  }
  const settingsVoiceSelect = document.getElementById("settings-tts-voice-select");
  if(settingsVoiceSelect){
    settingsVoiceSelect.onchange = () => {
      const picked = ttsVoices.find(v => v.voiceURI === settingsVoiceSelect.value);
      if(picked){
        ttsChosenVoice = picked;
        localStorage.setItem(TTS_VOICE_KEY, picked.voiceURI);
        speakText("This is what I sound like now.");
      }
    };
  }
  const ttsReplayBtn = document.getElementById("tts-replay-btn");
  if(ttsReplayBtn){
    ttsReplayBtn.onclick = () => {
      const cq = state.currentQuiz;
      if(cq && cq.items && cq.items[cq.current]) speakText(cq.items[cq.current].q);
    };
  }

  const vocabTtsBtn = document.getElementById("vocabTtsBtn");
  if(vocabTtsBtn){
    vocabTtsBtn.onclick = (e) => {
      e.stopPropagation();
      const st = vocabState;
      if(!st) return;
      const w = st.days[st.currentDay][st.dayIndices[st.pos]];
      if(w) speakText(w[1]);
    };
  }
  const vocabQuizTtsBtn = document.getElementById("vocabQuizTtsBtn");
  if(vocabQuizTtsBtn){
    vocabQuizTtsBtn.onclick = () => {
      const st = vocabState;
      if(!st || !st.quizQuestions || !st.quizQuestions[st.quizPos]) return;
      const w = st.quizQuestions[st.quizPos];
      speakText(vocabQuizSpokenText(w[6], w[1]));
    };
  }

  showScreen("screen-home");
}

initApp();

function createHistoryChart(history){

    const ctx = document.getElementById("chart-history");

    if(!ctx) return;

    if(historyChart){
        historyChart.destroy();
    }

    historyChart = new Chart(ctx,{
        type:'line',
        data:{
            labels:history.map((_,i)=>`#${i+1}`),
            datasets:[{
                label:'Score (%)',
                data:history.map(x=>x.percentage),
                borderColor:'#667eea',
                backgroundColor:'rgba(102,126,234,0.2)',
                fill:true,
                tension:0.3
            }]
        },
        options:{
            responsive:true,
            scales:{
                y:{
                    min:0,
                    max:100
                }
            }
        }
    });
}