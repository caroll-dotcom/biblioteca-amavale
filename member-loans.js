import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCpsABmAOMlUxEKFAFTk2IgzpYyOZfh5sw',
  authDomain: 'biblioteca-amavale.firebaseapp.com',
  projectId: 'biblioteca-amavale',
  storageBucket: 'biblioteca-amavale.firebasestorage.app',
  messagingSenderId: '415376174106',
  appId: '1:415376174106:web:a62cfd75d111b866eeb5a3'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let memberScannerControls = null;
let memberScanning = false;
let activeMode = null;
let selectedCopy = null;
let directCopyHandled = false;
const originalMemberGo = window.go;

const memberStyle = document.createElement('style');
memberStyle.textContent = `
.member-camera-wrap{position:relative;overflow:hidden;border-radius:18px;background:#111;margin-bottom:10px}
.member-camera{width:100%;aspect-ratio:3/4;max-height:430px;background:#111;border-radius:18px;object-fit:cover;display:block}
.member-guide{position:absolute;left:19%;right:19%;top:28%;aspect-ratio:1;border:3px solid #a9c65a;border-radius:18px;pointer-events:none;box-shadow:0 0 0 999px rgba(0,0,0,.15)}
.member-guide:after{content:'Centralize o QR do exemplar';position:absolute;left:-20%;right:-20%;bottom:-34px;text-align:center;color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 3px #000}
.member-book{display:grid;grid-template-columns:64px minmax(0,1fr);gap:13px;align-items:start}
.member-cover{width:64px;height:94px;border-radius:8px;object-fit:cover;background:#efede7;border:1px solid #ddd}
.member-cover-placeholder{width:64px;height:94px;border-radius:8px;background:#efede7;display:grid;place-items:center;text-align:center;padding:6px;font-size:9px;color:#666}
.member-book h3{margin:0 0 4px;font-size:18px;line-height:1.2}.member-book p{margin:3px 0;color:#777;font-size:12px;line-height:1.4}
.copy-code{display:inline-block;margin-top:7px;padding:7px 9px;border-radius:10px;background:#f1f0eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:800}
.member-status{margin-top:10px;padding:11px;border-radius:12px;font-size:12px;line-height:1.45}.member-status.ok{background:#eef3df;color:#425020}.member-status.error{background:#f8e8e4;color:#7a3025}.member-status.info{background:#f4f0e7;color:#555}
.member-manual{margin-top:10px}.member-manual summary{cursor:pointer;font-size:12px;color:#666;font-weight:700}.member-manual .field{margin-top:9px}
.due-big{font-size:20px;font-weight:900;margin-top:4px}
`;
document.head.appendChild(memberStyle);

