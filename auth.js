import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

let currentProfile = null;
const originalGo = window.go;

const style = document.createElement('style');
style.textContent = `
.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.auth-tab{border:1px solid var(--line);background:#fff;border-radius:12px;padding:11px;font-weight:800}
.auth-tab.active{background:#202020;color:#fff;border-color:#202020}
.auth-status{margin-top:10px;padding:11px;border-radius:12px;font-size:12px;line-height:1.45;display:none}
.auth-status.show{display:block}.auth-status.ok{background:#eef3df;color:#425020}.auth-status.error{background:#f8e8e4;color:#7a3025}
.google-btn{display:flex;align-items:center;justify-content:center;gap:8px}
.account-card{background:#f7f8f2;border:1px solid #dfe7c8;border-radius:16px;padding:14px;margin-bottom:12px}
.account-card b{display:block;margin-bottom:4px}.account-card small{color:var(--muted)}
.admin-user{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:10px}
.admin-user-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.admin-user-name{font-weight:800}.admin-user-meta{font-size:12px;color:var(--muted);line-height:1.45;margin-top:4px;word-break:break-word}
.role-badge{font-size:10px;font-weight:800;padding:6px 9px;border-radius:999px;background:#eef2e4;white-space:nowrap}
.admin-actions{display:grid;grid-template-columns:1fr;gap:7px;margin-top:10px}
.admin-actions button{margin-top:0}
.admin-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.admin-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;text-align:center}
.admin-kpi b{display:block;font-size:22px}.admin-kpi span{font-size:10px;color:var(--muted)}
`;
document.head.appendChild(style);

