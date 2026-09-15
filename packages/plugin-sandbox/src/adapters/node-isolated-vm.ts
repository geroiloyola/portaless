import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId, CapabilityHostBridge } from "../types";

// v0.0.9: puentes de las 9 capacidades que faltaban (de las 12 del
// catalogo, ver packages/plugin-sandbox/src/capabilities/capability-registry.ts).
// Cada entrada define: la funcion global que se inyecta en el isolate, y
// que metodo de CapabilityHostBridge invoca si esta concedida y hay un
// handler real configurado. Mismo patron de allow/deny que ya usaban
// content:read/content:write/network:fetch -- ver bloque mas abajo.
interface CapabilityBridgeSpec {
  capability: CapabilityId;
  globalName: string;
  invokeHost: (bridge: CapabilityHostBridge, pluginName: string, argsJson: string) => Promise<unknown>;
}

const NOT_CONFIGURED = (cap: CapabilityId) =>
  new Error(`Capacidad '${cap}' concedida, pero tiene un handler no configurado (hostBridge) todavia para ella.`);

// v0.0.9: FIX de un bug preexistente (no introducido en este PR, pero
// expuesto por la nueva cobertura E2E de los puentes de capacidades y
// del pool de isolates -- ver tests/e2e/sandbox-capability-bridges.test.ts
// y tests/e2e/sandbox-isolate-pool.test.ts). El codigo de cada plugin se
// pega dentro del cuerpo de una funcion async (`(async function(...) {
// ${input.code} })(...)`). JavaScript NUNCA expone automaticamente el
// valor de la ultima expresion evaluada dentro de una FUNCION como su
// valor de retorno -- eso solo ocurre con la "completion value" de un
// SCRIPT o MODULO de nivel superior (ver isolated-vm README, seccion
// `script.run`: "This will return the last value evaluated ... For
// instance if your script was 'let foo = 1; let bar = 2; bar = foo +
// bar' then the return value will be 3" -- eso aplica al SCRIPT, no a
// una funcion embebida dentro de el). Por eso `result.output` llegaba
// `undefined` incluso para plugins tan simples como `"hola";`
// (hello-plugin, ya mergeado a agentic antes de este PR, nunca habia
// tenido un test que verificara el VALOR de `output`, solo `success`).
//
// Alternativas evaluadas y descartadas:
// - `eval(codigoDeUsuario)` dentro de la funcion async: captura bien el
//   valor final, pero ROMPE cualquier `await` de nivel superior del
//   plugin ("await is only valid in async functions and the top level
//   bodies of modules" -- el codigo evaluado via `eval` no cuenta como
//   estar "dentro" de la funcion async para el parser de V8).
// - Migrar a `isolate.compileModule` para tener top-level await real:
//   requiere reescribir instantiate()/resolveCallback() y el manejo de
//   import/export -- cambio de arquitectura mayor, fuera de alcance.
//
// Solucion adoptada (heuristica de texto, documentada como tal, sin
// parser JS completo): se intenta anteponer `return (...)` SOLO a la
// ULTIMA linea no vacia del codigo del plugin, y se valida que el
// resultado siga siendo sintacticamente compilable ANTES de ejecutarlo.
// Si la insercion de `return` rompe la sintaxis (falla la compilacion
// de prueba), se cae de vuelta al codigo original tal cual, sin captura
// de valor de retorno -- exactamente el comportamiento preexistente, por
// lo que ningun plugin existente puede quedar peor que antes.
//
// LIMITACION CONOCIDA (documentada, no un bug oculto): la heuristica
// opera por LINEAS de texto, no por sentencias reales. Si el plugin
// escribe multiples sentencias en una sola linea de texto separadas por
// `;` (p.ej. `const x = 1; JSON.stringify(x);` todo en una linea), la
// insercion de `return` antepone la palabra a TODA la linea (incluyendo
// el `const x = 1;` inicial), lo cual es sintacticamente invalido y por
// lo tanto cae al fallback sin captura de retorno. La recomendacion para
// autores de plugins (documentada en PLUGIN_SANDBOXING.md) es simplemente
// escribir la expresion final de retorno en su propia linea, que es el
// estilo que ya usan todos los plugins de ejemplo y tests de este repo.
function insertReturnOnLastStatement(code: string): string {
  const lines = code.split("\n");

  // Salta lineas vacias Y lineas que son solo cierres de bloque ("}",
  // "});", etc.) para llegar a la ULTIMA expresion real, aunque este
  // dentro de un bloque if/try/catch/for ya cerrado en el texto. Esto es
  // deliberadamente una heuristica de texto (no un parser), documentada
  // como tal en el comentario extenso mas arriba -- cubre bloques
  // simples de un nivel (el caso real de nuestros tests: `try { ... }
  // catch (err) { ULTIMA_EXPR; }`) sin necesitar entender balanceo
  // completo de llaves anidadas.
  let idx = lines.length - 1;
  const isSkippable = (trimmed: string) => trimmed === "" || /^\}+[;)]*$/.test(trimmed);
  while (idx >= 0 && isSkippable(lines[idx].trim())) idx--;
  if (idx < 0) return code;

  const line = lines[idx];
  const trimmedLine = line.trimStart();
  const blockedPrefixes = [
    "return", "if", "for", "while", "const", "let", "var", "function",
    "class", "throw", "}", "//", "import", "export", "switch", "try",
    "catch", "do ",
  ];
  const isBlocked = blockedPrefixes.some((p) => trimmedLine.startsWith(p));
  if (isBlocked || trimmedLine === "") return code;

  const indent = line.slice(0, line.length - trimmedLine.length);
  const withoutTrailingSemicolon = trimmedLine.replace(/;\s*$/, "");
  const rewrittenLines = lines.slice();
  rewrittenLines[idx] = `${indent}return (${withoutTrailingSemicolon});`;
  return rewrittenLines.join("\n");
}

