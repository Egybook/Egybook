/* EgyBook Moments module: image + music discovery rail only. */
// EgyBook Moments: derive cards from already-authorized, rendered feed posts.
(function initEgyBookMoments(){
  const strip=document.getElementById('momentsStrip'), section=document.getElementById('momentsSection');
  if(!strip||!section)return;
  const isPublicPost=post=>['الجميع','عام','public','everyone','all'].includes(String(post.dataset.visibility||'').trim().toLowerCase());
  function refreshMoments(){
    const source=document.getElementById('postsList'); if(!source)return;
    const candidates=Array.from(source.querySelectorAll('.post')).filter(post=>post.dataset.mediaType==='image'&&post.dataset.musicTrackId&&isPublicPost(post)&&post.querySelector('img.post-image')&&(post.querySelector('img.post-image').currentSrc||post.querySelector('img.post-image').src)).slice(0,24);
    const ids=candidates.map(p=>String(p.dataset.postId||''));
    const old=Array.from(strip.querySelectorAll('[data-moment-post]')).map(el=>el.dataset.momentPost);
    if(ids.length===old.length&&ids.every(id=>old.includes(id)))return;
    strip.replaceChildren();
    if(!candidates.length){const empty=document.createElement('div');empty.className='moments-loading';empty.textContent='لسه مفيش صور عامة مرفقة بموسيقى. أول Moment ممكن يكون بتاعك 🎵';strip.append(empty);return;}
    candidates.forEach(post=>{const img=post.querySelector('img.post-image'),author=post.querySelector('.author-name')?.textContent?.trim()||'عضو EgyBook';const tile=document.createElement('button');tile.type='button';tile.className='moment-tile';tile.dataset.momentPost=String(post.dataset.postId||'');tile.setAttribute('aria-label',`افتح Moment لـ ${author}`);const image=document.createElement('img');image.src=img.currentSrc||img.src;image.alt='';image.loading='lazy';image.decoding='async';const note=document.createElement('span');note.className='moment-note';note.textContent='♫';const name=document.createElement('span');name.className='moment-owner';name.textContent=author;tile.append(image,note,name);strip.append(tile);});
  }
  strip.addEventListener('click',event=>{const tile=event.target.closest('[data-moment-post]');if(!tile)return;const post=Array.from(document.querySelectorAll('#postsList .post')).find(item=>String(item.dataset.postId)===tile.dataset.momentPost);if(post&&typeof openPostImageViewer==='function')openPostImageViewer(post);});
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="moments-scroll"],[data-action="moments-view-all"]'))section.scrollIntoView({behavior:'smooth',block:'center'});});
  const source=document.getElementById('postsList');if(source)new MutationObserver(refreshMoments).observe(source,{childList:true,subtree:true});refreshMoments();window.addEventListener('load',refreshMoments,{once:true});
})();
