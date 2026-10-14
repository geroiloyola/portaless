// Iconos de linea del palette del editor.
//
// Lucide (ISC license) copiados como SVG inline: sin dependencia de runtime,
// funciona en el editor vanilla sin React y `stroke="currentColor"` hereda
// --text/--accent por CSS. Antes aca habia emojis (`icon: "🏔"`) -- el emoji
// como icono es una de las senales mas rapidas de interfaz desactualizada,
// ademas de que el SO lo pinta con su propio color y rompe el contraste.

function svgOpen(strokeWidth = 2): string {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
}

function icon(body: string, strokeWidth = 2): string {
  return `${svgOpen(strokeWidth)}${body}</svg>`;
}

// Hero / Portada -> lucide "layout-template"
export const ICON_LAYOUT_TEMPLATE = icon(`<rect width="18" height="7" x="3" y="3" rx="1" /> <rect width="9" height="7" x="3" y="14" rx="1" /> <rect width="5" height="7" x="16" y="14" rx="1" />`);

// Encabezado -> lucide "heading"
export const ICON_HEADING = icon(`<path d="M6 12h12" /> <path d="M6 20V4" /> <path d="M18 20V4" />`);

// Parrafo -> lucide "pilcrow"
export const ICON_PILCROW = icon(`<path d="M13 4v16" /> <path d="M17 4v16" /> <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />`);

// Deshacer -> lucide "undo-2"
export const ICON_UNDO_2 = icon(`<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />`);

// Rehacer -> lucide "redo-2"
export const ICON_REDO_2 = icon(`<path d="m15 14 5-5-5-5" /> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13" />`);

// Carpeta (volver al manager de paginas) -> lucide "folder"
export const ICON_FOLDER = icon(`<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>`);

// Imagen -> lucide "image"
export const ICON_IMAGE = icon(`<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`);

// Boton -> lucide "mouse-pointer-click"
export const ICON_MOUSE_POINTER_CLICK = icon(`<path d="M14 4.1 12 6" /> <path d="m5.1 8-2.9-.8" /> <path d="m6 12-1.9 2" /> <path d="M7.2 2.2 8 5.1" /> <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />`);

// Columnas -> lucide "columns-2"
export const ICON_COLUMNS_2 = icon(`<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M12 3v18" />`);

// Grilla de productos -> lucide "shopping-cart"
export const ICON_SHOPPING_CART = icon(`<path d="m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18" /> <path d="M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25" /> <circle cx="18" cy="20" r="2" /> <circle cx="8" cy="20" r="2" />`);

// Espaciador -> lucide "move-vertical"
export const ICON_MOVE_VERTICAL = icon(`<path d="M12 2v20" /> <path d="m8 18 4 4 4-4" /> <path d="m8 6 4-4 4 4" />`);