// Valida (compilando de prueba en el MISMO isolate que se usara para la
// ejecucion real) si la version con `return` insertado sigue siendo
// sintacticamente valida. No ejecuta nada -- `compileScript` solo
// parsea y compila. Si falla, se descarta esa variante y se usa el
// codigo original.
async function resolveExecutableBody(
  isolate: import("isolated-vm").Isolate,
  originalCode: string
): Promise<string> {
  const withReturn = insertReturnOnLastStatement(originalCode);
  if (withReturn === originalCode) return originalCode;
  try {
    const probeSrc = `(async function(payload, console, fetchAllowed, capabilities) {\n${withReturn}\n});`;
    await isolate.compileScript(probeSrc);
    return withReturn;
  } catch {
    return originalCode;
  }
}

// IMPORTANTE: cada invokeHost debe devolver un STRING (via JSON.stringify),
// nunca el objeto/valor crudo que retorna el metodo real del hostBridge.
// isolated-vm no clona automaticamente objetos JS arbitrarios devueltos
// por un ivm.Callback({async:true}) al otro lado del limite del isolate
// -- solo tipos primitivos transferibles (ver TransferOptions en el
// README oficial). El sintoma real observado al no serializar era
// literalmente el error "#<Promise> could not be cloned." (isolated-vm
// reporta asi tambien el fallo de clonado de un OBJETO no transferible,
// no solo de promesas pendientes -- el mensaje de error es generico).
// El patron correcto es el mismo que ya usaba `network:fetch` en este
// mismo archivo, cuyo fetchCallback retorna `res.text()` (un string
// simple, siempre transferible) en vez del objeto Response crudo.
const CAPABILITY_BRIDGES: CapabilityBridgeSpec[] = [
  {
    capability: "media:read",
    globalName: "__portalessMediaRead",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.mediaRead) throw NOT_CONFIGURED("media:read");
      return JSON.stringify(await bridge.mediaRead(JSON.parse(argsJson)));
    },
  },
  {
    capability: "media:write",
    globalName: "__portalessMediaWrite",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.mediaWrite) throw NOT_CONFIGURED("media:write");
      return JSON.stringify(await bridge.mediaWrite(JSON.parse(argsJson)));
    },
  },
  {
    capability: "email:send",
    globalName: "__portalessEmailSend",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.emailSend) throw NOT_CONFIGURED("email:send");
      return JSON.stringify(await bridge.emailSend(JSON.parse(argsJson)));
    },
  },
  {
    capability: "commerce:read",
    globalName: "__portalessCommerceRead",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.commerceRead) throw NOT_CONFIGURED("commerce:read");
      return JSON.stringify(await bridge.commerceRead(JSON.parse(argsJson)));
    },
  },
  {
    capability: "commerce:checkout",
    globalName: "__portalessCommerceCheckout",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.commerceCheckout) throw NOT_CONFIGURED("commerce:checkout");
      return JSON.stringify(await bridge.commerceCheckout(JSON.parse(argsJson)));
    },
  },
  {
    capability: "storage:read",
    globalName: "__portalessStorageRead",
    invokeHost: async (bridge, plugin, argsJson) => {
      if (!bridge.storageRead) throw NOT_CONFIGURED("storage:read");
      return JSON.stringify(await bridge.storageRead(plugin, JSON.parse(argsJson)));
    },
  },
  {
    capability: "storage:write",
    globalName: "__portalessStorageWrite",
    invokeHost: async (bridge, plugin, argsJson) => {
      if (!bridge.storageWrite) throw NOT_CONFIGURED("storage:write");
      return JSON.stringify(await bridge.storageWrite(plugin, JSON.parse(argsJson)));
    },
  },
  {
    capability: "agent:identify",
    globalName: "__portalessAgentIdentify",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.agentIdentify) throw NOT_CONFIGURED("agent:identify");
      return JSON.stringify(await bridge.agentIdentify(JSON.parse(argsJson)));
    },
  },
  {
    capability: "site:admin",
    globalName: "__portalessSiteAdmin",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.siteAdmin) throw NOT_CONFIGURED("site:admin");
      return JSON.stringify(await bridge.siteAdmin(JSON.parse(argsJson)));
    },
  },
];

