import { getApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const auth = getAuth(getApp());
const provider = new GoogleAuthProvider();

function showAuthError(text){
  const box = document.getElementById('auth-message');
  if(!box) return;
  box.textContent = text;
  box.className = 'auth-status show error';
}

window.loginWithGoogle = async function(){
  const box = document.getElementById('auth-message');
  if(box){ box.textContent=''; box.className='auth-status'; }
  try{
    await signInWithPopup(auth, provider);
  }catch(error){
    const code = error?.code || '';
    if(code.includes('popup-blocked')){
      showAuthError('O navegador bloqueou a janela de login do Google. No iPhone, permita pop-ups para este site e tente novamente.');
      return;
    }
    if(code.includes('popup-closed-by-user')){
      showAuthError('A janela do Google foi fechada antes de concluir o login.');
      return;
    }
    if(code.includes('unauthorized-domain')){
      showAuthError('Este endereço ainda não está autorizado no Firebase Authentication.');
      return;
    }
    showAuthError('Não foi possível entrar com Google neste aparelho. Tente novamente ou use e-mail e senha.');
  }
};
