import { getApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const auth=getAuth(getApp());
const db=getFirestore(getApp());
const previousGo=window.go;

function esc(v=''){
  return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function toDate(v){
  try{
    if(v?.toDate) return v.toDate();
    if(v instanceof Date) return v;
    if(typeof v==='string' || typeof v==='number') return new Date(v);
  }catch(e){}
  return null;
}
function sameLocalDay(a,b){
  return a && b &&
    a.getFullYear()===b.getFullYear() &&
    a.getMonth()===b.getMonth() &&
    a.getDate()===b.getDate();
}
function fmtDateTime(d){
  if(!d) return 'Data não registrada';
  return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(d);
}
function statusLabel(s){
  return ({available:'Disponível',borrowed:'Emprestado',reserved:'Reservado',damaged:'Em análise'})[s] || (s || 'Disponível');
}
async function loadCopies(){
  const snap=await getDocs(collection(db,'copies'));
  return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ad=toDate(a.createdAt)?.getTime() || 0;
    const bd=toDate(b.createdAt)?.getTime() || 0;
    return bd-ad || String(b.code||b.id).localeCompare(String(a.code||a.id));
  });
}
function patchVolunteerButton(){
  document.querySelectorAll('.vol-action').forEach(btn=>{
    const strong=btn.querySelector('strong');
    if(strong?.textContent.includes('Livros cadastrados hoje')){
      strong.textContent='📚 Livros cadastrados';
      const span=btn.querySelector('span');
      if(span) span.textContent='Veja o acervo salvo no banco de dados.';
    }
  });
}

async function renderStaffBooks(){
  const section=document.getElementById('today-books');
  if(!section || !auth.currentUser) return;
  section.innerHTML=`
    <button class="back" onclick="go('volunteer-home')">← Voltar</button>
    <h2 class="title">Livros cadastrados</h2>
    <div id="staff-books-content"><div class="panel">Carregando o acervo…</div></div>`;
  const content=document.getElementById('staff-books-content');
  try{
    const copies=await loadCopies();
    const today=new Date();
    const todayCount=copies.filter(c=>sameLocalDay(toDate(c.createdAt),today)).length;
    const uniqueTitles=new Set(copies.map(c=>c.isbn || (String(c.title||'')+'|'+String(c.author||'')))).size;
    const summary=`<div class="panel">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
        <div><b style="font-size:24px">${copies.length}</b><small style="display:block;color:#777">exemplares</small></div>
        <div><b style="font-size:24px">${uniqueTitles}</b><small style="display:block;color:#777">títulos</small></div>
        <div><b style="font-size:24px">${todayCount}</b><small style="display:block;color:#777">hoje</small></div>
      </div>
    </div>`;
    if(!copies.length){
      content.innerHTML=summary+'<div class="panel">Nenhum exemplar foi encontrado no Firestore.</div>';
      return;
    }
    content.innerHTML=summary+'<div class="list">'+copies.map(c=>{
      const created=toDate(c.createdAt);
      return `<div class="item">
        <div style="min-width:0">
          <b>${esc(c.code||c.id)}</b>
          <small>${esc(c.title||'Livro sem título')}</small>
          <small>${esc(c.author||'Autor não informado')}</small>
          <small>${c.shelf ? '📍 '+esc(c.shelf)+' · ' : ''}${esc(statusLabel(c.status))}</small>
          <small>${esc(fmtDateTime(created))}</small>
        </div>
        <span class="tag">${esc(c.authorCode||'')}</span>
      </div>`;
    }).join('')+'</div>';
  }catch(error){
    console.error('Erro ao carregar exemplares',error);
    content.innerHTML='<div class="auth-status show error">Não foi possível carregar os livros do banco de dados agora.</div>';
  }
}

async function renderStaffLabels(){
  const section=document.getElementById('labels');
  if(!section || !auth.currentUser) return;
  section.innerHTML=`
    <button class="back" onclick="go('volunteer-home')">← Voltar</button>
    <h2 class="title">Etiquetas para imprimir</h2>
    <div class="panel"><p class="mini">Estas etiquetas são recriadas a partir dos exemplares salvos no Firestore. Assim elas aparecem em qualquer aparelho autorizado.</p></div>
    <div id="labels-list"><div class="panel">Carregando etiquetas…</div></div>`;
  const list=document.getElementById('labels-list');
  try{
    const copies=await loadCopies();
    if(!copies.length){
      list.innerHTML='<div class="panel">Nenhum exemplar cadastrado.</div>';
      return;
    }
    list.innerHTML=copies.map(c=>`<div class="panel">
      <div style="margin-bottom:8px"><b>${esc(c.title||'Livro')}</b><div class="mini">${esc(c.author||'')}</div></div>
      <div class="label-preview">
        <b>BIBLIOTECA AMAVALE</b><br><br>
        <b style="font-size:20px">${esc(c.code||c.id)}</b><br>
        ${esc(c.shelf||'')} ${c.authorCode ? '· '+esc(c.authorCode) : ''}
      </div>
    </div>`).join('');
  }catch(error){
    console.error('Erro ao carregar etiquetas',error);
    list.innerHTML='<div class="auth-status show error">Não foi possível carregar as etiquetas do banco de dados agora.</div>';
  }
}

window.go=function(id){
  previousGo(id);
  if(id==='volunteer-home') setTimeout(patchVolunteerButton,20);
  if(id==='today-books') setTimeout(renderStaffBooks,30);
  if(id==='labels') setTimeout(renderStaffLabels,30);
};

patchVolunteerButton();

onAuthStateChanged(auth,user=>{
  if(!user) return;
  const active=document.querySelector('.screen.active')?.id;
  if(active==='today-books') renderStaffBooks();
  if(active==='labels') renderStaffLabels();
});
