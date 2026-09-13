# Undo/Redo y Anidamiento Visual en Columnas

## Undo/Redo

history.ts implementa EditorHistory: pila de snapshots, hasta 100 pasos. Atajos: Ctrl+Z/Cmd+Z deshace, Ctrl+Shift+Z o Ctrl+Y rehace. Toda mutacion pasa por commit(), que clona el layout antes de aplicar cambios.

## Anidamiento visual en columnas

ElementNode.columnSlots?: ElementNode[][] -- un array de nodos por cada columna. Cada slot es una zona de drop independiente, direccionada por un path que alterna indice-de-nodo/indice-de-slot, permitiendo anidar Columns dentro de Columns sin limite fijo. Compatibilidad retroactiva con children plano.

## Limitaciones

- No hay reordenamiento por arrastre dentro de un mismo slot todavia.
- El historial es en memoria del navegador.
