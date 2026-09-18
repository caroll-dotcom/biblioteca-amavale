
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig={
  apiKey:'AIzaSyCpsABmAOMlUxEKFAFTk2IgzpYyOZfh5sw',
  authDomain:'biblioteca-amavale.firebaseapp.com',
  projectId:'biblioteca-amavale',
  storageBucket:'biblioteca-amavale.firebasestorage.app',
  messagingSenderId:'415376174106',
  appId:'1:415376174106:web:a62cfd75d111b866eeb5a3'
};
const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const previousGo=window.go;

const style=document.createElement('style');
style.textContent='.queue-note{margin-top:10px;padding:11px 12px;border-radius:12px;background:#f4f0e7;font-size:12px;line-height:1.45}.queue-ready{background:#eef3df;color:#425020}.queue-alert{background:#f8e8e4;color:#7a3025}.queue-actions{display:grid;gap:7px;margin-top:9px}.queue-actions .btn{margin-top:0}.queue-position{display:inline-block;margin-top:7px;padding:5px 8px;border-radius:999px;background:#eef2e4;font-size:10px;font-weight:800}.renewed-pill{display:inline-block;margin-top:7px;padding:5px 8px;border-radius:999px;background:#eef2e4;font-size:10px;font-weight:800}';
document.head.appendChild(style);

function esc(v){return String(v||'').replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}
function fmt(d){return new Intl.DateTimeFormat('pt-BR').format(d);}
function toDate(ts){return ts&&ts.toDate?ts.toDate():null;}
function overdue(loan){const d=toDate(loan&&loan.dueAt);if(!d)return false;d.setHours(23,59,59,999);return Date.now()>d.getTime();}
function keyFor(o){return String((o&&((o.queueKey)||(o.isbn)||(o.copyCode)||(o.code)))||'').trim();}
function waitId(key,uid){return key.replace(/[^A-Za-z0-9_-]/g,'_')+'__'+uid;}
async function memberLoans(){
  if(!auth.currentUser)return [];
  const s=await getDocs(query(collection(db,'loans'),where('memberId','==',auth.currentUser.uid)));
  return s.docs.map(function(d){return Object.assign({id:d.id},d.data());});
}
async function waiting(key){
  if(!key)return [];
  const s=await getDocs(query(collection(db,'waitlist'),where('queueKey','==',key)));
  return s.docs.map(function(d){return Object.assign({id:d.id},d.data());}).filter(function(x){return x.status==='waiting';}).sort(function(a,b){
    const aa=a.joinedAt&&a.joinedAt.toMillis?a.joinedAt.toMillis():0;
    const bb=b.joinedAt&&b.joinedAt.toMillis?b.joinedAt.toMillis():0;
    return aa-bb||String(a.id).localeCompare(String(b.id));
  });
}
async function ownWaitlist(){
  if(!auth.currentUser)return [];
  const s=await getDocs(query(collection(db,'waitlist'),where('memberId','==',auth.currentUser.uid)));
  return s.docs.map(function(d){return Object.assign({id:d.id},d.data());});
}
async function copyByCode(code){
  const s=await getDoc(doc(db,'copies',code));
  return s.exists()?Object.assign({id:s.id},s.data()):null;
}
function reservationExpired(copy){
  const d=toDate(copy&&copy.reservationExpiresAt);
  return copy&&copy.status==='reserved'&&d&&Date.now()>d.getTime();
}

async function advanceExpiredReservation(copy){
  if(!copy||!reservationExpired(copy))return;
  const key=keyFor(copy);
  const rows=(await waiting(key)).filter(function(x){return x.memberId!==copy.reservedFor;});
  const next=rows[0]||null;
  const copyRef=doc(db,'copies',copy.code||copy.id);
  const currentRef=copy.reservedWaitlistId?doc(db,'waitlist',copy.reservedWaitlistId):null;
  const nextRef=next?doc(db,'waitlist',next.id):null;
  const expiry=Timestamp.fromDate(new Date(Date.now()+3*24*60*60*1000));
  try{
    await runTransaction(db,async function(tx){
      const freshSnap=await tx.get(copyRef);
      if(!freshSnap.exists())return;
      const fresh=freshSnap.data();
      const exp=toDate(fresh.reservationExpiresAt);
      if(fresh.status!=='reserved'||!exp||Date.now()<=exp.getTime())return;
      if(currentRef){
        const cur=await tx.get(currentRef);
        if(cur.exists()&&cur.data().status==='ready')tx.update(currentRef,{status:'expired',expiredAt:serverTimestamp()});
      }
      if(nextRef){
        const n=await tx.get(nextRef);
        if(!n.exists()||n.data().status!=='waiting')return;
        tx.update(nextRef,{status:'ready',readyAt:serverTimestamp(),reservationExpiresAt:expiry,copyCode:fresh.code||freshSnap.id});
        tx.update(copyRef,{status:'reserved',reservedFor:next.memberId,reservedWaitlistId:next.id,reservationExpiresAt:expiry});
      }else{
        tx.update(copyRef,{status:'available',reservedFor:null,reservedWaitlistId:null,reservationExpiresAt:null});
      }
    });
  }catch(e){console.warn(e);}
}
async function processExpired(){
  if(!auth.currentUser)return;
  try{
    const s=await getDocs(query(collection(db,'copies'),where('status','==','reserved')));
    for(const d of s.docs){
      const c=Object.assign({id:d.id},d.data());
      if(reservationExpired(c))await advanceExpiredReservation(c);
    }
  }catch(e){console.warn(e);}
}

