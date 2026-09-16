import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCpsABmAOMlUxEKFAFTk2IgzpYyOZfh5sw',
  authDomain: 'biblioteca-amavale.firebaseapp.com',
  projectId: 'biblioteca-amavale',
  storageBucket: 'biblioteca-amavale.firebasestorage.app',
  messagingSenderId: '415376174106',
  appId: '1:415376174106:web:a62cfd75d111b866eeb5a3'
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let scannerControls = null;
let scanning = false;
let currentISBN = '';
let currentMetadata = null;

const scannerStyle = document.createElement('style');
scannerStyle.textContent = `
.isbn-camera{width:100%;aspect-ratio:3/4;max-height:430px;background:#111;border-radius:18px;object-fit:cover;display:block}
.isbn-camera-wrap{position:relative;overflow:hidden;border-radius:18px;background:#111;margin-bottom:10px}
.isbn-guide{position:absolute;left:10%;right:10%;top:40%;height:28%;border:3px solid #a9c65a;border-radius:14px;pointer-events:none;box-shadow:0 0 0 999px rgba(0,0,0,.12)}
.isbn-guide:after{content:'Aponte para o código de barras do ISBN';position:absolute;left:0;right:0;bottom:-34px;text-align:center;color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 3px #000}
.isbn-loading{text-align:center;padding:18px;color:#666;font-size:13px}
.isbn-cover{width:70px;height:104px;border-radius:8px;object-fit:cover;background:#eee;border:1px solid #ddd}
.isbn-found{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:start;margin-bottom:12px}
.isbn-found.no-cover{grid-template-columns:1fr}
.isbn-hint{font-size:12px;color:#777;line-height:1.45;margin-top:7px}
.isbn-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#f1f0eb;padding:8px 10px;border-radius:10px;display:inline-block}
`;
document.head.appendChild(scannerStyle);

