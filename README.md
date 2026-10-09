# Presupuestador

Aplicación local para preparar presupuestos de servicios: editar cantidades, precios,
descuentos e IVA, distinguir cuotas mensuales de pagos únicos, recuperar el trabajo y
presentarlo como documento imprimible. Es un proyecto de aprendizaje con Angular;
la primera versión incluye las entregas 1 a 5.

## Funcionalidades

- Editor con Reactive Forms tipados, FormArray, validaciones visibles y navegación por teclado.
- Servicios manuales o copiados del catálogo; añadir, duplicar, eliminar y reordenar.
- Cálculo decimal, resumen inmediato y borradores incompletos sin convertir vacíos en cero.
- IndexedDB, autoguardado a los 500 ms, recuperación por ID, reintentos y protección de conflictos.
- Listado con búsqueda, filtros y orden; numeración transaccional, duplicación y estados comerciales.
- Configuración de empresa, marca, logo, pago, condiciones y catálogo.
- Histórico independiente: modificar la configuración no cambia presupuestos existentes.
- Vista previa e impresión A4 mediante el diálogo del navegador.
- Copias JSON completas, recuperación del JSON de emergencia y restauración transaccional.

## Entorno y arranque

Versiones comprobadas el 22 de septiembre de 2026:

| Herramienta                     | Versión                 |
| ------------------------------- | ----------------------- |
| Node / npm                      | 24.13.0 / 11.6.2        |
| Angular                         | 21.2.23                 |
| Angular CLI / build             | 21.2.19 / 21.2.24       |
| TypeScript / RxJS               | 5.9.3 / 7.8.2           |
| decimal.js                      | 10.6.0                  |
| Vitest / jsdom / fake-indexeddb | 4.1.11 / 28.1.0 / 6.2.5 |

Desde la carpeta del proyecto:

```bash
npm ci
npm start -- --host 127.0.0.1
```

Abre `http://127.0.0.1:4200/presupuestos`. En PowerShell puedes usar `npm.cmd`
si la política bloquea `npm.ps1`; no necesitas cambiar la política de Windows.
Se utiliza npm y el `package-lock.json` existente. No se añadieron dependencias en la entrega 5.

## Pruebas y producción

```bash
npm test -- --watch=false
npm run build
npm run preview
```

La compilación usa producción por defecto y genera `dist/presupuestador/browser`.
`npm run preview` sirve esos archivos en `http://127.0.0.1:4173`, con recuperación
de rutas de Angular al recargar. Es un servidor local de comprobación, ligado a loopback,
sin dependencias; se detiene con Ctrl+C. No es un servidor de despliegue público.

Para desplegar, sirve el contenido de esa carpeta mediante HTTPS y configura las rutas
de aplicación para devolver `index.html`. No se ha realizado un despliegue externo.
El puerto 4173 y el 4200 tienen bases independientes: usa el segundo origen o un perfil
de prueba para comprobar restauraciones sin tocar datos reales.

Las pruebas usan Vitest de la CLI, jsdom y fake-indexeddb. Comprueban cálculo,
guardado, conflictos, Router, documento e importación atómica; no comprueban
paginación, impresoras, disco real ni la apariencia de un navegador.

## Recorrido de demostración

1. En Configuración, pulsa **Crear presupuesto de demostración** y abre el enlace resultante.
   Añade datos ficticios con ID y número propios, sin reemplazar documentos ni configuración.
2. Comprueba base **1525.00 €**, IVA **320.25 €** y conjunto **1845.25 €**:
   cuota mensual **1609.30 €** y pago único **235.95 €**.
3. Cambia de 8 a 10 sitios: el conjunto pasa a **2208.25 €**.
   Vacía el precio: el cálculo queda incompleto y el vacío se conserva al guardar.
4. Restaura el precio, espera a **Guardado a las…**, recarga y comprueba los datos y el orden.
5. Abre Vista previa. Vuelve al presupuesto y márcalo enviado; crea después una revisión
   para modificarlo sin alterar el original.
6. Exporta un JSON desde Configuración y restáuralo en el origen o perfil de prueba.

El editor también conserva **Cargar ejemplo**, que avisa antes de sustituir contenido.
Un presupuesto nuevo se persiste antes de abrir `/presupuestos/:id/editar`.
El número automático tiene formato `P-AAAA-0001`, se puede editar y debe ser único.