window.renewMemberLoan=async function(loanId){
  if(!auth.currentUser)return;
  try{
    const loanRef=doc(db,'loans',loanId);
    const snap=await getDoc(loanRef);
    if(!snap.exists())throw new Error('LOAN_NOT_FOUND');
    const loan=Object.assign({id:snap.id},snap.data());
    if(loan.memberId!==auth.currentUser.uid||loan.status!=='borrowed'||loan.returnedAt)throw new Error('LOAN_NOT_FOUND');
    if(overdue(loan))throw new Error('OVERDUE');
    if((loan.renewalCount||0)>=1)throw new Error('ALREADY');
    if((await waiting(keyFor(loan))).length)throw new Error('WAITLIST');
    const oldDue=toDate(loan.dueAt);
    if(!oldDue)throw new Error('NO_DUE');
    const newDue=new Date(oldDue);newDue.setDate(newDue.getDate()+30);
    const newDueAt=Timestamp.fromDate(newDue);
    const copyRef=doc(db,'copies',loan.copyCode);
    await runTransaction(db,async function(tx){
      const ls=await tx.get(loanRef);
      const cs=await tx.get(copyRef);
      if(!ls.exists()||!cs.exists())throw new Error('LOAN_NOT_FOUND');
      const l=ls.data(),c=cs.data();
      if(l.memberId!==auth.currentUser.uid||l.status!=='borrowed'||(l.renewalCount||0)>=1)throw new Error('ALREADY');
      if(c.activeLoanId!==loanId||c.borrowedBy!==auth.currentUser.uid)throw new Error('LOAN_NOT_FOUND');
      tx.update(loanRef,{dueAt:newDueAt,renewalCount:1,renewedAt:serverTimestamp()});
      tx.update(copyRef,{dueAt:newDueAt});
    });
    alert('Renovação confirmada. Nova data de devolução: '+fmt(newDue)+'.');
    await renderLoansV2();
  }catch(e){
    const m=String(e&&e.message||'');
    if(m.includes('WAITLIST'))alert('Este livro tem membro(s) na fila de espera e não pode ser renovado.');
    else if(m.includes('OVERDUE'))alert('Livros em atraso não podem ser renovados.');
    else if(m.includes('ALREADY'))alert('A renovação de 30 dias deste empréstimo já foi utilizada.');
    else alert('Não foi possível renovar este livro agora.');
  }
};

