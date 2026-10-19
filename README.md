# Luz & Archivo

Galería fotográfica responsive inspirada en la sobriedad editorial de la prensa. Es una primera versión estática: las fotografías, pies y etiquetas se almacenan localmente en el navegador mediante IndexedDB.

## Uso

Abre `index.html` en un navegador o ejecuta:

```bash
python3 -m http.server 8000
```

Después visita `http://localhost:8000`.

En **Administrar** se pueden subir imágenes, crear etiquetas y editar/eliminar cada fotografía. Al cargar una foto se conserva el original y se genera una versión WebP de hasta 1600 px para la galería.

## Formatos

Para la web, **AVIF** suele proporcionar la mejor compresión/calidad; **WebP** es la opción más compatible y práctica para derivados. Conserva el original (RAW/TIFF/JPEG) fuera del navegador como archivo maestro y publica derivados AVIF/WebP. Esta versión genera WebP porque el navegador puede codificarlo de forma fiable.

## Alcance de esta versión

No hay cuenta ni servidor: el panel de administración es local y las fotos no se sincronizan entre dispositivos. Para un sitio público y multiusuario se debe añadir autenticación y almacenamiento de objetos (por ejemplo, Cloudinary, S3 o Supabase Storage), sin guardar originales codificados en el navegador.
