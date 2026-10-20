// The publishable key is intended for browser use. Access is enforced by Supabase RLS.
const SUPABASE_URL = 'https://rgkpmsaqbydnpvrqmbzg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_54CEWH3gizvILUgkRMb0UQ_D4P2s6WG';
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const BUCKET = 'photos';
const $ = (selector) => document.querySelector(selector);
let photos = [];
let tags = [];
let activeTag = 'all';
let editingId = null;
let isOwner = false;
let isRecoveringPassword = false;
const assetUrlCache = new Map();
const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

function setSessionStatus(message, type = '') {
  const element = $('#admin-session-status');
  element.textContent = message;
  element.className = `session-status ${type}`.trim();
}

async function checkOwner(session) {
  isOwner = false;
  let permissionError = null;
  if (session?.user) {
    setSessionStatus(`Sesión iniciada como ${session.user.email}. Comprobando permiso de administrador…`);
    const { data, error } = await supabaseClient.rpc('is_site_owner');
    permissionError = error?.message || null;
    isOwner = !permissionError && data === true;
  }
  document.body.classList.toggle('is-owner', isOwner);
  $('#login-form').classList.toggle('hidden', isOwner || isRecoveringPassword);
  $('#recovery-form').classList.toggle('hidden', !isRecoveringPassword);
  $('#owner-tools').classList.toggle('hidden', !isOwner);
  if (!session?.user) {
    setSessionStatus('Sin sesión. Inicia sesión con la cuenta administradora.');
  } else if (permissionError) {
    const message = `Sesión iniciada como ${session.user.email}, pero Supabase no pudo comprobar permisos: ${permissionError}`;
    setSessionStatus(message, 'error');
    $('#login-message').textContent = message;
  } else if (!isOwner) {
    const message = `Sesión iniciada como ${session.user.email}, pero el UUID ${session.user.id} no está autorizado en site_admins.`;
    setSessionStatus(message, 'error');
    $('#login-message').textContent = message;
  } else {
    setSessionStatus(`Administrador autorizado: ${session.user.email}`, 'success');
    $('#login-message').textContent = '';
  }
  await load();
}

async function signedAsset(asset) {
  const cached = assetUrlCache.get(asset.object_path);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...asset, url: cached.url };
  }
  const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrl(asset.object_path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  assetUrlCache.set(asset.object_path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_CACHE_MS
  });
  return { ...asset, url: data.signedUrl };
}