function el(id){ return document.getElementById(id); }
function esc(value=''){
  return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function fmtDate(date){ return new Intl.DateTimeFormat('pt-BR').format(date); }
function normalizeCopyCode(value=''){
  const raw=String(value||'').trim();
  const direct=raw.match(/AMA-\d{5,}/i);
  if(direct) return direct[0].toUpperCase();
  try{
    const url=new URL(raw,location.href);
    const fromQuery=url.searchParams.get('copy');
    if(fromQuery && /^AMA-\d{5,}$/i.test(fromQuery)) return fromQuery.toUpperCase();
  }catch(e){}
  return '';
}
function memberError(error){
  const code=error?.code || error?.message || '';
  if(String(code).includes('permission-denied')) return 'O acesso foi bloqueado pelas regras do banco. As regras de empréstimo para membros ainda precisam estar publicadas no Firebase.';
  if(String(code).includes('COPY_NOT_FOUND')) return 'Este QR não corresponde a um exemplar cadastrado no acervo.';
  if(String(code).includes('NOT_AVAILABLE')) return 'Este exemplar não está disponível para empréstimo.';
  if(String(code).includes('NOT_BORROWED')) return 'Este exemplar não está marcado como emprestado.';
  if(String(code).includes('NOT_YOURS')) return 'Este exemplar está emprestado para outro usuário.';
  if(String(code).includes('LOAN_NOT_FOUND')) return 'Não encontramos o empréstimo ativo deste exemplar.';
  if(String(code).includes('OVERDUE_BLOCK')) return 'Você tem um empréstimo em atraso. Novos empréstimos ficam bloqueados até a devolução.';
  if(String(code).includes('LIMIT_REACHED')) return 'Você já está com o limite de 2 livros emprestados. Devolva um deles antes de retirar outro.';
  return 'Não foi possível concluir agora. Tente novamente.';
}
function setMemberStatus(mode,text,type='info'){
  const box=el(`${mode}-member-status`);
  if(!box) return;
  box.className=`member-status ${type}`;
  box.textContent=text;
}

function dueDateOf(loan){
  return loan?.dueAt?.toDate?.() || null;
}
function isLoanOverdue(loan){
  const due=dueDateOf(loan);
  if(!due) return false;
  const endOfDueDay=new Date(due);
  endOfDueDay.setHours(23,59,59,999);
  return Date.now()>endOfDueDay.getTime();
}
async function getMemberBorrowingState(){
  if(!auth.currentUser) return {active:[],overdue:[]};
  const snap=await getDocs(query(collection(db,'loans'),where('memberId','==',auth.currentUser.uid)));
  const active=snap.docs
    .map(d=>({id:d.id,...d.data()}))
    .filter(x=>x.status==='borrowed' && !x.returnedAt);
  return {active,overdue:active.filter(isLoanOverdue)};
}

function scannerMarkup(mode){
  const action=mode==='borrow' ? 'retirada' : 'devolução';
  return `<div class="panel">
    <p class="mini">Aponte a câmera para o QR Code da etiqueta da Biblioteca Amavale colada no exemplar.</p>
    <div class="member-camera-wrap" id="${mode}-camera-wrap" style="display:none">
      <video id="${mode}-video" class="member-camera" playsinline muted></video>
      <div class="member-guide"></div>
    </div>
    <button class="btn primary" id="${mode}-camera-btn" onclick="memberStartScan('${mode}')">📷 Ler QR para ${action}</button>
    <button class="btn secondary" id="${mode}-stop-btn" style="display:none" onclick="memberStopScan()">Parar câmera</button>
    <div id="${mode}-member-status" class="member-status info">Ao abrir a câmera, permita o acesso quando o navegador perguntar.</div>
    <details class="member-manual"><summary>Se a câmera não funcionar, digitar o código AMA</summary>
      <input class="field" id="${mode}-manual-code" inputmode="text" autocomplete="off" placeholder="Ex.: AMA-00001">
      <button class="btn secondary" onclick="memberUseTypedCode('${mode}')">Continuar com o código</button>
    </details>
  </div>`;
}

function renderBorrowScreen(){
  const section=el('borrow');
  if(!section) return;
  selectedCopy=null;
  section.innerHTML=`<button class="back" onclick="go('home')">← Voltar</button><h2 class="title">Retirar um livro</h2>${scannerMarkup('borrow')}<div id="borrow-member-result"></div>`;
}
function renderReturnScreen(){
  const section=el('return');
  if(!section) return;
  selectedCopy=null;
  section.innerHTML=`<button class="back" onclick="go('home')">← Voltar</button><h2 class="title">Devolver um livro</h2>${scannerMarkup('return')}<div id="return-member-result"></div>`;
}

async function loadZXing(){
  if(window.ZXingBrowser) return window.ZXingBrowser;
  return new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-zxing]');
    if(existing){
      existing.addEventListener('load',()=>resolve(window.ZXingBrowser),{once:true});
      existing.addEventListener('error',()=>reject(new Error('ZXING_LOAD')),{once:true});
      return;
    }
    const s=document.createElement('script');
    s.src='https://unpkg.com/@zxing/browser@0.2.1';
    s.dataset.zxing='1';
    s.onload=()=>resolve(window.ZXingBrowser);
    s.onerror=()=>reject(new Error('ZXING_LOAD'));
    document.head.appendChild(s);
  });
}