**Marcar como enviado** es un estado manual: no envía correos. Valida el documento y
congela su contenido e importes. Enviados, aceptados y rechazados permiten cambios de
estado; para cambiar contenido se crea una revisión en borrador con otra identidad y número.
Duplicar produce una copia independiente sin enlace al original. Las copias ordinarias
utilizan fecha actual y plazo configurado, conservando los datos históricos de origen.

## Guardado local y copias JSON

Los datos pertenecen al navegador, perfil y origen (protocolo, host y puerto).
`localhost` y `127.0.0.1` tienen almacenamientos distintos. Borrar datos del navegador
puede eliminar los presupuestos. Conserva copias fuera de él.

El formulario es la fuente editable. El coordinador espera 500 ms, envía una instantánea
al contrato asíncrono de repositorio y serializa escrituras. El adaptador comprueba
la revisión y escribe en la misma transacción IndexedDB. Solo muestra Guardado cuando
la transacción termina y no quedan ediciones pendientes. Al abrir una ruta recupera
el documento antes de habilitar el autoguardado.

Si falla el guardado, reintenta o descarga el borrador de emergencia. Ante un conflicto,
exporta la copia local antes de descartarla y cargar la almacenada. La advertencia de
cierre depende del navegador; no se confía en escribir durante el cierre.

### Exportar

En Configuración pulsa **Exportar copia de seguridad**. Primero se guardan sus cambios
pendientes; si no se puede, la exportación se detiene. Espera también a Guardado en
otras pestañas: no se pueden incluir sus cambios que todavía estén solo en memoria.

Una única transacción de lectura obtiene presupuestos, configuración y contadores.
El archivo incluye `kind: presupuestador-backup`, `schemaVersion: 1`, `exportedAt`,
`quotes`, `settings` y `counters`; el nombre lleva fecha y hora.
Incluye estados, enlaces entre revisiones, totales cerrados, versiones de cálculo y logos.
Los registros ajenos al esquema de esta aplicación en settings se conservan en la base;
no forman parte del formato de copia.

### Restaurar

1. Selecciona un JSON en **Importar copia de seguridad**.
2. Revisa el resumen de documentos, conflictos y catálogo. Leer el archivo no importa datos.
3. Por defecto se omiten colisiones de ID o número y se conserva la configuración actual.
   Puedes omitir más documentos o recuperarlos como borradores independientes.
4. Una recuperación como borrador genera ID, número, fechas y líneas nuevos; no conserva
   el estado emitido ni el enlace de revisión. Usa 30 días de validez y recalcula al editar.
   Los originales importados sin colisión conservan sus fechas, estados y totales.
5. Marca expresamente si quieres importar empresa, preferencias y catálogo.
6. Pulsa **Confirmar importación**, o cancela sin aplicar la copia.

Se comprueban formato, versiones, tipos, identificadores, decimales, tamaños, relaciones
y logos. Se admiten vacíos y decimales a medio escribir en borradores; se mantienen
como texto. Documentos emitidos exigen datos completos y desgloses coherentes.
Los logos se comprueban por formato, tamaño y decodificación antes de escribir.

Si falta el origen de una revisión, o el ID corresponde a otro contenido, no se enlaza
silenciosamente: restaura el origen, omite el documento o recupéralo como borrador
independiente. Una plantilla eliminada del catálogo no invalida una línea histórica.

La confirmación vuelve a leer ambas tiendas **dentro de la transacción de escritura**.
Si cambiaron desde la revisión, se cancela y pide revisar de nuevo. Todos los documentos
seleccionados, configuración y contadores se confirman juntos o se revierten juntos.
No se eliminan documentos ajenos, no se reemplazan emitidos y los contadores nunca se reducen.
Importar configuración incrementa su revisión técnica para detectar formularios antiguos
en otras pestañas.

Se admiten JSON de emergencia de la entrega 3: envoltorio versión 1 y presupuesto
de esquema 1 o 2. La migración añade título y titular vacíos; una revisión técnica 0
de una creación fallida se convierte en 1 al recuperar.

Límites de importación: 50 MiB, 10 000 presupuestos, 1000 líneas por presupuesto,
1000 plantillas, textos de hasta 200 000 caracteres e identificadores seguros de hasta
128 caracteres. Logos PNG/JPEG/WebP de hasta 300 KiB y 16 megapíxeles. SVG y URLs remotas
no se admiten. Los archivos deben proceder de una fuente de confianza: validar su
estructura no certifica la autenticidad comercial de su contenido.