window.confirmMemberBorrow=async function(code){
  if(!auth.currentUser)return;
  const btn=document.querySelector('#borrow-member-result button.green');
  if(btn){btn.disabled=true;btn.textContent='Registrando empréstimo…';}
  try{
    await processExpired();
    const loans=(await memberLoans()).filter(function(x){return x.status==='borrowed'&&!x.returnedAt;});
    if(loans.some(overdue))throw new Error('OVERDUE');
    if(loans.length>=2)throw new Error('LIMIT');
    const copyRef=doc(db,'copies',code);
    let copy=await copyByCode(code);
    if(!copy)throw new Error('COPY');
    if(reservationExpired(copy)){await advanceExpiredReservation(copy);copy=await copyByCode(code);}
    const available=(copy.status||'available')==='available';
    const reserved=copy.status==='reserved'&&copy.reservedFor===auth.currentUser.uid&&!reservationExpired(copy);
    if(!available&&!reserved)throw new Error('NOT_AVAILABLE');
    const loanRef=doc(collection(db,'loans'));
    const due=new Date();due.setDate(due.getDate()+30);
    const dueAt=Timestamp.fromDate(due);
    const waitRef=copy.reservedWaitlistId?doc(db,'waitlist',copy.reservedWaitlistId):null;
    const key=keyFor(copy);
    await runTransaction(db,async function(tx){
      const cs=await tx.get(copyRef);
      if(!cs.exists())throw new Error('COPY');
      const c=cs.data();
      const ok=(c.status||'available')==='available'||(c.status==='reserved'&&c.reservedFor===auth.currentUser.uid);
      if(!ok)throw new Error('NOT_AVAILABLE');
      if(waitRef){
        const ws=await tx.get(waitRef);
        if(ws.exists()&&ws.data().status==='ready'&&ws.data().memberId===auth.currentUser.uid)tx.update(waitRef,{status:'fulfilled',fulfilledAt:serverTimestamp()});
      }
      tx.set(loanRef,{
        memberId:auth.currentUser.uid,copyCode:code,isbn:c.isbn||'',queueKey:key,title:c.title||'',author:c.author||'',shelf:c.shelf||'',
        status:'borrowed',borrowedAt:serverTimestamp(),dueAt:dueAt,renewalCount:0,renewedAt:null,returnedAt:null
      });
      tx.update(copyRef,{status:'borrowed',borrowedBy:auth.currentUser.uid,activeLoanId:loanRef.id,dueAt:dueAt,lastLoanAt:serverTimestamp(),reservedFor:null,reservedWaitlistId:null,reservationExpiresAt:null});
    });
    const result=document.getElementById('borrow-member-result');
    if(result)result.innerHTML='<div class="panel success"><div class="check">✓</div><h3>Empréstimo realizado</h3><p><b>'+esc(copy.title||'Livro')+'</b></p><div class="due-big">Devolver até '+fmt(due)+'</div><p class="mini">Você poderá renovar uma vez por mais 30 dias se não houver fila de espera.</p><button class="btn primary" onclick="go(\'loans\')">Ver meus livros</button><button class="btn secondary" onclick="go(\'home\')">Voltar ao início</button></div>';
  }catch(e){
    const m=String(e&&e.message||'');
    let msg='Não foi possível concluir o empréstimo.';
    if(m.includes('OVERDUE'))msg='Você tem um livro em atraso. Novos empréstimos ficam bloqueados até a devolução.';
    else if(m.includes('LIMIT'))msg='Você já está com o limite de 2 livros emprestados.';
    else if(m.includes('NOT_AVAILABLE'))msg='Este exemplar não está disponível para você neste momento.';
    const status=document.getElementById('borrow-member-status');
    if(status){status.className='member-status error';status.textContent=msg;}
    if(btn){btn.disabled=false;btn.textContent='Confirmar empréstimo';}
  }
};

window.confirmMemberReturn=async function(code){
  if(!auth.currentUser)return;
  const btn=document.querySelector('#return-member-result button.green');
  if(btn){btn.disabled=true;btn.textContent='Registrando devolução…';}
  try{
    const copyRef=doc(db,'copies',code);
    const outside=await copyByCode(code);
    if(!outside)throw new Error('COPY');
    const key=keyFor(outside);
    const rows=(await waiting(key)).filter(function(x){return x.memberId!==auth.currentUser.uid;});
    const next=rows[0]||null;
    const nextRef=next?doc(db,'waitlist',next.id):null;
    const expiryDate=new Date(Date.now()+3*24*60*60*1000);
    const expiry=Timestamp.fromDate(expiryDate);
    let title=outside.title||'Livro';
    let shelf=outside.shelf||'';
    let reserved=false;
    await runTransaction(db,async function(tx){
      const cs=await tx.get(copyRef);
      if(!cs.exists())throw new Error('COPY');
      const c=cs.data();
      if(c.status!=='borrowed'||c.borrowedBy!==auth.currentUser.uid||!c.activeLoanId)throw new Error('NOT_YOURS');
      const loanRef=doc(db,'loans',c.activeLoanId);
      const ls=await tx.get(loanRef);
      if(!ls.exists()||ls.data().memberId!==auth.currentUser.uid||ls.data().status!=='borrowed')throw new Error('LOAN');
      title=c.title||ls.data().title||title;shelf=c.shelf||ls.data().shelf||shelf;
      if(nextRef){
        const ns=await tx.get(nextRef);
        if(!ns.exists()||ns.data().status!=='waiting')throw new Error('QUEUE_CHANGED');
        tx.update(nextRef,{status:'ready',readyAt:serverTimestamp(),reservationExpiresAt:expiry,copyCode:c.code||code});
        tx.update(copyRef,{status:'reserved',borrowedBy:null,activeLoanId:null,dueAt:null,lastReturnAt:serverTimestamp(),reservedFor:next.memberId,reservedWaitlistId:next.id,reservationExpiresAt:expiry});
        reserved=true;
      }else{
        tx.update(copyRef,{status:'available',borrowedBy:null,activeLoanId:null,dueAt:null,lastReturnAt:serverTimestamp(),reservedFor:null,reservedWaitlistId:null,reservationExpiresAt:null});
      }
      tx.update(loanRef,{status:'returned',returnedAt:serverTimestamp()});
    });
    const result=document.getElementById('return-member-result');
    if(result)result.innerHTML='<div class="panel success"><div class="check">✓</div><h3>Devolução concluída</h3><p><b>'+esc(title)+'</b></p><p>Exemplar <b>'+esc(code)+'</b>'+(shelf?' · prateleira <b>'+esc(shelf)+'</b>':'')+'.</p>'+(reserved?'<div class="notice">Há fila de espera. O exemplar foi reservado para o próximo membro por 3 dias.</div>':'<div class="notice">O exemplar voltou a ficar disponível.</div>')+'<button class="btn primary" onclick="go(\'home\')">Pronto</button></div>';
  }catch(e){
    console.error(e);
    const status=document.getElementById('return-member-status');
    if(status){status.className='member-status error';status.textContent='Não foi possível registrar a devolução agora.';}
    if(btn){btn.disabled=false;btn.textContent='Confirmar devolução';}
  }
};

