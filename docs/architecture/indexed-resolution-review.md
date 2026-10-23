# D3 revisada: LTP Index contrastado con la implementación

**Estado: dirección y contratos neutrales Draft 0.1 aprobados formalmente por el
dueño (2026-10-23); publicación final y conformidad Edge pendientes.**
La programación de esa ruta queda bloqueada hasta fusionar el commit documental;
el [registro de cierre](../protocol-apw/LTP-STANDARDIZATION-STATUS.md) distingue ese
gate de fusión de los requisitos de activación. No crea un Index global obligatorio, cambia DNSSEC,
publica evidencia privada ni implementa un relay.

## Estándar y runtime: separación normativa

**LTP Index**, **LTP Proof Package**, **LTP Attestation** y
**SVRI Projection** son roles/formatos de protocolo neutrales. **Portaless** nombra
únicamente el runtime o implementación de referencia. Un motor independiente
(Go, Rust, Nuvid u otro) puede producir/consumir los mismos mensajes y verificar
las mismas reglas sin importar módulos o código de Portaless.

El concepto principal es confianza y trazabilidad: **APW** identifica y estructura
el intercambio P2P; **LTP** audita historiales, evidencias y testigos; **SVRI**
expresa la salida; **HSVR** conserva su histórico verificable. Véase
[LTP Stack](../protocol-apw/LTP-STACK-ARCHITECTURE.md).

Contratos de estándar redactados bajo CC BY 4.0, separados de este análisis de
implementación:

- [LTP Index Draft 0.1](../protocol-apw/LTP-INDEX-DRAFT-v0.1.md):
  endpoint configurado, mensajes, errores, límites, progreso y rol no autoritativo.
- [LTP Proof Package Draft 0.1](../protocol-apw/LTP-PROOF-PACKAGE-DRAFT-v0.1.md):
  bytes/digests, identidades, cadenas, LTP Attestations y recomputación de SVRI Projection.
- [APW Identity Bootstrap Draft 0.1](../protocol-apw/APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md):
  DoH/AD independiente o DNSSEC local, con supuestos y frescura diferenciados.

Son borradores con requisitos MUST, no una errata adoptada ni una API activada.
Faltan vectores independientes y verificadores compatibles; el runtime no obtiene
conformidad por compartir repositorio con la especificación.

El contrato de paquete añade un binding `apw-key-set+jws` del propio sujeto para
autenticar la lista de claves históricas y sus ventanas: el log no firma por sí
solo un array `keys` externo que el Index podría alterar. Es un artefacto nuevo
del borrador, no algo que Portaless ya publique ni una modificación adoptada de
APW v1.3. Sin ese binding, el perfil indirecto de historial queda incompleto.

## Dictamen

La ruta indexada permite evitar que cada operador Edge despliegue su propio
relay: consultar servidores Index configurados por el operador y verificar los
datos localmente es una dirección compatible con Portaless. El relay privado
queda como alternativa explícita, no requisito de instalación o protocolo.
**La condición fail-closed permanece:** sin un paquete suficiente, auténtico,
vigente y compatible con la autorización, no hay validación externa positiva ni
fallback hacia el dominio arbitrario del solicitante.

No es correcto afirmar que una URL fija hace el fetch «100% seguro», que una
firma del dominio prueba su score o que el Index actual ya resuelve este flujo.
Una firma detecta cambios en los bytes firmados si la clave ya es confiable;
no demuestra por sí sola el vínculo DNS del firmante, vigencia, completitud,
corrección del cálculo, ausencia de omisiones o disponibilidad de datos nuevos.

## Evidencia actual