async function signAssetsInBatch(assets) {
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.object_path, asset])).values()];
  const resolved = new Map();
  const missing = [];
  uniqueAssets.forEach((asset) => {
    const cached = assetUrlCache.get(asset.object_path);
    if (cached && cached.expiresAt > Date.now()) resolved.set(asset.object_path, cached.url);
    else missing.push(asset);
  });
  if (missing.length) {
    const paths = missing.map((asset) => asset.object_path);
    const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (!error) {
      (data || []).forEach((item, index) => {
        if (!item.signedUrl) return;
        const path = item.path || paths[index];
        resolved.set(path, item.signedUrl);
        assetUrlCache.set(path, { url: item.signedUrl, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
      });
    }
  }
  return uniqueAssets.map((asset) => ({ ...asset, url: resolved.get(asset.object_path) || null }));
}

async function load() {
  const [photoResult, tagResult] = await Promise.all([
    supabaseClient.from('photos').select('id,title,caption,is_published,created_at,photo_assets(id,kind,object_path,mime_type,width,height),photo_tags(tag:tags(id,name))').order('created_at', { ascending: false }),
    supabaseClient.from('tags').select('id,name').order('name')
  ]);
  if (photoResult.error || tagResult.error) {
    $('#empty-state').hidden = false;
    $('#empty-state h2').textContent = 'No se pudo cargar la galería.';
    $('#empty-state p:not(.kicker)').textContent = photoResult.error?.message || tagResult.error?.message || 'Revisa la configuración de Supabase.';
    return;
  }
  tags = tagResult.data || [];
  const rawPhotos = photoResult.data || [];
  const galleryAssets = rawPhotos.map((photo) => {
    const derivatives = (photo.photo_assets || []).filter((asset) => asset.kind !== 'original');
    return derivatives.find((asset) => asset.kind === 'medium') || derivatives.find((asset) => asset.kind === 'thumbnail') || derivatives.find((asset) => asset.kind === 'large');
  }).filter(Boolean);
  const signedGalleryAssets = await signAssetsInBatch(galleryAssets);
  const galleryUrls = new Map(signedGalleryAssets.map((asset) => [asset.object_path, asset.url]));
  photos = rawPhotos.map((photo) => ({
    ...photo,
    tags: (photo.photo_tags || []).map((entry) => entry.tag).filter(Boolean),
    assets: (photo.photo_assets || []).map((asset) => ({ ...asset, url: galleryUrls.get(asset.object_path) || null }))
  }));
  render();
}

function render() {
  $('#photo-count').textContent = photos.length;
  $('#tag-list').innerHTML = tags.map((tag) => `<button class="category ${activeTag === tag.id ? 'active' : ''}" data-tag="${tag.id}" type="button">${escapeHtml(tag.name)}</button>`).join('');
  const visible = activeTag === 'all' ? photos : photos.filter((photo) => photo.tags.some((tag) => tag.id === activeTag));
  $('#empty-state').hidden = visible.length > 0;
  if (!visible.length) {
    $('#empty-state h2').textContent = 'Aún no hay fotografías.';
    $('#empty-state p:not(.kicker)').textContent = isOwner ? 'Sube fotografías desde Administrar.' : 'Vuelve pronto para descubrir nuevas imágenes.';
    $('#empty-upload').hidden = !isOwner;
  }
  const gallery = $('#gallery');
  gallery.innerHTML = '';
  visible.forEach((photo) => {
    const template = $('#photo-template').content.cloneNode(true);
    const card = template.querySelector('.photo-card');
    const image = template.querySelector('img');
    const displayAsset = photo.assets.find((asset) => asset.kind === 'medium' && asset.url) || photo.assets.find((asset) => asset.url);
    card.classList.add('is-loading');
    if (displayAsset?.width && displayAsset?.height) image.style.aspectRatio = `${displayAsset.width} / ${displayAsset.height}`;
    const finishLoading = () => card.classList.remove('is-loading');
    image.addEventListener('load', finishLoading, { once: true });
    image.addEventListener('error', finishLoading, { once: true });
    image.src = displayAsset?.url || '';
    if (image.complete && image.naturalWidth) requestAnimationFrame(finishLoading);
    image.alt = photo.title;
    template.querySelector('h2').textContent = photo.title;
    template.querySelector('.caption').textContent = photo.caption;
    template.querySelector('.photo-tags').textContent = photo.tags.map((tag) => tag.name).join(' · ');
    template.querySelector('.image-button').onclick = () => openPhoto(photo);
    template.querySelector('.edit-button').onclick = () => edit(photo);
    gallery.append(template);
  });
  renderAdminTags();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function renderAdminTags() {
  $('#admin-tags').innerHTML = tags.map((tag) => `<span class="admin-tag">${escapeHtml(tag.name)} <button data-remove-tag="${tag.id}" aria-label="Eliminar ${escapeHtml(tag.name)}">×</button></span>`).join('');
  document.querySelectorAll('[data-remove-tag]').forEach((button) => {
    button.onclick = async () => {
      const { error } = await supabaseClient.from('tags').delete().eq('id', button.dataset.removeTag);
      if (error) return showMessage(error.message);
      if (activeTag === button.dataset.removeTag) activeTag = 'all';
      await load();
    };
  });
}

function showMessage(message) {
  $('#login-message').textContent = message || '';
}

async function openPhoto(photo) {
  const large = photo.assets.find((asset) => asset.kind === 'large');
  const medium = photo.assets.find((asset) => asset.kind === 'medium' && asset.url) || photo.assets.find((asset) => asset.url);
  const dialog = $('#photo-dialog');
  const dialogImage = $('#dialog-image');
  dialogImage.src = large?.url || medium?.url || '';
  $('#dialog-image').alt = photo.title;
  $('#dialog-title').textContent = photo.title;
  $('#dialog-caption').textContent = photo.caption;
  $('#dialog-tags').textContent = photo.tags.map((tag) => tag.name).join(' · ');
  dialog.showModal();
  dialog.classList.remove('photo-opening');
  void dialog.offsetWidth;
  dialog.classList.add('photo-opening');
  if (large && !large.url) {
    const signed = await signedAsset(large);
    if (signed?.url && dialog.open) {
      const fullImage = new Image();
      fullImage.src = signed.url;
      try { await fullImage.decode(); } catch { return; }
      if (dialog.open) {
        large.url = signed.url;
        dialogImage.src = signed.url;
      }
    }
  }
}

function edit(photo) {
  editingId = photo.id;
  $('#edit-title').value = photo.title;
  $('#edit-caption').value = photo.caption;
  $('#edit-tags').innerHTML = tags.map((tag) => `<label><input type="checkbox" value="${tag.id}" ${photo.tags.some((current) => current.id === tag.id) ? 'checked' : ''}>${escapeHtml(tag.name)}</label>`).join('') || '<p class="note">Crea etiquetas en Organizar.</p>';
  $('#edit-dialog').showModal();
}

function blobFromCanvas(canvas, type = 'image/webp', quality = 0.88) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar la versión optimizada.')), type, quality));
}

async function makeVariants(file) {
  const bitmap = await createImageBitmap(file);
  const variants = [];
  for (const [kind, maxSide] of [['thumbnail', 420], ['medium', 1200], ['large', 2400]]) {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    variants.push({ kind, blob: await blobFromCanvas(canvas), width: canvas.width, height: canvas.height });
  }
  bitmap.close();
  return variants;
}

function extension(file) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' })[file.type] || 'img';
}