const MIN_SAFE_VERSIONS = { "6.x": "6.2.0", "7.x": "7.0.1" };
const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POOL_MAX_ISOLATES = 4;

export interface NodeIsolatedVmAdapterConfig {
  memoryLimitMb?: number;
  timeoutMs?: number;
  installedVersion: string;
  networkAllowlistOverride?: string[];
  /**
   * v0.0.9: activa un pool de isolates V8 reutilizables -- ver
   * ROADMAP.md "Pool de isolates reutilizables para el commerce-plugin" y
   * packages/commerce-plugin/README.md ("Cada fetchProducts() crea un
   * nuevo isolate"). Sin esto (por defecto false, para no cambiar el
   * comportamiento de nadie que ya dependa del adaptador), cada
   * execute() sigue creando y destruyendo un ivm.Isolate nuevo, que es
   * el costo real que se queria eliminar para cargas repetitivas como
   * el commerce-plugin (fetchProducts llamado en cada render de pagina).
   *
   * Con poolMaxIsolates > 0: execute() toma prestado un isolate ya
   * existente del pool si hay uno libre (o crea uno nuevo si el pool
   * no alcanzo su tope), y lo DEVUELVE al pool al terminar en vez de
   * isolate.dispose(). Lo que SIEMPRE se recrea por ejecucion es el
   * ivm.Context (jail) -- liviano comparado con el isolate completo --
   * para que no quede memoria/estado de una ejecucion visible en la
   * siguiente. Un isolate que quedo en estado invalido (excedio su
   * limite de memoria, quedo `isDisposed`) nunca se regresa al pool: se
   * descarta y se repone con uno nuevo en el proximo prestamo.
   */
  poolMaxIsolates?: number;
}

/**
 * Pool simple de isolates V8 reutilizables. No es un pool generico de
 * proposito amplio -- esta acotado a lo que NodeIsolatedVmAdapter
 * necesita: prestar/devolver instancias de `ivm.Isolate`, con limite
 * maximo de instancias vivas simultaneamente y descarte automatico de
 * isolates que ya no son seguros de reutilizar.
 */