| Afirmación a contrastar | Estado y evidencia archivo:línea |
|---|---|
| El Index ya es un distribuidor de pruebas SVRI | **No.** `functions/.well-known/apw-index.json.js:1-15,31-48` publica un directorio de observaciones al último sync, no una prueba SVRI autocontenida. Es JSON plano sin firma propia. |
| La implementación ya agrega DID/manifiestos/SiteTrustScore remotos | **No para ese contrato.** `packages/apw-resolver/src/did-apw/witness-index.ts:3-33,88-102` describe agregación de testigos, descubrimiento y re-verificación; excluye agregación de manifiestos/SiteTrustScore. |
| Un consumidor puede verificar el documento actual sin otras descargas | **No.** El contrato exige re-verificar contra cadenas del sujeto y testigos: `docs/api/well-known.md:96-125`; `witness-index.ts:153-223`. La ruta Edge nueva tendría que recibir esas pruebas, sin perseguir URLs arbitrarias. |
| Una proyección pública equivale a un certificado APW | **No.** `docs/architecture/canonical-node-and-public-projections.md:23-30,63-75,94-100`: snapshot público aprobado; el formato inicial de revisiones es unsigned y no normativo APW. |
| La dirección está alineada con la visión | **Sí.** `docs/VISION.md:53,178`: índices para descubrimiento sin convertirse en autoridades, canales/proyecciones intercambiables y evidencia verificable. No exige un directorio central. |
| SVRI ya contiene una firma/digest total verificable de forma aislada | **No.** `docs/protocol-apw/SVRI-v1.0.md:53-103` define proyección versionada, presentación pública limitada y reconstrucción desde fuentes. No un certificado autocontenido firmado. |
| Firmar B su resultado prueba las fuentes independientes | **No.** `docs/protocol-apw/APW-SPEC-v1.3.md:211-255` exige firmas de cadena y vinculación de JWS; `SVRI-v1.0.md:97-103` exige además verificar las fuentes para reconstrucción. |

No se encontró contrato/código de `PAG` o `Verapod` en las fuentes inspeccionadas;
no se usan esos términos como funcionalidades entregadas ni como aceptación de D3.

## Separar roles: canon, Index y consumidor

```text
B: canon y pruebas originales
    │ exportación explícita de pruebas publicables/autorizadas
    ▼
Index del operador o de un tercero elegido
    │ distribución/caché de bytes y pruebas, no autoridad de score
    ▼
Worker: endpoint Index fijo + validación local + decisión propia
```

- El canon conserva el estado autoritativo de su sitio. Un Index no se convierte
  en canon de todos los sitios por almacenar copias ni puede aprobar publicación
  privada por ellos.
- El Index puede adquirir/producir su caché usando un runtime/conector seguro,
  pero ese coste no recae necesariamente en cada instalación Edge. Requiere
  operadores y disponibilidad reales; no hay red global desplegada demostrada.
- La consulta al Index tiene endpoint HTTPS exacto configurado por el operador,
  redirects deshabilitados, entradas/salidas acotadas y autenticación de servicio
  cuando corresponda. El sujeto consultado es dato, nunca la URL del transporte.
- Un paquete incompleto no habilita llamadas desde el Worker a `did.json`,
  bundles o testigos arbitrarios para «completarlo». El Index tampoco debe ser
  un proxy SSRF abierto: si hace recolección bajo demanda, aplica pinning, CIDR,
  TLS, autenticación/abuso y presupuestos de adquisición.
- DNS/TLS y la disponibilidad del endpoint fijo siguen siendo supuestos del
  bootstrap. La verificación criptográfica reduce la confianza en los datos del
  Index; no demuestra la IP a la que conectó el fetch de Workers.

## Contrato de pruebas redactado; implementación y conformidad pendientes

El LTP Proof Package propuesto define una envoltura versionada que liga sujeto DID, propósito,
versión de reglas, ancla/seq/hash observados, procedencia y vigencia con:

1. **Raíz de identidad independiente.** Did.json y una clave que el propio Index
   entregue no bastan: un Index malicioso podría inventar ambos. Preservar D1:
   el TXT `_apw` y su `k`/`h` deben autenticarse según la política DNS aprobada.
   Un JSON DoH reenviado con `AD: true` no es una prueba DNSSEC portable.
2. **Historial y claves.** Cadena completa o continuidad desde un checkpoint
   local previamente confiable, ventanas de claves, rotaciones y consistencia
   del ancla. No confiar en el campo `status: consistent` sin sus pruebas.
3. **Fuentes.** JWS originales, hashes `att`, pertenencia, emisor/sujeto y claves
   de emisores con raíces verificables. No sustituir firma de fuente por firma
   de B o del Index. Todo debe caber en límites y cumplir completitud.
4. **Proyección.** Recalcular LTP/SVRI con el conjunto admisible y perfil exactos;
   un resultado firmado por B sin esas pruebas es una declaración atribuible,
   no un resultado independientemente reproducido. No se crea un tier nuevo.
5. **Frescura y replay.** Vencimientos derivados de la raíz DNS, claves y pruebas,
   rechazo de rollback frente al estado conocido, expiración D6 y motivos de
   evidencia ausente/caducada. El Index puede ocultar datos o servir una versión
   anterior todavía válida; no se demuestra «último estado global» por una fecha
   o una firma. Comparar varios índices ayuda a observar discrepancias, no crea
   automáticamente consenso ni fuentes independientes.

