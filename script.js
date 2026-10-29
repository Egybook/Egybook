
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
  // Shared notification state must be declared inside this strict-mode app scope.
  let notificationItems = [];
  let notificationTab = 'all';
  let notificationRealtimePrimed = false;

  const postsList = $('#postsList');
  // Incremental feed paging: keep the existing first batch intact and append older posts.
  const FEED_PAGE_SIZE = 30;
  let feedNextOffset = 100;
  let feedHasMore = true;
  let feedPaging = false;
  let feedSentinel = null;
  const createPostModal = $('#createPostModal');
  const postContent = $('#postContent');
  const toast = $('#toast');
  const photoInput = $('#photoInput');
  const videoInput = $('#videoInput');
  let toastTimer;
  let selectedMedia = null;
  let selectedMediaItems = [];
  let imageEditorRotation = 0;
  let imageEditorFilter = "none";
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
  let selectedAudience = 'عام';
  let selectedAudienceIds = [];
  let excludedAudienceIds = [];
  let customAudienceListId = null;
  let audienceFriendsCache = [];
  let audienceReturnToComposer = false;
  let isPublishingPost = false;
  let composerPostMeta = { feeling:'', activity:'', location_name:'', tagged_user_ids:[], music_title:'', music_artist:'', music_track_id:'', music_permalink:'', music_artwork_url:'', music_start_seconds:0, music_duration_seconds:110 };
  let composerFeatureMode = 'feeling';
  let audiusMusicView = 'list';
  let audiusTrimCanRemove = false;
  let audiusTrimReturnQuery = '';
  let audiusMusicOriginalMeta = null;
  let audiusMusicConfirmed = false;
  let editingPrivacyPost = null;

  const AUDIENCE_META = {
    'عام': {label:'العامة', description:'الأصدقاء والمتابعون', icon:'🌐'},
    'الأصدقاء': {label:'الأصدقاء', description:'الأصدقاء المقبولون فقط', icon:'♧'},
    'الأصدقاء المقربون': {label:'الأصدقاء المقربون', description:'قائمة الأصدقاء المقربين', icon:'☆'},
    'استثناء': {label:'عدم العرض على…', description:'باستثناء أشخاص تحددهم', icon:'⊖'},
    'أشخاص محددون': {label:'عرض فقط على…', description:'أشخاص تختارهم فقط', icon:'♙'},
    'أنا فقط': {label:'أنا فقط', description:'خاص بك وحدك', icon:'🔒'},
    'قائمة مخصصة': {label:'قائمة بلا تسمية', description:'قائمة مخصصة', icon:'☷'},
    'الجميع': {label:'العامة', description:'الأصدقاء والمتابعون', icon:'🌐'}
  };


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
  function syncPinnedBadge(post){if(!post)return;let badge=$('.post-pinned-badge',post);const pinned=!!postState[String(post.dataset.postId)]?.pinned;if(pinned&&!badge){badge=document.createElement('span');badge.className='post-pinned-badge';badge.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6ZM12 14v7"/></svg><span>منشور مثبت</span>`;const header=$('.post-header',post);if(header)header.append(badge);}else if(!pinned&&badge)badge.remove();post.classList.toggle('post-pinned',pinned);}
  function restorePostState(post){ const state=postState[post.dataset.postId]; if(!state){syncPinnedBadge(post);return;} if(state.saved){const b=$('[data-action="save"]',post);if(b){b.classList.add('saved');const label=$('span:last-child',b);if(label)label.textContent='تم الحفظ';}} if(state.reaction){const b=$('[data-action="like"]',post);if(b){b.classList.add('reacted');b.dataset.currentReaction=state.reaction;b.dataset.currentReactionLabel=state.reactionLabel||'تفاعل';const icon=$('.action-icon',b);if(icon)icon.textContent=state.reaction;const label=$$('span',b)[1];if(label)label.textContent=state.reactionLabel||'تفاعل';const icons=$('.reaction-icons',post);if(icons)icons.innerHTML=`<span>${state.reaction}</span>`;}} if(state.pinned)post.classList.add('post-pinned'); syncPinnedBadge(post); if(state.archived)post.hidden=true; if(state.trashed)post.hidden=true; }
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
  function profileFieldVisible(profile,key,isOwn){
    if(isOwn)return true;
    const privacy=(profile?.[key+'_privacy']||'public').toLowerCase();
    // Friends-only values remain hidden unless friendship is positively established.
    if(privacy==='private'||privacy==='أنا فقط')return false;
    if(privacy==='friends'||privacy==='الأصدقاء')return false;
    return true;
  }
  function renderProfileAbout(profile,isOwn){
    const details=$('#profileDetails'),card=$('#profileAboutCard'),content=$('#profileAboutContent');
    if(!details||!card||!content)return;
    const fields=[
      ['location','المدينة',profile?.location,'<path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2"/>'],
      ['birthdate','تاريخ الميلاد',profile?.birthdate,'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'],
      ['relationship','الحالة الاجتماعية',({single:'أعزب',married:'متزوج',engaged:'مخطوب',relationship:'مرتبط'})[profile?.relationship]||profile?.relationship,'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>'],
      ['work','العمل',profile?.work,'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>'],
      ['education','التعليم',profile?.education,'<path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c4 3 8 3 12 0v-5M22 9v6"/>']
    ];
    details.innerHTML='';
    const visible=[];
    fields.forEach(([key,label,value,path])=>{
      if(!value||!profileFieldVisible(profile,key,isOwn))return;
      let shown=String(value);
      if(key==='birthdate'){
        const mode=profile.birthdate_display||'full';
        if(mode==='hidden'&&!isOwn)return;
        if(mode==='day_month'){const d=new Date(`${shown}T12:00:00`);if(!Number.isNaN(d.getTime()))shown=d.toLocaleDateString('ar-EG',{day:'numeric',month:'long'});}
        else {const d=new Date(`${shown}T12:00:00`);if(!Number.isNaN(d.getTime()))shown=d.toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});}
      }
      visible.push({key,label,shown,path});
    });
    const more=visible.filter(x=>x.key!=='location');
    card.hidden=!more.length;
    content.innerHTML='';
    more.forEach(item=>{const row=document.createElement('div');row.className='profile-about-row';row.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${item.path}</svg><span class="profile-about-label"></span><span class="profile-about-value"></span>`;row.querySelector('.profile-about-label').textContent=item.label;row.querySelector('.profile-about-value').textContent=item.shown;content.append(row);});
  }
  function renderProfileMood(mood){
    const bio=document.querySelector('.profile-bio');if(!bio)return;
    let node=document.getElementById('profileMoodStatus');
    if(!node){node=document.createElement('p');node.id='profileMoodStatus';node.className='profile-mood-status';node.setAttribute('aria-live','polite');bio.insertAdjacentElement('afterend',node);}
    const value=String(mood||'').trim();
    if(value){node.textContent=value;node.hidden=false;node.classList.remove('mood-status-enter');void node.offsetWidth;node.classList.add('mood-status-enter');}
    else{node.hidden=true;node.textContent='';node.classList.remove('mood-status-enter');}
  }
  function renderProfileMeta(profile,isOwn){
    const details=$('#profileDetails'),bio=$('.profile-bio');
    if(!details||!bio)return;
    details.replaceChildren();
    details.classList.add('profile-meta-row');
    const addChip=(kind,label,value,icon)=>{
      const text=String(value||'').trim();if(!text)return;
      const chip=document.createElement('span');chip.className='profile-meta-chip profile-meta-'+kind;
      chip.innerHTML=icon+'<span></span>';chip.lastElementChild.textContent=text;
      chip.setAttribute('aria-label',label+': '+text);details.append(chip);
    };
    const mood=String(profile?.mood||'').trim();
    const location=String(profile?.location||'').trim();
    const work=String(profile?.work||'').trim();
    if(location&&profileFieldVisible(profile,'location',!!isOwn))addChip('location','المحافظة',location,'<span class="profile-meta-emoji" aria-hidden="true">📍</span>');
    if(mood)addChip('mood','الحالة المزاجية',mood,'<span class="profile-meta-emoji" aria-hidden="true">💙</span>');
    if(work&&profileFieldVisible(profile,'work',!!isOwn)&&work!=='لا أرغب في تحديد مهنتي')addChip('work','المهنة',work,'<span class="profile-meta-emoji" aria-hidden="true">💼</span>');
    details.hidden=!details.children.length;
  }
  function applyProfile(){
    $('#profileNameText').textContent=profileData.name||'حسابي';addBadgeToUserName($('#profileNameText'),currentUser?.id||''); $('.profile-handle').textContent='@'+(profileData.username||'egybook_user');
    let profilePresence=$('#profilePresenceStatus');if(!profilePresence){profilePresence=document.createElement('span');profilePresence.id='profilePresenceStatus';profilePresence.className='profile-friend-status profile-viewed-presence';profilePresence.hidden=true;$('.profile-name-block')?.append(profilePresence);}
    profilePresence.hidden=true;profilePresence.textContent='';
    $('.profile-bio').textContent=profileData.bio||'';
    const sideName=$('#sidebarAccountName'),sideHandle=$('#sidebarAccountHandle');
    if(sideName)sideName.textContent=profileData.name||currentUser?.user_metadata?.full_name||'حسابي';
    if(sideHandle)sideHandle.textContent='@'+(profileData.username||currentUser?.user_metadata?.username||'egybook_user');
    renderProfileAbout(profileData,true);
    renderProfileMeta(profileData,true);
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
    updateRealProfileStats();applyCommentComposerAvatar();applyAvatar($('.profile-avatar'));applyAvatar($('.sidebar-account-avatar'));applyAvatar($('.profile-large-avatar'));$$('.create-post .avatar').forEach(applyAvatar);$$('.post[data-user-post="true"] .post-header .avatar').forEach(applyAvatar);
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
        article.innerHTML=`<header class="post-header"><button class="avatar" type="button" data-action="profile" aria-label="الملف الشخصي"></button><div class="post-author"><div class="author-name"></div><div class="post-meta">الآن · تم تحديث ${key==='avatar'?'الصورة الشخصية':'صورة الغلاف'}</div></div></header><p class="post-text"></p><img class="post-image" alt="${key==='avatar'?'الصورة الشخصية الجديدة':'صورة الغلاف الجديدة'}"><div class="post-stats"><span>0 تفاعل</span><button data-action="comments-open">0 تعليق</button></div><div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon post-reaction-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7.2 10.2 11 4.5c.5-.8 1.7-.5 1.8.5l.2 4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.1a2.4 2.4 0 0 1-2.3 1.7H7.2z"/><path d="M4 10h3.2v9H4z"/></svg></span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon comment-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3.5 2v-5.1A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14h5"/></svg></span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon">↗</span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon">🔖</span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
        $('.author-name',article).textContent=profileData.name||'حسابي';$('.post-text',article).textContent=`قام ${profileData.name||'صاحب الحساب'} بتحديث ${key==='avatar'?'صورته الشخصية':'صورة غلافه'}.`;$('.post-image',article).src=publicUrl;postsList.prepend(article);applyAvatar($('.avatar',article));persistPosts();
      }
      showToast(key==='avatar'?'تم تحديث الصورة الشخصية بنجاح.':'تم تحديث صورة الغلاف بنجاح.');
    }catch(err){showToast('تعذر تحديث الصورة: '+(err.message||'حاول مرة أخرى.'));}
  }
  function openEditProfile(){ $('#editName').value=profileData.name||'';$('#editUsername').value=profileData.username||'';$('#editBio').value=profileData.bio||'';$('#editMood').value=profileData.mood||'';$('#editLocation').value=profileData.location||'';$('#editBirthdate').value=profileData.birthdate||'';$('#editGender').value=profileData.gender||'';$('#editWebsite').value=profileData.website||'';$('#editPhone').value=profileData.phone||'';$('#editPrivacy').value=profileData.privacy||'عام';
    ['LocationPrivacy','BirthdatePrivacy','RelationshipPrivacy','WorkPrivacy','EducationPrivacy'].forEach(k=>{const el=$('#edit'+k);if(el)el.value=profileData[k.charAt(0).toLowerCase()+k.slice(1)]||'public';});
    $('#editBirthdateDisplay').value=profileData.birthdate_display||'full';
    $('#editRelationship').value=profileData.relationship||'';
    const workSelect=$('#editWork');
    if(workSelect&&profileData.work&&!Array.from(workSelect.options).some(option=>option.value===profileData.work)){
      const legacyOption=document.createElement('option');legacyOption.value=profileData.work;legacyOption.textContent=profileData.work;workSelect.add(legacyOption);
    }
    $('#editWork').value=profileData.work||'';
    $('#editEducation').value=profileData.education||'';$('#editActivityPrivacy').value=profileData.activity_privacy||'friends';
    openModal($('#editProfileModal')); }
  const postReactionSvg = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.2 10.2 11 4.5c.5-.8 1.7-.5 1.8.5l.2 4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.1a2.4 2.4 0 0 1-2.3 1.7H7.2z"/><path d="M4 10h3.2v9H4z"/></svg>';
  const pendingPostReactions = new Map();
  // Prevent an older in-flight stats read from overwriting a newer reaction tap.
  const postReactionVersions = new Map();
  const postStatsRequestVersions = new Map();
  const reactionLabels = {'👍':'إعجاب','❤️':'حب','😍':'أعجبني جدًا','😂':'أضحكني','😮':'واو','😢':'حزين','😡':'غاضب'};
  // Short, distinct locally generated reaction cues; only called after a deliberate user gesture.
  function reactionFeedback(emoji, target){
    try { if (navigator.vibrate) navigator.vibrate(emoji==='😡'?[18,22,18]:emoji==='❤️'?[22]:[14]); } catch(_) {}
    target?.classList.remove('reaction-pop'); if(target){void target.offsetWidth;target.classList.add('reaction-pop');setTimeout(()=>target.classList.remove('reaction-pop'),420);}
    try {
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      const ctx=reactionFeedback.ctx||(reactionFeedback.ctx=new AC());if(ctx.state==='suspended')ctx.resume().catch(()=>{});
      const presets={'👍':[620,820,'sine'],'❤️':[520,740,'sine'],'😍':[740,980,'triangle'],'😂':[880,660,'square'],'😮':[440,880,'sine'],'😢':[390,330,'triangle'],'😡':[180,240,'sawtooth']};
      const [f1,f2,type]=presets[emoji]||presets['👍'];const now=ctx.currentTime;
      [f1,f2].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,now+i*.055);g.gain.setValueAtTime(.0001,now+i*.055);g.gain.exponentialRampToValueAtTime(.018,now+i*.055+.012);g.gain.exponentialRampToValueAtTime(.0001,now+i*.055+.105);o.connect(g);g.connect(ctx.destination);o.start(now+i*.055);o.stop(now+i*.055+.12);});
    } catch(_) {}
  }
  function dismissReactionPickers(){const picker=$('#commentReactionPicker');if(picker)picker.hidden=true;}
  async function selectReaction(post,emoji,label){
    if(!post || !emoji)return;
    // Inline long-press picker buttons do not carry data-label; always resolve a safe label.
    label = (typeof label === 'string' && label.trim()) ? label.trim() : (reactionLabels[emoji] || 'تفاعل');
    const button=$('[data-action="like"]',post);
    if(!button)return;
    const id=String(post.dataset.postId||'');
    if(id && pendingPostReactions.has(id)) return;
    const previous={
      state:id?{...(postState[id]||{})}:null,
      reacted:button.classList.contains('reacted'),
      emoji:button.dataset.currentReaction||null,
      label:button.dataset.currentReactionLabel||null,
      icon:$('.action-icon',button)?.innerHTML||'',
      buttonText:$$('span',button)[1]?.textContent||'إعجاب',
      icons:$('.reaction-icons',post)?.innerHTML||''
    };
    if(id){postReactionVersions.set(id,(postReactionVersions.get(id)||0)+1);pendingPostReactions.set(id,true);}
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.classList.add('reacted');
    reactionFeedback(emoji, button);
    button.dataset.currentReaction=emoji;
    button.dataset.currentReactionLabel=label;
    const icon=$('.action-icon',button);
    if(icon) icon.innerHTML=postReactionSvg;
    const spans=$$('span',button);
    if(spans.length>1)spans[1].textContent=label;
    if(id){
      postState[id]={...(postState[id]||{}),reaction:emoji,reactionLabel:label};
      savePostState();
    }
    const icons=$('.reaction-icons',post);
    if(icons)icons.textContent=emoji;
    syncPostStats(post);
    // Keep feed/profile/viewer copies visually consistent before the network round-trip.
    if(id)syncPostCopies(id,post);
    try{
      if(id && supabase && currentUser){
        const userId=currentUser.id;
        const {error}=await supabase.from('post_reactions')
          .upsert({post_id:id,user_id:userId,reaction:emoji,updated_at:new Date().toISOString()},{onConflict:'post_id,user_id'});
        if(error)throw error;
        // The upsert is the persistence confirmation. Avoid three extra reads on every
        // reaction tap; update known counters locally and synchronize duplicate post views.
        if(post.dataset.cloudReactionCount !== undefined && !previous.reacted){
          post.dataset.cloudReactionCount=String(Math.max(0,Number(post.dataset.cloudReactionCount)||0)+1);
        }
        syncPostStats(post);
        syncPostCopies(id,post);
      }else if(id){
        throw new Error('يجب تسجيل الدخول لحفظ التفاعل.');
      }
      closeModal($('#reactionModal'));
      // Successful reactions use subtle haptic/audio feedback instead of a success toast.
    }catch(error){
      console.error('Cloud reaction save failed:',{postId:id,message:error?.message,code:error?.code,details:error?.details});
      if(id && previous.state)postState[id]=previous.state;
      else if(id)delete postState[id];
      savePostState();
      button.classList.toggle('reacted',previous.reacted);
      if(previous.emoji)button.dataset.currentReaction=previous.emoji;else delete button.dataset.currentReaction;
      if(previous.label)button.dataset.currentReactionLabel=previous.label;else delete button.dataset.currentReactionLabel;
      if(icon)icon.innerHTML=previous.icon;
      if(spans.length>1)spans[1].textContent=previous.buttonText;
      if(icons)icons.innerHTML=previous.icons;
      syncPostStats(post);
      if(id)syncPostCopies(id,post);
      showToast(error?.message==='يجب تسجيل الدخول لحفظ التفاعل.'?error.message:'تعذر حفظ التفاعل. تحقق من الاتصال وحاول مرة أخرى.');
    }finally{
      if(id)pendingPostReactions.delete(id);
      button.disabled=false;
      button.removeAttribute('aria-busy');
      if(id && supabase) setTimeout(()=>{const latest=$$('.post').find(item=>String(item.dataset.postId||'')===id);if(latest)loadCloudPostStats(latest);},80);
    }
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
  // v51: isolate the composer/editor from the underlying page and preserve its scroll position.
  let composerIsolationState = null;
  function syncComposerIsolation() {
    const composer = document.getElementById('createPostModal');
    const editor = document.getElementById('imageEditorModal');
    const audience = document.getElementById('audienceModal');
    const videoViewer = document.getElementById('egybookVideoModal');
    const discardSheet = document.getElementById('composerDiscardModal');
    const composerOpen = !!composer?.classList.contains('open');
    const editorOpen = !!editor?.classList.contains('open');
    const audienceOpen = !!audience?.classList.contains('open');
    const active = composerOpen || editorOpen || audienceOpen;
    if (active && !composerIsolationState) {
      composerIsolationState = {
        scrollY: window.scrollY,
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow,
        nodes: [...document.body.children].filter(node => node !== composer && node !== editor && node !== audience && node !== videoViewer && node !== discardSheet).map(node => ({node, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden')})),
        composer: composer ? {node: composer, inert: composer.inert, ariaHidden: composer.getAttribute('aria-hidden')} : null
      };
      composerIsolationState.nodes.forEach(({node}) => { node.inert = true; node.setAttribute('aria-hidden', 'true'); });
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.classList.add('egybook-layer-isolated');
      requestAnimationFrame(() => window.scrollTo(0, composerIsolationState?.scrollY || 0));
    }
    // The image editor is a separate interaction layer: while it is open, the composer beneath it cannot receive taps or focus.
    if (composerIsolationState?.composer && composer) {
      if (editorOpen || audienceOpen) {
        composer.inert = true;
        composer.setAttribute('aria-hidden', 'true');
        document.body.classList.add('egybook-image-editor-active');
      } else {
        composer.inert = composerIsolationState.composer.inert;
        const originalHidden = composerIsolationState.composer.ariaHidden;
        if (originalHidden === null) composer.removeAttribute('aria-hidden'); else composer.setAttribute('aria-hidden', originalHidden);
        document.body.classList.remove('egybook-image-editor-active');
      }
    }
    if (!active && composerIsolationState) {
      const state = composerIsolationState;
      state.nodes.forEach(({node, inert, ariaHidden}) => {
        if (!node.isConnected) return;
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', ariaHidden);
      });
      document.documentElement.style.overflow = state.htmlOverflow;
      document.body.style.overflow = state.bodyOverflow;
      document.body.classList.remove('egybook-layer-isolated', 'egybook-image-editor-active');
      composerIsolationState = null;
      requestAnimationFrame(() => window.scrollTo(0, state.scrollY));
    }
  }
  function pushOverlayHistory(modal,key){
    if(!modal)return;
    if(modal.classList.contains('open'))return;
    try{
      history.pushState({...history.state,egybookOverlay:key},'',location.href);
      modal.dataset.overlayHistory=key;
    }catch(_){}
  }
  // If an overlay is dismissed by its close button, consume only its own history entry.
  window.addEventListener('popstate',event=>{
    if(!window.__egybookSkipOverlayPop)return;
    window.__egybookSkipOverlayPop=false;
    event.stopImmediatePropagation();
  },true);
  function openModal(modal) {
    if (!modal) return;
    if (modal.id === 'searchModal') document.body.classList.add('search-overlay-open');
    if (modal.id === 'createPostModal') document.body.classList.add('egybook-composer-open');
    // Give the profile editor its own same-URL history entry. Android browser edge-back
    // then closes this modal first instead of routing away from the profile underneath.
    if (modal.id === 'editProfileModal' && !window.__egybookEditProfileHistoryActive) {
      try {
        history.pushState({ ...(history.state || {}), egybookEditProfileModal: true }, '', location.href);
        window.__egybookEditProfileHistoryActive = true;
      } catch (_) { window.__egybookEditProfileHistoryActive = false; }
    }
    // Profile editor scroll locking is managed by initProfileModalStability().
    // Keep a single owner for the lock to avoid double-locking and stale body styles.
    modal.hidden = false;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (modal.id === 'createPostModal' || modal.id === 'imageEditorModal') syncComposerIsolation();
    // Opening the composer must not summon the mobile keyboard. Focus text only after an explicit user tap.
    if (modal.id !== 'createPostModal' && modal.id !== 'imageEditorModal' && modal.id !== 'commentsModal') {
      const focusable = $('button, select, input:not([type=hidden]), textarea', modal);
      if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 80);
    }
  }
  function closeModal(modal) {
    if (!modal) return;
    if(modal.id==='composerFeatureModal'&&composerFeatureMode==='music'){
      if(!audiusMusicConfirmed&&audiusMusicOriginalMeta){composerPostMeta={...audiusMusicOriginalMeta};updateComposerIdentityPreview();}
      audiusMusicOriginalMeta=null;audiusMusicConfirmed=false;
    }
    const closeProfileHistoryEntry = modal.id === 'editProfileModal'
      && modal.classList.contains('open')
      && window.__egybookEditProfileHistoryActive === true
      && window.__egybookProfilePopClosing !== true;
    const wasSearchOpen = modal.id === 'searchModal' && modal.classList.contains('open');
    if (modal.id === 'searchModal') document.body.classList.remove('search-overlay-open');
    if (modal.id === 'createPostModal') document.body.classList.remove('egybook-composer-open');
    if (modal.id === 'supabaseAuthModal' && !currentUser) { updateAuthGate(); return; }
    const overlayHistoryKey=modal.dataset.overlayHistory;
    if(overlayHistoryKey && history.state?.egybookOverlay===overlayHistoryKey){
      window.__egybookSkipOverlayPop=true;
      try{history.back();}catch(_){window.__egybookSkipOverlayPop=false;}
    }
    delete modal.dataset.overlayHistory;
    modal.classList.remove('open');
    if (modal.classList.contains('comments-modal')) modal.classList.remove('comments-from-image-viewer');
    if (modal.id === 'createPostModal' || modal.id === 'imageEditorModal') syncComposerIsolation();
    if (modal.id === 'postControlsModal') {
      modal.__desktopPopoverCleanup?.();
      modal.__desktopPopoverCleanup = null;
      modal.setAttribute('aria-hidden','true');
      document.body.classList.remove('post-controls-open');
      document.body.style.overflow = document.querySelector('.modal.open') ? 'hidden' : '';
    }
    if (modal.id === 'searchModal') {
      modal.hidden = true;
      // Clear our temporary overlay marker without navigating away from the current route.
      // Calling history.back() here races with profile/result navigation and can send users home.
      if (wasSearchOpen && history.state && history.state.egybookSearchOverlay === true) {
        history.replaceState(window.__egybookSearchPreviousState || {}, '', location.href);
        window.__egybookSearchPreviousState = null;
      }
    }
    if (modal.classList.contains('comments-modal')) modal.hidden = true;
    if (!$('.modal.open')) {
      document.body.style.overflow = (document.body.classList.contains('image-viewer-open') || !$('#imageViewer')?.hidden) ? 'hidden' : '';
      // The profile editor lock is released by its single stability controller.
      // Avoid restoring scroll here as well; duplicate restores cause jumps/freezes on mobile.
    }
    // A close button/backdrop/Escape closes the UI first, then consumes only the
    // modal's same-URL history entry. A guarded popstate handler prevents route handlers
    // from interpreting that cleanup as a request to leave the profile.
    if (closeProfileHistoryEntry) {
      window.__egybookSkipProfileModalPop = true;
      try { history.back(); } catch (_) {
        window.__egybookSkipProfileModalPop = false;
        window.__egybookEditProfileHistoryActive = false;
      }
      setTimeout(() => {
        if (window.__egybookSkipProfileModalPop) {
          window.__egybookSkipProfileModalPop = false;
          window.__egybookEditProfileHistoryActive = false;
        }
      }, 700);
    }
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
      // Keep the reactions summary visible for every post, including new posts with zero reactions.
      // The separate action button below remains labeled independently as "إعجاب".
      likeCount.textContent = `${formatPostCount(total)} تفاعل`;
      const summary = likeCount.closest('.reaction-summary');
      if (summary) summary.hidden = false;
    }
    const shares = $('.share-count', post);
    if (shares) shares.textContent = formatPostCount(Number(state.shareCount)||0);
  }
  async function loadCloudPostStats(post) {
    const id=String(post?.dataset.postId||'');
    if(!id || !supabase) return;
    const userId=currentUser?.id||null;
    const reactionVersionAtStart=postReactionVersions.get(id)||0;
    const requestVersion=(postStatsRequestVersions.get(id)||0)+1;
    postStatsRequestVersions.set(id,requestVersion);
    try {
      const [reactionResult, commentResult, mineResult] = await Promise.all([
        supabase.from('post_reactions').select('reaction',{count:'exact',head:false}).eq('post_id',id),
        supabase.from('post_comments').select('id',{count:'exact',head:true}).eq('post_id',id),
        userId ? supabase.from('post_reactions').select('reaction').eq('post_id',id).eq('user_id',userId).maybeSingle() : Promise.resolve({data:null,error:null})
      ]);
      if(currentUser?.id!==userId) return;
      // Ignore stale/out-of-order reads, especially reads started before a tap.
      if(postStatsRequestVersions.get(id)!==requestVersion) return;
      if((postReactionVersions.get(id)||0)!==reactionVersionAtStart || pendingPostReactions.has(id)) {
        // A reaction write is newer than this read; a fresh read will be requested after it.
        return;
      }
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
        const si=$('.action-icon',sourceLike),ti=$('.action-icon',target);if(si&&ti)ti.innerHTML=si.innerHTML;
        const ss=$$('span',sourceLike),ts=$$('span',target);if(ss[1]&&ts[1])ts[1].textContent=ss[1].textContent;
      }
      const sr=$('.reaction-icons',sourcePost),tr=$('.reaction-icons',target);if(sr&&tr)tr.innerHTML=sr.innerHTML;
      syncPostStats(target);
    });
  }
  function syncAllPostStats() { $$('.post').forEach(post=>{syncPostStats(post);loadCloudPostStats(post);}); updateRealProfileStats(); }
  function createPostElement({id, text, media, mediaType, visibility, createdAt, authorName, authorAvatar, feeling='', activity='', location_name='', tagged_user_ids=[], music_title='', music_artist='', music_track_id='', music_permalink='', music_artwork_url='', music_start_seconds=0, music_duration_seconds=30, media_urls=[]}) {
    const article = document.createElement('article');
    article.className = 'post';
    article.dataset.postId = id;
    const dateText = new Date(createdAt || Date.now()).toLocaleString('ar-EG', {dateStyle:'short', timeStyle:'short'});
    let mediaHTML = '';
    if (media && mediaType === 'image') mediaHTML = `<img class="post-image" src="${escapeHTML(media)}" alt="صورة مرفقة بالمنشور" loading="lazy" decoding="async" width="1200" height="900">`;
    else if (media && mediaType === 'video') mediaHTML = `<video class="post-image" src="${escapeHTML(media)}" controls playsinline preload="metadata" width="1200" height="900"></video>`;
    article.innerHTML = `
      <header class="post-header"><div class="avatar">${escapeHTML((authorName||'عضو EgyBook').trim().charAt(0)||'ح')}</div><div class="post-author"><div class="author-name">${escapeHTML(authorName||'عضو EgyBook')}</div><div class="post-meta">${escapeHTML(dateText)} · ${escapeHTML(visibility || 'الجميع')}</div></div><button class="more-button" data-action="post-menu" aria-label="خيارات المنشور">⋯</button></header>
      <p class="post-text"></p>${mediaHTML}
      <div class="post-stats"><div class="reaction-summary"><div class="reaction-icons"></div><button type="button" class="like-count stats-click" data-action="reactions-open">0 تفاعل</button></div><span class="stats-links"><button type="button" class="comment-count stats-click" data-action="comments-open">0</button> تعليق <span class="stats-separator" aria-hidden="true"></span><span class="share-count">0</span> مشاركة</span></div>
      <div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon post-reaction-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7.2 10.2 11 4.5c.5-.8 1.7-.5 1.8.5l.2 4h4.1a2 2 0 0 1 1.9 2.6l-1.8 6.1a2.4 2.4 0 0 1-2.3 1.7H7.2z"/><path d="M4 10h3.2v9H4z"/></svg></span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon comment-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3.5 2v-5.1A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14h5"/></svg></span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon share-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg></span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon save-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v16L12 17l-7.5 4V5A1.5 1.5 0 0 1 6 3.5Z"/></svg></span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
    // Apply the author's avatar at creation time. Previously this argument was
    // ignored, so freshly published posts could show only the initial until reload.
    const authorAvatarElement = $('.post-header .avatar', article);
    if (authorAvatarElement && authorAvatar) {
      authorAvatarElement.textContent = '';
      authorAvatarElement.style.backgroundImage = `url("${String(authorAvatar).replace(/"/g, '%22')}")`;
      authorAvatarElement.style.backgroundSize = 'cover';
      authorAvatarElement.style.backgroundPosition = 'center';
      authorAvatarElement.setAttribute('aria-label', authorName || 'صورة صاحب المنشور');
    }
    $('.post-text', article).textContent = text;
    const safeMediaUrls=Array.isArray(media_urls)&&media_urls.length?media_urls.filter(Boolean).slice(0,10):(media?[media]:[]);
    article.dataset.mediaUrls=JSON.stringify(safeMediaUrls);
    renderPostMetadata(article,{feeling,activity,location_name,tagged_user_ids:tagged_user_ids||[],music_title,music_artist,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds,media_urls:safeMediaUrls});
    const primaryImage=$('.post-image',article);
    if(primaryImage&&primaryImage.tagName==='IMG'&&safeMediaUrls.length>1){
      primaryImage.src=safeMediaUrls[0];
      primaryImage.dataset.multiImageCount=String(safeMediaUrls.length);
      primaryImage.setAttribute('aria-label',`الصورة 1 من ${safeMediaUrls.length}؛ اضغط لعرض الصور`);
      const mediaWrap=document.createElement('div');mediaWrap.className='post-media-single-wrap';
      primaryImage.replaceWith(mediaWrap);mediaWrap.append(primaryImage);
      const count=document.createElement('span');count.className='post-image-count-badge';count.textContent=`1 / ${safeMediaUrls.length} · +${safeMediaUrls.length-1} صور`;count.setAttribute('aria-label',`${safeMediaUrls.length} صور`);mediaWrap.append(count);
    }
    const musicCard=$('.post-music-player',article),mediaForMusic=$('.post-media-single-wrap',article)||$('.post-image',article);
    if(musicCard&&mediaForMusic&&mediaForMusic.tagName!=='VIDEO'){
      const metaWrap=musicCard.closest('.post-context-details');
      musicCard.remove();if(metaWrap&&!metaWrap.children.length)metaWrap.remove();
      mediaForMusic.insertAdjacentElement('afterend',musicCard);
    }
    observePostMusicPlayers(article);
    return article;
  }
  async function uploadPostMedia(file, userId, oldUrl=null) {
    if (!file || !supabase) return oldUrl;
    const mime=String(file.type||'').toLowerCase();
    const mimeExt={'audio/webm':'webm','audio/ogg':'ogg','audio/opus':'opus','audio/mp4':'m4a','audio/aac':'aac','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
    const fromName=String(file.name||'').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');
    const ext=mimeExt[mime]||fromName||'bin';
    if(!/^[a-z0-9]{1,8}$/.test(ext))throw new Error('امتداد الملف غير مدعوم.');
    const makeId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
    const path=`${userId}/${makeId()}.${ext}`;
    const {error}=await supabase.storage.from('post-media').upload(path,file,{upsert:false,contentType:mime||undefined,cacheControl:'3600'});
    if(error){console.error('post-media upload failed',{message:error.message,code:error.statusCode||error.status,details:error.error||error.name,mime,ext,path});throw error;}
    const {data}=supabase.storage.from('post-media').getPublicUrl(path);
    if(!data?.publicUrl)throw new Error('تم رفع الملف لكن تعذر إنشاء رابط المرفق.');
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
    const data={id:row.id,text:row.text||'',media:row.media_url||null,mediaType:row.media_type||null,media_urls:row.media_urls||[],visibility:row.visibility||'الجميع',createdAt,authorName,authorAvatar:authorProfile?.avatar_url||null,feeling:row.feeling||'',activity:row.activity||'',location_name:row.location_name||'',tagged_user_ids:row.tagged_user_ids||[],music_title:row.music_title||'',music_artist:row.music_artist||'',music_track_id:row.music_track_id||'',music_permalink:row.music_permalink||'',music_artwork_url:row.music_artwork_url||'',music_start_seconds:row.music_start_seconds||0,music_duration_seconds:row.music_duration_seconds||30};
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
    feedNextOffset=100; feedHasMore=true;
    const userAtStart=currentUser;
    if(supabase && userAtStart){
      const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at,feeling,activity,location_name,tagged_user_ids,music_title,music_artist,media_urls,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds').order('created_at',{ascending:false}).limit(100);
      if(error){console.error('Supabase posts load failed',error);showToast('تعذر تحميل المنشورات: '+error.message);return;}
      if(currentUser?.id!==userAtStart.id)return;
      // Reconcile the feed in place: keep existing DOM nodes while data refreshes
      // so the feed/background does not flash on every refresh.
      // Supabase RLS is the source of truth for audience visibility. Do not
      // discard friends/followers-only posts client-side after the secure query.
      const rows=(data||[]);
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
  async function loadMoreFeedPosts(){
    if(feedPaging || !feedHasMore || !supabase || !currentUser || currentPage!=='home')return;
    feedPaging=true;
    const userId=currentUser.id;
    const offset=feedNextOffset;
    try{
      const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at,feeling,activity,location_name,tagged_user_ids,music_title,music_artist,media_urls,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds').order('created_at',{ascending:false}).range(offset,offset+FEED_PAGE_SIZE-1);
      if(error)throw error;
      if(currentUser?.id!==userId)return;
      // Supabase RLS is the source of truth for post audiences. A client-side
      // public-only filter here incorrectly hides friends/followers/selected-
      // audience posts that the server has already authorized for this viewer.
      const rows=(data||[]);
      feedNextOffset=offset+(data||[]).length;
      feedHasMore=(data||[]).length===FEED_PAGE_SIZE;
      if(!rows.length)return;
      const ids=[...new Set(rows.map(row=>row.user_id).filter(Boolean))];
      const profileMap={};
      if(ids.length){const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',ids);if(!profileError)(profiles||[]).forEach(profile=>profileMap[profile.id]=profile);}
      if(currentUser?.id!==userId)return;
      rows.forEach(row=>{
        if($(`[data-post-id="${CSS.escape(String(row.id))}"]`,postsList))return;
        renderCloudPost(row,profileMap[row.user_id]||null);
        const node=$(`[data-post-id="${CSS.escape(String(row.id))}"]`,postsList);
        if(node)node.dataset.feedPage=String(Math.floor(offset/FEED_PAGE_SIZE));
      });
      updateEmptyState();
    }catch(error){console.warn('Load more feed posts failed:',error);}
    finally{feedPaging=false;}
  }
  function setupFeedInfiniteScroll(){
    if(!postsList || !('IntersectionObserver' in window))return;
    if(!feedSentinel){feedSentinel=document.createElement('div');feedSentinel.className='feed-load-sentinel';feedSentinel.setAttribute('aria-hidden','true');$('#feedSection')?.append(feedSentinel);}
    window.__egybookFeedObserver?.disconnect();
    window.__egybookFeedObserver=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting))loadMoreFeedPosts();
    },{root:null,rootMargin:'1000px 0px',threshold:0});
    window.__egybookFeedObserver.observe(feedSentinel);
  }
  setupFeedInfiniteScroll();

  function syncAudienceUI(){
    const meta=AUDIENCE_META[selectedAudience]||AUDIENCE_META['عام'];
    const label=$('#audiencePickerLabel'),desc=$('#audiencePickerDescription'),icon=$('#audiencePickerIcon'),vis=$('#postVisibility');
    if(label)label.textContent=meta.label;
    if(desc)desc.textContent=meta.description;
    if(icon)icon.textContent=meta.icon;
    if(vis)vis.value=selectedAudience;
    $$('#audienceChoices [data-audience]').forEach(option=>{
      const active=option.dataset.audience===selectedAudience;
      option.classList.toggle('selected',active);
      option.setAttribute('aria-pressed',String(active));
    });
    const needsPeople=['استثناء','أشخاص محددون','الأصدقاء المقربون','قائمة مخصصة'].includes(selectedAudience);
    const picker=$('#audienceFriendsPicker');
    if(picker)picker.hidden=!needsPeople;
    const title=$('#audienceFriendsTitle');
    if(title)title.textContent=selectedAudience==='استثناء'?'حدد الأصدقاء الذين لن يروا المنشور':selectedAudience==='أشخاص محددون'?'حدد الأشخاص المسموح لهم برؤية المنشور':selectedAudience==='الأصدقاء المقربون'?'حدد الأصدقاء المقربين': 'حدد أعضاء القائمة المخصصة';
  }
  let composerHistoryStateActive = false;
  function pushComposerOverlayState(){
    if(composerHistoryStateActive) return;
    try{ history.pushState({...history.state, egybookComposerOverlay:true}, '', location.href); composerHistoryStateActive=true; }catch(_){}
  }
  function clearComposerOverlayState(){
    if(!composerHistoryStateActive) return;
    composerHistoryStateActive=false;
    try{ if(history.state?.egybookComposerOverlay) history.back(); }catch(_){}
  }
  function openPostComposer(){
    pushComposerOverlayState();
    selectedAudience=localStorage.getItem('egybook_default_audience')||'عام';
    if(!AUDIENCE_META[selectedAudience])selectedAudience='عام';
    selectedAudienceIds=[];excludedAudienceIds=[];customAudienceListId=null;
    const name=$('#composerUserName'),avatar=$('#composerUserAvatar');
    if(name)name.textContent=profileData.name||currentUser?.user_metadata?.full_name||'حسابي';
    if(avatar){
      const fallback=(profileData.name||currentUser?.user_metadata?.full_name||'ح').trim().charAt(0)||'ح';
      avatar.textContent=fallback;
      avatar.style.backgroundImage='';
      avatar.classList.remove('has-photo');
      const avatarUrl=String(profileData.avatar||currentUser?.user_metadata?.avatar_url||currentUser?.user_metadata?.picture||'').trim();
      if(avatarUrl){
        const image=new Image();
        image.onload=()=>{avatar.style.backgroundImage=`url("${avatarUrl.replace(/"/g,'%22')}")`;avatar.textContent='';avatar.classList.add('has-photo');};
        image.onerror=()=>{avatar.style.backgroundImage='';avatar.textContent=fallback;avatar.classList.remove('has-photo');};
        image.src=avatarUrl;
      }
    }
    const submit=$('#publishPostActual');
    if(submit)submit.disabled=!postContent.value.trim()&&!selectedMedia;
    syncAudienceUI();
    if (document.activeElement === postContent) postContent.blur();
    openModal(createPostModal);
    // Keep the mobile keyboard closed until the user deliberately taps the text field.
  }
  async function loadAudienceFriends(){
    const list=$('#audienceFriendsList');
    if(!list)return;
    if(!supabase||!currentUser){list.innerHTML='<p class="audience-empty">سجّل الدخول أولًا لعرض أصدقائك.</p>';return;}
    list.innerHTML='<p class="audience-empty">جارٍ تحميل الأصدقاء…</p>';
    try{
      const {data:relations,error}=await supabase.from('friend_requests').select('sender_id,receiver_id,status').eq('status','accepted').or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);
      if(error)throw error;
      const ids=[...new Set((relations||[]).map(r=>r.sender_id===currentUser.id?r.receiver_id:r.sender_id).filter(id=>id&&id!==currentUser.id))];
      if(!ids.length){audienceFriendsCache=[];list.innerHTML='<p class="audience-empty">لم تتم إضافة أصدقاء بعد.</p>';return;}
      const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',ids);
      if(profileError)throw profileError;
      audienceFriendsCache=(profiles||[]).map(p=>({id:p.id,name:p.full_name||p.username||'عضو EgyBook',username:p.username||'',avatar:p.avatar_url||''}));
      renderAudienceFriends();
    }catch(error){console.error('Audience friends load failed',error);list.innerHTML='<p class="audience-empty">تعذر تحميل الأصدقاء. تأكد من إعدادات قاعدة البيانات.</p>';}
  }
  function renderAudienceFriends(){
    const list=$('#audienceFriendsList');if(!list)return;
    const q=($('#audienceFriendSearch')?.value||'').trim().toLowerCase();
    const selected=selectedAudience==='استثناء'?excludedAudienceIds:selectedAudienceIds;
    const matches=audienceFriendsCache.filter(p=>`${p.name} ${p.username}`.toLowerCase().includes(q));
    list.replaceChildren();
    if(!matches.length){const empty=document.createElement('p');empty.className='audience-empty';empty.textContent='لا توجد نتائج.';list.append(empty);return;}
    matches.forEach(person=>{
      const row=document.createElement('label');row.className='audience-friend-row';
      const check=document.createElement('input');check.type='checkbox';check.checked=selected.includes(person.id);check.dataset.audienceFriendId=person.id;
      const avatar=document.createElement('span');avatar.className='audience-friend-avatar';
      if(person.avatar){avatar.style.backgroundImage=`url("${person.avatar.replace(/"/g,'%22')}")`;avatar.classList.add('has-photo');}else avatar.textContent=(person.name||'ح').charAt(0);
      const name=document.createElement('span');name.className='audience-friend-name';name.textContent=person.name;
      row.append(check,avatar,name);list.append(row);
    });
  }
  function openAudiencePicker(){
    editingPrivacyPost=null;
    const audiencePublish=$('#audiencePublishPost');if(audiencePublish)audiencePublish.hidden=false;
    $('#audienceDefaultCheckbox')?.closest('.audience-default-row')?.removeAttribute('hidden');
    audienceReturnToComposer=true;
    // Keep the composer mounted underneath the audience picker so returning always lands on the same draft.
    const defaultCheckbox=$('#audienceDefaultCheckbox');
    if(defaultCheckbox)defaultCheckbox.checked=!localStorage.getItem('egybook_default_audience') || localStorage.getItem('egybook_default_audience')===selectedAudience;
    syncAudienceUI();
    updatePublishButton();
    openModal($('#audienceModal'));
    if(!audienceFriendsCache.length)loadAudienceFriends();else renderAudienceFriends();
  }
  async function saveCloseFriends(ids){
    if(!supabase||!currentUser)return;
    const {error:deleteError}=await supabase.from('close_friends').delete().eq('user_id',currentUser.id);
    if(deleteError)throw deleteError;
    if(ids.length){const {error}=await supabase.from('close_friends').insert(ids.map(friend_id=>({user_id:currentUser.id,friend_id})));if(error)throw error;}
  }
  async function saveCustomAudienceList(ids){
    if(!supabase||!currentUser)return null;
    const {data:existing,error:findError}=await supabase.from('custom_audience_lists').select('id').eq('user_id',currentUser.id).eq('name','قائمة بلا تسمية').maybeSingle();
    if(findError)throw findError;
    let listId=existing?.id;
    if(!listId){const {data,error}=await supabase.from('custom_audience_lists').insert({user_id:currentUser.id,name:'قائمة بلا تسمية'}).select('id').single();if(error)throw error;listId=data.id;}
    const {error:deleteError}=await supabase.from('custom_audience_list_members').delete().eq('list_id',listId);
    if(deleteError)throw deleteError;
    if(ids.length){const {error}=await supabase.from('custom_audience_list_members').insert(ids.map(user_id=>({list_id:listId,user_id})));if(error)throw error;}
    return listId;
  }
  async function confirmAudience(publishAfterConfirm=false){
    if(publishAfterConfirm){const publishButton=$('#audiencePublishPost');if(publishButton)publishButton.disabled=true;}
    const checked=$$('#audienceFriendsList [data-audience-friend-id]:checked').map(input=>input.dataset.audienceFriendId);
    try{
      if(selectedAudience==='استثناء')excludedAudienceIds=checked;
      else if(['أشخاص محددون','الأصدقاء المقربون','قائمة مخصصة'].includes(selectedAudience))selectedAudienceIds=checked;
      if(selectedAudience==='الأصدقاء المقربون'){await saveCloseFriends(selectedAudienceIds);}
      if(selectedAudience==='قائمة مخصصة')customAudienceListId=await saveCustomAudienceList(selectedAudienceIds);

      if(editingPrivacyPost){
        const post=editingPrivacyPost;
        const postId=post.dataset.postId;
        if(!supabase||!currentUser||!postId||!(/^[0-9a-f-]{36}$/i.test(postId)))throw new Error('لا يمكن حفظ خصوصية هذا المنشور من قاعدة البيانات.');
        const payload={visibility:selectedAudience,audience_user_ids:selectedAudience==='أشخاص محددون'?selectedAudienceIds:[],excluded_user_ids:selectedAudience==='استثناء'?excludedAudienceIds:[],audience_list_id:selectedAudience==='قائمة مخصصة'?customAudienceListId:null,feeling:composerPostMeta.feeling||null,activity:composerPostMeta.activity||null,location_name:composerPostMeta.location_name||null,tagged_user_ids:composerPostMeta.tagged_user_ids||[],music_title:composerPostMeta.music_title||null,music_artist:composerPostMeta.music_artist||null};
        const {data,error}=await supabase.from('posts').update(payload).eq('id',postId).eq('user_id',currentUser.id).select('id').maybeSingle();
        if(error)throw error;
        if(!data)throw new Error('لم يتم تحديث المنشور. تأكد أنك صاحب المنشور وأن صلاحيات التحديث مفعّلة.');
        post.dataset.visibility=selectedAudience;
        post.dataset.audienceUserIds=JSON.stringify(payload.audience_user_ids);
        post.dataset.excludedUserIds=JSON.stringify(payload.excluded_user_ids);
        post.dataset.audienceListId=payload.audience_list_id||'';
        const meta=$('.post-meta',post);if(meta){const parts=meta.textContent.split('·');meta.textContent=(parts[0]||'').trim()+' · '+(AUDIENCE_META[selectedAudience]?.label||selectedAudience);}
        editingPrivacyPost=null;closeModal($('#audienceModal'));closeModal($('#postControlsModal'));
        showToast('تم تحديث خصوصية المنشور بنجاح.');
        return;
      }

      const remember=$('#audienceDefaultCheckbox')?.checked;
      if(remember)localStorage.setItem('egybook_default_audience',selectedAudience);
      else localStorage.removeItem('egybook_default_audience');
      closeModal($('#audienceModal'));
      syncAudienceUI();
      if(publishAfterConfirm){
        // Keep the chosen audience in memory and publish the existing draft directly.
        await publishPost({preventDefault(){}});
      }else{
        openModal(createPostModal);
      }
    }catch(error){console.error('Save audience settings failed',error);showToast('تعذر حفظ الخصوصية: '+(error.message||'تحقق من إعدادات قاعدة البيانات.'));updatePublishButton();}
  }

  async function openPostPrivacyEditor(post){
    if(!post)return;
    const postId=post.dataset.postId;
    if(!supabase||!currentUser||!postId||!(/^[0-9a-f-]{36}$/i.test(postId))){showToast('تعديل الخصوصية متاح للمنشورات المحفوظة في حسابك فقط.');return;}
    try{
      const {data,error}=await supabase.from('posts').select('id,user_id,visibility,audience_user_ids,excluded_user_ids,audience_list_id').eq('id',postId).eq('user_id',currentUser.id).maybeSingle();
      if(error)throw error;
      if(!data){showToast('لم يتم العثور على منشور تملكه.');return;}
      editingPrivacyPost=post;
      selectedAudience=data.visibility||'عام';
      if(selectedAudience==='الجميع')selectedAudience='عام';
      if(!AUDIENCE_META[selectedAudience])selectedAudience='عام';
      selectedAudienceIds=Array.isArray(data.audience_user_ids)?data.audience_user_ids:[];
      excludedAudienceIds=Array.isArray(data.excluded_user_ids)?data.excluded_user_ids:[];
      customAudienceListId=data.audience_list_id||null;
      audienceReturnToComposer=false;
      const defaultCheckbox=$('#audienceDefaultCheckbox');if(defaultCheckbox){defaultCheckbox.checked=false;defaultCheckbox.closest('.audience-default-row')?.setAttribute('hidden','hidden');}
      const extra=$('#audienceExtraOptions');if(extra)extra.hidden=false;
      const showAll=$('#audienceShowAll');if(showAll)showAll.hidden=true;
      const audiencePublish=$('#audiencePublishPost');if(audiencePublish)audiencePublish.hidden=true;
      syncAudienceUI();closeModal($('#postControlsModal'));openModal($('#audienceModal'));
      if(!audienceFriendsCache.length)await loadAudienceFriends();else renderAudienceFriends();
    }catch(error){console.error('Open post privacy editor failed',error);showToast('تعذر فتح إعدادات خصوصية المنشور: '+(error.message||''));}
  }
  function updatePublishButton(){
    const hasContent=!!postContent.value.trim()||!!selectedMedia;
    const submit=$('#publishPostActual');if(submit)submit.disabled=!hasContent||isPublishingPost;
    const audiencePublish=$('#audiencePublishPost');if(audiencePublish)audiencePublish.disabled=!hasContent||isPublishingPost;
  }


  const COMPOSER_FEELINGS = [
    ['😊','سعيد'],['🥰','محبوب'],['😎','متحمس'],['😢','حزين'],['😡','غاضب'],['🙏','ممتن'],['🤩','متحمس جدًا'],['😌','مرتاح'],['🤔','يفكر'],['😴','نعسان'],['💪','قوي'],['❤️','في حالة حب']
  ];
  const COMPOSER_ACTIVITIES = [
    ['🎮','يلعب ألعابًا'],['🎧','يستمع إلى الموسيقى'],['🍽️','يتناول الطعام'],['🏋️','يتمرن'],['✈️','يسافر'],['📚','يقرأ'],['🎬','يشاهد فيلمًا'],['⚽','يلعب كرة القدم'],['💻','يعمل'],['📸','يلتقط صورًا']
  ];
  // Audius public read API: no private bearer token is used in browser code.
  const AUDIUS_API_BASE = 'https://api.audius.co/v1';
  const AUDIUS_PUBLIC_API_KEY = ''; // Optional: API key only (never paste the Bearer Token here).
  let audiusTracks = [];
  let audiusActiveCategory = 'trending';
  let audiusSearchTimer = null;
  let audiusAudio = null;
  let audiusPlayingTrackId = null;
  let audiusRequestId = 0;
  function audiusEndpoint(path, params={}) {
    const url = new URL(AUDIUS_API_BASE + path);
    Object.entries(params).forEach(([key,value])=>{ if(value!==undefined && value!==null && value!=='') url.searchParams.set(key,String(value)); });
    if (AUDIUS_PUBLIC_API_KEY) url.searchParams.set('api_key', AUDIUS_PUBLIC_API_KEY);
    return url.toString();
  }
  async function audiusGet(path, params={}) {
    const response = await fetch(audiusEndpoint(path, params), {headers:{'Accept':'application/json'}});
    if (!response.ok) throw new Error('Audius API ('+response.status+')');
    const json = await response.json();
    if (json?.data === undefined) throw new Error('استجابة Audius غير متوقعة');
    return json.data;
  }
  function normalizeAudiusTrack(track) {
    const artist = track?.user?.name || track?.artist_name || 'فنان Audius';
    const artwork = track?.artwork?.['480x480'] || track?.artwork?.['150x150'] || track?.artwork?.['1000x1000'] || '';
    return {id:String(track.id), title:track.title||'بدون عنوان', artist, artwork,
      plays:Number(track.play_count||track.play_count_total||0), permalink:track.permalink||'',
      duration:Number(track.duration||0), genre:track.genre||''};
  }
  function formatMusicDuration(seconds) {
    if(!Number.isFinite(seconds)||seconds<=0)return '';
    return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  }
  async function loadAudiusTracks(query='') {
    const requestId=++audiusRequestId, body=$('#composerFeatureBody');
    if(!body)return;
    body.querySelector('.audius-music-results')?.classList.add('is-loading');
    if(!body.querySelector('.audius-music-results')) body.innerHTML='<div class="audius-music-status">جارٍ تحميل مكتبة الموسيقى…</div>';
    try {
      let data;
      if(query.trim()) {
        data=await audiusGet('/tracks/search',{query:query.trim(),limit:25});
      } else if(audiusActiveCategory==='popular') {
        data=await audiusGet('/tracks/trending',{limit:25,time:'week'});
      } else if(audiusActiveCategory==='latest') {
        data=await audiusGet('/tracks/latest',{limit:25});
      } else if(audiusActiveCategory==='recommended') {
        data=await audiusGet('/tracks/recommended',{limit:25});
      } else {
        data=await audiusGet('/tracks/trending',{limit:25});
      }
      if(requestId!==audiusRequestId)return;
      audiusTracks=(Array.isArray(data)?data:[]).map(normalizeAudiusTrack);
      renderAudiusMusic(query);
    } catch(error) {
      if(requestId!==audiusRequestId||audiusMusicView==='trim')return;
      console.error('Audius music request failed:',error);
      body.innerHTML=`<div class="audius-music-status error">تعذر تحميل الأغاني من Audius حاليًا.<br><button type="button" data-audius-retry>إعادة المحاولة</button><small>تأكد من اتصال الإنترنت أو جرّب بعد قليل.</small></div>`;
    }
  }
  function renderAudiusMusic(query='') {
    const body=$('#composerFeatureBody');if(!body)return;
    const tabs=[['trending','رائجة','♨'],['popular','الأكثر استماعًا','↗'],['recommended','المقترحة','♫'],['latest','الأحدث','☷']];
    const selectedId=String(composerPostMeta.music_track_id||'');
    const selectedTrack=audiusTracks.find(t=>String(t.id)===selectedId);
    if(audiusMusicView==='trim' && selectedId){
      const total=Math.max(5,Number(composerPostMeta.music_duration_total)||selectedTrack?.duration||180);
      const duration=Math.min(110,Math.max(5,Number(composerPostMeta.music_duration_seconds)||30),total);
      const maxStart=Math.max(0,total-duration);
      const start=Math.min(maxStart,Math.max(0,Number(composerPostMeta.music_start_seconds)||0));
      composerPostMeta.music_start_seconds=start;composerPostMeta.music_duration_seconds=duration;
      body.innerHTML=`<section class="audius-trim-page" dir="rtl">
        <div class="audius-trim-top"><button type="button" data-audius-trim-back aria-label="العودة لقائمة الأغاني">‹</button><div><strong>ضبط مقطع الأغنية</strong><small>اختَر الجزء الذي تريد إضافته إلى منشورك</small></div><button type="button" data-audius-change-track>تغيير</button></div>
        <div class="audius-trim-artwork">${composerPostMeta.music_artwork_url?`<img src="${escapeHTML(composerPostMeta.music_artwork_url)}" alt="">`:'♫'}</div>
        <div class="audius-trim-song-copy"><strong>${escapeHTML(composerPostMeta.music_title||'الأغنية المختارة')}</strong><span>${escapeHTML(composerPostMeta.music_artist||'')}</span></div>
        <div class="audius-trim-time-row"><span>بداية الأغنية</span><strong id="audiusStartValue">${formatMusicDuration(start)||'0:00'}</strong><span>المدة الكاملة ${formatMusicDuration(total)}</span></div>
        <input class="audius-trim-start" id="audiusStartRange" type="range" min="0" max="${maxStart}" step="1" value="${start}" aria-label="بداية المقطع">
        <div class="audius-trim-wave" aria-hidden="true">${Array.from({length:43},(_,i)=>`<i style="--bar:${18+((i*17+7)%53)}%;--bar-index:${i}"></i>`).join('')}<span class="audius-trim-selection"></span></div>
        <div class="audius-trim-duration-head"><label for="audiusDurationRange">مدة المقطع</label><strong id="audiusDurationValue">${formatMusicDuration(duration)}</strong><span>الحد الأقصى 1:50</span></div>
        <input id="audiusDurationRange" class="audius-trim-duration" type="range" min="5" max="${Math.min(110,total)}" step="1" value="${duration}" aria-label="مدة المقطع">
        <div class="audius-trim-controls"><button type="button" data-audius-trim-preview>▶ معاينة المقطع</button><span>المقطع المختار: <b id="audiusTrimRangeLabel">${formatMusicDuration(start)} – ${formatMusicDuration(start+duration)}</b></span></div>
        <div class="audius-trim-bottom-actions">${audiusTrimCanRemove?'<button type="button" class="audius-remove-song" data-audius-remove-track>إزالة الأغنية</button>':''}<button type="button" class="audius-confirm-trim" data-audius-confirm-trim>تم · استخدام الأغنية</button></div>
        <p class="audius-trim-note">ستُضاف الأغنية إلى منشورك. يمكنك إرفاق صورة أو فيديو لتشغيل الموسيقى في الخلفية.</p>
      </section>`;
      const footer=$('#composerFeatureModal footer');if(footer)footer.hidden=true;
      return;
    }
    const footer=$('#composerFeatureModal footer');if(footer)footer.hidden=true;
    body.innerHTML=`<div class="audius-music-shell" dir="rtl">
      <div class="audius-music-brand"><span class="audius-brand-mark">♫</span><div><strong>EgyBook <b>Music</b></strong><small>اكتشف موسيقاك من مكتبة Audius</small></div><span class="audius-source-badge">Audius</span></div>
      <label class="audius-search-wrap"><span aria-hidden="true">⌕</span><input id="composerFeatureSearch" type="search" autocomplete="off" placeholder="بحث عن فنانين أو أغاني" value="${escapeHTML(query)}"><button type="button" data-audius-clear-search aria-label="مسح البحث">×</button></label>
      <div class="audius-music-tabs">${tabs.map(([id,label,icon])=>`<button type="button" data-audius-category="${id}" class="${audiusActiveCategory===id&&!query?'active':''}"><span>${icon}</span>${label}</button>`).join('')}</div>
      <div class="audius-music-results">${audiusTracks.length?audiusTracks.map(t=>`<article class="audius-track ${selectedId===String(t.id)?'selected':''}" data-track-id="${escapeHTML(t.id)}">
        <button type="button" class="audius-track-play ${audiusPlayingTrackId===t.id?'playing':''}" data-audius-play="${escapeHTML(t.id)}" aria-label="${audiusPlayingTrackId===t.id?'إيقاف المعاينة':'تشغيل المعاينة'}">${audiusPlayingTrackId===t.id?'Ⅱ':'▶'}</button>
        <button type="button" class="audius-track-info" data-audius-select="${escapeHTML(t.id)}" data-track-title="${escapeHTML(t.title)}" data-track-artist="${escapeHTML(t.artist)}" data-track-url="${escapeHTML(t.permalink)}" data-track-artwork="${escapeHTML(t.artwork)}" data-track-duration="${Number(t.duration)||180}">
          <span class="audius-track-copy"><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.artist)}</small><em>${t.plays.toLocaleString('en-US')} استماع${t.duration?' · '+formatMusicDuration(t.duration):''}</em></span>
          <span class="audius-track-art">${t.artwork?`<img loading="lazy" src="${escapeHTML(t.artwork)}" alt="">`:'♫'}</span>
        </button>
      </article>`).join(''):'<div class="audius-music-status">لا توجد نتائج حاليًا. جرّب كلمة بحث أخرى.</div>'}</div>
      <div class="audius-music-footnote">اختَر أغنية لضبط المقطع قبل إضافته إلى المنشور.</div>
    </div>`;
  }
  async function previewAudiusTrack(trackId) {
    if(window.__egybookStopPostMusic)window.__egybookStopPostMusic(false);
    const track=audiusTracks.find(t=>String(t.id)===String(trackId));
    if(!track)return;
    if(audiusAudio && audiusPlayingTrackId===String(trackId) && !audiusAudio.paused) {
      audiusAudio.pause();audiusPlayingTrackId=null;renderAudiusMusic($('#composerFeatureSearch')?.value||'');return;
    }
    if(audiusAudio){try{audiusAudio.pause();audiusAudio.removeAttribute('src');audiusAudio.load();}catch(_){}}
    const audio=new Audio(audiusEndpoint(`/tracks/${encodeURIComponent(trackId)}/stream`));
    audiusAudio=audio;audio.preload='none';audio.dataset.trackId=String(trackId);
    audio.addEventListener('ended',()=>{if(audiusAudio!==audio)return;audiusPlayingTrackId=null;renderAudiusMusic($('#composerFeatureSearch')?.value||'');},{once:true});
    audio.addEventListener('error',()=>{if(audiusAudio!==audio)return;audiusPlayingTrackId=null;showToast('المقطع غير متاح للتشغيل حاليًا. جرّب إعادة المحاولة أو اختيار أغنية أخرى.');renderAudiusMusic($('#composerFeatureSearch')?.value||'');},{once:true});
    audiusPlayingTrackId=String(trackId);renderAudiusMusic($('#composerFeatureSearch')?.value||'');
    try{await audio.play();}
    catch(error){if(audiusAudio===audio){audiusPlayingTrackId=null;showToast(/NotAllowedError/i.test(String(error?.name))?'اضغط تشغيل المعاينة للسماح بتشغيل الصوت.':'تعذّر تشغيل المعاينة الآن. جرّب مرة أخرى.');renderAudiusMusic($('#composerFeatureSearch')?.value||'');}}
  }
  function composerFeatureButton(label, value, extra='') {
    return `<button type="button" class="composer-feature-option ${extra}" data-feature-value="${escapeHTML(value)}">${label}</button>`;
  }
  function renderComposerFeature(mode, query='') {
    const body=$('#composerFeatureBody'); if(!body)return;
    const q=(query||'').trim().toLocaleLowerCase('ar');
    if(mode==='feeling'||mode==='activity'){
      const items=mode==='feeling'?COMPOSER_FEELINGS:COMPOSER_ACTIVITIES;
      body.innerHTML=`<div class="composer-feature-tabs"><button type="button" data-feature-tab="feeling" class="${mode==='feeling'?'active':''}">المشاعر</button><button type="button" data-feature-tab="activity" class="${mode==='activity'?'active':''}">النشاطات</button></div><div class="composer-feature-grid">${items.filter(x=>x[1].toLocaleLowerCase('ar').includes(q)).map(x=>composerFeatureButton(`<span class="feature-emoji">${x[0]}</span><span>${escapeHTML(x[1])}</span>`,x[1])).join('')||'<p class="composer-feature-empty">لا توجد نتائج.</p>'}</div>`;
    } else if(mode==='location'){
      const current=composerPostMeta.location_name||'';
      body.innerHTML=`<label class="composer-feature-label" for="composerLocationSearch">ابحث عن مكان قريب أو اكتب أي مكان</label><input id="composerLocationSearch" class="composer-feature-search" type="search" placeholder="اسم المكان أو العنوان" value="${escapeHTML(current)}"><button type="button" class="composer-feature-use-location" data-action="composer-use-location">استخدم موقعي الحالي</button><p class="composer-feature-note">يمكنك اختيار اسم المكان يدويًا. معاينة الخريطة ستظهر داخل المنشور بعد الحفظ.</p><div class="composer-location-map" id="composerLocationMap">${current?`<iframe title="معاينة الخريطة" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(current)}&output=embed"></iframe>`:'<div class="composer-map-placeholder">📍 ابحث عن مكان لعرض معاينة الخريطة</div>'}</div>`;
    } else if(mode==='collab'){
      if(!audienceFriendsCache.length){body.innerHTML='<p class="composer-feature-empty">جارٍ تحميل قائمة الأصدقاء…</p>';loadAudienceFriends().then(()=>renderComposerFeature('collab',$('#composerFeatureSearch')?.value||''));return;}
      body.innerHTML=`<input id="composerFeatureSearch" class="composer-feature-search" type="search" placeholder="ابحث عن صديق" value="${escapeHTML(query)}"><div class="composer-feature-friends">${audienceFriendsCache.filter(p=>`${p.name} ${p.username}`.toLocaleLowerCase('ar').includes(q)).map(p=>`<label class="composer-feature-friend"><input type="checkbox" data-tag-friend="${escapeHTML(p.id)}" ${composerPostMeta.tagged_user_ids.includes(p.id)?'checked':''}><span class="composer-feature-avatar">${p.avatar?`<img src="${escapeHTML(p.avatar)}" alt="">`:escapeHTML((p.name||'ح')[0])}</span><span>${escapeHTML(p.name)}</span></label>`).join('')||'<p class="composer-feature-empty">لا يوجد أصدقاء مطابقون.</p>'}</div>`;
    } else if(mode==='music'){
      renderAudiusMusic(query);
      if(audiusMusicView==='list')loadAudiusTracks(query);
    }
  }
  function openComposerFeature(mode) {
    composerFeatureMode=mode;
    const titles={feeling:'الشعور والنشاط',activity:'الشعور والنشاط',location:'إضافة موقع',collab:'الإشارة والتعاون',music:'الموسيقى'};
    const title=$('#composerFeatureTitle'),modal=$('#composerFeatureModal'),clear=$('[data-action="composer-feature-clear"]',modal),back=$('[data-action="composer-feature-close"]',modal);
    if(mode==='music'){if(window.__egybookStopPostMusic)window.__egybookStopPostMusic(true);title.innerHTML='<span class="audius-title-wordmark">Egy<span>Book</span></span>';modal.classList.add('is-music-page');const featureFooter=$('#composerFeatureModal footer');if(featureFooter)featureFooter.hidden=false;audiusMusicView=composerPostMeta.music_track_id?'trim':'list';audiusTrimCanRemove=!!composerPostMeta.music_track_id;audiusTrimReturnQuery=$('#composerFeatureSearch')?.value||'';audiusMusicOriginalMeta=JSON.parse(JSON.stringify(composerPostMeta));audiusMusicConfirmed=false;if(clear)clear.hidden=!audiusTrimCanRemove;if(back){back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';back.setAttribute('aria-label','رجوع إلى المنشور');}}
    else{const featureFooter=$('#composerFeatureModal footer');if(featureFooter)featureFooter.hidden=false;title.textContent=titles[mode]||'إضافة إلى المنشور';modal.classList.remove('is-music-page');if(clear)clear.hidden=false;if(back){back.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';back.setAttribute('aria-label','إغلاق');}}
    renderComposerFeature(mode);
    const featureModal=$('#composerFeatureModal');
    if(!featureModal.classList.contains('open'))pushOverlayHistory(featureModal,'composer-feature');
    openModal(featureModal);
  }
  function updateComposerIdentityPreview() {
    const hint=$('#composerHint'); if(!hint)return;
    const parts=[];
    if(composerPostMeta.feeling)parts.push('يشعر بأنه '+composerPostMeta.feeling);
    if(composerPostMeta.activity)parts.push(composerPostMeta.activity);
    if(composerPostMeta.location_name)parts.push('📍 '+composerPostMeta.location_name);
    if(composerPostMeta.tagged_user_ids.length)parts.push('مع '+composerPostMeta.tagged_user_ids.length+' من الأصدقاء');
    if(composerPostMeta.music_title)parts.push('♫ '+composerPostMeta.music_title);
    hint.textContent=parts.join(' · ')||'شارك أفكارك وصورك مع مجتمع EgyBook';
  }
  function renderPostMetadata(post, meta={}) {
    const details=[];
    if(meta.feeling)details.push(`<span class="post-context-chip">${escapeHTML(meta.feeling)}</span>`);
    if(meta.activity)details.push(`<span class="post-context-chip">${escapeHTML(meta.activity)}</span>`);
    if(meta.tagged_user_ids?.length)details.push(`<span class="post-context-chip">مع ${meta.tagged_user_ids.length} من الأصدقاء</span>`);
    if(meta.music_title){
      if(meta.music_track_id){
        const start=Math.max(0,Number(meta.music_start_seconds)||0),duration=Math.min(110,Math.max(5,Number(meta.music_duration_seconds)||30));
        details.push(`<div class="post-music-player" data-post-music-player data-track-id="${escapeHTML(meta.music_track_id)}" data-start="${start}" data-duration="${duration}" data-muted="false" aria-label="موسيقى المنشور"><span class="post-music-art">${meta.music_artwork_url?`<img src="${escapeHTML(meta.music_artwork_url)}" alt="">`:'♫'}</span><span class="post-music-copy"><strong>${escapeHTML(meta.music_title)}</strong><small>${escapeHTML(meta.music_artist||'موسيقى')}</small></span><span class="post-music-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><button type="button" data-post-music-mute aria-label="كتم الصوت" aria-pressed="false">🔊</button></div>`);
      }else details.push(`<span class="post-context-chip">♫ ${escapeHTML(meta.music_title)}${meta.music_artist?' — '+escapeHTML(meta.music_artist):''}</span>`);
    }
    if(details.length){const metaLine=$('.post-meta',post);if(metaLine){const wrap=document.createElement('div');wrap.className='post-context-details';wrap.innerHTML=details.join('');metaLine.insertAdjacentElement('afterend',wrap);}}
    if(meta.location_name){const card=document.createElement('div');card.className='post-location-card';card.innerHTML=`<div class="post-location-title">📍 ${escapeHTML(meta.location_name)}</div><iframe loading="lazy" title="خريطة موقع المنشور" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(meta.location_name)}&output=embed"></iframe>`;const media=$('.post-image',post);(media||$('.post-text',post))?.insertAdjacentElement('afterend',card);}
  }

  async function publishPost(event) {
    event?.preventDefault?.();
    if(isPublishingPost)return;
    const text=postContent.value.trim();
    const publishingMedia=selectedMedia;
    const publishingMediaItems=(selectedMediaItems&&selectedMediaItems.length?selectedMediaItems:(publishingMedia?[publishingMedia]:[])).slice();
    const publishingMeta={...composerPostMeta,tagged_user_ids:[...composerPostMeta.tagged_user_ids]};
    if(!text&&!publishingMediaItems.length&&!publishingMeta.music_track_id)return showToast('اكتب شيئًا أو أرفق صورة/فيديو أو اختر أغنية أولًا.');
    if(!supabase||!currentUser){openModal($('#supabaseAuthModal'));return showToast('سجّل الدخول أولًا لنشر المنشور.');}
    isPublishingPost=true;
    const submit=$('#publishPostActual'), audiencePublish=$('#audiencePublishPost');
    showToast('جارٍ تجهيز المنشور للنشر…');
    const originalSubmitMarkup=submit?.innerHTML;
    let publishStage='تجهيز الوسائط';
    if(submit){submit.disabled=true;submit.setAttribute('aria-busy','true');submit.innerHTML='<span>جارٍ النشر…</span><svg viewBox="0 0 24 24" aria-hidden="true" class="publish-spinner"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="36 20"/></svg>';}
    if(audiencePublish){audiencePublish.disabled=true;audiencePublish.setAttribute('aria-busy','true');}
    try{
      const uploadedMediaUrls=[];
      publishStage='رفع الصور أو الفيديو';
      for(const item of publishingMediaItems){
        let url=null;
        if(item.file)url=await uploadPostMedia(item.file,currentUser.id);
        else if(item.dataUrl){const blob=await (await fetch(item.dataUrl)).blob();const ext=item.type==='video'?'mp4':'jpg';const file=new File([blob],`upload.${ext}`,{type:blob.type||(item.type==='video'?'video/mp4':'image/jpeg')});url=await uploadPostMedia(file,currentUser.id);}
        if(url)uploadedMediaUrls.push(url);
      }
      const mediaUrl=uploadedMediaUrls[0]||null;
      publishStage='حفظ المنشور في Supabase';
      const row={user_id:currentUser.id,text,media_url:mediaUrl,media_urls:uploadedMediaUrls,media_type:publishingMedia?.type||null,visibility:$('#postVisibility').value||'عام',audience_user_ids:['أشخاص محددون'].includes(selectedAudience)?selectedAudienceIds:[],excluded_user_ids:selectedAudience==='استثناء'?excludedAudienceIds:[],audience_list_id:selectedAudience==='قائمة مخصصة'?customAudienceListId:null,feeling:publishingMeta.feeling||null,activity:publishingMeta.activity||null,location_name:publishingMeta.location_name||null,tagged_user_ids:publishingMeta.tagged_user_ids||[],music_title:publishingMeta.music_title||null,music_artist:publishingMeta.music_artist||null,music_track_id:publishingMeta.music_track_id||null,music_permalink:publishingMeta.music_permalink||null,music_artwork_url:publishingMeta.music_artwork_url||null,music_start_seconds:Number(publishingMeta.music_start_seconds)||0,music_duration_seconds:Math.min(110,Math.max(5,Number(publishingMeta.music_duration_seconds)||30))};
      const {data,error}=await supabase.from('posts').insert(row).select('id,user_id,text,media_url,media_type,visibility,created_at,updated_at,feeling,activity,location_name,tagged_user_ids,music_title,music_artist,media_urls,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds').single();
      if(error)throw error;
      const article=createPostElement({id:data.id,text:data.text,media:data.media_url,mediaType:data.media_type,visibility:data.visibility,createdAt:new Date(data.created_at).getTime(),authorName:profileData.name||currentUser.user_metadata?.full_name||'عضو EgyBook',authorAvatar:profileData.avatar||currentUser.user_metadata?.avatar_url||currentUser.user_metadata?.picture||null,feeling:data.feeling||'',activity:data.activity||'',location_name:data.location_name||'',tagged_user_ids:data.tagged_user_ids||[],music_title:data.music_title||'',music_artist:data.music_artist||'',music_track_id:data.music_track_id||'',music_permalink:data.music_permalink||'',music_artwork_url:data.music_artwork_url||'',music_start_seconds:data.music_start_seconds||0,music_duration_seconds:data.music_duration_seconds||30,media_urls:data.media_urls||uploadedMediaUrls});
      article.dataset.userPost='true';article.dataset.cloudPost='true';article.dataset.authorId=currentUser.id;article.dataset.createdAt=String(new Date(data.created_at).getTime());article.dataset.visibility=data.visibility;article.dataset.media=data.media_url||'';article.dataset.mediaType=data.media_type||'';addBadgeToUserName($('.post-author .author-name',article), data.user_id);postsList.prepend(article);
      if(data.media_url&&data.media_type==='image')recordAlbumImage('posts',data.media_url,Date.now());
      postContent.value='';selectedMedia=null;selectedMediaItems=[];composerPostMeta={feeling:'',activity:'',location_name:'',tagged_user_ids:[],music_title:'',music_artist:'',music_track_id:'',music_permalink:'',music_artwork_url:'',music_start_seconds:0,music_duration_seconds:30};$('#mediaPreview').hidden=true;$('#mediaPreview').replaceChildren();$('#createPostModal .egybook-composer-box')?.classList.remove('has-media');updateComposerIdentityPreview();updateEmptyState();playPublishSound();closeModal(createPostModal);clearComposerOverlayState();if(currentPage!=='home')setPage('home');showToast('تم النشر بنجاح');
    }catch(error){
      console.error('Supabase publish failed at '+publishStage,error);
      if(!createPostModal.classList.contains('open'))openModal(createPostModal);
      showToast(`تعذر النشر أثناء ${publishStage}: ${error.message||'تحقق من اتصال الإنترنت وصلاحيات Supabase.'} — مسودتك ما زالت محفوظة.`);
    }
    finally{
      isPublishingPost=false;
      if(submit){submit.removeAttribute('aria-busy');if(originalSubmitMarkup)submit.innerHTML=originalSubmitMarkup;}
      if(audiencePublish)audiencePublish.removeAttribute('aria-busy');
      updatePublishButton();
    }
  }
  let imageEditorOriginalData = null;
  let imageEditorDraftData = null;
  let imageEditorDirty = false;
  let imageEditorStartX = null;
  let editorHistoryReturnInProgress = false;
  const imageEditorFilterOrder = ['none','contrast','warm','mono'];
  const imageEditorFilterCss = {none:'none',contrast:'contrast(1.2) saturate(1.08)',warm:'sepia(.22) saturate(1.18)',mono:'grayscale(1)'};
  function updateEditorPreview(){
    const im=$('#imageEditorImage');
    if(im){im.style.filter=imageEditorFilterCss[imageEditorFilter]||'none';im.style.transform=`rotate(${imageEditorRotation}deg)`;}
    const note=$('.image-editor-note'); if(note)note.textContent=imageEditorDirty?'توجد تعديلات غير محفوظة — اضغط «تم» لحفظها.':'لم تُجرَ تعديلات بعد.';
    $('#imageEditorModal')?.classList.toggle('has-unsaved-edits',imageEditorDirty);
    document.querySelectorAll('#imageEditorFilters [data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===imageEditorFilter)));
  }
  function openImageEditor(){
    if(!selectedMedia||selectedMedia.type!=="image")return;
    imageEditorOriginalData=selectedMedia.dataUrl; imageEditorDraftData=selectedMedia.dataUrl;
    imageEditorDirty=false; imageEditorRotation=0; imageEditorFilter='none';
    const img=$('#imageEditorImage'); if(!img)return;
    img.src=imageEditorDraftData; img.style.transform='rotate(0deg)';img.style.filter='none';
    $('#imageEditorFilters')?.classList.remove('show');
    updateEditorPreview();
    openModal($('#imageEditorModal'));
    // Add one history layer so Android/browser back returns to the composer, not the home page.
    try { if (!history.state?.egybookImageEditor) history.pushState({ ...(history.state||{}), egybookImageEditor:true }, '', location.href); } catch (_) {}
    // Keep the editor as a single isolated layer above the composer.
    $('#imageEditorModal').style.zIndex='1800';
  }
  function openEgyBookVideo(src){const modal=$('#egybookVideoModal'),player=$('#egybookVideoPlayer');if(!modal||!player||!src)return;player.src=src;player.onloadedmetadata=()=>{if(player.videoWidth&&player.videoHeight)player.style.aspectRatio=`${player.videoWidth} / ${player.videoHeight}`;};openModal(modal);}
  function closeEgyBookVideo(){const p=$('#egybookVideoPlayer');if(p){p.pause();p.removeAttribute('src');p.load();}closeModal($('#egybookVideoModal'));}
  function discardImageEditorChanges(){
    imageEditorDraftData=imageEditorOriginalData; imageEditorDirty=false;
    closeModal($('#imageEditorModal')); imageEditorStartX=null;
    // Never close the composer when leaving the editor; it remains the single parent screen.
    if(createPostModal && !createPostModal.classList.contains('open')) openModal(createPostModal);
  }
  function requestCloseImageEditor(){
    if(imageEditorDirty){ openEditorDiscardSheet(); return false; }
    const shouldConsumeEditorEntry=!!history.state?.egybookImageEditor;
    discardImageEditorChanges();
    if(shouldConsumeEditorEntry){editorHistoryReturnInProgress=true;try{history.back();}catch(_){editorHistoryReturnInProgress=false;}}
    return true;
  }
  function openEditorDiscardSheet(){
    const sheet=$('#composerDiscardModal'); if(!sheet)return;
    // This sheet must remain interactive even while the page behind it is inert.
    sheet.inert=false;
    sheet.removeAttribute('aria-hidden');
    sheet.hidden=false;
    sheet.style.pointerEvents='auto';
    sheet.style.zIndex='2147483000';
    sheet.classList.add('open');
    document.body.classList.add('egybook-discard-sheet-open');
    const panel=sheet.querySelector('.composer-discard-sheet');
    if(panel){
      panel.style.transition='none';
      panel.style.transform='translateY(105%)';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        panel.style.transition='transform .28s cubic-bezier(.2,.8,.2,1)';
        panel.style.transform='translateY(0)';
      }));
    }
  }
  function closeEditorDiscardSheet(){
    const sheet=$('#composerDiscardModal'); if(!sheet)return;
    const panel=sheet.querySelector('.composer-discard-sheet');
    if(panel){
      panel.style.transition='transform .22s cubic-bezier(.2,.8,.2,1)';
      panel.style.transform='translateY(105%)';
    }
    document.body.classList.remove('egybook-discard-sheet-open');
    setTimeout(()=>{
      sheet.classList.remove('open');
      sheet.hidden=true;
      sheet.style.pointerEvents='';
      if(panel)panel.style.transform='';
    },220);
  }
  function confirmDiscardEditorChanges(){
    closeEditorDiscardSheet();
    // Discard only the editor draft. selectedMedia still contains the original image.
    imageEditorDraftData=imageEditorOriginalData; imageEditorDirty=false;
    const state={...(history.state||{})}; delete state.egybookImageEditor;
    try{history.replaceState(state,'',location.href);}catch(_){}
    closeModal($('#imageEditorModal')); imageEditorStartX=null;
    if(createPostModal && !createPostModal.classList.contains('open')) openModal(createPostModal);
    syncComposerIsolation();
  }
  // Independent bottom sheet: buttons always work; only the grabber starts a drag.
  (()=>{
    const sheet=$('#composerDiscardModal'),panel=sheet?.querySelector('.composer-discard-sheet'),handle=sheet?.querySelector('.discard-sheet-grabber');
    if(!sheet||!panel)return;
    let startY=0,lastY=0,dragging=false,pointerId=null;
    const begin=e=>{
      if(!sheet.classList.contains('open'))return;
      if(e.target.closest('button'))return;
      // Drag is initiated only from the handle/top strip, never from the buttons.
      const r=handle?.getBoundingClientRect();
      if(!r || e.clientY>r.bottom+16)return;
      startY=lastY=e.clientY;dragging=true;pointerId=e.pointerId;
      panel.style.transition='none';
      try{panel.setPointerCapture(e.pointerId);}catch(_){}
      e.preventDefault();
    };
    panel.addEventListener('pointerdown',begin);
    panel.addEventListener('pointermove',e=>{
      if(!dragging||e.pointerId!==pointerId)return;
      lastY=e.clientY;
      panel.style.transform=`translateY(${Math.max(0,lastY-startY)}px)`;
    });
    const finish=e=>{
      if(!dragging|| (e.pointerId!==undefined && e.pointerId!==pointerId))return;
      dragging=false;pointerId=null;
      const dy=Math.max(0,lastY-startY);
      panel.style.transition='transform .24s cubic-bezier(.2,.8,.2,1)';
      if(dy>105){
        panel.style.transform='translateY(105%)';
        setTimeout(()=>{
          sheet.classList.remove('open');sheet.hidden=true;sheet.style.pointerEvents='';
          document.body.classList.remove('egybook-discard-sheet-open');
          panel.style.transform='';
        },230);
      } else panel.style.transform='translateY(0)';
    };
    panel.addEventListener('pointerup',finish);
    panel.addEventListener('pointercancel',finish);
    sheet.addEventListener('click',e=>{if(e.target===sheet)closeEditorDiscardSheet();});
    sheet.querySelector('[data-action="editor-discard-continue"]')?.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();closeEditorDiscardSheet();
    });
    sheet.querySelector('[data-action="editor-discard-confirm"]')?.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();confirmDiscardEditorChanges();
    });
  })();
  async function applyImageEditor(){
    if(!selectedMedia||selectedMedia.type!=="image")return;
    try{
      const source=new Image();source.src=imageEditorOriginalData||selectedMedia.dataUrl;
      await new Promise((resolve,reject)=>{if(source.complete&&source.naturalWidth)return resolve();source.onload=resolve;source.onerror=reject;});
      const sideways=Math.abs(imageEditorRotation)%180===90;
      const canvas=document.createElement('canvas');canvas.width=sideways?source.naturalHeight:source.naturalWidth;canvas.height=sideways?source.naturalWidth:source.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(imageEditorRotation*Math.PI/180);ctx.filter=imageEditorFilterCss[imageEditorFilter]||'none';ctx.drawImage(source,-source.naturalWidth/2,-source.naturalHeight/2);ctx.restore();
      const dataUrl=canvas.toDataURL('image/jpeg',.92);
      selectedMedia={...selectedMedia,dataUrl,file:null};
      const preview=$('#mediaPreview')?.querySelector('.media-preview-content img');if(preview)preview.src=dataUrl;
      imageEditorOriginalData=dataUrl;imageEditorDraftData=dataUrl;imageEditorDirty=false;
      $('#imageEditorFilters')?.classList.remove('show');
      // Keep the composer as the active parent screen and consume only the editor's
      // temporary history entry. The popstate guard below prevents other global
      // handlers from closing the composer or routing to Home/Profile.
      editorHistoryReturnInProgress = !!history.state?.egybookImageEditor;
      closeModal($('#imageEditorModal'));
      if (createPostModal && !createPostModal.classList.contains('open')) openModal(createPostModal);
      syncComposerIsolation();
      imageEditorStartX=null;
      if (editorHistoryReturnInProgress) {
        try { history.back(); } catch (_) { editorHistoryReturnInProgress = false; }
      }
      showToast('تم حفظ تعديلات الصورة والعودة إلى المنشور.');
    }catch(e){console.error('Image editing failed',e);showToast('تعذر حفظ تعديلات الصورة. حاول مرة أخرى.');}
  }
  document.addEventListener('click',event=>{
    const discardAction=event.target.closest('[data-action]')?.dataset.action;
    const tool=event.target.closest('[data-editor-tool]');
    if(tool){const a=tool.dataset.editorTool;
      if(a==='rotate'){imageEditorRotation=(imageEditorRotation+90)%360;imageEditorDirty=true;updateEditorPreview();}
      if(a==='crop')showToast('أداة القص سيتم استكمالها في مرحلة القص المتقدم.');
      if(a==='filter')$('#imageEditorFilters')?.classList.toggle('show');
    }
    const f=event.target.closest('[data-filter]');
    if(f){imageEditorFilter=f.dataset.filter;imageEditorDirty=true;updateEditorPreview();}
    const a=event.target.closest('[data-action]')?.dataset.action;
    if(a==='image-editor-cancel')requestCloseImageEditor();
    if(a==='image-editor-apply')applyImageEditor();
    if(a==='video-viewer-close')closeEgyBookVideo();
  },true);
  const editorStage=$('#imageEditorModal .image-editor-stage');
  if(editorStage){
    editorStage.addEventListener('touchstart',e=>{imageEditorStartX=e.touches?.[0]?.clientX??null;},{passive:true});
    editorStage.addEventListener('touchend',e=>{if(imageEditorStartX===null)return;const dx=(e.changedTouches?.[0]?.clientX??imageEditorStartX)-imageEditorStartX;imageEditorStartX=null;if(Math.abs(dx)<35)return;const i=imageEditorFilterOrder.indexOf(imageEditorFilter);imageEditorFilter=imageEditorFilterOrder[(i+(dx<0?1:-1)+imageEditorFilterOrder.length)%imageEditorFilterOrder.length];imageEditorDirty=true;updateEditorPreview();showToast('التأثير: '+({none:'أصلي',contrast:'تباين',warm:'دافئ',mono:'أبيض وأسود'}[imageEditorFilter]));},{passive:true});
    let mouseStartX=null;editorStage.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')mouseStartX=e.clientX;});editorStage.addEventListener('pointerup',e=>{if(mouseStartX===null)return;const dx=e.clientX-mouseStartX;mouseStartX=null;if(Math.abs(dx)<55)return;const i=imageEditorFilterOrder.indexOf(imageEditorFilter);imageEditorFilter=imageEditorFilterOrder[(i+(dx<0?1:-1)+imageEditorFilterOrder.length)%imageEditorFilterOrder.length];imageEditorDirty=true;updateEditorPreview();});
  }
  // Escape/back gesture closes only the editor first and asks before losing edits.
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#imageEditorModal')?.classList.contains('open')){event.stopImmediatePropagation();event.preventDefault();requestCloseImageEditor();}},true);
  window.addEventListener('popstate',event=>{
    // A confirmed "Done" consumes the editor-only history entry. Do not allow
    // later global popstate listeners to close the composer or change its route.
    if(editorHistoryReturnInProgress){
      editorHistoryReturnInProgress=false;
      event.stopImmediatePropagation();
      if(createPostModal && !createPostModal.classList.contains('open')) openModal(createPostModal);
      syncComposerIsolation();
      return;
    }
    const editor=$('#imageEditorModal');
    if(!editor?.classList.contains('open')) return;
    if(imageEditorDirty){
      openEditorDiscardSheet();
      try{history.pushState({...(history.state||{}),egybookImageEditor:true},'',location.href);}catch(_){}
      event.stopImmediatePropagation();
      return;
    }
    imageEditorDraftData=imageEditorOriginalData; imageEditorDirty=false;
    closeModal(editor); imageEditorStartX=null;
    if(createPostModal && !createPostModal.classList.contains('open')) openModal(createPostModal);
    syncComposerIsolation();
    event.stopImmediatePropagation();
  });
  $('#composerDiscardModal')?.addEventListener('click',event=>{if(event.target===$('#composerDiscardModal'))closeEditorDiscardSheet();});
  $('#imageEditorModal')?.addEventListener('click',event=>{if(event.target===$('#imageEditorModal')){event.stopPropagation();requestCloseImageEditor();}},true);
  document.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action==='media-remove'){selectedMedia=null;selectedMediaItems=[];const preview=$('#mediaPreview');if(preview){preview.hidden=true;const c=preview.querySelector('.media-preview-content');if(c)c.replaceChildren();}$('#createPostModal .egybook-composer-box')?.classList.remove('has-media');updatePublishButton();}const removeIndex=event.target.closest('[data-media-remove-index]');if(removeIndex){const idx=Number(removeIndex.dataset.mediaRemoveIndex);selectedMediaItems.splice(idx,1);selectedMedia=selectedMediaItems[0]||null;const preview=$('#mediaPreview');const content=preview?.querySelector('.media-preview-content');if(!selectedMediaItems.length){if(preview)preview.hidden=true;if(content)content.replaceChildren();$('#createPostModal .egybook-composer-box')?.classList.remove('has-media');}else{if(content)content.replaceChildren();selectedMediaItems.forEach((entry,index)=>{const card=document.createElement('div');card.className='composer-media-item-card';const label=document.createElement('div');label.className='media-preview-label';label.textContent=entry.file?.name||`صورة ${index+1}`;const media=document.createElement(entry.type==='image'?'img':'video');media.src=entry.dataUrl;media.className='composer-media-preview-item';const del=document.createElement('button');del.type='button';del.className='composer-media-item-remove';del.dataset.mediaRemoveIndex=String(index);del.setAttribute('aria-label','حذف هذه الصورة');del.textContent='×';card.append(label,media,del);content?.append(card);});}updatePublishButton();return;}if(action==='media-change'){if(selectedMedia?.type==='video')videoInput.click();else photoInput.click();}if(action==='media-edit')openImageEditor();});
  async function readMedia(file, type) {
    if (!file) return;
    const maxBytes = type==='image' ? 12*1024*1024 : 2*1024*1024;
    if (file.size > maxBytes) { showToast(type==='image'?'حجم الصورة كبير جدًا؛ اختر صورة أقل من 12 ميجابايت.':'حجم الفيديو كبير؛ اختر فيديو أصغر من 2 ميجابايت.'); return; }
    try{
      const dataUrl=type==='image'?await compressImage(file,1280,0.72):await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
      const item={dataUrl,type,file};
      if(type==='image'){
        if(!Array.isArray(selectedMediaItems))selectedMediaItems=[];
        selectedMediaItems.push(item);selectedMedia=selectedMediaItems[0]||item;
      }else{selectedMediaItems=[item];selectedMedia=item;}
      const preview=$('#mediaPreview');const content=preview.querySelector('.media-preview-content')||preview;content.replaceChildren();preview.hidden=false;
      selectedMediaItems.forEach((entry,index)=>{
        const card=document.createElement('div');card.className='composer-media-item-card';card.dataset.mediaIndex=String(index);
        const label=document.createElement('div');label.className='media-preview-label';label.textContent=entry.file?.name||`صورة ${index+1}`;card.append(label);
        const media=document.createElement(entry.type==='image'?'img':'video');media.src=entry.dataUrl;media.className='composer-media-preview-item';
        if(entry.type==='video'){media.controls=true;media.playsInline=true;media.addEventListener('click',()=>openEgyBookVideo(entry.dataUrl));}
        else{media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label','اضغط على الصورة لتعديلها');media.addEventListener('click',()=>{selectedMedia=entry;openImageEditor();});}
        const remove=document.createElement('button');remove.type='button';remove.className='composer-media-item-remove';remove.dataset.mediaRemoveIndex=String(index);remove.setAttribute('aria-label','حذف هذه الصورة');remove.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13"/></svg>';
        card.append(media,remove);content.append(card);
      });
      $('#createPostModal .egybook-composer-box')?.classList.add('has-media');showToast(type==='image'?'تمت إضافة الصورة. يمكنك إضافة صور أخرى.':'تمت إضافة الفيديو.');updatePublishButton();
      if(!createPostModal.classList.contains('open'))openModal(createPostModal);
    }catch(_){showToast('تعذر قراءة الملف. حاول مرة أخرى.');}
  }
  let currentPage = 'home';
  let messagesCurrentTab = 'all';
  let activeMessagePeer = null;
  let messageThreadFromProfile = false;
  let directMessageRows = [];
  let directMessagesLoadedFor = null;
  let directMessagesLoading = null;
  let messageOrigin = { page: 'messages', username: null, scrollY: 0 };
  let messageRealtimeChannel = null;
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
  let profileLoadingTimer = null;
  let relationshipLoadToken = 0;
  let routePostId = null;
  let postRouteOpenToken = 0;
  function cleanUsername(value){
    return String(value || 'egybook_user').trim().replace(/^@+/, '').replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase() || 'egybook_user';
  }
  function profilePath(username=profileData.username){
    return SITE_BASE_PATH + encodeURIComponent(cleanUsername(username));
  }
  function postPath(postId){ return POST_ROUTE_BASE + encodeURIComponent(String(postId || '')); }
  function syncHeaderProfileUsername(){ /* Topbar account chip intentionally removed. */ }
  function routeToProfile(username=profileData.username, {push=true, scroll=true}={}){
    if(window.__egybookStopPostMusic)window.__egybookStopPostMusic(true);

    postRouteOpenToken++; // Cancel any pending post-route retry before switching surfaces.
    closeNotifications();
    const messagesPage=$('#messagesPage');if(messagesPage)messagesPage.hidden=true;
    const friendsDirectory=$('#friendsDirectoryPage');if(friendsDirectory)friendsDirectory.hidden=true;
    const normalized=cleanUsername(username);
    if(push && location.pathname.replace(/\/$/,'')!==profilePath(normalized).replace(/\/$/,'')){
      history.pushState({page:'profile',username:normalized},'',profilePath(normalized));
    }
    closeModal($('#commentsModal'));restoreCommentsSheetToModal();document.body.classList.remove('post-route-open');const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
    $('#memezPage').hidden=true;
    currentPage='profile'; publicProfileUsername=normalized;
    profileLoadToken++; // Ignore late responses from a previously viewed account.
    const ownByUsername = normalized===cleanUsername(profileData.username) && !!currentUser;
    publicProfileId = ownByUsername ? currentUser.id : null;
    publicProfileIsOwn = ownByUsername;
    const profileComposer=$('.profile-create-post');
    if(profileComposer)profileComposer.hidden=!ownByUsername;
    publicProfileData = ownByUsername ? {...profileData, id:currentUser.id} : null;
    // Reset previous user's visible data while the requested profile is loading.
    if(!publicProfileIsOwn){
      // Show the requested username immediately; only show a loading hint if the
      // network request is genuinely slow, avoiding a one-frame Arabic loading flash.
      $('#profileNameText').textContent=normalized;
      $('.profile-handle').textContent='@'+normalized;
      $('.profile-bio').textContent='';
      renderProfileMood('');
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
    loadProfileFriends(publicProfileId); updateViewedProfilePresence();
    if(scroll)window.scrollTo({top:0,behavior:'auto'});
    updateProfileActionVisibility();
    if(normalized!==cleanUsername(profileData.username)) loadPublicProfileByUsername(normalized);
  }

  let profileFriendsToken=0;
  const profileFriendsHtmlCache=new Map();
  async function loadProfileFriends(ownerId){
    const grid=$('#profileFriendsGrid');if(!grid)return;
    const token=++profileFriendsToken;
    const countNode=$('#profileFriendsCount');
    // Restore the exact owner's last rendered friends immediately on revisit.
    if(ownerId && grid.dataset.ownerId!==String(ownerId) && profileFriendsHtmlCache.has(String(ownerId))){
      const cached=profileFriendsHtmlCache.get(String(ownerId));
      grid.innerHTML=cached.html;grid.dataset.ownerId=String(ownerId);grid.dataset.loaded='true';
      if(countNode)countNode.textContent=String(cached.count);
    }
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
      // Clear the previous owner's cards immediately (never show another
      // account's friends), but delay the loading label to avoid a one-frame flash.
      grid.replaceChildren();
      setTimeout(()=>{
        if(token!==profileFriendsToken || grid.dataset.ownerId!==String(ownerId) || grid.children.length)return;
        const loading=document.createElement('p');loading.className='profile-friends-empty profile-loading-placeholder';loading.textContent='جارٍ تحميل الأصدقاء…';grid.append(loading);
      },220);
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
        let result=await supabase.from('profiles').select('id,full_name,username,avatar_url,last_seen_at,activity_privacy').in('id',ids);
        if(result.error && /last_seen_at|activity_privacy|column|schema cache/i.test(String(result.error.message||''))) result=await supabase.from('profiles').select('id,full_name,username,avatar_url,last_seen_at').in('id',ids);
        if(result.error && /last_seen_at|column|schema cache/i.test(String(result.error.message||''))) result=await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',ids);
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
        const empty=document.createElement('p');empty.className='profile-friends-empty';empty.textContent='لا يوجد أصدقاء مضافون حتى الآن.';grid.append(empty);profileFriendsHtmlCache.set(String(ownerId),{html:grid.innerHTML,count:0,savedAt:Date.now()});return;
      }
      people.slice(0,8).forEach(person=>{
        const card=document.createElement('button');card.type='button';card.className='profile-friend-tile';card.dataset.action='directory-open-profile';card.dataset.username=person.username||'';
        const avatarWrap=document.createElement('span');avatarWrap.className='friend-avatar-wrap';
        if(person.avatar_url){const img=document.createElement('img');img.src=person.avatar_url;img.alt='';img.loading='lazy';avatarWrap.append(img);}
        else{const avatar=document.createElement('span');avatar.className='profile-friend-fallback';avatar.textContent=(person.full_name||person.username||'؟').charAt(0);avatarWrap.append(avatar);}
        const onlineDot=document.createElement('span');onlineDot.className='profile-online-dot';onlineDot.hidden=!(onlineUserIds.has(String(person.id))&&person.activity_privacy!=='private'&&person.activity_privacy!=='hidden');avatarWrap.append(onlineDot);card.append(avatarWrap);
        const name=document.createElement('span');name.textContent=person.full_name||person.username||'مستخدم';card.append(name);
        const status=document.createElement('span');status.className='profile-friend-status';
        const canShowPresence=Boolean(currentUser&&String(ownerId)===String(currentUser.id)&&['friends','public'].includes(person.activity_privacy));
        status.hidden=!canShowPresence;
        if(canShowPresence){status.dataset.presenceUserId=String(person.id||'');status.dataset.lastSeenAt=person.last_seen_at||'';renderPresenceLabel(status,person.id,person.last_seen_at);}
        card.append(status);grid.append(card);
      });
      profileFriendsHtmlCache.set(String(ownerId),{html:grid.innerHTML,count:people.length,savedAt:Date.now()});
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
    // Camera controls are exclusive to the signed-in account; image preview remains available to everyone.
    $$('.profile-camera-button').forEach(button=>{button.hidden=!isOwn;button.setAttribute('aria-hidden',String(!isOwn));});
    const menu=$('#profileMenuDrawer');
    if(menu){
      menu.querySelectorAll('[data-action="edit-profile"],[data-action="profile-menu-verified"],[data-action="profile-menu-archive"],[data-action="profile-menu-activity"],[data-action="profile-menu-review"],[data-action="profile-menu-privacy"]').forEach(button=>{button.hidden=!isOwn;});
      const heading=menu.querySelector('.profile-menu-heading strong');if(heading)heading.textContent=isOwn?'إعدادات الملف الشخصي':'خيارات الملف الشخصي';
      const viewButton=menu.querySelector('[data-action="profile-menu-view"]');if(viewButton)viewButton.hidden=!isOwn;
    }
    const buttons=$('.profile-buttons');
    if(!buttons)return;
    buttons.querySelectorAll('[data-action="profile-relationship"],[data-action="profile-follow"],[data-action="profile-message"]').forEach(button=>button.remove());
    if(isOwn)return;
    const friend=document.createElement('button');
    friend.type='button'; friend.className='profile-edit-button profile-relationship-button';
    friend.dataset.action='profile-relationship'; friend.textContent='＋ إضافة صديق';
    const message=document.createElement('button');
    message.type='button'; message.className='profile-secondary-button profile-message-button';
    message.dataset.action='profile-message'; message.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8l-5.5 3v-3H4A2.5 2.5 0 0 1 1.5 16V7A2.5 2.5 0 0 1 4 4.5Z"/></svg><span>مراسلة</span>';
    const follow=document.createElement('button');
    follow.type='button'; follow.className='profile-secondary-button profile-follow-button';
    follow.dataset.action='profile-follow'; follow.textContent='＋ متابعة';
    buttons.insertBefore(follow,buttons.firstChild);
    buttons.insertBefore(message,buttons.firstChild);
    buttons.insertBefore(friend,buttons.firstChild);
    loadProfileRelationship();
    refreshViewedProfileVerification();
  }
  async function openFollowersList(){
    if(!currentUser||!supabase){showToast('سجّل الدخول لعرض قائمة المتابعين.');openModal($('#supabaseAuthModal'));return;}
    const targetId=publicProfileId||currentUser.id,modal=$('#followersListModal'),body=$('#followersListBody');
    if(!modal||!body)return;
    body.innerHTML='<p class="followers-list-status">جارٍ تحميل المتابعين…</p>';openModal(modal);
    try{
      const {data:links,error}=await supabase.from('user_follows').select('follower_id,created_at').eq('following_id',targetId).order('created_at',{ascending:false}).limit(100);
      if(error)throw error;
      const ids=[...new Set((links||[]).map(row=>row.follower_id).filter(Boolean))];
      const countNode=$('#profileFollowersCount');if(countNode&&targetId===(publicProfileId||currentUser.id))countNode.textContent=String(ids.length);
      if(!ids.length){body.innerHTML='<p class="followers-list-status">لسه مفيش متابعين ظاهرين للحساب ده.</p>';return;}
      const {data:profiles,error:profilesError}=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',ids);
      if(profilesError)throw profilesError;
      const map=new Map((profiles||[]).map(p=>[p.id,p]));
      body.innerHTML=ids.map(id=>{
        const p=map.get(id);if(!p)return '';
        const name=p.full_name||p.username||'عضو EgyBook';
        const avatar=p.avatar_url?`<img src="${escapeHTML(p.avatar_url)}" alt="">`:`<span>${escapeHTML(name.trim().slice(0,1)||'ح')}</span>`;
        return `<button type="button" class="follower-row" data-action="open-follower-profile" data-username="${escapeHTML(p.username||'')}">${avatar}<span><strong>${escapeHTML(name)}</strong><small>@${escapeHTML(p.username||'member')}</small></span><b>›</b></button>`;
      }).join('')||'<p class="followers-list-status">تعذر العثور على ملفات المتابعين.</p>';
    }catch(error){
      console.warn('Followers list load failed',error);
      body.innerHTML='<p class="followers-list-status">تعذر تحميل المتابعين. تحقق من صلاحيات جدول user_follows وprofiles.</p>';
    }
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
  function ensureCommentsSheetInModal(){
    const modal=$('#commentsModal'),sheet=modal?.querySelector('.comments-sheet');
    if(modal&&sheet&&sheet.parentElement!==modal)modal.append(sheet);
    if(modal)modal.hidden=true;
  }
  function mountCommentsSheetInPostViewer(){
    const viewer=ensurePostViewer(),host=$('#postViewerComments'),modal=$('#commentsModal');
    const sheet=modal?.querySelector('.comments-sheet')||viewer.querySelector('.comments-sheet');
    if(host&&sheet&&sheet.parentElement!==host)host.append(sheet);
    if(modal){modal.classList.remove('open');modal.hidden=true;}
    return sheet;
  }
  function restoreCommentsSheetToModal(){
    const modal=$('#commentsModal'),host=$('#postViewerComments');
    const sheet=host?.querySelector('.comments-sheet');
    if(modal&&sheet&&sheet.parentElement!==modal)modal.append(sheet);
    if(host)host.replaceChildren();
    if(modal){modal.classList.remove('open');modal.hidden=true;}
  }
  function ensurePostViewer(){
    let viewer=$('#postViewer');
    if(viewer)return viewer;
    viewer=document.createElement('section');viewer.id='postViewer';viewer.className='post-viewer';viewer.hidden=true;viewer.setAttribute('aria-label','المنشور والتعليقات');
    viewer.innerHTML='<div class="post-viewer-content" id="postViewerContent"></div><section class="post-viewer-comments" id="postViewerComments" aria-label="تعليقات المنشور"></section>'; 
    document.body.append(viewer);return viewer;
  }
  function openPostRoute(postId,{push=true,attempt=0,commentId=null,token=null}={}){
    if(!postId)return;
    if(token===null)token=++postRouteOpenToken;
    if(token!==postRouteOpenToken)return;
    const post=$(`[data-post-id="${CSS.escape(String(postId))}"]`,postsList);
    if(!post){
      if(attempt<12){setTimeout(()=>{if(token!==postRouteOpenToken)return;const retry=()=>openPostRoute(postId,{push,attempt:attempt+1,commentId,token});if(supabase&&currentUser&&attempt===0)restorePosts().finally(retry);else retry();},350);}
      else showToast('المنشور المطلوب غير متاح أو لم يتم تحميله.');
      return;
    }
    routePostId=String(postId);activeCommentsPost=post;highlightCommentId=commentId?String(commentId):null;replyToComment=null;
    document.body.classList.add('post-route-open');
    if(push&&location.pathname!==postPath(postId))history.pushState({page:'post',postId:String(postId),commentId:commentId||null},'',postPath(postId));
    // A post route is a full route, not a modal layered over another page.
    // Hide every route surface before mounting the post and the reusable comments UI.
    ['#profilePage','#messagesPage','#memezPage','#notificationsPage','#reelsPage',
     '#friendsDirectoryPage','#peopleSearchPage'].forEach(selector=>{
      const surface=$(selector);if(surface)surface.hidden=true;
    });
    $('.container').hidden=true;
    closeModal($('#commentsModal'));
    const imageViewer=$('#imageViewer');if(imageViewer){imageViewer.hidden=true;document.body.classList.remove('image-viewer-open');}
    const viewer=ensurePostViewer(),content=$('#postViewerContent');content.replaceChildren();
    const clone=post.cloneNode(true);clone.classList.add('post-viewer-post');clone.dataset.viewerClone='true';clone.querySelectorAll('.comments-area').forEach(el=>el.remove());
    const media=clone.querySelector('.post-image');
    if(media){media.classList.add('post-viewer-image');media.removeAttribute('data-action');if(media.tagName==='IMG'){media.removeAttribute('loading');media.decoding='async';}}
    const more=clone.querySelector('[data-action="post-menu"]');if(more)more.remove();
    content.append(clone);
    mountCommentsSheetInPostViewer();
    const input=$('#commentInput');if(input){input.blur();input.value='';input.placeholder=`تعليق باسم ${getActiveProfileName()} ...`;}
    const sortMenu=$('#commentsSortMenu');if(sortMenu)sortMenu.hidden=true;
    const sortButton=$('#commentsSortButton');if(sortButton)sortButton.setAttribute('aria-expanded','false');
    renderComments();
    loadCloudComments(post);
    viewer.hidden=false;window.scrollTo({top:0,behavior:'auto'});
    if(window.__egybookAnimateRouteSurface)window.__egybookAnimateRouteSurface(viewer);
    if(commentId){setTimeout(()=>{const target=$(`[data-comment-id="${CSS.escape(String(commentId))}"]`,$('#postViewerComments'));if(target)target.scrollIntoView({behavior:'smooth',block:'center'});},120);}
  }
  function closePostViewer({home=true}={}){
    postRouteOpenToken++;
    const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
    restoreCommentsSheetToModal();
    document.body.classList.remove('post-route-open');routePostId=null;activeCommentsPost=null;highlightCommentId=null;
    if(home){history.pushState({page:'home'},'','/Egybook/');setPage('home',{push:false});}
  }
  async function showPostReactions(post){
    if(!post)return;
    const postId=String(post.dataset.postId||'');
    let modal=$('#postReactionsModal');
    if(!modal){
      modal=document.createElement('section');modal.id='postReactionsModal';modal.className='modal reaction-details-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','تفاصيل التفاعلات');
      modal.innerHTML=`<div class="reaction-details-sheet">
        <div class="comments-handle"></div>
        <header class="reaction-details-head">
          <span class="reaction-details-head-spacer" aria-hidden="true"></span>
          <h2>التفاعلات</h2>
          <button type="button" class="comments-close" data-action="close-modal" aria-label="إغلاق">×</button>
        </header>
        <div class="reaction-details-filter" id="reactionDetailsFilterBar" aria-label="أنواع التفاعلات"><button type="button" class="reaction-filter-chip active" data-reaction-filter="all">الكل <strong id="reactionFilterAllCount">0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="👍" aria-label="إعجاب">👍 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="❤️" aria-label="حب">❤️ <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😍" aria-label="أحببته">😍 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😂" aria-label="مضحك">😂 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😮" aria-label="واو">😮 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😢" aria-label="حزين">😢 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😡" aria-label="غاضب">😡 <strong>0</strong></button></div>
        <div id="postReactionsList" class="reaction-details-list" aria-live="polite"></div>
      </div>`;
      document.body.append(modal);
    }
    modal.dataset.postId=postId;
    const list=$('#postReactionsList');list.replaceChildren();
    const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التفاعلات…';list.append(loading);
    const filterBar=$('#reactionDetailsFilterBar');
    const reactionFilterValues=['all','👍','❤️','😍','😂','😮','😢','😡'];
    const applyReactionFilter=(value)=>{
      if(!filterBar)return;
      filterBar.querySelectorAll('[data-reaction-filter]').forEach(chip=>{const active=chip.dataset.reactionFilter===value;chip.classList.toggle('active',active);chip.setAttribute('aria-pressed',String(active));});
      $$('.reaction-person-row',list).forEach(row=>{row.hidden=value!=='all'&&row.dataset.reactionEmoji!==value;});
      filterBar.dataset.activeFilter=value;
    };
    if(filterBar){filterBar.dataset.activeFilter='all';filterBar.onclick=event=>{const chip=event.target.closest('[data-reaction-filter]');if(chip)applyReactionFilter(chip.dataset.reactionFilter||'all');};
      if(!filterBar.dataset.swipeReady){filterBar.dataset.swipeReady='1';let startY=null;filterBar.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')return;startY=event.clientY;},{passive:true});filterBar.addEventListener('pointerup',event=>{if(startY===null)return;const dy=event.clientY-startY;startY=null;if(Math.abs(dy)<42)return;const current=filterBar.dataset.activeFilter||'all',index=Math.max(0,reactionFilterValues.indexOf(current));const next=Math.max(0,Math.min(reactionFilterValues.length-1,index+(dy<0?1:-1)));applyReactionFilter(reactionFilterValues[next]);},{passive:true});filterBar.addEventListener('pointercancel',()=>{startY=null;},{passive:true});let touchStartY=null;filterBar.addEventListener('touchstart',event=>{touchStartY=event.touches?.[0]?.clientY??null;},{passive:true});filterBar.addEventListener('touchend',event=>{if(touchStartY===null)return;const dy=(event.changedTouches?.[0]?.clientY??touchStartY)-touchStartY;touchStartY=null;if(Math.abs(dy)<42)return;const current=filterBar.dataset.activeFilter||'all',index=Math.max(0,reactionFilterValues.indexOf(current));const next=Math.max(0,Math.min(reactionFilterValues.length-1,index+(dy<0?1:-1)));applyReactionFilter(reactionFilterValues[next]);},{passive:true});filterBar.addEventListener('touchcancel',()=>{touchStartY=null;},{passive:true});}
    }
    pushOverlayHistory(modal,'reactions');
    openModal(modal);
    const count=$('#reactionDetailsCount'),commentCount=$('#reactionDetailsCommentCount');
    if(count)count.textContent='…';
    if(commentCount){const stats=$('.post-stats',post);commentCount.textContent=stats?.querySelector('[data-action="comments-open"]')?.textContent||'التعليقات';}
    if(!supabase||!postId){
      list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='لا يمكن تحميل التفاعلات حاليًا. تحقق من الاتصال بالإنترنت.';list.append(msg);if(count)count.textContent='0';return;
    }
    try{
      const {data,error}=await supabase.from('post_reactions').select('user_id,reaction,created_at,profiles(full_name,username,avatar_url)').eq('post_id',postId).order('created_at',{ascending:false});
      if(error)throw error;
      list.replaceChildren();if(count)count.textContent=String(data?.length||0);
      if(!data?.length){const empty=document.createElement('p');empty.className='empty-message';empty.textContent='لا توجد تفاعلات مسجلة لهذا المنشور حتى الآن.';list.append(empty);return;}
      data.forEach(row=>{
        const el=document.createElement('div');el.className='reaction-person-row';
        const profile=Array.isArray(row.profiles)?(row.profiles[0]||{}):(row.profiles||{});
        const reaction=String(row.reaction||'👍');
        const kind=/❤️|❤|love|حب/i.test(reaction)?'love':/👍|like|إعجاب/i.test(reaction)?'like':'other';
        el.dataset.reactionKind=kind;el.dataset.reactionEmoji=reaction;
        const avatar=document.createElement('span');avatar.className='avatar';
        if(profile.avatar_url){avatar.style.backgroundImage=`url("${String(profile.avatar_url).replace(/"/g,'%22')}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';avatar.textContent='';}
        else avatar.textContent=(profile.full_name||profile.username||'ع').slice(0,1);
        const name=document.createElement('strong');name.textContent=profile.full_name||profile.username||'عضو EgyBook';
        const badge=document.createElement('span');badge.className='reaction-person-emoji';badge.textContent=reaction;
        el.append(avatar,name,badge);list.append(el);
      });
      const filterBar=$('#reactionDetailsFilterBar');if(filterBar){const rows=$$('.reaction-person-row',list);filterBar.querySelectorAll('[data-reaction-filter]').forEach(chip=>{const value=chip.dataset.reactionFilter||'all';const count=value==='all'?rows.length:rows.filter(row=>row.dataset.reactionEmoji===value).length;const strong=$('strong',chip);if(strong)strong.textContent=String(count);});}
    }catch(error){
      list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='تعذر تحميل التفاعلات من السحابة. تحقق من صلاحيات قراءة post_reactions وربط profiles ثم أعد المحاولة.';list.append(msg);
    }
  }
  function dismissLiveNotification(){
    const popup=$('#egybookLiveNotification');if(!popup)return;
    popup.classList.remove('show');clearTimeout(liveNotificationHideTimer);
    setTimeout(()=>{if(!popup.classList.contains('show'))popup.hidden=true;},260);
  }
  // One notification navigation path for both the notifications page and live toast.
  // Avoid independent polling intervals that can open overlapping comment layers.
  async function openNotificationTarget(item){
    if(!item)return;
    await markNotificationRead(item);
    if(item.type==='friend'||item.type==='system'||!item.postId){
      if(item.actorId||item.username)await openNotificationActorProfile(item);
      else openNotifications({push:true});
      return;
    }
    try{sessionStorage.setItem('egybook-notifications-return',JSON.stringify({scrollY:$('#notificationsPage')?.scrollTop||window.scrollY||0,notificationId:item.id}));}catch(_){}
    closeNotifications();
    openPostRoute(item.postId,{push:true,commentId:item.commentId||null});
  }
  async function openLiveNotificationTarget(item){
    if(!item)return;
    dismissLiveNotification();
    await openNotificationTarget(item);
  }
  function announceLiveNotification(item){
    if(!item)return;
    const title=item.type==='friend'?'طلب صداقة جديد':item.type==='comment'?'تعليق جديد':item.type==='reply'?'رد جديد':item.type==='reaction'?'تفاعل جديد':'إشعار جديد';
    const message=`${item.name||'عضو EgyBook'}: ${item.text||'لديك إشعار جديد'}`;
    if(!document.hidden){
      let popup=$('#egybookLiveNotification');
      if(!popup){
        popup=document.createElement('div');popup.id='egybookLiveNotification';popup.className='egybook-live-notification';popup.hidden=true;popup.setAttribute('role','status');popup.setAttribute('aria-live','polite');
        popup.innerHTML='<span class="live-notification-avatar" aria-hidden="true"></span><span class="live-notification-content"><strong class="live-notification-title"></strong><span class="live-notification-message"></span><span class="live-notification-hint">اضغط لعرض التفاصيل</span></span><button type="button" class="live-notification-close" aria-label="إغلاق الإشعار">×</button>';
        popup.addEventListener('click',event=>{
          if(event.target.closest('.live-notification-close')){event.stopPropagation();dismissLiveNotification();return;}
          const target=popup._notificationItem;if(target)openLiveNotificationTarget(target);
        });
        let touchStartX=0,touchStartY=0;
        popup.addEventListener('touchstart',event=>{const t=event.changedTouches[0];touchStartX=t.clientX;touchStartY=t.clientY;},{passive:true});
        popup.addEventListener('touchend',event=>{const t=event.changedTouches[0],dx=t.clientX-touchStartX,dy=t.clientY-touchStartY;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.2)dismissLiveNotification();},{passive:true});
        let pointerStartX=0,pointerStartY=0;
        popup.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')return;pointerStartX=event.clientX;pointerStartY=event.clientY;});
        popup.addEventListener('pointerup',event=>{if(event.pointerType==='touch')return;const dx=event.clientX-pointerStartX,dy=event.clientY-pointerStartY;if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*1.2)dismissLiveNotification();});
        document.body.append(popup);
      }
      popup._notificationItem=item;popup.hidden=false;
      const avatar=popup.querySelector('.live-notification-avatar');
      avatar.textContent=(item.name||'E').trim().slice(0,1);
      if(item.avatar){avatar.style.backgroundImage=`url("${String(item.avatar).replace(/"/g,'%22')}")`;avatar.classList.add('has-image');}else{avatar.style.backgroundImage='';avatar.classList.remove('has-image');}
      popup.querySelector('.live-notification-title').textContent=title;
      popup.querySelector('.live-notification-message').textContent=message;
      popup.classList.remove('show');void popup.offsetWidth;popup.classList.add('show');
      clearTimeout(liveNotificationHideTimer);liveNotificationHideTimer=setTimeout(dismissLiveNotification,6500);
    }
    if('Notification' in window && Notification.permission==='granted' && document.hidden){try{new Notification('EgyBook · '+title,{body:message,tag:String(item.id||Date.now())});}catch(_){}}
  }
  async function requestBrowserNotificationPermission(){
    if(!('Notification' in window))return showToast('المتصفح لا يدعم إشعارات الجهاز.');
    if(Notification.permission==='granted')return showToast('إشعارات الجهاز مفعّلة بالفعل.');
    if(Notification.permission==='denied')return showToast('إشعارات EgyBook محظورة من إعدادات المتصفح. فعّلها من إعدادات الموقع.');
    try{const result=await Notification.requestPermission();showToast(result==='granted'?'تم تفعيل إشعارات الجهاز أثناء فتح الموقع.':'لم يتم السماح بإشعارات الجهاز.');}catch(_){showToast('تعذر طلب إذن الإشعارات من المتصفح.');}
  }
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
      const openTarget=()=>openNotificationTarget(item);
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
    const previousIds=new Set(notificationItems.map(x=>String(x.id)));
    const announceNew=notificationRealtimePrimed;
    if(!currentUser||!supabase){notificationItems=[];renderNotifications();if(!currentUser)showToast('سجّل الدخول عشان تشوف إشعارات حسابك.');return;}
    // Keep previously rendered notifications visible while refreshing in the background.
    // Only show the blocking loader on the very first visit with no usable data.
    const hasVisibleNotifications=!!list.querySelector('.notification-card') || notificationItems.length>0;
    if(!hasVisibleNotifications&&!list.querySelector('.notifications-loading')){
      const loading=document.createElement('p');loading.className='notifications-loading';loading.textContent='جارٍ تحميل الإشعارات…';list.replaceChildren(loading);
    }
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
          supabase.from('post_comments').select('id,post_id,user_id,user_name,body,created_at,parent_id,profiles(full_name,username,avatar_url)').in('post_id',postIds).neq('user_id',userId).order('created_at',{ascending:false}).limit(100)
        ]);
        if(reactions.error)console.warn('Notifications reactions:',reactions.error.message);
        (reactions.data||[]).forEach(r=>{const profile=Array.isArray(r.profiles)?(r.profiles[0]||{}):(r.profiles||{});collected.push({id:`reaction:${r.id||`${r.post_id}:${r.user_id}`}`,type:'reaction',postId:String(r.post_id),created_at:r.created_at,actorId:r.user_id,username:profile.username||'',name:profile.full_name||profile.username||'عضو EgyBook',avatar:profile.avatar_url||'',text:`تفاعل مع منشورك ${r.reaction||'👍'}`});});
        if(comments.error)console.warn('Notifications comments:',comments.error.message);
        (comments.data||[]).forEach(c=>{const profile=Array.isArray(c.profiles)?(c.profiles[0]||{}):(c.profiles||{});collected.push({id:`comment:${c.id}`,type:c.parent_id?'reply':'comment',commentId:String(c.id),postId:String(c.post_id),actorId:c.user_id,created_at:c.created_at,name:profile.full_name||profile.username||c.user_name||'عضو EgyBook',username:profile.username||'',avatar:profile.avatar_url||'',text:`${c.parent_id?'رد على تعليق في منشورك: ':'علّق على منشورك: '}${String(c.body||'').slice(0,120)}`});});
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
      if(announceNew){
        const incoming=notificationItems.filter(item=>!previousIds.has(String(item.id))&&!item.read_at);
        incoming.sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)).forEach(item=>announceLiveNotification(item));
      }
      notificationRealtimePrimed=true;
    }catch(error){
      console.error('Could not load notifications:',error);
      // Do not erase useful stale data because a weak connection failed mid-refresh.
      if(notificationItems.length){renderNotifications();updateNotificationBadge();}
      else {list.replaceChildren();const msg=document.createElement('p');msg.className='notification-empty';msg.textContent='تعذر تحميل الإشعارات. تحقق من الاتصال ثم اضغط تحديث للمحاولة مرة أخرى.';list.append(msg);}
    }
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
  function openNotifications({push=true}={}){postRouteOpenToken++;closeProfileMenu();closeSidebar();$('#messagesPage').hidden=true;$('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;const friends=$('#friendsDirectoryPage');if(friends)friends.hidden=true;const reels=$('#reelsPage');if(reels)reels.hidden=true;$('#notificationsPage').hidden=false;currentPage='notifications';$$('.top-nav-item,.bottom-item').forEach(b=>b.classList.toggle('active',b.dataset.action==='notifications'||b.dataset.page==='notifications'));if(push)history.pushState({page:'notifications'},'','/Egybook/notifications');loadNotifications();window.scrollTo({top:0,behavior:'auto'});}
  function closeNotifications(){const page=$('#notificationsPage');if(page)page.hidden=true;}

  function ensureMessagesHidden(){
    ['#profilePage','.container','#memezPage','#notificationsPage','#friendsDirectoryPage','#reelsPage'].forEach(sel=>{const el=$(sel);if(el)el.hidden=true;});
  }
  function openMessages({push=true,peerId=null,peerProfile=null}={}){
    if(window.__egybookStopPostMusic)window.__egybookStopPostMusic(true);

    if(!currentUser){showToast('سجّل الدخول أولًا لاستخدام الرسائل.');setAuthMode('login');refreshAuthUI();openModal($('#supabaseAuthModal'));return;}
    closeSidebar();closeNotifications();
    const page=$('#messagesPage');if(!page)return;
    ensureMessagesHidden();page.hidden=false;currentPage='messages';
    $$('.top-nav-item,.bottom-item').forEach(b=>b.classList.toggle('active',b.dataset.action==='messages'));
    if(push){const url=peerId?'/Egybook/messages/'+encodeURIComponent(peerId):'/Egybook/messages';history.pushState({page:'messages',peerId:peerId||null},'',url);}
    if(peerId){openMessageThread(peerId,peerProfile,{push:false});}else{showMessagesList();loadDirectMessages();}
    window.scrollTo({top:0,behavior:'auto'});
  }
  // Keep the chat screen as a direct child of <body> while it is open.
  // A transformed/animated page ancestor can otherwise become the containing
  // block for position:fixed and leave a large blank area above the chat.
  let messagesThreadPlaceholder = null;
  function mountMessagesThread(){
    const thread=$('#messagesThreadView');
    if(!thread || thread.parentElement===document.body) return;
    if(!messagesThreadPlaceholder){
      messagesThreadPlaceholder=document.createComment('EgyBook chat mount point');
      thread.parentNode.insertBefore(messagesThreadPlaceholder,thread);
    }
    document.body.appendChild(thread);
  }
  function restoreMessagesThread(){
    const thread=$('#messagesThreadView');
    if(thread){thread.hidden=true;}
    if(messagesThreadPlaceholder?.parentNode && thread){
      messagesThreadPlaceholder.parentNode.insertBefore(thread,messagesThreadPlaceholder);
      messagesThreadPlaceholder.remove();
    }
    messagesThreadPlaceholder=null;
    document.body.classList.remove('messages-thread-open');
    if(!document.querySelector('.modal.open, #imageViewer:not([hidden])')) document.body.style.overflow='';
  }
  function showMessagesList(){
    restoreMessagesThread();
    const listView=$('#messagesListView'),threadView=$('#messagesThreadView');
    if(listView)listView.hidden=false;
    if(threadView)threadView.hidden=true;
    activeMessagePeer=null;
    renderDirectMessageList();
  }
  function renderDirectMessageList(){
    const list=$('#messagesList');if(!list)return;list.replaceChildren();
    const q=($('#messagesSearchInput')?.value||'').trim().toLowerCase();
    let rows=directMessageRows.slice();
    if(messagesCurrentTab==='groups'){const empty=document.createElement('p');empty.className='messages-empty';empty.textContent='المحادثات الجماعية غير مفعّلة بعد.';list.append(empty);return;}
    if(messagesCurrentTab==='favorites'){rows=rows.filter(r=>{try{return JSON.parse(localStorage.getItem('egybook_message_favorites')||'[]').includes(String(r.peerId));}catch(_){return false;}});}
    if(messagesCurrentTab==='unread')rows=rows.filter(r=>Number(r.unread)>0);
    if(q)rows=rows.filter(r=>String(r.name||'').toLowerCase().includes(q)||String(r.username||'').toLowerCase().includes(q)||String(r.lastMessage||'').toLowerCase().includes(q));
    const unread=directMessageRows.reduce((n,r)=>n+Number(r.unread||0),0);const badge=$('#messagesUnreadCount');if(badge){badge.hidden=!unread;badge.textContent=unread>99?'99+':String(unread);}
    if(!rows.length){const empty=document.createElement('div');empty.className='messages-empty-state';empty.innerHTML='<span class="messages-empty-icon"><svg viewBox="0 0 24 24"><path d="M4 4.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8l-5.5 3v-3H4A2.5 2.5 0 0 1 1.5 16V7A2.5 2.5 0 0 1 4 4.5Z"/></svg></span><strong>لا توجد محادثات بعد</strong><p>ابدأ مراسلة أحد أصدقائك من ملفه الشخصي.</p></div>';list.append(empty);return;}
    rows.forEach(row=>{
      const card=document.createElement('button');card.type='button';card.className='message-conversation-card'+(row.unread?' has-unread':'');card.dataset.action='messages-open-thread';card.dataset.peerId=row.peerId;
      const avatar=document.createElement('span');avatar.className='messages-avatar';if(row.avatar){const img=document.createElement('img');img.src=row.avatar;img.alt='';avatar.append(img);}else avatar.textContent=(row.name||'؟').trim().charAt(0)||'؟';
      const body=document.createElement('span');body.className='message-conversation-body';const top=document.createElement('span');top.className='message-conversation-top';const name=document.createElement('strong');name.textContent=row.name||row.username||'عضو EgyBook';const time=document.createElement('time');time.textContent=formatMessageTime(row.createdAt);top.append(name,time);const preview=document.createElement('span');preview.className='message-conversation-preview';preview.textContent=(row.mine?'أنت: ':'')+(row.lastMessage||'ابدأ المحادثة');body.append(top,preview);
      const side=document.createElement('span');side.className='message-conversation-side';const more=document.createElement('span');more.className='message-more-dots';more.innerHTML='<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';side.append(more);if(row.unread){const count=document.createElement('b');count.className='message-unread-count';count.textContent=row.unread>99?'99+':String(row.unread);side.append(count);}card.append(avatar,body,side);list.append(card);
    });
  }
  function formatMessageTime(value){if(!value)return '';const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const today=new Date();if(date.toDateString()===today.toDateString())return date.toLocaleTimeString('ar-EG',{hour:'numeric',minute:'2-digit'});return date.toLocaleDateString('ar-EG',{day:'numeric',month:'short'});}
  async function loadDirectMessages({force=false}={}){
    const list=$('#messagesList');if(!list)return;
    if(!currentUser||!supabase){directMessageRows=[];renderDirectMessageList();return;}
    if(!force && directMessagesLoadedFor===currentUser.id){renderDirectMessageList();return;}
    if(directMessagesLoading && !force){return directMessagesLoading;}
    list.innerHTML=directMessageRows.length?'':'<p class="messages-empty">جارٍ تحميل المحادثات…</p>';
    directMessagesLoading=(async()=>{try{
      const {data,error}=await supabase.from('direct_messages').select('id,sender_id,recipient_id,body,created_at,read_at').or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order('created_at',{ascending:false}).limit(500);
      if(error)throw error;
      const latest=new Map();
      (data||[]).forEach(m=>{const peerId=m.sender_id===currentUser.id?m.recipient_id:m.sender_id;if(!peerId)return;let row=latest.get(peerId);if(!row){row={peerId,lastMessage:m.body||'',createdAt:m.created_at,mine:m.sender_id===currentUser.id,unread:0,lastId:m.id};latest.set(peerId,row);}if(m.recipient_id===currentUser.id&&!m.read_at)row.unread++;});
      const ids=[...latest.keys()];
      if(ids.length){const {data:profiles,error:profileError}=await supabase.from('profiles').select('id,full_name,username,avatar_url,last_seen_at').in('id',ids);if(profileError)console.warn('Message profile lookup:',profileError.message);const byId=new Map((profiles||[]).map(x=>[x.id,x]));latest.forEach((row,id)=>{const person=byId.get(id)||{};row.name=person.full_name||person.username||'عضو EgyBook';row.username=person.username||'';row.avatar=person.avatar_url||'';});}
      directMessageRows=[...latest.values()].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));directMessagesLoadedFor=currentUser.id;renderDirectMessageList();
    }catch(error){console.error('Load direct messages failed:',error);if(directMessageRows.length){renderDirectMessageList();showToast('تعذر تحديث الرسائل الآن؛ نعرض البيانات المتاحة.');return;}list.replaceChildren();const note=document.createElement('p');note.className='messages-empty';note.textContent=/direct_messages|relation/i.test(error.message||'')?'قاعدة بيانات الرسائل غير مجهزة بعد. شغّل ملف EGYBOOK_DIRECT_MESSAGES_MIGRATION.sql المرفق ثم أعد فتح الرسائل.':'تعذر تحميل الرسائل. تحقق من الاتصال وصلاحيات قاعدة البيانات.';list.append(note);}finally{directMessagesLoading=null;}})();return directMessagesLoading;
  }
  async function openMessageThread(peerId,peerProfile=null,{push=true}={}){
    if(!currentUser){showToast('سجّل الدخول أولًا لاستخدام الرسائل.');return;}
    if(!peerId||peerId===currentUser.id){showToast('لا يمكنك مراسلة حسابك الشخصي.');return;}
    if(push){messageOrigin={page:currentPage==='profile'?'profile':'messages',username:publicProfileUsername||null,scrollY:window.scrollY||0};}
    activeMessagePeer={id:String(peerId),...(peerProfile||{})};
    const page=$('#messagesPage');if(page){ensureMessagesHidden();page.hidden=false;currentPage='messages';}
    mountMessagesThread();
    $('#messagesListView').hidden=true;$('#messagesThreadView').hidden=false;document.body.classList.add('messages-thread-open');
    if(push)history.pushState({page:'messages',peerId:String(peerId),origin:messageOrigin},'','/Egybook/messages/'+encodeURIComponent(peerId));
    if(supabase&&!activeMessagePeer.full_name&&!activeMessagePeer.name&&!activeMessagePeer.avatar_url&&!activeMessagePeer.avatar){try{const {data}=await supabase.from('profiles').select('id,full_name,username,avatar_url').eq('id',String(peerId)).maybeSingle();if(data)activeMessagePeer={...activeMessagePeer,...data};}catch(_){}}
    const name=activeMessagePeer.full_name||activeMessagePeer.name||activeMessagePeer.username||'عضو EgyBook';$('#messagesThreadName').textContent=name;$('#messagesThreadStatus').textContent='محادثة خاصة';const avatar=$('#messagesThreadAvatar');avatar.replaceChildren();if(activeMessagePeer.avatar_url||activeMessagePeer.avatar){const img=document.createElement('img');img.src=activeMessagePeer.avatar_url||activeMessagePeer.avatar;img.alt='';avatar.append(img);}else avatar.textContent=name.charAt(0)||'؟';
    const items=$('#messagesThreadItems');items.innerHTML='<p class="messages-empty">جارٍ تحميل المحادثة…</p>';
    if(!supabase)return;
    try{
      const {data,error}=await supabase.from('direct_messages').select('id,sender_id,recipient_id,body,created_at,read_at').or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${currentUser.id})`).order('created_at',{ascending:true}).limit(500);
      if(error)throw error;items.replaceChildren();
      if(!data?.length){const empty=document.createElement('p');empty.className='messages-thread-start';empty.textContent='دي بداية المحادثة. ابعت أول رسالة 💙';items.append(empty);}
      (data||[]).forEach(m=>{const bubble=document.createElement('div');bubble.className='message-bubble'+(m.sender_id===currentUser.id?' mine':'');bubble.textContent=m.body||'';const time=document.createElement('time');time.textContent=formatMessageTime(m.created_at);bubble.append(time);items.append(bubble);});
      items.scrollTop=items.scrollHeight;
      const unreadIds=(data||[]).filter(m=>m.recipient_id===currentUser.id&&!m.read_at).map(m=>m.id);if(unreadIds.length)await supabase.from('direct_messages').update({read_at:new Date().toISOString()}).in('id',unreadIds).eq('recipient_id',currentUser.id);
      loadDirectMessages();
    }catch(error){console.error('Open direct conversation failed:',error);items.replaceChildren();const note=document.createElement('p');note.className='messages-empty';note.textContent='تعذر فتح المحادثة. تأكد من تشغيل ملف إعداد الرسائل في Supabase.';items.append(note);}
  }
  async function sendDirectMessage(event){
    event.preventDefault();const input=$('#messagesComposerInput');const body=(input?.value||'').trim();if(!body)return;if(!currentUser||!supabase||!activeMessagePeer){showToast('سجّل الدخول وافتح محادثة أولًا.');return;}
    const send=$('#messagesSendForm button[type="submit"]');if(send)send.disabled=true;
    try{const {error}=await supabase.from('direct_messages').insert({sender_id:currentUser.id,recipient_id:activeMessagePeer.id,body});if(error)throw error;input.value='';directMessagesLoadedFor=null;await openMessageThread(activeMessagePeer.id,activeMessagePeer,{push:false});}
    catch(error){console.error('Send direct message failed:',error);showToast('تعذر إرسال الرسالة. تأكد من تطبيق ملف إعداد الرسائل في Supabase.');}
    finally{if(send)send.disabled=false;}
  }

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
    if (/^\/Egybook\/search\/?$/i.test(path)) {
      const query = new URLSearchParams(location.search).get('q') || '';
      openPeopleSearch();
      const searchInput = $('#searchInput');
      if (searchInput) searchInput.value = query;
      if (query) runPeopleSearch();
      return;
    }
    try { path = decodeURIComponent(path); } catch (_) {}
    // v64: leaving a direct-message route must fully release its fixed overlay.
    // Otherwise the fixed chat can remain above the next profile/page and block
    // taps/back navigation until a full reload.
    const isMessagesRoute = /^\/Egybook\/messages(?:\/[^/]+)?\/?$/i.test(path);
    if (!isMessagesRoute) {
      restoreMessagesThread();
      const threadView = $('#messagesThreadView');
      const listView = $('#messagesListView');
      if (threadView) threadView.hidden = true;
      if (listView) listView.hidden = false;
      activeMessagePeer = null;
    }
    const messageMatch=path.match(/^\/Egybook\/messages(?:\/([^/]+))?\/?$/i);
    if(messageMatch){let peerId=null;try{peerId=messageMatch[1]?decodeURIComponent(messageMatch[1]):null;}catch(_){}openMessages({push:false,peerId});return;}
    if(/^\/Egybook\/notifications\/?$/i.test(path)){openNotifications({push:false});return;}
    closeNotifications();
    if(/^\/Egybook\/reels\/?$/i.test(path)){ $('#messagesPage').hidden=true;$('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=true;const rp=$('#reelsPage');if(rp)rp.hidden=false;currentPage='reels';return;}
    if(/^\/Egybook\/memez\/?$/i.test(path)){ $('#messagesPage').hidden=true;$('#profilePage').hidden=true;$('.container').hidden=true;$('#memezPage').hidden=false;return;}
    const photoMatch=path.match(/^\/Egybook\/(?:photo|profile-photo|cover-photo)\/([^/]+)\/?$/i);
    if(photoMatch){
      const id=photoMatch[1];
      const postId=id.startsWith('post-')?id.slice(5):id;
      const post=$(`[data-post-id="${CSS.escape(postId)}"]`,document);
      const media=post?.querySelector('.post-image');
      if(id.startsWith('post-')&&post&&media&&media.tagName==='IMG'){openPostImageViewer(post,{push:false});return;}
      const all=[...['avatar','cover','posts'].flatMap(k=>(albumsData[k]||[]).map((x,i)=>({...x,id:String(x.id||`${k}-${x.date||i}`),author:profileData.name,avatar:profileData.avatar,caption:k==='avatar'?'الصورة الشخصية':k==='cover'?'صورة الغلاف':'صورة من المنشورات'})))];
      const found=all.findIndex(x=>String(x.id)===id);
      if(found>=0){openImageViewer(all,found,null,{push:false});return;}
      if(post&&media&&media.tagName==='IMG'){openPostImageViewer(post,{push:false});return;}
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
        (async()=>{try{const {data,error}=await supabase.from('posts').select('id,user_id,text,media_url,media_type,visibility,created_at,pinned_at,feeling,activity,location_name,tagged_user_ids,music_title,music_artist,media_urls,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds').eq('id',postId).maybeSingle();if(error||!data||data.media_type!=='image'||!data.media_url)return;const {data:authorProfile}=await supabase.from('profiles').select('id,username,full_name,avatar_url').eq('id',data.user_id).maybeSingle();renderCloudPost(data,authorProfile||null);const target=$(`[data-post-id="${CSS.escape(String(data.id))}"]`,postsList);const media=target?.querySelector('.post-image');if(target&&media){openPostImageViewer(target,{push:false});}}catch(_){showToast('تعذر فتح رابط الصورة من السحابة.');}})();return;
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
      routePostId=null;postRouteOpenToken++;
      restoreCommentsSheetToModal();document.body.classList.remove('post-route-open');
      const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
      $('#memezPage').hidden=true;
      setPage('home',{push:false});
    }
  }
  async function loadPublicProfileByUsername(username){
    if(!supabase)return;
    const requested=cleanUsername(username);
    const loadToken=++profileLoadToken;
    if(profileLoadingTimer){clearTimeout(profileLoadingTimer);profileLoadingTimer=null;}
    profileLoadingTimer=setTimeout(()=>{
      if(loadToken!==profileLoadToken || publicProfileUsername!==requested)return;
      const nameNode=$('#profileNameText');
      if(nameNode)nameNode.textContent='جارٍ تحميل الملف الشخصي…';
    },350);
    try{
      const {data,error}=await supabase.from('profiles').select('*').eq('username',requested).maybeSingle();
      if(loadToken===profileLoadToken && profileLoadingTimer){clearTimeout(profileLoadingTimer);profileLoadingTimer=null;}
      if(publicProfileUsername!==requested || loadToken!==profileLoadToken)return;
      if(error || !data){
        $('#profileNameText').textContent='الحساب غير متاح';
        $('.profile-handle').textContent='@'+requested;
        publicProfileId=null;publicProfileIsOwn=false;publicProfileData=null;const pc=$('.profile-create-post');if(pc)pc.hidden=true;updateProfileActionVisibility();renderProfilePosts();
        return;
      }
      const name=data.full_name || data.name || username;
      const publicProfile={
        name,
        username:cleanUsername(data.username || username),
        bio:data.bio || '',
        location:data.location || '',
        birthdate:data.birthdate || '',
        birthdate_display:data.birthdate_display || 'hidden',
        location_privacy:data.location_privacy || 'public',
        birthdate_privacy:data.birthdate_privacy || 'public',
        relationship:data.relationship || '',
        relationship_privacy:data.relationship_privacy || 'public',
        work:data.work || '',
        work_privacy:data.work_privacy || 'public',
        education:data.education || '',
        education_privacy:data.education_privacy || 'public',
        avatar:data.avatar_url || data.avatar || '',
        cover:data.cover_url || data.cover || ''
      };
      publicProfileId=data.id;
      const profileCover=$('.profile-cover');if(profileCover){profileCover.dataset.appliedCoverUrl='';profileCover.dataset.pendingCoverUrl='';profileCover.style.backgroundImage='';profileCover.classList.remove('has-image');}
      const profileAvatarNode=$('.profile-large-avatar');if(profileAvatarNode){profileAvatarNode.style.backgroundImage='';profileAvatarNode.textContent=(name||username||'ح').trim().charAt(0);}
      refreshViewedProfileVerification();
      loadProfileFriends(data.id);
      publicProfileIsOwn=!!currentUser && data.id===currentUser.id;
      publicProfileData={...publicProfile,id:data.id};
      updateProfileActionVisibility();
      $('#profileNameText').textContent=publicProfile.name;addBadgeToUserName($('#profileNameText'),data.id);
      $('.profile-handle').textContent='@'+publicProfile.username;
      $('.profile-bio').textContent=publicProfile.bio;
      renderProfileAbout({...data,...publicProfile},publicProfileIsOwn);
      renderProfileMeta({...data,...publicProfile},publicProfileIsOwn);
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
      // Avoid a visible loading flash on fast requests; show the hint only if
      // the request is still pending after a short grace period.
      setTimeout(() => {
        if (requestToken !== profilePostsRequestToken || target.children.length) return;
        const loading = document.createElement('div');
        loading.className = 'profile-empty profile-loading-placeholder';
        loading.textContent = 'جارٍ تحميل المنشورات…';
        target.append(loading);
      }, 220);
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
        .select('id,user_id,text,media_url,media_type,visibility,created_at,pinned_at,feeling,activity,location_name,tagged_user_ids,music_title,music_artist,media_urls,music_track_id,music_permalink,music_artwork_url,music_start_seconds,music_duration_seconds')
        .eq('user_id', viewedId)
        .order('created_at', { ascending: false })
        .limit(500);
      // Audience visibility is enforced by Supabase RLS for every viewer.
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
        if(row.pinned_at)postState[id]={...(postState[id]||{}),pinned:true};
        let article=$(`[data-post-id="${CSS.escape(id)}"]`,target);
        if(!article){
          article=createPostElement({
            id, text:row.text||'', media:row.media_url||null, mediaType:row.media_type||null,
            visibility:row.visibility||'الجميع', createdAt:row.created_at?new Date(row.created_at).getTime():Date.now(),
            authorName, authorAvatar:authorProfile?.avatar_url||null, feeling:row.feeling||'', activity:row.activity||'', location_name:row.location_name||'', tagged_user_ids:row.tagged_user_ids||[], music_title:row.music_title||'', music_artist:row.music_artist||'', media_urls:row.media_urls||[], music_track_id:row.music_track_id||'', music_permalink:row.music_permalink||'', music_artwork_url:row.music_artwork_url||'', music_start_seconds:row.music_start_seconds||0, music_duration_seconds:row.music_duration_seconds||30
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
          // Existing cards are reused to prevent visual flicker, but their cloud
          // reaction/comment counts must still refresh after profile pull-to-refresh.
          addBadgeToUserName($('.post-author .author-name',article), row.user_id);
          syncPostStats(article);
          loadCloudPostStats(article);
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
      observePostMusicPlayers(target);
    } catch (error) {
      if (requestToken !== profilePostsRequestToken) return;
      console.error('Profile posts load failed:', error);
      if(!target.querySelector('.post')){
        target.replaceChildren();
        const message = document.createElement('div');
        message.className = 'profile-empty';
        const detail=String(error?.message||error?.details||'').trim();
        message.textContent = detail
          ? `تعذر تحميل المنشورات: ${detail}`
          : 'تعذر تحميل المنشورات. تحقق من صلاحيات قراءة جدول posts وسياسات RLS، ثم حاول تحديث الصفحة.';
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
    if(options.isFriend){const status=document.createElement('span');status.className='directory-friend-status';status.dataset.presenceUserId=String(profile.id||'');status.dataset.lastSeenAt=profile.last_seen_at||'';renderPresenceLabel(status,profile.id,profile.last_seen_at);info.append(status);}
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
  let friendsDirectoryRenderedKey = null;
  async function loadFriendsDirectory(tab=friendsDirectoryTab, ownerId=friendsDirectoryOwnerId){
    friendsDirectoryTab=tab; friendsDirectoryOwnerId=ownerId||currentUser?.id||null; const directoryOwnerId=friendsDirectoryOwnerId; const isOwnDirectory=!!currentUser&&directoryOwnerId===currentUser.id; const page=ensureFriendsDirectoryPage(); const content=$('#friendsDirectoryContent');
    $$('.friends-directory-tabs button',page).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    if(!isOwnDirectory&&tab!=='friends'){tab='friends';friendsDirectoryTab='friends';$$('.friends-directory-tabs button',page).forEach(b=>b.classList.toggle('active',b.dataset.tab==='friends'));}
    const token=++friendsDirectoryLoadingToken;
    const cacheKey=`${directoryOwnerId||'guest'}:${tab}`;
    // Restore only the exact owner/tab snapshot; then refresh it in the background.
    // Cached markup is generated locally by this renderer and event handling is delegated.
    if(content&&!content.childElementCount&&friendsDirectoryCache.has(cacheKey)){
      const snapshot=friendsDirectoryCache.get(cacheKey);
      if(snapshot&&snapshot.html){content.innerHTML=snapshot.html;friendsDirectoryRenderedKey=cacheKey;
        const count=$('#directoryFriendsCount');if(count&&snapshot.friendsCount!=null)count.textContent=String(snapshot.friendsCount);
        const requests=$('#directoryRequestsCount');if(requests&&snapshot.requestsCount!=null)requests.textContent=String(snapshot.requestsCount);}
    }
    // Never reuse markup across owners/tabs, because friend data is account-sensitive.
    const hasSameRenderedView=friendsDirectoryRenderedKey===cacheKey&&content.childElementCount>0;
    if(!hasSameRenderedView){
      content.replaceChildren();
      const loading=document.createElement('p');loading.className='friends-directory-empty';
      loading.textContent='جارٍ تحميل البيانات…';content.append(loading);
    }
    if(!supabase||!directoryOwnerId||(!currentUser&&!directoryOwnerId)){content.replaceChildren();const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='تعذر تحديد صاحب قائمة الأصدقاء.';content.append(empty);return;}
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
      if(otherIds.length){let pRes=await supabase.from('profiles').select('id,full_name,username,avatar_url,last_seen_at').in('id',otherIds);if(pRes.error && /last_seen_at|column/i.test(String(pRes.error.message||'')))pRes=await supabase.from('profiles').select('id,full_name,username,avatar_url').in('id',otherIds);if(pRes.error)throw pRes.error;profiles=pRes.data||[];}
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
      // Save this exact owner/tab view for instant revisits; refresh still runs below.
      friendsDirectoryRenderedKey=cacheKey;
      friendsDirectoryCache.set(cacheKey,{html:content.innerHTML,friendsCount:$('#directoryFriendsCount')?.textContent,requestsCount:$('#directoryRequestsCount')?.textContent, savedAt:Date.now()});
    }catch(error){
      console.error('Friends directory load failed:',error);
      if(token!==friendsDirectoryLoadingToken||directoryOwnerId!==friendsDirectoryOwnerId)return;
      if(!hasSameRenderedView || !content.childElementCount){
        content.replaceChildren();const empty=document.createElement('p');empty.className='friends-directory-empty';empty.textContent='تعذر تحميل الأصدقاء. تحقق من الاتصال ثم اضغط على التبويب مرة أخرى للمحاولة.';content.append(empty);
      }
    }
  }
  function openFriendsDirectory({push=true,tab='friends',ownerId=null}={}){
    closeNotifications();
    const messagesPage=$('#messagesPage');if(messagesPage)messagesPage.hidden=true;
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
    if(window.__egybookStopPostMusic && page!==currentPage)window.__egybookStopPostMusic(true);
    closeProfileMenu();
    closeNotifications();
    const messagesPage=$('#messagesPage');if(messagesPage)messagesPage.hidden=true;
    const livePopup=$('#egybookLiveNotification');if(livePopup)livePopup.classList.remove('show');
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

  const searchOverlay = $('#searchModal');
  if (searchOverlay) {
    searchOverlay.addEventListener('click', event => {
      if (event.target === searchOverlay) closeModal(searchOverlay);
    });
    let searchTouchStartY = null;
    searchOverlay.addEventListener('touchstart', event => {
      if (event.touches && event.touches.length === 1) searchTouchStartY = event.touches[0].clientY;
    }, {passive:true});
    searchOverlay.addEventListener('touchend', event => {
      if (searchTouchStartY === null || !event.changedTouches || !event.changedTouches.length) return;
      const deltaY = event.changedTouches[0].clientY - searchTouchStartY;
      const box = event.target.closest ? event.target.closest('.search-modal-box') : null;
      if (deltaY > 110 && box && box.scrollTop <= 0) closeModal(searchOverlay);
      searchTouchStartY = null;
    }, {passive:true});
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchOverlay && !searchOverlay.hidden) closeModal(searchOverlay);
  });


  // Android system back / edge-swipe closes the active composer layer first.
  window.addEventListener('popstate', event => {
    const feature=$('#composerFeatureModal');
    if(feature?.classList.contains('open')){if(audiusAudio){audiusAudio.pause();audiusAudio.src='';audiusAudio=null;audiusPlayingTrackId=null;}delete feature.dataset.overlayHistory;closeModal(feature);event.stopImmediatePropagation();return;}
    const audience=$('#audienceModal'), composer=$('#createPostModal');
    if(audience?.classList.contains('open')){closeModal(audience); if(audienceReturnToComposer)openModal(composer); composerHistoryStateActive=false; event.stopImmediatePropagation(); return;}
    if(composer?.classList.contains('open')){closeModal(composer); composerHistoryStateActive=false; event.stopImmediatePropagation(); return;}
  });

  // Browser/Android Back closes the search overlay before navigating away.
  window.addEventListener('popstate', event => {
    const overlay = $('#searchModal');
    if (overlay && overlay.classList.contains('open')) {
      overlay.classList.remove('open');
      overlay.hidden = true;
      document.body.classList.remove('search-overlay-open');
      window.__egybookSearchPreviousState = null;
      if (!$('.modal.open')) document.body.style.overflow = '';
      // The browser already consumed the temporary overlay history entry.
      // Keep the current route visible; do not force navigation to home.
      event.stopImmediatePropagation();
    }
  });

  // v27: use the phone's standard back swipe to dismiss the search overlay.
  (function attachPhoneBackSwipeGesture() {
    const overlay = $('#searchModal');
    if (!overlay || overlay.dataset.phoneBackSwipeReady === '1') return;
    overlay.dataset.phoneBackSwipeReady = '1';
    let startX = 0, startY = 0, tracking = false, startedAtEdge = false;
    overlay.addEventListener('touchstart', event => {
      if (overlay.hidden || !overlay.classList.contains('open') ||
          !event.touches || event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      const edgeWidth = Math.min(38, window.innerWidth * 0.09);
      startedAtEdge = touch.clientX <= edgeWidth || touch.clientX >= window.innerWidth - edgeWidth;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = startedAtEdge;
    }, {passive:true});
    overlay.addEventListener('touchend', event => {
      if (!tracking || !event.changedTouches || !event.changedTouches.length) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // Close only for a decisive horizontal edge-back swipe; vertical scrolling remains intact.
      if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        closeModal(overlay);
      }
      tracking = false;
      startedAtEdge = false;
    }, {passive:true});
    overlay.addEventListener('touchcancel', () => {
      tracking = false;
      startedAtEdge = false;
    }, {passive:true});
  })();
  const peopleSearchInput = $('#searchInput');
  if (peopleSearchInput) {
    peopleSearchInput.addEventListener('input', () => {
      clearTimeout(peopleSearchTimer);
      peopleSearchTimer = setTimeout(updatePeopleSuggestions, 220);
    });
  }
  const peopleSearchForm = $('#peopleSearchForm');
  if (peopleSearchForm) peopleSearchForm.addEventListener('submit', event => {
    event.preventDefault();
    runPeopleSearch();
  });
  let peopleSearchTimer = null;
  let peopleSearchRequest = 0;
  let activePeopleSearchQuery = '';

  function normalizePeopleQuery(value) {
    return String(value || '').trim().replace(/^@+/, '').toLocaleLowerCase('ar');
  }
  function getProfileDisplayName(profile) {
    return String(profile.full_name || profile.name || profile.display_name || profile.username || 'مستخدم EgyBook').trim();
  }
  function getProfileAvatar(profile) {
    return profile.avatar_url || profile.avatar || profile.profile_picture || profile.photo_url || '';
  }
  function profileSearchCard(profile, compact=false) {
    const username = cleanUsername(profile.username || '');
    const name = getProfileDisplayName(profile);
    const avatar = getProfileAvatar(profile);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `people-search-result${compact ? ' people-search-result-compact' : ''}`;
    row.dataset.action = 'open-search-profile';
    row.dataset.username = username;
    row.setAttribute('role', compact ? 'option' : 'listitem');
    const image = document.createElement('span');
    image.className = 'people-search-avatar';
    if (avatar) {
      const img = document.createElement('img');
      img.src = avatar; img.alt = ''; img.loading = 'lazy';
      img.onerror = () => { img.remove(); image.textContent = name.slice(0,1).toUpperCase(); };
      image.append(img);
    } else image.textContent = name.slice(0,1).toUpperCase();
    const copy = document.createElement('span'); copy.className = 'people-search-result-copy';
    const display = document.createElement('strong'); display.textContent = name;
    const handle = document.createElement('span'); handle.textContent = '@' + username;
    const bio = document.createElement('small'); bio.textContent = String(profile.bio || profile.about || '');
    copy.append(display, handle);
    if (bio.textContent) copy.append(bio);
    const arrow = document.createElement('span'); arrow.className = 'people-search-result-arrow'; arrow.textContent = '›';
    row.append(image, copy, arrow);
    return row;
  }
  async function fetchPeopleMatches(rawQuery, limit=8) {
    if (!supabase) return [];
    const query = normalizePeopleQuery(rawQuery);
    if (!query) return [];
    const pattern = `%${query.replace(/[%_,]/g, '')}%`;
    const queries = [
      supabase.from('profiles').select('*').ilike('username', pattern).limit(limit),
      supabase.from('profiles').select('*').ilike('full_name', pattern).limit(limit),
      supabase.from('profiles').select('*').ilike('name', pattern).limit(limit)
    ];
    const responses = await Promise.all(queries.map(p => p.then(r => r).catch(() => ({data:[], error:true}))));
    const byId = new Map();
    for (const response of responses) {
      for (const profile of (response && response.data) || []) {
        const key = String(profile.id || profile.user_id || profile.username || '');
        if (key && !byId.has(key) && profile.username) byId.set(key, profile);
      }
    }
    const q = query.toLocaleLowerCase('ar');
    return [...byId.values()].sort((a,b) => {
      const au = String(a.username || '').toLocaleLowerCase('ar');
      const bu = String(b.username || '').toLocaleLowerCase('ar');
      const an = getProfileDisplayName(a).toLocaleLowerCase('ar');
      const bn = getProfileDisplayName(b).toLocaleLowerCase('ar');
      const score = p => p === q ? 0 : p.startsWith(q) ? 1 : p.includes(q) ? 2 : 3;
      return Math.min(score(au), score(an)) - Math.min(score(bu), score(bn)) || an.localeCompare(bn, 'ar');
    }).slice(0, limit);
  }
  function renderSearchMessage(container, message, className='search-empty-state') {
    container.replaceChildren();
    const note = document.createElement('div'); note.className = className; note.textContent = message; container.append(note);
  }
  async function updatePeopleSuggestions() {
    const input = $('#searchInput');
    const box = $('#searchSuggestions');
    if (!input || !box) return;
    const query = input.value.trim();
    const requestId = ++peopleSearchRequest;
    if (!normalizePeopleQuery(query)) {
      renderSearchMessage(box, 'ابدأ بكتابة اسم أو @اسم المستخدم للعثور على حساب.', 'search-start-hint');
      return;
    }
    renderSearchMessage(box, 'جاري البحث عن الحسابات…');
    try {
      const matches = await fetchPeopleMatches(query, 8);
      if (requestId !== peopleSearchRequest || input.value.trim() !== query) return;
      box.replaceChildren();
      if (!matches.length) {
        renderSearchMessage(box, 'لا توجد حسابات مطابقة حتى الآن.');
        return;
      }
      matches.forEach(profile => box.append(profileSearchCard(profile, true)));
      const all = document.createElement('button');
      all.type = 'button'; all.className = 'search-view-all'; all.dataset.action = 'run-search';
      all.textContent = `عرض كل النتائج عن «${query}»`;
      box.append(all);
    } catch (_) {
      renderSearchMessage(box, 'تعذر تحميل الحسابات. تحقق من الاتصال وحاول مرة أخرى.');
    }
  }
  async function runPeopleSearch() {
    const input = $('#searchInput');
    const query = input ? input.value.trim() : '';
    if (!normalizePeopleQuery(query)) {
      showToast('اكتب اسم الحساب أو اسم المستخدم أولًا.');
      input?.focus();
      return;
    }
    activePeopleSearchQuery = query;
    closeModal($('#searchModal'));
    closeNotifications();
    const page = $('#peopleSearchPage');
    const results = $('#peopleSearchResults');
    if (!page || !results) return;
    $('.container').hidden = true;
    $('#profilePage').hidden = true;
    $('#memezPage').hidden = true;
    restoreCommentsSheetToModal();
    const postViewer = $('#postViewer'); if (postViewer) postViewer.hidden = true;
    page.hidden = false;
    $('#peopleSearchQueryLabel').textContent = `الحسابات المطابقة لـ «${query}»`;
    renderSearchMessage(results, 'جاري البحث عن الحسابات…');
    history.pushState({page:'people-search', query}, '', SITE_BASE_PATH + 'search?q=' + encodeURIComponent(query));
    window.scrollTo({top:0, behavior:'auto'});
    const requestId = ++peopleSearchRequest;
    try {
      const matches = await fetchPeopleMatches(query, 50);
      if (requestId !== peopleSearchRequest) return;
      results.replaceChildren();
      if (!matches.length) {
        renderSearchMessage(results, 'لم نعثر على حسابات بهذا الاسم. جرّب الاسم الكامل أو اسم المستخدم.');
        return;
      }
      matches.forEach(profile => results.append(profileSearchCard(profile, false)));
      const count = document.createElement('p'); count.className = 'search-results-count';
      count.textContent = `تم العثور على ${matches.length} حساب${matches.length === 1 ? '' : 'ات'}.`;
      results.prepend(count);
    } catch (_) {
      renderSearchMessage(results, 'حدث خطأ أثناء البحث. حاول مرة أخرى.');
    }
  }
  function runSearch() { return runPeopleSearch(); }
  function openPeopleSearch() {
    const page = $('#peopleSearchPage'); if (page) page.hidden = true;
    const overlay = $('#searchModal');
    if (overlay && !overlay.classList.contains('open')) {
      window.__egybookSearchPreviousState = history.state || {};
      history.pushState({ ...(history.state || {}), egybookSearchOverlay: true }, '', location.href);
    }
    openModal(overlay);
    const input = $('#searchInput');
    if (input) { input.value = ''; updatePeopleSuggestions(); setTimeout(() => input.focus(), 60); }
  }
  function closePeopleSearchPage() {
    const page = $('#peopleSearchPage'); if (page) page.hidden = true;
    $('.container').hidden = false;
    $('#profilePage').hidden = true;
    setPage('home', {push:false});
    history.replaceState({page:'home'}, '', SITE_BASE_PATH);
  }


  const POST_CONTROLS = [
    ['pin','pin','تثبيت المنشور','سيظهر في أعلى منشورات ملفك الشخصي'],
    ['save','save','حفظ المنشور','إضافة المنشور إلى العناصر المحفوظة'],
    ['edit','edit','تعديل المنشور','تعديل النص والخصوصية'],
    ['comments','comments','من يمكنه التعليق على منشورك؟','اختيار إعدادات التعليقات'],
    ['privacy','privacy','تعديل الخصوصية','تغيير الجمهور الذي يمكنه رؤية المنشور'],
    ['archive','archive','نقل إلى الأرشيف','إخفاء المنشور دون حذفه'],
    ['trash','trash','نقل إلى سلة المهملات','إخفاء المنشور محليًا'],
    ['notifications','notifications','إيقاف إشعارات المنشور','إعداد محلي تجريبي'],
    ['copy','copy','نسخ الرابط','نسخ رابط المنشور']
  ];
  function openPostControls(post){
    if(!post)return;
    const host=$('#postControlsItems');host.replaceChildren();
    POST_CONTROLS.forEach(([key,icon,title,desc])=>{
      const b=document.createElement('button');b.type='button';b.className='post-control-item'+(key==='trash'?' danger':'');b.dataset.action='post-control';b.dataset.control=key;
      const paths={pin:'<path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6ZM12 14v7"/>',save:'<path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v16L12 17l-7.5 4V5A1.5 1.5 0 0 1 6 3.5Z"/>',edit:'<path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Z"/><path d="m14.8 6.7 3 3"/>',comments:'<path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 21 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',privacy:'<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z"/>',archive:'<path d="M3 5h18v4H3zM5 9v11h14V9M9 13h6"/>',trash:'<path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/><path d="m4 4 16 16"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'};
      const state=postState[String(currentMenuPost?.dataset.postId)]||{};
      const label=key==='pin'&&state.pinned?'إلغاء تثبيت المنشور':title;
      b.innerHTML=`<span class="pc-icon pc-${key}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[key]||''}</svg></span><span class="pc-copy"><strong>${label}</strong><small>${desc}</small></span>`;
      host.append(b);
    });
    const sheet=$('#postControlsModal');
    if(sheet){
      sheet.classList.remove('post-sheet-dismissing');
      const box=sheet.querySelector('.post-controls-box');
      if(box){box.style.transition='';box.style.transform='';}
      sheet.setAttribute('aria-hidden','false');
      document.body.classList.add('post-controls-open');
    }
    openModal(sheet);
    // Desktop only: show a Facebook-like contextual popover beside the post menu button.
    // Mobile keeps the existing bottom sheet and finger-drag behavior unchanged.
    if (sheet && window.matchMedia('(min-width: 900px)').matches) {
      const box = sheet.querySelector('.post-controls-box');
      const trigger = currentMenuPost?.querySelector('[data-action="post-menu"]');
      if (box && trigger) {
        const placeDesktopPopover = () => {
          if (!sheet.classList.contains('open') || !window.matchMedia('(min-width: 900px)').matches) return;
          const r = trigger.getBoundingClientRect();
          const margin = 12;
          const width = Math.min(360, window.innerWidth - margin * 2);
          box.style.width = `${width}px`;
          box.style.maxWidth = `${width}px`;
          box.style.maxHeight = `${Math.max(240, window.innerHeight - margin * 2)}px`;
          box.style.position = 'fixed';
          box.style.margin = '0';
          box.style.transform = '';
          const left = Math.max(margin, Math.min(r.right - width, window.innerWidth - width - margin));
          const height = box.getBoundingClientRect().height;
          let top = r.bottom + 8;
          if (top + height > window.innerHeight - margin) top = r.top - height - 8;
          top = Math.max(margin, Math.min(top, window.innerHeight - Math.min(height, window.innerHeight - margin) - margin));
          box.style.left = `${left}px`;
          box.style.top = `${top}px`;
        };
        requestAnimationFrame(placeDesktopPopover);
        sheet.__desktopPopoverCleanup?.();
        const onReposition = () => placeDesktopPopover();
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        sheet.__desktopPopoverCleanup = () => {
          window.removeEventListener('resize', onReposition);
          window.removeEventListener('scroll', onReposition, true);
        };
      }
    }
  }
  function handlePostControl(control){
    const post=currentMenuPost;if(!post)return;
    const id=post.dataset.postId||`demo-${Date.now()}`;const state=postState[id]||(postState[id]={});
    if(control==='pin'){if(post.dataset.userPost!=='true'||!currentUser){showToast('يمكنك تثبيت منشوراتك أنت فقط بعد تسجيل الدخول.');return;}state.pinned=!state.pinned;syncPinnedBadge(post);savePostState();(async()=>{try{const {error}=await supabase.from('posts').update({pinned_at:state.pinned?new Date().toISOString():null}).eq('id',id).eq('user_id',currentUser.id);if(error)throw error;if(currentPage==='profile')await renderProfilePosts();showToast(state.pinned?'تم تثبيت المنشور في ملفك الشخصي.':'تم إلغاء تثبيت المنشور.');}catch(e){state.pinned=!state.pinned;syncPinnedBadge(post);showToast('تعذر حفظ التثبيت في قاعدة البيانات. تأكد من تشغيل ترحيل EGYBOOK_POST_PINNED_MIGRATION.sql.');}})();}
    else if(control==='save'){const b=$('[data-action="save"]',post);if(b){b.classList.toggle('saved');const saved=b.classList.contains('saved');$('span:last-child',b).textContent=saved?'تم الحفظ':'حفظ';state.saved=saved;showToast(saved?'تم حفظ المنشور.':'تم إلغاء حفظ المنشور.');}}
    else if(control==='edit'){
      if(post.dataset.userPost!=='true'){showToast('يمكنك تعديل منشوراتك التي نشرتها من هذا الجهاز فقط.');return;}
      openEditPost(post);return;
    }
    else if(control==='product'){showToast('إدارة المنتج تحتاج إلى إعداد متجر وقاعدة بيانات.');}
    else if(control==='comments'){const choice=prompt('من يمكنه التعليق؟ اكتب: الجميع أو الأصدقاء أو لا أحد','الجميع');if(choice===null)return;post.dataset.commentPrivacy=choice;state.commentPrivacy=choice;showToast('تم حفظ اختيار التعليقات محليًا: '+choice);}
    else if(control==='privacy'){openPostPrivacyEditor(post);return;}
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
  function openPostImageViewer(post,{push=true,index=0}={}){
    if(!post)return false;
    const first=post.querySelector('.post-image');
    if(!first||first.tagName!=='IMG')return false;
    let urls=[];
    try{urls=JSON.parse(post.dataset.mediaUrls||'[]');}catch(_){}
    if(!Array.isArray(urls)||!urls.length)urls=[first.currentSrc||first.src];
    urls=urls.filter(Boolean).slice(0,10);
    const author=$('.author-name',post)?.textContent||'EgyBook';
    const caption=$('.post-text',post)?.textContent||'';
    const date=$('.post-meta',post)?.textContent||'';
    const avatar=getPostAvatarUrl(post)||profileData.avatar||'';
    const items=urls.map((src,i)=>({id:`post-${post.dataset.postId||'image'}`,postId:String(post.dataset.postId||''),src,originalSrc:src,thumbSrc:src,author,avatar,caption,date,postElement:post,width:i===0?first.naturalWidth:undefined,height:i===0?first.naturalHeight:undefined}));
    openImageViewer(items,Math.max(0,Math.min(index,items.length-1)),post,{push});
    return true;
  }
  function openImageViewer(items,index=0,post=null,{push=true}={}){
    imageViewerItems=(items||[]).filter(x=>x&&x.src);
    if(!imageViewerItems.length)return showToast('لا توجد صورة متاحة للمعاينة.');
    imageViewerIndex=Math.max(0,Math.min(index,imageViewerItems.length-1));
    imageViewerPost=post||imageViewerItems[imageViewerIndex]?.postElement||null;
    imageViewerReturnY=window.scrollY;
    imageViewerHistoryPushed=!!push;
    imageViewerZoom=1;imageViewerGesture={panX:0,panY:0};
    const viewer=$('#imageViewer'); viewer.classList.remove('image-viewer-controls-hidden'); viewer.setAttribute('data-controls-hidden','false'); const moreMenu=$('#imageViewerMoreMenu'); if(moreMenu)moreMenu.hidden=true; viewer.hidden=false; viewer.setAttribute('aria-hidden','false'); document.body.classList.add('image-viewer-open');
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
    const localState=postState[postId]||{};
    if(!supabase){reactions.textContent=`${localState.reaction?1:0} تفاعل`;comments.textContent=`${post?getCommentsFor(post).length:0} تعليق`;icons.textContent=localState.reaction||'👍';return;}
    try{
      const table=postId?'post_reactions':'photo_reactions',commentTable=postId?'post_comments':'photo_comments',key=postId?'post_id':'photo_id',value=postId||photoId;
      if(!value)return;
      const [r,c]=await Promise.all([
        supabase.from(table).select('user_id,reaction').eq(key,value),
        supabase.from(commentTable).select('id',{count:'exact',head:true}).eq(key,value)
      ]);
      if(!r.error){const rows=r.data||[];reactions.textContent=`${rows.length} تفاعل`;const mine=rows.find(x=>currentUser?.id&&String(x.user_id)===String(currentUser.id));const selected=mine?.reaction||localState.reaction||'👍';icons.textContent=selected;const likeButton=$('#imageViewer .iv-like');if(likeButton){likeButton.dataset.selectedReaction=selected;likeButton.classList.toggle('is-reacted',!!mine||!!localState.reaction);}}
      if(!c.error)comments.textContent=`${c.count||0} تعليق`;
    }catch(_){}
  }
  function getPostAvatarUrl(post){
    if(!post)return '';
    const avatar=post.querySelector('.post-header .avatar, .post-author-avatar, .author-avatar, .post-avatar');
    if(!avatar)return '';
    const style=getComputedStyle(avatar);
    const bg=style.backgroundImage||'';
    const match=bg.match(/^url\(["']?(.*?)["']?\)$/);
    if(match&&match[1]&&!/^(none|data:image\/svg)/i.test(match[1]))return match[1];
    const image=avatar.querySelector('img');
    return image?.currentSrc||image?.src||'';
  }
  function isPostAuthorVerified(post){
    const badge=post?.querySelector('.post-author .verified-badge, .post-author [data-verified-badge], .post-author .verified-badge-active, .post-author svg[aria-label*="موثق"]');
    return !!badge && !badge.classList.contains('verified-badge-inactive') && /موثّق|موثق/.test(String(badge.title||badge.getAttribute('aria-label')||'')) && !/طلب توثيق/.test(String(badge.title||'')) && badge.getAttribute('aria-hidden')!=='true';
  }
  function renderImageViewer(){
    const item=imageViewerItems[imageViewerIndex];if(!item)return;
    const image=$('#imageViewerImage');image.src=item.originalSrc||item.src;image.alt=item.caption||'صورة على EgyBook';image.style.transform=`translate3d(${imageViewerGesture?.panX||0}px,${imageViewerGesture?.panY||0}px,0) scale(${imageViewerZoom})`;image.style.cursor=imageViewerZoom>1?'grab':'default';
    $('#imageViewerCounter').textContent=`${imageViewerIndex+1} / ${imageViewerItems.length}`;
    const authorPost=getViewerPost();
    const authorName=(item.author||$('.author-name',authorPost)?.textContent||profileData.name||'EgyBook').replace(/\s+/g,' ').trim();
    $('#imageViewerAuthor').textContent=authorName;
    $('#imageViewerCaption').textContent=item.caption||'';
    const viewerMusic=$('#imageViewerMusic'),musicCard=authorPost?.querySelector('[data-post-music-player]');
    if(viewerMusic){
      viewerMusic.hidden=!musicCard;
      if(musicCard){
        $('#imageViewerMusicTitle').textContent=musicCard.querySelector('.post-music-copy strong')?.textContent||'';
        $('#imageViewerMusicArtist').textContent=musicCard.querySelector('.post-music-copy small')?.textContent||'';
        viewerMusic.classList.toggle('is-playing',musicCard.classList.contains('is-playing'));
        const viewerMute=$('[data-action="image-music-mute"]',viewerMusic);if(viewerMute){viewerMute.textContent=musicCard.dataset.muted==='true'?'🔇':'🔊';viewerMute.setAttribute('aria-label',musicCard.dataset.muted==='true'?'إلغاء كتم الصوت':'كتم صوت الأغنية');}
      }
    }
    $('#imageViewerDate').textContent=item.date||'';
    const avatar=$('#imageViewerAvatar'),avatarUrl=authorPost?(getPostAvatarUrl(authorPost)||''):item.avatar;
    avatar.textContent=(authorName||'E').trim().slice(0,1);
    if(avatarUrl){avatar.style.backgroundImage=`url("${String(avatarUrl).replace(/"/g,'%22')}")`;avatar.textContent='';}else avatar.style.backgroundImage='';
    const verified=$('#imageViewerVerified');
    if(verified){verified.hidden=!(item.verified===true||isPostAuthorVerified(authorPost));}
    $('#imageViewerResolution').textContent=item.width&&item.height?`${item.width} × ${item.height}`:'الصورة الأصلية';
    const viewerPostId=String(item?.postId||authorPost?.dataset.postId||'');const shareCount=$('#imageViewerShareCount');const shareText=authorPost?$('.share-count',authorPost)?.textContent:'';if(shareCount)shareCount.textContent=formatPostCount(Number(postState[viewerPostId]?.shareCount||String(shareText||'').replace(/[^0-9]/g,'')||0));
    $('#imageViewerZoom').textContent=`${Math.round(imageViewerZoom*100)}%`;
    const thumbs=$('#imageViewerThumbs');thumbs.replaceChildren();thumbs.hidden=imageViewerItems.length<2;
    if(imageViewerItems.length>1){
      imageViewerItems.forEach((entry,i)=>{const b=document.createElement('button');b.type='button';b.className='image-viewer-thumb'+(i===imageViewerIndex?' active':'');b.setAttribute('aria-label',`الصورة ${i+1}`);const im=document.createElement('img');im.src=entry.thumbSrc||entry.src;im.alt='';b.append(im);b.addEventListener('click',()=>{imageViewerIndex=i;imageViewerZoom=1;imageViewerGesture={panX:0,panY:0};renderImageViewer();});thumbs.append(b);});
      thumbs.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
    }
    loadViewerCloudStats(item,getViewerPost());
  }
  function closeImageViewer({historyBack=true}={}){
    const viewer=$('#imageViewer');if(!viewer||viewer.hidden)return;
    viewer.hidden=true;viewer.setAttribute('aria-hidden','true');viewer.classList.remove('image-viewer-controls-hidden');
    const moreMenu=$('#imageViewerMoreMenu');if(moreMenu)moreMenu.hidden=true;
    document.body.classList.remove('image-viewer-open');
    if(historyBack && /^\/Egybook\/(photo|profile-photo|cover-photo)\//i.test(location.pathname)){
      if(imageViewerHistoryPushed){imageViewerHistoryPushed=false;history.back();return;}
      history.replaceState({page:'home'},'','/Egybook/');
      routeFromLocation();
    }
    requestAnimationFrame(()=>window.scrollTo({top:imageViewerReturnY,behavior:'auto'}));
  }
  function stepImage(delta){if(!imageViewerItems.length)return;imageViewerIndex=(imageViewerIndex+delta+imageViewerItems.length)%imageViewerItems.length;imageViewerZoom=1;imageViewerGesture={panX:0,panY:0};renderImageViewer();}
  // Single tap toggles viewer chrome; pinch zoom and horizontal swipe are handled on the stage.
  let imageViewerPointers=new Map(), imageViewerGesture=null, imageViewerTapAt=0, imageViewerTapPoint=null, imageViewerSingleTapTimer=0;
  function setImageViewerControlsHidden(hidden){
    const viewer=$('#imageViewer');if(!viewer)return;
    viewer.classList.toggle('image-viewer-controls-hidden',!!hidden);
    viewer.setAttribute('data-controls-hidden',String(!!hidden));
    const controls=viewer.querySelectorAll('.iv-topbar,.iv-counter,.iv-caption-card,.iv-bottom-bar');
    controls.forEach(el=>{el.setAttribute('aria-hidden',String(!!hidden));});
  }
  function applyViewerTransform(){
    const image=$('#imageViewerImage');if(!image)return;
    const x=imageViewerGesture?.panX||0,y=imageViewerGesture?.panY||0;
    image.style.transform=`translate3d(${x}px,${y}px,0) scale(${imageViewerZoom})`;
    image.style.cursor=imageViewerZoom>1?'grab':'default';
    const label=$('#imageViewerZoom');if(label)label.textContent=`${Math.round(imageViewerZoom*100)}%`;
  }
  (function bindImageViewerGestures(){
    const stage=$('#imageViewerStage'),image=$('#imageViewerImage');if(!stage||!image)return;
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    stage.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      imageViewerPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      try{stage.setPointerCapture(event.pointerId);}catch(_){}
      if(imageViewerPointers.size===1){
        imageViewerGesture={startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,panX:imageViewerGesture?.panX||0,panY:imageViewerGesture?.panY||0,moved:false};
      }else if(imageViewerPointers.size===2){
        const pts=[...imageViewerPointers.values()];
        imageViewerGesture={...(imageViewerGesture||{}),pinchStart:distance(pts[0],pts[1]),zoomStart:imageViewerZoom,panX:imageViewerGesture?.panX||0,panY:imageViewerGesture?.panY||0,moved:true};
      }
    });
    stage.addEventListener('pointermove',event=>{
      if(!imageViewerPointers.has(event.pointerId))return;
      imageViewerPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const pts=[...imageViewerPointers.values()];
      if(pts.length>=2){
        const d=distance(pts[0],pts[1]);
        if(imageViewerGesture?.pinchStart){imageViewerZoom=Math.max(1,Math.min(4,(imageViewerGesture.zoomStart||1)*(d/imageViewerGesture.pinchStart)));applyViewerTransform();}
        return;
      }
      if(!imageViewerGesture)return;
      const dx=event.clientX-imageViewerGesture.startX,dy=event.clientY-imageViewerGesture.startY;
      if(Math.abs(dx)>6||Math.abs(dy)>6)imageViewerGesture.moved=true;
      if(imageViewerZoom>1&&imageViewerGesture.moved){
        imageViewerGesture.panX=(imageViewerGesture.panX||0)+(event.clientX-(imageViewerGesture.lastX||event.clientX));
        imageViewerGesture.panY=(imageViewerGesture.panY||0)+(event.clientY-(imageViewerGesture.lastY||event.clientY));
        applyViewerTransform();
      }
      imageViewerGesture.lastX=event.clientX;imageViewerGesture.lastY=event.clientY;
    });
    const finish=event=>{
      if(!imageViewerPointers.has(event.pointerId))return;
      const point=imageViewerPointers.get(event.pointerId),wasPinch=!!imageViewerGesture?.pinchStart;
      imageViewerPointers.delete(event.pointerId);
      if(imageViewerPointers.size===0){
        const g=imageViewerGesture;imageViewerGesture=null;
        const menuOpen=$('#imageViewerMoreMenu')&&!$('#imageViewerMoreMenu').hidden;
        if(g&&!g.moved&&!wasPinch&&point&&!menuOpen){
          const now=Date.now();
          if(now-imageViewerTapAt<=300){
            if(imageViewerSingleTapTimer){clearTimeout(imageViewerSingleTapTimer);imageViewerSingleTapTimer=0;}
            if(imageViewerZoom>1.01){
              imageViewerZoom=1;imageViewerGesture={panX:0,panY:0};
            }else{
              const stageRect=stage.getBoundingClientRect(),scale=2.25;
              const centerX=stageRect.left+stageRect.width/2,centerY=stageRect.top+stageRect.height/2;
              imageViewerZoom=scale;
              imageViewerGesture={panX:(centerX-point.x)*(scale-1),panY:(centerY-point.y)*(scale-1)};
            }
            applyViewerTransform();imageViewerTapAt=0;imageViewerTapPoint=null;
          }else{
            imageViewerTapAt=now;imageViewerTapPoint=point;
            if(imageViewerSingleTapTimer)clearTimeout(imageViewerSingleTapTimer);
            imageViewerSingleTapTimer=setTimeout(()=>{
              imageViewerSingleTapTimer=0;
              if(!$('#imageViewer')?.hidden && !($('#imageViewerMoreMenu')&&!$('#imageViewerMoreMenu').hidden)){
                setImageViewerControlsHidden(!$('#imageViewer').classList.contains('image-viewer-controls-hidden'));
              }
            },300);
          }
        }else if(g&&g.moved&&imageViewerZoom<=1.01){
          const dx=event.clientX-g.startX,dy=event.clientY-g.startY;
          if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2)stepImage(dx<0?1:-1);
        }
        if(imageViewerZoom<=1.01){imageViewerZoom=1;imageViewerGesture={panX:0,panY:0};}
        else if(!imageViewerGesture||imageViewerGesture.startX===undefined){imageViewerGesture={panX:imageViewerGesture?.panX??g?.panX??0,panY:imageViewerGesture?.panY??g?.panY??0};}
        applyViewerTransform();
      }else if(imageViewerPointers.size===1){
        const remaining=[...imageViewerPointers.values()][0];
        imageViewerGesture={startX:remaining.x,startY:remaining.y,lastX:remaining.x,lastY:remaining.y,moved:true,panX:imageViewerGesture?.panX||0,panY:imageViewerGesture?.panY||0};
      }
    };
    stage.addEventListener('pointerup',finish);
    stage.addEventListener('pointercancel',finish);
    stage.addEventListener('lostpointercapture',finish);
  })();
  document.addEventListener('keydown',event=>{if($('#imageViewer')?.hidden)return;if(event.key==='Escape'){event.preventDefault();closeImageViewer();}else if(event.key==='ArrowLeft'){stepImage(1);}else if(event.key==='ArrowRight'){stepImage(-1);}});
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
  async function applyImageViewerReaction(emoji){
    const item=imageViewerItems[imageViewerIndex],post=getViewerPost(),button=$('#imageViewer .iv-like');
    if(!item||!button)return;
    if(post){await selectReaction(post,emoji,reactionLabels[emoji]||'تفاعل');button.dataset.selectedReaction=emoji;$('#imageViewerReactionIcons').textContent=emoji;button.classList.add('is-reacted');renderImageViewer();return;}
    if(!supabase||!currentUser||!item.id){showToast('سجّل الدخول لحفظ التفاعل على الصورة.');return;}
    try{
      const {data,error}=await supabase.from('photo_reactions').select('reaction').eq('photo_id',String(item.id)).eq('user_id',currentUser.id).maybeSingle();if(error)throw error;
      let result;if(data?.reaction===emoji)result=await supabase.from('photo_reactions').delete().eq('photo_id',String(item.id)).eq('user_id',currentUser.id);else result=await supabase.from('photo_reactions').upsert({photo_id:String(item.id),user_id:currentUser.id,reaction:emoji,updated_at:new Date().toISOString()},{onConflict:'photo_id,user_id'});
      if(result?.error)throw result.error;button.dataset.selectedReaction=data?.reaction===emoji?'👍':emoji;$('#imageViewerReactionIcons').textContent=button.dataset.selectedReaction;button.classList.toggle('is-reacted',data?.reaction!==emoji);await loadViewerCloudStats(item,post);
    }catch(error){console.error('Photo reaction failed:',error);showToast('تعذر حفظ التفاعل. حاول مرة أخرى.');}
  }
  async function showViewerReactions(){
    const item=imageViewerItems[imageViewerIndex],post=getViewerPost(),postId=String(item?.postId||post?.dataset.postId||''),photoId=String(item?.id||'');
    if(post){showPostReactions(post);return;}
    if(!supabase){if(post)showPostReactions(post);else showToast('التفاعلات السحابية تحتاج إلى إعداد Supabase وتسجيل الدخول.');return;}
    let modal=$('#postReactionsModal');
    if(!modal){modal=document.createElement('section');modal.id='postReactionsModal';modal.className='modal reaction-details-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','تفاصيل التفاعلات');modal.innerHTML=`<div class="reaction-details-sheet"><div class="comments-handle"></div><header class="reaction-details-head"><button type="button" class="comments-close" data-action="close-modal" aria-label="إغلاق">×</button><h2>التفاعلات</h2><span class="reaction-details-head-spacer" aria-hidden="true"></span></header><div class="reaction-details-filter" id="reactionDetailsFilterBar" aria-label="أنواع التفاعلات"><button type="button" class="reaction-filter-chip active" data-reaction-filter="all">الكل <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="👍">👍 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="❤️">❤️ <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😍">😍 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😂">😂 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😮">😮 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😢">😢 <strong>0</strong></button><button type="button" class="reaction-filter-chip" data-reaction-filter="😡">😡 <strong>0</strong></button></div><div id="postReactionsList" class="reaction-details-list" aria-live="polite"></div></div>`;document.body.append(modal);}
    const list=$('#postReactionsList');list.replaceChildren();const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التفاعلات…';list.append(loading);
    const filterBar=$('#reactionDetailsFilterBar');if(filterBar){filterBar.onclick=event=>{const chip=event.target.closest('[data-reaction-filter]');if(!chip)return;filterBar.dataset.activeFilter=chip.dataset.reactionFilter||'all';filterBar.querySelectorAll('[data-reaction-filter]').forEach(item=>{const active=item===chip;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});list.querySelectorAll('.reaction-person-row').forEach(row=>{row.hidden=filterBar.dataset.activeFilter!=='all'&&row.dataset.reactionEmoji!==filterBar.dataset.activeFilter;});};if(!filterBar.dataset.viewerSwipeReady){filterBar.dataset.viewerSwipeReady='1';let startY=null,touchY=null;const changeBySwipe=dy=>{if(Math.abs(dy)<42)return;const values=['all','👍','❤️','😍','😂','😮','😢','😡'],current=filterBar.dataset.activeFilter||'all',index=Math.max(0,values.indexOf(current)),next=Math.max(0,Math.min(values.length-1,index+(dy<0?1:-1))),chip=filterBar.querySelector(`[data-reaction-filter="${values[next]}"]`);chip?.click();};filterBar.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')startY=event.clientY;},{passive:true});filterBar.addEventListener('pointerup',event=>{if(startY===null)return;const dy=event.clientY-startY;startY=null;changeBySwipe(dy);},{passive:true});filterBar.addEventListener('touchstart',event=>{touchY=event.touches?.[0]?.clientY??null;},{passive:true});filterBar.addEventListener('touchend',event=>{if(touchY===null)return;const dy=(event.changedTouches?.[0]?.clientY??touchY)-touchY;touchY=null;changeBySwipe(dy);},{passive:true});}}
    pushOverlayHistory(modal,'reactions');openModal(modal);
    try{
      const table=postId?'post_reactions':'photo_reactions',key=postId?'post_id':'photo_id',value=postId||photoId;
      const {data,error}=await supabase.from(table).select('user_id,reaction,profiles(full_name,username,avatar_url)').eq(key,value).order('created_at',{ascending:false});
      list.replaceChildren();
      if(error)throw error;
      if(!data?.length){const empty=document.createElement('p');empty.className='empty-message';empty.textContent='لا توجد تفاعلات حتى الآن.';list.append(empty);return;}
      data.forEach(row=>{const el=document.createElement('div');el.className='reaction-person-row';const avatar=document.createElement('span');avatar.className='avatar';const profile=row.profiles||{};if(profile.avatar_url){avatar.style.backgroundImage=`url("${profile.avatar_url}")`;avatar.style.backgroundSize='cover';avatar.textContent='';}else avatar.textContent=(profile.full_name||'ع').slice(0,1);const name=document.createElement('strong');name.textContent=profile.full_name||profile.username||'عضو EgyBook';const reaction=document.createElement('span');reaction.className='reaction-person-emoji';reaction.textContent=row.reaction||'👍';el.dataset.reactionEmoji=String(row.reaction||'👍');el.append(avatar,name,reaction);list.append(el);});const filterBar=$('#reactionDetailsFilterBar');if(filterBar){const rows=$$('.reaction-person-row',list);filterBar.querySelectorAll('[data-reaction-filter]').forEach(chip=>{const value=chip.dataset.reactionFilter||'all',count=value==='all'?rows.length:rows.filter(row=>row.dataset.reactionEmoji===value).length,strong=$('strong',chip);if(strong)strong.textContent=String(count);});}
    }catch(e){list.replaceChildren();const msg=document.createElement('p');msg.className='empty-message';msg.textContent='تعذر تحميل التفاعلات من السحابة. شغّل تحديث إعدادات Supabase ثم حاول مرة أخرى.';list.append(msg);}
  }
  async function showPhotoComments(item){
    if(!supabase){showToast('تعليقات الصور تحتاج إلى إعداد Supabase.');return;}
    let modal=$('#photoViewerCommentsModal');
    if(!modal){
      modal=document.createElement('div');modal.id='photoViewerCommentsModal';modal.className='modal comments-modal comments-from-image-viewer';modal.hidden=true;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','تعليقات الصورة');
      modal.innerHTML=`<div class="comments-sheet">
        <div class="comments-handle"></div>
        <header class="comments-head"><button type="button" class="comments-close" data-action="close-modal" aria-label="إغلاق">×</button><div class="comments-title"><h2>التعليقات</h2><span id="photoViewerCommentsCount">0 تعليق</span></div><div class="comments-sort-wrap"><span class="comments-sort-label">على الصورة</span></div></header>
        <div id="photoViewerCommentsList" class="comments-list"></div>
        <form id="photoViewerCommentForm" class="comment-compose"><span class="comment-my-avatar" id="photoViewerCommentAvatar">ح</span><div class="comment-input-wrap"><input id="photoViewerCommentInput" maxlength="1000" placeholder="اكتب تعليقك..." required autocomplete="off"></div><button type="button" class="comment-compose-emoji" data-photo-comment-emoji aria-label="إضافة رمز تعبيري"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 14s1.4 2 4 2 4-2 4-2M9 9h.01M15 9h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><button type="button" class="comment-compose-media" data-photo-comment-media aria-label="إرفاق صورة"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="9" r="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 17 5-5 3 3 3-4 5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button><button type="submit" aria-label="إرسال التعليق"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 21 3l-6.5 18-3.2-7.3L3 11.5Zm8.3 2.2L21 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>
      </div>`;
      document.body.append(modal);
      const input=$('#photoViewerCommentInput',modal);input.placeholder=`تعليق باسم ${getActiveProfileName()||'حسابك'}...`;const avatar=$('#photoViewerCommentAvatar',modal);avatar.textContent=(profileData.name||'ح').trim().slice(0,1);if(profileData.avatar){avatar.style.backgroundImage=`url("${String(profileData.avatar).replace(/"/g,'%22')}")`;avatar.style.backgroundSize='cover';avatar.style.backgroundPosition='center';avatar.textContent='';}
      $('#photoViewerCommentForm',modal).addEventListener('submit',async event=>{
        event.preventDefault();const text=input.value.trim(),active=modal.dataset.photoId;if(!text||!active)return;
        if(!currentUser){showToast('سجّل الدخول لإضافة تعليق.');return;}
        const submit=$('button[type="submit"]',event.currentTarget);if(submit.disabled)return;submit.disabled=true;
        try{const {error}=await supabase.from('photo_comments').insert({photo_id:active,user_id:currentUser.id,user_name:getActiveProfileName(),body:text});if(error)throw error;input.value='';await renderPhotoComments(active);renderImageViewer();}
        catch(error){showToast('تعذر حفظ التعليق: '+(error.message||'حاول مرة أخرى.'));}finally{submit.disabled=false;}
      });
      modal.addEventListener('click',event=>{if(event.target===modal)closeModal(modal);});
      modal.querySelector('[data-photo-comment-emoji]')?.addEventListener('click',()=>{const start=input.selectionStart??input.value.length;input.setRangeText('🙂',start,input.selectionEnd??start,'end');input.focus({preventScroll:true});});
      modal.querySelector('[data-photo-comment-media]')?.addEventListener('click',()=>showToast('إرفاق الصور بالتعليقات غير مفعّل في نظام تعليقات الصور الحالي.'));
      const handle=$('.comments-handle',modal);let sy=null;handle?.addEventListener('pointerdown',e=>{sy=e.clientY;},{passive:true});handle?.addEventListener('pointerup',e=>{if(sy!==null&&e.clientY-sy>65)closeModal(modal);sy=null;},{passive:true});handle?.addEventListener('pointercancel',()=>{sy=null;},{passive:true});
    }
    modal.dataset.photoId=String(item.id||'');modal.classList.add('comments-from-image-viewer');await renderPhotoComments(modal.dataset.photoId);pushOverlayHistory(modal,'photo-comments');openModal(modal);
  }
  async function renderPhotoComments(photoId){
    const list=$('#photoViewerCommentsList');if(!list)return;list.replaceChildren();
    const loading=document.createElement('p');loading.className='empty-message';loading.textContent='جارٍ تحميل التعليقات…';list.append(loading);
    const {data,error}=await supabase.from('photo_comments').select('id,user_id,user_name,body,created_at').eq('photo_id',photoId).order('created_at',{ascending:true});
    list.replaceChildren();
    if(error){const p=document.createElement('p');p.className='empty-message';p.textContent='تعذر تحميل التعليقات. تأكد من إعداد Supabase.';list.append(p);$('#photoViewerCommentsCount').textContent='0 تعليق';return;}
    $('#photoViewerCommentsCount').textContent=`${data?.length||0} تعليق`;
    if(!data?.length){const p=document.createElement('p');p.className='comments-empty';p.textContent='كن أول من يعلّق على الصورة.';list.append(p);return;}
    data.forEach(row=>{const article=document.createElement('article');article.className='egy-comment';article.dataset.commentId=String(row.id);const main=document.createElement('div');main.className='egy-comment-main';const meta=document.createElement('div');meta.className='egy-comment-meta';const name=document.createElement('strong');name.className='egy-comment-name';name.textContent=row.user_name||'عضو EgyBook';const time=document.createElement('span');time.textContent='· '+new Date(row.created_at).toLocaleString('ar-EG');meta.append(name,time);const body=document.createElement('div');body.className='egy-comment-text';body.textContent=row.body||'';const actions=document.createElement('div');actions.className='egy-comment-actions';const reply=document.createElement('button');reply.type='button';reply.className='reply';reply.textContent='رد';reply.addEventListener('click',()=>{const input=$('#photoViewerCommentInput');input?.focus({preventScroll:true});if(input)input.placeholder=`الرد على ${row.user_name||'عضو EgyBook'}...`;});actions.append(reply);main.append(meta,body,actions);const avatar=document.createElement('span');avatar.className='egy-comment-avatar';avatar.textContent=(row.user_name||'ع').trim().slice(0,1);article.append(main,avatar);list.append(article);});
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
  let pendingCommentImage = null, pendingCommentAudio = null, pendingCommentAudioDuration = 0, commentMediaRecorder = null, commentRecordingStartedAt = 0, commentRecordingTimer = null;

  function clearPendingCommentAttachment(){
    pendingCommentImage=null;pendingCommentAudio=null;pendingCommentAudioDuration=0;
    const preview=$('#commentAttachmentPreview');if(preview){preview.hidden=true;preview.replaceChildren();}
    const mic=$('[data-comment-compose-action="mic"]');if(mic){mic.classList.remove('recording');mic.setAttribute('aria-label','تسجيل تعليق صوتي');mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';}
  }
  function renderPendingCommentAttachment(){
    const box=$('#commentAttachmentPreview');if(!box)return;box.replaceChildren();
    if(!pendingCommentImage&&!pendingCommentAudio){box.hidden=true;return;}box.hidden=false;
    const label=document.createElement('span');label.className='comment-attachment-label';
    if(pendingCommentImage){const img=document.createElement('img');img.src=URL.createObjectURL(pendingCommentImage);img.alt='معاينة الصورة';box.append(img);label.textContent='صورة جاهزة للإرسال';}
    else {label.textContent=`تسجيل صوتي · ${formatMusicDuration(pendingCommentAudioDuration)}`;}
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','إزالة المرفق');remove.addEventListener('click',clearPendingCommentAttachment);box.append(label,remove);
  }
  $('#commentMediaInput')?.addEventListener('change',event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!file.type.startsWith('image/')){showToast('اختر صورة فقط.');event.target.value='';return;}
    if(file.size>12*1024*1024){showToast('حجم الصورة يجب ألا يتجاوز 12 ميجابايت.');event.target.value='';return;}
    pendingCommentImage=file;pendingCommentAudio=null;pendingCommentAudioDuration=0;renderPendingCommentAttachment();event.target.value='';
  });
  async function toggleCommentVoiceRecording(button){
    if(commentMediaRecorder&&commentMediaRecorder.state==='recording'){commentMediaRecorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){showToast('تسجيل الصوت غير مدعوم في هذا المتصفح.');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder=new MediaRecorder(stream);commentMediaRecorder=recorder;const chunks=[];commentRecordingStartedAt=Date.now();
      button.classList.add('recording');button.setAttribute('aria-label','إيقاف التسجيل');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
      recorder.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);});
      recorder.addEventListener('stop',()=>{
        clearInterval(commentRecordingTimer);commentRecordingTimer=null;stream.getTracks().forEach(track=>track.stop());
        pendingCommentAudio=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});pendingCommentAudioDuration=Math.max(1,Math.round((Date.now()-commentRecordingStartedAt)/1000));pendingCommentImage=null;commentMediaRecorder=null;
        renderPendingCommentAttachment();const mic=$('[data-comment-compose-action="mic"]');if(mic){mic.classList.remove('recording');mic.setAttribute('aria-label','تسجيل تعليق صوتي');mic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';}
      });
      recorder.start();
    }catch(error){showToast('اسمح للمتصفح باستخدام الميكروفون ثم حاول مرة أخرى.');}
  }
  let commentImageReturnState=null,commentImageHistoryActive=false,commentImageSkipPop=false;
  function closeCommentImageViewer({fromPop=false}={}){
    const viewer=$('#commentImageLightbox');if(!viewer?.classList.contains('open'))return;
    viewer.classList.remove('open');commentImageClosingFromPop=!!fromPop;
    if(commentImageHistoryActive&&!fromPop){commentImageHistoryActive=false;commentImageSkipPop=true;try{history.back();}catch(_){commentImageSkipPop=false;}}
    else commentImageHistoryActive=false;
    const state=commentImageReturnState;commentImageReturnState=null;
    requestAnimationFrame(()=>{if(state?.scrollElement?.isConnected)state.scrollElement.scrollTop=state.scrollTop;if(Number.isFinite(state?.windowY))window.scrollTo({top:state.windowY,behavior:'auto'});});
  }
  function openCommentImageViewer(src){
    if(!src)return;let viewer=$('#commentImageLightbox');
    if(!viewer){viewer=document.createElement('div');viewer.id='commentImageLightbox';viewer.className='comment-image-lightbox';viewer.innerHTML='<button type="button" aria-label="إغلاق">×</button><img alt="الصورة المرفقة">';document.body.append(viewer);viewer.addEventListener('click',event=>{if(event.target===viewer||event.target.closest('button'))closeCommentImageViewer();});}
    const scrollElement=$('.comments-modal.open .comments-list, .comments-modal.open .comments-content, .comments-modal.open .comments-body, .comments-modal.open .comments-panel, #postViewer .comments-list, #postViewer .comments-content');
    commentImageReturnState={windowY:window.scrollY,scrollElement:scrollElement||null,scrollTop:scrollElement?.scrollTop||0};
    const img=$('img',viewer);img.src=src;viewer.classList.add('open');
    try{history.pushState({...history.state,egybookCommentImage:true},'',location.href);commentImageHistoryActive=true;}catch(_){commentImageHistoryActive=false;}
  }
  window.addEventListener('popstate',event=>{
    if(commentImageSkipPop){commentImageSkipPop=false;event.stopImmediatePropagation();return;}
    const viewer=$('#commentImageLightbox');
    if(viewer?.classList.contains('open')){
      event.stopImmediatePropagation();event.preventDefault?.();
      closeCommentImageViewer({fromPop:true});
    }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeCommentImageViewer();});
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
      const {data,error}=await supabase.from('post_comments').select('id,user_id,user_name,body,created_at,parent_id,edited_at,image_url,audio_url,audio_duration_seconds').eq('post_id',id).order('created_at',{ascending:true});
      if(error)throw error;
      post.dataset.cloudCommentCount=String((data||[]).length);
      const userIds=[...new Set((data||[]).map(c=>c.user_id).filter(Boolean))];
      const authorProfiles={};
      if(userIds.length){
        const {data:profiles,error:profilesError}=await supabase.from('profiles').select('id,username,avatar_url,full_name').in('id',userIds);
        if(!profilesError)for(const p of (profiles||[]))authorProfiles[p.id]=p;
      }
      let reactionRows=[];
      const commentIds=(data||[]).map(c=>String(c.id));
      if(commentIds.length){
        try{const rr=await supabase.from('post_comment_reactions').select('comment_id,user_id,reaction').in('comment_id',commentIds);if(!rr.error)reactionRows=rr.data||[];else console.warn('Comment reactions table is not ready:',rr.error.message||rr.error);}catch(reactionError){console.warn('Comment reactions could not be loaded:',reactionError);}
      }
      const reactionsByComment={};
      reactionRows.forEach(r=>{const key=String(r.comment_id);(reactionsByComment[key]||(reactionsByComment[key]=[])).push({userId:r.user_id,reaction:r.reaction});});
      const cloudRows=(data||[]).map(c=>{const author=authorProfiles[c.user_id]||{};return {id:String(c.id),parentId:c.parent_id?String(c.parent_id):null,name:author.full_name||c.user_name||'عضو EgyBook',username:author.username||'',avatar:author.avatar_url||'',time:new Date(c.created_at).toLocaleString('ar-EG'),text:c.body,imageUrl:c.image_url||'',audioUrl:c.audio_url||'',audioDuration:Number(c.audio_duration_seconds)||0,editedAt:c.edited_at||null,likes:0,dislikes:0,replies:[],cloud:true,userId:c.user_id,reactions:reactionsByComment[String(c.id)]||[],myReaction:(reactionsByComment[String(c.id)]||[]).find(r=>r.userId===currentUser?.id)?.reaction||null};});
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
  // The handle alone owns the swipe gesture, so normal comment-list scrolling is untouched.
  (function bindCommentsDrawerGesture(){
    const handle=$('#commentsModal .comments-handle');if(!handle)return;
    let startY=null;
    handle.addEventListener('pointerdown',event=>{startY=event.clientY;});
    handle.addEventListener('pointerup',event=>{
      if(startY===null)return;const delta=event.clientY-startY;startY=null;
      if(delta>65){if(document.body.classList.contains('post-route-open'))$('#postViewerContent')?.scrollIntoView({behavior:'smooth',block:'start'});else closeModal($('#commentsModal'));}
    });
    handle.addEventListener('pointercancel',()=>{startY=null;});
  })();
  document.addEventListener('keydown',event=>{
    const target=event.target.closest('#imageViewerReactionCount[role="button"]');
    if(target&&(event.key==='Enter'||event.key===' ')){event.preventDefault();target.click();}
  });
  document.addEventListener('click',event=>{
    const count=event.target.closest('#imageViewerReactionCount[role="button"]');if(!count)return;
    event.preventDefault();event.stopPropagation();
    const post=getViewerPost();if(post)showPostReactions(post);else showViewerReactions();
  },true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-comment-compose-action]');if(!button)return;
    const input=$('#commentInput');if(!input)return;
    if(button.dataset.commentComposeAction==='emoji'){
      const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
      input.value=input.value.slice(0,start)+'🙂'+input.value.slice(end);
      input.focus();input.setSelectionRange(start+2,start+2);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }else if(button.dataset.commentComposeAction==='media'){
      $('#commentMediaInput')?.click();
    }else if(button.dataset.commentComposeAction==='mic'){
      toggleCommentVoiceRecording(button);
    }
  });
  (function bindOverlayEdgeBackGesture(){
    let start=null;
    document.addEventListener('pointerdown',event=>{
      const modal=event.target.closest('#commentsModal.open,#postReactionsModal.open');
      if(!modal||event.pointerType==='mouse')return;
      const edge=22;
      if(event.clientX<=edge||event.clientX>=window.innerWidth-edge){
        start={x:event.clientX,y:event.clientY,id:event.pointerId,modal,edgeSide:event.clientX<=edge?'left':'right'};
      }else start=null;
    },{passive:true});
    document.addEventListener('pointerup',event=>{
      if(!start||event.pointerId!==start.id){start=null;return;}
      const dx=event.clientX-start.x,dy=event.clientY-start.y,modal=start.modal;start=null;
      if(Math.abs(dx)>90&&Math.abs(dy)<65&&((dx>0&&event.clientX>22)||(dx<0&&event.clientX<window.innerWidth-22))){
        if(modal?.classList.contains('open'))closeModal(modal);
      }
    },{passive:true});
    document.addEventListener('pointercancel',()=>{start=null;},{passive:true});
  })();
  function openComments(post,{push=false,commentId=null}={}){
    if(!post)return;
    const postId=String(post.dataset.postId||'');
    const sourcePost=post.matches('.post-viewer-post')&&postId?$(`[data-post-id="${CSS.escape(postId)}"]`,postsList)||post:post;
    activeCommentsPost=sourcePost;
    highlightCommentId=commentId ? String(commentId) : null;
    applyCommentComposerAvatar();
    if(push && postId && !document.body.classList.contains('post-route-open')){
      // Open a dedicated post route so comments render directly beneath the post,
      // rather than in the full-screen comments overlay.
      openPostRoute(postId,{push:true,commentId});
      return;
    }
    loadCloudComments(sourcePost);
    replyToComment=null;
    const input=$('#commentInput');
    if(input){input.blur();input.value='';input.placeholder=`تعليق باسم ${getActiveProfileName()} ...`;}
    const sortMenu=$('#commentsSortMenu');if(sortMenu)sortMenu.hidden=true;
    const sortButton=$('#commentsSortButton');if(sortButton)sortButton.setAttribute('aria-expanded','false');
    renderComments();
    if(document.body.classList.contains('post-route-open')&&!$('#postViewer').hidden){
      mountCommentsSheetInPostViewer();
      $('#postViewerComments')?.scrollIntoView({behavior:'smooth',block:'start'});
    }else{
      ensureCommentsSheetInModal();
      const commentsModal=$('#commentsModal');
      if(commentsModal)commentsModal.classList.toggle('comments-from-image-viewer',document.body.classList.contains('image-viewer-open'));
      pushOverlayHistory(commentsModal,'comments');
      openModal(commentsModal);
    }
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
  // Dismiss the mobile keyboard when the user scrolls the comments/replies list.
  // Tapping a composer field remains the only action that opens it again.
  (function bindCommentScrollKeyboardDismiss(){
    const list=$('#commentsList');
    if(!list || list.dataset.keyboardScrollBound==='1')return;
    list.dataset.keyboardScrollBound='1';
    let scrollEndTimer=0;
    list.addEventListener('scroll',()=>{
      const active=document.activeElement;
      if(active && (active.matches('#commentInput, .comment-reply-input, [data-action="comment-reply-input"]') || active.closest?.('.comment-composer, .reply-composer'))){
        active.blur();
      }
      clearTimeout(scrollEndTimer);
      scrollEndTimer=setTimeout(()=>{const focused=document.activeElement;if(focused?.matches?.('#commentInput, .comment-reply-input, [data-action="comment-reply-input"]'))focused.blur();},80);
    },{passive:true});
    list.addEventListener('touchmove',event=>{
      const active=document.activeElement;
      if(event.cancelable && active && (active.matches('#commentInput, .comment-reply-input, [data-action="comment-reply-input"]') || active.closest?.('.comment-composer, .reply-composer'))) active.blur();
    },{passive:true});
  })();

  const mentionSuggestionCache=new Map();
  function renderCommentBody(container,text){
    container.replaceChildren();
    const source=String(text||'');
    const pattern=/@([A-Za-z0-9_.-]{2,30})/g;let cursor=0,match;
    while((match=pattern.exec(source))){
      if(match.index>cursor)container.append(document.createTextNode(source.slice(cursor,match.index)));
      const link=document.createElement('button');link.type='button';link.className='comment-mention-link';link.textContent='@'+match[1];link.addEventListener('click',()=>routeToProfile(match[1],{push:true}));container.append(link);cursor=pattern.lastIndex;
    }
    if(cursor<source.length)container.append(document.createTextNode(source.slice(cursor)));
  }
  function hideMentionSuggestions(){const box=$('#commentMentionSuggestions');if(box){box.hidden=true;box.replaceChildren();}}
  async function searchMentionUsers(query){
    if(!supabase||!query)return [];
    const key=query.toLowerCase();if(mentionSuggestionCache.has(key))return mentionSuggestionCache.get(key);
    try{const {data,error}=await supabase.from('profiles').select('id,username,full_name,avatar_url').ilike('username',key+'%').limit(7);if(error)throw error;const rows=(data||[]).filter(p=>p.username&&p.id!==currentUser?.id);mentionSuggestionCache.set(key,rows);return rows;}catch(error){console.warn('Mention suggestions unavailable:',error);return [];}
  }
  function showMentionSuggestions(users){
    const box=$('#commentMentionSuggestions');if(!box)return;box.replaceChildren();
    users.forEach(user=>{const button=document.createElement('button');button.type='button';button.className='comment-mention-option';button.dataset.username=user.username;button.dataset.userId=user.id;
      const avatar=document.createElement('span');avatar.className='comment-mention-avatar';if(user.avatar_url){avatar.style.backgroundImage=`url("${String(user.avatar_url).replace(/"/g,'%22')}")`;avatar.classList.add('has-image');}else avatar.textContent=(user.full_name||user.username||'ع').slice(0,1);
      const details=document.createElement('span');details.className='comment-mention-details';const name=document.createElement('strong');name.textContent=user.full_name||user.username;const handle=document.createElement('small');handle.textContent='@'+user.username;details.append(name,handle);button.append(avatar,details);box.append(button);
    });box.hidden=!users.length;
  }
  async function handleMentionInput(){
    const input=$('#commentInput');if(!input)return;const before=input.value.slice(0,input.selectionStart||0);const match=before.match(/(?:^|\s)@([A-Za-z0-9_.-]{1,30})$/);
    if(!match||!supabase){hideMentionSuggestions();return;}const query=match[1];if(!query){hideMentionSuggestions();return;}
    const users=await searchMentionUsers(query);const latest=String(input.value||'').slice(0,input.selectionStart||0).match(/(?:^|\s)@([A-Za-z0-9_.-]{1,30})$/);if(document.activeElement===input&&latest&&latest[1]===query)showMentionSuggestions(users);
  }
  function insertMention(username){
    const input=$('#commentInput');if(!input)return;const start=input.selectionStart??input.value.length;const before=input.value.slice(0,start);const match=before.match(/(?:^|\s)@([A-Za-z0-9_.-]{1,30})$/);
    if(match){const at=before.lastIndexOf('@');input.value=input.value.slice(0,at)+'@'+username+' '+input.value.slice(start);const caret=at+username.length+2;input.setSelectionRange(caret,caret);}else{input.value+=(input.value&&!/\s$/.test(input.value)?' ':'')+'@'+username+' ';input.setSelectionRange(input.value.length,input.value.length);}
    hideMentionSuggestions();input.focus();
  }
  async function openCommentReactions(commentId){
    const modal=$('#commentReactionsModal'),list=$('#commentReactionsList'),title=$('#commentReactionsTitle');if(!modal||!list)return;
    list.replaceChildren();title.textContent='التفاعلات على التعليق أو الرد';const loading=document.createElement('p');loading.className='comment-reactions-status';loading.textContent='جارٍ تحميل التفاعلات…';list.append(loading);modal.hidden=false;modal.classList.add('open');
    if(!supabase){loading.textContent='يلزم الاتصال بقاعدة البيانات لعرض التفاعلات.';return;}
    try{const {data,error}=await supabase.from('post_comment_reactions').select('user_id,reaction,created_at').eq('comment_id',String(commentId)).order('created_at',{ascending:false});if(error)throw error;
      const rows=data||[];if(!rows.length){loading.textContent='لا توجد تفاعلات على هذا التعليق أو الرد حتى الآن.';return;}
      const ids=[...new Set(rows.map(r=>r.user_id).filter(Boolean))];let profiles=[];if(ids.length){const result=await supabase.from('profiles').select('id,username,full_name,avatar_url').in('id',ids);if(result.error)throw result.error;profiles=result.data||[];}
      const map=new Map(profiles.map(p=>[p.id,p]));list.replaceChildren();rows.forEach(r=>{const profile=map.get(r.user_id)||{};const item=document.createElement('button');item.type='button';item.className='comment-reaction-person';
        const avatar=document.createElement('span');avatar.className='comment-reaction-person-avatar';if(profile.avatar_url){avatar.style.backgroundImage=`url("${String(profile.avatar_url).replace(/"/g,'%22')}")`;avatar.classList.add('has-image');}else avatar.textContent=(profile.full_name||profile.username||'ع').slice(0,1);
        const name=document.createElement('span');name.className='comment-reaction-person-name';name.textContent=profile.full_name||profile.username||'عضو EgyBook';const emoji=document.createElement('span');emoji.className='comment-reaction-person-emoji';emoji.textContent=r.reaction||'👍';item.append(avatar,name,emoji);item.addEventListener('click',()=>{modal.hidden=true;modal.classList.remove('open');if(profile.username)routeToProfile(profile.username,{push:true});});list.append(item);});
    }catch(error){console.error('Could not load comment reactions:',error);list.replaceChildren();const msg=document.createElement('p');msg.className='comment-reactions-status';msg.textContent='تعذر تحميل التفاعلات. تأكد من تشغيل ترحيل التفاعلات في Supabase.';list.append(msg);}
  }

  let activeCommentAction=null;
  let commentViewportHandler=null;
  function ensureCommentLayerFitsKeyboard(layer){
    if(!layer)return;const vv=window.visualViewport;
    if(vv&&commentViewportHandler){vv.removeEventListener('resize',commentViewportHandler);vv.removeEventListener('scroll',commentViewportHandler);}
    const apply=()=>{const height=vv?.height||window.innerHeight;layer.style.setProperty('--comment-visual-height',height+'px');const sheet=layer.querySelector('.comment-edit-sheet');if(sheet)sheet.style.maxHeight=Math.max(220,height-12)+'px';};
    commentViewportHandler=apply;apply();if(vv){vv.addEventListener('resize',apply,{passive:true});vv.addEventListener('scroll',apply,{passive:true});}
  }
  function closeCommentLayers(){['commentActionsBackdrop','commentEditBackdrop','commentDeleteBackdrop'].forEach(id=>{const el=$('#'+id);if(el){el.hidden=true;el.classList.remove('visible');}});}
  function openCommentActions(comment,row){
    if(!comment||!row)return;
    closeCommentLayers();
    const postOwned=!!currentUser?.id&&activeCommentsPost?.dataset?.userPost==='true';
    const commentOwned=!!currentUser?.id&&String(comment.userId||'')===String(currentUser.id);
    activeCommentAction={comment,row,postOwned,commentOwned,scrollY:$('#commentsList')?.scrollTop||0};
    const backdrop=$('#commentActionsBackdrop');if(!backdrop)return;
    // Editing is always restricted to the author. A post owner may moderate comments
    // on their own post, but cannot edit another person's words.
    const edit=$('[data-comment-sheet-action="edit"]',backdrop);
    const del=$('[data-comment-sheet-action="delete"]',backdrop);
    if(edit)edit.hidden=!commentOwned;
    if(del)del.hidden=!(commentOwned||postOwned);
    const reply=$('[data-comment-sheet-action="reply"]',backdrop);
    const report=$('[data-comment-sheet-action="report"]',backdrop);
    const hide=$('[data-comment-sheet-action="hide"]',backdrop);
    if(reply)reply.hidden=false;
    if(report)report.hidden=commentOwned;
    if(hide)hide.hidden=false;
    const picker=$('#commentReactionPicker');if(picker)picker.hidden=true;
    const editLayer=$('#commentEditBackdrop');if(editLayer){editLayer.hidden=true;editLayer.classList.remove('visible');}
    const deleteLayer=$('#commentDeleteBackdrop');if(deleteLayer){deleteLayer.hidden=true;deleteLayer.classList.remove('visible');}
    backdrop.hidden=false;requestAnimationFrame(()=>backdrop.classList.add('visible'));
  }
  function closeCommentActionSheet(){const b=$('#commentActionsBackdrop');if(b){b.classList.remove('visible');setTimeout(()=>{if(!b.classList.contains('visible'))b.hidden=true;},180);}}
  // Drag the sheet by its handle; ordinary scrolling inside the sheet remains native.
  (function bindCommentSheetSwipe(){
    const backdrop=$('#commentActionsBackdrop'),sheet=backdrop?.querySelector('.comment-actions-sheet'),handle=backdrop?.querySelector('.comment-actions-handle');if(!backdrop||!sheet||!handle)return;
    let startY=0,lastY=0,dragging=false;
    handle.style.touchAction='none';
    handle.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;startY=e.clientY;lastY=startY;dragging=true;sheet.style.transition='none';handle.setPointerCapture?.(e.pointerId);});
    handle.addEventListener('pointermove',e=>{if(!dragging)return;lastY=e.clientY;const delta=Math.max(0,lastY-startY);sheet.style.transform=`translateY(${delta}px)`;backdrop.style.backgroundColor=`rgba(0,5,17,${Math.max(.18,.72-delta/650)})`;});
    const finish=()=>{if(!dragging)return;dragging=false;const delta=lastY-startY;sheet.style.transition='';backdrop.style.backgroundColor='';if(delta>95){sheet.style.transform='translateY(100%)';closeCommentActionSheet();setTimeout(()=>{sheet.style.transform='';},220);}else sheet.style.transform='';};
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>handle.addEventListener(type,finish));
  })();
  async function saveCommentReaction(comment,reaction){
    if(!supabase||!currentUser||!comment?.cloud){showToast('سجّل الدخول لحفظ التفاعل.');return;}
    const old=comment.myReaction||null,next=old===reaction?null:reaction;
    reactionFeedback(reaction, $('#commentActionsBackdrop [data-reaction="'+CSS.escape(reaction)+'"]'));
    comment.myReaction=next;comment.reactions=(comment.reactions||[]).filter(r=>r.userId!==currentUser.id);if(next)comment.reactions.push({userId:currentUser.id,reaction:next});renderComments();
    try{const result=next?await supabase.from('post_comment_reactions').upsert({comment_id:String(comment.id),user_id:currentUser.id,reaction:next,updated_at:new Date().toISOString()},{onConflict:'comment_id,user_id'}):await supabase.from('post_comment_reactions').delete().eq('comment_id',String(comment.id)).eq('user_id',currentUser.id);if(result.error)throw result.error;}
    catch(error){comment.myReaction=old;comment.reactions=(comment.reactions||[]).filter(r=>r.userId!==currentUser.id);if(old)comment.reactions.push({userId:currentUser.id,reaction:old});renderComments();showToast('تعذر حفظ التفاعل. حاول مرة أخرى.');console.error('Comment reaction failed',error);}
  }
  $('#commentActionsBackdrop')?.addEventListener('click',async event=>{
    if(event.target.id==='commentActionsBackdrop'){closeCommentActionSheet();return;}
    const button=event.target.closest('[data-comment-sheet-action]');if(!button||!activeCommentAction)return;
    const {comment}=activeCommentAction,action=button.dataset.commentSheetAction;
    if(action==='close'){closeCommentActionSheet();activeCommentAction=null;return;}
    if(action==='react'){closeCommentActionSheet();await saveCommentReaction(comment,button.dataset.reaction);return;}
    if(action==='reply'){
      closeCommentActionSheet();const input=$('#commentInput');
      replyToComment=comment.id;
      if(input){const username=String(comment.username||'').replace(/^@/,'').trim();input.value=username?'@'+username+' ':'';input.placeholder='اكتب ردك...';input.focus();requestAnimationFrame(()=>{const end=input.value.length;input.setSelectionRange(end,end);input.scrollIntoView({block:'nearest',behavior:'smooth'});});}
      hideMentionSuggestions();activeCommentAction=null;return;
    }
    if(action==='report'){
      closeCommentActionSheet();const reason=window.prompt('ما سبب الإبلاغ عن هذا التعليق؟ (اختياري)','محتوى غير مناسب');
      if(reason!==null){
        if(!supabase||!currentUser){showToast('سجّل الدخول لإرسال البلاغ.');}
        else try{const {error}=await supabase.from('post_comment_reports').insert({comment_id:String(comment.id),post_id:String(activeCommentsPost?.dataset?.postId||''),reporter_id:currentUser.id,reported_user_id:comment.userId||null,reason:String(reason||'').trim().slice(0,500)||'لم يحدد سبب'});if(error)throw error;showToast('تم إرسال البلاغ للمراجعة.');}
        catch(error){console.error('Comment report failed:',error);showToast('تعذر إرسال البلاغ. تأكد من تشغيل EGYBOOK_COMMENT_REPORTS_MIGRATION.sql في Supabase.');}
      }
      activeCommentAction=null;return;
    }
    if(action==='hide'){const row=activeCommentAction.row;closeCommentActionSheet();if(row)row.hidden=true;showToast('تم إخفاء التعليق من العرض الحالي.');activeCommentAction=null;return;}
    if(action==='copy'){try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(String(comment.text||''));else throw new Error('clipboard unavailable');showToast('تم نسخ نص التعليق.');}catch(_){showToast('تعذر النسخ تلقائيًا على هذا المتصفح.');}closeCommentActionSheet();return;}
    if(action==='share'){const text=String(comment.text||'');try{if(navigator.share)await navigator.share({text});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);showToast('تم نسخ النص للمشاركة.');}else showToast('المشاركة غير مدعومة في هذا المتصفح.');}catch(_){}closeCommentActionSheet();return;}
    if(action==='edit'){if(String(comment.userId||'')!==String(currentUser?.id||'')){showToast('يمكنك تعديل تعليقاتك وردودك فقط.');return;}$('#commentEditInput').value=String(comment.text||'');closeCommentActionSheet();const layer=$('#commentEditBackdrop');layer.hidden=false;requestAnimationFrame(()=>{layer.classList.add('visible');$('#commentEditInput').focus({preventScroll:true});ensureCommentLayerFitsKeyboard(layer);});return;}
    if(action==='delete'){const canDelete=String(comment.userId||'')===String(currentUser?.id||'')||activeCommentAction?.postOwned;if(!canDelete){showToast('لا يمكنك حذف تعليق على منشور شخص آخر.');return;}closeCommentActionSheet();const layer=$('#commentDeleteBackdrop');const title=layer.querySelector('h3');if(title)title.textContent=comment.parentId?'هل تريد بالتأكيد حذف هذا الرد؟':'هل تريد بالتأكيد حذف هذا التعليق؟';layer.hidden=false;requestAnimationFrame(()=>layer.classList.add('visible'));}
  });
  $('#commentEditBackdrop')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-comment-edit-action]');if(!button)return;
    if(button.dataset.commentEditAction==='close'){closeCommentLayers();activeCommentAction=null;return;}
    const active=activeCommentAction,text=$('#commentEditInput').value.trim();if(!active||!text){showToast('اكتب نصًا قبل الحفظ.');return;}if(String(active.comment.userId||'')!==String(currentUser?.id||'')){showToast('يمكنك تعديل تعليقاتك وردودك فقط.');return;}
    if(!supabase||!active.comment.cloud){showToast('التعديل متاح حاليًا للتعليقات المحفوظة في الحساب.');return;}
    button.disabled=true;try{const {error}=await supabase.from('post_comments').update({body:text,edited_at:new Date().toISOString()}).eq('id',String(active.comment.id)).eq('user_id',currentUser.id);if(error)throw error;active.comment.text=text;active.comment.editedAt=new Date().toISOString();closeCommentLayers();activeCommentAction=null;renderComments();showToast('تم حفظ التعديلات.');}catch(error){console.error('Comment edit failed',error);showToast('تعذر حفظ التعديل. تأكد من تحديث قاعدة البيانات.');}finally{button.disabled=false;}
  });
  $('#commentDeleteBackdrop')?.addEventListener('click',async event=>{
    const button=event.target.closest('[data-comment-delete-action]');if(!button)return;
    if(button.dataset.commentDeleteAction==='close'){closeCommentLayers();activeCommentAction=null;return;}
    const active=activeCommentAction;if(!active)return;const canDelete=String(active.comment.userId||'')===String(currentUser?.id||'')||!!active.postOwned;if(!canDelete){showToast('لا تملك صلاحية حذف هذا التعليق.');return;}button.disabled=true;
    try{let query=supabase.from('post_comments').delete().eq('id',String(active.comment.id));if(String(active.comment.userId||'')===String(currentUser?.id||''))query=query.eq('user_id',currentUser.id);else if(active.postOwned)query=query.eq('post_id',String(activeCommentsPost?.dataset?.postId||''));const {error}=await query;if(error)throw error;closeCommentLayers();activeCommentAction=null;await loadCloudComments(activeCommentsPost);showToast('تم حذف التعليق.');}
    catch(error){console.error('Comment delete failed',error);showToast('تعذر الحذف. تحقق من صلاحيات Supabase.');}finally{button.disabled=false;}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const hadLayer=['commentActionsBackdrop','commentEditBackdrop','commentDeleteBackdrop'].some(id=>{const el=$('#'+id);return el&&!el.hidden;});closeCommentLayers();if(hadLayer)activeCommentAction=null;}});
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
      const body=document.createElement('div');body.className='egy-comment-text';renderCommentBody(body,c.text||'');if(c.editedAt){const edited=document.createElement('small');edited.className='comment-edited-label';edited.textContent='تم التعديل';body.append(document.createTextNode(' '),edited);}
      if(c.imageUrl){const attachment=document.createElement('button');attachment.type='button';attachment.className='comment-image-attachment';attachment.setAttribute('aria-label','عرض الصورة المرفقة');const image=document.createElement('img');image.loading='lazy';image.src=c.imageUrl;image.alt='صورة مرفقة بالتعليق';attachment.append(image);attachment.addEventListener('click',()=>openCommentImageViewer(c.imageUrl));body.append(attachment);}
      if(c.audioUrl){const audioCard=document.createElement('div');audioCard.className='comment-audio-card';audioCard.style.setProperty('--comment-audio-hue',String((String(c.id).split('').reduce((n,ch)=>n+ch.charCodeAt(0),0)*37)%360));const play=document.createElement('button');play.type='button';play.className='comment-audio-play';play.textContent='▶';play.setAttribute('aria-label','تشغيل التعليق الصوتي');const audio=document.createElement('audio');audio.preload='none';audio.src=c.audioUrl;const wave=document.createElement('span');wave.className='comment-audio-wave';wave.setAttribute('aria-hidden','true');wave.textContent='▂▅▃▆▄▇▅▃▆▄▂▅▇▃▅▄▆▂▅';const duration=document.createElement('time');duration.textContent=formatMusicDuration(c.audioDuration||0);play.addEventListener('click',async()=>{document.querySelectorAll('.comment-audio-card audio').forEach(other=>{if(other!==audio)other.pause();});if(audio.paused){try{await audio.play();play.textContent='Ⅱ';}catch(err){showToast('تعذر تشغيل التعليق الصوتي.');}}else{audio.pause();play.textContent='▶';}});audio.addEventListener('ended',()=>play.textContent='▶');audioCard.append(play,wave,duration,audio);body.append(audioCard);}
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
      [['👎','dislike'],['👍','like']].forEach(([label,type])=>{
        const b=document.createElement('button');b.className='comment-vote'+((c.myReaction===type||(!c.cloud&&c.vote===type))?' active':'');
        b.textContent=(type==='like'&&c.reaction)?c.reaction:label;b.dataset.action='comment-vote';b.dataset.vote=type;
        b.setAttribute('aria-label',type==='like'?'إعجاب بالتعليق':'عدم الإعجاب بالتعليق');votes.append(b);
      });
      const grouped={};(c.reactions||[]).forEach(r=>{grouped[r.reaction]=(grouped[r.reaction]||0)+1;});
      if(!c.cloud && c.vote)grouped[c.vote==='like'?(c.reaction||'👍'):'👎']=Math.max(1,grouped[c.vote==='like'?(c.reaction||'👍'):'👎']||0);
      const reactionSummary=document.createElement('div');reactionSummary.className='comment-reaction-counts';
      Object.entries(grouped).filter(([,count])=>count>0).forEach(([emoji,count])=>{const countButton=document.createElement('button');countButton.type='button';countButton.className='comment-reaction-count';countButton.dataset.action='comment-reactions-open';countButton.dataset.commentId=String(c.id);countButton.textContent=`${emoji} ${count}`;countButton.setAttribute('aria-label',`عرض ${count} تفاعل`);reactionSummary.append(countButton);});
      if(!reactionSummary.childElementCount){const emptyCount=document.createElement('span');emptyCount.className='comment-reaction-empty';emptyCount.textContent='';reactionSummary.append(emptyCount);}
      votes.append(reactionSummary);
      row.append(main,avatar,votes);
      row.addEventListener('contextmenu',event=>{
        if(event.target.closest('.comment-vote, .comment-reaction-count, .comment-replies-toggle, button, a')){event.preventDefault();event.stopPropagation();return;}
        event.preventDefault();openCommentActions(c,row);
      });
      row.addEventListener('pointerdown',event=>{
        if(event.pointerType==='mouse'&&event.button!==0)return;
        if(event.target.closest('.comment-vote, .comment-reaction-count, .comment-replies-toggle, button, a, input, textarea'))return;
        if(event.target.closest('.egy-comment')!==row)return;
        row._commentPressX=event.clientX;row._commentPressY=event.clientY;clearTimeout(row._commentLongPress);
        row._commentLongPress=setTimeout(()=>{row._commentLongPressFired=true;openCommentActions(c,row);},520);
      });
      row.addEventListener('pointermove',event=>{if(Math.abs(event.clientX-(row._commentPressX||event.clientX))>12||Math.abs(event.clientY-(row._commentPressY||event.clientY))>12)clearTimeout(row._commentLongPress);},{passive:true});
      row.addEventListener('click',event=>{if(row._commentLongPressFired){event.preventDefault();event.stopPropagation();row._commentLongPressFired=false;}},{capture:true});
      ['pointerup','pointerleave','pointercancel','scroll'].forEach(type=>row.addEventListener(type,()=>clearTimeout(row._commentLongPress),{passive:true}));
      if(c.replies.length){
        const replies=document.createElement('div');replies.className='comment-replies';
        // A single reply is immediately visible; multiple replies stay grouped until requested.
        replies.hidden=c.replies.length>1;
        const flatReplies=[];
        const collectReplies=(nodes)=>{(nodes||[]).forEach(reply=>{flatReplies.push({...reply, replies:[]});if(Array.isArray(reply.replies)&&reply.replies.length)collectReplies(reply.replies);});};
        collectReplies(c.replies);
        flatReplies.forEach(reply=>replies.append(renderItem(reply,1)));
        // Count every descendant reply exactly once, including replies formerly nested under replies.
        const countAllReplies=(nodes)=>{let count=0;(nodes||[]).forEach(node=>{count+=1;if(Array.isArray(node.replies))count+=countAllReplies(node.replies);});return count;};
        const totalReplyCount=countAllReplies(c.replies);
        if(totalReplyCount>1){
          const toggle=document.createElement('button');toggle.type='button';toggle.className='comment-replies-toggle';toggle.setAttribute('aria-expanded','false');
          const updateLabel=()=>{const expanded=!replies.hidden;toggle.setAttribute('aria-expanded',String(expanded));toggle.textContent=expanded?'إخفاء الردود ▲':`إظهار الردود (${totalReplyCount}) ▼`;};
          updateLabel();toggle.addEventListener('click',()=>{replies.hidden=!replies.hidden;updateLabel();});
          row.append(toggle);
        }
        row.append(replies);
      }
      return row;
    };
    const fragment=document.createDocumentFragment();
    items.forEach(c=>fragment.append(renderItem(c)));
    list.append(fragment);
    if(highlightCommentId){const target=$(`[data-comment-id="${CSS.escape(String(highlightCommentId))}"]`,list);if(target){requestAnimationFrame(()=>{target.scrollIntoView({behavior:'smooth',block:'center'});});setTimeout(()=>target.classList.remove('notification-comment-highlight'),5000);highlightCommentId=null;}}
  }
    function showCommentReactionPicker(button){
    const picker=$('#commentReactionPicker'),r=button.getBoundingClientRect();
    const actionSheet=$('#commentActionsBackdrop');if(actionSheet&&!actionSheet.hidden)closeCommentActionSheet();
    dismissReactionPickers();
    const width=Math.min(320,innerWidth-16);picker.style.maxWidth=width+'px';
    picker.style.left=Math.max(8,Math.min(innerWidth-width-8,r.left+(r.width-width)/2))+'px';
    picker.style.top=Math.max(8,Math.min(innerHeight-(picker.offsetHeight||64)-8,r.top-(picker.offsetHeight||64)-10))+'px';picker.hidden=false;
    picker.dataset.target='post';picker.dataset.postId=activeCommentsPost?.dataset.postId||'';
  }
  let commentPressTimer=null,commentLongPressed=false;
  // Prevent Android text-selection/context menus from replacing the in-app reaction picker.
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('.post [data-action="like"], #commentsList .comment-vote[data-vote="like"], #commentsList .egy-comment-text, #commentReactionPicker')) e.preventDefault();
  });
  document.addEventListener('selectstart', e => {
    if (e.target.closest('.post [data-action="like"], #commentsList .comment-vote[data-vote="like"], #commentsList .egy-comment-text, #commentReactionPicker')) e.preventDefault();
  });

  // Profile settings drawer: isolate it from the profile page and preserve scroll.
  let profileMenuScrollY = 0;
  let profileMenuLocked = false;
  let profileMenuPriorStyles = null;
  let profileMenuCloseFromPop = false;
  function lockProfileMenuBackground(){
    if(profileMenuLocked)return;
    profileMenuLocked=true;
    profileMenuScrollY=window.scrollY||window.pageYOffset||0;
    const body=document.body, html=document.documentElement;
    profileMenuPriorStyles={
      bodyPosition:body.style.position, bodyTop:body.style.top,
      bodyWidth:body.style.width, bodyOverflow:body.style.overflow,
      htmlOverflow:html.style.overflow
    };
    body.classList.add('profile-settings-open');
    html.style.overflow='hidden';
    body.style.overflow='hidden';
    body.style.position='fixed';
    body.style.top=`-${profileMenuScrollY}px`;
    body.style.width='100%';
  }
  function unlockProfileMenuBackground(){
    if(!profileMenuLocked)return;
    profileMenuLocked=false;
    const body=document.body, html=document.documentElement;
    const prior=profileMenuPriorStyles||{};
    body.style.position=prior.bodyPosition||'';
    body.style.top=prior.bodyTop||'';
    body.style.width=prior.bodyWidth||'';
    html.style.overflow=prior.htmlOverflow||'';
    body.classList.remove('profile-settings-open');
    // Keep the page locked only if another modal/sidebar is still active.
    const anotherOverlay=!!document.querySelector('.modal.open')||
      !!document.querySelector('.profile-menu-drawer.is-open')||
      !!document.querySelector('.sidebar.is-open');
    body.style.overflow=anotherOverlay?'hidden':(prior.bodyOverflow||'');
    profileMenuPriorStyles=null;
    requestAnimationFrame(()=>window.scrollTo({left:0,top:profileMenuScrollY,behavior:'auto'}));
  }
  function openProfileMenu(){
    if(currentPage!=='profile')return;
    const drawer=$('#profileMenuDrawer'),backdrop=$('#profileMenuBackdrop'),trigger=$('.profile-more-button');
    if(!drawer||!backdrop||drawer.classList.contains('is-open'))return;
    lockProfileMenuBackground();
    drawer.classList.add('is-open');backdrop.hidden=false;
    drawer.setAttribute('aria-hidden','false');
    if(trigger)trigger.setAttribute('aria-expanded','true');
    if(!history.state?.profileMenuOpen){
      history.pushState({...history.state,profileMenuOpen:true},'',location.href);
    }
  }
  function closeProfileMenu(fromPop=false){
    const drawer=$('#profileMenuDrawer'),backdrop=$('#profileMenuBackdrop'),trigger=$('.profile-more-button');
    if(!drawer||!backdrop||!drawer.classList.contains('is-open'))return;
    drawer.classList.remove('is-open');backdrop.hidden=true;
    drawer.setAttribute('aria-hidden','true');
    if(trigger)trigger.setAttribute('aria-expanded','false');
    unlockProfileMenuBackground();
    if(!fromPop && history.state?.profileMenuOpen){
      profileMenuCloseFromPop=true;
      history.back();
    }
  }
  // The browser edge-swipe consumes a history entry; close this overlay first
  // and prevent route handlers from navigating the underlying profile.
  window.addEventListener('popstate',event=>{
    const drawer=document.getElementById('profileMenuDrawer');
    if(profileMenuCloseFromPop){
      profileMenuCloseFromPop=false;
      event.stopImmediatePropagation();
      return;
    }
    if(drawer?.classList.contains('is-open')){
      event.stopImmediatePropagation();
      closeProfileMenu(true);
    }
  },true);
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
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeSidebar();closeProfileMenu();}});
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
  // v45: direct finger-tracking for the post controls sheet.
  (() => {
    const sheet = $('#postControlsModal');
    const box = sheet?.querySelector('.post-controls-box');
    const handle = sheet?.querySelector('.sheet-handle');
    if (!sheet || !box || !handle) return;

    let pointerId = null, startY = 0, lastY = 0, lastTime = 0, velocityY = 0;
    let dragging = false, candidate = false, startTranslate = 0, closeTimer = 0;
    const threshold = 5;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    function setY(y, animate = false) {
      box.style.transition = animate
        ? `transform ${reducedMotion ? 0 : 260}ms cubic-bezier(.2,.8,.2,1)`
        : 'none';
      box.style.transform = `translate3d(0,${Math.max(0, y)}px,0)`;
    }
    function resetPosition() {
      setY(0, true);
      window.setTimeout(() => {
        if (sheet.classList.contains('open') && !dragging) {
          box.style.transition = '';
          box.style.transform = 'translate3d(0,0,0)';
        }
      }, reducedMotion ? 0 : 280);
    }
    function closeByDrag() {
      if (!sheet.classList.contains('open') || sheet.classList.contains('post-sheet-dismissing')) return;
      clearTimeout(closeTimer);
      const distance = Math.max(box.getBoundingClientRect().height, window.innerHeight * .72);
      setY(distance, true);
      sheet.classList.add('post-sheet-dismissing');
      closeTimer = window.setTimeout(() => {
        sheet.classList.remove('post-sheet-dismissing');
        box.style.transition = '';
        box.style.transform = '';
        closeModal(sheet);
      }, reducedMotion ? 0 : 270);
    }
    function canStartDrag(target) {
      // Allow grabbing the handle, header background, or empty panel space.
      // Never turn an intentional tap on an action into a drag.
      if (target.closest('button, a, input, textarea, select, [role="button"], .post-control-item')) return false;
      return true;
    }
    box.addEventListener('pointerdown', e => {
      if (!sheet.classList.contains('open') || sheet.classList.contains('post-sheet-dismissing')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!canStartDrag(e.target)) return;
      pointerId = e.pointerId;
      startY = lastY = e.clientY;
      lastTime = performance.now();
      velocityY = 0;
      candidate = true;
      dragging = false;
      startTranslate = 0;
      clearTimeout(closeTimer);
      // Capture the pointer so movement remains attached to the sheet even if
      // the finger leaves its top edge during a downward swipe.
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
    });
    box.addEventListener('pointermove', e => {
      if (!candidate || e.pointerId !== pointerId) return;
      const now = performance.now();
      const dy = Math.max(0, e.clientY - startY);
      if (!dragging && dy > threshold) {
        dragging = true;
        box.style.animation = 'none';
        box.style.transition = 'none';
        box.style.willChange = 'transform';
      }
      if (!dragging) return;
      velocityY = (e.clientY - lastY) / Math.max(1, now - lastTime);
      lastY = e.clientY;
      lastTime = now;
      setY(dy, false);
      if (e.cancelable) e.preventDefault();
    }, {passive:false});

    function finish(e) {
      if (!candidate || (e && e.pointerId !== pointerId)) return;
      const y = e && Number.isFinite(e.clientY) ? e.clientY : lastY;
      const dy = Math.max(0, y - startY);
      const wasDragging = dragging;
      candidate = false;
      pointerId = null;
      dragging = false;
      if (!wasDragging) return;
      const fastFlick = velocityY > 0.55 && dy > 12;
      const enoughDistance = dy > Math.min(110, window.innerHeight * 0.15);
      if (fastFlick || enoughDistance) closeByDrag();
      else resetPosition();
    }
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);
    // The whole sheet moves as one unit. Its content is not an independent scroller.
    sheet.addEventListener('click', e => {
      if (e.target === sheet && sheet.classList.contains('open')) {
        if (window.matchMedia('(min-width: 900px)').matches) closeModal(sheet);
        else closeByDrag();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sheet.classList.contains('open')) closeByDrag();
    });
    // Keep the sheet hidden unless the modal's open state is explicitly set.
    sheet.setAttribute('aria-hidden', sheet.classList.contains('open') ? 'false' : 'true');
  })();

  function openProfileImagePreview(kind){
    profileImageKind=kind==='cover'?'cover':'avatar';
    const ownerProfile=publicProfileData||(currentUser&&publicProfileIsOwn?{...profileData,id:currentUser.id}:null);
    const ownerId=String(publicProfileId||ownerProfile?.id||'');
    if(!ownerProfile||!ownerId){showToast('بيانات الملف الشخصي لم تكتمل بعد. حاول مرة أخرى.');return;}
    const src=String(profileImageKind==='cover'?(ownerProfile.cover||ownerProfile.cover_url||''):(ownerProfile.avatar||ownerProfile.avatar_url||'')).trim();
    if(!src){showToast(profileImageKind==='cover'?'لا توجد صورة غلاف لهذا الحساب حاليًا.':'لا توجد صورة شخصية لهذا الحساب حاليًا.');return;}
    const ownerName=ownerProfile.name||ownerProfile.full_name||ownerProfile.username||'عضو EgyBook';
    const ownerAvatar=String(ownerProfile.avatar||ownerProfile.avatar_url||'');
    openImageViewer([{id:profileImageKind+'-'+ownerId,src,originalSrc:src,author:ownerName,avatar:ownerAvatar,caption:profileImageKind==='cover'?'صورة الغلاف':'الصورة الشخصية',kind:profileImageKind}],0,null,{push:true});
  }
  // The cover itself opens a preview; nested menu/camera controls keep their own actions.
  const profileCoverElement=$('.profile-cover');
  if(profileCoverElement){
    profileCoverElement.addEventListener('click',event=>{if(event.target.closest('button'))return;openProfileImagePreview('cover');});
    profileCoverElement.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target===profileCoverElement){event.preventDefault();openProfileImagePreview('cover');}});
  }

  document.addEventListener('click', async event => {
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
    if(statAction){const shownPost=statAction.closest('.post');if(!shownPost)return;const shownId=shownPost.dataset.postId;const post=shownPost.matches('.post-viewer-post')&&shownId?$(`[data-post-id="${CSS.escape(String(shownId))}"]`,postsList)||shownPost:shownPost;if(statAction.dataset.action==='reactions-open')showPostReactions(post);else openComments(post,{push:!document.body.classList.contains('post-route-open')});return;}
    const postAvatar=event.target.closest('.post-header .avatar,.post-author .author-name,.post-image');
    if(postAvatar && !event.target.closest('button[data-action="post-menu"]')){
      const post=postAvatar.closest('.post');
      if(event.target.closest('.post-image,.post-image-count-badge')){const media=$('.post-image',post);if(media?.tagName==='IMG'){openPostImageViewer(post,{push:true});}else openPostRoute(post?.dataset.postId,{push:true});return;}
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
    if(action==='directory-accept-request'||action==='directory-reject-request'){(async()=>{if(!currentUser||!supabase)return;button.disabled=true;try{const status=action==='directory-accept-request'?'accepted':'rejected';const {error}=await supabase.from('friend_requests').update({status,updated_at:new Date().toISOString()}).eq('id',button.dataset.requestId).eq('receiver_id',currentUser.id).eq('status','pending');if(error)throw error;showToast(status==='accepted'?'تمت إضافة الصديق بنجاح.':'تم رفض طلب الصداقة.');await loadFriendsDirectory(friendsDirectoryTab);if(publicProfileId)loadProfileFriends(publicProfileId); updateViewedProfilePresence();}catch(error){console.error(error);showToast('تعذر تحديث طلب الصداقة. راجع سياسات RLS.');}finally{button.disabled=false;}})();return;}
    if(action==='profile-relationship'){sendProfileFriendRequest();return;}
    if(action==='profile-message'){if(!publicProfileId){showToast('جارٍ تحميل بيانات الحساب. حاول مرة أخرى بعد لحظة.');return;}messageThreadFromProfile=true;openMessageThread(publicProfileId,publicProfileData||{username:publicProfileUsername},{push:true});return;}
    if(action==='messages-compose'){const input=$('#messagesSearchInput');if(input){input.focus();showToast('ابحث عن اسم الشخص لفتح محادثته.');}return;}
    if(action==='messages-search-focus'){ $('#messagesSearchInput')?.focus();return;}
    if(action==='messages-open-thread'){messageThreadFromProfile=false;const peer=directMessageRows.find(r=>String(r.peerId)===String(button.dataset.peerId));openMessageThread(button.dataset.peerId,peer||{},{});return;}
    if(action==='messages-back-list'){if(messageThreadFromProfile){messageThreadFromProfile=false;history.back();return;}history.replaceState({page:'messages'},'','/Egybook/messages');showMessagesList();window.scrollTo({top:messageOrigin.scrollY||0,behavior:'auto'});return;}
    if(action==='profile-follow'){toggleProfileFollow();return;} if(action==='open-auth'){closeSidebar();setAuthMode('login');refreshAuthUI();openModal($('#supabaseAuthModal'));return;} if(action==='reels-close'){history.pushState({page:'home'},'',SITE_BASE_PATH);routeFromLocation();return;}
    if(action==='reels-upload'){ $('#reelUploadInput')?.click();return; }
    if(action==='memez-open'){history.pushState({page:'memez'},'','/Egybook/memez');routeFromLocation();return;}
    if(action==='memez-close'){history.pushState({page:'home'},'',SITE_BASE_PATH);routeFromLocation();return;}
    if(action==='memez-coming'){showToast('قريبًا');return;}
    if(action==='post-viewer-close'){closePostViewer();return;}
    if(action==='followers-list-close'){closeModal($('#followersListModal'));return;}
    if(action==='open-follower-profile'){const username=button.dataset.username;if(username){closeModal($('#followersListModal'));routeToProfile(username,{push:true});}return;}
    if(action==='image-music-mute'){const post=getViewerPost(),card=post?.querySelector('[data-post-music-player]');if(card){card.querySelector('[data-post-music-mute]')?.click();renderImageViewer();}return;}
    if(action==='image-viewer-close'){closeImageViewer();return;}
    if(action==='image-prev'){stepImage(-1);return;}
    if(action==='image-next'){stepImage(1);return;}
    if(action==='image-like'){if(longPressTriggered){longPressTriggered=false;return;}const post=getViewerPost(),item=imageViewerItems[imageViewerIndex];if(post){const like=$('[data-action="like"]',post);if(like)like.click();setTimeout(()=>{const current=like?.dataset.currentReaction||postState[String(post.dataset.postId||'')]?.reaction||'👍';$('#imageViewerReactionIcons').textContent=current;const viewerLike=$('#imageViewer .iv-like');if(viewerLike)viewerLike.dataset.selectedReaction=current;renderImageViewer();},100);}else if(supabase&&currentUser&&item?.id){(async()=>{const {data,error}=await supabase.from('photo_reactions').select('reaction').eq('photo_id',String(item.id)).eq('user_id',currentUser.id).maybeSingle();if(error){showToast('تعذر قراءة التفاعل الحالي.');return;}let result;if(data?.reaction)result=await supabase.from('photo_reactions').delete().eq('photo_id',String(item.id)).eq('user_id',currentUser.id);else result=await supabase.from('photo_reactions').upsert({photo_id:String(item.id),user_id:currentUser.id,reaction:'👍',updated_at:new Date().toISOString()},{onConflict:'photo_id,user_id'});if(result?.error)showToast('تعذر حفظ التفاعل في السحابة.');else{const selected=data?.reaction?'👍':'👍';$('#imageViewerReactionIcons').textContent=selected;const viewerLike=$('#imageViewer .iv-like');if(viewerLike){viewerLike.dataset.selectedReaction=selected;viewerLike.classList.toggle('is-reacted',!data?.reaction);}await loadViewerCloudStats(item,post);}})();}else showToast('سجّل الدخول للتفاعل مع الصورة.');return;}
    if(action==='image-reactions'){const post=getViewerPost();if(post)showPostReactions(post);else showViewerReactions();return;}
    if(action==='image-comments'){const post=getViewerPost(),item=imageViewerItems[imageViewerIndex];if(post){openComments(post,{push:false});}else if(item)showPhotoComments(item);else showToast('الصورة غير متاحة.');return;}
    if(action==='image-reactions-open'){showViewerReactions();return;}
    if(action==='image-share'){const item=imageViewerItems[imageViewerIndex];const url=location.origin+imageViewerCanonicalPath(item);if(navigator.share)navigator.share({title:'EgyBook',url}).catch(()=>{});else navigator.clipboard?.writeText(url).then(()=>showToast('تم نسخ رابط معاينة الصورة.')).catch(()=>showToast(url));return;}
    if(action==='image-download'){downloadViewerImage();return;}
    if(action==='image-more'){const menu=$('#imageViewerMoreMenu');if(menu)menu.hidden=!menu.hidden;return;} if(action==='image-copy-link'){const item=imageViewerItems[imageViewerIndex];const url=location.origin+imageViewerCanonicalPath(item);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط معاينة الصورة.')).catch(()=>showToast(url));else showToast(url);const menu=$('#imageViewerMoreMenu');if(menu)menu.hidden=true;return;}
    if(action==='image-zoom-in'){imageViewerZoom=Math.min(3,imageViewerZoom+0.25);renderImageViewer();return;}
    if(action==='image-zoom-out'){imageViewerZoom=Math.max(0.5,imageViewerZoom-0.25);renderImageViewer();return;}
    if(action==='image-fullscreen'){const stage=$('.image-viewer-stage');if(document.fullscreenElement)document.exitFullscreen?.();else (stage?.requestFullscreen||stage?.webkitRequestFullscreen)?.call(stage);return;}
    if(action==='image-save'){showToast('حفظ الصور في المفضلة على السحابة يحتاج إلى إعداد جدول المفضلة أولًا.');return;}
    if(action==='image-info'){const item=imageViewerItems[imageViewerIndex];const image=$('#imageViewerImage');showToast(`${image.naturalWidth||item?.width||'؟'} × ${image.naturalHeight||item?.height||'؟'} بكسل`);return;}
    if(action==='profile-image-preview'){openProfileImagePreview(profileImageKind);return;}
    if(action==='profile-image-change'){
      if(!currentUser||!publicProfileIsOwn){showToast('يمكنك تغيير صور ملفك الشخصي فقط.');return;}
      (profileImageKind==='cover'?$('#profileCoverInput'):$('#profilePhotoInput')).click();return;
    }
    if(action==='post-viewer-comments'){$('#postViewerComments')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
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
    if(action==='comment-reply'){const row=button.closest('.egy-comment'),target=findCommentById(getCommentsFor(activeCommentsPost),row?.dataset.commentId);replyToComment=target?.id||null;const input=$('#commentInput');if(input){const username=String(target?.username||'').replace(/^@/,'').trim();const mention=username?'@'+username+' ':'';input.value=mention;input.placeholder='اكتب ردك...';input.focus();input.setSelectionRange(input.value.length,input.value.length);}hideMentionSuggestions();return;}
    if(action==='comment-reactions-open'){openCommentReactions(button.dataset.commentId);return;}
    if(action==='comment-hide'){const row=button.closest('.egy-comment');if(row)row.remove();return;}
    if(action==='comment-vote'&&commentLongPressed){commentLongPressed=false;return;}
    if(action==='comment-vote'){const row=button.closest('.egy-comment'),c=findCommentById(getCommentsFor(activeCommentsPost),row?.dataset.commentId);if(c){const reaction=button.dataset.vote==='dislike'?'👎':'👍';if(!supabase||!currentUser||!c.cloud){c.vote=c.vote===button.dataset.vote?null:button.dataset.vote;saveComments();renderComments();return;}saveCommentReaction(c,reaction);}return;}
    if (button.dataset.page) { if(button.dataset.page==='friends'){openFriendsDirectory();return;} if(button.dataset.page==='reels'){history.pushState({page:'reels'},'','/Egybook/reels');routeFromLocation();return;} setPage(button.dataset.page); return; }
    if (action === 'open-composer') {
      if(button.classList.contains('composer-input')) { if(isPublishingPost)showToast('انتظر انتهاء النشر الجاري قبل بدء منشور آخر.');else openPostComposer(); }
      else openModal($('#composerMenuModal'));
    }
    else if (action === 'open-post-composer') { if(isPublishingPost)showToast('انتظر انتهاء النشر الجاري قبل بدء منشور آخر.');else openPostComposer(); }
    else if (action === 'open-audience-picker') openAudiencePicker();
    else if (action === 'audience-back') { closeModal($('#audienceModal')); if(editingPrivacyPost){editingPrivacyPost=null;openModal($('#postControlsModal'));}else openModal(createPostModal); }
    else if (action === 'audience-show-all') {
      const extra=$('#audienceExtraOptions');if(extra)extra.hidden=false;
      const show=$('#audienceShowAll');if(show)show.hidden=true;
      if(!audienceFriendsCache.length)loadAudienceFriends();
    }
    else if (action === 'audience-done') confirmAudience();
    else if (action === 'audience-publish') confirmAudience(true);
    else if (action === 'composer-feeling') openComposerFeature('feeling');
    else if (action === 'composer-location') openComposerFeature('location');
    else if (action === 'composer-collab') openComposerFeature('collab');
    else if (action === 'composer-music') openComposerFeature('music');
    else if (action === 'composer-gif' || action === 'composer-background') showToast('هذه الإضافة غير متاحة حاليًا.');

    else if (action === 'composer-use-location') {
      const search=$('#composerLocationSearch');
      if(!navigator.geolocation){showToast('المتصفح لا يدعم تحديد الموقع.');}
      else {showToast('جارٍ تحديد موقعك…');navigator.geolocation.getCurrentPosition(async pos=>{
        const {latitude,longitude}=pos.coords;
        try{const response=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);const data=await response.json();const label=data.display_name||`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;if(search)search.value=label;composerPostMeta.location_name=label;renderComposerFeature('location');updateComposerIdentityPreview();}
        catch{if(search)search.value=`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;composerPostMeta.location_name=search.value;renderComposerFeature('location');updateComposerIdentityPreview();}
      },()=>showToast('لم نتمكن من تحديد الموقع. يمكنك البحث عن المكان يدويًا.'),{enableHighAccuracy:false,timeout:10000,maximumAge:300000});}
    }
    else if (action === 'composer-feature-close') { if(audiusAudio){audiusAudio.pause();audiusAudio.src='';audiusAudio=null;audiusPlayingTrackId=null;} closeModal($('#composerFeatureModal')); }
    else if (action === 'composer-feature-clear') {
      if(composerFeatureMode==='feeling')composerPostMeta.feeling='';
      else if(composerFeatureMode==='activity')composerPostMeta.activity='';
      else if(composerFeatureMode==='location')composerPostMeta.location_name='';
      else if(composerFeatureMode==='collab')composerPostMeta.tagged_user_ids=[];
      else if(composerFeatureMode==='music'){composerPostMeta.music_title='';composerPostMeta.music_artist='';composerPostMeta.music_track_id='';composerPostMeta.music_permalink='';composerPostMeta.music_artwork_url='';composerPostMeta.music_start_seconds=0;composerPostMeta.music_duration_seconds=30;composerPostMeta.music_duration_total=0;audiusMusicView='list';audiusTrimCanRemove=false;audiusMusicOriginalMeta=JSON.parse(JSON.stringify(composerPostMeta));audiusMusicConfirmed=false;if(audiusAudio){audiusAudio.pause();audiusAudio.removeAttribute('src');audiusAudio.load();audiusAudio=null;audiusPlayingTrackId=null;}}
      updateComposerIdentityPreview();renderComposerFeature(composerFeatureMode);showToast('تم إلغاء الاختيار.');
    }
    else if (action === 'composer-feature-apply') {
      if(composerFeatureMode==='location')composerPostMeta.location_name=$('#composerLocationSearch')?.value.trim()||'';
      if(composerFeatureMode==='music'&&!composerPostMeta.music_track_id){showToast('اختار أغنية الأول.');return;}
      updateComposerIdentityPreview();if(audiusAudio){audiusAudio.pause();audiusAudio.src='';audiusAudio=null;audiusPlayingTrackId=null;}closeModal($('#composerFeatureModal'));
      if(composerFeatureMode==='music')showToast('تم حفظ الأغنية والمقطع المحدد.');
    }
    else if (action === 'composer-post') { closeModal($('#composerMenuModal')); openPostComposer(); }
    else if (action === 'composer-story') { closeModal($('#composerMenuModal')); showToast('واجهة القصص ستحتاج إلى تخزين وعرض مستقلين؛ لم يتم نشر قصة وهمية.'); }
    else if (action === 'composer-reel') { closeModal($('#composerMenuModal')); showToast('إنشاء الريلز يحتاج إلى واجهة فيديو مستقلة؛ يمكنك نشر فيديو من المنشور حاليًا.'); }
    else if (action === 'composer-live') { closeModal($('#composerMenuModal')); showToast('البث المباشر يحتاج إلى خدمة بث وخادم، ولا يمكن تشغيله من الواجهة وحدها.'); }
    else if (action === 'composer-note') { closeModal($('#composerMenuModal')); openModal(createPostModal); $('#composerTitle').textContent='إنشاء ملاحظة'; $('#postContent').placeholder='اكتب ملاحظتك القصيرة...'; }
    else if (action === 'close-modal') { const closing=button.closest('.modal'); closeModal(closing); if(closing?.id==='createPostModal'||closing?.id==='audienceModal')clearComposerOverlayState(); }
    else if (action === 'music') { openComposerFeature('music'); }
    else if (action === 'search') openPeopleSearch();
    else if (action === 'run-search') runSearch();
    else if (action === 'open-search-profile') { const username=button.dataset.username; if(username){ closeModal($('#searchModal')); const page=$('#peopleSearchPage');if(page)page.hidden=true;routeToProfile(username); } }
    else if (action === 'search-back') closePeopleSearchPage();
    else if (action === 'messages') openMessages({push:true});
    else if (action === 'notifications') openNotifications();
    else if (action === 'notifications-refresh') loadNotifications();
    else if (action === 'notification-tab') {notificationTab=button.dataset.notificationTab||'all';$$('[data-notification-tab]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});renderNotifications();}
    else if (action === 'notification-accept'||action === 'notification-reject') { (async()=>{if(!currentUser||!supabase)return;button.disabled=true;try{const status=action==='notification-accept'?'accepted':'rejected';const {error}=await supabase.from('friend_requests').update({status,updated_at:new Date().toISOString()}).eq('id',button.dataset.requestId).eq('receiver_id',currentUser.id).eq('status','pending');if(error)throw error;showToast(status==='accepted'?'تم قبول طلب الصداقة.':'تم رفض طلب الصداقة.');await loadNotifications();}catch(error){console.error(error);showToast('تعذر تحديث طلب الصداقة. راجع سياسات RLS.');}finally{button.disabled=false;}})();}
    else if (action === 'notification-view-post') {const card=button.closest('.notification-card');const item=notificationItems.find(x=>x.id===card?.dataset.notificationId);if(item)markNotificationRead(item);const id=button.dataset.postId||item?.postId;closeNotifications();if(id)openPostRoute(id,{push:true});}
    else if (action === 'notification-view-comment') {const card=button.closest('.notification-card');const item=notificationItems.find(x=>x.id===card?.dataset.notificationId);if(item)markNotificationRead(item);const id=button.dataset.postId||item?.postId,commentId=button.dataset.commentId||item?.commentId;closeNotifications();if(id)openPostRoute(id,{push:true,commentId:commentId||null});}
    else if (action === 'notifications-mark-read') {const read=notificationReadIds();notificationItems.forEach(x=>read.add(x.id));try{localStorage.setItem(notificationReadKey(),JSON.stringify([...read]));}catch(_){}renderNotifications();updateNotificationBadge();}
    else if (action === 'profile') { closeSidebar(); showProfile(); }
    else if (action === 'profile-back') setPage('home');
    else if (action === 'profile-photo-preview') {openProfileImagePreview('avatar');}
    else if (action === 'profile-avatar-camera') {if(!currentUser||!publicProfileIsOwn){showToast('يمكن لصاحب الحساب فقط تغيير الصورة.');return;}$('#profilePhotoInput').click();}
    else if (action === 'profile-cover-camera') {if(!currentUser||!publicProfileIsOwn){showToast('يمكن لصاحب الحساب فقط تغيير صورة الغلاف.');return;}$('#profileCoverInput').click();}
    else if (action === 'profile-cover-preview') {if(event.target.closest('.profile-camera-button,.profile-more-button'))return;openProfileImagePreview('cover');}
    else if (action === 'profile-settings') openEditProfile();
    else if(action==='profile-about-toggle'){const content=$('#profileAboutContent'),button=event.target.closest('[data-action="profile-about-toggle"]');if(content&&button){const opening=content.hidden;content.hidden=!opening;button.setAttribute('aria-expanded',String(opening));}}
    else if (action === 'profile-menu-toggle') { $('#profileMenuDrawer')?.classList.contains('is-open')?closeProfileMenu():openProfileMenu(); }
    else if (action === 'profile-menu-close') closeProfileMenu();
    else if (action === 'profile-menu-verified') { closeProfileMenu(); showToast('حالة التحقق من الملف الشخصي تُعرض حسب بيانات الحساب.'); }
    else if (action === 'profile-menu-archive') { closeProfileMenu(); showToast('الأرشيف غير مفعّل بعد في هذه النسخة.'); }
    else if (action === 'profile-menu-view') { closeProfileMenu(); showToast('أنت تعرض الملف الشخصي كما يظهر للآخرين.'); }
    else if (action === 'profile-menu-activity') { closeProfileMenu(); showToast('سجل النشاطات غير متاح بعد.'); }
    else if (action === 'profile-menu-review') { closeProfileMenu(); showToast('مراجعة المنشورات والإشارات غير مفعّلة بعد.'); }
    else if (action === 'profile-menu-privacy') { closeProfileMenu(); showToast('إعدادات الخصوصية المتاحة داخل تعديل الملف الشخصي.'); }
    else if (action === 'edit-profile') { closeSidebar(); closeProfileMenu(); openEditProfile(); }
    else if (action === 'profile-share') { closeProfileMenu(); const viewed=publicProfileData||profileData; const url=location.origin+profilePath(viewed.username); if(navigator.share) navigator.share({title:viewed.name||'EgyBook',text:'تابعني على EgyBook',url}).catch(()=>{}); else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ رابط الملف الشخصي.')).catch(()=>showToast(url));else showToast(url); }
    else if (action === 'profile-section') { const section=button.dataset.section; if(section==='saved'){setPage('saved');showToast('دي المنشورات المحفوظة على الجهاز.');}else if(section==='friends'){openFriendsDirectory({tab:'friends'});}else if(section==='followers'){openFollowersList();}else if(section==='photos'){openAlbums();}else if(section==='videos'){ $('#profilePostsTitle').textContent='فيديوهاتي'; const target=$('#profilePostsList');target.replaceChildren();const own=$$('.post[data-user-post="true"]',postsList).filter(p=>!!$('video.post-image',p));own.forEach(p=>target.append(p.cloneNode(true)));if(!own.length)target.textContent='لسه مفيش فيديوهات منشورة.';}else{ $('#profilePostsTitle').textContent='منشوراتي';renderProfilePosts();} }
    else if (action === 'photo') { if(!createPostModal.classList.contains('open'))openPostComposer(); photoInput.click(); }
    else if (action === 'video') { if(!createPostModal.classList.contains('open'))openPostComposer(); videoInput.click(); }
    else if (action === 'location') { if(!createPostModal.classList.contains('open'))openPostComposer();openComposerFeature('location'); }
    else if (action === 'music') { if(!createPostModal.classList.contains('open'))openPostComposer();openComposerFeature('music'); }
    else if (action === 'add-story') showToast('إضافة القصص غير مفعّلة بعد؛ يلزم ربطها بقاعدة بيانات القصص.');
    else if (action === 'all-stories') showToast('لا توجد قصص متاحة للعرض حاليًا.');
    else if (action === 'story') showToast('هذه القصة غير متاحة.');
    else if (action === 'sort') { sortNewestFirst = !sortNewestFirst; const items = $$('.post', postsList); items.sort((a,b) => { const timeA = Number(a.dataset.createdAt) || 0; const timeB = Number(b.dataset.createdAt) || 0; return sortNewestFirst ? timeB - timeA : timeA - timeB; }); items.forEach(item => postsList.append(item)); button.textContent = sortNewestFirst ? 'الأحدث ▾' : 'الأقدم ▾'; }
    else if (action === 'comment') { const post=button.closest('.post'); if(post)openComments(post,{push:true}); }
    else if (action === 'like') {
      if(longPressTriggered){longPressTriggered=false;return;}
      const post=button.closest('.post');
      if(!post)return;
      if(button.dataset.currentReaction){
        const id=String(post.dataset.postId||''),userId=currentUser?.id;
        if(id && pendingPostReactions.has(id))return;
        const previousEmoji=button.dataset.currentReaction,previousLabel=button.dataset.currentReactionLabel||'إعجاب';
        const previousState=id?{...(postState[id]||{})}:null;
        if(id){postReactionVersions.set(id,(postReactionVersions.get(id)||0)+1);pendingPostReactions.set(id,true);}
        button.disabled=true;
        button.classList.remove('reacted');delete button.dataset.currentReaction;delete button.dataset.currentReactionLabel;
        const icon=$('.action-icon',button);if(icon)icon.innerHTML=postReactionSvg;
        const spans=$$('span',button);if(spans[1])spans[1].textContent='إعجاب';
        if(id){delete postState[id]?.reaction;delete postState[id]?.reactionLabel;savePostState();}
        const icons=$('.reaction-icons',post);if(icons)icons.textContent='';
        syncPostStats(post);
        if(id)syncPostCopies(id,post);
        try{
          if(id&&supabase&&userId){
            const {error}=await supabase.from('post_reactions').delete().eq('post_id',id).eq('user_id',userId);
            if(error)throw error;
            syncPostCopies(id,post);
            if(currentUser?.id===userId){await loadCloudPostStats(post);syncPostCopies(id,post);}
          }else if(id&&supabase&&!userId)throw new Error('سجّل الدخول لحذف التفاعل.');
          showToast('تم إلغاء التفاعل.');
        }catch(error){
          console.error('Cloud reaction delete failed:',error);
          if(id&&previousState)postState[id]=previousState;
          button.classList.add('reacted');button.dataset.currentReaction=previousEmoji;button.dataset.currentReactionLabel=previousLabel;
          if(icon)icon.innerHTML=postReactionSvg;if(spans[1])spans[1].textContent=previousLabel;
          if(icons)icons.textContent=previousEmoji;savePostState();syncPostStats(post);syncPostCopies(id,post);
          showToast('تعذر إلغاء التفاعل. حاول مرة أخرى.');
        }finally{
          if(id)pendingPostReactions.delete(id);
          button.disabled=false;
          if(id && supabase) setTimeout(()=>{const latest=$$('.post').find(item=>String(item.dataset.postId||'')===id);if(latest)loadCloudPostStats(latest);},80);
        }
      }else selectReaction(post,'👍','إعجاب');
    }
    else if (action === 'save') { button.classList.toggle('saved'); $('span:last-child', button).textContent = button.classList.contains('saved') ? 'تم الحفظ' : 'حفظ'; const p=button.closest('.post');if(p?.dataset.postId){postState[p.dataset.postId]={...(postState[p.dataset.postId]||{}),saved:button.classList.contains('saved')};savePostState();} showToast(button.classList.contains('saved') ? 'تم حفظ المنشور على هذا الجهاز.' : 'تم إلغاء حفظ المنشور.'); }
    else if (action === 'share') { const post = button.closest('.post'); const text = $('.post-text', post)?.textContent || 'منشور على EgyBook'; if(post){const id=post.dataset.postId;postState[id]={...(postState[id]||{}),shareCount:(Number(postState[id]?.shareCount)||0)+1};savePostState();const sc=$('.share-count',post);if(sc)sc.textContent=formatPostCount(postState[id].shareCount);syncPostStats(post);} if (navigator.share) navigator.share({title:'EgyBook', text}).catch(()=>{}); else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(()=>showToast('تم نسخ نص المنشور للمشاركة.')).catch(()=>showToast('المشاركة غير متاحة في هذا المتصفح.')); else showToast('المشاركة غير متاحة في هذا المتصفح.'); }
    else if (action === 'post-menu') { currentMenuPost=button.closest('.post'); openPostControls(currentMenuPost); }
    else if (action === 'post-control') { handlePostControl(button.dataset.control); }
  });
  // Reaction long-press and selection are handled by the unified pointer gesture below.

  // EgyBook native-feeling custom select sheet: prevents Android's oversized system picker.
  function ensureEgySelectSheet(){
    let sheet=$('#egySelectSheet');
    if(sheet)return sheet;
    sheet=document.createElement('div');sheet.id='egySelectSheet';sheet.className='egy-select-backdrop';sheet.hidden=true;
    sheet.innerHTML='<div class="egy-select-sheet" role="dialog" aria-modal="true" aria-label="اختيار قيمة"><div class="egy-select-heading"><span class="egy-select-accent"></span><strong></strong><button type="button" aria-label="إغلاق">×</button></div><div class="egy-select-options" role="listbox"></div></div>';
    document.body.append(sheet);
    const close=()=>{sheet.hidden=true;document.body.classList.remove('egy-select-open');if(sheet._select)sheet._select.focus({preventScroll:true});sheet._select=null;};
    sheet.querySelector('.egy-select-heading button').addEventListener('click',close);
    sheet.addEventListener('click',e=>{if(e.target===sheet)close();});
    sheet.addEventListener('click',e=>{
      const option=e.target.closest('[data-select-index]');if(!option||!sheet._select)return;
      const select=sheet._select, value=select.options[Number(option.dataset.selectIndex)];
      if(value){select.value=value.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
      close();
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)close();});
    return sheet;
  }
  function openEgySelect(select){
    if(!select||select.disabled)return;
    const sheet=ensureEgySelectSheet();sheet._select=select;
    const label=select.labels&&select.labels[0] ? select.labels[0].textContent.trim() : (select.getAttribute('aria-label')||'اختر');
    sheet.querySelector('.egy-select-heading strong').textContent=label;
    const options=sheet.querySelector('.egy-select-options');options.replaceChildren();
    Array.from(select.options).forEach((opt,index)=>{
      const b=document.createElement('button');b.type='button';b.className='egy-select-option'+(opt.selected?' is-selected':'');b.dataset.selectIndex=String(index);b.setAttribute('role','option');b.setAttribute('aria-selected',String(opt.selected));
      const text=document.createElement('span');text.textContent=opt.textContent;
      const radio=document.createElement('span');radio.className='egy-select-radio';radio.setAttribute('aria-hidden','true');
      b.append(text,radio);options.append(b);
    });
    sheet.hidden=false;document.body.classList.add('egy-select-open');
  }
  // Proxy selects to the single existing EgyBook picker sheet (prevents Android's black native popup).
  function installEgySelectProxies(){
    const modal=document.getElementById('editProfileModal');
    if(!modal)return;
    modal.querySelectorAll('#editProfileForm select.modal-input').forEach(select=>{
      if(select.dataset.egyProxyReady==='1')return;
      select.dataset.egyProxyReady='1';
      const wrap=document.createElement('div'); wrap.className='egy-select-proxy-wrap';
      const proxy=document.createElement('button'); proxy.type='button'; proxy.className='egy-select-proxy';
      proxy.setAttribute('aria-haspopup','dialog');
      proxy.setAttribute('aria-label',select.labels?.[0]?.textContent?.trim()||'اختيار قيمة');
      const sync=()=>{
        const option=select.options[select.selectedIndex];
        const labelText=(option?.textContent||'اختر').trim();
        proxy.replaceChildren();
        const valueText=document.createElement('span');
        valueText.className='egy-select-proxy-label';
        valueText.textContent=labelText;
        const arrow=document.createElement('span');
        arrow.className='egy-select-proxy-arrow';
        arrow.setAttribute('aria-hidden','true');
        arrow.textContent='⌄';
        proxy.append(valueText,arrow);
        proxy.setAttribute('aria-label',`${select.labels?.[0]?.textContent?.trim()||'اختيار قيمة'}: ${labelText}`);
      };
      sync(); select.addEventListener('change',sync);
      select.tabIndex=-1; select.setAttribute('aria-hidden','true'); select.classList.add('egy-select-native-hidden');
      select.parentNode.insertBefore(wrap,select); wrap.append(proxy,select);
      proxy.addEventListener('click',()=>openEgySelect(select));
    });
  }
  installEgySelectProxies();

  // Open the custom picker on a completed tap, not pointerdown, so a finger
  // starting on a select and moving to scroll the form cannot accidentally open it.

  // Handle Android/browser edge-swipe Back while the profile editor is open.
  // Capture phase is intentional: it must stop route-level popstate listeners from
  // navigating to Home/another page after the modal has been dismissed.
  window.addEventListener('popstate', event => {
    if (window.__egybookSkipProfileModalPop) {
      window.__egybookSkipProfileModalPop = false;
      window.__egybookEditProfileHistoryActive = false;
      event.stopImmediatePropagation();
      return;
    }
    const modal = document.getElementById('editProfileModal');
    if (!modal || modal.hidden || !modal.classList.contains('open')) return;
    window.__egybookEditProfileHistoryActive = false; // the modal history entry was consumed by Back
    window.__egybookProfilePopClosing = true;
    event.stopImmediatePropagation();
    try { closeModal(modal); }
    finally { window.__egybookProfilePopClosing = false; }
  }, true);

  // Profile modal stability: lock the background and restore the exact profile scroll position.
  (function initProfileModalStability(){
    const modal=document.getElementById('editProfileModal');
    if(!modal || modal.dataset.egybookStabilityReady==='1') return;
    modal.dataset.egybookStabilityReady='1';
    let savedY=0, locked=false, prior={};
    const isOpen=()=>!modal.hidden && modal.classList.contains('open');
    const lock=()=>{
      if(locked)return;
      locked=true; savedY=window.scrollY||window.pageYOffset||0;
      const body=document.body, html=document.documentElement;
      // openModal() sets body overflow to hidden before MutationObserver runs.
      // Do not remember that temporary value as the page's original state.
      prior={position:body.style.position,top:body.style.top,width:body.style.width,htmlOverflow:html.style.overflow};
      body.classList.add('profile-menu-open');
      html.style.overflow='hidden'; body.style.overflow='hidden';
      body.style.position='fixed'; body.style.top=`-${savedY}px`; body.style.width='100%';
    };
    const unlock=()=>{
      if(!locked)return;
      locked=false; const body=document.body, html=document.documentElement;
      body.style.position=prior.position||'';
      body.style.top=prior.top||''; body.style.width=prior.width||'';
      html.style.overflow=prior.htmlOverflow||''; body.classList.remove('profile-menu-open');
      // Preserve overflow only when another modal remains open; otherwise always unlock.
      body.style.overflow=document.querySelector('.modal.open')?'hidden':'';
      requestAnimationFrame(()=>{window.scrollTo({top:savedY,left:0,behavior:'auto'});});
    };
    const sync=()=>isOpen()?lock():unlock();
    new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class','hidden']});
    sync();
    modal.addEventListener('touchmove',event=>{
      if(event.target.closest('#egySelectSheet .egy-select-options'))return;
      const form=event.target.closest('#editProfileForm');
      if(form && form.scrollHeight>form.clientHeight)return;
      if(!event.target.closest('.edit-profile-box'))event.preventDefault();
    },{passive:false});
  })();

  // Prevent long-press copy/context menus on modal labels and picker options.
  // Text entry remains selectable inside input/textarea fields.
  const editModal=$('#editProfileModal');
  if(editModal){
    editModal.addEventListener('contextmenu',event=>{
      if(event.target.closest('input,textarea,[contenteditable="true"]'))return;
      event.preventDefault();
    });
    editModal.addEventListener('selectstart',event=>{
      if(!event.target.closest('input,textarea,[contenteditable="true"]'))event.preventDefault();
    });
  }
  document.addEventListener('contextmenu',event=>{
    if(event.target.closest('#egySelectSheet'))event.preventDefault();
  });
  document.addEventListener('selectstart',event=>{
    if(event.target.closest('#egySelectSheet'))event.preventDefault();
  });


  $('#editProfileForm').addEventListener('submit',async event=>{
    event.preventDefault();const username=$('#editUsername').value.trim().replace(/^@/,'');
    if(!/^[A-Za-z0-9._]{3,30}$/.test(username)){showToast('اسم المستخدم يجب أن يكون 3–30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو _.');return;}
    profileData={...profileData,name:$('#editName').value.trim(),username,bio:$('#editBio').value.trim(),mood:$('#editMood').value,location:$('#editLocation').value.trim(),birthdate:$('#editBirthdate').value,gender:$('#editGender').value,website:$('#editWebsite').value.trim(),phone:$('#editPhone').value.trim(),privacy:$('#editPrivacy').value,
      locationPrivacy:$('#editLocationPrivacy').value,birthdatePrivacy:$('#editBirthdatePrivacy').value,birthdate_display:$('#editBirthdateDisplay').value,
      relationship:$('#editRelationship').value,relationshipPrivacy:$('#editRelationshipPrivacy').value,
      work:$('#editWork').value.trim(),workPrivacy:$('#editWorkPrivacy').value,
      education:$('#editEducation').value.trim(),educationPrivacy:$('#editEducationPrivacy').value,activity_privacy:$('#editActivityPrivacy').value};
    if(!currentUser||!supabase){showToast('سجّل الدخول أولًا لحفظ بيانات الملف الشخصي على السحابة.');return;}
    const submitButton=$('#editProfileForm button[type="submit"]');
    if(submitButton){submitButton.disabled=true;submitButton.dataset.originalText=submitButton.textContent;submitButton.textContent='جارٍ الحفظ…';}
    try{
      const {error:publicError}=await supabase.from('profiles').upsert(cloudProfilePayload(),{onConflict:'id'});
      if(publicError)throw publicError;
      const privateSaved=await persistPrivateProfile();
      if(!privateSaved)throw new Error('تعذر حفظ البيانات الخاصة في profile_private');
      saveProfile();applyProfile();
      if(currentPage==='profile'){history.replaceState({page:'profile',username:cleanUsername(profileData.username)},'',profilePath(profileData.username));syncHeaderProfileUsername();}
      closeModal($('#editProfileModal'));
      showToast('تم حفظ بيانات حسابك ومزامنتها بنجاح.');
    }catch(error){
      console.error('Profile sync failed:',error);
      const message=String(error?.message||'');
      if(/column .* does not exist|schema cache|relation .* does not exist/i.test(message))
        showToast('تعذرت المزامنة: قاعدة البيانات تحتاج إلى تحديث الأعمدة أو الجداول. راجع ملف SQL المرفق.');
      else if(/row-level security|permission denied|not allowed/i.test(message))
        showToast('تعذرت المزامنة بسبب صلاحيات قاعدة البيانات (RLS).');
      else showToast('تعذر حفظ البيانات على السحابة. لم يتم تأكيد الحفظ؛ حاول مرة أخرى.');
    }finally{
      if(submitButton){submitButton.disabled=false;submitButton.textContent=submitButton.dataset.originalText||'حفظ التغييرات';delete submitButton.dataset.originalText;}
    }
  });
  $('#profileCoverInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'cover');event.target.value='';});
  $$('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal.open').forEach(closeModal); });

  $('#composerFeatureBody')?.addEventListener('click',event=>{
    if(event.target.closest('[data-audius-trim-back]')){audiusMusicView='list';renderAudiusMusic(audiusTrimReturnQuery);return;}
    if(event.target.closest('[data-audius-change-track]')){audiusMusicView='list';renderAudiusMusic(audiusTrimReturnQuery);if(!audiusTracks.length)loadAudiusTracks(audiusTrimReturnQuery);return;}
    if(event.target.closest('[data-audius-remove-track]')){composerPostMeta.music_title='';composerPostMeta.music_artist='';composerPostMeta.music_track_id='';composerPostMeta.music_permalink='';composerPostMeta.music_artwork_url='';composerPostMeta.music_start_seconds=0;composerPostMeta.music_duration_seconds=30;composerPostMeta.music_duration_total=0;audiusMusicView='list';audiusTrimCanRemove=false;audiusMusicOriginalMeta=JSON.parse(JSON.stringify(composerPostMeta));audiusMusicConfirmed=false;updateComposerIdentityPreview();renderAudiusMusic(audiusTrimReturnQuery);showToast('تمت إزالة الأغنية من المنشور.');return;}
    if(event.target.closest('[data-audius-confirm-trim]')){audiusMusicConfirmed=true;updateComposerIdentityPreview();if(audiusAudio){audiusAudio.pause();audiusAudio.removeAttribute('src');audiusAudio.load();audiusAudio=null;audiusPlayingTrackId=null;}closeModal($('#composerFeatureModal'));showToast('تمت إضافة الأغنية إلى المنشور.');return;}
    if(event.target.closest('[data-audius-retry]')){loadAudiusTracks($('#composerFeatureSearch')?.value||'');return;}
    if(event.target.closest('[data-audius-clear-search]')){const input=$('#composerFeatureSearch');if(input)input.value='';audiusActiveCategory='trending';loadAudiusTracks('');return;}
    const category=event.target.closest('[data-audius-category]');
    if(category){audiusActiveCategory=category.dataset.audiusCategory;loadAudiusTracks($('#composerFeatureSearch')?.value||'');return;}
    const play=event.target.closest('[data-audius-play]');
    if(play){previewAudiusTrack(play.dataset.audiusPlay);return;}
    const audiusSong=event.target.closest('[data-audius-select]');
    if(audiusSong){composerPostMeta.music_title=audiusSong.dataset.trackTitle||'';composerPostMeta.music_artist=audiusSong.dataset.trackArtist||'';composerPostMeta.music_track_id=audiusSong.dataset.audiusSelect||'';composerPostMeta.music_permalink=audiusSong.dataset.trackUrl||'';composerPostMeta.music_artwork_url=audiusSong.dataset.trackArtwork||'';composerPostMeta.music_duration_total=Math.max(5,Number(audiusSong.dataset.trackDuration)||180);composerPostMeta.music_start_seconds=0;composerPostMeta.music_duration_seconds=Math.min(30,Math.max(5,Number(composerPostMeta.music_duration_total)||30));audiusMusicView='trim';if(audiusAudio){audiusAudio.pause();audiusAudio.removeAttribute('src');audiusAudio.load();audiusAudio=null;audiusPlayingTrackId=null;}updateComposerIdentityPreview();renderAudiusMusic($('#composerFeatureSearch')?.value||'');return;}
    const tab=event.target.closest('[data-feature-tab]');
    if(tab){composerFeatureMode=tab.dataset.featureTab;renderComposerFeature(composerFeatureMode);return;}
    const option=event.target.closest('[data-feature-value]');
    if(option){
      if(composerFeatureMode==='feeling'){composerPostMeta.feeling=option.dataset.featureValue;composerFeatureMode='feeling';}
      else if(composerFeatureMode==='activity'){composerPostMeta.activity=option.dataset.featureValue;}
      updateComposerIdentityPreview();renderComposerFeature(composerFeatureMode);
    }
    const song=event.target.closest('[data-song-select]');
    if(song){composerPostMeta.music_title=song.dataset.songTitle;composerPostMeta.music_artist=song.dataset.songArtist;updateComposerIdentityPreview();closeModal($('#composerFeatureModal'));showToast('تم اختيار الأغنية.');}
  });
  $('#composerFeatureBody')?.addEventListener('input',event=>{
    if(event.target.id==='audiusStartRange'){
      composerPostMeta.music_start_seconds=Number(event.target.value)||0;
      const label=$('#audiusStartValue');if(label)label.textContent=formatMusicDuration(composerPostMeta.music_start_seconds)||'0:00';
      const end=$('#audiusTrimRangeLabel');if(end)end.textContent=`${formatMusicDuration(composerPostMeta.music_start_seconds)||'0:00'} – ${formatMusicDuration(composerPostMeta.music_start_seconds+Number(composerPostMeta.music_duration_seconds||30))}`;
    } else if(event.target.id==='audiusDurationRange'){
      composerPostMeta.music_duration_seconds=Math.min(110,Math.max(5,Number(event.target.value)||30));
      const startRange=$('#audiusStartRange');if(startRange){startRange.max=String(Math.max(0,Number(composerPostMeta.music_duration_total||180)-composerPostMeta.music_duration_seconds));if(Number(startRange.value)>Number(startRange.max)){startRange.value=startRange.max;composerPostMeta.music_start_seconds=Number(startRange.value)||0;}}
      const label=$('#audiusDurationValue');if(label)label.textContent=formatMusicDuration(composerPostMeta.music_duration_seconds);
      const startLabel=$('#audiusStartValue');const end=$('#audiusTrimRangeLabel');if(end)end.textContent=`${formatMusicDuration(composerPostMeta.music_start_seconds)||'0:00'} – ${formatMusicDuration(composerPostMeta.music_start_seconds+composerPostMeta.music_duration_seconds)}`;
    }
  });
  $('#composerFeatureBody')?.addEventListener('click',async event=>{
    if(!event.target.closest('[data-audius-trim-preview]'))return;
    const id=String(composerPostMeta.music_track_id||'');
    if(!id)return;
    try{
      if(window.__egybookStopPostMusic)window.__egybookStopPostMusic(false);
      if(audiusAudio){try{audiusAudio.pause();audiusAudio.removeAttribute('src');audiusAudio.load();}catch(_){}}
      const audio=new Audio(audiusEndpoint(`/tracks/${encodeURIComponent(id)}/stream`));audiusAudio=audio;
      audio.preload='metadata';
      const start=Math.max(0,Number(composerPostMeta.music_start_seconds)||0);
      const duration=Math.min(110,Math.max(5,Number(composerPostMeta.music_duration_seconds)||30));
      audio.addEventListener('loadedmetadata',()=>{if(audiusAudio===audio)try{audio.currentTime=start;}catch(_){}},{once:true});
      audio.addEventListener('timeupdate',()=>{if(audiusAudio===audio&&audio.currentTime>=start+duration){audio.pause();try{audio.currentTime=start;}catch(_){}}});
      audio.addEventListener('error',()=>{if(audiusAudio===audio)showToast('المقطع غير متاح للمعاينة حاليًا. جرّب أغنية أخرى.');},{once:true});
      await audio.play();
      showToast('تشغيل معاينة المقطع المحدد.');
    }catch(error){showToast(/NotAllowedError/i.test(String(error?.name))?'اضغط مرة أخرى للسماح بتشغيل المعاينة.':'تعذرت معاينة المقطع. جرّب مرة أخرى.');}
  });
  $('#composerFeatureBody')?.addEventListener('change',event=>{
    const input=event.target.closest('[data-tag-friend]');
    if(!input)return;
    const id=input.dataset.tagFriend;
    if(input.checked){if(!composerPostMeta.tagged_user_ids.includes(id))composerPostMeta.tagged_user_ids.push(id);}
    else composerPostMeta.tagged_user_ids=composerPostMeta.tagged_user_ids.filter(x=>x!==id);
    updateComposerIdentityPreview();
  });
  $('#composerFeatureBody')?.addEventListener('input',event=>{
    if(event.target.id==='composerFeatureSearch'){
      if(composerFeatureMode==='music'){
        const query=event.target.value;
        clearTimeout(audiusSearchTimer);
        audiusSearchTimer=setTimeout(()=>{audiusActiveCategory='trending';loadAudiusTracks(query);},300);
      } else {
        renderComposerFeature(composerFeatureMode,event.target.value);const el=$('#composerFeatureSearch');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
      }
    }
    if(event.target.id==='composerLocationSearch'){
      const map=$('#composerLocationMap');const value=event.target.value.trim();
      if(map)map.innerHTML=value?`<iframe title="معاينة الخريطة" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(value)}&output=embed"></iframe>`:'<div class="composer-map-placeholder">📍 ابحث عن مكان لعرض معاينة الخريطة</div>';
    }
  });

  let activePostMusicAudio=null, activePostMusicCard=null;
  let postMusicObserver=null;
  const observedPostMusicTargets=new WeakSet();
  function syncViewerMusicPlayback(card){
    const viewer=$('#imageViewerMusic');if(!viewer||viewer.hidden)return;
    viewer.classList.toggle('is-playing',!!card?.classList.contains('is-playing'));
    const postMute=card?.querySelector('[data-post-music-mute]'),viewerMute=viewer.querySelector('[data-action="image-music-mute"]');
    if(postMute&&viewerMute){viewerMute.textContent=postMute.textContent;viewerMute.setAttribute('aria-label',postMute.getAttribute('aria-label')||'كتم صوت الأغنية');}
  }
  function stopPostMusic(reset=true){
    if(activePostMusicAudio){
      try{activePostMusicAudio.pause();if(reset&&activePostMusicCard)activePostMusicAudio.currentTime=Math.max(0,Number(activePostMusicCard.dataset.start)||0);}catch(_){}
      activePostMusicAudio.removeAttribute('src');try{activePostMusicAudio.load();}catch(_){}
    }
    const stoppedCard=activePostMusicCard;activePostMusicCard?.classList.remove('is-playing');syncViewerMusicPlayback(stoppedCard);
    activePostMusicAudio=null;activePostMusicCard=null;
  }
  window.__egybookStopPostMusic=stopPostMusic;
  async function startPostMusic(card){
    if(!card||document.hidden||$('#createPostModal')?.classList.contains('open')||$('#composerFeatureModal')?.classList.contains('open')||card.dataset.muted==='true'||card.dataset.finished==='true'||card.dataset.autoplayBlocked==='true')return;
    if(activePostMusicCard===card&&activePostMusicAudio&&!activePostMusicAudio.paused)return;
    stopPostMusic(false);
    const track=card.dataset.trackId;if(!track)return;
    const start=Math.max(0,Number(card.dataset.start)||0),duration=Math.min(110,Math.max(5,Number(card.dataset.duration)||30));
    const audio=new Audio(audiusEndpoint(`/tracks/${encodeURIComponent(track)}/stream`));
    audio.preload='auto';audio.volume=0.9;
    activePostMusicAudio=audio;activePostMusicCard=card;card.classList.add('is-playing');const musicButton=card.querySelector('[data-post-music-mute]');if(musicButton){musicButton.textContent='🔇';musicButton.setAttribute('aria-label','كتم الصوت');}syncViewerMusicPlayback(card);
    audio.addEventListener('loadedmetadata',()=>{try{audio.currentTime=start;}catch(_){}},{once:true});
    audio.addEventListener('timeupdate',()=>{
      if(activePostMusicAudio===audio&&audio.currentTime>=start+duration){
        audio.pause();card.dataset.finished='true';card.classList.remove('is-playing');syncViewerMusicPlayback(card);
        if(activePostMusicCard===card){activePostMusicAudio=null;activePostMusicCard=null;}
        try{audio.removeAttribute('src');audio.load();}catch(_){}
      }
    });
    audio.addEventListener('ended',()=>{if(activePostMusicAudio!==audio)return;card.dataset.finished='true';card.classList.remove('is-playing');syncViewerMusicPlayback(card);if(activePostMusicCard===card){activePostMusicAudio=null;activePostMusicCard=null;}try{audio.removeAttribute('src');audio.load();}catch(_){}});
    audio.addEventListener('error',()=>{if(activePostMusicAudio!==audio)return;card.classList.remove('is-playing');const button=card.querySelector('[data-post-music-mute]');if(button){button.textContent='▶';button.setAttribute('aria-label','تعذر التشغيل؛ اضغط للمحاولة مرة أخرى');}syncViewerMusicPlayback(card);if(activePostMusicCard===card){activePostMusicAudio=null;activePostMusicCard=null;}try{audio.pause();audio.removeAttribute('src');audio.load();}catch(_){}card.dataset.autoplayBlocked='true';console.warn('Post music playback failed');});
    try{
      // Browsers may block audible autoplay; keep the card available and retry on a user tap.
      await audio.play();
      if(audio.currentTime<start)try{audio.currentTime=start;}catch(_){}
    }catch(error){
      card.classList.remove('is-playing');
      if(activePostMusicCard===card){activePostMusicAudio=null;activePostMusicCard=null;}
      try{audio.pause();audio.removeAttribute('src');audio.load();}catch(_){}
      card.dataset.autoplayBlocked='true';const musicButton=card.querySelector('[data-post-music-mute]');if(musicButton){musicButton.textContent='▶';musicButton.setAttribute('aria-label','اضغط لتشغيل الأغنية');}
    }
  }
  function observePostMusicPlayers(root=document){
    if(!('IntersectionObserver' in window))return;
    if(!postMusicObserver){
      postMusicObserver=new IntersectionObserver(entries=>{
        entries.forEach(entry=>{
          const post=entry.target.closest('.post');
          const card=post?.querySelector('[data-post-music-player]')||(entry.target.matches?.('[data-post-music-player]')?entry.target:null);
          if(!card)return;
          if(entry.isIntersecting&&entry.intersectionRatio>=0.3&&!document.hidden){
            startPostMusic(card);
          }else{
            card.dataset.finished='false';
            if(activePostMusicCard===card)stopPostMusic(true);
          }
        });
      },{threshold:[0,0.15,0.3,0.5],rootMargin:'0px'});
    }
    root.querySelectorAll?.('[data-post-music-player]')?.forEach(card=>{
      const post=card.closest('.post');
      const target=post?.querySelector('.post-media-single-wrap,.post-image')||card;
      if(target&&!observedPostMusicTargets.has(target)){observedPostMusicTargets.add(target);postMusicObserver.observe(target);}
    });
  }
  document.addEventListener('click',async event=>{
    const mute=event.target.closest('[data-post-music-mute]');
    if(!mute)return;
    const card=mute.closest('[data-post-music-player]');if(!card)return;
    const isMuted=card.dataset.muted==='true';
    if(activePostMusicCard===card&&activePostMusicAudio){
      card.dataset.muted=String(!isMuted);activePostMusicAudio.muted=!isMuted;
      mute.textContent=isMuted?'🔊':'🔇';mute.setAttribute('aria-pressed',String(!isMuted));mute.setAttribute('aria-label',isMuted?'كتم الصوت':'إلغاء كتم الصوت');
      return;
    }
    if(isMuted){card.dataset.muted='false';mute.setAttribute('aria-pressed','false');}
    card.dataset.autoplayBlocked='false';card.dataset.finished='false';mute.textContent='🔇';mute.setAttribute('aria-label','كتم الصوت');
    if(activePostMusicCard&&activePostMusicCard!==card)stopPostMusic(false);
    startPostMusic(card);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPostMusic(true);else observePostMusicPlayers(document);});
  window.addEventListener('pagehide',()=>stopPostMusic(true));
  $('#postForm').addEventListener('submit', publishPost);
  $('#postContent').addEventListener('input', updatePublishButton);
  $('#audienceChoices').addEventListener('click',event=>{
    const option=event.target.closest('[data-audience]');if(!option)return;
    selectedAudience=option.dataset.audience;
    syncAudienceUI();
    if(['استثناء','أشخاص محددون','الأصدقاء المقربون','قائمة مخصصة'].includes(selectedAudience)){
      if(!audienceFriendsCache.length)loadAudienceFriends();else renderAudienceFriends();
    }
  });
  $('#audienceFriendsList').addEventListener('change',event=>{
    const input=event.target.closest('[data-audience-friend-id]');if(!input)return;
    const id=input.dataset.audienceFriendId;
    const arr=selectedAudience==='استثناء'?excludedAudienceIds:selectedAudienceIds;
    if(input.checked){if(!arr.includes(id))arr.push(id);}else{const i=arr.indexOf(id);if(i>=0)arr.splice(i,1);}
  });
  $('#audienceFriendSearch').addEventListener('input',renderAudienceFriends);

  $('#profilePhotoInput').addEventListener('change',event=>{readProfileImage(event.target.files[0],'avatar');event.target.value='';});
  photoInput.addEventListener('change', async () => { const files=[...(photoInput.files||[])].slice(0,10);photoInput.value='';if(!files.length)return;openModal(createPostModal);for(const file of files)await readMedia(file,'image');if(files.length>1)showToast(`تمت إضافة ${files.length} صور. يمكنك حذف أي صورة قبل النشر.`); });
  videoInput.addEventListener('change', () => { selectedMediaItems=[];readMedia(videoInput.files[0], 'video'); videoInput.value = ''; openModal(createPostModal); });
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
  $('#commentInput').addEventListener('input',()=>{handleMentionInput();});
  $('#commentInput').addEventListener('blur',()=>setTimeout(hideMentionSuggestions,140));
  $('#commentMentionSuggestions')?.addEventListener('pointerdown',event=>{const option=event.target.closest('[data-username]');if(!option)return;event.preventDefault();insertMention(option.dataset.username);});
  $('#commentReactionsClose')?.addEventListener('click',()=>{const modal=$('#commentReactionsModal');if(modal){modal.hidden=true;modal.classList.remove('open');}});
  $('#commentReactionsModal')?.addEventListener('click',event=>{if(event.target.id==='commentReactionsModal'){event.currentTarget.hidden=true;event.currentTarget.classList.remove('open');}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){const modal=$('#commentReactionsModal');if(modal&&!modal.hidden){modal.hidden=true;modal.classList.remove('open');}}});
  $('#commentForm').addEventListener('submit',async e=>{
    e.preventDefault();const text=$('#commentInput').value.trim();if((!text&&!pendingCommentImage&&!pendingCommentAudio)||!activeCommentsPost)return;
    const post=activeCommentsPost,postId=String(post.dataset.postId||'');
    const c={id:'c-'+Date.now(),name:getActiveProfileName(),username:profileData.username||currentUser?.user_metadata?.username||'',userId:currentUser?.id||'',avatar:profileData.avatar||'',time:'الآن',text,likes:0,dislikes:0,replies:[],imageUrl:'',audioUrl:'',audioDuration:pendingCommentAudioDuration};
    if(supabase && currentUser && postId){
      const payload={post_id:postId,user_id:currentUser.id,user_name:getActiveProfileName(),body:text||''};
      try{
        if(pendingCommentImage)payload.image_url=await uploadPostMedia(pendingCommentImage,currentUser.id);
        if(pendingCommentAudio){const audioMime=pendingCommentAudio.type||'audio/webm';const audioExt=/mp4|m4a/i.test(audioMime)?'m4a':/ogg|opus/i.test(audioMime)?'ogg':/mpeg|mp3/i.test(audioMime)?'mp3':'webm';const audioFile=new File([pendingCommentAudio],`comment-audio-${Date.now()}.${audioExt}`,{type:audioMime});payload.audio_url=await uploadPostMedia(audioFile,currentUser.id);payload.audio_duration_seconds=pendingCommentAudioDuration;}
      }catch(uploadError){console.error('Comment attachment upload failed:',uploadError);const detail=String(uploadError?.message||uploadError?.error||'');const policy=/row.level|permission|policy|unauthorized|not allowed|403/i.test(detail);const mime=/mime|content.type|file type|not supported/i.test(detail);showToast(policy?'تعذر الرفع بسبب صلاحيات التخزين. راجع سياسة INSERT لحاوية post-media.':mime?'نوع الملف الصوتي غير مقبول في إعدادات post-media.':detail?`تعذر رفع المرفق: ${detail.slice(0,100)}`:'تعذر رفع المرفق. تحقق من الاتصال وإعدادات post-media.');return;}
      if(replyToComment)payload.parent_id=String(replyToComment);
      const {data:savedComment,error}=await supabase.from('post_comments').insert(payload).select('id').single();
      if(error){showToast('تعذر حفظ '+(replyToComment?'الرد':'التعليق')+' في السحابة: '+error.message);return;}
      clearPendingCommentAttachment();$('#commentInput').value='';replyToComment=null;$('#commentInput').placeholder=`تعليق باسم ${getActiveProfileName()} ...`;
      try{const usernames=[...new Set((text.match(/@([A-Za-z0-9_.-]{2,30})/g)||[]).map(v=>v.slice(1).toLowerCase()))];if(usernames.length&&savedComment?.id){const {data:mentioned,error:mentionError}=await supabase.from('profiles').select('id,username').in('username',usernames);if(mentionError)throw mentionError;const recipients=(mentioned||[]).filter(u=>u.id!==currentUser.id);if(recipients.length){const notifications=recipients.map(u=>({recipient_id:u.id,actor_id:currentUser.id,type:'comment',title:payload.parent_id?'تم ذكرك في رد':'تم ذكرك في تعليق',body:`${getActiveProfileName()} ذكرك: ${text.slice(0,180)}`,post_id:postId,comment_id:savedComment.id}));const notifyResult=await supabase.from('notifications').insert(notifications);if(notifyResult.error)throw notifyResult.error;}}}catch(mentionNotifyError){console.warn('Mention notifications could not be created. Run the comment mentions migration.',mentionNotifyError);}
      await loadCloudComments(post);await loadCloudPostStats(post);return;
    }
    if(pendingCommentImage||pendingCommentAudio){showToast('إرسال الصور والتسجيلات يحتاج تسجيل الدخول واتصال Supabase.');return;}
    const arr=getCommentsFor(post);
    if(replyToComment){const parent=findCommentById(arr,replyToComment);if(parent){parent.replies=parent.replies||[];parent.replies.push({...c,id:'r-'+Date.now()});}replyToComment=null;$('#commentInput').placeholder=`تعليق باسم ${getActiveProfileName()} ...`;}
    else arr.push(c);
    saveComments();$('#commentInput').value='';renderComments();syncPostStats(post);
  });
  $('#commentReactionPicker').addEventListener('click',e=>{
    const b=e.target.closest('[data-reaction]');if(!b)return;
    const picker=$('#commentReactionPicker');
    reactionFeedback(b.dataset.reaction,b);
    if(picker.dataset.target==='comment'){
      const c=findCommentById(getCommentsFor(activeCommentsPost),picker.dataset.commentId);
      if(c){c.reaction=b.dataset.reaction;c.vote='like';if(supabase&&currentUser&&c.cloud){c.myReaction=b.dataset.reaction;c.reactions=(c.reactions||[]).filter(r=>r.userId!==currentUser.id);c.reactions.push({userId:currentUser.id,reaction:b.dataset.reaction});supabase.from('post_comment_reactions').upsert({comment_id:String(c.id),user_id:currentUser.id,reaction:b.dataset.reaction,updated_at:new Date().toISOString()},{onConflict:'comment_id,user_id'}).then(({error})=>{if(error){showToast('تعذر حفظ التفاعل على التعليق.');console.error(error);}});}saveComments();renderComments();}
    } else if(picker.dataset.target==='viewer'){
      void applyImageViewerReaction(b.dataset.reaction);
    } else {
      const post=$$('.post').find(p=>p.dataset.postId===picker.dataset.postId);
      if(post) void selectReaction(post,b.dataset.reaction,reactionLabels[b.dataset.reaction]);
    }
    picker.hidden=true;picker.dataset.target='post';
  });
  let reactionGesture=null;
  const reactionPicker=$('#commentReactionPicker');
  const positionReactionPicker=(button)=>{
    if(!reactionPicker||!button)return;
    const r=button.getBoundingClientRect(),width=Math.min(320,innerWidth-16),height=reactionPicker.offsetHeight||58;
    reactionPicker.style.maxWidth=width+'px';
    reactionPicker.style.left=Math.max(8,Math.min(innerWidth-width-8,r.left+(r.width-width)/2))+'px';
    reactionPicker.style.top=Math.max(8,Math.min(innerHeight-height-8,r.top-height-10))+'px';
    reactionPicker.hidden=false;reactionPicker.classList.remove('picker-enter');void reactionPicker.offsetWidth;reactionPicker.classList.add('picker-enter');
  };
  const reactionAtPoint=(x,y)=>{
    const el=document.elementFromPoint(x,y),b=el?.closest?.('#commentReactionPicker [data-reaction]');
    if(b){reactionPicker.querySelectorAll('[data-reaction]').forEach(item=>item.classList.toggle('swipe-highlight',item===b));reactionGesture.current=b;}
    else if(reactionGesture){
      const r=reactionPicker.getBoundingClientRect();
      // Moving between the trigger and picker is allowed. Only clear the
      // highlighted choice; final pointerup outside the picker cancels.
      if(x < r.left-24 || x > r.right+24 || y < r.top-40 || y > r.bottom+40){
        reactionPicker.querySelectorAll('[data-reaction]').forEach(item=>item.classList.remove('swipe-highlight'));
        reactionGesture.current=null;
      }
    }
  };
  document.addEventListener('pointerdown',e=>{
    const commentLike=e.target.closest('#commentsList .comment-vote[data-vote="like"]');
    const postLike=e.target.closest('.post [data-action="like"]');
    const viewerLike=e.target.closest('#imageViewer [data-action="image-like"]');
    const like=commentLike||postLike||viewerLike;if(!like)return;
    clearTimeout(commentPressTimer);commentLongPressed=false;
    reactionGesture={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,moved:false,current:null,source:like,target:commentLike?'comment':viewerLike?'viewer':'post'};
    commentPressTimer=setTimeout(()=>{
      if(!reactionGesture)return;
      commentLongPressed=true;
      // Lock the page for the entire long-press gesture and keep receiving
      // pointer events even when the finger moves from the button to the picker.
      document.documentElement.classList.add('reaction-gesture-active');
      try { reactionGesture.source.setPointerCapture?.(reactionGesture.pointerId); } catch (_) {}
      if(postLike||viewerLike)longPressTriggered=true;
      if(commentLike){const row=commentLike.closest('.egy-comment');reactionPicker.dataset.target='comment';reactionPicker.dataset.commentId=row?.dataset.commentId||'';}
      else if(viewerLike){reactionPicker.dataset.target='viewer';reactionPicker.dataset.postId=getViewerPost()?.dataset.postId||'';}
      else {const post=postLike.closest('.post');reactionPicker.dataset.target='post';reactionPicker.dataset.postId=post?.dataset.postId||'';}
      positionReactionPicker(like);
      reactionPicker.classList.add('is-swiping');
      document.documentElement.classList.add('reaction-gesture-active');
      reactionAtPoint(reactionGesture.startX,reactionGesture.startY);
    },430);
  },{passive:true});
  document.addEventListener('pointermove',e=>{
    if(!reactionGesture||e.pointerId!==reactionGesture.pointerId)return;
    if(commentLongPressed){e.preventDefault();e.stopPropagation();}
    const dx=e.clientX-reactionGesture.startX,dy=e.clientY-reactionGesture.startY;
    if(!commentLongPressed&&(Math.abs(dx)>12||Math.abs(dy)>12)){clearTimeout(commentPressTimer);commentPressTimer=null;reactionGesture=null;return;}
    if(commentLongPressed){
      reactionGesture.moved ||= Math.abs(dx)>7||Math.abs(dy)>7;
      if(reactionGesture.moved){reactionPicker.classList.add('is-swiping');reactionAtPoint(e.clientX,e.clientY);}
    }
  },{passive:false});
  document.addEventListener('pointerup',e=>{
    clearTimeout(commentPressTimer);commentPressTimer=null;
    if(!reactionGesture||e.pointerId!==reactionGesture.pointerId)return;
    const gesture=reactionGesture;reactionGesture=null;
    const releasedOnPicker = !!document.elementFromPoint(e.clientX,e.clientY)?.closest?.('#commentReactionPicker [data-reaction]');
    if(commentLongPressed&&gesture.moved&&gesture.current&&!gesture.cancelled&&releasedOnPicker){
      e.preventDefault();e.stopPropagation();
      const chosen=gesture.current;reactionPicker.classList.remove('is-swiping');
      chosen.click();commentLongPressed=false;
    }else if(commentLongPressed){
      if(gesture.target==='viewer'){reactionPicker.classList.remove('is-swiping');}
      else dismissReactionPickers();
      commentLongPressed=false;
    }else if(!commentLongPressed){commentLongPressed=false;}
    document.documentElement.classList.remove('reaction-gesture-active');
    if(commentLongPressed)setTimeout(()=>{commentLongPressed=false;},300);
    if(longPressTriggered)setTimeout(()=>{longPressTriggered=false;},300);
    setTimeout(()=>{reactionPicker?.classList.remove('is-swiping');reactionPicker?.querySelectorAll('[data-reaction]').forEach(item=>item.classList.remove('swipe-highlight'));},100);
  },true);
  document.addEventListener('pointercancel',()=>{clearTimeout(commentPressTimer);commentPressTimer=null;reactionGesture=null;commentLongPressed=false;document.documentElement.classList.remove('reaction-gesture-active');dismissReactionPickers();});
  document.addEventListener('click',e=>{if(!e.target.closest('#commentReactionPicker')&&!e.target.closest('.post [data-action="like"]')&&!e.target.closest('#imageViewer [data-action="image-like"]')&&!e.target.closest('#commentsList .comment-vote[data-vote="like"]'))dismissReactionPickers();});
  // Reaction pickers are transient: close them as soon as the user scrolls a feed, profile, or comments list.
  document.addEventListener('scroll',event=>{if(!commentLongPressed&&(event.target===document||event.target===document.documentElement||event.target===document.body||event.target?.closest?.('#commentsList,.posts-list,.profile-posts-list,.post-route-content')))dismissReactionPickers();},{capture:true,passive:true});
  $('#commentsModal').addEventListener('click',e=>{if(e.target===$('#commentsModal')){closeModal($('#commentsModal'));activeCommentsPost=null;}});

  // Authentication + cloud feed lifecycle. Account creation is real Supabase Auth.
  let authMode = 'login';
  function cloudProfilePayload(){
    const safeUsername=(profileData.username||'egybook_user').replace(/[^A-Za-z0-9._]/g,'_').slice(0,30);
    return {id:currentUser.id,username:safeUsername,full_name:profileData.name||'عضو EgyBook',avatar_url:profileData.avatar||null,cover_url:profileData.cover||null,bio:profileData.bio||'',mood:profileData.mood||'',location:profileData.location||'',birthdate:profileData.birthdate||null,birthdate_display:profileData.birthdate_display||'full',location_privacy:profileData.locationPrivacy||'public',birthdate_privacy:profileData.birthdatePrivacy||'public',relationship:profileData.relationship||'',relationship_privacy:profileData.relationshipPrivacy||'public',work:profileData.work||'',work_privacy:profileData.workPrivacy||'public',education:profileData.education||'',education_privacy:profileData.educationPrivacy||'public',activity_privacy:profileData.activity_privacy||'friends',updated_at:new Date().toISOString()};
  }
  async function restoreCloudProfile(){
    if(!supabase||!currentUser)return;
    const authUser=currentUser;
    const {data,error}=await supabase.from('profiles')
      .select('*')
      .eq('id',authUser.id).maybeSingle();
    if(error){console.warn('Cloud profile load:',error.message);showToast('تعذر تحميل بيانات الحساب من السحابة.');return;}
    let cloud=data;
    if(!cloud){
      const meta=authUser.user_metadata||{};
      const emailName=(authUser.email||'').split('@')[0].replace(/[^A-Za-z0-9._]/g,'_').slice(0,20);
      const username=cleanUsername(meta.username||`${emailName||'egybook_user'}_${authUser.id.slice(0,5)}`);
      const initial={id:authUser.id,username,full_name:meta.full_name||meta.name||'عضو EgyBook',avatar_url:null,cover_url:null,bio:'',location:'',updated_at:new Date().toISOString()};
      const {data:created,error:createError}=await supabase.from('profiles').upsert(initial,{onConflict:'id'}).select('*').single();
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
      avatar:cloud.avatar_url||'',cover:cloud.cover_url||'',bio:cloud.bio||'',mood:cloud.mood||'',location:cloud.location||'',
      locationPrivacy:cloud.location_privacy||'public',birthdate:cloud.birthdate||'',birthdate_display:cloud.birthdate_display||'full',
      birthdatePrivacy:cloud.birthdate_privacy||'public',relationship:cloud.relationship||'',relationshipPrivacy:cloud.relationship_privacy||'public',
      work:cloud.work||'',workPrivacy:cloud.work_privacy||'public',education:cloud.education||'',educationPrivacy:cloud.education_privacy||'public',activity_privacy:cloud.activity_privacy||'friends'};
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

  // Coalesce overlapping cloud refreshes. Realtime can emit bursts (e.g. several
  // comments/reactions); only one request per data family runs at a time, with at
  // most one follow-up pass if new events arrive while it is running.
  const __egybookOriginalRestorePosts = restorePosts;
  let __egybookRestorePostsPromise = null;
  let __egybookRestorePostsQueued = false;
  restorePosts = function(...args) {
    if (__egybookRestorePostsPromise) {
      __egybookRestorePostsQueued = true;
      return __egybookRestorePostsPromise;
    }
    __egybookRestorePostsPromise = (async () => {
      try { return await __egybookOriginalRestorePosts.apply(this, args); }
      finally {
        __egybookRestorePostsPromise = null;
        if (__egybookRestorePostsQueued) {
          __egybookRestorePostsQueued = false;
          setTimeout(() => { if (currentUser && supabase) restorePosts(); }, 180);
        }
      }
    })();
    return __egybookRestorePostsPromise;
  };

  const __egybookOriginalLoadNotifications = loadNotifications;
  let __egybookNotificationsPromise = null;
  let __egybookNotificationsQueued = false;
  loadNotifications = function(...args) {
    if (__egybookNotificationsPromise) {
      __egybookNotificationsQueued = true;
      return __egybookNotificationsPromise;
    }
    __egybookNotificationsPromise = (async () => {
      try { return await __egybookOriginalLoadNotifications.apply(this, args); }
      finally {
        __egybookNotificationsPromise = null;
        if (__egybookNotificationsQueued) {
          __egybookNotificationsQueued = false;
          setTimeout(() => { if (currentUser && supabase) loadNotifications(); }, 220);
        }
      }
    })();
    return __egybookNotificationsPromise;
  };

  const __egybookRealtimeTimers = Object.create(null);
  function scheduleEgyBookRealtimeRefresh(key, callback, delay = 240) {
    clearTimeout(__egybookRealtimeTimers[key]);
    const scheduledUserId = currentUser?.id || null;
    __egybookRealtimeTimers[key] = setTimeout(() => {
      delete __egybookRealtimeTimers[key];
      // Drop queued work if the account changed while the timer was waiting.
      if (scheduledUserId !== (currentUser?.id || null)) return;
      try {
        const result = callback();
        if (result && typeof result.catch === 'function') {
          result.catch(error => console.warn('EgyBook realtime refresh failed:', error));
        }
      } catch (error) {
        console.warn('EgyBook realtime refresh failed:', error);
      }
    }, delay);
  }

  let socialRealtimeChannel=null;
  function startSocialRealtime(){
    if(!supabase)return;
    if(socialRealtimeChannel){supabase.removeChannel(socialRealtimeChannel);socialRealtimeChannel=null;}
    socialRealtimeChannel=supabase.channel('egybook-social-live')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:currentUser?`recipient_id=eq.${currentUser.id}`:undefined},payload=>{
        if(!currentUser)return;
        // Refresh durable rows; the diff triggers an in-app popup and device notification when permitted.
        scheduleEgyBookRealtimeRefresh('notifications', () => loadNotifications(), 180);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'posts'},payload=>{
        const row=payload.new||payload.old||{};
        if(payload.eventType==='DELETE'){
          const id=String(row.id||'');
          $$('.post').filter(p=>String(p.dataset.postId||'')===id).forEach(p=>p.remove());
          if(currentPage==='profile')renderProfilePosts();
          updateEmptyState();return;
        }
        scheduleEgyBookRealtimeRefresh('posts', () => restorePosts(), 260);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'friend_requests'},payload=>{
        if(currentUser)scheduleEgyBookRealtimeRefresh('notifications', () => loadNotifications(), 180);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'post_reactions'},payload=>{
        if(currentUser)scheduleEgyBookRealtimeRefresh('notifications', () => loadNotifications(), 180);
        const row=payload.new||payload.old||{},id=String(row.post_id||'');
        const post=$$('.post').find(p=>String(p.dataset.postId||'')===id);
        if(post)scheduleEgyBookRealtimeRefresh('stats:'+id, () => { const latest=$$('.post').find(p=>String(p.dataset.postId||'')===id); if(latest)loadCloudPostStats(latest); }, 220);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'post_comments'},payload=>{
        if(currentUser)scheduleEgyBookRealtimeRefresh('notifications', () => loadNotifications(), 180);
        const row=payload.new||payload.old||{},id=String(row.post_id||'');
        const post=$$('.post').find(p=>String(p.dataset.postId||'')===id);
        if(post)scheduleEgyBookRealtimeRefresh('comment-stats:'+id, () => { const latest=$$('.post').find(p=>String(p.dataset.postId||'')===id); if(latest)loadCloudPostStats(latest); if(activeCommentsPost&&String(activeCommentsPost.dataset.postId||'')===id)loadCloudComments(activeCommentsPost); }, 220);
      })
      .subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('EgyBook realtime subscription status:',status);});
  }
  // Real-time presence is rendered only beside accepted friends. Offline timestamps require the SQL migration.
  let presenceChannel=null;
  const onlineUserIds=new Set();
  let presenceHeartbeat=null;
  function renderPresenceLabel(node,userId,lastSeenAt){
    if(!node)return;
    const id=String(userId||'');
    if(id&&onlineUserIds.has(id)){node.textContent='متصل الآن';node.classList.add('is-online');return;}
    node.classList.remove('is-online');
    const time=lastSeenAt?new Date(lastSeenAt):null;
    if(!time||Number.isNaN(time.getTime())){node.textContent='حالة الاتصال غير متاحة';return;}
    const minutes=Math.max(0,Math.floor((Date.now()-time.getTime())/60000));
    if(minutes<1)node.textContent='آخر ظهور منذ لحظات';
    else if(minutes<60)node.textContent=`آخر ظهور منذ ${minutes} دقيقة`;
    else if(minutes<1440){const hours=Math.floor(minutes/60);node.textContent=`آخر ظهور منذ ${hours} ${hours===1?'ساعة':'ساعات'}`;}
    else node.textContent=`آخر ظهور ${time.toLocaleDateString('ar-EG',{day:'numeric',month:'short'})}`;
  }
  async function updateViewedProfilePresence(){
    const wrap=$('.profile-avatar-wrap'), userId=publicProfileId;
    const statusNode=$('#profilePresenceStatus');if(statusNode){statusNode.classList.remove('presence-visible');statusNode.hidden=true;statusNode.textContent='';delete statusNode.dataset.presenceUserId;delete statusNode.dataset.lastSeenAt;}
    if(!wrap)return;
    let dot=$('#viewedProfileOnlineDot');
    if(!dot){dot=document.createElement('span');dot.id='viewedProfileOnlineDot';dot.className='profile-online-dot';dot.setAttribute('aria-label','متصل الآن');dot.hidden=true;wrap.append(dot);}
    dot.hidden=true;
    if(!currentUser||!userId||String(userId)===String(currentUser.id)||!supabase)return;
    const viewedId=String(userId), viewerId=String(currentUser.id);
    try{
      const [sent,received,profileResult]=await Promise.all([
        supabase.from('friend_requests').select('id').eq('sender_id',viewerId).eq('receiver_id',viewedId).eq('status','accepted').limit(1),
        supabase.from('friend_requests').select('id').eq('sender_id',viewedId).eq('receiver_id',viewerId).eq('status','accepted').limit(1),
        supabase.from('profiles').select('id,last_seen_at,activity_privacy').eq('id',viewedId).maybeSingle()
      ]);
      if(String(publicProfileId||'')!==viewedId)return;
      if(sent.error||received.error||profileResult.error)return;
      const isFriend=Boolean(sent.data?.length||received.data?.length), person=profileResult.data;
      if(!isFriend||!person||['private','hidden'].includes(person.activity_privacy))return;
      const online=onlineUserIds.has(viewedId);
      dot.hidden=!online;
      const status=$('#profilePresenceStatus');
      if(status){
        status.hidden=false;status.dataset.presenceUserId=viewedId;status.dataset.lastSeenAt=person.last_seen_at||'';
        renderPresenceLabel(status,viewedId,person.last_seen_at||null);
        requestAnimationFrame(()=>status.classList.add('presence-visible'));
      }
    }catch(error){console.warn('Viewed profile presence unavailable:',error);}
  }
  function refreshPresenceLabels(){ $$('[data-presence-user-id]').forEach(node=>renderPresenceLabel(node,node.dataset.presenceUserId,node.dataset.lastSeenAt||null)); updateViewedProfilePresence(); }
  async function writeOwnLastSeen(){
    if(!supabase||!currentUser||document.visibilityState==='hidden')return;
    try{const {error}=await supabase.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',currentUser.id);if(error)console.warn('Presence timestamp update failed; apply EGYBOOK_FRIEND_PRESENCE_MIGRATION.sql:',error.message);}catch(error){console.warn('Presence timestamp update failed:',error);}
  }
  async function startFriendPresence(){
    if(!supabase||!currentUser)return;
    if(presenceChannel){try{await supabase.removeChannel(presenceChannel);}catch(_){}presenceChannel=null;}
    if(presenceHeartbeat)clearInterval(presenceHeartbeat);
    onlineUserIds.clear();
    const userId=String(currentUser.id);
    const channel=supabase.channel('egybook-friend-presence',{config:{presence:{key:userId}}});
    presenceChannel=channel;
    channel.on('presence',{event:'sync'},()=>{
      if(presenceChannel!==channel)return;
      onlineUserIds.clear();const state=channel.presenceState()||{};
      Object.keys(state).forEach(id=>{if((state[id]||[]).length)onlineUserIds.add(String(id));});
      refreshPresenceLabels();
    }).subscribe(async status=>{
      if(status==='SUBSCRIBED'&&presenceChannel===channel){
        try{await channel.track({user_id:userId,online:true,at:new Date().toISOString()});}catch(error){console.warn('Presence tracking failed:',error);}
        writeOwnLastSeen();
      }
    });
    presenceHeartbeat=setInterval(()=>{writeOwnLastSeen();refreshPresenceLabels();},60000);
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')writeOwnLastSeen();});
  window.addEventListener('pagehide',()=>{if(presenceChannel){try{presenceChannel.untrack();}catch(_){} }});

  async function initializeCloud(){
    if(!supabase){activateAccountStorage(null);refreshAuthUI();document.documentElement.classList.remove('egybook-profile-bootstrap');routeFromLocation();showToast('تعذر الاتصال بالخدمة. حاول مرة أخرى.');return;}
    try{
      const {data,error}=await supabase.auth.getSession();if(error)throw error;
      currentUser=data.session?.user||null;
      activateAccountStorage(currentUser?.id||null);
      refreshAuthUI();await refreshVerificationBadge();
      startSocialRealtime();
      if(currentUser)startFriendPresence();
      if(currentUser){await restoreCloudProfile();await restorePosts();await loadNotifications();} else {applyProfile();notificationItems=[];updateNotificationBadge();}
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
          if(nextUser)startFriendPresence();else{if(presenceHeartbeat)clearInterval(presenceHeartbeat);presenceHeartbeat=null;if(presenceChannel){supabase.removeChannel(presenceChannel);presenceChannel=null;}onlineUserIds.clear();refreshPresenceLabels();}
          if(!nextUser){notificationItems=[];notificationRealtimePrimed=false;updateNotificationBadge();dismissLiveNotification();}
        }
        if(currentUser)setTimeout(async()=>{try{await restoreCloudProfile();await restorePosts();await loadNotifications();}finally{document.documentElement.classList.remove('egybook-profile-bootstrap');}},0);
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
    const comments=$('#commentsModal.open, #photoViewerCommentsModal.open');
    if(comments && !comments.hidden){closeModal(comments);return;}
    if(!$('#imageViewer').hidden){closeImageViewer();return;}
    const reactions=$('#postReactionsModal');
    if(reactions && !reactions.hidden && reactions.classList.contains('open')){closeModal(reactions);return;}
    const openModalEl=$('.modal.open');
    if(openModalEl && openModalEl.id!=='supabaseAuthModal'){closeModal(openModalEl);}
  });
  window.addEventListener('popstate',event=>{
    // A post opened from a notification must return to that notification list in one Back action.
    let notificationReturn=null;
    try{notificationReturn=JSON.parse(sessionStorage.getItem('egybook-notifications-return')||'null');}catch(_){}
    if(notificationReturn && document.body.classList.contains('post-route-open')){
      try{sessionStorage.removeItem('egybook-notifications-return');}catch(_){}
      restoreCommentsSheetToModal();
      document.body.classList.remove('post-route-open');
      const viewer=$('#postViewer');if(viewer)viewer.hidden=true;
      openNotifications({push:false});
      requestAnimationFrame(()=>{const page=$('#notificationsPage');if(page){page.scrollTop=Number(notificationReturn.scrollY)||0;}});
      event.stopImmediatePropagation();
      return;
    }
    if(window.__egybookIgnoreSidebarPop){window.__egybookIgnoreSidebarPop=false;return;}
    // Handle editor history before routeFromLocation; otherwise browser Back can reveal Home/Profile beneath the editor.
    const discardSheet=$('#composerDiscardModal');
    const imageEditor=$('#imageEditorModal');
    if(discardSheet?.classList.contains('open')){try{history.pushState({...history.state,egybookImageEditor:true},'',location.href);}catch(_){}return;}
    if(imageEditor?.classList.contains('open')){
      if(imageEditorDirty){openEditorDiscardSheet();try{history.pushState({...history.state,egybookImageEditor:true},'',location.href);}catch(_){}}
      else {discardImageEditorChanges();}
      return;
    }
    if($('#egySidebar')?.classList.contains('is-open')){window.__egybookHandlingSidebarPop=true;closeSidebar();window.__egybookHandlingSidebarPop=false;return;}
    // Dismiss the topmost overlay before touching the image viewer underneath it.
    // This preserves the viewer when Back is used from the comments/reactions page.
    const comments=$('#commentsModal.open, #photoViewerCommentsModal.open');
    if(comments && !comments.hidden) { closeModal(comments); return; }
    const reactions=$('#postReactionsModal');
    if(reactions && !reactions.hidden && reactions.classList.contains('open')) { closeModal(reactions); return; }
    if(!$('#imageViewer').hidden){$('#imageViewer').hidden=true;$('#imageViewer').setAttribute('aria-hidden','true');const menu=$('#imageViewerMoreMenu');if(menu)menu.hidden=true;document.body.classList.remove('image-viewer-open');imageViewerHistoryPushed=false;document.body.style.overflow='';requestAnimationFrame(()=>window.scrollTo({top:imageViewerReturnY,behavior:'auto'}));return;}
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

  // v61: preserve the scroll position of each browser-history entry.
  // Save the current entry before navigation and restore it after route handlers
  // have made the destination visible. Overlay-only popstate handlers that call
  // stopImmediatePropagation keep their existing priority and behavior.
  (function installRouteScrollRestoration(){
    if (window.__egybookRouteScrollRestorationInstalled) return;
    window.__egybookRouteScrollRestorationInstalled = true;
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (_) {}
    const nativePushState = history.pushState.bind(history);
    const nativeReplaceState = history.replaceState.bind(history);
    const currentScroll = () => ({ x: window.scrollX || 0, y: window.scrollY || 0, url: location.pathname + location.search + location.hash });
    const saveCurrentEntry = () => {
      try {
        const state = history.state && typeof history.state === 'object' ? history.state : {};
        nativeReplaceState({ ...state, __egybookScroll: currentScroll() }, '', location.href);
      } catch (_) {}
    };
    history.pushState = function(state, title, url){
      saveCurrentEntry();
      return nativePushState(state && typeof state === 'object' ? { ...state } : state, title, url);
    };
    history.replaceState = function(state, title, url){
      const previous = history.state && typeof history.state === 'object' ? history.state : {};
      const next = state && typeof state === 'object' ? { ...state } : {};
      if (!Object.prototype.hasOwnProperty.call(next, '__egybookScroll') && previous.__egybookScroll) {
        next.__egybookScroll = previous.__egybookScroll;
      }
      return nativeReplaceState(next, title, url);
    };
    // Keep the active entry's position reasonably fresh without replacing state
    // on every scroll event (important on lower-end mobile devices).
    let saveTimer = 0;
    window.addEventListener('scroll', () => {
      if (saveTimer) return;
      saveTimer = window.setTimeout(() => { saveTimer = 0; saveCurrentEntry(); }, 140);
    }, { passive: true });
    window.addEventListener('pagehide', saveCurrentEntry);
    window.addEventListener('popstate', event => {
      const saved = event.state && event.state.__egybookScroll;
      if (!saved || !Number.isFinite(saved.y)) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Route rendering can call scrollTo(0); restore only when the browser has
        // actually returned to the saved history entry.
        const active = history.state && history.state.__egybookScroll;
        if (!active || active.url !== saved.url) return;
        window.scrollTo({ left: Number(saved.x) || 0, top: Number(saved.y) || 0, behavior: 'auto' });
      }));
    });
    saveCurrentEntry();
  })();

  $('#messagesSearchInput')?.addEventListener('input',renderDirectMessageList);
  $('#messagesSendForm')?.addEventListener('submit',sendDirectMessage);
  $$('[data-messages-tab]').forEach(tab=>tab.addEventListener('click',()=>{messagesCurrentTab=tab.dataset.messagesTab||'all';$$('[data-messages-tab]').forEach(b=>{const active=b===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});renderDirectMessageList();}));

  applyProfile(); syncAllPostStats(); updateEmptyState(); refreshAuthUI();
  // Resolve the requested URL before awaiting Supabase. This prevents the app's
  // default Home state from being rendered first when a profile URL is refreshed.
  // initializeCloud() will resolve it again after auth/profile data is restored.
  try { routeFromLocation(); } catch (routeError) { console.warn('Early route resolution failed:', routeError); }
  initializeCloud();
})();

document.addEventListener('click',event=>{if(event.target.closest('[data-action=\"enable-device-notifications\"]'))requestBrowserNotificationPermission();});

// Keep the standalone chat fitted to the visible mobile viewport, including when the keyboard opens.
(()=>{
  const syncChatViewport=()=>{
    if(!document.body.classList.contains('messages-thread-open'))return;
    const vv=window.visualViewport;
    const height=vv&&vv.height?vv.height:window.innerHeight;
    document.documentElement.style.setProperty('--egy-chat-viewport-height',`${Math.max(240,Math.round(height))}px`);
  };
  window.addEventListener('resize',syncChatViewport,{passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',syncChatViewport,{passive:true});
    window.visualViewport.addEventListener('scroll',syncChatViewport,{passive:true});
  }
  const observer=new MutationObserver(syncChatViewport);
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  document.addEventListener('focusin',event=>{
    if(event.target&&event.target.id==='messagesComposerInput'){
      syncChatViewport();
      setTimeout(()=>event.target.scrollIntoView({block:'nearest',behavior:'smooth'}),80);
    }
  });
  syncChatViewport();
})();


/* v74 interaction polish: isolate comment gestures and support finger-driven reaction selection. */
(()=>{
  const commentScope = '#commentsList .egy-comment, #commentsList .comment-replies';
  const isCommentArea = node => !!(node && node.closest && node.closest(commentScope));
  // Keep native selection/callout away from comment content; copy remains available in EgyBook's own menu.
  document.addEventListener('contextmenu', event=>{
    if(isCommentArea(event.target)){
      event.preventDefault();
      if(event.target.closest('.comment-vote, .comment-reaction-count, .comment-replies-toggle')) event.stopPropagation();
    }
  }, true);
  document.addEventListener('selectstart', event=>{
    if(isCommentArea(event.target) && !event.target.closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
  }, true);
  document.addEventListener('dragstart', event=>{
    if(isCommentArea(event.target) && !event.target.closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
  }, true);

  // A long press on a comment reaction control must never be interpreted as a comment long-press.
  document.addEventListener('pointerdown', event=>{
    const control=event.target.closest('.comment-vote, .comment-reaction-count');
    if(control){
      control._egyPressStart={x:event.clientX,y:event.clientY};
      control._egyLongPressBlocked=true;
    }
  }, true);
  document.addEventListener('pointerup', event=>{
    const control=event.target.closest('.comment-vote, .comment-reaction-count');
    if(control){control._egyLongPressBlocked=false;control._egyPressStart=null;}
  }, true);
  document.addEventListener('pointercancel', event=>{
    const control=event.target.closest('.comment-vote, .comment-reaction-count');
    if(control){control._egyLongPressBlocked=false;control._egyPressStart=null;}
  }, true);

  const picker=document.getElementById('commentReactionPicker');
  if(!picker) return;
  let active=false, startX=0, startY=0, moved=false, current=null, suppressClick=false, syntheticSwipeClick=false;
  const buttons=()=>Array.from(picker.querySelectorAll('[data-reaction]'));
  const pickAt=(x,y)=>{
    const el=document.elementFromPoint(x,y);
    const b=el?.closest?.('#commentReactionPicker [data-reaction]');
    if(b){buttons().forEach(item=>item.classList.toggle('swipe-highlight',item===b));current=b;}
  };
  picker.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    active=true;moved=false;startX=event.clientX;startY=event.clientY;current=event.target.closest('[data-reaction]');
    picker.classList.add('is-swiping');
    if(current)current.classList.add('swipe-highlight');
    try{picker.setPointerCapture(event.pointerId);}catch(_){}
  });
  picker.addEventListener('pointermove',event=>{
    if(!active)return;
    if(Math.abs(event.clientX-startX)>7||Math.abs(event.clientY-startY)>12)moved=true;
    if(moved)pickAt(event.clientX,event.clientY);
  });
  const finish=event=>{
    if(!active)return;
    active=false;picker.classList.remove('is-swiping');
    buttons().forEach(item=>item.classList.remove('swipe-highlight'));
    if(moved && current){
      event.preventDefault();event.stopPropagation();
      suppressClick=true;
      const chosen=current;
      syntheticSwipeClick=true;chosen.click();syntheticSwipeClick=false;
      setTimeout(()=>{suppressClick=false;},350);
    }
    current=null;
  };
  picker.addEventListener('click',event=>{
    if(suppressClick&&!syntheticSwipeClick){event.preventDefault();event.stopPropagation();suppressClick=false;}
  }, true);
  picker.addEventListener('pointerup',finish);
  picker.addEventListener('pointercancel',()=>{active=false;current=null;picker.classList.remove('is-swiping');buttons().forEach(item=>item.classList.remove('swipe-highlight'));});

  // The comment/reply action sheet has its own reaction row; support the same finger-following gesture there.
  const sheetRow=document.querySelector('.comment-actions-reactions');
  if(sheetRow){
    let sheetActive=false,sheetMoved=false,sx=0,sy=0,selected=null,suppressSheetClick=false,syntheticSheetClick=false;
    const sheetButtons=()=>Array.from(sheetRow.querySelectorAll('[data-comment-sheet-action="react"]'));
    const sheetPick=(x,y)=>{
      const el=document.elementFromPoint(x,y);
      const b=el?.closest?.('.comment-actions-reactions [data-comment-sheet-action="react"]');
      if(b){sheetButtons().forEach(item=>item.classList.toggle('swipe-highlight',item===b));selected=b;}
    };
    sheetRow.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      sheetActive=true;sheetMoved=false;sx=event.clientX;sy=event.clientY;
      selected=event.target.closest('[data-comment-sheet-action="react"]');
      sheetRow.classList.add('is-swiping');
      if(selected)selected.classList.add('swipe-highlight');
      try{sheetRow.setPointerCapture(event.pointerId);}catch(_){}
    });
    sheetRow.addEventListener('pointermove',event=>{
      if(!sheetActive)return;
      if(Math.abs(event.clientX-sx)>7||Math.abs(event.clientY-sy)>12)sheetMoved=true;
      if(sheetMoved)sheetPick(event.clientX,event.clientY);
    });
    const finishSheet=event=>{
      if(!sheetActive)return;
      sheetActive=false;sheetRow.classList.remove('is-swiping');
      sheetButtons().forEach(item=>item.classList.remove('swipe-highlight'));
      if(sheetMoved&&selected){
        event.preventDefault();event.stopPropagation();suppressSheetClick=true;
        syntheticSheetClick=true;selected.click();syntheticSheetClick=false;
        setTimeout(()=>{suppressSheetClick=false;},350);
      }
      selected=null;
    };
    sheetRow.addEventListener('pointerup',finishSheet);
    sheetRow.addEventListener('pointercancel',()=>{sheetActive=false;selected=null;sheetRow.classList.remove('is-swiping');sheetButtons().forEach(item=>item.classList.remove('swipe-highlight'));});
    sheetRow.addEventListener('click',event=>{if(suppressSheetClick&&!syntheticSheetClick){event.preventDefault();event.stopPropagation();suppressSheetClick=false;}},true);
  }

  // Facebook-like bottom navigation: hide on downward scroll, reveal on upward scroll.
  (function installBottomNavScrollBehavior(){
    if(window.__egybookBottomNavScrollInstalled)return;
    window.__egybookBottomNavScrollInstalled=true;
    const nav=document.querySelector('.bottom-navigation');
    if(!nav)return;
    // Keep the fixed navigation within the viewport even when global styles add padding/borders.
    nav.style.boxSizing='border-box';
    nav.style.left='0';
    nav.style.right='0';
    nav.style.width='auto';
    nav.style.maxWidth='100vw';
    let lastY=window.scrollY||0, raf=0, direction='up';
    nav.style.willChange='transform';
    nav.style.transition='transform 220ms cubic-bezier(.2,.75,.25,1), opacity 180ms ease';
    nav.style.transform='translate3d(0,0,0)';
    nav.style.opacity='1';
    const show=()=>{nav.classList.remove('nav-scroll-hidden');nav.style.transform='translate3d(0,0,0)';nav.style.opacity='1';nav.style.pointerEvents='';};
    const hide=()=>{nav.classList.add('nav-scroll-hidden');nav.style.transform='translate3d(0,calc(100% + 12px),0)';nav.style.opacity='0';nav.style.pointerEvents='none';};
    window.addEventListener('scroll',()=>{
      if(raf)return;
      raf=requestAnimationFrame(()=>{raf=0;const y=Math.max(0,window.scrollY||0),delta=y-lastY;
        if(Math.abs(delta)<5)return;
        const typing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable;
        const overlayOpen=!!document.querySelector('.modal.open, .modal.visible, #postViewer:not([hidden]), #imageViewer:not([hidden])');
        if(typing||overlayOpen||y<80)show();
        else if(delta>0)hide();else show();
        lastY=y;
      });
    },{passive:true});
    window.addEventListener('focusin',e=>{if(e.target.matches('input,textarea,[contenteditable="true"]'))show();});
    window.addEventListener('pageshow',()=>{lastY=window.scrollY||0;show();});
  })();
})();


/* EgyBook stability: prevent accidental native text selection/copy on long press.
   Editable controls remain selectable so typing, cursor placement and editing work normally. */
(()=>{
  const editableSelector='input, textarea, select, [contenteditable="true"], [contenteditable=""], .allow-native-selection';
  document.addEventListener('contextmenu',event=>{
    if(event.target && event.target.closest && event.target.closest(editableSelector)) return;
    event.preventDefault();
  },true);
  document.addEventListener('selectstart',event=>{
    if(event.target && event.target.closest && event.target.closest(editableSelector)) return;
    event.preventDefault();
  },true);
  document.addEventListener('dragstart',event=>{
    if(event.target && event.target.closest && event.target.closest(editableSelector)) return;
    if(event.target && event.target.closest && event.target.closest('img, a, .post, .profile-page, .notification-card, button')) event.preventDefault();
  },true);
})();


/* EgyBook v77: long-press/context-menu opens the branded photo options. */
(()=>{
 const viewer=document.getElementById('imageViewer');const img=document.getElementById('imageViewerImage');const menu=document.getElementById('imageViewerMoreMenu');if(!viewer||!img||!menu)return;
 let pressTimer=0,startX=0,startY=0,lastX=0,lastY=0;
 const openMenu=()=>{menu.hidden=false;};const clear=()=>{if(pressTimer)clearTimeout(pressTimer);pressTimer=0;};
 img.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;clear();startX=lastX=event.clientX;startY=lastY=event.clientY;pressTimer=setTimeout(()=>{if(Math.hypot(lastX-startX,lastY-startY)<12)openMenu();},560);},{passive:true});
 img.addEventListener('pointermove',event=>{lastX=event.clientX;lastY=event.clientY;if(Math.hypot(lastX-startX,lastY-startY)>12)clear();},{passive:true});
 ['pointerup','pointercancel','pointerleave'].forEach(type=>img.addEventListener(type,clear,{passive:true}));
 img.addEventListener('contextmenu',event=>{event.preventDefault();openMenu();},{capture:true});
 document.addEventListener('click',event=>{if(!event.target.closest('#imageViewerMoreMenu')&&!event.target.closest('#imageViewer [data-action="image-more"]'))menu.hidden=true;});
})();
