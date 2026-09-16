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
function friendlyError(error){
  const code = error?.code || '';
  if(code.includes('email-already-in-use')) return 'Este e-mail já possui cadastro. Tente entrar.';
  if(code.includes('invalid-email')) return 'Digite um e-mail válido.';
  if(code.includes('weak-password')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-mail ou senha incorretos.';
  if(code.includes('popup-closed-by-user')) return 'A janela do Google foi fechada antes de concluir o login.';
  if(code.includes('popup-blocked')) return 'O navegador bloqueou a janela de login. Tente novamente.';
  if(code.includes('unauthorized-domain')) return 'Este endereço ainda não está autorizado no Firebase Authentication.';
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
  account.innerHTML = `<div class="account-card"><b>${user.displayName || profile?.name || 'Usuário'}</b><small>${user.email || ''}<br>Perfil: ${roleLabel}</small></div>
    ${role === 'volunteer' || role === 'admin' ? '<button class="btn green" onclick="go(\'volunteer-home\')">Abrir Área do Voluntário</button>' : '<div class="notice">Seu cadastro está ativo como usuário da biblioteca. O acesso de voluntário depende de autorização de um administrador.</div>'}
    <button class="btn secondary" onclick="logoutFirebase()">Sair da conta</button>`;
  forms.style.display='none';
}

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
  if(['volunteer-home','isbn-scan','manual-book','today-books','labels','admin'].includes(id)){
    const role = currentProfile?.role;
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
