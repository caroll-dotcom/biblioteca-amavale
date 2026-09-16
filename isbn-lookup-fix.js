// Fallbacks adicionais para ISBNs que não aparecem nas consultas principais.
const nativeFetch = window.fetch.bind(window);

const supplementalCatalog = {
  '9786555603354': {
    title: 'A loja dos sonhos',
    author: 'Jojo Moyes',
    publisher: 'Intrínseca',
    publish_date: '2021',
    language: 'por',
    source: 'Editora Intrínseca (catálogo complementar)'
  }
};

const syntheticAuthors = new Map();
const sourceOverrides = new Map();

function normalizeCode(value=''){
  return String(value).toUpperCase().replace(/[^0-9X]/g,'');
}

function isbn13To10(isbn13){
  const s = normalizeCode(isbn13);
  if(!/^978\d{10}$/.test(s)) return '';
  const core = s.slice(3,12);
  let sum = 0;
  for(let i=0;i<9;i++) sum += Number(core[i]) * (10-i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

function jsonResponse(data){
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {'Content-Type':'application/json; charset=utf-8'}
  });
}

function syntheticAuthor(name=''){
  const clean = String(name || '').trim();
  if(!clean) return null;
  const id = 'AMAVALE_' + Array.from(clean).reduce((h,c)=>((h*31+c.charCodeAt(0))>>>0),7).toString(36).toUpperCase();
  syntheticAuthors.set(id, clean);
  return {key:`/authors/${id}`};
}

function supplementalAsEdition(isbn){
  const code = normalizeCode(isbn);
  const b = supplementalCatalog[code];
  if(!b) return null;
  sourceOverrides.set(code,b.source);
  const authorRef = syntheticAuthor(b.author);
  return {
    title:b.title,
    authors:authorRef ? [authorRef] : [],
    publishers:b.publisher ? [b.publisher] : [],
    publish_date:b.publish_date || '',
    languages:b.language ? [{key:`/languages/${b.language}`}] : [],
    covers:[]
  };
}

function applySourceOverride(){
  const codeEl=document.querySelector('.isbn-code');
  if(!codeEl) return;
  const isbn=normalizeCode(codeEl.textContent);
  const source=sourceOverrides.get(isbn);
  if(!source) return;
  const hint=codeEl.closest('.isbn-found')?.querySelector('.isbn-hint');
  if(!hint || !hint.textContent.includes('Fonte:') || hint.textContent.includes(source)) return;
  hint.textContent=hint.textContent.replace(/Fonte:[^.]+\./,`Fonte: ${source}.`);
}

new MutationObserver(applySourceOverride).observe(document.documentElement,{subtree:true,childList:true});

async function searchLegacyOpenLibrary(isbn){
  const candidates=[normalizeCode(isbn)];
  const isbn10=isbn13To10(isbn);
  if(isbn10) candidates.push(isbn10);

  for(const code of candidates){
    try{
      const url=`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent('ISBN:'+code)}&jscmd=data&format=json`;
      const res=await nativeFetch(url);
      if(!res.ok) continue;
      const data=await res.json();
      const b=data?.[`ISBN:${code}`];
      if(!b?.title) continue;
      const authors=(b.authors||[]).map(a=>syntheticAuthor(a?.name)).filter(Boolean);
      return {
        title:b.title || '',
        authors,
        publishers:(b.publishers||[]).map(p=>p?.name).filter(Boolean),
        publish_date:b.publish_date || '',
        languages:[],
        covers:[]
      };
    }catch(e){}
  }
  return null;
}