function el(id){ return document.getElementById(id); }
function message(text, type='error'){
  const box = el('auth-message');
  if(!box) return;
  box.textContent = text;
  box.className = `auth-status show ${type}`;
}
function clearMessage(){
  const box = el('auth-message');
  if(box){ box.textContent=''; box.className='auth-status'; }
}
function adminMessage(text, type='ok'){
  const box = el('admin-status');
  if(!box) return;
  box.textContent = text;
  box.className = `auth-status show ${type}`;
}
function friendlyError(error){
  const code = error?.code || '';
  if(code.includes('email-already-in-use')) return 'Este e-mail já possui cadastro. Tente entrar.';
  if(code.includes('invalid-email')) return 'Digite um e-mail válido.';
  if(code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha incorretos.';
  if(code.includes('popup-closed-by-user')) return 'A janela do Google foi fechada antes de concluir o login.';
  if(code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login. Tente novamente.';
  if(code.includes('unauthorized-domain')) return 'Este endereço ainda não está autorizado no Firebase Authentication.';
  if(code.includes('permission-denied')) return 'Sua conta não tem permissão para realizar esta ação.';
  return 'Não foi possível concluir agora. Tente novamente.';
}

async function ensureUserProfile(user, extra={}){
  const ref = doc(db,'users',user.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{
      name: extra.name || user.displayName || '',
      email: user.email || '',
      phone: extra.phone || '',
      role: 'member',
      provider: user.providerData?.[0]?.providerId || 'password',
      createdAt: serverTimestamp()
    });
  }
  const fresh = await getDoc(ref);
  return fresh.exists() ? {uid:user.uid, ...fresh.data()} : {uid:user.uid, role:'member'};
}

function renderAuthScreen(){
  const section = el('volunteer-login');
  if(!section) return;
  section.innerHTML = `
    <button class="back" onclick="go('home')">← Voltar</button>
    <h2 class="title">Entrar na Biblioteca</h2>
    <div id="logged-account"></div>
    <div id="auth-forms">
      <div class="auth-tabs">
        <button class="auth-tab active" id="tab-login" onclick="showAuthMode('login')">Entrar</button>
        <button class="auth-tab" id="tab-register" onclick="showAuthMode('register')">Criar conta</button>
      </div>
      <div class="panel" id="login-form">
        <span class="label">E-mail</span>
        <input class="field" id="login-email" type="email" autocomplete="email" placeholder="seu@email.com">
        <span class="label">Senha</span>
        <input class="field" id="login-password" type="password" autocomplete="current-password" placeholder="Sua senha">
        <button class="btn primary" onclick="loginWithEmail()">Entrar</button>
        <button class="btn outline google-btn" onclick="loginWithGoogle()">Continuar com Google</button>
      </div>
      <div class="panel" id="register-form" style="display:none">
        <span class="label">Nome</span>
        <input class="field" id="register-name" autocomplete="name" placeholder="Nome completo">
        <span class="label">E-mail</span>
        <input class="field" id="register-email" type="email" autocomplete="email" placeholder="seu@email.com">
        <span class="label">Telefone</span>
        <input class="field" id="register-phone" type="tel" autocomplete="tel" placeholder="(24) 99999-9999">
        <span class="label">Senha</span>
        <input class="field" id="register-password" type="password" autocomplete="new-password" placeholder="Mínimo de 6 caracteres">
        <span class="label">Confirmar senha</span>
        <input class="field" id="register-confirm" type="password" autocomplete="new-password" placeholder="Repita a senha">
        <button class="btn green" onclick="registerMember()">Criar cadastro</button>
        <button class="btn outline google-btn" onclick="loginWithGoogle()">Cadastrar / entrar com Google</button>
        <div class="notice">Todo novo cadastro entra como usuário da biblioteca. O acesso de voluntário ou administrador só pode ser autorizado depois.</div>
      </div>
      <div id="auth-message" class="auth-status"></div>
    </div>`;
  updateAuthUI(auth.currentUser, currentProfile);
}

function updateAuthUI(user, profile){
  const top = document.querySelector('.vol-link');
  if(top){
    top.textContent = user ? (user.displayName?.split(' ')[0] || 'Minha conta') : 'Entrar';
    top.onclick = () => originalGo('volunteer-login');
  }
  const account = el('logged-account');
  const forms = el('auth-forms');
  if(!account || !forms) return;
  if(!user){
    account.innerHTML='';
    forms.style.display='block';
    return;
  }
  const role = profile?.role || 'member';
  const roleLabel = role === 'admin' ? 'Administrador' : role === 'volunteer' ? 'Voluntário' : 'Usuário da biblioteca';
  const staffButton = role === 'volunteer' || role === 'admin'
    ? '<button class="btn green" onclick="go(\'volunteer-home\')">Abrir Área do Voluntário</button>'
    : '<div class="notice">Seu cadastro está ativo como usuário da biblioteca.</div>';
  const adminButton = role === 'admin'
    ? '<button class="btn primary" onclick="go(\'admin\')">Gerenciar usuários e voluntários</button>'
    : '';
  account.innerHTML = `<div class="account-card"><b>${user.displayName || profile?.name || 'Usuário'}</b><small>${user.email || ''}<br>Perfil: ${roleLabel}</small></div>
    ${adminButton}
    ${staffButton}
    <button class="btn secondary" onclick="logoutFirebase()">Sair da conta</button>`;
  forms.style.display='none';
}

async function renderAdminPanel(){
  const section = el('admin');
  if(!section) return;
  section.innerHTML = `
    <button class="back" onclick="go('volunteer-login')">← Minha conta</button>
    <h2 class="title">Área Administrativa</h2>
    <div class="panel"><b>Usuários e voluntários</b><p class="mini">Autorize ou revogue o acesso de voluntário sem precisar entrar no Firebase.</p></div>
    <div id="admin-summary"></div>
    <div id="admin-status" class="auth-status"></div>
    <div id="admin-users"><div class="panel">Carregando usuários...</div></div>`;
  try{
    const snap = await getDocs(collection(db,'users'));
    const users = snap.docs.map(d => ({uid:d.id, ...d.data()})).sort((a,b)=>(a.name||a.email||'').localeCompare(b.name||b.email||'', 'pt-BR'));
    const members = users.filter(u=>u.role==='member').length;
    const volunteers = users.filter(u=>u.role==='volunteer').length;
    const admins = users.filter(u=>u.role==='admin').length;
    el('admin-summary').innerHTML = `<div class="admin-summary"><div class="admin-kpi"><b>${members}</b><span>Usuários</span></div><div class="admin-kpi"><b>${volunteers}</b><span>Voluntários</span></div><div class="admin-kpi"><b>${admins}</b><span>Admins</span></div></div>`;
    el('admin-users').innerHTML = users.length ? users.map(u=>{
      const role = u.role || 'member';
      const label = role === 'admin' ? 'Admin' : role === 'volunteer' ? 'Voluntário' : 'Usuário';
      const isSelf = u.uid === auth.currentUser?.uid;
      let actions = '';
      if(role === 'member') actions = `<button class="btn green" onclick="changeUserRole('${u.uid}','volunteer')">Autorizar como voluntário</button>`;
      if(role === 'volunteer') actions = `<button class="btn secondary" onclick="changeUserRole('${u.uid}','member')">Revogar acesso de voluntário</button>`;
      if(role === 'admin') actions = `<div class="notice">Conta administrativa${isSelf ? ' (você)' : ''}.</div>`;
      return `<div class="admin-user"><div class="admin-user-head"><div><div class="admin-user-name">${u.name || 'Sem nome'}</div><div class="admin-user-meta">${u.email || ''}${u.phone ? '<br>'+u.phone : ''}</div></div><span class="role-badge">${label}</span></div><div class="admin-actions">${actions}</div></div>`;
    }).join('') : '<div class="panel">Nenhum usuário cadastrado.</div>';
  }catch(error){
    el('admin-users').innerHTML = `<div class="panel">${friendlyError(error)}</div>`;
  }
}

window.changeUserRole = async function(uid,newRole){
  if(currentProfile?.role !== 'admin') return;
  if(uid === auth.currentUser?.uid){ adminMessage('Sua própria conta administrativa não pode ser alterada por esta tela.','error'); return; }
  try{
    await updateDoc(doc(db,'users',uid),{role:newRole});
    adminMessage(newRole === 'volunteer' ? 'Voluntário autorizado com sucesso.' : 'Acesso de voluntário revogado.','ok');
    await renderAdminPanel();
  }catch(error){ adminMessage(friendlyError(error),'error'); }
};

window.showAuthMode = function(mode){
  clearMessage();
  const login = el('login-form');
  const register = el('register-form');
  if(!login || !register) return;
  login.style.display = mode === 'login' ? 'block' : 'none';
  register.style.display = mode === 'register' ? 'block' : 'none';
  el('tab-login')?.classList.toggle('active', mode==='login');
  el('tab-register')?.classList.toggle('active', mode==='register');
};

window.registerMember = async function(){
  clearMessage();
  const name = el('register-name')?.value.trim();
  const email = el('register-email')?.value.trim();
  const phone = el('register-phone')?.value.trim();
  const password = el('register-password')?.value || '';
  const confirm = el('register-confirm')?.value || '';
  if(!name || !email || !phone || !password){ message('Preencha nome, e-mail, telefone e senha.'); return; }
  if(password !== confirm){ message('As duas senhas precisam ser iguais.'); return; }
  try{
    const credential = await createUserWithEmailAndPassword(auth,email,password);
    await updateProfile(credential.user,{displayName:name});
    currentProfile = await ensureUserProfile(credential.user,{name,phone});
    updateAuthUI(credential.user,currentProfile);
    message('Cadastro criado com sucesso.','ok');
  }catch(error){ message(friendlyError(error)); }
};

window.loginWithEmail = async function(){
  clearMessage();
  const email = el('login-email')?.value.trim();
  const password = el('login-password')?.value || '';
  if(!email || !password){ message('Digite seu e-mail e sua senha.'); return; }
  try{
    const credential = await signInWithEmailAndPassword(auth,email,password);
    currentProfile = await ensureUserProfile(credential.user);
    updateAuthUI(credential.user,currentProfile);
  }catch(error){ message(friendlyError(error)); }
};

window.loginWithGoogle = async function(){
  clearMessage();
  try{
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if(mobile){
      await signInWithRedirect(auth,googleProvider);
    }else{
      const result = await signInWithPopup(auth,googleProvider);
      currentProfile = await ensureUserProfile(result.user);
      updateAuthUI(result.user,currentProfile);
    }
  }catch(error){ message(friendlyError(error)); }
};

window.logoutFirebase = async function(){
  await signOut(auth);
  currentProfile = null;
  originalGo('home');
};

window.go = function(id){
  const role = currentProfile?.role;
  const volunteerScreens = ['volunteer-home','isbn-scan','manual-book','today-books','labels'];
  if(volunteerScreens.includes(id)){
    if(!auth.currentUser){
      originalGo('volunteer-login');
      setTimeout(()=>message('Entre na sua conta para acessar esta área.'),0);
      return;
    }
    if(role !== 'volunteer' && role !== 'admin'){
      originalGo('volunteer-login');
      return;
    }
  }
  if(id === 'admin'){
    if(!auth.currentUser || role !== 'admin'){
      originalGo('volunteer-login');
      return;
    }
    originalGo('admin');
    renderAdminPanel();
    return;
  }
  originalGo(id);
};

renderAuthScreen();

try{
  const redirected = await getRedirectResult(auth);
  if(redirected?.user){ currentProfile = await ensureUserProfile(redirected.user); }
}catch(error){
  setTimeout(()=>message(friendlyError(error)),0);
}

onAuthStateChanged(auth, async user => {
  if(user){
    try{ currentProfile = await ensureUserProfile(user); }
    catch(e){ currentProfile = {uid:user.uid, role:'member'}; }
  }else{
    currentProfile = null;
  }
  updateAuthUI(user,currentProfile);
});
