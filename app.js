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
const isAutoReadEnabled = () => localStorage.getItem(TTS_KEY) === "1";
const setAutoReadEnabled = on => localStorage.setItem(TTS_KEY, on ? "1" : "0");

function speakText(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // stop anything currently being read
  // Replace underscores (blank spaces in the question) with spaced commas so the
  // speech engine pauses there instead of skipping over them silently.
  const spoken = String(text).replace(/_+/g, " , , , ");
  const utter = new SpeechSynthesisUtterance(spoken);
  utter.lang = "en-EN";
  utter.rate = 0.9;
  window.speechSynthesis.speak(utter);
}

// ============ UTILS ============
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shuffle = shuffleArr;
const showScreen = id => {if("speechSynthesis" in window) window.speechSynthesis.cancel();document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));document.getElementById(id).classList.add("active");};
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
    else titleEl.innerHTML = `<span class="pill">🎲 Random ${esc(cq.params.level || "Mixed")} • ${total} ข้อ</span>`;
  }

  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("quiz-info").textContent = `ข้อ ${cq.current + 1}/${total} • ตอบแล้ว ${answered}/${total}`;
  document.getElementById("question-badge").textContent = `${it.tense} • ${it.level}`;
  document.getElementById("question-text").textContent = it.q;

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
                    ${item.mode === "set" ? "โหมดชุด" : "โหมดสุ่ม"} • ถูก ${item.correct}/${item.total} • ผิด ${wrong} ข้อ
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
  buildSets();
  document.getElementById("total-count").textContent = QUESTIONS.length + "+";

  // TTS controls
  const ttsToggle = document.getElementById("tts-toggle");
  if(ttsToggle){
    ttsToggle.checked = isAutoReadEnabled();
    ttsToggle.onchange = () => setAutoReadEnabled(ttsToggle.checked);
  }
  const ttsReplayBtn = document.getElementById("tts-replay-btn");
  if(ttsReplayBtn){
    ttsReplayBtn.onclick = () => {
      const cq = state.currentQuiz;
      if(cq && cq.items && cq.items[cq.current]) speakText(cq.items[cq.current].q);
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
