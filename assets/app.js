'use strict';

const VERSION = 4;
const STORAGE = 'lexilift_state_v4';
const PREVIOUS_STORAGES = ['lexilift_state_v3', 'lexilift_state_v2', 'lexilift_state_v1'];
const STAGES = ['New','Recognized','Learning','Improving','Productive','Active','Needs Review'];
const SKILLS = ['recognition','recall','grammar','collocation','production','retention','pronunciation'];
const NAV_ITEMS = [
  {view:'home',label:'Home',icon:'\u2302'},
  {view:'practice',label:'Practice',icon:'\u25b6'},
  {view:'review',label:'Review',icon:'\u21bb'},
  {view:'library',label:'Library',icon:'\u2630'},
  {view:'more',label:'More',icon:'\u2022\u2022\u2022'}
];

const defaultSkill = () => ({attempts:0,successes:0,score:0,lastSuccess:0,delayedSuccesses:0});
const defaultProgress = () => ({stage:'New',due:0,lastAttempt:0,lastOutcome:null,lapses:0,contexts:[],skills:Object.fromEntries(SKILLS.map(s=>[s,defaultSkill()]))});
const defaultState = {
  version:VERSION,
  profile:{name:'',dailyGoal:10,focus:'balanced'},
  progress:{},history:[],issues:[],streak:0,lastStudy:null,
  settings:{theme:'system',contextExpanded:false},diagnosticComplete:false
};

let CATALOG = [];
let META_BY_ID = new Map();
let ITEM_CACHE = new Map();
let CHUNK_PROMISES = new Map();
let state = structuredClone(defaultState);
let currentView = 'home';
let session = [];
let sessionIndex = 0;
let attempts = 0;
let hintLevel = 0;
let resolved = false;
let currentMode = 'recall';
let sessionSummary = {correct:0,total:0,skills:{},label:''};
let lastOpenResponse = '';
let lastOpenHasTarget = false;
let lastOpenIsDeveloped = false;
let deferredInstallPrompt = null;
let libraryLimit = 30;
let libraryType = 'all';
let libraryLevel = 'all';

window.addEventListener('DOMContentLoaded', init);

async function init(){
  try{
    setupThemeButtons();
    updateLoading('Loading 1,000 vocabulary targets...',25);
    CATALOG = await fetchJSON('data/catalog.json');
    META_BY_ID = new Map(CATALOG.map(x=>[x.id,x]));
    state = loadState();
    applyTheme();
    renderNavigation();
    setupInstallPrompt();
    updateLoading('Preparing your learning dashboard...',85);
    render();
    hideLoading();
    showOnboarding();
    if('serviceWorker' in navigator){navigator.serviceWorker.register('service-worker.js').catch(()=>{});}
  }catch(error){
    console.error(error);
    document.getElementById('loadingText').textContent = location.protocol==='file:' ? 'This website version must be hosted. Open LexiLift_phone_standalone.html instead, or publish the folder with GitHub Pages.' : 'The app could not load. Refresh the page or check your internet connection.';
  }
}

async function fetchJSON(url){
  const response = await fetch(url,{cache:'force-cache'});
  if(!response.ok) throw new Error('Could not load '+url);
  return response.json();
}

function updateLoading(text,pct){
  const t=document.getElementById('loadingText'),b=document.getElementById('loadingBar');
  if(t)t.textContent=text;if(b)b.style.width=Math.max(8,Math.min(100,pct))+'%';
}
function showLoading(text='Loading lesson data...'){
  updateLoading(text,45);document.getElementById('loading').classList.remove('hidden');
}
function hideLoading(){
  updateLoading('Ready',100);
  setTimeout(()=>{document.getElementById('loading').classList.add('hidden');document.getElementById('app').classList.remove('hidden');},120);
}

async function loadChunk(number){
  if(CHUNK_PROMISES.has(number)) return CHUNK_PROMISES.get(number);
  const promise = fetchJSON(`data/items-${String(number).padStart(2,'0')}.json`).then(items=>{
    items.forEach(item=>ITEM_CACHE.set(item.id,item));
    return items;
  });
  CHUNK_PROMISES.set(number,promise);
  return promise;
}

async function preloadIds(ids){
  const chunks = [...new Set(ids.map(id=>META_BY_ID.get(id)?.chunk).filter(Number.isInteger))];
  if(!chunks.length)return;
  showLoading('Loading this practice set...');
  for(let i=0;i<chunks.length;i++){
    updateLoading(`Loading lesson data ${i+1} of ${chunks.length}...`,35+Math.round((i+1)/chunks.length*55));
    await loadChunk(chunks[i]);
  }
  hideLoading();
}

async function getItem(id){
  if(ITEM_CACHE.has(id))return ITEM_CACHE.get(id);
  const meta=META_BY_ID.get(id);if(!meta)return null;
  await loadChunk(meta.chunk);return ITEM_CACHE.get(id)||null;
}

function deepMergeProgress(p){
  const d=defaultProgress();if(!p)return d;
  const out={...d,...p,skills:{...d.skills}};
  SKILLS.forEach(s=>out.skills[s]={...defaultSkill(),...(p.skills?.[s]||{})});
  return out;
}

function loadState(){
  try{
    let raw=JSON.parse(localStorage.getItem(STORAGE)||'null');
    if(!raw){
      for(const key of PREVIOUS_STORAGES){
        raw=JSON.parse(localStorage.getItem(key)||'null');
        if(raw)break;
      }
    }
    if(!raw)return structuredClone(defaultState);
    const s={...structuredClone(defaultState),...raw,version:VERSION};
    s.profile={...defaultState.profile,...(raw.profile||{})};
    s.settings={...defaultState.settings,...(raw.settings||{})};
    s.progress={};
    for(const [id,p] of Object.entries(raw.progress||{}))s.progress[id]=deepMergeProgress(p);
    localStorage.setItem(STORAGE,JSON.stringify(s));
    return s;
  }catch{return structuredClone(defaultState)}
}

