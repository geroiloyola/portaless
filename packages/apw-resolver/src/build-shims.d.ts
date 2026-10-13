// Shim SOLO para el build de publicacion (tsc -p tsconfig.build.json).
// Los stores tipados de did-apw referencian el global `D1Database` de
// Cloudflare workerd, que no esta instalado como dependencia de tipos de
// este paquete (no forma parte de la superficie standalone del cliente).
// Firmas minimas para que el typecheck pase; en runtime el simbolo no
// existe -- los stores D1 solo se usan en el lado servidor de Portaless,
// no en el cliente verificador publicado.
declare interface D1Database {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results?: T[] }>;
    };
    run(...params: unknown[]): Promise<{ meta?: { changes?: number } }>;
    get<T>(): T | undefined;
    all<T>(): { results?: T[] };
  };
  batch(statements: unknown[]): Promise<Array<{ meta?: { changes?: number } }>>;
  exec(sql: string): unknown;
}