window.memberStopScan=function(){
  try{ memberScannerControls?.stop(); }catch(e){}
  memberScannerControls=null;
  memberScanning=false;
  const mode=activeMode;
  activeMode=null;
  ['borrow','return'].forEach(m=>{
    const video=el(`${m}-video`);
    if(video?.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; }
    if(el(`${m}-camera-wrap`)) el(`${m}-camera-wrap`).style.display='none';
    if(el(`${m}-stop-btn`)) el(`${m}-stop-btn`).style.display='none';
    if(el(`${m}-camera-btn`)) el(`${m}-camera-btn`).style.display='block';
  });
  return mode;
};

function requireLogin(mode){
  if(auth.currentUser) return true;
  sessionStorage.setItem('amavale_pending_action',mode);
  originalMemberGo('volunteer-login');
  setTimeout(()=>{
    const section=el('volunteer-login');
    if(section && !el('member-login-note')){
      const note=document.createElement('div');
      note.id='member-login-note';
      note.className='notice';
      note.style.marginBottom='12px';
      note.textContent=mode==='borrow' ? 'Entre na sua conta para retirar este livro.' : 'Entre na sua conta para devolver este livro.';
      const title=section.querySelector('.title');
      title?.after(note);
    }
  },0);
  return false;
}

window.memberStartScan=async function(mode){
  if(memberScanning || !requireLogin(mode)) return;
  try{
    memberScanning=true;
    activeMode=mode;
    setMemberStatus(mode,'Abrindo a câmera…','info');
    const ZXing=await loadZXing();
    el(`${mode}-camera-wrap`).style.display='block';
    el(`${mode}-stop-btn`).style.display='block';
    el(`${mode}-camera-btn`).style.display='none';
    const reader=new ZXing.BrowserMultiFormatReader();
    memberScannerControls=await reader.decodeFromConstraints(
      {audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},
      el(`${mode}-video`),
      async (result,error,controls)=>{
        if(!result) return;
        const raw=result.getText ? result.getText() : String(result.text || result);
        const code=normalizeCopyCode(raw);
        if(!code){
          setMemberStatus(mode,'QR lido, mas ele não contém um código de exemplar da Biblioteca Amavale.','error');
          return;
        }
        try{ controls.stop(); }catch(e){}
        memberScannerControls=null;
        memberScanning=false;
        activeMode=null;
        if(el(`${mode}-camera-wrap`)) el(`${mode}-camera-wrap`).style.display='none';
        if(el(`${mode}-stop-btn`)) el(`${mode}-stop-btn`).style.display='none';
        if(el(`${mode}-camera-btn`)) el(`${mode}-camera-btn`).style.display='block';
        await handleCopy(mode,code);
      }
    );
    setMemberStatus(mode,'Câmera ativa. Centralize o QR Code dentro do quadro verde.','info');
  }catch(error){
    window.memberStopScan();
    const denied=error?.name==='NotAllowedError' || /permission/i.test(error?.message||'');
    setMemberStatus(mode,denied ? 'A câmera foi bloqueada. Libere a câmera nas permissões do navegador e tente novamente.' : 'Não foi possível iniciar a câmera. Atualize a página e tente novamente.','error');
  }
};

window.memberUseTypedCode=async function(mode){
  if(!requireLogin(mode)) return;
  const code=normalizeCopyCode(el(`${mode}-manual-code`)?.value || '');
  if(!code){ setMemberStatus(mode,'Digite um código no formato AMA-00001.','error'); return; }
  await handleCopy(mode,code);
};