async function searchOpenLibrary(isbn){
  const candidates = [normalizeCode(isbn)];
  const isbn10 = isbn13To10(isbn);
  if(isbn10) candidates.push(isbn10);

  for(const code of candidates){
    try{
      const url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(code)}&fields=title,author_name,author_key,publisher,first_publish_year,publish_year,language,cover_i,isbn&limit=10`;
      const res = await nativeFetch(url);
      if(!res.ok) continue;
      const data = await res.json();
      const docs = Array.isArray(data.docs) ? data.docs : [];
      if(!docs.length) continue;

      const targetCodes = new Set(candidates.map(normalizeCode));
      const d = docs.find(item => (item.isbn || []).some(x => targetCodes.has(normalizeCode(x))));
      if(!d?.title) continue;

      const authorKeys = Array.isArray(d.author_key) ? d.author_key : [];
      const authorNames = Array.isArray(d.author_name) ? d.author_name : [];
      const authors = authorKeys.length
        ? authorKeys.map(k => ({key:`/authors/${k}`}))
        : authorNames.map(n=>syntheticAuthor(n)).filter(Boolean);
      const publishers = Array.isArray(d.publisher) ? d.publisher.filter(Boolean) : [];
      const years = Array.isArray(d.publish_year) ? d.publish_year.filter(Boolean) : [];
      const langs = Array.isArray(d.language) ? d.language.filter(Boolean) : [];

      return {
        title: d.title || '',
        authors,
        publishers,
        publish_date: String(years[0] || d.first_publish_year || ''),
        languages: langs.slice(0,1).map(l => ({key:`/languages/${l}`})),
        covers: d.cover_i ? [d.cover_i] : []
      };
    }catch(e){}
  }
  return null;
}

async function searchGoogleBooksFallback(isbn){
  const original = normalizeCode(isbn);
  const isbn10 = isbn13To10(original);
  const queries = [];
  if(isbn10) queries.push(`isbn:${isbn10}`);
  queries.push(`\"${original}\"`);
  if(isbn10) queries.push(`\"${isbn10}\"`);

  const accepted = new Set([original, isbn10].filter(Boolean));
  for(const q of queries){
    try{
      const res = await nativeFetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10`);
      if(!res.ok) continue;
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const exact = items.find(item => {
        const ids = item?.volumeInfo?.industryIdentifiers || [];
        return ids.some(id => accepted.has(normalizeCode(id.identifier)));
      });
      if(exact) return {kind:'books#volumes', totalItems:1, items:[exact]};
    }catch(e){}
  }
  return null;
}

window.fetch = async function(input, init){
  const url = typeof input === 'string' ? input : input?.url || '';

  const syntheticMatch=url.match(/^https:\/\/openlibrary\.org\/authors\/(AMAVALE_[A-Z0-9]+)\.json/i);
  if(syntheticMatch && syntheticAuthors.has(syntheticMatch[1])){
    return jsonResponse({name:syntheticAuthors.get(syntheticMatch[1])});
  }

  const response = await nativeFetch(input, init);

  try{
    const olMatch = url.match(/^https:\/\/openlibrary\.org\/isbn\/([^/?#]+)\.json/i);
    if(olMatch && !response.ok){
      const isbn=decodeURIComponent(olMatch[1]);

      const legacy=await searchLegacyOpenLibrary(isbn);
      if(legacy) return jsonResponse(legacy);

      const fallback = await searchOpenLibrary(isbn);
      if(fallback) return jsonResponse(fallback);

      const supplemental=supplementalAsEdition(isbn);
      if(supplemental) return jsonResponse(supplemental);

      return response;
    }

    if(url.startsWith('https://www.googleapis.com/books/v1/volumes')){
      const cloned = response.clone();
      let data = null;
      try{ data = await cloned.json(); }catch(e){}
      if(data?.items?.length) return response;

      const parsed = new URL(url);
      const q = parsed.searchParams.get('q') || '';
      const m = q.match(/isbn:([0-9Xx-]+)/);
      if(m){
        const fallback = await searchGoogleBooksFallback(m[1]);
        if(fallback) return jsonResponse(fallback);
      }
    }
  }catch(e){
    console.warn('Fallback ISBN falhou, mantendo resposta original.', e);
  }

  return response;
};
