/* EgyBook Moments: image + music only. Isolated UI module. */
(()=>{
  'use strict';
  const strip=document.getElementById('momentsStrip');
  const section=document.getElementById('momentsSection');
  if(!strip||!section)return;
  const norm=v=>String(v||'').trim().toLowerCase();
  const isAllowedVisibility=(post)=>{
    const v=norm(post.dataset.visibility);
    // The feed has already applied Supabase/RLS visibility. Never expose private posts
    // belonging to another user in the Moments rail.
    const ownerId=post.dataset.userId||post.dataset.authorId||'';
    const own=!!(window.__egybookCurrentUserId&&ownerId&&ownerId===window.__egybookCurrentUserId);
    if(['أنا فقط','خاص','private','only me','me'].includes(v))return own;
    return ['الأصدقاء','friends','عام','العامة','public','الجميع','everyone','all','followers','المتابعون'].includes(v);
  };
  const hasMusic=post=>!!(post.dataset.musicTrackId||post.dataset.audioSourcePostId||post.querySelector('[data-post-music-player][data-track-id]'));
  const getItems=()=>Array.from(document.querySelectorAll('#postsList .post')).filter(post=>{
    if(post.dataset.mediaType!=='image'||!hasMusic(post)||!isAllowedVisibility(post))return false;
    const img=post.querySelector('img.post-image');
    return !!(img&&(img.currentSrc||img.src));
  }).slice(0,30);
  function render(){
    const posts=getItems();
    const previous=Array.from(strip.querySelectorAll('[data-moment-post]')).map(x=>x.dataset.momentPost);
    const ids=posts.map(x=>String(x.dataset.postId||''));
    if(ids.length===previous.length&&ids.every((id,i)=>id===previous[i]))return;
    strip.replaceChildren();
    if(!posts.length){const empty=document.createElement('div');empty.className='moments-loading';empty.textContent='لسه مفيش صور مرفقة بأغاني متاحة ليك 🎵';strip.append(empty);return;}
    posts.forEach(post=>{
      const img=post.querySelector('img.post-image');
      const tile=document.createElement('button');tile.type='button';tile.className='moment-tile';tile.dataset.momentPost=String(post.dataset.postId||'');
      tile.setAttribute('aria-label',`افتح Moment لـ ${post.querySelector('.author-name')?.textContent?.trim()||'عضو EgyBook'}`);
      const image=document.createElement('img');image.src=img.currentSrc||img.src;image.alt='';image.loading='lazy';image.decoding='async';
      const note=document.createElement('span');note.className='moment-note';note.textContent='♫';
      const wave=document.createElement('span');wave.className='moment-wave';wave.setAttribute('aria-hidden','true');for(let i=0;i<5;i++)wave.append(document.createElement('i'));
      const name=document.createElement('span');name.className='moment-owner';name.textContent=post.querySelector('.author-name')?.textContent?.trim()||'عضو EgyBook';
      tile.append(image,note,wave,name);strip.append(tile);
    });
  }
  strip.addEventListener('click',event=>{
    const tile=event.target.closest('[data-moment-post]');if(!tile)return;
    const post=Array.from(document.querySelectorAll('#postsList .post')).find(x=>String(x.dataset.postId||'')===tile.dataset.momentPost);
    const image=post?.querySelector('img.post-image');
    if(!post||!image)return;
    if(typeof window.__egybookOpenMoment==='function')window.__egybookOpenMoment(post,image);
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="moments-scroll"],[data-action="moments-view-all"]'))section.scrollIntoView({behavior:'smooth',block:'center'});});
  const source=document.getElementById('postsList');if(source)new MutationObserver(render).observe(source,{childList:true,subtree:true});
  render();window.addEventListener('load',render,{once:true});
})();