async function getCopyWithBook(code){
  const copySnap=await getDoc(doc(db,'copies',code));
  if(!copySnap.exists()) throw new Error('COPY_NOT_FOUND');
  const copy={id:copySnap.id,...copySnap.data()};
  let book={};
  if(copy.isbn){
    try{
      const bookSnap=await getDoc(doc(db,'books',copy.isbn));
      if(bookSnap.exists()) book=bookSnap.data();
    }catch(e){}
  }
  return {...book,...copy,cover:book.cover || copy.cover || ''};
}

function bookCard(copy){
  const cover=copy.cover ? `<img class="member-cover" src="${esc(copy.cover)}" alt="Capa de ${esc(copy.title||'livro')}">` : `<div class="member-cover-placeholder">BIBLIOTECA<br>AMAVALE</div>`;
  return `<div class="member-book">${cover}<div><h3>${esc(copy.title||'Livro')}</h3><p>${esc(copy.author||'Autor não informado')}</p><p>Prateleira <b>${esc(copy.shelf||'—')}</b>${copy.authorCode ? ' · '+esc(copy.authorCode) : ''}</p><span class="copy-code">${esc(copy.code||copy.id)}</span></div></div>`;
}

async function handleCopy(mode,code){
  if(!requireLogin(mode)) return;
  setMemberStatus(mode,`Identificando ${code}…`,'info');
  const result=el(`${mode}-member-result`);
  if(result) result.innerHTML='<div class="panel">Carregando exemplar…</div>';
  try{
    const copy=await getCopyWithBook(code);
    selectedCopy=copy;
    if(mode==='borrow'){
      const borrowingState=await getMemberBorrowingState();
      renderBorrowCopy(copy,borrowingState);
    }else renderReturnCopy(copy);
  }catch(error){
    if(result) result.innerHTML='';
    setMemberStatus(mode,memberError(error),'error');
  }
}

function renderBorrowCopy(copy,borrowingState={active:[],overdue:[]}){
  const result=el('borrow-member-result');
  if(!result) return;
  const available=(copy.status || 'available')==='available';
  const mine=copy.status==='borrowed' && copy.borrowedBy===auth.currentUser?.uid;
  let action='';
  if(available && borrowingState.overdue.length){
    const first=borrowingState.overdue.slice().sort((a,b)=>(dueDateOf(a)?.getTime()||0)-(dueDateOf(b)?.getTime()||0))[0];
    const due=dueDateOf(first);
    action=`<div class="member-status error"><b>Novos empréstimos bloqueados.</b><br>Você possui ${borrowingState.overdue.length} ${borrowingState.overdue.length===1?'livro em atraso':'livros em atraso'}${due?' desde '+fmtDate(due):''}. Faça a devolução para liberar novamente sua conta.</div>`;
    setMemberStatus('borrow','Sua conta está temporariamente bloqueada para novos empréstimos por atraso.','error');
  }else if(available && borrowingState.active.length>=2){
    action='<div class="member-status error"><b>Limite de empréstimos atingido.</b><br>Cada membro pode ficar com até 2 livros ao mesmo tempo. Devolva um deles antes de retirar outro.</div>';
    setMemberStatus('borrow','Você já está com 2 livros emprestados.','error');
  }else if(available){
    const due=new Date(); due.setDate(due.getDate()+30);
    action=`<div class="notice">Prazo de empréstimo: <b>30 dias</b>. Devolução prevista em <b>${fmtDate(due)}</b>.</div><button class="btn green" onclick="confirmMemberBorrow('${esc(copy.code||copy.id)}')">Confirmar empréstimo</button>`;
    setMemberStatus('borrow','Exemplar identificado. Confira o livro antes de confirmar.','ok');
  }else if(mine){
    action=`<div class="notice">Este exemplar já está emprestado para você.</div><button class="btn secondary" onclick="go('return'); setTimeout(()=>memberLoadCopyForMode('return','${esc(copy.code||copy.id)}'),0)">Ir para devolução</button>`;
    setMemberStatus('borrow','Este exemplar já está no seu nome.','info');
  }else{
    action='<div class="member-status error">Este exemplar já está emprestado e não pode ser retirado agora.</div>';
    setMemberStatus('borrow','Exemplar indisponível.','error');
  }
  result.innerHTML=`<div class="panel">${bookCard(copy)}${action}</div>`;
}

