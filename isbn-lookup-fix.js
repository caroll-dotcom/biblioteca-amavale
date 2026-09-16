// Fallbacks adicionais para ISBNs que não aparecem no endpoint direto da Open Library.
const nativeFetch = window.fetch.bind(window);

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
      const exact = docs.find(d => (d.isbn || []).some(x => targetCodes.has(normalizeCode(x))));
      const d = exact || docs[0];
      if(!d?.title) continue;

      const authorKeys = Array.isArray(d.author_key) ? d.author_key : [];
      const publishers = Array.isArray(d.publisher) ? d.publisher.filter(Boolean) : [];
      const years = Array.isArray(d.publish_year) ? d.publish_year.filter(Boolean) : [];
      const langs = Array.isArray(d.language) ? d.language.filter(Boolean) : [];

      return {
        title: d.title || '',
        authors: authorKeys.map(k => ({key:`/authors/${k}`})),
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
  const response = await nativeFetch(input, init);

  try{
    const olMatch = url.match(/^https:\/\/openlibrary\.org\/isbn\/([^/?#]+)\.json/i);
    if(olMatch && !response.ok){
      const fallback = await searchOpenLibrary(decodeURIComponent(olMatch[1]));
      if(fallback) return jsonResponse(fallback);
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
