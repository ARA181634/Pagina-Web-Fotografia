# Luz & Archivo

Galería fotográfica responsive inspirada en la sobriedad editorial de la prensa. La galería usa Supabase para las fotografías, pies y etiquetas. El panel exige iniciar sesión y además comprueba el permiso de dueño en Supabase.

## Uso

Abre `index.html` en un navegador o ejecuta:

```bash
python3 -m http.server 8000
```

Después visita `http://localhost:8000`.

En **Administrar** el dueño puede subir imágenes, crear etiquetas y editar/eliminar fotografías. Al cargar una imagen, el navegador conserva el original en el bucket privado `photos` y genera versiones WebP de 420, 1200 y 2400 px. Las fotos nuevas se publican al terminar la carga.

## Supabase

La app se conecta al proyecto configurado en `app.js` con su URL y clave publishable. La clave publishable es pública y está protegida por las políticas RLS de la base; nunca pongas una clave `secret` o `service_role` en el navegador.

El esquema esperado incluye `photos`, `photo_assets`, `tags`, `photo_tags` y `site_admins`, la función `is_site_owner()`, sus políticas RLS y el bucket privado `photos`. Ejecuta el SQL de configuración en el SQL Editor de Supabase y agrega a `site_admins` el UUID del usuario dueño. En **Authentication → Settings**, desactiva los registros públicos y conserva solo las cuentas que autorices. El usuario dueño debe tener una contraseña configurada para iniciar sesión.

El navegador pide URLs firmadas para mostrar derivados del bucket privado. Los originales solo se firman para el dueño.

## Formatos

Para la web, **AVIF** suele proporcionar la mejor compresión/calidad; **WebP** es la opción más compatible y práctica para derivados. Conserva el original (RAW/TIFF/JPEG) fuera del navegador como archivo maestro y publica derivados AVIF/WebP. Esta versión genera WebP porque el navegador puede codificarlo de forma fiable.

Si publicas con GitHub Pages, configura en Supabase la URL del sitio como `https://ara181634.github.io/Pagina-Web-Fotografia/`. Para desarrollo local, sirve la carpeta con `python3 -m http.server 8000` y abre `http://localhost:8000`.
