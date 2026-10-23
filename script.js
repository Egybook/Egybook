'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  // Public/publishable Supabase key only. Never place a service_role/secret key in browser code.
  const SUPABASE_URL = 'https://ezmglhwjiozevjebmgmj.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-YdgiJ_J-oFXugV3xwxNCA_Gog1dJrb';
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}) || null;
  let currentUser = null;
  let cloudReady = false;

  const postsList = $('#postsList');
  const createPostModal = $('#createPostModal');
  const postContent = $('#postContent');
  const toast = $('#toast');
  const photoInput = $('#photoInput');
  const videoInput = $('#videoInput');
  let toastTimer;
  let selectedMedia = null;
  let activeCommentPost = null;
  let sortNewestFirst = true;
  const STORAGE_KEY = 'egybook_demo_posts_v1';
  const PROFILE_KEY = 'egybook_profile_v1';
  const POST_STATE_KEY = 'egybook_post_state_v2';
  const ALBUMS_KEY = 'egybook_albums_v1';
  const FOLLOWERS_KEY = 'egybook_followers_v1';
  let currentMenuPost = null;
  let currentAlbum = null;
  let postState = {};
  let albumsData = {cover:[], avatar:[], posts:[]};
  let followersCount = 0;
  try { postState = JSON.parse(localStorage.getItem(POST_STATE_KEY) || '{}') || {}; } catch (_) {}
  try { albumsData = {...albumsData, ...(JSON.parse(localStorage.getItem(ALBUMS_KEY) || '{}') || {})}; } catch (_) {}
  try { followersCount = Math.max(0, Number(localStorage.getItem(FOLLOWERS_KEY) || 0)); } catch (_) {}
  const REACTIONS = ['👍','❤️','😮','😂','😢','😡'];
  let profileData = {name:'حسابي',username:'egybook_user',bio:'أهلاً بيكم في حسابي على EgyBook 💙\nتواصل • شارك • اكتشف أكثر',location:'مصر',birthdate:'',gender:'',website:'',phone:'',privacy:'عام',avatar:'',cover:''};
  const OWNER_USER_ID = '83cbb858-a62f-469a-9723-2919ead6bc58';
  async function refreshVerificationBadge(){
    const badge=$('#profileVerifiedBadge');
    if(!badge)return;
    badge.hidden=true;
    if(!supabase||!currentUser)return;
    try{
      const {data,error}=await supabase.from('verified_accounts')
        .select('user_id,verification_type,expires_at')
        .eq('user_id',currentUser.id).maybeSingle();
      if(error||!data)return;
      const isOwner=currentUser.id===OWNER_USER_ID &&
        data.verification_type==='owner' && !data.expires_at;
      const isActive=data.verification_type==='owner'
        ? isOwner : (!data.expires_at || new Date(data.expires_at)>new Date());
      if(isActive){
        badge.hidden=false;
        badge.title=isOwner?'مالك الموقع موثّق':'حساب موثّق';
        badge.setAttribute('aria-label',badge.title);
        badge.classList.toggle('owner-badge',isOwner);
      }
    }catch(_){ /* Badge remains hidden if verification cannot be confirmed. */ }
  }
  let reactionTarget = null;
  let longPressTimer = null;
  let longPressTriggered = false;
  function saveProfile(){ try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profileData));}catch(_){showToast('مساحة التخزين لا تكفي لحفظ بيانات الملف الشخصي.');} }
  function saveAlbums(){ try { localStorage.setItem(ALBUMS_KEY, JSON.stringify(albumsData)); } catch (_) { showToast('مساحة التخزين ممتلئة؛ تعذر حفظ نسخة الألبوم.'); } }
  function savePostState(){ try { localStorage.setItem(POST_STATE_KEY, JSON.stringify(postState)); } catch (_) {} }
  function recordAlbumImage(kind, dataUrl, date=Date.now()){ if(!dataUrl)return; const list=albumsData[kind]||(albumsData[kind]=[]); list.unshift({src:dataUrl,date}); albumsData[kind]=list.slice(0,60); saveAlbums(); }
  function restorePostState(post){ const state=postState[post.dataset.postId]; if(!state)return; if(state.saved){const b=$('[data-action="save"]',post);if(b){b.classList.add('saved');const label=$('span:last-child',b);if(label)label.textContent='تم الحفظ';}} if(state.reaction){const b=$('[data-action="like"]',post);if(b){b.classList.add('reacted');b.dataset.currentReaction=state.reaction;b.dataset.currentReactionLabel=state.reactionLabel||'تفاعل';const icon=$('.action-icon',b);if(icon)icon.textContent=state.reaction;const label=$$('span',b)[1];if(label)label.textContent=state.reactionLabel||'تفاعل';const icons=$('.reaction-icons',post);if(icons)icons.innerHTML=`<span>${state.reaction}</span>`;}} if(state.pinned)post.classList.add('post-pinned'); if(state.archived)post.hidden=true; if(state.trashed)post.hidden=true; }
  function applyAvatar(element){ if(!element)return; if(profileData.avatar){element.textContent='';element.style.backgroundImage=`url(\"${profileData.avatar}\")`;element.style.backgroundSize='cover';element.style.backgroundPosition='center';}else{element.style.backgroundImage='';element.textContent=(profileData.name||'ح').trim().charAt(0)||'ح';} }
  function applyProfile(){
    $('#profileName').textContent=profileData.name||'حسابي'; $('.profile-handle').textContent='@'+(profileData.username||'egybook_user'); $('.profile-bio').textContent=profileData.bio||'';
    const details=$$('.profile-details span'); if(details[0])details[0].textContent='⌖ '+(profileData.location||'لم يحدد الموقع');
    const cover=$('.profile-cover'); if(cover){if(profileData.cover){cover.classList.add('has-image');cover.style.backgroundImage=`url(\"${profileData.cover}\")`;}else{cover.classList.remove('has-image');cover.style.backgroundImage='';}}
    applyAvatar($('.profile-avatar'));applyAvatar($('.profile-large-avatar'));applyAvatar($('.create-post .avatar'));$$('.post[data-user-post="true"] .post-header .avatar').forEach(applyAvatar);
    $$('.post[data-user-post="true"] .post-author .author-name').forEach(el=>el.textContent=profileData.name||'حسابي');
    $$('.post[data-user-post="true"] .post-header .avatar').forEach(applyAvatar);
    const link=location.href.split('#')[0]+'#user/'+encodeURIComponent(profileData.username||'egybook_user'); const profileLink=$('#profileLink'); if(profileLink)profileLink.textContent=link;
  }
  function loadProfile(){try{const data=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');if(data)profileData={...profileData,...data};}catch(_){} applyProfile();}
  function compressImage(file, maxDimension=1280, quality=0.76){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('تعذر قراءة الصورة'));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error('الصورة غير صالحة'));
        img.onload=()=>{
          const scale=Math.min(1,maxDimension/Math.max(img.width,img.height));
          const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',quality));
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  async function uploadProfileImage(dataUrl,key){
    if(!supabase||!currentUser) throw new Error('سجّل الدخول أولًا لتحديث صور الملف الشخصي.');
    const response=await fetch(dataUrl);const blob=await response.blob();
    const path=`${currentUser.id}/profile/${key}-${Date.now()}.jpg`;
    const {error}=await supabase.storage.from('post-media').upload(path,blob,{upsert:true,contentType:'image/jpeg',cacheControl:'3600'});
    if(error) throw error;
    const {data}=supabase.storage.from('post-media').getPublicUrl(path);
    return data.publicUrl;
  }
  async function readProfileImage(file,key){
    if(!file)return;
    if(!file.type.startsWith('image/')){showToast('اختار ملف صورة صالح.');return;}
    if(!currentUser){showToast('سجّل الدخول أولًا لتحديث صور الملف الشخصي.');return;}
    try{
      showToast('جاري تحديث الصورة…');
      const dataUrl=await compressImage(file,1280,0.74);
      const publicUrl=await uploadProfileImage(dataUrl,key);
      profileData[key]=publicUrl;
      saveProfile();recordAlbumImage(key==='avatar'?'avatar':'cover',publicUrl);applyProfile();
      const payload=cloudProfilePayload();
      const {error:profileError}=await supabase.from('profiles').upsert(payload,{onConflict:'id'});
      if(profileError) throw profileError;
      showToast(key==='avatar'?'تم تحديث الصورة الشخصية بنجاح.':'تم تحديث صورة الغلاف بنجاح.');
    }catch(err){showToast('تعذر تحديث الصورة: '+(err.message||'حاول مرة أخرى.'));}
  }
  function openEditProfile(){ $('#editName').value=profileData.name||'';$('#editUsername').value=profileData.username||'';$('#editBio').value=profileData.bio||'';$('#editLocation').value=profileData.location||'';$('#editBirthdate').value=profileData.birthdate||'';$('#editGender').value=profileData.gender||'';$('#editWebsite').value=profileData.website||'';$('#editPhone').value=profileData.phone||'';$('#editPrivacy').value=profileData.privacy||'عام';openModal($('#editProfileModal')); }
  function selectReaction(post,emoji,label){
    if(!post)return;
    const button=$('[data-action="like"]',post);
    if(!button)return;
    button.classList.add('reacted');
    button.dataset.currentReaction=emoji;
    button.dataset.currentReactionLabel=label;
    const icon=$('.action-icon',button);
    if(icon)icon.textContent=emoji;
    const spans=$$('span',button);
    if(spans.length>1)spans[1].textContent=label;
    const id=post.dataset.postId;
    if(id){
      postState[id]={...(postState[id]||{}),reaction:emoji,reactionLabel:label};
      savePostState();
    }
    // Keep the selected emoji as the visible reaction; never replace it with a default Like.
    const icons=$('.reaction-icons',post);
    if(icons)icons.innerHTML=`<span>${emoji}</span>`;
    syncPostStats(post);
    closeModal($('#reactionModal'));
    showToast(`تم تسجيل تفاعلك: ${label}`);
  }


  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // A short, subtle success sound after a post is published.
  // Web Audio is created only after the user's publish action, avoiding autoplay on page load.
  function playPublishSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const now = ctx.currentTime;
      [660, 880].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + index * 0.12;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      });
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch (error) {
      console.debug('Publish sound unavailable', error);
    }
  }
  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const focusable = $('textarea, input, select, button', modal);
    if (focusable) setTimeout(() => focusable.focus(), 80);
  }
  function closeModal(modal) {
    if (!modal) return;
    if (modal.id === 'supabaseAuthModal' && !currentUser) { updateAuthGate(); return; }
    modal.classList.remove('open');
    if (modal.id === 'commentsModal') modal.hidden = true;
    if (!$('.modal.open')) document.body.style.overflow = '';
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function updateEmptyState() {
    const visiblePosts = $$('.post', postsList).some(post => !post.hidden);
    $('#emptyMessage').hidden = visiblePosts;
  }
  function formatPostCount(value) {
    const n = Math.max(0, Number(value) || 0);
    if (n >= 1000000) return (n / 1000000).toLocaleString('ar-EG', {maximumFractionDigits: 1}) + ' مليون';
    if (n >= 1000) return (n / 1000).toLocaleString('ar-EG', {maximumFractionDigits: 1}) + ' ألف';
    return n.toLocaleString('ar-EG');
  }
  function syncPostStats(post) {
    if (!post) return;
    const id = post.dataset.postId || '';
    const state = postState[id] || {};
    // Use the same per-post in-memory map persisted by saveComments().
    // The old code read a different key, so the comment count stayed at zero.
    const comments = getCommentsFor(post);
    const countAll = items => (items || []).reduce((n, item) => n + 1 + countAll(item.replies), 0);
    const commentCount = $('.comment-count', post);
    if (commentCount) commentCount.textContent = formatPostCount(countAll(comments));

    const icons = $('.reaction-icons', post);
    const current = state.reaction || $('[data-action="like"]', post)?.dataset.currentReaction || '';
    if (icons) {
      // Show the selected reaction first, followed by at most one other existing reaction.
      const existing = [...icons.children].map(el => el.textContent.trim()).filter(Boolean);
      const ordered = [...new Set([current, ...existing].filter(Boolean))].slice(0, 2);
      icons.innerHTML = ordered.map(emoji => `<span>${emoji}</span>`).join('');
    }

    // Local demo counter: selecting a reaction contributes one reaction; removing it subtracts one.
    const likeCount = $('.like-count', post);
    if (likeCount) {
      let base = Number(likeCount.dataset.baseCount);
      if (!Number.isFinite(base)) {
        base = Math.max(0, parseInt(likeCount.textContent.replace(/[^0-9]/g, ''), 10) || 0);
        if (current && base > 0) base = Math.max(0, base - 1);
        likeCount.dataset.baseCount = String(base);
      }
      const total = base + (current ? 1 : 0);
      likeCount.textContent = `${formatPostCount(total)} تفاعل`;
    }
    const shares = $('.share-count', post);
    if (shares) {
      const baseShares = Number(shares.dataset.baseCount);
      if (state.shareCount != null) shares.textContent = formatPostCount(state.shareCount);
      else if (!Number.isFinite(baseShares)) shares.textContent = formatPostCount(parseInt(shares.textContent.replace(/[^0-9]/g, ''), 10) || 0);
    }
  }
  function syncAllPostStats() { $$('.post').forEach(syncPostStats); }
  function createPostElement({id, text, media, mediaType, visibility, createdAt}) {
    const article = document.createElement('article');
    article.className = 'post';
    article.dataset.postId = id;
    const dateText = new Date(createdAt || Date.now()).toLocaleString('ar-EG', {dateStyle:'short', timeStyle:'short'});
    let mediaHTML = '';
    if (media && mediaType === 'image') mediaHTML = `<img class="post-image" src="${media}" alt="صورة مرفقة بالمنشور">`;
    else if (media && mediaType === 'video') mediaHTML = `<video class="post-image" src="${media}" controls playsinline></video>`;
    article.innerHTML = `
      <header class="post-header"><div class="avatar">ح</div><div class="post-author"><div class="author-name">${escapeHTML(profileData.name||'حسابي')}</div><div class="post-meta">${escapeHTML(dateText)} · ${escapeHTML(visibility || 'الجميع')}</div></div><button class="more-button" data-action="post-menu" aria-label="خيارات المنشور">⋯</button></header>
      <p class="post-text"></p>${mediaHTML}
      <div class="post-stats"><div class="reaction-summary"><div class="reaction-icons"><span>👍</span></div><span class="like-count">0 تفاعل</span></div><span><span class="comment-count">0</span> تعليق <span class="stats-separator" aria-hidden="true"></span><span class="share-count">0</span> مشاركة</span></div>
      <div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon">👍</span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon">▱</span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon">➦</span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon">🔖</span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
    $('.post-text', article).textContent = text;
    return article;
  }
  async function uploadPostMedia(file, userId, oldUrl=null) {
    if (!file || !supabase) return oldUrl;
    const ext=(file.name.split('.').pop()|| (file.type==='video/mp4'?'mp4':'jpg')).toLowerCase().replace(/[^a-z0-9]/g,'') || 'bin';
    const path=`${userId}/${crypto.randomUUID()}.${ext}`;
    const {error}=await supabase.storage.from('post-media').upload(path,file,{upsert:false,contentType:file.type||undefined});
    if(error) throw error;
    const {data}=supabase.storage.from('post-media').getPublicUrl(path);
    return data.publicUrl;
  }
  function postRowFromElement(post){
    return {id:post.dataset.postId,user_id:currentUser.id,text:$('.post-text',post)?.textContent||'',media_url:post.dataset.media||null,media_type:post.dataset.mediaType||null,visibility:post.dataset.visibility||'الجميع',created_at:new Date(Number(post.dataset.createdAt)||Date.now()).toISOString(),updated_at:new Date().toISOString()};
  }
  async function persistPosts() {
    const posts=$$('.post[data-user-post="true"]',postsList);
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(posts.map(post=>({id:post.dataset.postId,text:$('.post-text',post)?.textContent||'',media:post.dataset.media||null,mediaType:post.dataset.mediaType||null,visibility:post.dataset.visibility||'الجميع',createdAt:Number(post.dataset.createdAt)||Date.now()})))); } catch (_) {}
    if(!supabase || !currentUser) { showToast('سجّل الدخول أولًا لحفظ التعديلات.'); return false; }
    for(const post of posts){
      const id=post.dataset.postId;
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'')) continue;
      const row=postRowFromElement(post);
      const {error}=await supabase.from('posts').update({text:row.text,media_url:row.media_url,media_type:row.media_type,visibility:row.visibility,updated_at:row.updated_at}).eq('id',id).eq('user_id',currentUser.id);
      if(error){console.error('Supabase post update failed',error);showToast('تعذر حفظ التعديلات: '+error.message);return false;}
    }
    return true;
  }
  function renderCloudPost(row){
    if($(`[data-post-id="${CSS.escape(row.id)}"]`,postsList))return;
    const createdAt=row.created_at?new Date(row.created_at).getTime():Date.now();
    const data={id:row.id,text:row.text||'',media:row.media_url||null,mediaType:row.media_type||null,visibility:row.visibility||'الجميع',createdAt};
    const article=createPostElement(data);article.dataset.createdAt=String(createdAt);article.dataset.visibility=data.visibility;
    article.dataset.media=data.media||'';article.dataset.mediaType=data.mediaType||'';
    if(currentUser&&row.user_id===currentUser.id)article.dataset.userPost='true';
    postsList.append(article);restorePostState(article);syncPostStats(article);
  }
  async function restorePosts() {
    if(supabase && currentUser){
      const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at').order('created_at',{ascending:false}).limit(100);
      if(error){console.error('Supabase posts load failed',error);showToast('تعذر تحميل المنشورات: '+error.message);return;}
      postsList.querySelectorAll('.post[data-cloud-post="true"]').forEach(p=>p.remove());
      (data||[]).reverse().forEach(row=>{renderCloudPost(row);const el=$(`[data-post-id="${CSS.escape(row.id)}"]`,postsList);if(el)el.dataset.cloudPost='true';});
      updateEmptyState();return;
    }
    postsList.querySelectorAll('.post[data-user-post="true"]').forEach(p=>p.remove());
    showToast('سجّل الدخول أولًا لعرض المنشورات المحفوظة.');
  }
  async function publishPost(event) {
    event.preventDefault();
    const text=postContent.value.trim();
    if(!text&&!selectedMedia)return showToast('اكتب شيئًا أو أرفق صورة/فيديو أولًا.');
    if(!supabase||!currentUser){openModal($('#supabaseAuthModal'));return showToast('سجّل الدخول أولًا لنشر المنشور.');}
    const submit=$('#postForm').querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try{
      let mediaUrl=null;
      if(selectedMedia){
        if(selectedMedia.file) mediaUrl=await uploadPostMedia(selectedMedia.file,currentUser.id);
        else if(selectedMedia.dataUrl) {
          const blob=await (await fetch(selectedMedia.dataUrl)).blob();
          const ext=selectedMedia.type==='video'?'mp4':'jpg';const file=new File([blob],`upload.${ext}`,{type:blob.type||(selectedMedia.type==='video'?'video/mp4':'image/jpeg')});
          mediaUrl=await uploadPostMedia(file,currentUser.id);
        }
      }
      const row={user_id:currentUser.id,text,media_url:mediaUrl,media_type:selectedMedia?.type||null,visibility:$('#postVisibility').value||'الجميع'};
      const {data,error}=await supabase.from('posts').insert(row).select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at').single();
      if(error)throw error;
      const article=createPostElement({id:data.id,text:data.text,media:data.media_url,mediaType:data.media_type,visibility:data.visibility,createdAt:new Date(data.created_at).getTime()});
      article.dataset.userPost='true';article.dataset.cloudPost='true';article.dataset.createdAt=String(new Date(data.created_at).getTime());article.dataset.visibility=data.visibility;article.dataset.media=data.media_url||'';article.dataset.mediaType=data.media_type||'';postsList.prepend(article);
      if(data.media_url&&data.media_type==='image')recordAlbumImage('posts',data.media_url,Date.now());
      postContent.value='';selectedMedia=null;$('#mediaPreview').hidden=true;$('#mediaPreview').replaceChildren();closeModal(createPostModal);updateEmptyState();playPublishSound();showToast('تم النشر بنجاح');
    }catch(error){console.error('Supabase publish failed',error);showToast('تعذر نشر المنشور: '+(error.message||'تحقق من تسجيل الدخول وإعدادات قاعدة البيانات.'));}
    finally{if(submit)submit.disabled=false;}
  }
  async function readMedia(file, type) {
    if (!file) return;
    const maxBytes = type==='image' ? 12*1024*1024 : 2*1024*1024;
    if (file.size > maxBytes) { showToast(type==='image'?'حجم الصورة كبير جدًا؛ اختر صورة أقل من 12 ميجابايت.':'حجم الفيديو كبير؛ اختر فيديو أصغر من 2 ميجابايت.'); return; }
    try{
      const dataUrl=type==='image'?await compressImage(file,1280,0.72):await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
      selectedMedia = {dataUrl, type, file};
      const preview = $('#mediaPreview'); preview.replaceChildren(); preview.hidden = false;
      const label = document.createElement('div'); label.textContent = `المرفق: ${file.name}`; preview.append(label);
      const media = document.createElement(type === 'image' ? 'img' : 'video');
      media.src = dataUrl;
      if (type === 'video') { media.controls = true; media.playsInline = true; }
      preview.append(media); showToast('تم إرفاق الملف. اضغط نشر لإضافته.');
      if(!createPostModal.classList.contains('open'))openModal(createPostModal);
    }catch(_){showToast('تعذر قراءة الملف. حاول مرة أخرى.');}
  }
  let currentPage = 'home';
  function showProfile() {
    currentPage = 'profile';
    $('#profilePage').hidden = false;
    $('.container').hidden = true;
    $$('.top-nav-item, .bottom-item[data-page]').forEach(button => button.classList.remove('active'));
    $$('.bottom-item[data-action="profile"]').forEach(button => button.classList.add('active'));
    renderProfilePosts(); window.scrollTo({top:0,behavior:'smooth'});
  }
  function renderProfilePosts() {
    const target = $('#profilePostsList'); target.replaceChildren();
    const ownPosts = $$('.post[data-user-post="true"]', postsList);
    $('#profilePostsCount').textContent = String(ownPosts.length);
    if (!ownPosts.length) { const empty = document.createElement('div'); empty.className='profile-empty'; empty.textContent='لسه مفيش منشورات هنا — شارك أول منشور ليك من زر +.'; target.append(empty); return; }
    ownPosts.sort((a,b)=>Number(!!postState[b.dataset.postId]?.pinned)-Number(!!postState[a.dataset.postId]?.pinned)); ownPosts.forEach(post => { const clone=post.cloneNode(true); clone.querySelectorAll('.comments-area').forEach(a=>a.remove()); if(postState[post.dataset.postId]?.pinned){const badge=document.createElement('span');badge.className='pinned-post-badge';badge.textContent='📌 منشور مثبت';clone.querySelector('.post-header')?.append(badge);} target.append(clone); });
  }
  function setPage(page) {
    currentPage = page; $('#profilePage').hidden = true; $('.container').hidden = false;
    $$('.top-nav-item, .bottom-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    const labels = {home:'أحدث المنشورات', friends:'منشورات الأصدقاء', explore:'استكشف المنشورات', reels:'الريلز', saved:'المنشورات المحفوظة'};
    $('#feedTitle').textContent = labels[page] || 'أحدث المنشورات';
    $$('.post', postsList).forEach(post => {
      const saved = post.querySelector('[data-action="save"]')?.classList.contains('saved');
      post.hidden = (page === 'saved' && !saved) || page === 'reels';
    });
    if (page === 'friends') showToast('عرض تجريبي: لا يوجد اتصال بحسابات الأصدقاء حتى الآن.');
    if (page === 'explore') showToast('أنت تستكشف المنشورات المتاحة في الصفحة.');
    if (page === 'reels') showToast('قسم الريلز يحتاج إلى صفحة ومصدر فيديوهات مستقلين.');
    updateEmptyState();
  }
  function runSearch() {
    const query = $('#searchInput').value.trim().toLocaleLowerCase('ar');
    closeModal($('#searchModal'));
    $$('.post', postsList).forEach(post => post.hidden = query && !post.textContent.toLocaleLowerCase('ar').includes(query));
    $('#feedTitle').textContent = query ? `نتائج البحث: ${query}` : 'أحدث المنشورات';
    updateEmptyState();
    if (!query) showToast('اكتب كلمة للبحث عنها.');
  }


  const POST_CONTROLS = [
    ['pin','📌','تثبيت المنشور','سيظهر في أعلى منشورات ملفك الشخصي'],
    ['save','🔖','حفظ المنشور','إضافة المنشور إلى العناصر المحفوظة'],
    ['edit','✏️','تعديل المنشور','تعديل النص والخصوصية'],
    ['product','🛍️','إدارة المنتج','خيار تجريبي يحتاج إلى إعداد متجر'],
    ['comments','💬','من يمكنه التعليق على منشورك؟','اختيار إعدادات التعليقات'],
    ['privacy','🌐','تعديل الخصوصية','تغيير الجمهور الذي يمكنه رؤية المنشور'],
    ['archive','🗃️','نقل إلى الأرشيف','إخفاء المنشور دون حذفه'],
    ['trash','🗑️','نقل إلى سلة المهملات','إخفاء المنشور محليًا'],
    ['notifications','🔕','إيقاف إشعارات المنشور','إعداد محلي تجريبي'],
    ['copy','🔗','نسخ الرابط','نسخ رابط المنشور'],
    ['partnership','🤝','مشاركة رمز إعلان الشراكة','يتطلب ربطًا بخدمة إعلانات'],
    ['ad','📣','إنشاء إعلان','يتطلب حساب إعلانات وخادمًا']
  ];
  function openPostControls(post){
    if(!post)return;
    const host=$('#postControlsItems');host.replaceChildren();
    POST_CONTROLS.forEach(([key,icon,title,desc])=>{
      const b=document.createElement('button');b.type='button';b.className='post-control-item'+(key==='trash'?' danger':'');b.dataset.action='post-control';b.dataset.control=key;
      b.innerHTML=`<span class="pc-icon" aria-hidden="true">${icon}</span><span class="pc-copy"><strong>${title}</strong><small>${desc}</small></span>`;
      host.append(b);
    });
    openModal($('#postControlsModal'));
  }
  function handlePostControl(control){
    const post=currentMenuPost;if(!post)return;
    const id=post.dataset.postId||`demo-${Date.now()}`;const state=postState[id]||(postState[id]={});
    if(control==='pin'){state.pinned=!state.pinned;post.classList.toggle('post-pinned',state.pinned);savePostState();persistPosts();if(currentPage==='profile')renderProfilePosts();showToast(state.pinned?'تم تثبيت المنشور.':'تم إلغاء تثبيت المنشور.');}
    else if(control==='save'){const b=$('[data-action="save"]',post);if(b){b.classList.toggle('saved');const saved=b.classList.contains('saved');$('span:last-child',b).textContent=saved?'تم الحفظ':'حفظ';state.saved=saved;showToast(saved?'تم حفظ المنشور.':'تم إلغاء حفظ المنشور.');}}
    else if(control==='edit'){
      if(post.dataset.userPost!=='true'){showToast('يمكنك تعديل منشوراتك التي نشرتها من هذا الجهاز فقط.');return;}
      openEditPost(post);return;
    }
    else if(control==='product'){showToast('إدارة المنتج تحتاج إلى إعداد متجر وقاعدة بيانات.');}
    else if(control==='comments'){const choice=prompt('من يمكنه التعليق؟ اكتب: الجميع أو الأصدقاء أو لا أحد','الجميع');if(choice===null)return;post.dataset.commentPrivacy=choice;state.commentPrivacy=choice;showToast('تم حفظ اختيار التعليقات محليًا: '+choice);}
    else if(control==='privacy'){const choice=prompt('خصوصية المنشور: الجميع أو الأصدقاء أو أنا فقط',post.dataset.visibility||'الجميع');if(choice===null)return;post.dataset.visibility=choice;state.visibility=choice;const meta=$('.post-meta',post);if(meta)meta.textContent=(meta.textContent.split('·')[0]||'')+' · '+choice;persistPosts();showToast('تم تحديث الخصوصية محليًا.');}
    else if(control==='archive'){state.archived=!state.archived;post.hidden=state.archived;showToast(state.archived?'تم نقل المنشور إلى الأرشيف المحلي.':'تمت استعادة المنشور من الأرشيف.');persistPosts();}
    else if(control==='trash'){if(!confirm('حذف المنشور نهائيًا؟ لن يظهر بعد التحديث.'))return;const deletedId=post.dataset.postId;post.remove();delete postState[deletedId];savePostState();if(supabase&&currentUser&&/^[0-9a-f-]{36}$/i.test(deletedId||'')){supabase.from('posts').delete().eq('id',deletedId).eq('user_id',currentUser.id).then(({error})=>{if(error)showToast('تم إخفاء المنشور، لكن تعذر حذفه نهائيًا: '+error.message);else showToast('تم حذف المنشور بنجاح.');});}else persistPosts();if(currentMenuPost===post)currentMenuPost=null;}
    else if(control==='notifications'){state.notificationsOff=!state.notificationsOff;showToast(state.notificationsOff?'تم إيقاف إشعارات هذا المنشور محليًا.':'تم تشغيل إشعارات المنشور محليًا.');}
    else if(control==='copy'){const url=location.href.split('#')[0]+'#post/'+encodeURIComponent(id);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط المنشور.')).catch(()=>showToast(url));else showToast(url);}
    else if(control==='partnership')showToast('ميزة رمز الشراكة غير متصلة بخدمة إعلانات.');
    else if(control==='ad')showToast('إنشاء الإعلانات الفعلية يحتاج إلى خادم وحساب إعلاني.');
    savePostState();closeModal($('#postControlsModal'));updateEmptyState();
  }
  let editingPost = null, editPostMedia = null, editPostMediaType = null, editPostFilePending = null;
  function openEditPost(post){
    editingPost=post;editPostMedia=post.dataset.media||null;editPostMediaType=post.dataset.mediaType||null;editPostFilePending=null;
    $('#editPostText').value=$('.post-text',post)?.textContent||'';renderEditPostMedia();$('#editPostFile').value='';
    closeModal($('#postControlsModal'));openModal($('#editPostModal'));
  }
  function renderEditPostMedia(){const box=$('#editPostMediaPreview');box.replaceChildren();if(!editPostMedia)return;const el=document.createElement(editPostMediaType==='video'?'video':'img');el.src=editPostMedia;el.className='post-image';if(editPostMediaType==='video'){el.controls=true;el.playsInline=true;}box.append(el);}
  $('#editPostChangeMedia').addEventListener('click',()=>$('#editPostFile').click());
  $('#editPostRemoveMedia').addEventListener('click',()=>{editPostMedia=null;editPostMediaType=null;editPostFilePending=null;$('#editPostFile').value='';renderEditPostMedia();});
  $('#editPostFile').addEventListener('change',async()=>{const file=$('#editPostFile').files?.[0];if(!file)return;const type=file.type.startsWith('video/')?'video':file.type.startsWith('image/')?'image':null;if(!type){showToast('اختار صورة أو فيديو صالح.');return;}const max=type==='image'?12*1024*1024:2*1024*1024;if(file.size>max){showToast(type==='image'?'الصورة أكبر من 12 ميجابايت.':'الفيديو أكبر من 2 ميجابايت في التخزين المحلي.');return;}try{editPostMedia=type==='image'?await compressImage(file,1280,.72):await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});editPostMediaType=type;editPostFilePending=file;renderEditPostMedia();}catch(_){showToast('تعذر تحميل الملف.');}});
  $('#editPostSave').addEventListener('click',async()=>{
    if(!editingPost)return;
    if(!supabase||!currentUser){openModal($('#supabaseAuthModal'));return showToast('سجّل الدخول أولًا لحفظ التعديلات.');}
    if(editingPost.dataset.userPost!=='true'){return showToast('لا يمكنك تعديل منشور لا تملكه.');}
    const text=$('#editPostText').value.trim();if(!text&&!editPostMedia)return showToast('اكتب نصًا أو أضف صورة/فيديو قبل الحفظ.');
    const saveButton=$('#editPostSave');saveButton.disabled=true;
    try{
      let mediaUrl=editPostMedia;
      if(editPostFilePending)mediaUrl=await uploadPostMedia(editPostFilePending,currentUser.id,editPostMedia);
      const payload={text,media_url:mediaUrl||null,media_type:mediaUrl?editPostMediaType:null,updated_at:new Date().toISOString()};
      const {error}=await supabase.from('posts').update(payload).eq('id',editingPost.dataset.postId).eq('user_id',currentUser.id);if(error)throw error;
      const old=$('.post-text',editingPost);if(old)old.textContent=text;else{const el=document.createElement('p');el.className='post-text';el.textContent=text;editingPost.append(el);}
      editingPost.querySelector('.post-image')?.remove();delete editingPost.dataset.media;delete editingPost.dataset.mediaType;
      if(mediaUrl){const media=document.createElement(editPostMediaType==='video'?'video':'img');media.className='post-image';media.src=mediaUrl;if(editPostMediaType==='video'){media.controls=true;media.playsInline=true;}const textEl=$('.post-text',editingPost);if(textEl)textEl.insertAdjacentElement('afterend',media);else editingPost.append(media);editingPost.dataset.media=mediaUrl;editingPost.dataset.mediaType=editPostMediaType;}
      closeModal($('#editPostModal'));showToast('تم حفظ تعديل المنشور بنجاح.');editingPost=null;editPostFilePending=null;
    }catch(error){console.error('Supabase edit failed',error);showToast('تعذر حفظ التعديلات: '+(error.message||'حاول مرة أخرى.'));}
    finally{saveButton.disabled=false;}
  });

  function openAlbums(){
    const grid=$('#albumGrid'),photos=$('#albumPhotos');grid.hidden=false;photos.hidden=true;grid.replaceChildren();
    const albums=[['cover','🌇','صور الغلاف'],['avatar','👤','الصور الشخصية'],['posts','🖼️','صور المنشورات']];
    albums.forEach(([key,icon,title])=>{const b=document.createElement('button');b.className='album-card';b.innerHTML=`<div class="album-cover">${icon}</div><strong>${title}</strong><small>${(albumsData[key]||[]).length} صورة</small>`;b.addEventListener('click',()=>showAlbum(key,title));grid.append(b);});
    openModal($('#photoAlbumsModal'));
  }
  function showAlbum(key,title){
    currentAlbum=key;const grid=$('#albumGrid'),photos=$('#albumPhotos');grid.hidden=true;photos.hidden=false;photos.replaceChildren();
    const items=albumsData[key]||[];
    if(!items.length){const p=document.createElement('p');p.textContent='الألبوم فارغ حتى الآن. الصور التي تغيّرها أو تنشرها لاحقًا ستظهر هنا على هذا الجهاز.';photos.append(p);}
    items.forEach(item=>{const img=document.createElement('img');img.src=item.src;img.alt=title;img.loading='lazy';photos.append(img);});
    const back=document.createElement('button');back.className='primary-button album-back';back.textContent='رجوع إلى الألبومات';back.addEventListener('click',openAlbums);photos.append(back);
  }


  let activeCommentsPost = null, replyToComment = null, commentSortMode = 'relevant', commentData = {};
  function getCommentsFor(post){
    const id=post?.dataset.postId||'unknown';
    if(!commentData[id]){
      const area=$('.comments-area',post);
      const seeded=area?[...area.querySelectorAll('[data-comment]')].map((el,i)=>({id:'seed-'+i,name:el.dataset.name||'عضو EgyBook',time:el.dataset.time||'الآن',text:el.textContent.trim(),likes:0,dislikes:0,replies:[]})):[];
      commentData[id]=seeded;
      try{const saved=JSON.parse(localStorage.getItem('egybook-comments-v1')||'{}');if(saved[id])commentData[id]=saved[id];}catch{}
    }
    return commentData[id];
  }
  function saveComments(){try{localStorage.setItem('egybook-comments-v1',JSON.stringify(commentData));}catch{showToast('مساحة التخزين ممتلئة؛ لم يتم حفظ التعليق.');}}
  function getActiveProfileName(){
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return (saved && saved.name || profileData.name || 'حسابي').trim();
    } catch (_) { return (profileData.name || 'حسابي').trim(); }
  }
  function openComments(post){
    activeCommentsPost=post;
    replyToComment=null;
    const input=$('#commentInput');
    input.blur();
    input.value='';
    input.placeholder=`تعليق باسم ${getActiveProfileName()} ...`;
    $('#commentsSortMenu').hidden=true;
    $('#commentsSortButton').setAttribute('aria-expanded','false');
    renderComments();
    openModal($('#commentsModal'));
    // Deliberately do not autofocus: the keyboard should open only after the user taps the input.
  }
  function findCommentById(items,id){
    for(const item of (items||[])){
      if(item.id===id)return item;
      const nested=findCommentById(item.replies,id);if(nested)return nested;
    }
    return null;
  }
  function renderComments(){
    if(!activeCommentsPost)return;
    const list=$('#commentsList'),items=[...getCommentsFor(activeCommentsPost)];
    if(commentSortMode==='newest')items.reverse();
    list.replaceChildren();
    const countAll=arr=>(arr||[]).reduce((n,c)=>n+1+countAll(c.replies),0);
    const total=countAll(items);
    $('#commentsCount').textContent=`${total} تعليق`;
    if(!items.length){const empty=document.createElement('p');empty.className='comments-empty';empty.textContent='كن أول من يعلّق على المنشور.';list.append(empty);}
    const renderItem=(c,depth=0)=>{
      c.replies=c.replies||[];
      const row=document.createElement('article');row.className='egy-comment'+(depth?' egy-comment-reply':'');row.dataset.commentId=c.id;row.style.setProperty('--reply-depth',Math.min(depth,3));
      const main=document.createElement('div');main.className='egy-comment-main';
      const meta=document.createElement('div');meta.className='egy-comment-meta';
      const name=document.createElement('button');name.type='button';name.className='egy-comment-name comment-profile-link';name.textContent=c.name||'عضو EgyBook';name.addEventListener('click',()=>showProfile());
      const time=document.createElement('span');time.textContent='· '+(c.time||'الآن');meta.append(name,time);
      const body=document.createElement('div');body.className='egy-comment-text';body.textContent=c.text||'';
      const actions=document.createElement('div');actions.className='egy-comment-actions';
      const reply=document.createElement('button');reply.className='reply';reply.dataset.action='comment-reply';reply.textContent='رد';
      const hide=document.createElement('button');hide.dataset.action='comment-hide';hide.textContent='إخفاء';actions.append(reply,hide);
      main.append(meta,body,actions);
      const avatar=document.createElement('button');avatar.type='button';avatar.className='egy-comment-avatar comment-profile-link';avatar.setAttribute('aria-label','فتح الملف الشخصي');
      if(c.name===getActiveProfileName()&&profileData.avatar){avatar.style.backgroundImage=`url("${profileData.avatar}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';avatar.textContent='';}
      else avatar.textContent=(c.name||'ع').trim().slice(0,1);
      avatar.addEventListener('click',()=>showProfile());
      const votes=document.createElement('div');votes.className='egy-comment-votes';
      const reactionSummary=document.createElement('span');reactionSummary.className='comment-reaction-counts';
      const likes=(c.vote==='like'?1:0),dislikes=(c.vote==='dislike'?1:0);
      reactionSummary.innerHTML=`<span class="reaction-count-like">👍 ${likes}</span><span class="reaction-count-dislike">👎 ${dislikes}</span>`;
      [['👎','dislike'],['👍','like']].forEach(([label,type])=>{
        const b=document.createElement('button');b.className='comment-vote'+(c.vote===type?' active':'');
        b.textContent=(type==='like'&&c.reaction)?c.reaction:label;b.dataset.action='comment-vote';b.dataset.vote=type;
        b.setAttribute('aria-label',type==='like'?'إعجاب بالتعليق':'عدم الإعجاب بالتعليق');votes.append(b);
      });
      votes.append(reactionSummary);
      row.append(main,avatar,votes);
      if(c.replies.length){
        const replies=document.createElement('div');replies.className='comment-replies';
        c.replies.forEach(r=>replies.append(renderItem(r,depth+1)));row.append(replies);
      }
      return row;
    };
    items.forEach(c=>list.append(renderItem(c)));
  }
    function showCommentReactionPicker(button){
    const picker=$('#commentReactionPicker'),r=button.getBoundingClientRect();
    picker.style.left=Math.max(8,Math.min(innerWidth-300,r.left-100))+'px';
    picker.style.top=Math.max(8,r.top-58)+'px';picker.hidden=false;
    picker.dataset.target='post';picker.dataset.postId=activeCommentsPost?.dataset.postId||'';
  }
  let commentPressTimer=null,commentLongPressed=false;
  // Prevent Android text-selection/context menus from replacing the in-app reaction picker.
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('.post [data-action="like"], #commentsList .comment-vote[data-vote="like"], #commentReactionPicker')) e.preventDefault();
  });
  document.addEventListener('selectstart', e => {
    if (e.target.closest('.post [data-action="like"], #commentsList .comment-vote[data-vote="like"], #commentReactionPicker')) e.preventDefault();
  });

  document.addEventListener('click', event => {
    const activePicker=$('#commentReactionPicker');
    if(activePicker && !activePicker.hidden && !event.target.closest('#commentReactionPicker') && !event.target.closest('[data-action="like"]')) activePicker.hidden=true;
    const button = event.target.closest('button'); if (!button) return;
    const action = button.dataset.action;
    if(action==='comments-close'){closeModal($('#commentsModal'));activeCommentsPost=null;replyToComment=null;return;}
    if(action==='comments-sort'){const menu=$('#commentsSortMenu');menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));return;}
    if(action==='sort-comments'){commentSortMode=button.dataset.sort;$('#commentsSortMenu').hidden=true;$('#commentsSortButton').querySelector('span').textContent=button.querySelector('span').textContent;$$('#commentsSortMenu button').forEach(b=>b.classList.toggle('active',b===button));renderComments();return;}
    if(action==='comment-reply'){replyToComment=button.closest('.egy-comment')?.dataset.commentId||null;$('#commentInput').placeholder='اكتب ردك...';$('#commentInput').focus();return;}
    if(action==='comment-hide'){const row=button.closest('.egy-comment');if(row)row.remove();return;}
    if(action==='comment-vote'){const row=button.closest('.egy-comment'),c=findCommentById(getCommentsFor(activeCommentsPost),row?.dataset.commentId);if(c){c.vote=c.vote===button.dataset.vote?null:button.dataset.vote;saveComments();renderComments();}return;}
    if (button.dataset.page) { setPage(button.dataset.page); return; }
    if (action === 'open-composer') openModal($('#composerMenuModal'));
    else if (action === 'composer-post') { closeModal($('#composerMenuModal')); $('#composerTitle').textContent='إنشاء منشور'; $('#postContent').placeholder='ماذا تريد أن تشارك اليوم؟'; openModal(createPostModal); }
    else if (action === 'composer-story') { closeModal($('#composerMenuModal')); showToast('واجهة القصص ستحتاج إلى تخزين وعرض مستقلين؛ لم يتم نشر قصة وهمية.'); }
    else if (action === 'composer-reel') { closeModal($('#composerMenuModal')); showToast('إنشاء الريلز يحتاج إلى واجهة فيديو مستقلة؛ يمكنك نشر فيديو من المنشور حاليًا.'); }
    else if (action === 'composer-live') { closeModal($('#composerMenuModal')); showToast('البث المباشر يحتاج إلى خدمة بث وخادم، ولا يمكن تشغيله من الواجهة وحدها.'); }
    else if (action === 'composer-note') { closeModal($('#composerMenuModal')); openModal(createPostModal); $('#composerTitle').textContent='إنشاء ملاحظة'; $('#postContent').placeholder='اكتب ملاحظتك القصيرة...'; }
    else if (action === 'close-modal') closeModal(button.closest('.modal'));
    else if (action === 'search') openModal($('#searchModal'));
    else if (action === 'run-search') runSearch();
    else if (action === 'messages') showToast('الرسائل غير متصلة بخادم في النسخة التجريبية.');
    else if (action === 'notifications') showToast('لا توجد إشعارات حقيقية متصلة حاليًا.');
    else if (action === 'profile') showProfile();
    else if (action === 'profile-back') setPage('home');
    else if (action === 'profile-photo') $('#profilePhotoInput').click();
    else if (action === 'profile-cover') $('#profileCoverInput').click();
    else if (action === 'profile-settings') openEditProfile();
    else if (action === 'edit-profile') openEditProfile();
    else if (action === 'profile-share') { const url=location.href.split('#')[0]+'#user/'+encodeURIComponent(profileData.username||'egybook_user'); if(navigator.share) navigator.share({title:profileData.name||'EgyBook',text:'تابعني على EgyBook',url}).catch(()=>{}); else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط ملفك الشخصي.')).catch(()=>showToast(url));else showToast(url); }
    else if (action === 'profile-section') { const section=button.dataset.section; if(section==='saved'){setPage('saved');showToast('دي المنشورات المحفوظة على الجهاز.');}else if(section==='friends'){showToast('مفيش أصدقاء مضافين حتى الآن.');}else if(section==='followers'){showToast('قائمة المتابعين تحتاج إلى حسابات متصلة.');}else if(section==='photos'){openAlbums();}else if(section==='videos'){ $('#profilePostsTitle').textContent='فيديوهاتي'; const target=$('#profilePostsList');target.replaceChildren();const own=$$('.post[data-user-post="true"]',postsList).filter(p=>!!$('video.post-image',p));own.forEach(p=>target.append(p.cloneNode(true)));if(!own.length)target.textContent='لسه مفيش فيديوهات منشورة.';}else{ $('#profilePostsTitle').textContent='منشوراتي';renderProfilePosts();} }
    else if (action === 'photo') photoInput.click();
    else if (action === 'video') videoInput.click();
    else if (action === 'location') showToast('مشاركة الموقع غير مفعلة في هذه النسخة.');
    else if (action === 'music') showToast('إضافة الموسيقى غير مفعلة في هذه النسخة.');
    else if (action === 'add-story') showToast('ميزة القصص تحتاج إلى تخزين ومشاركة عبر الخادم.');
    else if (action === 'all-stories') showToast('أنت تشاهد القصص المتاحة في العرض التجريبي.');
    else if (action === 'story') showToast(`قصة ${button.dataset.name || ''} — عرض تجريبي.`);
    else if (action === 'sort') { sortNewestFirst = !sortNewestFirst; const items = $$('.post', postsList); items.sort((a,b) => { const timeA = Number(a.dataset.createdAt) || 0; const timeB = Number(b.dataset.createdAt) || 0; return sortNewestFirst ? timeB - timeA : timeA - timeB; }); items.forEach(item => postsList.append(item)); button.textContent = sortNewestFirst ? 'الأحدث ▾' : 'الأقدم ▾'; }
    else if (action === 'comment') { const post=button.closest('.post'); if(post)openComments(post); }
    else if (action === 'like') { if(longPressTriggered){longPressTriggered=false;return;} const post=button.closest('.post'); if(button.dataset.currentReaction){button.classList.remove('reacted');delete button.dataset.currentReaction;const icon=$('.action-icon',button);if(icon)icon.textContent='👍';$$('span',button)[1].textContent='إعجاب';if(post.dataset.postId){delete postState[post.dataset.postId]?.reaction;delete postState[post.dataset.postId]?.reactionLabel;savePostState();}showToast('تم إلغاء التفاعل.');}else selectReaction(post,'👍','إعجاب'); }
    else if (action === 'save') { button.classList.toggle('saved'); $('span:last-child', button).textContent = button.classList.contains('saved') ? 'تم الحفظ' : 'حفظ'; const p=button.closest('.post');if(p?.dataset.postId){postState[p.dataset.postId]={...(postState[p.dataset.postId]||{}),saved:button.classList.contains('saved')};savePostState();} showToast(button.classList.contains('saved') ? 'تم حفظ المنشور على هذا الجهاز.' : 'تم إلغاء حفظ المنشور.'); }
    else if (action === 'share') { const post = button.closest('.post'); const text = $('.post-text', post)?.textContent || 'منشور على EgyBook'; if(post){const id=post.dataset.postId;postState[id]={...(postState[id]||{}),shareCount:(Number(postState[id]?.shareCount)||0)+1};savePostState();const sc=$('.share-count',post);if(sc)sc.textContent=formatPostCount(postState[id].shareCount);syncPostStats(post);} if (navigator.share) navigator.share({title:'EgyBook', text}).catch(()=>{}); else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(()=>showToast('تم نسخ نص المنشور للمشاركة.')).catch(()=>showToast('المشاركة غير متاحة في هذا المتصفح.')); else showToast('المشاركة غير متاحة في هذا المتصفح.'); }
    else if (action === 'post-menu') { currentMenuPost=button.closest('.post'); openPostControls(currentMenuPost); }
    else if (action === 'post-control') { handlePostControl(button.dataset.control); }
  });
  document.addEventListener('pointerdown',event=>{
    const b=event.target.closest('[data-action="like"]'); if(!b) return;
    longPressTimer=setTimeout(()=>{
      reactionTarget=b.closest('.post'); longPressTriggered=true;
      showCommentReactionPicker(b);
      const picker=$('#commentReactionPicker');
      if(picker){picker.dataset.target='post';picker.dataset.postId=reactionTarget?.dataset.postId||'';}
      longPressTimer=null;
    },550);
  });
  document.addEventListener('pointermove',event=>{if(longPressTimer && event.target.closest?.('[data-action="like"]')===null){clearTimeout(longPressTimer);longPressTimer=null;}},{passive:true});

  ['pointerup','pointerleave','pointercancel'].forEach(type=>document.addEventListener(type,event=>{if(longPressTimer&&(!event.target.closest||!event.target.closest('[data-action="like"]'))){clearTimeout(longPressTimer);longPressTimer=null;}}));
  $$('.reaction-picker [data-reaction]').forEach(b=>b.addEventListener('click',()=>selectReaction(reactionTarget,b.dataset.reaction,b.dataset.label)));
  $('#editProfileForm').addEventListener('submit',event=>{event.preventDefault();const username=$('#editUsername').value.trim().replace(/^@/,'');if(!/^[A-Za-z0-9._]{3,30}$/.test(username)){showToast('اسم المستخدم يجب أن يكون 3–30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');return;}profileData={...profileData,name:$('#editName').value.trim(),username,bio:$('#editBio').value.trim(),location:$('#editLocation').value.trim(),birthdate:$('#editBirthdate').value,gender:$('#editGender').value,website:$('#editWebsite').value.trim(),phone:$('#editPhone').value.trim(),privacy:$('#editPrivacy').value};saveProfile();applyProfile();closeModal($('#editProfileModal'));if(supabase&&currentUser){supabase.from('profiles').upsert(cloudProfilePayload(),{onConflict:'id'}).then(({error})=>showToast(error?'تم حفظ الملف على هذا الجهاز، لكن تعذر تحديث الحساب: '+error.message:'تم حفظ الملف الشخصي بنجاح.'));}else showToast('تم حفظ الملف على هذا الجهاز. سجّل الدخول لحفظه في حسابك.');});
  $('#profileCoverInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'cover');event.target.value='';});
  $$('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal.open').forEach(closeModal); });
  $('#postForm').addEventListener('submit', publishPost);
  $('#profilePhotoInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'avatar');event.target.value='';});
  photoInput.addEventListener('change', () => { readMedia(photoInput.files[0], 'image'); photoInput.value = ''; openModal(createPostModal); });
  videoInput.addEventListener('change', () => { readMedia(videoInput.files[0], 'video'); videoInput.value = ''; openModal(createPostModal); });
  $('#searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });

  // Global in-app swipe navigation. Horizontal swipes are handled before
  // the browser can interpret them as a page/edge gesture where supported.
  let gestureStartX = 0, gestureStartY = 0, gestureStartTime = 0;
  let gestureTracking = false, gestureHorizontal = false;
  const gestureIgnore = 'input, textarea, select, [contenteditable="true"], video, audio, .modal.open';
  const gestureSurface = () => document.querySelector('#profilePage:not([hidden])') || document.querySelector('.container:not([hidden])') || document.body;

  document.addEventListener('touchstart', event => {
    gestureTracking = false;
    gestureHorizontal = false;
    if (event.touches.length !== 1 || event.target.closest(gestureIgnore)) return;
    const touch = event.touches[0];
    gestureStartX = touch.clientX;
    gestureStartY = touch.clientY;
    gestureStartTime = Date.now();
    gestureTracking = true;
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', event => {
    if (!gestureTracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gestureStartX;
    const dy = touch.clientY - gestureStartY;
    if (!gestureHorizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      gestureHorizontal = true;
    }
    // Prevent browser horizontal navigation/tab gestures when the browser
    // allows page JavaScript to cancel them. Keep normal vertical scrolling.
    if (gestureHorizontal && event.cancelable) event.preventDefault();
  }, { passive: false, capture: true });

  document.addEventListener('touchend', event => {
    if (!gestureTracking || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - gestureStartX;
    const dy = event.changedTouches[0].clientY - gestureStartY;
    const elapsed = Date.now() - gestureStartTime;
    gestureTracking = false;
    if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 1.3 || elapsed > 900) return;

    const openModalElement = $('.modal.open');
    if (openModalElement) { closeModal(openModalElement); return; }

    // Right swipe: return from any in-app section to Home.
    if (dx > 0 && currentPage !== 'home') {
      setPage('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (dx < 0 && currentPage === 'profile') {
      // Left swipe on profile also returns to Home for users who use RTL
      // gestures in the opposite direction.
      setPage('home');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, { passive: true, capture: true });

  document.addEventListener('touchcancel', () => {
    gestureTracking = false;
    gestureHorizontal = false;
  }, { passive: true, capture: true });

  // Keep browser overscroll from taking over horizontal gestures when supported.
  document.documentElement.style.overscrollBehaviorX = 'none';
  document.body.style.overscrollBehaviorX = 'none';


  $('#commentForm').addEventListener('submit',e=>{
    e.preventDefault();const text=$('#commentInput').value.trim();if(!text||!activeCommentsPost)return;
    const c={id:'c-'+Date.now(),name:getActiveProfileName(),time:'الآن',text,likes:0,dislikes:0,replies:[]};
    const arr=getCommentsFor(activeCommentsPost);
    if(replyToComment){const parent=findCommentById(arr,replyToComment);if(parent){parent.replies=parent.replies||[];parent.replies.push({...c,id:'r-'+Date.now()});}replyToComment=null;$('#commentInput').placeholder=`تعليق باسم ${getActiveProfileName()} ...`;}
    else arr.push(c);
    saveComments();$('#commentInput').value='';renderComments();
    syncPostStats(activeCommentsPost);
  });
  $('#commentReactionPicker').addEventListener('click',e=>{
    const b=e.target.closest('[data-reaction]');if(!b)return;
    const picker=$('#commentReactionPicker');
    if(picker.dataset.target==='comment'){
      const row=$(`[data-comment-id="${CSS.escape(picker.dataset.commentId||'')}"]`,$('#commentsList'));
      const c=findCommentById(getCommentsFor(activeCommentsPost),picker.dataset.commentId);
      if(c){c.reaction=b.dataset.reaction;c.vote='like';saveComments();renderComments();}
    } else {
      const post=$$('.post').find(p=>p.dataset.postId===picker.dataset.postId);
      if(post){const like=$('[data-action="like"]',post);if(like){like.dataset.currentReaction=b.dataset.reaction;like.classList.add('reacted');const icon=$('.action-icon',like);if(icon)icon.textContent=b.dataset.reaction;}}
    }
    picker.hidden=true;picker.dataset.target='post';showToast('تم تسجيل التفاعل '+b.dataset.reaction);
  });
  document.addEventListener('pointerdown',e=>{
    const commentLike=e.target.closest('#commentsList .comment-vote[data-vote="like"]');
    if(commentLike){
      clearTimeout(commentPressTimer);
      commentPressTimer=setTimeout(()=>{
        commentLongPressed=true;
        const row=commentLike.closest('.egy-comment');
        const picker=$('#commentReactionPicker'),r=commentLike.getBoundingClientRect();
        picker.dataset.target='comment';picker.dataset.commentId=row?.dataset.commentId||'';
        picker.style.left=Math.max(8,Math.min(innerWidth-300,r.left-80))+'px';
        picker.style.top=Math.max(8,r.top-65)+'px';picker.hidden=false;
      },430);
      return;
    }
    const like=e.target.closest('.post [data-action="like"]');if(!like)return;
    commentLongPressed=false;commentPressTimer=setTimeout(()=>{commentLongPressed=true;const post=like.closest('.post');$('#commentReactionPicker').dataset.postId=post?.dataset.postId||'';const picker=$('#commentReactionPicker'),r=like.getBoundingClientRect();picker.style.left=Math.max(8,Math.min(innerWidth-300,r.left-80))+'px';picker.style.top=Math.max(8,r.top-65)+'px';picker.hidden=false;},430);
  },{passive:true});
  ['pointerup','pointercancel','pointermove'].forEach(type=>document.addEventListener(type,()=>{if(type==='pointermove' && commentPressTimer){clearTimeout(commentPressTimer);commentPressTimer=null;return;}clearTimeout(commentPressTimer);commentPressTimer=null;if(type==='pointerup'&&commentLongPressed){setTimeout(()=>{commentLongPressed=false;},80);}}, {passive:true}));
  document.addEventListener('click',e=>{if(!e.target.closest('#commentReactionPicker')&&!e.target.closest('.post [data-action="like"]')&&!e.target.closest('#commentsList .comment-vote[data-vote="like"]'))$('#commentReactionPicker').hidden=true;});
  $('#commentsModal').addEventListener('click',e=>{if(e.target===$('#commentsModal')){closeModal($('#commentsModal'));activeCommentsPost=null;}});

  // Authentication + cloud feed lifecycle. Account creation is real Supabase Auth.
  let authMode = 'login';
  function cloudProfilePayload(){
    const safeUsername=(profileData.username||'egybook_user').replace(/[^A-Za-z0-9._]/g,'_').slice(0,30);
    return {id:currentUser.id,username:safeUsername,full_name:profileData.name||'عضو EgyBook',avatar_url:profileData.avatar||null,cover_url:profileData.cover||null,bio:profileData.bio||'',updated_at:new Date().toISOString()};
  }
  async function restoreCloudProfile(){
    if(!supabase||!currentUser)return;
    const {data,error}=await supabase.from('profiles').select('username,full_name,avatar_url,cover_url,bio').eq('id',currentUser.id).maybeSingle();
    if(error){console.warn('Cloud profile load:',error.message);return;}
    if(!data)return;
    profileData={...profileData,username:data.username||profileData.username,name:data.full_name||profileData.name,avatar:data.avatar_url||'',cover:data.cover_url||'',bio:data.bio||''};
    saveProfile();applyProfile();
  }
  function setAuthMode(mode){
    authMode=mode;
    const signup=mode==='signup';
    $('#authLoginTab').classList.toggle('active',!signup);$('#authSignupTab').classList.toggle('active',signup);
    $('#authLoginTab').setAttribute('aria-selected',String(!signup));$('#authSignupTab').setAttribute('aria-selected',String(signup));
    $('#authTitle').textContent=signup?'إنشاء حساب جديد':'مرحبًا بعودتك';
    $('#authSubtitle').textContent=signup?'انضم إلى مجتمع EgyBook وابدأ رحلتك الآن':'سجّل دخولك لمتابعة أصدقائك ومشاركة لحظاتك';
    $('#authNameWrap').hidden=!signup;$('#authUsernameWrap').hidden=!signup;$('#authConfirmWrap').hidden=!signup;$('#authOptions').hidden=signup;
    $('#supabaseAuthPassword').autocomplete=signup?'new-password':'current-password';
    $('#supabaseSignIn').innerHTML=signup?'إنشاء الحساب <span>➜</span>':'تسجيل الدخول <span>➜</span>';
    $('#supabaseAuthHint').textContent=signup?'استخدم بريدًا إلكترونيًا صالحًا وكلمة مرور من 8 أحرف على الأقل. قد تحتاج إلى تأكيد البريد.':'استخدم بريدًا إلكترونيًا يمكنك الوصول إليه؛ قد يُطلب تأكيده.';
  }
  function updateAuthGate(){
    const modal=$('#supabaseAuthModal');
    document.body.classList.toggle('auth-required', !currentUser);
    if(!currentUser){
      if(modal){ modal.hidden=false; modal.classList.add('open'); }
      document.body.style.overflow='hidden';
      setAuthMode(authMode==='signup'?'signup':'login');
    } else {
      if(modal){ modal.classList.remove('open'); modal.hidden=true; }
      document.body.style.overflow='';
    }
  }
  function refreshAuthUI(){
    const b=$('#authEntry');if(!b)return;
    b.textContent=currentUser?(currentUser.user_metadata?.full_name||currentUser.email||'حسابي'):'تسجيل الدخول';
    b.classList.toggle('is-signed-in',!!currentUser);
    $('#supabaseSignOut').hidden=!currentUser;
    $('#authLoginTab').hidden=!!currentUser;$('#authSignupTab').hidden=!!currentUser;
    $('#supabaseAuthEmail').disabled=!!currentUser;$('#supabaseAuthPassword').disabled=!!currentUser;
    $('#authNameWrap').hidden=!!currentUser||authMode!=='signup';$('#authUsernameWrap').hidden=!!currentUser||authMode!=='signup';$('#authConfirmWrap').hidden=!!currentUser||authMode!=='signup';$('#authOptions').hidden=!!currentUser||authMode==='signup';
    $('#supabaseSignIn').hidden=!!currentUser;$('#supabaseAuthHint').textContent=currentUser?'تم تسجيل الدخول. يمكنك تسجيل الخروج من هنا.':(authMode==='signup'?'استخدم بريدًا صالحًا؛ قد يُطلب تأكيده.':'استخدم بريدًا إلكترونيًا يمكنك الوصول إليه؛ قد يُطلب تأكيده.');
    updateAuthGate();
  }
  $('#authEntry').addEventListener('click',()=>{setAuthMode(currentUser?'login':'login');refreshAuthUI();openModal($('#supabaseAuthModal'));});
  $('#authLoginTab').addEventListener('click',()=>setAuthMode('login'));
  $('#authSignupTab').addEventListener('click',()=>setAuthMode('signup'));
  $('#supabaseAuthForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!supabase)return showToast('تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مرة أخرى.');
    const email=$('#supabaseAuthEmail').value.trim(),password=$('#supabaseAuthPassword').value,b=$('#supabaseSignIn');
    if(authMode==='signup'){
      const fullName=$('#authFullName').value.trim(),username=$('#authUsername').value.trim();
      if(fullName.length<2)return showToast('اكتب اسمك الكامل.');
      if(!/^[A-Za-z0-9._]{3,30}$/.test(username))return showToast('اسم المستخدم من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');
      if(password!==$('#authConfirmPassword').value)return showToast('كلمتا المرور غير متطابقتين.');
      profileData={...profileData,name:fullName,username};saveProfile();
      b.disabled=true;
      try{
        const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,username}}});if(error)throw error;
        if(data.session&&data.user){currentUser=data.user;await supabase.from('profiles').upsert({id:currentUser.id,username,full_name:fullName,bio:profileData.bio||'',avatar_url:profileData.avatar||null,cover_url:profileData.cover||null,updated_at:new Date().toISOString()},{onConflict:'id'});await restoreCloudProfile();refreshAuthUI();closeModal($('#supabaseAuthModal'));await restorePosts();showToast('تم إنشاء الحساب بنجاح.');}
        else{setAuthMode('login');updateAuthGate();showToast('تم إرسال طلب إنشاء الحساب. افتح بريدك الإلكتروني لتأكيده ثم سجّل الدخول.');}
      }catch(err){showToast('تعذر إنشاء الحساب: '+(err.message||'تحقق من البيانات أو اسم المستخدم.'));}
      finally{b.disabled=false;}
      return;
    }
    b.disabled=true;
    try{const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;currentUser=data.user;await restoreCloudProfile();refreshAuthUI();closeModal($('#supabaseAuthModal'));await restorePosts();const payload=cloudProfilePayload();const {error:profileError}=await supabase.from('profiles').upsert(payload,{onConflict:'id'});if(profileError)console.warn('Profile sync:',profileError.message);showToast('تم تسجيل الدخول إلى EgyBook.');}
    catch(err){showToast('تعذر تسجيل الدخول: '+err.message);}
    finally{b.disabled=false;}
  });
  $('#authForgot').addEventListener('click',async()=>{if(!supabase)return showToast('تعذر الاتصال بخدمة الحسابات.');const email=$('#supabaseAuthEmail').value.trim();if(!email)return showToast('اكتب بريدك الإلكتروني أولًا.');try{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;showToast('لو البريد مسجل، هيوصلك رابط استعادة كلمة المرور.');}catch(err){showToast('تعذر إرسال رابط الاستعادة: '+err.message);}});
  $('#supabaseSignOut').addEventListener('click',async()=>{try{const {error}=await supabase.auth.signOut();if(error)throw error;currentUser=null;refreshAuthUI();setAuthMode('login');closeModal($('#supabaseAuthModal'));postsList.querySelectorAll('.post[data-cloud-post="true"]').forEach(p=>p.remove());showToast('تم تسجيل الخروج.');}catch(err){showToast('تعذر تسجيل الخروج: '+err.message);}});
  async function initializeCloud(){if(!supabase){showToast('تعذر الاتصال بالخدمة. حاول مرة أخرى.');return;}try{const {data,error}=await supabase.auth.getSession();if(error)throw error;currentUser=data.session?.user||null;refreshAuthUI();await refreshVerificationBadge();if(currentUser){await restoreCloudProfile();await restorePosts();}supabase.auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;refreshAuthUI();refreshVerificationBadge();if(currentUser)setTimeout(async()=>{await restoreCloudProfile();await restorePosts();},0);else postsList.querySelectorAll('.post[data-cloud-post="true"]').forEach(p=>p.remove());});}catch(err){console.error(err);showToast('تعذر تسجيل الدخول: '+err.message);}}
  loadProfile(); applyProfile(); syncAllPostStats(); updateEmptyState(); refreshAuthUI(); initializeCloud();
})();