## Vista previa, impresión y PDF

Desde el editor, **Vista previa** termina el guardado antes de navegar a
`/presupuestos/:id/vista-previa`. En un documento cerrado está disponible
**Vista previa / Imprimir**.

El componente `quote-document` representa el mismo HTML en pantalla y al imprimir.
Solo usa las copias históricas del presupuesto. En borradores toma `calculateQuote()`;
en emitidos lee sus totales y `calculationVersion` conservados, sin recalcularlos.
Los textos del usuario se interpolan como texto y se ocultan los opcionales vacíos.

**Imprimir / Guardar como PDF** espera fuentes e imágenes y abre el diálogo del navegador.
Elige allí Guardar como PDF, papel A4 y, si lo prefieres, desactiva las cabeceras/pies
del navegador. El texto sigue siendo seleccionable. Cerrar el diálogo no demuestra
que se haya guardado un archivo; la aplicación no anuncia una descarga PDF completada.
Imprimir tampoco marca el documento como enviado.

Si faltan datos obligatorios, se indican los campos que corregir y se bloquea la acción.
Un borrador válido se imprime con **BORRADOR**. La vista conserva la versión leída al
abrirse; usa **Actualizar vista previa** si editaste el presupuesto en otra pestaña.

El CSS fija márgenes A4, oculta navegación y acciones, solicita cabeceras de tabla
repetidas y evita cortes de bloques de importes cuando caben. Las descripciones extensas
pueden continuar en otra página. **La paginación real todavía requiere comprobación
en navegador**. Todavía no se ha verificado un PDF generado ni se han preparado capturas reales.

Para comprobarla en un perfil de prueba, imprime la demo corta, otra con numerosas líneas
y una con una descripción de varios miles de palabras. Revisa todas las páginas: encabezados,
texto completo, ausencia de recortes horizontales y páginas vacías, totales y logo.
Compara el PDF con el editor: 1845.25 / 1609.30 / 235.95, y 2208.25 al cambiar la cantidad.

## Arquitectura y reglas de cálculo

| Zona                | Responsabilidad                                                                   |
| ------------------- | --------------------------------------------------------------------------------- |
| `domain/quotes`     | Modelos, validación, cálculo decimal y ciclo de vida; sin Angular ni persistencia |
| `features/quotes`   | Listado, editor, documento, vista previa y contrato/adaptador de repositorio      |
| `features/settings` | Empresa, catálogo, preferencias e interfaz de copias                              |
| `core/persistence`  | IndexedDB versionada y confirmación de transacciones                              |
| `core/backup`       | Formato JSON, validación, revisión de conflictos y restauración                   |
| `shared/ui`         | Controles reutilizados                                                            |

El formulario tipado es la única fuente editable; signals derivan cálculo y estado.
Los contratos se inyectan mediante InjectionToken, sin IndexedDB en los componentes.

EUR y decimales serializados como strings. Con decimal.js y ROUND_HALF_UP:
bruto por línea → descuento redondeado → base → IVA redondeado → suma de líneas.
El descuento fijo corresponde a la línea completa y siempre se aplica antes del IVA.
Se separan cantidad, unidad y nombre; periodicidades `monthly` y `one-time`.
El IVA se agrupa por periodicidad, tratamiento, tipo y motivo fiscal.
El conjunto suma pago único y una mensualidad: no es el coste contractual total.
Solo se denomina Pago inicial cuando se indica expresamente que incluye una mensualidad.

La base física sigue en versión 2, con tiendas `quotes` y `settings`.
El esquema de presupuesto es 2, el cálculo es 1 y el formato de copia es 1.
La migración desde la base de la entrega 3 conserva contenido, números y totales.

## Límites y evolución

Aplicación local, sin servidor, cuentas, sincronización, SSR ni envío de correos.
El almacenamiento del navegador no sustituye una copia de seguridad. No hay importación
de PDF, firma de documentos ni garantía de reproducción exacta de un PDF de referencia.
La impresión, accesibilidad visual, selectores de archivos, decodificación real de logos
y restauración entre perfiles requieren la verificación manual indicada.

Una fase futura puede incorporar un adaptador HTTP y Spring Boot con MySQL,
autenticación, autorización, migración y cálculo autoritativo con BigDecimal.
No forman parte de estas cinco entregas.

Consulta [la arquitectura](docs/arquitectura.md) y [el estado y las verificaciones reales](docs/estado.md).
