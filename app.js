// The publishable key is intended for browser use. Access is enforced by Supabase RLS.
const SUPABASE_URL = 'https://rgkpmsaqbydnpvrqmbzg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_54CEWH3gizvILUgkRMb0UQ_D4P2s6WG';
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const BUCKET = 'photos';
const $ = (selector) => document.querySelector(selector);
let photos = [];
let tags = [];
let activeTag = 'all';
let editingId = null;
let isOwner = false;

async function checkOwner(session) {
  isOwner = false;
  let permissionError = null;
  if (session?.user) {
    const { data, error } = await supabase.rpc('is_site_owner');
    permissionError = error?.message || null;
    isOwner = !permissionError && data === true;
  }
  document.body.classList.toggle('is-owner', isOwner);
  $('#login-form').classList.toggle('hidden', isOwner);
  $('#owner-tools').classList.toggle('hidden', !isOwner);
  if (session?.user && permissionError) $('#login-message').textContent = `La sesión inició, pero Supabase no pudo comprobar permisos: ${permissionError}`;
  else if (session?.user && !isOwner) $('#login-message').textContent = `La sesión inició, pero el UUID ${session.user.id} no está autorizado en site_admins.`;
  if (isOwner) $('#login-message').textContent = '';
  await load();
}

async function signedAsset(asset) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(asset.object_path, 3600);
  if (error) return null;
  return { ...asset, url: data.signedUrl };
}

async function load() {
  const [photoResult, tagResult] = await Promise.all([
    supabase.from('photos').select('id,title,caption,is_published,created_at,photo_assets(id,kind,object_path,mime_type,width,height),photo_tags(tag:tags(id,name))').order('created_at', { ascending: false }),
    supabase.from('tags').select('id,name').order('name')
  ]);
  if (photoResult.error || tagResult.error) {
    $('#empty-state').hidden = false;
    $('#empty-state h2').textContent = 'No se pudo cargar la galería.';
    $('#empty-state p:not(.kicker)').textContent = photoResult.error?.message || tagResult.error?.message || 'Revisa la configuración de Supabase.';
    return;
  }
  tags = tagResult.data || [];
  photos = await Promise.all((photoResult.data || []).map(async (photo) => {
    const assets = await Promise.all((photo.photo_assets || []).filter((asset) => asset.kind !== 'original').map(signedAsset));
    const original = isOwner ? await Promise.all((photo.photo_assets || []).filter((asset) => asset.kind === 'original').map(signedAsset)) : [];
    return {
      ...photo,
      tags: (photo.photo_tags || []).map((entry) => entry.tag).filter(Boolean),
      assets: assets.filter(Boolean),
      original: original.find(Boolean)?.url || null
    };
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
    const image = template.querySelector('img');
    image.src = photo.assets.find((asset) => asset.kind === 'medium')?.url || photo.assets[0]?.url || '';
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
      const { error } = await supabase.from('tags').delete().eq('id', button.dataset.removeTag);
      if (error) return showMessage(error.message);
      if (activeTag === button.dataset.removeTag) activeTag = 'all';
      await load();
    };
  });
}

function showMessage(message) {
  $('#login-message').textContent = message || '';
}

function openPhoto(photo) {
  $('#dialog-image').src = photo.assets.find((asset) => asset.kind === 'large')?.url || photo.assets.find((asset) => asset.kind === 'medium')?.url || '';
  $('#dialog-image').alt = photo.title;
  $('#dialog-title').textContent = photo.title;
  $('#dialog-caption').textContent = photo.caption;
  $('#dialog-tags').textContent = photo.tags.map((tag) => tag.name).join(' · ');
  $('#photo-dialog').showModal();
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
      const { data: photo, error: photoError } = await supabase.from('photos').insert({ title, caption: '', is_published: false }).select('id').single();
      if (photoError) throw photoError;
      photoId = photo.id;
      const variants = await makeVariants(file);
      const filesToUpload = [
        { kind: 'original', blob: file, mime: file.type, width: null, height: null, path: `${photoId}/original.${extension(file)}` },
        ...variants.map((variant) => ({ ...variant, mime: 'image/webp', path: `${photoId}/${variant.kind}.webp` }))
      ];
      const assets = [];
      for (const asset of filesToUpload) {
        const { error } = await supabase.storage.from(BUCKET).upload(asset.path, asset.blob, { contentType: asset.mime, upsert: false });
        if (error) throw error;
        uploadedPaths.push(asset.path);
        assets.push({ photo_id: photoId, kind: asset.kind, object_path: asset.path, mime_type: asset.mime, width: asset.width, height: asset.height });
      }
      const { error: assetError } = await supabase.from('photo_assets').insert(assets);
      if (assetError) throw assetError;
      const { error: publishError } = await supabase.from('photos').update({ is_published: true }).eq('id', photoId);
      if (publishError) throw publishError;
      status.textContent = `Añadida: ${title}`;
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
      if (photoId) await supabase.from('photos').delete().eq('id', photoId);
      status.textContent = `No se pudo subir ${file.name}: ${error.message || 'revisa los permisos y el bucket photos'}`;
    }
  }
  await load();
}

function setAdmin(open) {
  $('#admin-panel').classList.toggle('open', open);
  $('#scrim').classList.toggle('show', open);
  $('#admin-panel').setAttribute('aria-hidden', !open);
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
  const { error } = await supabase.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  if (error) showMessage(`No se pudo iniciar sesión: ${error.message}`);
  else await checkOwner((await supabase.auth.getSession()).data.session);
};

$('#sign-out').onclick = async () => { await supabase.auth.signOut(); await checkOwner(null); };

$('#tag-form').onsubmit = async (event) => {
  event.preventDefault();
  const input = $('#new-tag');
  const name = input.value.trim();
  if (!name) return;
  const { error } = await supabase.from('tags').insert({ name });
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
  const { error } = await supabase.from('photos').update({ title: $('#edit-title').value.trim(), caption: $('#edit-caption').value.trim() }).eq('id', editingId);
  if (error) return showMessage(error.message);
  const selectedTagIds = [...document.querySelectorAll('#edit-tags input:checked')].map((input) => input.value);
  const { error: deleteTagsError } = await supabase.from('photo_tags').delete().eq('photo_id', editingId);
  if (deleteTagsError) return showMessage(deleteTagsError.message);
  if (selectedTagIds.length) {
    const { error: insertTagsError } = await supabase.from('photo_tags').insert(selectedTagIds.map((tag_id) => ({ photo_id: editingId, tag_id })));
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
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) return showMessage(storageError.message);
  }
  const { error } = await supabase.from('photos').delete().eq('id', editingId);
  if (error) return showMessage(error.message);
  $('#edit-dialog').close();
  await load();
};

supabase.auth.onAuthStateChange((_event, session) => { setTimeout(() => checkOwner(session), 0); });
supabase.auth.getSession().then(({ data }) => checkOwner(data.session));