async function enhanceBorrow(){
  if(!auth.currentUser)return;
  const result=document.getElementById('borrow-member-result');
  const codeEl=result&&result.querySelector('.copy-code');
  if(!codeEl)return;
  const code=codeEl.textContent.trim();
  let copy=await copyByCode(code);
  if(!copy)return;
  if(reservationExpired(copy)){await advanceExpiredReservation(copy);copy=await copyByCode(code);}
  const panel=result.querySelector('.panel');
  if(!panel)return;
  panel.querySelectorAll('[data-queue-extra]').forEach(function(n){n.remove();});
  const key=keyFor(copy);
  const ownSnap=await getDoc(doc(db,'waitlist',waitId(key,auth.currentUser.uid)));
  const own=ownSnap.exists()?ownSnap.data():null;
  if(copy.status==='reserved'&&copy.reservedFor===auth.currentUser.uid){
    const exp=toDate(copy.reservationExpiresAt);
    const old=panel.querySelector('.member-status.error');if(old)old.remove();
    const box=document.createElement('div');box.dataset.queueExtra='1';box.className='queue-note queue-ready';
    box.innerHTML='<b>Este exemplar está reservado para você.</b><br>Retire até <b>'+(exp?fmt(exp):'o prazo informado')+'</b>.<div class="queue-actions"><button class="btn green" onclick="confirmMemberBorrow(\''+esc(code)+'\')">Confirmar empréstimo</button></div>';
    panel.appendChild(box);return;
  }
  if(copy.status==='borrowed'||copy.status==='reserved'){
    const box=document.createElement('div');box.dataset.queueExtra='1';box.className='queue-note';
    if(own&&own.status==='waiting'){
      const rows=await waiting(key);const pos=rows.findIndex(function(x){return x.memberId===auth.currentUser.uid;})+1;
      box.innerHTML='<b>Você já está na fila de espera.</b>'+(pos>0?'<br><span class="queue-position">Posição '+pos+'</span>':'')+'<div class="queue-actions"><button class="btn secondary" onclick="cancelWaitlist(\''+esc(key)+'\')">Sair da fila</button></div>';
    }else{
      box.innerHTML='<b>Este título está indisponível.</b><br>Você pode entrar na fila por ordem de chegada.<div class="queue-actions"><button class="btn secondary" onclick="joinWaitlist(\''+esc(key)+'\')">Entrar na fila de espera</button></div>';
    }
    panel.appendChild(box);
  }
}
const observer=new MutationObserver(function(){setTimeout(function(){enhanceBorrow();},20);});
observer.observe(document.body,{childList:true,subtree:true});

