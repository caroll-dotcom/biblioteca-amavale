
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, getDocs, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
const previousRenderCatalog=window.renderCatalog;

function normalizeSearch(value=''){
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function renderCatalogLogin(){
  const list=document.getElementById('catalog-list');
  if(!list) return;
  list.innerHTML='<div class="panel"><b>Catálogo da Biblioteca Amavale</b><p class="mini">Entre na sua conta para consultar o acervo real, pesquisar por título, autor ou assunto e ver a disponibilidade dos exemplares.</p><button class="btn primary" onclick="go(\'volunteer-login\')">Entrar para consultar o acervo</button></div>';
}

function esc(v){return String(v||'').replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}
function keyFor(o){return String((o&&((o.queueKey)||(o.isbn)||(o.copyCode)||(o.code)))||'').trim();}
function waitId(key,uid){return key.replace(/[^A-Za-z0-9_-]/g,'_')+'__'+uid;}
async function queueEntries(key){
  const s=await getDocs(query(collection(db,'waitlist'),where('queueKey','==',key)));
  return s.docs.map(function(d){return Object.assign({id:d.id},d.data());});
}
async function waitingEntries(key){
  const rows=await queueEntries(key);
  return rows.filter(function(x){return x.status==='waiting';}).sort(function(a,b){
    const aa=a.joinedAt&&a.joinedAt.toMillis?a.joinedAt.toMillis():0;
    const bb=b.joinedAt&&b.joinedAt.toMillis?b.joinedAt.toMillis():0;
    return aa-bb || String(a.id).localeCompare(String(b.id));
  });
}
async function ownEntries(){
  if(!auth.currentUser)return [];
  const s=await getDocs(query(collection(db,'waitlist'),where('memberId','==',auth.currentUser.uid)));
  return s.docs.map(function(d){return Object.assign({id:d.id},d.data());});
}

window.joinWaitlist=async function(key){
  if(!auth.currentUser){previousGo('volunteer-login');return;}
  const uid=auth.currentUser.uid;
  const ref=doc(db,'waitlist',waitId(key,uid));
  try{
    const loanSnap=await getDocs(query(collection(db,'loans'),where('memberId','==',uid)));
    const active=loanSnap.docs.map(function(d){return Object.assign({id:d.id},d.data());})
      .filter(function(x){return x.status==='borrowed'&&!x.returnedAt;});
    if(active.some(function(x){return keyFor(x)===key;})){
      alert('Este título já está emprestado para você.');
      return;
    }
    await runTransaction(db,async function(tx){
      const snap=await tx.get(ref);
      if(snap.exists()&&['waiting','ready'].includes(snap.data().status))return;
      tx.set(ref,{
        memberId:uid,
        queueKey:key,
        status:'waiting',
        joinedAt:serverTimestamp(),
        readyAt:null,
        reservationExpiresAt:null,
        copyCode:null
      });
    });
    alert('Você entrou na fila de espera. A ordem é definida pela data e hora de entrada.');
    await renderRealCatalog();
  }catch(e){
    console.error(e);
    alert('Não foi possível entrar na fila agora. Tente novamente.');
  }
};

window.cancelWaitlist=async function(key){
  if(!auth.currentUser)return;
  const ref=doc(db,'waitlist',waitId(key,auth.currentUser.uid));
  try{
    await runTransaction(db,async function(tx){
      const snap=await tx.get(ref);
      if(!snap.exists()||snap.data().status!=='waiting')return;
      tx.update(ref,{status:'cancelled',cancelledAt:serverTimestamp()});
    });
    await renderRealCatalog();
  }catch(e){
    alert('Não foi possível sair da fila agora.');
  }
};

async function renderRealCatalog(){
  if(!auth.currentUser){
    renderCatalogLogin();
    return;
  }
  const list=document.getElementById('catalog-list');
  const input=document.getElementById('search');
  if(!list)return;
  list.innerHTML='<div class="panel">Carregando catálogo…</div>';
  try{
    const copies=await getDocs(collection(db,'copies'));
    let mine=[];
    try{
      mine=await ownEntries();
    }catch(waitlistError){
      console.warn('Fila de espera indisponível; exibindo o acervo mesmo assim.',waitlistError);
    }
    const mineByKey=new Map(mine.filter(function(x){return ['waiting','ready'].includes(x.status);}).map(function(x){return [x.queueKey,x];}));
    const groups=new Map();
    copies.forEach(function(d){
      const c=Object.assign({id:d.id},d.data());
      const key=keyFor(c)||d.id;
      if(!groups.has(key))groups.set(key,{key:key,title:c.title||'Livro',author:c.author||'',category:c.category||'',shelf:c.shelf||'',copies:[]});
      groups.get(key).copies.push(c);
    });
    const term=normalizeSearch((input&&input.value)||'');
    const rows=Array.from(groups.values()).filter(function(g){
      return normalizeSearch([g.title,g.author,g.category,g.shelf,g.key].join(' ')).includes(term);
    }).sort(function(a,b){ return String(a.title||'').localeCompare(String(b.title||''),'pt-BR'); });
    if(!rows.length){
      list.innerHTML=copies.empty
        ? '<div class="panel"><b>Acervo ainda sem exemplares cadastrados.</b><p class="mini">Assim que os voluntários cadastrarem os livros, eles aparecerão aqui automaticamente.</p></div>'
        : '<div class="panel">Nenhum livro encontrado para esta busca.</div>';
      return;
    }
    const html=[`<div class="panel"><b>Acervo geral</b><p class="mini">${rows.length} ${rows.length===1?'título encontrado':'títulos encontrados'}${term?' para esta busca':' no catálogo'}. Pesquise por título, autor ou assunto.</p></div>`];
    for(const g of rows){
      const available=g.copies.filter(function(c){return (c.status||'available')==='available';}).length;
      const reservedMine=g.copies.find(function(c){return c.status==='reserved'&&c.reservedFor===auth.currentUser.uid;});
      const own=mineByKey.get(g.key);
      let tag='';
      let action='';
      if(available>0){
        tag='<span class="tag">'+available+' disponível'+(available>1?'is':'')+'</span>';
      }else if(reservedMine){
        tag='<span class="tag">Reservado para você</span>';
        action='<button class="btn green" onclick="go(\'borrow\');setTimeout(function(){memberLoadCopyForMode(\'borrow\',\''+esc(reservedMine.code||reservedMine.id)+'\');},0)">Retirar reserva</button>';
      }else if(own&&own.status==='waiting'){
        let wait=[];
        try{ wait=await waitingEntries(g.key); }catch(e){ console.warn('Não foi possível consultar a posição na fila.',e); }
        const pos=wait.findIndex(function(x){return x.memberId===auth.currentUser.uid;})+1;
        tag='<span class="tag">Na fila</span>';
        action='<div class="queue-position">Posição '+(pos>0?pos:'—')+'</div><button class="btn secondary" onclick="cancelWaitlist(\''+esc(g.key)+'\')">Sair da fila</button>';
      }else{
        tag='<span class="tag">Emprestado</span>';
        action='<button class="btn secondary" onclick="joinWaitlist(\''+esc(g.key)+'\')">Entrar na fila de espera</button>';
      }
      html.push('<div class="panel"><div class="item" style="border:0;padding:0"><div><b>'+esc(g.title)+'</b><small>'+esc(g.author)+'</small>'+(g.category?'<small><b>Assunto:</b> '+esc(g.category)+'</small>':'')+'<small>'+(g.shelf?'📍 Prateleira '+esc(g.shelf):'')+'</small></div>'+tag+'</div>'+action+'</div>');
    }
    list.innerHTML=html.join('');
  }catch(e){
    console.error(e);
    list.innerHTML='<div class="member-status error">Não foi possível carregar o catálogo real agora.</div>';
  }
}
window.renderCatalog=renderRealCatalog;

window.go=function(id){
  previousGo(id);
  if(id==='catalog')setTimeout(function(){renderRealCatalog();},40);
};

const input=document.getElementById('search');
if(input){
  input.placeholder='Título, autor ou assunto...';
  input.oninput=function(){renderRealCatalog();};
}

onAuthStateChanged(auth,function(){
  const active=document.querySelector('.screen.active')?.id;
  if(active==='catalog') setTimeout(renderRealCatalog,30);
});