class IsolateVmPool {
  private idle: import("isolated-vm").Isolate[] = [];
  private liveCount = 0;

  constructor(
    private readonly ivmModule: typeof import("isolated-vm"),
    private readonly memoryLimitMb: number,
    private readonly maxIsolates: number
  ) {}

  get stats() {
    return { idle: this.idle.length, live: this.liveCount, max: this.maxIsolates };
  }

  async acquire(): Promise<import("isolated-vm").Isolate> {
    while (this.idle.length > 0) {
      const candidate = this.idle.pop()!;
      if (!candidate.isDisposed) return candidate;
      // Isolate quedo invalido mientras esperaba en el pool (p.ej. algun
      // codigo externo lo dispuso) -- se descarta y se sigue buscando.
      this.liveCount--;
    }
    if (this.liveCount < this.maxIsolates) {
      this.liveCount++;
      return new this.ivmModule.Isolate({ memoryLimit: this.memoryLimitMb });
    }
    // Pool lleno y sin instancias libres: se crea una instancia extra
    // fuera del pool (no cuenta contra liveCount) en vez de bloquear la
    // ejecucion indefinidamente. No se agrega a `idle` al liberarse.
    return new this.ivmModule.Isolate({ memoryLimit: this.memoryLimitMb });
  }

  release(isolate: import("isolated-vm").Isolate): void {
    if (isolate.isDisposed) {
      this.liveCount = Math.max(0, this.liveCount - 1);
      return;
    }
    if (this.idle.length < this.maxIsolates) {
      this.idle.push(isolate);
    } else {
      // Instancia extra creada por encima del tope (ver acquire arriba):
      // no pertenece al pool, se dispone en vez de acumularse sin limite.
      this.liveCount = Math.max(0, this.liveCount - 1);
      isolate.dispose();
    }
  }

  disposeAll(): void {
    for (const isolate of this.idle) {
      if (!isolate.isDisposed) isolate.dispose();
    }
    this.idle = [];
    this.liveCount = 0;
  }
}

export class NodeIsolatedVmAdapter implements SandboxAdapter {
  readonly providerName = "node-isolated-vm";
  readonly supportsWasm = false;

  private pool: IsolateVmPool | null = null;

  constructor(private config: NodeIsolatedVmAdapterConfig) { this.assertSafeVersion(config.installedVersion); }

  private async getOrCreatePool(ivm: typeof import("isolated-vm")): Promise<IsolateVmPool | null> {
    const maxIsolates = this.config.poolMaxIsolates;
    if (!maxIsolates || maxIsolates <= 0) return null;
    if (!this.pool) {
      this.pool = new IsolateVmPool(ivm, this.config.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB, maxIsolates);
    }
    return this.pool;
  }

  /** Estadisticas del pool activo, o null si esta instancia no usa pool (poolMaxIsolates no configurado). */
  get poolStats(): { idle: number; live: number; max: number } | null {
    return this.pool?.stats ?? null;
  }

  /** Libera todos los isolates retenidos por el pool. Uso principal: tests y shutdown ordenado del proceso. */
  disposePool(): void {
    this.pool?.disposeAll();
    this.pool = null;
  }

  private assertSafeVersion(version: string): void {
    const [major] = version.split(".").map(Number);
    const minSafe = major === 6 ? MIN_SAFE_VERSIONS["6.x"] : major === 7 ? MIN_SAFE_VERSIONS["7.x"] : null;
    if (!minSafe || this.isOlderThan(version, minSafe)) {
      throw new Error(`isolated-vm@${version} es vulnerable a GHSA-864f-rcv7-6rh4 (RCE). Actualiza a ${minSafe ?? "6.2.0 o 7.0.1"}.`);
    }
  }