async function addFiles(files) {
  if (!isOwner) return;
  for (const file of files) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) continue;
    const status = document.createElement('div');
    status.className = 'queue-item';
    status.textContent = `Procesando ${file.name}…`;
    $('#upload-queue').append(status);
    let photoId;
    const uploadedPaths = [];
    try {
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const { data: photo, error: photoError } = await supabaseClient.from('photos').insert({ title, caption: '', is_published: false }).select('id').single();
      if (photoError) throw photoError;
      photoId = photo.id;
      const variants = await makeVariants(file);
      const filesToUpload = [
        { kind: 'original', blob: file, mime: file.type, width: null, height: null, path: `${photoId}/original.${extension(file)}` },
        ...variants.map((variant) => ({ ...variant, mime: 'image/webp', path: `${photoId}/${variant.kind}.webp` }))
      ];
      const assets = [];
      for (const asset of filesToUpload) {
        const { error } = await supabaseClient.storage.from(BUCKET).upload(asset.path, asset.blob, { contentType: asset.mime, upsert: false });
        if (error) throw error;
        uploadedPaths.push(asset.path);
        assetUrlCache.delete(asset.path);
        assets.push({ photo_id: photoId, kind: asset.kind, object_path: asset.path, mime_type: asset.mime, width: asset.width, height: asset.height });
      }
      const { error: assetError } = await supabaseClient.from('photo_assets').insert(assets);
      if (assetError) throw assetError;
      const { error: publishError } = await supabaseClient.from('photos').update({ is_published: true }).eq('id', photoId);
      if (publishError) throw publishError;
      status.textContent = `Añadida: ${title}`;
    } catch (error) {
      if (uploadedPaths.length) await supabaseClient.storage.from(BUCKET).remove(uploadedPaths);
      if (photoId) await supabaseClient.from('photos').delete().eq('id', photoId);
      status.textContent = `No se pudo subir ${file.name}: ${error.message || 'revisa los permisos y el bucket photos'}`;
    }
  }
  await load();
}

function setAdmin(open) {
  if (typeof toggleAdminPanel === 'function') return toggleAdminPanel(open);
  $('#admin-panel').classList.toggle('open', open);
  $('#scrim').classList.toggle('show', open);
  $('#admin-panel').setAttribute('aria-hidden', String(!open));
}

$('#admin-button').onclick = () => setAdmin(true);
$('#empty-upload').onclick = () => setAdmin(true);
$('#close-admin').onclick = () => setAdmin(false);
$('#scrim').onclick = () => setAdmin(false);
$('#file-input').onchange = (event) => addFiles(event.target.files);
$('#drop-zone').ondragover = (event) => event.preventDefault();
$('#drop-zone').ondrop = (event) => { event.preventDefault(); addFiles(event.dataTransfer.files); };
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (button) { activeTag = button.dataset.tag; render(); }
});