function saveState(){localStorage.setItem(STORAGE,JSON.stringify(state))}
function itemProgress(id){const p=deepMergeProgress(state.progress[id]);state.progress[id]=p;return p}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function jsQuote(s=''){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' ')}
function htmlQuestion(s=''){return esc(s).replace(/\[([^\]]+)\]/g,'<mark>$1</mark>').replace(/_____/g,'<mark>_____</mark>')}
function todayKey(){return new Date().toISOString().slice(0,10)}
function updateStreak(){const t=todayKey();if(state.lastStudy===t)return;const y=new Date(Date.now()-86400000).toISOString().slice(0,10);state.streak=state.lastStudy===y?state.streak+1:1;state.lastStudy=t}
function toast(message){const t=document.getElementById('toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function isMobile(){return window.matchMedia('(max-width: 799px)').matches}

function renderNavigation(){
  const makeButton=x=>`<button class="nav-button ${currentView===x.view?'active':''}" data-view="${x.view}"><span class="nav-icon">${x.icon}</span><span>${x.label}</span></button>`;
  const bottom=document.getElementById('bottomNav');
  bottom.innerHTML=NAV_ITEMS.map(makeButton).join('');
  bottom.classList.toggle('hidden',currentView==='task');
  document.body.classList.toggle('task-mode',currentView==='task');
  document.getElementById('desktopNav').innerHTML=NAV_ITEMS.map(makeButton).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.view)));
}

function navTo(view){
  currentView=view;renderNavigation();render();
  document.getElementById('view').focus({preventScroll:true});window.scrollTo({top:0,behavior:'smooth'});
}

function render(){
  if(currentView==='home')renderHome();
  else if(currentView==='practice')renderPractice();
  else if(currentView==='review')renderReview();
  else if(currentView==='library')renderLibrary();
  else if(currentView==='more')renderMore();
  else if(currentView==='task')renderTask();
}

function pageHeader(title,subtitle='',actions=''){
  return `<div class="page-header"><div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${actions?`<div class="page-actions">${actions}</div>`:''}</div>`;
}

function stageCounts(){const c=Object.fromEntries(STAGES.map(s=>[s,0]));CATALOG.forEach(x=>c[itemProgress(x.id).stage]++);return c}
function dueItems(){const now=Date.now();return CATALOG.filter(x=>{const p=itemProgress(x.id);return p.stage!=='New'&&p.due<=now}).sort((a,b)=>itemProgress(a.id).due-itemProgress(b.id).due)}
function activeCount(type){return CATALOG.filter(x=>(!type||x.type===type)&&itemProgress(x.id).stage==='Active').length}
function skillPct(skill){let total=0,count=0;CATALOG.forEach(x=>{const p=itemProgress(x.id);if(p.skills[skill].attempts){total+=p.skills[skill].score;count++}});return count?Math.round(total/count*20):0}
function progressBar(value,max){const pct=Math.max(0,Math.min(100,max?value/max*100:0));return `<div class="progress-track"><span style="width:${pct}%"></span></div>`}

function installBanner(){
  if(deferredInstallPrompt)return `<div class="install-banner"><p><b>Install LexiLift</b><br>Open it like an app and keep the lessons available offline.</p><button class="btn small primary" onclick="installApp()">Install</button></div>`;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(ios&&!window.matchMedia('(display-mode: standalone)').matches)return `<div class="install-banner"><p><b>Add it to your iPhone</b><br>In Safari, tap Share, then Add to Home Screen.</p><button class="btn small" onclick="dismissInstallTip(this)">Got it</button></div>`;
  return '';
}

function renderHome(){
  const due=dueItems().length,acad=activeCount('academic/professional word'),pv=activeCount('phrasal verb'),c=stageCounts();
  const name=state.profile.name?`, ${state.profile.name}`:'';
  document.getElementById('view').innerHTML=pageHeader(`Welcome${name}`, 'Build vocabulary you can retrieve and use naturally.')+
    installBanner()+
    `<button class="btn primary full" onclick="startAdaptiveSession()">Start today's adaptive session</button>
    <div class="section-heading"><h2>Today</h2><small>${state.profile.dailyGoal} questions</small></div>
    <div class="grid stats-grid">
      <div class="card stat-card"><span>Due now</span><strong>${due}</strong><small>Includes long-term Active reviews</small></div>
      <div class="card stat-card"><span>Study streak</span><strong>${state.streak}</strong><small>${state.lastStudy?'day streak':'Start today'}</small></div>
      <div class="card stat-card"><span>Academic active</span><strong>${acad}<small>/700</small></strong>${progressBar(acad,700)}</div>
      <div class="card stat-card"><span>Phrasal verbs active</span><strong>${pv}<small>/300</small></strong>${progressBar(pv,300)}</div>
    </div>
    <div class="section-heading"><h2>Quick practice</h2><small>Production first</small></div>
    <div class="grid mode-grid">
      ${modeCard('recall','\u{1f9e0}','Contextual recall','Retrieve a precise expression without seeing it.')}
      ${modeCard('choice','\u{1f9e9}','Context choice','Use grammar and surrounding clauses to rule out near-synonyms.')}
      ${modeCard('upgrade','\u2b06','Sentence upgrade','Rewrite a complete sentence with more precise language.')}
      ${modeCard('speaking','\u{1f5e3}','Speaking','Respond to a real audience, purpose, and consequence.')}
    </div>
    <div class="section-heading"><h2>Mastery snapshot</h2><small>${c.Productive+c.Active} productive or active</small></div>
    <div class="card flat"><div class="grid skill-grid">${['recognition','recall','grammar','collocation','production','retention'].map(skillCard).join('')}</div></div>`;
}

function modeCard(mode,icon,title,description){
  return `<button class="card mode-card" onclick="startMode('${mode}')"><span class="mode-icon">${icon}</span><span><h3>${esc(title)}</h3><p>${esc(description)}</p></span><span class="chevron">&#8250;</span></button>`;
}
function skillCard(skill){return `<div class="skill-card"><b>${skill[0].toUpperCase()+skill.slice(1)}</b><span>${skillPct(skill)}% average</span><div class="skill-bar"><span style="width:${skillPct(skill)}%"></span></div></div>`}