function $(id){ return document.getElementById(id); }
function normalizeISBN(value){ return String(value || '').toUpperCase().replace(/[^0-9X]/g,''); }
function isValidISBN13(isbn){
  if(!/^97[89]\d{10}$/.test(isbn)) return false;
  let sum=0;
  for(let i=0;i<12;i++) sum += Number(isbn[i]) * (i%2===0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}
function isValidISBN10(isbn){
  if(!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum=0;
  for(let i=0;i<10;i++) sum += (i===9 && isbn[i]==='X' ? 10 : Number(isbn[i])) * (10-i);
  return sum % 11 === 0;
}
function isValidISBN(isbn){ return isValidISBN13(isbn) || isValidISBN10(isbn); }
function escapeHtml(value=''){
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function languageName(key=''){
  const code = key.split('/').pop();
  return ({por:'Português',eng:'Inglês',spa:'Espanhol',fre:'Francês',fra:'Francês',ita:'Italiano',ger:'Alemão',deu:'Alemão'})[code] || code || '';
}
function authorCode(name=''){
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length-1] || 'AUT';
  return last.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase().padEnd(3,'X');
}
function setScannerStatus(text,type='notice'){
  const box = $('isbn-status');
  if(!box) return;
  box.className = type === 'error' ? 'auth-status show error' : type === 'ok' ? 'auth-status show ok' : 'notice';
  box.textContent = text;
}

function renderISBNScanner(){
  const section = $('isbn-scan');
  if(!section) return;
  section.innerHTML = `
    <button class="back" onclick="go('volunteer-home')">← Voltar</button>
    <h2 class="title">Cadastrar livro pelo ISBN</h2>
    <div class="panel">
      <p class="mini">Use a câmera do próprio celular para ler o código de barras do ISBN impresso no livro.</p>
      <div class="isbn-camera-wrap" id="isbn-camera-wrap" style="display:none">
        <video id="isbn-video" class="isbn-camera" playsinline muted></video>
        <div class="isbn-guide"></div>
      </div>
      <button class="btn primary" id="isbn-camera-btn" onclick="startISBNScanner()">📷 Abrir câmera e ler ISBN</button>
      <button class="btn secondary" id="isbn-stop-btn" style="display:none" onclick="stopISBNScanner()">Parar câmera</button>
      <div id="isbn-status" class="notice">Ao abrir a câmera, permita o acesso quando o navegador perguntar.</div>
    </div>
    <div id="isbn-result"></div>`;
}

function loadZXing(){
  return new Promise((resolve,reject)=>{
    if(window.ZXingBrowser) return resolve(window.ZXingBrowser);
    const existing = document.querySelector('script[data-zxing]');
    if(existing){ existing.addEventListener('load',()=>resolve(window.ZXingBrowser),{once:true}); existing.addEventListener('error',reject,{once:true}); return; }
    const script=document.createElement('script');
    script.src='https://unpkg.com/@zxing/browser@0.2.1';
    script.dataset.zxing='1';
    script.onload=()=>resolve(window.ZXingBrowser);
    script.onerror=()=>reject(new Error('Não foi possível carregar o leitor de código de barras.'));
    document.head.appendChild(script);
  });
}

window.stopISBNScanner = function(){
  try{ scannerControls?.stop(); }catch(e){}
  scannerControls=null;
  scanning=false;
  const video=$('isbn-video');
  if(video?.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; }
  if($('isbn-camera-wrap')) $('isbn-camera-wrap').style.display='none';
  if($('isbn-stop-btn')) $('isbn-stop-btn').style.display='none';
  if($('isbn-camera-btn')) $('isbn-camera-btn').style.display='block';
};

window.startISBNScanner = async function(){
  if(scanning) return;
  if(!auth.currentUser){ setScannerStatus('Entre na sua conta antes de cadastrar livros.','error'); return; }
  try{
    const profileSnap = await getDoc(doc(db,'users',auth.currentUser.uid));
    const role = profileSnap.exists() ? profileSnap.data().role : 'member';
    if(role !== 'volunteer' && role !== 'admin'){
      setScannerStatus('Sua conta não tem permissão de voluntário para cadastrar livros.','error');
      return;
    }
    scanning=true;
    setScannerStatus('Abrindo a câmera…');
    const ZXing = await loadZXing();
    $('isbn-camera-wrap').style.display='block';
    $('isbn-stop-btn').style.display='block';
    $('isbn-camera-btn').style.display='none';
    const video=$('isbn-video');
    const reader=new ZXing.BrowserMultiFormatReader();
    scannerControls = await reader.decodeFromConstraints(
      {audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},
      video,
      async (result,error,controls)=>{
        if(!result) return;
        const raw = result.getText ? result.getText() : String(result.text || result);
        const isbn = normalizeISBN(raw);
        if(!isValidISBN(isbn)){
          setScannerStatus(`Código lido: ${raw}. Ele não parece ser um ISBN válido. Aponte para o código que começa com 978 ou 979.`,'error');
          return;
        }
        controls.stop();
        scannerControls=null;
        scanning=false;
        if($('isbn-camera-wrap')) $('isbn-camera-wrap').style.display='none';
        if($('isbn-stop-btn')) $('isbn-stop-btn').style.display='none';
        if($('isbn-camera-btn')) $('isbn-camera-btn').style.display='block';
        await lookupISBN(isbn);
      }
    );
    setScannerStatus('Câmera ativa. Centralize o código de barras dentro do quadro verde.');
  }catch(error){
    scanning=false;
    window.stopISBNScanner();
    const denied = error?.name === 'NotAllowedError' || /permission/i.test(error?.message||'');
    setScannerStatus(denied ? 'A câmera foi bloqueada. Libere o acesso à câmera nas permissões do navegador e tente novamente.' : 'Não foi possível iniciar a câmera. Atualize a página e tente novamente.','error');
  }
};

async function fetchOpenLibrary(isbn){
  const res = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  if(!res.ok) return null;
  const data = await res.json();
  let author='';
  if(data.authors?.[0]?.key){
    try{
      const ar = await fetch(`https://openlibrary.org${data.authors[0].key}.json`);
      if(ar.ok) author=(await ar.json()).name || '';
    }catch(e){}
  }
  return {
    isbn,
    title:data.title || '',
    author,
    publisher:Array.isArray(data.publishers) ? (data.publishers[0] || '') : (data.publishers || ''),
    publishDate:data.publish_date || '',
    year:(String(data.publish_date||'').match(/\b(18|19|20)\d{2}\b/)||[])[0] || '',
    language:languageName(data.languages?.[0]?.key || ''),
    cover:data.covers?.[0] && data.covers[0] > 0 ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg` : '',
    source:'Open Library'
  };
}

async function fetchGoogleBooks(isbn){
  try{
    const res=await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`);
    if(!res.ok) return null;
    const data=await res.json();
    const v=data.items?.[0]?.volumeInfo;
    if(!v) return null;
    return {
      isbn,
      title:v.title || '',
      author:v.authors?.join(', ') || '',
      publisher:v.publisher || '',
      publishDate:v.publishedDate || '',
      year:(String(v.publishedDate||'').match(/\b(18|19|20)\d{2}\b/)||[])[0] || '',
      language:({pt:'Português',en:'Inglês',es:'Espanhol',fr:'Francês',it:'Italiano',de:'Alemão'})[v.language] || v.language || '',
      cover:v.imageLinks?.thumbnail?.replace('http:','https:') || '',
      source:'Google Books'
    };
  }catch(e){ return null; }
}

async function lookupISBN(isbn){
  currentISBN=isbn;
  const result=$('isbn-result');
  result.innerHTML='<div class="panel isbn-loading">ISBN lido: <b>'+escapeHtml(isbn)+'</b><br>Buscando os dados do livro…</div>';
  try{
    const existing=await getDoc(doc(db,'books',isbn));
    if(existing.exists()){
      currentMetadata={isbn,...existing.data(),source:'Acervo Amavale'};
      renderMetadataForm(currentMetadata,true);
      return;
    }
    let metadata=null;
    try{ metadata=await fetchOpenLibrary(isbn); }catch(e){}
    if(!metadata?.title){ metadata=await fetchGoogleBooks(isbn); }
    if(!metadata?.title){
      currentMetadata={isbn,title:'',author:'',publisher:'',publishDate:'',year:'',language:'',cover:'',source:'Cadastro manual'};
      renderMetadataForm(currentMetadata,false,true);
      return;
    }
    currentMetadata=metadata;
    renderMetadataForm(metadata,false,false);
  }catch(error){
    result.innerHTML='<div class="panel"><div class="auth-status show error">Não foi possível consultar o ISBN agora. Tente novamente ou faça o cadastro manual.</div></div>';
  }
}

function renderMetadataForm(data,duplicate=false,notFound=false){
  const result=$('isbn-result');
  const cover=data.cover ? `<img class="isbn-cover" src="${escapeHtml(data.cover)}" alt="Capa do livro">` : '';
  result.innerHTML=`<div class="panel">
    <div class="isbn-found ${cover?'':'no-cover'}">${cover}<div>
      <b>${duplicate ? '✓ Este título já existe no acervo' : notFound ? 'ISBN lido, mas os dados não foram encontrados' : '✓ Livro encontrado automaticamente'}</b>
      <div class="isbn-hint">${duplicate ? 'Você pode cadastrar outro exemplar físico usando os mesmos dados.' : notFound ? 'Preencha os dados abaixo para continuar.' : 'Confira os dados antes de salvar. Fonte: '+escapeHtml(data.source||'consulta ISBN')+'.'}</div>
      <div class="isbn-code">ISBN ${escapeHtml(data.isbn)}</div>
    </div></div>
    <span class="label">Título</span><input class="field" id="isbn-title" value="${escapeHtml(data.title||'')}">
    <span class="label">Autor</span><input class="field" id="isbn-author" value="${escapeHtml(data.author||'')}">
    <span class="label">Editora</span><input class="field" id="isbn-publisher" value="${escapeHtml(data.publisher||'')}">
    <span class="label">Ano / data da edição</span><input class="field" id="isbn-year" value="${escapeHtml(data.publishDate||data.year||'')}">
    <span class="label">Idioma</span><input class="field" id="isbn-language" value="${escapeHtml(data.language||'')}">
    <span class="label">Categoria</span>
    <select class="field" id="isbn-category"><option value="">Selecione</option><option>Literatura brasileira</option><option>Literatura estrangeira</option><option>Contos e crônicas</option><option>Poesia</option><option>História do Brasil</option><option>História geral</option><option>Sociedade</option><option>Natureza e meio ambiente</option><option>Arte</option><option>Infantil</option><option>Juvenil</option><option>Outros</option></select>
    <span class="label">Prateleira</span>
    <select class="field" id="isbn-shelf"><option value="">Selecione</option><option>A1</option><option>A2</option><option>A3</option><option>A4</option><option>B1</option><option>B2</option><option>C1</option><option>C2</option><option>D1</option><option>D2</option></select>
    <div id="isbn-save-status"></div>
    <button class="btn green" onclick="saveScannedBook()">${duplicate ? 'CADASTRAR OUTRO EXEMPLAR' : 'CADASTRAR EXEMPLAR'}</button>
    <button class="btn secondary" onclick="startISBNScanner()">Ler outro ISBN</button>
  </div>`;
}

async function nextCopyCode(){
  const snap=await getDocs(collection(db,'copies'));
  let max=0;
  snap.forEach(d=>{
    const code=String(d.data().code || d.id || '');
    const m=code.match(/^AMA-(\d+)$/);
    if(m) max=Math.max(max,Number(m[1]));
  });
  return `AMA-${String(max+1).padStart(5,'0')}`;
}

window.saveScannedBook = async function(){
  const status=$('isbn-save-status');
  const show=(text,type='ok')=>{ if(status) status.innerHTML=`<div class="auth-status show ${type}">${escapeHtml(text)}</div>`; };
  if(!auth.currentUser){ show('Entre novamente antes de salvar.','error'); return; }
  const profileSnap=await getDoc(doc(db,'users',auth.currentUser.uid));
  const role=profileSnap.exists()?profileSnap.data().role:'member';
  if(role!=='volunteer' && role!=='admin'){ show('Sua conta não tem permissão para cadastrar livros.','error'); return; }
  const title=$('isbn-title')?.value.trim();
  const author=$('isbn-author')?.value.trim();
  const publisher=$('isbn-publisher')?.value.trim();
  const publishDate=$('isbn-year')?.value.trim();
  const language=$('isbn-language')?.value.trim();
  const category=$('isbn-category')?.value;
  const shelf=$('isbn-shelf')?.value;
  if(!title || !author || !category || !shelf){ show('Confira título e autor e selecione categoria e prateleira.','error'); return; }
  try{
    show('Salvando no acervo…','ok');
    const code=await nextCopyCode();
    const year=(publishDate.match(/\b(18|19|20)\d{2}\b/)||[])[0] || '';
    await setDoc(doc(db,'books',currentISBN),{
      isbn:currentISBN,title,author,publisher,publishDate,year,language,
      cover:currentMetadata?.cover || '',
      metadataSource:currentMetadata?.source || 'manual',
      updatedAt:serverTimestamp()
    },{merge:true});
    await setDoc(doc(db,'copies',code),{
      code,isbn:currentISBN,title,author,category,shelf,
      authorCode:authorCode(author),status:'available',
      createdBy:auth.currentUser.uid,createdAt:serverTimestamp()
    });
    $('isbn-result').innerHTML=`<div class="panel success"><div class="check">✓</div><h3>Livro cadastrado no Firestore</h3><p><b>${escapeHtml(title)}</b><br>${escapeHtml(author)}</p><div class="label-preview"><b>BIBLIOTECA AMAVALE</b><br><br><b style="font-size:20px">${escapeHtml(code)}</b><br>${escapeHtml(shelf)} · ${escapeHtml(authorCode(author))}</div><div class="notice">ISBN ${escapeHtml(currentISBN)}<br>Status: disponível</div><button class="btn primary" onclick="startISBNScanner()">Cadastrar próximo livro</button><button class="btn secondary" onclick="go('volunteer-home')">Voltar à Área do Voluntário</button></div>`;
  }catch(error){
    console.error(error);
    show(error?.code==='permission-denied' ? 'O Firestore bloqueou a gravação. Verifique as regras de segurança.' : 'Não foi possível salvar o livro no banco de dados.','error');
  }
};

const previousGo=window.go;
window.go=function(id){
  if(id!=='isbn-scan') window.stopISBNScanner();
  previousGo(id);
  if(id==='isbn-scan') setTimeout(renderISBNScanner,0);
};

// Prepara a tela sem abrir a câmera automaticamente.
renderISBNScanner();