// Lista de enlaces -> lucide "link"
export const ICON_LINK = icon(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />`);

// Iconos sociales -> lucide "share-2"
export const ICON_SHARE_2 = icon(`<circle cx="18" cy="5" r="3" /> <circle cx="6" cy="12" r="3" /> <circle cx="18" cy="19" r="3" /> <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /> <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />`);

// Compartir (boton de accion) -> el share de estilo iOS: caja abierta
// con flecha hacia arriba, el gesto que todo el mundo reconoce del
// boton compartir del iPhone. Es el share canonico del rincon del
// header y del ProfileHeader; la variante share-2 se conserva solo
// como icono del elemento SocialIcons en el palette del editor.
// Stroke 1.5 (no 2) para que la caja fina se lea igual de bien a 16px.
export const ICON_SHARE_IOS = icon(
  `<path d="M20 13V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V13" /> <path d="M12 15V3M12 3L8.5 6.5M12 3L15.5 6.5" />`,
  1.5,
);

// Volumen -> lucide "volume-2". El estado silenciado NO cambia el SVG:
// lo marca el atributo aria-pressed (lo conmuta el listener delegado y
// el CSS lo atenua), asi el boton es un solo nodo estable para test y
// accesibilidad.
export const ICON_VOLUME_2 = icon(
  `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /> <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /> <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />`,
);

// Direcciones / Como llegar (rombo con flecha de navegacion) -> SVG
// canonico de instrucciones de mapa provisto para el rincon del header
// y el boton del elemento Map.
export const ICON_DIRECTIONS = icon(
  `<path d="M16 11H10C9 11 8 12 8 13V14M16 11L14 9M16 11L14 13" /><path d="M1.42426 11.5757L11.5757 1.42426C11.8101 1.18995 12.1899 1.18995 12.4243 1.42426L22.5757 11.5757C22.8101 11.8101 22.81 12.1899 22.5757 12.4243L12.4243 22.5757C12.1899 22.8101 11.8101 22.81 11.5757 22.5757L1.42426 12.4243C1.18995 12.1899 1.18995 11.8101 1.42426 11.5757Z" />`,
  1.5,
);

// Mapa -> lucide "map"
export const ICON_MAP = icon(
  `<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /> <line x1="9" x2="9" y1="3" y2="18" /> <line x1="15" x2="15" y1="6" y2="21" />`,
);

// Perfil / Bio -> lucide "circle-user-round"
export const ICON_CIRCLE_USER_ROUND = icon(`<path d="M17.925 20.056a6 6 0 0 0-11.851.001" /> <circle cx="12" cy="11" r="4" /> <circle cx="12" cy="12" r="10" />`);

// Tienda de afiliados -> lucide "store"
export const ICON_STORE = icon(`<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" /> <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" /> <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />`);

// Video (embed) -> lucide "video"
export const ICON_VIDEO = icon(`<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /> <rect x="2" y="6" width="14" height="12" rx="2" />`);

// Preguntas frecuentes -> lucide "circle-question-mark"
export const ICON_CIRCLE_QUESTION_MARK = icon(`<circle cx="12" cy="12" r="10" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" />`);

// Testimonio -> lucide "message-square-quote"
export const ICON_MESSAGE_SQUARE_QUOTE = icon(`<path d="M14 14a2 2 0 0 0 2-2V8h-2" /> <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /> <path d="M8 14a2 2 0 0 0 2-2V8H8" />`);

// Formulario de contacto -> lucide "mail"
export const ICON_MAIL = icon(`<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /> <rect x="2" y="4" width="20" height="16" rx="2" />`);

// Galeria -> lucide "images"
export const ICON_IMAGES = icon(`<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16" /> <path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2" /> <circle cx="13" cy="7" r="1" fill="currentColor" /> <rect x="8" y="2" width="14" height="14" rx="2" />`);

// Mapa tipo -> icono, para que registry.ts (y cualquier otro render)
// resuelva sin repetir el string SVG.
export const ELEMENT_ICONS: Record<string, string> = {
  LAYOUT_TEMPLATE: ICON_LAYOUT_TEMPLATE,
  HEADING: ICON_HEADING,
  PILCROW: ICON_PILCROW,
  IMAGE: ICON_IMAGE,
  MOUSE_POINTER_CLICK: ICON_MOUSE_POINTER_CLICK,
  COLUMNS_2: ICON_COLUMNS_2,
  SHOPPING_CART: ICON_SHOPPING_CART,
  MOVE_VERTICAL: ICON_MOVE_VERTICAL,
  LINK: ICON_LINK,
  SHARE_2: ICON_SHARE_2,
  SHARE_IOS: ICON_SHARE_IOS,
  VOLUME_2: ICON_VOLUME_2,
  CIRCLE_USER_ROUND: ICON_CIRCLE_USER_ROUND,
  STORE: ICON_STORE,
  VIDEO: ICON_VIDEO,
  CIRCLE_QUESTION_MARK: ICON_CIRCLE_QUESTION_MARK,
  MESSAGE_SQUARE_QUOTE: ICON_MESSAGE_SQUARE_QUOTE,
  MAIL: ICON_MAIL,
  IMAGES: ICON_IMAGES,
  MAP: ICON_MAP,
  DIRECTIONS: ICON_DIRECTIONS,
};

// Helper de render: el icono es SVG (innerHTML) y el nombre es un text node,
// asi displayName nunca se interpreta como markup. Lo usan los tres sitios
// que antes interpolaban el emoji como texto plano.
// Icono sin texto (botones de undo/redo): la columna del canvas es angosta,
// con label los dos botones mas el enlace no entran en una linea.
export function iconOnly(iconSvg: string): SVGSVGElement | null {
  const host = document.createElement("span");
  host.innerHTML = iconSvg; // constante interna de icons.ts, nunca input de usuario
  return host.firstElementChild as SVGSVGElement | null;
}

export function iconLabel(iconSvg: string, label: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "ae-icon-label";
  const host = document.createElement("span");
  host.className = "ae-icon-label__icon";
  host.innerHTML = iconSvg; // constante interna de icons.ts, nunca input de usuario
  const node = host.firstElementChild;
  if (node) wrap.appendChild(node);
  wrap.appendChild(document.createTextNode(` ${label}`));
  return wrap;
}