function renderPractice(){
  document.getElementById('view').innerHTML=pageHeader('Practice','Choose one skill, or let the adaptive engine mix review and new vocabulary.',`<button class="btn primary small" onclick="startAdaptiveSession()">Adaptive</button>`)+
    `<div class="grid mode-grid">
      ${modeCard('recall','\u{1f9e0}','Contextual recall','A rich scenario, meaning cue, and multi-clause target sentence.')}
      ${modeCard('choice','\u{1f9e9}','Context choice','Five related options, two attempts, and targeted feedback.')}
      ${modeCard('upgrade','\u2b06','Sentence upgrade','Produce the target in a complete complex or compound sentence.')}
      ${modeCard('speaking','\u{1f5e3}','Speaking response','Explain a situation to a realistic audience and include a next step.')}
      ${modeCard('writing','\u270d','Professional writing','Write a concise message with a clear purpose and consequence.')}
      ${modeCard('pronunciation','\u{1f3a4}','Pronunciation','Practice the word, a phrase, and a full American English sentence.')}
    </div>
    <div class="section-heading"><h2>Baseline diagnostic</h2></div>
    <div class="card flat"><h3>${state.diagnosticComplete?'Run another diagnostic':'Check your starting point'}</h3><p class="muted">Ten mixed questions separately measure recognition, recall, grammar, collocation, and independent production.</p><button class="btn full" onclick="startDiagnostic()">Start 10-question diagnostic</button></div>`;
}

function renderReview(){
  const due=dueItems().length,c=stageCounts(),studied=1000-c.New;
  document.getElementById('view').innerHTML=pageHeader('Review and progress','Active vocabulary continues returning after longer intervals.')+
    `<button class="btn primary full" onclick="startMode('review')">Review ${due} due item${due===1?'':'s'}</button>
    <div class="section-heading"><h2>Progress</h2><small>${studied}/1000 encountered</small></div>
    <div class="grid stats-grid">
      <div class="card stat-card"><span>Encountered</span><strong>${studied}</strong>${progressBar(studied,1000)}</div>
      <div class="card stat-card"><span>Productive</span><strong>${c.Productive}</strong><small>Independent use shown</small></div>
      <div class="card stat-card"><span>Active</span><strong>${c.Active}</strong><small>Delayed mastery shown</small></div>
      <div class="card stat-card"><span>Needs review</span><strong>${c['Needs Review']}</strong><small>Returns sooner</small></div>
    </div>
    <div class="section-heading"><h2>Skill evidence</h2></div>
    <div class="card flat"><div class="grid skill-grid">${SKILLS.map(skillCard).join('')}</div></div>
    <div class="section-heading"><h2>Mastery stages</h2></div>
    <div class="card flat">${STAGES.map(s=>`<div class="review-row"><span>${esc(s)}</span><b>${c[s]}</b></div>`).join('')}</div>`;
}

function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
function focusMatch(x){const f=state.profile.focus;if(f==='balanced')return 1;if(f==='academic')return x.type==='academic/professional word'?3:1;if(f==='phrasal')return x.type==='phrasal verb'?3:1;if(f==='teaching')return ['education','STEM and technology','communication','workplace and leadership'].includes(x.category)?4:1;return 1}
function weightedPick(pool,n){const out=[],copy=[...pool];while(copy.length&&out.length<n){const weights=copy.map(focusMatch),sum=weights.reduce((a,b)=>a+b,0);let r=Math.random()*sum,idx=0;for(;idx<copy.length;idx++){r-=weights[idx];if(r<=0)break}out.push(copy.splice(Math.min(idx,copy.length-1),1)[0])}return out}
function weakestMode(x){const p=itemProgress(x.id),pairs=[['recall',p.skills.recall.score],['choice',p.skills.recognition.score],['upgrade',Math.min(p.skills.grammar.score,p.skills.collocation.score)],['speaking',p.skills.production.score],['pronunciation',p.skills.pronunciation.score]];return pairs.sort((a,b)=>a[1]-b[1])[0][0]}
function newPool(type){return CATALOG.filter(x=>x.type===type&&itemProgress(x.id).stage==='New')}

async function startAdaptiveSession(){
  const goal=Math.max(6,Math.min(20,state.profile.dailyGoal||10)),tasks=[],usedModes={};
  const add=(x,mode,source)=>{tasks.push({id:x.id,mode,source});(usedModes[x.id]??=new Set()).add(mode)};
  const reviews=dueItems().slice(0,Math.ceil(goal*.3));reviews.forEach(x=>add(x,weakestMode(x),'due'));
  const weak=CATALOG.filter(x=>['Recognized','Learning','Improving','Productive','Needs Review'].includes(itemProgress(x.id).stage)&&!reviews.some(r=>r.id===x.id)).sort((a,b)=>itemProgress(a.id).skills.recall.score-itemProgress(b.id).skills.recall.score).slice(0,Math.ceil(goal*.2));
  weak.forEach(x=>add(x,weakestMode(x),'weak'));
  const maxNew=Math.min(8,Math.max(2,Math.ceil(goal*.5)));
  let acadN=Math.min(5,maxNew),pvN=Math.min(3,maxNew-acadN);
  if(state.profile.focus==='phrasal'){pvN=Math.min(3,Math.ceil(maxNew*.5));acadN=Math.min(5,maxNew-pvN)}
  const fresh=[...weightedPick(newPool('academic/professional word'),acadN),...weightedPick(newPool('phrasal verb'),pvN)].slice(0,maxNew);
  fresh.forEach((x,i)=>add(x,i%2===0?'recall':'choice','new'));
  const secondPass=shuffle([...fresh,...weak,...reviews]),followModes=['upgrade','speaking','writing','recall','choice'];let cursor=0;
  while(tasks.length<goal&&secondPass.length){const x=secondPass[cursor%secondPass.length],already=usedModes[x.id]||new Set(),mode=followModes.find(m=>!already.has(m))||'recall';add(x,mode,'reinforcement');cursor++;if(cursor>goal*5)break}
  while(tasks.length<goal){const learned=weightedPick(CATALOG.filter(x=>itemProgress(x.id).stage!=='New'),1);if(!learned.length)break;add(learned[0],weakestMode(learned[0]),'extra-review')}
  await preloadIds(tasks.map(t=>t.id));startSession(tasks.slice(0,goal),'adaptive');
}

