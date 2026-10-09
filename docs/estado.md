# Estado del proyecto

Actualizado: 9 de octubre de 2026.

## Situación actual

La primera versión está implementada como aplicación Angular local. Permite gestionar,
editar, guardar, recuperar y presentar presupuestos de servicios. Los datos se guardan
en el navegador mediante IndexedDB; la copia JSON permite trasladarlos o recuperarlos.

Repositorio público:
[presupuestador-personalizable-para-empresas](https://github.com/danilolaufer/presupuestador-personalizable-para-empresas).
Rama principal: `main`.

## Funcionalidades implementadas

| Bloque | Implementación |
| --- | --- |
| Base y cálculo | Angular standalone, TypeScript estricto, modelos, validación y calculadora pura con decimal.js |
| Editor | Reactive Forms tipados, FormArray, líneas manuales o desde catálogo, duplicación, eliminación y reordenación |
| Guardado | IndexedDB, carga por ID, autoguardado a los 500 ms, escrituras serializadas, reintentos y conflictos de revisión |
| Gestión | Listado, búsqueda, filtros, numeración transaccional, duplicación, estados comerciales y revisiones independientes |
| Configuración | Empresa, marca, logo, pago, condiciones, preferencias y catálogo de servicios |
| Documento | Vista previa compartida con impresión A4, desglose fiscal, pago único y cuota mensual |
| Recuperación | Exportación JSON completa, revisión de conflictos, importación transaccional y recuperación de borradores de emergencia |

Las rutas son `/presupuestos`, `/presupuestos/nuevo`,
`/presupuestos/:id/editar`, `/presupuestos/:id/vista-previa` y `/configuracion`.

## Reglas que se conservan

- El formulario es la única fuente editable; los resultados se derivan de sus cambios.
- Los importes se serializan como strings y se calculan con decimal.js y ROUND_HALF_UP.
- Orden por línea: bruto, descuento, base e IVA; después se suman los importes redondeados.
- El descuento fijo corresponde a la línea completa y se aplica antes del IVA.
- Los vacíos de un borrador se conservan y no se convierten en cero.
- Empresa, marca, pago, condiciones y servicios se copian dentro de cada presupuesto.
- Enviados, aceptados y rechazados mantienen contenido y totales históricos. Para editar
  contenido se crea una revisión independiente.
- Guardado solo se muestra al completar la transacción y cuando no quedan cambios pendientes.
- La revisión esperada se comprueba dentro de la misma transacción que escribe.
- Imprimir no cambia el estado comercial ni confirma que se haya guardado un PDF.

El dominio permanece independiente de Angular, DOM y persistencia. El editor utiliza
contratos de repositorio inyectados; la infraestructura IndexedDB está en `core/persistence`.

## Persistencia y restauración

Base física versión 2, almacenes `quotes` y `settings`, esquema de presupuesto 2,
cálculo versión 1 y formato de copia JSON versión 1.

La exportación lee ambas tiendas en una transacción coherente. La importación valida
estructura, tipos, tamaños, versiones, fechas, decimales, identificadores, imágenes,
relaciones y totales conservados antes de escribir.

Revisar un archivo no modifica datos. Las colisiones se omiten por defecto; también
se pueden recuperar como borradores independientes. Importar configuración requiere
seleccionarlo expresamente. Los vínculos de revisión se conservan cuando existe un
origen compatible; las plantillas eliminadas no invalidan sus copias históricas.

Al confirmar se vuelven a leer las tiendas y se comprueba que no cambiaron desde la
revisión. Documentos, configuración y contadores se escriben juntos o se revierten
juntos. Se conservan los documentos ajenos y los contadores nunca se reducen.

Se admiten JSON de emergencia con presupuestos de esquema 1 o 2, incluidos borradores
incompletos y creaciones fallidas. La migración conserva los datos originales y añade
los campos nuevos necesarios.

Los límites de importación y el procedimiento completo están documentados en
[README](../README.md#guardado-local-y-copias-json).

## Verificaciones realizadas

Última comprobación funcional: 9 de octubre de 2026.

| Comprobación | Resultado |
| --- | --- |
| `npm.cmd run build` | Correcto, sin avisos; 302.63 kB iniciales |
| `npm.cmd test -- --watch=false` | **201 pruebas superadas en 20 archivos** |
| `npm.cmd run preview` | Sirve la compilación de producción en 127.0.0.1:4173 |
| Peticiones HTTP a raíz, configuración, vista previa y JavaScript | HTTP 200; recuperación de rutas y MIME de JavaScript correctos |
| Referencia monetaria | Base 1525.00, IVA 320.25, conjunto 1845.25 |
| Desglose de referencia | Mensual 1609.30 y pago único 235.95 |
| Cambio de ocho a diez sitios | Conjunto 2208.25 |

Las pruebas utilizan Vitest de la CLI, jsdom y fake-indexeddb. Cubren:

- Decimales, descuentos, impuestos, redondeo, periodicidades y validación.
- Formulario, catálogo, orden de líneas y datos históricos independientes.
- Recuperación, guardados concurrentes, ediciones durante una escritura y fallos de almacenamiento.
- Numeración concurrente, estados, duplicación y revisiones.
- Navegación al documento tras guardar y bloqueo de impresión ante datos incompletos.
- Documento con 55 líneas y descripción de 200 párrafos, sin truncamiento del contenido.
- Exportación y restauración en bases de prueba separadas, con borradores y documentos emitidos.
- Colisiones de ID y número, cambios posteriores a la revisión y rollback de toda la importación.
- Conservación de contadores, catálogo, logos, orden y referencias entre revisiones.
- Archivos dañados, versiones incompatibles, JSON de emergencia y cancelación sin escrituras.
- Configuración pendiente antes de exportar y demostración sin reemplazar datos existentes.

La prueba de contenido extenso verifica el DOM, no la paginación del PDF. La llamada
a impresión y la decodificación de imágenes se sustituyen por dobles en las pruebas
que corresponden. Las restauraciones automatizadas no acceden a datos reales.

## Entorno verificado

Node 24.13.0, npm 11.6.2, Angular 21.2.23, CLI 21.2.19, build 21.2.24,
TypeScript 5.9.3, decimal.js 10.6.0, Vitest 4.1.11, jsdom 28.1.0 y fake-indexeddb 6.2.5.

Se conserva `package-lock.json` y se utiliza npm. No se cambiaron dependencias al preparar
la documentación pública. El código de la aplicación tampoco se modificó.

## Documentación pública

El repositorio incluye la guía de uso, la arquitectura y este estado técnico.
La documentación se centra en instalación, funcionamiento, decisiones de diseño,
resultados comprobados y tareas pendientes. Los archivos locales de trabajo no
forman parte de la distribución pública.

## Pendientes y siguiente paso

Queda pendiente la comprobación manual en Chrome/Edge y Firefox:

- Impresión corta y de varias páginas, incluida una descripción mayor que una página.
- Repetición de cabeceras, ausencia de recortes y páginas vacías, texto seleccionable y logo.
- Guardar como PDF, comparar sus importes y revisar todas las páginas.
- Selectores y descarga real de archivos, decodificación de logos y restauración entre perfiles.
- Apariencia móvil/escritorio, tabulación, foco y comportamiento de los diálogos.

Estas comprobaciones deben hacerse en un perfil u origen de prueba con datos ficticios,
sin borrar la base real. No hay PDF inspeccionado ni capturas visuales verificadas.

El repositorio publica código fuente; no despliega una web ni incluye presupuestos
guardados en IndexedDB. Backend, autenticación y sincronización quedan para una fase futura,
que podría utilizar Spring Boot, MySQL y cálculo autoritativo con BigDecimal.
