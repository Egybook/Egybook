'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
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

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const focusable = $('textarea, input, select, button', modal);
    if (focusable) setTimeout(() => focusable.focus(), 80);
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    if (!$('.modal.open')) document.body.style.overflow = '';
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function updateEmptyState() {
    const visiblePosts = $$('.post', postsList).some(post => !post.hidden);
    $('#emptyMessage').hidden = visiblePosts;
  }
  function createPostElement({id, text, media, mediaType, visibility, createdAt}) {
    const article = document.createElement('article');
    article.className = 'post';
    article.dataset.postId = id;
    const dateText = new Date(createdAt || Date.now()).toLocaleString('ar-EG', {dateStyle:'short', timeStyle:'short'});
    let mediaHTML = '';
    if (media && mediaType === 'image') mediaHTML = `<img class="post-image" src="${media}" alt="صورة مرفقة بالمنشور">`;
    else if (media && mediaType === 'video') mediaHTML = `<video class="post-image" src="${media}" controls playsinline></video>`;
    article.innerHTML = `
      <header class="post-header"><div class="avatar">ح</div><div class="post-author"><div class="author-name">حسابي</div><div class="post-meta">${escapeHTML(dateText)} · ${escapeHTML(visibility || 'الجميع')}</div></div><button class="more-button" data-action="post-menu" aria-label="خيارات المنشور">⋯</button></header>
      <p class="post-text"></p>${mediaHTML}
      <div class="post-stats"><div class="reaction-summary"><div class="reaction-icons"><span>👍</span></div><span class="like-count">0 تفاعل</span></div><span><span class="comment-count">0</span> تعليق · <span class="share-count">0</span> مشاركة</span></div>
      <div class="post-actions"><button class="post-action" data-action="like"><span class="action-icon">👍</span><span>إعجاب</span></button><button class="post-action" data-action="comment"><span class="action-icon">▱</span><span>تعليق</span></button><button class="post-action" data-action="share"><span class="action-icon">➦</span><span>مشاركة</span></button><button class="post-action" data-action="save"><span class="action-icon">♧</span><span>حفظ</span></button></div><div class="comments-area" hidden></div>`;
    $('.post-text', article).textContent = text;
    return article;
  }
  function persistPosts() {
    const posts = $$('.post[data-user-post="true"]', postsList).map(post => ({
      id: post.dataset.postId,
      text: $('.post-text', post)?.textContent || '',
      media: post.dataset.media || null,
      mediaType: post.dataset.mediaType || null,
      visibility: post.dataset.visibility || 'الجميع',
      createdAt: Number(post.dataset.createdAt) || Date.now()
    }));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(posts)); } catch (_) { showToast('تعذر حفظ المنشور محليًا؛ قد تكون مساحة التخزين ممتلئة.'); }
  }
  function restorePosts() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      saved.forEach(data => {
        const article = createPostElement(data);
        article.dataset.userPost = 'true';
        article.dataset.createdAt = String(data.createdAt || Date.now());
        article.dataset.visibility = data.visibility || 'الجميع';
        if (data.media) { article.dataset.media = data.media; article.dataset.mediaType = data.mediaType || ''; }
        postsList.prepend(article);
      });
    } catch (error) { console.warn('EgyBook local posts could not be restored.', error); }
  }
  function publishPost(event) {
    event.preventDefault();
    const text = postContent.value.trim();
    if (!text && !selectedMedia) return showToast('اكتب شيئًا أو أرفق صورة/فيديو أولًا.');
    const data = {id: `post-${Date.now()}`, text, media: selectedMedia?.dataUrl || null, mediaType: selectedMedia?.type || null, visibility: $('#postVisibility').value, createdAt: Date.now()};
    const article = createPostElement(data);
    article.dataset.userPost = 'true'; article.dataset.createdAt = String(data.createdAt); article.dataset.visibility = data.visibility;
    if (data.media) { article.dataset.media = data.media; article.dataset.mediaType = data.mediaType; }
    postsList.prepend(article);
    postContent.value = ''; selectedMedia = null; $('#mediaPreview').hidden = true; $('#mediaPreview').replaceChildren();
    closeModal(createPostModal); persistPosts(); updateEmptyState(); showToast('تم نشر المنشور على هذه النسخة من الموقع.');
  }
  function readMedia(file, type) {
    if (!file) return;
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) { showToast('حجم الملف أكبر من 5 ميجابايت. اختر ملفًا أصغر.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      selectedMedia = {dataUrl: reader.result, type};
      const preview = $('#mediaPreview'); preview.replaceChildren(); preview.hidden = false;
      const label = document.createElement('div'); label.textContent = `المرفق: ${file.name}`; preview.append(label);
      const media = document.createElement(type === 'image' ? 'img' : 'video'); media.src = reader.result;
      if (type === 'video') { media.controls = true; media.playsInline = true; }
      preview.append(media); showToast('تم إرفاق الملف. اضغط نشر لإضافته.');
    };
    reader.onerror = () => showToast('تعذر قراءة الملف. حاول مرة أخرى.');
    reader.readAsDataURL(file);
  }
  function setPage(page) {
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
  function openComments(post) {
    const area = $('.comments-area', post); area.hidden = false;
    if (!$('.comment-form-inline', area)) {
      const form = document.createElement('form'); form.className = 'comment-form-inline';
      form.innerHTML = '<input aria-label="اكتب تعليقك" placeholder="اكتب تعليقك..." maxlength="1000" required><button type="submit">إرسال</button>';
      form.addEventListener('submit', event => {
        event.preventDefault(); const input = $('input', form); const value = input.value.trim(); if (!value) return;
        const comment = document.createElement('div'); comment.className = 'comment-item'; comment.textContent = `أنت: ${value}`; area.insertBefore(comment, form); input.value = '';
        const count = $('.comment-count', post); count.textContent = String((Number(count.textContent) || 0) + 1); showToast('أُضيف التعليق محليًا.');
      });
      area.append(form);
    }
    $('input', $('.comment-form-inline', area)).focus();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const action = button.dataset.action;
    if (button.dataset.page) { setPage(button.dataset.page); return; }
    if (action === 'open-composer') openModal(createPostModal);
    else if (action === 'close-modal') closeModal(button.closest('.modal'));
    else if (action === 'search') openModal($('#searchModal'));
    else if (action === 'run-search') runSearch();
    else if (action === 'messages') showToast('الرسائل غير متصلة بخادم في النسخة التجريبية.');
    else if (action === 'notifications') showToast('لا توجد إشعارات حقيقية متصلة حاليًا.');
    else if (action === 'profile') showToast('صفحة الحساب ستحتاج إلى تسجيل دخول وقاعدة بيانات.');
    else if (action === 'photo') photoInput.click();
    else if (action === 'video') videoInput.click();
    else if (action === 'location') showToast('مشاركة الموقع غير مفعلة في هذه النسخة.');
    else if (action === 'music') showToast('إضافة الموسيقى غير مفعلة في هذه النسخة.');
    else if (action === 'add-story') showToast('ميزة القصص تحتاج إلى تخزين ومشاركة عبر الخادم.');
    else if (action === 'all-stories') showToast('أنت تشاهد القصص المتاحة في العرض التجريبي.');
    else if (action === 'story') showToast(`قصة ${button.dataset.name || ''} — عرض تجريبي.`);
    else if (action === 'sort') { sortNewestFirst = !sortNewestFirst; const items = $$('.post', postsList); items.sort((a,b) => (Number(a.dataset.createdAt)||0 - Number(b.dataset.createdAt)||0) * (sortNewestFirst ? -1 : 1)); items.forEach(item => postsList.append(item)); button.textContent = sortNewestFirst ? 'الأحدث ▾' : 'الأقدم ▾'; }
    else if (action === 'like') { const post = button.closest('.post'); button.classList.toggle('liked'); const liked = button.classList.contains('liked'); $('span:last-child', button).textContent = liked ? 'أعجبني' : 'إعجاب'; const count = $('.like-count', post); const number = Number((count.textContent.match(/[\d.]+/) || ['0'])[0].replace('.','')) || 0; count.textContent = `${Math.max(0, number + (liked ? 1 : -1))} تفاعل`; }
    else if (action === 'save') { button.classList.toggle('saved'); $('span:last-child', button).textContent = button.classList.contains('saved') ? 'تم الحفظ' : 'حفظ'; showToast(button.classList.contains('saved') ? 'تم حفظ المنشور على هذا الجهاز.' : 'تم إلغاء حفظ المنشور.'); }
    else if (action === 'comment') openComments(button.closest('.post'));
    else if (action === 'share') { const post = button.closest('.post'); const text = $('.post-text', post)?.textContent || 'منشور على EgyBook'; if (navigator.share) navigator.share({title:'EgyBook', text}).catch(()=>{}); else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(()=>showToast('تم نسخ نص المنشور للمشاركة.')).catch(()=>showToast('المشاركة غير متاحة في هذا المتصفح.')); else showToast('المشاركة غير متاحة في هذا المتصفح.'); }
    else if (action === 'post-menu') { const post = button.closest('.post'); if (post.dataset.userPost === 'true') { if (confirm('هل تريد حذف هذا المنشور من هذا الجهاز؟')) { post.remove(); persistPosts(); updateEmptyState(); showToast('تم حذف المنشور المحلي.'); } } else showToast('هذا منشور تجريبي للعرض فقط.'); }
  });
  $$('.modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal.open').forEach(closeModal); });
  $('#postForm').addEventListener('submit', publishPost);
  $('#commentForm').addEventListener('submit', event => { event.preventDefault(); const text = $('#commentContent').value.trim(); if (!text) return; if (activeCommentPost) { const area = $('.comments-area', activeCommentPost); area.hidden = false; const item = document.createElement('div'); item.className = 'comment-item'; item.textContent = `أنت: ${text}`; area.prepend(item); } $('#commentContent').value = ''; closeModal($('#commentModal')); showToast('تم إضافة التعليق محليًا.'); });
  photoInput.addEventListener('change', () => { readMedia(photoInput.files[0], 'image'); photoInput.value = ''; openModal(createPostModal); });
  videoInput.addEventListener('change', () => { readMedia(videoInput.files[0], 'video'); videoInput.value = ''; openModal(createPostModal); });
  $('#searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });
  restorePosts(); updateEmptyState();
})();