async function startMode(mode){
  let pool=mode==='review'?dueItems():CATALOG;
  if(!pool.length){toast('No reviews are due, so new items were selected.');pool=CATALOG.filter(x=>itemProgress(x.id).stage==='New')}
  const n=Math.max(6,Math.min(16,state.profile.dailyGoal||10)),chosen=weightedPick(pool,n);
  const tasks=chosen.map(x=>({id:x.id,mode:mode==='review'?weakestMode(x):mode,source:mode}));
  await preloadIds(tasks.map(t=>t.id));startSession(tasks,mode);
}

async function startDiagnostic(){
  const acad=weightedPick(CATALOG.filter(x=>x.type==='academic/professional word'),6),pv=weightedPick(CATALOG.filter(x=>x.type==='phrasal verb'),4);
  const modes=['recall','choice','upgrade','recall','writing','choice','recall','upgrade','speaking','choice'];
  const selected=[...acad,...pv],tasks=selected.map((x,i)=>({id:x.id,mode:modes[i],source:'diagnostic'}));
  await preloadIds(tasks.map(t=>t.id));startSession(tasks,'diagnostic');
}

function startSession(tasks,label){session=tasks;sessionIndex=0;attempts=0;hintLevel=0;resolved=false;sessionSummary={correct:0,total:0,skills:{},label};currentView='task';renderNavigation();renderTask();window.scrollTo(0,0)}
function currentTask(){return session[sessionIndex]}
function currentItem(){return ITEM_CACHE.get(currentTask()?.id)}

function contextDetails(e){
  const meta=e.contextMeta||{},preview=(e.situation||'').split(/(?<=[.!?])\s+/)[0]||'Read the full situation';
  const open=!isMobile()||state.settings.contextExpanded?'open':'';
  return `<details class="context-details" ${open}><summary><span>Context</span><span class="context-preview">${esc(preview)}</span></summary><div class="context-body"><p>${esc(e.situation)}</p><div class="context-meta">${meta.role?`<span class="pill">Role: ${esc(meta.role)}</span>`:''}${meta.audience?`<span class="pill">Audience: ${esc(meta.audience)}</span>`:''}${meta.stakes?`<span class="pill">Why it matters: ${esc(meta.stakes)}</span>`:''}</div></div></details>`;
}

function concisePrompt(mode,e){
  if(mode==='recall'||mode==='review')return 'Complete the sentence with one precise expression.';
  if(mode==='choice')return 'Choose the option that fits both the meaning and the grammar.';
  if(mode==='upgrade')return 'Rewrite the complete sentence with the precise expression.';
  return e.prompt;
}

function renderTask(){
  const task=currentTask();if(!task){finishSession();return}
  currentMode=task.mode;
  const x=currentItem();if(!x){toast('This lesson item did not load.');return}
  const mode=currentMode==='review'?weakestMode(x):currentMode,e=x.exercises[mode]||x.exercises.recall,p=itemProgress(x.id);
  let body=`<div class="pill-row"><span class="pill">${esc(mode)}</span><span class="pill">${esc(x.type)}</span><span class="pill">${esc(x.category)}</span></div>${contextDetails(e)}`;
  if(mode==='recall'||mode==='review'){
    body+=`<div class="prompt">${esc(concisePrompt(mode,e))}</div><div class="meaning-cue"><b>Meaning cue:</b> ${esc(e.meaningCue||x.meaning)}</div><div class="question-box">${htmlQuestion(e.sentence)}</div><input class="answer single" id="answer" autocomplete="off" autocapitalize="sentences" placeholder="Type the expression or the complete sentence"><div class="action-row mobile-sticky-actions"><button class="btn primary" onclick="checkRecall()">Check answer</button><button class="btn" onclick="showHint()">Hint</button><button class="btn" onclick="giveUp()">Reveal</button></div>`;
  }else if(mode==='choice'){
    body+=`<div class="prompt">${esc(concisePrompt(mode,e))}</div><div class="question-box">${htmlQuestion(e.sentence)}</div><div id="choices" class="choice-list">${shuffle(e.choices).map(c=>`<button class="choice" data-id="${c.id}" onclick="chooseAnswer('${c.id}')"><strong>${esc(c.form)}</strong><span>&#8250;</span></button>`).join('')}</div>`;
  }else if(mode==='upgrade'){
    body+=`<div class="prompt">${esc(concisePrompt(mode,e))}</div><div class="meaning-cue"><b>Meaning to express:</b> ${esc(e.meaningCue)}</div><div class="question-box">${htmlQuestion(e.basicSentence)}</div><textarea class="answer" id="answer" placeholder="Write the complete upgraded sentence."></textarea><div class="action-row mobile-sticky-actions"><button class="btn primary" onclick="compareOpen()">Compare with model</button><button class="btn" onclick="showHint()">Hint</button></div>`;
  }else if(mode==='pronunciation'){
    body+=`<div class="prompt">${esc(e.prompt)}</div><div class="question-box"><b>Pronunciation focus</b><p>${esc(x.pronunciation)}</p><ul>${e.requirements.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div><div class="action-row"><button class="btn small" onclick="speak('${jsQuote(x.term)}')">Hear word</button><button class="btn small" onclick="speak('${jsQuote((x.collocation||x.term).split(';')[0])}')">Hear phrase</button><button class="btn small" onclick="speak('${jsQuote(x.example)}')">Hear sentence</button><button class="btn small" onclick="startSpeechInput()">Record transcript</button></div><textarea class="answer" id="answer" placeholder="Optional speech-recognition transcript"></textarea><div class="action-row mobile-sticky-actions"><button class="btn primary" onclick="compareOpen()">Rate practice</button></div>`;
  }else{
    body+=`<div class="prompt">${esc(e.prompt)}</div><div class="question-box"><b>Requirements</b><ul>${e.requirements.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>${mode==='speaking'?`<button class="btn full" onclick="startSpeechInput()">Dictate response</button>`:''}<textarea class="answer" id="answer" placeholder="${mode==='speaking'?'Speak first, then edit the transcript if needed.':'Write your response here.'}"></textarea><div class="action-row mobile-sticky-actions"><button class="btn primary" onclick="compareOpen()">Compare with model</button></div>`;
  }
  const progress=Math.round((sessionIndex)/Math.max(1,session.length)*100);
  document.getElementById('view').innerHTML=`<div class="practice-wrap"><div class="practice-progress"><div class="progress-track"><span style="width:${progress}%"></span></div><span>${sessionIndex+1} of ${session.length}</span></div><div class="card practice-card"><div class="stage-line"><span class="stage-badge">${esc(p.stage)}</span><button class="btn small" onclick="endSessionEarly()">End</button></div><h1 class="practice-title">${mode==='choice'?'Choose the best answer':mode==='recall'||mode==='review'?'Recall the expression':'Use the expression'}</h1>${body}<div id="hintArea"></div><div id="feedback" class="feedback hidden"></div><div class="action-row"><button class="btn small" onclick="reportIssue()">Report question</button>${['speaking','writing','pronunciation'].includes(mode)?`<button class="btn small" onclick="speak('${jsQuote(x.term)}')">Hear target</button>`:''}</div></div></div>`;
  const input=document.getElementById('answer');if(input&&mode==='recall')input.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();checkRecall()}});
}