### Perfiles neutrales de bootstrap para preservar D1

| Variante | Confianza efectiva | Estado |
|---|---|---|
| `dnssec-offline-v1`: RRsets, RRSIG, DNSKEY/DS y cadena a un trust anchor configurado | Se verifica DNSSEC localmente; el LTP Index transporta bytes. RRSIG válido no demuestra que sea el último DNS publicado. | Contrato redactado; verificador/vectores pendientes. No existe en el resolver actual. |
| `independent-doh-ad-v1`: raíz obtenida por el consumidor desde un proveedor fijo independiente | Confianza explícita en el proveedor validador HTTPS conforme a D1, no en el LTP Index | Excepción de bootstrap fija definida en el contrato; sin endpoints derivados del paquete, sin downgrade. Adaptador y conformidad pendientes. |
| Aceptar afirmación firmada del Index sobre DNS/identidad/score | Se confía en el Index para esa afirmación. Una firma demuestra atribución, no validación independiente. | No satisface «Index solo mensajero»; requeriría cambiar y declarar el modelo de confianza. No se adopta por defecto. |

JS/WebCrypto o WASM pueden ejecutar el verificador; WASM no evita ninguno de
estos requisitos ni convierte una afirmación AD reenviada en prueba DNSSEC.
El dueño aprueba formalmente esta dirección y los contratos baseline de dos perfiles.
Faltan cierre interoperable y publicación final con vectores antes de declarar D3 resuelta
operativamente o activar resolución indexada; no basta escoger un nombre de perfil.

## Privacidad: una proyección pública no autoriza publicar todas las pruebas

SVRI v1.0 limita la superficie pública a versión/nivel cualitativo; score,
conteos/procedencia detallada y HSVR son administrativos según su contrato. Una
proyección pública de contenido tampoco exporta historial privado o grants.

Si las pruebas necesarias para recalcular exponen información gobernada, el
Index debe respetar autorización y alcance; no almacenarlas en caché pública por
conveniencia. Sin acceso a esas pruebas, el consumidor no declara una verificación
completa independiente. Una prueba criptográfica compacta que oculte evidencia
sería otro diseño, no una capacidad ZK ya disponible. Mostrar un nivel declarado
firmado puede ser útil, pero debe distinguirse de un resultado recalculado.

## D3 objetivo revisado

1. **Node:** resolución directa mediante conector fijado, rangos compartidos,
   TLS/SNI y presupuestos. El Index también puede usarse como caché de datos,
   siempre validando las pruebas.
2. **Workers/Edge:** egress arbitrario deshabilitado. Ruta prevista: Index(es)
   fijos elegidos por el operador, con pruebas suficientes para validación local
   y bootstrap de identidad independiente. El Index no recibe automáticamente
   un grant ni pasa a ser autoridad del protocolo.
3. **Relay:** alternativa privada explícita, no requisito de instalación.
   Conserva los requisitos de pinning, autenticación, replay y cuotas de la
   decisión anterior; no fallback automático a relay/otro índice sin política.
4. **Sin ruta verificable:** motivo operativo / pendiente / sin datos según
   etapa. Sin fetch arbitrario, resultado positivo inventado o misconduct.
   La ausencia de Index/relay no impide servir contenido público ni operar localmente.

## Impacto sobre A/B/C y aceptación

- No se implementa un Index global ni se activan reputación/R-05 o PR3 por esta
  propuesta. A/B/C siguen completando el transporte y verificación existentes.
- El LTP Proof Package y sus perfiles de bootstrap se definen en los contratos
  neutrales enlazados arriba; su implementación/conformidad siguen pendientes.
  No se mezclan tácitamente con el JSON informativo
  `apw-index.json` actual; debe versionarse y mantener compatibilidad.
- Fixtures locales requeridos antes de soportarlo: Index malicioso que sustituye
  claves/DID, cambia bytes, firma un score inventado, omite fuentes, reenvía AD
  falso, ofrece historial rollback/caducado, devuelve redirect o cuerpo enorme,
  y paquete válido que se verifica con **cero conexiones** a B/emisores/testigos.
- Medir adquisición del Index y validación del consumidor por separado con
  servidores locales controlados. No afirmar «milisegundos» en Workers ni
  aceleración global sin mediciones y operadores reales.

**Conclusión:** adoptar la dirección de egress indexado con relay opcional
preserva adopción y soberanía, pero la independencia del Index depende del
contrato de raíz/pruebas, no de una URL fija o una firma aislada.
