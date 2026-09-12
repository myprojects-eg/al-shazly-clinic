/* ===== Storage keys (Firestore doc names under 'clinicData') ===== */
const KEY_PATIENTS = 'clinic:patients'; // used only for old localStorage migration
const KEY_OLD_CASES = 'clinic:cases';   // used only for old localStorage migration

let patients = [];
let revenueEntries = [];
let expenses = [];
let currentUser = null;
let currentRole = null; // 'owner' | 'assistant'

/* ===== Shared helpers ===== */
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 1800);
}
function fmtMoney(n){
  return Number(n||0).toLocaleString('ar-EG') + ' جنيه';
}
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function formatDate(d){
  if(!d) return '';
  const parts = d.split('-');
  if(parts.length!==3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
function currentMonthStr(){
  const d = new Date();
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  return `${d.getFullYear()}-${m}`;
}

/* ===== Login / role guard ===== */
function requireAuth(){
  return new Promise((resolve)=>{
    auth.onAuthStateChanged(async (user)=>{
      if(!user){
        window.location.href = 'login.html';
        return;
      }
      currentUser = user;
      try{
        const doc = await db.collection('users').doc(user.uid).get();
        currentRole = doc.exists ? (doc.data().role || 'assistant') : 'assistant';
      }catch(e){ currentRole = 'assistant'; }
      resolve();
    });
  });
}

function logout(){
  auth.signOut().then(()=> window.location.href = 'login.html');
}
window.logout = logout;

function addLogoutButton(){
  if(document.getElementById('btn-logout')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-logout';
  btn.textContent = 'تسجيل خروج';
  btn.className = 'btn-ghost btn-sm';
  btn.style.position = 'fixed';
  btn.style.top = '14px';
  btn.style.left = '14px';
  btn.style.zIndex = '40';
  btn.onclick = logout;
  document.body.appendChild(btn);
}

function applyRoleUI(){
  addLogoutButton();
  // اخفاء كارت الإيرادات من الصفحة الرئيسية لو مش أونر
  const financeCard = document.getElementById('nav-card-finance');
  if(financeCard && currentRole !== 'owner'){
    financeCard.style.display = 'none';
  }
  // منع فتح صفحة الإيرادات مباشرة بالرابط لو مش أونر
  if(document.getElementById('rev-month') && currentRole !== 'owner'){
    window.location.href = 'index.html';
  }
}

/* ===== Data load / save (Firestore — shared across every device/account) =====
   with a one-time migration from the older localStorage-only version */
async function loadData(){
  try{
    const doc = await db.collection('clinicData').doc('patients').get();
    if(doc.exists){
      patients = doc.data().list || [];
    }else{
      patients = migratePatientsFromLocalStorage();
      if(patients.length) await savePatients();
    }
  }catch(e){ patients = []; }

  try{
    const doc = await db.collection('clinicData').doc('revenue').get();
    revenueEntries = doc.exists ? (doc.data().list || []) : [];
  }catch(e){ revenueEntries = []; }

  try{
    const doc = await db.collection('clinicData').doc('expenses').get();
    expenses = doc.exists ? (doc.data().list || []) : [];
  }catch(e){ expenses = []; }
}

function migratePatientsFromLocalStorage(){
  try{
    const raw = localStorage.getItem(KEY_PATIENTS);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  try{
    const raw = localStorage.getItem(KEY_OLD_CASES);
    const oldCases = raw ? JSON.parse(raw) : [];
    return oldCases.map(c => ({
      id: c.id || uid(),
      name: c.name || '',
      phone: c.phone || '',
      visits: [{
        id: uid(),
        date: c.date || '',
        treatment: c.treatment || '',
        cost: Number(c.cost || 0),
        next: c.next || '',
        notes: c.notes || ''
      }]
    }));
  }catch(e){ return []; }
}

async function savePatients(){
  try{ await db.collection('clinicData').doc('patients').set({ list: patients }); }
  catch(e){ showToast('حدث خطأ أثناء الحفظ'); }
}
async function saveRevenue(){
  try{ await db.collection('clinicData').doc('revenue').set({ list: revenueEntries }); }
  catch(e){ showToast('حدث خطأ أثناء الحفظ'); }
}
async function saveExpenses(){
  try{ await db.collection('clinicData').doc('expenses').set({ list: expenses }); }
  catch(e){ showToast('حدث خطأ أثناء الحفظ'); }
}

/* ===== Treatment select "other" toggle (shared by any page that has it) ===== */
function wireTreatmentOtherToggle(selectId, wrapId){
  const select = document.getElementById(selectId);
  if(!select) return;
  select.addEventListener('change', ()=>{
    const wrap = document.getElementById(wrapId);
    if(wrap) wrap.style.display = select.value === 'أخرى' ? 'block' : 'none';
  });
}
function treatmentValueFrom(selectId, otherId){
  const select = document.getElementById(selectId);
  if(!select) return '';
  if(select.value === 'أخرى'){
    const other = document.getElementById(otherId);
    return other ? other.value.trim() : '';
  }
  return select.value;
}

/* =========================================================
   TOOTH CHART — pick teeth on a jaw diagram and assign a
   treatment to each one (used from new-case.html and from
   the "add visit" form on search.html)
   ========================================================= */
const TREATMENT_OPTIONS = ['حشو عادي','حشو تجميلي','حشو أطفال','عصب','خلع','خلع أطفال','تنظيف جير','تقويم','تركيبات','زراعة','تبييض','أخرى'];

// خيارات العلاج حسب السن — 12 سنة أو أقل يبقى أطفال بس، أكبر يبقى كبار بس
const CHILD_TREATMENTS = ['حشو أطفال','خلع أطفال','تنظيف جير','أخرى'];
const ADULT_TREATMENTS = ['حشو عادي','حشو تجميلي','عصب','خلع','تنظيف جير','تقويم','تركيبات','زراعة','تبييض','أخرى'];

function getAgeForTarget(target){
  if(target === 'new-case'){
    const el = document.getElementById('f-age');
    return el ? el.value.trim() : '';
  }
  if(target && target.startsWith('visit-')){
    const pid = target.replace('visit-','');
    const patient = patients.find(p => p.id === pid);
    return patient ? (patient.age || '') : '';
  }
  return '';
}

function treatmentOptionsForAge(age){
  if(age === '' || age === null || age === undefined) return TREATMENT_OPTIONS;
  return Number(age) <= 12 ? CHILD_TREATMENTS : ADULT_TREATMENTS;
}

// أسعار مبدئية لكل نوع علاج — بتتحط تلقائي في خانة التكلفة، وتقدري تعدّليها يدوي براحتك
const TREATMENT_PRICES = {
  'كشف': 400,
  'حشو عادي': 2000,
  'حشو تجميلي': 2500,
  'حشو أطفال': 1200,
  'عصب': 3000,
  'خلع': 200,
  'خلع أطفال': 150,
  'تنظيف جير': 250,
  'تقويم': 3000,
  'تركيبات': 1500,
  'زراعة': 5000,
  'تبييض': 800
};

let toothChartTarget = null;   // 'new-case' or 'visit-<patientId>'
let toothSelections = {};      // { toothId: { label, treatment } }
let activeToothId = null;      // tooth currently being assigned a treatment
let activeToothLabel = '';

function jawToothSvg(id, label, x, y){
  const num = label.split(' ').pop();
  const tx = x - 13, ty = y - 17;
  const toothPath = 'M13,1 C19,1 23,3.5 23.5,9 C24,14 22.5,17.5 20,19.5 C19.6,19.8 19.5,20.2 19.5,20.6 L19.3,25.5 C19.1,30 17.3,33 15.2,33 C13.6,33 13,31 13,28.5 C13,31 12.4,33 10.8,33 C8.7,33 6.9,30 6.7,25.5 L6.5,20.6 C6.5,20.2 6.4,19.8 6,19.5 C3.5,17.5 2,14 2.5,9 C3,3.5 7,1 13,1 Z';
  const gumPath = 'M4,19.5 Q13,23 22,19.5';
  return `
    <g class="tooth-group" onclick="pickTooth('${id}','${label}')" transform="translate(${tx} ${ty})">
      <title>${label}</title>
      <path id="tb-${id}" class="tooth-rect" d="${toothPath}"></path>
      <path class="tooth-gumline" d="${gumPath}"></path>
      <text id="tt-${id}" class="tooth-text" x="13" y="14" text-anchor="middle">${num}</text>
    </g>`;
}

function buildJawSVG(){
  const W = 480, H = 340, cx = 240;
  const cyU = 150, ryU = 100, rxU = 200;
  const cyL = 175, ryL = 100, rxL = 200;
  const startDeg = 14, endDeg = 166, steps = 16;
  let upper = '', lower = '';

  for(let i=0; i<steps; i++){
    const t = startDeg + (endDeg - startDeg) * (i/(steps-1));
    const rad = t * Math.PI/180;
    const x = cx + rxU*Math.cos(rad);
    const yU = cyU - ryU*Math.sin(rad);
    const yL = cyL + ryL*Math.sin(rad);
    const side = i < 8 ? 'يمين' : 'شمال';
    const num = i < 8 ? (8-i) : (i-7);
    const sideCode = i < 8 ? 'R' : 'L';
    upper += jawToothSvg('U'+sideCode+num, 'فوق '+side+' '+num, x, yU);
    lower += jawToothSvg('L'+sideCode+num, 'تحت '+side+' '+num, x, yL);
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="jaw-svg" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="toothGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="55%" stop-color="#f6f3ec"/>
          <stop offset="100%" stop-color="#e6e0d2"/>
        </linearGradient>
        <linearGradient id="toothGradSelected" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#cc6b5b"/>
          <stop offset="100%" stop-color="#8f3c2f"/>
        </linearGradient>
        <filter id="toothShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1" flood-color="#1c2b26" flood-opacity="0.28"/>
        </filter>
      </defs>
      <text x="${cx}" y="18" text-anchor="middle" class="jaw-caption">الفك العلوي</text>
      <text x="${W-26}" y="${H/2}" text-anchor="middle" class="jaw-side-label">يمين</text>
      <text x="26" y="${H/2}" text-anchor="middle" class="jaw-side-label">شمال</text>
      ${upper}
      ${lower}
      <text x="${cx}" y="${H-6}" text-anchor="middle" class="jaw-caption">الفك السفلي</text>
    </svg>`;
}

function openToothChart(target){
  toothChartTarget = target;
  activeToothId = null;

  // preload existing selections if this target already has some
  toothSelections = {};
  const jsonField = document.getElementById(target === 'new-case' ? 'f-teeth-json' : `nv-teeth-json-${target.replace('visit-','')}`);
  if(jsonField && jsonField.value){
    try{
      const arr = JSON.parse(jsonField.value);
      arr.forEach(item => { toothSelections[item.tooth] = { label: item.label, treatment: item.treatment }; });
    }catch(e){}
  }

  const ageForTarget = getAgeForTarget(target);
  const treatmentOptionsList = treatmentOptionsForAge(ageForTarget);

  const overlay = document.createElement('div');
  overlay.className = 'tooth-modal-overlay';
  overlay.id = 'tooth-modal-overlay';
  overlay.innerHTML = `
    <div class="tooth-modal">
      <div class="tooth-modal-head">
        <h2 class="section-title" style="margin:0;">حددي السن ونوع العلاج</h2>
        <button class="btn-danger-text" onclick="closeToothChart(false)">إغلاق</button>
      </div>
      <div class="jaw-chart">${buildJawSVG()}</div>
      <div class="tooth-picker" id="tooth-picker" style="display:none;">
        <div class="tooth-picker-label" id="tooth-picker-label"></div>
        <div class="form-grid" style="margin-bottom:8px;">
          <div class="full">
            <select id="tooth-picker-treatment" onchange="toggleToothPickerOther()">
              <option value="">اختر نوع العلاج</option>
              ${treatmentOptionsList.map(t => `<option value="${t}">${t === 'أخرى' ? 'أخرى (اكتب بنفسك)' : t}</option>`).join('')}
            </select>
          </div>
          <div class="full" id="tooth-picker-other-wrap" style="display:none;">
            <input type="text" id="tooth-picker-other" placeholder="اكتب نوع العلاج هنا">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="confirmToothTreatment()">تأكيد للسن ده</button>
      </div>
      <div class="tooth-selected-list" id="tooth-selected-list"></div>
      <button class="btn btn-primary" id="btn-tooth-chart-save" onclick="closeToothChart(true)">حفظ وإغلاق</button>
    </div>
  `;
  document.body.appendChild(overlay);
  renderToothSelectedList();
  markSelectedBoxes();
}

function setToothVisual(toothId, selected){
  const rect = document.getElementById('tb-' + toothId);
  const text = document.getElementById('tt-' + toothId);
  if(rect) rect.classList.toggle('selected', selected);
  if(text) text.classList.toggle('selected', selected);
}

function markSelectedBoxes(){
  Object.keys(toothSelections).forEach(id => setToothVisual(id, true));
}

window.pickTooth = function(toothId, label){
  activeToothId = toothId;
  activeToothLabel = label;
  document.getElementById('tooth-picker').style.display = 'block';
  document.getElementById('tooth-picker-label').textContent = 'السن المحددة: ' + label;
  const existing = toothSelections[toothId];
  const select = document.getElementById('tooth-picker-treatment');
  select.value = existing ? existing.treatment : '';
  const otherWrap = document.getElementById('tooth-picker-other-wrap');
  const otherInput = document.getElementById('tooth-picker-other');
  if(existing && !TREATMENT_OPTIONS.includes(existing.treatment)){
    select.value = 'أخرى';
    otherWrap.style.display = 'block';
    otherInput.value = existing.treatment;
  }else{
    otherWrap.style.display = 'none';
    otherInput.value = '';
  }
};

window.toggleToothPickerOther = function(){
  const select = document.getElementById('tooth-picker-treatment');
  document.getElementById('tooth-picker-other-wrap').style.display = select.value === 'أخرى' ? 'block' : 'none';
};

window.confirmToothTreatment = function(){
  if(!activeToothId) return;
  const select = document.getElementById('tooth-picker-treatment');
  let treatment = select.value;
  if(treatment === 'أخرى'){
    treatment = document.getElementById('tooth-picker-other').value.trim();
  }
  if(!treatment){ showToast('اختاري نوع العلاج للسن الأول'); return; }

  toothSelections[activeToothId] = { label: activeToothLabel, treatment };
  setToothVisual(activeToothId, true);
  document.getElementById('tooth-picker').style.display = 'none';
  renderToothSelectedList();
  updateSuggestedCost();
};

window.removeToothSelection = function(toothId){
  delete toothSelections[toothId];
  setToothVisual(toothId, false);
  renderToothSelectedList();
  updateSuggestedCost();
};

function updateSuggestedCost(){
  const total = Object.values(toothSelections).reduce(
    (sum, item) => sum + (TREATMENT_PRICES[item.treatment] || 0), 0
  );
  if(total <= 0) return; // مفيش سعر مبدئي لأي من العلاجات المختارة (مثلاً "أخرى")، سيبي الخانة زي ما هي

  let costField;
  if(toothChartTarget === 'new-case'){
    costField = document.getElementById('f-cost');
  }else if(toothChartTarget && toothChartTarget.startsWith('visit-')){
    const pid = toothChartTarget.replace('visit-','');
    costField = document.getElementById('nv-cost-'+pid);
  }
  if(costField) costField.value = total;
}

function renderToothSelectedList(){
  const list = document.getElementById('tooth-selected-list');
  if(!list) return;
  const entries = Object.keys(toothSelections);
  if(entries.length === 0){
    list.innerHTML = `<div style="font-size:0.8rem; color:var(--ink-soft);">لسه محددتيش أي سن.</div>`;
    return;
  }
  list.innerHTML = entries.map(id => {
    const item = toothSelections[id];
    return `
      <div class="tooth-selected-item">
        <span>${escapeHtml(item.label)} — ${escapeHtml(item.treatment)}</span>
        <button class="btn-danger-text" onclick="removeToothSelection('${id}')">حذف</button>
      </div>
    `;
  }).join('');
}

/* ===== دمج "كشف" (تيك بوكس مستقل) مع اختيارات رسم الأسنان ===== */
function getTeethForTarget(target){
  const fieldId = target === 'new-case' ? 'f-teeth-json' : `nv-teeth-json-${target.replace('visit-','')}`;
  const el = document.getElementById(fieldId);
  if(!el || !el.value) return [];
  try{ return JSON.parse(el.value); }catch(e){ return []; }
}

function isCheckupChecked(target){
  const id = target === 'new-case' ? 'f-checkup' : `nv-checkup-${target.replace('visit-','')}`;
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

window.recomputeCostAndDisplay = function(target){
  const teeth = getTeethForTarget(target);
  const checkup = isCheckupChecked(target);

  let total = teeth.reduce((s,t)=> s + (TREATMENT_PRICES[t.treatment]||0), 0);
  if(checkup) total += (TREATMENT_PRICES['كشف'] || 0);

  const costFieldId = target === 'new-case' ? 'f-cost' : `nv-cost-${target.replace('visit-','')}`;
  const costField = document.getElementById(costFieldId);
  if(costField && total > 0) costField.value = total;

  const displayFieldId = target === 'new-case' ? 'f-treatment-display' : `nv-treatment-display-${target.replace('visit-','')}`;
  const displayField = document.getElementById(displayFieldId);
  if(displayField){
    const teethSummary = teeth.map(t => `${t.label} — ${t.treatment}`).join('، ');
    const parts = [];
    if(checkup) parts.push('كشف');
    if(teethSummary) parts.push(teethSummary);
    displayField.value = parts.join(' + ');
  }
};

window.closeToothChart = function(save){
  const overlay = document.getElementById('tooth-modal-overlay');
  if(save){
    const entries = Object.keys(toothSelections).map(id => ({
      tooth: id, label: toothSelections[id].label, treatment: toothSelections[id].treatment
    }));
    const jsonStr = JSON.stringify(entries);
    const jsonFieldId = toothChartTarget === 'new-case' ? 'f-teeth-json' : `nv-teeth-json-${(toothChartTarget||'').replace('visit-','')}`;
    const jsonField = document.getElementById(jsonFieldId);
    if(jsonField) jsonField.value = jsonStr;
    recomputeCostAndDisplay(toothChartTarget);
  }
  if(overlay) overlay.remove();
  toothChartTarget = null;
  activeToothId = null;
};

/* =========================================================
   PAGE: new-case.html
   ========================================================= */
function initNewCasePage(){
  const btn = document.getElementById('btn-save-case');
  if(!btn) return;

  btn.addEventListener('click', async ()=>{
    const name = document.getElementById('f-name').value.trim();
    if(!name){ showToast('اكتب اسم المريض أولاً'); return; }

    let teeth = [];
    const teethJsonField = document.getElementById('f-teeth-json');
    if(teethJsonField && teethJsonField.value){
      try{ teeth = JSON.parse(teethJsonField.value); }catch(e){ teeth = []; }
    }
    const treatmentText = document.getElementById('f-treatment-display').value.trim();

    const newPatient = {
      id: uid(),
      name,
      phone: document.getElementById('f-phone').value.trim(),
      age: document.getElementById('f-age').value.trim(),
      visits: [{
        id: uid(),
        date: document.getElementById('f-date').value,
        treatment: treatmentText,
        teeth,
        cost: Number(document.getElementById('f-cost').value || 0),
        next: document.getElementById('f-next').value,
        notes: document.getElementById('f-notes').value.trim()
      }]
    };
    patients.push(newPatient);
    await savePatients();

    ['f-name','f-phone','f-age','f-date','f-treatment-display','f-cost','f-next','f-notes','f-teeth-json'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.value = '';
    });
    const checkupBox = document.getElementById('f-checkup');
    if(checkupBox) checkupBox.checked = false;

    showToast('تم حفظ الحالة');
  });
}

/* =========================================================
   PAGE: search.html
   ========================================================= */
function initSearchPage(){
  const list = document.getElementById('case-list');
  if(!list) return;

  const searchInput = document.getElementById('f-search');
  const dateFrom = document.getElementById('f-date-from');
  const dateTo = document.getElementById('f-date-to');
  const clearBtn = document.getElementById('btn-clear-date-filter');

  function refresh(){ renderPatientList(searchInput.value); }

  searchInput.addEventListener('input', refresh);
  if(dateFrom) dateFrom.addEventListener('change', refresh);
  if(dateTo) dateTo.addEventListener('change', refresh);
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    if(dateFrom) dateFrom.value = '';
    if(dateTo) dateTo.value = '';
    refresh();
  });

  renderPatientList('');
}

function renderPatientList(filter=''){
  const list = document.getElementById('case-list');
  const q = filter.trim().toLowerCase();
  const dateFromEl = document.getElementById('f-date-from');
  const dateToEl = document.getElementById('f-date-to');
  const dateFrom = dateFromEl ? dateFromEl.value : '';
  const dateTo = dateToEl ? dateToEl.value : '';

  let filtered = patients;
  if(q){
    filtered = filtered.filter(p =>
      (p.name||'').toLowerCase().includes(q) ||
      (p.phone||'').toLowerCase().includes(q)
    );
  }
  if(dateFrom || dateTo){
    filtered = filtered.filter(p =>
      (p.visits||[]).some(v =>
        v.date && (!dateFrom || v.date >= dateFrom) && (!dateTo || v.date <= dateTo)
      )
    );
  }
  filtered = [...filtered].sort((a,b)=>{
    const la = lastVisitDate(a), lb = lastVisitDate(b);
    return (lb||'').localeCompare(la||'');
  });

  document.getElementById('case-count').textContent =
    filtered.length ? `عدد الحالات: ${filtered.length}` : '';

  if(filtered.length === 0){
    const hasFilter = q || dateFrom || dateTo;
    list.innerHTML = `<div class="empty-state">${patients.length===0 ? 'لا توجد حالات مسجلة بعد.' : (hasFilter ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد حالات.')}</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    const visits = [...p.visits].sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    const last = visits[0];
    const totalCost = p.visits.reduce((s,v)=> s + Number(v.cost||0), 0);
    return `
      <div class="case-card" data-id="${p.id}">
        <div class="case-card-head" onclick="toggleDetail('${p.id}')">
          <div class="case-main">
            <div class="case-name">${escapeHtml(p.name)}</div>
            <div class="case-meta">
              ${p.phone ? '📞 ' + escapeHtml(p.phone) : ''}
              ${p.age ? ' • العمر: ' + escapeHtml(p.age) : ''}
              <br><span class="case-count-tag">${p.visits.length} زيارة</span>
              ${last && last.date ? ' • آخر زيارة: ' + formatDate(last.date) : ''}
            </div>
          </div>
          <div class="case-side">
            <div class="case-cost">${fmtMoney(totalCost)}</div>
            <button class="btn-danger-text" onclick="event.stopPropagation(); deletePatient('${p.id}')">حذف المريض</button>
          </div>
        </div>
        <div class="case-detail" id="detail-${p.id}">
          ${visits.map(v => `
            <div class="visit-item">
              <div class="visit-info">
                <span class="t">${v.treatment ? escapeHtml(v.treatment) : 'بدون نوع علاج'}</span>
                ${v.date ? ' — ' + formatDate(v.date) : ''}
                ${v.next ? '<br>الزيارة القادمة: ' + formatDate(v.next) : ''}
                ${v.notes ? '<br>' + escapeHtml(v.notes) : ''}
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <div class="visit-cost">${fmtMoney(v.cost)}</div>
                <button class="btn-danger-text" onclick="deleteVisit('${p.id}','${v.id}')">حذف الزيارة</button>
              </div>
            </div>
          `).join('')}

          <div class="add-visit-form">
            <h2 class="section-title" style="font-size:0.92rem;">إضافة كشف / زيارة جديدة</h2>

            <input type="hidden" id="nv-teeth-json-${p.id}" value="">

            <div class="form-grid">
              <div>
                <label>تاريخ الزيارة</label>
                <input type="date" id="nv-date-${p.id}">
              </div>
              <div class="full" style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                <input type="checkbox" id="nv-checkup-${p.id}" style="width:18px; height:18px;" onchange="recomputeCostAndDisplay('visit-${p.id}')">
                <label for="nv-checkup-${p.id}" style="margin:0; cursor:pointer;">دي زيارة كشف</label>
              </div>
              <div>
                <label>نوع العلاج (اختياري)</label>
                <input type="text" id="nv-treatment-display-${p.id}" readonly placeholder="🦷 دوسي هنا لتحديد السن ونوع العلاج" style="cursor:pointer;" onclick="openToothChart('visit-${p.id}')">
              </div>
              <div>
                <label>التكلفة (جنيه)</label>
                <input type="number" min="0" id="nv-cost-${p.id}" placeholder="0">
              </div>
              <div>
                <label>الزيارة القادمة (اختياري)</label>
                <input type="date" id="nv-next-${p.id}">
              </div>
              <div class="full">
                <label>ملاحظات</label>
                <textarea id="nv-notes-${p.id}" placeholder="تفاصيل الكشف أو الشغل الإضافي..."></textarea>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="addVisit('${p.id}')">حفظ الزيارة</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function lastVisitDate(p){
  const dates = (p.visits||[]).map(v=>v.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length-1] : '';
}

window.toggleDetail = function(id){
  const el = document.getElementById('detail-'+id);
  if(el) el.classList.toggle('open');
};

window.addVisit = async function(id){
  const patient = patients.find(p => p.id === id);
  if(!patient) return;

  let teeth = [];
  const teethJsonField = document.getElementById('nv-teeth-json-'+id);
  if(teethJsonField && teethJsonField.value){
    try{ teeth = JSON.parse(teethJsonField.value); }catch(e){ teeth = []; }
  }
  const treatmentText = document.getElementById('nv-treatment-display-'+id).value.trim();

  const newVisit = {
    id: uid(),
    date: document.getElementById('nv-date-'+id).value,
    treatment: treatmentText,
    teeth,
    cost: Number(document.getElementById('nv-cost-'+id).value || 0),
    next: document.getElementById('nv-next-'+id).value,
    notes: document.getElementById('nv-notes-'+id).value.trim()
  };
  patient.visits.push(newVisit);
  await savePatients();
  renderPatientList(document.getElementById('f-search').value);
  const detail = document.getElementById('detail-'+id);
  if(detail) detail.classList.add('open');
  showToast('تم حفظ الزيارة');
};

window.deleteVisit = async function(patientId, visitId){
  const patient = patients.find(p => p.id === patientId);
  if(!patient) return;
  patient.visits = patient.visits.filter(v => v.id !== visitId);
  await savePatients();
  renderPatientList(document.getElementById('f-search').value);
  showToast('تم حذف الزيارة');
};

window.deletePatient = async function(id){
  patients = patients.filter(p => p.id !== id);
  await savePatients();
  renderPatientList(document.getElementById('f-search').value);
  showToast('تم حذف المريض');
};

/* =========================================================
   PAGE: finance.html
   ========================================================= */
function initFinancePage(){
  const monthInput = document.getElementById('rev-month');
  if(!monthInput) return;

  monthInput.value = currentMonthStr();
  monthInput.addEventListener('change', renderFinance);

  document.getElementById('btn-add-revenue').addEventListener('click', async ()=>{
    const amount = Number(document.getElementById('rev-amount').value || 0);
    if(!amount){ showToast('اكتب مبلغ صحيح'); return; }
    revenueEntries.push({
      id: uid(),
      month: monthInput.value || currentMonthStr(),
      amount,
      note: document.getElementById('rev-note').value.trim()
    });
    await saveRevenue();
    document.getElementById('rev-amount').value = '';
    document.getElementById('rev-note').value = '';
    renderFinance();
    showToast('تم إضافة الإيراد');
  });

  document.getElementById('btn-add-expense').addEventListener('click', async ()=>{
    const amount = Number(document.getElementById('exp-amount').value || 0);
    if(!amount){ showToast('اكتب مبلغ صحيح'); return; }
    expenses.push({
      id: uid(),
      month: monthInput.value || currentMonthStr(),
      amount,
      note: document.getElementById('exp-note').value.trim()
    });
    await saveExpenses();
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-note').value = '';
    renderFinance();
    showToast('تم إضافة المصروف');
  });

  renderFinance();
}

function renderFinance(){
  const monthInput = document.getElementById('rev-month');
  const month = monthInput.value || currentMonthStr();

  const monthVisits = [];
  patients.forEach(p=>{
    (p.visits||[]).forEach(v=>{
      if((v.date||'').startsWith(month)){
        monthVisits.push({ patientName: p.name, ...v });
      }
    });
  });
  const visitsTotal = monthVisits.reduce((s,v)=> s + Number(v.cost||0), 0);

  const monthManual = revenueEntries.filter(r => r.month === month);
  const manualTotal = monthManual.reduce((s,r)=> s + Number(r.amount||0), 0);

  const monthExpenses = expenses.filter(e => e.month === month);
  const expensesTotal = monthExpenses.reduce((s,e)=> s + Number(e.amount||0), 0);

  const revenueTotal = visitsTotal + manualTotal;
  const net = revenueTotal - expensesTotal;

  document.getElementById('stat-revenue').textContent = fmtMoney(revenueTotal);
  document.getElementById('stat-expenses').textContent = fmtMoney(expensesTotal);
  document.getElementById('stat-net').textContent = fmtMoney(net);

  const revRows = [
    ...monthVisits.map(v => ({
      date: v.date, desc: `${v.patientName}${v.treatment ? ' — ' + v.treatment : ''}`, amount: v.cost, type: 'case', id: v.id
    })),
    ...monthManual.map(r => ({
      date: null, desc: r.note || 'إيراد يدوي', amount: r.amount, type: 'manual', id: r.id
    }))
  ].sort((a,b)=> (b.date||'').localeCompare(a.date||''));

  const revWrap = document.getElementById('rev-table-wrap');
  if(revRows.length === 0){
    revWrap.innerHTML = `<div class="empty-state">لا توجد إيرادات مسجلة لهذا الشهر.</div>`;
  }else{
    revWrap.innerHTML = `
      <table class="rev-table">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>المصدر</th><th>المبلغ</th><th></th></tr></thead>
        <tbody>
          ${revRows.map(r => `
            <tr>
              <td>${r.date ? formatDate(r.date) : '—'}</td>
              <td>${escapeHtml(r.desc)}</td>
              <td>${r.type==='case' ? '<span class="tag">حالة مريض</span>' : '<span class="tag manual">يدوي</span>'}</td>
              <td>${fmtMoney(r.amount)}</td>
              <td>${r.type==='manual' ? `<button class="btn-danger-text" onclick="deleteRevenue('${r.id}')">حذف</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  const expWrap = document.getElementById('exp-table-wrap');
  if(monthExpenses.length === 0){
    expWrap.innerHTML = `<div class="empty-state">لا توجد مصروفات مسجلة لهذا الشهر.</div>`;
  }else{
    expWrap.innerHTML = `
      <table class="rev-table">
        <thead><tr><th>البيان</th><th></th><th>المبلغ</th><th></th></tr></thead>
        <tbody>
          ${monthExpenses.map(e => `
            <tr>
              <td>${escapeHtml(e.note || 'مصروف')}</td>
              <td><span class="tag expense">مصروف</span></td>
              <td>${fmtMoney(e.amount)}</td>
              <td><button class="btn-danger-text" onclick="deleteExpense('${e.id}')">حذف</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

window.deleteRevenue = async function(id){
  revenueEntries = revenueEntries.filter(r => r.id !== id);
  await saveRevenue();
  renderFinance();
  showToast('تم حذف الإيراد');
};

window.deleteExpense = async function(id){
  expenses = expenses.filter(e => e.id !== id);
  await saveExpenses();
  renderFinance();
  showToast('تم حذف المصروف');
};

/* =========================================================
   PAGE: appointments.html — upcoming visits as tickets,
   visible to both owner and assistant
   ========================================================= */
function initAppointmentsPage(){
  const list = document.getElementById('appt-list');
  if(!list) return;
  renderAppointments();
}

function renderAppointments(){
  const list = document.getElementById('appt-list');
  const todayStr = new Date().toISOString().slice(0,10);

  let appts = [];
  patients.forEach(p=>{
    (p.visits||[]).forEach(v=>{
      if(v.next){
        appts.push({
          patientName: p.name,
          phone: p.phone,
          date: v.next,
          lastTreatment: v.treatment
        });
      }
    });
  });
  appts.sort((a,b)=> (a.date||'').localeCompare(b.date||''));

  document.getElementById('appt-count').textContent =
    appts.length ? `عدد المواعيد القادمة: ${appts.length}` : '';

  if(appts.length === 0){
    list.innerHTML = `<div class="empty-state">مفيش أي مواعيد زيارة قادمة متسجلة حاليًا.</div>`;
    return;
  }

  list.innerHTML = appts.map(a => {
    const isOverdue = a.date < todayStr;
    const isToday = a.date === todayStr;
    let statusTag = '';
    if(isOverdue) statusTag = '<span class="tag expense">متأخر</span>';
    else if(isToday) statusTag = '<span class="tag manual">النهاردة</span>';
    else statusTag = '<span class="tag">قادم</span>';

    return `
      <div class="appt-ticket ${isOverdue ? 'overdue' : ''}">
        <div class="appt-main">
          <div class="appt-name">${escapeHtml(a.patientName)}</div>
          <div class="appt-meta">
            ${a.phone ? '📞 ' + escapeHtml(a.phone) : ''}
            ${a.lastTreatment ? '<br>آخر علاج: ' + escapeHtml(a.lastTreatment) : ''}
          </div>
        </div>
        <div class="appt-side">
          <div class="appt-date">${formatDate(a.date)}</div>
          ${statusTag}
        </div>
      </div>
    `;
  }).join('');
}

/* =========================================================
   Reminder banner — shows on any page if a patient's next
   visit is today or tomorrow
   ========================================================= */
function checkAppointmentReminders(){
  if(!document.querySelector('.hero')) return; // الصفحة الرئيسية بس

  const todayStr = new Date().toISOString().slice(0,10);
  const tmrDate = new Date();
  tmrDate.setDate(tmrDate.getDate() + 1);
  const tomorrowStr = tmrDate.toISOString().slice(0,10);

  let todayList = [], tomorrowList = [];
  patients.forEach(p=>{
    (p.visits||[]).forEach(v=>{
      if(v.next === todayStr) todayList.push(p.name);
      else if(v.next === tomorrowStr) tomorrowList.push(p.name);
    });
  });

  if(todayList.length === 0 && tomorrowList.length === 0) return;
  showReminderBanner(todayList, tomorrowList);
}

function showReminderBanner(todayList, tomorrowList){
  if(document.getElementById('reminder-banner')) return;
  const wrap = document.querySelector('.wrap');
  if(!wrap) return;

  let parts = [];
  if(todayList.length) parts.push(`📅 النهاردة: ${todayList.join('، ')}`);
  if(tomorrowList.length) parts.push(`🔔 بكرة: ${tomorrowList.join('، ')}`);

  const banner = document.createElement('div');
  banner.id = 'reminder-banner';
  banner.className = 'reminder-banner';
  banner.innerHTML = `
    <span>${parts.join(' — ')}</span>
    <button onclick="document.getElementById('reminder-banner').remove()">✕</button>
  `;
  wrap.prepend(banner);
}

/* ===== Boot ===== */
(async function(){
  await requireAuth();
  applyRoleUI();
  await loadData();
  initNewCasePage();
  initSearchPage();
  initFinancePage();
  initAppointmentsPage();
  checkAppointmentReminders();
})();