function normalizeAnswer(s){return String(s||'').toLowerCase().trim().replace(/[\u2019]/g,"'").replace(/[^a-z0-9' -]/g,'').replace(/\s+/g,' ')}
function answerMatches(input,accepted){const text=normalizeAnswer(input);if(!text)return false;return accepted.some(a=>{const target=normalizeAnswer(a);if(!target)return false;if(text===target)return true;const escaped=target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(text)})}

function checkRecall(){
  if(resolved)return;const x=currentItem(),e=x.exercises.recall,raw=document.getElementById('answer').value,ok=answerMatches(raw,e.acceptedAnswers);attempts++;
  if(ok){resolved=true;recordResult(x.id,'recall',attempts===1?4:3,currentMode,true);showResolved(`<h3>Correct: ${esc(x.term)}</h3><p>${esc(e.modelAnswer)}</p>${detailHTML(x)}<button class="btn primary full" onclick="nextTask()">Continue</button>`)}
  else if(attempts===1){hintLevel=1;showHintText(e.hint1);toast('Not yet. Use the context and try once more.')}
  else{resolved=true;recordResult(x.id,'recall',0,currentMode,false);scheduleRetry(x.id,'recall');showResolved(`<h3>The answer is ${esc(x.term)}</h3><p>${esc(e.modelAnswer)}</p><p class="muted">This item will return later in the session.</p>${detailHTML(x)}<button class="btn primary full" onclick="nextTask()">Continue</button>`)}
}
function showHint(){const x=currentItem(),e=x.exercises[currentMode==='upgrade'?'recall':currentMode]||x.exercises.recall;hintLevel=Math.min(2,hintLevel+1);showHintText(hintLevel===1?e.hint1:e.hint2)}
function showHintText(text){document.getElementById('hintArea').innerHTML=`<div class="hint"><b>Hint ${hintLevel}:</b> ${esc(text)}</div>`}
function giveUp(){if(resolved)return;const x=currentItem();resolved=true;recordResult(x.id,'recall',0,currentMode,false);scheduleRetry(x.id,'recall');showResolved(`<h3>The answer is ${esc(x.term)}</h3><p>${esc(x.example)}</p>${detailHTML(x)}<button class="btn primary full" onclick="nextTask()">Continue</button>`)}

function chooseAnswer(id){
  if(resolved)return;const x=currentItem(),e=x.exercises.choice,correct=id===e.answerId;attempts++;const clicked=document.querySelector(`.choice[data-id="${id}"]`);
  if(correct){resolved=true;document.querySelectorAll('.choice').forEach(b=>{b.disabled=true;if(b.dataset.id===e.answerId)b.classList.add('correct')});recordResult(x.id,'recognition',attempts===1?4:3,'choice',true);showResolved(`<h3>Correct</h3><p>${esc(e.explanation)}</p>${choiceFeedback(e,id)}<button class="btn primary full" onclick="nextTask()">Continue</button>`)}
  else{clicked.disabled=true;clicked.classList.add('wrong');if(attempts===1){hintLevel=1;showHintText(e.hint1);showResolved(`<p><b>Try again.</b> ${choiceFeedback(e,id)}</p>`,false)}else{resolved=true;document.querySelectorAll('.choice').forEach(b=>{b.disabled=true;if(b.dataset.id===e.answerId)b.classList.add('correct')});recordResult(x.id,'recognition',0,'choice',false);scheduleRetry(x.id,'choice');showResolved(`<h3>Correct answer: ${esc(e.answerForm)}</h3><p>${esc(e.explanation)}</p>${choiceFeedback(e,id)}<button class="btn primary full" onclick="nextTask()">Continue</button>`)}}
}
function choiceFeedback(e,id){const c=e.choices.find(z=>z.id===id);return c?`<p class="muted">${esc(c.feedback)}</p>`:''}

function compareOpen(){
  if(resolved)return;const x=currentItem(),e=x.exercises[currentMode],response=(document.getElementById('answer').value||'').trim();
  if(currentMode!=='pronunciation'&&!response){toast('Write or dictate a response before viewing the model.');return}
  resolved=true;lastOpenResponse=response;const forms=e.acceptedAnswers||[x.term,e.answer].filter(Boolean);lastOpenHasTarget=currentMode==='pronunciation'||answerMatches(response,forms);lastOpenIsDeveloped=currentMode==='pronunciation'||normalizeAnswer(response).split(' ').filter(Boolean).length>=8;
  const quality=currentMode==='pronunciation'?'Practice the word, phrase, and full sentence before rating yourself.':lastOpenHasTarget?(lastOpenIsDeveloped?'The target expression was detected in a developed response.':'The target expression was detected, but the response is short.'):'The target expression was not detected, so a high rating will be capped.';
  showResolved(`<h3>Compare with the model</h3><div class="detail-grid"><div class="detail"><b>Your response</b>${response?esc(response):'<span class="muted">No transcript entered.</span>'}</div><div class="detail"><b>Model</b>${esc(e.modelAnswer)}</div></div><div class="quality-check ${lastOpenHasTarget?'good':'bad'}">${esc(quality)}</div>${currentMode==='upgrade'?`<p><b>Check:</b> ${esc(e.checkFor)}</p>`:''}${detailHTML(x)}<h3>Rate only what you produced</h3><div class="rating-grid"><button class="btn bad" onclick="rateOpen(0)">Not produced</button><button class="btn" onclick="rateOpen(1)">Used help</button><button class="btn good" onclick="rateOpen(3)">Independent, awkward</button><button class="btn primary" onclick="rateOpen(4)">Natural and accurate</button></div>`);
}

function rateOpen(q){
  const x=currentItem();
  if(currentMode==='pronunciation'){recordResult(x.id,'pronunciation',q,currentMode,q>=3);if(q<3)scheduleRetry(x.id,currentMode);nextTask();return}
  if(!lastOpenHasTarget&&q>1){q=1;toast('Rating capped because the target expression was missing.')}
  else if(!lastOpenIsDeveloped&&q>3){q=3;toast('Rating capped because the response was too short.')}
  if(currentMode==='upgrade'){recordResult(x.id,'grammar',q,currentMode,q>=3);recordResult(x.id,'collocation',q,currentMode,q>=3,false);if(q>=3)recordResult(x.id,'production',Math.max(2,q-1),currentMode,true,false)}
  else{recordResult(x.id,'production',q,currentMode,q>=3);recordResult(x.id,'collocation',Math.max(0,q-1),currentMode,q>=3,false);recordResult(x.id,'grammar',Math.max(0,q-1),currentMode,q>=3,false)}
  if(q<3)scheduleRetry(x.id,currentMode);nextTask();
}

function showResolved(content,replace=true){const f=document.getElementById('feedback');f.classList.remove('hidden');if(replace)f.innerHTML=content;else f.innerHTML+=content;setTimeout(()=>f.scrollIntoView({behavior:'smooth',block:'nearest'}),40)}
function detailHTML(x){return `<div class="detail-grid"><div class="detail"><b>Meaning</b>${esc(x.meaning)}</div><div class="detail"><b>Pattern</b>${esc(x.pattern)}</div><div class="detail"><b>Collocation</b>${esc(x.collocation)}</div><div class="detail"><b>Contrast</b>${esc(x.synonymOrContrast)}</div><div class="detail"><b>Register</b>${esc(x.register)}</div><div class="detail"><b>Pronunciation</b>${esc(x.pronunciation)}<div class="action-row"><button class="btn small" onclick="speak('${jsQuote(x.term)}')">Hear</button></div></div></div>`}
function scheduleRetry(id,mode){if(currentTask().retry)return;const ahead=session.slice(sessionIndex+1).some(t=>t.id===id&&t.retry);if(ahead)return;const pos=Math.min(session.length,sessionIndex+4);session.splice(pos,0,{id,mode,retry:true,source:'same-session retry'})}
function deriveStage(p){if(p.lastOutcome==='fail')return'Needs Review';const s=p.skills;if(s.retention.delayedSuccesses>=2&&s.recall.successes>=3&&s.production.successes>=2&&s.grammar.successes>=2&&s.collocation.successes>=2&&p.contexts.length>=2)return'Active';if(s.production.successes>=1&&s.recall.successes>=2&&s.grammar.successes>=1&&s.collocation.successes>=1)return'Productive';if(s.recall.successes>=2&&(s.grammar.successes+s.collocation.successes)>=1)return'Improving';if(s.recall.successes>=1||s.recognition.successes>=2)return'Learning';if(s.recognition.successes>=1)return'Recognized';return'New'}
function nextInterval(stage,quality){if(quality===0)return 1/24;const table={New:1,Recognized:1,Learning:3,Improving:7,Productive:21,Active:60,'Needs Review':1};let days=table[stage]||1;if(stage==='Active'){const p=currentItem()?itemProgress(currentItem().id):null,r=p?.skills.retention.delayedSuccesses||0;days=[60,120,180][Math.min(2,r)]}return days}
function recordResult(id,skill,quality,mode,success,countSummary=true){const p=itemProgress(id),s=p.skills[skill],now=Date.now(),gap=p.lastAttempt?now-p.lastAttempt:0;s.attempts++;s.score=Math.max(0,Math.min(5,s.score+(quality===0?-1:quality>=4?1:.5)));if(success){s.successes++;s.lastSuccess=now;if((skill==='recall'||skill==='production')&&gap>=3*86400000){s.delayedSuccesses++;p.skills.retention.attempts++;p.skills.retention.successes++;p.skills.retention.delayedSuccesses++;p.skills.retention.score=Math.min(5,p.skills.retention.score+1)}}else p.lapses++;if(success&&!p.contexts.includes(mode))p.contexts.push(mode);p.lastAttempt=now;p.lastOutcome=success?'success':'fail';p.stage=deriveStage(p);p.due=now+nextInterval(p.stage,quality)*86400000;state.progress[id]=p;state.history.push({date:now,id,skill,quality,mode,success});state.history=state.history.slice(-5000);if(countSummary){sessionSummary.total++;if(success)sessionSummary.correct++;sessionSummary.skills[skill]=(sessionSummary.skills[skill]||0)+1}updateStreak();saveState()}
function nextTask(){sessionIndex++;attempts=0;hintLevel=0;resolved=false;renderTask();window.scrollTo({top:0,behavior:'smooth'})}
function endSessionEarly(){if(confirm('End this session now? Completed responses are already saved.'))finishSession()}
function finishSession(){if(sessionSummary.label==='diagnostic'){state.diagnosticComplete=true;saveState()}currentView='practice';renderNavigation();const pct=sessionSummary.total?Math.round(100*sessionSummary.correct/sessionSummary.total):0;document.getElementById('view').innerHTML=pageHeader('Session complete','Recognition and production were recorded separately.')+`<div class="card empty-state"><div style="font-size:2.6rem">\u{1f3af}</div><h2>${sessionSummary.total} scored responses</h2><p><b>${pct}%</b> successful on the first scored evidence for each task.</p><p>Failed items were inserted again and remain scheduled soon, while Active items will return after 60 to 180 days.</p><button class="btn primary full" onclick="startAdaptiveSession()">Start another session</button><button class="btn full" style="margin-top:8px" onclick="navTo('review')">View progress</button></div>`}

function speak(text){if(!('speechSynthesis' in window)){toast('Speech synthesis is not supported in this browser.');return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';utterance.rate=.88;speechSynthesis.speak(utterance)}
function startSpeechInput(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast('Speech recognition is not available in this browser.');return}const r=new SR();r.lang='en-US';r.interimResults=true;r.onresult=e=>{document.getElementById('answer').value=[...e.results].map(z=>z[0].transcript).join(' ')};r.onerror=()=>toast('Could not capture speech. Check microphone permission.');r.start();toast('Listening...')}

function renderLibrary(){
  libraryLimit=30;
  document.getElementById('view').innerHTML=pageHeader('Vocabulary library','Search all 1,000 targets without loading the entire exercise database at once.')+
    `<div class="library-controls"><div class="search-box"><input id="librarySearch" type="search" placeholder="Search a word or meaning" autocomplete="off"></div><div class="filter-row"><button class="filter-chip active" data-type="all">All</button><button class="filter-chip" data-type="academic">Academic</button><button class="filter-chip" data-type="phrasal">Phrasal verbs</button><select id="levelFilter" class="filter-chip"><option value="all">All levels</option><option>B1</option><option>B2</option><option>C1</option></select></div></div><div id="libraryResults"></div>`;
  document.getElementById('librarySearch').addEventListener('input',()=>{libraryLimit=30;renderLibraryRows()});
  document.getElementById('levelFilter').addEventListener('change',e=>{libraryLevel=e.target.value;libraryLimit=30;renderLibraryRows()});
  document.querySelectorAll('[data-type]').forEach(b=>b.addEventListener('click',()=>{libraryType=b.dataset.type;document.querySelectorAll('[data-type]').forEach(z=>z.classList.toggle('active',z===b));libraryLimit=30;renderLibraryRows()}));
  renderLibraryRows();
}

function renderLibraryRows(){
  const input=document.getElementById('librarySearch');if(!input)return;
  const q=input.value.trim().toLowerCase();
  const matches=CATALOG.filter(x=>(libraryType==='all'||(libraryType==='academic'&&x.type==='academic/professional word')||(libraryType==='phrasal'&&x.type==='phrasal verb'))&&(libraryLevel==='all'||x.level===libraryLevel)&&(!q||[x.term,x.meaning,x.category,x.partOfSpeech].join(' ').toLowerCase().includes(q)));
  const rows=matches.slice(0,libraryLimit);
  document.getElementById('libraryResults').innerHTML=`<p class="muted">Showing ${rows.length} of ${matches.length}</p><div class="library-list">${rows.map(x=>{const p=itemProgress(x.id);return `<article class="word-card" onclick="openWord('${x.id}')"><div><h3>${esc(x.term)}</h3><p>${esc(x.meaning)}</p><div class="word-card-meta"><span class="pill">${esc(x.partOfSpeech)}</span><span class="pill">${esc(x.level)}</span><span class="pill">${esc(p.stage)}</span></div></div><button class="audio-button" aria-label="Hear ${esc(x.term)}" onclick="event.stopPropagation();speak('${jsQuote(x.term)}')">&#128266;</button></article>`}).join('')}</div>${matches.length>rows.length?`<button class="btn full" style="margin-top:12px" onclick="loadMoreLibrary()">Show more</button>`:''}`;
}
function loadMoreLibrary(){libraryLimit+=30;renderLibraryRows()}
async function openWord(id){
  showLoading('Loading word details...');const x=await getItem(id);hideLoading();if(!x)return;
  const p=itemProgress(id),modal=document.getElementById('modal');
  modal.innerHTML=`<div class="modal-sheet"><button class="icon-button modal-close" onclick="closeModal()" aria-label="Close">&#215;</button><div class="pill-row"><span class="pill">${esc(x.type)}</span><span class="pill">${esc(x.level)}</span><span class="pill">${esc(p.stage)}</span></div><h2>${esc(x.term)}</h2><p>${esc(x.meaning)}</p><div class="detail-grid">${detailHTML(x).replace('<div class="detail-grid">','').replace(/<\/div>$/,'')}</div><div class="modal-actions"><button class="btn primary" onclick="closeModal();startSingleItem('${id}','recall')">Practice this word</button><button class="btn" onclick="speak('${jsQuote(x.example)}')">Hear example</button></div></div>`;
  modal.classList.remove('hidden');
}
function closeModal(){document.getElementById('modal').classList.add('hidden')}
async function startSingleItem(id,mode){await preloadIds([id]);startSession([{id,mode,source:'library'}],mode)}

function renderMore(){
  document.getElementById('view').innerHTML=pageHeader('Settings and data','Adjust your learning focus, appearance, and backups.')+
    `<div class="grid">
      <div class="card flat"><h2>Learning profile</h2><div class="form-grid two"><div class="field"><label for="nameSet">Name</label><input id="nameSet" value="${esc(state.profile.name)}" placeholder="Optional"></div><div class="field"><label for="goalSet">Daily questions</label><select id="goalSet">${[6,8,10,12,16,20].map(n=>`<option ${n===state.profile.dailyGoal?'selected':''}>${n}</option>`).join('')}</select></div><div class="field"><label for="focusSet">Primary focus</label><select id="focusSet"><option value="balanced">Balanced</option><option value="academic">Academic and professional</option><option value="phrasal">Phrasal verbs</option><option value="teaching">Teaching and STEM</option></select></div><div class="field"><label for="themeSet">Appearance</label><select id="themeSet"><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></div></div><button class="btn primary full" style="margin-top:14px" onclick="saveSettings()">Save settings</button></div>
      <div class="card flat"><h2>Progress backup</h2><p class="muted">Progress is stored only in this browser. Export it before changing phones or clearing website data.</p><div class="action-row"><button class="btn" onclick="exportProgress()">Export progress</button><label class="btn">Import progress<input type="file" hidden accept="application/json" onchange="importProgress(event)"></label><button class="btn" onclick="exportIssues()">Export reports</button><button class="btn bad" onclick="resetProgress()">Reset</button></div></div>
      <div class="card flat"><h2>Download datasets</h2><p class="muted">The public repository includes the full vocabulary and 6,000-exercise datasets.</p><div class="action-row"><a class="btn" href="downloads/vocabulary_1000_v3.json" download>Vocabulary JSON</a><a class="btn" href="downloads/vocabulary_1000_v3.csv" download>Vocabulary CSV</a><a class="btn" href="downloads/exercises_6000_v3.csv" download>Exercises CSV</a><a class="btn" href="downloads/quizlet_1000_v3.tsv" download>Quizlet TSV</a></div></div>
      <div class="card flat"><h2>Privacy</h2><p class="muted">LexiLift has no account, ads, analytics, or server database. Learning progress and issue reports remain on your device unless you export them.</p></div>
    </div>`;
  document.getElementById('focusSet').value=state.profile.focus;document.getElementById('themeSet').value=state.settings.theme;
}

function saveSettings(){state.profile.name=document.getElementById('nameSet').value.trim();state.profile.dailyGoal=Number(document.getElementById('goalSet').value)||10;state.profile.focus=document.getElementById('focusSet').value;state.settings.theme=document.getElementById('themeSet').value;saveState();applyTheme();toast('Settings saved');renderNavigation()}
function setupThemeButtons(){document.querySelectorAll('[data-action="theme"]').forEach(b=>b.addEventListener('click',()=>{const active=resolvedTheme();state.settings.theme=active==='dark'?'light':'dark';saveState();applyTheme()}))}
function resolvedTheme(){if(state.settings.theme==='system')return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';return state.settings.theme}
function applyTheme(){document.documentElement.dataset.theme=resolvedTheme();document.querySelectorAll('[data-action="theme"]').forEach(b=>b.innerHTML=resolvedTheme()==='dark'?'&#9728;':'&#9790;')}

function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportProgress(){download('lexilift_v4_progress.json',JSON.stringify(state,null,2),'application/json')}
function exportIssues(){download('lexilift_v4_issue_reports.json',JSON.stringify(state.issues,null,2),'application/json')}
function importProgress(event){const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);state={...structuredClone(defaultState),...incoming,version:VERSION};state.profile={...defaultState.profile,...(incoming.profile||{})};state.settings={...defaultState.settings,...(incoming.settings||{})};saveState();applyTheme();render();toast('Progress imported')}catch{toast('The file could not be imported')}};reader.readAsText(file)}
function resetProgress(){if(confirm('Delete all local progress and issue reports?')){state=structuredClone(defaultState);saveState();applyTheme();render();toast('Progress reset')}}

function reportIssue(){
  const x=currentItem(),modal=document.getElementById('modal');
  modal.innerHTML=`<div class="modal-sheet"><button class="icon-button modal-close" onclick="closeModal()" aria-label="Close">&#215;</button><h2>Report a question problem</h2><div class="form-grid"><div class="field"><label for="issueType">Problem type</label><select id="issueType"><option>Missing or weak context</option><option>Context is too generic or repetitive</option><option>Sentence is unnecessarily complicated</option><option>More than one answer could fit</option><option>Answer is visible</option><option>Grammar or example problem</option><option>Meaning or register problem</option><option>Pronunciation problem</option><option>Other</option></select></div><div class="field"><label for="issueNote">What should be corrected?</label><textarea id="issueNote" rows="5"></textarea></div></div><button class="btn primary full" style="margin-top:14px" onclick="saveIssue()">Save report on this device</button></div>`;
  modal.classList.remove('hidden');
}
function saveIssue(){const x=currentItem();state.issues.push({date:Date.now(),itemId:x.id,term:x.term,mode:currentMode,type:document.getElementById('issueType').value,note:document.getElementById('issueNote').value});saveState();closeModal();toast('Issue report saved')}

function showOnboarding(){
  if(localStorage.getItem(STORAGE))return;
  const modal=document.getElementById('onboarding');
  modal.innerHTML=`<div class="modal-sheet"><div class="app-logo">L</div><h2>Welcome to LexiLift</h2><p>This mobile edition keeps the rich contexts but reveals them progressively, so each lesson fits comfortably on a phone.</p><div class="form-grid"><div class="field"><label for="obName">Your name</label><input id="obName" placeholder="Optional"></div><div class="field"><label for="obGoal">Daily questions</label><select id="obGoal"><option>6</option><option>8</option><option selected>10</option><option>12</option><option>16</option></select></div></div><button class="btn primary full" style="margin-top:14px" onclick="finishOnboarding(true)">Start diagnostic</button><button class="btn full" style="margin-top:8px" onclick="finishOnboarding(false)">Go directly to practice</button></div>`;
  modal.classList.remove('hidden');
}
function finishOnboarding(diagnostic){state.profile.name=document.getElementById('obName').value.trim();state.profile.dailyGoal=Number(document.getElementById('obGoal').value);saveState();document.getElementById('onboarding').classList.add('hidden');diagnostic?startDiagnostic():startAdaptiveSession()}

function setupInstallPrompt(){
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;if(currentView==='home')renderHome()});
}
async function installApp(){if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;renderHome()}
function dismissInstallTip(button){button.closest('.install-banner')?.remove()}