function renderReturnCopy(copy){
  const result=el('return-member-result');
  if(!result) return;
  if(copy.status!=='borrowed'){
    result.innerHTML=`<div class="panel">${bookCard(copy)}<div class="member-status info">Este exemplar já consta como disponível no acervo.</div></div>`;
    setMemberStatus('return','Nenhuma devolução pendente para este exemplar.','info');
    return;
  }
  if(copy.borrowedBy!==auth.currentUser?.uid){
    result.innerHTML=`<div class="panel">${bookCard(copy)}<div class="member-status error">Este livro está emprestado para outro usuário.</div></div>`;
    setMemberStatus('return','A devolução deve ser confirmada pela conta que realizou o empréstimo.','error');
    return;
  }
  result.innerHTML=`<div class="panel">${bookCard(copy)}<div class="location"><div class="shelf">${esc(copy.shelf||'?')}</div><div><h4>Recoloque o livro nesta prateleira</h4><p>Depois confirme a devolução abaixo.</p></div></div><button class="btn green" onclick="confirmMemberReturn('${esc(copy.code||copy.id)}')">Confirmar devolução</button></div>`;
  setMemberStatus('return','Exemplar identificado. Confira a prateleira antes de confirmar.','ok');
}

window.memberLoadCopyForMode=handleCopy;

window.confirmMemberBorrow=async function(code){
  if(!requireLogin('borrow')) return;
  const button=document.querySelector('#borrow-member-result button.green');
  if(button){ button.disabled=true; button.textContent='Registrando empréstimo…'; }
  try{
    const user=auth.currentUser;
    const borrowingState=await getMemberBorrowingState();
    if(borrowingState.overdue.length) throw new Error('OVERDUE_BLOCK');
    if(borrowingState.active.length>=2) throw new Error('LIMIT_REACHED');
    const copyRef=doc(db,'copies',code);
    const loanRef=doc(collection(db,'loans'));
    const dueDate=new Date(); dueDate.setDate(dueDate.getDate()+30);
    const dueAt=Timestamp.fromDate(dueDate);
    let savedCopy=null;
    await runTransaction(db,async transaction=>{
      const copySnap=await transaction.get(copyRef);
      if(!copySnap.exists()) throw new Error('COPY_NOT_FOUND');
      const copy=copySnap.data();
      if((copy.status||'available')!=='available') throw new Error('NOT_AVAILABLE');
      savedCopy={id:copySnap.id,...copy};
      transaction.set(loanRef,{
        memberId:user.uid,
        copyCode:code,
        isbn:copy.isbn || '',
        title:copy.title || '',
        author:copy.author || '',
        shelf:copy.shelf || '',
        status:'borrowed',
        borrowedAt:serverTimestamp(),
        dueAt,
        returnedAt:null
      });
      transaction.update(copyRef,{
        status:'borrowed',
        borrowedBy:user.uid,
        activeLoanId:loanRef.id,
        dueAt,
        lastLoanAt:serverTimestamp()
      });
    });
    const result=el('borrow-member-result');
    if(result) result.innerHTML=`<div class="panel success"><div class="check">✓</div><h3>Empréstimo realizado</h3><p><b>${esc(savedCopy?.title||'Livro')}</b></p><div class="due-big">Devolver até ${fmtDate(dueDate)}</div><p class="mini">O exemplar ${esc(code)} agora está registrado no seu nome.</p><button class="btn primary" onclick="go('loans')">Ver meus livros</button><button class="btn secondary" onclick="go('home')">Voltar ao início</button></div>`;
    setMemberStatus('borrow','Empréstimo registrado com sucesso.','ok');
  }catch(error){
    setMemberStatus('borrow',memberError(error),'error');
    if(button){ button.disabled=false; button.textContent='Confirmar empréstimo'; }
  }
};

