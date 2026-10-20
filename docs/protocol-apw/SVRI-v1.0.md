# SVRI v1.0 — Score de Verificación y Razonamiento de Inferencia

**Carácter:** suplemento normativo de LTP/APW v1.3, incorporado por ERRATA E-16.  
**Licencia:** CC BY 4.0.  
**Perfil inicial:** `ltp-svri-site-v1`.

SVRI comunica un resultado LTP junto con la procedencia de la evidencia y la contribución de inferencia matemática. No sustituye LTP, no introduce un almacén paralelo de puntuaciones y no convierte una firma en prueba de la verdad de una declaración.

## 1. Fuentes y tiers

El tier identifica la procedencia; **no es un multiplicador de peso**. Los pesos y el cálculo por dimensión siguen siendo los publicados por LTP, incluido el previo neutral `P = 3`.

| Tier | Fuente APW | Regla de procedencia |
|---|---|---|
| T1 — Transaccional | `escrow_report` | Atestación verificada contra la clave registrada del proveedor. |
| T2 — Declaración del sitio | `self` | Atestación verificada contra una clave `did:apw` válida para el instante firmado. La firma atribuye la declaración; no demuestra su contenido. |
| T3 — Evaluación distribuida | `community` | Atestación `did:apw` verificada; la evidencia efectiva también satisface E-13 (deduplicación por emisor, antigüedad y `min_weight`). |
| T4 — Conducta del lector | `reader_conduct` | En el perfil de sitio, `t4Count` registra emisiones firmadas del sitio como actividad, pero no las suma al score W: el sujeto de esas atestaciones es un lector. En el perfil R del lector, cuenta sólo si el sujeto coincide con ese lector. |
| T5 — Evaluación automatizada | `agent` | Atestación verificada contra la clave del agente y aceptada por el endpoint. El tier dice que la fuente es `agent`; no prueba que ningún humano participara en su proceso. |

El previo bayesiano es **inferencia matemática**, no una firma ni un sexto tier. SVRI lo informa con `priorShare` e `isInference`; no incrementa `t1Count`…`t5Count`.

Los conteos son cantidades de atestaciones distintas (`iss` + `jti`) con procedencia verificada en el ingreso. Las atestaciones fuera de escala, duplicadas o sin identificador no cuentan. Una atestación puede alimentar una dimensión derivada y sigue contando una sola vez en el tier.

## 2. Perfiles y cálculo

`ltp-svri-site-v1` usa únicamente dimensiones W que el motor LTP calcula a partir de evidencia con JWS verificado. Excluye opiniones anónimas y filas heredadas sin prueba. `reader_conduct` se mantiene en su dominio R y no incrementa el score W del sitio; HSVR cuenta las emisiones del sitio como actividad T4 sin hacerlas pasar por evidencia sobre el propio sitio.

Para cada dimensión W con peso de evidencia efectivo positivo, LTP conserva su fórmula normativa:

```text
S_d = (P × 4 + Σ(w_i × v_i)) / (P + Σw_i),  P = 3
```

La puntuación interna `score` es la media aritmética de esas dimensiones, llevada de 1–7 a 0–10:

```text
score10_d = 10 × (S_d − 1) / 6
score = mean(score10_d)
```

Una dimensión sin evidencia efectiva no participa en la media. Si ninguna dimensión participa, el valor interno es el previo neutral mapeado (**5.0/10**) y no es una medición.

```text
priorShare = (P × número de dimensiones incluidas) /
             (P × número de dimensiones incluidas + suma de pesos efectivos)
isInference = priorShare > 0.5
incompleteData = (t1Count + t2Count === 0)
```

La regla de `incompleteData` es deliberadamente estricta: T3/T5 por sí solos no sustituyen las fuentes primarias T1/T2 para declarar completa la evaluación de sitio. Una atestación T1/T2 no garantiza por sí sola que el previo haya dejado de predominar; `isInference` se calcula por la fórmula anterior, no por una excepción por tier.

## 3. Contrato de datos

La proyección administrativa usa este contrato versionado:

```text
SVRI: X.X/10 T1: N | T2: N | T3: N | T4: N | T5: N
Dato incompleto: boolean | Inferencia: boolean
```

Objeto equivalente:

```json
{
  "version": "1.0",
  "profile": "ltp-svri-site-v1",
  "score": 5,
  "t1Count": 0,
  "t2Count": 0,
  "t3Count": 0,
  "t4Count": 0,
  "t5Count": 0,
  "incompleteData": true,
  "isInference": true,
  "priorShare": 1,
  "effectiveWeight": 0,
  "dimensionCount": 0,
  "rulesVersion": "ltp-svri-site-v1"
}
```

La interfaz pública puede exponer `version` y el **nivel cualitativo**, pero no el número SVRI, los conteos ni `priorShare`. El diagnóstico completo y HSVR son superficies administrativas. Los campos de `projection.aggregates` que APW v1.3 §6.6 ya hace públicos conservan su contrato: E-16 no modifica ni elimina los agregados APW existentes.

## 4. Niveles cualitativos públicos

Se clasifica el número sin redondearlo antes de aplicar los límites:

1. **Pendiente:** `incompleteData`, score ausente/no finito o estructura inválida.
2. **Bajo:** score `< 5`.
3. **Verificar:** score `≥ 5` y `< 7`, o `isInference` verdadero.
4. **Seguro:** score `≥ 7` y `< 9`, con `isInference` falso.
5. **Confiable:** score `≥ 9`, `incompleteData` falso, `isInference` falso y al menos una fuente T1/T2.

El público recibe el nombre del nivel y una explicación breve. No recibe el score numérico ni el detalle de fuentes; un resultado incompleto siempre se presenta como **Pendiente**, aunque el valor matemático sea 5.0 o superior.

## 5. HSVR — reconstrucción histórica

HSVR es el procedimiento administrativo para reproducir SVRI desde atestaciones append-only y los historiales APW disponibles. Para cada evento conserva la secuencia, instante de anotación, fuente, tier, emisor, identificador, estado de verificación y score recalculado.

El consumidor debe verificar la cadena del sitio, comprobar que el hash de cada JWS de emisor coincide con el `att` anclado y verificar la firma del emisor cuando la clave histórica esté disponible. La imposibilidad de verificar el anclaje DNS, una clave histórica o un JWS antiguo se marca como reconstrucción **parcial**; no se rellena ni se presenta como histórico verificado. Un score actual no puede sustituir un punto histórico que no esté respaldado por las pruebas disponibles.

HSVR no es una ruta pública ni una API anónima. Su representación incluye atestaciones, emisores y detalles de verificación, y sólo se sirve tras autorización administrativa.

## 6. Conformidad

Los vectores independientes están en [`vectors/svri/v1.0/`](./vectors/svri/v1.0/). Una implementación SVRI v1.0 debe reproducir puntuación, conteos, flags y nivel público, incluidos:

- ausencia de firmas → score interno prior 5.0, `incompleteData = true`, `isInference = true`, nivel Pendiente;
- sólo T3/T5 → sigue incompleto según el criterio T1+T2;
- un T1 válido → cuenta una vez y deja de estar incompleto, aunque el prior todavía domine;
- valores en los límites 5, 7 y 9, evaluados antes del redondeo;
- score alto con datos incompletos → Pendiente.
