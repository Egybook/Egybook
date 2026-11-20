/* EgyBook Reels Comments module. Owns the Reels-only comment UI and API calls. */
(() => {
  'use strict';
  if (window.__egybookReelsCommentsInstalled) return;
  window.__egybookReelsCommentsInstalled = true;
  const WORKER = 'https://egybook-reels-api.hossam-hamaki2015-hh.workers.dev';
  const $ = (s, r=document) => r.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { postId:'', reelId:null, user:null, comments:[], offset:0, hasMore:false, sort:'recent', parentId:null, loading:false, viewportCleanup:null };
  function syncKeyboardViewport(panel){
    const vv=window.visualViewport;
    const update=()=>{
      const viewportHeight=vv?.height ?? window.innerHeight;
      const viewportTop=vv?.offsetTop ?? 0;
      const keyboardInset=Math.max(0,Math.round(window.innerHeight-(viewportHeight+viewportTop)));
      panel.style.setProperty('--ebrc-keyboard-inset',`${keyboardInset}px`);
      panel.style.setProperty('--ebrc-available-height',`${Math.max(180,Math.round(viewportHeight))}px`);
      panel.classList.toggle('ebrc-keyboard-open',keyboardInset>100);
    };
    update();
    vv?.addEventListener('resize',update);vv?.addEventListener('scroll',update);
    window.addEventListener('resize',update);
    return ()=>{vv?.removeEventListener('resize',update);vv?.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
  }
  function focusComposer(panel){
    const input=$('#ebrc-input',panel);if(!input)return;
    requestAnimationFrame(()=>{
      try{input.focus({preventScroll:true});}catch(_){input.focus();}
      const end=input.value.length;try{input.setSelectionRange(end,end);}catch(_){}
    });
  }
  const supabase = () => window.__egybookSupabaseClient;
  async function auth(){
    const client=supabase(); if(!client) throw new Error('تعذر الاتصال بحسابك.');
    const {data,error}=await client.auth.getSession(); if(error) throw error;
    const session=data?.session; if(!session?.access_token||!session.user?.id) throw new Error('سجّل الدخول أولاً.');
    state.user=session.user; return session;
  }
  async function api(path, options={}){
    const session=await auth();
    const response=await fetch(WORKER+path,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,...(options.headers||{})}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||'تعذر تنفيذ العملية.');
    return payload;
  }
  function ensurePanel(){
    let panel=$('#ebReelsComments'); if(panel) return panel;
    panel=document.createElement('section'); panel.id='ebReelsComments'; panel.className='eb-reels-comments'; panel.hidden=true;
    panel.innerHTML=`<div class="ebrc-backdrop" data-ebrc-close></div><div class="ebrc-sheet" role="dialog" aria-modal="true" aria-label="تعليقات الريل"><header><strong>التعليقات</strong><button type="button" data-ebrc-close aria-label="إغلاق">×</button></header><div class="ebrc-toolbar"><span id="ebrc-count">التعليقات</span><select id="ebrc-sort" aria-label="ترتيب التعليقات"><option value="recent">الأحدث</option><option value="relevant">الأكثر صلة</option></select></div><div id="ebrc-list" class="ebrc-list" aria-live="polite"></div><button id="ebrc-more" class="ebrc-more" type="button" hidden>عرض المزيد</button><div id="ebrc-replying" class="ebrc-replying" hidden></div><form id="ebrc-form"><textarea id="ebrc-input" maxlength="2000" placeholder="اكتب تعليقك..." required></textarea><button type="submit">نشر</button></form><p id="ebrc-status" role="status"></p></div>`;
    document.body.append(panel);
    state.viewportCleanup?.();state.viewportCleanup=syncKeyboardViewport(panel);
    panel.addEventListener('click', async e=>{
      const close=e.target.closest('[data-ebrc-close]'); if(close){panel.hidden=true;state.parentId=null;panel.classList.remove('ebrc-keyboard-open');panel.style.setProperty('--ebrc-keyboard-inset','0px');return;}
      const action=e.target.closest('[data-ebrc-action]'); if(!action)return;
      const id=action.dataset.id, kind=action.dataset.ebrcAction;
      try{
        if(kind==='reply'){state.parentId=id;const replyBar=$('#ebrc-replying',panel);replyBar.hidden=false;replyBar.textContent='الرد على التعليق — إلغاء';$('#ebrc-input',panel).placeholder='اكتب ردك...';focusComposer(panel);}
        if(kind==='cancel-reply'){state.parentId=null;$('#ebrc-replying').hidden=true;$('#ebrc-input').placeholder='اكتب تعليقك...';}
        if(kind==='react'){await api(`/reels/${state.reelId}/comments/${id}/reactions`,{method:'POST',body:JSON.stringify({reaction:'❤️'})});await load(true);}
        if(kind==='edit'){const item=find(id);const text=prompt('تعديل التعليق',item?.comment_text||'');if(text?.trim()){await api(`/reels/${state.reelId}/comments/${id}`,{method:'PATCH',body:JSON.stringify({comment_text:text.trim()})});await load(true);}}
        if(kind==='delete'){if(confirm('حذف التعليق؟')){await api(`/reels/${state.reelId}/comments/${id}`,{method:'DELETE'});await load(true);}}
      }catch(err){status(err.message);}
    });
    $('#ebrc-replying',panel).addEventListener('click',()=>{state.parentId=null;$('#ebrc-replying').hidden=true;$('#ebrc-input').placeholder='اكتب تعليقك...';});
    $('#ebrc-form',panel).addEventListener('submit',async e=>{e.preventDefault();const input=$('#ebrc-input');const text=input.value.trim();if(!text)return;const button=e.submitter;button.disabled=true;try{await api(`/reels/${state.reelId}/comments`,{method:'POST',body:JSON.stringify({comment_text:text,parent_comment_id:state.parentId})});input.value='';state.parentId=null;$('#ebrc-replying').hidden=true;input.placeholder='اكتب تعليقك...';await load(true);}catch(err){status(err.message);}finally{button.disabled=false;}});
    $('#ebrc-sort',panel).addEventListener('change',e=>{state.sort=e.target.value;load(true);});
    $('#ebrc-more',panel).addEventListener('click',()=>load(false));
    return panel;
  }
  function status(message){const el=$('#ebrc-status');if(el)el.textContent=message||'';}
  function find(id){return state.comments.find(c=>String(c.id)===String(id));}
  async function resolveReel(detail){
    const post=detail.post; let videoUrl=detail.videoUrl||'';
    if(!videoUrl){const video=post?.querySelector('video');videoUrl=video?.currentSrc||video?.src||post?.dataset.mediaUrl||post?.dataset.videoUrl||'';}
    if(!detail.postId||!videoUrl)throw new Error('تعذر تحديد الفيديو الحالي لربط التعليقات.');
    const caption=post?.querySelector('.post-text,.post-caption')?.textContent?.trim()||'';
    const thumbnailUrl=post?.querySelector('video')?.poster||post?.querySelector('img.post-image')?.src||'';
    const linked=await api(`/reels/by-post/${encodeURIComponent(detail.postId)}`,{method:'POST',body:JSON.stringify({video_url:videoUrl,caption,thumbnail_url:thumbnailUrl})});
    state.postId=String(detail.postId);state.reelId=Number(linked.reel.id);
  }
  async function load(reset){
    if(state.loading)return;state.loading=true;status('جارٍ تحميل التعليقات…');
    try{
      if(reset){state.offset=0;state.comments=[];}
      const data=await api(`/reels/${state.reelId}/comments?limit=25&offset=${state.offset}&sort=${state.sort}`);
      const rows=data.comments||[];state.comments=reset?rows:state.comments.concat(rows);state.offset+=rows.length;state.hasMore=!!data.has_more;
      const userIds=[...new Set(state.comments.map(c=>c.user_id).filter(Boolean))];const profiles={};
      if(userIds.length){const {data:ps}=await supabase().from('profiles').select('id,full_name,username,avatar_url').in('id',userIds);(ps||[]).forEach(p=>profiles[p.id]=p);}
      const reactions=data.reactions||[];render(profiles,reactions);status('');$('#ebrc-more').hidden=!state.hasMore;
      $('#ebrc-count').textContent=`${state.comments.length} تعليق`;
    }catch(err){status(err.message);}finally{state.loading=false;}
  }
  function render(profiles,reactions){
    const host=$('#ebrc-list');host.replaceChildren();
    const roots=state.comments.filter(c=>!c.parent_comment_id);
    const byParent=new Map();state.comments.filter(c=>c.parent_comment_id).forEach(c=>{const k=String(c.parent_comment_id);if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(c);});
    const card=(c,depth=0)=>{
      const profile=profiles[c.user_id]||{};const name=profile.full_name||profile.username||'عضو EgyBook';const avatar=profile.avatar_url;
      const mine=String(c.user_id)===String(state.user?.id);const reacted=reactions.some(r=>String(r.comment_id)===String(c.id)&&String(r.user_id)===String(state.user?.id));
      const el=document.createElement('article');el.className='ebrc-comment'+(depth?' is-reply':'');
      el.innerHTML=`<div class="ebrc-avatar">${avatar?`<img src="${esc(avatar)}" alt="">`:'👤'}</div><div class="ebrc-body"><strong>${esc(name)}</strong><p>${esc(c.comment_text)}</p><div class="ebrc-actions"><button data-ebrc-action="react" data-id="${c.id}">${reacted?'❤️':'♡'} تفاعل</button><button data-ebrc-action="reply" data-id="${c.id}">رد</button>${mine?`<button data-ebrc-action="edit" data-id="${c.id}">تعديل</button>`:''}<button data-ebrc-action="delete" data-id="${c.id}">حذف</button><small>${new Date(c.created_at).toLocaleString('ar-EG')}${c.edited_at?' · عُدّل':''}</small></div></div>`;
      host.append(el);(byParent.get(String(c.id))||[]).forEach(reply=>card(reply,depth+1));
    };
    roots.forEach(c=>card(c));if(!roots.length&&!state.comments.length){const empty=document.createElement('p');empty.className='ebrc-empty';empty.textContent='كن أول من يعلّق على هذا الريل.';host.append(empty);}
  }
  document.addEventListener('egybook:reels-comments-open',async event=>{
    const panel=ensurePanel();panel.hidden=false;state.sort='recent';$('#ebrc-sort').value='recent';status('');state.viewportCleanup?.();state.viewportCleanup=syncKeyboardViewport(panel);
    try{await resolveReel(event.detail);await load(true);}catch(err){status(err.message);}
  });
})();