window.confirmMemberReturn=async function(code){
  if(!requireLogin('return')) return;
  const button=document.querySelector('#return-member-result button.green');
  if(button){ button.disabled=true; button.textContent='Registrando devolução…'; }
  try{
    const user=auth.currentUser;
    const copyRef=doc(db,'copies',code);
    let returnedTitle='Livro';
    let shelf='';
    await runTransaction(db,async transaction=>{
      const copySnap=await transaction.get(copyRef);
      if(!copySnap.exists()) throw new Error('COPY_NOT_FOUND');
      const copy=copySnap.data();
      if(copy.status!=='borrowed') throw new Error('NOT_BORROWED');
      if(copy.borrowedBy!==user.uid) throw new Error('NOT_YOURS');
      if(!copy.activeLoanId) throw new Error('LOAN_NOT_FOUND');
      const loanRef=doc(db,'loans',copy.activeLoanId);
      const loanSnap=await transaction.get(loanRef);
      if(!loanSnap.exists()) throw new Error('LOAN_NOT_FOUND');
      const loan=loanSnap.data();
      if(loan.memberId!==user.uid || loan.status!=='borrowed') throw new Error('LOAN_NOT_FOUND');
      returnedTitle=copy.title || loan.title || 'Livro';
      shelf=copy.shelf || loan.shelf || '';
      transaction.update(loanRef,{status:'returned',returnedAt:serverTimestamp()});
      transaction.update(copyRef,{
        status:'available',
        borrowedBy:null,
        activeLoanId:null,
        dueAt:null,
        lastReturnAt:serverTimestamp()
      });
    });
    const result=el('return-member-result');
    if(result) result.innerHTML=`<div class="panel success"><div class="check">✓</div><h3>Devolução concluída</h3><p><b>${esc(returnedTitle)}</b></p><p>Exemplar <b>${esc(code)}</b> voltou a ficar disponível${shelf ? ' na prateleira <b>'+esc(shelf)+'</b>' : ''}.</p><button class="btn primary" onclick="go('home')">Pronto</button></div>`;
    setMemberStatus('return','Devolução registrada com sucesso.','ok');
  }catch(error){
    setMemberStatus('return',memberError(error),'error');
    if(button){ button.disabled=false; button.textContent='Confirmar devolução'; }
  }
};

