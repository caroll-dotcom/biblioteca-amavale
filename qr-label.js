// Geração automática de QR e etiqueta térmica de teste (50 x 30 mm)
(function(){
  const QR_LIB='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
  let qrPromise=null;

  function esc(value=''){
    return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function loadQR(){
    if(window.QRCode) return Promise.resolve(window.QRCode);
    if(qrPromise) return qrPromise;
    qrPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=QR_LIB;
      s.onload=()=>window.QRCode ? resolve(window.QRCode) : reject(new Error('Biblioteca de QR indisponível'));
      s.onerror=()=>reject(new Error('Não foi possível carregar a biblioteca de QR'));
      document.head.appendChild(s);
    });
    return qrPromise;
  }

  function parseLabel(preview){
    const text=(preview.innerText||'').replace(/\s+/g,' ').trim();
    const code=(text.match(/AMA-\d{5,}/i)||[])[0]?.toUpperCase() || '';
    let shelf='', authorCode='';
    const loc=text.match(/\b([A-D]\d)\s*[·•\/-]\s*([A-ZÀ-Ý]{3,})\b/i);
    if(loc){ shelf=loc[1].toUpperCase(); authorCode=loc[2].toUpperCase(); }
    return {code,shelf,authorCode};
  }

  function copyUrl(code){
    return `${location.origin}${location.pathname}?copy=${encodeURIComponent(code)}`;
  }

  async function enhance(preview){
    if(!preview || preview.dataset.qrReady==='1') return;
    const data=parseLabel(preview);
    if(!data.code) return;
    preview.dataset.qrReady='1';

    const qrWrap=document.createElement('div');
    qrWrap.className='real-copy-qr';
    qrWrap.style.cssText='width:132px;height:132px;margin:12px auto;background:#fff;padding:5px;display:grid;place-items:center';
    preview.insertBefore(qrWrap,preview.firstChild);

    const caption=document.createElement('div');
    caption.className='qr-caption';
    caption.style.cssText='font-size:10px;color:#666;margin:6px 0 2px;text-align:center';
    caption.textContent='QR real do exemplar';
    qrWrap.after(caption);

    try{
      await loadQR();
      qrWrap.innerHTML='';
      new window.QRCode(qrWrap,{
        text:copyUrl(data.code),
        width:122,
        height:122,
        correctLevel:window.QRCode.CorrectLevel.M
      });
    }catch(e){
      qrWrap.innerHTML='<span style="font-size:11px;color:#a33;text-align:center">Não foi possível gerar o QR.</span>';
      return;
    }

    const panel=preview.closest('.panel');
    if(panel && !panel.querySelector('[data-print-copy-label]')){
      const btn=document.createElement('button');
      btn.className='btn primary';
      btn.dataset.printCopyLabel='1';
      btn.textContent='🏷️ Imprimir etiqueta de teste (50 × 30 mm)';
      btn.onclick=()=>printLabel(preview,data);
      const next=preview.nextElementSibling;
      if(next) panel.insertBefore(btn,next); else panel.appendChild(btn);
    }
  }

  function getQrDataUrl(preview){
    const canvas=preview.querySelector('.real-copy-qr canvas');
    if(canvas) return canvas.toDataURL('image/png');
    const img=preview.querySelector('.real-copy-qr img');
    return img?.src || '';
  }

  function printLabel(preview,data){
    const qr=getQrDataUrl(preview);
    if(!qr){ alert('Aguarde o QR Code aparecer antes de imprimir.'); return; }
    const target=copyUrl(data.code);
    const w=window.open('','_blank','width=520,height=420');
    if(!w){ alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.'); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.code)}</title><style>
      @page{size:50mm 30mm;margin:0}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;width:50mm;height:30mm;background:#fff;font-family:Arial,sans-serif;color:#111}
      .label{width:50mm;height:30mm;padding:2mm;display:grid;grid-template-columns:24mm 1fr;gap:2mm;align-items:center;overflow:hidden}
      .qr{width:23mm;height:23mm;object-fit:contain;display:block}
      .brand{font-size:7.5pt;font-weight:800;line-height:1.05;margin-bottom:2mm}
      .code{font-size:12pt;font-weight:900;line-height:1.05;margin-bottom:2mm}
      .loc{font-size:10pt;font-weight:800;line-height:1.1}
      .tiny{font-size:5.5pt;margin-top:1.5mm;color:#444;overflow-wrap:anywhere}
      @media screen{body{margin:20px auto;border:1px solid #bbb}}
    </style></head><body><div class="label">
      <img class="qr" src="${qr}" alt="QR ${esc(data.code)}">
      <div><div class="brand">BIBLIOTECA<br>AMAVALE</div><div class="code">${esc(data.code)}</div><div class="loc">${esc(data.shelf || '')}${data.shelf&&data.authorCode?' · ':''}${esc(data.authorCode || '')}</div><div class="tiny">${esc(target)}</div></div>
    </div><script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script></body></html>`);
    w.document.close();
  }

  function scan(){
    document.querySelectorAll('.label-preview').forEach(enhance);
  }

  const observer=new MutationObserver(scan);
  observer.observe(document.documentElement,{subtree:true,childList:true});
  scan();

  window.generateAmavaleCopyQR=function(code,element){
    return loadQR().then(()=>{
      const el=typeof element==='string'?document.querySelector(element):element;
      if(!el) throw new Error('Elemento de QR não encontrado');
      el.innerHTML='';
      return new window.QRCode(el,{text:copyUrl(code),width:122,height:122,correctLevel:window.QRCode.CorrectLevel.M});
    });
  };
})();