async function renderLoansV2(){
  const section=document.getElementById('loans');
  if(!section||!auth.currentUser)return;
  await processExpired();
  section.innerHTML='<button class="back" onclick="go(\'home\')">← Voltar</button><h2 class="title">Meus livros</h2><div id="member-notices"></div><div id="member-loan-list"><div class="panel">Carregando…</div></div>';
  const notices=document.getElementById('member-notices');
  const list=document.getElementById('member-loan-list');
  try{
    const loans=(await memberLoans()).filter(function(x){return x.status==='borrowed'&&!x.returnedAt;}).sort(function(a,b){return (a.dueAt&&a.dueAt.toMillis?a.dueAt.toMillis():0)-(b.dueAt&&b.dueAt.toMillis?b.dueAt.toMillis():0);});
    const entries=(await ownWaitlist()).filter(function(x){return ['waiting','ready'].includes(x.status);});
    const notes=[];
    for(const e of entries){
      let title='Livro';
      if(e.copyCode){const c=await copyByCode(e.copyCode);if(c)title=c.title||title;}
      else if(/^97[89]\d{10}$/.test(e.queueKey||'')){const b=await getDoc(doc(db,'books',e.queueKey));if(b.exists())title=b.data().title||title;}
      if(e.status==='ready'){
        const exp=toDate(e.reservationExpiresAt);
        notes.push('<div class="queue-note queue-ready"><b>'+esc(title)+' está disponível para você.</b><br>Sua reserva vale por 3 dias'+(exp?', até <b>'+fmt(exp)+'</b>':'')+'.'+(e.copyCode?'<div class="queue-actions"><button class="btn green" onclick="go(\'borrow\');setTimeout(function(){memberLoadCopyForMode(\'borrow\',\''+esc(e.copyCode)+'\');},0)">Retirar livro reservado</button></div>':'')+'</div>');
      }else{
        const rows=await waiting(e.queueKey);const pos=rows.findIndex(function(x){return x.memberId===auth.currentUser.uid;})+1;
        notes.push('<div class="queue-note"><b>Fila de espera: '+esc(title)+'</b>'+(pos>0?'<br>Você está na posição <b>'+pos+'</b>.':'')+'<div class="queue-actions"><button class="btn secondary" onclick="cancelWaitlist(\''+esc(e.queueKey)+'\')">Sair da fila</button></div></div>');
      }
    }
    notices.innerHTML=notes.join('');
    if(!loans.length){list.innerHTML='<div class="panel">Você não tem livros emprestados no momento.</div>';return;}
    const late=loans.filter(overdue);
    let html='';
    if(late.length)html+='<div class="queue-note queue-alert"><b>Conta bloqueada para novos empréstimos.</b><br>Há '+late.length+' livro(s) em atraso. O bloqueio termina após a devolução.</div>';
    html+='<div class="panel"><b>'+loans.length+' de 2 livros emprestados</b><p class="mini">Prazo inicial de 30 dias. Uma renovação de mais 30 dias é permitida apenas quando não houver fila de espera.</p></div>';
    for(const l of loans){
      const due=toDate(l.dueAt),isLate=overdue(l),rows=await waiting(keyFor(l));
      let renew='';
      if(isLate)renew='<div class="member-status error"><b>Em atraso.</b> A renovação não está disponível.</div>';
      else if((l.renewalCount||0)>=1)renew='<span class="renewed-pill">Renovação de 30 dias já utilizada</span>';
      else if(rows.length)renew='<div class="queue-note"><b>Renovação indisponível.</b><br>Há membro(s) aguardando este título na fila.</div>';
      else renew='<button class="btn green" onclick="renewMemberLoan(\''+esc(l.id)+'\')">Renovar por mais 30 dias</button>';
      html+='<div class="panel"><b>'+esc(l.title||'Livro')+'</b><p class="mini">'+esc(l.author||'')+'<br>Exemplar <b>'+esc(l.copyCode||'')+'</b>'+(l.shelf?' · Prateleira '+esc(l.shelf):'')+'</p>'+(due?'<div class="'+(isLate?'member-status error':'notice')+'">'+(isLate?'<b>Em atraso.</b> Prazo encerrado em':'Devolver até')+' <b>'+fmt(due)+'</b>.</div>':'')+renew+'<button class="btn secondary" onclick="go(\'return\');setTimeout(function(){memberLoadCopyForMode(\'return\',\''+esc(l.copyCode||'')+'\');},0)">Devolver este livro</button></div>';
    }
    list.innerHTML=html;
  }catch(e){
    console.error(e);
    list.innerHTML='<div class="member-status error">Não foi possível carregar seus empréstimos agora.</div>';
  }
}

window.go=function(id){
  previousGo(id);
  if(id==='loans')setTimeout(function(){renderLoansV2();},50);
  if(id==='borrow')setTimeout(function(){enhanceBorrow();},100);
};
