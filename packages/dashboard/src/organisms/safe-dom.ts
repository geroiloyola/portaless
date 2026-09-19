// Helper de construccion segura de DOM para el catalogo de organismos del
// dashboard. Antes de este archivo, cada organismo interpolaba datos
// directo en un template literal y lo asignaba con node.innerHTML = html --
// funciona mientras los datos vengan de mockData fijo, pero es una via
// directa de XSS el dia que un campo (ej. displayName de un plugin, o el
// nombre declarado por un proveedor de escrow) venga de un tercero no
// confiable y se siga tratando como HTML en vez de texto. El catalogo de
// plugins ya es abierto por defecto (ver ROADMAP.md, "Ecosistema de
// plugins") -- ese es exactamente el tipo de dato que este helper protege.
//
// Regla de uso: la ESTRUCTURA (tags, clases, atributos) sigue siendo HTML
// literal escrito a mano en cada organismo -- eso no cambia. Lo que cambia
// es que cualquier VALOR DINAMICO (nombres, labels, montos formateados)
// pasa por text() en vez de interpolarse directo en el string.

/** Crea un elemento con className y, opcionalmente, hijos ya construidos
 * (nodos DOM, no HTML). Reemplaza el patron `el(tag, className, htmlString)`
 * anterior para los casos donde el contenido incluye datos dinamicos. */
export function el(tag: string, className: string, children: (Node | string)[] = []): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** Crea un nodo de texto plano -- usar para CUALQUIER valor que venga de
 * datos (nombres, labels, IDs), nunca para estructura. A diferencia de
 * interpolar en un template literal, esto nunca interpreta el contenido
 * como HTML, sin importar que caracteres tenga. */
export function text(value: string | number): Text {
  return document.createTextNode(String(value));
}

/** Crea un <span> con className + estilo inline + contenido de texto
 * seguro -- el caso mas comun en los organismos existentes (los "tag" de
 * estado: "Pagado $12.40", "alto", "allow", etc.). style se pasa como
 * atributo porque son strings fijos generados por toneStyle()/riskStyle()
 * (design-tokens.ts), no datos de usuario. */
export function tag(className: string, style: string, content: string | number): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  if (style) span.setAttribute("style", style);
  span.appendChild(text(content));
  return span;
}

/** Construye una fila `<div class="row"><span>A</span><span>B</span></div>`
 * -- patron repetido en los 5 organismos con listas (AgentLedgerPanel,
 * ContentListPanel, PolicyPanel, PermissionsCenterPanel). left/right
 * aceptan un nodo ya construido (ej. el resultado de tag()) o un string,
 * que se envuelve en un <span> con texto seguro. */
export function row(left: Node | string, right?: Node | string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "row";
  const wrap = (value: Node | string): Node => {
    if (typeof value !== "string") return value;
    const span = document.createElement("span");
    span.appendChild(text(value));
    return span;
  };
  div.appendChild(wrap(left));
  if (right !== undefined) div.appendChild(wrap(right));
  return div;
}