  private isOlderThan(a: string, b: string): boolean {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0); }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    try { await import("isolated-vm"); return true; } catch { return false; }
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];
    let ivm: typeof import("isolated-vm");
    try { ivm = await import("isolated-vm"); }
    catch (err) {
      return { success: false, error: `isolated-vm no instalado: ${(err as Error).message}`, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    }

    const pool = await this.getOrCreatePool(ivm);
    const isolate = pool ? await pool.acquire() : new ivm.Isolate({ memoryLimit: this.config.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB });

    // El codigo dentro del isolate puede invocar __portalessFetch sin
    // hacerle await (fire-and-forget). Como esa funcion es un
    // ivm.Callback({ async: true }), su rechazo (p.ej. host no
    // autorizado) queda "vivo" del lado de Node aunque el codigo del
    // plugin ya haya manejado ese rechazo dentro del isolate. Sin un
    // .catch() de este lado, Vitest/Node lo reportan como Unhandled
    // Rejection al final del proceso, incluso cuando el test en si
    // paso correctamente. Se registra cada invocacion para poder
    // silenciar ese ruido sin ocultar errores reales de la ejecucion.
    const pendingFetchCalls: Promise<unknown>[] = [];

    let context: import("isolated-vm").Context | undefined;
    try {
      context = await isolate.createContext();
      const jail = context.global;
      await jail.set("global", jail.derefInto());
      const grantedSet = input.granted;

      await jail.set("__portalessLog", (...args: unknown[]) => { console.log(`[plugin:${input.manifest.name}]`, ...args); });

      if (grantedSet.has("network:fetch")) {
        const allowedHosts = new Set(input.manifest.requestedCapabilities.find((c) => c.id === "network:fetch")?.allowedHosts ?? []);
        // IMPORTANTE -- ver bug documentado en la libreria isolated-vm:
        // https://github.com/laverdet/isolated-vm/issues/240 y /294.
        // Un `ivm.Callback({ async: true })` cuyo resultado se espera
        // con `await` DIRECTAMENTE dentro del codigo JS del isolate
        // dispara `TypeError: #<Promise> could not be cloned.` de forma
        // consistente en esta version (7.0.1) cuando esa promesa termina
        // formando parte del completion value final del script -- la
        // promesa que devuelve un Callback async es una promesa "externa"
        // que V8 no puede clonar igual que una nativa. Confirmado con
        // pruebas aisladas minimas (ver historial de PR).
        //
        // El patron correcto, documentado por el propio mantenedor en
        // https://github.com/laverdet/isolated-vm/issues/294, es usar
        // una `ivm.Reference` a una funcion Node normal (no un Callback)
        // y, del lado del codigo JS que corre DENTRO del isolate, invocar
        // `referencia.apply(undefined, args, { result: { promise: true, copy: true } })`.
        // Con `result: { promise: true }`, es la propia libreria nativa
        // (en C++, no JS) la que espera la promesa y transfiere su valor
        // ya resuelto -- evitando por completo el problema de identidad
        // de promesas cruzando el limite entre isolates.
        const fetchRef = new ivm.Reference((urlStr: string, opts?: string) => {
          const call = (async () => {
            const parsed = new URL(urlStr);
            if (!allowedHosts.has(parsed.host)) { deniedAttempts.push("network:fetch"); throw new Error(`Host no autorizado: ${parsed.host}`); }
            const parsedOpts = opts ? JSON.parse(opts) : undefined;
            const res = await fetch(urlStr, parsedOpts);
            return await res.text();
          })();
          // Registramos un .catch() silencioso sobre la promesa nativa de
          // Node ANTES de devolverla a isolated-vm -- .apply() con
          // result:{promise:true} SI consume/transfiere el rechazo
          // correctamente hacia el isolate, pero sin este registro Node
          // puede seguir reportando la misma promesa nativa como Unhandled
          // Rejection al terminar el proceso, porque desde la perspectiva
          // del motor de promesas de Node nadie mas la encadeno con
          // .then/.catch explicitamente en este hilo.
          pendingFetchCalls.push(call.catch(() => undefined));
          return call;
        });
        await jail.set("__portalessFetchRef", fetchRef);
      } else {
        await jail.set("__portalessFetchRef", undefined);
        await jail.set("__portalessFetch", () => { deniedAttempts.push("network:fetch"); throw new Error("Capacidad 'network:fetch' no concedida."); });
      }

      if (!grantedSet.has("content:read")) {
        await jail.set("__portalessReadContent", () => { deniedAttempts.push("content:read"); throw new Error("Capacidad 'content:read' no concedida."); });
      }
      if (!grantedSet.has("content:write")) {
        await jail.set("__portalessWriteContent", () => { deniedAttempts.push("content:write"); throw new Error("Capacidad 'content:write' no concedida."); });
      }

      // v0.0.9: puentes de las 9 capacidades restantes. Mismo patron de
      // allow/deny que content:read/content:write arriba -- si la
      // capacidad no esta concedida, la funcion inyectada rechaza de
      // inmediato dentro del isolate sin tocar el hostBridge en absoluto
      // (ni siquiera para revisar si hay handler configurado).
      // Mismo patron de ivm.Reference + apply({ result: { promise: true } })
      // que __portalessFetchRef arriba -- ver el comentario extenso junto a
      // ese bloque para la explicacion completa del bug de isolated-vm que
      // esto evita (ivm.Callback async + await directo dentro del isolate
      // rompe con "Promise could not be cloned").
      const hostBridge = input.hostBridge ?? {};
      for (const spec of CAPABILITY_BRIDGES) {
        if (grantedSet.has(spec.capability)) {
          const ref = new ivm.Reference((argsJson?: string) => {
            // Mismo motivo que fetchRef mas arriba: registramos el
            // .catch() silencioso sobre la promesa nativa ANTES de
            // devolverla, para que un rechazo (p.ej. NOT_CONFIGURED) no
            // aparezca como Unhandled Rejection aunque .apply() ya lo
            // haya transferido correctamente al isolate.
            const call = spec.invokeHost(hostBridge, input.manifest.name, argsJson ?? "null");
            pendingFetchCalls.push(call.catch(() => undefined));
            return call;
          });
          await jail.set(`${spec.globalName}Ref`, ref);
        } else {
          await jail.set(`${spec.globalName}Ref`, undefined);
          await jail.set(spec.globalName, () => {
            deniedAttempts.push(spec.capability);
            throw new Error(`Capacidad '${spec.capability}' no concedida.`);
          });
        }
      }

      await jail.set("__portalessPayload", JSON.stringify(input.payload ?? null));

      // Ver comentario extenso junto a insertReturnOnLastStatement() (arriba
      // en este archivo) para el analisis completo del bug preexistente que
      // esto corrige y las alternativas evaluadas. En resumen: intentamos
      // que la ultima linea no vacia del codigo del plugin se convierta en
      // un `return` real (validado por compilacion de prueba antes de
      // usarlo), para que la funcion async SI propague su valor al exterior.
      const executableBody = await resolveExecutableBody(isolate, input.code);

      // Opciones de transferencia para Reference.apply(): copiamos los
      // argumentos hacia el host, y para el resultado usamos
      // { promise: true, copy: true } -- es ESTA combinacion la que le
      // pide a isolated-vm (en C++, no en JS) que espere la promesa
      // devuelta por la funcion referenciada y copie su valor ya
      // resuelto de vuelta al isolate. Ver comentario extenso junto a
      // __portalessFetchRef mas arriba en este archivo para el porque:
      // usar ivm.Callback({ async: true }) + await directo dentro del
      // codigo del isolate dispara "TypeError: #<Promise> could not be
      // cloned." de forma consistente (bug/limitacion documentada en
      // https://github.com/laverdet/isolated-vm/issues/240 y /294).
      const bridgeApplyOpts = { arguments: { copy: true }, result: { promise: true, copy: true } };
      const wrappedCode = `
        const payload = JSON.parse(__portalessPayload);
        const console = { log: __portalessLog };
        const fetchAllowed = (url, opts) => __portalessFetchRef
          ? __portalessFetchRef.apply(undefined, [url, opts ? JSON.stringify(opts) : undefined], ${JSON.stringify(bridgeApplyOpts)})
          : __portalessFetch(url, opts);
        // Cada __portalessXxxRef.apply(...) cruza el resultado del host
        // como STRING JSON (ver comentario junto a CAPABILITY_BRIDGES mas
        // arriba en este archivo). Aqui, del lado del plugin, se hace
        // JSON.parse para que el codigo del plugin reciba el objeto real,
        // no el string -- asi 'await capabilities.agentIdentify(...)'
        // devuelve el objeto { verifiedAgents: 3, ... } y no el string
        // JSON crudo. Si la capacidad no fue concedida, __portalessXxxRef
        // es undefined y se usa en su lugar __portalessXxx (la funcion
        // sync que rechaza inmediatamente, registrada en el bloque
        // de arriba).
        function invokeBridge(ref, fallback, args) {
          const argsJson = JSON.stringify(args ?? null);
          if (ref) return ref.apply(undefined, [argsJson], ${JSON.stringify(bridgeApplyOpts)}).then((r) => JSON.parse(r));
          return Promise.resolve().then(() => fallback(argsJson));
        }
        const capabilities = {
          mediaRead: (args) => invokeBridge(__portalessMediaReadRef, typeof __portalessMediaRead === "function" ? __portalessMediaRead : undefined, args),
          mediaWrite: (args) => invokeBridge(__portalessMediaWriteRef, typeof __portalessMediaWrite === "function" ? __portalessMediaWrite : undefined, args),
          emailSend: (args) => invokeBridge(__portalessEmailSendRef, typeof __portalessEmailSend === "function" ? __portalessEmailSend : undefined, args),
          commerceRead: (args) => invokeBridge(__portalessCommerceReadRef, typeof __portalessCommerceRead === "function" ? __portalessCommerceRead : undefined, args),
          commerceCheckout: (args) => invokeBridge(__portalessCommerceCheckoutRef, typeof __portalessCommerceCheckout === "function" ? __portalessCommerceCheckout : undefined, args),
          storageRead: (args) => invokeBridge(__portalessStorageReadRef, typeof __portalessStorageRead === "function" ? __portalessStorageRead : undefined, args),
          storageWrite: (args) => invokeBridge(__portalessStorageWriteRef, typeof __portalessStorageWrite === "function" ? __portalessStorageWrite : undefined, args),
          agentIdentify: (args) => invokeBridge(__portalessAgentIdentifyRef, typeof __portalessAgentIdentify === "function" ? __portalessAgentIdentify : undefined, args),
          siteAdmin: (args) => invokeBridge(__portalessSiteAdminRef, typeof __portalessSiteAdmin === "function" ? __portalessSiteAdmin : undefined, args),
        };
        // La Promise se asigna a una variable global y se deja como ULTIMA
        // linea del script para que su valor sea la "completion value" real
        // que promise:true espera y resuelve (ver TransferOptions en el
        // README de isolated-vm: "Automatically proxy any returned promises
        // between isolates" -- solo aplica a la completion value del script
        // top-level, no a expresiones intermedias sin asignar).
        globalThis.__portalessResultPromise = (async function(payload, console, fetchAllowed, capabilities) {
          ${executableBody}
        })(payload, console, fetchAllowed, capabilities);
        globalThis.__portalessResultPromise;
      `;

      const script = await isolate.compileScript(wrappedCode);
      const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const rawResult = await script.run(context, { timeout, copy: true, promise: true } as any);

      // Drena cualquier llamada a __portalessFetch que el plugin haya
      // disparado sin await, para que su eventual rechazo no aparezca
      // como Unhandled Rejection despues de que execute() ya retorno.
      await Promise.allSettled(pendingFetchCalls);

      return { success: true, output: rawResult, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } catch (err) {
      await Promise.allSettled(pendingFetchCalls);
      return { success: false, error: (err as Error).message, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } finally {
      // El Context (jail) SIEMPRE se libera aca, sin importar si el
      // isolate va a devolverse al pool o a disponerse -- es lo que
      // impide que el estado de esta ejecucion (variables globales,
      // callbacks inyectados) siga vivo en la proxima reutilizacion del
      // mismo isolate. context.release() puede no existir si createContext
      // fallo antes de asignar `context` -- se protege por si acaso.
      try { context?.release(); } catch { /* ya liberado o nunca creado */ }

      if (pool) {
        pool.release(isolate);
      } else {
        isolate.dispose();
      }
    }
  }
}