async function renderMemberLoans(){
  const section=el('loans');
  if(!section) return;
  section.innerHTML='<button class="back" onclick="go(\'home\')">← Voltar</button><h2 class="title">Meus livros</h2><div id="member-loan-list"><div class="panel">Carregando seus empréstimos…</div></div>';
  const list=el('member-loan-list');
  if(!auth.currentUser){
    list.innerHTML='<div class="panel"><p>Entre na sua conta para acompanhar seus empréstimos.</p><button class="btn primary" onclick="go(\'volunteer-login\')">Entrar</button></div>';
    return;
  }
  try{
    const snap=await getDocs(query(collection(db,'loans'),where('memberId','==',auth.currentUser.uid)));
    const loans=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='borrowed' && !x.returnedAt).sort((a,b)=>{
      const ad=a.dueAt?.toMillis?.() || 0, bd=b.dueAt?.toMillis?.() || 0; return ad-bd;
    });
    if(!loans.length){ list.innerHTML='<div class="panel">Você não tem livros emprestados no momento.</div>'; return; }
    const overdue=loans.filter(isLoanOverdue);
    const summary=`<div class="panel"><b>${loans.length} de 2 livros emprestados</b><p class="mini">Prazo padrão: 30 dias. A renovação poderá acrescentar mais 30 dias quando não houver fila de espera.</p></div>`;
    const blocked=overdue.length ? `<div class="member-status error" style="margin-bottom:12px"><b>Conta bloqueada para novos empréstimos.</b><br>${overdue.length===1?'Há 1 livro em atraso.':'Há '+overdue.length+' livros em atraso.'} O bloqueio é retirado automaticamente após a devolução.</div>` : '';
    list.innerHTML=blocked+summary+loans.map(l=>{
      const due=dueDateOf(l);
      const late=isLoanOverdue(l);
      const dueBox=due ? (late ? `<div class="member-status error"><b>Em atraso.</b> O prazo terminou em ${fmtDate(due)}.</div>` : `<div class="notice">Devolver até <b>${fmtDate(due)}</b>.</div>`) : '';
      return `<div class="panel"><b>${esc(l.title||'Livro')}</b><p class="mini">${esc(l.author||'')}<br>Exemplar <b>${esc(l.copyCode||'')}</b>${l.shelf ? ' · Prateleira '+esc(l.shelf) : ''}</p>${dueBox}<button class="btn secondary" onclick="go('return'); setTimeout(()=>memberLoadCopyForMode('return','${esc(l.copyCode||'')}'),0)">Devolver este livro</button></div>`;
    }).join('');
  }catch(error){
    list.innerHTML=`<div class="member-status error">${esc(memberError(error))}</div>`;
  }
}

window.go=function(id){
  if(id!=='borrow' && id!=='return') window.memberStopScan();
  else if(activeMode && activeMode!==id) window.memberStopScan();
  originalMemberGo(id);
  if(id==='borrow') setTimeout(renderBorrowScreen,0);
  if(id==='return') setTimeout(renderReturnScreen,0);
  if(id==='loans') setTimeout(renderMemberLoans,0);
};

function clearCopyParam(){
  try{
    const u=new URL(location.href);
    u.searchParams.delete('copy');
    history.replaceState(null,'',u.pathname+(u.search ? u.search : '')+u.hash);
  }catch(e){}
}

async function openDirectCopy(code){
  if(directCopyHandled || !code || !auth.currentUser) return;
  directCopyHandled=true;
  clearCopyParam();
  try{
    const copy=await getCopyWithBook(code);
    if(copy.status==='borrowed' && copy.borrowedBy===auth.currentUser.uid){
      window.go('return');
      setTimeout(()=>{ selectedCopy=copy; renderReturnCopy(copy); },0);
    }else{
      const borrowingState=await getMemberBorrowingState();
      window.go('borrow');
      setTimeout(()=>{ selectedCopy=copy; renderBorrowCopy(copy,borrowingState); },0);
    }
  }catch(error){
    window.go('borrow');
    setTimeout(()=>setMemberStatus('borrow',memberError(error),'error'),0);
  }
}

const urlCopy=normalizeCopyCode(new URL(location.href).searchParams.get('copy') || '');
if(urlCopy) sessionStorage.setItem('amavale_pending_copy',urlCopy);

onAuthStateChanged(auth,user=>{
  if(!user){
    const pendingCopy=sessionStorage.getItem('amavale_pending_copy');
    if(pendingCopy){
      sessionStorage.setItem('amavale_pending_action','borrow');
      setTimeout(()=>requireLogin('borrow'),50);
    }
    return;
  }
  const pendingCopy=sessionStorage.getItem('amavale_pending_copy');
  if(pendingCopy){
    sessionStorage.removeItem('amavale_pending_copy');
    sessionStorage.removeItem('amavale_pending_action');
    setTimeout(()=>openDirectCopy(pendingCopy),80);
    return;
  }
  const pendingAction=sessionStorage.getItem('amavale_pending_action');
  if(pendingAction==='borrow' || pendingAction==='return'){
    sessionStorage.removeItem('amavale_pending_action');
    setTimeout(()=>window.go(pendingAction),80);
  }
});