$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  showMessage('Iniciando sesión…');
  setSessionStatus('Verificando correo y contraseña…');
  const { error } = await supabaseClient.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  if (error) {
    const message = `No se pudo iniciar sesión: ${error.message}`;
    showMessage(message);
    setSessionStatus(message, 'error');
  }
  else await checkOwner((await supabaseClient.auth.getSession()).data.session);
};

$('#forgot-password').onclick = async () => {
  const email = $('#login-email').value.trim();
  if (!email) {
    showMessage('Escribe primero el correo de tu cuenta administradora.');
    $('#login-email').focus();
    return;
  }
  showMessage('Enviando correo de recuperación…');
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}`
  });
  showMessage(error ? `No se pudo enviar el correo: ${error.message}` : 'Revisa tu correo. Usa el enlace más reciente para cambiar la contraseña.');
};

$('#recovery-form').onsubmit = async (event) => {
  event.preventDefault();
  const password = $('#recovery-password').value;
  if (password !== $('#recovery-password-confirm').value) {
    $('#recovery-message').textContent = 'Las contraseñas no coinciden.';
    return;
  }
  $('#recovery-message').textContent = 'Guardando contraseña…';
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    $('#recovery-message').textContent = `No se pudo cambiar la contraseña: ${error.message}`;
    return;
  }
  isRecoveringPassword = false;
  $('#recovery-message').textContent = '';
  window.history.replaceState({}, document.title, window.location.pathname);
  await checkOwner((await supabaseClient.auth.getSession()).data.session);
};

$('#sign-out').onclick = async () => { await supabaseClient.auth.signOut(); await checkOwner(null); };

$('#tag-form').onsubmit = async (event) => {
  event.preventDefault();
  const input = $('#new-tag');
  const name = input.value.trim();
  if (!name) return;
  const { error } = await supabaseClient.from('tags').insert({ name });
  if (error) return showMessage(error.message);
  input.value = '';
  await load();
};

document.querySelectorAll('.tab').forEach((button) => button.onclick = () => {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  $('#upload-tab').classList.toggle('hidden', button.dataset.tab !== 'upload');
  $('#organize-tab').classList.toggle('hidden', button.dataset.tab !== 'organize');
});

$('#dialog-close').onclick = () => $('#photo-dialog').close();
$('#edit-close').onclick = () => $('#edit-dialog').close();

$('#edit-form').onsubmit = async (event) => {
  event.preventDefault();
  const { error } = await supabaseClient.from('photos').update({ title: $('#edit-title').value.trim(), caption: $('#edit-caption').value.trim() }).eq('id', editingId);
  if (error) return showMessage(error.message);
  const selectedTagIds = [...document.querySelectorAll('#edit-tags input:checked')].map((input) => input.value);
  const { error: deleteTagsError } = await supabaseClient.from('photo_tags').delete().eq('photo_id', editingId);
  if (deleteTagsError) return showMessage(deleteTagsError.message);
  if (selectedTagIds.length) {
    const { error: insertTagsError } = await supabaseClient.from('photo_tags').insert(selectedTagIds.map((tag_id) => ({ photo_id: editingId, tag_id })));
    if (insertTagsError) return showMessage(insertTagsError.message);
  }
  $('#edit-dialog').close();
  await load();
};

$('#delete-photo').onclick = async () => {
  if (!confirm('¿Eliminar esta fotografía? Esta acción no se puede deshacer.')) return;
  const photo = photos.find((item) => item.id === editingId);
  const paths = (photo?.photo_assets || []).map((asset) => asset.object_path);
  if (paths.length) {
    const { error: storageError } = await supabaseClient.storage.from(BUCKET).remove(paths);
    if (storageError) return showMessage(storageError.message);
    paths.forEach((path) => assetUrlCache.delete(path));
  }
  const { error } = await supabaseClient.from('photos').delete().eq('id', editingId);
  if (error) return showMessage(error.message);
  $('#edit-dialog').close();
  await load();
};

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    isRecoveringPassword = true;
    setAdmin(true);
  }
  setTimeout(() => checkOwner(session), 0);
});
supabaseClient.auth.getSession()
  .then(({ data, error }) => {
    if (error) throw error;
    return checkOwner(data.session);
  })
  .catch((error) => setSessionStatus(`No se pudo comprobar la sesión: ${error.message}`, 'error'));
