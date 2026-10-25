
  // Preserve the deep-link route before first paint so profile refresh never flashes Home.
  (() => {
    try {
      const path = String(location.pathname || '').replace(/\/+$/, '').toLowerCase();
      const profileMatch = path.match(/^\/egybook\/([^/]+)$/);
      if (!profileMatch) return;
      const username = decodeURIComponent(profileMatch[1]);
      document.documentElement.classList.add('egybook-profile-bootstrap');
      document.documentElement.dataset.initialProfileRoute = username;
    } catch (_) {}
  })();

'use strict';
document.documentElement.classList.add('egybook-profile-bootstrap');
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
  let storageScope = 'guest';
  const scopedStorageKey = key => `${key}::${storageScope}`;
  const defaultProfile = () => ({name:'حسابي',username:'egybook_user',bio:'أهلاً بيكم في حسابي على EgyBook 💙\nتواصل • شارك • اكتشف أكثر',location:'مصر',birthdate:'',gender:'',website:'',phone:'',privacy:'عام',avatar:'',cover:''});
  let currentMenuPost = null;
  let currentAlbum = null;
  let postState = {};
  let albumsData = {cover:[], avatar:[], posts:[]};
  let followersCount = 0;
  const REACTIONS = ['👍','❤️','😮','😂','😢','😡'];
  let profileData = defaultProfile();

  // Keep all browser caches separate for each signed-in account.
  // Legacy global keys are intentionally ignored because they can belong to another user.
  function activateAccountStorage(userId, seedProfile=null){
    // Profile and feed content must be restored from Supabase, not browser-local caches.
    storageScope = userId ? `user:${userId}` : 'guest';
    profileData = seedProfile ? {...defaultProfile(),...seedProfile} : defaultProfile();
    postState = {};
    albumsData = {cover:[], avatar:[], posts:[]};
    followersCount = 0;
    try {
      const legacyPrefixes = [PROFILE_KEY, STORAGE_KEY, POST_STATE_KEY, ALBUMS_KEY, FOLLOWERS_KEY, 'egybook-comments-v1', 'egybook_saved_photos_v1'];
      for(let i=localStorage.length-1;i>=0;i--){
        const key=localStorage.key(i)||'';
        if(legacyPrefixes.some(prefix=>key===prefix || key.startsWith(prefix+'::'))) localStorage.removeItem(key);
      }
    } catch (_) {}
    applyProfile();
  }
  const OWNER_USER_ID = '83cbb858-a62f-469a-9723-2919ead6bc58';

  function isOwnerAccount(){
    return !!currentUser && currentUser.id === OWNER_USER_ID;
  }

  function makeVerifiedBadge({owner=false}={}){
    const badge=document.createElement('button');
    badge.type='button';
    badge.className='verified-badge'+(owner?' verified-badge-owner':' verified-badge-inactive');
    badge.dataset.verifiedBadge='';
    badge.setAttribute('aria-label',owner?'هذا الحساب موثّق':'طلب توثيق الحساب');
    badge.title=owner?'هذا الحساب موثّق':'طلب توثيق الحساب';
    badge.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.2 3.1 3.1L15.4 6"/></svg>';
    return badge;
  }

  function setNamePreservingBadge(nameElement,name){
    if(!nameElement)return;
    const badge=nameElement.querySelector('[data-verified-badge]');
    nameElement.replaceChildren(document.createTextNode(name||'حسابي'));
    if(badge)nameElement.append(badge);
  }

  function addOwnerBadgeToName(nameElement){
    if(!nameElement || nameElement.querySelector('[data-verified-badge]'))return;
    nameElement.append(makeVerifiedBadge({owner:true}));
  }
  function addBadgeToUserName(nameElement,userId){
    if(!nameElement)return;
    // The profile title already has a dedicated #profileVerifiedBadge sibling.
    // Do not append a second badge inside #profileNameText.
    if(nameElement.id==='profileNameText'){
      // The profile heading has a dedicated badge element. Its own async
      // verification resolver controls active/inactive styling; don't overwrite
      // a verified result with a generic gray state while rendering the name.
      const profileBadge=document.querySelector('#profileVerifiedBadge');
      if(profileBadge){profileBadge.hidden=false;refreshViewedProfileVerification();}
      return;
    }
    let badge=nameElement.querySelector('[data-verified-badge]');
    if(!badge){badge=makeVerifiedBadge({owner:userId===OWNER_USER_ID});nameElement.append(badge);}
    if(userId===OWNER_USER_ID){badge.classList.remove('verified-badge-inactive');badge.title='هذا الحساب موثّق';badge.setAttribute('aria-label','هذا الحساب موثّق');return;}
    if(userId && supabase){
      badge.classList.add('verified-badge-inactive');
      supabase.from('verified_accounts').select('user_id,verification_type,expires_at').eq('user_id',userId).maybeSingle()
        .then(({data,error})=>{if(error)return;const active=!!data&&(!data.expires_at||new Date(data.expires_at)>new Date());const b=nameElement.querySelector('[data-verified-badge]');if(!b)return;if(active){b.classList.remove('verified-badge-inactive');b.title='هذا الحساب موثّق';b.setAttribute('aria-label','هذا الحساب موثّق');}else{b.classList.add('verified-badge-inactive');b.title='حساب غير موثّق';b.setAttribute('aria-label','حساب غير موثّق');}})
        .catch(()=>{});
    }else{badge.classList.add('verified-badge-inactive');}
  }


  // Keep exactly one verification badge in each name container. Multiple render
  // paths can append a badge when profile cards are refreshed or reused.
  function dedupeVerificationBadges(root=document){
    const nodes=[];
    if(root.nodeType===1 && root.matches('[data-verified-name], .profile-name, .post-author, .comment-author, .reply-author, .notification-actor-name')) nodes.push(root);
    if(root.querySelectorAll) nodes.push(...root.querySelectorAll('[data-verified-name], .profile-name, .post-author, .comment-author, .reply-author, .notification-actor-name'));
    nodes.forEach(node=>{
      const badges=[...node.querySelectorAll(':scope > [data-verified-badge], :scope > .verified')];
      badges.slice(1).forEach(b=>b.remove());
    });
  }
  // Run once and after dynamic UI updates; this is idempotent and does not
  // interfere with clicks or the real verification status query.
  if(document.documentElement && !window.__egybookBadgeDedupeObserver){
    dedupeVerificationBadges(document);
    window.__egybookBadgeDedupeObserver=new MutationObserver(records=>{
      records.forEach(record=>record.addedNodes.forEach(node=>{
        if(node.nodeType===1) dedupeVerificationBadges(node);
      }));
    });
    window.__egybookBadgeDedupeObserver.observe(document.documentElement,{childList:true,subtree:true});
  }

  function showVerifiedInfo(){
    let modal=$('#verifiedInfoModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='verifiedInfoModal';
      modal.className='verified-info-overlay';
      modal.hidden=true;
      modal.innerHTML='<section class="verified-info-card" role="dialog" aria-modal="true" aria-labelledby="verifiedInfoTitle"><button type="button" class="verified-info-close" aria-label="إغلاق">×</button><span class="verified-info-large"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.2 3.1 3.1L15.4 6"/></svg></span><h2 id="verifiedInfoTitle">هذا الحساب موثّق</h2><p>تم تأكيد هذا الحساب الرسمي على منصة EgyBook.</p><button type="button" class="verified-info-ok">حسنًا</button></section>';
      document.body.append(modal);
      modal.addEventListener('click',event=>{
        if(event.target===modal || event.target.closest('.verified-info-close,.verified-info-ok')) modal.hidden=true;
      });
    }
    modal.hidden=false;
  }

  async function refreshVerificationBadge(){
    const badge=$('#profileVerifiedBadge');
    if(!badge)return;
    badge.hidden=false;
    badge.classList.remove('owner-badge','verified-badge-inactive');
    badge.classList.add('verified-badge-inactive');
    badge.title='اضغط لطلب توثيق حسابك';
    badge.setAttribute('aria-label','اضغط لطلب توثيق حسابك');
    if(!currentUser||!supabase)return;
    if(isOwnerAccount()){
      badge.classList.remove('verified-badge-inactive');
      badge.classList.add('owner-badge');
      badge.title='حساب مالك الموقع موثّق';
      badge.setAttribute('aria-label','حساب مالك الموقع موثّق');
      return;
    }
    try{
      const {data,error}=await supabase.from('verified_accounts').select('user_id,verification_type,expires_at').eq('user_id',currentUser.id).maybeSingle();
      if(error||!data)return;
      if((!data.expires_at||new Date(data.expires_at)>new Date())&&data.verification_type!=='owner'){
        badge.classList.remove('verified-badge-inactive');
        badge.title='هذا الحساب موثّق';
        badge.setAttribute('aria-label','هذا الحساب موثّق');
      }
    }catch(_){}
  }
  let reactionTarget = null;
  let longPressTimer = null;
  let longPressTriggered = false;
  function saveProfile(){ /* Cloud profile writes are handled by Supabase save handlers. */ }
  function saveAlbums(){ /* Album cloud persistence is not configured; never write account data locally. */ }
  function savePostState(){ /* Interaction state is cloud-backed where supported; no local account cache. */ }
  function recordAlbumImage(kind, dataUrl, date=Date.now()){ if(!dataUrl)return; const list=albumsData[kind]||(albumsData[kind]=[]); list.unshift({id:`${kind}-${date}`,src:dataUrl,date}); albumsData[kind]=list.slice(0,60); saveAlbums(); }
  function restorePostState(post){ const state=postState[post.dataset.postId]; if(!state)return; if(state.saved){const b=$('[data-action="save"]',post);if(b){b.classList.add('saved');const label=$('span:last-child',b);if(label)label.textContent='تم الحفظ';}} if(state.reaction){const b=$('[data-action="like"]',post);if(b){b.classList.add('reacted');b.dataset.currentReaction=state.reaction;b.dataset.currentReactionLabel=state.reactionLabel||'تفاعل';const icon=$('.action-icon',b);if(icon)icon.textContent=state.reaction;const label=$$('span',b)[1];if(label)label.textContent=state.reactionLabel||'تفاعل';const icons=$('.reaction-icons',post);if(icons)icons.innerHTML=`<span>${state.reaction}</span>`;}} if(state.pinned)post.classList.add('post-pinned'); if(state.archived)post.hidden=true; if(state.trashed)post.hidden=true; }
  function applyAvatar(element){ if(!element)return; if(profileData.avatar){element.textContent='';element.style.backgroundImage=`url(\"${profileData.avatar}\")`;element.style.backgroundSize='cover';element.style.backgroundPosition='center';}else{element.style.backgroundImage='';element.textContent=(profileData.name||'ح').trim().charAt(0)||'ح';} }
  function updateRealProfileStats(){
    const postsCount=$('#profilePostsCount');
    // The profile-page counter is set by renderProfilePosts() from the selected user's Supabase rows.
    // Do not derive it from the home-feed DOM, which may contain only a partial feed.
    // No friends/followers backend is connected yet, so never display fabricated counts.
    // Do not reset the friends counter here: it is populated asynchronously from
    // the selected profile owner's accepted friend relationships.
    const followers=$('#profileFollowersCount');if(followers)followers.textContent=String(followersCount||0);
  }
  function applyCommentComposerAvatar(){
    const avatar=$('#commentMyAvatar');
    if(!avatar)return;
    avatar.style.backgroundImage='';
    avatar.style.backgroundSize='cover';
    avatar.style.backgroundPosition='center';
    if(profileData.avatar){
      avatar.textContent='';
      avatar.style.backgroundImage=`url("${String(profileData.avatar).replace(/"/g,'%22')}")`;
      avatar.classList.add('has-avatar-image');
    }else{
      avatar.classList.remove('has-avatar-image');
      avatar.textContent=(getActiveProfileName().trim().charAt(0)||'ح');
    }
    avatar.setAttribute('aria-label','فتح ملفي الشخصي');
    avatar.title='فتح ملفي الشخصي';
  }
  function applyProfile(){
    $('#profileNameText').textContent=profileData.name||'حسابي';addBadgeToUserName($('#profileNameText'),currentUser?.id||''); $('.profile-handle').textContent='@'+(profileData.username||'egybook_user'); $('.profile-bio').textContent=profileData.bio||'';
    const sideName=$('#sidebarAccountName'),sideHandle=$('#sidebarAccountHandle');
    if(sideName)sideName.textContent=profileData.name||currentUser?.user_metadata?.full_name||'حسابي';
    if(sideHandle)sideHandle.textContent='@'+(profileData.username||currentUser?.user_metadata?.username||'egybook_user');
    const details=$$('.profile-details span'); if(details[0])details[0].textContent='⌖ '+(profileData.location||'لم يحدد الموقع');
    const cover=$('.profile-cover');
    if(cover){
      const coverUrl=String(profileData.cover||'').trim();
      if(!coverUrl){cover.classList.remove('has-image');cover.style.backgroundImage='';}
      else if(cover.dataset.appliedCoverUrl!==coverUrl && cover.dataset.pendingCoverUrl!==coverUrl){
        cover.dataset.pendingCoverUrl=coverUrl;
        const image=new Image();
        image.decoding='async';
        image.onload=()=>{
          if(cover.dataset.pendingCoverUrl!==coverUrl)return;
          cover.style.backgroundImage=`url(\"${coverUrl.replace(/\"/g,'%22')}\")`;
          cover.classList.add('has-image');cover.dataset.appliedCoverUrl=coverUrl;delete cover.dataset.pendingCoverUrl;
        };
        image.onerror=()=>{if(cover.dataset.pendingCoverUrl===coverUrl)delete cover.dataset.pendingCoverUrl;};
        image.src=coverUrl;
        if(image.complete && image.naturalWidth)image.onload();
      }
    }
    updateRealProfileStats();applyCommentComposerAvatar();applyAvatar($('.profile-avatar'));applyAvatar($('.sidebar-account-avatar'));applyAvatar($('.profile-large-avatar'));applyAvatar($('.create-post .avatar'));$$('.post[data-user-post="true"] .post-header .avatar').forEach(applyAvatar);
    $$('.post[data-user-post="true"] .post-author .author-name').forEach(el=>setNamePreservingBadge(el,profileData.name||'حسابي'));
    $$('.post[data-user-post="true"] .post-header .avatar').forEach(applyAvatar);
    const link=location.origin+profilePath(profileData.username); const profileLink=$('#profileLink'); if(profileLink)profileLink.textContent=link;
  }
  function loadProfile(){ applyProfile(); }
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
      if(postsList && currentUser){
        const postId=`profile-update-${key}-${Date.now()}`;
        const article=document.createElement('article');article.className='post';article.dataset.postId=postId;article.dataset.userPost='true';article.dataset.createdAt=String(Date.now());article.dataset.media=publicUrl;article.dataset.mediaType='image';
        article.innerHTML=`<header class="post-header"><button class="avatar" type="button" data-action="profile" aria-label="الملف الشخصي"></button><div class="post-author"><div class="author-name"></div><div class="post-meta">الآن · تم تحديث ${key==='avatar'?'الصورة الشخصية':'صورة الغلاف'}</div></div></header><p class="post-text"></p><img class="post-image" alt="${key==='avatar'?'الصورة الشخصية الجديدة':'صورة الغلاف الجديدة'}"><div class="post-stats"><span>0 تفاعل</span><button data-action="comments-open">0 تعليق</button></div><div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon">👍</span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon">💬</span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon">↗</span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon">🔖</span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
        $('.author-name',article).textContent=profileData.name||'حسابي';$('.post-text',article).textContent=`قام ${profileData.name||'صاحب الحساب'} بتحديث ${key==='avatar'?'صورته الشخصية':'صورة غلافه'}.`;$('.post-image',article).src=publicUrl;postsList.prepend(article);applyAvatar($('.avatar',article));persistPosts();
      }
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
      if(supabase&&currentUser){
        const userId=currentUser.id;
        supabase.from('post_reactions').upsert({post_id:String(id),user_id:userId,reaction:emoji,updated_at:new Date().toISOString()},{onConflict:'post_id,user_id'})
          .then(async ({error})=>{
            if(error){console.error('Cloud reaction save failed:',{postId:String(id),message:error.message,code:error.code,details:error.details,hint:error.hint});showToast('تعذر حفظ التفاعل في السحابة: '+error.message);return;}
            if(currentUser?.id!==userId)return;
            await loadCloudPostStats(post);
          });
      } else {
        showToast('التفاعل ظاهر مؤقتًا فقط. سجّل الدخول لحفظه في السحابة.');
      }
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
    const commentCount = $('.comment-count', post);
    // Once cloud counts have loaded, never replace them with an empty in-memory cache.
    if (commentCount) {
      if (post.dataset.cloudCommentCount !== undefined) commentCount.textContent = formatPostCount(Number(post.dataset.cloudCommentCount)||0);
      else {
        const comments = getCommentsFor(post);
        const countAll = items => (items || []).reduce((n, item) => n + 1 + countAll(item.replies), 0);
        commentCount.textContent = formatPostCount(countAll(comments));
      }
    }
    const icons = $('.reaction-icons', post);
    const current = state.reaction || $('[data-action="like"]', post)?.dataset.currentReaction || '';
    if (icons) {
      const existing = [...icons.children].map(el => el.textContent.trim()).filter(Boolean);
      const ordered = [...new Set([current, ...existing].filter(Boolean))].slice(0, 3);
      icons.innerHTML = ordered.map(emoji => `<span>${emoji}</span>`).join('');
    }
    const likeCount = $('.like-count', post);
    if (likeCount) {
      const total = post.dataset.cloudReactionCount !== undefined
        ? Number(post.dataset.cloudReactionCount)||0
        : (current ? 1 : 0);
      likeCount.dataset.baseCount = String(total);
      likeCount.textContent = `${formatPostCount(total)} تفاعل`;
    }
    const shares = $('.share-count', post);
    if (shares) shares.textContent = formatPostCount(Number(state.shareCount)||0);
  }
  async function loadCloudPostStats(post) {
    const id=String(post?.dataset.postId||'');
    if(!id || !supabase) return;
    const userId=currentUser?.id||null;
    try {
      const [reactionResult, commentResult, mineResult] = await Promise.all([
        supabase.from('post_reactions').select('reaction',{count:'exact',head:false}).eq('post_id',id),
        supabase.from('post_comments').select('id',{count:'exact',head:true}).eq('post_id',id),
        userId ? supabase.from('post_reactions').select('reaction').eq('post_id',id).eq('user_id',userId).maybeSingle() : Promise.resolve({data:null,error:null})
      ]);
      if(currentUser?.id!==userId) return;
      if(reactionResult.error) throw reactionResult.error;
      if(commentResult.error) throw commentResult.error;
      post.dataset.cloudReactionCount=String(reactionResult.count ?? reactionResult.data?.length ?? 0);
      post.dataset.cloudCommentCount=String(commentResult.count ?? 0);
      const reactionRows=reactionResult.data||[];
      const icons=$('.reaction-icons',post);
      if(icons) icons.innerHTML=[...new Set(reactionRows.map(row=>row.reaction).filter(Boolean))].slice(0,3).map(emoji=>`<span>${emoji}</span>`).join('');
      if(mineResult.error && mineResult.error.code!=='PGRST116') throw mineResult.error;
      const button=$('[data-action="like"]',post);
      if(button) {
        if(mineResult.data?.reaction) {
          button.classList.add('reacted');button.dataset.currentReaction=mineResult.data.reaction;
          const icon=$('.action-icon',button);if(icon)icon.textContent=mineResult.data.reaction;
          const spans=$$('span',button);if(spans[1])spans[1].textContent='تفاعل';
        } else {
          button.classList.remove('reacted');delete button.dataset.currentReaction;
          const icon=$('.action-icon',button);if(icon)icon.textContent='👍';
          const spans=$$('span',button);if(spans[1])spans[1].textContent='إعجاب';
        }
      }
      syncPostStats(post);
      syncPostCopies(id,post);
    } catch(error) {
      console.error('Failed to load cloud post stats:',{postId:id,message:error?.message,code:error?.code,details:error?.details});
      // Keep the visible post intact; surface a diagnostic only when a real cloud query fails.
      post.dataset.cloudStatsError='true';
    }
  }
  function syncPostCopies(postId, sourcePost){
    if(!postId || !sourcePost)return;
    $$('.post').filter(el=>String(el.dataset.postId||'')===String(postId) && el!==sourcePost).forEach(target=>{
      ['cloudReactionCount','cloudCommentCount','cloudStatsError'].forEach(key=>{if(sourcePost.dataset[key]!==undefined)target.dataset[key]=sourcePost.dataset[key];});
      const sourceLike=$('[data-action="like"]',sourcePost),targetLike=$('[data-action="like"]',target);
      if(sourceLike&&targetLike){
        targetLike.classList.toggle('reacted',sourceLike.classList.contains('reacted'));
        if(sourceLike.dataset.currentReaction)targetLike.dataset.currentReaction=sourceLike.dataset.currentReaction;else delete targetLike.dataset.currentReaction;
        if(sourceLike.dataset.currentReactionLabel)targetLike.dataset.currentReactionLabel=sourceLike.dataset.currentReactionLabel;else delete targetLike.dataset.currentReactionLabel;
        const si=$('.action-icon',sourceLike),ti=$('.action-icon',target);if(si&&ti)ti.textContent=si.textContent;
        const ss=$$('span',sourceLike),ts=$$('span',target);if(ss[1]&&ts[1])ts[1].textContent=ss[1].textContent;
      }
      const sr=$('.reaction-icons',sourcePost),tr=$('.reaction-icons',target);if(sr&&tr)tr.innerHTML=sr.innerHTML;
      syncPostStats(target);
    });
  }
  function syncAllPostStats() { $$('.post').forEach(post=>{syncPostStats(post);loadCloudPostStats(post);}); updateRealProfileStats(); }
  function createPostElement({id, text, media, mediaType, visibility, createdAt, authorName, authorAvatar}) {
    const article = document.createElement('article');
    article.className = 'post';
    article.dataset.postId = id;
    const dateText = new Date(createdAt || Date.now()).toLocaleString('ar-EG', {dateStyle:'short', timeStyle:'short'});
    let mediaHTML = '';
    if (media && mediaType === 'image') mediaHTML = `<img class="post-image" src="${media}" alt="صورة مرفقة بالمنشور">`;
    else if (media && mediaType === 'video') mediaHTML = `<video class="post-image" src="${media}" controls playsinline></video>`;
    article.innerHTML = `
      <header class="post-header"><div class="avatar">${escapeHTML((authorName||'عضو EgyBook').trim().charAt(0)||'ح')}</div><div class="post-author"><div class="author-name">${escapeHTML(authorName||'عضو EgyBook')}</div><div class="post-meta">${escapeHTML(dateText)} · ${escapeHTML(visibility || 'الجميع')}</div></div><button class="more-button" data-action="post-menu" aria-label="خيارات المنشور">⋯</button></header>
      <p class="post-text"></p>${mediaHTML}
      <div class="post-stats"><div class="reaction-summary"><div class="reaction-icons"></div><button type="button" class="like-count stats-click" data-action="reactions-open">0 تفاعل</button></div><span class="stats-links"><button type="button" class="comment-count stats-click" data-action="comments-open">0</button> تعليق <span class="stats-separator" aria-hidden="true"></span><span class="share-count">0</span> مشاركة</span></div>
      <div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon">👍</span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon">▱</span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon">➦</span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon save-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v16L12 17l-7.5 4V5A1.5 1.5 0 0 1 6 3.5Z"/></svg></span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
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
  function renderCloudPost(row, authorProfile=null){
    if($(`[data-post-id="${CSS.escape(row.id)}"]`,postsList))return;
    const createdAt=row.created_at?new Date(row.created_at).getTime():Date.now();
    const isOwnPost=!!currentUser && row.user_id===currentUser.id;
    const authorName=authorProfile?.full_name||authorProfile?.username||'عضو EgyBook';
    const data={id:row.id,text:row.text||'',media:row.media_url||null,mediaType:row.media_type||null,visibility:row.visibility||'الجميع',createdAt,authorName,authorAvatar:authorProfile?.avatar_url||null};
    const article=createPostElement(data);article.dataset.createdAt=String(createdAt);article.dataset.visibility=data.visibility;
    article.dataset.media=data.media||'';article.dataset.mediaType=data.mediaType||'';
    article.dataset.authorId=row.user_id||'';
    article.dataset.username=cleanUsername(authorProfile?.username||'');
    const avatar=$('.post-header .avatar',article);
    if(authorProfile?.avatar_url&&avatar){avatar.textContent='';avatar.style.backgroundImage=`url("${authorProfile.avatar_url.replace(/"/g,'%22')}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';}
    if(isOwnPost){
      article.dataset.userPost='true';
      if(!authorProfile?.avatar_url)applyAvatar(avatar);
    }
    // Use the same verified-account resolver for every author's name, not only
    // the signed-in user's posts. This keeps feed badges consistent.
    addBadgeToUserName($('.post-author .author-name',article), row.user_id);
    postsList.append(article);restorePostState(article);syncPostStats(article);loadCloudPostStats(article);
  }
  async function restorePosts() {
    const userAtStart=currentUser;
    if(supabase && userAtStart){
      const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at').order('created_at',{ascending:false}).limit(100);
      if(error){console.error('Supabase posts load failed',error);showToast('تعذر تحميل المنشورات: '+error.message);return;}
      if(currentUser?.id!==userAtStart.id)return;
      // Reconcile the feed in place: keep existing DOM nodes while data refreshes
      // so the feed/background does not flash on every refresh.
      const rows=(data||[]).filter(row => {
        if (row.user_id === userAtStart.id) return true;
        const v=String(row.visibility||'الجميع').trim().toLowerCase();
        return ['الجميع','عام','public','everyone','publico'].includes(v);
      });
      const authorIds=[...new Set(rows.map(row=>row.user_id).filter(Boolean))];
      const profileMap={};
      if(authorIds.length){
        const {data:profiles,error:profilesError}=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',authorIds);
        if(!profilesError) for(const profile of (profiles||[]))profileMap[profile.id]=profile;
      }
      if(currentUser?.id!==userAtStart.id)return;
      const validIds=new Set(rows.map(row=>String(row.id)));
      postsList.querySelectorAll('.post[data-cloud-post="true"],.post[data-user-post="true"]').forEach(post=>{
        if(post.dataset.postId && !validIds.has(String(post.dataset.postId))) post.remove();
      });
      // Create only posts that are genuinely new; existing posts are retained.
      rows.forEach(row=>{
        const id=String(row.id);
        const existing=$(`[data-post-id="${CSS.escape(id)}"]`,postsList);
        if(existing){existing.dataset.cloudPost='true';return;}
        renderCloudPost(row,profileMap[row.user_id]||null);
        const el=$(`[data-post-id="${CSS.escape(id)}"]`,postsList);if(el)el.dataset.cloudPost='true';
      });
      // Reorder existing nodes in place by creation date (newest first).
      const ordered=rows.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      let cursor=postsList.firstElementChild;
      for(const row of ordered){
        const node=$(`[data-post-id="${CSS.escape(String(row.id))}"]`,postsList);if(!node)continue;
        if(node!==cursor)postsList.insertBefore(node,cursor||null);
        cursor=node.nextElementSibling;
      }
      updateEmptyState();
      if(currentPage==='profile') renderProfilePosts();
      if(/^\/Egybook\/(?:photo|profile-photo|cover-photo)\//i.test(location.pathname)) routeFromLocation();
      return;
    }
    postsList.querySelectorAll('.post[data-cloud-post="true"],.post[data-user-post="true"]').forEach(p=>p.remove());
    showToast('سجّل الدخول لعرض المنشورات المحفوظة على السحابة.');
    if(currentPage==='profile') renderProfilePosts();
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
      const article=createPostElement({id:data.id,text:data.text,media:data.media_url,mediaType:data.media_type,visibility:data.visibility,createdAt:new Date(data.created_at).getTime(),authorName:profileData.name||currentUser.user_metadata?.full_name||'عضو EgyBook',authorAvatar:profileData.avatar||null});
      article.dataset.userPost='true';article.dataset.cloudPost='true';article.dataset.authorId=currentUser.id;article.dataset.createdAt=String(new Date(data.created_at).getTime());article.dataset.visibility=data.visibility;article.dataset.media=data.media_url||'';article.dataset.mediaType=data.media_type||'';addBadgeToUserName($('.post-author .author-name',article), data.user_id);postsList.prepend(article);
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
  const SITE_BASE_PATH = '/Egybook/';
  const POST_ROUTE_BASE = SITE_BASE_PATH + 'post/';
  // GitHub Pages sends deep links through 404.html. Capture that route before
  // auth/profile bootstrap or any navigation code can replace the URL.
  const PENDING_ROUTE_STORAGE_KEY = 'egybook_pending_deep_link_v1';
  let pendingDeepLinkPath = (() => {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('route');
      const fromStorage = sessionStorage.getItem(PENDING_ROUTE_STORAGE_KEY);
      const candidate = fromQuery || fromStorage || '';
      if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
      const target = new URL(candidate, window.location.origin);
      if (target.origin !== window.location.origin || !/^\/Egybook(?:\/|$)/i.test(target.pathname)) return null;
      return target.pathname + target.search + target.hash;
    } catch (_) {
      return null;
    }
  })();
  let publicProfileUsername = null;
  let publicProfileId = null;
  let publicProfileIsOwn = true;
  let publicProfileData = null;
  let profileLoadToken = 0;
  let relationshipLoadToken = 0;
  let routePostId = null;
  function cleanUsername(value){
    return String(value || 'egybook_user').trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase() || 'egybook_user';
  }
  function profilePath(username=profileData.username){
    return SITE_BASE_PATH + encodeURIComponent(cleanUsername(username));
  }
  function postPath(postId){ return POST_ROUTE_BASE + encodeURIComponent(String(postId || '')); }
  function syncHeaderProfileUsername(){ /* Topbar account chip intentionally removed. */ }
  function routeToProfile(username=profileData.username, {push=true, scroll=true}={}){
    closeNotifications();
    const friendsDirectory=$('#friendsDirectoryPage');if(friendsDirectory)friendsDirectory.hidden=true;
    const normalized=cleanUsername(username);
    if(push && location.pathname.replace(/\/$/,'')!==profilePath(normalized).replace(/\/$/,'')){
      history.pushState({page:'profile',username:normalized},'',profilePath(normalized));
    }
    closeModal($('#commentsModal'));document.body.classList.remove('post-route-open');const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
    $('#memezPage').hidden=true;
    currentPage='profile'; publicProfileUsername=normalized;
    profileLoadToken++; // Ignore late responses from a previously viewed account.
    const ownByUsername = normalized===cleanUsername(profileData.username) && !!currentUser;
    publicProfileId = ownByUsername ? currentUser.id : null;
    publicProfileIsOwn = ownByUsername;
    publicProfileData = ownByUsername ? {...profileData, id:currentUser.id} : null;
    // Reset previous user's visible data while the requested profile is loading.
    if(!publicProfileIsOwn){
      $('#profileNameText').textContent='جارٍ تحميل الملف الشخصي…';
      $('.profile-handle').textContent='@'+normalized;
      $('.profile-bio').textContent='';
      const avatar=$('.profile-large-avatar'); if(avatar){avatar.style.backgroundImage='';avatar.textContent='…';}
      const cover=$('.profile-cover'); if(cover){cover.classList.remove('has-image');cover.style.backgroundImage='';}
      const badge=$('#profileVerifiedBadge'); if(badge)badge.hidden=true;
      publicProfileId=null;
    } else {
      $('#profileNameText').textContent=profileData.name||'حسابي';
      $('.profile-handle').textContent='@'+cleanUsername(profileData.username);
      $('.profile-bio').textContent=profileData.bio||'';
      applyProfile();
      refreshViewedProfileVerification();
    }
    $('#profilePage').hidden=false; $('.container').hidden=true;
    $$('.top-nav-item, .bottom-item').forEach(button=>button.classList.remove('active'));
    $$('.bottom-item[data-action="profile"]').forEach(button=>button.classList.add('active'));
    renderProfilePosts();
    loadProfileFriends(publicProfileId);
    if(scroll)window.scrollTo({top:0,behavior:'auto'});
    updateProfileActionVisibility();
    if(normalized!==cleanUsername(profileData.username)) loadPublicProfileByUsername(normalized);
  }

  let profileFriendsToken=0;
  async function loadProfileFriends(ownerId){
    const grid=$('#profileFriendsGrid');if(!grid)return;
    const token=++profileFriendsToken;
    const countNode=$('#profileFriendsCount');
    const sameOwnerAlreadyRendered=Boolean(ownerId) && grid.dataset.ownerId===String(ownerId) && grid.dataset.loaded==='true';
    const isCurrentRequest=()=>token===profileFriendsToken && Boolean(ownerId) && ownerId===publicProfileId;
    // Keep the current count and cards visible while refreshing the same profile.
    // Only show a loading placeholder when the displayed owner actually changes.
    if(!ownerId){
      // A public profile has not resolved its owner yet; clear another owner's
      // cards once, but never do this for the signed-in profile on UI-only events.
      if(!publicProfileIsOwn && grid.dataset.ownerId!=='pending'){
        grid.dataset.ownerId='pending';grid.dataset.loaded='false';
        if(countNode)countNode.textContent='…';
        grid.replaceChildren();
        const loading=document.createElement('p');loading.className='profile-friends-empty profile-loading-placeholder';loading.textContent='جارٍ تحميل الأصدقاء…';grid.append(loading);
      }
      return;
    }
    if(!sameOwnerAlreadyRendered){
      grid.dataset.ownerId=String(ownerId);
      grid.dataset.loaded='false';
      if(countNode)countNode.textContent='…';
      grid.replaceChildren();
      const loading=document.createElement('p');loading.className='profile-friends-empty profile-loading-placeholder';loading.textContent='جارٍ تحميل الأصدقاء…';grid.append(loading);
    }
    if(!supabase){
      if(!isCurrentRequest())return;
      if(sameOwnerAlreadyRendered)return;
      if(countNode)countNode.textContent='—';
      grid.replaceChildren();
      const empty=document.createElement('p');empty.className='profile-friends-empty';empty.textContent='تعذر الاتصال بقاعدة البيانات.';grid.append(empty);
      return;
    }
    try{
      const [sent,received]=await Promise.all([
        supabase.from('friend_requests').select('sender_id,receiver_id').eq('sender_id',ownerId).eq('status','accepted'),
        supabase.from('friend_requests').select('sender_id,receiver_id').eq('receiver_id',ownerId).eq('status','accepted')
      ]);
      if(sent.error)throw sent.error;
      if(received.error)throw received.error;
      // The profile owner is the source of truth for both directions of friendship.
      const ids=[...new Set([...(sent.data||[]).map(r=>r.receiver_id),...(received.data||[]).map(r=>r.sender_id)])]
        .filter(id=>Boolean(id)&&id!==ownerId);
      let people=[];
      if(ids.length){
        const result=await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',ids);
        if(result.error)throw result.error;
        const allowedIds=new Set(ids);
        people=(result.data||[]).filter(person=>person.id!==ownerId&&allowedIds.has(person.id));
      }
      // Ignore late results after the user navigates to a different profile.
      if(!isCurrentRequest())return;
      grid.replaceChildren();
      grid.dataset.ownerId=String(ownerId);
      grid.dataset.loaded='true';
      if(countNode)countNode.textContent=String(people.length);
      if(!people.length){
        const empty=document.createElement('p');empty.className='profile-friends-empty';empty.textContent='لا يوجد أصدقاء مضافون حتى الآن.';grid.append(empty);return;
      }
      people.slice(0,8).forEach(person=>{
        const card=document.createElement('button');card.type='button';card.className='profile-friend-tile';card.dataset.action='directory-open-profile';card.dataset.username=person.username||'';
        if(person.avatar_url){const img=document.createElement('img');img.src=person.avatar_url;img.alt='';img.loading='lazy';card.append(img);}
        else{const avatar=document.createElement('span');avatar.className='profile-friend-fallback';avatar.textContent=(person.full_name||person.username||'؟').charAt(0);card.append(avatar);}
        const name=document.createElement('span');name.textContent=person.full_name||person.username||'مستخدم';card.append(name);grid.append(card);
      });
    }catch(error){
      console.warn('Profile friends failed:',error);
      if(!isCurrentRequest())return;
      // Do not erase valid existing data because a background refresh failed.
      if(sameOwnerAlreadyRendered)return;
      if(countNode)countNode.textContent='—';
      grid.replaceChildren();
      const empty=document.createElement('p');empty.className='profile-friends-empty';empty.textContent='تعذر تحميل الأصدقاء. تحقق من صلاحيات قاعدة البيانات.';grid.append(empty);
    }
  }

  function updateProfileActionVisibility(){
    const isOwn=!!publicProfileIsOwn;
    $$('.profile-edit-button,[data-action="edit-profile"]').forEach(button=>{
      if(button.classList.contains('profile-edit-button')) button.hidden=!isOwn;
      else if(button.classList.contains('sidebar-edit')) button.hidden=!isOwn;
    });
    const buttons=$('.profile-buttons');
    if(!buttons)return;
    buttons.querySelectorAll('[data-action="profile-relationship"],[data-action="profile-follow"]').forEach(button=>button.remove());
    if(isOwn)return;
    const friend=document.createElement('button');
    friend.type='button'; friend.className='profile-edit-button profile-relationship-button';
    friend.dataset.action='profile-relationship'; friend.textContent='＋ إضافة صديق';
    const follow=document.createElement('button');
    follow.type='button'; follow.className='profile-secondary-button profile-follow-button';
    follow.dataset.action='profile-follow'; follow.textContent='＋ متابعة';
    buttons.insertBefore(follow,buttons.firstChild);
    buttons.insertBefore(friend,buttons.firstChild);
    loadProfileRelationship();
    refreshViewedProfileVerification();
  }
  async function loadProfileRelationship(){
    const token=++relationshipLoadToken;
    const targetId=publicProfileId;
    const friend=$('[data-action="profile-relationship"]');
    const follow=$('[data-action="profile-follow"]');
    if(!friend||!follow)return;
    if(!currentUser||!supabase||!targetId||targetId===currentUser.id){
      friend.textContent='＋ إضافة صديق'; friend.disabled=true;
      follow.textContent='＋ متابعة'; follow.disabled=true;
      return;
    }
    friend.disabled=true;follow.disabled=true;
    friend.textContent='جارٍ التحقق…';follow.textContent='جارٍ التحقق…';
    try{
      const [outgoing,incoming,following]=await Promise.all([
        supabase.from('friend_requests').select('id,status').eq('sender_id',currentUser.id).eq('receiver_id',targetId).maybeSingle(),
        supabase.from('friend_requests').select('id,status').eq('sender_id',targetId).eq('receiver_id',currentUser.id).maybeSingle(),
        supabase.from('user_follows').select('follower_id').eq('follower_id',currentUser.id).eq('following_id',targetId).maybeSingle()
      ]);
      if(token!==relationshipLoadToken||targetId!==publicProfileId)return;
      if(outgoing.error && outgoing.error.code!=='PGRST116')throw outgoing.error;
      if(incoming.error && incoming.error.code!=='PGRST116')throw incoming.error;
      if(following.error && following.error.code!=='PGRST116')throw following.error;
      const out=outgoing.data, inc=incoming.data;
      if(out?.status==='accepted'||inc?.status==='accepted'){
        friend.textContent='✓ صديق'; friend.dataset.relationshipState='friends';
      }else if(out?.status==='pending'){
        friend.textContent='طلب مُرسل · إلغاء'; friend.dataset.relationshipState='pending-out';
      }else if(inc?.status==='pending'){
        friend.textContent='قبول طلب الصداقة'; friend.dataset.relationshipState='pending-in';
      }else{
        friend.textContent='＋ إضافة صديق'; friend.dataset.relationshipState='none';
      }
      follow.textContent=following.data?'✓ متابَع · إلغاء':'＋ متابعة';
      follow.dataset.following=following.data?'true':'false';
    }catch(error){
      console.warn('Profile relationship status unavailable:',error);
      if(token===relationshipLoadToken){friend.textContent='＋ إضافة صديق';follow.textContent='＋ متابعة';friend.title='تعذر تحميل حالة الصداقة';follow.title='تعذر تحميل حالة المتابعة';}
    }finally{
      if(token===relationshipLoadToken){friend.disabled=false;follow.disabled=false;}
    }
  }
  async function refreshViewedProfileVerification(){
    const badge=$('#profileVerifiedBadge');if(!badge)return;
    const targetId=publicProfileId || (publicProfileIsOwn ? currentUser?.id : null);
    // Keep a visible neutral/gray badge for an unverified profile; do not hide it
    // just because verification data is still loading.
    badge.hidden=false;
    badge.classList.remove('owner-badge');
    badge.classList.add('verified-badge-inactive');
    badge.title='حساب غير موثّق';badge.setAttribute('aria-label','حساب غير موثّق');
    if(!targetId)return;
    if(targetId===OWNER_USER_ID){
      badge.classList.remove('verified-badge-inactive');badge.classList.add('owner-badge');
      badge.title='هذا الحساب موثّق';badge.setAttribute('aria-label','هذا الحساب موثّق');return;
    }
    if(!supabase)return;
    const requestTarget=targetId;
    try{
      const {data,error}=await supabase.from('verified_accounts')
        .select('user_id,verification_type,expires_at').eq('user_id',requestTarget).maybeSingle();
      const currentTarget=publicProfileId || (publicProfileIsOwn ? currentUser?.id : null);
      if(currentTarget!==requestTarget)return;
      const active=!error && !!data && (!data.expires_at || new Date(data.expires_at)>new Date());
      badge.classList.toggle('verified-badge-inactive',!active || data?.verification_type==='owner');
      badge.classList.toggle('owner-badge',data?.verification_type==='owner' && active);
      if(active){badge.classList.remove('verified-badge-inactive');badge.title='هذا الحساب موثّق';badge.setAttribute('aria-label','هذا الحساب موثّق');}
      else{badge.title='حساب غير موثّق';badge.setAttribute('aria-label','حساب غير موثّق');}
    }catch(_){/* Keep a stable gray badge if verification lookup fails. */}
  }
  async function toggleProfileFollow(){
    if(!currentUser||!supabase)return showToast('سجّل الدخول أولًا لمتابعة الحسابات.');
    const targetId=publicProfileId;if(!targetId||targetId===currentUser.id)return showToast('تعذر تحديد الحساب المطلوب.');
    const button=$('[data-action="profile-follow"]');if(!button)return;
    button.disabled=true;
    try{
      if(button.dataset.following==='true'){
        const {error}=await supabase.from('user_follows').delete().eq('follower_id',currentUser.id).eq('following_id',targetId);if(error)throw error;
        button.dataset.following='false';button.textContent='＋ متابعة';showToast('تم إلغاء المتابعة.');
      }else{
        const {error}=await supabase.from('user_follows').insert({follower_id:currentUser.id,following_id:targetId});if(error)throw error;
        button.dataset.following='true';button.textContent='✓ متابَع · إلغاء';showToast('تمت متابعة الحساب.');
      }
    }catch(error){console.error('Follow update failed:',error);showToast('تعذر تحديث المتابعة. تأكد من تنفيذ ترحيل المتابعة في Supabase.');}
    finally{button.disabled=false;}
  }
  async function sendProfileFriendRequest(){
    if(!currentUser||!supabase){showToast('سجّل الدخول أولًا لإضافة صديق.');return;}
    const targetId=publicProfileId;if(!targetId||targetId===currentUser.id){showToast('تعذر تحديد حساب المستخدم المطلوب.');return;}
    const button=$('[data-action="profile-relationship"]');if(!button)return;
    const state=button.dataset.relationshipState||'none';button.disabled=true;
    try{
      if(state==='pending-out'){
        const {error}=await supabase.from('friend_requests').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('sender_id',currentUser.id).eq('receiver_id',targetId).eq('status','pending');if(error)throw error;
        showToast('تم إلغاء طلب الصداقة.');
      }else if(state==='pending-in'){
        const {error}=await supabase.from('friend_requests').update({status:'accepted',updated_at:new Date().toISOString()}).eq('sender_id',targetId).eq('receiver_id',currentUser.id).eq('status','pending');if(error)throw error;
        showToast('تم قبول طلب الصداقة.');
      }else if(state==='friends'){
        showToast('أنتم أصدقاء بالفعل.');return;
      }else{
        // Remove an older cancelled/rejected row first; RLS intentionally does not allow
        // changing those historical rows back to pending via UPDATE/UPSERT.
        const {error:deleteError}=await supabase.from('friend_requests').delete().eq('sender_id',currentUser.id).eq('receiver_id',targetId).in('status',['cancelled','rejected']);
        if(deleteError)throw deleteError;
        const {error}=await supabase.from('friend_requests').insert({sender_id:currentUser.id,receiver_id:targetId,status:'pending'});if(error)throw error;
        showToast('تم إرسال طلب الصداقة.');
      }
      await loadProfileRelationship();
    }catch(error){console.error('Friend request failed:',error);showToast('تعذر تحديث الصداقة. راجع جدول friend_requests وسياسات RLS.');}
    finally{button.disabled=false;}
  }
  function showProfile(){ routeToProfile(profileData.username,{push:true}); }
  function ensurePostViewer(){
    let viewer=$('#postViewer');
    if(viewer)return viewer;
    viewer=document.createElement('section');viewer.id='postViewer';viewer.className='post-viewer';viewer.hidden=true;
    viewer.innerHTML='<header class="post-viewer-head"><button type="button" data-action="post-viewer-close" aria-label="رجوع">←</button><strong>EgyBook · المنشور</strong><button type="button" data-action="post-viewer-comments">التعليقات</button></header><div class="post-viewer-content" id="postViewerContent"></div>';
    document.body.append(viewer);return viewer;
  }
  function openPostRoute(postId,{push=true,attempt=0}={}){
    if(!postId)return;
    const post=$(`[data-post-id="${CSS.escape(String(postId))}"]`,postsList);
    if(!post){
      if(attempt<12){setTimeout(()=>{if(supabase&&currentUser&&attempt===0)restorePosts().finally(()=>openPostRoute(postId,{push:false,attempt:attempt+1}));else openPostRoute(postId,{push:false,attempt:attempt+1});},350);}
      else showToast('المنشور المطلوب غير متاح أو لم يتم تحميله.');
      return;
    }
    routePostId=String(postId);activeCommentsPost=post;document.body.classList.add('post-route-open');
    if(push&&location.pathname!==postPath(postId))history.pushState({page:'post',postId:String(postId)},'',postPath(postId));
    $('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;closeModal($('#commentsModal'));
    const viewer=ensurePostViewer(),content=$('#postViewerContent');content.replaceChildren();
    const clone=post.cloneNode(true);clone.classList.add('post-viewer-post');clone.querySelectorAll('.comments-area').forEach(el=>el.remove());
    const media=clone.querySelector('.post-image');
    if(media && media.tagName==='IMG'){media.classList.add('post-viewer-image');media.removeAttribute('data-action');}
    const stats=clone.querySelector('.post-stats');
    if(stats){
      const reactions=stats.querySelector('[data-action="reactions-open"]');if(reactions)reactions.addEventListener('click',()=>showPostReactions(post));
      const comments=stats.querySelector('[data-action="comments-open"]');if(comments)comments.addEventListener('click',()=>openComments(post,{push:false}));
    }
    content.append(clone);viewer.hidden=false;window.scrollTo({top:0,behavior:'auto'});
  }
  function closePostViewer({home=true}={}){
    const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
    document.body.classList.remove('post-route-open');routePostId=null;
    if(home){history.pushState({page:'home'},'',SITE_BASE_PATH);setPage('home',{push:false});}
  }
  async function showPostReactions(post){
    if(!post)return;
    let modal=$('#postReactionsModal');
    if(!modal){modal=document.createElement('div');modal.id='postReactionsModal';modal.className='modal';modal.innerHTML='<div class="modal-box"><div class="modal-header"><h2>التفاعلات</h2><button class="close-modal" data-action="close-modal">×</button></div><div id="postReactionsList"></div></div>';document.body.append(modal);}
    const list=$('#postReactionsList');list.replaceChildren();
    const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التفاعلات…';list.append(loading);openModal(modal);
    const postId=String(post.dataset.postId||'');
    if(!supabase||!postId){
      list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='لا يمكن تحميل التفاعلات حاليًا. تحقق من الاتصال بالإنترنت.';list.append(msg);return;
    }
    try{
      const {data,error}=await supabase.from('post_reactions').select('user_id,reaction,created_at,profiles(full_name,username,avatar_url)').eq('post_id',postId).order('created_at',{ascending:false});
      if(error)throw error;
      list.replaceChildren();
      if(!data?.length){const empty=document.createElement('p');empty.className='empty-message';empty.textContent='لا توجد تفاعلات مسجلة لهذا المنشور حتى الآن.';list.append(empty);return;}
      data.forEach(row=>{
        const el=document.createElement('div');el.className='reaction-person-row';
        const avatar=document.createElement('span');avatar.className='avatar';
        const profile=Array.isArray(row.profiles)?(row.profiles[0]||{}):(row.profiles||{});
        if(profile.avatar_url){avatar.style.backgroundImage=`url("${String(profile.avatar_url).replace(/"/g,'%22')}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';avatar.textContent='';}
        else avatar.textContent=(profile.full_name||profile.username||'ع').slice(0,1);
        const name=document.createElement('strong');name.textContent=profile.full_name||profile.username||'عضو EgyBook';
        const reaction=document.createElement('span');reaction.className='reaction-person-emoji';reaction.textContent=row.reaction||'👍';
        el.append(avatar,name,reaction);list.append(el);
      });
    }catch(error){
      console.error('Could not load post reactions:',{postId,message:error?.message,code:error?.code,details:error?.details,hint:error?.hint});
      list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='تعذر تحميل التفاعلات من قاعدة البيانات. تأكد من صلاحيات قراءة post_reactions وربط profiles ثم أعد المحاولة.';list.append(msg);
    }
  }
  let notificationItems=[];
  let notificationTab='all';
  let highlightCommentId=null;
  const notificationReadKey=()=>`egybook_notifications_read::${currentUser?.id||'guest'}`;
  function notificationReadIds(){try{return new Set(JSON.parse(localStorage.getItem(notificationReadKey())||'[]'));}catch(_){return new Set();}}
  function notificationTime(value){if(!value)return 'الآن';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';const mins=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));if(mins<1)return 'الآن';if(mins<60)return `منذ ${mins} دقيقة`;const hours=Math.floor(mins/60);if(hours<24)return `منذ ${hours} ساعة`;return d.toLocaleDateString('ar-EG');}
  async function openNotificationActorProfile(item){
    if(!item)return;
    if(item.actorId && currentUser?.id===item.actorId){routeToProfile(profileData.username,{push:true});return;}
    if(item.actorId && supabase){
      try{const {data,error}=await supabase.from('profiles').select('id,username').eq('id',item.actorId).maybeSingle();if(!error&&data?.username){routeToProfile(data.username,{push:true});return;}}catch(error){console.warn('Notification actor profile lookup failed:',error);}
    }
    if(item.username){routeToProfile(item.username,{push:true});return;}
    showToast('الملف الشخصي لهذا المستخدم غير متاح.');
  }
  function notificationTypeIcon(type){
    const paths={
      friend:'<circle cx="8" cy="8" r="3"/><path d="M2.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5M16 8h5M18.5 5.5v5"/>',
      comment:'<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.6-.8L3 20l1.5-4A7.1 7.1 0 0 1 4 12c0-4.2 3.6-7.5 8-7.5s8 2.8 8 7Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
      reply:'<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/>',
      reaction:'<path d="M12 21s-8-4.7-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.3-8 11-8 11Z"/>',
      system:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>'
    };
    const span=document.createElement('span');span.className='notification-kind notification-kind-icon';span.setAttribute('aria-hidden','true');
    span.innerHTML='<svg viewBox="0 0 24 24" focusable="false">'+(paths[type]||paths.system)+'</svg>';return span;
  }
  function renderNotifications(){
    const list=$('#notificationsList');if(!list)return;list.replaceChildren();
    const items=notificationItems.filter(x=>notificationTab==='all'||(notificationTab==='interactions'&&['reaction','comment','reply'].includes(x.type))||(notificationTab==='system'&&x.type==='system'));
    if(!items.length){const empty=document.createElement('p');empty.className='notification-empty';empty.textContent=notificationTab==='system'?'لا توجد إشعارات نظام متاحة حاليًا.':'مفيش إشعارات جديدة لحد دلوقتي.';list.append(empty);return;}
    const read=notificationReadIds();
    items.forEach(item=>{
      const card=document.createElement('article');card.className='notification-card';card.dataset.notificationId=item.id;card.dataset.unread=String(!read.has(item.id)&&!item.read_at);card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','فتح الإشعار');
      const avatar=document.createElement('button');avatar.type='button';avatar.className='notification-avatar notification-actor-link';avatar.setAttribute('aria-label','فتح الملف الشخصي');if(item.avatar){avatar.style.backgroundImage=`url("${String(item.avatar).replace(/"/g,'%22')}")`;avatar.textContent='';}else avatar.textContent=(item.name||'E').trim().slice(0,1);
      const copy=document.createElement('div');copy.className='notification-copy';const p=document.createElement('p');const strong=document.createElement('button');strong.type='button';strong.className='notification-actor-name notification-actor-link';strong.textContent=item.name||'عضو EgyBook';p.append(strong,document.createTextNode(' '+item.text));const time=document.createElement('div');time.className='notification-time';time.textContent=notificationTime(item.created_at);copy.append(p,time);
      if(item.type==='friend'&&item.status==='pending'){const actions=document.createElement('div');actions.className='notification-actions';const accept=document.createElement('button');accept.type='button';accept.dataset.action='notification-accept';accept.dataset.requestId=item.requestId;accept.textContent='قبول الطلب';const reject=document.createElement('button');reject.type='button';reject.dataset.action='notification-reject';reject.dataset.requestId=item.requestId;reject.textContent='رفض';actions.append(accept,reject);copy.append(actions);}
      const isRead=read.has(item.id)||!!item.read_at;const status=document.createElement('span');status.className='notification-read-status';status.textContent='مقروءة';status.hidden=!isRead;
      card.append(avatar,copy,status,notificationTypeIcon(item.type));
      list.append(card);
      const openTarget=async()=>{
        await markNotificationRead(item);
        if(item.type==='friend'||item.type==='system'){if(item.actorId||item.username)await openNotificationActorProfile(item);return;}
        const postId=item.postId;
        if(!postId){if(item.actorId||item.username)await openNotificationActorProfile(item);return;}
        try{sessionStorage.setItem('egybook-notifications-return',JSON.stringify({scrollY:$('#notificationsPage')?.scrollTop||window.scrollY||0,notificationId:item.id}));}catch(_){}
        closeNotifications();
        openPostRoute(postId,{push:true});
        if(item.type==='comment'||item.type==='reply'||item.commentId){
          const commentId=item.commentId;
          let tries=0;const timer=setInterval(()=>{
            const post=$(`[data-post-id="${CSS.escape(String(postId))}"]`,postsList);
            if(post){clearInterval(timer);openComments(post,{push:false,commentId:commentId||undefined});}
            else if(++tries>40)clearInterval(timer);
          },250);
        }else if(item.type==='reaction'){
          let tries=0;const timer=setInterval(()=>{const post=$(`[data-post-id="${CSS.escape(String(postId))}"]`,postsList);if(post){clearInterval(timer);const stats=post.querySelector('[data-action="reactions-open"]');if(stats)stats.click();}else if(++tries>40)clearInterval(timer);},250);
        }
      };
      card.addEventListener('click',async e=>{
        if(e.target.closest('.notification-actor-link')){e.stopPropagation();await openNotificationActorProfile(item);return;}
        if(e.target.closest('button[data-action]'))return;
        await openTarget();
      });
      card.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){e.preventDefault();openTarget();}});
      avatar.addEventListener('click',e=>{e.stopPropagation();openNotificationActorProfile(item);});
      strong.addEventListener('click',e=>{e.stopPropagation();openNotificationActorProfile(item);});
    });
  }
  async function loadNotifications(){
    const list=$('#notificationsList');if(!list)return;
    if(!currentUser||!supabase){notificationItems=[];renderNotifications();if(!currentUser)showToast('سجّل الدخول عشان تشوف إشعارات حسابك.');return;}
    list.replaceChildren();const loading=document.createElement('p');loading.className='notifications-loading';loading.textContent='جارٍ تحميل الإشعارات…';list.append(loading);
    const userId=currentUser.id;const collected=[];
    try{
      const requests=await supabase.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('receiver_id',userId).eq('status','pending').order('created_at',{ascending:false}).limit(50);
      if(requests.error)console.warn('Notifications friend requests:',requests.error.message);
      const requestRows=requests.data||[];const senderIds=[...new Set(requestRows.map(r=>r.sender_id).filter(Boolean))];let senderProfiles={};
      if(senderIds.length){const pr=await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',senderIds);if(!pr.error)(pr.data||[]).forEach(x=>senderProfiles[x.id]=x);}
      requestRows.forEach(r=>{const profile=senderProfiles[r.sender_id]||{};collected.push({id:`friend:${r.id}`,type:'friend',requestId:r.id,status:r.status,created_at:r.created_at,actorId:r.sender_id,username:profile.username||'',name:profile.full_name||profile.username||'عضو EgyBook',avatar:profile.avatar_url||'',text:'أرسل لك طلب صداقة'});});
      const owned=await supabase.from('posts').select('id').eq('user_id',userId).order('created_at',{ascending:false}).limit(100);
      const postIds=(owned.data||[]).map(x=>String(x.id));
      if(postIds.length){
        const [reactions,comments]=await Promise.all([
          supabase.from('post_reactions').select('id,post_id,user_id,reaction,created_at,profiles(full_name,username,avatar_url)').in('post_id',postIds).neq('user_id',userId).order('created_at',{ascending:false}).limit(100),
          supabase.from('post_comments').select('id,post_id,user_id,user_name,body,created_at,parent_id').in('post_id',postIds).neq('user_id',userId).order('created_at',{ascending:false}).limit(100)
        ]);
        if(reactions.error)console.warn('Notifications reactions:',reactions.error.message);
        (reactions.data||[]).forEach(r=>{const profile=Array.isArray(r.profiles)?(r.profiles[0]||{}):(r.profiles||{});collected.push({id:`reaction:${r.id||`${r.post_id}:${r.user_id}`}`,type:'reaction',postId:String(r.post_id),created_at:r.created_at,actorId:r.user_id,username:profile.username||'',name:profile.full_name||profile.username||'عضو EgyBook',avatar:profile.avatar_url||'',text:`تفاعل مع منشورك ${r.reaction||'👍'}`});});
        if(comments.error)console.warn('Notifications comments:',comments.error.message);
        (comments.data||[]).forEach(c=>collected.push({id:`comment:${c.id}`,type:c.parent_id?'reply':'comment',commentId:String(c.id),postId:String(c.post_id),actorId:c.user_id,created_at:c.created_at,name:c.user_name||'عضو EgyBook',avatar:'',text:`${c.parent_id?'رد على تعليق في منشورك: ':'علّق على منشورك: '}${String(c.body||'').slice(0,120)}`}));
      }
      if(currentUser?.id!==userId)return;
      // Prefer durable, cross-device notification rows when the migration is installed.
      try{
        const stored=await supabase.from('notifications').select('id,type,title,body,actor_id,post_id,comment_id,friend_request_id,created_at,read_at,actor:profiles!notifications_actor_id_fkey(full_name,username,avatar_url)').eq('recipient_id',userId).order('created_at',{ascending:false}).limit(150);
        if(!stored.error && Array.isArray(stored.data)){
          const durable=stored.data.map(n=>{const a=Array.isArray(n.actor)?(n.actor[0]||{}):(n.actor||{});return {id:`db:${n.id}`,dbId:n.id,type:n.type==='friend_request'?'friend':(n.type==='comment_reply'?'reply':n.type),requestId:n.friend_request_id,status:n.type==='friend_request'?'pending':null,postId:n.post_id?String(n.post_id):null,commentId:n.comment_id?String(n.comment_id):null,actorId:n.actor_id||null,username:a.username||'',created_at:n.created_at,name:a.full_name||a.username||n.title||'عضو EgyBook',avatar:a.avatar_url||'',text:n.body||n.title||'إشعار جديد',read_at:n.read_at||null};});
          notificationItems=durable;
          // Persisted read state from the server is merged into local cache for graceful fallback.
          const read=notificationReadIds();durable.forEach(n=>{if(n.read_at)read.add(n.id);});
          try{localStorage.setItem(notificationReadKey(),JSON.stringify([...read]));}catch(_){}
        }else{
          notificationItems=collected.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
        }
      }catch(_){notificationItems=collected.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));}
      renderNotifications();updateNotificationBadge();
    }catch(error){console.error('Could not load notifications:',error);list.replaceChildren();const msg=document.createElement('p');msg.className='notification-empty';msg.textContent='تعذر تحميل الإشعارات. راجع صلاحيات RLS للجداول friend_requests وposts وpost_reactions وpost_comments وprofiles.';list.append(msg);}
  }
  async function markNotificationRead(item){
    if(!item)return;
    const read=notificationReadIds();
    if(!read.has(item.id)){read.add(item.id);try{localStorage.setItem(notificationReadKey(),JSON.stringify([...read]));}catch(_){}}
    if(item.dbId&&supabase&&currentUser){
      try{await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',item.dbId).eq('recipient_id',currentUser.id).is('read_at',null);}catch(_){}
      item.read_at=item.read_at||new Date().toISOString();
    }
    renderNotifications();updateNotificationBadge();
  }
  function updateNotificationBadge(){const read=notificationReadIds();const unread=notificationItems.filter(x=>!read.has(x.id)&&!x.read_at).length;const label=unread>9?'9+':String(unread);const badges=$$('.notification-badge, .header-notification-badge, .sidebar-alert');badges.forEach(b=>{b.hidden=!unread;b.textContent=label;});}
  function openNotifications({push=true}={}){closeSidebar();$('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;const friends=$('#friendsDirectoryPage');if(friends)friends.hidden=true;const reels=$('#reelsPage');if(reels)reels.hidden=true;$('#notificationsPage').hidden=false;currentPage='notifications';$$('.top-nav-item,.bottom-item').forEach(b=>b.classList.toggle('active',b.dataset.action==='notifications'||b.dataset.page==='notifications'));if(push)history.pushState({page:'notifications'},'','/Egybook/notifications');loadNotifications();window.scrollTo({top:0,behavior:'auto'});}
  function closeNotifications(){const page=$('#notificationsPage');if(page)page.hidden=true;}

  function routeFromLocation(){
    // Resolve the original deep link first. GitHub Pages may have temporarily
    // redirected a refreshed profile URL to /Egybook/?route=... .
    const routeParam = new URLSearchParams(location.search).get('route');
    const candidate = routeParam || pendingDeepLinkPath;
    let restoredPath = null;
    if (candidate) {
      try {
        const restored = String(candidate);
        if (!restored.startsWith('/') || restored.startsWith('//')) throw new Error('Invalid deep-link path');
        const target = new URL(restored, location.origin);
        if (target.origin === location.origin && /^\/Egybook(?:\/|$)/i.test(target.pathname)) {
          restoredPath = target.pathname;
          history.replaceState(history.state || {}, '', target.pathname + target.search + target.hash);
          try { sessionStorage.removeItem(PENDING_ROUTE_STORAGE_KEY); } catch (_) {}
          pendingDeepLinkPath = null;
        }
      } catch (error) {
        console.warn('Could not restore EgyBook deep link:', error);
      }
    }
    let path = restoredPath || location.pathname || '/';
    try { path = decodeURIComponent(path); } catch (_) {}
    if(/^\/Egybook\/notifications\/?$/i.test(path)){openNotifications({push:false});return;}
    closeNotifications();
    if(/^\/Egybook\/reels\/?$/i.test(path)){ $('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;const rp=$('#reelsPage');if(rp)rp.hidden=false;currentPage='reels';return;}
    if(/^\/Egybook\/memez\/?$/i.test(path)){ $('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=false;return;}
    const photoMatch=path.match(/^\/Egybook\/(?:photo|profile-photo|cover-photo)\/([^/]+)\/?$/i);
    if(photoMatch){
      const id=photoMatch[1];
      const all=[...['avatar','cover','posts'].flatMap(k=>(albumsData[k]||[]).map((x,i)=>({...x,id:String(x.id||`${k}-${x.date||i}`),author:profileData.name,avatar:profileData.avatar,caption:k==='avatar'?'الصورة الشخصية':k==='cover'?'صورة الغلاف':'صورة من المنشورات'})))];
      const found=all.findIndex(x=>String(x.id)===id);
      if(found>=0){openImageViewer(all,found,null,{push:false});return;}
      const postId=id.startsWith('post-')?id.slice(5):id;
      const post=$(`[data-post-id="${CSS.escape(postId)}"]`,document);
      const media=post?.querySelector('.post-image');
      if(post&&media&&media.tagName==='IMG'){openImageViewer([{id:`post-${postId}`,postId,src:media.currentSrc||media.src,originalSrc:media.src,author:$('.author-name',post)?.textContent||'EgyBook',avatar:profileData.avatar,caption:$('.post-text',post)?.textContent||'',date:$('.post-meta',post)?.textContent||'',postElement:post}],0,post,{push:false});return;}
      const profileIdMatch=id.match(/^(avatar|cover)-(.+)$/);
      if(profileIdMatch){
        const kind=profileIdMatch[1],ownerId=profileIdMatch[2];
        const isOwn=!!currentUser&&ownerId===currentUser.id;
        const src=isOwn?(kind==='avatar'?profileData.avatar:profileData.cover):'';
        if(src){openImageViewer([{id,src,originalSrc:src,author:profileData.name,avatar:profileData.avatar,caption:kind==='avatar'?'الصورة الشخصية':'صورة الغلاف'}],0,null,{push:false});return;}
        if(supabase){
          (async()=>{try{const {data,error}=await supabase.from('profiles').select('id,full_name,username,avatar_url,cover_url').eq('id',ownerId).maybeSingle();if(error||!data)return;const imageSrc=kind==='avatar'?data.avatar_url:data.cover_url;if(!imageSrc){showToast('الصورة غير متاحة أو تم تغييرها.');return;}openImageViewer([{id,src:imageSrc,originalSrc:imageSrc,author:data.full_name||data.username||'عضو EgyBook',avatar:data.avatar_url||'',caption:kind==='avatar'?'الصورة الشخصية':'صورة الغلاف'}],0,null,{push:false});}catch(_){showToast('تعذر تحميل الصورة من السحابة.');}})();return;
        }
      }
      if(supabase){
        (async()=>{try{const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at').eq('id',postId).maybeSingle();if(error||!data||data.media_type!=='image'||!data.media_url)return;const {data:authorProfile}=await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id',data.user_id).maybeSingle();renderCloudPost(data,authorProfile||null);const target=$(`[data-post-id="${CSS.escape(String(data.id))}"]`,postsList);const media=target?.querySelector('.post-image');if(target&&media){openImageViewer([{id:`post-${data.id}`,postId:String(data.id),src:data.media_url,originalSrc:data.media_url,author:$('.author-name',target)?.textContent||'EgyBook',avatar:profileData.avatar,caption:$('.post-text',target)?.textContent||data.text||'',date:new Date(data.created_at||Date.now()).toLocaleString('ar-EG'),postElement:target}],0,target,{push:false});}}catch(_){showToast('تعذر فتح رابط الصورة من السحابة.');}})();return;
      }
    }
    const postMatch=path.match(/^\/Egybook\/post\/([^/]+)\/?$/i);
    if(postMatch){openPostRoute(postMatch[1],{push:false});return;}
    const match=path.match(/^\/Egybook\/([^/]+)\/?$/i);
    if(match){
      const username=cleanUsername(match[1]);
      if(username===cleanUsername(profileData.username) || username==='egybook_user'){
        routeToProfile(username,{push:false,scroll:false});
      } else {
        routeToProfile(username,{push:false,scroll:false});
      }
    } else {
      routePostId=null;
      const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
      $('#memezPage').hidden=true;
      setPage('home',{push:false});
    }
  }
  async function loadPublicProfileByUsername(username){
    if(!supabase)return;
    const requested=cleanUsername(username);
    const loadToken=++profileLoadToken;
    try{
      const {data,error}=await supabase.from('profiles').select('*').eq('username',requested).maybeSingle();
      if(publicProfileUsername!==requested || loadToken!==profileLoadToken)return;
      if(error || !data){
        $('#profileNameText').textContent='الحساب غير متاح';
        $('.profile-handle').textContent='@'+requested;
        publicProfileId=null;publicProfileIsOwn=false;publicProfileData=null;updateProfileActionVisibility();renderProfilePosts();
        return;
      }
      const name=data.full_name || data.name || username;
      const publicProfile={
        name,
        username:cleanUsername(data.username || username),
        bio:data.bio || '',
        location:data.location || '',
        avatar:data.avatar_url || data.avatar || '',
        cover:data.cover_url || data.cover || ''
      };
      publicProfileId=data.id;
      refreshViewedProfileVerification();
      loadProfileFriends(data.id);
      publicProfileIsOwn=!!currentUser && data.id===currentUser.id;
      publicProfileData={...publicProfile,id:data.id};
      updateProfileActionVisibility();
      $('#profileNameText').textContent=publicProfile.name;addBadgeToUserName($('#profileNameText'),data.id);
      $('.profile-handle').textContent='@'+publicProfile.username;
      $('.profile-bio').textContent=publicProfile.bio;
      const details=$$('.profile-details span');if(details[0])details[0].textContent='⌖ '+(publicProfile.location||'لم يحدد الموقع');
      const avatar=$('.profile-large-avatar');if(avatar){avatar.style.backgroundImage='';avatar.textContent=(name||'ح').trim().charAt(0)||'ح';if(publicProfile.avatar){avatar.textContent='';avatar.style.backgroundImage='url("'+publicProfile.avatar.replace(/"/g,'%22')+'")';avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';}}
      const cover=$('.profile-cover');if(cover){
        const coverUrl=String(publicProfile.cover||'').trim();
        if(!coverUrl){cover.classList.remove('has-image');cover.style.backgroundImage='';delete cover.dataset.appliedCoverUrl;delete cover.dataset.pendingCoverUrl;}
        else if(cover.dataset.appliedCoverUrl!==coverUrl){
          cover.dataset.pendingCoverUrl=coverUrl;
          const coverImage=new Image();coverImage.decoding='async';
          coverImage.onload=()=>{if(cover.dataset.pendingCoverUrl!==coverUrl||publicProfileUsername!==requested||loadToken!==profileLoadToken)return;cover.style.backgroundImage='url("'+coverUrl.replace(/"/g,'%22')+'")';cover.classList.add('has-image');cover.dataset.appliedCoverUrl=coverUrl;delete cover.dataset.pendingCoverUrl;};
          coverImage.onerror=()=>{if(cover.dataset.pendingCoverUrl===coverUrl)delete cover.dataset.pendingCoverUrl;};
          coverImage.src=coverUrl;if(coverImage.complete&&coverImage.naturalWidth)coverImage.onload();
        }
      }
      const badge=$('#profileVerifiedBadge');
      if(badge){
        badge.hidden=false;
        badge.classList.add('verified-badge-inactive');
        badge.title='حساب غير موثّق';
        badge.setAttribute('aria-label','حساب غير موثّق');
        if(data.id===OWNER_USER_ID){
          badge.classList.remove('verified-badge-inactive');
          badge.title='هذا الحساب موثّق';
          badge.setAttribute('aria-label','هذا الحساب موثّق');
        }else if(supabase){
          supabase.from('verified_accounts').select('user_id,verification_type,expires_at').eq('user_id',data.id).maybeSingle()
            .then(({data:verification,error})=>{
              if(error || publicProfileId!==data.id)return;
              const active=!!verification&&(!verification.expires_at||new Date(verification.expires_at)>new Date());
              badge.classList.toggle('verified-badge-inactive',!active);
              badge.title=active?'هذا الحساب موثّق':'حساب غير موثّق';
              badge.setAttribute('aria-label',badge.title);
            }).catch(()=>{});
        }
      }
      updateProfileActionVisibility();
      renderProfilePosts();
      }catch(error){console.warn('Public profile lookup failed',error);}
  }
  let profilePostsRequestToken = 0;
  async function renderProfilePosts() {
    const target = $('#profilePostsList');
    const countNode = $('#profilePostsCount');
    if (!target) return;
    const requestToken = ++profilePostsRequestToken;
    const viewedId = publicProfileId || (publicProfileIsOwn ? currentUser?.id : null) || null;
    // Keep the last rendered posts/count visible during refresh to avoid flicker.
    // Show a loading placeholder only on the very first empty render.
    if (!target.children.length) {
      const loading = document.createElement('div');
      loading.className = 'profile-empty profile-loading-placeholder';
      loading.textContent = 'جارٍ تحميل المنشورات…';
      target.append(loading);
    }
    if (!viewedId || !supabase) {
      if (requestToken !== profilePostsRequestToken) return;
      if (!target.querySelector('.post')) {
        target.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'profile-empty';
        empty.textContent = viewedId ? 'تعذر الاتصال بقاعدة البيانات.' : 'تعذر تحديد الحساب المطلوب.';
        target.append(empty);
      }
      return;
    }
    try {
      let query = supabase.from('posts')
        .select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at')
        .eq('user_id', viewedId)
        .order('created_at', { ascending: false })
        .limit(500);
      // Other users' profiles only expose public posts. The owner can see their own posts.
      if (!publicProfileIsOwn) query = query.in('visibility', ['الجميع','عام','public','everyone','publico']);
      const { data, error } = await query;
      if (requestToken !== profilePostsRequestToken || viewedId !== (publicProfileId || (publicProfileIsOwn ? currentUser?.id : null))) return;
      if (error) throw error;
      const rows = data || [];
      if (countNode) countNode.textContent = String(rows.length);
      if (!rows.length) {
        if(!target.querySelector('.post')){
          target.replaceChildren();
          const empty = document.createElement('div');
          empty.className = 'profile-empty';
          empty.textContent = publicProfileIsOwn ? 'لسه مفيش منشورات هنا — شارك أول منشور ليك من زر +.' : 'لا توجد منشورات عامة لهذا الحساب حتى الآن.';
          target.append(empty);
        }
        return;
      }
      const { data: authorProfile } = await supabase.from('profiles')
        .select('id,username,full_name,avatar_url')
        .eq('id', viewedId).maybeSingle();
      if (requestToken !== profilePostsRequestToken) return;
      const validIds=new Set(rows.map(row=>String(row.id)));
      target.querySelectorAll('.post[data-cloud-post="true"],.post[data-user-post="true"]').forEach(post=>{
        if(post.dataset.postId && !validIds.has(String(post.dataset.postId)))post.remove();
      });
      const authorName = authorProfile?.full_name || authorProfile?.username || (publicProfileIsOwn ? profileData.name : $('.profile-handle')?.textContent?.replace(/^@/,'')) || 'عضو EgyBook';
      for(const row of rows){
        const id=String(row.id);
        let article=$(`[data-post-id="${CSS.escape(id)}"]`,target);
        if(!article){
          article=createPostElement({
            id, text:row.text||'', media:row.media_url||null, mediaType:row.media_type||null,
            visibility:row.visibility||'الجميع', createdAt:row.created_at?new Date(row.created_at).getTime():Date.now(),
            authorName, authorAvatar:authorProfile?.avatar_url||null
          });
          article.dataset.authorId=row.user_id||'';
          article.dataset.username=cleanUsername(authorProfile?.username||'');
          article.dataset.cloudPost='true';
          article.dataset.createdAt=String(row.created_at?new Date(row.created_at).getTime():Date.now());
          article.dataset.visibility=row.visibility||'الجميع';
          if(authorProfile?.avatar_url){const avatar=$('.post-header .avatar',article);if(avatar){avatar.textContent='';avatar.style.backgroundImage=`url("${String(authorProfile.avatar_url).replace(/"/g,'%22')}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';}}
          if(currentUser?.id && row.user_id===currentUser.id)article.dataset.userPost='true';
          // New profile posts must be attached to the target before the keyed
          // reconciliation/reordering pass below; otherwise they never render.
          target.append(article);
          addBadgeToUserName($('.post-author .author-name',article), row.user_id);
          restorePostState(article);syncPostStats(article);loadCloudPostStats(article);
        } else {
          // Existing posts can survive refreshes, but ensure their author badge
          // is present and resolved even if they were created by an older path.
          addBadgeToUserName($('.post-author .author-name',article), row.user_id);
        }
      }
      // Pinned posts first, then the newest posts. Reuse nodes to avoid a flash.
      const ordered=rows.slice().sort((a,b)=>{
        const ap=!!postState[String(a.id)]?.pinned,bp=!!postState[String(b.id)]?.pinned;
        if(ap!==bp)return ap?-1:1;
        return new Date(b.created_at||0)-new Date(a.created_at||0);
      });
      let cursor=target.firstElementChild;
      for(const row of ordered){
        const node=$(`[data-post-id="${CSS.escape(String(row.id))}"]`,target);if(!node)continue;
        if(node!==cursor)target.insertBefore(node,cursor||null);
        cursor=node.nextElementSibling;
      }
      const staleEmpty=target.querySelector('.profile-empty');if(staleEmpty)staleEmpty.remove();
    } catch (error) {
      if (requestToken !== profilePostsRequestToken) return;
      console.error('Profile posts load failed:', error);
      if(!target.querySelector('.post')){
        target.replaceChildren();
        const message = document.createElement('div');
        message.className = 'profile-empty';
        message.textContent = 'تعذر تحميل المنشورات. تحقق من صلاحيات Supabase (RLS) وحاول مرة أخرى.';
        target.append(message);
        if (countNode) countNode.textContent = '—';
      }
    }
  }

  let friendsDirectoryTab = 'friends';
  let friendsDirectoryOwnerId = null;
  let friendsDirectoryLoadingToken = 0;
  function ensureFriendsDirectoryPage(){
    let page=$('#friendsDirectoryPage');
    if(page)return page;
    page=document.createElement('section');
    page.id='friendsDirectoryPage'; page.className='friends-directory-page'; page.hidden=true;
    page.innerHTML=`
      <header class="friends-directory-header">
        <button type="button" class="friends-back" data-action="friends-directory-back" aria-label="رجوع">←</button>
        <div><h1>الأصدقاء</h1><p>تواصل مع أصدقائك على EgyBook</p></div>
      </header>
      <nav class="friends-directory-tabs" aria-label="أقسام الأصدقاء">
        <button type="button" data-action="friends-directory-tab" data-tab="friends" class="active">الأصدقاء <b id="directoryFriendsCount">0</b></button>
        <button type="button" data-action="friends-directory-tab" data-tab="requests">طلبات الصداقة <b id="directoryRequestsCount">0</b></button>
        <button type="button" data-action="friends-directory-tab" data-tab="suggestions">الاقتراحات</button>
      </nav>
      <div class="friends-directory-content" id="friendsDirectoryContent"><p class="friends-directory-empty">جارٍ تحميل الأصدقاء…</p></div>`;
    $('.container').after(page);
    return page;
  }
  function friendCard(profile, options={}){
    const card=document.createElement('article'); card.className='directory-friend-card';
    const avatar=document.createElement('button');avatar.type='button';avatar.className='directory-friend-avatar';avatar.dataset.action='directory-open-profile';avatar.dataset.username=profile.username||'';
    if(profile.avatar_url){const img=document.createElement('img');img.src=profile.avatar_url;img.alt='';img.loading='lazy';avatar.append(img);}
    else avatar.textContent=(profile.full_name||profile.username||'؟').trim().charAt(0)||'؟';
    const info=document.createElement('div');info.className='directory-friend-info';
    const name=document.createElement('button');name.type='button';name.className='directory-friend-name';name.dataset.action='directory-open-profile';name.dataset.username=profile.username||'';name.textContent=profile.full_name||profile.username||'مستخدم EgyBook';
    const handle=document.createElement('span');handle.textContent=profile.username?'@'+profile.username:'عضو في EgyBook';info.append(name,handle);
    const actions=document.createElement('div');actions.className='directory-friend-actions';
    if(options.requestId){
      const accept=document.createElement('button');accept.type='button';accept.className='directory-accept';accept.dataset.action='directory-accept-request';accept.dataset.requestId=options.requestId;accept.textContent='✓ تأكيد';
      const reject=document.createElement('button');reject.type='button';reject.className='directory-reject';reject.dataset.action='directory-reject-request';reject.dataset.requestId=options.requestId;reject.textContent='حذف';actions.append(accept,reject);
    } else {
      const open=document.createElement('button');open.type='button';open.className='directory-message';open.dataset.action='directory-open-profile';open.dataset.username=profile.username||'';open.textContent=options.isFriend?'عرض الملف الشخصي':'عرض الملف';actions.append(open);
    }
    card.append(avatar,info,actions);return card;
  }
  const friendsDirectoryCache = new Map();
  async function loadFriendsDirectory(tab=friendsDirectoryTab, ownerId=friendsDirectoryOwnerId){
    friendsDirectoryTab=tab; friendsDirectoryOwnerId=ownerId||currentUser?.id||null; const directoryOwnerId=friendsDirectoryOwnerId; const isOwnDirectory=!!currentUser&&directoryOwnerId===currentUser.id; const page=ensureFriendsDirectoryPage(); const content=$('#friendsDirectoryContent');
    $$('.friends-directory-tabs button',page).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    const token=++friendsDirectoryLoadingToken;
    const cacheKey=`${directoryOwnerId||'guest'}:${tab}`;
    // Social lists are account-sensitive. Never paint a cached list before verifying
    // the selected owner's accepted relationships; stale cache caused wrong identities.
    friendsDirectoryCache.delete(cacheKey);
    content.replaceChildren();
    const loading=document.createElement('p');loading.className='friends-directory-empty';
    loading.textContent='جارٍ تحميل البيانات…';content.append(loading);
    if(!supabase||!directoryOwnerId||(!currentUser&&!directoryOwnerId)){content.replaceChildren();const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='تعذر تحديد صاحب قائمة الأصدقاء.';content.append(empty);return;}
    if(!isOwnDirectory&&tab!=='friends'){tab='friends';friendsDirectoryTab='friends';$$('.friends-directory-tabs button',page).forEach(b=>b.classList.toggle('active',b.dataset.tab==='friends'));}
    try{
      const [sentRes,receivedRes]=await Promise.all([
        supabase.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('sender_id',directoryOwnerId).eq('status','accepted'),
        supabase.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('receiver_id',directoryOwnerId).eq('status','accepted')
      ]);
      if(sentRes.error)throw sentRes.error;if(receivedRes.error)throw receivedRes.error;
      const accepted=[...(sentRes.data||[]),...(receivedRes.data||[])];
      const friendIds=[...new Set(accepted.map(r=>r.sender_id===directoryOwnerId?r.receiver_id:r.sender_id))].filter(id=>id&&id!==directoryOwnerId);
      const reqRes=isOwnDirectory?await supabase.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').eq('receiver_id',directoryOwnerId).eq('status','pending').order('created_at',{ascending:false}):{data:[],error:null};
      if(reqRes.error)throw reqRes.error;
      const incoming=reqRes.data||[];
      const otherIds=[...new Set([...friendIds,...incoming.map(r=>r.sender_id)])];
      let profiles=[];
      if(otherIds.length){const pRes=await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',otherIds);if(pRes.error)throw pRes.error;profiles=pRes.data||[];}
      if(token!==friendsDirectoryLoadingToken||directoryOwnerId!==friendsDirectoryOwnerId)return;
      const byId=new Map(profiles.map(p=>[p.id,p]));
      $('#directoryFriendsCount').textContent=String(friendIds.length);
      $('#directoryRequestsCount').textContent=String(incoming.length);
      content.replaceChildren();
      if(tab==='friends'){
        const heading=document.createElement('h2');heading.className='friends-directory-section-title';heading.textContent=isOwnDirectory?'أصدقائي':'أصدقاء صاحب الملف الشخصي';content.append(heading);
        if(!friendIds.length){const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='لسه مفيش أصدقاء مضافين. لما تقبل أو تستقبل طلب صداقة هيظهروا هنا.';content.append(empty);}
        friendIds.forEach(id=>{const p=byId.get(id);if(p)content.append(friendCard(p,{isFriend:true}));});
      }else if(tab==='requests'){
        const heading=document.createElement('h2');heading.className='friends-directory-section-title';heading.textContent='طلبات الصداقة الواردة';content.append(heading);
        if(!incoming.length){const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='لا توجد طلبات صداقة واردة حاليًا.';content.append(empty);}
        incoming.forEach(r=>{const p=byId.get(r.sender_id);if(p)content.append(friendCard(p,{requestId:r.id}));});
      }else{
        const heading=document.createElement('h2');heading.className='friends-directory-section-title';heading.textContent='اقتراحات';content.append(heading);
        const existing=new Set([...friendIds,...incoming.map(r=>r.sender_id),directoryOwnerId]);
        const {data,error}=await supabase.from('profiles').select('id,full_name,username,avatar_url').limit(40);
        if(error)throw error;
        const suggestions=(data||[]).filter(p=>!existing.has(p.id)).slice(0,12);
        if(!suggestions.length){const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='لا توجد اقتراحات متاحة حاليًا.';content.append(empty);}
        suggestions.forEach(p=>content.append(friendCard(p)));
      }
      // Do not cache social lists; relationship data can change between account views.
    }catch(error){
      console.error('Friends directory load failed:',error);
      if(token!==friendsDirectoryLoadingToken||directoryOwnerId!==friendsDirectoryOwnerId)return;
      content.replaceChildren();const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='تعذر تحميل الأصدقاء. تأكد من وجود جدول friend_requests وسياسات RLS وإمكانية قراءة الملفات الشخصية.';content.append(empty);
    }
  }
  function openFriendsDirectory({push=true,tab='friends',ownerId=null}={}){
    const page=ensureFriendsDirectoryPage();
    // Resolve the owner from the profile currently on screen. Never silently
    // fall back to the signed-in account when a public profile is still loading.
    const resolvedOwnerId = ownerId || (publicProfileIsOwn ? currentUser?.id : publicProfileId) || null;
    friendsDirectoryOwnerId=resolvedOwnerId;
    if(!friendsDirectoryOwnerId){
      showToast('استنى لحظة لحد ما بيانات صاحب الملف الشخصي تكتمل، وبعدها افتح قائمة الأصدقاء مرة أخرى.');
      return;
    }
    if(friendsDirectoryOwnerId!==currentUser?.id)tab='friends';
    $('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;
    page.hidden=false;
    $$('.top-nav-item,.bottom-item').forEach(b=>b.classList.toggle('active',b.dataset.page==='friends'));
    if(push)history.pushState({page:'friends-directory'},'','#friends');
    loadFriendsDirectory(tab,friendsDirectoryOwnerId);window.scrollTo({top:0,behavior:'auto'});
  }
  function closeFriendsDirectory({push=true}={}){
    const page=$('#friendsDirectoryPage');if(page)page.hidden=true;
    if(push)history.pushState({page:'home'},'',SITE_BASE_PATH);
    setPage('home',{push:false});
  }

  function setPage(page, {push=true}={}) {
    closeNotifications();
    const friendsDirectory=$('#friendsDirectoryPage');if(friendsDirectory)friendsDirectory.hidden=true;
    currentPage = page;
    const reelsPage=$('#reelsPage'); if(reelsPage) reelsPage.hidden=(page!=='reels');
    $('#profilePage').hidden = true;
    $('.container').hidden = false;

    // Home always has its own canonical URL. Never leave /<username>#home behind.
    if (page === 'home') {
      const homePath = SITE_BASE_PATH;
      if (location.pathname !== homePath || location.search || location.hash) {
        if (push) history.pushState({page:'home'}, '', homePath);
        else history.replaceState({page:'home'}, '', homePath);
      }
    }

    $$('.top-nav-item, .bottom-item').forEach(button => button.classList.toggle('active', button.dataset.page === page && button.hasAttribute('data-page')));
    const labels = {home:'أحدث المنشورات', friends:'منشورات الأصدقاء', explore:'استكشف المنشورات', reels:'الريلز', saved:'المنشورات المحفوظة'};
    $('#feedTitle').textContent = labels[page] || 'أحدث المنشورات';
    $$('.post', postsList).forEach(post => {
      const saved = post.querySelector('[data-action="save"]')?.classList.contains('saved');
      post.hidden = (page === 'saved' && !saved) || page === 'reels';
    });
    if (page === 'friends') showToast('عرض تجريبي: لا يوجد اتصال بحسابات الأصدقاء حتى الآن.');
    if (page === 'explore') showToast('أنت تستكشف المنشورات المتاحة في الصفحة.');
    if (page === 'reels') { $$('.post', postsList).forEach(post=>post.hidden=true); $('.container').hidden=true; $('#profilePage').hidden=true; $('#memezPage').hidden=true; }
    updateEmptyState();
    if(window.__egybookAnimateRouteSurface) window.__egybookAnimateRouteSurface($('.container'));
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

  let imageViewerItems=[], imageViewerIndex=0, imageViewerReturnY=0, imageViewerPost=null, profileImageKind='avatar', imageViewerZoom=1, imageViewerHistoryPushed=false;
  function imageViewerCanonicalPath(item){
    const id=String(item?.id||'image');
    return `/Egybook/photo/${encodeURIComponent(id)}`;
  }
  function openImageViewer(items,index=0,post=null,{push=true}={}){
    imageViewerItems=(items||[]).filter(x=>x&&x.src);
    if(!imageViewerItems.length)return showToast('لا توجد صورة متاحة للمعاينة.');
    imageViewerIndex=Math.max(0,Math.min(index,imageViewerItems.length-1));
    imageViewerPost=post||imageViewerItems[imageViewerIndex]?.postElement||null;
    imageViewerReturnY=window.scrollY;
    imageViewerHistoryPushed=!!push;
    imageViewerZoom=1;
    const viewer=$('#imageViewer'); viewer.hidden=false; document.body.classList.add('image-viewer-open');
    if(push){const item=imageViewerItems[imageViewerIndex];history.pushState({page:'photo-viewer',returnY:imageViewerReturnY,photoId:item.id},'',imageViewerCanonicalPath(item));}
    renderImageViewer();
  }
  function getViewerPost(){
    const item=imageViewerItems[imageViewerIndex];
    if(imageViewerPost?.isConnected)return imageViewerPost;
    if(item?.postId)return $(`[data-post-id="${CSS.escape(String(item.postId))}"]`);
    return null;
  }
  async function loadViewerCloudStats(item,post){
    const reactions=$('#imageViewerReactionCount'),comments=$('#imageViewerCommentCount'),icons=$('#imageViewerReactionIcons');
    const postId=String(item?.postId||post?.dataset.postId||''),photoId=String(item?.id||'');
    if(!supabase){const state=postState[postId]||{};reactions.textContent=`${state.reaction?1:0} تفاعل`;comments.textContent=`${post?getCommentsFor(post).length:0} تعليق`;icons.textContent=state.reaction||'💙';return;}
    try{
      const table=postId?'post_reactions':'photo_reactions',commentTable=postId?'post_comments':'photo_comments',key=postId?'post_id':'photo_id',value=postId||photoId;
      if(!value)return;
      const [r,c]=await Promise.all([
        supabase.from(table).select('reaction').eq(key,value),
        supabase.from(commentTable).select('id',{count:'exact',head:true}).eq(key,value)
      ]);
      if(!r.error){const rows=r.data||[];reactions.textContent=`${rows.length} تفاعل`;icons.textContent=[...new Set(rows.map(x=>x.reaction))].slice(0,3).join(' ')||'💙';}
      if(!c.error)comments.textContent=`${c.count||0} تعليق`;
    }catch(_){}
  }
  function renderImageViewer(){
    const item=imageViewerItems[imageViewerIndex];if(!item)return;
    const image=$('#imageViewerImage');image.src=item.originalSrc||item.src;image.alt=item.caption||'صورة على EgyBook';image.style.transform=`scale(${imageViewerZoom})`;
    $('#imageViewerCounter').textContent=`${imageViewerIndex+1} / ${imageViewerItems.length}`;
    $('#imageViewerAuthor').textContent=item.author||profileData.name||'EgyBook';
    $('#imageViewerCaption').textContent=item.caption||'';
    $('#imageViewerDate').textContent=item.date||'';
    const avatar=$('#imageViewerAvatar');avatar.textContent=(item.author||profileData.name||'E').trim().slice(0,1);
    if(item.avatar){avatar.style.backgroundImage=`url("${item.avatar}")`;avatar.textContent='';}else avatar.style.backgroundImage='';
    $('#imageViewerResolution').textContent=item.width&&item.height?`${item.width} × ${item.height}`:'الصورة الأصلية';
    $('#imageViewerZoom').textContent=`${Math.round(imageViewerZoom*100)}%`;
    const thumbs=$('#imageViewerThumbs');thumbs.replaceChildren();thumbs.hidden=imageViewerItems.length<2;
    if(imageViewerItems.length>1){
      imageViewerItems.forEach((entry,i)=>{const b=document.createElement('button');b.type='button';b.className='image-viewer-thumb'+(i===imageViewerIndex?' active':'');b.setAttribute('aria-label',`الصورة ${i+1}`);const im=document.createElement('img');im.src=entry.thumbSrc||entry.src;im.alt='';b.append(im);b.addEventListener('click',()=>{imageViewerIndex=i;imageViewerZoom=1;renderImageViewer();});thumbs.append(b);});
      thumbs.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
    }
    loadViewerCloudStats(item,getViewerPost());
  }
  function closeImageViewer({historyBack=true}={}){
    const viewer=$('#imageViewer');if(viewer.hidden)return;
    viewer.hidden=true;document.body.classList.remove('image-viewer-open');
    if(historyBack && /^\/Egybook\/(photo|profile-photo|cover-photo)\//i.test(location.pathname)){
      if(imageViewerHistoryPushed){history.back();return;}
      history.replaceState({page:'home'},'','/Egybook/');
      routeFromLocation();
    }
    window.scrollTo({top:imageViewerReturnY,behavior:'instant'});
  }
  function stepImage(delta){if(!imageViewerItems.length)return;imageViewerIndex=(imageViewerIndex+delta+imageViewerItems.length)%imageViewerItems.length;imageViewerZoom=1;renderImageViewer();}
  async function downloadViewerImage(){
    const item=imageViewerItems[imageViewerIndex];if(!item)return;
    const src=item.originalSrc||item.src;
    try{
      const response=await fetch(src,{mode:'cors',credentials:'omit'});
      if(!response.ok)throw new Error('download failed');
      const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=objectUrl;a.download=(String(item.id||'egybook-photo').replace(/[^a-z0-9_-]/gi,'_')+'.'+((blob.type.split('/')[1]||'jpg').replace('jpeg','jpg')));
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
      showToast('بدأ تنزيل الصورة الأصلية من EgyBook.');
    }catch(_){
      const a=document.createElement('a');a.href=src;a.download=`egybook-${item.id||'photo'}`;a.target='_blank';a.rel='noopener';a.click();
      showToast('إذا فتح المتصفح الصورة بدل تنزيلها، استخدم قائمة المتصفح للتنزيل.');
    }
  }
  async function showViewerReactions(){
    const item=imageViewerItems[imageViewerIndex],post=getViewerPost(),postId=String(item?.postId||post?.dataset.postId||''),photoId=String(item?.id||'');
    if(!supabase){if(post)showPostReactions(post);else showToast('التفاعلات السحابية تحتاج إلى إعداد Supabase وتسجيل الدخول.');return;}
    let modal=$('#postReactionsModal');
    if(!modal){modal=document.createElement('div');modal.id='postReactionsModal';modal.className='modal';modal.innerHTML='<div class="modal-box"><div class="modal-header"><h2>التفاعلات</h2><button class="close-modal" data-action="close-modal">×</button></div><div id="postReactionsList"></div></div>';document.body.append(modal);}
    const list=$('#postReactionsList');list.replaceChildren();const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التفاعلات…';list.append(loading);openModal(modal);
    try{
      const table=postId?'post_reactions':'photo_reactions',key=postId?'post_id':'photo_id',value=postId||photoId;
      const {data,error}=await supabase.from(table).select('user_id,reaction,profiles(full_name,username,avatar_url)').eq(key,value).order('created_at',{ascending:false});
      list.replaceChildren();
      if(error)throw error;
      if(!data?.length){const empty=document.createElement('p');empty.className='empty-message';empty.textContent='لا توجد تفاعلات حتى الآن.';list.append(empty);return;}
      data.forEach(row=>{const el=document.createElement('div');el.className='reaction-person-row';const avatar=document.createElement('span');avatar.className='avatar';const profile=row.profiles||{};if(profile.avatar_url){avatar.style.backgroundImage=`url("${profile.avatar_url}")`;avatar.style.backgroundSize='cover';avatar.textContent='';}else avatar.textContent=(profile.full_name||'ع').slice(0,1);const name=document.createElement('strong');name.textContent=profile.full_name||profile.username||'عضو EgyBook';const reaction=document.createElement('span');reaction.className='reaction-person-emoji';reaction.textContent=row.reaction||'👍';el.append(avatar,name,reaction);list.append(el);});
    }catch(e){list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='تعذر تحميل التفاعلات من السحابة. شغّل تحديث إعدادات Supabase ثم حاول مرة أخرى.';list.append(msg);}
  }
  async function showPhotoComments(item){
    if(!supabase){showToast('تعليقات الصور تحتاج إلى إعداد Supabase.');return;}
    let modal=$('#photoViewerCommentsModal');
    if(!modal){
      modal=document.createElement('div');modal.id='photoViewerCommentsModal';modal.className='modal';
      modal.innerHTML='<div class="modal-box"><div class="modal-header"><h2>تعليقات الصورة</h2><button class="close-modal" data-action="close-modal">×</button></div><div id="photoViewerCommentsList"></div><form id="photoViewerCommentForm" class="comment-form"><input id="photoViewerCommentInput" maxlength="5000" placeholder="اكتب تعليقك..." required><button type="submit" class="primary-button">إرسال</button></form></div>';
      document.body.append(modal);
      $('#photoViewerCommentForm',modal).addEventListener('submit',async event=>{
        event.preventDefault();const text=$('#photoViewerCommentInput',modal).value.trim();const active=modal.dataset.photoId;if(!text||!active)return;
        if(!currentUser){showToast('سجّل الدخول لإضافة تعليق.');return;}
        const {error}=await supabase.from('photo_comments').insert({photo_id:active,user_id:currentUser.id,user_name:getActiveProfileName(),body:text});
        if(error){showToast('تعذر حفظ التعليق: '+error.message);return;}
        $('#photoViewerCommentInput',modal).value='';await renderPhotoComments(active);renderImageViewer();showToast('تم نشر التعليق.');
      });
    }
    modal.dataset.photoId=String(item.id||'');await renderPhotoComments(modal.dataset.photoId);openModal(modal);
  }
  async function renderPhotoComments(photoId){
    const list=$('#photoViewerCommentsList');if(!list)return;list.replaceChildren();
    const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التعليقات…';list.append(loading);
    const {data,error}=await supabase.from('photo_comments').select('user_name,body,created_at').eq('photo_id',photoId).order('created_at',{ascending:true});
    list.replaceChildren();
    if(error){const p=document.createElement('p');p.className='empty-message';p.textContent='تعذر تحميل التعليقات. تأكد من إعداد Supabase.';list.append(p);return;}
    if(!data?.length){const p=document.createElement('p');p.className='empty-message';p.textContent='لا توجد تعليقات حتى الآن.';list.append(p);return;}
    data.forEach(row=>{const article=document.createElement('article');article.className='egy-comment';const name=document.createElement('strong');name.textContent=row.user_name||'عضو EgyBook';const body=document.createElement('p');body.className='egy-comment-text';body.textContent=row.body||'';const time=document.createElement('small');time.textContent=new Date(row.created_at).toLocaleString('ar-EG');article.append(name,body,time);list.append(article);});
  }
  function openAlbums(){
    const grid=$('#albumGrid'),photos=$('#albumPhotos');grid.hidden=false;photos.hidden=true;grid.replaceChildren();
    const albums=[['cover','صور الغلاف'],['avatar','الصور الشخصية'],['posts','صور المنشورات']];
    albums.forEach(([key,title])=>{
      const items=albumsData[key]||[];const b=document.createElement('button');b.className='album-card';b.dataset.album=key;
      const cover=document.createElement('div');cover.className='album-cover';
      if(items[0]?.src){const img=document.createElement('img');img.src=items[0].src;img.alt='';cover.append(img);}
      else {cover.textContent=key==='cover'?'🌇':key==='avatar'?'👤':'🖼️';}
      const name=document.createElement('strong');name.textContent=title;const count=document.createElement('small');count.textContent=`${items.length} صورة`;
      b.append(cover,name,count);b.addEventListener('click',()=>showAlbum(key,title));grid.append(b);
    });
    openModal($('#photoAlbumsModal'));
  }
  function showAlbum(key,title){
    currentAlbum=key;const grid=$('#albumGrid'),photos=$('#albumPhotos');grid.hidden=true;photos.hidden=false;photos.replaceChildren();
    const items=albumsData[key]||[];
    if(!items.length){const p=document.createElement('p');p.className='empty-message';p.textContent='الألبوم فارغ حتى الآن. الصور التي تحفظها أو تنشرها لاحقًا ستظهر هنا.';photos.append(p);}
    items.forEach((item,i)=>{const b=document.createElement('button');b.className='album-photo-button';b.type='button';const img=document.createElement('img');img.src=item.src;img.alt=title;img.loading='lazy';b.append(img);b.addEventListener('click',()=>{closeModal($('#photoAlbumsModal'));openImageViewer(items.map((x,j)=>({id:x.id||`${key}-${x.date||j}`,src:x.src,author:profileData.name,caption:title})),i,null,{push:true});});photos.append(b);});
    const back=document.createElement('button');back.className='primary-button album-back';back.textContent='رجوع إلى الألبومات';back.addEventListener('click',openAlbums);photos.append(back);
  }


  let activeCommentsPost = null, replyToComment = null, commentSortMode = 'relevant', commentData = {};
  function getCommentsFor(post){
    const id=post?.dataset.postId||'unknown';
    if(!commentData[id]){
      const area=$('.comments-area',post);
      const seeded=area?[...area.querySelectorAll('[data-comment]')].map((el,i)=>({id:'seed-'+i,name:el.dataset.name||'عضو EgyBook',time:el.dataset.time||'الآن',text:el.textContent.trim(),likes:0,dislikes:0,replies:[]})):[];
      commentData[id]=seeded;
      
    }
    return commentData[id];
  }
  function saveComments(){ /* Comment cache disabled; Supabase is the source of truth. */ }
  function getActiveProfileName(){
    return (profileData.name || currentUser?.user_metadata?.full_name || 'حسابي').trim();
  }
  async function loadCloudComments(post){
    const id=String(post?.dataset.postId||'');
    if(!id||!supabase)return;
    try{
      const {data,error}=await supabase.from('post_comments').select('id,user_id,user_name,body,created_at,parent_id').eq('post_id',id).order('created_at',{ascending:true});
      if(error)throw error;
      post.dataset.cloudCommentCount=String((data||[]).length);
      const userIds=[...new Set((data||[]).map(c=>c.user_id).filter(Boolean))];
      const authorProfiles={};
      if(userIds.length){
        const {data:profiles,error:profilesError}=await supabase.from('profiles').select('id,username,avatar_url,full_name').in('id',userIds);
        if(!profilesError)for(const p of (profiles||[]))authorProfiles[p.id]=p;
      }
      const cloudRows=(data||[]).map(c=>{const author=authorProfiles[c.user_id]||{};return {id:String(c.id),parentId:c.parent_id?String(c.parent_id):null,name:author.full_name||c.user_name||'عضو EgyBook',username:author.username||'',avatar:author.avatar_url||'',time:new Date(c.created_at).toLocaleString('ar-EG'),text:c.body,likes:0,dislikes:0,replies:[],cloud:true,userId:c.user_id};});
      const cloudById=new Map(cloudRows.map(c=>[c.id,c]));
      const cloud=[];
      cloudRows.forEach(c=>{if(c.parentId&&cloudById.has(c.parentId)){cloudById.get(c.parentId).replies.push(c);}else if(!c.parentId){cloud.push(c);}});
      const existing=getCommentsFor(post);
      const local=existing.filter(c=>!c.cloud);
      commentData[id]=[...local,...cloud];
      saveComments();
      if(activeCommentsPost===post){renderComments();syncPostStats(post);}
      syncPostCopies(id,post);
    }catch(error){console.warn('Cloud comments unavailable:',error.message||error);}
  }
  function openComments(post,{push=false,commentId=null}={}){
    activeCommentsPost=post;
    if(commentId)highlightCommentId=String(commentId);
    applyCommentComposerAvatar();
    if(push && post?.dataset.postId){routePostId=post.dataset.postId;history.pushState({page:'post',postId:routePostId},'',postPath(routePostId));}
    loadCloudComments(post);
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
  async function openCommentAuthorProfile(comment){
    closeModal($('#commentsModal'));
    if(!comment){showToast('تعذر تحديد صاحب التعليق.');return;}
    const userId=String(comment.userId||'');
    if(currentUser?.id && userId===currentUser.id){routeToProfile(profileData.username,{push:true});return;}
    if(supabase && userId){
      try{
        const {data,error}=await supabase.from('profiles').select('id,username').eq('id',userId).maybeSingle();
        if(!error && data?.username){routeToProfile(data.username,{push:true});return;}
      }catch(error){console.warn('Comment author profile lookup failed:',error);}
    }
    const username=String(comment.username||'').trim();
    if(username){routeToProfile(username,{push:true});return;}
    showToast('لا يوجد اسم مستخدم مرتبط بهذا التعليق.');
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
      const row=document.createElement('article');row.className='egy-comment'+(depth?' egy-comment-reply':'');row.dataset.commentId=c.id;if(highlightCommentId&&String(c.id)===String(highlightCommentId))row.classList.add('notification-comment-highlight');row.style.setProperty('--reply-depth',Math.min(depth,3));
      const main=document.createElement('div');main.className='egy-comment-main';
      const meta=document.createElement('div');meta.className='egy-comment-meta';
      const name=document.createElement('button');name.type='button';name.className='egy-comment-name comment-profile-link';name.textContent=c.name||'عضو EgyBook';name.addEventListener('click',()=>openCommentAuthorProfile(c));
      addBadgeToUserName(name,c.userId||'');
      const time=document.createElement('span');time.textContent='· '+(c.time||'الآن');meta.append(name,time);
      const body=document.createElement('div');body.className='egy-comment-text';body.textContent=c.text||'';
      const actions=document.createElement('div');actions.className='egy-comment-actions';
      const reply=document.createElement('button');reply.className='reply';reply.dataset.action='comment-reply';reply.textContent='رد';
      const hide=document.createElement('button');hide.dataset.action='comment-hide';hide.textContent='إخفاء';actions.append(reply,hide);
      main.append(meta,body,actions);
      const avatar=document.createElement('button');avatar.type='button';avatar.className='egy-comment-avatar comment-profile-link';avatar.setAttribute('aria-label','فتح الملف الشخصي');
      const authorAvatar=String(c.avatar||'').trim();
      if(authorAvatar){
        avatar.style.backgroundImage=`url("${authorAvatar.replace(/"/g,'%22')}")`;
        avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';avatar.textContent='';
        avatar.classList.add('has-avatar-image');
      }else{
        avatar.style.backgroundImage='';
        avatar.textContent=(c.name||'ع').trim().slice(0,1);
        avatar.classList.remove('has-avatar-image');
      }
      avatar.addEventListener('click',()=>openCommentAuthorProfile(c));
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
    if(highlightCommentId){const target=$(`[data-comment-id="${CSS.escape(String(highlightCommentId))}"]`,list);if(target){requestAnimationFrame(()=>{target.scrollIntoView({behavior:'smooth',block:'center'});});setTimeout(()=>target.classList.remove('notification-comment-highlight'),5000);highlightCommentId=null;}}
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

  function openSidebar(){
    const drawer=$('#egySidebar'),backdrop=$('#sidebarBackdrop'),trigger=$('.menu-trigger');
    if(!drawer||!backdrop)return;
    drawer.classList.add('is-open');backdrop.hidden=false;document.body.classList.add('sidebar-open');
    if(!history.state?.sidebarOpen)history.pushState({...history.state,sidebarOpen:true},'',location.href);
    drawer.setAttribute('aria-hidden','false');if(trigger)trigger.setAttribute('aria-expanded','true');
  }
  function closeSidebar(){
    const drawer=$('#egySidebar'),backdrop=$('#sidebarBackdrop'),trigger=$('.menu-trigger');
    if(!drawer||!backdrop)return;
    const hadSidebarState=!!history.state?.sidebarOpen;
    drawer.classList.remove('is-open');backdrop.hidden=true;document.body.classList.remove('sidebar-open');
    drawer.setAttribute('aria-hidden','true');if(trigger)trigger.setAttribute('aria-expanded','false');
    if(hadSidebarState && !window.__egybookHandlingSidebarPop){
      // The drawer's history entry is UI-only. Ignore its popstate so closing
      // the drawer does not route/render the underlying page a second time.
      window.__egybookIgnoreSidebarPop=true;
      history.back();
    }
  }
  function toggleSidebar(){ $('#egySidebar')?.classList.contains('is-open')?closeSidebar():openSidebar(); }
  $('#sidebarBackdrop')?.addEventListener('click',closeSidebar);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSidebar();});
  // Swipe the right-side drawer toward the right to close it on touch screens.
  (()=>{const drawer=$('#egySidebar');if(!drawer)return;let sx=0,sy=0,tracking=false;
    drawer.addEventListener('touchstart',e=>{if(!drawer.classList.contains('is-open')||e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;tracking=true;},{passive:true});
    drawer.addEventListener('touchend',e=>{if(!tracking||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;tracking=false;if(dx>75&&Math.abs(dy)<90)closeSidebar();},{passive:true});
  })();
  const reelInput=$('#reelUploadInput');
  if(reelInput) reelInput.addEventListener('change',()=>{
    const file=reelInput.files?.[0]; if(!file)return;
    if(!/^video\/(mp4|webm|quicktime)$/.test(file.type)){showToast('اختار فيديو MP4 أو WebM أو MOV مدعوم.');reelInput.value='';return;}
    const url=URL.createObjectURL(file),stage=$('#reelsStage');stage.replaceChildren();
    const wrap=document.createElement('div');wrap.className='reel-player';
    const video=document.createElement('video');video.src=url;video.controls=false;video.playsInline=true;video.autoplay=true;
    const controls=document.createElement('div');controls.className='reel-controls';
    controls.innerHTML='<button type="button" data-reel="toggle">⏯</button><button type="button" data-reel="back">↶ 10</button><button type="button" data-reel="forward">10 ↷</button><input type="range" min="0" max="100" value="0" aria-label="موضع الفيديو"><button type="button" data-reel="mute">🔊</button><select aria-label="سرعة التشغيل"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><button type="button" data-reel="fullscreen">⛶</button>';
    wrap.append(video,controls);stage.append(wrap);
    const seek=controls.querySelector('input');
    video.addEventListener('timeupdate',()=>{if(video.duration)seek.value=String(video.currentTime/video.duration*100);});
    seek.addEventListener('input',()=>{if(video.duration)video.currentTime=Number(seek.value)/100*video.duration;});
    controls.addEventListener('click',e=>{const b=e.target.closest('button[data-reel]');if(!b)return;switch(b.dataset.reel){case'toggle':video.paused?video.play():video.pause();break;case'back':video.currentTime=Math.max(0,video.currentTime-10);break;case'forward':video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10);break;case'mute':video.muted=!video.muted;b.textContent=video.muted?'🔇':'🔊';break;case'fullscreen':(wrap.requestFullscreen||wrap.webkitRequestFullscreen)?.call(wrap);break;}});
    controls.querySelector('select').addEventListener('change',e=>video.playbackRate=Number(e.target.value));
  });
  document.addEventListener('click', event => {
    const verificationBadge=event.target.closest('[data-verified-badge]');
    if(verificationBadge){
      event.preventDefault();
      if(verificationBadge.classList.contains('verified-badge-inactive')){
        if(!currentUser||!supabase){showToast('سجّل الدخول أولًا لطلب توثيق حسابك.');return;}
        (async()=>{
          try{
            const {data:existing,error:lookupError}=await supabase.from('verification_requests').select('id,status').eq('user_id',currentUser.id).eq('status','pending').maybeSingle();
            if(lookupError)throw lookupError;
            if(existing){showToast('طلب التوثيق الخاص بك قيد المراجعة بالفعل.');return;}
            const displayName = String(profileData?.name || currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'عضو EgyBook').trim();
            const {error}=await supabase.from('verification_requests').insert({user_id:currentUser.id,display_name:displayName,plan:'free',message:'طلب توثيق حساب EgyBook'});
            if(error)throw error;
            showToast('تم إرسال طلب التوثيق. ستراجعه إدارة EgyBook.');
          }catch(error){console.error('Verification request failed:',error);showToast('تعذر إرسال طلب التوثيق: '+(error?.message||'راجع صلاحيات الجدول وأعمدته في Supabase.'));}
        })();
        return;
      }
      showVerifiedInfo();
      return;
    }
    if(event.target.closest('[data-verified-badge]')){event.preventDefault();event.stopPropagation();showVerifiedInfo();return;}
    const activePicker=$('#commentReactionPicker');
    if(activePicker && !activePicker.hidden && !event.target.closest('#commentReactionPicker') && !event.target.closest('[data-action="like"]')) activePicker.hidden=true;
    if(event.target.closest('.create-post .composer-row .avatar')){showProfile();return;}
    const statAction=event.target.closest('[data-action="reactions-open"],[data-action="comments-open"]');
    if(statAction){const post=statAction.closest('.post');if(!post)return;if(statAction.dataset.action==='reactions-open')showPostReactions(post);else openComments(post,{push:true});return;}
    const postAvatar=event.target.closest('.post-header .avatar,.post-author .author-name,.post-image');
    if(postAvatar && !event.target.closest('button[data-action="post-menu"]')){
      const post=postAvatar.closest('.post');
      if(event.target.closest('.post-image')){const media=$('.post-image',post);if(media?.tagName==='IMG'){const postId=post.dataset.postId||'post-image';openImageViewer([{id:`post-${postId}`,postId,src:media.currentSrc||media.src,originalSrc:media.src,author:$('.author-name',post)?.textContent||'EgyBook',avatar:profileData.avatar,caption:$('.post-text',post)?.textContent||'',date:$('.post-meta',post)?.textContent||'',postElement:post}],0,post,{push:true});}else openPostRoute(post?.dataset.postId,{push:true});return;}
      const author=$('.author-name',post);const name=(author?.textContent||'').replace(/✓/g,'').trim();
      const target=post?.dataset?.userPost==='true'?profileData.username:cleanUsername(post?.dataset?.username||name);
      routeToProfile(target,{push:true});return;
    }
    const button = event.target.closest('button'); if (!button) return;
    const action = button.dataset.action;
    if(action==='friends-directory-back'){if(friendsDirectoryOwnerId&&currentUser&&friendsDirectoryOwnerId!==currentUser.id&&publicProfileData?.username){routeToProfile(publicProfileData.username,{push:false});}else closeFriendsDirectory();return;}
    if(action==='profile-all-friends'){
      const ownerId=publicProfileIsOwn ? currentUser?.id : publicProfileId;
      if(!ownerId){showToast('جارٍ تحميل بيانات صاحب الملف الشخصي. حاول مرة أخرى بعد لحظة.');return;}
      openFriendsDirectory({tab:'friends',ownerId});return;
    }
    if(action==='friends-directory-tab'){loadFriendsDirectory(button.dataset.tab||'friends',friendsDirectoryOwnerId);return;}
    if(action==='directory-open-profile'){const username=button.dataset.username;if(username)routeToProfile(username,{push:true});else showToast('اسم المستخدم غير متاح لفتح الملف الشخصي.');return;}
    if(action==='directory-accept-request'||action==='directory-reject-request'){(async()=>{if(!currentUser||!supabase)return;button.disabled=true;try{const status=action==='directory-accept-request'?'accepted':'rejected';const {error}=await supabase.from('friend_requests').update({status,updated_at:new Date().toISOString()}).eq('id',button.dataset.requestId).eq('receiver_id',currentUser.id).eq('status','pending');if(error)throw error;showToast(status==='accepted'?'تمت إضافة الصديق بنجاح.':'تم رفض طلب الصداقة.');await loadFriendsDirectory(friendsDirectoryTab);if(publicProfileId)loadProfileFriends(publicProfileId);}catch(error){console.error(error);showToast('تعذر تحديث طلب الصداقة. راجع سياسات RLS.');}finally{button.disabled=false;}})();return;}
    if(action==='profile-relationship'){sendProfileFriendRequest();return;}
    if(action==='profile-follow'){toggleProfileFollow();return;} if(action==='open-auth'){closeSidebar();setAuthMode('login');refreshAuthUI();openModal($('#supabaseAuthModal'));return;} if(action==='reels-close'){history.pushState({page:'home'},'',SITE_BASE_PATH);routeFromLocation();return;}
    if(action==='reels-upload'){ $('#reelUploadInput')?.click();return; }
    if(action==='memez-open'){history.pushState({page:'memez'},'','/Egybook/memez');routeFromLocation();return;}
    if(action==='memez-close'){history.pushState({page:'home'},'',SITE_BASE_PATH);routeFromLocation();return;}
    if(action==='memez-coming'){showToast('قريبًا');return;}
    if(action==='post-viewer-close'){closePostViewer();return;}
    if(action==='image-viewer-close'){closeImageViewer();return;}
    if(action==='image-prev'){stepImage(-1);return;}
    if(action==='image-next'){stepImage(1);return;}
    if(action==='image-like'){const post=getViewerPost(),item=imageViewerItems[imageViewerIndex];if(post){const like=$('[data-action="like"]',post);if(like)like.click();setTimeout(()=>renderImageViewer(),180);}else if(supabase&&currentUser&&item?.id){(async()=>{const {data}=await supabase.from('photo_reactions').select('reaction').eq('photo_id',String(item.id)).eq('user_id',currentUser.id).maybeSingle();let result;if(data?.reaction==='👍')result=await supabase.from('photo_reactions').delete().eq('photo_id',String(item.id)).eq('user_id',currentUser.id);else result=await supabase.from('photo_reactions').upsert({photo_id:String(item.id),user_id:currentUser.id,reaction:'👍',updated_at:new Date().toISOString()},{onConflict:'photo_id,user_id'});if(result?.error)showToast('تعذر حفظ التفاعل في السحابة.');else{showToast(data?.reaction==='👍'?'تم إلغاء الإعجاب.':'تم تسجيل إعجابك.');renderImageViewer();}})();}else showToast('سجّل الدخول للتفاعل مع الصورة.');return;}
    if(action==='image-comments'){const post=getViewerPost(),item=imageViewerItems[imageViewerIndex];if(post){openComments(post,{push:false});}else if(item)showPhotoComments(item);else showToast('الصورة غير متاحة.');return;}
    if(action==='image-reactions-open'){showViewerReactions();return;}
    if(action==='image-share'){const item=imageViewerItems[imageViewerIndex];const url=location.origin+imageViewerCanonicalPath(item);if(navigator.share)navigator.share({title:'EgyBook',url}).catch(()=>{});else navigator.clipboard?.writeText(url).then(()=>showToast('تم نسخ رابط معاينة الصورة.')).catch(()=>showToast(url));return;}
    if(action==='image-download'){downloadViewerImage();return;}
    if(action==='image-more'||action==='image-copy-link'){const item=imageViewerItems[imageViewerIndex];const url=location.origin+imageViewerCanonicalPath(item);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط معاينة الصورة.')).catch(()=>showToast(url));else showToast(url);return;}
    if(action==='image-zoom-in'){imageViewerZoom=Math.min(3,imageViewerZoom+0.25);renderImageViewer();return;}
    if(action==='image-zoom-out'){imageViewerZoom=Math.max(0.5,imageViewerZoom-0.25);renderImageViewer();return;}
    if(action==='image-fullscreen'){const stage=$('.image-viewer-stage');if(document.fullscreenElement)document.exitFullscreen?.();else (stage?.requestFullscreen||stage?.webkitRequestFullscreen)?.call(stage);return;}
    if(action==='image-save'){showToast('حفظ الصور في المفضلة على السحابة يحتاج إلى إعداد جدول المفضلة أولًا.');return;}
    if(action==='image-info'){const item=imageViewerItems[imageViewerIndex];const image=$('#imageViewerImage');showToast(`${image.naturalWidth||item?.width||'؟'} × ${image.naturalHeight||item?.height||'؟'} بكسل`);return;}
    if(action==='profile-image-preview'){closeModal($('#profileImageOptionsModal'));const src=profileImageKind==='cover'?profileData.cover:profileData.avatar;if(src)openImageViewer([{id:profileImageKind+'-'+(currentUser?.id||profileData.username),src,originalSrc:src,author:profileData.name,avatar:profileData.avatar,caption:profileImageKind==='cover'?'صورة الغلاف':'الصورة الشخصية',kind:profileImageKind}],0,null,{push:true});else showToast('لا توجد صورة محفوظة حاليًا.');return;}
    if(action==='profile-image-change'){closeModal($('#profileImageOptionsModal'));(profileImageKind==='cover'?$('#profileCoverInput'):$('#profilePhotoInput')).click();return;}
    if(action==='post-viewer-comments'){const post=$(`[data-post-id="${CSS.escape(String(routePostId||''))}"]`,postsList);if(post)openComments(post);return;}
    if(action==='sidebar-toggle'){toggleSidebar();return;}
    if(action==='sidebar-close'){closeSidebar();return;}
    if(action==='sidebar-friends'){closeSidebar();setPage('friends');return;}
    if(action==='sidebar-saved'){closeSidebar();setPage('saved');return;}
    if(action==='sidebar-activity'){closeSidebar();showToast('سجل النشاط سيظهر هنا عند تفعيل حفظ الأنشطة.');return;}
    if(action==='sidebar-dashboard'){closeSidebar();showToast('لوحة التحكم المتقدمة متاحة عند ربط صلاحيات الإدارة.');return;}
    if(action==='sidebar-settings'){closeSidebar();openEditProfile();return;}
    if(action==='sidebar-appearance'){closeSidebar();showToast('المظهر الحالي: EgyBook الداكن النيون.');return;}
    if(action==='sidebar-language'){closeSidebar();showToast('اللغة الحالية: العربية.');return;}
    if(action==='sidebar-help'){closeSidebar();showToast('للمساعدة والدعم، تواصل مع إدارة EgyBook.');return;}
    if(action==='sidebar-logout'){
      closeSidebar();
      if(!currentUser){showToast('أنت غير مسجل الدخول.');return;}
      $('#supabaseSignOut').click();return;
    }
    if(action==='comments-close'){
      closeModal($('#commentsModal'));
      replyToComment=null;
      // The comments panel is an overlay on the current post route; closing it must
      // not unexpectedly send the user home or require multiple exit taps.
      if(location.pathname.startsWith(POST_ROUTE_BASE)){
        document.body.classList.add('post-route-open');
        const viewer=$('#postViewer');if(viewer)viewer.hidden=false;
      } else {
        document.body.classList.remove('post-route-open');
      }
      activeCommentsPost=null;
      return;
    }
    if(action==='comments-sort'){const menu=$('#commentsSortMenu');menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));return;}
    if(action==='sort-comments'){commentSortMode=button.dataset.sort;$('#commentsSortMenu').hidden=true;$('#commentsSortButton').querySelector('span').textContent=button.querySelector('span').textContent;$$('#commentsSortMenu button').forEach(b=>b.classList.toggle('active',b===button));renderComments();return;}
    if(action==='comment-reply'){replyToComment=button.closest('.egy-comment')?.dataset.commentId||null;$('#commentInput').placeholder='اكتب ردك...';$('#commentInput').focus();return;}
    if(action==='comment-hide'){const row=button.closest('.egy-comment');if(row)row.remove();return;}
    if(action==='comment-vote'){const row=button.closest('.egy-comment'),c=findCommentById(getCommentsFor(activeCommentsPost),row?.dataset.commentId);if(c){c.vote=c.vote===button.dataset.vote?null:button.dataset.vote;saveComments();renderComments();}return;}
    if (button.dataset.page) { if(button.dataset.page==='friends'){openFriendsDirectory();return;} if(button.dataset.page==='reels'){history.pushState({page:'reels'},'','/Egybook/reels');routeFromLocation();return;} setPage(button.dataset.page); return; }
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
    else if (action === 'notifications') openNotifications();
    else if (action === 'notifications-refresh') loadNotifications();
    else if (action === 'notification-tab') {notificationTab=button.dataset.notificationTab||'all';$$('[data-notification-tab]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});renderNotifications();}
    else if (action === 'notification-accept'||action === 'notification-reject') { (async()=>{if(!currentUser||!supabase)return;button.disabled=true;try{const status=action==='notification-accept'?'accepted':'rejected';const {error}=await supabase.from('friend_requests').update({status,updated_at:new Date().toISOString()}).eq('id',button.dataset.requestId).eq('receiver_id',currentUser.id).eq('status','pending');if(error)throw error;showToast(status==='accepted'?'تم قبول طلب الصداقة.':'تم رفض طلب الصداقة.');await loadNotifications();}catch(error){console.error(error);showToast('تعذر تحديث طلب الصداقة. راجع سياسات RLS.');}finally{button.disabled=false;}})();}
    else if (action === 'notification-view-post') {const card=button.closest('.notification-card');const item=notificationItems.find(x=>x.id===card?.dataset.notificationId);if(item)markNotificationRead(item);const id=button.dataset.postId;closeNotifications();if(id)openPostRoute(id);}
    else if (action === 'notification-view-comment') {const card=button.closest('.notification-card');const item=notificationItems.find(x=>x.id===card?.dataset.notificationId);if(item)markNotificationRead(item);const id=button.dataset.postId,commentId=button.dataset.commentId;closeNotifications();if(id){openPostRoute(id);let tries=0;const timer=setInterval(()=>{const post=$(`[data-post-id="${CSS.escape(String(id))}"]`,postsList);if(post){clearInterval(timer);openComments(post,{push:false,commentId});}else if(++tries>30)clearInterval(timer);},250);}}
    else if (action === 'notifications-mark-read') {const read=notificationReadIds();notificationItems.forEach(x=>read.add(x.id));try{localStorage.setItem(notificationReadKey(),JSON.stringify([...read]));}catch(_){}renderNotifications();updateNotificationBadge();}
    else if (action === 'profile') { closeSidebar(); showProfile(); }
    else if (action === 'profile-back') setPage('home');
    else if (action === 'profile-photo') {profileImageKind='avatar';$('#profileImageOptionsTitle').textContent='الصورة الشخصية';openModal($('#profileImageOptionsModal'));}
    else if (action === 'profile-cover') {profileImageKind='cover';$('#profileImageOptionsTitle').textContent='صورة الغلاف';openModal($('#profileImageOptionsModal'));}
    else if (action === 'profile-settings') openEditProfile();
    else if (action === 'edit-profile') { closeSidebar(); openEditProfile(); }
    else if (action === 'profile-share') { const viewed=publicProfileData||profileData; const url=location.origin+profilePath(viewed.username); if(navigator.share) navigator.share({title:viewed.name||'EgyBook',text:'تابعني على EgyBook',url}).catch(()=>{}); else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط الملف الشخصي.')).catch(()=>showToast(url));else showToast(url); }
    else if (action === 'profile-section') { const section=button.dataset.section; if(section==='saved'){setPage('saved');showToast('دي المنشورات المحفوظة على الجهاز.');}else if(section==='friends'){openFriendsDirectory({tab:'friends'});}else if(section==='followers'){showToast('قائمة المتابعين تحتاج إلى حسابات متصلة.');}else if(section==='photos'){openAlbums();}else if(section==='videos'){ $('#profilePostsTitle').textContent='فيديوهاتي'; const target=$('#profilePostsList');target.replaceChildren();const own=$$('.post[data-user-post="true"]',postsList).filter(p=>!!$('video.post-image',p));own.forEach(p=>target.append(p.cloneNode(true)));if(!own.length)target.textContent='لسه مفيش فيديوهات منشورة.';}else{ $('#profilePostsTitle').textContent='منشوراتي';renderProfilePosts();} }
    else if (action === 'photo') photoInput.click();
    else if (action === 'video') videoInput.click();
    else if (action === 'location') showToast('مشاركة الموقع غير مفعلة في هذه النسخة.');
    else if (action === 'music') showToast('إضافة الموسيقى غير مفعلة في هذه النسخة.');
    else if (action === 'add-story') showToast('إضافة القصص غير مفعّلة بعد؛ يلزم ربطها بقاعدة بيانات القصص.');
    else if (action === 'all-stories') showToast('لا توجد قصص متاحة للعرض حاليًا.');
    else if (action === 'story') showToast('هذه القصة غير متاحة.');
    else if (action === 'sort') { sortNewestFirst = !sortNewestFirst; const items = $$('.post', postsList); items.sort((a,b) => { const timeA = Number(a.dataset.createdAt) || 0; const timeB = Number(b.dataset.createdAt) || 0; return sortNewestFirst ? timeB - timeA : timeA - timeB; }); items.forEach(item => postsList.append(item)); button.textContent = sortNewestFirst ? 'الأحدث ▾' : 'الأقدم ▾'; }
    else if (action === 'comment') { const post=button.closest('.post'); if(post)openComments(post,{push:true}); }
    else if (action === 'like') { if(longPressTriggered){longPressTriggered=false;return;} const post=button.closest('.post'); if(button.dataset.currentReaction){button.classList.remove('reacted');delete button.dataset.currentReaction;const icon=$('.action-icon',button);if(icon)icon.textContent='👍';$$('span',button)[1].textContent='إعجاب';if(post.dataset.postId){const id=String(post.dataset.postId);delete postState[id]?.reaction;delete postState[id]?.reactionLabel;savePostState();if(supabase&&currentUser){const userId=currentUser.id;supabase.from('post_reactions').delete().eq('post_id',id).eq('user_id',userId).then(async({error})=>{if(error){console.error('Cloud reaction delete failed:',error);showToast('تعذر حذف التفاعل من السحابة: '+error.message);return;}if(currentUser?.id===userId)await loadCloudPostStats(post);});}}showToast('تم إلغاء التفاعل.');}else selectReaction(post,'👍','إعجاب'); }
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
  $('#editProfileForm').addEventListener('submit',async event=>{
    event.preventDefault();const username=$('#editUsername').value.trim().replace(/^@/,'');
    if(!/^[A-Za-z0-9._]{3,30}$/.test(username)){showToast('اسم المستخدم يجب أن يكون 3–30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');return;}
    profileData={...profileData,name:$('#editName').value.trim(),username,bio:$('#editBio').value.trim(),location:$('#editLocation').value.trim(),birthdate:$('#editBirthdate').value,gender:$('#editGender').value,website:$('#editWebsite').value.trim(),phone:$('#editPhone').value.trim(),privacy:$('#editPrivacy').value};
    saveProfile();applyProfile();if(currentPage==='profile'){history.replaceState({page:'profile',username:cleanUsername(profileData.username)},'',profilePath(profileData.username));syncHeaderProfileUsername();}closeModal($('#editProfileModal'));
    if(supabase&&currentUser){
      const {error:publicError}=await supabase.from('profiles').upsert(cloudProfilePayload(),{onConflict:'id'});
      const privateSaved=await persistPrivateProfile();
      if(publicError||!privateSaved)showToast('تم حفظ التغييرات محليًا، لكن تعذرت مزامنة بعض البيانات. شغّل SQL المرفق أولًا.');
      else showToast('تم حفظ بيانات حسابك على السحابة.');
    }else showToast('تم حفظ الملف على هذا الجهاز فقط. سجّل الدخول لمزامنته مع حسابك.');
  });
  $('#profileCoverInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'cover');event.target.value='';});
  $$('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal.open').forEach(closeModal); });
  $('#postForm').addEventListener('submit', publishPost);
  $('#profilePhotoInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'avatar');event.target.value='';});
  photoInput.addEventListener('change', () => { readMedia(photoInput.files[0], 'image'); photoInput.value = ''; openModal(createPostModal); });
  videoInput.addEventListener('change', () => { readMedia(videoInput.files[0], 'video'); videoInput.value = ''; openModal(createPostModal); });
  $('#searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });


  // Profile-only pull-to-refresh: prevent native browser pull-to-refresh and
  // refresh profile data in-app only when the user pulls down from the top.
  (() => {
    if (window.__egybookProfilePullRefreshInstalled) return;
    window.__egybookProfilePullRefreshInstalled = true;

    let startY = 0, startX = 0, pulling = false, refreshing = false, indicator = null;
    const threshold = 78;

    function getIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.id = 'profilePullRefreshIndicator';
      indicator.className = 'profile-pull-refresh-indicator';
      indicator.setAttribute('aria-live', 'polite');
      indicator.innerHTML = '<span class="profile-pull-refresh-avatar" aria-hidden="true"><span class="profile-pull-refresh-ring"></span><span class="profile-pull-refresh-user">♙</span></span><span class="profile-pull-refresh-label">اسحب لتحديث الملف الشخصي</span>';
      document.body.appendChild(indicator);
      return indicator;
    }

    function isProfilePage() {
      const profilePage = document.querySelector('#profilePage');
      return typeof currentPage !== 'undefined' && currentPage === 'profile' &&
        !!profilePage && !profilePage.hidden &&
        (getComputedStyle(profilePage).display !== 'none') &&
        (getComputedStyle(profilePage).visibility !== 'hidden') &&
        !document.querySelector('#homePage:not([hidden])');
    }

    function atTop() {
      return window.scrollY <= 1 || document.documentElement.scrollTop <= 1;
    }

    function resetIndicator() {
      if (!indicator) return;
      indicator.classList.remove('is-pulling', 'is-refreshing', 'is-success', 'is-error');
      indicator.style.setProperty('--pull-progress', '0');
      indicator.style.setProperty('--pull-offset', '-74px');
      indicator.querySelector('.profile-pull-refresh-label').textContent = 'اسحب لتحديث الملف الشخصي';
    }

    document.addEventListener('touchstart', event => {
      if(document.body.classList.contains('sidebar-open')){pulling=false;return;}
      const homeIndicator = document.getElementById('homePullRefreshIndicator');
      if (homeIndicator) homeIndicator.classList.remove('is-pulling', 'is-refreshing', 'is-success', 'is-error');
      if (event.touches.length !== 1 || refreshing || !isProfilePage() || !atTop()) {
        pulling = false;
        return;
      }
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      pulling = true;
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', event => {
      if (!pulling || refreshing || event.touches.length !== 1 || !isProfilePage() || !atTop()) return;
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) * 0.8) return;
      if (event.cancelable) event.preventDefault(); // stop native browser pull-to-refresh
      const node = getIndicator();
      const distance = Math.min(dy, 115);
      node.style.setProperty('--pull-progress', String(Math.min(1, distance / threshold)));
      node.style.setProperty('--pull-offset', `${Math.max(-74, -74 + distance * 0.72)}px`);
      node.classList.add('is-pulling');
      node.querySelector('.profile-pull-refresh-label').textContent = dy >= threshold ? 'اترك لتحديث الملف الشخصي' : 'اسحب لتحديث الملف الشخصي';
    }, { passive: false, capture: true });

    document.addEventListener('touchend', async event => {
      if (!pulling) return;
      pulling = false;
      if (refreshing || !event.changedTouches.length || !isProfilePage() || !atTop()) {
        resetIndicator();
        return;
      }
      const dy = event.changedTouches[0].clientY - startY;
      if (dy < threshold) {
        resetIndicator();
        return;
      }

      refreshing = true;
      const node = getIndicator();
      node.classList.remove('is-pulling');
      node.classList.add('is-refreshing');
      node.style.setProperty('--pull-offset', '12px');
      node.querySelector('.profile-pull-refresh-label').textContent = 'جاري تحديث الملف الشخصي';

      try {
        // Refresh data without reloading the browser document.
        if (typeof currentUser !== 'undefined' && currentUser &&
            typeof restoreCloudProfile === 'function') {
          await restoreCloudProfile();
          if (typeof restorePosts === 'function') await restorePosts();
        } else if (typeof applyProfile === 'function') {
          await Promise.resolve(applyProfile());
        }
        // Keep the current route and active navigation item unchanged during in-app refresh.


        node.classList.remove('is-refreshing');
        node.classList.add('is-success');
        node.querySelector('.profile-pull-refresh-label').textContent = 'تم التحديث';
      } catch (error) {
        console.warn('Profile pull-to-refresh failed:', error);
        node.classList.remove('is-refreshing');
        node.classList.add('is-error');
        node.querySelector('.profile-pull-refresh-label').textContent = 'تعذر التحديث';
      }

      setTimeout(() => {
        refreshing = false;
        resetIndicator();
      }, 650);
    }, { passive: true, capture: true });

    document.addEventListener('touchcancel', () => {
      pulling = false;
      if (!refreshing) resetIndicator();
    }, { passive: true, capture: true });

    // Keep browser-native overscroll refresh disabled while the app is open.
    document.documentElement.style.overscrollBehaviorY = 'contain';
    document.body.style.overscrollBehaviorY = 'contain';
  })();


  // Home page pull-to-refresh, isolated from the profile handler and route bootstrap.
  (() => {
    if (window.__egybookHomePullRefreshInstalled) return;
    window.__egybookHomePullRefreshInstalled = true;
    let startY = 0, startX = 0, pulling = false, refreshing = false, indicator = null;
    const threshold = 78;

    function isHomePage() {
      // The actual home feed container in index.html is id="home", not "homePage".
      const home = document.querySelector('#home');
      if (!home || home.hidden) return false;
      const style = getComputedStyle(home);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (typeof currentPage !== 'undefined' && currentPage !== 'home') return false;
      const profile = document.querySelector('#profilePage');
      if (profile && !profile.hidden && getComputedStyle(profile).display !== 'none') return false;
      return true;
    }
    function atTop() {
      return window.scrollY <= 1 || document.documentElement.scrollTop <= 1;
    }
    function getIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.id = 'homePullRefreshIndicator';
      indicator.className = 'profile-pull-refresh-indicator home-pull-refresh-indicator';
      indicator.setAttribute('aria-live', 'polite');
      indicator.innerHTML = '<span class="profile-pull-refresh-avatar home-pull-refresh-avatar" aria-hidden="true"><span class="profile-pull-refresh-ring"></span><span class="home-pull-refresh-icon" aria-hidden="true">⌂</span></span><span class="profile-pull-refresh-label">اسحب لتحديث الصفحة الرئيسية</span>';
      document.body.appendChild(indicator);
      return indicator;
    }
    function resetIndicator() {
      if (!indicator) return;
      indicator.classList.remove('is-pulling', 'is-refreshing', 'is-success', 'is-error');
      indicator.style.setProperty('--pull-progress', '0');
      indicator.style.setProperty('--pull-offset', '-74px');
      indicator.querySelector('.profile-pull-refresh-label').textContent = 'اسحب لتحديث الصفحة الرئيسية';
    }
    document.addEventListener('touchstart', event => {
      if(document.body.classList.contains('sidebar-open')){pulling=false;return;}
      const profileIndicator = document.getElementById('profilePullRefreshIndicator');
      if (profileIndicator) profileIndicator.classList.remove('is-pulling', 'is-refreshing', 'is-success', 'is-error');
      if (event.touches.length !== 1 || refreshing || !isHomePage() || !atTop()) {
        pulling = false; return;
      }
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      pulling = true;
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', event => {
      if (!pulling || refreshing || event.touches.length !== 1 || !isHomePage() || !atTop()) return;
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) * 0.8) return;
      if (event.cancelable) event.preventDefault();
      const node = getIndicator();
      const distance = Math.min(dy, 115);
      node.style.setProperty('--pull-progress', String(Math.min(1, distance / threshold)));
      node.style.setProperty('--pull-offset', `${Math.max(-74, -74 + distance * 0.72)}px`);
      node.classList.add('is-pulling');
      node.querySelector('.profile-pull-refresh-label').textContent =
        dy >= threshold ? 'اترك لتحديث الصفحة الرئيسية' : 'اسحب لتحديث الصفحة الرئيسية';
    }, { passive: false, capture: true });

    document.addEventListener('touchend', async event => {
      if (!pulling) return;
      pulling = false;
      if (refreshing || !event.changedTouches.length || !isHomePage() || !atTop()) {
        resetIndicator(); return;
      }
      if (event.changedTouches[0].clientY - startY < threshold) {
        resetIndicator(); return;
      }
      refreshing = true;
      const node = getIndicator();
      node.classList.remove('is-pulling');
      node.classList.add('is-refreshing');
      node.style.setProperty('--pull-offset', '12px');
      node.querySelector('.profile-pull-refresh-label').textContent = 'جاري تحديث الصفحة الرئيسية';
      try {
        // Refresh only the home feed data. Keep the current route and scroll context;
        // restorePosts() already re-renders the cloud posts list.
        if (typeof currentUser !== 'undefined' && currentUser &&
            typeof restorePosts === 'function') {
          await restorePosts();
        }
        document.dispatchEvent(new CustomEvent('egybook:refresh-home', {
          detail: { source: 'pull-to-refresh', timestamp: Date.now() }
        }));
        node.classList.remove('is-refreshing');
        node.classList.add('is-success');
        node.querySelector('.profile-pull-refresh-label').textContent = 'تم التحديث';
      } catch (error) {
        console.warn('Home pull-to-refresh failed:', error);
        node.classList.remove('is-refreshing');
        node.classList.add('is-error');
        node.querySelector('.profile-pull-refresh-label').textContent = 'تعذر تحديث الصفحة الرئيسية';
      }
      setTimeout(() => { refreshing = false; resetIndicator(); }, 650);
    }, { passive: true, capture: true });

    document.addEventListener('touchcancel', () => {
      pulling = false;
      if (!refreshing) resetIndicator();
    }, { passive: true, capture: true });
  })();

  // Global in-app swipe navigation. Horizontal swipes are handled before
  // the browser can interpret them as a page/edge gesture where supported.
  let gestureStartX = 0, gestureStartY = 0, gestureStartTime = 0;
  let gestureTracking = false, gestureHorizontal = false;
  const gestureIgnore = 'input, textarea, select, [contenteditable="true"], video, audio, .modal.open';
  const gestureSurface = () => document.querySelector('#profilePage:not([hidden])') || document.querySelector('.container:not([hidden])') || document.body;

  document.addEventListener('touchstart', event => {
    if(document.body.classList.contains('sidebar-open')){gestureTracking=false;gestureHorizontal=false;return;}
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


  $('#commentMyAvatar').addEventListener('click',()=>routeToProfile(profileData.username,{push:true}));
  $('#commentForm').addEventListener('submit',async e=>{
    e.preventDefault();const text=$('#commentInput').value.trim();if(!text||!activeCommentsPost)return;
    const post=activeCommentsPost,postId=String(post.dataset.postId||'');
    const c={id:'c-'+Date.now(),name:getActiveProfileName(),username:profileData.username||currentUser?.user_metadata?.username||'',userId:currentUser?.id||'',avatar:profileData.avatar||'',time:'الآن',text,likes:0,dislikes:0,replies:[]};
    if(supabase && currentUser && postId){
      const payload={post_id:postId,user_id:currentUser.id,user_name:getActiveProfileName(),body:text};
      if(replyToComment)payload.parent_id=String(replyToComment);
      const {error}=await supabase.from('post_comments').insert(payload);
      if(error){showToast('تعذر حفظ '+(replyToComment?'الرد':'التعليق')+' في السحابة: '+error.message);return;}
      $('#commentInput').value='';replyToComment=null;$('#commentInput').placeholder=`تعليق باسم ${getActiveProfileName()} ...`;
      await loadCloudComments(post);await loadCloudPostStats(post);showToast('تم حفظ '+(payload.parent_id?'الرد':'التعليق')+' بنجاح.');return;
    }
    const arr=getCommentsFor(post);
    if(replyToComment){const parent=findCommentById(arr,replyToComment);if(parent){parent.replies=parent.replies||[];parent.replies.push({...c,id:'r-'+Date.now()});}replyToComment=null;$('#commentInput').placeholder=`تعليق باسم ${getActiveProfileName()} ...`;}
    else arr.push(c);
    saveComments();$('#commentInput').value='';renderComments();syncPostStats(post);
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
    return {id:currentUser.id,username:safeUsername,full_name:profileData.name||'عضو EgyBook',avatar_url:profileData.avatar||null,cover_url:profileData.cover||null,bio:profileData.bio||'',location:profileData.location||'',updated_at:new Date().toISOString()};
  }
  async function restoreCloudProfile(){
    if(!supabase||!currentUser)return;
    const authUser=currentUser;
    const {data,error}=await supabase.from('profiles')
      .select('id,username,full_name,avatar_url,cover_url,bio,location')
      .eq('id',authUser.id).maybeSingle();
    if(error){console.warn('Cloud profile load:',error.message);showToast('تعذر تحميل بيانات الحساب من السحابة.');return;}
    let cloud=data;
    if(!cloud){
      const meta=authUser.user_metadata||{};
      const emailName=(authUser.email||'').split('@')[0].replace(/[^A-Za-z0-9._]/g,'_').slice(0,20);
      const username=cleanUsername(meta.username||`${emailName||'egybook_user'}_${authUser.id.slice(0,5)}`);
      const initial={id:authUser.id,username,full_name:meta.full_name||meta.name||'عضو EgyBook',avatar_url:null,cover_url:null,bio:'',location:'',updated_at:new Date().toISOString()};
      const {data:created,error:createError}=await supabase.from('profiles').upsert(initial,{onConflict:'id'}).select('id,username,full_name,avatar_url,cover_url,bio,location').single();
      if(createError){console.error('Profile bootstrap failed:',createError.message);showToast('تعذر إنشاء ملف الحساب على السحابة: '+createError.message);return;}
      cloud=created;
    }
    if(currentUser?.id!==authUser.id)return;
    let requestedLocationPath = location.pathname || '';
    // During the GitHub Pages 404 handoff the real profile route lives in ?route=.
    const routeHandoff = new URLSearchParams(location.search).get('route') || pendingDeepLinkPath;
    if (routeHandoff) {
      try {
        const handoffURL = new URL(routeHandoff, location.origin);
        if (handoffURL.origin === location.origin && /^\/Egybook(?:\/|$)/i.test(handoffURL.pathname)) {
          requestedLocationPath = handoffURL.pathname;
        }
      } catch (_) {}
    }
    const requestedPath=decodeURIComponent(requestedLocationPath).match(/^\/Egybook\/([^/]+)\/?$/i);
    const requestedUsername=requestedPath?cleanUsername(requestedPath[1]):null;
    const cloudUsername=cleanUsername(cloud.username||'');
    // Always hydrate the signed-in user's profile before routing to another account.
    // An early return here left profileData at the default 'egybook_user' values.
    if(requestedUsername && requestedUsername===cloudUsername){
      publicProfileUsername=cloudUsername;
      publicProfileId=authUser.id;
      publicProfileIsOwn=true;
      publicProfileData={...cloud,id:authUser.id};
    }
    profileData={...profileData,username:cloud.username||profileData.username,name:cloud.full_name||'عضو EgyBook',
      avatar:cloud.avatar_url||'',cover:cloud.cover_url||'',bio:cloud.bio||'',location:cloud.location||''};
    try{
      const {data:privateData,error:privateError}=await supabase.from('profile_private').select('phone,birthdate,gender,website,privacy').eq('user_id',authUser.id).maybeSingle();
      if(privateError)console.warn('Private profile load:',privateError.message);
      if(privateData)profileData={...profileData,...privateData};
    }catch(err){console.warn('Private profile table unavailable:',err);}
    saveProfile();
    if(currentPage!=='profile' || publicProfileIsOwn){applyProfile();}
    if(requestedUsername && requestedUsername!==cloudUsername){
      // Route only after the authenticated user's profile has been restored.
      await loadPublicProfileByUsername(requestedUsername);
      return;
    }
    if(currentPage==='profile' && publicProfileIsOwn){
      publicProfileData={...profileData,id:authUser.id};
      publicProfileId=authUser.id;
      loadProfileFriends(authUser.id);renderProfilePosts();syncHeaderProfileUsername();
    }
  }
  async function persistPrivateProfile(){
    if(!supabase||!currentUser)return false;
    const payload={user_id:currentUser.id,phone:profileData.phone||'',birthdate:profileData.birthdate||null,gender:profileData.gender||'',website:profileData.website||'',privacy:profileData.privacy||'عام',updated_at:new Date().toISOString()};
    const {error}=await supabase.from('profile_private').upsert(payload,{onConflict:'user_id'});
    if(error){console.error('Private profile save failed:',error);return false;}
    return true;
  }
  let authScreen='welcome';
  let authMethod='email';
  let phoneOtpSent=false;
  let phoneSignupMeta=null;
  function showAuthScreen(screen){
    authScreen=screen;
    $('#authWelcome').hidden=screen!=='welcome';
    $('#authFlow').hidden=screen!=='form';
    if(screen==='form')setAuthMode(authMode);
  }
  function setAuthMethod(method){
    authMethod=method;
    const phone=method==='phone';
    $('#authEmailMethod').classList.toggle('active',!phone);
    $('#authPhoneMethod').classList.toggle('active',phone);
    $('#authEmailFields').hidden=phone;
    $('#authPhoneFields').hidden=!phone;
    $('#supabaseAuthEmail').required=!phone;
    $('#supabaseAuthPassword').required=!phone;
    $('#authConfirmPassword').required=!phone && authMode==='signup';
    $('#authOptions').hidden=phone || authMode==='signup';
    $('#authOtpWrap').hidden=!phone || !phoneOtpSent;
    $('#supabaseSignIn').textContent=phone?(phoneOtpSent?'تأكيد كود الهاتف':'إرسال كود التحقق'):(authMode==='signup'?'إنشاء الحساب ➜':'تسجيل الدخول ➜');
    $('#supabaseAuthHint').textContent=phone
      ? (phoneOtpSent?'أدخل كود التحقق الذي وصلك برسالة SMS.':'اكتب رقمك الدولي، مثال: +2010XXXXXXXX. يلزم تفعيل Phone Auth ومزوّد SMS في Supabase.')
      : (authMode==='signup'?'استخدم بريدًا إلكترونيًا صالحًا وكلمة مرور من 8 أحرف على الأقل.':'استخدم بريدًا إلكترونيًا يمكنك الوصول إليه؛ قد يُطلب تأكيده.');
  }
  function setAuthMode(mode){
    authMode=mode;
    const signup=mode==='signup';
    $('#authLoginTab').classList.toggle('active',!signup);$('#authSignupTab').classList.toggle('active',signup);
    $('#authLoginTab').setAttribute('aria-selected',String(!signup));$('#authSignupTab').setAttribute('aria-selected',String(signup));
    $('#authTitle').textContent=signup?'إنشاء حساب جديد':'مرحبًا بعودتك';
    $('#authSubtitle').textContent=signup?'انضم إلى مجتمع EgyBook وابدأ رحلتك الآن':'سجّل دخولك لمتابعة أصدقائك ومشاركة لحظاتك';
    $('#authNameWrap').hidden=!signup;$('#authUsernameWrap').hidden=!signup;
    $('#authConfirmWrap').hidden=!signup || authMethod==='phone';
    $('#authOptions').hidden=signup || authMethod==='phone';
    $('#supabaseAuthPassword').autocomplete=signup?'new-password':'current-password';
    $('#supabaseSignIn').textContent=authMethod==='phone'?(phoneOtpSent?'تأكيد كود الهاتف':'إرسال كود التحقق'):(signup?'إنشاء الحساب ➜':'تسجيل الدخول ➜');
    setAuthMethod(authMethod);
  }
  function updateAuthGate(){
    const modal=$('#supabaseAuthModal');
    document.body.classList.toggle('auth-required', !currentUser);
    if(!currentUser){
      if(modal){ modal.hidden=false; modal.classList.add('open'); }
      document.body.style.overflow='hidden';
      if(authScreen==='form')setAuthMode(authMode);
      else showAuthScreen('welcome');
    } else {
      if(modal){ modal.classList.remove('open'); modal.hidden=true; }
      document.body.style.overflow='';
    }
  }
  function refreshAuthUI(){
    // The topbar account chip was removed permanently; keep auth state in the modal only.
    const b=$('#authEntry');if(b)b.hidden=true;
    $('#supabaseSignOut').hidden=!currentUser;
    $('#authLoginTab').hidden=!!currentUser;$('#authSignupTab').hidden=!!currentUser;
    $('#supabaseAuthEmail').disabled=!!currentUser;$('#supabaseAuthPassword').disabled=!!currentUser;
    $('#authNameWrap').hidden=!!currentUser||authMode!=='signup';$('#authUsernameWrap').hidden=!!currentUser||authMode!=='signup';$('#authConfirmWrap').hidden=!!currentUser||authMode!=='signup';$('#authOptions').hidden=!!currentUser||authMode==='signup';
    $('#supabaseSignIn').hidden=!!currentUser;$('#supabaseAuthHint').textContent=currentUser?'تم تسجيل الدخول. يمكنك تسجيل الخروج من هنا.':(authMode==='signup'?'استخدم بريدًا صالحًا؛ قد يُطلب تأكيده.':'استخدم بريدًا إلكترونيًا يمكنك الوصول إليه؛ قد يُطلب تأكيده.');
    updateAuthGate();
  }
  $('#authWelcomeLogin').addEventListener('click',()=>{showAuthScreen('form');setAuthMode('login');setAuthMethod('email');});
  $('#authWelcomeSignup').addEventListener('click',()=>{showAuthScreen('form');setAuthMode('signup');setAuthMethod('email');});
  $('#authWelcomePhone').addEventListener('click',()=>{showAuthScreen('form');setAuthMode('login');setAuthMethod('phone');});
  $('#authBackWelcome').addEventListener('click',()=>{phoneOtpSent=false;$('#authOtp').value='';showAuthScreen('welcome');});
  $('#authEmailMethod').addEventListener('click',()=>setAuthMethod('email'));
  $('#authPhoneMethod').addEventListener('click',()=>setAuthMethod('phone'));
  $('#authGoogle').addEventListener('click',async()=>{
    if(!supabase)return showToast('تعذر الاتصال بخدمة الحسابات.');
    try{
      const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});
      if(error)throw error;
    }catch(err){showToast('تعذر بدء تسجيل الدخول عبر Google: '+(err.message||'تحقق من إعدادات OAuth في Supabase.'));}
  });
  $('#authResendOtp').addEventListener('click',async()=>{
    const phone=$('#authPhone').value.trim();
    if(!/^\\+[1-9]\\d{7,14}$/.test(phone))return showToast('اكتب رقم الهاتف بالصيغة الدولية، مثل +2010XXXXXXXX.');
    try{
      const {error}=await supabase.auth.signInWithOtp({phone,options:{shouldCreateUser:authMode==='signup',data:phoneSignupMeta||{}}});
      if(error)throw error;
      showToast('تم طلب إعادة إرسال كود التحقق.');
    }catch(err){showToast('تعذر إرسال الكود: '+err.message);}
  });
    $('#authLoginTab').addEventListener('click',()=>{phoneOtpSent=false;setAuthMode('login');});
  $('#authSignupTab').addEventListener('click',()=>{phoneOtpSent=false;setAuthMode('signup');});
  $('#supabaseAuthForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabase)return showToast('تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مرة أخرى.');
    const b=$('#supabaseSignIn');
    b.disabled=true;
    try{
      if(authMethod==='phone'){
        const phone=$('#authPhone').value.trim();
        if(!/^\\+[1-9]\\d{7,14}$/.test(phone))throw new Error('اكتب رقم الهاتف بالصيغة الدولية، مثل +2010XXXXXXXX.');
        if(authMode==='signup'){
          const fullName=$('#authFullName').value.trim(),username=$('#authUsername').value.trim();
          if(fullName.length<2)throw new Error('اكتب اسمك الكامل.');
          if(!/^[A-Za-z0-9._]{3,30}$/.test(username))throw new Error('اسم المستخدم من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');
          phoneSignupMeta={full_name:fullName,username};
        }
        if(!phoneOtpSent){
          const {error}=await supabase.auth.signInWithOtp({phone,options:{shouldCreateUser:authMode==='signup',data:phoneSignupMeta||{}}});
          if(error)throw error;
          phoneOtpSent=true;
          $('#authOtpWrap').hidden=false;$('#authResendOtp').hidden=false;
          $('#supabaseSignIn').textContent='تأكيد كود الهاتف';
          $('#supabaseAuthHint').textContent='تم طلب كود التحقق. إذا لم يصلك، تأكد من إعداد مزوّد SMS في Supabase.';
          showToast('تم طلب إرسال كود التحقق إلى هاتفك.');
          return;
        }
        const token=$('#authOtp').value.trim();
        if(!/^\\d{4,8}$/.test(token))throw new Error('اكتب كود التحقق الذي وصلك.');
        const {data,error}=await supabase.auth.verifyOtp({phone,token,type:'sms'});
        if(error)throw error;
        if(!data.user)throw new Error('لم يتم تأكيد الحساب. حاول مرة أخرى.');
        currentUser=data.user;
        const meta=data.user.user_metadata||phoneSignupMeta||{};
        activateAccountStorage(currentUser.id,{name:meta.full_name||'عضو EgyBook',username:meta.username||''});
        if(authMode==='signup'){
          const username=cleanUsername(meta.username||`user_${currentUser.id.slice(0,8)}`);
          const fullName=meta.full_name||'عضو EgyBook';
          const {error:profileError}=await supabase.from('profiles').upsert({id:currentUser.id,username,full_name:fullName,bio:'',location:'',avatar_url:null,cover_url:null,updated_at:new Date().toISOString()},{onConflict:'id'});
          if(profileError)throw profileError;
        }
        phoneOtpSent=false;phoneSignupMeta=null;
        await restoreCloudProfile();refreshAuthUI();closeModal($('#supabaseAuthModal'));await restorePosts();
        showToast(authMode==='signup'?'تم إنشاء حسابك برقم الهاتف بنجاح.':'تم تسجيل الدخول برقم الهاتف.');
        return;
      }
      const email=$('#supabaseAuthEmail').value.trim(),password=$('#supabaseAuthPassword').value;
      if(authMode==='signup'){
        const fullName=$('#authFullName').value.trim(),username=$('#authUsername').value.trim();
        if(fullName.length<2)throw new Error('اكتب اسمك الكامل.');
        if(!/^[A-Za-z0-9._]{3,30}$/.test(username))throw new Error('اسم المستخدم من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');
        if(password!==$('#authConfirmPassword').value)throw new Error('كلمتا المرور غير متطابقتين.');
        profileData={...defaultProfile(),name:fullName,username};
        const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,username}}});
        if(error)throw error;
        if(data.session&&data.user){
          currentUser=data.user;activateAccountStorage(currentUser.id,{name:fullName,username});
          const {error:profileError}=await supabase.from('profiles').upsert({id:currentUser.id,username,full_name:fullName,bio:'',location:'',avatar_url:null,cover_url:null,updated_at:new Date().toISOString()},{onConflict:'id'});
          if(profileError)throw profileError;
          await restoreCloudProfile();refreshAuthUI();closeModal($('#supabaseAuthModal'));await restorePosts();showToast('تم إنشاء الحساب بنجاح.');
        } else {
          profileData=defaultProfile();activateAccountStorage(null);
          setAuthMode('login');showAuthScreen('form');updateAuthGate();showToast('تم إرسال طلب إنشاء الحساب. افتح بريدك الإلكتروني لتأكيده ثم سجّل الدخول.');
        }
        return;
      }
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;
      currentUser=data.user;activateAccountStorage(currentUser.id);
      refreshAuthUI();await refreshVerificationBadge();await restoreCloudProfile();closeModal($('#supabaseAuthModal'));await restorePosts();
      showToast('تم تسجيل الدخول إلى حسابك في EgyBook.');
    }catch(err){showToast('تعذر إكمال العملية: '+(err.message||'تحقق من البيانات والإعدادات.'));}
    finally{b.disabled=false;}
  });
  $('#authForgot').addEventListener('click',async()=>{if(authMethod!=='email')return showToast('استعادة كلمة المرور متاحة عبر البريد الإلكتروني.');if(!supabase)return showToast('تعذر الاتصال بخدمة الحسابات.');const email=$('#supabaseAuthEmail').value.trim();if(!email)return showToast('اكتب بريدك الإلكتروني أولًا.');try{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;showToast('لو البريد مسجل، هيوصلك رابط استعادة كلمة المرور.');}catch(err){showToast('تعذر إرسال رابط الاستعادة: '+err.message);}});
  $('#supabaseSignOut').addEventListener('click',async()=>{try{const {error}=await supabase.auth.signOut();if(error)throw error;currentUser=null;activateAccountStorage(null);refreshAuthUI();setAuthMode('login');closeModal($('#supabaseAuthModal'));postsList.querySelectorAll('.post[data-cloud-post="true"],.post[data-user-post="true"]').forEach(p=>p.remove());applyProfile();renderProfilePosts();showToast('تم تسجيل الخروج.');}catch(err){showToast('تعذر تسجيل الخروج: '+err.message);}});
  let socialRealtimeChannel=null;
  function startSocialRealtime(){
    if(!supabase)return;
    if(socialRealtimeChannel){supabase.removeChannel(socialRealtimeChannel);socialRealtimeChannel=null;}
    socialRealtimeChannel=supabase.channel('egybook-social-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'posts'},payload=>{
        const row=payload.new||payload.old||{};
        if(payload.eventType==='DELETE'){
          const id=String(row.id||'');
          $$('.post').filter(p=>String(p.dataset.postId||'')===id).forEach(p=>p.remove());
          if(currentPage==='profile')renderProfilePosts();
          updateEmptyState();return;
        }
        restorePosts();
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'friend_requests'},payload=>{
        if(currentUser)loadNotifications();
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'post_reactions'},payload=>{
        if(currentUser)loadNotifications();
        const row=payload.new||payload.old||{},id=String(row.post_id||'');
        const post=$$('.post').find(p=>String(p.dataset.postId||'')===id);
        if(post)loadCloudPostStats(post);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'post_comments'},payload=>{
        if(currentUser)loadNotifications();
        const row=payload.new||payload.old||{},id=String(row.post_id||'');
        const post=$$('.post').find(p=>String(p.dataset.postId||'')===id);
        if(post){loadCloudPostStats(post);if(activeCommentsPost&&String(activeCommentsPost.dataset.postId||'')===id)loadCloudComments(activeCommentsPost);}
      })
      .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('EgyBook realtime subscription status:',status);});
  }
  async function initializeCloud(){
    if(!supabase){activateAccountStorage(null);refreshAuthUI();document.documentElement.classList.remove('egybook-profile-bootstrap');routeFromLocation();showToast('تعذر الاتصال بالخدمة. حاول مرة أخرى.');return;}
    try{
      const {data,error}=await supabase.auth.getSession();if(error)throw error;
      currentUser=data.session?.user||null;
      activateAccountStorage(currentUser?.id||null);
      refreshAuthUI();await refreshVerificationBadge();
      startSocialRealtime();
      if(currentUser){await restoreCloudProfile();await restorePosts();} else applyProfile();
      routeFromLocation();
      document.documentElement.classList.remove('egybook-profile-bootstrap');
      let lastUserId=currentUser?.id||null;
      supabase.auth.onAuthStateChange((_event,session)=>{
        const nextUser=session?.user||null, nextId=nextUser?.id||null;
        currentUser=nextUser;refreshAuthUI();refreshVerificationBadge();
        if(nextId!==lastUserId){document.documentElement.classList.add('egybook-profile-bootstrap');
          lastUserId=nextId;
          activeCommentsPost=null;replyToComment=null;commentData={};
          activateAccountStorage(nextId);
          postsList.querySelectorAll('.post[data-cloud-post="true"],.post[data-user-post="true"]').forEach(p=>p.remove());
          applyProfile();renderProfilePosts();
          startSocialRealtime();
        }
        if(currentUser)setTimeout(async()=>{try{await restoreCloudProfile();await restorePosts();}finally{document.documentElement.classList.remove('egybook-profile-bootstrap');}},0);
        else {postsList.querySelectorAll('.post[data-cloud-post="true"]').forEach(p=>p.remove());document.documentElement.classList.remove('egybook-profile-bootstrap');}
      });
    }catch(err){document.documentElement.classList.remove('egybook-profile-bootstrap');console.error(err);activateAccountStorage(null);refreshAuthUI();routeFromLocation();showToast('تعذر استعادة جلسة الحساب أو بياناته: '+err.message);}
  }
  window.addEventListener('keydown',event=>{
    if(event.key!=='Escape') {
      if(!$('#imageViewer').hidden && event.key==='ArrowLeft'){stepImage(1);return;}
      if(!$('#imageViewer').hidden && event.key==='ArrowRight'){stepImage(-1);return;}
      return;
    }
    if(!$('#imageViewer').hidden){closeImageViewer();return;}
    const comments=$('#commentsModal');
    if(comments && !comments.hidden && comments.classList.contains('open')){closeModal(comments);return;}
    const reactions=$('#postReactionsModal');
    if(reactions && !reactions.hidden && reactions.classList.contains('open')){closeModal(reactions);return;}
    const openModalEl=$('.modal.open');
    if(openModalEl && openModalEl.id!=='supabaseAuthModal'){closeModal(openModalEl);}
  });
  window.addEventListener('popstate',()=>{
    if(window.__egybookIgnoreSidebarPop){window.__egybookIgnoreSidebarPop=false;return;}
    if($('#egySidebar')?.classList.contains('is-open')){window.__egybookHandlingSidebarPop=true;closeSidebar();window.__egybookHandlingSidebarPop=false;return;}
    if(!$('#imageViewer').hidden){$('#imageViewer').hidden=true;document.body.classList.remove('image-viewer-open');imageViewerHistoryPushed=false;window.scrollTo({top:imageViewerReturnY,behavior:'instant'});return;}
    // Back navigation first dismisses transient overlays so they never remain
    // layered over a different route.
    const comments=$('#commentsModal');
    if(comments && !comments.hidden && comments.classList.contains('open')) closeModal(comments);
    const reactions=$('#postReactionsModal');
    if(reactions && !reactions.hidden && reactions.classList.contains('open')) closeModal(reactions);
    routeFromLocation();
  });
  document.addEventListener('click',event=>{const tab=event.target.closest('[data-notification-tab]');if(tab){notificationTab=tab.dataset.notificationTab||'all';$$('[data-notification-tab]').forEach(b=>{const active=b===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});renderNotifications();}});
  // Reusable route-entry animation: applies to current and future route roots.
  // New page roots should carry data-route-page and use hidden to switch routes.
  function animateRouteSurface(surface){
    if(!surface || !surface.matches('[data-route-page], #friendsDirectoryPage, #postViewer'))return;
    surface.classList.remove('egybook-route-enter');
    // Restart only the short compositor-friendly animation; do not rebuild page content.
    void surface.offsetWidth;
    surface.classList.add('egybook-route-enter');
  }
  const routeSurfaceObserver = new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes' && record.attributeName==='hidden'){
        const surface=record.target;
        if(surface.matches('[data-route-page], #friendsDirectoryPage, #postViewer') && !surface.hidden){
          animateRouteSurface(surface);
        }
      }else if(record.type==='childList'){
        record.addedNodes.forEach(node=>{
          if(node.nodeType===1 && node.matches?.('[data-route-page]:not([hidden])')) animateRouteSurface(node);
          node.querySelectorAll?.('[data-route-page]:not([hidden])').forEach(animateRouteSurface);
        });
      }
    }
  });
  routeSurfaceObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
  // Make route animation helper available to route handlers defined above.
  window.__egybookAnimateRouteSurface = animateRouteSurface;
  applyProfile(); syncAllPostStats(); updateEmptyState(); refreshAuthUI();
  // Resolve the requested URL before awaiting Supabase. This prevents the app's
  // default Home state from being rendered first when a profile URL is refreshed.
  // initializeCloud() will resolve it again after auth/profile data is restored.
  try { routeFromLocation(); } catch (routeError) { console.warn('Early route resolution failed:', routeError); }
  initializeCloud();
})();
